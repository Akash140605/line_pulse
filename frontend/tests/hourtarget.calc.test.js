// 23-11-2026: Loss entry — one target per hour everywhere: from the scans (minutes each model ran ÷ its std cycle)
import { describe, it, expect } from 'vitest';
import { scanHourTargets, splitHourTarget, modelTimeOfHour, oleLineDay, setOleConfig, OLE_CFG_DEFAULT } from '../src/utils/ole';
// pieces-weighted estimate of the page (LossEntryPage hourTargets): run seconds ÷ (std seconds ÷ pieces)
const est = (r) => Math.round((r.totalMin * 60) / (r.stdSec / r.qty));

const at = (h, m, s = 0) => `2026-11-20 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
// 10:00–11:00: model A (cycle 20 s) from 10:00 to 10:57 (171 pcs), then model B (cycle 60 s) 3 pcs to 11:00
const scA = Array.from({ length: 150 }, (_, i) => ({ mmId: 1, scanDate: at(10, Math.floor(((i + 1) * 57 * 60) / 150 / 60), Math.floor(((i + 1) * 57 * 60) / 150) % 60) }));
const scB = [{ mmId: 2, scanDate: at(10, 58) }, { mmId: 2, scanDate: at(10, 59) }, { mmId: 2, scanDate: at(10, 59, 59) }];
const models = [{ mmId: 1, model: 'A', quantity: 150, std: 20 }, { mmId: 2, model: 'B', quantity: 3, std: 60 }];
const row = { hour: 10, qty: 153, totalMin: 60, models, stdSec: 150 * 20 + 3 * 60, noStdQty: 0 };

describe('hour target from the scans', () => {
  it('= Σ minutes each model ran ÷ its cycle (171 + 3 = 174), not the pieces-weighted 173', () => {
    expect(est(row)).toBe(173);
    const t = scanHourTargets([row], { 10: [...scA, ...scB] }, { 10: est(row) });
    expect(t.by[10]).toBe(174);
    expect(t.day).toBe(174);
  });
  it('the model table of the hour adds up to the hour target', () => {
    const sc = [...scA, ...scB];
    const mt = modelTimeOfHour({ hour: 10, scans: sc, models, totalMin: 60 });
    const t = scanHourTargets([row], { 10: sc }).by[10];
    const ms = splitHourTarget(t, models.map((m) => ({ model: m.model, qty: m.quantity, cycle: m.std, runMin: mt.rows.find((x) => x.mmId === m.mmId).runMin })));
    expect(ms.reduce((a, m) => a + m.target, 0)).toBe(t);
    expect(ms.map((m) => m.target)).toEqual([171, 3]);
  });
  it('a model without a cycle time gets no target; only the time of the others counts', () => {
    const m2 = [models[0], { ...models[1], std: null }];
    const t = scanHourTargets([{ ...row, models: m2, noStdQty: 3 }], { 10: [...scA, ...scB] }).by[10];
    expect(t).toBe(171);
    const none = scanHourTargets([{ ...row, models: [{ ...models[0], std: null }] }], { 10: scA }).by[10];
    expect(none).toBe(null);
  });
  it('an hour whose scans are not read keeps the estimate; future / extra / closed hours are left alone', () => {
    const t = scanHourTargets([row, { ...row, hour: 11 }, { ...row, hour: 12, future: true }, { ...row, hour: 13, extra: true }], { 10: [...scA, ...scB] }, { 11: 170, 13: 5 });
    expect(t.by).toEqual({ 10: 174, 11: 170, 13: 5 });
    expect(t.day).toBe(349);
  });
  it('the last hour of the day ends at its last scan (no target for the idle time after it)', () => {
    const sc = scA.slice(0, 75);   // half the hour, then the line stopped
    const r = { ...row, qty: 75, models: [{ ...models[0], quantity: 75 }] };
    expect(scanHourTargets([r], { 10: sc }, {}, { lastScanHour: 10 }).by[10]).toBe(Math.round((28.5 * 60) / 20));
    expect(scanHourTargets([r], { 10: sc }, {}).by[10]).toBe(180);
  });
  it('works on the rows of a real day', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT });
    const D = oleLineDay({ hours: [{ hour: 10, quantity: 153, models: [{ mmId: 1, model: 'A', quantity: 150 }, { mmId: 2, model: 'B', quantity: 3 }] }], targets: { 1: { cycle: 20 }, 2: { cycle: 60 } }, entries: {} });
    const r = D.rows.find((x) => x.hour === 10);
    expect(scanHourTargets(D.rows, { 10: [...scA, ...scB] }).by[10]).toBe(Math.round(r.totalMin === 60 ? 174 : 174 * r.totalMin / 60));
  });
  it('without scans the hour target is shared by pieces: each model gets the time its pieces need at std (HPR = SAWM KPI)', () => {
    // 22-11-2026 Line 2, 09-10: 160 for KSAZ 76 @24 s, FIPL80SWMRG 63 @21.05, FIPL80SWMBLG 15 @21.05, WTT85 1 @20.57
    const ms = splitHourTarget(160, [{ model: 'KSAZ', qty: 76, cycle: 24 }, { model: 'RG', qty: 63, cycle: 21.05 }, { model: 'BLG', qty: 15, cycle: 21.05 }, { model: 'W85', qty: 1, cycle: 20.57 }]);
    expect(ms.map((m) => m.target)).toEqual([78, 65, 16, 1]);
    expect(ms.reduce((a, m) => a + m.target, 0)).toBe(160);
    // time check: Σ target × cycle ≈ the hour (3600 s × 160 / (3600 ÷ mix cycle))
    const mix = (76 * 24 + 63 * 21.05 + 15 * 21.05 + 20.57) / 155;
    expect(Math.abs(ms.reduce((a, m) => a + m.target * m.cycle, 0) - 160 * mix)).toBeLessThan(25);
  });
});
