/**
 * 23-11-2026: how often the screens read new data — the admin's Setup → Screen refresh (ui_settings.refresh).
 *   ole = OLE, quality, entry and report dashboards · dash = Dashboard / line pages live · masters = targets, shifts, settings
 * The Live lines / TV screens keep their own timing. Read when a page starts its timer.
 */
export const REFRESH_DEFAULT = { ole: 20, dash: 10, masters: 60 };
const LIMIT = { ole: [10, 600], dash: [5, 300], masters: [30, 900] };
let CFG = { ...REFRESH_DEFAULT };

export function normalizeRefresh(r) {
  const x = r && typeof r === 'object' ? r : {};
  const out = {};
  for (const k of Object.keys(REFRESH_DEFAULT)) {
    const n = Math.round(Number(x[k]));
    out[k] = x[k] != null && x[k] !== '' && Number.isFinite(n) ? Math.max(LIMIT[k][0], Math.min(LIMIT[k][1], n)) : REFRESH_DEFAULT[k];
  }
  return out;
}
export const setRefreshConfig = (r) => { CFG = normalizeRefresh(r); };
export const refreshSec = (k) => CFG[k] ?? REFRESH_DEFAULT[k];
export const refreshMs = (k) => refreshSec(k) * 1000;
