/**
 * 23-11-2026: two production reports in the plant's own paper / Excel layouts.
 *
 * 1. Daily production report (the line's paper sheet): per line and day — Sr. No., Customer, Model, Plan QTY,
 *    Starting Sr. Number, Ending Sr. Number, Total production, Remarks. The serial numbers come from the good scans
 *    (ScanStatus.ProductBarcode, api serials.php, read only). A model whose serials jump (another batch / another order)
 *    gets one row per run, as the paper does (10540–10550 and 12501–12889); the model total goes in Remarks.
 *    Plan QTY is not in the scans: a yellow cell to fill.
 *
 * 2. Customer wise production (the plant's "Customer_wise_production" workbook): Summary — customer × date, Total,
 *    Plan, Backlog, Bal. to Produce, and the lines' day totals under it — and one sheet per customer: model × date.
 *    Plan and Backlog are yellow cells to fill; Bal. to Produce = Plan + Backlog − Total (formula).
 *
 * Pure functions: data in, rows / xlsx sheets (utils/xlsxWriter buildXlsx) out.
 */
import { colName } from './xlsxWriter';

const dmy = (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Excel day number of 'YYYY-MM-DD' (1900 system) */
export const excelDay = (d) => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
export function daysOf(from, to) {
  const out = []; const t = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  while (t <= end && out.length < 400) { out.push(t.toISOString().slice(0, 10)); t.setUTCDate(t.getUTCDate() + 1); }
  return out;
}
const tidy = (s) => String(s ?? '').trim();
const coName = (s) => tidy(s).replace(/\s+/g, ' ').toUpperCase() || 'NOT SET';

// ── 1. daily production report ─────────────────────────────────────────────────

/** 'AB12C0010540' → { pre: 'AB12C', num: 10540, len: 7 } (the trailing digits); null when it has none */
export function splitSerial(s) {
  const m = /^(.*?)(\d+)$/.exec(tidy(s));
  if (!m) return null;
  return { pre: m[1], num: Number(m[2]), len: m[2].length };
}

/**
 * Serial runs of one model's scans: sorted by serial, a new run when the text before the number changes or the
 * number jumps by more than `gap` (pieces taken out for rework keep a run whole). qty = pieces scanned in the run.
 * Serials without a number: one run, first and last by scan time.
 */
export function serialRuns(rows, gap = 50) {
  const seen = new Set(); const num = []; const odd = [];
  for (const r of rows) {
    const s = tidy(r.serial);
    if (!s) { odd.push(r); continue; }
    if (seen.has(s)) continue;   // a serial scanned twice is one piece
    seen.add(s);
    const p = splitSerial(s);
    if (p) num.push({ ...p, s }); else odd.push(r);
  }
  num.sort((a, b) => (a.pre === b.pre ? a.num - b.num : a.pre.localeCompare(b.pre)));
  const runs = [];
  for (const x of num) {
    const last = runs[runs.length - 1];
    if (last && last.pre === x.pre && x.num - last.endNum <= gap) { last.end = x.s; last.endNum = x.num; last.qty += 1; }
    else runs.push({ pre: x.pre, start: x.s, end: x.s, startNum: x.num, endNum: x.num, qty: 1 });
  }
  if (odd.length) {
    const t = [...odd].sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id - b.id);
    runs.push({ pre: '', start: tidy(t[0].serial) || '—', end: tidy(t[t.length - 1].serial) || '—', qty: odd.length, noNumber: true });
  }
  return runs.map(({ start, end, qty, noNumber }) => ({ start, end, qty, ...(noNumber ? { noNumber: true } : {}) }));
}

/**
 * S = { 'YYYY-MM-DD|line': [serial rows] } → [{ date, line, models: [{ sr, company, model, total, runs }], total }]
 * models in the order they were first made that day.
 */
export function dprData(S, { from, to, ids = [] }) {
  const out = [];
  for (const date of daysOf(from, to)) {
    for (const line of ids) {
      const rows = S?.[`${date}|${line}`];
      if (!Array.isArray(rows) || !rows.length) continue;
      const by = new Map();
      for (const r of [...rows].sort((a, b) => a.id - b.id)) {
        const k = tidy(r.model) || `#${r.mmId}`;
        const o = by.get(k) || { company: coName(r.company), model: k, list: [] };
        o.list.push(r); by.set(k, o);
      }
      const models = [...by.values()].map((m, i) => {
        const runs = serialRuns(m.list);
        const total = runs.reduce((a, x) => a + x.qty, 0);
        // 24-11-2026: a serial scanned again is one piece here; the production screens count every good scan — said on the sheet
        return { sr: i + 1, company: m.company, model: m.model, runs, total, scans: m.list.length, repeat: Math.max(0, m.list.length - total) };
      });
      out.push({ date, line: String(line), models, total: models.reduce((a, m) => a + m.total, 0), scans: rows.length, repeat: models.reduce((a, m) => a + m.repeat, 0) });
    }
  }
  return out;
}

/** the table on the screen: one row per serial run */
export const dprRows = (data) => (data || []).flatMap((d) => d.models.flatMap((m) => m.runs.map((r, i) => ({
  date: d.date, line: d.line, sr: i ? null : m.sr, company: i ? '' : m.company, model: i ? '' : m.model,
  start: r.start, end: r.end, qty: r.qty, modelTotal: i || m.runs.length === 1 ? null : m.total,
}))));

/** one sheet per line and day, the paper layout */
export function dprSheets(data) {
  const used = new Set();
  return (data || []).map((d) => {
    let name = `L${d.line} ${d.date.slice(8, 10)}-${d.date.slice(5, 7)}`;
    for (let k = 2; used.has(name); k += 1) name = `L${d.line} ${d.date.slice(8, 10)}-${d.date.slice(5, 7)} (${k})`;
    used.add(name);
    const rows = []; const merges = [];
    const blank = (n) => Array(n).fill({ v: '', s: 'hprText' });
    rows.push([{ v: 'Daily Production Report', s: 'hprTitle' }]);
    rows.push([{ v: `Line- ${d.line}`, s: 'hprTextB' }, { v: '', s: 'hprTextB' }, { v: '', s: 'hprTextB' }, { v: '', s: 'hprTextB' }, { v: '', s: 'hprTextB' }, { v: 'Date :', s: 'hprTextB' }, { v: excelDay(d.date), s: 'hprDateB' }, { v: '', s: 'hprTextB' }]);
    merges.push('A1:H1', 'A2:E2');
    const HEAD = ['Sr. No.', 'Customer', 'Model', 'Plan QTY.', 'Starting Sr. Number', 'Ending Sr. Number', 'Total production', 'Remarks'];
    rows.push(HEAD.map((v) => ({ v, s: 'hprHead' })));
    const first = rows.length + 1;
    for (const m of d.models) {
      const a = rows.length + 1;
      m.runs.forEach((r, i) => {
        rows.push([
          i ? { v: '', s: 'hprCenter' } : { v: m.sr, s: 'hprInt' },
          i ? { v: '', s: 'hprText' } : { v: m.company, s: 'hprText' },
          i ? { v: '', s: 'hprText' } : { v: m.model, s: 'hprTextB' },
          i ? { v: '', s: 'hprInput' } : { v: '', s: 'hprInput' },
          { v: r.start, s: 'hprCenter' }, { v: r.end, s: 'hprCenter' }, { v: r.qty, s: 'hprInt' },
          { v: '', s: 'hprText' },
        ]);
      });
      const z = rows.length;
      if (z > a) {
        for (const c of ['A', 'B', 'C', 'D', 'H']) merges.push(`${c}${a}:${c}${z}`);
        rows[a - 1][7] = { f: `SUM(G${a}:G${z})`, v: m.total, s: 'hprIntB' };   // the model total, as written on the paper
      }
    }
    const last = rows.length;
    rows.push([{ v: '', s: 'hprText' }, { v: 'Total Qty.', s: 'hprTotal' }, ...blank(4).map(() => ({ v: '', s: 'hprTotal' })), last >= first ? { f: `SUM(G${first}:G${last})`, v: d.total, s: 'hprTotal' } : { v: 0, s: 'hprTotal' }, { v: '', s: 'hprTotal' }]);
    merges.push(`B${rows.length}:F${rows.length}`);
    if (d.repeat > 0) {
      const who = d.models.filter((m) => m.repeat > 0).map((m) => `${m.model} ${m.repeat}`).join(', ');
      rows.push([{ v: '', s: 'hprNote' }, { v: `Good scans on the line: ${d.scans} — ${d.repeat} serial number${d.repeat > 1 ? 's were' : ' was'} scanned again and counted once here (${who}). The production screens and the HPR count every scan.`, s: 'hprNote' }]);
      merges.push(`B${rows.length}:H${rows.length}`);
    }
    rows.push([]);
    rows.push([{ v: 'Line incharge Sign.:', s: 'hprNote' }, { v: '', s: 'hprNote' }, { v: '', s: 'hprNote' }, { v: '', s: 'hprNote' }, { v: '', s: 'hprNote' }, { v: 'Quality incharge Sign.:', s: 'hprNote' }]);
    rows.push([{ v: `Pieces and serial numbers from the good scans of Line ${d.line} on ${dmy(d.date)} (Dixon Line Pulse). Yellow: fill by hand.`, s: 'hprNote' }]);
    return { name, cols: [7, 16, 24, 10, 22, 22, 12, 16].map((width) => ({ width })), rows, merges, freezeRow: 3 };
  });
}

/** 23-11-2026: the same paper layout for the printer — one A4 page per line and day (Reports → Print) */
export function dprPrintHtml(data) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = (v) => Number(v || 0).toLocaleString('en-IN');
  const pages = (data || []).map((d) => {
    const body = d.models.map((m) => m.runs.map((r, i) => `<tr>
      ${i ? '' : `<td class="c" rowspan="${m.runs.length}">${m.sr}</td><td rowspan="${m.runs.length}">${esc(m.company)}</td><td class="b" rowspan="${m.runs.length}">${esc(m.model)}</td><td class="fill" rowspan="${m.runs.length}"></td>`}
      <td class="c">${esc(r.start)}</td><td class="c">${esc(r.end)}</td><td class="c">${n(r.qty)}</td>
      ${i ? '' : `<td class="c b" rowspan="${m.runs.length}">${m.runs.length > 1 ? n(m.total) : ''}</td>`}</tr>`).join('')).join('');
    return `<section class="page">
      <h1>Daily Production Report</h1>
      <div class="meta"><span>Line- <b>${esc(d.line)}</b></span><span>Date : <b>${dmy(d.date)}</b></span></div>
      <table><thead><tr><th style="width:6%">Sr. No.</th><th style="width:13%">Customer</th><th style="width:21%">Model</th><th style="width:8%">Plan QTY.</th><th style="width:15%">Starting Sr. Number</th><th style="width:15%">Ending Sr. Number</th><th style="width:10%">Total production</th><th>Remarks</th></tr></thead>
      <tbody>${body || '<tr><td colspan="8" class="c">No serial numbers on this day</td></tr>'}
      <tr class="tot"><td></td><td colspan="5">Total Qty.</td><td class="c">${n(d.total)}</td><td></td></tr></tbody></table>${d.repeat > 0 ? `<p style="font-size:11px;margin:4px 0">Good scans on the line: ${n(d.scans)} — ${n(d.repeat)} serial number(s) scanned again, counted once here.</p>` : ''}
      <div class="sign"><span>Line incharge Sign.: ____________________</span><span>Quality incharge Sign.: ____________________</span></div>
      <p class="note">Pieces and serial numbers from the good scans of Line ${esc(d.line)} on ${dmy(d.date)} (Dixon Line Pulse). Plan QTY and remarks: fill by hand.</p>
    </section>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daily Production Report</title><style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #000; margin: 0; }
    .page { page-break-after: always; padding: 2mm; } .page:last-child { page-break-after: auto; }
    h1 { text-align: center; font-size: 18px; margin: 0 0 6px; text-decoration: underline; }
    .meta { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th, td { border: 1px solid #000; padding: 4px 4px; vertical-align: middle; } th { background: #FFFF00; font-size: 11px; }
    .c { text-align: center; } .b { font-weight: bold; } .fill { background: #FFFDE7; } tbody td { height: 22px; }
    .tot td { font-weight: bold; background: #F1F5F9; } .sign { display: flex; justify-content: space-between; margin-top: 28px; font-size: 12px; }
    .note { font-size: 9.5px; color: #555; margin-top: 10px; }
  </style></head><body>${pages}</body></html>`;
}

// ── 2. customer wise production ────────────────────────────────────────────────

/**
 * ctx = OleSource context { R, D, ids } → { dates, customers: [{ name, total, byDate, models: [{ model, total, byDate }] }],
 * lines: [{ line, total, byDate }], total }. Customers most pieces first; models most first inside.
 */
export function custData(ctx, from, to) {
  const co = new Map();
  for (const L of ctx?.D?.al?.lines || []) for (const m of L.models || []) if (m.model && m.company) co.set(m.model, m.company);
  const dates = daysOf(from, to);
  const ids = (ctx?.ids || []).map(String);
  const C = new Map(); const lines = new Map(ids.map((l) => [l, { line: l, total: 0, byDate: {} }]));
  for (const d of ctx?.R?.days || []) {
    if (d.date < from || d.date > to) continue;
    for (const l of ids) {
      for (const r of d.byLine?.[l]?.rows || []) {
        if (r.future) continue;
        for (const m of r.models || []) {
          const q = Number(m.quantity) || 0; if (!q) continue;
          const name = coName(co.get(m.model) || m.company || m.companyTitle);
          const c = C.get(name) || { name, total: 0, byDate: {}, byLine: {}, M: new Map() };
          c.byLine[l] = (c.byLine[l] || 0) + q;   // 25-11-2026: the customer's pieces line by line (Customer production page)
          const mm = c.M.get(m.model) || { model: m.model, total: 0, byDate: {} };
          mm.total += q; mm.byDate[d.date] = (mm.byDate[d.date] || 0) + q; c.M.set(m.model, mm);
          c.total += q; c.byDate[d.date] = (c.byDate[d.date] || 0) + q; C.set(name, c);
          const ln = lines.get(l); ln.total += q; ln.byDate[d.date] = (ln.byDate[d.date] || 0) + q;
        }
      }
    }
  }
  const customers = [...C.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map(({ M, ...c }) => ({ ...c, models: [...M.values()].sort((a, b) => b.total - a.total || a.model.localeCompare(b.model)) }));
  return { dates, customers, lines: [...lines.values()], total: customers.reduce((a, c) => a + c.total, 0) };
}

/** the table on the screen: one row per customer and model */
export const custRows = (data) => (data?.customers || []).flatMap((c) => c.models.map((m, i) => ({
  customer: i ? '' : c.name, custTotal: i ? null : c.total, model: m.model, total: m.total,
  days: Object.keys(m.byDate).length, best: Math.max(0, ...Object.values(m.byDate)),
})));

const sheetName = (s, used) => {
  let n = String(s).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Customer';
  if (n.toLowerCase() === 'summary') n = `${n} (c)`;
  let k = 2; const base = n;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${k++}`;
  used.add(n.toLowerCase());
  return n;
};
const q = (n) => `'${n.replace(/'/g, "''")}'`;

/** Summary + one sheet per customer, the plant's layout (totals in row 1, header in row 2) */
export function custSheets(data, { lineName = (l) => `Line-${l}` } = {}) {
  const { dates = [], customers = [], lines = [] } = data || {};
  const nD = dates.length;
  const D0 = 3;                                   // first date column (D) — index 3
  const cT = D0 + nD;                             // TOTAL
  const cP = cT + 1, cB = cT + 2, cBal = cT + 3;  // Plan, Backlog, Bal. to produce
  const L = (i) => colName(i);
  const dHead = dates.map((d) => ({ v: excelDay(d), s: 'hprHeadDate' }));
  const used = new Set(['summary']);
  const custSheetsOut = []; const custRef = [];

  for (const c of customers) {
    const name = sheetName(c.name, used);
    const rows = []; const n = c.models.length; const top = 3, bot = 2 + n;
    rows.push([{ v: '◀ Back', s: 'hprLink' }, { v: c.name, s: 'hprTotal' }, { f: n ? `SUM(C${top}:C${bot})` : '0', v: c.total, s: 'hprTotal' },
      ...dates.map((d, i) => ({ f: n ? `SUM(${L(D0 + i)}${top}:${L(D0 + i)}${bot})` : '0', v: c.byDate[d] || 0, s: 'hprTotal' })),
      { f: n ? `SUM(${L(cT)}${top}:${L(cT)}${bot})` : '0', v: c.total, s: 'hprTotal' },
      { f: n ? `SUM(${L(cP)}${top}:${L(cP)}${bot})` : '0', v: 0, s: 'hprTotal' }, { f: n ? `SUM(${L(cB)}${top}:${L(cB)}${bot})` : '0', v: 0, s: 'hprTotal' },
      { f: n ? `SUM(${L(cBal)}${top}:${L(cBal)}${bot})` : '0', v: -c.total, s: 'hprTotal' }]);
    rows.push([{ v: 'Sr.No.', s: 'hprHead' }, { v: 'Model', s: 'hprHead' }, { v: 'Total', s: 'hprHead' }, ...dHead.map((x) => ({ ...x, s: 'hprHeadDate' })),
      { v: 'TOTAL', s: 'hprHead' }, { v: 'Month Plan', s: 'hprHead' }, { v: 'Back log', s: 'hprHead' }, { v: 'Bal.to Prod', s: 'hprHead' }]);
    c.models.forEach((m, i) => {
      const r = 3 + i;
      rows.push([{ v: i + 1, s: 'hprInt' }, { v: m.model, s: 'hprTextB' }, { f: `SUM(${L(D0)}${r}:${L(D0 + nD - 1)}${r})`, v: m.total, s: 'hprIntB' },
        ...dates.map((d) => ({ v: m.byDate[d] || null, s: 'hprInt' })),
        { f: `SUM(${L(D0)}${r}:${L(D0 + nD - 1)}${r})`, v: m.total, s: 'hprIntB' }, { v: null, s: 'hprInput' }, { v: null, s: 'hprInput' },
        { f: `(${L(cP)}${r}+${L(cB)}${r})-${L(cT)}${r}`, v: -m.total, s: 'hprIntB' }]);
    });
    custSheetsOut.push({ name, cols: [7, 24, 10, ...dates.map(() => 7), 10, 11, 10, 11].map((width) => ({ width })), rows, freezeRow: 2, freezeCol: 3,
      links: [{ ref: 'A1', to: "'Summery'!A1", tip: 'Back to Summery' }],
      autoFilter: n ? `A2:${L(cBal)}${bot}` : null });
    custRef.push(name);
  }

  // Summary
  const S = []; const nC = customers.length; const top = 3, bot = 2 + nC;
  S.push([{ v: 'Customer wise production', s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { f: nC ? `SUM(C${top}:C${bot})` : '0', v: data?.total || 0, s: 'hprTotal' },
    ...dates.map((d, i) => ({ f: nC ? `SUM(${L(D0 + i)}${top}:${L(D0 + i)}${bot})` : '0', v: customers.reduce((a, c) => a + (c.byDate[d] || 0), 0), s: 'hprTotal' })),
    { f: nC ? `SUM(${L(cT)}${top}:${L(cT)}${bot})` : '0', v: data?.total || 0, s: 'hprTotal' },
    { f: nC ? `SUM(${L(cP)}${top}:${L(cP)}${bot})` : '0', v: 0, s: 'hprTotal' }, { f: nC ? `SUM(${L(cB)}${top}:${L(cB)}${bot})` : '0', v: 0, s: 'hprTotal' },
    { f: nC ? `SUM(${L(cBal)}${top}:${L(cBal)}${bot})` : '0', v: -(data?.total || 0), s: 'hprTotal' }]);
  S.push([{ v: 'Sr.No', s: 'hprHead' }, { v: 'CUSTOMER', s: 'hprHead' }, { v: 'Total', s: 'hprHead' }, ...dHead.map((x) => ({ ...x, s: 'hprHeadDate' })),
    { v: 'Total', s: 'hprHead' }, { v: 'Plan', s: 'hprHead' }, { v: 'Backlog', s: 'hprHead' }, { v: 'Bal. to Produce', s: 'hprHead' }]);
  customers.forEach((c, i) => {
    const r = 3 + i; const sh = q(custRef[i]);
    // each day and the plan / backlog come from the customer's own sheet (row 1 = its totals), as the plant file does
    // 23-11-2026: the customer's name is a link to its own sheet (its models)
    S.push([{ v: i + 1, s: 'hprInt' }, { v: c.name, s: 'hprLink' }, { f: `SUM(${L(D0)}${r}:${L(D0 + nD - 1)}${r})`, v: c.total, s: 'hprIntB' },
      ...dates.map((d, k) => ({ f: `${sh}!${L(D0 + k)}1`, v: c.byDate[d] || 0, s: 'hprInt' })),
      { f: `SUM(${L(D0)}${r}:${L(D0 + nD - 1)}${r})`, v: c.total, s: 'hprIntB' },
      { f: `${sh}!${L(cP)}1`, v: 0, s: 'hprInt' }, { f: `${sh}!${L(cB)}1`, v: 0, s: 'hprInt' },
      { f: `(${L(cP)}${r}+${L(cB)}${r})-${L(cT)}${r}`, v: -c.total, s: 'hprIntB' }]);
  });
  // the lines' day totals (Avg / Total / Line …), under the customers
  S.push([]);
  const l0 = S.length + 1;
  S.push([{ v: 'Avg / day', s: 'hprHead' }, { v: 'Total', s: 'hprHead' }, { v: 'Line', s: 'hprHead' }, ...dHead.map((x) => ({ ...x, s: 'hprHeadDate' }))]);
  lines.forEach((ln, i) => {
    const r = l0 + 1 + i; const vals = dates.map((d) => ln.byDate[d] || 0); const worked = vals.filter((v) => v > 0);
    S.push([{ f: `IFERROR(AVERAGE(${L(D0)}${r}:${L(D0 + nD - 1)}${r}),0)`, v: worked.length ? ln.total / worked.length : 0, s: 'hprIntB' },
      { f: `SUM(${L(D0)}${r}:${L(D0 + nD - 1)}${r})`, v: ln.total, s: 'hprIntB' }, { v: lineName(ln.line), s: 'hprTextB' },
      ...dates.map((d) => ({ v: ln.byDate[d] || null, s: 'hprInt' }))]);
  });
  const lz = l0 + lines.length;
  S.push([{ v: '', s: 'hprTotal' }, { f: lines.length ? `SUM(B${l0 + 1}:B${lz})` : '0', v: lines.reduce((a, l) => a + l.total, 0), s: 'hprTotal' }, { v: 'Total', s: 'hprTotal' },
    ...dates.map((d, i) => ({ f: lines.length ? `SUM(${L(D0 + i)}${l0 + 1}:${L(D0 + i)}${lz})` : '0', v: lines.reduce((a, l) => a + (l.byDate[d] || 0), 0), s: 'hprTotal' }))]);
  S.push([]);
  S.push([{ v: 'Pieces from the good scans of the lines (Dixon Line Pulse). Plan and Backlog: fill on each customer\'s sheet (yellow); Bal. to Produce = Plan + Backlog − Total. AVERAGE counts the days with pieces (empty days are left out).', s: 'hprNote' }]);
  const summary = { name: 'Summery', merges: ['A1:B1'], cols: [9, 24, 10, ...dates.map(() => 7), 10, 10, 10, 13].map((width) => ({ width })), rows: S, freezeRow: 2, freezeCol: 3,
    links: customers.map((c, i) => ({ ref: `B${3 + i}`, to: `${q(custRef[i])}!A1`, tip: `Open ${c.name} — its models` })) };
  return [summary, ...custSheetsOut];
}

export const monthLabel = (d) => `${MON[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;

/* ───────────── 25-11-2026: Daily production — serial list (the plant's "Daily_Production_Lines" workbook) ───────────── */
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dMonY = (d) => (d ? `${d.slice(8, 10)}-${MON3[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}` : '');
/**
 * every good scan of the lines and days (serials.php rows), optionally one brand →
 *   { period, brand, brands, lines: [{ line, rows: [scan + date], models: [{ brand, model, qty }], total }], total }
 * Summary order as the plant file: line by line, brand A→Z, the models of a brand most made first.
 */
export function serialBook(S, { from, to, ids = [], brand = '' } = {}) {
  const period = from === to ? dMonY(from) : `${dMonY(from)} to ${dMonY(to)}`;
  const want = coName(brand || '');
  const brands = new Set();
  const lines = [];
  for (const line of ids) {
    const rows = [];
    for (const date of daysOf(from, to)) {
      for (const r of [...(S?.[`${date}|${line}`] || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id - b.id)) {
        const co = coName(r.company); brands.add(co);
        if (brand && co !== want) continue;
        rows.push({ ...r, date, company: co === 'NOT SET' ? '' : co });
      }
    }
    const by = new Map();
    for (const r of rows) { const k = `${r.company}|${tidy(r.model)}`; const o = by.get(k) || { brand: r.company, model: tidy(r.model) || `#${r.mmId}`, qty: 0 }; o.qty += 1; by.set(k, o); }
    const models = [...by.values()].sort((a, b) => a.brand.localeCompare(b.brand) || b.qty - a.qty || a.model.localeCompare(b.model));
    lines.push({ line: String(line), rows, models, total: rows.length });
  }
  return { period, brand: brand ? want : 'All brands', brands: [...brands].filter((b) => b !== 'NOT SET').sort(), lines, total: lines.reduce((a, l) => a + l.total, 0) };
}

/** the workbook: Summary (Line, Brand, Model, Quantity, Period, Brand filter + line totals) and one sheet per line with every scan */
export function serialSheets(book) {
  const H = (v) => ({ v, s: 'hprHead' });
  const sum = [[H('Line'), H('Brand'), H('Model'), H('Quantity'), H('Period'), H('Brand filter')]];
  for (const l of book.lines) {
    if (!l.total) continue;
    for (const m of l.models) sum.push([{ v: `Line ${l.line}`, s: 'hprText' }, { v: m.brand, s: 'hprText' }, { v: m.model, s: 'hprTextB' }, { v: m.qty, s: 'hprInt' }, { v: book.period, s: 'hprText' }, { v: book.brand, s: 'hprText' }]);
    sum.push([{ v: `Line ${l.line} total`, s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { v: l.total, s: 'hprTotal' }, { v: book.period, s: 'hprTotal' }, { v: '', s: 'hprTotal' }]);
  }
  sum.push([{ v: 'ALL SELECTED LINES', s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { v: '', s: 'hprTotal' }, { v: book.total, s: 'hprTotal' }, { v: book.period, s: 'hprTotal' }, { v: book.brand, s: 'hprTotal' }]);
  const sheets = [{ name: 'Summary', cols: [16, 16, 26, 11, 24, 14].map((width) => ({ width })), rows: sum, freezeRow: 1 }];
  for (const l of book.lines) {
    if (!l.total) continue;
    const head = ['SNO', 'Date', 'company', 'model', 'serial', 'carton', 'id', 'at', 'mmId', 'code', 'component'].map(H);
    const rows = [head, ...l.rows.map((r, i) => [{ v: i + 1, s: 'hprInt' }, { v: r.date, s: 'hprText' }, { v: r.company, s: 'hprText' }, { v: r.model, s: 'hprText' }, { v: r.serial, s: 'hprText' },
      { v: r.carton, s: 'hprText' }, { v: r.id, s: 'hprInt' }, { v: r.at, s: 'hprText' }, { v: r.mmId, s: 'hprInt' }, { v: r.code, s: 'hprText' }, { v: r.component, s: 'hprText' }])];
    sheets.push({ name: `Line ${l.line}`, cols: [7, 11, 13, 22, 22, 22, 10, 19, 7, 16, 18].map((width) => ({ width })), rows, freezeRow: 1, autoFilter: `A1:K${rows.length}` });
  }
  return sheets;
}
