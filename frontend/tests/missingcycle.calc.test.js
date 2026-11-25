// A model made today without a cycle time (components/MissingCycleWatch.jsx): which ones, and how the master is updated.
import { describe, it, expect } from 'vitest';
import { missingOf, mergeMaster } from '../src/components/MissingCycleWatch';

const rows = [
  { line: 3, ok: true, hourModels: [
    { hour: 9, mmId: 10, model: 'WT80F4560GD', company: 'SAMSUNG', qty: 60 }, { hour: 10, mmId: 10, model: 'WT80F4560GD', company: 'SAMSUNG', qty: 48 },
    { hour: 9, mmId: 11, model: 'WT90C4260GG', company: 'SAMSUNG', qty: 200 },
    { hour: 11, mmId: 12, model: 'TEST', company: '', qty: 2 } ] },
  { line: 4, ok: false, hourModels: [{ hour: 9, mmId: 99, model: 'X', qty: 50 }] },
];
const tg = { 3: { 11: { cycle: 14 } } };

describe('models without a cycle time', () => {
  it('today\'s pieces per model, only the ones without a target, 3 pieces or more, failed lines left out', () => {
    expect(missingOf(rows, tg)).toEqual([{ key: '3|10', line: '3', mmId: 10, model: 'WT80F4560GD', company: 'SAMSUNG', qty: 108 }]);
  });
  it('a target found on the line → nothing to ask', () => {
    expect(missingOf(rows, { 3: { 10: { cycle: 20 }, 11: { cycle: 14 } } })).toEqual([]);
  });
});

describe('saved in the Model master', () => {
  const master = [{ id: 'a', company: 'SAMSUNG', model: 'WT80F 4560GD', cycle: null, lines: [4] }, { id: 'b', company: 'VOLTAS', model: '70DLIM 5', cycle: 13, lines: [1] }];
  it('same model (spaces / case ignored) → cycle set, line added', () => {
    const m = mergeMaster(master, { company: 'samsung', model: 'WT80F4560GD', cycle: 24, lines: [3] });
    expect(m.length).toBe(2);
    expect(m[0]).toMatchObject({ id: 'a', cycle: 24, lines: [3, 4] });
    expect(master[0].cycle).toBe(null);   // the list given is not changed
  });
  it('a new model → added on top with its lines', () => {
    const m = mergeMaster(master, { company: 'GODREJ', model: '705.WNRD', cycle: 30, lines: [2, 1] });
    expect(m.length).toBe(3);
    expect(m[0]).toMatchObject({ company: 'GODREJ', model: '705.WNRD', cycle: 30, lines: [1, 2] });
  });
});

describe('one entry per model', async () => {
  const { groupMissing } = await import('../src/components/MissingCycleWatch');
  it('the same model on two lines → one entry, both lines with their own id', () => {
    const g = groupMissing([{ key: '1|5', line: '1', mmId: 5, model: '70DLIM 5', company: 'VOLTAS', qty: 100 }, { key: '3|9', line: '3', mmId: 9, model: '70dlim5', company: 'Voltas', qty: 40 }, { key: '2|7', line: '2', mmId: 7, model: 'X', company: '', qty: 300 }]);
    expect(g.map((x) => [x.model, x.qty, x.on.map((o) => `${o.line}:${o.mmId}`).join(',')])).toEqual([['X', 300, '2:7'], ['70DLIM 5', 140, '1:5,3:9']]);
  });
});
