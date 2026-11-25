// Per-line target method (Line target method page) and per-hour model running time (hour table).
import { describe, it, expect } from 'vitest';
import { lineCfg, lineTargets, cycleBy, lineRows } from '../src/utils/targetMethods';
import { normalizeRule, ruleKeyOf } from '../src/utils/uiSettings';
import { modelActualCycles } from '../src/utils/targets';

const gaps = [...Array(40).fill(11.6), ...Array(20).fill(13.2), ...Array(20).fill(15.5), ...Array(10).fill(19.1), ...Array(5).fill(29), ...Array(5).fill(600)];
const m1 = { mmId: 'L1-7', model: 'WT70', company: 'SAMSUNG', line: '1', days: { '2026-10-20': { q: 101, g: gaps } } };
const m2 = { ...m1, mmId: 'L2-7', line: '2' };

describe('target rule per line', () => {
  it('old rule without lines: every line Method A + the rule allowance', () => {
    const r = normalizeRule({ from: '2026-08-01', add: 3, cap: 22, min: 20 });
    expect(r.lines['1']).toEqual({ method: 'A', add: 3, pct: 70 });
    expect(r.lines['4']).toEqual({ method: 'A', add: 3, pct: 70 });
  });
  it('bad values are cleaned; B and C start with 0 s allowance', () => {
    const r = normalizeRule({ lines: { 1: { method: 'X' }, 2: { method: 'B', pct: 99 }, 3: { method: 'C', add: '1.5' } } });
    expect(r.lines['1'].method).toBe('A');
    expect(r.lines['2']).toEqual({ method: 'B', add: 0, pct: 95 });
    expect(r.lines['3']).toEqual({ method: 'C', add: 1.5, pct: 70 });
  });
  it('the key changes when a line method changes', () => {
    const a = normalizeRule({}), b = normalizeRule({ lines: { 2: { method: 'B' } } });
    expect(ruleKeyOf(a)).not.toBe(ruleKeyOf(b));
    expect(ruleKeyOf(a)).toBe(ruleKeyOf(normalizeRule({})));
  });
  it('each line gets the target of its own method', () => {
    const rule = normalizeRule({ lines: { 1: { method: 'A', add: 3 }, 2: { method: 'B', add: 0, pct: 70 } } });
    expect(lineTargets([m1, m2], rule, '1')).toEqual({ 7: { cycle: 15, model: 'WT70', company: 'SAMSUNG', method: 'A' } });   // 12 + 3
    expect(lineTargets([m1, m2], rule, '2')).toEqual({ 7: { cycle: 16, model: 'WT70', company: 'SAMSUNG', method: 'B' } });   // 70 % within 16 s
    expect(lineTargets([m1, m2], rule, '2', { method: 'C', add: 1 })['7'].cycle).toBe(14.7);                                 // 13.7 + 1
    expect(lineTargets([m1, m2], rule, '3')).toEqual({});                                                                     // no models on line 3
  });
  it('B % per line', () => {
    const rule = normalizeRule({ lines: { 1: { method: 'B', pct: 50 } } });
    expect(lineCfg(rule, '1')).toEqual({ method: 'B', add: 0, pct: 50 });
    expect(cycleBy(lineRows([m1], rule, '1')[0], 'B', 0)).toBe(14);   // 50 % of 90 = 45: 40 by 12 s, 60 by 14 s
  });
});

describe('model running time per hour', () => {
  it('sum and mean of the valid gaps of each hour', () => {
    const models = [{ mmId: 'L1-7', days: { '2026-10-20': { q: 6, g: [12, 14, 600, 10, 30, 11], h: [9, 9, 10, 10, 10, 11] } } }];
    const a = modelActualCycles(models, '2026-10-20', 22)['7'];
    expect(a.byHour[9]).toEqual({ n: 2, sec: 26, mean: 13, min: 26 / 60 });
    expect(a.byHour[10].n).toBe(1);            // 600 s and 30 s are stops
    expect(a.byHour[10].sec).toBe(10);
    expect(a.byHour[11].mean).toBe(11);
  });
});
