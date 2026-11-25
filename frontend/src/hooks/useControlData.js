import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const cache = new Map();

/** Loads raw scan gaps (per model, per day) for a date range. line = '1'..'4' or 'all' (all four lines merged). */
export default function useControlData({ start, end, companyId, line = '1', enabled = true, initialData = null }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ctl = useRef(null);

  const load = useCallback(async (force = false) => {
    if (initialData || !enabled || !start || !end) return;
    const all = line === 'all';
    const key = `${line}|${start}|${end}|${all ? '' : companyId || ''}`;
    if (!force && cache.has(key)) { setData(cache.get(key)); setError(''); return; }

    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    setError('');
    try {
      const json = all
        ? await api.controlDataAll(start, end, { signal: c.signal, fresh: force })
        : await api.controlData(start, end, companyId || null, { signal: c.signal, fresh: force }, line);
      if (json?.error) throw new Error(json.error);
      cache.set(key, json);
      setData(json);
    } catch (e) {
      if (e.name !== 'AbortError') {
        const msg = String(e.message || e);
        setError(msg === 'Failed to fetch' ? 'The server did not respond (model_control.php not found or the query timed out).' : msg);
        setData(null);
      }
    } finally { if (ctl.current === c) setLoading(false); }
  }, [start, end, companyId, line, enabled, initialData]);

  useEffect(() => { load(false); return () => ctl.current?.abort(); }, [load]);

  return { data, loading, error, reload: () => load(true) };
}