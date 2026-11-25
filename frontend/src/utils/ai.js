/**
 * AI analysis (offline): automatic findings from the line's own data. Nothing leaves the plant network.
 *
 *   aiContext(input)  → one object with the day's derived numbers (target day, worked hours, history …)
 *   brief(ctx)        → day report: headline, health score, sections, actions ranked by pieces they can recover
 *   anomalies(ctx)    → alerts: low hours, idle hours, cycle spikes, long stops, rejection spikes, day vs history …
 *   forecast(ctx)     → today: pieces expected at shift end (range), target verdict, required rate, curve
 *   ask(question,ctx) → answer to a question typed in English or Hinglish ("kal kitna bana?", "10 baje kya hua?")
 *
 * Every number comes from the dashboard's own APIs (day_overview, range_overview, line settings, loss register),
 * so the text always matches the charts.
 */
import { buildTargetDay, targetOf, pphOf, requiredRate } from './targets';
import { normShift, fmtMin, shiftHours, workSecInHour } from './shift';
import { serverNow } from './serverTime';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const N = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
export const fmtN = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
export const fmtPct = (v) => (v == null ? '—' : `${Math.round(v)}%`);
export const fmtSec = (v) => (v == null ? '—' : `${Math.round(v * 10) / 10} s`);
export const fmtMins = (sec) => {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
const noDot = (t) => String(t ?? '').replace(/[.\s]+$/, '');
const hl = (h) => `${pad(h)}-${pad(h + 1)}`;
const sum = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0);
export function median(arr) {
  const v = arr.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}
function stdev(arr) {
  const v = arr.filter((x) => Number.isFinite(x));
  if (v.length < 2) return 0;
  const m = sum(v) / v.length;
  return Math.sqrt(sum(v.map((x) => (x - m) ** 2)) / (v.length - 1));
}
const fmtDay = (d) => {
  if (!d) return '';
  const t = new Date(`${d}T00:00:00`);
  return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

/* ───────────────────────── context ───────────────────────── */

/**
 * input = { line, focusDate, now, summary (day_overview.hourly), days (range daily rows), matrix ({date:{hour:row}}),
 *           models (range model rows), rejection (day), shift, targets, losses (loss register entries),
 *           lunchByHour ({hour: qty} of the focus day), running ({mmId, model, company, currentCycle}) }
 */
export function aiContext(input) {
  const now = input.now || serverNow();
  const focusDate = input.focusDate;
  const isToday = !!focusDate && focusDate === localDate(now);
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 : null;
  const shift = input.shift;
  const sh = normShift(shift);
  const targets = input.targets || {};
  const summary = input.summary || null;
  const hoursRaw = summary?.hours || [];
  const byHour = new Map(hoursRaw.map((h) => [Number(h.hour), h]));
  const running = input.running || null;
  const td = summary ? buildTargetDay({ hours: hoursRaw, shift, targets, nowMin, fallbackCycle: targetOf(targets, running?.mmId), lunchByHour: input.lunchByHour }) : null;

  // worked rows: inside the shift and already started (today: up to now)
  const rows = (td?.rows || []).filter((r) => !r.outside && !r.future && r.workSec > 0).map((r) => {
    const raw = byHour.get(r.hour) || {};
    return {
      ...r,
      idleSec: N(raw.idleSeconds) || 0, idleGaps: N(raw.idleGaps) || 0, distinct: N(raw.distinctModels) || (r.models || []).length,
      rate: r.workSec > 0 ? r.qty / (r.workSec / 3600) : null,   // pieces per working hour
    };
  });
  const rejByHour = Object.fromEntries((input.rejection?.hourly || []).map((h) => [Number(h.hour), N(h.rejectionQty) || 0]));
  const days = (input.days || []).filter((d) => d && d.date);
  const prevDays = days.filter((d) => d.date < focusDate && (N(d.quantity) || 0) > 0);
  const losses = input.losses || [];
  const dayLosses = losses.filter((e) => e.date === focusDate);
  const lossByHour = {};
  dayLosses.forEach((e) => { lossByHour[e.hour] = (lossByHour[e.hour] || 0) + (N(e.minutes) || 0); });
  const shiftEndPassed = !isToday || nowMin >= sh.end;
  const shiftStarted = !isToday || nowMin > sh.start;
  return {
    line: String(input.line ?? ''), focusDate, now, isToday, nowMin, shift, sh, targets, summary, td, rows, byHour,
    models: input.models || [], rejection: input.rejection || null, rejByHour, days, prevDays, matrix: input.matrix || {},
    losses, dayLosses, lossByHour, running, lunchByHour: input.lunchByHour || null, shiftEndPassed, shiftStarted,
    dayQty: N(summary?.totalQuantity) ?? (td ? td.total.qty : 0),
    dayCycle: N(summary?.dayAvgActualCycleSeconds),
    idleSec: N(summary?.idleSeconds) || 0, idleGaps: N(summary?.idleGaps) || 0,
  };
}

/* ───────────────────────── building blocks ───────────────────────── */

/** Typical pieces per working hour of the day (median of worked hours with output, ≥ 30 working min). */
function typicalRate(ctx) {
  return median(ctx.rows.filter((r) => r.qty > 0 && r.workSec >= 1800 && !r.running).map((r) => r.rate))
    ?? median(ctx.rows.filter((r) => r.qty > 0).map((r) => r.rate));
}

/** Reference cycle of the day: mix target when known, else the day's average cycle. */
function refCycle(ctx) {
  const t = ctx.td?.total;
  if (t?.planFull > 0) {
    const sec = sum(ctx.td.rows.filter((r) => !r.outside && r.targetCycle).map((r) => r.fullSec));
    if (sec > 0) return sec / t.planFull;
  }
  return ctx.dayCycle || null;
}

/** Probable causes of a weak hour, strongest first. */
function causesOf(ctx, r, medCycle) {
  const out = [];
  if (r.idleSec >= 300) out.push(`line stopped ${fmtMins(r.idleSec)} (${r.idleGaps} stop${r.idleGaps === 1 ? '' : 's'})`);
  if (r.cycle && medCycle && r.cycle > medCycle * 1.15) out.push(`slow cycle ${fmtSec(r.cycle)} vs usual ${fmtSec(medCycle)}`);
  if (r.distinct >= 2) out.push(`${r.distinct} models in the hour (changeover)`);
  const rej = ctx.rejByHour[r.hour] || 0;
  if (rej >= 3) out.push(`${rej} rejected scans`);
  if (ctx.lossByHour[r.hour]) out.push(`${ctx.lossByHour[r.hour]} min recorded in the loss register`);
  if (r.running) out.push('hour still running');
  return out;
}

/** Same hours on earlier days (matrix): average qty of hour h over days before the focus day. */
function histHour(ctx, h) {
  // only production days count (Sundays / holidays would pull the average down)
  const prod = Object.entries(ctx.matrix).filter(([d, m]) => d < ctx.focusDate && sum(Object.values(m || {}).map((x) => x?.quantity)) > 0);
  if (!prod.length) return null;
  return sum(prod.map(([, m]) => N(m?.[h]?.quantity) || 0)) / prod.length;
}

/* ───────────────────────── alerts ───────────────────────── */

export function anomalies(ctx) {
  const out = [];
  const add = (level, kind, title, detail, extra = {}) => out.push({ id: `${kind}-${extra.hour ?? out.length}`, level, kind, title, detail, ...extra });
  if (!ctx.summary) return out;
  const rows = ctx.rows;
  const M = typicalRate(ctx);
  const medCycle = median(rows.filter((r) => r.qty >= 10 && r.cycle).map((r) => r.cycle));
  const prod = rows.filter((r) => r.qty > 0);
  const first = prod[0]?.hour, last = prod[prod.length - 1]?.hour;

  // 1. hours without output inside the worked span (and, today, up to now)
  for (const r of rows) {
    if (r.qty > 0 || r.running) continue;
    const between = first != null && r.hour > first && r.hour < last;
    const start = first != null ? r.hour < first : ctx.isToday;
    const end = first != null && r.hour > last;
    if (between) add('bad', 'idle', `No production in ${r.label}`, `0 pcs in a working hour between ${hl(first)} and ${hl(last)}. Probable cause: breakdown, material shortage or manpower. ${ctx.lossByHour[r.hour] ? `${ctx.lossByHour[r.hour]} min recorded in the loss register.` : 'No reason recorded yet — record it in the loss register.'}`, { hour: r.hour });
    else if (start) add('warn', 'late-start', `Late start: no production in ${r.label}`, `The shift starts at ${fmtMin(ctx.sh.start)}; the first piece came ${first != null ? `in ${hl(first)}` : 'later'}. Check line start-up, material and manpower readiness.`, { hour: r.hour });
    else if (end && ctx.shiftEndPassed) add('warn', 'early-stop', `No production in ${r.label} (after the last piece)`, `Production stopped after ${hl(last)} before the shift ended at ${fmtMin(ctx.sh.end)}.`, { hour: r.hour });
  }

  // 2. weak hours: output far below the day's typical rate
  if (M > 0) {
    for (const r of prod) {
      if (r.workSec < 1200) continue;
      const ratio = r.rate / M;
      if (ratio >= 0.7) continue;
      const causes = causesOf(ctx, r, medCycle);
      add(ratio < 0.5 ? 'bad' : 'warn', 'low-hour', `Low output in ${r.label}: ${fmtN(r.qty)} pcs (${fmtPct(ratio * 100)} of a normal hour)`,
        `A normal hour of this day makes about ${fmtN(M * (r.workSec / 3600))} pcs in the same working time. ${causes.length ? `Probable cause: ${causes.join('; ')}.` : 'No stop or cycle change found — check manpower and material flow.'}`,
        { hour: r.hour, causes, lostPcs: Math.max(0, M * (r.workSec / 3600) - r.qty) });
    }
  }

  // 3. cycle spikes
  if (medCycle) {
    for (const r of prod) {
      if (r.qty < 10 || !r.cycle || r.cycle <= medCycle * 1.25) continue;
      if (out.some((a) => a.kind === 'low-hour' && a.hour === r.hour)) continue;
      add('warn', 'cycle', `Cycle time rose in ${r.label}: ${fmtSec(r.cycle)}`, `${fmtPct((r.cycle / medCycle - 1) * 100)} slower than the day's usual ${fmtSec(medCycle)}.${r.distinct >= 2 ? ` ${r.distinct} models ran in this hour — changeover is likely.` : ' Check the bottleneck station.'}`, { hour: r.hour });
    }
  }

  // 4. long stops inside an hour
  for (const r of rows) {
    if (r.idleSec < 600 || out.some((a) => a.hour === r.hour && (a.kind === 'low-hour' || a.kind === 'idle'))) continue;
    add(r.idleSec >= 1200 ? 'bad' : 'warn', 'stop', `Line stopped ${fmtMins(r.idleSec)} in ${r.label}`, `${r.idleGaps} long gap${r.idleGaps === 1 ? '' : 's'} between scans (lunch excluded). ${ctx.lossByHour[r.hour] ? `${ctx.lossByHour[r.hour]} min recorded in the loss register.` : 'No reason recorded yet.'}`, { hour: r.hour });
  }

  // 5. rejection spike
  const rej = Object.entries(ctx.rejByHour).filter(([, q]) => q > 0);
  if (rej.length) {
    const avg = sum(rej.map(([, q]) => q)) / rej.length;
    for (const [h, q] of rej) if (q >= Math.max(5, avg * 2.5) && rej.length > 1) add('warn', 'rejection', `Rejection spike in ${hl(Number(h))}: ${q} scans`, `Average in other hours: ${Math.round(avg * 10) / 10}. Check the scanner, labels and duplicate scans at this time.`, { hour: Number(h) });
  }
  const rs = ctx.rejection?.summary;
  if (rs && N(rs.rejectionRate) > 2) add('bad', 'rejection-day', `Rejection rate ${rs.rejectionRate}%${ctx.isToday ? ' today' : ''}`, `${rs.totalRejections} rejected scans${ctx.rejection.reasons?.[0] ? `; top reason: ${noDot(ctx.rejection.reasons[0].reason)} (${ctx.rejection.reasons[0].rejectionQty})` : ''}.`);

  // 6. behind target (hours below 90 % of their target)
  const behind = rows.filter((r) => r.status === 'behind' && !r.running && r.plan > 0);
  if (behind.length) {
    const short = sum(behind.map((r) => r.plan - r.qty));
    add(behind.length >= 3 ? 'bad' : 'warn', 'target', `${behind.length} hour${behind.length === 1 ? '' : 's'} below 90% of target`, `${behind.map((r) => `${r.label} (${fmtN(r.qty)}/${fmtN(r.plan)})`).join(', ')}. Short by ${fmtN(short)} pcs in these hours.`);
  }

  // 7. day compared with earlier days
  const prevQ = ctx.prevDays.map((d) => N(d.quantity));
  if (prevQ.length >= 2) {
    const med = median(prevQ);
    if (!ctx.isToday && ctx.dayQty > 0) {
      const r = ctx.dayQty / med;
      if (r < 0.8) add('bad', 'history', `Day output ${fmtPct((1 - r) * 100)} below the usual day`, `${fmtN(ctx.dayQty)} pcs vs median ${fmtN(med)} pcs of the ${prevQ.length} earlier days in the period.`);
      else if (r > 1.15) add('good', 'history', `Strong day: ${fmtPct((r - 1) * 100)} above the usual day`, `${fmtN(ctx.dayQty)} pcs vs median ${fmtN(med)} pcs of the ${prevQ.length} earlier days.`);
    } else if (ctx.isToday) {
      const done = rows.filter((r) => !r.running).map((r) => r.hour);
      const hist = done.length ? sum(done.map((h) => histHour(ctx, h) || 0)) : 0;
      const act = sum(rows.filter((r) => !r.running).map((r) => r.qty));
      if (hist > 0 && done.length >= 2) {
        const r = act / hist;
        if (r < 0.85) add('warn', 'history', `Today is ${fmtPct((1 - r) * 100)} behind the usual pace`, `${fmtN(act)} pcs up to ${hl(done[done.length - 1])} vs ${fmtN(hist)} pcs in the same hours on an average earlier day.`);
        else if (r > 1.1) add('good', 'history', `Today is ${fmtPct((r - 1) * 100)} ahead of the usual pace`, `${fmtN(act)} pcs up to ${hl(done[done.length - 1])} vs ${fmtN(hist)} pcs on an average earlier day.`);
      }
    }
  }

  // 8. models slower than their target (period)
  const slow = ctx.models.map((m) => ({ m, t: targetOf(ctx.targets, m.mmId), c: N(m.avgActualCycleSeconds) }))
    .filter((x) => x.t && x.c && x.c > x.t * 1.1 && (N(x.m.quantity) || 0) >= 20)
    .sort((a, b) => (b.c - b.t) * b.m.quantity - (a.c - a.t) * a.m.quantity).slice(0, 3);
  if (slow.length) add('warn', 'model', `Model${slow.length === 1 ? '' : 's'} slower than target: ${slow.map((x) => x.m.model).join(', ')}`, slow.map((x) => `${x.m.model}: ${fmtSec(x.c)} vs target ${fmtSec(x.t)} (${fmtN(x.m.quantity)} pcs)`).join('; ') + '.');

  // 9. running model: current speed vs target
  const rc = N(ctx.running?.currentCycle), rt = targetOf(ctx.targets, ctx.running?.mmId);
  if (ctx.isToday && rc && rt && rc > rt * 1.1) add('warn', 'running', `Running model ${ctx.running.model} is slower than target now`, `Last 20 pieces: ${fmtSec(rc)} per piece vs target ${fmtSec(rt)} (${fmtN(3600 / rc)} vs ${fmtN(pphOf(rt))} pcs/hr).`);

  // 10. shortfall without a recorded reason
  const unrec = rows.filter((r) => !r.running && r.plan > 0 && r.plan - r.qty >= Math.max(5, r.plan * 0.1) && !ctx.lossByHour[r.hour]);
  if (unrec.length) add('info', 'unrecorded', `${unrec.length} short hour${unrec.length === 1 ? '' : 's'} without a loss reason`, `${unrec.map((r) => r.label).join(', ')} — record the reason in the loss register so the loss analysis is complete.`);

  // 11. production during lunch
  const lq = ctx.td?.total.lunchQty || 0;
  if (lq > 0) add('info', 'lunch', `${lq} pcs scanned during lunch`, `Lunch ${fmtMin(ctx.sh.lunchStart)}–${fmtMin(ctx.sh.lunchEnd)} has no target; these pieces are counted in the day total only.`);

  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.hour ?? 99) - (b.hour ?? 99));
}

/* ───────────────────────── forecast ───────────────────────── */

/** Normal CDF (Abramowitz–Stegun), for the chance of reaching the target. */
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function forecast(ctx) {
  const td = ctx.td;
  if (!td) return { state: 'nodata', text: 'No data for this day.' };
  const planFull = td.total.planFull;
  const qty = ctx.dayQty;
  // pieces of models without a target are not compared with the target
  const nt = td.total.noTgtQty || 0;
  const qT = Math.max(0, qty - nt);
  const curve = (proj) => {
    let a = 0, t = 0, p = 0;
    return td.rows.filter((r) => !r.outside || r.qty > 0).map((r) => {
      t += r.planFull || 0;
      const past = !r.future;
      if (past) a += r.qty + (r.lunchQty || 0);
      if (proj && (r.running || r.future)) p += (proj.rate * (r.fullSec - r.workSec)) / 3600;
      return { hour: r.hour, label: r.label, actual: past ? Math.round(a) : null, target: planFull != null ? Math.round(t) : null, forecast: proj && (r.running || r.future) ? Math.round(a + p) : null, past };
    }).map((row, i, all) => {
      // the forecast line starts at the last finished hour, so it continues the actual line instead of covering it
      const next = all[i + 1];
      const { past, ...rest } = row;
      return proj && past && row.forecast == null && next && next.forecast != null ? { ...rest, forecast: row.actual } : rest;
    });
  };
  if (!ctx.isToday || ctx.shiftEndPassed) {
    return { state: 'closed', qty, target: planFull, pct: planFull ? (qT / planFull) * 100 : null, diff: planFull != null ? qT - planFull : null, curve: curve(null),
      text: planFull ? `Day closed at ${fmtN(qty)} pcs — ${fmtPct((qT / planFull) * 100)} of the ${fmtN(planFull)} pcs target (${qT >= planFull ? '+' : '−'}${fmtN(Math.abs(qT - planFull))})${nt ? `; ${fmtN(nt)} pcs of models without a target not counted` : ''}.` : `Day closed at ${fmtN(qty)} pcs (no model targets set).` };
  }
  const worked = ctx.rows;
  const elapsed = sum(worked.map((r) => r.workSec));
  const workedQty = sum(worked.map((r) => r.qty));
  const remainingSec = td.total.remainingSec;
  if (!ctx.shiftStarted || elapsed < 900 || workedQty === 0) {
    return { state: 'early', qty, target: planFull, remainingSec, curve: curve(null), text: 'Too early for a forecast — it starts after 15 working minutes with production.' };
  }
  const dayRate = workedQty / (elapsed / 3600);
  // recent rate: the last ≈ 2 working hours (running hour included when ≥ 15 min)
  const recent = [...worked].reverse().filter((r) => !r.running || r.workSec >= 900);
  let rq = 0, rs = 0;
  for (const r of recent) { if (rs >= 7200) break; rq += r.qty; rs += r.workSec; }
  const recentRate = rs > 0 ? rq / (rs / 3600) : dayRate;
  let rate = 0.6 * recentRate + 0.4 * dayRate;
  // earlier days: what the remaining hours usually make
  const remHours = shiftHours(ctx.shift).filter((h) => workSecInHour(ctx.shift, h) > workSecInHour(ctx.shift, h, ctx.nowMin));
  const histParts = remHours.map((h) => { const hq = histHour(ctx, h); const share = (workSecInHour(ctx.shift, h) - workSecInHour(ctx.shift, h, ctx.nowMin)) / Math.max(1, workSecInHour(ctx.shift, h)); return hq == null ? null : hq * share; });
  const hist = histParts.every((x) => x != null) && histParts.length ? sum(histParts) : null;
  const byRate = (rate * remainingSec) / 3600;
  const restPcs = hist != null && hist > 0 ? 0.7 * byRate + 0.3 * hist : byRate;
  if (remainingSec > 0) rate = restPcs / (remainingSec / 3600);
  const projected = qty + restPcs;
  const sd = stdev(worked.filter((r) => !r.running && r.workSec >= 1800).map((r) => r.rate));
  const remH = remainingSec / 3600;
  const spread = sd * Math.sqrt(Math.max(remH, 0)) + 0.05 * restPcs;
  const low = Math.max(qty, projected - spread), high = projected + spread;
  const need = requiredRate(td.total);
  let verdict = null, chance = null;
  const pT = projected - nt;   // the target is compared with the pieces of models that have one
  if (planFull > 0) {
    chance = spread > 0 ? phi((pT - planFull) / spread) * 100 : (pT >= planFull ? 100 : 0);
    verdict = pT >= planFull ? (chance >= 70 ? 'on-track' : 'at-risk') : (chance >= 30 ? 'at-risk' : 'will-miss');
  }
  const words = { 'on-track': 'On track', 'at-risk': 'At risk', 'will-miss': 'Will miss target' };
  return {
    state: 'live', qty, target: planFull, projected, low, high, rate, recentRate, dayRate, histRest: hist, remainingSec, need, chance, verdict, verdictText: verdict ? words[verdict] : null,
    shortBy: planFull > 0 ? Math.max(0, planFull - pT) : null, curve: curve({ rate: remainingSec > 0 ? restPcs / remH : 0 }),
    text: `Expected at shift end (${fmtMin(ctx.sh.end)}): about ${fmtN(projected)} pcs (range ${fmtN(low)}–${fmtN(high)}).` +
      (planFull > 0 ? ` Target ${fmtN(planFull)} pcs → ${words[verdict]}${verdict === 'on-track' ? '' : `; ${need != null ? `${fmtN(need)} pcs/hr needed for the rest of the shift vs ${fmtN(recentRate)} pcs/hr now` : ''}`}.` : ' Set model targets to see the target verdict.'),
  };
}

/* ───────────────────────── day report ───────────────────────── */

export function brief(ctx) {
  if (!ctx.summary) return null;
  const td = ctx.td, t = td.total;
  const al = anomalies(ctx);
  const fc = forecast(ctx);
  const worked = ctx.rows.filter((r) => r.qty > 0);
  const best = [...worked].filter((r) => r.workSec >= 1800).sort((a, b) => b.rate - a.rate)[0];
  const worst = [...worked].filter((r) => r.workSec >= 1800 && !r.running).sort((a, b) => a.rate - b.rate)[0];
  const rc = refCycle(ctx);
  const rs = ctx.rejection?.summary;
  const prevMed = median(ctx.prevDays.map((d) => N(d.quantity)));
  const workedSec = sum(ctx.rows.map((r) => r.workSec));

  // ---- health score (0–100) ----
  const parts = [];
  const pctT = t.pct;
  // 100 % of target = full marks, 50 % or less = none
  if (pctT != null) parts.push({ k: 'Target', w: 40, v: Math.max(0, Math.min(1, (pctT - 50) / 50)) });
  const util = workedSec > 0 ? Math.max(0, 1 - ctx.idleSec / workedSec) : null;
  if (util != null) parts.push({ k: 'Running time', w: 20, v: util });
  const cyc = ctx.dayCycle && rc && pctT != null ? Math.min(1, rc / ctx.dayCycle) : null;
  if (cyc != null) parts.push({ k: 'Cycle vs target', w: 20, v: cyc });
  if (rs) parts.push({ k: 'Quality', w: 10, v: Math.max(0, 1 - (N(rs.rejectionRate) || 0) / 10) });   // 0 % = full marks, 10 % or more = none
  const rates = worked.filter((r) => !r.running && r.workSec >= 1800).map((r) => r.rate);
  if (rates.length >= 3) { const m = sum(rates) / rates.length; parts.push({ k: 'Stability', w: 10, v: Math.max(0, 1 - stdev(rates) / m) }); }
  if (pctT == null && prevMed) parts.push({ k: 'vs usual day', w: 40, v: Math.min(1, (ctx.isToday ? (fc.projected || ctx.dayQty) : ctx.dayQty) / prevMed) });
  const W = sum(parts.map((p) => p.w));
  const score = W > 0 ? Math.round((sum(parts.map((p) => p.w * p.v)) / W) * 100) : null;
  const grade = score == null ? null : score >= 85 ? 'Good' : score >= 70 ? 'Fair' : 'Poor';

  // ---- headline ----
  const when = ctx.isToday ? 'so far today' : `on ${fmtDay(ctx.focusDate)}`;
  let headline = `Line ${ctx.line}: ${fmtN(ctx.dayQty)} pcs ${when}`;
  if (t.plan > 0) headline += ` — ${fmtPct(t.pct)} of the ${ctx.isToday ? 'target up to now' : 'day target'} (${fmtN(t.plan)} pcs, ${t.qty >= t.plan ? '+' : '−'}${fmtN(Math.abs(t.qty - t.plan))}).`;
  else headline += '.';
  if (fc.state === 'live') headline += ` Forecast at shift end: ${fmtN(fc.projected)} pcs${fc.verdictText ? ` (${fc.verdictText.toLowerCase()})` : ''}.`;

  // ---- sections ----
  const sections = [];
  const prodPts = [];
  if (t.planFull > 0) prodPts.push(`Day target ${fmtN(t.planFull)} pcs from the model-wise targets${ctx.isToday ? `; target up to now ${fmtN(t.plan)} pcs` : ''}.`);
  for (const p of td.parts.filter((x) => x.work && x.started)) prodPts.push(`${p.label} (${fmtMin(p.from)}–${fmtMin(p.to)}): ${fmtN(p.qty)} pcs${p.hasPlan ? ` vs ${fmtN(p.plan)} target (${fmtPct(p.pct)})` : ''}${p.done ? '' : ' — running'}.`);
  if (best) prodPts.push(`Best hour ${best.label}: ${fmtN(best.qty)} pcs (${fmtN(best.rate)} pcs/hr).`);
  if (worst && worst !== best) prodPts.push(`Weakest hour ${worst.label}: ${fmtN(worst.qty)} pcs (${fmtN(worst.rate)} pcs/hr).`);
  if (prevMed && !ctx.isToday) prodPts.push(`Usual day in this period: ${fmtN(prevMed)} pcs (median of ${ctx.prevDays.length} earlier days) → this day ${ctx.dayQty >= prevMed ? '+' : '−'}${fmtPct(Math.abs(ctx.dayQty / prevMed - 1) * 100)}.`);
  if (t.lunchQty > 0) prodPts.push(`${t.lunchQty} pcs were scanned during lunch (no target).`);
  sections.push({ key: 'production', title: 'Production and target', points: prodPts });

  const timePts = [];
  timePts.push(`Working time ${fmtMins(workedSec)} (lunch excluded); line stopped ${fmtMins(ctx.idleSec)} in ${ctx.idleGaps} long gap${ctx.idleGaps === 1 ? '' : 's'}${workedSec ? ` = ${fmtPct((ctx.idleSec / workedSec) * 100)} of working time` : ''}.`);
  const byReason = {};
  ctx.dayLosses.forEach((e) => { byReason[e.reason] = (byReason[e.reason] || 0) + (N(e.minutes) || 0); });
  const reasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
  const recMin = sum(reasons.map((r) => r[1]));
  if (reasons.length) timePts.push(`Loss register: ${recMin} min recorded — ${reasons.slice(0, 3).map(([r, m]) => `${r} ${m} min`).join(', ')}.`);
  else timePts.push('Loss register: no loss recorded for this day.');
  const idleMin = Math.round(ctx.idleSec / 60);
  if (idleMin - recMin >= 10) timePts.push(`${idleMin - recMin} min of stops have no recorded reason.`);
  sections.push({ key: 'time', title: 'Time and losses', points: timePts });

  const cycPts = [];
  if (ctx.dayCycle) cycPts.push(`Average cycle ${fmtSec(ctx.dayCycle)} per piece (${fmtN(3600 / ctx.dayCycle)} pcs/hr when running)${rc && t.planFull > 0 ? ` vs target mix ${fmtSec(rc)} (${ctx.dayCycle <= rc ? 'faster' : `${fmtPct((ctx.dayCycle / rc - 1) * 100)} slower`})` : ''}.`);
  const dayModels = {};
  ctx.td.rows.forEach((r) => (r.models || []).forEach((m) => { dayModels[m.mmId] = dayModels[m.mmId] || { ...m, qty: 0 }; dayModels[m.mmId].qty += m.qty; }));
  const dm = Object.values(dayModels).sort((a, b) => b.qty - a.qty);
  if (dm.length) cycPts.push(`Models made: ${dm.slice(0, 4).map((m) => `${m.model} ${fmtN(m.qty)}`).join(', ')}${dm.length > 4 ? ` +${dm.length - 4} more` : ''}.`);
  const noT = dm.filter((m) => !m.target);
  if (noT.length) cycPts.push(`${noT.length} model${noT.length === 1 ? ' has' : 's have'} no target: ${noT.slice(0, 3).map((m) => m.model).join(', ')} — set targets for a complete target view.`);
  const changeHours = ctx.rows.filter((r) => r.distinct >= 3);
  if (changeHours.length) cycPts.push(`${changeHours.length} hour${changeHours.length === 1 ? '' : 's'} with 3+ models (changeover loss): ${changeHours.map((r) => r.label).join(', ')}.`);
  sections.push({ key: 'cycle', title: 'Cycle and models', points: cycPts });

  const qPts = [];
  if (rs) {
    if (N(rs.totalRejections) > 0) {
      const wh = [...(ctx.rejection.hourly || [])].sort((a, b) => b.rejectionQty - a.rejectionQty)[0];
      qPts.push(`Rejection ${rs.rejectionRate}% (${rs.totalRejections} of ${fmtN(rs.totalAttempts)} scans)${ctx.rejection.reasons?.[0] ? `; top reason ${noDot(ctx.rejection.reasons[0].reason)} (${ctx.rejection.reasons[0].rejectionQty})` : ''}${wh?.rejectionQty ? `; most in ${wh.label.slice(0, 2)}-${wh.label.slice(6, 8)}` : ''}.`);
    } else qPts.push('No rejected scans.');
  }
  if (qPts.length) sections.push({ key: 'quality', title: 'Quality', points: qPts });

  // ---- actions, ranked by pieces they can recover ----
  const actions = [];
  const per = rc || ctx.dayCycle;
  if (per && ctx.idleSec >= 300) actions.push({ key: 'stops', title: 'Cut line stops', gain: ctx.idleSec / per, detail: `${fmtMins(ctx.idleSec)} of stops = about ${fmtN(ctx.idleSec / per)} pcs. ${reasons[0] ? `Biggest recorded reason: ${reasons[0][0]}.` : 'Record each stop with its reason to find the main cause.'}` });
  const slowLoss = sum(ctx.rows.filter((r) => r.cycle && r.targetCycle && r.cycle > r.targetCycle && r.qty > 0).map((r) => ((r.cycle - r.targetCycle) * r.qty) / r.targetCycle));
  if (slowLoss >= 5) actions.push({ key: 'cycle', title: 'Bring the cycle to target', gain: slowLoss, detail: `Hours running slower than the model target cost about ${fmtN(slowLoss)} pcs. Balance the bottleneck station of the slowest model.` });
  const lateRows = ctx.rows.filter((r) => r.qty === 0 && (worked[0] ? r.hour < worked[0].hour : false));
  const lateGain = sum(lateRows.map((r) => r.plan || (typicalRate(ctx) || 0) * (r.workSec / 3600)));
  if (lateGain >= 5) actions.push({ key: 'start', title: 'Start on time', gain: lateGain, detail: `No production in ${lateRows.map((r) => r.label).join(', ')} — about ${fmtN(lateGain)} pcs. Prepare material and manpower before ${fmtMin(ctx.sh.start)}.` });
  const gapRows = ctx.rows.filter((r) => r.qty === 0 && !r.running && worked[0] && r.hour > worked[0].hour && r.hour < worked[worked.length - 1].hour);
  const gapGain = sum(gapRows.map((r) => r.plan || (typicalRate(ctx) || 0) * (r.workSec / 3600)));
  if (gapGain >= 5) actions.push({ key: 'idle-hours', title: 'Remove idle hours', gain: gapGain, detail: `No production in ${gapRows.map((r) => r.label).join(', ')} — about ${fmtN(gapGain)} pcs. Record the reason (breakdown, material, manpower) and fix the cause.` });
  const lowGain = sum(al.filter((a) => a.kind === 'low-hour').map((a) => a.lostPcs || 0));
  if (lowGain >= 5) actions.push({ key: 'weak', title: 'Fix the weak hours', gain: lowGain, detail: `${al.filter((a) => a.kind === 'low-hour').map((a) => hl(a.hour)).join(', ')} made about ${fmtN(lowGain)} pcs less than a normal hour.` });
  if (changeHours.length && per) actions.push({ key: 'mix', title: 'Group models to cut changeovers', gain: changeHours.length * (600 / per), detail: `Plan similar models together; ${changeHours.length} hour${changeHours.length === 1 ? '' : 's'} ran 3+ models (≈10 min changeover each = about ${fmtN(changeHours.length * (600 / per))} pcs).` });
  if (rs && N(rs.totalRejections) >= 5) actions.push({ key: 'quality', title: 'Reduce rejected scans', gain: N(rs.totalRejections), detail: `${rs.totalRejections} rejected scans${ctx.rejection.reasons?.[0] ? ` — mainly ${noDot(ctx.rejection.reasons[0].reason)}` : ''}.` });
  if (noT.length) actions.push({ key: 'targets', title: 'Set missing model targets', gain: 0, detail: `Use Model analysis → "Use achieved as targets" for ${noT.map((m) => m.model).slice(0, 3).join(', ')}${noT.length > 3 ? '…' : ''}.` });
  actions.sort((a, b) => b.gain - a.gain);

  return { headline, score, grade, scoreParts: parts.map((p) => ({ ...p, pct: Math.round(p.v * 100) })), sections, actions, alerts: al, forecast: fc, best, worst, prevMed };
}

/** Plain-text version of the report (copy to WhatsApp / mail). */
export function briefText(b, ctx) {
  if (!b) return '';
  const L = [`EMS Line Pulse — AI analysis · Line ${ctx.line} · ${ctx.focusDate}`, '', b.headline];
  if (b.score != null) L.push(`Line health: ${b.score}/100 (${b.grade})`);
  for (const s of b.sections) { L.push('', s.title.toUpperCase()); s.points.forEach((p) => L.push(`• ${p}`)); }
  const top = b.alerts.filter((a) => a.level === 'bad' || a.level === 'warn').slice(0, 6);
  if (top.length) { L.push('', 'ALERTS'); top.forEach((a) => L.push(`• ${a.title}`)); }
  if (b.actions.length) { L.push('', 'WHAT TO DO'); b.actions.slice(0, 5).forEach((a, i) => L.push(`${i + 1}. ${a.title}${a.gain >= 1 ? ` (+${fmtN(a.gain)} pcs)` : ''} — ${a.detail}`)); }
  return L.join('\n');
}

/* ───────────────────────── questions ───────────────────────── */

export const SUGGESTIONS = [
  'Aaj kitna production hua?', 'Target poora hoga?', 'Line peeche kyun hai?', 'Best hour kaunsa tha?',
  'Kal kitna bana?', 'Line kitni der band rahi?', 'Running model ka cycle?', '10 baje kya hua?', 'Rejection kitna hai?', 'Top models',
];

const has = (q, re) => re.test(q);

function dayFromQuestion(q, ctx) {
  const dates = ctx.days.map((d) => d.date);
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(q);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/.exec(q);
  if (m && !/baje|bje|hour|:/.test(q.slice(m.index, m.index + 12))) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : ctx.focusDate.slice(0, 4);
    const d = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    if (!isNaN(new Date(`${d}T00:00:00`))) return d;
  }
  if (has(q, /\b(kal|yesterday|pichle din|previous day)\b/)) {
    const before = dates.filter((d) => d < ctx.focusDate).sort();
    if (has(q, /\bparso\b/)) return before[before.length - 2] || null;
    return before[before.length - 1] || 'none';
  }
  if (has(q, /\bparso\b/)) { const before = dates.filter((d) => d < ctx.focusDate).sort(); return before[before.length - 2] || 'none'; }
  return null;
}

function hourFromQuestion(q) {
  let m = /\b(\d{1,2})\s*(?:-|to|se)\s*(\d{1,2})\b/.exec(q);
  if (m && Number(m[2]) === (Number(m[1]) + 1) % 24) return Number(m[1]);
  m = /\b(\d{1,2})(?::00)?\s*(baje|bje|o'?clock|am|pm|wala ghanta|hour)\b/.exec(q) || /\bhour\s*(\d{1,2})\b/.exec(q);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[2] === 'pm' && h < 12) h += 12;
  else if ((m[2] === 'baje' || m[2] === 'bje' || /o'?clock/.test(m[2] || '')) && h >= 1 && h <= 8) h += 12;   // "3 baje" in the shift = 15:00
  return h >= 0 && h <= 23 ? h : null;
}

function modelFromQuestion(q, ctx) {
  const all = new Map();
  ctx.models.forEach((m) => all.set(String(m.mmId), m));
  ctx.td?.rows.forEach((r) => (r.models || []).forEach((m) => { if (!all.has(String(m.mmId))) all.set(String(m.mmId), m); }));
  const words = q.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 4);
  let best = null, bestLen = 0;
  for (const m of all.values()) {
    const name = String(m.model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const code = String(m.modelCode || '').toUpperCase();
    for (const w of words) {
      if ((name.includes(w) || (code && w === code)) && w.length > bestLen) { best = m; bestLen = w.length; }
    }
  }
  return best;
}

/**
 * Answer a question about the line. Returns { title, lines: [text], bullets?: [text], table?: {head, rows}, follow: [suggestions] }.
 */
export function ask(question, ctx) {
  const q = ` ${String(question || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const res = (title, lines, extra = {}) => ({ title, lines: lines.filter(Boolean), follow: extra.follow || [], ...extra });
  if (!q.trim()) return res('Ask a question', ['Type a question about this line, in English or Hinglish.'], { follow: SUGGESTIONS.slice(0, 5) });
  if (!ctx.summary) return res('No data', ['The day has not loaded yet. Please wait a moment and try again.']);

  // other line?
  const lm = /line\s*(\d)/.exec(q);
  const lineNote = lm && lm[1] !== ctx.line ? `This page shows Line ${ctx.line}. For Line ${lm[1]}, switch to it with the line buttons at the top; the answer below is for Line ${ctx.line}.` : null;

  if (has(q, /\b(help|madad|kya puch|what can|kya kya)\b/)) {
    return res('What you can ask', ['Questions are answered from this line\'s data for the selected day and period (no internet needed).'],
      { bullets: ['Production: "aaj kitna bana", "kal kitna bana", "25-10 ka production"', 'Target and forecast: "target poora hoga?", "shift end tak kitna banega"', 'Reasons: "line peeche kyun hai", "kya problem hai"', 'Hours: "best hour", "10 baje kya hua", "sabse kam kab bana"', 'Stops and losses: "line kitni der band rahi", "loss kitna hua"', 'Cycle and models: "cycle time", "running model", "top models", or a model name', 'Quality: "rejection kitna hai"'], follow: SUGGESTIONS.slice(0, 4) });
  }

  // a different day of the period
  const day = dayFromQuestion(q, ctx);
  if (day === 'none') return res('Earlier day not in the period', [lineNote, `The selected period starts on ${fmtDay(ctx.days[0]?.date)}. Select a longer period (for example 7 days) in the filter, then ask again.`]);
  if (day && day !== ctx.focusDate) {
    const d = ctx.days.find((x) => x.date === day);
    if (!d) return res(`No data for ${fmtDay(day)}`, [lineNote, `${fmtDay(day)} is not in the selected period (${fmtDay(ctx.days[0]?.date)} – ${fmtDay(ctx.days[ctx.days.length - 1]?.date)}). Change the period in the filter, or pick that day in the daily trend.`]);
    const q2 = N(d.quantity) || 0;
    const mh = ctx.matrix[day] || {};
    const hrs = Object.values(mh).filter((h) => (N(h?.quantity) || 0) > 0).sort((a, b) => b.quantity - a.quantity);
    const cmp = ctx.dayQty > 0 && !ctx.isToday ? ` ${fmtDay(ctx.focusDate)} made ${fmtN(ctx.dayQty)} pcs (${ctx.dayQty >= q2 ? '+' : '−'}${fmtN(Math.abs(ctx.dayQty - q2))}).` : (ctx.isToday ? ` Today so far: ${fmtN(ctx.dayQty)} pcs.` : '');
    return res(`${fmtDay(day)}: ${fmtN(q2)} pcs`, [lineNote,
      `${fmtDay(day)}: ${fmtN(q2)} pcs in ${N(d.activeHours) ?? '—'} production hours, ${d.distinctModels ?? '—'} models, average cycle ${fmtSec(N(d.avgActualCycleSeconds))}.${N(d.idleSeconds) ? ` Line stopped ${fmtMins(d.idleSeconds)} (${d.idleGaps} stops).` : ''}${cmp}`,
      hrs.length ? `Best hour ${hl(hrs[0].hour)} with ${fmtN(hrs[0].quantity)} pcs; weakest ${hl(hrs[hrs.length - 1].hour)} with ${fmtN(hrs[hrs.length - 1].quantity)} pcs.` : null,
      'For the full hour-by-hour view of that day, click it in the daily trend chart.'], { follow: ['Line peeche kyun hai?', 'Best hour kaunsa tha?'] });
  }

  const hour = hourFromQuestion(q);
  const model = modelFromQuestion(q, ctx);
  const fc = () => forecast(ctx);

  if (hour != null) {
    const r = ctx.td.rows.find((x) => x.hour === hour);
    const raw = ctx.byHour.get(hour);
    if (!r || (!r.qty && !raw?.quantity && (r.future || r.outside))) return res(`${hl(hour)}`, [lineNote, r?.future ? `${hl(hour)} has not started yet.` : `No production in ${hl(hour)} on ${fmtDay(ctx.focusDate)}.`]);
    const wr = ctx.rows.find((x) => x.hour === hour);
    const medCycle = median(ctx.rows.filter((x) => x.qty >= 10 && x.cycle).map((x) => x.cycle));
    const causes = wr ? causesOf(ctx, wr, medCycle) : [];
    const M = typicalRate(ctx);
    return res(`${r.label}: ${fmtN(r.qty + (r.lunchQty || 0))} pcs`, [lineNote,
      `${r.label} on ${fmtDay(ctx.focusDate)}: ${fmtN(r.qty)} pcs in ${fmtMins(r.workSec)} working time${r.lunchQty ? ` (+${r.lunchQty} during lunch)` : ''}${r.plan > 0 ? `; target ${fmtN(r.plan)} (${fmtPct(r.pct)}, ${r.qty >= r.plan ? '+' : '−'}${fmtN(Math.abs(r.qty - r.plan))})` : ''}.`,
      r.cycle ? `Average cycle ${fmtSec(r.cycle)}${r.targetCycle ? ` vs target ${fmtSec(r.targetCycle)}` : ''}.` : null,
      r.models?.length ? `Models: ${r.models.map((m) => `${m.model} ${m.qty}`).join(', ')}.` : null,
      M && wr ? `A normal hour of this day makes about ${fmtN(M * (r.workSec / 3600))} pcs in the same time.` : null,
      causes.length ? `Notes: ${causes.join('; ')}.` : null,
      ctx.lossByHour[hour] ? null : (r.plan > 0 && r.qty < r.plan * 0.9 ? 'No loss reason recorded for this hour.' : null)], { follow: ['Best hour kaunsa tha?', 'Line peeche kyun hai?'] });
  }

  if (model && !has(q, /\btop\b/)) {
    const m = ctx.models.find((x) => String(x.mmId) === String(model.mmId)) || model;
    const tg = targetOf(ctx.targets, m.mmId);
    const today = sum(ctx.td.rows.map((r) => (r.models || []).filter((x) => String(x.mmId) === String(m.mmId)).reduce((s, x) => s + x.qty, 0)));
    const hrs = ctx.td.rows.filter((r) => (r.models || []).some((x) => String(x.mmId) === String(m.mmId))).map((r) => r.label);
    const c = N(m.avgActualCycleSeconds);
    return res(`${m.model}${m.companyTitle ? ` (${m.companyTitle})` : ''}`, [lineNote,
      `${fmtDay(ctx.focusDate)}: ${fmtN(today)} pcs${hrs.length ? ` in ${hrs.join(', ')}` : ''}.`,
      m.quantity != null ? `Selected period: ${fmtN(m.quantity)} pcs in ${m.activeHours ?? '—'} production hours; average cycle ${fmtSec(c)}${N(m.minActualCycleSeconds) != null ? ` (range ${fmtSec(m.minActualCycleSeconds)}–${fmtSec(m.maxActualCycleSeconds)})` : ''}.` : null,
      tg ? `Target ${fmtSec(tg)} per piece (${fmtN(pphOf(tg))} pcs/hr)${c ? ` → ${c <= tg ? 'running at or faster than target' : `${fmtPct((c / tg - 1) * 100)} slower than target`}` : ''}.` : 'No target set for this model — set one in Model targets or Model analysis.',
      ctx.running && String(ctx.running.mmId) === String(m.mmId) && ctx.running.currentCycle ? `Running now: last 20 pieces at ${fmtSec(ctx.running.currentCycle)} each.` : null], { follow: ['Top models', 'Running model ka cycle?'] });
  }

  if (has(q, /forecast|predict|end tak|shift end|banega|ban jayega|ho jayega|ho payega|reach|projection|kitna aur|poora|pura|complete|achieve|hit/)) {
    const f = fc();
    const lines = [lineNote, f.text];
    if (f.state === 'live') {
      lines.push(`Basis: recent rate ${fmtN(f.recentRate)} pcs/hr, day rate ${fmtN(f.dayRate)} pcs/hr${f.histRest != null ? `, earlier days ${fmtN(f.histRest)} pcs in the remaining hours` : ''}; ${fmtMins(f.remainingSec)} working time left.`);
      if (f.chance != null) lines.push(`Chance of reaching the target: about ${fmtPct(f.chance)} (estimate from today's hour-to-hour variation).`);
    }
    return res('Forecast', lines, { follow: ['Line peeche kyun hai?', 'Kya karna chahiye?'] });
  }

  if (has(q, /kyu|kyun|why|reason|wajah|peeche|piche|behind|problem|issue|dikkat|galat|kya hua|alert|anomal/)) {
    const al = anomalies(ctx).filter((a) => a.level !== 'good');
    const b = brief(ctx);
    if (!al.length) return res('No problem found', [lineNote, b.headline, 'No weak hour, long stop, cycle spike or rejection spike was found.']);
    return res('What is holding the line back', [lineNote, b.headline, 'Main findings, most serious first:'],
      { bullets: al.slice(0, 6).map((a) => `${a.title} — ${a.detail}`), follow: ['Kya karna chahiye?', 'Target poora hoga?'] });
  }

  if (has(q, /kya kar|what (should|to) do|improve|sudhar|suggest|action|recommend|better/)) {
    const b = brief(ctx);
    if (!b.actions.length) return res('Nothing urgent', [lineNote, 'No action with a clear gain was found for this day.']);
    return res('What to do (largest gain first)', [lineNote], { bullets: b.actions.slice(0, 5).map((a) => `${a.title}${a.gain >= 1 ? ` (+${fmtN(a.gain)} pcs)` : ''}: ${a.detail}`), follow: ['Line peeche kyun hai?'] });
  }

  if (has(q, /best|sabse (jyada|zyada|acha|accha|tez)|highest|maximum|max /)) {
    const b = brief(ctx);
    if (!b.best) return res('Best hour', [lineNote, 'No full production hour yet.']);
    return res(`Best hour ${b.best.label}`, [lineNote, `${b.best.label}: ${fmtN(b.best.qty)} pcs (${fmtN(b.best.rate)} pcs/hr)${b.best.cycle ? `, cycle ${fmtSec(b.best.cycle)}` : ''}${b.best.plan > 0 ? `, ${fmtPct(b.best.pct)} of its target` : ''}.`, b.worst && b.worst !== b.best ? `Weakest full hour: ${b.worst.label} with ${fmtN(b.worst.qty)} pcs (${fmtN(b.worst.rate)} pcs/hr).` : null], { follow: [`${b.worst ? b.worst.label.slice(0, 2) : '10'} baje kya hua?`] });
  }
  if (has(q, /worst|sabse kam|lowest|minimum|kharab|slowest|weak/)) {
    const b = brief(ctx);
    if (!b.worst) return res('Weakest hour', [lineNote, 'No full production hour yet.']);
    const wr = ctx.rows.find((x) => x.hour === b.worst.hour);
    const causes = wr ? causesOf(ctx, wr, median(ctx.rows.filter((x) => x.qty >= 10 && x.cycle).map((x) => x.cycle))) : [];
    return res(`Weakest hour ${b.worst.label}`, [lineNote, `${b.worst.label}: ${fmtN(b.worst.qty)} pcs (${fmtN(b.worst.rate)} pcs/hr)${b.worst.plan > 0 ? `, ${fmtPct(b.worst.pct)} of its target` : ''}.`, causes.length ? `Probable cause: ${causes.join('; ')}.` : null]);
  }

  if (has(q, /band|ruk|stop|idle|downtime|breakdown|loss|nuksan/)) {
    const b = brief(ctx);
    const top = ctx.rows.filter((r) => r.idleSec > 0).sort((a, b2) => b2.idleSec - a.idleSec).slice(0, 3);
    return res(`Stops: ${fmtMins(ctx.idleSec)}`, [lineNote, ...b.sections.find((s) => s.key === 'time').points,
      top.length ? `Longest stop time in ${top.map((r) => `${r.label} (${fmtMins(r.idleSec)})`).join(', ')}.` : null], { follow: ['Kya karna chahiye?'] });
  }

  if (has(q, /reject|false|duplicate|quality|wrong scan/)) {
    const b = brief(ctx);
    const s = b.sections.find((x) => x.key === 'quality');
    return res('Rejections', [lineNote, ...(s ? s.points : ['No rejection data for this day.'])], { bullets: (ctx.rejection?.reasons || []).slice(0, 5).map((r) => `${r.reason}: ${r.rejectionQty}`) });
  }

  if (has(q, /running|chal raha|chal rha|current|abhi|now/) && ctx.running?.model) {
    const r = ctx.running, tg = targetOf(ctx.targets, r.mmId);
    return res(`Running: ${r.model}`, [lineNote, `${r.company ? `${r.company} · ` : ''}${r.model}${r.qty != null ? ` — ${fmtN(r.qty)} pcs today` : ''}.`,
      r.currentCycle ? `Current speed: ${fmtSec(r.currentCycle)} per piece (${fmtN(3600 / r.currentCycle)} pcs/hr, last 20 pieces).` : null,
      tg ? `Target ${fmtSec(tg)} (${fmtN(pphOf(tg))} pcs/hr)${r.currentCycle ? ` → ${r.currentCycle <= tg ? 'on or above target speed' : `${fmtPct((r.currentCycle / tg - 1) * 100)} slower than target`}` : ''}.` : 'No target set for this model.'], { follow: ['Target poora hoga?'] });
  }

  if (has(q, /cycle|speed|takt|rate|pcs\/hr|per hour/)) {
    const b = brief(ctx);
    return res(`Cycle: ${fmtSec(ctx.dayCycle)}`, [lineNote, ...b.sections.find((s) => s.key === 'cycle').points.slice(0, 2)],
      { bullets: ctx.rows.filter((r) => r.cycle).map((r) => `${r.label}: ${fmtSec(r.cycle)}${r.targetCycle ? ` (target ${fmtSec(r.targetCycle)})` : ''}`), follow: ['Running model ka cycle?'] });
  }

  if (has(q, /\btop\b|model|kaunsa model|which model/)) {
    const ms = [...ctx.models].sort((a, b) => b.quantity - a.quantity).slice(0, 8);
    return res('Top models (selected period)', [lineNote], { table: { head: ['Model', 'Company', 'Pcs', 'Avg cycle', 'Target'], rows: ms.map((m) => [m.model, m.companyTitle || '', fmtN(m.quantity), fmtSec(N(m.avgActualCycleSeconds)), targetOf(ctx.targets, m.mmId) ? fmtSec(targetOf(ctx.targets, m.mmId)) : '—']) } });
  }

  if (has(q, /target/)) {
    const t = ctx.td.total;
    if (!(t.planFull > 0)) return res('Target', [lineNote, 'No model targets are set for the models of this day. Set them in "Model targets" (Overview) or with "Use achieved as targets" in Model analysis.']);
    return res(`Target ${fmtPct(t.pct)}`, [lineNote, `${fmtN(t.qty)} pcs vs ${ctx.isToday ? `target up to now ${fmtN(t.plan)} (day target ${fmtN(t.planFull)})` : `day target ${fmtN(t.planFull)}`} → ${t.qty >= t.plan ? '+' : '−'}${fmtN(Math.abs(t.qty - t.plan))} pcs.`, ctx.isToday ? fc().text : null], { follow: ['Line peeche kyun hai?'] });
  }

  if (has(q, /production|kitna|kitne|qty|quantity|output|total|pcs|bana|bani|banaya|summary|report|brief|overall|kaisa|status|hal/)) {
    const b = brief(ctx);
    return res(`${fmtN(ctx.dayQty)} pcs`, [lineNote, b.headline, b.score != null ? `Line health ${b.score}/100 (${b.grade}).` : null], { bullets: b.sections.find((s) => s.key === 'production').points, follow: ['Line peeche kyun hai?', 'Target poora hoga?'] });
  }

  return res('Not understood', [lineNote, 'I could not match the question. Try one of these, or type "help".'], { follow: SUGGESTIONS.slice(0, 6) });
}
