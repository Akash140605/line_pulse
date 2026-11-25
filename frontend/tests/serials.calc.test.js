// 23-11-2026: carton & serial report — merge of new scans, totals, by model, search, duplicates, Excel sheets
import { describe, it, expect } from 'vitest';
import { mergeRows, duplicateSerials, byModel, totals, filterRows, byHour, serialSheets } from '../src/utils/serials';

const R = (line, id, at, mmId, model, serial, carton, extra = {}) => ({ line, id, at: `2026-11-22 ${at}`, mmId, model, code: `C${mmId}`, company: 'VOLTAS', serial, carton, component: '', ...extra });
const rows = [
  R('1', 10, '09:00:05', 7, 'WT70', 'SN001', 'CT01'),
  R('1', 11, '09:00:20', 7, 'WT70', 'SN002', 'CT01'),
  R('1', 12, '10:05:00', 8, 'WT80', 'SN003', ''),
  R('2', 10, '09:30:00', 7, 'WT70', 'SN001', 'CT09'),   // same serial on Line 2: a duplicate
];

describe('serial & carton report', () => {
  it('new scans are added once (same id of the same line not twice; same id of another line is another piece)', () => {
    const a = mergeRows([], rows.slice(0, 2));
    const b = mergeRows(a, [rows[1], rows[2], rows[3]]);
    expect(b.map((r) => `${r.line}|${r.id}`)).toEqual(['1|10', '1|11', '1|12', '2|10']);
    expect(mergeRows(b, [])).toBe(b);
  });
  it('totals: pieces, different serials and cartons, models, last scan, duplicates', () => {
    const t = totals(rows);
    expect([t.qty, t.serials, t.cartons, t.models, t.last.id, t.last.line, t.dup]).toEqual([4, 3, 2, 3, 12, '1', 1]);
    expect(duplicateSerials(rows).get('SN001')).toBe(2);
  });
  it('by model: per line, pieces, cartons, first / last serial, pieces without a carton', () => {
    const m = byModel(rows);
    expect(m.map((o) => [o.line, o.model, o.qty, o.cartons, o.noCarton, o.first.serial, o.last.serial])).toEqual([
      ['1', 'WT70', 2, 1, 0, 'SN001', 'SN002'], ['1', 'WT80', 1, 0, 1, 'SN003', 'SN003'], ['2', 'WT70', 1, 1, 0, 'SN001', 'SN001']]);
  });
  it('search any part of serial / carton / model, model filter; newest first', () => {
    expect(filterRows(rows, { q: 'ct0' }).map((r) => r.id)).toEqual([10, 11, 10]);
    expect(filterRows(rows, { q: 'sn003' }).map((r) => r.serial)).toEqual(['SN003']);
    expect(filterRows(rows, { model: '1|7' }).map((r) => r.serial)).toEqual(['SN002', 'SN001']);
    expect(filterRows(rows).map((r) => r.at.slice(11))).toEqual(['10:05:00', '09:30:00', '09:00:20', '09:00:05']);
  });
  it('pieces per hour, line by line', () => {
    expect(byHour(rows)).toEqual({ 9: { 1: 2, 2: 1 }, 10: { 1: 1 } });
  });
  it('Excel: one row per piece (line, then time), barcodes as text, duplicates marked; By model with a total', () => {
    const [s1, s2] = serialSheets(rows, { date: '22-11-2026', lineLabel: 'All lines' });
    expect(s1.rows.length).toBe(5);
    expect(s1.rows[1].map((c) => c.v)).toEqual([1, 'Line 1', '2026-11-22', '09:00:05', 'VOLTAS', 'WT70', 'C7', 'SN001', 'CT01', '', 'Yes (2×)']);
    expect(s1.rows[4][1].v).toBe('Line 2');
    expect(s1.rows.slice(1).every((r) => r[7].s === 'text' && typeof r[7].v === 'string')).toBe(true);
    expect(s1.autoFilter).toBe('A1:K5');
    expect(s2.rows[s2.rows.length - 1].map((c) => c.v).slice(4, 6)).toEqual([4, 2]);
  });
});
