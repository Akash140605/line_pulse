// Day target and loss in rupees per line and day (src/utils/money.js).
import { describe, it, expect } from 'vitest';
import { rateOf, hasRates, rupees, groupDhm, dayLoss, hourLoss, reasonLoss, lossMatrix, sumLoss, missingTargets } from '../src/utils/money';

const SHIFT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
const money = { pcValue: 100, hourCost: 3600, values: { 2: 300 } };
const targets = { 1: { cycle: 60 }, 2: { cycle: 30 } };
const settings = { shift: SHIFT, targets, money };
// a full day of model 1 at 50 pcs/hr (target 60/hr), 11.5 working hours
const dhmDay = (d, perHour = 50, m = 1) => [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => [d, h, m, h === 13 ? perHour / 2 : perHour]);

describe('rates and formatting', () => {
  it('model value wins over the line default', () => {
    expect([rateOf(money, 2), rateOf(money, 1), rateOf({}, 1)]).toEqual([300, 100, null]);
    expect([hasRates(money), hasRates({ pcValue: null, hourCost: null, values: {} })]).toEqual([true, false]);
  });
  it('rupees with Indian grouping and short lakh / crore', () => {
    expect(rupees(1234567)).toBe('₹ 12,34,567');
    expect(rupees(1234567, { short: true })).toBe('₹ 12.3 L');
    expect(rupees(25000000, { short: true })).toBe('₹ 2.50 Cr');
    expect(rupees(null)).toBe('—');
  });
});

describe('one day', () => {
  const hours = groupDhm(dhmDay('2026-10-20'))['2026-10-20'];
  const dl = dayLoss({ date: '2026-10-20', hours, settings });
  it('target from the model targets over the working time (lunch excluded)', () => {
    expect(dl.actual).toBe(575);                 // 11 × 50 + 25
    expect(Math.round(dl.target)).toBe(690);     // 11.5 h × 60
    expect(Math.round(dl.short)).toBe(115);
    expect(dl.avgCycle).toBeCloseTo(60, 6);
  });
  it('₹ = short pcs × value + lost hours × line cost', () => {
    expect(Math.round(dl.rsPcs)).toBe(11500);    // 115 × ₹100
    expect(Math.round(dl.lostSec)).toBe(6900);   // 115 × 60 s
    expect(Math.round(dl.rsTime)).toBe(6900);    // 1.917 h × ₹3600
    expect(Math.round(dl.rsTotal)).toBe(18400);
  });
  it('hour rows add up to the day', () => {
    const hr = hourLoss(dl);
    expect(hr.length).toBe(12);
    expect(Math.round(hr.reduce((s, r) => s + r.short, 0))).toBe(115);
    expect(Math.round(hr.find((r) => r.hour === 13).plan)).toBe(30);
  });
  it('loss register split by reason, rest = not recorded', () => {
    const r = reasonLoss(dl, [{ reason: 'Machine breakdown', minutes: 60, dept: 'Maintenance' }, { reason: 'Material shortage', minutes: 20 }, { reason: 'Machine breakdown', minutes: 15 }]);
    expect(r.rows.map((x) => [x.reason, x.minutes, x.count])).toEqual([['Machine breakdown', 75, 2], ['Material shortage', 20, 1]]);
    expect(Math.round(r.rows[0].pcs)).toBe(75);
    expect(Math.round(r.rows[0].rsTotal)).toBe(75 * 100 + 75 * 60);
    expect(Math.round(r.open.minutes)).toBe(115 - 95);
  });
  it('model value used for its pieces (weighted)', () => {
    const h2 = groupDhm([['2026-10-20', 9, 1, 30], ['2026-10-20', 9, 2, 30]])['2026-10-20'];
    const d2 = dayLoss({ date: '2026-10-20', hours: h2, settings });
    expect(d2.value).toBe(200);
  });
  it('no target → no loss, coverage shows the share with a target', () => {
    const d3 = dayLoss({ date: '2026-10-20', hours: groupDhm(dhmDay('2026-10-20', 50, 9))['2026-10-20'], settings });
    expect([d3.hasPlan, d3.target, d3.rsTotal, d3.coverage]).toEqual([false, null, null, 0]);
  });
  it('without rates: pieces and time, no rupees', () => {
    const d4 = dayLoss({ date: '2026-10-20', hours, settings: { shift: SHIFT, targets } });
    expect([Math.round(d4.short), d4.rsPcs, d4.rsTime, d4.rsTotal]).toEqual([115, null, null, null]);
  });
});

describe('matrix of lines × days', () => {
  const lines = [
    { line: '1', name: 'Line 1', ok: true, models: [{ mmId: 1, model: 'A', company: 'X', qty: 1150 }], daily: [{ d: '2026-10-20', q: 575, rej: 3 }, { d: '2026-10-21', q: 575, rej: 0 }],
      dhm: [...dhmDay('2026-10-20'), ...dhmDay('2026-10-21'), ['2026-10-22', 10, 1, 4]] },
    { line: '2', name: 'Line 2', ok: true, models: [{ mmId: 7, model: 'Z', company: 'Y', qty: 600 }], daily: [], dhm: dhmDay('2026-10-21', 50, 7) },
  ];
  const st = { 1: settings, 2: { shift: SHIFT, targets: {}, money } };
  const mx = lossMatrix(lines, st, { now: new Date('2026-10-27T12:00:00') });
  it('days newest first, per line and totals', () => {
    expect(mx.days).toEqual(['2026-10-22', '2026-10-21', '2026-10-20']);
    expect(Math.round(mx.lines[0].days['2026-10-20'].rsTotal)).toBe(18400);
    expect(mx.lines[0].days['2026-10-20'].rej).toBe(3);
    expect(Math.round(mx.lines[0].total.rsTotal)).toBe(36800);
    expect(mx.lines[1].total.rsTotal).toBe(null);           // line 2 has no targets
    expect(Math.round(mx.dayTotal['2026-10-21'].rsTotal)).toBe(18400);
    expect(Math.round(mx.grand.short)).toBe(230);
  });
  it('a day with almost no output is shown but not counted', () => {
    expect(mx.lines[0].days['2026-10-22'].skipped).toBe(true);
    expect(mx.lines[0].total.days).toBe(2);
  });
  it('today in the period without a scan yet: the time so far is lost', () => {
    const m2 = lossMatrix(lines, st, { now: new Date('2026-10-23T11:00:00'), range: { start: '2026-10-20', end: '2026-10-23' } });
    const t = m2.lines[0].days['2026-10-23'];
    expect(Math.round(t.target)).toBe(120);                  // 09:00–11:00 at 60/hr
    expect(t.actual).toBe(0);
  });
  it('sum and missing targets', () => {
    expect(sumLoss([]).rsTotal).toBe(null);
    expect(missingTargets(lines, st)).toEqual([{ line: '2', mmId: 7, model: 'Z', company: 'Y', qty: 600 }]);
  });
});
