import { PageLoader } from '../components/Loader';
import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import React, { useMemo, useState } from 'react';
import { useLastScans } from '../hooks/useLastScans';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { addDays } from '../utils/mainFilter';
import { serverToday } from '../utils/serverTime';
import { oleRange, issuesOf, groupIssues, pct, lossSummary } from '../utils/ole';
import { LINE_COLOR, dmy, card, useOleLines, groupNameOf, monthOf, monthRange, useOleData, GroupBand, LineCard, HourTable, DeptDrill, QualityByStation } from '../components/OleParts';

/**
 * OLE dashboard (read only) — the lines of the login.
 *   Day:   a card per line (click → its hours) + all of them; losses by department → reason → each loss (drill down).
 *   Month: the month per line, OLE day by day (click a day → that day), losses of the month with the same drill down,
 *          and how many RCAs are pending / submitted / closed per department.
 * Filling is on the "Loss entry" page, the RCAs on the "RCA" page. Formulas: utils/ole.js.
 */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (m) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default function OlePage() {
  const IDS = useOleLines();
  const today = serverToday();
  const [view, setView] = useState('day');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(monthOf(today));
  const [sel, setSel] = useState(IDS[0]);
  const range = view === 'day' ? { start: date, end: date } : monthRange(month, today);
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS, pollEntries: true });
  const R0 = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }) : null),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, IDS]);
  // 25-11-2026: the finished days end at the line's last scan, as in the HPR / SAWM KPI (same Plan Target Qty)
  const lastScans = useLastScans({ R: R0, ids: IDS, today });
  const R = useMemo(() => (R0 && Object.keys(lastScans).length ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS, lastScans }) : R0), [R0, lastScans]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useMemo(() => (R ? issuesOf(R.days) : []), [R]);
  // rejection + rework of the period by quality station (all lines of the group)
  const stations = useMemo(() => (R ? lossSummary(R.days.flatMap((d) => IDS.flatMap((l) => d.byLine[l]?.rows || [])), D.ent.reasons.station).station : []), [R, IDS, D.ent.reasons]);
  const group = groupNameOf(IDS);
  const dayLines = view === 'day' && R ? (R.days[0]?.byLine || null) : null;
  const okOf = (l) => (D.al?.lines || []).find((x) => String(x.line) === l)?.ok !== false;
  const openDay = (d, line) => { setDate(d); if (line) setSel(String(line)); setView('day'); };
  const btn = (on) => `h-9 px-3 text-fs-13 font-semibold border-r last:border-r-0 border-slate-300 ${on ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;

  if (!IDS.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line for the OLE page.</div>;
  return (
    <div className="flex flex-col gap-4">
      <HeaderBar label="OLE dashboard filters">
        <div className={segGroup} role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')} className={segBtn(view === 'day', 'navy')}>Day</button>
          <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')} className={segBtn(view === 'month', 'navy')}>Month</button>
        </div>
        {view === 'day' ? (
          <>
            <div className={segGroup} role="group" aria-label="Day">
              <button type="button" aria-pressed={date === today} onClick={() => setDate(today)} className={segBtn(date === today)}>Today</button>
              <button type="button" aria-pressed={date === addDays(today, -1)} onClick={() => setDate(addDays(today, -1))} className={segBtn(date === addDays(today, -1))}>Yesterday</button>
            </div>
            <input type="date" aria-label="Choose day" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={fieldCls} />
          </>
        ) : (
          <input type="month" aria-label="Choose month" max={monthOf(today)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
        )}
      </HeaderBar>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!R && !D.err && <PageLoader label={`Reading ${group}`} sub="OLE of the period" />}

      {R && (
        <>
          {IDS.length > 1 && <GroupBand name={group} t={R.total} />}
          <div className={`grid gap-3 sm:grid-cols-2 ${IDS.length >= 4 ? 'xl:grid-cols-4' : IDS.length === 3 ? 'xl:grid-cols-3' : ''}`}>
            {IDS.map((l) => <LineCard key={l} name={`Line ${l}`} line={l} t={R.byLine[l]} ok={okOf(l)} active={sel === l} onOpen={() => setSel(l)} hint={view === 'day' ? 'Hours ›' : 'Open ›'}
              closedDay={view === 'day' && dayLines?.[l]?.closed ? dayLines[l] : null} />)}
          </div>

          {view === 'month' && <MonthTrend R={R} IDS={IDS} sel={sel} onDay={(d) => openDay(d, sel)} />}
          {view === 'month' && <RcaSummary issues={issues} rca={D.ent.rca} />}

          <DeptDrill issues={issues} rca={D.ent.rca} title={`Loss by department — ${group}, ${view === 'day' ? dmy(date) : monthText(month)}`} onDay={view === 'month' ? openDay : null} />
          {stations.length > 0 && <section className={card}><QualityByStation stations={stations} qty={R?.total?.qty || 0} name={`${group}, ${view === 'day' ? dmy(date) : monthText(month)}`} /></section>}

          {dayLines?.[sel] && <HourTable L={dayLines[sel]} date={date} onRetry={D.reload} busy={D.loading} />}
          {view === 'day' && !dayLines && <p className={`${card} text-fs-14 text-slate-500`}>No production on {dmy(date)}.</p>}

        </>
      )}
    </div>
  );
}

/** OLE of every day of the month for the chosen line and for all lines; click a day to open it. */
function MonthTrend({ R, IDS, sel, onDay }) {
  const [who, setWho] = useState('all');
  const vals = R.days.map((d) => ({ date: d.date, t: who === 'all' ? d.total : d.byLine[who]?.total }));
  const avg = who === 'all' ? R.total : R.byLine[who];
  return (
    <section className={card} aria-label="OLE day by day">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-fs-16 font-bold text-slate-900">OLE day by day <span className="text-fs-13 font-semibold text-slate-500">· month {pct(avg?.ole)}</span></h3>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-fs-13 font-bold" role="group" aria-label="Trend of">
          {[['all', groupNameOf(IDS)], ...IDS.map((l) => [l, `Line ${l}`])].map(([k, t]) => <button key={k} type="button" aria-pressed={who === k} onClick={() => setWho(k)} className={`h-8 px-2.5 border-r last:border-r-0 border-slate-300 ${who === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-700'}`}>{t}</button>)}
        </div>
      </div>
      {!vals.length ? <p className="mt-2 text-fs-14 text-slate-500">No production in this month yet.</p> : (
        <div className="mt-3 overflow-x-auto">
          <div className="flex items-end gap-1.5 h-44 min-w-max border-b border-slate-300 pt-5" role="img" aria-label="OLE per day">
            {vals.map(({ date, t }) => {
              const v = t?.ole ?? 0;
              return (
                <button key={date} type="button" onClick={() => onDay(date)} title={`${dmy(date)} · OLE ${pct(t?.ole)} · A ${pct(t?.A)} · P ${pct(t?.P)} · Q ${pct(t?.Q)}`} aria-label={`Open ${dmy(date)}`}
                  className="group flex w-9 flex-col items-center justify-end h-full">
                  <span className="text-fs-11 font-bold text-slate-700">{t?.ole == null ? '' : Math.round(v * 100)}</span>
                  <span className="w-7 rounded-t bg-sky-500 group-hover:bg-sky-700" style={{ height: `${Math.max(2, Math.min(1, v) * 100)}%`, background: who !== 'all' ? LINE_COLOR[who] : undefined }} />
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5 min-w-max">{vals.map(({ date }) => <span key={date} className="w-9 text-center text-fs-10 text-slate-500">{date.slice(8)}</span>)}</div>
        </div>
      )}
      
    </section>
  );
}

/** How far the departments are with their RCAs this month. */
function RcaSummary({ issues, rca }) {
  const g = useMemo(() => groupIssues(issues, rca, 'dept'), [issues, rca]);
  const tot = g.reduce((a, d) => ({ p: a.p + d.pending, s: a.s + d.submitted, c: a.c + d.closed }), { p: 0, s: 0, c: 0 });
  if (!g.length) return null;
  return (
    <section className={card} aria-label="RCA status">
      <h3 className="text-fs-16 font-bold text-slate-900">RCA status of the month <span className="text-fs-13 font-semibold text-slate-500">· {tot.p} pending · {tot.s} submitted · {tot.c} closed</span></h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {g.map((d) => {
          const n = Math.max(1, d.issues);
          return (
            <div key={d.key} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-baseline justify-between"><b className="text-slate-900">{d.name}</b><span className="text-fs-12 text-slate-500">{d.issues} losses</span></div>
              <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-slate-200" title={`${d.closed} closed · ${d.submitted} submitted · ${d.pending} pending`}>
                <i className="bg-slate-800" style={{ width: `${(d.closed / n) * 100}%` }} /><i className="bg-sky-400" style={{ width: `${(d.submitted / n) * 100}%` }} />
              </div>
              <div className="mt-1 text-fs-12 text-slate-600"><b>{d.pending}</b> pending · <b>{d.submitted}</b> submitted · <b>{d.closed}</b> closed</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

