/**
 * 28-11-2026: the plant's rework sheet (Line Rejection MIS) into the hourly Quality entries.
 *   SR. NO. | DATE | Stage | Line | BRAND | MODEL | Category | Department | DEFECT DESCRIPTION | ROOT CAUSE | ACTION | Total
 *   | 09-10 | 10-11 | … | 20-21 | INR (Rs)
 * Every row → one rework row in each hour that has pieces. A day and line that already has rework in Line Pulse is left
 * as it is (no double count) — only empty days are filled. ACTION "Dismental / dismantle" = the pieces were dismantled.
 * Nothing here writes: planImport() gives the entries; the page saves them with the normal Quality entry save.
 */
import { normEntry } from './ole';

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, '0');
const tidy = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** "PULSATOR TOUCHING" → "Pulsator touching" (as the entry pages write it); mixed case is kept */
export const sentence = (v) => { const t = tidy(v); return t && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };

/** 1-Nov-26 · 01-11-2026 · 2026-11-01 · 1/11/2026 · Excel serial → YYYY-MM-DD (null if not a date) */
export function parseDate(v) {
  const s = tidy(v);
  let m = s.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3})[A-Za-z]*[-\s/.](\d{2,4})$/);
  if (m && MON[m[2].toLowerCase()]) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${p2(MON[m[2].toLowerCase()])}-${p2(m[1])}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${p2(m[2])}-${p2(m[1])}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5); return d.toISOString().slice(0, 10); }
  return null;
}
// the sheet's department names → the names the entry pages use
const DEPT = { 'moulding qa': 'Moulding QA', 'sub-assy': 'Sub Assy', 'sub assy': 'Sub Assy', 'prod': 'Prod', 'production': 'Prod', 'iqc': 'IQC', 'quality': 'Quality', 'moulding store': 'Moulding Store', 'kitting store': 'Kitting Store' };
export const deptOf = (v) => DEPT[tidy(v).toLowerCase()] || tidy(v);
export const parseLine = (v) => { const m = tidy(v).match(/line\s*[-_ ]?\s*(\d{1,2})/i) || tidy(v).match(/^(\d{1,2})$/); return m ? String(Number(m[1])) : null; };

/**
 * rows = the sheet as rows of cells → { items: [{ date, line, stage, brand, model, cat, dept, defect, cause, action, dism, total, hours:{h:n} }], bad: [{ row, why }] }
 */
export function parseMis(rows) {
  const R = (rows || []).map((r) => (r || []).map((c) => tidy(c)));
  const hi = R.findIndex((r) => r.some((c) => /defect/i.test(c)) && r.some((c) => /^date$/i.test(c)));
  if (hi < 0) throw new Error('The header row (DATE … DEFECT DESCRIPTION …) was not found — paste the sheet with its header.');
  const H = R[hi].map((c) => c.toLowerCase());
  const col = (re) => H.findIndex((h) => re.test(h));
  const C = { date: col(/^date$/), stage: col(/^stage$/), line: col(/^line$/), brand: col(/^brand$/), model: col(/^model$/), cat: col(/^category$/),
    dept: col(/^department$/), defect: col(/defect/), cause: col(/root cause|^cause$/), action: col(/^action$/), total: col(/^total$/) };
  for (const k of ['date', 'line', 'defect']) if (C[k] < 0) throw new Error(`Column "${k}" was not found in the header.`);
  const hourCols = H.map((h, i) => { const m = h.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/); return m ? [i, Number(m[1])] : null; }).filter(Boolean);
  if (!hourCols.length) throw new Error('No hour columns (09-10, 10-11 …) were found in the header.');
  const items = [], bad = [];
  for (let i = hi + 1; i < R.length; i++) {
    const r = R[i]; if (!r.some(Boolean)) continue;
    const date = parseDate(r[C.date]), line = parseLine(r[C.line]);
    if (!date || !line) { if (r[C.defect]) bad.push({ row: i + 1, why: !date ? `date "${r[C.date]}"` : `line "${r[C.line]}"` }); continue; }
    const hours = {};
    for (const [ci, h] of hourCols) { const n = Math.round(Number(String(r[ci] || '').replace(/,/g, ''))); if (n > 0) hours[h] = (hours[h] || 0) + n; }
    const total = Object.values(hours).reduce((a, v) => a + v, 0);
    if (!total) { bad.push({ row: i + 1, why: `no pieces under the hours (${r[C.defect] || 'no defect'})` }); continue; }
    const action = sentence(r[C.action]);
    items.push({ date, line, stage: tidy(r[C.stage]), brand: tidy(r[C.brand]), model: tidy(r[C.model]), cat: sentence(r[C.cat]), dept: deptOf(r[C.dept]),
      defect: sentence(r[C.defect]) || 'Not given', cause: sentence(r[C.cause]), action, dism: /dism[ae]nt/i.test(action), total, hours });
  }
  return { items, bad };
}

/**
 * items + the entries Line Pulse already has → { save: [entries for ole.php save, part 'quality'], days: [{ date, line, rows, pcs, dism, skip }] }
 * A day and line with any rework already written is skipped whole. The hour keeps its rejection rows and note.
 */
export function planImport(items, entries) {
  const has = new Set();
  for (const [k, raw] of Object.entries(entries || {})) {
    const [d, l] = k.split('|');
    if ((normEntry(raw).rework || []).some((x) => Number(x.qty) > 0)) has.add(`${d}|${Number(l)}`);
  }
  const days = new Map();
  for (const it of items || []) {
    const k = `${it.date}|${it.line}`;
    const g = days.get(k) || { date: it.date, line: it.line, rows: 0, pcs: 0, dism: 0, skip: has.has(k), hours: new Map() };
    g.rows += 1; g.pcs += it.total; if (it.dism) g.dism += it.total;
    for (const [h, n] of Object.entries(it.hours)) {
      const list = g.hours.get(Number(h)) || [];
      list.push({ station: it.stage, model: it.model, reason: it.defect, qty: n, cat: it.cat, dept: it.dept, cause: it.cause, action: it.action, ...(it.dism ? { dismantle: n } : {}) });
      g.hours.set(Number(h), list);
    }
    days.set(k, g);
  }
  const save = [];
  for (const g of days.values()) {
    if (g.skip) continue;
    for (const [h, rows] of g.hours) {
      const old = entries?.[`${g.date}|${g.line}|${h}`] ? normEntry(entries[`${g.date}|${g.line}|${h}`]) : null;
      // at most 20 rework rows in one hour (server rule): the same stage + model + defect are added together
      const m = new Map();
      for (const r of rows) { const key = `${r.station}|${r.model}|${r.reason}|${r.cause}|${r.action}`; const o = m.get(key); if (o) { o.qty += r.qty; if (r.dismantle) o.dismantle = (o.dismantle || 0) + r.dismantle; } else m.set(key, { ...r }); }
      save.push({ date: g.date, line: Number(g.line), hour: h, part: 'quality', rework: [...m.values()].slice(0, 20), rejects: old?.rejects || [], note: old?.note || '' });
    }
  }
  const list = [...days.values()].map(({ hours, ...d }) => d).sort((a, b) => a.date.localeCompare(b.date) || Number(a.line) - Number(b.line));
  return { save, days: list };
}
