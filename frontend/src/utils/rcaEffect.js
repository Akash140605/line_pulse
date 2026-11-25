/**
 * 20-11-2026: RCA action effectiveness — after the action of an RCA, does the loss of that reason go down?
 * Pure. entries = ole.php entries { "date|line|hour": entry } of a look-back period (the app's own store, no scan data),
 * rca = { "date|line|kind|reason": record }.
 *
 * Per reason (or reason + line):
 *   action date   = the RCA's close date (action done); a written but open action: the day it was written
 *   before        = loss per working day in the `win` days before the FIRST action
 *   after         = loss per working day from the day after the LAST action, up to `win` days (not past the end)
 *   working day   = a day on which the line(s) of the reason have an hour written (loss, quality or "No loss")
 *   change        = (after − before) ÷ before
 *   status        effective  after ≤ 50 % of before (or nothing after, when there was something before)
 *                 partly     after 50–80 % of before
 *                 not        after > 80 % of before — the action did not bring the loss down
 *                 new        nothing before, but loss after (it came back / came new)
 *                 early      fewer than `minDays` working days after the action yet
 * Units stay apart: minutes for time losses, pieces for rejection / rework.
 */
import { normEntry } from './ole';

export const EFFECT_STATUS = {
  not: { label: 'Not effective', tone: 'bg-red-100 text-red-800 ring-red-300', order: 0 },
  new: { label: 'Came back', tone: 'bg-orange-100 text-orange-800 ring-orange-300', order: 1 },
  partly: { label: 'Partly', tone: 'bg-amber-100 text-amber-800 ring-amber-300', order: 2 },
  early: { label: 'Too early', tone: 'bg-slate-100 text-slate-700 ring-slate-300', order: 3 },
  effective: { label: 'Effective', tone: 'bg-emerald-100 text-emerald-800 ring-emerald-300', order: 4 },
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDaysYmd = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
// planned stoppage (tea break, meeting …) is not a loss to act on: left out
const KIND_OF = [['losses', 'min', 'loss'], ['rejects', 'qty', 'reject'], ['rework', 'qty', 'rework']];

/** the action date of an RCA record (null when no action is written) */
export function actionDate(rec) {
  if (!rec || !String(rec.action || '').trim()) return null;
  if (rec.status === 'closed') return rec.closeDate || String(rec.closedAt || rec.updatedAt || '').slice(0, 10) || rec.date || null;
  return String(rec.updatedAt || rec.submittedAt || '').slice(0, 10) || rec.date || null;
}

export function rcaEffect({ entries = {}, rca = {}, start, end, ids = null, win = 14, minDays = 3, byLine = false } = {}) {
  const lineOk = (l) => !ids || ids.map(String).includes(String(l));
  const worked = new Map();                 // line → Set(date)
  const G = new Map();                      // group → { key, kind, reason, unit, dept, lines:Set, byDay: Map(date → value) }
  const gKey = (kind, reason, line) => (byLine ? `${kind}|${String(reason).toLowerCase()}|${line}` : `${kind}|${String(reason).toLowerCase()}`);
  for (const [k, raw] of Object.entries(entries || {})) {
    const [date, line] = k.split('|');
    if (!date || date < start || date > end || !lineOk(line)) continue;
    const e = normEntry(raw);
    if (!worked.has(line)) worked.set(line, new Set());
    worked.get(line).add(date);
    for (const [field, num, kind] of KIND_OF) {
      for (const x of e[field] || []) {
        const v = Number(x[num]) || 0; if (!(v > 0)) continue;
        const reason = x.reason || 'Not given';
        const gk = gKey(kind, reason, line);
        const g = G.get(gk) || { key: gk, kind, reason, unit: num === 'min' ? 'min' : 'pcs', dept: x.dept || 'Not set', lines: new Set(), byDay: new Map(), actions: [] };
        g.lines.add(String(line));
        g.byDay.set(date, (g.byDay.get(date) || 0) + v);
        G.set(gk, g);
      }
    }
  }
  // the actions written on the RCAs of these reasons
  for (const [k, rec] of Object.entries(rca || {})) {
    const [date, line, kind0, ...rest] = k.split('|');
    const reason = rest.join('|');
    if (!lineOk(line) || !['loss', 'reject', 'rework'].includes(kind0)) continue;
    const kind = kind0;
    const at = actionDate(rec);
    if (!at || at > end) continue;
    const gk = gKey(kind, reason, line);
    const g = G.get(gk) || { key: gk, kind, reason, unit: kind === 'loss' ? 'min' : 'pcs', dept: rec.dept || 'Not set', lines: new Set([String(line)]), byDay: new Map(), actions: [] };
    g.actions.push({ at, lossDate: date, line: String(line), action: String(rec.action || '').trim(), rootCause: String(rec.rootCause || '').trim(), status: rec.status || 'submitted', by: rec.updatedBy || rec.submittedBy || '' });
    G.set(gk, g);
  }
  const workDays = (lines, from, to) => {
    const s = new Set();
    for (const l of lines) for (const d of worked.get(l) || []) if (d >= from && d <= to) s.add(d);
    return s;
  };
  const sumIn = (g, days) => [...days].reduce((a, d) => a + (g.byDay.get(d) || 0), 0);
  const out = [];
  for (const g of G.values()) {
    if (!g.actions.length) continue;
    g.actions.sort((a, b) => a.at.localeCompare(b.at));
    const first = g.actions[0].at, last = g.actions[g.actions.length - 1].at;
    const bDays = workDays(g.lines, addDaysYmd(first, -win), addDaysYmd(first, -1));
    const aEnd = addDaysYmd(last, win) < end ? addDaysYmd(last, win) : end;
    const aDays = last < end ? workDays(g.lines, addDaysYmd(last, 1), aEnd) : new Set();
    const before = bDays.size ? sumIn(g, bDays) / bDays.size : null;
    const after = aDays.size ? sumIn(g, aDays) / aDays.size : null;
    const repeats = [...g.byDay.entries()].filter(([d, v]) => d > last && v > 0).length;   // days with the loss after the last action
    let status;
    if (aDays.size < minDays) status = 'early';
    else if (!before) status = after > 0 ? 'new' : 'effective';
    else status = after <= before * 0.5 ? 'effective' : after <= before * 0.8 ? 'partly' : 'not';
    const total = [...g.byDay.values()].reduce((a, v) => a + v, 0);
    out.push({
      key: g.key, kind: g.kind, reason: g.reason, unit: g.unit, dept: g.dept, lines: [...g.lines].sort(),
      actions: g.actions, nActions: g.actions.length, first, last, before, after, beforeDays: bDays.size, afterDays: aDays.size,
      change: before ? (after ?? 0) / before - 1 : null, repeats, total, status,
      daily: [...g.byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    });
  }
  return out.sort((a, b) => EFFECT_STATUS[a.status].order - EFFECT_STATUS[b.status].order || (b.after ?? 0) - (a.after ?? 0) || b.total - a.total);
}

/** counts by status */
export const effectTotals = (rows) => Object.fromEntries(Object.keys(EFFECT_STATUS).map((k) => [k, (rows || []).filter((r) => r.status === k).length]));
