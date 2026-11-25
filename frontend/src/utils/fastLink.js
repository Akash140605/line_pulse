/**
 * The development server (:5173) runs the software unpacked and in React's debug mode — 3 to 5 times slower than the
 * built copy. Every PC that opens :5173 is sent to the built copy (same page, same address after the ?, same #part)
 * (19-11-2026). Never moved: a TV (?tv=… link, a TV login, an Android TV web view), the server PC itself (localhost),
 * and a developer who opens :5173 once with ?dev (kept for that tab).
 */
export const FAST_PATH = '/ems-dashboard/frontend/dist/';
export const FAST_PORT = '8080';

export function fastUrl(loc) {
  return `${loc.protocol}//${loc.hostname}:${FAST_PORT}${FAST_PATH}${loc.search || ''}${loc.hash || ''}`;
}

/** Should this page leave the development server? (pure: all inputs given) */
export function shouldLeave({ dev, loc, ua = '', role = '', stay = false }) {
  if (!dev || !loc || String(loc.port) !== '5173') return false;
  if (stay) return false;
  const host = String(loc.hostname || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return false;
  const q = new URLSearchParams(loc.search || '');
  if (q.has('tv') || q.has('dev')) return false;
  if (role === 'tv') return false;
  if (/;\s*wv\)/i.test(ua) || /\b(SMART-TV|SmartTV|Android TV|AFT\w+|BRAVIA|Tizen|Web0S|webOS)\b/i.test(ua)) return false;
  return true;
}

/** Runs at start: true when the browser is being sent to the built copy (draw nothing then). */
export function leaveDevServer() {
  try {
    const dev = !!(import.meta.env && import.meta.env.DEV);
    if (!dev) return false;
    const loc = window.location;
    if (new URLSearchParams(loc.search).has('dev')) { try { sessionStorage.setItem('ems.stayDev', '1'); } catch { /* blocked */ } }
    let stay = false; try { stay = sessionStorage.getItem('ems.stayDev') === '1'; } catch { /* blocked */ }
    let role = ''; try { role = JSON.parse(localStorage.getItem('ems.auth') || 'null')?.role || ''; } catch { /* none */ }
    if (!shouldLeave({ dev, loc, ua: navigator.userAgent || '', role, stay })) return false;
    window.location.replace(fastUrl(loc));
    return true;
  } catch { return false; }
}
