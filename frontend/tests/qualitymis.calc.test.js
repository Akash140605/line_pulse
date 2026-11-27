import { describe, it, expect } from 'vitest';
import { misData, misSheets, misFileName } from '../src/utils/qualityMis';

// 25-11-2026: Quality MIS from the rework / rejection rows and the production of the lines
const row = (date, line, defect, total, extra = {}) => ({ date, line, lineName: `Line-${line}`, stage: 'FUNCTIONAL', brand: 'VOLTAS', model: 'M1', cat: 'PROCESS', defect, cause: '', action: '', hours: { 9: total }, total, rs: total * 55, kind: 'rework', ...extra });
const W = { rows: [
  row('2026-11-01', '1', 'TUB LEAK', 3, { cause: 'Seal not fixed', action: 'Training' }), row('2026-11-01', '1', 'Tub leak', 2), row('2026-11-01', '1', 'NOISE', 1),
  row('2026-11-02', '2', 'SPIN LID BROKEN', 4, { kind: 'reject' }), row('2026-10-31', '1', 'OLD', 9),
], hours: [9], totals: { total: 19, rs: 0, hours: { 9: 19 } } };
const day = (date, q1, q2) => ({ date, byLine: { 1: { ok: true, rows: [{ qty: q1 }, { qty: 5, future: true }] }, 2: { ok: true, rows: [{ qty: q2 }] } } });
const R = { days: [day('2026-11-01', 100, 0), day('2026-11-02', 50, 200)] };
const rca = { '2026-11-02|2|reject|SPIN LID BROKEN': { rootCause: 'Handling', action: 'Tray', owner: 'Vivek', status: 'closed', closeDate: '2026-11-03' } };

describe('quality MIS', () => {
  it('IPQC daily: defects and production per line and day (period only)', () => {
    const M = misData({ W, R, ids: ['1', '2'], rca, from: '2026-11-01', to: '2026-11-02' });
    expect(M.days).toEqual(['2026-11-01', '2026-11-02']);
    expect(M.lines.map((l) => [l.line, l.def, l.prod])).toEqual([['1', 6, 150], ['2', 4, 200]]);
    expect(M.lines[0].byDay['2026-11-01']).toEqual({ def: 6, prod: 100 });
  });
  it('top defects: the same defect (any case) is one row, most first, RCA owner and status', () => {
    const M = misData({ W, R, ids: ['1', '2'], rca, from: '2026-11-01', to: '2026-11-02' });
    expect(M.top.map((t) => [t.date, t.line, t.defect, t.qty])).toEqual([['2026-11-01', '1', 'TUB LEAK', 5], ['2026-11-01', '1', 'NOISE', 1], ['2026-11-02', '2', 'SPIN LID BROKEN', 4]]);
    expect(M.top[0].cause).toBe('Seal not fixed');
    expect(M.top[2]).toMatchObject({ cause: 'Handling', action: 'Tray', owner: 'Vivek', status: 'Closed 03-11-2026' });
  });
  it('summary and the workbook sheets', () => {
    const M = misData({ W, R, ids: ['1', '2'], rca, from: '2026-11-01', to: '2026-11-02' });
    expect(M.summary.map((s) => [s.line, s.defect, s.qty])).toEqual([['1', 'TUB LEAK', 5], ['1', 'NOISE', 1], ['2', 'SPIN LID BROKEN', 4]]);
    const sh = misSheets(M, W);
    expect(sh.map((s) => s.name)).toEqual(['IPQC(Daily)', 'Daily Top Defect Action', 'Summary', 'Hrly. Rework data(ipqc)']);
    const ip = sh[0].rows;
    // 27-11-2026: Date | Category | Total | Nov-26 | 1-Nov | 2-Nov — the total adds the month columns
    expect(ip[0].map((c) => c.v).slice(0, 4)).toEqual(['Date', 'Category', 'Total', 'Nov-26']); expect(ip[0].length).toBe(6);
    expect(ip[1][0].s).toBe('hprInput');
    expect(ip[1][1].v).toBe('Defect Qty'); expect(ip[1][2]).toMatchObject({ f: 'SUM(D2:D2)', v: 6 }); expect(ip[1][3].v).toBe(6);
    expect(ip[3][2].v).toBeCloseTo(6 / 150, 8);
    expect(ip[7][0].v).toBe('T. PRODUCTION'); expect(ip[7][2]).toMatchObject({ f: 'C3+C6', v: 350 });
    expect(ip[8][0].v).toBe('TGT'); expect(ip[8][2].v).toBe(0.033);
    const last = sh[2].rows[sh[2].rows.length - 1];
    expect(last[0].v).toBe('Grand Total'); expect(last[2].v).toBe(10);
    expect(misFileName('2026-11-25')).toBe('Quality_MIS_Nov-26.xlsx');
  });
});
