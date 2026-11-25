/**
 * Standard cycle time "All models" report: the same content for the Excel download and the printed page.
 * Both show the line, period, generation date and the calculation settings above a bordered table.
 */
import { buildXlsx, downloadXlsx, colName, zebra } from './xlsxWriter';

const pad = (n) => String(n).padStart(2, '0');
/** 2026-10-23 → */
export const dmy = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : String(s || '—'));
export const dmyTime = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

/** Table columns: [header, width (Excel chars), value(row), excel style, print class] */
export const REPORT_COLUMNS = [
  ['#', 5, (r, i) => i + 1, 'center', 'c'],
  ['Model', 24, (r) => r.model, 'textBold', 'b'],
  ['Model code', 10, (r) => r.code || '', 'center', 'c'],
  ['Company', 16, (r) => r.company || '', 'text', ''],
  ['Weight (kg)', 9, (r) => r.kg ?? null, 'dec1', 'n'],
  ['Weight source', 11, (r) => r.kgLabel || 'not set', 'center', 'c'],
  ['Valid cycles', 10, (r) => r.n ?? null, 'int', 'n'],
  ['Standard A (s)', 10, (r) => r1(r.aStd), 'valueA', 'n a'],
  ['Median A (s)', 9, (r) => r1(r.aMed), 'dec1', 'n'],
  ['Std dev A (s)', 9, (r) => r1(r.aSd), 'dec1', 'n'],
  ['Standard B (s)', 10, (r) => r1(r.bStd), 'valueB', 'n bb'],
  ['Valid runs B', 8, (r) => r.bRuns ?? null, 'int', 'n'],
  ['Runs found B', 8, (r) => r.bTotal ?? null, 'int', 'n'],
  ['B vs A (%)', 9, (r) => r1(r.diff), 'signed1', 'n'],
];

/** Lines of information shown above the table (label, value). */
export function reportMeta(meta) {
  const s = meta.settings;
  return [
    ['Line', meta.lineLabel],
    ['Period', `${dmy(meta.start)} to ${dmy(meta.end)}`],
    ['Generated', dmyTime(meta.generatedAt)],
    ['Models in report', String(meta.count)],
    ['Method A window', `${s.minSec} – ${s.maxSec} s (gaps outside are ignored)`],
    ['Method B runs', meta.bDone
      ? `≥ ${s.minPieces} pcs per run · ≤ ${s.maxRework} rework pcs · run breaks at a stop > ${s.breakSec} s`
      : 'not computed (press "Compute Method B" before export)'],
    ...(meta.query ? [['Filter', `"${meta.query}"`]] : []),
  ];
}

const NOTES = [
  'Method A = mean of all scan gaps inside the [min, max] window, for the whole period.',
  'Method B = mean of gaps inside the window with no rework next to them, over continuous runs with enough pieces.',
  'B vs A (%) = (B − A) ÷ A × 100. Weight source: list = written in the master-list item name · confirmed = confirmed by the production team · from code / series = read from the model code · manual = entered on the page.',
];

/** Excel download with borders, header colours, frozen header and print setup. */
export function exportReportXlsx(rows, meta, chartRows) {
  const W = REPORT_COLUMNS.length;
  const lastCol = colName(W - 1);
  const title = `Dixon Technologies — Standard Cycle Time Report`;
  const sub = `${meta.lineLabel} · All models · Method A (window average) and Method B (continuous runs)`;
  const sheetRows = [];
  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`];
  sheetRows.push([{ v: title, s: 'title' }]);
  sheetRows.push([{ v: sub, s: 'subtitle' }]);
  // meta block: label in A:B, value in C:last
  for (const [label, value] of reportMeta(meta)) {
    const r = sheetRows.length + 1;
    const row = [{ v: label, s: 'metaLabel' }, { v: null, s: 'metaLabel' }, { v: value, s: 'metaValue' }];
    for (let i = 3; i < W; i++) row.push({ v: null, s: 'metaValue' });
    sheetRows.push(row);
    merges.push(`A${r}:B${r}`, `C${r}:${lastCol}${r}`);
  }
  sheetRows.push([]);
  const headerRow = sheetRows.length + 1;
  sheetRows.push(REPORT_COLUMNS.map(([h]) => ({ v: h, s: 'head' })));
  rows.forEach((r, i) => {
    const shade = i % 2 === 1;
    sheetRows.push(REPORT_COLUMNS.map(([, , get, style]) => ({ v: get(r, i), s: shade ? zebra(style) : style })));
  });
  const lastDataRow = sheetRows.length;
  // summary row
  const aIdx = REPORT_COLUMNS.findIndex(([h]) => h === 'Standard A (s)');
  const sumRow = sheetRows.length + 1;
  const totalRow = REPORT_COLUMNS.map((_, i) => ({ v: null, s: i < aIdx ? 'totalLabel' : 'totalValue' }));
  totalRow[0] = { v: 'Mean of model Method A values (unweighted)', s: 'totalLabel' };
  totalRow[aIdx] = { v: r1(meta.overallA), s: 'totalValue' };
  sheetRows.push(totalRow);
  merges.push(`A${sumRow}:${colName(aIdx - 1)}${sumRow}`);
  sheetRows.push([]);
  for (const n of NOTES) {
    const r = sheetRows.length + 1;
    sheetRows.push([{ v: n, s: 'note' }]);
    merges.push(`A${r}:${lastCol}${r}`);
  }

  const footer = `&L&8Dixon Technologies · Standard cycle time · ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}&C&8Generated ${dmyTime(meta.generatedAt)}&R&8Page &P of &N`;
  const main = {
    name: 'Standard cycle time',
    title,
    cols: REPORT_COLUMNS.map(([, w]) => ({ width: w })),
    rows: sheetRows,
    merges,
    freezeRow: headerRow,
    headerRow,
    autoFilter: rows.length ? `A${headerRow}:${lastCol}${lastDataRow}` : null,
    rowHeights: { 1: 24, [headerRow]: 30 },
    footer,
  };

  const chart = {
    name: 'Chart data',
    cols: [{ width: 5 }, { width: 36 }, { width: 14 }, { width: 14 }],
    rows: [
      [{ v: `Standard cycle by model — ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)}`, s: 'subtitle' }],
      [],
      ['#', 'Model', 'Standard A (s)', 'Standard B (s)'].map((h) => ({ v: h, s: 'head' })),
      ...chartRows.map((c, i) => [
        { v: i + 1, s: i % 2 ? zebra('center') : 'center' },
        { v: c.name, s: i % 2 ? zebra('textBold') : 'textBold' },
        { v: c.aStd, s: i % 2 ? zebra('valueA') : 'valueA' },
        { v: c.bStd ?? null, s: i % 2 ? zebra('valueB') : 'valueB' },
      ]),
    ],
    merges: ['A1:D1'],
    freezeRow: 3,
    headerRow: 3,
    portrait: true,
    footer: `&L&8Dixon Technologies · ${meta.lineLabel}&R&8Page &P of &N`,
  };

  const bytes = buildXlsx([main, chart]);
  const lineTag = String(meta.lineLabel).replace(/\s+/g, '');
  downloadXlsx(bytes, `StdCycle_${lineTag}_${meta.start}_to_${meta.end}.xlsx`);
  return bytes;
}

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (v, style) => {
  if (v == null || v === '') return '—';
  if (typeof v !== 'number') return h(v);
  if (style === 'int' || style === 'center') return v.toLocaleString('en-IN');
  if (style === 'signed1') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  return v.toFixed(1);
};

/** Full HTML document for printing (A4 landscape, bordered table, header repeated on each page, page numbers). */
export function reportHtml(rows, meta) {
  const metaRows = reportMeta(meta).map(([l, v]) => `<tr><th>${h(l)}</th><td>${h(v)}</td></tr>`).join('');
  const head = REPORT_COLUMNS.map(([t]) => `<th>${h(t)}</th>`).join('');
  const body = rows.map((r, i) => `<tr>${REPORT_COLUMNS.map(([, , get, style, cls]) => `<td class="${cls}">${fmt(get(r, i), style)}</td>`).join('')}</tr>`).join('');
  const aIdx = REPORT_COLUMNS.findIndex(([t]) => t === 'Standard A (s)');
  const foot = `<tr class="tot"><td colspan="${aIdx}">Mean of model Method A values (unweighted)</td><td class="n a">${meta.overallA != null ? meta.overallA.toFixed(1) : '—'}</td><td colspan="${REPORT_COLUMNS.length - aIdx - 1}"></td></tr>`;
  const footerText = `Dixon Technologies · Standard cycle time · ${meta.lineLabel} · ${dmy(meta.start)} to ${dmy(meta.end)} · printed ${dmyTime(meta.generatedAt)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Standard cycle time ${h(meta.lineLabel)} ${h(meta.start)} to ${h(meta.end)}</title>
<style>
@page { size: A4 landscape; margin: 10mm 8mm 14mm 8mm;
  @bottom-left { content: "${footerText.replace(/"/g, '')}"; font: 8pt Arial, sans-serif; color: #475569; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #475569; } }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 9pt Arial, Helvetica, sans-serif; color: #0f172a; }
h1 { font-size: 15pt; margin: 0 0 2px; }
.sub { font-size: 10pt; font-weight: bold; color: #1e3a8a; margin: 0 0 6px; }
table { border-collapse: collapse; width: 100%; }
.meta { width: auto; margin-bottom: 8px; }
.meta th, .meta td { border: 1px solid #64748b; padding: 3px 8px; text-align: left; font-size: 9pt; }
.meta th { background: #e2e8f0; white-space: nowrap; }
.grid th, .grid td { border: 1px solid #475569; padding: 3px 5px; }
.grid thead th { background: #1e3a8a; color: #fff; font-size: 8.5pt; text-align: center; vertical-align: middle; }
.grid thead { display: table-header-group; }
.grid tfoot { display: table-row-group; }
.grid tr { page-break-inside: avoid; break-inside: avoid; }
.grid tbody tr:nth-child(even) td { background: #f1f5f9; }
.grid td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.grid td.c { text-align: center; white-space: nowrap; }
.grid td.b { font-weight: bold; white-space: nowrap; }
.grid td.a { background: #ccfbf1 !important; font-weight: bold; }
.grid td.bb { background: #ede9fe !important; font-weight: bold; }
.grid tr.tot td { background: #e2e8f0; font-weight: bold; text-align: right; }
.notes { margin-top: 8px; font-size: 8pt; color: #475569; }
.notes p { margin: 1px 0; }
</style></head><body>
<h1>Dixon Technologies — Standard Cycle Time Report</h1>
<p class="sub">${h(meta.lineLabel)} · All models · Method A (window average) and Method B (continuous runs)</p>
<table class="meta"><tbody>${metaRows}</tbody></table>
<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${REPORT_COLUMNS.length}" class="c">No models</td></tr>`}</tbody><tfoot>${foot}</tfoot></table>
<div class="notes">${NOTES.map((n) => `<p>${h(n)}</p>`).join('')}</div>
</body></html>`;
}

/** Print through a hidden frame, so only the report is printed (no menus, no scroll box cut-off). */
export function printReport(rows, meta) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(reportHtml(rows, meta)); doc.close();
  let removed = false;
  const cleanup = () => { if (!removed) { removed = true; frame.remove(); } };
  const go = () => {
    frame.contentWindow.addEventListener('afterprint', () => setTimeout(cleanup, 100));
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(cleanup, 120000); // safety net if the browser never fires afterprint
  };
  // give the browser a moment to lay out the table before the print dialog opens
  if (doc.readyState === 'complete') setTimeout(go, 150); else frame.onload = () => setTimeout(go, 150);
}
