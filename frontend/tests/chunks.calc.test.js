// Pieces of a period for the OLE screens (src/api.js oleChunks): finished days in fixed calendar pieces, today alone.
import { describe, it, expect } from 'vitest';
import { oleChunks, periodChunks } from '../src/api';

const daysOf = (parts) => parts.flatMap(([s, e]) => { const o = []; for (let d = new Date(`${s}T00:00:00Z`); d <= new Date(`${e}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) o.push(d.toISOString().slice(0, 10)); return o; });

describe('oleChunks', () => {
  it('month up to today: whole weeks of the calendar, the rest day by day, today alone', () => {
    expect(oleChunks('2026-11-01', '2026-11-17', '2026-11-17')).toEqual([['2026-11-01', '2026-11-07'], ['2026-11-08', '2026-11-14'], ['2026-11-15', '2026-11-15'], ['2026-11-16', '2026-11-16'], ['2026-11-17', '2026-11-17']]);
  });
  it('tomorrow asks the same pieces again plus yesterday', () => {
    const a = oleChunks('2026-11-01', '2026-11-17', '2026-11-17');
    const b = oleChunks('2026-11-01', '2026-11-18', '2026-11-18');
    expect(b.slice(0, 4)).toEqual(a.slice(0, 4));
    expect(b[4]).toEqual(['2026-11-17', '2026-11-17']);
  });
  it('a finished month: 1–7, 8–14, 15–21, 22–28, 29–end', () => {
    expect(oleChunks('2026-10-01', '2026-10-31', '2026-11-17')).toEqual([['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-14'], ['2026-10-15', '2026-10-21'], ['2026-10-22', '2026-10-28'], ['2026-10-29', '2026-10-31']]);
    expect(oleChunks('2026-02-01', '2026-02-28', '2026-11-17').pop()).toEqual(['2026-02-22', '2026-02-28']);
  });
  it('a period starting mid-week: day by day up to the next whole week', () => {
    expect(oleChunks('2026-10-12', '2026-10-31', '2026-11-17').slice(0, 4)).toEqual([['2026-10-12', '2026-10-12'], ['2026-10-13', '2026-10-13'], ['2026-10-14', '2026-10-14'], ['2026-10-15', '2026-10-21']]);
  });
  it('every day once, over a month end and a year', () => {
    const d1 = daysOf(oleChunks('2026-10-20', '2026-11-17', '2026-11-17'));
    expect(d1.length).toBe(29); expect(new Set(d1).size).toBe(29);
    const d2 = daysOf(oleChunks('2026-01-01', '2026-11-17', '2026-11-17'));
    expect(d2.length).toBe(321); expect(new Set(d2).size).toBe(321);
  });
  it('today only, or no today known', () => {
    expect(oleChunks('2026-11-17', '2026-11-17', '2026-11-17')).toEqual([['2026-11-17', '2026-11-17']]);
    expect(oleChunks('2026-11-01', '2026-11-17', '')).toEqual(periodChunks('2026-11-01', '2026-11-17'));
  });
});

describe('oleChunks — long period (Monthly OLE, 19-11-2026)', () => {
  it('a finished whole month is one piece when the period is longer than two months', () => {
    const p = oleChunks('2026-01-01', '2026-12-31', '2026-11-19');
    expect(p.slice(0, 2)).toEqual([['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-02-28']]);
    expect(p.some(([a, b]) => a === '2026-10-01' && b === '2026-10-31')).toBe(true);
    expect(p.some(([a, b]) => a === '2026-11-01' && b === '2026-11-07')).toBe(true);
    expect(p[p.length - 1]).toEqual(['2026-11-19', '2026-12-31']);
    expect(p.length).toBeLessThan(20);
  });
  it('every day of the year is in exactly one piece', () => {
    const p = oleChunks('2026-01-01', '2026-12-31', '2026-11-19');
    const days = new Set(); let n = 0;
    for (const [s, e] of p) for (let d = new Date(s); d <= new Date(e); d.setDate(d.getDate() + 1)) { days.add(d.toDateString()); n += 1; }
    expect(n).toBe(365); expect(days.size).toBe(365);
  });
});
