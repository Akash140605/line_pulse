import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLastScans } from '../hooks/useLastScans';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, CalendarDays } from 'lucide-react';
import MesDrawer from '../components/MesDrawer';
import { KpiPanel } from '../components/OleApq';
import { PageLoader } from '../components/Loader';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, oleSum, lossSummary, normEntry, modelTimeOfHour, okFrom, watchFrom, hm, oleConfig, planTargetOf, goodOf } from '../utils/ole';
import { api } from '../api';
import { LINE_COLOR, nf, dmy, useOleLines, groupNameOf, useOleData, band, bandInk, inkOf, companyOf } from '../components/OleParts';
import { useHeaderSlot } from './CleanDashboardPage';

/*
 * OLE calendar: one month as a wall calendar. Every day shows its OLE (coloured like the benchmark:
 * green 85 % and above, amber 60–85 %, red below 60 %) with A · P · Q and the pieces made; a click on a day opens
 * that day line by line with its lost time and top loss reasons. Overall or one line; month by month.
 */
const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pc = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const p0 = (v) => (v == null ? '—' : `${Math.round(v * 100)}`);
const tone = (v) => (v == null ? 'text-slate-500' : v >= okFrom() ? 'text-emerald-700' : v >= watchFrom() ? 'text-amber-700' : 'text-red-700');
const cellBg = (v) => (v == null ? 'bg-white' : v >= okFrom() ? 'bg-emerald-50 border-emerald-300' : v >= watchFrom() ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-300');
const hms = (min) => hm(Math.max(0, Number(min) || 0));   // the admin's time format (Setup → OLE formulas)
const lost = (t) => (t?.lossMin || 0) + (t?.speedMin || 0);
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();   // m: 1–12

const p2 = (n) => String(n).padStart(2, '0');
const FACT = [['A', 'Availability'], ['P', 'Performance'], ['Q', 'Quality']];
/** 23-11-2026: calendar day colours — a light tint, a strong top bar and dark text (readable, not a solid block) */
const LV = {
  ok: { bar: '#16A34A', bg: '#ECFDF3', line: '#A7E3BE', ink: '#146C3A' },
  mid: { bar: '#E0A100', bg: '#FFF8E6', line: '#F2D58A', ink: '#8A5A00' },
  bad: { bar: '#DC2626', bg: '#FEF0F0', line: '#F5B5B5', ink: '#B42318' },
};
const lvOf = (v, k = null) => (v == null ? null : LV[v >= okFrom(k) ? 'ok' : v >= watchFrom(k) ? 'mid' : 'bad']);
const cellTone = (v, k = null) => (v == null ? '' : v >= okFrom(k) ? 'bg-emerald-50 text-emerald-800' : v >= watchFrom(k) ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800');

/**
 * Drill-down of one day, from the right: 1 the day (A · P · Q · OLE, the weakest factor, line by line) →
 * 2 hour by hour (all lines or one line) → 3 one hour: the models made in it and the losses entered.
 */
export function DayDrawer({ date, day, ids, info, losses, onClose, co = null }) {
  const coOf = (m) => (co ? co(m) : '');   // 20-11-2026: company of a model
  const [line, setLine] = useState(null);   // null = all lines
  const [hour, setHour] = useState(null);
  useEffect(() => { setLine(null); setHour(null); }, [date]);
  const scope = line ? [line] : ids;
  const t = info?.t;
  const weak = t ? FACT.filter(([k]) => t[k] != null).sort((a, b) => t[a[0]] - t[b[0]])[0] : null;
  const hoursAll = [...new Set(scope.flatMap((l) => (day?.byLine[l]?.rows || []).filter((r) => !r.future && (r.qty > 0 || r.totalMin > 0) && !r.closed).map((r) => r.hour)))].sort((a, b) => a - b);
  const hourRow = (h) => oleSum(scope.map((l) => day?.byLine[l]?.rows.find((r) => r.hour === h)));
  const hourT = hour != null ? hourRow(hour) : null;
  // one hour opened: each line's scans of that hour → the minutes every model ran and the time it lost against its std
  const [mt, setMt] = useState(null);
  const [mtBusy, setMtBusy] = useState(false);
  useEffect(() => {
    setMt(null);
    if (hour == null) return undefined;
    const c = new AbortController(); let alive = true;
    setMtBusy(true);
    Promise.all(scope.map(async (l) => {
      const r = day?.byLine[l]?.rows.find((x) => x.hour === hour);
      if (!r || !(r.qty > 0) || r.extra) return [l, null];
      let scans = null;
      try { const d = await api.hourDetail(date, hour, { line: l }, { signal: c.signal }); scans = Array.isArray(d?.scans) ? d.scans : null; } catch { scans = null; }
      return [l, modelTimeOfHour({ hour, scans, models: r.models, stops: (r.e || normEntry(r.entry)).stops, totalMin: r.totalMin, shift: day?.byLine[l]?.shift })];
    })).then((list) => { if (alive) { setMt(Object.fromEntries(list)); setMtBusy(false); } });
    return () => { alive = false; c.abort(); };
  }, [hour, line, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${date}T12:00:00`).getDay()];
  // the MES drawer: the drill path (day › line) above the title, ‹ back one level, Esc = back
  const dayLabel = `${dmy(date)} · ${title}`;
  const crumbs = [
    ...(line || hour != null ? [{ label: dayLabel, onClick: () => { setLine(null); setHour(null); } }] : []),
    ...(line && hour != null ? [{ label: `Line ${line}`, onClick: () => setHour(null) }] : []),
  ];
  const head = hour != null ? `${p2(hour)}:00–${p2(hour + 1)}:00` : line ? `Line ${line}` : dayLabel;
  const back = hour != null ? () => setHour(null) : line ? () => setLine(null) : null;
  return (
    <MesDrawer title={head} sub={line || hour != null ? null : 'Line by line · hour by hour'} icon={CalendarDays} crumbs={crumbs} onBack={back} onClose={onClose}
      label={`Day ${dmy(date)} details`} backdropLabel="Close day" width={80} fit="width" minWidth={980}>
        <div className="p-3">
          {!t ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-[2px] border border-[#BFBFBF]" aria-label="A P Q of the day"><KpiPanel t={oleSum([])} zero gauge={150} /></div>
              <p className="text-fs-14 text-slate-600">{info?.off ? `${info.off} — no production planned.` : 'No production on this day.'}</p>
            </div>
          ) : hour == null ? (
            <div className="flex flex-col gap-4">
              {/* 1 — the day (or one line of it) */}
              {(() => {
                const T = line ? (day?.byLine[line]?.total || oleSum([])) : t;
                const w = FACT.filter(([k]) => T[k] != null).sort((a, b) => T[a[0]] - T[b[0]])[0];
                return (
                  <>
                    <div className="overflow-hidden rounded-[2px] border border-[#BFBFBF]" aria-label="A P Q of the day"><KpiPanel t={T} zero gauge={150} /></div>
                  </>
                );
              })()}
              {!line && ids.length > 1 && (
                <div>
                  <div className="mb-1 text-fs-14 font-extrabold text-slate-800">Line by line</div>
                  <table className="w-full text-fs-13">
                    <thead><tr className="border-b border-slate-200 text-left text-fs-12 text-slate-500">{['Line', 'Target', 'Actual', 'Achieved', 'A', 'P', 'Q', 'OLE', 'Lost time'].map((h) => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}</tr></thead>
                    <tbody>
                      {ids.map((l) => { const x = day?.byLine[l]?.total || oleSum([]); return (
                        <tr key={l} onClick={() => setLine(l)} className="cursor-pointer border-b border-slate-100 hover:bg-blue-50" title={`Open Line ${l}`}>
                          <td className="px-2 py-1.5 font-bold whitespace-nowrap">Line {l} ›</td>
                          {(() => { const tg = planTargetOf(x); const a = tg ? x.qty / tg : null; return (<>
                            <td className="px-2 font-mono text-slate-600">{tg == null ? '—' : nf(tg)}</td>
                            <td className="px-2 font-mono font-bold">{nf(x.qty)}</td>
                            <td className={`px-2 font-mono font-bold ${a == null ? '' : a >= 1 ? 'text-emerald-700' : 'text-red-700'}`}>{a == null ? '—' : pc(a)}</td>
                          </>); })()}
                          {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-2 font-mono font-bold ${cellTone(x[k], k === 'ole' ? null : k)}`}>{pc(x[k])}</td>)}
                          <td className="px-2 font-mono whitespace-nowrap">{hms(lost(x))}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              )}
              {/* 2 — hour by hour */}
              <div>
                <div className="mb-1 text-fs-14 font-extrabold text-slate-800">Hour by hour{line ? ` · Line ${line}` : ' · all lines'}</div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-fs-13">
                    <thead className="bg-slate-50"><tr className="text-left text-fs-12 text-slate-500">{[['Hour'], ['Target'], ['Actual'], ['Run (min)'], ['Idle (min)'], ['Lost vs Std (min)'], ['A'], ['P'], ['Q'], ['OLE']].map(([h, tip]) => <th key={h} title={tip} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
                    <tbody>
                      {hoursAll.map((h) => { const x = hourRow(h); return (
                        <tr key={h} onClick={() => setHour(h)} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50" aria-label={`Hour ${p2(h)}:00`}>
                          <td className="px-2 py-1.5 font-mono font-bold whitespace-nowrap">{p2(h)}–{p2(h + 1)} ›</td>
                          <td className="px-2 font-mono text-slate-600">{planTargetOf(x) != null ? nf(planTargetOf(x)) : '—'}</td>
                          <td className="px-2 font-mono font-bold">{nf(x.qty)}</td>
                          <td className="px-2 font-mono">{Math.round(x.actualMin)}</td>
                          <td className={`px-2 font-mono ${x.lossMin + x.stopMin > 0 ? 'font-bold text-red-700' : 'text-slate-400'}`}>{Math.round(x.lossMin + x.stopMin)}</td>
                          <td className={`px-2 font-mono ${x.speedMin >= 1 ? 'font-bold text-amber-700' : 'text-slate-400'}`}>{x.speedMin == null ? '—' : Math.round(x.speedMin)}</td>
                          {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-2 font-mono font-bold ${cellTone(x[k], k === 'ole' ? null : k)}`}>{pc(x[k], 0)}</td>)}
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              </div>
              {!line && (losses?.reason || []).some((x) => x.unit === 'min' && x.value > 0) && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-fs-14 font-extrabold text-slate-800">Loss reasons of the day</div>
                  <ol className="mt-1 flex flex-col gap-1">
                    {losses.reason.filter((x) => x.unit === 'min' && x.value > 0).slice(0, 6).map((x, i) => (
                      <li key={`${x.kind}|${x.name}`} className="flex justify-between gap-2 text-fs-13"><span className="min-w-0 truncate"><span className="font-semibold">{i + 1}. {x.name}</span>{x.models?.length > 0 && <span className="ml-1 font-mono text-fs-12 text-slate-600" title={x.models.map((m) => `${coOf(m.name) ? `${coOf(m.name)} ` : ''}${m.name} — ${hms(m.value)}`).join('\n')}>· {x.models.slice(0, 2).map((m) => `${coOf(m.name) ? `${coOf(m.name)} ` : ''}${m.name}`).join(', ')}{x.models.length > 2 ? ` +${x.models.length - 2}` : ''}</span>}</span><span className="font-mono font-bold">{hms(x.value)}</span></li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ) : (
            /* 3 — one hour: models and losses */
            <div className="flex flex-col gap-4">
              <div className="overflow-hidden rounded-[2px] border border-[#BFBFBF]" aria-label="A P Q of the hour"><KpiPanel t={hourT} zero gauge={150} /></div>
              {/* (19-11-2026: the run / idle / slow text tiles taken out — the A · P · Q boxes above say it) */}
              <div>
                <div className="mb-1 text-fs-14 font-extrabold text-slate-800">Models made in this hour <span className="text-fs-12 font-semibold text-slate-500">· {mtBusy ? 'reading the scans …' : 'run time of each model from its scans'}</span></div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-fs-13">
                    <thead className="bg-slate-50"><tr className="text-left text-fs-12 text-slate-500">{['Line', 'Company', 'Model', 'Target', 'Actual', 'Std Cycle', 'Actual Cycle', 'Run (min)', 'Std Time (min)', 'Lost vs Std (min)'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
                    <tbody>
                      {scope.flatMap((l) => (day?.byLine[l]?.rows.find((r) => r.hour === hour)?.models || []).map((m) => {
                        const q = Number(m.quantity) || 0;
                        const x = mt?.[l]?.rows.find((y) => y.mmId === m.mmId || y.model === m.model);
                        const run = x ? x.runMin : null;
                        return (
                          <tr key={`${l}-${m.mmId}-${m.model}`} className="border-t border-slate-100">
                            <td className="px-2 py-1.5 whitespace-nowrap">Line {l}</td>
                            <td className="px-2 whitespace-nowrap text-fs-12 font-bold uppercase text-slate-600">{coOf(m.model) || '—'}</td>
                            <td className="px-2 font-bold">{m.model}</td>
                            <td className="px-2 font-mono text-slate-600">{m.std && run ? nf(Math.round((run * 60) / m.std)) : '—'}</td>
                            <td className="px-2 font-mono font-bold">{nf(q)}</td>
                            <td className="px-2 font-mono">{m.std ? `${Math.round(m.std * 10) / 10}s` : <span className="text-slate-400">—</span>}</td>
                            <td className={`px-2 font-mono ${m.std && run && (run * 60) / q > m.std * 1.005 ? 'font-bold text-red-700' : ''}`}>{run && q ? `${Math.round(((run * 60) / q) * 10) / 10}s` : '—'}</td>
                            <td className="px-2 font-mono">{run == null ? '—' : Math.round(run * 10) / 10}</td>
                            <td className="px-2 font-mono">{m.std ? Math.round((q * m.std) / 6) / 10 : '—'}</td>
                            <td className={`px-2 font-mono font-bold ${x?.lostMin >= 1 ? 'text-amber-700' : 'text-emerald-700'}`}>{x?.lostMin == null ? '—' : Math.round(x.lostMin * 10) / 10}</td>
                          </tr>
                        );
                      }))}
                      {!scope.some((l) => (day?.byLine[l]?.rows.find((r) => r.hour === hour)?.models || []).length) && <tr><td colSpan={10} className="px-2 py-2 text-fs-13 text-slate-500">No pieces made in this hour{hourT.lossMin + hourT.stopMin > 0 ? ' — see the losses below' : ' and no loss entered for it'}.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <div className="mb-1 text-fs-14 font-extrabold text-slate-800">Losses entered for this hour</div>
                {(() => {
                  const list = scope.flatMap((l) => { const r = day?.byLine[l]?.rows.find((x) => x.hour === hour); const e = r?.e || normEntry(r?.entry); return [
                    ...e.stops.map((x) => [l, 'Idle time', x.reason, x.dept, `${x.min} min`]), ...e.losses.map((x) => [l, x.model && oleConfig().lossIn !== 'avail' ? 'Performance loss' : 'Idle time', x.reason, x.dept, `${x.min} min`]),
                    ...e.rejects.map((x) => [l, 'Rejection', x.reason, x.dept, `${x.qty} pcs`]), ...e.rework.map((x) => [l, 'Rework', x.reason, x.dept, `${x.qty} pcs`])]; });
                  return !list.length ? <p className="text-fs-13 text-slate-500">Nothing entered</p> : (
                    <ul className="flex flex-col gap-1">{list.map((x, i) => <li key={i} className="flex justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-fs-13"><span><b>{x[1]}</b> · {x[2] || 'Not given'}{x[3] ? <span className="text-slate-500"> · {x[3]}</span> : null}{ids.length > 1 ? <span className="text-slate-500"> · Line {x[0]}</span> : null}</span><span className="font-mono font-bold">{x[4]}</span></li>)}</ul>
                  );
                })()}
              </div>
              <button type="button" onClick={() => setHour(null)} className="self-start rounded-md border border-slate-300 px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">‹ Back to the hours</button>
            </div>
          )}
        </div>
    </MesDrawer>
  );
}

export default function OleCalendarPage() {
  const slot = useHeaderSlot();
  const ALL = useOleLines();
  const today = serverToday();
  const [only, setOnly] = useState('all');
  const IDS = useMemo(() => (only !== 'all' && ALL.includes(only) ? [only] : ALL), [only, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ym, setYm] = useState(today.slice(0, 7));   // YYYY-MM
  const [pick, setPick] = useState(null);           // the day whose details are open
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const start = `${ym}-01`;
  const monthEnd = `${ym}-${pad(lastDay(y, m))}`;
  const future = start > today;
  const end = monthEnd > today ? today : monthEnd;
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start, end: future ? start : end, ids: IDS, pollEntries: false, paused: future });
  const R0 = useMemo(() => (D.al && !future ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start, end, today, nowMin: D.endMin, ids: IDS }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, start, end, today, D.endMin, IDS, future]);
  // 25-11-2026: the finished days end at the line's last scan, as in the HPR / SAWM KPI (same Plan Target Qty)
  const lastScans = useLastScans({ R: R0, ids: IDS, today });
  const R = useMemo(() => (R0 && Object.keys(lastScans).length ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start, end, today, nowMin: D.endMin, ids: IDS, lastScans }) : R0), [R0, lastScans]); // eslint-disable-line react-hooks/exhaustive-deps
  const co = useMemo(() => companyOf(D.al), [D.al]);
  const byDate = useMemo(() => Object.fromEntries((R?.days || []).map((d) => [d.date, d])), [R]);
  const T = R?.total || oleSum([]);
  const group = groupNameOf(IDS);
  const move = (k) => { const d = new Date(y, m - 1 + k, 1); setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); setPick(null); };

  // the days of the month with their OLE
  const dayInfo = (date) => {
    const d = byDate[date];
    const t = d ? d.total : null;
    const ran = t && (t.qty > 0 || t.totalMin > 0);
    const off = d && !ran ? IDS.map((l) => d.byLine[l]).find((x) => x?.closed === 'planned') : null;
    return { d, t: ran ? t : null, off: off ? (off.dayOff?.reason || 'Planned off') : null };
  };
  const ran = (R?.days || []).map((d) => ({ date: d.date, ...dayInfo(d.date) })).filter((x) => x.t && x.t.ole != null);
  const best = ran.reduce((b, x) => (!b || x.t.ole > b.t.ole ? x : b), null);
  const worst = ran.reduce((b, x) => (!b || x.t.ole < b.t.ole ? x : b), null);
  const good = ran.filter((x) => x.t.ole >= okFrom()).length;

  // calendar cells: blanks before the 1st (weeks start on Monday), then every day of the month
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: lastDay(y, m) }, (_, i) => `${ym}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);

  const years = Array.from({ length: 4 }, (_, i) => Number(today.slice(0, 4)) - 2 + i);
  const [metric, setMetric] = useState('ole');
  // 19-11-2026: the month fills the screen exactly down to the status bar (no free space, no scrolling) on a PC
  const calRef = useRef(null);
  const [calH, setCalH] = useState(null);
  const hasR = !!R;
  useLayoutEffect(() => {
    const fit = () => {
      const el = calRef.current;
      if (!el || window.innerWidth < 1280 || window.innerHeight < 600) { setCalH(null); return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bar = document.querySelector('.lp-status')?.offsetHeight || 0;
      setCalH(Math.max(480, Math.floor(window.innerHeight - top - bar - 12)));
    };
    fit();
    window.addEventListener('resize', fit);
    const t = setTimeout(fit, 300);   // the header strip may wrap once the filters are in
    return () => { window.removeEventListener('resize', fit); clearTimeout(t); };
  }, [hasR]);   // OLE · Avail · Perf · Qual (the MES calendar's toggle)
  const seg = (on) => `h-8 whitespace-nowrap border-r border-[#BFBFBF] px-3 text-fs-13 font-semibold last:border-r-0 ${on ? 'bg-[#1F4E79] text-white' : 'bg-white text-[#1F3864] hover:bg-[#EAF2FB]'}`;
  const sel = 'h-8 rounded-[3px] border border-[#BFBFBF] bg-white px-2 text-fs-13 font-semibold text-[#222] focus:outline-none focus:ring-2 focus:ring-[#BDD7EE]';
  const arr = 'grid h-8 w-8 place-items-center rounded-[3px] border border-[#BFBFBF] bg-white text-[#1F3864] hover:bg-[#EAF2FB] disabled:opacity-40';
  const lab = 'text-fs-13 font-bold text-[#1F3864]';
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      {ALL.length > 1 && (
        <div className="flex max-w-full shrink-0 flex-wrap overflow-hidden rounded-[3px] border border-[#BFBFBF]" role="group" aria-label="Calendar view">
          {['all', ...ALL].map((v) => (
            <button key={v} type="button" aria-pressed={only === v} onClick={() => { setOnly(v); setPick(null); }} aria-label={v === 'all' ? 'Calendar of all lines' : `Calendar of Line ${v}`} className={seg(only === v)}>{v === 'all' ? 'Overall' : `Line ${v}`}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => move(-1)} aria-label="Previous month" className={arr}><ChevronLeft size={16} /></button>
        <span className={lab}>Month:</span>
        <select aria-label="Month" value={m} onChange={(e) => { setYm(`${y}-${pad(e.target.value)}`); setPick(null); }} className={`${sel} min-w-[7.5rem]`}>
          {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
        <span className={lab}>Year:</span>
        <select aria-label="Year" value={y} onChange={(e) => { setYm(`${e.target.value}-${pad(m)}`); setPick(null); }} className={sel}>
          {years.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button type="button" onClick={() => move(1)} disabled={`${ym}-01` >= `${today.slice(0, 7)}-01`} aria-label="Next month" className={arr}><ChevronRight size={16} /></button>
        {ym !== today.slice(0, 7) && <button type="button" onClick={() => { setYm(today.slice(0, 7)); setPick(null); }} className={`${seg(false)} rounded-[3px] border`}>This month</button>}
      </div>
      {D.loading && R && <span className="text-fs-12 font-semibold text-slate-500">Updating …</span>}
    </div>
  );

  const P = pick ? dayInfo(pick) : null;
  const PL = useMemo(() => (pick && byDate[pick] ? lossSummary(IDS.flatMap((l) => byDate[pick].byLine[l]?.rows || []), D.ent.reasons.station) : null), [pick, byDate, IDS, D.ent.reasons]);

  // the weeks of the calendar (rows) with their week total (the WEEK column)
  const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const weekT = (dates) => oleSum(dates.filter(Boolean).map((d) => dayInfo(d).t).filter(Boolean));
  const val = (t) => (t ? (metric === 'ole' ? t.ole : t[metric]) : null);
  const mk = metric === 'ole' ? null : metric;
  const okPc = Math.round(okFrom(mk) * 100), watchPc = Math.round(watchFrom(mk) * 100);
  const target = planTargetOf(T) ?? 0;
  const lineTs = IDS.map((l) => [l, oleSum((R?.days || []).map((d) => d.byLine[l]?.total))]);

  return (
    <div className="flex flex-col gap-3" aria-label="OLE calendar">
      {slot ? createPortal(filters, slot) : <div className="flex min-w-0 flex-col gap-2">{filters}</div>}
      {D.err && <div role="alert" className="rounded-[3px] border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}
      {future && <div className={`${card} px-4 py-6 text-center text-fs-14 text-slate-600`}>{MONTHS[m - 1]} {y} has not started yet.</div>}
      {!future && !R && !D.err && <PageLoader label={`Reading ${MONTHS[m - 1]} ${y}`} sub={`OLE of every day · ${group}`} />}
      {R && (
        // the C8 MES calendar (19-11-2026): the month on one screen, no scrolling — calendar | month at a glance
        <div ref={calRef} className="lp-cal grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]" style={calH ? { height: calH } : undefined}>
          <section className="lp-cal-card flex min-h-0 flex-col rounded-[2px] border border-[#BFBFBF] bg-white shadow-[0_1px_3px_rgba(15,29,36,0.10)]" aria-label={`Calendar ${MONTHS[m - 1]} ${y}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#D4D4D4] px-3 py-2">
              <h2 className="border-l-4 border-[#1F3864] pl-2 text-fs-16 font-bold text-[#1F3864]">{MONTHS[m - 1]} {y}<span className="ml-2 text-fs-13 font-semibold text-[#777]">{group}</span></h2>
              <div className="ml-auto flex flex-wrap items-center gap-1.5 text-fs-12 font-semibold text-[#333]" aria-label="Legend">
                <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#D4D4D4] px-1.5 py-0.5"><i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: LV.ok.bar }} />≥ {okPc}%</span>
                <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#D4D4D4] px-1.5 py-0.5"><i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: LV.mid.bar }} />{watchPc}–{okPc}%</span>
                <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#D4D4D4] px-1.5 py-0.5"><i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: LV.bad.bar }} />&lt; {watchPc}%</span>
                <div className="flex overflow-hidden rounded-[3px] border border-[#BFBFBF]" role="group" aria-label="Show">
                  {[['ole', 'OLE'], ['A', 'Avail'], ['P', 'Perf'], ['Q', 'Qual']].map(([k, l]) => <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)} className={`${seg(metric === k)} h-7 px-2.5`}>{l}</button>)}
                </div>
              </div>
            </div>
            <div className="lp-cal-grid grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(0,1fr))_minmax(64px,0.8fr)] gap-1.5 p-2" style={{ gridTemplateRows: `auto repeat(${weeks.length}, minmax(0, 1fr))` }}>
              {[...WEEK, 'Week'].map((w) => <div key={w} className={`py-0.5 text-center text-fs-12 font-bold tracking-[0.12em] lp-caps ${w === 'Sun' ? 'text-[#C00000]' : 'text-[#555]'}`}>{w}</div>)}
              {weeks.map((wk, wi) => {
                const wt = weekT(wk); const wv = wt.qty > 0 || wt.totalMin > 0 ? val(wt) : null;
                return (
                  <React.Fragment key={`w${wi}`}>
                    {wk.map((date, i) => {
                      if (!date) return <div key={`b${wi}-${i}`} aria-hidden />;
                      const fut = date > today;
                      const { t, off } = fut ? { t: null, off: null } : dayInfo(date);
                      const v = val(t);
                      const isToday = date === today, on = pick === date;
                      const fill = t && v != null;
                      const c = fill ? lvOf(v, mk) : null;
                      return (
                        <button key={date} type="button" disabled={fut} onClick={() => setPick(on ? null : date)} aria-pressed={on}
                          aria-label={`${dmy(date)}: ${t ? `OLE ${pc(t.ole)}` : off || (fut ? 'not yet' : 'no production')}`}
                          className={`lp-cal-day relative flex min-h-[58px] min-w-0 flex-col overflow-hidden rounded border px-1.5 pb-1 pt-1.5 text-left transition ${fill ? 'hover:shadow-md' : isToday ? 'border-[#9DB7D5] lp-cal-hatch' : fut ? 'border-[#E3E6EA] bg-[#FAFBFC]' : 'border-[#E3E6EA] bg-[#F4F6F8]'} ${on ? 'ring-2 ring-[#1F3864] ring-offset-1' : ''}`}
                          style={fill ? { background: c.bg, borderColor: c.line, boxShadow: `inset 0 4px 0 ${c.bar}` } : undefined}>
                          <span className="flex items-center justify-between gap-1">
                            {isToday ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#1F3864] px-1 text-[11px] font-bold text-white">{Number(date.slice(8, 10))}</span>
                              : <span className={`text-fs-13 font-bold ${fut ? 'text-[#AAB2BD]' : 'text-[#334155]'}`}>{Number(date.slice(8, 10))}</span>}
                            {fill ? <span className="lp-cal-pcs truncate font-semibold tabular-nums text-[#475569]">{nf(t.qty)} pcs</span>
                              : isToday && <span className="text-[11px] font-bold tracking-[0.08em] text-[#1F4E79] lp-caps">Today</span>}
                          </span>
                          {fill ? (
                            <span className="flex min-h-0 flex-1 flex-col items-center justify-center leading-tight">
                              <span className="lp-cal-big font-extrabold tabular-nums" style={{ color: c.ink }}>{pc(v)}</span>
                              {/* A · P · Q in one row; a factor under its own green mark is red — that is what pulled the day down */}
                              <span className="lp-cal-sub lp-cal-apq" title={`Availability ${pc(t.A)} · Performance ${pc(t.P)} · Quality ${pc(t.Q)}`}>
                                {[['A', 'Avail', t.A], ['P', 'Perf', t.P], ['Q', 'Qual', t.Q]].map(([k, l, x]) => {
                                  const bad = x != null && x < okFrom(k);
                                  return <span key={k} className={`lp-cal-k ${bad ? 'is-low' : ''}`}><i><span className="lp-cal-kl">{l}</span><span className="lp-cal-ks">{k}</span></i><b>{p0(x)}</b></span>;
                                })}
                              </span>
                            </span>
                          ) : !fut && <span className="m-auto text-center text-fs-12 font-semibold leading-tight text-[#8A94A3]">{off || (isToday ? 'No data yet' : 'No production')}</span>}
                        </button>
                      );
                    })}
                    <div className="lp-cal-week flex min-h-[58px] min-w-0 flex-col items-center justify-center rounded border border-[#D4D4D4] bg-white px-1 leading-tight" style={wv == null ? undefined : { boxShadow: `inset 0 -4px 0 ${lvOf(wv, mk).bar}` }} aria-label={`Week ${wi + 1}: ${wv == null ? 'no production' : pc(wv)}`}>
                      <span className="text-[11px] font-bold text-[#777]">W{wi + 1}</span>
                      {wv == null ? <span className="text-fs-16 font-bold text-[#999]">—</span> : <>
                        <span className="lp-cal-wk font-extrabold tabular-nums" style={{ color: lvOf(wv, mk).ink }}>{pc(wv)}</span>
                        <span className="truncate text-[11px] text-[#777] tabular-nums">{nf(wt.qty)} pcs</span>
                      </>}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </section>

          {/* month at a glance */}
          <aside className="lp-cal-side flex min-h-0 flex-col gap-3" aria-label="Month summary">
            <section className="rounded-[2px] border border-[#BFBFBF] bg-white shadow-[0_1px_3px_rgba(15,29,36,0.10)]">
              <h3 className="border-b border-[#D4D4D4] px-3 py-2"><span className="border-l-4 border-[#1F3864] pl-2 text-fs-14 font-bold text-[#1F3864]">Month at a glance</span></h3>
              <div className="flex items-center gap-3 border-b border-[#D4D4D4] px-3 py-2.5">
                <Ring v={T.ole} size={78} label="OLE" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {FACT.map(([k, n]) => (
                    <div key={k}>
                      <div className="flex items-baseline justify-between text-fs-13"><b className="text-[#1F3864]">{n}</b><b className="tabular-nums" style={{ color: T[k] == null ? '#666' : bandInk(T[k], k) }}>{pc(T[k] ?? 0)}</b></div>
                      <div className="h-1.5 overflow-hidden rounded-[2px] bg-[#E7ECF2]"><div className="h-full" style={{ width: `${Math.min(100, (T[k] ?? 0) * 100)}%`, background: band(T[k], k) }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-y divide-[#E3E6EA] border-b border-[#E3E6EA] [&>*:nth-child(-n+2)]:border-t-0">
                {[
                  ['Target', nf(target), 'qty planned', '#1F3864'],
                  ['Production', nf(T.qty), target ? `${Math.round((T.qty / target) * 1000) / 10}% of target` : 'qty made', T.qty >= target ? '#006100' : '#C00000'],
                  T.rejects > 0 ? ['Rejected', nf(T.rejects), T.qty ? `${Math.round((T.rejects / T.qty) * 1000) / 10}% of production` : '0% of production', '#C00000']
                    : ['Rework', nf(T.rework || 0), T.qty ? `${Math.round(((T.rework || 0) / T.qty) * 1000) / 10}% of production` : '0% of production', '#C00000'],
                  ['Good', nf(goodOf(T)), 'qty OK', '#006100'],
                  ['Available', hms(T.plannedMin), 'planned time', '#1F3864'],
                  ['Down time', hms(T.lossMin), T.plannedMin ? `${Math.round((T.lossMin / T.plannedMin) * 1000) / 10}% of planned` : '0% of planned', '#C00000'],
                ].map(([k, v, sub, c]) => (
                  <div key={k} className="min-w-0 px-3 py-1.5">
                    <div className="text-[11px] font-bold tracking-[0.08em] text-[#555] lp-caps">{k}</div>
                    <div className="truncate text-fs-18 font-bold tabular-nums" style={{ color: c }}>{v}</div>
                    <div className="truncate text-[11px] text-[#777]">{sub}</div>
                  </div>
                ))}
                {[['Best day', best], ['Worst day', worst]].map(([k, x]) => (
                  <button key={k} type="button" disabled={!x} onClick={() => x && setPick(x.date)} className="min-w-0 px-3 py-1.5 text-left hover:bg-[#EAF2FB] disabled:hover:bg-transparent" aria-label={`${k}${x ? ` ${dmy(x.date)}` : ''}`}>
                    <div className="flex items-center justify-between text-[11px] font-bold tracking-[0.08em] text-[#555] lp-caps">{k}{x && <ChevronRight size={12} />}</div>
                    <div className="truncate text-fs-18 font-bold tabular-nums" style={{ color: x ? (k === 'Best day' ? '#006100' : '#C00000') : '#999' }}>{x ? pc(x.t.ole) : '—'}</div>
                    <div className="truncate text-[11px] text-[#777]">{x ? `${WEEK[(new Date(`${x.date}T12:00:00`).getDay() + 6) % 7]}, ${dmy(x.date)}` : 'no production'}</div>
                  </button>
                ))}
              </div>
              <div className="px-3 py-1.5 text-[11px] text-[#777]">Days at {okPc}% +: <b className="text-[#1F3864]">{good} of {ran.length}</b></div>
            </section>
            <section className="min-h-0 flex-1 rounded-[2px] border border-[#BFBFBF] bg-white shadow-[0_1px_3px_rgba(15,29,36,0.10)]" aria-label="Lines this month">
              <h3 className="border-b border-[#D4D4D4] px-3 py-2"><span className="border-l-4 border-[#1F3864] pl-2 text-fs-14 font-bold text-[#1F3864]">Lines</span><span className="ml-1.5 text-[11px] text-[#777]">· this month</span></h3>
              <div className="divide-y divide-[#E3E6EA]">
                {lineTs.map(([l, t]) => (
                  <div key={l} className="flex items-center gap-2.5 px-3 py-1.5">
                    <Ring v={t.ole} size={50} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="text-fs-13 font-bold text-[#1F3864]">Line {l}</div>
                      <div className="truncate text-[11px] tabular-nums text-[#555]">A {p0(t.A)} · P {p0(t.P)} · Q {p0(t.Q)}</div>
                    </div>
                    <div className="shrink-0 text-right leading-tight">
                      <div className="text-fs-14 font-bold tabular-nums text-[#1F3864]">{nf(t.qty)} <span className="text-[11px] font-normal text-[#777]">pcs</span></div>
                      <div className="text-[11px] tabular-nums text-[#777]">Target {nf(planTargetOf(t) ?? 0)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>

          {/* the day picked: drill-down from the right — day → hour by hour → the models of one hour */}
          {pick && <DayDrawer date={pick} day={byDate[pick]} ids={IDS} info={P} losses={PL} co={co} onClose={() => setPick(null)} />}
        </div>
      )}
    </div>
  );
}

/** a ring with the % in the middle (Month at a glance, the lines) */
function Ring({ v, size = 78, label = '' }) {
  const r = size / 2 - (size > 50 ? 6 : 4), c = 2 * Math.PI * r, w = size > 50 ? 7 : 4.5;
  const col = v == null ? '#C8CED6' : band(v);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`${label || 'OLE'} ${pc(v ?? 0)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7ECF2" strokeWidth={w} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={w} strokeDasharray={`${Math.min(1, Math.max(0, v ?? 0)) * c} ${c}`} strokeLinecap="butt" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <div className={`font-bold tabular-nums ${size > 50 ? 'text-[17px]' : 'text-[11px] tracking-[-0.04em]'}`} style={{ color: inkOf(col) }}>{pc(v ?? 0)}</div>
          {label && <div className="mt-0.5 text-[11px] font-semibold text-[#777]">{label}</div>}
        </div>
      </div>
    </div>
  );
}
