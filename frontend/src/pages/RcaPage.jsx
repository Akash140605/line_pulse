import HeaderBar, { fieldCls } from '../components/HeaderBar';
import MesDrawer from '../components/MesDrawer';
import Evidence from '../components/Evidence';
import React, { useEffect, useMemo, useState } from 'react';
import { Save, X, Wrench, FileDown } from 'lucide-react';
import { capaHead, capaPdf, capaFileName, downloadBlob, EMPTY_CAPA } from '../utils/capaForm';
import { savedUi } from '../hooks/useUiSettings';
import { api } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, issuesOf, rcaStatus, KIND_TEXT, needsRca, RCA_FROM, normEntry } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { RCA_CATS, RCA_CAT_HINT, guessRcaCat, guessDept } from '../utils/deptRules';
import { nf, dmy, p2, inp, card, StatusChip, useOleLines, monthOf, monthRange, useOleData } from '../components/OleParts';

/**
 * RCA — every loss (one reason of planned stoppage / unplanned loss / rejection / rework on one line and day) goes to the department of its reason.
 * The department writes the root cause, corrective and preventive action, owner and target date, then submits; it is
 * closed when the action is done. Who writes: the admin, and logins of that department (Users and passwords → Department).
 */
// one department under one name (Maint = Maintenance, Prod = Production …): no double tabs
const same = (a, b) => deptName(a).toLowerCase() === deptName(b).toLowerCase();

export default function RcaPage({ isAdmin = false, myDept = '' }) {
  const IDS = useOleLines();
  const today = serverToday();
  const [month, setMonth] = useState(monthOf(today));
  const range = monthRange(month, today);
  const settings = useAllLineSettings(IDS);
  const [open, setOpen] = useState(null);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS, paused: !!open });
  // 23-11-2026: RCAs start on RCA_FROM; the older ones are kept (records untouched) and shown with "Older RCAs"
  const [old, setOld] = useState(false);
  const issues = useMemo(() => (D.al ? issuesOf(oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }).days)
    .filter((i) => (old ? i.kind !== 'stop' && i.date < RCA_FROM : needsRca(i))) : []),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, IDS, old]);
  const depts = useMemo(() => [...new Set(issues.map((i) => deptName(i.dept)).filter(Boolean))].sort(), [issues]);
  const [dept, setDept] = useState(myDept || 'all');
  const [status, setStatus] = useState('pending');
  const canWrite = (i) => isAdmin || (myDept && same(myDept, i.dept));
  const shown = issues.filter((i) => (dept === 'all' || same(i.dept, dept)) && (status === 'all' || rcaStatus(D.ent.rca[i.key]) === status));
  const count = (st) => issues.filter((i) => (dept === 'all' || same(i.dept, dept)) && (st === 'all' || rcaStatus(D.ent.rca[i.key]) === st)).length;
  const btn = (on) => `h-9 px-3 text-fs-13 font-semibold border-r last:border-r-0 border-slate-300 whitespace-nowrap ${on ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
  return (
    <div className="flex flex-col gap-4">
      <HeaderBar label="RCA filters">
        <input type="month" aria-label="Choose month" max={monthOf(today)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
        {range.start < RCA_FROM && (
          <button type="button" aria-pressed={old} onClick={() => setOld((v) => !v)} title={`RCAs start on ${RCA_FROM.split('-').reverse().join('-')}; the losses before it are kept and can be seen here`}
            className={`h-9 rounded-lg border px-3 text-fs-13 font-bold whitespace-nowrap ${old ? 'border-amber-600 bg-amber-100 text-amber-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>
            {old ? `Showing older RCAs (before ${RCA_FROM.slice(8, 10)}-${RCA_FROM.slice(5, 7)}) — back to current` : `Older RCAs (before ${RCA_FROM.slice(8, 10)}-${RCA_FROM.slice(5, 7)})`}
          </button>
        )}
        {myDept && <span className="whitespace-nowrap text-fs-13 font-semibold text-slate-600">You write for <b>{myDept}</b></span>}
      </HeaderBar>
      <section className={card} aria-label="RCA">
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Department">
            {['all', ...depts.filter((d) => !same(d, 'all'))].map((d) => <button key={d} type="button" aria-pressed={same(dept, d)} onClick={() => setDept(d)} className={btn(same(dept, d))}>{d === 'all' ? 'All departments' : d}</button>)}
            {myDept && !depts.some((d) => same(d, myDept)) && <button type="button" aria-pressed={same(dept, myDept)} onClick={() => setDept(myDept)} className={btn(same(dept, myDept))}>{myDept}</button>}
          </div>
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-300" role="group" aria-label="Status">
            {[['pending', 'RCA pending'], ['submitted', 'Submitted'], ['closed', 'Closed'], ['all', 'All']].map(([k, t]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={btn(status === k)}>{t} <span className="opacity-70">({count(k)})</span></button>)}
          </div>
        </div>
      </section>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!D.al && !D.err && <div className={`${card} text-fs-14 font-semibold text-slate-500`}>Reading the losses …</div>}
      {D.al && (
        <section className={card} aria-label="Losses for RCA">
          {!shown.length ? <p className="text-fs-14 text-slate-500">Nothing here{status === 'pending' ? ' — no RCA pending' : ''}.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-fs-13 tabular-nums" aria-label="RCA list">
                <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Date', 'Line', 'Loss', 'Reason', 'Department', 'Amount', 'Hours', 'Models', 'Status', 'Root cause / action', ''].map((h, i) => <th key={i} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((i) => {
                    const x = D.ent.rca[i.key]; const st = rcaStatus(x);
                    return (
                      <tr key={i.key} className="border-b border-slate-100 align-top" aria-label={`RCA ${dmy(i.date)} Line ${i.line} ${i.reason}`}>
                        <td className="px-2 py-2 font-bold whitespace-nowrap">{dmy(i.date)}</td>
                        <td className="px-2 py-2 whitespace-nowrap">Line {i.line}</td>
                        <td className="px-2 py-2">{KIND_TEXT[i.kind]}</td>
                        <td className="px-2 py-2 font-bold text-slate-900">{i.reason}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{deptName(i.dept)}</td>
                        <td className="px-2 py-2 font-mono font-bold whitespace-nowrap">{nf(i.value)} {i.unit}</td>
                        <td className="px-2 py-2 font-mono whitespace-nowrap">{[...i.hours].sort((a, b) => a - b).map((h) => `${p2(h)}`).join(', ')}</td>
                        <td className="px-2 py-2">{i.models.join(', ') || '—'}</td>
                        <td className="px-2 py-2"><StatusChip st={st} /></td>
                        <td className="px-2 py-2 text-fs-13 text-slate-700 min-w-[200px]">{x ? <>{x.cat && <span className="mr-1 rounded-full bg-blue-50 px-2 py-0.5 text-fs-11 font-bold text-blue-800">{x.cat}</span>}<b>Cause:</b> {x.rootCause}{x.action && <><br /><b>Action:</b> {x.action}</>}{(x.owner || x.targetDate || x.closeDate) && <div className="text-slate-500">{x.owner}{x.targetDate ? ` · by ${dmy(x.targetDate)}` : ''}{x.closeDate ? ` · closed ${dmy(x.closeDate)}` : ''}</div>}{x.evidence?.length > 0 && <div className="font-semibold text-blue-800">📎 {x.evidence.length} evidence</div>}</> : '—'}</td>
                        <td className="px-2 py-1.5">
                          <button type="button" onClick={() => setOpen(i)} aria-label={`${canWrite(i) ? (x ? 'Edit' : 'Write') : 'View'} RCA ${dmy(i.date)} Line ${i.line} ${i.reason}`}
                            className={`h-8 rounded-lg px-2.5 text-fs-13 font-bold whitespace-nowrap ${canWrite(i) && !x ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-800'}`}>{canWrite(i) ? (x ? 'Edit RCA' : 'Write RCA') : 'View'}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {open && <RcaDialog i={open} x={D.ent.rca[open.key]} canWrite={canWrite(open)} isAdmin={isAdmin} onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await D.reloadEnt(); }} />}
    </div>
  );
}

/**
 * 27-11-2026: what the assembly line wrote about one loss (date, line, kind, reason) — read from the hourly loss entries
 * of that day: pieces / minutes by hour, model and stage, pieces dismantled, and the cause / action / owner written there.
 */
export function lossFacts(entries, i) {
  const o = { value: 0, dis: 0, hours: new Map(), models: new Map(), stages: new Map(), cause: '', action: '', owner: '', found: false };
  const list = { stop: 'stops', loss: 'losses', reject: 'rejects', rework: 'rework' }[i.kind];
  const num = i.kind === 'stop' || i.kind === 'loss' ? 'min' : 'qty';
  const pre = `${i.date}|${Number(i.line)}|`;
  for (const [k, raw] of Object.entries(entries || {})) {
    if (!k.startsWith(pre)) continue;
    const h = Number(k.slice(pre.length)); const e = normEntry(raw);
    for (const x of e[list] || []) {
      if ((x.reason || 'Not given') !== i.reason) continue;
      const v = Number(x[num]) || 0; if (!(v > 0)) continue;
      o.found = true; o.value += v; o.dis += Number(x.dismantle) || 0;
      o.hours.set(h, (o.hours.get(h) || 0) + v);
      if (x.model) o.models.set(x.model, (o.models.get(x.model) || 0) + v);
      if (x.station) o.stages.set(x.station, (o.stages.get(x.station) || 0) + v);
      if (!o.cause && x.cause) o.cause = String(x.cause).trim();
      if (!o.action && x.action) o.action = String(x.action).trim();
      if (!o.owner && x.owner) o.owner = String(x.owner).trim();
    }
  }
  return o;
}
const sortV = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
/** the problem as the line would say it: what, how many, where, which model, when */
export function problemText(i, F) {
  const u = i.kind === 'stop' || i.kind === 'loss' ? 'min' : 'pcs';
  const q = u === 'min' ? `${nf(F.value)} min` : `${nf(F.value)} pcs${F.dis ? ` (${nf(F.value - F.dis)} passed after rework, ${nf(F.dis)} dismantled)` : ''}`;
  const st = sortV(F.stages).map(([s]) => s).join(', ');
  const md = sortV(F.models).map(([m, v]) => `${m} ${nf(v)}`).join(', ');
  const hr = [...F.hours.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => `${p2(h)}:00–${p2(h + 1)}:00 (${nf(v)})`).join(', ');
  return `${KIND_TEXT[i.kind] || 'Loss'}: ${i.reason} — ${q}${st ? ` at ${st}` : ''}, Line ${i.line}, ${dmy(i.date)}${hr ? `, hours ${hr}` : ''}${md ? `. Models: ${md}` : ''}.`;
}

// 27-11-2026: why-why — 3 at least, '+ Why' up to 7
export const MIN_WHY = 3, MAX_WHY = 7;
const nWhy0 = (x) => Math.min(MAX_WHY, Math.max(MIN_WHY, x?.whys?.length || 0, x?.capa?.whyQ?.length || 0));
const whyAsk = (prev) => (String(prev || '').trim() ? `Why ${String(prev).trim().replace(/[.?!]+$/, '')}?` : '');

export function RcaDialog({ i, x, canWrite, isAdmin, onClose, onSaved }) {
  const head = useMemo(() => capaHead(savedUi().capa), []);
  const [f, setF] = useState({ cat: x?.cat || guessRcaCat(i.reason, i.dept || x?.dept), rootCause: x?.rootCause || '', whys: Array.from({ length: nWhy0(x) }, (_, k) => x?.whys?.[k] || ''), action: x?.action || '', preventive: x?.preventive || '', owner: x?.owner || '', targetDate: x?.targetDate || '', closeDate: x?.closeDate || '', status: x?.status || 'submitted', evidence: x?.evidence || [],
    // 24-11-2026: the paper CAPA form (Corrective and Preventive Action Plan)
    capa: { ...EMPTY_CAPA, hall: head.hall, ...(x?.capa || {}), whyQ: Array.from({ length: nWhy0(x) }, (_, k) => x?.capa?.whyQ?.[k] || '') } });
  // 27-11-2026: the assembly line's own record of this loss fills the form (only the boxes still empty)
  const [F, setFacts] = useState(null);
  useEffect(() => {
    let live = true;
    api.oleEntries(i.date, i.date).then((e) => {
      if (!live) return;
      const fx = lossFacts(e?.entries, i); setFacts(fx);
      if (!fx.found) return;
      setF((o) => ({ ...o,
        rootCause: o.rootCause || fx.cause, action: o.action || fx.action, owner: o.owner || fx.owner,
        capa: { ...o.capa, equip: o.capa.equip || sortV(fx.stages).map(([s]) => s).join(', ').slice(0, 80), problem: o.capa.problem || problemText(i, fx).slice(0, 1000),
          correction: o.capa.correction || (i.kind === 'rework' || i.kind === 'reject' ? `Suspect pieces checked and reworked${fx.dis ? `; ${nf(fx.dis)} dismantled` : ''}.` : ''), caResp: o.capa.caResp || o.owner || fx.owner },
      }));
    }).catch(() => setFacts({ found: false }));
    return () => { live = false; };
  }, [i.date, i.line, i.kind, i.reason]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const setC = (k, v) => setF((o) => ({ ...o, capa: { ...o.capa, [k]: v } }));
  const record = () => ({ ...(x || {}), date: i.date, line: Number(i.line), kind: i.kind, reason: i.reason, dept: i.dept || x?.dept, ...f, whys: f.whys.map((w) => w.trim()) });
  const save = async (status) => {
    setErr('');
    // 20-11-2026: 5-Why — the last why written is the root cause when the box is left empty
    const lastWhy = [...f.whys].reverse().find((w) => w.trim()) || '';
    const rootCause = f.rootCause.trim() || lastWhy.trim();
    const answered = f.whys.filter((w) => w.trim()).length;
    if (answered < MIN_WHY) { setErr(`Write at least ${MIN_WHY} whys (why → answer → why again). ${answered} written.`); return; }
    if (!rootCause) { setErr('Write the root cause (or the whys).'); return; }
    if (!RCA_CATS.includes(f.cat)) { setErr('Choose the category of the root cause (6M).'); return; }
    if (status === 'closed' && !f.action.trim()) { setErr('Write the corrective action before closing.'); return; }
    setBusy(true);
    // an empty why question becomes "Why <the answer before>?"
    const capa = { ...f.capa, whyQ: f.whys.map((_, k) => (f.capa.whyQ[k] || '').trim() || (k === 0 ? `Why did ${i.reason} happen?` : whyAsk(f.whys[k - 1]))) };
    try { await api.saveRca([{ date: i.date, line: Number(i.line), kind: i.kind, reason: i.reason, ...f, capa, rootCause, whys: f.whys.map((w) => w.trim()), evidence: f.evidence.map((e) => ({ id: e.id })), closeDate: status === 'closed' ? (f.closeDate || serverToday()) : '', status }]); onSaved(); }
    catch (e) { setErr(`Could not save: ${e.message}`); setBusy(false); }
  };
  const pdf = async () => {
    setPdfBusy(true); setErr('');
    try { const r = record(); downloadBlob(await capaPdf([r], head, api.fileUrl), capaFileName(r)); }
    catch (e) { setErr(`PDF could not be made: ${e.message}`); } finally { setPdfBusy(false); }
  };
  const ta = `${inp} h-auto min-h-[56px] py-1.5`;
  const L = 'grid gap-1 text-fs-13 font-bold text-slate-700';
  const sec = 'grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5';
  const leg = 'px-1 text-fs-13 font-extrabold text-[#1F3864]';
  const hrs = [...(i.hours || [])].sort((a, b) => a - b);
  return (
    <MesDrawer title={<>{KIND_TEXT[i.kind]} · {i.reason}{i.value != null ? <> — {nf(i.value)} {i.unit}</> : null}</>}
      sub={<>Line {i.line} · {dmy(i.date)}{hrs.length ? <> · {hrs.length > 1 ? 'Hours' : 'Hour'} {hrs.map((h) => `${p2(h)}–${p2(h + 1)}`).join(', ')}</> : null}{i.models?.length ? ` · ${i.models.join(', ')}` : ''} · <b>{deptName(i.dept || x?.dept) || guessDept(i.kind, i.reason)}</b></>}
      icon={Wrench} onClose={onClose} label="RCA" method="center" width={58} canExpand={false}>
        <div className="p-4 grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-fs-13 text-slate-600">
            {x && <><StatusChip st={rcaStatus(x)} /> by {x.updatedBy} · {x.updatedAt}{x.closedBy ? ` · closed by ${x.closedBy}` : ''}</>}
            <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-fs-12 font-semibold text-slate-600">{head.title} · Doc {head.docNo}</span>
          </div>
          {/* 27-11-2026: the 6M category of the root cause — one click, required */}
          <fieldset className="grid gap-1.5" aria-label="Category of the root cause (6M)">
            <legend className="text-fs-13 font-bold text-slate-700">Category <span className="font-normal text-slate-500">(6M — what kind of cause)</span></legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {RCA_CATS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={f.cat === c} disabled={!canWrite} title={RCA_CAT_HINT[c]} data-testid={`rca-cat-${c}`}
                  onClick={() => set('cat', c)}
                  className={`h-9 rounded-full border px-3.5 text-fs-13 font-bold transition ${f.cat === c ? 'border-blue-700 bg-blue-700 text-white shadow' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50'}`}>{c}</button>))}
            </div>
            <span className="text-fs-12 text-slate-500">{RCA_CAT_HINT[f.cat] || ''}</span>
          </fieldset>
          {/* 27-11-2026: the assembly line facts of this loss, from the loss entry (read only) */}
          <fieldset className={sec} aria-label="Assembly line details" data-testid="rca-line-facts">
            <legend className={leg}>Assembly line details <span className="font-normal text-slate-500">(from the loss entry)</span></legend>
            {!F ? <span className="text-fs-13 text-slate-500">Reading the loss entry …</span> : !F.found ? <span className="text-fs-13 text-slate-500">No hourly entry found for this {i.kind === 'stop' || i.kind === 'loss' ? 'reason' : 'defect'}.</span> : (
              <div className="grid gap-2 text-fs-13" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
                <div><div className="text-fs-11 font-bold uppercase text-slate-500">Line · date</div><b>Line {i.line}</b> · {dmy(i.date)}</div>
                <div><div className="text-fs-11 font-bold uppercase text-slate-500">Department</div><b>{deptName(i.dept || x?.dept) || guessDept(i.kind, i.reason)}</b></div>
                {i.kind === 'stop' || i.kind === 'loss'
                  ? <div><div className="text-fs-11 font-bold uppercase text-slate-500">Idle time</div><b className="font-mono text-red-700">{nf(F.value)} min</b></div>
                  : <div data-testid="rca-qty"><div className="text-fs-11 font-bold uppercase text-slate-500">Rework · passed · dismantle</div><b className="font-mono text-red-700">{nf(F.value)}</b> · <b className="font-mono text-emerald-700">{nf(F.value - F.dis)}</b> · <b className="font-mono text-amber-700">{nf(F.dis)}</b> pcs</div>}
                <div><div className="text-fs-11 font-bold uppercase text-slate-500">Stage</div>{sortV(F.stages).map(([s, v]) => <div key={s}><b>{s}</b>{F.stages.size > 1 && <span className="font-mono text-slate-500"> · {nf(v)}</span>}</div>)}{!F.stages.size && '—'}</div>
                <div><div className="text-fs-11 font-bold uppercase text-slate-500">Model</div>{sortV(F.models).map(([m, v]) => <div key={m} className="flex justify-between gap-2"><span className="font-mono">{m}</span><b className="font-mono">{nf(v)}</b></div>)}{!F.models.size && '—'}</div>
                <div data-testid="rca-hours"><div className="text-fs-11 font-bold uppercase text-slate-500">Hour</div>{[...F.hours.entries()].sort((a, b) => a[0] - b[0]).map(([h, v]) => <div key={h} className="flex justify-between gap-2"><span className="font-mono">{p2(h)}:00–{p2(h + 1)}:00</span><b className="font-mono">{nf(v)}</b></div>)}</div>
              </div>)}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={L}>Stage / fixture<input disabled={!canWrite} className={inp} value={f.capa.equip} maxLength={80} onChange={(e) => setC('equip', e.target.value)} placeholder="Stage, fixture or tool on the line" aria-label="Stage / fixture" /></label>
            <label className={L}>Hall no.<input disabled={!canWrite} className={inp} value={f.capa.hall} maxLength={40} onChange={(e) => setC('hall', e.target.value)} aria-label="Hall no" /></label>
            <label className={L}>Date<input disabled className={inp} value={dmy(i.date)} aria-label="Date" /></label>
          </div>
          <label className={L}>Identification of problem <span className="font-normal text-slate-500">(what · how many · where · model · hour)</span><textarea disabled={!canWrite} className={ta} value={f.capa.problem} maxLength={1000} onChange={(e) => setC('problem', e.target.value)} placeholder={`${KIND_TEXT[i.kind]}: ${i.reason} — Line ${i.line}, ${dmy(i.date)} (written like this when left empty)`} aria-label="Identification of problem" /></label>
          <label className={L}>Correction / containment <span className="font-normal text-slate-500">(done at once on the line)</span><textarea disabled={!canWrite} className={ta} value={f.capa.correction} maxLength={1000} onChange={(e) => setC('correction', e.target.value)} placeholder={i.kind === 'stop' || i.kind === 'loss' ? 'e.g. material arranged, line restarted, operator shifted' : 'e.g. WIP and line stock checked 100%, suspect pieces segregated and reworked'} aria-label="Correction" /></label>
          <fieldset className={sec} aria-label="Why-why analysis">
            <legend className={leg}>Why-why analysis <span className="font-normal text-slate-500">({f.whys.filter((w) => w.trim()).length} of {MIN_WHY} needed)</span></legend>
            {f.whys.map((w, k) => (
              <div key={k} className="grid items-center gap-1.5" style={{ gridTemplateColumns: '52px minmax(0,1fr) 32px minmax(0,1fr)' }}>
                <span className="text-fs-13 font-extrabold text-[#1F3864]">Why {k + 1}</span>
                <input disabled={!canWrite} className={inp} value={f.capa.whyQ[k]} maxLength={300} aria-label={`Why ${k + 1} question`} placeholder={k === 0 ? (i.kind === 'stop' || i.kind === 'loss' ? 'Why did the line stop?' : `Why did "${i.reason}" come${F?.stages?.size ? ` at ${sortV(F.stages)[0][0]}` : ''}?`) : whyAsk(f.whys[k - 1]) || `Why? (from answer ${k})`}
                  onChange={(e) => setF((o) => ({ ...o, capa: { ...o.capa, whyQ: o.capa.whyQ.map((v, j) => (j === k ? e.target.value : v)) } }))} />
                <span className="text-fs-13 font-bold text-slate-600">Ans.</span>
                <input disabled={!canWrite} className={`${inp} ${k < MIN_WHY && err && !w.trim() ? 'border-red-500 bg-red-50' : ''}`} value={w} maxLength={300} aria-label={`Why ${k + 1} answer`} placeholder={k < MIN_WHY ? 'Answer (needed)' : 'Answer'}
                  onChange={(e) => setF((o) => ({ ...o, whys: o.whys.map((v, j) => (j === k ? e.target.value : v)) }))} />
              </div>
            ))}
            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={f.whys.length >= MAX_WHY} data-testid="why-add" onClick={() => setF((o) => ({ ...o, whys: [...o.whys, ''], capa: { ...o.capa, whyQ: [...o.capa.whyQ, ''] } }))}
                  className="h-8 rounded-lg border border-blue-700 bg-white px-3 text-fs-13 font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-40">+ Why</button>
                {f.whys.length > MIN_WHY && <button type="button" data-testid="why-remove" onClick={() => setF((o) => ({ ...o, whys: o.whys.slice(0, -1), capa: { ...o.capa, whyQ: o.capa.whyQ.slice(0, -1) } }))}
                  className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-600 hover:bg-slate-100">− Remove last</button>}
                <span className="text-fs-12 text-slate-500">{MIN_WHY} whys at least · up to {MAX_WHY} · ask why again on each answer till the real cause comes</span>
              </div>)}
          </fieldset>
          <label className={L}>Root cause <span className="font-normal text-slate-500">(the last answer if left empty)</span><textarea disabled={!canWrite} className={ta} value={f.rootCause} onChange={(e) => set('rootCause', e.target.value)} maxLength={1000} aria-label="Root cause" /></label>
          <fieldset className={sec} aria-label="Implementation of action plan">
            <legend className={leg}>Implementation of action plan</legend>
            <label className={L}>Corrective action<textarea disabled={!canWrite} className={ta} value={f.action} onChange={(e) => set('action', e.target.value)} maxLength={1000} aria-label="Corrective action" /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={L}>Target date<input type="date" disabled={!canWrite} className={inp} value={f.targetDate} onChange={(e) => { set('targetDate', e.target.value); setC('caTarget', e.target.value); }} aria-label="Corrective action target date" /></label>
              <label className={L}>Responsibility<input disabled={!canWrite} className={inp} value={f.owner} maxLength={60} onChange={(e) => { set('owner', e.target.value); setC('caResp', e.target.value); }} aria-label="Corrective action responsibility" /></label>
            </div>
            <label className={L}>Preventive action <span className="font-normal text-slate-500">(so it does not come again)</span><textarea disabled={!canWrite} className={ta} value={f.preventive} onChange={(e) => set('preventive', e.target.value)} maxLength={1000} aria-label="Preventive action" /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={L}>Target date<input type="date" disabled={!canWrite} className={inp} value={f.capa.paTarget} onChange={(e) => setC('paTarget', e.target.value)} aria-label="Preventive action target date" /></label>
              <label className={L}>Responsibility<input disabled={!canWrite} className={inp} value={f.capa.paResp} maxLength={80} onChange={(e) => setC('paResp', e.target.value)} aria-label="Preventive action responsibility" /></label>
            </div>
          </fieldset>
          <fieldset className={sec} aria-label="Verification">
            <legend className={leg}>Verification of implemented action plan</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={L}>Implemented
                <select disabled={!canWrite} className={inp} value={f.capa.implemented} onChange={(e) => setC('implemented', e.target.value)} aria-label="Implemented">
                  <option value="">— not checked yet</option><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option>
                </select></label>
              <label className={L}>Verified by (sign)<input disabled={!canWrite} className={inp} value={f.capa.verifiedBy} maxLength={80} onChange={(e) => setC('verifiedBy', e.target.value)} aria-label="Verified by" /></label>
              <label className={L}>Verified on<input type="date" disabled={!canWrite} className={inp} value={f.capa.verifyDate} max={serverToday()} onChange={(e) => setC('verifyDate', e.target.value)} aria-label="Verified on" /></label>
            </div>
            <label className={L}>Verification note<input disabled={!canWrite} className={inp} value={f.capa.verifyNote} maxLength={300} onChange={(e) => setC('verifyNote', e.target.value)} aria-label="Verification note" /></label>
          </fieldset>
          <label className={L} style={{ maxWidth: 260 }}>Close date <span className="font-normal text-slate-500">(when closed; today if empty)</span><input type="date" disabled={!canWrite} className={inp} value={f.closeDate} max={serverToday()} onChange={(e) => set('closeDate', e.target.value)} aria-label="Close date" /></label>
          <Evidence list={f.evidence} canEdit={canWrite} onChange={(l) => set('evidence', l)} />
          {err && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" disabled={pdfBusy} onClick={pdf} className="mr-auto inline-flex h-10 items-center gap-1.5 rounded-lg border bg-white px-4 text-fs-14 font-bold text-red-700 hover:bg-red-50 disabled:opacity-60" style={{ borderColor: '#B91C1C' }} title="The CAPA form as a PDF, with the evidence photos"><FileDown size={15} aria-hidden />{pdfBusy ? 'Making PDF…' : 'PDF'}</button>
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700">{canWrite ? 'Cancel' : 'Close'}</button>
            {canWrite && <>
              <button type="button" disabled={busy} onClick={() => save('submitted')} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white disabled:opacity-60"><Save size={15} aria-hidden /> Save RCA</button>
              <button type="button" disabled={busy} onClick={() => save('closed')} className="h-10 rounded-lg bg-slate-800 px-4 text-fs-14 font-bold text-white disabled:opacity-60">Save &amp; close RCA{isAdmin ? '' : ' (action done)'}</button>
            </>}
          </div>
        </div>
    </MesDrawer>
  );
}
