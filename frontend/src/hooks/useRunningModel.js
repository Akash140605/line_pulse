import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * The model running on a line right now = the model of the last scan (live_lines.php, shared 4-second server copy),
 * with its company, today's quantity and its current cycle (median of its last gaps). Polled every 15 s while enabled.
 */
export default function useRunningModel(line, enabled) {
  const [run, setRun] = useState(null);
  useEffect(() => {
    if (!enabled || !line || line === 'all') { setRun(null); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const j = await api.liveLinesOne(line, { cmin: 1, cmax: 22 });   // only this line's server is asked
        const l = (j?.lines || []).find((x) => String(x.line) === String(line));
        if (alive && l?.ok && !l.backup && l.model) {
          setRun({ mmId: l.mmId ?? l.running?.mmId ?? null, model: l.model, company: l.company || l.running?.company || '',
            currentCycle: l.running?.currentCycle ?? null, avgCycle: l.running?.avgCycle ?? null, qty: l.running?.qty ?? null, lastScan: l.lastScan,
            firstScan: l.firstScan ?? null, total: l.total ?? null,
            // the running model's continuous run (since the line last changed to it), for its actual cycle
            runFirst: l.running?.runFirst ?? null, runQty: l.running?.runQty ?? null, runLast: l.running?.lastScan ?? l.lastScan ?? null });
        }
      } catch { /* keep the last known value */ }
    };
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [line, enabled]);
  return run;
}
