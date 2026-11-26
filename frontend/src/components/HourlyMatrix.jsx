import { normShift, workSecInHour, fmtMin, SHIFT_DEFAULT, splitHours } from '../utils/shift';
import { ACH_ORANGE_FROM } from '../utils/achieve';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtSeconds } from '../api';
import { mixTarget } from '../utils/targets';
import { savedUi } from '../hooks/useUiSettings';
import { serverToday, serverNow } from '../utils/serverTime';

// Working window shown as rows: 08-09 ... 20-21
const START_HOUR = 9;
const END_HOUR = 21; // exclusive upper bound

// Lunch break sits inside the 13-14 row (13:00 - 13:30). We can't split an
// hourly bucket into half-hours since the API only reports whole hours, so
// instead we flag that row clearly and treat it as a shorter working hour
// when judging how "full" it looks — it should never be shaded as if it
// under-performed a normal 60-minute hour, since only ~30 min were worked.
// The lunch window comes from the line's shift settings (Shift & lunch): the hour that holds it is marked
// and judged against the minutes actually worked in it.
function lunchInfo(shift) {
  const s = normShift(shift);
  if (s.lunchStart == null) return { hour: null, label: '', factor: 1, workedMin: 60 };
  const hour = Math.floor(s.lunchStart / 60);
  const workedMin = Math.round(workSecInHour(shift || SHIFT_DEFAULT, hour) / 60);
  return { hour, label: `${fmtMin(s.lunchStart)}–${fmtMin(s.lunchEnd)}`, factor: Math.max(0.05, workedMin / 60), workedMin };
}

// Default minimum quantity a hour-cell needs before we trust its cycle-time
// numbers. Below this, a single slow/fast scan can swing the average wildly,
// so we flag it and let the user drop it from every calculation below.
const DEFAULT_MIN_QTY = 10;

const pad2 = (n) => String(n).padStart(2, '0');
const nf0 = (v) => (v ? Math.round(v).toLocaleString('en-IN') : '');
const hourRangeLabel = (h) => `${pad2(h)}-${pad2(h + 1)}`;

// Three colours only, no shades (the Plant overview rule): green = plan reached, orange = close (at least the amber limit of
// Setup → Plant overview, 90 % by default), red = behind. A cell without pieces, without a plan or of a deselected row has no colour.
export const HOUR_OK = '#15803D';
export const HOUR_CLOSE = '#FB8C00';
export const HOUR_BAD = '#DC2626';
const NO_TONE = { bg: '#F1F5F9', fg: '#334155' };
// 26-11-2026: the % chip in a deep shade of its band (white text readable on every screen and TV)
const CHIP = { '#16A34A': '#166534', '#F59E0B': '#B45309', '#F87171': '#B91C1C' };
const SOFT = { ok: { bg: '#E3F5E9', fg: '#14532D', edge: '#16A34A' }, close: { bg: '#FFF3DC', fg: '#7C4A03', edge: '#F59E0B' }, bad: { bg: '#FDE8E8', fg: '#8F1D1D', edge: '#F87171' } };
const closeFrom = () => { const v = Number(savedUi()?.management?.oneView?.amberFrom); return v > 0 ? v / 100 : 0.9; };
function planTone(ratio, close) {
  if (!(ratio > 0)) return NO_TONE;
  // 24-11-2026: soft tints, easy on the eyes, same 3 bands as every chart (utils/achieve): ≥ 100 % green, 85–99 % orange,
  // below 85 % red — the colour as a light fill with a strong edge, the numbers in dark ink
  if (ratio >= 1) return { bg: SOFT.ok.bg, fg: SOFT.ok.fg, edge: SOFT.ok.edge };
  if (ratio >= ACH_ORANGE_FROM / 100) return { bg: SOFT.close.bg, fg: SOFT.close.fg, edge: SOFT.close.edge };
  return { bg: SOFT.bad.bg, fg: SOFT.bad.fg, edge: SOFT.bad.edge };
}

function efficiencyColor(row) {
  if (!row || !row.quantity || row.avgActualCycleSeconds == null || !row.theoreticalCycleSeconds) {
    return null;
  }
  const ratio = row.avgActualCycleSeconds / row.theoreticalCycleSeconds;
  if (ratio <= 1.05) return HOUR_OK;
  if (ratio <= 1.25) return HOUR_CLOSE;
  return HOUR_BAD;
}

function efficiencyLabel(row) {
  if (!row || !row.quantity || row.avgActualCycleSeconds == null || !row.theoreticalCycleSeconds) {
    return null;
  }
  const ratio = row.avgActualCycleSeconds / row.theoreticalCycleSeconds;
  if (ratio <= 1.05) return 'At / ahead of theoretical';
  if (ratio <= 1.25) return 'Slightly behind theoretical';
  return 'Well behind theoretical';
}

const CYCLE_COLORS = {
  min: '#0891b2',
  avg: '#0e7490',
  max: '#0e7490',
  theoretical: '#d97706',
};

// Small "i" bubble with a hover tooltip explaining exactly how a number on
// screen was calculated. Used everywhere a formula isn't obvious.
function InfoTip({ text }) {
  return (
    <span className="relative inline-flex group align-middle ml-1">
      <span
        className="w-3.5 h-3.5 rounded-full border border-slate-400 text-slate-700 text-fs-12 leading-none flex items-center justify-center cursor-help select-none hover:border-sky-600 hover:text-sky-700 transition-colors"
        tabIndex={0}
      >
        i
      </span>
      <span
        style={{ top: '100%', right: 0, marginTop: 6 }} className="pointer-events-none absolute z-50 w-60 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-fs-13 leading-relaxed text-slate-600 opacity-0 shadow-lg shadow-slate-300/60 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

// Always-visible cycle time panel — replaces a hover-only tooltip so the
// numbers are readable and don't get clipped by the scroll container.
// No gauge/meter here: min · avg · max are plain, readable numbers, since a
// visual bar between them implied a precision the underlying data doesn't
// have once low-quantity and cross-hour-boundary scans are excluded.
function CycleTimePanel({ cell, row, isLunch, lunch, isExcluded, minQty }) {
  const panelStyle = {
    background: '#ffffff',
    border: '1px solid #94a3b8',
  };

  if (!cell || !row || !row.quantity) {
    return null;   // no hour picked: the matrix takes the whole width
  }

  const effColor = efficiencyColor(row);
  const effLabel = efficiencyLabel(row);
  const gap =
    row.avgActualCycleSeconds != null && row.theoreticalCycleSeconds
      ? row.avgActualCycleSeconds - row.theoreticalCycleSeconds
      : null;
  const belowThreshold = row.quantity < minQty;
  const excludedQuantity = row.excludedQuantity || 0;

  return (
    <div
      className="lg:w-72 shrink-0 rounded-lg p-2.5 shadow-xl"
      style={{
        ...panelStyle,
        borderColor: effColor || '#f59e0b',
        boxShadow: '0 6px 18px rgba(15,23,42,0.10)',
      }}
    >
      <div className="flex items-center justify-between mb-3 pb-3" style={{ borderBottom: '1px solid #cbd5e1' }}>
        <div>
          <div className="text-slate-700 text-fs-13 uppercase tracking-wider font-semibold">
            Cycle Time
          </div>
          <div className="font-mono text-fs-13 text-slate-900 mt-1 font-semibold">
            {fmtDate(cell.date)} · {hourRangeLabel(cell.hour)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-slate-700 text-fs-13 uppercase">Quantity</div>
          <div className="font-mono text-fs-20 font-bold" style={{ color: '#d97706' }}>
            {row.quantity}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <div
          className="rounded-md px-2 py-2.5 text-center"
          style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}
        >
          <div className="text-slate-700 text-fs-12 uppercase font-semibold">Min</div>
          <div className="font-mono text-fs-13 mt-1 font-bold" style={{ color: CYCLE_COLORS.min }}>
            {fmtSeconds(row.minActualCycleSeconds)}
          </div>
        </div>

        <div
          className="rounded-md px-2 py-2.5 text-center"
          style={{
            background: 'rgba(34,211,238,0.10)',
            border: '1px solid rgba(34,211,238,0.75)',
          }}
        >
          <div className="text-sky-700 text-fs-12 uppercase font-bold">Avg</div>
          <div className="font-mono text-fs-18 mt-1 font-bold" style={{ color: CYCLE_COLORS.avg }}>
            {fmtSeconds(row.avgActualCycleSeconds)}
          </div>
        </div>

        <div
          className="rounded-md px-2 py-2.5 text-center"
          style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}
        >
          <div className="text-slate-700 text-fs-12 uppercase font-semibold">Max</div>
          <div className="font-mono text-fs-13 mt-1 font-bold" style={{ color: CYCLE_COLORS.max }}>
            {fmtSeconds(row.maxActualCycleSeconds)}
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-between font-mono text-fs-13 pt-1"
      >
        <span className="text-slate-700">Theoretical</span>
        <span className="font-bold" style={{ color: CYCLE_COLORS.theoretical }}>
          {fmtSeconds(row.theoreticalCycleSeconds)}
        </span>
      </div>

      {gap != null && (
        <div className="flex items-center justify-between mt-2 pt-2 font-mono text-fs-13" style={{ borderTop: '1px solid #cbd5e1' }}>
          <span className="text-slate-700 flex items-center">
            Gap vs theory
            {effLabel && <InfoTip text={effLabel} />}
          </span>
          <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: effColor }}>
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: effColor }}
            />
            {gap > 0 ? '+' : ''}
            {fmtSeconds(Math.abs(gap))}
          </span>
        </div>
      )}

      {excludedQuantity > 0 && (
        <div
          className="text-fs-13 mt-3 pt-3 leading-relaxed text-slate-600"
          style={{ borderTop: '1px solid #cbd5e1' }}
        >
          <span className="font-semibold text-slate-700">{excludedQuantity}</span> of {row.quantity} scans this hour are not in the cycle numbers above.
        </div>
      )}

      {isLunch && (
        <div
          className="text-fs-13 mt-3 pt-3 leading-relaxed"
          style={{ borderTop: '1px solid #cbd5e1', color: '#b45309' }}
        >
          🍴 Lunch break {lunch.label} falls in this hour — only {lunch.workedMin} min actually worked.
        </div>
      )}

      {belowThreshold && (
        <div
          className="text-fs-13 mt-2 pt-2 leading-relaxed font-medium"
          style={{ borderTop: '1px solid #cbd5e1', color: '#e11d48' }}
        >
          ⚠ Qty ({row.quantity}) is below the minimum of {minQty} — left out of the averages.
        </div>
      )}

      {isExcluded && (
        <div
          className="text-fs-13 mt-2 pt-2 leading-relaxed font-medium"
          style={{ borderTop: '1px solid #cbd5e1', color: '#e11d48' }}
        >
          🚫 Hour excluded from the totals.
        </div>
      )}
    </div>
  );
}

export default function HourlyMatrix({ days, matrix: matrixProp, loading: loadingProp, onSelectCell, selected, shift, lunchCounts, targets = null, models = null }) {
  const lunch = lunchInfo(shift);
  // Data now comes from the dashboard's single range request (no per-day fetching).
  const matrix = matrixProp || {};
  const loading = !!loadingProp;
  const error = null;
  const [hoverCell, setHoverCell] = useState(null); // {date, hour}
  const [minQty, setMinQty] = useState(DEFAULT_MIN_QTY);
  const [disabledRows, setDisabledRows] = useState(() => new Set()); // hours manually deselected
  const [showHelp, setShowHelp] = useState(false);

  // 09–21 always; an hour before 09:00 / from 21:00 with scans (early start, overtime) is shown too, so the totals match
  const hours = useMemo(() => {
    const set = new Set();
    for (let h = START_HOUR; h < END_HOUR; h++) set.add(h);
    for (const day of Object.values(matrix)) for (const [h, c] of Object.entries(day || {})) if ((c?.quantity || 0) > 0) set.add(Number(h));
    return [...set].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
  }, [matrix]);

  // lunch window as its own row: the hour that holds it is split into the lunch part and the worked part
  const rowSpec = useMemo(() => splitHours(shift || SHIFT_DEFAULT, hours), [shift, hours]);
  // 19-11-2026: the matrix fits the screen — every hour row shares the height left under it (no scrolling),
  // a row never smaller than 30 px (a very long shift then scrolls inside the box)
  const boxRef = useRef(null);
  const [panelOn, setPanelOn] = useState(false);
  useEffect(() => { if (selected) setPanelOn(true); }, [selected?.date, selected?.hour]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fit, setFit] = useState({ row: 40, max: 0 });
  const dense = (days || []).length > 8;   // 20-11-2026: many days → narrow day columns with the pieces only
  useLayoutEffect(() => {
    const el = boxRef.current; if (!el || typeof window === 'undefined') return undefined;
    const go = () => {
      const bar = document.querySelector('.lp-status')?.getBoundingClientRect().height || 0;
      const avail = Math.max(260, window.innerHeight - Math.max(0, el.getBoundingClientRect().top) - bar - 18);
      // 23-11-2026 (2): head 38 px + the total rows (24 px each, they stay at the bottom) + every hour row; rows down to 22 px so
      // a whole shift fits on the screen without scrolling
      const nFoot = el.querySelectorAll('tfoot tr').length || 4;   // total rows under the hours
      const row = Math.max(22, Math.min(54, Math.floor((avail - 38 - nFoot * 24 - 4) / Math.max(1, rowSpec.length)) - 2));   // a row draws 2 px taller than --hm-row
      setFit((f) => (f.row === row && f.max === avail ? f : { row, max: avail }));
    };
    go();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(go) : null; ro?.observe(document.body);
    window.addEventListener('resize', go);
    return () => { ro?.disconnect(); window.removeEventListener('resize', go); };
  }, [rowSpec.length]);
  const lunchQ = (date, h) => (lunchCounts ? (lunchCounts[date]?.[String(h)] ?? 0) : null);
  /** Quantity of a display row on a date (null = not known yet). */
  const qtyOf = (spec, date) => {
    const hq = matrix[date]?.[spec.hour]?.quantity ?? 0;
    if (spec.kind === 'hour') return hq;
    const lq = lunchQ(date, spec.hour);
    if (spec.kind === 'lunch') return lq;
    return lq == null ? null : Math.max(0, hq - lq);
  };
  const specAvg = (spec) => {
    let s = 0, n = 0;
    for (const d of days || []) { const q = qtyOf(spec, d); if (q > 0) { s += q; n += 1; } }
    return n ? s / n : null;
  };

  // plan per hour of day: the models made in that hour (over the period) × their target cycle → pcs per full hour
  const planPph = useMemo(() => {
    const out = {};
    for (const h of hours) {
      const ms = (models || []).map((m) => ({ mmId: m.mmId, qty: (m.hourly || []).find((x) => x.hour === h)?.quantity || 0 }));
      const mt = mixTarget(ms, targets);
      if (mt.cycle > 0) out[h] = 3600 / mt.cycle;
    }
    if (!Object.keys(out).length) {                        // no hourly mix: whole-period mix for every hour
      const mt = mixTarget((models || []).map((m) => ({ mmId: m.mmId, qty: m.quantity ?? m.qty })), targets);
      if (mt.cycle > 0) for (const h of hours) out[h] = 3600 / mt.cycle;
    }
    return out;
  }, [models, targets, hours]);
  const planOf = (spec) => (planPph[spec.hour] ? Math.round((planPph[spec.hour] * (spec.kind === 'work' ? spec.min : 60)) / 60) : null);
  // a plan exists when the period's models have a target, or when a cell's own model mix has one (23-11-2026: the
  // Target / Achieved rows used to stay hidden when only the cells' mixes had targets)
  const cellsHavePlan = useMemo(() => Object.values(matrix || {}).some((byH) => Object.values(byH || {}).some((c) => Array.isArray(c?.mix) && c.mix.length && mixTarget(c.mix.map(([mmId, qty]) => ({ mmId, qty })), targets).cycle > 0)), [matrix, targets]);
  const hasPlan = Object.keys(planPph).length > 0 || cellsHavePlan;
  const close = closeFrom();   // orange from this share of the plan (Setup → Plant overview)
  const closePct = Math.round(close * 100);

  const toggleRow = (hour) => {
    setDisabledRows((prev) => {
      const next = new Set(prev);
      if (next.has(hour)) next.delete(hour);
      else next.add(hour);
      return next;
    });
  };

  // A cell counts toward every stat below only if: it has output, its own
  // row hasn't been manually deselected, AND its quantity meets the minimum
  // threshold. This single helper is the one place that decides "in or out"
  // so the heatmap, the row/column averages and the grand total always agree.
  const isCountable = (row, hour) => {
    if (!row || !row.quantity) return false;
    if (disabledRows.has(hour)) return false;
    if (row.quantity < minQty) return false;
    return true;
  };

  // Row summary (right side): for each hour, averaged across whichever
  // dates actually had output that hour and passed the threshold/deselect check.
  const rowStats = useMemo(() => {
    const stats = {};
    for (const h of hours) {
      let qtySum = 0;
      let qtyDays = 0;
      let cycleSum = 0;
      let cycleDays = 0;
      for (const date of days || []) {
        const row = matrix[date]?.[h];
        if (isCountable(row, h)) {
          qtySum += row.quantity;
          qtyDays += 1;
          if (row.avgActualCycleSeconds != null) {
            cycleSum += row.avgActualCycleSeconds;
            cycleDays += 1;
          }
        }
      }
      stats[h] = {
        totalQty: qtySum,
        avgQty: qtyDays ? qtySum / qtyDays : null,
        avgCycle: cycleDays ? cycleSum / cycleDays : null,
      };
    }
    return stats;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, days, hours, minQty, disabledRows]);

  // Column summary (bottom): for each date, averaged across whichever
  // hours actually had output that day and passed the threshold/deselect check.
  const dateStats = useMemo(() => {
    const stats = {};
    for (const date of days || []) {
      let qtySum = 0;
      let cycleSum = 0;
      let cycleHours = 0;
      for (const h of hours) {
        const row = matrix[date]?.[h];
        if (isCountable(row, h)) {
          qtySum += row.quantity;
          if (row.avgActualCycleSeconds != null) {
            cycleSum += row.avgActualCycleSeconds;
            cycleHours += 1;
          }
        }
      }
      stats[date] = {
        totalQty: qtySum,
        avgCycle: cycleHours ? cycleSum / cycleHours : null,
      };
    }
    return stats;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, days, hours, minQty, disabledRows]);

  // Grand totals for the bottom-right / top-right corner cells.
  const grandStats = useMemo(() => {
    let qtySum = 0;
    let cycleSum = 0;
    let cycleCount = 0;
    for (const date of days || []) {
      for (const h of hours) {
        const row = matrix[date]?.[h];
        if (isCountable(row, h)) {
          qtySum += row.quantity;
          if (row.avgActualCycleSeconds != null) {
            cycleSum += row.avgActualCycleSeconds;
            cycleCount += 1;
          }
        }
      }
    }
    return { totalQty: qtySum, avgCycle: cycleCount ? cycleSum / cycleCount : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, days, hours, minQty, disabledRows]);

  if (!days || days.length === 0) {
    return null;
  }

  // the cycle panel: only for the hour picked (a click), as a card over the matrix — the matrix keeps its full width
  const activeCell = panelOn ? selected : null;
  const activeRow = activeCell ? matrix[activeCell.date]?.[activeCell.hour] : null;
  const activeExcluded = activeCell ? disabledRows.has(activeCell.hour) : false;


  // 23-11-2026: the plan of a cell — no plan outside the shift (early start / overtime), none for an hour of today that has
  // not begun, and the running hour of today is judged on the minutes gone so far (not on the whole hour)
  const sh = normShift(shift || SHIFT_DEFAULT);
  const today = serverToday();
  const nowD = serverNow();
  const nowM = nowD.getHours() * 60 + nowD.getMinutes() + nowD.getSeconds() / 60;
  // 23-11-2026: a cell's plan from the models really made in that hour of THAT day (matrix …mix = [[mmId, pcs]]), the
  // same rule as the line screens (utils/targets buildTargetDay): working minutes × the share of pieces with a target ÷
  // the mix's target cycle. Only a cell without its mix (old server, nothing made) uses the period's mix of that hour.
  const cellMix = (spec, date) => {
    const mix = matrix[date]?.[spec.hour]?.mix;
    if (!Array.isArray(mix) || !mix.length) return null;
    const mt = mixTarget(mix.map(([mmId, qty]) => ({ mmId, qty })), targets);
    const min = spec.kind === 'work' ? spec.min : 60;
    if (!(mt.cycle > 0)) return { plan: null, share: 0 };
    const share = mt.total > 0 ? mt.covered / mt.total : 1;
    return { plan: Math.round((min * 60 * share) / mt.cycle), share };
  };
  const cellPlan = (spec, date) => {
    const own = cellMix(spec, date);
    const base = own ? own.plan : planOf(spec);
    const share = own ? own.share : 1;
    const a = spec.from ?? spec.hour * 60, b = spec.to ?? spec.hour * 60 + 60;
    if (sh.start != null && sh.end != null && (b <= sh.start || a >= sh.end)) return { plan: null, state: 'outside' };
    if (date === today) {
      if (nowM <= a) return { plan: null, state: 'future' };
      if (nowM < b) return { plan: base ? Math.max(1, Math.round((base * (nowM - a)) / (b - a))) : null, state: 'running', full: base, share };
    }
    return { plan: base, state: base ? 'ok' : 'noplan', share };
  };
  // the day's plan and pieces of the counted hours (row on, pieces made, not below the min qty) — the footer
  // pieces compared with the plan: a model without a cycle time is not counted against it (as the line screens)
  // % shown: whole numbers, never 100 % for a cell under its plan (same on the line screens)
  const pctOf = (r) => (r < 1 ? Math.floor(r * 100) : Math.round(r * 100));
  const tgtQ = (qty, share = 1) => qty - Math.round(qty * (1 - (share ?? 1)));
  const dayPA = (date) => {
    let q = 0, pl = 0;
    for (const spec of rowSpec) {
      if (spec.kind === 'lunch' || disabledRows.has(spec.hour)) continue;
      const qty = qtyOf(spec, date) ?? 0; const { plan, share } = cellPlan(spec, date);
      if (!plan || !(qty > 0) || qty < minQty) continue;
      q += tgtQ(qty, share); pl += plan;
    }
    return { q, pl };
  };
  const allPA = (days || []).reduce((acc, d) => { const x = dayPA(d); return { q: acc.q + x.q, pl: acc.pl + x.pl }; }, { q: 0, pl: 0 });
  const pctTxt = (q, pl) => (pl > 0 ? `${Math.floor((q / pl) * 1000) / 10}%` : '—');
  const achColor = (q, pl) => (!(pl > 0) ? '#64748B' : q / pl >= 1 ? '#15803D' : '#B91C1C');
  const stacked = fit.row >= 40;   // a tall row: pieces over %, else side by side
  const tight = fit.row < 30;      // 23-11-2026: short rows — one-line hour names, smaller numbers
  const FOOT = 24;                 // height of a footer row (they stay at the bottom of the box)
  const foot = (i) => ({ position: 'sticky', bottom: (3 - i) * FOOT, height: FOOT, zIndex: 15 });
  const footL = (i) => ({ ...foot(i), left: 0, zIndex: 25 });
  const footR = (i) => ({ ...foot(i), right: 0, zIndex: 25 });
  const legend = (bg, text, extra = {}) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span style={{ width: 12, height: 12, borderRadius: 3, background: bg, display: 'inline-block', ...extra }} />{text}</span>;

  return (
    <div className={`hm2 lp-hm-wrap rounded-xl bg-white shadow-sm ${tight ? 'p-1.5' : 'p-2'}`} style={{ border: '1px solid #E2E8F0' }}>
      {/* head: title, what the colours mean, min qty, help — one short row */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pr-10">
        <div className="min-w-0" title="Pieces of every hour and % of its plan · click a cell for its scans">
          <h2 className="text-fs-15 font-extrabold text-slate-900">Hourly matrix <span className="text-fs-12 font-semibold normal-case text-slate-500">· pieces and % of plan · click a cell for its scans</span></h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-fs-12 font-semibold text-slate-600" aria-label="Legend">
          {hasPlan ? <>{legend(SOFT.ok.bg, 'Plan reached (100%+)', { boxShadow: `inset 3px 0 0 ${SOFT.ok.edge}` })}{legend(SOFT.close.bg, `${ACH_ORANGE_FROM}–99%`, { boxShadow: `inset 3px 0 0 ${SOFT.close.edge}` })}{legend(SOFT.bad.bg, `Below ${ACH_ORANGE_FROM}%`, { boxShadow: `inset 3px 0 0 ${SOFT.bad.edge}` })}</> : legend(NO_TONE.bg, 'No target', { border: '1px solid #CBD5E1' })}
          {legend('#F8FAFC', 'Outside shift — no plan', { border: '1px solid #CBD5E1' })}
          {legend('transparent', 'Running hour (plan so far)', { border: '2px dashed #1E3A8A' })}
          {legend('transparent', `Below ${minQty} pcs — left out`, { border: '1.5px dashed #64748B' })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5">
            <label htmlFor="minQty" className="whitespace-nowrap text-fs-13 font-semibold text-slate-700">Min qty</label>
            <input id="minQty" type="number" min={0} max={999} value={minQty} onChange={(e) => setMinQty(Math.max(0, Number(e.target.value) || 0))}
              className="w-14 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-center font-mono text-fs-13 text-slate-900 focus:border-sky-500 focus:outline-none" />
            <InfoTip text="An hour with fewer scans than this is not trusted: it gets a dashed ring and is left out of every total and average on this page." />
          </div>
          <button type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-fs-13 font-semibold text-slate-700 transition-colors hover:border-sky-500/50 hover:text-sky-700">{showHelp ? 'Hide help' : 'ⓘ How'}</button>
        </div>
      </div>

      {showHelp && (
        <div className="mb-2 bg-white border border-slate-200 rounded-lg p-2.5 text-fs-13 text-slate-600 leading-relaxed grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
          <div>
            <span className="text-sky-700 font-mono font-semibold">Primary basis</span> — this matrix is
            <b> scan based only</b>. Model name/identity is not used to create or rank the cells.
          </div>
          <div>
            <span className="text-slate-700 font-mono font-semibold">Cell quantity</span> — the number of
            scans/production units reported by the existing hourly API for that date and hour.
          </div>
          <div>
            <span className="text-slate-800 font-mono font-semibold">Daily total</span> — sum of the
            countable hourly scan quantities for that date.
          </div>
          <div>
            <span className="text-sky-700 font-mono font-semibold">Hourly average</span> — average scan
            quantity across dates that have countable output for that hour.
          </div>
          <div>
            <span className="text-slate-800 font-mono font-semibold">Cycle time</span> — min/avg/max come
            only from scans whose entire gap sits within that hour (see the cell panel's excluded-scans note).
          </div>
          <div>
            <span className="text-slate-700 font-mono font-semibold">Lunch hour</span> — {lunch.label || 'no lunch set'} is
            visually marked because it is a shorter working period (set it under Shift &amp; lunch).
          </div>
          <div>
            <span className="text-red-600 font-mono font-semibold">Below minimum</span> — the cell is
            flagged when its scan quantity is below the selected minimum threshold.
          </div>
          <div>
            <span className="text-slate-800 font-mono font-semibold">Important</span> — changing the
            minimum quantity affects analysis inclusion, not the raw scan count displayed in the cell.
          </div>
        </div>
      )}

      <div ref={boxRef} className="lp-hm hm2-box w-full min-w-0 overflow-auto rounded-lg" style={{ border: '1px solid #E2E8F0', maxHeight: fit.max || undefined, '--hm-row': `${fit.row}px` }}>
        <table className="w-full table-fixed" style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 140 + 104 + days.length * (dense ? 78 : 96) }}>
          <thead>
            <tr>
              <th className="hm2-h" style={{ position: 'sticky', top: 0, left: 0, zIndex: 30, width: 140, textAlign: 'left' }}>Hour</th>
              {days.map((date) => {
                const isT = date === today;
                return (
                  <th key={date} className={`hm2-h ${isT ? 'hm2-today' : ''}`} style={{ position: 'sticky', top: 0, zIndex: 20 }} title={fmtDate(date)}>
                    <div className="text-fs-15 font-extrabold leading-tight">{dense ? date.slice(8, 10) : fmtDate(date)}</div>
                    <div className="text-fs-11 font-semibold uppercase leading-tight opacity-80">{isT ? 'Today' : `${new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })} · ${new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}`}</div>
                  </th>
                );
              })}
              <th className="hm2-h" style={{ position: 'sticky', top: 0, right: 0, zIndex: 30, width: 104 }} title="Average pieces per hour over the days, and the average cycle">Avg / hour</th>
            </tr>
          </thead>
          <tbody>
            {rowSpec.map((spec) => {
              const hour = spec.hour;
              const isLunch = spec.kind === 'lunch';
              const isWork = spec.kind === 'work';
              const rowOff = !isLunch && disabledRows.has(hour);
              const outside = sh.start != null && sh.end != null && ((spec.to ?? hour * 60 + 60) <= sh.start || (spec.from ?? hour * 60) >= sh.end);
              if (isLunch) {
                const avgL = specAvg(spec);
                return (
                  <tr key={spec.key}>
                    <th className="hm2-rowh hm2-lunch" style={{ position: 'sticky', left: 0, zIndex: 10 }}>
                      <div className="flex items-center gap-1.5"><span aria-hidden>🍽</span><div><div className="text-fs-13 font-bold">{spec.label}</div><div className={`text-fs-11 text-slate-600 ${tight ? 'hidden' : ''}`}>{spec.min} min · no plan</div></div></div>
                    </th>
                    {days.map((date) => { const q = qtyOf(spec, date); return (
                      <td key={date} className="hm2-td"><div className="hm2-cell hm2-cell-lunch" title={q == null ? 'Reading the scans of the lunch time…' : `${q} scans during lunch`}>{q == null ? '…' : q > 0 ? q : ''}</div></td>
                    ); })}
                    <td className="hm2-avg hm2-lunch" style={{ position: 'sticky', right: 0, zIndex: 10 }}>{avgL != null ? Math.round(avgL) : ''}</td>
                  </tr>
                );
              }
              return (
                <tr key={spec.key} className={rowOff ? 'hm2-off' : ''}>
                  <th className="hm2-rowh" style={{ position: 'sticky', left: 0, zIndex: 10 }}>
                    <label className="flex cursor-pointer items-center gap-2" title={rowOff ? 'Left out of the totals — click to count it again' : 'Counted in the totals — click to leave this hour out'}>
                      <input type="checkbox" checked={!rowOff} onChange={() => toggleRow(hour)} className="h-3.5 w-3.5 shrink-0 cursor-pointer" style={{ accentColor: '#1E3A8A' }} />
                      <span className="min-w-0">
                        <span className={`block whitespace-normal font-mono font-bold text-slate-900 ${tight ? 'text-fs-13' : 'text-fs-14'}`}>{isWork ? spec.label : `${pad2(hour)}:00–${pad2(hour + 1)}:00`}{tight && (isWork || outside) && ' '}{tight && (isWork || outside) && <span className="whitespace-nowrap font-sans text-fs-11 font-semibold text-slate-500">{outside ? '· off shift' : `· ${spec.min}m`}</span>}</span>
                        {!tight && (isWork || outside) && <span className="block text-fs-11 font-semibold text-slate-500">{outside ? 'outside shift' : `${spec.min} min`}</span>}
                      </span>
                    </label>
                  </th>
                  {days.map((date) => {
                    const qtyKnown = qtyOf(spec, date);
                    const qty = qtyKnown ?? (matrix[date]?.[hour]?.quantity ?? 0);
                    const isSelected = selected && selected.date === date && selected.hour === hour;
                    const { plan, state, full, share } = cellPlan(spec, date);
                    const ratio = plan ? tgtQ(qty, share) / plan : null;
                    const below = qty > 0 && qty < minQty;
                    const tone = state === 'outside' ? { bg: '#F8FAFC', fg: '#475569' } : rowOff || !plan || !qty ? NO_TONE : planTone(ratio, close);
                    const pc = plan && qty > 0 ? pctOf(ratio) : null;
                    const tip = [
                      `${fmtDate(date)} · ${isWork ? spec.label : hourRangeLabel(hour)}`,
                      `${qty} pcs${qtyKnown == null && isWork ? ' (whole hour — lunch split still loading)' : ''}`,
                      state === 'outside' ? 'Outside the shift: no plan' : state === 'future' ? 'Not started yet' : plan ? `Plan ${plan}${state === 'running' ? ` so far (of ${full} for the whole hour)` : ''} → ${pc ?? 0}%${pc >= 100 ? ' · reached' : ` · ${Math.max(0, plan - qty)} short`}` : 'No plan (no target cycle for these models)',
                      below ? `Below ${minQty} pcs: left out of the totals` : '', rowOff ? 'Hour left out of the totals' : '',
                    ].filter(Boolean).join('\n');
                    return (
                      <td key={date} className="hm2-td" onMouseEnter={() => setHoverCell({ date, hour })} onMouseLeave={() => setHoverCell(null)}>
                        <button type="button" disabled={qty === 0} onClick={() => qty > 0 && onSelectCell && onSelectCell(date, hour)} title={tip}
                          aria-label={`${date} ${isWork ? spec.label : hourRangeLabel(hour)}: ${qty || 0} pcs${pc != null ? `, ${pc}% of plan` : ''}`}
                          className={`lp-hm-cell hm2-cell ${qty > 0 ? 'hm2-click' : ''} ${isSelected ? 'hm2-sel' : ''} ${state === 'running' && qty > 0 ? 'hm2-run' : ''} ${below ? 'hm2-below' : ''}`}
                          style={{ background: state === 'future' ? 'transparent' : tone.bg, color: tone.fg, '--edge': tone.edge && state !== 'future' ? tone.edge : 'transparent' }}>
                          {qty > 0 ? (
                            <span className={stacked ? 'flex flex-col items-center leading-none' : 'flex items-center justify-center gap-1.5 leading-none'}>
                              <span className={`font-mono font-extrabold ${tight ? 'text-fs-13' : 'text-fs-15'} ${rowOff ? 'line-through' : ''}`}>{qty}</span>
                              {/* 26-11-2026: the % in a chip of its band colour (green / orange / red) — read at a glance */}
                              {pc != null && !rowOff && <span className="rounded px-1 py-[1px] font-mono text-fs-12 font-extrabold" style={{ background: CHIP[tone.edge] || '#475569', color: '#fff', marginTop: stacked ? 3 : 0 }}>{pc}%</span>}
                            </span>
                          ) : <span style={{ opacity: 0.35 }}>{state === 'future' ? '' : '·'}</span>}
                          {/* 26-11-2026: no bar along the bottom any more — in a short row it ran through the number; the % chip and the cell colour say it */}
                        </button>
                      </td>
                    );
                  })}
                  <td className="hm2-avg" style={{ position: 'sticky', right: 0, zIndex: 10 }}>
                    {(isWork ? specAvg(spec) : rowStats[hour]?.avgQty) != null ? (
                      <span className={tight ? 'flex items-baseline justify-center gap-1.5 leading-none' : 'flex flex-col items-center leading-tight'}>
                        <span className="font-mono text-fs-14 font-bold text-slate-900">{Math.round(isWork ? specAvg(spec) : rowStats[hour].avgQty)}</span>
                        <span className="font-mono text-fs-11 font-bold" style={{ color: '#0E7490' }}>{fmtSeconds(rowStats[hour]?.avgCycle)}</span>
                      </span>
                    ) : <span className="text-slate-300">·</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {[
              ['Total pcs', 'Pieces of the counted hours (hour ticked, not below the min qty)', (d) => nf0(dateStats[d]?.totalQty), nf0(grandStats.totalQty), () => '#0F172A'],
              ...(hasPlan ? [
                ['Target', 'Plan of the same hours: each hour\'s model mix × its target cycle (the running hour: the minutes gone so far)', (d) => nf0(dayPA(d).pl), nf0(allPA.pl), () => '#0F172A'],
                ['Achieved', 'Total pcs ÷ target of the counted hours', (d) => { const x = dayPA(d); return pctTxt(x.q, x.pl); }, pctTxt(allPA.q, allPA.pl), (d) => (d ? achColor(dayPA(d).q, dayPA(d).pl) : achColor(allPA.q, allPA.pl))],
              ] : []),
              ['Avg cycle', 'Average of the counted hours\' average cycle', (d) => (dateStats[d]?.avgCycle != null ? fmtSeconds(dateStats[d].avgCycle) : '—'), grandStats.avgCycle != null ? fmtSeconds(grandStats.avgCycle) : '—', () => '#0E7490'],
            ].map(([label, tip, val, all, color], i, arr) => {
              const k = arr.length - 1 - i;   // distance from the bottom (sticky offset)
              const st = (o) => ({ ...o, bottom: k * FOOT });
              return (
                <tr key={label}>
                  <th className={`hm2-foot hm2-foot-l ${i === 0 ? 'hm2-foot-top' : ''}`} style={st(footL(0))} title={tip}>{label}</th>
                  {days.map((d) => <td key={d} className={`hm2-foot ${i === 0 ? 'hm2-foot-top' : ''}`} style={{ ...st(foot(0)), color: color(d) }}>{val(d) || '—'}</td>)}
                  <td className={`hm2-foot hm2-foot-r ${i === 0 ? 'hm2-foot-top' : ''}`} style={{ ...st(footR(0)), color: color(null) }}>{all || '—'}</td>
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>
      {loading && <div className="mt-1 animate-pulse text-fs-12 text-slate-500">loading…</div>}
    </div>
  );
}
