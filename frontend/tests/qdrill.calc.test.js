// Rejection / Rework analysis (src/utils/qdrill.js): quality facts with their station, production of the slice, rates.
import { describe, it, expect } from 'vitest';
import { buildFacts, applyFilters, groupBy, setFilter, matrixOf, trendOf, filterText, ticksOf, INT_STEPS } from '../src/utils/drill';
import {
  qualityFacts, stationShort, prodRows, prodIn, madeOf, madeBy, madeByBucket, withRate, qualityKpis, rateOf, ppmOf, pctText, ppmText, NO_STATION, qkindOf,
} from '../src/utils/qdrill';

const ST = [
  { reason: 'LQC (line quality check)', code: 'LQC', aliases: ['line qc'] },
  { reason: 'FQC (final quality check)', code: 'FQC' },
  { reason: 'Leak test', code: '' },
];
const E = (rejects = [], rework = []) => ({ stops: [], losses: [], rejects, rework, note: '', updatedBy: 'sup1', updatedAt: '2026-10-05 10:00:00' });
const entries = {
  '2026-10-05|1|9': E([{ station: 'FQC (final quality check)', model: 'WT70', reason: 'Scratch', dept: 'Moulding QA', qty: 3 }, { station: 'line qc', model: 'WT70', reason: 'Dent', dept: 'Prod', qty: 2 }]),
  '2026-10-05|1|10': E([{ station: 'LQC', model: 'WT80', reason: 'Scratch', dept: 'Moulding QA', qty: 1 }], [{ station: 'Leak test', model: 'WT80', reason: 'Leak', dept: 'Prod', qty: 4 }]),
  '2026-10-06|2|11': E([{ station: '', model: '', reason: 'Wrong label', dept: 'IT', qty: 5 }]),
};
const facts = buildFacts({ entries, start: '2026-10-01', end: '2026-10-31' });
const rej = qualityFacts(facts, 'reject', ST);
const rwk = qualityFacts(facts, 'rework', ST);
// production: Line 1 on 05-10 hours 9 and 10 (two models in hour 9), Line 2 on 06-10 hour 11 without model detail, a future hour
const days = [
  { date: '2026-10-05', byLine: { 1: { ok: true, rows: [
    { hour: 9, qty: 100, models: [{ model: 'WT70', quantity: 60 }, { model: 'WT80', quantity: 40 }] },
    { hour: 10, qty: 50, models: [{ model: 'WT80', quantity: 50 }] },
    { hour: 11, qty: 0, future: true, models: [] }] }, 2: { ok: false, rows: [] } } },
  { date: '2026-10-06', byLine: { 2: { ok: true, rows: [{ hour: 11, qty: 200, models: [{ model: 'WT90', quantity: 150 }] }] } } },
];
const prod = prodRows(days, ['1', '2']);

describe('quality facts', () => {
  it('one fact per row of the kind; the station is the admin\'s station (code / old name matched), else "Station not given"', () => {
    expect(rej.map((f) => [f.date, f.line, f.hour, f.station, f.defect, f.model, f.value])).toEqual([
      ['2026-10-05', '1', 9, 'FQC (final quality check)', 'Scratch', 'WT70', 3],
      ['2026-10-05', '1', 9, 'LQC (line quality check)', 'Dent', 'WT70', 2],
      ['2026-10-05', '1', 10, 'LQC (line quality check)', 'Scratch', 'WT80', 1],
      ['2026-10-06', '2', 11, NO_STATION, 'Wrong label', '', 5],
    ]);
    expect(rwk.map((f) => [f.station, f.defect, f.value])).toEqual([['Leak test', 'Leak', 4]]);
    expect(rej[0].stationCode).toBe('FQC');
  });
  it('short station names: the code, else the name without "(…)"', () => {
    expect(stationShort('LQC (line quality check)', ST)).toBe('LQC');
    expect(stationShort('Leak test', ST)).toBe('Leak test');
    expect(stationShort('Old station (x)', ST)).toBe('Old station');
    expect(stationShort('', ST)).toBe(NO_STATION);
  });
  it('the two pages', () => {
    expect(qkindOf('reject').title).toBe('Rejection analysis');
    expect(qkindOf('rework').page).toBe('rwkan');
    expect(qkindOf('x').id).toBe('reject');
  });
});

describe('production of the slice', () => {
  it('one row per line × day × hour × model; pieces no model claims get model ""; failed lines and hours to come left out', () => {
    expect(prod).toEqual([
      { date: '2026-10-05', line: '1', hour: 9, model: 'WT70', qty: 60 },
      { date: '2026-10-05', line: '1', hour: 9, model: 'WT80', qty: 40 },
      { date: '2026-10-05', line: '1', hour: 10, model: 'WT80', qty: 50 },
      { date: '2026-10-06', line: '2', hour: 11, model: 'WT90', qty: 150 },
      { date: '2026-10-06', line: '2', hour: 11, model: '', qty: 50 },
    ]);
    expect(madeOf(prod)).toBe(350);
  });
  it('line / day / span / hour / model filters cut production; station, defect, department do not', () => {
    expect(madeOf(prodIn(prod, { filters: [{ dim: 'line', value: '1' }] }))).toBe(150);
    expect(madeOf(prodIn(prod, { filters: [{ dim: 'model', value: 'WT80' }] }))).toBe(90);
    expect(madeOf(prodIn(prod, { filters: [{ dim: 'hour', value: '9' }] }))).toBe(100);
    expect(madeOf(prodIn(prod, { filters: [{ dim: 'span', value: { from: '2026-10-06', to: '2026-10-31' } }] }))).toBe(200);
    expect(madeOf(prodIn(prod, { filters: [{ dim: 'station', value: 'Leak test' }, { dim: 'defect', value: 'Scratch' }] }))).toBe(350);
    expect(madeOf(prodIn(prod, { filters: [{ dim: 'line', value: '1' }], skip: ['line'] }))).toBe(350);
    expect(madeOf(prodIn(prod, { from: '2026-10-06', to: '2026-10-06' }))).toBe(200);
  });
  it('pieces made per line / model / hour / day and per bucket of the trend', () => {
    expect([...madeBy(prod, 'line')]).toEqual([['1', 150], ['2', 200]]);
    expect([...madeBy(prod, 'model')]).toEqual([['WT70', 60], ['WT80', 90], ['WT90', 150], ['', 50]]);
    expect([...madeBy(prod, 'hour')]).toEqual([['9', 100], ['10', 50], ['11', 200]]);
    expect([...madeByBucket(prod, 'day')]).toEqual([['2026-10-05', 150], ['2026-10-06', 200]]);
    expect([...madeByBucket(prod, 'month')]).toEqual([['2026-10', 350]]);
  });
});

describe('rates', () => {
  it('rate % and PPM of the pieces made; nothing made → no rate', () => {
    expect(rateOf(11, 350)).toBeCloseTo(3.142857, 5);
    expect(ppmOf(11, 350)).toBeCloseTo(31428.57, 1);
    expect(rateOf(3, 0)).toBe(null);
    expect(pctText(3.142857)).toBe('3.14%');
    expect(pctText(12.345)).toBe('12.3%');
    expect(pctText(null)).toBe('—');
    expect(pctText(0.0030326)).toBe('0.003%');
    expect(pctText(0)).toBe('0%');
    expect(pctText(0.0002)).toBe('<0.001%');
    expect(ppmText(31428.57)).toBe('31,429 PPM');
  });
  it('groups with their rate: a production dimension against its own pieces, the others against the slice', () => {
    const byLine = withRate(groupBy(rej, 'line'), 'line', prod, madeOf(prod));
    expect(byLine.map((g) => [g.key, g.value, g.made, Math.round(g.rate * 100) / 100])).toEqual([['1', 6, 150, 4], ['2', 5, 200, 2.5]]);
    const byModel = withRate(groupBy(rej, 'model'), 'model', prod, madeOf(prod));
    expect(byModel.map((g) => [g.key, g.value, g.made])).toEqual([['', 5, 50], ['WT70', 5, 60], ['WT80', 1, 90]]);   // ties: by name
    const byStation = withRate(groupBy(rej, 'station'), 'station', prod, 350);
    expect(byStation.map((g) => [g.key, g.value, g.made])).toEqual([['LQC (line quality check)', 3, 350], ['FQC (final quality check)', 3, 350], [NO_STATION, 5, 350]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
    const top1 = withRate(groupBy(rej, 'defect', 'value', { top: 1 }), 'defect', prod, 350);
    expect(top1[1].others && top1[1].rate === null).toBe(true);
  });
  it('totals of a slice: pieces, entries, days, made, rate, PPM, top defect / station / model', () => {
    const K = qualityKpis(rej, madeOf(prod));
    expect([K.total, K.entries, K.days, K.lines, K.made]).toEqual([11, 4, 2, 2, 350]);
    expect(Math.round(K.rate * 100) / 100).toBe(3.14);
    expect(K.topDefect).toEqual({ key: 'Wrong label', value: 5, share: (5 / 11) * 100 });
    expect(K.topStation.key).toBe(NO_STATION);
    const L1 = applyFilters(rej, { filters: [{ dim: 'line', value: '1' }] });
    const K1 = qualityKpis(L1, madeOf(prodIn(prod, { filters: [{ dim: 'line', value: '1' }] })));
    expect([K1.total, K1.made, K1.rate]).toEqual([6, 150, 4]);
    expect(K1.topDefect.key).toBe('Scratch');
    expect(qualityKpis([], 0).rate).toBe(null);
  });
});

describe('drill on station and defect', () => {
  it('a station or a defect is a filter like the others; heat map station × defect', () => {
    const f = setFilter(setFilter([], 'station', 'LQC (line quality check)'), 'defect', 'Scratch');
    expect(applyFilters(rej, { filters: f }).map((x) => [x.hour, x.value])).toEqual([[10, 1]]);
    expect(filterText({ dim: 'station', value: 'Leak test' })).toBe('Station: Leak test');
    expect(filterText({ dim: 'defect', value: 'Leak' })).toBe('Defect: Leak');
    const M = matrixOf(rej, 'station', 'defect', 'value', { from: '2026-10-01', to: '2026-10-31' });
    const at = (r, c) => M.grid[M.rows.findIndex((x) => x.key === r)][M.cols.findIndex((x) => x.key === c)];
    expect(at('FQC (final quality check)', 'Scratch')).toBe(3);
    expect(at('LQC (line quality check)', 'Scratch')).toBe(1);
    expect(at('LQC (line quality check)', 'Dent')).toBe(2);
    const T = trendOf(rej, { from: '2026-10-05', to: '2026-10-06', split: 'station' });
    expect(T.buckets.map((b) => b.total)).toEqual([6, 5]);
    expect(T.series.sort()).toEqual(['FQC (final quality check)', 'LQC (line quality check)', NO_STATION].sort());
  });
});

describe('axis of pieces', () => {
  it('whole-number steps: 9 pcs → 0 / 5 / 10, 3 pcs → 0 / 1 / 2 / 3, 140 → 0 / 50 / 100 / 150', () => {
    expect(ticksOf(9, 4, INT_STEPS)).toEqual([0, 5, 10]);
    expect(ticksOf(3, 4, INT_STEPS)).toEqual([0, 1, 2, 3]);
    expect(ticksOf(140, 4, INT_STEPS)).toEqual([0, 50, 100, 150]);
  });
});
