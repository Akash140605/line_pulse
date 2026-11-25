import { fs } from '../theme';
import React from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import CycleTimeToggle from './CycleTimeToggle';
import { fmtSeconds } from '../api';
import { qtyAxisFor, secondsTicks, secLabel } from '../utils/axisTicks';
import { splitHours, SHIFT_DEFAULT, normShift, fmtMin } from '../utils/shift';

// Only show the working window 09:00 -> 21:00 (i.e. ranges 09-10 ... 20-21)
const START_HOUR = 9;
const END_HOUR = 21; // exclusive upper bound on the range label

const pad2 = (n) => String(n).padStart(2, '0');
const hourRangeLabel = (h) => `${pad2(h)}-${pad2(h + 1)}`;

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const hasMinMax = row.minActualCycleSeconds != null || row.maxActualCycleSeconds != null;
  const gap =
    row.avgActualCycleSeconds != null && row.theoreticalCycleSeconds
      ? row.avgActualCycleSeconds - row.theoreticalCycleSeconds
      : null;

  return (
    <div className="bg-white border border-blue-600/30 rounded-lg px-3 py-2 text-fs-13 font-mono shadow-xl shadow-slate-300/50 min-w-[210px]">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200">
        <span className="text-slate-900 font-semibold">{row.label || hourRangeLabel(row.hour)}</span>
        <span className="text-slate-700 font-semibold">{row.quantity} pcs</span>
      </div>

      {row.isLunch ? <div className="text-slate-700">Scans during the lunch break (no target)</div> : (
      <div className="space-y-1">
        <div className="flex justify-between gap-1.5">
          <span className="text-slate-600">actual avg</span>
          <span className="text-sky-700">{fmtSeconds(row.avgActualCycleSeconds)}</span>
        </div>
        {hasMinMax && (
          <div className="flex justify-between gap-1.5 text-fs-13">
            <span className="text-slate-600">min / max</span>
            <span className="text-sky-600">
              {fmtSeconds(row.minActualCycleSeconds)} / {fmtSeconds(row.maxActualCycleSeconds)}
            </span>
          </div>
        )}
        <div className="flex justify-between gap-1.5">
          <span className="text-slate-600">theoretical</span>
          <span className="text-slate-700">{fmtSeconds(row.theoreticalCycleSeconds)}</span>
        </div>
        {gap != null && (
          <div className="flex justify-between gap-1.5 pt-1 mt-1 border-t border-slate-200">
            <span className="text-slate-600">gap vs theory</span>
            <span className={gap > 0 ? 'text-red-600' : 'text-sky-700'}>
              {gap > 0 ? '+' : ''}
              {fmtSeconds(Math.abs(gap))}
            </span>
          </div>
        )}
        {row.isWork && <div className="text-slate-600 text-fs-12">cycle values are for the whole hour</div>}
      </div>
      )}

      {row.distinctModels > 0 && !row.isLunch && (
        <div className="text-slate-600 mt-2 pt-2 border-t border-slate-200">
          {row.distinctModels} model(s)
        </div>
      )}
      {row.excludedQuantity > 0 && (
        <div className="text-red-600 mt-1">
          {row.excludedQuantity} pcs excluded from cycle avg (low-volume)
        </div>
      )}
      <div className="text-slate-700 mt-2 italic">click bar for detail →</div>
    </div>
  );
}

export default function HourlyChart({ hours, cycleMode, onCycleModeChange, onSelectHour, selectedHour, shift, lunchByHour }) {
  // Working window of the line's shift; the lunch window is its own bar (lunch scans) next to the worked part of that hour
  const sh = normShift(shift || SHIFT_DEFAULT);
  const startH = Math.floor(sh.start / 60), endH = Math.ceil(sh.end / 60);
  const base = (hours || []).filter((h) => h.hour >= startH && h.hour < endH);
  const windowed = splitHours(shift || SHIFT_DEFAULT, base.map((h) => h.hour)).map((spec) => {
    const h = base.find((x) => x.hour === spec.hour) || { hour: spec.hour, quantity: 0 };
    const lq = lunchByHour ? (lunchByHour[String(spec.hour)] ?? 0) : null;
    if (spec.kind === 'hour') return { ...h, key: spec.key, label: hourRangeLabel(spec.hour) };
    if (spec.kind === 'lunch') return { hour: spec.hour, key: spec.key, label: spec.label.replace('Lunch ', 'Lunch '), isLunch: true, quantity: lq ?? 0 };
    return { ...h, key: spec.key, label: spec.label, isWork: true, quantity: lq == null ? h.quantity : Math.max(0, (h.quantity || 0) - lq) };
  });
  // Quantity axis: base 100, step 20 (0 always shown). Ticks extend to the highest hour.
  const qtyAxis = qtyAxisFor(windowed.map((h) => h.quantity), 100, 20, { maxTicks: 9 }); // starts at 100 (or the next step below a low hour)

  // cycleMode now toggles whether the min/max envelope lines are shown —
  // actual & theoretical cycle lines are always both drawn together.
  const showMinMax =
    cycleMode === 'actual' &&
    windowed.some((h) => h.minActualCycleSeconds != null || h.maxActualCycleSeconds != null);

  // Cycle axis: round steps (0, 20s, 40s, 60s …) instead of odd values such as "1m 3s".
  const cycleMax = windowed.reduce((mx, h) => Math.max(mx,
    Number(h.avgActualCycleSeconds) || 0,
    Number(h.theoreticalCycleSeconds) || 0,
    showMinMax ? Number(h.maxActualCycleSeconds) || 0 : 0), 0);
  const cycleAxis = secondsTicks(cycleMax);
  const axisTick = { fill: '#334155', fontSize: fs(12), fontFamily: '"IBM Plex Mono", ui-monospace, monospace' };
  // Legend drawn below the chart, so it never covers the axis values.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const legend = [
    { value: 'Quantity', type: 'square', color: 'rgb(var(--blue-400))' },
    { value: 'Actual cycle', type: 'line', color: '#C2410C' },
    { value: 'Theoretical cycle', type: 'line', color: 'rgb(var(--navy))' },
    ...(showMinMax ? [{ value: 'Min / max cycle', type: 'line', color: '#B42318' }] : []),
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-2.5 sm:p-2.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2.5">
        <div className="min-w-0">
          <h2 className="text-slate-950 text-fs-13 sm:text-fs-18 font-extrabold">Hourly throughput &amp; cycle time</h2>
          <p className="text-slate-700 text-fs-13 sm:text-fs-13 mt-0.5 font-medium">
            {fmtMin(sh.start)} – {fmtMin(sh.end)}{sh.lunchStart != null ? ` · lunch ${fmtMin(sh.lunchStart)}–${fmtMin(sh.lunchEnd)} is its own grey bar` : ''} · bars = units scanned · lines = actual vs theoretical cycle · click a bar to drill in
          </p>
        </div>
        <CycleTimeToggle mode={cycleMode} onChange={onCycleModeChange} />
      </div>

      {/* phones: the legend sits above the (sideways-scrolling) chart so it is never cut */}
      <div className="sm:hidden flex flex-wrap gap-x-3 gap-y-1 mb-1.5 text-fs-12 font-mono text-slate-700">
        {legend.map((l) => (
          <span key={l.value} className="inline-flex items-center gap-1">
            <span style={{ background: l.color }} className={l.type === 'square' ? 'h-2.5 w-2.5 rounded-sm' : 'h-0.5 w-3.5 rounded'} />{l.value}
          </span>
        ))}
      </div>
      {/* Horizontal scroll on narrow screens instead of squashing/clipping the chart */}
      <div className="w-full overflow-x-auto overflow-y-hidden -mx-1 px-1">
        <div className="min-w-[560px] sm:min-w-0">
          <ResponsiveContainer width="100%" height={290}>
            <ComposedChart data={windowed} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="barActive" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--navy))" stopOpacity={1} />
                  <stop offset="100%" stopColor="rgb(var(--navy))" stopOpacity={0.95} />
                </linearGradient>
                <linearGradient id="barNormal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--blue-400))" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="rgb(var(--blue-400))" stopOpacity={0.8} />
                </linearGradient>
                <linearGradient id="barEmpty" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E2E8F0" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#CBD5E1" stopOpacity={0.3} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke="#CBD5E1" strokeDasharray="3 4" vertical={false} />
              <XAxis
                dataKey="key"
                tickFormatter={(k) => { const r = windowed.find((x) => x.key === k); return r ? (r.isLunch ? 'Lunch' : r.label) : k; }}
                tick={{ ...axisTick, fontSize: fs(11) }}
                angle={-40}
                textAnchor="end"
                height={44}
                axisLine={{ stroke: '#CBD5E1' }}
                tickLine={false}
                interval={0}
                padding={{ left: 4, right: 4 }}
              />
              <YAxis
                yAxisId="qty"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                width={44}
                allowDecimals={false}
                interval={0}
                ticks={qtyAxis.ticks}
                domain={qtyAxis.domain}
                allowDataOverflow
                tickFormatter={(v) => v.toLocaleString()}
              />
              <YAxis
                yAxisId="cycle"
                orientation="right"
                tickFormatter={secLabel}
                tick={{ ...axisTick, fill: '#9A3412' }}
                axisLine={false}
                tickLine={false}
                width={44}
                interval={0}
                ticks={cycleAxis.ticks}
                domain={cycleAxis.domain}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,194,75,0.08)' }} />
              <Legend
                payload={legend}
                content={narrow ? () => null : undefined}
                verticalAlign="bottom"
                align="center"
                wrapperStyle={{ fontSize: fs(12), fontFamily: '"IBM Plex Mono", ui-monospace, monospace', color: '#334155', paddingTop: 4, lineHeight: '18px' }}
              />

              <Bar
                yAxisId="qty"
                dataKey="quantity"
                name="Quantity"
                radius={[4, 4, 0, 0]}
                onClick={(d) => onSelectHour(d.hour)}
                cursor="pointer"
                maxBarSize={44}
              >
                {windowed.map((h) => (
                  <Cell
                    key={h.key}
                    fill={
                      h.isLunch ? '#CBD5E1'
                      : h.hour === selectedHour
                        ? 'url(#barActive)'
                        : h.quantity > 0
                        ? 'url(#barNormal)'
                        : 'url(#barEmpty)'
                    }
                    stroke={h.hour === selectedHour ? 'rgb(var(--red-600))' : 'transparent'}
                    strokeWidth={h.hour === selectedHour ? 1.5 : 0}
                  />
                ))}
              </Bar>

              {showMinMax && (
                <Line
                  yAxisId="cycle"
                  type="monotone"
                  dataKey="maxActualCycleSeconds"
                  name="Max cycle"
                  stroke="#B42318"
                  strokeWidth={1.25}
                  strokeDasharray="2 3"
                  dot={false}
                  connectNulls
                  legendType="none"
                />
              )}
              {showMinMax && (
                <Line
                  yAxisId="cycle"
                  type="monotone"
                  dataKey="minActualCycleSeconds"
                  name="Min cycle"
                  stroke="#12866F"
                  strokeWidth={1.25}
                  strokeDasharray="2 3"
                  dot={false}
                  connectNulls
                  legendType="none"
                />
              )}

              {/* Both cycle lines shown together, all the time */}
              <Line
                yAxisId="cycle"
                type="monotone"
                dataKey="avgActualCycleSeconds"
                name="Actual cycle"
                stroke="#C2410C"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#C2410C', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                activeDot={{ r: 5, fill: '#C2410C', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                connectNulls
              />
              <Line
                yAxisId="cycle"
                type="monotone"
                dataKey="theoreticalCycleSeconds"
                name="Theoretical cycle"
                stroke="rgb(var(--navy))"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 2.5, fill: 'rgb(var(--navy))', stroke: '#FFFFFF', strokeWidth: 1 }}
                activeDot={{ r: 4.5, fill: 'rgb(var(--navy))', stroke: '#FFFFFF', strokeWidth: 1 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}