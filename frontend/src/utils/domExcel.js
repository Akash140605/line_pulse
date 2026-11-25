/**
 * Excel of what a details panel shows (19-11-2026): every table on it becomes a sheet (head rows, merged headings,
 * numbers as numbers, % as %), and the A · P · Q boxes (or any label / value rows) go on a first "Summary" sheet.
 * Used by the Excel button of every drawer (MesDrawer), so each sidebar / details window can be taken to Excel.
 */
import { buildXlsx, downloadXlsx } from './xlsxWriter';

const clean = (s) => String(s ?? '').replace(/[›‹✓▶]/g, '').replace(/\s+/g, ' ').trim();
/** a cell's text as Excel value: 1,234 → 1234 · 96.7% → 0.967 (percent) · anything else stays text */
export function cellValue(t) {
  const s = clean(t);
  if (s === '' || s === '—' || s === '-' || s === '·') return { v: '', s: 'text' };
  const pct = s.match(/^([+−-]?\d[\d,]*(?:\.\d+)?)\s*%$/);
  if (pct) return { v: Number(pct[1].replace(/,/g, '').replace('−', '-')) / 100, s: 'hprPct' };
  const num = s.match(/^[+−-]?\d[\d,]*(?:\.\d+)?$/);
  if (num) { const n = Number(s.replace(/,/g, '').replace('−', '-')); return { v: n, s: Number.isInteger(n) ? 'int' : 'dec1' }; }
  return { v: s, s: 'text' };
}

/** rows of a <table> with colspan / rowspan laid out on a grid; head rows styled as headings */
export function tableRows(table) {
  const out = [], merges = [], taken = new Map();
  const trs = [...table.querySelectorAll('tr')];
  trs.forEach((tr, r) => {
    const head = !!tr.closest('thead') || [...tr.children].every((c) => c.tagName === 'TH');
    const row = out[r] || (out[r] = []);
    let c = 0;
    for (const td of tr.children) {
      while (taken.get(`${r}|${c}`)) c += 1;
      const cs = Math.max(1, Number(td.getAttribute('colspan')) || 1), rs = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
      const txt = td.innerText ?? td.textContent;
      const val = head ? { v: clean(txt), s: 'head' } : cellValue(txt);
      row[c] = val;
      for (let i = 0; i < rs; i += 1) for (let j = 0; j < cs; j += 1) if (i || j) { taken.set(`${r + i}|${c + j}`, true); (out[r + i] || (out[r + i] = []))[c + j] = { v: '', s: head ? 'head' : 'text' }; }
      if (cs > 1 || rs > 1) merges.push([r, c, r + rs - 1, c + cs - 1]);
      c += cs;
    }
  });
  return { rows: out.map((r) => r || []), merges, headRows: trs.filter((tr) => !!tr.closest('thead')).length };
}

const colL = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const sheetName = (n, used) => {
  let s = clean(n).replace(/[[\]:*?/\\]/g, ' ').slice(0, 28) || 'Sheet';
  let k = s, i = 2; while (used.has(k.toLowerCase())) { k = `${s.slice(0, 26)} ${i}`; i += 1; }
  used.add(k.toLowerCase()); return k;
};
/** the name of a table: its aria-label, else the nearest heading before it */
function tableTitle(t) {
  if (t.getAttribute('aria-label')) return t.getAttribute('aria-label');
  let n = t;
  for (let k = 0; k < 6 && n; k += 1) { const h = n.parentElement?.querySelector('h2, h3, h4, [role="heading"]'); if (h && h.compareDocumentPosition(t) & 4) return h.innerText; n = n.parentElement; }
  return 'Table';
}

/** Workbook of a panel: [{ name, rows, merges, cols }] */
export function panelSheets(root, title = '', sub = '') {
  const used = new Set(), sheets = [];
  // summary: title, period, and label → value rows (A · P · Q boxes, small tiles)
  const sum = [[{ v: clean(title), s: 'title' }], ...(sub ? [[{ v: clean(sub), s: 'subtitle' }]] : []), []];
  for (const f of root.querySelectorAll('.lp-fac')) {
    const name = f.querySelector('button, span'); const big = f.querySelector('.lp-fac-val, .tabular-nums');
    sum.push([{ v: clean(name?.innerText).replace(/›/g, ''), s: 'textBold' }, big ? cellValue(big.innerText) : { v: '' }]);
    for (const row of f.querySelectorAll('div')) {
      const k = [...row.children];
      if (k.length === 2 && k.every((x) => x.tagName === 'SPAN') && !row.querySelector('div')) sum.push([{ v: clean(k[0].innerText), s: 'text' }, cellValue(k[1].innerText)]);
    }
    sum.push([]);
  }
  const g = root.querySelector('[aria-label^="OLE"][role="img"], svg[aria-label*="OLE"]');
  if (g) sum.splice(3, 0, [{ v: 'OLE', s: 'textBold' }, cellValue((g.getAttribute('aria-label') || '').replace(/^.*OLE\s*/, ''))], []);
  sheets.push({ name: sheetName('Summary', used), rows: sum, cols: [{ width: 28 }, { width: 16 }] });
  for (const t of root.querySelectorAll('table')) {
    if (!t.querySelector('td, th')) continue;
    const { rows, merges, headRows } = tableRows(t);
    const width = Math.max(...rows.map((r) => r.length), 1);
    const cols = Array.from({ length: width }, (_, i) => ({ width: Math.min(40, Math.max(9, ...rows.map((r) => String(r[i]?.v ?? '').length + 2))) }));
    sheets.push({ name: sheetName(tableTitle(t), used), rows, cols, freezeRow: headRows || undefined, merges: merges.map(([r1, c1, r2, c2]) => `${colL(c1)}${r1 + 1}:${colL(c2)}${r2 + 1}`) });
  }
  return sheets;
}

/** Save the panel as an .xlsx named after its title. */
export function exportPanel(root, title = 'Details', sub = '') {
  if (!root) return;
  const sheets = panelSheets(root, title, sub);
  const name = `${clean(title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Details'}.xlsx`;
  downloadXlsx(buildXlsx(sheets), name);
}
