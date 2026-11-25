import { useEffect, useState } from 'react';
import { api, isAbort } from '../api';

/**
 * Loads the analytics payload only while an analytics page is open (enabled).
 * pollMs > 0 -> silent background refresh (used while the dashboard is LIVE).
 */
export default function useAnalytics({ range, filters, enabled, refreshKey, pollMs = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !range) return;
    const c = new AbortController();
    setLoading(true);
    api.analytics(range.start, range.end, filters, { signal: c.signal, fresh: refreshKey > 0 })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => { if (!isAbort(e)) setError(e.message); })
      .finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [enabled, range?.start, range?.end, filters, refreshKey]);

  useEffect(() => {
    if (!enabled || !range || !pollMs) return;
    let ctl = new AbortController();
    const id = setInterval(() => {
      if (document.hidden) return;
      ctl.abort(); ctl = new AbortController();
      api.analytics(range.start, range.end, filters, { signal: ctl.signal, noCache: true }).then(setData).catch(() => {});
    }, pollMs);
    return () => { clearInterval(id); ctl.abort(); };
  }, [enabled, range?.start, range?.end, filters, pollMs]);

  return { data, loading, error };
}
