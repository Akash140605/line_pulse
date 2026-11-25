// Targets: a model with no target on its own line borrows the same model's target from another line.
import { describe, it, expect } from 'vitest';
import { fillFromOtherLines, mergeTargets } from '../src/hooks/useAutoTargets';

describe('targets from another line', () => {
  const byLine = { 1: { 7: { cycle: 14.2, model: 'WT10C4260GG', company: 'SAMSUNG', method: 'A' } }, 2: {}, 3: {}, 4: {} };
  const models = [{ line: '1', mmId: 7, model: 'WT10C4260GG', company: 'SAMSUNG' }, { line: '2', mmId: 70, model: 'wt10c4260gg ', company: 'Samsung' }, { line: '2', mmId: 71, model: 'NEW', company: 'X' }];
  fillFromOtherLines(byLine, models);
  it('same company + model on Line 1 → Line 2 gets 14.2 s, marked from Line 1', () => {
    expect(byLine[2]['70']).toMatchObject({ cycle: 14.2, from: 'Line 1' });
    expect(byLine[2]['71']).toBeUndefined();
  });
  it("the line's own saved target beats a borrowed one; a borrowed one fills a gap", () => {
    expect(mergeTargets({ 70: { cycle: 15 } }, byLine[2])['70'].cycle).toBe(15);
    expect(mergeTargets({}, byLine[2])['70'].cycle).toBe(14.2);
  });
  it('a line target worked out on the line itself still beats the saved one', () => {
    expect(mergeTargets({ 7: { cycle: 20 } }, byLine[1])['7'].cycle).toBe(14.2);
  });
});
