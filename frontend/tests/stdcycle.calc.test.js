// Calculation tests for the Standard cycle time page: src/utils/stdCycle.js (Method A / Method B),
// src/utils/period.js (period start) and src/config/modelWeights.js (weight lookup).
import { describe, it, expect } from 'vitest';
import { windowStd, continuousRuns, runStd, kgOf } from '../src/utils/stdCycle';
import { periodStart, ymd } from '../src/utils/period';
import { weightInfo, weightOf, samsungSeriesKg } from '../src/config/modelWeights';

describe('Method A — windowStd', () => {
  const days = {
    '2026-10-02': { g: [0.5, 10, 12, 30], o: 2 },
    '2026-10-01': { g: [20, 22, 23] },
  };

  it('mean / median / sd / cv of the gaps inside [min, max] (bounds inclusive)', () => {
    // kept 20, 22 | 10, 12 → mean 16, median (12+20)/2 = 16, Σd² = 16+36+36+16 = 104 → sd √(104/3)
    const A = windowStd(days, { min: 1, max: 22 });
    const sd = Math.sqrt(104 / 3);
    expect(A.n).toBe(4);
    expect(A.mean).toBe(16);
    expect(A.median).toBe(16);
    expect(A.sd).toBeCloseTo(sd, 12);
    expect(A.cv).toBeCloseTo((sd / 16) * 100, 12);
    expect(A.below).toBe(1);                 // 0.5
    expect(A.above).toBe(4);                 // 23, 30 and 2 gaps above the data cap
    expect(A.daily).toEqual([{ date: '2026-10-01', n: 2, mean: 21 }, { date: '2026-10-02', n: 2, mean: 11 }]);
  });

  it('defaults are 1 … 22 s', () => {
    const A = windowStd(days);
    expect([A.min, A.max, A.n]).toEqual([1, 22, 4]);
  });

  it('all gaps outside the window → n 0, null statistics', () => {
    const A = windowStd({ d: { g: [50, 60] } }, { min: 1, max: 22 });
    expect([A.n, A.mean, A.median, A.sd, A.cv, A.above]).toEqual([0, null, null, null, null, 2]);
    expect(A.daily).toEqual([]);
  });

  it('min > max keeps nothing', () => {
    const A = windowStd(days, { min: 30, max: 10 });
    expect(A.n).toBe(0);
    expect(A.mean).toBeNull();
    expect(A.below + A.above).toBe(7 + 2);   // every gap is counted once, plus the capped ones
  });

  it('single value: mean = value, sd and cv null', () => {
    const A = windowStd({ d: { g: [12] } });
    expect([A.n, A.mean, A.median, A.sd, A.cv]).toEqual([1, 12, 12, null, null]);
  });

  it('empty / missing input', () => {
    expect(windowStd({}).n).toBe(0);
    expect(windowStd(undefined).n).toBe(0);
    expect(windowStd({ d: {} }).n).toBe(0);
  });
});

describe('Method B — continuousRuns / runStd', () => {
  // [date, hour, gap, rework]
  const rows = [
    ['d1', 9, null, 0],   // run 1 starts (first piece of the day)
    ['d1', 9, 10, 0],     // clean 10
    ['d1', 9, 12, 1],     // rework inside this gap → counted in incl, not clean
    ['d1', 9, 11, 0],     // clean 11
    ['d1', 9, 400, 0],    // stop > 300 s → run 2 starts with this piece
    ['d1', 10, 9, 0],     // clean 9
    ['d1', 10, 30, 0],    // above max 22 → incl only
    ['d1', 10, 8, 5],     // 5 rework > 3 → run 3 starts with this piece
    ['d1', 10, 10, 0],    // clean 10
    ['d2', 9, 10, 0],     // new day → run 4 (a run never spans two days)
  ];
  const opts = { minPieces: 3, maxRework: 3, breakSec: 300, minGap: 1, maxGap: 22 };
  const runs = continuousRuns(rows, opts);

  it('splits runs at the first piece, stops, too much rework and day changes', () => {
    expect(runs.map((r) => [r.date, r.startHour, r.pieces, r.valid])).toEqual([
      ['d1', 9, 4, true], ['d1', 9, 3, true], ['d1', 10, 2, false], ['d2', 9, 1, false],
    ]);
  });

  it('clean = gaps without rework inside [min, max]; incl = every gap of the run', () => {
    expect(runs[0]).toEqual({
      date: 'd1', startHour: 9, pieces: 4, rework: 1, valid: true,
      clean: 10.5, incl: 11, cleanGaps: 2, cleanSpan: 21, allGaps: 3, allSpan: 33,
    });
    expect([runs[1].clean, runs[1].incl, runs[1].rework]).toEqual([9, 19.5, 0]);
    // the rework that broke the run (5 pcs) is not counted in the new run
    expect([runs[2].clean, runs[2].rework, runs[2].allGaps]).toEqual([10, 0, 1]);
    expect([runs[3].clean, runs[3].incl]).toEqual([null, null]);
  });

  it('runStd pools the valid runs only', () => {
    // clean (21 + 9) / (2 + 1) = 10 ; incl (33 + 39) / (3 + 2) = 14.4 ; median of 10.5, 9 = 9.75
    expect(runStd(runs)).toEqual({ totalRuns: 4, validRuns: 2, pieces: 7, rework: 1, clean: 10, incl: 14.4, medianRun: 9.75 });
  });

  it('rework on the first gap of a run / on a stop is not counted', () => {
    const r = continuousRuns([['d', 9, null, 2], ['d', 9, 500, 2], ['d', 9, 10, 0]], { ...opts, minPieces: 1 });
    expect(r.map((x) => [x.pieces, x.rework, x.cleanGaps])).toEqual([[1, 0, 0], [2, 0, 1]]);
  });

  it('rework exactly at the limit keeps the run going', () => {
    const r = continuousRuns([['d', 9, null, 0], ['d', 9, 10, 3], ['d', 9, 10, 0]], { ...opts, minPieces: 1 });
    expect(r).toHaveLength(1);
    expect([r[0].rework, r[0].cleanGaps, r[0].allGaps]).toEqual([3, 1, 2]);
  });

  it('a gap equal to breakSec does not break the run', () => {
    const r = continuousRuns([['d', 9, null, 0], ['d', 9, 300, 0]], { ...opts, minPieces: 1 });
    expect(r).toHaveLength(1);
  });

  it('numbers sent as strings are handled as numbers (bug fix: no string concatenation)', () => {
    const r = continuousRuns([['d', 9, null, '0'], ['d', 9, '10', '0'], ['d', 9, '12', '0']], { ...opts, minPieces: 1 });
    expect(r).toHaveLength(1);
    expect([r[0].allSpan, r[0].cleanSpan, r[0].clean, r[0].incl, r[0].rework]).toEqual([22, 22, 11, 11, 0]);
  });

  it('default minPieces = 200 makes a short run invalid', () => {
    const r = continuousRuns([['d', 9, null, 0], ['d', 9, 10, 0]]);
    expect(r[0].valid).toBe(false);
    expect(runStd(r)).toEqual({ totalRuns: 1, validRuns: 0, pieces: 0, rework: 0, clean: null, incl: null, medianRun: null });
  });

  it('empty input', () => {
    expect(continuousRuns([])).toEqual([]);
    expect(runStd([])).toEqual({ totalRuns: 0, validRuns: 0, pieces: 0, rework: 0, clean: null, incl: null, medianRun: null });
  });
});

describe('kgOf', () => {
  it('reads "<number> kg" from names', () => {
    expect(kgOf('PLAIN 6.5KG')).toBe(6.5);
    expect(kgOf('Glagg 7 kg')).toBe(7);
    expect(kgOf('X 6,5 Kg')).toBe(6.5);
    expect(kgOf(null, 'ABC 8KG')).toBe(8);
    expect(kgOf('no weight')).toBeNull();
    expect(kgOf()).toBeNull();
  });
});

describe('periodStart (day after the same date N months earlier, clamped to month end)', () => {
  it('ordinary dates', () => {
    expect(periodStart('2026-10-23', 2)).toBe('2026-08-24');
    expect(periodStart('2026-10-23', 1)).toBe('2026-09-24');
    expect(periodStart('2026-01-15', 1)).toBe('2025-12-16');   // across the year end
  });
  it('month-end dates', () => {
    expect(periodStart('2026-03-31', 1)).toBe('2026-03-01');   // anchor 28 Feb
    expect(periodStart('2024-03-31', 1)).toBe('2024-03-01');   // leap year: anchor 29 Feb
    expect(periodStart('2026-05-31', 3)).toBe('2026-03-01');   // anchor 28 Feb
    expect(periodStart('2026-01-31', 1)).toBe('2026-01-01');   // anchor 31 Dec
    expect(periodStart('2026-12-31', 6)).toBe('2026-07-01');   // anchor 30 Jun
    expect(periodStart('2026-02-28', 1)).toBe('2026-01-29');
  });
  it('ymd formats a local date', () => {
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('weight lookup (modelWeights)', () => {
  it('manual override wins (numbers or numeric strings > 0)', () => {
    expect(weightInfo({ model: 'WT70C3000RR' }, 9)).toEqual({ kg: 9, source: 'manual', item: null });
    expect(weightInfo({ model: 'WT70C3000RR' }, '7.5').kg).toBe(7.5);
    for (const bad of ['', null, undefined, 0, -1, 'abc']) expect(weightInfo({ model: 'WT70C3000RR' }, bad).source).not.toBe('manual');
  });
  it('master list hit by model name', () => {
    expect(weightInfo({ model: 'WT70C3000RR' })).toEqual({ kg: 7, source: 'code', item: 'FA WM T1B1 SAMSUNG WT70C3000RR RED' });
    expect(weightOf({ model: 'AKSA-85DGBFG' })).toBe(8.5);
  });
  it('backslash names, WT prefix and model code in front', () => {
    expect(weightInfo({ model: 'WT11A4600LL\\TL' })).toEqual({ kg: 11.5, source: 'user', item: 'FA WM SAMSUNG T7B7 WT11A4600LL/TL BLUE' });
    expect(weightOf({ model: 'WT70M3000UU\\TL' })).toBe(7);                     // listed as "70M3000UU"
    expect(weightOf({ model: '1R82WT80F4560RD', modelCode: '1R82' })).toBe(8);
  });
  it('matching items with different weights → unknown (ask for a manual value)', () => {
    expect(weightInfo({ model: 'W5000' })).toEqual({ kg: null, source: null, item: null });
  });
  it('Samsung series rule and kg in the name as fallbacks', () => {
    expect(weightInfo({ model: 'WT85X9999ZZ' })).toEqual({ kg: 8.5, source: 'series', item: null });
    expect(weightInfo({ model: 'PLAIN 6.5KG' })).toEqual({ kg: 6.5, source: 'name', item: null });
    expect(weightOf({ model: 'ZZZ UNKNOWN' })).toBeNull();
    expect(weightOf(null)).toBeNull();
  });
  it('samsungSeriesKg', () => {
    expect(samsungSeriesKg('WT11A4600LL')).toBe(11.5);
    expect(samsungSeriesKg('WT10C4260GG')).toBe(10);
    expect(samsungSeriesKg('WT65R2200LL')).toBe(6.5);
    expect(samsungSeriesKg('wt70m3000uu')).toBe(7);
    expect(samsungSeriesKg('WT55X1')).toBeNull();    // 5.5 kg is outside 6–12
    expect(samsungSeriesKg('ABC')).toBeNull();
    expect(samsungSeriesKg(null)).toBeNull();
  });
});
