/* Statistical helpers for the Control charts page (all client-side, so limits can be changed instantly). */
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
export const mean = (a) => (a.length ? sum(a) / a.length : null);
export function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a); let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}
export function percentile(sorted, p) {                 // Excel PERCENTILE.INC
  if (!sorted.length) return null;
  const r = (sorted.length - 1) * p, lo = Math.floor(r), hi = Math.ceil(r);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (r - lo);
}
const sortNum = (a) => Float64Array.from(a).sort();
export const median = (a) => (a.length ? percentile(sortNum(a), 0.5) : null);

/* log-gamma (Lanczos) → c4 constant for the S chart */
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1; let x = LG[0];
  for (let i = 1; i < 9; i++) x += LG[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
export const c4 = (n) => (n < 2 ? null : Math.sqrt(2 / (n - 1)) * Math.exp(lgamma(n / 2) - lgamma((n - 1) / 2)));

export const MODES = {
  manual: { label: 'Manual (Min – Max)', k: null },
  iqr: { label: 'Auto · IQR (Tukey)', k: 1.5, kLabel: 'IQR multiplier' },
  mad: { label: 'Auto · Robust MAD', k: 3, kLabel: 'MAD multiplier' },
  median: { label: 'Auto · Median multiple', k: 3, kLabel: 'Median multiple' },
};

/**
 * Valid cycle window [lo, hi] for one model.
 * Manual: exactly Min–Max. Auto modes: fences computed from the gaps that lie inside the Min floor / Max ceiling,
 * then clipped to that floor / ceiling. Cycle time = average of the gaps inside the window.
 */
export function computeWindow(gaps, o) {
  const min = Math.max(0, Number(o.min) || 0);
  const max = Number(o.max) > 0 ? Number(o.max) : Infinity;
  let lo = min, hi = max, info = {};
  if (o.mode !== 'manual') {
    const base = [];
    for (let i = 0; i < gaps.length; i++) if (gaps[i] >= min && gaps[i] <= max) base.push(gaps[i]);
    if (base.length >= 8) {
      const s = sortNum(base), k = Number(o.k) || MODES[o.mode].k;
      if (o.mode === 'iqr') {
        const q1 = percentile(s, 0.25), q3 = percentile(s, 0.75), iqr = q3 - q1;
        lo = Math.max(min, q1 - k * iqr); hi = Math.min(max, q3 + k * iqr); info = { q1, q3, iqr };
      } else if (o.mode === 'mad') {
        const med = percentile(s, 0.5);
        const dev = sortNum(Array.from(s, (x) => Math.abs(x - med)));
        const mad = Math.max(0.5, 1.4826 * percentile(dev, 0.5));
        lo = Math.max(min, med - k * mad); hi = Math.min(max, med + k * mad); info = { med, mad };
      } else {
        const med = percentile(s, 0.5);
        hi = Math.min(max, k * med); info = { med };
      }
    }
  }
  return { lo, hi, info, min, max };
}

const pad = (n) => String(n).padStart(2, '0');
export function weekStart(ds) {
  const d = new Date(`${ds}T00:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Applies the window and groups the valid gaps into subgroups (day or week). */
export function buildSubgroups(days, win, by) {
  const groups = new Map();
  for (const d of Object.keys(days).sort()) {
    const { g, h, q, o } = days[d];
    const key = by === 'week' ? weekStart(d) : d;
    let gr = groups.get(key);
    if (!gr) { gr = { key, label: key, qty: 0, gaps: 0, over: 0, below: 0, above: 0, vals: [], hrs: [] }; groups.set(key, gr); }
    gr.qty += q || 0; gr.over += o || 0; gr.gaps += g.length;
    for (let i = 0; i < g.length; i++) {
      const v = g[i];
      if (v < win.lo) gr.below++; else if (v > win.hi) gr.above++; else { gr.vals.push(v); gr.hrs.push(h[i]); }
    }
  }
  return [...groups.values()].map((gr) => {
    let mn = null, mx = null;
    for (const v of gr.vals) { if (mn === null || v < mn) mn = v; if (mx === null || v > mx) mx = v; }
    return { ...gr, n: gr.vals.length, mean: mean(gr.vals), sd: stdev(gr.vals), min: mn, max: mx, med: median(gr.vals) };
  });
}

export const RULES = {
  R1: 'One point beyond 3σ',
  R2: '2 of 3 consecutive points beyond 2σ (same side)',
  R3: '4 of 5 consecutive points beyond 1σ (same side)',
  R4: '8 consecutive points on one side of the centre line',
};
export function applyRules(z) {
  return z.map((v, i) => {
    const f = [], side = Math.sign(v);
    if (Math.abs(v) > 3) f.push('R1');
    if (side && Math.abs(v) > 2 && i >= 2 && z.slice(i - 2, i + 1).filter((x) => Math.sign(x) === side && Math.abs(x) > 2).length >= 2) f.push('R2');
    if (side && Math.abs(v) > 1 && i >= 4 && z.slice(i - 4, i + 1).filter((x) => Math.sign(x) === side && Math.abs(x) > 1).length >= 4) f.push('R3');
    if (side && i >= 7 && z.slice(i - 7, i + 1).every((x) => Math.sign(x) === side)) f.push('R4');
    return f;
  });
}

function pooledSigma(pts) {
  let num = 0, den = 0;
  for (const p of pts) if (p.n >= 2 && p.sd != null) { num += (p.n - 1) * p.sd ** 2; den += p.n - 1; }
  return den > 0 ? Math.sqrt(num / den) : null;
}

/**
 * Control chart for subgroup means.
 *  method 'mr'    : limits from the moving range of the means (σ = MR̄ ÷ 1.128) — robust to day-to-day shifts.
 *  method 'sigma' : X̄–S chart, limits from pooled within-subgroup σ ÷ √n (tighter; very sensitive for large n).
 *  phase1         : points beyond 3σ are excluded from the limit calculation (repeated until stable).
 */
export function controlChart(sub, method, phase1) {
  const pts = sub.filter((s) => s.n >= 1 && s.mean != null);
  if (pts.length < 3) return null;
  const use = pts.map(() => true);
  let cl = 0, sig = [], mrBar = 0, sp = null;
  const maxExcl = phase1 ? Math.floor(pts.length * 0.3) : 0;     // never discard more than 30 % of the points
  for (let it = 0; it <= maxExcl; it++) {
    const base = pts.filter((_, i) => use[i]);
    if (base.length < 3) break;
    if (method === 'sigma') {
      const wn = sum(base.map((p) => p.n));
      cl = sum(base.map((p) => p.n * p.mean)) / wn;
      sp = pooledSigma(base) ?? pooledSigma(pts) ?? 0;
      sig = pts.map((p) => sp / Math.sqrt(p.n));
    } else {
      const xs = base.map((p) => p.mean);
      cl = mean(xs);
      let m = 0; for (let i = 1; i < xs.length; i++) m += Math.abs(xs[i] - xs[i - 1]);
      mrBar = xs.length > 1 ? m / (xs.length - 1) : 0;
      sig = pts.map(() => mrBar / 1.128);
    }
    if (!phase1 || it === maxExcl) break;
    // exclude only the single worst point per pass, then recompute (prevents a level shift from wiping out every point)
    let worst = -1, wz = 3;
    pts.forEach((p, i) => { if (use[i] && sig[i] > 0) { const zz = Math.abs((p.mean - cl) / sig[i]); if (zz > wz) { wz = zz; worst = i; } } });
    if (worst < 0) break;
    use[worst] = false;
  }
  const z = pts.map((p, i) => (sig[i] > 0 ? (p.mean - cl) / sig[i] : 0));
  const flags = applyRules(z);
  const rows = pts.map((p, i) => ({
    ...p, x: p.mean, cl, z: z[i], sigma: sig[i], rules: flags[i], excluded: !use[i],
    ucl: cl + 3 * sig[i], lcl: cl - 3 * sig[i], u2: cl + 2 * sig[i], l2: cl - 2 * sig[i], u1: cl + sig[i], l1: cl - sig[i],
  }));
  let disp;
  if (method === 'sigma') {
    const s0 = sp || 0;
    disp = rows.filter((r) => r.n >= 2 && r.sd != null).map((r) => {
      const c = c4(r.n), w = 3 * Math.sqrt(Math.max(0, 1 - c * c));
      return { label: r.label, v: r.sd, cl: c * s0, ucl: s0 * (c + w), lcl: Math.max(0, s0 * (c - w)), n: r.n };
    });
  } else {
    disp = rows.slice(1).map((r, i) => ({ label: r.label, v: Math.abs(r.mean - rows[i].mean), cl: mrBar, ucl: 3.267 * mrBar, lcl: 0, n: r.n }));
  }
  return { rows, cl, sigma: sig.length ? sig[sig.length - 1] : 0, mrBar, pooled: sp, disp, method,
    signals: rows.filter((r) => r.rules.length).length, r1: rows.filter((r) => r.rules.includes('R1')).length,
    excluded: rows.filter((r) => r.excluded).length };
}

export function capability(vals, usl) {
  const n = vals.length, m = mean(vals), sd = stdev(vals);
  let within = null;
  if (usl > 0 && n) { let c = 0; for (const v of vals) if (v <= usl) c++; within = (c / n) * 100; }
  return { n, mean: m, sd, cpk: usl > 0 && sd > 0 ? (usl - m) / (3 * sd) : null, within };
}

export function histogram(allGaps, win, cap) {
  if (!allGaps.length) return null;
  const s = sortNum(allGaps), p99 = percentile(s, 0.99);
  const top = Math.min(cap, Math.max(Number.isFinite(win.hi) ? win.hi * 1.25 : 0, p99 * 1.05, 10));
  const width = Math.max(1, Math.ceil(top / 40));
  const nb = Math.ceil(top / width) + 1, bins = Array.from({ length: nb }, (_, i) => ({ from: i * width, label: String(i * width), inside: 0, outside: 0 }));
  let beyond = 0;
  for (const g of allGaps) {
    const i = Math.floor(g / width);
    if (i >= nb) { beyond++; continue; }
    if (g >= win.lo && g <= win.hi) bins[i].inside++; else bins[i].outside++;
  }
  return { bins, width, beyond, labelFor: (v) => bins[Math.min(nb - 1, Math.max(0, Math.floor(v / width)))].label };
}

export function hourPattern(vals, hrs) {
  const o = {};
  for (let i = 0; i < vals.length; i++) (o[hrs[i]] = o[hrs[i]] || []).push(vals[i]);
  return Object.keys(o).map(Number).sort((a, b) => a - b).map((h) => ({ hour: h, label: `${pad(h)}-${pad(h + 1)}`, n: o[h].length, mean: mean(o[h]), sd: stdev(o[h]) }));
}

/**
 * Occurrence count of each whole second.
 * Bin s = (s-1, s] seconds. The last bin holds all gaps above maxSec (including gaps above the data cap).
 * valid = inside the window; removed = at or below maxSec but outside the window (e.g. below Min); above = above maxSec.
 */
export function secondCounts(days, win, maxSec) {
  const top = Math.max(1, Math.ceil(maxSec));
  const OVER = top + 1;
  const bins = Array.from({ length: top + 2 }, (_, i) => ({
    sec: i, over: i === OVER, label: i === OVER ? `>${maxSec}s` : `${i}s`,
    count: 0, valid: 0, removed: 0, above: 0, cap: 0, sum: 0, minV: null, maxV: null, days: {}, hours: {},
  }));
  for (const d of Object.keys(days)) {
    const { g, h, o } = days[d];
    for (let i = 0; i < g.length; i++) {
      const v = g[i];
      const b = bins[v > maxSec ? OVER : Math.min(top, Math.ceil(v))];
      b.count++; b.sum += v;
      if (b.minV === null || v < b.minV) b.minV = v;
      if (b.maxV === null || v > b.maxV) b.maxV = v;
      if (b.over) b.above++; else if (v >= win.lo && v <= win.hi) b.valid++; else b.removed++;
      b.days[d] = (b.days[d] || 0) + 1;
      b.hours[h[i]] = (b.hours[h[i]] || 0) + 1;
    }
    if (o) { const b = bins[OVER]; b.count += o; b.above += o; b.cap += o; b.days[d] = (b.days[d] || 0) + o; }
  }
  const tot = (k) => bins.reduce((s, b) => s + b[k], 0);
  return { bins, top, OVER, total: tot('count'), valid: tot('valid'), removed: tot('removed'), above: bins[OVER].count };
}
/**
 * Achieved cycle = the whole second with the most VALID cycles, i.e. the tallest bar of the 1-second histogram
 * (same bins as secondCounts: second s holds (s−1, s]). A tie goes to the faster second.
 * Covered = every valid cycle at the achieved second OR FASTER (gap ≤ achieved second): upTo pieces, upToShare %.
 * Target from achieved = the achieved second as target cycle → 3600 ÷ achieved pieces per hour.
 * Returns { sec, count, share %, upTo, upToShare %, targetPph, label, range } or null.
 */
export function achievedCycle(vals) {
  if (!vals || !vals.length) return null;
  const counts = new Map();
  for (let i = 0; i < vals.length; i++) {
    const s = Math.max(0, Math.ceil(vals[i]));
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let sec = null, count = 0;
  for (const [s, c] of counts) if (c > count || (c === count && s < sec)) { sec = s; count = c; }
  let upTo = 0;
  for (const [x, c] of counts) if (x <= sec) upTo += c;
  return {
    sec, count, share: (count / vals.length) * 100, upTo, upToShare: (upTo / vals.length) * 100,
    targetPph: sec > 0 ? 3600 / sec : null, label: `${sec} s`, range: `${Math.max(0, sec - 1)}–${sec} s`,
  };
}
