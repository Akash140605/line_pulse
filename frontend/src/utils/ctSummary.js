import { buildXlsx, downloadXlsx, colName, zebra } from './xlsxWriter';

/**
 * Cycle-time summary in the plant's format, one sheet per company (Samsung, Voltas, Godrej, Remaining), biggest quantity first:
 *   S.No. · Line · Model · Model code · Company · Qty · Eliminated < low s · Eliminated > cap s · Qty after both eliminated ·
 *   Max achieved CT (%) · Method A · Method B · B − A · Avg cycle · Avg − A
 *   Valid scans = gaps low … cap s (the target rule: default 1–22 s; below = double scans / glitches, above = stops).
 *   Max achieved CT % = share of the valid scans made at the Method A second or faster. Avg cycle = mean of the valid gaps, to 0.1 s.
 */
const CO_SHEETS = [['Samsung', /SAMSUNG/i], ['Voltas', /VOLTAS/i], ['Godrej', /GODREJ/i]];
/** Company sheet a row goes to: Samsung, Voltas, Godrej or Remaining. */
export const coSheetOf = (company) => (CO_SHEETS.find(([, re]) => re.test(company || '')) || ['Remaining'])[0];

/** Company key used for the choice of customers (upper case, trimmed; empty = "No company"). */
export const ctCompany = (c) => String(c ?? '').trim().toUpperCase() || 'NO COMPANY';
/** Customers of the rows for the check list: [{ key, label, models, qty }], biggest quantity first. */
export function ctCompanies(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r.A || !r.B) continue;
    const k = ctCompany(r.company);
    const o = m.get(k) || { key: k, label: k, models: 0, qty: 0 };
    o.models++; o.qty += r.qty || 0; m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty);
}
const sheetName = (s) => String(s).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet';
const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * sel = null → Samsung, Voltas, Godrej and Remaining (all companies).
 * sel = { companies: [keys], groupOthers } → only the chosen customers; Samsung / Voltas / Godrej get their own sheet,
 * the other chosen companies one "Remaining" sheet (groupOthers) or a sheet each.
 */
export function exportCycleSummary(rows, opts, range, lineText, sel = null) {
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const all = rows.filter((r) => r.A && r.B).sort((a, b) => b.qty - a.qty);
  const lo = opts.lowA ?? 1, hi = opts.capA;
  // valid scans = gaps lo … hi s: gaps below lo (double scans, glitches) and above hi (stops) are eliminated
  const head = ['S.No.', 'Line', 'Model', 'Model code', 'Company', 'Qty (pcs)', `Eliminated < ${lo} s`, `Eliminated > ${hi} s`, `Qty after <${lo} s & >${hi} s eliminated`, 'Max achieved CT (in %)', 'Method A cycle (s)', 'Method B cycle (s)', 'B − A (s)', 'Avg cycle (s)', 'Avg − A (s)'];
  const W = [6, 9, 24, 11, 13, 11, 11, 11, 15, 13, 12, 12, 9, 11, 10];
  const lc = colName(head.length - 1);
  const mk = (name, list) => {
    const sheet = [
      [{ v: `Cycle time summary — ${name} · ${lineText} · ${range.start} to ${range.end}`, s: 'title' }],
      [{ v: `Valid scans = gaps ${lo}–${hi} s (below ${lo} s and above ${hi} s eliminated) · Method A and Avg on the valid scans · Method B: ${opts.pctB} % CT contribution of the same valid scans · Max achieved CT % = valid scans at the Method A second or faster`, s: 'subtitle' }],
      [null, null, null, null, null, null, { v: `Valid scan rule: ${lo}–${hi} s`, s: 'head' }, { v: null, s: 'head' }, { v: null, s: 'head' }, { v: `<${lo} & >${hi} sec eliminated`, s: 'head' }, { v: null, s: 'head' }, { v: `As per NNP Sir · ${opts.pctB}% CT Contribution`, s: 'head' }, { v: null, s: 'head' }, { v: `<${lo} & >${hi} sec eliminated`, s: 'head' }, { v: null, s: 'head' }],
      head.map((h) => ({ v: h, s: 'head' })),
    ];
    const first = sheet.length + 1;
    list.forEach((r, i) => {
      const n = first + i, z = (st) => (i % 2 ? zebra(st) : st);
      const a = r.A.sec, b = r.B.sec, avg = r1(r.avg);
      sheet.push([
        { v: i + 1, s: z('center') }, { v: `Line ${r.line}`, s: z('text') }, { v: r.model, s: z('textBold') }, { v: r.modelCode || '', s: z('center') }, { v: r.company || '', s: z('text') },
        { v: r.qty, s: z('int') }, { v: r.belowLow ?? null, s: z('int') }, { v: r.aboveCap ?? null, s: z('int') }, { v: r.A.kept ?? null, s: z('int') }, { v: r1(r.A.share), s: z('dec1') }, { v: a, s: 'intA' }, { v: b, s: z('int') },
        { f: `L${n}-K${n}`, v: b - a, s: z('dec1') }, { v: avg, s: z('dec1') }, { f: `N${n}-K${n}`, v: avg != null ? Math.round((avg - a) * 10) / 10 : null, s: z('dec1') },
      ]);
    });
    if (!list.length) sheet.push([{ v: `No ${name} model with enough scans in this period.`, s: 'note' }]);
    const last = first + list.length - 1;
    const sum = (k) => list.reduce((x, r) => x + (k(r) || 0), 0);
    if (list.length) sheet.push([{ v: 'Total', s: 'totalLabel' }, { v: null, s: 'totalLabel' }, { v: null, s: 'totalLabel' }, { v: null, s: 'totalLabel' }, { v: null, s: 'totalLabel' },
      { f: `SUM(F${first}:F${last})`, v: sum((r) => r.qty), s: 'totalInt' }, { f: `SUM(G${first}:G${last})`, v: sum((r) => r.belowLow), s: 'totalInt' }, { f: `SUM(H${first}:H${last})`, v: sum((r) => r.aboveCap), s: 'totalInt' }, { f: `SUM(I${first}:I${last})`, v: sum((r) => r.A.kept), s: 'totalInt' }]);
    return {
      name, cols: W.map((w) => ({ width: w })), rows: sheet,
      merges: [`A1:${lc}1`, `A2:${lc}2`, 'G3:I3', 'J3:K3', 'L3:M3', 'N3:O3', ...(list.length ? [`A${last + 1}:E${last + 1}`] : [])], freezeRow: 4, headerRow: 4,
      autoFilter: list.length ? `A4:${lc}${last}` : null, rowHeights: { 1: 22, 3: 20, 4: 32 },
    };
  };
  // one sheet per company (Samsung, Voltas, Godrej, Remaining), each biggest quantity first
  let sheets;
  if (!sel) {
    sheets = ['Samsung', 'Voltas', 'Godrej', 'Remaining'].map((name) => mk(name, all.filter((r) => coSheetOf(r.company) === name)));
  } else {
    const keep = new Set(sel.companies || []);
    const chosen = all.filter((r) => keep.has(ctCompany(r.company)));
    const groups = new Map();
    for (const r of chosen) {
      const big = coSheetOf(r.company);
      const name = big !== 'Remaining' ? big : sel.groupOthers ? 'Remaining' : sheetName(title(ctCompany(r.company)));
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    }
    const order = (n) => (['Samsung', 'Voltas', 'Godrej'].indexOf(n) + 1 || (n === 'Remaining' ? 90 : 50));
    sheets = [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0]) || b[1].reduce((x, r) => x + r.qty, 0) - a[1].reduce((x, r) => x + r.qty, 0)).map(([n, l]) => mk(n, l));
    if (!sheets.length) sheets = [mk('No customer', [])];
  }
  downloadXlsx(buildXlsx(sheets), `CT_summary_${lineText.replace(/\s+/g, '')}_${range.start}_to_${range.end}.xlsx`);
}

/** Model analysis rows (ach, achShare, bSec, cSec …) → the rows exportCycleSummary expects. */
export const fromModelRows = (rows, line) => rows.filter((r) => r.ach != null && r.bSec != null).map((r) => ({
  line: r.line || line, model: r.model, modelCode: r.modelCode, company: r.company, qty: r.qty,
  A: { sec: r.ach, share: r.achShare, kept: r.aValid ?? r.valid }, B: { sec: r.bSec }, avg: r.cSec, belowLow: r.belowLow ?? null, aboveCap: r.aboveCap ?? null,
}));
