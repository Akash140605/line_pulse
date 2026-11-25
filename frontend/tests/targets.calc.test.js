// Shift / lunch segments (src/utils/shift.js) and model-wise targets (src/utils/targets.js).
import { describe, it, expect } from 'vitest';
import { toMin, fmtMin, normShift, segments, workSecInHour, lunchMinInHour, shiftHours, shiftText } from '../src/utils/shift';
import { targetOf, pphOf, cycleOfPph, mixTarget, status, buildTargetDay, requiredRate, historyRows } from '../src/utils/targets';

const SHIFT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };

describe('shift: two segments around lunch', () => {
  it('times', () => {
    expect([toMin('09:00'), toMin('9:05'), toMin('24:00'), toMin('25:00'), toMin('x')]).toEqual([540, 545, 1440, null, null]);
    expect(fmtMin(810)).toBe('13:30');
  });
  it('segments', () => {
    expect(segments(SHIFT).map((p) => [p.key, fmtMin(p.from), fmtMin(p.to), p.work])).toEqual([
      ['s1', '09:00', '13:00', true], ['lunch', '13:00', '13:30', false], ['s2', '13:30', '21:00', true]]);
    expect(segments({ start: '08:00', end: '17:00', lunchStart: null, lunchEnd: null }).map((p) => p.key)).toEqual(['shift']);
  });
  it('bad shift falls back to the default; lunch outside the shift is ignored', () => {
    expect(normShift({ start: '21:00', end: '09:00' }).start).toBe(540);
    expect(normShift({ start: '09:00', end: '12:00', lunchStart: '13:00', lunchEnd: '13:30' }).lunchStart).toBe(null);
  });
  it('working seconds per hour: lunch half hour removed, before / after shift = 0', () => {
    expect(workSecInHour(SHIFT, 12)).toBe(3600);
    expect(workSecInHour(SHIFT, 13)).toBe(1800);
    expect(workSecInHour(SHIFT, 8)).toBe(0);
    expect(workSecInHour(SHIFT, 21)).toBe(0);
    expect(lunchMinInHour(SHIFT, 13)).toBe(30);
    expect(shiftHours(SHIFT)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
  it('cut at now: 13:45 → hour 13 has 15 min worked, hour 14 nothing yet', () => {
    expect(workSecInHour(SHIFT, 13, 13 * 60 + 45)).toBe(15 * 60);
    expect(workSecInHour(SHIFT, 14, 13 * 60 + 45)).toBe(0);
    expect(workSecInHour(SHIFT, 10, 10 * 60 + 30)).toBe(1800);
  });
  it('shift as text', () => {
    expect(shiftText(SHIFT)).toBe('09:00–13:00 · Lunch 13:00–13:30 · 13:30–21:00 (11 h 30 min working)');
  });
});

const T = { 1: { cycle: 15 }, 2: { cycle: 20 } };   // model 1: 240 pcs/hr, model 2: 180 pcs/hr

describe('model targets', () => {
  it('target of a model; pcs/hr ↔ cycle', () => {
    expect([targetOf(T, 1), targetOf(T, '2'), targetOf(T, 3), targetOf(T, null)]).toEqual([15, 20, null, null]);
    expect(pphOf(15)).toBe(240);
    expect(cycleOfPph(240)).toBe(15);
    expect(cycleOfPph(0)).toBe(null);
  });
  it('mixed hour: target weighted by quantity; models without target do not count', () => {
    const m = mixTarget([{ mmId: 1, quantity: 100 }, { mmId: 2, quantity: 50 }, { mmId: 9, quantity: 10 }], T);
    expect(m.cycle).toBeCloseTo((100 * 15 + 50 * 20) / 150, 9);
    expect([m.covered, m.total]).toEqual([150, 160]);
    expect(mixTarget([{ mmId: 9, quantity: 5 }], T).cycle).toBe(null);
  });
  it('status', () => {
    expect([status(100, 100), status(95, 100), status(80, 100), status(5, 0)]).toEqual(['ok', 'watch', 'behind', null]);
  });
});

// focus day: model 1 in the morning, model 2 after lunch, one idle hour (11)
const HOURS = [
  { hour: 9, quantity: 230, avgActualCycleSeconds: 15.5, models: [{ mmId: 1, model: 'A', quantity: 230 }] },
  { hour: 10, quantity: 240, avgActualCycleSeconds: 15, models: [{ mmId: 1, model: 'A', quantity: 240 }] },
  { hour: 11, quantity: 0, models: [] },
  { hour: 12, quantity: 200, avgActualCycleSeconds: 16, models: [{ mmId: 1, model: 'A', quantity: 200 }] },
  { hour: 13, quantity: 80, avgActualCycleSeconds: 21, models: [{ mmId: 2, model: 'B', quantity: 80 }] },
  { hour: 14, quantity: 170, avgActualCycleSeconds: 21, models: [{ mmId: 2, model: 'B', quantity: 170 }] },
];

describe('buildTargetDay — finished day', () => {
  const d = buildTargetDay({ hours: HOURS, shift: SHIFT, targets: T });
  const row = (h) => d.rows.find((r) => r.hour === h);
  it('hour target = working seconds ÷ target cycle of the model(s) in the hour', () => {
    expect(row(9).plan).toBe(240);
    expect(row(9).diff).toBe(-10);
    expect(row(13).plan).toBe(90);            // lunch 13:00–13:30 → 1800 s ÷ 20 s
    expect(row(13).lunchMin).toBe(30);
    expect(row(9).cycleDiff).toBeCloseTo(0.5, 9);
  });
  it('idle hour keeps the target of the model before it (lost time shows as shortfall)', () => {
    expect(row(11).targetCycle).toBe(15);
    expect(row(11).plan).toBe(240);
    expect(row(11).diff).toBe(-240);
    expect(row(11).status).toBe('behind');
  });
  it('hours after the last production keep the last model target', () => {
    expect(row(20).targetCycle).toBe(20);
    expect(row(20).plan).toBe(180);
  });
  it('segment 1 / lunch / segment 2', () => {
    const [s1, lunch, s2] = d.parts;
    expect([s1.key, lunch.key, s2.key]).toEqual(['s1', 'lunch', 's2']);
    expect(s1.qty).toBe(670);
    expect(s1.plan).toBe(960);                // 4 hours × 240
    expect(s1.diff).toBe(-290);
    expect(lunch.qty).toBe(null);
    expect(lunch.hasPlan).toBe(false);
    expect(s2.qty).toBe(250);
    expect(s2.plan).toBeCloseTo(90 + 7 * 180, 9);   // 13:30–14:00 + 7 hours 14:00–21:00
  });
  it('day total = Σ hours; parts add up to the day', () => {
    expect(d.total.qty).toBe(920);
    expect(d.total.plan).toBeCloseTo(960 + 90 + 7 * 180, 9);
    expect(d.parts[0].plan + d.parts[2].plan).toBeCloseTo(d.total.plan, 9);
    expect(d.parts[0].qty + d.parts[2].qty).toBe(d.total.qty);
  });
});

describe('buildTargetDay — today, now 14:30', () => {
  const d = buildTargetDay({ hours: HOURS, shift: SHIFT, targets: T, nowMin: 14 * 60 + 30 });
  const row = (h) => d.rows.find((r) => r.hour === h);
  it('running hour: target only up to now; future hours have no shortfall yet', () => {
    expect(row(14).running).toBe(true);
    expect(row(14).plan).toBe(90);            // 30 min ÷ 20 s
    expect(row(15).future).toBe(true);
    expect(row(15).diff).toBe(null);
    expect(row(15).planFull).toBe(180);       // projection for the full day uses the running model's target
  });
  it('segment 2 target to now; segment 1 done', () => {
    expect(d.parts[0].done).toBe(true);
    expect(d.parts[2].plan).toBeCloseTo(90 + 90, 9);
    expect(d.parts[2].done).toBe(false);
  });
  it('required rate for the rest of the day', () => {
    const r = requiredRate(d.total);
    expect(d.total.remainingSec).toBe(6.5 * 3600);
    expect(r).toBeCloseTo((d.total.planFull - 920) / 6.5, 9);
  });
});

describe('no targets set', () => {
  it('no plan, no status, nothing invented', () => {
    const d = buildTargetDay({ hours: HOURS, shift: SHIFT, targets: {} });
    expect(d.hasPlan).toBe(false);
    expect(d.total.plan).toBe(null);
    expect(d.rows[0].status).toBe(null);
  });
  it('fallback target (running model) fills a day without model data', () => {
    const d = buildTargetDay({ hours: [{ hour: 9, quantity: 100, models: [] }], shift: SHIFT, targets: {}, fallbackCycle: 36 });
    expect(d.rows[0].plan).toBe(100);
  });
});

describe('model history', () => {
  const days = [
    { date: '2026-10-25', quantity: 0 },
    { date: '2026-10-24', quantity: 2000, activeHours: 10, avgActualCycleSeconds: 16 },
    { date: '2026-10-26', quantity: 1800, activeHours: 8, avgActualCycleSeconds: 14.5 },
  ];
  it('day rows: newest first, achieved pcs/hr, differences to target', () => {
    const h = historyRows(days, 15);
    expect(h.map((r) => r.date)).toEqual(['2026-10-26', '2026-10-24']);   // day without production left out
    expect(h[0]).toMatchObject({ qty: 1800, pph: 225, targetPph: 240, pphDiff: -15, cycleDiff: -0.5, status: 'ok', targetQty: 1920 });
    expect(h[1].status).toBe('watch');        // 16 s vs 15 s = 107 %
    expect(h[1].cyclePct).toBeCloseTo(106.666, 2);
  });
  it('without target: values only', () => {
    expect(historyRows(days, null)[0]).toMatchObject({ targetPph: null, cycleDiff: null, status: null });
  });
});

import { splitHours } from '../src/utils/shift';
describe('splitHours — lunch as its own row', () => {
  const lab = (rows) => rows.map((r) => `${r.kind}:${r.label}`);
  it('lunch at the start of an hour: lunch row, then the worked half', () => {
    expect(lab(splitHours(SHIFT, [12, 13, 14]))).toEqual(['hour:12-13', 'lunch:Lunch 13:00–13:30', 'work:13:30–14:00', 'hour:14-15']);
    expect(splitHours(SHIFT, [13]).map((r) => r.min)).toEqual([30, 30]);
  });
  it('lunch at the end of an hour: worked part first', () => {
    expect(lab(splitHours({ ...SHIFT, lunchStart: '12:30', lunchEnd: '13:00' }, [12]))).toEqual(['work:12:00–12:30', 'lunch:Lunch 12:30–13:00']);
  });
  it('a full lunch hour has no worked row; a lunch across two hours splits both', () => {
    expect(lab(splitHours({ ...SHIFT, lunchStart: '13:00', lunchEnd: '14:00' }, [13]))).toEqual(['lunch:Lunch 13:00–14:00']);
    expect(lab(splitHours({ ...SHIFT, lunchStart: '12:45', lunchEnd: '13:15' }, [12, 13]))).toEqual(['work:12:00–12:45', 'lunch:Lunch 12:45–13:00', 'lunch:Lunch 13:00–13:15', 'work:13:15–14:00']);
  });
  it('lunch inside an hour: worked parts on both sides in one row', () => {
    expect(lab(splitHours({ ...SHIFT, lunchStart: '13:10', lunchEnd: '13:40' }, [13]))).toEqual(['work:13:00–13:10 + 13:40–14:00', 'lunch:Lunch 13:10–13:40']);
  });
  it('no lunch: plain hours', () => {
    expect(lab(splitHours({ start: '09:00', end: '17:00', lunchStart: null, lunchEnd: null }, [12, 13]))).toEqual(['hour:12-13', 'hour:13-14']);
  });
});

describe('buildTargetDay with scans during lunch', () => {
  const d = buildTargetDay({ hours: HOURS, shift: SHIFT, targets: T, lunchByHour: { 13: 20 } });
  const r13 = d.rows.find((r) => r.hour === 13);
  it('the worked half of hour 13 gets the hour minus the lunch scans', () => {
    expect([r13.qty, r13.lunchQty]).toEqual([60, 20]);
    expect(r13.diff).toBe(60 - 90);
  });
  it('lunch part shows its scans; segment 2 has only the worked scans; day total keeps all scans', () => {
    expect(d.parts[1].qty).toBe(20);
    expect(d.parts[2].qty).toBe(230);
    expect(d.total.qty).toBe(920);
    expect(d.total.lunchQty).toBe(20);
  });
  it('without lunch counts nothing changes', () => {
    expect(buildTargetDay({ hours: HOURS, shift: SHIFT, targets: T }).parts[1].qty).toBe(null);
  });
});

// 16-11-2026: an hour where a model WITHOUT a target ran too (Line 1, 12–13: 141 REALME not in the master + 23 VOLTAS)
import { hourPlanOf } from '../src/utils/targets';
describe('model without a target does not add to the hour target', () => {
  const SH = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
  const T = { 196: { cycle: 20.57 }, 182: { cycle: 20.57 } };
  const hours = [
    { hour: 11, quantity: 121, models: [{ mmId: 196, model: 'V-GL', quantity: 114 }, { mmId: 182, model: 'V-GB', quantity: 4 }, { mmId: 192, model: 'RMSA1005REALME', quantity: 3 }] },
    { hour: 12, quantity: 164, models: [{ mmId: 192, model: 'RMSA1005REALME', quantity: 141 }, { mmId: 196, model: 'V-GL', quantity: 16 }, { mmId: 182, model: 'V-GB', quantity: 7 }] },
    { hour: 13, quantity: 42, models: [{ mmId: 192, model: 'RMSA1005REALME', quantity: 42 }] },
  ];
  const d = buildTargetDay({ hours, shift: SH, targets: T, nowMin: 13 * 60 + 50 });
  const h12 = d.rows.find((r) => r.hour === 12), h13 = d.rows.find((r) => r.hour === 13), h11 = d.rows.find((r) => r.hour === 11);
  it('the hour target covers only the share of the models with a target', () => {
    expect(h12.plan).toBeCloseTo((3600 * 23 / 164) / 20.57, 6);   // ≈ 24.5, not 175
    expect(h12.noTgtQty).toBe(141); expect(h12.tgtQty).toBe(23);
    expect(h12.noTgtModels).toEqual(['RMSA1005REALME']);
    expect(h12.pct).toBeCloseTo((23 / h12.plan) * 100, 6);
  });
  it('an hour of only a model without a target: no target, all its pieces shown as no target', () => {
    expect(h13.plan).toBe(null); expect(h13.noTgtQty).toBe(42);
  });
  it('day: no-target pieces are not compared with the target', () => {
    expect(d.total.noTgtQty).toBe(3 + 141 + 42);
    expect(d.total.tgtQty).toBe(d.total.qty - 186);
    expect(d.total.pct).toBeCloseTo((d.total.tgtQty / d.total.plan) * 100, 6);
    expect(h11.plan).toBeCloseTo((3600 * 118 / 121) / 20.57, 6);
  });
  it('hour bars: targets and the no-target pieces per hour', () => {
    const p = hourPlanOf({ hours, shift: SH, targets: T, nowMin: 13 * 60 + 50 });
    expect(p.targets[12]).toBe(Math.round(h12.plan));
    expect(p.targets[13]).toBeUndefined();
    expect(p.noTarget[12]).toEqual({ qty: 141, models: ['RMSA1005REALME'] });
    expect(p.noTarget[13].qty).toBe(42);
  });
  it('an hour with only target models is unchanged', () => {
    const d2 = buildTargetDay({ hours: [{ hour: 10, quantity: 161, models: [{ mmId: 196, model: 'V-GL', quantity: 161 }] }], shift: SH, targets: T });
    expect(d2.rows.find((r) => r.hour === 10).plan).toBeCloseTo(3600 / 20.57, 6);
  });
});
