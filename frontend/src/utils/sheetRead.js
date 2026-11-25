/**
 * Reads the first sheet of an .xlsx file, a .csv file or cells pasted from Excel into rows of text (no library:
 * the .xlsx zip is opened with the browser's own DecompressionStream). Used by the model master import;
 * readWorkbook (every sheet) by Report compare.
 */

import { BUILTIN } from './xlsxFormat';

/** "a,b,"c, d"\n…" or tab-separated text (pasted from Excel) → [[cells]] */
export function parseDelimited(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const sep = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

/* ── minimal zip reader (central directory → entries; deflate via DecompressionStream) ── */
async function unzip(buf) {
  const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an .xlsx file');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    files[name] = { method, size, off };
    p += 46 + nl + xl + cl;
  }
  const read = async (name) => {
    const f = files[name]; if (!f) return null;
    const ln = dv.getUint16(f.off + 26, true), lx = dv.getUint16(f.off + 28, true);
    const data = u8.subarray(f.off + 30 + ln + lx, f.off + 30 + ln + lx + f.size);
    if (f.method === 0) return dec.decode(data);
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx — save the sheet as .csv or paste the cells');
    const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(s).text();
  };
  return { files, read };
}

// text of an XML node; character references too (openpyxl and other tools write "—" as &#8212;) — &amp; last, so "&amp;#38;" stays "&#38;"
const charRef = (m, n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m);
export const xmlText = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (m, d) => charRef(m, Number(d))).replace(/&#x([0-9a-f]+);/gi, (m, h) => charRef(m, parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; for (const ch of m ? m[1] : 'A') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/**
 * the number format of every cell style (styles.xml: cellXfs → numFmtId → a custom formatCode or a built-in one):
 * [code by style index], '' for General — the preview shows a cell as Excel shows it (utils/xlsxFormat.js)
 */
async function formatsOf(z) {
  const xml = (await z.read('xl/styles.xml')) || '';
  const custom = {};
  for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const id = /\bnumFmtId="(\d+)"/.exec(m[1])?.[1]; const code = /\bformatCode="([^"]*)"/.exec(m[1])?.[1];
    if (id != null && code != null) custom[id] = xmlText(code);
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] || '';
  return [...xfs.matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => { const id = /\bnumFmtId="(\d+)"/.exec(m[1])?.[1] || '0'; return custom[id] ?? BUILTIN[id] ?? ''; });
}

async function sharedOf(z) {
  const shared = [];
  const ss = await z.read('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText((m[1].match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join('')));
  return shared;
}

/**
 * rows of one sheet's XML: [[cells]], every row carrying its sheet row number as `.n` (text; numbers as written);
 * with the style formats (formatsOf), a row whose cells have a number format also carries `.s` = [style index by column]
 */
function sheetRows(xml, shared, formats = null) {
  const rows = [];
  let auto = 0;
  for (const rm of String(xml || '').matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row = []; let st = null;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const inner = cm[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]; const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      if (formats) { const si = Number(/\bs="(\d+)"/.exec(attrs)?.[1] || 0); if (si && formats[si]) (st = st || [])[ref ? colIdx(ref) : row.length] = si; }
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = xmlText((inner.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join(''));
      else val = v != null ? xmlText(v) : '';
      row[ref ? colIdx(ref) : row.length] = String(val).trim();
    }
    const out = Array.from(row, (x) => x ?? '');
    const n = Number(/\br="(\d+)"/.exec(rm[1])?.[1]); auto = n > 0 ? n : auto + 1;
    out.n = auto;
    if (st) out.s = st;
    rows.push(out);
  }
  return rows.filter((r) => r.some((x) => x !== ''));
}

/** First sheet of an .xlsx → [[cells]] (text; numbers as written) */
export async function readXlsx(buf) {
  const z = await unzip(buf);
  const shared = await sharedOf(z);
  const sheetName = Object.keys(z.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/g).pop()) - Number(b.match(/\d+/g).pop()))[0];
  if (!sheetName) throw new Error('No sheet found in the file');
  return sheetRows(await z.read(sheetName), shared);
}

/**
 * 20-11-2026: every sheet of an .xlsx, in the workbook's order:
 * [{ name, hidden, rows: [[cells]] (row number as .n, style of the formatted cells as .s), formats, date1904 }].
 * Report compare reads the plant's reports (several sheets) with it; its preview shows the cells with their formats.
 */
export async function readWorkbook(buf) {
  const z = await unzip(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const shared = await sharedOf(z);
  const formats = await formatsOf(z);
  const wb = (await z.read('xl/workbook.xml')) || '';
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wb);
  const rels = (await z.read('xl/_rels/workbook.xml.rels')) || '';
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1]; const t = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && t) target[id] = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
  }
  const list = [...wb.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => ({
    name: xmlText(/\bname="([^"]*)"/.exec(m[1])?.[1] || ''),
    hidden: /\bstate="(hidden|veryHidden)"/.test(m[1]),
    file: target[/\b[\w]+:id="([^"]+)"/.exec(m[1])?.[1]] || null,
  }));
  const files = list.length ? list : Object.keys(z.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).map((f) => ({ name: f.match(/sheet(\d+)/)[1], hidden: false, file: f }));
  const out = [];
  for (const s of files) {
    if (!s.file || !z.files[s.file]) continue;
    out.push({ name: s.name, hidden: s.hidden, rows: sheetRows(await z.read(s.file), shared, formats), formats, date1904 });
  }
  if (!out.length) throw new Error('No sheet found in the file');
  return out;
}

/** a cell as a date 'YYYY-MM-DD': Excel day number (45931), '2026-10-01', '01-10-2026', '01/10/2026', '1-Oct-26' — else null */
export function cellDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n < 30000 || n > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]*(\d{2,4})$/.exec(s);
  if (m) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
    if (mo >= 0) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  }
  return null;
}

/** File (.xlsx / .csv / .txt) → [[cells]] */
export async function readSheetFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.xlsx')) return readXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error('Old .xls files cannot be read — save it as .xlsx or .csv');
  return parseDelimited(await file.text());
}
