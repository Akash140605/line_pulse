import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { SHIFT_PLANT } from '../utils/shift';
import useAutoTargets, { mergeTargets, isLineD, goodD } from './useAutoTargets';

const LS = (line) => `ems.linesettings.${line}`;
const readLocal = (line) => { try { return JSON.parse(localStorage.getItem(LS(line)) || 'null'); } catch { return null; } };
const writeLocal = (line, v) => { try { localStorage.setItem(LS(line), JSON.stringify(v)); } catch { /* storage blocked */ } };
import { refreshMs } from '../utils/refreshConfig';
const REFRESH_MS = () => refreshMs('masters');   // other screens pick up a changed target / shift within a minute

/**
 * Shift + lunch window and model targets of one line, stored on the server (backend/data) so every screen shows
 * the same values. The last answer is remembered in the browser, so the page starts with it even before the server answers.
 */
export default function useLineSettings(line) {
  const [data, setData] = useState(() => readLocal(line) || { shift: SHIFT_PLANT, targets: {}, shiftIsDefault: true });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const auto = useAutoTargets();   // Method A + 3 s of every model (overrides the saved target)

  const load = useCallback(async () => {
    if (!line || line === 'all') return;
    try {
      const j = await api.lineSettings(line);
      if (!alive.current) return;
      setData(j); writeLocal(line, j); setError('');
    } catch (e) { if (alive.current) setError(String(e.message || e)); }
  }, [line]);

  useEffect(() => {
    alive.current = true;
    setData(readLocal(line) || { shift: SHIFT_PLANT, targets: {}, shiftIsDefault: true });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS());
    return () => { alive.current = false; clearInterval(id); };
  }, [line, load]);

  const save = useCallback(async (body) => {
    setSaving(true);
    try {
      const j = await api.saveLineSettings(line, body);
      setData(j); writeLocal(line, j); setError('');
      return j;
    } finally { setSaving(false); }
  }, [line]);

  return {
    shift: data.shift || SHIFT_PLANT, targets: mergeTargets(data.targets, autoOf(auto, String(line)), isLineD(auto, line)), savedTargets: data.targets || {}, shiftIsDefault: !!data.shiftIsDefault, updatedAt: data.updatedAt,
    ...periodsOf(auto, String(line), data.targets),
    money: data.money || { pcValue: null, hourCost: null, values: {} },
    error, saving, reload: load,
    saveShift: (shift, allLines = false) => save({ action: 'shift', shift, allLines }),
    saveTarget: (t) => save({ action: 'target', ...t }),
    saveTargets: (items) => save({ action: 'targets', items }),
  };
}

/** Settings of several lines at once (Main view): { [line]: {shift, targets} }, refreshed every minute. */
export function useAllLineSettings(lines) {
  const [all, setAll] = useState(() => Object.fromEntries(lines.map((l) => [l, readLocal(l) || { shift: SHIFT_PLANT, targets: {} }])));
  const key = lines.join(',');
  const auto = useAutoTargets();
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await Promise.allSettled(lines.map((l) => api.lineSettings(l)));
      if (!alive) return;
      setAll((prev) => {
        const n = { ...prev };
        res.forEach((r, i) => { if (r.status === 'fulfilled') { n[lines[i]] = r.value; writeLocal(lines[i], r.value); } });
        return n;
      });
    };
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS());
    // a screen that saved settings (₹ rates, targets) asks every open view to reload them at once
    window.addEventListener(SETTINGS_EVENT, load);
    return () => { alive = false; clearInterval(id); window.removeEventListener(SETTINGS_EVENT, load); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // effective targets = saved ones with Method A + 3 s on top; savedTargets keeps what was saved
  return useMemo(() => Object.fromEntries(Object.entries(all).map(([l, s]) => [l, { ...s, savedTargets: s?.targets || {}, targets: mergeTargets(s?.targets, autoOf(auto, l), isLineD(auto, l)), ...periodsOf(auto, l, s?.targets) }])), [all, auto]);
}

/**
 * 20-11-2026: target method by date — { targetPeriods: [{ from, to, method, targets }] } of a line whose method was
 * changed from a date (each period: its method's targets with the saved / locked ones, as on the screens); {} otherwise.
 */
const periodsOf = (auto, l, saved) => {
  const P = auto?.periods?.[l];
  if (!P?.length) return {};
  return { targetPeriods: P.map((p) => ({ from: p.from, to: p.to, method: p.method, add: p.add, pct: p.pct, targets: mergeTargets(saved, p.method === 'D' && !Object.keys(p.targets || {}).length ? goodD(l) : p.targets, p.method === 'D') })) };
};

/** A Method D line's targets: the worked-out set, else (still loading / its server slow) the last good set. */
const autoOf = (auto, l) => { const a = auto?.byLine?.[l]; return a && Object.keys(a).length ? a : isLineD(auto, l) ? goodD(l) : a; };

export const SETTINGS_EVENT = 'ems:line-settings';
/** Tell every useAllLineSettings on the page to reload now. */
export const settingsChanged = () => { try { window.dispatchEvent(new Event(SETTINGS_EVENT)); } catch { /* old browser */ } };
