import React, { useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, ReferenceLine, ComposedChart, Line } from 'recharts';
import { FileSpreadsheet } from 'lucide-react';
import HeaderBar, { segGroup, segBtn } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { PeriodBar } from '../components/PeriodBar';
import { serverToday } from '../utils/serverTime';
import { nf, dmy, p2, useOleData, useOleLines, groupNameOf, companyOf, CompanyCell, plantOf } from '../components/OleParts';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { useLastScans } from '../hooks/useLastScans';
import { oleRange, okFrom, watchFrom, hm } from '../utils/ole';
import { Pareto, Donut, DeptDrawer, withDept, NoDeptNote, deptRowsOf } from './OleFocusPage';
import { availDash, perfDash, modelHours } from '../utils/factorDash';
import MesDrawer from '../components/MesDrawer';
import { exportPanel } from '../utils/domExcel';
import { fs } from '../theme';

/**
 * 26-11-2026: Availability dashboard and Performance dashboard — one page each, in the look of the Quality dashboard:
 * KPI tiles, line × day, day by day against the target, line by line, the reasons / models, line × hour of the day.
 * Same figures as OLE Overview and the Availability / Performance pages (utils/factorDash.js).
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const NAVY = '#1F3864', GRID = '#E2E8F0';
const tick = () => ({ fontSize: fs(12), fill: '#334155' });
const th = 'border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-fs-12 font-extrabold text-slate-700';
const td = 'border-b border-slate-100 px-2 py-1.5';
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const hh = (min) => (min == null ? '—' : `${(min / 60).toFixed(1)} h`);
// under an hour in minutes (a slow model loses minutes, not hours)
const dur = (min) => (min == null ? '—' : min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`);
const sec = (s) => (s == null ? '—' : `${Math.round(s * 10) / 10}s`);
const signed = (v) => (v == null ? '—' : v > 0 ? `+${nf(v)}` : v < 0 ? `−${nf(-v)}` : '0');   // 27-11-2026: + / − (colour shows excess / short)
const LineName = ({ l }) => <span className="whitespace-nowrap font-bold text-slate-900">Line {l}{plantOf(l) ? <span className="ml-1 text-fs-12 font-semibold text-slate-500">({plantOf(l)})</span> : null}</span>;

function Tile({ name, value, sub, tone = 'text-slate-900', testid }) {
  return (
    <div data-testid={testid} className="lp-tile min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className={`mt-1 break-words font-extrabold leading-tight tabular-nums ${typeof value === 'string' && !/\d/.test(value) && value.length > 9 ? 'text-fs-18' : 'font-mono text-fs-28'} ${tone}`} title={String(value)}>{value}</div>
      {sub && <div className="mt-1 break-words text-fs-12 text-slate-600" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
    </div>
  );
}
function Title({ children, right }) {
  return <div className="mb-2 flex flex-wrap items-baseline gap-2"><h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">{children}</h3>{right && <span className="ml-auto text-fs-12 font-semibold text-slate-500">{right}</span>}</div>;
}
const Empty = ({ text }) => <p className="py-4 text-center text-fs-13 font-semibold text-slate-500">{text}</p>;

/** ranked bars of one hue: rows = [{ key, label, value, right, title }] */
function Ranked({ rows, label, max = 10, empty, onPick = null }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, max);
  const hi = Math.max(1e-9, ...list.map((r) => r.value));
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="flex flex-col gap-1" role="list" aria-label={label}>
      {list.map((r) => (
        <div key={r.key} role="listitem" className={`grid items-center gap-2 rounded px-1 py-0.5 text-fs-13 ${onPick ? 'cursor-pointer hover:bg-blue-50' : ''}`} style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr) 7.5rem' }} title={onPick ? `${r.title || ''} — click for details` : r.title || r.label}
          {...(onPick ? { tabIndex: 0, 'data-testid': `ranked-${r.key}`, onClick: () => onPick(r.key), onKeyDown: (e) => { if (e.key === 'Enter') onPick(r.key); } } : {})}>
          <span className="break-words font-semibold leading-tight text-slate-800">{r.label}</span>
          <span className="h-3 overflow-hidden rounded bg-slate-100"><span className="block h-full rounded" style={{ width: `${(r.value / hi) * 100}%`, background: NAVY }} /></span>
          <span className="text-right font-mono font-bold text-slate-900">{r.right}</span>
        </div>
      ))}
      {rows.length > max && <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 self-start rounded-md border border-slate-300 bg-white px-2.5 py-1 text-fs-12 font-bold text-dixon-navy hover:bg-slate-50">{all ? `Show top ${max}` : `Show all ${rows.length}`}</button>}
    </div>
  );
}

export default function FactorDashboardPage({ factor = 'A' }) {
  const isA = factor === 'A';
  const name = isA ? 'Availability' : 'Performance';
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: `${today.slice(0, 8)}01`, end: today });
  const [sel, setSel] = useState('all');
  const IDS = useMemo(() => (sel === 'all' ? ALL : [sel]), [sel, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const oneDay = range.start === range.end;
  const settings = useAllLineSettings(ALL);
  const D = useOleData({ start: range.start, end: range.end, ids: ALL });
  const R0 = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, range.start, range.end, today, D.endMin, ALL]); // eslint-disable-line react-hooks/exhaustive-deps
  // the finished days end at the line's last scan, as on the OLE pages (same Plan Target Qty)
  const lastScans = useLastScans({ R: R0, ids: ALL, today });
  const R = useMemo(() => (R0 && Object.keys(lastScans).length ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL, lastScans }) : R0), [R0, lastScans]); // eslint-disable-line react-hooks/exhaustive-deps
  const co = useMemo(() => companyOf(D.al), [D.al]);
  const X = useMemo(() => (R ? (isA ? availDash(R, IDS) : perfDash(R, IDS)) : null), [R, IDS, isA]);
  const bodyRef = useRef(null);
  const [mdl, setMdl] = useState(null);   // 26-11-2026: a model row clicked → its hours (drawer)
  const [mh, setMh] = useState({ k: 'date', dir: 1, day: '', only: 'all' });   // 27-11-2026: sort / filter of the model's hours
  React.useEffect(() => { setMh({ k: 'date', dir: 1, day: '', only: 'all' }); }, [mdl?.key]);   // a new model starts unfiltered
  const [deptOpen, setDeptOpen] = useState(null);
  const [idleModel, setIdleModel] = useState(null);
  const [idleReason, setIdleReason] = useState(null);   // 27-11-2026: an idle reason clicked → its entries   // 27-11-2026: a model of the idle list clicked → its entries   // 27-11-2026: a department clicked → its reasons (drawer)
  const openDay = (date) => setRange({ start: date, end: date });
  const openLine = (l) => setSel((s0) => (s0 === String(l) ? 'all' : String(l)));
  const ok = okFrom(factor), watch = watchFrom(factor);
  const tone = (v) => (v == null ? 'text-slate-500' : v >= ok ? 'text-emerald-700' : v >= watch ? 'text-amber-700' : 'text-red-700');
  const fill = (v) => (v == null ? '#CBD5E1' : v >= ok ? '#16A34A' : v >= watch ? '#D97706' : '#EB5757');
  const cellBg = (v) => (v == null ? '' : v >= ok ? 'bg-emerald-50 text-emerald-800' : v >= watch ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800');
  const periodText = oneDay ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  const group = sel === 'all' ? groupNameOf(ALL) : `Line ${sel}`;
  const v = (o) => (isA ? o.A : o.P);

  if (!ALL.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  const t = X?.total;
  return (
    <div className="flex flex-col gap-3" aria-label={`${name} dashboard`} role="region" data-testid={`fd-${factor}`}>
      <HeaderBar label={`${name} dashboard filters`}>
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!R} />
        <button type="button" disabled={!X} onClick={() => exportPanel(bodyRef.current, `${name} dashboard ${group}`, periodText)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-700 bg-blue-700 px-2.5 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-50" aria-label="Download the screen as Excel">
          <FileSpreadsheet size={15} aria-hidden="true" /> Excel
        </button>
      </HeaderBar>
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!X ? <PageLoader label="Reading the lines" sub={isA ? 'Planned time, run time, idle time' : 'Pieces, plan, cycle time'} /> : (
        <div ref={bodyRef} className={`flex flex-col gap-3 ${isA ? 'lp-adash' : 'lp-pdash'}`}>
          {/* KPI tiles */}
          {isA ? (
            <section className="lp-kpis grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" aria-label="Availability of the period">
              <Tile testid="fd-main" name="Availability" value={pct(t.A)} sub={`Target ${(ok * 100).toFixed(0)}% · ${group}`} tone={tone(t.A)} />
              <Tile name="Planned time" value={hh(t.planned)} sub="shift time without breaks" />
              <Tile name="Run time" value={hh(t.run)} sub={t.planned ? `${pct(t.run / t.planned)} of planned` : '—'} />
              <Tile name="Idle time" value={hh(t.idle)} sub={t.planned ? `${pct(t.idle / t.planned)} of planned` : '—'} tone={t.idle > 0 ? 'text-red-700' : 'text-slate-900'} />
              <Tile name="Top reason" value={X.reasons[0]?.name || '—'} sub={X.reasons[0] ? `${hh(X.reasons[0].min)}${X.reasons[0].dept !== 'Not set' ? ` · ${X.reasons[0].dept}` : ''}` : 'no idle time written'} tone={X.reasons[0] ? 'text-red-700' : 'text-slate-900'} />
            </section>
          ) : (
            <section className="lp-kpis grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" aria-label="Performance of the period">
              <Tile testid="fd-main" name="Performance" value={pct(t.P)} sub={`Target ${(ok * 100).toFixed(0)}% · ${group}`} tone={tone(t.P)} />
              <Tile name="Plan target qty" value={nf(t.target)} sub="HPR / SAWM plan" />
              <Tile name="Actual qty" value={nf(t.qty)} sub={t.ach == null ? '—' : `${pct(t.ach)} of the plan`} tone={t.ach == null ? 'text-slate-900' : t.ach >= 1 ? 'text-emerald-700' : 'text-red-700'} />
              <Tile name="+ / − vs plan" value={signed(t.short)} sub={t.short == null ? '—' : t.short < 0 ? 'pieces short of the plan' : 'pieces over the plan'} tone={t.short == null ? 'text-slate-900' : t.short < 0 ? 'text-red-700' : 'text-emerald-700'} />
              <Tile name="Cycle time" value={sec(t.act)} sub={`actual · std ${sec(t.std)}`} tone={t.act != null && t.std != null && t.act > t.std * 1.005 ? 'text-red-700' : 'text-emerald-700'} />
              <Tile name="Speed loss" value={hh(t.speed)} sub="run time beyond the std cycle" tone={t.speed >= 3 ? 'text-red-700' : 'text-slate-900'} />
              <Tile name="Good qty" value={nf(t.good)} sub={t.qty ? `${pct(t.good / t.qty)} of actual qty` : 'pcs right'} tone="text-emerald-700" />
              <Tile name="Rework" value={nf(t.rework + t.rejects)} sub={`${nf(Math.max(0, t.rework - t.dismantle))} passed after rework${t.rejects ? ` · ${nf(t.rejects)} rejected` : ''}`} tone={t.rework + t.rejects ? 'text-red-700' : 'text-slate-900'} />
              <Tile name="Dismantle" value={nf(t.dismantle)} sub="pieces opened up for rework" tone={t.dismantle ? 'text-red-700' : 'text-slate-900'} />
            </section>
          )}

          {/* 26-11-2026: as on the Availability page, right under the tiles: the Pareto of the reasons and who owns the time */}
          {isA && (() => {
            const hrs = (m) => hm(Math.max(0, Number(m) || 0));
            const byDept = {};
            for (const r of X.reasons) (byDept[r.dept] = byDept[r.dept] || []).push({ label: r.name, value: r.min, n: r.n });
            const depts = X.depts.map((d) => ({ label: d.name, value: d.min }));
            return (
              <div className="lp-ad-wrap grid grid-cols-1 gap-3 xl:grid-cols-3">
                <section className={`${card} lp-ad-reasons xl:col-span-2`} aria-label="Idle time reasons Pareto">
                  <Title right="Pareto by time lost">Idle time reasons</Title>
                  <Pareto rows={X.reasons.map((r) => ({ label: r.name, value: r.min }))} fmt={hrs} time color="#EB5757" empty="No idle time in this period." onPick={(k) => setIdleReason(k)} />
                </section>
                <section className={`${card} lp-ad-dept`} aria-label="Share by department">
                  <Title right="who owns the lost time">Share by department</Title>
                  <Donut top={6} rows={withDept(depts)} fmt={hrs} centre="idle time" empty="No idle time in this period." onPick={(lab) => setDeptOpen(lab)} />
                  {deptOpen && <DeptDrawer dept={deptOpen} rows={deptRowsOf(byDept, deptOpen)} fmt={hrs} sub={`${group} · ${periodText || ''}`} onClose={() => setDeptOpen(null)} />}
                  <NoDeptNote rows={depts} fmt={hrs} />
                </section>
              </div>
            );
          })()}

          {/* 27-11-2026: "Where the speed is lost" taken off (as asked) */}

          {/* 26-11-2026: cycle time variation — model by model, hour by hour, day by day; and the reasons written as performance loss */}
          {!isA && (() => {
            const V = X.variation, hiV = Math.max(0.01, ...V.map((m) => Math.abs(m.var)));
            return (
              <>
                <div className="lp-ad-wrap grid grid-cols-1 gap-3">
                  <section className={`${card} lp-pd-var`} aria-label="Cycle time variation by model">
                    <Title right="actual cycle against std · highest variation first · click a model for its hours">Cycle time variation · by model</Title>
                    {!V.length ? <Empty text="No model with enough pieces and a std cycle." /> : (
                      <div className="lp-pd-varlist flex max-h-[300px] flex-col gap-1 overflow-y-auto pr-1" role="list" aria-label="Cycle time variation by model">
                        {V.map((m) => (
                          <div key={m.key} role="listitem" tabIndex={0} onClick={() => setMdl(m)} onKeyDown={(e) => { if (e.key === 'Enter') setMdl(m); }} title={`${m.model} on Line ${m.line}: ${sec(m.act)} against std ${sec(m.std)} · ${nf(m.qty)} pcs`}
                            className="grid cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-fs-13 hover:bg-blue-50" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) 9.5rem' }}>
                            <span className="truncate font-semibold leading-tight text-slate-800"><span className="font-mono">{m.model}</span> <span className="text-fs-12 text-slate-500">L{m.line}</span></span>
                            <span className="relative h-3 rounded bg-slate-100"><span className="absolute top-0 h-full w-px bg-slate-400" style={{ left: '50%' }} />
                              <span className="absolute top-0 h-full rounded" style={m.var > 0 ? { left: '50%', width: `${(m.var / hiV) * 50}%`, background: '#EB5757' } : { right: '50%', width: `${(-m.var / hiV) * 50}%`, background: '#16A34A' }} /></span>
                            <span className={`text-right font-mono font-bold ${m.var > 0.005 ? 'text-red-700' : 'text-emerald-700'}`}>{m.var > 0 ? '+' : ''}{(m.var * 100).toFixed(1)}% <span className="text-fs-12 font-semibold text-slate-500">{sec(m.act)}/{sec(m.std)}</span></span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
                {/* 27-11-2026: cycle time by hour / day by day taken off (as asked); the reasons only when some are written */}
                {X.reasons.length > 0 && (
                  <section className={`${card} lp-pd-reasons`} aria-label="Performance loss reasons">
                    <Title right="minutes written against a model (Loss entry)">Performance loss reasons</Title>
                    <Pareto rows={X.reasons.map((r) => ({ label: r.name, value: r.min }))} fmt={(m) => dur(m)} time color="#EB5757" />
                  </section>
                )}
              </>
            );
          })()}

          {/* 27-11-2026: the line × day table taken off (as asked) — Day by day below shows the same days */}

          {/* 26-11-2026: one under the other — the line table has many columns and must not be cut */}
          <div className="lp-ad-wrap grid grid-cols-1 gap-3">
            {/* day by day — 27-11-2026: taken off both dashboards (as asked) */}
            {false && (
            <section className={card} aria-label={`${name} day by day`}>
              <Title right={`${t.worstDay ? `lowest ${dmy(t.worstDay.date)} · ${pct(v(t.worstDay))} · ` : ''}click a day to open it`}>Day by day</Title>
              {!X.days.length ? <Empty text="No production in this period." /> : (
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={X.days.map((d) => ({ day: d.date.slice(8, 10), date: d.date, v: v(d) == null ? null : Math.round(v(d) * 1000) / 10 }))} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}
                      onClick={(e) => { const d0 = e?.activePayload?.[0]?.payload?.date; if (d0 && !oneDay) openDay(d0); }} style={{ cursor: 'pointer' }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="day" tick={tick()} />
                      <YAxis tick={tick()} width={44} unit="%" domain={[0, (max) => Math.max(100, Math.ceil(max / 10) * 10)]} />
                      <Tooltip formatter={(x) => [`${x}%`, name]} labelFormatter={(_, p) => (p?.[0] ? dmy(p[0].payload.date) : '')} />
                      <ReferenceLine y={ok * 100} stroke="#16A34A" strokeDasharray="5 4" label={{ value: `target ${(ok * 100).toFixed(0)}%`, position: 'insideTopRight', fill: '#166534', fontSize: fs(11) }} />
                      <Bar dataKey="v" maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {X.days.map((d) => <Cell key={d.date} fill={fill(v(d))} />)}
                        <LabelList dataKey="v" position="top" style={{ fontSize: fs(11), fill: '#334155', fontWeight: 700 }} formatter={(x) => (x == null ? '' : Math.round(x))} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            )}

            {/* line by line */}
            <section className={`${card} lp-ad-lines`} aria-label={`${name} line by line`}>
              <Title right={isA ? 'time, main reason' : 'plan, pieces, cycle, slowest model'}>Line by line</Title>
              <div className="overflow-x-auto">
                {isA ? (
                  <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Availability line by line table">
                    <thead><tr>{['Line', 'Planned', 'Run', 'Idle', 'Availability', 'Main reason', 'Dept.'].map((h, i) => <th key={h} className={`${th} ${i > 0 && i < 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {X.lines.map((r) => (
                        <tr key={r.line} className="cursor-pointer hover:bg-slate-50" title="Only this line" onClick={() => openLine(r.line)}>
                          <td className={td}><LineName l={r.line} /></td>
                          <td className={`${td} text-right font-mono`}>{hh(r.planned)}</td>
                          <td className={`${td} text-right font-mono`}>{hh(r.run)}</td>
                          <td className={`${td} text-right font-mono font-bold ${r.idle > 0 ? 'text-red-700' : 'text-slate-500'}`}>{hh(r.idle)}</td>
                          <td className={`${td} text-right font-mono font-extrabold ${tone(r.A)}`}>{pct(r.A)}</td>
                          <td className={`${td} font-semibold`}>{r.topReason || '—'}</td>
                          <td className={td}>{r.topDept && r.topDept !== 'Not set' ? r.topDept : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Performance line by line table">
                    <thead><tr>{['Line', 'Plan', 'Actual', '+ / − vs plan', 'Achieved', 'Std CT', 'Actual CT', 'Speed loss', 'Performance', 'Slowest model'].map((h, i) => <th key={h} className={`${th} ${i > 0 && i < 9 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {X.lines.map((r) => (
                        <tr key={r.line} className="cursor-pointer hover:bg-slate-50" title="Only this line" onClick={() => openLine(r.line)}>
                          <td className={td}><LineName l={r.line} /></td>
                          <td className={`${td} text-right font-mono`}>{nf(r.target)}</td>
                          <td className={`${td} text-right font-mono font-bold`}>{nf(r.qty)}</td>
                          <td className={`${td} whitespace-nowrap text-right font-bold ${r.short == null ? '' : r.short < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{signed(r.short)}</td>
                          <td className={`${td} text-right font-mono`}>{pct(r.ach)}</td>
                          <td className={`${td} text-right font-mono`}>{sec(r.std)}</td>
                          <td className={`${td} text-right font-mono ${r.act != null && r.std != null && r.act > r.std * 1.005 ? 'font-bold text-red-700' : 'text-emerald-700'}`}>{sec(r.act)}</td>
                          <td className={`${td} text-right font-mono ${r.speed >= 3 ? 'font-bold text-red-700' : 'text-slate-500'}`}>{hh(r.speed)}</td>
                          <td className={`${td} text-right font-mono font-extrabold ${tone(r.P)}`}>{pct(r.P)}</td>
                          <td className={`${td} font-mono font-semibold`}>{r.worst || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>

          {/* reasons / models */}
          {isA ? (
            <div className="lp-ad-wrap grid grid-cols-1 gap-3">
              <section className={`${card} lp-ad-models`} aria-label="Idle time by model">
                <Title right="idle written against a model · click a model for its entries">Models</Title>
                <Ranked label="Idle time by model" empty="No idle time written against a model." onPick={(k) => setIdleModel(k)} rows={X.models.map((m) => ({ key: m.name, label: <span><span className="mr-1 text-fs-11 font-bold uppercase text-slate-500">{co(m.name)}</span><span className="font-mono">{m.name}</span></span>, value: m.min, right: `${dur(m.min)} · ${m.n === 1 ? '1 time' : `${m.n} times`}`, title: `${m.name}: mostly ${m.top}` }))} />
              </section>
              {idleReason && (() => {
                const r = X.reasons.find((x) => x.name === idleReason); if (!r) return null;
                const items = [...(r.items || [])].sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0) || Number(p.line) - Number(q.line) || p.hour - q.hour);
                const by = (k) => { const m = new Map(); for (const x of items) { const key = x[k] || '—'; const o = m.get(key) || { key, min: 0, n: 0 }; o.min += x.min; o.n += 1; m.set(key, o); } return [...m.values()].sort((a, b) => b.min - a.min); };
                const thd = 'px-2 py-1.5 font-bold', tdd = 'px-2 py-1.5 border-b border-[#E5E7EB]';
                const small = (title, list, lab = (k) => k) => (
                  <div className="rounded-lg border border-slate-200 p-2"><div className="mb-1 text-fs-12 font-extrabold uppercase tracking-wide text-[#1F3864]">{title}</div>
                    {list.slice(0, 10).map((x) => <div key={x.key} className="flex items-baseline justify-between gap-2 py-0.5 text-fs-13"><span className="min-w-0 break-words font-semibold">{lab(x.key)}</span><span className="whitespace-nowrap font-mono font-bold text-red-700">{dur(x.min)} <span className="font-normal text-slate-500">· {x.n}×</span></span></div>)}</div>);
                return (
                  <MesDrawer title={`${r.name} · idle time`} sub={`${group} · ${periodText} · ${dur(r.min)} in ${r.n === 1 ? '1 entry' : `${r.n} entries`}${r.dept && r.dept !== 'Not set' ? ` · ${r.dept}` : ''}`} onClose={() => setIdleReason(null)} label={`${r.name} entries`} width={65} fit minWidth={560} bodyClass="p-2">
                    <div data-testid="idle-reason-drawer" className="flex flex-col gap-3">
                      <div className="grid gap-2 md:grid-cols-3">{small('Line-wise', by('line'), (k) => `Line ${k}`)}{small('Model-wise', by('model'), (k) => (k === '—' ? 'No model' : k))}{small('Department', by('dept'), (k) => (k === 'Not set' ? 'Other' : k))}</div>
                      <table className="w-full border-collapse text-fs-14 tabular-nums">
                        <thead><tr className="bg-[#1F3864] text-left text-white">{['Date', 'Line', 'Hour', 'Model', 'Dept.', 'Time'].map((h, i) => <th key={h} className={`${thd} ${i === 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                        <tbody>{items.map((x, i) => <tr key={i} className={i % 2 ? 'bg-[#F8FAFC]' : ''}><td className={`${tdd} whitespace-nowrap`}>{dmy(x.date)}</td><td className={tdd}><LineName l={x.line} /></td><td className={`${tdd} whitespace-nowrap font-mono`}>{p2(x.hour)}:00–{p2((x.hour + 1) % 24)}:00</td><td className={`${tdd} font-mono`}>{x.model || '—'}</td><td className={tdd}>{x.dept && x.dept !== 'Not set' ? x.dept : 'Other'}</td><td className={`${tdd} text-right font-bold text-red-700`}>{dur(x.min)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </MesDrawer>
                );
              })()}
              {idleModel && (() => {
                const m = X.models.find((x) => x.name === idleModel); if (!m) return null;
                const items = [...(m.items || [])].sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0) || Number(p.line) - Number(q.line) || p.hour - q.hour);
                const byR = [...(m.reasons || new Map()).entries()].map(([name, min]) => ({ name, min, n: items.filter((x) => x.reason === name).length })).sort((p, q) => q.min - p.min);
                const thd = 'px-2 py-1.5 font-bold', tdd = 'px-2 py-1.5 border-b border-[#E5E7EB]';
                return (
                  <MesDrawer title={`${co(m.name) ? `${co(m.name)} · ` : ''}${m.name} · idle time`} sub={`${group} · ${periodText} · ${dur(m.min)} in ${m.n === 1 ? '1 entry' : `${m.n} entries`}`} onClose={() => setIdleModel(null)} label={`${m.name} idle entries`} width={65} fit minWidth={560} bodyClass="p-2">
                    <div data-testid="idle-model-drawer">
                      <div className="mb-1 text-fs-13 font-extrabold uppercase tracking-wide text-[#1F3864]">Reasons</div>
                      <table className="mb-3 w-full border-collapse text-fs-14 tabular-nums">
                        <thead><tr className="bg-[#1F3864] text-left text-white">{['Reason', 'Times', 'Time lost', 'Share'].map((h, i) => <th key={h} className={`${thd} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                        <tbody>{byR.map((r) => <tr key={r.name}><td className={`${tdd} font-semibold`}>{r.name}</td><td className={`${tdd} text-right`}>{nf(r.n)}</td><td className={`${tdd} text-right font-bold text-red-700`}>{dur(r.min)}</td><td className={`${tdd} text-right`}>{m.min ? `${Math.round((r.min / m.min) * 1000) / 10}%` : '—'}</td></tr>)}</tbody>
                      </table>
                      <div className="mb-1 text-fs-13 font-extrabold uppercase tracking-wide text-[#1F3864]">Every entry</div>
                      <table className="w-full border-collapse text-fs-14 tabular-nums">
                        <thead><tr className="bg-[#1F3864] text-left text-white">{['Date', 'Line', 'Hour', 'Reason', 'Dept.', 'Time'].map((h, i) => <th key={h} className={`${thd} ${i === 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                        <tbody>{items.map((x, i) => <tr key={i} className={i % 2 ? 'bg-[#F8FAFC]' : ''}><td className={`${tdd} whitespace-nowrap`}>{dmy(x.date)}</td><td className={tdd}><LineName l={x.line} /></td><td className={`${tdd} whitespace-nowrap font-mono`}>{p2(x.hour)}:00–{p2((x.hour + 1) % 24)}:00</td><td className={`${tdd} font-semibold`}>{x.reason}</td><td className={tdd}>{x.dept && x.dept !== 'Not set' ? x.dept : '—'}</td><td className={`${tdd} text-right font-bold text-red-700`}>{dur(x.min)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </MesDrawer>
                );
              })()}
            </div>
          ) : (
            <div className="lp-ad-wrap grid grid-cols-1 gap-3">
              <section className={`${card} lp-pd-models`} aria-label="Models against their std cycle">
                <Title right={`${nf(X.models.length)} models · slowest first · click a model for its hours`}>Models · cycle time vs std</Title>
                {!X.models.length ? <Empty text="No production in this period." /> : (
                  <div className="lp-pd-modtable max-h-[420px] overflow-auto">
                    <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Performance models table">
                      <thead className="sticky top-0"><tr>{['Line', 'Company', 'Model', 'Std', 'Actual', 'Var.', 'Target', 'Actual Qty', 'Achieved', 'Time lost'].map((h, i) => <th key={h} className={`${th} ${i > 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                      <tbody>
                        {X.models.map((m) => (
                          <tr key={m.key} className={`cursor-pointer hover:bg-blue-50 ${m.few ? 'text-slate-500' : ''}`} title="Open the model hour by hour" onClick={() => setMdl(m)}>
                            <td className={td}><LineName l={m.line} /></td>
                            <td className={td}><CompanyCell name={co(m.model)} /></td>
                            <td className={`${td} font-mono font-semibold`}>{m.model}</td>
                            <td className={`${td} text-right font-mono`}>{sec(m.std)}</td>
                            <td className={`${td} text-right font-mono`}>{m.few ? '—' : sec(m.act)}</td>
                            <td className={`${td} text-right font-mono font-bold ${m.var > 0.005 ? 'text-red-700' : 'text-emerald-700'}`}>{m.few || m.var == null ? '—' : `${m.var > 0 ? '+' : ''}${(m.var * 100).toFixed(1)}%`}</td>
                            <td className={`${td} text-right font-mono`}>{m.few ? `${m.qty} pcs · too few` : nf(m.target)}</td>
                            <td className={`${td} text-right font-mono font-bold`}>{nf(m.qty)}</td>
                            <td className={`${td} text-right font-mono`}>{m.few ? '—' : pct(m.ach)}</td>
                            <td className={`${td} text-right font-mono ${m.lostMin >= 3 ? 'font-bold text-red-700' : 'text-slate-500'}`}>{m.few || m.lostMin == null ? '—' : dur(Math.max(0, m.lostMin))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {mdl && (() => {
            const hs0 = modelHours(R, mdl.line, mdl.model);
            // 27-11-2026: filters (day, slower than std, alone / with other models) and sort on every column
            const daysOf = [...new Set(hs0.map((h) => h.date))];
            const keyOf = { date: (h) => `${h.date}|${String(h.hour).padStart(2, '0')}`, qty: (h) => h.qty, hourQty: (h) => h.hourQty, run: (h) => h.runMin, std: (h) => h.std, act: (h) => h.act, var: (h) => h.var, lost: (h) => h.lostMin };
            const hs = hs0.filter((h) => (!mh.day || h.date === mh.day) && (mh.only === 'all' || (mh.only === 'slow' ? h.var > 0.005 : mh.only === 'ok' ? !(h.var > 0.005) : mh.only === 'alone' ? !h.mixed : h.mixed)))
              .map((h, i) => [h, i]).sort((a, b) => { const x = keyOf[mh.k](a[0]), y = keyOf[mh.k](b[0]); if (x == null || y == null) return (x == null) - (y == null) || a[1] - b[1]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * mh.dir || a[1] - b[1]; }).map(([h]) => h);
            const sortBy = (k) => setMh((o) => ({ ...o, k, dir: o.k === k ? -o.dir : k === 'date' ? 1 : -1 }));
            const mhSel = 'h-8 rounded-md border border-slate-300 bg-white px-2 text-fs-13';
            // 27-11-2026: total of the hours shown (the same figures as the rows)
            const tq = hs.reduce((a, h) => a + h.qty, 0), tSec = hs.reduce((a, h) => a + (h.actSec || 0), 0), tStd = hs.reduce((a, h) => a + (h.std ? h.qty * h.std : 0), 0);
            const tAct = tq ? tSec / tq : null, tStdCt = tq && tStd ? tStd / tq : null, tVar = tAct != null && tStdCt ? (tAct - tStdCt) / tStdCt : null;
            const tLost = hs.reduce((a, h) => a + Math.max(0, h.lostMin || 0), 0);
            const vText = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
            return (
              <MesDrawer title={`Line ${mdl.line} — ${mdl.model}`} sub={`${co(mdl.model) ? `${co(mdl.model)} · ` : ''}${periodText} · ${nf(tq)} pcs in ${hs.length} hours · Std CT ${sec(tStdCt ?? mdl.std)} · Actual CT ${sec(tAct)}`} onClose={() => setMdl(null)} label={`${mdl.model} hour by hour`} width={75} fit bodyClass="p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="mh-filters">
                  <select aria-label="Day" value={mh.day} onChange={(e) => setMh({ ...mh, day: e.target.value })} className={mhSel}><option value="">All days</option>{daysOf.map((d) => <option key={d} value={d}>{dmy(d)}</option>)}</select>
                  <select aria-label="Show" value={mh.only} onChange={(e) => setMh({ ...mh, only: e.target.value })} className={mhSel} data-testid="mh-only">
                    {[['all', 'All hours'], ['slow', 'Slower than std'], ['ok', 'At or faster than std'], ['alone', 'Model alone in the hour'], ['mixed', 'With other models']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                  <select aria-label="Sort" value={`${mh.k}|${mh.dir}`} onChange={(e) => { const [k, d] = e.target.value.split('|'); setMh({ ...mh, k, dir: Number(d) }); }} className={mhSel} data-testid="mh-sort">
                    {[['date|1', 'Date & hour'], ['var|-1', 'Var. high → low'], ['var|1', 'Var. low → high'], ['lost|-1', 'Time lost most first'], ['qty|-1', 'Model Qty most first']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    {!['date|1', 'var|-1', 'var|1', 'lost|-1', 'qty|-1'].includes(`${mh.k}|${mh.dir}`) && <option value={`${mh.k}|${mh.dir}`}>{mh.k} {mh.dir > 0 ? '↑' : '↓'}</option>}</select>
                  <span className="ml-auto text-fs-12 text-slate-500">{hs.length} of {hs0.length} hours</span>
                </div>
                {!hs.length ? <Empty text={hs0.length ? 'No hour matches the filters.' : 'No pieces of this model in this period.'} /> : (<>
                  <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label={`${mdl.model} hour by hour`} data-testid="model-hours">
                    <thead><tr>{[['date', 'Date'], [null, 'Hour'], ['qty', 'Model Qty'], ['hourQty', 'Hour Qty (all models)'], ['run', 'Run Time'], ['std', 'Std CT'], ['act', 'Actual CT'], ['var', 'Var. vs Std'], ['lost', 'Time Lost vs Std'], [null, 'Other models in the hour']].map(([k, h], i) => (
                      <th key={h} className={`${th} ${i >= 2 && i <= 8 ? 'text-right' : ''}`} aria-sort={k && mh.k === k ? (mh.dir > 0 ? 'ascending' : 'descending') : undefined}>
                        {k ? <button type="button" onClick={() => sortBy(k)} data-testid={`mh-sort-${k}`} className={`inline-flex items-center gap-1 font-bold ${mh.k === k ? 'text-[#2E75B6]' : ''}`}>{h}<span aria-hidden="true" className="text-fs-11">{mh.k === k ? (mh.dir > 0 ? '▲' : '▼') : '↕'}</span></button> : h}</th>))}</tr></thead>
                    <tbody>
                      {hs.map((h) => (
                        <tr key={h.key}>
                          <td className={`${td} whitespace-nowrap font-semibold`}>{dmy(h.date)}</td>
                          <td className={`${td} whitespace-nowrap font-mono`}>{p2(h.hour)}:00–{p2((h.hour + 1) % 24)}:00{h.extra && <span className="ml-1 rounded bg-amber-100 px-1 text-fs-11 text-amber-800">EXTRA</span>}</td>
                          <td className={`${td} text-right font-mono font-bold`}>{nf(h.qty)}</td>
                          <td className={`${td} text-right font-mono`}>{nf(h.hourQty)}</td>
                          <td className={`${td} text-right font-mono`} title={h.idleMin ? `${Math.round(h.idleMin)} min idle taken out` : ''}>{h.runMin == null ? '—' : `${Math.round(h.runMin)} min`}{h.idleMin >= 1 && <span className="ml-1 text-fs-11 text-slate-500">(−{Math.round(h.idleMin)} idle)</span>}</td>
                          <td className={`${td} text-right font-mono`}>{sec(h.std)}</td>
                          <td className={`${td} text-right font-mono ${h.var > 0.005 ? 'font-bold text-red-700' : 'text-emerald-700'}`}>{sec(h.act)}{h.mixed && <sup className="ml-0.5 text-slate-500" title="hour with other models: run time shared by std time">*</sup>}</td>
                          <td className={`${td} text-right font-mono ${h.var > 0.005 ? 'text-red-700' : 'text-emerald-700'}`}>{vText(h.var)}</td>
                          <td className={`${td} text-right font-mono ${h.lostMin >= 1 ? 'font-bold text-red-700' : 'text-slate-500'}`}>{h.lostMin == null ? '—' : dur(Math.max(0, h.lostMin))}</td>
                          <td className={td}>{h.others.map((o) => <div key={o.name} className="whitespace-nowrap"><span className="font-mono font-semibold">{o.name}</span> <span className="text-fs-12 text-slate-500">{nf(o.value)} pcs</span></div>)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="bg-slate-100 font-bold">
                      <td className={td} colSpan={2}>Total · {hs.length} hours</td>
                      <td className={`${td} text-right font-mono`}>{nf(tq)}</td><td className={td} /><td className={`${td} text-right font-mono`}>{Math.round(tSec / 60)} min</td>
                      <td className={`${td} text-right font-mono`}>{sec(tStdCt)}</td>
                      <td className={`${td} text-right font-mono ${tVar > 0.005 ? 'text-red-700' : 'text-emerald-700'}`}>{sec(tAct)}</td>
                      <td className={`${td} text-right font-mono ${tVar > 0.005 ? 'text-red-700' : 'text-emerald-700'}`}>{vText(tVar)}</td>
                      <td className={`${td} text-right font-mono text-red-700`}>{dur(tLost)}</td><td className={td} />
                    </tr></tfoot>
                  </table>
                  <p className="mt-2 text-fs-12 text-slate-600">
                    <b>Run Time</b> = the hour's working minutes − idle time written. <b>Actual CT</b> = the model's share of the run time ÷ its pieces; * = hour with other models: the run time is shared by the std time of each model's pieces.
                    <b> Var. vs Std</b> = (Actual CT − Std CT) ÷ Std CT. <b>Time Lost vs Std</b> = (Actual CT − Std CT) × pieces (only when slower). Model Qty and Hour Qty count every good scan.
                  </p>
                </>)}
              </MesDrawer>
            );
          })()}

          {/* 27-11-2026: line × hour of the day taken off (as asked) */}
        </div>
      )}
    </div>
  );
}
