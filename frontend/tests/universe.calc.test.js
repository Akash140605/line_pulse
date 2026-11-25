// 3D model view (utils/modelUniverse.js): companies and models of the period with the master's std cycle.
import { describe, it, expect } from 'vitest';
import { buildUniverse, filterUniverse, universeTotals, layoutUniverse, bandOf } from '../src/utils/modelUniverse';

const lines = [
  { line: 1, models: [{ mmId: 1, model: 'WT80', company: 'Voltas', qty: 300, days: 2, validCycles: 100, avgCycle: 14 }, { mmId: 2, model: 'X1', company: 'Godrej', qty: 50, days: 1 }] },
  { line: 2, models: [{ mmId: 9, model: 'WT80', company: 'VOLTAS', qty: 100, days: 1, validCycles: 100, avgCycle: 16 }, { mmId: 3, model: 'Z9', company: 'Godrej', qty: 0 }] },
  { line: 3, models: [{ mmId: 4, model: 'Q', company: 'LG', qty: 999 }] },
];
const master = [{ model: 'WT80', company: 'VOLTAS', cycle: 13, lines: [1, 2] }, { model: 'NEVER', company: 'VOLTAS', cycle: 21, lines: [1] }, { model: 'L3ONLY', company: 'LG', cycle: 30, lines: [3] }];
const masterOf = (m) => master.find((r) => r.model === m.model) || null;

describe('3D model view', () => {
  const U = buildUniverse({ lines, ids: ['1', '2'], masterOf, masterRows: master });
  it('one row per company + model, lines merged, only the chosen lines, no zero rows', () => {
    expect(U.map((c) => c.name)).toEqual(['VOLTAS', 'GODREJ']);
    const v = U[0].models[0];
    expect([v.qty, v.std, v.lines, v.days]).toEqual([400, 13, ['1', '2'], 3]);
    expect(v.actual).toBe(15);   // 14 and 16 over the same count of cycles
    expect(U[1].models.map((m) => m.model)).toEqual(['X1']);
    expect(U[1].models[0].std).toBe(null);
  });
  it('master models not made: added only when asked, only for the chosen lines', () => {
    const W = buildUniverse({ lines, ids: ['1', '2'], masterOf, masterRows: master, withMaster: true });
    expect(W[0].models.map((m) => m.model)).toEqual(['WT80', 'NEVER']);
    expect(W[0].models[1]).toMatchObject({ qty: 0, std: 21, masterOnly: true });
    expect(W.some((c) => c.models.some((m) => m.model === 'L3ONLY'))).toBe(false);
  });
  it('filters, totals and bands', () => {
    expect(filterUniverse(U, { band: 'none' }).flatMap((c) => c.models.map((m) => m.model))).toEqual(['X1']);
    expect(filterUniverse(U, { q: 'wt8' })[0].models[0].model).toBe('WT80');
    expect(filterUniverse(U, { company: 'GODREJ' }).length).toBe(1);
    expect(universeTotals(U)).toMatchObject({ companies: 2, models: 2, qty: 450, std: 13, noStd: 1, noStdQty: 50 });
    expect([bandOf(12).id, bandOf(18).id, bandOf(22).id, bandOf(40).id, bandOf(null).id]).toEqual(['fast', 'std', 'slow', 'vslow', 'none']);
  });
  it('layout: plates in rows, never wider than the floor, towers inside their plate', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, qty: 1, models: Array.from({ length: 9 }, (_, k) => ({ key: `${i}-${k}`, qty: 1 })) }));
    const L = layoutUniverse(many, { maxW: 600 });
    expect(L.width).toBeLessThanOrEqual(600);
    for (const p of L.plates) for (const b of p.bars) { expect(b.x + L.size).toBeLessThanOrEqual(p.w); expect(b.y + L.size).toBeLessThanOrEqual(p.h); }
    expect(new Set(L.plates.map((p) => p.y)).size).toBeGreaterThan(1);
  });
});
