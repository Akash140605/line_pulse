// 20-11-2026: target method by date — utils/uiSettings normalizePlan, utils/targetMethods linePeriods / lineCfg, utils/targetPeriods.
import { describe, it, expect } from 'vitest';
import { normalizeRule, normalizePlan, ruleKeyOf } from '../src/utils/uiSettings';
import { linePeriods, lineCfg, sameCfg } from '../src/utils/targetMethods';
import { targetsOn, settingsOn, periodOn } from '../src/utils/targetPeriods';
import { lossMatrix } from '../src/utils/money';

const rule = normalizeRule({ lines: { 1: { method: 'A' }, 2: { method: 'D' } }, plan: [
  { line: '1', from: '2026-11-15', method: 'D' },
  { line: '1', from: '2026-10-01', method: 'B', pct: 80 },
  { line: '2', from: '2026-11-10', method: 'C' },
] });

describe('normalizePlan', () => {
  it('drops bad rows, one per line and day (last wins), sorted', () => {
    const p = normalizePlan([{ line: '1', from: '2026-11-15', method: 'D' }, { line: '1', from: '2026-11-15', method: 'B', pct: 99 }, { line: '9', from: '2026-11-01', method: 'A' },
      { line: '2', from: '2026-02-30', method: 'A' }, { line: '2', from: '2026-11-01', method: 'Z' }, null, { line: '1', from: '2026-09-01', method: 'C', note: 'a <b>' }]);
    expect(p.map((x) => `${x.line}@${x.from}:${x.method}`)).toEqual(['1@2026-09-01:C', '1@2026-11-15:B']);
    expect(p[1].pct).toBe(95);
    expect(p[0].note).toBe('a b');
  });
  it('is part of the rule key (targets worked out again when a dated change is added)', () => {
    expect(ruleKeyOf(rule)).not.toBe(ruleKeyOf(normalizeRule({ lines: { 1: { method: 'A' }, 2: { method: 'D' } } })));
  });
});

describe('linePeriods / lineCfg by date', () => {
  it('line 1: A → B from 01-10 → D from 15-11', () => {
    const P = linePeriods(rule, '1');
    expect(P.map((p) => [p.from, p.to, p.method])).toEqual([[null, '2026-09-30', 'A'], ['2026-10-01', '2026-11-14', 'B'], ['2026-11-15', null, 'D']]);
    expect(P[1].pct).toBe(80);
    expect(lineCfg(rule, '1', '2026-09-30').method).toBe('A');
    expect(lineCfg(rule, '1', '2026-10-01').method).toBe('B');
    expect(lineCfg(rule, '1', '2026-11-14').method).toBe('B');
    expect(lineCfg(rule, '1', '2026-11-15').method).toBe('D');
    expect(lineCfg(rule, '1', '2027-01-01').method).toBe('D');
  });
  it('a line without dated changes keeps one period', () => {
    expect(linePeriods(rule, '3')).toHaveLength(1);
    expect(lineCfg(rule, '3', '2026-11-20').method).toBe('A');
    expect(lineCfg(rule, '2', '2026-11-09').method).toBe('D');
    expect(lineCfg(rule, '2', '2026-11-10').method).toBe('C');
  });
  it('allowance: A defaults to the rule allowance, others 0', () => {
    expect(lineCfg(rule, '1', '2026-09-01').add).toBe(3);
    expect(lineCfg(rule, '1', '2026-11-20').add).toBe(0);
    expect(sameCfg({ method: 'B', add: 0, pct: 70 }, { method: 'B', add: 0, pct: 80 })).toBe(false);
    expect(sameCfg({ method: 'A', add: 3, pct: 70 }, { method: 'A', add: 3, pct: 80 })).toBe(true);
  });
});

describe('targets of the day', () => {
  const st = { targets: { 7: { cycle: 30 } }, targetPeriods: [{ from: null, to: '2026-11-14', method: 'A', targets: { 7: { cycle: 20 } } }, { from: '2026-11-15', to: null, method: 'D', targets: { 7: { cycle: 30 } } }] };
  it('picks the period of the day', () => {
    expect(targetsOn(st, '2026-11-01')[7].cycle).toBe(20);
    expect(targetsOn(st, '2026-11-15')[7].cycle).toBe(30);
    expect(periodOn(st, '2026-11-14').method).toBe('A');
    expect(settingsOn(st, '2026-11-01').targets[7].cycle).toBe(20);
    expect(targetsOn({ targets: { 1: { cycle: 9 } } }, '2026-11-01')[1].cycle).toBe(9);   // no periods: today's targets
  });
  it('loss of each day uses its own method: 1 h, 120 pcs at 20 s (A) = 100 % … at 30 s (D) = 150 %', () => {
    const hours = (d) => [[d, 10, 7, 120]];
    const line = { line: '1', name: 'Line 1', ok: true, models: [{ mmId: 7, model: 'M7' }], daily: [], dhm: [...hours('2026-11-14'), ...hours('2026-11-16')] };
    const shift = { start: '10:00', end: '11:00', lunchStart: '13:00', lunchEnd: '13:30' };
    const mx = lossMatrix([line], { 1: { ...st, shift } }, { now: new Date(2026, 10, 20, 12), range: { start: '2026-11-14', end: '2026-11-16' } });
    const d = mx.lines[0].days;
    expect(Math.round(d['2026-11-14'].target)).toBe(180);   // 3600 / 20 s
    expect(Math.round(d['2026-11-16'].target)).toBe(120);   // 3600 / 30 s
  });
});
