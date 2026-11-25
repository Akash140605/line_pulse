import { LINE_COLOR, fs } from '../theme';
import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from 'recharts';
import { Download, RefreshCw, Target, CheckCircle2 } from 'lucide-react';
import { Card, Empty } from '../components/UiKit';
import { api, LINE_IDS } from '../api';
import { useAllLineSettings, settingsChanged } from '../hooks/useLineSettings';
import { currentRule, ruleOpts, loadMaster } from '../hooks/useAutoTargets';
import { METHOD_DEFAULTS, methodRows, lineComparison, targetsOf, masterFor } from '../utils/targetMethods';
import { rupees } from '../utils/money';
import { addDays, coKey } from '../utils/mainFilter';
import MultiSelect from '../components/MultiSelect';
import { buildXlsx, downloadXlsx, colName } from '../utils/xlsxWriter';
import CtSummaryDialog from '../components/CtSummaryDialog';

const C = { actual: 'rgb(var(--navy))', A: '#C2410C', B: '#12866F', C: '#7A4FB8', D: '#BE185D', saved: '#94A3B8' };
const TXT = { A: '#9A3412', B: '#0F6B58', C: '#5B3A8E', D: '#9D174D' };
// 20-11-2026: Method D (cycle time of the Model master + allowance) compared too
const METHODS = ['A', 'B', 'C', 'D'];
const BG = { ok: '#DCFCE7', watch: '#FEF3C7', behind: '#FEE2E2' };
const stOf = (p) => (p == null ? null : p >= 100 ? 'ok' : p >= 90 ? 'watch' : 'behind');
const LCOL = LINE_COLOR;
const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
const pc = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const tone = (p) => (p == null ? 'text-slate-500' : p >= 100 ? 'text-sky-700' : p >= 90 ? 'text-slate-700' : 'text-red-700');
const tick = { fontSize: fs(12), fill: '#1E293B' };
const PERIODS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
const numIn = 'h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-fs-14 font-mono font-bold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function exportXlsx(cmp, rows, opts, range) {
  const MS = cmp.methods || METHODS;
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const r0 = (v) => (v == null ? null : Math.round(v));
  const title = (t, n) => ({ rows: [[{ v: t, s: 'title' }], [{ v: `${range.start} to ${range.end} · Method A: most common cycle (gaps ${opts.lowA ?? 1}–${opts.capA} s) · Method B: ${opts.pctB} % of pieces within (gaps ${opts.lowA ?? 1}–${opts.capA} s) · Method C: control chart mean (gaps ${opts.lowA ?? 1}–${opts.capA} s) · Method D: Model master cycle + ${opts.addD ?? 0} s`, s: 'subtitle' }], []], merges: [`A1:${colName(n - 1)}1`, `A2:${colName(n - 1)}2`] });
  const L = [['Line', 12], ['Actual pcs', 12], ...MS.flatMap((m) => [[`Target ${m}`, 12], [`Achieved ${m} %`, 11], [`Short ${m}`, 11], [`Loss ${m} ₹`, 14]]), ['Target in force (by date)', 14], ['Achieved in force %', 12]];
  const s1 = title('Target methods — line comparison', L.length);
  const h1 = s1.rows.length + 1;
  s1.rows.push(L.map(([h]) => ({ v: h, s: 'head' })));
  for (const l of [...cmp.lines, cmp.total]) {
    const tot = l.line === 'all';
    const st = (x) => (tot ? (x === 'dec1' ? 'totalValue' : 'totalInt') : x);
    s1.rows.push([{ v: l.name, s: tot ? 'totalLabel' : 'textBold' }, { v: l.actual, s: st('int') },
      ...MS.flatMap((m) => [{ v: r0(l[m]?.target), s: st('int') }, { v: r1(l[m]?.pct), s: st('dec1') }, { v: r0(l[m]?.short), s: st('int') }, { v: r0(l[m]?.rsTotal), s: st('int') }]),
      { v: r0(l.saved.target), s: st('int') }, { v: r1(l.saved.pct), s: st('dec1') }]);
  }
  const M = [['Line', 8], ['Model', 26], ['Company', 14], ['Qty', 10], [`Eliminated < ${opts.lowA ?? 1} s`, 11], [`Eliminated > ${opts.capA} s`, 11], ...METHODS.flatMap((m) => [[`${m} cycle (s)`, 10], ...(m === 'A' ? [[`A target cycle (+${opts.addA ?? 3} s)`, 12]] : []), [`${m} pcs/hr`, 10], [`${m} valid scans`, 11], [`${m} pieces covered`, 11], [`${m} pieces covered (%)`, 12]]), ['A vs B (%)', 10], ['Saved target (s)', 11]];
  const s2 = title('Target methods — model by model', M.length);
  const h2 = s2.rows.length + 1;
  s2.rows.push(M.map(([h]) => ({ v: h, s: 'head' })));
  for (const r of rows) s2.rows.push([{ v: `Line ${r.line}`, s: 'center' }, { v: r.model, s: 'textBold' }, { v: r.company || '', s: 'text' }, { v: r.qty, s: 'int' }, { v: r.belowLow ?? null, s: 'int' }, { v: r.aboveCap ?? null, s: 'int' },
    ...METHODS.flatMap((m) => [{ v: r[m]?.sec ?? null, s: 'dec1' }, ...(m === 'A' ? [{ v: r.A?.target ?? null, s: 'dec1' }] : []), { v: r0(r[m]?.pph), s: 'int' }, { v: r[m]?.kept ?? null, s: 'int' }, { v: r[m]?.upTo ?? null, s: 'int' }, { v: r1(r[m]?.share), s: 'dec1' }]), { v: r1(r.diffPct), s: 'dec1' }, { v: r.saved ?? null, s: 'dec1' }]);
  // valid scans per method: the filter each one applies before it picks the cycle
  s2.rows.push([], [{ v: `Valid scans = scans kept after the method's filter · A, B and C: gaps ${opts.lowA ?? 1}–${opts.capA} s · covered = valid scans at the method's cycle or faster`, s: 'note' }]);
  const sh = (name, cols, s, hr, n) => ({ name, cols: cols.map(([, w]) => ({ width: w })), rows: s.rows, merges: s.merges, freezeRow: hr, headerRow: hr, autoFilter: n ? `A${hr}:${colName(cols.length - 1)}${hr + n}` : null });
  downloadXlsx(buildXlsx([sh('Line comparison', L, s1, h1, cmp.lines.length + 1), sh('Model comparison', M, s2, h2, rows.length)]), `Target_methods_${range.start}_to_${range.end}.xlsx`);
}

/**
 * Target methods A and B side by side: per line (what the target and achievement would be) and per model (pcs/hr).
 * canApply (admin) can save the targets of one method for the shown lines.
 */
export default function TargetMethodsPage({ latestDate, fixedLine = null, canApply = false }) {
  const [days, setDays] = useState('30');
  const [custom, setCustom] = useState(null);           // { start, end } when dates are typed
  const [coSel, setCoSel] = useState([]);
  const [moSel, setMoSel] = useState([]);
  const [lineSel, setLineSel] = useState(fixedLine || 'all');
  const [opts, setOpts] = useState(() => ({ ...METHOD_DEFAULTS, addD: 0, ...ruleOpts(currentRule()) }));   // start with the target rule in force
  const [masterAt, setMasterAt] = useState(null);
  useEffect(() => { loadMaster().then((t) => setMasterAt(t || Date.now())); }, []);   // Method D: the Model master
  const [cd, setCd] = useState(null);
  const [al, setAl] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [ask, setAsk] = useState(null);
  const [msg, setMsg] = useState('');
  const [ctOpen, setCtOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const settings = useAllLineSettings(LINE_IDS);
  const ctl = useRef(null);
  const range = useMemo(() => custom || ({ start: addDays(latestDate, -(Number(days) - 1)), end: latestDate }), [latestDate, days, custom]);

  const load = async (fresh = false) => {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setLoading(true); setErr('');
    try {
      const [a, b] = await Promise.all([api.controlDataAll(range.start, range.end, { signal: c.signal, fresh }), api.allLinesParallel({ ...range, cmin: 1, cmax: 22 }, { signal: c.signal, fresh })]);
      setCd(a); setAl(b);
    } catch (e) { if (e.name !== 'AbortError') setErr(String(e.message || e)); } finally { if (ctl.current === c) setLoading(false); }
  };
  useEffect(() => { load(false); return () => ctl.current?.abort(); }, [range.start, range.end]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowsAll = useMemo(() => methodRows(cd?.models, opts).map((r) => {
    // Method D: the Model master's cycle time + allowance (a model not in the master has none)
    const mm = masterFor(r); const sec = mm && Number(mm.cycle) > 0 ? Math.round((Number(mm.cycle) + (Number(opts.addD) || 0)) * 10) / 10 : null;
    return { ...r, D: sec ? { sec, master: Number(mm.cycle), pph: 3600 / sec } : null, saved: settings[r.line]?.savedTargets?.[r.mmId]?.cycle ?? null };
  }), [cd, opts, settings, masterAt]);
  const shownLines = lineSel === 'all' ? LINE_IDS : [lineSel];
  const inLines = rowsAll.filter((r) => shownLines.includes(String(r.line)));
  const coOpts = useMemo(() => { const m = new Map(); for (const r of inLines) { const k = coKey(r.company); const o = m.get(k) || { value: k, label: k, count: 0, pcs: 0 }; o.count++; o.pcs += r.qty; m.set(k, o); } return [...m.values()].sort((a, b) => b.pcs - a.pcs); }, [inLines]);
  const moOpts = useMemo(() => { const m = new Map(); for (const r of inLines) { if (coSel.length && !coSel.includes(coKey(r.company))) continue; const o = m.get(r.model) || { value: r.model, label: `${r.model} · ${coKey(r.company)}`, count: 0, pcs: 0 }; o.count++; o.pcs += r.qty; m.set(r.model, o); } return [...m.values()].sort((a, b) => b.pcs - a.pcs); }, [inLines, coSel]);
  const rows = inLines.filter((r) => (!coSel.length || coSel.includes(coKey(r.company))) && (!moSel.length || moSel.includes(r.model)));
  const filtered = coSel.length > 0 || moSel.length > 0;
  const cmp = useMemo(() => (al ? lineComparison((al.lines || []).filter((l) => shownLines.includes(l.line)), settings, rowsAll, { range }) : null), [al, settings, rowsAll, range, lineSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineChart = (cmp?.lines || []).map((l) => ({ name: l.name, Actual: l.actual, ...Object.fromEntries((cmp?.methods || METHODS).flatMap((m) => [[`Target ${m}`, l[m]?.target != null ? Math.round(l[m].target) : null], [`p${m}`, l[m]?.pct]])) }));
  const top = rows.filter((r) => r.A && r.B && r.C).slice(0, 12).map((r) => ({ name: `${r.model}${lineSel === 'all' ? ` · L${r.line}` : ''}`, 'Method A': Math.round(r.A.pph), 'Method B': Math.round(r.B.pph), 'Method C': Math.round(r.C.pph), 'Method D': r.D ? Math.round(r.D.pph) : null }));
  const MS = cmp?.methods || METHODS;   // D only when the master has a cycle for a model of the period

  const apply = async (method) => {
    setBusy(true); setMsg('');
    try {
      let n = 0;
      for (const l of shownLines) {
        const t = targetsOf(rows, l, method);   // only the models shown (company / model filter)
        const items = Object.entries(t).map(([mmId, v]) => ({ mmId: Number(mmId), cycle: v.cycle, model: v.model, company: v.company }));
        if (items.length) { await api.saveLineSettings(l, { action: 'targets', items }); n += items.length; }
      }
      settingsChanged();
      setMsg(`${n} model targets saved from Method ${method}.`);
    } catch (e) { setMsg(`Could not save: ${e.message}`); } finally { setBusy(false); setAsk(null); }
  };
  const setOpt = (k, v, lo, hi) => { const n = Number(v); if (Number.isFinite(n) && n >= lo && n <= hi) setOpts((o) => ({ ...o, [k]: n })); };

  return (
    <div className="flex flex-col gap-3">
      {ctOpen && <CtSummaryDialog rows={rows} opts={opts} range={range} lineText={lineSel === 'all' ? 'All lines' : `Line ${lineSel}`} onClose={() => setCtOpen(false)} />}
      <Card title="A vs B vs C vs D" sub={`${range.start} → ${range.end} · three ways to set the target cycle of each model from its own scans, and D: the cycle time of the Model master.`}
        right={(
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => load(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-fs-13 font-bold hover:bg-slate-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Reload</button>
            <button type="button" disabled={!rows.length} onClick={() => setCtOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 text-white px-3 py-1.5 text-fs-13 font-bold disabled:opacity-50" title="Line · Model · Qty · Max achieved CT % · Method A · Method B · Avg cycle, biggest quantity first"><Download size={14} /> CT summary Excel</button>
            <button type="button" disabled={!cmp} onClick={() => exportXlsx(cmp, rows, opts, range)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 text-white px-3 py-1.5 text-fs-13 font-bold disabled:opacity-50"><Download size={14} /> Export Excel</button>
          </div>
        )}>
        <div className="mt-3 grid md:grid-cols-2 xl:grid-cols-4 gap-2">
          <div className="rounded-xl border-l-4 border-l-[#C2410C] border border-slate-200 bg-slate-50/40 px-3 py-2">
            <div className="font-bold text-fs-14 text-[#9A3412]">Method A — most common cycle</div>
            <div className="text-fs-13 text-slate-700 leading-snug">Gaps below <b>{opts.lowA ?? 1} s</b> (double scans) and above <b>{opts.capA} s</b> (stops, changeovers) are removed. The second in which <b>the most pieces</b> were made, <b>+ {opts.addA ?? 3} s</b> allowance = target cycle. Used automatically on every screen (last 30 days) — target qty and loss are counted against it.</div>
          </div>
          <div className="rounded-xl border-l-4 border-l-[#12866F] border border-slate-200 bg-sky-50/40 px-3 py-2">
            <div className="font-bold text-fs-14 text-[#0F6B58]">Method B — {opts.pctB} % rule</div>
            <div className="text-fs-13 text-slate-700 leading-snug">The target is the cycle time within which <b>{opts.pctB} % of the pieces</b> were made, counted on the same valid scans as Method A and Control charts (gaps above {opts.capA} s removed). More reachable target.</div>
          </div>
          <div className="rounded-xl border-l-4 border-l-[#7A4FB8] border border-slate-200 bg-blue-50/40 px-3 py-2">
            <div className="font-bold text-fs-14 text-[#5B3A8E]">Method C — control chart</div>
            <div className="text-fs-13 text-slate-700 leading-snug">The target is the <b>centre line of the control chart</b>: the average cycle of the gaps from {opts.lowA ?? 1} to {opts.capA} s (same window as Control charts), to 0.1 s. The line's normal running speed.</div>
          </div>
          <div className="rounded-xl border-l-4 border-l-[#BE185D] border border-slate-200 bg-pink-50/40 px-3 py-2">
            <div className="font-bold text-fs-14 text-[#9D174D]">Method D — Model master</div>
            <div className="text-fs-13 text-slate-700 leading-snug">The target is the <b>cycle time in the Model master</b> (Setup → Masters){opts.addD ? <> <b>+ {opts.addD} s</b></> : ''} — not worked out from the scans. A model that is not in the master has no D target (—).</div>
          </div>
        </div>
        {/* lines · period · dates in the top bar, like every page (HeaderBar standard) */}
        <HeaderBar label="Target methods filters">
          {!fixedLine && (
            <div className={segGroup} role="group" aria-label="Line">
              {[['all', 'All lines'], ...LINE_IDS.map((l) => [l, `Line ${l}`])].map(([k, l]) => <button key={k} type="button" aria-pressed={lineSel === k} onClick={() => setLineSel(k)} className={segBtn(lineSel === k, 'navy')}>{l}</button>)}
            </div>
          )}
          <div className={segGroup} role="group" aria-label="Period">
            {PERIODS.map(([k, l]) => <button key={k} type="button" aria-pressed={!custom && days === k} onClick={() => { setCustom(null); setDays(k); }} className={segBtn(!custom && days === k)}>{l}</button>)}
          </div>
          <input type="date" aria-label="From date" className={fieldCls} value={range.start} max={range.end} onChange={(e) => e.target.value && setCustom({ start: e.target.value, end: range.end })} />
          <span className="text-slate-400" aria-hidden>→</span>
          <input type="date" aria-label="To date" className={fieldCls} value={range.end} max={latestDate} onChange={(e) => e.target.value && setCustom({ start: range.start, end: e.target.value })} />
        </HeaderBar>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60"><div className="text-fs-13 font-semibold text-slate-700 mb-1">Company</div><MultiSelect label="Company" options={coOpts} selected={coSel} onChange={(v) => { setCoSel(v); setMoSel([]); }} /></div>
          <div className="w-full sm:w-64"><div className="text-fs-13 font-semibold text-slate-700 mb-1">Model</div><MultiSelect label="Model" options={moOpts} selected={moSel} onChange={setMoSel} /></div>
          <label className="text-fs-13 font-semibold text-slate-700">Remove gaps below (s)<input type="number" min="0" max="60" step="0.1" className={`${numIn} block`} aria-label="Lowest valid gap seconds" title="Gaps shorter than this (double scans, glitches) are eliminated" defaultValue={opts.lowA ?? 1} onBlur={(e) => setOpt('lowA', e.target.value, 0, Math.min(60, opts.capA - 0.1))} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
          <label className="text-fs-13 font-semibold text-slate-700">A: remove gaps above (s)<input type="number" min="5" max="120" className={`${numIn} block`} aria-label="Method A gap limit seconds" defaultValue={opts.capA} onBlur={(e) => setOpt('capA', e.target.value, 5, 120)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
          <label className="text-fs-13 font-semibold text-slate-700">A: allowance added (s)<input type="number" min="0" max="30" className={`${numIn} block`} aria-label="Method A allowance seconds" defaultValue={opts.addA ?? 3} onBlur={(e) => setOpt('addA', e.target.value, 0, 30)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
          <label className="text-fs-13 font-semibold text-slate-700">B: share of pieces (%)<input type="number" min="50" max="95" className={`${numIn} block`} aria-label="Method B percent" defaultValue={opts.pctB} onBlur={(e) => setOpt('pctB', e.target.value, 50, 95)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
          <label className="text-fs-13 font-semibold text-slate-700">D: allowance added (s)<input type="number" min="0" max="30" className={`${numIn} block`} aria-label="Method D allowance seconds" defaultValue={opts.addD ?? 0} onBlur={(e) => setOpt('addD', e.target.value, 0, 30)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
        </div>
        {rows.length > 0 && (() => {
          const g = rows.reduce((x, r) => x + (r.gaps || 0), 0), lo = rows.reduce((x, r) => x + (r.belowLow || 0), 0), hi = rows.reduce((x, r) => x + (r.aboveCap || 0), 0);
          return (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-fs-14 text-amber-950" aria-label="Valid scans">
              <b>Valid scans {opts.lowA ?? 1}–{opts.capA} s</b>
              <span className="font-mono">gaps <b>{g.toLocaleString('en-IN')}</b></span>
              <span className="font-mono">&lt; {opts.lowA ?? 1} s eliminated <b className="text-red-700">{lo.toLocaleString('en-IN')}</b></span>
              <span className="font-mono">&gt; {opts.capA} s eliminated <b className="text-red-700">{hi.toLocaleString('en-IN')}</b></span>
              <span className="font-mono">valid <b className="text-emerald-800">{(g - lo - hi).toLocaleString('en-IN')}</b></span>
            </div>
          );
        })()}
        {canApply && rows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-fs-13 font-semibold text-blue-900">
            <Target size={15} /> Save targets for {lineSel === 'all' ? 'all lines' : `Line ${lineSel}`}:
            {ask ? (
              <>
                <span>Replace the saved targets of {rows.filter((r) => r[ask]).length} models with Method {ask}?</span>
                <button type="button" disabled={busy} onClick={() => apply(ask)} className="rounded-md bg-blue-700 px-2.5 py-1 text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Yes, save'}</button>
                <button type="button" onClick={() => setAsk(null)} className="rounded-md border border-blue-300 px-2.5 py-1 font-bold">Cancel</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setAsk('A')} className="rounded-md bg-[#C2410C] px-2.5 py-1 text-white font-bold">Use Method A</button>
                <button type="button" onClick={() => setAsk('B')} className="rounded-md bg-[#12866F] px-2.5 py-1 text-white font-bold">Use Method B</button>
                <button type="button" onClick={() => setAsk('C')} className="rounded-md bg-[#7A4FB8] px-2.5 py-1 text-white font-bold">Use Method C</button>
                <button type="button" onClick={() => setAsk('D')} className="rounded-md bg-[#BE185D] px-2.5 py-1 text-white font-bold">Use Method D</button>
              </>
            )}
          </div>
        )}
        {msg && <div role="status" className={`mt-2 inline-flex items-center gap-1.5 text-fs-13 font-semibold ${msg.startsWith('Not') ? 'text-red-700' : 'text-sky-700'}`}><CheckCircle2 size={15} />{msg}</div>}
      </Card>

      {err && <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-fs-14 font-semibold text-red-800">{err}</div>}
      {!cmp && !err && <div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading {days} days of scans for every model…</div>}

      {cmp && (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5" aria-label="Method summary">
            {[...MS, 'saved'].map((m) => {
              const t = cmp.total[m]; const st = stOf(t.pct);
              const col = m === 'saved' ? '#475569' : C[m];
              return (
                <div key={m} className="rounded-xl bg-white border border-slate-200 shadow-sm px-4 py-2.5" style={{ borderTop: `5px solid ${col}` }}>
                  <div className="text-fs-14 font-bold" style={{ color: m === 'saved' ? '#334155' : TXT[m] }}>{m === 'saved' ? 'Targets in force (by date)' : `Method ${m} — ${m === 'A' ? 'most common' : m === 'B' ? `${opts.pctB} % rule` : m === 'C' ? 'control chart' : 'Model master'}`}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-fs-30 font-bold" style={{ color: st === 'ok' ? '#15803D' : st === 'watch' ? '#B45309' : st ? '#B91C1C' : '#475569' }}>{pc(t.pct)}</span>
                    <span className="text-fs-13 font-semibold text-slate-600">achieved</span>
                  </div>
                  <div className="text-fs-13 text-slate-700 font-medium">target {nf(t.target)} pcs · short {nf(t.short)}{t.rsTotal != null ? ` · ${rupees(t.rsTotal, { short: true })}` : ''}</div>
                  {m === 'D' && (() => { const all = inLines.reduce((a, r) => a + r.qty, 0), inM = inLines.filter((r) => r.D).reduce((a, r) => a + r.qty, 0); const n = inLines.filter((r) => r.D).length;
                    return <div className={`mt-0.5 text-fs-12 font-semibold ${all && inM / all < 0.8 ? 'text-amber-700' : 'text-slate-500'}`} title="Only the models with a Model master cycle get a D target">Master covers {n} of {inLines.length} models · {all ? Math.round((inM / all) * 100) : 0}% of pieces</div>; })()}
                </div>
              );
            })}
          </div>

          <Card title={`Line-wise: actual vs target ${MS.join(' vs ')}`} sub={`Pieces in the period. The % above each target bar = achievement against that target.${filtered ? ' Line totals use all models (the line time is shared); the model charts below follow the company / model filter.' : ''}`}>
            <div className="h-[300px] mt-2" aria-label="Line comparison chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lineChart} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="name" tick={tick} />
                  <YAxis tick={tick} width={70} tickFormatter={(v) => v.toLocaleString('en-IN')} />
                  <Tooltip formatter={(v) => nf(v)} />
                  <Legend wrapperStyle={{ fontSize: fs(12) }} />
                  <Bar dataKey="Actual" fill={C.actual} isAnimationActive={false}><LabelList dataKey="Actual" position="top" formatter={nf} style={{ fontSize: fs(11), fill: 'rgb(var(--navy))' }} /></Bar>
                  <Bar dataKey="Target A" fill={C.A} isAnimationActive={false}><LabelList dataKey="pA" position="top" formatter={pc} style={{ fontSize: fs(11), fill: '#9A3412', fontWeight: 700 }} /></Bar>
                  <Bar dataKey="Target B" fill={C.B} isAnimationActive={false}><LabelList dataKey="pB" position="top" formatter={pc} style={{ fontSize: fs(11), fill: '#0F6B58', fontWeight: 700 }} /></Bar>
                  <Bar dataKey="Target C" fill={C.C} isAnimationActive={false}><LabelList dataKey="pC" position="top" formatter={pc} style={{ fontSize: fs(11), fill: '#5B3A8E', fontWeight: 700 }} /></Bar>
                  {MS.includes('D') && <Bar dataKey="Target D" fill={C.D} isAnimationActive={false}><LabelList dataKey="pD" position="top" formatter={pc} style={{ fontSize: fs(11), fill: '#9D174D', fontWeight: 700 }} /></Bar>}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-fs-13" aria-label="Line comparison">
                <thead><tr className="text-left text-slate-600 border-b border-slate-200">
                  <th className="px-2.5 py-2 font-semibold">Line</th><th className="px-2.5 py-2 font-semibold text-right">Actual</th>
                  {MS.map((m) => <React.Fragment key={m}><th className="px-2.5 py-2 font-semibold text-right" style={{ color: TXT[m] }}>Target {m}</th><th className="px-2.5 py-2 font-semibold text-right" style={{ color: TXT[m] }}>Achieved {m}</th><th className="px-2.5 py-2 font-semibold text-right" style={{ color: TXT[m] }}>Loss {m}</th></React.Fragment>)}
                  <th className="px-2.5 py-2 font-semibold text-right">In force (by date)</th><th className="px-2.5 py-2 font-semibold text-right">Achieved</th>
                </tr></thead>
                <tbody>
                  {[...cmp.lines, ...(cmp.lines.length > 1 ? [cmp.total] : [])].map((l) => {
                    const tot = l.line === 'all';
                    const loss = (x) => (x.rsTotal != null ? rupees(x.rsTotal, { short: true }) : x.short != null ? `${nf(x.short)} pcs` : '—');
                    return (
                      <tr key={l.line} className={`border-b border-slate-100 font-mono ${tot ? 'bg-slate-100 font-bold' : ''}`}>
                        <td className="px-2.5 py-1.5 font-sans font-bold whitespace-nowrap">{!tot && <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: LCOL[l.line] }} />}{l.name}</td>
                        <td className="px-2.5 text-right">{nf(l.actual)}</td>
                        {MS.map((m) => <React.Fragment key={m}><td className="px-2.5 text-right">{nf(l[m].target)}</td><td className={`px-2.5 text-right font-bold ${tone(l[m].pct)}`} style={{ background: BG[stOf(l[m].pct)] }}>{pc(l[m].pct)}</td><td className="px-2.5 text-right whitespace-nowrap">{loss(l[m])}</td></React.Fragment>)}
                        <td className="px-2.5 text-right">{nf(l.saved.target)}</td><td className={`px-2.5 text-right ${tone(l.saved.pct)}`}>{pc(l.saved.pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Model-wise: pieces per hour" sub={`Top ${top.length} models by quantity — target A, B, C and D in pieces per hour (C = control chart average speed, gaps ${opts.lowA ?? 1}–${opts.capA} s; D = Model master cycle).`}>
            {top.length ? (
              <div className="mt-2" style={{ height: Math.max(260, top.length * 46) }} aria-label="Model comparison chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }} barCategoryGap="18%">
                    <CartesianGrid stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" tick={tick} />
                    <YAxis type="category" dataKey="name" tick={{ ...tick, fontSize: fs(11) }} width={150} interval={0} />
                    <Tooltip formatter={(v) => `${nf(v)} pcs/hr`} />
                    <Legend wrapperStyle={{ fontSize: fs(12) }} />
                    <Bar dataKey="Method A" fill={C.A} isAnimationActive={false}><LabelList dataKey="Method A" position="right" style={{ fontSize: fs(11), fill: '#9A3412' }} /></Bar>
                    <Bar dataKey="Method B" fill={C.B} isAnimationActive={false}><LabelList dataKey="Method B" position="right" style={{ fontSize: fs(11), fill: '#0F6B58' }} /></Bar>
                    <Bar dataKey="Method C" fill={C.C} isAnimationActive={false}><LabelList dataKey="Method C" position="right" style={{ fontSize: fs(11), fill: '#5B3A8E' }} /></Bar>
                    {top.some((x) => x['Method D'] != null) && <Bar dataKey="Method D" fill={C.D} isAnimationActive={false}><LabelList dataKey="Method D" position="right" style={{ fontSize: fs(11), fill: '#9D174D' }} /></Bar>}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty>No model with enough pieces in this period.</Empty>}
          </Card>

          <Card title="All models" sub={`Cycle in seconds per piece; pcs/hr = 3600 ÷ cycle. Valid = scans each method keeps after its filter (A, B and C: gaps ${opts.lowA ?? 1}–${opts.capA} s). Covered = valid scans at the target speed or faster (pcs · %).`}>
            <div className="overflow-auto max-h-[520px] mt-2 border border-slate-200 rounded-lg">
              <table className="w-full text-fs-13" aria-label="Model comparison">
                <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-slate-600 border-b border-slate-200">
                  {['Line', 'Model', 'Qty', 'A cycle (s)', `A target (+${opts.addA ?? 3} s)`, 'A pcs/hr', 'A valid scans', 'A pcs at or faster', 'B cycle (s)', 'B pcs/hr', 'B valid scans', 'B pcs at or faster', 'C cycle (s)', 'C pcs/hr', 'C valid scans', 'C pcs at or faster', 'D master (s)', 'D pcs/hr', 'A vs B %', 'Saved target (s)'].map((h) => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap" style={{ color: TXT[h[0]] && h[1] === ' ' ? TXT[h[0]] : undefined }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.line}-${r.mmId}`} className="border-b border-slate-100 font-mono">
                      <td className="px-2.5 py-1.5 font-sans whitespace-nowrap">L{r.line}</td>
                      <td className="px-2.5 font-sans font-semibold whitespace-nowrap">{r.model}{r.company ? <span className="block text-fs-11 font-normal text-slate-500">{r.company}</span> : null}</td>
                      <td className="px-2.5">{nf(r.qty)}</td>
                      {r.tooFew ? <><td colSpan={14} className="px-2.5 font-sans text-slate-500">too few pieces</td><td className="px-2.5 font-bold whitespace-nowrap" style={{ color: TXT.D }}>{r.D ? `${r.D.sec} s` : '—'}</td><td className="px-2.5">{nf(r.D?.pph)}</td><td className="px-2.5">—</td></> : (
                        <>
                          {['A', 'B', 'C'].map((m) => <React.Fragment key={m}><td className="px-2.5 font-bold whitespace-nowrap" style={{ color: TXT[m] }}>{r[m] ? `${r[m].sec} s` : '—'}</td>{m === 'A' && <td className="px-2.5 whitespace-nowrap"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-extrabold text-slate-950" title={`target cycle = ${r.A?.sec} s + ${r.A?.add} s`}>{r.A ? `${r.A.target} s` : '—'}</span></td>}<td className="px-2.5">{nf(r[m]?.pph)}</td><td className="px-2.5" title={`scans with gaps ${opts.lowA ?? 1}–${opts.capA} s`}>{nf(r[m]?.kept)}</td><td className="px-2.5 whitespace-nowrap" title={`${nf(r[m]?.upTo)} valid scans at ${r[m]?.sec} s or faster`}>{nf(r[m]?.upTo)} · {pc(r[m]?.share)}</td></React.Fragment>)}
                          <td className="px-2.5 font-bold whitespace-nowrap" style={{ color: TXT.D }} title={r.D ? `Model master ${r.D.master} s${opts.addD ? ` + ${opts.addD} s` : ''}` : 'Not in the Model master'}>{r.D ? `${r.D.sec} s` : '—'}</td>
                          <td className="px-2.5">{nf(r.D?.pph)}</td>
                          <td className="px-2.5">{r.diffPct != null ? `${r.diffPct >= 0 ? '+' : ''}${Math.round(r.diffPct)}%` : '—'}</td>
                        </>
                      )}
                      <td className="px-2.5">{r.saved ? `${r.saved} s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
