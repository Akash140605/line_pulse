/**
 * Target & loss of all lines → Excel: line summary, daily ₹ matrix (days × lines) and every line-day in detail.
 */
import { colName } from './xlsxWriter';

const dmy = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
const r0 = (v) => (v == null ? null : Math.round(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

function head(title, sub, width) {
  return { rows: [[{ v: title, s: 'title' }], [{ v: sub, s: 'subtitle' }], []], merges: [`A1:${colName(width - 1)}1`, `A2:${colName(width - 1)}2`] };
}

/** mx = lossMatrix(...); meta = { start, end }. Returns { fileName, sheets }. */
export function lossMatrixWorkbook(mx, meta) {
  const sub = `${dmy(meta.start)} to ${dmy(meta.end)} · ₹ = short pcs × ₹ per piece + lost time × ₹ per line-hour · days under 5 % of target not counted`;
  // 1) line summary
  const C1 = [['Line', 12], ['Actual (pcs)', 12], ['Target (pcs)', 12], ['Achievement (%)', 12], ['Short (pcs)', 11], ['Lost time (h)', 11],
    ['₹ pieces', 14], ['₹ line time', 14], ['₹ total', 14], ['Rejected', 10], ['Days counted', 10], ['₹ / piece', 10], ['₹ / line-hour', 12]];
  const s1 = head('Target and loss — line summary', sub, C1.length);
  const h1 = s1.rows.length + 1;
  s1.rows.push(C1.map(([h]) => ({ v: h, s: 'head' })));
  const lineRow = (name, t, m, total = false) => {
    const S = (st) => (total ? (st === 'text' ? 'totalLabel' : st === 'dec1' ? 'totalValue' : 'totalInt') : st);
    return [{ v: name, s: total ? 'totalLabel' : 'textBold' }, { v: t.actual, s: S('int') }, { v: r0(t.target), s: S('int') }, { v: r1(t.pct), s: S('dec1') },
      { v: r0(t.short), s: S('int') }, { v: r1(t.lostSec != null ? t.lostSec / 3600 : null), s: S('dec1') },
      { v: r0(t.rsPcs), s: S('int') }, { v: r0(t.rsTime), s: S('int') }, { v: r0(t.rsTotal), s: S('int') }, { v: t.rej, s: S('int') }, { v: t.plannedDays, s: S('int') },
      { v: m ? m.pcValue ?? null : null, s: S('int') }, { v: m ? m.hourCost ?? null : null, s: S('int') }];
  };
  mx.lines.forEach((l) => s1.rows.push(lineRow(l.name, l.total, l.money)));
  s1.rows.push(lineRow('Total', mx.grand, null, true));

  // 2) daily ₹ matrix
  const C2 = [['Date', 12], ...mx.lines.map((l) => [`${l.name} ₹`, 14]), ['Total ₹', 14], ...mx.lines.map((l) => [`${l.name} short pcs`, 12]), ['Total short pcs', 12]];
  const s2 = head('Daily loss in ₹ — lines side by side', sub, C2.length);
  const h2 = s2.rows.length + 1;
  s2.rows.push(C2.map(([h]) => ({ v: h, s: 'head' })));
  const cnt = (dl, k) => (dl && !dl.skipped ? r0(dl[k]) : null);
  mx.days.forEach((d) => s2.rows.push([{ v: dmy(d), s: 'center' }, ...mx.lines.map((l) => ({ v: cnt(l.days[d], 'rsTotal'), s: 'int' })), { v: r0(mx.dayTotal[d].rsTotal), s: 'textBold' },
    ...mx.lines.map((l) => ({ v: cnt(l.days[d], 'short'), s: 'int' })), { v: r0(mx.dayTotal[d].short), s: 'int' }]));
  s2.rows.push([{ v: 'Total', s: 'totalLabel' }, ...mx.lines.map((l) => ({ v: r0(l.total.rsTotal), s: 'totalInt' })), { v: r0(mx.grand.rsTotal), s: 'totalInt' },
    ...mx.lines.map((l) => ({ v: r0(l.total.short), s: 'totalInt' })), { v: r0(mx.grand.short), s: 'totalInt' }]);

  // 3) every line-day
  const C3 = [['Date', 12], ['Line', 10], ['Actual (pcs)', 11], ['Target (pcs)', 11], ['Achievement (%)', 11], ['Short (pcs)', 10], ['Lost time (min)', 11],
    ['₹ pieces', 13], ['₹ line time', 13], ['₹ total', 13], ['Rejected', 9], ['Pcs with target (%)', 12], ['Counted', 9]];
  const s3 = head('Daily loss — every line and day', sub, C3.length);
  const h3 = s3.rows.length + 1;
  s3.rows.push(C3.map(([h]) => ({ v: h, s: 'head' })));
  let n3 = 0;
  for (const d of mx.days) for (const l of mx.lines) {
    const x = l.days[d];
    if (!x) continue;
    n3++;
    s3.rows.push([{ v: dmy(d), s: 'center' }, { v: l.name, s: 'textBold' }, { v: x.actual, s: 'int' }, { v: r0(x.target), s: 'int' }, { v: r1(x.pct), s: 'dec1' },
      { v: r0(x.short), s: 'int' }, { v: r0(x.lostSec != null ? x.lostSec / 60 : null), s: 'int' }, { v: r0(x.rsPcs), s: 'int' }, { v: r0(x.rsTime), s: 'int' },
      { v: r0(x.rsTotal), s: 'int' }, { v: x.rej || 0, s: 'int' }, { v: r1(x.coverage), s: 'dec1' }, { v: x.skipped ? 'No (< 5 %)' : x.hasPlan ? 'Yes' : 'No target', s: 'center' }]);
  }
  const sheet = (name, C, s, hr, n) => ({ name, cols: C.map(([, w]) => ({ width: w })), rows: s.rows, merges: s.merges, freezeRow: hr, headerRow: hr,
    autoFilter: n ? `A${hr}:${colName(C.length - 1)}${hr + n}` : null });
  return {
    fileName: `Target_and_loss_all_lines_${meta.start}_to_${meta.end}.xlsx`,
    sheets: [sheet('Line summary', C1, s1, h1, mx.lines.length), sheet('Daily loss matrix', C2, s2, h2, mx.days.length), sheet('Line-day detail', C3, s3, h3, n3)],
  };
}

/**
 * Main page export (management): the target-and-loss sheets plus daily production per line and all models.
 * lines = all_lines.php lines (company filter already applied for production), mx = lossMatrix, meta = {start, end, period}
 */
export function mainWorkbook(lines, mx, meta) {
  const base = lossMatrixWorkbook(mx, meta);
  const ok = (lines || []).filter((l) => l.ok);
  const days = [...new Set(ok.flatMap((l) => (l.daily || []).map((r) => r.d)))].sort();
  const C1 = [['Date', 12], ...ok.map((l) => [`${l.name} (pcs)`, 13]), ['Total (pcs)', 13], ...ok.map((l) => [`${l.name} rejected`, 12])];
  const s1 = head('Daily production — all lines', meta.period || `${dmy(meta.start)} to ${dmy(meta.end)}`, C1.length);
  const h1 = s1.rows.length + 1;
  s1.rows.push(C1.map(([h]) => ({ v: h, s: 'head' })));
  const by = Object.fromEntries(ok.map((l) => [l.line, Object.fromEntries((l.daily || []).map((r) => [r.d, r]))]));
  for (const d of days) {
    const q = ok.map((l) => by[l.line][d]?.q || 0);
    s1.rows.push([{ v: dmy(d), s: 'center' }, ...q.map((v) => ({ v, s: 'int' })), { v: q.reduce((a, b) => a + b, 0), s: 'textBold' }, ...ok.map((l) => ({ v: by[l.line][d]?.rej || 0, s: 'int' }))]);
  }
  const tq = ok.map((l) => (l.daily || []).reduce((a, r) => a + (r.q || 0), 0));
  s1.rows.push([{ v: 'Total', s: 'totalLabel' }, ...tq.map((v) => ({ v, s: 'totalInt' })), { v: tq.reduce((a, b) => a + b, 0), s: 'totalInt' }, ...ok.map((l) => ({ v: (l.daily || []).reduce((a, r) => a + (r.rej || 0), 0), s: 'totalInt' }))]);
  const C2 = [['Line', 10], ['Model', 28], ['Model code', 12], ['Company', 16], ['Qty', 11], ['Days', 8], ['Avg cycle (s)', 11]];
  const s2 = head('Models — all lines', meta.period || '', C2.length);
  const h2 = s2.rows.length + 1;
  s2.rows.push(C2.map(([h]) => ({ v: h, s: 'head' })));
  const ms = ok.flatMap((l) => (l.models || []).map((m) => ({ ...m, lineName: l.name }))).sort((a, b) => b.qty - a.qty);
  ms.forEach((m) => s2.rows.push([{ v: m.lineName, s: 'center' }, { v: m.model, s: 'textBold' }, { v: m.modelCode || '', s: 'center' }, { v: m.company || '', s: 'text' }, { v: m.qty, s: 'int' }, { v: m.days, s: 'int' }, { v: m.avgCycle == null ? null : Math.round(m.avgCycle * 10) / 10, s: 'dec1' }]));
  const sheet = (name, C, s, hr, n) => ({ name, cols: C.map(([, w]) => ({ width: w })), rows: s.rows, merges: s.merges, freezeRow: hr, headerRow: hr, autoFilter: n ? `A${hr}:${colName(C.length - 1)}${hr + n}` : null });
  return {
    fileName: `EMS_all_lines_${meta.start}_to_${meta.end}.xlsx`,
    sheets: [base.sheets[0], sheet('Daily production', C1, s1, h1, days.length), base.sheets[1], base.sheets[2], sheet('Models', C2, s2, h2, ms.length)],
  };
}
