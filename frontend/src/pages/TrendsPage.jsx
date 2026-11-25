import { fs } from '../theme';
import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell, Legend } from 'recharts';
import { fmtSeconds, fmtDate } from '../api';
import { Card, Stat, PageLoading } from '../components/UiKit';
import { SpcChart } from '../components/ChartKit';
import { spc, movingAvg, PAL } from '../utils/stats';

const tick = { fontSize: fs(11), fill: '#64748B' };
const grid = <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export default function TrendsPage({ a, summary, takt, focusDate, loading, error }) {
  if (!a) return <PageLoading loading={loading} error={error} />;
  const days = a.daily;
  const rejByDay = Object.fromEntries(a.rejection.daily.map((d) => [d.date, d.rate]));
  const data = days.map((d) => ({
    label: fmtDate(d.date), qty: d.qty, mean: d.mean, rej: rejByDay[d.date] ?? 0, stop: Math.round((d.idleSeconds || 0) / 60),
  }));
  const qtys = data.map((d) => d.qty);
  const mean = avg(qtys);
  const ma = movingAvg(qtys, 3);
  const dev = data.map((d, i) => ({ ...d, ma: ma[i], dev: mean ? ((d.qty - mean) / mean) * 100 : 0 }));
  const best = [...data].sort((x, y) => y.qty - x.qty)[0];
  const worst = [...data].filter((d) => d.qty > 0).sort((x, y) => x.qty - y.qty)[0];

  const dayChart = spc(days.map((d) => d.mean));
  const hrRows = (summary?.hours || []).filter((h) => h.hour >= 9 && h.hour < 21 && h.avgActualCycleSeconds != null);
  const hrChart = spc(hrRows.map((h) => h.avgActualCycleSeconds));
  const taktV = takt.taktSec > 0 ? Number(takt.taktSec) : null;

  return (
    <div className={`space-y-3 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Stat label="Days" value={days.length} sub={`${a.startDate} → ${a.endDate}`} />
        <Stat label="Avg daily qty" value={mean.toFixed(0)} bar="bg-slate-500" tone="text-slate-700" />
        <Stat label="Best day" value={best ? best.qty : '—'} sub={best?.label} bar="bg-sky-500" tone="text-sky-600" />
        <Stat label="Weakest day" value={worst ? worst.qty : '—'} sub={worst?.label} bar="bg-red-500" tone="text-red-600" />
        <Stat label="SPC signals (daily)" value={dayChart ? dayChart.outCount + dayChart.runCount : '—'} sub="outside limits + runs" tone={dayChart && dayChart.outCount ? 'text-red-600' : ''} bar="bg-blue-500" />
        <Stat label="Rejection (range)" value={`${a.rejection.rate}%`} sub={`${a.rejection.total} scans`} tone={a.rejection.rate > 2 ? 'text-red-600' : ''} bar="bg-red-500" />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Daily output & cycle time" formula="avg cycle(day) = Σ valid gaps ÷ count of valid gaps · qty = scans of the day">
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              {grid}<XAxis dataKey="label" tick={tick} tickLine={false} />
              <YAxis yAxisId="q" tick={tick} tickLine={false} axisLine={false} />
              <YAxis yAxisId="c" orientation="right" tick={tick} tickLine={false} axisLine={false} tickFormatter={fmtSeconds} />
              <Tooltip formatter={(v, n) => (n === 'Avg cycle' ? fmtSeconds(v) : v)} /><Legend wrapperStyle={{ fontSize: fs(12) }} />
              <Bar yAxisId="q" dataKey="qty" name="Qty" fill={PAL.blue} radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Line yAxisId="c" type="monotone" dataKey="mean" name="Avg cycle" stroke={PAL.teal} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              {taktV && <ReferenceLine yAxisId="c" y={taktV} stroke={PAL.red} strokeDasharray="6 3" label={{ value: `Takt ${fmtSeconds(taktV)}`, fill: PAL.red, fontSize: fs(11), position: 'insideTopRight' }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Rejection rate & line idle" sub="Quality aur downtime ka daily trend" formula="rejection % = false scans ÷ (good scans + false scans) · idle = Σ (no-scan intervals ≥ idle threshold) ÷ 60, each stop counted once">
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              {grid}<XAxis dataKey="label" tick={tick} tickLine={false} />
              <YAxis yAxisId="s" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}m`} />
              <YAxis yAxisId="r" orientation="right" tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip /><Legend wrapperStyle={{ fontSize: fs(12) }} />
              <Bar yAxisId="s" dataKey="stop" name="Line idle (min)" fill={PAL.amber} radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Line yAxisId="r" type="monotone" dataKey="rej" name="Rejection %" stroke={PAL.red} strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="SPC — daily average cycle (I-chart)"
          formula="CL = mean of daily means · σ = avg|moving range| ÷ 1.128 · UCL/LCL = CL ± 3σ · red = outside limits · amber = 7 points ek side">
          <SpcChart labels={data.map((d) => d.label)} result={dayChart} />
        </Card>
        <Card title={`SPC — hourly average cycle (${focusDate})`}
          formula="same I-chart on the 09–21 hourly averages of the focus day">
          <SpcChart labels={hrRows.map((h) => h.label.slice(0, 5))} result={hrChart} />
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Quantity vs 3-day moving average" sub="Noise hata kar real trend" formula="MA3(t) = (qty[t] + qty[t−1] + qty[t−2]) ÷ 3 · dashed line = average of all days">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={dev} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              {grid}<XAxis dataKey="label" tick={tick} tickLine={false} /><YAxis tick={tick} tickLine={false} axisLine={false} />
              <Tooltip /><Legend wrapperStyle={{ fontSize: fs(12) }} />
              <Bar dataKey="qty" name="Qty" fill="#93C5FD" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Line type="monotone" dataKey="ma" name="3-day MA" stroke={PAL.violet} strokeWidth={2.5} dot={false} connectNulls />
              <ReferenceLine y={mean} stroke={PAL.green} strokeDasharray="5 3" label={{ value: `Avg ${mean.toFixed(0)}`, fill: PAL.green, fontSize: fs(11), position: 'insideTopRight' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Day vs average (%)" formula="deviation % = (qty − average daily qty) ÷ average daily qty × 100">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={dev} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              {grid}<XAxis dataKey="label" tick={tick} tickLine={false} /><YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} /><ReferenceLine y={0} stroke="#94A3B8" />
              <Bar dataKey="dev" name="Deviation" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {dev.map((d, i) => <Cell key={i} fill={d.dev >= 0 ? PAL.green : PAL.red} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
