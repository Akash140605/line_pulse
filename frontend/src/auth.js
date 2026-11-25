/**
 * Login state of this browser: { token, exp, user, role, display } in localStorage.
 * The token goes with every API request (X-EMS-Auth header). A 401 answer means the login ended:
 * the stored login is removed and the app shows the login page again.
 */
const KEY = 'ems.auth';
export const AUTH_EVENT = 'ems:auth';

export function getAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (fromOldLink(a)) { localStorage.removeItem(KEY); return null; }   // an old TV link: log in again
    if (a && a.token && a.exp * 1000 > Date.now()) return a;
  } catch { /* storage blocked */ }
  return null;
}
export function setAuth(a) {
  try { if (a) localStorage.setItem(KEY, JSON.stringify(a)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* old browser */ }
}
export const clearAuth = () => setAuth(null);

/**
 * no screen opens without a login any more — the old TV links (?tv=3&key=…) and the TV address without a
 * login (?tv=3) are switched off. A TV logs in once with its TV login (user ID + password); ?tv=3 then still opens Line 3.
 * A login kept from an old TV link (a key that lasts years) is dropped, so that TV shows the login page.
 */
const LOGIN_DAYS = 8;   // a normal login lasts 7 days (backend AUTH_TTL)
const fromOldLink = (a) => !!a && a.exp * 1000 > Date.now() + LOGIN_DAYS * 86400 * 1000;
export const authHeader = () => { const a = getAuth(); return a ? { 'X-EMS-Auth': a.token } : {}; };
export const isAdmin = (a = getAuth()) => a?.role === 'admin';
