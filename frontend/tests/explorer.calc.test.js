// Model explorer (src/utils/modelExplorer.js): rows per model, P-Q class, multi-filters, sorting, group summaries, Excel.
import { describe, it, expect } from 'vitest';
import {
  buildExplorerRows, assignPqClass, filterRows, sortRows, groupRows, explorerKpis, optionCounts,
  weightBand, achievedBand, activeFilterText, explorerWorkbook, EMPTY_FILTERS, toggleSort,
} from '../src/utils/modelExplorer';

// one model = { mmId, model, modelCode, company, line, lineName, days: { date: { q, o, g: [gaps], h: [hours] } } }
const mk = (mmId, model, company, line, perDay, gap, days = 1) => {
  const d = {};
  for (let i = 0; i < days; i++) d[`2026-10-0${i + 1}`] = { q: perDay, o: 0, g: Array(perDay).fill(gap), h: Array(perDay).fill(10) };
  return { mmId, model, modelCode: `QX${mmId}`, company, line, lineName: `Line ${line}`, days: d };
};
const MODELS = [
  mk(1, 'WT70C3000RR', 'SAMSUNG', '3', 600, 14, 2),     // 1200 pcs, cycle 14
  mk(2, 'WT65FG-HALF', 'SAMSUNG', '3', 300, 15),        // 300 pcs
  mk(3, 'MWMSA075GDXKG', 'MIDEA', '4', 250, 20, 2),     // 500 pcs
  mk(4, 'UNO75.50SB2WNRD', 'GODREJ', '4', 100, 30),     // 100 pcs, above the 22 s default max → no valid cycles
  mk(5, 'TINY1', 'LLOYD', '2', 20, 12),                 // 20 pcs
];

describe('buildExplorerRows', () => {
  const rows = buildExplorerRows(MODELS, { win: { min: 1, max: 22 } });
  it('one row per model with pieces, days, line and company', () => {
    expect(rows).toHaveLength(5);
    const r = rows.find((x) => x.mmId === 1);
    expect(r).toMatchObject({ pcs: 1200, days: 2, line: '3', lineName: 'Line 3', company: 'SAMSUNG', key: '3:1' });
  });
  it('valid cycles, mean and achieved cycle use the valid window only', () => {
    const r = rows.find((x) => x.mmId === 1);
    expect(r.valid).toBe(1200);
    expect(r.mean).toBe(14);
    expect(r.achieved).toBe(14);
    const slow = rows.find((x) => x.mmId === 4);
    expect(slow.valid).toBe(0);
    expect(slow.achieved).toBe(null);
    expect(slow.achBand).toBe('none');
  });
  it('lid from the model name, weight band from the weight', () => {
    expect(rows.find((x) => x.mmId === 2).lid).toBe('full');   // FG in the name
    expect(weightBand(7)).toBe('lt20');
    expect(weightBand(25)).toBe('20-30');
    expect(weightBand(null)).toBe('unknown');
    expect(achievedBand(14)).toBe('11-15');
    expect(achievedBand(10)).toBe('le10');
    expect(achievedBand(31)).toBe('gt30');
  });
  it('a manual weight and a manual lid win', () => {
    const r = buildExplorerRows(MODELS, { win: { min: 1, max: 22 }, kgMap: { 3: '42' }, lidMap: { '4:3': 'half' } }).find((x) => x.mmId === 3);
    expect(r.kg).toBe(42);
    expect(r.kgFrom).toBe('manual');
    expect(r.lid).toBe('half');
    expect(r.weightT).toBeCloseTo(500 * 42 / 1000, 6);
  });
});

describe('assignPqClass — A = first 80 % of pieces, B = up to 95 %, C = rest', () => {
  const rows = assignPqClass(buildExplorerRows(MODELS, { win: { min: 1, max: 22 } }));
  it('share and cumulative share in pieces order', () => {
    const top = rows.find((r) => r.mmId === 1);
    expect(top.share).toBeCloseTo(1200 / 2120 * 100, 6);
    expect(top.rank).toBe(1);
  });
  it('classes', () => {
    const cls = Object.fromEntries(rows.map((r) => [r.mmId, r.cls]));
    // same rule as Model analysis: class by the cumulative share BEFORE the model
    // 1 (0 % before) A · 3 (56.6 % before) A · 2 (80.2 %) B · 4 (94.3 %) B · 5 (99.1 %) C
    expect(cls).toEqual({ 1: 'A', 3: 'A', 2: 'B', 4: 'B', 5: 'C' });
  });
});

describe('filterRows — every filter is "any of the selected"; filters combine with AND', () => {
  const all = assignPqClass(buildExplorerRows(MODELS, { win: { min: 1, max: 22 } }));
  it('no filter → everything', () => {
    expect(filterRows(all, EMPTY_FILTERS)).toHaveLength(5);
  });
  it('several companies at once (like Excel)', () => {
    const f = { ...EMPTY_FILTERS, companies: ['SAMSUNG', 'MIDEA'] };
    expect(filterRows(all, f).map((r) => r.mmId).sort()).toEqual([1, 2, 3]);
  });
  it('company + class + line together', () => {
    const f = { ...EMPTY_FILTERS, companies: ['SAMSUNG', 'MIDEA'], classes: ['A'], lines: ['4'] };
    expect(filterRows(all, f).map((r) => r.mmId)).toEqual([3]);
  });
  it('lid, weight band, achieved band', () => {
    expect(filterRows(all, { ...EMPTY_FILTERS, lids: ['full'] }).map((r) => r.mmId)).toEqual([2]);
    expect(filterRows(all, { ...EMPTY_FILTERS, achBands: ['none'] }).map((r) => r.mmId)).toEqual([4]);
  });
  it('ranges: achieved cycle and weight (min / max, empty = open)', () => {
    expect(filterRows(all, { ...EMPTY_FILTERS, achMin: 13, achMax: 16 }).map((r) => r.mmId).sort()).toEqual([1, 2]);
    const withKg = all.map((r) => (r.mmId === 3 ? { ...r, kg: 42 } : r));
    expect(filterRows(withKg, { ...EMPTY_FILTERS, kgMin: 40 }).map((r) => r.mmId)).toEqual([3]);
  });
  it('search in model, code and company; minimum pieces', () => {
    expect(filterRows(all, { ...EMPTY_FILTERS, q: 'midea' }).map((r) => r.mmId)).toEqual([3]);
    expect(filterRows(all, { ...EMPTY_FILTERS, minPcs: 200 })).toHaveLength(3);
  });
});

describe('sortRows / toggleSort', () => {
  const all = assignPqClass(buildExplorerRows(MODELS, { win: { min: 1, max: 22 } }));
  it('by pieces descending, then by company ascending', () => {
    expect(sortRows(all, [{ key: 'pcs', dir: 'desc' }]).map((r) => r.mmId)).toEqual([1, 3, 2, 4, 5]);
    expect(sortRows(all, [{ key: 'company', dir: 'asc' }, { key: 'pcs', dir: 'desc' }]).map((r) => r.mmId)).toEqual([4, 5, 3, 1, 2]);
  });
  it('empty values always last', () => {
    expect(sortRows(all, [{ key: 'achieved', dir: 'asc' }]).pop().mmId).toBe(4);
    expect(sortRows(all, [{ key: 'achieved', dir: 'desc' }]).pop().mmId).toBe(4);
  });
  it('click = sort by that column (desc for numbers, asc for text), click again = reverse, shift = add a level', () => {
    let s = toggleSort([], 'pcs', false, 'number');
    expect(s).toEqual([{ key: 'pcs', dir: 'desc' }]);
    s = toggleSort(s, 'pcs', false, 'number');
    expect(s).toEqual([{ key: 'pcs', dir: 'asc' }]);
    s = toggleSort(s, 'company', true, 'text');
    expect(s).toEqual([{ key: 'pcs', dir: 'asc' }, { key: 'company', dir: 'asc' }]);
    expect(toggleSort(s, 'model', false, 'text')).toEqual([{ key: 'model', dir: 'asc' }]);
  });
});

describe('groupRows / explorerKpis / optionCounts', () => {
  const all = assignPqClass(buildExplorerRows(MODELS, { win: { min: 1, max: 22 } }));
  it('group by company: models, pieces, share, weighted mean cycle', () => {
    const g = groupRows(all, 'company');
    const s = g.find((x) => x.value === 'SAMSUNG');
    expect(s).toMatchObject({ models: 2, pcs: 1500 });
    expect(s.share).toBeCloseTo(1500 / 2120 * 100, 6);
    expect(s.mean).toBeCloseTo((1200 * 14 + 300 * 15) / 1500, 6);
    expect(g[0].value).toBe('SAMSUNG');   // biggest first
  });
  it('group by class keeps A, B, C order', () => {
    expect(groupRows(all, 'cls').map((x) => x.value)).toEqual(['A', 'B', 'C']);
  });
  it('KPIs of the filtered set against all', () => {
    const k = explorerKpis(filterRows(all, { ...EMPTY_FILTERS, companies: ['SAMSUNG'] }), all);
    expect(k).toMatchObject({ models: 2, pcs: 1500, allPcs: 2120, companies: 1 });
    expect(k.sharePct).toBeCloseTo(1500 / 2120 * 100, 6);
  });
  it('option counts for the filter lists (value, label, models)', () => {
    const c = optionCounts(all, 'company');
    expect(c[0]).toEqual({ value: 'SAMSUNG', label: 'SAMSUNG', count: 2, pcs: 1500 });
  });
});

describe('activeFilterText / explorerWorkbook', () => {
  const all = assignPqClass(buildExplorerRows(MODELS, { win: { min: 1, max: 22 } }));
  const f = { ...EMPTY_FILTERS, companies: ['SAMSUNG', 'MIDEA'], classes: ['A'], achMin: 10 };
  it('readable list of the filters in use', () => {
    expect(activeFilterText(f)).toEqual(['Company: SAMSUNG, MIDEA', 'P-Q class: A', 'Achieved cycle ≥ 10 s']);
    expect(activeFilterText(EMPTY_FILTERS)).toEqual([]);
  });
  it('workbook: filtered models + one sheet per grouping, with headers, totals, filter and freeze', () => {
    const rows = filterRows(all, f);
    const wb = explorerWorkbook(rows, all, f, { lineLabel: 'All lines', start: '2026-10-01', end: '2026-10-02', generatedAt: new Date(2026, 9, 26, 12, 0), allLines: true, sort: [{ key: 'pcs', dir: 'desc' }] });
    expect(wb.fileName).toBe('ModelExplorer_Alllines_2026-10-01_to_2026-10-02.xlsx');
    expect(wb.sheets.map((s) => s.name)).toEqual(['Models', 'By company', 'By line', 'By P-Q class', 'By glass', 'By weight', 'By achieved cycle']);
    const m = wb.sheets[0];
    const head = m.rows.find((r) => r[0]?.v === '#');
    expect(head.map((c) => c.v)).toContain('Achieved cycle (s)');
    expect(head.map((c) => c.v)).toContain('P-Q class');
    expect(m.autoFilter).toMatch(/^A\d+:[A-Z]+\d+$/);
    expect(m.freezeRow).toBeGreaterThan(1);
    const flat = JSON.stringify(m.rows);
    expect(flat).toContain('Company: SAMSUNG, MIDEA');   // the filters are written on the sheet
    const total = m.rows.find((r) => r[0]?.v === 'Total');
    expect(total.some((c) => c.v === 1700)).toBe(true);   // 1200 + 500 pieces
  });
  it('single line: no "By line" sheet', () => {
    const wb = explorerWorkbook(all, all, EMPTY_FILTERS, { lineLabel: 'Line 3', start: '2026-10-01', end: '2026-10-02', generatedAt: new Date(), allLines: false });
    expect(wb.sheets.map((s) => s.name)).not.toContain('By line');
  });
});
