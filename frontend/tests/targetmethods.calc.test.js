// Three target methods (src/utils/targetMethods.js).
import { describe, it, expect } from 'vitest';
import { percentileSecond, modelMethods, methodRows, targetsOf, lineComparison } from '../src/utils/targetMethods';

// 100 gaps: 40 at 12 s, 20 at 14 s, 20 at 16 s, 10 at 20 s, 5 at 30 s, 5 at 600 s (stops)
const gaps = [...Array(40).fill(11.6), ...Array(20).fill(13.2), ...Array(20).fill(15.5), ...Array(10).fill(19.1), ...Array(5).fill(29), ...Array(5).fill(600)];
const model = { mmId: 'L1-7', model: 'WT70', company: 'SAMSUNG', line: '1', days: { '2026-10-20': { q: 101, g: gaps } } };

describe('methods', () => {
  it('percentile second', () => {
    expect(percentileSecond([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 70)).toEqual({ sec: 7, upTo: 7, share: 70 });
    expect(percentileSecond([], 70)).toBe(null);
  });
  const r = modelMethods({ ...model, mmId: 7 });
  it('A = most common second after leaving out gaps above 22 s', () => {
    expect(r.A.sec).toBe(12);
    expect(r.A.kept).toBe(90);           // 30 s and 600 s gaps left out
    expect(r.A.removed).toBe(10);
    expect(r.A.upTo).toBe(40);
    expect(Math.round(r.A.share * 10) / 10).toBe(44.4);
    expect(r.A.target).toBe(15);         // 12 s + 3 s allowance
    expect(r.A.pph).toBe(240);           // 3600 ÷ 15
    expect(modelMethods({ ...model, mmId: 7 }, { addA: 0 }).A.pph).toBe(300);
  });
  it('B = second within which 70 % of the valid pieces (gaps 1–22 s, as Control charts) were made', () => {
    expect(r.B.kept).toBe(90);           // same valid scans as A: 30 s and 600 s gaps left out
    expect(r.B.sec).toBe(16);            // 70 % of 90 = 63: 60 (67 %) by 14 s, 80 (89 %) by 16 s
    expect(r.B.upTo).toBe(80);
    expect(Math.round(r.B.share * 10) / 10).toBe(88.9);
    expect(r.B.pph).toBe(225);
    expect(Math.round(r.diffPct)).toBe(7);    // A (12 + 3 s) asks 7 % more pieces per hour than B
  });
  it('C = control chart centre line: mean of the gaps 1–22 s, to 0.1 s', () => {
    expect(r.C.sec).toBe(13.7);          // (40×11.6 + 20×13.2 + 20×15.5 + 10×19.1) ÷ 90 = 13.66
    expect(r.C.kept).toBe(90);
    expect(r.C.upTo).toBe(60);           // 11.6 s and 13.2 s gaps are at 13.7 s or faster
    expect(Math.round(r.C.share * 10) / 10).toBe(66.7);
    expect(Math.round(r.C.pph)).toBe(263);
    expect(targetsOf(methodRows([model]), '1', 'C')).toEqual({ 7: { cycle: 13.7, model: 'WT70', company: 'SAMSUNG' } });
  });
  it('quantity, days, average running cycle', () => {
    expect([r.qty, r.days]).toEqual([101, 1]);
    expect(Math.round(r.avg * 10) / 10).toBe(13.7);
  });
  it('settings change the result', () => {
    expect(modelMethods({ ...model, mmId: 7 }, { pctB: 50 }).B.sec).toBe(14);
    expect(modelMethods({ ...model, mmId: 7 }, { capA: 10 }).tooFew).toBe(true);
  });
  it('rows strip the line prefix; targets per line', () => {
    const rows = methodRows([model]);
    expect(rows[0].mmId).toBe('7');
    expect(targetsOf(rows, '1', 'A')).toEqual({ 7: { cycle: 15, model: 'WT70', company: 'SAMSUNG' } });
    expect(targetsOf(rows, '2', 'A')).toEqual({});
  });
});

describe('line comparison', () => {
  const SHIFT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
  const dhm = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => ['2026-10-20', h, 7, h === 13 ? 100 : 200]);
  const lines = [{ line: '1', name: 'Line 1', ok: true, models: [], daily: [], dhm }];
  const rows = methodRows([model]);
  const c = lineComparison(lines, { 1: { shift: SHIFT, targets: {}, money: { pcValue: 10 } } }, rows, { now: new Date('2026-10-27T10:00:00') });
  it('A asks more than B; saved targets none', () => {
    const l = c.lines[0];
    expect(l.actual).toBe(2300);
    expect(l.saved.target).toBe(null);
    expect(Math.round(l.A.target)).toBe(2760);    // 11.5 h × 240 (A 12 s + 3 s)
    expect(Math.round(l.B.target)).toBe(2588);    // 11.5 h × 225
    expect(Math.round(l.A.pct)).toBe(83);
    expect(Math.round(l.B.pct)).toBe(89);
    expect(Math.round(l.A.rsTotal)).toBe(4600);
    expect(Math.round(c.total.B.target)).toBe(2588);
    expect(Math.round(l.C.target)).toBe(3022);    // 11.5 h × 3600 ÷ 13.7
    expect(Math.round(l.C.pct)).toBe(76);
  });
});

describe('valid scans: the lowest gap too (double scans / glitches eliminated)', () => {
  // 30 gaps of 12 s, 10 double scans of 0.4 s, 6 gaps of 3 s, 4 stops of 300 s
  const g = [...Array(30).fill(12), ...Array(10).fill(0.4), ...Array(6).fill(3), ...Array(4).fill(300)];
  const m = { mmId: 1, model: 'X', days: { '2026-11-01': { q: 51, g } } };
  it('default 1 s: gaps below 1 s and above 22 s eliminated', () => {
    const r = modelMethods(m);
    expect(r.low).toBe(1); expect(r.belowLow).toBe(10); expect(r.aboveCap).toBe(4); expect(r.valid).toBe(36); expect(r.A.kept).toBe(36);
  });
  it('minimum 5 s: the 3 s gaps go too; the average is the 12 s run', () => {
    const r = modelMethods(m, { lowA: 5 });
    expect(r.belowLow).toBe(16); expect(r.A.kept).toBe(30); expect(r.avg).toBe(12); expect(r.A.sec).toBe(12); expect(r.A.share).toBe(100);
  });
  it('minimum 0: nothing below is eliminated', () => {
    const r = modelMethods(m, { lowA: 0 });
    expect(r.belowLow).toBe(0); expect(r.A.kept).toBe(46);
  });
});

import { setMasterRows, masterFor, masterAnyFor } from '../src/utils/targetMethods';
import { mergeTargets } from '../src/hooks/useAutoTargets';
describe('models without a cycle time in the master (16-11-2026)', () => {
  it('masterFor (target) skips a row without cycle; masterAnyFor (details) still finds it', () => {
    setMasterRows([{ company: 'SAMSUNG', model: 'WT10C4260GG', cycle: null, segment: 'TL' }, { company: 'MIDEA', model: 'MWMSA075GDXKG', cycle: 14 }]);
    expect(masterFor({ model: 'WT10C4260GG', company: 'SAMSUNG' })).toBe(null);
    expect(masterAnyFor({ model: 'WT10C4260GG', company: 'SAMSUNG' }).segment).toBe('TL');
    expect(masterFor({ model: 'MWMSA075GDXKG', company: 'MIDEA' }).cycle).toBe(14);
    expect(masterAnyFor({ model: 'NOT-THERE-123', company: 'X' })).toBe(null);
  });
  it('Method D: a target once locked from the master is dropped when the master has no cycle for it; an admin lock stays', () => {
    const saved = { 1: { cycle: 13, manual: true, source: 'master' }, 2: { cycle: 15, manual: true }, 3: { cycle: 12 } };
    const auto = { 4: { cycle: 14 } };
    expect(Object.keys(mergeTargets(saved, auto, true)).sort()).toEqual(['2', '4']);
    expect(Object.keys(mergeTargets(saved, { ...auto, 1: { cycle: 13 } }, true)).sort()).toEqual(['1', '2', '4']);
  });
});
