// OLE maths (src/utils/ole.js): 09–21, lunch 13:00–13:30, hourly stoppage and rejection entered by hand.
import { describe, it, expect } from 'vitest';
import { offLabels, hourTotalMin, shiftHours, oleLineDay, oleDayLines, oleRange, oleSum, normEntry, lossSummary, qualityOf, modelTimeOfHour, stationsFor, stationLabel, groupIssues, splitText, setOleConfig as setCfg0, OLE_CFG_DEFAULT as DEF0 } from '../src/utils/ole';

// 18-11-2026: standard is model loss in Availability; the suites below were written for the Performance choice
describe('standard: model loss counts in Availability', () => {
  it('default lossIn is avail; a loss with a model is idle time', () => {
    expect(DEF0.lossIn).toBe('avail');
    setCfg0({ ...DEF0 });
    const ent = { 9: { losses: [{ model: 'WT70', reason: 'Breakdown', min: 10 }] } };
    const [r9] = oleLineDay({ hours: [{ hour: 9, quantity: 200, models: [{ mmId: 7, model: 'WT70', quantity: 200 }] }], targets, entries: ent }).rows;
    expect([r9.lossMin, r9.perfLossMin]).toEqual([10, 0]);
    expect(lossSummary([{ e: normEntry(ent[9]) }]).reason.map((x) => x.kind)).toEqual(['Idle time']);
    setCfg0({ lossIn: 'perf' });
  });
});
setCfg0({ lossIn: 'perf' });

const targets = { 7: { cycle: 15 }, 8: { cycle: 30 } };
const hours = [
  { hour: 9, quantity: 200, models: [{ mmId: 7, model: 'WT70', quantity: 200 }] },
  { hour: 13, quantity: 100, models: [{ mmId: 7, model: 'WT70', quantity: 60 }, { mmId: 8, model: 'WT80', quantity: 40 }] },
  { hour: 21, quantity: 5, models: [{ mmId: 7, model: 'WT70', quantity: 5 }] },
];

describe('total time', () => {
  it('09–21 = 12 hours, every hour 60 min, lunch hour 30 min → 690 min', () => {
    expect(shiftHours()).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(hourTotalMin(9)).toBe(60);
    expect(hourTotalMin(13)).toBe(30);
    expect(shiftHours().reduce((a, h) => a + hourTotalMin(h), 0)).toBe(690);
  });
  it('today: only the time gone (10:25 → hour 10 has 25 min, later hours 0)', () => {
    expect(hourTotalMin(10, 10 * 60 + 25)).toBe(25);
    expect(hourTotalMin(11, 10 * 60 + 25)).toBe(0);
    expect(hourTotalMin(13, 13 * 60 + 45)).toBe(15);
  });
});

describe('one line, one day', () => {
  const d = oleLineDay({ hours, targets, entries: { 9: { stops: [{ reason: 'Tea break', min: 10 }], losses: [{ model: 'WT70', reason: 'Breakdown', min: 5 }], rejects: 4 }, 13: { stopMin: '', rejects: '' } } });
  const h9 = d.rows.find((r) => r.hour === 9), h13 = d.rows.find((r) => r.hour === 13), h10 = d.rows.find((r) => r.hour === 10);
  // 17-11-2026 (17:41): no planned stoppage any more — every minute entered (old "stops" too) is a loss
  // 18-11-2026: a loss written against a model is performance loss (stays in the run time); a row without a model is idle time
  it('planned time = total; actual = planned − idle time (rows without a model); A = actual ÷ planned; empty = 0', () => {
    expect(h9.totalMin).toBe(60); expect(h9.plannedMin).toBe(60); expect(h9.actualMin).toBe(50); expect(h9.A).toBeCloseTo(50 / 60);
    expect(h9.lossMin).toBe(10); expect(h9.perfLossMin).toBe(5);
    expect(h13.stopMin).toBe(0); expect(h13.A).toBe(1);
  });
  it('an old planned-stop row is a loss too: it lowers availability', () => {
    const x = oleLineDay({ hours, targets, entries: { 9: { stops: [{ reason: 'Meeting', min: 20 }] } } }).rows[0];
    expect(x.A).toBeCloseTo(40 / 60); expect(x.plannedMin).toBe(60); expect(x.actualMin).toBe(40);
  });
  it('performance = actual qty × std cycle ÷ actual time', () => {
    // faster than std: Performance goes above 100 % (17-11-2026 14:53, cap taken back); Praw is the same value
    expect(h9.stdSec).toBe(3000); expect(h9.Praw).toBeCloseTo(3000 / (50 * 60)); expect(h9.P).toBeCloseTo(3000 / (50 * 60));
    expect(h13.stdSec).toBe(60 * 15 + 40 * 30); expect(h13.Praw).toBeCloseTo(2100 / 1800); expect(h13.P).toBeCloseTo(2100 / 1800);
  });
  it('quality = (actual qty − rejection) ÷ actual qty; OLE = A × P × Q', () => {
    expect(h9.Q).toBeCloseTo(196 / 200);
    expect(h9.ole).toBeCloseTo((50 / 60) * (3000 / (50 * 60)) * (196 / 200));
  });
  it('hour without pieces: A 100 %, P 0 → OLE 0', () => { expect(h10.qty).toBe(0); expect(h10.P).toBe(0); expect(h10.ole).toBe(0); });
  it('day = sums of the hours, then the formulas; an hour after 21:00 with pieces is an extra hour that does not change OLE', () => {
    const h21 = d.rows.find((r) => r.hour === 21);
    expect(h21.extra).toBe(true); expect(h21.qty).toBe(5); expect(h21.totalMin).toBeCloseTo(75 / 60, 1); expect(h21.P).toBeCloseTo(1, 1); expect(h21.A).toBe(1);
    expect(d.extraHours).toEqual([21]); expect(d.extraQty).toBe(5);
    expect(d.total.qty).toBe(305); expect(d.total.stopMin).toBe(0); expect(d.total.lossMin).toBe(10); expect(d.total.perfLossMin).toBe(5);
    const shift = oleSum(d.rows.filter((r) => !r.extra));
    // a finished day runs up to its last scan: the last shift hour with pieces is 13 → 09–14 = 270 min (lunch 30)
    expect(shift.totalMin).toBe(270); expect(shift.A).toBeCloseTo(260 / 270);
    expect(d.rows.find((r) => r.hour === 15).afterLast).toBe(true); expect(d.rows.find((r) => r.hour === 15).totalMin).toBe(0);
    expect(d.total.ole).toBeCloseTo(shift.ole, 2);             // the extra hour leaves OLE (almost exactly) as it was
    expect(d.total.Q).toBeCloseTo(301 / 305);
    expect(d.outsideQty).toBe(0);
  });
  it('extra hour: entries are not used; an early hour counts its pieces', () => {
    const x = oleLineDay({ hours, targets, entries: { 21: { stops: [{ reason: 'No plan', min: 45 }] } } }).rows.find((r) => r.hour === 21);
    expect(x.stopMin).toBe(0); expect(x.A).toBe(1);
    expect(oleLineDay({ hours: [{ hour: 8, quantity: 0, models: [] }], targets }).rows.some((r) => r.hour === 8)).toBe(false);
    const early = oleLineDay({ hours: [{ hour: 8, quantity: 12, models: [{ mmId: 7, model: 'WT70', quantity: 12 }] }, { hour: 9, quantity: 200, models: [{ mmId: 7, model: 'WT70', quantity: 200 }] }], targets });
    expect(early.rows[0].hour).toBe(8); expect(early.rows[0].extra).toBe(true); expect(early.total.qty).toBe(212);
    expect(early.rows[0].totalMin).toBeCloseTo(3, 1);           // 12 pcs × 15 s = 3 min
  });
});

describe('Line 1 & 2', () => {
  it('reads all_lines dhm of the day, entries per date|line|hour; combined = sums', () => {
    const lines = [
      { line: '1', ok: true, models: [], dhm: [['2026-11-03', 9, 7, 120], ['2026-11-02', 9, 7, 999]] },
      { line: '2', ok: true, models: [], dhm: [['2026-11-03', 9, 8, 60]] },
    ];
    const r = oleDayLines({ lines, settings: { 1: { targets }, 2: { targets } }, date: '2026-11-03', entries: { '2026-11-03|2|9': { stopMin: 30 } } });
    expect(r['1'].total.qty).toBe(120);
    expect(r['2'].rows[0].actualMin).toBe(30);
    const both = oleSum([r['1'].total, r['2'].total]);
    expect(both.totalMin).toBe(120);   // each line up to its last scan (hour 9) expect(both.qty).toBe(180); expect(both.stdSec).toBe(120 * 15 + 60 * 30);
  });
  it('today: the time of each line ends at its own last scan (14-11-2026)', () => {
    const lines = [
      { line: '1', ok: true, models: [], dhm: [['2026-11-03', 9, 7, 120], ['2026-11-03', 10, 7, 60]] },
      { line: '2', ok: true, models: [], dhm: [['2026-11-03', 9, 8, 60]] },
    ];
    // now 11:30; Line 1 last scan 10:45, Line 2 last scan 09:30
    const r = oleDayLines({ lines, settings: { 1: { targets }, 2: { targets } }, date: '2026-11-03', nowMin: { now: 690, 1: 645, 2: 570 } });
    expect(r['1'].total.totalMin).toBe(105);   // 09:00–10:45
    expect(r['2'].total.totalMin).toBe(30);    // 09:00–09:30
    expect(r['1'].rows.find((x) => x.hour === 11).future).toBe(true);   // after the last scan: not counted yet
    const plain = oleDayLines({ lines, settings: { 1: { targets }, 2: { targets } }, date: '2026-11-03', nowMin: 690 });
    expect(plain['1'].total.totalMin).toBe(150);   // a single number: up to now for every line, as before
    const fallback = oleDayLines({ lines, settings: { 1: { targets }, 2: { targets } }, date: '2026-11-03', nowMin: { now: 690, 1: 645 } });
    expect(fallback['2'].total.totalMin).toBe(150);   // a line without its last scan: up to now
  });
  it('each line uses its own master shift; lunch and tea breaks are not in the time (14-11-2026)', () => {
    const lines = [
      { line: '1', ok: true, models: [], dhm: [['2026-11-03', 9, 7, 120]] },
      { line: '2', ok: true, models: [], dhm: [['2026-11-03', 9, 8, 60]] },
    ];
    const tea = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [{ name: 'Tea', start: '11:00', end: '11:10' }, { name: 'Tea 2', start: '16:00', end: '16:15' }] };
    const early = { start: '08:00', end: '17:00', lunchStart: '12:00', lunchEnd: '12:45' };
    const r = oleDayLines({ lines, settings: { 1: { targets, shift: tea }, 2: { targets, shift: early } }, date: '2026-11-03' });
    expect(r['1'].total.totalMin).toBe(60);   // a finished day: up to the last scan (hour 9)
    expect(r['1'].rows.find((x) => x.hour === 11).fullMin).toBe(50);
    expect(r['1'].rows.find((x) => x.hour === 11).breakMin).toBe(10);
    expect(r['2'].rows.reduce((a, x) => a + x.fullMin, 0)).toBe(540 - 45);   // 08:00–17:00 minus 45 min lunch
    expect(r['2'].rows[0].hour).toBe(8);
    expect(r['2'].rows.some((x) => x.hour === 17)).toBe(false);
    // planned stoppage stays out of Availability: A = actual ÷ planned (planned = total − planned stop)
    const d = oleLineDay({ hours: [{ hour: 11, quantity: 50, models: [{ mmId: 7, quantity: 50 }] }], targets, entries: { 11: { stops: [{ reason: 'Meeting', min: 20 }] } }, shift: tea });
    const h11 = d.rows.find((x) => x.hour === 11);
    expect([h11.totalMin, h11.plannedMin, h11.A]).toEqual([50, 50, 30 / 50]);
    expect(offLabels(tea, 11)).toEqual(['Tea 11:00–11:10']);
    expect(offLabels(tea)).toEqual(['Tea 11:00–11:10', 'Lunch 13:00–13:30', 'Tea 2 16:00–16:15']);
    const t = modelTimeOfHour({ hour: 11, scans: null, models: [{ mmId: 7, quantity: 10, std: 60 }], shift: tea });
    expect(t.runMin).toBe(50);
  });
  it('no shift saved: 09:00–21:00 with lunch 13:00–13:30 and the tea break 18:30–18:45 (24-11-2026, the plant\'s 11.25 h)', () => {
    const d = oleLineDay({ hours: [], targets, entries: {} });
    expect(d.rows.reduce((a, r) => a + r.fullMin, 0)).toBe(675);
  });
  it('a line that does not answer counts nothing', () => {
    const r = oleDayLines({ lines: [{ line: '1', ok: false }], settings: {}, date: '2026-11-03' });
    expect(r['1'].ok).toBe(false); expect(r['2'].ok).toBe(false); expect(r['1'].total.totalMin).toBe(0);
  });
});

describe('reasons, departments, models', () => {
  const entry = { stops: [{ model: 'WT70', reason: 'Breakdown', dept: 'Maintenance', min: 10 }, { model: 'WT80', reason: 'Power cut', dept: 'Utility', min: 5 }, { reason: 'x', min: 0 }],
    rejects: [{ model: 'WT70', reason: 'Cosmetic damage', dept: 'Quality', qty: 3 }], rework: [{ reason: 'Test fail', dept: 'Quality', qty: 2 }] };
  it('several stoppage rows add up; empty rows dropped', () => {
    const e = normEntry(entry);
    expect(e.stops.length).toBe(2); expect(e.stopMin).toBe(15); expect(e.rejQty).toBe(3); expect(e.rwQty).toBe(2);
  });
  it('old entries (numbers) still read', () => {
    const e = normEntry({ stopMin: 12, reason: 'Breakdown', rejects: 4, rework: 1 });
    expect([e.stopMin, e.rejQty, e.rwQty, e.stops[0].reason]).toEqual([12, 4, 1, 'Breakdown']);
  });
  it('the hour uses the sums: actual time = 60 − 15, quality = (qty − 3 rejected − 2 rework) ÷ qty (25-11-2026: rework counts)', () => {
    const d = oleLineDay({ hours, targets, entries: { 9: entry } });
    const h9 = d.rows[0];
    expect(h9.actualMin).toBe(45); expect(h9.Q).toBeCloseTo(195 / 200); expect(h9.rework).toBe(2);
  });
  it('loss by department, reason and model', () => {
    const d = oleLineDay({ hours, targets, entries: { 9: entry, 10: { stops: [{ reason: 'Breakdown', dept: 'Maintenance', min: 20, model: 'WT70' }] } } });
    const s = lossSummary(d.rows);
    expect(s.dept[0]).toEqual({ name: 'Maintenance', stopMin: 0, lossMin: 30, rejQty: 0, rwQty: 0 });
    expect(s.dept.find((x) => x.name === 'Quality')).toEqual({ name: 'Quality', stopMin: 0, lossMin: 0, rejQty: 3, rwQty: 2 });
    expect(s.reason[0]).toMatchObject({ kind: 'Idle time', name: 'Breakdown', value: 30, unit: 'min' });
    expect(s.model.find((x) => x.name === 'WT70')).toEqual({ name: 'WT70', stopMin: 0, lossMin: 30, rejQty: 3, rwQty: 0 });
  });
});

describe('performance only over models with a std cycle, model loss', () => {
  it('a model without std cycle does not pull performance down (09–10 of Line 2: 153 pcs, 13 with std)', () => {
    const hrs = [{ hour: 9, quantity: 153, models: [{ mmId: 7, model: 'WT70', quantity: 13 }, { mmId: 99, model: 'NEW', quantity: 140 }] }];
    const d = oleLineDay({ hours: hrs, targets, entries: {}, nowMin: 9 * 60 + 54 });
    const r = d.rows[0];
    // 13 pcs × 15 s = 195 s std; their share of 54 min = 54 × 13/153 min
    expect(r.P).toBeCloseTo(195 / (54 * 60 * (13 / 153)));
    expect(r.P).toBeGreaterThan(0.5);
  });
  it('no piece with a std cycle → no performance, no OLE (not 0 %)', () => {
    const r = oleLineDay({ hours: [{ hour: 9, quantity: 50, models: [{ mmId: 99, model: 'NEW', quantity: 50 }] }], targets, entries: {} }).rows[0];
    expect(r.P).toBe(null); expect(r.ole).toBe(null);
  });
  it('unplanned loss rows: sum per hour, by model and department, own issue kind', () => {
    const entry = { stops: [{ reason: 'Breakdown', dept: 'Maintenance', min: 5 }], losses: [{ model: 'WT70', reason: 'Slow running', dept: 'Production', min: 8 }, { model: 'WT80', reason: 'Minor stops', dept: 'Maintenance', min: 4 }] };
    const e = normEntry(entry);
    expect([e.stopMin, e.lossMin, e.losses.length]).toEqual([5, 12, 2]);
    const d = oleLineDay({ hours, targets, entries: { 9: entry } });
    expect(d.rows[0].plannedMin).toBe(60); expect(d.rows[0].actualMin).toBe(55);   // 60 − 5 idle (row without a model); the 12 model minutes are performance loss
    expect(d.rows[0].lossMin).toBe(5); expect(d.total.lossMin).toBe(5); expect(d.total.perfLossMin).toBe(12);
    const s = lossSummary(d.rows);
    expect(s.model.find((x) => x.name === 'WT70').lossMin).toBe(8);
    expect(s.dept.find((x) => x.name === 'Maintenance')).toMatchObject({ stopMin: 0, lossMin: 9 })   // every row is idle time (17-11-2026);
  });
  it('20-11-2026: every reason lists the models it was written on (most first; none when no model was given)', () => {
    const rows = [{ e: normEntry({ losses: [{ model: 'WT70', reason: 'Carton shortage', dept: 'Kitting Store', min: 8 }, { model: 'WT80', reason: 'Carton shortage', dept: 'Kitting Store', min: 12 }] }) },
      { e: normEntry({ losses: [{ model: 'WT70', reason: 'Carton shortage', dept: 'Kitting Store', min: 6 }], stops: [{ reason: 'Meeting', dept: 'Production', min: 5 }] }) }];
    const s = lossSummary(rows);
    const c = s.reason.find((x) => x.name === 'Carton shortage');
    expect(c.value).toBe(26);
    expect(c.models).toEqual([{ name: 'WT70', value: 14 }, { name: 'WT80', value: 12 }]);
    expect(s.reason.find((x) => x.name === 'Meeting').models).toEqual([]);
  });
});

describe('quality: FPY and RTY', () => {
  const rows = [
    { qty: 100, models: [{ model: 'WT70', quantity: 100 }], e: normEntry({ rejects: [{ station: 'FQC', model: 'WT70', reason: 'Water leak', qty: 2 }], rework: [{ station: 'LQC', model: 'WT70', reason: 'Wiring', qty: 3 }, { station: 'FQC', model: 'WT70', reason: 'Wiring', qty: 1 }] }) },
    { qty: 100, models: [{ model: 'WT80', quantity: 100 }], e: normEntry({}) },
  ];
  const q = qualityOf(rows, ['Leak test', 'LQC', 'FQC']);
  it('FPY = (input − rejected − reworked) ÷ input; final yield = (input − rejected) ÷ input', () => {
    expect(q.qty).toBe(200); expect(q.rej).toBe(2); expect(q.rwk).toBe(4);
    expect(q.fpy).toBeCloseTo(194 / 200); expect(q.finalYield).toBeCloseTo(198 / 200); expect(q.dphu).toBeCloseTo(3);
  });
  it('RTY = product of the station FPYs; a station without defects = 100 %', () => {
    const s = Object.fromEntries(q.stations.map((x) => [x.name, x]));
    expect(s['Leak test'].fpy).toBe(1); expect(s.LQC.fpy).toBeCloseTo(197 / 200); expect(s.FQC.fpy).toBeCloseTo(197 / 200);
    expect(q.rty).toBeCloseTo((197 / 200) * (197 / 200));
  });
  it('per model and per defect', () => {
    const m = Object.fromEntries(q.models.map((x) => [x.name, x]));
    expect(m.WT70.fpy).toBeCloseTo(94 / 100); expect(m.WT80.fpy).toBe(1);
    expect(q.defects[0]).toEqual({ name: 'Wiring', rej: 0, rwk: 4, models: [{ name: 'WT70', rej: 0, rwk: 4, value: 4 }] });   // 20-11-2026: with its models
  });
  it('no pieces → no yield', () => { const z = qualityOf([], ['LQC']); expect(z.fpy).toBe(null); expect(z.rty).toBe(null); });
  it("admin's setup: order kept, a station out of RTY is not multiplied, an old name counts for the station", () => {
    const setup = [{ reason: 'Line QC', code: 'LQC', aliases: ['LQC'] }, { reason: 'FQC', code: 'FQC' }, { reason: 'OQC audit', code: 'OQC', rty: false, type: 'audit' }];
    const r2 = [...rows, { qty: 0, models: [], e: normEntry({ rejects: [{ station: 'OQC audit', reason: 'Cosmetic', qty: 5 }] }) }];
    const z = qualityOf(r2, setup);
    expect(z.stations.map((x) => x.name)).toEqual(['Line QC', 'FQC', 'OQC audit']);
    expect(z.stations[0].rwk).toBe(3); expect(z.stations[0].label).toBe('LQC');
    expect(z.rtyCount).toBe(2); expect(z.rty).toBeCloseTo((197 / 200) * (197 / 200));
    expect(z.rej).toBe(7); expect(z.fpy).toBeCloseTo((200 - 7 - 4) / 200);
    expect(lossSummary(r2, setup).station.find((x) => x.name === 'Line QC').rwQty).toBe(3);
  });
  it('stations of a line: switched-off and other-line stations are left out', () => {
    const setup = [{ reason: 'A', lines: [1] }, { reason: 'B', active: false }, { reason: 'C' }, { reason: 'D', lines: [2, 3] }];
    expect(stationsFor(setup, 1).map((x) => x.reason)).toEqual(['A', 'C']);
    expect(stationsFor(setup, [3], { all: true }).map((x) => x.reason)).toEqual(['B', 'C', 'D']);
    expect(stationLabel('LQC (line quality check)', [])).toBe('LQC');
    expect(stationLabel('a', [{ reason: 'A', code: 'XA' }])).toBe('XA');
  });
});

describe('closed days: no OLE for a line that did not run', () => {
  const made = [{ hour: 9, quantity: 100, models: [{ mmId: 7, model: 'WT70', quantity: 100 }] }];
  it('no piece and nothing entered → closed (idle), no time, no OLE', () => {
    const d = oleLineDay({ hours: [], targets });
    expect(d.closed).toBe('idle'); expect(d.total.totalMin).toBe(0); expect(d.total.ole).toBe(null);
  });
  it('whole-day planned stop without pieces → closed (planned)', () => {
    const d = oleLineDay({ hours: [], targets, dayOff: { reason: 'Holiday / weekly off' } });
    expect(d.closed).toBe('planned'); expect(d.total.totalMin).toBe(0); expect(d.dayOff.reason).toBe('Holiday / weekly off');
  });
  it('no pieces but a breakdown entered → counted, OLE 0', () => {
    const d = oleLineDay({ hours: [], targets, entries: { 9: { losses: [{ model: 'WT70', reason: 'Breakdown', min: 60 }] } } });
    expect(d.closed).toBe(null); expect(d.total.totalMin).toBe(60); expect(d.total.ole).toBe(0);   // up to the last hour with a loss entered
  });
  it('a whole-day stop on a day with pieces is not used', () => {
    const d = oleLineDay({ hours: made, targets, dayOff: { reason: 'No production plan' } });
    expect(d.closed).toBe(null); expect(d.dayOffIgnored).toBe(true); expect(d.total.qty).toBe(100); expect(d.total.totalMin).toBeGreaterThan(0);
  });
  it('a month: the closed day adds nothing, so it does not lower the OLE', () => {
    const lines = [{ line: '1', ok: true, models: [], dhm: [['2026-11-03', 9, 7, 200]] }];
    const s1 = { 1: { targets } };
    const withOff = oleRange({ lines, settings: s1, days: { '2026-11-04|1': { reason: 'Holiday / weekly off' } }, start: '2026-11-03', end: '2026-11-04', ids: ['1'] });
    const only = oleRange({ lines, settings: s1, start: '2026-11-03', end: '2026-11-03', ids: ['1'] });
    expect(withOff.days.length).toBe(2); expect(withOff.days[1].byLine['1'].closed).toBe('planned');
    expect(withOff.total.totalMin).toBe(only.total.totalMin); expect(withOff.total.ole).toBeCloseTo(only.total.ole);
  });
});

describe('time lost against std, model by model', () => {
  const at = (h, m, s) => `2026-11-05 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  // 10:00–11:00: WT70 (std 15 s) 10:00–10:30 every 30 s, then a 10-min stop, then WT80 (std 30 s) every 40 s until 11:00
  const scans = [];
  for (let i = 1; i <= 60; i++) scans.push({ mmId: 7, scanDate: at(10, Math.floor((i * 30) / 60), (i * 30) % 60), cycleSeconds: 30 });
  scans.push({ mmId: 8, scanDate: at(10, 40, 40), cycleSeconds: 640 });
  for (let i = 1; i <= 29; i++) { const t = 40 * 60 + 40 + i * 40; scans.push({ mmId: 8, scanDate: at(10, Math.floor(t / 60), t % 60), cycleSeconds: 40 }); }
  const models = [{ mmId: 7, model: 'WT70', quantity: 60, std: 15 }, { mmId: 8, model: 'WT80', quantity: 30, std: 30 }];
  it('run time from the scans; lost = run − std; the hour adds up', () => {
    const r = modelTimeOfHour({ hour: 10, scans, models });
    const [a, b] = r.rows;
    expect(a.runMin).toBeCloseTo(30, 1); expect(a.stdMin).toBe(15); expect(a.lostMin).toBeCloseTo(15, 1);
    expect(b.runMin).toBeCloseTo(30, 1); expect(b.stdMin).toBe(15); expect(b.lostMin).toBeCloseTo(15, 1);
    expect(r.runMin).toBeCloseTo(60, 1); expect(r.estimated).toBe(false);
  });
  it('planned stoppage is taken out first (with a model: from that model)', () => {
    const r = modelTimeOfHour({ hour: 10, scans, models, stops: [{ model: 'WT80', min: 10 }] });
    expect(r.rows[1].lostMin).toBeCloseTo(5, 1); expect(r.rows[0].lostMin).toBeCloseTo(15, 1);
  });
  it('a huge cycle on a scan (night, other model, two stations) never adds time: the models add up to the hour', () => {
    // 09:00–10:00, 186 pieces: WT70 49 pcs first (first scan carries a 14-hour cycle), then 137 pcs of RIO; a second station
    // sends its own scans of the same pieces with big cycles.
    const sc = [];
    for (let i = 0; i < 49; i++) { const t = 30 + i * 15; sc.push({ mmId: 1, scanDate: at(9, Math.floor(t / 60), t % 60), cycleSeconds: i ? 15 : 50400 }); }
    for (let i = 0; i < 137; i++) { const t = 13 * 60 + i * 20; sc.push({ mmId: 2, scanDate: at(9, Math.floor(t / 60), t % 60), cycleSeconds: i ? 20 : 3000 }); }
    sc.push({ mmId: 1, scanDate: at(9, 5, 0), cycleSeconds: 3600 }); sc.push({ mmId: 2, scanDate: at(9, 40, 0), cycleSeconds: 2400 });
    const md = [{ mmId: 1, model: 'WT70C3000RR', quantity: 49, std: 15 }, { mmId: 2, model: 'RIO', quantity: 137, std: 18 }];
    const r = modelTimeOfHour({ hour: 9, scans: sc, models: md, totalMin: 60 });
    expect(r.runMin).toBeCloseTo(60, 1);
    expect(r.rows[0].runMin).toBeLessThan(15); expect(r.rows[0].lostMin).toBeLessThan(3);
    expect(r.lostMin).toBeCloseTo(60 - (49 * 15 + 137 * 18) / 60, 0);
  });
  it('the current hour: models add up to the minutes gone so far', () => {
    const r = modelTimeOfHour({ hour: 10, scans, models, totalMin: 54, nowMin: 10 * 60 + 54 });
    expect(r.runMin).toBeLessThanOrEqual(54.01);
  });
  it('no scans: the hour is shared by std time (estimated)', () => {
    const r = modelTimeOfHour({ hour: 10, models, totalMin: 60 });
    expect(r.estimated).toBe(true); expect(r.rows[0].runMin).toBeCloseTo(30); expect(r.lostMin).toBeCloseTo(30);
  });
});

describe('losses by line and by department', () => {
  const issues = [
    { key: 'a', date: '2026-11-05', line: '1', kind: 'loss', reason: 'Material shortage', dept: 'Stores / SCM', value: 6, unit: 'min' },
    { key: 'b', date: '2026-11-05', line: '2', kind: 'loss', reason: 'Material shortage', dept: 'Stores / SCM', value: 4, unit: 'min' },
    { key: 'c', date: '2026-11-05', line: '1', kind: 'loss', reason: 'Breakdown', dept: 'Maintenance', value: 1, unit: 'min' },
    { key: 'd', date: '2026-11-05', line: '2', kind: 'reject', reason: 'Water leak', dept: 'Production', value: 2, unit: 'pcs' },
  ];
  it('by line: one row a line, in line order, with its minutes and pieces', () => {
    const g = groupIssues(issues, {}, 'line');
    expect(g.map((x) => x.name)).toEqual(['Line 1', 'Line 2']);
    expect(g[0].lossMin).toBe(7); expect(g[1].lossMin).toBe(4); expect(g[1].rejQty).toBe(2);
  });
  it('split: a department by line, a line by department', () => {
    const st = groupIssues(issues, {}, 'dept').find((x) => x.name === 'Stores / SCM');
    expect(splitText(st.items, 'line')).toEqual([['L1', '6′'], ['L2', '4′']]);
    const l2 = groupIssues(issues, {}, 'line')[1];
    expect(splitText(l2.items, 'dept')).toEqual([['Stores / SCM', '4′'], ['Production', '2 rej']]);
  });
});

import { workSecInHour, realCycleSec } from '../src/utils/shift';
import { buildTargetDay } from '../src/utils/targets';
describe('tea breaks in the shift master (14-11-2026)', () => {
  const sh = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [{ name: 'Tea', start: '11:00', end: '11:10' }, { name: 'Bad', start: '22:00', end: '22:10' }] };
  it('a break is no working time (hour target, parts, real cycle); a break outside the shift is dropped', () => {
    expect(workSecInHour(sh, 11)).toBe(50 * 60);
    expect(workSecInHour(sh, 11, 11 * 60 + 5)).toBe(0);
    expect(workSecInHour(sh, 11, 11 * 60 + 30)).toBe(20 * 60);
    expect(realCycleSec(sh, '2026-11-03 10:00:00', '2026-11-03 12:00:00', 111)).toBe(60);   // 110 min ÷ 110 gaps
    const d = buildTargetDay({ hours: [{ hour: 11, quantity: 50, models: [{ mmId: 7, quantity: 50 }] }], shift: sh, targets: { 7: { cycle: 60 } } });
    expect(d.rows.find((r) => r.hour === 11).planFull).toBe(50);
  });
});

// 17-11-2026: the admin's OLE formulas (Setup → Masters → OLE formulas)
import { setOleConfig, setOleStations, oleOf as oleOf2 } from '../src/utils/ole';
describe('admin OLE formulas', () => {
  const base = { totalMin: 60, stopMin: 0, plannedMin: 60, lossMin: 15, actualMin: 45, qty: 200, stdSec: 3000, noStdQty: 0, rejects: 4, rework: 6 };
  const std = { aEnd: 'lastScan', aLoss: 'all', lossIn: 'perf', pBase: 'run', pCap: false, qMode: 'rej' };
  it('standard: P on run time, not capped, Q without rework', () => {
    setOleConfig(std);
    const o = oleOf2(base);
    expect(o.P).toBeCloseTo(3000 / 2700); expect(o.Q).toBeCloseTo(196 / 200);
  });
  it('P on planned time, capped at 100 %', () => {
    setOleConfig({ ...std, pBase: 'planned' }); expect(oleOf2(base).P).toBeCloseTo(3000 / 3600);
    setOleConfig({ ...std, pCap: true }); expect(oleOf2(base).P).toBe(1);
  });
  it('Q takes rework out too', () => {
    setOleConfig({ ...std, qMode: 'rejRework' }); expect(oleOf2(base).Q).toBeCloseTo(190 / 200);
  });
  it('old planned stops out of the time; whole shift instead of last scan', () => {
    setOleConfig({ ...std, aLoss: 'unplanned' });
    const h = [{ hour: 9, quantity: 200, models: [{ mmId: 7, model: 'WT70', quantity: 200 }] }];
    const r = oleLineDay({ hours: h, targets: { 7: { cycle: 15 } }, entries: { 9: { stops: [{ reason: 'Meeting', min: 20 }], losses: [{ model: 'WT70', reason: 'Breakdown', min: 10 }] } } }).rows[0];
    expect([r.plannedMin, r.lossMin, r.actualMin, r.A, r.perfLossMin]).toEqual([40, 0, 40, 1, 10]);   // the model loss is performance loss
    setOleConfig({ ...std, aEnd: 'shiftEnd' });
    expect(oleLineDay({ hours: h, targets: { 7: { cycle: 15 } } }).total.totalMin).toBe(675);   // 11.25 h: lunch + tea break out
    setOleConfig(std);
    expect(oleLineDay({ hours: h, targets: { 7: { cycle: 15 } } }).total.totalMin).toBe(60);
  });
  it('more choices (18-11-2026): model loss in A or P, empty hour idle, no-std pieces at the average, final-check quality', () => {
    const h = [{ hour: 9, quantity: 200, models: [{ mmId: 7, model: 'WT70', quantity: 150 }, { mmId: 99, model: 'NEW', quantity: 50 }] }, { hour: 10, quantity: 0, models: [] }];
    const ent = { 9: { losses: [{ model: 'WT70', reason: 'Breakdown', min: 10 }], rejects: [{ station: 'LQC', reason: 'x', qty: 3 }, { station: 'FQC', reason: 'y', qty: 2 }] } };
    const run = (c) => { setOleConfig({ ...std, aEnd: 'shiftEnd', ...c }); return oleLineDay({ hours: h, targets: { 7: { cycle: 15 } }, entries: ent }).rows; };
    let [r9, r10] = run({});
    expect([r9.lossMin, r9.perfLossMin, r9.actualMin, r9.noStdQty, r9.rejects]).toEqual([0, 10, 60, 50, 5]);   // standard
    expect([r10.lossMin, r10.A]).toEqual([0, 1]);
    [r9] = run({ lossIn: 'avail' });
    expect([r9.lossMin, r9.perfLossMin, r9.actualMin]).toEqual([10, 0, 50]);
    [, r10] = run({ aIdle: 'idle' });
    expect([r10.lossMin, r10.A]).toEqual([60, 0]);
    [r9] = run({ pNoStd: 'avg' });
    expect(r9.noStdQty).toBe(0); expect(r9.stdSec).toBeCloseTo(200 * 15);
    setOleStations([{ reason: 'LQC', type: 'inline' }, { reason: 'FQC', type: 'final' }]);
    [r9] = run({ qStations: 'final' });
    expect(r9.rejects).toBe(2);
    setOleStations([]);
    setOleConfig({ ...std, aEnd: 'lastScan', lossIn: 'perf', aIdle: 'run', pNoStd: 'skip', qStations: 'all' });
  });
});

// 17-11-2026: manpower sync, colour limits, time format (Setup → Masters → OLE formulas)
import { mpFactorOf, mpOfDay, okFrom, watchFrom, hm as hm2, OLE_CFG_DEFAULT } from '../src/utils/ole';
import { normalizeOle } from '../src/utils/uiSettings';
describe('admin: manpower sync', () => {
  const lines = [{ line: '1', ok: true, models: [], dhm: [['2026-11-03', 9, 7, 120]] }];
  const settings = { 1: { targets: { 7: { cycle: 15 } } } };
  it('off: nothing changes', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT });
    expect(mpFactorOf('1', { mp: 80 })).toBe(1);
    const r = oleDayLines({ lines, settings, date: '2026-11-03', setups: { '2026-11-03|1': { mp: 80 } } });
    expect(r['1'].total.stdSec).toBe(120 * 15); expect(r['1'].mp).toBe(80);
  });
  it('on: fewer people → longer std cycle → std time up, target down', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT, mpSync: true, stdMp: { 1: 100 } });
    expect(mpFactorOf('1', { mp: 80 })).toBeCloseTo(0.8);
    const r = oleDayLines({ lines, settings, date: '2026-11-03', setups: { '2026-11-03|1': { mp: 80 } } });
    expect(r['1'].total.stdSec).toBeCloseTo((120 * 15) / 0.8); expect(r['1'].mpFactor).toBeCloseTo(0.8);
    expect(r['1'].rows[0].models[0].std).toBeCloseTo(18.75);
  });
  it('more people than std: kept at the std unless the admin allows it', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT, mpSync: true, stdMp: { 1: 100 } });
    expect(mpFactorOf('1', { mp: 120 })).toBe(1);
    setOleConfig({ ...OLE_CFG_DEFAULT, mpSync: true, mpUp: true, stdMp: { 1: 100 } });
    expect(mpFactorOf('1', { mp: 120 })).toBeCloseTo(1.2);
  });
  it('open or the average of open and close; no entry / no std → 1', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT, mpSync: true, mpUse: 'avg', stdMp: { 1: 100 } });
    expect(mpOfDay({ mp: 80, mpClose: 90 })).toBe(85); expect(mpFactorOf('1', { mp: 80, mpClose: 90 })).toBeCloseTo(0.85);
    expect(mpOfDay({ mp: 80 })).toBe(80);
    expect(mpFactorOf('1', null)).toBe(1); expect(mpFactorOf('2', { mp: 80 })).toBe(1);
  });
});
describe('admin: colours and time', () => {
  it('colour limits follow the admin', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT, good: 80, watch: 50 }); expect(okFrom()).toBe(0.8); expect(watchFrom()).toBe(0.5);
    setOleConfig({ ...OLE_CFG_DEFAULT }); expect(okFrom()).toBe(0.85); expect(watchFrom()).toBe(0.6);
  });
  it('time: 6.3 h or 6h 18m', () => {
    setOleConfig({ ...OLE_CFG_DEFAULT }); expect(hm2(378)).toBe('6.3 h'); expect(hm2(15)).toBe('0.3 h');
    setOleConfig({ ...OLE_CFG_DEFAULT, timeFmt: 'hm' }); expect(hm2(378)).toBe('6h 18m'); expect(hm2(15)).toBe('15m');
    setOleConfig({ ...OLE_CFG_DEFAULT });
  });
  it('settings are cleaned (mirrors the backend)', () => {
    const n = normalizeOle({ good: 120, watch: 99, fewPcs: 0, stdMp: { 1: '96', 2: '', 3: -4, 9: 50 }, mpSync: 1, timeFmt: 'x', bench: 2 });
    expect(n).toMatchObject({ good: 100, watch: 99, fewPcs: 1, stdMp: { 1: 96 }, mpSync: true, timeFmt: 'h1', mpUse: 'open' });
    expect(normalizeOle({ good: 70, watch: 90, bench: 2 }).watch).toBe(70);
    // 19-11-2026: a setup saved before bench 2 gets OLE 95 / 85 and Performance max 100 % once
    expect(normalizeOle({ good: 80, watch: 50, pCap: false })).toMatchObject({ good: 95, watch: 85, pCap: true, bench: 2 });
  });
});

import { normalizeUi as nUi25 } from '../src/utils/uiSettings';
describe('quality counts the rework (25-11-2026)', () => {
  it('a setup saved with "rejected only" moves to rejected + rework once; the admin can choose again', () => {
    expect(nUi25({ ole: { qMode: 'rej', bench: 2 } }).ole.qMode).toBe('rejRework');
    expect(nUi25({ ole: { qMode: 'rej', qV: 2, bench: 2 } }).ole.qMode).toBe('rej');
  });
});

// 26-11-2026: Quality shows the dismantled pieces with the rework (written on the rework rows), summed over hours
describe('dismantled pieces', () => {
  it('an hour counts the dismantle of its rework rows; a total adds the hours', () => {
    setCfg0({ ...DEF0 });
    const ent = { 9: { rework: [{ model: 'WT70', reason: 'Leak', qty: 5, dismantle: 2 }, { model: 'WT70', reason: 'Noise', qty: 3, dismantle: 1 }] }, 10: { rework: [{ model: 'WT70', reason: 'Leak', qty: 2, dismantle: 9 }] } };
    const hours = [9, 10].map((h) => ({ hour: h, quantity: 100, models: [{ mmId: 7, model: 'WT70', quantity: 100 }] }));
    const { rows } = oleLineDay({ hours, targets, entries: ent });
    const r9 = rows.find((r) => r.hour === 9), r10 = rows.find((r) => r.hour === 10);
    expect([r9.dismantle, r10.dismantle]).toEqual([3, 2]);   // never more than the pieces of its row
    expect(oleSum([r9, r10]).dismantle).toBe(5);
    expect(oleSum([r9, r10]).rework).toBe(10);
  });
});

// 26-11-2026: the good pieces shown beside Quality are the same pieces Q counts
import { goodOf as goodOf0, oleSum as oleSum0 } from '../src/utils/ole';
describe('good pieces = what Quality counts', () => {
  it('rework counts (default): good = made − rejected − reworked, and Q = good ÷ made', () => {
    setCfg0({ ...DEF0, qMode: 'rejRework' });
    const t = { qty: 1000, rejects: 0, rework: 1 };
    expect(goodOf0(t)).toBe(999);
    const s = oleSum0([{ totalMin: 60, plannedMin: 60, actualMin: 60, lossMin: 0, qty: 1000, stdSec: 3000, rejects: 0, rework: 1 }]);
    expect(Math.round(s.Q * 10000) / 10000).toBe(Math.round((goodOf0(s) / s.qty) * 10000) / 10000);
  });
  it('rejections only: rework is not taken out', () => {
    setCfg0({ ...DEF0, qMode: 'rej' });
    expect(goodOf0({ qty: 1000, rejects: 2, rework: 5 })).toBe(998);
    setCfg0({ ...DEF0 });
  });
});
