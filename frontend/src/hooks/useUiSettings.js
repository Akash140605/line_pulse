import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { normalizeUi, ruleKeyOf } from '../utils/uiSettings';
import { applySavedTheme } from '../utils/themeEngine';
import { setOleConfig } from '../utils/ole';
import { setRefreshConfig, refreshMs } from '../utils/refreshConfig';

/**
 * Screen setup (see utils/uiSettings.js). Starts from the copy kept in this browser so the right pages show at once,
 * then reads the server copy (every minute too, and whenever the Setup page saves).
 * An older backend without ui_settings.php simply keeps the defaults.
 */
const LS = 'ems.ui';
export const UI_EVENT = 'ems:ui-settings';
export const RULE_EVENT = 'ems:target-rule';   // the target rule read from the server differs from the one kept here
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
const writeLocal = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* private window */ } };
/** The screen setup kept in this browser (kept fresh by useUiSettings), for pieces that only read one value. */
export const savedUi = () => normalizeUi(readLocal() || {});

export default function useUiSettings() {
  const [ui, setUi] = useState(() => normalizeUi(readLocal() || {}));
  const [loaded, setLoaded] = useState(false);
  const themeKey = JSON.stringify(ui.theme);
  setOleConfig(ui.ole);
  setRefreshConfig(ui.refresh);   // the admin's screen refresh (Setup → Screen refresh)   // the admin's OLE formulas (Setup → Masters → OLE formulas), before any OLE is worked out
  useEffect(() => { applySavedTheme(ui.theme); }, [themeKey]);   // colours / fonts / text size of Setup → Theme, on every screen
  const load = useCallback(async () => {
    try {
      const j = await api.uiSettings(); const n = normalizeUi(j || {});
      // the target rule was changed on the server (another screen / the admin): the automatic targets are worked out again
      const before = readLocal(); const changed = !!before && ruleKeyOf(normalizeUi(before).targetRule) !== ruleKeyOf(n.targetRule);   // first visit: the normal start-up read does it
      setUi(n); writeLocal(n);
      if (changed) { try { window.dispatchEvent(new Event(RULE_EVENT)); } catch { /* old browser */ } }
    } catch { /* keep what we have */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, refreshMs('masters'));
    window.addEventListener(UI_EVENT, load);
    return () => { clearInterval(id); window.removeEventListener(UI_EVENT, load); };
  }, [load]);
  const save = useCallback(async (next, action = 'save') => {
    const j = await api.saveUiSettings(action === 'reset' ? { action: 'reset' } : { action: 'save', settings: next });
    const n = normalizeUi(j || next); setUi(n); writeLocal(n);
    try { window.dispatchEvent(new Event(UI_EVENT)); } catch { /* old browser */ }
    return n;
  }, []);
  return { ui, loaded, save, reload: load };
}
