// Calculation tests for src/utils/stats.js (Pareto, I-MR SPC, Cpk, CV stability, moving average, histogram bins).
// Expected values are worked out by hand in the comments; fixtures are used as cross-checks.
import { describe, it, expect } from 'vitest';
import { pareto, spc, cpk, stabilityOf, movingAvg, buildBins, shareWithin } from '../src/utils/stats';
import analytics from './fixtures/analytics.json';
import range from './fixtures/range_overview.json';

describe('pareto', () => {
  const items = [{ name: 'C', value: 15 }, { name: 'A', value: 50 }, { name: 'D', value: 5 }, { name: 'B', value: 30 }];

  it('sorts high→low with share and cumulative %', () => {
    const p = pareto(items);
    expect(p.map((x) => x.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(p.map((x) => x.pct)).toEqual([50, 30, 15, 5]);
    expect(p.map((x) => x.cumPct)).toEqual([50, 80, 95, 100]);
  });

  it('ABC class from cumulative-before: <80 A, <95 B, else C', () => {
    // before = 0, 50, 80, 95  → A, A, B, C
    expect(pareto(items).map((x) => x.cls)).toEqual(['A', 'A', 'B', 'C']);
  });

  it('drops zero / negative values and handles an empty list', () => {
    const p = pareto([{ name: 'z', value: 0 }, { name: 'n', value: -3 }, { name: 'x', value: 10 }]);
    expect(p).toHaveLength(1);
    expect(p[0].pct).toBe(100);
    expect(p[0].cls).toBe('A');
    expect(pareto([])).toEqual([]);
  });

  it('groups the tail into "Others (n)"', () => {
    // 50,40 | 30+20+10 = 60 ; total 150 → cum 33.33, 60, 100
    const p = pareto([1, 2, 3, 4, 5].map((i) => ({ name: `m${i}`, value: i * 10 })), { top: 2 });
    expect(p).toHaveLength(3);
    expect(p[2].name).toBe('Others (3)');
    expect(p[2].value).toBe(60);
    expect(p[2].others).toBe(true);
    expect(p[0].cumPct).toBeCloseTo(100 / 3, 6);
    expect(p[1].cumPct).toBeCloseTo(60, 6);
    expect(p[2].cumPct).toBeCloseTo(100, 6);
  });

  it('custom value / name keys', () => {
    const p = pareto([{ model: 'X', qty: 1 }, { model: 'Y', qty: 3 }], { valueKey: 'qty', nameKey: 'model' });
    expect(p.map((x) => [x.name, x.value])).toEqual([['Y', 3], ['X', 1]]);
  });

  it('fixture: model quantities 2207 / 1642 / 339 of 4188', () => {
    const p = pareto(analytics.models.map((m) => ({ id: m.mmId, name: m.model, value: m.qty })));
    expect(p.map((x) => x.value)).toEqual([2207, 1642, 339]);
    expect(p[0].pct).toBeCloseTo((2207 / 4188) * 100, 6);           // 52.70 %
    expect(p[1].cumPct).toBeCloseTo((3849 / 4188) * 100, 6);        // 91.91 %
    expect(p[2].cumPct).toBeCloseTo(100, 9);
    expect(p.map((x) => x.cls)).toEqual(['A', 'A', 'B']);           // before = 0, 52.7, 91.9
  });
});

describe('spc (I-MR individuals chart)', () => {
  it('returns null with fewer than 3 values', () => {
    expect(spc([])).toBeNull();
    expect(spc([1, 2])).toBeNull();
    expect(spc([1, null, 2])).toBeNull();
  });

  it('CL = mean, σ = MR̄ / 1.128, limits = CL ± 3σ', () => {
    // 10,12,11,13,9 → mean 11 ; MR = 2,1,2,4 → MR̄ 2.25 ; σ = 2.25/1.128 = 1.99468
    const s = spc([10, 12, 11, 13, 9]);
    const sigma = 2.25 / 1.128;
    expect(s.mean).toBe(11);
    expect(s.sigma).toBeCloseTo(sigma, 9);
    expect(s.ucl).toBeCloseTo(11 + 3 * sigma, 9);   // 16.98404
    expect(s.lcl).toBeCloseTo(11 - 3 * sigma, 9);   // 5.01596
    expect(s.outCount).toBe(0);
  });

  it('nulls are gaps: skipped for the mean and the moving range', () => {
    // valid 10,14,12 → mean 12 ; MR = |14-10|, |12-14| = 4,2 → MR̄ 3
    const s = spc([10, null, 14, 12]);
    expect(s.mean).toBe(12);
    expect(s.sigma).toBeCloseTo(3 / 1.128, 9);
    expect(s.points[1]).toEqual({ i: 1, v: null, out: false, run: false });
  });

  it('non-numeric / NaN values are treated as gaps, never as NaN limits (bug fix)', () => {
    for (const bad of ['abc', NaN, undefined, '']) {
      const s = spc([10, bad, 14, 12]);
      expect(s.mean).toBe(12);
      expect(Number.isFinite(s.ucl)).toBe(true);
      expect(s.points[1].v).toBeNull();
    }
    expect(spc(['10', '14', '12']).mean).toBe(12);   // numeric strings are numbers
  });

  it('LCL never below 0', () => {
    // 1,10,1,10,1 → mean 4.6, MR̄ 9, σ 7.98 → 4.6 − 23.9 < 0
    expect(spc([1, 10, 1, 10, 1]).lcl).toBe(0);
  });

  it('flags a point beyond the limits', () => {
    // ten 10s and a 40: MR̄ = 30/10 = 3, σ = 2.6596, mean = 140/11 = 12.73, UCL = 20.71
    const s = spc([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 40]);
    expect(s.ucl).toBeCloseTo(140 / 11 + 3 * (3 / 1.128), 9);
    expect(s.points[10].out).toBe(true);
    expect(s.outCount).toBe(1);
  });

  it('run rule: 7 in a row on one side flags the whole run; 6 does not', () => {
    // mean = (3·1 + 9·9)/12 = 7 ; indices 5..11 above → 7 points
    const s7 = spc([1, 9, 1, 9, 1, 9, 9, 9, 9, 9, 9, 9]);
    expect(s7.points.map((p) => p.run)).toEqual([false, false, false, false, false, true, true, true, true, true, true, true]);
    expect(s7.runCount).toBe(7);
    // mean = 76/12 = 6.33 ; indices 5..10 above → only 6 points
    const s6 = spc([1, 9, 1, 9, 1, 9, 9, 9, 9, 9, 9, 1]);
    expect(s6.runCount).toBe(0);
  });

  it('fixture: daily average cycle 48.5, 48.2, 49.2, 48, 48.1', () => {
    // mean 242/5 = 48.4 ; MR = .3, 1, 1.2, .1 → MR̄ 0.65
    const s = spc(range.daily.days.map((d) => d.avgActualCycleSeconds));
    expect(s.mean).toBeCloseTo(48.4, 9);
    expect(s.sigma).toBeCloseTo(0.65 / 1.128, 9);
    expect(s.outCount).toBe(0);
  });
});

describe('cpk / stabilityOf', () => {
  it('Cpk = (USL − mean) / 3σ', () => {
    expect(cpk(40, 5, 55)).toBe(1);
    expect(cpk(50, 5, 40)).toBeCloseTo(-10 / 15, 9);
  });
  it('Cpk is null without a limit, without spread or without a mean', () => {
    expect(cpk(40, 0, 55)).toBeNull();
    expect(cpk(40, 5, 0)).toBeNull();
    expect(cpk(40, 5, null)).toBeNull();
    expect(cpk(null, 5, 55)).toBeNull();
  });
  it('CV bands: <15 ok, <30 watch, ≥30 behind, null idle', () => {
    expect([0, 14.99, 15, 29.99, 30, 80].map(stabilityOf)).toEqual(['ok', 'ok', 'watch', 'watch', 'behind', 'behind']);
    expect(stabilityOf(null)).toBe('idle');
    expect(stabilityOf(undefined)).toBe('idle');
  });
});

describe('movingAvg', () => {
  it('trailing k-point mean, null until the first full window', () => {
    expect(movingAvg([10, 20, 30, 40], 3)).toEqual([null, null, 20, 30]);
  });
  it('ignores nulls inside the window', () => {
    // i2: (10+30)/2 = 20 ; i3: (30+40)/2 = 35
    expect(movingAvg([10, null, 30, 40], 3)).toEqual([null, null, 20, 35]);
  });
  it('a window with no values gives null, not 0 (bug fix)', () => {
    expect(movingAvg([null, null, null, 40], 3)).toEqual([null, null, null, 40]);
  });
  it('k = 1 is the identity, empty input gives empty output', () => {
    expect(movingAvg([5, null, 7], 1)).toEqual([5, null, 7]);
    expect(movingAvg([], 3)).toEqual([]);
  });
});

describe('buildBins / shareWithin', () => {
  it('bin ranges, labels (last = overflow) and %', () => {
    const b = buildBins([2, 6, 2], 5);
    expect(b.map((x) => x.label)).toEqual(['0-5', '5-10', '≥10']);
    expect(b.map((x) => [x.from, x.to])).toEqual([[0, 5], [5, 10], [10, 15]]);
    expect(b.map((x) => x.pct)).toEqual([20, 60, 20]);
  });
  it('width 1 labels, single bin, all-zero counts', () => {
    expect(buildBins([1, 1, 1], 1).map((x) => x.label)).toEqual(['0', '1', '≥2']);
    expect(buildBins([4], 5).map((x) => x.label)).toEqual(['0-5']);
    expect(buildBins([0, 0], 5).map((x) => x.pct)).toEqual([0, 0]);
  });
  it('share of cycles ≤ limit, interpolated in the bin holding the limit', () => {
    expect(shareWithin([2, 6, 2], 5, 10)).toBe(80);          // 2 + 6 of 10
    expect(shareWithin([2, 6, 2], 5, 7.5)).toBe(50);         // 2 + 6·0.5
    expect(shareWithin([2, 6, 2], 5, 2.5)).toBe(10);         // 2·0.5
  });
  it('null without data or without a positive limit', () => {
    expect(shareWithin([], 5, 10)).toBeNull();
    expect(shareWithin([0, 0], 5, 10)).toBeNull();
    expect(shareWithin([2, 6], 5, 0)).toBeNull();
    expect(shareWithin([2, 6], 5, null)).toBeNull();
  });
  it('fixture: overall histogram, cycles ≤ 50 s', () => {
    const h = analytics.overall.histogram;
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(analytics.overall.n);   // 4020
    // bins 30-35 … 45-50 = 629 + 633 + 609 + 553 = 2424
    expect(shareWithin(h.counts, h.width, 50)).toBeCloseTo((2424 / 4020) * 100, 9);
  });
});

// Main view: four lines stacked reach 7,400 a day — a fixed 200 step gave 37 overlapping labels on a phone
import { axisTicks as axisTicksMax } from '../src/utils/axisTicks';
describe('axisTicks maxTicks', () => {
  it('keeps at most maxTicks labels by widening the step', () => {
    const a = axisTicksMax(7400, 1000, 200, null, { fromZero: true, maxTicks: 8 });
    expect(a.ticks.length).toBeLessThanOrEqual(8);
    expect(a.ticks[0]).toBe(0);
    expect(a.ticks[a.ticks.length - 1]).toBeGreaterThanOrEqual(7400);
  });
  it('small values are unchanged', () => {
    expect(axisTicksMax(450, 100, 20, null, { fromZero: true, maxTicks: 30 }).ticks).toEqual(axisTicksMax(450, 100, 20, null, { fromZero: true }).ticks);
  });
});
