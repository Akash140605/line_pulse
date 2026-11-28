import { describe, it, expect } from 'vitest';
import { parseMis, planImport, parseDate, parseLine, sentence } from '../src/utils/reworkImport';

const HEAD = ['SR. NO.', 'DATE', 'Stage', 'Line', 'BRAND', 'MODEL', 'Category', 'Department', 'DEFECT DESCRIPTION', 'ROOT CAUSE', 'ACTION', 'Total', '09-10', '10-11', '11-12', 'INR (Rs)'];
const rows = [
  ['Line Rejection'], HEAD,
  ['1', '1-Nov-26', 'FUNCTIONAL', 'Line-1 C8', 'VOLTAS', 'WTT14UEA', 'MOULDING', 'MOULDING QA', 'PULSATOR TOUCHING', 'CASCADE FLASH', 'FLASH REMOVED', '3', '2', '1', '', '165'],
  ['2', '1-Nov-26', 'FRONT INSPECTION', 'Line-1 C8', 'VOLTAS', 'WTT14UEA', 'PROCESS', 'Prod', 'TUB LOCK BROKEN', 'HANDLING ISSUE', 'DISMENTAL', '2', '1', '1', '', '110'],
  ['3', '2-Nov-26', 'FUNCTIONAL', 'Line-3 C3', 'SAMSUNG', 'WT80', 'PART', 'IQC', 'GEAR BOX NOISE', 'PART ISSUE', 'CHANGE', '1', '', '', '1', '55'],
  ['4', '2-Nov-26', 'FUNCTIONAL', 'Line-2 C8', 'SAMSUNG', 'WT80', 'PART', 'IQC', 'NO HOURS', 'X', 'Y', '1', '', '', '', '55'],
];

describe('rework sheet (MIS) import', () => {
  it('reads dates, lines and words', () => {
    expect(parseDate('1-Nov-26')).toBe('2026-11-01'); expect(parseDate('27-11-2026')).toBe('2026-11-27'); expect(parseDate('2026-11-05')).toBe('2026-11-05');
    expect(parseLine('Line-4 C2')).toBe('4'); expect(sentence('PULSATOR TOUCHING')).toBe('Pulsator touching'); expect(sentence('Base change')).toBe('Base change');
  });
  it('one item per sheet row with its hours; a row without pieces is reported', () => {
    const { items, bad } = parseMis(rows);
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ date: '2026-11-01', line: '1', stage: 'FUNCTIONAL', defect: 'Pulsator touching', cause: 'Cascade flash', total: 3, hours: { 9: 2, 10: 1 }, dism: false });
    expect(items[1].dism).toBe(true);
    expect(items[0].dept).toBe('Moulding QA');
    expect(bad.length).toBe(1);
  });
  it('fills only the days without rework; keeps the rejection and note of the hour; dismantle = the pieces', () => {
    const { items } = parseMis(rows);
    const ent = { '2026-11-02|3|5': { rework: [{ reason: 'Old', qty: 1 }] }, '2026-11-01|1|9': { rejects: [{ reason: 'R', qty: 2 }], rework: [], note: 'n' } };
    const p = planImport(items, ent);
    expect(p.days.map((d) => [d.date, d.line, d.skip])).toEqual([['2026-11-01', '1', false], ['2026-11-02', '3', true]]);
    const h9 = p.save.find((e) => e.hour === 9);
    expect(h9.part).toBe('quality'); expect(h9.rejects.length).toBe(1); expect(h9.note).toBe('n');
    expect(h9.rework.length).toBe(2);
    expect(h9.rework[0]).toMatchObject({ station: 'FUNCTIONAL', reason: 'Pulsator touching', qty: 2 });
    expect(h9.rework[1]).toMatchObject({ station: 'FRONT INSPECTION', reason: 'Tub lock broken', qty: 1, dismantle: 1 });
    expect(p.save.length).toBe(2);   // hours 9 and 10 of 1-Nov line 1 (2-Nov line 3 already has rework)
  });
});
