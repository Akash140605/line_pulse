// 20-11-2026: RCA action effectiveness (utils/rcaEffect.js)
import { describe, it, expect } from 'vitest';
import { rcaEffect, actionDate, effectTotals, addDaysYmd } from '../src/utils/rcaEffect';

// Line 1 works every day 01-11 … 30-11; "Breakdown" 30 min a day; after the action on 10-11: 30 min (not effective)
// "Power cut" 20 min a day; after the action on 10-11: 0 (effective); "Material shortage" action on 28-11 (too early)
const entries = {};
for (let d = 1; d <= 30; d++) {
  const date = `2026-11-${String(d).padStart(2, '0')}`;
  entries[`${date}|1|10`] = { losses: [{ reason: 'Breakdown', dept: 'Maint', min: 30 }, ...(d <= 10 ? [{ reason: 'Power cut', dept: 'Utility', min: 20 }] : []), { reason: 'Material shortage', dept: 'Stores', min: 10 }],
    rework: d >= 20 ? [{ station: 'HVIR', reason: 'No power', qty: 2 }] : [] };
  entries[`${date}|2|10`] = { noLoss: true, stops: [{ reason: 'Tea break', min: 15 }] };
}
const rca = {
  '2026-11-08|1|loss|Breakdown': { action: 'Belt changed', status: 'closed', closeDate: '2026-11-10' },
  '2026-11-12|1|loss|Breakdown': { action: 'Belt changed again', status: 'closed', closeDate: '2026-11-14' },
  '2026-11-09|1|loss|Power cut': { action: 'UPS fitted', status: 'closed', closeDate: '2026-11-10' },
  '2026-11-27|1|loss|Material shortage': { action: 'Kanban', status: 'submitted', updatedAt: '2026-11-28 10:00:00' },
  '2026-11-05|1|loss|Minor stops': { rootCause: 'x', status: 'submitted' },   // no action written: not checked
  '2026-11-05|1|stop|Tea break': { action: 'n/a', status: 'closed', closeDate: '2026-11-06' },   // planned stop: left out
  '2026-11-18|1|rework|No power': { action: 'Cord checked', status: 'closed', closeDate: '2026-11-19' },
};
const R = rcaEffect({ entries, rca, start: '2026-11-01', end: '2026-11-30', win: 7 });
const by = Object.fromEntries(R.map((r) => [r.reason, r]));

describe('rca action effectiveness', () => {
  it('action date: close date when closed, else the day it was written', () => {
    expect(actionDate({ action: 'x', status: 'closed', closeDate: '2026-11-10' })).toBe('2026-11-10');
    expect(actionDate({ action: 'x', status: 'submitted', updatedAt: '2026-11-28 10:00:00' })).toBe('2026-11-28');
    expect(actionDate({ action: '  ', status: 'closed', closeDate: '2026-11-10' })).toBe(null);
  });
  it('not effective: 2 actions, loss per day the same before and after', () => {
    const b = by.Breakdown;
    expect(b.nActions).toBe(2); expect(b.first).toBe('2026-11-10'); expect(b.last).toBe('2026-11-14');
    expect(b.before).toBe(30); expect(b.after).toBe(30); expect(b.change).toBe(0);
    expect(b.status).toBe('not'); expect(b.repeats).toBe(16);
  });
  it('effective: nothing after the action', () => {
    expect(by['Power cut'].before).toBe(20); expect(by['Power cut'].after).toBe(0); expect(by['Power cut'].status).toBe('effective');
  });
  it('too early: fewer than 3 working days after the action', () => { expect(by['Material shortage'].status).toBe('early'); });
  it('came back: nothing before the action, loss after', () => { expect(by['No power'].status).toBe('new'); expect(by['No power'].unit).toBe('pcs'); });
  it('reasons without an action and planned stops are left out; not effective first', () => {
    expect(by['Minor stops']).toBeUndefined(); expect(by['Tea break']).toBeUndefined();
    expect(R[0].reason).toBe('Breakdown');
    expect(effectTotals(R)).toEqual({ not: 1, new: 1, partly: 0, early: 1, effective: 1 });
  });
  it('by line keeps the lines apart; lines filter', () => {
    expect(rcaEffect({ entries, rca, start: '2026-11-01', end: '2026-11-30', byLine: true })[0].key).toMatch(/\|1$/);
    expect(rcaEffect({ entries, rca, start: '2026-11-01', end: '2026-11-30', ids: ['2'] })).toEqual([]);
    expect(addDaysYmd('2026-11-30', 1)).toBe('2026-12-01');
  });
});
