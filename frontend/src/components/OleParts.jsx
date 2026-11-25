import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PencilLine, ChevronRight, Building2, RefreshCw } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { getAuth } from '../auth';
import { serverNow, serverToday } from '../utils/serverTime';
import { OLE_LINES, lossSummary, groupIssues, splitText, rcaStatus, KIND_TEXT, pct, hm, normStation, stationLabel, offLabels, okFrom, watchFrom, setOleStations } from '../utils/ole';

/** Shared pieces of the OLE dashboard, the Loss entry page and the RCA page. */
import { LINE_COLOR, fmtDate, BAND } from '../theme';
import { refreshMs } from '../utils/refreshConfig';

export { LINE_COLOR };
export const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
export const dmy = fmtDate;
export const p2 = (h) => String(h).padStart(2, '0');
export const inp = 'h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-fs-14 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:bg-slate-50 disabled:text-slate-400';
export const chip = 'inline-flex max-w-full items-center rounded-full bg-slate-100 px-2 py-0.5 text-fs-12 font-semibold text-slate-700';
export const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5';
export const KINDS = [
  { key: 'stops', kind: 'stop', title: 'Planned stoppage', num: 'min', unit: 'min', add: 'Add planned stoppage', hint: 'Known in advance: tea break, meeting, planned maintenance, no plan … — taken out of the planned time, does not lower OLE.' },
  { key: 'losses', kind: 'loss', title: 'Loss', num: 'min', unit: 'min', add: 'Add loss', perModel: true },
  { key: 'rejects', kind: 'reject', title: 'Rejection', num: 'qty', unit: 'pcs', add: 'Add rejection', station: true, hint: 'Pieces rejected: the station that caught them (LQC, FQC, leak test …), model and defect — lowers Quality.' },
  { key: 'rework', kind: 'rework', title: 'Rework', num: 'qty', unit: 'pcs', add: 'Add rework', station: true, hint: 'Pieces repaired and passed: station, model and defect — they stay in the good qty but lower first-pass yield.' },
];
const DEFAULT_REASONS = {
  stop: [['Tea break', 'Prod'], ['Meeting / training', 'Prod'], ['Planned maintenance (PM)', 'Maint'], ['Planned model changeover', 'Prod'], ['No production plan', 'PPC'], ['Trial / sample run', 'Engineering'], ['5S / cleaning', 'Prod'], ['Other planned', 'Prod']],
  // unplanned loss: the plant's HPR reasons (Oct-26) — [reason, department, owner] (same list as backend/api/ole.php)
  loss: [["Model Change", "Prod", "Ajay Kumar"], ["T-9 Model / Efficiency issue", "Prod", "Shatrughan"], ["Productivity Issue", "Prod", "Ajay Kumar"], ["Motor Shortage", "Kitting Store", "Arvind Pandey"], ["Control Table Shortage", "Moulding Store", "Madan Yadav"], ["Pulsator Shortage", "Moulding Store", "Madan Yadav"], ["Carton Box Shortage", "Kitting Store", "Neeraj Mishra"], ["Panel Shortage", "Moulding Store", "Madan Yadav"], ["Pulsator Touching", "Moulding QA", "Shailesh Singh"], ["Drain Assy Leakage", "Supplier", "Vikas Pal"], ["Barcode / XML scan error", "IT", "Pradeep Kumar"], ["New model running for first time", "Prod", "Sachidanand"], ["Colour Variation", "Moulding QA", "Shailesh Singh"], ["Panel Cover Shortage", "Moulding Store", "Madan Yadav"], ["Cascade Shortage", "Moulding Store", "Madan Yadav"], ["Lift / Pick & Lift breakdown", "Maint", "Rajnikant"], ["Power Cord Issue", "Supplier", "Vikas Pal"], ["Tub Shortage", "Moulding Store", "Anjani Tiwari"], ["Angle NG", "Prod", "Ajay Kumar"], ["Break Plate Shortage", "Kitting Store", "Ganesh Chandra"], ["Back Cover Shortage", "Moulding Store", "Madan Yadav"], ["Trial run (R&D)", "R&D", "Chandan Kumar"], ["Striping Machine not working", "Maint", "Rajnikant"], ["EPS Shortage", "Kitting Store", "Neeraj Mishra"], ["Wash Lid Shortage", "Moulding Store", "Madan Yadav"], ["Leg Shortage", "Moulding Store", "Kundan Singh"], ["Overflow Pipe Leakage", "Supplier", "Kosh"], ["Wrong water selector assembly", "Prod", "Shatrughan"], ["Tub Scratch", "Moulding Store", "Ram Sewak"], ["Drain Assy Shortage", "Outsourcing", "Upendra Shukla"], ["No Break Issue", "Supplier", "Vikas Pal"], ["Glass Shortage", "Sub Assy", "Gaurav Chauhan"], ["Printing NG in Carton Box", "Supplier", "Krishna Packers"], ["Manpower Setting", "Prod", "Mukesh"], ["Bubble in Deco", "Moulding Store", "Madan Yadav"], ["Drain Cap Leakage", "Supplier", "Kosh"], ["Jig / fixture broken", "Prod", "Sachidanand"], ["No Movement of FG", "Logistics", "Randhir Rai"], ["Knob Shortage", "Moulding Store", "Madan Yadav"], ["Motor NG", "Supplier", "Vikas Pal"], ["Pulsator Cap Shortage", "Moulding Store", "Madan Yadav"], ["Gun not working", "Maint", "Rajnikant"], ["Seal Bellow Leakage", "Moulding Store", "Ram Sewak"], ["Wrong Pulsator on line", "Moulding Store", "Harikesh Singh"], ["Pick & Turn not working", "Maint", "Rajnikant"], ["Rework", "Prod", "Shatrughan"], ["Panel Mouth Shortage", "Moulding Store", "Madan Yadav"], ["Thermocol Shortage", "Kitting Store", "Neeraj Mishra"], ["Wrong Carton Box", "Kitting Store", "Neeraj Mishra"], ["Server Issue", "IT", "Pradeep Kumar"], ["Other", "Prod", "Shatrughan"]],
  // washing machine defects (same lists as backend/api/ole.php)
  reject: [['Water leak', 'Prod'], ['Noise / vibration', 'Engineering'], ['Electrical safety fail (Hi-pot / earth)', 'Quality'], ['Functional fail', 'Quality'], ['Cosmetic damage', 'Quality'], ['Supplier part defect', 'Supplier'], ['Handling damage', 'Prod'], ['Wrong part', 'Kitting Store'], ['Missing part', 'Kitting Store'], ['Other', 'Quality']],
  rework: [['Assembly mistake', 'Prod'], ['Leak repair', 'Prod'], ['Wiring / connector', 'Prod'], ['Fitment issue', 'Engineering'], ['Missing part', 'Kitting Store'], ['Test fail', 'Quality'], ['Cosmetic touch-up', 'Prod'], ['Other', 'Prod']],
  // quality stations of the line where a piece is rejected or sent to rework
  station: [['Sub-assembly', 'Prod'], ['Leak test', 'Quality'], ['Hi-pot / electrical safety', 'Quality'], ['Run / performance test', 'Quality'], ['LQC (line quality check)', 'Quality'], ['FQC (final quality check)', 'Quality'], ['OQC / packing audit', 'Quality']],
};
const DEFAULT_CODES = { 'Sub-assembly': ['SUB', 'inline'], 'Leak test': ['LEAK', 'test'], 'Hi-pot / electrical safety': ['HIPOT', 'test'], 'Run / performance test': ['RUN', 'test'], 'LQC (line quality check)': ['LQC', 'inline'], 'FQC (final quality check)': ['FQC', 'final'], 'OQC / packing audit': ['OQC', 'audit'] };
/** FPY / RTY targets (%) of the admin. */
export const DEFAULT_QUALITY = { fpyTarget: 98, rtyTarget: 97 };   // RTY target 97 % as the SAWM KPI report
let CUR_STATIONS = [];
export const normReasons = (r) => {
  const out = Object.fromEntries(['stop', 'loss', 'reject', 'rework', 'station'].map((k) => [k, Array.isArray(r?.[k]) && r[k].length ? r[k]
    : DEFAULT_REASONS[k].map(([reason, dept, owner]) => ({ reason, dept, ...(k === 'station' ? { code: DEFAULT_CODES[reason]?.[0] || '', type: DEFAULT_CODES[reason]?.[1] || 'inline' } : { owner: owner || '' }) }))]));
  for (const k of ['stop', 'loss', 'reject', 'rework']) out[k] = out[k].map((x) => ({ ...x, owner: x.owner || '' }));   // owner of the reason (HPR "Owner")
  out.station = out.station.map(normStation);
  out.quality = { ...DEFAULT_QUALITY, ...(r?.quality || {}) };
  CUR_STATIONS = out.station;
  setOleStations(out.station);
  return out;
};
export const deptOf = (reasons, kind, reason) => reasons[kind].find((x) => x.reason === reason)?.dept || '';
export const ownerOf = (reasons, kind, reason) => reasons[kind].find((x) => x.reason === reason)?.owner || '';
export const STATUS_TEXT = { pending: 'RCA pending', submitted: 'RCA submitted', closed: 'Closed' };
export const STATUS_CLS = { pending: 'bg-white text-slate-700 ring-1 ring-slate-300', submitted: 'bg-sky-100 text-sky-900', closed: 'bg-slate-800 text-white' };
export const StatusChip = ({ st }) => <span className={`inline-flex rounded-full px-2 py-0.5 text-fs-12 font-bold whitespace-nowrap ${STATUS_CLS[st]}`}>{STATUS_TEXT[st]}</span>;

/** The lines of this login that the OLE pages work with. */
// 25-11-2026: follows the login's lines (LINE_IDS changes in place when the admin gives a login other lines)
export const useOleLines = () => useMemo(() => OLE_LINES.filter((l) => LINE_IDS.includes(l)), [LINE_IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
/**
 * 20-11-2026: the company (brand) of a model, from the line data (all_lines: models [{ mmId, model, company }]).
 * companyOf(D.al) → (model, mmId?) => 'VOLTAS' | ''
 */
export function companyOf(al) {
  const byName = new Map(), byId = new Map();
  for (const L of al?.lines || []) for (const m of L.models || []) {
    if (!m?.company) continue;
    if (m.model) byName.set(String(m.model).trim().toUpperCase(), m.company);
    if (m.mmId != null) byId.set(String(m.mmId), m.company);
  }
  return (model, mmId = null) => (mmId != null && byId.get(String(mmId))) || byName.get(String(model || '').trim().toUpperCase()) || '';
}
/** the company as a table cell: grey capitals, — when not known */
export const CompanyCell = ({ name }) => (name ? <span className="whitespace-nowrap text-fs-12 font-bold uppercase tracking-wide text-[#555]">{name}</span> : <span className="text-[#999]">—</span>);
/** the plant of each line: Line 1 & 2 = C8, Line 3 = C3, Line 4 = C2 (23-11-2026: Line 3 is in C3) */
export const PLANT_OF = { 1: 'C8', 2: 'C8', 3: 'C3', 4: 'C2' };
export const plantOf = (l) => PLANT_OF[Number(l)] || '';
/** "C8 Plant" for lines of one plant, "C8 · C3 · C2 plants" for more */
export const plantsText = (ids) => { const ps = [...new Set((ids || []).map(plantOf).filter(Boolean))]; return ps.length === 1 ? `${ps[0]} Plant` : ps.length ? `${ps.join(' · ')} Plants` : 'Plant'; };
export const groupNameOf = (ids) => (ids.length === 4 ? 'All lines' : `Line ${ids.join(' & ')}`);
export const monthOf = (d) => d.slice(0, 7);
export const monthRange = (m, today) => { const [y, mo] = m.split('-').map(Number); const last = new Date(y, mo, 0).getDate(); const end = `${m}-${p2(last)}`; return { start: `${m}-01`, end: end > today ? today : end }; };

// Last answers of the latest periods, kept per login in the browser: a page opens at once with them
// ("Updating…" while the fresh numbers come), instead of waiting for every line server.
const PC_KEY = 'ems.olePageCache.v1';
const PC_KEEP = 6;   // periods kept per login, so opening other pages does not push the Overall OLE month out
const pcMem = new Map();
const pcKey = (start, end, ids) => `${getAuth()?.user || '-'}|${start}|${end}|${(ids || []).join(',')}`;
function pcRead(k) {
  if (pcMem.has(k)) return pcMem.get(k);
  try { const all = JSON.parse(localStorage.getItem(PC_KEY) || '[]'); const hit = all.find((x) => x.k === k); if (hit) { pcMem.set(k, hit.v); return hit.v; } } catch { /* storage blocked */ }
  return null;
}
function pcWrite(k, patch) {
  const v = { ...(pcRead(k) || {}), ...patch, at: Date.now() };
  pcMem.set(k, v);
  try {
    const all = JSON.parse(localStorage.getItem(PC_KEY) || '[]').filter((x) => x.k !== k);
    all.unshift({ k, v });
    // storage full: keep fewer older periods (newest first) before giving up
    for (let n = PC_KEEP; n >= 1; n -= 1) { try { localStorage.setItem(PC_KEY, JSON.stringify(all.slice(0, n))); return; } catch { /* too big: try fewer */ } }
    localStorage.removeItem(PC_KEY);
  } catch { /* blocked: memory only */ }
}
/** Reasons of a whole-day planned stop (same list as backend/api/ole.php OLE_DAY_REASONS). */
export const DAY_REASONS = ['Holiday / weekly off', 'No production plan', 'Planned maintenance shutdown', 'Stock taking / audit', 'Planned power shutdown', 'Model trial / line setting', 'Other'];
const EMPTY_ENT = { entries: {}, reasons: normReasons(null), rca: {}, days: {}, dayReasons: DAY_REASONS, setup: {}, kpi: {} };

/**
 * Production (all_lines.php, the login's lines) and the OLE entries / reasons / RCA of a period.
 * Opens with the last answer of the same period (stale = true) and reads the fresh one at once.
 * Today's numbers are read again every minute (paused while `paused`).
 */
const POLL_MS = () => refreshMs('ole');   // 23-11-2026: the admin's Setup → Screen refresh (20 s by default)

// prod = false: only the entries are read
export function useOleData({ start, end, ids, paused = false, pollEntries = false, prod = true }) {
  const key = pcKey(start, end, ids);
  const [al, setAl] = useState(() => pcRead(key)?.al || null);
  const alRef = useRef(al);
  const [ent, setEnt] = useState(() => { const c = pcRead(key)?.ent; return c ? { ...EMPTY_ENT, ...c, reasons: normReasons(c.reasons) } : EMPTY_ENT; });
  const [entReady, setEntReady] = useState(() => !!pcRead(key)?.ent);   // the entries of this period were read (or kept from before)
  const [loading, setLoading] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [err, setErr] = useState('');
  const ctl = useRef(null);
  const loadingRef = useRef(false);
  const retryRef = useRef(0); const retryT = useRef(null);   // automatic re-read of a line that did not answer
  const [updatedAt, setUpdatedAt] = useState(null);   // time of the last good read (shown on the dashboard)
  const [lastScan, setLastScan] = useState({});        // today: minute of the day of every line's last scan (time is counted up to it)
  const today = serverToday();
  const loadProd = async (force = false, poll = false) => {
    if (poll && ctl.current && loadingRef.current) return;   // the last read is still running: do not start it again
    ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
    loadingRef.current = true; setLoading(true); setErr('');
    try {
      // a poll skips the browser's 30 s copy (noCache), so the screen shows what the server has now
      // today in the period: the last scan of each line (its own server only) — today's time is counted up to it, not up to now
      const ls = end >= today ? Promise.allSettled(ids.map((l) => api.liveLinesOne(l, { cmin: 1, cmax: 22 }))) : Promise.resolve([]);
      const a = await api.allLinesParallel({ start, end, cmin: 1, cmax: 22, lines: ids, chunk: true, today }, { signal: c.signal, fresh: force, noCache: poll });
      const lsr = await ls;
      if (ctl.current === c && end >= today) {
        const m = {};
        lsr.forEach((r, i) => {
          const row = r.status === 'fulfilled' ? r.value?.lines?.[0] : null;
          const t = String(row?.lastScan || '');
          if (!row) return;   // line server not reachable: its time runs up to now
          if (t.slice(0, 10) !== today) { m[ids[i]] = 0; return; }   // no scan yet today
          m[ids[i]] = Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) + (Number(t.slice(17, 19)) > 0 ? 1 : 0);
        });
        setLastScan(m);
      }
      // 19-11-2026: a line that does not answer this time keeps its last good numbers of the same period (no "not
      // answering" flash on every slow answer); only a line never read in this period shows as not answering
      const prev = alRef.current;
      const merged0 = prev && a?.lines ? { ...a, lines: a.lines.map((row) => { if (row?.ok) return row; const old = (prev.lines || []).find((x) => String(x?.line) === String(row?.line)); return old?.ok ? { ...old, stale: true } : row; }) } : a;
      // 23-11-2026: how many reads in a row a line has not answered — the first few show "Reading again…", not the warning
      const tries = retryRef.current + 1;
      const merged = merged0?.lines ? { ...merged0, lines: merged0.lines.map((row) => (row && !row.ok ? { ...row, tries } : row)) } : merged0;
      if (ctl.current === c) { setAl(merged); alRef.current = merged; setFresh(true); setUpdatedAt(serverNow()); pcWrite(key, { al: merged }); }
      // 20-11-2026: a line still not answering (and with no old numbers) is asked again by itself: every 10 s six
      // times, then every 30 s for as long as the page is open (a past day too, which is not polled)
      if (ctl.current === c && merged?.lines?.some((row) => row && !row.ok)) {
        retryRef.current += 1;
        // 23-11-2026: the first re-reads come quickly (4 s), so one slow answer is covered before anyone sees it
        clearTimeout(retryT.current); retryT.current = setTimeout(() => { if (!document.hidden) loadProd(false, true); }, retryRef.current <= 3 ? 4_000 : retryRef.current <= 8 ? 10_000 : 30_000);
      } else if (ctl.current === c) retryRef.current = 0;
    } catch (x) { if (x.name !== 'AbortError') setErr(String(x.message || x)); } finally { if (ctl.current === c) { loadingRef.current = false; setLoading(false); } }
  };
  const loadEnt = async () => {
    try {
      const e = await api.oleEntries(start, end);
      const v = { entries: e?.entries || {}, reasons: normReasons(e?.reasons), rca: e?.rca || {}, days: e?.days || {}, dayReasons: Array.isArray(e?.dayReasons) && e.dayReasons.length ? e.dayReasons : DAY_REASONS, setup: e?.setup || {}, kpi: e?.kpi || {} };
      setEnt(v); setEntReady(true); pcWrite(key, { ent: v });
    } catch (x) { setErr(`Entries could not be read: ${x.message}`); }
  };
  useEffect(() => {
    const c = pcRead(key);
    setAl(c?.al || null); alRef.current = c?.al || null; setFresh(false);
    setEnt(c?.ent ? { ...EMPTY_ENT, ...c.ent, reasons: normReasons(c.ent.reasons) } : EMPTY_ENT); setEntReady(!!c?.ent);
    retryRef.current = 0;
    if (prod) loadProd(false);
    loadEnt();
    return () => { ctl.current?.abort(); clearTimeout(retryT.current); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (end < today) return undefined;
    // a period that includes today is read again every 20 s (production) with its loss / RCA entries
    const id = setInterval(() => { if (!document.hidden && !paused) { if (prod) loadProd(false, true); if (pollEntries) loadEnt(); } }, POLL_MS());
    return () => clearInterval(id);
  }, [start, end, today, paused, pollEntries, prod]); // eslint-disable-line react-hooks/exhaustive-deps
  // production asked for later (prod false → true): read it now
  const prodRef = useRef(prod);
  useEffect(() => { if (prod && !prodRef.current) loadProd(false); prodRef.current = prod; }, [prod]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = serverNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // endMin: today's time of every line ends at its last scan (never after now); other lines / days: now
  const endMin = useMemo(() => ({ now: nowMin, ...Object.fromEntries(Object.entries(lastScan).map(([l, m]) => [l, Math.min(nowMin, m)])) }), [nowMin, lastScan]);
  return { al, ent, entReady, setEnt, loading, updatedAt, stale: !!al && !fresh, err, today, nowMin, endMin, reload: () => { if (prod) loadProd(true); loadEnt(); }, reloadEnt: loadEnt };
}

// OLE colour bands (world class 85 %): green ≥ 85 %, amber 60–85 %, red below 60 %
/** colour of a value; k = 'A' | 'P' | 'Q' uses that factor's benchmark, else the OLE one */
export const band = (v, k = null) => (v == null ? BAND.none : v >= okFrom(k) ? BAND.ok : v >= watchFrom(k) ? BAND.mid : BAND.bad);
export const bandText = (v, k = null) => (v == null ? 'text-slate-500' : v >= okFrom(k) ? 'text-emerald-700' : v >= watchFrom(k) ? 'text-amber-700' : 'text-red-700');

/** Speedometer-style OLE gauge: half circle with red / amber / green zones, the value arc and a needle. */
export function Gauge({ value, size = 120, label = '' }) {
  const w = size, h = size * 0.74, r = size * 0.4, cx = w / 2, cy = size * 0.47, sw = size * 0.09;
  const v = Math.max(0, Math.min(1, value ?? 0));
  const pt = (f, rr = r) => [cx - rr * Math.cos(Math.PI * f), cy - rr * Math.sin(Math.PI * f)];
  const arc = (a, b, rr = r) => { const [x1, y1] = pt(a, rr), [x2, y2] = pt(b, rr); return `M ${x1} ${y1} A ${rr} ${rr} 0 0 1 ${x2} ${y2}`; };
  // the needle (MES look, 19-11-2026): a slim tapered pointer from a ringed hub to just inside the dial
  const ang = Math.PI * v, ux = -Math.cos(ang), uy = -Math.sin(ang), px = -uy, py = ux;
  const nl = r * 0.8, nb = Math.max(2.2, size * 0.026), tail = r * 0.12;
  const needle = `${cx + ux * nl},${cy + uy * nl} ${cx + px * nb},${cy + py * nb} ${cx - ux * tail},${cy - uy * tail} ${cx - px * nb},${cy - py * nb}`;
  return (
    // scales down with its box (never cut in a narrow line card), never above its size
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} OLE ${pct(value)}`} className="shrink-0" style={{ width: '100%', maxWidth: w, height: 'auto' }}>
      <path d={arc(0, watchFrom())} stroke={BAND.badBg} strokeWidth={sw} fill="none" />
      <path d={arc(watchFrom(), okFrom())} stroke={BAND.midBg} strokeWidth={sw} fill="none" />
      <path d={arc(okFrom(), 1)} stroke={BAND.okBg} strokeWidth={sw} fill="none" />
      {/* the 85 % benchmark: a mark on the dial (no extra text under the gauge); 25-11-2026: its number is hidden when the needle sits on it */}
      {(() => { const [x1, y1] = pt(okFrom(), r + sw * 0.7), [x2, y2] = pt(okFrom(), r - sw * 0.7), [tx, ty] = pt(okFrom(), r - sw * 1.45); return (<g aria-hidden><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(var(--navy))" strokeWidth={Math.max(1.5, size * 0.014)} />{Math.abs(v - okFrom()) > 0.07 && <text x={tx} y={ty + size * 0.025} textAnchor="middle" fill="#475569" style={{ font: `700 ${Math.max(11, Math.round(size * 0.075))}px var(--font-sans)` }}>{Math.round(okFrom() * 100)}</text>}<title>{`Benchmark ${Math.round(okFrom() * 100)}%`}</title></g>); })()}
      {v > 0 && <path className="lp-gauge-arc" pathLength={1} d={arc(0, v)} stroke={band(value)} strokeWidth={sw * 0.62} strokeLinecap="round" fill="none" style={{ transition: 'all .6s ease' }} />}
      <polygon className="lp-gauge-needle" points={needle} fill="#1F3864" stroke="#1F3864" strokeWidth={0.6} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 1px rgba(15,23,42,.25))' }} />
      <circle cx={cx} cy={cy} r={Math.max(4, size * 0.045)} fill="#fff" stroke="#1F3864" strokeWidth={Math.max(2, size * 0.02)} />
      <circle cx={cx} cy={cy} r={Math.max(1.5, size * 0.015)} fill="#1F3864" />
      <text x={cx} y={h - 2} textAnchor="middle" fill={band(value)} style={{ font: `700 ${Math.round(size * 0.17)}px var(--font-sans)` }}>{value == null ? '—' : `${(value * 100).toFixed(1)}%`}</text>
      <text x={cx - r} y={cy + size * 0.1} textAnchor="middle" fill="#94A3B8" style={{ font: `600 ${Math.max(11, Math.round(size * 0.075))}px var(--font-sans)` }}>0</text>
      <text x={cx + r} y={cy + size * 0.1} textAnchor="middle" fill="#94A3B8" style={{ font: `600 ${Math.max(11, Math.round(size * 0.075))}px var(--font-sans)` }}>100</text>
    </svg>
  );
}

/** A / P / Q bar coloured by its band. */
export function CMeter({ name, value, sub, compact = false, lg = false }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-x-2"><span className={`${compact ? 'text-fs-13' : lg ? 'text-fs-15' : 'text-fs-14'} min-w-0 font-bold text-slate-700 [overflow-wrap:normal]`}>{name}</span><span className={`ml-auto shrink-0 whitespace-nowrap font-mono ${compact ? 'text-fs-14' : lg ? 'text-fs-18' : 'text-fs-15'} font-extrabold ${bandText(value)}`}>{pct(value)}</span></div>
      <div className={`mt-0.5 ${compact ? 'h-2' : 'h-2.5'} overflow-hidden rounded-full bg-slate-100`}><div className="h-full rounded-full" style={{ width: `${Math.min(100, (value ?? 0) * 100)}%`, background: band(value), transition: 'width .6s ease' }} /></div>
      {sub && <div className="mt-0.5 break-words text-fs-12 leading-snug text-slate-600" title={sub}>{sub}</div>}
    </div>
  );
}

export function CardBody({ t }) {
  return (
    // gauge beside the three factors; on a narrow card (4 lines in a row) the factors go under the gauge, so nothing overlaps
    <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
      <div className="shrink-0"><Gauge value={t.ole} size={112} /></div>
      <div className="flex min-w-[170px] flex-1 flex-col gap-1.5">
        <CMeter name="Availability" value={t.A} sub={`Run ${hm(t.actualMin)} of ${hm(t.plannedMin ?? t.totalMin)} · idle ${hm(t.lossMin)}`} />
        <CMeter name="Performance" value={t.P} sub={`Std time ${hm(t.stdSec / 60)} in ${hm(t.actualMin)}`} />
        <CMeter name="Quality" value={t.Q} sub={`${nf(t.qty - t.rejects)} good of ${nf(t.qty)} · rejection ${nf(t.rejects)}`} />
      </div>
    </div>
  );
}

/** All lines of the login together: one wide band (ring + the three factors side by side). */
export function GroupBand({ name, t }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm" aria-label={`${name} OLE`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3"><Gauge value={t.ole} size={124} label={name} /><h3 className="text-fs-18 font-extrabold text-slate-900 sm:w-28">{name}</h3></div>
        <div className="grid flex-1 min-w-0 gap-3 sm:grid-cols-3">
          <CMeter name="Availability" value={t.A} sub={`Run ${hm(t.actualMin)} of ${hm(t.plannedMin ?? t.totalMin)} · idle ${hm(t.lossMin)}`} />
          <CMeter name="Performance" value={t.P} sub={`Std time ${hm(t.stdSec / 60)} in ${hm(t.actualMin)}`} />
          <CMeter name="Quality" value={t.Q} sub={`${nf(t.qty - t.rejects)} good of ${nf(t.qty)} · rejection ${nf(t.rejects)}`} />
        </div>
      </div>
    </section>
  );
}

/** One line as a card; click selects it. */
export function LineCard({ name, line, t, ok = true, active, onOpen, hint = 'Open ›', closedDay = null }) {
  return (
    <button type="button" onClick={onOpen} aria-pressed={active} aria-label={`${name} OLE`}
      className={`text-left rounded-2xl border bg-white p-4 shadow-sm transition ${active ? 'border-sky-500 ring-2 ring-sky-200' : 'border-slate-200 hover:border-slate-400'}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-fs-18 font-extrabold text-slate-900">{name}</h3>
        <span className="text-fs-12 font-bold text-sky-700">{active ? 'Shown ▾' : hint}</span>
      </div>
      {closedDay && <ClosedNote L={closedDay} className="mt-2" />}
      {ok ? <CardBody t={t} /> : <p className="mt-3 text-fs-13 font-semibold text-slate-500">{name} is not answering right now.</p>}
    </button>
  );
}

/** The hours of one line; with onFill each hour gets a Fill / Edit button. */

/** "Closed" note of a line-day without production (no OLE that day). */
export function ClosedNote({ L, today = false, className = '' }) {
  if (!L?.closed) return null;
  const planned = L.closed === 'planned';
  return (
    <div role="status" className={`rounded-lg border px-3 py-2 text-fs-14 ${planned ? 'border-slate-300 bg-slate-100 text-slate-800' : 'border-sky-200 bg-sky-50 text-sky-900'} ${className}`}>
      <b>{planned ? `Line off all day: ${L.dayOff?.reason || ''}` : today ? 'No production yet today' : 'Line did not run (no production)'}</b>
      {planned && L.dayOff?.note ? <span className="ml-1 text-slate-600">({L.dayOff.note})</span> : null}
    </div>
  );
}

/** why a line did not answer, in plain words (from the server's error; never the server's address) */
export function whyNoAnswer(err) {
  const e = String(err || '');
  if (e === 'No answer') return '';
  if (/HYT00|HYT01|query timeout|timeout expired|longer than 25/i.test(e)) return 'its database took longer than 25 s to answer (busy or slow)';
  if (/took longer than \d+ s/i.test(e)) return 'the dashboard server took too long to answer';
  if (/28000|Login failed/i.test(e)) return 'the login to its database was refused';
  if (/08001|08S01|TCP Provider|network-related|not found|No connection could be made|could not open a connection|Communication link failure|Named Pipes/i.test(e)) return 'its server cannot be reached on the network';
  if (/Failed to fetch|NetworkError|Load failed/i.test(e)) return 'the dashboard server could not be reached';
  if (/40001|deadlock/i.test(e)) return 'its database was busy (deadlock) — it answers on the next try';
  return e ? 'an error came back from its server' : '';
}

/** "Line N is not answering": the reason, that it is asked again by itself, and a button to ask now */
export function NoAnswer({ L, onRetry = null, busy = false, className = '' }) {
  const why = whyNoAnswer(L?.error);
  // 23-11-2026: a slow answer is asked again by itself within seconds — no warning for the first 3 tries, only a quiet note
  if ((L?.tries || 0) > 0 && L.tries <= 3) {
    return (
      <div role="status" className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-fs-14 text-slate-700 ${className}`} data-testid="no-answer-soft">
        <RefreshCw size={14} className="animate-spin text-sky-700" aria-hidden /> Reading {L?.name} again… <span className="text-fs-12 text-slate-500">(its server was slow, asking again in a few seconds)</span>
      </div>
    );
  }
  return (
    <div role="status" className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-fs-14 text-amber-950 ${className}`}>
      <b>{L?.name} is not answering right now</b>{why ? <> — {why}.</> : '.'} Nothing is counted for it until it answers; the page asks again by itself.
      {onRetry && <button type="button" disabled={busy} onClick={onRetry} className="ml-2 inline-flex h-8 items-center rounded-md border border-amber-400 bg-white px-2.5 text-fs-13 font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-60">{busy ? 'Asking…' : 'Try again now'}</button>}
      {L?.error && <details className="mt-1 text-fs-12 text-amber-800"><summary className="cursor-pointer">Details</summary><span className="break-all font-mono">{String(L.error).replace(/Server=[^;]*;?/gi, '').slice(0, 300)}</span></details>}
    </div>
  );
}

export function HourTable({ L, date, onFill = null, TG = null, onRetry = null, busy = false }) {
  const t = L.total;
  const sum = useMemo(() => lossSummary(L.rows, CUR_STATIONS), [L.rows]);
  const models = sum.model;
  return (
    <section className={card} aria-label={`${L.name} hourly OLE`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-fs-16 font-bold text-slate-900">{L.name} — hour by hour</h3>
        <span className="text-fs-13 text-slate-600">{dmy(date)} · OLE <b className="font-mono text-slate-900">{pct(t.ole)}</b></span>
      </div>
      <ClosedNote L={L} className="mt-2" />
      {!L.ok ? <NoAnswer L={L} onRetry={onRetry} busy={busy} className="mt-2" /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-fs-14 tabular-nums" aria-label={`${L.name} OLE per hour`}>
            <thead><tr className="border-b-2 border-slate-300 text-left align-bottom text-fs-13 text-slate-700">
              {['Hour', 'Time', 'Loss', 'Run time', ...(TG ? ['Target'] : []), 'Actual qty', 'Std cycle', 'Std time', 'Rejection', 'Rework', 'Availability', 'Performance', 'Quality', 'OLE', ...(onFill ? [''] : [])].map((h, i) => <th key={i} className="px-1.5 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {L.rows.map((r) => {
                const e = r.e;
                const stdC = r.qty - r.noStdQty > 0 ? r.stdSec / (r.qty - r.noStdQty) : null;
                const filled = e.stops.length + e.losses.length + e.rejects.length + e.rework.length > 0;
                return (
                  <tr key={r.hour} className={`border-b border-slate-100 align-top ${r.future ? 'text-slate-400' : 'text-slate-800'}`}>
                    <td className="px-1.5 py-1.5 font-bold whitespace-nowrap">{p2(r.hour)}–{p2(r.hour + 1)}{r.breakMin > 0 && offLabels(L.shift, r.hour).map((t) => <div key={t} className="text-fs-11 font-semibold text-slate-500">{t}</div>)}{r.extra && <div className="text-fs-11 font-semibold text-amber-700">extra hour</div>}</td>
                    <td className="px-1.5 py-1.5 font-mono whitespace-nowrap">{r.future ? '—' : hm(r.totalMin)}</td>
                    <td className="px-1.5 py-1.5 min-w-[150px]">
                      <span className="font-mono font-bold whitespace-nowrap">{r.future ? '—' : hm((r.lossMin || 0) + (r.perfLossMin || 0))}</span>
                      {e.stops.length + e.losses.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{[...e.stops, ...e.losses].map((x, i) => <span key={i} className={chip} title={x.dept}>{x.model ? `${x.model}: ` : ''}{x.reason} {x.min}′</span>)}</div>}
                    </td>
                    <td className="px-1.5 py-1.5 font-mono whitespace-nowrap">{r.future ? '—' : hm(r.actualMin)}</td>
                    {TG && <td className="px-1.5 py-1.5 font-mono">{TG.by[r.hour] != null ? nf(TG.by[r.hour]) : '—'}</td>}
                    <td className="px-1.5 py-1.5 font-mono font-bold" title={r.models.map((m) => `${m.model}: ${m.quantity} pcs`).join('\n')}>{r.future && !r.qty ? '—' : nf(r.qty)}</td>
                    <td className="px-1.5 py-1.5 font-mono">{stdC ? stdC.toFixed(1) : '—'}{r.noStdQty > 0 && <span className="text-slate-500">*</span>}</td>
                    <td className="px-1.5 py-1.5 font-mono whitespace-nowrap">{r.stdSec ? hm(r.stdSec / 60) : '—'}</td>
                    <td className="px-1.5 py-1.5" title={e.rejects.map((x) => `${x.station || 'station —'} · ${x.reason}: ${x.qty}`).join('\n')}>
                      <span className="font-mono font-bold">{r.rejects || (r.future ? '—' : 0)}</span>
                      {e.rejects.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{e.rejects.map((x, i) => <span key={i} className={chip}>{x.station ? `${shortSt(x.station)}: ` : ''}{x.reason} {x.qty}</span>)}</div>}
                    </td>
                    <td className="px-1.5 py-1.5" title={e.rework.map((x) => `${x.station || 'station —'} · ${x.reason}: ${x.qty}`).join('\n')}>
                      <span className="font-mono font-bold">{r.rework || (r.future ? '—' : 0)}</span>
                      {e.rework.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{e.rework.map((x, i) => <span key={i} className={chip}>{x.station ? `${shortSt(x.station)}: ` : ''}{x.reason} {x.qty}</span>)}</div>}
                    </td>
                    {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-1.5 py-1.5 font-mono ${k === 'ole' ? 'font-extrabold' : 'font-semibold'}`}>{r.future ? '—' : pct(r[k])}</td>)}
                    {onFill && (
                      <td className="px-1.5 py-1">
                        {!r.future && <button type="button" onClick={() => onFill(r)} aria-label={`Fill ${L.name} ${p2(r.hour)}:00`} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-fs-13 font-bold ${filled ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-sky-600 bg-white text-sky-800 hover:bg-sky-50'}`}><PencilLine size={13} aria-hidden />{filled ? 'Edit' : 'Fill'}</button>}
                      </td>
                    )}
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
                <td className="px-1.5 py-1.5">Day</td>
                <td className="px-1.5 font-mono whitespace-nowrap">{hm(t.totalMin)}</td><td className="px-1.5 font-mono whitespace-nowrap">{hm((t.lossMin || 0) + (t.perfLossMin || 0))}</td><td className="px-1.5 font-mono whitespace-nowrap">{hm(t.actualMin)}</td>
                {TG && <td className="px-1.5 font-mono">{TG.day ? nf(TG.day) : '—'}</td>}<td className="px-1.5 font-mono">{nf(t.qty)}</td>
                <td className="px-1.5 font-mono">{t.qty - t.noStdQty > 0 ? (t.stdSec / (t.qty - t.noStdQty)).toFixed(1) : '—'}</td>
                <td className="px-1.5 font-mono whitespace-nowrap">{hm(t.stdSec / 60)}</td><td className="px-1.5 font-mono">{nf(t.rejects)}</td><td className="px-1.5 font-mono">{nf(t.rework)}</td>
                {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className="px-1.5 font-mono font-extrabold">{pct(t[k])}</td>)}
                {onFill && <td />}
              </tr>
            </tbody>
          </table>
          <div className="mt-2 flex flex-col gap-0.5 text-fs-13 text-slate-500">
            {t.noStdQty > 0 && <span>* {nf(t.noStdQty)} pcs without a std cycle</span>}
          </div>
          {sum.station.length > 0 && <QualityByStation stations={sum.station} qty={t.qty} name={L.name} />}
          {models.length > 0 && (
            <div className="mt-3">
              <div className="text-fs-12 font-bold uppercase tracking-wide text-slate-500">Idle time by model — {L.name}</div>
              <table className="mt-1 text-fs-13 tabular-nums" aria-label={`${L.name} loss by model`}>
                <thead><tr className="text-left text-fs-12 text-slate-500"><th className="pr-4 font-semibold">Model</th><th className="pr-4 font-semibold">Idle time</th><th className="pr-4 font-semibold">Rejection</th><th className="font-semibold">Rework</th></tr></thead>
                <tbody>{models.map((m) => <tr key={m.name}><td className="pr-4 font-bold text-slate-900">{m.name}</td><td className="pr-4 font-mono">{m.stopMin + m.lossMin ? hm(m.stopMin + m.lossMin) : '—'}</td><td className="pr-4 font-mono">{m.rejQty ? `${nf(m.rejQty)} pcs` : '—'}</td><td className="font-mono">{m.rwQty ? `${nf(m.rwQty)} pcs` : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** May this login see FPY / RTY? (the admin gives the Quality page; admin: yes) */
export const QualityCtx = createContext(true);

/** A station's short name for chips: its code from the admin's setup (LQC, FQC …), else the name without "(…)". */
export const shortSt = (s) => stationLabel(s, CUR_STATIONS);

/**
 * Rejection and rework by quality station (LQC, FQC, leak test …) with the defects found there, plus first-pass yield
 * = (pieces − rejected − reworked) ÷ pieces.
 */
export function QualityByStation({ stations, qty, name = '' }) {
  const rej = stations.reduce((a, s) => a + s.rejQty, 0), rw = stations.reduce((a, s) => a + s.rwQty, 0);
  const max = Math.max(1, ...stations.map((s) => s.rejQty + s.rwQty));
  const fpy = qty > 0 ? Math.max(0, (qty - rej - rw) / qty) : null;
  const showYield = useContext(QualityCtx);
  return (
    <div className="mt-3 rounded-xl border border-slate-200 p-3" role="region" aria-label={`Quality by station${name ? ` — ${name}` : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-fs-14 font-extrabold text-slate-900">Quality by station{name ? ` — ${name}` : ''}</div>
        <div className="text-fs-13 text-slate-600">rejected <b className="font-mono text-red-700">{nf(rej)}</b> · rework <b className="font-mono text-sky-800">{nf(rw)}</b> {showYield && <> · first-pass yield <b className="font-mono text-slate-900">{fpy == null ? '—' : `${(fpy * 100).toFixed(1)}%`}</b></>}</div>
      </div>
      <div className="mt-2 grid gap-1.5">
        {stations.map((s) => (
          <div key={s.name} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] items-center gap-2 text-fs-13">
            <span className="break-words font-bold text-slate-800" title={s.name}>{shortSt(s.name)}{shortSt(s.name) !== s.name && <span className="block text-fs-11 font-semibold text-slate-500">{s.name}</span>}</span>
            <div className="min-w-0">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                <span className="h-full bg-red-500" style={{ width: `${(s.rejQty / max) * 100}%` }} title={`${s.rejQty} rejected`} />
                <span className="h-full bg-sky-500" style={{ width: `${(s.rwQty / max) * 100}%` }} title={`${s.rwQty} rework`} />
              </div>
              <div className="mt-0.5 break-words text-fs-11 text-slate-500">{s.defects.slice(0, 4).map((d) => `${d.name} ${d.qty}${d.kind === 'rwk' ? ' rwk' : ''}`).join(' · ')}</div>
            </div>
            <span className="whitespace-nowrap font-mono text-fs-13"><b className="text-red-700">{nf(s.rejQty)}</b> rej · <b className="text-sky-800">{nf(s.rwQty)}</b> rwk</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const valText = (o) => [o.stopMin ? `${nf(o.stopMin)} min planned` : '', o.lossMin ? `${nf(o.lossMin)} min idle` : '', o.rejQty ? `${nf(o.rejQty)} rej` : '', o.rwQty ? `${nf(o.rwQty)} rwk` : ''].filter(Boolean).join(' · ') || '—';
const rcaCell = (o) => <span className="whitespace-nowrap text-fs-12"><b>{o.pending}</b> pending · <b>{o.submitted}</b> sub · <b>{o.closed}</b> closed</span>;

/**
 * Losses department → reason → each loss (date, line, hours, models, RCA). Click a row to go one level down.
 */
export function DeptDrill({ issues, rca, title, onDay = null }) {
  const [dept, setDept] = useState(null);
  const [reason, setReason] = useState(null);
  const [by, setBy] = useState('dept');   // group the losses by department or by line
  const sig = issues.map((i) => i.key).join('|');
  useEffect(() => { setDept(null); setReason(null); }, [sig, by]);   // a new period starts at the top
  const depts = useMemo(() => groupIssues(issues, rca, by), [issues, rca, by]);
  const other = by === 'dept' ? 'line' : 'dept';
  const Split = ({ items }) => <span className="flex flex-wrap gap-1">{splitText(items, other).map(([k, v]) => <span key={k} className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-fs-12 font-semibold text-slate-700">{k} <b className="font-mono text-slate-900">{v}</b></span>)}</span>;
  const D = depts.find((x) => x.key === dept);
  const reasons = useMemo(() => (D ? groupIssues(D.items, rca, 'reason') : []), [D, rca]);
  const R = reasons.find((x) => x.key === reason);
  const maxMin = Math.max(1, ...depts.map((d) => d.stopMin + d.lossMin));
  const crumb = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold hover:bg-slate-100';
  return (
    <section className={card} aria-label="Loss by department">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-fs-16 font-bold text-slate-900 mr-2"><Building2 size={18} aria-hidden /> {by === 'line' ? title.replace('Loss by department', 'Loss by line') : title}</h3>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-fs-13 font-bold" role="group" aria-label="Group losses by">
          {[['dept', 'By department'], ['line', 'By line']].map(([k, l]) => <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)} className={`px-3 py-1 ${by === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        <nav aria-label="Drill down" className="flex flex-wrap items-center text-fs-13 text-sky-800">
          <button type="button" className={crumb} onClick={() => { setDept(null); setReason(null); }}>{by === 'line' ? 'All lines' : 'All departments'}</button>
          {D && <><ChevronRight size={14} className="text-slate-400" /><button type="button" className={crumb} onClick={() => setReason(null)}>{D.name}</button></>}
          {R && <><ChevronRight size={14} className="text-slate-400" /><span className="px-1.5 font-bold text-slate-800">{KIND_TEXT[R.kind]} · {R.name}</span></>}
        </nav>
      </div>
      {!issues.length && <p className="mt-2 text-fs-14 text-slate-500">No loss, rejection or rework entered for this period.</p>}
      {issues.length > 0 && !D && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-fs-13 tabular-nums" aria-label={by === 'line' ? 'Lines' : 'Departments'}>
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600 whitespace-nowrap"><th className="py-1.5 pr-2">{by === 'line' ? 'Line' : 'Department'}</th><th className="px-2">{by === 'line' ? 'Departments' : 'Lines'}</th><th className="px-2">Idle time</th><th className="px-2 min-w-[120px] w-[30%]" /><th className="px-2">Planned stop</th><th className="px-2">Rejection</th><th className="px-2">Rework</th><th className="px-2">Losses</th><th className="px-2">RCA</th><th /></tr></thead>
            <tbody>
              {depts.map((d) => (
                <tr key={d.key} onClick={() => setDept(d.key)} className="cursor-pointer border-b border-slate-100 hover:bg-sky-50" aria-label={by === 'line' ? d.name : `Department ${d.name}`}>
                  <td className="py-2 pr-2 font-bold text-slate-900 whitespace-nowrap">{d.name}</td>
                  <td className="px-2 py-1.5"><Split items={d.items} /></td>
                  <td className="px-2 font-mono whitespace-nowrap">{d.lossMin ? `${nf(d.lossMin)} min` : '—'}</td>
                  <td className="px-2"><div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" title="idle time (dark) + planned stop (light)"><div className="h-full bg-sky-600" style={{ width: `${(d.lossMin / maxMin) * 100}%` }} /><div className="h-full bg-sky-200" style={{ width: `${(d.stopMin / maxMin) * 100}%` }} /></div></td>
                  <td className="px-2 font-mono whitespace-nowrap">{d.stopMin ? `${nf(d.stopMin)} min` : '—'}</td>
                  <td className="px-2 font-mono">{d.rejQty ? `${nf(d.rejQty)} pcs` : '—'}</td>
                  <td className="px-2 font-mono">{d.rwQty ? `${nf(d.rwQty)} pcs` : '—'}</td>
                  <td className="px-2 font-mono">{d.issues}</td>
                  <td className="px-2">{rcaCell(d)}</td>
                  <td className="px-1 text-slate-400"><ChevronRight size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {D && !R && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-fs-13 tabular-nums" aria-label={`Reasons of ${D.name}`}>
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600"><th className="py-1.5 pr-2">Loss</th><th className="px-2">Reason</th><th className="px-2">{by === 'line' ? 'Department' : 'Lines'}</th><th className="px-2">Total</th><th className="px-2">Times</th><th className="px-2">RCA</th><th /></tr></thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.key} onClick={() => setReason(r.key)} className="cursor-pointer border-b border-slate-100 hover:bg-sky-50" aria-label={`Reason ${r.name}`}>
                  <td className="py-2 pr-2 text-slate-600">{KIND_TEXT[r.kind]}</td>
                  <td className="px-2 font-bold text-slate-900">{r.name}</td>
                  <td className="px-2 py-1.5">{by === 'line' ? <span className="text-slate-700">{r.dept}</span> : <Split items={r.items} />}</td>
                  <td className="px-2 font-mono whitespace-nowrap">{valText(r)}</td>
                  <td className="px-2 font-mono">{r.issues}</td>
                  <td className="px-2">{rcaCell(r)}</td>
                  <td className="px-1 text-slate-400"><ChevronRight size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {R && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-fs-13 tabular-nums" aria-label={`Losses of ${R.name}`}>
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600"><th className="py-1.5 pr-2">Date</th><th className="px-2">Line</th><th className="px-2">Hours</th><th className="px-2">Models</th><th className="px-2">Loss</th><th className="px-2">RCA</th><th className="px-2">Root cause / action</th></tr></thead>
            <tbody>
              {R.items.map((i) => {
                const x = rca[i.key];
                return (
                  <tr key={i.key} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-2 font-bold whitespace-nowrap">{onDay ? <button type="button" className="text-sky-800 underline decoration-dotted" onClick={() => onDay(i.date, i.line)}>{dmy(i.date)}</button> : dmy(i.date)}</td>
                    <td className="px-2 whitespace-nowrap">Line {i.line}</td>
                    <td className="px-2 font-mono whitespace-nowrap">{i.hours.sort((a, b) => a - b).map((h) => `${p2(h)}:00`).join(', ')}</td>
                    <td className="px-2">{i.models.join(', ') || '—'}</td>
                    <td className="px-2 font-mono font-bold whitespace-nowrap">{nf(i.value)} {i.unit}</td>
                    <td className="px-2">{i.kind === 'stop' ? <span className="text-fs-12 text-slate-500">planned · no RCA</span> : <StatusChip st={rcaStatus(x)} />}</td>
                    <td className="px-2 text-fs-13 text-slate-700 min-w-[200px]">{x ? <><b>Cause:</b> {x.rootCause}{x.action && <><br /><b>Action:</b> {x.action}</>}{x.owner && <> · {x.owner}</>}{x.targetDate && <> · by {dmy(x.targetDate)}</>}</> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
