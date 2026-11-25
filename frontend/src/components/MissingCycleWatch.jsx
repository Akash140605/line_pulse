import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, X, Save, ExternalLink } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { serverToday } from '../utils/serverTime';
import { targetOf } from '../utils/targets';
import { settingsChanged, useAllLineSettings } from '../hooks/useLineSettings';
import useAutoTargets, { loadAutoTargets } from '../hooks/useAutoTargets';

/**
 * 23-11-2026: a model made today with NO cycle time on its line shows itself (admin only): a card bottom-right with the
 * models, and a small form — cycle time (s) and the lines — that saves it in the Model master AND as the model's target
 * on the line at once (line_settings.json / model_master.json; the line databases are never written).
 * Checked every 2 minutes from the live lines (today's models of each line); "Later" hides a model for the rest of the day.
 */
const EVERY = 120_000;
const MIN_PCS = 3;                   // a model with fewer pieces is a test scan, not a run
const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const hideKey = (d) => `ems.cycleLater.${d}`;
const readHide = (d) => { try { return new Set(JSON.parse(localStorage.getItem(hideKey(d)) || '[]')); } catch { return new Set(); } };
const writeHide = (d, s) => { try { localStorage.setItem(hideKey(d), JSON.stringify([...s])); } catch { /* private mode */ } };

/** today's models of each line without a cycle time: [{ key, line, mmId, model, company, qty }] */
export function missingOf(rows, targetsByLine, minPcs = MIN_PCS) {
  const out = [];
  for (const r of rows || []) {
    if (!r || r.ok === false) continue;
    const line = String(r.line);
    const by = new Map();
    for (const h of r.hourModels || []) {
      if (h.mmId == null) continue;
      const o = by.get(h.mmId) || { mmId: h.mmId, model: h.model || `#${h.mmId}`, company: h.company || '', qty: 0 };
      o.qty += Number(h.qty) || 0; by.set(h.mmId, o);
    }
    for (const m of by.values()) {
      if (m.qty < minPcs || targetOf(targetsByLine?.[line], m.mmId)) continue;
      out.push({ key: `${line}|${m.mmId}`, line, ...m });
    }
  }
  return out.sort((a, b) => b.qty - a.qty);
}

/** one entry per model (company + name): the lines it was made on today, each with its own model id there */
export function groupMissing(list) {
  const m = new Map();
  for (const x of list || []) {
    const k = `${norm(x.company)}|${norm(x.model)}`;
    const o = m.get(k) || { key: k, model: x.model, company: x.company, qty: 0, on: [] };
    o.qty += x.qty; o.on.push({ line: x.line, mmId: x.mmId, qty: x.qty }); m.set(k, o);
  }
  return [...m.values()].map((o) => ({ ...o, on: o.on.sort((a, b) => Number(a.line) - Number(b.line)) })).sort((a, b) => b.qty - a.qty);
}

/** the model in the master: same company + model name (spaces and case ignored) → updated, else added */
export function mergeMaster(rows, { company, model, cycle, lines }) {
  const list = (rows || []).map((r) => ({ ...r }));
  const i = list.findIndex((r) => norm(r.model) === norm(model) && (!r.company || !company || norm(r.company) === norm(company)));
  if (i >= 0) {
    list[i].cycle = cycle;
    list[i].lines = [...new Set([...(list[i].lines || []), ...lines])].sort((a, b) => a - b);
    if (!list[i].company && company) list[i].company = company;
  } else {
    list.unshift({ id: `m${Math.random().toString(36).slice(2, 12)}`, company, model, cycle, lines: [...lines].sort((a, b) => a - b), note: 'Added from the missing cycle time alert', code: '', desc: '', segment: '', capacity: '', type: '' });
  }
  return list;
}

function Form({ m, onDone, onCancel }) {
  const [cycle, setCycle] = useState('');
  const [lines, setLines] = useState(() => m.on.map((x) => Number(x.line)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const c = Number(String(cycle).replace(',', '.'));
  const ok = c > 0 && c < 3600 && lines.length > 0;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const j = await api.modelMaster();
      await api.saveModelMaster(mergeMaster(j?.rows || [], { company: m.company, model: m.model, cycle: c, lines }));
      // 25-11-2026: saved in the Model master → the form closes now (a slow SQL Server kept "Saving…" for a minute);
      // the target on each line it was made on today follows in the background (Method D lines take it from the master anyway)
      onDone();
      (async () => {
        for (const x of m.on.filter((o) => lines.includes(Number(o.line)))) {
          try { await api.saveLineSettings(x.line, { action: 'targets', items: [{ mmId: x.mmId, cycle: c, model: m.model, company: m.company, manual: true, source: 'master' }] }); } catch { /* the master has it */ }
        }
        settingsChanged(); loadAutoTargets(true).catch(() => {});
      })();
    } catch (e) { setErr(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5" data-testid="cycle-form">
      <label className="block text-fs-12 font-bold text-slate-700">Cycle time (seconds per piece)
        <input autoFocus type="number" min={1} step={0.1} value={cycle} onChange={(e) => setCycle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) save(); }}
          aria-label={`Cycle time of ${m.model}`} className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-white px-2 font-mono text-fs-15 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
      </label>
      {c > 0 && <div className="mt-1 text-fs-12 text-slate-600">= {Math.round(3600 / c)} pcs per hour</div>}
      <div className="mt-2 text-fs-12 font-bold text-slate-700">Runs on</div>
      <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Lines of the model">
        {LINE_IDS.map(Number).map((l) => (
          <button key={l} type="button" aria-pressed={lines.includes(l)} onClick={() => setLines((x) => (x.includes(l) ? x.filter((y) => y !== l) : [...x, l]))}
            className={`h-7 rounded-md border px-2 text-fs-12 font-bold ${lines.includes(l) ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>Line {l}</button>
        ))}
      </div>
      {err && <p role="alert" className="mt-2 text-fs-12 font-semibold text-red-700">{err}</p>}
      <div className="mt-2.5 flex gap-2">
        <button type="button" disabled={!ok || busy} onClick={save} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-700 px-3 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={14} aria-hidden />{busy ? 'Saving… (up to a minute)' : 'Save in Model master'}</button>
        <button type="button" onClick={onCancel} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
      </div>
    </div>
  );
}

export default function MissingCycleWatch({ onOpenMaster = null }) {
  const today = serverToday();
  const LINES = useMemo(() => LINE_IDS.map(String), [LINE_IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps -- follows the login's lines
  // the targets the screens use: saved + the target method's (A / D …) — a model is missing only when no screen has a target
  const sets = useAllLineSettings(LINES);
  const auto = useAutoTargets();
  const [live, setLive] = useState(null);     // today's rows of the lines (live_lines)
  const [hide, setHide] = useState(() => readHide(today));
  const [open, setOpen] = useState(null);     // key of the model whose form is open
  const [done, setDone] = useState([]);       // saved in this session
  const busy = useRef(false);
  useEffect(() => { setHide(readHide(today)); }, [today]);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const rows = await Promise.allSettled(LINES.map((l) => api.liveLinesOne(l, { cmin: 1, cmax: 22 })));
        const r = rows.flatMap((x) => (x.status === 'fulfilled' ? x.value?.lines || [] : [])).filter((x) => !x.day || x.day === today);
        if (alive) setLive(r);
      } catch { /* the next round tries again */ } finally { busy.current = false; }
    };
    const t0 = setTimeout(check, 6000);
    const id = setInterval(check, EVERY);
    return () => { alive = false; clearTimeout(t0); clearInterval(id); };
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    if (!live || !auto) return [];   // the target methods not worked out yet: nothing is judged (no false alarm)
    return missingOf(live, Object.fromEntries(LINES.map((l) => [l, sets[l]?.targets || {}])));
  }, [live, auto, sets, LINES]);
  const shown = useMemo(() => groupMissing(list).filter((m) => !hide.has(m.key) && !done.includes(m.key)), [list, hide, done]);
  const [panel, setPanel] = useState(false);   // the list open (else a small pill bottom-right)
  const seenRef = useRef(null);
  useEffect(() => {   // a model not seen before (this browser, today) opens the list once by itself
    if (!shown.length) return;
    const k = `ems.cycleSeen.${today}`;
    let seen; try { seen = new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { seen = new Set(); }
    const fresh = shown.filter((m) => !seen.has(m.key));
    if (fresh.length && seenRef.current !== null) setPanel(true);
    if (seenRef.current === null && fresh.length && fresh.length <= 3) setPanel(true);
    seenRef.current = true;
    fresh.forEach((m) => seen.add(m.key));
    try { localStorage.setItem(k, JSON.stringify([...seen])); } catch { /* private mode */ }
  }, [shown.map((m) => m.key).join(','), today]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown.length) return null;
  const inBar = typeof window !== 'undefined' && window.innerWidth >= 768 && document.body.classList.contains('lp-has-status');
  const later = (k) => { const s = new Set(hide); s.add(k); setHide(s); writeHide(today, s); if (open === k) setOpen(null); };
  const laterAll = () => { const s = new Set(hide); shown.forEach((m) => s.add(m.key)); setHide(s); writeHide(today, s); setOpen(null); };
  const title = shown.length === 1 ? '1 model without cycle time' : `${shown.length} models without cycle time`;
  if (!panel) {
    return (
      <button type="button" onClick={() => setPanel(true)} data-testid="missing-cycle-pill" title="Made today without a cycle time — click to add it"
        // 23-11-2026: sits in the bottom status bar (it covered tables when it floated over the page); phones have no status bar
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-400 bg-amber-50 px-2.5 text-fs-12 font-bold text-amber-900 shadow hover:bg-amber-100"
        style={inBar ? { position: 'fixed', right: 370, bottom: 3, height: 22, zIndex: 31 } : { position: 'fixed', left: 12, bottom: 12, height: 30, zIndex: 60 }}>
        <AlertTriangle size={13} className="text-amber-600" aria-hidden />{title}
      </button>
    );
  }
  return (
    <aside className="rounded-xl border-2 border-amber-400 bg-white shadow-2xl" style={{ position: 'fixed', ...(inBar ? { right: 370, bottom: 34 } : { left: 12, bottom: 48 }), zIndex: 60, width: 360, maxWidth: 'calc(100vw - 2rem)' }} role="alertdialog" aria-label="Models without cycle time" data-testid="missing-cycle">
      <div className="flex items-start gap-2 bg-amber-50 px-3 py-2" style={{ borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-fs-14 font-extrabold text-amber-900">{title}</div>
          <div className="text-fs-12 text-amber-800">Made today, so it has no target. Add its cycle time once — it is saved in the Model master.</div>
        </div>
        {onOpenMaster && <button type="button" onClick={onOpenMaster} title="Open Model master" className="shrink-0 rounded p-1 text-amber-800 hover:bg-amber-100"><ExternalLink size={15} aria-hidden /><span className="sr-only">Open Model master</span></button>}
        <button type="button" onClick={() => { setPanel(false); setOpen(null); }} title="Make small" aria-label="Make small" className="shrink-0 rounded p-1 text-amber-800 hover:bg-amber-100"><X size={15} aria-hidden /></button>
      </div>
      <ul className="divide-y divide-slate-100 overflow-y-auto px-3" style={{ maxHeight: '50vh' }}>
        {shown.slice(0, 8).map((m) => (
          <li key={m.key} className="py-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-fs-14 font-bold text-slate-900" title={m.model}>{m.model}</div>
                <div className="text-fs-12 text-slate-600">{m.company || '—'} · {m.on.map((x) => `Line ${x.line}`).join(', ')} · <b>{m.qty}</b> pcs today</div>
              </div>
              {open !== m.key && <button type="button" onClick={() => setOpen(m.key)} className="shrink-0 rounded-md bg-blue-700 px-2.5 py-1 text-fs-12 font-bold text-white hover:bg-blue-800">Add cycle</button>}
              <button type="button" onClick={() => later(m.key)} title="Hide for today" className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100"><X size={15} aria-hidden /><span className="sr-only">Later</span></button>
            </div>
            {open === m.key && <Form m={m} onCancel={() => setOpen(null)} onDone={() => { setDone((d) => [...d, m.key]); setOpen(null); }} />}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-fs-12">
        <span className="text-slate-500">{shown.length > 8 ? `+ ${shown.length - 8} more` : ''}</span>
        <button type="button" onClick={laterAll} className="font-bold text-slate-600 hover:text-slate-900 hover:underline">Hide all for today</button>
      </div>
    </aside>
  );
}
