import { describe, it, expect } from 'vitest';
import { stageDetail } from '../src/utils/kpiStages';

// 25-11-2026: Quality dashboard → click a stage → the defects, lines, models, hours of that stage
describe('stage detail of the quality dashboard', () => {
  const rows = [
    { date: '2026-11-01', line: '1', stage: 'Leak test', model: 'A', defect: 'Seal bellow leakage', cat: 'Part', cause: 'x', hours: { 9: 2, 10: 1 }, total: 3, dismantle: 1 },
    { date: '2026-11-02', line: '2', stage: 'FQC', model: 'B', defect: 'Dirty', hours: { 11: 2 }, total: 2, dismantle: 0 },
    { date: '2026-11-02', line: '2', stage: 'Leak test', model: 'B', defect: 'Drain cap leakage', hours: { 11: 4 }, total: 4, dismantle: 0 },
    { date: '2026-11-02', line: '2', stage: '', model: 'B', defect: '?', hours: { 11: 1 }, total: 1, dismantle: 0 },
  ];
  it('only the rows of the stage, grouped most first', () => {
    const d = stageDetail(rows, [], 1);
    expect(d.total).toBe(7);
    expect(d.dismantle).toBe(1);
    expect(d.withCause).toBe(3);
    expect(d.defects.map((x) => `${x.key}:${x.total}`)).toEqual(['Drain cap leakage:4', 'Seal bellow leakage:3']);
    expect(d.hours.map((x) => `${x.key}:${x.total}`)).toEqual(['9:2', '10:1', '11:4']);
    expect(d.lines.map((x) => x.key)).toEqual(['2', '1']);
    expect(d.days.map((x) => x.key)).toEqual(['2026-11-01', '2026-11-02']);
  });
  it('one line, the final stage and the rows at no stage', () => {
    expect(stageDetail(rows, [], 1, '1').total).toBe(3);
    expect(stageDetail(rows, [], 5).total).toBe(2);
    expect(stageDetail(rows, [], -1).total).toBe(1);
  });
});
