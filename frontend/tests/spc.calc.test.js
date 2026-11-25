// Calculation tests for src/utils/spc.js (Control charts page) and src/utils/cycleLoss.js (loss vs target).
import { describe, it, expect } from 'vitest';
import {
  mean, stdev, percentile, median, c4, computeWindow, weekStart, buildSubgroups, applyRules, controlChart,
  capability, histogram, hourPattern, secondCounts,
} from '../src/utils/spc';
import { lossAnalysis } from '../src/utils/cycleLoss';

describe('basic statistics', () => {
  it('mean', () => {
    expect(mean([])).toBeNull();
    expect(mean([7])).toBe(7);
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('sample standard deviation (n − 1)', () => {
    // 2,4,4,4,5,5,7,9: mean 5, Σd² = 32, 32/7
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(stdev([5])).toBeNull();
    expect(stdev([])).toBeNull();
  });
  it('percentile = Excel PERCENTILE.INC', () => {
    const s = [1, 2, 3, 4];
    expect(percentile(s, 0)).toBe(1);
    expect(percentile(s, 0.25)).toBe(1.75);   // rank 0.75
    expect(percentile(s, 0.5)).toBe(2.5);
    expect(percentile(s, 0.9)).toBeCloseTo(3.7, 12);   // rank 2.7
    expect(percentile(s, 1)).toBe(4);
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
  it('median sorts numerically (not as text)', () => {
    expect(median([10, 9, 100])).toBe(10);      // a text sort would give "100"
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('c4 constant (closed forms / table values)', () => {
    expect(c4(1)).toBeNull();
    expect(c4(2)).toBeCloseTo(Math.sqrt(2 / Math.PI), 9);                 // 0.7979
    expect(c4(3)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 9);                 // 0.8862
    expect(c4(4)).toBeCloseTo((2 * Math.sqrt(2 / 3)) / Math.sqrt(Math.PI), 9); // 0.9213
    expect(c4(5)).toBeCloseTo(0.9400, 4);
    expect(c4(10)).toBeCloseTo(0.9727, 4);
    expect(c4(25)).toBeCloseTo(0.9896, 4);
  });
});

describe('computeWindow (valid cycle window)', () => {
  it('manual = exactly Min–Max; Max 0 / empty = no ceiling; negative Min = 0', () => {
    expect(computeWindow([1, 2, 3], { mode: 'manual', min: 5, max: 30 })).toEqual({ lo: 5, hi: 30, info: {}, min: 5, max: 30 });
    const w = computeWindow([], { mode: 'manual', min: -4, max: 0 });
    expect(w.lo).toBe(0);
    expect(w.hi).toBe(Infinity);
  });
  it('median mode: hi = k × median of the gaps inside Min–Max', () => {
    // inside [1, ∞): 10×4, 12×4, 100 (0.5 dropped) → 9 values, median 12 → hi = 36
    const w = computeWindow([10, 10, 10, 10, 12, 12, 12, 12, 100, 0.5], { mode: 'median', min: 1, max: 0 });
    expect(w.lo).toBe(1);
    expect(w.hi).toBe(36);
    expect(w.info.med).toBe(12);
  });
  it('median fence is clipped to Max', () => {
    const w = computeWindow([10, 10, 10, 10, 12, 12, 12, 12, 20], { mode: 'median', min: 1, max: 25, k: 3 });
    expect(w.hi).toBe(25);
  });
  it('IQR mode (Tukey): q1 − k·IQR … q3 + k·IQR, floored at Min', () => {
    // 1..8: q1 = 2.75, q3 = 6.25, IQR 3.5 → hi = 6.25 + 5.25 = 11.5, lo = max(0, −2.5) = 0
    const w = computeWindow([1, 2, 3, 4, 5, 6, 7, 8], { mode: 'iqr', min: 0, max: 0 });
    expect(w.info).toEqual({ q1: 2.75, q3: 6.25, iqr: 3.5 });
    expect(w.lo).toBe(0);
    expect(w.hi).toBe(11.5);
    expect(computeWindow([1, 2, 3, 4, 5, 6, 7, 8], { mode: 'iqr', min: 0, max: 0, k: 1 }).hi).toBe(9.75);
  });
  it('MAD mode: median ± k·max(0.5, 1.4826·MAD)', () => {
    // eight 10s and a 20: median 10, MAD 0 → 0.5 floor → 8.5 … 11.5
    const w = computeWindow([10, 10, 10, 10, 10, 10, 10, 10, 20], { mode: 'mad', min: 1, max: 0 });
    expect(w.lo).toBe(8.5);
    expect(w.hi).toBe(11.5);
  });
  it('auto modes fall back to Min–Max with fewer than 8 gaps inside', () => {
    expect(computeWindow([10, 11, 12], { mode: 'median', min: 1, max: 50 })).toEqual({ lo: 1, hi: 50, info: {}, min: 1, max: 50 });
  });
  it('min > max gives an empty window (nothing passes)', () => {
    const w = computeWindow([5, 15, 25], { mode: 'manual', min: 30, max: 10 });
    expect(w.lo > w.hi).toBe(true);
    const a = computeWindow(new Array(10).fill(20), { mode: 'median', min: 30, max: 10 });
    expect([a.lo, a.hi]).toEqual([30, 10]);
  });
});

describe('weekStart / buildSubgroups', () => {
  it('Monday of the ISO week (local date)', () => {
    expect(weekStart('2026-10-23')).toBe('2026-10-19');   // Friday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');   // Monday
    expect(weekStart('2026-10-25')).toBe('2026-10-19');   // Sunday
    expect(weekStart('2026-01-01')).toBe('2025-12-29');   // across the year end
  });

  const days = {
    '2026-10-20': { g: [5, 10, 40, 12], h: [9, 9, 10, 10], q: 5, o: 1 },
    '2026-10-19': { g: [8, 50], h: [9, 9], q: 3, o: 0 },
  };
  const win = { lo: 6, hi: 30 };

  it('by day: below / inside / above the window, stats of the inside gaps', () => {
    const [d19, d20] = buildSubgroups(days, win, 'day');
    expect(d19).toEqual({ key: '2026-10-19', label: '2026-10-19', qty: 3, gaps: 2, over: 0, below: 0, above: 1, vals: [8], hrs: [9], n: 1, mean: 8, sd: null, min: 8, max: 8, med: 8 });
    expect(d20.vals).toEqual([10, 12]);
    expect(d20.hrs).toEqual([9, 10]);
    expect([d20.below, d20.above, d20.over, d20.gaps, d20.qty]).toEqual([1, 1, 1, 4, 5]);
    expect(d20.mean).toBe(11);
    expect(d20.sd).toBeCloseTo(Math.SQRT2, 12);
  });
  it('by week: both days merge into the week of Monday 19 Oct', () => {
    const w = buildSubgroups(days, win, 'week');
    expect(w).toHaveLength(1);
    expect(w[0].key).toBe('2026-10-19');
    expect(w[0].vals).toEqual([8, 10, 12]);
    expect([w[0].qty, w[0].over, w[0].below, w[0].above]).toEqual([8, 1, 1, 2]);
    expect(w[0].mean).toBe(10);
    expect(w[0].sd).toBe(2);
  });
  it('a day with every gap outside the window has n 0 and null stats', () => {
    const [g] = buildSubgroups({ d: { g: [1, 99], h: [9, 9], q: 2 } }, win, 'day');
    expect([g.n, g.mean, g.sd, g.min, g.max, g.med]).toEqual([0, null, null, null, null, null]);
  });
});

describe('applyRules (Western Electric)', () => {
  it('R1: beyond 3σ', () => {
    expect(applyRules([0.5, 3.5, -1])).toEqual([[], ['R1'], []]);
    expect(applyRules([-3.01])).toEqual([['R1']]);
  });
  it('R2: 2 of 3 beyond 2σ on the same side', () => {
    expect(applyRules([2.5, 0, 2.5])[2]).toEqual(['R2']);
    expect(applyRules([2.5, 0, -2.5])[2]).toEqual([]);
  });
  it('R3: 4 of 5 beyond 1σ on the same side', () => {
    expect(applyRules([1.5, 1.5, 0, 1.5, 1.5])[4]).toEqual(['R3']);
    expect(applyRules([1.5, 1.5, 0, 0, 1.5])[4]).toEqual([]);
  });
  it('R4: 8 in a row on one side (7 is not enough, 0 breaks it)', () => {
    expect(applyRules(new Array(8).fill(0.1))[7]).toEqual(['R4']);
    expect(applyRules(new Array(7).fill(0.1)).every((f) => f.length === 0)).toBe(true);
    expect(applyRules([0.1, 0.1, 0.1, 0, 0.1, 0.1, 0.1, 0.1])[7]).toEqual([]);
  });
});

describe('controlChart', () => {
  const sub = [10, 12, 11, 13].map((m, i) => ({ n: 5, mean: m, sd: 1, label: `d${i}` }));

  it('null with fewer than 3 usable subgroups', () => {
    expect(controlChart(sub.slice(0, 2), 'mr', false)).toBeNull();
    expect(controlChart([...sub.slice(0, 2), { n: 0, mean: null }], 'mr', false)).toBeNull();
  });

  it('MR method: CL = mean of means, σ = MR̄ / 1.128', () => {
    // CL = 46/4 = 11.5 ; MR = 2,1,2 → MR̄ 5/3 ; σ = 1.47754
    const c = controlChart(sub, 'mr', false);
    const sig = 5 / 3 / 1.128;
    expect(c.cl).toBe(11.5);
    expect(c.mrBar).toBeCloseTo(5 / 3, 12);
    expect(c.rows[0].ucl).toBeCloseTo(11.5 + 3 * sig, 9);
    expect(c.rows[0].lcl).toBeCloseTo(11.5 - 3 * sig, 9);
    expect(c.rows[0].z).toBeCloseTo((10 - 11.5) / sig, 9);
    expect(c.disp.map((d) => d.v)).toEqual([2, 1, 2]);
    expect(c.disp[0].ucl).toBeCloseTo(3.267 * (5 / 3), 9);
    expect(c.excluded).toBe(0);
  });

  it('sigma method: n-weighted CL, pooled σ / √n, S chart with c4', () => {
    const s = [{ n: 4, mean: 10, sd: 2, label: 'a' }, { n: 4, mean: 12, sd: 2, label: 'b' }, { n: 2, mean: 11, sd: 4, label: 'c' }];
    // CL = (40 + 48 + 22) / 10 = 11 ; pooled = √((3·4 + 3·4 + 1·16) / 7) = √(40/7)
    const sp = Math.sqrt(40 / 7);
    const c = controlChart(s, 'sigma', false);
    expect(c.cl).toBeCloseTo(11, 12);
    expect(c.pooled).toBeCloseTo(sp, 12);
    expect(c.rows[0].sigma).toBeCloseTo(sp / 2, 12);
    expect(c.rows[2].sigma).toBeCloseTo(sp / Math.SQRT2, 12);
    expect(c.rows[0].ucl).toBeCloseTo(11 + (3 * sp) / 2, 9);
    const c4n4 = (2 * Math.sqrt(2 / 3)) / Math.sqrt(Math.PI);
    expect(c.disp[0].cl).toBeCloseTo(c4n4 * sp, 9);
    expect(c.disp[0].ucl).toBeCloseTo(sp * (c4n4 + 3 * Math.sqrt(1 - c4n4 ** 2)), 9);
    expect(c.disp[0].lcl).toBe(0);   // c4 − 3√(1−c4²) < 0 for n = 4
  });

  it('phase 1 removes the special-cause point from the limits', () => {
    const means = [10, 10.2, 9.8, 10.1, 9.9, 10, 10.1, 9.9, 10, 30];
    const pts = means.map((m, i) => ({ n: 5, mean: m, sd: 1, label: String(i) }));
    const raw = controlChart(pts, 'mr', false);
    expect(raw.cl).toBeCloseTo(12, 9);                 // 120 / 10
    const p1 = controlChart(pts, 'mr', true);
    expect(p1.excluded).toBe(1);
    expect(p1.rows[9].excluded).toBe(true);
    expect(p1.cl).toBeCloseTo(10, 9);                  // 90 / 9
    expect(p1.mrBar).toBeCloseTo(1.6 / 8, 9);          // .2 .4 .3 .2 .1 .1 .2 .1
    expect(p1.rows[9].rules).toContain('R1');
    expect(p1.signals).toBe(1);
  });
});

describe('capability / histogram / hourPattern', () => {
  it('capability against an upper limit', () => {
    const c = capability([10, 12, 14], 13);
    expect(c.mean).toBe(12);
    expect(c.sd).toBe(2);
    expect(c.cpk).toBeCloseTo(1 / 6, 12);
    expect(c.within).toBeCloseTo(200 / 3, 12);
    expect(capability([10, 12, 14], null)).toEqual({ n: 3, mean: 12, sd: 2, cpk: null, within: null });
    expect(capability([], 13)).toEqual({ n: 0, mean: null, sd: null, cpk: null, within: null });
  });

  it('histogram bins, inside / outside the window', () => {
    expect(histogram([], { lo: 0, hi: 10 }, 3600)).toBeNull();
    // P99 of 5,10,15,200 = 15 + 0.97·185 = 194.45 → top 204.17 → width ⌈5.10⌉ = 6, 36 bins
    const h = histogram([5, 10, 15, 200], { lo: 6, hi: 20 }, 3600);
    expect(h.width).toBe(6);
    expect(h.bins).toHaveLength(36);
    expect([h.bins[0].outside, h.bins[1].inside, h.bins[2].inside, h.bins[33].outside]).toEqual([1, 1, 1, 1]);
    expect(h.bins.reduce((s, b) => s + b.inside + b.outside, 0)).toBe(4);
    expect(h.beyond).toBe(0);
    expect(h.labelFor(13)).toBe('12');
  });
  it('histogram is capped; gaps above the cap are counted as beyond', () => {
    const h = histogram([5, 5000], { lo: 0, hi: Infinity }, 100);
    expect(h.width).toBe(3);                        // ⌈100 / 40⌉
    expect(h.bins).toHaveLength(35);                // ⌈100 / 3⌉ + 1
    expect(h.beyond).toBe(1);
    expect(h.bins[1].inside).toBe(1);
  });

  it('hourPattern groups values by hour', () => {
    const p = hourPattern([10, 20, 30, 40], [9, 9, 14, 9]);
    expect(p.map((x) => [x.hour, x.label, x.n])).toEqual([[9, '09-10', 3], [14, '14-15', 1]]);
    expect(p[0].mean).toBeCloseTo(70 / 3, 12);
    expect(p[0].sd).toBeCloseTo(Math.sqrt(700 / 3), 9);   // Σd² = 1400/3, ÷ 2
    expect(p[1].sd).toBeNull();
  });
});

describe('secondCounts (bin s = (s−1, s])', () => {
  const days = { d1: { g: [0, 0.4, 1, 1.2, 5, 22, 22.5, 30], h: [9, 9, 9, 9, 10, 10, 11, 11], o: 2 } };
  const sc = secondCounts(days, { lo: 1, hi: 20 }, 22);

  it('bins and the overflow bin', () => {
    expect(sc.top).toBe(22);
    expect(sc.OVER).toBe(23);
    expect(sc.bins).toHaveLength(24);
    expect(sc.bins[23].label).toBe('>22s');
    expect(sc.bins[0].count).toBe(1);                         // 0
    expect([sc.bins[1].count, sc.bins[1].valid, sc.bins[1].removed]).toEqual([2, 1, 1]);   // 0.4 (below Min), 1
    expect(sc.bins[1].sum).toBeCloseTo(1.4, 12);
    expect([sc.bins[1].minV, sc.bins[1].maxV]).toEqual([0.4, 1]);
    expect(sc.bins[2].valid).toBe(1);                         // 1.2
    expect(sc.bins[22].removed).toBe(1);                      // 22 ≤ Max but above the window
    expect([sc.bins[23].count, sc.bins[23].above, sc.bins[23].cap]).toEqual([4, 4, 2]);   // 22.5, 30 + 2 capped
    expect(sc.bins[23].hours).toEqual({ 11: 2 });
    expect(sc.bins[23].days).toEqual({ d1: 4 });
  });
  it('totals add up', () => {
    expect(sc.total).toBe(10);
    expect(sc.valid + sc.removed + sc.above).toBe(sc.total);
    expect([sc.valid, sc.removed, sc.above]).toEqual([3, 3, 4]);
  });
  it('fractional Max', () => {
    const s = secondCounts({ d: { g: [22.3, 22.7], h: [9, 9] } }, { lo: 0, hi: 99 }, 22.5);
    expect(s.top).toBe(23);
    expect(s.bins[23].count).toBe(1);
    expect(s.bins[24].count).toBe(1);
  });
  it('empty input', () => {
    const s = secondCounts({}, { lo: 1, hi: 20 }, 20);
    expect([s.total, s.valid, s.removed, s.above]).toEqual([0, 0, 0, 0]);
  });
});

describe('lossAnalysis (cycle loss vs target)', () => {
  const days = {
    '2026-10-02': { g: [10, 12, 8, 30], h: [9, 9, 10, 10], o: 1 },
    '2026-10-01': { g: [15, 5], h: [14, 14], o: 0 },
  };
  const win = { lo: 6, hi: 20 };

  it('valid basis: only gaps inside the window', () => {
    // included 15, 10, 12, 8 ; slow: 15 (+5), 12 (+2) ; fast: 10 (gain 0), 8 (gain 2)
    const L = lossAnalysis(days, win, 20, 10, 'valid');
    expect([L.n, L.time, L.slowN, L.slowSum, L.loss, L.fastN, L.gain, L.capN]).toEqual([4, 45, 2, 27, 7, 2, 2, 0]);
    expect(L.lostPcs).toBeCloseTo(0.7, 12);
    expect(L.pctTime).toBeCloseTo((7 / 45) * 100, 12);
    expect(L.avgExtra).toBe(3.5);
    expect(L.avgSlow).toBe(13.5);
    expect(L.avgActual).toBe(11.25);
    expect(L.allLoss).toBe(7);
    expect(L.bins[15].share).toBeCloseTo((5 / 7) * 100, 12);
    expect(L.bins[12].cum).toBeCloseTo((2 / 7) * 100, 12);
    expect(L.bins[15].cum).toBeCloseTo(100, 12);
    expect(L.days).toEqual([
      { date: '2026-10-01', n: 1, time: 15, slowN: 1, loss: 5 },
      { date: '2026-10-02', n: 3, time: 30, slowN: 1, loss: 2 },
    ]);
    expect(L.hours).toEqual([
      { hour: 9, n: 2, time: 22, slowN: 1, loss: 2 },
      { hour: 10, n: 1, time: 8, slowN: 0, loss: 0 },
      { hour: 14, n: 1, time: 15, slowN: 1, loss: 5 },
    ]);
    expect(L.samples).toEqual([{ d: '2026-10-01', h: 14, v: 15, extra: 5 }, { d: '2026-10-02', h: 9, v: 12, extra: 2 }]);
  });
  it('upto basis adds the gaps below Min', () => {
    const L = lossAnalysis(days, win, 20, 10, 'upto');
    expect([L.n, L.time, L.loss, L.fastN, L.gain]).toEqual([5, 50, 7, 3, 7]);
  });
  it('all basis adds gaps above Max (overflow bin) and the capped count', () => {
    const L = lossAnalysis(days, win, 20, 10, 'all');
    expect([L.n, L.time, L.loss, L.capN]).toEqual([6, 80, 27, 1]);
    expect(L.bins[L.OVER].loss).toBe(20);
  });
  it('onlyBin restricts totals but keeps the full bins', () => {
    const L = lossAnalysis(days, win, 20, 10, 'valid', 15);
    expect([L.n, L.time, L.loss, L.slowN]).toEqual([1, 15, 5, 1]);
    expect(L.bins[12].loss).toBe(2);
    expect(L.allLoss).toBe(7);
  });
  it('no target: nothing is slow or fast', () => {
    const L = lossAnalysis(days, win, 20, 0, 'valid');
    expect([L.n, L.loss, L.slowN, L.fastN, L.gain, L.lostPcs]).toEqual([4, 0, 0, 0, 0, 0]);
    expect(L.avgSlow).toBeNull();
  });
  it('empty data', () => {
    const L = lossAnalysis({}, win, 20, 10);
    expect([L.n, L.avgActual, L.pctTime, L.loss]).toEqual([0, null, 0, 0]);
  });
});
