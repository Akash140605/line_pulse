/**
 * Fresh start on a new version: the browser keeps some numbers of the last visit only to draw the screen at
 * once (targets worked out from the scans, line settings, the last live data, OLE pages). They are made by the code of
 * that visit, so a new version must not show them: the first start of a new version drops them and reads everything
 * from the server again. Login, chosen line / TV line, TV look and the user's own settings and entries are kept.
 */
export const CACHE_EPOCH = '2026-11-16d';   // raise it when a change must drop what browsers keep
const MARK = 'ems.cacheEpoch';
const CACHES = ['ems.autoTargets', 'ems.linesettings.', 'ems.olePageCache', 'ems.liveLast.'];

/** Drops the kept numbers (not the login or the user's settings). → number of entries removed. */
export function clearCaches() {
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && CACHES.some((p) => k.startsWith(p))) keys.push(k); }
    for (const k of keys) { localStorage.removeItem(k); n++; }
  } catch { /* storage blocked */ }
  return n;
}

/** At start: a version (code epoch + build id) this browser has not run yet → the kept numbers are dropped first. */
export function freshStart(build = (typeof window !== 'undefined' && window.__LP_BUILD__) || '') {
  const want = `${CACHE_EPOCH}|${build}`;
  try {
    if (localStorage.getItem(MARK) === want) return false;
    clearCaches();
    localStorage.setItem(MARK, want);
    return true;
  } catch { return false; }
}
