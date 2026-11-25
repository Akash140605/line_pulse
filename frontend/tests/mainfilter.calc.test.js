// Main view filters (src/utils/mainFilter.js): quick periods, company filter, company-wise summary.
import { describe, it, expect } from 'vitest';
import {
  addDays, quickPeriods, matchPeriod, periodText, companyOptions, filterLinesByCompany, filterHourly, companySummary, coKey,
} from '../src/utils/mainFilter';

const LINES = [
  {
    line: '2', name: 'Line 2', ok: true,
    daily: [{ d: '2026-10-25', q: 300, rej: 5 }, { d: '2026-10-26', q: 120, rej: 0 }],
    dailyCo: [
      { d: '2026-10-25', c: 'SAMSUNG', q: 200 }, { d: '2026-10-25', c: 'VOLTAS', q: 100 },
      { d: '2026-10-26', c: 'SAMSUNG', q: 120 },
    ],
    hourly: [{ h: 9, q: 70 }, { h: 10, q: 50 }],
    hourlyCo: [{ h: 9, c: 'SAMSUNG', q: 70 }, { h: 10, c: 'SAMSUNG', q: 50 }],
    models: [
      { mmId: 1, model: 'WT1', company: 'SAMSUNG ', qty: 320 },   // trailing space in the master data
      { mmId: 2, model: 'V1', company: 'VOLTAS', qty: 100 },
    ],
  },
  {
    line: '3', name: 'Line 3', ok: true,
    daily: [{ d: '2026-10-25', q: 50, rej: 0 }],
    dailyCo: [{ d: '2026-10-25', c: 'MIDEA', q: 30 }, { d: '2026-10-25', c: 'VOLTAS', q: 20 }],
    hourly: [], hourlyCo: [],
    models: [{ mmId: 7, model: 'M1', company: 'MIDEA', qty: 30 }, { mmId: 8, model: 'V9', company: 'VOLTAS', qty: 20 }],
  },
  { line: '1', name: 'Line 1', ok: false, error: 'offline', daily: [], dailyCo: [], hourly: [], hourlyCo: [], models: [] },
];

describe('quick periods (local calendar, no UTC shift)', () => {
  it('addDays crosses months and years', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-10-26', -6)).toBe('2026-10-20');
  });
  it('today, yesterday, 7 / 30 days, this month, last month', () => {
    const p = Object.fromEntries(quickPeriods('2026-10-26').map((x) => [x.key, [x.start, x.end]]));
    expect(p.today).toEqual(['2026-10-26', '2026-10-26']);
    expect(p.yesterday).toEqual(['2026-10-25', '2026-10-25']);
    expect(p['7d']).toEqual(['2026-10-20', '2026-10-26']);    // 7 days including today
    expect(p['30d']).toEqual(['2026-09-27', '2026-10-26']);
    expect(p.month).toEqual(['2026-10-01', '2026-10-26']);
    expect(p.lastMonth).toEqual(['2026-09-01', '2026-09-30']);
    expect(quickPeriods('2026-03-01').find((x) => x.key === 'lastMonth')).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
    expect(quickPeriods('2026-01-05').find((x) => x.key === 'lastMonth')).toMatchObject({ start: '2025-12-01', end: '2025-12-31' });
  });
  it('matching period and readable text', () => {
    expect(matchPeriod('2026-10-26', { start: '2026-10-25', end: '2026-10-25' }).key).toBe('yesterday');
    expect(matchPeriod('2026-10-26', { start: '2026-10-02', end: '2026-10-09' })).toBe(null);
    expect(periodText('2026-10-26', { start: '2026-10-25', end: '2026-10-25' })).toBe('Yesterday · 2026-10-25');
    expect(periodText('2026-10-26', { start: '2026-10-02', end: '2026-10-09' })).toBe('2026-10-02 → 2026-10-09');
  });
});

describe('company filter', () => {
  it('company names are one key (trimmed, empty → "(no company)")', () => {
    expect(coKey(' SAMSUNG ')).toBe('SAMSUNG');
    expect(coKey('')).toBe('(no company)');
    expect(coKey(null)).toBe('(no company)');
  });
  it('options: every company once, models and pieces over all lines', () => {
    const o = companyOptions(LINES);
    expect(o.map((x) => x.value)).toEqual(['SAMSUNG', 'VOLTAS', 'MIDEA']);
    expect(o[1]).toEqual({ value: 'VOLTAS', label: 'VOLTAS', count: 2, pcs: 120 });
  });
  it('no selection → lines unchanged', () => {
    expect(filterLinesByCompany(LINES, [])).toBe(LINES);
  });
  it('one company: daily, hourly and models of that company only; rejections kept per day', () => {
    const [l2, l3] = filterLinesByCompany(LINES, ['VOLTAS']);
    expect(l2.daily).toEqual([{ d: '2026-10-25', q: 100, rej: 5 }]);
    expect(l2.hourly).toEqual([]);
    expect(l2.models.map((m) => m.mmId)).toEqual([2]);
    expect(l3.daily).toEqual([{ d: '2026-10-25', q: 20, rej: 0 }]);
  });
  it('several companies at once (like Excel)', () => {
    const [l2, l3, l1] = filterLinesByCompany(LINES, ['SAMSUNG', 'VOLTAS']);
    expect(l2.daily.map((r) => r.q)).toEqual([300, 120]);           // = line total: both companies selected
    expect(l2.hourly).toEqual([{ h: 9, q: 70 }, { h: 10, q: 50 }]);
    expect(l2.models).toHaveLength(2);                                // "SAMSUNG " matches SAMSUNG
    expect(l3.daily.map((r) => r.q)).toEqual([20]);
    expect(l1.ok).toBe(false);                                        // offline line passes through
  });
  it('Σ of all companies = line total (nothing lost or doubled)', () => {
    const all = companyOptions(LINES).map((o) => o.value);
    const f = filterLinesByCompany(LINES, all);
    for (let i = 0; i < 2; i++) {
      expect(f[i].daily.map((r) => r.q)).toEqual(LINES[i].daily.map((r) => r.q));
      expect(f[i].hourly).toEqual(LINES[i].hourly);
    }
  });
  it('hourly of the selection', () => {
    expect(filterHourly(LINES[0].hourlyCo, ['SAMSUNG'])).toEqual([{ h: 9, q: 70 }, { h: 10, q: 50 }]);
    expect(filterHourly(LINES[0].hourlyCo, ['MIDEA'])).toEqual([]);
  });
});

describe('company-wise summary', () => {
  it('per company: total, per line, share, models, days (biggest first)', () => {
    const s = companySummary(LINES);
    expect(s.map((r) => r.company)).toEqual(['SAMSUNG', 'VOLTAS', 'MIDEA']);
    expect(s[0]).toMatchObject({ total: 320, lines: { 2: 320 }, models: 1, days: 2 });
    expect(s[1]).toMatchObject({ total: 120, lines: { 2: 100, 3: 20 }, models: 2, days: 1 });
    expect(s[0].share).toBeCloseTo(320 / 470 * 100, 6);
    expect(s.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100, 6);
  });
  it('with a selection only those companies (shares of the selection)', () => {
    const s = companySummary(LINES, ['VOLTAS', 'MIDEA']);
    expect(s.map((r) => r.company)).toEqual(['VOLTAS', 'MIDEA']);
    expect(s[0].share).toBeCloseTo(120 / 150 * 100, 6);
  });
});

import { modelOptions, filterLinesByModel } from '../src/utils/mainFilter';
describe('model filter', () => {
  const lines = [
    { line: '1', ok: true, mmCo: { 1: 'SAMSUNG', 2: 'MIDEA' }, models: [{ mmId: 1, model: 'A', company: 'SAMSUNG', qty: 30 }, { mmId: 2, model: 'B', company: 'MIDEA', qty: 5 }],
      daily: [{ d: '2026-10-01', q: 35, rej: 2 }], dhm: [['2026-10-01', 9, 1, 20], ['2026-10-01', 10, 1, 10], ['2026-10-01', 10, 2, 5]] },
    { line: '2', ok: true, mmCo: { 7: 'SAMSUNG' }, models: [{ mmId: 7, model: 'A', company: 'SAMSUNG', qty: 12 }], daily: [{ d: '2026-10-01', q: 12, rej: 0 }], dhm: [['2026-10-01', 9, 7, 12]] },
    { line: '4', ok: false, models: [] },
  ];
  it('one option per model name, narrowed by company', () => {
    expect(modelOptions(lines).map((o) => [o.value, o.count, o.pcs])).toEqual([['A', 2, 42], ['B', 1, 5]]);
    expect(modelOptions(lines, ['MIDEA']).map((o) => o.value)).toEqual(['B']);
  });
  it('rebuilds daily, hourly and the company split from dhm', () => {
    const f = filterLinesByModel(lines, ['A'], '2026-10-01');
    expect(f[0].daily).toEqual([{ d: '2026-10-01', q: 30, rej: 2 }]);
    expect(f[0].hourly).toEqual([{ h: 9, q: 20 }, { h: 10, q: 10 }]);
    expect(f[0].dailyCo).toEqual([{ d: '2026-10-01', c: 'SAMSUNG', q: 30 }]);
    expect(f[0].models.map((m) => m.mmId)).toEqual([1]);
    expect(f[1].daily[0].q).toBe(12);
    expect(f[2].ok).toBe(false);
    expect(filterLinesByModel(lines, [], '2026-10-01')).toBe(lines);
  });
});
