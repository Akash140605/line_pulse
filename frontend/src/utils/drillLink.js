/**
 * Open the Loss analysis drill-down from another page with a period, a loss type and filters already set,
 * e.g. a department or a reason clicked on the Dashboard. The hand-over lives in this tab's sessionStorage and is read
 * once when the Loss analysis page opens.
 */
export const OPEN_KEY = 'ems.lossan.open';

export function openLossAnalysis(onOpen, { start, end, type = 'loss', filters = [] }) {
  try { sessionStorage.setItem(OPEN_KEY, JSON.stringify({ start, end, type, filters })); } catch { /* storage blocked: opens with its own period */ }
  onOpen?.('lossan');
}

/** Open the OLE drill-down with a factor (A / P / Q), a line and a period already picked (from the Overall OLE page). */
export const OLE_OPEN_KEY = 'ems.oledrill.open';
export function openOleDrill(onOpen, { f = 'P', line = null, start, end }) {
  try { sessionStorage.setItem(OLE_OPEN_KEY, JSON.stringify({ f, line, start, end })); } catch { /* storage blocked: opens with its own period */ }
  onOpen?.('oledrill');
}
/** The OLE drill-down hand-over, once (null when the page was opened from the sidebar). */
export function takeOleDrill() {
  try {
    const v = JSON.parse(sessionStorage.getItem(OLE_OPEN_KEY) || 'null');
    sessionStorage.removeItem(OLE_OPEN_KEY);
    return v && ['A', 'P', 'Q'].includes(v.f) && /^\d{4}-\d{2}-\d{2}$/.test(v.start || '') && /^\d{4}-\d{2}-\d{2}$/.test(v.end || '') ? v : null;
  } catch { return null; }
}

/** The hand-over, once (null when the page was opened from the sidebar). */
export function takeOpen() {
  try {
    const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) || 'null');
    sessionStorage.removeItem(OPEN_KEY);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v.start || '') && /^\d{4}-\d{2}-\d{2}$/.test(v.end || '') ? v : null;
  } catch { return null; }
}

/** Open a deep page of the OLE (Availability / Performance / Quality, as the MES focus pages) with the period and line kept. */
export const FOCUS_OPEN_KEY = 'ems.olefocus.open';
export function openOleFocus(onOpen, { f = 'A', line = null, start, end }) {
  try { sessionStorage.setItem(FOCUS_OPEN_KEY, JSON.stringify({ f, line, start, end, at: Date.now() })); } catch { /* storage blocked: opens on this month */ }
  onOpen?.({ A: 'olea', P: 'olep', Q: 'oleq' }[f]);
}
export function takeOleFocus(f) {
  try {
    const v = JSON.parse(sessionStorage.getItem(FOCUS_OPEN_KEY) || 'null');
    if (!v || v.f !== f || !(Date.now() - (v.at || 0) < 15000)) return null;
    // kept a moment: the page may be drawn twice while it opens (both get the hand-over); a later visit from the sidebar does not
    setTimeout(() => { try { sessionStorage.removeItem(FOCUS_OPEN_KEY); } catch { /* blocked */ } }, 3000);
    return /^\d{4}-\d{2}-\d{2}$/.test(v.start || '') && /^\d{4}-\d{2}-\d{2}$/.test(v.end || '') ? v : null;
  } catch { return null; }
}
