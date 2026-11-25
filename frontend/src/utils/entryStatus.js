/**
 * 23-11-2026: how complete the entries of a line-day are — the Entry dashboard's matrix and % complete.
 * The same rules as the Loss / Quality entry pages:
 *  - an hour needs entries once it is over: not future, not running, not "no run" (after the last scan),
 *    not closed, not a lunch hour without pieces, not an extra hour without pieces
 *  - Loss is done when a stop / loss is written, "No loss" was saved, or the hour lost no time by the scans
 *    (No loss by itself); an extra hour (before / after the shift) has no loss to enter
 *  - Quality is done when a rejection / rework is written or "No defects" was saved
 *  - Morning entry: the line's morning entry of the day is saved
 */
import { isNoRun } from './ole';

/** a past hour that lost no time by its scans (speed and idle loss 0) — "No loss" by itself */
export const noLossHour = (r) => !r.future && !r.closed && r.qty > 0 && r.speedMin != null && Math.round(r.speedMin) <= 0 && Math.round(r.lossMin || 0) <= 0;

/**
 * One hour → { hour, loss, quality } with 'done' | 'auto' (No loss by itself) | 'pending' | 'running' | 'na' | 'future'.
 * nowMin: minutes of the day now (today only) · lastMin: the line's last scan of the day (minutes) or null.
 */
export function hourStatus(r, { nowMin = null, lastMin = null, today = false, lost = null, targets = null } = {}) {
  const e = r.e || { stops: [], losses: [], rejects: [], rework: [] };
  if (r.future) return { hour: r.hour, loss: 'future', quality: 'future' };
  const noRun = isNoRun(r, today ? nowMin : null) && (lastMin == null || r.hour * 60 >= lastMin);
  if (noRun || r.closed || (r.lunch && !r.qty) || (r.extra && !r.qty)) return { hour: r.hour, loss: 'na', quality: 'na' };
  const running = today && nowMin != null && (r.hour + 1) * 60 > nowMin;
  const hasLoss = e.stops.length + e.losses.length > 0;
  const hasQ = e.rejects.length + e.rework.length > 0;
  let loss;
  if (r.extra) loss = hasLoss ? 'done' : 'na';
  else if (hasLoss || e.noLoss) loss = 'done';
  else if (running) loss = 'running';
  // lost (when given) = { hour: minutes lost against std, model by model, from the hour's scans } — the Loss entry's own
  // check: a fast model never hides a slow one. An hour not checked yet stays pending.
  else if (targets && targetMet(r, targets[r.hour])) loss = 'auto';   // 23-11-2026: the hour's target achieved
  else if (noLossHour(r) && (!lost || lost[r.hour] === 0)) loss = 'auto';
  else loss = 'pending';
  const quality = hasQ || e.noQ ? 'done' : running ? 'running' : 'pending';
  return { hour: r.hour, loss, quality };
}

const isDone = (s) => s === 'done' || s === 'auto';
const counts = (S, k) => {
  const need = S.filter((x) => isDone(x[k]) || x[k] === 'pending').length;
  const done = S.filter((x) => isDone(x[k])).length;
  return { need, done, left: need - done, pct: need ? done / need : null };
};

/**
 * One line-day (oleDayLines row L) → { line, hours: [hourStatus], loss, quality, morning, all }
 * loss / quality / all = { need, done, left, pct }; morning = true / false; all counts the morning entry as one item.
 */
export function lineDayStatus(L, { morning = false, nowMin = null, lastMin = null, today = false, lost = null, targets = null } = {}) {
  if (!L?.ok) return { line: L?.line, ok: false, hours: [], loss: counts([], 'loss'), quality: counts([], 'quality'), morning, all: { need: 1, done: morning ? 1 : 0, left: morning ? 0 : 1, pct: morning ? 1 : 0 } };
  const tg = targets || hourTargets(L.rows).by;   // the hour targets of the Loss entry
  const hours = L.rows.map((r) => hourStatus(r, { nowMin, lastMin, today, lost, targets: tg }));
  const loss = counts(hours, 'loss'), quality = counts(hours, 'quality');
  const need = loss.need + quality.need + 1, done = loss.done + quality.done + (morning ? 1 : 0);
  return { line: L.line, ok: true, hours, loss, quality, morning, all: { need, done, left: need - done, pct: need ? done / need : null } };
}

/** many line-days → the same totals */
export function sumStatus(list) {
  const add = (k) => list.reduce((a, x) => ({ need: a.need + x[k].need, done: a.done + x[k].done }), { need: 0, done: 0 });
  const fin = (o) => ({ ...o, left: o.need - o.done, pct: o.need ? o.done / o.need : null });
  return { loss: fin(add('loss')), quality: fin(add('quality')), all: fin(add('all')), morning: { need: list.length, done: list.filter((x) => x.morning).length } };
}

/** the work left, oldest first: [{ date, line, hour, what: 'Loss' | 'Quality' | 'Morning' }] */
export function pendingList(days) {
  const out = [];
  for (const d of days) {
    for (const s of d.lines) {
      if (!s.morning) out.push({ date: d.date, line: s.line, hour: null, what: 'Morning' });
      for (const h of s.hours) {
        if (h.loss === 'pending') out.push({ date: d.date, line: s.line, hour: h.hour, what: 'Loss' });
        if (h.quality === 'pending') out.push({ date: d.date, line: s.line, hour: h.hour, what: 'Quality' });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.line).localeCompare(String(b.line)) || (a.hour ?? -1) - (b.hour ?? -1));
}

/** lost minutes of an hour = Σ of each model's whole minutes (what the loss form fills, row by row) */
export const lostWhole = (mt) => (mt?.rows || []).reduce((a, x) => a + (x.lostMin == null ? 0 : Math.round(x.lostMin)), 0);

/**
 * the target pieces of an hour = its working seconds ÷ the std cycle of what it made (weighted by
 * pieces); an hour without pieces takes the day's std cycle. → { hour: target } and the day's target.
 */
export function hourTargets(rows) {
  const run = rows.filter((r) => !r.future && !r.extra && !r.closed && r.totalMin > 0);
  const S = run.reduce((a, r) => a + (r.stdSec || 0), 0), C = run.reduce((a, r) => a + (r.qty - (r.noStdQty || 0)), 0);
  const dayCyc = C > 0 ? S / C : null;
  const by = {}, noCt = {};
  for (const r of run) {
    const q = Number(r.qty) || 0, n = Number(r.noStdQty) || 0, c = q - n;
    if (n > 0) noCt[r.hour] = n;
    // 25-11-2026 (admin): an hour that made no piece has no target (as every screen and report)
    if (!(q > 0)) continue;
    // 25-11-2026: a model without a cycle time takes the line's average cycle of the day (as the day plan, utils/dayPlan.js) —
    // before, its time got no target at all (14–15: 185 pcs against a target of 9)
    const cyc = dayCyc ? ((r.stdSec || 0) + n * dayCyc) / q : c > 0 && r.stdSec > 0 ? r.stdSec / c : null;
    by[r.hour] = cyc ? Math.round((r.totalMin * 60) / cyc) : null;
  }
  return { by, noCt, dayCyc, day: Object.values(by).reduce((a, v) => a + (v || 0), 0) || null };
}

/** 23-11-2026: the hour made its target (pieces ≥ target > 0) — "No loss" by itself, whatever a single model did */
export const targetMet = (r, target) => Number(target) > 0 && Number(r?.qty) >= Number(target);
