/**
 * 23-11-2026: the notification and welcome setup (Setup → Notifications), kept apart from utils/notify.js so that
 * utils/uiSettings.js can clean it without loading the alert logic. Same rules as be/lib/ui.php ui_notify / ui_welcome.
 */
export const NOTIFY_GROUPS = [
  ['admin', 'Administrators'],
  ['sup', 'Supervisors'],
  ['dept', 'Department users'],
  ['view', 'Management viewers'],
];

/** param: the limit the administrator sets (kind num = number, time = HH:MM) */
export const NOTIFY_RULES = [
  { id: 'offline', label: 'Line server not responding', about: 'A line server does not respond, or the screen shows its backup copy.', sev: 'high', to: ['admin', 'sup'], page: 'overview' },
  { id: 'noCycle', label: 'Model without a cycle time', about: 'A model was produced today without a cycle time; it receives no target until one is entered in the Model master.', sev: 'mid', to: ['admin'], page: 'master' },
  { id: 'lowHour', label: 'Hourly output below target', about: 'A completed hour achieved less than the set share of its target.', sev: 'mid', to: ['admin', 'sup', 'view'], page: 'hourly',
    param: { key: 'pct', label: 'Alert below', unit: '% of the hourly target', kind: 'num', def: 85, min: 50, max: 100 } },
  { id: 'lossPending', label: 'Loss entry pending', about: 'A completed hour below target has no loss entry after the set time.', sev: 'mid', to: ['admin', 'sup'], page: 'oleentry',
    param: { key: 'min', label: 'Alert after', unit: 'minutes from the end of the hour', kind: 'num', def: 30, min: 5, max: 240 } },
  { id: 'morning', label: 'Morning entry not submitted', about: 'A line is producing but its morning entry (manpower and shift) has not been saved by the set time.', sev: 'low', to: ['admin', 'sup'], page: 'daily',
    param: { key: 'at', label: 'Alert after', unit: '(time of day)', kind: 'time', def: '09:30' } },
  { id: 'rejects', label: 'High rejection', about: 'The rejected quantity of a line today exceeds the set number of pieces.', sev: 'high', to: ['admin', 'dept', 'view'], page: 'qentry',
    param: { key: 'pcs', label: 'Alert above', unit: 'rejected pieces per line per day', kind: 'num', def: 10, min: 1, max: 1000 } },
  // 27-11-2026: the CAPA loop (utils/capaLoop.js) — a department login sees only its own department's CAPAs
  { id: 'capa', label: 'CAPA follow-up (loop)', about: 'A CAPA step is late — not written, action past its target, verification due — or the defect came back after the action. Shows the escalation (L1 owner · L2 department head · L3 plant head).', sev: 'high', to: ['admin', 'dept'], page: 'capatrack',
    param: { key: 'days', label: 'Alert when late by', unit: 'days or more (0 = on the due day)', kind: 'num', def: 1, min: 0, max: 30 } },
];
export const RULE_BY_ID = Object.fromEntries(NOTIFY_RULES.map((r) => [r.id, r]));
export const WELCOME_DEFAULT = { on: true, title: '{greeting}, {name}', text: 'Welcome to Dixon Line Pulse. Please review the notifications for your lines.' };

const LOGIN_RE = /^[a-z0-9._-]{1,40}$/;
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const clampNum = (v, p) => { const n = Number(v); return Number.isFinite(n) ? Math.max(p.min, Math.min(p.max, Math.round(n))) : p.def; };

/** The notification setup as saved (same rules as be/lib/ui.php ui_notify). */
export function normalizeNotify(n) {
  const src = n && typeof n === 'object' ? n : {};
  const rules = {};
  for (const r of NOTIFY_RULES) {
    const x = (src.rules && typeof src.rules === 'object' ? src.rules[r.id] : null) || {};
    const to = Array.isArray(x.to) ? NOTIFY_GROUPS.map(([g]) => g).filter((g) => x.to.includes(g)) : [...r.to];
    const users = Array.isArray(x.users) ? [...new Set(x.users.map((u) => String(u).toLowerCase().trim()).filter((u) => LOGIN_RE.test(u)))].slice(0, 100) : [];
    const lines = Array.isArray(x.lines) ? [...new Set(x.lines.map(String).filter((l) => /^\d{1,2}$/.test(l)))].sort() : [];
    const o = { on: x.on === undefined ? true : !!x.on, to, users, lines };
    if (r.param) o[r.param.key] = r.param.kind === 'time' ? (hm(x[r.param.key]) || r.param.def) : clampNum(x[r.param.key], r.param);
    rules[r.id] = o;
  }
  return { on: src.on === undefined ? true : !!src.on, rules };
}
export function normalizeWelcome(w) {
  const s = w && typeof w === 'object' ? w : {};
  // typed text is kept as it is (the server trims it and puts the standard text back when it is empty)
  const t = (v, max, def) => (typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, max) : def);
  return { on: s.on === undefined ? WELCOME_DEFAULT.on : !!s.on, title: t(s.title, 80, WELCOME_DEFAULT.title), text: t(s.text, 240, WELCOME_DEFAULT.text) };
}
