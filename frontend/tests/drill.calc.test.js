// Drill-down analysis of the losses (src/utils/drill.js): facts, filters, groups, trend, heat map, production gap (HPR way).
import { describe, it, expect } from 'vitest';
import {
  buildFacts, applyFilters, setFilter, effectiveRange, prevRange, groupBy, kpisOf, grainOf, bucketOf, bucketsOf, trendOf,
  matrixOf, gapOf, gapSummary, gapHours, minText, ticksOf, measuresOf, mv, NOT_WRITTEN, daysIn, MIN_STEPS, axisText,
} from '../src/utils/drill';
import { oleLineDay, setRcaFrom } from '../src/utils/ole';
setRcaFrom('');   // these fixtures are older than the RCA start day (23-11-2026)
import { hprHours, buildHprSheets } from '../src/utils/hpr';

const HPR = { rate: 65, otFrom: '18:00', otX: 2 };
const SHIFT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30', breaks: [] };
const E = (losses = [], stops = [], rejects = [], note = '') => ({ losses, stops, rejects, rework: [], note, updatedBy: 'sup1', updatedAt: '2026-10-05 10:00:00' });
const entries = {
  '2026-10-05|1|9': E([{ reason: 'Motor Shortage', dept: 'Kitting Store', min: 20, model: 'WT70', part: 'Motor' }, { reason: 'Model Change', dept: 'Prod', min: 10 }], [], [], 'motor late'),
  '2026-10-05|1|18': E([{ reason: 'Motor Shortage', dept: 'Kitting Store', min: 15 }]),
  '2026-10-06|2|11': E([{ reason: 'Barcode / XML scan error', dept: 'IT', min: 40 }], [{ reason: 'Meeting / training', dept: 'Prod', min: 10 }], [{ reason: 'Scratch', dept: 'Moulding QA', qty: 3 }]),
  '2026-10-12|3|10': E([{ reason: 'Model Change', dept: 'Production', min: 5 }]),   // old department name
  '2026-09-28|1|9': E([{ reason: 'Motor Shortage', dept: 'Kitting Store', min: 30 }]),   // previous period
};
const setups = { '2026-10-05|1': { mp: 96 }, '2026-10-06|2': { mp: 100 } };
const reasons = { loss: [{ reason: 'Model Change', dept: 'Prod', owner: 'Ajay Kumar' }, { reason: 'Motor Shortage', dept: 'Kitting Store', owner: 'Arvind Pandey' }], stop: [], reject: [], rework: [] };
const rca = { '2026-10-05|1|loss|Motor Shortage': { status: 'closed', rootCause: 'Vendor late' }, '2026-10-06|2|loss|Barcode / XML scan error': { status: 'submitted' } };
const facts = buildFacts({ entries, start: '2026-09-28', end: '2026-10-31', setups, rca, reasons, hpr: HPR });
const oct = (fs) => fs.filter((f) => f.date >= '2026-10-01');

describe('facts', () => {
  it('one fact per written row, with department (old names mapped), owner (row or master), ₹ and RCA status', () => {
    const f = oct(facts);
    expect(f.map((x) => [x.date, x.line, x.hour, x.kind, x.reason, x.dept, x.value])).toEqual([
      ['2026-10-05', '1', 9, 'loss', 'Motor Shortage', 'Kitting Store', 20],
      ['2026-10-05', '1', 9, 'loss', 'Model Change', 'Prod', 10],
      ['2026-10-05', '1', 18, 'loss', 'Motor Shortage', 'Kitting Store', 15],
      ['2026-10-06', '2', 11, 'loss', 'Barcode / XML scan error', 'IT', 40],
      ['2026-10-06', '2', 11, 'stop', 'Meeting / training', 'Prod', 10],
      ['2026-10-06', '2', 11, 'reject', 'Scratch', 'Moulding QA', 3],
      ['2026-10-12', '3', 10, 'loss', 'Model Change', 'Prod', 5],
    ]);
    expect(f[0].owner).toBe('Arvind Pandey');
    expect(f[0].rs).toBe(65 * (20 / 60) * 96);
    expect(f[2].rs).toBe(65 * (15 / 60) * 96 * 2);   // 18:00 = overtime
    expect(f[6].rs).toBe(null);                       // no morning entry → no manpower
    expect([f[0].rca, f[1].rca, f[3].rca, f[4].rca]).toEqual(['closed', 'pending', 'submitted', 'na']);
    expect([f[0].note, f[0].by, f[0].part, f[0].model]).toEqual(['motor late', 'sup1', 'Motor', 'WT70']);
    expect(f[5].unit).toBe('pcs');
  });
  it('lines of the login only, period only', () => {
    expect(buildFacts({ entries, start: '2026-10-01', end: '2026-10-31', ids: ['2'] }).map((x) => x.line)).toEqual(['2', '2', '2']);
  });
});

describe('filters and the drill path', () => {
  it('a click adds a filter; a second click on the same value takes it away; another value replaces it', () => {
    let f = setFilter([], 'dept', 'Kitting Store');
    f = setFilter(f, 'line', '1');
    expect(f).toEqual([{ dim: 'dept', value: 'Kitting Store' }, { dim: 'line', value: '1' }]);
    expect(setFilter(f, 'dept', 'IT')).toEqual([{ dim: 'dept', value: 'IT' }, { dim: 'line', value: '1' }]);
    expect(setFilter(f, 'line', '1')).toEqual([{ dim: 'dept', value: 'Kitting Store' }]);
  });
  it('filters cut the slice; skip leaves one dimension open (its own list shows every value)', () => {
    const fl = [{ dim: 'dept', value: 'Kitting Store' }, { dim: 'line', value: '1' }];
    const s = applyFilters(facts, { filters: fl, kinds: ['loss'], from: '2026-10-01', to: '2026-10-31' });
    expect(s.map((x) => x.value)).toEqual([20, 15]);
    const open = applyFilters(facts, { filters: fl, kinds: ['loss'], from: '2026-10-01', to: '2026-10-31', skip: ['dept'] });
    expect(open.map((x) => x.dept)).toEqual(['Kitting Store', 'Prod', 'Kitting Store']);
  });
  it('a day or a span narrows the period; the previous period has the same length', () => {
    expect(effectiveRange('2026-10-01', '2026-10-31', [{ dim: 'span', value: { from: '2026-10-05', to: '2026-10-11' } }])).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(effectiveRange('2026-10-01', '2026-10-31', [{ dim: 'span', value: { from: '2026-09-28', to: '2026-10-04' } }, { dim: 'date', value: '2026-10-02' }])).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(prevRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-08-31', to: '2026-09-30', days: 31 });
    expect(daysIn('2026-10-01', '2026-10-01')).toBe(1);
  });
});

describe('groups (Pareto lists)', () => {
  const slice = applyFilters(facts, { kinds: ['loss'], from: '2026-10-01', to: '2026-10-31' });
  const prev = applyFilters(facts, { kinds: ['loss'], from: '2026-08-31', to: '2026-09-30' });
  it('departments biggest first, share and cumulative %, class A up to 80 %', () => {
    const g = groupBy(slice, 'dept', 'value');
    expect(g.map((x) => [x.key, x.value, Math.round(x.share), Math.round(x.cumPct), x.cls])).toEqual([
      ['IT', 40, 44, 44, 'A'], ['Kitting Store', 35, 39, 83, 'A'], ['Prod', 15, 17, 100, 'B'],
    ]);
    expect(g[1].lines).toEqual(['1']);
    expect(g[2].lines).toEqual(['1', '3']);
  });
  it('compare with the previous period: prev value and delta per key', () => {
    const g = groupBy(slice, 'dept', 'value', { prev });
    expect(g.find((x) => x.key === 'Kitting Store')).toMatchObject({ prev: 30, delta: 5 });
    expect(g.find((x) => x.key === 'IT')).toMatchObject({ prev: 0, delta: 40 });
  });
  it('natural order for lines and hours; top n folds the rest into Others', () => {
    expect(groupBy(slice, 'line', 'value').map((x) => x.key)).toEqual(['1', '2', '3']);
    expect(groupBy(slice, 'hour', 'value').map((x) => x.label)).toEqual(['09:00–10:00', '10:00–11:00', '11:00–12:00', '18:00–19:00']);
    const t = groupBy(slice, 'reason', 'value', { top: 2 });
    expect(t.map((x) => [x.label, x.value])).toEqual([['Barcode / XML scan error', 40], ['Motor Shortage', 35], ['Others (1)', 15]]);
  });
  it('₹ per group only from rows with manpower', () => {
    const g = groupBy(slice, 'dept', 'rs');
    expect(Math.round(g.find((x) => x.key === 'IT').value)).toBe(Math.round(65 * (40 / 60) * 100));
    const p = groupBy(slice, 'dept', 'value').find((x) => x.key === 'Prod');
    expect(p.rs).toBe(65 * (10 / 60) * 96);   // line 3 has no manpower: its 5 min have no ₹
  });
  it('KPIs: total, entries, days, ₹, minutes without manpower, RCA issues by status', () => {
    const k = kpisOf(slice, 'value');
    expect([k.total, k.entries, k.days, k.lines, k.noMpMin]).toEqual([90, 5, 3, 3, 5]);
    expect(k.rca).toEqual({ pending: 2, submitted: 1, closed: 1, issues: 4 });
  });
  it('measures of a type', () => {
    expect(measuresOf('loss').map((x) => x[0])).toEqual(['value', 'rs', 'count']);
    expect(measuresOf('time').map((x) => x[0])).toEqual(['value', 'rs', 'hpr', 'count']);
    expect(measuresOf('reject').map((x) => x[0])).toEqual(['value', 'count']);
  });
});

describe('time', () => {
  it('bars per day up to a month, per week up to ~4 months, else per month', () => {
    expect([grainOf('2026-10-01', '2026-10-31'), grainOf('2026-08-01', '2026-10-31'), grainOf('2026-05-01', '2026-10-31')]).toEqual(['day', 'week', 'month']);
    expect(bucketOf('2026-10-07', 'week')).toBe('2026-10-05');   // Monday
    expect(bucketOf('2026-10-07', 'month')).toBe('2026-10');
    const w = bucketsOf('2026-10-01', '2026-10-31', 'week');
    expect(w[0]).toMatchObject({ key: '2026-09-28', from: '2026-10-01', to: '2026-10-04' });
    expect(w[w.length - 1]).toMatchObject({ key: '2026-10-26', from: '2026-10-26', to: '2026-10-31' });
  });
  it('trend: every day of the period (zero days too), split by department', () => {
    const slice = applyFilters(facts, { kinds: ['loss'], from: '2026-10-01', to: '2026-10-31' });
    const t = trendOf(slice, { from: '2026-10-01', to: '2026-10-31', split: 'dept' });
    expect(t.buckets.length).toBe(31);
    expect(t.buckets[4]).toMatchObject({ key: '2026-10-05', total: 45, parts: { 'Kitting Store': 35, Prod: 10 } });
    expect(t.buckets[0].total).toBe(0);
    expect(t.max).toBe(45);
    expect(t.series.sort()).toEqual(['IT', 'Kitting Store', 'Prod']);
  });
});

describe('heat map', () => {
  const slice = applyFilters(facts, { kinds: ['loss'], from: '2026-10-01', to: '2026-10-31' });
  it('line × department with totals', () => {
    const m = matrixOf(slice, 'line', 'dept', 'value', { from: '2026-10-01', to: '2026-10-31' });
    expect(m.rows.map((r) => r.key)).toEqual(['1', '2', '3']);
    expect(m.cols.map((c) => c.key)).toEqual(['IT', 'Kitting Store', 'Prod']);
    expect(m.grid).toEqual([[0, 35, 10], [40, 0, 0], [0, 0, 5]]);
    expect(m.max).toBe(40);
    expect(m.rows[0].total).toBe(45);
  });
  it('department × time (weeks), the rest folded into Other', () => {
    const m = matrixOf(slice, 'dept', 'time', 'value', { from: '2026-10-01', to: '2026-10-31', grain: 'week', maxRows: 2 });
    expect(m.rows.map((r) => r.label)).toEqual(['IT', 'Other (2)']);
    expect(m.cols.length).toBe(5);
    expect(m.grid[1][1]).toBe(45);   // week of 05-10: Kitting Store 35 + Prod 10
  });
});

describe('production: lost time against the target (HPR way)', () => {
  const targets = { 1: { cycle: 3600 / 187 } };
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => ({ hour: h, quantity: h === 13 ? 94 : h === 9 ? 150 : h === 18 ? 170 : h === 12 ? 100 : 187, models: [{ mmId: 1, model: 'WT70', quantity: h === 13 ? 94 : h === 9 ? 150 : h === 18 ? 170 : h === 12 ? 100 : 187 }] }));
  const ent = { 9: entries['2026-10-05|1|9'], 18: entries['2026-10-05|1|18'] };
  const day = oleLineDay({ hours, targets, entries: ent, shift: SHIFT });
  const days = [{ date: '2026-10-05', byLine: { 1: { ok: true, ...day }, 2: { ok: false, rows: [] } } }];
  const g = gapOf({ days, ids: ['1', '2'], settings: { 1: { shift: SHIFT } }, setups, targetsByLine: { 1: targets } });
  it('lost minutes of the short hours; a line without an answer is listed', () => {
    expect(Math.round(g.byHour['2026-10-05|1|9'] * 100) / 100).toBe(Math.round((60 / 187) * 37 * 100) / 100);
    expect(g.byHour['2026-10-05|1|10']).toBe(0);
    expect(g.failed).toEqual(['2']);
    const s = gapSummary(g.hours, ['1', '2']);
    expect(s.total.short).toBe(3);                 // 9:00, 12:00, 18:00
    expect(s.total.shortNoReason).toBe(1);         // 12:00 has no reason
    expect(Math.round(s.total.lostNoReason * 100) / 100).toBe(Math.round((60 / 187) * 87 * 100) / 100);
    expect(gapHours(g.hours, [{ dim: 'hour', value: 12 }]).length).toBe(1);
  });
  it('the HPR measure: a short hour split over its reasons by their minutes, "Reason not written" for the rest', () => {
    const f = buildFacts({ entries: Object.fromEntries(Object.entries(entries).filter(([k]) => k.startsWith('2026-10-05|1'))), start: '2026-10-05', end: '2026-10-05', setups, hpr: HPR, lost: g.byHour });
    const lost9 = (60 / 187) * 37;
    expect(f.find((x) => x.reason === 'Motor Shortage' && x.hour === 9).hpr).toBeCloseTo(lost9 * (20 / 30), 6);
    expect(f.find((x) => x.reason === 'Model Change').hpr).toBeCloseTo(lost9 * (10 / 30), 6);
    const nw = f.filter((x) => x.pseudo);
    expect(nw.map((x) => [x.hour, x.dept])).toEqual([[12, NOT_WRITTEN]]);
    expect(mv(nw[0], 'count')).toBe(0);
    expect(mv(nw[0], 'value')).toBe(0);
  });
  it('department totals of the HPR measure = the "Line Loss" block of the HPR Excel', () => {
    const f = buildFacts({ entries: Object.fromEntries(Object.entries(entries).filter(([k]) => k.startsWith('2026-10-05|1'))), start: '2026-10-05', end: '2026-10-05', setups, hpr: HPR, lost: g.byHour });
    const mine = Object.fromEntries(groupBy(f, 'dept', 'hpr').map((x) => [x.key, Math.round(x.value * 100) / 100]));
    const H = hprHours({ rows: day.rows, shift: SHIFT, targets, otFrom: '18:00', date: '2026-10-05', line: '1' });
    const sh = buildHprSheets([{ date: '2026-10-05', lines: [{ line: '1', mp: 96, shift: SHIFT, hours: H }] }], HPR)[0];
    const top = {};
    for (let r = 2; r < 12; r++) { const row = sh.rows[r]; if (typeof row?.[5]?.v === 'number' && row[4]?.v !== 'Total') top[row[4].v] = -row[5].v; }   // E = department, F = I/T minutes (negative)
    expect(Object.keys(top).length).toBe(3);
    expect(mine).toEqual(top);
  });
});

describe('text', () => {
  it('minutes and axis ticks', () => {
    expect([minText(40), minText(77), minText(0.44), minText(125.4)]).toEqual(['40 min', '1 h 17 m', '0.4 min', '2 h 05 m']);
    expect(ticksOf(45)).toEqual([0, 20, 40, 60]);
    expect(ticksOf(100)).toEqual([0, 25, 50, 75, 100]);
    expect(ticksOf(0)).toEqual([0]);
    expect(ticksOf(1960, 4, MIN_STEPS)).toEqual([0, 600, 1200, 1800, 2400]);   // minutes → whole hours on the axis
    expect([axisText(600, 'value'), axisText(30, 'value'), axisText(90, 'value'), axisText(0, 'value'), axisText(2500, 'rs')]).toEqual(['10 h', '30m', '1.5 h', '0', '₹2.5K']);
  });
});

describe('RCA start day (23-11-2026)', () => {
  it('losses before the RCA start day need no RCA and are not pending', async () => {
    const { needsRca } = await import('../src/utils/ole');
    setRcaFrom('2026-11-23');
    expect(needsRca({ kind: 'loss', date: '2026-11-22' })).toBe(false);
    expect(needsRca({ kind: 'loss', date: '2026-11-23' })).toBe(true);
    expect(needsRca({ kind: 'reject', date: '2026-11-24' })).toBe(true);
    expect(needsRca({ kind: 'stop', date: '2026-11-24' })).toBe(false);
    setRcaFrom('');
  });
});

