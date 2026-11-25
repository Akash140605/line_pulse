import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, ReferenceLine } from 'recharts';
import { Download, ChevronRight, ChevronDown } from 'lucide-react';
import HeaderBar, { segGroup, segBtn } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { PeriodBar } from '../components/PeriodBar';
import { serverToday } from '../utils/serverTime';
import { nf, dmy, useOleData, useOleLines, groupNameOf, LINE_COLOR } from '../components/OleParts';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { oleRange } from '../utils/ole';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { custData, custSheets, monthLabel } from '../utils/prodReports';
import { fs } from '../theme';

/**
 * Customer wise production (23-11-2026) — the plant's "Customer_wise_production" workbook as a dashboard:
 * pieces per customer and model, day by day, the lines' day totals, and the same Excel as the Reports page
 * (Summery + one sheet per customer, Plan / Backlog to fill). Pieces = good scans of the lines (as every screen).
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const NAVY = '#1F3864', GRID = '#E2E8F0';
const tick = () => ({ fontSize: fs(12), fill: '#334155' });
const th = 'border border-[#BFBFBF] bg-[#FFFF00] px-1.5 py-1 text-fs-12 font-extrabold text-slate-900';
const td = 'border border-[#D4D4D4] px-1.5 py-1';

function Tile({ name, value, sub, testid }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid={testid}>
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className="lp-clamp2 mt-1 font-mono text-fs-28 font-extrabold leading-tight tabular-nums text-slate-900" title={String(value)}>{value}</div>
      {sub && <div className="lp-clamp2 mt-1 text-fs-12 text-slate-600" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
    </div>
  );
}
const Title = ({ children, right }) => <div className="mb-2 flex flex-wrap items-baseline gap-2"><h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">{children}</h3>{right && <span className="ml-auto text-fs-12 text-slate-600">{right}</span>}</div>;

export default function CustomerProductionPage() {
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: `${today.slice(0, 8)}01`, end: today });
  const [sel, setSel] = useState('all');
  const [open, setOpen] = useState(() => new Set());
  const [split, setSplit] = useState(false);
  const [allCust, setAllCust] = useState(false);   // 25-11-2026: every customer, not only the top 12   // pieces by day: total (false) or line by line (true)   // customers opened to their models
  const IDS = sel === 'all' ? ALL : [sel];
  const settings = useAllLineSettings(ALL);
  const D = useOleData({ start: range.start, end: range.end, ids: ALL });
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL }) : null),
    [D.al, D.ent, settings, range.start, range.end, today, D.endMin, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const C = useMemo(() => (R ? custData({ R, D, ids: IDS }, range.start, range.end > today ? today : range.end) : null), [R, D.al, IDS.join(), range.start, range.end, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodText = range.start === range.end ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  const days = C ? C.dates.filter((d) => C.customers.some((c) => c.byDate[d])) : [];
  const worked = C ? C.dates.filter((d) => C.lines.some((l) => l.byDate[d])) : [];
  const best = C ? C.dates.map((d) => ({ d, n: C.lines.reduce((a, l) => a + (l.byDate[d] || 0), 0) })).sort((a, b) => b.n - a.n)[0] : null;
  const models = C ? C.customers.reduce((a, c) => a + c.models.length, 0) : 0;
  // 23-11-2026: only the days with production; the total on top of each bar; the days without production in one line
  const daily = C ? worked.map((d) => ({ d: d.slice(8), title: dmy(d), total: C.lines.reduce((a, l) => a + (l.byDate[d] || 0), 0), ...Object.fromEntries(C.lines.map((l) => [`L${l.line}`, l.byDate[d] || 0])) })) : [];
  const idle = C ? C.dates.filter((d) => !worked.includes(d)) : [];
  const avg = worked.length ? Math.round(C.total / worked.length) : 0;
  const lbl = (v) => (daily.length > 16 && v >= 1000 ? `${(v / 1000).toFixed(1)}k` : nf(v));   // full number while it fits
  const top = C ? (allCust ? C.customers : C.customers.slice(0, 12)) : [];
  const hiC = Math.max(1, ...top.map((c) => c.total));
  const excel = () => downloadXlsx(buildXlsx(custSheets(C)), `Customer_wise_production_${monthLabel(range.start)}${range.start.slice(0, 7) !== range.end.slice(0, 7) ? ` to ${monthLabel(range.end)}` : ''}${sel === 'all' ? '' : `_Line${sel}`}.xlsx`);
  const flip = (n) => setOpen((s) => { const o = new Set(s); if (o.has(n)) o.delete(n); else o.add(n); return o; });

  if (!ALL.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  return (
    <div className="flex flex-col gap-3" aria-label="Customer wise production" role="region">
      <HeaderBar label="Customer production filters">
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!C} />
        <button type="button" disabled={!C || !C.total} onClick={excel} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-700 px-2.5 text-fs-13 font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
          <Download size={14} aria-hidden />Excel</button>
      </HeaderBar>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}
      {!C ? <PageLoader label="Reading the production" sub={periodText} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile testid="cp-total" name="Pieces made" value={nf(C.total)} sub={`${groupNameOf(IDS)} · ${periodText}`} />
            <Tile testid="cp-cust" name="Customers" value={nf(C.customers.length)} sub={C.customers[0] ? `Top: ${C.customers[0].name} · ${nf(C.customers[0].total)}` : '—'} />
            <Tile testid="cp-models" name="Models" value={nf(models)} sub="made in the period" />
            <Tile testid="cp-avg" name="Average / day" value={worked.length ? nf(Math.round(C.total / worked.length)) : '—'} sub={`${worked.length} day${worked.length === 1 ? '' : 's'} with production`} />
            <Tile testid="cp-best" name="Best day" value={best && best.n ? nf(best.n) : '—'} sub={best && best.n ? dmy(best.d) : ''} />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <section className={card} aria-label="Pieces by customer">
              <Title right={IDS.length > 1 ? <span className="inline-flex flex-wrap items-center gap-2">{IDS.map((l, i) => <span key={l} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: (LINE_COLOR[l] || NAVY) }} />L{l}</span>)}</span> : `${C.customers.length} customers`}>Pieces by customer</Title>
              {!top.length ? <p className="py-4 text-center text-fs-13 font-semibold text-slate-500">Nothing made in this period.</p> : (
                <div className="flex flex-col gap-1" role="list">
                  {top.map((c) => (
                    <div key={c.name} role="listitem" className="grid items-center gap-2 px-1 py-0.5 text-fs-13" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr) 5.5rem' }}>
                      <span className="lp-clamp2 font-semibold text-slate-800" title={c.name}>{c.name}</span>
                      <span className="flex h-3 overflow-hidden rounded bg-slate-100" title={IDS.map((l) => `Line ${l}: ${nf(c.byLine?.[l] || 0)}`).join(' · ')}>
                        {IDS.map((l, i) => (c.byLine?.[l] ? <span key={l} className="block h-full" style={{ width: `${(c.byLine[l] / hiC) * 100}%`, background: (LINE_COLOR[l] || NAVY), marginRight: 1 }} /> : null))}
                      </span>
                      <span className="text-right font-mono font-bold text-slate-900">{nf(c.total)} <span className="text-fs-11 font-semibold text-slate-500">{C.total ? `${Math.round((c.total / C.total) * 100)}%` : ''}</span></span>
                    </div>
                  ))}
                  {C.customers.length > 12 && <button type="button" onClick={() => setAllCust((v) => !v)} className="mt-1 self-start text-fs-13 font-bold text-blue-700 hover:underline">{allCust ? 'Show top 12' : `Show all ${C.customers.length} customers`}</button>}
                </div>
              )}
            </section>
            <section className={card} aria-label="Pieces by day">
              <Title right={
                <span className="inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Show">
                  <button type="button" aria-pressed={!split} onClick={() => setSplit(false)} className={`px-2 py-0.5 text-fs-12 font-bold ${!split ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>Total</button>
                  <button type="button" aria-pressed={split} onClick={() => setSplit(true)} className={`border-l border-slate-300 px-2 py-0.5 text-fs-12 font-bold ${split ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>Line by line</button>
                </span>}>Pieces made per day</Title>
              <p className="mb-1 text-fs-12 text-slate-600">
                Number on each bar = pieces made that day ({groupNameOf(IDS)}). Dashed line = average {nf(avg)} / day.
              </p>
              {split && (
                <div className="mb-1 flex flex-wrap gap-3 text-fs-12 font-semibold text-slate-700">
                  {C.lines.map((l) => <span key={l.line} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LINE_COLOR[l.line] || NAVY }} />Line {l.line}</span>)}
                </div>
              )}
              <div style={{ height: 250 }}>
                {!daily.length ? <p className="grid h-full place-items-center text-fs-13 font-semibold text-slate-500">No production in this period.</p> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={daily} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="d" tick={tick()} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
                      <YAxis tick={tick()} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                      <Tooltip cursor={{ fill: 'rgba(148,163,184,0.14)' }} isAnimationActive={false} content={({ active, payload }) => {
                        const x = active && payload?.[0]?.payload; if (!x) return null;
                        return (
                          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-fs-12 shadow">
                            <div className="font-bold text-slate-900">{x.title}</div>
                            <div className="font-extrabold text-slate-900">Total {nf(x.total)} pcs</div>
                            {C.lines.filter((l) => x[`L${l.line}`]).map((l) => <div key={l.line} className="text-slate-700">Line {l.line}: {nf(x[`L${l.line}`])}</div>)}
                          </div>
                        );
                      }} />
                      {avg > 0 && <ReferenceLine y={avg} stroke="#64748B" strokeDasharray="5 4" />}
                      {split
                        ? C.lines.map((l, i) => (
                          <Bar key={l.line} dataKey={`L${l.line}`} stackId="d" fill={LINE_COLOR[l.line] || NAVY} radius={i === C.lines.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={56} isAnimationActive={false}>
                            {i === C.lines.length - 1 && <LabelList dataKey="total" position="top" formatter={lbl} style={{ fontSize: fs(11), fill: '#334155', fontWeight: 700 }} />}
                          </Bar>))
                        : (
                          <Bar dataKey="total" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                            <LabelList dataKey="total" position="top" formatter={lbl} style={{ fontSize: fs(11), fill: '#334155', fontWeight: 700 }} />
                          </Bar>)}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              {idle.length > 0 && <p className="mt-1 text-fs-12 text-slate-500">No production on: {idle.map((d) => d.slice(8)).join(', ')}</p>}
            </section>
          </div>

          {IDS.length > 1 && C.customers.length > 0 && (
            <section className={card} aria-label="Customer by line">
              <Title right="pieces · share of the customer · its models">Customer × line</Title>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Pieces per customer and line">
                  <thead><tr className="bg-[#DCE6F2] text-[#1F3864]">
                    <th className="px-2 py-1.5 text-left">Customer</th>
                    {IDS.map((l) => <th key={l} className="px-2 py-1.5 text-right">Line {l}</th>)}
                    <th className="px-2 py-1.5 text-right">Total</th><th className="px-2 py-1.5 text-right">Share</th><th className="px-2 py-1.5 text-right">Models</th><th className="px-2 py-1.5 text-left">Top model</th>
                  </tr></thead>
                  <tbody>
                    {C.customers.map((c) => (
                      <tr key={c.name} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-bold text-slate-800">{c.name}</td>
                        {IDS.map((l) => { const n = c.byLine?.[l] || 0; return <td key={l} className={`px-2 py-1.5 text-right font-mono ${n ? 'text-slate-900' : 'text-slate-300'}`}>{n ? nf(n) : '—'}{n && c.total ? <span className="ml-1 text-fs-11 text-slate-500">{Math.round((n / c.total) * 100)}%</span> : null}</td>; })}
                        <td className="px-2 py-1.5 text-right font-mono font-extrabold">{nf(c.total)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{C.total ? `${((c.total / C.total) * 100).toFixed(1)}%` : '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{c.models.length}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-700" title={c.models[0] ? `${c.models[0].model}: ${nf(c.models[0].total)} pcs` : ''}>{c.models[0] ? <>{c.models[0].model} <span className="text-fs-11 text-slate-500">{nf(c.models[0].total)}</span></> : '—'}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-extrabold">
                      <td className="px-2 py-1.5">Total</td>
                      {IDS.map((l) => <td key={l} className="px-2 py-1.5 text-right font-mono">{nf(C.lines.find((x) => x.line === String(l))?.total || 0)}</td>)}
                      <td className="px-2 py-1.5 text-right font-mono">{nf(C.total)}</td><td className="px-2 py-1.5 text-right font-mono">100%</td><td className="px-2 py-1.5 text-right font-mono">{models}</td><td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className={card} aria-label="Customer by date">
            <Title right="click a customer for its models · same layout as the Excel">Customer × date</Title>
            {!C.customers.length ? <p className="py-4 text-center text-fs-13 font-semibold text-slate-500">Nothing made in this period.</p> : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="border-collapse text-fs-13 tabular-nums" aria-label="Pieces per customer and date">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={`${th} text-left`} style={{ position: 'sticky', left: 0, zIndex: 2, minWidth: 200 }}>Customer / model</th>
                      <th className={th}>Total</th>
                      {days.map((d) => <th key={d} className={`${th} whitespace-nowrap`}>{dmy(d).slice(0, 5)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {C.customers.map((c) => (
                      <React.Fragment key={c.name}>
                        <tr className="bg-slate-50 hover:bg-blue-50">
                          <td className={`${td} font-extrabold text-slate-900`} style={{ position: 'sticky', left: 0, background: '#F8FAFC' }}>
                            <button type="button" onClick={() => flip(c.name)} aria-expanded={open.has(c.name)} className="inline-flex items-center gap-1 text-left">
                              {open.has(c.name) ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{c.name}
                              <span className="text-fs-11 font-semibold text-slate-500">· {c.models.length} model{c.models.length === 1 ? '' : 's'}</span>
                            </button>
                          </td>
                          <td className={`${td} text-right font-mono font-extrabold`}>{nf(c.total)}</td>
                          {days.map((d) => <td key={d} className={`${td} text-right font-mono font-bold`}>{c.byDate[d] ? nf(c.byDate[d]) : ''}</td>)}
                        </tr>
                        {open.has(c.name) && c.models.map((m) => (
                          <tr key={m.model}>
                            <td className={`${td} font-mono text-slate-700`} style={{ position: 'sticky', left: 0, background: '#fff', paddingLeft: 24 }}>{m.model}</td>
                            <td className={`${td} text-right font-mono font-bold`}>{nf(m.total)}</td>
                            {days.map((d) => <td key={d} className={`${td} text-right font-mono text-slate-700`}>{m.byDate[d] ? nf(m.byDate[d]) : ''}</td>)}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-extrabold">
                      <td className={td} style={{ position: 'sticky', left: 0, background: '#F1F5F9' }}>Total</td>
                      <td className={`${td} text-right font-mono`}>{nf(C.total)}</td>
                      {days.map((d) => <td key={d} className={`${td} text-right font-mono`}>{nf(C.customers.reduce((a, c) => a + (c.byDate[d] || 0), 0))}</td>)}
                    </tr>
                    {C.lines.map((l) => (
                      <tr key={l.line}>
                        <td className={`${td} font-bold`} style={{ position: 'sticky', left: 0, background: '#fff' }}><i aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: LINE_COLOR[l.line] || NAVY }} />Line {l.line}</td>
                        <td className={`${td} text-right font-mono font-bold`}>{nf(l.total)}</td>
                        {days.map((d) => <td key={d} className={`${td} text-right font-mono`}>{l.byDate[d] ? nf(l.byDate[d]) : ''}</td>)}
                      </tr>
                    ))}
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
