import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, LabelList, Cell } from 'recharts';
import { nf, dmy } from './OleParts';
import { KPI_STAGES } from '../utils/kpiReport';
import { summaryTable, dayTable, ftyTable, ftyPeriod, KPI_RTY_T } from '../utils/kpiSheets';

/**
 * 25-11-2026: the sheets of the plant's SAWM KPI report as screens of the KPI dashboard —
 * Summary (every day, FA-01 … FA-04), Day (model by model, FA lines only: the PKG / SMT blocks are left out) and
 * FPY & RTY (stage-wise first pass yield and rolled throughput yield). Numbers: utils/kpiSheets.js (= the Excel).
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const TH = 'border border-[#BFBFBF] px-2 py-1';
const TD = 'border border-[#D4D4D4] px-2 py-1';
const HEAD1 = 'bg-[#1F3864] text-center text-fs-12 text-white';
const HEAD2 = 'bg-[#DDEBF7] text-center text-fs-11 font-bold text-[#1F3864]';
const d0 = (v) => (v == null ? '—' : nf(Math.round(v)));
const d1 = (v) => (v == null ? '—' : v.toFixed(1));
const d2 = (v) => (v == null ? '—' : v.toFixed(2));
const pc = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const rs = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const cr = (v) => (v == null ? '—' : (v / 1e7).toFixed(3));
const tone = (a, t) => (a == null || t == null ? '' : a >= t ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800');

function Head({ title, right }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">{title}</h3>
      {right && <span className="text-fs-12 font-semibold text-slate-500">{right}</span>}
    </div>
  );
}

function Stat({ name, value, sub, cls = 'text-slate-900', testid }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid={testid}>
      <div className="text-fs-11 font-bold uppercase tracking-wide text-slate-500">{name}</div>
      <div className={`font-mono text-fs-22 font-extrabold leading-tight tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-fs-11 text-slate-500">{sub}</div>}
    </div>
  );
}

// 26-11-2026: RTY chart — a number only on a day below the target (red bar), written upright above the bar, so
// neighbouring days never overlap (every day's "100.0" ran into one line); every day's value is in the tooltip
const rtyLabel = ({ x, y, width, value }) => {
  if (value == null || value >= KPI_RTY_T) return null;
  const cx = x + width / 2;
  return <text x={cx} y={y - 4} transform={`rotate(-90 ${cx} ${y - 4})`} fontSize={11} fontWeight={700} fill="#B91C1C">{Number(value).toFixed(1)}</text>;
};
/** 26-11-2026: the Summary sheet as a dashboard — day by day: production plan vs actual, UPH, UPPH, RTY and OS&D (from the same rows as the table) */
function SummaryCharts({ S }) {
  const D = [...S].reverse().map((d) => ({ k: d.date.slice(8, 10), date: d.date, plan: d.total.plan, qty: d.total.qty, uphT: d.total.uphT, uphA: d.total.uphA, upphT: d.total.upphT, upphA: d.total.upphA,
    rty: d.total.rty == null ? null : Math.round(d.total.rty * 100) / 100, osd: d.total.osd, mtd: d.total.mtd }));
  if (D.length < 2) return null;   // one day: the table says it all
  const G = '#E2E8F0', tk = { fontSize: 11, fill: '#334155' };
  const lab = (p) => (p?.[0]?.payload?.date ? dmy(p[0].payload.date) : '');
  const box = (title, sub, chart) => (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1"><b className="text-fs-13 text-dixon-navy">{title}</b><span className="text-fs-11 text-slate-500">{sub}</span></div>
      <div style={{ height: 190 }}><ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer></div>
    </div>
  );
  const two = (a, b, an, bn, fmt) => (
    <ComposedChart data={D} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
      <CartesianGrid stroke={G} vertical={false} /><XAxis dataKey="k" tick={tk} interval={0} /><YAxis tick={tk} width={40} domain={['auto', 'auto']} />
      <Tooltip labelFormatter={(_, p) => lab(p)} formatter={(v, n) => [v == null ? '—' : fmt(v), n]} /><Legend wrapperStyle={{ fontSize: 11 }} />
      <Line dataKey={a} name={an} stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      <Line dataKey={b} name={bn} stroke="#1F3864" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
    </ComposedChart>
  );
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3" data-testid="kpi-summary-charts">
      {box('Production · plan vs actual', 'pieces a day, all lines shown', (
        <BarChart data={D} margin={{ top: 14, right: 6, left: 0, bottom: 0 }} barGap={1}>
          <CartesianGrid stroke={G} vertical={false} /><XAxis dataKey="k" tick={tk} interval={0} /><YAxis tick={tk} width={40} />
          <Tooltip labelFormatter={(_, p) => lab(p)} formatter={(v, n) => [d0(v), n]} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="plan" name="Plan" fill="#CBD5E1" maxBarSize={18} isAnimationActive={false} />
          <Bar dataKey="qty" name="Actual" fill="#16A34A" maxBarSize={18} isAnimationActive={false}>{D.map((d) => <Cell key={d.k} fill={d.plan && d.qty >= d.plan ? '#16A34A' : '#EB5757'} />)}</Bar>
        </BarChart>
      ))}
      {box('UPH · target vs actual', 'units per hour (average of the lines)', two('uphT', 'uphA', 'Target', 'Actual', (v) => v.toFixed(0)))}
      {box('UPPH · target vs actual', 'units per person per hour', two('upphT', 'upphA', 'Target', 'Actual', (v) => v.toFixed(2)))}
      {box('RTY (%)', `target ${KPI_RTY_T}% · red line`, (
        <ComposedChart data={D} margin={{ top: 14, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={G} vertical={false} /><XAxis dataKey="k" tick={tk} interval={0} /><YAxis tick={tk} width={44} domain={[(m) => Math.min(KPI_RTY_T - 1, Math.floor(m)), 100]} unit="%" />
          <Tooltip labelFormatter={(_, p) => lab(p)} formatter={(v) => [v == null ? '—' : `${v}%`, 'RTY']} />
          <ReferenceLine y={KPI_RTY_T} stroke="#EB5757" strokeDasharray="5 4" />
          <Bar dataKey="rty" name="RTY" maxBarSize={18} isAnimationActive={false}>{D.map((d) => <Cell key={d.k} fill={d.rty == null ? '#CBD5E1' : d.rty >= KPI_RTY_T ? '#16A34A' : '#EB5757'} />)}<LabelList dataKey="rty" content={rtyLabel} /></Bar>
        </ComposedChart>
      ))}
      {box('OS&D (₹)', 'reported each day · month to date', (
        <ComposedChart data={D} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
          <CartesianGrid stroke={G} vertical={false} /><XAxis dataKey="k" tick={tk} interval={0} /><YAxis tick={tk} width={50} />
          <Tooltip labelFormatter={(_, p) => lab(p)} formatter={(v, n) => [rs(v), n]} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="osd" name="OS&D (day)" fill="#F59E0B" maxBarSize={18} isAnimationActive={false} />
          <Line dataKey="mtd" name="OS&D MTD" stroke="#B91C1C" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      ))}
      {box('Achieved % a day', 'actual ÷ plan', (
        <BarChart data={D.map((d) => ({ ...d, ach: d.plan ? Math.round((d.qty / d.plan) * 1000) / 10 : null }))} margin={{ top: 14, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={G} vertical={false} /><XAxis dataKey="k" tick={tk} interval={0} /><YAxis tick={tk} width={40} unit="%" />
          <Tooltip labelFormatter={(_, p) => lab(p)} formatter={(v) => [v == null ? '—' : `${v}%`, 'Achieved']} />
          <ReferenceLine y={100} stroke="#16A34A" strokeDasharray="5 4" />
          <Bar dataKey="ach" maxBarSize={18} isAnimationActive={false}>{D.map((d) => <Cell key={d.k} fill={d.plan && d.qty >= d.plan ? '#16A34A' : '#EB5757'} />)}</Bar>
        </BarChart>
      ))}
    </div>
  );
}

const Empty = ({ text = 'No production in this period.' }) => <p className="py-6 text-center text-fs-14 font-semibold text-slate-500">{text}</p>;

// ── Summary ────────────────────────────────────────────────────────────────────
export function KpiSummarySheet({ K, ids }) {
  const S = useMemo(() => summaryTable(K, ids), [K, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const P = useMemo(() => {
    const plan = S.reduce((a, d) => a + (d.total.plan || 0), 0), qty = S.reduce((a, d) => a + (d.total.qty || 0), 0);
    const r = S.map((d) => d.total.rty).filter((v) => v != null);
    return { plan, qty, ach: plan ? (qty / plan) * 100 : null, rty: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null, days: S.length };
  }, [S]);
  return (
    <section className={card} aria-label="Summary sheet" data-testid="kpi-sheet-summary">
      <Head title="Summary" right="as the Summary sheet of the SAWM KPI report" />
      {!S.length ? <Empty /> : (<>
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat name="Plan" value={d0(P.plan)} sub={`${P.days} day(s)`} />
          <Stat name="Actual" value={d0(P.qty)} cls={P.ach == null ? '' : P.ach >= 100 ? 'text-emerald-700' : 'text-red-700'} testid="sum-actual" />
          <Stat name="Achieved" value={P.ach == null ? '—' : `${P.ach.toFixed(1)}%`} cls={P.ach == null ? '' : P.ach >= 100 ? 'text-emerald-700' : 'text-red-700'} />
          <Stat name="RTY (avg)" value={P.rty == null ? '—' : `${P.rty.toFixed(2)}%`} sub={`target ${KPI_RTY_T}%`} cls={P.rty == null ? '' : P.rty >= KPI_RTY_T ? 'text-emerald-700' : 'text-red-700'} />
        </div>
        <SummaryCharts S={S} />
        <div className="overflow-auto" style={{ maxHeight: 640 }}>
          <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Summary">
            <thead className="sticky top-0 z-10">
              <tr className={HEAD1}>
                {['Date', 'Line No.', 'SAP Location'].map((h) => <th key={h} rowSpan={2} className={TH}>{h}</th>)}
                <th colSpan={2} className={TH}>Production</th><th colSpan={2} className={TH}>UPH</th><th colSpan={2} className={TH}>UPPH</th><th colSpan={2} className={TH}>RTY (%)</th>
                <th className={TH}>OS&amp;D (Reporting Date)</th><th className={TH}>OS&amp;D MTD</th><th colSpan={2} className={TH}>Actual OT (Manhours)</th>
                <th rowSpan={2} className={TH}>&gt;7 Days WO (Sum of Bal Qty)</th><th rowSpan={2} className={TH}>TRC Lying &gt;3 Days (Rs)</th><th rowSpan={2} className={TH}>WIP Lying &gt;7 Days (Rs)</th>
              </tr>
              <tr className={HEAD2}>
                {['Plan', 'Actual', 'Target', 'Actual', 'Target', 'Actual', 'Target', 'Actual', 'Value', 'Value', 'Planned', 'Unplanned'].map((h, i) => <th key={i} className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {S.flatMap((d) => [
                ...d.rows.map((r, i) => {
                  const v = r.v, e = r.e || {};
                  return (
                    <tr key={`${d.date}|${r.line}`} className="text-center">
                      {i === 0 && <td rowSpan={d.rows.length + 1} className={`${TD} whitespace-nowrap align-middle font-semibold`}>{dmy(d.date)}</td>}
                      <td className={`${TD} whitespace-nowrap font-bold`}>{r.fa}</td><td className={`${TD} font-mono`}>{r.sap}</td>
                      <td className={`${TD} font-mono`}>{d0(v?.plan)}</td><td className={`${TD} font-mono font-bold ${tone(v?.qty, v?.plan)}`}>{v ? nf(v.qty) : '—'}</td>
                      <td className={`${TD} font-mono`}>{d1(v?.uphT ?? null)}</td><td className={`${TD} font-mono ${tone(v?.uphA, v?.uphT)}`}>{d1(v?.uphA ?? null)}</td>
                      <td className={`${TD} font-mono`}>{d2(v?.upphT ?? null)}</td><td className={`${TD} font-mono ${tone(v?.upphA, v?.upphT)}`}>{d2(v?.upphA ?? null)}</td>
                      <td className={`${TD} font-mono`}>{v ? KPI_RTY_T : '—'}</td><td className={`${TD} font-mono ${tone(v?.rty, KPI_RTY_T)}`}>{d2(v?.rty ?? null)}</td>
                      <td className={`${TD} font-mono`}>{rs(e.osd)}</td><td className={`${TD} font-mono`}>{rs(r.mtd)}</td>
                      <td className={`${TD} font-mono`}>{d1(e.otPlan ?? null)}</td><td className={`${TD} font-mono`}>{d1(e.otUnplan ?? null)}</td>
                      <td className={`${TD} font-mono`}>{e.wo7 == null ? '—' : nf(e.wo7)}</td><td className={`${TD} font-mono`}>{rs(e.trc3)}</td><td className={`${TD} font-mono`}>{rs(e.wip7)}</td>
                    </tr>
                  );
                }),
                <tr key={`${d.date}|t`} className="bg-slate-100 text-center font-extrabold" data-testid="sum-total">
                  <td colSpan={2} className={TD}>Total</td>
                  <td className={`${TD} font-mono`}>{d0(d.total.plan)}</td><td className={`${TD} font-mono ${tone(d.total.qty, d.total.plan)}`}>{d0(d.total.qty)}</td>
                  <td className={`${TD} font-mono`}>{d1(d.total.uphT)}</td><td className={`${TD} font-mono`}>{d1(d.total.uphA)}</td>
                  <td className={`${TD} font-mono`}>{d2(d.total.upphT)}</td><td className={`${TD} font-mono`}>{d2(d.total.upphA)}</td>
                  <td className={`${TD} font-mono`}>{d.total.rtyT ?? '—'}</td><td className={`${TD} font-mono`}>{d2(d.total.rty)}</td>
                  <td className={`${TD} font-mono`}>{rs(d.total.osd)}</td><td className={`${TD} font-mono`}>{rs(d.total.mtd)}</td>
                  <td className={`${TD} font-mono`}>{d1(d.total.otPlan)}</td><td className={`${TD} font-mono`}>{d1(d.total.otUnplan)}</td>
                  <td className={`${TD} font-mono`}>{d.total.wo7 == null ? '—' : nf(d.total.wo7)}</td><td className={`${TD} font-mono`}>{rs(d.total.trc3)}</td><td className={`${TD} font-mono`}>{rs(d.total.wip7)}</td>
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      </>)}
    </section>
  );
}

// ── Day ────────────────────────────────────────────────────────────────────────
export function KpiDaySheet({ K, ids }) {
  const dates = useMemo(() => (K || []).filter((d) => ids.some((l) => d.lines[l] || d.kpi?.[l])).map((d) => d.date), [K, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState(null);
  useEffect(() => { if (!date || !dates.includes(date)) setDate(dates[dates.length - 1] || null); }, [dates.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const D = useMemo(() => (date ? dayTable(K, date, ids) : null), [K, date, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const i = dates.indexOf(date);
  return (
    <section className={card} aria-label="Day sheet" data-testid="kpi-sheet-day">
      <Head title="Day sheet" right="model by model, FA lines (PKG and SMT left out)" />
      {!dates.length ? <Empty /> : (<>
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Day">
          <button type="button" aria-label="Previous day" disabled={i <= 0} onClick={() => setDate(dates[i - 1])} className="grid h-8 w-8 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 disabled:opacity-40"><ChevronLeft size={16} /></button>
          {dates.map((x) => (
            <button key={x} type="button" aria-pressed={x === date} onClick={() => setDate(x)} data-testid={`day-${x}`}
              className={`h-8 rounded-md border px-2 font-mono text-fs-12 font-bold ${x === date ? 'border-dixon-navy bg-dixon-navy text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{x.slice(8)}</button>
          ))}
          <button type="button" aria-label="Next day" disabled={i < 0 || i >= dates.length - 1} onClick={() => setDate(dates[i + 1])} className="grid h-8 w-8 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 disabled:opacity-40"><ChevronRight size={16} /></button>
        </div>
        {D && (<>
          <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat name="Date" value={dmy(D.date)} testid="day-date" />
            <Stat name="Plant" value={<span className="text-fs-14">Washing Machine Unit Dehradun</span>} />
            <Stat name="Plan" value={d0(D.total.plan)} />
            <Stat name="Actual" value={d0(D.total.qty)} cls={D.total.plan ? (D.total.qty >= D.total.plan ? 'text-emerald-700' : 'text-red-700') : ''} testid="day-actual" />
            <Stat name="BOM value (Cr)" value={D.total.bom == null ? '—' : D.total.bom.toFixed(3)} sub="KPI entry" />
          </div>
          <div className="overflow-auto" style={{ maxHeight: 640 }}>
            <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Day sheet">
              <thead className="sticky top-0 z-10">
                <tr className={HEAD1}>
                  {['Line No.', 'SAP Location', 'Model'].map((h) => <th key={h} rowSpan={2} className={TH}>{h}</th>)}
                  <th colSpan={2} className={TH}>Production</th><th colSpan={2} className={TH}>UPH</th><th colSpan={3} className={TH}>UPPH</th><th colSpan={2} className={TH}>RTY (%)</th>
                  <th rowSpan={2} className={TH}>Loss Reason</th><th className={TH}>OS&amp;D (Reporting Date)</th><th className={TH}>OS&amp;D MTD</th><th colSpan={2} className={TH}>Actual OT (Manhours)</th>
                  <th rowSpan={2} className={TH}>&gt;7 Days WO (Sum of Bal Qty)</th><th rowSpan={2} className={TH}>TRC Lying &gt;3 Days (Cr)</th><th rowSpan={2} className={TH}>WIP Lying &gt;7 Days (Cr)</th>
                </tr>
                <tr className={HEAD2}>
                  {['Plan', 'Actual', 'Target', 'Actual', 'Installed', 'Program', 'Actual', 'Target', 'Actual', 'Value', 'Value', 'Planned', 'Unplanned'].map((h, k) => <th key={k} className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {D.lines.flatMap((l) => {
                  const ms = l.models.length ? l.models : [null];
                  const n = ms.length, e = l.e || {};
                  return ms.map((m, k) => (
                    <tr key={`${l.line}|${k}`} className={`text-center ${k === n - 1 ? 'border-b-2 border-slate-400' : ''}`} data-testid={k === 0 ? `day-line-${l.line}` : undefined}>
                      <td className={`${TD} whitespace-nowrap font-bold`}>{l.fa}</td><td className={`${TD} font-mono`}>{l.sap}</td>
                      <td className={`${TD} whitespace-nowrap text-left font-semibold`}>{m ? m.model : <span className="text-slate-400">No production</span>}</td>
                      <td className={`${TD} font-mono`}>{d0(m?.plan ?? null)}</td><td className={`${TD} font-mono font-bold ${tone(m?.qty, m?.plan)}`}>{m ? nf(m.qty) : '—'}</td>
                      <td className={`${TD} font-mono`}>{d1(m?.uphT ?? null)}</td><td className={`${TD} font-mono ${tone(m?.uphA, m?.uphT)}`}>{d1(m?.uphA ?? null)}</td>
                      <td className={`${TD} font-mono text-slate-400`}>—</td><td className={`${TD} font-mono`}>{d2(m?.upphT ?? null)}</td><td className={`${TD} font-mono ${tone(m?.upphA, m?.upphT)}`}>{d2(m?.upphA ?? null)}</td>
                      {k === 0 && (<>
                        <td rowSpan={n} className={`${TD} align-middle font-mono`}>{l.rty == null ? '—' : KPI_RTY_T}</td>
                        <td rowSpan={n} className={`${TD} align-middle font-mono font-bold ${tone(l.rty, KPI_RTY_T)}`}>{d2(l.rty)}</td>
                        <td rowSpan={n} style={{ minWidth: 180 }} className={`${TD} align-middle text-left text-fs-12`}>{l.reasons || '—'}</td>
                        <td rowSpan={n} className={`${TD} align-middle font-mono`}>{rs(e.osd)}</td><td rowSpan={n} className={`${TD} align-middle font-mono`}>{rs(l.mtd)}</td>
                        <td rowSpan={n} className={`${TD} align-middle font-mono`}>{d1(e.otPlan ?? null)}</td><td rowSpan={n} className={`${TD} align-middle font-mono`}>{d1(e.otUnplan ?? null)}</td>
                        <td rowSpan={n} className={`${TD} align-middle font-mono`}>{e.wo7 == null ? '—' : nf(e.wo7)}</td>
                        <td rowSpan={n} className={`${TD} align-middle font-mono`}>{cr(e.trc3)}</td><td rowSpan={n} className={`${TD} align-middle font-mono`}>{cr(e.wip7)}</td>
                      </>)}
                    </tr>
                  ));
                })}
                <tr className="bg-slate-100 text-center font-extrabold" data-testid="day-total">
                  <td className={TD}>FA</td><td className={TD} /><td className={`${TD} text-left`}>Total</td>
                  <td className={`${TD} font-mono`}>{d0(D.total.plan)}</td><td className={`${TD} font-mono`}>{d0(D.total.qty)}</td>
                  <td colSpan={8} className={TD} />
                  <td className={`${TD} font-mono`}>{rs(D.total.osd)}</td><td className={`${TD} font-mono`}>{rs(D.total.mtd)}</td>
                  <td className={`${TD} font-mono`}>{d1(D.total.otPlan)}</td><td className={`${TD} font-mono`}>{d1(D.total.otUnplan)}</td>
                  <td className={`${TD} font-mono`}>{D.total.wo7 == null ? '—' : nf(D.total.wo7)}</td><td className={`${TD} font-mono`}>{cr(D.total.trc3)}</td><td className={`${TD} font-mono`}>{cr(D.total.wip7)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-fs-12 text-slate-500">UPPH = UPH ÷ manpower of the Morning entry · UPPH "Installed" is not kept in Line Pulse · OS&amp;D, OT, WO, TRC, WIP and BOM come from the KPI entry.</p>
        </>)}
      </>)}
    </section>
  );
}

// ── FPY & RTY ──────────────────────────────────────────────────────────────────
export function KpiFtySheet({ K, ids }) {
  const F = useMemo(() => ftyTable(K, ids), [K, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const P = useMemo(() => ftyPeriod(F), [F]);
  const T = KPI_RTY_T / 100;
  return (
    <section className={card} aria-label="FPY and RTY sheet" data-testid="kpi-sheet-fty">
      <Head title="FPY & RTY" right="stage FPY = 1 − defects ÷ production · RTY = product of the stage FPYs" />
      {!F.length ? <Empty /> : (<>
        {P && (
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8" data-testid="fty-period">
            {KPI_STAGES.map((s, k) => <Stat key={s} name={s} value={pc(P.fpy[k])} sub={`${nf(P.stages[k])} defect(s)`} cls={P.fpy[k] >= T ? 'text-emerald-700' : 'text-red-700'} />)}
            <Stat name="RTY (period)" value={pc(P.rty)} sub={`target ${KPI_RTY_T}%`} cls={P.rty >= T ? 'text-emerald-700' : 'text-red-700'} testid="fty-rty" />
            <Stat name="Defects" value={nf(P.defects)} sub={`${nf(P.qty)} pcs · dismantle ${P.dismantle == null ? '—' : nf(P.dismantle)}`} />
          </div>
        )}
        <div className="overflow-auto" style={{ maxHeight: 640 }}>
          <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="FPY and RTY">
            <thead className="sticky top-0 z-10">
              <tr className={HEAD1}>
                {['Date', 'Line', 'Line Wise Production', 'Total Production', 'Defect', 'Dismantle'].map((h) => <th key={h} rowSpan={2} className={TH}>{h}</th>)}
                <th colSpan={6} className={TH}>STAGES (defects)</th><th colSpan={6} className={TH}>STAGE WISE FPY (%)</th>
                <th rowSpan={2} className={TH}>Target</th><th rowSpan={2} className={TH}>RTY (%)</th>
              </tr>
              <tr className={HEAD2}>{[...KPI_STAGES, ...KPI_STAGES].map((h, k) => <th key={k} className={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {F.flatMap((d) => d.rows.map((r, k) => (
                <tr key={`${d.date}|${r.line}`} className={`text-center ${k === d.rows.length - 1 ? 'border-b-2 border-slate-400' : ''}`}>
                  {k === 0 && <td rowSpan={d.rows.length} className={`${TD} whitespace-nowrap align-middle font-semibold`}>{dmy(d.date)}</td>}
                  <td className={`${TD} whitespace-nowrap font-bold`}>{r.label}</td>
                  <td className={`${TD} font-mono`}>{nf(r.qty)}</td>
                  {k === 0 && <td rowSpan={d.rows.length} className={`${TD} align-middle font-mono font-bold`}>{nf(d.total)}</td>}
                  <td className={`${TD} font-mono`}>{r.defects || '—'}</td><td className={`${TD} font-mono`}>{r.dismantle ?? '—'}</td>
                  {r.stages.map((n, s) => <td key={`n${s}`} className={`${TD} font-mono`}>{n || ''}</td>)}
                  {r.fpy.map((v, s) => <td key={`f${s}`} className={`${TD} font-mono ${v < T ? 'bg-red-50 text-red-800' : ''}`}>{pc(v)}</td>)}
                  <td className={`${TD} font-mono`}>{KPI_RTY_T}%</td>
                  <td className={`${TD} font-mono font-bold ${tone(r.rty, T)}`} data-testid="fty-row-rty">{pc(r.rty)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </>)}
    </section>
  );
}
