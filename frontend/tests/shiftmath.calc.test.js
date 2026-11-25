// Takt analysis and loss calculation with the shared shift + lunch window (settings.shift).
import { describe, it, expect } from 'vitest';
import { computeAnalysis, windowHours, hourShare, DEFAULT_SETTINGS } from '../src/utils/analysis';
import { buildHourLoss } from '../src/utils/loss';

const SHIFT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
const S = { ...DEFAULT_SETTINGS, taktSec: 36, shift: SHIFT };   // 100 pcs per working hour
const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, quantity: h >= 9 && h < 21 ? (h === 13 ? 50 : 100) : 0, avgActualCycleSeconds: h >= 9 && h < 21 ? 36 : null }));
const summary = { hours, totalQuantity: hours.reduce((a, h) => a + h.quantity, 0) };

describe('takt analysis with the lunch window', () => {
  it('hour 13 stays in, at half its time', () => {
    expect(windowHours(S)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(hourShare(S, 13)).toBe(0.5);
    expect(hourShare(S, 12)).toBe(1);
  });
  it('available time 11.5 h, target 1150, hour 13 plan 50', () => {
    const a = computeAnalysis({ summary, models: [], settings: S, focusDate: '2026-01-01', now: new Date(2026, 9, 27, 12) });
    expect(a.kpis.availSec).toBe(11.5 * 3600);
    expect(a.kpis.target).toBe(1150);
    expect(a.hours.find((h) => h.hour === 13).plan).toBe(50);
    expect(a.hours.find((h) => h.hour === 13).status).toBe('ok');
    expect(a.kpis.achievement).toBeCloseTo(100, 6);
  });
  it('old settings without a shift: unchanged (whole lunch hour left out)', () => {
    expect(windowHours({ ...DEFAULT_SETTINGS })).not.toContain(13);
  });
});

describe('loss: lunch is not loss', () => {
  it('hour 13 has 30 min available; 50 pcs × 36 s = 30 min used → no loss', () => {
    const models = [{ mmId: 1, model: 'A', quantity: summary.totalQuantity, avgActualCycleSeconds: 36, hourly: hours.filter((h) => h.quantity).map((h) => ({ hour: h.hour, quantity: h.quantity })) }];
    const l = buildHourLoss({ summary, models, low: [], stds: { 1: 36 }, settings: S, focusDate: '2026-01-01', now: new Date(2026, 9, 27, 12) });
    const r13 = l.rows.find((r) => r.hour === 13);
    expect(r13.availSec).toBe(1800);
    expect(Math.round(r13.lossSec)).toBe(0);
    expect(Math.round(l.totals.lossSec)).toBe(0);
  });
});

describe('hourSpanLabel', () => {
  it('cuts the lunch off the hour it falls in', async () => {
    const { hourSpanLabel } = await import('../src/utils/shift.js');
    const sh = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
    expect(hourSpanLabel(sh, 13)).toBe('13:30-14');
    expect(hourSpanLabel(sh, 12)).toBe('12-13');
    expect(hourSpanLabel(sh, 9)).toBe('09-10');
    expect(hourSpanLabel({ ...sh, lunchStart: '13:30', lunchEnd: '14:00' }, 13)).toBe('13-13:30');
    expect(hourSpanLabel({ ...sh, end: '20:30' }, 20)).toBe('20-20:30');
    expect(hourSpanLabel(null, 13)).toBe('13:30-14');
  });
});

describe('realCycleSec', () => {
  it('first to last scan, lunch taken out, ÷ gaps — stops count', async () => {
    const { realCycleSec } = await import('../src/utils/shift.js');
    const sh = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
    // 09:00:00 → 14:00:00 = 300 min − 30 lunch = 270 min = 16200 s over 1001 pcs (1000 gaps)
    expect(realCycleSec(sh, '2026-10-28 09:00:00', '2026-10-28 14:00:00', 1001)).toBe(16.2);
    expect(realCycleSec(sh, '2026-10-28 09:00:00', '2026-10-28 10:00:00', 201)).toBe(18);
    expect(realCycleSec(sh, null, '2026-10-28 10:00:00', 10)).toBe(null);
    expect(realCycleSec(sh, '2026-10-28 09:00:00', '2026-10-28 10:00:00', 1)).toBe(null);
  });
});

import { runCycleOf } from '../src/utils/shift';
describe('actual cycle of the running model = its continuous run (16-11-2026)', () => {
  const sh = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [{ name: 'Tea', start: '11:00', end: '11:10' }] };
  it('every gap counts (a 5 min stop too); lunch and tea break are taken out', () => {
    // 4 pieces 09:01:00 → 09:06:30 = 330 s over 3 gaps = 110 s (the 1–22 s average would say 15 s)
    expect(runCycleOf(sh, { runFirst: '2026-11-16 09:01:00', runLast: '2026-11-16 09:06:30', runQty: 4, avgCycle: 15 })).toBe(110);
    // a run over the tea break and lunch: 10:00 → 14:00 = 240 min − 10 − 30 = 200 min over 1000 gaps = 12 s
    expect(runCycleOf(sh, { runFirst: '2026-11-16 10:00:00', runLast: '2026-11-16 14:00:00', runQty: 1001 })).toBe(12);
  });
  it('one piece only: no cycle yet; an old server without the run: its average', () => {
    expect(runCycleOf(sh, { runFirst: '2026-11-16 10:00:00', runLast: '2026-11-16 10:00:00', runQty: 1, avgCycle: 14 })).toBe(null);
    expect(runCycleOf(sh, { avgCycle: 14 })).toBe(14);
    expect(runCycleOf(sh, null)).toBe(null);
  });
});

// "How it's calculated" page (16-11-2026): its worked examples must match the screens' own maths
import { oleOf } from '../src/utils/ole';
import { realCycleSec, workSecInHour, normShift } from '../src/utils/shift';
describe('How it is calculated — worked examples', () => {
  const sh = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [{ name: 'Tea', start: '11:00', end: '11:10' }, { name: 'Tea', start: '17:00', end: '17:10' }] };
  it('working time = shift − lunch − tea breaks', () => {
    const n = normShift(sh);
    expect(n.end - n.start - n.off.reduce((a, [x, y]) => a + (y - x), 0)).toBe(670);
  });
  it('OLE of the example day', () => {
    const o = oleOf({ totalMin: 670, stopMin: 20, plannedMin: 650, lossMin: 50, actualMin: 600, qty: 1500, stdSec: 33000, noStdQty: 0, rejects: 15, rework: 0 });
    expect(o.A).toBeCloseTo(600 / 650, 6);
    expect(o.P).toBeCloseTo(550 / 600, 6);
    expect(o.Q).toBeCloseTo(0.99, 6);
    expect(o.ole).toBeCloseTo(0.8377, 3);
    expect(o.speedMin).toBeCloseTo(50, 6);
  });
  it('hour target and model cycle with a tea break', () => {
    expect(workSecInHour(sh, 11)).toBe(3000);
    expect(workSecInHour(sh, 11, 11 * 60 + 30)).toBe(1200);
    expect(realCycleSec(sh, '2026-11-16 10:00:00', '2026-11-16 11:20:00', 201)).toBe(21);
  });
});
