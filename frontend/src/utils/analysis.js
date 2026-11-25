import { fmtSeconds } from '../api';
import { shiftHours, workSecInHour } from './shift';
import { serverNow } from './serverTime';

export const DEFAULT_SETTINGS = { taktSec: null, startHour: 9, endHour: 21, lunchHour: 13, models: {} };

const pad = (n) => String(n).padStart(2, '0');
const hh = (h) => `${pad(h)}-${pad(h + 1)}`;
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);

/**
 * Working hours of the day. With settings.shift (shared shift + lunch window) the hours come from the shift and an
 * hour that is partly lunch stays in (it is only partly available, see hourShare); without it the older
 * start / end / lunch-hour settings are used (whole lunch hour left out).
 */
export function windowHours(s) {
  if (s?.shift) return shiftHours(s.shift).filter((h) => workSecInHour(s.shift, h) > 0);
  const out = [];
  for (let h = s.startHour; h < s.endHour; h++) if (h !== s.lunchHour) out.push(h);
  return out;
}

/** Share of clock hour h that is working time (1 = full hour; 0.5 = half lunch). */
export const hourShare = (s, h) => (s?.shift ? workSecInHour(s.shift, h) / 3600 : 1);

/**
 * Cycle-time vs takt analysis for the focus day (+ model view for the selected range).
 * Takt = available time / demand. Demand isn't in the scan data, so takt is user-set (global + per-model override).
 */
export function computeAnalysis({ summary, models, rejection, settings, focusDate, now = serverNow() }) {
  if (!summary) return null;
  const W = windowHours(settings);
  const share = Object.fromEntries(W.map((h) => [h, hourShare(settings, h)]));
  const winHours = W.reduce((a, h) => a + share[h], 0);   // working hours of the window (lunch excluded)
  const availSec = winHours * 3600;
  const takt = settings.taktSec > 0 ? Number(settings.taktSec) : null;
  const planPerHour = takt ? 3600 / takt : null;
  const target = takt ? Math.round(availSec / takt) : null;

  // live position inside the working window (only when the focus day is today)
  const isToday = focusDate === localDate(now);
  const nowH = now.getHours() + now.getMinutes() / 60;
  let elapsedWin = winHours;
  if (isToday) {
    elapsedWin = 0;
    for (const h of W) {
      if (settings.shift) elapsedWin += workSecInHour(settings.shift, h, nowH * 60) / 3600;
      else elapsedWin += nowH >= h + 1 ? 1 : nowH > h ? nowH - h : 0;
    }
  }
  const live = isToday && elapsedWin > 0 && elapsedWin < winHours - 1e-9;
  const byHour = Object.fromEntries(summary.hours.map((h) => [h.hour, h]));
  // the window + every hour outside it with scans (early start before 09:00, overtime from 21:00): its pieces count
  // in Produced like any other hour; it has no plan (the target stays the window's)
  const inW = new Set(W);
  const H = [...new Set([...W, ...summary.hours.filter((h) => (h.quantity || 0) > 0).map((h) => Number(h.hour))])].sort((a, b) => a - b);

  // ---- hour rows ------------------------------------------------------
  const completed = W.filter((h) => !isToday || nowH >= h + 1);
  const refQty = (() => {
    const act = completed.map((h) => byHour[h]?.quantity || 0).filter((q) => q > 0);
    return act.length ? act.reduce((a, b) => a + b, 0) / act.length : 0;
  })();

  let cumA = 0, cumP = 0, activeSec = 0, wSum = 0, wCnt = 0, excluded = 0, outGaps = 0, outSec = 0;
  const hours = H.map((h) => {
    const r = byHour[h] || {};
    const qty = r.quantity || 0;
    const extra = !inW.has(h);
    const future = isToday && nowH <= h;
    const partial = isToday && nowH > h && nowH < h + 1;
    const frac = extra ? 0 : settings.shift
      ? (partial ? workSecInHour(settings.shift, h, nowH * 60) : workSecInHour(settings.shift, h)) / 3600
      : (partial ? nowH - h : 1);
    const plan = planPerHour ? planPerHour * (future ? 0 : frac) : null;
    if (!future) { cumA += qty; cumP += plan || 0; }
    if (qty > 0) activeSec += 3600 * frac;
    if (r.avgActualCycleSeconds != null) { const w = r.cycleSamples ?? Math.max(0, qty - (r.excludedQuantity || 0)); wSum += r.avgActualCycleSeconds * w; wCnt += w; }
    excluded += r.excludedQuantity || 0;
    if (!future) { outGaps += r.idleGaps || 0; outSec += r.idleSeconds || 0; }

    let status;
    if (future) status = 'future';
    else if (qty === 0) status = 'idle';
    else if (extra) status = 'ok';
    else {
      const p = plan ? qty / plan : refQty ? qty / (refQty * frac) : 1;
      status = p >= (plan ? 1 : 0.95) ? 'ok' : p >= (plan ? 0.9 : 0.8) ? 'watch' : 'behind';
    }
    return {
      hour: h, label: hh(h), qty, plan: extra ? null : plan, partial, future, status, extra,
      qtyPct: plan ? pct(qty, plan) : null,
      avg: r.avgActualCycleSeconds ?? null, min: r.minActualCycleSeconds ?? null, max: r.maxActualCycleSeconds ?? null,
      theoretical: r.theoreticalCycleSeconds ?? null, models: r.distinctModels || 0, excluded: r.excludedQuantity || 0,
      gapVsTakt: takt && r.avgActualCycleSeconds != null ? r.avgActualCycleSeconds - takt : null,
      cumActual: future ? null : cumA, cumPlan: takt && !future ? Math.round(cumP * 10) / 10 : null,
    };
  });

  const qty = hours.reduce((a, h) => a + h.qty, 0);
  const totalQty = summary.totalQuantity || 0;
  const avgActual = wCnt ? wSum / wCnt : null;
  const theoretical = qty > 0 && activeSec > 0 ? activeSec / qty : null;
  const planToNow = planPerHour ? planPerHour * elapsedWin : null;
  const projected = live && qty > 0 ? Math.round(qty + (qty / elapsedWin) * (winHours - elapsedWin)) : null;

  const kpis = {
    qty, target, takt, availSec, outsideQty: Math.max(0, totalQty - qty), extraQty: hours.reduce((a, h) => a + (h.extra ? h.qty : 0), 0), excludedQty: excluded,
    achievement: target ? pct(qty, live ? planToNow : target) : null, // vs plan-to-now when live, vs full target otherwise
    avgActual, theoretical, activeHours: Math.round((activeSec / 3600) * 10) / 10,
    utilization: elapsedWin > 0 ? pct(activeSec, elapsedWin * 3600) : null,
    cycleVsTakt: takt && avgActual ? pct(avgActual, takt) : null,
    efficiency: takt && avgActual ? pct(takt, avgActual) : null,
    demonstratedTakt: qty > 0 ? (elapsedWin * 3600) / qty : null,
    planToNow, projected, live, elapsedWin, idleGaps: outGaps, idleSec: outSec,
  };

  // ---- model rows (selected range) -----------------------------------
  const modelRows = (models || []).map((m) => {
    const mt = Number(settings.models?.[m.mmId]) > 0 ? Number(settings.models[m.mmId]) : takt;
    const avg = m.avgActualCycleSeconds;
    const ratio = mt && avg ? avg / mt : null;
    let status = 'ok';
    if (ratio !== null) status = ratio <= 1 ? 'ok' : ratio <= 1.1 ? 'watch' : 'behind';
    else if (avg && m.avgTheoreticalCycleSeconds && avg > m.avgTheoreticalCycleSeconds * 1.3) status = 'watch';
    return {
      mmId: m.mmId, model: m.model, code: m.modelCode, qty: m.quantity, activeHours: m.activeHours,
      avg, min: m.minActualCycleSeconds, max: m.maxActualCycleSeconds, theoretical: m.avgTheoreticalCycleSeconds,
      takt: mt, ratio, status, ownTakt: Number(settings.models?.[m.mmId]) > 0,
      lostSec: mt && avg ? (avg - mt) * m.quantity : null, longGap: (m.maxActualCycleSeconds || 0) > 900,
    };
  });

  return { kpis, hours, modelRows, insights: buildInsights({ kpis, hours, modelRows, rejection, settings, W }) };
}

function buildInsights({ kpis, hours, modelRows, rejection, settings, W }) {
  const out = [];
  const add = (level, title, detail) => out.push({ level, title, detail });
  const { takt } = kpis;
  const done = hours.filter((h) => !h.future);
  const active = done.filter((h) => h.qty > 0 && !h.partial);

  if (!takt) add('info', 'Takt time is not set', 'Set the takt (target qty/day or seconds) to enable cycle vs takt, plan vs actual and projection.');
  else {
    if (kpis.live && kpis.projected !== null) {
      const short = kpis.target - kpis.projected;
      add(short > 0 ? 'bad' : 'good', short > 0 ? `Projection: ${kpis.projected} pcs — ${short} below target` : `Projection: ${kpis.projected} pcs — target of ${kpis.target} will be reached`,
        `So far ${kpis.qty} pcs, plan ${Math.round(kpis.planToNow)} pcs. Current rate ${(kpis.qty / kpis.elapsedWin).toFixed(1)}/hr vs required ${(3600 / takt).toFixed(1)}/hr.`);
    } else if (!kpis.live && kpis.target) {
      const a = kpis.achievement;
      add(a >= 100 ? 'good' : a >= 90 ? 'info' : 'bad', `Target achievement ${a?.toFixed(0)}% (${kpis.qty}/${kpis.target})`, `Plan based on takt ${fmtSeconds(takt)} and ${kpis.availSec / 3600} available hours.`);
    }
    if (kpis.avgActual) {
      const r = kpis.cycleVsTakt;
      add(r <= 100 ? 'good' : r <= 110 ? 'info' : 'bad', `Avg cycle ${fmtSeconds(kpis.avgActual)} vs takt ${fmtSeconds(takt)} (${r.toFixed(0)}%)`,
        r <= 100 ? 'The line is running faster than takt.' : 'Cycle is above takt — check the bottleneck station, changeover and stoppages.');
    }
    const behind = done.filter((h) => h.status === 'behind');
    if (behind.length) add('warn', `${behind.length} hour(s) behind plan: ${behind.map((h) => h.label).join(', ')}`, 'Quantity in these hours was below 90% of plan.');
  }

  if (active.length) {
    const best = [...active].sort((a, b) => b.qty - a.qty)[0];
    const worst = [...active].sort((a, b) => a.qty - b.qty)[0];
    add('info', `Best hour ${best.label} (${best.qty} pcs), weakest ${worst.label} (${worst.qty} pcs)`, `Spread ${(((best.qty - worst.qty) / best.qty) * 100).toFixed(0)}% — aim to repeat the best hour's rhythm in the other hours.`);
  }
  const first = done.find((h) => h.qty > 0);
  if (first && first.hour > settings.startHour) add('warn', `Production started at ${first.label}`, `${first.hour - settings.startHour} hour(s) idle at start — check line start-up and material readiness.`);
  const lastProd = [...done].reverse().find((h) => h.qty > 0);
  const idle = done.filter((h) => h.qty === 0 && first && lastProd && h.hour > first.hour && h.hour < lastProd.hour);
  if (idle.length) add('bad', `${idle.length} idle hour(s) in between: ${idle.map((h) => h.label).join(', ')}`, 'Zero production during the day — breakdown, material shortage or manpower gap.');
  const trailing = done.filter((h) => h.qty === 0 && lastProd && h.hour > lastProd.hour);
  if (!kpis.live && trailing.length) add('warn', `Production stopped after ${lastProd.label} (${trailing.length} hour(s) remaining)`, 'The line stopped before the window ended — check the reason for the early stop (plan complete, material or breakdown).');
  const lunchEndHour = settings.shift?.lunchEnd ? Math.ceil(Number(String(settings.shift.lunchEnd).split(':')[0]) + Number(String(settings.shift.lunchEnd).split(':')[1]) / 60) : settings.lunchHour + 1;
  const post = done.find((h) => h.hour === lunchEndHour);
  if (post && post.qty > 0 && active.length > 2) {
    const avgQ = active.reduce((a, h) => a + h.qty, 0) / active.length;
    if (post.qty < avgQ * 0.85) add('warn', `Slow ramp-up after lunch (${post.label}: ${post.qty} pcs)`, `${((post.qty / avgQ) * 100).toFixed(0)}% of the average hour — the restart took longer than usual.`);
  }
  const multi = active.filter((h) => h.models >= 3);
  if (multi.length) add('info', `${multi.length} hour(s) with 3+ models running`, 'A high model mix causes changeover loss. Planning similar models together will stabilise the cycle.');
  if (kpis.idleSec > 0) {
    const m = Math.round(kpis.idleSec / 60);
    add(m >= 60 ? 'bad' : m >= 20 ? 'warn' : 'info', `Line idle ${m} min (${kpis.idleGaps} stop${kpis.idleGaps > 1 ? 's' : ''})`,
      'No model was scanned during these stops (other than lunch): breakdown, material wait or changeover. Each stop is counted once; find the reason for each.');
  }
  if (kpis.excludedQty > 0) add('info', `${kpis.excludedQty} pcs of low-volume models excluded from the cycle average`, 'Quantity is counted; they are only excluded from the cycle average.');

  const bad = modelRows.filter((m) => m.status === 'behind').sort((a, b) => (b.lostSec || 0) - (a.lostSec || 0)).slice(0, 3);
  if (bad.length) add('bad', `Models slower than takt: ${bad.map((m) => `${m.model} (${fmtSeconds(m.avg)} vs ${fmtSeconds(m.takt)})`).join(', ')}`, 'Their cycle is above takt — address these first.');
  const gap = modelRows.filter((m) => m.longGap).slice(0, 3);
  if (gap.length) add('warn', `Long stoppages (15+ min gap): ${gap.map((m) => m.model).join(', ')}`, 'Maximum cycle is very high — the line stopped or the model changed in between.');

  if (rejection?.summary) {
    const s = rejection.summary;
    if (s.totalRejections > 0) {
      const top = rejection.reasons?.[0];
      const wh = [...(rejection.hourly || [])].sort((a, b) => b.rejectionQty - a.rejectionQty)[0];
      add(s.rejectionRate > 2 ? 'bad' : 'warn', `Rejection ${s.rejectionRate}% (${s.totalRejections} scans)`,
        `${top ? `Top reason: ${top.reason} (${top.rejectionQty}). ` : ''}${wh?.rejectionQty ? `Highest rejections at ${wh.label}.` : ''}`);
    } else add('good', 'No rejections today', 'False scan count is zero.');
  }
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
