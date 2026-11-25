import React, { useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { FileSpreadsheet, Download } from 'lucide-react';
import HeaderBar, { segGroup, segBtn } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { PeriodBar } from '../components/PeriodBar';
import { serverToday } from '../utils/serverTime';
import { nf, dmy, useOleData, useOleLines, groupNameOf } from '../components/OleParts';
import { exportPanel } from '../utils/domExcel';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { reworkSheet, reworkXlsxSheet, groupRows, hourCol, RWK_RATE } from '../utils/reworkReport';
import { fs } from '../theme';

/**
 * Rework dashboard (20-11-2026) — the plant's hourly rework sheet (Book1) as a dashboard: pieces, ₹ loss, dismantled,
 * hour of the day, stage, category, top defects, model, line, day trend, and the sheet itself (Excel in the plant layout).
 * Rework and rejection rows of the entry pages (utils/reworkReport.js).
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const NAVY = '#1F3864', GRID = '#E2E8F0';
const rs = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const tick = () => ({ fontSize: fs(12), fill: '#334155' });
const th = 'border border-[#BFBFBF] px-1.5 py-1';
const td = 'border border-[#D4D4D4] px-1.5 py-1';

function Tile({ name, value, sub, tone = 'text-slate-900', testid }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid={testid}>
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className={`lp-clamp2 mt-1 font-extrabold leading-tight tabular-nums ${typeof value === 'string' && !/\d/.test(value) && value.length > 9 ? 'text-fs-20' : 'font-mono text-fs-28'} ${tone}`} title={String(value)}>{value}</div>   {/* 25-11-2026: a name (top stage, category) in a smaller font */}
      {sub && <div className="lp-clamp2 mt-1 text-fs-12 text-slate-600" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
    </div>
  );
}
function Title({ children, right }) {
  return <div className="mb-2 flex flex-wrap items-baseline gap-2"><h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">{children}</h3>{right && <span className="ml-auto text-fs-12 font-semibold text-slate-500">{right}</span>}</div>;
}
/** ranked bars of one hue, the share beside each name; a click filters */
function Ranked({ rows, total, onPick, active, label, max = 10 }) {
  const top = rows.slice(0, max);
  const hi = Math.max(1, ...top.map((r) => r.total));
  if (!top.length) return <p className="py-4 text-center text-fs-13 font-semibold text-slate-500">Nothing in this period.</p>;
  return (
    <div className="flex flex-col gap-1" role="list" aria-label={label}>
      {top.map((r) => (
        <button key={r.key} type="button" role="listitem" onClick={() => onPick?.(r.key)} aria-pressed={active === r.key}
          className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_4.5rem] items-center gap-2 rounded px-1 py-0.5 text-left text-fs-13 hover:bg-slate-50 ${active === r.key ? 'bg-blue-50 ring-1 ring-blue-300' : ''}`}>
          <span className="lp-clamp2 font-semibold text-slate-800" title={r.key}>{r.key}</span>
          <span className="h-3 overflow-hidden rounded bg-slate-100"><span className="block h-full rounded" style={{ width: `${(r.total / hi) * 100}%`, background: NAVY }} /></span>
          <span className="text-right font-mono font-bold text-slate-900">{nf(r.total)} <span className="text-fs-11 font-semibold text-slate-500">{total ? `${Math.round((r.total / total) * 100)}%` : ''}</span></span>
        </button>
      ))}
    </div>
  );
}

export default function ReworkDashboardPage() {
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: `${today.slice(0, 8)}01`, end: today });
  const [sel, setSel] = useState('all');
  const [kind] = useState('both');   // rework + any old rejection rows
  const [pick, setPick] = useState(null);   // { field, key } — one filter from a click
  const IDS = sel === 'all' ? ALL : [sel];
  const D = useOleData({ start: range.start, end: range.end, ids: ALL });
  const S = useMemo(() => {
    if (!D.al && !Object.keys(D.ent.entries || {}).length) return null;
    const co = new Map();
    for (const L of D.al?.lines || []) for (const m of L.models || []) if (m.model && m.company) co.set(m.model, m.company);
    return reworkSheet({ entries: D.ent.entries || {}, start: range.start, end: range.end, ids: IDS, stations: D.ent.reasons?.station || [], companyOf: (m) => co.get(m) || '',
      kinds: kind === 'both' ? ['rework', 'reject'] : [kind], rate: RWK_RATE });
  }, [D.al, D.ent, range.start, range.end, IDS.join(), kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (S ? (pick ? S.rows.filter((r) => (r[pick.field] || 'Not given') === pick.key) : S.rows) : []), [S, pick]);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const money = rows.reduce((a, r) => a + r.rs, 0);
  const dis = rows.reduce((a, r) => a + r.dismantle, 0);
  const by = (f) => groupRows(rows, f);
  const defects = by('defect'), stages = by('stage'), cats = by('cat'), models = by('model'), lines = by('lineName');
  const hours = (S?.hours || []).map((h) => ({ k: hourCol(h), n: rows.reduce((a, r) => a + (r.hours[h] || 0), 0) }));
  const days = groupRows(rows, 'date').sort((a, b) => a.key.localeCompare(b.key)).map((d) => ({ k: d.key.slice(8), title: dmy(d.key), n: d.total }));
  const setP = (field) => (key) => setPick((p) => (p && p.field === field && p.key === key ? null : { field, key }));
  const act = (field) => (pick?.field === field ? pick.key : null);
  const bodyRef = useRef(null);
  const periodText = range.start === range.end ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  // 23-11-2026: no separate rejection (a piece is reworked or dismantled) — old rejection rows still count, shown as rework
  const word = 'Rework';

  if (!ALL.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  return (
    <div className="flex flex-col gap-3" aria-label="Rework dashboard" role="region">
      <HeaderBar label="Rework dashboard filters">
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!S} />
        <button type="button" disabled={!S} onClick={() => exportPanel(bodyRef.current, `Rework dashboard ${groupNameOf(IDS)}`, periodText)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50" aria-label="Export to Excel"><FileSpreadsheet size={15} />Excel</button>
        <button type="button" disabled={!S} onClick={() => downloadXlsx(buildXlsx([reworkXlsxSheet({ rows, hours: S.hours, totals: { total, rs: money, hours: Object.fromEntries(S.hours.map((h) => [h, rows.reduce((a, r) => a + (r.hours[h] || 0), 0)])) } })]), `Hourly rework data ${range.start} to ${range.end}.xlsx`)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-700 bg-blue-700 px-2.5 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-50" aria-label="Download rework sheet"><Download size={15} />Rework sheet</button>
      </HeaderBar>
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!S ? <PageLoader label="Reading the entries" sub="Rework, rejection, defects" /> : (
        <div ref={bodyRef} className="flex flex-col gap-3">
          {pick && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-fs-13 font-semibold text-blue-900">
              Only {pick.field === 'lineName' ? 'line' : pick.field === 'cat' ? 'category' : pick.field}: <b>{pick.key}</b>
              <button type="button" onClick={() => setPick(null)} className="ml-auto rounded-md border border-blue-300 bg-white px-2 py-0.5 font-bold hover:bg-blue-100">Show all ✕</button>
            </div>
          )}
          <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Rework totals">
            <Tile testid="rw-total" name={`${word} pcs`} value={nf(total)} sub={`${rows.length} entries`} tone={total ? 'text-red-700' : 'text-slate-900'} />
            <Tile testid="rw-rs" name="Loss (INR)" value={rs(money)} sub={`₹${RWK_RATE} per piece`} />
            <Tile testid="rw-dis" name="Dismantled" value={nf(dis)} sub={total ? `${Math.round((dis / total) * 100)}% of the pieces` : '—'} tone={dis ? 'text-red-700' : 'text-slate-900'} />
            <Tile testid="rw-defects" name="Defect types" value={nf(defects.length)} sub={defects[0] ? `Top: ${defects[0].key}` : '—'} />
            <Tile testid="rw-stage" name="Top stage" value={stages[0]?.key || '—'} sub={stages[0] ? `${nf(stages[0].total)} pcs` : ''} />
            <Tile testid="rw-cat" name="Top category" value={cats[0]?.key || '—'} sub={cats[0] ? `${nf(cats[0].total)} pcs` : ''} />
          </section>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className={card} aria-label="By hour of the day">
              <Title right="pieces">Hour of the day</Title>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hours} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
                    <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval={0} angle={hours.length > 12 ? -35 : 0} textAnchor={hours.length > 12 ? 'end' : 'middle'} height={hours.length > 12 ? 44 : 24} />
                    <YAxis tick={tick()} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,0.14)' }} isAnimationActive={false} formatter={(v) => [nf(v), 'Pieces']} />
                    <Bar dataKey="n" fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}><LabelList dataKey="n" position="top" style={{ fontSize: fs(11), fill: '#334155', fontWeight: 700 }} formatter={(v) => (v ? v : '')} /></Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className={card} aria-label="Day by day">
              <Title right="pieces">Day by day</Title>
              <div className="h-[220px]">
                {!days.length ? <p className="grid h-full place-items-center text-fs-13 font-semibold text-slate-500">Nothing in this period.</p> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={days} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                      <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
                      <YAxis tick={tick()} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'rgba(148,163,184,0.14)' }} isAnimationActive={false} labelFormatter={(_, p) => p?.[0]?.payload?.title || ''} formatter={(v) => [nf(v), 'Pieces']} />
                      <Bar dataKey="n" fill="#5B8DC9" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            <section className={card} aria-label="Top defects"><Title right="click to filter">Top defects</Title><Ranked rows={defects} total={total} onPick={setP('defect')} active={act('defect')} label="Defects" /></section>
            <section className={card} aria-label="By stage"><Title>By stage</Title><Ranked rows={stages} total={total} onPick={setP('stage')} active={act('stage')} label="Stages" /></section>
            <section className={card} aria-label="By category"><Title>By category</Title><Ranked rows={cats} total={total} onPick={setP('cat')} active={act('cat')} label="Categories" /></section>
            <section className={card} aria-label="By model"><Title>By model</Title><Ranked rows={models} total={total} onPick={setP('model')} active={act('model')} label="Models" /></section>
            <section className={card} aria-label="By line"><Title>By line</Title><Ranked rows={lines} total={total} onPick={setP('lineName')} active={act('lineName')} label="Lines" /></section>
            <section className={card} aria-label="Dismantled by defect"><Title>Dismantled — by defect</Title><Ranked rows={groupRows(rows.filter((r) => r.dismantle > 0).map((r) => ({ ...r, total: r.dismantle })), 'defect')} total={dis} label="Dismantled defects" /></section>
          </div>

          <section className={card} aria-label="Rework sheet">
            <Title right="as the plant's Hrly. Rework data (IPQC)">Rework sheet</Title>
            {!rows.length ? <p className="text-fs-14 text-slate-600">No rework or rejection written in this period.</p> : (
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full border-collapse text-fs-12 tabular-nums" aria-label="Rework sheet table">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#1F3864] text-center text-white">
                      {['Sr', 'Date', 'Stage', 'Line', 'Brand', 'Model', 'Category', 'Defect', 'Root cause', 'Action', 'Total'].map((h) => <th key={h} className={th}>{h}</th>)}
                      {S.hours.map((h) => <th key={h} className={`${th} whitespace-nowrap`}>{hourCol(h)}</th>)}
                      <th className={th}>INR (Rs)</th>
                    </tr>
                    <tr className="bg-[#DDEBF7] text-center font-bold text-[#1F3864]">
                      <td className={`${td} text-left`} colSpan={10}>Total</td><td className={`${td} font-mono`}>{nf(total)}</td>
                      {S.hours.map((h) => { const n = rows.reduce((a, r) => a + (r.hours[h] || 0), 0); return <td key={h} className={`${td} font-mono`}>{n || ''}</td>; })}
                      <td className={`${td} font-mono`}>{nf(money)}</td>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 500).map((r, i) => (
                      <tr key={i} className="text-center hover:bg-[#DDEBF7]/40">
                        <td className={td}>{i + 1}</td><td className={`${td} whitespace-nowrap`}>{dmy(r.date)}</td><td className={`${td} whitespace-nowrap`}>{r.stage || '—'}</td><td className={`${td} whitespace-nowrap`}>{r.lineName}</td>
                        <td className={td}>{r.brand}</td><td className={`${td} font-mono`}>{r.model}</td><td className={td}>{r.cat || '—'}</td>
                        <td className={`${td} text-left font-semibold`}>{r.defect}{r.dismantle > 0 && <span className="ml-1 rounded bg-red-50 px-1 text-fs-11 font-bold text-red-700 ring-1 ring-red-200">{r.dismantle} dis.</span>}</td>
                        <td className={`${td} text-left`}>{r.cause}</td><td className={`${td} text-left`}>{r.action}</td><td className={`${td} font-mono font-bold`}>{r.total}</td>
                        {S.hours.map((h) => <td key={h} className={`${td} font-mono ${r.hours[h] ? 'bg-amber-50 font-bold' : ''}`}>{r.hours[h] || ''}</td>)}
                        <td className={`${td} font-mono`}>{nf(r.rs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
