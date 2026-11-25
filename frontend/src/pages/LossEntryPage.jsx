import { PageLoader } from '../components/Loader';
import MesDrawer from '../components/MesDrawer';
import HeaderBar, { segGroup, segBtn, arrowBtn, fieldCls } from '../components/HeaderBar';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** 24-11-2026: a panel as tall as the rest of the screen below it (the page itself does not scroll; the panel does) */
function useFitHeight(on = true, bottom = 40) {
  const ref = useRef(null);
  const [h, setH] = useState(null);
  useLayoutEffect(() => {
    if (!on) return undefined;
    const fit = () => { const el = ref.current; if (!el) return; const top = el.getBoundingClientRect().top + window.scrollY; setH(Math.max(420, Math.round(window.innerHeight - top - bottom))); };
    fit(); const id = setTimeout(fit, 300);
    window.addEventListener('resize', fit);
    return () => { clearTimeout(id); window.removeEventListener('resize', fit); };
  }, [on, bottom]);
  return [ref, h];
}
import { takeEntryJump, clearEntryJump } from '../utils/entryJump';
import { noLossHour, lostWhole, hourTargets, targetMet } from '../utils/entryStatus';
import { createPortal } from 'react-dom';
import { Save, Plus, Trash2, X, ListChecks, ChevronLeft, ChevronRight, Copy, PencilLine, CheckCircle2, CalendarOff } from 'lucide-react';
import useMediaQuery from '../hooks/useMediaQuery';
import { api } from '../api';
import { DEPTS } from '../components/AuthGate';
const PLANT_DEPTS = DEPTS;   // the departments of the RCA logins (the HourDialog has its own DEPTS of the reason master)
import { useAllLineSettings } from '../hooks/useLineSettings';
import { addDays } from '../utils/mainFilter';
import { serverToday } from '../utils/serverTime';
import { oleDayLines, normEntry, pct, modelTimeOfHour, stationsFor, offLabels, hr1, okFrom, watchFrom, QCATS, splitHourTarget, isNoRun, scanHourTargets } from '../utils/ole';
import { isDismantleDefect } from '../utils/kpiStages';
import { gridFromRows, gridEntries, gridProblems } from '../utils/reworkGrid';
import { rcaSuggest } from '../utils/rcaBook';
import useUiSettings from '../hooks/useUiSettings';
import { normalizeEntry } from '../utils/uiSettings';
import { stationDefects, defectHint } from '../utils/defectBook';
import { recentScope, recentOf, bumpRecent, withRecent } from '../utils/recentReasons';
import StationSetup from '../components/StationSetup';
import { LINE_COLOR, nf, dmy, p2, inp, chip, card, KINDS, shortSt, deptOf, useOleLines, useOleData, HourTable, ClosedNote, normReasons } from '../components/OleParts';

/** minutes for the screen: whole minutes as "60 min", a part minute as "2m 40s" (an extra hour's time is its std time, e.g. 2.6667 min) */
const fmtMin = (v) => { const sec = Math.max(0, Math.round((Number(v) || 0) * 60)); if (sec % 60 === 0) return `${sec / 60} min`; const m = Math.floor(sec / 60), x = sec % 60; return m ? `${m}m ${x}s` : `${x}s`; };
/** the same for the small tiles (′ for whole minutes) */
const fmtTick = (v) => { const t = fmtMin(v); return t.endsWith(' min') ? `${t.slice(0, -4)}′` : t; };

/**
 * Two pages in this file, one hour list:
 *   Loss entry    (mode 'loss')    — the lost minutes of each hour: model, reason → department, minutes. The minutes come
 *                                    filled from the scans (time lost against the std); the line picks the reasons.
 *   Quality entry (mode 'quality') — rejection and rework of each hour: station, model, defect, pieces.
 * Each hour shows its target pieces (hourTargets). "Save & next" walks through the day; "Copy" repeats a running
 * breakdown. The day's OLE table stays below. Who: the admin, and logins allowed to fill (Users & logins), own lines only.
 */
/**
 * the target pieces of an hour = its working seconds ÷ the std cycle of what it made (weighted by
 * pieces); an hour without pieces takes the day's std cycle. → { hour: target } and the day's target.
 */
export { hourTargets };   // 23-11-2026: utils/entryStatus.js (shared with the Entry dashboard)

/** Quality entry: the same hour list, only rejection and rework. */
export function QualityEntryPage(p) { return <LossEntryPage {...p} mode="quality" />; }
/** 19-11-2026: one page for both — the lost minutes and the rejection / rework of every hour in one form */
export function LossQualityEntryPage(p) { return <LossEntryPage {...p} mode="both" />; }

/**
 * 21-11-2026: the line's actual last scan of the day ('YYYY-MM-DD HH:MM:SS'), as Morning entry shows it ("Actual close"):
 * today from the live line, a finished day from the scans of its last hour with pieces. null = no scan / not read yet.
 */
function useLastScan(line, date, today, tick = 0) {
  const [ls, setLs] = useState({ key: '', at: null });
  const key = `${line}|${date}`;
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let at = null;
        if (date === today) {
          const r = await api.liveLinesOne(line, { cmin: 1, cmax: 22 });
          const t = String(r?.lines?.[0]?.lastScan || '');
          at = t.slice(0, 10) === today ? t.slice(0, 19) : null;
        } else {
          const h = await api.hourlyOfDay(line, date);
          const hrs = (h?.lines?.[0]?.hourly || []).filter((x) => Number(x.q) > 0).map((x) => Number(x.h)).sort((a, b) => a - b);
          if (hrs.length) {
            const d = await api.hourDetail(date, hrs[hrs.length - 1], { line });
            const sc = Array.isArray(d?.scans) ? d.scans : [];
            const x = sc.map((y) => String(y?.scanDate || '').replace('T', ' ').slice(0, 19)).filter(Boolean).sort().pop();
            at = x || null;
          }
        }
        if (alive) setLs({ key, at });
      } catch { if (alive) setLs({ key, at: null }); }
    })();
    return () => { alive = false; };
  }, [key, today, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return ls.key === key ? ls.at : null;
}
/**
 * 23-11-2026: the scans of every hour of the day with pieces, read once — an hour is read again only when its pieces
 * change (the running hour), never all hours on every refresh. One copy for the targets, the hour form and the day table.
 * → { byHour: { hour: scans[] }, failed: { hour: true }, busy, ver, reload }
 */
function useDayScans(L, line, date, on = true) {
  const cache = useRef(new Map());   // `line|date|hour` → { qty, scans, fail }
  const [ver, setVer] = useState(0);
  const k = (h) => `${line}|${date}|${h}`;
  const hours = on && L?.ok ? L.rows.filter((r) => r.qty > 0 && !r.future && !r.extra) : [];
  const need = hours.filter((r) => { const c = cache.current.get(k(r.hour)); return !c || c.qty !== r.qty; });
  const needKey = need.map((r) => `${r.hour}:${r.qty}`).join(',');
  useEffect(() => {
    if (!need.length) return undefined;
    let gone = false; const c = new AbortController(); const todo = [...need];
    const worker = async () => {
      while (todo.length && !gone) {
        const r = todo.shift();
        try {
          const d = await api.hourDetail(date, r.hour, { line }, { signal: c.signal });
          if (!gone) cache.current.set(k(r.hour), { qty: r.qty, scans: Array.isArray(d?.scans) ? d.scans : [] });
        } catch (x) { if (!gone && x?.name !== 'AbortError') cache.current.set(k(r.hour), { qty: r.qty, scans: [], fail: true }); }
      }
    };
    Promise.all([worker(), worker(), worker()]).then(() => { if (!gone) setVer((v) => v + 1); });
    return () => { gone = true; c.abort(); };
  }, [line, date, needKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byHour = {}, failed = {};
  for (const r of hours) { const c = cache.current.get(k(r.hour)); if (c) { byHour[r.hour] = c.scans; if (c.fail) failed[r.hour] = true; } }
  return { byHour, failed, busy: need.length > 0, ver: `${line}|${date}|${ver}|${hours.length}`, reload: () => { cache.current.clear(); setVer((v) => v + 1); } };
}
/** 23-11-2026: lost minutes of an hour = Σ of each model's whole minutes (what the form fills, row by row), so the hour,
 * the day and the model table add up to the same number */
export { lostWhole };   // utils/entryStatus.js
const minOf = (at) => (at ? Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16)) + Number(at.slice(17, 19)) / 60 : null);

export default function LossEntryPage({ canEdit = false, isAdmin = false, mode = 'loss' }) {
  const QM = mode === 'quality';
  const IDS = useOleLines();
  const today = serverToday();
  // 23-11-2026: opened from the Entry dashboard at one line, day and hour
  const jump = useRef(undefined);
  if (jump.current === undefined) jump.current = takeEntryJump();
  const J = jump.current && IDS.includes(String(jump.current.line)) ? jump.current : null;
  const [line, setLine] = useState(J ? String(J.line) : IDS[0]);
  useEffect(() => { clearEntryJump(); }, []);
  const [date, setDate] = useState(J?.date && J.date <= today ? J.date : today);
  const [fill, setFill] = useState(null);
  const [dayDlg, setDayDlg] = useState(false);
  const { ui: UIS } = useUiSettings();
  const EM = normalizeEntry(UIS?.entry);   // 25-11-2026: the entry methods the admin switched on (Setup → Access & entry)
  const [rgrid, setRgrid] = useState(false);   // 25-11-2026: Quality entry → rework of all hours in one grid
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(''), 6000); return () => clearTimeout(t); }, [msg]);
  const settings = useAllLineSettings(IDS);
  // 23-11-2026: an hour form with changes not saved yet — the screen is not read again under it (no jumping numbers,
  // nothing typed is lost); it goes on by itself after Save / Undo
  const [dirty, setDirty] = useState(false);
  const D = useOleData({ start: date, end: date, ids: [line], paused: !!fill || dirty });
  // 21-11-2026: time is counted only up to the line's actual last scan — today: the last scan (never after now), a finished
  // day: its last hour ends at its last scan, and the hours after it are not run time ("No run"), as on the OLE pages
  const endM = date === today ? (D.endMin?.[line] ?? D.nowMin) : null;
  const L = useMemo(() => (D.al ? oleDayLines({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, date, nowMin: date === today ? { [line]: endM, now: D.nowMin } : null, ids: [line] })[line] : null),
    [D.al, settings, D.ent.entries, date, today, D.nowMin, endM, line]);
  const lastAt = useLastScan(line, date, today, date === today ? Math.floor((D.nowMin || 0) / 5) : 0);   // actual last scan (re-read every 5 min today)
  const lastProd = L?.ok ? L.rows.filter((r) => !r.extra && r.qty > 0).map((r) => r.hour).pop() ?? null : null;
  // a last scan before the day's last hour with pieces does not fit the production numbers (not read right): not used
  const lastMin = lastAt && (lastProd == null || minOf(lastAt) >= lastProd * 60) ? minOf(lastAt) : null;
  const lastH = lastMin != null ? Math.floor(lastMin / 60) : lastProd;
  const lastShow = lastMin != null ? lastAt : null;   // the hour of the day's last scan
  // an hour is "No run" only when it begins after the actual last scan (an hour with a scan in it is never No run)
  const noRun = (r) => isNoRun(r, date === today ? D.nowMin : null) && (lastMin == null || r.hour * 60 >= lastMin);
  // each page looks at its own part of the hour: Loss entry the time, Quality entry the rejection and rework
  const hasEntry = (r) => (mode === 'both' ? r.e.rejects.length + r.e.rework.length + r.e.stops.length + r.e.losses.length : QM ? r.e.rejects.length + r.e.rework.length : r.e.stops.length + r.e.losses.length) > 0 || (!QM && !!r.e.noLoss) || (mode !== 'loss' && !!r.e.noQ);   // 20-11-2026: "No loss" saved = checked · 23-11-2026: "No defects" too
  // 23-11-2026: one target per hour everywhere (tiles, form, model table, hour table): from the scans — the minutes each
  // model ran ÷ its std cycle; an hour whose scans are not read yet keeps the pieces-weighted estimate
  const DS = useDayScans(L, line, date, !!L?.ok);
  const dsOf = (r) => (r.qty > 0 && !r.extra && !r.future ? (DS.byHour[r.hour] ?? null) : []);   // null: still being read
  const TG = useMemo(() => {
    if (!L) return { by: {}, day: null };
    const base = hourTargets(L.rows);
    const ex = scanHourTargets(L.rows, DS.byHour, base.by, { nowMin: endM, lastScanHour: lastH, shift: L.shift, dayCyc: base.dayCyc });
    return { ...base, by: ex.by, day: ex.day };
  }, [L, DS.ver, endM, lastH]); // eslint-disable-line react-hooks/exhaustive-deps
  // 23-11-2026: the minutes each hour lost against std from its scans, model by model (the same number the hour form fills):
  // an hour is "Confirm no loss" only when no model of it lost time — not when a fast model hid a slow one
  const LOST = useMemo(() => {
    const o = {};
    for (const r of L?.ok ? L.rows : []) {
      const sc = DS.byHour[r.hour]; if (!Array.isArray(sc) || !sc.length || r.extra || r.future) continue;
      const mt = modelTimeOfHour({ hour: r.hour, scans: sc, models: r.models, stops: r.e.stops, totalMin: r.totalMin, nowMin: endM, shift: L.shift, endAtLastScan: r.hour === lastH });
      if (!mt.estimated) o[r.hour] = lostWhole(mt);
    }
    return o;
  }, [L, DS.ver, endM, lastH]); // eslint-disable-line react-hooks/exhaustive-deps
  // 23-11-2026: an hour that is over and lost no time (no model below its std, nothing entered) is "No loss" by itself —
  // nothing to save; only an hour that lost time asks for a reason
  // 23-11-2026: an hour that made its target (pieces ≥ the target shown) is "No loss" too, whatever a single model did
  const autoNL = (r) => !QM && !!r && !(r.e.stops.length + r.e.losses.length) && !r.e.noLoss
    && (targetMet(r, TG.by[r.hour]) || (noLossHour(r) && LOST[r.hour] != null && LOST[r.hour] <= 0))   // scans read model by model
    && (date !== today || (r.hour + 1) * 60 <= (D.nowMin ?? 0));
  const nextEmpty = L ? L.rows.find((r) => !r.future && !noRun(r) && !hasEntry(r) && !(mode === 'loss' && autoNL(r)) && (QM || !r.extra)) || null : null;   // an extra hour has no loss to enter
  const after = (r) => (L ? L.rows.find((x) => x.hour > r.hour && !x.future && !noRun(x) && !(mode === 'loss' && autoNL(x) && !hasEntry(x)) && (QM || !x.extra || hasEntry(x))) || null : null);   // 20-11-2026: every hour is checked (a 0-minute hour is saved as "No loss")
  const btn = (on) => `h-10 px-3.5 text-fs-14 font-semibold border-r last:border-r-0 border-slate-300 ${on ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
  // big screen (the Dixon MES entry way): lines on the left, the hour's form in the middle, the hours on the right
  // 23-11-2026: the form + hours list on every screen (zoomed-in / smaller screens got the hour tiles in the middle).
  // >= 1024 px: hours on the right side; smaller (phone, big zoom): the hours as a strip above the form
  const sideHours = useMediaQuery('(min-width: 1024px)');
  const wideScreen = useMediaQuery('(min-width: 1500px)');
  const three = canEdit;
  const [sel, setSel] = useState(J?.hour != null ? Number(J.hour) : null);
  const [rev, setRev] = useState(0);
  const firstLD = useRef(true);   // 23-11-2026: not on the first show — an hour asked by the Entry dashboard stays
  useEffect(() => { if (firstLD.current) { firstLD.current = false; return; } setSel(null); setDirty(false); }, [line, date]);
  const selRow = L && L.ok ? (L.rows.find((x) => x.hour === sel && !x.future) || nextEmpty || L.rows.filter((x) => !x.future && !noRun(x)).slice(-1)[0] || L.rows.filter((x) => !x.future).slice(-1)[0] || null) : null;
  // the hour on screen stays on screen: a refresh (or a saved hour) never swaps the form for another hour by itself
  useEffect(() => { if (three && sel == null && selRow) setSel(selRow.hour); }, [three, sel, selRow?.hour]); // eslint-disable-line react-hooks/exhaustive-deps
  // closing the tab / reloading with changes not saved asks first
  useEffect(() => {
    if (!dirty) return undefined;
    const k = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k);
  }, [dirty]);
  const leaveOk = () => !dirty || window.confirm('This hour has changes that are not saved. Leave without saving?');
  const go = (fn) => (...a) => { if (leaveOk()) { setDirty(false); fn(...a); } };
  if (!IDS.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  return (
    <div className="flex flex-col gap-3">
      <HeaderBar label={QM ? 'Quality entry filters' : mode === 'both' ? 'Loss & quality entry filters' : 'Loss entry filters'}>
        <div className={segGroup} role="group" aria-label="Line">
          {IDS.map((l) => <button key={l} type="button" aria-pressed={line === l} onClick={go(() => setLine(l))} className={segBtn(line === l, 'navy')}>Line {l}</button>)}
        </div>
        <div className={segGroup} role="group" aria-label="Day">
          <button type="button" aria-pressed={date === today} onClick={go(() => setDate(today))} className={segBtn(date === today)}>Today</button>
          <button type="button" aria-pressed={date === addDays(today, -1)} onClick={go(() => setDate(addDays(today, -1)))} className={segBtn(date === addDays(today, -1))}>Yesterday</button>
        </div>
        <button type="button" aria-label="Day before" title="Day before" onClick={go(() => setDate(addDays(date, -1)))} className={arrowBtn}><ChevronLeft size={15} aria-hidden /></button>
        <input type="date" aria-label="Choose day" max={today} value={date} onChange={(e) => e.target.value && go(() => setDate(e.target.value))()} className={fieldCls} />
        <button type="button" aria-label="Day after" title="Day after" disabled={date >= today} onClick={go(() => setDate(addDays(date, 1)))} className={arrowBtn}><ChevronRight size={15} aria-hidden /></button>
        {/* 23-11-2026: the two actions of the day in the top bar (no row of their own) */}
        {L && canEdit && nextEmpty && EM.nextEmpty && <button type="button" title="Fill the next hour that still needs an entry" onClick={go(() => (three ? setSel(nextEmpty.hour) : setFill(nextEmpty)))} className="inline-flex h-8 items-center gap-1 rounded-lg bg-blue-700 px-3 text-fs-13 font-bold text-white hover:bg-blue-800"><PencilLine size={14} aria-hidden /> Next empty ({p2(nextEmpty.hour)}:00)</button>}
        {L && canEdit && L.ok && mode !== 'loss' && EM.manyHours && <button type="button" data-testid="rg-open" title="Rework / rejection of many hours at once, model-wise (as the rework report)" onClick={go(() => setRgrid({ model: '', kind: 'rework' }))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#1F3864] bg-white px-3 text-fs-13 font-bold text-[#1F3864] hover:bg-[#EEF3FB]"><ListChecks size={14} aria-hidden /> Many hours · model-wise</button>}
        {L && canEdit && L.ok && !QM && EM.lineOff && <button type="button" title="Line off all day (holiday, no plan, …)" aria-label={L.dayOff ? 'Line off all day: change' : 'Line off all day'} onClick={() => setDayDlg(true)} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-fs-13 font-bold ${L.dayOff ? 'border-slate-500 bg-slate-700 text-white' : 'border-slate-400 bg-white text-slate-800 hover:bg-slate-50'}`}><CalendarOff size={14} aria-hidden /> {L.dayOff ? 'Line off: change' : 'Line off'}</button>}
      </HeaderBar>
      <section className={card} style={{ padding: '8px 12px' }} aria-label={QM ? 'Quality entry' : mode === 'both' ? 'Loss & quality entry' : 'Loss entry'}>
        {L && (
          <div className="lp-le-day flex flex-wrap gap-2 text-fs-13" aria-label="Day so far">
            {/* 24-11-2026: line and date are in the filter strip above — not repeated here */}
            {!QM && <span className="rounded-md bg-slate-100 px-2 py-0.5">Target <b className="font-mono">{TG.day ? nf(TG.day) : '—'} pcs</b></span>}
            <span className="rounded-md bg-slate-100 px-2 py-0.5">Made <b className="font-mono">{nf(L.total.qty)} pcs</b></span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5" aria-label="Last scan">Last scan <b className="font-mono">{lastShow ? lastShow.slice(11, 16) : '—'}</b></span>
            {!QM && L.mp != null && <span className="rounded-md bg-slate-100 px-2 py-0.5" title="Manpower on the line (morning entry)">MP <b className="font-mono">{nf(L.mp)}{L.stdMp ? ` / ${nf(L.stdMp)}` : ''}</b></span>}
            {/* 23-11-2026: the time lost against std (from the scans, model by model) and the loss already written — two numbers, never mixed */}
            {!QM && (() => { const lost = Object.values(LOST).reduce((x, v) => x + v, 0); const done = Math.round((L.total.lossMin || 0) + (L.total.perfLossMin || 0)); return (<>
              <span className="rounded-md bg-slate-100 px-2 py-0.5" title="Minutes the models ran slower than their std, hour by hour, model by model (from the scans)">Lost vs std <b className="font-mono text-red-700">{lost} min</b></span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5" title="Loss minutes written in the hours">Entered <b className="font-mono">{done} min</b></span>
              {(() => { // 23-11-2026: an hour with No loss by itself (target achieved / no model lost time) has nothing to explain
                const left = L.rows.reduce((a, r) => { if (!(LOST[r.hour] > 0) || autoNL(r) || r.e.noLoss) return a; const w = r.e.stops.reduce((x, y) => x + (Number(y.min) || 0), 0) + r.e.losses.reduce((x, y) => x + (Number(y.min) || 0), 0); return a + Math.max(0, LOST[r.hour] - w); }, 0);
                return left > 0 ? <span className="lp-le-warn rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-900" title="Minutes lost against std in the hours that still need a reason (an hour that made its target or lost no time is left out)">To explain <b className="font-mono">{left} min</b></span> : null; })()}
            </>); })()}
            {!QM && <span className="rounded-md bg-slate-100 px-2 py-0.5" title="Whole day so far: Availability = run time ÷ working time">Availability <b className="font-mono">{pct(L.total.A)}</b></span>}
            {!QM && <span className="rounded-md bg-slate-100 px-2 py-0.5" title="Whole day so far: OLE = std time of the pieces ÷ working time (an hour above std makes up for a slower one here; the hours list shows each hour)">OLE <b className="font-mono">{pct(L.total.ole)}</b></span>}
            {QM && L.total.rejects > 0 && <span className="rounded-md bg-slate-100 px-2 py-0.5">Rejection <b className="font-mono">{nf(L.total.rejects)} pcs</b></span>}
            {QM && <span className="rounded-md bg-slate-100 px-2 py-0.5">Rework <b className="font-mono">{nf(L.total.rework)} pcs</b></span>}
            {QM && <span className="rounded-md bg-slate-100 px-2 py-0.5">Dismantled <b className="font-mono">{nf(L.rows.reduce((a, r) => a + r.e.rework.reduce((x, y) => x + (Number(y.dismantle) || 0), 0), 0))} pcs</b></span>}
            {QM && <span className="rounded-md bg-slate-100 px-2 py-0.5">Quality <b className="font-mono">{pct(L.total.Q)}</b></span>}
            {date === today && (dirty
              ? <span className="rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-900" title="The numbers are not read again while an hour has changes that are not saved">Not saved — live update paused</span>
              : <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800" title="Live — pieces and time are read again every 20 s, without reloading the page" aria-label="Live">● {D.updatedAt ? `${String(D.updatedAt.getHours()).padStart(2, '0')}:${String(D.updatedAt.getMinutes()).padStart(2, '0')}` : 'Live'}</span>)}
          </div>
        )}
        {L && <ClosedNote L={L} today={date === today} className="mt-3" />}
        {msg && <p role="status" className="mt-2 text-fs-13 font-bold text-sky-800">{msg}</p>}
      </section>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!L && !D.err && <PageLoader label={`Reading Line ${line}`} sub="Hours, pieces and entries of the day" />}
      {L && L.ok && three && selRow && (
        <div className="grid items-start gap-3" style={{ gridTemplateColumns: sideHours ? `minmax(0,1fr) ${wideScreen ? 250 : 220}px` : 'minmax(0,1fr)' }}>
          {!sideHours && <HourSlots strip auto={autoNL} L={L} sel={selRow.hour} onPick={(h) => { if (h !== selRow.hour) go(() => setSel(h))(); }} TG={TG} has={hasEntry} QM={QM} noRun={noRun} lastAt={lastShow} />}
          {/* left: the form of the chosen hour (the line is chosen with the Line buttons above) */}
          <HourDialog em={EM} dayCyc={TG.dayCyc} inline autoNo={autoNL(selRow)} mode={mode} target={TG.by[selRow.hour]} key={`${line}|${date}|${selRow.hour}|${rev}`} L={L} r={selRow} date={date} reasons={D.ent.reasons} nowMin={endM} lastScanHour={lastH}
            scans={dsOf(selRow)} scanFail={!!DS.failed[selRow.hour]} onDirty={setDirty} onManyHours={mode !== 'loss' && canEdit && EM.manyHours ? (m, k) => { if (leaveOk()) { setDirty(false); setRgrid({ model: m, kind: k }); } } : null}
            prev={L.rows.filter((x) => x.hour < selRow.hour && hasEntry(x)).pop() || null} next={after(selRow)}
            onClose={() => { setDirty(false); setRev((v) => v + 1); }}
            // 23-11-2026: a saved hour stays as it is on screen (no reload of the form); "Save & next" opens the next hour
            onSaved={async (goNext) => { const h = selRow.hour; const nx = goNext ? after(selRow) : null; setDirty(false); setMsg(`Line ${line} ${p2(h)}:00 saved.`); await D.reloadEnt(); if (nx) setSel(nx.hour); }} />
          {/* right: the hours of the day with their state */}
          {sideHours && <HourSlots auto={autoNL} L={L} sel={selRow.hour} onPick={(h) => { if (h !== selRow.hour) go(() => setSel(h))(); }} TG={TG} has={hasEntry} QM={QM} noRun={noRun} lastAt={lastShow} />}
        </div>
      )}
      {L && L.ok && !(three && selRow) && <HourTiles auto={autoNL} L={L} canEdit={canEdit} onFill={setFill} QM={QM} TG={TG} noRun={noRun} lastAt={lastShow} LOST={LOST} />}
      {L && L.ok && !L.closed && !QM && <DayLostByModel L={L} line={line} date={date} nowMin={endM} lastScanHour={lastH} DS={DS} />}
      {L && <HourTable L={L} date={date} TG={QM ? null : TG} onRetry={D.reload} busy={D.loading} />}
      {isAdmin && !QM && <ReasonsEditor reasons={D.ent.reasons} onSaved={(r) => D.setEnt((x) => ({ ...x, reasons: normReasons(r) }))} />}
      {isAdmin && QM && <StationSetup reasons={D.ent.reasons} onSaved={(r) => D.setEnt((x) => ({ ...x, reasons: normReasons(r) }))} />}
      {rgrid && L && <ReworkGrid key={rgrid.kind || 'rework'} kind={rgrid.kind || 'rework'} onKind={(k, m) => setRgrid({ kind: k, model: m })} model0={rgrid.model || ''} L={L} line={line} date={date} reasons={D.ent.reasons} onClose={() => setRgrid(false)}
        onSaved={async (hs) => { setRgrid(false); setMsg(`Line ${line}: ${rgrid.kind === 'rejects' ? 'rejection' : 'rework'} of ${hs.length} hour${hs.length > 1 ? 's' : ''} saved (${hs.map((h) => `${p2(h)}:00`).join(', ')}).`); await D.reloadEnt(); }} />}
      {dayDlg && L && <DayOffDialog L={L} line={line} date={date} reasons={D.ent.dayReasons} onClose={() => setDayDlg(false)}
        onSaved={async (txt) => { setDayDlg(false); setMsg(txt); await D.reloadEnt(); }} />}
      {fill && L && (
        <HourDialog em={EM} dayCyc={TG.dayCyc} autoNo={autoNL(L.rows.find((x) => x.hour === fill.hour))} mode={mode} target={TG.by[fill.hour]} key={fill.hour} L={L} r={L.rows.find((x) => x.hour === fill.hour) || fill} date={date} reasons={D.ent.reasons} nowMin={endM} lastScanHour={lastH}
          scans={dsOf(fill)} scanFail={!!DS.failed[fill.hour]} onDirty={setDirty} onManyHours={mode !== 'loss' && canEdit && EM.manyHours ? (m, k) => { if (leaveOk()) { setDirty(false); setFill(null); setRgrid({ model: m, kind: k }); } } : null}
          prev={L.rows.filter((x) => x.hour < fill.hour && hasEntry(x)).pop() || null} next={after(fill)}
          onClose={() => { if (leaveOk()) { setDirty(false); setFill(null); } }}
          onSaved={async (goNext) => { const h = fill.hour; const nx = goNext ? after(fill) : null; setDirty(false); setMsg(`Line ${line} ${p2(h)}:00 saved.`); await D.reloadEnt(); setFill(nx); }} />
      )}
    </div>
  );
}

/** An hour that lost no time (0 minutes against the std time of its pieces, no loss written): no loss entry is needed (18-11-2026). */

/**
 * 25-11-2026: Quality entry → "Rework: all hours" — the rework of the whole day in one grid: one row per model · station ·
 * defect, one box per hour (pieces), totals under each hour and at the end of each row. Enter goes down the hour, a block
 * copied from Excel can be pasted into the boxes. Only the rework of the changed hours is saved; each hour's rejection,
 * note and loss part stay as they are (utils/reworkGrid.js).
 */
function ReworkGrid({ L, line, date, reasons, onClose, onSaved, model0 = '', kind = 'rework', onKind = null }) {
  const KL = kind === 'rejects' ? 'Rejection' : 'Rework';   // 25-11-2026: the same grid for the rejection
  const hrs = L.rows.filter((r) => (!r.future && !r.closed) || r.e[kind].length).map((r) => r.hour);   // an hour with rows saved is always shown
  const made = Object.fromEntries(L.rows.map((r) => [r.hour, r.qty || 0]));
  const models = [...new Set(L.rows.flatMap((r) => (r.models || []).map((m) => m.model)).filter(Boolean))];
  const one = models.length === 1 ? models[0] : '';
  // 25-11-2026: pieces of each model in each hour — a row of a model has its boxes open only in the hours the model ran
  const mq = useMemo(() => { const o = {}; for (const r of L.rows) for (const m of r.models || []) if (m.model) { o[m.model] = o[m.model] || {}; o[m.model][r.hour] = (o[m.model][r.hour] || 0) + (Number(m.quantity ?? m.qty) || 0); } return o; }, [L]); // eslint-disable-line react-hooks/exhaustive-deps
  const ran = (model, h) => !model || !mq[model] || (mq[model][h] || 0) > 0;
  const stations = stationsFor(reasons.station || [], L.line);
  const stOf = (name) => stations.find((x) => x.reason === name);
  const defectsAt = (stName) => {
    const st = stOf(stName); const all = reasons[kind === 'rejects' ? 'reject' : 'rework'] || [];
    const own = st?.defects?.length ? st.defects : (stName ? stationDefects(stName, st?.code) : null);
    if (!own?.length) return all;
    if (st?.defects?.length) return all.filter((x) => own.includes(x.reason)).concat(own.filter((d) => !all.some((x) => x.reason === d)).map((d) => ({ reason: d, dept: st.dept })));
    return own.map((d) => all.find((x) => x.reason.toLowerCase() === d.toLowerCase()) || { reason: d, dept: st?.dept || 'Prod' });
  };
  const deptOfRow = (g) => (defectsAt(g.station).find((x) => x.reason === String(g.reason || '').trim()) || {}).dept || '';
  const start = useMemo(() => gridFromRows(L.rows, kind), []); // eslint-disable-line react-hooks/exhaustive-deps
  const seq = useRef(start.length);
  // 25-11-2026: one model at a time (chips above the grid): only its rows and only the hours it ran — many hours at once
  const [fm, setFm] = useState(model0 && models.includes(model0) ? model0 : '');
  const blankRow = (station = '', model = null) => ({ id: `n${++seq.current}`, model: model ?? (fm || one), station, reason: '', cat: '', dept: '', cause: '', action: '', owner: '', part: '', q: {}, dis: {}, disAll: false, disN: '' });
  const [grid, setGrid] = useState(() => {
    const g = start.length ? start : [];
    if (fm && !g.some((x) => x.model === fm && !x.reason)) return [...g, blankRow(g.filter((x) => x.model === fm).pop()?.station || stations[0]?.reason || '', fm)];   // a new row of the model, ready to fill
    return g.length ? g : [blankRow(stations[0]?.reason || '')];
  });
  // the rows shown (index in the grid kept) and the hour columns: one model → the hours it ran (and hours already filled)
  const vis = grid.map((g, i) => [g, i]).filter(([g]) => !fm || g.model === fm);
  const cols = fm ? hrs.filter((h) => (mq[fm]?.[h] || 0) > 0 || vis.some(([g]) => Number(g.q[h]) > 0)) : hrs;
  const pickModel = (m) => {
    setFm(m);
    if (m && !grid.some((x) => x.model === m)) setGrid((g) => [...g, blankRow(g[g.length - 1]?.station || stations[0]?.reason || '', m)]);
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tried, setTried] = useState(false);
  const entries = useMemo(() => gridEntries({ grid, rows: L.rows, hours: hrs, date, line, deptOf: deptOfRow, key: kind }), [grid]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = gridProblems(grid, made, mq);
  const set = (i, patch) => setGrid((g) => g.map((x, j) => (j === i ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));
  const setQ = (i, h, v) => set(i, (x) => ({ q: { ...x.q, [h]: String(v).replace(/[^0-9]/g, '').slice(0, 4) } }));
  const pickDefect = (i, v) => set(i, (x) => {
    const o = { reason: v };
    const hint = defectHint(v);
    if (!x.cat && hint.cat && QCATS.includes(hint.cat)) o.cat = hint.cat;
    if (isDismantleDefect(v) && !x.disSet) o.disAll = true;
    return o;
  });
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  const rowSum = (g) => hrs.reduce((a, h) => a + n(g.q[h]), 0);
  const colSum = (h) => vis.reduce((a, [g]) => a + n(g.q[h]), 0);
  const total = vis.reduce((a, [g]) => a + rowSum(g), 0);
  const tableRef = useRef(null);
  const cell = (i, k) => tableRef.current?.querySelector(`[data-rg="${i}:${k}"]`);
  const onKey = (e, i, k) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (i + 1 >= vis.length && e.key === 'Enter') { setGrid((g) => [...g, blankRow(g[g.length - 1]?.station || '')]); setTimeout(() => cell(i + 1, k)?.focus(), 0); } else cell(i + 1, k)?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cell(i - 1, k)?.focus(); }
    else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) { const c = cell(i, k + 1); if (c) { e.preventDefault(); c.focus(); } }
    else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) { const c = cell(i, k - 1); if (c) { e.preventDefault(); c.focus(); } }
  };
  // a block copied from Excel (tabs / new lines) fills the boxes from the one pasted into, to the right and down
  const onPaste = (e, i, k) => {
    const t = e.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(t.trim())) return;
    e.preventDefault();
    const lines = t.replace(/\r/g, '').split('\n').filter((x, j, a) => x !== '' || j < a.length - 1);
    setGrid((g0) => {
      const g = g0.map((x) => ({ ...x, q: { ...x.q } }));
      const at = g.map((x, j) => j).filter((j) => !fm || g[j].model === fm);   // the rows shown, in order
      lines.forEach((ln, di) => {
        while (at.length <= i + di) { g.push(blankRow(g[g.length - 1]?.station || '')); at.push(g.length - 1); }
        ln.split('\t').forEach((v, dk) => { const h = cols[k + dk]; if (h != null) g[at[i + di]].q[h] = String(v).replace(/[^0-9]/g, '').slice(0, 4); });
      });
      return g;
    });
  };
  const close = () => { if (!entries.length || window.confirm(`The ${KL.toLowerCase()} grid has changes that are not saved. Close without saving?`)) onClose(); };
  const save = async () => {
    setTried(true); setErr('');
    if (problems.length) { setErr(problems[0].text + (problems.length > 1 ? ` (+${problems.length - 1} more)` : '')); return; }
    if (!entries.length) { onClose(); return; }
    setBusy(true);
    try {
      await api.saveOle(entries);
      setBusy(false);
      onSaved(entries.map((e) => e.hour));
    } catch (x) { setErr(`Could not save: ${x.message}`); setBusy(false); }
  };
  const bad = (i, h) => tried && problems.some((p) => p.row === i && (h == null ? p.hour == null : p.hour === h));
  const sel = 'h-8 w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 text-fs-13 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40';
  const th = 'border-b border-slate-200 bg-[#DCE6F2] px-1 py-1 text-fs-12 font-extrabold text-[#1F3864]';
  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-fs-13 text-slate-700">Total <b className="font-mono text-red-700">{nf(total)}</b> pcs · {entries.length ? <b>{entries.length} hour{entries.length > 1 ? 's' : ''} changed</b> : 'nothing changed'}</span>
      {err && <span role="alert" className="rounded bg-red-50 px-2 py-1 text-fs-13 font-bold text-red-700">{err}</span>}
      <span className="ml-auto" />
      <button type="button" onClick={close} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
      <button type="button" data-testid="rg-save" disabled={busy} onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1F3864] px-4 text-fs-14 font-bold text-white hover:bg-blue-900 disabled:opacity-60"><Save size={15} aria-hidden /> {busy ? 'Saving…' : `Save all${entries.length ? ` (${entries.length} h)` : ''}`}</button>
    </div>
  );
  return (
    <MesDrawer title={`${KL} · many hours · Line ${line}`} sub={`${dmy(date)} · as the rework report: one row per stage, model and defect · the pieces under each hour · ${kind === 'rejects' ? 'rework' : 'rejection'} of the hours stays as it is`} icon={ListChecks} onClose={close} label={`${KL} of all hours`} width={96} bodyClass="p-3" footer={footer} excel={false}>
      {onKind && (
        <div className="mb-2 inline-flex rounded-lg border border-slate-300 p-0.5" role="group" aria-label="Kind">
          {[['rework', 'Rework'], ['rejects', 'Rejection']].map(([k, t]) => (
            <button key={k} type="button" data-testid={`rg-kind-${k}`} aria-pressed={kind === k} onClick={() => { if (k !== kind && (!entries.length || window.confirm(`The ${KL.toLowerCase()} changes are not saved. Switch without saving?`))) onKind(k, fm); }}
              className={`rounded-md px-3 py-1 text-fs-13 font-bold ${kind === k ? 'bg-[#1F3864] text-white' : 'text-slate-700 hover:bg-slate-50'}`}>{t}</button>
          ))}
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Model">
        <span className="text-fs-12 font-bold text-slate-600">Model:</span>
        <button type="button" aria-pressed={!fm} onClick={() => pickModel('')} className={`rounded-full border px-2.5 py-1 text-fs-12 font-bold ${!fm ? 'border-[#1F3864] bg-[#1F3864] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>All models · all hours</button>
        {models.map((m) => {
          const pcs = Object.values(mq[m] || {}).reduce((a, v) => a + v, 0); const nh = Object.values(mq[m] || {}).filter((v) => v > 0).length;
          return <button key={m} type="button" data-testid="rg-model" aria-pressed={fm === m} onClick={() => pickModel(m)} title={`${m}: ${nf(pcs)} pcs in ${nh} hour${nh > 1 ? 's' : ''} — fill its rework of all those hours at once`} className={`rounded-full border px-2.5 py-1 text-fs-12 font-bold ${fm === m ? 'border-[#1F3864] bg-[#1F3864] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{m} <span className={fm === m ? 'text-blue-100' : 'text-slate-500'}>· {nh} h · {nf(pcs)}</span></button>;
        })}
      </div>
      <div className="overflow-x-auto" ref={tableRef} data-testid="rework-grid">
        <table className="w-full border-collapse text-fs-13">
          <thead>
            <tr>
              <th className={`${th} w-7 text-center`}>#</th>
              <th className={`${th} text-left`} style={{ minWidth: 104 }}>Stage</th>
              <th className={`${th} text-left`} style={{ minWidth: 136 }}>Model</th>
              <th className={`${th} text-left`} style={{ minWidth: 92 }}>Category</th>
              <th className={`${th} text-left`} style={{ minWidth: 150 }}>Defect</th>
              <th className={`${th} text-left`} style={{ minWidth: 104 }}>Cause</th>
              <th className={`${th} text-left`} style={{ minWidth: 104 }}>Action</th>
              {cols.map((h) => <th key={h} className={`${th} text-center font-mono`} style={{ minWidth: 40 }} title={`${p2(h)}:00–${p2(h + 1)}:00 · ${nf(fm ? mq[fm]?.[h] || 0 : made[h])} pcs ${fm ? `of ${fm} ` : ''}made`}>{p2(h)}<div className="text-fs-10 font-semibold text-slate-500">{nf(fm ? mq[fm]?.[h] || 0 : made[h])}</div></th>)}
              <th className={`${th} text-right`}>Total</th>
              <th className={`${th} text-center`} title="Pieces of the row dismantled">Dism. pcs</th>
              <th className={th} aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {vis.map(([g, i], vi) => {
              const defs = defectsAt(g.station);
              return (
                <tr key={g.id} className="border-b border-slate-100 align-middle" data-testid="rg-row">
                  <td className="px-1 text-center font-mono text-fs-12 text-slate-500">{i + 1}</td>
                  <td className="px-0.5 py-0.5">
                    <select aria-label={`Row ${i + 1} station`} value={g.station} onChange={(e) => set(i, { station: e.target.value })} className={`${sel} ${bad(i) && !g.station ? 'border-red-500 bg-red-50' : ''}`}>
                      <option value="">Stage…</option>
                      {[...new Set([...stations.map((s) => s.reason), g.station].filter(Boolean))].map((s) => <option key={s} value={s}>{shortSt(s)}</option>)}
                    </select>
                  </td>
                  <td className="px-0.5 py-0.5">
                    <select aria-label={`Row ${i + 1} model`} title={g.model} value={g.model} onChange={(e) => set(i, { model: e.target.value })} className={sel}>
                      <option value="">—</option>
                      {[...new Set([...models, g.model].filter(Boolean))].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="px-0.5 py-0.5">
                    <select aria-label={`Row ${i + 1} category`} value={g.cat} onChange={(e) => set(i, { cat: e.target.value })} className={sel}>
                      <option value="">—</option>
                      {QCATS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-0.5 py-0.5">
                    <input aria-label={`Row ${i + 1} defect`} title={g.reason} list={`rg-def-${g.id}`} value={g.reason} placeholder="Defect…" onChange={(e) => pickDefect(i, e.target.value)} className={`${sel} ${bad(i) && !String(g.reason || '').trim() ? 'border-red-500 bg-red-50' : ''}`} />
                    <datalist id={`rg-def-${g.id}`}>{defs.map((d) => <option key={d.reason} value={d.reason} />)}</datalist>
                  </td>
                  <td className="px-0.5 py-0.5"><input aria-label={`Row ${i + 1} cause`} title={g.cause} list={`rg-cause-${g.id}`} value={g.cause} placeholder="Cause…" onChange={(e) => set(i, { cause: e.target.value })} className={sel} />
                    <datalist id={`rg-cause-${g.id}`}>{rcaSuggest(g.reason, 'cause', grid).map((t) => <option key={t} value={t} />)}</datalist></td>
                  <td className="px-0.5 py-0.5"><input aria-label={`Row ${i + 1} action`} title={g.action} list={`rg-action-${g.id}`} value={g.action} placeholder="Action…" onChange={(e) => set(i, { action: e.target.value })} className={sel} />
                    <datalist id={`rg-action-${g.id}`}>{rcaSuggest(g.reason, 'action', grid).map((t) => <option key={t} value={t} />)}</datalist></td>
                  {cols.map((h, k) => {
                    const v = g.q[h] ?? '';
                    const run = ran(g.model, h);
                    const lim = g.model && mq[g.model] ? mq[g.model][h] || 0 : made[h];
                    const over = lim > 0 && n(v) > lim;
                    if (!run && !n(v)) return <td key={h} className="px-0.5 py-0.5"><div className="grid h-8 place-items-center rounded bg-slate-100 text-fs-11 text-slate-400" title={`${g.model} did not run ${p2(h)}:00–${p2(h + 1)}:00`}>·</div></td>;
                    return (
                      <td key={h} className="px-0.5 py-0.5">
                        <input data-rg={`${vi}:${k}`} aria-label={`Row ${i + 1} ${p2(h)}:00 pieces`} inputMode="numeric" value={v === 0 ? '' : v} placeholder={g.model && mq[g.model]?.[h] ? String(mq[g.model][h]) : ''} title={g.model && mq[g.model]?.[h] ? `${g.model}: ${mq[g.model][h]} pcs made ${p2(h)}:00–${p2(h + 1)}:00` : undefined}
                          onChange={(e) => setQ(i, h, e.target.value)} onKeyDown={(e) => onKey(e, vi, k)} onPaste={(e) => onPaste(e, vi, k)} onFocus={(e) => e.target.select()}
                          className={`h-8 w-full rounded border text-center font-mono text-fs-14 font-bold lp-rg-box focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${over ? 'border-red-500 bg-red-50 text-red-700' : n(v) ? 'border-blue-300 bg-blue-50 text-slate-900' : 'border-slate-200 bg-white text-slate-900'}`} />
                      </td>
                    );
                  })}
                  <td className="px-1.5 text-right font-mono font-extrabold text-slate-900">{nf(rowSum(g))}</td>
                  <td className="px-0.5 text-center">
                    {/* 25-11-2026: how many of the row's pieces were dismantled (all of them for a dismantle defect; change it) */}
                    <input aria-label={`Row ${i + 1} dismantled pieces`} inputMode="numeric" title="Pieces of this row dismantled (0 – the row's total)" value={g.disAll ? String(rowSum(g) || '') : g.disN ?? ''} placeholder="0"
                      onChange={(e) => set(i, { disN: e.target.value.replace(/[^0-9]/g, '').slice(0, 4), disAll: false, disSet: true })} onFocus={(e) => e.target.select()}
                      className={`lp-rg-box h-8 w-12 rounded border text-center font-mono text-fs-13 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${bad(i) && !g.disAll && Number(g.disN) > rowSum(g) ? 'border-red-500 bg-red-50 text-red-700' : (g.disAll ? rowSum(g) : Number(g.disN)) > 0 ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-900'}`} />
                  </td>
                  <td className="px-0.5 text-center">
                    <button type="button" aria-label={`Remove row ${i + 1}`} title="Remove the row (its pieces of every hour)" onClick={() => setGrid((x) => x.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={15} aria-hidden /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50">
              <td colSpan={7} className="px-2 py-1 text-right text-fs-12 font-extrabold uppercase text-slate-600">{KL} of the hour</td>
              {cols.map((h) => <td key={h} className={`px-0.5 py-1 text-center font-mono text-fs-13 font-extrabold ${colSum(h) ? 'text-red-700' : 'text-slate-400'}`}>{colSum(h) || '–'}</td>)}
              <td className="px-1.5 py-1 text-right font-mono font-extrabold text-red-700">{nf(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="rg-add" onClick={() => setGrid((g) => [...g, blankRow(vis[vis.length - 1]?.[0].station || g[g.length - 1]?.station || '')])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-3 text-fs-13 font-bold text-blue-800 hover:bg-blue-100"><Plus size={14} aria-hidden /> Add row{fm ? ` (${fm})` : ''}</button>
        <span className="text-fs-12 text-slate-600">Grey box = the model did not run that hour · the faint number = its pieces in the hour · cause / action: choose a suggestion (plant MIS) or write · Enter = next row · paste a block from Excel into a box · the small number under the hour = pieces made · columns as the rework report: stage · model · category · defect · cause · action · hours</span>
      </div>
    </MesDrawer>
  );
}

export { noLossHour };   // 23-11-2026: utils/entryStatus.js (shared with the Entry dashboard)

/** Big screen: the hours of the day as a list with their state (saved · no loss · pending · future), like the MES time slots. */
function HourSlots({ auto = () => false, L, sel, onPick, has, QM = false, noRun = () => false, lastAt = null, TG = { by: {} }, strip = false }) {
  const [fitRef, fitH] = useFitHeight(!strip);
  const st = (r) => {
    const n = has(r) ? 1 : 0;
    if (noRun(r)) return ['NO RUN', 'border-slate-300 bg-slate-100 text-slate-600'];   // after the last scan: not counted
    if (r.future) return ['FUTURE', 'text-slate-400 border-transparent'];
    if (n && !QM && r.e.noLoss && !r.e.stops.length && !r.e.losses.length) return ['NO LOSS', 'border-emerald-300 bg-emerald-50 text-emerald-800'];   // saved by the line
    if (n && QM && r.e.noQ && !r.e.rejects.length && !r.e.rework.length) return ['NO DEFECT', 'border-emerald-300 bg-emerald-50 text-emerald-800'];   // 23-11-2026
    if (n) return ['SAVED', 'border-emerald-300 bg-emerald-50 text-emerald-800'];
    if (auto(r)) return ['NO LOSS', 'border-emerald-300 bg-emerald-50 text-emerald-800'];   // 23-11-2026: by itself (0′ lost)
    return ['PENDING', 'border-amber-300 bg-amber-50 text-amber-800'];
  };
  const cnt = { SAVED: 0, 'NO LOSS': 0, 'NO DEFECT': 0, PENDING: 0, FUTURE: 0, 'NO RUN': 0 };
  for (const r of L.rows) cnt[st(r)[0]] += 1;
  const stripRef = useRef(null);
  useEffect(() => {   // the strip keeps the chosen hour in view
    const el = stripRef.current?.querySelector('[aria-pressed="true"]');
    if (strip && el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [strip, sel]);
  if (strip) {
    return (
      <section className="sticky top-0 z-10 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Hours of the day">
        <div className="flex flex-wrap items-center gap-x-2.5 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-fs-12 font-bold">
          <span className="font-extrabold uppercase tracking-wider text-slate-600">Hours</span>
          <span className="text-emerald-700">● {cnt.SAVED + cnt['NO LOSS'] + cnt['NO DEFECT']} done</span><span className="text-amber-700">● {cnt.PENDING} pending</span><span className="text-slate-500">● {cnt.FUTURE} future</span>
        </div>
        <div ref={stripRef} className="flex gap-1.5 overflow-x-auto p-1.5">
          {L.rows.map((r) => {
            const [t, c] = st(r); const on = r.hour === sel;
            return (
              <button key={r.hour} type="button" disabled={r.future} onClick={() => onPick(r.hour)} aria-pressed={on} aria-label={`Hour ${p2(r.hour)}:00 ${t.toLowerCase()}`}
                className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left disabled:cursor-default ${on ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : r.future ? 'border-slate-200 opacity-60' : 'border-slate-200 hover:bg-slate-50'}`}>
                <span className={`block font-mono text-fs-14 ${on ? 'font-extrabold text-blue-900' : 'font-bold text-slate-900'}`}>{p2(r.hour)}–{p2(r.hour + 1)}</span>
                {!r.future && <span className="block whitespace-nowrap text-fs-12 text-slate-600">{nf(r.qty)}{!QM && TG.by[r.hour] != null ? ` / ${nf(TG.by[r.hour])}` : ''} pcs</span>}
                <span className={`mt-0.5 inline-block rounded border px-1.5 text-fs-11 font-extrabold ${c}`}>{t}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <section ref={fitRef} style={{ maxHeight: fitH || 'calc(100vh - 120px)' }} className="sticky top-2 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Hours of the day">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-fs-12 font-extrabold uppercase tracking-wider text-slate-600">Hours</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-fs-12 font-bold">
          <span className="text-emerald-700">● {cnt.SAVED} saved</span>{cnt['NO LOSS'] > 0 && <span className="text-emerald-700">● {cnt['NO LOSS']} no loss</span>}{cnt['NO DEFECT'] > 0 && <span className="text-emerald-700">● {cnt['NO DEFECT']} no defects</span>}<span className="text-amber-700">● {cnt.PENDING} pending</span>{cnt['NO RUN'] > 0 && <span className="text-slate-500" title="After the last scan of the day: not counted">● {cnt['NO RUN']} no run</span>}<span className="text-slate-500">● {cnt.FUTURE} future</span>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {L.rows.map((r) => {
          const [t, c] = st(r); const on = r.hour === sel; const nr = t === 'NO RUN';
          return (
            <button key={r.hour} type="button" disabled={r.future} onClick={() => onPick(r.hour)} aria-pressed={on} aria-label={`Hour ${p2(r.hour)}:00 ${t.toLowerCase()}`} title={nr ? 'After the last scan of the day: this hour is not counted' : undefined}
              // 25-11-2026: one slim line per hour — the whole day fits without scrolling
              className={`flex w-full items-center gap-1.5 border-b border-slate-100 px-2.5 py-1.5 text-left last:border-b-0 disabled:cursor-default ${on ? 'bg-blue-50 shadow-[inset_3px_0_0_rgb(var(--blue-600))]' : r.future ? '' : 'hover:bg-slate-50'}`}>
              <span className={`shrink-0 font-mono text-fs-14 ${r.future ? 'text-slate-400' : on ? 'font-extrabold text-blue-900' : 'font-bold text-slate-900'}`}>{p2(r.hour)}–{p2(r.hour + 1)}</span>
              <span className="min-w-0 flex-1 truncate text-fs-12 text-slate-600" title={nr ? 'After the last scan of the day' : undefined}>{r.future && !nr ? '' : nr ? `after ${lastAt ? lastAt.slice(11, 16) : 'last scan'}` : `${nf(r.qty)}${!QM && TG.by[r.hour] != null ? `/${nf(TG.by[r.hour])}` : ''}${r.lunch ? ' · lunch' : ''}${r.extra ? ' · extra' : ''}`}</span>
              <span className={`shrink-0 rounded border px-1.5 py-px text-fs-11 font-extrabold ${c}`}>{t}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The hours of the day as tiles: pieces, models, what is entered; tap to fill. */
function HourTiles({ auto = () => false, L, canEdit, onFill, QM = false, TG = { by: {} }, noRun = () => false, lastAt = null, LOST = {} }) {
  return (
    <section className={card} aria-label="Hours to fill">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-fs-18 font-bold text-slate-900">Hours of {L.name}</h3>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {L.rows.map((r) => {
          const e = r.e;
          const n = QM ? e.rejects.length + e.rework.length : e.stops.length + e.losses.length;
          // a past hour that is not explained yet: pieces made but nothing entered, or no scans at all (why?)
          // 20-11-2026: "No loss" only when the line saved it (checked); a 0-minute hour asks to be confirmed
          const nr = noRun(r);   // after the last scan of the day: not counted
          const autoNo = !nr && auto(r);   // 23-11-2026: lost no time — "No loss" by itself
          const noLoss = !QM && !n && !nr && (!!e.noLoss || autoNo);
          const noDef = QM && !n && !nr && !!e.noQ;   // 23-11-2026: quality checked, nothing found
          const confirm = !QM && !n && !nr && !noLoss && noLossHour(r) && !(LOST[r.hour] > 0);   // 23-11-2026: a model that lost time: "To fill"
          const todo = !r.future && !nr && !r.closed && !n && !noLoss && !noDef && !(r.lunch && !r.qty) && !(r.extra && !r.qty);
          const oleH = !r.future && !r.extra && !r.closed && r.totalMin > 0 && r.ole != null ? r.ole : null;
          const items = QM ? [
            ...e.rejects.map((x) => ['bg-amber-50 text-amber-800', `${x.station ? `${shortSt(x.station)}: ` : ''}${x.reason} ${x.qty} rej${x.dismantle ? ` · ${x.dismantle} dismantled` : ''}`, 'rejection']),
            ...e.rework.map((x) => ['bg-sky-50 text-sky-800', `${x.station ? `${shortSt(x.station)}: ` : ''}${x.reason} ${x.qty} rwk${x.dismantle ? ` · ${x.dismantle} dismantled` : ''}`, 'rework']),
          ] : [...e.stops, ...e.losses].map((x) => ['bg-red-50 text-red-800', `${x.model ? `${x.model}: ` : ''}${x.reason} ${x.min}′`, 'loss']);
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-fs-18 font-extrabold text-slate-900">{p2(r.hour)}–{p2(r.hour + 1)}{r.lunch && <span className="ml-1.5 font-sans text-fs-13 font-semibold text-slate-600">Lunch</span>}{r.extra && <span className="ml-1.5 font-sans text-fs-13 font-bold text-amber-700">Extra</span>}</span>
                {nr ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-fs-13 font-bold text-slate-600" title="After the last scan of the day: this hour is not counted">No run · after last scan{lastAt ? ` ${lastAt.slice(11, 16)}` : ''}</span>
                  : r.future ? <span className="text-fs-13 font-semibold text-slate-500">Not yet</span>
                  : n ? <span className="inline-flex items-center gap-1 text-fs-13 font-bold text-sky-700"><CheckCircle2 size={15} aria-hidden />{n} entr{n === 1 ? 'y' : 'ies'}</span>
                    : noDef ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-fs-13 font-extrabold text-emerald-800" title={`Checked by ${e.noQBy || '—'}${e.noQAt ? ` · ${e.noQAt}` : ''}`}><CheckCircle2 size={13} aria-hidden />No defects · {e.noQBy || 'saved'}</span>
                    : noLoss ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-fs-13 font-extrabold text-emerald-800" title={autoNo ? 'No loss (automatic): the hour met its target, or no model lost time according to the scans. Nothing needs to be saved' : `Checked by ${e.noLossBy || '—'}${e.noLossAt ? ` · ${e.noLossAt}` : ''}`}><CheckCircle2 size={13} aria-hidden />No loss · {autoNo ? 'auto' : e.noLossBy || 'saved'}</span>
                    : confirm ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-fs-13 font-extrabold text-amber-800" title="0 minutes lost by the scans — open and save No loss"><PencilLine size={13} aria-hidden />Confirm no loss</span>
                    : todo ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-fs-13 font-extrabold text-amber-800"><PencilLine size={13} aria-hidden />To fill</span>
                    : <span className="text-fs-13 font-semibold text-slate-600">Nothing entered</span>}
              </div>
              <div className="mt-1 flex items-start justify-between gap-2 text-fs-14 text-slate-700">
                <span className="min-w-0 break-words font-mono font-semibold">{r.models.length ? r.models.map((m) => m.model).join(', ') : <span className="font-sans font-normal text-slate-500">No scans</span>}</span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-fs-16 font-extrabold text-slate-900">{nf(r.qty)}{!QM && TG.by[r.hour] != null ? <span className="text-fs-13 font-bold text-slate-500"> / {nf(TG.by[r.hour])}</span> : ''} pcs</span>
                  {oleH != null && <span className={`block font-mono text-fs-13 font-bold ${oleH >= okFrom() ? 'text-emerald-700' : oleH >= watchFrom() ? 'text-amber-700' : 'text-red-700'}`} title="OLE of this hour">OLE {Math.round(oleH * 100)}%</span>}
                  {!QM && LOST[r.hour] > 0 && <span className="block font-mono text-fs-13 font-bold text-red-700" title="Minutes lost against std in this hour, model by model (from the scans)">Lost {LOST[r.hour]}′ vs std</span>}
                </span>
              </div>
              {items.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{items.map(([c, t, k], i) => <span key={i} className={`max-w-full break-words rounded px-1.5 py-0.5 text-fs-13 font-semibold ${c}`} title={k}>{t}</span>)}</div>}
            </>
          );
          return canEdit && !r.future
            ? <button key={r.hour} type="button" onClick={() => onFill(r)} aria-label={`Fill ${L.name} ${p2(r.hour)}:00`} className={`min-w-0 rounded-xl border p-2.5 text-left transition hover:border-blue-500 hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${n ? 'border-sky-300 bg-sky-50/40' : todo ? 'border-amber-300 border-l-4 border-l-amber-500 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>{body}</button>
            : <div key={r.hour} className={`min-w-0 rounded-xl border p-2.5 ${r.future ? 'border-dashed border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`}>{body}</div>;
        })}
      </div>
    </section>
  );
}

/** Whole-day planned stop of one line on one day: the day gets no OLE (it does not lower the month). */
function DayOffDialog({ L, line, date, reasons, onClose, onSaved }) {
  const [reason, setReason] = useState(L.dayOff?.reason || reasons[0] || '');
  const [note, setNote] = useState(L.dayOff?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (off) => {
    setBusy(true); setErr('');
    try { await api.saveOleDay({ date, line: Number(line), off, reason, note }); onSaved(off ? `Line ${line}, ${dmy(date)}: line off all day (${reason}).` : `Line ${line}, ${dmy(date)}: line off taken back.`); }
    catch (x) { setErr(`Could not save: ${x.message}`); setBusy(false); }
  };
  const made = L.total.qty > 0;
  return (
    <MesDrawer title="Line off all day" sub={`${L.name} · ${dmy(date)}`} icon={CalendarOff} onClose={onClose} label={`Line off all day Line ${line}`} method="center" width={34} canExpand={false}>
        <div className="flex flex-col gap-3 px-5 py-4">
          {made && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-fs-13 font-semibold text-amber-900">{L.name} made {nf(L.total.qty)} pcs on {dmy(date)}</p>}
          <div role="radiogroup" aria-label="Reason" className="grid gap-1.5 sm:grid-cols-2">
            {reasons.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={`rounded-lg border px-3 py-2 text-left text-fs-14 font-semibold ${reason === r ? 'border-blue-700 bg-blue-50 text-blue-900 ring-1 ring-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'}`}>{r}</button>
            ))}
          </div>
          <input className={`${inp} h-10`} aria-label="Note" placeholder="Note (optional), e.g. Diwali holiday" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">
          {L.dayOff && <button type="button" disabled={busy} onClick={() => send(false)} className="mr-auto h-10 rounded-lg border border-red-300 px-4 text-fs-14 font-bold text-red-700 hover:bg-red-50">Take back</button>}
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700">Cancel</button>
          <button type="button" disabled={busy || !reason || made} title={made ? 'This day has production' : undefined} onClick={() => send(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-60"><Save size={15} aria-hidden /> {busy ? 'Saving…' : 'Save'}</button>
        </div>
    </MesDrawer>
  );
}

/**
 * The day, model by model: minutes each model ran (from the scans of every hour), its std time, the time it lost,
 * the loss already entered for it and what is still not explained (slow running → Performance).
 */
function DayLostByModel({ L, date, nowMin, lastScanHour = null, DS }) {
  const hours = L.rows.filter((r) => r.qty > 0 && !r.extra && !r.future);
  // 23-11-2026: the scans come from the page (read once per hour, the running hour again when its pieces change)
  const scans = DS.byHour, busy = DS.busy;
  const rows = useMemo(() => {
    const m = new Map();
    for (const r of hours) {
      const t = modelTimeOfHour({ hour: r.hour, scans: scans[r.hour] || null, models: r.models, stops: r.e.stops, totalMin: r.totalMin, nowMin, shift: L.shift, endAtLastScan: r.hour === lastScanHour });
      for (const x of t.rows) {
        const o = m.get(x.model) || { model: x.model, qty: 0, runMin: 0, stdMin: 0, lostMin: 0, noStd: false, entered: 0 };
        o.qty += x.qty; o.runMin += x.runMin; o.stdMin += x.stdMin || 0; o.lostMin += x.lostMin == null ? 0 : Math.round(x.lostMin);   // whole minutes per hour, as the form if (x.stdMin == null) o.noStd = true;
        m.set(x.model, o);
      }
      for (const x of r.e.losses) { const o = m.get(x.model); if (o) o.entered += x.min; }
    }
    return [...m.values()].sort((a, b) => b.lostMin - a.lostMin);
  }, [L, DS.ver, nowMin, lastScanHour]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hours.length) return null;
  const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
  const r0 = (v) => Math.round(v);
  const maxLost = Math.max(1, ...rows.map((x) => x.lostMin));
  return (
    <section className={card} aria-label="Time lost against std by model">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-fs-16 font-bold text-slate-900">Time lost against std — by model · {L.name}, {dmy(date)}</h3>
        <span className="text-fs-13 text-slate-500">{busy ? 'reading the scans …' : `from the scans of ${hours.length} hour${hours.length === 1 ? '' : 's'}`}</span>
        <button type="button" onClick={DS.reload} className="ml-auto text-fs-13 font-bold text-blue-700 hover:underline">Refresh</button>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-fs-14 tabular-nums" aria-label="Lost time by model, day">
          <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">
            {['Model', 'Qty', 'Run', 'Std time', 'Lost vs std', '', 'Loss entered', 'Not explained'].map((h, i) => <th key={i} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.model} className="border-b border-slate-100">
                <td className="min-w-[160px] max-w-[320px] break-words px-2 py-1.5 font-mono font-bold text-slate-900" title={x.model}>{x.model}</td>
                <td className="px-2 font-mono">{nf(x.qty)}</td>
                <td className="px-2 font-mono whitespace-nowrap">{r0(x.runMin)} min</td>
                <td className="px-2 font-mono whitespace-nowrap">{x.noStd && !x.stdMin ? <span className="text-slate-400">no std</span> : `${r0(x.stdMin)} min`}</td>
                <td className="px-2 font-mono font-extrabold text-red-700 whitespace-nowrap">{r0(x.lostMin)} min</td>
                <td className="min-w-[110px] px-2"><div className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-red-500" style={{ width: `${(x.lostMin / maxLost) * 100}%` }} /></div></td>
                <td className="px-2 font-mono whitespace-nowrap">{r0(x.entered)} min</td>
                <td className={`px-2 font-mono font-bold whitespace-nowrap ${x.lostMin - x.entered >= 1 ? 'text-amber-700' : 'text-emerald-700'}`}>{r0(Math.max(0, x.lostMin - x.entered))} min</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
              <td className="px-2 py-1.5">Day</td><td className="px-2 font-mono">{nf(sum('qty'))}</td><td className="px-2 font-mono">{r0(sum('runMin'))} min</td><td className="px-2 font-mono">{r0(sum('stdMin'))} min</td>
              <td className="px-2 font-mono text-red-700">{r0(sum('lostMin'))} min</td><td /><td className="px-2 font-mono">{r0(sum('entered'))} min</td><td className="px-2 font-mono">{r0(Math.max(0, sum('lostMin') - sum('entered')))} min</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* 23-11-2026: how each number is made, in one line */}
      <p className="mt-2 text-fs-12 text-slate-500" data-testid="lost-how">
        <b>Run</b> = minutes the model was on the line (from one scan to the next) · <b>Std time</b> = pieces × std cycle ·
        <b> Lost vs std</b> = Run − Std time, model by model (a model faster than its std does not cover a slower one) ·
        <b> Not explained</b> = Lost − loss entered · hour <b>target</b> = Σ Run ÷ std cycle of each model with a cycle time.
      </p>
    </section>
  );
}

/** Unplanned loss helper: per model the minutes it ran, its std time, the time lost, what is still to explain. */
function LostVsStd({ mt, leftOf, fillAll, scanFail, autoRows = 0 }) {
  const [open, setOpen] = useState(false);
  const m1 = (v) => (v == null ? '—' : Math.round(v));
  const left = mt.rows.reduce((a, t) => a + (leftOf(t.model) || 0), 0);
  return (
    <div className="mt-1.5 rounded-lg border border-red-100 bg-red-50/50" role="region" aria-label="Time lost against std">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
        <span className="text-fs-14 font-bold text-slate-700">Lost vs std</span>
        <span className={`font-mono text-fs-16 font-extrabold ${lostWhole(mt) > 0 ? 'text-red-700' : 'text-slate-500'}`}>{lostWhole(mt)}′</span>
        <span className="text-fs-14 text-slate-600">to explain <b className={`font-mono ${left > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{left}′</b></span>
        <span className="text-fs-12 text-slate-400">{mt.estimated ? (scanFail ? 'scans not readable — estimated' : 'estimated') : 'from the scans'}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {left > 0 && <button type="button" onClick={fillAll} className="rounded-md bg-red-600 px-2.5 py-1 text-fs-12 font-bold text-white hover:bg-red-700">Fill all models</button>}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-md px-2 py-1 text-fs-12 font-bold text-slate-600 hover:bg-white">{open ? 'Hide' : 'By model'} {open ? '▴' : '▾'}</button>
        </span>
      </div>
      {open && (
        <table className="w-full border-t border-red-100 text-fs-13 tabular-nums" aria-label="Lost time by model">
          <thead><tr className="text-left text-fs-11 font-bold text-slate-500"><th className="px-3 py-1">Model</th><th className="px-1 text-right">Pcs</th><th className="px-1 text-right">Run</th><th className="px-1 text-right">Std</th><th className="px-1 text-right">Lost</th><th className="px-3 text-right">To explain</th></tr></thead>
          <tbody>
            {mt.rows.map((t) => {
              const l = leftOf(t.model);
              return (
                <tr key={t.mmId} className="border-t border-red-100/70">
                  <td className="min-w-[120px] max-w-[260px] break-words px-3 py-1 font-mono font-bold text-slate-800" title={t.model}>{t.model}</td>
                  <td className="px-1 text-right font-mono">{t.qty}</td>
                  <td className="px-1 text-right font-mono">{m1(t.runMin)}′</td>
                  <td className="px-1 text-right font-mono">{t.stdMin == null ? <span className="text-slate-400" title="no std cycle for this model">—</span> : `${m1(t.stdMin)}′`}</td>
                  <td className={`px-1 text-right font-mono font-bold ${Math.round(t.lostMin || 0) > 0 ? 'text-red-700' : 'text-slate-500'}`}>{t.lostMin == null ? '—' : `${m1(t.lostMin)}′`}</td>
                  <td className={`px-3 text-right font-mono font-extrabold ${l > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{l == null ? '—' : `${l}′`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {autoRows > 0
        ? null
        : null}
    </div>
  );
}

/** Look of the four parts of the hour form. */
const PART = {
  stops: { bar: 'bg-slate-500', ring: 'border-slate-300', head: 'bg-slate-100 text-slate-800', dot: 'bg-slate-500' },
  losses: { bar: 'bg-red-600', ring: 'border-red-200', head: 'bg-red-50 text-red-900', dot: 'bg-red-600' },
  rejects: { bar: 'bg-amber-500', ring: 'border-amber-200', head: 'bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  rework: { bar: 'bg-sky-500', ring: 'border-sky-200', head: 'bg-sky-50 text-sky-900', dot: 'bg-sky-500' },
};

/**
 * The form of one hour. Loss mode: loss rows (model, reason → department, minutes) with the time bar of the hour.
 * Quality mode: rejection and rework rows (station, model, defect, pieces). Quick-reason chips, "Copy", "Save & next".
 * Empty rows are not saved; the part of the hour the other page fills is kept as it is.
 */
function HourDialog({ autoNo = false, L, r, date, reasons, prev, next, onClose, onSaved, nowMin = null, lastScanHour = null, inline = false, mode = 'loss', target = null, scans: given, scanFail: givenFail = false, onDirty = null, onManyHours = null, em = {}, dayCyc = null }) {
  const [fitRef, fitH] = useFitHeight(inline);   // 24-11-2026: the form fills the screen; only its middle scrolls
  const QM = mode === 'quality';
  // 19-11-2026: the reason (loss / rejection / rework / defect) is picked from a side drawer: { title, list, grouped, pick, now }
  const [rp, setRp] = useState(null);
  const rpOpen = React.useRef(false); rpOpen.current = !!rp;
  const start0 = normEntry(r.entry);
  // an old "planned stop" row of the hour is shown (and saved) as a loss row
  const start = QM ? start0 : { ...start0, stops: [], losses: [...start0.stops.map((x) => ({ ...x, fromStop: true })), ...start0.losses] };
  const models = r.models.map((m) => m.model).filter(Boolean);
  // no model ran in this hour (line idle, breakdown all hour …): the loss can still be entered — with a model of the
  // day if it was meant for one, or with "No model ran"
  const idle = models.length === 0;
  const dayModels = [...new Set(L.rows.flatMap((x) => x.models.map((m) => m.model)).filter(Boolean))];
  const pickList = idle ? dayModels : models;
  const one = models.length === 1 ? models[0] : '';
  // 25-11-2026: a new row comes with a model already chosen — the hour's only model, else the one that lost the most time
  // (from the scans), else the one that made the most pieces; it can be changed
  const topModel = () => {
    if (one) return one;
    const lost = (mtRef.current?.rows || []).filter((t) => t.lostMin > 0).sort((a, b) => b.lostMin - a.lostMin)[0];
    if (lost?.model) return lost.model;
    return [...r.models].sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0))[0]?.model || '';
  };
  const mtRef = useRef(null);
  const blank = (num, station = '') => ({ ...(num === 'qty' ? { station } : {}), model: num === 'min' ? topModel() : one, reason: '', [num]: '' });
  // loss: one row ready for every model that ran in the hour (fill the minutes it lost; empty rows are not saved)
  // 25-11-2026: no empty row per model to start with — only the models that lost time get a row (filled from the scans);
  // an hour that met its target starts empty (Quick add / Add loss when there was a loss)
  const lossStart = QM ? start.losses : start.losses.length ? start.losses : [];
  const [f, setF] = useState(() => ({ stops: start.stops, losses: lossStart, rejects: start.rejects, rework: start.rework, note: start.note }));
  // 23-11-2026: a change made by the user (not the minutes filled from the scans) marks the hour "not saved": the page
  // stops reading the line again under the form until it is saved or undone
  const [touched, setTouched] = useState(false);
  const edit = (fn) => { setTouched(true); setF(fn); };
  const dirtyRef = useRef(onDirty); dirtyRef.current = onDirty;
  useEffect(() => { dirtyRef.current?.(touched); }, [touched]);
  useEffect(() => () => dirtyRef.current?.(false), []);

  // only the loss is open at first (and any part that already has entries); the rest opens with a tap
  const [openParts, setOpenParts] = useState(() => new Set(QM ? ['rejects', 'rework'] : mode === 'both' ? ['losses', 'rejects', 'rework'] : ['losses']));
  const toggle = (k) => setOpenParts((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // keys: Esc closes · Ctrl+S saves · Ctrl+Enter saves and opens the next hour
  const keyRef = React.useRef(null);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape' && !inline) { if (!rpOpen.current) onClose(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); keyRef.current?.(false); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); keyRef.current?.(!!next); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose, next]);
  useEffect(() => { if (inline) return undefined; const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, [inline]);
  // 20-11-2026: a defect chosen → what the line writes most often with it (Book1): category, root cause, action, and
  // "Dismantled" for a dismantle defect. A box filled this way follows a later change of the defect; a box the user
  // wrote or changed keeps his text.
  // 21-11-2026: rework rows get only the category — root cause and action are written by the line, never filled by default
  const applyDefect = (row, v, part = 'rejects') => {
    const h = defectHint(v); const auto = { ...(row.hintAuto || {}) }; const o = {};
    for (const k of part === 'rework' ? ['cat'] : ['cat', 'cause', 'action']) {
      if (String(row[k] || '').trim() && !auto[k]) continue;
      o[k] = h[k] || '';
      if (h[k]) auto[k] = true; else delete auto[k];
    }
    o.hintAuto = auto;
    if (isDismantleDefect(v)) { if (!(Number(row.dismantle) > 0)) { o.dismantle = String(Math.max(1, Number(row.qty) || 1)); o.disAuto = true; } }
    else if (row.disAuto) { o.dismantle = ''; o.disAuto = false; }
    return o;
  };
  const setRow = (key, i, k, v) => edit((x) => ({ ...x, [key]: x[key].map((row, j) => {
    if (j !== i) return row;
    const o = { ...row, [k]: v, ...(k === 'min' ? { auto: false } : {}) };
    // 20-11-2026: a dismantle defect (Defect Tag "Dismantle" list: tub leak, drain assy leak, base breakage …) ticks "Dismantled" by itself
    if (key !== 'losses' && key !== 'stops') {
      if (k === 'reason') Object.assign(o, applyDefect(row, v, key));
      if (['cat', 'cause', 'action'].includes(k) && row.hintAuto?.[k]) { o.hintAuto = { ...row.hintAuto }; delete o.hintAuto[k]; }   // written by the user now
      if (k === 'qty' && row.disAuto && Number(v) > 0) o.dismantle = String(v);
      if (k === 'dismantle') o.disAuto = false;
    }
    return o;
  }) }));
  // the scans of the hour: how long each model ran → the time it lost against its std time
  const [ownScans, setScans] = useState(null);
  const [ownFail, setScanFail] = useState(false);
  // 23-11-2026: the page reads the scans of the day once and hands this hour's over; read here only when it has none
  const scans = given !== undefined ? given : ownScans;
  const scanFail = given !== undefined ? givenFail : ownFail;
  useEffect(() => {
    if (given !== undefined) return undefined;
    if (!r.qty || r.extra) { setScans([]); return undefined; }
    const c = new AbortController();
    api.hourDetail(date, r.hour, { line: L.line }, { signal: c.signal })
      .then((d) => setScans(Array.isArray(d?.scans) ? d.scans : []))
      .catch((x) => { if (x?.name !== 'AbortError') { setScans([]); setScanFail(true); } });
    return () => c.abort();
  }, [date, r.hour, L.line, r.qty, r.extra, given !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const mt = useMemo(() => (r.extra || !r.qty || scans == null ? null
    : modelTimeOfHour({ hour: r.hour, scans, models: r.models, stops: f.stops, totalMin: r.totalMin, nowMin, shift: L.shift, endAtLastScan: r.hour === lastScanHour })), [r, scans, f.stops, nowMin, L.shift, lastScanHour]);
  mtRef.current = mt;
  /** minutes of loss still to explain for a model (its lost time − the rows already entered for it, but row `skip`) */
  const leftOf = (model, skip = -1) => {
    const t = mt?.rows.find((x) => x.model === model); if (!t || t.lostMin == null) return null;
    const done = f.losses.reduce((a, row, j) => a + (j !== skip && row.model === model ? Number(row.min) || 0 : 0), 0);
    return Math.max(0, Math.round(t.lostMin - done));
  };
  // picking the model of an loss row fills its minutes with what that model still has to explain
  const pickLossModel = (i, model) => edit((x) => ({ ...x, losses: x.losses.map((row, j) => {
    if (j !== i) return row;
    const left = model ? leftOf(model, i) : null;
    return { ...row, model, auto: false, min: (row.min === '' || row.min == null) && left > 0 ? String(left) : row.min };
  }) }));
  // every model with time left: its row gets the minutes (a new row when it has none without minutes)
  const fillAll = () => edit((x) => {
    let losses = [...x.losses];
    for (const t of mt?.rows || []) {
      const done = losses.reduce((a, row) => a + (row.model === t.model ? Number(row.min) || 0 : 0), 0);
      const left = t.lostMin == null ? 0 : Math.round(t.lostMin - done);
      if (left < 1) continue;
      const i = losses.findIndex((row) => row.model === t.model && !(Number(row.min) > 0));
      if (i >= 0) losses = losses.map((row, j) => (j === i ? { ...row, min: String(left) } : row));
      else losses = [...losses, { model: t.model, reason: '', min: String(left) }];
    }
    return { ...x, losses };
  });
  // a new quality row takes the station of the row above (the same station usually finds several defects)
  const addRow = (key, num) => edit((x) => ({ ...x, [key]: [...x[key], blank(num, x[key][x[key].length - 1]?.station || '')] }));
  const delRow = (key, i) => edit((x) => ({ ...x, [key]: x[key].filter((_, j) => j !== i) }));
  const sumOf = (key, num) => f[key].reduce((a, s) => a + (Number(s[num]) || 0), 0);
  const stopSum = sumOf('stops', 'min'), lossSum = sumOf('losses', 'min'), rejSum = sumOf('rejects', 'qty'), rwSum = sumOf('rework', 'qty');
  const limit = r.totalMin || r.fullMin;
  const over = stopSum + lossSum > limit;
  const ran = Math.max(0, limit - stopSum - lossSum);
  // no click on "Fill all models" — an hour with no loss saved yet comes FILLED: as soon as the scans
  // are read, every model's minutes to explain (its lost time against its std) go into its row, and an hour without production
  // gets its whole run time; the line only chooses the reasons. Such a row ("auto") follows the hour — a planned stop added,
  // the running hour going on — until its minutes are typed by hand; a removed row stays removed. Nothing is saved by itself.
  const autoOn = !QM && !start.losses.length && !r.extra && !autoNo;   // 23-11-2026: an hour with No loss by itself is not filled
  useEffect(() => {   // …and rows filled before it was known (scans first, target after) go away again — never typed ones
    if (!autoNo) return;
    setF((x) => { const keep = x.losses.filter((row) => !row.auto || row.reason); return keep.length === x.losses.length ? x : { ...x, losses: keep }; });
  }, [autoNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoDone = React.useRef(false);
  useEffect(() => {
    if (!autoOn || (!idle && !mt)) return;   // a saved hour keeps its rows · the scans are not read yet
    const stopsOf = (x) => x.stops.reduce((a, s0) => a + (Number(s0.min) || 0), 0);
    setF((x) => {
      const losses = x.losses;
      if (!autoDone.current) {
        autoDone.current = true;
        if (losses.some((row) => Number(row.min) > 0)) return x;   // typed before the scans came: left as it is
        if (idle) {
          const left = Math.round(limit - stopsOf(x));
          if (!(left >= 1)) return x;
          const i = losses.findIndex((row) => !(Number(row.min) > 0));
          return { ...x, losses: i >= 0 ? losses.map((row, j) => (j === i ? { ...row, min: String(left), auto: true } : row)) : [...losses, { model: '', reason: '', min: String(left), auto: true }] };
        }
        let out = [...losses];
        for (const t of mt.rows) {
          const left = t.lostMin == null ? 0 : Math.round(t.lostMin);
          if (left < 1) continue;
          const i = out.findIndex((row) => row.model === t.model && !(Number(row.min) > 0));
          out = i >= 0 ? out.map((row, j) => (j === i ? { ...row, min: String(left), auto: true } : row)) : [...out, { model: t.model, reason: '', min: String(left), auto: true }];
        }
        // 23-11-2026: only the models that lost time keep a row — the empty rows of the others are left out (less to look at)
        if (out.some((row) => Number(row.min) > 0)) out = out.filter((row) => Number(row.min) > 0 || row.reason);
        return { ...x, losses: out };
      }
      // later: the rows filled by themselves follow the hour (the rows typed by hand stay as typed)
      let changed = false;
      const out = losses.map((row, i) => {
        if (!row.auto) return row;
        let want;
        if (idle) want = Math.round(limit - stopsOf(x) - losses.reduce((a, o, j) => a + (j !== i ? Number(o.min) || 0 : 0), 0));
        else {
          const t = mt?.rows.find((y) => y.model === row.model);
          if (!t || t.lostMin == null) return row;
          want = Math.round(t.lostMin - losses.reduce((a, o, j) => a + (j !== i && o.model === row.model ? Number(o.min) || 0 : 0), 0));
        }
        const v = want >= 1 ? String(want) : '';
        if (v === String(row.min ?? '')) return row;
        changed = true;
        return { ...row, min: v };
      });
      return changed ? { ...x, losses: out } : x;
    });
  }, [mt, idle, limit, autoOn, f.stops]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoRows = f.losses.filter((row) => row.auto && Number(row.min) > 0).length;
  const copyPrev = () => { if (!prev) return; const p = prev.e; const cp = (a, num) => a.map((x) => ({ model: models.includes(x.model) ? x.model : (one || x.model), reason: x.reason, [num]: x[num] })); const pl = cp([...p.stops, ...p.losses], 'min'); edit((x) => ({ ...x, losses: pl.length ? pl : x.losses })); };
  const quick = (key, num, reason, item = null) => edit((x) => {
    const withR = (row) => ({ ...row, reason, ...(item?.manual ? { manual: true, dept: item.dept || '' } : {}), ...(num === 'qty' ? applyDefect(row, reason, key) : {}) });
    const rows = x[key]; const i = rows.findIndex((row) => !row.reason);
    if (i >= 0) return { ...x, [key]: rows.map((row, j) => (j === i ? withR(row) : row)) };
    return { ...x, [key]: [...rows, withR(blank(num, rows[rows.length - 1]?.station || ''))] };
  });
  const missing = KINDS.some(({ key, num }) => f[key].some((row) => Number(row[num]) > 0 && !String(row.reason || '').trim()));
  // departments for a reason typed by hand: those of the reason lists
  const DEPTS = [...new Set(['stop', 'loss', 'reject', 'rework'].flatMap((k) => (reasons[k] || []).map((x) => x.dept)).filter(Boolean))].sort();
  const noModel = !QM && !idle && f.losses.some((row) => Number(row.min) > 0 && !row.model && !row.fromStop);
  const noStation = ['rejects', 'rework'].some((key) => f[key].some((row) => Number(row.qty) > 0 && !row.station));
  const tooMany = ['rejects', 'rework'].some((key) => f[key].some((row) => Number(row.qty) > Math.max(r.qty, 0) && r.qty > 0));
  const byModel = useMemo(() => {
    const m = new Map();
    for (const { key, num } of KINDS) for (const row of f[key]) {
      const v = Number(row[num]) || 0; if (!v) continue;
      const k = row.model || 'Model not given'; const o = m.get(k) || { min: 0, loss: 0, rej: 0, rw: 0 };
      o[{ stops: 'min', losses: 'loss', rejects: 'rej', rework: 'rw' }[key]] += v; m.set(k, o);
    }
    return [...m.entries()];
  }, [f]);
  const save = async (goNext = false, noLossNow = false, noQNow = false) => {
    setErr('');
    if (over) { setErr(`Loss ${fmtMin(stopSum + lossSum)} — the hour has only ${fmtMin(limit)}.`); return; }
    if (missing) { setErr(f.losses.some((row) => row.auto && Number(row.min) > 0 && !row.reason) ? 'Choose the reason of every loss row — or remove the rows that are not a loss.' : 'Choose a reason for every row with a number.'); return; }
    if (noModel) { setErr('Choose the model of every loss row.'); return; }
    if (noStation) { setErr('Choose the quality station (LQC, FQC, leak test …) of every rejection / rework row.'); return; }
    if (['rejects', 'rework'].some((key) => f[key].some((row) => Number(row.dismantle) > Number(row.qty)))) { setErr('Dismantled pieces cannot be more than the rejected / reworked pieces of the row.'); return; }
    const pick = (key, num) => f[key].filter((row) => Number(row[num]) > 0).map((row) => ({ ...(num === 'qty' ? { station: row.station || '' } : {}), model: row.model, reason: row.manual ? row.reason.trim() : row.reason, ...(row.manual ? { dept: String(row.dept || '').trim() } : num === 'qty' ? { dept: qDept(key, row) || String(row.dept || '').trim() } : !deptOf(reasons, key === 'stops' ? 'stop' : 'loss', row.reason) && String(row.dept || '').trim() ? { dept: String(row.dept).trim() } : {}), [num]: Number(row[num]), ...(key === 'losses' && String(row.part || '').trim() ? { part: String(row.part).trim() } : {}),
      // 20-11-2026: quality row — category, root cause, action, pieces dismantled
      ...(num === 'qty' ? { ...(row.cat ? { cat: row.cat } : {}), ...(String(row.cause || '').trim() ? { cause: String(row.cause).trim() } : {}), ...(String(row.action || '').trim() ? { action: String(row.action).trim() } : {}), ...(Number(row.dismantle) > 0 ? { dismantle: Math.min(Number(row.qty), Math.round(Number(row.dismantle))) } : {}) } : {}) }));
    setBusy(true);
    try {
      await api.saveOle([{ date, line: Number(L.line), hour: r.hour, stops: pick('stops', 'min'), losses: pick('losses', 'min'), rejects: pick('rejects', 'qty'), rework: pick('rework', 'qty'), note: f.note,
        // 20-11-2026: "No loss" — the line checked the hour (kept on a later save while no loss is written)
        ...(!QM && stopSum + lossSum === 0 && (noLossNow || start0.noLoss) ? { noLoss: true } : {}),
        // 23-11-2026: "No defects" — the quality of the hour was checked and nothing was found
        ...(mode !== 'loss' && rejSum + rwSum === 0 && (noQNow || start0.noQ) ? { noQ: true } : {}),
        // 23-11-2026: only this page's part of the hour is written; the other page's part stays as the server has it
        // (two people on Loss entry and Quality entry never wipe each other's rows)
        part: mode === 'loss' ? 'loss' : QM ? 'quality' : 'both' }]);
      // 20-11-2026: the reasons / defects just saved come first next time (Recent), also one written by hand
      try {
        for (const { key, kind, num } of KINDS) {
          const by = new Map();
          for (const row of f[key].filter((o) => Number(o[num]) > 0 && String(o.reason || '').trim())) {
            const sc = recentScope(kind, L.line, num === 'qty' ? row.station : '');
            by.set(sc, [...(by.get(sc) || []), { reason: row.reason.trim(), dept: row.manual ? row.dept : (num === 'qty' ? qDept(key, row) : deptOf(reasons, kind, row.reason)), manual: !!row.manual }]);
          }
          for (const [sc, items] of by) bumpRecent(sc, items.reverse());
        }
      } catch { /* storage blocked: nothing kept */ }
      setTouched(false); setBusy(false);
      onSaved(goNext);
    } catch (x) { setErr(`Could not save: ${x.message}`); setBusy(false); }
  };
  // the stations of this line that are switched on, in the order of the line (admin's setup)
  keyRef.current = (goNext) => { if (!busy) save(goNext); };
  const stations = stationsFor(reasons.station || [], L.line);
  const stOf = (name) => stations.find((x) => x.reason === name);
  // 20-11-2026: a station without its own defect list gets the defects of its stage from the plant's sheets
  // (Book1 "Hrly. Rework data" + PAD Defect Tag): HVIR → No power, Spin motor not work …; Leakage → Tub leak, Drain cap leak …
  const defectsAt = (kind, stName) => {
    const st = stOf(stName); const all = reasons[kind] || [];
    const own = st?.defects?.length ? st.defects : (stName ? stationDefects(stName, st?.code) : null);
    if (!own?.length) return all;
    if (st?.defects?.length) return all.filter((x) => own.includes(x.reason)).concat(own.filter((d) => !all.some((x) => x.reason === d)).map((d) => ({ reason: d, dept: st.dept })));
    // the stage list keeps its order (most frequent first); a defect also in the admin's list keeps its department
    return own.map((d) => all.find((x) => x.reason.toLowerCase() === d.toLowerCase()) || { reason: d, dept: st?.dept || 'Prod' });
  };
  // the department of a quality row's defect (a station / plant-sheet defect is not in the admin's list: the server keeps the one sent)
  const qDept = (key, row) => (defectsAt(key === 'rejects' ? 'reject' : 'rework', row.station).find((x) => x.reason === row.reason) || {}).dept || '';
  const fld = `${inp} h-10 text-fs-15`;
  const MINS = [5, 10, 15, 20, 30, 60];
  const part = ({ key, kind, title, num, unit, add, hint, station }) => {
    const c = PART[key];
    const total = sumOf(key, num);
    const filled = f[key].filter((row) => Number(row[num]) > 0).length;
    // one line per entry, like a table: (station) · model · reason / defect · amount · department · remove
    const cols = station ? 'le-row-q' : 'le-row-time';
    const cell = `${inp} h-10 text-fs-15`;   // 23-11-2026: compact rows (one screen)
    const isOpen = openParts.has(key) || f[key].length > 0;   // a part with rows stays open
    return (
      <fieldset key={key} className={`min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm ${c.ring}`} aria-label={title}>
        <legend className="sr-only">{title}</legend>
        <button type="button" onClick={() => toggle(key)} aria-expanded={isOpen} aria-label={title} className={`flex w-full items-center gap-2 px-4 py-1.5 text-left ${isOpen ? 'border-b' : ''} ${c.head} ${c.ring}`}>
          <ChevronRight size={18} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
          <i className={`h-3 w-3 shrink-0 rounded-full ${c.dot}`} aria-hidden />
          <span className="text-fs-16 font-extrabold">{title}</span>
          {filled > 0 && <span className="rounded-full bg-white px-2 py-0.5 text-fs-12 font-bold text-slate-600 ring-1 ring-black/5">{filled} {filled === 1 ? 'entry' : 'entries'}</span>}
          <span className={`ml-auto shrink-0 font-mono text-fs-18 font-extrabold ${(key === 'stops' || key === 'losses') && over ? 'text-red-700' : ''}`}>{total} <span className="text-fs-13 font-semibold opacity-70">{unit}</span></span>
        </button>
        {isOpen && (<>
        <div className="px-3 pb-2 pt-1.5">
          {em.quickAdd !== false && <div className="lp-le-quick flex flex-wrap items-center gap-1.5" role="group" aria-label={`${title} quick reasons`}>
            <span className="mr-1 text-fs-13 font-bold text-slate-500">Quick add</span>
            {(() => {
              // 20-11-2026: the ones used lately on this line (and station) first, marked ↺; then the list
              const lastSt = station && f[key].length ? f[key][f[key].length - 1].station : '';
              const list = station && lastSt ? defectsAt(kind, lastSt) : reasons[kind];
              const { recent, rest } = withRecent(list, recentOf(recentScope(kind, L.line, lastSt)), 6);
              return [...recent, ...rest].slice(0, station && lastSt ? 12 : 8).map((x) => (
                <button key={x.reason} type="button" onClick={() => quick(key, num, x.reason, x)} title={x.recent ? 'Used lately on this line' : undefined}
                  className={`rounded-md border px-2.5 py-1 text-fs-14 font-semibold transition active:scale-95 ${x.recent ? 'border-blue-300 bg-blue-50 text-blue-900 hover:border-blue-500' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800'}`}>{x.recent ? '↺ ' : ''}{x.reason}</button>
              ));
            })()}
          </div>}
          {key === 'losses' && mt && <LostVsStd mt={mt} leftOf={leftOf} fillAll={fillAll} scanFail={scanFail} autoRows={autoRows} />}
          {key === 'losses' && idle && !r.extra && limit > 0 && (() => {
            // no model ran in this hour: the whole run time is lost — show it and fill it with one tap
            const left = Math.max(0, Math.round(limit - stopSum - lossSum));
            const fillIdle = () => edit((x) => {
              const i = x.losses.findIndex((row) => !(Number(row.min) > 0));
              if (i >= 0) return { ...x, losses: x.losses.map((row, j) => (j === i ? { ...row, min: String(left) } : row)) };
              return { ...x, losses: [...x.losses, { model: '', reason: '', min: String(left) }] };
            });
            return (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2" aria-label="Time lost in this hour">
                <span className="text-fs-14 font-bold text-red-900">No production in this hour</span>
                <span className="text-fs-14 text-slate-700">Lost <b className="font-mono text-red-700">{Math.round(limit - stopSum)}′</b> · to explain <b className={`font-mono ${left > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{left}′</b></span>
                {left > 0 && <button type="button" onClick={fillIdle} className="ml-auto rounded-md bg-red-600 px-3 py-1 text-fs-13 font-bold text-white hover:bg-red-700">Fill {left} min</button>}
                {autoRows > 0 && <span className="basis-full text-fs-12 font-semibold text-sky-900" data-testid="auto-filled">Filled automatically — please select the reason</span>}
              </div>
            );
          })()}
          {f[key].length === 0 ? null : (   /* nothing entered: only Quick add and "Add …" (keeps the dialog short) */
            <div className="mt-2">
              <div className={`hidden gap-2 border-b border-slate-200 pb-1 text-fs-13 font-bold text-slate-500 sm:grid ${cols}`} aria-hidden>
                {station && <span>Station</span>}<span>Model</span><span>{station ? 'Defect' : 'Reason'}</span><span className="text-center">{unit === 'min' ? 'Minutes' : 'Qty'}</span><span>Department</span><span />
              </div>
              <div className="divide-y divide-slate-100">
                {f[key].map((row, i) => {
                  const masterDept = row.reason ? (station ? qDept(key, row) : deptOf(reasons, kind, row.reason)) || '' : '';
                  return (
                    <div key={i} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2 sm:mb-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
                    <div className={`grid grid-cols-6 items-center gap-2 sm:py-1 ${cols}`}>
                      {station && (
                        <select aria-label={`${title} ${i + 1} station`} value={row.station || ''} onChange={(e) => setRow(key, i, 'station', e.target.value)} className={`${cell} col-span-6 sm:col-span-1 ${Number(row[num]) > 0 && !row.station ? 'border-red-400' : ''}`}>
                          <option value="">Station…</option>
                          {stations.filter((x) => key !== 'rework' || x.rework).map((x) => <option key={x.reason} value={x.reason} title={x.reason}>{x.code ? `${x.code} — ${x.reason}` : x.reason}</option>)}
                          {row.station && !stations.some((x) => x.reason === row.station) && <option value={row.station}>{row.station}</option>}
                        </select>
                      )}
                      <select aria-label={`${title} ${i + 1} model`} value={row.model} onChange={(e) => (key === 'losses' ? pickLossModel(i, e.target.value) : setRow(key, i, 'model', e.target.value))} className={`${cell} col-span-6 sm:col-span-1 ${key === 'losses' && !idle && Number(row.min) > 0 && !row.model ? 'border-red-400' : ''}`}>
                        <option value="">{idle ? 'No model ran' : 'Model…'}</option>
                        {[...new Set([...pickList, ...(row.model && !pickList.includes(row.model) ? [row.model] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {row.manual ? (
                        // a reason that is not in the list, typed here (kept as written, with the department chosen beside it)
                        <div className="col-span-4 flex min-w-0 items-center gap-1 sm:col-span-1">
                          <input aria-label={`${title} ${i + 1} reason`} value={row.reason} maxLength={60} autoFocus placeholder={station ? 'Type the defect' : 'Type the reason'}
                            onChange={(e) => setRow(key, i, 'reason', e.target.value)} className={`${cell} min-w-0 flex-1 ${Number(row[num]) > 0 && !row.reason.trim() ? 'border-red-400' : 'border-violet-300 bg-violet-50/40'}`} />
                          <button type="button" title="Back to the list" aria-label={`Back to the list (${title.toLowerCase()} ${i + 1})`} onClick={() => edit((x) => ({ ...x, [key]: x[key].map((o, j) => (j === i ? { ...o, manual: false, reason: '', dept: '' } : o)) }))}
                            className="grid h-9 w-8 shrink-0 place-items-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-100">☰</button>
                        </div>
                      ) : (
                      <select aria-label={`${title} ${i + 1} reason`} value={row.reason}
                        // a mouse / touch opens the reason list in the side drawer (the keyboard keeps the plain list)
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const list = station ? defectsAt(kind, row.station) : reasons[kind];
                          const recent = withRecent(list, recentOf(recentScope(kind, L.line, station ? row.station : ''))).recent;
                          setRp({ title: `${title} ${i + 1} — ${station ? 'defect' : 'reason'}`, sub: station ? shortSt(row.station) : `${L.name} · ${p2(r.hour)}:00`, list, recent, grouped: !station && kind === 'loss', now: row.reason, newLabel: station ? 'Write a new defect…' : 'Write a new reason…',
                            pick: (v, item) => (v === '__new' ? edit((x) => ({ ...x, [key]: x[key].map((o, j) => (j === i ? { ...o, manual: true, reason: '', dept: '' } : o)) }))
                              : item?.manual ? edit((x) => ({ ...x, [key]: x[key].map((o, j) => (j === i ? { ...o, manual: true, reason: v, dept: item.dept || '' } : o)) }))
                                : setRow(key, i, 'reason', v)) });
                        }}
                        onChange={(e) => (e.target.value === '__new' ? edit((x) => ({ ...x, [key]: x[key].map((o, j) => (j === i ? { ...o, manual: true, reason: '', dept: '' } : o)) })) : setRow(key, i, 'reason', e.target.value))}
                        className={`${cell} col-span-4 sm:col-span-1 ${Number(row[num]) > 0 && !row.reason ? 'border-red-400' : ''}`}>
                        <option value="">{station ? 'Defect…' : 'Reason…'}</option>
                        {station || kind !== 'loss' ? (station ? defectsAt(kind, row.station) : reasons[kind]).map((x) => <option key={x.reason} value={x.reason}>{x.dept ? `${x.reason} — ${x.dept}` : x.reason}</option>)
                          // the long loss list (the HPR reasons) grouped by department
                          : [...new Set(reasons.loss.map((x) => x.dept))].map((dp) => <optgroup key={dp} label={dp}>{reasons.loss.filter((x) => x.dept === dp).map((x) => <option key={x.reason} value={x.reason}>{x.dept ? `${x.reason} — ${x.dept}` : x.reason}</option>)}</optgroup>)}
                        {row.reason && !(station ? defectsAt(kind, row.station) : reasons[kind]).some((x) => x.reason === row.reason) && <option value={row.reason}>{row.reason}</option>}
                        <option value="__new">✎ {station ? 'Write a new defect…' : 'Write a new reason…'}</option>
                      </select>
                      )}
                      <input type="number" inputMode="numeric" min="0" max={num === 'min' ? limit : undefined} list={num === 'min' ? 'ole-minutes' : undefined} aria-label={`${title} ${i + 1} ${unit}`} placeholder="0" value={row[num]} onChange={(e) => setRow(key, i, num, e.target.value)}
                        title={row.auto ? 'Filled automatically from the scans — type to change it' : undefined} data-auto={row.auto && Number(row[num]) > 0 ? '1' : undefined}
                        style={row.auto && Number(row[num]) > 0 ? { background: '#f0f9ff', borderColor: '#38bdf8', color: '#0c4a6e' } : undefined}
                        className={`${cell} col-span-2 text-center font-mono text-fs-16 font-extrabold sm:col-span-1`} />
                      {row.manual && row.deptNew ? (
                        // a department that is not in the list, typed here (like a new reason)
                        <div className="col-span-5 flex min-w-0 items-center gap-1 sm:col-span-1">
                          <input aria-label={`${title} ${i + 1} department`} value={row.dept || ''} maxLength={40} autoFocus placeholder="Type the department"
                            onChange={(e) => setRow(key, i, 'dept', e.target.value)} className={`${cell} min-w-0 flex-1 text-fs-13 border-violet-300 bg-violet-50/40`} />
                          <button type="button" title="Back to the list" aria-label={`Back to the department list (${title.toLowerCase()} ${i + 1})`} onClick={() => edit((x) => ({ ...x, [key]: x[key].map((o, j) => (j === i ? { ...o, deptNew: false, dept: '' } : o)) }))}
                            className="grid h-9 w-8 shrink-0 place-items-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-100">☰</button>
                        </div>
                      ) : row.manual ? (
                        <select aria-label={`${title} ${i + 1} department`} value={row.dept || ''} title="Department responsible for this reason" className={`${cell} col-span-5 text-fs-13 sm:col-span-1`}
                          onChange={(e) => (e.target.value === '__new' ? edit((x) => ({ ...x, [key]: x[key].map((o, j) => (j === i ? { ...o, deptNew: true, dept: '' } : o)) })) : setRow(key, i, 'dept', e.target.value))}>
                          <option value="">Department…</option>
                          {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                          {row.dept && !DEPTS.includes(row.dept) && <option value={row.dept}>{row.dept}</option>}
                          <option value="__new">✎ Write a new department…</option>
                        </select>
                      ) : !row.reason ? (
                      <span className="col-span-5 text-fs-13 text-slate-400 sm:col-span-1">—</span>
                      ) : masterDept ? (
                      <span className="col-span-5 break-words text-fs-13 sm:col-span-1" title="Responsible department (from the reason master)"><span aria-label={`${title} ${i + 1} department`} className="font-semibold text-slate-700">{masterDept}</span></span>
                      ) : (
                      // 25-11-2026: the reason has no department in the master → write it here, with the plant's departments suggested
                      <input aria-label={`${title} ${i + 1} department`} value={row.dept || ''} maxLength={40} list="le-depts" placeholder="Department…"
                        title="This reason has no department in the master — pick one from the list or write it"
                        onChange={(e) => setRow(key, i, 'dept', e.target.value)}
                        className={`${cell} col-span-5 text-fs-13 sm:col-span-1 ${row.reason && Number(row[num]) > 0 && !String(row.dept || '').trim() ? 'border-amber-400 bg-amber-50/50' : ''}`} />
                      )}
                      <button type="button" onClick={() => delRow(key, i)} aria-label={`Remove ${title} ${i + 1}`} className="col-span-1 flex h-9 w-9 items-center justify-center justify-self-end rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700"><Trash2 size={16} /></button>
                    </div>
                    {station && (
                      // 20-11-2026: category, root cause and action of the defect, and whether the machine was dismantled
                      <div className="grid grid-cols-6 items-center gap-2 pb-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto]" aria-label={`${title} ${i + 1} details`}>
                        <select aria-label={`${title} ${i + 1} category`} value={row.cat || ''} onChange={(e) => setRow(key, i, 'cat', e.target.value)} className={`${cell} col-span-3 text-fs-13 sm:col-span-1 ${row.cat ? '' : 'text-slate-500'}`} title="Category of the defect">
                          <option value="">Category…</option>
                          {QCATS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <label className={`col-span-3 flex h-11 cursor-pointer items-center gap-2 rounded-md border px-2 text-fs-13 font-bold sm:order-last sm:col-span-1 ${Number(row.dismantle) > 0 ? 'border-red-400 bg-red-50 text-red-800' : 'border-slate-300 bg-white text-slate-700'}`} title="The machine was opened up (dismantled) for this defect">
                          <input type="checkbox" className="h-4 w-4 accent-red-600" aria-label={`${title} ${i + 1} dismantled`} checked={Number(row.dismantle) > 0}
                            onChange={(e) => setRow(key, i, 'dismantle', e.target.checked ? String(Math.max(1, Number(row.qty) || 1)) : '')} />
                          Dismantled
                          {Number(row.dismantle) > 0 && Number(row.qty) > 1 && (
                            <input type="number" inputMode="numeric" min="1" max={Number(row.qty) || undefined} aria-label={`${title} ${i + 1} dismantled pieces`} value={row.dismantle}
                              onChange={(e) => setRow(key, i, 'dismantle', e.target.value)} className={`h-8 w-14 rounded border px-1 text-center font-mono ${Number(row.dismantle) > Number(row.qty) ? 'border-red-500 bg-red-100' : 'border-slate-300 bg-white'}`} />
                          )}
                        </label>
                        <input aria-label={`${title} ${i + 1} root cause`} placeholder="Root cause" maxLength={200} value={row.cause || ''} onChange={(e) => setRow(key, i, 'cause', e.target.value)} className={`${cell} col-span-6 text-fs-13 sm:col-span-1`} />
                        <input aria-label={`${title} ${i + 1} action`} placeholder="Action taken" maxLength={200} value={row.action || ''} onChange={(e) => setRow(key, i, 'action', e.target.value)} className={`${cell} col-span-6 text-fs-13 sm:col-span-1`} />
                      </div>
                    )}
                    {key === 'losses' && row.reason && (
                      <div className="pb-2 sm:pl-1"><input aria-label={`${title} ${i + 1} part involved`} placeholder="Part involved (optional) — e.g. Control table, Motor" maxLength={60} value={row.part || ''} onChange={(e) => setRow(key, i, 'part', e.target.value)} className={`${cell} w-full sm:max-w-md text-fs-13`} /></div>
                    )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => addRow(key, num)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-fs-14 font-bold text-blue-700 hover:bg-blue-50"><Plus size={16} aria-hidden /> {add}</button>
            {/* 25-11-2026: the rework of one model in all the hours it ran, at once (Quality entry → rework grid) */}
            {(key === 'rework' || key === 'rejects') && onManyHours && (
              <button type="button" data-testid={key === 'rework' ? 'rw-many' : 'rj-many'} title={`Fill the ${key === 'rework' ? 'rework' : 'rejection'} of one model in all the hours it ran, at once`} onClick={() => onManyHours((f[key].find((x) => x.model) || {}).model || (r.models || []).slice().sort((a, b) => (b.quantity || 0) - (a.quantity || 0))[0]?.model || '', key)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#1F3864] bg-white px-3 text-fs-14 font-bold text-[#1F3864] hover:bg-[#EEF3FB]"><ListChecks size={15} aria-hidden /> Many hours · model-wise</button>
            )}
          </div>
        </div>
        </>)}
      </fieldset>
    );
  };
  const timeParts = QM || r.extra ? [] : KINDS.filter((k) => k.key === 'losses'), qualityParts = QM || mode === 'both' ? KINDS.filter((k) => k.num === 'qty' && (k.key !== 'rejects' || start0.rejects.length > 0)) : [];   // 20-11-2026: no separate Rejection part (Rework + Dismantled); an hour that already has rejection rows keeps it
  const body = (
    // as a window: the MES detail drawer (glides in from the right, blurred backdrop, light MES header)
    <div className={inline ? 'min-w-0' : 'mes-drawer-overlay mes-drawer-overlay-in fixed inset-0 z-50'} data-backdrop={inline ? undefined : 'blur'} onClick={inline ? undefined : onClose}>
      <div role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : 'true'} aria-label={`Fill ${L.name} ${p2(r.hour)}:00`} onClick={(e) => e.stopPropagation()}
        // 25-11-2026: on the page the form takes the height it needs and the PAGE scrolls (a fixed height cut the rows off on
        // smaller screens / zoom); its Save bar stays at the bottom of the screen
        data-method={inline ? undefined : 'right'} style={inline ? undefined : { '--mes-drawer-w': '62vw' }}
        ref={inline ? fitRef : undefined}
        className={inline ? 'flex w-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm' : 'mes-drawer mes-drawer-in mes-drawer-light'}>
        {/* head: which hour, its minutes and pieces, the time bar */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 sm:px-5">
          {/* 24-11-2026: three columns — the hour and its 4 numbers | the model table (full width) | copy / close */}
          <div className="lp-le-head">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h2 className="text-fs-16 font-extrabold text-slate-900">{L.name} · {p2(r.hour)}:00–{p2(r.hour + 1)}:00</h2>
                <span className="rounded-md bg-slate-900 px-2 py-0.5 text-fs-13 font-bold text-white" title="Working minutes of this hour">{fmtMin(limit)}</span>
                {!inline && <span className="text-fs-14 font-semibold text-slate-600">{dmy(date)}</span>}
                {r.extra && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-fs-12 font-bold text-amber-800">Extra hour</span>}
                {r.breakMin > 0 && offLabels(L.shift, r.hour).map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-fs-12 font-bold text-slate-600">{t} out</span>)}
              </div>
              {!(!QM && target > 0 && r.models.filter((m) => Number(m.quantity) > 0).length > 1) && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-fs-14">
                {(!QM && target > 0 && r.models.filter((m) => Number(m.quantity) > 0).length > 1) ? null /* the model table below lists them */ : r.models.length ? r.models.map((m) => <span key={m.mmId} className={chip}>{m.model} · {m.quantity}{!m.std && <span className="ml-1.5 rounded-[2px] bg-[#FFEB9C] px-1 text-fs-11 font-bold text-[#9C5700]" title="This model has no cycle time in the model master: it gets no target">No cycle time</span>}</span>) : <span className="font-semibold text-amber-800">No model ran</span>}
              </div>}
              {/* 24-11-2026: the hour's numbers under its title; the model table beside them (no empty space under the boxes) */}
            <div className="mt-1 flex flex-wrap gap-1" aria-label="This hour so far">
              {(QM ? [['Qty', nf(r.qty), 'bg-slate-900', false], ...(start0.rejects.length || rejSum ? [['Rejected', rejSum, 'bg-amber-500', false]] : []), ['Rework', rwSum, 'bg-sky-500', false], ['Dismantled', f.rework.reduce((a, x) => a + (Number(x.dismantle) || 0), 0), 'bg-red-500', false]]
                : [['Target', target != null ? nf(target) : r.models.length && r.models.every((m) => !m.std) ? 'No cycle time' : '—', 'bg-blue-600', false], ['Qty', nf(r.qty), 'bg-slate-900', false], ['Loss', fmtTick(lossSum), 'bg-red-600', over], ['Run', fmtTick(ran), 'bg-emerald-500', false]]).map(([k, v, dot, bad]) => (
                // 23-11-2026: each box as wide as its number (not a quarter of the screen each)
                <div key={k} className={`flex items-baseline gap-1.5 rounded-lg border px-2 py-0 ${bad ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`} style={{ minWidth: 80 }}>
                  <span className="flex items-center gap-1 whitespace-nowrap text-fs-12 font-bold text-slate-600"><i className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />{k}</span>
                  <span className={`ml-auto whitespace-nowrap font-mono text-fs-16 font-extrabold leading-tight ${bad ? 'text-red-700' : 'text-slate-900'}`}>{v}</span>
                </div>
              ))}
            </div>
            {over && <div className="mt-1 text-fs-12 font-semibold text-red-700">Loss {fmtMin(lossSum)} — the hour has only {fmtMin(limit)}</div>}
            </div>
            {/* 20-11-2026: model-wise target vs actual of the hour; 21-11-2026: each model's target = the time it ran (scans) ÷ its std cycle */}
            {!QM && target > 0 && r.models.filter((m) => Number(m.quantity) > 0).length > 1 ? (() => {
              const tm = (m) => (mt && !mt.estimated ? mt.rows.find((x) => String(x.mmId) === String(m.mmId))?.runMin ?? null : null);   // 21-11-2026: target by the time it ran
              const ms = splitHourTarget(target, r.models.filter((m) => Number(m.quantity) > 0).map((m) => ({ model: m.model || `#${m.mmId}`, qty: Number(m.quantity), cycle: m.std || dayCyc || null, avg: !m.std && !!dayCyc, runMin: tm(m) })));   // 25-11-2026: no cycle time → the line's average cycle of the day
              return (
                <div className="lp-le-models min-w-0 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-fs-12 tabular-nums" aria-label="Model-wise target vs actual">
                  <thead><tr className="bg-slate-50 text-left text-fs-11 font-bold uppercase text-slate-500"><th className="py-0.5">Model</th><th className="text-right" title="Minutes the model ran in this hour (from the scans)">Time</th><th className="text-right">Target</th><th className="text-right">Actual</th><th className="text-right">Short/Excess</th></tr></thead>
                  <tbody>{ms.map((m) => { const d = m.qty - (m.target || 0); return (
                    <tr key={m.model} className="border-t border-slate-100"><td className="py-0 font-mono font-semibold text-slate-800" title={m.avg ? `${m.model} — no cycle time in the model master: the line's average cycle of the day is used` : m.model}>{m.model}{m.avg && <span className="ml-1 rounded-[2px] bg-[#FFEB9C] px-1 text-fs-10 font-bold text-[#9C5700]">avg CT</span>}</td>
                      <td className="text-right font-mono text-slate-700">{(() => { const t = mt?.rows.find((x) => x.model === m.model); return t?.runMin != null ? fmtMin(t.runMin) : scans == null ? '…' : '—'; })()}</td><td className="text-right font-mono">{m.target == null ? <span className="text-fs-12 font-bold text-[#9C5700]" title="No cycle time in the model master: no target">No target</span> : nf(m.target)}</td><td className="text-right font-mono font-bold">{nf(m.qty)}</td>
                      <td className={`text-right font-mono font-bold ${m.target == null ? 'text-slate-400' : d < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{m.target == null ? '—' : d < 0 ? `Short ${nf(-d)}` : d > 0 ? `Excess ${nf(d)}` : 'On target'}</td></tr>
                  ); })}</tbody>
                </table></div>
              );
            })() : <div aria-hidden />}
            <div className="flex items-start gap-2">
            {prev && !QM && em.copyPrev !== false && <button type="button" onClick={copyPrev} title={`Copy the loss rows of ${p2(prev.hour)}:00`} className="hidden h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-fs-12 font-bold text-slate-700 hover:bg-slate-50 md:inline-flex"><Copy size={13} aria-hidden /> Copy {p2(prev.hour)}:00</button>}
            {!inline && <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg p-1.5 hover:bg-slate-100"><X size={22} /></button>}
            </div>
          </div>
        </div>
        <datalist id="ole-minutes">{MINS.filter((m) => m <= limit).map((m) => <option key={m} value={m} />)}</datalist>
        <datalist id="le-depts">{[...new Set([...PLANT_DEPTS, ...DEPTS, ...KINDS.flatMap(({ kind: k }) => (reasons[k] || []).map((x) => x.dept)), ...(reasons.station || []).map((x) => x.dept)].filter(Boolean))].sort().map((d) => <option key={d} value={d} />)}</datalist>
        {/* body: time on the left, quality on the right (one column on a phone) */}
        <div className={`${inline ? '' : 'min-h-0 flex-1 overflow-y-auto '}bg-slate-50/60 px-3 py-2 sm:px-5 sm:py-2`}>
          {prev && !QM && em.copyPrev !== false && <button type="button" onClick={copyPrev} className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 md:hidden"><Copy size={14} aria-hidden /> Copy {p2(prev.hour)}:00 loss</button>}
          {/* one column: time first, then quality — every entry gets the full width */}
          <div className="flex flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-3">
              {r.extra && !QM && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-fs-14 font-bold text-amber-900">Extra hour — no loss to enter</p>}
              {timeParts.map(part)}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {qualityParts.map(part)}
            </div>
          </div>
        </div>
        {/* foot: always visible */}
        <div style={inline ? { bottom: 28 } : undefined} className={`shrink-0 border-t border-slate-200 bg-white px-4 py-2 sm:px-5${inline ? ' sticky z-20 rounded-b-xl shadow-[0_-6px_14px_-10px_rgba(15,23,42,0.45)]' : ''}`}>
          {err && <div role="alert" className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
          {!err && tooMany && <div className="mb-2 text-fs-12 font-semibold text-amber-800">A rejection / rework row has more pieces than were made in this hour — check the number.</div>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* 24-11-2026: the note sits in the foot, beside the buttons */}
            <input className={`${inp} mr-auto h-10 min-w-0 flex-1 text-fs-15`} style={{ minWidth: 200 }} aria-label="Note" placeholder="Note (optional)" maxLength={300} value={f.note} onChange={(e) => edit((x) => ({ ...x, note: e.target.value }))} />
            {!QM && !r.future && (start0.noLoss && stopSum + lossSum === 0
              ? <span className="mr-auto inline-flex items-center gap-1 text-fs-13 font-bold text-emerald-800" data-testid="no-loss-checked"><CheckCircle2 size={15} aria-hidden />No loss — checked by {start0.noLossBy || '—'}{start0.noLossAt ? ` · ${start0.noLossAt}` : ''}</span>
              : autoNo && mode === 'loss' && stopSum + lossSum === 0
                ? <span className="mr-auto inline-flex items-center gap-1 text-fs-13 font-bold text-emerald-800" data-testid="no-loss-auto"><CheckCircle2 size={15} aria-hidden />{target > 0 && r.qty >= target ? `No loss — target achieved (${r.qty} / ${target}), nothing to save` : 'No loss — no model lost time (from the scans), nothing to save'}</span>
              : stopSum + lossSum === 0 && em.noLoss !== false && (
                <button type="button" onClick={() => save(!!next, true, mode === 'both' && rejSum + rwSum === 0)} disabled={busy} title={mode === 'both' && rejSum + rwSum === 0 ? 'No time lost and no rejection / rework in this hour — save it as checked' : 'This hour lost no time — save it as checked'}
                  className="mr-auto inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-4 text-fs-14 font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"><CheckCircle2 size={15} aria-hidden /> {mode === 'both' && rejSum + rwSum === 0 ? 'No loss, no defects — Save' : 'No loss — Save'}</button>
              ))}
            {/* 23-11-2026: Quality entry — an hour checked with nothing found is saved as "No defects" (no longer pending) */}
            {QM && !r.future && (start0.noQ && rejSum + rwSum === 0
              ? <span className="mr-auto inline-flex items-center gap-1 text-fs-13 font-bold text-emerald-800" data-testid="no-defect-checked"><CheckCircle2 size={15} aria-hidden />No defects — checked by {start0.noQBy || '—'}{start0.noQAt ? ` · ${start0.noQAt}` : ''}</span>
              : rejSum + rwSum === 0 && em.noLoss !== false && (
                <button type="button" onClick={() => save(!!next, false, true)} disabled={busy} title="No rejection and no rework in this hour — save it as checked"
                  className="mr-auto inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-4 text-fs-14 font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"><CheckCircle2 size={15} aria-hidden /> No defects — Save</button>
              ))}
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700 hover:bg-slate-50">{inline ? 'Undo changes' : 'Cancel'}</button>
            <button type="button" onClick={() => save(false)} disabled={busy} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-60 sm:flex-none"><Save size={15} aria-hidden /> {busy ? 'Saving…' : 'Save hour'}</button>
            {next && <button type="button" onClick={() => save(true)} disabled={busy} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-900 px-4 sm:w-auto text-fs-14 font-bold text-white hover:bg-blue-950 disabled:opacity-60">Save &amp; next ({p2(next.hour)}:00) <ChevronRight size={15} aria-hidden /></button>}
          </div>
        </div>
      </div>
    </div>
  );
  const picker = rp && <ReasonDrawer {...rp} onClose={() => setRp(null)} />;
  // as a window it sits on <body>: a moving page (lp-anim) would otherwise hold a fixed layer inside it
  return <>{inline || typeof document === 'undefined' ? body : createPortal(body, document.body)}{picker}</>;
}

/** The reason list in a side drawer (19-11-2026): search, grouped by department, the chosen one marked; a click picks it. */
function ReasonDrawer({ title, sub, list, recent = [], grouped, now, newLabel, pick, onClose }) {
  const [q, setQ] = useState('');
  const n = q.trim().toLowerCase();
  const has = (x) => !n || `${x.reason} ${x.dept || ''}`.toLowerCase().includes(n);
  // 20-11-2026: the ones used lately on this line first ("Recent"; a reason written by hand before is among them), then the list
  const rec = (recent || []).filter(has);
  const recSet = new Set(rec.map((x) => x.reason.toLowerCase()));
  const rows = (list || []).filter((x) => has(x) && !(n === '' && recSet.has(String(x.reason).toLowerCase())));
  const groups = [...(rec.length && !n ? [['Recent — used lately on this line', rec, true]] : []), ...(grouped ? [...new Set(rows.map((x) => x.dept || 'Other'))].map((g) => [g, rows.filter((x) => (x.dept || 'Other') === g)]) : [['', rows]])];
  const first = n ? [...rec.filter((x) => x.manual), ...rows][0] : null;
  const choose = (v, item = null) => { pick(v, item); onClose(); };
  return (
    <MesDrawer title={title} sub={sub} icon={ListChecks} onClose={onClose} width={34} canExpand={false} excel={false} label={`Pick ${title}`} bodyClass="p-0">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-3">
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && first) { e.preventDefault(); choose(first.reason, first); } }} placeholder="Search reason or department — Enter picks the first" aria-label="Search reasons"
          className="h-10 w-full rounded-lg border border-slate-300 px-3 text-fs-15 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="p-2" role="listbox" aria-label="Reasons">
        {groups.map(([g, xs, isRecent]) => (
          <div key={g || 'all'} className={`mb-2 ${isRecent ? 'rounded-lg bg-blue-50/60 pb-1' : ''}`} role={isRecent ? 'group' : undefined} aria-label={isRecent ? 'Recent reasons' : undefined}>
            {g && <div className={`sticky top-[65px] px-2 py-1 text-fs-12 font-extrabold uppercase tracking-wide ${isRecent ? 'bg-blue-100 text-blue-900' : 'bg-slate-50 text-slate-600'}`}>{g}</div>}
            {xs.map((x) => {
              const on = x.reason === now;
              return (
                <button key={`${isRecent ? 'r' : ''}${x.reason}`} type="button" role="option" aria-selected={on} onClick={() => choose(x.reason, x)}
                  className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-fs-15 ${on ? 'border-blue-600 bg-blue-50 font-bold text-blue-900' : 'border-transparent text-slate-900 hover:border-slate-200 hover:bg-slate-50'}`}>
                  <span className="min-w-0">{isRecent ? '↺ ' : ''}{x.reason}{x.manual && <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-fs-11 font-bold text-violet-800">written</span>}</span>
                  {(isRecent || !grouped) && x.dept && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-fs-12 font-semibold text-slate-600">{x.dept}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {!rows.length && !rec.length && <p className="px-3 py-4 text-fs-14 text-slate-500">No reason has “{q}”.</p>}
        <button type="button" onClick={() => choose('__new')} className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-violet-300 px-3 py-2.5 text-left text-fs-15 font-bold text-violet-800 hover:bg-violet-50">✎ {newLabel}</button>
      </div>
    </MesDrawer>
  );
}

/** Admin: the reasons of loss, rejection and rework, each with its responsible department. */
export function ReasonsEditor({ reasons, onSaved, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [r, setR] = useState(reasons);
  const [msg, setMsg] = useState('');
  useEffect(() => setR(reasons), [reasons]);
  const set = (k, i, f, v) => setR((x) => ({ ...x, [k]: x[k].map((row, j) => (j === i ? { ...row, [f]: v } : row)) }));
  const save = async () => { setMsg(''); try { const j = await api.saveOleReasons(r); setMsg('Saved.'); onSaved(j?.reasons || r); } catch (x) { setMsg(`Could not save: ${x.message}`); } };
  return (
    <section className={card} aria-label="Reasons and departments">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-fs-16 font-bold text-slate-900"><ListChecks size={18} aria-hidden /> Reasons and responsible departments <span className="ml-auto text-fs-13 font-semibold text-sky-700">{open ? 'Close' : 'Change'}</span></button>
      {open && (
        <>
          <datalist id="ole-depts">{[...new Set([...DEPTS, ...KINDS.flatMap(({ kind }) => (r[kind] || []).map((x) => x.dept))].filter(Boolean))].map((d) => <option key={d} value={d} />)}</datalist>
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            {KINDS.map(({ kind, title }) => (
              <div key={kind} aria-label={`${title} reasons`} role="group" className={kind === 'loss' ? 'xl:col-span-2' : ''}>
                <div className="text-fs-13 font-extrabold text-slate-800">{title} <span className="font-semibold text-slate-500">· {r[kind].length} reasons · department · owner</span></div>
                <div className={`mt-1 grid gap-1.5 ${kind === 'loss' ? 'xl:grid-cols-2 xl:gap-x-4' : ''}`}>
                  {r[kind].map((row, i) => (
                    <div key={i} className="grid grid-cols-[1.5fr_1fr_1fr_32px] gap-1.5">
                      <input className={inp} aria-label={`${title} reason ${i + 1}`} value={row.reason} onChange={(e) => set(kind, i, 'reason', e.target.value)} />
                      <input className={inp} aria-label={`${title} department ${i + 1}`} value={row.dept} list="ole-depts" onChange={(e) => set(kind, i, 'dept', e.target.value)} placeholder={kind === 'station' ? 'Owner' : 'Department'} />
                      <input className={inp} aria-label={`${title} owner ${i + 1}`} value={row.owner || ''} onChange={(e) => set(kind, i, 'owner', e.target.value)} placeholder="Owner" />
                      <button type="button" aria-label={`Remove ${title} reason ${i + 1}`} onClick={() => setR((x) => ({ ...x, [kind]: x[kind].filter((_, j) => j !== i) }))} className="h-9 w-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setR((x) => ({ ...x, [kind]: [...x[kind], { reason: '', dept: '', owner: '' }] }))} className="mt-1.5 inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-slate-400 px-2.5 text-fs-13 font-bold text-slate-700"><Plus size={14} aria-hidden /> {kind === 'station' ? 'Add station' : 'Add reason'}</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 text-fs-14 font-bold text-white"><Save size={15} aria-hidden /> Save reasons</button>
            {msg && <span role="status" className={`text-fs-13 font-bold ${msg.startsWith('Not') ? 'text-red-700' : 'text-sky-800'}`}>{msg}</span>}
            <span className="text-fs-12 text-slate-500">Rows already saved keep the department they had. Department names must match the department of the RCA logins.</span>
          </div>
        </>
      )}
    </section>
  );
}
