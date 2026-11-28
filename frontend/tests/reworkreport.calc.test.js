// Hourly rework data (IPQC) sheet — the plant's Book1 (src/utils/reworkReport.js) and the dismantle defects (kpiStages.js).
import { describe, it, expect } from 'vitest';
import { reworkSheet, groupRows, reworkXlsxSheet, hourCol, lineName, monthName, RWK_RATE } from '../src/utils/reworkReport';
import { isDismantleDefect, DEFECT_TAG } from '../src/utils/kpiStages';

const ST = [{ reason: 'Functional', code: 'FUN' }, { reason: 'Leakage Inspection', code: 'LKG', aliases: ['Leak test'] }];
const E = (rework = [], rejects = []) => ({ stops: [], losses: [], rejects, rework, note: '' });
const entries = {
  '2026-04-07|1|10': E([{ station: 'Functional', model: 'WTT70DLIM5', reason: 'Spin tub nut loose', cat: 'Process', cause: 'Nut loose', action: 'Nut fix', qty: 1 }]),
  '2026-04-07|1|11': E([{ station: 'FUN', model: 'WTT70DLIM5', reason: 'Spin tub nut loose', cat: 'Process', cause: 'Nut loose', action: 'Nut fix', qty: 1 }]),
  '2026-04-07|1|12': E([{ station: 'Leak test', model: 'WTT70DLIM5', reason: 'Drain core lock broken', cat: 'Process', cause: 'Handling issue', action: 'Dismental', qty: 1, dismantle: 1 }]),
  '2026-04-07|1|13': E([], [{ station: 'Leakage Inspection', model: 'WTT70DLIM5', reason: 'Drain core lock broken', cat: 'Process', cause: 'Handling issue', action: 'Dismental', qty: 1, dismantle: 1 }]),
  '2026-04-08|3|21': E([{ station: 'Functional', model: 'WT80C4200GG/TL', reason: 'Angle not good', qty: 2 }]),
};
const S = reworkSheet({ entries, start: '2026-04-01', end: '2026-04-30', stations: ST, companyOf: (m) => (m.startsWith('WTT') ? 'VOLTAS' : 'SAMSUNG') });

describe('rework sheet (Book1)', () => {
  it('one row per day · line · stage · model · category · defect · cause · action, hours spread', () => {
    expect(S.rows.length).toBe(3);
    const a = S.rows[0];
    expect([a.sr, a.month, a.lineName, a.stage, a.brand, a.defect, a.total]).toEqual([1, 'April', 'Line-1 C8', 'Functional', 'VOLTAS', 'Spin tub nut loose', 2]);
    expect(a.hours).toEqual({ 10: 1, 11: 1 });
    expect(a.rs).toBe(2 * RWK_RATE);
  });
  it('rework and rejection of the same defect are one row (station alias → stage), dismantled counted', () => {
    const b = S.rows[1];
    expect([b.stage, b.total, b.dismantle, b.kind]).toEqual(['Leakage Inspection', 2, 2, 'rework + reject']);
  });
  it('an hour outside 09–21 gets its own column; totals add up', () => {
    expect(S.hours).toContain(21);
    expect(S.totals.total).toBe(6);
    expect(S.totals.hours[21]).toBe(2);
    expect(S.totals.rs).toBe(6 * RWK_RATE);
  });
  it('rework only', () => {
    const R = reworkSheet({ entries, stations: ST, kinds: ['rework'] });
    expect(R.totals.total).toBe(5);
  });
  it('group by stage', () => {
    expect(groupRows(S.rows, 'stage').map((g) => [g.key, g.total])).toEqual([['Functional', 4], ['Leakage Inspection', 2]]);
  });
  it('xlsx layout: title, totals row, header with the hours, INR', () => {
    const sh = reworkXlsxSheet(S);
    expect(sh.rows[0][0].v).toBe('Line Rejection');
    expect(sh.rows[2].map((c) => c.v).slice(0, 13)).toEqual(['SR. NO.', 'DATE', 'Stage', 'Line', 'BRAND', 'MODEL', 'Category', 'Department', 'DEFECT DESCRIPTION', 'ROOT CAUSE', 'ACTION', 'Total', '09-10']);
    expect(sh.rows[2][sh.rows[2].length - 1].v).toBe('INR (Rs)');
    expect(sh.rows[1][11].v).toBe(6);
    expect(sh.rows[3][2].v).toBe('FUNCTIONAL'); expect(sh.rows[3][1].s).toBe('rwDate'); expect(typeof sh.rows[3][1].v).toBe('number');
  });
  it('helpers', () => {
    expect(hourCol(9)).toBe('09-10'); expect(hourCol(23)).toBe('23-00');
    expect(lineName('3')).toBe('Line-3 C3'); expect(monthName('2026-11-20')).toBe('November');
  });
});

describe('dismantle defects (Defect Tag)', () => {
  it('the Dismantle sheet defects and leaks of tub / drain / bellow', () => {
    expect(isDismantleDefect('Tub leakage')).toBe(true);
    expect(isDismantleDefect('Drain assy leak')).toBe(true);
    expect(isDismantleDefect('Seal bellow leakage')).toBe(true);
    expect(isDismantleDefect('Base breakage')).toBe(true);
    expect(isDismantleDefect('Knob scratch')).toBe(false);
    expect(isDismantleDefect('Pulsator touching')).toBe(false);
  });
  it('six stages have defects', () => { expect(Object.keys(DEFECT_TAG).length).toBe(6); expect(DEFECT_TAG[2]).toContain('Pulsator touching'); });
});
