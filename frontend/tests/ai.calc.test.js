// AI analysis (src/utils/ai.js): alerts, forecast, day report and questions, on a hand-made day.
import { describe, it, expect } from 'vitest';
import { aiContext, anomalies, forecast, brief, briefText, ask, median } from '../src/utils/ai';

const SHIFT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
const A = { mmId: 1, model: 'WT70C3000RR', modelCode: '1N57' };
const B = { mmId: 2, model: 'WT65R2200LL', modelCode: '1HUK' };
const C = { mmId: 3, model: 'WT75B3200RR', modelCode: '13WU' };

/** one hour row like day_overview.hourly.hours */
const H = (hour, qty, cyc, models, extra = {}) => ({
  hour, label: `${String(hour).padStart(2, '0')}:00-${String(hour + 1).padStart(2, '0')}:00`, quantity: qty, avgActualCycleSeconds: cyc,
  distinctModels: models.length, models: models.map(([m, q]) => ({ ...m, quantity: q })), idleSeconds: 0, idleGaps: 0, ...extra,
});
// 60 s target for A → 60 pcs/hr; a normal hour here makes 60
const hours = [
  H(9, 0, null, []),                                  // late start
  H(10, 60, 59, [[A, 60]]),
  H(11, 58, 61, [[A, 58]]),
  H(12, 20, 62, [[A, 20]], { idleSeconds: 1800, idleGaps: 2 }),   // weak hour, long stop
  H(13, 30, 60, [[A, 30]]),                           // half hour of work (lunch 13:00–13:30)
  H(14, 0, null, []),                                 // idle hour in between
  H(15, 50, 85, [[A, 20], [B, 20], [C, 10]]),         // cycle spike + 3 models
  H(16, 61, 58, [[A, 61]]),
  H(17, 60, 60, [[A, 60]]),
  H(18, 59, 60, [[A, 59]]),
  H(19, 60, 60, [[A, 60]]),
  H(20, 58, 61, [[A, 58]]),
];
const total = hours.reduce((s, h) => s + h.quantity, 0);
const summary = { totalQuantity: total, dayAvgActualCycleSeconds: 62, idleSeconds: 1800, idleGaps: 2, hours };
const days = [
  { date: '2026-10-20', quantity: 650, activeHours: 11, avgActualCycleSeconds: 60, distinctModels: 2, idleSeconds: 600, idleGaps: 1 },
  { date: '2026-10-21', quantity: 640, activeHours: 11, avgActualCycleSeconds: 61, distinctModels: 2 },
  { date: '2026-10-22', quantity: 660, activeHours: 11, avgActualCycleSeconds: 59, distinctModels: 1 },
  { date: '2026-10-23', quantity: total, activeHours: 10, avgActualCycleSeconds: 62, distinctModels: 3 },
];
const mrow = (q) => Object.fromEntries([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => [h, { hour: h, quantity: h === 13 ? q / 2 : q }]));
const matrix = { '2026-10-20': mrow(58), '2026-10-21': mrow(58), '2026-10-22': mrow(60), '2026-10-23': Object.fromEntries(hours.map((h) => [h.hour, h])) };
const rejection = { summary: { totalRejections: 14, totalAttempts: 600, rejectionRate: 2.3 }, reasons: [{ reason: 'Duplicate scan', rejectionQty: 10 }], hourly: [{ hour: 10, label: '10:00-11:00', rejectionQty: 1 }, { hour: 11, label: '11:00-12:00', rejectionQty: 1 }, { hour: 16, label: '16:00-17:00', rejectionQty: 12 }] };
const models = [{ ...A, companyTitle: 'SAMSUNG', quantity: 2400, activeHours: 40, avgActualCycleSeconds: 60 }, { ...B, companyTitle: 'SAMSUNG', quantity: 300, activeHours: 6, avgActualCycleSeconds: 80 }, { ...C, companyTitle: 'LG', quantity: 30, activeHours: 1, avgActualCycleSeconds: 70 }];
const targets = { 1: { cycle: 60 }, 2: { cycle: 60 } };
const losses = [{ date: '2026-10-23', hour: 12, minutes: 25, reason: 'Machine breakdown' }];

const ctxPast = aiContext({ line: '2', focusDate: '2026-10-23', now: new Date('2026-10-27T10:00:00'), summary, days, matrix, models, rejection, shift: SHIFT, targets, losses, lunchByHour: { 13: 0 } });

describe('alerts', () => {
  const al = anomalies(ctxPast);
  const kinds = al.map((a) => `${a.kind}@${a.hour ?? ''}`);
  it('late start, idle hour between production, weak hour with its causes', () => {
    expect(kinds).toContain('late-start@9');
    expect(kinds).toContain('idle@14');
    const low = al.find((a) => a.kind === 'low-hour' && a.hour === 12);
    expect(low.level).toBe('bad');
    expect(low.causes.join(' ')).toMatch(/line stopped 30 min/);
    expect(low.causes.join(' ')).toMatch(/25 min recorded in the loss register/);
  });
  it('cycle spike in the changeover hour, rejection spike, slow model, day below the usual day', () => {
    const cyc = al.find((a) => a.hour === 15);
    expect(cyc).toBeTruthy();
    expect(kinds).toContain('rejection@16');
    expect(al.some((a) => a.kind === 'rejection-day')).toBe(true);
    expect(al.find((a) => a.kind === 'model').title).toMatch(/WT65R2200LL/);
    expect(al.find((a) => a.kind === 'history').level).toBe('bad');
  });
  it('the long stop of 12-13 is not reported twice; bad alerts come first', () => {
    expect(al.filter((a) => a.hour === 12 && (a.kind === 'stop' || a.kind === 'low-hour')).length).toBe(1);
    const lv = al.map((a) => a.level);
    expect(lv.indexOf('bad')).toBe(0);
    expect(lv.lastIndexOf('bad')).toBeLessThan(lv.indexOf('info'));
  });
  it('short hours without a reason are listed (12-13 has one)', () => {
    const u = al.find((a) => a.kind === 'unrecorded');
    expect(u.detail).toMatch(/09-10/);
    expect(u.detail).not.toMatch(/12-13/);
  });
});

describe('forecast', () => {
  it('a past day is closed with its final target result', () => {
    const f = forecast(ctxPast);
    expect(f.state).toBe('closed');
    expect(f.qty).toBe(total);
    expect(Math.round(f.target)).toBe(678);   // 11.5 working hours × 60, minus the 15:00 hour's share of model C (no target: 10 of 50 pcs → 12)
    expect(f.text).toMatch(/Day closed/);
  });
  it('today: projection between low and high, verdict and required rate', () => {
    const today = hours.map((h) => (h.hour >= 15 ? { ...h, quantity: 0, models: [], avgActualCycleSeconds: null, distinctModels: 0 } : h));
    const q = today.reduce((s, h) => s + h.quantity, 0);
    const ctx = aiContext({ line: '2', focusDate: '2026-10-23', now: new Date('2026-10-23T15:00:00'), summary: { ...summary, totalQuantity: q, hours: today }, days, matrix, models, rejection, shift: SHIFT, targets, losses });
    const f = forecast(ctx);
    expect(f.state).toBe('live');
    expect(f.remainingSec).toBe(6 * 3600);
    expect(f.projected).toBeGreaterThan(q);
    expect(f.low).toBeLessThanOrEqual(f.projected);
    expect(f.high).toBeGreaterThanOrEqual(f.projected);
    expect(['on-track', 'at-risk', 'will-miss']).toContain(f.verdict);
    expect(f.need).toBeCloseTo((690 - q) / 6, 5);
    // the curve ends at the projection
    const last = f.curve[f.curve.length - 1];
    expect(Math.abs(last.forecast - f.projected)).toBeLessThanOrEqual(1);
    expect(last.target).toBe(690);
  });
  it('before production: no forecast yet', () => {
    const ctx = aiContext({ line: '2', focusDate: '2026-10-23', now: new Date('2026-10-23T09:05:00'), summary: { ...summary, totalQuantity: 0, hours: [H(9, 0, null, [])] }, days, matrix, shift: SHIFT, targets });
    expect(forecast(ctx).state).toBe('early');
  });
});

describe('day report', () => {
  const b = brief(ctxPast);
  it('headline, score and sections', () => {
    expect(b.headline).toMatch(new RegExp(`Line 2: ${total} pcs on 23 Oct`));
    expect(b.headline).toMatch(/of the day target \(678 pcs/);
    expect(b.score).toBeGreaterThan(0);
    expect(b.score).toBeLessThan(100);
    expect(b.sections.map((s) => s.key)).toEqual(['production', 'time', 'cycle', 'quality']);
    expect(b.sections[0].points.join(' ')).toMatch(/Segment 1 \(09:00–13:00\)/);
    expect(b.sections[1].points.join(' ')).toMatch(/Machine breakdown 25 min/);
    expect(b.sections[2].points.join(' ')).toMatch(/no target: WT75B3200RR/);
  });
  it('actions are ranked by the pieces they recover', () => {
    const g = b.actions.map((a) => a.gain);
    expect(g).toEqual([...g].sort((x, y) => y - x));
    const keys = b.actions.map((a) => a.key);
    expect(['stops', 'start', 'quality', 'targets'].every((k) => keys.includes(k))).toBe(true);
    expect(b.best.hour).toBe(16);
  });
  it('plain text report', () => {
    const t = briefText(b, ctxPast);
    expect(t).toMatch(/^EMS Line Pulse — AI analysis · Line 2 · 2026-10-23/);
    expect(t).toMatch(/WHAT TO DO\n1\./);
  });
});

describe('questions (English and Hinglish)', () => {
  it('production, target, best hour', () => {
    expect(ask('aaj kitna production hua?', ctxPast).title).toBe(`${total} pcs`);
    expect(ask('target kitna hua', ctxPast).title).toMatch(/^Target \d+%/);
    expect(ask('best hour kaunsa tha', ctxPast).title).toBe('Best hour 16-17');
    expect(ask('sabse kam kab bana', ctxPast).title).toMatch(/^Weakest hour/);
  });
  it('an hour: "12 baje", "3 baje" = 15:00, "15-16"', () => {
    expect(ask('12 baje kya hua', ctxPast).title).toBe('12-13: 20 pcs');
    expect(ask('3 baje kya hua', ctxPast).title).toBe('15-16: 50 pcs');
    expect(ask('15-16 me kitna bana', ctxPast).title).toBe('15-16: 50 pcs');
  });
  it('another day of the period', () => {
    expect(ask('kal kitna bana', ctxPast).title).toBe('22 Oct: 660 pcs');
    expect(ask('20-10 ka production', ctxPast).title).toBe('20 Oct: 650 pcs');
    expect(ask('1-10 ka production', ctxPast).title).toMatch(/^No data for/);
  });
  it('reasons, actions, stops, rejection, cycle, model by name, top models', () => {
    const w = ask('line peeche kyun hai', ctxPast);
    expect(w.bullets.length).toBeGreaterThan(2);
    expect(ask('kya karna chahiye', ctxPast).bullets[0]).toMatch(/pcs\)/);
    expect(ask('line kitni der band rahi', ctxPast).title).toBe('Stops: 30 min');
    expect(ask('rejection kitna hai', ctxPast).bullets[0]).toBe('Duplicate scan: 10');
    expect(ask('cycle time', ctxPast).title).toBe('Cycle: 62 s');
    const m = ask('WT65R2200LL ka cycle', ctxPast);
    expect(m.title).toBe('WT65R2200LL (SAMSUNG)');
    expect(m.lines.join(' ')).toMatch(/33% slower than target/);
    expect(ask('top models', ctxPast).table.rows[0][0]).toBe('WT70C3000RR');
  });
  it('other line, help, unknown', () => {
    expect(ask('line 3 kitna bana', ctxPast).lines[0]).toMatch(/This page shows Line 2/);
    expect(ask('help', ctxPast).bullets.length).toBeGreaterThan(4);
    expect(ask('xyz qwerty', ctxPast).title).toBe('Not understood');
  });
  it('median helper', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(null);
  });
});
