/**
 * Daily target and loss in rupees, per line and day (Main view).
 *
 *   Day target   = hour by hour: working seconds of the hour (lunch excluded, today only up to now)
 *                  ÷ target cycle of the models made in that hour (quantity-weighted) — the same rule as the line page.
 *   Short pcs    = target − actual (0 when the target is reached).
 *   Lost time    = short pcs × average target cycle of the day.
 *   ₹ pieces     = short pcs × ₹ per piece (model value, else the line's default value; quantity-weighted over the day).
 *   ₹ line time  = lost time (hours) × ₹ per line-hour (manpower + overhead).
 *   ₹ total      = ₹ pieces + ₹ line time (each only when its rate is set).
 *
 * Input rows come from all_lines.php: dhm [[date, hour, mmId, qty]] and mmCo {mmId: company}.
 */
import { buildTargetDay, targetOf } from './targets';
import { settingsOn } from './targetPeriods';
import { normShift } from './shift';
import { serverNow } from './serverTime';

const pad = (n) => String(n).padStart(2, '0');
/** Date as YYYY-MM-DD; default = DB server ki aaj ki date (browser ka clock nahi). */
export const localDate = (d = serverNow()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const SKIP_PCT = 5;
const N = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** ₹ per piece of a model: its own value, else the line default (null when neither is set). */
export function rateOf(money, mmId) {
  const v = N(money?.values?.[String(mmId)]);
  if (v > 0) return v;
  const d = N(money?.pcValue);
  return d > 0 ? d : null;
}
export const hasRates = (money) => N(money?.pcValue) > 0 || N(money?.hourCost) > 0 || Object.values(money?.values || {}).some((v) => N(v) > 0);

/** "₹ 1,23,456" (Indian grouping); large values shortened: "₹ 12.4 L", "₹ 1.25 Cr". */
export function rupees(v, { short = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (short && a >= 1e7) return `${s}₹ ${(a / 1e7).toFixed(2)} Cr`;
  if (short && a >= 1e5) return `${s}₹ ${(a / 1e5).toFixed(1)} L`;
  return `${s}₹ ${Math.round(a).toLocaleString('en-IN')}`;
}

/** dhm rows → { date: [{hour, quantity, models:[{mmId, model, quantity}]}] } */
export function groupDhm(dhm, { names = {}, keep = null } = {}) {
  const out = {};
  for (const r of dhm || []) {
    const [d, h, m, q] = r;
    if (keep && !keep(m)) continue;
    const day = (out[d] = out[d] || {});
    const hr = (day[h] = day[h] || { hour: h, quantity: 0, models: [] });
    hr.quantity += q;
    const ex = hr.models.find((x) => x.mmId === m);
    if (ex) ex.quantity += q; else hr.models.push({ mmId: m, model: names[m] || String(m), quantity: q });
  }
  return Object.fromEntries(Object.entries(out).map(([d, hs]) => [d, Object.values(hs).sort((a, b) => a.hour - b.hour)]));
}

/**
 * Target and loss of one line on one day.
 *   hours    = [{hour, quantity, models:[{mmId, quantity}]}]
 *   settings = { shift, targets, money }
 *   nowMin   = minutes of the day for today (target only up to now), else null
 *   fallbackCycle = target cycle for a day without production yet (today)
 */
export function dayLoss({ date, hours, settings, nowMin = null, fallbackCycle = null, rej = 0 }) {
  const shift = settings?.shift, targets = settings?.targets || {}, money = settings?.money || {};
  const td = buildTargetDay({ hours, shift, targets, nowMin, fallbackCycle });
  const actual = td.total.qty;
  // pieces of models with / without a target
  let qT = 0, qAll = 0, vSum = 0, vQ = 0;
  const models = {};
  for (const h of hours || []) for (const m of h.models || []) {
    const q = Number(m.quantity) || 0;
    qAll += q;
    const t = targetOf(targets, m.mmId);
    if (t) qT += q;
    const r = rateOf(money, m.mmId);
    if (r != null) { vSum += r * q; vQ += q; }
    const o = (models[m.mmId] = models[m.mmId] || { mmId: m.mmId, model: m.model, qty: 0, target: t, value: r });
    o.qty += q;
  }
  const base = { date, actual, rej, hasPlan: td.hasPlan, coverage: qAll ? (qT / qAll) * 100 : null, models: Object.values(models).sort((a, b) => b.qty - a.qty), td };
  if (!td.hasPlan) return { ...base, target: null, short: null, lostSec: null, rsPcs: null, rsTime: null, rsTotal: null, pct: null };
  const target = td.total.plan;
  // pieces of models without a target are not compared with the target: only the target models' share
  const tActual = td.total.tgtQty ?? actual;
  const workSec = td.rows.reduce((s, r) => s + (r.targetCycle ? (r.tgtSec ?? r.workSec) : 0), 0);
  const avgCycle = target > 0 ? workSec / target : null;
  const short = Math.max(0, target - tActual);
  const lostSec = avgCycle ? short * avgCycle : 0;
  const value = vQ > 0 ? vSum / vQ : (N(money.pcValue) > 0 ? N(money.pcValue) : null);
  const hourCost = N(money.hourCost) > 0 ? N(money.hourCost) : null;
  const rsPcs = value != null ? short * value : null;
  const rsTime = hourCost != null ? (lostSec / 3600) * hourCost : null;
  const rsTotal = rsPcs == null && rsTime == null ? null : (rsPcs || 0) + (rsTime || 0);
  return { ...base, target, pct: target > 0 ? (tActual / target) * 100 : null, short, extra: Math.max(0, tActual - target), lostSec, avgCycle, value, hourCost, rsPcs, rsTime, rsTotal, workSec };
}

/** Hour rows of a day with their own shortfall in pieces and ₹ (for the deep dive). */
export function hourLoss(dl) {
  if (!dl?.td) return [];
  return dl.td.rows.filter((r) => !r.future && (r.workSec > 0 || r.qty > 0)).map((r) => {
    const short = r.plan != null ? Math.max(0, r.plan - (r.tgtQty ?? r.qty)) : null;
    const lostSec = short != null && r.targetCycle ? short * r.targetCycle : null;
    const rsPcs = short != null && dl.value != null ? short * dl.value : null;
    const rsTime = lostSec != null && dl.hourCost != null ? (lostSec / 3600) * dl.hourCost : null;
    return { hour: r.hour, label: r.label, qty: r.qty, plan: r.plan, pct: r.pct, short, lostSec, cycle: r.targetCycle, models: r.models, workSec: r.workSec, outside: r.outside,
      rsPcs, rsTime, rsTotal: rsPcs == null && rsTime == null ? null : (rsPcs || 0) + (rsTime || 0) };
  });
}

/**
 * Loss register of the day split by reason: minutes → pieces (at the day's average target cycle) → ₹.
 * The part of the lost time that no entry explains is returned as "Not recorded".
 */
export function reasonLoss(dl, entries) {
  const by = new Map();
  for (const e of entries || []) {
    const k = e.reason || '(no reason)';
    const o = by.get(k) || { reason: k, dept: e.dept || '', minutes: 0, count: 0 };
    o.minutes += Number(e.minutes) || 0; o.count += 1; by.set(k, o);
  }
  const conv = (min) => {
    const pcs = dl?.avgCycle ? (min * 60) / dl.avgCycle : null;
    const rsPcs = pcs != null && dl.value != null ? pcs * dl.value : null;
    const rsTime = dl?.hourCost != null ? (min / 60) * dl.hourCost : null;
    return { pcs, rsPcs, rsTime, rsTotal: rsPcs == null && rsTime == null ? null : (rsPcs || 0) + (rsTime || 0) };
  };
  const rows = [...by.values()].sort((a, b) => b.minutes - a.minutes).map((o) => ({ ...o, ...conv(o.minutes) }));
  const recMin = rows.reduce((s, r) => s + r.minutes, 0);
  const lostMin = dl?.lostSec != null ? dl.lostSec / 60 : null;
  const open = lostMin != null ? Math.max(0, lostMin - recMin) : null;
  return { rows, recMin, lostMin, open: open != null ? { reason: 'Not recorded', minutes: open, ...conv(open) } : null };
}

/**
 * Loss of every line for every day of the period.
 *   lines    = all_lines.php lines (with dhm, mmCo, daily, models)
 *   settings = { [line]: {shift, targets, money} }
 *   now      = DB server ka time (serverNow), browser ka clock nahi
 * → { days: [date …] newest first, lines: [{line, name, ok, days: {date: dayLoss}, total}], dayTotal: {date: total}, grand }
 */
export function lossMatrix(lines, settings, { now = serverNow(), range = null } = {}) {
  const today = localDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const inRangeToday = !!range && range.start <= today && range.end >= today;
  const allDays = new Set();
  const out = [];
  for (const l of lines || []) {
    const st = settings?.[l.line] || {};
    const names = Object.fromEntries((l.models || []).map((m) => [m.mmId, m.model]));
    const g = groupDhm(l.dhm, { names });
    const rej = Object.fromEntries((l.daily || []).map((r) => [r.d, r.rej || 0]));
    const days = {};
    let lastCycle = null;
    const sh = normShift(st.shift);
    const dates = Object.keys(g).sort();
    for (const d of dates) {
      const dl = dayLoss({ date: d, hours: g[d], settings: settingsOn(st, d), nowMin: d === today ? nowMin : null, rej: rej[d] || 0 });   // the targets of that day's method
      // a finished day with almost no output (< 5 % of target: holiday, maintenance, trial pieces) is shown but not counted
      if (d !== today && dl.pct != null && dl.pct < SKIP_PCT) dl.skipped = true;
      if (dl.avgCycle) lastCycle = dl.avgCycle;
      days[d] = dl; allDays.add(d);
    }
    // today inside the period with no production yet, after the shift started: the whole time so far is lost
    if (l.ok && inRangeToday && !days[today] && lastCycle && nowMin > sh.start) {
      days[today] = dayLoss({ date: today, hours: [], settings: settingsOn(st, today), nowMin, fallbackCycle: lastCycle });
      allDays.add(today);
    }
    out.push({ line: l.line, name: l.name, ok: l.ok, error: l.error, days, total: sumLoss(Object.values(days)), money: st.money || {}, hasTargets: Object.keys(st.targets || {}).length > 0 });
  }
  const days = [...allDays].sort().reverse();
  const dayTotal = Object.fromEntries(days.map((d) => [d, sumLoss(out.map((l) => l.days[d]).filter(Boolean))]));
  return { days, lines: out, dayTotal, grand: sumLoss(out.flatMap((l) => Object.values(l.days))), today };
}

/** Sum of day losses (null stays null when no part has a value). Skipped days are left out. */
export function sumLoss(all) {
  const list = (all || []).filter((x) => x && !x.skipped);
  const add = (k) => { const v = list.map((x) => x?.[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const planned = list.filter((x) => x?.hasPlan);
  const target = planned.length ? planned.reduce((s, x) => s + x.target, 0) : null;
  const actualP = planned.reduce((s, x) => s + x.actual, 0);
  return {
    actual: list.reduce((s, x) => s + (x?.actual || 0), 0), actualPlanned: actualP, target, pct: target > 0 ? (actualP / target) * 100 : null,
    short: add('short'), lostSec: add('lostSec'), rsPcs: add('rsPcs'), rsTime: add('rsTime'), rsTotal: add('rsTotal'),
    days: list.length, plannedDays: planned.length, rej: list.reduce((s, x) => s + (x?.rej || 0), 0),
  };
}

/** Models without a target among those made in the period: [{line, mmId, model, company, qty}] */
export function missingTargets(lines, settings) {
  const out = [];
  for (const l of lines || []) {
    const t = settings?.[l.line]?.targets || {};
    for (const m of l.models || []) if (!targetOf(t, m.mmId)) out.push({ line: l.line, mmId: m.mmId, model: m.model, company: m.company, qty: m.qty });
  }
  return out.sort((a, b) => b.qty - a.qty);
}