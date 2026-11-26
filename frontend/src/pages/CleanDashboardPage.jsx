import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHeaderSlot } from '../components/HeaderBar';
import { ComposedChart, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { ChevronRight, X } from 'lucide-react';
import { PageLoader } from '../components/Loader';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, oleSum, issuesOf, groupIssues, rcaStatus, needsRca, lossSummary, hoursOf, okFrom, watchFrom, hm, goodOf } from '../utils/ole';
import { LINE_COLOR, nf, dmy, p2, useOleLines, groupNameOf, useOleData, Gauge, band } from '../components/OleParts';
import { PeriodBar, periodKind } from '../components/PeriodBar';
import { openLossAnalysis } from '../utils/drillLink';

/*
 * Dashboard — the clean management view.
 *   No production or model lists: only the measures, each with HOW it is worked out, and a click on any of them opens
 *   its drill-down (line by line, then a line's days / hours).
 *   Top: OLE · Availability · Performance · Quality of all the lines together
 *   Line cards: OLE · A · P · Q, then Lost time · Idle time · Rejection · RCA open
 *   Below: the drill-down of the chosen measure.
 */
const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const pc = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const tone = (v) => (v == null ? 'text-slate-500' : v >= okFrom() ? 'text-emerald-700' : v >= watchFrom() ? 'text-amber-700' : 'text-red-700');
/** minutes → hours in the admin's time format (Setup → OLE formulas: "6.3 h" or "6h 18m") */
export const hms = (min) => hm(Math.max(0, Number(min) || 0));
const lost = (t) => (t?.lossMin || 0) + (t?.speedMin || 0);

/** The page's controls in the window's top bar (Header has an empty slot for them), on screens wide enough. */
export { useHeaderSlot };

/* the measures: what each one is, how it is worked out (formula with the numbers), how it is shown */
const MEASURES = {
  ole: { name: 'OLE', what: 'Overall line effectiveness', how: (t) => `A × P × Q = ${pc(t.A)} × ${pc(t.P)} × ${pc(t.Q ?? 1)}` },
  A: { name: 'Availability', what: 'Share of the planned time the line ran', how: (t) => `Run time ÷ Planned time = ${hms(t.actualMin)} ÷ ${hms(t.plannedMin)}` },
  P: { name: 'Performance', what: 'Std time of the pieces made ÷ the time they took', how: (t) => `Std time ÷ Run time = ${hms(t.stdSec / 60)} ÷ ${hms(t.actualMin)}` },
  Q: { name: 'Quality', what: 'Good pieces ÷ pieces made', how: (t) => `Good ÷ Made = ${nf(goodOf(t))} ÷ ${nf(t.qty)}` },
};

/** Overall: one panel — OLE gauge with its formula on the left, A / P / Q beside it (loss strip removed; losses are on each line card). */
function Hero({ t, sel, onPick, pendingN }) {
  const on = (k) => sel === k;
  const ring = (k) => (on(k) ? 'bg-blue-50 ring-2 ring-inset ring-blue-600' : 'hover:bg-slate-50');
  return (
    <section className={`${card} overflow-hidden`} aria-label="Overall measures">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,0.9fr)_repeat(3,minmax(0,1fr))]">
        <button type="button" onClick={() => onPick(on('ole') ? null : 'ole')} aria-pressed={on('ole')} aria-label={`OLE ${pc(t.ole)} — show details`}
          className={`flex flex-col items-center justify-center gap-1 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 text-center transition lg:border-b-0 lg:border-r ${ring('ole')}`}>
          <span className="text-fs-13 font-bold uppercase tracking-wider text-slate-500">Overall OLE</span>
          <Gauge value={t.ole} size={170} label="" />
          <span className="text-fs-13 text-slate-500">{MEASURES.ole.what}</span>
          <span className="rounded-md bg-white px-2 py-1 font-mono text-fs-13 font-semibold text-slate-700 ring-1 ring-slate-200" title="How it is worked out">{MEASURES.ole.how(t)}</span>
        </button>
        {['A', 'P', 'Q'].map((k, i) => {
          const M = MEASURES[k]; const v = t[k];
          return (
            <button key={k} type="button" onClick={() => onPick(on(k) ? null : k)} aria-pressed={on(k)} aria-label={`${M.name} ${pc(v)} — show details`}
              className={`group flex min-w-0 flex-col gap-2 p-4 text-left transition ${i < 2 ? 'border-b border-slate-200 lg:border-b-0 lg:border-r' : ''} ${ring(k)}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="text-fs-16 font-extrabold text-slate-900">{M.name}</span>
                <span className="inline-flex items-center gap-0.5 text-fs-12 font-bold text-blue-700">{on(k) ? 'Hide' : 'Details'}<ChevronRight size={14} className={`transition-transform ${on(k) ? 'rotate-90' : ''}`} aria-hidden /></span>
              </span>
              <span className={`font-mono text-fs-40 font-extrabold leading-none tabular-nums ${tone(v)}`}>{pc(v)}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (v ?? 0) * 100)}%`, background: band(v) }} /></span>
              <span className="text-fs-13 text-slate-500">{M.what}</span>
              <span className="mt-auto rounded-md bg-slate-50 px-2 py-1 font-mono text-fs-13 font-semibold text-slate-700" title="How it is worked out">{M.how(t)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** One line, same format as Overall but smaller: gauge + A / P / Q with formulas, and its losses. Every value opens its details for this line. */
function LineCard({ l, t, pendingN, sel, selLine, onPick }) {
  const on = (k) => sel === k && selLine === l;
  const pick = (k) => onPick(on(k) ? null : k, l);
  const hl = (k) => (on(k) ? 'bg-blue-50 ring-2 ring-inset ring-blue-600' : 'hover:bg-slate-50');
  return (
    <section className={`${card} flex min-w-0 flex-col overflow-hidden`} aria-label={`Line ${l} measures`} style={{ borderTop: `4px solid ${LINE_COLOR[l] || '#1D4ED8'}` }}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <h3 className="text-fs-17 font-extrabold text-slate-900">Line {l}</h3>
        <span className="text-fs-12 font-semibold text-slate-500">{nf(t.qty)} pcs made</span>
      </div>
      <div className="grid grid-cols-1 gap-0 sm:grid-cols-[auto_minmax(0,1fr)]">
        <button type="button" onClick={() => pick('ole')} aria-pressed={on('ole')} aria-label={`Line ${l} OLE ${pc(t.ole)} — show details`}
          className={`flex flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1 transition ${hl('ole')}`}>
          <Gauge value={t.ole} size={112} label="" />
          <span className="font-mono text-fs-11 font-semibold text-slate-500">A × P × Q</span>
        </button>
        <div className="flex min-w-0 flex-col gap-1 p-2">
          {['A', 'P', 'Q'].map((k) => {
            const M = MEASURES[k]; const v = t[k];
            return (
              <button key={k} type="button" onClick={() => pick(k)} aria-pressed={on(k)} aria-label={`Line ${l} ${M.name} ${pc(v)} — show details`}
                className={`flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1 text-left transition ${hl(k)}`}>
                <span className="flex items-baseline justify-between gap-2"><span className="text-fs-13 font-bold text-slate-700">{M.name}</span><span className={`font-mono text-fs-17 font-extrabold tabular-nums ${tone(v)}`}>{pc(v)}</span></span>
                <span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (v ?? 0) * 100)}%`, background: band(v) }} /></span>
                <span className="lp-clamp2 font-mono text-fs-11 text-slate-500" title={M.how(t)}>{M.how(t)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-auto grid grid-cols-4 border-t border-slate-200 bg-slate-50/60">
        {[['lost', 'Lost time', hms(lost(t)), lost(t) > 0], ['loss', 'Idle time', hms(t.lossMin), t.lossMin > 0], t.rejects > 0 ? ['rej', 'Rejection', `${nf(t.rejects)} pcs`, true] : ['rej', 'Rework', `${nf(t.rework || 0)} pcs`, (t.rework || 0) > 0], ['rca', 'RCA open', nf(pendingN), pendingN > 0]].map(([id, label, value, warn]) => (
          <button key={id} type="button" onClick={() => pick(id)} aria-pressed={on(id)} aria-label={`Line ${l} ${label} ${value} — show details`}
            className={`flex min-w-0 flex-col border-r border-slate-200 px-2 py-1.5 text-left transition last:border-r-0 ${hl(id)}`}>
            <span className="truncate text-fs-11 font-bold text-slate-500">{label}</span>
            <span className={`truncate font-mono text-fs-13 font-extrabold tabular-nums ${warn ? 'text-red-700' : 'text-slate-900'}`}>{value}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const th = 'px-2 py-1.5 text-left text-fs-13 font-semibold text-slate-500 whitespace-nowrap';
const td = 'px-2 py-1.5 font-mono text-fs-14 tabular-nums whitespace-nowrap';

/** columns of the drill-down table for a measure */
const COLS = {
  ole: [['Availability', (t) => pc(t.A), (t) => tone(t.A)], ['Performance', (t) => pc(t.P), (t) => tone(t.P)], ['Quality', (t) => pc(t.Q), (t) => tone(t.Q)], ['OLE', (t) => pc(t.ole), (t) => `font-extrabold ${tone(t.ole)}`]],
  A: [['Planned time', (t) => hms(t.plannedMin)], ['Down time', (t) => hms(t.lossMin), (t) => (t.lossMin ? 'text-red-700' : '')], ['Run time', (t) => hms(t.actualMin)], ['Availability', (t) => pc(t.A), (t) => `font-extrabold ${tone(t.A)}`]],
  P: [['Qty', (t) => nf(t.qty)], ['Std time', (t) => hms(t.stdSec / 60)], ['Run time', (t) => hms(t.actualMin)], ['Slow running', (t) => hms(t.speedMin), (t) => (t.speedMin ? 'text-red-700' : '')], ['Performance', (t) => pc(t.P), (t) => `font-extrabold ${tone(t.P)}`]],
  Q: [['Made', (t) => nf(t.qty)], ['Rejected', (t) => nf(t.rejects), (t) => (t.rejects ? 'text-red-700' : '')], ['Reworked', (t) => nf(t.rework || 0)], ['Good', (t) => nf(goodOf(t))], ['Quality', (t) => pc(t.Q), (t) => `font-extrabold ${tone(t.Q)}`]],
  lost: [['Idle time', (t) => hms(t.lossMin)], ['Slow running', (t) => hms(t.speedMin)], ['Lost time', (t) => hms(lost(t)), () => 'font-extrabold text-red-700']],
  loss: [['Idle time', (t) => hms(t.lossMin), (t) => (t.lossMin ? 'font-extrabold text-red-700' : '')], ['Planned time', (t) => hms(t.plannedMin)]],
  stop: [['Planned stop', (t) => hms(t.stopMin), () => 'font-extrabold'], ['Shift time', (t) => hms(t.totalMin)]],
  rej: [['Made', (t) => nf(t.qty)], ['Rejected', (t) => nf(t.rejects), (t) => (t.rejects ? 'font-extrabold text-red-700' : '')], ['Rework', (t) => nf(t.rework)]],
};
/** value plotted in the drill-down chart */
const PLOT = {
  ole: (t) => (t.ole == null || !(t.totalMin > 0) ? null : +(t.ole * 100).toFixed(1)),
  A: (t) => (t.A == null ? null : +(t.A * 100).toFixed(1)),
  P: (t) => (t.P == null ? null : +(t.P * 100).toFixed(1)),
  Q: (t) => (t.Q == null ? null : +(t.Q * 100).toFixed(1)),
  lost: (t) => Math.round(lost(t)), loss: (t) => Math.round(t.lossMin || 0), stop: (t) => Math.round(t.stopMin || 0), rej: (t) => t.rejects || 0,
};
const PCT = new Set(['ole', 'A', 'P', 'Q']);
const TITLE = { ole: 'OLE', A: 'Availability', P: 'Performance', Q: 'Quality', lost: 'Lost time', loss: 'Idle time', stop: 'Planned stop', rej: 'Rejection', rca: 'RCA open' };

function Drill({ id, R, IDS, oneDay, day, line, setLine, LS, issues, pending, onOpen, onClose, range = null, canDrill = false }) {
  const cols = COLS[id];
  // the slots of the chart / second table: hours of the day or days of the period, for all lines or one line
  const ids = line ? [line] : IDS;
  const slots = oneDay
    ? hoursOf(day?.byLine, ids).map((h) => ({ k: `${p2(h)}:00`, t: oleSum(ids.map((l) => day?.byLine[l]?.rows.find((r) => r.hour === h))) })).filter((x) => x.t.totalMin > 0 || x.t.qty > 0)
    : R.days.map((d) => ({ k: dmy(d.date).slice(0, 5), t: oleSum(ids.map((l) => d.byLine[l]?.total)) }));
  const data = slots.map((x) => ({ k: x.k, v: cols ? PLOT[id](x.t) : null }));
  const reasons = id === 'rej' ? LS.reason.filter((x) => x.unit === 'pcs' && x.value > 0)
    : id === 'stop' ? LS.reason.filter((x) => x.unit === 'min' && x.value > 0 && x.kind === '-')
      : ['lost', 'loss', 'A'].includes(id) ? LS.reason.filter((x) => x.unit === 'min' && x.value > 0 && x.kind !== '-') : [];
  const maxR = Math.max(1, ...reasons.map((x) => x.value));
  const depts = ['lost', 'loss', 'stop', 'rej'].includes(id) ? groupIssues(issues.filter((i) => (id === 'rej' ? i.kind === 'reject' : id === 'stop' ? i.kind === 'stop' : i.kind === 'loss')), {}, 'dept') : [];
  // the Loss analysis drill-down with this period, this kind of loss and the line / reason / department clicked here
  const lossType = id === 'rej' ? 'reject' : id === 'stop' ? 'stop' : 'loss';
  const drillTo = canDrill && range && ['lost', 'loss', 'stop', 'rej', 'A'].includes(id)
    ? (extra = []) => openLossAnalysis(onOpen, { start: range.start, end: range.end, type: lossType, filters: [...(line ? [{ dim: 'line', value: String(line) }] : IDS.length === 1 ? [{ dim: 'line', value: String(IDS[0]) }] : []), ...extra] })
    : null;
  return (
    <section className={`${card} p-4`} aria-label={`${TITLE[id]} details`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="border-l-4 border-blue-600 pl-2 text-fs-18 font-extrabold text-slate-900">{TITLE[id]} — details</h3>
        {line && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-fs-13 font-bold text-blue-800">Line {line} <button type="button" className="ml-1 font-extrabold" onClick={() => setLine(null)} aria-label="Back to all lines">×</button></span>}
        {drillTo && <button type="button" onClick={() => drillTo()} className="ml-auto rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-fs-13 font-bold text-blue-800 hover:bg-blue-100">Analyse in Loss analysis ›</button>}
        <button type="button" onClick={onClose} aria-label="Close details" className={`${drillTo ? '' : 'ml-auto '}rounded-md p-1 text-slate-500 hover:bg-slate-100`}><X size={18} /></button>
      </div>

      {id === 'rca' ? (
        !pending.length ? <p className="text-fs-14 text-slate-600">Nothing pending — every loss of this period has its RCA.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-200">{['Date', 'Line', 'Kind', 'Reason', 'Department', 'Amount'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{pending.slice(0, 30).map((i) => (
                <tr key={i.key} className="border-b border-slate-100 last:border-b-0">
                  <td className={td}>{dmy(i.date)}</td><td className={td}>Line {i.line}</td><td className="px-2 text-fs-14">{i.kind === 'loss' ? 'Idle time' : i.kind === 'reject' ? 'Rejection' : 'Rework'}</td>
                  <td className="px-2 text-fs-14 font-semibold">{i.reason}</td><td className="px-2 text-fs-14">{i.dept}</td><td className={td}>{i.unit === 'min' ? hms(i.value) : `${nf(i.value)} pcs`}</td>
                </tr>))}</tbody>
            </table>
            <button type="button" onClick={() => onOpen('rca')} className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-fs-13 font-bold text-white hover:bg-blue-700">Open RCA ›</button>
          </div>
        )
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {/* 1st level: line by line — click a line to see its days / hours */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-200"><th className={th}>Line</th>{cols.map(([h]) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {IDS.map((l) => { const t = R.byLine[l] || oleSum([]); return (
                    <tr key={l} onClick={() => setLine(line === l ? null : l)} className={`cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-blue-50/50 ${line === l ? 'bg-blue-50' : ''}`} title={`Show Line ${l} ${oneDay ? 'hour by hour' : 'day by day'}`}>
                      <td className="px-2 py-1.5 text-fs-14 font-bold whitespace-nowrap">Line {l} <ChevronRight size={13} className="inline text-blue-700" aria-hidden /></td>
                      {cols.map(([h, f, c]) => <td key={h} className={`${td} ${c ? c(t) : ''}`}>{f(t)}</td>)}
                    </tr>); })}
                  {IDS.length > 1 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-50"><td className="px-2 py-1.5 text-fs-14 font-extrabold">Total</td>{cols.map(([h, f, c]) => <td key={h} className={`${td} font-bold ${c ? c(R.total) : ''}`}>{f(R.total)}</td>)}</tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 2nd level: the days / hours of the chosen line (or of all lines) */}
            <div className="mt-3 text-fs-14 font-bold text-slate-700">{line ? `Line ${line}` : 'All lines'} · {oneDay ? 'hour by hour' : 'day by day'}</div>
            <div className="mt-1 h-[220px]" role="img" aria-label={`${TITLE[id]} ${oneDay ? 'per hour' : 'per day'}`}>
              {!data.some((x) => x.v != null && x.v !== 0) ? <p className="pt-8 text-center text-fs-14 text-slate-500">Nothing to show for this period.</p> : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="k" tick={{ fontSize: 12, fill: '#334155' }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12, fill: '#334155' }} tickLine={false} axisLine={false} width={44} domain={PCT.has(id) ? [0, Math.max(100, Math.ceil(Math.max(0, ...data.map((x) => x.v || 0)) / 25) * 25)] : [0, 'auto']} />
                    <Tooltip formatter={(v) => [PCT.has(id) ? `${v}%` : id === 'rej' ? `${v} pcs` : hms(v), TITLE[id]]} />
                    {PCT.has(id) && <ReferenceLine y={85} stroke="#C00000" strokeDasharray="6 4" />}
                    {PCT.has(id)
                      ? <Area type="monotone" dataKey="v" stroke="#2E75B6" strokeWidth={2.5} fill="#2E75B6" fillOpacity={0.12} isAnimationActive={false}
                          dot={(p) => (p.payload?.v == null || p.cy == null ? <g key={p.index} /> : <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill="#fff" stroke={p.payload.v >= 85 ? '#059669' : '#DC2626'} strokeWidth={2.5} />)}
                          label={{ position: 'top', fontSize: 11, fill: '#334155', formatter: (v) => (v == null ? '' : `${v}`) }} />
                      : <Bar dataKey="v" maxBarSize={44} isAnimationActive={false} label={{ position: 'top', fontSize: 11, fill: '#334155', formatter: (v) => (v ? (id === 'rej' ? v : hms(v)) : '') }}>
                          {data.map((x) => <Cell key={x.k} fill={id === 'stop' ? '#64748B' : '#DC2626'} />)}
                        </Bar>}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="min-w-0">
            {reasons.length > 0 && (
              <>
                <div className="text-fs-14 font-bold text-slate-700">{id === 'rej' ? 'Top defects' : 'Top reasons'}</div>
                <ol className="mt-1 flex flex-col gap-1.5">
                  {reasons.slice(0, 6).map((x, i) => (
                    <li key={`${x.kind}|${x.name}`}>
                      <div className="flex items-baseline justify-between gap-2 text-fs-14">{drillTo ? <button type="button" onClick={() => drillTo([{ dim: 'reason', value: x.name }])} className="min-w-0 text-left font-semibold text-blue-800 hover:underline" title="Open in Loss analysis">{i + 1}. {x.name} ›</button> : <span className="min-w-0 font-semibold text-slate-800">{i + 1}. {x.name}</span>}<span className="shrink-0 font-mono font-bold">{x.unit === 'min' ? hms(x.value) : `${nf(x.value)} pcs`}</span></div>
                      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${id === 'stop' ? 'bg-slate-500' : 'bg-red-600'}`} style={{ width: `${(x.value / maxR) * 100}%` }} /></div>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {depts.length > 0 && (
              <>
                <div className="mt-3 text-fs-14 font-bold text-slate-700">By department</div>
                <ul className="mt-1 flex flex-col gap-1">
                  {depts.map((x) => (
                    <li key={x.name} className="flex items-baseline justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-fs-14">{drillTo ? <button type="button" onClick={() => drillTo([{ dim: 'dept', value: x.name }])} className="text-left font-semibold text-blue-800 hover:underline" title="Open in Loss analysis">{x.name} ›</button> : <span className="font-semibold">{x.name}</span>}<span className="font-mono font-bold">{id === 'rej' ? `${nf(x.rejQty)} pcs` : hms(x.stopMin + x.lossMin)}</span></li>
                  ))}
                </ul>
              </>
            )}
            {!reasons.length && !depts.length && ['A', 'lost', 'loss', 'stop', 'rej'].includes(id) && (
              <div className="rounded-lg bg-slate-50 p-3 text-fs-14 text-slate-600">
                {['A', 'lost', 'loss'].includes(id) && 'No loss entered for this period.'}
                {id === 'stop' && 'No planned stoppage entered for this period.'}
                {id === 'rej' && 'No rejection entered for this period.'}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function CleanDashboardPage({ onOpen = () => {}, canOpen = [] }) {
  const slot = useHeaderSlot();
  const ALL = useOleLines();
  const today = serverToday();
  const [only, setOnly] = useState('all');
  const IDS = useMemo(() => (only !== 'all' && ALL.includes(only) ? [only] : ALL), [only, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState({ start: today, end: today });
  const [sel, setSel] = useState('ole');      // the measure whose details are open
  const [line, setLine] = useState(null);     // 2nd level of the drill-down
  useEffect(() => { setLine(null); }, [only]);
  const [jump, setJump] = useState(0);
  const pick = (k, l = null) => { setSel(k); setLine(k ? l : null); if (k) setJump((n) => n + 1); };
  useEffect(() => {
    if (!jump) return;
    const el = document.querySelector('[data-dash-details]');
    if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [jump]);
  const oneDay = range.start === range.end;
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS, pollEntries: true });
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, range.start, range.end, today, D.endMin, IDS]);
  const T = R?.total || oleSum([]);
  const day = oneDay ? (R?.days.find((d) => d.date === range.start) || null) : null;
  const group = groupNameOf(IDS);
  const kind = periodKind(range, today);
  const periodText = `${{ today: 'Today', yesterday: 'Yesterday', day: 'Day', week: 'Week', month: 'Month', range: 'Range' }[kind]} · ${oneDay ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`}`;
  const rows = useMemo(() => (R?.days || []).flatMap((d) => IDS.flatMap((l) => d.byLine[l]?.rows || [])), [R, IDS]);
  const LS = useMemo(() => lossSummary(rows, D.ent.reasons.station), [rows, D.ent.reasons]);
  const issues = useMemo(() => (R ? issuesOf(R.days) : []), [R]);
  const pending = useMemo(() => issues.filter((i) => needsRca(i) && rcaStatus(D.ent.rca[i.key]) === 'pending').sort((a, b) => a.date.localeCompare(b.date) || b.value - a.value), [issues, D.ent.rca]);
  const busy = !!R && (D.stale || D.loading);
  const upd = D.updatedAt && range.end === today ? `Updated ${p2(D.updatedAt.getHours())}:${p2(D.updatedAt.getMinutes())}` : '';

  const viewTabs = ALL.length > 1 && (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Dashboard view">
      {['all', ...ALL].map((v) => (
        <button key={v} type="button" aria-pressed={only === v} aria-label={v === 'all' ? 'Show all lines' : `Show Line ${v} only`} onClick={() => setOnly(v)}
          className={`h-8 whitespace-nowrap border-r border-slate-300 px-3 text-fs-13 font-semibold last:border-r-0 ${only === v ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{v === 'all' ? 'Overall' : `Line ${v}`}</button>
      ))}
    </div>
  );
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      {viewTabs}
      <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={busy} />
    </div>
  );

  return (
    <div className="flex flex-col gap-3" aria-label="Dashboard measures">
      {slot ? createPortal(filters, slot) : (
        // phones / small laptops: the filters on the page, wrapping
        <div className="flex min-w-0 flex-col gap-2">
          {viewTabs && <div className="flex max-w-full flex-wrap [&>div]:flex-wrap">{viewTabs}</div>}
          <PeriodBar today={today} range={range} setRange={setRange} text={periodText} busy={busy} />
        </div>
      )}
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}
      {!R && !D.err && <PageLoader label={`Reading ${group}`} sub="OLE, losses and RCA of the period" />}
      {R && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-fs-20 font-extrabold text-slate-900">{group}</h2>
            <span className="text-fs-14 font-semibold text-slate-500">{periodText}</span>
            {upd && <span className="ml-auto whitespace-nowrap font-mono text-fs-12 font-semibold text-slate-500" title="Last updated">{upd}</span>}
          </div>
          <Hero t={T} sel={line ? null : sel} onPick={(k) => pick(k)} pendingN={pending.length} />
          {only === 'all' && IDS.length > 1 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-fs-16 font-extrabold text-slate-900">Line by line</h2>
              <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${IDS.length >= 3 ? '2xl:grid-cols-4' : ''}`}>
                {IDS.map((l) => (
                  <LineCard key={l} l={l} t={oleSum((R?.days || []).map((d) => d.byLine[l]?.total))} pendingN={pending.filter((i) => String(i.line) === String(l)).length}
                    sel={sel} selLine={line} onPick={pick} />
                ))}
              </div>
            </div>
          )}
          {sel && <div data-dash-details className="scroll-mt-28"><Drill id={sel} R={R} IDS={IDS} oneDay={oneDay} day={day} line={line} setLine={setLine} LS={LS} issues={issues} pending={line ? pending.filter((i) => String(i.line) === String(line)) : pending} onOpen={onOpen} onClose={() => pick(null)} range={range} canDrill={canOpen.includes('lossan')} /></div>}
        </>
      )}
    </div>
  );
}
