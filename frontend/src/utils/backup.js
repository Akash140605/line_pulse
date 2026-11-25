// Offline fallback: when a line's SQL Server cannot be reached, the backend answers from the local backup copy
// (EMS_Backup_Line<N> on this PC) and adds the header  X-EMS-Backup: {"<line>":{"upTo","syncedAt"}}.
// This module keeps track of which lines are currently shown from backup, so the screen can say so.

const ALL = ['1', '2', '3', '4'];
const MULTI = ['live_lines.php', 'all_lines.php'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseBackupHeader(h) {
  if (!h) return {};
  try {
    const o = JSON.parse(h);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

/** Lines a response speaks for (from its URL). */
export function linesOfRequest(url) {
  const u = new URL(url, 'http://local/');
  const file = u.pathname.split('/').pop();
  const only = u.searchParams.get('lineOnly');
  if (only) return [only];
  if (MULTI.includes(file)) return ALL;
  return [u.searchParams.get('line') || '1'];
}

/** New state after one response: lines it spoke for are set from its header (or cleared). Returns prev when nothing changed. */
export function mergeBackupState(prev, lines, fromHeader) {
  const next = { ...prev };
  for (const l of lines) {
    if (fromHeader[l]) next[l] = { upTo: fromHeader[l].upTo ?? null, syncedAt: fromHeader[l].syncedAt ?? null, ...(fromHeader[l].kind ? { kind: fromHeader[l].kind } : {}) };
    else delete next[l];
  }
  return JSON.stringify(Object.entries(next).sort()) === JSON.stringify(Object.entries(prev).sort()) ? prev : next;
}

const fmt = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
  return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}, ${m[4]}:${m[5]}` : s;
};

export function backupNotice(line, info) {
  if (info?.kind === 'snapshot') {
    return `Line ${line} server is offline. Showing the last data read from the line: scans up to ${fmt(info.upTo)}`
      + (info.syncedAt && info.syncedAt !== info.upTo ? ` (read ${fmt(info.syncedAt)}).` : '.');
  }
  return `Line ${line} server is offline. Showing data from the local backup: scans up to ${fmt(info.upTo)}`
    + (info.syncedAt ? ` (backup updated ${fmt(info.syncedAt)}).` : '.');
}

/** Time part 'HH:MM' of the newest data, with the date when it is not `today` (YYYY-MM-DD). */
export function backupShort(info, today = '') {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(info?.upTo || '');
  if (!m) return '';
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  return d === today ? `${m[4]}:${m[5]}` : `${+m[3]} ${MON[+m[2] - 1]}, ${m[4]}:${m[5]}`;
}

/** How old the newest data is, in minutes (null when unknown). now = Date in DB time. */
export function backupAgeMin(info, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(info?.upTo || '');
  if (!m || !now) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

export const ageText = (min) => (min == null ? '' : min < 1 ? 'just now' : min < 60 ? `${min} min old` : min < 1440 ? `${Math.floor(min / 60)} h ${min % 60} min old` : `${Math.floor(min / 1440)} day${min >= 2880 ? 's' : ''} old`);

/* ── small store shared by api.js and the banner ── */
// A line is called OFFLINE only after it has failed for OFFLINE_AFTER_MS without a single good answer in between:
// one slow or dropped answer (busy network, a line PC that answers late) must not make the screen jump to OFFLINE.
const graceMs = () => { try { const v = window.__OFFLINE_GRACE_MS__; return Number.isFinite(v) ? v : 60_000; } catch { return 60_000; } };
export const OFFLINE_AFTER_MS = 60_000;
let state = {};
const firstFail = {};   // line → time of the first failed answer since the last good one
const subs = new Set();
let timer = null;
export const getBackupState = () => state;
export function subscribeBackup(fn) { subs.add(fn); return () => subs.delete(fn); }
let pending = {};        // lines answered from backup / saved data, not yet shown as offline
function publish() {
  const now = Date.now();
  const shown = {};
  for (const [l, info] of Object.entries(pending)) if (now - (firstFail[l] ?? now) >= graceMs()) shown[l] = info;
  const same = JSON.stringify(Object.entries(shown).sort()) === JSON.stringify(Object.entries(state).sort());
  if (!same) { state = shown; subs.forEach((f) => f(state)); }
  // still waiting for a line to pass the grace time: look again then
  clearTimeout(timer);
  const waits = Object.keys(pending).filter((l) => !shown[l]).map((l) => graceMs() - (now - firstFail[l]));
  if (waits.length) timer = setTimeout(publish, Math.max(250, Math.min(...waits) + 50));
}
/** A new login starts clean: offline notes of another login (e.g. the admin's Line 4) are not carried over. */
export function resetBackupState() {
  pending = {}; for (const k of Object.keys(firstFail)) delete firstFail[k];
  clearTimeout(timer); state = {}; subs.forEach((f) => f(state));
}
export function recordBackup(url, header) {
  const lines = linesOfRequest(url);
  const next = mergeBackupState(pending, lines, parseBackupHeader(header));
  const now = Date.now();
  for (const l of lines) { if (next[l]) firstFail[l] = firstFail[l] ?? now; else delete firstFail[l]; }
  pending = next;
  publish();
}

/**
 * Live rows (live_lines.php): a line that answered well a moment ago and now fails keeps its last good row
 * (no OFFLINE) until it has failed for the grace time. Rows → rows.
 */
const lastGood = {};
export function steadyLiveRows(rows) {
  const now = Date.now();
  return (rows || []).map((r) => {
    const l = String(r.line);
    const bad = !r.ok || !!r.backup;
    if (!bad) { lastGood[l] = { row: r, at: now }; return r; }
    const g = lastGood[l];
    return g && now - g.at < graceMs() ? g.row : r;
  });
}
