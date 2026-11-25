import { fs } from '../theme';
import React, { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { fmtSeconds, fmtDate } from '../api';
import { qtyAxisFor } from '../utils/axisTicks';

function Trend({ delta }) {
  if (delta == null || Number.isNaN(delta)) return null;
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.5;
  return (
    <span className={`font-mono font-bold ${flat ? 'text-slate-700' : up ? 'text-sky-700' : 'text-red-600'}`}>
      {flat ? '·' : up ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
    </span>
  );
}

function CustomTooltip({ active, payload, avgQty }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const vsAvg = avgQty ? ((row.quantity - avgQty) / avgQty) * 100 : null;
  const gap = row.avgActualCycleSeconds != null && row.theoreticalCycleSeconds
    ? row.avgActualCycleSeconds - row.theoreticalCycleSeconds : null;
  return (
    <div className="bg-white border border-blue-600/30 rounded-lg px-3 py-2 text-fs-14 font-mono shadow-xl shadow-slate-300/50 min-w-[200px]">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200">
        <span className="text-black font-bold">{fmtDate(row.date)}</span>
        <span className="text-slate-700 font-bold">{row.quantity} pcs</span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-1.5"><span className="text-slate-700 font-semibold">actual avg</span><span className="text-sky-700 font-bold">{fmtSeconds(row.avgActualCycleSeconds)}</span></div>
        {row.theoreticalCycleSeconds != null && (
          <div className="flex justify-between gap-1.5"><span className="text-slate-700 font-semibold">theoretical</span><span className="text-slate-700 font-bold">{fmtSeconds(row.theoreticalCycleSeconds)}</span></div>
        )}
        {gap != null && (
          <div className="flex justify-between gap-1.5"><span className="text-slate-700 font-semibold">gap vs theory</span>
            <span className={`font-bold ${gap > 0 ? 'text-red-600' : 'text-sky-700'}`}>{gap > 0 ? '+' : ''}{fmtSeconds(Math.abs(gap))}</span></div>
        )}
        {vsAvg != null && (
          <div className="flex justify-between gap-1.5 pt-1 mt-1 border-t border-slate-200"><span className="text-slate-700 font-semibold">qty vs range avg</span><Trend delta={vsAvg} /></div>
        )}
      </div>
      {row.distinctModels > 0 && <div className="text-slate-700 font-semibold mt-2 pt-2 border-t border-slate-200">{row.distinctModels} model(s)</div>}
    </div>
  );
}

const Chip = ({ label, children, tone = 'border-slate-200 bg-white text-black' }) => (
  <div className={`rounded-lg border px-2.5 py-1 ${tone}`}>
    <div className="text-fs-11 font-bold text-slate-600 leading-none">{label}</div>
    <div className="mt-0.5 text-fs-16 font-black font-mono tabular-nums leading-tight">{children}</div>
  </div>
);

export default function DailyTrendChart({ days, focusDate, onSelectDay }) {
  const stats = useMemo(() => {
    const withQty = (days || []).filter((d) => Number(d.quantity) > 0);
    if (!withQty.length) return null;
    const totalQty = withQty.reduce((s, d) => s + Number(d.quantity || 0), 0);
    const avgQty = totalQty / withQty.length;
    const withCycle = withQty.filter((d) => d.avgActualCycleSeconds != null && Number.isFinite(Number(d.avgActualCycleSeconds)));
    const avgCycle = withCycle.length ? withCycle.reduce((s, d) => s + Number(d.avgActualCycleSeconds), 0) / withCycle.length : null;
    const best = withQty.reduce((a, b) => (Number(b.quantity) > Number(a.quantity) ? b : a), withQty[0]);
    const worst = withQty.reduce((a, b) => (Number(b.quantity) < Number(a.quantity) ? b : a), withQty[0]);
    const last = withQty[withQty.length - 1];
    const prev = withQty.length > 1 ? withQty[withQty.length - 2] : null;
    const dayOverDay = prev && Number(prev.quantity) > 0 ? ((Number(last.quantity) - Number(prev.quantity)) / Number(prev.quantity)) * 100 : null;
    return { totalQty, avgQty, avgCycle, best, worst, last, dayOverDay };
  }, [days]);

  const hasTheoretical = (days || []).some((d) => d.theoreticalCycleSeconds != null && Number.isFinite(Number(d.theoreticalCycleSeconds)));

  const chartData = useMemo(() => (days || []).map((d) => ({
    ...d,
    quantity: Number(d.quantity || 0),
    avgActualCycleSeconds: d.avgActualCycleSeconds == null ? null : Number(d.avgActualCycleSeconds),
    theoreticalCycleSeconds: d.theoreticalCycleSeconds == null ? null : Number(d.theoreticalCycleSeconds),
  })), [days]);

  // Quantity axis: base 1000, step 200 (0 always shown). Ticks extend to the highest day.
  // Axis starts at 1000 (or lower if a day is below 1000), step 200.
  const qtyAxis = useMemo(() => qtyAxisFor(chartData.map((d) => d.quantity), 1000, 200, { maxTicks: 9 }), [chartData]);

  const tick = { fill: '#334155', fontSize: fs(13), fontWeight: 700, fontFamily: '"IBM Plex Mono", ui-monospace, monospace' };

  return (
    <section className="w-full h-full min-h-0 flex flex-col bg-white border-2 border-slate-300 rounded-xl shadow-sm shadow-slate-200/70 overflow-hidden">
      {/* Compact header: title + stats in one row */}
      <div className="shrink-0 px-3 pt-2.5 pb-2 border-b-2 border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pr-9">
          <div className="min-w-0">
            <h2 className="text-fs-18 font-extrabold tracking-tight text-black leading-tight">Daily Production Trend</h2>
            
          </div>
          {stats && (
            <div className="flex flex-wrap gap-1.5">
              <Chip label="Total scans">{stats.totalQty}</Chip>
              <Chip label="Daily avg">{Math.round(stats.avgQty)}</Chip>
              {stats.avgCycle != null && <Chip label="Avg cycle" tone="border-sky-200 bg-sky-50/60 text-sky-800">{fmtSeconds(stats.avgCycle)}</Chip>}
              {stats.dayOverDay != null && <Chip label="Day / day"><Trend delta={stats.dayOverDay} /></Chip>}
            </div>
          )}
        </div>
      </div>

      {/* Chart: guaranteed height (was collapsing to 0 inside the grid) */}
      <div className="w-full flex-1 min-h-[280px] px-3 py-2">
        <ResponsiveContainer width="100%" height="100%" minHeight={280}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="dailyQtyActive" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--navy))" stopOpacity={1} /><stop offset="100%" stopColor="rgb(var(--navy))" stopOpacity={0.9} /></linearGradient>
              <linearGradient id="dailyQtyNormal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--blue-400))" stopOpacity={0.95} /><stop offset="100%" stopColor="rgb(var(--blue-400))" stopOpacity={0.8} /></linearGradient>
              <linearGradient id="dailyQtyBest" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#12866F" stopOpacity={0.95} /><stop offset="100%" stopColor="#12866F" stopOpacity={0.8} /></linearGradient>
            </defs>
            <CartesianGrid stroke="#CBD5E1" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={tick} axisLine={{ stroke: '#CBD5E1' }} tickLine={false} interval="preserveStartEnd" padding={{ left: 12, right: 12 }} />
            <YAxis yAxisId="qty" tick={tick} axisLine={false} tickLine={false} width={64} allowDecimals={false} interval={0}
              ticks={qtyAxis.ticks} domain={qtyAxis.domain} allowDataOverflow tickFormatter={(v) => v.toLocaleString()} />
            <YAxis yAxisId="cycle" orientation="right" tickFormatter={(v) => fmtSeconds(v)} tick={{ ...tick, fill: '#9A3412' }} axisLine={false} tickLine={false} width={72} />
            <Tooltip content={<CustomTooltip avgQty={stats?.avgQty} />} cursor={{ fill: 'rgba(6, 182, 212, 0.06)' }} />
            <Legend verticalAlign="top" align="right" iconType="plainline"
              wrapperStyle={{ fontSize: fs(12), fontWeight: 700, fontFamily: '"IBM Plex Mono", ui-monospace, monospace', color: '#334155', paddingBottom: 8, lineHeight: '18px' }} />
            {stats?.avgQty != null && (
              <ReferenceLine yAxisId="qty" y={stats.avgQty} stroke="#64748B" strokeDasharray="5 5" strokeWidth={1.5}
                label={{ value: `Avg ${Math.round(stats.avgQty)}`, position: 'insideTopRight', fill: '#334155', fontSize: fs(12), fontWeight: 700 }} />
            )}
            <Bar yAxisId="qty" dataKey="quantity" name="Quantity" radius={[5, 5, 1, 1]} onClick={(d) => onSelectDay(d.date)} cursor="pointer" maxBarSize={58}>
              {chartData.map((d) => {
                const isFocus = d.date === focusDate;
                const isBest = stats && d.date === stats.best.date && !isFocus;
                return (
                  <Cell key={d.date}
                    fill={isFocus ? 'url(#dailyQtyActive)' : isBest ? 'url(#dailyQtyBest)' : d.quantity > 0 ? 'url(#dailyQtyNormal)' : '#E2E8F0'}
                    stroke={isFocus ? 'rgb(var(--red-600))' : 'transparent'}
                    strokeWidth={isFocus || isBest ? 1.5 : 0} />
                );
              })}
            </Bar>
            <Line yAxisId="cycle" type="monotone" dataKey="avgActualCycleSeconds" name="Actual cycle" stroke="#C2410C" strokeWidth={3}
              dot={{ r: 3.5, fill: '#C2410C', stroke: '#FFFFFF', strokeWidth: 1.5 }} activeDot={{ r: 6, fill: '#C2410C', stroke: '#FFFFFF', strokeWidth: 2 }} connectNulls />
            {hasTheoretical && (
              <Line yAxisId="cycle" type="monotone" dataKey="theoreticalCycleSeconds" name="Theoretical cycle" stroke="rgb(var(--navy))" strokeWidth={2.5} strokeDasharray="6 4"
                dot={{ r: 3, fill: 'rgb(var(--navy))', stroke: '#FFFFFF', strokeWidth: 1 }} activeDot={{ r: 5, fill: 'rgb(var(--navy))', stroke: '#FFFFFF', strokeWidth: 1.5 }} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {stats && (
        <div className="shrink-0 border-t-2 border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fs-13 font-mono">
            <span className="flex items-center gap-1.5"><i className="inline-block w-2 h-2 rounded-full bg-sky-500" /><span className="text-slate-800 font-semibold">Highest:</span><b className="text-sky-700">{fmtDate(stats.best.date)} · {stats.best.quantity}</b></span>
            <span className="flex items-center gap-1.5"><i className="inline-block w-2 h-2 rounded-full bg-red-500" /><span className="text-slate-800 font-semibold">Lowest:</span><b className="text-red-700">{fmtDate(stats.worst.date)} · {stats.worst.quantity}</b></span>
          </div>
        </div>
      )}
    </section>
  );
}
