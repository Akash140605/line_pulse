import { fs } from '../theme';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, LineChart, BarChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, LabelList, ResponsiveContainer, Legend,
} from 'recharts';
import { Download, RefreshCw, ChevronDown, SlidersHorizontal, FileSpreadsheet } from 'lucide-react';
import { Card, Stat, Empty, Segmented } from '../components/UiKit';
import useControlData from '../hooks/useControlData';
import { MODES, RULES, computeWindow, buildSubgroups, controlChart, capability, histogram, hourPattern, secondCounts, mean, median, stdev } from '../utils/spc';
import { lossAnalysis } from '../utils/cycleLoss';
import { periodStart } from '../utils/period';
import { summaryRows, exportSummaryXlsx, lidKey } from '../utils/controlReport';
import { LID, LID_SOURCE } from '../utils/lid';
import LidIcon from './LidIcon';
import { serverNow } from '../utils/serverTime';
import { LINE_IDS } from '../api';

const LS_LID = 'ems.lid';
const readLid = () => { try { return JSON.parse(localStorage.getItem(LS_LID) || '{}'); } catch { return {}; } };
const writeLid = (o) => { try { localStorage.setItem(LS_LID, JSON.stringify(o)); } catch { /* storage unavailable */ } };
// same store as the Standard cycle time page, so a weight typed on either page shows on both
const LS_KG = 'ems.stdcycle.kg';
const readKg = () => { try { return JSON.parse(localStorage.getItem(LS_KG) || '{}'); } catch { return {}; } };
const writeKg = (o) => { try { localStorage.setItem(LS_KG, JSON.stringify(o)); } catch { /* storage unavailable */ } };
const KG_TAG = { manual: 'bg-blue-100 text-blue-800', list: 'bg-emerald-100 text-emerald-800', confirmed: 'bg-emerald-100 text-emerald-800', 'from code': 'bg-amber-100 text-amber-800', series: 'bg-amber-100 text-amber-800', 'not set': 'bg-red-50 text-red-700' };

/* ───────────── formatting helpers ───────────── */
const pad = (n) => String(n).padStart(2, '0');
// setMonth() overflows at month ends (31 Mar − 1 month → "31 Feb" → 3 Mar); periodStart clamps to the month end.
const monthsBack = (latest, n) => periodStart(latest, n);
const f1 = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const sec = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${Number(v).toFixed(d)}s`);
/** compact count for axes and labels: 1250 → 1.3k */
const nf = (v) => (v == null ? '' : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3)}k` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v * 10) / 10));
const int = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
/** seconds → "45.0s" / "12m 05s" / "2h 10m" */
const dur = (s) => {
  if (s == null || Number.isNaN(s)) return '—';
  if (s < 59.95) return `${s.toFixed(1)}s`;
  // round first, then split (59.6 s → "1m 00s", not "0m 60s"; 3599.7 s → "1h 00m", not "59m 60s")
  const r = Math.round(s);
  if (r < 3600) return `${Math.floor(r / 60)}m ${pad(r % 60)}s`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
};

/* ───────────── design tokens ───────────── */
const FONT = { fontFamily: 'inherit' };   // 24-11-2026: the theme font of the software (was Segoe UI)
const NUMFONT = 'inherit';
const tick = { fontSize: fs(13), fill: '#1E293B', fontFamily: NUMFONT };
const AX = { fill: '#334155', fontSize: fs(13), fontWeight: 600, fontFamily: NUMFONT };
const xLab = (t) => ({ value: t, position: 'insideBottom', offset: 0, ...AX });
const yLab = (t) => ({ value: t, angle: -90, position: 'insideLeft', offset: 6, style: { textAnchor: 'middle', ...AX } });
const lblStyle = { fontSize: fs(12), fill: '#334155', fontFamily: NUMFONT };
const inpCls = 'h-9 rounded-md border border-slate-300 bg-white px-2.5 text-fs-14 font-semibold tabular-nums text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const selCls = 'h-9 rounded-md border border-slate-300 bg-white px-2.5 text-fs-14 font-semibold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const thCls = 'px-2.5 py-2 font-semibold whitespace-nowrap text-slate-600';
const btnCls = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-fs-13 font-semibold text-slate-700 hover:bg-slate-50';
const PRESETS = [[1, '1M'], [2, '2M'], [3, '3M'], [4, '4M'], [6, '6M']];
const TABS = [['summary', 'Summary'], ['control', 'Control chart'], ['dist', 'Distribution & loss'], ['data', 'Data & formulas']];
const DEFAULT_MAX = 22; // default maximum cycle (seconds)
const BASIS = {
  valid: 'valid cycles only (within Min–Max)',
  upto: 'all gaps up to Max (valid + below Min)',
  all: 'all gaps, including stops above Max',
};

/* ───────────── small building blocks ───────────── */
function NumInput({ value, onCommit, min = 0, step = 1, w = 'w-20' }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Number(v); if (v !== '' && Number.isFinite(n) && n >= min) onCommit(n); else setV(String(value)); };
  return <input type="number" min={min} step={step} value={v} className={`${inpCls} ${w}`} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

const Field = ({ label, children, hint }) => (
  <label className="flex flex-col gap-1 text-fs-13 font-semibold text-slate-600">
    {label}{children}{hint && <span className="text-fs-12 font-normal text-slate-600">{hint}</span>}
  </label>
);

/** Wide chart area: grows with the number of points so that dense data stays readable (scrolls sideways when needed). */
const Wide = ({ n, per = 24, children }) => (
  <div className="overflow-x-auto"><div style={{ minWidth: Math.max(0, n * per) }}>{children}</div></div>
);

/** Searchable model dropdown. options: [{id,title,sub}] */
function ModelPicker({ value, onChange, options, allLabel, w = 'w-72', placeholder = 'Select model' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = value === 'ALL' ? { title: allLabel } : options.find((o) => String(o.id) === String(value));
  const ql = q.trim().toLowerCase();
  const list = options.filter((o) => !ql || `${o.title} ${o.sub}`.toLowerCase().includes(ql));
  const showAll = allLabel && (!ql || allLabel.toLowerCase().includes(ql) || 'all'.includes(ql));
  const pick = (id) => { onChange(id); setOpen(false); setQ(''); };
  return (
    <div ref={box} className={`relative ${w}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={`${selCls} flex w-full items-center justify-between gap-2 text-left`}>
        <span className="truncate">{cur?.title || placeholder}</span><ChevronDown size={14} className="shrink-0 text-slate-600" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[20rem] rounded-lg border border-slate-300 bg-white p-2 shadow-2xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${options.length} models…`}
            className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-fs-14 font-medium outline-none focus:border-blue-600" />
          <div className="mt-2 max-h-72 space-y-0.5 overflow-auto">
            {showAll && (
              <button type="button" onClick={() => pick('ALL')} className={`w-full rounded-md px-2.5 py-1.5 text-left ${value === 'ALL' ? 'bg-blue-100' : 'hover:bg-slate-100'}`}>
                <div className="text-fs-14 font-bold text-blue-700">{allLabel}</div>
                <div className="text-fs-13 text-slate-600">All models together · {options.length} models</div>
              </button>
            )}
            {list.map((o) => (
              <button key={o.id} type="button" onClick={() => pick(o.id)} className={`w-full rounded-md px-2.5 py-1.5 text-left ${String(o.id) === String(value) ? 'bg-blue-100' : 'hover:bg-slate-100'}`}>
                <div className="break-words text-fs-14 font-semibold text-slate-900">{o.title}</div>
                <div className="break-words text-fs-13 text-slate-600">{o.sub}</div>
              </button>
            ))}
            {!showAll && !list.length && <div className="px-2.5 py-3 text-fs-13 text-slate-600">No matching model.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** colour key printed under a chart */
const ChartKey = ({ items }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-1.5 text-fs-13 font-medium text-slate-600">
    {items.map(([c, l, dash]) => (
      <span key={l} className="inline-flex items-center gap-1.5">
        <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={c} strokeWidth="2.5" strokeDasharray={dash || ''} /></svg>{l}
      </span>
    ))}
  </div>
);

const Note = ({ children }) => <div className="px-1 pt-1 text-fs-13 text-slate-600">{children}</div>;

/* ───────────── chart pieces ───────────── */
const SigDot = ({ cx, cy, payload, compact }) => {
  if (cx == null || cy == null || payload?.x == null) return null;
  const r1 = payload.rules?.includes('R1'), any = payload.rules?.length;
  if (compact && !any) return null;
  return <circle cx={cx} cy={cy} r={r1 ? 6.5 : any ? 5.5 : 4} fill={r1 ? '#B42318' : any ? '#C9821A' : payload.excluded ? '#94A3B8' : 'rgb(var(--navy))'} stroke="#fff" strokeWidth={1.8} />;
};

function CtlTip({ active, payload, unit = 's' }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[210px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-fs-13 shadow-xl">
      <div className="mb-1 font-bold text-slate-900">{p.label}{p.hr != null ? ` · ${pad(p.hr)}:00` : ''}</div>
      {[['Mean', f1(p.x, 2) + unit], p.n != null && ['Valid cycles', p.n], p.sd != null && ['σ', f1(p.sd, 2) + unit], ['UCL', f1(p.ucl, 2) + unit], ['CL', f1(p.cl, 2) + unit], ['LCL', f1(p.lcl, 2) + unit], ['z-score', f1(p.z, 2)]]
        .filter(Boolean).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><span className="text-slate-600">{k}</span><span className="font-semibold tabular-nums">{v}</span></div>)}
      {p.excluded && <div className="mt-1 text-slate-600">Excluded from limit calculation</div>}
      {p.rules?.length > 0 && <div className="mt-1.5 border-t border-slate-200 pt-1.5 font-semibold text-red-600">{p.rules.map((r) => <div key={r}>{r}: {RULES[r]}</div>)}</div>}
    </div>
  );
}

/** Mean-cycle control chart: green zone = normal (±2σ), amber = warning (2–3σ), limits labelled on the right. */
function MeansChart({ rows, method, std, takt, compact = false, height = 440, xFmt, xTitle, yTitle, per = 20 }) {
  const stepType = method === 'sigma' ? 'stepAfter' : 'linear';
  const lim = rows.filter((r) => r.ucl != null);
  const r0 = lim[0] || {};
  const flat = lim.length > 0 && lim.every((r) => Math.abs(r.ucl - r0.ucl) < 1e-9 && Math.abs(r.lcl - r0.lcl) < 1e-9);
  const vals = rows.flatMap((r) => [r.x, r.ucl, r.lcl]).concat(std > 0 ? [std] : [], takt > 0 ? [takt] : []).filter((v) => Number.isFinite(v));
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const padY = (hi - lo) * 0.1 || 0.5;
  const showVals = !compact && rows.length <= 31;
  const band = (key, color, dash, w = 1) => <Line dataKey={key} stroke={color} strokeDasharray={dash} strokeWidth={w} dot={false} activeDot={false} isAnimationActive={false} type={stepType} legendType="none" />;
  const lab = (t, c) => ({ value: t, position: 'right', fill: c, fontSize: fs(12), fontWeight: 700 });
  return (
    <>
      <Wide n={rows.length} per={per}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={rows} margin={{ top: 18, right: 104, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#EEF2F7" vertical={false} />
            {flat && <ReferenceArea y1={r0.l2} y2={r0.u2} fill="#12866F" fillOpacity={0.07} ifOverflow="extendDomain" />}
            {flat && <ReferenceArea y1={r0.u2} y2={r0.ucl} fill="#C9821A" fillOpacity={0.1} />}
            {flat && <ReferenceArea y1={r0.lcl} y2={r0.l2} fill="#C9821A" fillOpacity={0.1} />}
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={28} tickFormatter={xFmt} height={50} label={xLab(xTitle)} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={70} domain={[Math.max(0, lo - padY), hi + padY]} tickFormatter={(v) => v.toFixed(1)} label={yLab(yTitle)} />
            <Tooltip content={<CtlTip />} />
            {flat ? (
              <>
                <ReferenceLine y={r0.ucl} stroke="#B42318" strokeDasharray="6 3" strokeWidth={1.8} label={lab(`UCL ${f1(r0.ucl, 2)}`, '#B42318')} />
                <ReferenceLine y={r0.cl} stroke="#12866F" strokeWidth={2} label={lab(`CL ${f1(r0.cl, 2)}`, '#12866F')} />
                <ReferenceLine y={r0.lcl} stroke="#B42318" strokeDasharray="6 3" strokeWidth={1.8} label={lab(`LCL ${f1(r0.lcl, 2)}`, '#B42318')} />
              </>
            ) : (
              <>
                {band('u2', '#C9821A', '3 4')}{band('l2', '#C9821A', '3 4')}
                {band('ucl', '#B42318', '6 3', 2)}{band('lcl', '#B42318', '6 3', 2)}
                <Line dataKey="cl" stroke="#12866F" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} type={stepType} legendType="none" />
              </>
            )}
            {std > 0 && <ReferenceLine y={std} stroke="#7A4FB8" strokeDasharray="7 4" strokeWidth={2} label={lab(`Standard ${f1(std)}s`, '#7A4FB8')} />}
            {takt > 0 && <ReferenceLine y={takt} stroke="rgb(var(--navy))" strokeDasharray="2 3" strokeWidth={2} label={lab(`Takt ${f1(takt)}s`, 'rgb(var(--navy))')} />}
            <Line dataKey="x" stroke="rgb(var(--navy))" strokeWidth={compact ? 1.2 : 2.2} dot={<SigDot compact={compact} />} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls>
              {showVals && <LabelList dataKey="x" position="top" offset={9} formatter={(v) => (v == null ? '' : f1(v, 1))} style={{ fontSize: fs(11), fill: '#334155', fontFamily: NUMFONT }} />}
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </Wide>
      <ChartKey items={[['rgb(var(--navy))', 'Mean cycle'], ['#12866F', 'Centre line'], ['#B42318', 'Control limits (±3σ)', '6 3'],
        ...(flat ? [] : [['#C9821A', 'Warning (±2σ)', '3 4']]), ...(std > 0 ? [['#7A4FB8', 'Standard cycle', '7 4']] : []), ...(takt > 0 ? [['rgb(var(--navy))', 'Takt', '2 3']] : [])]} />
      {flat && <Note><span className="inline-block h-2.5 w-3 rounded-sm bg-[#12866F]/20 align-middle" /> normal zone (±2σ) · <span className="inline-block h-2.5 w-3 rounded-sm bg-[#C9821A]/25 align-middle" /> warning zone (2–3σ) · <span className="font-semibold text-red-700">red dot</span> = outside the limits · amber dot = other rule.</Note>}
    </>
  );
}

function DispersionChart({ disp, method, xFmt, xTitle }) {
  if (!disp?.length) return <Empty>Not enough subgroups.</Empty>;
  const stepType = method === 'sigma' ? 'stepAfter' : 'linear';
  return (
    <Wide n={disp.length} per={20}>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={disp} margin={{ top: 10, right: 96, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="label" tick={tick} tickLine={false} interval="preserveStartEnd" minTickGap={28} tickFormatter={xFmt} height={50} label={xLab(xTitle)} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => v.toFixed(1)}
            label={yLab(method === 'sigma' ? 'Within-subgroup σ (s)' : 'Change vs previous subgroup (s)')} />
          <Tooltip formatter={(v) => f1(v, 2)} labelFormatter={(l) => l} />
          <Line dataKey="ucl" name="UCL" stroke="#DC2626" strokeDasharray="6 3" strokeWidth={2} dot={false} isAnimationActive={false} type={stepType} />
          <Line dataKey="cl" name="CL" stroke="#16A34A" strokeWidth={2} dot={false} isAnimationActive={false} type={stepType} />
          <Line dataKey="v" name={method === 'sigma' ? 'Subgroup σ' : 'Moving range'} stroke="#7C3AED" strokeWidth={2}
            dot={({ cx, cy, payload }) => (cx == null ? null : <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={payload.v > payload.ucl ? 5.5 : 3} fill={payload.v > payload.ucl ? '#DC2626' : '#7C3AED'} stroke="#fff" strokeWidth={1.2} />)}
            isAnimationActive={false} />
          <Legend wrapperStyle={{ fontSize: fs(13) }} />
        </LineChart>
      </ResponsiveContainer>
    </Wide>
  );
}

function Histo({ h, win, mean: mu, std }) {
  if (!h) return <Empty />;
  const marks = [
    Number.isFinite(win.lo) && win.lo > 0 && { v: win.lo, c: '#DC2626', t: `Min ${f1(win.lo)}s` },
    Number.isFinite(win.hi) && { v: win.hi, c: '#DC2626', t: `Max ${f1(win.hi)}s` },
    mu != null && { v: mu, c: '#16A34A', t: `Mean ${f1(mu)}s` },
    std > 0 && { v: std, c: '#7C3AED', t: `Std ${f1(std)}s` },
  ].filter(Boolean);
  return (
    <>
      <Wide n={h.bins.length} per={22}>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={h.bins} margin={{ top: 26, right: 12, left: 4, bottom: 4 }} barCategoryGap={1}>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tick={tick} tickLine={false} interval="preserveStartEnd" minTickGap={14} height={50} label={xLab(`Scan gap, start of each ${h.width}s bucket (s)`)} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={70} allowDecimals={false} tickFormatter={nf} label={yLab('Number of gaps')} />
            <Tooltip formatter={(v, n) => [int(v), n === 'inside' ? 'Valid cycles' : 'Removed (outside Min–Max)']} labelFormatter={(l) => `${l}s – ${Number(l) + h.width}s`} />
            <Bar dataKey="inside" stackId="a" fill="#14B8A6" name="inside" maxBarSize={1000} />
            <Bar dataKey="outside" stackId="a" fill="#CBD5E1" name="outside" maxBarSize={1000} />
            {marks.map((m) => <ReferenceLine key={m.t} x={h.labelFor(m.v)} stroke={m.c} strokeWidth={2} strokeDasharray="5 3" label={{ value: m.t, position: 'top', fill: m.c, fontSize: fs(13), fontWeight: 700 }} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </Wide>
      <ChartKey items={[['#14B8A6', 'Valid cycles (inside Min–Max)'], ['#CBD5E1', 'Removed outliers']]} />
      <Note>Bucket width {h.width}s{h.beyond > 0 ? ` · ${int(h.beyond)} gaps beyond the chart range are not drawn` : ''}.</Note>
    </>
  );
}

const Num = ({ children }) => <b className="tabular-nums text-slate-950">{children}</b>;

/* ───────────── per-second distribution and loss vs target ───────────── */
function SecondDist({ a, maxSec, defTarget, defSrc, canSet, onSetStd, simple = false }) {
  const days = a.m.days, win = a.win;
  const [pick, setPick] = useState(null);
  const [tgt, setTgt] = useState(null);
  const [basis, setBasis] = useState('valid');
  useEffect(() => { setPick(null); }, [days]);
  useEffect(() => { setTgt(null); }, [a.m.mmId]);
  const target = tgt ?? defTarget;

  const sc = useMemo(() => secondCounts(days, win, maxSec), [days, win, maxSec]);
  const L = useMemo(() => lossAnalysis(days, win, maxSec, target, basis, null), [days, win, maxSec, target, basis]);
  const Ls = useMemo(() => (pick != null ? lossAnalysis(days, win, maxSec, target, basis, pick) : null), [days, win, maxSec, target, basis, pick]);
  const R = Ls || L;
  const sel = pick != null ? sc.bins[pick] : null;
  const lossBin = pick != null ? L.bins[pick] : null;
  const big = sc.total > 2000; // dense data: drop per-bar labels, rely on axis

  const rows = useMemo(() => {
    let run = 0;
    return sc.bins.map((b) => { run += b.count; return { ...b, share: sc.total ? (b.count / sc.total) * 100 : 0, cum: sc.total ? (run / sc.total) * 100 : 0 }; });
  }, [sc]);
  const hrRows = sel ? Object.keys(sel.hours).map(Number).sort((x, y) => x - y).map((h) => ({ label: `${pad(h)}-${pad(h + 1)}`, n: sel.hours[h] })) : [];
  const dayRows = sel ? Object.entries(sel.days).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)) : [];
  const togglePick = (s) => setPick((p) => (p === s ? null : s));
  const lossRows = L.bins.filter((b) => b.slowN > 0);
  const hourLoss = R.hours.map((h) => ({ label: `${pad(h.hour)}-${pad(h.hour + 1)}`, min: h.loss / 60, slowN: h.slowN, n: h.n }));
  const tg = f1(target);

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Total gaps" value={int(sc.total)} sub="valid + removed + above Max" bar="bg-slate-400" />
        <Stat label="Valid cycles" value={int(sc.valid)} sub={`${f1(sc.total ? (sc.valid / sc.total) * 100 : 0)}% of total`} tone="text-teal-700" bar="bg-teal-500" />
        <Stat label={`Removed (≤ ${maxSec}s)`} value={int(sc.removed)} sub="below Min or outside window" bar="bg-slate-400" />
        <Stat label={`Above ${maxSec}s`} value={int(sc.above)} sub={`${f1(sc.total ? (sc.above / sc.total) * 100 : 0)}% of total`} tone={sc.above ? 'text-red-600' : 'text-slate-900'} bar="bg-red-500" />
      </div>

      {(() => {
        // display: leading empty seconds trimmed; valid cycles split at the target (fast = at or under target)
        const first = sc.bins.findIndex((x) => x.count > 0);
        const from = Math.max(0, (first < 0 ? 0 : first) - 1);
        const tSec = Math.ceil(target);
        let run = 0;
        const shown = sc.bins.slice(from).map((x) => {
          run += x.over ? 0 : x.valid;
          const fast = !x.over && x.sec <= tSec ? x.valid : 0;
          return { ...x, fast, slow: x.valid - fast, cumV: sc.valid ? (run / sc.valid) * 100 : 0 };
        });
        const mode = shown.filter((x) => !x.over).reduce((m, x) => (x.valid > (m?.valid || 0) ? x : m), null);
        const p70 = shown.find((x) => !x.over && x.cumV >= 70);
        return (
          <>
            <div className="mb-2 flex flex-wrap gap-2 text-fs-13">
              {mode && <span className="rounded-full bg-dixon-navy px-2.5 py-1 font-semibold text-white">Most common: <b>{mode.label}</b> ({int(mode.valid)} cycles)</span>}
              {p70 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200">70% of valid cycles by <b>{p70.label}</b></span>}
              {a.mu != null && <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">Mean {f1(a.mu)}s · median {f1(a.med)}s</span>}
              {target > 0 && <span className="rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-800 ring-1 ring-violet-200">Target {tg}s: {f1(sc.valid ? (shown.reduce((t, x) => t + x.fast, 0) / sc.valid) * 100 : 0, 0)}% of valid cycles at or under</span>}
            </div>
            <Wide n={shown.length} per={big ? 40 : 36}>
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart data={shown} margin={{ top: 26, right: 8, left: 4, bottom: 4 }} barCategoryGap={4}
                  onClick={(st) => { const p = st?.activePayload?.[0]?.payload; if (p) togglePick(p.sec); }} style={{ cursor: 'pointer' }}>
                  <CartesianGrid stroke="#EEF2F7" vertical={false} />
                  <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval={shown.length > 40 ? 'preserveStartEnd' : 0} minTickGap={8} height={50} label={xLab('Cycle time in seconds ("15s" = 14.1–15.0 s)')} />
                  <YAxis yAxisId="n" tick={tick} tickLine={false} axisLine={false} width={64} allowDecimals={false} tickFormatter={nf} label={yLab('Cycles')} />
                  <YAxis yAxisId="c" orientation="right" domain={[0, 100]} ticks={[0, 25, 50, 70, 100]} tick={{ ...tick, fontSize: fs(12) }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v, n) => (n === 'cumV' ? [`${f1(v, 0)}%`, 'Cumulative valid'] : [int(v), { fast: 'Valid, at or under target', slow: 'Valid, slower than target', removed: 'Removed', above: `Above ${maxSec}s` }[n] || n])} labelFormatter={(l) => `Cycle ${l}`} />
                  {sel && <ReferenceArea yAxisId="n" x1={sel.label} x2={sel.label} fill="#2F6FD0" fillOpacity={0.12} />}
                  <ReferenceLine yAxisId="c" y={70} stroke="#12866F" strokeDasharray="2 4" strokeOpacity={0.6} />
                  {target > 0 && target <= maxSec && <ReferenceLine yAxisId="n" x={`${Math.min(sc.top, tSec)}s`} stroke="#7A4FB8" strokeWidth={2} strokeDasharray="6 3" label={{ value: `Target ${tg}s`, position: 'top', fill: '#7A4FB8', fontSize: fs(12), fontWeight: 700 }} />}
                  <Bar yAxisId="n" dataKey="fast" stackId="a" isAnimationActive={false} fill="#12866F" />
                  <Bar yAxisId="n" dataKey="slow" stackId="a" isAnimationActive={false} fill="#C9821A" />
                  <Bar yAxisId="n" dataKey="removed" stackId="a" isAnimationActive={false} fill="#CBD5E1" />
                  <Bar yAxisId="n" dataKey="above" stackId="a" isAnimationActive={false} fill="#B42318" />
                  <Line yAxisId="n" dataKey="count" stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none">
                    <LabelList dataKey="count" position="top" formatter={(v) => (v && !big ? nf(v) : '')} style={lblStyle} />
                  </Line>
                  <Line yAxisId="c" dataKey="cumV" stroke="rgb(var(--navy))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Wide>
            <ChartKey items={[['#12866F', 'Valid, at or under target'], ['#C9821A', 'Valid, slower than target'], ['#CBD5E1', 'Removed (outside Min–Max)'], ['#B42318', `Above ${maxSec}s (stops)`], ['rgb(var(--navy))', 'Cumulative % of valid cycles (right axis)'], ['#7A4FB8', 'Target', '6 3']]} />
          </>
        );
      })()}

      {!simple && <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.2fr]">
        <div className="max-h-[380px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-fs-13">
            <thead className="sticky top-0 z-10 bg-white"><tr className="border-b border-slate-200 text-left">
              {['Second', 'Cycles', 'Valid', '% of all', 'Cumulative %'].map((h) => <th key={h} className={thCls}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sec} onClick={() => togglePick(r.sec)}
                  className={`cursor-pointer border-b border-slate-100 tabular-nums ${r.sec === pick ? 'bg-blue-50' : 'hover:bg-slate-50'} ${r.count === 0 ? 'text-slate-300' : ''} ${r.over ? 'font-semibold text-red-600' : ''}`}>
                  <td className="px-2.5 py-1.5 font-semibold">{r.label}</td><td className="px-2.5">{int(r.count)}</td>
                  <td className="px-2.5 text-teal-700">{int(r.valid)}</td><td className="px-2.5">{f1(r.share)}%</td><td className="px-2.5">{f1(r.cum)}%</td>
                </tr>
              ))}
              <tr className="sticky bottom-0 bg-slate-100 font-bold tabular-nums">
                <td className="px-2.5 py-1.5">Total</td><td className="px-2.5">{int(sc.total)}</td><td className="px-2.5 text-teal-700">{int(sc.valid)}</td><td className="px-2.5">100%</td><td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          {!sel ? <Empty>Select a second to see its day-wise and hour-wise detail.</Empty> : (
            <>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-fs-16 font-bold">{sel.over ? `Cycles above ${maxSec}s` : `Cycles of ${sel.label}`} <span className="text-fs-13 font-medium text-slate-600">({sel.over ? `> ${maxSec}s` : `${sel.sec - 1}–${sel.sec}s`})</span></div>
                <button type="button" className="text-fs-13 font-semibold text-blue-600 hover:underline" onClick={() => setPick(null)}>Close</button>
              </div>
              <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Cycles" value={int(sel.count)} sub={`${f1(sc.total ? (sel.count / sc.total) * 100 : 0)}% of all`} bar="bg-blue-500" />
                <Stat label="Valid / removed" value={`${int(sel.valid)} / ${int(sel.over ? sel.above : sel.removed)}`} sub={sel.over ? 'all above Max' : 'inside / outside window'} bar="bg-teal-500" />
                <Stat label="Min – Max" value={sel.minV != null ? `${f1(sel.minV)}–${f1(sel.maxV)}s` : '—'} sub={sel.cap ? `+ ${int(sel.cap)} above data cap` : 'actual gaps'} bar="bg-violet-500" />
                <Stat label="Days" value={dayRows.length} sub="days with this cycle" bar="bg-amber-500" />
              </div>
              {hrRows.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hrRows} margin={{ top: 16, right: 8, left: 4, bottom: 4 }}>
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="label" tick={tick} tickLine={false} height={46} label={xLab('Hour of day')} />
                    <YAxis tick={tick} tickLine={false} axisLine={false} width={60} allowDecimals={false} tickFormatter={nf} label={yLab('Cycles')} />
                    <Tooltip formatter={(v) => [int(v), 'Cycles']} />
                    <Bar dataKey="n" fill="#3B82F6" radius={[3, 3, 0, 0]}><LabelList dataKey="n" position="top" formatter={nf} style={lblStyle} /></Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div className="mt-2 max-h-[160px] overflow-auto">
                <table className="w-full text-fs-13 tabular-nums">
                  <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-200 text-left"><th className={thCls}>Date</th><th className={thCls}>Cycles</th></tr></thead>
                  <tbody>{dayRows.map(([d, n]) => <tr key={d} className="border-b border-slate-100"><td className="px-2.5 py-1 font-semibold">{d}</td><td className="px-2.5 py-1">{int(n)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>}

      {/* ───────── loss vs target ───────── */}
      <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-fs-18 font-bold text-slate-950">Loss against target cycle time</div>
            <div className="max-w-3xl text-fs-13 text-slate-600">
              <span className="font-semibold">extra = actual − target</span>
              {pick != null ? <> · showing <b>{lossBin?.label}</b> only</> : <> · showing <b>all cycles</b></>}
            </div>
          </div>
          {pick != null && <button type="button" onClick={() => setPick(null)} className={`${btnCls} border-violet-300 text-violet-700`}>Show all seconds</button>}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <Field label="Target cycle time (s)" hint={tgt == null ? `auto: ${defSrc} ${f1(defTarget)}s` : 'manual value'}>
            <NumInput value={Number(target.toFixed(2))} min={0.1} step={0.5} w="w-28" onCommit={setTgt} />
          </Field>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            <button type="button" onClick={() => setTgt(null)} className={btnCls}>{defSrc} {f1(defTarget)}s</button>
            {a.mu != null && <button type="button" onClick={() => setTgt(Number(a.mu.toFixed(1)))} className={btnCls}>Mean {f1(a.mu)}s</button>}
            {a.med != null && defSrc !== 'Median' && <button type="button" onClick={() => setTgt(Number(a.med.toFixed(1)))} className={btnCls}>Median {f1(a.med)}s</button>}
            {canSet && <button type="button" onClick={() => onSetStd?.(a.m.mmId, target)} className="rounded-md border border-violet-500 bg-violet-600 px-3 py-1.5 text-fs-13 font-semibold text-white hover:bg-violet-700">Save {tg}s as standard</button>}
          </div>
          <Field label="Cycles to compare">
            <Segmented value={basis} onChange={setBasis} options={[['valid', 'Valid only'], ['upto', `All ≤ ${maxSec}s`], ['all', 'Incl. stops']]} />
          </Field>
        </div>
        <div className="mt-1 text-fs-13 text-slate-600">Basis: {BASIS[basis]}{basis === 'all' && L.capN > 0 ? ` · ${int(L.capN)} gaps above the data cap are counted but have no duration, so they are excluded from the loss` : ''}.</div>

        {target > 0 && R.n > 0 ? (
          <>
            <div className={`mt-3 grid grid-cols-2 gap-2 ${simple ? 'md:grid-cols-4' : 'md:grid-cols-3 xl:grid-cols-6'}`}>
              {!simple && <Stat label="Cycles compared" value={int(R.n)} sub={pick != null ? `${lossBin?.label} only` : 'all data'} bar="bg-slate-400" />}
              <Stat label="Slower than target" value={int(R.slowN)} sub={`${f1(R.n ? (R.slowN / R.n) * 100 : 0)}% of compared`} tone={R.slowN ? 'text-red-600' : 'text-emerald-600'} bar="bg-red-500" />
              <Stat label="Extra time lost" value={dur(R.loss)} sub={`${f1(R.loss / 60, 1)} min · ${f1(R.loss / 3600, 2)} h`} tone="text-red-600" bar="bg-red-500" />
              <Stat label="Lost output" value={`${f1(R.lostPcs, 1)} pcs`} sub="extra time ÷ target" tone="text-red-600" bar="bg-orange-500" />
              {!simple && <Stat label="Share of run time" value={`${f1(R.pctTime)}%`} sub="extra ÷ time compared" bar="bg-amber-500" />}
              <Stat label="Faster than target" value={int(R.fastN)} sub={`saved ${dur(R.gain)}`} tone="text-emerald-600" bar="bg-emerald-500" />
            </div>

            {!simple && <details className="mt-3 rounded-lg border border-blue-200 bg-white p-3 text-fs-13 leading-relaxed text-slate-800">
              <summary className="cursor-pointer font-bold text-slate-950">How the loss is calculated{pick != null ? ` (${lossBin?.label})` : ''}</summary>
              <ol className="mt-2 ml-5 list-decimal space-y-1">
                <li>Target = <Num>{tg}s</Num>. Basis: {BASIS[basis]}, giving <Num>{int(R.n)}</Num> cycles.</li>
                <li>For each cycle, <span className="font-semibold">extra = actual − target</span>, counted only when actual &gt; target: <Num>{int(R.slowN)}</Num> cycles ({f1(R.n ? (R.slowN / R.n) * 100 : 0)}%).</li>
                {R.slowN > 0
                  ? <li>Average slow cycle = <Num>{f1(R.avgSlow, 2)}s</Num>, average extra = <Num>{f1(R.avgExtra, 2)}s</Num>; total extra = {f1(R.avgExtra, 2)} × {int(R.slowN)} = <Num>{f1(R.loss, 1)}s</Num> ({dur(R.loss)}).</li>
                  : <li>No cycle is slower than the target, so the loss is <Num>0s</Num>.</li>}
                <li>Lost output = {f1(R.loss, 1)} ÷ {tg} = <Num>{f1(R.lostPcs, 1)} pcs</Num>.</li>
                <li>Share of run time = {f1(R.loss, 1)} ÷ {f1(R.time, 1)} = <Num>{f1(R.pctTime)}%</Num>.</li>
                {R.fastN > 0 && <li>{int(R.fastN)} cycles faster than target saved {dur(R.gain)}. This is reported separately and is not netted off; net loss = {dur(R.loss - R.gain)}.</li>}
              </ol>
              {R.samples.length > 0 && (
                <div className="mt-2 overflow-auto">
                  <div className="mb-1 text-fs-13 font-semibold text-slate-600">Top {R.samples.length} cycles by extra time</div>
                  <table className="text-fs-13 tabular-nums">
                    <thead><tr className="border-b border-slate-200 text-left text-slate-600"><th className="pr-4">Date</th><th className="pr-4">Hour</th><th className="pr-4">Actual</th><th className="pr-4">Target</th><th>Extra</th></tr></thead>
                    <tbody>{R.samples.map((s, i) => (
                      <tr key={i} className="border-b border-slate-100"><td className="pr-4 font-semibold">{s.d}</td><td className="pr-4">{pad(s.h)}-{pad(s.h + 1)}</td><td className="pr-4">{f1(s.v, 1)}s</td><td className="pr-4">{tg}s</td><td className="font-bold text-red-600">+{f1(s.extra, 1)}s</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </details>}

            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {!simple && <div className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="px-1 text-fs-14 font-bold text-slate-900">Extra time lost by cycle second</div>
                <Wide n={L.bins.length} per={big ? 36 : 30}>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={L.bins} margin={{ top: 24, right: 10, left: 4, bottom: 4 }} barCategoryGap={2}
                      onClick={(st) => { const p = st?.activePayload?.[0]?.payload; if (p) togglePick(p.sec); }} style={{ cursor: 'pointer' }}>
                      <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="label" tick={tick} tickLine={false} interval={L.bins.length > 40 ? 'preserveStartEnd' : 0} minTickGap={10} height={50} label={xLab('Cycle time (s, rounded up)')} />
                      <YAxis tick={tick} tickLine={false} axisLine={false} width={70} tickFormatter={nf} label={yLab('Extra time lost (s)')} />
                      <Tooltip formatter={(v, n, p) => [`${f1(v, 1)}s (${int(p.payload.slowN)} slow cycles)`, 'Extra time lost']} labelFormatter={(l) => `Cycle ${l}`} />
                      {pick != null && <ReferenceArea x1={L.bins[pick].label} x2={L.bins[pick].label} fill="#7C3AED" fillOpacity={0.15} />}
                      <Bar dataKey="loss" fill="#DC2626" radius={[3, 3, 0, 0]}>
                        <LabelList dataKey="loss" position="top" formatter={(v) => (v >= 1 ? nf(v) : '')} style={lblStyle} />
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </Wide>
              </div>}

              <div className={`rounded-lg border border-slate-200 bg-white p-2 ${simple ? 'xl:col-span-2' : ''}`}>
                <div className="px-1 text-fs-14 font-bold text-slate-900">Extra time lost by hour of day{pick != null ? ` (${lossBin?.label} only)` : ''}</div>
                <div className="mb-1 px-1 text-fs-13 text-slate-600">Which hours of the day lose the most time.</div>
                {hourLoss.length ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={hourLoss} margin={{ top: 24, right: 10, left: 4, bottom: 4 }}>
                      <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="label" tick={tick} tickLine={false} height={50} label={xLab('Hour of day')} />
                      <YAxis tick={tick} tickLine={false} axisLine={false} width={70} tickFormatter={nf} label={yLab('Extra time lost (min)')} />
                      <Tooltip formatter={(v, n, p) => [`${f1(v, 1)} min (${int(p.payload.slowN)} of ${int(p.payload.n)} cycles slow)`, 'Extra time lost']} />
                      <Bar dataKey="min" fill="#F97316" radius={[3, 3, 0, 0]}>
                        <LabelList dataKey="min" position="top" formatter={(v) => (v >= 0.1 ? nf(v) : '')} style={lblStyle} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </div>
            </div>

            {!simple && <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <div className="max-h-[380px] overflow-auto rounded-lg border border-slate-200 bg-white">
                <div className="px-3 pt-2 text-fs-14 font-bold text-slate-900">Loss table by cycle second</div>
                <table className="w-full text-fs-13">
                  <thead className="sticky top-0 z-10 bg-white"><tr className="border-b border-slate-200 text-left">
                    {['Second', 'Cycles', 'Slow', 'Avg actual', 'Extra / cycle', 'Total extra', '% of loss', 'Cumulative %'].map((h) => <th key={h} className={thCls}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {lossRows.map((b) => (
                      <tr key={b.sec} onClick={() => togglePick(b.sec)} className={`cursor-pointer border-b border-slate-100 tabular-nums ${b.sec === pick ? 'bg-violet-100' : 'hover:bg-slate-50'}`}>
                        <td className="px-2.5 py-1.5 font-semibold">{b.label}</td><td className="px-2.5">{int(b.n)}</td><td className="px-2.5">{int(b.slowN)}</td>
                        <td className="px-2.5">{f1(b.avgSlow, 2)}s</td><td className="px-2.5">+{f1(b.extraPer, 2)}s</td>
                        <td className="px-2.5 font-semibold text-red-600">{dur(b.loss)}</td><td className="px-2.5">{f1(b.share)}%</td><td className="px-2.5">{f1(b.cum)}%</td>
                      </tr>
                    ))}
                    <tr className="sticky bottom-0 bg-slate-100 font-bold tabular-nums">
                      <td className="px-2.5 py-1.5">Total</td><td className="px-2.5">{int(L.n)}</td><td className="px-2.5">{int(L.slowN)}</td><td className="px-2.5">{f1(L.avgSlow, 2)}s</td><td className="px-2.5">+{f1(L.avgExtra, 2)}s</td>
                      <td className="px-2.5 text-red-600">{dur(L.loss)}</td><td className="px-2.5">100%</td><td />
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="max-h-[380px] overflow-auto rounded-lg border border-slate-200 bg-white">
                <div className="px-3 pt-2 text-fs-14 font-bold text-slate-900">Loss table by date{pick != null ? ` (${lossBin?.label} only)` : ''}</div>
                <table className="w-full text-fs-13">
                  <thead className="sticky top-0 z-10 bg-white"><tr className="border-b border-slate-200 text-left">
                    {['Date', 'Compared', 'Slow', 'Extra time', 'Lost pcs', '% of time'].map((h) => <th key={h} className={thCls}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {R.days.map((d) => (
                      <tr key={d.date} className="border-b border-slate-100 tabular-nums">
                        <td className="px-2.5 py-1.5 font-semibold">{d.date}</td><td className="px-2.5">{int(d.n)}</td><td className="px-2.5">{int(d.slowN)}</td>
                        <td className="px-2.5 font-semibold text-red-600">{dur(d.loss)}</td><td className="px-2.5">{f1(d.loss / target, 1)}</td><td className="px-2.5">{f1(d.time ? (d.loss / d.time) * 100 : 0)}%</td>
                      </tr>
                    ))}
                    <tr className="sticky bottom-0 bg-slate-100 font-bold tabular-nums">
                      <td className="px-2.5 py-1.5">Total</td><td className="px-2.5">{int(R.n)}</td><td className="px-2.5">{int(R.slowN)}</td><td className="px-2.5 text-red-600">{dur(R.loss)}</td><td className="px-2.5">{f1(R.lostPcs, 1)}</td><td className="px-2.5">{f1(R.pctTime)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>}
          </>
        ) : (
          <div className="mt-3"><Empty>{target > 0 ? 'No cycles to compare in this selection.' : 'Enter a target cycle time greater than 0.'}</Empty></div>
        )}
      </div>
    </>
  );
}

/** One-word status of a model: signals → out of control; Cpk < 1 → slower than its limit; else stable. */
function statusOf(a, c) {
  if (!a.chart) return ['Too little data', 'bg-slate-100 text-slate-600'];
  if (a.chart.signals > 0) return ['Unstable', 'bg-red-100 text-red-800'];
  if (c?.cpk != null && c.cpk < 1) return ['Slow vs limit', 'bg-amber-100 text-amber-800'];
  return ['Stable', 'bg-emerald-100 text-emerald-800'];
}
function StatusPill({ a, c }) {
  const [t, cls] = statusOf(a, c);
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-fs-12 font-bold ${cls}`}>{t}</span>;
}

/** Simple view: what the chart says, in one sentence. */
function Verdict({ cur, ch, cap, usl }) {
  const [t, cls] = statusOf(cur, cap);
  const sigs = ch?.rows ? ch.rows.filter((r) => r.rules.length) : [];
  const text = !ch ? 'At least 3 days with valid cycles are needed for a control chart.'
    : sigs.length ? `${sigs.length} ${sigs.length === 1 ? 'day is' : 'days are'} outside normal variation (${sigs.slice(0, 4).map((r) => r.key).join(', ')}${sigs.length > 4 ? '…' : ''}) — check what changed on ${sigs.length === 1 ? 'that day' : 'those days'}.`
      : 'Every day is inside the control limits: the cycle time is steady.';
  const capText = cap?.cpk == null ? 'Set a standard cycle to see if the process meets it.'
    : cap.cpk >= 1.33 ? `Cpk ${f1(cap.cpk, 2)}: comfortably within the ${usl.src.toLowerCase()} of ${f1(usl.v)} s.`
      : cap.cpk >= 1 ? `Cpk ${f1(cap.cpk, 2)}: just within the ${usl.src.toLowerCase()} of ${f1(usl.v)} s.`
        : `Cpk ${f1(cap.cpk, 2)}: too many cycles are slower than the ${usl.src.toLowerCase()} of ${f1(usl.v)} s.`;
  return (
    <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm" role="status" aria-label="Chart verdict">
      <span className={`rounded-full px-2.5 py-1 text-fs-13 font-bold ${cls}`}>{t}</span>
      <span className="text-fs-14 font-semibold text-slate-900">{text}</span>
      <span className="text-fs-13 text-slate-600">{capText}</span>
    </div>
  );
}

const FORMULAS = [
  ['Scan gap', 'gap = time(scan n) − time(scan n−1)', 'Same model, same day. Overnight gaps are never counted as cycles.'],
  ['Valid cycle', 'valid if Min ≤ gap ≤ Max', 'Auto modes derive Min/Max from the data (IQR, MAD or k × median) and clip them to the floor / ceiling.'],
  ['Cycle time (mean)', 'mean = Σ valid gaps ÷ N valid', 'The median is also shown; it is less affected by outliers.'],
  ['σ and CV', 'σ = √( Σ(x − mean)² ÷ (N − 1) )   ·   CV = σ ÷ mean × 100', 'A lower CV indicates a more stable process.'],
  ['Control limits (I-MR)', 'MR̄ = mean |xᵢ − xᵢ₋₁|   ·   σ̂ = MR̄ ÷ 1.128   ·   UCL / LCL = CL ± 3σ̂', 'x is the subgroup (day / week) mean. ±1σ and ±2σ bands are also drawn.'],
  ['Control limits (X̄–S)', 'σ̂ = pooled σ ÷ √n   ·   UCL / LCL = CL ± 3σ̂', 'Limits become very tight for large subgroups.'],
  ['Signals', 'R1: 1 point beyond 3σ · R2: 2 of 3 beyond 2σ · R3: 4 of 5 beyond 1σ · R4: 8 in a row on one side', 'A signal means the process has changed, not just random noise.'],
  ['Cpk', 'Cpk = (upper limit − mean) ÷ (3σ)', 'Upper limit = manual Standard, otherwise Takt. ≥ 1.33 capable · 1–1.33 marginal · < 1 not capable.'],
  ['Within limit', 'within = valid cycles ≤ upper limit ÷ N valid × 100', ''],
  ['Loss vs target', 'extra = actual − target (only if actual > target)   ·   Loss = Σ extra', 'Compared cycle by cycle, not by bin average.'],
  ['Lost output', 'lost pcs = Loss ÷ target', 'Pieces that could have been produced in the lost time.'],
  ['Share of run time', '% = Loss ÷ Σ actual (compared cycles) × 100', ''],
];

/* ───────────── page ───────────── */
export default function ControlChartsPage({ line = '1', companies = [], latestDate, takt = {}, stds = {}, onSetStd, initialData = null, range: rangeProp = null, company: companyProp, model: modelProp, onModelChange, targets = null, onSetTargets = null }) {
  const [achMsg, setAchMsg] = useState('');
  const [achAsk, setAchAsk] = useState(false);
  const [companyS, setCompany] = useState('');
  const company = companyProp !== undefined ? (companyProp ?? '') : companyS;
  const modelControlled = modelProp !== undefined;
  const [lineF, setLineF] = useState('');
  const [months, setMonths] = useState(3);
  const [rangeS, setRange] = useState(() => ({ start: latestDate ? monthsBack(latestDate, 3) : '', end: latestDate || '' }));
  const range = rangeProp || rangeS;
  const [opt, setOpt] = useState({ mode: 'manual', min: 1, max: DEFAULT_MAX, k: 1.5 });
  const [by, setBy] = useState('day');
  const [method, setMethod] = useState('mr');
  const [phase1, setPhase1] = useState(true);
  const [sel, setSel] = useState(null);
  const [distSel, setDistSel] = useState('');
  const [view, setView] = useState('means');
  const [indDay, setIndDay] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('summary');
  // Simple = the essentials only (default); Detailed = every column, chart and formula
  const [detail, setDetailS] = useState(() => { try { return localStorage.getItem('ems.cc.view') === 'detail'; } catch { return false; } });
  const setDetail = (v) => { setDetailS(v); try { localStorage.setItem('ems.cc.view', v ? 'detail' : 'simple'); } catch { /* storage blocked */ } };
  const D = detail;
  const fx = (f) => (D ? f : undefined);   // formulas only in the detailed view
  const [lidMap, setLidMap] = useState(readLid);
  const setLid = (key, v) => setLidMap((o) => { const n = { ...o }; if (v) n[key] = v; else delete n[key]; writeLid(n); return n; });
  const [xlErr, setXlErr] = useState('');
  const [kgMap, setKgMap] = useState(readKg);
  const setKg = (id, v) => setKgMap((o) => { const n = { ...o }; if (v === '' || v == null) delete n[id]; else n[id] = v; writeKg(n); return n; });
  const [cfg, setCfg] = useState(false);
  const cfgRef = useRef(null);
  useEffect(() => {
    if (!cfg) return undefined;
    const away = (e) => { if (cfgRef.current && !cfgRef.current.contains(e.target)) setCfg(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [cfg]);

  useEffect(() => { if (latestDate && !range.end) setRange({ start: monthsBack(latestDate, months), end: latestDate }); }, [latestDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const spanDays = range.start && range.end ? Math.round((new Date(range.end) - new Date(range.start)) / 86400000) + 1 : 0;
  const rangeOk = spanDays > 0 && spanDays <= 400;
  const isAll = line === 'all';
  const { data, loading, error, reload } = useControlData({ start: range.start, end: range.end, companyId: isAll ? '' : company, line, enabled: rangeOk, initialData });

  const filteredModels = useMemo(
    () => (data?.models || []).filter((m) => !isAll || !lineF || String(m.line) === String(lineF)),
    [data, isAll, lineF],
  );

  const analyseOne = (m) => {
    const allGaps = [];
    for (const d of Object.values(m.days)) for (let i = 0; i < d.g.length; i++) allGaps.push(d.g[i]);
    const win = computeWindow(allGaps, opt);
    const sub = buildSubgroups(m.days, win, by);
    const chart = controlChart(sub, method, phase1);
    const vals = [], hrs = [];
    let scans = 0, below = 0, above = 0, over = 0, aboveMax = 0;
    for (let i = 0; i < allGaps.length; i++) if (allGaps[i] > opt.max) aboveMax++;
    for (const s of sub) { scans += s.qty; below += s.below; above += s.above; over += s.over; for (let i = 0; i < s.vals.length; i++) { vals.push(s.vals[i]); hrs.push(s.hrs[i]); } }
    aboveMax += over; // gaps above the data cap are also above Max
    return { m, win, sub, chart, vals, hrs, allGaps, scans, below, above, over, aboveMax, mu: mean(vals), sd: stdev(vals), med: median(vals) };
  };

  const analyses = useMemo(
    () => filteredModels.map(analyseOne).filter((a) => a.scans > 0).sort((a, b) => b.scans - a.scans),
    [filteredModels, opt, by, method, phase1], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // "All models" = every filtered model merged day by day
  const allA = useMemo(() => {
    if (!filteredModels.length) return null;
    const days = {};
    for (const m of filteredModels) {
      for (const [d, v] of Object.entries(m.days)) {
        const t = days[d] || (days[d] = { q: 0, o: 0, g: [], h: [] });
        t.q += v.q || 0; t.o += v.o || 0;
        for (let i = 0; i < v.g.length; i++) { t.g.push(v.g[i]); t.h.push(v.h[i]); }
      }
    }
    const comp = !isAll && company ? companies.find((c) => String(c.CompanyId) === String(company))?.CompanyTitle : null;
    const merged = {
      mmId: 'ALL', model: 'All models', modelCode: null, company: comp || (filteredModels.length > 1 ? 'all companies' : filteredModels[0].company),
      lineName: isAll ? (lineF ? `Line ${lineF}` : 'All lines') : '', count: filteredModels.length, days,
    };
    const a = analyseOne(merged);
    return a.scans > 0 ? a : null;
  }, [filteredModels, opt, by, method, phase1, isAll, lineF, company, companies]); // eslint-disable-line react-hooks/exhaustive-deps

  const getA = (id) => (id === 'ALL' ? allA : analyses.find((a) => String(a.m.mmId) === String(id)) || null);
  const pickerOptions = useMemo(() => analyses.map((a) => ({
    id: a.m.mmId,
    title: `${isAll ? `${a.m.lineName} · ` : ''}${a.m.model}${a.m.modelCode ? ` (${a.m.modelCode})` : ''}`,
    sub: `${a.m.company || '—'} · ${int(a.scans)} scans`,
  })), [analyses, isAll]);

  const lineTotals = useMemo(() => {
    if (!isAll) return [];
    const o = {};
    for (const a of analyses) {
      const t = (o[a.m.line] = o[a.m.line] || { line: a.m.line, models: 0, scans: 0, valid: 0, above: 0, s1: 0 });
      t.models++; t.scans += a.scans; t.valid += a.vals.length; t.above += a.aboveMax;
      for (let i = 0; i < a.vals.length; i++) t.s1 += a.vals[i];
    }
    return Object.values(o).sort((x, y) => x.line - y.line).map((t) => ({ ...t, mu: t.valid ? t.s1 / t.valid : null }));
  }, [analyses, isAll]);

  const selEff = modelControlled ? (modelProp ? String(modelProp) : 'ALL') : sel;
  const chooseModel = (id) => (modelControlled ? onModelChange?.(id === 'ALL' ? '' : id) : setSel(id));
  const cur = useMemo(() => getA(selEff) || analyses[0] || allA, [analyses, allA, selEff]); // eslint-disable-line react-hooks/exhaustive-deps
  const dist = useMemo(() => (distSel ? getA(distSel) || cur : cur), [distSel, analyses, allA, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDistSel(''); }, [selEff]);
  const isMerged = cur?.m.mmId === 'ALL';

  const dayKeys = useMemo(() => (cur ? Object.keys(cur.m.days).filter((d) => cur.m.days[d].g.length > 5).sort() : []), [cur]);
  useEffect(() => { if (dayKeys.length && !dayKeys.includes(indDay)) setIndDay(dayKeys[dayKeys.length - 1]); }, [dayKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const uslOf = (a) => (Number(stds?.[a.m.mmId]) > 0 ? { v: Number(stds[a.m.mmId]), src: 'Standard' } : Number(takt?.models?.[a.m.mmId]) > 0 ? { v: Number(takt.models[a.m.mmId]), src: 'Takt' } : Number(takt?.taktSec) > 0 ? { v: Number(takt.taktSec), src: 'Takt' } : null);

  const overview = useMemo(() => analyses.filter((a) => !q || `${a.m.model} ${a.m.modelCode || ''} ${a.m.company || ''}`.toLowerCase().includes(q.toLowerCase())).map((a) => {
    const u = uslOf(a); const cap = capability(a.vals, u?.v);
    return { a, u, cap, removed: a.allGaps.length ? ((a.below + a.above) / (a.allGaps.length + a.over)) * 100 : 0 };
  }), [analyses, q, stds, takt]); // eslint-disable-line react-hooks/exhaustive-deps

  // table rows with achieved cycle + lid (same order as overview)
  const sumRows = useMemo(() => summaryRows(overview, lidMap, line, isAll ? {} : kgMap), [overview, lidMap, line, kgMap, isAll]);
  const exportSummary = () => {
    setXlErr('');
    const lineLabel = isAll ? (lineF ? `Line ${lineF}` : 'All lines') : `Line ${line}`;
    const windowText = opt.mode === 'manual' ? `Manual ${opt.min}–${opt.max} s` : `${MODES[opt.mode].label} (floor ${opt.min} s, ceiling ${opt.max} s)`;
    try {
      exportSummaryXlsx(sumRows, { lineLabel, start: range.start, end: range.end, generatedAt: serverNow(), windowText, by: by === 'week' ? 'Weekly' : 'Daily', allLines: isAll });
    } catch (e) { setXlErr(`Excel export failed: ${e.message || e}`); }
  };

  const indSeries = useMemo(() => {
    if (!cur || !indDay || !cur.m.days[indDay]) return null;
    const { g, h } = cur.m.days[indDay];
    const pts = []; let removed = 0;
    for (let i = 0; i < g.length; i++) { if (g[i] >= cur.win.lo && g[i] <= cur.win.hi) pts.push({ n: 1, mean: g[i], sd: null, label: `#${pts.length + 1}`, hr: h[i] }); else removed++; }
    return { chart: controlChart(pts, 'mr', false), removed, count: pts.length };
  }, [cur, indDay]);

  const ovTotals = useMemo(() => {
    let scans = 0, valid = 0, above = 0, allG = 0, rem = 0, sig = 0, s1 = 0, s2 = 0;
    for (const { a } of overview) {
      scans += a.scans; valid += a.vals.length; above += a.aboveMax; allG += a.allGaps.length + a.over; rem += a.below + a.above; sig += a.chart?.signals || 0;
      for (let i = 0; i < a.vals.length; i++) { s1 += a.vals[i]; s2 += a.vals[i] * a.vals[i]; }
    }
    const mu = valid ? s1 / valid : null;
    const sd = valid > 1 ? Math.sqrt(Math.max(0, (s2 - valid * mu * mu) / (valid - 1))) : null;
    return { n: overview.length, scans, valid, above, mu, sd, cv: mu && sd != null ? (sd / mu) * 100 : null, removed: allG ? (rem / allG) * 100 : 0, sig };
  }, [overview]);

  const subTotals = useMemo(() => {
    if (!cur) return null;
    let qty = 0, n = 0, rem = 0, s1 = 0, s2 = 0, mn = null, mx = null;
    for (const s of cur.sub) {
      qty += s.qty; n += s.n; rem += s.below + s.above + s.over;
      if (s.min != null && (mn === null || s.min < mn)) mn = s.min;
      if (s.max != null && (mx === null || s.max > mx)) mx = s.max;
    }
    for (let i = 0; i < cur.vals.length; i++) { s1 += cur.vals[i]; s2 += cur.vals[i] * cur.vals[i]; }
    const mu = n ? s1 / n : null;
    const sd = n > 1 ? Math.sqrt(Math.max(0, (s2 - n * mu * mu) / (n - 1))) : null;
    return { qty, n, rem, mu, sd, med: cur.med, mn, mx, sigs: (cur.chart?.rows || []).filter((r) => r.rules.length).length };
  }, [cur]);

  const setMode = (mode) => setOpt((o) => ({ ...o, mode, k: MODES[mode].k ?? o.k }));
  const pickPreset = (n) => { setMonths(n); setRange({ start: monthsBack(latestDate, n), end: latestDate }); };
  const xFmt = (l) => (by === 'week' ? `wk ${String(l).slice(5)}` : String(l).slice(5));
  const xTitle = by === 'week' ? 'Week starting (month-day)' : 'Date (month-day)';

  const exportCsv = () => {
    if (!cur) return;
    const head = ['Subgroup', 'Scans', 'Valid cycles', 'Removed below Min', 'Removed above Max', 'Over cap', 'Mean (s)', 'Median (s)', 'Std dev (s)', 'Min (s)', 'Max (s)', 'LCL', 'CL', 'UCL', 'Signals'];
    const byKey = new Map((cur.chart?.rows || []).map((r) => [r.key, r]));
    const rows = cur.sub.map((s) => { const r = byKey.get(s.key); return [s.key, s.qty, s.n, s.below, s.above, s.over, f1(s.mean, 2), f1(s.med, 2), f1(s.sd, 2), f1(s.min), f1(s.max), r ? f1(r.lcl, 2) : '', r ? f1(r.cl, 2) : '', r ? f1(r.ucl, 2) : '', r ? r.rules.join(' ') : '']; });
    if (subTotals) rows.push(['TOTAL', subTotals.qty, subTotals.n, '', '', '', f1(subTotals.mu, 2), f1(subTotals.med, 2), f1(subTotals.sd, 2), f1(subTotals.mn), f1(subTotals.mx), '', '', '', subTotals.sigs]);
    const url = URL.createObjectURL(new Blob([[head, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `control_chart_${cur.m.lineName ? cur.m.lineName.replace(' ', '') + '_' : ''}${cur.m.model}_${range.start}_${range.end}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const usl = cur ? uslOf(cur) : null;
  const cap = cur ? capability(cur.vals, usl?.v) : null;
  const ch = cur?.chart;
  const manualStd = cur && !isMerged ? Number(stds?.[cur.m.mmId]) || 0 : 0;
  const totalGaps = cur ? cur.allGaps.length + cur.over : 0;
  const removedPct = cur && totalGaps ? ((cur.below + cur.above + cur.over) / totalGaps) * 100 : 0;
  const isAuto = opt.mode !== 'manual';
  const canSetStd = !isAll && !isMerged && !!onSetStd;   // read-only where nothing can save it (management, all-lines view)
  const perPt = (cur?.sub.length || 0) > 120 ? 14 : 20; // denser data → tighter spacing, still scrollable

  // distribution section defaults
  const dUsl = dist ? uslOf(dist) : null;
  const dDefTarget = dist ? (dUsl?.v ?? (dist.med != null ? Number(dist.med.toFixed(1)) : 10)) : 10;
  const dDefSrc = dUsl ? dUsl.src : 'Median';
  const dStd = dist && dist.m.mmId !== 'ALL' ? Number(stds?.[dist.m.mmId]) || 0 : 0;
  const curTitle = (a) => (a.m.mmId === 'ALL' ? `All models${a.m.count ? ` (${a.m.count})` : ''}` : a.m.model);
  const hasData = !!cur;

  return (
    <div className={`bg-slate-100 text-slate-900 transition-opacity ${loading ? 'opacity-70' : ''}`} style={FONT}>
      {/* ═══════════ fixed toolbar: tabs · model · settings ═══════════ */}
      <header className="sticky top-0 z-40 border-b border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <nav className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-fs-13 font-semibold ${tab === k ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </nav>

          {!modelControlled && <ModelPicker value={cur?.m.mmId ?? ''} onChange={setSel} options={pickerOptions} allLabel="All models (combined)" w="w-64" />}

          <div ref={cfgRef} className="relative">
            <button type="button" onClick={() => setCfg((v) => !v)} className={`${selCls} flex items-center gap-2`}>
              <SlidersHorizontal size={14} className="text-slate-600" />
              <span className="whitespace-nowrap">Settings · {isAuto ? MODES[opt.mode].label.replace('Auto · ', '') : `${opt.min}–${opt.max}s`} · {by === 'week' ? 'Weekly' : 'Daily'}</span>
              <ChevronDown size={14} className="text-slate-600" />
            </button>
            {cfg && (
              <div className="absolute left-0 top-full z-50 mt-1 w-[27rem] space-y-3 rounded-lg border border-slate-300 bg-white p-3 shadow-2xl">
                {(!rangeProp || (companyProp === undefined && !isAll) || isAll) && (
                  <>
                    <div className="text-fs-13 font-bold text-slate-900">Data</div>
                    {!rangeProp && (
                      <div className="flex flex-wrap items-center gap-1">
                        {PRESETS.map(([n, l]) => (
                          <button key={n} type="button" disabled={!latestDate} onClick={() => pickPreset(n)}
                            className={`h-9 rounded-md border px-2.5 text-fs-13 font-semibold ${months === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>
                        ))}
                        <input type="date" className={`${inpCls} w-[9.25rem]`} value={range.start} onChange={(e) => { setMonths(0); setRange({ ...range, start: e.target.value }); }} />
                        <span className="text-slate-600">–</span>
                        <input type="date" className={`${inpCls} w-[9.25rem]`} value={range.end} onChange={(e) => { setMonths(0); setRange({ ...range, end: e.target.value }); }} />
                      </div>
                    )}
                    {!isAll && companyProp === undefined && (
                      <Field label="Company">
                        <select className={`${selCls} w-52`} value={company} onChange={(e) => { setCompany(e.target.value); setSel(null); }}>
                          <option value="">All companies</option>
                          {companies.map((c) => <option key={c.CompanyId} value={c.CompanyId}>{c.CompanyTitle}</option>)}
                        </select>
                      </Field>
                    )}
                    {isAll && (
                      <Field label="Line">
                        <select className={`${selCls} w-40`} value={lineF} onChange={(e) => { setLineF(e.target.value); setSel(null); }}>
                          <option value="">All lines</option>
                          {LINE_IDS.map((l) => <option key={l} value={l}>Line {l}</option>)}
                        </select>
                      </Field>
                    )}
                    <div className="border-t border-slate-200" />
                  </>
                )}
                <div className="text-fs-13 font-bold text-slate-900">Valid cycle</div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Outlier method">
                    <select className={`${selCls} w-44`} value={opt.mode} onChange={(e) => setMode(e.target.value)}>
                      {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                    </select>
                  </Field>
                  <Field label={isAuto ? 'Min floor (s)' : 'Min (s)'}><NumInput value={opt.min} min={0} step={0.5} onCommit={(n) => setOpt({ ...opt, min: n })} /></Field>
                  <Field label={isAuto ? 'Max ceiling (s)' : 'Max (s)'}><NumInput value={opt.max} min={1} step={1} onCommit={(n) => setOpt({ ...opt, max: n })} /></Field>
                  {isAuto && <Field label={MODES[opt.mode].kLabel}><NumInput value={opt.k} min={0.5} step={0.5} onCommit={(n) => setOpt({ ...opt, k: n })} /></Field>}
                </div>
                <div className="border-t border-slate-200 pt-3 text-fs-13 font-bold text-slate-900">Chart</div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Subgroup"><Segmented value={by} onChange={setBy} options={[['day', 'Daily'], ['week', 'Weekly']]} /></Field>
                  <Field label="Control limits"><Segmented value={method} onChange={setMethod} options={[['mr', 'I-MR'], ['sigma', 'X̄–S']]} /></Field>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-fs-13 font-semibold text-slate-700">
                  <input type="checkbox" className="h-4 w-4" checked={phase1} onChange={(e) => setPhase1(e.target.checked)} />
                  Exclude out-of-control points from limits
                </label>
              </div>
            )}
          </div>

          <span className={`text-fs-13 font-medium ${rangeOk ? 'text-slate-600' : 'font-semibold text-red-600'}`}>
            {rangeOk ? `${range.start} to ${range.end} · ${spanDays} days` : 'Range must be 1–400 days'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Segmented value={D ? 'detail' : 'simple'} onChange={(v) => setDetail(v === 'detail')} options={[['simple', 'Simple'], ['detail', 'Detailed']]} />
            <button type="button" onClick={reload} title="Reload data" className={`${btnCls} h-9`}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Reload</button>
          </div>
        </div>
      </header>

      {/* ═══════════ content ═══════════ */}
      <div className="space-y-3 p-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-fs-14 font-medium text-red-800">
            <div className="font-bold">Data could not be loaded</div><div className="break-all">{error}</div>
            <div className="mt-1 text-fs-13">Confirm that <b>backend/api/model_control.php</b> is deployed and the API base URL is correct.</div>
          </div>
        )}
        {!error && loading && !data && <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-fs-16 font-semibold text-slate-600">Loading scan data for {spanDays} days…</div>}
        {!loading && data && !analyses.length && <Empty>No scans were recorded in this range{isAll && lineF ? ` for Line ${lineF}` : ''}.</Empty>}
        {isAll && data?.errors?.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-fs-13 font-medium text-amber-800">
            Some lines could not be loaded: <span className="font-semibold">{data.errors.join(' · ')}</span>
          </div>
        )}

        {/* ── Summary ── */}
        {tab === 'summary' && analyses.length > 0 && (
          <>
            {isAll && lineTotals.length > 0 && (
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                {lineTotals.map((t) => (
                  <Stat key={t.line} label={`Line ${t.line}`} value={`${int(t.valid)} valid`} sub={`${int(t.scans)} scans · ${t.models} models · mean ${sec(t.mu)} · ${int(t.above)} above ${opt.max}s`} tone="text-teal-700" bar={['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500'][(t.line - 1) % 4]} />
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Valid cycles" value={int(ovTotals.valid)} sub={`${int(ovTotals.scans)} scans · ${ovTotals.n} models`} tone="text-teal-700" bar="bg-teal-500" />
              <Stat label="Mean cycle time" value={sec(ovTotals.mu)} sub={`σ ${sec(ovTotals.sd)} · CV ${ovTotals.cv != null ? ovTotals.cv.toFixed(0) : '—'}%`} tone="text-teal-700" bar="bg-teal-500" />
              <Stat label={`Above ${opt.max}s`} value={int(ovTotals.above)} sub="Stops / changeovers" tone={ovTotals.above ? 'text-red-600' : 'text-slate-900'} bar="bg-red-500" />
              <Stat label="Control signals" value={ovTotals.sig} sub="Across all models" tone={ovTotals.sig ? 'text-red-600' : 'text-emerald-600'} bar="bg-red-500" />
            </div>
            <Card title="Model-wise summary" sub={`${overview.length} of ${analyses.length} models. Select a row to open its control chart.`}
              formula={fx('Cpk = (upper limit − mean) ÷ (3σ)  ·  upper limit = manual Standard, otherwise Takt  ·  Signals = points breaking the control rules')}
              right={(
                <div className="flex flex-wrap items-center gap-2">
                  <input className={`${selCls} w-52`} placeholder="Search model…" value={q} onChange={(e) => setQ(e.target.value)} />
                  {!isAll && onSetTargets && (achAsk ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-fs-13 font-bold text-blue-950">
                      Set {sumRows.filter((r) => r.achieved).length} targets from achieved cycle?
                      <button type="button" className="rounded bg-blue-700 px-2 py-0.5 text-white" onClick={async () => {
                        setAchAsk(false);
                        const items = sumRows.filter((r) => r.achieved).map((r) => ({ mmId: Number(r.mmId), cycle: r.achievedTarget ?? r.achieved, model: r.model, company: r.company }));
                        try { await onSetTargets(items); setAchMsg(`${items.length} targets set: achieved cycle + 3 s.`); } catch (e) { setAchMsg(`Could not save: ${e.message}`); }
                      }}>Yes, set</button>
                      <button type="button" className="rounded border border-slate-400 bg-white px-2 py-0.5 text-slate-800" onClick={() => setAchAsk(false)}>Cancel</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => { setAchMsg(''); setAchAsk(true); }} disabled={!sumRows.some((r) => r.achieved)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-blue-700 bg-white px-3 text-fs-13 font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                      title="Target cycle of every model in this table = its achieved cycle + 3 s (pcs/hr = 3600 ÷ target cycle)">Use achieved + 3 s as targets</button>
                  ))}
                  {achMsg && <span role="status" className={`text-fs-13 font-bold ${achMsg.startsWith('Not') ? 'text-red-700' : 'text-emerald-700'}`}>{achMsg}</span>}
                  <button type="button" onClick={exportSummary} disabled={!sumRows.length} title="Excel: this table with line, period, date, lid and achieved cycle"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-fs-13 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    <FileSpreadsheet size={15} /> Excel
                  </button>
                </div>
              )}>
              {xlErr && <div role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-fs-13 font-semibold text-red-800">{xlErr}</div>}
              {D && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-fs-13 font-semibold text-slate-600">
                <span className="font-bold text-slate-800">Lid:</span>
                {['full', 'half', 'glass', 'none', 'unknown'].map((k) => (
                  <span key={k} className="inline-flex items-center gap-1"><LidIcon type={k} />{LID[k].xl}</span>
                ))}
                <span className="text-slate-600">· Achieved cycle = tallest bar of the model's 1-second histogram (valid cycles) · covered = valid cycles at the achieved second or faster · target cycle = achieved + 3 s · target pcs/hr = 3600 ÷ target cycle</span>
              </div>}
              <div className="mt-2 max-h-[560px] overflow-auto">
                <table className="w-full text-fs-13">
                  <thead className="sticky top-0 z-20 bg-white"><tr className="border-b border-slate-200 text-left">
                    {(D ? ['Model', ...(isAll ? ['Line'] : []), 'Company', 'Lid', 'Weight', 'Scans', 'Valid cycles', `Above ${opt.max}s`, 'Removed', 'Achieved cycle', 'Target (+3 s)', 'Mean', 'σ', 'CV', 'Valid window', 'Limit', 'Cpk', 'Within limit', 'Signals']
                      : ['Model', ...(isAll ? ['Line'] : []), 'Company', 'Valid cycles', 'Mean', 'Achieved cycle', 'Target (+3 s)', 'Cpk', 'Signals', 'Status']).map((h) => <th key={h} className={`${thCls} !px-2 ${h === 'Achieved cycle' || h === 'Target (+3 s)' ? 'text-teal-700' : ''} ${h === 'Model' ? 'sticky left-0 z-10 bg-white' : ''}`}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {overview.map(({ a, u, cap: c, removed }, i) => {
                      const active = cur && a.m.mmId === cur.m.mmId, cv = a.mu && a.sd != null ? (a.sd / a.mu) * 100 : null;
                      const sr = sumRows[i] || {};
                      const lk = lidKey(sr.line, a.m.mmId);
                      const lt = LID[sr.lid || 'unknown'];
                      return (
                        <tr key={a.m.mmId} onClick={() => { chooseModel(a.m.mmId); setTab('control'); }} className={`cursor-pointer border-b border-slate-100 tabular-nums ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                          <td className={`sticky left-0 z-[5] whitespace-nowrap px-2 py-1.5 font-semibold ${active ? 'bg-blue-50' : 'bg-white'}`}>{a.m.model}{a.m.modelCode ? <span className="font-normal text-slate-600"> ({a.m.modelCode})</span> : null}</td>
                          {isAll && <td className="whitespace-nowrap px-2.5 font-medium text-slate-700">{a.m.lineName}</td>}
                          <td className="whitespace-nowrap px-2.5 text-slate-600">{a.m.company || '—'}</td>
                          {D && <td className="whitespace-nowrap px-1.5" onClick={(e) => e.stopPropagation()}
                            title={`${lt.label}${sr.lidSource ? ` · from ${LID_SOURCE[sr.lidSource]}` : ''}${sr.lidItem ? ` · ${sr.lidItem}` : ''} — change it here`}>
                            <div className="flex items-center gap-1">
                              <LidIcon type={sr.lid} />
                              <select aria-label={`Lid type of ${a.m.model}`} value={lidMap[lk] || ''} onChange={(e) => setLid(lk, e.target.value)}
                                className={`h-7 rounded border bg-white px-1 text-fs-12 font-semibold ${lidMap[lk] ? 'border-blue-400 text-blue-800' : 'border-slate-200 text-slate-700'}`}>
                                <option value="">{`${lt.short}${sr.lidSource && sr.lidSource !== 'manual' ? ` (${sr.lidSource === 'list' ? 'list' : 'name'})` : ''}`}</option>
                                {["full", "half", "glass", "none"].map((k) => <option key={k} value={k}>{LID[k].xl}</option>)}
                              </select>
                            </div>
                          </td>}
                          {D && <td className="whitespace-nowrap px-1.5" onClick={(e) => e.stopPropagation()}
                            title={`${sr.kg != null ? `${sr.kg} kg` : 'No weight'} · ${sr.kgFrom}${sr.kgItem ? ` · ${sr.kgItem}` : ''}${isAll ? '' : ' — type a value to change it (also used on Standard cycle time)'}`}>
                            <div className="flex items-center gap-1">
                              <span className={`w-9 text-right font-mono font-extrabold ${sr.kg != null ? 'text-slate-900' : 'text-red-600'}`}>{sr.kg != null ? sr.kg : '—'}</span>
                              <span className={`rounded px-1 py-0.5 text-fs-11 font-bold ${KG_TAG[sr.kgFrom] || ''}`}>{sr.kgFrom}</span>
                              {!isAll && (
                                <input type="number" min="0" step="0.5" value={kgMap[String(a.m.mmId)] ?? ''} placeholder="kg" aria-label={`Weight in kg for ${a.m.model}`}
                                  onChange={(e) => setKg(String(a.m.mmId), e.target.value)}
                                  className="h-7 w-12 rounded border border-slate-200 px-1 font-mono text-fs-12 font-semibold focus:border-blue-500 focus:outline-none" />
                              )}
                            </div>
                          </td>}
                          {D && <td className="px-2.5">{int(a.scans)}</td>}
                          <td className="px-2.5 font-semibold text-teal-700">{int(a.vals.length)}</td>
                          {D && <td className={`px-2.5 font-semibold ${a.aboveMax ? 'text-red-600' : ''}`}>{int(a.aboveMax)}</td>}
                          {D && <td className={`px-2.5 ${removed > 15 ? 'font-semibold text-red-600' : ''}`}>{f1(removed)}%</td>}
                          {!D && <td className="px-2.5 font-semibold text-teal-700">{sec(a.mu)}</td>}
                          <td className="whitespace-nowrap px-2.5" title={sr.achieved != null ? `${int(sr.achievedCount)} valid cycles were ${sr.achieved - 1}–${sr.achieved} s; ${int(sr.achievedUpTo)} of ${int(a.vals.length)} were ${sr.achieved} s or faster` : ''}>
                            {sr.achieved != null ? (<><span className="rounded bg-teal-50 px-1.5 py-0.5 font-extrabold text-teal-800">{sr.achieved} s</span>{D ? <span className="ml-1.5 text-fs-12 text-slate-700">≤ {sr.achieved} s: <b>{int(sr.achievedUpTo)}</b> pcs · <b>{f1(sr.achievedUpToShare, 0)}%</b></span> : <span className="ml-1.5 text-fs-12 text-slate-600">{f1(sr.achievedUpToShare, 0)}% at or faster</span>}</>) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-2.5" onClick={(e) => e.stopPropagation()}>
                            {sr.achieved != null ? (() => {
                              const curT = Number(targets?.[String(a.m.mmId)]?.cycle) || null;
                              const same = curT != null && Math.abs(curT - (sr.achievedTarget ?? sr.achieved)) < 0.01;
                              return (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="rounded bg-teal-100 px-1.5 py-0.5 font-mono font-extrabold text-teal-950" title={`achieved ${sr.achieved} s + 3 s`}>{sr.achievedTarget} s</span><span className="font-mono font-bold text-slate-900">{f1(sr.achievedPph, 0)}/hr</span>
                                  {!isAll && onSetTargets && (same
                                    ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-fs-12 font-bold text-emerald-800">target set</span>
                                    : <button type="button" onClick={() => onSetTargets([{ mmId: Number(a.m.mmId), cycle: sr.achievedTarget ?? sr.achieved, model: a.m.model, company: a.m.company || '' }]).then(() => setAchMsg(`Target of ${a.m.model} = ${sr.achievedTarget} s (achieved ${sr.achieved} s + 3 s · ${f1(sr.achievedPph, 0)}/hr).`)).catch((e) => setAchMsg(`Could not save: ${e.message}`))}
                                        className="rounded border border-blue-600 px-1.5 py-0.5 text-fs-12 font-bold text-blue-800 hover:bg-blue-50"
                                        title={curT ? `Current target ${curT} s — replace with ${sr.achievedTarget} s (achieved + 3 s)` : `Target = achieved ${sr.achieved} s + 3 s = ${sr.achievedTarget} s`}>{curT ? 'Replace target' : 'Set target'}</button>)}
                                </span>
                              );
                            })() : '—'}
                          </td>
                          {D && <><td className="px-2.5 font-semibold text-teal-700">{sec(a.mu)}</td><td className="px-2.5">{sec(a.sd)}</td>
                          <td className={`px-2.5 ${cv > 30 ? 'text-red-600' : cv > 15 ? 'text-amber-600' : ''}`}>{cv != null ? `${cv.toFixed(0)}%` : '—'}</td>
                          <td className="whitespace-nowrap px-2.5">{f1(a.win.lo)}–{Number.isFinite(a.win.hi) ? f1(a.win.hi) : '∞'}s</td>
                          <td className="whitespace-nowrap px-2.5">{u ? `${u.src} ${f1(u.v)}s` : '—'}</td></>}
                          <td className={`px-2.5 font-semibold ${c.cpk == null ? '' : c.cpk >= 1.33 ? 'text-emerald-600' : c.cpk >= 1 ? 'text-amber-600' : 'text-red-600'}`}>{f1(c.cpk, 2)}</td>
                          {D && <td className="px-2.5">{c.within != null ? `${c.within.toFixed(0)}%` : '—'}</td>}
                          <td className={`px-2.5 font-semibold ${a.chart?.signals ? 'text-red-600' : 'text-emerald-600'}`}>{a.chart ? a.chart.signals : '—'}</td>
                          {!D && <td className="px-2.5"><StatusPill a={a} c={c} /></td>}
                        </tr>
                      );
                    })}
                    <tr className="sticky bottom-0 border-t-2 border-slate-300 bg-slate-100 font-bold tabular-nums">
                      <td className="sticky left-0 z-[5] whitespace-nowrap bg-slate-100 px-2 py-2">Total ({ovTotals.n} models)</td>{isAll && <td className="px-2.5">—</td>}<td className="px-2.5">—</td>
                      {D && <td className="whitespace-nowrap px-2.5 text-fs-12 font-semibold">{['full', 'half', 'glass', 'none', 'unknown'].map((k) => { const n = sumRows.filter((r) => r.lid === k).length; return n ? <span key={k} className={`mr-2 inline-flex items-center gap-0.5 ${LID[k].cls}`} title={`${n} × ${LID[k].xl}`}><LidIcon type={k} size={13} />{n}</span> : null; })}</td>}
                      {D ? <>
                      <td className="whitespace-nowrap px-2 text-fs-12 font-semibold text-slate-600">{sumRows.filter((r) => r.kg != null).length}/{sumRows.length} set</td>
                      <td className="px-2.5">{int(ovTotals.scans)}</td><td className="px-2.5 text-teal-700">{int(ovTotals.valid)}</td>
                      <td className={`px-2.5 ${ovTotals.above ? 'text-red-600' : ''}`}>{int(ovTotals.above)}</td>
                      <td className="px-2.5">{f1(ovTotals.removed)}%</td><td className="px-2.5">—</td><td className="px-2.5">—</td><td className="px-2.5 text-teal-700">{sec(ovTotals.mu)}</td><td className="px-2.5">{sec(ovTotals.sd)}</td>
                      <td className="px-2.5">{ovTotals.cv != null ? `${ovTotals.cv.toFixed(0)}%` : '—'}</td>
                      <td className="px-2.5">—</td><td className="px-2.5">—</td><td className="px-2.5">—</td><td className="px-2.5">—</td>
                      <td className="px-2.5">{ovTotals.sig}</td></> : <>
                      <td className="px-2.5 text-teal-700">{int(ovTotals.valid)}</td><td className="px-2.5 text-teal-700">{sec(ovTotals.mu)}</td>
                      <td className="px-2.5">—</td><td className="px-2.5">—</td><td className="px-2.5">—</td><td className="px-2.5">{ovTotals.sig}</td><td className="px-2.5">—</td></>}
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {/* ── Control chart ── */}
        {tab === 'control' && cur && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {!D && <Verdict cur={cur} ch={ch} cap={cap} usl={usl} />}
              {D && <Stat label="Valid cycles" value={int(cur.vals.length)} sub={`${int(cur.scans)} scans · ${f1(100 - removedPct)}% of gaps`} bar="bg-teal-500" />}
              <Stat label="Cycle time (mean)" value={sec(cur.mu)} sub={`median ${sec(cur.med)} · σ ${sec(cur.sd)} · CV ${cur.mu ? f1((cur.sd / cur.mu) * 100, 0) : '—'}%`} tone="text-teal-700" bar="bg-teal-500" />
              {D && <Stat label={`Above ${opt.max}s`} value={int(cur.aboveMax)} sub={`${f1(totalGaps ? (cur.aboveMax / totalGaps) * 100 : 0)}% of gaps · ${f1(removedPct)}% removed`} tone={cur.aboveMax ? 'text-red-600' : 'text-slate-900'} bar="bg-red-500" />}
              <Stat label="Control limits" value={ch ? `${f1(ch.cl - 3 * ch.sigma)}–${f1(ch.cl + 3 * ch.sigma)}s` : '—'} sub={ch ? `CL ${f1(ch.cl, 2)}s · ${ch.signals} signals` : 'needs ≥ 3 subgroups'} tone={ch?.signals ? 'text-red-600' : 'text-slate-900'} bar="bg-violet-500" />
              <Stat label="Cpk" value={f1(cap?.cpk, 2)} sub={cap?.cpk == null ? 'set a standard or takt' : `${cap.cpk >= 1.33 ? 'capable' : cap.cpk >= 1 ? 'marginal' : 'not capable'} · ${usl.src} ${sec(usl.v)}`} tone={cap?.cpk == null ? '' : cap.cpk >= 1.33 ? 'text-emerald-600' : cap.cpk >= 1 ? 'text-amber-600' : 'text-red-600'} bar="bg-emerald-500" />
              {D && <Stat label="Within limit" value={cap?.within != null ? `${cap.within.toFixed(0)}%` : '—'} sub="valid cycles ≤ upper limit" bar="bg-cyan-500" />}
              <div className={`flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${D ? 'md:col-span-2' : ''}`}>
                <div className="text-fs-13 font-semibold text-slate-600">Standard cycle (s)</div>
                {canSetStd ? (
                  <div className="mt-1 flex items-center gap-2">
                    <NumInput value={manualStd || Number((cur.mu || 0).toFixed(1))} min={0} step={0.5} w="w-24" onCommit={(n) => onSetStd?.(cur.m.mmId, n)} />
                    <span className="text-fs-13 text-slate-600">{manualStd > 0 ? 'manual' : 'auto = mean cycle'}</span>
                    {manualStd > 0 && <button type="button" className="text-fs-13 font-semibold text-blue-600 hover:underline" onClick={() => onSetStd?.(cur.m.mmId, null)}>Reset</button>}
                  </div>
                ) : <div className="mt-1 text-fs-13 text-slate-600">{isMerged ? 'Select a single model to set its standard.' : 'Set on the line page.'}</div>}
              </div>
            </div>

            <Card title={view === 'means' ? `${by === 'week' ? 'Weekly' : 'Daily'} mean cycle time` : `Individual cycles on ${indDay}`}
              sub={view === 'means'
                ? `${method === 'mr' ? 'Limits are based on movement between consecutive subgroup means.' : 'Limits are based on the spread of cycles inside each subgroup.'} Red = beyond 3σ · amber = other rule · grey = excluded from limits.`
                : 'Consecutive valid cycles of one day, in scan order. Limits from the moving range of individual values.'}
              formula={fx(view === 'means'
                ? (method === 'mr'
                  ? 'CL = mean of subgroup means  ·  MR̄ = mean |meanᵢ − meanᵢ₋₁|  ·  σ̂ = MR̄ ÷ 1.128  ·  UCL / LCL = CL ± 3σ̂'
                  : 'CL = weighted mean of subgroup means  ·  σ̂ = pooled within-subgroup σ  ·  UCL / LCL = CL ± 3σ̂ ÷ √n')
                : 'CL = mean cycle of the day  ·  σ̂ = MR̄ ÷ 1.128  ·  UCL / LCL = CL ± 3σ̂')}
              right={(
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented value={view} onChange={setView} options={[['means', 'Subgroup means'], ['individual', 'Single day']]} />
                  {view === 'individual' && <select className={selCls} value={indDay} onChange={(e) => setIndDay(e.target.value)}>{dayKeys.map((d) => <option key={d}>{d}</option>)}</select>}
                </div>
              )}>
              {view === 'means'
                ? (ch ? <MeansChart rows={ch.rows} method={method} std={manualStd || null} takt={usl?.src === 'Takt' ? usl.v : null} xFmt={xFmt} per={perPt}
                  xTitle={xTitle} yTitle={`Mean cycle time per ${by === 'week' ? 'week' : 'day'} (s)`} /> : <Empty>At least 3 subgroups with valid cycles are required.</Empty>)
                : (indSeries?.chart ? <>
                  <MeansChart rows={indSeries.chart.rows} method="mr" std={manualStd || null} takt={null} compact={indSeries.chart.rows.length > 300} height={420} per={indSeries.chart.rows.length > 300 ? 6 : 12}
                    xTitle={`Valid cycle number on ${indDay} (scan order)`} yTitle="Cycle time per scan (s)" />
                  <Note>{int(indSeries.count)} valid cycles · {int(indSeries.removed)} removed · {indSeries.chart.signals} signals</Note>
                </> : <Empty>This day has too few valid cycles.</Empty>)}
            </Card>

            {view === 'means' && D && (
              <Card title={method === 'sigma' ? 'S chart: spread within each subgroup' : 'Moving-range chart: change between consecutive subgroups'}
                sub={method === 'sigma' ? 'Detects a change in how spread out the cycle times are within a day or week.' : 'Detects a sudden jump from one day or week to the next.'}
                formula={method === 'sigma' ? 'CL = c4(n) · σ̂  ·  limits = σ̂ · ( c4(n) ± 3 √(1 − c4(n)²) )  ·  n = cycles in the subgroup' : 'MR = |meanᵢ − meanᵢ₋₁|  ·  CL = MR̄  ·  UCL = 3.267 × MR̄  ·  LCL = 0'}>
                <DispersionChart disp={ch?.disp} method={method} xFmt={xFmt} xTitle={xTitle} />
              </Card>
            )}
          </>
        )}

        {/* ── Distribution & loss ── */}
        {tab === 'dist' && dist && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="min-w-0">
                <div className="text-fs-13 font-semibold text-slate-600">Analysed model</div>
                <div className="text-fs-16 font-bold text-slate-900">{curTitle(dist)}
                  <span className="font-medium text-slate-600"> · {int(dist.vals.length)} valid cycles · mean {sec(dist.mu)} · window {f1(dist.win.lo)}–{Number.isFinite(dist.win.hi) ? f1(dist.win.hi) : '∞'}s</span>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <ModelPicker value={dist.m.mmId} onChange={setDistSel} options={pickerOptions} allLabel="All models (combined)" w="w-72" />
                {distSel && <button type="button" onClick={() => setDistSel('')} className={btnCls}>Use header model</button>}
              </div>
            </div>

            <Card title="Cycle time by second: occurrences and loss"
              formula={fx('bin s = (s−1, s] seconds  ·  valid = Min ≤ gap ≤ Max  ·  above = gap > Max  ·  extra = actual − target  ·  Loss = Σ extra  ·  lost pcs = Loss ÷ target')}>
              <SecondDist a={dist} maxSec={opt.max} defTarget={dDefTarget} defSrc={dDefSrc} canSet={!isAll && dist.m.mmId !== 'ALL' && !!onSetStd} onSetStd={onSetStd} simple={!D} />
            </Card>

            {!D && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-fs-13 text-slate-600">Gap distribution, cycle time by hour and the outlier report are in the <button type="button" className="font-bold text-blue-700 hover:underline" onClick={() => setDetail(true)}>Detailed</button> view.</div>}
            {D && <div className="grid gap-3 xl:grid-cols-2">
              <Card title="Distribution of scan gaps"
                formula="bucket = floor(gap ÷ width)  ·  width = chart range ÷ 40  ·  teal = valid (inside Min–Max)  ·  grey = outlier">
                <Histo h={histogram(dist.allGaps, dist.win, data?.cap || 3600)} win={dist.win} mean={dist.mu} std={dStd || null} />
              </Card>
              <Card title="Cycle time by hour of day"
                formula="bar = Σ valid cycles in the hour ÷ their count  ·  red = more than 10% above model mean  ·  teal = more than 10% below  ·  hours with fewer than 3 cycles are hidden">
                {(() => {
                  const hp = hourPattern(dist.vals, dist.hrs).filter((x) => x.n >= 3);
                  if (!hp.length) return <Empty />;
                  return (
                    <>
                      <ResponsiveContainer width="100%" height={360}>
                        <BarChart data={hp} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
                          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                          <XAxis dataKey="label" tick={tick} tickLine={false} height={50} label={xLab('Hour of day')} />
                          <YAxis tick={tick} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => v.toFixed(0)} label={yLab('Mean cycle time (s)')} />
                          <Tooltip formatter={(v, n, p) => [`${f1(v, 2)}s (n=${int(p.payload.n)})`, 'Mean cycle']} />
                          <ReferenceLine y={dist.mu} stroke="#16A34A" strokeDasharray="5 3" label={{ value: `Mean ${f1(dist.mu)}s`, position: 'insideTopRight', fill: '#16A34A', fontSize: fs(13), fontWeight: 700 }} />
                          <Bar dataKey="mean" radius={[4, 4, 0, 0]}>{hp.map((x) => <Cell key={x.hour} fill={x.mean > dist.mu * 1.1 ? '#DC2626' : x.mean < dist.mu * 0.9 ? '#14B8A6' : '#3B82F6'} />)}</Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <ChartKey items={[['#DC2626', '> 10% above mean'], ['#3B82F6', 'Within ±10%'], ['#14B8A6', '> 10% below mean'], ['#16A34A', 'Model mean', '5 3']]} />
                    </>
                  );
                })()}
              </Card>
            </div>}

            {D && <Card title="Outlier report" sub={`What was removed and why, for ${curTitle(dist)}.`}
              formula={opt.mode === 'manual' ? 'valid if Min ≤ gap ≤ Max' : opt.mode === 'iqr' ? 'valid if Q1 − k·IQR ≤ gap ≤ Q3 + k·IQR  (IQR = Q3 − Q1, clipped to floor / ceiling)' : opt.mode === 'mad' ? 'valid if |gap − median| ≤ k · 1.4826 · MAD  (MAD = median |gap − median|, clipped to floor / ceiling)' : 'valid if gap ≤ k × median  (clipped to floor / ceiling)'}>
              <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Below minimum" value={int(dist.below)} sub={`gaps < ${f1(dist.win.lo)}s (double scans, re-scans)`} bar="bg-amber-500" />
                <Stat label="Above maximum" value={int(dist.above)} sub={`gaps > ${Number.isFinite(dist.win.hi) ? f1(dist.win.hi) : '∞'}s (stops, changeovers)`} bar="bg-orange-500" />
                <Stat label="Above data cap" value={int(dist.over)} sub={`gaps > ${int(data?.cap || 3600)}s (lunch, breakdown)`} bar="bg-red-500" />
                <Stat label="Method" value={MODES[opt.mode].label.replace('Auto · ', '')} sub={Object.entries(dist.win.info).map(([k, v]) => `${k} ${f1(v, 1)}`).join(' · ') || 'user-defined limits'} bar="bg-blue-500" />
              </div>
            </Card>}
          </>
        )}

        {/* ── Data & formulas ── */}
        {tab === 'data' && (
          <>
            {cur && (
              <Card title="Subgroup table" sub={`${curTitle(cur)} · ${cur.sub.length} ${by === 'week' ? 'weekly' : 'daily'} subgroups`}
                right={<button type="button" onClick={exportCsv} className={btnCls}><Download size={14} /> Export CSV</button>}>
                <div className="mt-2 max-h-[560px] overflow-auto">
                  <table className="w-full text-fs-13">
                    <thead className="sticky top-0 z-10 bg-white"><tr className="border-b border-slate-200 text-left">
                      {[by === 'week' ? 'Week of' : 'Date', 'Scans', 'Valid', 'Removed (out of window)', 'Mean (s)', 'Median (s)', 'Spread σ (s)', 'Fastest (s)', 'Slowest (s)', 'Lower limit LCL', 'Upper limit UCL', 'Signals'].map((h) => <th key={h} className={thCls}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {(() => { const m = new Map((ch?.rows || []).map((r) => [r.key, r])); return cur.sub.map((s) => { const r = m.get(s.key); return (
                        <tr key={s.key} className="border-b border-slate-100 tabular-nums">
                          <td className="px-2.5 py-1.5 font-semibold">{s.key}</td><td className="px-2.5">{int(s.qty)}</td><td className="px-2.5">{int(s.n)}</td><td className="px-2.5">{int(s.below + s.above + s.over)}</td>
                          <td className="px-2.5 font-semibold text-teal-700">{sec(s.mean, 2)}</td><td className="px-2.5">{sec(s.med, 2)}</td><td className="px-2.5">{sec(s.sd, 2)}</td>
                          <td className="px-2.5">{sec(s.min)}</td><td className="px-2.5">{sec(s.max)}</td>
                          <td className="px-2.5">{r ? sec(r.lcl, 2) : '—'}</td><td className="px-2.5">{r ? sec(r.ucl, 2) : '—'}</td>
                          <td className={`px-2.5 font-semibold ${r?.rules.length ? 'text-red-600' : 'text-slate-600'}`}>{r?.rules.length ? r.rules.join(', ') : '—'}</td>
                        </tr>); }); })()}
                      {subTotals && (
                        <tr className="sticky bottom-0 border-t-2 border-slate-300 bg-slate-100 font-bold tabular-nums">
                          <td className="px-2.5 py-2">Total</td><td className="px-2.5">{int(subTotals.qty)}</td><td className="px-2.5 text-teal-700">{int(subTotals.n)}</td><td className="px-2.5">{int(subTotals.rem)}</td>
                          <td className="px-2.5 text-teal-700">{sec(subTotals.mu, 2)}</td><td className="px-2.5">{sec(subTotals.med, 2)}</td><td className="px-2.5">{sec(subTotals.sd, 2)}</td>
                          <td className="px-2.5">{sec(subTotals.mn)}</td><td className="px-2.5">{sec(subTotals.mx)}</td>
                          <td className="px-2.5">—</td><td className="px-2.5">—</td><td className="px-2.5">{subTotals.sigs}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card title="Formulas">
              <div className="mt-1 grid gap-2 lg:grid-cols-2">
                {FORMULAS.map(([t, f, n]) => (
                  <div key={t} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-fs-13 font-bold text-slate-900">{t}</div>
                    <div className="break-words text-fs-13 tabular-nums text-slate-800">{f}</div>
                    {n && <div className="mt-0.5 text-fs-13 text-slate-600">{n}</div>}
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}