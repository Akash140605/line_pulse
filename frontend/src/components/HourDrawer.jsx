import React, { useMemo, useState } from 'react';
import { fmtSeconds, fmtTime } from '../api';
import { Clock } from 'lucide-react';
import MesDrawer from './MesDrawer';
import { lunchSplitOf } from '../utils/shift';

const pad2 = (n) => String(n).padStart(2, '0');
const DEFAULT_MIN_QTY = 10;

// Small "i" bubble with a hover tooltip explaining how a number was worked out.
function InfoTip({ text }) {
  return (
    <span className="relative inline-flex group align-middle ml-1">
      <span
        className="w-3.5 h-3.5 rounded-full border border-slate-200/60 text-slate-600 text-fs-12 leading-none flex items-center justify-center cursor-help select-none hover:border-sky-500 hover:text-sky-700 transition-colors"
        tabIndex={0}
      >
        i
      </span>
      <span className="pointer-events-none absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-fs-13 leading-relaxed text-slate-600 opacity-0 shadow-lg shadow-slate-300/60 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  );
}

// Small horizontal bar showing where "avg" sits between "min" and "max"
function CycleRangeBar({ min, avg, max }) {
  if (min == null || max == null || max <= min) return null;
  const pct = Math.min(100, Math.max(0, ((avg - min) / (max - min)) * 100));
  return (
    <div className="mt-2">
      <div className="relative h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-400/40 to-slate-400 rounded-full"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-sky-600 shadow-[0_0_4px_rgba(242,169,59,0.9)]"
          style={{ left: `calc(${pct}% - 3px)` }}
        />
      </div>
      <div className="flex justify-between text-fs-13 text-slate-600 mt-0.5 font-mono">
        <span>{fmtSeconds(min)}</span>
        <span>{fmtSeconds(max)}</span>
      </div>
    </div>
  );
}

// Detects a rework-flagged model/scan under any of the common field names an
// API might use for this. If your API uses a different field name than
// isRework / rework / reworkQuantity, tell me the exact field and I'll wire
// it up precisely instead of guessing.
function isReworkModel(m) {
  return Boolean(m?.isRework || m?.rework || (typeof m?.reworkQuantity === 'number' && m.reworkQuantity > 0));
}
function isReworkScan(s) {
  return Boolean(s?.isRework || s?.rework);
}

// A scan is "changeover-affected" if the scan immediately before it in time
// was a different model. Its cycleSeconds (time since this model's last
// scan) then spans the whole time another model was being worked on, so the
// number is real elapsed time but not a true cycle time for this model.
function flagChangeovers(scans, mode = 'consecutive') {
  const list = Array.isArray(scans) ? scans : [];
  let lastByModel = {};

  return list.map((s, i) => {
    const previous = i > 0 ? list[i - 1] : null;
    const previousSameModel = lastByModel[s.model];
    const sameAsPrevious = Boolean(previous && previous.model === s.model);
    const changeover = Boolean(previous && previous.model !== s.model);

    let cycle = null;

    if (mode === 'consecutive') {
      if (sameAsPrevious) {
        cycle = s.cycleSeconds != null
          ? Number(s.cycleSeconds)
          : (new Date(s.scanDate) - new Date(previous.scanDate)) / 1000;
      }
    } else {
      cycle = s.cycleSeconds != null
        ? Number(s.cycleSeconds)
        : previousSameModel != null
        ? (new Date(s.scanDate) - new Date(previousSameModel)) / 1000
        : null;
    }

    if (!Number.isFinite(cycle) || cycle < 0) cycle = null;

    lastByModel[s.model] = s.scanDate;

    return {
      ...s,
      cycleSeconds: cycle,
      calculatedCycle: s.cycleSeconds == null && cycle != null,
      noCycle: cycle == null,
      changeover,
    };
  });
}

// Recomputes avg/min/max per model from the scan log itself, skipping
// changeover-affected scans — gives a "clean" number to compare against the
// backend's own avg/min/max for that model.
function cleanStatsFromScans(scans, model, options = {}) {
  const {
    minCycles = 10,
    outlierMethod = 'iqr',
    outlierFactor = 1.5,
    hardMax = 0,
    trimPercent = 0,
  } = options;

  let values = (scans || [])
    .filter((s) => s.model === model && !s.changeover && s.cycleSeconds != null)
    .map((s) => Number(s.cycleSeconds))
    .filter((v) => Number.isFinite(v) && v >= 0);

  const rawCount = values.length;
  if (rawCount === 0) return null;

  // Optional known physical upper bound.
  if (hardMax > 0) {
    values = values.filter((v) => v <= hardMax);
  }

  // Statistical outlier removal.
  if (outlierMethod === 'iqr' && values.length >= 4) {
    const sorted = [...values].sort((a, b) => a - b);
    const quantile = (p) => {
      const pos = (sorted.length - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    const q1 = quantile(0.25);
    const q3 = quantile(0.75);
    const iqr = q3 - q1;
    const low = q1 - outlierFactor * iqr;
    const high = q3 + outlierFactor * iqr;
    values = values.filter((v) => v >= low && v <= high);
  } else if (outlierMethod === 'mad' && values.length >= 3) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)];
    if (mad > 0) {
      const sigma = 1.4826 * mad;
      const low = median - outlierFactor * sigma;
      const high = median + outlierFactor * sigma;
      values = values.filter((v) => v >= low && v <= high);
    }
  }

  // Symmetric percentile trimming, after statistical filtering.
  if (trimPercent > 0 && values.length >= 5) {
    values.sort((a, b) => a - b);
    const cut = Math.floor(values.length * trimPercent / 100);
    if (cut * 2 < values.length) {
      values = values.slice(cut, values.length - cut);
    }
  }

  if (values.length === 0) {
    return {
      avg: null, min: null, max: null, n: 0,
      rawCount, excluded: rawCount, reliable: false,
    };
  }

  const sum = values.reduce((a, b) => a + b, 0);

  return {
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    n: values.length,
    rawCount,
    excluded: rawCount - values.length,
    reliable: values.length >= minCycles,
  };
}

function ModelCard({ m, minQty, excluded, onToggleExclude, clean }) {
  const belowThreshold = m.quantity < minQty;
  const rework = isReworkModel(m);
  const showClean = clean && clean.n < m.quantity && Math.abs(clean.avg - (m.avgActualCycleSeconds ?? 0)) > 1;

  return (
    <div
      className={`relative bg-white border rounded-md px-2.5 py-2 pl-4 transition-all hover:shadow-md hover:shadow-slate-300/40 ${
        excluded
          ? 'border-slate-200 opacity-45'
          : rework
          ? 'border-slate-200 border-l-2 border-l-blue-400/70'
          : m.isLowVolume || belowThreshold
          ? 'border-slate-200 opacity-70 border-l-2 border-l-red-500/60'
          : 'border-slate-200 border-l-2 border-l-sky-500/60 hover:border-l-sky-600'
      }`}
    >
      <button
        type="button"
        onClick={() => onToggleExclude(m.mmId)}
        title={excluded ? 'Excluded from this drawer\'s totals — click to include' : 'Click to exclude from this drawer\'s totals'}
        className="absolute top-2.5 right-2.5 w-4 h-4 rounded border border-slate-200/40 flex items-center justify-center text-fs-12 text-slate-600 hover:border-red-500 hover:text-red-600 transition-colors"
      >
        {excluded ? '↺' : '✕'}
      </button>

      <div className="flex justify-between items-baseline pr-6">
        <span className="font-mono text-slate-900 text-fs-13">
          {m.model} {m.modelCode && <span className="text-slate-600">({m.modelCode})</span>}
          {rework && (
            <span className="ml-2 text-fs-13 uppercase tracking-wide text-blue-300 bg-blue-400/10 rounded px-1.5 py-0.5 align-middle">
              🔧 rework
            </span>
          )}
          {(m.isLowVolume || belowThreshold) && (
            <span className="ml-2 text-fs-13 uppercase tracking-wide text-red-600 bg-red-600/10 rounded px-1.5 py-0.5 align-middle">
              low volume
            </span>
          )}
        </span>
        <span className="font-mono text-slate-700 text-fs-13 font-semibold">{m.lunchQty ? `${m.quantity - m.lunchQty} pcs + ${m.lunchQty} lunch` : `${m.quantity} pcs`}</span>
      </div>

      <div className="flex gap-1.5 mt-2 text-fs-13 font-mono text-slate-600">
        <span>
          avg <span className="text-sky-700 font-semibold">{fmtSeconds(m.avgActualCycleSeconds)}</span>
        </span>
        <span>
          min <span className="text-sky-700">{fmtSeconds(m.minActualCycleSeconds)}</span>
        </span>
        <span>
          max <span className="text-sky-700">{fmtSeconds(m.maxActualCycleSeconds)}</span>
        </span>
      </div>

      <CycleRangeBar min={m.minActualCycleSeconds} avg={m.avgActualCycleSeconds} max={m.maxActualCycleSeconds} />

      <div className="mt-2 text-fs-13 font-mono text-slate-600">
        theoretical <span className="text-slate-700">{fmtSeconds(m.theoreticalCycleSeconds)}</span>
        {(m.isLowVolume || belowThreshold) && ` · unreliable, fewer than ${minQty} scans`}
      </div>

      {showClean && (
        <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-fs-13 font-mono">
          <span className="text-slate-600 flex items-center">
            adj. avg
            <InfoTip text={`Recalculated from ${clean.n} of ${m.quantity} scans, dropping any scan whose gap includes time spent on a different model (model changeover), per the Cycle Analysis Controls below. The card's own "avg" above is the raw backend number and still includes those.`} />
          </span>
          <span className="text-sky-700 font-semibold">{clean.avg == null ? "—" : fmtSeconds(clean.avg)}</span>
        </div>
      )}
    </div>
  );
}

export default function HourDrawer({ detail, loading, onClose, minQuantityThreshold = DEFAULT_MIN_QTY, shift = null }) {
  // 23-11-2026: an hour with lunch in it — the worked part and the lunch scans told apart (as the Hourly matrix)
  const LS = useMemo(() => (detail ? lunchSplitOf(detail, shift) : null), [detail, shift]);
  const open = detail !== null || loading;
  const hourLabel = detail ? `${pad2(detail.hour ?? 0)}-${pad2((detail.hour ?? 0) + 1)}` : '';
  const [excludedIds, setExcludedIds] = useState(() => new Set());
  const [cycleMode, setCycleMode] = useState('consecutive');
  const [minCycles, setMinCycles] = useState(10);
  const [outlierMethod, setOutlierMethod] = useState('iqr');
  const [outlierFactor, setOutlierFactor] = useState(1.5);
  const [hardMax, setHardMax] = useState(0);
  const [trimPercent, setTrimPercent] = useState(0);

  const toggleExclude = (mmId) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(mmId)) next.delete(mmId);
      else next.add(mmId);
      return next;
    });
  };

  const { visibleTotal, reworkModels, hasReworkData, flaggedScans, cleanByModel, changeoverCount } = useMemo(() => {
    if (!detail) {
      return {
        visibleTotal: 0,
        reworkModels: [],
        hasReworkData: false,
        flaggedScans: [],
        cleanByModel: {},
        changeoverCount: 0,
      };
    }
    const visibleTotal = detail.models
      .filter((m) => !excludedIds.has(m.mmId))
      .reduce((sum, m) => sum + (m.quantity || 0), 0);
    const reworkModels = detail.models.filter(isReworkModel);
    const hasReworkData = detail.models.some((m) => 'isRework' in m || 'rework' in m || 'reworkQuantity' in m);

    // Scan log ALWAYS uses the plain "consecutive same-model" cycle, no
    // matter what's picked in Cycle Analysis Controls below. This keeps the
    // raw log simple and honest — e.g. a model that ran only once this hour
    // never shows a big 20-minute "elapsed since some other model" number;
    // it just shows "—" for no-previous-same-model.
    const flaggedScans = flagChangeovers(detail.scans, 'consecutive');
    const changeoverCount = flaggedScans.filter((s) => s.changeover).length;

    // Model-wise "adj. avg" cards are the only place the Cycle Analysis
    // Controls (cycle method / outlier / trim / hard max) apply. When the
    // user picks "Previous same-model" here, only these aggregated numbers
    // change — the scan log rows stay fixed to consecutive-cycle above.
    const flaggedForAnalysis =
      cycleMode === 'consecutive' ? flaggedScans : flagChangeovers(detail.scans, cycleMode);

    const cleanByModel = {};
    for (const m of detail.models) {
      cleanByModel[m.mmId] = cleanStatsFromScans(flaggedForAnalysis, m.model, {
        minCycles,
        outlierMethod,
        outlierFactor,
        hardMax,
        trimPercent,
      });
    }

    return { visibleTotal, reworkModels, hasReworkData, flaggedScans, cleanByModel, changeoverCount };
  }, [detail, excludedIds, cycleMode, minCycles, outlierMethod, outlierFactor, hardMax, trimPercent]);

  if (!open) return null;
  // the MES detail drawer (components/MesDrawer.jsx): navy header with the hour, the scans below
  return (
    <MesDrawer title={detail ? `Hour ${hourLabel || detail.label}` : 'Hour detail'} sub={detail ? (LS ? `${LS.workQty} pcs worked ${LS.to}–${pad2((detail.hour ?? 0) + 1)}:00 · ${LS.lunchQty} scanned in lunch ${LS.from}–${LS.to}` : `${detail.totalQuantity ?? ''} pcs scanned · hour detail`) : 'Loading…'} icon={Clock} onClose={onClose} label="Hour detail" width={42}>
        {loading && (
          <div className="p-2.5 text-slate-600 font-mono text-fs-13 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-sky-600 animate-pulse" />
            Loading hour detail…
          </div>
        )}

        {detail && !loading && (
          <div>
            <div className="p-2.5 pt-5">
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                <div className="bg-white border border-slate-200 rounded-md px-2.5 py-2 hover:border-blue-600/40 transition-colors">
                  <div className="text-slate-600 text-fs-13 flex items-center">
                    Quantity
                    <InfoTip text="Sum of quantity across all models scanned this hour, minus any you've manually excluded below with the ✕ button." />
                  </div>
                  <div className="font-mono text-fs-20 text-slate-900 mt-0.5">
                    {LS ? visibleTotal - detail.models.filter((m) => !excludedIds.has(m.mmId)).reduce((x, m) => x + (LS.byModel[m.mmId]?.lunch || 0), 0) : visibleTotal}
                    {visibleTotal !== detail.totalQuantity && (
                      <span className="text-slate-600 text-fs-13 font-normal"> / {LS ? LS.workQty : detail.totalQuantity}</span>
                    )}
                  </div>
                  {LS && <div className="mt-0.5 text-fs-12 text-slate-600" data-testid="hour-lunch-split">worked {LS.to}–{pad2((detail.hour ?? 0) + 1)}:00 · <b>+{LS.lunchQty}</b> scanned in lunch (not counted)</div>}
                </div>
                <div className="bg-white border border-slate-200 rounded-md px-2.5 py-2 hover:border-blue-600/40 transition-colors">
                  <div className="text-slate-600 text-fs-13">Theoretical cycle{LS ? ` (${Math.round(LS.workSec / 60)} min worked)` : ''}</div>
                  <div className="font-mono text-fs-20 text-slate-700 mt-0.5">
                    {fmtSeconds(LS ? LS.theo : detail.theoreticalCycleSeconds)}
                  </div>
                </div>
              </div>

              {excludedIds.size > 0 && (
                <div className="text-fs-13 text-red-600 mb-2 leading-relaxed">
                  {excludedIds.size} model{excludedIds.size > 1 ? 's' : ''} excluded from the totals above.
                </div>
              )}

              <h4 className="text-slate-600 text-fs-13 uppercase tracking-wide mb-2 flex items-center">
                Models built this hour
                <InfoTip text={`Each card's own avg/min/max is calculated only from that model's scans this hour. Cards outlined in red have fewer than ${minQuantityThreshold} scans, so their cycle time is unreliable — the ✕ button lets you drop a card from the Quantity total above.`} />
              </h4>
              <div className="space-y-2 mb-6">
                {detail.models.length === 0 && <div className="text-slate-600 text-fs-13">No scans in this hour.</div>}
                {detail.models.map((m) => (
                  <ModelCard
                    key={m.mmId}
                    m={LS && LS.byModel[m.mmId] ? { ...m, lunchQty: LS.byModel[m.mmId].lunch, theoreticalCycleSeconds: (m.quantity || 0) - LS.byModel[m.mmId].lunch > 0 ? Math.round(LS.workSec / ((m.quantity || 0) - LS.byModel[m.mmId].lunch)) : null } : m}
                    minQty={minQuantityThreshold}
                    excluded={excludedIds.has(m.mmId)}
                    onToggleExclude={toggleExclude}
                    clean={cleanByModel[m.mmId]}
                  />
                ))}
              </div>

              {hasReworkData && (
                <>
                  <h4 className="text-slate-600 text-fs-13 uppercase tracking-wide mb-2 flex items-center">
                    🔧 Rework machines
                    <InfoTip text="Models/scans flagged as rework — units sent back through the line rather than a fresh first-pass build. Shown separately so rework volume does not get mistaken for normal throughput." />
                  </h4>
                  {reworkModels.length === 0 ? (
                    <div className="text-slate-600 text-fs-13 mb-6">No rework activity this hour.</div>
                  ) : (
                    <div className="space-y-2 mb-6">
                      {reworkModels.map((m) => (
                        <div
                          key={`rework-${m.mmId}`}
                          className="flex items-center justify-between bg-blue-400/5 border border-blue-400/30 rounded-md px-2.5 py-2.5"
                        >
                          <span className="font-mono text-slate-900 text-fs-13">
                            {m.model} {m.modelCode && <span className="text-slate-600">({m.modelCode})</span>}
                          </span>
                          <span className="font-mono text-blue-300 text-fs-13 font-semibold">
                            {m.reworkQuantity ?? m.quantity} pcs
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="mb-2 rounded-lg border border-sky-500/30 bg-sky-600/5 p-2.5">
                <div className="flex items-center justify-between gap-1.5 mb-3">
                  <div>
                    <div className="text-fs-13 font-semibold text-sky-700">Cycle Analysis Controls</div>
                  </div>
                  <InfoTip text="Use Consecutive for production cycle. Use Previous same-model to inspect the full elapsed gap. Large gaps can include changeover, another model, idle time, delayed scans or missed scans. This only changes the model cards' adj. avg — the scan log stays on consecutive mode." />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <label className="text-fs-13 text-slate-600">
                    Cycle method
                    <select value={cycleMode} onChange={(e) => setCycleMode(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-fs-13 font-mono text-sky-700">
                      <option value="consecutive">Consecutive same-model</option>
                      <option value="sameModel">Previous same-model</option>
                    </select>
                  </label>

                  <label className="text-fs-13 text-slate-600">
                    Minimum usable cycles
                    <select value={minCycles} onChange={(e) => setMinCycles(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-fs-13 font-mono text-sky-700">
                      {[3,5,8,10,15,20,30].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>

                  <label className="text-fs-13 text-slate-600">
                    Outlier method
                    <select value={outlierMethod} onChange={(e) => setOutlierMethod(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-fs-13 font-mono text-sky-700">
                      <option value="none">None</option>
                      <option value="iqr">IQR</option>
                      <option value="mad">MAD</option>
                    </select>
                  </label>

                  <label className="text-fs-13 text-slate-600">
                    Strictness
                    <select value={outlierFactor} onChange={(e) => setOutlierFactor(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-fs-13 font-mono text-slate-700">
                      <option value={1}>1.0×</option>
                      <option value={1.5}>1.5× standard</option>
                      <option value={2}>2.0×</option>
                      <option value={3}>3.0× relaxed</option>
                    </select>
                  </label>

                  <label className="text-fs-13 text-slate-600">
                    Hard maximum
                    <select value={hardMax} onChange={(e) => setHardMax(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-fs-13 font-mono text-red-600">
                      <option value={0}>None</option>
                      {[30,45,60,90,120,180,240].map((n) => <option key={n} value={n}>{n}s</option>)}
                    </select>
                  </label>

                  <label className="text-fs-13 text-slate-600">
                    Trim both ends
                    <select value={trimPercent} onChange={(e) => setTrimPercent(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-fs-13 font-mono text-sky-700">
                      {[0,2,5,10].map((n) => <option key={n} value={n}>{n}%</option>)}
                    </select>
                  </label>
                </div>

                <div className="mt-3 text-fs-13 leading-relaxed text-slate-600">
                  <b className="text-sky-700">Recommended:</b> Consecutive + 10 usable cycles + IQR 1.5×.
                  <b className="text-slate-700"> Why big values?</b> A timestamp gap can include changeover, another model,
                  machine idle time, delayed scanning, missed scanning, or a genuinely slow cycle.
                  <b className="text-red-600"> Hard maximum</b> should be used only when the process has a known physical limit.
                </div>
              </div>

              <h4 className="text-slate-600 text-fs-13 uppercase tracking-wide mb-2 flex items-center">
                Scan log
                <InfoTip text="Always shown in Consecutive same-model mode, regardless of the Cycle Analysis Controls above. Cycle = elapsed time from the previous scan of the same model. If there is no previous same-model scan, the row has no cycle and shows —. If a different model was scanned immediately before it, the elapsed time includes the changeover and is marked ⚠, so it is not used as a clean cycle reading." />
                {changeoverCount > 0 && (
                  <span className="ml-2 text-fs-13 font-mono normal-case text-slate-700">
                    {changeoverCount} changeover-affected
                  </span>
                )}
              </h4>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-fs-13 font-mono">
                <span className="text-sky-700 font-semibold">● valid / calculated cycle</span>
                <span className="text-slate-700 font-semibold">⚠ changeover-affected</span>
                <span className="text-slate-600">— no cycle available</span>
              </div>
              <div className="border border-slate-200 rounded-md overflow-x-auto">
                <table className="w-full text-fs-13 min-w-[420px]">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-left sticky top-0">
                      <th className="font-normal px-2.5 py-2">Time</th>
                      <th className="font-normal px-2.5 py-2">Model</th>
                      <th className="font-normal px-2.5 py-2 text-right">Cycle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaggedScans.map((s, i) => {
                      const rework = isReworkScan(s);
                      return (
                        <tr
                          key={s.scanId}
                          title={s.changeover ? 'Model changed right before this scan — cycle time includes time spent on the other model' : undefined}
                          className={`border-t border-slate-200 hover:bg-slate-50/80 transition-colors ${
                            s.changeover
                              ? 'bg-sky-600/10'
                              : rework
                              ? 'bg-blue-400/5'
                              : i % 2 === 1
                              ? 'bg-white/30'
                              : ''
                          }`}
                        >
                          <td className="px-2.5 py-1.5 font-mono text-slate-600">{fmtTime(s.scanDate)}</td>
                          <td className="px-2.5 py-1.5 font-mono text-slate-900">
                            {s.model}
                            {rework && <span className="ml-1.5 text-blue-300 text-fs-13">🔧</span>}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono text-right">
                            {s.noCycle ? (
                              <span
                                className="text-slate-600"
                                title="Not calculated: immediately previous scan is a different model (or this is the first scan of this model)."
                              >
                                —
                              </span>
                            ) : s.changeover ? (
                              <span
                                className="text-slate-700 font-semibold"
                                title="Changeover-affected: the elapsed time includes time spent on another model."
                              >
                                {fmtSeconds(s.cycleSeconds)}
                                <span className="ml-1 text-slate-700 font-bold text-fs-13">⚠</span>
                              </span>
                            ) : (
                              <span
                                className="text-sky-700 font-semibold"
                                title={s.calculatedCycle ? "Calculated from the previous same-model scan timestamp." : "Cycle value supplied by the API."}
                              >
                                {fmtSeconds(s.cycleSeconds)}
                                {s.calculatedCycle && (
                                  <span className="ml-1 text-sky-700 text-fs-12">calc</span>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
    </MesDrawer>
  );
}