import React, { useState } from 'react';
import { Filter, RotateCcw, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { fmtSeconds } from '../api';

const MODES = [['auto', 'Auto'], ['fixed', 'Fixed'], ['off', 'Off']];
const num = 'h-7 w-14 rounded-md border border-slate-300 bg-white px-1.5 text-fs-13 font-bold font-mono text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

/** Outlier filter for cycle-time stats. Removed gaps are shown as stoppage time, never silently hidden. */
export default function OutlierBar({ outlier, onChange, onReset, rangeGaps, rangeSeconds, dayGaps, daySeconds, cleanCycle, bare = false }) {
  const mins = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} hr` : `${Math.round(s / 60)} min`);
  const help = {
    auto: `Cycle time = average of gaps between ${outlier.min}s and ${outlier.mult}× the model's median cycle (at least 20s, at most ${outlier.max}s). Larger gaps are treated as outliers (lunch, breakdown, changeover).`,
    fixed: `Cycle time = average of gaps between ${outlier.min}s and ${outlier.max}s. Gaps above ${outlier.max}s are treated as outliers.`,
    off: 'No upper limit — all gaps are included in the average.',
  }[outlier.mode];
  const fullHelp = `${help} Idle = no scan of any model on the line (each stop counted once). Idle time does not affect quantity. Applies to cycle time only.`;

  // 23-11-2026: the settings are folded to one short line (rarely changed) — more room for the page below
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('ems.outliersOpen') === '1'; } catch { return false; } });
  const flip = () => setOpen((o) => { try { localStorage.setItem('ems.outliersOpen', o ? '0' : '1'); } catch { /* private mode */ } return !o; });
  const summary = outlier.mode === 'off' ? 'Off' : `${outlier.mode === 'auto' ? `Auto · ×${outlier.mult}` : 'Fixed'} · ${outlier.min}–${outlier.max}s · idle ≥${outlier.idle ?? 60}s`;
  const idleChips = (
    <div className="ml-auto flex flex-wrap items-center gap-1.5 text-fs-12 font-bold">
      {cleanCycle != null && <span className="rounded-full bg-sky-50 border border-sky-200 text-sky-700 px-2 py-0.5" title="Average of gaps between the minimum and maximum limits; this is the default standard cycle">
        Clean cycle (avg): {fmtSeconds(cleanCycle)}
      </span>}
      <span className="rounded-full bg-slate-50 border border-slate-200 text-slate-700 px-2 py-0.5" title="Focus day: periods in which no scan was recorded on the line (lunch, breakdown, waiting); each stop is counted once">
        Day idle: {dayGaps || 0} stops · {daySeconds ? mins(daySeconds) : '0 min'}
      </span>
      <span className="rounded-full bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5" title="Across the entire selected range">
        Range idle: {rangeGaps || 0} stops · {rangeSeconds ? mins(rangeSeconds) : '0 min'}
      </span>
    </div>
  );
  if (!open) {
    return (
      <div className={`${bare ? '' : 'rounded-xl border border-slate-200 bg-white shadow-sm'} px-2.5 py-1 flex flex-wrap items-center gap-x-3 gap-y-1`}>
        <button type="button" onClick={flip} aria-expanded={false} title={`${fullHelp} Click to change.`}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">
          <Filter size={13} className="text-blue-600" /> Outliers: <span className="font-mono text-slate-900">{summary}</span> <ChevronDown size={14} />
        </button>
        {idleChips}
      </div>
    );
  }
  return (
    <div className={`${bare ? '' : 'rounded-xl border border-slate-200 bg-white shadow-sm'} px-2.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5`}>
      <button type="button" onClick={flip} aria-expanded className="flex items-center gap-1.5 text-fs-13 font-extrabold text-slate-800 hover:text-blue-700" title="Fold the outlier settings">
        <Filter size={14} className="text-blue-600" /> Outliers <ChevronUp size={14} />
      </button>
      <span className="text-slate-600 cursor-help" title={`${fullHelp}`} aria-label={fullHelp} tabIndex={0}><Info size={14} /></span>

      <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-fs-13 font-bold">
        {MODES.map(([k, l]) => (
          <button key={k} type="button" onClick={() => onChange({ mode: k })}
            className={`h-7 px-2.5 ${outlier.mode === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>

      {outlier.mode === 'auto' && (
        <label className="flex items-center gap-1.5 text-fs-13 font-bold text-slate-600">× Median
          <input type="number" min={1.2} max={50} step={0.5} className={num} value={outlier.mult}
            onChange={(e) => onChange({ mult: Number(e.target.value) || 3 })} />
        </label>
      )}
      {outlier.mode !== 'off' && (
        <label className="flex items-center gap-1.5 text-fs-13 font-bold text-slate-600"
          title={outlier.mode === 'auto' ? 'Upper limit in auto mode: a gap longer than this is never a cycle, even when the model has very few scans that day' : 'Gaps longer than this are outliers'}>
          {outlier.mode === 'auto' ? 'Max (s)' : 'Max gap (s)'}
          <input type="number" min={5} step={10} className={num} value={outlier.max}
            onChange={(e) => onChange({ max: Number(e.target.value) || 300 })} />
        </label>
      )}
      <label className="flex items-center gap-1.5 text-fs-13 font-bold text-slate-600">Min gap (s)
        <input type="number" min={0} className={num} value={outlier.min} onChange={(e) => onChange({ min: Math.max(0, Number(e.target.value) || 0) })} />
      </label>

      <label className="flex items-center gap-1.5 text-fs-13 font-bold text-slate-600" title="Line idle: only gaps longer than this number of seconds are counted as idle">Idle ≥ (s)
        <input type="number" min={10} step={10} className={num} value={outlier.idle ?? 60} onChange={(e) => onChange({ idle: Math.max(10, Number(e.target.value) || 60) })} />
      </label>

      <button type="button" onClick={onReset} title="Reset to default" className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100"><RotateCcw size={13} /></button>

      {idleChips}
    </div>
  );
}
