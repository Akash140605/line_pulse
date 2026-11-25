/**
 * Ticks for a quantity axis that starts at the base value, so no space is wasted below it.
 *
 *   daily production : axisTicks(maxQty, 1000, 200, minQty) → 1000, 1200, 1400, …
 *   hourly production: axisTicks(maxQty, 100, 20, minQty)   → 100, 120, 140, …
 *
 * If the lowest bar is below or close to the base (a short day or hour), the axis starts one step lower
 * (1002 → 800, 850 → 600 … never below 0), so every bar stays clearly visible. Zero values (no production) are ignored.
 * With `fromZero: true` the axis starts at 0 (use this for stacked bars).
 *
 * Returns { ticks, domain } to pass to a recharts YAxis as `ticks`, `domain` and `allowDataOverflow`.
 */
export function axisTicks(maxValue, base, step, minValue = null, { fromZero = false, maxTicks = 0 } = {}) {
  const r = axisTicksRaw(maxValue, base, step, minValue, fromZero);
  // too many labels (e.g. four lines stacked): widen the step so at most maxTicks labels remain
  if (maxTicks > 1 && r.ticks.length > maxTicks) {
    const k = Math.ceil((r.ticks.length - 1) / (maxTicks - 1));
    return axisTicks(maxValue, base, step * k, minValue, { fromZero, maxTicks });
  }
  return r;
}

function axisTicksRaw(maxValue, base, step, minValue, fromZero) {
  const top = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 0;
  let start = base;
  if (fromZero) start = 0;
  // keep at least half a step of the lowest bar visible: 1002 → axis from 800, 40 → axis from 20
  else if (Number.isFinite(minValue) && minValue > 0) start = Math.max(0, Math.min(base, Math.floor((minValue - step / 2) / step) * step));
  const ticks = fromZero && base > 0 ? [0] : [];
  let v = fromZero ? base : start;
  while (v < top) {
    ticks.push(v);
    v += step;
  }
  ticks.push(v); // first tick at or above the maximum
  if (ticks.length === 1) ticks.push(v + step); // no data: keep a valid range
  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
}

/** Same as axisTicks, from a list of values (zeros ignored for the lower end). */
export function qtyAxisFor(values, base, step, opts) {
  const nums = values.map(Number).filter((v) => Number.isFinite(v) && v > 0);
  const max = nums.length ? Math.max(...nums) : 0;
  const min = nums.length ? Math.min(...nums) : null;
  return axisTicks(max, base, step, min, opts);
}

/**
 * Ticks for a cycle-time axis in seconds: 0 and 3–5 round steps (5, 10, 15, 20, 30 s, 1 min …).
 * Returns { ticks, domain } like axisTicks.
 */
export function secondsTicks(maxSec, count = 4) {
  const top = Number.isFinite(maxSec) && maxSec > 0 ? maxSec : 10;
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => top / s <= count) ?? Math.ceil(top / count / 3600) * 3600;
  const n = Math.max(1, Math.ceil(top / step - 1e-9));
  const ticks = Array.from({ length: n + 1 }, (_, i) => i * step);
  return { ticks, domain: [0, ticks[ticks.length - 1]] };
}

/** Short label for an axis tick in seconds: 45 → "45s", 90 → "90s" (below 2 min stays in seconds), 120 → "2m", 150 → "2.5m". */
export function secLabel(v) {
  if (!Number.isFinite(v)) return '';
  if (v < 120) return `${v}s`;
  const m = v / 60;
  return `${Number.isInteger(m) ? m : m.toFixed(1)}m`;
}
