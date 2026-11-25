// Calculation tests for the Model analysis P-Q page (src/utils/modelReport.js).
import { describe, it, expect } from 'vitest';
import { buildModelRows, dailyByModel, explainModel, MODEL_COLUMNS, modelReportHtml } from '../src/utils/modelReport';
import { buildXlsx, STYLE, zebra } from '../src/utils/xlsxWriter';
import analytics from './fixtures/analytics.json';
import modelsMeta from './fixtures/models.json';

const sum = (a) => a.reduce((s, v) => s + v, 0);

// hand-made payload: 4 models, 2 days
const A = {
  startDate: '2026-10-01', endDate: '2026-10-02',
  overall: { n: 990, mean: 30, median: 29, p90: 40, cv: 20, stoppageSec: 1200 },
  models: [
    { mmId: 2, model: 'B', qty: 150, n: 148, mean: 33, median: 32, min: 20, max: 60, cv: 12, activeHours: 5, stoppageSec: 600, isLowVolume: false },
    { mmId: 1, model: 'A', qty: 700, n: 690, mean: 30, median: 29, min: 18, max: 55, cv: 8, activeHours: 14, stoppageSec: 0, isLowVolume: false },
    { mmId: 3, model: 'C', qty: 100, n: 99, mean: 40, median: 41, min: 25, max: 70, cv: 35, activeHours: 4, stoppageSec: 120, isLowVolume: false },
    { mmId: 4, model: 'D', qty: 50, n: 0, mean: null, median: null, min: null, max: null, cv: null, activeHours: 2, stoppageSec: 0, isLowVolume: true },
  ],
  daily: [{ date: '2026-10-01', qty: 600, mean: 29 }, { date: '2026-10-02', qty: 400, mean: 31 }],
  modelDay: { 1: { '2026-10-01': 400, '2026-10-02': 300 }, 2: { '2026-10-01': 150 }, 3: { '2026-10-02': 100 }, 4: { '2026-10-01': 50 } },
  rejection: { models: [{ mmId: 3, qty: 3, rate: 2.91 }] },
};
const takt = { taktSec: 32, models: { 3: 36 } };

describe('buildModelRows — P-Q numbers', () => {
  const { rows, totals } = buildModelRows(A, takt, [{ mmId: 1, companyTitle: 'SAMSUNG' }]);

  it('sorts by qty, ranks, shares sum to 100 and the last cumulative is 100', () => {
    expect(rows.map((r) => r.model)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(sum(rows.map((r) => r.share))).toBeCloseTo(100, 6);
    expect(rows[3].cumPct).toBeCloseTo(100, 6);
    expect(rows[0].share).toBeCloseTo(70, 6);
    expect(rows[1].cumPct).toBeCloseTo(85, 6);
  });
  it('ABC class uses the running share before the model (80 / 95 %)', () => {
    // A: before 0 → A · B: before 70 → A · C: before 85 → B · D: before 95 → C
    expect(rows.map((r) => r.cls)).toEqual(['A', 'A', 'B', 'C']);
    expect(totals.clsCount).toEqual({ A: 2, B: 1, C: 1 });
  });
  it('days made, peak day, pcs/hr, company', () => {
    expect(rows[0].days).toBe(2);
    expect(rows[0].peakDate).toBe('2026-10-01');
    expect(rows[0].peakQty).toBe(400);
    expect(rows[0].perHr).toBeCloseTo(50, 6);
    expect(rows[0].company).toBe('SAMSUNG');
    expect(rows[1].company).toBe('');
    expect(rows[1].trend).toEqual([150, 0]);
  });
  it('takt per model wins over line takt; vs takt in %', () => {
    expect(rows[0].takt).toBe(32);
    expect(rows[0].vsTakt).toBeCloseTo((30 / 32 - 1) * 100, 6);
    expect(rows[2].takt).toBe(36);
    expect(rows[2].vsTakt).toBeCloseTo((40 / 36 - 1) * 100, 6);
  });
  it('health: CV > 30 or vs takt > 10 % = attention; no cycles = idle', () => {
    expect(rows[0].health).toBe('ok');
    expect(rows[1].health).toBe('watch'); // 33 / 32 = +3 %
    expect(rows[2].health).toBe('behind'); // CV 35 %
    expect(rows[3].health).toBe('idle');
  });
  it('totals use the period figures of the API, rejections and gaps add up', () => {
    expect(totals.qty).toBe(1000);
    expect(totals.avgCycle).toBe(30);
    expect(totals.medianCycle).toBe(29);
    expect(totals.rejQty).toBe(3);
    expect(totals.rejRate).toBeCloseTo((3 / 1003) * 100, 6);
    expect(totals.stopMin).toBeCloseTo(20, 6);
    expect(totals.activeDays).toBe(2);
    expect(totals.perDay).toBeCloseTo(500, 6);
  });
  it('explanation mentions class, share, days, cycle and takt', () => {
    expect(rows[0].explain).toContain('A-class');
    expect(rows[0].explain).toContain('70.0%');
    expect(rows[0].explain).toContain('2 of 2 days');
    expect(rows[0].explain).toContain('faster than takt');
    expect(rows[2].explain).toContain('slower than takt');
    expect(rows[2].explain).toContain('rejected');
    expect(rows[3].explain).toContain('No valid cycle');
    expect(rows[3].explain).toContain('Low volume');
  });
  it('without overall figures the avg cycle is the n-weighted mean of the models', () => {
    const { totals: t } = buildModelRows({ ...A, overall: undefined }, takt);
    expect(t.avgCycle).toBeCloseTo((690 * 30 + 148 * 33 + 99 * 40) / (690 + 148 + 99), 6);
  });
  it('empty payload is safe', () => {
    expect(buildModelRows(null, takt).rows).toEqual([]);
    const e = buildModelRows({ models: [], daily: [], overall: {} }, takt);
    expect(e.totals.qty).toBe(0);
  });
});

describe('dailyByModel — stacked production', () => {
  const { rows } = buildModelRows(A, takt);
  it('top models + others add up to the day total', () => {
    const d = dailyByModel(A, rows, 2);
    for (const day of d) expect(day.m1 + day.m2 + day.others).toBe(day.total);
    expect(d[0].others).toBe(50);
    expect(d[1].others).toBe(100);
  });
});

describe('real fixture', () => {
  const { rows, totals } = buildModelRows(analytics, { taktSec: 0, models: {} }, modelsMeta);
  it('qty total equals the sum of the models and every model has an explanation', () => {
    expect(totals.qty).toBe(sum(analytics.models.map((m) => m.qty)));
    expect(rows.every((r) => r.explain.length > 20)).toBe(true);
    expect(rows.every((r) => r.takt == null && r.vsTakt == null)).toBe(true);
  });
});

describe('export', () => {
  const { rows, totals } = buildModelRows(A, takt);
  const meta = { lineLabel: 'Line 2', start: A.startDate, end: A.endDate, generatedAt: new Date(2026, 9, 24, 9, 5) };
  it('column getters work for every row', () => {
    for (const r of rows) for (const [, , get] of MODEL_COLUMNS) expect(() => get(r)).not.toThrow();
  });
  it('new xlsx styles exist and have a zebra variant', () => {
    expect(STYLE.wrap).toBeGreaterThan(16);
    expect(zebra('wrap')).toBe(STYLE.wrap + 1);
    expect(STYLE.totalInt).toBe(STYLE.wrap + 2);
    expect(zebra('int')).not.toBe(STYLE.int);
  });
  it('builds a workbook and a print page with line, period and date', () => {
    const bytes = buildXlsx([{ name: 'x', rows: [[{ v: 'a', s: 'wrap' }, { v: 1, s: 'totalInt' }]] }]);
    expect(bytes.length).toBeGreaterThan(500);
    const html = modelReportHtml(rows, totals, meta);
    expect(html).toContain('Line 2');
    expect(html).toContain('01-10-2026');
    expect(html).toContain('24-10-2026 09:05');
    expect(html).toContain('Explanation');
    expect((html.match(/<tr class="k/g) || []).length).toBe(4);
  });
});

// ── Health is judged against THIS line, not fixed textbook limits ────────────────────────────
// Real Line 2 (24-09 … 23-10-2026): every model's gap CV is ~50–60 % and rejections ~12 %, so the old
// fixed rule (CV > 30 % or Rej > 2 % = Attention) put 16 of 19 models in "Attention" — useless.
describe('health relative to the line (real Line 2 numbers)', () => {
  const real = {
    startDate: '2026-09-24', endDate: '2026-10-23',
    overall: { n: 49150, mean: 16.4, median: 15, p90: 29, cv: 58.8, stoppageSec: 2136843 },
    models: [
      { mmId: 589, model: '70DLIM 5', qty: 13026, n: 12044, mean: 15.3, median: 14, min: 2, max: 47, cv: 54.7, activeHours: 130, stoppageSec: 334155, isLowVolume: false },
      { mmId: 472, model: 'WTT90UDXGTD', qty: 6799, n: 6229, mean: 16.6, median: 15, min: 2, max: 49, cv: 52.7, activeHours: 97, stoppageSec: 261820, isLowVolume: false },
      { mmId: 692, model: 'ES-SD120NB-HS', qty: 484, n: 419, mean: 19.3, median: 15, min: 3, max: 288, cv: 104.8, activeHours: 15, stoppageSec: 68352, isLowVolume: false },
      { mmId: 420, model: '85DBLG/FLRB5', qty: 642, n: 572, mean: 15.9, median: 14, min: 3, max: 45, cv: 49.8, activeHours: 9, stoppageSec: 39778, isLowVolume: false },
      { mmId: 739, model: 'DX-14FGFL', qty: 371, n: 320, mean: 20.5, median: 17, min: 3, max: 146, cv: 81.3, activeHours: 11, stoppageSec: 38852, isLowVolume: false },
      { mmId: 620, model: 'KSAZ690PL-MW', qty: 3, n: 2, mean: 9.5, median: 9.5, min: 4, max: 15, cv: 81.9, activeHours: 1, stoppageSec: 0, isLowVolume: true },
    ],
    daily: [{ date: '2026-10-23', qty: 21325, mean: 16.4 }],
    modelDay: {},
    rejection: { models: [
      { mmId: 589, qty: 2034, rate: 13.51 }, { mmId: 472, qty: 1007, rate: 12.9 }, { mmId: 692, qty: 49, rate: 9.19 },
      { mmId: 420, qty: 190, rate: 22.84 }, { mmId: 739, qty: 33, rate: 8.17 }, { mmId: 620, qty: 4, rate: 57.14 },
    ] },
  };
  const noTakt = { taktSec: 0, models: {} };
  const { rows, totals } = buildModelRows(real, noTakt);
  const by = Object.fromEntries(rows.map((r) => [r.model, r]));

  it('line references come from the period', () => {
    expect(totals.lineCv).toBe(58.8);
    expect(totals.rejRate).toBeCloseTo((3317 / (21325 + 3317)) * 100, 6);
  });
  it('ordinary models of this line are Healthy (CV and rejections like the line)', () => {
    expect(by['70DLIM 5'].health).toBe('ok');
    expect(by['WTT90UDXGTD'].health).toBe('ok');
  });
  it('CV far above the line (≥ 1.5 × line CV) → Attention', () => {
    expect(by['ES-SD120NB-HS'].health).toBe('behind'); // 104.8 vs 58.8 × 1.5 = 88.2
  });
  it('CV a bit above the line (≥ 1.2 × line CV) → Watch', () => {
    expect(by['DX-14FGFL'].health).toBe('watch'); // 81.3 vs 70.6
  });
  it('rejections far above the line (≥ 1.5 × line rate) → Attention', () => {
    expect(by['85DBLG/FLRB5'].health).toBe('behind'); // 22.8 % vs 13.5 % × 1.5
  });
  it('a handful of rejections on a tiny model is not enough for Attention', () => {
    expect(by['KSAZ690PL-MW'].health).not.toBe('behind'); // 4 rejected, 2 cycles
  });
  it('the explanation compares with the line', () => {
    expect(by['70DLIM 5'].explain).toContain('like the line');
    expect(by['ES-SD120NB-HS'].explain).toContain('much more variable than the line');
    expect(by['85DBLG/FLRB5'].explain).toMatch(/line \d+\.\d%/);
  });
});

describe('long-gap time is easy to read', () => {
  it('under 2 h in minutes, from 2 h in hours', () => {
    const base = { rank: 1, cls: 'A', qty: 10, share: 10, days: 1, activeHours: 1, perHr: 10, mean: null, rejQty: 0 };
    expect(explainModel({ ...base, stopMin: 95 }, 1)).toContain('95 min lost in long gaps');
    expect(explainModel({ ...base, stopMin: 1873 }, 1)).toContain('31.2 h lost in long gaps');
  });
});

import { achievedByModel } from '../src/utils/modelReport';
describe('achievedByModel — achieved cycle, covered pieces and target per model', () => {
  const models = [
    { mmId: 7, days: { '2026-10-26': { g: [14, 14, 14, 13, 15, 15, 400] }, '2026-10-27': { g: [14, 12, 0.5] } } },
    { mmId: 8, days: { '2026-10-27': { g: [] } } },
  ];
  const r = achievedByModel(models);
  it('mode second, ≤ achieved pieces and share of valid cycles, target pcs/hr', () => {
    // valid: ≥ 1 s and ≤ 3 × median(14) = 42 s → 14,14,14,13,15,15,14,12 (400 s and 0.5 s left out)
    expect(r['7'].ach).toBe(14);
    expect(r['7'].achQty).toBe(6);            // 14 ×4, 13, 12
    expect(r['7'].achShare).toBeCloseTo(75, 6);
    expect(r['7'].achPph).toBeCloseTo(3600 / 14, 6);
  });
  it('model without gaps is left out', () => {
    expect(r['8']).toBe(undefined);
  });
});
