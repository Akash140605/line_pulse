import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLastScans } from '../hooks/useLastScans';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { TARGET_GREY, achColor, achLegend } from '../utils/achieve';
import { FileSpreadsheet, Download, Users } from 'lucide-react';
import HeaderBar, { segGroup, segBtn } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { PeriodBar } from '../components/PeriodBar';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { loadAutoTargets, mergeTargets, isLineD } from '../hooks/useAutoTargets';
import { targetsOn } from '../utils/targetPeriods';
import { serverToday } from '../utils/serverTime';
import { oleRange, oleConfig } from '../utils/ole';
import { shiftOfDay, SHIFT_PLANT } from '../utils/shift';
import { nf, dmy, useOleData, useOleLines, groupNameOf } from '../components/OleParts';
import { kpiDays, buildKpiXlsx, kpiFileName, KPI_LINES } from '../utils/kpiReport';
import { downloadXlsx } from '../utils/xlsxWriter';
import { exportPanel } from '../utils/domExcel';
import { kpiAgg, kpiEntryAgg, kpiSummaryDays, manpowerDays, KPI_RTY_TARGET } from '../utils/kpiDash';
import { fs } from '../theme';
import { KpiSummarySheet, KpiDaySheet, KpiFtySheet } from '../components/KpiSheets';

/**
 * KPI dashboard (20-11-2026) — the Summary of the plant's SAWM KPI report as a dashboard:
 * production plan vs actual, UPH, UPPH, RTY, manpower (morning entry), OT, OS&D, open WO, TRC / WIP lying —
 * the period in boxes, manpower line by line, line-wise table, day-wise trend and the Summary table day by day.
 * Formulas: utils/kpiDash.js. Excel: the page's tables, or the plant's full SAWM KPI workbook.
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const C_PLAN = '#9DB7D5', C_ACT = '#1F3864', GRID = '#E2E8F0';
const d1 = (v) => (v == null ? '—' : v.toFixed(1));
const d2 = (v) => (v == null ? '—' : v.toFixed(2));
const money = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const tone = (a, t) => (a == null || t == null ? 'text-slate-900' : a >= t ? 'text-emerald-700' : 'text-red-700');
const cellTone = (a, t) => (a == null || t == null ? '' : a >= t ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800');
const tick = () => ({ fontSize: fs(12), fill: '#334155' });
const faOf = (l) => KPI_LINES.find((k) => k.line === String(l)) || { fa: `FA-0${l}`, sap: '', label: `Line-${l}` };

function Title({ children, right = null }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-2">
      <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">{children}</h3>
      {right && <div className="ml-auto text-fs-12 font-semibold text-slate-500">{right}</div>}
    </div>
  );
}

/** One KPI box: actual big, target under it, a bar of actual ÷ target. */
function Tile({ name, actual, target = null, fmt = d1, unit = '', sub = null, testid }) {
  const r = actual != null && target ? Math.max(0, Math.min(1.2, actual / target)) : null;
  return (
    <div className="lp-tile min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid={testid}>
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className={`mt-1 whitespace-nowrap font-mono text-fs-28 font-extrabold leading-none tabular-nums ${tone(actual, target)}`}>{fmt(actual)}{unit && <span className="ml-1 text-fs-13 font-semibold text-slate-500">{unit}</span>}</div>
      {target != null && (
        <>
          <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${((r ?? 0) / 1.2) * 100}%`, background: actual >= target ? '#059669' : '#DC2626' }} /><i className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${(1 / 1.2) * 100}%` }} /></div>
          <div className="mt-1 text-fs-12 font-semibold text-slate-600">Target <b className="font-mono text-slate-900">{fmt(target)}</b>{actual != null && <> · <span className={tone(actual, target)}>{actual >= target ? 'Met' : `${fmt(target - actual)} short`}</span></>}</div>
        </>
      )}
      {sub && <div className="mt-1 text-fs-12 leading-snug text-slate-600">{sub}</div>}
    </div>
  );
}

function Tip({ active, payload, label, rows }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="min-w-[160px] rounded-md border border-slate-200 bg-white px-3 py-2 text-fs-12 shadow-lg">
      <div className="mb-1 font-bold text-slate-900">{r.title || label}</div>
      {rows(r).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><span className="text-slate-600">{k}</span><b className="font-mono text-slate-900">{v}</b></div>)}
    </div>
  );
}

export default function KpiDashboardPage() {
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: `${today.slice(0, 8)}01`, end: today });
  const [sel, setSel] = useState('all');
  // 25-11-2026: the SAWM KPI report's sheets as screens — Dashboard / Summary / Day / FPY & RTY
  const [view, setView] = useState('dash');
  const IDS = sel === 'all' ? ALL : [sel];
  const settings = useAllLineSettings(ALL);
  const D = useOleData({ start: range.start, end: range.end, ids: ALL });
  const [auto, setAuto] = useState(null);
  useEffect(() => { let on = true; loadAutoTargets(false).then((a) => on && setAuto(a || {})).catch(() => on && setAuto({})); return () => { on = false; }; }, []);
  const R0 = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, D.ent.setup, range.start, range.end, today, D.endMin, ALL]);
  // 25-11-2026: the finished days end at the line's last scan, as in the HPR / SAWM KPI (same Plan Target Qty)
  const lastScans = useLastScans({ R: R0, ids: ALL, today });
  const R = useMemo(() => (R0 && Object.keys(lastScans).length ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL, lastScans }) : R0), [R0, lastScans]); // eslint-disable-line react-hooks/exhaustive-deps
  const setups = D.ent.setup || {};
  const K = useMemo(() => {
    if (!R || !auto) return null;
    return kpiDays({
      R, setups, stations: D.ent.reasons?.station || [], today, nowMin: D.endMin, lines: ALL, kpi: D.ent.kpi || {},
      targetsOf: (l, date) => (settings[l]?.targetPeriods?.length ? targetsOn(settings[l], date) : mergeTargets(settings[l]?.targets || {}, auto?.byLine?.[l] || {}, isLineD(auto, l))),
      shiftOf: (date, l) => shiftOfDay(setups, date, l, settings[l]?.shift || null) || SHIFT_PLANT,
    });
  }, [R, auto, D.ent, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (ids) => (K || []).flatMap((d) => ids.map((l) => d.lines[l]).filter(Boolean));
  const T = useMemo(() => kpiAgg(items(IDS)), [K, IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const perLine = useMemo(() => IDS.map((l) => ({ l, a: kpiAgg(items([l])), e: kpiEntryAgg(D.ent.kpi, (R?.days || []).map((d) => d.date), [l]) })), [K, IDS.join(), D.ent.kpi, R]); // eslint-disable-line react-hooks/exhaustive-deps
  const E = useMemo(() => kpiEntryAgg(D.ent.kpi, (R?.days || []).map((d) => d.date), IDS), [D.ent.kpi, R, IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const S = useMemo(() => kpiSummaryDays(K, IDS), [K, IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const std = oleConfig().stdMp || {};
  const MP = useMemo(() => manpowerDays(R?.days, setups, IDS, std), [R, setups, IDS.join(), JSON.stringify(std)]); // eslint-disable-line react-hooks/exhaustive-deps
  const trend = S.map((d) => ({ k: d.date.slice(8), title: dmy(d.date), plan: d.total.plan ? Math.round(d.total.plan) : null, actual: d.total.qty || null, upphT: d.total.upphT, upphA: d.total.upphA, uphT: d.total.uphT, uphA: d.total.uphA }));
  const bodyRef = useRef(null);
  const oneDay = range.start === range.end;
  const periodText = oneDay ? `${range.start === today ? 'Today' : 'Day'} · ${dmy(range.start)}` : `${dmy(range.start)} – ${dmy(range.end)}`;
  const group = sel === 'all' ? groupNameOf(ALL) : `Line ${sel}`;
  const ot = (E.otPlan || 0) + (E.otUnplan || 0);

  if (!ALL.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  return (
    <div className="flex flex-col gap-3" aria-label="KPI dashboard" role="region">
      <HeaderBar label="KPI dashboard filters">
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <div className={segGroup} role="group" aria-label="View">
          {[['dash', 'Dashboard'], ['summary', 'Summary'], ['day', 'Day sheet'], ['fty', 'FPY & RTY']].map(([k, t]) => <button key={k} type="button" aria-pressed={view === k} data-testid={`kpi-view-${k}`} onClick={() => setView(k)} className={segBtn(view === k, 'navy')}>{t}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!R} />
        <button type="button" disabled={!K} onClick={() => exportPanel(bodyRef.current, `${{ dash: "KPI dashboard", summary: "KPI Summary", day: "KPI Day sheet", fty: "FPY RTY" }[view]} ${group}`, periodText)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50" aria-label="Export to Excel"><FileSpreadsheet size={15} />Excel</button>
        <button type="button" disabled={!K} onClick={() => downloadXlsx(buildKpiXlsx((K || []).map((d) => ({ ...d, lines: Object.fromEntries(Object.entries(d.lines).filter(([l]) => IDS.includes(l))) }))), kpiFileName(range.end))} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-700 bg-blue-700 px-2.5 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-50" aria-label="Download SAWM KPI report"><Download size={15} />SAWM report</button>
      </HeaderBar>
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!K ? <PageLoader label="Reading the lines" sub="Production, UPH, UPPH, RTY and manpower" /> : view !== 'dash' ? (
        <div ref={bodyRef} className="flex flex-col gap-3">
          {view === 'summary' && <KpiSummarySheet K={K} ids={IDS} />}
          {view === 'day' && <KpiDaySheet K={K} ids={IDS} />}
          {view === 'fty' && <KpiFtySheet K={K} ids={IDS} />}
        </div>
      ) : (
        <div ref={bodyRef} className="flex flex-col gap-3">
          {/* the period in boxes (as the Summary's columns) */}
          <section className="lp-kpis grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="KPIs of the period">
            <Tile testid="kpi-prod" name="Production" actual={T.qty} target={T.plan} fmt={nf} unit="pcs" sub={T.ach != null ? <>Achieved <b className={`font-mono ${tone(T.ach, 100)}`}>{T.ach.toFixed(1)}%</b></> : 'No plan'} />
            <Tile testid="kpi-uph" name="UPH" actual={T.uphA} target={T.uphT} sub="pieces per hour" />
            <Tile testid="kpi-upph" name="UPPH" actual={T.upphA} target={T.upphT} fmt={d2} sub={T.manHours ? `pieces per man-hour · ${nf(T.manHours)} man-hr` : 'needs the manpower of the morning entry'} />
            <Tile testid="kpi-rty" name="RTY" actual={T.rty} target={KPI_RTY_TARGET} fmt={(v) => (v == null ? '—' : `${v.toFixed(2)}%`)} sub="average of the line-days" />
            <Tile testid="kpi-mp" name="Manpower" actual={MP.last?.total ?? null} fmt={nf} unit="persons" sub={<>{MP.last ? `at open, ${dmy(MP.last.date)}` : 'No morning entry'}{MP.stdTot ? <> · std <b className="font-mono">{nf(MP.stdTot)}</b></> : null}{MP.avg ? <> · avg <b className="font-mono">{nf(MP.avg)}</b></> : null}</>} />
            <Tile testid="kpi-ot" name="Actual OT" actual={E.otPlan == null && E.otUnplan == null ? null : ot} fmt={(v) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }))} unit="man-hr" sub={E.otPlan == null && E.otUnplan == null ? 'KPI entry not filled' : <>Planned <b className="font-mono">{d1(E.otPlan ?? 0)}</b> · Unplanned <b className="font-mono">{d1(E.otUnplan ?? 0)}</b></>} />
          </section>
          <section className="lp-kpis grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Stock and OS&D">
            <Tile testid="kpi-osd" name="OS&D (period)" actual={E.osd} fmt={money} sub="sum of the KPI entries" />
            <Tile testid="kpi-wo" name=">7 days WO" actual={E.wo7?.value ?? null} fmt={nf} unit="bal qty" sub={E.wo7 ? `as on ${dmy(E.wo7.date)}` : 'KPI entry not filled'} />
            <Tile testid="kpi-trc" name="TRC lying >3 days" actual={E.trc3?.value ?? null} fmt={money} sub={E.trc3 ? `as on ${dmy(E.trc3.date)}` : 'KPI entry not filled'} />
            <Tile testid="kpi-wip" name="WIP lying >7 days" actual={E.wip7?.value ?? null} fmt={money} sub={E.wip7 ? `as on ${dmy(E.wip7.date)}` : 'KPI entry not filled'} />
          </section>

          {/* manpower line by line (morning entry) */}
          <section className={card} aria-label="Manpower">
            <Title right="Morning entry: manpower at open / close · std = Setup → OLE formulas">
              <span className="inline-flex items-center gap-1.5"><Users size={16} />Manpower — line wise</span>
            </Title>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {IDS.map((l) => {
                const x = MP.last?.lines?.[l] || {}; const a = perLine.find((p) => p.l === l)?.a || {};
                const gap = x.open != null && x.std ? x.open - x.std : null;
                return (
                  <div key={l} className="rounded-lg border border-slate-200 p-3" data-testid={`mp-line-${l}`}>
                    <div className="flex items-baseline justify-between gap-2"><b className="text-fs-14 text-slate-900">{faOf(l).fa} · Line {l}</b><span className="text-fs-12 text-slate-500">{faOf(l).label}</span></div>
                    <div className="mt-1 flex items-end gap-2"><span className="font-mono text-fs-34 font-extrabold leading-none text-dixon-navy">{x.open ?? '—'}</span><span className="pb-1 text-fs-13 font-semibold text-slate-600">at open{x.std ? <> / std <b className="font-mono">{x.std}</b></> : ''}</span></div>
                    {gap != null && gap !== 0 && <div className={`mt-0.5 text-fs-12 font-bold ${gap < 0 ? 'text-red-700' : 'text-amber-700'}`}>{gap < 0 ? `${-gap} short of std` : `${gap} over std`}</div>}
                    <dl className="mt-2 grid grid-cols-3 gap-1 text-fs-12">
                      <div><dt className="text-slate-500">At close</dt><dd className="font-mono font-bold text-slate-900">{x.close ?? '—'}</dd></div>
                      <div><dt className="text-slate-500">Avg (period)</dt><dd className="font-mono font-bold text-slate-900">{a.mpAvg == null ? '—' : a.mpAvg.toFixed(0)}</dd></div>
                      <div><dt className="text-slate-500">UPPH</dt><dd className={`font-mono font-bold ${tone(a.upphA, a.upphT)}`}>{d2(a.upphA)}</dd></div>
                    </dl>
                  </div>
                );
              })}
            </div>
            {MP.days.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Manpower by day">
                  <thead><tr className="bg-[#1F3864] text-center text-fs-12 text-white"><th className="border border-[#BFBFBF] px-2 py-1">Date</th>{IDS.map((l) => <th key={l} className="border border-[#BFBFBF] px-2">{faOf(l).fa} (open / close)</th>)}<th className="border border-[#BFBFBF] px-2">Total at open</th></tr></thead>
                  <tbody>
                    {MP.days.slice().reverse().map((d) => (
                      <tr key={d.date} className="text-center hover:bg-[#DDEBF7]/50">
                        <td className="border border-[#D4D4D4] px-2 py-1 font-semibold">{dmy(d.date)}</td>
                        {IDS.map((l) => { const x = d.lines[l]; return <td key={l} className={`border border-[#D4D4D4] px-2 font-mono ${x.open != null && x.std && x.open < x.std ? 'text-red-700' : ''}`}>{x.open ?? '—'}{x.close != null ? <span className="text-slate-500"> / {x.close}</span> : ''}</td>; })}
                        <td className="border border-[#D4D4D4] px-2 font-mono font-bold">{d.total ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* line-wise (the period) */}
          <section className={card} aria-label="Line wise">
            <Title right={`${group} · ${periodText}`}>Line wise</Title>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="KPI by line">
                <thead>
                  <tr className="bg-[#1F3864] text-center text-fs-12 text-white">
                    <th rowSpan={2} className="border border-[#BFBFBF] px-2 py-1">Line No.</th><th rowSpan={2} className="border border-[#BFBFBF] px-2">SAP Location</th>
                    <th colSpan={3} className="border border-[#BFBFBF] px-2 py-1">Production</th><th colSpan={2} className="border border-[#BFBFBF] px-2">UPH</th><th colSpan={2} className="border border-[#BFBFBF] px-2">UPPH</th><th colSpan={2} className="border border-[#BFBFBF] px-2">RTY (%)</th>
                    <th rowSpan={2} className="border border-[#BFBFBF] px-2">Avg M/P</th><th rowSpan={2} className="border border-[#BFBFBF] px-2">OS&amp;D</th><th colSpan={2} className="border border-[#BFBFBF] px-2">Actual OT (man-hr)</th>
                  </tr>
                  <tr className="bg-[#DDEBF7] text-center text-fs-11 font-bold text-[#1F3864]">
                    {['Plan', 'Actual', 'Achieved', 'Target', 'Actual', 'Target', 'Actual', 'Target', 'Actual', 'Planned', 'Unplanned'].map((h, i) => <th key={i} className="border border-[#BFBFBF] px-2 py-1">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {perLine.map(({ l, a, e }) => (
                    <tr key={l} className="text-center">
                      <td className="border border-[#D4D4D4] px-2 py-1 font-bold">{faOf(l).fa}</td><td className="border border-[#D4D4D4] px-2 font-mono">{faOf(l).sap}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{a.plan == null ? '—' : nf(a.plan)}</td><td className="border border-[#D4D4D4] px-2 font-mono font-bold">{nf(a.qty)}</td>
                      <td className={`border border-[#D4D4D4] px-2 font-mono font-bold ${cellTone(a.ach, 100)}`}>{a.ach == null ? '—' : `${a.ach.toFixed(1)}%`}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{d1(a.uphT)}</td><td className={`border border-[#D4D4D4] px-2 font-mono font-bold ${cellTone(a.uphA, a.uphT)}`}>{d1(a.uphA)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{d2(a.upphT)}</td><td className={`border border-[#D4D4D4] px-2 font-mono font-bold ${cellTone(a.upphA, a.upphT)}`}>{d2(a.upphA)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{KPI_RTY_TARGET}</td><td className={`border border-[#D4D4D4] px-2 font-mono font-bold ${cellTone(a.rty, KPI_RTY_TARGET)}`}>{d2(a.rty)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{a.mpAvg == null ? '—' : a.mpAvg.toFixed(0)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{e.osd == null ? '—' : e.osd.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{e.otPlan == null ? '—' : d1(e.otPlan)}</td><td className="border border-[#D4D4D4] px-2 font-mono">{e.otUnplan == null ? '—' : d1(e.otUnplan)}</td>
                    </tr>
                  ))}
                  {perLine.length > 1 && (
                    <tr className="bg-slate-50 text-center font-extrabold">
                      <td colSpan={2} className="border border-[#D4D4D4] px-2 py-1">Total</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{T.plan == null ? '—' : nf(T.plan)}</td><td className="border border-[#D4D4D4] px-2 font-mono">{nf(T.qty)}</td>
                      <td className={`border border-[#D4D4D4] px-2 font-mono ${cellTone(T.ach, 100)}`}>{T.ach == null ? '—' : `${T.ach.toFixed(1)}%`}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{d1(T.uphT)}</td><td className={`border border-[#D4D4D4] px-2 font-mono ${cellTone(T.uphA, T.uphT)}`}>{d1(T.uphA)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{d2(T.upphT)}</td><td className={`border border-[#D4D4D4] px-2 font-mono ${cellTone(T.upphA, T.upphT)}`}>{d2(T.upphA)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{KPI_RTY_TARGET}</td><td className={`border border-[#D4D4D4] px-2 font-mono ${cellTone(T.rty, KPI_RTY_TARGET)}`}>{d2(T.rty)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{T.mpAvg == null ? '—' : T.mpAvg.toFixed(0)}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{E.osd == null ? '—' : E.osd.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                      <td className="border border-[#D4D4D4] px-2 font-mono">{E.otPlan == null ? '—' : d1(E.otPlan)}</td><td className="border border-[#D4D4D4] px-2 font-mono">{E.otUnplan == null ? '—' : d1(E.otUnplan)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* day-wise trend: production and UPPH (two charts, one scale each) */}
          {trend.length > 0 && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <section className={card} aria-label="Production plan vs actual by day">
                <Title right={group}>Production — plan vs actual</Title>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
                      <YAxis tick={tick()} tickLine={false} axisLine={false} width={48} />
                      <Tooltip cursor={{ fill: 'rgba(148,163,184,0.14)' }} isAnimationActive={false} content={<Tip rows={(r) => [['Plan', nf(r.plan)], ['Actual', nf(r.actual)], ['Achieved', r.plan ? `${((r.actual / r.plan) * 100).toFixed(1)}%` : '—']]} />} />
                      <Legend wrapperStyle={{ fontSize: fs(12) }} payload={achLegend('Plan')} />
                      <Bar dataKey="plan" name="Plan" fill={TARGET_GREY} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                      <Bar dataKey="actual" name="Actual" fill={C_ACT} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                        {trend.map((r, i) => <Cell key={i} fill={achColor(r.actual, r.plan, C_ACT)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className={card} aria-label="UPPH by day">
                <Title right="pieces per man-hour">UPPH — target vs actual</Title>
                {!trend.some((r) => r.upphA != null) ? <p className="grid h-[240px] place-items-center text-center text-fs-14 font-semibold text-slate-500">UPPH needs the manpower of the Morning entry for these days.</p> : <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
                      <YAxis tick={tick()} tickLine={false} axisLine={false} width={40} domain={['auto', 'auto']} />
                      <Tooltip cursor={{ stroke: '#94A3B8', strokeDasharray: '3 3' }} isAnimationActive={false} content={<Tip rows={(r) => [['UPPH target', d2(r.upphT)], ['UPPH actual', d2(r.upphA)], ['UPH target', d1(r.uphT)], ['UPH actual', d1(r.uphA)]]} />} />
                      <Legend wrapperStyle={{ fontSize: fs(12) }} />
                      <Line dataKey="upphT" name="Target" stroke={C_PLAN} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                      <Line dataKey="upphA" name="Actual" stroke={C_ACT} strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>}
              </section>
            </div>
          )}

          {/* the Summary sheet, day by day */}
          <section className={card} aria-label="Summary day wise">
            <Title right="as the Summary sheet of the SAWM KPI report">Summary — day wise</Title>
            {!S.length ? <p className="text-fs-14 text-slate-600">No production in this period.</p> : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="KPI summary by day">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#1F3864] text-center text-fs-12 text-white">
                      <th rowSpan={2} className="border border-[#BFBFBF] px-2 py-1">Date</th><th rowSpan={2} className="border border-[#BFBFBF] px-2">Line No.</th>
                      <th colSpan={2} className="border border-[#BFBFBF] px-2 py-1">Production</th><th colSpan={2} className="border border-[#BFBFBF] px-2">UPH</th><th colSpan={2} className="border border-[#BFBFBF] px-2">UPPH</th><th colSpan={2} className="border border-[#BFBFBF] px-2">RTY (%)</th>
                      <th rowSpan={2} className="border border-[#BFBFBF] px-2">M/P</th><th rowSpan={2} className="border border-[#BFBFBF] px-2">OS&amp;D</th><th colSpan={2} className="border border-[#BFBFBF] px-2">OT (man-hr)</th>
                    </tr>
                    <tr className="bg-[#DDEBF7] text-center text-fs-11 font-bold text-[#1F3864]">
                      {['Plan', 'Actual', 'Target', 'Actual', 'Target', 'Actual', 'Target', 'Actual', 'Planned', 'Unplanned'].map((h, i) => <th key={i} className="border border-[#BFBFBF] px-2 py-1">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {S.slice().reverse().flatMap((d) => {
                      const shown = IDS.filter((l) => d.lines[l] || d.kpi?.[l]);
                      const row = (l, a, k, first) => (
                        <tr key={`${d.date}|${l}`} className="text-center">
                          {first && <td rowSpan={shown.length + (shown.length > 1 ? 1 : 0)} className="border border-[#D4D4D4] px-2 py-1 align-middle font-semibold whitespace-nowrap">{dmy(d.date)}</td>}
                          <td className="border border-[#D4D4D4] px-2 py-1 font-bold">{faOf(l).fa}</td>
                          <td className="border border-[#D4D4D4] px-2 font-mono">{a?.plan == null ? '—' : nf(a.plan)}</td><td className={`border border-[#D4D4D4] px-2 font-mono font-bold ${cellTone(a?.qty, a?.plan)}`}>{a ? nf(a.qty) : '—'}</td>
                          <td className="border border-[#D4D4D4] px-2 font-mono">{d1(a?.uphT ?? null)}</td><td className="border border-[#D4D4D4] px-2 font-mono">{d1(a?.uphA ?? null)}</td>
                          <td className="border border-[#D4D4D4] px-2 font-mono">{d2(a?.upphT ?? null)}</td><td className={`border border-[#D4D4D4] px-2 font-mono ${cellTone(a?.upphA, a?.upphT)}`}>{d2(a?.upphA ?? null)}</td>
                          <td className="border border-[#D4D4D4] px-2 font-mono">{a ? KPI_RTY_TARGET : '—'}</td><td className={`border border-[#D4D4D4] px-2 font-mono ${cellTone(a?.rty, KPI_RTY_TARGET)}`}>{d2(a?.rty ?? null)}</td>
                          <td className="border border-[#D4D4D4] px-2 font-mono">{a?.mpAvg == null ? '—' : a.mpAvg.toFixed(0)}</td>
                          <td className="border border-[#D4D4D4] px-2 font-mono">{k?.osd == null ? '—' : Number(k.osd).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                          <td className="border border-[#D4D4D4] px-2 font-mono">{k?.otPlan == null ? '—' : d1(Number(k.otPlan))}</td><td className="border border-[#D4D4D4] px-2 font-mono">{k?.otUnplan == null ? '—' : d1(Number(k.otUnplan))}</td>
                        </tr>
                      );
                      const out = shown.map((l, i) => row(l, d.lines[l], d.kpi?.[l], i === 0));
                      if (shown.length > 1) {
                        const t = d.total; const ks = shown.map((l) => d.kpi?.[l]).filter(Boolean); const s = (f) => (ks.some((k) => k[f] != null) ? ks.reduce((a, k) => a + (Number(k[f]) || 0), 0) : null);
                        out.push(
                          <tr key={`${d.date}|t`} className="bg-slate-100 text-center font-extrabold">
                            <td className="border border-[#D4D4D4] px-2 py-1">Total</td>
                            <td className="border border-[#D4D4D4] px-2 font-mono">{t.plan == null ? '—' : nf(t.plan)}</td><td className="border border-[#D4D4D4] px-2 font-mono">{nf(t.qty)}</td>
                            <td className="border border-[#D4D4D4] px-2 font-mono">{d1(t.uphT)}</td><td className="border border-[#D4D4D4] px-2 font-mono">{d1(t.uphA)}</td>
                            <td className="border border-[#D4D4D4] px-2 font-mono">{d2(t.upphT)}</td><td className="border border-[#D4D4D4] px-2 font-mono">{d2(t.upphA)}</td>
                            <td className="border border-[#D4D4D4] px-2 font-mono">{KPI_RTY_TARGET}</td><td className="border border-[#D4D4D4] px-2 font-mono">{d2(t.rty)}</td>
                            <td className="border border-[#D4D4D4] px-2 font-mono">{t.mpAvg == null ? '—' : nf(shown.reduce((a, l) => a + (d.lines[l]?.mpAvg || 0), 0))}</td>
                            <td className="border border-[#D4D4D4] px-2 font-mono">{s('osd') == null ? '—' : s('osd').toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                            <td className="border border-[#D4D4D4] px-2 font-mono">{s('otPlan') == null ? '—' : d1(s('otPlan'))}</td><td className="border border-[#D4D4D4] px-2 font-mono">{s('otUnplan') == null ? '—' : d1(s('otUnplan'))}</td>
                          </tr>,
                        );
                      }
                      return out;
                    })}
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
