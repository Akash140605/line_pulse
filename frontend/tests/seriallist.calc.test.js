import { describe, it, expect } from 'vitest';
import { serialBook, serialSheets, dMonY } from '../src/utils/prodReports';

// 25-11-2026: Daily production — serial list (Summary + one sheet per line), as the plant's Daily_Production_Lines file
const S = {
  '2026-11-25|1': [
    { id: 3, at: '2026-11-25 08:53:00', mmId: 169, model: '80DBLG/BLSSWH5GLDE', code: '1200760', company: 'VOLTAS', serial: 'S3', carton: 'S3', component: '1200760' },
    { id: 1, at: '2026-11-25 08:51:00', mmId: 365, model: 'FLPL11TGSWM', code: '11TGSWM', company: 'FELTRON', serial: 'S1', carton: 'S1', component: '11TGSWM' },
    { id: 2, at: '2026-11-25 08:52:00', mmId: 169, model: '80DBLG/BLSSWH5GLDE', code: '1200760', company: 'voltas', serial: 'S2', carton: 'S2', component: '1200760' },
  ],
  '2026-11-25|2': [{ id: 9, at: '2026-11-25 09:00:00', mmId: 719, model: '100 5.0 TB3 SLGR', code: '00576', company: 'GODREJ', serial: 'G1', carton: 'G1', component: '00576' }],
};
describe('serial list report', () => {
  it('summary: line by line, brand A→Z, line totals, all lines', () => {
    const b = serialBook(S, { from: '2026-11-25', to: '2026-11-25', ids: ['1', '2'] });
    expect(b.period).toBe('25-Nov-2026');
    expect(b.lines[0].models.map((m) => `${m.brand}|${m.model}|${m.qty}`)).toEqual(['FELTRON|FLPL11TGSWM|1', 'VOLTAS|80DBLG/BLSSWH5GLDE|2']);
    expect(b.total).toBe(4);
    const sh = serialSheets(b);
    expect(sh.map((s) => s.name)).toEqual(['Summary', 'Line 1', 'Line 2']);
    const sum = sh[0].rows.map((r) => r.map((c) => c.v));
    expect(sum[0]).toEqual(['Line', 'Brand', 'Model', 'Quantity', 'Period', 'Brand filter']);
    expect(sum[3]).toEqual(['Line 1 total', '', '', 3, '25-Nov-2026', '']);
    expect(sum[sum.length - 1]).toEqual(['ALL SELECTED LINES', '', '', 4, '25-Nov-2026', 'All brands']);
  });
  it('line sheet: every scan, oldest first, the plant columns', () => {
    const sh = serialSheets(serialBook(S, { from: '2026-11-25', to: '2026-11-25', ids: ['1'] }));
    const L1 = sh[1].rows.map((r) => r.map((c) => c.v));
    expect(L1[0]).toEqual(['SNO', 'Date', 'company', 'model', 'serial', 'carton', 'id', 'at', 'mmId', 'code', 'component']);
    expect(L1.slice(1).map((r) => r[4])).toEqual(['S1', 'S2', 'S3']);
    expect(L1[1].slice(0, 3)).toEqual([1, '2026-11-25', 'FELTRON']);
  });
  it('one brand only; a range of days', () => {
    const b = serialBook(S, { from: '2026-11-25', to: '2026-11-25', ids: ['1', '2'], brand: 'Voltas' });
    expect(b.total).toBe(2); expect(b.brand).toBe('VOLTAS'); expect(b.brands).toEqual(['FELTRON', 'GODREJ', 'VOLTAS']);
    expect(serialBook(S, { from: '2026-11-24', to: '2026-11-25', ids: ['1'] }).period).toBe('24-Nov-2026 to 25-Nov-2026');
    expect(dMonY('2026-01-05')).toBe('05-Jan-2026');
  });
});
