import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isAbort, shiftDate } from '../api';
import { serverNow, syncServerTime } from '../utils/serverTime';

import { refreshSec } from '../utils/refreshConfig';
// live refresh interval (seconds, Setup → Screen refresh, 10 s by default); the range totals refresh every 3rd tick
export const LIVE_SEC = 10;
const LIVE_MS = () => refreshSec('dash') * 1000;

// Outlier filter for cycle-time stats (quantities are never affected). Persisted per browser.
const OUTLIER_DEFAULT = { mode: 'auto', mult: 3, max: 300, min: 1, idle: 60 };
const loadOutlier = () => {
  try { return { ...OUTLIER_DEFAULT, ...JSON.parse(localStorage.getItem('ems.outlier.v1') || '{}') }; } catch { return OUTLIER_DEFAULT; }
};

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Single source of truth for dashboard data.
 *  - 2 data requests only: rangeOverview (daily + models + matrix) and dayOverview (hourly + rejection)
 *  - every request is aborted when a newer one starts -> no stale/out-of-order responses
 *  - min-qty typing is debounced -> no request per keystroke
 *  - previous data stays on screen while new data loads (no flicker)
 */
export default function useDashboard({ idle = false } = {}) {
  // idle = a page that reads its own data is open (Dashboard, OLE …): the line's scan data is not read or polled meanwhile
  // ---- filters -------------------------------------------------------
  const [companyId, setCompanyId] = useState(null);
  const [mmId, setMmId] = useState(null);
  const [minQtyInput, setMinQtyInput] = useState(10);
  const minQty = useDebounced(minQtyInput, 600);
  const [outlier, setOutlierState] = useState(loadOutlier);
  const outlierD = useDebounced(outlier, 500);
  const [range, setRange] = useState(null);
  const [focusDate, setFocusDate] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ---- lookups -------------------------------------------------------
  const [companies, setCompanies] = useState([]);
  const [models, setModels] = useState([]);
  const [latestDate, setLatestDate] = useState(null);

  // ---- data ----------------------------------------------------------
  const [rangeData, setRangeData] = useState(null); // { daily, models, matrix }
  const [dayData, setDayData] = useState(null); // { hourly, rejection }
  const [rangeLoading, setRangeLoading] = useState(false);
  const [dayLoading, setDayLoading] = useState(false);
  const [error, setError] = useState(null);
  // Live is always ON when the page opens. A pause is only for the current visit (it is not remembered),
  // so a forgotten pause never leaves the line view frozen the next day. Old builds stored it; remove that.
  const [live, setLiveState] = useState(() => { try { localStorage.removeItem('ems.live'); } catch { /* ignore */ } return true; });
  const [lastUpdated, setLastUpdated] = useState(null);

  // DB server ke time ka offset ek baar sync karo (lastUpdated DB ke clock se dikhe)
  useEffect(() => { syncServerTime(); }, []);

  // ---- hour drill-down -----------------------------------------------
  const [selected, setSelected] = useState(null); // { date, hour }
  const [hourDetail, setHourDetail] = useState(null);
  const [hourLoading, setHourLoading] = useState(false);
  const hourCtl = useRef(null);

  const filters = useMemo(
    () => ({ companyId, mmId, minQty, outlierMode: outlierD.mode, outlierMult: outlierD.mult, outlierMax: outlierD.max, outlierMin: outlierD.min, outlierIdle: outlierD.idle }),
    [companyId, mmId, minQty, outlierD]
  );
  const fresh = refreshKey > 0;

  const fail = (e) => { if (!isAbort(e)) setError(e.message); };

  // companies (once)
  useEffect(() => {
    const c = new AbortController();
    api.companies({ signal: c.signal }).then(setCompanies).catch(fail);
    return () => c.abort();
  }, []);

  // models for the selected company
  useEffect(() => {
    const c = new AbortController();
    api.models(companyId, { signal: c.signal }).then(setModels).catch(fail);
    return () => c.abort();
  }, [companyId]);

  // latest date with data (+ initial range / focus day)
  useEffect(() => {
    const c = new AbortController();
    api.availableDates({ companyId, mmId }, { signal: c.signal })
      .then((dates) => {
        const latest = dates[0]?.date ?? null;
        setLatestDate(latest);
        if (latest) {
          setRange((r) => r ?? { start: shiftDate(latest, -9), end: latest });
          setFocusDate((f) => f ?? latest);
        }
      })
      .catch(fail);
    return () => c.abort();
  }, [companyId, mmId]);

  // range-level data
  const rangeDone = useRef('');
  useEffect(() => {
    if (!range || idle) return;
    const key = JSON.stringify([range.start, range.end, filters, refreshKey]);
    if (rangeDone.current === key) return;   // back from an idle page: the data on screen is still this
    const c = new AbortController();
    setRangeLoading(true);
    api.rangeOverview(range.start, range.end, filters, { signal: c.signal, fresh })
      .then((d) => {
        rangeDone.current = key;
        setRangeData(d);
        setError(null);
        // keep focus day valid + prefer a day that actually has data
        setFocusDate((f) => {
          const days = d.daily?.days || [];
          const cur = days.find((x) => x.date === f);
          if (cur && cur.quantity > 0) return f;
          const withData = days.filter((x) => x.quantity > 0);
          return withData.length ? withData[withData.length - 1].date : f ?? range.end;
        });
      })
      .catch(fail)
      .finally(() => { if (!c.signal.aborted) setRangeLoading(false); });
    return () => c.abort();
  }, [range?.start, range?.end, filters, refreshKey, idle]);

  // focus-day data
  const dayDone = useRef('');
  useEffect(() => {
    if (!focusDate || idle) return;
    const key = JSON.stringify([focusDate, filters, refreshKey]);
    if (dayDone.current === key) return;
    const c = new AbortController();
    setDayLoading(true);
    setSelected(null);
    setHourDetail(null);
    api.dayOverview(focusDate, filters, { signal: c.signal, fresh })
      .then((d) => { dayDone.current = key; setDayData(d); setError(null); setLastUpdated(serverNow()); })
      .catch(fail)
      .finally(() => { if (!c.signal.aborted) setDayLoading(false); });
    return () => c.abort();
  }, [focusDate, filters, refreshKey, idle]);

  // ---- actions -------------------------------------------------------
  const changeCompany = useCallback((v) => { setCompanyId(v ? Number(v) : null); setMmId(null); }, []);
  const changeModel = useCallback((v) => setMmId(v ? Number(v) : null), []);
  const changeRange = useCallback((r) => {
    setRange(r);
    setFocusDate((f) => (f && f >= r.start && f <= r.end ? f : r.end));
  }, []);
  const setOutlier = useCallback((patch) => setOutlierState((o) => {
    const next = { ...o, ...patch };
    try { localStorage.setItem('ems.outlier.v1', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }), []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const selectHour = useCallback((date, hour) => {
    if (!date || hour === null || hour === undefined) return;
    hourCtl.current?.abort();
    const c = new AbortController();
    hourCtl.current = c;
    setSelected({ date, hour });
    setHourDetail(null);
    setHourLoading(true);
    api.hourDetail(date, hour, filters, { signal: c.signal })
      .then(setHourDetail)
      .catch(fail)
      .finally(() => { if (!c.signal.aborted) setHourLoading(false); });
  }, [filters]);

  const closeDrawer = useCallback(() => {
    hourCtl.current?.abort();
    setSelected(null);
    setHourDetail(null);
    setHourLoading(false);
  }, []);

  // ---- live updates --------------------------------------------------
  // Only the latest day can still change, so we poll only while it is in focus.
  // Silent: no loading flags, no selection reset, skipped while the tab is hidden.
  // `running` guard: a new tick is skipped while the previous one is still in flight.
  const liveActive = live && !!focusDate && focusDate === latestDate;
  useEffect(() => {
    if (!liveActive || !range || idle) return;
    let ctl = new AbortController();
    let ticks = 0;
    let running = false;
    let lastDay = '', lastRng = '';
    const tick = async () => {
      if (document.hidden || running) return;
      running = true;
      ctl = new AbortController();
      const o = { signal: ctl.signal, noCache: true };
      try {
        // The day (live) data every tick; the whole-range data only every 3rd tick (it changes slowly and is heavier).
        const withRange = ticks % 3 === 0;
        const [day, rng] = await Promise.all([
          api.dayOverview(focusDate, filters, o),
          withRange ? api.rangeOverview(range.start, range.end, filters, o) : Promise.resolve(null),
        ]);
        if (ctl.signal.aborted) return;
        // Only update state when the data really changed, so charts do not re-render for nothing.
        const dayKey = JSON.stringify(day);
        if (dayKey !== lastDay) { lastDay = dayKey; setDayData(day); }
        if (rng) { const rngKey = JSON.stringify(rng); if (rngKey !== lastRng) { lastRng = rngKey; setRangeData(rng); } }
        setLastUpdated(serverNow());
        if (++ticks % 12 === 0) {
          // every 2 min: new production day started? move the live view forward
          const dates = await api.availableDates({ companyId, mmId }, o);
          const latest = dates[0]?.date;
          if (latest && latest > latestDate) {
            setLatestDate(latest);
            setRange((r) => ({ start: shiftDate(latest, -(Math.round((new Date(r.end) - new Date(r.start)) / 864e5))), end: latest }));
            setFocusDate(latest);
          }
        }
      } catch (e) { /* transient poll failure: keep last data, try again next tick */ }
      finally { running = false; }
    };
    const id = setInterval(tick, LIVE_MS());
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); ctl.abort(); document.removeEventListener('visibilitychange', onVis); };
  }, [liveActive, range?.start, range?.end, focusDate, filters, latestDate, companyId, mmId, idle]);

  const toggleLive = useCallback(() => setLiveState((v) => !v), []);

  // matrix as { date: { hour: row } } — shape HourlyMatrix expects
  const matrix = useMemo(() => {
    const out = {};
    for (const [date, v] of Object.entries(rangeData?.matrix || {})) {
      out[date] = Object.fromEntries((v.hours || []).map((h) => [h.hour, h]));
    }
    return out;
  }, [rangeData]);

  return {
    // filters
    filters, refreshKey, outlier, setOutlier, outlierDefault: OUTLIER_DEFAULT,
    companies, models, companyId, mmId, minQtyInput, minQty, range, latestDate, focusDate,
    changeCompany, changeModel, setMinQtyInput, changeRange, setFocusDate,
    // data
    daily: rangeData?.daily, modelData: rangeData?.models, matrix,
    summary: dayData?.hourly, rejection: dayData?.rejection,
    isMultiDay: !!range && range.start !== range.end,
    // status
    live, liveActive, toggleLive, lastUpdated,
    loading: rangeLoading || dayLoading, rangeLoading, dayLoading, error, clearError: () => setError(null), refresh,
    // drill-down
    selected, hourDetail, hourLoading, selectHour, closeDrawer,
  };
}