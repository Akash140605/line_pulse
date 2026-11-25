// 20-11-2026: AI analysis from the entries and RCAs (utils/aiInsights.js)
import { describe, it, expect } from 'vitest';
import { entryInsights, insightText } from '../src/utils/aiInsights';
import { setRcaFrom } from '../src/utils/ole';
setRcaFrom('');   // these fixtures are older than the RCA start day (23-11-2026)

const entries = {};
const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;
for (let d = 1; d <= 20; d++) {
  entries[`${day(d)}|1|10`] = { losses: [{ reason: 'Breakdown', dept: 'Maint', min: d >= 14 ? 40 : 20 }, { reason: 'Power cut', dept: 'Utility', min: d >= 14 ? 0 : 15 }],
    rework: [{ station: 'HVIR', reason: 'No power', qty: d >= 14 ? 3 : 1, dismantle: d >= 14 ? 1 : 0 }], rejects: d === 20 ? [{ station: 'FQC', reason: 'Dent', qty: 2 }] : [] };
  entries[`${day(d)}|3|10`] = { losses: [{ reason: 'Breakdown', dept: 'Maint', min: 5 }] };
}
const rca = {
  [`${day(5)}|1|loss|Breakdown`]: { action: 'Belt changed', status: 'closed', closeDate: day(6), rootCause: 'belt' },
  [`${day(18)}|1|loss|Material shortage`]: { status: 'submitted', rootCause: 'x', targetDate: day(19) },   // overdue
  [`${day(19)}|1|loss|Minor stops`]: null,
};
const X = entryInsights({ entries, rca, today: day(20) });

describe('AI insights from the entries', () => {
  it('this week (14–20) vs last week (07–13), per reason, all lines', () => {
    expect(X.week).toEqual({ from: day(14), to: day(20), prevFrom: day(7), prevTo: day(13) });
    const b = X.losses.find((r) => r.reason === 'Breakdown');
    expect(b.now).toBe(7 * 40 + 7 * 5); expect(b.prev).toBe(7 * 20 + 7 * 5); expect(b.lines).toEqual(['1', '3']);
    expect(X.losses.find((r) => r.reason === 'Power cut').now).toBe(0);
    expect(X.rework[0]).toMatchObject({ reason: 'No power', now: 21, prev: 7, dismantle: 7, stations: ['HVIR'] });
    expect(X.totals.reject).toEqual({ now: 2, prev: 0 });
  });
  it('growing: ≥ 30 % up and a real amount', () => {
    expect(X.growing.map((g) => g.reason)).toEqual(['Breakdown', 'No power']);
  });
  it('RCA: action not working, overdue; actions listed', () => {
    expect(X.stuck.map((r) => r.reason)).toEqual(['Breakdown']);
    expect(X.overdue).toBe(1);
    expect(X.actions.map((a) => a.kind)).toEqual(['rca', 'grow', 'grow', 'rca']);
    expect(insightText(X)).toContain('Breakdown');
  });
  it('lines filter', () => {
    const Y = entryInsights({ entries, rca, today: day(20), ids: ['3'] });
    expect(Y.losses.map((r) => r.reason)).toEqual(['Breakdown']); expect(Y.overdue).toBe(0); expect(Y.rework).toEqual([]);
  });
});
