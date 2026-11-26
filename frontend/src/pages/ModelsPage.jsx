import { fs } from '../theme';
import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  ScatterChart, Scatter, Legend, LabelList,
} from 'recharts';
import { FileSpreadsheet, Printer, Search } from 'lucide-react';
import { fmtDate, getLine, LINE_IDS } from '../api';
import { Card, Stat, PageLoading, StatusChip, Segmented } from '../components/UiKit';
import { Sparkline } from '../components/ChartKit';
import { PAL, SERIES } from '../utils/stats';
import { buildModelRows, dailyByModel, exportModelXlsx, exportCycleTableXlsx, printModelReport, HEALTH_LABEL } from '../utils/modelReport';
import useControlData from '../hooks/useControlData';
import { dmy } from '../utils/stdReport';
import { METHOD_DEFAULTS, modelMethods } from '../utils/targetMethods';
import { currentRule } from '../hooks/useAutoTargets';
import { fromModelRows } from '../utils/ctSummary';
import CtSummaryDialog from '../components/CtSummaryDialog';
import { serverNow } from '../utils/serverTime';

const HEALTH_COLOR = { ok: PAL.green, watch: PAL.amber, behind: PAL.red, idle: '#94A3B8' };
const CLS_COLOR = { A: '#1D4ED8', B: '#B45309', C: '#64748B' };   // 26-11-2026: dark enough for the white letter
const tick = { fontSize: fs(12), fill: '#475569' };
const s1 = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}s`);
const n0 = (v) => Number(v || 0).toLocaleString('en-IN');
const LS_KG = 'ems.stdcycle.kg';
const readKg = () => { try { return JSON.parse(localStorage.getItem(LS_KG) || '{}'); } catch { return {}; } };

function Tip({ active, payload, rows }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-xl px-2.5 py-2 text-fs-13 font-mono min-w-[170px] max-w-[300px]">
      {rows(p).filter(Boolean).map(([k, v, c], i) => (
        i === 0 && k == null
          ? <div key="t" className="font-extrabold text-slate-900 mb-1 break-words">{v}</div>
          : <div key={k} className="flex justify-between gap-3"><span className="text-slate-600">{k}</span><span className={c || 'text-slate-900'}>{v}</span></div>
      ))}
    </div>
  );
}

const COLS = [
  ['rank', '#', 'r'], ['model', 'Model', 'l'], ['company', 'Company', 'l'], ['cls', 'P-Q class', 'c'], ['qty', 'Qty', 'r'], ['aValid', (v) => `Qty valid (${v.lowA}–${v.capA} s)`, 'r'], ['share', 'Share %', 'r'],
  ['cumPct', 'Cumulative %', 'r'], ['days', 'Days made', 'r'], ['perHr', 'Pcs/hr', 'r'], ['mean', 'Avg cycle (s)', 'r'], ['median', 'Median cycle (s)', 'r'],
  ['ach', 'A: most common (s)', 'r'], ['aTarget', 'Target cycle (A+3 s)', 'r'], ['achQty', 'Pcs at A or faster', 'r'], ['achShare', '% at A or faster', 'r'], ['achPph', 'Target A (pcs/hr)', 'r'],
  ['bSec', 'B: 70 % rule (s)', 'r'], ['bValid', 'B valid scans', 'r'], ['bQty', 'Pcs at B or faster', 'r'], ['bPph', 'Target B (pcs/hr)', 'r'],
  ['cSec', 'C: average (s)', 'r'], ['cValid', 'C valid scans', 'r'], ['cQty', 'Pcs at C or faster', 'r'], ['cPph', 'Target C (pcs/hr)', 'r'],
  ['min', 'Fastest – slowest', 'r'], ['takt', 'Takt (s)', 'r'], ['vsTakt', 'vs takt %', 'r'], ['cv', 'Variation (CV)', 'r'], ['rejRate', 'Rejection %', 'r'],
  ['stopMin', 'Stop time (long gaps)', 'r'], ['totalKg', 'Weight', 'r'], ['trend', 'Daily qty', 'l'], ['health', 'Health vs line', 'l'],
];
// table with its own period / line (built from the raw scan gaps only, so no rejections, weight or health)
const CYCLE_KEYS = ['rank', 'model', 'line', 'company', 'qty', 'aValid', 'share', 'cumPct', 'days', 'mean', 'ach', 'aTarget', 'achQty', 'achShare', 'achPph', 'bSec', 'bValid', 'bQty', 'bPph', 'cSec', 'cValid', 'cQty', 'cPph'];
const LINE_COL = ['line', 'Line', 'c'];
const CYC = { A: 'aTarget', B: 'bSec', C: 'cSec' };   // A target = A second + 3 s allowance
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDay = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoDay(d); };
/** The three target methods of every model of model_control.php (same maths as Target methods A/B/C):
 *  A most common cycle · B 70 % rule · C control chart mean → {mmId: {ach, achQty, achShare, achPph, valid, bSec, bPph, cSec, cPph}} */
// valid scans: the target rule's window (default 1–22 s); the table's own filter can try another one
const VALID = () => ({ lowA: currentRule().low ?? 1, capA: currentRule().cap ?? 22 });
const methodsByModel = (models, vo = VALID()) => Object.fromEntries((models || []).map((m) => {
  const r = modelMethods(m, vo);
  return [String(m.mmId), {
    ach: r.A?.sec ?? null, achQty: r.A?.upTo ?? null, achShare: r.A?.share ?? null, achPph: r.A?.pph ?? null, aTarget: r.A?.target ?? null, valid: r.A?.kept ?? null, aValid: r.A?.kept ?? null,
    bSec: r.B?.sec ?? null, bPph: r.B?.pph ?? null, bShare: r.B?.share ?? null, bValid: r.B?.kept ?? null, bQty: r.B?.upTo ?? null,
    cSec: r.C?.sec ?? null, cPph: r.C?.pph ?? null, cShare: r.C?.share ?? null, cValid: r.C?.kept ?? null, cQty: r.C?.upTo ?? null,
    belowLow: r.belowLow, aboveCap: r.aboveCap,
  }];
}));

export default function ModelsPage({ a, takt, loading, error, onPickModel, meta = [], children, line: lineProp, range = null, companyId = null, targets = null, onSetTargets = null }) {
  // achieved cycle needs the raw gaps per model (same data as Control charts / Model explorer)
  const cd = useControlData({ start: range?.start, end: range?.end, companyId, line: lineProp ?? getLine(), enabled: !!range });
  // valid-scan window of the table: starts as the target rule; changed here only for this page (analysis, not applied)
  const [vo, setVo] = useState(VALID);
  const ruleVo = VALID();
  const voChanged = vo.lowA !== ruleVo.lowA || vo.capA !== ruleVo.capA;
  const mMap = useMemo(() => methodsByModel(cd.data?.models, vo), [cd.data, vo]);
  // the table's own period + line (default: the dashboard period and line)
  const dashLine = String(lineProp ?? getLine());
  const anchor = range?.end || a?.endDate || isoDay(serverNow());
  const [tf, setTf] = useState({ per: 'dash', line: 'this', start: '', end: '' });
  const tLine = tf.line === 'this' ? dashLine : tf.line;
  const tRange = tf.per === 'dash' ? range
    : tf.per === 'custom' ? (tf.start && tf.end && tf.start <= tf.end ? { start: tf.start, end: tf.end } : null)
      : { start: shiftDay(anchor, -(Number(tf.per) - 1)), end: anchor };
  const own = tf.per !== 'dash' || tLine !== dashLine;   // the table follows its own filter, not the dashboard's
  const cd2 = useControlData({ start: tRange?.start, end: tRange?.end, companyId: tLine === 'all' ? '' : companyId, line: tLine, enabled: own && !!tRange });
  const ownRows = useMemo(() => {
    if (!own || !cd2.data) return [];
    const ms = cd2.data.models || [];
    const mm = methodsByModel(ms, vo);
    const list = ms.map((m) => {
      const r = modelMethods(m, vo);
      const id = String(m.mmId);
      return { mmId: id, model: m.model, modelCode: m.modelCode, company: m.company, line: m.line || tLine, qty: r.qty, days: r.days, mean: r.avg, ...(mm[id] || {}) };
    }).filter((r) => r.qty > 0).sort((x, y) => y.qty - x.qty);
    const tot = list.reduce((x, r) => x + r.qty, 0);
    let cum = 0;
    return list.map((r, i) => { cum += r.qty; return { ...r, rank: i + 1, share: tot ? (r.qty / tot) * 100 : 0, cumPct: tot ? (cum / tot) * 100 : 0 }; });
  }, [own, cd2.data, tLine, vo]);
  const [achMsg, setAchMsg] = useState('');
  const [achAsk, setAchAsk] = useState(false);
  const [top, setTop] = useState('20');
  const [sortKey, setSortKey] = useState('qty');
  const [dir, setDir] = useState(-1);
  const [showLow, setShowLow] = useState(true);
  const [q, setQ] = useState('');
  const [explain, setExplain] = useState(true);
  const [ctOpen, setCtOpen] = useState(false);

  const base = useMemo(() => buildModelRows(a, takt, meta, readKg()), [a, takt, meta]);
  const rows = useMemo(() => base.rows.map((r) => ({ ...r, ...(mMap[String(r.mmId)] || {}) })), [base, mMap]);
  const { totals } = base;
  const daily = useMemo(() => (a ? dailyByModel(a, rows, 6) : []), [a, rows]);

  if (!a) return <PageLoading loading={loading} error={error} />;

  const line = getLine();
  const lineLabel = line === 'all' ? 'All lines' : `Line ${line}`;
  const reportMeta = { lineLabel, start: a.startDate, end: a.endDate, generatedAt: serverNow(), low: vo.lowA, cap: vo.capA };
  const nTop = top === 'all' ? rows.length : Number(top);
  const pq = rows.slice(0, nTop).map((r) => ({ ...r, name: r.model }));
  const cyc = rows.filter((r) => r.mean != null).slice(0, nTop).map((r) => ({ ...r, name: r.model }));
  const globalTakt = Number(takt?.taktSec) > 0 ? Number(takt.taktSec) : null;
  const heads = rows.slice(0, 6);
  const dailyData = daily.map((d) => ({ ...d, label: fmtDate(d.date) }));
  const multiDay = dailyData.length > 1;

  const needle = q.trim().toUpperCase();
  const tRows = own ? ownRows : rows;
  const cols = own ? CYCLE_KEYS.filter((k) => k !== 'line' || tLine === 'all').map((k) => (k === 'line' ? LINE_COL : COLS.find((c) => c[0] === k))) : COLS;
  const canSet = !!onSetTargets && tLine === dashLine;     // targets are saved for the dashboard's line only
  const showExplain = explain && !own;
  const visible = tRows.filter((r) => (showLow || !r.isLowVolume) && (!needle || `${r.model} ${r.modelCode || ''} ${r.company}`.toUpperCase().includes(needle)));
  const sorted = [...visible].sort((x, y) => {
    const A = x[sortKey], B = y[sortKey];
    if (A == null && B == null) return 0;
    if (A == null) return 1;
    if (B == null) return -1;
    return (typeof A === 'string' ? A.localeCompare(B) : A - B) * dir;
  });
  const counts = { ok: rows.filter((r) => r.health === 'ok').length, watch: rows.filter((r) => r.health === 'watch').length, behind: rows.filter((r) => r.health === 'behind').length };
  const bubble = rows.filter((r) => r.mean != null);
  const hours = [...new Set(Object.values(a.modelHour || {}).flatMap((x) => Object.keys(x).map(Number)))].sort((x, y) => x - y);
  const heatModels = rows.slice(0, 18);
  const heatMax = Math.max(1, ...heatModels.flatMap((m) => hours.map((hr) => a.modelHour?.[m.mmId]?.[hr] ?? 0)));
  const top3 = rows.slice(0, 3);

  const cell = (r, k) => {
    switch (k) {
      case 'model': return <span className="font-bold">{r.model}{r.modelCode && <span className="ml-1 text-fs-10 text-slate-600 font-normal">{r.modelCode}</span>}{r.isLowVolume && <span className="ml-1 text-fs-10 text-slate-600 font-normal">low-vol</span>}</span>;
      case 'company': return <span className="font-sans">{r.company || '—'}</span>;
      case 'cls': return <span className="inline-block w-6 rounded font-extrabold text-white text-center" style={{ background: CLS_COLOR[r.cls] }}>{r.cls}</span>;
      case 'qty': return <b>{n0(r.qty)}</b>;
      case 'share': return `${r.share.toFixed(1)}%`;
      case 'cumPct': return `${r.cumPct.toFixed(1)}%`;
      case 'perHr': return r.perHr ? r.perHr.toFixed(1) : '—';
      case 'mean': return <b className="text-sky-700">{s1(r.mean)}</b>;
      case 'median': return s1(r.median);
      case 'ach': return r.ach != null ? <span className="rounded bg-slate-50 px-1.5 py-0.5 font-bold text-slate-900">{r.ach} s</span> : (cd.loading ? '…' : '—');
      case 'achQty': case 'aValid': case 'bValid': case 'bQty': case 'cValid': case 'cQty': return r[k] != null ? n0(r[k]) : '—';
      case 'aTarget': return r.aTarget != null ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-extrabold text-slate-950" title={`method A ${r.ach} s + 3 s`}>{r.aTarget} s</span> : (cd.loading ? '…' : '—');
      case 'achShare': return r.achShare != null ? `${r.achShare.toFixed(1)}%` : '—';
      case 'achPph': {
        if (r.achPph == null) return '—';
        const curT = Number(targets?.[String(r.mmId)]?.cycle) || null;
        const same = curT != null && Math.abs(curT - (r.aTarget ?? r.ach)) < 0.01;
        return (
          <span className="inline-flex items-center gap-1.5">
            <b>{Math.round(r.achPph)}/hr</b>
            {canSet && (same
              ? <span className="rounded bg-sky-50 px-1 text-fs-11 font-sans font-bold text-sky-800">set</span>
              : <button type="button" onClick={(e) => { e.stopPropagation(); onSetTargets([{ mmId: Number(r.mmId), cycle: r.aTarget ?? r.ach, model: r.model, company: r.company || '' }]).then(() => setAchMsg(`Target of ${r.model} = ${r.aTarget ?? r.ach} s (method A ${r.ach} s + 3 s · ${Math.round(r.achPph)}/hr).`)).catch((x) => setAchMsg(`Could not save: ${x.message}`)); }}
                  title={curT ? `Current target ${curT} s — replace with method A ${r.ach} s + 3 s = ${r.aTarget} s` : `Target = method A ${r.ach} s + 3 s = ${r.aTarget} s`}
                  className="rounded border border-blue-600 bg-white px-1.5 text-fs-11 font-sans font-bold text-blue-800 hover:bg-blue-50">{curT ? 'Replace' : 'Set'}</button>)}
          </span>
        );
      }
      case 'bSec': case 'cSec': {
        const v = r[k];
        return v != null ? <span className={`rounded px-1.5 py-0.5 font-bold ${k === 'bSec' ? 'bg-sky-50 text-sky-900' : 'bg-blue-50 text-blue-900'}`}>{v} s</span> : (cd.loading || cd2.loading ? '…' : '—');
      }
      case 'bPph': case 'cPph': {
        const m = k === 'bPph' ? 'B' : 'C';
        const pph = r[k], cyc = r[m === 'B' ? 'bSec' : 'cSec'];
        if (pph == null) return '—';
        const curT = Number(targets?.[String(r.mmId)]?.cycle) || null;
        const same = curT != null && Math.abs(curT - cyc) < 0.01;
        return (
          <span className="inline-flex items-center gap-1.5">
            <b>{Math.round(pph)}/hr</b>
            {canSet && (same
              ? <span className="rounded bg-sky-50 px-1 text-fs-11 font-sans font-bold text-sky-800">set</span>
              : <button type="button" onClick={(e) => { e.stopPropagation(); onSetTargets([{ mmId: Number(r.mmId), cycle: cyc, model: r.model, company: r.company || '' }]).then(() => setAchMsg(`Target of ${r.model} = ${cyc} s (${Math.round(pph)}/hr, method ${m}).`)).catch((x) => setAchMsg(`Could not save: ${x.message}`)); }}
                  title={curT ? `Current target ${curT} s — replace with method ${m} ${cyc} s` : `Set the method ${m} cycle as this model's target`}
                  className="rounded border border-blue-600 bg-white px-1.5 text-fs-11 font-sans font-bold text-blue-800 hover:bg-blue-50">{curT ? 'Replace' : 'Set'}</button>)}
          </span>
        );
      }
      case 'line': return <span className="font-sans font-bold">L{r.line}</span>;
      case 'min': return r.min != null ? `${s1(r.min)} – ${s1(r.max)}` : '—';
      case 'takt': return s1(r.takt);
      case 'vsTakt': return r.vsTakt != null ? <span className={r.vsTakt > 10 ? 'text-red-600 font-bold' : r.vsTakt > 0 ? 'text-slate-600 font-bold' : 'text-sky-600 font-bold'}>{r.vsTakt > 0 ? '+' : ''}{r.vsTakt.toFixed(1)}%</span> : '—';
      case 'cv': return r.cv != null ? <span className={r.cv > 30 ? 'text-red-600' : r.cv > 15 ? 'text-slate-600' : ''}>{r.cv}%</span> : '—';
      case 'rejRate': return <span className={r.rejRate > 2 ? 'text-red-600 font-bold' : ''}>{r.rejRate ? `${r.rejRate}%` : '0'}</span>;
      case 'stopMin': return r.stopMin >= 1 ? `${Math.round(r.stopMin)} min` : '0';
      case 'totalKg': return r.totalKg != null ? `${n0(Math.round(r.totalKg))} kg` : '—';
      case 'trend': return <Sparkline values={r.trend} />;
      case 'health': return <StatusChip s={r.health} labels={HEALTH_LABEL} />;
      default: return r[k];
    }
  };

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-fs-13 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50';

  return (
    <div className={`space-y-3 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      {ctOpen && <CtSummaryDialog rows={fromModelRows(own ? sorted : rows, own ? tLine : dashLine)} opts={{ ...METHOD_DEFAULTS, ...vo }} range={own && tRange ? tRange : { start: a.startDate, end: a.endDate }}
        lineText={(own ? tLine : dashLine) === 'all' ? 'All lines' : `Line ${own ? tLine : dashLine}`} onClose={() => setCtOpen(false)} />}
      {/* period header + export */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 mr-auto">
          <div className="text-fs-16 font-extrabold text-slate-950">Model-wise production · {lineLabel}</div>
          <div className="text-fs-13 font-semibold text-slate-600">
            Period <span className="font-mono text-slate-900">{dmy(a.startDate)}</span> to <span className="font-mono text-slate-900">{dmy(a.endDate)}</span>
            {' '}· {totals.days} day{totals.days === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-fs-12 font-bold text-slate-600 uppercase">Charts</span>
          <Segmented value={top} onChange={setTop} options={[['10', 'Top 10'], ['20', 'Top 20'], ['all', 'All']]} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={own ? !sorted.length : !rows.length} onClick={() => (own
              ? exportCycleTableXlsx(sorted, { lineLabel: tLine === 'all' ? 'All lines' : `Line ${tLine}`, start: tRange?.start, end: tRange?.end, generatedAt: serverNow(), low: vo.lowA, cap: vo.capA })
              : exportModelXlsx(sorted.length === rows.length ? rows : sorted, totals, daily, reportMeta))}
            className={`${btn} border-sky-600 bg-sky-600 text-white hover:bg-sky-700`} title="Download Excel: model table, daily qty by model, daily avg cycle">
            <FileSpreadsheet size={15} /> Excel
          </button>
          <button type="button" disabled={!(own ? sorted : rows).some((r) => r.ach != null && r.bSec != null)}
            onClick={() => setCtOpen(true)}
            className={`${btn} border-sky-700 bg-white text-sky-800 hover:bg-sky-50`} title="Cycle time summary: Samsung, Voltas, Godrej and Remaining sheets — Max achieved CT %, Method A, Method B, Avg cycle">
            <FileSpreadsheet size={15} /> CT summary
          </button>
          <button type="button" disabled={!rows.length || own} onClick={() => printModelReport(sorted.length === rows.length ? rows : sorted, totals, reportMeta)}
            className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} title="Print the model table with line, period and date">
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        <Stat label="Total production" value={n0(totals.qty)} sub={`${n0(Math.round(totals.perDay))} pcs / working day`} />
        <Stat label="Models made" value={totals.models} sub={`A ${totals.clsCount.A} · B ${totals.clsCount.B} · C ${totals.clsCount.C}`} bar="bg-blue-600" />
        <Stat label="Avg cycle (period)" value={s1(totals.avgCycle)} sub={`median ${s1(totals.medianCycle)} · P90 ${s1(totals.p90Cycle)}`} tone="text-sky-700" bar="bg-sky-500" />
        <Stat label="Top model" value={top3[0] ? `${top3[0].share.toFixed(1)}%` : '—'} sub={top3[0]?.model ?? '—'} bar="bg-blue-500" />
        <Stat label="Health vs line" value={<span><span className="text-sky-600">{counts.ok}</span> · <span className="text-slate-600">{counts.watch}</span> · <span className="text-red-600">{counts.behind}</span></span>} sub="healthy · watch · attention" bar="bg-sky-500" />
        {totals.kgCoverage >= 95
          ? <Stat label="Weight shipped" value={`${(totals.totalKg / 1000).toFixed(1)} t`} sub={`weight known for ${totals.kgCoverage.toFixed(0)}% of pcs`} bar="bg-slate-500" />
          : <Stat label="Weight shipped" value={totals.totalKg ? `≥ ${(totals.totalKg / 1000).toFixed(1)} t` : '—'} sub={<span className="text-slate-700">only {totals.kgCoverage.toFixed(0)}% of pcs have a weight — add the missing ones in Standard cycle time</span>} bar="bg-slate-500" />}
      </div>

      {/* P-Q chart */}
      <Card title="P-Q chart — quantity by model" sub={`${top === 'all' ? 'All' : `Top ${Math.min(nTop, rows.length)} of`} ${rows.length} models · bars = qty (colour = class) · violet line = cumulative % · dashed red = 80 %, amber = 95 %`}
        formula="sorted by qty · share = qty ÷ total · class A = first 80 % of output, B = up to 95 %, C = the rest"
        right={<div className="flex gap-2 text-fs-12 font-bold">{['A', 'B', 'C'].map((c) => <span key={c} className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: CLS_COLOR[c] }} />{c} ({totals.clsCount[c]})</span>)}</div>}>
        {pq.length ? (
          <div className="overflow-x-auto -mx-1 px-1">
            <div style={{ minWidth: pq.length * 34 + 110 }}>
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={pq} margin={{ top: 18, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="name" tick={{ ...tick, fontSize: fs(11), fontFamily: 'monospace' }} interval={0} angle={-40} textAnchor="end" height={86} tickLine={false} />
                  <YAxis yAxisId="v" tick={tick} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => n0(v)} />
                  <YAxis yAxisId="p" orientation="right" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={tick} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                  <Tooltip cursor={{ fill: 'rgba(29,78,216,0.06)' }} content={<Tip rows={(p) => [[null, `#${p.rank} ${p.model}`], ['Company', p.company || '—'], ['Qty', n0(p.qty), 'font-bold'], ['Share', `${p.share.toFixed(1)}%`], ['Cumulative', `${p.cumPct.toFixed(1)}%`], ['Class', p.cls, p.cls === 'A' ? 'text-blue-700 font-bold' : p.cls === 'B' ? 'text-slate-600 font-bold' : 'text-slate-600'], ['Avg cycle', s1(p.mean), 'text-sky-700'], ['Days made', `${p.days}`]]} />} />
                  <ReferenceLine yAxisId="p" y={80} stroke={PAL.red} strokeDasharray="5 3" />
                  <ReferenceLine yAxisId="p" y={95} stroke={PAL.amber} strokeDasharray="5 3" />
                  <Bar yAxisId="v" dataKey="qty" radius={[4, 4, 0, 0]} maxBarSize={44} cursor="pointer" onClick={(d) => onPickModel(d?.mmId ?? d?.payload?.mmId)}>
                    {pq.map((d) => <Cell key={d.mmId} fill={CLS_COLOR[d.cls]} />)}
                    {pq.length <= 40 && <LabelList dataKey="qty" position="top" formatter={(v) => n0(v)} style={{ fontSize: fs(10.5), fill: '#334155', fontWeight: 700 }} />}
                  </Bar>
                  <Line yAxisId="p" type="monotone" dataKey="cumPct" stroke={PAL.violet} strokeWidth={2.2} dot={{ r: 3, fill: PAL.violet, stroke: '#fff', strokeWidth: 1 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">No production in this period</div>}
      </Card>

      {/* production per day by model + avg cycle per day */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Production quantity — day by day, model-wise" sub={`stacked: top ${heads.length} models + others · number on top = day total`} formula="qty per day per model = valid scans of that model on that day">
          {dailyData.length ? (
            <div className="overflow-x-auto -mx-1 px-1"><div style={{ minWidth: dailyData.length * 44 + 70 }}>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={dailyData} margin={{ top: 18, right: 6, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={{ ...tick, fontSize: fs(11) }} tickLine={false} interval={0} />
                <YAxis tick={tick} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => n0(v)} />
                <Tooltip content={<Tip rows={(p) => [[null, `${dmy(p.date)} · ${n0(p.total)} pcs`], ...heads.map((m) => (p[`m${m.mmId}`] ? [m.model, n0(p[`m${m.mmId}`])] : null)), p.others ? ['Others', n0(p.others)] : null]} />} />
                <Legend wrapperStyle={{ fontSize: fs(11.5), fontFamily: 'monospace' }} iconSize={10} />
                {heads.map((m, i) => <Bar key={m.mmId} dataKey={`m${m.mmId}`} name={m.model} stackId="d" fill={SERIES[i % SERIES.length]} maxBarSize={46} isAnimationActive={false} />)}
                <Bar dataKey="others" name="Others" stackId="d" fill="#94A3B8" maxBarSize={46} isAnimationActive={false}>
                  {dailyData.length <= 31 && <LabelList dataKey="total" position="top" formatter={(v) => n0(v)} style={{ fontSize: fs(10.5), fill: '#0F172A', fontWeight: 800 }} />}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
            </div></div>
          ) : <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">No data</div>}
        </Card>

        <Card title="Avg cycle — day by day" sub={`selected period average ${s1(totals.avgCycle)} (dashed)${globalTakt ? ` · takt ${s1(globalTakt)} (red)` : ''}`} formula="day avg = mean of that day's valid gaps · period avg = mean of all valid gaps in the period (not the mean of day averages)">
          {dailyData.some((d) => d.mean != null) ? (
            <div className="overflow-x-auto -mx-1 px-1"><div style={{ minWidth: dailyData.length * 44 + 60 }}>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={dailyData} margin={{ top: 18, right: 10, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={{ ...tick, fontSize: fs(11) }} tickLine={false} interval={0} />
                <YAxis tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}s`} domain={[(min) => Math.max(0, Math.floor(min * 0.85)), (max) => Math.ceil(Math.max(max, globalTakt || 0) * 1.08)]} />
                <Tooltip content={<Tip rows={(p) => [[null, dmy(p.date)], ['Qty', n0(p.total)], ['Avg cycle', s1(p.mean), 'text-sky-700 font-bold'], ['Median', s1(p.median)], ['P90', s1(p.p90)]]} />} />
                <Legend wrapperStyle={{ fontSize: fs(11.5) }} iconSize={10} />
                {totals.avgCycle != null && <ReferenceLine y={totals.avgCycle} stroke="#0F766E" strokeDasharray="6 4" />}
                {globalTakt && <ReferenceLine y={globalTakt} stroke={PAL.red} strokeWidth={1.5} label={{ value: `takt ${s1(globalTakt)}`, position: 'insideBottomRight', fill: PAL.red, fontSize: fs(11) }} />}
                <Line type="linear" dataKey="mean" name="Avg cycle" stroke={PAL.teal} strokeWidth={2.5} dot={multiDay ? { r: 3.5, fill: PAL.teal, stroke: '#fff', strokeWidth: 1.5 } : { r: 6, fill: PAL.teal }} connectNulls isAnimationActive={false}>
                  {dailyData.length <= 31 && <LabelList dataKey="mean" position="top" formatter={(v) => (v == null ? '' : Number(v).toFixed(1))} style={{ fontSize: fs(10.5), fill: '#0F766E', fontWeight: 700 }} />}
                </Line>
                <Line type="linear" dataKey="median" name="Median" stroke={PAL.blue} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            </div></div>
          ) : <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">No valid cycles in this period</div>}
        </Card>
      </div>

      {/* avg cycle per model */}
      <Card title="Avg cycle by model — selected period" sub={`same models as the P-Q chart · bar = avg cycle · colour: green ≤ takt, amber ≤ 110 %, red > 110 % · dashed = period avg ${s1(totals.avgCycle)}`}
        formula="avg cycle = mean of the model's valid gaps over the whole period · vs takt = (avg ÷ takt − 1) × 100">
        {cyc.length ? (
          <div className="overflow-x-auto -mx-1 px-1">
            <div style={{ minWidth: cyc.length * 34 + 70 }}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={cyc} margin={{ top: 18, right: 6, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="name" tick={{ ...tick, fontSize: fs(11), fontFamily: 'monospace' }} interval={0} angle={-40} textAnchor="end" height={86} tickLine={false} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}s`} />
                  <Tooltip cursor={{ fill: 'rgba(1,184,170,0.07)' }} content={<Tip rows={(p) => [[null, p.model], ['Avg cycle', s1(p.mean), 'text-sky-700 font-bold'], ['Median', s1(p.median)], ['Min / Max', `${s1(p.min)} / ${s1(p.max)}`], ['Takt', s1(p.takt)], ['vs Takt', p.vsTakt != null ? `${p.vsTakt > 0 ? '+' : ''}${p.vsTakt.toFixed(1)}%` : '—'], ['CV', p.cv != null ? `${p.cv}%` : '—'], ['Valid cycles', n0(p.n)]]} />} />
                  {totals.avgCycle != null && <ReferenceLine y={totals.avgCycle} stroke="#0F766E" strokeDasharray="6 4" />}
                  {globalTakt && <ReferenceLine y={globalTakt} stroke={PAL.red} strokeWidth={1.5} label={{ value: `takt ${s1(globalTakt)}`, position: 'insideTopRight', fill: PAL.red, fontSize: fs(11) }} />}
                  <Bar dataKey="mean" radius={[4, 4, 0, 0]} maxBarSize={40} cursor="pointer" onClick={(d) => onPickModel(d?.mmId ?? d?.payload?.mmId)} isAnimationActive={false}>
                    {cyc.map((d) => <Cell key={d.mmId} fill={d.ratio == null ? PAL.teal : d.ratio <= 1 ? PAL.green : d.ratio <= 1.1 ? PAL.amber : PAL.red} />)}
                    {cyc.length <= 40 && <LabelList dataKey="mean" position="top" formatter={(v) => Number(v).toFixed(1)} style={{ fontSize: fs(10.5), fill: '#334155', fontWeight: 700 }} />}
                  </Bar>
                  <Line dataKey="median" stroke={PAL.blue} strokeWidth={0} dot={{ r: 3.5, fill: '#fff', stroke: PAL.blue, strokeWidth: 2 }} activeDot={false} isAnimationActive={false} legendType="none" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">No valid cycles in this period</div>}
        <div className="mt-1 text-fs-12 font-semibold text-slate-600">○ = median of the model</div>
      </Card>

      {/* model table with explanation */}
      <Card title="All models — explained" sub={`${sorted.length} of ${tRows.length} models · ${own ? `${tLine === 'all' ? 'All lines' : `Line ${tLine}`} · ${tRange ? `${dmy(tRange.start)} to ${dmy(tRange.end)}` : 'pick both dates'} (table filter)` : 'dashboard period and line'}`}
        formula={`Three targets, same maths as Target methods A/B/C. Valid scans = the scans each method keeps after its filter (A, B and C: gaps ${vo.lowA}–${vo.capA} s); ≤ pcs = valid scans at the method's cycle or faster. Method A = the whole second with the most cycles (gaps ${vo.lowA}–${vo.capA} s), ≤ A = cycles at that second or faster · Method B = smallest whole second within which 70 % of the pieces were made (gaps ${vo.lowA}–${vo.capA} s, same as Control charts) · Method C = control chart centre line = mean of the gaps ${vo.lowA}–${vo.capA} s · Target = 3600 ÷ cycle (pcs/hr) · Pcs/hr = qty ÷ active hours · vs Takt = (avg ÷ takt − 1) × 100 · Health vs THIS line (CV ${totals.lineCv ?? '—'}%, rej ${totals.rejRate.toFixed(1)}%): Attention if vs Takt > +10 % or CV ≥ 1.5× line or Rej ≥ 1.5× line · Watch if > 0 % or ≥ 1.2× line`}
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model / company" aria-label="Search model or company"
                className="pl-7 pr-2 py-1 w-[190px] rounded-lg border border-slate-300 text-fs-13 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <Segmented value={showLow ? 'all' : 'main'} onChange={(v) => setShowLow(v === 'all')} options={[['all', 'All'], ['main', 'Hide low-vol']]} />
            <Segmented value={explain ? 'on' : 'off'} onChange={(v) => setExplain(v === 'on')} options={[['on', 'Explain'], ['off', 'Compact']]} />
            {canSet && (achAsk ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-fs-13 font-bold text-blue-950">
                Set {visible.filter((r) => r[CYC[achAsk]]).length} targets from method {achAsk}?
                <button type="button" className="rounded bg-blue-700 px-2 py-0.5 text-white" onClick={async () => {
                  const m = achAsk; setAchAsk(false);
                  const items = visible.filter((r) => r[CYC[m]]).map((r) => ({ mmId: Number(r.mmId), cycle: r[CYC[m]], model: r.model, company: r.company || '' }));
                  try { await onSetTargets(items); setAchMsg(`${items.length} targets set from method ${m}.`); } catch (x) { setAchMsg(`Could not save: ${x.message}`); }
                }}>Yes, set</button>
                <button type="button" className="rounded border border-slate-400 bg-white px-2 py-0.5 text-slate-800" onClick={() => setAchAsk(false)}>Cancel</button>
              </span>
            ) : (
              <>
              {[['A', 'border-slate-600 text-slate-900 hover:bg-slate-50', 'most common cycle'], ['B', 'border-sky-700 text-sky-900 hover:bg-sky-50', '70 % of pieces made within it'], ['C', 'border-blue-600 text-blue-900 hover:bg-blue-50', 'control chart average']].map(([m, cls, why]) => (
                <button key={m} type="button" disabled={!visible.some((r) => r[CYC[m]])} onClick={() => { setAchMsg(''); setAchAsk(m); }}
                  className={`rounded-lg border bg-white px-2.5 py-1.5 text-fs-13 font-bold disabled:opacity-50 ${cls}`}
                  title={`Target cycle of every model shown = its method ${m} cycle (${why})`}>Use method {m} as targets</button>
              ))}
              </>
            ))}
            {achMsg && <span role="status" className={`text-fs-13 font-bold ${achMsg.startsWith('Not') ? 'text-red-700' : 'text-sky-700'}`}>{achMsg}</span>}
          </div>
        )}>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" role="group" aria-label="Table filter">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fs-13 font-bold text-slate-800">Period</span>
            <Segmented value={tf.per} onChange={(v) => setTf((t) => ({ ...t, per: v, ...(v === 'custom' && !t.start && tRange ? { start: tRange.start, end: tRange.end } : {}) }))}
              options={[['dash', 'Dashboard'], ['1', 'Day'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['custom', 'Dates']]} />
            {tf.per === 'custom' && (
              <span className="inline-flex items-center gap-1.5">
                <input type="date" aria-label="Table from date" value={tf.start} max={tf.end || undefined} onChange={(e) => setTf((t) => ({ ...t, start: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-fs-13 font-semibold" />
                <span className="text-slate-700">→</span>
                <input type="date" aria-label="Table to date" value={tf.end} min={tf.start || undefined} onChange={(e) => setTf((t) => ({ ...t, end: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-fs-13 font-semibold" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fs-13 font-bold text-slate-800">Line</span>
            <Segmented value={tf.line} onChange={(v) => setTf((t) => ({ ...t, line: v }))}
              options={[['this', dashLine === 'all' ? 'Dashboard' : `This (L${dashLine})`], ...LINE_IDS.filter((l) => l !== dashLine).map((l) => [l, `Line ${l}`]), ...(dashLine === 'all' ? [] : [['all', 'All lines']])]} />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Valid scans filter">
            <span className="text-fs-13 font-bold text-slate-800">Valid gaps</span>
            <input key={`lo${vo.lowA}`} type="number" min="0" max="60" step="0.1" aria-label="Table lowest valid gap seconds" title="Gaps below this are eliminated (double scans, glitches)" defaultValue={vo.lowA}
              onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n < vo.capA) setVo((v) => ({ ...v, lowA: Math.round(n * 10) / 10 })); else e.target.value = vo.lowA; }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="h-8 w-16 rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold" />
            <span className="text-slate-700">–</span>
            <input key={`hi${vo.capA}`} type="number" min="5" max="300" aria-label="Table highest valid gap seconds" title="Gaps above this are eliminated (stops, changeovers)" defaultValue={vo.capA}
              onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > vo.lowA && n >= 5 && n <= 300) setVo((v) => ({ ...v, capA: Math.round(n) })); else e.target.value = vo.capA; }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="h-8 w-16 rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold" />
            <span className="text-fs-13 text-slate-700">s</span>
            {voChanged && <button type="button" onClick={() => setVo(VALID())} className="text-fs-13 font-bold text-blue-800 underline">Back to the rule ({ruleVo.lowA}–{ruleVo.capA} s)</button>}
          </div>
          {own && <button type="button" onClick={() => setTf({ per: 'dash', line: 'this', start: '', end: '' })} className="text-fs-13 font-bold text-blue-800 underline">Back to dashboard filter</button>}
          {own && (cd2.loading ? <span className="text-fs-13 font-semibold text-blue-800">Loading…</span> : cd2.error ? <span className="text-fs-13 font-semibold text-red-700">{cd2.error}</span> : null)}
          {(() => {
            const src = own ? cd2.data?.models : cd.data?.models;
            if (!src?.length) return null;
            let g = 0, lo = 0, hi = 0;
            for (const m of src) for (const d of Object.values(m.days || {})) for (const x of d.g || []) { g++; if (x < vo.lowA) lo++; else if (x > vo.capA) hi++; }
            return (
              <span className={`basis-full flex flex-wrap gap-x-4 gap-y-0.5 rounded-md px-2 py-1 font-mono text-fs-13 ${voChanged ? 'bg-amber-100 text-amber-950' : 'bg-white text-slate-800'}`} aria-label="Valid scans of the table">
                <b className="font-sans">{voChanged ? 'Trying' : 'Target rule'}: valid gaps {vo.lowA}–{vo.capA} s</b>
                <span>gaps {n0(g)}</span><span>&lt; {vo.lowA} s out <b className="text-red-700">{n0(lo)}</b></span><span>&gt; {vo.capA} s out <b className="text-red-700">{n0(hi)}</b></span><span>valid <b className="text-emerald-800">{n0(g - lo - hi)}</b></span>
                {voChanged && <span className="font-sans">— only this table, its Excel and CT summary; targets on the screens stay on the rule (change it on Target rule & check after analysing).</span>}
              </span>
            );
          })()}
          {own && <span className="basis-full text-fs-13 font-medium text-slate-700">Table built from the scan gaps of the chosen period and line: qty, cycle and the three targets A, B, C. Rejections, weight and health follow the dashboard filter.</span>}
        </div>
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto border border-slate-200 rounded-lg">
          <table className="w-full text-fs-13 border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-800 text-white"><tr>
              {cols.map(([k, l, al]) => (
                <th key={k} onClick={() => { if (k === 'trend' || k === 'explain') return; setDir(sortKey === k ? -dir : (k === 'model' || k === 'company' || k === 'rank' ? 1 : -1)); setSortKey(k); }}
                  className={`px-2 py-2 font-bold whitespace-nowrap select-none border-r border-slate-600 ${k === 'model' ? 'sticky left-0 z-20 bg-slate-800' : ''} ${al === 'r' ? 'text-right' : al === 'c' ? 'text-center' : 'text-left'} ${k !== 'trend' && k !== 'explain' ? 'cursor-pointer hover:text-slate-300' : ''}`}>
                  {typeof l === 'function' ? l(vo) : l}{sortKey === k ? (dir < 0 ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr></thead>
            <tbody>{sorted.map((r, i) => {
              const bg = i % 2 ? 'bg-slate-50' : 'bg-white';
              return (
                <React.Fragment key={r.mmId}>
                  <tr onClick={own ? undefined : () => onPickModel(r.mmId)} className={`group font-mono ${own ? '' : 'cursor-pointer'} hover:bg-blue-50 ${bg} ${showExplain ? '' : 'border-b border-slate-200'}`}>
                    {cols.map(([k, , al]) => (
                      <td key={k} className={`px-2 py-1.5 whitespace-nowrap border-r border-slate-200 ${al === 'r' ? 'text-right' : al === 'c' ? 'text-center' : 'text-left'} ${k === 'model' ? `sticky left-0 z-[1] ${bg} group-hover:bg-blue-50` : ''}`}>{cell(r, k)}</td>
                    ))}
                  </tr>
                  {showExplain && (
                    <tr className={`border-b border-slate-300 ${bg}`}>
                      <td colSpan={cols.length} className="px-2 pb-2 pt-0">
                        <div className="sticky left-2 max-w-[min(1100px,calc(100vw-48px))] whitespace-normal text-fs-13 leading-snug text-slate-700 font-medium border-l-4 pl-2" style={{ borderColor: CLS_COLOR[r.cls] }}>
                          {r.explain}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!sorted.length && <tr><td colSpan={cols.length} className="py-8 text-center text-slate-600 font-semibold">{own && cd2.loading ? 'Loading…' : 'No model matches'}</td></tr>}
            </tbody>
            <tfoot className="sticky bottom-0 z-30 bg-slate-200 font-mono font-extrabold text-slate-900 shadow-[0_-2px_4px_rgba(15,23,42,0.12)]">
              {own ? (
                <tr>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 sticky left-0 z-10 bg-slate-200 whitespace-nowrap">Total</td>
                  <td colSpan={tLine === 'all' ? 2 : 1} />
                  <td className="px-2 py-2 text-right">{n0(visible.reduce((x, r) => x + r.qty, 0))}</td>
                  <td colSpan={cols.length - (tLine === 'all' ? 5 : 4)} />
                </tr>
              ) : (
              <tr>
                <td className="px-2 py-2" />
                <td className="px-2 py-2 sticky left-0 z-10 bg-slate-200 whitespace-nowrap">Total / period</td>
                <td colSpan={2} className="px-2 py-2 text-center">A {totals.clsCount.A} · B {totals.clsCount.B} · C {totals.clsCount.C}</td>
                <td className="px-2 py-2 text-right">{n0(totals.qty)}</td>
                <td className="px-2 py-2 text-right" title={`scans left after gaps below ${vo.lowA} s and above ${vo.capA} s are eliminated`}>{n0(rows.reduce((x, r) => x + (r.aValid || 0), 0))}</td>
                <td className="px-2 py-2 text-right">100%</td>
                <td />
                <td className="px-2 py-2 text-right">{totals.activeDays}</td>
                <td />
                <td className="px-2 py-2 text-right text-sky-800">{s1(totals.avgCycle)}</td>
                <td className="px-2 py-2 text-right">{s1(totals.medianCycle)}</td>
                {(() => { const sum = (k) => rows.reduce((x, r) => x + (r[k] || 0), 0); const cell = (v) => <td className="px-2 py-2 text-right">{v ? n0(v) : ''}</td>; return (<>
                  <td /><td />{cell(sum('achQty'))}<td className="px-2 py-2 text-right">{sum('aValid') ? `${((sum('achQty') / sum('aValid')) * 100).toFixed(1)}%` : ''}</td><td />
                  <td />{cell(sum('bValid'))}{cell(sum('bQty'))}<td />
                  <td />{cell(sum('cValid'))}{cell(sum('cQty'))}<td />
                </>); })()}
                <td colSpan={3} />
                <td className="px-2 py-2 text-right">{totals.cv != null ? `${totals.cv}%` : '—'}</td>
                <td className="px-2 py-2 text-right">{totals.rejRate.toFixed(2)}%</td>
                <td className="px-2 py-2 text-right">{n0(Math.round(totals.stopMin))} min</td>
                <td className="px-2 py-2 text-right">{totals.totalKg ? `${n0(Math.round(totals.totalKg))} kg` : '—'}</td>
                <td colSpan={2} />
              </tr>
              )}
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Volume vs cycle vs stoppage" formula="each bubble = one model (valid cycles only); upper-right = high volume + slow cycle">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 10, right: 16, left: -4, bottom: 4 }}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" />
              <XAxis type="number" dataKey="qty" name="Qty" tick={{ fontSize: fs(11), fill: '#64748B' }} tickLine={false} />
              <YAxis type="number" dataKey="mean" name="Avg cycle" tick={{ fontSize: fs(11), fill: '#64748B' }} tickLine={false} tickFormatter={(v) => `${v}s`} />
              <ZAxis type="number" dataKey="stopMin" range={[60, 520]} name="Stoppage" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<Tip rows={(p) => [[null, p.model], ['Qty', n0(p.qty)], ['Avg cycle', s1(p.mean)], ['Gap time', `${Math.round(p.stopMin)} min`], ['CV', p.cv != null ? `${p.cv}%` : '—']]} />} />
              <Scatter data={bubble} onClick={(d) => onPickModel(d.mmId ?? d.payload?.mmId)} cursor="pointer">
                {bubble.map((r) => <Cell key={r.mmId} fill={HEALTH_COLOR[r.health]} fillOpacity={0.75} stroke="#fff" />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Model × hour heatmap" formula="cell = scans of the model in that hour-of-day, summed over the period · colour = cell ÷ max cell">
          <div className="overflow-x-auto"><table className="text-fs-12 w-full">
            <thead><tr className="text-slate-600"><th className="text-left px-2 py-1">Model</th>{hours.map((hr) => <th key={hr} className="px-1.5 py-1 font-bold">{String(hr).padStart(2, '0')}</th>)}</tr></thead>
            <tbody>{heatModels.map((m) => (
              <tr key={m.mmId} className="border-t border-slate-100"><td className="px-2 py-1 font-mono font-bold whitespace-nowrap">{m.model}</td>
                {hours.map((hr) => { const v = a.modelHour?.[m.mmId]?.[hr] ?? 0; return <td key={hr} className="text-center font-mono px-1.5 py-1" style={{ background: v ? `rgba(11,92,173,${0.1 + 0.75 * (v / heatMax)})` : 'transparent', color: v / heatMax > 0.55 ? '#fff' : '#0F172A' }}>{v || ''}</td>; })}
              </tr>))}</tbody>
          </table></div>
        </Card>
      </div>

      {children}
    </div>
  );
}
