import { useCallback, useEffect, useState } from 'react';

const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch { return fb; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full / blocked */ } };

/** Standard cycle per model + loss register (date · hour · model · minutes · reason · person · department). */
export default function useLossData() {
  const [stds, setStds] = useState(() => load('lp_std_v1', {}));
  const [losses, setLosses] = useState(() => load('lp_loss_v1', []));
  useEffect(() => save('lp_std_v1', stds), [stds]);
  useEffect(() => save('lp_loss_v1', losses), [losses]);

  const setStd = useCallback((mmId, sec) => setStds((s) => {
    const n = { ...s };
    if (!(Number(sec) > 0)) delete n[mmId]; else n[mmId] = Number(sec);
    return n;
  }), []);

  const saveLoss = useCallback((e) => setLosses((l) => (e.id
    ? l.map((x) => (x.id === e.id ? e : x))
    : [...l, { ...e, id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}` }])), []);
  const deleteLoss = useCallback((id) => setLosses((l) => l.filter((x) => x.id !== id)), []);

  return { stds, setStd, losses, saveLoss, deleteLoss };
}
