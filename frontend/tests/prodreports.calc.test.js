// 23-11-2026: Daily production report (serial runs) and Customer wise production
import { describe, it, expect } from 'vitest';
import { serialRuns, splitSerial, dprData, dprRows, dprSheets, custData, custRows, custSheets, daysOf, excelDay } from '../src/utils/prodReports';

const scan = (id, serial, model = '70DGIMS', company = 'Voltas') => ({ id, at: `2026-11-20 10:${String(id % 60).padStart(2, '0')}:00`, mmId: 1, model, company, serial });
const range = (a, b, pre = 'VL70', from = 1, model) => Array.from({ length: b - a + 1 }, (_, i) => scan(from + i, `${pre}${String(a + i).padStart(7, '0')}`, model));

describe('serial runs (the paper: one row per run of serial numbers)', () => {
  it('trailing number split', () => {
    expect(splitSerial('VL700010540')).toEqual({ pre: 'VL', num: 700010540, len: 9 });
    expect(splitSerial('ABC')).toBe(null);
  });
  it('a jump in the serials starts a new row; pieces counted, duplicates once', () => {
    const rows = [...range(12501, 12889, 'VL70', 100), ...range(10540, 10550, 'VL70', 1), scan(999, 'VL700012600')];   // 12600 scanned twice
    const R = serialRuns(rows);
    expect(R).toEqual([
      { start: 'VL700010540', end: 'VL700010550', qty: 11 },
      { start: 'VL700012501', end: 'VL700012889', qty: 389 },
    ]);
  });
  it('a few pieces missing inside a run keep it one row (qty = pieces scanned)', () => {
    const rows = range(697, 760).filter((r) => !r.serial.endsWith('0000700') && !r.serial.endsWith('0000701'));
    expect(serialRuns(rows)).toEqual([{ start: 'VL700000697', end: 'VL700000760', qty: 62 }]);
  });
  it('another prefix is another run; serials without a number: first and last by time', () => {
    const R = serialRuns([scan(1, 'AA001'), scan(2, 'AA002'), scan(3, 'BB001'), scan(4, 'XYZ'), scan(5, 'QQQ')]);
    expect(R).toEqual([{ start: 'AA001', end: 'AA002', qty: 2 }, { start: 'BB001', end: 'BB001', qty: 1 }, { start: 'XYZ', end: 'QQQ', qty: 2, noNumber: true }]);
  });
});

describe('daily production report', () => {
  const S = {
    '2026-11-20|1': [...range(10540, 10550, 'VL70', 1), ...range(12501, 12889, 'VL70', 20), ...Array.from({ length: 144 }, (_, i) => scan(1000 + i, `CL${String(294 + i).padStart(6, '0')}`, 'DA-11PBL', 'Cellecor'))],
    '2026-11-20|2': [],
  };
  const D = dprData(S, { from: '2026-11-20', to: '2026-11-20', ids: ['1', '2'] });
  it('one block per line-day with models in making order, totals', () => {
    expect(D.length).toBe(1);
    expect(D[0].models.map((m) => [m.sr, m.company, m.model, m.total, m.runs.length])).toEqual([[1, 'VOLTAS', '70DGIMS', 400, 2], [2, 'CELLECOR', 'DA-11PBL', 144, 1]]);
    expect(D[0].total).toBe(544);
  });
  it('rows: customer / model only on the first run, model total when split', () => {
    const R = dprRows(D);
    expect(R.map((r) => [r.sr, r.model, r.qty, r.modelTotal])).toEqual([[1, '70DGIMS', 11, 400], [null, '', 389, null], [2, 'DA-11PBL', 144, null]]);
  });
  it('sheet: paper header, merged model cells, model total formula in Remarks, Total Qty', () => {
    const [sh] = dprSheets(D);
    expect(sh.name).toBe('L1 20-11');
    expect(sh.rows[2].map((c) => c.v)).toEqual(['Sr. No.', 'Customer', 'Model', 'Plan QTY.', 'Starting Sr. Number', 'Ending Sr. Number', 'Total production', 'Remarks']);
    expect(sh.rows[1][6].v).toBe(excelDay('2026-11-20'));
    expect(sh.merges).toContain('C4:C5');
    expect(sh.rows[3][7]).toMatchObject({ f: 'SUM(G4:G5)', v: 400 });
    expect(sh.rows[3][3].s).toBe('hprInput');
    const tot = sh.rows.find((r) => r[1]?.v === 'Total Qty.');
    expect(tot[6]).toMatchObject({ f: 'SUM(G4:G6)', v: 544 });
  });
});

describe('customer wise production', () => {
  const day = (date, lines) => ({ date, byLine: lines });
  const row = (models) => ({ hour: 10, qty: models.reduce((a, m) => a + m.quantity, 0), models });
  const ctx = {
    ids: ['1', '2'],
    D: { al: { lines: [{ models: [{ model: '70DGIMS', company: 'Voltas' }, { model: 'WT70', company: 'Samsung' }, { model: '65R', company: 'Samsung' }] }] } },
    R: { days: [
      day('2026-11-01', { 1: { rows: [row([{ model: '70DGIMS', quantity: 100 }, { model: 'WT70', quantity: 50 }]), { hour: 11, future: true, models: [{ model: 'WT70', quantity: 9 }] }] }, 2: { rows: [row([{ model: '65R', quantity: 30 }])] } }),
      day('2026-11-02', { 1: { rows: [row([{ model: '70DGIMS', quantity: 40 }])] } }),
    ] },
  };
  const C = custData(ctx, '2026-11-01', '2026-11-03');
  it('customers × dates, models inside, line totals', () => {
    expect(C.dates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(C.customers.map((c) => [c.name, c.total, c.byDate])).toEqual([['VOLTAS', 140, { '2026-11-01': 100, '2026-11-02': 40 }], ['SAMSUNG', 80, { '2026-11-01': 80 }]]);
    expect(C.customers[1].models.map((m) => [m.model, m.total])).toEqual([['WT70', 50], ['65R', 30]]);
    expect(C.lines.map((l) => [l.line, l.total])).toEqual([['1', 190], ['2', 30]]);
    expect(C.total).toBe(220);
    expect(custRows(C)[0]).toMatchObject({ customer: 'VOLTAS', custTotal: 140, model: '70DGIMS', total: 140, days: 2, best: 100 });
  });
  it('workbook: Summery + a sheet per customer, formulas like the plant file', () => {
    const W = custSheets(C);
    expect(W.map((s) => s.name)).toEqual(['Summery', 'VOLTAS', 'SAMSUNG']);
    const [S, V] = W;
    expect(S.rows[1].map((c) => c.v).slice(0, 3)).toEqual(['Sr.No', 'CUSTOMER', 'Total']);
    expect(S.rows[2][3]).toMatchObject({ f: "'VOLTAS'!D1", v: 100 });
    expect(S.rows[2][2]).toMatchObject({ f: 'SUM(D3:F3)', v: 140 });
    expect(S.rows[2][9]).toMatchObject({ f: '(H3+I3)-G3', v: -140 });   // Bal. to produce
    expect(V.rows[0][3]).toMatchObject({ f: 'SUM(D3:D3)', v: 100 });
    expect(V.rows[2][7].s).toBe('hprInput');   // Month plan to fill
    const lineRow = S.rows.find((r) => r[2]?.v === 'Line-1');
    expect(lineRow[1].v).toBe(190);
    expect(lineRow[0].v).toBe(95);   // average of the days with pieces
  });
  it('days helper', () => { expect(daysOf('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']); });
});

describe('daily production report — print', () => {
  it('one page per line and day, paper columns, runs merged with the model total, signatures', async () => {
    const { dprPrintHtml } = await import('../src/utils/prodReports');
    const data = [{ date: '2026-11-21', line: '1', total: 83 + 400, models: [
      { sr: 1, company: 'VOLTAS', model: 'NDEA1DS4ITDA', total: 83, runs: [{ start: '543', end: '625', qty: 83 }] },
      { sr: 2, company: 'VOLTAS', model: '70DLIM5', total: 400, runs: [{ start: '10540', end: '10550', qty: 11 }, { start: '12501', end: '12889', qty: 389 }] },
    ] }, { date: '2026-11-21', line: '2', total: 0, models: [] }];
    const h = dprPrintHtml(data);
    expect((h.match(/class="page"/g) || []).length).toBe(2);
    for (const t of ['Daily Production Report', 'Plan QTY.', 'Starting Sr. Number', 'Ending Sr. Number', 'Total production', 'Remarks', 'Total Qty.', 'Line incharge Sign.', 'Quality incharge Sign.', '21-11-2026']) expect(h).toContain(t);
    expect(h).toContain('rowspan="2"');
    expect(h).toContain('>400<');
    expect(h).toContain('>483<');
    expect(dprPrintHtml([{ date: '2026-11-21', line: '3', total: 0, models: [{ sr: 1, company: '<x>', model: 'a&b', total: 1, runs: [{ start: '1', end: '1', qty: 1 }] }] }])).toContain('&lt;x&gt;');
  });
});

describe('DPR and the scan count (24-11-2026)', () => {
  it('a serial scanned again: one piece in the DPR, the repeat is counted and said', () => {
    const rows = [1, 2, 3, 3, 4].map((k, i) => ({ id: i + 1, serial: `SN00${k}`, model: 'A', company: 'X', at: `2026-11-24 09:0${i}` }));
    const D = dprData({ '2026-11-24|1': rows }, { from: '2026-11-24', to: '2026-11-24', ids: ['1'] });
    expect([D[0].total, D[0].scans, D[0].repeat, D[0].models[0].repeat]).toEqual([4, 5, 1, 1]);
    const sh = dprSheets(D)[0];
    expect(sh.rows.some((r) => r?.[1]?.v && String(r[1].v).includes('Good scans on the line: 5'))).toBe(true);
  });
});
