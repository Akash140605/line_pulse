/**
 * OLE — Overall Line Effectiveness of one line and one day, hour by hour. Every OLE screen uses this file.
 *
 * Time of an hour
 *   Total time   = the minutes of the hour inside the shift, minus lunch and tea breaks (shift master, or that day's
 *                  Morning entry). Today: only up to the line's last scan. A finished day: up to the last hour with
 *                  pieces or with a loss written (admin option "Day ends at": last scan / shift close).
 *   Idle time    = the minutes written on Loss entry for the hour (every row is a loss).
 *   Run time     = Total time − Idle time
 *   Std time     = Σ pieces of each model × its std cycle (the line's target cycle; with the manpower sync on:
 *                  std cycle × std manpower ÷ the day's manpower)
 *
 * The three factors (the admin can switch each one: Setup → Masters → OLE formulas, see setOleConfig)
 *   Availability A = Run time ÷ Total time
 *   Performance  P = Std time ÷ Run time        (only the pieces whose model has a std cycle; not capped at 100 %)
 *   Quality      Q = (Pieces − Rejected) ÷ Pieces
 *   OLE            = A × P × Q
 *
 * A day, a line group, a month: add the minutes and pieces first, then the same formulas (never an average of %).
 *
 * Extra hours (pieces before the shift or after it): their pieces count, their time is the std time of those pieces,
 * so they never move OLE. Closed day (no piece, and nothing written or "line off all day"): no OLE at all.
 * Entries keep the keys `stops` (old "planned stop" rows) and `losses` so saved data keeps working.
 */
import { groupDhm } from './money';
import { targetsOn } from './targetPeriods';   // 20-11-2026: the targets of the method in force that day
import { targetOf } from './targets';
import { masterTargetOf } from './targetMethods';   // 21-11-2026: Method D target from the master when a line's set is missing
import { normShift, offMinOf, shiftOfDay, SHIFT_PLANT } from './shift';
import { dayPlanOf } from './dayPlan';   // 25-11-2026: one plan of a line-day (screens = reports)

/** Fallback shift (minutes) when a line has none saved: 09:00–21:00, lunch 13:00–13:30. */
export const OLE_SHIFT = { start: 9 * 60, end: 21 * 60, lunchStart: 13 * 60, lunchEnd: 13 * 60 + 30, breaks: [], off: [[13 * 60, 13 * 60 + 30]] };
/**
 * The OLE shift of a line from its master shift (Setup → Masters → Shift & lunch, 'HH:MM' with lunch and tea breaks).
 * Lunch and breaks are no working time: they are not in the total / planned time, so they never lower Availability.
 */
// 24-11-2026: no morning entry and no shift master → the plant's day (lunch + tea break 18:30–18:45, utils/shift SHIFT_PLANT)
export const oleShift = (sh) => (!sh ? normShift(SHIFT_PLANT) : typeof sh.start === 'number' ? sh : normShift(sh));
export const OLE_LINES = ['1', '2', '3', '4'];   // the page shows the lines of the login (api LINE_IDS)

/**
 * An hour's manual entry in today's shape: { stops: [{model, reason, dept, min}], losses: [{model, reason, dept, min}],
 * rejects: [{…qty}], rework: [{…qty}], note } plus the sums stopMin / lossMin / rejQty / rwQty.
 *   losses = the loss rows of Loss entry · stops = rows saved as "planned stop" by older versions.
 *   Both are idle time; with the admin option "Loss entry minutes: Old planned stop not loss" the stops come out of
 *   the total time instead. Older entries ({stopMin, reason, rejects, rework} as numbers) are read too.
 */
/** Category of a rejection / rework row (20-11-2026, as the plant's quality sheet). */
export const QCATS = ['Production', 'Assy', 'Part', 'Process', 'Moulding', 'Kitting Store', 'Plastic Store'];   // Moulding: as the plant's rework sheet · the two stores (23-11-2026)
export function normEntry(e) {
  const x = e || {};
  // rejection / rework rows also carry the quality station that caught the piece (LQC, FQC, leak test …)
  // owner (of the reason) and part involved are kept when a row has them
  // 20-11-2026: a quality row also keeps its category (Production / Assy / Part / Process), root cause, action and the
  // pieces dismantled for it (some defects need the machine opened up)
  const qx = (r, n) => {
    const o = {};
    if (QCATS.includes(r.cat)) o.cat = r.cat;
    if (r.cause) o.cause = String(r.cause);
    if (r.action) o.action = String(r.action);
    const d = Math.min(n, Math.max(0, Math.round(Number(r.dismantle) || 0)));
    if (d > 0) o.dismantle = d;
    return o;
  };
  const rows = (v, k) => (Array.isArray(v) ? v : []).map((r) => { const n = Math.max(0, Number(r[k]) || 0); return { ...(k === 'qty' ? { station: r.station || '' } : {}), model: r.model || '', reason: r.reason || '', dept: r.dept || '', [k]: n, ...(r.owner ? { owner: r.owner } : {}), ...(r.part ? { part: r.part } : {}), ...(k === 'qty' ? qx(r, n) : {}) }; }).filter((r) => r[k] > 0);
  const stops = Array.isArray(x.stops) ? rows(x.stops, 'min') : (Number(x.stopMin) > 0 ? [{ model: '', reason: x.reason || '', dept: '', min: Number(x.stopMin) }] : []);
  const rejects = Array.isArray(x.rejects) ? rows(x.rejects, 'qty') : (Number(x.rejects) > 0 ? [{ model: '', reason: '', dept: '', qty: Number(x.rejects) }] : []);
  const rework = Array.isArray(x.rework) ? rows(x.rework, 'qty') : (Number(x.rework) > 0 ? [{ model: '', reason: '', dept: '', qty: Number(x.rework) }] : []);
  const losses = rows(x.losses, 'min');   // unplanned loss: breakdown, material, power …
  const sum = (a, k) => a.reduce((t, r) => t + r[k], 0);
  return { stops, losses, rejects, rework, note: x.note || '', ...(x.noLoss && !stops.length && !losses.length ? { noLoss: true, noLossBy: x.noLossBy || '', noLossAt: x.noLossAt || '' } : {}), ...(x.noQ && !rejects.length && !rework.length ? { noQ: true, noQBy: x.noQBy || '', noQAt: x.noQAt || '' } : {}), stopMin: sum(stops, 'min'), lossMin: sum(losses, 'min'), rejQty: sum(rejects, 'qty'), rwQty: sum(rework, 'qty'), updatedBy: x.updatedBy, updatedAt: x.updatedAt };
}

/**
 * Losses of hours (rows of oleLineDay, any lines) grouped by department, by reason and by model.
 * → { dept: [{name, stopMin, lossMin, rejQty, rwQty}], reason: [{kind, name, dept, value}], model: [{name, stopMin, lossMin, rejQty, rwQty}],
 *     station: [{name, rejQty, rwQty, defects: [{name, qty}]}] (rejection + rework by quality station) }
 * stationList (optional): the admin's station setup — old station names are counted under the station's name now.
 */
export function lossSummary(rows, stationList = null) {
  const look = stationList ? stationLookup(stationList) : null;   // an entry under a station's old name counts for it
  const dept = new Map(), reason = new Map(), model = new Map(), station = new Map();
  const add = (m, k, f, v) => { const o = m.get(k) || { name: k, stopMin: 0, lossMin: 0, rejQty: 0, rwQty: 0 }; o[f] += v; m.set(k, o); };
  for (const r of rows || []) {
    const e = r.e || normEntry(r.entry);
    for (const [list, f, num, kind0] of [[e.stops, 'lossMin', 'min', 'Idle time'], [e.losses, 'lossMin', 'min', 'Idle time'],   // minutes entered: idle time, or performance loss when written against a model
      [e.rejects, 'rejQty', 'qty', 'Rejection'], [e.rework, 'rwQty', 'qty', 'Rework']]) {
      for (const x of list) {
        const kind = list === e.losses && x.model && CFG.lossIn !== 'avail' ? 'Performance loss' : kind0;
        add(dept, x.dept || 'Not set', f, x[num]);
        add(model, x.model || 'Model not given', f, x[num]);
        const k = `${kind}|${x.reason || 'Not given'}`;
        const o = reason.get(k) || { kind, name: x.reason || 'Not given', dept: x.dept || 'Not set', value: 0, unit: num === 'min' ? 'min' : 'pcs', byModel: new Map() };
        o.value += x[num]; reason.set(k, o);
        if (x.model) o.byModel.set(x.model, (o.byModel.get(x.model) || 0) + x[num]);   // 20-11-2026: the models the reason was written on
        if (num === 'qty') {
          const sk = (look && look.get(String(x.station || '').toLowerCase())?.reason) || x.station || 'Station not given';
          const so = station.get(sk) || { name: sk, stopMin: 0, lossMin: 0, rejQty: 0, rwQty: 0, defects: new Map() };
          so[f] += x[num];
          const dk = `${kind === 'Rejection' ? 'rej' : 'rwk'}|${x.reason || 'Not given'}`;
          so.defects.set(dk, (so.defects.get(dk) || 0) + x[num]);
          station.set(sk, so);
        }
      }
    }
  }
  const by = (a) => [...a.values()].sort((p, q) => (q.stopMin + q.lossMin + q.rejQty + q.rwQty) - (p.stopMin + p.lossMin + p.rejQty + p.rwQty));
  const st = by(station).map((o) => ({ ...o, defects: [...o.defects.entries()].map(([k, qty]) => ({ kind: k.slice(0, 3), name: k.slice(4), qty })).sort((a, b) => b.qty - a.qty) }));
  const reasons = [...reason.values()].map(({ byModel, ...o }) => ({ ...o, models: [...byModel.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) }));
  return { dept: by(dept), reason: reasons.sort((p, q) => q.value - p.value), model: by(model), station: st };
}

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** 'Lunch 13:00–13:30', 'Tea 11:00–11:10' … of the no-work windows that touch clock hour h (all of them when h is null). */
export function offLabels(shift, h = null) {
  const s = oleShift(shift);
  const w = [...(s.lunchStart != null ? [{ name: 'Lunch', from: s.lunchStart, to: s.lunchEnd }] : []), ...(s.breaks || [])].sort((a, b) => a.from - b.from);
  return w.filter((b) => h == null || (b.from < h * 60 + 60 && b.to > h * 60)).map((b) => `${b.name} ${hhmm(b.from)}–${hhmm(b.to)}`);
}
/** '09:00–21:00' of a line's shift. */
export const shiftText = (shift) => { const s = oleShift(shift); return `${hhmm(s.start)}–${hhmm(s.end)}`; };

/** Working minutes of the clock hour `h` (lunch and tea breaks taken out), only up to `nowMin` when given. */
export function hourTotalMin(h, nowMin = null, s = OLE_SHIFT) {
  s = oleShift(s);
  const from = Math.max(h * 60, s.start);
  let to = Math.min(h * 60 + 60, s.end);
  if (nowMin != null) to = Math.min(to, nowMin);
  if (to <= from) return 0;
  return to - from - offMinOf(s, from, to);
}

/** Working minutes of an extra hour (outside 09:00–21:00 with production): the full hour, today only up to now. */
export const extraHourMin = (h, nowMin = null) => (nowMin == null ? 60 : Math.max(0, Math.min(60, nowMin - h * 60)));

/** The clock hours of the shift: 9 … 20. */
export const shiftHours = (s = OLE_SHIFT) => { s = oleShift(s); const out = []; for (let h = Math.floor(s.start / 60); h * 60 < s.end; h++) out.push(h); return out; };

/**
 * The admin's OLE setup (Setup → Masters → OLE formulas); the standard is the first choice of each.
 * Manpower sync: the std cycle of a line-day × std manpower ÷ its manpower (morning entry) — fewer people, longer std cycle.
 */
export const OLE_CFG_DEFAULT = { pMode: 'plan', aEnd: 'lastScan', aLoss: 'all', lossIn: 'avail', aIdle: 'run', pBase: 'run', pCap: false, pNoStd: 'skip', qMode: 'rejRework', qStations: 'all', mpSync: false, mpUse: 'open', mpUp: false, stdMp: {}, good: 85, watch: 60, fewPcs: 5, timeFmt: 'h1' };
let CFG = { ...OLE_CFG_DEFAULT };
// the quality stations of the setup (Quality "Final check only" counts the rejections / rework of 'final' stations)
let STATIONS = [];
export function setOleStations(list) { STATIONS = Array.isArray(list) ? list : []; }
export const oleConfig = () => CFG;
/** 26-11-2026: good pieces as Quality counts them: made − rejected (− reworked when rework counts, the default) */
export const goodOf = (t) => Math.max(0, (t?.qty || 0) - (t?.rejects || 0) - (CFG.qMode === 'rejRework' ? (t?.rework || 0) : 0));
export function setOleConfig(c) { if (c && typeof c === 'object') CFG = { ...CFG, ...c }; }
/** OLE colour limits of the admin (fractions): good from, watch from */
/** benchmarks (Setup → OLE formulas → Display): OLE good from 85 %; A · P · Q each their own (default 95 %), watch below it */
const FKEY = { A: 'A', P: 'P', Q: 'Q' };
export const okFrom = (k = null) => (FKEY[k] ? (Number(CFG[`good${k}`]) || 95) : (Number(CFG.good) || 85)) / 100;
export const watchFrom = (k = null) => Math.min(okFrom(k), (FKEY[k] ? (CFG[`watch${k}`] == null ? 85 : Number(CFG[`watch${k}`])) : (Number(CFG.watch) || 0)) / 100);
/** manpower of a line-day used for the sync (morning entry: at open, or the average of open and close) */
export function mpOfDay(setup) {
  const o = Number(setup?.mp), c = Number(setup?.mpClose);
  if (!(o > 0)) return null;
  return CFG.mpUse === 'avg' && c > 0 ? (o + c) / 2 : o;
}
/** the std-cycle factor of a line-day: manpower ÷ std manpower (1 when the sync is off or a number is missing) */
export function mpFactorOf(line, setup) {
  if (!CFG.mpSync) return 1;
  const std = Number(CFG.stdMp?.[line] ?? CFG.stdMp?.[String(line)]); const mp = mpOfDay(setup);
  if (!(std > 0) || !(mp > 0)) return 1;
  const f = mp / std;
  return Math.max(0.1, CFG.mpUp ? f : Math.min(1, f));
}

/** A, P, Q and OLE of summed minutes and pieces (fractions; null when there is nothing to divide by). */
export function oleOf(t) {
  const planned = t.plannedMin ?? t.totalMin;
  const A = planned > 0 ? t.actualMin / planned : null;
  // Performance only over the pieces whose model has a std cycle: their share of the actual time is compared with
  // their std time (a model without a std cycle must not pull the line down). No piece with a std cycle → no P / OLE.
  const covered = t.qty > 0 ? (t.qty - (t.noStdQty || 0)) / t.qty : 1;
  // P is not capped (a line faster than its std shows above 100 %) unless the admin chooses "Max 100 %";
  // Praw = the uncapped value (the target pieces = pieces ÷ Praw). The time compared: run time (standard) or planned time.
  const pTime = CFG.pBase === 'planned' ? planned : t.actualMin;
  const PrawStd = !(pTime > 0) ? null : t.qty === 0 ? 0 : covered > 0 ? t.stdSec / (pTime * 60 * covered) : null;
  // 26-11-2026 (plant): Performance = Actual Qty ÷ Plan Target Qty (the HPR / SAWM plan of the hours that ran), as the
  // plant reads it — 3,419 made of a plan of 3,581 is 95.5 %. A total with no plan (an extra hour) keeps std time ÷ run time.
  const Praw = CFG.pMode !== 'std' && t.planQty > 0 ? t.qty / t.planQty : PrawStd;
  const P = Praw != null && CFG.pCap ? Math.min(1, Praw) : Praw;
  // Quality: rejected pieces out (standard), or rejected and reworked pieces out
  const bad = t.rejects + (CFG.qMode === 'rejRework' ? (t.rework || 0) : 0);
  const Q = t.qty > 0 ? Math.max(0, t.qty - bad) / t.qty : null;
  const ole = A == null ? null : A === 0 ? 0 : P == null ? (t.qty > 0 ? null : 0) : A * P * (Q ?? 1);
  // speed loss = time the covered pieces took beyond their std time (slow running — it shows in Performance)
  const speedMin = t.actualMin > 0 && covered > 0 ? Math.max(0, t.actualMin * covered - t.stdSec / 60) : null;
  return { ...t, A, P, Q, ole, speedMin, Praw };
}

const ZERO = () => ({ totalMin: 0, stopMin: 0, plannedMin: 0, lossMin: 0, perfLossMin: 0, idleAuto: 0, actualMin: 0, qty: 0, stdSec: 0, noStdQty: 0, rejects: 0, rework: 0, dismantle: 0, planQty: 0 });
/** 25-11-2026: Plan Target Qty of a total (a line-day, a period, an hour): the HPR / SAWM KPI plan (planQty); a total
 *  without it (no target on any hour) falls back to the pieces ÷ performance as before. → whole pieces | null */
export const planTargetOf = (t) => (!t ? null : t.planQty > 0 ? Math.round(t.planQty) : (t.Praw ?? t.P) > 0 ? Math.round(t.qty / (t.Praw ?? t.P)) : null);
export function oleSum(list) {
  const t = ZERO();
  for (const x of list || []) if (x) for (const k of Object.keys(t)) t[k] += x[k] || 0;
  return oleOf(t);
}

/**
 * One line, one day, hour by hour.
 *   hours   = [{hour, quantity, models:[{mmId, model, quantity}]}]   (groupDhm of all_lines dhm)
 *   targets = { mmId: {cycle} } of the line, entries = { hour: {stopMin, reason, rejects, rework, note} }
 *   nowMin  = minutes of the day now when the day is today, else null
 * → { rows: [...] (shift hours + extra hours, row.extra), total, outsideQty: 0, extraHours, extraQty }
 */
export function oleLineDay({ hours = [], targets = {}, entries = {}, nowMin = null, dayOff = null, shift = null, mpFactor = 1, endMin = null }) {
  const sh = oleShift(shift);   // the line's own shift from the master (lunch + breaks are not working time)
  const byHour = Object.fromEntries((hours || []).map((h) => [Number(h.hour), h]));
  const base = shiftHours(sh);
  // hours before 09:00 / from 21:00 with pieces count too (early start, overtime) so the day's qty = all the scans
  const extra = (hours || []).filter((h) => Number(h.quantity) > 0 && !base.includes(Number(h.hour))).map((h) => Number(h.hour));
  const list = [...new Set([...base, ...extra])].sort((a, b) => a - b);
  // a finished day runs up to its last hour with pieces or with a loss written; the shift hours after it are not
  // working time (today is cut at the last scan by the caller: nowMin / endMin)
  let lastH = null;
  if (nowMin == null && CFG.aEnd === 'lastScan') {
    for (const h of base) {
      const q = Number(byHour[h]?.quantity) || (byHour[h]?.models || []).reduce((a, m) => a + (Number(m.quantity) || 0), 0);
      const en = normEntry(entries[h] || entries[String(h)] || null);
      if (q > 0 || en.stopMin + en.lossMin > 0) lastH = h;
    }
  }
  let rows = list.map((h) => {
    const isExtra = !base.includes(h);
    const afterLast = !isExtra && lastH != null && h > lastH;
    const full = isExtra ? 60 : hourTotalMin(h, null, sh);
    const totalMin = afterLast ? 0 : isExtra ? extraHourMin(h, nowMin) : hourTotalMin(h, nowMin, sh);
    const future = totalMin === 0 && full > 0 && !afterLast;
    const raw = entries[h] || entries[String(h)] || null;
    const e = normEntry(raw);
    // every minute written is idle time (lunch and tea breaks are already out of the total time);
    // admin option "Old planned stop not loss": rows saved as planned stops come off the time instead
    const stopMin = CFG.aLoss === 'unplanned' ? Math.min(totalMin, e.stopMin) : 0;
    const plannedMin = totalMin - stopMin;
    // (18-11-2026) a loss written against a MODEL is that model running below its std: performance loss — it stays in the
    // run time, so it lowers Performance (with the slow running), not Availability. A loss without a model (no model ran:
    // the line stood) is idle time and lowers Availability.
    // admin option "Model loss: Availability loss" keeps the older rule (every written minute is idle time)
    const perfLossMin = CFG.lossIn === 'avail' ? 0 : e.losses.reduce((a, x) => a + (x.model ? x.min : 0), 0);
    const idleLoss = e.lossMin - perfLossMin;
    const lossW = Math.min(plannedMin, CFG.aLoss === 'unplanned' ? idleLoss : e.stopMin + idleLoss);
    const hr = byHour[h];
    // manpower sync: the std cycle follows the people on the line (factor 1 = as in the master)
    const models = (hr?.models || []).map((m) => { const sd = targetOf(targets, m.mmId); return { ...m, std: sd && mpFactor !== 1 ? sd / mpFactor : sd }; });
    const qty = models.reduce((a, m) => a + (Number(m.quantity) || 0), 0) || Number(hr?.quantity) || 0;
    let stdSec = models.reduce((a, m) => a + (m.std ? (Number(m.quantity) || 0) * m.std : 0), 0);
    let noStdQty = models.reduce((a, m) => a + (m.std ? 0 : Number(m.quantity) || 0), 0);
    // admin option "Model without std cycle: hour's average": its pieces take the average std cycle of the hour's other models
    if (CFG.pNoStd === 'avg' && noStdQty > 0 && qty - noStdQty > 0) { stdSec += noStdQty * (stdSec / (qty - noStdQty)); noStdQty = 0; }
    // admin option "Hour without scans: idle time": an hour that made nothing and has nothing written is idle, not run time
    const lossMin = CFG.aIdle === 'idle' && !isExtra && qty === 0 && lossW === 0 && perfLossMin === 0 && e.stopMin === 0 ? plannedMin : lossW;
    // admin option "Quality: final check only": only the rejections / rework found at a final-check station count
    const fin = CFG.qStations === 'final' ? (x) => { const st = stationLookup(STATIONS).get(String(x.station || '').toLowerCase()); return st?.type === 'final'; } : null;
    const rejQ = fin ? e.rejects.filter(fin).reduce((a, x) => a + x.qty, 0) : e.rejQty;
    const rwQ = fin ? e.rework.filter(fin).reduce((a, x) => a + x.qty, 0) : e.rwQty;
    const rejects = Math.min(qty, rejQ);
    // 26-11-2026: pieces dismantled (written on the rework / rejection rows) — shown with the rework in Quality
    const disQ = [...e.rejects, ...e.rework].filter(fin || (() => true)).reduce((a, x) => a + (Number(x.dismantle) || 0), 0);
    const lunch = !isExtra && sh.lunchStart != null && overlap(h * 60, h * 60 + 60, sh.lunchStart, sh.lunchEnd) > 0;
    const breakMin = isExtra ? 0 : Math.round(offMinOf(sh, Math.max(h * 60, sh.start), Math.min(h * 60 + 60, sh.end)));   // lunch + tea breaks
    return { hour: h, extra: isExtra, afterLast, fullMin: full, future, lunch, breakMin, models, entry: raw, e, ...oleOf({ totalMin, stopMin, plannedMin, lossMin, perfLossMin: Math.min(perfLossMin, plannedMin - lossMin), actualMin: plannedMin - lossMin, qty, stdSec, noStdQty, rejects, rework: rwQ, dismantle: disQ, idleAuto: lossMin !== lossW ? lossMin : 0 }) };
  });
  // extra hours: time = std time of their pieces, so they never move OLE up or down
  const shiftRows = rows.filter((r) => !r.extra);
  const S = shiftRows.reduce((a, r) => a + r.stdSec, 0), C = shiftRows.reduce((a, r) => a + r.qty - r.noStdQty, 0);
  const avgSec = C > 0 ? S / C : null;
  rows = rows.map((r) => {
    if (!r.extra) return r;
    const cov = r.qty - r.noStdQty;
    const t = cov > 0 ? (r.stdSec / 60) * (r.qty / cov) : avgSec ? (r.qty * avgSec) / 60 : 0;
    return { ...r, fullMin: t, future: false, ...oleOf({ totalMin: t, stopMin: 0, plannedMin: t, lossMin: 0, actualMin: t, qty: r.qty, stdSec: r.stdSec, noStdQty: r.noStdQty, rejects: r.rejects, rework: r.rework, dismantle: r.dismantle || 0 }) };
  });
  const extraRows = rows.filter((r) => r.extra);
  const t0 = oleSum(rows);
  const closed = t0.qty === 0 && (dayOff || (t0.lossMin - (t0.idleAuto || 0) === 0 && !t0.perfLossMin)) ? (dayOff ? 'planned' : 'idle') : null;
  let out = closed ? rows.map((r) => ({ ...r, closed: true, ...oleOf({ ...ZERO(), rejects: 0 }) })) : rows;
  // 25-11-2026: Plan Target Qty = the plan of the HPR / SAWM KPI (utils/dayPlan.js) — the same number on every screen
  const plan = closed ? null : dayPlanOf({ rows: out, targets, shift: shift || SHIFT_PLANT, endMin: nowMin != null ? nowMin : endMin });
  if (plan) out = out.map((r) => (plan.byHour[r.hour] ? oleOf({ ...r, planQty: plan.byHour[r.hour] }) : r));   // the hour's P from its plan too
  return {
    rows: out, total: oleSum(out), closed, shift: sh, dayOff: dayOff || null, dayOffIgnored: !!dayOff && !closed, plan,
    outsideQty: 0, extraHours: extraRows.map((r) => r.hour), extraQty: extraRows.reduce((a, r) => a + r.qty, 0),
  };
}

/**
 * 21-11-2026: an hour after the line's last scan of the day — not run time, nothing to explain ("No run"): a finished day's
 * shift hours after its last hour with pieces (or a loss written), today's hours already begun but after the last scan.
 * A loss written there still counts (a finished day then runs up to it).
 */
export const isNoRun = (r, nowReal = null) => !r.extra && !r.closed && !(r.e.stops.length + r.e.losses.length + r.e.rejects.length + r.e.rework.length)
  && (!!r.afterLast || (nowReal != null && r.future && r.hour * 60 < nowReal));

/** All clock hours of the given day results (shift hours + any extra hour of any line), sorted. */
export const hoursOf = (byLine, ids) => {
  const s = new Set();
  for (const l of ids || Object.keys(byLine || {})) for (const r of byLine?.[l]?.rows || []) s.add(r.hour);
  if (!s.size) for (const h of shiftHours()) s.add(h);
  return [...s].sort((a, b) => a - b);
};

/**
 * Line 1 and Line 2 of one day from all_lines.php lines (with dhm), the line settings and the manual entries.
 *   entries = { "YYYY-MM-DD|line|hour": entry }
 * → { [line]: { line, name, ok, ...oleLineDay } }
 */
export function oleDayLines({ lines, settings, entries = {}, days = {}, setups = {}, date, nowMin = null, ids = OLE_LINES, lastScans = {} }) {
  const out = {};
  for (const id of ids) {
    const l = (lines || []).find((x) => String(x.line) === String(id));
    if (!l?.ok) { out[id] = { line: id, name: l?.name || `Line ${id}`, ok: false, error: l?.error || 'No answer', tries: l?.tries || 0, rows: [], total: oleSum([]), closed: null, dayOff: null, outsideQty: 0, extraHours: [], extraQty: 0 }; continue; }
    const names = Object.fromEntries((l.models || []).map((m) => [m.mmId, m.model]));
    const g = groupDhm((l.dhm || []).filter((r) => r[0] === date), { names });
    const ent = {};
    for (const [k, v] of Object.entries(entries || {})) { const [d, ln, h] = k.split('|'); if (d === date && ln === String(id)) ent[h] = v; }
    // nowMin may be per line ({ '1': min, …, now }): today's time of a line ends at its last scan
    const nm = nowMin != null && typeof nowMin === 'object' ? (nowMin[id] ?? nowMin.now ?? null) : nowMin;
    const setup = setups?.[`${date}|${id}`] || null;
    const mpFactor = mpFactorOf(id, setup);
    // a Method D line whose worked-out targets miss a model (its server's model list did not come): the master's cycle
    let tg = targetsOn(settings?.[id], date);
    for (const m of l.models || []) {
      if (targetOf(tg, m.mmId)) continue;
      const c = masterTargetOf(id, m, date);
      if (c) { tg = { ...tg, [String(m.mmId)]: { cycle: c, model: m.model, company: m.company || '', method: 'D', from: 'master' } }; }
    }
    out[id] = { line: id, name: l.name || `Line ${id}`, ok: true, backup: l.backup || null, mp: mpOfDay(setup), stdMp: Number(CFG.stdMp?.[id]) || null, mpFactor, ...oleLineDay({ hours: g[date] || [], targets: tg, entries: ent, nowMin: nm, dayOff: days?.[`${date}|${id}`] || null, shift: shiftOfDay(setups, date, id, settings?.[id]?.shift || null), mpFactor, endMin: lastScans?.[`${date}|${id}`] ?? null }) };   // the morning entry of that day, else the master
  }
  return out;
}

export const pct = (v, dec = 1) => (v == null ? '—' : `${(v * 100).toFixed(dec)}%`);
// every time on the OLE screens in hours with one decimal ("6.3 h", 15 min = "0.3 h") — or "6h 18m" (admin)
export const hm = (min) => {
  if (min == null || !Number.isFinite(Number(min))) return '—';
  if (CFG.timeFmt === 'hm') { const m = Math.round(Math.abs(Number(min))); const h = Math.floor(m / 60); return `${Number(min) < 0 ? '−' : ''}${h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`}`; }
  return `${(Math.round(Number(min) / 6) / 10).toFixed(1)} h`;
};
export const hr1 = hm;

/* ───────────── losses as "issues" (one reason of one kind, on one line and day) — the unit of an RCA ───────────── */

export const KIND_TEXT = { stop: 'Idle time', loss: 'Idle time', reject: 'Rejection', rework: 'Rework' };
export const rcaKey = (i) => `${i.date}|${i.line}|${i.kind}|${i.reason}`;
/** A planned stoppage was meant to happen: it needs no RCA. Unplanned loss, rejection and rework do. */
// 23-11-2026: RCAs start from this day — older losses are no longer listed or counted as pending (their records stay saved)
export let RCA_FROM = '2026-11-23';
export const setRcaFrom = (d) => { RCA_FROM = d || ''; };   // tests
export const needsRca = (i) => i.kind !== 'stop' && !(i.date && i.date < RCA_FROM);

/**
 * All issues of some line-days. days = [{ date, byLine: { line: { rows } } }] (oleRange) .
 * → [{ key, date, line, kind, reason, dept, value, unit, hours: [9, 10], models: ['WT70'] }] (biggest first)
 */
export function issuesOf(days) {
  const m = new Map();
  for (const d of days || []) {
    for (const [line, L] of Object.entries(d.byLine || {})) {
      for (const r of L.rows || []) {
        const e = r.e || normEntry(r.entry);
        for (const [list, num, kind] of [[e.stops, 'min', 'stop'], [e.losses, 'min', 'loss'], [e.rejects, 'qty', 'reject'], [e.rework, 'qty', 'rework']]) {
          for (const x of list) {
            const it = { date: d.date, line: String(line), kind, reason: x.reason || 'Not given' };
            const k = rcaKey(it);
            const o = m.get(k) || { ...it, key: k, dept: x.dept || 'Not set', value: 0, unit: num === 'min' ? 'min' : 'pcs', hours: [], models: [] };
            o.value += x[num];
            if (!o.hours.includes(r.hour)) o.hours.push(r.hour);
            if (x.model && !o.models.includes(x.model)) o.models.push(x.model);
            m.set(k, o);
          }
        }
      }
    }
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value);
}

/** Issues grouped: by department ('dept'), by line ('line') → { name, stopMin, lossMin, rejQty, rwQty, issues, pending … } ; by reason inside one ('reason'). */
export function groupIssues(issues, rca = {}, by = 'dept') {
  const m = new Map();
  for (const i of issues || []) {
    const k = by === 'dept' ? i.dept : by === 'line' ? `L${i.line}` : `${i.kind}|${i.reason}`;
    const o = m.get(k) || { key: k, name: by === 'dept' ? i.dept : by === 'line' ? `Line ${i.line}` : i.reason, line: i.line, kind: i.kind, dept: i.dept, stopMin: 0, lossMin: 0, rejQty: 0, rwQty: 0, issues: 0, pending: 0, submitted: 0, closed: 0, items: [] };
    o[{ stop: 'stopMin', loss: 'lossMin', reject: 'rejQty', rework: 'rwQty' }[i.kind]] += i.value;
    o.issues += 1;
    if (needsRca(i)) o[rcaStatus(rca[i.key])] += 1;   // planned stoppage: no RCA
    o.items.push(i);
    m.set(k, o);
  }
  const out = [...m.values()];
  if (by === 'line') return out.sort((a, b) => Number(a.line) - Number(b.line));
  return out.sort((a, b) => (b.stopMin + b.lossMin + b.rejQty + b.rwQty) - (a.stopMin + a.lossMin + a.rejQty + a.rwQty));
}

/** Short split of a group's losses by line (of a department) or by department (of a line): "L1 6′ · L2 1′ · L3 2 rej". */
export function splitText(items, by = 'line') {
  const m = new Map();
  for (const i of items || []) {
    const k = by === 'line' ? `L${i.line}` : i.dept;
    const o = m.get(k) || { k, min: 0, rej: 0, rwk: 0 };
    if (i.kind === 'loss' || i.kind === 'stop') o.min += i.value; else if (i.kind === 'reject') o.rej += i.value; else o.rwk += i.value;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => (by === 'line' ? a.k.localeCompare(b.k) : b.min - a.min))
    .map((o) => [o.k, [o.min ? `${o.min}′` : '', o.rej ? `${o.rej} rej` : '', o.rwk ? `${o.rwk} rwk` : ''].filter(Boolean).join(' ')]);
}

/** 'pending' (no RCA yet) · 'submitted' · 'closed'. */
export const rcaStatus = (r) => (!r ? 'pending' : r.status === 'closed' ? 'closed' : 'submitted');

/**
 * Every day of a period: dates with production or with entries. lines = all_lines.php lines of the period.
 * → { days: [{ date, byLine, total }], byLine: { line: total }, total }
 */
export function oleRange({ lines, settings, entries = {}, days: dayOffs = {}, setups = {}, start, end, today = '', nowMin = null, ids = OLE_LINES, lastScans = {} }) {
  const dates = new Set();
  for (const l of lines || []) if (ids.includes(String(l.line))) for (const r of l.dhm || []) if (r[0] >= start && r[0] <= end) dates.add(r[0]);
  for (const k of Object.keys(entries || {})) { const [d, ln] = k.split('|'); if (d >= start && d <= end && ids.includes(ln)) dates.add(d); }
  for (const k of Object.keys(dayOffs || {})) { const [d, ln] = k.split('|'); if (d >= start && d <= end && ids.includes(ln)) dates.add(d); }
  const days = [...dates].sort().map((date) => {
    const byLine = oleDayLines({ lines, settings, entries, days: dayOffs, setups, date, nowMin: date === today ? nowMin : null, ids, lastScans });
    return { date, byLine, total: oleSum(ids.map((l) => byLine[l]?.total)) };
  });
  const byLine = Object.fromEntries(ids.map((l) => [l, oleSum(days.map((d) => d.byLine[l]?.total))]));
  return { days, byLine, total: oleSum(days.map((d) => d.total)) };
}

/* ───────────── quality stations (the admin's setup) ───────────── */

/** Kinds of quality station. */
export const STATION_TYPES = [['inline', 'In-line check'], ['test', 'Test station'], ['final', 'Final check'], ['audit', 'Audit (sample)']];
/** A station row of the setup with every field (older rows have only reason / dept). */
export const normStation = (x) => {
  const o = typeof x === 'string' ? { reason: x } : (x || {});
  return {
    reason: String(o.reason || ''), dept: o.dept || '', code: o.code || '', type: STATION_TYPES.some(([k]) => k === o.type) ? o.type : 'inline',
    rty: o.rty !== false, active: o.active !== false, rework: o.rework !== false,
    lines: Array.isArray(o.lines) ? o.lines.map(Number).filter((n) => n > 0) : [], defects: Array.isArray(o.defects) ? o.defects : [], aliases: Array.isArray(o.aliases) ? o.aliases : [],
  };
};
/** Short name of a station on screens: its code, else the name without the "(…)" part. */
export const stationLabel = (name, list = []) => {
  const st = stationLookup(list).get(String(name || '').toLowerCase());
  return st?.code || String(st?.reason || name || '').replace(/\s*\(.*\)\s*$/, '');
};
const lookCache = new WeakMap();
/** lower-case name or old name → the station (setup order). */
export function stationLookup(list = []) {
  if (lookCache.has(list)) return lookCache.get(list);
  const m = new Map();
  for (const x of list.map(normStation)) { m.set(x.reason.toLowerCase(), x); }
  for (const x of list.map(normStation)) for (const a of x.aliases) if (!m.has(String(a).toLowerCase())) m.set(String(a).toLowerCase(), x);
  if (typeof list === 'object' && list) lookCache.set(list, m);
  return m;
}
/** The stations of these lines (a station without lines is on every line); `all` keeps the switched-off ones. */
export function stationsFor(list = [], lines = null, { all = false } = {}) {
  const ids = lines == null ? null : (Array.isArray(lines) ? lines : [lines]).map(Number);
  return list.map(normStation).filter((x) => x.reason && (all || x.active) && (!ids || !x.lines.length || x.lines.some((l) => ids.includes(l))));
}

/* ───────────── quality: FPY and RTY (washing machine line, stations from Loss entry) ───────────── */

/**
 * Quality of hours (rows of oleLineDay, any lines / days). Every scanned piece passes every quality station of the line.
 *   Input           = pieces made (scanned) in the hours
 *   Final yield     = (input − rejected) ÷ input                       (= Quality of OLE)
 *   FPY             = (input − rejected − reworked) ÷ input            first-pass yield: right first time, no rework
 *   Station FPY     = (input − rejected there − reworked there) ÷ input
 *   RTY             = Π Station FPY of the stations counted in RTY     rolled throughput yield: chance a piece passes
 *                                                                       every station first time
 *   DPHU            = (rejected + reworked) ÷ input × 100              defects per hundred units
 *   stations        = the admin's setup (names, or station rows: order, code, "in RTY", old names); they are shown
 *                     even with 0 defects; an entry under an old name counts for the station; rows with another
 *                     station are added after them (and count in RTY)
 * → { qty, rej, rwk, fpy, rty, rtyCount, finalYield, dphu, stations: [{name, label, code, type, rty, rej, rwk, fpy, defects}],
 *     models: [{name, qty, rej, rwk, fpy}], defects: [{name, rej, rwk}] }   (yields null without input)
 */
export function qualityOf(rows, stationList = []) {
  let qty = 0, rej = 0, rwk = 0;
  const setup = stationList.map(normStation).filter((x) => x.reason);
  const look = stationLookup(stationList);
  const blank = (n, x = null) => ({ name: n, label: x?.code || String(n).replace(/\s*\(.*\)\s*$/, ''), code: x?.code || '', type: x?.type || 'inline', rty: x ? x.rty : true, active: x ? x.active : true, setup: !!x, rej: 0, rwk: 0, defects: new Map() });
  const st = new Map(setup.map((x) => [x.reason, blank(x.reason, x)]));
  const md = new Map(), df = new Map();
  const mOf = (n) => { const o = md.get(n) || { name: n, qty: 0, rej: 0, rwk: 0 }; md.set(n, o); return o; };
  for (const r of rows || []) {
    qty += r.qty || 0;
    for (const m of r.models || []) mOf(m.model || String(m.mmId)).qty += Number(m.quantity) || 0;
    const e = r.e || normEntry(r.entry);
    for (const [list, k] of [[e.rejects, 'rej'], [e.rework, 'rwk']]) {
      for (const x of list) {
        const n = x.qty || 0;
        if (k === 'rej') rej += n; else rwk += n;
        const sn = look.get(String(x.station || '').toLowerCase())?.reason || x.station || 'Station not given';
        const so = st.get(sn) || blank(sn);
        so[k] += n; so.defects.set(x.reason || 'Not given', (so.defects.get(x.reason || 'Not given') || 0) + n); st.set(sn, so);
        if (x.model) mOf(x.model)[k] += n;
        const d = df.get(x.reason || 'Not given') || { name: x.reason || 'Not given', rej: 0, rwk: 0, byModel: new Map() }; d[k] += n; df.set(d.name, d);
        if (x.model) { const bm = d.byModel.get(x.model) || { rej: 0, rwk: 0 }; bm[k] += n; d.byModel.set(x.model, bm); }   // 20-11-2026: models of the defect
      }
    }
  }
  const y = (bad, of = qty) => (of > 0 ? Math.max(0, (of - bad) / of) : null);
  const stations = [...st.values()].map((s) => ({ ...s, fpy: y(s.rej + s.rwk), defects: [...s.defects.entries()].map(([name, n]) => ({ name, qty: n })).sort((a, b) => b.qty - a.qty) }));
  const inRty = stations.filter((s) => s.rty);
  const rty = qty > 0 ? inRty.reduce((a, s) => a * (s.fpy ?? 1), 1) : null;
  return {
    qty, rej, rwk, fpy: y(rej + rwk), finalYield: y(rej), rty, rtyCount: inRty.length, dphu: qty > 0 ? ((rej + rwk) / qty) * 100 : null,
    stations,
    models: [...md.values()].filter((m) => m.qty > 0 || m.rej + m.rwk > 0).map((m) => ({ ...m, fpy: y(m.rej + m.rwk, m.qty) })).sort((a, b) => (b.rej + b.rwk) - (a.rej + a.rwk) || b.qty - a.qty),
    defects: [...df.values()].map(({ byModel, ...d }) => ({ ...d, models: [...byModel.entries()].map(([name, v]) => ({ name, rej: v.rej, rwk: v.rwk, value: v.rej + v.rwk })).sort((a, b) => b.value - a.value) }))
      .sort((a, b) => (b.rej + b.rwk) - (a.rej + a.rwk)),
  };
}

/* ───────────── time lost against the std time, model by model (from the scans of an hour) ───────────── */

const minOfDay = (s) => { const m = String(s || '').match(/(\d{1,2}):(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60 : null; };

/**
 * Minutes each model ran in one clock hour and the time it lost against its std time.
 *   scans  = hour_detail.php scans [{mmId, scanDate, cycleSeconds}] (cycleSeconds = raw gap since the scan before)
 *   models = the hour's models [{mmId, model, quantity, std}] (std = target cycle s, null = none)
 *   stops  = planned stoppage rows [{model, min}] of the hour (taken out first: with a model from that model, else shared by run time)
 * Each scan's gap is time of the model of that scan; the time before the first scan of the hour goes to the first model, the
 * time after the last scan (until the end of the hour, or now) to the last model — but the day's last hour (endAtLastScan)
 * ends at its last scan. Lunch time is left out.
 *   lost = run time − its share of planned stoppage − std time (qty × std cycle) — the minutes the unplanned loss rows should explain
 * Without scans (estimated = true) the hour's time is shared by the models' std time.
 * → { rows: [{mmId, model, qty, runMin, stopMin, stdMin, lostMin}], runMin, stdMin, lostMin, estimated }
 */
export function modelTimeOfHour({ hour, scans = null, models = [], stops = [], totalMin = null, nowMin = null, extra = false, shift = null, endAtLastScan = false }) {
  const sh = oleShift(shift);
  const a = hour * 60;
  // the scans of the hour first: the last hour of the day ends at its last scan (21-11-2026, endAtLastScan), not at the
  // end of the hour — the time after the line's last piece is not run time
  const list = (scans || []).map((x) => ({ mm: String(x.mmId), t: minOfDay(x.scanDate) }))
    .filter((x) => x.t != null && x.t >= a && x.t <= a + 60).sort((p, q) => p.t - q.t);
  let b = nowMin != null ? Math.min(a + 60, nowMin) : a + 60;
  if (endAtLastScan && list.length) b = Math.min(b, Math.max(a, list[list.length - 1].t));
  const span = (x, y) => { const s = Math.max(x, a), e = Math.min(y, b); if (e <= s) return 0; return e - s - (extra ? 0 : offMinOf(sh, s, e)); };
  const run = new Map();
  const add = (k, v) => run.set(k, (run.get(k) || 0) + v);
  // Each scan's piece is credited with the time since the scan before it (the previous scan in this hour, or the hour start),
  // and the time after the last scan goes to the model still on the line. The pieces of time do not overlap, so the
  // models' minutes always add up to the hour (cycleSeconds of a first scan can hold a whole night or another model's run).
  const estimated = !list.length;
  const hourMin = span(a, b);
  if (!estimated) {
    let prev = a;
    for (const x of list) { add(x.mm, span(prev, x.t)); prev = Math.max(prev, x.t); }
    add(list[list.length - 1].mm, span(prev, b));
  } else {
    const tot = totalMin ?? hourMin;
    const w = models.map((m) => (m.std ? (Number(m.quantity) || 0) * m.std : Number(m.quantity) || 0));
    const W = w.reduce((x, y) => x + y, 0);
    models.forEach((m, i) => add(String(m.mmId), W > 0 ? (tot * w[i]) / W : 0));
  }
  // never more than the hour's time
  { const T = [...run.values()].reduce((x, y) => x + y, 0), cap = totalMin != null ? Math.min(totalMin, hourMin || totalMin) : hourMin;
    if (T > cap && T > 0) for (const [k, v] of run) run.set(k, (v * cap) / T); }
  const totalRun = [...run.values()].reduce((x, y) => x + y, 0);
  const stopOf = new Map(); let shared = 0;
  for (const s of stops || []) {
    const n = Number(s.min) || 0; if (!n) continue;
    const m = models.find((x) => x.model === s.model);
    if (m) stopOf.set(String(m.mmId), (stopOf.get(String(m.mmId)) || 0) + n); else shared += n;
  }
  const rows = models.map((m) => {
    const k = String(m.mmId), runMin = run.get(k) || 0, qty = Number(m.quantity) || 0;
    const stopMin = Math.min(runMin, (stopOf.get(k) || 0) + (totalRun > 0 ? (shared * runMin) / totalRun : 0));
    const stdMin = m.std ? (qty * m.std) / 60 : null;
    return { mmId: m.mmId, model: m.model, qty, runMin, stopMin, stdMin, lostMin: stdMin == null ? null : Math.max(0, runMin - stopMin - stdMin) };
  });
  // 21-11-2026 (final): each model is judged on its own time — a model that ran slower than its std has its own lost
  // minutes to explain, even when another model ran faster in the same hour (its target = its run time ÷ std cycle, so
  // "Short 3" in the model table and its lost minutes always tell the same story)
  const sum = (k) => rows.reduce((x, r) => x + (r[k] || 0), 0);
  return { rows, runMin: sum('runMin'), stdMin: sum('stdMin'), lostMin: sum('lostMin'), estimated };
}

/**
 * 23-11-2026: the target of every hour from its scans — the same number the hour form shows model by model.
 * An hour whose scans are read: target = Σ (minutes each model ran ÷ its std cycle); a model without a cycle time gets none
 * (an hour of only such models has no target). An hour whose scans are not read (yet) keeps `base` (pieces-weighted).
 *   rows: the day's hour rows · byHour: { hour: scans[] } · base: { hour: target } → { by, day }
 */
export function scanHourTargets(rows, byHour, base = {}, { nowMin = null, lastScanHour = null, shift = null, dayCyc = null } = {}) {
  const by = { ...base };
  for (const r of rows || []) {
    if (r.future || r.extra || r.closed || !(r.totalMin > 0) || !(r.qty > 0)) continue;
    const sc = byHour?.[r.hour];
    if (!Array.isArray(sc) || !sc.length) continue;
    const mt = modelTimeOfHour({ hour: r.hour, scans: sc, models: r.models, stops: [], totalMin: r.totalMin, nowMin, shift, endAtLastScan: r.hour === lastScanHour });
    if (mt.estimated) continue;
    let t = 0, any = false;
    for (const x of mt.rows) {
      const m = (r.models || []).find((y) => String(y.mmId) === String(x.mmId));
      // 25-11-2026: a model without a cycle time → the line's average cycle of the day (dayCyc), as the day plan
      const cyc = m && Number(m.std) > 0 ? Number(m.std) : dayCyc;
      if (m && cyc > 0 && Number(m.quantity) > 0) { t += (x.runMin * 60) / cyc; any = true; }
    }
    by[r.hour] = any ? Math.round(t) : null;
  }
  const day = Object.values(by).reduce((a, v) => a + (v || 0), 0);
  return { by, day: day || null };
}

/* ───────────── model by model (OLE Overview, Monthly OLE) ───────────── */
/** model by model (per line): pieces, std cycle, actual cycle (its share of the run time of its hours), target, time lost */
/** fewer pieces than this in the period: the model's cycle is not judged */
const fewPcsBelow = () => oleConfig().fewPcs || 5;   // admin: "Few pieces below" (Setup → OLE formulas)
export function modelPerf(R, ids) {
  const m = new Map();
  // 25-11-2026: a model's target = its share of the day plan (HPR / SAWM KPI, utils/dayPlan.js), so the model-wise
  // targets add up to the line's Plan Target Qty
  const planOf = new Map();
  for (const d of R?.days || []) for (const l of ids) for (const [name, x] of Object.entries(d.byLine[l]?.plan?.byModel || {})) {
    const k = `${l}|${name}`; planOf.set(k, (planOf.get(k) || 0) + (x.plan || 0));
  }
  for (const d of R?.days || []) for (const l of ids) for (const r of d.byLine[l]?.rows || []) {
    if (!(r.qty > 0) || !(r.actualMin > 0)) continue;
    for (const x of r.models || []) {
      const q = Number(x.quantity) || 0; if (!q) continue;
      const k = `${l}|${x.model}`;
      const o = m.get(k) || { key: k, line: String(l), model: x.model || '—', qty: 0, actSec: 0, stdSec: 0, stdQty: 0 };
      o.qty += q; o.actSec += r.actualMin * 60 * (q / r.qty);
      if (x.std) { o.stdSec += q * x.std; o.stdQty += q; }
      m.set(k, o);
    }
  }
  const rows = [...m.values()].map((o) => {
    const std = o.stdQty ? o.stdSec / o.stdQty : null, act = o.qty ? o.actSec / o.qty : null;
    const target = planOf.has(o.key) ? (planOf.get(o.key) > 0 ? planOf.get(o.key) : null) : std ? o.actSec / std : null;   // whole pieces below
    const lostMin = std ? (o.actSec * (o.stdQty / o.qty) - o.stdSec) / 60 : null;
    // a model with fewer than FEW_PCS pieces has no real cycle — its "actual" is only its share of the hour,
    // so its Actual CT / Var. / Target vs Actual are not judged (shown greyed, at the end); its time still counts in the totals
    const few = o.qty < fewPcsBelow();
    return { ...o, std, act, target, short: target == null ? null : o.qty - target, ach: target ? o.qty / target : null, var: std && act ? (act - std) / std : null, lostMin, few };
  }).sort((a, b) => (a.few - b.few) || ((b.lostMin ?? -1e9) - (a.lostMin ?? -1e9)));
  // whole pieces per line by the largest remainder: the models' targets add up exactly to the line's plan
  const byLine = new Map();
  for (const x of rows) { const a = byLine.get(x.line) || []; a.push(x); byLine.set(x.line, a); }
  for (const list of byLine.values()) {
    const has = list.filter((x) => x.target != null);
    const sum = Math.round(has.reduce((a, x) => a + x.target, 0));
    const base = has.map((x) => Math.floor(x.target));
    let left = sum - base.reduce((a, v) => a + v, 0);
    has.map((x, i) => [x.target - base[i], i]).sort((p, q) => q[0] - p[0]).forEach(([, i]) => { if (left > 0) { base[i] += 1; left -= 1; } });
    has.forEach((x, i) => { x.target = base[i] > 0 ? base[i] : null; x.short = x.target == null ? null : x.qty - x.target; x.ach = x.target ? x.qty / x.target : null; });
  }
  return rows;
}

/**
 * 20-11-2026: the target of an hour shared over its models — by the time each model took: from the scans (runMin ÷ cycle),
 * else by its pieces (23-11-2026: the time-true share, see below). Whole pieces, the shares add up to the hour target (largest remainder).
 * models = [{ model, qty, cycle }] → [{ model, qty, cycle, target }]
 */
export function splitHourTarget(target, models) {
  const list = (models || []).map((m) => ({ ...m, qty: Number(m.qty) || 0, cycle: Number(m.cycle) > 0 ? Number(m.cycle) : null }));
  if (!(target > 0) || !list.length) return list.map((m) => ({ ...m, target: null }));
  const cs = list.filter((m) => m.cycle).map((m) => m.cycle);
  // 21-11-2026: a model with no cycle time (not in the model master) gets NO target and takes no share of the hour target
  // (the hour target is made only for the models with a cycle time); an hour of only such models: no target at all
  if (cs.length && cs.length < list.length) {
    const own = splitHourTarget(target, list.filter((m) => m.cycle));
    let k = 0;
    return list.map((m) => (m.cycle ? own[k++] : { ...m, target: null }));
  }
  if (!cs.length) {
    // every model without a cycle (HPR: never — fillNoStd gives them the line average): shared by pieces
    const W = list.reduce((a, m) => a + m.qty, 0);
    return W > 0 ? spread(list, list.map((m) => (target * m.qty) / W), target) : spread(list, list.map(() => target / list.length), target);
  }
  // with the minutes each model ran (from the scans, runMin) a model's target = the time it ran ÷ its std cycle
  // (3 min at 20 s → 9 pcs) — exactly, so its Short / Excess tells the same story as its lost minutes;
  // without them (23-11-2026, cross-check of the reports): the hour target shared by PIECES. The hour target is the working
  // time ÷ the pieces-weighted std cycle, so a model's share by pieces gives it exactly the time its pieces need at std
  // (target × cycle = the hour's time × its share of the std time); sharing by pieces × cycle counted the cycle twice
  // (a 24 s model got 84 of 160 for 76 pieces instead of 78) and the HPR and SAWM KPI gave different plans per model
  const byTime = list.every((m) => Number(m.runMin) >= 0 && m.runMin != null) && list.some((m) => m.runMin > 0);
  if (byTime) { const raw = list.map((m) => (Number(m.runMin) * 60) / m.cycle); return spread(list, raw, raw.reduce((a, v) => a + v, 0)); }
  const w = list.map((m) => m.qty);
  const W = w.reduce((a, v) => a + v, 0);
  if (!(W > 0)) { const each = list.map(() => target / list.length); return spread(list, each, target); }
  return spread(list, w.map((v) => (target * v) / W), target);
}
function spread(list, raw, target) {
  const base = raw.map((v) => Math.floor(v));
  let left = Math.round(target) - base.reduce((a, v) => a + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k][1]] += 1;
  return list.map((m, i) => ({ ...m, target: base[i] }));
}
