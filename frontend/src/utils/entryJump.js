/**
 * 23-11-2026: open an entry page at one line, day and hour (Entry dashboard → "fill this hour").
 * The dashboard leaves the wish here and switches the page; the entry page takes it once when it opens.
 */
const KEY = 'ems.entryJump';
export function setEntryJump(j) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...j, at: Date.now() })); } catch { /* storage blocked */ }
}
/** the wish (older than a minute: ignored) — read while rendering; a render React throws away (lazy page) reads it again */
export function takeEntryJump() {
  try {
    const s = sessionStorage.getItem(KEY);
    const j = s ? JSON.parse(s) : null;
    return j && Date.now() - (j.at || 0) < 60_000 ? j : null;
  } catch { return null; }
}
/** forget the wish — called once the page is on the screen (useEffect) */
export function clearEntryJump() { try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } }
