/**
 * Control charts → "Model-wise summary": table rows (with achieved cycle and lid type) and the Excel workbook.
 * Achieved cycle = the whole second with the most valid cycles = the tallest bar of the model's 1-second histogram.
 */
import { achievedCycle } from './spc';
import { lidType, LID, LID_SOURCE } from './lid';
import { buildXlsx, downloadXlsx, colName, zebra } from './xlsxWriter';
import { dmy, dmyTime } from './stdReport';
import { weightInfo } from '../config/modelWeights';
/** Target cycle = achieved (Method A) second + this allowance, the same rule as Target methods A/B/C. */
const TARGET_ADD = 3;

/** Where a weight came from — same words as the Standard cycle time page. */
export const KG_FROM = { manual: 'manual', name: 'list', user: 'confirmed', code: 'from code', series: 'series' };

/** Key for a manual lid choice: per line, because the same MMId is a different model on another line. */
export const lidKey = (line, mmId) => `${line}:${mmId}`;

const r1 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

/**
 * overview = [{ a, u, cap, removed }] as built by ControlChartsPage; lidMap = { lidKey: type } chosen on the page;
 * kgMap = { mmId: kg } entered on the Standard cycle time page (wins over the master list).
 */
export function summaryRows(overview, lidMap = {}, line = '', kgMap = {}) {
  return (overview || []).map(({ a, u, cap, removed }, i) => {
    const m = a.m;
    const ln = m.line ?? line;
    const lid = lidType(m, lidMap?.[lidKey(ln, m.mmId)]);
    const ach = achievedCycle(a.vals);
    const w = weightInfo(m, kgMap?.[String(m.mmId)]);
    return {
      no: i + 1, mmId: m.mmId, model: m.model, code: m.modelCode || '', company: m.company || '', lineName: m.lineName || '', line: ln,
      lid: lid.type || 'unknown', lidSource: lid.source, lidItem: lid.item,
      kg: w.kg, kgFrom: w.source ? KG_FROM[w.source] : 'not set', kgItem: w.item,
      scans: a.scans, valid: a.vals.length, aboveMax: a.aboveMax, removed,
      mean: a.mu, median: a.med, sd: a.sd, cv: a.mu && a.sd != null ? (a.sd / a.mu) * 100 : null,
      achieved: ach ? ach.sec : null, achievedCount: ach ? ach.count : null, achievedShare: ach ? ach.share : null,
      achievedUpTo: ach ? ach.upTo : null, achievedUpToShare: ach ? ach.upToShare : null, achievedTarget: ach && ach.sec > 0 ? ach.sec + TARGET_ADD : null, achievedPph: ach && ach.sec > 0 ? 3600 / (ach.sec + TARGET_ADD) : null,
      winLo: a.win?.lo, winHi: a.win?.hi,
      limit: u ? u.v : null, limitSrc: u ? u.src : null, cpk: cap?.cpk ?? null, within: cap?.within ?? null, signals: a.chart ? a.chart.signals : null,
    };
  });
}

export const lidText = (t) => `${LID[t || 'unknown'].sym} ${LID[t || 'unknown'].xl}`;

/** [header, width, value(row), style] */
export const SUMMARY_COLUMNS = [
  ['#', 5, (r) => r.no, 'center'],
  ['Model', 24, (r) => r.model, 'textBold'],
  ['Model code', 12, (r) => r.code, 'center'],
  ['Line', 8, (r) => r.lineName || null, 'center', 'all'],
  ['Company', 14, (r) => r.company, 'text'],
  ['Lid', 13, (r) => lidText(r.lid), 'text'],
  ['Lid from', 11, (r) => (r.lidSource ? LID_SOURCE[r.lidSource] : '—'), 'center'],
  ['Weight (kg)', 8, (r) => r.kg ?? null, 'dec1'],
  ['Weight from', 10, (r) => r.kgFrom, 'center'],
  ['Scans', 9, (r) => r.scans, 'int'],
  ['Valid cycles', 9, (r) => r.valid, 'int'],
  ['Above max', 8, (r) => r.aboveMax, 'int'],
  ['Removed (%)', 8, (r) => r1(r.removed), 'dec1'],
  ['Achieved cycle (s)', 10, (r) => r.achieved, 'intA'],
  ['Pcs at achieved second', 9, (r) => r.achievedCount, 'int'],
  ['Pcs ≤ achieved', 9, (r) => r.achievedUpTo, 'int'],
  ['Share ≤ achieved (%)', 10, (r) => r1(r.achievedUpToShare), 'dec1'],
  ['Target cycle = achieved + 3 s (s)', 11, (r) => r.achievedTarget, 'intA'],
  ['Target (pcs/hr)', 9, (r) => r1(r.achievedPph), 'dec1'],
  ['Mean (s)', 8, (r) => r1(r.mean), 'valueA'],
  ['Median (s)', 8, (r) => r1(r.median), 'dec1'],
  ['Std dev (s)', 8, (r) => r1(r.sd), 'dec1'],
  ['CV (%)', 7, (r) => r1(r.cv), 'dec1'],
  ['Valid window (s)', 11, (r) => `${r1(r.winLo) ?? '—'} – ${Number.isFinite(r.winHi) ? r1(r.winHi) : '∞'}`, 'center'],
  ['Limit (s)', 8, (r) => r1(r.limit), 'dec1'],
  ['Limit from', 9, (r) => r.limitSrc || '—', 'center'],
  ['Cpk', 7, (r) => r2(r.cpk), 'dec1'],
  ['Within limit (%)', 9, (r) => r1(r.within), 'dec1'],
  ['Signals', 7, (r) => r.signals, 'int'],
];

const NOTES = [
  'Achieved cycle = the whole second with the most valid cycles (tallest bar of the model\'s 1-second histogram; second s holds gaps above s−1 up to s). Pcs at achieved second = valid cycles in that second. Pcs / share ≤ achieved = all valid cycles at the achieved second or faster. Target cycle = achieved + 3 s (same as Method A + 3 s); target pcs/hr = 3600 ÷ target cycle.',
  'Lid: from the master-list item name (FULL GLASS, HALF GLASS, FGL, HGL, (GL) …), otherwise from the model name (FG = full, HG = half, GL / TG = glass), or set on the page. "No glass" = the master-list item names no glass.',
  'Mean / median / std dev / CV use valid cycles only (inside the valid window). Cpk = (limit − mean) ÷ 3σ. Limit = manual standard, otherwise takt.',
];

export function summaryWorkbook(rows, meta) {
  const C = SUMMARY_COLUMNS.filter((c) => c[4] !== 'all' || meta.allLines);
  const W = C.length;
  const last = colName(W - 1);
  const title = 'Dixon Technologies — Model-wise Cycle Summary';
  const out = [[{ v: title, s: 'title' }], [{ v: `${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}`, s: 'subtitle' }]];
  const merges = [`A1:${last}1`, `A2:${last}2`];
  const metaRows = [
    ['Line', meta.lineLabel],
    ['Period', `${dmy(meta.start)} to ${dmy(meta.end)}`],
    ['Generated', dmyTime(meta.generatedAt)],
    ['Models', String(rows.length)],
    ['Valid cycle window', meta.windowText || '—'],
    ['Subgroups', meta.by || '—'],
    ['Lid symbols', ['full', 'half', 'glass', 'none', 'unknown'].map((k) => lidText(k)).join('   ')],
  ];
  for (const [l, v] of metaRows) {
    const r = out.length + 1;
    const row = [{ v: l, s: 'metaLabel' }, { v: null, s: 'metaLabel' }, { v, s: 'metaValue' }];
    for (let i = 3; i < W; i++) row.push({ v: null, s: 'metaValue' });
    out.push(row);
    merges.push(`A${r}:B${r}`, `C${r}:${last}${r}`);
  }
  out.push([]);
  const headerRow = out.length + 1;
  out.push(C.map(([h]) => ({ v: h, s: 'head' })));
  rows.forEach((r, i) => out.push(C.map(([, , get, st]) => ({ v: get(r), s: i % 2 ? zebra(st) : st }))));
  const lastData = out.length;
  // totals
  const idx = (h) => C.findIndex(([x]) => x === h);
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const valid = sum('valid');
  const meanAll = valid ? rows.reduce((s, r) => s + (r.mean || 0) * (r.valid || 0), 0) / valid : null;
  const tot = C.map((_, i) => ({ v: null, s: i < idx('Scans') ? 'totalLabel' : 'totalValue' }));
  tot[0] = { v: 'Total', s: 'totalLabel' };
  tot[1] = { v: `${rows.length} models`, s: 'totalLabel' };
  tot[idx('Scans')] = { v: sum('scans'), s: 'totalInt' };
  tot[idx('Valid cycles')] = { v: valid, s: 'totalInt' };
  tot[idx('Above max')] = { v: sum('aboveMax'), s: 'totalInt' };
  tot[idx('Mean (s)')] = { v: r1(meanAll), s: 'totalValue' };
  tot[idx('Signals')] = { v: sum('signals'), s: 'totalInt' };
  const withKg = rows.filter((r) => r.kg != null).length;
  tot[idx('Weight from')] = { v: `${withKg} of ${rows.length} set`, s: 'totalLabel' };
  out.push(tot);
  out.push([]);
  for (const n of NOTES) { const r = out.length + 1; out.push([{ v: n, s: 'note' }]); merges.push(`A${r}:${last}${r}`); }

  const sheet = {
    name: 'Model summary', cols: C.map(([, w]) => ({ width: w })), rows: out, merges,
    freezeRow: headerRow, headerRow, autoFilter: rows.length ? `A${headerRow}:${last}${lastData}` : null,
    rowHeights: { 1: 24, [headerRow]: 32 },
    footer: `&L&8Dixon Technologies · Model summary · ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}&C&8Generated ${dmyTime(meta.generatedAt)}&R&8Page &P of &N`,
  };
  const fileName = `ModelSummary_${String(meta.lineLabel).replace(/\s+/g, '')}_${meta.start}_to_${meta.end}.xlsx`;
  return { sheets: [sheet], fileName };
}

export function exportSummaryXlsx(rows, meta) {
  const { sheets, fileName } = summaryWorkbook(rows, meta);
  const bytes = buildXlsx(sheets);
  downloadXlsx(bytes, fileName);
  return bytes;
}
