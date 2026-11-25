/**
 * Small .xlsx writer with cell styles (borders, fills, bold, number formats), merged cells,
 * frozen header, auto-filter and print setup (landscape, fit to width, repeated header row, page numbers).
 *
 * The installed "xlsx" package (SheetJS community) cannot write styles, so this file builds the
 * Office Open XML parts directly and packs them in a ZIP (stored, no compression). No extra package needed.
 *
 * Usage:
 *   const bytes = buildXlsx([{ name, cols, rows, merges, freezeRow, headerRow, autoFilter, footer }]);
 *   downloadXlsx(bytes, 'report.xlsx');
 *
 * A cell is { v: value, s: styleName } or null. Style names are listed in STYLE below.
 */

// ── styles ────────────────────────────────────────────────────────────────────
// fonts: 0 normal 10 · 1 bold 10 · 2 bold 15 title · 3 bold 11 dark blue · 4 italic 9 grey · 5 bold 10 white
// fills: 0 none · 1 gray125 (required) · 2 light grey · 3 dark blue · 4 zebra · 5 light teal · 6 light violet
// borders: 0 none · 1 thin all sides
// numFmts: 164 '#,##0' · 165 '0.0' · 166 '+0.0;-0.0;0.0'
const XF = [
  // [numFmtId, fontId, fillId, borderId, horizontal, wrap]
  [0, 0, 0, 0, null, 0], // 0 default
  [0, 2, 0, 0, 'left', 0], // 1 title
  [0, 3, 0, 0, 'left', 0], // 2 subtitle
  [0, 1, 2, 1, 'left', 0], // 3 meta label
  [0, 0, 0, 1, 'left', 0], // 4 meta value
  [0, 5, 3, 1, 'center', 1], // 5 header
  [0, 0, 0, 1, 'left', 0], // 6 text
  [0, 1, 0, 1, 'left', 0], // 7 text bold
  [164, 0, 0, 1, 'right', 0], // 8 integer
  [165, 0, 0, 1, 'right', 0], // 9 one decimal
  [166, 0, 0, 1, 'right', 0], // 10 signed one decimal
  [0, 0, 0, 1, 'center', 0], // 11 centred text
  [165, 1, 5, 1, 'right', 0], // 12 Method A value (bold, teal)
  [165, 1, 6, 1, 'right', 0], // 13 Method B value (bold, violet)
  [0, 4, 0, 0, 'left', 1], // 14 note
  [0, 1, 2, 1, 'right', 0], // 15 total label
  [165, 1, 2, 1, 'right', 0], // 16 total value
];
// zebra copies of 6..13 (body styles) on fill 4
const ZEBRA_FROM = 6, ZEBRA_TO = 13, ZEBRA_BASE = XF.length;
for (let i = ZEBRA_FROM; i <= ZEBRA_TO; i++) {
  const [n, f, fill, b, h, w] = XF[i];
  XF.push([n, f, fill === 0 ? 4 : fill, b, h, w]);
}

// extra styles, appended after the zebra copies so the ids above never move
const EXTRA_BASE = XF.length;
XF.push(
  [0, 0, 0, 1, 'left', 1], // wrap: wrapped text
  [0, 0, 4, 1, 'left', 1], // wrap on a zebra row
  [164, 1, 2, 1, 'right', 0], // totalInt: bold integer on grey
  [164, 1, 5, 1, 'right', 0], // intA: bold integer on teal (highlighted whole-second value)
);

// HPR styles: Arial 9, thin borders, centred, the plant's yellow header — appended so the ids above never move
// fonts 6 Arial 9 · 7 Arial 9 bold · fill 7 yellow · numFmts 1 '0' · 2 '0.00' · 4 '#,##0.00' · 10 '0.00%' · 167 ₹ · 168 d-mmm
const HPR_BASE = XF.length;
const HPR_LIST = [
  ['hprHead', 0, 7, 7, 'center', 1], ['hprText', 0, 6, 0, 'left', 1], ['hprCenter', 0, 6, 0, 'center', 1], ['hprInt', 1, 6, 0, 'center', 0],
  ['hprDec', 2, 6, 0, 'center', 0], ['hprPct', 10, 6, 0, 'center', 0], ['hprRs', 167, 6, 0, 'center', 0], ['hprDate', 168, 6, 0, 'center', 0],
  ['hprTextB', 0, 7, 0, 'left', 0], ['hprIntB', 1, 7, 0, 'center', 0], ['hprDecB', 2, 7, 0, 'center', 0], ['hprPctB', 10, 7, 0, 'center', 0],
  ['hprRsB', 167, 7, 0, 'center', 0], ['hprLabel', 0, 7, 0, 'left', 0], ['hprTotal', 0, 7, 2, 'center', 0], ['hprTotalDec', 2, 7, 2, 'center', 0],
  ['hprTotalPct', 10, 7, 2, 'center', 0], ['hprTotalRs', 167, 7, 2, 'center', 0], ['hprInput', 0, 7, 7, 'center', 0], ['hprTitle', 0, 2, 0, 'left', 0], ['hprNote', 0, 4, 0, 'left', 0],
  ['hprDateB', 168, 7, 0, 'center', 0],
  ['hprHeadDate', 168, 7, 7, 'center', 0],   // 23-11-2026: a date in the yellow header (customer wise production)
  ['hprLink', 0, 8, 0, 'left', 0],           // 23-11-2026: a link to another sheet (blue, underlined)
];
for (const [name, n, f, fill, h, w] of HPR_LIST) XF.push([n, f, fill, name === 'hprTitle' || name === 'hprNote' ? 0 : 1, h, w]);   // title / note: no border
const HPR_IDS = Object.fromEntries(HPR_LIST.map(([k], i) => [k, HPR_BASE + i]));

export const STYLE = {
  title: 1, subtitle: 2, metaLabel: 3, metaValue: 4, head: 5, text: 6, textBold: 7, int: 8, dec1: 9, signed1: 10,
  center: 11, valueA: 12, valueB: 13, note: 14, totalLabel: 15, totalValue: 16,
  wrap: EXTRA_BASE, totalInt: EXTRA_BASE + 2, intA: EXTRA_BASE + 3,
  ...HPR_IDS,
};
const EXTRA_ZEBRA = { wrap: EXTRA_BASE + 1 };
/** Style id of a body style on a shaded (zebra) row. */
export const zebra = (name) => {
  if (EXTRA_ZEBRA[name] != null) return EXTRA_ZEBRA[name];
  const id = STYLE[name];
  return id >= ZEBRA_FROM && id <= ZEBRA_TO ? ZEBRA_BASE + (id - ZEBRA_FROM) : id;
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="+0.0;-0.0;0.0"/><numFmt numFmtId="167" formatCode="&quot;₹&quot;\ #,##0;\-&quot;₹&quot;\ #,##0;&quot;-&quot;"/><numFmt numFmtId="168" formatCode="d\-mmm"/></numFmts>
<fonts count="9">
<font><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF0F172A"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Arial"/><family val="2"/></font>
<font><i/><sz val="9"/><color rgb="FF475569"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
<font><sz val="9"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="9"/><name val="Arial"/><family val="2"/></font>
<font><b/><u/><sz val="9"/><color rgb="FF0563C1"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="8">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFCCFBF1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDE9FE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF64748B"/></left><right style="thin"><color rgb="FF64748B"/></right><top style="thin"><color rgb="FF64748B"/></top><bottom style="thin"><color rgb="FF64748B"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XF.length}">
${XF.map(([n, f, fill, b, h, w]) => `<xf numFmtId="${n}" fontId="${f}" fillId="${fill}" borderId="${b}" xfId="0"${n ? ' applyNumberFormat="1"' : ''} applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"${h ? ` horizontal="${h}"` : ''}${w ? ' wrapText="1"' : ''}/></xf>`).join('\n')}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ── helpers ───────────────────────────────────────────────────────────────────
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters not allowed in XML 1.0
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function colName(i) { // 0 → A
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellXml(c, r, ci) {
  if (c == null) return '';
  const ref = `${colName(ci)}${r}`;
  const s = typeof c.s === 'number' ? c.s : (STYLE[c.s] ?? 0);
  const v = c.v;
  // formula cell: { f: 'H5-G5', v: cached value } — Excel recalculates, the cached value shows in viewers that do not
  if (c.f) return typeof v === 'string' && v !== '' ? `<c r="${ref}" s="${s}" t="str"><f>${esc(c.f)}</f><v>${esc(v)}</v></c>` : `<c r="${ref}" s="${s}"><f>${esc(c.f)}</f>${typeof v === 'number' && Number.isFinite(v) ? `<v>${v}</v>` : ''}</c>`;
  if (v == null || v === '') return `<c r="${ref}" s="${s}"/>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sh) {
  const width = Math.max(1, ...sh.rows.map((r) => r?.length || 0), sh.cols?.length || 0);
  const last = `${colName(width - 1)}${Math.max(1, sh.rows.length)}`;
  const freeze = sh.freezeRow && sh.freezeCol   // 23-11-2026: rows and columns frozen (customer wise production)
    ? `<pane xSplit="${sh.freezeCol}" ySplit="${sh.freezeRow}" topLeftCell="${colName(sh.freezeCol)}${sh.freezeRow + 1}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${colName(sh.freezeCol)}${sh.freezeRow + 1}" sqref="${colName(sh.freezeCol)}${sh.freezeRow + 1}"/>`
    : sh.freezeRow
    ? `<pane ySplit="${sh.freezeRow}" topLeftCell="A${sh.freezeRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freezeRow + 1}" sqref="A${sh.freezeRow + 1}"/>`
    : '';
  const cols = (sh.cols || []).map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"/>`).join('');
  const rows = sh.rows.map((row, ri) => {
    const r = ri + 1;
    const ht = sh.rowHeights?.[r] ? ` ht="${sh.rowHeights[r]}" customHeight="1"` : '';
    return `<row r="${r}"${ht}>${(row || []).map((c, ci) => cellXml(c, r, ci)).join('')}</row>`;
  }).join('');
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const filter = sh.autoFilter ? `<autoFilter ref="${sh.autoFilter}"/>` : '';
  // 23-11-2026: links inside the workbook — [{ ref: 'B3', to: "'VOLTAS'!A1", tip }]
  const links = sh.links?.length ? `<hyperlinks>${sh.links.map((l) => `<hyperlink ref="${l.ref}" location="${esc(l.to)}"${l.tip ? ` tooltip="${esc(l.tip)}"` : ''} display="${esc(l.tip || l.to)}"/>`).join('')}</hyperlinks>` : '';
  const footer = sh.footer ? `<headerFooter><oddFooter>${esc(sh.footer)}</oddFooter></headerFooter>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows}</sheetData>
${filter}${merges}${links}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.55" header="0.2" footer="0.25"/>
<pageSetup paperSize="9" orientation="${sh.portrait ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>
${footer}
</worksheet>`;
}

function workbookXml(sheets) {
  const names = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const defs = sheets.map((s, i) => [
    s.headerRow ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(s.name).replace(/'/g, "''")}'!$${s.headerRow}:$${s.headerRow}</definedName>` : '',
    s.autoFilter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name).replace(/'/g, "''")}'!${s.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '',
  ].join('')).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews>
<sheets>${names}</sheets>${defs ? `<definedNames>${defs}</definedNames>` : ''}
</workbook>`;
}

// ── ZIP (stored) ──────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function zipStored(files) {
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ── public API ────────────────────────────────────────────────────────────────
/** Build an .xlsx file. Returns the file bytes (Uint8Array). */
export function buildXlsx(sheets) {
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(sheets[0]?.title || sheets[0]?.name || 'Report')}</dc:title><dc:creator>Line Pulse EMS</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
  return zipStored([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rels },
    { name: 'docProps/core.xml', data: core },
    { name: 'xl/workbook.xml', data: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}

/** Save the bytes as a file in the browser. */
export function downloadXlsx(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
