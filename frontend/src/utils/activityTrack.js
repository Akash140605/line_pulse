/**
 * 20-11-2026: what a login does goes to the activity log (backend lib/activity.php, Setup → Activity log for the admin):
 * the pages it opens and its log out. Logins, failed logins and every change are written by the server itself.
 * A TV screen is never logged.
 */
import { useEffect } from 'react';
import { activityNote } from '../api';
import { getAuth, AUTH_EVENT } from '../auth';

const SEEN_KEY = 'ems.actSeen';
const AGAIN_MS = 15 * 60 * 1000;
let CUR = { page: '', title: '' };   // the page on screen (for a page error note)
export const currentPage = () => CUR;   // the same page again within 15 minutes (on this tab) is not written again

/** this login opened a page (page id, its name, the line or 'all') */
export function useActivityPage(page, title = '', line = '') {
  useEffect(() => { CUR = { page: String(page || ''), title: String(title || '').slice(0, 60) }; }, [page, title]);
  useEffect(() => {
    const a = getAuth();
    if (!page || !a || a.role === 'tv') return;
    let seen = {};
    try { seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { seen = {}; }
    const k = `${a.user}|${page}|${line}`;
    const now = Date.now();
    if (seen[k] && now - seen[k] < AGAIN_MS) return;
    seen[k] = now;
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* storage blocked */ }
    activityNote({ action: 'view', page, title: String(title || '').slice(0, 60), line: String(line || '') });
  }, [page, line]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** the log out of this login: its key is sent once more, just before the screen drops it (a login that ended is not noted) */
export function useActivityLogout() {
  useEffect(() => {
    let cur = getAuth();
    const on = () => {
      const a = getAuth();
      if (!a && cur?.token && cur.role !== 'tv') activityNote({ action: 'logout' }, cur.token);
      cur = a;
    };
    window.addEventListener(AUTH_EVENT, on);
    return () => window.removeEventListener(AUTH_EVENT, on);
  }, []);
}

/**
 * 25-11-2026: a page that crashed in the browser — its message and the first lines of the stack go to the activity log
 * (Setup → Activity log → Page errors), so the admin sees the exact error. The same error on the same page: once per
 * 10 minutes on this tab. A TV screen is never logged.
 */
const ERR_SEEN = {};
export function notePageError(err, info) {
  try {
    const a = getAuth();
    if (!a || a.role === 'tv') return;
    const { page, title } = CUR;
    const message = String(err?.message || err || 'Unknown error').slice(0, 200);
    const k = `${page}|${message}`;
    if (ERR_SEEN[k] && Date.now() - ERR_SEEN[k] < 10 * 60 * 1000) return;
    ERR_SEEN[k] = Date.now();
    const stack = [String(err?.stack || '').split('\n').slice(1, 4).join('\n'), String(info?.componentStack || '').split('\n').filter((x) => x.trim()).slice(0, 3).join('\n')].filter(Boolean).join('\n');
    activityNote({ action: 'error', page: /^[a-z]{0,20}$/.test(page) ? page : '', title, message, stack: stack.slice(0, 1500), build: String(window.__LP_BUILD__ || '') });
  } catch { /* never in the way */ }
}
