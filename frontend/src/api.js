import { recordBackup, steadyLiveRows, resetBackupState } from './utils/backup';
import { authHeader, clearAuth, getAuth, AUTH_EVENT } from './auth';

// All backend endpoints live under /api on the PHP server. Override per machine with VITE_API_BASE in `.env`.
// 24-11-2026: the built copy asks the server it was opened from (…/ems-dashboard/frontend/dist/ → …/ems-dashboard/backend/api),
// so a copy of the software runs on any PC / address; the development server (:5173) keeps the plant server.
export function apiBaseFor(loc) {
  const path = String(loc?.pathname || '');
  const i = path.indexOf('/frontend/');
  if (loc?.origin && String(loc.port) !== '5173' && i >= 0) return `${loc.origin}${path.slice(0, i)}/backend/api`;
  return 'http://192.168.2.111:8080/ems-dashboard/backend/api';
}
const BASE = import.meta.env.VITE_API_BASE || apiBaseFor(typeof window !== 'undefined' ? window.location : null);

/* ───────────── production lines ───────────── */
export const ALL_LINE_IDS = ['1', '2', '3', '4'];
// LINE_IDS / LINES = the lines this login may see. A management login can be limited by the admin (e.g. Line 1 & 2);
// the arrays are changed in place on login (applyLineScope below), so every screen that reads them follows.
export const LINE_IDS = [...ALL_LINE_IDS];
export const LINES = [...LINE_IDS.map((l) => [l, `Line ${l}`]), ['all', 'Main (All lines)']];
/** "Line 1 & 2" for a limited login, "All lines" otherwise. */
export const scopeLabel = () => (LINE_IDS.length === ALL_LINE_IDS.length ? 'All lines' : `Line ${LINE_IDS.join(' & ')}`);
const LS_KEY = 'ems.line';
// ?tv=2 (or ?tv=main) in the address: the TV at a line opens that line (see components/TvStage.jsx)
const TV_LINE = (() => { try { const v = new URLSearchParams(window.location.search).get('tv'); return v === 'main' ? 'all' : LINE_IDS.includes(v) ? v : null; } catch { return null; } })();
let LINE = (() => { try { if (TV_LINE) return TV_LINE; const v = localStorage.getItem(LS_KEY); return v === 'all' || LINE_IDS.includes(v) ? v : '1'; } catch { return '1'; } })();
export const getLine = () => LINE;
export const setLine = (l, keep = true) => { LINE = String(l); if (keep) try { localStorage.setItem(LS_KEY, LINE); } catch { /* ignore */ } };   // keep = false: not remembered for the next start

// Small in-memory cache: repeated identical requests (switching presets back and forth) return instantly.
const cache = new Map();
const TTL_MS = 30_000;

async function get(path, params = {}, { signal, fresh = false, noCache = false, ttl = TTL_MS, noAuth = false } = {}) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
  );
  // every request carries the selected line (explicit params.line wins, used by the "all lines" merge)
  if (clean.line === undefined) clean.line = LINE === 'all' ? LINE_IDS[0] : LINE;
  if (fresh) clean.refresh = 1;
  const qs = new URLSearchParams(clean).toString();
  const url = `${BASE}/${path}${qs ? `?${qs}` : ''}`;

  const hit = cache.get(url);
  if (!fresh && !noCache && hit && Date.now() - hit.t < ttl) return hit.data;

  // The same request already on its way (two panels asking at once): share it instead of asking the server twice.
  const key = `${fresh ? 'F' : ''}${url}`;
  if (!signal && inflight.has(key)) return inflight.get(key);
  const p = fetchJson(url, signal, noAuth).then((body) => { cache.set(url, { t: Date.now(), data: body }); return body; });
  if (!signal) { inflight.set(key, p); p.finally(() => inflight.delete(key)).catch(() => {}); }
  return p;
}

const inflight = new Map();

/** Sets LINE_IDS / LINES for the logged-in user (role management with "lines" = only those lines; everyone else all lines). */
export function applyLineScope(a = getAuth()) {
  const lim = a && a.role === 'management' && Array.isArray(a.lines) ? a.lines.map(String).filter((l) => ALL_LINE_IDS.includes(l)) : [];
  const ids = lim.length ? lim : ALL_LINE_IDS;
  if (ids.join() === LINE_IDS.join()) return;
  LINE_IDS.splice(0, LINE_IDS.length, ...ids);
  LINES.splice(0, LINES.length, ...ids.map((l) => [l, `Line ${l}`]), ['all', ids.length === ALL_LINE_IDS.length ? 'Main (All lines)' : `Main (Line ${ids.join(' & ')})`]);
  if (LINE !== 'all' && !LINE_IDS.includes(LINE)) LINE = LINE_IDS[0];
  cache.clear();   // answers read for another login are not shown to this one
  resetBackupState();   // nor its offline notes
}
applyLineScope();
let lastUser = getAuth()?.user || null;
try {
  window.addEventListener(AUTH_EVENT, () => {
    const u = getAuth()?.user || null;
    if (u !== lastUser) { lastUser = u; cache.clear(); resetBackupState(); }   // another login: nothing of the last one stays
    applyLineScope();
  });
} catch { /* no window (tests) */ }

/*
 * Live numbers of one line, never more than ONE request per line on its way. A line that has not answered within a
 * few seconds gives its last answer (or a "waiting" row) and its request keeps running in the background, so a slow
 * or hanging line never holds up the screen or uses up the browser's few connections to the server.
 */
const liveState = {};
const LIVE_WAIT_MS = 6000;
const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
/* The last answer of each line is kept in this browser, so after a page refresh the numbers show at once (marked with
   the time they were read) while the slow line is asked again — never an empty or "offline" card in between. */
const LIVE_LS = 'ems.liveLast.';
function liveStored(key) {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_LS + key) || 'null');
    if (!v || !v.j || !v.at || Date.now() - v.at > 12 * 3600_000 || stamp(new Date(v.at)).slice(0, 10) !== stamp(new Date()).slice(0, 10)) return null;
    const j = v.j; const row = j.lines?.[0];
    if (!row || !row.ok || row.backup) return null;
    return { ...j, lines: [{ ...row, backup: { upTo: row.lastScan || stamp(new Date(v.at)), syncedAt: stamp(new Date(v.at)), kind: 'browser' }, day: row.day || j.focus }] };
  } catch { return null; }
}
function liveOne(l, date, p) {
  const key = `${l}|${date || ''}|${p.cmin ?? ''}|${p.cmax ?? ''}`;
  const st = liveState[key] || (liveState[key] = { p: null, last: liveStored(key) });
  if (!st.p) {
    st.p = get('live_lines.php', { date, cmin: p.cmin, cmax: p.cmax, lineOnly: l, line: l }, { noCache: true })
      .then((j) => {
        st.last = j;
        const row = j?.lines?.[0];
        if (row?.ok && !row.backup) { try { localStorage.setItem(LIVE_LS + key, JSON.stringify({ at: Date.now(), j })); } catch { /* storage full / blocked */ } }
        return j;
      })
      .catch((e) => { st.lastErr = e; throw e; })
      .finally(() => { st.p = null; });
    st.p.catch(() => {});   // nobody may be waiting for it any more (answered from the last value)
  }
  const waiting = () => st.last || { focus: date || null, lines: [{ line: String(l), name: `Line ${l}`, ok: false, waiting: true, error: `Line ${l} took longer than ${LIVE_WAIT_MS / 1000} s to answer (still waiting)`, total: 0, hours: [], hourModels: [] }] };
  return Promise.race([st.p, new Promise((r) => setTimeout(() => r(waiting()), LIVE_WAIT_MS))]);
}
const TIMEOUT_MS = 60_000;

/**
 * A row answered from a backup / last read whose numbers are of TODAY: the line ran today, it is only slow to answer.
 * Shown as a normal (running) line; `lag` keeps when it was read, so the card can say "read hh:mm".
 */
export function todayNotOffline(rows, today) {
  return (rows || []).map((r) => {
    if (!r || !r.backup || !today) return r;
    const d = r.day || String(r.backup.upTo || '').slice(0, 10);
    return d === today ? { ...r, ok: true, error: null, backup: null, lag: r.backup } : r;
  });
}

/* requests running now (the live polling of the line servers and the clock do not count): the top bar of the window */
let busyN = 0;
const busySubs = new Set();
const QUIET = /\/(live_lines|server_time|auth)\.php/;
const busyTell = () => busySubs.forEach((f) => { try { f(busyN); } catch { /* ignore */ } });
export function subscribeBusy(f) { busySubs.add(f); f(busyN); return () => busySubs.delete(f); }

/* ── long periods of one line: asked in pieces of a week ──
   A month of a slow line server did not come back within the time limit, so the screen stayed empty. Each week is now
   one request (the finished weeks are kept by the server for hours, only the week with today is read again) and the
   pieces are put together here: days, day × hour × model, models (cycles weighted by their count), rejections. */
const CHUNK_DAYS = 7;
const ymdAdd = (ds, n) => { const [y, m, d] = ds.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
export function periodChunks(start, end, size = CHUNK_DAYS) {
  const out = [];
  for (let s = start; s <= end; s = ymdAdd(s, size)) { const e = ymdAdd(s, size - 1); out.push([s, e < end ? e : end]); }
  return out;
}
export function mergeLineRows(rows) {
  const good = rows.filter(Boolean);
  if (!good.length) return null;
  const bad = good.find((r) => !r.ok);
  if (bad) return bad;
  const last = good[good.length - 1];
  const models = new Map();
  for (const r of good) for (const m of r.models || []) {
    const o = models.get(m.mmId) || { ...m, qty: 0, days: 0, validCycles: 0, aboveMax: 0, _cyc: 0 };
    o.qty += m.qty || 0; o.days += m.days || 0; o.validCycles += m.validCycles || 0; o.aboveMax += m.aboveMax || 0;
    if (m.avgCycle != null && m.validCycles) o._cyc += m.avgCycle * m.validCycles;
    models.set(m.mmId, o);
  }
  const rej = new Map(); let rejTotal = 0;
  for (const r of good) { rejTotal += r.rejections?.total || 0; for (const t of r.rejections?.top || []) rej.set(t.msg, (rej.get(t.msg) || 0) + (t.n || 0)); }
  return {
    ...last,
    daily: good.flatMap((r) => r.daily || []).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)),
    dailyCo: good.flatMap((r) => r.dailyCo || []),
    dhm: good.flatMap((r) => r.dhm || []),
    mmCo: Object.assign({}, ...good.map((r) => r.mmCo || {})),
    models: [...models.values()].map(({ _cyc, ...m }) => ({ ...m, avgCycle: m.validCycles ? Math.round((_cyc / m.validCycles) * 100) / 100 : null })).sort((a, b) => b.qty - a.qty),
    rejections: { total: rejTotal, top: [...rej.entries()].map(([msg, n]) => ({ msg, n })).sort((a, b) => b.n - a.n).slice(0, 5) },
    backup: good.map((r) => r.backup).filter(Boolean).pop() || null,
  };
}
// finished days do not change: a piece that ends before today is kept in the browser for 10 minutes
const PAST_TTL_MS = 10 * 60_000;
/**
 * The pieces a period is read in, for the OLE screens. Today is always a piece of its own (it is read again every 20 s);
 * finished days are read in fixed calendar pieces (1–7, 8–14, 15–21, 22–28, 29–month end), so the same piece is asked by
 * every screen and every day and the server's 7-day copy of it is used again. Days of a piece that is not complete are
 * read one by one. A period longer than two months reads each finished whole month as one piece.
 */
export function oleChunks(start, end, today) {
  if (!today) return periodChunks(start, end);
  const out = [];
  const lastDone = end < today ? end : ymdAdd(today, -1);
  const long = (new Date(end) - new Date(start)) / 86_400_000 > 62;
  for (let s = start; s <= lastDone;) {
    const d = Number(s.slice(8, 10));
    const ym = s.slice(0, 8);
    const monthEnd = ymdAdd(`${ymdAdd(`${ym}01`, 31).slice(0, 8)}01`, -1);
    const b0 = d >= 29 ? 29 : d - ((d - 1) % 7);
    const bStart = `${ym}${String(b0).padStart(2, '0')}`;
    const bEnd = b0 === 29 ? monthEnd : `${ym}${String(b0 + 6).padStart(2, '0')}`;
    // a long period (Monthly OLE: the whole year): a finished whole month is one piece — 12 reads a line, not 50
    if (long && d === 1 && monthEnd <= lastDone) { out.push([s, monthEnd]); s = ymdAdd(monthEnd, 1); continue; }
    if (s === bStart && bEnd <= lastDone) { out.push([s, bEnd]); s = ymdAdd(bEnd, 1); } else { out.push([s, s]); s = ymdAdd(s, 1); }
  }
  if (end >= today) out.push([start > today ? start : today, end]);
  return out;
}
async function allLinesChunked(l, p, opts) {
  const q0 = (s, e, o = opts) => get('all_lines.php', { start: s, end: e, cmin: p.cmin, cmax: p.cmax, lineOnly: l, line: '1' }, o);
  // a line server that is busy for a moment is asked once more (19-11-2026: "Line N is not answering" came and went)
  // a line server that is busy for a moment is asked once more; a line still not answering is asked again by the page
  // itself every 10 s (useOleData, 20-11-2026) — the other lines are never held up by it
  const q = (s, e, o = opts) => q0(s, e, o).then((j) => (j?.lines?.[0] && j.lines[0].ok === false ? new Promise((ok) => setTimeout(ok, 1200)).then(() => q0(s, e, { ...o, noCache: true })) : j))
    .catch((x) => { if (x?.name === 'AbortError') throw x; return new Promise((ok) => setTimeout(ok, 1200)).then(() => q0(s, e, { ...o, noCache: true })); });
  const parts = p.chunk ? oleChunks(p.start, p.end, p.today) : [[p.start, p.end]];   // chunk: the OLE screens (Dashboard, OLE, loss entry)
  if (parts.length < 2) return q(p.start, p.end);
  // a past piece is never read past the cache on a poll (only today's piece is); a Refresh (fresh) still reads them all
  const optsOf = ([, e]) => (p.today && e < p.today ? { ...opts, noCache: false, ttl: PAST_TTL_MS } : opts);
  // at most three pieces at a time per line server (not flooded); the newest piece first, and a free place is filled at once
  const out = new Array(parts.length);
  const order = parts.map((_, i) => i).reverse();
  let next = 0;
  const worker = async () => { while (next < order.length) { const i = order[next]; next += 1; out[i] = await q(parts[i][0], parts[i][1], optsOf(parts[i])); } };
  await Promise.all(Array.from({ length: Math.min(3, parts.length) }, worker));
  const lastJ = out[out.length - 1];
  // each piece keeps only its own days (a server that answers more than asked can never count a day twice)
  const inR = (d, [s, e]) => d >= s && d <= e;
  const rows = out.map((j, k) => { const r = j?.lines?.[0]; if (!r || !r.ok) return r; const pr = parts[k];
    return { ...r, daily: (r.daily || []).filter((x) => inR(x.d, pr)), dailyCo: (r.dailyCo || []).filter((x) => inR(x.d, pr)), dhm: (r.dhm || []).filter((x) => inR(x[0], pr)) }; });
  const row = mergeLineRows(rows);
  return { ...lastJ, range: { start: p.start, end: p.end }, lines: row ? [row] : [] };
}

/** fetch + JSON with a time limit, so a stuck server shows a message instead of an endless spinner. */
async function fetchJson(url, signal, noAuth = false) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(signal.reason);
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT_MS);
  const counted = !QUIET.test(url);
  if (counted) { busyN += 1; busyTell(); }
  try {
    // noAuth: a public answer (the server clock) is asked without the login header — from another address (the dev
    // server :5173, another PC) that header needs a CORS preflight which server_time.php does not answer
    const res = await fetch(url, { signal: ctl.signal, headers: noAuth ? {} : authHeader() });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) clearAuth();   // login ended → back to the login page
    if (!res.ok) throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || `Request failed: ${res.status}`);
    // line offline → answered from the local backup copy (never let this break a response)
    try { recordBackup(url, res.headers && res.headers.get ? res.headers.get('X-EMS-Backup') : null); } catch { /* ignore */ }
    return body;
  } catch (e) {
    if (timedOut) throw new Error(`The server took longer than ${TIMEOUT_MS / 1000} s to answer (${url.split('/').pop().split('?')[0]}). Try a shorter period or Refresh.`);
    if (signal?.aborted && e?.name !== 'AbortError') { const a = new Error('Aborted'); a.name = 'AbortError'; throw a; }
    throw e;
  } finally {
    clearTimeout(timer);
    if (counted) { busyN = Math.max(0, busyN - 1); busyTell(); }
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/** POST JSON to a settings endpoint (targets, shift, loss register). The header marks it as a dashboard change. */
async function post(path, params, body) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/${path}?${qs}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EMS-Write': '1', ...authHeader() }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'auth.php') clearAuth();
  if (!res.ok || j.error) throw new Error(j.error || `Saving failed (${res.status})`);
  // settings changed: drop cached GETs of the same endpoint
  for (const k of [...cache.keys()]) if (k.includes(`/${path}`)) cache.delete(k);
  return j;
}

/**
 * 20-11-2026: a note for the activity log (a page opened, a log out) — never in the way: no error, no busy bar, and it
 * still goes when the page closes (keepalive). token: the login it belongs to (a log out sends the key it drops).
 */
export function activityNote(body, token = getAuth()?.token) {
  if (!token) return;
  try {
    fetch(`${BASE}/activity.php`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-EMS-Write': '1', 'X-EMS-Auth': token }, body: JSON.stringify(body) })
      .catch(() => { /* the log is never in the way */ });
  } catch { /* old browser */ }
}

// files.php answers a file, not JSON: it is read as a blob with the login header (an <img src> cannot send it)
const fileUrls = new Map();
function fileUrl(id) {
  if (!fileUrls.has(id)) {
    const p = fetch(`${BASE}/files.php?id=${encodeURIComponent(id)}`, { headers: authHeader() })
      .then((res) => { if (res.status === 401) clearAuth(); if (!res.ok) throw new Error(`File not found (${res.status})`); return res.blob(); })
      .then((b) => URL.createObjectURL(b));
    p.catch(() => fileUrls.delete(id));
    fileUrls.set(id, p);
  }
  return fileUrls.get(id);
}

// opts = { signal, fresh }
export const api = {
  /** Login: { token, exp, user, role, display }. */
  login: (user, pass) => post('auth.php', {}, { action: 'login', user, pass }),
  me: () => get('auth.php', {}, { noCache: true }),
  users: () => get('auth.php', { users: 1 }, { noCache: true }),
  setPassword: (user, nw, old) => post('auth.php', {}, { action: 'password', user, new: nw, old }),
  setEnforce: (on) => post('auth.php', {}, { action: 'enforce', on }),
  // 25-11-2026: Setup → Security — blocked PCs, logins locked to their PCs, security log (backend lib/security.php)
  security: () => get('auth.php', { security: 1 }, { noCache: true }),
  saveSecurity: ({ block, lock }) => post('auth.php', {}, { action: 'security', block, lock }),
  // 25-11-2026: security alerts (bell of the admin) and the alert e-mail (backend lib/alerts.php)
  securityAlerts: () => get('auth.php', { alerts: 1 }, { noCache: true }),
  alertsRead: (ids, all = false) => post('auth.php', {}, { action: 'alertsRead', ids, all }),
  mailSave: (m) => post('auth.php', {}, { action: 'mailSave', ...m }),
  mailTest: () => post('auth.php', {}, { action: 'mailTest' }),
  /** admin: create / reset a TV login (role tv: only the live line animation) and remove it */
  tvUser: (user, pass) => post('auth.php', {}, { action: 'tvuser', user, pass }),
  tvRemove: (user) => post('auth.php', {}, { action: 'tvremove', user }),
  /** Admin: create a management login or change its name / lines (lines [] = all lines); pass only to set a password. */
  saveUser: (user, { display, lines, oleEdit, dept, pages, active, pass } = {}) => post('auth.php', {}, { action: 'user', user, display, lines, ...(oleEdit != null ? { oleEdit: !!oleEdit } : {}), ...(dept != null ? { dept } : {}), ...(pages != null ? { pages } : {}), ...(active != null ? { active: !!active } : {}), ...(pass ? { pass } : {}) }),
  /** Admin: switch a management or TV login off (cannot log in, open logins end) or on again. */
  setActive: (user, on) => post('auth.php', {}, { action: 'active', user, on }),
  removeUser: (user) => post('auth.php', {}, { action: 'userremove', user }),

  /** 20-11-2026 (admin): the activity log — logins, failed logins, log outs, pages opened and every change, of the days from … to */
  activity: (p, opts) => get('activity.php', p, { noCache: true, ...opts }),

  /** DB server ka abhi ka time: { now: 'YYYY-MM-DD HH:MM:SS' } (server_time.php). Kabhi cache nahi hota. */
  serverTime: (opts) => get('server_time.php', { _: Date.now() }, { noCache: true, noAuth: true, ...opts }),

  /** Screen setup by the admin: pages per login, Plant overview content, name and colour (Setup page). */
  uiSettings: (opts) => get('ui_settings.php', {}, { noCache: true, ...opts }),
  /** admin: where the settings are kept (SQL Server EMS_LinePulse_App or the JSON files) */
  storeInfo: (opts) => get('store_info.php', {}, { noCache: true, ...opts }),
  saveUiSettings: (body) => post('ui_settings.php', {}, body),
  /** Shift / lunch window + model targets of a line (shared by every screen). */
  // 25-11-2026: kept 15 s, so opening another page does not ask the server for the four lines again; a save here drops it at once
  lineSettings: (line, opts) => get('line_settings.php', { line }, { ttl: 15_000, ...opts }),
  // model master (admin): company · model · cycle time · lines
  // 25-11-2026: the master (1,000+ models) is kept 60 s for the screens that only read it; the Model master page asks fresh
  modelMaster: (opts) => get('model_master.php', {}, { ttl: 60_000, ...opts }),
  saveModelMaster: (rows) => post('model_master.php', {}, { action: 'save', rows }),
  saveLineSettings: (line, body) => post('line_settings.php', { line }, body),
  /** Loss register of a line for a period. */
  /** OLE / OEE dashboard: manual entries per line and day (planned stops, rejects, rework, shift minutes). */
  oleEntries: (start, end, opts) => get('ole.php', { start, end }, { noCache: true, ...opts }),
  saveOle: (entries) => post('ole.php', {}, { action: 'save', entries }),
  saveOleReasons: (reasons) => post('ole.php', {}, { action: 'reasons', reasons }),
  /** Whole-day planned stop of one line on one day (off = false takes it back): that line-day gets no OLE. */
  saveOleDay: (day) => post('ole.php', {}, { action: 'day', ...day }),
  /** Morning entry of one line on one day (manpower, start, lunch, tea breaks, close; clear: true removes it). */
  saveOleSetup: (su) => post('ole.php', {}, { action: 'setup', ...su }),
  saveOleKpi: (row) => post('ole.php', {}, { action: 'kpi', ...row }),
  /** RCA of losses (one reason of one kind on one line and day): admin or a login of that department. */
  saveRca: (items) => post('ole.php', {}, { action: 'rca', items }),
  /** 20-11-2026: RCA evidence (photo / PDF / Excel …) and profile pictures — files.php. data = base64 */
  uploadFile: (name, data) => post('files.php', {}, { action: 'upload', for: 'rca', name, data }),
  /** a kept file as a blob: URL (asked with the login header, kept for the session) */
  fileUrl: (id) => fileUrl(id),
  avatars: () => get('files.php', { avatars: 1 }, { noCache: true }),
  setAvatar: (body) => post('files.php', {}, { action: 'avatar', ...body }),
  losses: (line, start, end, opts) => get('losses.php', { line, start, end }, { noCache: true, ...opts }),
  lossAction: (line, body) => post('losses.php', { line }, body),

  companies: (opts) => get('companies.php', {}, opts),
  models: (companyId, opts) => get('models.php', { companyId }, opts),
  /** Model master of one line (model → company), for filters on the Main / management pages. */
  lineModels: (line, opts) => get('models.php', { line }, opts),
  availableDates: (f, opts) => get('available_dates.php', { ...f }, opts),
  rangeOverview: (startDate, endDate, f, opts) => get('range_overview.php', { startDate, endDate, ...f }, opts),
  analytics: (startDate, endDate, f, opts) => get('analytics.php', { startDate, endDate, ...f }, opts),
  dayOverview: (date, f, opts) => get('day_overview.php', { date, ...f }, opts),
  /** Scans inside a time-of-day window (lunch) per day and hour: { days: { date: { hour: qty } } }. */
  windowCounts: (startDate, endDate, from, to, f, opts) => get('window_counts.php', { startDate, endDate, from, to, ...f }, opts),
  hourDetail: (date, hour, f, opts) => get('hour_detail.php', { date, hour, ...f }, opts),
  /** 23-11-2026: carton & serial report — the good scans of one line and day (after = only those after this ScanId) */
  serials: (line, date, after = 0, opts) => get('serials.php', { line: String(line), date, after: after > 0 ? after : undefined }, { noCache: true, ...opts }),
  /** one line, one day: quantity per clock hour (all_lines.php only=hourly) — finished days are kept 10 min */
  hourlyOfDay: (line, date, opts) => get('all_lines.php', { start: date, end: date, date, only: 'hourly', lineOnly: line, line: '1' }, { ttl: PAST_TTL_MS, ...opts }),
  /** Main view: production of all four lines in one call (see all_lines.php). only:'hourly' + date = just the hourly part. */
  allLines: (p, opts) => get('all_lines.php', { start: p.start, end: p.end, cmin: p.cmin, cmax: p.cmax, date: p.date, only: p.only, line: '1' }, opts),
  /**
   * Main view, faster: the four lines are requested in parallel (lineOnly=N), so the wait is the slowest line, not the sum.
   * Same response shape as allLines. If the lines' latest days differ, the hourly part is re-read for the common latest day.
   */
  allLinesParallel: async (p, opts = {}) => {
    const ids = p.lines || LINE_IDS;   // only some lines (e.g. the OLE page: Line 1 and 2)
    const res = await Promise.allSettled(ids.map((l) => allLinesChunked(l, p, opts)));
    const abort = res.find((r) => r.status === 'rejected' && r.reason?.name === 'AbortError');
    if (abort) throw abort.reason;
    const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const lines = res.map((r, i) => (r.status === 'fulfilled' ? r.value.lines?.[0] : null)
      || { line: ids[i], name: `Line ${ids[i]}`, ok: false, error: String(r.reason?.message || r.reason || 'No response'), daily: [], hourly: [], models: [], rejections: { total: 0, top: [] } });
    // 20-11-2026: no line answered (e.g. the Loss entry of Line 2 alone): each line shows "not answering" with its reason
    // and is asked again by the page, instead of an empty screen
    if (!ok.length) return { range: { start: p.start, end: p.end }, focus: p.end, cmin: p.cmin, cmax: p.cmax, lines };
    // a line answered from its backup keeps its own (older) last day and does not move the common day
    const live = ok.filter((j) => !j.lines?.[0]?.backup);
    const focus = (live.length ? live : ok).map((j) => j.focus).filter(Boolean).sort().pop() || p.end;
    if (live.some((j) => j.focus !== focus)) {
      try {
        const h = await get('all_lines.php', { start: p.start, end: p.end, date: focus, only: 'hourly', line: '1' }, opts);
        const byLine = Object.fromEntries((h.lines || []).map((l) => [l.line, l.hourly]));
        lines.forEach((l) => { if (l.ok && !l.backup && byLine[l.line]) l.hourly = byLine[l.line]; });
      } catch (e) { if (e?.name === 'AbortError') throw e; }
    }
    return { range: { start: p.start, end: p.end }, focus, cmin: ok[0].cmin, cmax: ok[0].cmax, lines };
  },
  /**
   * Live numbers of the four lines, each line server asked on its own and in parallel (lineOnly=N): a slow or dead line
   * never holds up the others. Same shape as liveLines. When the lines' newest days differ, the lines behind are read
   * again for the common day (a line idle today then shows today's empty hours, not an older day).
   */
  liveLinesParallel: async (p = {}, opts = {}) => {
    const one = (l, date) => liveOne(l, date, p);
    const res = await Promise.allSettled(LINE_IDS.map((l) => one(l, p.date)));
    const abort = res.find((r) => r.status === 'rejected' && r.reason?.name === 'AbortError');
    if (abort) throw abort.reason;
    const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) throw res[0].reason;
    const lines = res.map((r, i) => (r.status === 'fulfilled' ? r.value.lines?.[0] : null)
      || { line: LINE_IDS[i], name: `Line ${LINE_IDS[i]}`, ok: false, error: String(r.reason?.message || r.reason || 'No response'), total: 0, hours: [], hourModels: [] });
    // a line whose last read is of today is running (only slow to answer), never "offline"
    const today = ok.map((j) => j.today).find(Boolean) || null;
    for (let i = 0; i < lines.length; i += 1) lines[i] = todayNotOffline([lines[i]], today)[0];
    const live = ok.filter((j) => { const r = todayNotOffline([j.lines?.[0]], today)[0]; return r?.ok && !r.backup; });
    const focus = p.date || (live.length ? live : ok).map((j) => j.focus).filter(Boolean).sort().pop();
    if (!p.date) {
      await Promise.all(lines.map(async (row, i) => {
        const j = ok.find((x) => x.lines?.[0]?.line === row.line);
        if (!j || !row.ok || row.backup || j.focus === focus) return;
        try { const k = await one(LINE_IDS[i], focus); if (k?.lines?.[0]) lines[i] = todayNotOffline([k.lines[0]], today)[0]; } catch (e) { if (e?.name === 'AbortError') throw e; }
      }));
    }
    const first = ok[0];
    return { focus, today: today || first.today, generatedAt: first.generatedAt, clockOffset: first.clockOffset, lines: steadyLiveRows(lines) };
  },
  /** Live numbers of one line only (its own server). */
  liveLinesOne: async (line, p = {}) => {
    const j = await liveOne(String(line), p.date, p);
    return j?.lines ? { ...j, lines: steadyLiveRows(todayNotOffline(j.lines, j.today)) } : j;
  },
  /** Live numbers of all four lines (polled). */
  liveLines: (p = {}, opts) => get('live_lines.php', { date: p.date, cmin: p.cmin, cmax: p.cmax, line: '1' }, { noCache: true, ...opts }),
  controlData: (start, end, companyId, opts, line) => get('model_control.php', { start, end, companyId, cap: 3600, ...(line ? { line } : {}) }, opts),
  /** Standard cycle time page, method B: ordered scans of one model + rework count (see model_runs.php). */
  modelRuns: (start, end, mmId, opts) => get('model_runs.php', { start, end, mmId }, opts),

  /** Main view: all four lines fetched in parallel and merged. Model ids become "L<line>-<id>" so they never clash. */
  controlDataAll: async (start, end, { cap: capReq = 3600, ...opts } = {}) => {
    const res = await Promise.allSettled(LINE_IDS.map((l) => get('model_control.php', { start, end, cap: capReq, line: l }, opts)));
    const abort = res.find((r) => r.status === 'rejected' && r.reason?.name === 'AbortError');
    if (abort) throw abort.reason;
    const models = [], errors = [];
    let cap = 3600;
    res.forEach((r, i) => {
      const l = LINE_IDS[i];
      if (r.status === 'fulfilled') {
        cap = r.value.cap || cap;
        for (const m of r.value.models || []) models.push({ ...m, line: l, lineName: `Line ${l}`, mmId: `L${l}-${m.mmId}` });
      } else errors.push(`Line ${l}: ${r.reason?.message || r.reason}`);
    });
    if (!models.length && errors.length) throw new Error(errors.join(' | '));
    return { range: { start, end }, cap, models, errors };
  },
};

export const isAbort = (e) => e?.name === 'AbortError';

/** seconds -> "1m 24s" / "45s" */
export function fmtSeconds(sec) {
  if (sec === null || sec === undefined) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function fmtTime(isoLike) {
  if (!isoLike) return '—';
  const d = new Date(isoLike.replace(' ', 'T'));
  if (isNaN(d.getTime())) return isoLike;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

/** shift a YYYY-MM-DD string by N days (local time, no UTC drift) */
export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}