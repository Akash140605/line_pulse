import { achievedCycle } from './spc';
/**
 * Model-wise P-Q (product–quantity) analysis for the selected period, plus the Excel download
 * and printed report. Pure functions (no React) so the numbers can be unit-tested.
 *
 *   share      = model qty ÷ total qty × 100
 *   cumulative = running share after sorting by qty (largest first)
 *   class      = A while the running share BEFORE the model is < 80 %, B while < 95 %, C after that
 *   pcs/hr     = qty ÷ active hours (hours in which the model had at least one scan)
 *   avg cycle  = mean of the valid scan gaps of the model (outlier gaps excluded), whole period
 *   vs takt    = (avg cycle ÷ takt − 1) × 100   (+ = slower than takt)
 *   health     = judged against THIS line in the same period (scan-gap CV and rejections differ a lot between
 *                lines, so fixed limits would mark every model red):
 *                Attention: vs takt > +10 %, or CV ≥ 1.5 × line CV (min 30 %, ≥ 30 cycles),
 *                           or rej % ≥ 1.5 × line rej % (min 2 %, ≥ 5 rejected)
 *                Watch:     vs takt > 0 %,  or CV ≥ 1.2 × line CV (min 15 %, ≥ 30 cycles),
 *                           or rej % ≥ 1.2 × line rej % (min 1 %, ≥ 3 rejected)
 */
import { buildXlsx, downloadXlsx, colName, zebra } from './xlsxWriter';
import { weightInfo } from '../config/modelWeights';
import { dmy, dmyTime } from './stdReport';

const r1 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const n0 = (v) => Number(v || 0).toLocaleString('en-IN');
const s1 = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} s`);

const taktOf = (t, id) => (Number(t?.models?.[id]) > 0 ? Number(t.models[id]) : Number(t?.taktSec) > 0 ? Number(t.taktSec) : null);

export const HEALTH_LABEL = { ok: 'Healthy', watch: 'Watch', behind: 'Attention', idle: 'No cycles' };
/** Spread of the gaps compared with the whole line in the same period. */
export function stabilityText(cv, lineCv) {
  if (cv == null) return 'stability unknown';
  if (!(lineCv > 0)) return cv < 15 ? `stable (CV ${cv}%)` : cv < 30 ? `some variation (CV ${cv}%)` : `unstable (CV ${cv}%)`;
  const k = cv / lineCv;
  const tail = `(CV ${cv}%, line ${lineCv}%)`;
  if (k >= 1.5) return `much more variable than the line ${tail}`;
  if (k >= 1.2) return `more variable than the line ${tail}`;
  if (k <= 0.8) return `steadier than the line ${tail}`;
  return `spread like the line ${tail}`;
}

/** Health of one model against the line references { lineCv, lineRej }. */
export function healthOf(r, ref = {}) {
  if (!r.n) return 'idle';
  const lineCv = ref.lineCv > 0 ? ref.lineCv : 20;
  const lineRej = ref.lineRej > 0 ? ref.lineRej : 1;
  const enoughCycles = r.n >= 30;
  const cvBad = enoughCycles && r.cv != null && r.cv >= Math.max(30, lineCv * 1.5);
  const cvWatch = enoughCycles && r.cv != null && r.cv >= Math.max(15, lineCv * 1.2);
  const rejBad = r.rejQty >= 5 && r.rejRate >= Math.max(2, lineRej * 1.5);
  const rejWatch = r.rejQty >= 3 && r.rejRate >= Math.max(1, lineRej * 1.2);
  if ((r.vsTakt != null && r.vsTakt > 10) || cvBad || rejBad) return 'behind';
  if ((r.vsTakt != null && r.vsTakt > 0) || cvWatch || rejWatch) return 'watch';
  return 'ok';
}

/** One plain-language line that explains the model's numbers. */
export function explainModel(r, totalDays, ref = {}) {
  const parts = [];
  const cls = r.cls === 'A' ? 'A-class (main runner)' : r.cls === 'B' ? 'B-class (regular)' : 'C-class (small share)';
  parts.push(`${cls}, rank ${r.rank}: ${n0(r.qty)} pcs = ${r.share.toFixed(1)}% of the period's output.`);
  parts.push(`Made on ${r.days} of ${totalDays} day${totalDays === 1 ? '' : 's'}${r.activeHours ? ` (${r.activeHours} h, ${r.perHr.toFixed(1)} pcs/h)` : ''}${r.peakDate ? `; best day ${dmy(r.peakDate)} with ${n0(r.peakQty)} pcs` : ''}.`);
  if (r.mean != null) {
    let c = `Avg cycle ${s1(r.mean)} (median ${s1(r.median)}, range ${s1(r.min)} – ${s1(r.max)})`;
    if (r.takt) c += r.vsTakt > 0.05 ? `, ${r.vsTakt.toFixed(1)}% slower than takt ${s1(r.takt)}` : r.vsTakt < -0.05 ? `, ${Math.abs(r.vsTakt).toFixed(1)}% faster than takt ${s1(r.takt)}` : `, equal to takt ${s1(r.takt)}`;
    parts.push(`${c}; ${stabilityText(r.cv, ref.lineCv)}.`);
  } else {
    parts.push('No valid cycle in the window, so only the quantity is counted.');
  }
  if (r.rejQty) parts.push(`${n0(r.rejQty)} rejected (${r.rejRate}%${ref.lineRej != null ? `, line ${Number(ref.lineRej).toFixed(1)}%` : ''}).`);
  if (r.stopMin >= 1) parts.push(`${r.stopMin >= 120 ? `${(r.stopMin / 60).toFixed(1)} h` : `${Math.round(r.stopMin)} min`} lost in long gaps.`);
  if (r.isLowVolume) parts.push('Low volume: cycle figures are indicative only.');
  return parts.join(' ');
}

/**
 * Rows for every model of the analytics payload, sorted by qty (largest first).
 * meta: list from models.php ({ mmId, companyTitle, ... }); kgOverride: { [mmId]: kg } (optional).
 */
export function buildModelRows(a, takt, meta = [], kgOverride = {}) {
  if (!a?.models) return { rows: [], totals: null };
  const company = Object.fromEntries((meta || []).map((m) => [m.mmId, m.companyTitle || '']));
  const rej = Object.fromEntries((a.rejection?.models || []).map((m) => [m.mmId, m]));
  const dates = (a.daily || []).map((d) => d.date);
  const totalDays = dates.length;
  const sorted = [...a.models].sort((x, y) => y.qty - x.qty || String(x.model).localeCompare(String(y.model)));
  const total = sorted.reduce((s, m) => s + (m.qty || 0), 0);
  let cum = 0;
  const rows = sorted.map((m, i) => {
    const before = total ? (cum / total) * 100 : 0;
    cum += m.qty || 0;
    const byDay = a.modelDay?.[m.mmId] || {};
    const trend = dates.map((d) => Number(byDay[d] || 0));
    let peakDate = null, peakQty = 0;
    dates.forEach((d, k) => { if (trend[k] > peakQty) { peakQty = trend[k]; peakDate = d; } });
    const t = taktOf(takt, m.mmId);
    const ratio = t && m.mean != null ? m.mean / t : null;
    const rejQty = rej[m.mmId]?.qty ?? 0;
    const rejRate = rej[m.mmId]?.rate ?? 0;
    const w = weightInfo(m, kgOverride?.[m.mmId]);
    const row = {
      ...m,
      rank: i + 1,
      company: company[m.mmId] || '',
      share: total ? (m.qty / total) * 100 : 0,
      cumPct: total ? (cum / total) * 100 : 0,
      cls: before < 80 ? 'A' : before < 95 ? 'B' : 'C',
      days: trend.filter((v) => v > 0).length,
      trend, peakDate, peakQty,
      perHr: m.activeHours ? m.qty / m.activeHours : 0,
      takt: t, ratio, vsTakt: ratio != null ? (ratio - 1) * 100 : null,
      rejQty, rejRate,
      stopMin: (m.stoppageSec || 0) / 60,
      kg: w.kg, totalKg: w.kg != null ? w.kg * m.qty : null,
    };
    return row;
  });
  const withCycle = rows.filter((r) => r.n > 0 && r.mean != null);
  const nSum = withCycle.reduce((s, r) => s + r.n, 0);
  const kgKnown = rows.filter((r) => r.totalKg != null);
  const totals = {
    qty: total,
    models: rows.length,
    clsCount: { A: rows.filter((r) => r.cls === 'A').length, B: rows.filter((r) => r.cls === 'B').length, C: rows.filter((r) => r.cls === 'C').length },
    days: totalDays,
    activeDays: (a.daily || []).filter((d) => d.qty > 0).length,
    // all valid cycles of the period together (same as the overall figure of the analytics API)
    avgCycle: a.overall?.mean ?? (nSum ? withCycle.reduce((s, r) => s + r.mean * r.n, 0) / nSum : null),
    medianCycle: a.overall?.median ?? null,
    p90Cycle: a.overall?.p90 ?? null,
    cv: a.overall?.cv ?? null,
    validCycles: a.overall?.n ?? nSum,
    rejQty: rows.reduce((s, r) => s + r.rejQty, 0),
    stopMin: (a.overall?.stoppageSec ?? rows.reduce((s, r) => s + (r.stoppageSec || 0), 0)) / 60,
    totalKg: kgKnown.reduce((s, r) => s + r.totalKg, 0),
    kgCoverage: total ? kgKnown.reduce((s, r) => s + r.qty, 0) / total * 100 : 0,
    perDay: totalDays ? total / Math.max(1, (a.daily || []).filter((d) => d.qty > 0).length) : 0,
  };
  totals.rejRate = totals.qty + totals.rejQty ? (totals.rejQty / (totals.qty + totals.rejQty)) * 100 : 0;
  totals.lineCv = a.overall?.cv ?? null;
  const ref = { lineCv: totals.lineCv, lineRej: totals.rejRate };
  for (const r of rows) {
    r.health = healthOf(r, ref);
    r.explain = explainModel(r, totalDays, ref);
  }
  return { rows, totals };
}

/** Daily production split by model: the top `top` models get their own series, the rest go to "Others". */
export function dailyByModel(a, rows, top = 6) {
  const heads = rows.slice(0, top);
  const restIds = rows.slice(top).map((r) => r.mmId);
  return (a?.daily || []).map((d) => {
    const o = { date: d.date, total: d.qty, mean: d.mean ?? null, median: d.median ?? null, p90: d.p90 ?? null };
    for (const h of heads) o[`m${h.mmId}`] = Number(a.modelDay?.[h.mmId]?.[d.date] || 0);
    o.others = restIds.reduce((s, id) => s + Number(a.modelDay?.[id]?.[d.date] || 0), 0);
    return o;
  });
}

/**
 * Achieved cycle per model from the raw gaps of model_control.php (days[d].g).
 * Valid cycles = the dashboard's default outlier rule: gap ≥ min and ≤ min(max, mult × the model's median gap).
 * → { [mmId]: { ach (s), achQty (valid cycles ≤ achieved), achShare %, achPph (3600 ÷ achieved), valid } }
 */
export function achievedByModel(models, { min = 1, max = 300, mult = 3 } = {}) {
  const out = {};
  for (const m of models || []) {
    const gaps = [];
    for (const d of Object.values(m.days || {})) for (const g of d.g || []) if (g >= min) gaps.push(g);
    if (!gaps.length) continue;
    const sorted = [...gaps].sort((a, b) => a - b);
    const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const hi = Math.min(max, mult * med);
    const ach = achievedCycle(gaps.filter((g) => g <= hi));
    if (ach) out[String(m.mmId)] = { ach: ach.sec, achQty: ach.upTo, achShare: ach.upToShare, achPph: ach.targetPph, valid: ach.upTo / (ach.upToShare / 100) };
  }
  return out;
}

// ─────────────────────────────── Excel ───────────────────────────────

/** [header, width, value(row), style, print class] */
export const MODEL_COLUMNS = [
  ['#', 5, (r) => r.rank, 'center', 'c'],
  ['Model', 22, (r) => r.model, 'textBold', 'b'],
  ['Model code', 11, (r) => r.modelCode || '', 'center', 'c'],
  ['Company', 14, (r) => r.company, 'text', ''],
  ['Class', 6, (r) => r.cls, 'center', 'c'],
  ['Qty (pcs)', 10, (r) => r.qty, 'int', 'n'],
  ['Qty after >22 s eliminated', 12, (r) => r.aValid ?? null, 'int', 'n'],
  ['Share (%)', 8, (r) => r1(r.share), 'dec1', 'n'],
  ['Cumulative (%)', 10, (r) => r1(r.cumPct), 'dec1', 'n'],
  ['Days made', 7, (r) => r.days, 'int', 'n'],
  ['Active hours', 8, (r) => r.activeHours ?? 0, 'int', 'n'],
  ['Pcs / hr', 8, (r) => r1(r.perHr), 'dec1', 'n'],
  ['Avg cycle (s)', 9, (r) => r1(r.mean), 'valueA', 'n a'],
  ['Median (s)', 8, (r) => r1(r.median), 'dec1', 'n'],
  ['Method A cycle (s)', 9, (r) => r.ach ?? null, 'intA', 'n a'],
  ['Target cycle A+3 (s)', 10, (r) => r.aTarget ?? null, 'intA', 'n a'],
  ['Pcs ≤ A', 9, (r) => r.achQty ?? null, 'int', 'n'],
  ['Share ≤ A (%)', 9, (r) => r1(r.achShare), 'dec1', 'n'],
  ['Target A+3 s (pcs/hr)', 10, (r) => r1(r.achPph), 'dec1', 'n'],
  ['Method B cycle (s)', 9, (r) => r.bSec ?? null, 'intA', 'n a'],
  ['B valid scans (1–22 s)', 10, (r) => r.bValid ?? null, 'int', 'n'],
  ['Pcs ≤ B', 9, (r) => r.bQty ?? null, 'int', 'n'],
  ['Target B (pcs/hr)', 10, (r) => r1(r.bPph), 'dec1', 'n'],
  ['Method C cycle (s)', 9, (r) => r1(r.cSec), 'dec1', 'n a'],
  ['C valid scans (1–22 s)', 10, (r) => r.cValid ?? null, 'int', 'n'],
  ['Pcs ≤ C', 9, (r) => r.cQty ?? null, 'int', 'n'],
  ['Target C (pcs/hr)', 10, (r) => r1(r.cPph), 'dec1', 'n'],
  ['Min (s)', 7, (r) => r1(r.min), 'dec1', 'n'],
  ['Max (s)', 7, (r) => r1(r.max), 'dec1', 'n'],
  ['P90 (s)', 7, (r) => r1(r.p90), 'dec1', 'n'],
  ['CV (%)', 7, (r) => r1(r.cv), 'dec1', 'n'],
  ['Takt (s)', 7, (r) => r1(r.takt), 'dec1', 'n'],
  ['vs Takt (%)', 8, (r) => r1(r.vsTakt), 'signed1', 'n'],
  ['Rejected', 8, (r) => r.rejQty, 'int', 'n'],
  ['Rej (%)', 7, (r) => r2(r.rejRate), 'dec1', 'n'],
  ['Long-gap time (min)', 9, (r) => (r.stopMin != null ? Math.round(r.stopMin) : null), 'int', 'n'],
  ['Weight (kg)', 8, (r) => r.kg ?? null, 'dec1', 'n'],
  ['Total weight (kg)', 10, (r) => (r.totalKg != null ? Math.round(r.totalKg) : null), 'int', 'n'],
  ['Health', 10, (r) => HEALTH_LABEL[r.health], 'center', 'c'],
  ['Explanation', 70, (r) => r.explain, 'wrap', 'x'],
];

export function reportMetaRows(meta, totals) {
  return [
    ['Line', meta.lineLabel],
    ['Period', `${dmy(meta.start)} to ${dmy(meta.end)} (${totals.days} day${totals.days === 1 ? '' : 's'}, ${totals.activeDays} with production)`],
    ['Generated', dmyTime(meta.generatedAt)],
    ['Total production', `${n0(totals.qty)} pcs · ${totals.models} models (A ${totals.clsCount.A} · B ${totals.clsCount.B} · C ${totals.clsCount.C}) · ${n0(Math.round(totals.perDay))} pcs per working day`],
    ['Avg cycle (period)', `${s1(totals.avgCycle)} · median ${s1(totals.medianCycle)} · P90 ${s1(totals.p90Cycle)} · ${n0(totals.validCycles)} valid cycles`],
    ['Rejections / long gaps', `${n0(totals.rejQty)} rejected (${totals.rejRate.toFixed(2)}%) · ${n0(Math.round(totals.stopMin))} min in long gaps`],
    ...(meta.filter ? [['Filter', meta.filter]] : []),
  ];
}

/** Header / note text with the valid-scan window in force (default 1–22 s): meta.low, meta.cap. */
export const vsText = (t, meta = {}) => {
  const lo = meta?.low ?? 1, hi = meta?.cap ?? 22;
  if (lo === 1 && hi === 22) return t;
  return String(t).replace(/1–22 s/g, `${lo}–${hi} s`).replace(/>22 s eliminated/g, `<${lo} s & >${hi} s eliminated`).replace(/gaps above 22 s/g, `gaps below ${lo} s and above ${hi} s`);
};
const NOTES = [
  'P-Q analysis: models sorted by quantity. Class A = models that make the first 80 % of output, B = up to 95 %, C = the rest.',
  'Avg cycle = mean of valid scan-to-scan gaps (outlier gaps removed by the dashboard outlier setting). vs Takt = (avg cycle ÷ takt − 1) × 100, + means slower than takt.',
  'Pcs/hr = qty ÷ hours in which the model was scanned. Long-gap time = time in gaps marked as stoppage. Weight from the model weight list.',
];

export function exportModelXlsx(rows, totals, daily, meta) {
  const C = MODEL_COLUMNS;
  const W = C.length;
  const lastCol = colName(W - 1);
  const title = 'Dixon Technologies — Model-wise P-Q & Production Report';
  const sheet = [[{ v: title, s: 'title' }], [{ v: `${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}`, s: 'subtitle' }]];
  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`];
  for (const [l, v] of reportMetaRows(meta, totals)) {
    const r = sheet.length + 1;
    const row = [{ v: l, s: 'metaLabel' }, { v: null, s: 'metaLabel' }, { v: null, s: 'metaLabel' }, { v, s: 'metaValue' }];
    for (let i = 4; i < W; i++) row.push({ v: null, s: 'metaValue' });
    sheet.push(row);
    merges.push(`A${r}:C${r}`, `D${r}:${lastCol}${r}`);
  }
  sheet.push([]);
  const headerRow = sheet.length + 1;
  sheet.push(C.map(([h]) => ({ v: vsText(h, meta), s: 'head' })));
  rows.forEach((r, i) => sheet.push(C.map(([, , get, st]) => ({ v: get(r), s: i % 2 ? zebra(st) : st }))));
  const lastData = sheet.length;
  const idx = (h) => C.findIndex(([x]) => x === h);
  const tot = C.map((_, i) => ({ v: null, s: i < idx('Qty (pcs)') ? 'totalLabel' : 'totalValue' }));
  tot[0] = { v: 'Total / period', s: 'totalLabel' };
  tot[idx('Qty (pcs)')] = { v: totals.qty, s: 'totalInt' };
  tot[idx('Qty after >22 s eliminated')] = { v: rows.reduce((x, r) => x + (r.aValid || 0), 0), s: 'totalInt' };
  tot[idx('Share (%)')] = { v: 100, s: 'totalValue' };
  tot[idx('Days made')] = { v: totals.activeDays, s: 'totalInt' };
  tot[idx('Avg cycle (s)')] = { v: r1(totals.avgCycle), s: 'totalValue' };
  tot[idx('Median (s)')] = { v: r1(totals.medianCycle), s: 'totalValue' };
  tot[idx('P90 (s)')] = { v: r1(totals.p90Cycle), s: 'totalValue' };
  tot[idx('CV (%)')] = { v: r1(totals.cv), s: 'totalValue' };
  tot[idx('Rejected')] = { v: totals.rejQty, s: 'totalInt' };
  tot[idx('Rej (%)')] = { v: r2(totals.rejRate), s: 'totalValue' };
  tot[idx('Long-gap time (min)')] = { v: Math.round(totals.stopMin), s: 'totalInt' };
  tot[idx('Total weight (kg)')] = { v: Math.round(totals.totalKg), s: 'totalInt' };
  const totRow = sheet.length + 1;
  sheet.push(tot);
  merges.push(`A${totRow}:${colName(idx('Qty (pcs)') - 1)}${totRow}`);
  sheet.push([]);
  for (const n of NOTES) { const r = sheet.length + 1; sheet.push([{ v: vsText(n, meta), s: 'note' }]); merges.push(`A${r}:${lastCol}${r}`); }

  const footer = (name) => `&L&8Dixon Technologies · ${name} · ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}&C&8Generated ${dmyTime(meta.generatedAt)}&R&8Page &P of &N`;
  const main = {
    name: 'Model P-Q', cols: C.map(([, w]) => ({ width: w })), rows: sheet, merges,
    freezeRow: headerRow, headerRow, autoFilter: rows.length ? `A${headerRow}:${lastCol}${lastData}` : null,
    rowHeights: { 1: 24, [headerRow]: 30 }, footer: footer('Model P-Q'),
  };

  // Sheet 2: model × day quantity
  const dates = daily.map((d) => d.date);
  const dCols = [{ width: 5 }, { width: 22 }, ...dates.map(() => ({ width: 8 })), { width: 10 }];
  const dLast = colName(dates.length + 2);
  const dRows = [[{ v: `Daily production by model — ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}`, s: 'subtitle' }], [],
    [{ v: '#', s: 'head' }, { v: 'Model', s: 'head' }, ...dates.map((d) => ({ v: dmy(d).slice(0, 5), s: 'head' })), { v: 'Total', s: 'head' }]];
  rows.forEach((r, i) => dRows.push([
    { v: r.rank, s: i % 2 ? zebra('center') : 'center' }, { v: r.model, s: i % 2 ? zebra('textBold') : 'textBold' },
    ...r.trend.map((v) => ({ v: v || null, s: i % 2 ? zebra('int') : 'int' })), { v: r.qty, s: i % 2 ? zebra('int') : 'int' },
  ]));
  dRows.push([{ v: 'Total', s: 'totalLabel' }, { v: null, s: 'totalLabel' }, ...daily.map((d) => ({ v: d.total, s: 'totalInt' })), { v: totals.qty, s: 'totalInt' }]);
  const dTot = dRows.length;
  const dailySheet = { name: 'Daily by model', cols: dCols, rows: dRows, merges: [`A1:${dLast}1`, `A${dTot}:B${dTot}`], freezeRow: 3, headerRow: 3, footer: footer('Daily by model') };

  // Sheet 3: day summary with avg cycle
  const sRows = [[{ v: `Daily output and avg cycle — ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}`, s: 'subtitle' }], [],
    ['Date', 'Qty (pcs)', 'Avg cycle (s)', 'Median (s)', 'P90 (s)'].map((h) => ({ v: h, s: 'head' }))];
  daily.forEach((d, i) => sRows.push([
    { v: dmy(d.date), s: i % 2 ? zebra('center') : 'center' }, { v: d.total, s: i % 2 ? zebra('int') : 'int' },
    { v: r1(d.mean), s: i % 2 ? zebra('valueA') : 'valueA' }, { v: r1(d.median), s: i % 2 ? zebra('dec1') : 'dec1' }, { v: r1(d.p90), s: i % 2 ? zebra('dec1') : 'dec1' },
  ]));
  sRows.push([{ v: 'Period', s: 'totalLabel' }, { v: totals.qty, s: 'totalInt' }, { v: r1(totals.avgCycle), s: 'totalValue' }, { v: r1(totals.medianCycle), s: 'totalValue' }, { v: r1(totals.p90Cycle), s: 'totalValue' }]);
  const daySheet = { name: 'Daily avg cycle', cols: [{ width: 12 }, { width: 11 }, { width: 13 }, { width: 11 }, { width: 10 }], rows: sRows, merges: ['A1:E1'], freezeRow: 3, headerRow: 3, portrait: true, footer: footer('Daily avg cycle') };

  const bytes = buildXlsx([main, dailySheet, daySheet]);
  downloadXlsx(bytes, `ModelPQ_${String(meta.lineLabel).replace(/\s+/g, '')}_${meta.start}_to_${meta.end}.xlsx`);
  return bytes;
}

/** The Model analysis table with its own period / line: cycle and the three targets per model (from the scan gaps). */
export const CYCLE_TABLE_COLUMNS = [
  ['#', 5, (r) => r.rank, 'center'],
  ['Line', 6, (r) => (r.line ? `Line ${r.line}` : ''), 'center'],
  ['Model', 22, (r) => r.model, 'textBold'],
  ['Model code', 11, (r) => r.modelCode || '', 'center'],
  ['Company', 14, (r) => r.company || '', 'text'],
  ['Qty (pcs)', 10, (r) => r.qty, 'int'],
  ['Qty after >22 s eliminated', 12, (r) => r.aValid ?? null, 'int'],
  ['Share (%)', 8, (r) => r1(r.share), 'dec1'],
  ['Days made', 7, (r) => r.days, 'int'],
  ['Avg cycle (s)', 9, (r) => r1(r.mean), 'valueA'],
  ['Method A cycle (s)', 9, (r) => r.ach ?? null, 'intA'],
  ['Target cycle A+3 (s)', 10, (r) => r.aTarget ?? null, 'intA'],
  ['Pcs ≤ A', 9, (r) => r.achQty ?? null, 'int'],
  ['Share ≤ A (%)', 9, (r) => r1(r.achShare), 'dec1'],
  ['Target A+3 s (pcs/hr)', 10, (r) => r1(r.achPph), 'dec1'],
  ['Method B cycle (s)', 9, (r) => r.bSec ?? null, 'intA'],
  ['B valid scans (1–22 s)', 10, (r) => r.bValid ?? null, 'int'],
  ['Pcs ≤ B', 9, (r) => r.bQty ?? null, 'int'],
  ['Target B (pcs/hr)', 10, (r) => r1(r.bPph), 'dec1'],
  ['Method C cycle (s)', 9, (r) => r1(r.cSec), 'dec1'],
  ['C valid scans (1–22 s)', 10, (r) => r.cValid ?? null, 'int'],
  ['Pcs ≤ C', 9, (r) => r.cQty ?? null, 'int'],
  ['Target C (pcs/hr)', 10, (r) => r1(r.cPph), 'dec1'],
];
export function exportCycleTableXlsx(rows, meta) {
  const C = CYCLE_TABLE_COLUMNS;
  const lastCol = colName(C.length - 1);
  const sheet = [[{ v: 'Dixon Technologies — Model cycle time and targets', s: 'title' }], [{ v: `${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)} · generated ${dmyTime(meta.generatedAt)}`, s: 'subtitle' }], []];
  const headerRow = sheet.length + 1;
  sheet.push(C.map(([h]) => ({ v: vsText(h, meta), s: 'head' })));
  rows.forEach((r, i) => sheet.push(C.map(([, , get, st]) => ({ v: get(r), s: i % 2 ? zebra(st) : st }))));
  const lastData = sheet.length;
  const tot = C.map(() => ({ v: null, s: 'totalValue' }));
  tot[0] = { v: 'Total', s: 'totalLabel' };
  tot[5] = { v: rows.reduce((x, r) => x + (r.qty || 0), 0), s: 'totalInt' };
  tot[6] = { v: rows.reduce((x, r) => x + (r.aValid || 0), 0), s: 'totalInt' };
  sheet.push(tot, []);
  for (const n0 of ['Method A = the whole second with the most cycles (gaps 1–22 s); its target cycle = A + 3 s. Method B = smallest whole second within which 70 % of the pieces were made (gaps 1–22 s, same valid scans as Control charts). Method C = control chart centre line = mean of the gaps 1–22 s. Targets in pcs/hr = 3600 ÷ target cycle.']) { const n = vsText(n0, meta); const r = sheet.length + 1; sheet.push([{ v: n, s: 'note' }]); }
  const bytes = buildXlsx([{ name: 'Cycle and targets', cols: C.map(([, w]) => ({ width: w })), rows: sheet, merges: [`A1:${lastCol}1`, `A2:${lastCol}2`, `A${sheet.length}:${lastCol}${sheet.length}`], freezeRow: headerRow, headerRow, autoFilter: rows.length ? `A${headerRow}:${lastCol}${lastData}` : null, rowHeights: { 1: 24, [headerRow]: 30 } }]);
  downloadXlsx(bytes, `ModelCycle_${String(meta.lineLabel).replace(/\s+/g, '')}_${meta.start}_to_${meta.end}.xlsx`);
  return bytes;
}

// ─────────────────────────────── Print ───────────────────────────────

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtCell = (v, st) => {
  if (v == null || v === '') return '—';
  if (typeof v !== 'number') return h(v);
  if (st === 'int' || st === 'center') return v.toLocaleString('en-IN');
  if (st === 'signed1') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  return v.toFixed(1);
};

export function modelReportHtml(rows, totals, meta) {
  const C = MODEL_COLUMNS;
  const metaRows = reportMetaRows(meta, totals).map(([l, v]) => `<tr><th>${h(l)}</th><td>${h(v)}</td></tr>`).join('');
  const head = C.map(([t]) => `<th>${h(vsText(t, meta))}</th>`).join('');
  const body = rows.map((r) => `<tr class="k${r.cls}">${C.map(([, , get, st, cls]) => `<td class="${cls}">${fmtCell(get(r), st)}</td>`).join('')}</tr>`).join('');
  const qi = C.findIndex(([t]) => t === 'Qty (pcs)');
  const ai = C.findIndex(([t]) => t === 'Avg cycle (s)');
  const foot = `<tr class="tot"><td colspan="${qi}">Total / period</td><td class="n">${n0(totals.qty)}</td><td class="n">${n0(rows.reduce((x, r) => x + (r.aValid || 0), 0))}</td><td class="n">100.0</td><td colspan="${ai - qi - 3}"></td><td class="n a">${totals.avgCycle != null ? totals.avgCycle.toFixed(1) : '—'}</td><td colspan="${C.length - ai - 1}"></td></tr>`;
  const footerText = `Dixon Technologies · Model P-Q · ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)} · printed ${dmyTime(meta.generatedAt)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Model P-Q ${h(meta.lineLabel)} ${h(meta.start)} to ${h(meta.end)}</title>
<style>
@page { size: A3 landscape; margin: 9mm 7mm 13mm 7mm;
  @bottom-left { content: "${footerText.replace(/"/g, '')}"; font: 8pt Arial, sans-serif; color: #475569; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #475569; } }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 8.5pt Arial, Helvetica, sans-serif; color: #0f172a; }
h1 { font-size: 15pt; margin: 0 0 2px; } .sub { font-size: 10pt; font-weight: bold; color: #1e3a8a; margin: 0 0 6px; }
table { border-collapse: collapse; width: 100%; }
.meta { width: auto; margin-bottom: 8px; } .meta th, .meta td { border: 1px solid #64748b; padding: 3px 8px; text-align: left; }
.meta th { background: #e2e8f0; white-space: nowrap; }
.grid th, .grid td { border: 1px solid #475569; padding: 2px 4px; vertical-align: top; }
.grid thead th { background: #1e3a8a; color: #fff; font-size: 8pt; text-align: center; vertical-align: middle; }
.grid thead { display: table-header-group; } .grid tr { page-break-inside: avoid; break-inside: avoid; }
.grid tbody tr:nth-child(even) td { background: #f1f5f9; }
.grid td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.grid td.c { text-align: center; white-space: nowrap; } .grid td.b { font-weight: bold; white-space: nowrap; }
.grid td.a { background: #ccfbf1 !important; font-weight: bold; } .grid td.x { min-width: 70mm; font-size: 7.5pt; }
.grid tr.kA td:nth-child(5) { color: #1d4ed8; font-weight: bold; } .grid tr.kB td:nth-child(5) { color: #b45309; font-weight: bold; }
.grid tr.tot td { background: #e2e8f0; font-weight: bold; text-align: right; }
.notes { margin-top: 8px; font-size: 8pt; color: #475569; } .notes p { margin: 1px 0; }
</style></head><body>
<h1>Dixon Technologies — Model-wise P-Q &amp; Production Report</h1>
<p class="sub">${h(meta.lineLabel)} · ${h(dmy(meta.start))} to ${h(dmy(meta.end))}</p>
<table class="meta"><tbody>${metaRows}</tbody></table>
<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${C.length}" class="c">No models</td></tr>`}</tbody><tfoot>${foot}</tfoot></table>
<div class="notes">${NOTES.map((n) => `<p>${h(n)}</p>`).join('')}</div>
</body></html>`;
}

export function printModelReport(rows, totals, meta) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(modelReportHtml(rows, totals, meta)); doc.close();
  let removed = false;
  const cleanup = () => { if (!removed) { removed = true; frame.remove(); } };
  const go = () => {
    frame.contentWindow.addEventListener('afterprint', () => setTimeout(cleanup, 100));
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(cleanup, 120000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 150); else frame.onload = () => setTimeout(go, 150);
}
