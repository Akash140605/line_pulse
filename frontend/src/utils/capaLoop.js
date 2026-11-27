/**
 * 27-11-2026: the CAPA loop of the assembly line — every loss (rework / rejection / idle time of one reason, on one
 * line and day) goes round the same closed loop until it is proven gone:
 *
 *   1 write    the department writes the CAPA: 6M, 3+ whys, root cause, corrective + preventive action, owner, target
 *              → due the day after the loss
 *   2 action   the owner does the action on the line and marks it done (RCA closed with the close date)
 *              → due on the target date
 *   3 verify   quality / the supervisor checks it on the line: the same defect in the days after the action
 *              → due 7 days after the action was done
 *      redo    verified "not effective" / "partly" → back to the owner (a new action, then verify again)
 *   4 watch    verified effective → the line is watched for 30 days: the same defect on the same line again = came back
 *      back    it came back in the watch → reopened (back to the owner)
 *   5 closed   30 days without it coming back — the loop is closed
 *
 * Follow-up: every open step has a due date; days late give the escalation level
 *   L1 the owner (1–2 days late) · L2 the department head (3–6) · L3 the plant head (7 or more).
 * Nothing here writes anything: the steps are read from the RCA record and the hourly loss entries.
 */
import { normEntry, rcaKey, needsRca } from './ole';
import { addDaysYmd } from './rcaEffect';

export const VERIFY_AFTER = 7;    // days after the action
export const WATCH_DAYS = 30;     // days the line is watched after a good verification
export const STAGES = [
  { id: 'write', step: 1, name: 'Write CAPA', who: 'Department', open: true },
  { id: 'action', step: 2, name: 'Action on line', who: 'Responsibility', open: true },
  { id: 'redo', step: 2, name: 'Not effective — redo', who: 'Responsibility', open: true },
  { id: 'verify', step: 3, name: 'Verify on line', who: 'Quality / supervisor', open: true },
  { id: 'back', step: 3, name: 'Came back', who: 'Department', open: true },
  { id: 'watch', step: 4, name: `Watch ${WATCH_DAYS} days`, who: 'Line', open: false },
  { id: 'closed', step: 5, name: 'Loop closed', who: '—', open: false },
];
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));
export const ESC = [
  { id: 0, name: 'On time', short: '' },
  { id: 1, name: 'L1 · Owner', short: 'L1' },
  { id: 2, name: 'L2 · Department head', short: 'L2' },
  { id: 3, name: 'L3 · Plant head', short: 'L3' },
];
const LIST = [['losses', 'loss', 'min'], ['stops', 'stop', 'min'], ['rejects', 'reject', 'qty'], ['rework', 'rework', 'qty']];
const days = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
export const escOf = (late) => (late == null || late <= 0 ? 0 : late <= 2 ? 1 : late <= 6 ? 2 : 3);

/** the losses that need a CAPA, straight from the hourly entries { "date|line|hour": entry } */
export function issuesFromEntries(entries, ids = null) {
  const m = new Map();
  for (const [k, raw] of Object.entries(entries || {})) {
    const [date, line, hour] = k.split('|');
    if (!date || (ids && !ids.map(String).includes(String(line)))) continue;
    const e = normEntry(raw);
    for (const [field, kind, num] of LIST) {
      for (const x of e[field] || []) {
        const it = { date, line: String(line), kind, reason: x.reason || 'Not given' };
        if (!needsRca(it)) continue;
        const key = rcaKey(it);
        const o = m.get(key) || { ...it, key, dept: x.dept || '', value: 0, unit: num === 'min' ? 'min' : 'pcs', hours: [], models: [] };
        o.value += Number(x[num]) || 0;
        if (!o.hours.includes(Number(hour))) o.hours.push(Number(hour));
        if (x.model && !o.models.includes(x.model)) o.models.push(x.model);
        m.set(key, o);
      }
    }
  }
  return [...m.values()];
}

/** the same reason on the same line, amount per day (for the verification and the watch) */
export function amountsByIssue(entries) {
  const m = new Map();   // "line|kind|reason(lower)" → Map(date → amount)
  for (const [k, raw] of Object.entries(entries || {})) {
    const [date, line] = k.split('|');
    const e = normEntry(raw);
    for (const [field, kind, num] of LIST) {
      for (const x of e[field] || []) {
        const g = `${line}|${kind}|${String(x.reason || 'Not given').toLowerCase()}`;
        if (!m.has(g)) m.set(g, new Map());
        const d = m.get(g); d.set(date, (d.get(date) || 0) + (Number(x[num]) || 0));
      }
    }
  }
  return m;
}
const sumIn = (dm, from, to) => { let s = 0; let first = null; for (const [d, v] of dm || []) if (d >= from && d <= to && v > 0) { s += v; if (!first || d < first) first = d; } return { s, first }; };

/**
 * Where one loss is in the loop.
 * i = issue { date, line, kind, reason, … }, rec = its RCA record (or null), amounts = amountsByIssue(entries).
 * → { stage, due, late (days, > 0 = late), esc (0–3), next (what has to be done, by whom), before, after, backOn, backQty }
 */
export function loopOf(i, rec, amounts, today) {
  const dm = amounts?.get(`${i.line}|${i.kind}|${String(i.reason).toLowerCase()}`);
  const c = rec?.capa || {};
  const before = sumIn(dm, addDaysYmd(i.date, -6), i.date).s;
  let stage, due = null, next = '', after = null, backOn = null, backQty = 0, daysAfter = 0;
  const done = rec?.status === 'closed' ? (rec.closeDate || String(rec.closedAt || rec.updatedAt || '').slice(0, 10) || i.date) : null;
  if (!rec || !String(rec.rootCause || '').trim()) {
    stage = 'write'; due = addDaysYmd(i.date, 1); next = 'Write the CAPA: 6M, 3 whys, root cause, action, owner, target date';
  } else if ((c.implemented === 'no' || c.implemented === 'partly') && rec.status !== 'closed') {
    stage = 'redo'; due = rec.targetDate && rec.targetDate > (c.verifyDate || '') ? rec.targetDate : addDaysYmd(c.verifyDate || today, 3);
    next = 'Not effective on the line — write a new action, do it, mark it done';
  } else if (rec.status !== 'closed') {
    stage = 'action'; due = rec.targetDate || addDaysYmd(i.date, 7); next = `Do the action on the line, then mark it done${rec.owner ? ` (${rec.owner})` : ''}`;
  } else if (c.implemented !== 'yes') {
    stage = 'verify'; due = addDaysYmd(done, VERIFY_AFTER);
    const to = due < today ? due : today;
    after = addDaysYmd(done, 1) <= to ? sumIn(dm, addDaysYmd(done, 1), to).s : null;
    daysAfter = after == null ? 0 : days(addDaysYmd(done, 1), to) + 1;
    next = `Check on the line: did "${i.reason}" come again after the action?`;
  } else {
    const from = addDaysYmd(c.verifyDate || done, 1), end = addDaysYmd(c.verifyDate || done, WATCH_DAYS);
    const w = from <= today ? sumIn(dm, from, end < today ? end : today) : { s: 0, first: null };
    if (w.s > 0) { stage = 'back'; backOn = w.first; backQty = w.s; due = addDaysYmd(w.first, 1); next = `Came back on ${backOn.split('-').reverse().join('-')} — reopen and find the real root cause`; }
    else if (today <= end) { stage = 'watch'; due = end; next = `Watching the line till ${end.split('-').reverse().join('-')}`; }
    else { stage = 'closed'; next = 'Loop closed'; }
  }
  const open = STAGE_BY_ID[stage].open;
  const late = open && due ? days(due, today) : null;
  return { stage, due, done, daysAfter, late: late != null && late > 0 ? late : 0, left: late != null && late <= 0 ? -late : null, esc: open ? escOf(late) : 0, next, before, after, backOn, backQty };
}

/** every issue with its loop step, open ones first (most late first) */
export function loopRows(issues, rca, entries, today) {
  const A = amountsByIssue(entries);
  return (issues || []).map((i) => ({ ...i, rec: rca?.[i.key] || null, ...loopOf(i, rca?.[i.key] || null, A, today) }))
    .sort((a, b) => (STAGE_BY_ID[b.stage].open - STAGE_BY_ID[a.stage].open) || (b.late - a.late) || String(a.due || '9').localeCompare(String(b.due || '9')) || b.date.localeCompare(a.date));
}

/** counts per stage and per escalation level */
export function loopTotals(rows) {
  const st = Object.fromEntries(STAGES.map((s) => [s.id, 0]));
  const esc = [0, 0, 0, 0];
  for (const r of rows || []) { st[r.stage] += 1; if (STAGE_BY_ID[r.stage].open) esc[r.esc] += 1; }
  const n = (rows || []).length;
  const open = (rows || []).filter((r) => STAGE_BY_ID[r.stage].open).length;
  return { n, open, late: (rows || []).filter((r) => r.late > 0).length, st, esc, closedPct: n ? st.closed / n : null, effective: st.watch + st.closed };
}
