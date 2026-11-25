/**
 * 25-11-2026: ONE plan of a line-day for every screen and report — Plant Efficiency (Plan Target Qty, its model-wise and
 * hour-wise targets), OLE pages, SAWM KPI and HPR all show the same number.
 *   hour plan = the HPR hour target (minutes the hour worked ÷ the cycle of its models; lunch and tea breaks out),
 *               rounded as the HPR shows it;
 *   the day ends at the line's last scan (endMin, a finished day) — the hours after it have no plan;
 *   pieces made outside the shift (after 21:00, before 09:00) count as actual with no plan;
 *   an hour without pieces (line stopped inside the day) keeps its plan: it goes to the models of the hour before it.
 * rows = oleLineDay rows ({ hour, qty, models, extra, future, closed, afterLast }) → { total, byHour, byModel } | null
 */
import { buildTargetDay, targetOf } from './targets';
import { fillNoStd } from './hpr';

export function dayPlanOf({ rows, targets = {}, shift = null, endMin = null }) {
  const live = (rows || []).filter((r) => !r.closed && !r.future);
  if (!live.some((r) => (r.qty || 0) > 0)) return null;
  const tg = fillNoStd(targets || {}, live).targets;   // a model with no std cycle → the line's average of the day
  const td = buildTargetDay({ hours: live.map((r) => ({ hour: r.hour, quantity: r.qty, models: r.models || [] })), shift, targets: tg, nowMin: endMin });
  const after = new Set((rows || []).filter((r) => r.afterLast).map((r) => r.hour));
  const M = new Map();
  const mOf = (name, mmId) => { const o = M.get(name) || { model: name, mmId, plan: 0, qty: 0, cycle: targetOf(tg, mmId) }; M.set(name, o); return o; };
  for (const r of live) for (const m of r.models || []) { const q = Number(m.quantity) || 0; if (q > 0) mOf(m.model || `#${m.mmId}`, m.mmId).qty += q; }
  const addPlan = (ms, plan) => { const tot = ms.reduce((a, m) => a + m.qty, 0); for (const m of ms) mOf(m.model || `#${m.mmId}`, m.mmId).plan += (plan * m.qty) / tot; };
  const byHour = {};
  let mix = null, total = 0;
  const pending = [];
  // 25-11-2026 (admin): an hour that made no piece has no target (line stopped) — on every screen and report alike
  const made = new Map(live.map((r) => [r.hour, Number(r.qty) || 0]));
  for (const h of td.rows) {
    if (h.future || after.has(h.hour) || h.outside || !(h.plan > 0) || !(made.get(h.hour) > 0)) continue;
    const hp = Math.round(h.plan);
    byHour[h.hour] = hp; total += hp;
    const own = (h.models || []).filter((m) => m.qty > 0 && m.target);
    if (own.length) { mix = own; for (const p of pending.splice(0)) addPlan(own, p); addPlan(own, hp); }
    else if (mix) addPlan(mix, hp);
    else pending.push(hp);
  }
  return { total, byHour, byModel: Object.fromEntries([...M.values()].map((m) => [m.model, m])), targets: tg };
}
