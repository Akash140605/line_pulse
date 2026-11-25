import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

const OLD_KEY = 'lp_loss_v1';   // loss entries kept in this browser by the older version (not per line)
const readOld = () => { try { const v = JSON.parse(localStorage.getItem(OLD_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/**
 * Loss register of a line for a period, stored on the server (backend/data/losses_line<N>.json).
 * Shared by every screen; refreshed every minute. Older entries kept in this browser can be moved to a line once.
 */
export default function useLosses(line, start, end) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oldCount, setOldCount] = useState(() => readOld().length);

  const load = useCallback(async () => {
    if (!line || line === 'all' || !start || !end) return;
    try { const j = await api.losses(line, start, end); setEntries(j.entries || []); setError(''); }
    catch (e) { setError(String(e.message || e)); }
  }, [line, start, end]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const act = useCallback(async (body) => {
    setBusy(true);
    try { const j = await api.lossAction(line, body); await load(); return j; }
    finally { setBusy(false); }
  }, [line, load]);

  return {
    entries, error, busy, reload: load,
    save: (entry) => act({ action: 'save', entry }),
    remove: (id) => act({ action: 'delete', id }),
    oldCount,
    /** Move the entries this browser kept (older version) to this line; afterwards they are removed from the browser. */
    importOld: async () => {
      const j = await act({ action: 'import', entries: readOld() });
      try { localStorage.removeItem(OLD_KEY); } catch { /* ignore */ }
      setOldCount(0);
      return j;
    },
  };
}
