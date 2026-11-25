// SAWM KPI report (src/utils/kpiReport.js): the plant's KPI workbook made from Line Pulse data (18-11-2026).
import { describe, it, expect } from 'vitest';
import { kpiDays, buildKpiXlsx, kpiFileName, stageOf, KPI_STAGES } from '../src/utils/kpiReport';

const SHIFT = { start: '09:00', end: '11:00', lunchStart: '13:00', lunchEnd: '13:30' };
const targets = { 7: { cycle: 20 }, 8: { cycle: 30 } };
const stations = [{ reason: 'Leak test', code: '' }, { reason: 'FQC (final quality check)', code: 'FQC' }, { reason: 'Sub-assembly', code: '' }];
const R = {
  days: [
    {
      date: '2026-11-02',
      byLine: {
        1: {
          ok: true,
          rows: [
            { hour: 9, qty: 200, models: [{ mmId: 7, model: 'WT70', quantity: 150 }, { mmId: 8, model: 'WT80', quantity: 50 }],
              entry: { rejects: [{ station: 'Leak test', reason: 'Leak', qty: 3 }, { station: 'Sub-assembly', reason: 'x', qty: 1 }], rework: [{ station: 'FQC', reason: 'Scratch', qty: 2 }], losses: [{ reason: 'Motor Shortage', min: 10, model: 'WT70' }] } },
            { hour: 10, qty: 0, models: [], entry: { stops: [{ reason: 'Meeting', min: 5 }] } },
          ],
        },
        2: { ok: true, rows: [{ hour: 9, qty: 0, models: [] }] },
      },
    },
    { date: '2026-11-03', byLine: { 1: { ok: true, rows: [] } } },
  ],
};
const make = (o = {}) => kpiDays({ R, setups: { '2026-11-02|1': { mp: 100 } }, targetsOf: () => targets, shiftOf: () => SHIFT, stations, lines: ['1', '2'], ...o });

describe('SAWM KPI report', () => {
  it('stations map to the six stages of the plant file', () => {
    expect(KPI_STAGES).toHaveLength(6);
    expect([stageOf('Hi-pot / electrical safety'), stageOf('Leak test'), stageOf('Run / performance test'), stageOf('LQC (line quality check)'), stageOf('Pre-Final Inspection'), stageOf('FQC (final quality check)'), stageOf('Sub-assembly')])
      .toEqual([0, 1, 2, 3, 4, 5, null]);
  });
  it('only days and lines that made pieces', () => {
    const d = make();
    expect(d.map((x) => x.date)).toEqual(['2026-11-02']);
    expect(Object.keys(d[0].lines)).toEqual(['1']);
  });
  it('plan per model = hour plan shared by pieces; an idle hour (no piece) has no plan (25-11-2026)', () => {
    const x = make()[0].lines[1];
    // hour 9: mix cycle (150×20 + 50×30) ÷ 200 = 22.5 s → 160 pcs; hour 10 made nothing → no target
    expect(Math.round(x.plan)).toBe(160);
    const m = Object.fromEntries(x.models.map((y) => [y.model, y]));
    expect(Math.round(m.WT70.plan)).toBe(120); expect(Math.round(m.WT80.plan)).toBe(40);
    expect(m.WT70.uph).toBe(180); expect(m.WT80.uph).toBe(120);
    expect(m.WT70.uphAct).toBeCloseTo(180 * 150 / 120);
    expect(x.hours).toBeCloseTo(1);   // the idle hour is not a planned hour any more
    expect(x.mp).toBe(100);
  });
  it('quality by stage: rejection + rework where it was found; RTY = Π (1 − defects ÷ production)', () => {
    const x = make()[0].lines[1];
    expect(x.stages).toEqual([0, 3, 0, 0, 0, 2]);
    expect(x.defects).toBe(6);   // the sub-assembly piece counts in the defects, not in a stage
    expect(x.rty).toBeCloseTo((1 - 3 / 200) * (1 - 2 / 200));
    expect(x.reasons).toBe('Motor Shortage (10 min), Meeting (5 min)');
  });
  it('no M/P in the morning entry → no UPPH', () => {
    expect(make({ setups: {} })[0].lines[1].mp).toBeNull();
  });
  it('workbook: zip with Summary, FTY & RTY and one sheet per day; plant file name', () => {
    const bytes = buildKpiXlsx(make());
    expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('<sheet name="Summary"'); expect(text).toContain('<sheet name="FTY &amp; RTY"'); expect(text).toContain('<sheet name="2"');
    expect(text).toContain('Washing Machine Unit Dehradun');
    expect(kpiFileName('2026-11-18')).toBe('SAWM_KPI_Report-Nov_26.xlsx');
  });
  it('KPI entry (19-11-2026): OS&D, OT, WO, TRC, WIP, dismantle go into the report; a day with only an entry is kept', () => {
    const kpi = { '2026-11-02|1': { osd: 503.92, otPlan: 346.5, otUnplan: 0, wo7: 12, trc3: 1000, wip7: 2000, dismantle: 4, bom: 1.2 }, '2026-11-03|2': { osd: 66 } };
    const d = make({ kpi });
    expect(d.map((x) => x.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(d[0].kpi['1'].osd).toBe(503.92);
    expect(d[1].kpi['2'].osd).toBe(66);
    const text = new TextDecoder().decode(buildKpiXlsx(d));
    expect(text).toContain('<v>503.92</v>'); expect(text).toContain('<v>346.5</v>'); expect(text).toContain('<v>4</v>');
    expect(text).toMatch(/<v>569\.92(0*\d*)?<\/v>/);   // OS&D month to date on the Summary (503.92 + 66)
  });
  it('the KPI stage names map to themselves', () => {
    expect(KPI_STAGES.map((n) => stageOf(n))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(['HVIR', 'LEAK', 'FUNC', 'FRONT', 'PREFINAL', 'FINAL'].map((c) => stageOf('', c))).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
