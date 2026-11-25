// Morning entry shift, loss analysis (department / reason Pareto, loss ₹) and the HPR Excel layout (16-11-2026).
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { setupShift, shiftOfDay } from '../src/utils/shift';
import { oleLineDay } from '../src/utils/ole';
import { lossRs, lossAnalysis } from '../src/utils/lossan';
import { hprHours, buildHprSheets, workMinOf, excelDate } from '../src/utils/hpr';
import { buildXlsx, STYLE } from '../src/utils/xlsxWriter';

const MASTER = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [] };
const HPR = { rate: 65, otFrom: '18:00', otX: 2 };

describe('morning entry replaces the shift master for its day', () => {
  const setups = { '2026-10-01|1': { date: '2026-10-01', line: 1, mp: 96, start: '08:30', end: '20:00', lunchStart: '12:30', lunchEnd: '13:00', breaks: [{ name: 'Tea', start: '10:30', end: '10:40' }] } };
  it('entry of the day wins, other days / lines keep the master', () => {
    expect(shiftOfDay(setups, '2026-10-01', '1', MASTER)).toEqual({ start: '08:30', end: '20:00', lunchStart: '12:30', lunchEnd: '13:00', breaks: [{ name: 'Tea', start: '10:30', end: '10:40' }] });
    expect(shiftOfDay(setups, '2026-10-02', '1', MASTER)).toBe(MASTER);
    expect(shiftOfDay(setups, '2026-10-01', '2', MASTER)).toBe(MASTER);
    expect(setupShift(null)).toBe(null);
    expect(setupShift({ mp: 5 })).toBe(null);   // manpower alone does not change the times
  });
  it('working minutes = shift − lunch − tea', () => {
    expect(workMinOf(MASTER)).toBe(690);
    expect(workMinOf(setupShift(setups['2026-10-01|1']))).toBe(11.5 * 60 - 30 - 10);
  });
  it('the OLE day of a line follows the entry (start 08:30: hour 8 has 30 working minutes)', () => {
    const d = oleLineDay({ hours: [], shift: setupShift(setups['2026-10-01|1']) });
    expect(d.rows[0].hour).toBe(8);
    expect(d.rows[0].fullMin).toBe(30);
    expect(d.rows.find((r) => r.hour === 10).fullMin).toBe(50);   // tea 10:30–10:40
  });
});

describe('loss ₹ (HPR formula)', () => {
  it('rate × hours × manpower, × overtime from 18:00', () => {
    expect(lossRs(30, 96, 15, HPR)).toBe(3120);
    expect(lossRs(30, 96, 18, HPR)).toBe(6240);
    expect(lossRs(30, null, 15, HPR)).toBe(null);
    expect(lossRs(60, 10, 9, { rate: 100, otFrom: '17:30', otX: 1.5 })).toBe(1000);
    expect(lossRs(60, 10, 18, { rate: 100, otFrom: '17:30', otX: 1.5 })).toBe(1500);
  });
});

describe('loss analysis: department and reason Pareto', () => {
  const entries = {
    '2026-10-01|1|9': { losses: [{ reason: 'Motor Shortage', dept: 'Kitting Store', min: 20, model: 'WT70' }, { reason: 'Model Change', dept: 'Prod', min: 10 }] },
    '2026-10-01|1|18': { losses: [{ reason: 'Motor Shortage', dept: 'Kitting Store', min: 15, owner: 'Someone Else' }] },
    '2026-10-02|2|11': { losses: [{ reason: 'Barcode / XML scan error', dept: 'IT', min: 40, part: 'Label' }], rejects: [{ reason: 'Scratch', dept: 'Moulding QA', qty: 3, station: 'FQC' }] },
    '2026-10-03|3|11': { losses: [{ reason: 'Model Change', dept: 'Prod', min: 5 }] },
    '2026-09-30|1|11': { losses: [{ reason: 'Model Change', dept: 'Prod', min: 99 }] },   // before the period
  };
  const setups = { '2026-10-01|1': { mp: 96 }, '2026-10-02|2': { mp: 100 } };
  const reasons = { loss: [{ reason: 'Motor Shortage', dept: 'Kitting Store', owner: 'Arvind Pandey' }, { reason: 'Model Change', dept: 'Prod', owner: 'Ajay Kumar' }], stop: [], reject: [], rework: [] };
  const A = lossAnalysis({ entries, start: '2026-10-01', end: '2026-10-31', kind: 'loss', setups, hpr: HPR, reasons });
  it('totals, departments biggest first with cumulative %', () => {
    expect(A.total).toBe(90);
    expect(A.dept.map((d) => [d.name, d.value])).toEqual([['IT', 40], ['Kitting Store', 35], ['Prod', 15]]);
    expect(A.dept.map((d) => Math.round(d.cumPct))).toEqual([44, 83, 100]);
    expect(A.dept[1].lines).toEqual(['1']);
    expect(A.dept[2].lines).toEqual(['1', '3']);
  });
  it('reasons carry dept, owner (row first, else master) and occurrences', () => {
    const ms = A.reason.find((r) => r.name === 'Motor Shortage');
    expect([ms.dept, ms.value, ms.count, ms.days]).toEqual(['Kitting Store', 35, 2, 1]);
    expect(['Arvind Pandey', 'Someone Else']).toContain(ms.owner);
    expect(A.reason.find((r) => r.name === 'Model Change').owner).toBe('Ajay Kumar');
    expect(A.dept.find((d) => d.name === 'Prod').reasons.map((r) => r.name)).toEqual(['Model Change']);
  });
  it('loss ₹ from the morning entry manpower; a line-day without it has no ₹', () => {
    // 20+10 min at 09:00 × 96 + 15 min at 18:00 × 96 × 2 + 40 min × 100
    expect(Math.round(A.rs)).toBe(Math.round(65 * (30 / 60) * 96 + 65 * (15 / 60) * 96 * 2 + 65 * (40 / 60) * 100));
    expect(A.noMpMin).toBe(5);
    expect(A.rows.find((r) => r.line === '3').rs).toBe(null);
  });
  it('line filter and other loss types', () => {
    expect(lossAnalysis({ entries, start: '2026-10-01', end: '2026-10-31', ids: ['2'], kind: 'loss' }).total).toBe(40);
    const R = lossAnalysis({ entries, start: '2026-10-01', end: '2026-10-31', kind: 'reject' });
    expect([R.total, R.unit, R.dept[0].name, R.rs]).toEqual([3, 'pcs', 'Moulding QA', 0]);
  });
  it('old department names (before the HPR list) count under the new ones', () => {
    const X = lossAnalysis({ entries: { '2026-10-05|1|9': { losses: [{ reason: 'Breakdown', dept: 'Maintenance', min: 7 }, { reason: 'Lift / Pick & Lift breakdown', dept: 'Maint', min: 3 }] } }, kind: 'loss' });
    expect(X.dept.map((d) => [d.name, d.value])).toEqual([['Maint', 10]]);
  });
});

describe('HPR layout', () => {
  const targets = { 1: { cycle: 3600 / 187 }, 2: { cycle: 3600 / 187 } };
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => ({
    hour: h, quantity: h === 10 ? 200 : h === 13 ? 94 : 150,
    models: h === 10 ? [{ mmId: 1, model: 'WT70', quantity: 199 }, { mmId: 2, model: 'WT80', quantity: 1 }] : [{ mmId: 1, model: 'WT70', quantity: h === 13 ? 94 : 150 }],
  }));
  const entries = { 9: { losses: [{ reason: 'Barcode / XML scan error', dept: 'IT', owner: 'Pradeep Kumar', min: 10, part: 'Label' }] }, 18: { losses: [{ reason: 'Motor Shortage', dept: 'Kitting Store', min: 6 }, { reason: 'Model Change', dept: 'Prod', min: 2 }] } };
  const day = oleLineDay({ hours, targets, entries, shift: MASTER });
  const rca = { '2026-10-01|1|loss|Barcode / XML scan error': { rootCause: 'Printer driver', action: 'Driver updated', preventive: 'Weekly check', owner: 'Pradeep Kumar', closedBy: 'admin', status: 'closed' } };
  const H = hprHours({ rows: day.rows, shift: MASTER, targets, otFrom: '18:00', date: '2026-10-01', line: '1', rca });
  it('hours: slot labels with lunch, working minutes, plan targets, overtime', () => {
    expect(H.map((h) => h.slot).slice(0, 5)).toEqual(['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:30-14:00']);
    expect(H.find((h) => h.hour === 13).workMin).toBe(30);
    expect(H.find((h) => h.hour === 9).target).toBe(187);
    expect(H.find((h) => h.hour === 13).target).toBe(94);   // half hour (lunch)
    expect(H.filter((h) => h.ot).map((h) => h.hour)).toEqual([18, 19, 20]);
    expect(H.find((h) => h.hour === 10).models.map(({ cycle, ...m }) => m)).toEqual([{ model: 'WT70', qty: 199, target: 186 }, { model: 'WT80', qty: 1, target: 1 }]);   // 20-11-2026: the hour target shared by the models
    expect(H.find((h) => h.hour === 10).models.reduce((a, m) => a + m.target, 0)).toBe(H.find((h) => h.hour === 10).target);
  });
  it('reasons biggest first, with the RCA of that line-day', () => {
    expect(H.find((h) => h.hour === 18).reasons.map((r) => r.reason)).toEqual(['Motor Shortage', 'Model Change']);
    const r9 = H.find((h) => h.hour === 9).reasons[0];
    expect([r9.dept, r9.owner, r9.part, r9.rca?.rootCause]).toEqual(['IT', 'Pradeep Kumar', 'Label', 'Printer driver']);
  });

  const sheets = buildHprSheets([{ date: '2026-10-01', lines: [
    { line: '1', mp: 96, fromEntry: true, shift: MASTER, hours: H },
    { line: '2', mp: null, fromEntry: false, shift: MASTER, hours: H.slice(0, 3) },
  ] }], HPR);
  const sh = sheets[0];
  const cell = (ref) => { const m = /^([A-Z])(\d+)$/.exec(ref); return sh.rows[Number(m[2]) - 1]?.[m[1].charCodeAt(0) - 65] ?? null; };
  it('one sheet per day named by the day; plant cells in place', () => {
    expect(sheets.length).toBe(1);
    expect(sh.name).toBe('1');
    expect(cell('B2').v).toBe('TTL Tgt ');
    expect(cell('C2').f).toBe('H15');   // summary total row: header 12, two lines → 15
    expect(cell('B12').v).toBe('Line');
    expect(cell('M12').v).toBe('Loss (₹)');
    expect(cell('C7').v).toBe(65);
    expect(cell('C9').v).toBe(2);
    expect(cell('B16').v).toBe('TTL MP');
    expect(cell('C16').v).toBe(96);
    expect(cell('D17').v).toBe('Line-1');
    expect(cell('U17').v).toBe('Total Loss (₹)');
    expect(cell('C18').v).toBe(excelDate('2026-10-01'));
    expect(cell('C18').s).toBe('hprDate');
  });
  it('hour rows: formulas of the plant, an hour with two models over two merged rows', () => {
    expect(cell('D18').v).toBe('09:00-10:00');
    expect(cell('H18').f).toBe('SUM(G18:G18)');
    expect(cell('J18').f).toBe('IFERROR(60/SUM(F18:F18)*I18,0)');
    expect(cell('U18').f).toBe('IFERROR($C$7*J18/60*$C$16,0)');
    expect(cell('O18').v).toBe('Barcode / XML scan error (10 min)');
    expect(cell('P18').v).toBe('Printer driver');
    expect(cell('T18').v).toBe('admin');
    expect(cell('E19').v).toBe('WT70');
    expect(cell('E20').v).toBe('WT80');
    expect(cell('H19').f).toBe('SUM(G19:G20)');
    expect([cell('F19').v, cell('F20').v]).toEqual([186, 1]);   // each model its own target row
    expect(sh.merges).not.toContain('F19:F20');
    expect(sh.merges).toContain('D19:D20');
    expect(sh.merges).toContain('U19:U20');
    const lunch = sh.rows.findIndex((r) => r?.[3]?.v === '13:30-14:00') + 1;
    expect(cell(`J${lunch}`).f).toBe(`IFERROR(30/SUM(F${lunch}:F${lunch})*I${lunch},0)`);
    const ot = sh.rows.findIndex((r) => r?.[3]?.v === '18:00-19:00') + 1;
    expect(cell(`U${ot}`).f).toBe(`IFERROR($C$7*J${ot}/60*$C$16*$C$9,0)`);
    expect(cell(`M${ot}`).v).toBe('Kitting Store / Prod');
  });
  it('summary 1st HR = the 09-10 hour, also when the line started before 9 (23-11-2026)', () => {
    const r9 = sh.rows.findIndex((r) => r?.[3]?.v === '09:00-10:00') + 1;
    expect(cell('D13').f).toBe(`SUM(F${r9}:F${r9})`);
    expect(cell('E13').f).toBe(`H${r9}`);
    const early = [{ hour: 8, slot: '08:00-09:00', workMin: 60, ot: false, target: 120, models: [{ model: 'WT70', qty: 110, target: 120 }], qty: 110, reasons: [] }, ...H];
    const s2 = buildHprSheets([{ date: '2026-10-01', lines: [{ line: '1', mp: 96, fromEntry: true, shift: MASTER, hours: early }] }], HPR)[0];
    const c2 = (ref) => { const m = /^([A-Z])(\d+)$/.exec(ref); return s2.rows[Number(m[2]) - 1]?.[m[1].charCodeAt(0) - 65] ?? null; };
    const q9 = s2.rows.findIndex((r) => r?.[3]?.v === '09:00-10:00') + 1;
    const q8 = s2.rows.findIndex((r) => r?.[3]?.v === '08:00-09:00') + 1;
    expect(q8).toBeGreaterThan(0);
    expect(c2('D13').f).toBe(`SUM(F${q9}:F${q9})`);
    expect([c2('D13').v, c2('E13').v]).toEqual([187, 150]);
  });
  it('cached values match the formulas', () => {
    const r = 18; const F = cell(`F${r}`).v, Hq = cell(`H${r}`).v;
    expect(F).toBe(187);
    expect(Hq).toBe(150);
    expect(cell(`I${r}`).v).toBe(-37);
    expect(cell(`J${r}`).v).toBeCloseTo(60 / 187 * -37, 2);
    expect(cell(`U${r}`).v).toBeCloseTo(65 * (60 / 187 * -37) / 60 * 96, 1);
  });
  it('department split of lost time (top block)', () => {
    expect(cell('E2').v).toBe('Line Loss');
    const names = [3, 4, 5, 6].map((i) => cell(`E${i}`)?.v);
    expect(names).toContain('IT');
    expect(names).toContain('Kitting Store');
    // hour 18 lost (150 vs 187 → I/T = 60/187 × −37 ≈ −11.87) split 6 : 2 between Kitting Store and Prod (line 1 only)
    const ks = [3, 4, 5, 6].find((i) => cell(`E${i}`)?.v === 'Kitting Store');
    expect(cell(`F${ks}`).v).toBeCloseTo(-11.87 * 0.75, 1);
  });
  it('a line without manpower: yellow M/P cell to fill', () => {
    const mpRow = sh.rows.findIndex((r, i) => i > 16 && r?.[1]?.v === 'TTL MP') + 1;
    expect(cell(`C${mpRow}`).s).toBe('hprInput');
    expect(cell(`F${mpRow}`).v).toMatch(/M\/P not entered/);
  });
  it('the workbook builds (styles exist) — written for the openpyxl / LibreOffice check', () => {
    for (const k of ['hprHead', 'hprInt', 'hprDec', 'hprPct', 'hprRs', 'hprDate', 'hprInput', 'hprTotal']) expect(typeof STYLE[k]).toBe('number');
    const bytes = buildXlsx(sheets);
    expect(bytes.length).toBeGreaterThan(5000);
    try { writeFileSync('/tmp/hpr_unit.xlsx', bytes); } catch { /* not on this machine */ }
  });
});
