/**
 * Carton & serial report (23-11-2026): the good scans of a day with serial (ProductBarcode) and carton (CartonBarcode)
 * numbers — summaries, search and the Excel sheets. Rows: { line, id, at, mmId, model, code, company, serial, carton, component }.
 */

/** Rows of a line added to what is kept (new scans after the last id; a row already kept is not added twice). */
export function mergeRows(have = [], add = []) {
  if (!add.length) return have;
  const seen = new Set(have.map((r) => `${r.line}|${r.id}`));
  const out = have.slice();
  for (const r of add) { const k = `${r.line}|${r.id}`; if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}

/** Serial numbers scanned more than once (the same line or another): serial → count. Empty serials are left out. */
export function duplicateSerials(rows) {
  const n = new Map();
  for (const r of rows) if (r.serial) n.set(r.serial, (n.get(r.serial) || 0) + 1);
  return new Map([...n].filter(([, c]) => c > 1));
}

/** Per line and model: pieces, cartons (distinct carton numbers), first / last scan and serial. */
export function byModel(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.line}|${r.mmId}`;
    let o = m.get(k);
    if (!o) { o = { line: r.line, mmId: r.mmId, model: r.model, code: r.code, company: r.company, qty: 0, cartons: new Set(), noCarton: 0, first: r, last: r }; m.set(k, o); }
    o.qty += 1;
    if (r.carton) o.cartons.add(r.carton); else o.noCarton += 1;
    if (r.at < o.first.at || (r.at === o.first.at && r.id < o.first.id)) o.first = r;
    if (r.at > o.last.at || (r.at === o.last.at && r.id > o.last.id)) o.last = r;
  }
  return [...m.values()].map((o) => ({ ...o, cartons: o.cartons.size }))
    .sort((a, b) => String(a.line).localeCompare(String(b.line)) || b.qty - a.qty);
}

/** The day's totals: pieces, distinct serials and cartons, models, the last scan, duplicate serials. */
export function totals(rows) {
  const serials = new Set(), cartons = new Set(), models = new Set();
  let last = null;
  for (const r of rows) {
    if (r.serial) serials.add(r.serial);
    if (r.carton) cartons.add(r.carton);
    models.add(`${r.line}|${r.mmId}`);
    if (!last || r.at > last.at) last = r;
  }
  return { qty: rows.length, serials: serials.size, cartons: cartons.size, models: models.size, last, dup: duplicateSerials(rows).size };
}

/** Search (serial, carton, component, model, company — any part, no case) and model filter; newest first. */
export function filterRows(rows, { q = '', model = '', line = '' } = {}) {
  const s = String(q).trim().toLowerCase();
  return rows.filter((r) => (!line || String(r.line) === String(line)) && (!model || `${r.line}|${r.mmId}` === model)
    && (!s || `${r.serial} ${r.carton} ${r.component} ${r.model} ${r.company} ${r.code}`.toLowerCase().includes(s)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
}

/** Pieces per hour of the day (line by line): { hour: { line: pcs } } */
export function byHour(rows) {
  const out = {};
  for (const r of rows) { const h = Number(r.at.slice(11, 13)); (out[h] = out[h] || {})[r.line] = (out[h][r.line] || 0) + 1; }
  return out;
}

const T = (v) => ({ v: v == null ? '' : String(v), s: 'text' });
/** The Excel sheets: "Serial & carton" (one row per piece, oldest first) and "By model". Barcodes stay text (no 1.2E+15). */
export function serialSheets(rows, { date, lineLabel }) {
  const list = rows.slice().sort((a, b) => (String(a.line) === String(b.line) ? (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id) : String(a.line).localeCompare(String(b.line))));
  const dup = duplicateSerials(rows);
  const head = ['S.No', 'Line', 'Date', 'Time', 'Company', 'Model', 'Model code', 'Serial no. (product barcode)', 'Carton no.', 'Component barcode', 'Duplicate serial'];
  const s1 = {
    name: 'Serial & carton', title: `Serial & carton — ${lineLabel} — ${date}`,
    cols: [{ width: 7 }, { width: 7 }, { width: 11 }, { width: 9 }, { width: 14 }, { width: 26 }, { width: 13 }, { width: 28 }, { width: 28 }, { width: 22 }, { width: 10 }],
    rows: [head.map((v) => ({ v, s: 'head' })), ...list.map((r, i) => [{ v: i + 1, s: 'int' }, T(`Line ${r.line}`), T(r.at.slice(0, 10)), T(r.at.slice(11, 19)), T(r.company), { v: r.model || '', s: 'textBold' }, T(r.code), T(r.serial), T(r.carton), T(r.component), T(dup.has(r.serial) ? `Yes (${dup.get(r.serial)}×)` : '')])],
    freezeRow: 1, headerRow: 1, autoFilter: list.length ? `A1:K${list.length + 1}` : null,
  };
  const bm = byModel(rows);
  const s2 = {
    name: 'By model', title: `By model — ${lineLabel} — ${date}`,
    cols: [{ width: 7 }, { width: 14 }, { width: 26 }, { width: 13 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 10 }, { width: 26 }, { width: 26 }],
    rows: [['Line', 'Company', 'Model', 'Model code', 'Pieces', 'Cartons', 'First scan', 'Last scan', 'First serial', 'Last serial'].map((v) => ({ v, s: 'head' })),
      ...bm.map((o) => [T(`Line ${o.line}`), T(o.company), { v: o.model || '', s: 'textBold' }, T(o.code), { v: o.qty, s: 'int' }, { v: o.cartons, s: 'int' }, T(o.first.at.slice(11, 19)), T(o.last.at.slice(11, 19)), T(o.first.serial), T(o.last.serial)]),
      [{ v: 'Total', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: rows.length, s: 'totalInt' }, { v: bm.reduce((a, o) => a + o.cartons, 0), s: 'totalInt' }, { v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }]],
    freezeRow: 1, headerRow: 1,
  };
  return [s1, s2];
}
