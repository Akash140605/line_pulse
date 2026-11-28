import React, { useEffect, useMemo, useState } from 'react';
import { useLastScans } from '../hooks/useLastScans';
import { ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend, LabelList, Cell } from 'recharts';
import AchKey from '../components/AchKey';
import { TARGET_GREY, ACH_GREEN, achColor } from '../utils/achieve';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { modelHours } from '../utils/factorDash';
import { oleRange, oleSum, lossSummary, qualityOf, hm, okFrom, watchFrom, oleConfig, modelPerf, planTargetOf, normEntry } from '../utils/ole';
import { openOleDrill, openOleFocus } from '../utils/drillLink';
import { LINE_COLOR, nf, dmy, p2, useOleLines, groupNameOf, useOleData, Gauge, band, plantOf, plantsText, companyOf, CompanyCell } from '../components/OleParts';
import { createPortal } from 'react-dom';
import { X, ChevronRight, Maximize2, Minimize2, CalendarDays, Factory, ListTree } from 'lucide-react';
import MesDrawer from '../components/MesDrawer';
import { Factor, factorsOf, KpiPanel, StageFpyHost } from '../components/OleApq';
import { DayDrawer } from './OleCalendarPage';
import { PeriodBar, periodKind } from '../components/PeriodBar';
import { useHeaderSlot } from './CleanDashboardPage';
import { useHeaderActionsSlot } from '../components/HeaderBar';

/*
 * Overall OLE — one period for the plant (or one line):
 *   navy band + OLE gauge with A · P · Q → line cards → OLE trend → per factor its tables:
 *   Availability: idle time reasons, line-wise loss · Performance: cycle time vs standard · Quality: rejection tables.
 *   "View All" opens a table in the side panel; a line card opens that line model by model and hour by hour.
 * The maths is utils/ole.js (oleRange); the admin's choices (colours, few pieces, time format) come from oleConfig().
 */
// the Dixon MES look (Production Management System, C8 overall dashboard): Office colours, 2–3 px corners, 13 px body
const card = 'rounded-[2px] border border-[#BFBFBF] bg-white shadow-[0_1px_3px_rgba(15,29,36,0.10)]';
const NAVY = 'text-[#1F3864]', HAIR = 'border-[#D4D4D4]', STRIP = 'bg-[#F3F3F3]/70';
// times are shown in the admin's format (Setup → OLE formulas: "6.3 h" or "6h 18m")
const hms = (min) => hm(Math.max(0, Number(min) || 0));
const hrs = hms;
const hr2 = (min) => hm(Math.abs(min || 0));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FACT = [['A', 'Availability'], ['P', 'Performance'], ['Q', 'Quality']];
const weakOf = (t) => FACT.filter(([k]) => t?.[k] != null).sort((a, b) => t[a[0]] - t[b[0]])[0] || null;
const cellTone = (v, k = null) => (v == null ? '' : v >= okFrom(k) ? 'bg-emerald-50 text-emerald-800' : v >= watchFrom(k) ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800');
const pc = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const pc1 = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);   // 90% / 48.4% (no trailing .0)
const tone = (v, k = null) => (v == null ? 'text-slate-500' : v >= okFrom(k) ? 'text-[#138A36]' : v >= watchFrom(k) ? 'text-[#9C5700]' : 'text-[#C00000]');
const lossTone = (v) => (v == null ? 'text-slate-500' : v <= 1 - okFrom() ? 'text-[#138A36]' : v <= 0.4 ? 'text-[#9C5700]' : 'text-[#C00000]');
// 19-11-2026: in words, not + / − — "Short 28" · "Excess 116" · "On target"
const signed = (v) => (v > 0 ? `+${nf(v)}` : v < 0 ? `−${nf(-v)}` : '0');   // 27-11-2026: + / − (colour shows excess / short)
/** 20-11-2026: the models a reason / defect was written on — the first `max` (with their own time or pieces when more than one), "+N" for the rest; all in the tooltip */
// 26-11-2026: EVERY model is named (no "+2"): one model inline; more models one under the other, each with its time / pieces
const modelsCell = (ms, unit = 'min', _max = 0, co = null) => {
  if (!ms?.length) return <span className="text-[#999]" title="No model was written with it">—</span>;
  const val = (m) => (unit === 'min' ? hr2(m.value) : `${nf(m.value)} pcs`);
  const cOf = (m) => (co ? co(m.name) : '');
  const name = (m) => <>{cOf(m) && <span className="mr-1 text-fs-11 font-bold uppercase text-[#777]">{cOf(m)}</span>}<span className="font-mono font-semibold">{m.name}</span></>;
  if (ms.length === 1) return <span className="whitespace-nowrap">{name(ms[0])}</span>;
  return (
    // side by side as long as they fit, then the next line — every model, each with its pieces / time (short tables)
    <span className="flex flex-wrap gap-x-4 gap-y-0.5 py-0.5">
      {ms.map((m) => <span key={m.name} className="whitespace-nowrap">{name(m)} <span className="text-fs-12 font-semibold text-[#C00000]">{val(m)}</span></span>)}
    </span>
  );
};
/** a rejection % chip: up to 2 % green, up to 5 % amber, above red */
const rejChip = (r) => (r == null ? 'bg-slate-100 text-slate-500' : r <= 0.02 ? 'bg-emerald-100 text-emerald-800' : r <= 0.05 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800');

/** the theme's text size (Setup → Theme), read once from the page */
/* (the line tiles used to shrink their text by 8 %; the MES sizes are set on the tiles themselves now) */

/* ───────────── pieces of the look ───────────── */

/** the navy title band over the KPI panel */
function Band({ title, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-dixon-navy py-1.5 pl-3.5 pr-2.5 text-white">
      <h2 className="lp-caps min-w-[min(100%,18rem)] flex-1 font-extrabold uppercase leading-tight tracking-[0.03em]" style={{ fontSize: 'calc(15px * 1.35 * var(--fs, 1))' }}>{title}</h2>
      {children}
    </div>
  );
}
const BandChip = ({ icon: Icon, children, label }) => (
  <span aria-label={label} className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[2px] border border-white/30 bg-white/[0.12] px-2 text-mes-body font-semibold text-white">{Icon && <Icon size={14} aria-hidden />}{children}</span>
);

/** a section title: navy bar on the left, upper case */
function SectionHead({ title, children, small = false }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b ${HAIR} bg-white py-1.5 pl-0 pr-2`}>
      <span aria-hidden className="h-6 w-[4px] shrink-0 rounded-r-[2px] bg-[#1F3864]" />
      <h3 className={`lp-caps font-bold uppercase tracking-[0.04em] ${NAVY} ${small ? 'text-mes-sub' : 'text-mes-title'}`}>{title}</h3>
      {children}
    </div>
  );
}

/** "Availability 48.4%" — the band that opens the tables of one factor */
function FactorBanner({ name, value, sub }) {
  const c = value == null ? '#94a3b8' : band(value, { Availability: 'A', Performance: 'P', Quality: 'Q' }[name]);
  return (
    <div id={`ov-${name.toLowerCase()}`} className="lp-anchor flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[3px] border border-l-4 border-[#BFBFBF] bg-white px-3 py-2 leading-tight shadow-[0_1px_2px_rgba(15,29,36,0.06)]" style={{ borderLeftColor: c }} role="heading" aria-level={3} aria-label={`${name} ${pc1(value)}`}>
      <span className={`truncate text-mes-title font-bold ${NAVY}`}>{name}</span>
      <span className="rounded-[3px] px-2 py-0.5 text-mes-title font-extrabold leading-none tabular-nums" style={{ background: `${c}2e`, color: c }}>{pc1(value)}</span>
      {sub && <span className="text-mes-label font-semibold text-[#555]">{sub}</span>}
    </div>
  );
}

/**
 * A table of the MES look: title + "Top 5", "View All ›" (the full list in a window), blue head row, # column.
 * cols = [{ k, label, right, render(row) }]
 */
function QTable({ title, top = 5, rows, cols, empty, label, onAll = null, onRow = null, tabs = null, tab = null, onTab = null }) {
  return (
    <section className={`${card} min-w-0 overflow-hidden`} aria-label={label || title}>
      <div className={`flex min-h-[40px] flex-wrap items-center gap-x-3 gap-y-1 border-b ${HAIR} bg-white px-3 py-1.5`}>
        <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-[1px] bg-[#2E75B6]" />
        <h4 className={`whitespace-nowrap text-mes-title font-bold leading-tight ${NAVY}`}>{title}</h4>
        {top && rows.length > 0 && <span className="text-mes-label text-[#777]">Top {Math.min(top, rows.length)}</span>}
        {tabs && (
          <div className="flex flex-wrap overflow-hidden rounded-[3px] border border-[#BFBFBF]" role="tablist" aria-label={`${title}: line`}>
            {tabs.map((x) => (
              <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} onClick={() => onTab && onTab(x.k)}
                className={`whitespace-nowrap border-r border-[#BFBFBF] px-2.5 py-0.5 text-mes-body font-semibold last:border-r-0 ${tab === x.k ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-[#EAF2FB]'}`}>
                {x.label}{x.sub ? <span className={`ml-1 font-mono text-fs-12 ${tab === x.k ? 'text-sky-100' : 'text-[#777]'}`} style={{ textTransform: 'none' }}>{x.sub}</span> : null}
              </button>))}
          </div>
        )}
        {onAll && rows.length > 0 && <button type="button" onClick={onAll} className="ml-auto whitespace-nowrap rounded-[2px] px-2 py-0.5 text-mes-body font-semibold text-[#2E75B6] hover:bg-[#EAF2FB]">View All ›</button>}
      </div>
      {!rows.length ? <p className="bg-white px-2 py-1 text-mes-body italic text-[#777]">{empty}</p> : <Grid rows={top ? rows.slice(0, top) : rows} cols={cols} label={`${title} table`} onRow={onRow} />}
    </section>
  );
}
/** 27-11-2026 Cycle Time vs Standard with filters (line, company, model, too few) and a sort on every column —
 *  Var. low → high first (the models running fastest against their std on top). Rows without a figure stay at the bottom. */
const PERF_SORT = { line: (r) => Number(r.line), std: (r) => r.std, act: (r) => (r.few ? null : r.act), var: (r) => (r.few ? null : r.var), target: (r) => (r.few ? null : r.target), qty: (r) => r.qty, ach: (r) => (r.few ? null : r.ach), lost: (r) => (r.few ? null : r.lostMin) };
function PerfList({ rows, cols, co, label, onRow, rowTitle }) {
  const [sort, setSort] = useState({ k: 'var', dir: 1 });
  const [f, setF] = useState({ line: '', company: '', q: '', few: true });
  const lines = useMemo(() => [...new Set(rows.map((r) => String(r.line)))].sort((a, b) => Number(a) - Number(b)), [rows]);
  const cos = useMemo(() => [...new Set(rows.map((r) => co(r.model) || '—'))].sort(), [rows, co]);
  const val = (r, k) => (PERF_SORT[k] ? PERF_SORT[k](r) : k === 'company' ? co(r.model) || '' : k === 'model' ? r.model : r[k]);
  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = rows.filter((r) => (!f.line || String(r.line) === f.line) && (!f.company || (co(r.model) || '—') === f.company) && (!q || String(r.model).toLowerCase().includes(q)) && (f.few || !r.few));
    return out.map((r, i) => [r, i]).sort((a, b) => {
      const x = val(a[0], sort.k), y = val(b[0], sort.k);
      if (x == null || y == null) return (x == null) - (y == null) || a[1] - b[1];
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return c * sort.dir || Number(a[0].line) - Number(b[0].line) || a[1] - b[1];
    }).map(([r]) => r);
  }, [rows, f, sort, co]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = 'h-8 rounded-[3px] border border-[#BFBFBF] bg-white px-2 text-mes-body text-[#1F3864] focus:border-[#2E75B6] focus:outline-none';
  const on = f.line || f.company || f.q || !f.few;
  return (
    <div data-testid="perf-list">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#BFBFBF] bg-[#F7F9FC] px-2 py-1.5 no-print">
        {lines.length > 1 && <select aria-label="Line" value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })} className={sel} data-testid="perf-f-line"><option value="">All lines</option>{lines.map((l) => <option key={l} value={l}>Line {l}</option>)}</select>}
        {cos.length > 1 && <select aria-label="Company" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} className={sel} data-testid="perf-f-co"><option value="">All companies</option>{cos.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
        <input type="search" aria-label="Search a model" placeholder="Search model" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} className={`${sel} w-40`} data-testid="perf-f-q" />
        <label className="inline-flex items-center gap-1.5 text-mes-body text-[#333]"><input type="checkbox" checked={!f.few} onChange={(e) => setF({ ...f, few: !e.target.checked })} data-testid="perf-f-few" />Hide too few pcs</label>
        <select aria-label="Sort by" value={`${sort.k}|${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split('|'); setSort({ k, dir: Number(d) }); }} className={sel} data-testid="perf-sort">
          {[['var|1', 'Var. low → high'], ['var|-1', 'Var. high → low'], ['lost|-1', 'Time lost most first'], ['ach|1', 'Achieved low → high'], ['ach|-1', 'Achieved high → low'], ['qty|-1', 'Actual Qty most first'], ['line|1', 'Line']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          {![ 'var|1', 'var|-1', 'lost|-1', 'ach|1', 'ach|-1', 'qty|-1', 'line|1'].includes(`${sort.k}|${sort.dir}`) && <option value={`${sort.k}|${sort.dir}`}>{(cols.find((c) => c.k === sort.k)?.label || sort.k)} {sort.dir > 0 ? '↑' : '↓'}</option>}
        </select>
        <span className="ml-auto text-mes-label text-[#555]">{list.length} of {rows.length} models</span>
        {on && <button type="button" onClick={() => setF({ line: '', company: '', q: '', few: true })} className="rounded-[2px] px-2 py-0.5 text-mes-body font-semibold text-[#2E75B6] hover:bg-[#EAF2FB]">Clear</button>}
      </div>
      {list.length ? <Grid rows={list} cols={cols} label={label} onRow={onRow} rowTitle={rowTitle} sort={sort} onSort={(k) => setSort((o) => ({ k, dir: o.k === k ? -o.dir : ['lost', 'qty', 'target'].includes(k) ? -1 : 1 }))} />
        : <p className="p-3 text-fs-14 text-slate-600">No model matches the filters.</p>}
    </div>
  );
}
function Grid({ rows, cols, label, total = null, onRow = null, rowTitle = 'Open the details', sort = null, onSort = null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-mes-body tabular-nums" aria-label={label}>
        <thead>
          <tr className={`bg-[#DDEBF7] text-left ${NAVY}`}>
            <th className="w-10 border border-[#BFBFBF] !px-1 py-[3px] text-center font-bold">#</th>
            {cols.map((c) => <th key={c.k} className={`whitespace-nowrap border border-[#BFBFBF] px-2 py-1 font-bold ${c.right ? 'text-right' : ''}`} style={c.right ? { width: '1%' } : undefined}
              aria-sort={sort && sort.k === c.k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
              {onSort ? <button type="button" onClick={() => onSort(c.k)} title={`Sort by ${c.label}`} data-testid={`sort-${c.k}`} className={`inline-flex items-center gap-1 font-bold hover:text-[#2E75B6] ${sort?.k === c.k ? 'text-[#2E75B6]' : ''}`}>
                {c.label}<span aria-hidden="true" className="text-fs-11">{sort?.k === c.k ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</span></button> : c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key ?? i} className={`${i % 2 ? 'bg-[#F7F9FC]' : 'bg-white'} hover:bg-[#DDEBF7]/60 ${onRow ? 'cursor-pointer' : ''}`}
              {...(onRow ? { tabIndex: 0, title: rowTitle, onClick: (e) => { if (!e.target.closest('button,a')) onRow(r); }, onKeyDown: (e) => { if (e.key === 'Enter') onRow(r); } } : {})}>
              <td className={`border ${HAIR} !px-1 py-1 text-center text-[#777]`}>{i + 1}</td>
              {cols.map((c) => <td key={c.k} className={`${c.wrap ? '' : 'whitespace-nowrap'} border ${HAIR} px-2 py-1 ${c.right ? 'text-right tabular-nums' : ''} ${c.cls || ''}`} style={c.wrap ? { overflowWrap: 'break-word', minWidth: 90 } : undefined}>{c.render ? c.render(r) : r[c.k]}</td>)}
            </tr>
          ))}
          {total && (
            <tr className="bg-[#F3F3F3] font-bold text-[#222]">
              <td className="border border-[#BFBFBF] px-1.5 py-[3px]" />
              {cols.map((c) => <td key={c.k} className={`whitespace-nowrap border border-[#BFBFBF] px-1.5 py-[3px] ${c.right ? 'text-right tabular-nums' : ''}`}>{total[c.k] ?? ''}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** the details panel from the right side (View all, a line's reasons for the loss): navy header, Esc / ✕ closes, ⤢ wider */
function Window({ title, sub, onClose, children, icon = ListTree, width = 75, minWidth = 560 }) {
  // 20-11-2026: only as big as its tables (at most `width` % of the screen; minWidth keeps an A · P · Q panel readable)
  return <MesDrawer title={title} sub={sub} icon={icon} onClose={onClose} label={title} backdropLabel="Close details" bodyClass="p-1.5 sm:p-2" width={width} fit minWidth={minWidth}><div className="rounded-[2px] border border-[#BFBFBF] bg-white">{children}</div></MesDrawer>;
}

/** a line as a card of the line-wise section: gauge + A · P · Q in short, OLE badge; a click opens its reasons for the loss */
function LineCard({ line, t, onOpen, onDetails, onFactor = null }) {
  const F = factorsOf(t);
  const c = t.ole == null ? '#94a3b8' : band(t.ole);
  return (
    <section className={`lp-lift relative flex min-w-0 flex-col overflow-hidden rounded-[3px] border ${HAIR} bg-white shadow-[0_1px_2px_rgba(15,29,36,0.07)]`} aria-label={`Line ${line} OLE`}>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[4px]" style={{ background: c }} />
      <div className={`flex min-h-[42px] flex-wrap items-center gap-x-2.5 gap-y-1 border-b ${HAIR} bg-[#F7F9FC] py-1.5 pl-4 pr-2`}>
        
        <button type="button" onClick={onOpen} className={`min-w-0 truncate text-mes-title font-bold leading-tight ${NAVY} hover:underline`} title="Performance · reasons for the loss">Line {line}</button>
        <span className={`shrink-0 rounded-[2px] border ${HAIR} bg-white px-1.5 font-mono text-[12px] font-semibold text-[#444]`}>{plantOf(line) ? `${plantOf(line)} · ` : ''}L-{p2(Number(line))}</span>
        <button type="button" onClick={onOpen} title="OLE — open the details" className="ml-auto shrink-0 rounded-[3px] px-2 py-0.5 text-mes-body font-extrabold leading-none tabular-nums hover:ring-1 hover:ring-current" style={{ background: `${c}26`, color: c }}>OLE {pc1(t.ole)}</button>
      </div>
      <div className="grid grid-cols-1 gap-px bg-[#D4D4D4] sm:grid-cols-[minmax(0,0.7fr)_repeat(3,minmax(0,1fr))]">
        <button type="button" onClick={onOpen} className="flex flex-col items-center justify-center gap-1 bg-white px-2 py-2 hover:bg-[#EAF2FB]/40" aria-label={`Line ${line} — performance by model`}>
          <span className="text-mes-label font-bold uppercase tracking-[0.12em] text-[#777]">OLE</span>
          <Gauge value={t.ole} size={146} label="" />
        </button>
        {F.map((f) => <Factor key={f.k} {...f} compact rows={f.rows} formula={null} onOpen={onFactor ? () => onFactor(f.k) : null} />)}
      </div>
    </section>
  );
}

/* ───────────── the figures of the tables ───────────── */

/** model by model (per line): pieces, std cycle, actual cycle (its share of the run time of its hours), target, time lost */
/** a line hour by hour over the period (each clock hour summed over the days): target, made, short, run, entered loss, lost vs std, A · P · OLE */
function hourPerf(R, line) {
  const m = new Map();
  for (const d of R?.days || []) for (const r of d.byLine[line]?.rows || []) {
    if (r.future || r.closed || !(r.qty > 0 || r.totalMin > 0)) continue;
    const o = m.get(r.hour) || []; o.push(r); m.set(r.hour, o);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([h, rs]) => {
    const t = oleSum(rs);
    const target = rs.reduce((a, r) => a + (r.planQty > 0 ? r.planQty : 0), 0);   // 25-11-2026: the hour plan of the HPR / SAWM KPI (extra hours: none)
    // 26-11-2026: the models made in the hour (all days of the period together), most pieces first
    const mm = new Map();
    for (const r of rs) for (const x of r.models || []) { const q = Number(x.quantity) || 0; if (q > 0) mm.set(x.model || '—', (mm.get(x.model || '—') || 0) + q); }
    const models = [...mm.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    return { key: h, hour: h, extra: rs.some((r) => r.extra), days: rs.length, t, target: target > 0 ? Math.round(target) : null, qty: t.qty, models };
  });
}
/** 26-11-2026: every entry behind a View All (not only the sum by reason): idle minutes ('min') or rework / rejection
 *  pieces ('qty') of the lines shown, day by day and hour by hour, with all that was written on the row */
function entriesOf(R, ids, unit, perfOnly = false) {
  const out = [];
  // (every row, as the tables above count them — an entry is shown wherever its hour stands)
  for (const d of R?.days || []) for (const l of ids) for (const r of d.byLine[l]?.rows || []) {
    const e = r.e || normEntry(r.entry);
    const list = unit === 'min' ? [...e.stops, ...e.losses.map((x) => ({ ...x, loss: true }))] : [...e.rejects.map((x) => ({ ...x, kind: 'Rejection' })), ...e.rework.map((x) => ({ ...x, kind: 'Rework' }))];
    list.forEach((x, i) => {
      if (perfOnly && !(x.loss && x.model && oleConfig().lossIn !== 'avail')) return;
      out.push({ key: `${d.date}|${l}|${r.hour}|${i}`, date: d.date, line: String(l), hour: r.hour, note: e.note || '', ...x, n: unit === 'min' ? x.min : x.qty });
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || Number(a.line) - Number(b.line) || a.hour - b.hour);
}
const secText = (s) => (s == null ? '—' : `${Math.round(s * 10) / 10}s`);
const varCell = (v) => (v == null ? '—' : <span className={v > 0.005 ? 'font-bold text-red-700' : 'text-emerald-700'}>{v > 0 ? '+' : v < 0 ? '−' : ''}{Math.abs(Math.round(v * 1000) / 10)}%</span>);
// 24-11-2026: under 3 min shows as 0.0 h without a sign (no "−0.0 h"); faster than std = time gained, green with a minus
// 24-11-2026: the std cycle of an hour = the Model master cycle of its models, weighted by THEIR pieces — a model without a
// cycle time is left out (it was counted as 0 s: 133 pieces with 88 of a no-std model showed 6.9 s instead of 20.6 s)
const stdCt = (t) => { const n = (t?.qty || 0) - (t?.noStdQty || 0); return n > 0 && t.stdSec > 0 ? t.stdSec / n : null; };
const lostCell = (m) => (m == null ? '—' : Math.abs(m) < 3 ? <span className="text-slate-500">{hr2(0)}</span>
  : <span className={m > 0 ? 'font-bold text-red-700' : 'text-emerald-700'} title={m < 0 ? 'Faster than the std cycle: time gained' : 'Slower than the std cycle: time lost'}>{m < 0 ? '−' : ''}{hr2(Math.abs(m))}</span>);
/** a model with too few pieces: its cycle is not judged */
const fewNote = (n) => <span className="whitespace-nowrap text-fs-13 font-semibold text-slate-500" title={`Only ${n} piece${n === 1 ? '' : 's'} in this period: too few for a real cycle time, so it is not compared with the std`}>{n} pc{n === 1 ? '' : 's'} · too few</span>;
const achChip = (a) => (a == null ? '—' : <span className={`rounded px-1.5 py-0.5 font-bold ${a >= okFrom() ? 'bg-emerald-100 text-emerald-800' : a >= watchFrom() ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{Math.round(a * 1000) / 10}%</span>);

/**
 * Details from the right (like the OLE calendar): the period of the plant or of one line — A · P · Q · OLE, the weakest
 * factor, where the time went, the top loss reasons and day by day; a day opens its hour-by-hour drill-down.
 */
function PeriodDrawer({ title, ids, R, reasons, onClose, onPickDay, onOpenLine = null, onLine = null, covered = false, co = null }) {
  const many = ids.length > 1;
  const [tab, setTab] = useState('days');
  const dayOf = (d, l) => d.byLine[l]?.total || oleSum([]);
  const days = (R?.days || []).map((d) => ({ date: d.date, t: many ? oleSum(ids.map((l) => d.byLine[l]?.total)) : dayOf(d, ids[0]) }));
  const T = oleSum(days.map((d) => d.t));
  const tgt = (t) => planTargetOf(t);
  const ranT = (t) => t.qty > 0 || t.totalMin > 0;
  // the lines one after another (Line 1's days, then Line 2's …), never mixed (19-11-2026)
  const perLine = ids.map((l) => ({ line: l, days: (R?.days || []).map((d) => ({ date: d.date, t: dayOf(d, l) })).filter((d) => ranT(d.t)), t: oleSum((R?.days || []).map((d) => d.byLine[l]?.total)) }));
  // loss reasons of the period with the minutes of each line
  const LSl = Object.fromEntries(ids.map((l) => [l, lossSummary((R?.days || []).flatMap((d) => d.byLine[l]?.rows || []), reasons).reason.filter((x) => x.unit === 'min' && x.value > 0)]));
  const lossRows = [];
  for (const l of ids) for (const x of LSl[l]) {
    const k = `${x.kind}|${x.name}`; let o = lossRows.find((y) => y.k === k);
    if (!o) { o = { k, name: x.name, dept: x.dept, by: {}, total: 0, mm: new Map() }; lossRows.push(o); }
    o.by[l] = (o.by[l] || 0) + x.value; o.total += x.value;
    for (const m of x.models || []) o.mm.set(m.name, (o.mm.get(m.name) || 0) + m.value);   // 20-11-2026: the models of the reason
  }
  for (const o of lossRows) o.models = [...o.mm.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  lossRows.sort((x, y) => y.total - x.total);
  const lossTotal = lossRows.reduce((a, x) => a + x.total, 0);
  const wd = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
  const th = 'px-2 py-1.5 font-semibold whitespace-nowrap';
  const tabs = [['days', 'Day By Day'], ...(many ? [['lines', 'Line-Wise']] : []), ['loss', 'Loss Reasons']];
  const head = <tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Date', 'Target', 'Actual', 'Achieved', 'A', 'P', 'Q', 'OLE', 'Lost Time'].map((h, i) => <th key={h} className={`${th} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr>;
  const row = (d, line = null) => { const tg = tgt(d.t); return (
    <tr key={`${line || ''}${d.date}`} onClick={() => onPickDay(d.date, line)} className="cursor-pointer border-b border-slate-100 hover:bg-blue-50" aria-label={`Day ${dmy(d.date)}${line ? ` Line ${line}` : ''}`}>
      <td className="px-2 py-1.5 whitespace-nowrap"><b>{dmy(d.date)}</b> <span className="text-fs-12 text-slate-500">{wd(d.date)}</span> ›</td>
      <td className="px-2 text-right font-mono text-slate-700">{tg == null ? '—' : nf(tg)}</td>
      <td className="px-2 text-right font-mono font-bold">{nf(d.t.qty)}</td>
      <td className="px-2 text-right">{tg ? achChip(d.t.qty / tg) : '—'}</td>
      {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-2 text-right font-mono font-bold ${cellTone(d.t[k], k === 'ole' ? null : k)}`}>{pc(d.t[k])}</td>)}
      <td className="px-2 text-right font-mono whitespace-nowrap">{hrs((d.t.lossMin || 0) + (d.t.speedMin || 0))}</td>
    </tr>
  ); };
  return (
    <MesDrawer title={title} sub={tabs.find(([k]) => k === tab)[1]} icon={CalendarDays} onClose={onClose} label={`${title} details`} backdropLabel="Close details" width={80} fit="width" minWidth={980}
      footer={onOpenLine ? <button type="button" onClick={onOpenLine} className="rounded-[2px] bg-[#2E75B6] px-3 py-1 text-mes-body font-semibold text-white hover:bg-[#1F4E79]">Open line view ›</button> : null}>
        <div className="p-3">
          <div className="flex flex-col gap-3">
              {/* A · P · Q always (19-11-2026): 0 where nothing ran */}
              <div className="overflow-hidden rounded-[2px] border border-[#BFBFBF]" aria-label="A P Q of the period"><KpiPanel t={T} zero gauge={150} /></div>
              <div role="tablist" aria-label="Details" className="flex w-fit overflow-hidden rounded-md border border-slate-300">
                {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-9 border-r border-slate-300 px-4 text-fs-14 font-bold last:border-r-0 ${tab === k ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-slate-50'}`}>{l}</button>)}
              </div>
              {tab === 'days' && (!days.some((d) => ranT(d.t)) ? <p className="text-fs-14 text-slate-600">No production in this period.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-fs-14 tabular-nums" aria-label="Day by day">
                    <thead>{head}</thead>
                    <tbody>
                      {many ? perLine.filter((x) => x.days.length).map((x) => (
                        <React.Fragment key={x.line}>
                          <tr className="bg-[#EAF0F7]"><td colSpan={9} className="px-2 py-1.5 font-extrabold text-[#1F3864]">Line {x.line}{plantOf(x.line) ? ` · ${plantOf(x.line)}` : ''} <span className="ml-2 font-mono text-fs-13 font-bold text-slate-600">OLE {pc(x.t.ole)}</span></td></tr>
                          {x.days.map((d) => row(d, x.line))}
                        </React.Fragment>
                      )) : days.filter((d) => ranT(d.t)).map((d) => row(d))}
                    </tbody>
                  </table>
                </div>
              ))}
              {tab === 'lines' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-fs-14 tabular-nums" aria-label="Line-wise">
                    <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Line', 'Target', 'Actual', '+ / − vs plan', 'Achieved', 'A', 'P', 'Q', 'OLE', 'Lost Time'].map((h, i) => <th key={h} className={`${th} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {perLine.map((x) => { const tg = tgt(x.t); return (
                        <tr key={x.line} onClick={onLine ? () => onLine(x.line) : undefined} className={`border-b border-slate-100 ${onLine ? 'cursor-pointer hover:bg-blue-50' : ''}`} aria-label={`Line ${x.line} details`}>
                          <td className="px-2 py-1.5 font-bold whitespace-nowrap">Line {x.line}{onLine ? ' ›' : ''}</td>
                          <td className="px-2 text-right font-mono">{tg == null ? '—' : nf(tg)}</td>
                          <td className="px-2 text-right font-mono font-bold">{nf(x.t.qty)}</td>
                          <td className={`px-2 text-right font-bold whitespace-nowrap ${tg != null && x.t.qty < tg ? 'text-red-700' : 'text-emerald-700'}`}>{tg == null ? '—' : signed(x.t.qty - tg)}</td>
                          <td className="px-2 text-right">{tg ? achChip(x.t.qty / tg) : '—'}</td>
                          {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-2 text-right font-mono font-bold ${cellTone(x.t[k], k === 'ole' ? null : k)}`}>{pc(x.t[k])}</td>)}
                          <td className="px-2 text-right font-mono whitespace-nowrap">{hrs((x.t.lossMin || 0) + (x.t.speedMin || 0))}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                  {onLine && <p className="mt-1.5 text-fs-13 text-slate-500">A line opens its models and hours — an hour shows its losses.</p>}
                </div>
              )}
              {tab === 'loss' && (!lossRows.length ? <p className="text-fs-14 text-slate-600">No loss entered for this period.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-fs-14 tabular-nums" aria-label="Loss reasons">
                    <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['#', 'Reason', 'Model', 'Department', ...(many ? ids.map((l) => `Line ${l}`) : []), 'Time', 'Share'].map((h, i) => <th key={h} className={`${th} ${i > 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {lossRows.map((x, i) => (
                        <tr key={x.k} className="border-b border-slate-100">
                          <td className="px-2 py-1.5 font-mono text-slate-500">{i + 1}</td>
                          <td className="whitespace-nowrap px-2 font-bold lp-caps">{x.name}</td>
                          <td className="px-2 text-fs-13">{modelsCell(x.models, 'min', 2, co)}</td>
                          <td className="whitespace-nowrap px-2 text-slate-600">{x.dept || '—'}</td>
                          {many && ids.map((l) => <td key={l} className="whitespace-nowrap px-2 text-right font-mono">{x.by[l] ? hms(x.by[l]) : <span className="text-slate-300">—</span>}</td>)}
                          <td className="whitespace-nowrap px-2 text-right font-mono font-bold text-red-700">{hms(x.total)}</td>
                          <td className="whitespace-nowrap px-2 text-right font-mono">{lossTotal ? `${Math.round((x.total / lossTotal) * 1000) / 10}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        </div>
    </MesDrawer>
  );
}

/** The trend (per day / week / month): tabs OLE · Availability · Performance · Quality (%, with the benchmark) and
 *  Target vs Actual (pcs); days still to come stay empty on the axis. */
/* 20-11-2026: the value written on each bar / point of the trend. Many bars (a month day by day): the number stands
 * upright inside the bar (left out when the bar is too short for it); few bars: above the bar. */
const barLabel = (dense, inside) => function BarLbl({ x, y, width, height, value }) {
  if (value == null || !(value > 0) || width == null) return null;
  const t = nf(value);
  if (!dense) return <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1F3864">{t}</text>;
  if (height < t.length * 6.6 + 12 || width < 9) return null;
  const cx = x + width / 2; const cy = y + 5;
  return <text x={cx} y={cy} transform={`rotate(-90 ${cx} ${cy})`} textAnchor="end" dominantBaseline="central" fontSize={11} fontWeight={700} fill={inside}>{t}</text>;
};
const pointLabel = (m, good) => function PtLbl({ x, y, value, index }) {
  if (value == null || x == null || y == null) return null;
  return <text key={index} x={x} y={y - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill={value >= good ? '#047857' : '#B91C1C'}>{`${Math.round(value)}%`}</text>;
};

function Trend({ data, small = false, title, label, gid }) {
  const [m, setM] = useState('ole');
  const K = m === 'ole' ? null : m;
  const good = Math.round(okFrom(K) * 100);
  const tva = m === 'tva';
  const has = data.some((x) => (tva ? x.actual != null : x[m] != null));
  const best = !tva ? data.reduce((b, x) => (x[m] != null && (b == null || x[m] > b[m]) ? x : b), null) : null;
  const TABS = [['ole', 'OLE'], ['A', 'Availability'], ['P', 'Performance'], ['Q', 'Quality'], ['tva', 'Target vs Actual']];
  return (
    <section className={`${card} px-4 ${small ? 'py-2' : 'py-3'}`} aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`lp-caps border-l-4 border-dixon-navy pl-2 font-extrabold tracking-wide text-dixon-navy ${small ? 'text-fs-16' : 'text-fs-20'}`}>{title}</h3>
        <div role="tablist" aria-label="Trend of" className="flex overflow-hidden rounded-md border border-slate-300">
          {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={m === k} onClick={() => setM(k)} className={`h-8 border-r border-slate-300 px-3 text-fs-13 font-bold last:border-r-0 ${m === k ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 text-fs-13 font-semibold text-slate-600">
          {tva ? <AchKey />
            : <><span><i className="mr-1 inline-block h-0.5 w-4 align-middle bg-red-600" />{good}% benchmark</span>
              {best && <span className="rounded bg-dixon-navy px-2 py-0.5 text-white">Best {best[m]}% · {best.k}</span>}</>}
        </div>
      </div>
      {!has ? <p className={`${small ? 'py-3' : 'py-6'} text-center text-fs-14 text-slate-500`}>No production in this period.</p> : (
        <div className={`mt-2 ${small ? 'h-[170px]' : 'h-[260px]'}`} role="img" aria-label={`${TABS.find(([k]) => k === m)[1]} per period`}>
          <ResponsiveContainer width="100%" height="100%">
            {tva ? (
              <ComposedChart data={data} margin={{ top: data.length > 12 ? 10 : 20, right: 16, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="k" tick={{ fontSize: 13, fill: '#334155' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 13, fill: '#334155' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(v, n) => [nf(v), n === 'target' ? 'Target' : 'Actual']} />
                <Bar dataKey="target" fill={TARGET_GREY} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="target" content={barLabel(data.length > 12, '#1F2937')} />
                </Bar>
                <Bar dataKey="actual" fill={ACH_GREEN} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {data.map((x, i) => <Cell key={i} fill={achColor(x.actual, x.target, '#1F3864')} />)}
                  <LabelList dataKey="actual" content={barLabel(data.length > 12, '#FFFFFF')} />
                </Bar>
              </ComposedChart>
            ) : (
              <ComposedChart data={data} margin={{ top: small ? 10 : 22, right: 16, left: 0, bottom: 0 }}>
                <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2E75B6" stopOpacity={0.35} /><stop offset="100%" stopColor="#2E75B6" stopOpacity={0.04} /></linearGradient></defs>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="k" tick={{ fontSize: 13, fill: '#334155' }} tickLine={false} />
                <YAxis domain={[0, (mx) => Math.max(100, Math.ceil(mx / 25) * 25)]} allowDecimals={false} tick={{ fontSize: 13, fill: '#334155' }} tickLine={false} axisLine={false} width={40} />
                <Tooltip formatter={(v) => [`${v}%`, TABS.find(([k]) => k === m)[1]]} labelFormatter={(l) => (/^\d+$/.test(String(l)) ? `Day ${l}` : l)} />
                <ReferenceLine y={good} stroke="#C00000" strokeDasharray="6 4" />
                <Area type="monotone" dataKey={m} stroke="#2E75B6" strokeWidth={2.5} fill={`url(#${gid})`} connectNulls={false} isAnimationActive={false}
                  dot={(p) => (p.payload?.[m] == null || p.cy == null ? <g key={p.index} /> : <circle key={p.index} cx={p.cx} cy={p.cy} r={small ? 3.5 : 4.5} fill="#fff" stroke={p.payload[m] >= good ? '#059669' : '#DC2626'} strokeWidth={2.5} />)} />
                <Line dataKey={m} stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none">
                  {!small && <LabelList dataKey={m} content={pointLabel(m, good)} />}
                </Line>
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/** while the period is read, the page shows its own shape (band, gauge + factors, line cards, tables) shimmering. */
function OverviewSkeleton({ label, sub, lines = 4 }) {
  const bar = (w, h = 'h-3') => <span className={`lp-skel block ${h} rounded`} style={{ width: w }} />;
  return (
    <div role="status" aria-live="polite" aria-label={label} className="flex flex-col gap-3">
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 bg-dixon-navy px-4 py-3">
          <span className="lp-skel lp-skel-dark block h-5 w-72 max-w-full rounded" />
          <span className="ml-auto text-fs-13 font-semibold text-white/85"><span className="lp-dots">{label}</span></span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-[180px_1fr]">
          <div className="lp-skel mx-auto h-[150px] w-[150px] rounded-full" />
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">{bar('45%')}{bar('70%', 'h-7')}{bar('90%')}{bar('60%')}</div>)}
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-fs-13 font-semibold text-slate-600">{sub}</div>
      </section>
      <div className={`grid gap-3 ${lines > 1 ? 'sm:grid-cols-2 xl:grid-cols-4' : ''}`}>
        {Array.from({ length: Math.max(1, Math.min(lines, 4)) }, (_, i) => (
          <div key={i} className={`${card} flex flex-col gap-2 p-3`}>{bar('40%', 'h-4')}{bar('100%', 'h-16')}{bar('80%')}</div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className={`${card} flex flex-col gap-2 p-3`}>{bar('35%', 'h-4')}{[0, 1, 2, 3, 4].map((k) => <span key={k} className="lp-skel block h-6 rounded" />)}</div>)}
      </div>
    </div>
  );
}

/** 26-11-2026: a share as a small bar with its % (reads at a glance down the column) */
const shareCell = (f) => { const v = Math.max(0, Math.min(1, Number(f) || 0)); return (
  <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap"><span className="inline-block overflow-hidden rounded-sm bg-[#EEF2F7]" style={{ width: 54, height: 7 }}><span className="block h-full rounded-sm bg-[#2E75B6]" style={{ width: `${Math.max(3, v * 100)}%` }} /></span><span className="inline-block text-right" style={{ minWidth: 44 }}>{Math.round(v * 1000) / 10}%</span></span>); };
// 26-11-2026: a reason written in CAPITALS reads as Title Case ("MOTOR SHORTAGE" → "Motor Shortage"); short codes stay ("IR Fail", "EPS Shortage")
const KEEP = new Set(['EPS', 'XML', 'PCB', 'SAP', 'FQC', 'LQC', 'OQC', 'IPQC', 'HV', 'IR', 'QA', 'QC', 'NG', 'OK', 'PU', 'ESD', 'BOM', 'WIP', 'MES', 'IT']);
const cap1 = (t) => t.replace(/^\s*[a-z]/, (c) => c.toUpperCase()).replace(/\s+\//g, ' / ').replace(/\/(?=\S)/g, '/ ').replace(/\/ /g, ' / ').replace(/\s{2,}/g, ' ');
const nice = (t) => cap1(String(t || '').replace(/[A-Za-z][A-Za-z']*/g, (w) => (KEEP.has(w.toUpperCase()) || (w.length <= 2 && w === w.toUpperCase()) ? w.toUpperCase() : w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)));

/**
 * 28-11-2026: Formulas — how every number of this page is worked out, with this period's own figures put in.
 * Cycle time comes only from the Model master (Method D); the other methods are for analysis and change nothing here.
 */
function FormulaTab({ t, lines, settings }) {
  const C = oleConfig();
  const good = Math.max(0, (t.qty || 0) - (t.rejects || 0) - (C.qMode === 'rejRework' ? (t.rework || 0) : 0));
  const plan = planTargetOf(t);
  const passed = Math.max(0, (t.rework || 0) - (t.dismantle || 0));
  const notD = (lines || []).filter((l) => Object.values(settings?.[l]?.targets || {}).some((x) => x?.method && x.method !== 'D'));
  const rows = [
    ['Cycle time', 'Target cycle (s)', 'Model master cycle time of the model (+ the line allowance, now 0 s). The only source of the cycle time.', notD.length ? `Line ${notD.join(', ')}: not on Model master — change it in Line target method` : 'All lines: Model master'],
    ['Cycle time', 'Model not in the Model master', "Its pieces take the line's average cycle of that day (so the plan has no gap).", ''],
    ['Availability', 'Planned time', 'Shift time − lunch − tea breaks; a finished day ends at its last scan (today: at the last scan so far).', hrs(t.plannedMin)],
    ['Availability', 'Idle time', 'Minutes written in Loss entry without a model (the line stood). A loss written against a model is slow running → Performance.', hrs(t.lossMin)],
    ['Availability', 'Run time', 'Planned time − Idle time', `${hrs(t.plannedMin)} − ${hrs(t.lossMin)} = ${hrs(t.actualMin)}`],
    ['Availability', 'Availability %', 'Run time ÷ Planned time', `${hrs(t.actualMin)} ÷ ${hrs(t.plannedMin)} = ${pc(t.A)}`],
    ['Performance', 'Hour plan', 'Working minutes of the hour (lunch / tea out) × 60 ÷ target cycle of the models made in that hour (by their pieces). An hour that made nothing has no plan.', ''],
    ['Performance', 'Plan Target Qty', C.pMode === 'run' ? 'Σ hour plans × Run time ÷ Planned time (idle minutes out — a stopped line is Availability loss only)' : 'Σ hour plans (the shift plan as it is)', plan != null ? nf(plan) : '—'],
    ['Performance', 'Actual Qty', 'Pieces scanned at the end of the line (all hours, overtime too)', nf(t.qty)],
    ['Performance', '+ / − vs plan', 'Actual Qty − Plan Target Qty', plan != null ? `${nf(t.qty)} − ${nf(plan)} = ${t.qty - plan >= 0 ? '+' : ''}${nf(t.qty - plan)}` : '—'],
    ['Performance', 'Performance %', `Actual Qty ÷ Plan Target Qty${C.pCap ? ' (shown at most 100 %)' : ''}`, plan ? `${nf(t.qty)} ÷ ${nf(plan)} = ${pc(t.qty / plan)}${C.pCap && t.qty > plan ? ' → 100.0%' : ''}` : '—'],
    ['Performance', 'Speed loss', 'Run time − std time of the pieces (pieces × Model master cycle)', t.speedMin != null ? hrs(t.speedMin) : '—'],
    ['Quality', 'Rework [Passed + Dism.]', 'Rework written in Quality entry; Passed = Rework − Dismantled', `${nf(t.rework || 0)} [${nf(passed)} + ${nf(t.dismantle || 0)}]`],
    ['Quality', 'Good Qty', C.qMode === 'rejRework' ? 'Actual Qty − Rework − Rejected' : 'Actual Qty − Rejected', `${nf(t.qty)} − ${nf(t.qty - good)} = ${nf(good)}`],
    ['Quality', 'Quality %', 'Good Qty ÷ Actual Qty', t.qty ? `${nf(good)} ÷ ${nf(t.qty)} = ${pc(t.Q)}` : '—'],
    ['Quality', 'Stage FPY', '1 − defects found at the stage ÷ Actual Qty (HVIR, Leakage, Functional, Front Insp., Pre-Final, Final Insp.)', ''],
    ['Quality', 'RTY %', 'Stage FPY × … × Stage FPY (all 6 stages); target 97 %', pc(t.rty, 2)],
    ['OLE', 'OLE %', 'Availability × Performance × Quality', `${pc(t.A)} × ${pc(t.P)} × ${pc(t.Q)} = ${pc(t.ole)}`],
  ];
  const tone = { 'Cycle time': '#7C3AED', Availability: '#2563EB', Performance: '#D97706', Quality: '#059669', OLE: '#1F3864' };
  return (
    <section id="ov-formulas" className="lp-anchor rounded-[3px] border border-[#BFBFBF] bg-white" style={{ boxShadow: "0 1px 2px rgba(15,23,42,.06)" }} aria-label="Formulas" data-testid="ov-formulas">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-200 px-3 py-2">
        <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Formulas — how each number is worked out</h3>
        <span className="text-fs-12 text-slate-500">with this period&apos;s own figures · cycle time only from the Model master</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-fs-13">
          <thead><tr className="bg-[#e3ecf8] text-left text-fs-12 text-dixon-navy">{['', 'Number', 'How it is worked out', 'This period'].map((h) => <th key={h} className="whitespace-nowrap border-b border-slate-300 px-3 py-1.5 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(([g, name, how, val], i) => (
              <tr key={name} className="border-b border-slate-100 align-top" data-testid="formula-row">
                <td className="whitespace-nowrap px-3 py-1.5">{(i === 0 || rows[i - 1][0] !== g) && <span className="rounded-full px-2 py-0.5 text-fs-11 font-extrabold uppercase tracking-wide text-white" style={{ background: tone[g] }}>{g}</span>}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-bold text-slate-900">{name}</td>
                <td className="px-3 py-1.5 text-slate-700">{how}</td>
                <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono font-bold ${String(val).startsWith('Line ') ? 'text-red-700' : 'text-slate-900'}`}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-fs-12 text-slate-500">Methods A, B and C (most common cycle, % of pieces, average cycle) on the Target pages are for analysis only — they are not used in these numbers while the lines are on Model master.</p>
    </section>
  );
}

export default function OleOverviewPage({ onOpen = null, canOpen = [] }) {
  const ALL = useOleLines();
  const today = serverToday();
  const [only, setOnly] = useState('all');
  const slot = useHeaderSlot();
  const aslot = useHeaderActionsSlot();
  const IDS = useMemo(() => (only !== 'all' && ALL.includes(only) ? [only] : ALL), [only, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range0, setRange] = useState({ start: today, end: today });   // opens on today
  // year view: every month of the chosen year (month by month), a month opens as the period
  const [mode, setMode] = useState('period');
  const [grain, setGrain] = useState('day');   // Trend: Day · Week · Month (the MES filter bar)
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const yearRange = { start: `${year}-01-01`, end: `${year}-12-31` > today ? today : `${year}-12-31` };
  const range = mode === 'year' ? yearRange : range0;
  const oneDay = mode !== 'year' && range.start === range.end;
  const [det, setDet] = useState(null);       // details drawer: { title, ids, line }
  const [pickDay, setPickDay] = useState(null); // a day of the drawer: hour-by-hour drill-down
  const [pickLine, setPickLine] = useState(null); // …of one line (the drawer's day-by-day is line by line)
  const [idleLine, setIdleLine] = useState('all');   // 26-11-2026: Idle Time Reasons of all lines or one line (tabs above the table)
  const [win, setWin] = useState(null);       // a window: { kind, line }
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS, pollEntries: mode !== 'year' });
  const R0 = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }) : null),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, IDS]);
  // 25-11-2026: the finished days end at the line's last scan, as in the HPR / SAWM KPI (same Plan Target Qty)
  const lastScans = useLastScans({ R: R0, ids: IDS, today });
  const R = useMemo(() => (R0 && Object.keys(lastScans).length ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS, lastScans }) : R0), [R0, lastScans]); // eslint-disable-line react-hooks/exhaustive-deps
  // 26-11-2026: the trend is always the month of the chosen date, day by day (a Day / Week / Range view still shows it);
  // the rest of the page follows the chosen period
  const mEnd0 = (() => { const [yy, mm] = range.end.split('-').map(Number); return `${range.end.slice(0, 8)}${p2(new Date(yy, mm, 0).getDate())}`; })();
  const monthR = { start: `${range.end.slice(0, 8)}01`, end: mEnd0 > today ? today : mEnd0 };
  const sameMonth = mode === 'year' || (range.start === monthR.start && range.end === monthR.end);
  const DM = useOleData({ start: monthR.start, end: monthR.end, ids: IDS, prod: !sameMonth, paused: true });   // read once (Refresh reads it again), not every 20 s
  const RM0 = useMemo(() => (!sameMonth && DM.al ? oleRange({ lines: DM.al.lines, settings, entries: DM.ent.entries, days: DM.ent.days, setups: DM.ent.setup, start: monthR.start, end: monthR.end, today, nowMin: DM.endMin, ids: IDS }) : null),
    [sameMonth, DM.al, settings, DM.ent.entries, monthR.start, monthR.end, today, DM.endMin, IDS]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastScansM = useLastScans({ R: RM0, ids: IDS, today });
  const RM = useMemo(() => (RM0 && Object.keys(lastScansM).length ? oleRange({ lines: DM.al.lines, settings, entries: DM.ent.entries, days: DM.ent.days, setups: DM.ent.setup, start: monthR.start, end: monthR.end, today, nowMin: DM.endMin, ids: IDS, lastScans: lastScansM }) : RM0), [RM0, lastScansM]); // eslint-disable-line react-hooks/exhaustive-deps
  // month by month (year view)
  const months = useMemo(() => {
    if (mode !== 'year' || !R) return [];
    return MONTHS.map((n, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
      const ds = R.days.filter((d) => d.date.startsWith(ym));
      return { ym, n, t: oleSum(ds.map((d) => d.total)), days: ds.filter((d) => d.total.qty > 0).length, future: `${ym}-01` > today };
    });
  }, [mode, R, year, today]);
  const T = R?.total || oleSum([]);
  const group = groupNameOf(IDS);
  const kind = periodKind(range, today);
  const periodText = mode === 'year' ? `Year ${year}` : `${{ today: 'Today', yesterday: 'Yesterday', day: 'Day', week: 'Week', month: 'Month', range: 'Range' }[kind]} · ${oneDay ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`}`;
  const bandPeriod = mode === 'year' ? `Year ${year}` : kind === 'month' || (range.start.slice(8) === '01' && range.start.slice(0, 7) === range.end.slice(0, 7))
    ? `${MONTH_FULL[Number(range.start.slice(5, 7)) - 1]} ${range.start.slice(0, 4)}` : oneDay ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  const rowsOfLines = (ids) => (R?.days || []).flatMap((d) => ids.flatMap((l) => (d.byLine[l]?.rows || []).map((r) => (r.line != null && r.date ? r : { ...r, line: String(l), date: d.date }))));   // line + day: Stage-wise FPY details
  const rows = useMemo(() => rowsOfLines(IDS), [R, IDS]); // eslint-disable-line react-hooks/exhaustive-deps
  const LS = useMemo(() => lossSummary(rows, D.ent.reasons.station), [rows, D.ent.reasons]);
  const co = useMemo(() => companyOf(D.al), [D.al]);   // 20-11-2026: the company of every model
  const lineT = useMemo(() => Object.fromEntries(IDS.map((l) => [l, oleSum((R?.days || []).map((d) => d.byLine[l]?.total))])), [R, IDS]);
  // ── the tables
  // (18-11-2026) loss written against a model is performance loss: it is listed under Performance, idle time under Availability
  const isPerf = (x) => x.kind === 'Performance loss';
  const minRows = (pick) => { const L = LS.reason.filter((x) => x.unit === 'min' && x.value > 0 && pick(x)); const tot = L.reduce((a, x) => a + x.value, 0); return L.map((x) => ({ key: `${x.kind}|${x.name}`, ...x, share: tot ? x.value / tot : 0 })); };
  const downRows = minRows((x) => !isPerf(x));
  const idleL = idleLine !== 'all' && IDS.map(String).includes(String(idleLine)) ? String(idleLine) : 'all';
  const idleRows = useMemo(() => {
    if (idleL === 'all') return downRows;
    const S = lossSummary(rowsOfLines([idleL]), D.ent.reasons.station);
    const L = S.reason.filter((x) => x.unit === 'min' && x.value > 0 && x.kind !== 'Performance loss'); const tot = L.reduce((a, x) => a + x.value, 0);
    return L.map((x) => ({ key: `${x.kind}|${x.name}`, ...x, share: tot ? x.value / tot : 0 }));
  }, [idleL, R, D.ent.reasons, LS]); // eslint-disable-line react-hooks/exhaustive-deps
  const perfRows = minRows(isPerf);
  const modelInP = oleConfig().lossIn !== 'avail';   // admin choice (Setup → OLE formulas); standard: model loss is idle time
  const lineLoss = useMemo(() => IDS.map((l) => {
    const S = lossSummary(rowsOfLines([l]), D.ent.reasons.station);
    const rs = S.reason.filter((x) => x.unit === 'min' && x.value > 0 && x.kind !== 'Performance loss');
    const min = rs.reduce((a, x) => a + x.value, 0);
    return { key: l, line: l, min, reasons: rs };
  }).filter((x) => x.min > 0).sort((a, b) => b.min - a.min), [R, IDS, D.ent.reasons]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineLossTotal = lineLoss.reduce((a, x) => a + x.min, 0);
  const perf = useMemo(() => modelPerf(R, IDS), [R, IDS]);
  const Q = useMemo(() => qualityOf(rows, D.ent.reasons.station || []), [rows, D.ent.reasons]);
  // 26-11-2026: FPY / RTY on the Quality card of the plant and of every line (in place of Good Qty)
  const TQ = useMemo(() => ({ ...T, fpy: Q.fpy, rty: Q.rty, rtyN: Q.rtyCount, fpyBad: Q.rej + Q.rwk, stages: Q.stations, title: group }), [T, Q]);
  const lineTQ = useMemo(() => Object.fromEntries(IDS.map((l) => { const q = qualityOf(rowsOfLines([l]), D.ent.reasons.station || []); return [l, { ...lineT[l], fpy: q.fpy, rty: q.rty, rtyN: q.rtyCount, fpyBad: q.rej + q.rwk, stages: q.stations, title: `Line ${l}` }]; })), [lineT, R, IDS, D.ent.reasons]); // eslint-disable-line react-hooks/exhaustive-deps
  // 23-11-2026: no separate rejection — a defect is reworked or dismantled: the tables count rework (+ any old rejection)
  const QD = Q.rej + Q.rwk;
  // 26-11-2026: the pieces dismantled for each defect (written on its rework rows)
  const disOf = new Map(), disModel = new Map(), disLine = new Map();   // 27-11-2026: also by model and by line
  const causeOf = new Map(), actionOf = new Map();   // 27-11-2026: cause / action written on the rework, per defect
  const tally = (m, k, t) => { t = String(t || '').trim(); if (!t) return; const o = m.get(k) || new Map(); o.set(t, (o.get(t) || 0) + 1); m.set(k, o); };
  const topTexts = (m, k) => [...(m.get(k) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  for (const r of rows) { const e = r.e || normEntry(r.entry); for (const x of [...e.rejects, ...e.rework]) { tally(causeOf, x.reason || 'Not given', x.cause); tally(actionOf, x.reason || 'Not given', x.action); }
    for (const x of [...e.rejects, ...e.rework]) if (Number(x.dismantle) > 0) { const n = Number(x.dismantle); disOf.set(x.reason || 'Not given', (disOf.get(x.reason || 'Not given') || 0) + n); if (x.model) disModel.set(x.model, (disModel.get(x.model) || 0) + n); if (r.line != null) disLine.set(String(r.line), (disLine.get(String(r.line)) || 0) + n); } }
  const defects = Q.defects.filter((x) => x.rej + x.rwk > 0).map((x) => ({ key: x.name, name: x.name, rej: x.rej + x.rwk, dis: disOf.get(x.name) || 0, share: QD ? (x.rej + x.rwk) / QD : 0, causes: topTexts(causeOf, x.name), actions: topTexts(actionOf, x.name),
    models: (x.models || []).filter((m) => m.value > 0).map((m) => ({ name: m.name, value: m.value })).sort((a, b) => b.value - a.value) }));
  const lineRej = IDS.map((l) => ({ key: l, line: l, rej: (lineT[l]?.rejects || 0) + (lineT[l]?.rework || 0), qty: lineT[l]?.qty || 0, dis: disLine.get(String(l)) || 0 })).filter((x) => x.rej > 0).map((x) => ({ ...x, r: x.qty ? x.rej / x.qty : null })).sort((a, b) => b.rej - a.rej);
  const modelRej = Q.models.filter((m) => m.rej + m.rwk > 0).map((m) => ({ key: m.name, ...m, rej: m.rej + m.rwk, dis: disModel.get(m.name) || 0, r: m.qty ? (m.rej + m.rwk) / m.qty : null })).sort((a, b) => b.rej - a.rej);
  const allView = only === 'all' && IDS.length > 1;
  const onTarget = IDS.filter((l) => lineT[l]?.ole != null && lineT[l].ole >= okFrom()).length;
  const below = IDS.filter((l) => lineT[l]?.ole != null && lineT[l].ole < okFrom()).length;
  // trend: per day (per month in the year view); a single day has no trend
  // the trend: OLE · A · P · Q (%) and target vs actual (pcs) per point; a month shows all its days, the days to come empty
  const trend = useMemo(() => {
    const TR = sameMonth ? R : RM;   // the month of the chosen date (the page's own data when it is that month)
    const range = sameMonth ? range0 : monthR;
    if (!TR) return [];
    const r1 = (v) => (v == null ? null : Math.round(v * 1000) / 10);
    const pt = (k, t, future = false) => {
      const ran = !future && t && t.totalMin > 0;
      const tg = ran ? planTargetOf(t) : null;
      return { k, future, ole: ran ? r1(t.ole) : null, A: ran ? r1(t.A) : null, P: ran ? r1(t.P) : null, Q: ran ? r1(t.Q ?? (t.qty > 0 ? 1 : null)) : null, target: tg, actual: ran ? t.qty : null };
    };
    if (mode === 'year') return months.map((x) => pt(x.n, x.t, x.future));
    const dLabel = (ds) => `${ds.slice(8, 10)} ${MONTHS[Number(ds.slice(5, 7)) - 1]}`;
    if (grain === 'day') {
      const pts = TR.days.map((d) => pt(dLabel(d.date), d.total));
      // a month (1st … today): the rest of the month on the axis, empty
      if (range.start.slice(8) === '01' && range.start.slice(0, 7) === range.end.slice(0, 7)) {
        const [yy, mm] = range.start.split('-').map(Number), last = new Date(yy, mm, 0).getDate();
        for (let d = Number(range.end.slice(8)) + 1; d <= last; d += 1) pts.push(pt(dLabel(`${range.start.slice(0, 8)}${p2(d)}`), null, true));
      }
      return pts;
    }
    // Trend: Week / Month (as the Dixon MES): the days summed per Monday-week or per month
    const groups = new Map();
    for (const d of TR.days) {
      const [yy, mm, dd] = d.date.split('-').map(Number);
      const mon = new Date(yy, mm - 1, dd - ((new Date(yy, mm - 1, dd).getDay() + 6) % 7));
      const key = grain === 'week' ? `${mon.getFullYear()}-${p2(mon.getMonth() + 1)}-${p2(mon.getDate())}` : d.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d.total);
    }
    return [...groups.entries()].map(([key, ts]) => pt(grain === 'week' ? `Wk ${dLabel(key)}` : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, oleSum(ts)));
  }, [R, RM, sameMonth, months, mode, grain, range0.start, range0.end, monthR.start, monthR.end]); // eslint-disable-line react-hooks/exhaustive-deps
  // the sidebar's "Trend": this month, day by day, then the page goes to the trend
  useEffect(() => {
    const go = (e) => { if (e.detail !== 'ov-trend') return; setMode('period'); setGrain('day'); setRange({ start: `${today.slice(0, 8)}01`, end: today }); };
    window.addEventListener('ems:ov-part', go);
    return () => window.removeEventListener('ems:ov-part', go);
  }, [today]);
  const updText = D.updatedAt && mode !== 'year' && range.end === today ? `Updated ${p2(D.updatedAt.getHours())}:${p2(D.updatedAt.getMinutes())}` : '';
  // the day picked in the drawer
  const dScope = pickLine ? [pickLine] : det?.ids || IDS;
  const dDay = pickDay ? R?.days.find((d) => d.date === pickDay) : null;
  const dInfo = useMemo(() => {
    if (!pickDay) return null;
    const t = dDay ? oleSum(dScope.map((l) => dDay.byLine[l]?.total)) : null;
    const ran = t && (t.qty > 0 || t.totalMin > 0);
    const off = dDay && !ran ? dScope.map((l) => dDay.byLine[l]).find((x) => x?.closed === 'planned') : null;
    return { t: ran ? t : null, off: off ? (off.dayOff?.reason || 'Planned off') : null };
  }, [pickDay, dDay, dScope.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const dLoss = useMemo(() => (dDay ? lossSummary(dScope.flatMap((l) => dDay.byLine[l]?.rows || []), D.ent.reasons.station) : null), [dDay, dScope.join(), D.ent.reasons]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = allView ? `${plantsText(IDS)} Efficiency – Assembly Lines` : `${plantOf(IDS[0]) ? `${plantOf(IDS[0])} · ` : ''}${group} Efficiency`;

  // ── columns of the tables
  const lineCell = (l) => <span className="whitespace-nowrap font-bold">Line {l}{plantOf(l) && <span className="ml-1 text-fs-12 font-semibold text-slate-500">{plantOf(l)}</span>}</span>;
  // 27-11-2026: cause / action of a defect — the most written first, the rest on hover
  const textsCell = (l = []) => (!l.length ? <span className="text-amber-700">not written</span> : <span title={l.join('\n')}>{l[0]}{l.length > 1 && <span className="ml-1 text-fs-11 font-bold text-slate-500">+{l.length - 1}</span>}</span>);
  const C = {
    down: [{ k: 'name', label: 'Reason', wrap: true, render: (r) => <span className="font-semibold">{nice(r.name)}</span> }, { k: 'models', label: 'Model', wrap: true, render: (r) => modelsCell(r.models, 'min', 1, co, true) }, { k: 'dept', label: 'Dept.', render: (r) => (r.dept && r.dept !== 'Not set' ? r.dept : '—') }, { k: 'value', label: 'Time', right: true, render: (r) => hr2(r.value) }, { k: 'share', label: 'Share', right: true, render: (r) => shareCell(r.share) }],
    lineLoss: [{ k: 'line', label: 'Line', render: (r) => lineCell(r.line) },
      // 23-11-2026: top 3 reasons one per row (name · bar · time), wraps inside the card — no side scroll; models in the tooltip
      { k: 'reasons', label: 'Top Reasons', render: (r) => (
        <div className="space-y-0.5 py-0.5" style={{ whiteSpace: 'normal', minWidth: 240 }}>
          {r.reasons.map((x) => (
            <div key={x.name} className="grid items-center gap-2 text-fs-13" style={{ gridTemplateColumns: 'minmax(0, 300px) 90px 48px' }} title={`${x.name}${x.models?.length ? ` — ${x.models.map((m) => `${m.name} ${hr2(m.value)}`).join(', ')}` : ''}`}>
              <span className="truncate font-semibold text-[#222]">{nice(x.name)}</span>
              <span className="rounded-sm bg-[#EEF2F7]" style={{ width: 90, height: 6 }}><span className="block rounded-sm bg-[#2E75B6]" style={{ width: `${Math.max(6, Math.round((x.value / (r.reasons[0].value || 1)) * 100))}%`, height: 6 }} /></span>
              <span className="shrink-0 text-right font-mono text-fs-12 font-semibold text-[#333]" style={{ width: 46 }}>{hr2(x.value)}</span>
            </div>
          ))}
        </div>
      ) },
      { k: 'min', label: 'Duration', right: true, render: (r) => hr2(r.min) }, { k: 'share', label: 'Share', right: true, render: (r) => shareCell(lineLossTotal ? r.min / lineLossTotal : 0) }],
    perf: [{ k: 'line', label: 'Line', render: (r) => lineCell(r.line) }, { k: 'company', label: 'Company', render: (r) => <CompanyCell name={co(r.model)} /> }, { k: 'model', label: 'Model', render: (r) => <span className="font-mono font-semibold">{r.model}</span> },
      { k: 'std', label: 'Std', right: true, render: (r) => secText(r.std) }, { k: 'act', label: 'Actual', right: true, render: (r) => (r.few ? '—' : secText(r.act)) }, { k: 'var', label: 'Var.', right: true, render: (r) => (r.few ? '—' : varCell(r.var)) },
      // target · actual · achieved each in its own column (19-11-2026)
      { k: 'target', label: 'Target Qty', right: true, render: (r) => (r.few ? fewNote(r.qty) : r.target == null ? '—' : nf(r.target)) },
      { k: 'qty', label: 'Actual Qty', right: true, render: (r) => nf(r.qty) },
      { k: 'ach', label: 'Achieved', right: true, render: (r) => (r.few || r.target == null ? '—' : achChip(r.ach)) }, { k: 'lost', label: 'Time Lost', right: true, render: (r) => (r.few ? '—' : lostCell(r.lostMin)) }],
    defects: [{ k: 'name', label: 'Reason', wrap: true, render: (r) => <span className="font-semibold">{nice(r.name)}</span> }, { k: 'models', label: 'Model', wrap: true, render: (r) => modelsCell(r.models, 'pcs', 1, co, true) }, { k: 'cause', label: 'Cause', wrap: true, render: (r) => textsCell(r.causes) }, { k: 'action', label: 'Action', wrap: true, render: (r) => textsCell(r.actions) }, { k: 'rej', label: 'Rework', right: true, render: (r) => nf(r.rej) }, { k: 'pass', label: 'Passed', right: true, render: (r) => nf(Math.max(0, (r.rej || 0) - (r.dis || 0))) }, { k: 'dis', label: 'Dismantle', right: true, render: (r) => (r.dis ? <b className="text-red-700">{nf(r.dis)}</b> : <span className="text-slate-400">0</span>) }, { k: 'share', label: 'Share', right: true, render: (r) => shareCell(r.share) }],
    lineRej: [{ k: 'line', label: 'Line', render: (r) => lineCell(r.line) }, { k: 'rej', label: 'Rework', right: true, render: (r) => nf(r.rej) }, { k: 'pass', label: 'Passed', right: true, render: (r) => nf(Math.max(0, (r.rej || 0) - (r.dis || 0))) }, { k: 'dis', label: 'Dismantle', right: true, render: (r) => (r.dis ? <b className="text-red-700">{nf(r.dis)}</b> : <span className="text-slate-400">0</span>) }, { k: 'r', label: 'Rework %', right: true, render: (r) => <span className={`rounded px-1.5 py-0.5 font-bold ${rejChip(r.r)}`}>{pc(r.r, 2)}</span> }],
    modelRej: [{ k: 'company', label: 'Company', render: (r) => <CompanyCell name={co(r.name)} /> }, { k: 'name', label: 'Model', wrap: true, render: (r) => <span className="font-mono font-semibold">{r.name}</span> }, { k: 'rej', label: 'Rework', right: true, render: (r) => nf(r.rej) }, { k: 'pass', label: 'Passed', right: true, render: (r) => nf(Math.max(0, (r.rej || 0) - (r.dis || 0))) }, { k: 'dis', label: 'Dismantle', right: true, render: (r) => (r.dis ? <b className="text-red-700">{nf(r.dis)}</b> : <span className="text-slate-400">0</span>) }, { k: 'r', label: 'Rework %', right: true, render: (r) => <span className={`rounded px-1.5 py-0.5 font-bold ${rejChip(r.r)}`}>{pc(r.r, 2)}</span> }],
    linePerf: [{ k: 'company', label: 'Company', render: (r) => <CompanyCell name={co(r.model)} /> }, { k: 'model', label: 'Model', render: (r) => <span className="font-mono font-semibold">{r.model}</span> }, { k: 'target', label: 'Target', right: true, render: (r) => (r.few ? '—' : r.target == null ? '—' : nf(r.target)) }, { k: 'qty', label: 'Produced', right: true, render: (r) => nf(r.qty) },
      { k: 'short', label: '+ / − vs plan', right: true, render: (r) => (r.few ? fewNote(r.qty) : r.short == null ? '—' : <b className={r.short < 0 ? 'text-red-700' : 'text-emerald-700'}>{signed(r.short)}</b>) },
      { k: 'ach', label: 'Achieved', right: true, render: (r) => (r.few || r.ach == null ? '—' : `${Math.round(r.ach * 1000) / 10}%`) },
      { k: 'std', label: 'Std CT', right: true, render: (r) => secText(r.std) }, { k: 'act', label: 'Actual CT', right: true, render: (r) => (r.few ? '—' : secText(r.act)) }, { k: 'var', label: 'Var.', right: true, render: (r) => (r.few ? '—' : varCell(r.var)) }, { k: 'lost', label: 'Time Lost', right: true, render: (r) => (r.few ? '—' : lostCell(r.lostMin)) }],
  };
  C.hours = [{ k: 'hour', label: 'Hour', render: (r) => <span className="whitespace-nowrap font-mono font-bold">{p2(r.hour)}:00–{p2((r.hour + 1) % 24)}:00{r.extra && <span className="ml-1 rounded bg-amber-100 px-1 text-fs-11 text-amber-800">extra</span>}</span> },
    // 26-11-2026: every model of the hour, one under the other, with its pieces (most first)
    { k: 'models', label: 'Models', wrap: true, render: (r) => (!r.models?.length ? <span className="text-[#999]">—</span> : (
      <span className="flex flex-col gap-0.5 py-0.5">{r.models.map((m) => (
        <span key={m.name} className="flex items-baseline justify-between gap-3 whitespace-nowrap"><span className="font-mono font-semibold">{m.name}</span><span className="text-fs-12 text-[#666]">{nf(m.value)} pcs</span></span>
      ))}</span>)) },
    { k: 'target', label: 'Target', right: true, render: (r) => (r.target == null ? '—' : nf(r.target)) }, { k: 'qty', label: 'Produced', right: true, render: (r) => nf(r.qty) },
    { k: 'short', label: '+ / − vs plan', right: true, render: (r) => (r.target == null ? '—' : <b className={r.qty < r.target ? 'text-red-700' : 'text-emerald-700'}>{signed(r.qty - r.target)}</b>) },
    { k: 'ach', label: 'Achieved', right: true, render: (r) => (r.target ? achChip(r.qty / r.target) : '—') },
    // 19-11-2026: the cycle of the hour — std (weighted by the models made) against actual (run time ÷ pieces)
    { k: 'std', label: 'Std CT', right: true, render: (r) => secText(stdCt(r.t)) },
    { k: 'act', label: 'Actual CT', right: true, render: (r) => { const a = r.t.qty > 0 && r.t.actualMin > 0 ? (r.t.actualMin * 60) / r.t.qty : null, sd = stdCt(r.t); return a == null ? '—' : <span className={sd != null && a > sd * 1.005 ? 'font-bold text-red-700' : 'text-emerald-700'}>{secText(a)}</span>; } },
    { k: 'run', label: 'Run Time', right: true, render: (r) => hr2(r.t.actualMin) },
    { k: 'loss', label: 'Stop / Loss', right: true, render: (r) => (r.t.stopMin + r.t.lossMin > 0 ? <b className="text-red-700">{hr2(r.t.stopMin + r.t.lossMin)}</b> : <span className="text-slate-400">0.0 h</span>) },
    // 'Lost vs Std' not shown hour by hour (19-11-2026, as asked)
    { k: 'A', label: 'A', right: true, render: (r) => <span className={tone(r.t.A, 'A')}>{pc1(r.t.A)}</span> }, { k: 'P', label: 'P', right: true, render: (r) => <span className={tone(r.t.P, 'P')}>{pc1(r.t.P)}</span> },
    // Q always shown (19-11-2026), 100% when nothing was rejected
    { k: 'Q', label: 'Q', right: true, render: (r) => <span className={tone(r.t.Q ?? (r.t.qty > 0 ? 1 : null), 'Q')}>{pc1(r.t.Q ?? (r.t.qty > 0 ? 1 : null))}</span> },
    { k: 'ole', label: 'OLE', right: true, render: (r) => <b className={tone(r.t.ole)}>{pc1(r.t.ole)}</b> }];
  // in a drawer the model column shows up to three models with their own time / pieces
  const wide = (cols, unit) => cols.map((c) => (c.k === 'models' ? { ...c, render: (r) => modelsCell(r.models, unit, 3, co) } : c));
  const WIN = {
    down: ['Idle Time Reasons', downRows, wide(C.down, 'min')], perfLoss: ['Performance Loss Reasons', perfRows, wide(C.down, 'min')], lineLoss: ['Line-Wise Idle Time', lineLoss, C.lineLoss], perf: ['Cycle Time vs Standard', perf, C.perf],
    defects: ['Rework / Defect Reasons', defects, wide(C.defects, 'pcs')], lineRej: ['Line-Wise Rework', lineRej, C.lineRej], modelRej: ['Model-Wise Rework', modelRej, C.modelRej],
  };  // 26-11-2026: a row of these tables opens its own entries (drill-down): a reason, a line or a model
  const pickOf = (k, r) => (['lineRej', 'lineLoss'].includes(k) ? { f: 'line', v: String(r.line), label: `Line ${r.line}` }
    : k === 'modelRej' ? { f: 'model', v: r.name, label: r.name } : { f: 'reason', v: r.name, label: r.name });
  const drill = (k, back = null) => (k === 'perf' ? (r) => setWin({ kind: 'model', row: r, back }) : (r) => setWin({ kind: k, pick: pickOf(k, r), back }));
  const pickRow = (k, r, pk) => (!pk ? true : pk.f === 'line' ? String(r.line) === pk.v : r.name === pk.v);

  // a factor: the OLE drill-down (A / P / Q → line → day → hour → model → reason) when this login has it, else its window
  const drillOk = !!onOpen && canOpen.includes('oledrill') && mode !== 'year';
  const openDrill = (k, line = null) => openOleDrill(onOpen, { f: k, line: line || (IDS.length === 1 ? IDS[0] : null), start: range.start, end: range.end });
  // 19-11-2026: Availability › / Performance › / Quality › open their deep page (as the MES focus pages) when the login has it
  const FOCUS = { A: 'olea', P: 'olep', Q: 'oleq' };
  const focusOk = (k) => !!onOpen && canOpen.includes(FOCUS[k]);
  const openFocus = (k, line = null) => openOleFocus(onOpen, { f: k, line: line || (IDS.length === 1 ? IDS[0] : null), start: range.start, end: range.end });
  const openFactor = (k) => (focusOk(k) ? openFocus(k) : drillOk ? openDrill(k) : setWin({ kind: k === 'A' ? 'down' : k === 'P' ? 'perf' : 'defects' }));

  return (
    <div className="flex flex-col gap-3" aria-label="OLE overview">
      <StageFpyHost />
      {/* 1 — filters: in the top bar on wide screens, on the page (wrapping) on phones and small laptops */}
      {(() => {
        const tabs = ALL.length > 1 && (
          <div className="flex max-w-full shrink-0 flex-wrap overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Overview view">
            {['all', ...ALL].map((v) => (
              <button key={v} type="button" aria-pressed={only === v} onClick={() => setOnly(v)} aria-label={v === 'all' ? 'Overview of all lines' : `Overview of Line ${v}`}
                className={`h-8 whitespace-nowrap border-r border-slate-300 px-3 text-fs-13 font-semibold last:border-r-0 ${only === v ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{v === 'all' ? 'Overall' : `Line ${v}`}</button>
            ))}
          </div>
        );
        const yearMode = { on: mode === 'year', set: (v) => { setMode(v ? 'year' : 'period'); setDet(null); setPickDay(null); }, value: year, setValue: (v) => { setYear(v); setDet(null); } };
        const busy = !!R && (D.stale || D.loading);
        // 24-11-2026: what the navy band of the summary carried (updated time, Day by day) sits in this strip; the band is gone
        const acts = R && (
          <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Summary">
            {updText && <span className="lp-wide-text whitespace-nowrap font-mono text-fs-13 font-semibold text-slate-600">{updText}</span>}
            <button type="button" onClick={() => setDet({ title: `${allView ? plantsText(IDS) : group} · ${periodText}`, ids: IDS, line: null })} className="inline-flex h-[30px] items-center gap-1 whitespace-nowrap rounded-[3px] border border-[#1F4E79] bg-[#1F4E79] px-2 text-fs-13 font-bold text-white hover:bg-[#1F3864]" aria-label="Day by day of the period" title={`Day by day${updText ? ` · ${updText}` : ''}`}><CalendarDays size={15} aria-hidden /><span className="lp-wide-text">Day by day</span></button>
          </div>
        );
        if (slot) return (<>{aslot && acts && createPortal(acts, aslot)}{createPortal(
          <div className="flex flex-wrap items-center gap-2">{tabs}<PeriodBar header today={today} range={range0} setRange={setRange} text={periodText} busy={busy} yearMode={yearMode} trend={mode !== 'year' && !oneDay ? { value: grain, set: setGrain } : null} />{!aslot && acts}</div>, slot)}</>);
        return (
          <div className="flex min-w-0 flex-col gap-2">
            {tabs}
            {acts}
            <PeriodBar today={today} range={range0} setRange={setRange} text={periodText} busy={busy} yearMode={yearMode} />
          </div>
        );
      })()}

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}
      {!R && !D.err && <OverviewSkeleton label={`Reading ${group}`} sub={mode === 'year' ? `Every month of ${year} — the first load may take longer` : 'OLE, losses and the trend of the period'} lines={IDS.length} />}

      {R && (
        <>
          {/* 2 — the plant (or the line): navy band + gauge | A | P | Q */}
          <section id="ov-summary" className={`${card} lp-anchor overflow-hidden`} aria-label="OLE of the period">
            {/* 24-11-2026: no navy band — the page title says the plant; updated time and Day by day are in the filter strip */}
            <KpiPanel t={TQ} onFactor={(k) => setWin({ kind: 'factor', f: k })} onOle={() => setDet({ title: `${group} · ${periodText}`, ids: IDS })} />
          </section>

          {mode === 'year' && (
            <section className={`${card} overflow-x-auto`} aria-label="Month by month">
              <SectionHead title={`${year} month by month`} small />
              <table className="w-full text-fs-15">
                <thead><tr className="bg-[#e3ecf8] text-left text-fs-13 text-dixon-navy">{['Month', 'Days run', 'Qty', 'Availability', 'Performance', 'Quality', 'OLE', 'Lost time', ''].map((h) => <th key={h} className="whitespace-nowrap border border-slate-300 px-2 py-1.5 font-extrabold">{h}</th>)}</tr></thead>
                <tbody>
                  {months.map((x) => (
                    <tr key={x.ym} className={`border-b border-slate-100 last:border-b-0 ${x.future || !x.days ? 'text-slate-400' : 'cursor-pointer hover:bg-blue-50'}`} aria-label={`Month ${x.n} ${year}`}
                      onClick={x.future || !x.days ? undefined : () => { const e = `${x.ym}-${String(new Date(year, Number(x.ym.slice(5)), 0).getDate()).padStart(2, '0')}`; setRange({ start: `${x.ym}-01`, end: e > today ? today : e }); setMode('period'); }}>
                      <td className="px-2 py-2 font-bold">{x.n} {year}</td>
                      <td className="px-2 font-mono">{x.days || '—'}</td>
                      <td className="px-2 font-mono">{x.days ? nf(x.t.qty) : '—'}</td>
                      {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-2 font-mono font-bold ${x.days ? cellTone(x.t[k], k) : ''}`}>{x.days ? pc(x.t[k]) : '—'}</td>)}
                      <td className="px-2 font-mono whitespace-nowrap">{x.days ? hrs((x.t.lossMin || 0) + (x.t.speedMin || 0)) : '—'}</td>
                      <td className="px-2 text-fs-13 font-bold text-blue-700">{x.days && !x.future ? 'Open ›' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* 3 — line-wise efficiency */}
          {allView && (
            <section id="ov-lines" className={`${card} lp-anchor overflow-hidden`} aria-label="Line-wise efficiency">
              <SectionHead title="Line-Wise Efficiency">
                <span className="rounded-[2px] bg-[#DDEBF7] px-1.5 py-[1px] text-[11.5px] font-bold tabular-nums text-[#1F3864]">{IDS.length} Lines</span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <span className="flex items-center gap-1.5 rounded-[2px] bg-[#C6EFCE] px-1.5 py-[1px] text-[11.5px] font-semibold text-[#006100]"><i className="inline-block h-2 w-2 rounded-full bg-[#2E9E5B]" />On Target (≥{Math.round(okFrom() * 100)}%) {onTarget}</span>
                  <span className="flex items-center gap-1.5 rounded-[2px] bg-[#FFC7CE] px-1.5 py-[1px] text-[11.5px] font-semibold text-[#9C0006]"><i className="inline-block h-2 w-2 rounded-full bg-[#C00000]" />Below Target {below}</span>
                </span>
              </SectionHead>
              <div className="grid gap-1.5 bg-white p-1.5 2xl:grid-cols-2">
                {IDS.map((l) => <LineCard key={l} line={l} t={lineTQ[l]} onOpen={() => setWin({ kind: 'linePerf', line: l })} onDetails={() => setDet({ title: `Line ${l} · ${periodText}`, ids: [l], line: l })} onFactor={(k) => setWin({ kind: 'linePerf', line: l, f: k, view: k === 'P' ? 'models' : 'loss' })} />)}
              </div>
            </section>
          )}

          {trend.length > 0 && <div id="ov-trend" className="lp-anchor"><Trend data={trend} title={`${mode === 'year' || grain === 'month' ? 'Month-Wise' : grain === 'week' ? 'Week-Wise' : 'Day-Wise'} Trend${mode !== 'year' ? ` · ${MONTH_FULL[Number(monthR.start.slice(5, 7)) - 1]} ${monthR.start.slice(0, 4)}` : ''}`} label="OLE trend" gid="oleFill" /></div>}

          {/* 4 — per factor: its tables */}
          <FactorBanner name="Availability" value={T.A} sub={`idle time ${hrs(T.lossMin)} of ${hrs(T.plannedMin)} planned`} />
          {/* 26-11-2026: each table the full width — no text cut, no sideways scroll */}
          <div className="grid gap-3">
            {/* 26-11-2026: one table — the lines as tabs above it (the Line-Wise Idle Time table is gone) */}
            <QTable title="Idle Time Reasons" rows={idleRows} cols={C.down} empty={idleL === 'all' ? 'No idle time entered for this period.' : `No idle time entered for Line ${idleL} in this period.`} onAll={() => setWin({ kind: 'down' })} onRow={drill('down')}
              tabs={IDS.length > 1 ? [{ k: 'all', label: 'All lines', sub: hr2(lineLossTotal) }, ...IDS.map((l) => ({ k: String(l), label: `Line ${l}`, sub: hr2((lineLoss.find((x) => String(x.line) === String(l)) || {}).min || 0) }))] : null} tab={idleL} onTab={setIdleLine} />
          </div>
          <FactorBanner name="Performance" value={T.P} sub={`speed loss ${hrs(T.speedMin || 0)}${modelInP ? ` · written ${hrs(T.perfLossMin || 0)}` : ''}`} />
          <div className="grid gap-3">
            {modelInP && <QTable title="Performance Loss Reasons" rows={perfRows} cols={C.down} empty="No performance loss written for this period." onAll={() => setWin({ kind: 'perfLoss' })} onRow={drill('perfLoss')} />}
            <QTable title="Cycle Time vs Standard" rows={perf} cols={C.perf} empty="No model with a std cycle in this period." onAll={() => setWin({ kind: 'perf' })} onRow={(r) => setWin({ kind: 'model', row: r })} />
          </div>
          <FactorBanner name="Quality" value={T.Q} sub={`${nf((T.rejects || 0) + (T.rework || 0))} reworked of ${nf(T.qty)} made`} />
          <QTable title="Rework / Defect Reasons" rows={defects} cols={C.defects} empty="No rework entered for this period." onAll={() => setWin({ kind: 'defects' })} onRow={drill('defects')} />
          <div className="grid gap-3 xl:grid-cols-2">
            <QTable title="Line-Wise Rework" rows={lineRej} cols={C.lineRej} empty="No rework entered for this period." onAll={() => setWin({ kind: 'lineRej' })} onRow={drill('lineRej')} />
            <QTable title="Model-Wise Rework" rows={modelRej} cols={C.modelRej} empty="No rework entered for this period." onAll={() => setWin({ kind: 'modelRej' })} onRow={drill('modelRej')} />
          </div>

          {win && win.kind === 'linePerf' && (() => {
            const list = perf.filter((x) => x.line === String(win.line));
            const tot = list.reduce((a, x) => ({ qty: a.qty + x.qty, target: a.target + (x.target || 0), lost: a.lost + (x.lostMin || 0) }), { qty: 0, target: 0, lost: 0 });
            const hrsL = hourPerf(R, win.line);
            const th = oleSum(hrsL.map((x) => x.t)), tt = hrsL.reduce((a, x) => a + (x.target || 0), 0);
            const view = win.view || 'models';
            const tab = (k, l) => <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setWin({ ...win, view: k })} className={`h-9 border-r border-slate-300 px-4 text-fs-14 font-bold last:border-r-0 ${view === k ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{l}</button>;
            return (
              <Window title={`Line ${win.line}${plantOf(win.line) ? ` (${plantOf(win.line)})` : ''} — ${{ A: 'Availability', P: 'Performance', Q: 'Quality' }[win.f] || 'Performance'} · Reasons For The Loss`} sub={periodText} onClose={() => setWin(null)} width={85} minWidth={980}>
                <div className="border-b border-[#BFBFBF]" aria-label={`Line ${win.line} A P Q`}><KpiPanel t={lineTQ[win.line]} zero gauge={150} only={win.f || null} onFactor={focusOk('A') || drillOk ? (k) => { setWin(null); if (focusOk(k)) openFocus(k, win.line); else openDrill(k, win.line); } : null} /></div>
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2">
                  <div role="tablist" aria-label="Line details" className="flex overflow-hidden rounded-md border border-slate-300">{tab('models', 'Model-Wise')}{tab('hours', 'Hour-Wise')}{tab('days', 'Day-By-Day')}{tab('loss', 'Losses')}</div>
                </div>
                {/* the line's losses of the period, reason by reason (the end of the way down: plant → line → losses) */}
                {/* the line's days (19-11-2026): a day opens its hour-by-hour drill-down */}
                {view === 'days' ? (() => {
                  const ds = (R?.days || []).map((d) => ({ date: d.date, t: d.byLine[win.line]?.total || oleSum([]) })).filter((d) => d.t.qty > 0 || d.t.totalMin > 0);
                  if (!ds.length) return <p className="p-4 text-fs-14 text-slate-600">No production in this period.</p>;
                  const tg = (t) => planTargetOf(t);
                  const T2 = oleSum(ds.map((d) => d.t)), tT = ds.reduce((a, d) => a + (tg(d.t) || 0), 0);
                  const wd = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
                  return <Grid rows={ds.map((d) => ({ ...d, key: d.date }))} label={`Line ${win.line} days`} cols={[
                    { k: 'date', label: 'Date', render: (r) => <button type="button" onClick={() => { setPickLine(win.line); setPickDay(r.date); }} className="whitespace-nowrap font-bold text-[#1F4E79] hover:underline">{dmy(r.date)} <span className="font-normal text-slate-500">{wd(r.date)}</span> ›</button> },
                    { k: 'target', label: 'Target', right: true, render: (r) => (tg(r.t) == null ? '—' : nf(tg(r.t))) },
                    { k: 'qty', label: 'Actual', right: true, render: (r) => <b>{nf(r.t.qty)}</b> },
                    { k: 'short', label: '+ / − vs plan', right: true, render: (r) => (tg(r.t) == null ? '—' : <b className={r.t.qty < tg(r.t) ? 'text-red-700' : 'text-emerald-700'}>{signed(r.t.qty - tg(r.t))}</b>) },
                    { k: 'ach', label: 'Achieved', right: true, render: (r) => (tg(r.t) ? achChip(r.t.qty / tg(r.t)) : '—') },
                    { k: 'run', label: 'Run Time', right: true, render: (r) => hr2(r.t.actualMin) },
                    { k: 'loss', label: 'Stop / Loss', right: true, render: (r) => (r.t.stopMin + r.t.lossMin > 0 ? <b className="text-red-700">{hr2(r.t.stopMin + r.t.lossMin)}</b> : <span className="text-slate-400">{hr2(0)}</span>) },
                    { k: 'A', label: 'A', right: true, render: (r) => <span className={tone(r.t.A, 'A')}>{pc1(r.t.A)}</span> },
                    { k: 'P', label: 'P', right: true, render: (r) => <span className={tone(r.t.P, 'P')}>{pc1(r.t.P)}</span> },
                    { k: 'Q', label: 'Q', right: true, render: (r) => <span className={tone(r.t.Q ?? (r.t.qty > 0 ? 1 : null), 'Q')}>{pc1(r.t.Q ?? (r.t.qty > 0 ? 1 : null))}</span> },
                    { k: 'ole', label: 'OLE', right: true, render: (r) => <b className={tone(r.t.ole)}>{pc1(r.t.ole)}</b> }]}
                    total={{ date: 'Total', target: tT ? nf(tT) : '—', qty: nf(T2.qty), short: tT ? <b className={T2.qty < tT ? 'text-red-700' : 'text-emerald-700'}>{signed(T2.qty - tT)}</b> : '—', ach: tT ? achChip(T2.qty / tT) : '—', run: hr2(T2.actualMin), loss: hr2(T2.stopMin + T2.lossMin), A: pc1(T2.A), P: pc1(T2.P), Q: pc1(T2.Q ?? (T2.qty > 0 ? 1 : null)), ole: pc1(T2.ole) }} />;
                })() : view === 'loss' ? (() => {
                  // 27-11-2026: only the losses of the factor clicked (Availability: idle time · Performance: speed · Quality: rework / rejected); no "Kind" column
                  const LR = lossSummary((R?.days || []).flatMap((d) => d.byLine[win.line]?.rows || []), D.ent.reasons.station).reason.filter((x) => x.value > 0);
                  const timeL = LR.filter((x) => x.kind === 'Idle time'), perfL = LR.filter((x) => x.kind === 'Performance loss'), pcsL = LR.filter((x) => x.unit !== 'min');
                  const slowL = list.filter((x) => !x.few && ((x.lostMin || 0) >= 0.5 || (x.target != null && x.qty < x.target))).sort((a, b) => (b.lostMin || 0) - (a.lostMin || 0) || (b.target - b.qty) - (a.target - a.qty));
                  const lossTable = (rows, unit, key) => {
                    const tot = rows.reduce((a, x) => a + x.value, 0);
                    return <Grid rows={rows.map((x) => ({ ...x, key: `${x.kind}|${x.name}` }))} label={`Line ${win.line} ${key}`} cols={[
                      { k: 'name', label: unit === 'min' ? 'Reason' : 'Defect', render: (r) => <span className="font-semibold">{nice(r.name)}</span> }, { k: 'models', label: 'Model', render: (r) => modelsCell(r.models, r.unit, 3, co) },
                      { k: 'dept', label: 'Department', render: (r) => (r.dept && r.dept !== 'Not set' ? r.dept : '—') },
                      ...(unit === 'min' ? [] : [{ k: 'type', label: 'Rework / Rejected', render: (r) => (r.kind === 'Rejection' ? 'Rejected' : 'Rework') }]),
                      { k: 'value', label: 'Lost', right: true, render: (r) => (r.unit === 'min' ? <b className="text-red-700">{hr2(r.value)}</b> : <b className="text-red-700">{nf(r.value)} pcs</b>) },
                      { k: 'share', label: 'Share', right: true, render: (r) => (tot ? shareCell(r.value / tot) : '—') }]}
                      total={{ name: 'Total', value: unit === 'min' ? hr2(tot) : `${nf(tot)} pcs` }} />;
                  };
                  const sect = (t, body) => <section className="border-b border-[#BFBFBF]"><h3 className="bg-[#F7F9FC] px-2.5 py-1.5 text-mes-body font-bold text-[#1F3864]">{t}</h3>{body}</section>;
                  const none = (t) => <p className="p-3 text-fs-14 text-slate-600">{t}</p>;
                  const A = sect('Availability loss · idle time', timeL.length ? lossTable(timeL, 'min', 'idle time') : none('No idle time entered for this line in this period.'));
                  const P = sect('Performance loss · models below target', <>
                    {slowL.length ? <Grid rows={slowL} label={`Line ${win.line} performance loss`} cols={C.linePerf.filter((c) => !['std'].includes(c.k))} onRow={(r) => setWin({ kind: 'model', row: r, back: win })} /> : none('Every model made its run-time target in this period.')}
                    {perfL.length > 0 && <div className="border-t border-[#BFBFBF]"><h4 className="px-2.5 py-1 text-mes-body font-semibold text-[#555]">Written against a model</h4>{lossTable(perfL, 'min', 'performance loss')}</div>}
                  </>);
                  const Q = sect('Quality loss · rework and rejected', pcsL.length ? lossTable(pcsL, 'pcs', 'quality loss') : none('No rework or rejection entered for this line in this period.'));
                  return <div data-testid="line-losses">{win.f === 'A' ? A : win.f === 'P' ? P : win.f === 'Q' ? Q : <>{A}{P}{Q}</>}</div>;
                })() : view === 'models' ? (!list.length ? <p className="p-4 text-fs-14 text-slate-600">No production in this period.</p>
                  : <Grid rows={list} cols={C.linePerf} label={`Line ${win.line} models`} onRow={(r) => setWin({ kind: 'model', row: r, back: win })} total={{ model: 'Total', target: nf(tot.target), qty: nf(tot.qty), short: <b className={tot.qty < tot.target ? 'text-red-700' : 'text-emerald-700'}>{signed(tot.qty - tot.target)}</b>, ach: tot.target ? `${Math.round((tot.qty / tot.target) * 1000) / 10}%` : '—', lost: lostCell(tot.lost) }} />)
                  : (!hrsL.length ? <p className="p-4 text-fs-14 text-slate-600">No production in this period.</p>
                  : <Grid rows={hrsL} cols={C.hours} label={`Line ${win.line} hours`} total={{ hour: 'Total', target: tt ? nf(Math.round(tt)) : '—', qty: nf(th.qty), short: tt ? <b className={th.qty < tt ? 'text-red-700' : 'text-emerald-700'}>{signed(Math.round(th.qty - tt))}</b> : '—', ach: tt ? achChip(th.qty / tt) : '—', std: secText(stdCt(th)), act: secText(th.qty > 0 && th.actualMin > 0 ? (th.actualMin * 60) / th.qty : null), run: hr2(th.actualMin), loss: hr2(th.stopMin + th.lossMin), slow: th.speedMin == null ? '—' : hr2(th.speedMin), A: pc1(th.A), P: pc1(th.P), Q: pc1(th.Q ?? (th.qty > 0 ? 1 : null)), ole: pc1(th.ole) }} />)}
              </Window>
            );
          })()}
          {/* a factor (19-11-2026): its tables in the side drawer; the full page only from the drawer's foot */}
          {win && win.kind === 'factor' && (() => {
            const F = { A: ['Availability', T.A, [['down', 'Idle Time Reasons'], ['lineLoss', 'Line-Wise Idle Time']]], P: ['Performance', T.P, [...(modelInP ? [['perfLoss', 'Performance Loss Reasons']] : []), ['perf', 'Cycle Time vs Standard']]], Q: ['Quality', T.Q, [['defects', 'Rework / Defect Reasons'], ['lineRej', 'Line-Wise Rework'], ['modelRej', 'Model-Wise Rework']]] }[win.f];
            return (
              <MesDrawer title={`${F[0]} ${pc1(F[1])}`} sub={`${allView ? plantsText(IDS) : group} · ${periodText}`} icon={ListTree} onClose={() => setWin(null)} label={`${F[0]} details`} backdropLabel="Close details" width={92} fit
                footer={focusOk(win.f) ? <button type="button" onClick={() => { setWin(null); openFocus(win.f); }} className="rounded-[2px] bg-[#2E75B6] px-3 py-1 text-mes-body font-semibold text-white hover:bg-[#1F4E79]">Open the {F[0]} page ›</button> : null}>
                <div className="flex flex-col gap-3 p-2">
                  {F[2].map(([k, t]) => (
                    <section key={k} className="rounded-[2px] border border-[#BFBFBF] bg-white">
                      <h3 className="border-b border-[#BFBFBF] bg-[#F7F9FC] px-2.5 py-1.5 text-mes-body font-bold text-[#1F3864]">{t}</h3>
                      {!WIN[k][1].length ? <p className="p-3 text-fs-14 text-slate-600">Nothing entered for this period.</p>
                        : k === 'perf' ? <PerfList rows={WIN[k][1]} cols={WIN[k][2]} co={co} label={t} onRow={drill(k, win)} rowTitle="Open its entries" />
                          : <Grid rows={WIN[k][1]} cols={WIN[k][2]} label={t} onRow={drill(k, win)} rowTitle="Open its entries" />}
                    </section>
                  ))}
                </div>
              </MesDrawer>
            );
          })()}
          {win && WIN[win.kind] && (
            <Window title={`${WIN[win.kind][0]}${win.pick ? ` — ${win.pick.label}` : ''}`} sub={`${allView ? plantsText(IDS) : group} · ${periodText}${win.pick ? ' · its entries below' : ''}`} onClose={() => setWin(win.back || null)} width={96}>
              {/* a list of many lines: Line 1 first, then Line 2 … (its own order kept inside a line) */}
              {win.kind === 'perf' ? <PerfList rows={WIN[win.kind][1]} cols={WIN[win.kind][2]} co={co} label={`${WIN[win.kind][0]} — all`} onRow={drill(win.kind, win)} rowTitle="Open its entries" />
                : <Grid rows={WIN[win.kind][1].filter((r) => pickRow(win.kind, r, win.pick))} cols={WIN[win.kind][2]} label={`${WIN[win.kind][0]} — all`} onRow={drill(win.kind, win)} rowTitle="Open its entries" />}
              {/* 26-11-2026: …and every entry behind it, as written (date, hour, line, model, all its details) */}
              {win.kind !== 'perf' && (() => {
                const unit = ['defects', 'lineRej', 'modelRej'].includes(win.kind) ? 'qty' : 'min';
                const pk = win.pick;
                const E = entriesOf(R, IDS, unit, win.kind === 'perfLoss').filter((x) => !pk || (pk.f === 'line' ? x.line === pk.v : pk.f === 'model' ? x.model === pk.v : (x.reason || 'Not given') === pk.v));
                const has = (k) => E.some((x) => x[k]);
                const cols = [
                  { k: 'date', label: 'Date', render: (r) => <span className="whitespace-nowrap font-semibold">{dmy(r.date)}</span> },
                  { k: 'hour', label: 'Hour', render: (r) => <span className="whitespace-nowrap font-mono">{p2(r.hour)}:00–{p2((r.hour + 1) % 24)}:00</span> },
                  { k: 'line', label: 'Line', render: (r) => lineCell(r.line) },
                  ...(unit === 'qty' ? [{ k: 'kind', label: 'Kind', render: (r) => r.kind }, ...(has('station') ? [{ k: 'station', label: 'Station', wrap: true, render: (r) => r.station || '—' }] : [])] : []),
                  { k: 'reason', label: unit === 'qty' ? 'Defect' : 'Reason', wrap: true, render: (r) => <span className="lp-caps font-semibold">{r.reason || 'Not given'}</span> },
                  { k: 'model', label: 'Model', wrap: true, render: (r) => (r.model ? <span>{co(r.model) && <span className="mr-1 text-fs-11 font-bold uppercase text-[#777]">{co(r.model)}</span>}<span className="font-mono font-semibold">{r.model}</span></span> : <span className="text-[#999]">—</span>) },
                  { k: 'dept', label: 'Dept.', wrap: true, render: (r) => (r.dept && r.dept !== 'Not set' ? r.dept : '—') },
                  ...(has('owner') ? [{ k: 'owner', label: 'Owner', render: (r) => r.owner || '—' }] : []),
                  ...(has('part') ? [{ k: 'part', label: 'Part', wrap: true, render: (r) => r.part || '—' }] : []),
                  ...(unit === 'qty' && has('cat') ? [{ k: 'cat', label: 'Category', wrap: true, render: (r) => r.cat || '—' }] : []),
                  { k: 'n', label: unit === 'min' ? 'Minutes' : 'Pcs', right: true, render: (r) => <b className="text-red-700">{nf(r.n)}</b> },
                  ...(unit === 'qty' && has('dismantle') ? [{ k: 'dismantle', label: 'Dismantled', right: true, render: (r) => (r.dismantle ? nf(r.dismantle) : '—') }] : []),
                  ...(unit === 'qty' && has('cause') ? [{ k: 'cause', label: 'Root Cause', wrap: true, render: (r) => r.cause || '—' }] : []),
                  ...(unit === 'qty' && has('action') ? [{ k: 'action', label: 'Action', wrap: true, render: (r) => r.action || '—' }] : []),
                  ...(has('note') ? [{ k: 'note', label: 'Hour Note', wrap: true, render: (r) => r.note || '—' }] : []),
                ];
                const tot = E.reduce((a, x) => a + x.n, 0);
                return (
                  <>
                    <h3 className="mt-3 border-y border-[#BFBFBF] bg-[#F7F9FC] px-2.5 py-1.5 text-mes-body font-bold text-[#1F3864]">Every entry <span className="font-normal text-[#777]">· {nf(E.length)} written · {unit === 'min' ? hr2(tot) : `${nf(tot)} pcs`} · newest day first</span></h3>
                    {!E.length ? <p className="p-3 text-fs-14 text-slate-600">Nothing written in this period.</p>
                      : <Grid rows={E} cols={cols} label={`${WIN[win.kind][0]} — every entry`} total={{ date: 'Total', n: <b>{nf(tot)}</b>, dismantle: unit === 'qty' ? nf(E.reduce((a, x) => a + (x.dismantle || 0), 0)) : undefined }} />}
                  </>
                );
              })()}
            </Window>
          )}
          {/* 26-11-2026: one model of one line — its figures, then hour by hour (✕ / Esc goes back to the list it came from) */}
          {win && win.kind === 'model' && (() => {
            const m = win.row, hs = modelHours(R, m.line, m.model);
            const q = hs.reduce((a, h) => a + h.qty, 0), aS = hs.reduce((a, h) => a + (h.actSec || 0), 0);
            const sQ = hs.filter((h) => h.std).reduce((a, h) => a + h.qty, 0), sS = hs.filter((h) => h.std).reduce((a, h) => a + h.qty * h.std, 0);
            const lost = hs.reduce((a, h) => a + (h.lostMin || 0), 0);
            return (
              <Window title={`Line ${m.line} — ${m.model}`} sub={`${co(m.model) ? `${co(m.model)} · ` : ''}${periodText}`} onClose={() => setWin(win.back || null)} width={70} minWidth={760}>
                <div className="border-b border-[#BFBFBF]"><Grid rows={[m]} cols={C.perf.filter((c) => !['line', 'company', 'model'].includes(c.k))} label={`${m.model} figures`} /></div>
                <h3 className="border-b border-[#BFBFBF] bg-[#F7F9FC] px-2.5 py-1.5 text-mes-body font-bold text-[#1F3864]">Hour by hour <span className="font-normal text-[#777]">· {hs.length} hour{hs.length === 1 ? '' : 's'} with this model</span></h3>
                {!hs.length ? <p className="p-4 text-fs-14 text-slate-600">No pieces of this model in this period.</p>
                  : <Grid rows={hs} label={`${m.model} hour by hour`} cols={[
                    { k: 'date', label: 'Date', render: (r) => <span className="whitespace-nowrap font-semibold">{dmy(r.date)}</span> },
                    { k: 'hour', label: 'Hour', render: (r) => <span className="whitespace-nowrap font-mono font-bold">{p2(r.hour)}:00–{p2((r.hour + 1) % 24)}:00{r.extra && <span className="ml-1 rounded bg-amber-100 px-1 text-fs-11 text-amber-800">extra</span>}</span> },
                    { k: 'qty', label: 'Pieces', right: true, render: (r) => <b>{nf(r.qty)}</b> },
                    { k: 'hourQty', label: 'Hour Total', right: true, render: (r) => nf(r.hourQty) },
                    { k: 'std', label: 'Std CT', right: true, render: (r) => secText(r.std) },
                    { k: 'act', label: 'Actual CT', right: true, render: (r) => secText(r.act) },
                    { k: 'var', label: 'Var.', right: true, render: (r) => varCell(r.var) },
                    { k: 'lost', label: 'Time Lost', right: true, render: (r) => lostCell(r.lostMin) },
                    { k: 'others', label: 'Other Models In The Hour', render: (r) => modelsCell(r.others, 'pcs', 2, co) }]}
                    total={{ date: 'Total', qty: nf(q), std: secText(sQ ? sS / sQ : null), act: secText(q ? aS / q : null), lost: lostCell(lost) }} />}
              </Window>
            );
          })()}
          {det && <PeriodDrawer title={det.title} ids={det.ids} R={R} reasons={D.ent.reasons.station} co={co} onClose={() => { setDet(null); setPickDay(null); }} onPickDay={(d, l = null) => { setPickLine(l); setPickDay(d); }} covered={!!pickDay}
            onLine={(l) => setWin({ kind: 'linePerf', line: l })}
            onOpenLine={det.line ? () => { const l = det.line; setDet(null); setOnly(l); } : null} />}
          {pickDay && <DayDrawer date={pickDay} day={dDay} ids={dScope} info={dInfo} losses={dLoss} co={co} onClose={() => setPickDay(null)} />}
          {/* 28-11-2026: how every number above is worked out (Model master cycle) */}
          <FormulaTab t={TQ} lines={IDS} settings={settings} />
        </>
      )}
    </div>
  );
}
