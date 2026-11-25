import { useCallback, useState } from 'react';
import { DEFAULT_SETTINGS } from '../utils/analysis';

const KEY = 'ems.takt.v1';
const load = () => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULT_SETTINGS; }
};

/** Takt / working-window settings, remembered per browser. */
export default function useTakt() {
  const [settings, setSettings] = useState(load);
  const save = useCallback((next) => {
    setSettings(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);
  return [settings, save];
}
