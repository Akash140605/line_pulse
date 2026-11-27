/**
 * 25-11-2026: Quality MIS — the plant's "Quality_MIS" workbook, the sheets Line Pulse can fill from its own data:
 *   IPQC(Daily)              every line: defect qty, production and defect % of every day of the period (+ the total)
 *   Daily Top Defect Action  every day and line: its top defects with category, root cause, action, responsibility, status
 *   Summary                  every line: its defects, most first (sum of the period)
 *   Hrly. Rework data(ipqc)  the rework + rejection rows hour by hour (utils/reworkReport.js, the same as its own report)
 * LAR / LRN (incoming quality) are not in Line Pulse: those sheets are not made.
 * W = reworkSheet(...) rows, R = oleRange (production), rca = RCA register { 'date|line|kind|reason': rec }.
 */
import { reworkXlsxSheet, lineName } from './reworkReport';
import { excelDate } from './kpiReport';

export const MIS_TOP = 5;
export const MIS_TGT = 0.033;   // 27-11-2026: the plant's defect % target (TGT row of IPQC)   // defects per day and line in "Daily Top Defect Action"
const tidy = (s) => String(s || '').trim();
const dmy = (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/** → { from, to, days, lines: [{ line, name, byDay: { date: { def, prod } }, def, prod }], top: [...], summary: [...] } */
export function misData({ W, R, ids = [], rca = {}, from, to, top = MIS_TOP }) {
  const rows = (W?.rows || []).filter((r) => r.date >= from && r.date <= to && (!ids.length || ids.map(String).includes(String(r.line))));
  const days = (R?.days || []).map((d) => d.date).filter((d) => d >= from && d <= to);
  for (const r of rows) if (!days.includes(r.date)) days.push(r.date);
  days.sort();
  const lineIds = ids.length ? ids.map(String) : [...new Set(rows.map((r) => String(r.line)))].sort((a, b) => Number(a) - Number(b));
  const lines = lineIds.map((l) => {
    const byDay = {};
    for (const d of days) {
      const day = (R?.days || []).find((x) => x.date === d);
      const L = day?.byLine?.[l];
      const prod = L?.ok ? (L.rows || []).filter((r) => !r.closed && !r.future).reduce((a, r) => a + (r.qty || 0), 0) : 0;
      const def = rows.filter((r) => r.date === d && String(r.line) === l).reduce((a, r) => a + (r.total || 0), 0);
      byDay[d] = { def, prod };
    }
    const def = Object.values(byDay).reduce((a, x) => a + x.def, 0), prod = Object.values(byDay).reduce((a, x) => a + x.prod, 0);
    return { line: l, name: lineName(l), byDay, def, prod };
  }).filter((x) => x.def > 0 || x.prod > 0);

  // the top defects of every day and line (the same defect over the hours, stages and models: one row)
  const G = new Map();
  for (const r of rows) {
    const k = `${r.date}|${r.line}|${tidy(r.defect).toUpperCase()}`;
    const g = G.get(k) || { date: r.date, line: String(r.line), name: lineName(r.line), cat: '', defect: tidy(r.defect).toUpperCase() || 'NOT GIVEN', raws: new Set(), qty: 0, cause: '', action: '', kinds: new Set() };
    g.qty += r.total || 0; g.kinds.add(r.kind || 'rework'); g.raws.add(tidy(r.defect) || 'Not given');
    if (!g.cat && r.cat) g.cat = r.cat; if (!g.cause && r.cause) g.cause = tidy(r.cause); if (!g.action && r.action) g.action = tidy(r.action);
    G.set(k, g);
  }
  const groups = new Map();
  for (const g of G.values()) { const k = `${g.date}|${g.line}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
  const topRows = [];
  for (const k of [...groups.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const list = groups.get(k).sort((a, b) => b.qty - a.qty || a.defect.localeCompare(b.defect)).slice(0, top);
    for (const g of list) {
      const rec = [...g.kinds].flatMap((kind) => [...g.raws].map((raw) => rca?.[`${g.date}|${g.line}|${kind}|${raw}`])).find(Boolean) || null;
      const status = rec ? (rec.status === 'closed' ? `Closed${rec.closeDate ? ` ${dmy(rec.closeDate)}` : ''}` : rec.targetDate ? `Target ${dmy(rec.targetDate)}` : 'Open') : '';
      topRows.push({ date: g.date, line: g.line, name: g.name, cat: g.cat, defect: g.defect, qty: g.qty, cause: rec?.rootCause || g.cause, action: rec?.action || g.action, owner: rec?.owner || '', status });
    }
  }

  // Summary: every line, its defects (most first)
  const S = new Map();
  for (const r of rows) {
    const k = `${r.line}|${tidy(r.defect).toUpperCase()}`;
    const s = S.get(k) || { line: String(r.line), name: lineName(r.line), defect: tidy(r.defect).toUpperCase() || 'NOT GIVEN', qty: 0 };
    s.qty += r.total || 0; S.set(k, s);
  }
  const summary = [...S.values()].sort((a, b) => Number(a.line) - Number(b.line) || b.qty - a.qty || a.defect.localeCompare(b.defect));
  return { from, to, days, lines, top: topRows, summary };
}

const H = (v) => ({ v, s: 'hprHead' });
const T = (v) => ({ v, s: 'hprText' });
const I = (v) => ({ v, s: 'hprInt' });

/** The workbook's sheets for buildXlsx. */
export function misSheets(M, W) {
  const col = (i) => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  // 27-11-2026: IPQC(Daily) as the plant's sheet — Date | Category | Total | one column a month of the period (Apr-26 …)
  // | one column a day of the last month (1-Nov …). Every line: Defect Qty (line name in yellow), Production, Defect %.
  // Then T. PRODUCTION (all lines) and TGT (the defect % target) under every column.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = [...new Set(M.days.map((d) => d.slice(0, 7)))].sort();
  const lastM = (M.to || M.days[M.days.length - 1] || '').slice(0, 7);
  const dim = lastM ? new Date(Date.UTC(Number(lastM.slice(0, 4)), Number(lastM.slice(5, 7)), 0)).getUTCDate() : 0;
  const mDays = Array.from({ length: dim }, (_, i) => `${lastM}-${String(i + 1).padStart(2, '0')}`).filter((d) => !M.to || d <= M.to);
  const cols = [...months.map((m) => ({ m })), ...mDays.map((d) => ({ d }))];
  const sumOfL = (l, c, k) => (c.m ? M.days.filter((d) => d.startsWith(c.m)).reduce((a, d) => a + (l.byDay[d]?.[k] || 0), 0) : l.byDay[c.d]?.[k] || 0);
  const mEnd = col(2 + months.length);   // last month column
  const ipqc = [[H('Date'), H('Category'), H('Total'), ...cols.map((c) => (c.m ? H(`${MON[Number(c.m.slice(5, 7)) - 1]}-${c.m.slice(2, 4)}`) : { v: excelDate(c.d), s: 'hprHeadDate' }))]];
  const lineRow = [];
  for (const l of M.lines) {
    const a = ipqc.length + 1; lineRow.push(a);
    const tot = (k) => ({ f: months.length ? `SUM(D${a + k}:${mEnd}${a + k})` : '0', v: k ? l.prod : l.def, s: 'hprIntB' });
    ipqc.push([{ v: l.name, s: 'hprInput' }, T('Defect Qty'), tot(0), ...cols.map((c) => I(sumOfL(l, c, 'def') || null))]);
    ipqc.push([T(l.name), T('Production'), tot(1), ...cols.map((c) => I(sumOfL(l, c, 'prod') || null))]);
    ipqc.push([T(l.name), T('Defect %'), { f: `IFERROR(C${a}/C${a + 1},"")`, v: l.prod ? l.def / l.prod : '', s: 'hprPctB' },
      ...cols.map((c, i) => { const cc = col(3 + i); const dq = sumOfL(l, c, 'def'), pq = sumOfL(l, c, 'prod'); return { f: `IFERROR(${cc}${a}/${cc}${a + 1},"")`, v: pq ? dq / pq : '', s: 'hprPct' }; })]);
  }
  const allCols = [2, ...cols.map((_, i) => 3 + i)];
  ipqc.push([{ v: 'T. PRODUCTION', s: 'hprTotal' }, { v: '', s: 'hprTotal' }, ...allCols.map((ci) => ({ f: lineRow.length ? lineRow.map((r) => `${col(ci)}${r + 1}`).join('+') : '0',
    v: ci === 2 ? M.lines.reduce((s2, l) => s2 + l.prod, 0) : M.lines.reduce((s2, l) => s2 + sumOfL(l, cols[ci - 3], 'prod'), 0), s: 'hprTotal' }))]);
  ipqc.push([{ v: 'TGT', s: 'hprTotal' }, { v: '', s: 'hprTotal' }, ...allCols.map(() => ({ v: MIS_TGT, s: 'hprTotalPct' }))]);
  // Daily Top Defect Action
  const top = [['Date', 'Line', 'Category', 'Defect', 'Total Qty', 'Root Cause For Defect', 'Action', 'Responsibility', 'Target Date/Status'].map(H)];
  let prev = '';
  for (const r of M.top) {
    const k = `${r.date}|${r.line}`; const first = k !== prev; prev = k;
    top.push([first ? { v: excelDate(r.date), s: 'hprDate' } : T(''), T(first ? r.name : ''), T(r.cat || ''), { v: r.defect, s: 'hprTextB' }, I(r.qty), T(r.cause), T(r.action), T(r.owner), T(r.status)]);
  }
  // Summary
  const sum = [[H('Line'), H('DEFECT DESCRIPTION'), H('Sum of Total')]];
  let pl = '';
  for (const s of M.summary) {
    if (s.line !== pl && pl) sum.push([{ v: `${lineName(pl)} Total`, s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { v: M.summary.filter((x) => x.line === pl).reduce((a, x) => a + x.qty, 0), s: 'hprTotal' }]);
    sum.push([T(s.line !== pl ? s.name : ''), T(s.defect), I(s.qty)]); pl = s.line;
  }
  if (pl) sum.push([{ v: `${lineName(pl)} Total`, s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { v: M.summary.filter((x) => x.line === pl).reduce((a, x) => a + x.qty, 0), s: 'hprTotal' }]);
  sum.push([{ v: 'Grand Total', s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { v: M.summary.reduce((a, x) => a + x.qty, 0), s: 'hprTotal' }]);
  return [
    { name: 'IPQC(Daily)', cols: [{ width: 16 }, { width: 13 }, { width: 10 }, ...cols.map((c) => ({ width: c.m ? 9 : 7.5 }))], rows: ipqc, freezeRow: 1 },
    { name: 'Daily Top Defect Action', cols: [11, 13, 12, 30, 9, 40, 40, 16, 18].map((width) => ({ width })), rows: top, freezeRow: 1, autoFilter: `A1:I${top.length}` },
    { name: 'Summary', cols: [18, 36, 12].map((width) => ({ width })), rows: sum, freezeRow: 1 },
    reworkXlsxSheet(W || { rows: [], hours: [], totals: { total: 0, rs: 0, hours: {} } }),
  ];
}

export const misFileName = (to) => `Quality_MIS_${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(to.slice(5, 7)) - 1]}-${to.slice(2, 4)}.xlsx`;
