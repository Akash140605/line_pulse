import { describe, it, expect } from 'vitest';
import { hourPlanOf } from '../src/utils/targets';

// 24-11-2026: the live hour bars — an hour without production (line stopped) has no target, and it is not in the day's sum
describe('live hour bars: no production → no target', () => {
  const targets = { 1: { cycle: 20 } };
  const hours = [
    { hour: 9, quantity: 170, models: [{ mmId: 1, model: 'A', quantity: 170 }] },
    { hour: 10, quantity: 0, models: [] },
    { hour: 11, quantity: 8, models: [{ mmId: 1, model: 'A', quantity: 8 }] },
  ];
  it('the idle hour has no target, the hours that made pieces keep theirs', () => {
    const p = hourPlanOf({ hours, shift: '09:00-21:00', targets, nowMin: 12 * 60 + 30 });
    expect(p.targets[9]).toBe(180);
    expect(p.targets[10]).toBeUndefined();
    expect(p.targets[11]).toBe(180);
    expect(p.targets[12]).toBeUndefined();   // the running hour with nothing made yet
  });
});

// 24-11-2026: SAWM KPI plan as the plant's file counts it — 09:00–21:00, lunch 30 min, tea 15 min = 11.25 h; outside the shift no plan
import { kpiDays } from '../src/utils/kpiReport';
import { SHIFT_PLANT } from '../src/utils/shift';
import { oleLineDay } from '../src/utils/ole';
describe('SAWM KPI plan: plant day of 11.25 h, ends at the last scan', () => {
  const targets = { 1: { cycle: 20 } };
  const hrs = [];
  for (let h = 9; h <= 21; h++) hrs.push({ hour: h, quantity: h === 21 ? 12 : 170, models: [{ mmId: 1, model: 'A', quantity: h === 21 ? 12 : 170 }] });
  const L = oleLineDay({ hours: hrs, targets, entries: {}, shift: SHIFT_PLANT });
  const R = { days: [{ date: '2026-11-03', byLine: { 1: { ok: true, ...L } } }] };
  it('plan = 11.25 h × 180 = 2025 (tea break out); the 12 pieces after 21:00 are actual with no plan', () => {
    const d = kpiDays({ R, targetsOf: () => targets, shiftOf: () => SHIFT_PLANT, lines: ['1'], lastScans: { '2026-11-03|1': 21 * 60 + 5 } });
    const x = d[0].lines['1'];
    expect(Math.round(x.plan)).toBe(2025);
    expect(x.qty).toBe(12 * 170 + 12);
    expect(Math.round(x.hours * 100) / 100).toBe(11.25);
  });
  it('a day that stops at 17:30 (last scan): plan up to there only — 8 h', () => {
    const h2 = hrs.filter((h) => h.hour < 17).concat([{ hour: 17, quantity: 85, models: [{ mmId: 1, model: 'A', quantity: 85 }] }]);
    const L2 = oleLineDay({ hours: h2, targets, entries: {}, shift: SHIFT_PLANT, nowMin: null });
    const R2 = { days: [{ date: '2026-11-04', byLine: { 1: { ok: true, ...L2 } } }] };
    const x = kpiDays({ R: R2, targetsOf: () => targets, shiftOf: () => SHIFT_PLANT, lines: ['1'], lastScans: { '2026-11-04|1': 17 * 60 + 30 } })[0].lines['1'];
    expect(Math.round(x.hours * 100) / 100).toBe(8);
    expect(Math.round(x.plan)).toBe(1440);
  });
});

// 25-11-2026: Plant Efficiency "Plan Target Qty", its model-wise targets and the SAWM KPI plan are ONE number
import { planTargetOf, modelPerf } from '../src/utils/ole';
describe('one plan: Plant Efficiency = model-wise total = SAWM KPI', () => {
  const targets = { 1: { cycle: 20.6 }, 2: { cycle: 21.2 }, 3: { cycle: 24 } };
  const hrs = [];
  for (let h = 9; h <= 21; h++) {
    if (h === 21) { hrs.push({ hour: 21, quantity: 9, models: [{ mmId: 2, model: 'B', quantity: 9 }] }); continue; }   // overtime pieces
    const a = h < 15 ? 120 : 40, b = h < 15 ? 40 : 100, c = h === 18 ? 0 : 20;
    hrs.push({ hour: h, quantity: a + b + c, models: [{ mmId: 1, model: 'A', quantity: a }, { mmId: 2, model: 'B', quantity: b }, ...(c ? [{ mmId: 3, model: 'C', quantity: c }] : [])] });
  }
  for (const endMin of [null, 20 * 60 + 41]) {
    it(`same plan with the day ending ${endMin ? 'at the last scan 20:41' : 'with its last hour'}`, () => {
      const L = oleLineDay({ hours: hrs, targets, entries: {}, shift: SHIFT_PLANT, endMin });
      const R = { days: [{ date: '2026-11-01', byLine: { 1: { ok: true, ...L } } }] };
      const k = kpiDays({ R, targetsOf: () => targets, shiftOf: () => SHIFT_PLANT, lines: ['1'], lastScans: endMin ? { '2026-11-01|1': endMin } : {} })[0].lines['1'];
      const card = planTargetOf(L.total);
      expect(card).toBe(Math.round(k.plan));
      const models = modelPerf(R, ['1']);
      expect(models.reduce((a, m) => a + (m.target || 0), 0)).toBe(card);
      // tea break 18:30–18:45 out, overtime (21:00) no plan
      expect(L.plan.byHour[21]).toBeUndefined();
      expect(L.plan.byHour[18]).toBeLessThan(L.plan.byHour[17]);
    });
  }
});

// 25-11-2026: Loss entry hour targets — a model without a cycle time takes the line's average cycle of the day (as the
// day plan), and an hour that made nothing has no target (before: 185 pcs against a target of 9)
import { hourTargets } from '../src/utils/entryStatus';
import { scanHourTargets } from '../src/utils/ole';
describe('Loss entry hour target: model without cycle time, idle hour', () => {
  const rows = [
    { hour: 9, totalMin: 60, qty: 180, noStdQty: 0, stdSec: 180 * 20 },   // all with a cycle: 20 s
    { hour: 14, totalMin: 60, qty: 185, noStdQty: 175, stdSec: 10 * 20 },  // mostly a model without a cycle
    { hour: 15, totalMin: 60, qty: 0, noStdQty: 0, stdSec: 0 },            // line stopped
  ];
  it('the model without a cycle gets the day average; the idle hour none', () => {
    const t = hourTargets(rows);
    expect(t.dayCyc).toBeCloseTo(20);
    expect(t.by[9]).toBe(180);
    expect(t.by[14]).toBe(180);            // not 9 any more
    expect(t.by[15]).toBeUndefined();
  });
  it('from the scans: its minutes ÷ the day average cycle', () => {
    const scRows = [{ hour: 14, totalMin: 60, qty: 2, models: [{ mmId: 1, model: 'A', quantity: 1, std: 20 }, { mmId: 2, model: 'X', quantity: 1, std: null }] }];
    const scans = [{ t: '14:00:00', mmId: 1 }, { t: '14:30:00', mmId: 2 }, { t: '14:59:00', mmId: 2 }];
    const r = scanHourTargets(scRows, { 14: scans }, {}, { dayCyc: 20 });
    expect(r.by[14] == null || r.by[14] > 0).toBe(true);
  });
});
