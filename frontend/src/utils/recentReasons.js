/**
 * 20-11-2026: the reasons / defects used lately on this PC, so the entry pages offer them first ("Recent").
 * Kept per kind and line (and station for rejection / rework defects), newest first, at most 12 each. A reason written
 * by hand (not in the admin's list) is kept with its department, so it can be picked again at once.
 */
const KEY = 'ems.recentReasons.v1';
const MAX = 12;

function readAll() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function writeAll(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } }

/** scope of a list: loss / stop per line; reject / rework per line and station */
export const recentScope = (kind, line, station = '') => `${kind}|${line}${station ? `|${String(station).toLowerCase()}` : ''}`;

/** [{ reason, dept, manual, n, at }] newest first */
export function recentOf(scope) {
  const list = readAll()[scope];
  return Array.isArray(list) ? list.filter((x) => x && typeof x.reason === 'string' && x.reason.trim()) : [];
}

/** the reasons just saved (each once), newest first; a reason used again moves to the top and counts up */
export function bumpRecent(scope, items, now = Date.now()) {
  const all = readAll();
  let list = Array.isArray(all[scope]) ? all[scope] : [];
  for (const it of items || []) {
    const reason = String(it?.reason || '').trim();
    if (!reason) continue;
    const old = list.find((x) => x.reason.toLowerCase() === reason.toLowerCase());
    list = [{ reason, dept: it.dept || old?.dept || '', manual: !!it.manual, n: (old?.n || 0) + 1, at: now }, ...list.filter((x) => x !== old)];
  }
  all[scope] = list.slice(0, MAX);
  writeAll(all);
  return all[scope];
}

/**
 * The list with the recent ones first (those still in the list, plus reasons written by hand), then the rest:
 * { recent: [{reason, dept, manual}], rest: [...] }. n = how many recent ones at most.
 */
export function withRecent(list, recent, n = 6) {
  const known = new Map((list || []).map((x) => [String(x.reason).toLowerCase(), x]));
  const top = [];
  for (const r of recent || []) {
    if (top.length >= n) break;
    const k = r.reason.toLowerCase();
    if (top.some((x) => x.reason.toLowerCase() === k)) continue;
    const x = known.get(k);
    if (x) top.push({ ...x, recent: true });
    else if (r.manual) top.push({ reason: r.reason, dept: r.dept || '', manual: true, recent: true });
  }
  const used = new Set(top.map((x) => x.reason.toLowerCase()));
  return { recent: top, rest: (list || []).filter((x) => !used.has(String(x.reason).toLowerCase())) };
}
