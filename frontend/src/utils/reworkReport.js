/**
 * Hourly rework data (IPQC) — the plant's "Book1" sheet (20-11-2026): one row per day · line · stage · model · category ·
 * defect · root cause · action, with the pieces of every hour (09-10 … 20-21), the total and the loss in ₹ (pieces × ₹ per piece).
 * Built from the rework (and rejection) rows of the entry pages. Pure — tested in tests/reworkReport.calc.test.js.
 */
import { buildFacts } from './drill';
import { qualityFacts, NO_STATION } from './qdrill';
import { KPI_LINES } from './kpiStages';

export const RWK_RATE = 55;             // ₹ per piece (the sheet: 2 pcs = ₹110)
export const RWK_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const p2 = (h) => String(h).padStart(2, '0');
export const hourCol = (h) => `${p2(h)}-${p2((h + 1) % 24)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (d) => MONTHS[Number(String(d).slice(5, 7)) - 1] || '';
/** "Line-1 C8" (the sheet's line names) */
export const lineName = (l) => { const k = KPI_LINES.find((x) => x.line === String(l)); return k ? k.label.replace(/\((.*)\)/, ' $1') : `Line-${l}`; };

/**
 * rows of the sheet. entries = OLE entries { "date|line|hour": entry }, stations = the admin's stations,
 * companyOf(model) = brand, kinds = ['rework'] or ['rework', 'reject'].
 * → { rows: [{ date, month, line, lineName, stage, brand, model, cat, defect, cause, action, hours: {h: n}, total, rs, dismantle, kind }], hours: [h…], totals }
 */
export function reworkSheet({ entries = {}, start = '', end = '', ids = null, stations = [], companyOf = () => '', kinds = ['rework', 'reject'], rate = RWK_RATE } = {}) {
  const facts = buildFacts({ entries, start, end, ids });
  const qf = kinds.flatMap((k) => qualityFacts(facts, k, stations));
  const m = new Map();
  for (const f of qf) {
    const stage = f.station && f.station !== NO_STATION ? f.station : '';
    const key = [f.date, f.line, stage, f.model, f.cat || '', f.defect, f.cause || '', f.action || ''].join('|');
    const o = m.get(key) || { date: f.date, month: monthName(f.date), line: String(f.line), lineName: lineName(f.line), stage, brand: companyOf(f.model) || '', model: f.model || '',
      cat: f.cat || '', defect: f.defect, cause: f.cause || '', action: f.action || '', hours: {}, total: 0, dismantle: 0, kinds: new Set(), first: 99 };
    o.hours[f.hour] = (o.hours[f.hour] || 0) + f.value;
    o.total += f.value; o.dismantle += f.dismantle || 0; o.kinds.add(f.kind); o.first = Math.min(o.first, f.hour);
    m.set(key, o);
  }
  const rows = [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.line) - Number(b.line) || a.first - b.first || a.stage.localeCompare(b.stage) || a.defect.localeCompare(b.defect))
    .map((o, i) => ({ ...o, sr: i + 1, rs: o.total * rate, kind: [...o.kinds].join(' + ') }));
  const seen = new Set(RWK_HOURS);
  for (const r of rows) for (const h of Object.keys(r.hours)) seen.add(Number(h));
  const hours = [...seen].sort((a, b) => a - b);
  const totals = { total: rows.reduce((a, r) => a + r.total, 0), rs: rows.reduce((a, r) => a + r.rs, 0), dismantle: rows.reduce((a, r) => a + r.dismantle, 0), hours: Object.fromEntries(hours.map((h) => [h, rows.reduce((a, r) => a + (r.hours[h] || 0), 0)])) };
  return { rows, hours, totals };
}

/** grouped totals for the dashboard: by(rows, 'stage') → [{ key, total, rs, dismantle, n }] most first */
export function groupRows(rows, field) {
  const m = new Map();
  for (const r of rows) {
    const k = (typeof field === 'function' ? field(r) : r[field]) || 'Not given';
    const o = m.get(k) || { key: k, total: 0, rs: 0, dismantle: 0, n: 0 };
    o.total += r.total; o.rs += r.rs; o.dismantle += r.dismantle; o.n += 1; m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/** the sheet as an xlsx sheet (utils/xlsxWriter buildXlsx) — the layout of the plant file */
export function reworkXlsxSheet({ rows, hours, totals }, { title = 'Line Rejection', name = 'Hrly. Rework data(ipqc)' } = {}) {
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  const fixed = ['SR. NO.', 'Month', 'DATE', 'Stage', 'Line', 'BRAND', 'MODEL', 'Category', 'DEFECT DESCRIPTION', 'ROOT CAUSE', 'Action'];
  const nT = fixed.length;               // the Total column
  const lastHour = nT + hours.length;     // last hour column
  const rsCol = lastHour + 1;
  const dmy = (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  const head = [...fixed, 'Total', ...hours.map(hourCol), 'INR (Rs)'].map((v) => ({ v, s: 'head' }));
  const r1 = [{ v: title, s: 'title' }, ...Array(lastHour).fill({ v: '' }), { v: 'Loss', s: 'title' }];
  const r2 = [{ v: title, s: 'textBold' }, ...Array(nT - 1).fill({ v: '' }), { v: totals.total, s: 'int' }, ...hours.map((h) => ({ v: totals.hours[h] || null, s: 'int' })), { v: totals.rs, s: 'int' }];
  const body = rows.map((r) => [
    { v: r.sr, s: 'int' }, { v: r.month, s: 'text' }, { v: dmy(r.date), s: 'text' }, { v: String(r.stage || '').toUpperCase(), s: 'text' }, { v: r.lineName, s: 'text' },
    { v: String(r.brand || '').toUpperCase(), s: 'text' }, { v: r.model, s: 'text' }, { v: String(r.cat || '').toUpperCase(), s: 'text' }, { v: String(r.defect || '').toUpperCase(), s: 'text' },
    { v: String(r.cause || '').toUpperCase(), s: 'text' }, { v: String(r.action || '').toUpperCase(), s: 'text' }, { v: r.total, s: 'int' },
    ...hours.map((h) => ({ v: r.hours[h] || null, s: 'int' })), { v: r.rs, s: 'int' },
  ]);
  return {
    name, cols: [6, 10, 12, 22, 12, 12, 18, 12, 30, 26, 18, 8, ...hours.map(() => 7), 11].map((width) => ({ width })),
    rows: [r1, r2, head, ...body],
    merges: [`A1:${colName(lastHour)}1`, `A2:${colName(nT - 1)}2`],
    freezeRow: 3, headerRow: 3, autoFilter: body.length ? `A3:${colName(rsCol)}${3 + body.length}` : null,
  };
}
