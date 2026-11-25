// Quality dashboard (src/utils/qualityDash.js): made vs rework, rate, PPM, FPY, line / trend / defects / models / category / heat, Excel.
import { describe, it, expect } from 'vitest';
import { qualityDash, qualitySheets, pct, ppm } from '../src/utils/qualityDash';
import { reworkSheet } from '../src/utils/reworkReport';

import { buildXlsx } from '../src/utils/xlsxWriter';

const ST = [{ reason: 'Functional', code: 'FUN' }, { reason: 'Leakage Inspection', code: 'LKG' }];
const E = (rework = [], rejects = []) => ({ stops: [], losses: [], rejects, rework, note: '' });
const entries = {
  '2026-11-24|1|10': E([{ station: 'Functional', model: 'A', reason: 'Noise', cat: 'Process', qty: 2 }]),
  '2026-11-24|1|11': E([{ station: 'Leakage Inspection', model: 'A', reason: 'Leak', cat: 'Part', qty: 1, dismantle: 1 }]),
  '2026-11-25|2|10': E([], [{ station: 'Functional', model: 'B', reason: 'Noise', cat: 'Kitting Store', qty: 3 }]),
};
const row = (hour, qty, model, key) => ({ hour, qty, models: [{ model, quantity: qty }], entry: entries[key] || E() });
const days = [
  { date: '2026-11-24', byLine: { 1: { rows: [row(10, 100, 'A', '2026-11-24|1|10'), row(11, 100, 'A', '2026-11-24|1|11')] }, 2: { rows: [row(10, 50, 'B')] } } },
  { date: '2026-11-25', byLine: { 1: { rows: [row(10, 100, 'A')] }, 2: { rows: [row(10, 150, 'B', '2026-11-25|2|10')] } } },
];
const sheet = reworkSheet({ entries, start: '2026-11-24', end: '2026-11-25', ids: ['1', '2'], stations: ST }).rows;
const Q = qualityDash({ days, ids: ['1', '2'], stations: ST, sheet, rca: {} });

describe('quality dashboard', () => {
  it('totals: made, rework (old rejection counted), %, PPM, dismantled, RCA pending', () => {
    const t = Q.total;
    expect([t.made, t.bad, t.dismantle, t.defects]).toEqual([500, 6, 1, 2]);
    expect(t.pct).toBeCloseTo(1.2);
    expect(t.ppm).toBe(12000);
    expect(t.fpy).toBeCloseTo(0.988);
    expect(t.rcaOpen).toBe(3);   // Noise L1, Leak L1, Noise L2
  });
  it('per line', () => {
    const [a, b] = Q.lines;
    expect([a.line, a.made, a.bad, a.dismantle, a.top, a.rcaOpen]).toEqual(['1', 300, 3, 1, 'Noise', 2]);
    expect(b.pct).toBeCloseTo(1.5);
    expect(Q.worstLine.line).toBe('2');
  });
  it('trend: day by day, hour by hour for one day', () => {
    expect(Q.trend.map((d) => [d.label, d.made, d.bad])).toEqual([['24', 250, 3], ['25', 250, 3]]);
    const one = qualityDash({ days: [days[0]], ids: ['1', '2'], stations: ST, sheet, oneDay: true });
    expect(one.trend.map((d) => [d.label, d.made, d.bad])).toEqual([['10', 150, 2], ['11', 100, 1]]);
  });
  it('pareto, models, category, stations, heat', () => {
    expect(Q.defects.map((d) => [d.name, d.bad, Math.round(d.cum)])).toEqual([['Noise', 5, 83], ['Leak', 1, 100]]);
    expect(Q.models.find((m) => m.name === 'B')).toMatchObject({ made: 200, bad: 3, ppm: 15000, top: 'Noise' });
    expect(Q.cats.map((c) => c.name)).toEqual(['Kitting Store', 'Process', 'Part']);
    expect(Q.stations[0]).toMatchObject({ name: 'Functional', bad: 5 });
    expect(Q.hours).toEqual([10, 11]);
    expect(Q.heat.find((h) => h.line === '1').by).toEqual({ 10: 2, 11: 1 });
  });
  it('a line on its own; rework of other lines not counted', () => {
    const one = qualityDash({ days, ids: ['2'], stations: ST, sheet: sheet.filter((r) => r.line === '2') });
    expect([one.total.made, one.total.bad, one.total.rcaOpen]).toEqual([200, 3, 1]);
  });
  it('no pieces → no rate', () => { expect(pct(3, 0)).toBe(null); expect(ppm(0, 10)).toBe(0); });
  it('Excel: seven sheets that build', () => {
    const S = qualitySheets(Q, { period: '24-11-2026 – 25-11-2026' });
    expect(S.map((s) => s.name)).toEqual(['Summary', 'By line', 'Trend', 'Stations', 'Defects', 'Models', 'Category']);
    expect(S[1].rows[1][3].v).toBeCloseTo(0.01);
    expect(buildXlsx(S).length).toBeGreaterThan(1000);
  });
});
