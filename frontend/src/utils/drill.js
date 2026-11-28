/**
 * Drill-down analysis of the losses.
 *
 * Every entered loss row becomes one "fact": { date, line, hour, kind, reason, dept, owner, model, part, value, rs, hpr, rca … }.
 * The page slices the facts with filters (department, reason, line, day, a span of days, hour, model, owner, part) — a click
 * on any bar, row or cell adds one — and groups the slice by any dimension. Everything is pure and tested
 * (tests/drill.calc.test.js), so every number on the page can be checked by hand.
 *
 * Measures
 *   value  minutes (unplanned loss / planned stoppage) or pieces (rejection / rework), as written on the Loss entry page
 *   rs     loss ₹ of the minutes = rate × minutes ÷ 60 × manpower of that day's morning entry (× overtime factor) — lossan.js
 *   hpr    lost time against the target, the HPR way: every clock hour that made less than its target lost
 *          (working minutes ÷ target × shortfall) minutes. That time is split over the hour's written reasons by their minutes;
 *          an hour that is short and has no reason gives a "Reason not written" row. Needs the production of the lines.
 *   count  number of entered rows
 */
import { normEntry, RCA_FROM } from './ole';
import { lossRs, deptName } from './lossan';
import { hprHours } from './hpr';
import { shiftOfDay, SHIFT_PLANT } from './shift';
import { deptOfRow } from './deptRules';

const pad = (n) => String(n).padStart(2, '0');
const tidy = (s) => String(s ?? '').trim();
export const dmy = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parse = (ds) => { const [y, m, d] = String(ds).split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
export const addDays = (ds, n) => { const d = parse(ds); d.setDate(d.getDate() + n); return ymd(d); };
/** Days from a to b, both counted (a = b → 1). */
export const daysIn = (a, b) => Math.round((parse(b) - parse(a)) / 86400000) + 1;

export const NOT_WRITTEN = 'Reason not written';
export const KIND_LABEL = { loss: 'Idle time', stop: 'Idle time', reject: 'Rejection', rework: 'Rework', unwritten: NOT_WRITTEN };
const TIME_KINDS = ['loss', 'stop'];

/** What to analyse: the loss types of the page. `unit` of value; `kinds` of the facts it takes. */
export const TYPES = [
  { id: 'loss', label: 'Idle time', unit: 'min', kinds: ['loss', 'stop'] },   // rows saved as planned stops are idle time too
  { id: 'time', label: 'All time losses', unit: 'min', kinds: ['loss', 'stop', 'unwritten'] },
  { id: 'reject', label: 'Rejection', unit: 'pcs', kinds: ['reject'] },
  { id: 'rework', label: 'Rework', unit: 'pcs', kinds: ['rework'] },
];
export const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[0];
/** The measures a type offers (HPR lost time only for all time losses — the HPR's own scope). */
export function measuresOf(typeId) {
  const t = typeOf(typeId);
  if (t.unit === 'pcs') return [['value', 'Qty'], ['count', 'Entries']];
  return [['value', 'Minutes'], ['rs', 'Loss ₹'], ...(t.id === 'time' ? [['hpr', 'Lost vs target (HPR)']] : []), ['count', 'Entries']];
}

/* ───────────── dimensions ───────────── */

const hourText = (h) => `${pad(h)}:00–${pad((Number(h) + 1) % 24)}:00`;
export const DIMS = {
  dept: { label: 'Department', text: (v) => v || 'Not set' },
  reason: { label: 'Reason', text: (v) => v || 'Not given' },
  line: { label: 'Line', text: (v) => `Line ${v}`, natural: (a, b) => Number(a) - Number(b) },
  date: { label: 'Day', text: dmy, natural: (a, b) => a.localeCompare(b) },
  hour: { label: 'Hour', text: hourText, natural: (a, b) => Number(a) - Number(b) },
  model: { label: 'Model', text: (v) => v || 'Model not given' },
  owner: { label: 'Owner', text: (v) => v || 'Owner not set' },
  part: { label: 'Part involved', text: (v) => v || 'Part not given' },
  kind: { label: 'Type', text: (v) => KIND_LABEL[v] || v },
  span: { label: 'Period', text: (v) => (v ? `${dmy(v.from)} – ${dmy(v.to)}` : '') },
  // Rejection / Rework analysis (utils/qdrill.js qualityFacts gives the facts these two fields)
  station: { label: 'Station', text: (v) => v || 'Station not given' },
  defect: { label: 'Defect', text: (v) => v || 'Not given' },
  cat: { label: 'Category', text: (v) => v || 'Category not given' },
};
export const dimText = (dim, v) => (DIMS[dim]?.text ? DIMS[dim].text(v) : String(v));

/* ───────────── facts ───────────── */

/**
 * One fact per entered row of the period.
 *   entries = { "date|line|hour": entry }   setups = { "date|line": { mp } }   rca = { "date|line|kind|reason": record }
 *   reasons = the reason master (owner of a reason when the row has none)    hpr = { rate, otFrom, otX }
 *   lost    = { "date|line|hour": lost minutes } from production (gapOf) — optional; gives the hpr measure
 */
export function buildFacts({ entries = {}, start = '', end = '', ids = null, setups = {}, rca = {}, reasons = null, hpr = {}, lost = null }) {
  const ownerOfReason = (kind, name) => {
    const r = (reasons?.[kind] || []).find((x) => tidy(x.reason).toLowerCase() === tidy(name).toLowerCase());
    return r ? tidy(r.owner) : '';
  };
  const lineOk = ids ? new Set(ids.map(String)) : null;
  const out = [];
  const byHour = new Map();   // "date|line|hour" → its time facts (for the HPR split)
  for (const [key, raw] of Object.entries(entries || {})) {
    const [date, line, h] = key.split('|');
    if (!date || (start && date < start) || (end && date > end)) continue;
    if (lineOk && !lineOk.has(String(line))) continue;
    const e = normEntry(raw);
    const hour = Number(h);
    const mp = setups?.[`${date}|${line}`]?.mp ?? null;
    let n = 0;
    for (const [list, kind, num] of [[e.losses, 'loss', 'min'], [e.stops, 'stop', 'min'], [e.rejects, 'reject', 'qty'], [e.rework, 'rework', 'qty']]) {
      for (const x of list || []) {
        const value = Number(x[num]) || 0;
        if (value <= 0) continue;
        const reason = tidy(x.reason) || 'Not given';
        const rk = `${date}|${line}|${kind}|${reason}`;
        const rec = rca?.[rk] || null;
        const f = {
          id: `${key}|${kind}|${n++}`, date, line: String(line), hour, kind, unit: num === 'min' ? 'min' : 'pcs',
          reason, dept: deptOfRow(x, kind, deptName), owner: tidy(x.owner) || ownerOfReason(kind, reason), model: tidy(x.model), part: tidy(x.part),
          station: tidy(x.station), cat: x.cat || '', brand: tidy(x.brand), cause: tidy(x.cause), action: tidy(x.action), dismantle: Number(x.dismantle) || 0, value, mp: mp == null || mp === '' ? null : Number(mp),
          rs: num === 'min' ? lossRs(value, mp, hour, hpr) : null, hpr: null,
          rcaKey: rk, rca: kind === 'stop' || date < RCA_FROM ? 'na' : !rec ? 'pending' : rec.status === 'closed' ? 'closed' : 'submitted', rcaRec: rec,
          note: e.note || '', by: e.updatedBy || '', at: e.updatedAt || '', pseudo: false,
        };
        out.push(f);
        if (TIME_KINDS.includes(kind)) { const k = `${date}|${line}|${hour}`; (byHour.get(k) || byHour.set(k, []).get(k)).push(f); }
      }
    }
  }
  if (lost) {
    // HPR split: the lost minutes of a short hour over its written time reasons (by their minutes); none → "Reason not written"
    for (const [k, L] of Object.entries(lost)) {
      const [date, line, h] = k.split('|');
      if ((start && date < start) || (end && date > end) || (lineOk && !lineOk.has(String(line)))) continue;
      const fs = byHour.get(k) || [];
      const tot = fs.reduce((a, f) => a + f.value, 0);
      if (L > 0 && tot > 0) { for (const f of fs) f.hpr = (L * f.value) / tot; continue; }
      for (const f of fs) f.hpr = 0;
      if (L > 0) {
        const mp = setups?.[`${date}|${line}`]?.mp ?? null;
        out.push({
          id: `${k}|unwritten`, date, line: String(line), hour: Number(h), kind: 'unwritten', unit: 'min', reason: NOT_WRITTEN, dept: NOT_WRITTEN,
          owner: null, model: null, part: null, station: '', value: 0, mp: mp == null || mp === '' ? null : Number(mp), rs: null, hpr: L,
          rcaKey: null, rca: 'na', rcaRec: null, note: '', by: '', at: '', pseudo: true,
        });
      }
    }
    // a written hour that production says was not short (or had no target): no lost time of its own
    for (const fs of byHour.values()) for (const f of fs) if (f.hpr == null) f.hpr = lost[`${f.date}|${f.line}|${f.hour}`] != null ? 0 : null;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.line) - Number(b.line) || a.hour - b.hour);
}

/** The measure of one fact. */
export function mv(f, measure) {
  if (measure === 'count') return f.pseudo ? 0 : 1;
  if (measure === 'rs') return f.rs || 0;
  if (measure === 'hpr') return f.hpr || 0;
  return f.value || 0;
}

/* ───────────── filters ───────────── */

/**
 * filters = [{ dim, value }] in the order they were clicked (the drill path). Different dimensions are AND-ed;
 * a dimension appears once (a new click on it replaces its value, a click on the same value takes it away).
 * span = { from, to } (a week / month of the trend); a day inside it wins (effectiveRange).
 */
export function setFilter(filters, dim, value) {
  const i = filters.findIndex((f) => f.dim === dim);
  if (i >= 0) {
    if (sameValue(filters[i].value, value)) return filters.filter((_, j) => j !== i);   // a second click on it takes it away
    return filters.map((f, j) => (j === i ? { dim, value } : f));
  }
  // a day picked inside a zoomed week / month keeps the span: Back goes from the day to the span, then to the period
  return [...filters, { dim, value }];
}
const sameValue = (a, b) => (a && typeof a === 'object' ? a.from === b?.from && a.to === b?.to : String(a) === String(b));
export const filterText = (f) => `${DIMS[f.dim]?.label || f.dim}: ${dimText(f.dim, f.value)}`;

const factKey = (f, dim) => (dim === 'line' ? f.line : dim === 'hour' ? String(f.hour) : f[dim]);
function pass(f, flt) {
  if (flt.dim === 'span') return f.date >= flt.value.from && f.date <= flt.value.to;
  const v = factKey(f, flt.dim);
  return v != null && String(v) === String(flt.value);
}
/** Facts of the slice: the type's kinds, inside [from, to], every filter (except the dimensions in `skip`). */
export function applyFilters(facts, { filters = [], kinds = null, from = '', to = '', skip = [] } = {}) {
  const ks = kinds ? new Set(kinds) : null;
  const fl = filters.filter((x) => !skip.includes(x.dim));
  return facts.filter((f) => (!ks || ks.has(f.kind)) && (!from || f.date >= from) && (!to || f.date <= to) && fl.every((x) => pass(f, x)));
}
/** The period the filters leave: the page period cut to a span / day filter. */
export function effectiveRange(start, end, filters = []) {
  const d = filters.find((f) => f.dim === 'date');
  if (d) return { from: d.value, to: d.value };
  const s = filters.find((f) => f.dim === 'span');
  if (s) return { from: s.value.from > start ? s.value.from : start, to: s.value.to < end ? s.value.to : end };
  return { from: start, to: end };
}
/** The same number of days just before a range (for "vs previous period"). */
export function prevRange(from, to) {
  const n = daysIn(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1), days: n };
}

/* ───────────── grouping ───────────── */

/**
 * The facts grouped by one dimension → [{ key, label, value, count, rs, rsN, days, lines, share, cumPct, cls, prev, delta }]
 *   order 'value' (biggest first, for Pareto lists) or 'natural' (lines, days, hours in their own order)
 *   prev = the previous period's facts (same filters) → prev value and delta per key
 */
export function groupBy(facts, dim, measure = 'value', { order = DIMS[dim]?.natural ? 'natural' : 'value', prev = null, top = 0 } = {}) {
  const m = new Map();
  for (const f of facts) {
    const k = factKey(f, dim);
    if (k == null) continue;   // "Reason not written" has no model / owner / part
    const o = m.get(String(k)) || { key: String(k), value: 0, count: 0, rs: 0, rsN: 0, dates: new Set(), lineSet: new Set() };
    o.value += mv(f, measure); o.count += f.pseudo ? 0 : 1;
    if (f.rs != null) { o.rs += f.rs; o.rsN += 1; }
    o.dates.add(f.date); o.lineSet.add(f.line);
    m.set(String(k), o);
  }
  const pm = new Map();
  if (prev) for (const f of prev) { const k = factKey(f, dim); if (k != null) pm.set(String(k), (pm.get(String(k)) || 0) + mv(f, measure)); }
  let list = [...m.values()].filter((o) => o.value > 0);
  const total = list.reduce((a, o) => a + o.value, 0);
  const nat = DIMS[dim]?.natural;
  list.sort(order === 'natural' && nat ? (a, b) => nat(a.key, b.key) : (a, b) => b.value - a.value || a.key.localeCompare(b.key));
  let cum = 0;
  list = list.map((o) => {
    const before = total ? (cum / total) * 100 : 0;
    cum += o.value;
    const p = prev ? pm.get(o.key) || 0 : null;
    return {
      key: o.key, label: dimText(dim, o.key), value: o.value, count: o.count, rs: o.rsN ? o.rs : null, rsN: o.rsN,
      days: o.dates.size, lines: [...o.lineSet].sort(), share: total ? (o.value / total) * 100 : 0,
      cumPct: total ? (cum / total) * 100 : 0, cls: before < 80 ? 'A' : before < 95 ? 'B' : 'C',
      prev: p, delta: p == null ? null : o.value - p,
    };
  });
  if (top > 0 && list.length > top) {
    const rest = list.slice(top);
    const v = rest.reduce((a, o) => a + o.value, 0);
    const p = prev ? rest.reduce((a, o) => a + (o.prev || 0), 0) : null;
    list = [...list.slice(0, top), { key: null, label: `Others (${rest.length})`, others: true, value: v, count: rest.reduce((a, o) => a + o.count, 0), rs: null, rsN: 0, days: 0, lines: [], share: total ? (v / total) * 100 : 0, cumPct: 100, cls: 'C', prev: p, delta: p == null ? null : v - p }];
  }
  return list;
}

/** Totals of a slice (the KPI tiles). */
export function kpisOf(facts, measure = 'value') {
  const real = facts.filter((f) => !f.pseudo);
  const total = facts.reduce((a, f) => a + mv(f, measure), 0);
  const withRs = real.filter((f) => f.rs != null);
  const issues = new Map();
  for (const f of real) if (f.rcaKey && f.rca !== 'na') issues.set(f.rcaKey, f.rca);
  const st = { pending: 0, submitted: 0, closed: 0 };
  for (const s of issues.values()) st[s] += 1;
  const days = new Set(facts.map((f) => f.date)).size;
  return {
    total, entries: real.length, days, lines: new Set(facts.map((f) => f.line)).size,
    rs: withRs.length ? withRs.reduce((a, f) => a + f.rs, 0) : null,
    noMpMin: real.filter((f) => f.unit === 'min' && f.rs == null).reduce((a, f) => a + f.value, 0),
    rca: { ...st, issues: issues.size }, perDay: days ? total / days : 0,
  };
}

/* ───────────── time ───────────── */

/** Bars of the trend: one per day up to a month, per week up to ~4 months, else per month. */
export const grainOf = (from, to) => { const n = daysIn(from, to); return n <= 31 ? 'day' : n <= 120 ? 'week' : 'month'; };
/** The bucket of a day: the day, its week (Monday) or its month. */
export function bucketOf(date, grain) {
  if (grain === 'month') return date.slice(0, 7);
  if (grain === 'week') { const d = parse(date); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return ymd(d); }
  return date;
}
/** Every bucket from `from` to `to` (so days without a loss show as gaps), with its own from / to and label. */
export function bucketsOf(from, to, grain) {
  const out = [];
  if (grain === 'month') {
    let d = parse(`${from.slice(0, 7)}-01`);
    while (ymd(d) <= to) {
      const s = ymd(d); const e = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      out.push({ key: s.slice(0, 7), from: s < from ? from : s, to: e > to ? to : e, label: `${MON[d.getMonth()]} ${d.getFullYear()}`, short: MON[d.getMonth()] });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return out;
  }
  if (grain === 'week') {
    let s = bucketOf(from, 'week');
    while (s <= to) {
      const e = addDays(s, 6);
      out.push({ key: s, from: s < from ? from : s, to: e > to ? to : e, label: `${dmy(s < from ? from : s).slice(0, 5)} – ${dmy(e > to ? to : e).slice(0, 5)}`, short: dmy(s < from ? from : s).slice(0, 5) });
      s = addDays(s, 7);
    }
    return out;
  }
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ key: d, from: d, to: d, label: dmy(d), short: d.slice(8, 10) });
  return out;
}

/**
 * The trend: per bucket the total and its parts by `split` ('dept' | 'line' | null).
 * series = the keys of the split in their fixed order (seriesOrder) — colour follows the department / line, never its rank.
 */
export function trendOf(facts, { from, to, grain = grainOf(from, to), split = null, measure = 'value', seriesOrder = null }) {
  const buckets = bucketsOf(from, to, grain).map((b) => ({ ...b, total: 0, parts: {} }));
  const at = new Map(buckets.map((b, i) => [b.key, i]));
  const seen = new Set();
  for (const f of facts) {
    const i = at.get(bucketOf(f.date, grain));
    if (i == null) continue;
    const v = mv(f, measure);
    if (!v) continue;
    const b = buckets[i];
    b.total += v;
    const s = split ? String(seriesOrder ? seriesOrder(f) : factKey(f, split)) : 'all';
    b.parts[s] = (b.parts[s] || 0) + v;
    seen.add(s);
  }
  return { grain, buckets, series: [...seen], max: Math.max(0, ...buckets.map((b) => b.total)) };
}

/* ───────────── matrix ───────────── */

/**
 * A heat map of two dimensions: rows × cols → value. A column dimension 'time' uses the buckets of the grain.
 * Rows / cols beyond `maxRows` / `maxCols` (biggest first) fold into "Other".
 */
export function matrixOf(facts, rowDim, colDim, measure = 'value', { from, to, grain = grainOf(from, to), maxRows = 12, maxCols = 12 } = {}) {
  const colKey = (f) => (colDim === 'time' ? bucketOf(f.date, grain) : factKey(f, colDim));
  const cells = new Map();
  const rowT = new Map(), colT = new Map();
  for (const f of facts) {
    const r = factKey(f, rowDim), c = colKey(f);
    if (r == null || c == null) continue;
    const v = mv(f, measure);
    if (!v) continue;
    rowT.set(String(r), (rowT.get(String(r)) || 0) + v);
    colT.set(String(c), (colT.get(String(c)) || 0) + v);
    const k = `${r}\u0001${c}`;
    cells.set(k, (cells.get(k) || 0) + v);
  }
  const order = (dim, totals, max) => {
    const nat = dim === 'time' ? (a, b) => a.localeCompare(b) : DIMS[dim]?.natural;
    let keys = [...totals.keys()];
    if (dim === 'time') keys = bucketsOf(from, to, grain).map((b) => b.key);
    if (nat) keys.sort(nat); else keys.sort((a, b) => totals.get(b) - totals.get(a));
    if (!nat && keys.length > max) return { keys: keys.slice(0, max - 1), other: new Set(keys.slice(max - 1)) };
    return { keys, other: new Set() };
  };
  const R = order(rowDim, rowT, maxRows), C = order(colDim, colT, maxCols);
  const label = (dim, k) => (dim === 'time' ? (bucketsOf(from, to, grain).find((b) => b.key === k)?.short || k) : dimText(dim, k));
  const rows = [...R.keys.map((k) => ({ key: k, label: label(rowDim, k) })), ...(R.other.size ? [{ key: null, label: `Other (${R.other.size})`, other: true }] : [])];
  const cols = [...C.keys.map((k) => ({ key: k, label: label(colDim, k) })), ...(C.other.size ? [{ key: null, label: `Other (${C.other.size})`, other: true }] : [])];
  const val = (rk, ck) => {
    const rs = rk == null ? [...R.other] : [rk], cs = ck == null ? [...C.other] : [ck];
    let s = 0; for (const a of rs) for (const b of cs) s += cells.get(`${a}\u0001${b}`) || 0;
    return s;
  };
  const grid = rows.map((r) => cols.map((c) => val(r.key, c.key)));
  rows.forEach((r, i) => { r.total = grid[i].reduce((a, v) => a + v, 0); });
  cols.forEach((c, j) => { c.total = grid.reduce((a, row) => a + row[j], 0); });
  const max = Math.max(0, ...grid.flat());
  return { rows, cols, grid, max, grain, colBuckets: colDim === 'time' ? bucketsOf(from, to, grain) : null };
}

/* ───────────── production: lost time against the target ───────────── */

/**
 * Lost time of every hour from production, the HPR way (utils/hpr.js hprHours: target = the line screen's hourly plan).
 *   days = oleRange(…).days   targetsByLine = { line: targets in force }   settings = line settings (shift master)
 * → { byHour: { "date|line|hour": lost min }, hours: [{ date, line, hour, slot, target, qty, lost, written }],
 *     lines: { line: { target, qty, lost, lostNoReason, short, shortNoReason } }, failed: [lines without an answer] }
 */
export function gapOf({ days = [], ids = [], settings = {}, setups = {}, targetsByLine = {}, otFrom = '18:00' }) {
  const byHour = {};
  const hours = [];
  const failed = new Set();
  for (const d of days) {
    for (const l of ids) {
      const L = d.byLine?.[l];
      if (!L) continue;
      if (!L.ok) { failed.add(String(l)); continue; }
      if (L.closed) continue;
      const shift = shiftOfDay(setups, d.date, String(l), settings?.[l]?.shift || null) || SHIFT_PLANT;
      for (const h of hprHours({ rows: L.rows, shift, targets: targetsByLine[l] || {}, otFrom, date: d.date, line: String(l) })) {
        if (!(h.target > 0)) continue;
        const it = (h.workMin / h.target) * (h.qty - h.target);
        const lost = it < 0 ? -it : 0;
        byHour[`${d.date}|${l}|${h.hour}`] = lost;
        const written = h.reasons.filter((x) => x.min > 0).reduce((a, x) => a + x.min, 0);
        hours.push({ date: d.date, line: String(l), hour: h.hour, slot: h.slot, target: h.target, qty: h.qty, workMin: h.workMin, lost, written });
      }
    }
  }
  return { byHour, hours, failed: [...failed] };
}

/** The lost time of some hours (those of the slice: line / day / span / hour filters) per line and in total. */
export function gapSummary(hours, ids = []) {
  const one = () => ({ target: 0, qty: 0, lost: 0, lostNoReason: 0, short: 0, shortNoReason: 0 });
  const lines = Object.fromEntries(ids.map((l) => [String(l), one()]));
  const total = one();
  for (const h of hours) {
    for (const o of [lines[h.line] || (lines[h.line] = one()), total]) {
      o.target += h.target; o.qty += h.qty; o.lost += h.lost;
      if (h.lost > 0) { o.short += 1; if (!(h.written > 0)) { o.lostNoReason += h.lost; o.shortNoReason += 1; } }
    }
  }
  return { lines, total };
}
/** Hours of the gap list that pass the line / day / span / hour filters. */
export function gapHours(hours, filters = [], from = '', to = '') {
  return hours.filter((h) => (!from || h.date >= from) && (!to || h.date <= to) && filters.every((f) => {
    if (f.dim === 'line') return h.line === String(f.value);
    if (f.dim === 'date') return h.date === f.value;
    if (f.dim === 'span') return h.date >= f.value.from && h.date <= f.value.to;
    if (f.dim === 'hour') return String(h.hour) === String(f.value);
    return true;   // department / reason / model … are not in production: they do not cut it
  }));
}

/* ───────────── text ───────────── */

/** 75 → "1 h 15 m", 40 → "40 min", 0.4 → "0.4 min". */
export function minText(v) {
  if (v == null) return '—';
  const m = Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  if (Math.abs(m) < 60) return `${m} min`;
  const s = m < 0 ? '−' : '';
  const a = Math.round(Math.abs(m));
  return `${s}${Math.floor(a / 60)} h ${pad(a % 60)} m`;
}
export const rsText = (v) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
/** Text of a value of a measure ('value' with the type's unit). */
export function valueText(v, measure, unit = 'min') {
  if (measure === 'rs') return rsText(v);
  if (measure === 'count') return `${Math.round(v)}`;
  if (unit === 'pcs' && measure === 'value') return `${Math.round(v).toLocaleString('en-IN')} pcs`;
  return minText(v);
}
/** Short axis text: 0 / 30m / 1 h / 20 h, ₹10K. */
export function axisText(v, measure, unit = 'min') {
  if (measure === 'rs') return v >= 1000 ? `₹${Math.round(v / 100) / 10}K` : `₹${Math.round(v)}`;
  if (measure === 'count' || unit === 'pcs') return `${Math.round(v)}`;
  if (v === 0) return '0';
  return v >= 60 && v % 60 === 0 ? `${v / 60} h` : v >= 60 ? `${Math.round((v / 60) * 10) / 10} h` : `${Math.round(v)}m`;
}
/** Steps of a minutes axis: whole minutes, then whole hours (so the labels read 0 / 30 m / 1 h or 0 / 10 h / 20 h). */
/** Steps of a pieces / entries axis: whole numbers only (0 / 2 / 4 / 6 … never 2.5). */
export const INT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000, 1000000];
export const MIN_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1800, 2400, 3000, 3600, 6000, 12000, 30000, 60000];
/** Clean axis ticks 0 … max (3–5 steps); `steps` = the allowed step sizes (e.g. MIN_STEPS). */
export function ticksOf(max, n = 4, steps = null) {
  if (!(max > 0)) return [0];
  const raw = max / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = (steps && steps.find((x) => x >= raw)) || [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= raw) || 10 * p;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + step) * 1000) / 1000);
  return out;
}
