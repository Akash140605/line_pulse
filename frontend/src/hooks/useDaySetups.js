import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Morning entries (api/ole.php setup) of one day: { "date|line": { mp, start, end, lunchStart, lunchEnd, breaks, by, at } }.
 * The live screens and the line pages use the day's shift from it instead of the shift master (utils/shift.js shiftOfDay).
 * Shared by every screen of the page (one read per day), read again every minute and at once after a morning entry is saved.
 */
export const SETUP_EVENT = 'ems:setup-saved';
const cache = new Map();   // date → { at, data, p }
const subs = new Set();
const REFRESH_MS = 60_000;

export function loadDaySetups(date, force = false) {
  if (!date) return Promise.resolve({});
  const c = cache.get(date);
  if (!force && c?.data && Date.now() - c.at < REFRESH_MS) return Promise.resolve(c.data);
  if (c?.p) return c.p;
  const p = api.oleEntries(date, date)
    .then((j) => { const data = j?.setup || {}; cache.set(date, { at: Date.now(), data }); subs.forEach((f) => f(date, data)); return data; })
    .catch(() => cache.get(date)?.data || {})
    .finally(() => { const x = cache.get(date); if (x) delete x.p; });
  cache.set(date, { ...(c || { at: 0, data: null }), p });
  return p;
}
/** Tell every screen that a morning entry was saved (they read the day again). */
export const setupSaved = () => {
  cache.clear();   // a screen that opens later reads the day again too (not the copy of the last minute)
  try { window.dispatchEvent(new Event(SETUP_EVENT)); } catch { /* old browser */ }
};

export default function useDaySetups(date) {
  const [data, setData] = useState(() => cache.get(date)?.data || {});
  useEffect(() => {
    if (!date) return undefined;
    let alive = true;
    const on = (d, v) => { if (alive && d === date) setData(v); };
    subs.add(on);
    setData(cache.get(date)?.data || {});
    loadDaySetups(date).then((v) => { if (alive) setData(v); });
    const id = setInterval(() => { if (!document.hidden) loadDaySetups(date); }, REFRESH_MS);
    const again = () => loadDaySetups(date, true);
    window.addEventListener(SETUP_EVENT, again);
    return () => { alive = false; subs.delete(on); clearInterval(id); window.removeEventListener(SETUP_EVENT, again); };
  }, [date]);
  return data;
}
