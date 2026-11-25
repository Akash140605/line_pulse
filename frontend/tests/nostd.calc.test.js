// 21-11-2026: reports — a model with no std cycle takes the line's average of the day (HPR 20:00 showed Tgt 5 vs 171 pcs)
import { describe, it, expect } from 'vitest';
import { fillNoStd, hprHours } from '../src/utils/hpr';

const targets = { 1: { cycle: 20 }, 2: { cycle: 20 } };
const rows = [
  { hour: 19, qty: 117, models: [{ mmId: 3, model: 'WS EDGE UNO 100 5.0 TB4 MIGR', quantity: 36 }, { mmId: 2, model: 'WT11A4260GD', quantity: 81 }], e: null },
  { hour: 20, qty: 176, models: [{ mmId: 1, model: 'WTT90UDX/GTD', quantity: 1 }, { mmId: 3, model: 'WS EDGE UNO 100 5.0 TB4 MIGR', quantity: 171 }, { mmId: 2, model: 'WT11A4260GD', quantity: 4 }], e: null },
];
describe('model without a std cycle in the reports', () => {
  it('gets the line average of the day, marked noStd', () => {
    const f = fillNoStd(targets, rows);
    expect(f.avg).toBe(20);
    expect(f.noStd).toEqual(['WS EDGE UNO 100 5.0 TB4 MIGR']);
    expect(f.targets[3]).toMatchObject({ cycle: 20, noStd: true });
  });
  it('HPR: the 20:00 hour has a full-hour target and the model gets its own share', () => {
    const H = hprHours({ rows, shift: { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' }, targets, date: '2026-11-01', line: '1' });
    const h20 = H.find((h) => h.hour === 20);
    expect(h20.target).toBeGreaterThan(150);
    const ws = h20.models.find((m) => m.model.startsWith('WS EDGE'));
    expect(ws.target).toBeGreaterThan(140);
    expect(ws.noStd).toBe(true);
  });
  it('a day where no model has a std cycle: nothing filled', () => {
    expect(fillNoStd({}, rows).avg).toBe(null);
  });
});

describe('reports end at the last scan (21-11-2026)', () => {
  // Line 3, 20-11: the line stopped in the 17:00 hour; 18, 19, 20 made nothing
  const T = { 7: { cycle: 20 }, 8: { cycle: 20 } };
  const rows = [16, 17, 18, 19, 20].map((h) => ({ hour: h, qty: h === 16 ? 169 : h === 17 ? 77 : 0, afterLast: h > 17, models: h === 16 ? [{ mmId: 7, model: 'WT80C4200GG', quantity: 169 }] : h === 17 ? [{ mmId: 8, model: 'WT80C4000RR', quantity: 55 }, { mmId: 7, model: 'WT80C4200GG', quantity: 22 }] : [], e: null }));
  rows.unshift({ hour: 8, qty: 5, extra: true, models: [{ mmId: 7, model: 'WT80C4200GG', quantity: 5 }], e: null });
  it('HPR: no hour after the last scan; the hour before the shift (08-09) has no target (24-11-2026)', () => {
    const H = hprHours({ rows, shift: { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' }, targets: T, date: '2026-11-20', line: '3' });
    expect(H.map((h) => h.hour)).toEqual([8, 16, 17]);
    expect(H[0].target).toBe(null);
    expect(H[0].early).toBe(true);
    expect(H[0].models.every((m) => m.target == null)).toBe(true);
  });
});

describe('HPR: the last hour ends at the last scan (21-11-2026)', () => {
  it('a line that stopped at 17:31 gets about half of the 17:00 target', () => {
    const T = { 7: { cycle: 20 } };
    const rows = [16, 17].map((h) => ({ hour: h, qty: h === 16 ? 169 : 77, models: [{ mmId: 7, model: 'WT80C4200GG', quantity: h === 16 ? 169 : 77 }], e: null }));
    const sh = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
    const full = hprHours({ rows, shift: sh, targets: T, date: '2026-11-20', line: '3' });
    const cut = hprHours({ rows, shift: sh, targets: T, date: '2026-11-20', line: '3', lastMin: 17 * 60 + 31 });
    expect(full[1].target).toBe(180);
    expect(cut[1].target).toBe(93);
    expect(cut[1].workMin).toBe(31);
    expect(cut[0].target).toBe(180);
  });
});
