/**
 * Loss analysis: the hour entries of the OLE (api/ole.php) of a period, grouped by
 * department and by reason, as Pareto lists. No production read is needed — only the entries.
 *
 *   entries = { "YYYY-MM-DD|line|hour": entry }   (Loss entry page; normEntry reads old and new shapes)
 *   kind    = 'loss' (unplanned loss, minutes) · 'stop' (planned stoppage, minutes) · 'reject' / 'rework' (pieces)
 *   setups  = { "date|line": { mp, … } }          (Morning entry: manpower of that line and day)
 *   hpr     = { rate, otFrom, otX }                (Setup → HPR: ₹ per man-hour, overtime from, overtime ×)
 *
 * Loss ₹ of a row (minutes only) = rate × (minutes ÷ 60) × manpower × (otX when the hour starts at / after otFrom) —
 * the formula of the plant's HPR sheet. A line-day without a morning entry has no manpower: its minutes count, its ₹ is
 * not known (noMpMin says how many minutes are without ₹).
 */
import { normEntry } from './ole';

export const LOSS_KINDS = [
  { id: 'loss', label: 'Idle time', list: 'losses', num: 'min', unit: 'min' },
  { id: 'stop', label: 'Old planned stop', list: 'stops', num: 'min', unit: 'min' },
  { id: 'reject', label: 'Rejection', list: 'rejects', num: 'qty', unit: 'pcs' },
  { id: 'rework', label: 'Rework', list: 'rework', num: 'qty', unit: 'pcs' },
];
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** ₹ of `min` minutes of a line with `mp` people in clock hour `hour` (null without manpower). */
export function lossRs(min, mp, hour, hpr = {}) {
  if (mp == null || mp === '' || !Number.isFinite(Number(mp))) return null;
  const rate = Number(hpr.rate ?? 65), ot = toMin(hpr.otFrom ?? '18:00'), x = Number(hpr.otX ?? 2);
  const f = ot != null && Number(hour) * 60 >= ot ? x : 1;
  return rate * (Number(min) / 60) * Number(mp) * f;
}

const tidy = (s) => String(s || '').trim();
// department names before the HPR list: old entries are counted under today's name
const DEPT_ALIAS = { production: 'Prod', maintenance: 'Maint', 'stores / scm': 'Kitting Store', 'sqa / purchase': 'Supplier' };
export const deptName = (d) => DEPT_ALIAS[tidy(d).toLowerCase()] || tidy(d);
const ownerFrom = (reasons, kind, name) => {
  const list = (reasons && reasons[kind]) || [];
  const r = list.find((x) => tidy(x.reason || x.name || x[0]).toLowerCase() === tidy(name).toLowerCase());
  return r ? tidy(r.owner || r[2]) : '';
};

/**
 * → { kind, unit, total, rs, noMpMin, rows, dept: [{name, value, rs, count, lines, reasons: [...] , pct, cumPct}],
 *     reason: [{name, dept, owner, value, rs, count, lines, days, pct, cumPct}], line: [{line, value, rs}], days: [{date, value}] }
 * rows = every single loss row (date, line, hour, reason, dept, owner, model, part, value, rs).
 */
export function lossAnalysis({ entries = {}, start, end, ids = null, kind = 'loss', setups = {}, hpr = {}, reasons = null }) {
  const K = LOSS_KINDS.find((k) => k.id === kind) || LOSS_KINDS[0];
  const rows = [];
  for (const [key, raw] of Object.entries(entries || {})) {
    const [date, line, h] = key.split('|');
    if (!date || (start && date < start) || (end && date > end)) continue;
    if (ids && !ids.map(String).includes(String(line))) continue;
    const e = normEntry(raw);
    const mp = setups?.[`${date}|${line}`]?.mp ?? null;
    for (const x of e[K.list] || []) {
      const value = Number(x[K.num]) || 0;
      if (value <= 0) continue;
      const reason = tidy(x.reason) || 'Not given';
      const dept = deptName(x.dept) || 'Not set';
      rows.push({
        date, line: String(line), hour: Number(h), reason, dept, owner: tidy(x.owner) || ownerFrom(reasons, kind, reason),
        model: tidy(x.model), part: tidy(x.part), value, rs: K.num === 'min' ? lossRs(value, mp, Number(h), hpr) : null,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || Number(a.line) - Number(b.line) || a.hour - b.hour);
  const total = rows.reduce((a, r) => a + r.value, 0);
  const rs = rows.reduce((a, r) => a + (r.rs || 0), 0);
  const noMpMin = K.num === 'min' ? rows.filter((r) => r.rs == null).reduce((a, r) => a + r.value, 0) : 0;
  const group = (keyOf, make) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const o = m.get(k) || { ...make(r), value: 0, rs: 0, rsN: 0, count: 0, lines: new Set(), dates: new Set() };
      o.value += r.value; o.rs += r.rs || 0; o.rsN += r.rs != null ? 1 : 0; o.count += 1; o.lines.add(r.line); o.dates.add(r.date);
      m.set(k, o);
    }
    const list = [...m.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    let cum = 0;
    return list.map((o) => {
      cum += o.value;
      // ₹ only when at least one of its rows has the manpower of a morning entry (else not known: null)
      return { ...o, rs: o.rsN ? o.rs : null, rsN: undefined, lines: [...o.lines].sort(), days: o.dates.size, dates: undefined, pct: total ? (o.value / total) * 100 : 0, cumPct: total ? (cum / total) * 100 : 0 };
    });
  };
  const reason = group((r) => `${r.dept}|${r.reason}`, (r) => ({ name: r.reason, dept: r.dept, owner: r.owner }));
  // owner: the most used one of the reason's rows (rows can carry their own)
  for (const o of reason) {
    const c = new Map();
    for (const r of rows) if (r.reason === o.name && r.dept === o.dept && r.owner) c.set(r.owner, (c.get(r.owner) || 0) + 1);
    o.owner = [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || o.owner || '';
  }
  const dept = group((r) => r.dept, (r) => ({ name: r.dept })).map((d) => ({ ...d, reasons: reason.filter((x) => x.dept === d.name) }));
  const line = group((r) => r.line, (r) => ({ name: `Line ${r.line}`, line: r.line })).sort((a, b) => Number(a.line) - Number(b.line));
  const dm = new Map();
  for (const r of rows) dm.set(r.date, (dm.get(r.date) || 0) + r.value);
  const days = [...dm.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
  return { kind: K.id, label: K.label, unit: K.unit, total, rs, noMpMin, rows, dept, reason, line, days };
}

