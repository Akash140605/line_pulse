import { LINE_COLOR } from '../theme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, LINE_IDS } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { targetOf, pphOf } from '../utils/targets';
import { dayLoss, lossMatrix, localDate, rupees, hasRates } from '../utils/money';
import { serverNow } from '../utils/serverTime';

/**
 * Management one-view: everything on one screen, refreshes itself, nothing to click.
 *   plant KPIs · one tile per line (today vs plan, this hour, running model, hour strip) · last 7 days · needs attention
 * Colour code (same everywhere): green = plan reached (≥ 100 %) · amber = close (90–99 %) · red = behind (< 90 %) · grey = no target / no data.
 */
const HIST_MS = 10 * 60 * 1000;
const ST = {
  ok: { fg: '#15803D', bg: '#DCFCE7', bar: '#16A34A', label: 'On plan' },
  watch: { fg: '#B45309', bg: '#FEF3C7', bar: '#F59E0B', label: 'Close' },
  behind: { fg: '#B91C1C', bg: '#FEE2E2', bar: '#DC2626', label: 'Behind' },
  none: { fg: '#475569', bg: '#F1F5F9', bar: '#94A3B8', label: 'No target' },
  off: { fg: '#475569', bg: '#E2E8F0', bar: '#94A3B8', label: 'Offline' },
};
// amber starts at the admin's limit (Setup → Plant overview), 90 % by default
let AMBER = 90;
const stOf = (pct) => (pct == null ? 'none' : pct >= 100 ? 'ok' : pct >= AMBER ? 'watch' : 'behind');
const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
const pctTxt = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const pad = (n) => String(n).padStart(2, '0');
const dur = (sec) => { if (sec == null) return '—'; const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)} m` : `${m} min`; };
const shiftDay = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
const dayName = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit' });


/** live_lines hours + hourModels → [{hour, quantity, models:[{mmId, model, quantity}]}] */
function liveHours(l) {
  const by = new Map((l.hours || []).map((h) => [h.hour, { hour: h.hour, quantity: Number(h.quantity) || 0, models: [] }]));
  for (const m of l.hourModels || []) {
    const h = by.get(m.hour) || { hour: m.hour, quantity: 0, models: [] };
    h.models.push({ mmId: m.mmId, model: m.model, quantity: Number(m.qty) || 0 });
    by.set(m.hour, h);
  }
  return [...by.values()].sort((a, b) => a.hour - b.hour);
}

function Pill({ st, children, big = false }) {
  const s = ST[st];
  return <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${big ? 'px-3 py-1 text-fs-16' : 'px-2.5 py-0.5 text-fs-13'}`} style={{ background: s.bg, color: s.fg }}>
    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.bar }} />{children ?? s.label}
  </span>;
}

function Kpi({ label, value, sub, st }) {
  const s = st ? ST[st] : null;
  return (
    <div className="min-w-0 rounded-xl bg-white px-4 py-2 shadow-sm border border-slate-200" style={s ? { borderTop: `5px solid ${s.bar}` } : { borderTop: '5px solid #CBD5E1' }}>
      <div className="text-fs-13 font-semibold text-slate-600 truncate">{label}</div>
      <div className="font-mono text-fs-28 font-bold leading-tight tabular-nums truncate" style={{ color: s ? s.fg : '#0F172A' }}>{value}</div>
      {sub && <div className="text-fs-13 font-medium text-slate-600 break-words">{sub}</div>}
    </div>
  );
}

/** hour strip: one bar per shift hour, colour = that hour against its plan, black tick = plan */
function HourStrip({ rows }) {
  const list = (rows || []).filter((r) => !r.outside || r.qty > 0);
  if (!list.length) return <div className="h-[70px] grid place-items-center text-fs-13 text-slate-600">No production yet</div>;
  const max = Math.max(1, ...list.map((r) => Math.max(r.qty, r.planFull || 0)));
  return (
    <div>
      <div className="flex items-end gap-[3px] h-[56px]" role="img" aria-label="Pieces per hour against plan">
        {list.map((r) => {
          const st = r.future ? null : r.running ? stOf(r.pct) : stOf(r.pct);
          const col = r.future ? 'transparent' : ST[st].bar;
          const h = (r.qty / max) * 100, p = r.planFull ? (r.planFull / max) * 100 : null;
          return (
            <div key={r.hour} className="relative flex-1 h-full flex items-end" title={`${r.label}: ${r.qty} pcs${r.planFull ? ` · plan ${Math.round(r.plan ?? 0)}${r.running ? ' so far' : ''}` : ''}`}>
              {!r.future && <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, h)}%`, background: col, opacity: r.running ? 0.75 : 1 }} />}
              {r.future && <div className="w-full h-[2px] bg-slate-200" />}
              {p != null && !r.future && <div className="absolute left-[-1px] right-[-1px] h-[3px] bg-slate-900 rounded" style={{ bottom: `calc(${p}% - 1px)` }} />}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1">
        {list.map((r) => <div key={r.hour} className={`flex-1 text-center font-mono text-fs-11 ${r.running ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{pad(r.hour)}</div>)}
      </div>
    </div>
  );
}

function LineTile({ t }) {
  if (!t.ok) {
    return (
      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden" aria-label={t.name}>
        <div className="flex items-center justify-between px-4 py-2.5" style={{ background: ST.off.bg }}>
          <h3 className="text-fs-20 font-bold text-slate-900">{t.name}</h3><Pill st="off" />
        </div>
        <div className="px-4 py-8 text-center text-fs-16 font-semibold text-slate-600">{t.offlineSince ? <>Line server offline — no production data today.<div className="mt-1 text-fs-13 font-normal">Last data: {t.offlineSince.slice(8, 10)}-{t.offlineSince.slice(5, 7)}-{t.offlineSince.slice(0, 4)} {t.offlineSince.slice(11, 16)}</div></> : 'No data from this line'}</div>
      </section>
    );
  }
  const s = ST[t.st];
  const off = t.backup;
  const offAt = off?.upTo ? (String(off.upTo).slice(0, 10) === t.today ? String(off.upTo).slice(11, 16) : `${String(off.upTo).slice(8, 10)}-${String(off.upTo).slice(5, 7)} ${String(off.upTo).slice(11, 16)}`) : '';
  return (
    <section className={`rounded-2xl bg-white border shadow-sm overflow-hidden flex flex-col ${off ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200'}`} aria-label={t.name}>
      {off && (
        <div role="status" className="flex items-center gap-2 bg-red-600 px-4 py-1.5 text-fs-14 font-bold text-white">
          <span className="h-2 w-2 shrink-0 rounded-full bg-white animate-pulse" aria-hidden />
          <span className="truncate">OFFLINE — {off.kind === 'snapshot' ? 'last data read' : 'backup copy'}{offAt ? `, scans up to ${offAt}` : ''}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-4 py-2" style={{ background: s.bg, borderTop: `6px solid ${s.bar}` }}>
        <h3 className="text-fs-20 font-bold text-slate-900 flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: LINE_COLOR[t.line] }} />{t.name}</h3>
        <Pill st={t.st} />
      </div>
      <div className="px-4 pt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-fs-13 font-semibold text-slate-600">{off ? (t.day === t.today ? `Today up to ${offAt || '—'}` : `Day ${t.day}`) : 'Today vs plan'}</div>
          <div className="font-mono text-fs-40 font-bold leading-none tabular-nums" style={{ color: s.fg }}>{pctTxt(t.pct)}</div>
        </div>
        <div className="text-right font-mono tabular-nums">
          <div className="text-fs-24 font-bold text-slate-900 leading-tight">{nf(t.actual)}</div>
          <div className="text-fs-14 font-semibold text-slate-600">of {nf(t.plan)} plan</div>
        </div>
      </div>
      <div className="mx-4 mt-2 h-2.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, t.pct || 0)}%`, background: s.bar }} /></div>
      <div className="grid grid-cols-2 gap-2 px-4 pt-2.5">
        <div className="rounded-lg border border-slate-200 px-2.5 py-1.5" style={{ borderLeft: `5px solid ${ST[t.hourSt].bar}` }}>
          <div className="text-fs-13 font-semibold text-slate-600">This hour</div>
          <div className="font-mono text-fs-20 font-bold tabular-nums leading-tight" style={{ color: ST[t.hourSt].fg }}>{nf(t.hourQty)}<span className="text-fs-14 font-semibold text-slate-600"> / {nf(t.hourPlan)}</span></div>
        </div>
        <div className="rounded-lg border border-slate-200 px-2.5 py-1.5" style={{ borderLeft: `5px solid ${ST[t.cycSt].bar}` }}>
          <div className="text-fs-13 font-semibold text-slate-600">Cycle now</div>
          <div className="font-mono text-fs-20 font-bold tabular-nums leading-tight" style={{ color: ST[t.cycSt].fg }}>{t.cycle ? `${Math.round(t.cycle)}s` : '—'}<span className="text-fs-14 font-semibold text-slate-600"> / {t.targetCycle ? `${Math.round(t.targetCycle * 10) / 10}s` : '—'}</span></div>
        </div>
      </div>
      <div className="px-4 pt-2 text-fs-14 text-slate-800 break-words" title={[t.company, t.model].filter(Boolean).join(' · ')}>
        <span className="font-semibold text-slate-600">Running </span><b>{t.model || '—'}</b>{t.company ? <span className="text-slate-600"> · {t.company}</span> : null}
        {t.targetPph ? <span className="text-slate-600"> · plan {nf(t.targetPph)}/hr</span> : null}
      </div>
      <div className="px-4 pt-1.5 pb-2.5 mt-auto"><HourStrip rows={t.rows} /></div>
    </section>
  );
}

const DEFAULT_VIEW = { showKpis: true, lines: true, week: true, attention: true, kpis: {}, refreshSec: 15, amberFrom: 90 };
export default function CommandView({ settings: view = DEFAULT_VIEW }) {
  const V = { ...DEFAULT_VIEW, ...view, kpis: { ...(view?.kpis || {}) } };
  const kpiOn = (k) => V.kpis[k] !== false;
  AMBER = V.amberFrom;
  const liveMs = V.refreshSec * 1000;
  const settings = useAllLineSettings(LINE_IDS);
  const [live, setLive] = useState(null);
  const [liveErr, setLiveErr] = useState('');
  const [hist, setHist] = useState(null);
  const [now, setNow] = useState(() => serverNow());
  const busy = useRef(false);

  const loadLive = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try { const j = await api.liveLinesParallel({ cmin: 1, cmax: 22 }); if (j?.error) throw new Error(j.error); setLive(j); setLiveErr(''); setNow(serverNow()); }
    catch (e) { setLiveErr(String(e.message || e)); }
    finally { busy.current = false; }
  }, []);
  const loadHist = useCallback(async () => {
    const end = localDate(serverNow());
    try { setHist({ ...(await api.allLinesParallel({ start: shiftDay(end, -6), end, cmin: 1, cmax: 22 })), end }); } catch { /* the week panel just stays empty */ }
  }, []);
  useEffect(() => { loadLive(); loadHist(); }, [loadLive, loadHist]);
  useEffect(() => {
    const a = setInterval(() => { if (!document.hidden) loadLive(); }, liveMs);
    const b = setInterval(() => { if (!document.hidden) loadHist(); }, HIST_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [loadLive, loadHist, liveMs]);

  const today = localDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // today, per line, from the live numbers
  const tiles = useMemo(() => LINE_IDS.map((id) => {
    const l = (live?.lines || []).find((x) => String(x.line) === id) || { line: id, name: `Line ${id}`, ok: false };
    const st = settings[id] || {};
    if (!l.ok) return { line: id, name: l.name || `Line ${id}`, ok: false, st: 'off' };
    // offline line shown from the backup / last saved data: its own day, counted only up to its last data (fair "as of" numbers)
    const day = l.backup ? (l.day || live?.focus || today) : (live?.focus || today);
    const upTo = l.backup?.upTo || '';
    if (l.backup && day !== today) return { line: id, name: l.name || `Line ${id}`, ok: false, st: 'off', offlineSince: upTo };   // offline, nothing today
    const asOfMin = l.backup && upTo.slice(0, 10) === day ? Number(upTo.slice(11, 13)) * 60 + Number(upTo.slice(14, 16)) : null;
    const isToday = !l.backup && day === today;
    const dl = dayLoss({ date: day, hours: liveHours(l), settings: st, nowMin: isToday ? nowMin : asOfMin });
    const rows = dl.td.rows;
    const cur = rows.find((r) => r.running) || [...rows].reverse().find((r) => !r.future && r.qty > 0);
    const tc = targetOf(st.targets, l.mmId ?? l.running?.mmId);
    const cycle = l.running?.currentCycle ?? l.avgCycle;
    const lastScanMin = l.lastScan ? Number(l.lastScan.slice(11, 13)) * 60 + Number(l.lastScan.slice(14, 16)) : null;
    return {
      line: id, name: l.name, ok: true, backup: l.backup || null, day, actual: dl.actual, plan: dl.target, pct: dl.pct, short: dl.short, lostSec: dl.lostSec, rs: dl.rsTotal,
      st: stOf(dl.pct), rows, hourQty: cur?.qty ?? null, hourPlan: cur?.plan != null ? Math.round(cur.plan) : null, hourSt: stOf(cur?.pct ?? null),
      model: l.model, company: l.company || l.running?.company, targetCycle: tc, targetPph: tc ? pphOf(tc) : null, cycle,
      cycSt: tc && cycle ? (cycle <= tc ? 'ok' : cycle <= tc * 1.1 ? 'watch' : 'behind') : 'none',
      idleMin: isToday && lastScanMin != null ? nowMin - lastScanMin : null, money: st.money, today,
    };
  }), [live, settings, today, nowMin, V.amberFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  const plant = useMemo(() => {
    const on = tiles.filter((t) => t.ok && (!t.backup || t.day === t.today));   // an offline line's older day is not added to today
    const withPlan = on.filter((t) => t.plan != null);
    const actual = on.reduce((s, t) => s + (t.actual || 0), 0);
    const plan = withPlan.length ? withPlan.reduce((s, t) => s + t.plan, 0) : null;
    const actP = withPlan.reduce((s, t) => s + (t.actual || 0), 0);
    const pct = plan > 0 ? (actP / plan) * 100 : null;
    const short = withPlan.length ? withPlan.reduce((s, t) => s + (t.short || 0), 0) : null;
    const lost = withPlan.length ? withPlan.reduce((s, t) => s + (t.lostSec || 0), 0) : null;
    const rsList = on.map((t) => t.rs).filter((v) => v != null);
    return { actual, plan, pct, short, lost, rs: rsList.length ? rsList.reduce((a, b) => a + b, 0) : null, rates: on.some((t) => hasRates(t.money)), running: on.filter((t) => t.idleMin != null && t.idleMin <= 15).length, count: tiles.length };
  }, [tiles]);

  // last 7 days per line (finished days from the line databases; today from the live numbers above)
  const week = useMemo(() => {
    if (!hist?.lines) return null;
    const mx = lossMatrix(hist.lines, settings, { now, range: { start: shiftDay(hist.end, -6), end: hist.end } });
    const days = []; for (let i = 6; i >= 0; i--) days.push(shiftDay(hist.end, -i));
    return { days, lines: LINE_IDS.map((id) => { const l = mx.lines.find((x) => String(x.line) === id); return { line: id, name: `Line ${id}`, days: l?.days || {}, total: l?.total }; }) };
  }, [hist, settings, now]);

  // short, automatic notes: what management should look at first
  const notes = useMemo(() => {
    const out = [];
    for (const t of tiles) {
      if (!t.ok) { out.push({ sev: 9, st: 'off', text: `${t.name} — no data from the line` }); continue; }
      if (t.backup) out.push({ sev: 8, st: 'off', text: `${t.name} — server offline, numbers are from ${t.backup.kind === 'snapshot' ? 'the last data read' : 'the backup copy'} (scans up to ${String(t.backup.upTo || '').slice(11, 16) || '—'})` });
      if (t.idleMin != null && t.idleMin >= 15 && nowMin < 21 * 60) out.push({ sev: 8, st: 'behind', text: `${t.name} — stopped, no scan for ${t.idleMin} min` });
      if (t.st === 'behind') out.push({ sev: 5 + (100 - (t.pct || 0)) / 100, st: 'behind', text: `${t.name} — ${pctTxt(t.pct)} of plan, ${nf(t.short)} pcs short` });
      else if (t.st === 'watch') out.push({ sev: 3, st: 'watch', text: `${t.name} — ${pctTxt(t.pct)} of plan, close` });
      if (t.model && !t.targetCycle) out.push({ sev: 2, st: 'none', text: `${t.name} — running model has no target` });
    }
    return out.sort((a, b) => b.sev - a.sev).slice(0, 5);
  }, [tiles, nowMin]);

  const pSt = stOf(plant.pct);
  const stale = !!liveErr;

  return (
    <div className="flex flex-col gap-2.5" aria-label="Management one view">
      {/* status row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <span className="text-fs-18 font-bold text-slate-900">{new Date(`${today}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}</span>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-0.5 text-fs-13 font-bold ${stale ? 'bg-amber-400 text-slate-900' : 'bg-emerald-600 text-white'}`} role="status">
          <span className={`h-2 w-2 rounded-full ${stale ? 'bg-slate-900' : 'bg-white animate-pulse'}`} />{stale ? 'Connection lost · last data' : 'Live'}
        </span>
        <span className="font-mono text-fs-16 font-bold tabular-nums text-slate-800">{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="ml-auto flex flex-wrap gap-1.5"><Pill st="ok">≥ 100% on plan</Pill><Pill st="watch">{V.amberFrom}–99% close</Pill><Pill st="behind">&lt; {V.amberFrom}% behind</Pill><Pill st="none">no target</Pill></span>
      </div>

      {/* plant KPIs (tiles chosen on the Setup page) */}
      {V.showKpis && (() => {
        const k = [
          kpiOn('produced') && <Kpi key="produced" label="Produced" value={nf(plant.actual)} sub="pieces, all lines" />,
          kpiOn('plan') && <Kpi key="plan" label="Plan so far" value={nf(plant.plan)} sub={plant.plan == null ? 'set model targets' : 'up to now, lunch excluded'} />,
          kpiOn('achievement') && <Kpi key="ach" label="Achievement" value={pctTxt(plant.pct)} sub={ST[pSt].label} st={pSt} />,
          kpiOn('short') && <Kpi key="short" label="Short" value={plant.short == null ? '—' : nf(plant.short)} sub="pieces below plan" st={plant.short > 0 ? pSt : plant.short === 0 ? 'ok' : null} />,
          kpiOn('lost') && <Kpi key="lost" label="Lost time" value={dur(plant.lost)} sub="line time" st={plant.lost > 0 ? pSt : plant.lost === 0 ? 'ok' : null} />,
          kpiOn('running') && (plant.rates
            ? <Kpi key="rs" label="Loss today" value={rupees(plant.rs, { short: true })} sub="pieces + line time" st={plant.rs > 0 ? pSt : 'ok'} />
            : <Kpi key="run" label="Lines running" value={`${plant.running} / ${plant.count}`} sub="scan in the last 15 min" st={plant.running === plant.count ? 'ok' : plant.running ? 'watch' : 'behind'} />),
        ].filter(Boolean);
        const cols = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6' }[k.length];
        return k.length ? <div className={`grid gap-3 grid-cols-2 md:grid-cols-3 ${cols}`}>{k}</div> : null;
      })()}

      {/* the four lines */}
      {V.lines && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => <LineTile key={t.line} t={t} />)}
        </div>
      )}

      {/* week + attention */}
      {(V.week || V.attention) && (
      <div className={`grid gap-3 grid-cols-1 ${V.week && V.attention ? 'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}`}>
        {V.week && <section className="rounded-2xl bg-white border border-slate-200 shadow-sm px-4 py-2.5" aria-label="Last 7 days">
          <h3 className="text-fs-18 font-bold text-slate-900 mb-1">Last 7 days · achievement vs plan</h3>
          {week ? (
            <div className="overflow-x-auto">
              <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
                <thead><tr>
                  <th className="text-left text-fs-13 font-semibold text-slate-600 px-1">Line</th>
                  {week.days.map((d) => <th key={d} className={`text-center text-fs-13 font-semibold px-1 ${d === today ? 'text-slate-900' : 'text-slate-600'}`}>{d === today ? 'Today' : dayName(d)}</th>)}
                  <th className="text-center text-fs-13 font-semibold text-slate-900 px-1">7 days</th>
                </tr></thead>
                <tbody>{week.lines.map((l) => (
                  <tr key={l.line}>
                    <th className="text-left text-fs-16 font-bold text-slate-900 px-1 whitespace-nowrap"><span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5" style={{ background: LINE_COLOR[l.line] }} />{l.name}</th>
                    {week.days.map((d) => {
                      const t = d === today ? tiles.find((x) => x.line === l.line) : null;
                      const dl = l.days[d];
                      const pct = t ? (t.ok ? t.pct : null) : dl && !dl.skipped ? dl.pct : null;
                      const st = pct == null ? 'none' : stOf(pct);
                      const s = ST[st];
                      return <td key={d} className="text-center font-mono text-fs-16 font-bold rounded-md py-1" style={{ background: pct == null ? '#F8FAFC' : s.bg, color: pct == null ? '#94A3B8' : s.fg }}
                        title={dl?.skipped ? 'no production (not counted)' : undefined}>{pct == null ? '—' : `${Math.round(pct)}%`}</td>;
                    })}
                    {(() => { const p = l.total?.pct; const st = stOf(p); return <td className="text-center font-mono text-fs-16 font-bold rounded-md py-1" style={{ background: p == null ? '#F8FAFC' : ST[st].bg, color: p == null ? '#94A3B8' : ST[st].fg, outline: `2px solid ${p == null ? '#E2E8F0' : ST[st].bar}` }}>{pctTxt(p)}</td>; })()}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="py-8 text-center text-fs-14 text-slate-600">Loading the last 7 days…</div>}
        </section>}

        {V.attention && <section className="rounded-2xl bg-white border border-slate-200 shadow-sm px-4 py-2.5" aria-label="Needs attention">
          <h3 className="text-fs-18 font-bold text-slate-900 mb-1.5">Needs attention</h3>
          {notes.length ? (
            <ul className="space-y-1.5">
              {notes.map((n, i) => (
                <li key={i} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-fs-16 font-semibold" style={{ background: ST[n.st].bg, color: ST[n.st].fg }}>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: ST[n.st].bar }} />{n.text}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg px-3 py-3 text-fs-16 font-bold" style={{ background: ST.ok.bg, color: ST.ok.fg }}>All lines on plan</div>
          )}
          <p className="mt-2 text-fs-13 text-slate-600">Updates every {V.refreshSec} s. Plan = model targets × working time (lunch excluded).</p>
        </section>}
      </div>
      )}
    </div>
  );
}
