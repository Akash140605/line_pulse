// Report compare (src/utils/reportCompare.js): the plant's reports and Line Pulse's read by one reader, compared (20-11-2026).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { readWorkbook, cellDate, xmlText } from '../src/utils/sheetRead';
import { formatCell } from '../src/utils/xlsxFormat';
import { alike, modelCore, parseReport, fileChecks, compareFacts, summarize, judge, lineOf, slotOf, deptKey, detectType, MEASURES, formatCheck, sharedColumns, TABLE_TYPES, COMPARE_TYPES, typeHas, colLetter } from '../src/utils/reportCompare';
import { REPORTS, tableSheet } from '../src/utils/reportDefs';
import { buildXlsx } from '../src/utils/xlsxWriter';
import { kpiDays, buildKpiXlsx } from '../src/utils/kpiReport';
import { buildHprSheets } from '../src/utils/hpr';
import { reworkSheet, reworkXlsxSheet } from '../src/utils/reworkReport';

const T = (rows, name = 'Sheet1') => ({ name, rows: rows.map((r) => r.map((v) => (v == null ? null : { v, s: 'text' }))) });
const book = async (sheets) => readWorkbook(buildXlsx(sheets));

describe('names, slots, dates', () => {
  it('line names of the plant files', () => {
    expect(['FA-01', 'Line-2', 'Line-3(C3)', 'Line-4 C2', 'L1', 'Line 2'].map(lineOf)).toEqual(['1', '2', '3', '4', '1', '2']);
    expect(['PKG-01', 'SMT-02', 'TRC', 'Total', 'FA', '', null].map(lineOf)).toEqual([null, null, null, null, null, null, null]);
  });
  it('hour slots: start hour and minutes', () => {
    expect(slotOf('09:00-10:00')).toEqual({ h: 9, min: 60 });
    expect(slotOf(' 13:30-14:00')).toEqual({ h: 13, min: 30 });
    expect(slotOf('09-10')).toEqual({ h: 9, min: 60 });
    expect(slotOf('Model')).toBe(null);
  });
  it('dates: Excel day numbers and text', () => {
    expect(cellDate('46296')).toBe('2026-10-01');
    expect(cellDate('46296.5')).toBe('2026-10-01');
    expect(cellDate('2026-10-05T00:00:00')).toBe('2026-10-05');
    expect(cellDate('05-10-2026')).toBe('2026-10-05');
    expect(cellDate('5-Oct-26')).toBe('2026-10-05');
    expect(cellDate('97')).toBe(null);
  });
  it('departments as one key', () => {
    expect(['Maint', 'Maintenance', 'Prod', 'Production', 'IT', 'Quality', 'QA', 'Stores / SCM', 'Kitting Store'].map(deptKey))
      .toEqual(['maintenance', 'maintenance', 'production', 'production', 'it', 'quality', 'quality', 'stores / scm', 'kitting store']);
  });
});

describe('compare rules', () => {
  const f = (measure, v) => ({ key: `${measure}|2026-10-01|1|`, measure, date: '2026-10-01', line: '1', where: '', show: '', v });
  it('same / small / different / only one side; a missing value against 0 is the same', () => {
    expect(judge('hr.ttl', f('hr.ttl', 200), f('hr.ttl', 200)).status).toBe('same');
    expect(judge('kpi.plan', f('kpi.plan', 379.857), f('kpi.plan', 380)).status).toBe('same');   // pieces ± 0.5
    expect(judge('hr.ttl', f('hr.ttl', 200), f('hr.ttl', 203)).status).toBe('close');            // ≤ 2 %
    expect(judge('hr.ttl', f('hr.ttl', 200), f('hr.ttl', 210)).status).toBe('diff');
    expect(judge('hr.ttl', f('hr.ttl', 200), null).status).toBe('theirs');
    expect(judge('hr.ttl', null, f('hr.ttl', 5)).status).toBe('ours');
    expect(judge('hr.ttl', f('hr.ttl', 0), null).status).toBe('same');
    expect(judge('fty.rty', f('fty.rty', 0.9703), f('fty.rty', 0.9704)).status).toBe('same');
    expect(judge('fty.rty', f('fty.rty', 0.9703), f('fty.rty', 0.9715)).status).toBe('close');  // 0.12 points
    expect(judge('fty.rty', f('fty.rty', 0.9703), f('fty.rty', 0.98)).status).toBe('diff');
    const d = judge('hr.loss', f('hr.loss', -2903.1), f('hr.loss', -2993.8));
    expect(d.status).toBe('diff'); expect(d.diff).toBeCloseTo(-90.7); expect(d.pct).toBeCloseTo(-90.7 / 2903.1);
  });
  it('department wording: Maint = Maintenance; a reason in other words is a text difference', () => {
    expect(judge('hr.dept', f('hr.dept', 'Maint'), f('hr.dept', 'Maintenance')).status).toBe('same');
    expect(judge('hr.reason', f('hr.reason', 'XML Barcode error'), f('hr.reason', 'Barcode scan error')).status).toBe('diff');
    expect(MEASURES['hr.reason'].kind).toBe('text');
  });
});

// a plant-style HPR day (their layout: continuation rows for the other models of an hour, slot labels with spaces)
const HPR_THEIRS = [
  [null, 'TTL Tgt ', 1684],
  [],
  [null, 'Line', 'Date', 'TGT UPH (1st HR)', 'ACH UPH(1st HR)', 'TGT UPH', 'Ach UPH', 'Tgt', 'Prod', 'Gap', 'I/T (Hrs)', '% Ach', 'Loss (₹)', 'M/P', 'I/T (Minutes)', 'TGT UPPH', 'Ach UPPH'],
  [null, 'Line-1', 46296, 187, 100, 41.56, 45.11, 374, 406, 32, 0.171, 1.0856, 1066.87, 99, 10.26, 0.42, 0.456],
  [null, 'Total', null, null, null, null, null, 374, 406],
  [null, 'TTL MP', 99],
  [null, 'Line', 'Date', 'Line-1', 'Model', 'Tgt ', 'Ach ', 'TTL ', 'Gap', 'I/T (Mins)', '%Efficiency', 'Parts Involved', 'Loss Cont Dept', 'Owner', 'Line Loss Reason', 'Root Cause', 'Action Taken', 'Sustainability', 'Action Plan given by', 'Action Plan Reviewed by', 'Total Loss (₹)', 'TGT UPPH', 'Ach UPPH'],
  [null, 'Line-1', 46296, '09:00-10:00', 'CELLECOR DX-10', 187, 100, 200, 13, 4.171, 1.07, null, 'Maint', 'Pradeep', 'Belt broke', null, null, null, null, null, 433.8, 1.89, 2.02],
  [null, 'Line-1', 46296, null, 'WTT70DLIM5', null, 100],
  [null, 'Line-1', 46296, ' 18:00-19:00', 'WTT70DLIM5', 187, 206, 206, 19, 6.096, 1.1, null, null, null, null, null, null, null, null, null, 1268.0, 1.89, 2.08],   // overtime ×2 with 96 people
  [null, 'Line-1', 46296, '19:00-20:00', 'WTT70DLIM5', 187, 0, 50, 13, 4.171, 1.07],   // TTL ≠ model, gap wrong
  [null, '', '', '21:00-22:00', '', '', '', '', 0, 0, 0],
  [null, 'Line-1', null, null, 'TTL', 561, 406, 456],
];

describe('HPR: their layout', () => {
  it('reads the summary, the hours and the models of every hour; a template slot without numbers is left out', async () => {
    const P = parseReport(await book([T(HPR_THEIRS, '1')]));
    expect(P.type).toBe('hpr');
    expect(P.days).toEqual(['2026-10-01']); expect(P.lines).toEqual(['1']);
    const v = (m, w = '') => P.facts.get(`${m}|2026-10-01|1|${w}`)?.v;
    expect(v('hpr.tgt')).toBe(374); expect(v('hpr.mp')).toBe(99); expect(v('hpr.loss')).toBe(1066.87);
    expect(v('hr.ttl', '09')).toBe(200); expect(v('hr.tgt', '18')).toBe(187); expect(v('hr.dept', '09')).toBe('Maint');
    expect(v('hm.qty', '09|CELLECOR DX-10')).toBe(100); expect(v('hm.qty', '09|WTT70DLIM5')).toBe(100);
    expect(P.recs.hours.map((h) => h.h)).toEqual([9, 18, 19]);
  });
  it('checks: TTL against the models, gap, the people of the loss ₹ (with overtime ×2)', async () => {
    const P = parseReport(await book([T(HPR_THEIRS, '1')]));
    const C = Object.fromEntries(fileChecks(P, { rate: 65, otX: 2, otFrom: '18:00' }).map((c) => [c.id, c]));
    expect(C['hr-models'].checked).toBe(1); expect(C['hr-models'].bad).toHaveLength(0);
    expect(C['hr-gap'].bad.map((b) => b.where)).toEqual(['19:00-20:00']);          // 50 − 187 ≠ 13
    expect(C['hr-loss'].uses).toMatch(/Line 1: 96 people/);                        // 433.8 = 65 × 4.171 ÷ 60 × 96 · 1268 = … × 96 × 2
    expect(C['hr-loss'].uses).toMatch(/M\/P written 99/);
  });
});

describe('Line Pulse reports read back by the same reader', () => {
  const SHIFT = { start: '09:00', end: '11:00', lunchStart: '13:00', lunchEnd: '13:30' };
  const R = { days: [{ date: '2026-11-02', byLine: { 1: { ok: true, rows: [
    { hour: 9, qty: 200, models: [{ mmId: 7, model: 'WT70', quantity: 150 }, { mmId: 8, model: 'WT80', quantity: 50 }],
      entry: { rejects: [{ station: 'Leak test', reason: 'Leak', qty: 3 }], rework: [{ station: 'FQC', reason: 'Scratch', qty: 2 }] } },
    { hour: 10, qty: 0, models: [] },
  ] } } }] };
  const days = kpiDays({ R, setups: { '2026-11-02|1': { mp: 100 } }, targetsOf: () => ({ 7: { cycle: 20 }, 8: { cycle: 30 } }), shiftOf: () => SHIFT,
    stations: [{ reason: 'Leak test' }, { reason: 'FQC (final quality check)', code: 'FQC' }], lines: ['1'] });
  it('SAWM KPI: Summary, FTY & RTY and the day sheet', async () => {
    const P = parseReport(await readWorkbook(buildKpiXlsx(days)));
    expect(P.type).toBe('kpi');
    const v = (m, w = '') => P.facts.get(`${m}|2026-11-02|1|${w}`)?.v;
    expect(v('kpi.qty')).toBe(200); expect(Math.round(v('kpi.plan'))).toBe(160);
    expect(v('fty.qty')).toBe(200); expect(v('fty.s1')).toBe(3); expect(v('fty.s5')).toBe(2); expect(v('fty.defects')).toBe(5);
    expect(v('fty.rty')).toBeCloseTo((1 - 3 / 200) * (1 - 2 / 200));
    expect(v('kpi.rty')).toBeCloseTo(Math.round((1 - 3 / 200) * (1 - 2 / 200) * 10000) / 100);
    expect(v('mdl.qty', 'WT70')).toBe(150); expect(Math.round(v('mdl.plan', 'WT70'))).toBe(120); expect(v('mdl.uphT', 'WT70')).toBe(180);
    const C = Object.fromEntries(fileChecks(P).map((c) => [c.id, c]));
    expect(C['fty-fpy'].bad).toHaveLength(0); expect(C['fty-rty'].bad).toHaveLength(0); expect(C['sum-models'].bad).toHaveLength(0); expect(C['sum-fty'].bad).toHaveLength(0);
  });
  it('the same file against itself: all the same', async () => {
    const P = parseReport(await readWorkbook(buildKpiXlsx(days)));
    const S = summarize(compareFacts(P.facts, P.facts));
    expect(S.tiles.all).toBe(S.tiles.same); expect(S.tiles.diff + S.tiles.theirs + S.tiles.ours).toBe(0);
  });
  it('HPR: hours, models, summary', async () => {
    const hpr = [{ date: '2026-10-01', lines: [{ line: '1', mp: 96, fromEntry: true, shift: { start: '09:00', end: '11:00', lunchStart: '', lunchEnd: '', breaks: [] }, hrs: 2, rate: 65, otX: 2,
      hours: [
        { hour: 9, slot: '09-10', workMin: 60, ot: false, target: 187, models: [{ model: 'A1', qty: 100, target: 98 }, { model: 'B2', qty: 90, target: 89 }], qty: 190, reasons: [{ reason: 'Belt broke', dept: 'Maintenance', min: 5, kind: 'loss' }] },
        { hour: 10, slot: '10-11', workMin: 60, ot: false, target: 187, models: [{ model: 'B2', qty: 187, target: 187 }], qty: 187, reasons: [] },
      ] }] }];
    const P = parseReport(await readWorkbook(buildXlsx(buildHprSheets(hpr, { rate: 65, otX: 2, otFrom: '18:00' }))));
    expect(P.type).toBe('hpr');
    const v = (m, w = '') => P.facts.get(`${m}|2026-10-01|1|${w}`)?.v;
    expect(v('hr.tgt', '09')).toBe(187); expect(v('hr.ttl', '09')).toBe(190); expect(v('hr.gap', '09')).toBe(3);
    expect(v('hm.qty', '09|A1')).toBe(100); expect(v('hm.qty', '09|B2')).toBe(90); expect(v('hm.qty', '10|B2')).toBe(187);
    expect(v('hpr.tgt')).toBe(374); expect(v('hpr.prod')).toBe(377); expect(v('hpr.mp')).toBe(96);
    expect(v('hr.dept', '09')).toBe('Maintenance');
    const C = Object.fromEntries(fileChecks(P).map((c) => [c.id, c]));
    expect(C['hr-models'].bad).toHaveLength(0); expect(C['hr-gap'].bad).toHaveLength(0); expect(C['hr-it'].bad).toHaveLength(0); expect(C.sum.bad).toHaveLength(0);
    expect(C['hr-loss'].uses).toMatch(/Line 1: 96 people/);
  });
  it('hourly rework: defects by stage, hours, ₹', async () => {
    const entries = { '2026-04-07|1|10': { rework: [{ station: 'FUNCTIONAL', reason: 'SPIN TUB NUT LOOSE', qty: 2, model: 'WTT70DLIM5' }] }, '2026-04-07|1|11': { rework: [{ station: 'FUNCTIONAL', reason: 'SPIN TUB NUT LOOSE', qty: 1, model: 'WTT70DLIM5' }] } };
    const S = reworkSheet({ entries, start: '2026-04-01', end: '2026-04-30', stations: [{ reason: 'FUNCTIONAL' }] });
    const P = parseReport(await readWorkbook(buildXlsx([reworkXlsxSheet(S)])));
    expect(P.type).toBe('rwk');
    const v = (m, w = '') => P.facts.get(`${m}|2026-04-07|1|${w}`)?.v;
    expect(v('rw.line')).toBe(3); expect(v('rw.inr')).toBe(165); expect(v('rw.hour', '10')).toBe(2); expect(v('rw.hour', '11')).toBe(1);
    expect(v('rw.def', 'FUNCTIONAL|SPIN TUB NUT LOOSE')).toBe(3);
  });
});

describe('their KPI vs Line Pulse: the differences found', () => {
  it('a different actual and a missing day', async () => {
    const theirs = parseReport(await book([T([
      ['Date', 'Line No.', 'SAP Location', 'Production', null, 'UPH', null, 'UPPH', null, 'RTY (%)'],
      [null, null, null, 'Plan', 'Actual', 'Target ', 'Actual', 'Target ', 'Actual', 'Target ', 'Actual'],
      [46327, 'FA-01', 1018, 1859.04, 2001, 165.2, 177.9, 1.67, 1.80, 97, 97.03],
      [null, 'FA-02', 1018, 1353.95, 1577, 169.2, 197.1, 1.68, 1.95, 97, 98.1],
      [46328, 'FA-01', 1018, 1388.8, 1544, 173.6, 193, 1.75, 1.95, 97, 98.39],
    ], 'Summary')]));
    const ours = parseReport(await book([T([
      ['Date', 'Line No.', 'SAP Location', 'Production', null, 'UPH', null, 'UPPH', null, 'RTY (%)'],
      [null, null, null, 'Plan', 'Actual', 'Target ', 'Actual', 'Target ', 'Actual', 'Target ', 'Actual'],
      [46327, 'FA-01', 1018, 1859.2, 2001, 165.2, 177.9, 1.67, 1.80, 97, 97.03],
      [null, 'FA-02', 1018, 1353.95, 1590, 169.2, 198.7, 1.68, 1.95, 97, 98.1],
    ], 'Summary')]));
    expect(theirs.type).toBe('kpi'); expect(detectType([{ name: 'x', rows: [['a']] }])).toBe(null);
    const rows = compareFacts(theirs.facts, ours.facts, { from: '2026-11-01', to: '2026-11-30' });
    const st = (m, d, l) => rows.find((r) => r.measure === m && r.date === d && r.line === l)?.status;
    expect(st('kpi.qty', '2026-11-01', '1')).toBe('same');
    expect(st('kpi.plan', '2026-11-01', '1')).toBe('same');
    expect(st('kpi.qty', '2026-11-01', '2')).toBe('close');    // 1577 vs 1590 (0.8 %)
    expect(st('kpi.qty', '2026-11-02', '1')).toBe('theirs');   // Line Pulse has no 02-11
    const S = summarize(rows);
    expect(S.byDay.find((d) => d.date === '2026-11-02').bad).toBeGreaterThan(0);
    expect(S.byMeasure.find((m) => m.measure === 'kpi.qty').sumT).toBe(2001 + 1577 + 1544);
  });
});

// the real plant files, when they are on this computer (not part of the project)
const REAL = { kpi: '/mnt/user-data/uploads/089c4f0f-SAWM_KPI_Report-Nov_26.xlsx', hpr: '/mnt/user-data/uploads/1593d4f4-HPR_Oct-26_1.xlsx', rwk: '/mnt/user-data/uploads/4dd3801c-Book1.xlsx' };
describe('the plant files', () => {
  // 25-11-2026: on a PC without the plant files (the server) the suite says so instead of failing as empty
  if (!Object.values(REAL).some((f) => existsSync(f))) it.skip('plant files are not on this computer', () => {});
  for (const [type, f] of Object.entries(REAL)) {
    if (!existsSync(f)) continue;
    it(`${type}: read, found and checked`, async () => {
      const b = readFileSync(f);
      const P = parseReport(await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
      expect(P.type).toBe(type);
      expect(P.lines).toEqual(['1', '2', '3', '4']);
      expect(P.n).toBeGreaterThan(1000);
      const C = fileChecks(P, { rate: 65, otX: 2, otFrom: '18:00' });
      expect(C.every((c) => c.checked > 0 || !c.bad.length)).toBe(true);
      if (type === 'hpr') expect(C.find((c) => c.id === 'hr-loss').uses).toMatch(/Line 1: 96 people.*Line 3: 94 people.*Line 4: 80 people/);
      if (type === 'rwk') expect(C.find((c) => c.id === 'rw-inr').uses).toMatch(/₹55 per piece/);
      if (type === 'kpi') expect(C.find((c) => c.id === 'fty-rty').bad).toHaveLength(0);
    });
  }
});

// ── 20-11-2026: every report type, the format check and cell by cell ──
describe('every report of the Reports page can be compared', () => {
  const rep = (id) => REPORTS.find((r) => r.id === id);
  const book = (id, rows) => readWorkbook(buildXlsx([tableSheet(rep(id), rows, rep(id).cols, `${rep(id).name} · test`, 'Dixon Line Pulse')]));
  const day = [
    { date: '2026-10-27', line: '1', qty: 1500, totalMin: 690, stopMin: 20, plannedMin: 670, lossMin: 30, actualMin: 640, stdMin: 600.5, rejects: 2, rework: 3, A: 95.5, P: 93.8, Q: 99.9, ole: 89.5, lostH: 1.2 },
    { date: '2026-10-27', line: '2', qty: 1400, totalMin: 690, stopMin: 10, plannedMin: 680, lossMin: 40, actualMin: 640, stdMin: 580, rejects: 0, rework: 1, A: 94.1, P: 90.6, Q: 100, ole: 85.3, lostH: 1.6 },
  ];
  it('the list: the three plant reports, the six tables and cell by cell', () => {
    expect(COMPARE_TYPES.map(([id]) => id)).toEqual(['kpi', 'hpr', 'rwk', 'oleDay', 'oleHour', 'modelDay', 'losses', 'targets', 'master', 'cell']);
    expect(TABLE_TYPES.find((t) => t.id === 'losses').keys).toEqual(['date', 'line', 'kind', 'reason']);
    expect(typeHas('master')).toEqual({ date: false, line: false });
    expect(typeHas('targets')).toEqual({ date: false, line: true });
    expect(typeHas('hpr')).toEqual({ date: true, line: true });
    expect([0, 25, 26, 27].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AB']);
  });
  it('OLE — day by line: found from its headers, one row per date · line, every column a measure', async () => {
    const P = parseReport(await book('oleDay', day));
    expect(P.type).toBe('oleDay');
    expect(P.facts.get('oleDay.qty|2026-10-27|1|').v).toBe(1500);
    expect(P.facts.get('oleDay.A|2026-10-27|1|').v).toBe(95.5);
    expect(MEASURES['oleDay.A'].kind).toBe('pct'); expect(MEASURES['oleDay.qty'].kind).toBe('count');
    expect(P.recs.heads[0]).toMatchObject({ table: 'OLE — day by line', row: 4 });
    expect(P.lines).toEqual(['1', '2']);
  });
  it('a changed number is a difference, a missing row is only in one file', async () => {
    const A = parseReport(await book('oleDay', day));
    const B = parseReport(await book('oleDay', [{ ...day[0], qty: 1600 }]));
    const out = compareFacts(A.facts, B.facts, { from: '2026-10-01', to: '2026-10-31' });
    const st = (m, l) => out.find((r) => r.measure === m && r.line === l)?.status;
    expect(st('oleDay.qty', '1')).toBe('diff'); expect(st('oleDay.qty', '2')).toBe('theirs'); expect(st('oleDay.A', '1')).toBe('same');
  });
  it('hour by hour (hour key), model by day (model key), losses (kind · reason key)', async () => {
    const H = parseReport(await book('oleHour', [{ date: '2026-10-27', line: '1', hour: 9, models: 'WT70 (150)', qty: 150, stopMin: 0, lossMin: 5, actualMin: 55, rejects: 1, A: 91.7, P: 95, Q: 99.3, ole: 86.5 },
      { date: '2026-10-27', line: '1', hour: 18, extra: true, models: 'WT70 (40)', qty: 40, stopMin: 0, lossMin: 0, actualMin: 60, rejects: 0, A: 100, P: 60, Q: 100, ole: 60 }]));
    expect(H.type).toBe('oleHour');
    expect(H.facts.get('oleHour.qty|2026-10-27|1|09').v).toBe(150);
    expect(H.facts.get('oleHour.qty|2026-10-27|1|18').v).toBe(40);   // "18-19 (extra)"
    expect(H.facts.get('oleHour.models|2026-10-27|1|09').v).toBe('WT70 (150)');
    const M2 = parseReport(await book('modelDay', [{ date: '2026-10-27', line: '3', model: 'WT80C4000RR', qty: 281, std: 13, stdMin: 60.9 }]));
    expect(M2.type).toBe('modelDay'); expect(M2.facts.get('modelDay.qty|2026-10-27|3|WT80C4000RR').v).toBe(281);
    const L = parseReport(await book('losses', [{ date: '2026-10-27', line: '2', kind: 'Idle time', reason: 'Carton box shortage', dept: 'Kitting Store', value: 24, unit: 'min', hours: '09:00, 10:00', models: 'WT70', rca: 'Pending', rootCause: '', action: '' }]));
    expect(L.type).toBe('losses');
    expect(L.facts.get('losses.value|2026-10-27|2|IDLE TIME|CARTON BOX SHORTAGE').v).toBe(24);
    expect(L.facts.get('losses.rca|2026-10-27|2|IDLE TIME|CARTON BOX SHORTAGE').v).toBe('Pending');
  });
  it('model master and targets: no date (and no line for the master) — compared without a period', async () => {
    const A = parseReport(await book('master', [{ company: 'VOLTAS', model: 'WTT70DLIM5', cycle: 20, pph: 180, lines: '1, 4', note: '', updatedAt: '' }, { company: 'SAMSUNG', model: 'WT80C4000RR', cycle: 13, pph: 277, lines: '3', note: '', updatedAt: '' }]));
    const B = parseReport(await book('master', [{ company: 'VOLTAS', model: 'WTT70DLIM5', cycle: 21, pph: 171, lines: '1, 4', note: '', updatedAt: '' }]));
    expect(A.type).toBe('master'); expect(A.dates).toBe(null);
    const out = compareFacts(A.facts, B.facts, { from: '', to: '9999-12-31', lines: null });
    expect(out.find((r) => r.measure === 'master.cycle' && r.where === 'VOLTAS|WTT70DLIM5').status).toBe('diff');
    expect(out.find((r) => r.measure === 'master.cycle' && r.where === 'SAMSUNG|WT80C4000RR').status).toBe('theirs');
    const T = parseReport(await book('targets', [{ line: '1', company: 'VOLTAS', model: 'WTT70DLIM5', cycle: 20, pph: 180, source: 'Master' }]));
    expect(T.type).toBe('targets'); expect(T.facts.get('targets.cycle||1|WTT70DLIM5').v).toBe(20);
  });
  it('a file that is no known report: told so; cell by cell still reads it', async () => {
    const sheets = await book('oleDay', day);
    expect(() => parseReport([{ name: 'x', rows: [Object.assign(['Name', 'Value'], { n: 1 }), Object.assign(['a', '1'], { n: 2 })] }])).toThrow(/not a report Line Pulse knows/);
    const A = parseReport(sheets, { as: 'cell' });
    const B = parseReport(await book('oleDay', [{ ...day[0], qty: 1501 }, day[1]]), { as: 'cell' });
    const out = compareFacts(A.facts, B.facts);
    const bad = out.filter((r) => r.status !== 'same');
    expect(bad.map((r) => r.where)).toEqual(['C5']);   // the one cell that changed (row 5 = first data row, column C = Qty)
    expect(bad[0]).toMatchObject({ theirs: 1500, ours: 1501, status: 'close' });
    // a changed text cell is different; the header of every sheet is found for the format check
    const C = parseReport(await book('oleDay', [day[0], { ...day[1], line: '3' }]), { as: 'cell' });
    expect(compareFacts(A.facts, C.facts).filter((r) => r.status !== 'same').map((r) => [r.where, r.status])).toEqual([['B6', 'diff']]);
    expect(A.recs.heads.map((h) => [h.table, h.row, h.labels[2]])).toEqual([['Sheet "OLE — day by line"', 4, 'Qty']]);
    expect(formatCheck(A, C).ok).toBe(true);
  });
});

describe('reading Excel text', () => {
  it('character references (a file saved by openpyxl writes "—" as &#8212;) are read as the character', () => {
    expect(xmlText('<t>OLE &#8212; day by line &#183; L1</t>')).toBe('OLE — day by line · L1');
    expect(xmlText('<t>&#x2014;&#X2014;</t>')).toBe('——');
    expect(xmlText('<t>A &amp;#38; B &amp; C &lt;x&gt;</t>')).toBe('A &#38; B & C <x>');   // an escaped "&" is not read twice
    expect(xmlText('<t>&#0; &#99999999;</t>')).toBe('&#0; &#99999999;');
  });
});

describe('the preview shows a cell as Excel shows it', () => {
  it('the reader keeps the number format of every cell: our OLE table (Qty #,##0, A % 0.0) and the real HPR (dates, %, ₹)', async () => {
    const r = REPORTS.find((x) => x.id === 'oleDay');
    const [sh] = await readWorkbook(buildXlsx([tableSheet(r, [{ date: '2026-10-27', line: '1', qty: 12345, A: 95.46 }], r.cols, 't', 's')]));
    const row = sh.rows.find((x) => x.n === 5);
    const show = (rw, i, s = sh) => formatCell(rw[i], s.formats[rw.s?.[i]] || '', s.date1904);
    expect(show(row, 2)).toBe('12,345');
    expect(show(row, 11)).toBe('95.5');
    expect(show(row, 0)).toBe('27-10-2026');   // a text cell: as it is
    if (!existsSync(REAL.hpr)) return;
    const b = readFileSync(REAL.hpr);
    const S = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const one = S.find((x) => x.name === '1'); const l1 = one.rows.find((x) => x[1] === 'Line-1');
    expect(show(l1, 2, one)).toMatch(/^1-Oct|^01-10-2026$/);
    expect(l1.s).toBeTruthy();
  });
});

describe('a column switched off in Reports', () => {
  it('is not compared row by row: named once as a column only one file has', async () => {
    const r = REPORTS.find((x) => x.id === 'modelDay');
    const rows = [{ date: '2026-10-27', line: '3', model: 'WT80C4000RR', qty: 281, std: 13, stdMin: 60.9 }];
    const A = parseReport(await readWorkbook(buildXlsx([tableSheet(r, rows, r.cols.filter((c) => c[0] !== 'stdMin'), 't', 's')])));
    const B = parseReport(await readWorkbook(buildXlsx([tableSheet(r, rows, r.cols, 't', 's')])));
    const sh = sharedColumns(A, B);
    expect(sh.onlyTheirs).toEqual([]); expect(sh.onlyOurs).toEqual(['modelDay.stdMin']);
    const all = compareFacts(A.facts, B.facts);
    expect(all.filter((x) => x.status === 'ours').map((x) => x.measure)).toEqual(['modelDay.stdMin']);   // without it: one "only in Line Pulse" per row
    const out = compareFacts(A.facts, B.facts, { measures: sh.measures });
    expect(out.every((x) => x.status === 'same')).toBe(true); expect(out.length).toBe(2);
    expect(sharedColumns(parseReport(await readWorkbook(buildKpiXlsx([]))), A)).toEqual({ measures: null, onlyTheirs: [], onlyOurs: [] });   // plant reports: every measure
  });
});

describe('format check: the sheets and the header columns side by side', () => {
  it('the same layout → same; a renamed, a moved and a missing column are named', async () => {
    const r = REPORTS.find((x) => x.id === 'modelDay');
    const A = parseReport(await readWorkbook(buildXlsx([tableSheet(r, [], r.cols, 't', 's')])), { as: 'modelDay' });
    expect(formatCheck(A, A).ok).toBe(true);
    const cols2 = [r.cols[0], r.cols[1], r.cols[3], r.cols[2], ['std', 'Std CT (s)', 12, 'dec1']];   // Qty before Model, Std cycle renamed, Std time gone
    const B = parseReport(await readWorkbook(buildXlsx([tableSheet(r, [], cols2, 't', 's')])), { as: 'modelDay' });
    const F = formatCheck(A, B);
    expect(F.ok).toBe(false);
    const byCol = Object.fromEntries(F.tables[0].cols.map((c) => [c.col, c]));
    expect(byCol.C).toMatchObject({ theirs: 'Model', ours: 'Qty', status: 'moved', to: 'D' });
    expect(byCol.E).toMatchObject({ theirs: 'Std cycle (s)', ours: 'Std CT (s)', status: 'diff' });
    expect(byCol.F).toMatchObject({ theirs: 'Std time (min)', ours: '', status: 'theirs' });
  });
  it('Line Pulse SAWM KPI against itself: Summary, FTY & RTY and day sheet the same; two-row headers read as "Production / Plan"', async () => {
    const SHIFT = { start: '09:00', end: '11:00' };
    const R = { days: [{ date: '2026-11-02', byLine: { 1: { ok: true, rows: [{ hour: 9, qty: 100, models: [{ mmId: 7, model: 'WT70', quantity: 100 }] }] } } }] };
    const P = parseReport(await readWorkbook(buildKpiXlsx(kpiDays({ R, setups: {}, targetsOf: () => ({ 7: { cycle: 20 } }), shiftOf: () => SHIFT, lines: ['1'] }))));
    const F = formatCheck(P, P);
    expect(F.tables.map((t) => t.table)).toEqual(['KPI Summary', 'KPI FTY & RTY', 'KPI day sheet']);
    expect(F.ok).toBe(true);
    expect(P.recs.heads[0].labels.slice(3, 5)).toEqual(['Production / Plan', 'Production / Actual']);
  });
});

describe('the plant files have the layout of the Line Pulse reports', () => {
  if (!existsSync(REAL.kpi)) { it.skip('the plant KPI file is not on this computer', () => {}); return; }
  it('SAWM KPI: the same sheets and the same header columns as the Line Pulse download', async () => {
    const b = readFileSync(REAL.kpi);
    const T = parseReport(await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
    const R = { days: [{ date: '2026-11-02', byLine: { 1: { ok: true, rows: [{ hour: 9, qty: 100, models: [{ mmId: 7, model: 'WT70', quantity: 100 }] }] } } }] };
    const O = parseReport(await readWorkbook(buildKpiXlsx(kpiDays({ R, setups: {}, targetsOf: () => ({ 7: { cycle: 20 } }), shiftOf: () => ({ start: '09:00', end: '11:00' }), lines: ['1'] }))));
    const F = formatCheck(T, O);
    expect(F.tables.every((t) => t.ok)).toBe(true);
    expect(F.sheets.onlyTheirs).toEqual([]); expect(F.sheets.daysTheirs).toBe(11);
  });
});

describe('plant model names paired with the scanner names (23-11-2026)', () => {
  it('brand word and /TL left out; alike names score high, others low', () => {
    expect(modelCore('GOD RIO 10.0 TB3 SLGR')).toBe('RIO100TB3SLGR');
    expect(modelCore('WT10C4260GG/TL')).toBe('WT10C4260GG');
    expect(alike('WT10C4260GG/TL', 'WT10C4260GG')).toBe(1);
    expect(alike('CELLECOR DX-7 PBL', 'DX-7PBL')).toBe(1);
    expect(alike('WTT70DLIM5', '70DLIM 5')).toBe(0.9);
    expect(alike('WT10C4260GG', 'KSAZ6100FG-BB')).toBeLessThan(0.3);
  });
  it('a model on one side only is compared with its alike model of the other side', () => {
    const F = (m, w, v) => [`mdl.qty|2026-11-02|3|${w}`, { key: `mdl.qty|2026-11-02|3|${w}`, measure: m, date: '2026-11-02', line: '3', where: w, show: w, v }];
    const theirs = new Map([F('mdl.qty', 'WT10C4260GG/TL', 330), F('mdl.qty', 'GOD UNO 10 GTF LGREY', 184)]);
    const ours = new Map([F('mdl.qty', 'WT10C4260GG', 441), F('mdl.qty', 'WS EDGE UNO 100 5.0 TB4 MIGR', 221)]);
    const rows = compareFacts(theirs, ours, {});
    const paired = rows.find((r) => String(r.show || r.where).includes('⇄'));
    expect(paired).toBeTruthy();
    expect(rows.length).toBe(3);   // one pair + the two that are not alike
    expect(theirs.size).toBe(2);   // the files' own facts untouched
  });
});

