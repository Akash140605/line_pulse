import { describeLoadError } from '../utils/offline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, LINE_COLOR, fs } from '../theme';
import { ComposedChart, Bar, Cell, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, ReferenceLine } from 'recharts';
import { Pause, Play, BarChart3 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useHeaderSlot } from './HeaderBar';
import LiveLine from './LiveLine';
import { TV_LOOKS } from './TvStage';
import useMediaQuery from '../hooks/useMediaQuery';
import { api, LINE_IDS } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { targetOf, pphOf, hourPlanOf } from '../utils/targets';
import useDaySetups from '../hooks/useDaySetups';
import { workSecInHour, hourSpanLabel, SHIFT_PLANT, realCycleSec, runCycleOf, shiftOfDay } from '../utils/shift';
import { serverNow } from '../utils/serverTime';

const LIVE_MS = 10000; // every 10 s (the server keeps a 4 s shared copy for several viewers)
const pad = (n) => String(n).padStart(2, '0');
const nf = (v) => (v == null ? '—' : Number(v).toLocaleString());
const COLORS = LINE_COLOR;
const tick = { fontSize: fs(13), fill: '#1E293B', fontFamily: '"IBM Plex Mono", ui-monospace, monospace' };
// 24-11-2026: the same strip in the light filter row of the page header (not on the TV)
const STATUS_LIGHT = {
  connecting: 'bg-sky-50 text-sky-800 border-sky-200',
  live: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  stale: 'bg-slate-100 text-slate-700 border-slate-300',
  offline: 'bg-red-50 text-red-800 border-red-200',
};
const STATUS = {
  connecting: { cls: 'bg-sky-400/20 text-sky-200', text: 'Connecting…' },
  live: { cls: 'bg-sky-500/25 text-sky-300', text: 'Live' },
  stale: { cls: 'bg-slate-400/25 text-slate-200', text: 'Connection lost' },
  offline: { cls: 'bg-red-500/25 text-red-200', text: 'Offline · retrying' },
};

/** All four production lines on one screen: four live animated lines + combined hourly output. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const whenText = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || ''); return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}, ${m[4]}:${m[5]}` : '—'; };

/** A line whose server does not answer and has not produced today: OFFLINE, no old numbers. */
export function OfflineToday({ l, tv, accent = '#64748B' }) {
  // no answer from the line (or nothing from today): calm card in the screen's own style, no error text
  const msg = String(l.error || l.offlineError || '');
  const slow = /took longer|timeout|timed out/i.test(msg) && !/Login|08001|not reachable|TCP Provider|Named Pipes/i.test(msg);
  const last = l.backup?.upTo;
  const reading = !!l.waiting;   // first answer of a slow line still on its way: not offline, just reading
  return (
    <section aria-label={`${l.name} offline`} className={`relative rounded-2xl overflow-hidden border border-dixon-navy shadow-lg lp-tv-bg text-white min-w-0 flex flex-col ${tv ? 'h-full' : 'min-h-[260px] lg:h-full'}`}
      style={{ borderTop: `4px solid ${accent}` }}>
      <style>{`
        .lp-ping{position:absolute;inset:0;border-radius:9999px;border:2px solid rgba(56,189,248,.55);animation:lpPing 2.4s cubic-bezier(.2,.6,.3,1) infinite}
        .lp-ping.d2{animation-delay:.8s}.lp-ping.d3{animation-delay:1.6s}
        .lp-run{animation:lpRun 1.3s ease-in-out infinite}@keyframes lpRun{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}
        @keyframes lpPing{0%{transform:scale(.35);opacity:1}100%{transform:scale(1.25);opacity:0}}
        @media (prefers-reduced-motion:reduce){.lp-ping{animation:none;opacity:.3}}
      `}</style>
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <h2 className="text-lg font-extrabold tracking-tight">{l.name}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/60 px-3 py-1 text-fs-13 font-extrabold text-sky-200 ring-1 ring-sky-300/40"><span className="h-2 w-2 rounded-full bg-sky-300 animate-pulse" />{reading ? 'READING' : slow ? 'WAITING FOR LINE' : 'OFFLINE'}</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 pb-4 text-center">
        {/* radar: the screen keeps calling the line */}
        <div className="relative h-24 w-24 grid place-items-center" aria-hidden>
          <span className="lp-ping" /><span className="lp-ping d2" /><span className="lp-ping d3" />
          <svg viewBox="0 0 24 24" className="relative h-10 w-10 text-sky-300" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
        </div>
        <div className="text-fs-20 font-extrabold">{reading ? `Reading ${l.name} data…` : slow ? 'Line server is answering slowly' : 'Line server not connected'}</div>
        {reading && <div className="h-1.5 w-56 max-w-full overflow-hidden rounded bg-white/15" aria-hidden><i className="block h-full w-1/3 rounded bg-gradient-to-r from-sky-300 via-blue-500 to-red-500 lp-run" /></div>}
        <div className="text-fs-14 font-semibold text-sky-100">{reading ? 'This line is responding slowly. Its figures will appear here automatically.' : last ? 'No production data from this line today.' : 'Reconnecting to the line automatically…'}</div>
        {last && <div className="text-fs-13 text-slate-300">Last data: <b className="text-white">{whenText(last)}</b></div>}
        {msg && !reading && (() => {
          const why = describeLoadError(msg, l.name);
          const short = why.kind === 'login' ? 'Reason: the line server refused the login (user / password changed)'
            : why.kind === 'offline' ? 'Reason: no network answer from the line PC (PC off, cable / Wi-Fi, SQL Server stopped or IP changed)'
            : why.kind === 'slow' ? 'Reason: the line server answers too slowly' : 'Reason: the line data could not be read';
          return <div className="max-w-[44ch] rounded-md bg-slate-900/60 px-2.5 py-1 text-fs-12 font-semibold text-amber-200 ring-1 ring-amber-300/30" title={msg}>{short}</div>;
        })()}
        <div className="text-fs-12 text-slate-400">Other lines are not affected · the connection is restored automatically</div>
      </div>
    </section>
  );
}

/** tv = TV mode: only the strip and the four line cards (no chart below). */
export default function MainLive({ tv = false }) {
  const headSlot = useHeaderSlot();   // the light filter row of the page header (wide screens)
  const wide = useMediaQuery('(min-width: 1024px)');   // big screens: the short management card (same as TV), phones: stacked card
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const [updated, setUpdated] = useState('');
  const [pickHour, setPickHour] = useState(null);
  const busy = useRef(false);
  const settings = useAllLineSettings(LINE_IDS);   // shift + model targets of every line (shared on the server)
  // scans made during lunch, per line and clock hour (window_counts.php): shown in the lunch column, not in the next bar.
  // Read again every minute (they only change during lunch).
  const [lunchQ, setLunchQ] = useState({});
  const linesRef = useRef([]);
  linesRef.current = data?.lines || [];
  const focusDay = data?.focus;
  // the morning entry of the day (supervisor) replaces the shift master of that line for the day
  const daySetups = useDaySetups(focusDay);
  const shiftOf = (l) => shiftOfDay(daySetups, focusDay, String(l), settings[l]?.shift);
  // no line that answered has a scan today yet: the screen shows the last day with scans — say so, never "running"
  const oldDay = !!(data?.focus && data?.today && data.focus < data.today);
  useEffect(() => {
    if (!focusDay) return undefined;
    let alive = true;
    const load = () => LINE_IDS.forEach((l) => {
      const sh = shiftOf(l) || SHIFT_PLANT;   // same shift as the chart's time axis when a line has no shift master
      if (!sh?.lunchStart || !sh?.lunchEnd) return;
      const row = linesRef.current.find((x) => String(x.line) === l);
      if (!row || !row.ok || row.backup) return;   // a line that does not answer is not asked for its lunch scans
      api.windowCounts(focusDay, focusDay, sh.lunchStart, sh.lunchEnd, { line: l }, { noCache: true })
        .then((j) => { if (alive) setLunchQ((q) => ({ ...q, [l]: { day: focusDay, hours: j?.days?.[focusDay] || {} } })); })
        .catch(() => {});
    });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [focusDay, JSON.stringify(LINE_IDS.map((l) => [(shiftOf(l) || SHIFT_PLANT).lunchStart, (shiftOf(l) || SHIFT_PLANT).lunchEnd]))]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchNow = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setLoading(true);
    try {
      const j = await api.liveLinesParallel({ cmin: 1, cmax: 22 });
      if (j?.error) throw new Error(j.error);
      setData(j); setErr('');
      setUpdated(serverNow().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (e) {
      const m = String(e.message || e);
      setErr(m === 'Failed to fetch' ? 'The server did not respond (live_lines.php not found or timed out).' : m);
    } finally { busy.current = false; setLoading(false); }
  }, []);

  useEffect(() => { fetchNow(); }, [fetchNow]);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => { if (!document.hidden) fetchNow(); }, LIVE_MS);
    return () => clearInterval(id);
  }, [live, fetchNow]);

  const lines = data?.lines || [];
  // which lines are shown as cards: all four by default; click a line in the strip to show / hide it.
  // Remembered in this browser; a TV link can fix it with ?lines=1,3
  const [sel, setSel] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('lines');
      const v = q ? q.split(',') : JSON.parse(localStorage.getItem('ems.mainLines') || 'null');
      const ok = (Array.isArray(v) ? v : []).map(String).filter((x) => LINE_IDS.includes(x));
      return ok.length ? ok : LINE_IDS;
    } catch { return LINE_IDS; }
  });
  const toggleLine = (id) => setSel((cur) => {
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : LINE_IDS.filter((x) => cur.includes(x) || x === id);
    if (!next.length) return cur;   // at least one line stays
    try { localStorage.setItem('ems.mainLines', JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });
  const showAll = () => { setSel(LINE_IDS); try { localStorage.removeItem('ems.mainLines'); } catch { /* storage blocked */ } };
  const shown = lines.filter((l) => sel.includes(String(l.line)));
  const n = shown.length;
  const single = n === 1;
  // lines shown from the local backup (server offline) are an older day: not part of today's total
  const grand = lines.reduce((s, l) => s + (l.backup && (l.day || '') !== data?.today ? 0 : (l.total || 0)), 0);   // an offline line counts when its saved data is of today
  const status = !data ? (err ? 'offline' : 'connecting') : err ? 'stale' : 'live';

  const hourRows = useMemo(() => {
    const by = {}; let lo = 24, hi = -1;
    // only lines whose numbers are of the day shown: an offline line answered with an older day (backup) is left out
    const shown = lines.filter((l) => !l.backup || (l.day || String(l.backup.upTo || '').slice(0, 10)) === data?.focus);
    // scans made during lunch (23-11-2026): out of the hour bar, into their own Lunch bar
    const lunch = { hour: 'lunch', total: 0 };
    for (const l of shown) {
      const lq = lunchQ[l.line]?.day === data?.focus ? lunchQ[l.line].hours : null;
      for (const r of l.hours || []) {
        const lz = Math.min(r.quantity, Number(lq?.[String(r.hour)]) || 0);
        const q = r.quantity - lz;
        const o = (by[r.hour] = by[r.hour] || { total: 0 }); o[`L${l.line}`] = q; o.total += q; lo = Math.min(lo, r.hour); hi = Math.max(hi, r.hour);
        if (lz) { lunch[`L${l.line}`] = (lunch[`L${l.line}`] || 0) + lz; lunch.total += lz; o[`lunch${l.line}`] = lz; }
      }
    }
    if (hi < 0) return [];
    const out = [];
    const sh = shiftOf(LINE_IDS[0]) || SHIFT_PLANT;   // one time axis for the four lines: the shift of Line 1
    // the whole shift on the axis (09–21), so three hours of a morning are three slim bars, not three giant blocks
    const hm = (t, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) : d; };
    lo = Math.min(lo, hm(sh.start, 9)); hi = Math.max(hi, hm(sh.end, 21) - 1);
    const lh = hm(sh.lunchStart, null);
    for (let h = lo; h <= hi; h++) {
      if (h === lh && sh.lunchEnd) out.push({ ...lunch, label: 'Lunch', title: `Lunch ${sh.lunchStart}-${sh.lunchEnd}`, isLunch: true });
      out.push({ hour: h, label: hourSpanLabel(sh, h), total: 0, ...(by[h] || {}) });
    }
    return out;
  }, [lines, settings, data?.focus, daySetups, lunchQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickRow = pickHour != null ? hourRows.find((r) => r.hour === pickHour) : null;

  return (
    // on the page the live cards use the MES light colours; in TV mode the look chosen on the TV applies
    <div className={tv ? 'h-full flex flex-col gap-2' : 'space-y-2'} data-tv-light={tv ? undefined : '1'} style={tv ? undefined : TV_LOOKS.mes.vars}>
      <style>{`
        .lp-shimmer{background:linear-gradient(90deg,#F1F5F9 0%,#FFFFFF 50%,#F1F5F9 100%);background-size:200% 100%;animation:lpShimmer 1.6s linear infinite}
        @keyframes lpShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @media (prefers-reduced-motion:reduce){.lp-shimmer{animation:none}}
      `}</style>
      {/* 24-11-2026: on the page (wide screen) the all-lines strip sits in the header's filter row — one line, no navy band */}
      {!tv && headSlot && createPortal(
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="All lines">
          <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-[#BFBFBF] bg-white px-2.5 text-fs-13 font-semibold text-[#1F3864]">All lines <b className="font-mono text-fs-15 tabular-nums">{nf(grand)}</b></span>
          {lines.map((l) => {
            const on = sel.includes(String(l.line));
            const old = l.backup && (l.day || String(l.backup.upTo || '').slice(0, 10)) !== data?.today;
            return (
              <button type="button" key={l.line} aria-pressed={on} onClick={() => toggleLine(String(l.line))} title={on ? `Hide ${l.name}` : `Show ${l.name}`}
                className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[3px] border bg-white px-2 text-fs-13 font-semibold ${on ? 'border-[#BFBFBF] text-[#1F3864]' : 'border-slate-200 text-slate-400'}`} style={{ borderLeft: `4px solid ${LINE_COLOR[l.line] || '#64748b'}` }}>
                {l.name} <b className={`font-mono tabular-nums ${l.ok && !old ? '' : 'text-red-700'}`}>{l.ok && !old ? nf(l.total) : 'offline'}</b>
              </button>
            );
          })}
          {lines.length > 0 && sel.length < LINE_IDS.length && <button type="button" onClick={showAll} className="h-8 rounded-[3px] border border-[#BFBFBF] bg-white px-2.5 text-fs-13 font-bold text-[#1F4E79] hover:bg-[#EAF2FB]">Show all</button>}
          {data?.focus && data.focus !== data.today && <span className="whitespace-nowrap text-fs-13 font-bold text-[#1F3864]">Day {fmtDate(data?.focus)}</span>}
          {oldDay && <span className="rounded bg-amber-500 px-2 py-0.5 text-fs-12 font-extrabold text-white" role="note">No scans today ({fmtDate(data?.today)})</span>}
          <button type="button" onClick={() => setLive((v) => !v)} title={live ? 'Pause the live update' : 'Resume the live update'}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-2.5 text-fs-13 font-extrabold ${live ? STATUS_LIGHT[status] : 'border-slate-300 bg-slate-100 text-slate-700'}`} role="status">
            {live ? <><span className={`h-2 w-2 rounded-full bg-current ${status === 'live' ? 'animate-pulse' : ''}`} />{STATUS[status].text}<Pause size={13} aria-hidden /></> : <><Play size={13} aria-hidden /> Paused</>}
          </button>
        </div>, headSlot)}
      {(tv || !headSlot) && <div className="shrink-0 rounded-2xl border border-dixon-navy bg-dixon-navy text-white shadow-md px-3 py-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
        <div>
          <div className="text-fs-12 font-bold uppercase tracking-wide text-sky-100">All lines — production{oldDay ? ` · ${fmtDate(data?.focus)}` : ""}</div>
          <div className="font-mono tabular-nums text-2xl font-extrabold text-slate-300 leading-none">{nf(grand)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {lines.map((l) => (
            <button type="button" key={l.line} aria-pressed={sel.includes(String(l.line))} onClick={() => toggleLine(String(l.line))}
              title={sel.includes(String(l.line)) ? `Hide ${l.name}` : `Show ${l.name}`}
              className={`text-left rounded-lg border px-2.5 py-0.5 transition ${sel.includes(String(l.line)) ? 'bg-white/[.12] border-white/25 ring-1 ring-sky-300/50' : 'bg-white/[.03] border-white/10 opacity-45 hover:opacity-80'}`} style={{ borderLeft: `4px solid ${COLORS[l.line]}` }}>
              <div className="text-fs-12 font-bold text-sky-100 leading-tight">{l.name}</div>
              {(() => { const old = l.backup && (l.day || String(l.backup.upTo || '').slice(0, 10)) !== data?.today;   // offline, nothing today
                return <div className={`font-mono tabular-nums text-base font-extrabold leading-tight ${l.ok && !old ? '' : 'text-red-300'}`}>{l.ok && !old ? nf(l.total) : 'offline'}</div>; })()}
              {l.backup && String(l.backup.upTo || '').slice(0, 10) === data?.today && <div className="text-fs-11 font-bold text-red-300 leading-tight">offline{String(l.backup.upTo || '').slice(0, 10) === data?.today ? ` · data ${String(l.backup.upTo).slice(11, 16)}` : ''}</div>}
            </button>
          ))}
          {lines.length > 0 && sel.length < LINE_IDS.length && (
            <button type="button" onClick={showAll} className="self-center rounded-lg border border-white/25 px-2.5 py-1 text-fs-12 font-bold text-sky-100 hover:bg-white/10">Show all</button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-fs-12 font-bold text-sky-100">Day {fmtDate(data?.focus)}</div>
            {oldDay && <div className="mt-0.5 rounded bg-amber-500 px-2 py-0.5 text-fs-12 font-extrabold text-white" role="note" title="The responding line servers have no scans today; the most recent day with scans is shown">No scans today ({fmtDate(data?.today)}) — last data</div>}
            <div className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-fs-12 font-extrabold ${STATUS[status].cls}`} role="status">
              <span className={`h-2 w-2 rounded-full bg-current ${status === 'live' && live ? 'animate-pulse' : ''}`} />
              {live ? STATUS[status].text : 'Paused'}
            </div>
          </div>
          <button type="button" onClick={() => setLive((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-fs-13 font-extrabold ${live ? 'bg-sky-500/25 text-sky-300 hover:bg-sky-500/35' : 'bg-white/10 text-slate-200 hover:bg-white/20'}`}>
            {live ? <><Pause size={14} /> LIVE</> : <><Play size={14} /> Resume</>}
          </button>
        </div>
      </div>}

      {err && (
        <div role="alert" className={`flex flex-wrap items-center gap-3 rounded-xl border-2 px-4 py-2.5 text-fs-14 font-semibold break-all ${data ? 'border-slate-200 bg-slate-50 text-slate-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <span className="flex-1 min-w-[12rem]">{data ? `Connection problem. Showing the last update from ${updated}. ` : ''}{err}</span>
          <button type="button" onClick={fetchNow} disabled={loading}
            className="h-8 rounded-lg bg-white px-3 text-fs-13 font-extrabold text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
            {loading ? 'Retrying…' : 'Retry now'}
          </button>
        </div>
      )}

      {/* Until the first successful response, show four placeholder line cards so the layout never looks empty. */}
      {!data && (
        <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3 overflow-hidden" style={{ borderTop: `5px solid ${COLORS[n]}` }}>
              <div className="flex items-center justify-between">
                <div className="text-fs-16 font-extrabold text-slate-800">Line {n}</div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-fs-12 font-bold text-slate-600">{err ? 'No connection' : 'Connecting…'}</span>
              </div>
              <div className="lp-shimmer flex-1 rounded-xl" />
              <div className="text-fs-13 font-semibold text-slate-600">
                {err ? 'This line will appear automatically when the server responds. Retrying every 5 seconds.' : 'Loading live data for this line…'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* four animated lines — on lg screens exactly one screen (2×2); on small screens they stack.
          Tweak 10.5rem if your header/strip is taller or shorter. */}
      {/* the cards grow when fewer lines are chosen: 1 = whole width (big line view), 2 = side by side, 3 = two + one wide */}
      <div className={tv
        ? `flex-1 min-h-0 grid gap-2 ${n === 1 ? 'grid-cols-1 grid-rows-1' : n === 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-2 grid-rows-2'}`
        // 26-11-2026: responsive — two cards a row only where each card is wide enough for every hour's target and made
          // number side by side (≥ 1800 px); a laptop gets one line card a row, full width
          : `grid gap-2 grid-cols-1 ${n === 1 ? '' : n === 2 ? 'lp-live-2 lp-live-2h' : 'lp-live-2'}`}>
        {shown.map((l, i) => {
          const span = n === 3 && i === 2 ? (tv ? 'col-span-2' : 'lp-live-wide') : '';
          if (!l.ok) {
            return (
              <div key={l.line} className={`min-h-0 h-full ${span}`}><OfflineToday l={l} tv={tv} accent={COLORS[l.line]} /></div>
            );
          }
          // offline and nothing from today: no old numbers on the live screen, just OFFLINE with the time of its last data
          if (l.backup && (l.day || String(l.backup.upTo || '').slice(0, 10)) !== data.today) {
            return <div key={l.line} className={`min-h-0 h-full ${span}`}><OfflineToday l={l} tv={tv} accent={COLORS[l.line]} /></div>;
          }
          const h = l.lastHour;
          const hqAll = h != null ? (l.hours.find((x) => x.hour === h)?.quantity ?? 0) : null;
          const ls = { ...(settings[l.line] || {}), shift: shiftOf(l.line) };
          const tc = targetOf(ls.targets, l.mmId ?? l.running?.mmId);
          // this hour's target for the running model: working seconds of the hour so far (lunch excluded) ÷ target cycle
          const now = serverNow();
          const isToday = data.focus === data.today;
          const wsec = h != null && ls.shift ? workSecInHour(ls.shift, h, isToday && h === now.getHours() ? now.getHours() * 60 + now.getMinutes() : null) : null;
          let hourTarget = tc && wsec != null ? Math.round(wsec / tc) : null;
          // target pieces of every hour so far (bars: target next to actual, andon colours); offline line: up to its saved data
          const up = l.backup?.upTo || '';
          const day = l.backup ? (l.day || data.focus) : data.focus;
          const tMin = day !== data.today ? null : l.backup ? (up.slice(0, 10) === day ? Number(up.slice(11, 13)) * 60 + Number(up.slice(14, 16)) : null) : now.getHours() * 60 + now.getMinutes();
          const lq = lunchQ[l.line]?.day === day ? lunchQ[l.line].hours : null;   // lunch scans of this day per hour
          const lunchTotal = lq ? Object.values(lq).reduce((a, b) => a + (Number(b) || 0), 0) : null;
          // this hour's pieces as on its bar (17-11-2026): the scans made during lunch are in the lunch column, not in the hour
          const hq = hqAll != null ? Math.max(0, hqAll - (Number(lq?.[String(h)]) || 0)) : null;
          const plan = ls.targets ? hourPlanOf({ hours: l.hours, hourModels: l.hourModels, shift: ls.shift, targets: ls.targets, nowMin: tMin, fallbackCycle: tc, lunchByHour: lq }) : null;
          const hourTargets = plan?.targets || null;
          // a model without a target also ran in this hour: the hour's target covers only the time of the models with one
          if (hourTarget != null && h != null && plan?.noTarget?.[h]) hourTarget = hourTargets?.[h] ?? null;
          return (
            <div key={l.line} className={`min-h-0 min-w-0 h-full ${span}`}>
            <LiveLine title={l.name} offline={l.backup || null} lag={l.lag || null} accent={COLORS[l.line]} compact={!single} wall={!single && (tv || wide)} tv={single && tv} tvWall={!!tv}
              total={l.total} hourLabel={h != null ? hourSpanLabel(ls.shift, h) : ''} hourQty={hq} model={l.model} company={l.company || l.running?.company}
              avgCycle={realCycleSec(ls.shift, l.firstScan, l.lastScan, l.total) ?? l.avgCycle} hours={l.hours} hourModels={l.hourModels} nowHour={h}
              targetPph={tc ? pphOf(tc) : null} targetCycle={tc} hourTarget={hourTarget} currentCycle={null} modelCycle={l.backup ? null : runCycleOf(ls.shift, l.running)} run={l.backup ? null : l.running}
              lunch={ls.shift?.lunchStart ? { from: ls.shift.lunchStart, to: ls.shift.lunchEnd, qty: lunchTotal } : null}
              hourTargets={hourTargets} hourNoTarget={plan?.noTarget || null} active={live && !l.backup && !oldDay} oldDay={oldDay && !l.backup ? data.focus : null} refreshing={loading} updated={updated} focusDate={l.backup ? (l.day || data.focus) : data.focus} intervalSec={LIVE_MS / 1000} />
            </div>
          );
        })}
      </div>

      {/* combined hourly output (below the fold — scroll down): lines stacked, total on top; a click on a bar opens its models */}
      {!tv && hourRows.length > 0 && (() => {
        const worked = hourRows.filter((r) => !r.isLunch && r.total > 0);
        const peak = worked.reduce((b, r) => (!b || r.total > b.total ? r : b), null);
        const avg = worked.length ? Math.round(worked.reduce((t, r) => t + r.total, 0) / worked.length) : 0;
        const dayTot = hourRows.reduce((t, r) => t + (r.total || 0), 0);
        const topLine = [...lines].reverse().map((l) => `L${l.line}`);
        const HourTip = ({ active, payload }) => {
          const r = active && payload?.[0]?.payload;
          if (!r) return null;
          return (
            <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg shadow-slate-300/40 backdrop-blur" style={{ minWidth: 170 }}>
              <div className="mb-1 flex items-baseline justify-between gap-3"><b className="text-fs-14 text-slate-900">{r.title || r.label}</b><span className="font-mono text-fs-14 font-extrabold text-slate-900">{nf(r.total || 0)}</span></div>
              {lines.map((l) => (
                <div key={l.line} className="flex items-center justify-between gap-3 text-fs-13">
                  <span className="inline-flex items-center gap-1.5 text-slate-700"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[l.line] }} />{l.name}</span>
                  <span className="font-mono font-bold text-slate-900">{nf(r[`L${l.line}`] || 0)}</span>
                </div>
              ))}
              <div className="mt-1 border-t border-slate-100 pt-1 text-fs-12 font-semibold text-slate-500">Click for models</div>
            </div>
          );
        };
        return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md shadow-slate-300/40">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3" style={{ background: 'linear-gradient(90deg,#EEF4FF 0%,#FFFFFF 70%)' }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-sm" style={{ background: '#1F3864', color: '#fff' }}><BarChart3 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h3 className="text-fs-16 font-extrabold leading-tight text-slate-950">All lines — output by hour</h3>
                <div className="text-fs-13 font-semibold text-slate-500">{fmtDate(data?.focus)}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lines.map((l) => (
                <span key={l.line} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-1 text-fs-13 font-semibold text-slate-700">
                  <i className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[l.line] }} />{l.name}<b className="font-mono text-slate-900">{nf(hourRows.reduce((t, r) => t + (r[`L${l.line}`] || 0), 0))}</b>
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-fs-13 font-semibold" style={{ background: '#1F3864', color: '#fff' }}>Total <b className="font-mono">{nf(dayTot)}</b></span>
              {peak && <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-fs-13 font-semibold text-emerald-800">Peak {peak.label} <b className="font-mono">{nf(peak.total)}</b></span>}
              {worked.length > 1 && <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-fs-13 font-semibold text-slate-700">Avg / hour <b className="font-mono">{nf(avg)}</b></span>}
            </div>
          </div>
          <div className="px-3 pb-2 pt-3">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourRows} margin={{ top: 24, right: 12, left: 0, bottom: 4 }} barCategoryGap="22%"
              onClick={(st) => { const p = st?.activePayload?.[0]?.payload; if (p) setPickHour((h) => (h === p.hour ? null : p.hour)); }} style={{ cursor: 'pointer' }}>
              <defs>
                {lines.map((l) => (
                  <linearGradient key={l.line} id={`lpHourG${l.line}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS[l.line]} stopOpacity={1} />
                    <stop offset="100%" stopColor={COLORS[l.line]} stopOpacity={0.72} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tick={tick} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
              <Tooltip content={<HourTip />} cursor={{ fill: 'rgba(31,56,100,0.06)', radius: 8 }} />
              {avg > 0 && worked.length > 1 && <ReferenceLine y={avg} stroke="#94A3B8" strokeDasharray="5 4" ifOverflow="extendDomain" />}
              {lines.map((l) => <Bar key={l.line} dataKey={`L${l.line}`} name={l.name} stackId="a" fill={`url(#lpHourG${l.line})`} maxBarSize={56} isAnimationActive={false}>
                {hourRows.map((r) => {
                  // round only the top of the stack: the highest line with pieces in that hour
                  const top = topLine.find((k) => (r[k] || 0) > 0);
                  return <Cell key={r.hour} fillOpacity={r.isLunch ? 0.4 : r.hour === pickHour || pickHour == null ? 1 : 0.55} radius={top === `L${l.line}` ? [6, 6, 0, 0] : 0} stroke="#fff" strokeWidth={1} />;
                })}
              </Bar>)}
              <Line dataKey="total" stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none">
                <LabelList dataKey="total" position="top" offset={8} formatter={(v) => (v ? nf(v) : '')} style={{ fontSize: fs(13), fill: '#0F172A', fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontWeight: 800 }} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
          </div>

          {pickHour != null && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-fs-14 font-extrabold text-slate-900" data-testid="hour-pick-title">{pickRow?.title || pickRow?.label || (pickHour === 'lunch' ? 'Lunch' : `${pad(pickHour)}-${pad(pickHour + 1)}`)} <span className="font-mono text-slate-600">· {pickRow?.total ?? 0} pcs{pickHour === 'lunch' ? ' scanned in lunch' : ''}</span></div>
                <button type="button" onClick={() => setPickHour(null)} className="text-fs-13 font-bold text-blue-600 hover:underline">Close</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {lines.map((l) => {
                  const isL = pickHour === 'lunch';
                  const ms = isL ? [] : (l.hourModels || []).filter((m) => m.hour === pickHour).sort((a, b) => b.qty - a.qty);
                  const lq = pickRow?.[`L${l.line}`] || 0;          // worked pieces of the hour (lunch scans out)
                  const lz = isL ? 0 : pickRow?.[`lunch${l.line}`] || 0;
                  return (
                    <div key={l.line} className="rounded-lg bg-white border border-slate-200 p-2" style={{ borderTop: `3px solid ${COLORS[l.line]}` }}>
                      <div className="flex justify-between text-fs-13 font-extrabold"><span>{l.name}</span><span className="font-mono">{lq}</span></div>
                      {lz > 0 && <div className="text-fs-12 font-semibold text-amber-700">+ {lz} scanned in lunch (in the Lunch bar; the models below include them)</div>}
                      <div className="mt-1 space-y-0.5 max-h-32 overflow-auto">
                        {ms.length ? ms.map((m) => <div key={m.model} className="flex justify-between gap-2 text-fs-13"><span className="break-words text-slate-900" title={[m.company, m.model].filter(Boolean).join(' · ')}>{m.company && <b className="text-slate-800">{m.company} · </b>}{m.model}</span><span className="font-mono font-bold">{m.qty}</span></div>)
                          : <div className="text-fs-13 text-slate-600">{!l.ok ? 'offline' : isL ? (lq ? 'Scanned during lunch' : 'No lunch scans') : 'No scans'}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>
        );
      })()}
    </div>
  );
}