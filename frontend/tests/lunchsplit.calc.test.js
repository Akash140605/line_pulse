// Hour detail of an hour with lunch in it (utils/shift.js lunchSplitOf): worked part vs lunch scans, as the Hourly matrix.
import { describe, it, expect } from 'vitest';
import { lunchSplitOf } from '../src/utils/shift';

const shift = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
const sc = (t, mmId) => ({ mmId, scanDate: `2026-11-23 ${t}.000` });
const detail = { hour: 13, totalQuantity: 6, models: [{ mmId: 1, quantity: 4 }, { mmId: 2, quantity: 2 }],
  scans: [sc('13:05:00', 1), sc('13:29:59', 2), sc('13:30:00', 1), sc('13:45:10', 1), sc('13:50:00', 1), sc('13:59:59', 2)] };

describe('hour with lunch', () => {
  it('lunch scans apart, worked part, theoretical cycle over the worked minutes', () => {
    const L = lunchSplitOf(detail, shift);
    expect([L.from, L.to, L.lunchQty, L.workQty, L.workSec]).toEqual(['13:00', '13:30', 2, 4, 1800]);
    expect(L.byModel).toEqual({ 1: { work: 3, lunch: 1 }, 2: { work: 1, lunch: 1 } });
    expect(L.theo).toBe(450);
  });
  it('an hour without lunch in it → null (the drawer stays as it was)', () => {
    expect(lunchSplitOf({ ...detail, hour: 10 }, shift)).toBe(null);
  });
});
