import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, X, ChevronLeft, ChevronDown, ChevronRight, Search, Table2, BarChart3, Factory, ArrowUpDown } from 'lucide-react';
import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import { api } from '../api';
import useUiSettings from '../hooks/useUiSettings';
import useAutoTargets from '../hooks/useAutoTargets';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { useOleLines, useOleData, card, StatusChip } from '../components/OleParts';
import { serverToday } from '../utils/serverTime';
import { quickPeriods, matchPeriod } from '../utils/mainFilter';
import { oleRange } from '../utils/ole';
import {
  TYPES, typeOf, measuresOf, buildFacts, applyFilters, setFilter, filterText, effectiveRange, prevRange, groupBy, kpisOf, grainOf,
  trendOf, matrixOf, gapOf, gapSummary, gapHours, minText, rsText, valueText as vText, axisText as aText, dimText, daysIn, dmy, NOT_WRITTEN, DIMS, MIN_STEPS, INT_STEPS,
} from '../utils/drill';
import { ParetoBars, RankBars, Columns, Heatmap, Legend, Delta, deptColor, deptSeries, lineColor, DEPT_ORDER, OTHER, ACCENT } from '../components/DrillCharts';
import { buildXlsx, downloadXlsx, zebra } from '../utils/xlsxWriter';
import { takeOpen } from '../utils/drillLink';

/**
 * Loss analysis — the drill-down. The losses written on the Loss entry page, sliced by any click:
 * department → reason → line → day → hour → model / owner / part → the single entry (with its RCA). Every bar, row and cell
 * is a filter; the drill path above the page shows the slice and steps back. Unplanned loss by default; planned stoppage,
 * rejection, rework and all time losses too. Measures: minutes / pieces, loss ₹ (morning entry manpower), lost time against
 * the target the HPR way (production of the lines) and number of entries. Compared with the previous period of the same length.
 * The maths is in utils/drill.js (tested in tests/drill.calc.test.js).
 */
const SAVE = 'ems.lossan.v2';
const DRILL = 'ems.lossan.drill';
const read = (k, store = localStorage) => { try { return JSON.parse(store.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v, store = localStorage) => { try { store.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const PERIODS = ['today', 'yesterday', '7d', '30d', 'month', 'lastMonth', '3m'];
const HEATS = [['line-dept', 'Line × department', 'line', 'dept'], ['dept-time', 'Department × time', 'dept', 'time'], ['line-time', 'Line × time', 'line', 'time'], ['line-hour', 'Line × hour', 'line', 'hour'], ['reason-line', 'Reason × line', 'reason', 'line']];
const TIME_DIMS = ['date', 'span'];
const kpiCls = 'relative min-h-[104px] overflow-hidden rounded-xl border border-slate-200/90 bg-white p-3 pt-3.5 shadow-sm';
const th = 'px-2 py-1.5 text-left text-fs-11 font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap';

/** Top of the sticky drill bar: just under the page header (its height changes with the filters in it). */
function useHeaderBottom() {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const h = document.querySelector('header');
    if (!h) return undefined;
    const on = () => setTop(Math.round(h.getBoundingClientRect().height));
    on();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    ro?.observe(h); window.addEventListener('resize', on);
    return () => { ro?.disconnect(); window.removeEventListener('resize', on); };
  }, []);
  return top;
}

/** A segmented control that scrolls inside itself on a narrow screen (never makes the page wider). */
const Seg = ({ label, children }) => <div className="max-w-full overflow-x-auto [scrollbar-width:thin]"><div className={segGroup} role="group" aria-label={label}>{children}</div></div>;

function Kpi({ label, value, sub, children, bar = ACCENT, aria, text = false }) {
  return (
    <div className={kpiCls} aria-label={aria || label}>
      <div className="absolute left-3 right-3 top-0 h-[3px] rounded-b" style={{ background: bar }} />
      <div className="text-fs-13 font-semibold text-slate-600">{label}</div>
      <div className={`mt-1 truncate font-bold leading-tight tracking-[-0.01em] text-slate-900 ${text ? 'text-fs-18' : 'text-fs-22'}`} title={typeof value === 'string' ? value : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-fs-12 font-semibold leading-snug text-slate-600">{sub}</div>}
      {children}
    </div>
  );
}

function Panel({ title, sub, right, children, label, className = '' }) {
  return (
    <section className={`${card} min-w-0 ${className}`} aria-label={label || title}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-fs-16 font-bold leading-snug text-slate-900">{title}</h3>
          {sub && <p className="mt-0.5 text-fs-12 leading-snug text-slate-600">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function LossAnalysisPage({ onOpen = null, canOpen = [] }) {
  const today = serverToday();
  const ids = useOleLines();
  const { ui } = useUiSettings();
  const hprSet = ui.hpr || { rate: 65, otFrom: '18:00', otX: 2 };
  const saved = read(SAVE) || {};
  const [boot] = useState(() => takeOpen());   // opened from another page (Dashboard) with a period, a type and filters
  const [range, setRange] = useState(() => {
    if (boot) return { start: boot.start, end: boot.end > today ? today : boot.end };
    const p = quickPeriods(today).find((x) => x.key === (saved.period || 'month'));
    return p ? { start: p.start, end: p.end } : { start: `${today.slice(0, 8)}01`, end: today };
  });
  const [type, setTypeS] = useState(() => (TYPES.some((t) => t.id === boot?.type) ? boot.type : TYPES.some((t) => t.id === saved.type) ? saved.type : 'loss'));
  const [measure, setMeasureS] = useState(saved.measure || 'value');
  const [split, setSplit] = useState(saved.split || 'dept');
  const [heat, setHeat] = useState(HEATS.some((h) => h[0] === saved.heat) ? saved.heat : 'line-dept');
  const [compare, setCompare] = useState(saved.compare ?? true);
  const [trendTable, setTrendTable] = useState(false);
  const [tab, setTab] = useState(['overview', 'where', 'lost', 'entries'].includes(saved.tab) ? saved.tab : 'overview');
  const [filters, setFiltersS] = useState(() => {
    if (boot) { const f = Array.isArray(boot.filters) ? boot.filters.filter((x) => x && DIMS[x.dim] && x.value != null) : []; write(DRILL, f, sessionStorage); return f; }
    return Array.isArray(read(DRILL, sessionStorage)) ? read(DRILL, sessionStorage) : [];
  });
  const [prodAsk, setProdAsk] = useState(false);
  const period = matchPeriod(today, range);
  // a new period: the day / week picked inside the old one goes (the other drill steps stay)
  const changeRange = (r) => { setRange(r); setFiltersS((f) => { const n = f.filter((x) => !['date', 'span'].includes(x.dim)); write(DRILL, n, sessionStorage); return n; }); setProdAsk(false); };
  useEffect(() => { write(SAVE, { period: period?.key || saved.period || 'month', type, measure, split, heat, compare, tab }); }, [period?.key, type, measure, split, heat, compare, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFilters = (f) => { setFiltersS(f); write(DRILL, f, sessionStorage); };
  const pick = (dim) => (value) => { if (value != null) setFilters(setFilter(filters, dim, value)); };
  const back = () => setFilters(filters.slice(0, -1));
  const T = typeOf(type);
  const ms = measuresOf(type);
  const meas = ms.some(([k]) => k === measure) ? measure : 'value';
  const setType = (t) => { setTypeS(t); if (!measuresOf(t).some(([k]) => k === measure)) setMeasureS('value'); };
  const setMeasure = (m) => { setMeasureS(m); if (m === 'hpr' && type !== 'time') setTypeS('time'); };
  const unit = T.unit;
  const fmt = (v) => vText(v, meas, unit);
  const axis = (v) => aText(v, meas, unit);
  const axisSteps = unit === 'min' && (meas === 'value' || meas === 'hpr') ? MIN_STEPS : meas === 'count' || unit === 'pcs' ? INT_STEPS : null;
  const cellFmt = (v) => (meas === 'rs' ? (v >= 1000 ? `${Math.round(v / 100) / 10}K` : `${Math.round(v)}`) : meas === 'count' || unit === 'pcs' ? `${Math.round(v)}` : v >= 120 ? `${Math.round(v / 6) / 10}h` : `${Math.round(v)}`);

  // ── data: entries (fast) + production of the lines for the lost time (a period up to a month at once, longer when asked)
  const nDays = daysIn(range.start, range.end);
  const prodOn = nDays <= 31 || prodAsk;
  // no 20 s polling here (an analysis page): new entries every 2 minutes, production on Refresh
  const D = useOleData({ start: range.start, end: range.end, ids, prod: prodOn, paused: true });
  useEffect(() => {
    if (range.end < today) return undefined;
    const t = setInterval(() => { if (!document.hidden) D.reloadEnt(); }, 120000);
    return () => clearInterval(t);
  }, [range.start, range.end, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = useAllLineSettings(ids);
  const auto = useAutoTargets();
  const pr = prevRange(range.start, range.end);
  const [prevEnt, setPrevEnt] = useState(null);
  useEffect(() => {
    if (!compare) { setPrevEnt(null); return undefined; }
    let alive = true;
    setPrevEnt(null);
    api.oleEntries(pr.from, pr.to).then((j) => { if (alive) setPrevEnt(j || {}); }).catch(() => { if (alive) setPrevEnt({ failed: true }); });
    return () => { alive = false; };
  }, [compare, pr.from, pr.to]);
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, D.ent.setup, range.start, range.end, today, D.endMin, ids]);
  const gap = useMemo(() => (R && auto ? gapOf({ days: R.days, ids, settings, setups: D.ent.setup, targetsByLine: Object.fromEntries(ids.map((l) => [l, settings[l]?.targets || {}])), otFrom: hprSet.otFrom }) : null),
    [R, auto, settings, D.ent.setup, ids, hprSet.otFrom]);
  const facts = useMemo(() => buildFacts({
    entries: { ...(prevEnt?.entries || {}), ...D.ent.entries }, start: compare ? pr.from : range.start, end: range.end, ids,
    setups: { ...(prevEnt?.setup || {}), ...D.ent.setup }, rca: { ...(prevEnt?.rca || {}), ...D.ent.rca }, reasons: D.ent.reasons, hpr: hprSet, lost: gap?.byHour || null,
  }), [D.ent, prevEnt, compare, pr.from, range.start, range.end, ids, JSON.stringify(hprSet), gap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the slice
  const kinds = T.kinds;
  const eff = effectiveRange(range.start, range.end, filters);
  const effNoDay = effectiveRange(range.start, range.end, filters.filter((f) => f.dim !== 'date'));
  const pv = prevRange(eff.from, eff.to);
  const cmpOn = compare && meas !== 'hpr' && !!prevEnt && !prevEnt.failed;
  const sliceOf = (skip = []) => applyFilters(facts, { filters, kinds, from: skip.includes('date') ? effNoDay.from : eff.from, to: skip.includes('date') ? effNoDay.to : eff.to, skip });
  const prevOf = (skip = []) => (cmpOn ? applyFilters(facts, { filters: filters.filter((f) => !TIME_DIMS.includes(f.dim)), kinds, from: pv.from, to: pv.to, skip }) : null);
  const slice = useMemo(() => sliceOf(), [facts, filters, type, eff.from, eff.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevSlice = useMemo(() => prevOf(), [facts, filters, type, pv.from, pv.to, cmpOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const K = kpisOf(slice, meas);
  const KP = prevSlice ? kpisOf(prevSlice, meas) : null;
  const KV = meas === 'value' ? K : kpisOf(slice, 'value');
  const KPV = prevSlice ? (meas === 'value' ? KP : kpisOf(prevSlice, 'value')) : null;
  const active = (dim) => filters.find((f) => f.dim === dim)?.value ?? null;
  const list = (dim, opts = {}) => groupBy(sliceOf([dim]), dim, meas, { prev: prevOf([dim]), ...opts });
  const depts = useMemo(() => list('dept'), [facts, filters, type, meas, eff.from, eff.to, cmpOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const reasons = useMemo(() => list('reason', { top: 15 }), [facts, filters, type, meas, eff.from, eff.to, cmpOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => list('line'), [facts, filters, type, meas, eff.from, eff.to, cmpOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const hours = useMemo(() => groupBy(sliceOf(['hour']), 'hour', meas), [facts, filters, type, meas, eff.from, eff.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const models = useMemo(() => list('model', { top: 10 }), [facts, filters, type, meas, eff.from, eff.to, cmpOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const owners = useMemo(() => list('owner', { top: 10 }), [facts, filters, type, meas, eff.from, eff.to, cmpOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(() => list('part', { top: 10 }), [facts, filters, type, meas, eff.from, eff.to, cmpOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── trend (the day filter stays open: the picked day is marked, the others still show)
  const grain = grainOf(effNoDay.from, effNoDay.to);
  const trendSlice = useMemo(() => sliceOf(['date']), [facts, filters, type, effNoDay.from, effNoDay.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const splitBy = split === 'dept' && active('dept') ? 'none' : split;
  const trend = useMemo(() => trendOf(trendSlice, { from: effNoDay.from, to: effNoDay.to, grain, split: splitBy === 'none' ? null : splitBy, measure: meas, seriesOrder: splitBy === 'dept' ? (f) => deptSeries(f.dept) : null }),
    [trendSlice, effNoDay.from, effNoDay.to, grain, splitBy, meas]);
  const seriesOrder = splitBy === 'dept' ? [...DEPT_ORDER, NOT_WRITTEN, 'Other'].filter((s) => trend.series.includes(s)) : splitBy === 'line' ? ids.filter((l) => trend.series.includes(l)) : ['all'];
  const seriesColor = (s) => (splitBy === 'dept' ? (s === 'Other' ? OTHER : deptColor(s)) : splitBy === 'line' ? lineColor(s) : ACCENT);
  const seriesName = (s) => (splitBy === 'line' ? `Line ${s}` : s === 'all' ? T.label : s);
  const pickBucket = (b) => (grain === 'day' ? pick('date')(b.key) : setFilters(setFilter(filters, 'span', { from: b.from, to: b.to })));
  const bucketActive = (b) => (grain === 'day' ? active('date') === b.key : false);

  // ── heat map
  const [, hLabel, rowDim, colDim] = HEATS.find((h) => h[0] === heat);
  const heatSlice = useMemo(() => sliceOf(colDim === 'time' ? ['date'] : []), [facts, filters, type, heat, eff.from, eff.to, effNoDay.from, effNoDay.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const M = useMemo(() => matrixOf(heatSlice, rowDim, colDim, meas, { from: colDim === 'time' ? effNoDay.from : eff.from, to: colDim === 'time' ? effNoDay.to : eff.to, maxRows: 12, maxCols: 10 }),
    [heatSlice, rowDim, colDim, meas, eff.from, eff.to, effNoDay.from, effNoDay.to]);
  const pickCell = (r, c) => {
    let f = setFilter(filters.filter((x) => x.dim !== rowDim), rowDim, r.key);
    if (colDim === 'time') {
      const b = M.colBuckets.find((x) => x.key === c.key);
      f = M.grain === 'day' ? setFilter(f.filter((x) => x.dim !== 'date'), 'date', c.key) : setFilter(f.filter((x) => x.dim !== 'span'), 'span', { from: b.from, to: b.to });
    } else f = setFilter(f.filter((x) => x.dim !== colDim), colDim, c.key);
    setFilters(f);
  };
  const cellActive = (r, c) => String(active(rowDim)) === String(r.key) && (colDim === 'time' ? active('date') === c.key : String(active(colDim)) === String(c.key));

  // ── production: lost time and whether a reason was written (line / day / span / hour filters only)
  const gh = useMemo(() => (gap ? gapHours(gap.hours, filters, eff.from, eff.to) : []), [gap, filters, eff.from, eff.to]);
  const GS = useMemo(() => gapSummary(gh, ids), [gh, ids]);
  const missing = useMemo(() => gh.filter((h) => h.lost > 0 && !(h.written > 0)).sort((a, b) => b.lost - a.lost || b.date.localeCompare(a.date) || Number(a.line) - Number(b.line) || a.hour - b.hour), [gh]);
  const blank = (rws) => rws.length > 0 && rws.every((r) => r.key === '');
  const reasonPct = GS.total.lost > 0 ? ((GS.total.lost - GS.total.lostNoReason) / GS.total.lost) * 100 : null;

  // ── details
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ k: 'date', dir: 1 });
  const [shown, setShown] = useState(60);
  const [open, setOpen] = useState(null);
  useEffect(() => { setShown(60); setOpen(null); }, [filters, type, range.start, range.end]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = slice.filter((f) => !f.pseudo && (!t || [f.reason, f.dept, f.owner, f.model, f.part, f.note, f.by, `line ${f.line}`, dmy(f.date)].join(' ').toLowerCase().includes(t)));
    const key = { date: (f) => `${f.date}|${String(f.hour).padStart(2, '0')}|${f.line}`, line: (f) => Number(f.line), hour: (f) => f.hour, reason: (f) => f.reason, dept: (f) => f.dept, owner: (f) => f.owner, model: (f) => f.model, value: (f) => f.value, rs: (f) => f.rs ?? -1, rca: (f) => f.rca }[sort.k] || ((f) => f.date);
    return [...r].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [slice, q, sort]);
  const sortBy = (k) => setSort((s) => ({ k, dir: s.k === k ? -s.dir : k === 'value' || k === 'rs' ? -1 : 1 }));

  // ── context
  const loadingFirst = !D.entReady && !D.err;
  const ctx = filters.length ? filters.map(filterText).join(' › ') : 'All data';
  const periodText = eff.from === eff.to ? dmy(eff.from) : `${dmy(eff.from)} – ${dmy(eff.to)}`;
  const prevText = `${dmy(pv.from)} – ${dmy(pv.to)}`;
  const top = useHeaderBottom();
  const canRca = onOpen && canOpen.includes('rca');
  const curTab = tab === 'lost' && unit !== 'min' ? 'overview' : tab;

  // ── Excel of the slice
  const excel = () => {
    const title = `${T.label} · ${periodText} · ${ctx}`;
    const head = (cols) => cols.map((v) => ({ v, s: 'head' }));
    const z = (i) => (i % 2 ? zebra : (n) => n);
    const mName = ms.find(([k]) => k === meas)?.[1] || 'Value';
    const num = (v) => (v == null ? null : Math.round(v * 10) / 10);
    const groupSheet = (name, dim, rowsG) => ({
      name, cols: [{ width: 34 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 8 }, { width: 14 }, ...(cmpOn ? [{ width: 14 }] : [])],
      rows: [[{ v: title, s: 'title' }], [{ v: `${DIMS[dim].label} · ${mName}`, s: 'subtitle' }], [], head([DIMS[dim].label, mName, 'Share %', 'Cumulative %', 'Loss ₹', 'Entries', 'Days', 'Lines', ...(cmpOn ? [`Previous (${prevText})`] : [])]),
        ...rowsG.map((r, i) => [{ v: r.label, s: z(i)('text') }, { v: num(r.value), s: z(i)('dec1') }, { v: num(r.share), s: z(i)('dec1') }, { v: num(r.cumPct), s: z(i)('dec1') }, { v: r.rs != null ? Math.round(r.rs) : null, s: z(i)('int') }, { v: r.count, s: z(i)('int') }, { v: r.days, s: z(i)('int') }, { v: (r.lines || []).map((l) => `L${l}`).join(' '), s: z(i)('center') }, ...(cmpOn ? [{ v: num(r.prev), s: z(i)('dec1') }] : [])])],
      merges: ['A1:H1'], freezeRow: 4, headerRow: 4,
    });
    const all = (dim) => groupBy(sliceOf([dim]), dim, meas, { prev: prevOf([dim]) });
    const ents = slice.filter((f) => !f.pseudo || meas === 'hpr');
    const sheets = [
      { name: 'Summary', cols: [{ width: 30 }, { width: 40 }],
        rows: [[{ v: 'Loss analysis — drill-down', s: 'title' }], [],
          ...[['Period', periodText], ['Type', T.label], ['Measure', mName], ['Drill path', ctx], ['Lines', ids.map((l) => `Line ${l}`).join(', ')],
            ['Total', fmt(K.total)], ['Entries', K.entries], ['Days with a loss', K.days], ['Loss ₹', K.rs != null ? rsText(K.rs) : '—'],
            ...(cmpOn ? [['Previous period', prevText], ['Previous total', fmt(KP.total)]] : []),
            ...(gap && unit === 'min' ? [['Lost vs target (production)', minText(GS.total.lost)], ['Lost time with a reason written', reasonPct == null ? '—' : `${reasonPct.toFixed(1)}%`], ['Short hours without a reason', GS.total.shortNoReason]] : []),
            ['RCA pending / submitted / closed', `${K.rca.pending} / ${K.rca.submitted} / ${K.rca.closed}`], ['Rate (Loss ₹)', `₹${hprSet.rate} per man-hour, ×${hprSet.otX} from ${hprSet.otFrom}`]]
            .map(([a, b]) => [{ v: a, s: 'metaLabel' }, { v: b, s: 'metaValue' }])] },
      groupSheet('Departments', 'dept', all('dept')), groupSheet('Reasons', 'reason', all('reason')), groupSheet('Lines', 'line', all('line')),
      groupSheet('Days', 'date', groupBy(sliceOf(['date']), 'date', meas)), groupSheet('Hours', 'hour', all('hour')),
      groupSheet('Models', 'model', all('model')), groupSheet('Owners', 'owner', all('owner')), groupSheet('Parts', 'part', all('part')),
      { name: 'Entries', cols: [{ width: 12 }, { width: 7 }, { width: 13 }, { width: 16 }, { width: 32 }, { width: 16 }, { width: 18 }, { width: 22 }, { width: 18 }, { width: 10 }, { width: 6 }, { width: 10 }, ...(meas === 'hpr' ? [{ width: 12 }] : []), { width: 12 }, { width: 30 }, { width: 30 }, { width: 28 }],
        rows: [[{ v: title, s: 'title' }], [], head(['Date', 'Line', 'Hour', 'Type', 'Reason', 'Department', 'Owner', 'Model', 'Part involved', unit === 'pcs' ? 'Qty' : 'Minutes', 'M/P', 'Loss ₹', ...(meas === 'hpr' ? ['Lost vs target (min)'] : []), 'RCA', 'Root cause', 'Action', 'Note']),
          ...ents.map((f, i) => [{ v: dmy(f.date), s: z(i)('text') }, { v: `L${f.line}`, s: z(i)('center') }, { v: dimText('hour', f.hour), s: z(i)('center') }, { v: f.pseudo ? NOT_WRITTEN : DIMS.kind.text(f.kind), s: z(i)('text') },
            { v: f.reason, s: z(i)('text') }, { v: f.dept, s: z(i)('text') }, { v: f.owner || '', s: z(i)('text') }, { v: f.model || '', s: z(i)('text') }, { v: f.part || '', s: z(i)('text') }, { v: f.value || null, s: z(i)('int') }, { v: f.mp, s: z(i)('int') },
            { v: f.rs != null ? Math.round(f.rs) : null, s: z(i)('int') }, ...(meas === 'hpr' ? [{ v: f.hpr != null ? num(f.hpr) : null, s: z(i)('dec1') }] : []), { v: { pending: 'Pending', submitted: 'Submitted', closed: 'Closed', na: '—' }[f.rca] || '', s: z(i)('center') },
            { v: f.rcaRec?.rootCause || f.rcaRec?.cause || '', s: z(i)('text') }, { v: f.rcaRec?.action || '', s: z(i)('text') }, { v: f.note || '', s: z(i)('text') }])],
        freezeRow: 3, headerRow: 3, autoFilter: `A3:${meas === 'hpr' ? 'Q' : 'P'}${ents.length + 3}` },
    ];
    if (gap && unit === 'min') {
      sheets.push({ name: 'Lost vs reasons', cols: [{ width: 12 }, { width: 7 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }],
        rows: [[{ v: `Short hours (production against the target) · ${periodText}`, s: 'title' }], [], head(['Date', 'Line', 'Hour', 'Target', 'Made', 'Lost (min)', 'Reason written (min)']),
          ...gh.filter((h) => h.lost > 0).sort((a, b) => a.date.localeCompare(b.date) || Number(a.line) - Number(b.line) || a.hour - b.hour)
            .map((h, i) => [{ v: dmy(h.date), s: z(i)('text') }, { v: `L${h.line}`, s: z(i)('center') }, { v: h.slot, s: z(i)('center') }, { v: h.target, s: z(i)('int') }, { v: h.qty, s: z(i)('int') }, { v: num(h.lost), s: z(i)('dec1') }, { v: num(h.written), s: z(i)('dec1') }])],
        freezeRow: 3, headerRow: 3 });
    }
    downloadXlsx(buildXlsx(sheets), `Loss_analysis_${T.id}_${eff.from}_${eff.to}.xlsx`);
  };

  const lostTile = unit === 'min' && (
    gap ? (
      <Kpi label="Lost vs target (production)" aria="Lost vs target" value={minText(GS.total.lost)} bar="#57534e"
        sub={<>{reasonPct == null ? 'No short hour' : <>Reason written for <b>{reasonPct.toFixed(0)}%</b> · {minText(GS.total.lostNoReason)} in {GS.total.shortNoReason} hour{GS.total.shortNoReason === 1 ? '' : 's'} without</>}{filters.some((f) => !['line', 'date', 'span', 'hour'].includes(f.dim)) && <span className="block font-normal text-slate-500">All departments — production has no reason</span>}</>} />
    ) : (
      <Kpi label="Lost vs target (production)" aria="Lost vs target" value={prodOn ? '…' : '—'} bar="#57534e"
        sub={prodOn ? (D.err ? 'The lines did not answer' : 'Reading the production of the lines…') : null}>
        {!prodOn && <button type="button" onClick={() => setProdAsk(true)} className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-2 text-fs-12 font-bold text-slate-700 hover:bg-slate-50"><Factory size={14} aria-hidden /> Read production ({nDays} days)</button>}
      </Kpi>
    )
  );

  return (
    <div className="flex flex-col gap-3" role="region" aria-label="Loss analysis">
      <HeaderBar label="Loss analysis filters">
        <Seg label="Period">
          {quickPeriods(today).filter((p) => PERIODS.includes(p.key)).map((p) => (
            <button key={p.key} type="button" aria-pressed={period?.key === p.key} className={segBtn(period?.key === p.key)} onClick={() => changeRange({ start: p.start, end: p.end })}>{p.label}</button>
          ))}
        </Seg>
        <input type="date" className={fieldCls} aria-label="From" value={range.start} max={range.end} onChange={(e) => e.target.value && changeRange({ ...range, start: e.target.value })} />
        <input type="date" className={fieldCls} aria-label="To" value={range.end} min={range.start} max={today} onChange={(e) => e.target.value && changeRange({ ...range, end: e.target.value > today ? today : e.target.value })} />
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 text-fs-13 font-semibold text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-blue-700" checked={compare} onChange={(e) => setCompare(e.target.checked)} aria-label="Compare with the previous period" /> vs previous
        </label>
        <button type="button" className={`${fieldCls} inline-flex items-center gap-1.5 font-bold`} onClick={() => D.reload()} aria-label="Read the entries again" title="Read the entries again"><RefreshCw size={14} className={D.loading ? 'animate-spin' : ''} aria-hidden /></button>
      </HeaderBar>

      <section className={card} aria-label="What to analyse">
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="Loss type">
            {TYPES.map((t) => <button key={t.id} type="button" aria-pressed={type === t.id} className={segBtn(type === t.id)} onClick={() => setType(t.id)}>{t.label}</button>)}
          </Seg>
          <Seg label="Measure">
            {ms.map(([k, l]) => <button key={k} type="button" aria-pressed={meas === k} className={segBtn(meas === k, 'navy')} onClick={() => setMeasure(k)}>{l}</button>)}
          </Seg>
          {!ms.some(([k]) => k === 'hpr') && unit === 'min' && <button type="button" onClick={() => setMeasure('hpr')} className="text-fs-12 font-bold text-blue-700 hover:underline">Lost vs target (HPR) →</button>}
          <button type="button" onClick={excel} disabled={!slice.length} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"><Download size={15} aria-hidden /> Excel of this view</button>
        </div>
      </section>

      {/* drill path: always in view while scrolling */}
      <nav aria-label="Drill path" className="sticky z-20 -mx-1 rounded-xl border border-blue-200 bg-blue-50/95 px-3 py-2 shadow-sm backdrop-blur" style={{ top: top + 4 }}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-fs-12 font-bold uppercase tracking-wide text-blue-900">Drill path</span>
          <button type="button" onClick={() => setFilters([])} className={`rounded-full px-2.5 py-0.5 text-fs-13 font-bold ${filters.length ? 'text-blue-800 hover:bg-blue-100' : 'bg-blue-700 text-white'}`}>All data · {periodText}</button>
          {filters.map((f, i) => (
            <React.Fragment key={`${f.dim}-${i}`}>
              <ChevronRight size={14} className="text-blue-400" aria-hidden />
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-white py-0.5 pl-2.5 pr-1 text-fs-13 font-semibold text-slate-800 ring-1 ring-blue-300">
                <button type="button" className="truncate hover:underline" onClick={() => setFilters(filters.slice(0, i + 1))} title="Go back to this step">{filterText(f)}</button>
                <button type="button" aria-label={`Remove ${filterText(f)}`} onClick={() => setFilters(filters.filter((_, j) => j !== i))} className="grid h-5 w-5 place-items-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-700"><X size={13} /></button>
              </span>
            </React.Fragment>
          ))}
          <span className="ml-auto flex items-center gap-1.5">
            {filters.length > 0 && <button type="button" onClick={back} className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-300 bg-white px-2 text-fs-12 font-bold text-blue-800 hover:bg-blue-100"><ChevronLeft size={14} aria-hidden /> Back</button>}
            {filters.length > 0 && <button type="button" onClick={() => setFilters([])} className="inline-flex h-7 items-center rounded-md px-2 text-fs-12 font-bold text-slate-600 hover:bg-white">Clear all</button>}
          </span>
        </div>
      </nav>

      {D.err && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-fs-13 font-semibold text-amber-900">{D.err}</div>}
      {gap?.failed?.length > 0 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-fs-13 font-semibold text-amber-900">Line {gap.failed.join(', ')} did not answer — its lost time against the target is not counted.</div>}
      {loadingFirst ? <div className={`${card} text-center text-fs-14 font-semibold text-slate-500`}>Reading the losses…</div> : (
        <div className={`flex flex-col gap-3 transition-opacity ${D.loading && !D.al ? 'opacity-90' : ''}`}>
          {!slice.length && (
            <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-fs-14 font-semibold text-slate-600">
              No {T.label.toLowerCase()} written in this slice{filters.length ? ' — step back on the drill path or clear it' : ` (${periodText})`}.
            </div>
          )}
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label="Totals of the slice">
            <Kpi label={meas === 'rs' ? `Loss ₹ · ${T.label.toLowerCase()}` : meas === 'hpr' ? 'Lost vs target · this slice' : meas === 'count' ? `Entries · ${T.label.toLowerCase()}` : `Total ${T.label.toLowerCase()}`} aria="Total" value={fmt(K.total)} bar={ACCENT}
              sub={<>{K.entries} entries · {K.days} day{K.days === 1 ? '' : 's'}{cmpOn && <><br /><Delta value={K.total} prev={KP.total} fmt={fmt} /> <span className="font-normal text-slate-500">vs {prevText}</span></>}</>} />
            {unit === 'min' && (meas === 'rs' || meas === 'hpr') ? (
              <Kpi label="Minutes written" value={minText(KV.total)} bar="#eda100" sub={<>{T.label} on the Loss entry page{cmpOn && KPV && <><br /><Delta value={KV.total} prev={KPV.total} fmt={minText} /></>}</>} />
            ) : unit === 'min' ? (
              <Kpi label="Loss ₹" value={rsText(K.rs)} bar="#eda100"
                sub={<>{K.noMpMin > 0 ? `${minText(K.noMpMin)} without manpower (no morning entry)` : `₹${hprSet.rate}/man-hr · ×${hprSet.otX} from ${hprSet.otFrom}`}{cmpOn && KP.rs != null && K.rs != null && <><br /><Delta value={K.rs} prev={KP.rs} fmt={rsText} /></>}</>} />
            ) : <Kpi label="Per day (average)" value={fmt(K.perDay)} bar="#eda100" sub={`over ${K.days} day${K.days === 1 ? '' : 's'} with ${T.label.toLowerCase()}`} />}
            {lostTile || <Kpi label="Lines" value={K.lines} bar="#57534e" sub={lines.map((l) => `${l.label}: ${fmt(l.value)}`).join(' · ')} />}
            <Kpi label="RCA" aria="RCA status" value={`${K.rca.pending} pending`} bar="#d03b3b"
              sub={<>{K.rca.submitted} submitted · {K.rca.closed} closed{K.rca.issues ? ` · of ${K.rca.issues}` : ''}</>}>
              {canRca && K.rca.issues > 0 && <button type="button" onClick={() => onOpen('rca')} className="mt-1 text-fs-12 font-bold text-blue-700 hover:underline">Open RCA →</button>}
            </Kpi>
          </div>

          {/* one part at a time: easier to read; the drill path above works on every tab */}
          <div role="tablist" aria-label="Analysis parts" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {[['overview', 'Overview', 'Trend and Pareto'], ['where', 'Where & when', 'Line, hour, model, owner, heat map'], ...(unit === 'min' ? [['lost', 'Lost vs target', 'Production: hours short of target']] : []), ['entries', `Entries · ${rows.length}`, 'Every loss written, with its RCA']].map(([k, l, sub]) => (
              <button key={k} type="button" role="tab" aria-selected={curTab === k} onClick={() => setTab(k)} title={sub}
                className={`flex min-w-[8.5rem] flex-1 flex-col items-start rounded-lg px-3 py-2 text-left ${curTab === k ? 'bg-dixon-navy text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
                <span className="text-fs-14 font-bold">{l}</span>
                <span className={`hidden text-fs-11 sm:block ${curTab === k ? 'text-white/80' : 'text-slate-500'}`}>{sub}</span>
              </button>
            ))}
          </div>

          {curTab === 'overview' && (<>
          {/* trend */}
          <Panel label="Trend" title={`${T.label} by ${grain === 'day' ? 'day' : grain === 'week' ? 'week' : 'month'}`}
            sub={`${dmy(effNoDay.from)} – ${dmy(effNoDay.to)}${splitBy === 'none' && split === 'dept' && active('dept') ? ` · ${active('dept')} only` : ''}`}
            right={(
              <div className="flex flex-wrap items-center gap-2">
                <Seg label="Split the trend by">
                  {[['dept', 'Department'], ['line', 'Line'], ['none', 'Total']].map(([k, l]) => <button key={k} type="button" aria-pressed={split === k} className={segBtn(split === k, 'navy')} onClick={() => setSplit(k)}>{l}</button>)}
                </Seg>
                <button type="button" onClick={() => setTrendTable((x) => !x)} aria-pressed={trendTable} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-2 text-fs-12 font-bold text-slate-700 hover:bg-slate-50">{trendTable ? <><BarChart3 size={14} aria-hidden /> Chart</> : <><Table2 size={14} aria-hidden /> Table</>}</button>
              </div>
            )}>
            {seriesOrder.length > 1 && !trendTable && <div className="mb-2"><Legend items={[...seriesOrder].map((s) => ({ key: s, label: seriesName(s), color: seriesColor(s) }))} /></div>}
            {trendTable ? (
              <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-fs-12 tabular-nums" aria-label="Trend table">
                  <thead className="sticky top-0 bg-slate-50"><tr><th className={th}>{grain === 'day' ? 'Day' : grain === 'week' ? 'Week' : 'Month'}</th>{seriesOrder.length > 1 && seriesOrder.map((s) => <th key={s} className={`${th} text-right`}>{seriesName(s)}</th>)}<th className={`${th} text-right`}>Total</th></tr></thead>
                  <tbody>{trend.buckets.map((b) => <tr key={b.key} className="border-t border-slate-100"><td className="px-2 py-1 font-semibold text-slate-800">{b.label}</td>{seriesOrder.length > 1 && seriesOrder.map((s) => <td key={s} className="px-2 py-1 text-right font-mono">{b.parts[s] ? fmt(b.parts[s]) : ''}</td>)}<td className="px-2 py-1 text-right font-mono font-bold">{b.total ? fmt(b.total) : '—'}</td></tr>)}</tbody>
                </table>
              </div>
            ) : (
              <Columns buckets={trend.buckets} series={seriesOrder} colorOf={seriesColor} nameOf={seriesName} valueText={fmt} axisText={axis} onPick={pickBucket} isActive={bucketActive} label="Trend chart" height={210} steps={axisSteps} />
            )}
          </Panel>

          {/* Pareto: department and reason */}
          <div className="grid gap-3 xl:grid-cols-2">
            <Panel label="Department Pareto" title="Department-wise Pareto">
              <ParetoBars rows={depts} valueText={fmt} onPick={pick('dept')} active={active('dept')} label="Departments" prevOn={cmpOn} />
            </Panel>
            <Panel label="Reason Pareto" title={active('dept') ? `Reasons of ${active('dept')}` : 'Reason-wise Pareto'}>
              <ParetoBars rows={reasons} valueText={fmt} onPick={pick('reason')} active={active('reason')} label="Reasons" prevOn={cmpOn} />
            </Panel>
          </div>

          </>)}

          {curTab === 'where' && (<>
          {/* where and when */}
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            <Panel label="By line" title="By line"><RankBars rows={lines} valueText={fmt} onPick={pick('line')} active={active('line')} label="Lines" dot={lineColor} prevOn={cmpOn} /></Panel>
            <Panel label="By hour of the day" title="By hour of the day">
              <Columns buckets={hours.map((h) => ({ key: h.key, label: h.label, short: String(h.key).padStart(2, '0'), total: h.value, parts: { all: h.value } }))} valueText={fmt} axisText={axis}
                onPick={(b) => pick('hour')(b.key)} isActive={(b) => String(active('hour')) === b.key} label="Hours chart" height={170} steps={axisSteps} />
            </Panel>
            <Panel label="By model" title="By model" sub="Model written with the loss (top 10).">{blank(models) ? <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">No model written with these losses.</p> : <RankBars rows={models} valueText={fmt} onPick={pick('model')} active={active('model')} label="Models" prevOn={cmpOn} />}</Panel>
            <Panel label="By owner" title="By owner" sub="Owner of the reason (top 10).">{blank(owners) ? null : <RankBars rows={owners} valueText={fmt} onPick={pick('owner')} active={active('owner')} label="Owners" prevOn={cmpOn} />}</Panel>
            <Panel label="By part involved" title="By part involved" sub="Part written with the loss (top 10).">{blank(parts) ? <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">No part written with these losses.</p> : <RankBars rows={parts} valueText={fmt} onPick={pick('part')} active={active('part')} label="Parts" prevOn={cmpOn} />}</Panel>
          </div>

          {/* heat map */}
          <Panel label="Heat map" title={`Heat map · ${hLabel}`}
            right={<Seg label="Heat map">{HEATS.map(([k, l]) => <button key={k} type="button" aria-pressed={heat === k} className={segBtn(heat === k, 'navy')} onClick={() => setHeat(k)}>{l}</button>)}</Seg>}>
            <Heatmap m={M} valueText={fmt} cellText={cellFmt} onPick={pickCell} isActive={cellActive} rowLabel={rowDim === 'dept' ? 'Department' : DIMS[rowDim].label} colLabel={colDim === 'time' ? (M.grain === 'day' ? 'Day' : M.grain === 'week' ? 'Week' : 'Month') : DIMS[colDim].label} label="Heat map table" />
          </Panel>

          </>)}

          {curTab === 'lost' && (!gap ? (
            <div className={`${card} text-center text-fs-14 font-semibold text-slate-600`}>
              {prodOn ? (D.err ? 'The lines did not answer — the lost time against the target cannot be worked out now.' : 'Reading the production of the lines…') : (
                <>Production data is not loaded automatically for a period of this length.<button type="button" onClick={() => setProdAsk(true)} className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-2 text-fs-13 font-bold text-slate-700 hover:bg-slate-50"><Factory size={14} aria-hidden /> Read production ({nDays} days)</button></>
              )}
            </div>
          ) : (<>
              <Panel label="Lost time per line" title="Lost vs target per line">
                <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-fs-12 tabular-nums" aria-label="Lost time per line">
                  <thead><tr className="border-b border-slate-200"><th className={th}>Line</th><th className={`${th} text-right`}>Target</th><th className={`${th} text-right`}>Made</th><th className={`${th} text-right`}>Lost</th><th className={`${th} text-right`}>No reason</th></tr></thead>
                  <tbody>
                    {ids.map((l) => { const o = GS.lines[l]; if (!o || !o.target) return null; return (
                      <tr key={l} className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${String(active('line')) === l ? 'bg-blue-50' : ''}`} onClick={() => pick('line')(l)}>
                        <td className="px-2 py-1.5 font-semibold text-slate-900">Line {l}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{Math.round(o.target).toLocaleString('en-IN')}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{o.qty.toLocaleString('en-IN')}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold">{minText(o.lost)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${o.lostNoReason > 0 ? 'font-bold text-red-700' : 'text-slate-500'}`}>{o.lostNoReason > 0 ? <>{minText(o.lostNoReason)}<div className="text-fs-11 font-semibold text-slate-500">{o.shortNoReason} short hour{o.shortNoReason === 1 ? '' : 's'}</div></> : '—'}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table></div>
              </Panel>
          {/* short hours without a reason (production) */}
          {unit === 'min' && gap && (
            <Panel label="Short hours without a reason" title={`Short hours without a reason · ${missing.length}`}>
              {!missing.length ? <p className="py-3 text-fs-13 font-semibold text-emerald-700">✓ Every short hour in this slice has a reason.</p> : (
                <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full whitespace-nowrap text-fs-12 tabular-nums" aria-label="Short hours without a reason">
                    <thead className="sticky top-0 bg-slate-50"><tr><th className={th}>Day</th><th className={th}>Line</th><th className={th}>Hour</th><th className={`${th} text-right`}>Target</th><th className={`${th} text-right`}>Made</th><th className={`${th} text-right`}>Lost</th></tr></thead>
                    <tbody>{missing.slice(0, 50).map((h) => (
                      <tr key={`${h.date}|${h.line}|${h.hour}`} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setFilters([...filters.filter((f) => !['line', 'date', 'hour'].includes(f.dim)), { dim: 'line', value: h.line }, { dim: 'date', value: h.date }])}>
                        <td className="px-2 py-1 font-semibold">{dmy(h.date)}</td><td className="px-2 py-1">Line {h.line}</td><td className="px-2 py-1 font-mono">{h.slot}</td>
                        <td className="px-2 py-1 text-right font-mono">{h.target}</td><td className="px-2 py-1 text-right font-mono">{h.qty}</td><td className="px-2 py-1 text-right font-mono font-bold text-red-700">{minText(h.lost)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {missing.length > 50 && <div className="bg-slate-50 px-3 py-1.5 text-fs-12 font-semibold text-slate-500">First 50 of {missing.length} — the Excel has all.</div>}
                </div>
              )}
            </Panel>
          )}

          </>))}

          {curTab === 'entries' && (
          <Panel label="Entries" title={`Entries · ${rows.length}`}
            right={(
              <label className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reason, owner, model, note…" aria-label="Search the entries" className="h-8 w-64 max-w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-fs-13 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            )}>
            {!rows.length ? <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">No entry in this slice.</p> : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[60rem] text-fs-12 tabular-nums" aria-label="Entries table">
                  <thead className="bg-slate-50"><tr>
                    {[['date', 'Day / hour'], ['line', 'Line'], ['reason', 'Reason'], ['dept', 'Department'], ['owner', 'Owner'], ['model', 'Model / part'], ['value', unit === 'pcs' ? 'Qty' : 'Minutes'], ...(unit === 'min' ? [['rs', 'Loss ₹']] : []), ['rca', 'RCA']].map(([k, l]) => (
                      <th key={k} className={`${th} ${['value', 'rs'].includes(k) ? 'text-right' : ''}`}><button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800" aria-label={`Sort by ${l}`}>{l}{sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : <ArrowUpDown size={11} aria-hidden />}</button></th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, shown).map((f) => (
                      <React.Fragment key={f.id}>
                        <tr className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${open === f.id ? 'bg-blue-50/60' : ''}`} onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
                          <td className="whitespace-nowrap px-2 py-1.5"><span className="inline-flex items-center gap-1 font-semibold text-slate-900">{open === f.id ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}{dmy(f.date)}</span><div className="pl-4 font-mono text-slate-500">{dimText('hour', f.hour)}</div></td>
                          <td className="whitespace-nowrap px-2 py-1.5">L{f.line}</td>
                          <td className="px-2 py-1.5"><div className="font-semibold text-slate-900">{f.reason}</div>{type === 'time' && <div className="text-fs-11 text-slate-500">{DIMS.kind.text(f.kind)}</div>}</td>
                          <td className="px-2 py-1.5"><i className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: deptColor(f.dept) }} />{f.dept}</td>
                          <td className="px-2 py-1.5 text-slate-700">{f.owner || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-700">{f.model || '—'}{f.part && <div className="text-fs-11 text-slate-500">Part: {f.part}</div>}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold text-slate-900">{unit === 'pcs' ? f.value : minText(f.value)}{meas === 'hpr' && f.hpr != null && <div className="text-fs-11 font-semibold text-slate-500">lost {minText(f.hpr)}</div>}</td>
                          {unit === 'min' && <td className="px-2 py-1.5 text-right font-mono">{rsText(f.rs)}</td>}
                          <td className="px-2 py-1.5">{f.rca === 'na' ? <span className="text-slate-400">not needed</span> : <StatusChip st={f.rca} />}</td>
                        </tr>
                        {open === f.id && (
                          <tr className="bg-blue-50/40"><td colSpan={unit === 'min' ? 9 : 8} className="px-4 py-2">
                            <div className="grid gap-2 text-fs-12 md:grid-cols-2">
                              <div>
                                <div><b>Written by</b> {f.by || '—'}{f.at ? ` · ${f.at}` : ''}</div>
                                <div><b>Note of the hour</b> {f.note || '—'}</div>
                                {f.mp != null && <div><b>Manpower</b> {f.mp} (morning entry)</div>}
                                {f.station && <div><b>Station</b> {f.station}</div>}
                              </div>
                              <div>
                                {f.rcaRec ? (
                                  <>
                                    <div><b>Root cause</b> {f.rcaRec.rootCause || f.rcaRec.cause || '—'}</div>
                                    <div><b>Action</b> {f.rcaRec.action || '—'}</div>
                                    <div><b>Preventive</b> {f.rcaRec.preventive || '—'}</div>
                                    <div className="text-slate-600">{f.rcaRec.owner ? `Owner ${f.rcaRec.owner}` : ''}{f.rcaRec.targetDate ? ` · by ${dmy(f.rcaRec.targetDate)}` : ''}{f.rcaRec.closedBy ? ` · closed by ${f.rcaRec.closedBy}` : f.rcaRec.updatedBy ? ` · by ${f.rcaRec.updatedBy}` : ''}</div>
                                  </>
                                ) : <div className="text-slate-600">{f.rca === 'na' ? 'Planned stoppage — no RCA needed.' : 'No RCA written yet.'}{canRca && f.rca === 'pending' && <button type="button" onClick={() => onOpen('rca')} className="ml-2 font-bold text-blue-700 hover:underline">Open RCA →</button>}</div>}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {[['reason', f.reason], ['line', f.line], ['date', f.date], ['hour', String(f.hour)]].map(([dim, v]) => (
                                <button key={dim} type="button" onClick={() => pick(dim)(v)} className="rounded-full bg-white px-2 py-0.5 text-fs-12 font-bold text-blue-800 ring-1 ring-blue-200 hover:bg-blue-50">Only {dimText(dim, v)}</button>
                              ))}
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {rows.length > shown && <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 text-fs-12 font-semibold text-slate-600">Showing {shown} of {rows.length}<button type="button" onClick={() => setShown((n) => n + 100)} className="font-bold text-blue-700 hover:underline">Show 100 more</button></div>}
              </div>
            )}
          </Panel>
          )}
          
        </div>
      )}
    </div>
  );
}
