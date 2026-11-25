// 23-11-2026: Entry dashboard — what is filled and what is left
import { describe, it, expect } from 'vitest';
import { hourStatus, lineDayStatus, sumStatus, pendingList, targetMet } from '../src/utils/entryStatus';

const E = (x = {}) => ({ stops: [], losses: [], rejects: [], rework: [], ...x });
const row = (hour, x = {}) => ({ hour, qty: 100, future: false, closed: false, lunch: false, extra: false, afterLast: false, speedMin: 3, lossMin: 0, e: E(), ...x });

describe('hour status', () => {
  it('written loss / quality → done; nothing → pending', () => {
    expect(hourStatus(row(9, { e: E({ losses: [{ min: 5 }], rework: [{ qty: 1 }] }) }))).toEqual({ hour: 9, loss: 'done', quality: 'done' });
    expect(hourStatus(row(10))).toEqual({ hour: 10, loss: 'pending', quality: 'pending' });
  });
  it('No loss / No defects saved → done; 0 minutes lost by the scans → auto', () => {
    expect(hourStatus(row(9, { e: E({ noLoss: true, noQ: true }) }))).toMatchObject({ loss: 'done', quality: 'done' });
    expect(hourStatus(row(9, { speedMin: 0 })).loss).toBe('auto');
  });
  it('future, after last scan, lunch without pieces, extra hour without pieces → not counted', () => {
    expect(hourStatus(row(18, { future: true, qty: 0 })).loss).toBe('future');
    expect(hourStatus(row(17, { afterLast: true, qty: 0 })).loss).toBe('na');
    expect(hourStatus(row(13, { lunch: true, qty: 0 })).loss).toBe('na');
    expect(hourStatus(row(8, { extra: true, qty: 0 })).quality).toBe('na');
  });
  it('an extra hour with pieces needs quality but no loss', () => {
    expect(hourStatus(row(8, { extra: true }))).toMatchObject({ loss: 'na', quality: 'pending' });
  });
  it('today: the running hour is not pending yet', () => {
    expect(hourStatus(row(14), { today: true, nowMin: 14 * 60 + 30 })).toMatchObject({ loss: 'running', quality: 'running' });
    expect(hourStatus(row(13), { today: true, nowMin: 14 * 60 + 30 })).toMatchObject({ loss: 'pending', quality: 'pending' });
  });
});

describe('line-day and totals', () => {
  const L = { line: '2', ok: true, rows: [
    row(9, { e: E({ losses: [{ min: 3 }], noQ: true }) }),   // L done · Q done
    row(10, { speedMin: 0 }),                                // L auto · Q pending
    row(11),                                                  // L pending · Q pending
    row(12, { future: true, qty: 0 }),
  ] };
  const S = lineDayStatus(L, { morning: true });
  it('% complete per part and overall (morning counts as one item)', () => {
    expect([S.loss.done, S.loss.need]).toEqual([2, 3]);
    expect([S.quality.done, S.quality.need]).toEqual([1, 3]);
    expect([S.all.done, S.all.need, S.all.left]).toEqual([4, 7, 3]);
    expect(S.all.pct).toBeCloseTo(4 / 7);
  });
  it('totals of many line-days and the list of what is left', () => {
    const S2 = lineDayStatus({ ...L, line: '3' }, { morning: false });
    const T = sumStatus([S, S2]);
    expect([T.all.done, T.all.need, T.morning.done, T.morning.need]).toEqual([7, 14, 1, 2]);
    const left = pendingList([{ date: '2026-11-23', lines: [S, S2] }]);
    expect(left.map((x) => `${x.line}|${x.hour ?? '-'}|${x.what}`)).toEqual(['2|10|Quality', '2|11|Loss', '2|11|Quality', '3|-|Morning', '3|10|Quality', '3|11|Loss', '3|11|Quality']);
  });
  it('a line that does not answer: only its morning entry counts', () => {
    const X = lineDayStatus({ line: '4', ok: false }, { morning: false });
    expect([X.ok, X.all.need, X.all.done]).toEqual([false, 1, 0]);
  });
});

describe('target achieved → No loss by itself (23-11-2026)', () => {
  it('pieces ≥ target > 0', () => {
    expect(targetMet({ qty: 90 }, 87)).toBe(true);
    expect(targetMet({ qty: 87 }, 87)).toBe(true);
    expect(targetMet({ qty: 86 }, 87)).toBe(false);
    expect(targetMet({ qty: 5 }, null)).toBe(false);
  });
  it('an hour that made its target is auto even when a model lost time', () => {
    expect(hourStatus(row(13, { qty: 90 }), { targets: { 13: 87 }, lost: { 13: 2 } }).loss).toBe('auto');
    expect(hourStatus(row(13, { qty: 80 }), { targets: { 13: 87 }, lost: { 13: 2 } }).loss).toBe('pending');
    expect(hourStatus(row(13, { qty: 90, e: E({ losses: [{ min: 2 }] }) }), { targets: { 13: 87 } }).loss).toBe('done');
  });
});

