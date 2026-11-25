import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { addDays } from '../utils/mainFilter';

/**
 * Period bar of the Dashboard, Overall OLE and Quality pages: Today · Yesterday · Week · Month (· Year), ‹ › to step
 * back / forward by the same kind of period, month + year pickers for a month, From – To for a range of your own.
 * Three looks: in the window's top bar (header), inside a card (compact) or as its own row.
 */
const box = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const MAX_DAYS = 92;   // at most 3 months on one screen

/* period maths (YYYY-MM-DD strings) */
const wd = (ds) => { const [y, m, d] = ds.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; };   // Monday = 0
const monthEnd = (ds) => { const [y, m] = ds.split('-').map(Number); return `${ds.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** What a range is: today · yesterday · day · week (Mon–Sun) · month (1st – end) · range. */
export function periodKind(range, today) {
  const { start: s, end: e } = range;
  if (s === e) return s === today ? 'today' : s === addDays(today, -1) ? 'yesterday' : 'day';
  if (wd(s) === 0 && (e === addDays(s, 6) || (e === today && e < addDays(s, 6)))) return 'week';
  if (s.endsWith('-01') && (e === monthEnd(s) || (e === today && e.slice(0, 7) === s.slice(0, 7)))) return 'month';
  return 'range';
}
const weekOf = (d, today) => { const s = addDays(d, -wd(d)); const e = addDays(s, 6); return [s, e > today ? today : e]; };
const monthOf = (d, today) => { const s = `${d.slice(0, 8)}01`; const e = monthEnd(s); return [s, e > today ? today : e]; };

/**
 * range / setRange: { start, end } ('YYYY-MM-DD'), never after today and at most MAX_DAYS long.
 * yearMode (optional): { on, set(bool), value, setValue } — a 5th "Year" button: the whole year month by month (Overall OLE).
 */
export function PeriodBar({ today, range, setRange, text, busy, compact = false, header = false, yearMode = null, trend = null }) {
  const y = addDays(today, -1);
  const kind = periodKind(range, today);
  const put = (start, end) => {
    let s = start > today ? today : start; let e = end > today ? today : end;
    if (s > e) [s, e] = [e, s];
    if (addDays(s, MAX_DAYS - 1) < e) s = addDays(e, -(MAX_DAYS - 1));      // at most 3 months on one screen
    setRange({ start: s, end: e });
  };
  const pick = (k) => {
    if (yearMode?.on) yearMode.set(false);
    if (k === 'today') put(today, today);
    else if (k === 'yesterday') put(y, y);
    else if (k === 'week') put(...weekOf(today, today));
    else if (k === 'month') put(...monthOf(today, today));
  };
  // ‹ › : the period before / after, of the same kind
  const step = (dir) => {
    const { start: s, end: e } = range;
    if (kind === 'today' || kind === 'yesterday' || kind === 'day') { const d = addDays(s, dir); put(d, d); return; }
    if (kind === 'week') { put(...weekOf(addDays(s, 7 * dir), today)); return; }
    if (kind === 'month') { const [yy, mm] = s.split('-').map(Number); const d = new Date(yy, mm - 1 + dir, 1); const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; put(...monthOf(ds, today)); return; }
    const n = Math.round((Date.parse(e) - Date.parse(s)) / 86400000) + 1;
    put(addDays(s, n * dir), addDays(e, n * dir));
  };
  const atEnd = range.end >= today;
  const setMonth = (yy, mm) => put(...monthOf(`${yy}-${String(mm).padStart(2, '0')}-01`, today));
  const [cy, cm] = range.start.split('-').map(Number);
  const years = []; for (let v = Number(today.slice(0, 4)); v >= Number(today.slice(0, 4)) - 3; v -= 1) years.push(v);
  const KINDS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Week'], ['month', 'This month', 'Month']];
  const h = compact ? 'h-7' : 'h-8';
  const btn = (on) => `${h} ${compact ? 'flex-1 px-2 text-fs-12 font-bold' : 'px-3 text-fs-13 font-semibold'} border-r last:border-r-0 border-slate-300 whitespace-nowrap ${on ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
  const arrow = `${h} w-8 grid place-items-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white`;
  const sel = `${h} rounded-md border border-slate-300 bg-white px-2 ${compact ? 'text-fs-12' : 'text-fs-13'} font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500`;
  const date = `${compact ? 'h-7 px-1 text-fs-12' : 'h-8 px-2 text-fs-13'} font-semibold text-slate-700 bg-white focus:outline-none`;
  const kindGroup = (
    <div className={`flex ${compact ? 'min-w-0 flex-1' : ''} overflow-hidden rounded-md border border-slate-300`} role="group" aria-label="Quick period">
      {KINDS.map(([k, l, short]) => <button key={k} type="button" aria-pressed={!yearMode?.on && kind === k} aria-label={short ? l : undefined} onClick={() => pick(k)} className={btn(!yearMode?.on && kind === k)}>{short || l}</button>)}
      {yearMode && <button type="button" aria-pressed={!!yearMode.on} aria-label="Year · month-wise" onClick={() => yearMode.set(true)} className={btn(!!yearMode.on)}>Year</button>}
    </div>
  );
  const arrows = (
    <div className="flex items-center gap-1" role="group" aria-label="Step period">
      <button type="button" onClick={() => step(-1)} className={arrow} aria-label="Earlier period" title="Earlier period"><ChevronLeft size={15} aria-hidden /></button>
      <button type="button" onClick={() => step(1)} disabled={atEnd} className={arrow} aria-label="Later period" title="Later period"><ChevronRight size={15} aria-hidden /></button>
    </div>
  );
  const monthPick = kind === 'month' && (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Month and year">
      {!compact && !header && <span className="text-fs-13 font-bold text-slate-700">Month:</span>}
      <select aria-label="Month" value={cm} onChange={(e) => setMonth(cy, Number(e.target.value))} className={sel}>
        {MONTHS.map((m, i) => <option key={m} value={i + 1} disabled={`${cy}-${String(i + 1).padStart(2, '0')}` > today.slice(0, 7)}>{compact || header ? m.slice(0, 3) : m}</option>)}
      </select>
      {!compact && !header && <span className="text-fs-13 font-bold text-slate-700">Year:</span>}
      <select aria-label="Year" value={cy} onChange={(e) => { const yy = Number(e.target.value); setMonth(yy, `${yy}-${String(cm).padStart(2, '0')}` > today.slice(0, 7) ? Number(today.slice(5, 7)) : cm); }} className={sel}>
        {years.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
  const rangeBox = (
    <div className={`flex items-center overflow-hidden rounded-md border ${kind === 'range' || kind === 'day' ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-300'} ${compact ? 'min-w-0' : ''}`} role="group" aria-label="Date range">
      <input type="date" aria-label="From" max={today} value={range.start} onChange={(e) => e.target.value && put(e.target.value, range.end)} className={`${date} ${compact ? 'min-w-0 flex-1' : ''}`} />
      <span className={`px-1 ${compact ? 'text-fs-12' : 'text-fs-13'} text-slate-500`}>{compact ? '–' : 'to'}</span>
      <input type="date" aria-label="To" max={today} value={range.end} onChange={(e) => e.target.value && put(range.start, e.target.value)} className={`${date} ${compact ? 'min-w-0 flex-1' : ''}`} />
    </div>
  );
  const yearPick = yearMode?.on && (
    <div className="flex items-center gap-1" role="group" aria-label="Year">
      <button type="button" onClick={() => yearMode.setValue(yearMode.value - 1)} className={arrow} aria-label="Earlier year" title="Earlier year"><ChevronLeft size={15} aria-hidden /></button>
      <select aria-label="Year" value={yearMode.value} onChange={(e) => yearMode.setValue(Number(e.target.value))} className={sel}>
        {years.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <button type="button" onClick={() => yearMode.setValue(yearMode.value + 1)} disabled={yearMode.value >= Number(today.slice(0, 4))} className={arrow} aria-label="Later year" title="Later year"><ChevronRight size={15} aria-hidden /></button>
    </div>
  );
  const [showDates, setShowDates] = useState(false);
  const datesBtn = (
    <button type="button" onClick={() => setShowDates((v) => !v)} aria-pressed={showDates} aria-label="Pick dates" title="Pick your own dates"
      className={`${arrow} ${showDates ? 'border-blue-600 bg-blue-50 text-blue-700' : ''}`}><CalendarDays size={15} aria-hidden /></button>
  );
  if (header) {
    // the filter strip of the Dixon MES (19-11-2026): Yesterday · Day · Week · Month · Range | ‹ Month: [..] Year: [..] › | Trend: Day · Week · Month
    const isDay = (kind === 'today' || kind === 'day') && !showDates;
    const lab = 'text-fs-13 font-bold text-[#1F3864] whitespace-nowrap';
    const seg = (on) => `${h} px-2.5 text-fs-13 font-semibold border-r last:border-r-0 border-[#BFBFBF] whitespace-nowrap ${on ? 'bg-[#1F4E79] text-white' : 'bg-white text-[#1F3864] hover:bg-[#EAF2FB]'}`;
    const sel2 = `${h} rounded-[3px] border border-[#BFBFBF] bg-white px-2 text-fs-13 font-semibold text-[#222] focus:outline-none focus:ring-2 focus:ring-[#BDD7EE]`;
    const arr2 = `${h} w-8 grid place-items-center rounded-[3px] border border-[#BFBFBF] bg-white text-[#1F3864] hover:bg-[#EAF2FB] disabled:opacity-40 disabled:hover:bg-white`;
    const go = (k) => { setShowDates(false); pick(k); };
    return (
      <div className="lp-pbar flex max-w-full shrink-0 flex-wrap items-center gap-2" aria-label="Period" role="group">
        <span className="sr-only">{text}</span>
        <div className="lp-seg flex overflow-hidden rounded-[3px] border border-[#BFBFBF]" role="group" aria-label="Quick period">
          <button type="button" aria-pressed={!yearMode?.on && kind === 'yesterday' && !showDates} onClick={() => go('yesterday')} className={seg(!yearMode?.on && kind === 'yesterday' && !showDates)}>Yesterday</button>
          <button type="button" aria-pressed={!yearMode?.on && isDay} aria-label="Today" title="One day (today; pick another date on the right)" onClick={() => go('today')} className={seg(!yearMode?.on && isDay)}>Day</button>
          <button type="button" aria-pressed={!yearMode?.on && kind === 'week' && !showDates} onClick={() => go('week')} className={seg(!yearMode?.on && kind === 'week' && !showDates)}>Week</button>
          <button type="button" aria-pressed={!yearMode?.on && kind === 'month' && !showDates} aria-label="This month" onClick={() => go('month')} className={seg(!yearMode?.on && kind === 'month' && !showDates)}>Month</button>
          <button type="button" aria-pressed={!yearMode?.on && (kind === 'range' || showDates)} aria-label="Pick dates" title="Your own dates (From – To)" onClick={() => { if (yearMode?.on) yearMode.set(false); setShowDates(true); }} className={seg(!yearMode?.on && (kind === 'range' || showDates))}>Range</button>
          {yearMode && <button type="button" aria-pressed={!!yearMode.on} aria-label="Year · month-wise" onClick={() => { setShowDates(false); yearMode.set(true); }} className={seg(!!yearMode.on)}>Year</button>}
        </div>
        {yearPick || (
          <div className="flex max-w-full flex-wrap items-center gap-1.5" role="group" aria-label="Step period">
            <button type="button" onClick={() => step(-1)} className={arr2} aria-label="Earlier period" title="Earlier period"><ChevronLeft size={15} aria-hidden /></button>
            {kind === 'month' && !showDates ? (
              <div className="flex items-center gap-1.5" role="group" aria-label="Month and year">
                <span className={`${lab} lp-pbar-lab`}>Month:</span>
                <select aria-label="Month" value={cm} onChange={(e) => setMonth(cy, Number(e.target.value))} className={sel2} style={{ minWidth: 108 }}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1} disabled={`${cy}-${String(i + 1).padStart(2, '0')}` > today.slice(0, 7)}>{m}</option>)}
                </select>
                <span className={`${lab} lp-pbar-lab`}>Year:</span>
                <select aria-label="Year" value={cy} onChange={(e) => { const yy = Number(e.target.value); setMonth(yy, `${yy}-${String(cm).padStart(2, '0')}` > today.slice(0, 7) ? Number(today.slice(5, 7)) : cm); }} className={sel2}>
                  {years.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            ) : isDay || kind === 'yesterday' ? (
              <label className="flex items-center gap-1.5"><span className={lab}>Date:</span>
                <input type="date" aria-label="Day" max={today} value={range.start} onChange={(e) => e.target.value && put(e.target.value, e.target.value)} className={sel2} />
              </label>
            ) : (
              <div className="flex items-center gap-1.5"><span className={lab}>{kind === 'week' && !showDates ? 'Week:' : 'From:'}</span>{rangeBox}</div>
            )}
            <button type="button" onClick={() => step(1)} disabled={atEnd} className={arr2} aria-label="Later period" title="Later period"><ChevronRight size={15} aria-hidden /></button>
          </div>
        )}
        {trend && (
          <div className="flex items-center gap-1.5" role="group" aria-label="Trend">
            <span className={lab}>Trend:</span>
            <div className="lp-seg flex overflow-hidden rounded-[3px] border border-[#BFBFBF]">
              {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([k, l]) => <button key={k} type="button" aria-pressed={trend.value === k} aria-label={`Trend by ${l.toLowerCase()}`} onClick={() => trend.set(k)} className={seg(trend.value === k)}>{l}</button>)}
            </div>
          </div>
        )}
        <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse bg-sky-500' : 'bg-transparent'}`} role="status" title={busy ? 'Updating…' : ''}>{busy ? <span className="sr-only">Updating…</span> : null}</span>
      </div>
    );
  }
  if (compact) {
    // inside the OLE band (big screen): quick buttons and arrows over the dates, no row of its own
    return (
      <div className="flex min-w-0 flex-col gap-1" aria-label="Period">
        <span className="sr-only">{text}</span>
        {/* row 1: the four kinds, equal width (never cut); row 2: ‹ dates / month › */}
        <div className="grid grid-cols-4 overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Quick period">
          {KINDS.map(([k, l, short]) => <button key={k} type="button" aria-pressed={kind === k} aria-label={short ? l : undefined} onClick={() => pick(k)} className={`h-7 min-w-0 border-r border-slate-300 px-1 text-fs-12 font-bold last:border-r-0 ${kind === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{short || l}</button>)}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={() => step(-1)} className={arrow} aria-label="Earlier period" title="Earlier period"><ChevronLeft size={15} aria-hidden /></button>
          <div className="min-w-0 flex-1">{monthPick || rangeBox}</div>
          <button type="button" onClick={() => step(1)} disabled={atEnd} className={arrow} aria-label="Later period" title="Later period"><ChevronRight size={15} aria-hidden /></button>
          <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse bg-sky-500' : 'bg-transparent'}`} role="status" title={busy ? 'Updating…' : ''}>{busy ? <span className="sr-only">Updating…</span> : null}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`${box} flex shrink-0 flex-wrap items-center gap-2 px-3 py-1.5`} aria-label="Period">
      {kindGroup}
      {yearPick || <>{arrows}{monthPick}{rangeBox}</>}
      <span className="ml-auto flex min-w-0 items-center gap-2">
        <CalendarDays size={15} className="shrink-0 text-slate-500" aria-hidden />
        <span className="min-w-0 truncate text-fs-14 font-bold text-slate-900">{text}</span>
        <span className={`text-fs-13 font-semibold text-blue-700 ${busy ? '' : 'invisible'}`} role="status">{busy ? 'Updating…' : ''}</span>
      </span>
    </div>
  );
}
