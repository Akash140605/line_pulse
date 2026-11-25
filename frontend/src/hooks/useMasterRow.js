import { useEffect, useState } from 'react';
import { masterAnyFor, masterReady } from '../utils/targetMethods';
import { loadMaster } from './useAutoTargets';

/*
 * The Model master row of a model running on a line ({model, company, modelCode}) — segment, capacity, type, description.
 * The master is read once and again every 10 min (one request for every screen), and matched like Method D does
 * (WT11A4260GD ↔ WT11A4260GD/TL …). null while it is not known or the model is not in the master.
 */
const EVERY = 10 * 60 * 1000;
let at = 0; let inflight = null; const subs = new Set();
function refresh() {
  if (inflight || (masterReady() && Date.now() - at < EVERY)) return;
  inflight = loadMaster().finally(() => { at = Date.now(); inflight = null; subs.forEach((f) => { try { f(); } catch { /* */ } }); });
}
export default function useMasterRow(m) {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f); refresh();
    const id = setInterval(refresh, EVERY);
    return () => { subs.delete(f); clearInterval(id); };
  }, []);
  return m?.model ? masterAnyFor(m) : null;   // with or without a cycle time (segment, details)
}
