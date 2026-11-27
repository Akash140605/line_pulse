/**
 * RCA dashboard (20-11-2026) — the RCAs of the losses / rejection / rework of a period, counted.
 *   status   pending (nothing written) · submitted (written, action open) · closed
 *   overdue  not closed and the target date is before today
 *   age      days from the loss to today (open) or to the close date (closed)
 * Pure: issues = issuesOf(…).filter(needsRca), rca = { key: record }, deptOf = (dept) => display name.
 */
import { rcaStatus } from './ole';
import { guessDept } from './deptRules';

export const daysBetween = (a, b) => (a && b ? Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) : null);
export const AGE_BUCKETS = [['0–2 days', 0, 2], ['3–7 days', 3, 7], ['8–15 days', 8, 15], ['16+ days', 16, Infinity]];

/** one row per issue with its RCA state */
export function rcaRows(issues, rca, today) {
  return (issues || []).map((i) => {
    const x = rca?.[i.key] || null;
    const st = rcaStatus(x);
    const closeDate = st === 'closed' ? (x?.closeDate || String(x?.closedAt || x?.updatedAt || '').slice(0, 10) || null) : null;
    const overdue = st !== 'closed' && !!x?.targetDate && x.targetDate < today;
    const age = st === 'closed' ? daysBetween(i.date, closeDate) : daysBetween(i.date, today);
    return { ...i, rec: x, st, closeDate, overdue, age: age == null ? null : Math.max(0, age) };
  });
}

/** totals of rows */
export function rcaTotals(rows) {
  const n = rows.length;
  const c = (st) => rows.filter((r) => r.st === st).length;
  const closed = rows.filter((r) => r.st === 'closed');
  const ages = closed.map((r) => r.age).filter((v) => v != null);
  return {
    n, pending: c('pending'), submitted: c('submitted'), closed: closed.length, overdue: rows.filter((r) => r.overdue).length,
    closure: n ? closed.length / n : null, avgClose: ages.length ? ages.reduce((a, v) => a + v, 0) / ages.length : null,
  };
}

/** by department: totals of each, most open first */
export function rcaByDept(rows, deptOf = (d) => d) {
  const m = new Map();
  for (const r of rows) { const k = deptOf(r.dept) || guessDept(r.kind, r.reason); (m.get(k) || m.set(k, []).get(k)).push(r); }
  return [...m.entries()].map(([dept, rs]) => ({ dept, ...rcaTotals(rs) })).sort((a, b) => (b.pending + b.submitted) - (a.pending + a.submitted) || b.n - a.n || a.dept.localeCompare(b.dept));
}

/** open RCAs (pending + submitted) by age bucket */
export function rcaAgeing(rows) {
  const open = rows.filter((r) => r.st !== 'closed');
  return AGE_BUCKETS.map(([label, lo, hi]) => ({ label, n: open.filter((r) => r.age != null && r.age >= lo && r.age <= hi).length }));
}
