import { describe, it, expect } from 'vitest';
import { summaryTable, dayTable, ftyTable, ftyPeriod, osdMtdOf } from '../src/utils/kpiSheets';

// 25-11-2026: SAWM KPI sheets as screens — the same numbers as the Excel
const L = (qty, plan, hours, mp, stages = [0, 0, 0, 0, 0, 0], extra = {}) => ({
  qty, plan, hours, mp, stages, defects: stages.reduce((a, b) => a + b, 0), dismantled: 0, rty: stages.reduce((a, n) => a * (1 - n / qty), 1), reasons: 'Model Change (10 min)',
  models: [{ model: 'A', plan, qty, uph: plan / hours, uphAct: (plan / hours) * qty / plan, hours }], ...extra,
});
const K = [
  { date: '2026-10-31', lines: { 1: L(100, 100, 1, 10) }, kpi: { 1: { osd: 7 } } },
  { date: '2026-11-01', lines: { 1: L(2000, 2100, 12, 50, [10, 0, 0, 0, 0, 10]), 2: L(1000, 1000, 10, null) }, kpi: { 1: { osd: 100, otPlan: 4 }, 2: { osd: '50', wo7: 3 } } },
  { date: '2026-11-02', lines: { 1: L(1500, 1500, 10, 40) }, kpi: { 1: { osd: 20 } } },
];

describe('kpi sheets', () => {
  it('summary: newest first, totals and OS&D month to date (resets with the month)', () => {
    const S = summaryTable(K, ['1', '2', '3', '4']);
    expect(S.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-01', '2026-10-31']);
    const n1 = S[1];
    expect(n1.rows.length).toBe(4);
    expect(n1.total.plan).toBe(3100); expect(n1.total.qty).toBe(3000);
    expect(n1.rows[0].v.uphT).toBeCloseTo(175, 5); expect(n1.rows[0].v.upphA).toBeCloseTo(2000 / 12 / 50, 5);
    expect(n1.rows[1].v.upphA).toBeNull();
    expect(n1.total.osd).toBe(150); expect(n1.total.otPlan).toBe(4); expect(n1.total.wo7).toBe(3);
    expect(osdMtdOf(K)['2026-11-02|1']).toBe(120);
    expect(S[0].rows[0].mtd).toBe(120);
    expect(n1.rows[0].mtd).toBe(100);   // October's 7 not carried
    expect(n1.rows[0].v.rty).toBeCloseTo(99, 2);
  });
  it('summary: only the chosen lines', () => {
    const S = summaryTable(K, ['2']);
    expect(S.length).toBe(1); expect(S[0].rows.map((r) => r.fa)).toEqual(['FA-02']);
  });
  it('day: FA lines with models, UPPH from M/P, totals', () => {
    const D = dayTable(K, '2026-11-01', ['1', '2', '3', '4']);
    expect(D.lines.map((l) => l.fa)).toEqual(['FA-01', 'FA-02']);
    expect(D.lines[0].models[0].upphT).toBeCloseTo(175 / 50, 5);
    expect(D.lines[1].models[0].upphT).toBeNull();
    expect(D.total.qty).toBe(3000); expect(D.total.plan).toBe(3100); expect(D.lines[0].rty).toBe(99);
    expect(dayTable(K, '2026-12-01', ['1'])).toBeNull();
  });
  it('fty: stage FPY, RTY and the period', () => {
    const F = ftyTable(K, ['1', '2']);
    const d = F.find((x) => x.date === '2026-11-01');
    expect(d.total).toBe(3000);
    expect(d.rows[0].fpy[0]).toBeCloseTo(0.995, 6); expect(d.rows[0].rty).toBeCloseTo(0.995 * 0.995, 6);
    expect(d.rows[1].rty).toBe(1);
    const P = ftyPeriod(F);
    expect(P.qty).toBe(4600); expect(P.stages[0]).toBe(10); expect(P.rty).toBeCloseTo((1 - 10 / 4600) ** 2, 8);
  });
});
