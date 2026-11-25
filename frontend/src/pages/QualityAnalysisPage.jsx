import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, X, ChevronLeft, ChevronDown, ChevronRight, Search, Table2, BarChart3, Factory, ArrowUpDown, ShieldCheck, ClipboardList } from 'lucide-react';
import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import { api } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { useOleLines, useOleData, card, StatusChip } from '../components/OleParts';
import { serverToday } from '../utils/serverTime';
import { quickPeriods, matchPeriod } from '../utils/mainFilter';
import { oleRange, stationsFor } from '../utils/ole';
import { buildFacts, applyFilters, setFilter, filterText, effectiveRange, prevRange, groupBy, grainOf, trendOf, matrixOf, dimText, daysIn, dmy, DIMS, INT_STEPS } from '../utils/drill';
import { ParetoBars, Columns, Heatmap, Legend, Delta, lineColor, deptColor, ACCENT, OTHER, SLOT, MUTED, UNWRITTEN } from '../components/DrillCharts';
import { buildXlsx, downloadXlsx, zebra } from '../utils/xlsxWriter';
import { qkindOf, qualityFacts, stationShort, prodRows, prodIn, madeOf, madeByBucket, withRate, qualityKpis, pctText, ppmText, rateOf, ppmOf, NO_STATION } from '../utils/qdrill';

/**
 * Rejection analysis / Rework analysis — the quality rows written on the Loss entry page (station, model,
 * defect, pieces), sliced by any click like Loss analysis: defect → station → line → day → hour → model → the single entry
 * (with its RCA). Every bar, row and cell is a filter; the drill path steps back. With the pieces the lines made, every
 * slice also has its rate (% of the pieces made, PPM). Compared with the previous period of the same length.
 * The maths is in utils/qdrill.js and utils/drill.js (tested in tests/qdrill.calc.test.js and tests/drill.calc.test.js).
 */
const read = (k, store = localStorage) => { try { return JSON.parse(store.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v, store = localStorage) => { try { store.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const PERIODS = ['today', 'yesterday', '7d', '30d', 'month', 'lastMonth', '3m'];
const HEATS = [['station-defect', 'Station × defect', 'station', 'defect'], ['line-station', 'Line × station', 'line', 'station'], ['model-defect', 'Model × defect', 'model', 'defect'], ['defect-time', 'Defect × time', 'defect', 'time'], ['line-hour', 'Line × hour', 'line', 'hour']];
const TIME_DIMS = ['date', 'span'];
const kpiCls = 'relative min-h-[104px] overflow-hidden rounded-xl border border-slate-200/90 bg-white p-3 pt-3.5 shadow-sm';
const th = 'px-2 py-1.5 text-left text-fs-11 font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap';
const nfx = (v) => Math.round(v || 0).toLocaleString('en-IN');

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

/**
 * Ranked bars of one hue with the rate beside each name: pieces (or entries) first, then the rate of the pieces made
 * (line / model / hour: of their own pieces; station / department: of all the pieces of the slice). by = 'rate' ranks and
 * draws the rate instead (a small model with many rejected pieces comes first).
 */
function QList({ rows, fmt, onPick, active = null, label, dot = null, prevOn = false, empty = 'Nothing in this slice.', by = 'value' }) {
  if (!rows?.length) return <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">{empty}</p>;
  const val = (r) => (by === 'rate' ? r.rate || 0 : r.value);
  const max = Math.max(...rows.map(val)) || 1;
  return (
    <ul className="flex flex-col gap-0.5" aria-label={label}>
      {rows.map((r, i) => {
        const on = active != null && r.key === String(active);
        return (
          <li key={r.key ?? `o-${i}`}>
            <button type="button" disabled={r.others || !onPick} onClick={() => onPick?.(r.key)} aria-pressed={on}
              aria-label={`${r.label}: ${fmt(r.value)}${r.rate != null ? `, ${pctText(r.rate)} of ${nfx(r.made)} made` : ''}`}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-left ${on ? 'bg-blue-50 ring-1 ring-blue-300' : r.others ? '' : 'hover:bg-slate-50'} disabled:cursor-default`}>
              <span className="flex min-w-0 items-center gap-1.5 text-fs-13 font-semibold text-slate-900">
                
                <span className="truncate" title={r.label}>{r.label}</span>
              </span>
              <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className={`font-mono tabular-nums ${by === 'rate' ? 'text-fs-12 font-semibold text-slate-600' : 'text-fs-13 font-bold text-slate-900'}`}>{fmt(r.value)}</span>
                <span className={`font-mono tabular-nums ${by === 'rate' ? 'text-fs-13 font-bold text-slate-900' : 'text-fs-11 font-semibold text-slate-500'}`} title={r.made != null ? `${fmt(r.value)} of ${nfx(r.made)} pieces made` : 'Share of the slice'}>
                  {r.rate != null ? pctText(r.rate) : r.made === 0 ? 'no pcs made' : `${r.share.toFixed(0)}%`}
                </span>
              </span>
              <span className="col-span-2 flex h-2.5 items-center">
                <span className="block h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (val(r) / max) * 100)}%`, background: r.others ? MUTED : ACCENT }} />
              </span>
              {(r.made != null || (prevOn && r.prev != null)) && (
                <span className="col-span-2 -mt-0.5 flex flex-wrap items-baseline gap-x-2 text-fs-11 text-slate-500">
                  {r.made != null && <span>of {nfx(r.made)} made</span>}
                  {prevOn && r.prev != null && <Delta value={r.value} prev={r.prev} fmt={fmt} small />}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function QualityAnalysisPage({ kind = 'reject', onOpen = null, canOpen = [] }) {
  const Q = qkindOf(kind);
  const SAVE = `ems.qan.${Q.id}.v1`;
  const DRILL = `ems.qan.${Q.id}.drill`;
  const today = serverToday();
  const ids = useOleLines();
  const saved = read(SAVE) || {};
  const [range, setRange] = useState(() => {
    const p = quickPeriods(today).find((x) => x.key === (saved.period || 'month'));
    return p ? { start: p.start, end: p.end } : { start: `${today.slice(0, 8)}01`, end: today };
  });
  const [measure, setMeasure] = useState(saved.measure === 'count' ? 'count' : 'value');
  const [split, setSplit] = useState(['station', 'line', 'none'].includes(saved.split) ? saved.split : 'station');
  const [trendBy, setTrendBy] = useState(saved.trendBy === 'rate' ? 'rate' : 'pcs');
  const [modelBy, setModelBy] = useState(saved.modelBy === 'rate' ? 'rate' : 'value');
  const [heat, setHeat] = useState(HEATS.some((h) => h[0] === saved.heat) ? saved.heat : 'station-defect');
  const [compare, setCompare] = useState(saved.compare ?? true);
  const [trendTable, setTrendTable] = useState(false);
  const [tab, setTab] = useState(['overview', 'where', 'entries'].includes(saved.tab) ? saved.tab : 'overview');
  const [filters, setFiltersS] = useState(() => (Array.isArray(read(DRILL, sessionStorage)) ? read(DRILL, sessionStorage).filter((x) => x && DIMS[x.dim]) : []));
  const [prodAsk, setProdAsk] = useState(false);
  const period = matchPeriod(today, range);
  const changeRange = (r) => { setRange(r); setFiltersS((f) => { const n = f.filter((x) => !TIME_DIMS.includes(x.dim)); write(DRILL, n, sessionStorage); return n; }); setProdAsk(false); };
  useEffect(() => { write(SAVE, { period: period?.key || saved.period || 'month', measure, split, trendBy, modelBy, heat, compare, tab }); }, [period?.key, measure, split, trendBy, modelBy, heat, compare, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFilters = (f) => { setFiltersS(f); write(DRILL, f, sessionStorage); };
  const pick = (dim) => (value) => { if (value != null) setFilters(setFilter(filters, dim, value)); };
  const back = () => setFilters(filters.slice(0, -1));
  const meas = measure;
  const fmt = (v) => (meas === 'count' ? `${Math.round(v)}` : `${nfx(v)} pcs`);
  const axis = (v) => `${Math.round(v)}`;
  const word = Q.label.toLowerCase();   // "rejection" / "rework"

  // ── data: entries (fast) + the production of the lines for the rates (a period up to a month at once, longer when asked)
  const nDays = daysIn(range.start, range.end);
  const prodOn = nDays <= 31 || prodAsk;
  const D = useOleData({ start: range.start, end: range.end, ids, prod: prodOn, paused: true });
  useEffect(() => {
    if (range.end < today) return undefined;
    const t = setInterval(() => { if (!document.hidden) D.reloadEnt(); }, 120000);
    return () => clearInterval(t);
  }, [range.start, range.end, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = useAllLineSettings(ids);
  const pr = prevRange(range.start, range.end);
  const [prevEnt, setPrevEnt] = useState(null);
  useEffect(() => {
    if (!compare) { setPrevEnt(null); return undefined; }
    let alive = true;
    setPrevEnt(null);
    api.oleEntries(pr.from, pr.to).then((j) => { if (alive) setPrevEnt(j || {}); }).catch(() => { if (alive) setPrevEnt({ failed: true }); });
    return () => { alive = false; };
  }, [compare, pr.from, pr.to]);
  const stationList = D.ent.reasons.station || [];
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, D.ent.setup, range.start, range.end, today, D.endMin, ids]);
  const prod = useMemo(() => (R ? prodRows(R.days, ids) : null), [R, ids]);
  const facts = useMemo(() => qualityFacts(buildFacts({
    entries: { ...(prevEnt?.entries || {}), ...D.ent.entries }, start: compare ? pr.from : range.start, end: range.end, ids,
    rca: { ...(prevEnt?.rca || {}), ...D.ent.rca }, reasons: D.ent.reasons,
  }), Q.id, stationList), [D.ent, prevEnt, compare, pr.from, range.start, range.end, ids, Q.id, stationList]);

  // stations keep their colour (the admin's station order); more than seven fold into "Other"
  const stNames = useMemo(() => stationsFor(stationList, ids, { all: true }).map((x) => x.reason), [stationList, ids]);
  const stSeries = (s) => (s === NO_STATION ? s : stNames.indexOf(s) >= 0 && stNames.indexOf(s) < 7 ? s : 'Other');
  const stColor = (s) => (s === NO_STATION ? UNWRITTEN : s === 'Other' ? OTHER : SLOT[stNames.indexOf(s)] || OTHER);
  const stText = (s) => (s === 'Other' || s === NO_STATION ? s : stationShort(s, stationList));

  // ── the slice
  const eff = effectiveRange(range.start, range.end, filters);
  const effNoDay = effectiveRange(range.start, range.end, filters.filter((f) => f.dim !== 'date'));
  const pv = prevRange(eff.from, eff.to);
  const cmpOn = compare && !!prevEnt && !prevEnt.failed;
  const sliceOf = (skip = []) => applyFilters(facts, { filters, from: skip.includes('date') ? effNoDay.from : eff.from, to: skip.includes('date') ? effNoDay.to : eff.to, skip });
  const prevOf = (skip = []) => (cmpOn ? applyFilters(facts, { filters: filters.filter((f) => !TIME_DIMS.includes(f.dim)), from: pv.from, to: pv.to, skip }) : null);
  const prodOf = (skip = []) => (prod ? prodIn(prod, { filters, from: skip.includes('date') ? effNoDay.from : eff.from, to: skip.includes('date') ? effNoDay.to : eff.to, skip }) : []);
  const deps = [facts, filters, eff.from, eff.to, meas, cmpOn, prod]; // eslint-disable-line react-hooks/exhaustive-deps
  const slice = useMemo(() => sliceOf(), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const prevSlice = useMemo(() => prevOf(), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const madeSlice = useMemo(() => (prod ? madeOf(prodOf()) : null), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const K = useMemo(() => qualityKpis(slice, madeSlice || 0), [slice, madeSlice]);
  const KP = useMemo(() => (prevSlice ? qualityKpis(prevSlice, 0) : null), [prevSlice]);
  const total = meas === 'count' ? K.entries : K.total;
  const totalPrev = KP ? (meas === 'count' ? KP.entries : KP.total) : null;
  const active = (dim) => filters.find((f) => f.dim === dim)?.value ?? null;
  const list = (dim, opts = {}) => {
    const g = groupBy(sliceOf([dim]), dim, meas, { prev: prevOf([dim]), ...opts });
    return prod && meas === 'value' ? withRate(g, dim, prodOf([dim]), madeOf(prodOf([dim]))) : g;
  };
  const defects = useMemo(() => list('defect', { top: 15 }), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const stations = useMemo(() => list('station').map((r) => ({ ...r, label: r.others ? r.label : stText(r.key) })), [...deps, stationList]); // eslint-disable-line react-hooks/exhaustive-deps
  const depts = useMemo(() => list('dept'), deps); // eslint-disable-line react-hooks/exhaustive-deps
  // 20-11-2026: category of the defect (Production / Assy / Part / Process) and the pieces dismantled
  const cats = useMemo(() => list('cat'), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const dismantled = useMemo(() => slice.reduce((a, f) => a + (f.dismantle || 0), 0), [slice]);
  const lines = useMemo(() => list('line'), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const hours = useMemo(() => list('hour'), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const models = useMemo(() => {
    const all = list('model');
    if (modelBy === 'rate' && prod && meas === 'value') return all.filter((r) => r.made > 0).sort((a, b) => (b.rate || 0) - (a.rate || 0) || b.value - a.value).slice(0, 12);
    return all.slice(0, 12);
  }, [...deps, modelBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── trend (the day filter stays open: the picked day is marked, the others still show)
  const grain = grainOf(effNoDay.from, effNoDay.to);
  const trendSlice = useMemo(() => sliceOf(['date']), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const splitBy = split === 'station' && active('station') ? 'none' : split === 'line' && active('line') ? 'none' : split;
  const trend = useMemo(() => trendOf(trendSlice, { from: effNoDay.from, to: effNoDay.to, grain, split: splitBy === 'none' ? null : splitBy, measure: meas, seriesOrder: splitBy === 'station' ? (f) => stSeries(f.station) : null }),
    [trendSlice, effNoDay.from, effNoDay.to, grain, splitBy, meas, stNames]); // eslint-disable-line react-hooks/exhaustive-deps
  const madeBk = useMemo(() => (prod ? madeByBucket(prodOf(['date']), grain) : null), [...deps, grain]); // eslint-disable-line react-hooks/exhaustive-deps
  const rateTrend = useMemo(() => {
    if (!madeBk || meas !== 'value') return null;
    return trend.buckets.map((b) => { const made = madeBk.get(b.key) || 0; const r = rateOf(b.total, made); return { ...b, made, rate: r, total: r || 0, parts: { all: r || 0 }, label: `${b.label} · ${nfx(b.total)} of ${nfx(made)} made` }; });
  }, [trend, madeBk, meas]);
  const showRate = trendBy === 'rate' && !!rateTrend;
  const seriesOrder = showRate ? ['all'] : splitBy === 'station' ? [...stNames.slice(0, 7), NO_STATION, 'Other'].filter((s) => trend.series.includes(s)) : splitBy === 'line' ? ids.filter((l) => trend.series.includes(l)) : ['all'];
  const seriesColor = (s) => (splitBy === 'station' ? stColor(s) : splitBy === 'line' ? lineColor(s) : ACCENT);
  const seriesName = (s) => (splitBy === 'line' ? `Line ${s}` : s === 'all' ? Q.label : stText(s));
  const pickBucket = (b) => (grain === 'day' ? pick('date')(b.key) : setFilters(setFilter(filters, 'span', { from: b.from, to: b.to })));
  const bucketActive = (b) => (grain === 'day' ? active('date') === b.key : false);

  // ── heat map
  const [, hLabel, rowDim, colDim] = HEATS.find((h) => h[0] === heat);
  const heatSlice = useMemo(() => sliceOf(colDim === 'time' ? ['date'] : []), [...deps, heat]); // eslint-disable-line react-hooks/exhaustive-deps
  const M = useMemo(() => {
    const m = matrixOf(heatSlice, rowDim, colDim, meas, { from: colDim === 'time' ? effNoDay.from : eff.from, to: colDim === 'time' ? effNoDay.to : eff.to, maxRows: 12, maxCols: 10 });
    const short = (dim, x) => (dim === 'station' && !x.other ? { ...x, label: stText(x.key) } : x);
    return { ...m, rows: m.rows.map((x) => short(rowDim, x)), cols: m.cols.map((x) => short(colDim, x)) };
  }, [heatSlice, rowDim, colDim, meas, eff.from, eff.to, effNoDay.from, effNoDay.to, stationList]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickCell = (r, c) => {
    let f = setFilter(filters.filter((x) => x.dim !== rowDim), rowDim, r.key);
    if (colDim === 'time') {
      const b = M.colBuckets.find((x) => x.key === c.key);
      f = M.grain === 'day' ? setFilter(f.filter((x) => x.dim !== 'date'), 'date', c.key) : setFilter(f.filter((x) => x.dim !== 'span'), 'span', { from: b.from, to: b.to });
    } else f = setFilter(f.filter((x) => x.dim !== colDim), colDim, c.key);
    setFilters(f);
  };
  const cellActive = (r, c) => String(active(rowDim)) === String(r.key) && (colDim === 'time' ? active('date') === c.key : String(active(colDim)) === String(c.key));

  // ── entries
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ k: 'date', dir: 1 });
  const [shown, setShown] = useState(60);
  const [open, setOpen] = useState(null);
  useEffect(() => { setShown(60); setOpen(null); }, [filters, range.start, range.end]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = slice.filter((f) => !t || [f.defect, f.station, stText(f.station), f.dept, f.model, f.note, f.by, f.cat, f.cause, f.action, f.dismantle ? 'dismantled' : '', `line ${f.line}`, dmy(f.date)].join(' ').toLowerCase().includes(t));
    const key = { date: (f) => `${f.date}|${String(f.hour).padStart(2, '0')}|${f.line}`, line: (f) => Number(f.line), station: (f) => f.station, model: (f) => f.model, defect: (f) => f.defect, cat: (f) => f.cat || '~', dept: (f) => f.dept, value: (f) => f.value, rca: (f) => f.rca }[sort.k] || ((f) => f.date);
    return [...r].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [slice, q, sort, stationList]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortBy = (k) => setSort((s) => ({ k, dir: s.k === k ? -s.dir : k === 'value' ? -1 : 1 }));

  // ── context
  const loadingFirst = !D.entReady && !D.err;
  const ctx = filters.length ? filters.map((f) => (f.dim === 'station' ? `Station: ${stText(f.value)}` : filterText(f))).join(' › ') : 'All data';
  const periodText = eff.from === eff.to ? dmy(eff.from) : `${dmy(eff.from)} – ${dmy(eff.to)}`;
  const prevText = `${dmy(pv.from)} – ${dmy(pv.to)}`;
  const top = useHeaderBottom();
  const can = (p) => onOpen && canOpen.includes(p);
  const prodNote = !prodOn ? null : !prod ? (D.err ? 'The lines did not answer — no rate.' : 'Reading the production of the lines…') : null;

  // ── Excel of the slice
  const excel = () => {
    const title = `${Q.title} · ${periodText} · ${ctx}`;
    const head = (cols) => cols.map((v) => ({ v, s: 'head' }));
    const z = (i) => (i % 2 ? zebra : (n) => n);
    const mName = meas === 'count' ? 'Entries' : 'Qty';
    const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
    const groupSheet = (name, dim, rowsG, labelOf = (r) => r.label) => ({
      name, cols: [{ width: 34 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 14 }, ...(cmpOn ? [{ width: 14 }] : [])],
      rows: [[{ v: title, s: 'title' }], [{ v: `${DIMS[dim].label} · ${mName}`, s: 'subtitle' }], [],
        head([DIMS[dim].label, mName, 'Share %', 'Cumulative %', 'Production qty', 'Rate %', 'PPM', 'Entries', 'Days', 'Lines', ...(cmpOn ? [`Previous (${prevText})`] : [])]),
        ...rowsG.map((r, i) => [{ v: labelOf(r), s: z(i)('text') }, { v: Math.round(r.value), s: z(i)('int') }, { v: r2(r.share), s: z(i)('dec1') }, { v: r2(r.cumPct), s: z(i)('dec1') },
          { v: r.made ?? null, s: z(i)('int') }, { v: r2(r.rate), s: z(i)('dec1') }, { v: r.made > 0 ? Math.round(ppmOf(r.value, r.made)) : null, s: z(i)('int') },
          { v: r.count, s: z(i)('int') }, { v: r.days, s: z(i)('int') }, { v: (r.lines || []).map((l) => `L${l}`).join(' '), s: z(i)('center') }, ...(cmpOn ? [{ v: r.prev ?? null, s: z(i)('int') }] : [])])],
      merges: ['A1:J1'], freezeRow: 4, headerRow: 4,
    });
    const all = (dim) => list(dim);
    const MX = matrixOf(sliceOf(), 'station', 'defect', meas, { from: eff.from, to: eff.to, maxRows: 30, maxCols: 30 });
    const sheets = [
      { name: 'Summary', cols: [{ width: 30 }, { width: 46 }],
        rows: [[{ v: `${Q.title} — drill-down`, s: 'title' }], [],
          ...[['Period', periodText], ['Drill path', ctx], ['Lines', ids.map((l) => `Line ${l}`).join(', ')],
            [`Qty ${Q.done}`, nfx(K.total)], ['Entries', K.entries], [`Days with ${word}`, K.days],
            ['Production qty', madeSlice == null ? 'not read' : nfx(madeSlice)], [`${Q.label} rate`, pctText(K.rate)], ['PPM', ppmText(K.ppm)],
            ['Top defect', K.topDefect ? `${K.topDefect.key} · ${nfx(K.topDefect.value)} pcs (${K.topDefect.share.toFixed(1)}%)` : '—'],
            ['Top station', K.topStation ? `${stText(K.topStation.key)} · ${nfx(K.topStation.value)} pcs` : '—'],
            ...(cmpOn ? [['Previous period', prevText], [`Previous pieces ${Q.done}`, nfx(KP.total)]] : []),
            ['Rate', 'pieces ÷ pieces made in the same line / day / hour / model slice (station, defect and department: of all the pieces made)']]
            .map(([a, b]) => [{ v: a, s: 'metaLabel' }, { v: b, s: 'metaValue' }])] },
      groupSheet('Defects', 'defect', all('defect')), groupSheet('Categories', 'cat', all('cat')), groupSheet('Stations', 'station', all('station'), (r) => (r.others ? r.label : r.key)),
      groupSheet('Lines', 'line', all('line')), groupSheet('Models', 'model', all('model')), groupSheet('Days', 'date', withRate(groupBy(sliceOf(['date']), 'date', meas), 'date', prodOf(['date']), madeOf(prodOf(['date'])))),
      groupSheet('Hours', 'hour', all('hour')), groupSheet('Departments', 'dept', all('dept')),
      { name: 'Station x defect', cols: [{ width: 34 }, ...MX.cols.map(() => ({ width: 14 })), { width: 10 }],
        rows: [[{ v: `${title} · station × defect (${mName.toLowerCase()})`, s: 'title' }], [], head(['Station \\ defect', ...MX.cols.map((c) => c.label), 'Total']),
          ...MX.rows.map((r, i) => [{ v: r.label, s: z(i)('text') }, ...MX.grid[i].map((v) => ({ v: v || null, s: z(i)('int') })), { v: r.total, s: z(i)('int') }])],
        freezeRow: 3, headerRow: 3 },
      { name: 'Entries', cols: [{ width: 12 }, { width: 7 }, { width: 13 }, { width: 30 }, { width: 24 }, { width: 28 }, { width: 13 }, { width: 16 }, { width: 9 }, { width: 11 }, { width: 12 }, { width: 30 }, { width: 30 }, { width: 28 }, { width: 14 }],
        rows: [[{ v: title, s: 'title' }], [], head(['Date', 'Line', 'Hour', 'Station', 'Model', 'Defect', 'Category', 'Department', 'Qty', 'Dismantled', 'RCA', 'Root cause', 'Action', 'Note', 'Written by']),
          ...slice.map((f, i) => [{ v: dmy(f.date), s: z(i)('text') }, { v: `L${f.line}`, s: z(i)('center') }, { v: dimText('hour', f.hour), s: z(i)('center') }, { v: f.station, s: z(i)('text') },
            { v: f.model || '', s: z(i)('text') }, { v: f.defect, s: z(i)('text') }, { v: f.cat || '', s: z(i)('text') }, { v: f.dept, s: z(i)('text') }, { v: f.value, s: z(i)('int') }, { v: f.dismantle || null, s: z(i)('int') },
            { v: { pending: 'Pending', submitted: 'Submitted', closed: 'Closed', na: '—' }[f.rca] || '', s: z(i)('center') },
            { v: f.cause || f.rcaRec?.rootCause || f.rcaRec?.cause || '', s: z(i)('text') }, { v: f.action || f.rcaRec?.action || '', s: z(i)('text') }, { v: f.note || '', s: z(i)('text') }, { v: f.by || '', s: z(i)('text') }])],
        freezeRow: 3, headerRow: 3, autoFilter: `A3:O${slice.length + 3}` },
    ];
    downloadXlsx(buildXlsx(sheets), `${Q.title.replace(' ', '_')}_${eff.from}_${eff.to}.xlsx`);
  };

  const rateTile = madeSlice == null ? (
    <Kpi label={`${Q.label} rate`} aria="Rate" value={prodOn ? '…' : '—'} bar="#57534e"
      sub={prodOn ? (D.err ? 'The lines did not answer' : 'Reading the production of the lines…') : 'Production data is not loaded automatically for a period of this length'}>
      {!prodOn && <button type="button" onClick={() => setProdAsk(true)} className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-2 text-fs-12 font-bold text-slate-700 hover:bg-slate-50"><Factory size={14} aria-hidden /> Read production ({nDays} days)</button>}
    </Kpi>
  ) : (
    // a small rate reads better in PPM (quality's own unit): 30 PPM rather than 0.003 %
    <Kpi label={`${Q.label} rate`} aria="Rate" value={K.rate != null && K.rate > 0 && K.rate < 0.1 ? ppmText(K.ppm) : pctText(K.rate)} bar="#57534e"
      sub={<>{K.rate != null && K.rate > 0 && K.rate < 0.1 ? pctText(K.rate) : ppmText(K.ppm)} · of {nfx(madeSlice)} pcs made{filters.some((f) => !['line', 'date', 'span', 'hour', 'model'].includes(f.dim)) && <span className="block font-normal text-slate-500">Station / defect / department: of all the pieces made</span>}</>} />
  );
  const blank = (rws) => rws.length > 0 && rws.every((r) => r.key === '');

  return (
    <div className="flex flex-col gap-3" role="region" aria-label={Q.title}>
      <HeaderBar label={`${Q.title} filters`}>
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
        <button type="button" className={`${fieldCls} inline-flex items-center gap-1.5 font-bold`} onClick={() => D.reload()} aria-label="Read again" title="Read again"><RefreshCw size={14} className={D.loading ? 'animate-spin' : ''} aria-hidden /></button>
      </HeaderBar>

      <section className={card} aria-label="What to analyse">
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="Measure">
            {[['value', 'Qty'], ['count', 'Entries']].map(([k, l]) => <button key={k} type="button" aria-pressed={meas === k} className={segBtn(meas === k, 'navy')} onClick={() => setMeasure(k)}>{l}</button>)}
          </Seg>
          {can(qkindOf(Q.other).page) && <button type="button" onClick={() => onOpen(qkindOf(Q.other).page)} className="text-fs-13 font-bold text-blue-700 hover:underline">{qkindOf(Q.other).title} ›</button>}
          {can('quality') && <button type="button" onClick={() => onOpen('quality')} className="inline-flex items-center gap-1 text-fs-13 font-bold text-blue-700 hover:underline"><ShieldCheck size={14} aria-hidden /> FPY / RTY ›</button>}
          <button type="button" onClick={excel} disabled={!slice.length} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"><Download size={15} aria-hidden /> Excel of this view</button>
        </div>
        
      </section>

      {/* drill path: always in view while scrolling */}
      <nav aria-label="Drill path" className="sticky z-20 -mx-1 rounded-xl border border-blue-200 bg-blue-50/95 px-3 py-2 shadow-sm backdrop-blur" style={{ top: top + 4 }}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-fs-12 font-bold uppercase tracking-wide text-blue-900">Drill path</span>
          <button type="button" onClick={() => setFilters([])} className={`rounded-full px-2.5 py-0.5 text-fs-13 font-bold ${filters.length ? 'text-blue-800 hover:bg-blue-100' : 'bg-blue-700 text-white'}`}>All data · {periodText}</button>
          {filters.map((f, i) => {
            const t = f.dim === 'station' ? `Station: ${stText(f.value)}` : filterText(f);
            return (
              <React.Fragment key={`${f.dim}-${i}`}>
                <ChevronRight size={14} className="text-blue-400" aria-hidden />
                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-white py-0.5 pl-2.5 pr-1 text-fs-13 font-semibold text-slate-800 ring-1 ring-blue-300">
                  <button type="button" className="truncate hover:underline" onClick={() => setFilters(filters.slice(0, i + 1))} title="Go back to this step">{t}</button>
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setFilters(filters.filter((_, j) => j !== i))} className="grid h-5 w-5 place-items-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-700"><X size={13} /></button>
                </span>
              </React.Fragment>
            );
          })}
          <span className="ml-auto flex items-center gap-1.5">
            {filters.length > 0 && <button type="button" onClick={back} className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-300 bg-white px-2 text-fs-12 font-bold text-blue-800 hover:bg-blue-100"><ChevronLeft size={14} aria-hidden /> Back</button>}
            {filters.length > 0 && <button type="button" onClick={() => setFilters([])} className="inline-flex h-7 items-center rounded-md px-2 text-fs-12 font-bold text-slate-600 hover:bg-white">Clear all</button>}
          </span>
        </div>
      </nav>

      {D.err && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-fs-13 font-semibold text-amber-900">{D.err}</div>}
      {loadingFirst ? <div className={`${card} text-center text-fs-14 font-semibold text-slate-500`}>Reading the {word} entries…</div> : (
        <div className="flex flex-col gap-3">
          {!slice.length && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-fs-14 font-semibold text-slate-600">
              No {word} written in this slice{filters.length ? ' — step back on the drill path or clear it' : ` (${periodText})`}.
              {!filters.length && can('oleentry') && <button type="button" onClick={() => onOpen('oleentry')} className="inline-flex items-center gap-1 font-bold text-blue-700 hover:underline"><ClipboardList size={14} aria-hidden /> Loss entry ›</button>}
            </div>
          )}
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label="Totals of the slice">
            <Kpi label={meas === 'count' ? `Entries · ${word}` : `Qty ${Q.done}`} aria="Total" value={fmt(total)} bar={ACCENT}
              sub={<>{K.entries} entr{K.entries === 1 ? 'y' : 'ies'} · {K.days} day{K.days === 1 ? '' : 's'}{cmpOn && <><br /><Delta value={total} prev={totalPrev} fmt={fmt} /> <span className="font-normal text-slate-500">vs {prevText}</span></>}</>} />
            {rateTile}
            <Kpi label="Top defect" aria="Top defect" text value={K.topDefect ? K.topDefect.key : '—'} bar="#eda100"
              sub={K.topDefect ? <>{nfx(K.topDefect.value)} pcs · {K.topDefect.share.toFixed(0)}% of the {word}{K.topStation && <><br />Top station <b>{stText(K.topStation.key)}</b> · {nfx(K.topStation.value)} pcs</>}</> : null}>
              {K.topDefect && active('defect') !== K.topDefect.key && <button type="button" onClick={() => pick('defect')(K.topDefect.key)} className="mt-1 text-fs-12 font-bold text-blue-700 hover:underline">Only this defect →</button>}
            </Kpi>
            <Kpi label="RCA" aria="RCA status" value={`${(() => { const s = new Map(); for (const f of slice) if (f.rcaKey) s.set(f.rcaKey, f.rca); return [...s.values()].filter((x) => x === 'pending').length; })()} pending`} bar="#d03b3b"
              sub={(() => { const s = new Map(); for (const f of slice) if (f.rcaKey) s.set(f.rcaKey, f.rca); const v = [...s.values()]; return <>{v.filter((x) => x === 'submitted').length} submitted · {v.filter((x) => x === 'closed').length} closed{v.length ? ` · of ${v.length}` : ''}</>; })()}>
              {can('rca') && slice.some((f) => f.rca === 'pending') && <button type="button" onClick={() => onOpen('rca')} className="mt-1 text-fs-12 font-bold text-blue-700 hover:underline">Open RCA →</button>}
            </Kpi>
          </div>

          {/* one part at a time: easier to read; the drill path above works on every tab */}
          <div role="tablist" aria-label="Analysis parts" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {[['overview', 'Overview', 'Trend, defects and stations'], ['where', 'Where & when', 'Line, model, hour, department, heat map'], ['entries', `Entries · ${rows.length}`, `Every ${word} written, with its RCA`]].map(([k, l, sub]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} title={sub}
                className={`flex min-w-[8.5rem] flex-1 flex-col items-start rounded-lg px-3 py-2 text-left ${tab === k ? 'bg-dixon-navy text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
                <span className="text-fs-14 font-bold">{l}</span>
                <span className={`hidden text-fs-11 sm:block ${tab === k ? 'text-white/80' : 'text-slate-500'}`}>{sub}</span>
              </button>
            ))}
          </div>

          {tab === 'overview' && (<>
          <Panel label="Trend" title={`${showRate ? `${Q.label} rate` : Q.label} by ${grain === 'day' ? 'day' : grain === 'week' ? 'week' : 'month'}`}
            sub={`${dmy(effNoDay.from)} – ${dmy(effNoDay.to)}${showRate ? ' · % of the pieces made' : ''}`}
            right={(
              <div className="flex flex-wrap items-center gap-2">
                {rateTrend && <Seg label="Show">{[['pcs', meas === 'count' ? 'Entries' : 'Qty'], ['rate', 'Rate %']].map(([k, l]) => <button key={k} type="button" aria-pressed={trendBy === k} className={segBtn(trendBy === k, 'navy')} onClick={() => setTrendBy(k)}>{l}</button>)}</Seg>}
                {!showRate && <Seg label="Split the trend by">{[['station', 'Station'], ['line', 'Line'], ['none', 'Total']].map(([k, l]) => <button key={k} type="button" aria-pressed={split === k} className={segBtn(split === k, 'navy')} onClick={() => setSplit(k)}>{l}</button>)}</Seg>}
                <button type="button" onClick={() => setTrendTable((x) => !x)} aria-pressed={trendTable} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-2 text-fs-12 font-bold text-slate-700 hover:bg-slate-50">{trendTable ? <><BarChart3 size={14} aria-hidden /> Chart</> : <><Table2 size={14} aria-hidden /> Table</>}</button>
              </div>
            )}>
            {seriesOrder.length > 1 && !trendTable && <div className="mb-2"><Legend items={seriesOrder.map((s) => ({ key: s, label: seriesName(s), color: seriesColor(s) }))} /></div>}
            {trendTable ? (
              <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-fs-12 tabular-nums" aria-label="Trend table">
                  <thead className="sticky top-0 bg-slate-50"><tr><th className={th}>{grain === 'day' ? 'Day' : grain === 'week' ? 'Week' : 'Month'}</th>{splitBy !== 'none' && seriesOrder.length > 1 && !showRate && seriesOrder.map((s) => <th key={s} className={`${th} text-right`}>{seriesName(s)}</th>)}<th className={`${th} text-right`}>Total</th>{rateTrend && <><th className={`${th} text-right`}>Made</th><th className={`${th} text-right`}>Rate</th></>}</tr></thead>
                  <tbody>{trend.buckets.map((b, i) => (
                    <tr key={b.key} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-semibold text-slate-800">{b.label}</td>
                      {splitBy !== 'none' && seriesOrder.length > 1 && !showRate && seriesOrder.map((s) => <td key={s} className="px-2 py-1 text-right font-mono">{b.parts[s] ? fmt(b.parts[s]) : ''}</td>)}
                      <td className="px-2 py-1 text-right font-mono font-bold">{b.total ? fmt(b.total) : '—'}</td>
                      {rateTrend && <><td className="px-2 py-1 text-right font-mono">{rateTrend[i].made ? nfx(rateTrend[i].made) : '—'}</td><td className="px-2 py-1 text-right font-mono font-bold">{pctText(rateTrend[i].rate)}</td></>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : showRate ? (
              <Columns buckets={rateTrend} valueText={pctText} axisText={(v) => `${Math.round(v * 1000) / 1000}%`} onPick={pickBucket} isActive={bucketActive} label="Rate chart" height={210} emptyText={`No ${word} in this slice.`} />
            ) : (
              <Columns buckets={trend.buckets} series={seriesOrder} colorOf={seriesColor} nameOf={seriesName} valueText={fmt} axisText={axis} onPick={pickBucket} isActive={bucketActive} label="Trend chart" height={210} emptyText={`No ${word} in this slice.`} steps={INT_STEPS} />
            )}
          </Panel>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel label="Defect Pareto" title={active('station') ? `Defects at ${stText(active('station'))}` : 'Defect-wise Pareto'}>
              <ParetoBars rows={defects} valueText={fmt} onPick={pick('defect')} active={active('defect')} label="Defects" prevOn={cmpOn} />
            </Panel>
            <Panel label="By station" title="By station" sub={`Where the ${word} was found (LQC, FQC, leak test …); the rate is of all the pieces made.`}>
              <QList rows={stations} fmt={fmt} onPick={pick('station')} active={active('station')} label="Stations" dot={(k) => stColor(stSeries(k))} prevOn={cmpOn} />
            </Panel>
          </div>
          </>)}

          {tab === 'where' && (<>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            <Panel label="By line" title="By line" sub="Rate = of the pieces each line made."><QList rows={lines} fmt={fmt} onPick={pick('line')} active={active('line')} label="Lines" dot={lineColor} prevOn={cmpOn} /></Panel>
            <Panel label="By model" title="By model" sub={modelBy === 'rate' ? 'Highest rate first (of the pieces of each model).' : `Models with the most ${word} (top 12).`}
              right={prod && meas === 'value' ? <Seg label="Rank models by">{[['value', 'Qty'], ['rate', 'Rate %']].map(([k, l]) => <button key={k} type="button" aria-pressed={modelBy === k} className={segBtn(modelBy === k, 'navy')} onClick={() => setModelBy(k)}>{l}</button>)}</Seg> : null}>
              {blank(models) ? <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">No model written with these entries.</p> : <QList rows={models} fmt={fmt} onPick={pick('model')} active={active('model')} label="Models" prevOn={cmpOn && modelBy !== 'rate'} by={modelBy === 'rate' && prod && meas === 'value' ? 'rate' : 'value'} />}
            </Panel>
            <Panel label="By category" title="By category" sub={<>Production · Assy · Part · Process{dismantled > 0 && <> · <b className="text-red-700" data-testid="dismantled-total">{nfx(dismantled)} pcs dismantled</b></>}</>}>
              <QList rows={cats} fmt={fmt} onPick={pick('cat')} active={active('cat')} label="Categories" prevOn={cmpOn} />
            </Panel>
            <Panel label="By department" title="By department">
              <QList rows={depts} fmt={fmt} onPick={pick('dept')} active={active('dept')} label="Departments" dot={deptColor} prevOn={cmpOn} />
            </Panel>
            <Panel label="By hour of the day" title="By hour of the day" className="lg:col-span-2 2xl:col-span-3">
              <Columns buckets={hours.map((h) => ({ key: h.key, label: `${h.label}${h.rate != null ? ` · ${pctText(h.rate)} of ${nfx(h.made)} made` : ''}`, short: String(h.key).padStart(2, '0'), total: h.value, parts: { all: h.value } }))} valueText={fmt} axisText={axis}
                onPick={(b) => pick('hour')(b.key)} isActive={(b) => String(active('hour')) === b.key} label="Hours chart" height={170} emptyText={`No ${word} in this slice.`} steps={INT_STEPS} />
            </Panel>
          </div>
          <Panel label="Heat map" title={`Heat map · ${hLabel}`}
            right={<Seg label="Heat map">{HEATS.map(([k, l]) => <button key={k} type="button" aria-pressed={heat === k} className={segBtn(heat === k, 'navy')} onClick={() => setHeat(k)}>{l}</button>)}</Seg>}>
            <Heatmap m={M} valueText={fmt} cellText={(v) => `${Math.round(v)}`} onPick={pickCell} isActive={cellActive} rowLabel={DIMS[rowDim].label} colLabel={colDim === 'time' ? (M.grain === 'day' ? 'Day' : M.grain === 'week' ? 'Week' : 'Month') : DIMS[colDim].label} label="Heat map table" />
          </Panel>
          </>)}

          {tab === 'entries' && (
          <Panel label="Entries" title={`Entries · ${rows.length}`}
            right={(
              <label className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search defect, station, model, note…" aria-label="Search the entries" className="h-8 w-64 max-w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-fs-13 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            )}>
            {!rows.length ? <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">No entry in this slice.</p> : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[56rem] text-fs-12 tabular-nums" aria-label="Entries table">
                  <thead className="bg-slate-50"><tr>
                    {[['date', 'Day / hour'], ['line', 'Line'], ['station', 'Station'], ['model', 'Model'], ['defect', 'Defect'], ['cat', 'Category'], ['dept', 'Department'], ['value', 'Qty'], ['rca', 'RCA']].map(([k, l]) => (
                      <th key={k} className={`${th} ${k === 'value' ? 'text-right' : ''}`}><button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800" aria-label={`Sort by ${l}`}>{l}{sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : <ArrowUpDown size={11} aria-hidden />}</button></th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, shown).map((f) => (
                      <React.Fragment key={f.id}>
                        <tr className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${open === f.id ? 'bg-blue-50/60' : ''}`} onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
                          <td className="whitespace-nowrap px-2 py-1.5"><span className="inline-flex items-center gap-1 font-semibold text-slate-900">{open === f.id ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}{dmy(f.date)}</span><div className="pl-4 font-mono text-slate-500">{dimText('hour', f.hour)}</div></td>
                          <td className="whitespace-nowrap px-2 py-1.5">L{f.line}</td>
                          <td className="px-2 py-1.5"><span className="font-semibold text-slate-800" title={f.station}>{stText(f.station)}</span></td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{f.model || '—'}</td>
                          <td className="px-2 py-1.5 font-semibold text-slate-900">{f.defect}{f.dismantle > 0 && <span className="ml-1.5 whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-fs-11 font-bold text-red-700 ring-1 ring-red-200">{f.dismantle} dismantled</span>}</td>
                          <td className="px-2 py-1.5 text-slate-700">{f.cat || '—'}</td>
                          <td className="px-2 py-1.5"><i className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: deptColor(f.dept) }} />{f.dept}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold text-slate-900">{f.value}</td>
                          <td className="px-2 py-1.5">{f.rca === 'na' ? <span className="text-slate-400">not needed</span> : <StatusChip st={f.rca} />}</td>
                        </tr>
                        {open === f.id && (
                          <tr className="bg-blue-50/40"><td colSpan={9} className="px-4 py-2">
                            <div className="grid gap-2 text-fs-12 md:grid-cols-2">
                              <div>
                                <div><b>Written by</b> {f.by || '—'}{f.at ? ` · ${f.at}` : ''}</div>
                                <div><b>Note of the hour</b> {f.note || '—'}</div>
                                <div><b>Station</b> {f.station}</div>
                                <div><b>Category</b> {f.cat || '—'}{f.dismantle > 0 ? ` · ${f.dismantle} dismantled` : ''}</div>
                                <div><b>Root cause (entry)</b> {f.cause || '—'}</div>
                                <div><b>Action (entry)</b> {f.action || '—'}</div>
                              </div>
                              <div>
                                {f.rcaRec ? (
                                  <>
                                    <div><b>Root cause</b> {f.rcaRec.rootCause || f.rcaRec.cause || '—'}</div>
                                    <div><b>Action</b> {f.rcaRec.action || '—'}</div>
                                    <div><b>Preventive</b> {f.rcaRec.preventive || '—'}</div>
                                    <div className="text-slate-600">{f.rcaRec.owner ? `Owner ${f.rcaRec.owner}` : ''}{f.rcaRec.targetDate ? ` · by ${dmy(f.rcaRec.targetDate)}` : ''}{f.rcaRec.closedBy ? ` · closed by ${f.rcaRec.closedBy}` : f.rcaRec.updatedBy ? ` · by ${f.rcaRec.updatedBy}` : ''}</div>
                                  </>
                                ) : <div className="text-slate-600">No RCA written yet.{can('rca') && f.rca === 'pending' && <button type="button" onClick={() => onOpen('rca')} className="ml-2 font-bold text-blue-700 hover:underline">Open RCA →</button>}</div>}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {[['defect', f.defect], ['station', f.station], ['line', f.line], ['date', f.date], ...(f.model ? [['model', f.model]] : [])].map(([dim, v]) => (
                                <button key={dim} type="button" onClick={() => pick(dim)(v)} className="rounded-full bg-white px-2 py-0.5 text-fs-12 font-bold text-blue-800 ring-1 ring-blue-200 hover:bg-blue-50">Only {dim === 'station' ? stText(v) : dimText(dim, v)}</button>
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
