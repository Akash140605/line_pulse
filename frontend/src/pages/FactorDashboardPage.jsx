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
import { Pareto, Donut, DeptOwners, withDept, NoDeptNote } from './OleFocusPage';
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
const signed = (v) => (v == null ? '—' : v > 0 ? `Excess ${nf(v)}` : v < 0 ? `Short ${nf(-v)}` : 'On target');
const LineName = ({ l }) => <span className="whitespace-nowrap font-bold text-slate-900">Line {l}{plantOf(l) ? <span className="ml-1 text-fs-12 font-semibold text-slate-500">({plantOf(l)})</span> : null}</span>;

function Tile({ name, value, sub, tone = 'text-slate-900', testid }) {
  return (
    <div data-testid={testid} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
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
function Ranked({ rows, label, max = 10, empty }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, max);
  const hi = Math.max(1e-9, ...list.map((r) => r.value));
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="flex flex-col gap-1" role="list" aria-label={label}>
      {list.map((r) => (
        <div key={r.key} role="listitem" className="grid items-center gap-2 px-1 py-0.5 text-fs-13" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr) 7.5rem' }} title={r.title || r.label}>
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
  const heatVals = (X?.heat || []).flatMap((h) => Object.values(h.by).map((x) => (isA ? x : x.plan ? x.qty / x.plan : null))).filter((x) => x != null);
  const hours = [...new Set((X?.heat || []).flatMap((h) => Object.keys(h.by).map(Number)))].sort((a, b) => a - b);
  const heatMax = Math.max(1, ...(isA ? heatVals : [1]));
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
        <div ref={bodyRef} className="flex flex-col gap-3">
          {/* KPI tiles */}
          {isA ? (
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7" aria-label="Availability of the period">
              <Tile testid="fd-main" name="Availability" value={pct(t.A)} sub={`Target ${(ok * 100).toFixed(0)}% · ${group}`} tone={tone(t.A)} />
              <Tile name="Planned time" value={hh(t.planned)} sub="shift time without breaks" />
              <Tile name="Run time" value={hh(t.run)} sub={t.planned ? `${pct(t.run / t.planned)} of planned` : '—'} />
              <Tile name="Idle time" value={hh(t.idle)} sub={t.planned ? `${pct(t.idle / t.planned)} of planned` : '—'} tone={t.idle > 0 ? 'text-red-700' : 'text-slate-900'} />
              <Tile name="Stops written" value={nf(t.stops)} sub={t.notWritten >= 3 ? `${hh(t.notWritten)} idle not written` : 'every idle minute written'} tone={t.notWritten >= 3 ? 'text-amber-700' : 'text-slate-900'} />
              <Tile name="Average stop" value={t.avg == null ? '—' : `${Math.round(t.avg)} min`} sub="written minutes ÷ stops" />
              <Tile name="Top reason" value={X.reasons[0]?.name || '—'} sub={X.reasons[0] ? `${hh(X.reasons[0].min)}${X.reasons[0].dept !== 'Not set' ? ` · ${X.reasons[0].dept}` : ''}` : 'no idle time written'} tone={X.reasons[0] ? 'text-red-700' : 'text-slate-900'} />
            </section>
          ) : (
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7" aria-label="Performance of the period">
              <Tile testid="fd-main" name="Performance" value={pct(t.P)} sub={`Target ${(ok * 100).toFixed(0)}% · ${group}`} tone={tone(t.P)} />
              <Tile name="Plan target qty" value={nf(t.target)} sub="HPR / SAWM plan" />
              <Tile name="Actual qty" value={nf(t.qty)} sub={t.ach == null ? '—' : `${pct(t.ach)} of the plan`} tone={t.ach == null ? 'text-slate-900' : t.ach >= 1 ? 'text-emerald-700' : 'text-red-700'} />
              <Tile name="Short / excess" value={t.short == null ? '—' : nf(Math.abs(t.short))} sub={t.short == null ? '—' : t.short < 0 ? 'pieces short of the plan' : 'pieces over the plan'} tone={t.short == null ? 'text-slate-900' : t.short < 0 ? 'text-red-700' : 'text-emerald-700'} />
              <Tile name="Cycle time" value={sec(t.act)} sub={`actual · std ${sec(t.std)}`} tone={t.act != null && t.std != null && t.act > t.std * 1.005 ? 'text-red-700' : 'text-emerald-700'} />
              <Tile name="Speed loss" value={hh(t.speed)} sub="run time beyond the std cycle" tone={t.speed >= 3 ? 'text-red-700' : 'text-slate-900'} />
              <Tile name="Slow models" value={`${nf(t.slow)} of ${nf(t.judged)}`} sub={X.slow[0] ? `most time lost: ${X.slow[0].model} (L${X.slow[0].line}) · ${dur(X.slow[0].lostMin)}${X.variation[0] && X.variation[0].key !== X.slow[0].key ? ` · highest variation: ${X.variation[0].model} +${(X.variation[0].var * 100).toFixed(1)}%` : ''}` : 'none slower than std'} tone={t.slow ? 'text-red-700' : 'text-emerald-700'} />
            </section>
          )}

          {/* 26-11-2026: as on the Availability page, right under the tiles: the Pareto of the reasons and who owns the time */}
          {isA && (() => {
            const hrs = (m) => hm(Math.max(0, Number(m) || 0));
            const byDept = {};
            for (const r of X.reasons) (byDept[r.dept] = byDept[r.dept] || []).push({ label: r.name, value: r.min, n: r.n });
            const depts = X.depts.map((d) => ({ label: d.name, value: d.min }));
            return (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                <section className={`${card} xl:col-span-2`} aria-label="Idle time reasons Pareto">
                  <Title right="Pareto by time lost">Idle time reasons</Title>
                  <Pareto rows={X.reasons.map((r) => ({ label: r.name, value: r.min }))} fmt={hrs} time color="#EB5757" empty="No idle time in this period." />
                </section>
                <section className={card} aria-label="Share by department">
                  <Title right="who owns the lost time">Share by department</Title>
                  <Donut top={6} rows={withDept(depts)} fmt={hrs} centre="idle time" empty="No idle time in this period." />
                  <DeptOwners depts={withDept(depts)} byDept={byDept} fmt={hrs} />
                  <NoDeptNote rows={depts} fmt={hrs} />
                </section>
              </div>
            );
          })()}

          {!isA && (() => {
            const lineSpeed = X.lines.filter((l) => l.speed > 0).map((l) => ({ label: `Line ${l.line}`, value: l.speed }));
            return (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                <section className={`${card} xl:col-span-2`} aria-label="Where the speed is lost">
                  <Title right="Pareto of time lost against the std cycle, by model">Where the speed is lost</Title>
                  <Pareto rows={X.slow.map((m) => ({ label: `${m.model} (L${m.line})`, value: m.lostMin }))} fmt={(m) => dur(Math.max(0, m))} time color="#EB5757" empty="No model ran slower than its std." />
                </section>
                <section className={card} aria-label="Speed loss by line">
                  <Title right="run time beyond std">Speed loss by line</Title>
                  <Donut rows={lineSpeed} fmt={(m) => hm(Math.max(0, m))} centre="speed loss" empty="No speed loss in this period." />
                  <Ranked label="Slowest models" max={6} empty="No model ran slower than its std." rows={X.slow.map((m) => ({ key: m.key, label: <span><span className="font-mono">{m.model}</span> <span className="text-fs-12 text-slate-500">L{m.line}</span></span>, value: m.lostMin, right: `${dur(m.lostMin)} · +${(m.var * 100).toFixed(0)}%`, title: `${m.model} on Line ${m.line}: ${sec(m.act)} against ${sec(m.std)}` }))} />
                </section>
              </div>
            );
          })()}

          {/* 26-11-2026: cycle time variation — model by model, hour by hour, day by day; and the reasons written as performance loss */}
          {!isA && (() => {
            const V = X.variation, hiV = Math.max(0.01, ...V.map((m) => Math.abs(m.var)));
            const ctTip = (v, n) => [`${v}s`, n === 'act' ? 'Actual CT' : 'Std CT'];
            const ctData = (list, key) => list.filter((d) => d.act != null).map((d) => ({ ...d, k: key(d), act: Math.round(d.act * 10) / 10, std: d.std == null ? null : Math.round(d.std * 10) / 10 }));
            const hours = ctData(X.hourCT, (d) => `${p2(d.hour)}`), dayCt = ctData(X.days, (d) => d.date.slice(8, 10));
            const ctChart = (data, label, onPick) => (
              <div style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} onClick={onPick ? (e) => { const d0 = e?.activePayload?.[0]?.payload; if (d0) onPick(d0); } : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="k" tick={tick()} interval={0} />
                    <YAxis tick={tick()} width={40} unit="s" domain={[0, 'auto']} />
                    <Tooltip formatter={ctTip} labelFormatter={(l, p) => (p?.[0]?.payload?.date ? dmy(p[0].payload.date) : `${l}:00`)} />
                    <Bar dataKey="act" name="act" maxBarSize={30} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {data.map((d) => <Cell key={d.k} fill={d.std != null && d.act > d.std * 1.005 ? '#EB5757' : '#16A34A'} />)}
                      <LabelList dataKey="act" position="top" style={{ fontSize: fs(10.5), fill: '#334155', fontWeight: 700 }} />
                    </Bar>
                    <Line dataKey="std" name="std" stroke={NAVY} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="mt-1 text-fs-12 text-slate-600"><span className="font-bold text-red-700">Red</span> = slower than std · <span className="font-bold text-emerald-700">green</span> = at or faster · dashed line = std cycle{label ? ` · ${label}` : ''}</p>
              </div>
            );
            return (
              <>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <section className={card} aria-label="Cycle time variation by model">
                    <Title right="actual cycle against std · highest variation first · click a model for its hours">Cycle time variation · by model</Title>
                    {!V.length ? <Empty text="No model with enough pieces and a std cycle." /> : (
                      <div className="flex max-h-[300px] flex-col gap-1 overflow-y-auto pr-1" role="list" aria-label="Cycle time variation by model">
                        {V.map((m) => (
                          <div key={m.key} role="listitem" tabIndex={0} onClick={() => setMdl(m)} onKeyDown={(e) => { if (e.key === 'Enter') setMdl(m); }} title={`${m.model} on Line ${m.line}: ${sec(m.act)} against std ${sec(m.std)} · ${nf(m.qty)} pcs`}
                            className="grid cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-fs-13 hover:bg-blue-50" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) 9.5rem' }}>
                            <span className="break-words font-semibold leading-tight text-slate-800"><span className="font-mono">{m.model}</span> <span className="text-fs-12 text-slate-500">L{m.line}</span></span>
                            <span className="relative h-3 rounded bg-slate-100"><span className="absolute top-0 h-full w-px bg-slate-400" style={{ left: '50%' }} />
                              <span className="absolute top-0 h-full rounded" style={m.var > 0 ? { left: '50%', width: `${(m.var / hiV) * 50}%`, background: '#EB5757' } : { right: '50%', width: `${(-m.var / hiV) * 50}%`, background: '#16A34A' }} /></span>
                            <span className={`text-right font-mono font-bold ${m.var > 0.005 ? 'text-red-700' : 'text-emerald-700'}`}>{m.var > 0 ? '+' : ''}{(m.var * 100).toFixed(1)}% <span className="text-fs-12 font-semibold text-slate-500">{sec(m.act)}/{sec(m.std)}</span></span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className={card} aria-label="Cycle time by hour of the day">
                    <Title right="actual cycle vs std, every day of the period together">Cycle time · hour of the day</Title>
                    {!hours.length ? <Empty text="No production in this period." /> : ctChart(hours, '')}
                  </section>
                </div>
                {!oneDay && (
                  <section className={card} aria-label="Cycle time day by day">
                    <Title right="click a day to open it">Cycle time · day by day</Title>
                    {!dayCt.length ? <Empty text="No production in this period." /> : ctChart(dayCt, '', (d0) => openDay(d0.date))}
                  </section>
                )}
                <section className={card} aria-label="Performance loss reasons">
                  <Title right="minutes written against a model (Loss entry)">Performance loss reasons</Title>
                  {X.reasons.length ? <Pareto rows={X.reasons.map((r) => ({ label: r.name, value: r.min }))} fmt={(m) => dur(m)} time color="#EB5757" />
                    : <p className="text-fs-13 text-slate-600">No performance loss reason written in this period. A loss written on Loss entry counts in Availability (idle time) — see the Availability dashboard; set "loss with a model → Performance" in Setup → OLE formulas to see such reasons here. The speed loss of every model is above.</p>}
                </section>
              </>
            );
          })()}

          {/* line × day */}
          {!oneDay && (
          <section className={card} aria-label={`${name} line by day`}>
            <Title right={`${name} % per line and day · green ≥ ${(ok * 100).toFixed(0)}%, amber ≥ ${(watch * 100).toFixed(0)}%`}>{name} · line × day</Title>
            {!X.days.length ? <Empty text="No production in this period." /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label={`${name} line by day table`}>
                  <thead><tr><th className={th}>Line</th>{X.days.map((d) => <th key={d.date} className={`${th} cursor-pointer text-center hover:bg-blue-50`} onClick={() => openDay(d.date)} title={`Open ${dmy(d.date)}`}>{d.date.slice(8, 10)}</th>)}<th className={`${th} text-right`}>Period</th></tr></thead>
                  <tbody>
                    {IDS.map((l) => (
                      <tr key={l}>
                        <td className={`${td} cursor-pointer`} onClick={() => openLine(l)} title="Only this line"><LineName l={l} /></td>
                        {X.days.map((d) => <td key={d.date} className={`${td} cursor-pointer text-center font-mono font-semibold hover:opacity-80 ${cellBg(d.by[l])}`} title={`Line ${l} · ${dmy(d.date)}: ${pct(d.by[l])} — click to open`} onClick={() => { setSel(String(l)); openDay(d.date); }}>{d.by[l] == null ? '' : Math.round(d.by[l] * 100)}</td>)}
                        <td className={`${td} text-right font-mono font-extrabold ${tone(v(X.lines.find((x) => x.line === String(l)) || {}))}`}>{pct(v(X.lines.find((x) => x.line === String(l)) || {}))}</td>
                      </tr>
                    ))}
                    {IDS.length > 1 && (
                      <tr className="bg-slate-50">
                        <td className={`${td} font-extrabold`}>All</td>
                        {X.days.map((d) => <td key={d.date} className={`${td} text-center font-mono font-extrabold ${cellBg(v(d))}`}>{v(d) == null ? '' : Math.round(v(d) * 100)}</td>)}
                        <td className={`${td} text-right font-mono font-extrabold ${tone(v(t))}`}>{pct(v(t))}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}   {/* 26-11-2026: one day has no line × day */}

          {/* 26-11-2026: one under the other — the line table has many columns and must not be cut */}
          <div className="grid grid-cols-1 gap-3">
            {/* day by day */}
            {!oneDay && (
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
            <section className={card} aria-label={`${name} line by line`}>
              <Title right={isA ? 'time, stops, main reason' : 'plan, pieces, cycle, slowest model'}>Line by line</Title>
              <div className="overflow-x-auto">
                {isA ? (
                  <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Availability line by line table">
                    <thead><tr>{['Line', 'Planned', 'Run', 'Idle', 'Stops', 'Avg', 'Availability', 'Main reason', 'Dept.'].map((h, i) => <th key={h} className={`${th} ${i > 0 && i < 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {X.lines.map((r) => (
                        <tr key={r.line} className="cursor-pointer hover:bg-slate-50" title="Only this line" onClick={() => openLine(r.line)}>
                          <td className={td}><LineName l={r.line} /></td>
                          <td className={`${td} text-right font-mono`}>{hh(r.planned)}</td>
                          <td className={`${td} text-right font-mono`}>{hh(r.run)}</td>
                          <td className={`${td} text-right font-mono font-bold ${r.idle > 0 ? 'text-red-700' : 'text-slate-500'}`}>{hh(r.idle)}</td>
                          <td className={`${td} text-right font-mono`}>{nf(r.stops)}</td>
                          <td className={`${td} text-right font-mono`}>{r.avg == null ? '—' : `${Math.round(r.avg)}m`}</td>
                          <td className={`${td} text-right font-mono font-extrabold ${tone(r.A)}`}>{pct(r.A)}</td>
                          <td className={`${td} font-semibold`}>{r.topReason || '—'}</td>
                          <td className={td}>{r.topDept && r.topDept !== 'Not set' ? r.topDept : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Performance line by line table">
                    <thead><tr>{['Line', 'Plan', 'Actual', 'Short / Excess', 'Achieved', 'Std CT', 'Actual CT', 'Speed loss', 'Performance', 'Slowest model'].map((h, i) => <th key={h} className={`${th} ${i > 0 && i < 9 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
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
            <div className="grid grid-cols-1 gap-3">
              <section className={card} aria-label="Idle time by model">
                <Title right="idle written against a model">Models</Title>
                <Ranked label="Idle time by model" empty="No idle time written against a model." rows={X.models.map((m) => ({ key: m.name, label: <span><span className="mr-1 text-fs-11 font-bold uppercase text-slate-500">{co(m.name)}</span><span className="font-mono">{m.name}</span></span>, value: m.min, right: `${dur(m.min)} · ${m.n === 1 ? '1 time' : `${m.n} times`}`, title: `${m.name}: mostly ${m.top}` }))} />
              </section>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              <section className={card} aria-label="Models against their std cycle">
                <Title right={`${nf(X.models.length)} models · slowest first · click a model for its hours`}>Models · cycle time vs std</Title>
                {!X.models.length ? <Empty text="No production in this period." /> : (
                  <div className="max-h-[420px] overflow-auto">
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
            const hs = modelHours(R, mdl.line, mdl.model);
            return (
              <MesDrawer title={`Line ${mdl.line} — ${mdl.model}`} sub={`${co(mdl.model) ? `${co(mdl.model)} · ` : ''}${periodText} · std ${sec(mdl.std)} · actual ${sec(mdl.act)}`} onClose={() => setMdl(null)} label={`${mdl.model} hour by hour`} width={70} fit bodyClass="p-2">
                {!hs.length ? <Empty text="No pieces of this model in this period." /> : (
                  <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label={`${mdl.model} hour by hour`}>
                    <thead><tr>{['Date', 'Hour', 'Pieces', 'Hour total', 'Std CT', 'Actual CT', 'Var.', 'Time lost', 'Other models in the hour'].map((h, i) => <th key={h} className={`${th} ${i >= 2 && i <= 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>
                      {hs.map((h) => (
                        <tr key={h.key}>
                          <td className={`${td} whitespace-nowrap font-semibold`}>{dmy(h.date)}</td>
                          <td className={`${td} whitespace-nowrap font-mono`}>{p2(h.hour)}:00–{p2((h.hour + 1) % 24)}:00</td>
                          <td className={`${td} text-right font-mono font-bold`}>{nf(h.qty)}</td>
                          <td className={`${td} text-right font-mono`}>{nf(h.hourQty)}</td>
                          <td className={`${td} text-right font-mono`}>{sec(h.std)}</td>
                          <td className={`${td} text-right font-mono ${h.var > 0.005 ? 'font-bold text-red-700' : 'text-emerald-700'}`}>{sec(h.act)}</td>
                          <td className={`${td} text-right font-mono ${h.var > 0.005 ? 'text-red-700' : 'text-emerald-700'}`}>{h.var == null ? '—' : `${h.var > 0 ? '+' : ''}${(h.var * 100).toFixed(1)}%`}</td>
                          <td className={`${td} text-right font-mono ${h.lostMin >= 1 ? 'font-bold text-red-700' : 'text-slate-500'}`}>{h.lostMin == null ? '—' : dur(Math.max(0, h.lostMin))}</td>
                          <td className={td}>{h.others.map((o) => <div key={o.name} className="whitespace-nowrap"><span className="font-mono font-semibold">{o.name}</span> <span className="text-fs-12 text-slate-500">{nf(o.value)} pcs</span></div>)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </MesDrawer>
            );
          })()}

          {/* line × hour */}
          <section className={card} aria-label={`${name} line by hour`}>
            <Title right={isA ? 'idle minutes · darker = more' : 'pieces ÷ hour plan · green ≥ 100%'}>Line × hour of the day</Title>
            {!hours.length ? <Empty text="No production in this period." /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label={`${name} line by hour table`}>
                  <thead><tr><th className={th}>Line</th>{hours.map((h) => <th key={h} className={`${th} text-center`}>{p2(h)}</th>)}</tr></thead>
                  <tbody>
                    {X.heat.map((r) => (
                      <tr key={r.line}>
                        <td className={td}><LineName l={r.line} /></td>
                        {hours.map((h) => {
                          const x = r.by[h];
                          if (isA) {
                            const m = x || 0, a = m ? 0.15 + 0.85 * (m / heatMax) : 0;
                            return <td key={h} className={`${td} text-center font-mono font-bold`} style={m ? { background: `rgba(185,28,28,${a.toFixed(2)})`, color: a > 0.55 ? '#fff' : '#7F1D1D' } : undefined} title={`Line ${r.line} · ${p2(h)}:00 — ${Math.round(m)} min idle`}>{m ? Math.round(m) : ''}</td>;
                          }
                          const a = x && x.plan ? x.qty / x.plan : null;
                          return <td key={h} className={`${td} text-center font-mono font-semibold ${a == null ? '' : a >= 1 ? 'bg-emerald-50 text-emerald-800' : a >= watch ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800'}`} title={x ? `Line ${r.line} · ${p2(h)}:00 — ${nf(x.qty)} of ${nf(x.plan)} planned` : ''}>{a == null ? (x?.qty ? nf(x.qty) : '') : `${Math.round(a * 100)}`}</td>;
                        })}
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
