/**
 * Model-wise targets.
 *   A target is a target cycle in seconds per piece for one model of a line (pieces per hour = 3600 ÷ cycle).
 *   Hour target = working seconds of the hour (lunch excluded) ÷ target cycle of the models that ran in it
 *   (weighted by their quantity, so a mixed hour gets a mixed target).
 */
import { segments, shiftHours, workSecInHour, lunchMinInHour, hourSpanLabel, normShift, breakMinOf } from './shift';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Target cycle (s / pc) of a model, or null. targets = { [mmId]: { cycle } }. */
export function targetOf(targets, mmId) {
  if (mmId == null) return null;
  const c = num(targets?.[String(mmId)]?.cycle);
  return c > 0 ? c : null;
}
export const pphOf = (cycle) => (cycle > 0 ? 3600 / cycle : null);
export const cycleOfPph = (pph) => (pph > 0 ? Math.round((3600 / pph) * 100) / 100 : null);

/**
 * Target cycle of a model mix: Σ(qty × target cycle) ÷ Σ qty over the models that have a target.
 * Returns { cycle, covered (qty with a target), total }.
 */
export function mixTarget(models, targets) {
  let q = 0, s = 0, total = 0;
  for (const m of models || []) {
    const mq = Number(m.qty ?? m.quantity) || 0;
    total += mq;
    const t = targetOf(targets, m.mmId);
    if (t && mq > 0) { q += mq; s += mq * t; }
  }
  return { cycle: q > 0 ? s / q : null, covered: q, total };
}

/** Status of actual vs target: 'ok' ≥ 100 %, 'watch' ≥ 90 %, 'behind' below, null without target. */
export function status(actual, plan) {
  if (!(plan > 0)) return null;
  const r = actual / plan;
  return r >= 1 ? 'ok' : r >= 0.9 ? 'watch' : 'behind';
}

/**
 * Focus day: actual vs model-wise target, hour by hour and per part of the day (segment 1, lunch, segment 2).
 *   hours  = day_overview hourly rows [{hour, quantity, avgActualCycleSeconds, models:[{mmId, model, quantity}]}]
 *   nowMin = minutes of the day when the day is today (target only up to now), otherwise null (whole day)
 *   fallbackCycle = target used for hours without a running model (e.g. the running model's target)
 * An idle hour inside the shift keeps the target of the model before it, so lost time shows as a shortfall.
 */
export function buildTargetDay({ hours, shift, targets, nowMin = null, fallbackCycle = null, lunchByHour = null }) {
  const sh = shift;   // 'HH:MM' shift; the helpers normalise it themselves
  const byHour = new Map((hours || []).map((h) => [Number(h.hour), h]));
  const list = [...new Set([...shiftHours(sh), ...[...byHour.values()].filter((h) => (h.quantity || 0) > 0).map((h) => Number(h.hour))])].sort((a, b) => a - b);

  // target cycle per hour from its model mix; idle hours take the previous (else the next) known target
  const own = list.map((h) => mixTarget(byHour.get(h)?.models, targets));
  const known = own.map((o) => o.cycle);
  const carried = known.map((c, i) => {
    if (c) return c;
    if (own[i].total > 0) return null;   // pieces made but no model of the hour has a target: not defined (—), not borrowed
    for (let j = i - 1; j >= 0; j--) if (known[j]) return known[j];
    for (let j = i + 1; j < known.length; j++) if (known[j]) return known[j];
    return fallbackCycle > 0 ? fallbackCycle : null;
  });

  const parts = segments(sh);
  const nsh = normShift(sh);   // tea breaks are taken out of each part's working time
  const rows = list.map((h, i) => {
    const r = byHour.get(h) || {};
    // scans inside the lunch window are counted as lunch, not as output of the worked part of the hour
    const lunchQty = lunchByHour ? Math.min(Number(r.quantity) || 0, Number(lunchByHour[String(h)]) || 0) : 0;
    const qty = (Number(r.quantity) || 0) - lunchQty;
    const fullSec = workSecInHour(sh, h);
    const workSec = workSecInHour(sh, h, nowMin);
    const future = nowMin != null && h * 60 >= nowMin;
    const running = nowMin != null && !future && nowMin < h * 60 + 60;
    const tc = carried[i];
    // a model WITHOUT a target (not in the master / no cycle) adds nothing to the hour's target and is not counted against
    // it: the target covers only the share of the hour its models WITH a target took (by their pieces);
    // its own pieces are shown on their own (noTgtQty) so the screen says which part of the hour had no target
    const share = own[i].total > 0 ? own[i].covered / own[i].total : 1;
    const noTgtQty = own[i].total > 0 ? Math.min(qty, Math.round(qty * (1 - share))) : 0;
    const tgtQty = qty - noTgtQty;
    const noTgtModels = (r.models || []).filter((m) => (Number(m.quantity ?? m.qty) || 0) > 0 && !targetOf(targets, m.mmId)).map((m) => m.model).filter(Boolean);
    const plan = tc && workSec > 0 ? (workSec * share) / tc : (tc ? 0 : null);
    const planFull = tc && fullSec > 0 ? (fullSec * share) / tc : (tc ? 0 : null);
    const cyc = num(r.avgActualCycleSeconds);
    // share of the hour's working time in each part (quantity and target are split the same way)
    const split = {};
    for (const p of parts) {
      const a = Math.max(h * 60, p.from), b = Math.min(h * 60 + 60, p.to);
      split[p.key] = p.work && b > a ? Math.max(0, b - a - breakMinOf(nsh, a, b)) * 60 : 0;
    }
    return {
      hour: h, label: hourSpanLabel(sh, h), qty, lunchQty, workSec, fullSec, lunchMin: lunchMinInHour(sh, h),
      outside: fullSec === 0, future, running,
      models: (r.models || []).map((m) => ({ mmId: m.mmId, model: m.model, qty: Number(m.quantity ?? m.qty) || 0, target: targetOf(targets, m.mmId) })),
      targetCycle: tc, targetFromMix: !!own[i].cycle, covered: own[i].covered, plan, planFull,
      share, tgtQty, noTgtQty, noTgtModels, tgtSec: tc ? workSec * share : 0,
      diff: plan != null && !future ? tgtQty - plan : null,
      pct: plan > 0 && !future ? (tgtQty / plan) * 100 : null,
      status: future ? 'future' : status(tgtQty, plan),
      cycle: cyc, cycleDiff: cyc != null && tc ? cyc - tc : null, split,
    };
  });

  // per part of the day
  const part = {};
  for (const p of parts) {
    const o = { key: p.key, label: p.label, from: p.from, to: p.to, work: p.work, qty: 0, tgtQty: 0, plan: 0, planFull: 0, hasPlan: false };
    for (const r of rows) {
      const w = r.split[p.key];
      if (r.fullSec > 0 && w > 0) {
        o.qty += r.qty * (w / r.fullSec);
        o.tgtQty += r.tgtQty * (w / r.fullSec);
        if (r.targetCycle) {
          o.hasPlan = true;
          o.planFull += (w * r.share) / r.targetCycle;
          const c0 = Math.max(r.hour * 60, p.from), c1 = nowMin == null ? 0 : Math.min(nowMin, r.hour * 60 + 60, p.to);
          const nowCut = nowMin == null ? w : Math.max(0, Math.min(w, (c1 - c0 - (c1 > c0 ? breakMinOf(nsh, c0, c1) : 0)) * 60));
          o.plan += (nowCut * r.share) / r.targetCycle;
        }
      }
    }
    // lunch: no target; its scans are shown on their own (null when the lunch counts are not known)
    o.qty = p.work ? Math.round(o.qty) : (lunchByHour ? rows.reduce((s2, r) => s2 + (r.lunchQty || 0), 0) : null);
    o.tgtQty = p.work ? Math.round(o.tgtQty) : o.qty;
    o.noTgtQty = p.work ? Math.max(0, o.qty - o.tgtQty) : 0;
    o.diff = o.hasPlan ? o.tgtQty - o.plan : null;
    o.pct = o.hasPlan && o.plan > 0 ? (o.tgtQty / o.plan) * 100 : null;
    o.status = o.hasPlan ? status(o.tgtQty, o.plan) : null;
    o.started = nowMin == null || nowMin > p.from;
    o.done = nowMin == null || nowMin >= p.to;
    part[p.key] = o;
  }

  const lunchQty = rows.reduce((s, r) => s + (r.lunchQty || 0), 0);
  const qty = rows.reduce((s, r) => s + r.qty, 0) + lunchQty;   // all production of the day, lunch scans included
  const noTgtQty = rows.reduce((s, r) => s + (r.noTgtQty || 0), 0);   // pieces of models without a target: not compared
  const tgtQty = qty - noTgtQty;
  const outsideQty = rows.reduce((s, r) => s + (r.outside ? r.qty : 0), 0);
  const plan = rows.reduce((s, r) => s + (r.plan || 0), 0);
  const planFull = rows.reduce((s, r) => s + (r.planFull || 0), 0);
  const hasPlan = rows.some((r) => r.targetCycle);
  return {
    rows, parts: parts.map((p) => part[p.key]),
    total: {
      qty, tgtQty, noTgtQty, lunchQty, outsideQty, plan: hasPlan ? plan : null, planFull: hasPlan ? planFull : null,
      diff: hasPlan ? tgtQty - plan : null, pct: hasPlan && plan > 0 ? (tgtQty / plan) * 100 : null,
      status: hasPlan ? status(tgtQty, plan) : null,
      // pace: pieces still needed per remaining working hour to reach the day target
      remainingSec: nowMin == null ? 0 : rows.reduce((s, r) => s + Math.max(0, r.fullSec - r.workSec), 0),
    },
    hasPlan,
  };
}

/** Required pieces per hour for the rest of the day to still reach the day target. */
export function requiredRate(total) {
  if (!total || total.planFull == null || !(total.remainingSec > 0)) return null;
  return Math.max(0, total.planFull - (total.tgtQty ?? total.qty)) / (total.remainingSec / 3600);
}

/**
 * History of one model, day by day (range_overview with mmId) compared with its target.
 * days = [{date, quantity, activeHours, avgActualCycleSeconds}] → rows with achieved pcs/hr, target pcs/hr and differences.
 */
export function historyRows(days, targetCycle) {
  const tp = pphOf(targetCycle);
  return (days || []).filter((d) => (Number(d.quantity) || 0) > 0).map((d) => {
    const qty = Number(d.quantity) || 0, hrs = num(d.activeHours), cyc = num(d.avgActualCycleSeconds);
    const pph = hrs > 0 ? qty / hrs : null;
    return {
      date: d.date, qty, activeHours: hrs, pph, cycle: cyc,
      targetCycle: targetCycle || null, targetPph: tp,
      cycleDiff: cyc != null && targetCycle ? cyc - targetCycle : null,
      cyclePct: cyc != null && targetCycle ? (cyc / targetCycle) * 100 : null,
      pphDiff: pph != null && tp ? pph - tp : null,
      targetQty: hrs > 0 && tp ? hrs * tp : null,
      status: cyc != null && targetCycle ? (cyc <= targetCycle ? 'ok' : cyc <= targetCycle * 1.1 ? 'watch' : 'behind') : null,
    };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Model-wise split of one hour: each model's share of the hour's target in proportion to the time it needs at its
 * own target cycle (qty × target cycle). Target pieces of a model = working seconds × its qty ÷ Σ(qty × target cycle).
 */
export function splitHour(r) {
  // a model without a target gets no share of the target; hours without model detail keep the hour's cycle
  const tcOf = (m) => m.target || (r.models.some((x) => x.target) ? null : r.targetCycle) || null;
  // scans made during lunch are not part of the hour's output: the models' quantities are scaled to the hour's qty
  const tot = r.models.reduce((s, m) => s + m.qty, 0);
  const f = tot > 0 && r.qty != null && r.qty < tot ? r.qty / tot : 1;
  const ms = r.models.map((m) => ({ ...m, rawQty: m.qty, qty: Math.round(m.qty * f * 10) / 10 }));
  const need = ms.reduce((s, m) => s + (tcOf(m) ? m.qty * tcOf(m) : 0), 0);
  return ms.map((m) => {
    const tc = tcOf(m);
    const plan = !r.future && need > 0 && tc && r.workSec > 0 ? (r.workSec * (r.share ?? 1) * m.qty) / need : null;
    return { ...m, tc, plan, diff: plan != null ? m.qty - plan : null, pct: plan > 0 ? (m.qty / plan) * 100 : null, min: tc ? (m.qty * tc) / 60 : null };
  });
}

/** Model-wise day total: qty, target pieces and difference of every model over the day's hours. */
export function modelDay(day) {
  const by = new Map();
  for (const r of day.rows) for (const m of splitHour(r)) {
    const k = String(m.mmId ?? m.model);
    const o = by.get(k) || { mmId: m.mmId, model: m.model, tc: m.tc, qty: 0, plan: 0, hasPlan: false, hours: 0, min: 0 };
    o.qty += m.qty; o.hours += 1; if (m.plan != null) { o.plan += m.plan; o.hasPlan = true; } if (m.min) o.min += m.min; if (m.tc) o.tc = m.tc;
    by.set(k, o);
  }
  return [...by.values()].map((o) => ({ ...o, plan: o.hasPlan ? o.plan : null, diff: o.hasPlan ? o.qty - o.plan : null, pct: o.hasPlan && o.plan > 0 ? (o.qty / o.plan) * 100 : null }))
    .sort((a, b) => b.qty - a.qty);
}

/**
 * Model-wise actual cycle of one day from each model's own scans (model_control.php, one line, one day):
 * gap between two pieces of the SAME model, gaps 1..cap s only (longer = stop / other model ran in between),
 * mean and median of those gaps. A model with fewer than `few` pieces gets few: true — its number is shown
 * but is not reliable (one long gap moves it a lot); its target cycle still applies.
 * → { [mmId]: { qty, valid, mean, median, few } }
 */
export function modelActualCycles(models, date, cap = 22, few = 10) {
  const out = {};
  for (const m of models || []) {
    const d = m.days?.[date];
    if (!d) continue;
    const g = (d.g || []).filter((x) => x >= 1 && x <= cap).sort((a, b) => a - b);
    const qty = Number(d.q) || 0;
    const mean = g.length ? g.reduce((s, x) => s + x, 0) / g.length : null;
    const median = g.length ? (g.length % 2 ? g[(g.length - 1) / 2] : (g[g.length / 2 - 1] + g[g.length / 2]) / 2) : null;
    // per hour (hour of the later scan of the pair, same as the hour's qty): running time = sum of the valid gaps
    // (1..cap s, stops and other models' runs left out) and the model's own average cycle in that hour
    const byHour = {};
    const gs = d.g || [], hs = d.h || [];
    for (let i = 0; i < gs.length; i++) {
      const x = gs[i], h = hs[i];
      if (h == null || !(x >= 1 && x <= cap)) continue;
      const o = byHour[h] || (byHour[h] = { n: 0, sec: 0 });
      o.n++; o.sec += x;
    }
    for (const o of Object.values(byHour)) { o.mean = o.sec / o.n; o.min = o.sec / 60; }
    out[String(m.mmId).replace(/^L\d+-/, '')] = { qty, valid: g.length, mean, median, few: qty < few, byHour };
  }
  return out;
}

/**
 * The hour bars' plan: { targets: {hour: pcs}, noTarget: {hour: {qty, models}} } — noTarget = pieces of models without a
 * target in that hour (not in the master / no cycle): shown on their own, not compared with the target.
 */
export function hourPlanOf({ hours, hourModels = null, shift, targets, nowMin = null, fallbackCycle = null, lunchByHour = null }) {
  if (!hours?.length) return null;
  const hs = hourModels?.length && !hours.some((h) => h.models?.length)
    ? hours.map((h) => ({ ...h, models: hourModels.filter((m) => Number(m.hour) === Number(h.hour)).map((m) => ({ mmId: m.mmId, model: m.model, quantity: m.qty })) }))
    : hours;
  const day = buildTargetDay({ hours: hs, shift, targets, nowMin, fallbackCycle, lunchByHour });
  const m = {}; const no = {};
  for (const r of day.rows) {
    if (r.noTgtQty > 0) no[r.hour] = { qty: r.noTgtQty, models: r.noTgtModels || [] };
    if (r.future) continue;
    // 24-11-2026: an hour with no production (line stopped / not started) has no target — not on its bar, not in the day's sum
    if (!(Number(r.qty) > 0)) continue;
    const v = r.plan ?? r.planFull; if (v != null && v > 0) m[r.hour] = Math.round(v);
  }
  return { targets: m, noTarget: no };
}
