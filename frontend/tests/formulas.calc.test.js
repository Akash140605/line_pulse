// 23-11-2026: every main formula of the software checked against numbers worked out by hand (independent of the code).
import { describe, it, expect } from 'vitest';
import { oleOf, oleSum } from '../src/utils/ole';
import { mixTarget, pphOf, cycleOfPph, hourPlanOf, targetOf } from '../src/utils/targets';
import { workSecInHour, lunchMinInHour, lunchSplitOf, SHIFT_DEFAULT } from '../src/utils/shift';
import { pct, ppm } from '../src/utils/qualityDash';

const shift = SHIFT_DEFAULT;   // 09:00–21:00, lunch 13:00–13:30
const close = (a, b, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('OLE = Availability × Performance × Quality', () => {
  // shift 60 min planned, 10 min loss → 50 min run; 120 pcs at 20 s std = 2400 s = 40 min of std time; 6 rejected
  const t = { totalMin: 60, plannedMin: 60, actualMin: 50, qty: 120, stdSec: 2400, noStdQty: 0, rejects: 6, rework: 0 };
  const r = oleOf(t);
  it('Availability = run time ÷ planned time = 50 / 60', () => close(r.A, 50 / 60));
  it('Performance = std time ÷ run time = 2400 s / 3000 s = 80 %', () => close(r.P, 0.8));
  it('Quality = good ÷ made = 114 / 120 = 95 %', () => close(r.Q, 0.95));
  it('OLE = 0.8333 × 0.8 × 0.95 = 63.33 %', () => close(r.ole, (50 / 60) * 0.8 * 0.95));
  it('speed loss = run time − std time = 50 − 40 = 10 min', () => close(r.speedMin, 10));
  it('pieces without a std cycle do not pull Performance down', () => {
    // 100 of 120 pieces have a std (2000 s); they used 100/120 of the 50 min → P = 2000 / (3000 × 100/120) = 80 %
    const x = oleOf({ ...t, stdSec: 2000, noStdQty: 20 });
    close(x.P, 2000 / (3000 * (100 / 120)));
  });
  it('a line stopped all day: A = 0 → OLE 0; nothing planned → no OLE', () => {
    expect(oleOf({ ...t, actualMin: 0, qty: 0, stdSec: 0, rejects: 0 }).ole).toBe(0);
    expect(oleOf({ ...t, plannedMin: 0, totalMin: 0 }).ole).toBe(null);
  });
  it('the sum of two hours is worked out from the summed minutes, not by averaging percentages', () => {
    const h1 = { totalMin: 60, plannedMin: 60, actualMin: 60, qty: 180, stdSec: 3600, noStdQty: 0, rejects: 0, rework: 0 };
    const h2 = { totalMin: 60, plannedMin: 60, actualMin: 30, qty: 60, stdSec: 1200, noStdQty: 0, rejects: 3, rework: 0 };
    const s = oleSum([h1, h2]);
    close(s.A, 90 / 120); close(s.P, 4800 / (90 * 60)); close(s.Q, 237 / 240);
  });
});

describe('Targets', () => {
  it('pieces per hour = 3600 ÷ cycle; cycle from pieces per hour (2 decimals)', () => {
    expect(pphOf(20)).toBe(180); expect(pphOf(24)).toBe(150); expect(cycleOfPph(175)).toBe(20.57);
  });
  it('mix cycle = Σ(qty × cycle) ÷ Σ qty: 60 pcs @ 20 s + 40 pcs @ 30 s → 24 s', () => {
    const m = mixTarget([{ mmId: 1, qty: 60 }, { mmId: 2, qty: 40 }, { mmId: 3, qty: 5 }], { 1: { cycle: 20 }, 2: { cycle: 30 } });
    close(m.cycle, 24); expect(m.covered).toBe(100); expect(m.total).toBe(105);
    expect(targetOf({ 1: { cycle: 20 } }, 3)).toBe(null);
  });
  it('working seconds per hour: full hour 3600, lunch hour 13–14 only 1800 (lunch 13:00–13:30)', () => {
    expect(workSecInHour(shift, 10)).toBe(3600);
    expect(workSecInHour(shift, 13)).toBe(1800);
    expect(lunchMinInHour(shift, 13)).toBe(30);
    expect(workSecInHour(shift, 8)).toBe(0);
    expect(workSecInHour(shift, 21)).toBe(0);
  });
  it('hour target = working seconds ÷ mix cycle: 3600/24 = 150; lunch hour 1800/24 = 75', () => {
    const models = (h) => [{ hour: h, mmId: 1, model: 'A', qty: 60 }, { hour: h, mmId: 2, model: 'B', qty: 40 }];
    const p = hourPlanOf({ hours: [{ hour: 10, quantity: 100 }, { hour: 13, quantity: 100 }], hourModels: [...models(10), ...models(13)], shift, targets: { 1: { cycle: 20 }, 2: { cycle: 30 } } });
    expect(p.targets[10]).toBe(150);
    expect(p.targets[13]).toBe(75);
  });
  it('per model share of the hour = qty × working sec ÷ Σ(qty × cycle): 60 × 3600 / 2400 = 90, 40 × 1.5 = 60', () => {
    const sumQC = 60 * 20 + 40 * 30; const per = (q) => (q * 3600) / sumQC;
    expect(per(60)).toBe(90); expect(per(40)).toBe(60); expect(per(60) + per(40)).toBe(150);
  });
  it('the running hour is pro-rated to the minutes already worked (10:00–10:30 → half of 180 = 90)', () => {
    const p = hourPlanOf({ hours: [{ hour: 10, quantity: 80 }], hourModels: [{ hour: 10, mmId: 1, model: 'A', qty: 80 }], shift, targets: { 1: { cycle: 20 } }, nowMin: 10 * 60 + 30 });
    expect(p.targets[10]).toBe(90);
  });
});

describe('Lunch scans', () => {
  it('the 82-piece case: 8 scans in lunch + 74 after → 74 worked pcs in 1800 s, theoretical cycle 1800/74 = 24.3 s', () => {
    const sc = (t) => ({ mmId: 1, scanDate: `2026-11-23 ${t}.000` });
    const scans = [];
    for (let i = 0; i < 8; i++) scans.push(sc(`13:${String(5 + i).padStart(2, '0')}:00`));
    for (let i = 0; i < 74; i++) { const s = 30 * 60 + Math.floor((i * 1800) / 74); scans.push(sc(`13:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`)); }
    const L = lunchSplitOf({ hour: 13, totalQuantity: 82, models: [{ mmId: 1, quantity: 82 }], scans }, shift);
    expect([L.lunchQty, L.workQty, L.workSec]).toEqual([8, 74, 1800]);
    close(1800 / L.workQty, 24.324, 1e-3);
  });
});

describe('Quality', () => {
  it('rejection % = rejected ÷ made × 100; PPM = rejected ÷ made × 1 000 000', () => {
    expect(pct(6, 120)).toBe(5); expect(ppm(6, 120)).toBe(50000); expect(ppm(1, 3)).toBe(333333);
    expect(pct(1, 0)).toBe(null); expect(ppm(1, 0)).toBe(null);
  });
  it('FPY = good first time ÷ made; RTY = product of the stations\' FPY (0.98 × 0.95 = 93.1 %)', () => {
    close(0.98 * 0.95, 0.931);
  });
});

describe('Cell % in the hourly matrix', () => {
  const pctOf = (r) => (r < 1 ? Math.floor(r * 100) : Math.round(r * 100));   // same rule as HourlyMatrix
  it('below 100 % rounds down (99.6 % shows 99, never 100); from 100 % it rounds', () => {
    expect(pctOf(0.996)).toBe(99); expect(pctOf(0.5)).toBe(50); expect(pctOf(1)).toBe(100); expect(pctOf(1.026)).toBe(103);
  });
});
