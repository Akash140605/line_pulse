// 23-11-2026: writes an HPR workbook with hand-checked numbers to /tmp/hpr_formula_check.xlsx; the test
// tools/check_hpr_xlsx.py recalculates it in LibreOffice and compares the Excel formulas with these numbers.
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hprHours, buildHprSheets } from '../src/utils/hpr';
import { buildXlsx } from '../src/utils/xlsxWriter';

const MASTER = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [] };
const T = { 1: { cycle: 20 }, 2: { cycle: 30 } };
const row = (hour) => ({ hour, qty: 100, models: [{ mmId: 1, model: 'A', quantity: 60 }, { mmId: 2, model: 'B', quantity: 40 }], entry: null });
describe('HPR Excel with hand-worked targets', () => {
  const H = hprHours({ rows: [row(10), row(13)], shift: MASTER, targets: T, date: '2026-11-23', line: '1' });
  it('the screen numbers: 10–11 → 90 + 60 = 150; 13:30–14 → 45 + 30 = 75', () => {
    expect(H.find((h) => h.hour === 10).models.map((m) => m.target)).toEqual([90, 60]);
    expect(H.find((h) => h.hour === 13).models.map((m) => m.target)).toEqual([45, 30]);
  });
  it('workbook written for the LibreOffice recalculation', () => {
    const sheets = buildHprSheets([{ date: '2026-11-23', lines: [{ line: '1', mp: 50, fromEntry: true, shift: MASTER, hours: H }] }], { rate: 65, otFrom: '18:00', otX: 2 });
    writeFileSync(join(tmpdir(), 'hpr_formula_check.xlsx'), buildXlsx(sheets));
    expect(sheets.length).toBe(1);
  });
});

// 24-11-2026: the extra hours outside the shift (08-09, 21-22 at night) have no target: blank Tgt / Gap / I/T / %, its pieces stay out of the %
describe('HPR: no target before the shift', () => {
  const rows = [{ hour: 8, qty: 20, extra: true, models: [{ mmId: 1, model: 'A', quantity: 20 }], entry: null }, row(10),
    { hour: 21, qty: 15, extra: true, models: [{ mmId: 2, model: 'B', quantity: 15 }], entry: null }];
  const H = hprHours({ rows, shift: MASTER, targets: T, date: '2026-11-24', line: '1' });
  it('08-09: no target, pieces kept', () => {
    const e = H.find((h) => h.hour === 8);
    expect(e.target).toBe(null); expect(e.qty).toBe(20); expect(e.models[0].target).toBe(null);
    const n = H.find((h) => h.hour === 21);   // 21-22 at night after a 21:00 end: no target either
    expect(n.target).toBe(null); expect(n.qty).toBe(15);
  });
  it('the sheet: blank cells in 08-09, line % = 100 ÷ 150 (not 135 ÷ 150)', () => {
    const sheets = buildHprSheets([{ date: '2026-11-24', lines: [{ line: '1', mp: 50, fromEntry: true, shift: MASTER, hours: H }] }], { rate: 65 });
    writeFileSync(join(tmpdir(), 'hpr_early.xlsx'), buildXlsx(sheets));
    const rowsOut = sheets[0].rows;
    const r8 = rowsOut.find((r) => r && r[3]?.v === '08:00-09:00');
    expect(r8[5]?.v ?? '').toBe('');
    expect(r8[7].v).toBe(20);
    expect([r8[8]?.v, r8[9]?.v, r8[10]?.v]).toEqual(['', '', '']);
    const tot = rowsOut.find((r) => r && r[4]?.v === 'TTL');
    expect(tot[5].v).toBe(150); expect(tot[6].v).toBe(135); expect(tot[8].v).toBe(-50);
    const r21 = rowsOut.find((r) => r && r[3]?.v === '21:00-22:00');
    expect(r21[5]?.v ?? '').toBe(''); expect([r21[8]?.v, r21[9]?.v, r21[10]?.v]).toEqual(['', '', '']);
    expect(tot[10].v).toBeCloseTo(100 / 150, 6);
  });
});

