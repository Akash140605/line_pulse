import React, { useEffect, useMemo, useState } from 'react';
import DixonLogo from '../components/DixonLogo';
import { ArrowUp, ArrowDown, Home, RotateCcw, Save, CheckCircle2, Lock, Eye, LayoutDashboard, Shield, Palette, Users, Database, FolderTree, Plus, Trash2, History, RefreshCw, Bell, ShieldCheck, KeyRound } from 'lucide-react';
import { api } from '../api';
import { normReasons } from '../components/OleParts';
import StationSetup from '../components/StationSetup';
import ShiftMaster from '../components/ShiftMaster';
import { ReasonsEditor } from './LossEntryPage';
import ModelMasterPage from './ModelMasterPage';
import { serverToday } from '../utils/serverTime';
import UserManager from '../components/UserManager';
import NotifySetup from '../components/NotifySetup';
import { OPEN_PAGE_EVENT } from '../components/NotificationBell';
import ActivityLog from '../components/ActivityLog';
import SecurityPanel from '../components/SecurityPanel';
import AccessPanel from '../components/AccessPanel';
import { useAuth } from '../components/AuthGate';
import ThemeEditor, { ThemeSample } from '../components/ThemeEditor';
import { THEME_PRESETS } from '../utils/themeEngine';
import { previewTheme } from '../utils/themeEngine';
import { PAGES, SETUP_PAGE } from '../components/Sidebar';
import useUiSettings from '../hooks/useUiSettings';
import { MGMT_CATALOG, KPI_LIST, normalizeUi, mgmtPages, OLE_DEFAULT, FOLDER_IDS, FOLDER_DEFAULT, RETIRED_PAGES } from '../utils/uiSettings';

/**
 * Setup (admin only): the logins (Users & logins — saved at once), what the management logins and the admin see,
 * and the look of the app. Page / look changes stay on this screen until Save; Save stores them on the server for every screen.
 */
const TABS = [
  ['users', 'Users & logins', Users],
  ['activity', 'Activity log', History],   // 20-11-2026: who logged in and what each login did
  ['security', 'Security', ShieldCheck],   // 25-11-2026: only Line Pulse pages get data · blocked PCs · logins locked to their PCs · alerts
  ['access', 'Access & entry', KeyRound],   // 25-11-2026: who may open what (print) · entry methods on / off
  ['mgmt', 'Management view', Eye],
  ['oneview', 'Plant overview', LayoutDashboard],
  ['admin', 'Admin view', Shield],
  ['menu', 'Menu folders', FolderTree],
  ['look', 'Theme & name', Palette],
  ['refresh', 'Screen refresh', RefreshCw],   // 23-11-2026
  ['notify', 'Notifications', Bell],   // 23-11-2026: the bell and the welcome message
  ['masters', 'Masters', Database],
];

/** Setup → Masters: every master list in one place (models, loss reasons & departments, quality stations, shift & lunch). */
const MASTERS = [['models', 'Models · cycle time · lines'], ['reasons', 'Loss reasons & departments'], ['stations', 'Quality stations'], ['shift', 'Shift & lunch'], ['hpr', 'Loss ₹ & HPR'], ['ole', 'OLE formulas']];

/** Setup → Masters → Loss ₹ & HPR: rate per man-hour and overtime (Loss ₹ on the Loss analysis page and in the HPR Excel). */
function HprMaster({ hpr, onSave }) {
  const [f, setF] = useState(() => ({ rate: String(hpr.rate), otFrom: hpr.otFrom, otX: String(hpr.otX) }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setF({ rate: String(hpr.rate), otFrom: hpr.otFrom, otX: String(hpr.otX) }); }, [hpr.rate, hpr.otFrom, hpr.otX]);
  const rate = Number(f.rate), otX = Number(f.otX);
  const bad = !(f.rate !== '' && rate >= 0 && rate <= 10000) ? 'Rate must be 0 to 10000.' : !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.otFrom || '') ? 'Overtime from must be a time like 18:00.' : !(otX >= 1 && otX <= 5) ? 'Overtime factor must be 1 to 5.' : '';
  const save = async () => {
    if (bad) { setMsg({ ok: false, text: bad }); return; }
    setBusy(true); setMsg(null);
    try { await onSave({ rate, otFrom: f.otFrom, otX }); setMsg({ ok: true, text: 'Saved — Loss analysis and the HPR use it now.' }); }
    catch (e) { setMsg({ ok: false, text: `Could not save: ${e.message}` }); } finally { setBusy(false); }
  };
  const cls = 'block mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2 text-fs-14 font-bold font-mono';
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Loss rupees and HPR">
      <h3 className="text-fs-16 font-extrabold text-slate-900">Loss ₹ and HPR</h3>
      
      <div className="mt-3 flex flex-wrap items-end gap-5">
        <label className="text-fs-14 font-semibold text-slate-800">Rate (₹ per man-hour)<input type="number" min="0" max="10000" step="0.5" className={cls} aria-label="Rate per man-hour" value={f.rate} onChange={(e) => setF((x) => ({ ...x, rate: e.target.value }))} /></label>
        <label className="text-fs-14 font-semibold text-slate-800">Overtime from<input type="time" className={cls} aria-label="Overtime from" value={f.otFrom} onChange={(e) => setF((x) => ({ ...x, otFrom: e.target.value }))} /></label>
        <label className="text-fs-14 font-semibold text-slate-800">Overtime factor (×)<input type="number" min="1" max="5" step="0.5" className={cls} aria-label="Overtime factor" value={f.otX} onChange={(e) => setF((x) => ({ ...x, otX: e.target.value }))} /></label>
        <button type="button" disabled={busy} onClick={save} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={15} /> {busy ? 'Saving…' : 'Save'}</button>
      </div>
      
      {msg && <div role="status" className={`mt-2 text-fs-14 font-semibold ${msg.ok ? 'text-sky-700' : 'text-red-700'}`}>{msg.text}</div>}
    </section>
  );
}

/** Setup → Masters → OLE formulas: how Availability, Performance and Quality are worked out, manpower sync, colours. */
const OLE_CHOICES = [
  { k: 'aEnd', group: 'Availability', name: 'Day ends at', opts: [['lastScan', 'Last scan'], ['shiftEnd', 'Shift close']] },
  { k: 'aLoss', group: 'Availability', name: 'Loss entry minutes', opts: [['all', 'All are loss'], ['unplanned', 'Old planned stop not loss']] },
  { k: 'lossIn', group: 'Availability', name: 'Loss written against a model', opts: [['avail', 'Availability loss'], ['perf', 'Performance loss']] },
  { k: 'aIdle', group: 'Availability', name: 'Hour without scans, nothing written', opts: [['run', 'Run time'], ['idle', 'Idle time']] },
  { k: 'pBase', group: 'Performance', name: 'Std time against', opts: [['run', 'Run time'], ['planned', 'Planned time']] },
  { k: 'pCap', group: 'Performance', name: 'Above 100 %', opts: [[false, 'Show as it is'], [true, 'Max 100 %']] },
  { k: 'pNoStd', group: 'Performance', name: 'Model without std cycle', opts: [['skip', 'Left out'], ['avg', "Hour's average std"]] },
  { k: 'qMode', group: 'Quality', name: 'Qty out', opts: [['rejRework', 'Rejected + rework'], ['rej', 'Rejected only']] },
  { k: 'qStations', group: 'Quality', name: 'Stations used', opts: [['all', 'All stations'], ['final', 'Final check only']] },
  { k: 'mpSync', group: 'Manpower', name: 'Sync with manpower', opts: [[false, 'Off'], [true, 'On']] },
  { k: 'mpUse', group: 'Manpower', name: 'Manpower of the day', opts: [['open', 'At open'], ['avg', 'Open + close average']], when: (f) => f.mpSync },
  { k: 'mpUp', group: 'Manpower', name: 'More people than standard', opts: [[false, 'Keep std cycle'], [true, 'Shorter std cycle']], when: (f) => f.mpSync },
  { k: 'timeFmt', group: 'Display', name: 'Time', opts: [['h1', '6.3 h'], ['hm', '6h 18m']] },
];
const OLE_LINE_IDS = ['1', '2', '3', '4'];
function OleFormulas({ ole, onSave }) {
  const [f, setF] = useState(ole);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setF(ole); }, [JSON.stringify(ole)]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(f) !== JSON.stringify(ole);
  const num = (v) => (v === '' || v == null ? '' : Number(v));
  const badF = ['A', 'P', 'Q'].map((k) => (!(f[`good${k}`] >= 50 && f[`good${k}`] <= 100) ? `${k} good from: 50–100` : !(f[`watch${k}`] >= 0 && f[`watch${k}`] <= f[`good${k}`]) ? `${k} watch from: 0 to its good` : '')).find(Boolean);
  const bad = badF ? badF : !(f.good >= 50 && f.good <= 100) ? 'Good from: 50–100' : !(f.watch >= 0 && f.watch <= f.good) ? 'Watch from: 0 to good' : !(f.fewPcs >= 1 && f.fewPcs <= 100) ? 'Few pieces: 1–100'
    : Object.values(f.stdMp || {}).some((v) => v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1000)) ? 'Std manpower: 0–1000'
    : f.mpSync && !OLE_LINE_IDS.some((l) => Number(f.stdMp?.[l]) > 0) ? 'Std manpower of a line' : '';
  const save = async () => {
    if (bad) { setMsg({ ok: false, text: bad }); return; }
    setBusy(true); setMsg(null);
    const stdMp = Object.fromEntries(OLE_LINE_IDS.filter((l) => Number(f.stdMp?.[l]) > 0).map((l) => [l, Number(f.stdMp[l])]));
    try { await onSave({ ...f, stdMp }); setMsg({ ok: true, text: 'Saved' }); }
    catch (e) { setMsg({ ok: false, text: `Could not save: ${e.message}` }); } finally { setBusy(false); }
  };
  const formula = {
    Availability: `${f.aLoss === 'unplanned' ? 'Run ÷ (Time − Planned stop)' : '(Time − Loss) ÷ Time'}${f.lossIn === 'perf' ? ' · model loss in P' : ''}${f.aIdle === 'idle' ? ' · empty hour idle' : ''}`,
    Performance: `Std time ÷ ${f.pBase === 'planned' ? 'Planned time' : 'Run time'}${f.pCap ? ' · max 100 %' : ''}${f.pNoStd === 'avg' ? ' · no-std at average' : ''}`,
    Quality: `${f.qMode === 'rejRework' ? '(Made − Rejected − Rework) ÷ Made' : '(Made − Rejected) ÷ Made'}${f.qStations === 'final' ? ' · final check only' : ''}`,
    Manpower: f.mpSync ? `Std cycle × Std manpower ÷ ${f.mpUse === 'avg' ? 'Avg manpower' : 'Manpower'}` : 'Off',
    Display: `OLE good ≥ ${f.good}% · watch ≥ ${f.watch}% · A ≥ ${f.goodA}% · P ≥ ${f.goodP}% · Q ≥ ${f.goodQ}%`,
  };
  const radio = (c) => (
    <div key={c.k} role="radiogroup" aria-label={c.name}>
      <div className="text-fs-13 font-bold text-slate-600">{c.name}</div>
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        {c.opts.map(([v, label]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={f[c.k] === v} onClick={() => setF((x) => ({ ...x, [c.k]: v }))}
            className={`min-h-10 rounded-lg border px-2.5 py-1.5 text-left text-fs-14 font-bold ${f[c.k] === v ? 'border-blue-700 bg-blue-50 text-blue-900 ring-1 ring-blue-700' : 'border-slate-300 bg-white text-slate-800 hover:border-blue-400'}`}>
            {label}{v === OLE_DEFAULT[c.k] ? <span className="ml-1 text-fs-11 font-semibold text-slate-500">std</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
  const numIn = (label, k, lo, hi, suffix, aria = label) => (
    <label key={k} className="text-fs-13 font-bold text-slate-600">{label}
      <span className="mt-1 flex items-center gap-1.5"><input type="number" min={lo} max={hi} aria-label={aria} className="h-10 w-24 rounded-lg border border-slate-300 px-2.5 font-mono text-fs-15 font-bold" value={f[k] ?? ''} onChange={(e) => setF((x) => ({ ...x, [k]: num(e.target.value) }))} />{suffix && <span className="text-fs-13 font-bold text-slate-500">{suffix}</span>}</span>
    </label>
  );
  const box = (g, extra = null) => (
    <div key={g} className="rounded-xl border border-slate-200" aria-label={`${g} formula`} role="group">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-fs-15 font-extrabold text-slate-900">{g}</div>
        <div className="font-mono text-fs-13 font-bold text-dixon-navy" aria-label={`${g} formula now`}>{formula[g]}</div>
      </div>
      <div className="flex flex-col gap-3 p-3">
        {OLE_CHOICES.filter((c) => c.group === g && (!c.when || c.when(f))).map(radio)}
        {extra}
      </div>
    </div>
  );
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="OLE formulas">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-fs-16 font-extrabold text-slate-900">OLE formulas</h3>
        <span className="rounded bg-[#e3ecf8] px-2 py-0.5 font-mono text-fs-13 font-bold text-dixon-navy">OLE = A × P × Q</span>
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={() => setF({ ...OLE_DEFAULT })} className="h-9 rounded-lg border border-slate-300 px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">Standard</button>
          <button type="button" disabled={busy || !changed} onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={15} /> {busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      {msg && <div role="status" className={`mt-2 text-fs-14 font-semibold ${msg.ok ? 'text-sky-700' : 'text-red-700'}`}>{msg.text}</div>}
      <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {box('Availability')}
        {box('Performance')}
        {box('Quality')}
        {box('Manpower', (
          <div role="group" aria-label="Std manpower">
          <div className="text-fs-13 font-bold text-slate-600">Std manpower</div>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {OLE_LINE_IDS.map((l) => (
              <label key={l} className="text-fs-12 font-semibold text-slate-500">Line {l}
                <input type="number" min="0" max="1000" aria-label={`Std manpower Line ${l}`} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-fs-15 font-bold" value={f.stdMp?.[l] ?? ''} onChange={(e) => setF((x) => ({ ...x, stdMp: { ...(x.stdMp || {}), [l]: num(e.target.value) } }))} />
              </label>
            ))}
          </div>
          </div>
        ))}
        {box('Display', (
          <>
          <div className="flex flex-wrap gap-3">
            {numIn('OLE good from', 'good', 50, 100, '%', 'Good from')}
            {numIn('OLE watch from', 'watch', 0, 100, '%', 'Watch from')}
            {numIn('Few pieces below', 'fewPcs', 1, 100, 'pcs')}
          </div>
          {/* 19-11-2026: each factor its own benchmark (green from · amber from; below = red), as the MES */}
          <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="A P Q benchmarks">
            {[['A', 'Availability'], ['P', 'Performance'], ['Q', 'Quality']].map(([k, n]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-2">
                <div className="mb-1 text-fs-13 font-bold text-slate-700">{n}</div>
                <div className="flex flex-wrap gap-2">{numIn('Good from', `good${k}`, 50, 100, '%', `${n} benchmark`)}{numIn('Watch from', `watch${k}`, 0, 100, '%', `${n} amber limit`)}</div>
              </div>
            ))}
          </div>
          </>
        ))}
      </div>
    </section>
  );
}

function Masters({ hpr, onHprSave, ole, onOleSave }) {
  const [m, setM] = useState('models');
  const [reasons, setReasons] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { const t = serverToday(); api.oleEntries(t, t).then((e) => setReasons(normReasons(e?.reasons))).catch((x) => setErr(`Reasons could not be read: ${x.message}`)); }, []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Masters">
        {MASTERS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={m === k} onClick={() => setM(k)} className={`rounded-lg px-3 py-2 text-fs-14 font-bold ${m === k ? 'bg-blue-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{l}</button>)}
      </div>
      {m === 'models' && <ModelMasterPage />}
      {m !== 'models' && m !== 'shift' && err && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
      {m === 'reasons' && (reasons ? <ReasonsEditor startOpen reasons={reasons} onSaved={(r) => setReasons(normReasons(r))} /> : !err && <p className="text-fs-14 text-slate-500">Reading the reasons …</p>)}
      {m === 'stations' && (reasons ? <StationSetup startOpen reasons={reasons} onSaved={(r) => setReasons(normReasons(r))} /> : !err && <p className="text-fs-14 text-slate-500">Reading the stations …</p>)}
      {m === 'shift' && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><ShiftMaster /></section>}
      {m === 'hpr' && <HprMaster hpr={hpr} onSave={onHprSave} />}
      {m === 'ole' && <OleFormulas ole={ole} onSave={onOleSave} />}
      
    </div>
  );
}

function Switch({ on, onChange, label, disabled = false }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 ${on ? 'bg-sky-600' : 'bg-slate-300'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function Move({ i, n, onMove, name }) {
  const b = 'h-8 w-8 grid place-items-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-30';
  return (
    <div className="flex gap-1">
      <button type="button" className={b} disabled={i === 0} onClick={() => onMove(i, -1)} aria-label={`Move ${name} up`}><ArrowUp size={15} /></button>
      <button type="button" className={b} disabled={i === n - 1} onClick={() => onMove(i, 1)} aria-label={`Move ${name} down`}><ArrowDown size={15} /></button>
    </div>
  );
}

function Card({ title, sub, children, right }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
        <div><h3 className="text-fs-18 font-bold text-slate-900">{title}</h3>{sub && <p className="text-fs-14 text-slate-600">{sub}</p>}</div>
        {right}
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

/** What the management sidebar will look like with the current choices. */
function MgmtPreview({ ui }) {
  const list = mgmtPages(ui);
  const home = list.find((p) => p.id === ui.management.home);
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm" aria-label="Management preview">
      <div className="px-4 py-3 text-white" style={{ background: 'rgb(var(--sidebar))' }}>
        <div className="flex items-center gap-2.5">
          <div className="leading-tight"><DixonLogo white className="h-4" /><div className="mt-1 text-fs-12 text-slate-300">{[ui.brand.name && ui.brand.name.trim().toUpperCase() !== 'DIXON' ? ui.brand.name : '', ui.brand.tagline].filter(Boolean).join(' · ')}</div></div>
        </div>
        <div className="mt-3 space-y-1">
          {list.map(({ id, label, icon: Icon, color }) => (
            <div key={id} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-fs-14 font-semibold ${id === ui.management.home ? 'bg-white/15' : 'text-slate-200'}`}>
              <Icon size={16} className={id === ui.management.home ? color : ''} /><span className="truncate">{label}</span>
              {id === ui.management.home && <Home size={13} className="ml-auto text-slate-300" aria-label="opens here" />}
            </div>
          ))}
        </div>
      </div>
      <div className="bg-slate-50 px-4 py-2.5 text-fs-13 text-slate-700">
        <b>{list.length}</b> page{list.length === 1 ? '' : 's'} · opens on <b>{home?.label}</b> · read only, no settings
      </div>
    </div>
  );
}

/** where the settings are saved (19-11-2026): SQL Server database EMS_LinePulse_App, or the JSON files while it does not answer */
function StoreBadge() {
  const [i, setI] = useState(null);
  useEffect(() => { let on = true; api.storeInfo().then((j) => { if (on) setI(j); }).catch(() => {}); return () => { on = false; }; }, []);
  if (!i) return null;
  const sql = i.store === 'sqlsrv';
  return (
    <div role="status" aria-label="Settings storage" className={`flex flex-wrap items-center gap-2 rounded-[3px] border px-3 py-1.5 text-fs-13 ${sql ? 'border-[#BDD7EE] bg-[#EAF2FB] text-[#1F3864]' : 'border-[#FFE699] bg-[#FFF8E1] text-[#7A4B00]'}`}>
      <Database size={15} aria-hidden />
      {sql ? <span>Settings saved in <b>SQL Server · {i.database}</b> ({(i.stores || []).length} tables of settings; a copy in the JSON files too)</span>
        : <span>Settings saved in <b>JSON files</b>{i.note ? ` — ${i.note}` : ''}</span>}
    </div>
  );
}

/**
 * Setup → Menu folders (19-11-2026, as the C8 MES): the folders of the menu (name, order), which page sits in which
 * folder, and who sees each page (admin / management) — all in one table. Saved with the Save button above.
 */
function MenuFolders({ ui, set, setUi }) {
  const F = ui.folders;
  const label = (id) => (PAGES.find((p) => p.id === id) || MGMT_CATALOG.find((p) => p.id === id) || (id === SETUP_PAGE.id ? SETUP_PAGE : null))?.label || id;
  const folderOf = (id) => F.findIndex((f) => f.ids.includes(id));
  const moveF = (i, d) => set((u) => { const a = u.folders; const j = i + d; [a[i], a[j]] = [a[j], a[i]]; return u; });
  const moveP = (id, to) => set((u) => { u.folders.forEach((f) => { f.ids = f.ids.filter((x) => x !== id); }); u.folders[to].ids.push(id); return u; });
  const drop = (i) => set((u) => { const gone = u.folders.splice(i, 1)[0]; u.folders[Math.max(0, i - 1)].ids.push(...gone.ids); return u; });
  const add = () => set((u) => { let n = u.folders.length + 1; while (u.folders.some((f) => f.name === `Folder ${n}`)) n += 1; u.folders.push({ name: `Folder ${n}`, ids: [] }); return u; });
  const aIdx = (id) => ui.admin.pages.findIndex((p) => p.id === id), mIdx = (id) => ui.management.pages.findIndex((p) => p.id === id);
  return (
    <div className="grid items-start gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card title="Folders" sub="Name and order of the menu folders — the same for every login">
        <div className="space-y-2" role="list" aria-label="Menu folders">
          {F.map((f, i) => (
            <div key={i} role="listitem" className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2">
              <span className="w-5 text-center font-mono text-fs-13 font-bold text-slate-500">{i + 1}</span>
              <input value={f.name} maxLength={24} aria-label={`Folder ${i + 1} name`}
                onChange={(e) => { const v = e.target.value; setUi((u) => { const n = structuredClone(u); n.folders[i].name = v; return n; }); }}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-fs-14 font-bold" />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-fs-12 font-bold text-slate-600" title="pages in this folder">{f.ids.length}</span>
              <Move i={i} n={F.length} onMove={moveF} name={`folder ${f.name}`} />
              <button type="button" disabled={F.length < 2} onClick={() => drop(i)} aria-label={`Remove folder ${f.name}`} title="Remove (its pages go to the folder above)"
                className="grid h-8 w-8 place-items-center rounded-lg text-red-700 hover:bg-red-50 disabled:opacity-30"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={F.length >= 12} onClick={add} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-fs-13 font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"><Plus size={15} /> Add folder</button>
          <button type="button" onClick={() => set((u) => { u.folders = structuredClone(FOLDER_DEFAULT); return u; })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-50"><RotateCcw size={14} /> Standard folders</button>
        </div>
      </Card>
      <Card title="Pages" sub="Which folder each page is in, and who sees it">
        <div className="overflow-x-auto">
          <table className="w-full text-fs-14" aria-label="Pages in folders">
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600"><th className="px-2 py-1.5">Page</th><th className="px-2">Folder</th><th className="px-2 text-center">Admin</th><th className="px-2 text-center">Management</th></tr></thead>
            <tbody>
              {F.map((f, fi) => f.ids.filter((id) => FOLDER_IDS.includes(id) && !RETIRED_PAGES.has(id)).map((id, k) => {
                const a = aIdx(id), m = mIdx(id);
                return (
                  <tr key={id} className={`border-b border-slate-100 ${k === 0 ? 'border-t-2 border-t-slate-200' : ''}`}>
                    <td className="px-2 py-1.5 font-semibold text-slate-900">{label(id)}</td>
                    <td className="px-2"><select value={fi} onChange={(e) => moveP(id, Number(e.target.value))} aria-label={`Folder of ${label(id)}`} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold">{F.map((g, gj) => <option key={gj} value={gj}>{g.name}</option>)}</select></td>
                    <td className="px-2 text-center">{id === SETUP_PAGE.id ? <Lock size={15} className="mx-auto text-slate-500" aria-label="Setup — always for the administrator" /> : a >= 0 ? <Switch on={ui.admin.pages[a].on} label={`Show ${label(id)} to admin`} onChange={(v) => set((u) => { u.admin.pages[a].on = v; return u; })} /> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-2 text-center">{m >= 0 ? <Switch on={ui.management.pages[m].on} label={`Show ${label(id)} to management`} onChange={(v) => set((u) => { u.management.pages[m].on = v; return u; })} /> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function SetupPage() {
  const { ui: saved, save, loaded } = useUiSettings();
  const meAccess = useAuth();
  const [ui, setUi] = useState(saved);
  // a click on "Manage notifications" (the bell) opens this page on the Notifications tab
  const [tab, setTab] = useState(() => { try { const t = sessionStorage.getItem('ems.setupTab'); sessionStorage.removeItem('ems.setupTab'); return TABS.some(([k]) => k === t) ? t : 'users'; } catch { return 'users'; } });
  useEffect(() => {
    const on = (e) => { if (e?.detail?.page === 'setup' && e.detail.tab) setTab(e.detail.tab); };
    window.addEventListener(OPEN_PAGE_EVENT, on);
    return () => window.removeEventListener(OPEN_PAGE_EVENT, on);
  }, []);
  const [actUser, setActUser] = useState('');   // Activity log of one login (from Users & logins)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [askReset, setAskReset] = useState(false);
  const dirty = useMemo(() => JSON.stringify({ ...ui, updatedAt: null, updatedBy: null }) !== JSON.stringify({ ...saved, updatedAt: null, updatedBy: null }), [ui, saved]);
  // the server copy arrives after the first paint: take it while nothing was changed here yet
  useEffect(() => { if (!dirty) setUi(saved); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (fn) => { setMsg(null); setUi((u) => normalizeUi(fn(structuredClone(u)))); };
  const mp = ui.management.pages;
  const ov = ui.management.oneView;

  const doSave = async (action = 'save') => {
    setBusy(true); setMsg(null);
    try { const n = await save(ui, action); setUi(n); setMsg({ ok: true, text: action === 'reset' ? 'The standard setup has been restored.' : 'Saved. All screens will apply the change within one minute, or immediately after a refresh.' }); }
    catch (e) { setMsg({ ok: false, text: `Could not save: ${e.message}` }); }
    finally { setBusy(false); setAskReset(false); }
  };
  // Theme tab: the whole screen shows the colours being chosen; leaving the tab (or Setup) goes back to the saved theme
  const themeKey = JSON.stringify(ui.theme);
  useEffect(() => { previewTheme(tab === 'look' ? ui.theme : null); }, [tab, themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => previewTheme(null), []);
  const moveIn = (key) => (i, d) => set((u) => { const a = key === 'mgmt' ? u.management.pages : u.admin.pages; const j = i + d; [a[i], a[j]] = [a[j], a[i]]; return u; });

  return (
    <div className="flex flex-col gap-3" aria-label="Setup">
      <StoreBadge />
      {/* header */}
      <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4 flex-wrap items-center gap-x-4 gap-y-3 ${tab === 'users' || tab === 'masters' || tab === 'activity' || tab === 'security' || tab === 'access' ? 'hidden' : 'flex'}`}>
        <div className="min-w-0 mr-auto">
          
        </div>
        {dirty && <span className="rounded-full bg-slate-100 px-3 py-1 text-fs-13 font-bold text-slate-900" role="status">Unsaved changes</span>}
        {askReset ? (
          <span className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-fs-13 font-semibold text-red-900">
            Go back to the standard setup?
            <button type="button" disabled={busy} onClick={() => doSave('reset')} className="rounded-md bg-red-700 px-2.5 py-1 font-bold text-white">Yes, reset</button>
            <button type="button" onClick={() => setAskReset(false)} className="rounded-md border border-red-300 bg-white px-2.5 py-1 font-bold">Cancel</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAskReset(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-fs-14 font-bold text-slate-700 hover:bg-slate-50"><RotateCcw size={15} /> Reset</button>
        )}
        {dirty && <button type="button" onClick={() => { setUi(saved); setMsg(null); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-fs-14 font-bold text-slate-700 hover:bg-slate-50">Undo changes</button>}
        <button type="button" disabled={!dirty || busy} onClick={() => doSave()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={16} /> {busy ? 'Saving…' : 'Save'}</button>
        {msg && <div role="status" className={`basis-full inline-flex items-center gap-1.5 text-fs-14 font-semibold ${msg.ok ? 'text-sky-700' : 'text-red-700'}`}>{msg.ok && <CheckCircle2 size={16} />}{msg.text}</div>}
        {!loaded && <div className="basis-full text-fs-13 text-slate-600">Reading the saved setup…</div>}
      </section>

      {/* tabs */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Setup sections">
        {TABS.map(([k, l, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-fs-14 font-bold border ${tab === k ? 'bg-dixon-navy text-white border-dixon-navy' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
            <Icon size={16} /> {l}
          </button>
        ))}
      </div>

      {tab === 'users' && <UserManager onActivity={(u) => { setActUser(u); setTab('activity'); }} />}
      {tab === 'activity' && <ActivityLog user={actUser} onUser={setActUser} />}
      {tab === 'security' && <SecurityPanel />}
      {tab === 'access' && <AccessPanel ui={saved} save={save} me={meAccess} />}
      {tab === 'masters' && <Masters hpr={saved.hpr} onHprSave={async (h) => { const n = await save({ ...saved, hpr: h }, 'save'); setUi((u) => ({ ...u, hpr: n.hpr })); }}
        ole={saved.ole} onOleSave={async (o) => { const n = await save({ ...saved, ole: o }, 'save'); setUi((u) => ({ ...u, ole: n.ole })); }} />}

      {tab === 'mgmt' && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
          <Card title="Management pages">
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {mp.map((p, i) => {
                if (RETIRED_PAGES.has(p.id)) return null;
                const c = MGMT_CATALOG.find((x) => x.id === p.id); const Icon = c.icon;
                return (
                  <div key={p.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${p.on ? '' : 'bg-slate-50'}`}>
                    <Switch on={p.on} label={`Show ${c.label} to management`} onChange={(v) => set((u) => { u.management.pages[i].on = v; return u; })} />
                    <Icon size={18} className={p.on ? 'text-slate-800' : 'text-slate-400'} />
                    <div className="min-w-[12rem] flex-1">
                      <input value={p.label ?? ''} placeholder={c.label} maxLength={40} aria-label={`Name of ${c.label}`}
                        onChange={(e) => { const v = e.target.value; setMsg(null); setUi((u) => { const n = structuredClone(u); if (v) n.management.pages[i].label = v; else delete n.management.pages[i].label; return n; }); }}
                        className="w-full max-w-xs rounded-md border border-slate-300 px-2 py-1 text-fs-14 font-semibold text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                      <div className="mt-0.5 text-fs-13 text-slate-600">{c.about}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-fs-12 font-bold ${c.kind === 'line' ? 'bg-sky-50 text-sky-800' : 'bg-sky-50 text-sky-800'}`}>{c.kind === 'line' ? 'Line 1–4' : 'All lines'}</span>
                    <label className={`inline-flex items-center gap-1.5 text-fs-13 font-semibold ${p.on ? 'text-slate-800' : 'text-slate-400'}`}>
                      <input type="radio" name="mgmt-home" disabled={!p.on} checked={ui.management.home === p.id} onChange={() => set((u) => { u.management.home = p.id; return u; })} className="accent-blue-700 h-4 w-4" /> Opens here
                    </label>
                    <Move i={i} n={mp.length} onMove={moveIn('mgmt')} name={c.label} />
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="xl:sticky xl:top-20"><MgmtPreview ui={ui} /></div>
        </div>
      )}

      {tab === 'oneview' && (
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          <Card title="Sections on Plant overview">
            <div className="space-y-2">
              {[['showKpis', 'Plant KPIs (top row)'], ['lines', 'A tile per line (today, this hour, cycle, hours)'], ['week', 'Last 7 days achievement'], ['attention', 'Needs attention list']].map(([k, l]) => (
                <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-fs-14 font-semibold text-slate-800">
                  {l}<Switch on={ov[k]} label={l} onChange={(v) => set((u) => { u.management.oneView[k] = v; return u; })} />
                </label>
              ))}
            </div>
          </Card>
          <Card title="KPI tiles">
            <div className="grid sm:grid-cols-2 gap-2">
              {KPI_LIST.map(([k, l]) => (
                <label key={k} className={`flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-fs-14 font-semibold ${ov.showKpis ? 'text-slate-800' : 'text-slate-400'}`}>
                  {l}<Switch on={ov.kpis[k]} disabled={!ov.showKpis} label={`KPI ${l}`} onChange={(v) => set((u) => { u.management.oneView.kpis[k] = v; return u; })} />
                </label>
              ))}
            </div>
          </Card>
          <Card title="Refresh and colours">
            <div className="flex flex-wrap items-end gap-6">
              <label className="text-fs-14 font-semibold text-slate-800">Refresh every
                <select value={ov.refreshSec} onChange={(e) => set((u) => { u.management.oneView.refreshSec = Number(e.target.value); return u; })}
                  className="block mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-fs-14 font-bold">
                  {[10, 15, 30, 60, 120].map((s) => <option key={s} value={s}>{s} seconds</option>)}
                </select>
              </label>
              <label className="text-fs-14 font-semibold text-slate-800">Amber from (%)
                <input type="number" min={50} max={99} value={ov.amberFrom} onChange={(e) => set((u) => { u.management.oneView.amberFrom = Number(e.target.value); return u; })}
                  className="block mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-fs-14 font-bold font-mono" aria-label="Amber from percent" />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-fs-14 font-bold">
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">Green · 100% or more</span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">Amber · {ov.amberFrom}–99%</span>
              <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">Red · below {ov.amberFrom}%</span>
            </div>
          </Card>
        </div>
      )}

      {tab === 'admin' && (
        <Card title="Admin pages">
          <div className="grid gap-2 md:grid-cols-2">
            {ui.admin.pages.map((p, i) => {
              if (RETIRED_PAGES.has(p.id)) return null;
              const c = PAGES.find((x) => x.id === p.id); const Icon = c.icon;
              return (
                <div key={p.id} className={`flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 ${p.on ? '' : 'bg-slate-50'}`}>
                  <Switch on={p.on} label={`Show ${c.label} to admin`} onChange={(v) => set((u) => { u.admin.pages[i].on = v; return u; })} />
                  <Icon size={17} className={p.on ? 'text-slate-800' : 'text-slate-400'} />
                  <span className={`flex-1 text-fs-14 font-semibold ${p.on ? 'text-slate-900' : 'text-slate-500'}`}>{c.label}</span>
                  <Move i={i} n={ui.admin.pages.length} onMove={moveIn('admin')} name={c.label} />
                </div>
              );
            })}
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-fs-14 font-semibold text-slate-700">
              <Lock size={16} /> Setup — always shown to the admin
            </div>
          </div>
        </Card>
      )}

      {tab === 'refresh' && (
        // 23-11-2026: how often the screens read new data — every login, every PC (Live lines / TV keep their own timing)
        <div className="grid gap-3 xl:grid-cols-2 items-start">
          <Card title="Screen refresh" sub="How often the screens refresh their data automatically. A shorter time shows changes sooner but asks the line servers more often. Saved for every login; a screen picks it up within a minute.">
            <div className="divide-y divide-slate-100" data-testid="refresh-setup">
              {[
                ['ole', 'OLE, quality, entry & report dashboards', 'OLE overview, calendar, availability, performance, quality, rework, RCA, entry dashboard, customer production …', [10, 15, 20, 30, 60, 120, 300]],
                ['dash', 'Dashboard & line pages (live)', 'Dashboard, hourly analysis, cycle time and the other line pages while LIVE is on', [5, 10, 15, 30, 60]],
                ['masters', 'Targets, shifts & settings', 'Line targets, shift & lunch, the administrator\'s settings — when another login changes them', [30, 60, 120, 300, 600]],
              ].map(([k, l, about, opts]) => (
                <label key={k} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-fs-15 font-bold text-slate-900">{l}</span>
                    <span className="block text-fs-12 text-slate-600">{about}</span>
                  </span>
                  <select value={ui.refresh[k]} aria-label={`Refresh ${l}`} onChange={(e) => { const v = Number(e.target.value); set((u) => { u.refresh = { ...u.refresh, [k]: v }; return u; }); }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-fs-14 font-bold">
                    {[...new Set([...opts, ui.refresh[k]])].sort((x, y) => x - y).map((sec) => <option key={sec} value={sec}>{sec < 60 ? `${sec} seconds` : `${sec / 60} minute${sec === 60 ? '' : 's'}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => set((u) => { u.refresh = { ole: 20, dash: 10, masters: 60 }; return u; })} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">Standard (20 s · 10 s · 1 min)</button>
              <button type="button" onClick={() => set((u) => { u.refresh = { ole: 60, dash: 30, masters: 300 }; return u; })} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">Light on the servers (1 min · 30 s · 5 min)</button>
            </div>
          </Card>
          <Card title="Other screens" sub="These keep their own timing.">
            <ul className="list-disc space-y-1.5 pl-5 text-fs-14 text-slate-700">
              <li><b>Plant overview</b>: every {ui.management.oneView.refreshSec} s — change it in the <button type="button" className="font-bold text-blue-700 underline" onClick={() => setTab('oneview')}>Plant overview</button> tab.</li>
              <li><b>Live lines &amp; TV screens</b>: their own fast timing (not changed here).</li>
              <li>A screen in a hidden browser tab does not read at all; it reads again when it is shown.</li>
            </ul>
          </Card>
        </div>
      )}

      {tab === 'notify' && <NotifySetup ui={ui} set={set} />}

      {tab === 'menu' && <MenuFolders ui={ui} set={set} setUi={(fn) => { setMsg(null); setUi(fn); }} />}

      {tab === 'look' && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
          <div className="space-y-3 min-w-0">
            <ThemeEditor theme={ui.theme} busy={busy} onChange={(t) => { setMsg(null); setUi((u) => ({ ...u, theme: t })); }}
              onApplyStandard={async () => {
                // the standard is saved at once: every page of every screen follows (within a minute, or at once after refresh)
                const { label, ...p } = THEME_PRESETS.oee;
                const n = { ...ui, theme: { ...ui.theme, ...p, preset: 'oee' } };
                setUi(n); setBusy(true); setMsg(null);
                try { const r = await save(n, 'save'); setUi(r); setMsg({ ok: true, text: 'Dixon OEE standard is on every page now.' }); }
                catch (e) { setMsg({ ok: false, text: `Could not save: ${e.message}` }); } finally { setBusy(false); }
              }} />
            <Card title="Name">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-fs-14 font-semibold text-slate-800">Name
                  <input value={ui.brand.name} maxLength={24} onChange={(e) => { const v = e.target.value; setMsg(null); setUi((u) => ({ ...u, brand: { ...u.brand, name: v } })); }}
                    className="block mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-fs-16 font-bold" />
                </label>
                <label className="text-fs-14 font-semibold text-slate-800">Tagline
                  <input value={ui.brand.tagline} maxLength={40} onChange={(e) => { const v = e.target.value; setMsg(null); setUi((u) => ({ ...u, brand: { ...u.brand, tagline: v } })); }}
                    className="block mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-fs-16" />
                </label>
              </div>
            </Card>
          </div>
          <div className="space-y-3 xl:sticky xl:top-3">
            <ThemeSample theme={ui.theme} />
            <MgmtPreview ui={ui} />
          </div>
        </div>
      )}
    </div>
  );
}
