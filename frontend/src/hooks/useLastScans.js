/**
 * 25-11-2026: the minute of each line's last scan on the finished days on screen (≤ 7 days), so the plan of the screens ends
 * where the HPR / SAWM KPI plan ends (utils/lastScans.js — one small read per line-day, kept for the session).
 */
import { useEffect, useState } from 'react';
import { loadLastScans } from '../utils/lastScans';

export function useLastScans({ R, ids, today, maxDays = 7 }) {
  const [ls, setLs] = useState({});
  const days = R?.days || [];
  const key = R ? `${days.length}|${days[0]?.date}|${days[days.length - 1]?.date}|${(ids || []).join()}|${days.map((d) => (ids || []).map((l) => d.byLine?.[l]?.total?.qty || 0).join(',')).join(';')}` : '';
  useEffect(() => {
    if (!R || !days.length || days.length > maxDays) { setLs((v) => (Object.keys(v).length ? {} : v)); return undefined; }
    const c = new AbortController();
    loadLastScans({ R, ids }, today, { signal: c.signal }).then((m) => setLs(m || {})).catch(() => { /* not read: the whole last hour */ });
    return () => c.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return ls;
}
