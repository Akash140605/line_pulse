// Model-wise split of an hour's target (utils/targets.js → splitHour, modelDay).
import { describe, it, expect } from 'vitest';
import { splitHour, modelDay, modelActualCycles } from '../src/utils/targets';

describe('model-wise split of the hour target', () => {
  // 3600 s worked; A: 97 pcs at 13 s target, B: 76 pcs at 15 s target → need 97×13 + 76×15 = 2401 s
  const r = { hour: 9, label: '09-10', workSec: 3600, future: false, targetCycle: 13.9, share: 173 / 176,
    models: [{ mmId: 1, model: 'A', qty: 97, target: 13 }, { mmId: 2, model: 'B', qty: 76, target: 15 }, { mmId: 3, model: 'C', qty: 3, target: null }] };
  const s = splitHour(r);
  // 16-11-2026: a model without a target gets no share of the target; the hour's target covers only the share of the
  // hour of the models with one (173 of 176 pcs)
  it('target pcs = working seconds × share × qty ÷ Σ(qty × target cycle) of the models with a target', () => {
    const need = 97 * 13 + 76 * 15;
    expect(s[0].plan).toBeCloseTo(3600 * (173 / 176) * 97 / need, 6);
    expect(s[1].plan).toBeCloseTo(3600 * (173 / 176) * 76 / need, 6);
  });
  it('model without target: no target cycle, no target pcs', () => { expect(s[2].tc).toBe(null); expect(s[2].plan).toBe(null); });
  it('model targets add up to the hour target (its share) at the weighted cycle', () => {
    const sum = s.reduce((x, m) => x + (m.plan || 0), 0);
    const wc = (97 * 13 + 76 * 15) / 173;
    expect(sum).toBeCloseTo(3600 * (173 / 176) / wc, 6);
  });
  it('every model gets the hour % (the hour shares one clock)', () => { expect(s[0].pct).toBeCloseTo(s[1].pct, 6); });
  it('time at target = qty × target cycle', () => { expect(s[0].min).toBeCloseTo(97 * 13 / 60, 6); });
  it('future hour: no target', () => { expect(splitHour({ ...r, future: true })[0].plan).toBe(null); });
  it('day per model sums the hours', () => {
    const d = modelDay({ rows: [r, { ...r, hour: 10, share: 1, models: [{ mmId: 1, model: 'A', qty: 200, target: 13 }] }] });
    expect(d[0].model).toBe('A'); expect(d[0].qty).toBe(297); expect(d[0].hours).toBe(2);
    expect(d[0].plan).toBeCloseTo(s[0].plan + 3600 / 13, 6);
  });
  it('lunch scans taken out: model qty scaled to the hour qty', () => {
    const l = splitHour({ ...r, qty: 88, models: [{ mmId: 1, model: 'A', qty: 83, target: 13 }, { mmId: 2, model: 'B', qty: 5, target: 13 }, { mmId: 3, model: 'C', qty: 88, target: 13 }] });
    expect(l.reduce((x, m) => x + m.qty, 0)).toBeCloseTo(88, 0);
    expect(l[2].rawQty).toBe(88);
  });
});

describe('model-wise actual cycle of the day', () => {
  const models = [
    { mmId: 'L3-7', days: { '2026-10-30': { q: 120, g: [12, 13, 14, 15, 600, 45] } } },   // 600 s and 45 s = stops: left out
    { mmId: 9, days: { '2026-10-30': { q: 4, g: [11, 30, 12] } } },
  ];
  const a = modelActualCycles(models, '2026-10-30', 22);
  it('mean / median of the model\'s own gaps 1–22 s', () => {
    expect(a['7'].valid).toBe(4); expect(a['7'].mean).toBe(13.5); expect(a['7'].median).toBe(13.5); expect(a['7'].few).toBe(false);
  });
  it('fewer than 10 pieces: shown but marked few', () => { expect(a['9'].few).toBe(true); expect(a['9'].mean).toBe(11.5); });
  it('other day: nothing', () => { expect(modelActualCycles(models, '2026-10-29')).toEqual({}); });
});
