import React, { useEffect, useMemo, useState } from 'react';
import { fmtDate, fs } from '../theme';
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from 'recharts';
import { Target, Settings2, History, Clock, Utensils } from 'lucide-react';
import { api, shiftDate } from '../api';
import { buildTargetDay, requiredRate, targetOf, pphOf, historyRows, splitHour, modelDay, modelActualCycles } from '../utils/targets';
import { currentRule } from '../hooks/useAutoTargets';
import { fmtMin, normShift, shiftText } from '../utils/shift';
import { serverNow } from '../utils/serverTime';

const nf = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
// sign after rounding, so −0.4 shows as "0" and not "−0"
const signed = (v, d = 0) => {
  if (v == null) return '—';
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${nf(Math.abs(r), d)}`;
};
const sec = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} s`);
// Colour code (src/theme.js): reached = sky, close = slate, behind = red text only (a negative number); boxes stay white
const TONE = { ok: 'text-sky-700', watch: 'text-slate-700', behind: 'text-red-700', future: 'text-slate-600', null: 'text-slate-900' };
const BG = { ok: 'bg-white border-slate-200', watch: 'bg-white border-slate-200', behind: 'bg-white border-slate-200', null: 'bg-white border-slate-200' };
const BAR = { ok: '#047857', watch: '#B45309', behind: '#B91C1C', future: '#94A3B8', null: '#1D4ED8' };
const LABEL = { ok: 'On target', watch: 'Slightly behind', behind: 'Behind target', future: 'Not started', null: 'No target' };
const tick = { fontSize: fs(12), fill: '#1E293B' };

/** Cycle difference: lower than target is good. */
const cycTone = (diff, target) => (diff == null || !target ? 'text-slate-900' : diff <= 0 ? 'text-sky-700' : diff <= target * 0.1 ? 'text-slate-700' : 'text-red-700');

function Kpi({ label, value, sub, tone = 'text-slate-900', status, hint = '' }) {
  return (
    <div title={hint || undefined} className={`rounded-xl border px-3 py-2 min-w-0 ${hint ? 'cursor-help' : ''} ${BG[status ?? 'null'] || BG.null}`}>
      <div className="text-fs-12 font-extrabold uppercase tracking-wide text-slate-700 leading-tight">{label}{hint && <span className="ml-1 normal-case font-normal text-slate-500" aria-hidden>ⓘ</span>}</div>
      <div className={`font-mono tabular-nums text-fs-28 leading-tight font-extrabold ${tone}`}>{value}</div>
      {sub && <div className="text-fs-13 font-semibold text-slate-700 leading-snug">{sub}</div>}
    </div>
  );
}

function Part({ p, isToday }) {
  if (!p.work) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-400 bg-slate-100 px-3 py-2 flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-1.5 text-fs-13 font-extrabold uppercase tracking-wide text-slate-800"><Utensils size={14} aria-hidden /> Lunch</div>
        <div className="font-mono text-fs-18 font-extrabold text-slate-900">{fmtMin(p.from)}–{fmtMin(p.to)}</div>
        <div className="text-fs-13 font-semibold text-slate-700">No target in this window{p.qty != null ? ` · ${p.qty} scans during lunch` : ''}</div>
      </div>
    );
  }
  const st = !p.started ? 'future' : p.status;
  const pct = p.pct == null ? 0 : Math.min(100, p.pct);
  return (
    <div className={`rounded-xl border-2 px-3 py-2 min-w-0 ${BG[st] || 'bg-white border-slate-200'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-fs-13 font-extrabold uppercase tracking-wide text-slate-800">{p.label}</div>
        <div className="font-mono text-fs-13 font-bold text-slate-800">{fmtMin(p.from)}–{fmtMin(p.to)}</div>
      </div>
      {!p.started ? (
        <div className="text-fs-14 font-semibold text-slate-700 py-2">Starts at {fmtMin(p.from)}</div>
      ) : (
        <>
          <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-fs-24 font-extrabold text-slate-950">{nf(p.qty)}</span>
            <span className="text-fs-14 font-bold text-slate-700">/ {p.hasPlan ? nf(p.plan) : '—'} target{isToday && !p.done ? ' till now' : ''}</span>
          </div>
          {p.noTgtQty > 0 && <div className="text-fs-12 font-semibold text-slate-700" title="Pieces of models without a target: not counted against the target">{nf(p.noTgtQty)} pcs without a target (not counted)</div>}
          <div className="mt-1 h-2.5 rounded-full bg-white/70 border border-slate-300 overflow-hidden" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BAR[st] || BAR.null }} />
          </div>
          <div className="mt-1 flex justify-between text-fs-13 font-bold">
            <span className={TONE[st]}>{p.hasPlan ? `${signed(p.diff)} pcs` : 'Set a target'}</span>
            <span className={TONE[st]}>{p.pct != null ? `${nf(p.pct, 0)} %` : ''}</span>
          </div>
          {p.hasPlan && isToday && !p.done && <div className="text-fs-12 font-semibold text-slate-700">Full segment target: {nf(p.planFull)}</div>}
        </>
      )}
    </div>
  );
}

const d1m = (v) => (Math.round(v * 10) / 10).toFixed(1);
/** One model in one hour from its own scans: { n, sec, min, mean } or null. */
const modelHour = (actual, m, hour) => actual?.[String(m.mmId)]?.byHour?.[hour] || null;
/** Running minutes of an hour = sum over its models. */
const hourRun = (r, actual) => { if (!actual || !r.models.length) return null; let t = 0, any = false; for (const m of r.models) { const x = modelHour(actual, m, r.hour); if (x) { t += x.min; any = true; } } return any ? t : null; };
/** Minutes of the hour's working time the line did not run (null for hours still to come / unknown). */
const stopMin = (r, actual) => { if (r.future || !(r.workSec > 0)) return null; const run = hourRun(r, actual); return run == null ? null : Math.max(0, r.workSec / 60 - run); };
const stopText = (r, actual) => { const m = stopMin(r, actual); return m == null ? '' : m < 1 ? '—' : ranText(m); };
const ranText = (min) => { if (min == null) return ''; const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : min < 1 ? '< 1 min' : `${m} min`; };
const HEAD_TIP = { 'Stopped': 'Working time of the hour that the line did not run: working minutes − Run time (stops, changeovers, waiting). This is why an hour can miss its target even when the models run faster than their target cycle.', 'Run time': 'How long the model ran in the hour: sum of the gaps between its pieces of 1 s up to the gap limit (stops, changeovers and other models left out)', 'Avg cycle': 'Hour row: the hour as a whole. Model row: that model\'s own average cycle in the hour (gaps up to the gap limit)' };

function HourTable({ day, shift, actual = null, cap = 22 }) {
  const s = normShift(shift);
  const lunchAfter = s.lunchStart != null ? Math.floor(s.lunchStart / 60) : null;
  const md = modelDay(day);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-fs-13">
        <thead><tr className="text-left text-slate-700 uppercase tracking-wide border-b-2 border-slate-300 bg-slate-50">
          {['Hour', 'Model(s)', 'Qty', 'Run time', 'Stopped', 'Target', 'Diff', '%', 'Avg cycle', 'Target cycle', 'Δ cycle'].map((h) => <th key={h} className="px-2 py-2 font-extrabold whitespace-nowrap" title={HEAD_TIP[h]}>{h}</th>)}
        </tr></thead>
        <tbody>
          {day.rows.map((r) => (
            <React.Fragment key={r.hour}>
              {r.hour === lunchAfter && (
                <tr className="bg-slate-200/80 border-y-2 border-dashed border-slate-400">
                  <td colSpan={11} className="px-2 py-1 text-fs-13 font-extrabold text-slate-800">
                    <span className="inline-flex items-center gap-1.5"><Utensils size={13} aria-hidden /> Lunch {fmtMin(s.lunchStart)}–{fmtMin(s.lunchEnd)}{r.lunchQty ? ` · ${r.lunchQty} scans during lunch (counted separately)` : ' · no scans during lunch'} — Segment 1 ends · Segment 2 starts {fmtMin(s.lunchEnd)} (hour {r.label} has {Math.round(r.fullSec / 60)} working min)</span>
                  </td>
                </tr>
              )}
              <tr className={`border-b border-slate-200 font-mono ${r.running ? 'bg-sky-50' : ''} ${r.future ? 'text-slate-600' : 'text-slate-900'}`}>
                <td className="px-2 py-1.5 font-bold whitespace-nowrap">{r.label}{r.running ? ' ●' : ''}{r.outside ? <span className="ml-1 font-sans text-fs-12 font-bold text-blue-700">outside shift</span> : null}</td>
                <td className="px-2 py-1.5 font-sans font-semibold min-w-[10rem]">
                  {r.models.length > 1 ? <span className="text-slate-700">{r.models.length} models ↓</span> : r.models.length ? r.models.map((m) => (
                    <span key={m.mmId ?? m.model} className="mr-2 whitespace-nowrap">{m.model} <span className="font-mono text-slate-700">{m.qty}</span>{!m.target && <span className="ml-0.5 text-fs-11 font-bold text-slate-700" title="No target set for this model">(no target)</span>}</span>
                  )) : <span className="text-slate-600">{r.future ? '' : 'no production'}</span>}
                </td>
                <td className="px-2 py-1.5 font-extrabold">{r.future && !r.qty ? '' : nf(r.qty)}{r.noTgtQty > 0 && <span className="block font-sans text-fs-11 font-bold text-slate-600" title="Pieces of models without a target: not counted against the target">{nf(r.noTgtQty)} no target</span>}</td>
                <td className="px-2 py-1.5 whitespace-nowrap" title="running time of the hour: sum of the gaps of 1–cap s between pieces (stops left out)">{ranText(hourRun(r, actual))}</td>
                <td className="px-2 py-1.5 whitespace-nowrap font-bold text-red-700" title="working minutes of the hour − Ran for">{stopText(r, actual)}</td>
                <td className="px-2 py-1.5">{r.plan != null && !r.future ? nf(r.plan) : r.planFull != null ? <span className="text-slate-600">{nf(r.planFull)}</span> : '—'}</td>
                <td className={`px-2 py-1.5 font-extrabold ${TONE[r.status ?? 'null']}`}>{r.diff != null ? signed(r.diff) : ''}</td>
                <td className={`px-2 py-1.5 font-bold ${TONE[r.status ?? 'null']}`}>{r.pct != null ? `${nf(r.pct)}%` : ''}</td>
                <td className="px-2 py-1.5">{sec(r.cycle)}</td>
                <td className="px-2 py-1.5">{r.targetCycle ? `${r.targetCycle.toFixed(1)} s${r.targetFromMix ? '' : '*'}` : '—'}</td>
                <td className={`px-2 py-1.5 font-bold ${cycTone(r.cycleDiff, r.targetCycle)}`}>{r.cycleDiff != null ? `${signed(r.cycleDiff, 1)} s` : ''}</td>
              </tr>
              {r.models.length > 1 && splitHour(r).map((m) => (
                <tr key={`${r.hour}-${m.mmId ?? m.model}`} className="border-b border-slate-100 bg-slate-50/70 font-mono text-fs-13 text-slate-800" aria-label={`${r.label} ${m.model}`}>
                  <td className="px-2 py-1 text-slate-400 text-right">└</td>
                  <td className="px-2 py-1 font-sans font-semibold">{m.model}{!m.target && <span className="ml-1 text-fs-11 font-bold text-slate-700" title="No target for this model (not in the Model master / no cycle): its pieces are not counted against the hour's target">(no target)</span>}</td>
                  <td className="px-2 py-1 font-bold">{nf(m.qty)}</td>
                  <td className="px-2 py-1 font-bold text-slate-900 whitespace-nowrap" title={m.min != null ? `needs ${d1m(m.min)} min at its target cycle` : undefined}>{ranText(modelHour(actual, m, r.hour)?.min)}</td>
                  <td />
                  <td className="px-2 py-1">{m.plan != null ? nf(m.plan) : ''}</td>
                  <td className={`px-2 py-1 font-bold ${m.diff != null ? (m.diff >= 0 ? 'text-sky-700' : 'text-red-700') : ''}`}>{m.diff != null ? signed(m.diff) : ''}</td>
                  <td className="px-2 py-1">{m.pct != null ? `${nf(m.pct)}%` : ''}</td>
                  <td className="px-2 py-1 font-bold text-slate-900" title="this model's own average cycle in the hour (gaps 1–cap s)">{sec(modelHour(actual, m, r.hour)?.mean)}</td>
                  <td className="px-2 py-1">{m.tc ? `${m.tc.toFixed(1)} s` : '—'}</td>
                  {(() => { const mc = modelHour(actual, m, r.hour)?.mean; const dd = mc != null && m.tc ? mc - m.tc : null; return <td className={`px-2 py-1 font-bold ${cycTone(dd, m.tc)}`}>{dd != null ? `${signed(dd, 1)} s` : ''}</td>; })()}
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr className="bg-slate-100 font-mono font-extrabold border-t-2 border-slate-300 text-slate-950">
            <td className="px-2 py-2 font-sans">Day</td><td />
            <td className="px-2">{nf(day.total.qty)}{day.total.noTgtQty > 0 && <span className="block font-sans text-fs-11 font-bold text-slate-600" title="Pieces of models without a target: not counted against the target">{nf(day.total.noTgtQty)} no target</span>}</td><td className="px-2 whitespace-nowrap">{ranText(day.rows.reduce((a, r) => a + (hourRun(r, actual) || 0), 0) || null)}</td><td className="px-2 whitespace-nowrap text-red-700">{ranText(day.rows.reduce((a, r) => a + (stopMin(r, actual) || 0), 0) || null)}</td><td className="px-2">{nf(day.total.plan)}</td>
            <td className={`px-2 ${TONE[day.total.status ?? 'null']}`}>{signed(day.total.diff)}</td>
            <td className={`px-2 ${TONE[day.total.status ?? 'null']}`}>{day.total.pct != null ? `${nf(day.total.pct)}%` : ''}</td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
      {md.length > 0 && (
        <div className="mt-3">
          <div className="text-fs-14 font-extrabold text-slate-900 mb-1">Model-wise — whole day</div>
          <table className="w-full text-fs-13" aria-label="Model-wise day">
            <thead><tr className="text-left text-slate-700 uppercase tracking-wide border-b-2 border-slate-300 bg-slate-50">
              {[['Model'], ['Hours'], ['Qty'], ['Target'], ['Diff'], ['%'], ['Target cycle', 'Method A + allowance of this model (from its scans since the target start date)'], ['Actual cycle', `This model's own speed today: average gap between two of its pieces, gaps 1–${cap} s only (stops and other models in between left out). Models with fewer than 10 pieces: shown grey, not reliable.`], ['Time at target', 'Qty × target cycle: the time this model needed at its target speed']].map(([h, t]) => <th key={h} title={t} className={`px-2 py-2 font-extrabold whitespace-nowrap ${t ? 'cursor-help' : ''}`}>{h}{t && <span className="ml-1 normal-case font-normal text-slate-500">ⓘ</span>}</th>)}
            </tr></thead>
            <tbody>
              {md.map((m) => (
                <tr key={m.mmId ?? m.model} className="border-b border-slate-100 font-mono">
                  <td className="px-2 py-1.5 font-sans font-semibold">{m.model}</td>
                  <td className="px-2 py-1.5">{m.hours}</td>
                  <td className="px-2 py-1.5 font-extrabold">{nf(m.qty)}</td>
                  <td className="px-2 py-1.5">{m.plan != null ? nf(m.plan) : '—'}</td>
                  <td className={`px-2 py-1.5 font-bold ${m.diff != null ? (m.diff >= 0 ? 'text-sky-700' : 'text-red-700') : ''}`}>{m.diff != null ? signed(m.diff) : ''}</td>
                  <td className="px-2 py-1.5">{m.pct != null ? `${nf(m.pct)}%` : ''}</td>
                  <td className="px-2 py-1.5">{m.tc ? `${m.tc.toFixed(1)} s` : '—'}</td>
                  {(() => {
                    const a = actual?.[String(m.mmId)];
                    if (!a || a.mean == null) return <td className="px-2 py-1.5 text-slate-400" title="No gaps of this model today (single piece or only long gaps)">—</td>;
                    const slow = m.tc && a.mean > m.tc;
                    return (
                      <td className={`px-2 py-1.5 whitespace-nowrap ${a.few ? 'text-slate-400 italic' : slow ? 'text-slate-700 font-bold' : 'text-sky-700 font-bold'}`}
                        title={`${a.valid} gaps of 1–${cap} s · average ${a.mean.toFixed(1)} s · median ${a.median.toFixed(1)} s${a.few ? ' · fewer than 10 pieces: not reliable' : ''}`}>
                        {a.mean.toFixed(1)} s{a.few && <span className="ml-1 not-italic text-fs-11 font-sans font-bold text-slate-500">few pcs</span>}
                      </td>
                    );
                  })()}
                  <td className="px-2 py-1.5">{m.min ? `${d1m(m.min)} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-1 text-fs-12 font-semibold text-slate-700">* = hour without production (previous model's target) · grey target = still to come</div>
    </div>
  );
}

function ModelHistory({ models, targets, running, filters, latestDate, onEditTarget }) {
  const [mmId, setMmId] = useState(running?.mmId ?? models?.[0]?.mmId ?? null);
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState(null);
  const [hours, setHours] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (running?.mmId != null && mmId == null) setMmId(running.mmId); }, [running?.mmId]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = models.find((m) => String(m.mmId) === String(mmId));
  const tc = targetOf(targets, mmId);
  const start = shiftDate(latestDate, -(days - 1));

  useEffect(() => {
    if (mmId == null || !latestDate) return undefined;
    const c = new AbortController();
    setLoading(true); setErr(''); setPick(null); setHours(null);
    api.rangeOverview(start, latestDate, { ...filters, companyId: null, mmId }, { signal: c.signal })
      .then((j) => setRows(j?.daily?.days || []))
      .catch((e) => { if (e.name !== 'AbortError') setErr(String(e.message || e)); })
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [mmId, start, latestDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pick) return undefined;
    const c = new AbortController();
    setHours(null);
    api.dayOverview(pick, { ...filters, companyId: null, mmId }, { signal: c.signal })
      .then((j) => setHours((j?.hourly?.hours || []).filter((h) => h.quantity > 0)))
      .catch((e) => { if (e.name !== 'AbortError') setErr(String(e.message || e)); });
    return () => c.abort();
  }, [pick, mmId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hist = useMemo(() => historyRows(rows, tc), [rows, tc]);
  const chart = useMemo(() => [...hist].reverse().map((r) => ({ ...r, label: r.date.slice(5) })), [hist]);
  const tot = hist.reduce((a, r) => ({ qty: a.qty + r.qty, hrs: a.hrs + (r.activeHours || 0), cs: a.cs + (r.cycle || 0) * r.qty, cq: a.cq + (r.cycle ? r.qty : 0) }), { qty: 0, hrs: 0, cs: 0, cq: 0 });
  const avgC = tot.cq ? tot.cs / tot.cq : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-fs-13 font-bold text-slate-800">Model
          <select value={mmId ?? ''} onChange={(e) => setMmId(e.target.value)} className="mt-0.5 block h-9 max-w-[22rem] rounded-lg border border-slate-400 bg-white px-2 text-fs-14 font-bold text-slate-950">
            {models.map((m) => <option key={m.mmId} value={m.mmId}>{m.companyTitle ? `${m.companyTitle} · ` : ''}{m.model}{String(m.mmId) === String(running?.mmId) ? '  (running now)' : ''}</option>)}
          </select>
        </label>
        <div className="inline-flex rounded-lg border border-slate-400 overflow-hidden text-fs-13 font-bold" role="group" aria-label="History period">
          {[7, 30, 90].map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={`px-3 py-1.5 ${days === n ? 'bg-blue-800 text-white' : 'bg-white text-slate-800 hover:bg-slate-100'}`}>{n} days</button>)}
        </div>
        <div className="text-fs-14 font-bold text-slate-900">
          Target: {tc ? <span className="font-mono">{tc.toFixed(1)} s · {nf(pphOf(tc), 0)} pcs/hr</span> : <span className="text-slate-700">not set</span>}
          {onEditTarget && <button type="button" onClick={() => onEditTarget(model)} className="ml-2 rounded-md border border-blue-600 px-2 py-0.5 text-fs-13 font-extrabold text-blue-700 hover:bg-blue-50">{tc ? 'Change' : 'Set target'}</button>}
        </div>
        {loading && <span className="text-fs-13 font-bold text-slate-700">Loading…</span>}
      </div>
      {err && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}

      {hist.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Kpi label={`Produced (${hist.length} days)`} value={nf(tot.qty)} sub={`${nf(tot.hrs, 1)} active hours`} />
            <Kpi label="Avg pcs / active hour" value={nf(tot.hrs ? tot.qty / tot.hrs : null, 1)} sub={tc ? `target ${nf(pphOf(tc), 0)}` : 'no target'} />
            <Kpi label="Avg cycle" value={sec(avgC)} sub={tc ? `target ${tc.toFixed(1)} s` : 'no target'} tone={cycTone(avgC != null && tc ? avgC - tc : null, tc)} />
            <Kpi label="Cycle vs target" value={avgC != null && tc ? `${signed(avgC - tc, 1)} s` : '—'} sub={avgC != null && tc ? `${nf((avgC / tc) * 100, 0)} % of target (lower is faster)` : ''} tone={cycTone(avgC != null && tc ? avgC - tc : null, tc)} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-2">
            <div className="text-fs-13 font-extrabold text-slate-900 mb-1">Average cycle per day{tc ? ' — dashed line = target' : ''}</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chart} margin={{ top: 8, right: 10, left: 0, bottom: 0 }} onClick={(s) => s?.activePayload?.[0] && setPick(s.activePayload[0].payload.date)} style={{ cursor: 'pointer' }}>
                <CartesianGrid stroke="#CBD5E1" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={tick} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                <YAxis tick={tick} tickLine={false} axisLine={false} width={40} unit="s" />
                <Tooltip formatter={(v, n) => [n === 'cycle' ? `${Number(v).toFixed(1)} s` : v, n === 'cycle' ? 'Avg cycle' : n]} labelFormatter={(l, p) => p?.[0]?.payload?.date || l} />
                {tc && <ReferenceLine y={tc} stroke="#0F172A" strokeDasharray="6 4" strokeWidth={2} label={{ value: `target ${tc.toFixed(1)} s`, position: 'insideTopRight', fill: '#0F172A', fontSize: fs(12), fontWeight: 700 }} />}
                <Bar dataKey="cycle" name="cycle" isAnimationActive={false}>
                  {chart.map((r) => <Cell key={r.date} fill={r.date === pick ? '#0F172A' : BAR[r.status ?? 'null']} />)}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto max-h-[360px]">
            <table className="w-full text-fs-13">
              <thead className="sticky top-0 bg-slate-50 z-10"><tr className="text-left text-slate-700 uppercase tracking-wide border-b-2 border-slate-300">
                {['Day', 'Qty', 'Active hrs', 'Pcs / hr', 'Target pcs / hr', 'Diff / hr', 'Avg cycle', 'Target cycle', 'Δ cycle', 'Status'].map((h) => <th key={h} className="px-2 py-2 font-extrabold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {hist.map((r) => (
                  <tr key={r.date} onClick={() => setPick(r.date === pick ? null : r.date)} className={`border-b border-slate-200 font-mono cursor-pointer text-slate-900 ${r.date === pick ? 'bg-sky-100' : 'hover:bg-slate-50'}`} title="Click for this day by hour">
                    <td className="px-2 py-1.5 font-bold whitespace-nowrap">{r.date}</td>
                    <td className="px-2 font-extrabold">{nf(r.qty)}</td><td className="px-2">{nf(r.activeHours, 1)}</td>
                    <td className="px-2 font-bold">{nf(r.pph, 1)}</td><td className="px-2">{nf(r.targetPph, 0)}</td>
                    <td className={`px-2 font-bold ${r.pphDiff == null ? '' : r.pphDiff >= 0 ? 'text-sky-700' : 'text-red-700'}`}>{r.pphDiff != null ? signed(r.pphDiff, 1) : ''}</td>
                    <td className="px-2">{sec(r.cycle)}</td><td className="px-2">{r.targetCycle ? `${r.targetCycle.toFixed(1)} s` : '—'}</td>
                    <td className={`px-2 font-bold ${cycTone(r.cycleDiff, r.targetCycle)}`}>{r.cycleDiff != null ? `${signed(r.cycleDiff, 1)} s` : ''}</td>
                    <td className={`px-2 font-sans font-bold ${TONE[r.status ?? 'null']}`}>{r.status ? LABEL[r.status] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pick && (
            <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-fs-14 font-extrabold text-slate-950">{model?.model} on {pick} — by hour</div>
                <button type="button" onClick={() => setPick(null)} className="text-fs-13 font-bold text-blue-700 hover:underline">Close</button>
              </div>
              {!hours ? <div className="text-fs-13 font-semibold text-slate-700 py-2">Loading…</div> : !hours.length ? <div className="text-fs-13 font-semibold text-slate-700 py-2">No production of this model on that day.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-fs-13 bg-white rounded-lg">
                    <thead><tr className="text-left text-slate-700 uppercase tracking-wide border-b-2 border-slate-300">
                      {['Hour', 'Qty', 'Avg cycle', 'Target cycle', 'Δ cycle', 'Pcs/hr at this cycle', 'Target pcs/hr'].map((h) => <th key={h} className="px-2 py-1.5 font-extrabold whitespace-nowrap">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {hours.map((h) => {
                        const c = h.avgActualCycleSeconds; const dlt = c != null && tc ? c - tc : null;
                        return (
                          <tr key={h.hour} className="border-b border-slate-200 font-mono text-slate-900">
                            <td className="px-2 py-1 font-bold">{h.label}</td><td className="px-2 font-extrabold">{h.quantity}</td>
                            <td className="px-2">{sec(c)}</td><td className="px-2">{tc ? `${tc.toFixed(1)} s` : '—'}</td>
                            <td className={`px-2 font-bold ${cycTone(dlt, tc)}`}>{dlt != null ? `${signed(dlt, 1)} s` : ''}</td>
                            <td className="px-2">{c ? nf(3600 / c, 0) : '—'}</td><td className="px-2">{tc ? nf(pphOf(tc), 0) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {!loading && rows && !hist.length && <div className="rounded-lg bg-slate-100 px-3 py-6 text-center text-fs-14 font-semibold text-slate-800">No production of this model in the last {days} days.</div>}
    </div>
  );
}

/**
 * Running model vs its target for the focus day: segments around lunch, hour by hour, and the model's history.
 * running = { mmId, model, company } (model of the last production hour); settings = useLineSettings(line).
 */
export default function TargetBoard({ hours, focusDate, latestDate, isToday, running, models, settings, filters, onOpenSettings, lunchByHour = null, line = null }) {
  const [tab, setTab] = useState('hours');
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => { if (!isToday) return undefined; const id = setInterval(() => setNow(serverNow()), 30_000); return () => clearInterval(id); }, [isToday]);
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 : null;
  const { shift, targets } = settings;
  const tc = targetOf(targets, running?.mmId);
  const day = useMemo(() => buildTargetDay({ hours, shift, targets, nowMin, fallbackCycle: tc, lunchByHour }), [hours, shift, targets, nowMin, tc, lunchByHour]);
  // model-wise actual cycle of the day from each model's own scans (refreshed with the hour table)
  const cap = currentRule().cap;
  const [actual, setActual] = useState(null);
  const hourKey = (hours || []).map((h) => h.quantity).join(',');
  useEffect(() => {
    if (!line || !focusDate) return undefined;
    let alive = true;
    api.controlData(focusDate, focusDate, null, {}, line).then((j) => { if (alive) setActual(modelActualCycles(j?.models, focusDate, cap)); }).catch(() => {});
    return () => { alive = false; };
  }, [line, focusDate, cap, hourKey]);
  const cur = day.rows.find((r) => r.running) || [...day.rows].reverse().find((r) => r.qty > 0) || null;
  const need = requiredRate(day.total);
  const company = running?.company || models.find((m) => String(m.mmId) === String(running?.mmId))?.companyTitle;
  const noTarget = models.filter((m) => day.rows.some((r) => r.models.some((x) => String(x.mmId) === String(m.mmId) && !x.target)));
  const workLeft = isToday ? Math.round(day.total.remainingSec / 60) : 0;

  return (
    <section className="rounded-2xl border border-slate-300 bg-white shadow-md shadow-slate-300/40 p-3 sm:p-4" aria-label="Running model vs target">
      {/* heading: running model + target */}
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-fs-13 font-extrabold uppercase tracking-wide text-slate-700"><Target size={15} aria-hidden /> {isToday ? 'Running model vs target' : `Model vs target · ${fmtDate(focusDate)}`}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            {company && <span className="rounded-md bg-slate-100 border border-slate-300 px-2 py-0.5 text-fs-16 font-extrabold text-slate-900">{company}</span>}
            <span className="font-mono text-fs-24 font-extrabold text-slate-950 break-words">{running?.model || 'No production yet'}</span>
          </div>
          <div className="mt-1 text-fs-14 font-bold text-slate-800">
            {tc ? <>Target <span className="font-mono">{nf(pphOf(tc), 0)} pcs/hr</span> · <span className="font-mono">{tc.toFixed(1)} s</span> per piece</>
              : running ? <span className="text-slate-800">No target set for this model</span> : null}
            {running?.currentCycle != null && (
              <span className="ml-2">· Now <span className={`font-mono ${cycTone(tc ? running.currentCycle - tc : null, tc)}`}>{running.currentCycle.toFixed(1)} s</span> per piece
                {tc ? <span className={cycTone(running.currentCycle - tc, tc)}> ({signed(running.currentCycle - tc, 1)} s vs target)</span> : null}
                <span className="font-semibold text-slate-700"> · last 20 pcs</span></span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-fs-13 font-semibold text-slate-700"><Clock size={13} aria-hidden /> Shift {shiftText(shift)}</div>
        </div>
        {onOpenSettings && <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenSettings('targets', running)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-fs-14 font-extrabold text-white hover:bg-blue-800">
            <Target size={15} aria-hidden /> {tc ? 'Model targets' : 'Set target'}
          </button>
          <button type="button" onClick={() => onOpenSettings('shift')} className="inline-flex items-center gap-1.5 rounded-lg border-2 border-slate-400 bg-white px-3 py-2 text-fs-14 font-extrabold text-slate-900 hover:bg-slate-50">
            <Settings2 size={15} aria-hidden /> Shift &amp; lunch
          </button>
        </div>}
      </div>

      {/* numbers */}
      <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Kpi hint={`Pieces made in this hour (lunch scans not counted). Target = working seconds of the hour so far ÷ target cycle${cur?.targetCycle ? ` ${cur.targetCycle.toFixed(1)} s` : ''}; it rises through the hour.`} label={cur ? `This hour ${cur.label}` : 'This hour'} value={cur ? nf(cur.qty) : '—'} status={cur?.status === 'future' ? null : cur?.status}
          tone={TONE[cur?.status ?? 'null']} sub={cur?.plan != null ? `target ${nf(cur.plan)}${cur.running ? ' till now' : ''} · ${signed(cur.diff)}` : 'no target'} />
        <Kpi hint="Pieces made today against the target of the working time so far (shift minus lunch, hour by hour, each hour at the target cycle of its models). Pieces of a model without a target are not counted against it." label={isToday ? 'Today so far' : 'Day total'} value={nf(day.total.qty)} status={day.total.status} tone={TONE[day.total.status ?? 'null']}
          sub={day.total.plan != null ? `target ${nf(day.total.plan)} · ${signed(day.total.diff)} (${nf(day.total.pct)} %)${day.total.noTgtQty > 0 ? ` · ${nf(day.total.noTgtQty)} no target` : ''}` : 'no target'} />
        <Kpi hint="Target for the whole shift: every working second of the day (lunch left out) ÷ target cycle. Need = pcs/hr still required in the time left to reach it." label="Day target (full shift)" value={nf(day.total.planFull)} sub={isToday ? (need != null ? `need ${nf(need, 0)} pcs/hr for the remaining ${Math.floor(workLeft / 60)} h ${workLeft % 60} min` : '') : day.total.planFull != null ? `achieved ${nf(((day.total.tgtQty ?? day.total.qty) / day.total.planFull) * 100)} %` : ''} />
        <Kpi hint="Average gap between two pieces in this hour while the line runs (long stops left out), against the target cycle of the running model." label="Running cycle this hour" value={sec(cur?.cycle)} tone={cycTone(cur?.cycleDiff, cur?.targetCycle)}
          sub={cur?.targetCycle ? `target ${cur.targetCycle.toFixed(1)} s · ${cur.cycleDiff != null ? `${signed(cur.cycleDiff, 1)} s` : ''}` : 'no target'} />
        <Kpi hint="Pieces short of the target so far today. Minutes = those pieces × target cycle: the production time lost." label="Short of target (pcs)" value={day.total.diff != null && day.total.diff < 0 ? nf(-day.total.diff) : day.total.diff != null ? '0' : '—'}
          tone={day.total.diff != null && day.total.diff < 0 ? 'text-red-700' : 'text-sky-700'}
          sub={day.total.diff != null && day.total.diff < 0 && tc ? `≈ ${Math.round((-day.total.diff * tc) / 60)} min at target cycle` : day.total.diff != null ? 'on or above target' : ''} />
      </div>

      {/* segments */}
      <div className="mt-2 grid gap-2 grid-cols-1 sm:grid-cols-[1fr_auto_1fr]">
        {day.parts.map((p) => <Part key={p.key} p={p} isToday={isToday} />)}
      </div>

      {noTarget.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-400 bg-slate-50 px-3 py-2 text-fs-13 font-bold text-slate-900">
          {noTarget.length} model{noTarget.length > 1 ? 's' : ''} without a target today: {noTarget.slice(0, 6).map((m) => m.model).join(', ')}{noTarget.length > 6 ? ' …' : ''}.{' '}
          {onOpenSettings && <button type="button" onClick={() => onOpenSettings('targets')} className="underline">Set targets</button>}
        </div>
      )}

      {/* tabs */}
      <div className="mt-3 flex gap-1 border-b-2 border-slate-200" role="tablist">
        {[['hours', 'Hour by hour', Clock], ['history', 'Model history (day & hour)', History]].map(([k, l, I]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 -mb-[2px] border-b-2 text-fs-14 font-extrabold ${tab === k ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-700 hover:text-slate-950'}`}>
            <I size={14} aria-hidden /> {l}
          </button>
        ))}
      </div>
      <div className="pt-2">
        {tab === 'hours' && <HourTable day={day} shift={shift} actual={actual} cap={cap} />}
        {tab === 'history' && (
          <ModelHistory models={models} targets={targets} running={running} filters={filters} latestDate={latestDate}
            onEditTarget={onOpenSettings ? (m) => onOpenSettings('targets', m ? { mmId: m.mmId, model: m.model, company: m.companyTitle } : null) : null} />
        )}
      </div>
    </section>
  );
}

