/**
 * Model explorer: one row per model (per line) with pieces, P-Q class, glass type, weight and achieved cycle,
 * Excel-style multi-filters ("any of the selected" inside a filter, AND between filters), multi-column sorting,
 * group summaries and the formatted Excel workbook.
 *
 * Input models come from model_control.php: { mmId, model, modelCode, company, line, lineName, days: { date: { q, o, g, h } } }
 *   q = valid scans (pieces) of the day, g = gaps between consecutive scans of the model (seconds).
 */
import { mean, median, stdev, achievedCycle } from './spc';
import { lidType, LID } from './lid';
import { weightInfo } from '../config/modelWeights';
import { KG_FROM, lidKey } from './controlReport';
import { colName, zebra } from './xlsxWriter';
import { dmy, dmyTime } from './stdReport';

/* ───────────── bands ───────────── */
export const WEIGHT_BANDS = [
  ['lt20', '< 20 kg', 0, 20], ['20-30', '20–30 kg', 20, 30], ['30-40', '30–40 kg', 30, 40],
  ['40-50', '40–50 kg', 40, 50], ['ge50', '≥ 50 kg', 50, Infinity], ['unknown', 'Weight not set'],
];
export const ACH_BANDS = [
  ['le10', '≤ 10 s', 0, 10], ['11-15', '11–15 s', 10, 15], ['16-20', '16–20 s', 15, 20],
  ['21-30', '21–30 s', 20, 30], ['gt30', '> 30 s', 30, Infinity], ['none', 'No valid cycles'],
];
export const CLASSES = ['A', 'B', 'C'];
export const CLASS_LABEL = { A: 'A — main runners (first 80 %)', B: 'B — regular (80–95 %)', C: 'C — small share (last 5 %)' };
export const LID_ORDER = ['full', 'half', 'glass', 'none', 'unknown'];

export function weightBand(kg) {
  if (kg == null || !Number.isFinite(Number(kg))) return 'unknown';
  const v = Number(kg);
  const b = WEIGHT_BANDS.find(([, , lo, hi]) => hi !== undefined && v >= lo && v < hi);
  return b ? b[0] : 'unknown';
}
export function achievedBand(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return 'none';
  const v = Number(sec);
  const b = ACH_BANDS.find(([, , lo, hi]) => hi !== undefined && v > lo && v <= hi) || (v <= 10 ? ACH_BANDS[0] : null);
  return b ? b[0] : 'none';
}
const bandLabel = (list, k) => (list.find(([x]) => x === k) || [k, k])[1];

/* ───────────── rows ───────────── */
/**
 * win = { min, max } valid cycle window (seconds); lidMap = { 'line:mmId': type } chosen on the Control charts page;
 * kgMap = { mmId: kg } typed on the Standard cycle time page (pass {} for all lines: the same MMId is another model on another line).
 */
export function buildExplorerRows(models, { win = { min: 1, max: 22 }, lidMap = {}, kgMap = {} } = {}) {
  const lo = Number(win.min) || 0, hi = Number(win.max) > 0 ? Number(win.max) : Infinity;
  return (models || []).map((m) => {
    let pcs = 0, days = 0;
    const vals = [];
    for (const d of Object.values(m.days || {})) {
      const q = Number(d.q) || 0;
      pcs += q; if (q > 0) days++;
      for (const g of d.g || []) if (g >= lo && g <= hi) vals.push(g);
    }
    const line = m.line != null ? String(m.line) : '';
    const lid = lidType(m, lidMap?.[lidKey(line, m.mmId)]);
    const w = weightInfo(m, kgMap?.[String(m.mmId)]);
    const ach = achievedCycle(vals);
    const mu = mean(vals), sd = stdev(vals);
    const kg = w.kg ?? null;
    return {
      key: `${line}:${m.mmId}`, mmId: m.mmId, model: m.model || '', code: m.modelCode || '', company: m.company || '—',
      line, lineName: m.lineName || (line ? `Line ${line}` : ''),
      pcs, days, valid: vals.length, mean: mu, median: median(vals), cv: mu && sd != null ? (sd / mu) * 100 : null,
      // share / pieces covered = valid cycles at the achieved second or faster; target from achieved = 3600 ÷ achieved
      achieved: ach ? ach.sec : null, achievedShare: ach ? ach.upToShare : null, achievedQty: ach ? ach.upTo : null,
      achievedPph: ach?.targetPph ?? null,
      lid: lid.type || 'unknown', lidSource: lid.source || null,
      kg, kgFrom: w.source ? KG_FROM[w.source] : 'not set', weightT: kg != null ? (pcs * kg) / 1000 : null,
      weightBand: weightBand(kg), achBand: achievedBand(ach ? ach.sec : null),
      share: 0, cumPct: 0, rank: 0, cls: 'C',
    };
  });
}

/** P-Q (ABC) class over the given rows — same rule as Model analysis: by the cumulative share BEFORE the model. */
export function assignPqClass(rows) {
  const order = [...rows].sort((a, b) => b.pcs - a.pcs || a.model.localeCompare(b.model));
  const total = order.reduce((s, r) => s + r.pcs, 0);
  const info = new Map();
  let cum = 0;
  order.forEach((r, i) => {
    const before = total ? (cum / total) * 100 : 0;
    cum += r.pcs;
    info.set(r.key, { rank: i + 1, share: total ? (r.pcs / total) * 100 : 0, cumPct: total ? (cum / total) * 100 : 0, cls: before < 80 ? 'A' : before < 95 ? 'B' : 'C' });
  });
  return rows.map((r) => ({ ...r, ...info.get(r.key) }));
}

/* ───────────── filters ───────────── */
export const EMPTY_FILTERS = {
  lines: [], companies: [], classes: [], lids: [], weightBands: [], achBands: [],
  q: '', minPcs: '', kgMin: '', kgMax: '', achMin: '', achMax: '',
};
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const inList = (list, v) => !list || !list.length || list.map(String).includes(String(v));

export function filterRows(rows, f = EMPTY_FILTERS) {
  const q = String(f.q || '').trim().toLowerCase();
  const minPcs = num(f.minPcs), kgMin = num(f.kgMin), kgMax = num(f.kgMax), achMin = num(f.achMin), achMax = num(f.achMax);
  return rows.filter((r) =>
    inList(f.lines, r.line) && inList(f.companies, r.company) && inList(f.classes, r.cls) && inList(f.lids, r.lid)
    && inList(f.weightBands, r.weightBand) && inList(f.achBands, r.achBand)
    && (!q || `${r.model} ${r.code} ${r.company} ${r.lineName}`.toLowerCase().includes(q))
    && (minPcs == null || r.pcs >= minPcs)
    && ((kgMin == null && kgMax == null) || (r.kg != null && (kgMin == null || r.kg >= kgMin) && (kgMax == null || r.kg <= kgMax)))
    && ((achMin == null && achMax == null) || (r.achieved != null && (achMin == null || r.achieved >= achMin) && (achMax == null || r.achieved <= achMax))));
}

export const filterCount = (f) => ['lines', 'companies', 'classes', 'lids', 'weightBands', 'achBands'].filter((k) => f[k]?.length).length
  + ['q', 'minPcs'].filter((k) => String(f[k] || '').trim()).length
  + ((num(f.kgMin) != null || num(f.kgMax) != null) ? 1 : 0) + ((num(f.achMin) != null || num(f.achMax) != null) ? 1 : 0);

/* ───────────── sorting ───────────── */
const TEXT_KEYS = new Set(['model', 'code', 'company', 'lineName', 'line', 'cls', 'lid', 'kgFrom', 'weightBand', 'achBand']);

/** Multi-column sort; empty values always last; stable. */
export function sortRows(rows, sorts = []) {
  if (!sorts.length) return rows;
  return rows.map((r, i) => [r, i]).sort(([a, ia], [b, ib]) => {
    for (const { key, dir } of sorts) {
      const x = a[key], y = b[key];
      const xe = x == null || x === '' || (typeof x === 'number' && Number.isNaN(x));
      const ye = y == null || y === '' || (typeof y === 'number' && Number.isNaN(y));
      if (xe || ye) { if (xe && ye) continue; return xe ? 1 : -1; }
      let c = TEXT_KEYS.has(key) || typeof x === 'string' ? String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) : x - y;
      if (dir === 'desc') c = -c;
      if (c) return c;
    }
    return ia - ib;
  }).map(([r]) => r);
}

/** Header click: sort by that column (numbers start descending, text ascending); again = reverse; shift = add a level. */
export function toggleSort(sorts, key, add, type) {
  const first = type === 'number' ? 'desc' : 'asc';
  const flip = (d) => (d === 'desc' ? 'asc' : 'desc');
  const cur = sorts.find((s) => s.key === key);
  if (!add) return [{ key, dir: cur ? flip(cur.dir) : first }];
  if (cur) return sorts.map((s) => (s.key === key ? { key, dir: flip(s.dir) } : s));
  return [...sorts, { key, dir: first }];
}

/* ───────────── groups, KPIs, options ───────────── */
export const GROUPS = {
  company: { label: 'Company', title: 'By company' },
  line: { label: 'Line', title: 'By line' },
  cls: { label: 'P-Q class', title: 'By P-Q class' },
  lid: { label: 'Glass', title: 'By glass' },
  weightBand: { label: 'Weight', title: 'By weight' },
  achBand: { label: 'Achieved cycle', title: 'By achieved cycle' },
};

export function groupLabel(key, value) {
  if (key === 'line') return value ? `Line ${value}` : '—';
  if (key === 'cls') return CLASS_LABEL[value] || value;
  if (key === 'lid') return (LID[value] || LID.unknown).label.replace(' — set it on the page', '');
  if (key === 'weightBand') return bandLabel(WEIGHT_BANDS, value);
  if (key === 'achBand') return bandLabel(ACH_BANDS, value);
  return value;
}

function groupOrder(key) {
  if (key === 'cls') return CLASSES;
  if (key === 'lid') return LID_ORDER;
  if (key === 'weightBand') return WEIGHT_BANDS.map(([k]) => k);
  if (key === 'achBand') return ACH_BANDS.map(([k]) => k);
  return null;
}

export function groupRows(rows, key) {
  const total = rows.reduce((s, r) => s + r.pcs, 0);
  const map = new Map();
  for (const r of rows) {
    const v = String(r[key] ?? '');
    const g = map.get(v) || { value: v, label: groupLabel(key, v), models: 0, pcs: 0, valid: 0, s1: 0, weightT: 0, kgKnown: 0 };
    g.models++; g.pcs += r.pcs; g.valid += r.valid; g.s1 += (r.mean || 0) * r.valid;
    if (r.weightT != null) { g.weightT += r.weightT; g.kgKnown++; }
    map.set(v, g);
  }
  const out = [...map.values()].map(({ s1, ...g }) => ({ ...g, share: total ? (g.pcs / total) * 100 : 0, mean: g.valid ? s1 / g.valid : null }));
  const order = groupOrder(key);
  if (order) return out.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
  if (key === 'line') return out.sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
  return out.sort((a, b) => b.pcs - a.pcs || a.value.localeCompare(b.value));
}

export function optionCounts(rows, key) {
  return groupRows(rows, key).map((g) => ({ value: g.value, label: g.label, count: g.models, pcs: g.pcs }));
}

export function explorerKpis(rows, all) {
  const pcs = rows.reduce((s, r) => s + r.pcs, 0), allPcs = all.reduce((s, r) => s + r.pcs, 0);
  const valid = rows.reduce((s, r) => s + r.valid, 0);
  const achRows = rows.filter((r) => r.achieved != null);
  const achPcs = achRows.reduce((s, r) => s + r.pcs, 0);
  return {
    models: rows.length, allModels: all.length, pcs, allPcs, sharePct: allPcs ? (pcs / allPcs) * 100 : 0,
    companies: new Set(rows.map((r) => r.company)).size, lines: new Set(rows.map((r) => r.line)).size,
    valid, mean: valid ? rows.reduce((s, r) => s + (r.mean || 0) * r.valid, 0) / valid : null,
    achievedAvg: achPcs ? achRows.reduce((s, r) => s + r.achieved * r.pcs, 0) / achPcs : null,
    weightT: rows.reduce((s, r) => s + (r.weightT || 0), 0), kgKnown: rows.filter((r) => r.kg != null).length,
    classes: Object.fromEntries(CLASSES.map((c) => [c, rows.filter((r) => r.cls === c).length])),
  };
}

/* ───────────── text of the filters in use ───────────── */
const range = (lo, hi, unit) => (lo != null && hi != null ? `${lo}–${hi} ${unit}` : lo != null ? `≥ ${lo} ${unit}` : `≤ ${hi} ${unit}`);
export function activeFilterText(f = EMPTY_FILTERS) {
  const o = [];
  if (f.lines?.length) o.push(`Line: ${f.lines.join(', ')}`);
  if (f.companies?.length) o.push(`Company: ${f.companies.join(', ')}`);
  if (f.classes?.length) o.push(`P-Q class: ${f.classes.join(', ')}`);
  if (f.lids?.length) o.push(`Glass: ${f.lids.map((k) => groupLabel('lid', k)).join(', ')}`);
  if (f.weightBands?.length) o.push(`Weight: ${f.weightBands.map((k) => bandLabel(WEIGHT_BANDS, k)).join(', ')}`);
  if (f.achBands?.length) o.push(`Achieved cycle: ${f.achBands.map((k) => bandLabel(ACH_BANDS, k)).join(', ')}`);
  const kgMin = num(f.kgMin), kgMax = num(f.kgMax), achMin = num(f.achMin), achMax = num(f.achMax);
  if (kgMin != null || kgMax != null) o.push(`Weight ${range(kgMin, kgMax, 'kg')}`);
  if (achMin != null || achMax != null) o.push(`Achieved cycle ${range(achMin, achMax, 's')}`);
  if (String(f.q || '').trim()) o.push(`Search: "${String(f.q).trim()}"`);
  if (num(f.minPcs) != null) o.push(`At least ${num(f.minPcs)} pieces`);
  return o;
}

/* ───────────── Excel ───────────── */
const r1 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const lidXl = (t) => `${(LID[t] || LID.unknown).sym} ${(LID[t] || LID.unknown).xl}`;

export const EXPLORER_COLUMNS = [
  // [header, width, value(row), style, sortKey, only for all lines]
  ['#', 5, (r) => r.no, 'center'],
  ['Line', 8, (r) => r.lineName, 'center', 'line', true],
  ['Company', 14, (r) => r.company, 'text', 'company'],
  ['Model', 24, (r) => r.model, 'textBold', 'model'],
  ['Model code', 12, (r) => r.code, 'center', 'code'],
  ['P-Q class', 7, (r) => r.cls, 'center', 'cls'],
  ['Qty', 10, (r) => r.pcs, 'int', 'pcs'],
  ['Share (%)', 8, (r) => r1(r.share), 'dec1', 'share'],
  ['Cumulative (%)', 10, (r) => r1(r.cumPct), 'dec1', 'cumPct'],
  ['Days made', 7, (r) => r.days, 'int', 'days'],
  ['Glass', 12, (r) => lidXl(r.lid), 'text', 'lid'],
  ['Weight (kg)', 8, (r) => r.kg ?? null, 'dec1', 'kg'],
  ['Weight from', 10, (r) => r.kgFrom, 'center', 'kgFrom'],
  ['Weight shipped (t)', 10, (r) => r2(r.weightT), 'dec1', 'weightT'],
  ['Valid cycles', 9, (r) => r.valid, 'int', 'valid'],
  ['Achieved cycle (s)', 10, (r) => r.achieved, 'intA', 'achieved'],
  ['Pcs ≤ achieved', 10, (r) => r.achievedQty, 'int', 'achievedQty'],
  ['Share ≤ achieved (%)', 10, (r) => r1(r.achievedShare), 'dec1', 'achievedShare'],
  ['Target from achieved (pcs/hr)', 12, (r) => r1(r.achievedPph), 'dec1', 'achievedPph'],
  ['Mean cycle (s)', 9, (r) => r1(r.mean), 'valueA', 'mean'],
  ['Median (s)', 8, (r) => r1(r.median), 'dec1', 'median'],
  ['CV (%)', 7, (r) => r1(r.cv), 'dec1', 'cv'],
];
const SORT_NAME = Object.fromEntries(EXPLORER_COLUMNS.filter((c) => c[4]).map((c) => [c[4], c[0]]));

function headerBlock(title, meta, rowsShown, all, f, W) {
  const last = colName(W - 1);
  const out = [[{ v: title, s: 'title' }], [{ v: `${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}`, s: 'subtitle' }]];
  const merges = [`A1:${last}1`, `A2:${last}2`];
  const pcs = rowsShown.reduce((s, r) => s + r.pcs, 0), allPcs = all.reduce((s, r) => s + r.pcs, 0);
  const filters = activeFilterText(f);
  const meta2 = [
    ['Line', meta.lineLabel],
    ['Period', `${dmy(meta.start)} to ${dmy(meta.end)}`],
    ['Generated', dmyTime(meta.generatedAt)],
    ['Filters', filters.length ? filters.join(' · ') : 'none (all models)'],
    ['Models shown', `${rowsShown.length} of ${all.length}`],
    ['Pieces shown', `${pcs.toLocaleString('en-IN')} of ${allPcs.toLocaleString('en-IN')} (${allPcs ? r1((pcs / allPcs) * 100) : 0} %)`],
  ];
  if (meta.sort?.length) meta2.push(['Sorted by', meta.sort.map((s) => `${SORT_NAME[s.key] || s.key} ${s.dir === 'desc' ? '↓' : '↑'}`).join(', then ')]);
  for (const [l, v] of meta2) {
    const r = out.length + 1;
    const row = [{ v: l, s: 'metaLabel' }, { v: null, s: 'metaLabel' }, { v, s: 'metaValue' }];
    for (let i = 3; i < W; i++) row.push({ v: null, s: 'metaValue' });
    out.push(row);
    merges.push(`A${r}:B${r}`, `C${r}:${last}${r}`);
  }
  out.push([]);
  return { out, merges, last };
}

function footer(name, meta) {
  return `&L&8Dixon Technologies · ${name} · ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}&C&8Generated ${dmyTime(meta.generatedAt)}&R&8Page &P of &N`;
}

function modelsSheet(rows, all, f, meta) {
  const C = EXPLORER_COLUMNS.filter((c) => !c[5] || meta.allLines);
  const W = C.length;
  const { out, merges, last } = headerBlock('Dixon Technologies — Model explorer', meta, rows, all, f, W);
  const headerRow = out.length + 1;
  out.push(C.map(([h]) => ({ v: h, s: 'head' })));
  rows.forEach((r, i) => out.push(C.map(([, , get, st]) => ({ v: get({ ...r, no: i + 1 }), s: i % 2 ? zebra(st) : st }))));
  const lastData = out.length;
  const idx = (h) => C.findIndex(([x]) => x === h);
  const pcs = rows.reduce((s, r) => s + r.pcs, 0), valid = rows.reduce((s, r) => s + r.valid, 0);
  const tot = C.map((_, i) => ({ v: null, s: i < idx('Qty') ? 'totalLabel' : 'totalValue' }));
  tot[0] = { v: 'Total', s: 'totalLabel' };
  tot[idx('Model')] = { v: `${rows.length} models`, s: 'totalLabel' };
  tot[idx('Qty')] = { v: pcs, s: 'totalInt' };
  tot[idx('Share (%)')] = { v: r1(rows.reduce((s, r) => s + r.share, 0)), s: 'totalValue' };
  tot[idx('Weight shipped (t)')] = { v: r2(rows.reduce((s, r) => s + (r.weightT || 0), 0)), s: 'totalValue' };
  tot[idx('Weight from')] = { v: `${rows.filter((r) => r.kg != null).length} of ${rows.length} set`, s: 'totalLabel' };
  tot[idx('Valid cycles')] = { v: valid, s: 'totalInt' };
  tot[idx('Mean cycle (s)')] = { v: r1(valid ? rows.reduce((s, r) => s + (r.mean || 0) * r.valid, 0) / valid : null), s: 'totalValue' };
  out.push(tot);
  out.push([]);
  const notes = [
    'P-Q class: models sorted by pieces over ALL models of the period — A = first 80 % of the pieces, B = up to 95 %, C = the rest (same rule as Model analysis). Share and cumulative are of all models.',
    'Achieved cycle = the whole second with the most valid cycles (tallest bar of the model\'s 1-second histogram). Mean / median / CV use valid cycles only.',
    'Glass: from the master-list item, the model name, or the choice on the Control charts page. Weight: master list or the value typed on the Standard cycle time page. Weight shipped = pieces × kg ÷ 1000.',
  ];
  for (const n of notes) { const r = out.length + 1; out.push([{ v: n, s: 'note' }]); merges.push(`A${r}:${last}${r}`); }
  return {
    name: 'Models', cols: C.map(([, w]) => ({ width: w })), rows: out, merges,
    freezeRow: headerRow, headerRow, autoFilter: rows.length ? `A${headerRow}:${last}${lastData}` : null,
    rowHeights: { 1: 24, [headerRow]: 32 }, footer: footer('Model explorer', meta),
  };
}

function groupSheet(key, rows, all, f, meta) {
  const g = groupRows(rows, key);
  const C = [
    [GROUPS[key].label, key === 'cls' ? 30 : 24, (x) => x.label, 'textBold'],
    ['Models', 8, (x) => x.models, 'int'],
    ['Qty', 11, (x) => x.pcs, 'int'],
    ['Share (%)', 9, (x) => r1(x.share), 'dec1'],
    ['Valid cycles', 10, (x) => x.valid, 'int'],
    ['Mean cycle (s)', 10, (x) => r1(x.mean), 'valueA'],
    ['Weight shipped (t)', 11, (x) => r2(x.weightT), 'dec1'],
    ['Models with weight', 10, (x) => x.kgKnown, 'int'],
  ];
  const W = C.length;
  const { out, merges, last } = headerBlock(`Dixon Technologies — Model explorer · ${GROUPS[key].title}`, meta, rows, all, f, W);
  const headerRow = out.length + 1;
  out.push(C.map(([h]) => ({ v: h, s: 'head' })));
  g.forEach((x, i) => out.push(C.map(([, , get, st]) => ({ v: get(x), s: i % 2 ? zebra(st) : st }))));
  const lastData = out.length;
  const pcs = g.reduce((s, x) => s + x.pcs, 0), valid = g.reduce((s, x) => s + x.valid, 0);
  out.push([
    { v: 'Total', s: 'totalLabel' }, { v: g.reduce((s, x) => s + x.models, 0), s: 'totalInt' }, { v: pcs, s: 'totalInt' },
    { v: pcs ? 100 : null, s: 'totalValue' }, { v: valid, s: 'totalInt' },
    { v: r1(valid ? g.reduce((s, x) => s + (x.mean || 0) * x.valid, 0) / valid : null), s: 'totalValue' },
    { v: r2(g.reduce((s, x) => s + x.weightT, 0)), s: 'totalValue' }, { v: g.reduce((s, x) => s + x.kgKnown, 0), s: 'totalInt' },
  ]);
  return {
    name: GROUPS[key].title, cols: C.map(([, w]) => ({ width: w })), rows: out, merges,
    freezeRow: headerRow, headerRow, autoFilter: g.length ? `A${headerRow}:${last}${lastData}` : null,
    rowHeights: { 1: 24, [headerRow]: 30 }, footer: footer(GROUPS[key].title, meta),
  };
}

/** rows = filtered and sorted rows; all = every row of the period (for "x of y"); f = filters; meta = { lineLabel, start, end, generatedAt, allLines, sort } */
export function explorerWorkbook(rows, all, f, meta) {
  const keys = ['company', ...(meta.allLines ? ['line'] : []), 'cls', 'lid', 'weightBand', 'achBand'];
  const sheets = [modelsSheet(rows, all, f, meta), ...keys.map((k) => groupSheet(k, rows, all, f, meta))];
  const fileName = `ModelExplorer_${String(meta.lineLabel).replace(/\s+/g, '')}_${meta.start}_to_${meta.end}.xlsx`;
  return { sheets, fileName };
}
