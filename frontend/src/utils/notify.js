/**
 * 23-11-2026: notifications (the bell in the top bar) and the welcome message.
 * The administrator decides in Setup → Notifications which alert is active, its limit, and who receives it:
 * groups of logins (administrators, supervisors, department users, viewers), single logins, and the lines it covers.
 * The alerts are worked out in the browser from data the screens already read (live lines, entries, morning entries);
 * nothing is written anywhere and the line databases are only read.
 */
import { missingOf } from '../components/MissingCycleWatch';
import { hourPlanOf } from './targets';
import { workSecInHour } from './shift';

import { NOTIFY_GROUPS, NOTIFY_RULES, RULE_BY_ID, WELCOME_DEFAULT, normalizeNotify, normalizeWelcome } from './notifyConfig';

export { NOTIFY_GROUPS, NOTIFY_RULES, RULE_BY_ID, WELCOME_DEFAULT, normalizeNotify, normalizeWelcome };

/** the group of a login (same words as Setup → Users & logins) */
export function groupOf(me) {
  if (!me) return null;
  if (me.role === 'admin') return 'admin';
  if (me.role === 'tv') return 'tv';
  if (me.oleEdit && (me.pages || []).includes('daily')) return 'sup';
  if (me.dept) return 'dept';
  return 'view';
}
/** does this login receive the alert (rule switched on, group or login chosen)? */
export function receives(cfg, ruleId, me) {
  const g = groupOf(me);
  if (!cfg?.on || !g || g === 'tv') return false;
  const r = cfg.rules?.[ruleId];
  if (!r?.on) return false;
  return r.to.includes(g) || r.users.includes(String(me.user || '').toLowerCase());
}
/** is the line of an alert one this login and this rule cover? */
export function coversLine(cfg, ruleId, me, line) {
  const r = cfg.rules?.[ruleId];
  if (line == null) return true;
  const L = String(line);
  if (r?.lines?.length && !r.lines.includes(L)) return false;
  const mine = me?.role === 'admin' ? [] : (me?.lines || []).map(String);
  return !mine.length || mine.includes(L);
}

const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const p2 = (n) => String(n).padStart(2, '0');
const span = (h) => `${p2(h)}:00–${p2(h + 1)}:00`;
const nf = (v) => Number(v || 0).toLocaleString('en-IN');
const toMin = (t) => { const s = hm(t); return s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null; };

/**
 * The alerts of the day for one login, newest first.
 *   rows     live lines of the day ({ line, name, ok, backup, hours, hourModels, total, lastHour })
 *   lineSet  { line: { shift, targets } } (the shift of the day, the targets the screens use)
 *   entries  { "date|line|hour": { losses, stops, rejects, rework, noLoss } } of the day
 *   setups   { "date|line": morning entry } of the day
 *   autoReady  the target methods are worked out (else "no cycle time" is not judged)
 */
export function buildNotices({ date, nowMin, rows = null, lineSet = {}, entries = null, setups = null, cfg, me, autoReady = false }) {
  const out = [];
  if (!cfg?.on || !me) return out;
  const want = (id) => receives(cfg, id, me);
  const R = cfg.rules;
  const nameOf = (l) => rows?.find((x) => String(x.line) === String(l))?.name || `Line ${l}`;
  const push = (rule, line, o) => { if (coversLine(cfg, rule, me, line)) out.push({ rule, line: line == null ? null : String(line), sev: RULE_BY_ID[rule].sev, page: RULE_BY_ID[rule].page, ...o }); };

  if (rows) {
    for (const r of rows) {
      const L = String(r.line);
      if (want('offline') && (r.ok === false || r.backup)) {
        const since = r.backup?.upTo ? String(r.backup.upTo).slice(11, 16) : '';
        push('offline', L, { id: `offline|${date}|${L}`, at: nowMin, title: `${nameOf(L)}: server not responding`, text: since ? `No live data has been received since ${since}. The screens show the backup copy.` : 'No live data has been received from the line server.' });
      }
    }
    if (want('noCycle') && autoReady) {
      const tg = Object.fromEntries(Object.entries(lineSet).map(([l, s]) => [l, s?.targets || {}]));
      for (const m of missingOf(rows, tg)) {
        push('noCycle', m.line, { id: `noCycle|${date}|${m.line}|${m.mmId}`, at: nowMin, title: `${nameOf(m.line)}: cycle time missing`, text: `${m.company ? `${m.company} · ` : ''}${m.model} (${nf(m.qty)} pcs today) has no cycle time. Please enter it in the Model master.` });
      }
    }
    for (const r of rows) {
      if (r.ok === false || r.backup) continue;
      const L = String(r.line); const S = lineSet[L] || {};
      if (!S.shift || !(want('lowHour') || want('lossPending'))) continue;
      const plan = S.targets ? hourPlanOf({ hours: r.hours, hourModels: r.hourModels, shift: S.shift, targets: S.targets, nowMin }) : null;
      const last = Number.isFinite(Number(r.lastHour)) ? Number(r.lastHour) : null;
      for (const h of r.hours || []) {
        const hr = Number(h.hour); const end = (hr + 1) * 60;
        if (end > nowMin || workSecInHour(S.shift, hr) <= 0) continue;
        const qty = Number(h.quantity) || 0; const t = plan?.targets?.[hr];
        if (want('lowHour') && t > 0 && qty < t * (R.lowHour.pct / 100)) {
          push('lowHour', L, { id: `lowHour|${date}|${L}|${hr}`, at: end, title: `${nameOf(L)}, ${span(hr)}: below target`, text: `${nf(qty)} of ${nf(t)} pcs produced (${Math.floor((qty / t) * 100)}% of target).` });
        }
        if (want('lossPending') && entries && (last == null || hr <= last) && t > 0 && qty < t && nowMin >= end + R.lossPending.min && !entries[`${date}|${L}|${hr}`]) {
          push('lossPending', L, { id: `lossPending|${date}|${L}|${hr}`, at: end + R.lossPending.min, title: `${nameOf(L)}, ${span(hr)}: loss entry pending`, text: `${nf(t - qty)} pcs short of target. Please record the reason in the Loss entry.` });
        }
      }
    }
  }
  if (want('morning') && setups && rows) {
    const at = toMin(R.morning.at);
    for (const r of rows) {
      const L = String(r.line);
      if (at != null && nowMin >= at && (Number(r.total) || 0) > 0 && !setups[`${date}|${L}`]) {
        push('morning', L, { id: `morning|${date}|${L}`, at, title: `${nameOf(L)}: morning entry not submitted`, text: `The manpower and shift of today have not been entered (due by ${R.morning.at}).` });
      }
    }
  }
  if (want('rejects') && entries) {
    const by = {};
    for (const [k, e] of Object.entries(entries || {})) {
      const [d, L] = String(k).split('|'); if (d !== date || !L) continue;
      // older entries keep the rejected quantity as a plain number, newer ones as a list of rows
      const rj = e?.rejects;
      by[L] = (by[L] || 0) + (Array.isArray(rj) ? rj.reduce((a, x) => a + (Number(x?.qty) || 0), 0) : (Number(rj) || 0));
    }
    for (const [L, n] of Object.entries(by)) {
      if (n > R.rejects.pcs) push('rejects', L, { id: `rejects|${date}|${L}|${Math.floor(n / Math.max(1, R.rejects.pcs))}`, at: nowMin, title: `${nameOf(L)}: high rejection`, text: `${nf(n)} pieces rejected today (limit ${nf(R.rejects.pcs)}).` });
    }
  }
  const rank = { high: 0, mid: 1, low: 2 };
  return out.sort((a, b) => (b.at - a.at) || (rank[a.sev] - rank[b.sev])).slice(0, 60);
}

/** "Good morning" / "Good afternoon" / "Good evening" by the hour of the day */
export const greetingOf = (h) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
/** the welcome text with {name}, {greeting}, {role} filled in */
export function welcomeText(tpl, { name, hour, role }) {
  return String(tpl || '').replace(/\{name\}/g, name || 'User').replace(/\{greeting\}/g, greetingOf(hour)).replace(/\{role\}/g, role || '');
}
