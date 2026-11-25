import { fs } from '../theme';
import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell, LineChart,
} from 'recharts';
import { fmtSeconds } from '../api';
import { PAL, buildBins } from '../utils/stats';
import useMediaQuery from '../hooks/useMediaQuery';

const tick = { fontSize: fs(12), fill: '#64748B' };
const grid = <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />;

function Tip({ active, payload, rows }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-xl px-2.5 py-2 text-fs-13 font-mono min-w-[150px]">
      <div className="font-extrabold text-slate-900 mb-1">{p.name ?? p.label}</div>
      {rows(p).filter(Boolean).map(([k, v, c]) => (
        <div key={k} className="flex justify-between gap-3"><span className="text-slate-600">{k}</span><span className={c || 'text-slate-900'}>{v}</span></div>
      ))}
    </div>
  );
}

/** Pareto: bars (value, coloured by ABC class) + cumulative % line + 80 % reference. Click a bar to filter by it. */
export function ParetoChart({ data, valueName = 'Qty', fmt = (v) => v, onPick, height = 300, color = PAL.blue }) {
  if (!data.length) return <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">No data</div>;
  const fill = (c) => (c === 'A' ? color : c === 'B' ? PAL.amber : '#CBD5E1');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: -6, bottom: 4 }}>
        {grid}
        <XAxis dataKey="name" tick={tick} interval={0} angle={-30} textAnchor="end" height={64} tickLine={false} />
        <YAxis yAxisId="v" tick={tick} tickLine={false} axisLine={false} tickFormatter={fmt} />
        <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={tick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
        <Tooltip content={<Tip rows={(p) => [[valueName, fmt(p.value)], ['Share', `${p.pct.toFixed(1)}%`], ['Cumulative', `${p.cumPct.toFixed(1)}%`], ['Class', p.cls, p.cls === 'A' ? 'text-blue-700' : p.cls === 'B' ? 'text-slate-600' : 'text-slate-600']]} />} />
        <ReferenceLine yAxisId="p" y={80} stroke={PAL.red} strokeDasharray="5 3" label={{ value: '80%', position: 'right', fill: PAL.red, fontSize: fs(12) }} />
        <Bar yAxisId="v" dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={42} cursor={onPick ? 'pointer' : 'default'} onClick={(d) => onPick && d?.id != null && onPick(d)}>
          {data.map((d, i) => <Cell key={i} fill={fill(d.cls)} />)}
        </Bar>
        <Line yAxisId="p" type="monotone" dataKey="cumPct" stroke={PAL.violet} strokeWidth={2} dot={{ r: 3, fill: PAL.violet }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Histogram of cycle times. markers = [{ value, label, color }] drawn as vertical lines; bins above `limit` turn red. */
export function HistogramChart({ counts, width, markers = [], limit, height = 280, color = PAL.teal }) {
  const bins = buildBins(counts || [], width || 1);
  if (!bins.length || bins.every((b) => b.count === 0)) return <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">No cycle data</div>;
  const last = bins.length - 1;
  const labelFor = (v) => bins[Math.min(Math.floor(v / width), last)].label;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={bins} margin={{ top: 18 + 14 * Math.max(0, markers.filter((m) => m.value != null).length - 1), right: 8, left: -8, bottom: 4 }} barCategoryGap={1}>
        {grid}
        <XAxis dataKey="label" tick={tick} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<Tip rows={(p) => [['Cycle (s)', p.label], ['Count', p.count], ['Share', `${p.pct.toFixed(1)}%`]]} />} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={1000}>{/* a histogram: bars touch, never capped */}
          {bins.map((b, i) => <Cell key={i} fill={limit && b.from >= limit ? PAL.red : color} />)}
        </Bar>
        {/* 25-11-2026: mean / median / P95 labels one above the other, never on top of each other */}
        {markers.filter((m) => m.value != null).map((m, i) => (
          <ReferenceLine key={m.label} x={labelFor(m.value)} stroke={m.color} strokeWidth={2} strokeDasharray="5 3"
            label={{ value: m.label, position: 'top', offset: 5 + 14 * i, fill: m.color, fontSize: fs(12), fontWeight: 700 }} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Model-wise spread: P10 → median → P90 bars (min / max / mean in tooltip), takt as a vertical line. */
export function ModelRangeChart({ rows, takt }) {
  const narrow = useMediaQuery('(max-width: 640px)');
  if (!rows.length) return <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">No data</div>;
  const data = rows.map((r) => ({ ...r, name: r.model, base: r.p10, lo: Math.max(0, r.median - r.p10), hi: Math.max(0, r.p90 - r.median) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 30 + 50)}>
      <ComposedChart layout="vertical" data={data} margin={{ top: 8, right: 24, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" horizontal={false} />
        <XAxis type="number" tick={tick} tickLine={false} tickFormatter={fmtSeconds} />
        <YAxis type="category" dataKey="name" width={narrow ? 92 : 118} tick={{ ...tick, fontFamily: 'monospace', fontSize: narrow ? fs(10.5) : tick.fontSize }} tickLine={false} axisLine={false}
          tickFormatter={(v) => (narrow && String(v).length > 11 ? `${String(v).slice(0, 10)}…` : v)} />
        <Tooltip content={<Tip rows={(p) => [['P10', fmtSeconds(p.p10)], ['Median', fmtSeconds(p.median), 'text-sky-700'], ['Mean', fmtSeconds(p.mean)], ['P90', fmtSeconds(p.p90)], ['Min / Max', `${fmtSeconds(p.min)} / ${fmtSeconds(p.max)}`], ['CV', p.cv != null ? `${p.cv}%` : '—'], ['Valid cycles', p.n]]} />} />
        <Bar dataKey="base" stackId="r" fill="transparent" />
        <Bar dataKey="lo" stackId="r" fill="#7DD3C8" name="P10 → Median" />
        <Bar dataKey="hi" stackId="r" fill={PAL.teal} name="Median → P90" />
        {takt > 0 && <ReferenceLine x={takt} stroke={PAL.red} strokeWidth={2} strokeDasharray="6 3" label={{ value: `Takt ${fmtSeconds(takt)}`, position: 'top', fill: PAL.red, fontSize: fs(12) }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function SpcDot({ cx, cy, payload }) {
  if (cx == null || cy == null || payload?.v == null) return null;
  const bad = payload.out, warn = payload.run;
  return <circle cx={cx} cy={cy} r={bad ? 6 : warn ? 5 : 3.5} fill={bad ? PAL.red : warn ? PAL.amber : PAL.blue} stroke="#fff" strokeWidth={1.5} />;
}

/** I-chart with centre line and ±3σ limits. out-of-limit points = red, 7-point runs = amber. */
export function SpcChart({ labels, result, height = 260, fmt = fmtSeconds }) {
  const narrow = useMediaQuery('(max-width: 640px)');
  if (!result) return <div className="py-10 text-center text-fs-14 text-slate-600 font-semibold">At least 3 points needed</div>;
  const data = result.points.map((p, i) => ({ ...p, label: labels[i], name: labels[i] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: narrow ? 8 : 64, left: -4, bottom: 4 }}>
        {grid}
        <XAxis dataKey="label" tick={tick} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={tick} tickLine={false} axisLine={false} tickFormatter={fmt} domain={[(d) => Math.max(0, Math.floor(Math.min(d, result.lcl) * 0.95)), (d) => Math.ceil(Math.max(d, result.ucl) * 1.05)]} />
        <Tooltip content={<Tip rows={(p) => [['Value', fmt(p.v)], p.out ? ['Signal', 'Outside limits', 'text-red-600'] : p.run ? ['Signal', '7-point run', 'text-slate-600'] : null]} />} />
        <ReferenceLine y={result.ucl} stroke={PAL.red} strokeDasharray="5 3" label={{ value: narrow ? 'UCL' : `UCL ${fmt(result.ucl)}`, position: narrow ? 'insideTopRight' : 'right', fill: PAL.red, fontSize: fs(12) }} />
        <ReferenceLine y={result.mean} stroke={PAL.green} label={{ value: narrow ? 'CL' : `CL ${fmt(result.mean)}`, position: narrow ? 'insideTopRight' : 'right', fill: PAL.green, fontSize: fs(12) }} />
        <ReferenceLine y={result.lcl} stroke={PAL.red} strokeDasharray="5 3" label={{ value: narrow ? 'LCL' : `LCL ${fmt(result.lcl)}`, position: narrow ? 'insideBottomRight' : 'right', fill: PAL.red, fontSize: fs(12) }} />
        <Line type="monotone" dataKey="v" stroke={PAL.blue} strokeWidth={1.8} dot={<SpcDot />} activeDot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ values, color = PAL.blue, w = 72, h = 22 }) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return <span className="text-slate-300">—</span>;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = values.map((x, i) => (x == null ? null : `${(i / (values.length - 1)) * w},${h - 2 - ((x - min) / span) * (h - 4)}`)).filter(Boolean).join(' ');
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" /></svg>;
}
