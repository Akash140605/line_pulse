import { describe, it, expect } from 'vitest';
import { loopOf, loopRows, loopTotals, amountsByIssue, issuesFromEntries, escOf } from '../src/utils/capaLoop';

const E = (rw) => ({ rework: rw.map(([reason, qty]) => ({ reason, qty, station: 'FQC', model: 'M1' })) });
const entries = {
  '2026-11-24|1|10': E([['Screw miss', 4]]),
  '2026-11-25|1|11': E([['Screw miss', 2]]),
  '2026-11-30|1|09': E([['Screw miss', 1]]),
};
const A = amountsByIssue(entries);
const i = { date: '2026-11-25', line: '1', kind: 'rework', reason: 'Screw miss' };

describe('CAPA loop of the assembly line', () => {
  it('no CAPA → write, due the next day; late days give the escalation', () => {
    const r = loopOf(i, null, A, '2026-11-26');
    expect(r.stage).toBe('write'); expect(r.due).toBe('2026-11-26'); expect(r.late).toBe(0); expect(r.esc).toBe(0);
    expect(loopOf(i, null, A, '2026-11-29').late).toBe(3);
    expect(loopOf(i, null, A, '2026-11-29').esc).toBe(2);
    expect([escOf(1), escOf(2), escOf(3), escOf(6), escOf(7)]).toEqual([1, 1, 2, 2, 3]);
  });
  it('written, not done → action due on the target date', () => {
    const r = loopOf(i, { rootCause: 'x', status: 'submitted', targetDate: '2026-11-28' }, A, '2026-11-27');
    expect(r.stage).toBe('action'); expect(r.due).toBe('2026-11-28'); expect(r.left).toBe(1);
  });
  it('done → verify within 7 days, with the amount after the action', () => {
    const r = loopOf(i, { rootCause: 'x', status: 'closed', closeDate: '2026-11-26' }, A, '2026-11-30');
    expect(r.stage).toBe('verify'); expect(r.due).toBe('2026-12-03'); expect(r.after).toBe(1); expect(r.before).toBe(6);
  });
  it('not effective → redo; effective → watch 30 days, came back → back; quiet 30 days → closed', () => {
    expect(loopOf(i, { rootCause: 'x', status: 'submitted', capa: { implemented: 'no', verifyDate: '2026-11-27' } }, A, '2026-11-27').stage).toBe('redo');
    const ok = { rootCause: 'x', status: 'closed', closeDate: '2026-11-26', capa: { implemented: 'yes', verifyDate: '2026-11-27' } };
    expect(loopOf(i, ok, A, '2026-11-29').stage).toBe('watch');
    const b = loopOf(i, ok, A, '2026-12-01');
    expect(b.stage).toBe('back'); expect(b.backOn).toBe('2026-11-30'); expect(b.backQty).toBe(1);
    expect(loopOf(i, ok, amountsByIssue({}), '2027-01-05').stage).toBe('closed');
  });
  it('issues from the entries; rows sorted open + late first; totals', () => {
    const is = issuesFromEntries(entries);
    expect(is.length).toBe(3);
    const rows = loopRows(is, {}, entries, '2026-12-01');
    expect(rows[0].date).toBe('2026-11-24');
    const T = loopTotals(rows);
    expect(T.st.write).toBe(3); expect(T.open).toBe(3); expect(T.late).toBe(2);
  });
});
