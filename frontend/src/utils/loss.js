import { windowHours } from './analysis';
import { workSecInHour } from './shift';
import { serverNow } from './serverTime';

const pad = (n) => String(n).padStart(2, '0');
/** Date as YYYY-MM-DD; default = DB server ki aaj ki date (browser ka clock nahi). */
export const localDate = (d = serverNow()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Standard cycle of a model: the manual value if set, otherwise its clean average actual cycle (the two are identical until edited). */
export function resolveStd(stds, m, fallback = null) {
  const manual = Number(stds?.[m.mmId]);
  if (manual > 0) return { sec: manual, auto: false };
  const a = Number(m.avgActualCycleSeconds);
  if (a > 0) return { sec: a, auto: true };
  return { sec: fallback > 0 ? fallback : null, auto: true };
}

/**
 * Hour-wise, model-wise loss for the focus day.
 *  - Models running in an hour come from each model's hourly quantities.
 *  - If those quantities do not add up to the day's hourly total (e.g. range aggregate), they are scaled to it.
 *  - time consumed = Σ (model qty × model standard cycle)
 *  - loss = max(0, available time − time consumed); allocated to models pro-rata to the time each consumed.
 */
export function buildHourLoss({ summary, models, low, stds, settings, focusDate, now = serverNow() }) {
  if (!summary?.hours) return null;
  const all = [...(models || []), ...(low || [])];

  let wq = 0, ws = 0;
  for (const m of all) { const a = Number(m.avgActualCycleSeconds), q = Number(m.quantity) || 0; if (a > 0 && q > 0) { wq += q; ws += q * a; } }
  const fb = wq > 0 ? ws / wq : null;
  const std = new Map(all.map((m) => [m.mmId, resolveStd(stds, m, fb)]));

  const wh = windowHours(settings).map((x) => (typeof x === 'object' ? Number(x.hour) : Number(x))).sort((a, b) => a - b);
  const isToday = focusDate === localDate(now);
  let scaled = false;
  const rows = [];

  for (const hr of wh) {
    // available time = working time of the hour: the lunch window (settings.shift) is not counted as loss
    let availSec = settings?.shift ? workSecInHour(settings.shift, hr) : 3600, partial = false;
    if (isToday) {
      if (hr > now.getHours()) continue;
      if (hr === now.getHours()) {
        const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        availSec = settings?.shift ? workSecInHour(settings.shift, hr, nowMin) : now.getMinutes() * 60 + now.getSeconds();
        partial = true;
      }
    }
    const qty = Number(summary.hours.find((h) => Number(h.hour) === hr)?.quantity) || 0;

    const raw = all.map((m) => ({ m, q: Number((m.hourly || []).find((h) => Number(h.hour) === hr)?.quantity) || 0 })).filter((x) => x.q > 0);
    const rawSum = raw.reduce((s, x) => s + x.q, 0);
    const k = rawSum > 0 ? qty / rawSum : 0;
    if (rawSum > 0 && Math.abs(k - 1) > 0.001) scaled = true;

    const mrows = raw.map(({ m, q }) => {
      const s = std.get(m.mmId);
      const mq = q * k;
      return {
        mmId: m.mmId, model: m.model, code: m.modelCode, qty: mq, stdSec: s?.sec ?? null, stdAuto: s?.auto ?? true,
        actSec: m.avgActualCycleSeconds != null ? Number(m.avgActualCycleSeconds) : null,
        usedSec: s?.sec ? mq * s.sec : 0,
      };
    }).sort((a, b) => b.qty - a.qty);

    const modelQty = mrows.reduce((s, x) => s + x.qty, 0);
    const extraQty = Math.max(0, qty - modelQty);          // quantity with no model-wise breakdown
    const usedSec = mrows.reduce((s, x) => s + x.usedSec, 0) + (fb ? extraQty * fb : 0);
    const hasStd = usedSec > 0 || qty === 0;
    const lossSec = hasStd ? Math.max(0, availSec - usedSec) : null;
    const stdMix = qty > 0 && usedSec > 0 ? usedSec / qty : null;

    for (const r of mrows) r.lossSec = lossSec != null && usedSec > 0 ? lossSec * (r.usedSec / usedSec) : 0;

    rows.push({
      hour: hr, label: `${pad(hr)}-${pad(hr + 1)}`, qty, availSec, partial, models: mrows, usedSec, lossSec, stdMix,
      targetQty: stdMix ? availSec / stdMix : null,
    });
  }

  const totals = rows.reduce((a, r) => ({
    qty: a.qty + r.qty, target: a.target + (r.targetQty || 0), lossSec: a.lossSec + (r.lossSec || 0), availSec: a.availSec + r.availSec,
  }), { qty: 0, target: 0, lossSec: 0, availSec: 0 });
  return { rows, totals, scaled, hasData: rows.some((r) => r.qty > 0) };
}