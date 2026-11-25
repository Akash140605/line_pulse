// Calculation / export tests for the Control charts "Model-wise summary" table (src/utils/controlReport.js).
import { describe, it, expect } from 'vitest';
import { summaryRows, SUMMARY_COLUMNS, summaryWorkbook, lidKey } from '../src/utils/controlReport';

const mk = (id, model, vals, extra = {}) => ({
  a: {
    m: { mmId: id, model, modelCode: `C${id}`, company: 'VOLTAS', line: 2, lineName: 'Line 2' },
    scans: vals.length + 3, vals, aboveMax: 2, below: 1, above: 0, over: 0, allGaps: vals.concat([500, 0.5, 900]),
    mu: vals.reduce((s, v) => s + v, 0) / vals.length, sd: 2.5, med: 15, win: { lo: 1, hi: 60 }, chart: { signals: 1 },
  },
  u: { v: 16, src: 'Takt' }, cap: { cpk: 0.8, within: 70 }, removed: 4.2, ...extra,
});
const overview = [
  mk(1, 'AKSA-85DRTG', [14.2, 14.9, 15, 15.1, 13]),
  mk(2, 'WT70C3000RR', [20, 20, 21]),
  mk(3, 'ZZ-UNKNOWN-1', [30]),
];

describe('summaryRows', () => {
  const rows = summaryRows(overview, { [lidKey(2, 3)]: 'half' }, '2');
  it('one row per model, numbered, with the achieved cycle of the 1-second histogram', () => {
    expect(rows.map((r) => r.no)).toEqual([1, 2, 3]);
    expect(rows[0].achieved).toBe(15);
    expect(rows[0].achievedCount).toBe(3);
    expect(rows[0].achievedShare).toBeCloseTo(60, 6);
    expect(rows[1].achieved).toBe(20);
  });
  it('lid: list, list-without-glass-word and manual override', () => {
    expect(rows[0]).toMatchObject({ lid: 'full', lidSource: 'list' });
    expect(rows[1]).toMatchObject({ lid: 'none', lidSource: 'list' });
    expect(rows[2]).toMatchObject({ lid: 'half', lidSource: 'manual' });
  });
  it('carries the numbers shown on screen', () => {
    expect(rows[0]).toMatchObject({ scans: 8, valid: 5, aboveMax: 2, removed: 4.2, cpk: 0.8, within: 70, signals: 1, limit: 16, limitSrc: 'Takt' });
    expect(rows[0].cv).toBeCloseTo((2.5 / rows[0].mean) * 100, 6);
  });
  it('lid key is per line (the same MMId means different models on different lines)', () => {
    expect(lidKey(2, 3)).not.toBe(lidKey(3, 3));
  });
});

describe('Excel workbook', () => {
  const rows = summaryRows(overview, {}, '2');
  const meta = { lineLabel: 'Line 2', start: '2026-10-01', end: '2026-10-23', generatedAt: new Date(2026, 9, 24, 16, 30), windowText: 'Manual 1–60 s', by: 'Daily', allLines: false };
  it('every column getter works on every row', () => {
    for (const r of rows) for (const c of SUMMARY_COLUMNS) expect(() => c[2](r)).not.toThrow();
  });
  it('sheet has title, line, period, date, legend, header, rows and a total row', () => {
    const { sheets, fileName } = summaryWorkbook(rows, meta);
    const flat = sheets[0].rows.map((r) => (r || []).map((c) => (c ? c.v : null)));
    const text = JSON.stringify(flat);
    expect(text).toContain('Line 2');
    expect(text).toContain('01-10-2026 to 23-10-2026');
    expect(text).toContain('24-10-2026 16:30');
    expect(text).toContain('● Full glass');
    expect(text).toContain('◐ Half glass');
    expect(text).toContain('Achieved cycle (s)');
    const head = flat.findIndex((r) => r[0] === '#');
    expect(head).toBeGreaterThan(0);
    expect(flat[head + 1][1]).toBe('AKSA-85DRTG');
    const total = flat.find((r) => r[0] === 'Total');
    expect(total).toBeTruthy();
    expect(sheets[0].autoFilter).toMatch(/^A\d+:[A-Z]+\d+$/);
    expect(fileName).toBe('ModelSummary_Line2_2026-10-01_to_2026-10-23.xlsx');
  });
  it('the lid cell shows the symbol and the word', () => {
    const { sheets } = summaryWorkbook(rows, meta);
    const flat = sheets[0].rows.map((r) => (r || []).map((c) => (c ? c.v : null)));
    const head = flat.findIndex((r) => r[0] === '#');
    const col = flat[head].indexOf('Lid');
    expect(flat[head + 1][col]).toBe('● Full glass');
    expect(flat[head + 2][col]).toBe('○ No glass');
    expect(flat[head + 3][col]).toBe('? Not known');
  });
});

describe('weight (kg) in the summary', () => {
  const ov = [mk(1, 'WT80C4000RR', [12, 12, 13]), mk(2, 'ZZ-UNKNOWN-1', [30]), mk(3, 'WT70C3000RR', [11])];
  ov[0].a.m.modelCode = '1MFX'; ov[2].a.m.modelCode = '1N57';
  const rows = summaryRows(ov, {}, '3', { 3: '7.5' });
  it('weight comes from the master list / series rule, the Standard cycle time manual value wins', () => {
    expect(rows[0].kg).toBe(8);
    expect(['list', 'confirmed', 'from code', 'series']).toContain(rows[0].kgFrom);
    expect(rows[1].kg).toBe(null);
    expect(rows[1].kgFrom).toBe('not set');
    expect(rows[2]).toMatchObject({ kg: 7.5, kgFrom: 'manual' });
  });
  it('Excel has Weight (kg) and Weight from columns next to the lid', () => {
    const { sheets } = summaryWorkbook(rows, { lineLabel: 'Line 3', start: '2026-08-01', end: '2026-10-24', generatedAt: new Date(2026, 9, 24, 17, 0) });
    const flat = sheets[0].rows.map((r) => (r || []).map((c) => (c ? c.v : null)));
    const head = flat.findIndex((r) => r[0] === '#');
    const k = flat[head].indexOf('Weight (kg)');
    expect(k).toBe(flat[head].indexOf('Lid') + 2);
    expect(flat[head + 1][k]).toBe(8);
    expect(flat[head + 3][k]).toBe(7.5);
    expect(flat[head + 1][k + 1]).not.toBe(null);
  });
});
