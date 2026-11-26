// 26-11-2026: Availability dashboard / Performance dashboard figures (src/utils/factorDash.js)
import { describe, it, expect } from 'vitest';
import { availDash, perfDash } from '../src/utils/factorDash';
import { oleSum, setOleConfig, OLE_CFG_DEFAULT } from '../src/utils/ole';

setOleConfig({ ...OLE_CFG_DEFAULT });
// one hour of a line: 60 min planned, `idle` lost, `qty` pieces of one model with a std cycle
const hour = (hour, { idle = 0, qty = 0, std = 20, model = 'WT70', plan = 0, losses = [] } = {}) => ({
  hour, plannedMin: 60, lossMin: idle, actualMin: 60 - idle, totalMin: 60, stopMin: 0, qty, stdSec: qty * std, noStdQty: 0, planQty: plan,
  speedMin: Math.max(0, 60 - idle - (qty * std) / 60), models: qty ? [{ model, quantity: qty, std }] : [],
  e: { stops: [], losses, rejects: [], rework: [] },
});
const day = (date, lines) => ({ date, byLine: Object.fromEntries(Object.entries(lines).map(([l, rows]) => [l, { rows, total: oleSum(rows) }])) });
const R = { days: [
  day('2026-11-24', { 1: [hour(9, { idle: 30, qty: 90, plan: 90, losses: [{ reason: 'Motor shortage', dept: 'Stores', model: 'WT70', min: 30 }] }), hour(10, { qty: 150, plan: 180 })],
    2: [hour(9, { qty: 180, plan: 180 }), hour(10, { idle: 10, qty: 100, plan: 150, losses: [{ reason: 'Model change', dept: 'Prod', min: 10 }] })] }),
  day('2026-11-25', { 1: [hour(9, { qty: 180, plan: 180 })], 2: [] }),
] };

describe('availability dashboard', () => {
  const A = availDash(R, ['1', '2']);
  it('totals: planned, run, idle, A, stops, average stop', () => {
    expect([A.total.planned, A.total.idle, A.total.run]).toEqual([300, 40, 260]);
    expect(A.total.A).toBeCloseTo(260 / 300, 6);
    expect([A.total.stops, A.total.written, A.total.avg, A.total.notWritten]).toEqual([2, 40, 20, 0]);
  });
  it('reasons and departments most minutes first, with the model they were written on', () => {
    expect(A.reasons.map((r) => [r.name, r.min, r.lines])).toEqual([['Motor shortage', 30, ['1']], ['Model change', 10, ['2']]]);
    expect(A.reasons[0].models).toEqual([{ name: 'WT70', min: 30 }]);
    expect(A.depts.map((d) => [d.name, d.min, d.top])).toEqual([['Stores', 30, 'Motor shortage'], ['Prod', 10, 'Model change']]);
  });
  it('line by line, day by day and line × hour', () => {
    expect(A.lines.map((l) => [l.line, l.idle, l.stops, l.topReason])).toEqual([['1', 30, 1, 'Motor shortage'], ['2', 10, 1, 'Model change']]);
    expect(A.days.map((d) => d.date)).toEqual(['2026-11-24', '2026-11-25']);
    expect(A.days[1].by['2']).toBeNull();   // line 2 did not run on the 25th
    expect(A.heat.find((h) => h.line === '1').by).toEqual({ 9: 30 });
    expect(A.total.worstDay.date).toBe('2026-11-24');
  });
});

describe('performance dashboard', () => {
  const P = perfDash(R, ['1', '2']);
  it('totals: pieces against the plan target, std and actual cycle', () => {
    expect([P.total.qty, P.total.target, P.total.short]).toEqual([700, 780, -80]);
    expect(P.total.std).toBe(20);
    expect(P.total.act).toBeCloseTo((260 * 60) / 700, 6);
  });
  it('line by line with achievement; line × hour pieces against plan', () => {
    const l1 = P.lines.find((l) => l.line === '1');
    expect([l1.qty, l1.target]).toEqual([420, 450]);
    expect(P.heat.find((h) => h.line === '2').by[10]).toEqual({ qty: 100, plan: 150 });
  });
  it('models: slow ones by time lost', () => {
    // WT70 on both lines: line 1 = 420 pcs in 150 min (10 min over std), line 2 = 280 pcs in 110 min (16.7 min over)
    expect(P.models.map((m) => m.line).sort()).toEqual(['1', '2']);
    expect(P.slow.map((m) => [m.line, Math.round(m.lostMin * 10) / 10])).toEqual([['2', 16.7], ['1', 10]]);
    expect(P.total.slow).toBe(2);
    expect(P.lines.find((l) => l.line === '2').worst).toBe('WT70');
  });
});

describe('every date of a period', () => {
  it('both ends in, across a month end; nothing when the end is before the start', async () => {
    const { datesBetween } = await import('../src/utils/factorDash');
    expect(datesBetween('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
    expect(datesBetween('2026-11-01', '2026-11-30').length).toBe(30);
    expect(datesBetween('2026-11-05', '2026-11-04')).toEqual([]);
  });
});
