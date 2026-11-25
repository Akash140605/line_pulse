// Pure statistics helpers (no React) — unit-tested in tests/stats.calc.test.js
export const PAL = { blue: 'rgb(var(--blue-600))', teal: '#01B8AA', amber: '#F2A93B', red: 'rgb(var(--red-600))', violet: '#7C3AED', green: '#16A34A', slate: '#64748B', cyan: '#0891B2' };
export const SERIES = ['rgb(var(--blue-600))', '#01B8AA', '#F2A93B', 'rgb(var(--red-600))', '#7C3AED', '#0891B2', '#16A34A', '#DB2777'];

/**
 * Pareto: sort desc, keep top N (rest -> "Others"), cumulative %, ABC class.
 * Class A = items needed to reach 80 % of the total, B = up to 95 %, C = the tail.
 */
export function pareto(items, { top = 12, valueKey = 'value', nameKey = 'name' } = {}) {
  const sorted = items.filter((i) => i[valueKey] > 0).sort((a, b) => b[valueKey] - a[valueKey]);
  const total = sorted.reduce((a, i) => a + i[valueKey], 0);
  const head = sorted.slice(0, top).map((i) => ({ ...i, name: i[nameKey], value: i[valueKey] }));
  const rest = sorted.slice(top);
  if (rest.length) head.push({ name: `Others (${rest.length})`, value: rest.reduce((a, i) => a + i[valueKey], 0), id: null, others: true });
  let cum = 0;
  return head.map((i) => {
    const before = total ? (cum / total) * 100 : 0;
    cum += i.value;
    return { ...i, pct: total ? (i.value / total) * 100 : 0, cumPct: total ? (cum / total) * 100 : 0, cls: before < 80 ? 'A' : before < 95 ? 'B' : 'C' };
  });
}

/** Individuals (I-MR) control chart: CL = mean, sigma = avg moving range / 1.128, limits = CL ± 3 sigma. */
export function spc(values) {
  // null / undefined / non-numeric (NaN, '') are gaps in the series; a NaN must never reach the mean or the limits
  const v = values.map((x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x)));
  const valid = v.filter((x) => x !== null);
  if (valid.length < 3) return null;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  let mrSum = 0, mrN = 0, prev = null;
  for (const x of v) { if (x === null) continue; if (prev !== null) { mrSum += Math.abs(x - prev); mrN++; } prev = x; }
  const sigma = mrN ? mrSum / mrN / 1.128 : 0;
  const ucl = mean + 3 * sigma;
  const lcl = Math.max(0, mean - 3 * sigma);
  // rule 1: beyond limits · rule 2: 7 consecutive points on one side of the centre line
  let run = 0, side = 0;
  const points = v.map((x, i) => {
    if (x === null) { run = 0; side = 0; return { i, v: null, out: false, run: false }; }
    const s = x > mean ? 1 : x < mean ? -1 : 0;
    run = s !== 0 && s === side ? run + 1 : s !== 0 ? 1 : 0;
    side = s;
    return { i, v: x, out: x > ucl || x < lcl, run: run >= 7 };
  });
  // mark the whole run, not only its 7th point
  for (let i = 0; i < points.length; i++) if (points[i].run) for (let j = Math.max(0, i - 6); j <= i; j++) points[j].run = true;
  return { mean, sigma, ucl, lcl, points, outCount: points.filter((p) => p.out).length, runCount: points.filter((p) => p.run).length };
}

/** One-sided process capability against an upper limit (takt): Cpk = (USL - mean) / (3 sigma). */
export const cpk = (mean, std, usl) => (usl > 0 && std > 0 && mean != null ? (usl - mean) / (3 * std) : null);

/** Stability from coefficient of variation: <15 % stable, <30 % watch, else unstable. */
export const stabilityOf = (cv) => (cv == null ? 'idle' : cv < 15 ? 'ok' : cv < 30 ? 'watch' : 'behind');

export function movingAvg(values, k = 3) {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - k + 1), i + 1).filter((x) => x != null);
    // average of the non-null values in the window; null before the first full window and when the window has no values
    return i >= k - 1 && w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}

/** counts + bin width -> bin objects for charts (last bin is the overflow bin). */
export function buildBins(counts, width) {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const last = counts.length - 1;
  return counts.map((c, i) => ({
    from: i * width, to: (i + 1) * width, count: c, pct: (c / total) * 100,
    label: i === last && last > 0 ? `≥${i * width}` : width === 1 ? `${i * width}` : `${i * width}-${(i + 1) * width}`,
  }));
}

/** share of cycles <= limit, interpolating inside the bin that contains the limit. */
export function shareWithin(counts, width, limit) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total || !(limit > 0)) return null;
  let within = 0;
  counts.forEach((c, i) => {
    const from = i * width, to = (i + 1) * width;
    if (to <= limit) within += c;
    else if (from < limit) within += c * ((limit - from) / width);
  });
  return (within / total) * 100;
}
