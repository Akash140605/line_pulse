/**
 * Quality dashboard (23-11-2026) — everything of the page in one pass, so it can be tested without a browser.
 * No rejection any more: a bad piece is reworked (or dismantled); old rejection rows still count, as rework.
 *   made  = good scans of the rows (oleRange days → byLine → rows)
 *   bad   = rework + old rejection pieces of the Loss / Quality entry (qualityOf)
 *   rate  = bad ÷ made (%), PPM = bad ÷ made × 1 000 000
 *   FPY / RTY = utils/ole.js qualityOf · category / dismantled / hour = the rework sheet (utils/reworkReport.js)
 */
import { qualityOf, issuesOf, needsRca, rcaStatus } from './ole';
import { groupRows, hourCol } from './reworkReport';

const p2 = (n) => String(n).padStart(2, '0');
export const pct = (bad, made) => (made > 0 ? (bad / made) * 100 : null);
export const ppm = (bad, made) => (made > 0 ? Math.round((bad / made) * 1e6) : null);

const rowsOf = (days, ids) => (days || []).flatMap((d) => ids.flatMap((l) => (d.byLine?.[l]?.rows || []).map((r) => ({ ...r, line: String(l), date: d.date }))));

function sumQ(q, extra = {}) {
  const bad = q.rej + q.rwk;
  return { made: q.qty, bad, rwk: q.rwk, rej: q.rej, pct: pct(bad, q.qty), ppm: ppm(bad, q.qty), fpy: q.fpy, rty: q.rty, ...extra };
}

/**
 * days = oleRange(...).days, ids = lines, stations = stationsFor(...) (the admin's station list),
 * sheet = reworkSheet(...).rows of the same period and lines, rca = entries' RCA map, oneDay → trend per hour.
 */
export function qualityDash({ days = [], ids = [], stations = [], sheet = [], rca = {}, oneDay = false } = {}) {
  const rows = rowsOf(days, ids);
  const Q = qualityOf(rows, stations);
  const dis = sheet.reduce((a, r) => a + (r.dismantle || 0), 0);
  const issues = issuesOf(days).filter((i) => (i.kind === 'rework' || i.kind === 'reject') && ids.includes(String(i.line)));
  const open = issues.filter((i) => needsRca(i) && rcaStatus(rca[i.key]) === 'pending');

  const topDefectOf = (sh) => groupRows(sh, 'defect')[0]?.key || '';
  const lines = ids.map((l) => {
    const sh = sheet.filter((r) => r.line === String(l));
    const q = qualityOf(rows.filter((r) => r.line === String(l)), stations);
    return sumQ(q, { line: String(l), dismantle: sh.reduce((a, r) => a + r.dismantle, 0), top: topDefectOf(sh), rcaOpen: open.filter((i) => i.line === String(l)).length });
  });

  // trend: hour by hour for one day, day by day for a longer period
  const trend = [];
  if (oneDay) {
    const hs = [...new Set(rows.map((r) => r.hour))].sort((a, b) => a - b);
    for (const h of hs) trend.push({ key: String(h), label: p2(h), title: hourCol(h), ...sumQ(qualityOf(rows.filter((r) => r.hour === h), stations)) });
  } else {
    for (const d of days) trend.push({ key: d.date, label: d.date.slice(8), title: `${d.date.slice(8)}-${d.date.slice(5, 7)}-${d.date.slice(0, 4)}`, ...sumQ(qualityOf(rows.filter((r) => r.date === d.date), stations)) });
  }

  // stations: the set-up active ones and any with pieces; FPY of each against all made pieces
  const st = Q.stations.filter((s) => (s.setup && s.active) || s.rej + s.rwk > 0)
    .map((s) => ({ name: s.name, label: s.label, bad: s.rej + s.rwk, fpy: s.fpy, rty: s.rty, top: s.defects[0]?.name || '' }))
    .sort((a, b) => b.bad - a.bad || a.label.localeCompare(b.label));

  // defects as a Pareto: pieces, share, running share
  const badAll = Q.rej + Q.rwk;
  let run = 0;
  const defects = Q.defects.map((d) => { const n = d.rej + d.rwk; run += n; return { name: d.name, bad: n, share: pct(n, badAll), cum: pct(run, badAll), models: d.models.slice(0, 3).map((m) => m.name) }; });

  const models = Q.models.map((m) => {
    const n = m.rej + m.rwk;
    return { name: m.name, made: m.qty, bad: n, pct: pct(n, m.qty), ppm: ppm(n, m.qty), top: topDefectOf(sheet.filter((r) => r.model === m.name)) };
  });

  const cats = groupRows(sheet, 'cat').map((c) => ({ name: c.key, bad: c.total, dismantle: c.dismantle, share: pct(c.total, badAll) }));

  // line × hour of the day (pieces) from the sheet
  const hours = [...new Set(sheet.flatMap((r) => Object.keys(r.hours).map(Number)))].sort((a, b) => a - b);
  const heat = ids.map((l) => {
    const sh = sheet.filter((r) => r.line === String(l));
    const by = Object.fromEntries(hours.map((h) => [h, sh.reduce((a, r) => a + (r.hours[h] || 0), 0)]));
    return { line: String(l), by, total: Object.values(by).reduce((a, b) => a + b, 0) };
  });

  const worst = (list) => list.filter((x) => x.pct != null && x.bad > 0).sort((a, b) => b.pct - a.pct)[0] || null;
  return {
    total: { ...sumQ(Q), dismantle: dis, defects: Q.defects.length, rcaOpen: open.length, rcaAll: issues.filter(needsRca).length },
    lines, trend, stations: st, defects, models, cats, hours, heat,
    worstLine: worst(lines), worstModel: worst(models.filter((m) => m.made >= 50)) || worst(models),
  };
}

/* ───────────── Excel: summary, by line, trend, stations, defects, models, categories ───────────── */

const H = (v) => ({ v, s: 'hprHead' });
const T = (v) => ({ v, s: 'hprText' });
const I = (v) => ({ v: v ?? null, s: 'hprInt' });
const P = (v) => ({ v: v == null ? null : v / 100, s: 'hprPct' });
const sheetOf = (name, head, body, widths) => ({ name, cols: widths.map((width) => ({ width })), rows: [head.map(H), ...body], freezeRow: 1 });

export function qualitySheets(Q, { title = 'Quality', period = '', lineName = (l) => `Line ${l}` } = {}) {
  const t = Q.total;
  const sum = [
    [{ v: title, s: 'hprTitle' }], [{ v: period, s: 'hprNote' }], [],
    [H('Measure'), H('Value')],
    [T('Pieces made'), I(t.made)], [T('Rework pieces'), I(t.bad)], [T('Rework %'), P(t.pct)], [T('PPM'), I(t.ppm)],
    [T('Dismantled'), I(t.dismantle)], [T('FPY'), { v: t.fpy, s: 'hprPct' }], [T('RTY'), { v: t.rty, s: 'hprPct' }],
    [T('Defect types'), I(t.defects)], [T('RCA pending'), I(t.rcaOpen)],
  ];
  return [
    { name: 'Summary', cols: [{ width: 22 }, { width: 14 }], rows: sum },
    sheetOf('By line', ['Line', 'Made', 'Rework', 'Rework %', 'PPM', 'Dismantled', 'FPY', 'RTY', 'Top defect', 'RCA pending'],
      Q.lines.map((r) => [T(lineName(r.line)), I(r.made), I(r.bad), P(r.pct), I(r.ppm), I(r.dismantle), { v: r.fpy, s: 'hprPct' }, { v: r.rty, s: 'hprPct' }, T(r.top), I(r.rcaOpen)]),
      [16, 10, 10, 10, 10, 11, 9, 9, 30, 11]),
    sheetOf('Trend', ['Day / hour', 'Made', 'Rework', 'Rework %', 'PPM', 'FPY'],
      Q.trend.map((r) => [T(r.title), I(r.made), I(r.bad), P(r.pct), I(r.ppm), { v: r.fpy, s: 'hprPct' }]), [14, 10, 10, 10, 10, 9]),
    sheetOf('Stations', ['Station', 'Rework', 'FPY', 'In RTY', 'Top defect'],
      Q.stations.map((r) => [T(r.label), I(r.bad), { v: r.fpy, s: 'hprPct' }, T(r.rty ? 'Yes' : 'No'), T(r.top)]), [24, 10, 9, 8, 30]),
    sheetOf('Defects', ['Defect', 'Pieces', 'Share %', 'Cumulative %', 'Models'],
      Q.defects.map((r) => [T(r.name), I(r.bad), P(r.share), P(r.cum), T(r.models.join(', '))]), [34, 9, 10, 13, 40]),
    sheetOf('Models', ['Model', 'Made', 'Rework', 'Rework %', 'PPM', 'Top defect'],
      Q.models.map((r) => [T(r.name), I(r.made), I(r.bad), P(r.pct), I(r.ppm), T(r.top)]), [26, 10, 10, 10, 10, 30]),
    sheetOf('Category', ['Category', 'Pieces', 'Dismantled', 'Share %'],
      Q.cats.map((r) => [T(r.name), I(r.bad), I(r.dismantle), P(r.share)]), [20, 10, 11, 10]),
  ];
}
