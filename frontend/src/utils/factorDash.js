/**
 * 26-11-2026: the figures of the Availability dashboard and the Performance dashboard (pages/FactorDashboardPage.jsx).
 * Same maths as OLE Overview / the Availability and Performance pages (utils/ole.js): A = run ÷ planned time,
 * P = std time of the output ÷ run time, idle time = the lost minutes of the hours, speed loss = run time beyond std.
 *   R   = oleRange(...) of the period · ids = the lines shown
 * → plain objects, no React (tests/factorDash.calc.test.js)
 */
import { oleSum, normEntry, modelPerf, planTargetOf, oleConfig, goodOf } from './ole';
import { deptOfRow } from './deptRules';

const ranT = (t) => !!t && ((t.plannedMin || 0) > 0 || (t.qty || 0) > 0);
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

/** every day of the period: the total of each line and of all the lines shown (days that never ran are left out) */
function dayTotals(R, ids) {
  return (R?.days || []).map((d) => {
    const by = {};
    for (const l of ids) by[l] = d.byLine[l]?.total || null;
    return { date: d.date, by, all: oleSum(ids.map((l) => d.byLine[l]?.total)) };
  }).filter((d) => ranT(d.all));
}

/** the rows of the hours that ran, line by line */
function* hourRows(R, ids) {
  for (const d of R?.days || []) for (const l of ids) for (const r of d.byLine[l]?.rows || []) {
    if (r.future || r.closed) continue;
    yield { d, l, r };
  }
}

/* ───────────── Availability ───────────── */
export function availDash(R, ids0) {
  const ids = (ids0 || []).map(String);
  const T = oleSum((R?.days || []).flatMap((d) => ids.map((l) => d.byLine[l]?.total)));
  const lines = Object.fromEntries(ids.map((l) => [l, { line: l, t: oleSum((R?.days || []).map((d) => d.byLine[l]?.total)), stops: 0, written: 0, reasons: new Map(), depts: new Map() }]));
  const reasons = new Map(), depts = new Map(), models = new Map(), heat = new Map();
  let stops = 0, written = 0;
  for (const { d, l, r } of hourRows(R, ids)) {
    const idle = (r.lossMin || 0);
    if (idle > 0) { const h = heat.get(l) || {}; h[r.hour] = (h[r.hour] || 0) + idle; heat.set(l, h); }
    const e = r.e || normEntry(r.entry);
    for (const x of [...e.stops, ...e.losses]) {
      const min = Number(x.min) || 0; if (!min) continue;
      const L = lines[l]; stops += 1; written += min; L.stops += 1; L.written += min;
      const k = x.reason || 'Not given', dk = deptOfRow(x, 'stop');
      add(L.reasons, k, min); add(L.depts, dk, min);
      const o = reasons.get(k) || { name: k, dept: dk, min: 0, n: 0, lines: new Set(), models: new Map() };
      o.min += min; o.n += 1; o.lines.add(l); if (x.model) add(o.models, x.model, min); reasons.set(k, o);
      (o.items = o.items || []).push({ date: d.date, line: String(l), hour: r.hour, model: x.model || '', dept: dk, min });   // 27-11-2026: a reason clicked → its entries
      const dp = depts.get(dk) || { name: dk, min: 0, n: 0, reasons: new Map() }; dp.min += min; dp.n += 1; add(dp.reasons, k, min); depts.set(dk, dp);
      if (x.model) { const m = models.get(x.model) || { name: x.model, min: 0, n: 0, reasons: new Map(), items: [] }; m.min += min; m.n += 1; add(m.reasons, k, min); models.set(x.model, m);
        m.items.push({ date: d.date, line: String(l), hour: r.hour, reason: k, dept: dk, min, note: x.note || x.remark || '' }); }   // 27-11-2026: a model clicked → every entry
    }
  }
  const days = dayTotals(R, ids).map((d) => ({ date: d.date, A: d.all.A, planned: d.all.plannedMin, run: d.all.actualMin, idle: d.all.lossMin, by: Object.fromEntries(ids.map((l) => [l, ranT(d.by[l]) ? d.by[l].A : null])) }));
  const L = ids.map((l) => {
    const x = lines[l];
    return { line: l, planned: x.t.plannedMin, run: x.t.actualMin, idle: x.t.lossMin, A: x.t.A, stops: x.stops, avg: x.stops ? x.written / x.stops : null,
      written: x.written, topReason: top(x.reasons), topDept: top(x.depts) };
  });
  const worstDay = days.filter((d) => d.A != null).sort((a, b) => a.A - b.A)[0] || null;
  return {
    total: { planned: T.plannedMin, run: T.actualMin, idle: T.lossMin, A: T.A, stops, written, avg: stops ? written / stops : null,
      notWritten: Math.max(0, T.lossMin - written), worstDay },
    days, lines: L,
    reasons: [...reasons.values()].map((o) => ({ ...o, lines: [...o.lines].sort(), models: [...o.models.entries()].map(([name, min]) => ({ name, min })).sort((a, b) => b.min - a.min) })).sort((a, b) => b.min - a.min),
    depts: [...depts.values()].map((o) => ({ ...o, top: top(o.reasons) })).sort((a, b) => b.min - a.min),
    models: [...models.values()].map((o) => ({ ...o, top: top(o.reasons) })).sort((a, b) => b.min - a.min),
    heat: ids.map((l) => ({ line: l, by: heat.get(l) || {} })),
  };
}

/* ───────────── Performance ───────────── */
const stdCt = (t) => { const n = (t?.qty || 0) - (t?.noStdQty || 0); return n > 0 && t.stdSec > 0 ? t.stdSec / n : null; };
const actCt = (t) => (t?.qty > 0 && t.actualMin > 0 ? (t.actualMin * 60) / t.qty : null);

export function perfDash(R, ids0) {
  const ids = (ids0 || []).map(String);
  const T = oleSum((R?.days || []).flatMap((d) => ids.map((l) => d.byLine[l]?.total)));
  const target = planTargetOf(T);
  const M = modelPerf(R, ids);
  const heat = new Map();   // line → hour → { qty, plan }
  // 26-11-2026: cycle time by hour of the day (all days of the period) and the reasons written as performance loss
  const ctH = new Map(), why = new Map();
  for (const { l, r } of hourRows(R, ids)) {
    if (r.qty > 0 && r.actualMin > 0) {
      const o = ctH.get(r.hour) || { hour: r.hour, actSec: 0, qty: 0, stdSec: 0, cov: 0 };
      o.actSec += r.actualMin * 60; o.qty += r.qty; o.stdSec += r.stdSec || 0; o.cov += (r.qty || 0) - (r.noStdQty || 0); ctH.set(r.hour, o);
    }
    const e = r.e || normEntry(r.entry);
    for (const x of e.losses || []) {
      const min = Number(x.min) || 0;
      if (!min || !x.model || oleConfig().lossIn === 'avail') continue;   // written against a model = performance loss (admin's choice)
      const k = x.reason || 'Not given';
      const w = why.get(k) || { name: k, min: 0, n: 0, models: new Map(), lines: new Set() };
      w.min += min; w.n += 1; w.lines.add(l); add(w.models, x.model, min); why.set(k, w);
    }
  }
  for (const { l, r } of hourRows(R, ids)) {
    if (!(r.qty > 0) && !(r.planQty > 0)) continue;
    const h = heat.get(l) || {}; const o = h[r.hour] || { qty: 0, plan: 0 };
    o.qty += r.qty || 0; o.plan += r.planQty > 0 ? r.planQty : 0; h[r.hour] = o; heat.set(l, h);
  }
  const days = dayTotals(R, ids).map((d) => {
    const tg = planTargetOf(d.all);
    return { date: d.date, P: d.all.P, qty: d.all.qty, target: tg, ach: tg ? d.all.qty / tg : null, speed: d.all.speedMin || 0,
      by: Object.fromEntries(ids.map((l) => [l, ranT(d.by[l]) ? d.by[l].P : null])), std: stdCt(d.all), act: actCt(d.all) };
  });
  const lines = ids.map((l) => {
    const t = oleSum((R?.days || []).map((d) => d.byLine[l]?.total));
    const tg = planTargetOf(t);
    const worst = M.filter((m) => m.line === l && !m.few && m.lostMin > 0).sort((a, b) => b.lostMin - a.lostMin)[0] || null;
    return { line: l, P: t.P, qty: t.qty, target: tg, ach: tg ? t.qty / tg : null, short: tg == null ? null : t.qty - tg,
      std: stdCt(t), act: actCt(t), speed: t.speedMin || 0, run: t.actualMin, worst: worst ? worst.model : null };
  });
  const judged = M.filter((m) => !m.few && m.std);
  const worstDay = days.filter((d) => d.P != null).sort((a, b) => a.P - b.P)[0] || null;
  return {
    total: { P: T.P, qty: T.qty, target, ach: target ? T.qty / target : null, short: target == null ? null : T.qty - target,
      std: stdCt(T), act: actCt(T), speed: T.speedMin || 0, run: T.actualMin,
      good: goodOf(T), rework: T.rework || 0, rejects: T.rejects || 0, dismantle: T.dismantle || 0,   // 27-11-2026: Good Qty · Rework · Dismantle tiles
      slow: judged.filter((m) => m.var > 0.005).length, models: M.length, judged: judged.length, worstDay },
    days, lines, models: M,
    slow: judged.filter((m) => m.lostMin > 0).sort((a, b) => b.lostMin - a.lostMin),
    // cycle time variation: every judged model, the highest % over std first (the tile and the Pareto rank by time lost)
    variation: judged.filter((m) => m.var != null).sort((a, b) => b.var - a.var || (b.lostMin || 0) - (a.lostMin || 0)),
    hourCT: [...ctH.values()].sort((a, b) => a.hour - b.hour).map((o) => ({ hour: o.hour, act: o.qty ? o.actSec / o.qty : null, std: o.cov > 0 && o.stdSec > 0 ? o.stdSec / o.cov : null, qty: o.qty })),
    reasons: [...why.values()].map((w) => ({ ...w, lines: [...w.lines].sort(), models: [...w.models.entries()].map(([name, min]) => ({ name, min })).sort((a, b) => b.min - a.min) })).sort((a, b) => b.min - a.min),
    heat: ids.map((l) => ({ line: l, by: heat.get(l) || {} })),
  };
}

/** 26-11-2026: every date from start to end (yyyy-mm-dd, both in), at most `cap` (the days of a chart: none left out) */
export function datesBetween(start, end, cap = 400) {
  const out = [];
  if (!start || !end || start > end) return out;
  const [y, m, d] = start.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < cap; i += 1) {
    const s = t.toISOString().slice(0, 10);
    if (s > end) break;
    out.push(s); t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

/** 26-11-2026: one model of one line, hour by hour in the period (a click on a model row): its pieces, its share of the hour's
 *  run time as its cycle (the same way as modelPerf), the std cycle, time lost and the other models made in that hour */
export function modelHours(R, line, model) {
  const out = [];
  for (const d of R?.days || []) for (const r of d.byLine[line]?.rows || []) {
    if (r.future || !(r.qty > 0)) continue;
    for (const x of r.models || []) {
      const q = Number(x.quantity) || 0;
      if (!q || (x.model || '—') !== model) continue;
      const std = Number(x.std) > 0 ? Number(x.std) : null;
      // 27-11-2026: the hour's run time (idle out) is shared by the std time of each model's pieces (was by the piece count —
      // 3 pcs of a 24 s model beside 135 pcs of a 20 s model got the hour's average cycle); without std on every model: by pieces
      const all = (r.models || []).filter((y) => Number(y.quantity) > 0);
      const byStd = std && all.every((y) => Number(y.std) > 0);
      const share = byStd ? (q * std) / all.reduce((a, y) => a + Number(y.quantity) * Number(y.std), 0) : q / r.qty;
      const actSec = r.actualMin > 0 ? r.actualMin * 60 * share : null;
      out.push({ key: `${d.date}|${r.hour}`, date: d.date, hour: r.hour, extra: !!r.extra, qty: q, hourQty: r.qty, actSec, std, runMin: r.actualMin, idleMin: r.lossMin || 0, mixed: all.length > 1, byStd, act: actSec != null ? actSec / q : null,
        var: std && actSec != null ? (actSec / q - std) / std : null, lostMin: std && actSec != null ? (actSec - q * std) / 60 : null,
        others: (r.models || []).filter((y) => (y.model || '—') !== model && Number(y.quantity) > 0).map((y) => ({ name: y.model || '—', value: Number(y.quantity) })) });
    }
  }
  return out;
}
