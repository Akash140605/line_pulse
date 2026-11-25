// 21-11-2026: Loss & quality entry counts time only up to the line's actual last scan
import { describe, it, expect } from 'vitest';
import { modelTimeOfHour, oleLineDay, normEntry, setOleConfig, OLE_CFG_DEFAULT, isNoRun } from '../src/utils/ole';


const md = [{ mmId: 7, model: 'WT70', quantity: 19, std: 60 }];
const sc = Array.from({ length: 19 }, (_, i) => ({ mmId: 7, scanDate: `2026-11-20 18:${String(i).padStart(2, '0')}:00`, cycleSeconds: 60 }));

describe('last hour ends at the last scan', () => {
  it('without the option the time after the last scan is lost', () => {
    const r = modelTimeOfHour({ hour: 18, scans: sc, models: md, totalMin: 60 });
    // 24-11-2026: no shift given → the plant's day, tea break 18:30–18:45 is not working time (60 − 15 = 45 min)
    expect(Math.round(r.runMin)).toBe(45);
    expect(Math.round(r.lostMin)).toBe(26);
  });
  it('endAtLastScan: run time = up to 18:18, nothing lost', () => {
    const r = modelTimeOfHour({ hour: 18, scans: sc, models: md, totalMin: 60, endAtLastScan: true });
    expect(Math.round(r.runMin)).toBe(18);
    expect(Math.round(r.lostMin)).toBe(0);
  });
  it('endAtLastScan without scans: unchanged (shared by std time)', () => {
    const r = modelTimeOfHour({ hour: 18, scans: [], models: md, totalMin: 60, endAtLastScan: true });
    expect(Math.round(r.runMin)).toBe(45);   // tea break 18:30–18:45 out
  });
});

describe('No run hours', () => {
  it('a finished day: hours after the last production hour are No run, a written loss is not', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT });
    const hours = [{ hour: 17, quantity: 150, models: [{ mmId: 7, model: 'WT70', quantity: 150 }] }, { hour: 18, quantity: 19, models: [{ mmId: 7, model: 'WT70', quantity: 19 }] }];
    const D = oleLineDay({ hours, targets: { 7: { cycle: 20 } }, entries: { 20: { noLoss: true } } });
    const r19 = D.rows.find((r) => r.hour === 19), r20 = D.rows.find((r) => r.hour === 20), r18 = D.rows.find((r) => r.hour === 18);
    expect([isNoRun(r18), isNoRun(r19), isNoRun(r20)]).toEqual([false, true, true]);
    expect(r19.totalMin).toBe(0);
    const W = oleLineDay({ hours, targets: { 7: { cycle: 20 } }, entries: { 19: { losses: [{ reason: 'Breakdown', min: 30 }] } } });
    expect(isNoRun(W.rows.find((r) => r.hour === 19))).toBe(false);
  });
  it('today: an hour begun but after the last scan is No run, a later one is future', () => {
    const D = oleLineDay({ hours: [{ hour: 9, quantity: 100, models: [{ mmId: 7, model: 'WT70', quantity: 100 }] }], targets: { 7: { cycle: 20 } }, entries: {}, nowMin: 9 * 60 + 40 });
    const r10 = D.rows.find((r) => r.hour === 10), r11 = D.rows.find((r) => r.hour === 11);
    expect([isNoRun(r10, 10 * 60 + 20), isNoRun(r11, 10 * 60 + 20)]).toEqual([true, false]);
    expect(normEntry(null).losses).toEqual([]);
  });
});

describe('each model is judged on its own time (21-11-2026)', () => {
  // Line 1, 20-11 10:00: 70DLIM 220 pcs in ~57 min (std 20 s → 73 min), 85DBLG 6 pcs in ~3 min (std 2 min)
  const md2 = [{ mmId: 1, model: '70DLIM 5', quantity: 220, std: 20 }, { mmId: 2, model: '85DBLG/FLRS5', quantity: 6, std: 20 }];
  const sc2 = [...Array.from({ length: 220 }, (_, i) => ({ mmId: 1, scanDate: `2026-11-20 10:${String(Math.floor((i * 15.5) / 60)).padStart(2, '0')}:${String(Math.floor((i * 15.5) % 60)).padStart(2, '0')}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ mmId: 2, scanDate: `2026-11-20 10:${String(57 + Math.floor(i / 2)).padStart(2, '0')}:${String((i % 2) * 30).padStart(2, '0')}` }))];
  it('the slower model keeps its own lost minutes; the faster one has none', () => {
    const r = modelTimeOfHour({ hour: 10, scans: sc2, models: md2, totalMin: 60 });
    const a = r.rows.find((x) => x.mmId === 1), b = r.rows.find((x) => x.mmId === 2);
    expect(a.lostMin).toBe(0);
    expect(Math.round(b.lostMin)).toBe(1);
    expect(Math.round(r.lostMin)).toBe(1);
  });
  it('an hour below its std still shows its loss', () => {
    const r = modelTimeOfHour({ hour: 18, scans: sc, models: md, totalMin: 60 });
    expect(Math.round(r.lostMin)).toBe(26);   // 45 working min (tea break out) − 19 std min
  });
});

describe('model target by the time it ran (21-11-2026)', () => {
  it('85DBLG ran 3 min 9 s at 20 s → about 9 pcs; the two add up to the hour target', async () => {
    const { splitHourTarget } = await import('../src/utils/ole');
    const ms = splitHourTarget(180, [{ model: '70DLIM 5', qty: 220, cycle: 20, runMin: 56 + 51 / 60 }, { model: '85DBLG/FLRS5', qty: 6, cycle: 20, runMin: 3 + 9 / 60 }]);
    expect(ms.map((m) => m.target)).toEqual([171, 9]);
  });
  it('without the minutes: by pieces × std cycle as before', async () => {
    const { splitHourTarget } = await import('../src/utils/ole');
    expect(splitHourTarget(180, [{ model: 'A', qty: 220, cycle: 20 }, { model: 'B', qty: 6, cycle: 20 }]).map((m) => m.target)).toEqual([175, 5]);
  });
});

describe('a model with no cycle time has no target (21-11-2026)', () => {
  it('Line 1, 20-11 19:00: WTT18UEA has no cycle → no target; the others by their own time', async () => {
    const { splitHourTarget } = await import('../src/utils/ole');
    const ms = splitHourTarget(141, [
      { model: '80DBLG/BLSSWH5GLDE', qty: 89, cycle: 21, runMin: 38 + 25 / 60 },
      { model: 'WTT14UEA/BRSSWH4PTDA', qty: 11, cycle: 21, runMin: 6 + 56 / 60 },
      { model: 'WTT18UEA/BKSSDG5PTDA', qty: 22, cycle: null, runMin: 14 + 36 / 60 }]);
    expect(ms.map((m) => m.target)).toEqual([110, 20, null]);
  });
});
