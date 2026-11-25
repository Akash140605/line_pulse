import React from 'react';
import { fmtDate, fs } from '../theme';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { Settings2, CheckCircle2, AlertTriangle, XOctagon, Info } from 'lucide-react';
import { fmtSeconds } from '../api';

const STATUS = {
  ok: ['OK', 'bg-sky-100 text-sky-700'], watch: ['Watch', 'bg-slate-100 text-slate-700'],
  behind: ['Behind', 'bg-red-100 text-red-700'], idle: ['Idle', 'bg-slate-200 text-slate-600'], future: ['Upcoming', 'bg-slate-100 text-slate-600'],
};
const LEVEL = {
  bad: ['border-l-red-500 bg-red-50/60', XOctagon, 'text-red-600'], warn: ['border-l-slate-500 bg-slate-50/60', AlertTriangle, 'text-slate-600'],
  info: ['border-l-blue-500 bg-blue-50/60', Info, 'text-blue-600'], good: ['border-l-sky-500 bg-sky-50/60', CheckCircle2, 'text-sky-600'],
};
const n1 = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));

function Chip({ s }) {
  const [t, c] = STATUS[s] || STATUS.ok;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-fs-12 font-extrabold ${c}`}>{t}</span>;
}

function Kpi({ label, value, sub, tone = 'text-slate-900', bar = 'bg-blue-600' }) {
  return (
    <div className="relative bg-white border border-slate-200 rounded-xl p-3 shadow-sm overflow-hidden min-h-[92px]">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${bar}`} />
      <div className="text-fs-12 uppercase tracking-wide font-extrabold text-slate-600">{label}</div>
      <div className={`font-mono text-fs-28 font-extrabold leading-tight mt-1 ${tone}`}>{value}</div>
      {sub && <div className="text-fs-13 font-semibold text-slate-600 mt-1 leading-tight">{sub}</div>}
    </div>
  );
}

function Panel({ title, sub, children, className = '' }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-3 ${className}`}>
      <h3 className="text-fs-16 font-extrabold text-slate-950">{title}</h3>
      {sub && <p className="text-fs-13 text-slate-600 font-medium mb-2">{sub}</p>}
      {children}
    </div>
  );
}

const axis = { fontSize: fs(13), fill: '#64748B' };

export default function AnalysisView({ analysis, focusDate, onOpenSettings, busy }) {
  if (!analysis) return <div className="bg-white border border-slate-200 rounded-xl py-16 text-center text-fs-14 font-semibold text-slate-600">Loading analysis…</div>;
  const { kpis: k, hours, modelRows, insights } = analysis;
  const hasTakt = !!k.takt;
  const chartData = hours.map((h) => ({ ...h, avgChart: h.future ? null : h.avg }));

  return (
    <div className={`space-y-3 transition-opacity ${busy ? 'opacity-70' : ''}`}>
      {/* takt banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-dixon-navy text-white px-4 py-3 shadow-sm">
        <div>
          <div className="text-fs-12 uppercase tracking-wide text-sky-200 font-bold">{fmtDate(focusDate)}{k.live ? ' · LIVE' : ''}</div>
          <div className="text-fs-20 font-extrabold">
            {hasTakt ? <>Takt {fmtSeconds(k.takt)} <span className="text-sky-200 font-semibold text-fs-16">· target {k.target} pcs · {(k.availSec / 3600).toFixed(1)} hr available</span></>
              : 'Takt is not set — the analysis is based on the theoretical cycle time'}
          </div>
        </div>
        {onOpenSettings && (
          <button onClick={onOpenSettings} className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 px-3 py-2 text-fs-14 font-extrabold">
            <Settings2 size={14} /> {hasTakt ? 'Edit takt' : 'Set takt'}
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-9 gap-2">
        <Kpi label="Produced" value={k.qty} sub={k.outsideQty ? `+${k.outsideQty} not in an hour` : k.extraQty ? `incl. ${k.extraQty} before 09 / after 21` : 'all hours of the day'} bar="bg-slate-500" tone="text-slate-700" />
        <Kpi label={k.live ? 'Plan till now' : 'Target'} value={hasTakt ? Math.round(k.live ? k.planToNow : k.target) : '—'} sub={hasTakt ? `Full day ${k.target}` : 'Takt required'} bar="bg-slate-400" />
        <Kpi label="Achievement" value={k.achievement !== null ? `${k.achievement.toFixed(0)}%` : '—'} sub={k.live ? 'vs plan till now' : 'vs full target'}
          tone={k.achievement === null ? '' : k.achievement >= 100 ? 'text-sky-600' : k.achievement >= 90 ? 'text-slate-600' : 'text-red-600'} bar="bg-sky-500" />
        <Kpi label="Avg cycle (actual)" value={fmtSeconds(k.avgActual)} sub="Scan-gap average" tone="text-sky-700" bar="bg-sky-500" />
        <Kpi label="Cycle vs takt" value={k.cycleVsTakt !== null ? `${k.cycleVsTakt.toFixed(0)}%` : '—'} sub={hasTakt ? (k.cycleVsTakt <= 100 ? 'Faster than takt' : 'Slower than takt') : 'Takt required'}
          tone={k.cycleVsTakt === null ? '' : k.cycleVsTakt <= 100 ? 'text-sky-600' : 'text-red-600'} bar="bg-blue-500" />
        <Kpi label="Demonstrated takt" value={fmtSeconds(k.demonstratedTakt)} sub="Window time ÷ qty" bar="bg-sky-500" />
        <Kpi label="Line idle" value={k.idleSec ? `${Math.round(k.idleSec / 60)} min` : '0 min'} sub={`${k.idleGaps} stops (no scan)`} tone={k.idleSec >= 1800 ? 'text-red-600' : 'text-slate-900'} bar="bg-slate-500" />
        <Kpi label="Utilization" value={k.utilization !== null ? `${k.utilization.toFixed(0)}%` : '—'} sub={`${k.activeHours} active hr`} bar="bg-blue-500" />
        <Kpi label={k.live ? 'Projected EOD' : 'Theoretical'} value={k.live ? (k.projected ?? '—') : fmtSeconds(k.theoretical)} sub={k.live ? `at current rate` : '3600 ÷ qty/hr'}
          tone={k.live && hasTakt && k.projected !== null ? (k.projected >= k.target ? 'text-sky-600' : 'text-red-600') : ''} bar="bg-red-500" />
      </div>

      {/* insights */}
      <Panel title="Automatic review — key findings">
        <div className="grid gap-2 lg:grid-cols-2">
          {insights.map((i, idx) => {
            const [box, Icon, ic] = LEVEL[i.level];
            return (
              <div key={idx} className={`border-l-4 rounded-md px-3 py-2 ${box}`}>
                <div className="flex items-start gap-2"><Icon size={15} className={`mt-0.5 shrink-0 ${ic}`} />
                  <div><div className="text-fs-14 font-extrabold text-slate-900 leading-snug">{i.title}</div>
                    <div className="text-fs-13 text-slate-600 font-medium leading-snug mt-0.5">{i.detail}</div></div></div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* charts */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Cumulative output — actual vs plan">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
              <YAxis yAxisId="h" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis yAxisId="c" orientation="right" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip /><Legend wrapperStyle={{ fontSize: fs(13) }} />
              <Bar yAxisId="h" dataKey="qty" name="Hourly qty" fill="rgb(var(--blue-600))" radius={[4, 4, 0, 0]} maxBarSize={34} />
              {hasTakt && <Line yAxisId="h" type="monotone" dataKey="plan" name="Hourly plan" stroke="#F2A93B" strokeDasharray="5 3" dot={false} strokeWidth={2} />}
              <Line yAxisId="c" type="monotone" dataKey="cumActual" name="Cumulative actual" stroke="#01B8AA" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              {hasTakt && <Line yAxisId="c" type="monotone" dataKey="cumPlan" name="Cumulative plan" stroke="rgb(var(--red-600))" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Cycle time vs takt — hour-wise">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
              <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={fmtSeconds} />
              <Tooltip formatter={(v) => fmtSeconds(v)} /><Legend wrapperStyle={{ fontSize: fs(13) }} />
              <Bar dataKey="avgChart" name="Actual cycle" fill="#01B8AA" radius={[4, 4, 0, 0]} maxBarSize={34} />
              <Line type="monotone" dataKey="theoretical" name="Theoretical" stroke="#F2A93B" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
              {hasTakt && <ReferenceLine y={k.takt} stroke="rgb(var(--red-600))" strokeWidth={2} strokeDasharray="6 3" label={{ value: `Takt ${fmtSeconds(k.takt)}`, fill: 'rgb(var(--red-600))', fontSize: fs(13), position: 'insideTopRight' }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* hour table */}
      <Panel title="Hour-wise review">
        <div className="overflow-x-auto"><table className="w-full text-fs-13">
          <thead><tr className="text-slate-600 uppercase tracking-wide text-left border-b border-slate-200">
            {['Hour', 'Qty', 'Plan', 'Qty %', 'Avg cycle', 'Min', 'Max', 'Avg vs takt', 'Models', 'Status'].map((h) => <th key={h} className="px-2 py-2 font-bold whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>{hours.map((h) => (
            <tr key={h.hour} className="border-b border-slate-100 font-mono">
              <td className="px-2 py-1.5 font-bold sticky left-0 z-[1] bg-white">{h.label}{h.partial ? ' ●' : ''}</td><td className="px-2">{h.qty}</td><td className="px-2">{n1(h.plan, 1)}</td>
              <td className={`px-2 ${h.qtyPct !== null && h.qtyPct < 90 ? 'text-red-600' : ''}`}>{h.qtyPct !== null ? `${h.qtyPct.toFixed(0)}%` : '—'}</td>
              <td className="px-2 font-bold text-sky-700">{fmtSeconds(h.avg)}</td><td className="px-2">{fmtSeconds(h.min)}</td><td className="px-2">{fmtSeconds(h.max)}</td>
              <td className={`px-2 ${h.gapVsTakt > 0 ? 'text-red-600' : h.gapVsTakt < 0 ? 'text-sky-600' : ''}`}>{h.gapVsTakt === null ? '—' : `${h.gapVsTakt > 0 ? '+' : ''}${fmtSeconds(Math.abs(h.gapVsTakt))}`}</td>
              <td className="px-2">{h.models || '—'}</td><td className="px-2 font-sans"><Chip s={h.status} /></td>
            </tr>))}</tbody>
        </table></div>
      </Panel>

      {/* model table */}
      <Panel title="Model-wise review (selected range)">
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto"><table className="w-full text-fs-13">
          <thead className="sticky top-0 bg-white"><tr className="text-slate-600 uppercase tracking-wide text-left border-b border-slate-200">
            {['Model', 'Qty', 'Avg cycle', 'Takt', 'Cycle ÷ takt', 'Lost time', 'Longest gap', 'Status'].map((h) => <th key={h} className="px-2 py-2 font-bold whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {modelRows.length === 0 && <tr><td colSpan={8} className="text-center text-slate-600 py-6">No models in range</td></tr>}
            {modelRows.map((m) => (
              <tr key={m.mmId} className="border-b border-slate-100 font-mono">
                <td className="px-2 py-1.5 font-bold sticky left-0 z-[1] bg-white whitespace-nowrap">{m.model}{m.code ? <span className="text-slate-600 font-normal"> ({m.code})</span> : null}</td>
                <td className="px-2">{m.qty}</td><td className="px-2 font-bold text-sky-700">{fmtSeconds(m.avg)}</td>
                <td className="px-2">{m.takt ? <>{fmtSeconds(m.takt)}{m.ownTakt && <span className="text-blue-600"> ✎</span>}</> : '—'}</td>
                <td className={`px-2 ${m.ratio > 1 ? 'text-red-600' : ''}`}>{m.ratio !== null ? `${(m.ratio * 100).toFixed(0)}%` : '—'}</td>
                <td className="px-2">{m.lostSec !== null ? `${m.lostSec > 0 ? '+' : ''}${(m.lostSec / 60).toFixed(0)} min` : '—'}</td>
                <td className={`px-2 ${m.longGap ? 'text-slate-600 font-bold' : ''}`}>{fmtSeconds(m.max)}</td>
                <td className="px-2 font-sans"><Chip s={m.status} /></td>
              </tr>))}
          </tbody>
        </table></div>
      </Panel>
    </div>
  );
}
