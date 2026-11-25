import { describe, it, expect } from 'vitest';
import { gridFromRows, gridEntries, gridProblems } from '../src/utils/reworkGrid';

// 25-11-2026: Quality entry → rework of all hours in one grid, model-wise
const rows = [
  { hour: 9, qty: 150, e: { rejects: [{ station: 'FQC', model: 'A', reason: 'Dirty', dept: 'Prod', qty: 1 }], rework: [{ station: 'Leak test', model: 'A', reason: 'Tub leak', dept: 'Prod', qty: 2, dismantle: 2 }], note: 'n9' } },
  { hour: 10, qty: 160, e: { rejects: [], rework: [{ station: 'Leak test', model: 'A', reason: 'Tub leak', dept: 'Prod', qty: 3, dismantle: 3 }, { station: 'FQC', model: 'B', reason: 'Dirty', dept: 'Prod', qty: 1, cause: 'dust' }], note: '' } },
  { hour: 11, qty: 140, e: { rejects: [], rework: [], note: '', noQ: true } },
];
describe('rework grid of the day', () => {
  it('one row per model · station · defect, the hours side by side', () => {
    const g = gridFromRows(rows);
    expect(g.length).toBe(2);
    expect(g[0].q).toEqual({ 9: 2, 10: 3 });
    expect(g[0].disAll).toBe(true);
    expect(g[1].cause).toBe('dust');
  });
  it('nothing changed → nothing to save', () => {
    expect(gridEntries({ grid: gridFromRows(rows), rows, hours: [9, 10, 11], date: '2026-11-25', line: '1' })).toEqual([]);
  });
  it('only the changed hours are saved; rejection, note and other rows of the hour stay', () => {
    const g = gridFromRows(rows);
    g[0].q[11] = '4';          // new pieces at 11
    g[1].q[10] = '';           // B taken out at 10
    const out = gridEntries({ grid: g, rows, hours: [9, 10, 11], date: '2026-11-25', line: '1' });
    expect(out.map((e) => e.hour)).toEqual([10, 11]);
    const e10 = out[0];
    expect(e10.rework).toEqual([{ station: 'Leak test', model: 'A', reason: 'Tub leak', dept: 'Prod', qty: 3, dismantle: 3 }]);
    expect(e10.part).toBe('quality');
    const e11 = out[1];
    expect(e11.rework[0]).toMatchObject({ qty: 4, dismantle: 4 });
    expect(e11.noQ).toBeUndefined();   // "No defects" goes once rework is written
  });
  it('a saved row keeps its department; a changed defect takes the new one', () => {
    const g = gridFromRows(rows);
    const deptOf = () => 'Quality';
    expect(gridEntries({ grid: g, rows, hours: [9, 10, 11], date: '2026-11-25', line: '1', deptOf })).toEqual([]);
    g[1].reason = 'Manual miss';
    const out = gridEntries({ grid: g, rows, hours: [9, 10, 11], date: '2026-11-25', line: '1', deptOf });
    expect(out.map((e) => e.hour)).toEqual([10]);
    expect(out[0].rework.find((x) => x.reason === 'Manual miss').dept).toBe('Quality');
  });
  it('rejection and note of an hour are sent back as they were', () => {
    const g = gridFromRows(rows); g[0].q[9] = '5';
    const [e9] = gridEntries({ grid: g, rows, hours: [9, 10, 11], date: '2026-11-25', line: '1' });
    expect(e9.rejects).toEqual(rows[0].e.rejects);
    expect(e9.note).toBe('n9');
  });
  it('a row with pieces needs station and defect; not more than the hour made', () => {
    const g = [{ id: 'x', model: 'A', station: '', reason: '', q: { 9: '200' }, dis: {} }];
    const p = gridProblems(g, { 9: 150 });
    expect(p.map((x) => x.text)).toEqual(['Row 1: choose the stage', 'Row 1: choose the defect', 'Row 1, 09:00 — 200 pcs, the hour made only 150']);
  });
});

import { rcaHint, rcaSuggest } from '../src/utils/rcaBook';
describe('dismantled: some of the pieces', () => {
  it('a number for the row: saved hours kept, the rest from the first hours', async () => {
    const { disOf } = await import('../src/utils/reworkGrid');
    expect(disOf({ q: { 9: 2, 10: 3 }, dis: {}, disN: '3' })).toEqual({ 9: 2, 10: 1 });
    expect(disOf({ q: { 9: 2, 10: 3 }, dis: { 10: 2 }, disN: '2' })).toEqual({ 10: 2 });
    expect(disOf({ q: { 9: 2, 10: 3 }, dis: { 10: 2 }, disN: '1' })).toEqual({ 10: 1 });
    expect(disOf({ q: { 9: 2, 10: 3 }, dis: {}, disAll: true })).toEqual({ 9: 2, 10: 3 });
    expect(disOf({ q: { 9: 2 }, dis: {}, disN: '' })).toEqual({});
  });
  it('saved with the hour; not more than the row', () => {
    const g = gridFromRows(rows); g[1].disN = '1';
    const out = gridEntries({ grid: g, rows, hours: [9, 10, 11], date: '2026-11-25', line: '1' });
    expect(out[0].rework.find((x) => x.model === 'B').dismantle).toBe(1);
    expect(gridProblems([{ id: 'x', model: 'A', station: 'FQC', reason: 'Dirty', q: { 9: '2' }, dis: {}, disN: '5' }]).map((p) => p.text)).toEqual(['Row 1: 5 dismantled — the row has only 2 pcs']);
  });
});

describe('rejection grid of the day (same grid, the other kind)', () => {
  it('rejection rows grouped; a change keeps the rework of the hour', () => {
    const g = gridFromRows(rows, 'rejects');
    expect(g.length).toBe(1);
    expect(g[0].q).toEqual({ 9: 1 });
    g[0].q[10] = '2';
    const out = gridEntries({ grid: g, rows, hours: [9, 10, 11], date: '2026-11-25', line: '1', key: 'rejects' });
    expect(out.map((e) => e.hour)).toEqual([10]);
    expect(out[0].rejects[0]).toMatchObject({ station: 'FQC', model: 'A', reason: 'Dirty', qty: 2 });
    expect(out[0].rework).toEqual(rows[1].e.rework);
  });
});

describe('root cause / action suggestions (Quality MIS)', () => {
  it('a defect of the plant sheet has its causes and actions, most written first', () => {
    const h = rcaHint('Pulsator touching');
    expect(h.c[0]).toBe('CASCADE FLASH');
    expect(h.a.length).toBeGreaterThan(0);
  });
  it('leakage / leak and other spellings find the same defect', () => {
    expect(rcaHint('Seal bellow leakage').c.length).toBeGreaterThan(0);
  });
  it('today\'s own text first, then the book, no repeats', () => {
    const s = rcaSuggest('Pulsator touching', 'cause', [{ reason: 'Pulsator touching', cause: 'Fixture loose' }, { reason: 'Dirty', cause: 'cascade flash' }]);
    expect(s[0]).toBe('Fixture loose');
    expect(s.filter((x) => x.toLowerCase() === 'cascade flash').length).toBe(1);
  });
});
