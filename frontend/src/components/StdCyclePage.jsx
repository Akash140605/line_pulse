import { fs } from '../theme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from 'recharts';
import { api } from '../api';
import { Card, Stat, Segmented, Empty } from './UiKit';
import { windowStd, continuousRuns, runStd } from '../utils/stdCycle';
import { weightOf } from '../config/modelWeights';
import { periodStart } from '../utils/period';
import StdModelList from './StdModelList';

const PERIODS = [[1, '1 month'], [2, '2 months'], [3, '3 months'], [6, '6 months']];
const DEFAULT_PERIOD = 2;
const LS_KG = 'ems.stdcycle.kg';
const LIVE_SEC = 60;          // background refresh interval while the page is visible
const CACHE_MAX = 12;         // recently viewed model / period results kept in memory
const cache = new Map();      // key → { a, b, at } ; shown instantly when the same selection is opened again

const CSS = `
@keyframes scUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes scBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes scPop{0%{transform:scale(.96);opacity:.4}60%{transform:scale(1.02);opacity:1}100%{transform:scale(1)}}
.sc-up{animation:scUp .5s cubic-bezier(.2,.7,.2,1) both}
.sc-bar{transform-origin:left center;animation:scBar .9s cubic-bezier(.2,.7,.2,1) both}
.sc-pop{animation:scPop .45s ease-out both}
.sc-hover{transition:transform .2s ease, box-shadow .2s ease}
.sc-hover:hover{transform:translateY(-2px);box-shadow:0 14px 30px -12px rgba(15,23,42,.25)}
@media (prefers-reduced-motion:reduce){.sc-up,.sc-bar,.sc-pop{animation:none}.sc-hover{transition:none}}
`;

const f1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const int = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString());
const shortDate = (s) => { const d = new Date(`${s}T00:00:00`); return isNaN(d) ? s : d.toLocaleDateString([], { day: '2-digit', month: 'short' }); };

function readKg() { try { return JSON.parse(localStorage.getItem(LS_KG) || '{}'); } catch { return {}; } }
function writeKg(o) { try { localStorage.setItem(LS_KG, JSON.stringify(o)); } catch { /* storage unavailable */ } }

/** Animates a number from 0 to the target. Jumps directly when reduced motion is requested. */
function useCountUp(target, dur = 800) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) { setV(null); return undefined; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); return undefined; }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

export default function StdCyclePage({ models = [], latestDate, mmId: mmProp = '', companyId: companyProp = null }) {
  const [months, setMonths] = useState(DEFAULT_PERIOD);
  const [mmId, setMmId] = useState(String(mmProp || ''));
  const [minSec, setMinSec] = useState(1);
  const [maxSec, setMaxSec] = useState(22);
  const [minPieces, setMinPieces] = useState(200);
  const [maxRework, setMaxRework] = useState(3);
  const [breakSec, setBreakSec] = useState(300);
  const [kgMap, setKgMap] = useState(readKg);
  const [controlRes, setControlRes] = useState(null);
  const [runsRes, setRunsRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Follow the model chosen in the page filter; otherwise default to the first model.
  useEffect(() => { if (mmProp !== '' && mmProp != null) setMmId(String(mmProp)); }, [mmProp]);
  useEffect(() => { if (!mmId && models.length) setMmId(String(models[0].mmId)); }, [models, mmId]);

  const model = models.find((m) => String(m.mmId) === String(mmId)) || null;
  const companyId = model?.companyId ?? companyProp ?? null;
  const start = latestDate ? periodStart(latestDate, months) : '';
  const end = latestDate || '';

  // Data is requested only when the model or the period changes, and refreshed in the background while Live is on.
  // Threshold changes never call the server.
  const [live, setLive] = useState(true);
  const [updated, setUpdated] = useState(null);
  const reqRef = useRef(null);
  const key = `${mmId}|${start}|${end}|${companyId ?? ''}`;

  const load = useCallback((showSpinner) => {
    if (!mmId || !start || !end) return;
    reqRef.current?.abort();
    const c = new AbortController();
    reqRef.current = c;
    if (showSpinner) setLoading(true);
    setError('');
    Promise.all([
      api.controlData(start, end, companyId, { signal: c.signal }),
      api.modelRuns(start, end, mmId, { signal: c.signal }),
    ])
      .then(([a, b]) => {
        const at = new Date();
        cache.delete(key);
        cache.set(key, { a, b, at });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        setControlRes(a); setRunsRes(b); setUpdated(at);
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(String(e.message || e)); })
      .finally(() => { if (!c.signal.aborted) setLoading(false); });
  }, [mmId, start, end, companyId, key]);

  useEffect(() => {
    const hit = cache.get(key);
    if (hit) { setControlRes(hit.a); setRunsRes(hit.b); setUpdated(hit.at); }
    load(!hit);
    return () => reqRef.current?.abort();
  }, [key, load]);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => { if (!document.hidden) load(false); }, LIVE_SEC * 1000);
    return () => clearInterval(id);
  }, [live, load]);

  const days = useMemo(() => {
    const m = controlRes?.models?.find((x) => String(x.mmId) === String(mmId));
    return m?.days || {};
  }, [controlRes, mmId]);

  // Method A: window average (recalculates instantly when Min / Max change)
  const A = useMemo(() => windowStd(days, { min: minSec, max: maxSec }), [days, minSec, maxSec]);
  // Method B: continuous runs (recalculates instantly when any run setting changes)
  const runs = useMemo(() => continuousRuns(runsRes?.rows || [], { minPieces, maxRework, breakSec, minGap: minSec, maxGap: maxSec }),
    [runsRes, minPieces, maxRework, breakSec, minSec, maxSec]);
  const S = useMemo(() => runStd(runs), [runs]);
  const shortRuns = S.totalRuns - S.validRuns;

  const autoKg = model ? weightOf(model) : null;
  const kg = kgMap[mmId] ?? autoKg;
  const setKgFor = (id, v) => {
    const next = { ...kgMap };
    const n = Number(v);
    if (v === '' || v == null || !Number.isFinite(n) || n <= 0) delete next[id]; else next[id] = n;
    setKgMap(next); writeKg(next);
  };
  const setKgOverride = (v) => setKgFor(mmId, v);

  const aMean = useCountUp(A.mean);
  const bClean = useCountUp(S.clean);
  const diffPct = A.mean && S.clean ? ((S.clean - A.mean) / A.mean) * 100 : null;
  const barMax = Math.max(A.mean || 0, S.clean || 0, 1) * 1.15;
  const modelLabel = model ? `${model.model}${model.modelCode ? ` (${model.modelCode})` : ''}` : '—';
  const noData = !loading && !error && A.n === 0 && (runsRes?.count ?? 0) === 0;
  // Model with the most gap records in the period (used to suggest a switch when the selected model has no data).
  const bestModel = useMemo(() => {
    let best = null, bestN = 0;
    for (const m of controlRes?.models || []) {
      const n = Object.values(m.days || {}).reduce((s, d) => s + (d.g?.length || 0), 0);
      if (n > bestN) { bestN = n; best = { mmId: m.mmId, model: m.model, modelCode: m.modelCode, n }; }
    }
    return best;
  }, [controlRes]);
  const periodLabel = PERIODS.find((p) => p[0] === months)?.[1] ?? '';

  const sortedModels = useMemo(() => [...models].sort((x, y) => String(x.model).localeCompare(String(y.model))), [models]);

  return (
    <div className="flex flex-col gap-3">
      <style>{CSS}</style>

      {/* ── Settings ── */}
      <Card className="sc-up" title="Standard cycle time"
        sub={`Period: ${start || '—'} to ${end || '—'} (${periodLabel})`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fs-12 font-semibold text-slate-600 tabular-nums">
              {loading ? <span className="text-blue-700 animate-pulse">Loading data…</span>
                : updated ? `Updated ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
            </span>
            <button type="button" onClick={() => setLive((v) => !v)} aria-pressed={live}
              className={`h-8 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-fs-12 font-extrabold border ${live ? 'border-sky-500 text-sky-700 bg-sky-50' : 'border-slate-300 text-slate-600 bg-white'}`}>
              <span className={`h-2 w-2 rounded-full ${live ? 'bg-sky-500 animate-pulse' : 'bg-slate-400'}`} />
              {live ? `Live · ${LIVE_SEC}s` : 'Live off'}
            </button>
          </div>
        }>
        <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-3 items-end">
          <label className="md:col-span-3 lg:col-span-5 flex flex-col gap-1">
            <span className="text-fs-12 font-bold text-slate-600">Model</span>
            <select value={mmId} onChange={(e) => setMmId(e.target.value)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-14 font-semibold text-slate-900 focus:outline-2 focus:outline-blue-600">
              {sortedModels.map((m) => {
                const k = kgMap[String(m.mmId)] ?? weightOf(m);
                return <option key={m.mmId} value={String(m.mmId)}>{m.model}{m.modelCode ? ` (${m.modelCode})` : ''}{k ? ` · ${k} kg` : ''}</option>;
              })}
            </select>
          </label>

          <div className="md:col-span-3 lg:col-span-3 flex flex-col gap-1">
            <span className="text-fs-12 font-bold text-slate-600">Weight (kg)</span>
            <div className="flex items-center gap-2">
              <span key={String(kg)} className={`sc-pop inline-flex items-center h-10 min-w-[84px] justify-center rounded-lg px-3 font-mono font-extrabold text-fs-16 tabular-nums ${kg ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {kg ? `${kg} kg` : 'Not set'}
              </span>
              <input type="number" step="0.5" min="0" aria-label="Weight override in kg" value={kgMap[mmId] ?? ''}
                placeholder={autoKg ? 'Auto' : 'Enter kg'} onChange={(e) => setKgOverride(e.target.value)}
                className="h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-fs-14 font-semibold focus:outline-2 focus:outline-blue-600" />
            </div>
          </div>

          <div className="md:col-span-6 lg:col-span-4 flex flex-col gap-1">
            <span className="text-fs-12 font-bold text-slate-600">Time duration</span>
            <Segmented value={months} onChange={setMonths} options={PERIODS.map(([k, l]) => [k, l])} />
          </div>

          <NumField label="Minimum cycle (s)" value={minSec} step={0.5} onChange={setMinSec} />
          <NumField label="Maximum cycle (s)" value={maxSec} step={1} onChange={setMaxSec} />
          <NumField label="Minimum pieces per run" value={minPieces} step={10} onChange={setMinPieces} />
          <NumField label="Rework pieces allowed" value={maxRework} step={1} onChange={setMaxRework} />
          <NumField label="Stop threshold (s)" value={breakSec} step={30} onChange={setBreakSec} />
        </div>
        
      </Card>

      {minSec > maxSec && <div role="alert" className="bg-slate-50 border-2 border-slate-200 text-slate-800 rounded-xl px-3 py-2.5 text-fs-14 font-semibold">Minimum cycle ({minSec} s) is greater than maximum cycle ({maxSec} s). No gap can fall in this window; please correct the values.</div>}
      {error && <div role="alert" className="bg-red-50 border-2 border-red-200 text-red-800 rounded-xl px-3 py-2.5 text-fs-14 font-semibold break-all">{error}</div>}
      {noData && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="text-fs-16 font-bold text-slate-800">No scans found for this model in the selected period.</div>
            {bestModel && (
              <>
                <div className="text-fs-13 font-semibold text-slate-600">The model with the most data in this period is {bestModel.model}{bestModel.modelCode ? ` (${bestModel.modelCode})` : ''}.</div>
                <button type="button" onClick={() => setMmId(String(bestModel.mmId))}
                  className="h-9 rounded-lg bg-blue-600 px-4 text-fs-13 font-extrabold text-white hover:bg-blue-700">Show {bestModel.model}</button>
              </>
            )}
          </div>
        </Card>
      )}

      {/* ── Method A and Method B ── */}
      {!noData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="sc-up sc-hover" style={{ animationDelay: '60ms' }}>
            <Card title="Method A — Window average" sub={`All scan gaps between ${minSec} s and ${maxSec} s`}
              formula={`standard cycle = Σ gaps in [${minSec} s, ${maxSec} s] ÷ count · gaps outside this range are excluded`}>
              <div className="rounded-xl bg-gradient-to-br from-sky-50 to-white border border-sky-200 px-4 py-4">
                <div className="text-fs-12 uppercase tracking-wide font-extrabold text-sky-700">Standard cycle time</div>
                <div className="font-mono tabular-nums text-fs-40 leading-none font-extrabold text-sky-800 mt-1">
                  {aMean == null ? '—' : aMean.toFixed(1)}<span className="text-fs-20 font-bold text-slate-600"> s</span>
                </div>
                <div className="text-fs-13 font-semibold text-slate-600 mt-1">{int(A.n)} valid cycles · median {f1(A.median)} s · standard deviation {f1(A.sd)} s</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <Stat label="Valid" value={int(A.n)} sub="gaps in range" bar="bg-sky-500" />
                <Stat label="Median" value={`${f1(A.median)} s`} sub="50th percentile" bar="bg-sky-500" />
                <Stat label="Below minimum" value={int(A.below)} sub={`under ${minSec} s`} bar="bg-slate-400" />
                <Stat label="Above maximum" value={int(A.above)} sub={`over ${maxSec} s`} bar="bg-red-500" />
              </div>
            </Card>
          </div>

          <div className="sc-up sc-hover" style={{ animationDelay: '140ms' }}>
            <Card title="Method B — Continuous run" sub={`Runs of at least ${minPieces} pieces; up to ${maxRework} rework pieces ignored per run`}
              formula={`cycle = Σ gaps with no rework and within [${minSec} s, ${maxSec} s] ÷ count · a run is valid when pieces ≥ ${minPieces} · a run ends at a gap above ${breakSec} s or at more than ${maxRework} rework pieces`}>
              <div className="rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-200 px-4 py-4">
                <div className="text-fs-12 uppercase tracking-wide font-extrabold text-blue-700">Standard cycle time · rework excluded</div>
                <div className="font-mono tabular-nums text-fs-40 leading-none font-extrabold text-blue-800 mt-1">
                  {bClean == null ? '—' : bClean.toFixed(1)}<span className="text-fs-20 font-bold text-slate-600"> s</span>
                </div>
                <div className="text-fs-13 font-semibold text-slate-600 mt-1">
                  {int(S.validRuns)} valid of {int(S.totalRuns)} runs · {int(S.pieces)} pieces · including rework time: {f1(S.incl)} s
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <Stat label="Valid runs" value={int(S.validRuns)} sub={`≥ ${minPieces} pieces`} bar="bg-blue-500" />
                <Stat label="Qty" value={int(S.pieces)} sub="in valid runs" bar="bg-blue-500" />
                <Stat label="Rework excluded" value={int(S.rework)} sub="other-model pieces" bar="bg-slate-500" />
                <Stat label="Median run" value={`${f1(S.medianRun)} s`} sub="per-run cycle" bar="bg-sky-500" />
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Comparison ── */}
      {!noData && (
        <Card className="sc-up" title="Comparison of Method A and Method B">
          <div className="flex flex-col gap-2.5">
            <Bar2 label="Method A — Window average" value={A.mean} max={barMax} color="bg-sky-500" />
            <Bar2 label="Method B — Continuous run (rework excluded)" value={S.clean} max={barMax} color="bg-blue-500" />
          </div>
          <div className={`mt-3 rounded-lg px-3 py-2 text-fs-14 font-bold sc-pop ${diffPct == null ? 'bg-slate-100 text-slate-600' : Math.abs(diffPct) < 3 ? 'bg-sky-50 text-sky-800' : diffPct > 0 ? 'bg-slate-50 text-slate-800' : 'bg-sky-50 text-sky-800'}`}>
            {diffPct == null ? 'Insufficient data to compare both methods.'
              : `Method B is ${Math.abs(diffPct).toFixed(1)}% ${diffPct > 0 ? 'higher' : 'lower'} than Method A${Math.abs(diffPct) < 3 ? '. The two methods agree closely.' : '.'}`}
          </div>
        </Card>
      )}

      {/* ── Details ── */}
      {!noData && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
          <div className="xl:col-span-6 sc-up" style={{ animationDelay: '260ms' }}>
            <Card title="Method A — Daily average" sub="Mean of the valid gaps for each day" formula="daily mean = Σ valid gaps of the day ÷ count · reference line = standard cycle time (Method A)">
              {A.daily.length ? (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={A.daily.map((r) => ({ d: shortDate(r.date), mean: Number(r.mean.toFixed(2)), n: r.n }))} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="d" tick={{ fontSize: fs(11), fill: '#334155', fontWeight: 600 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: fs(11), fill: '#334155' }} unit=" s" width={48} />
                      <Tooltip formatter={(v, n, p) => [`${v} s (${p.payload.n} cycles)`, 'Daily mean']} />
                      {A.mean != null && <ReferenceLine y={A.mean} stroke="#0F766E" strokeDasharray="6 4" strokeWidth={2} label={{ value: `Standard ${A.mean.toFixed(1)} s`, position: 'insideTopRight', fill: '#0F766E', fontSize: fs(12), fontWeight: 700 }} />}
                      <Bar dataKey="mean" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900}>
                        {A.daily.map((r) => <Cell key={r.date} fill={A.mean && r.mean > A.mean * 1.1 ? '#F59E0B' : '#14B8A6'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty>No valid gaps in this range.</Empty>}
            </Card>
          </div>

          <div className="xl:col-span-6 sc-up" style={{ animationDelay: '320ms' }}>
            <Card title="Method B — Runs"
              sub={`${int(S.totalRuns)} runs found; ${int(shortRuns)} shorter than ${minPieces} pieces are excluded from the standard`}
              formula="rework = other-model pieces between two pieces of this model (excluded from the cycle) · clean cycle = gaps without rework ÷ count">
              {runs.length ? (
                <div className="max-h-[300px] overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full text-fs-13 tabular-nums">
                    <caption className="sr-only">Continuous runs for the selected model</caption>
                    <thead className="sticky top-0 bg-slate-100 text-slate-600">
                      <tr>{['#', 'Date', 'Start', 'Qty', 'Rework', 'Clean cycle', 'Incl. rework', 'Status'].map((h) => <th key={h} scope="col" className="px-2 py-1.5 text-left font-extrabold whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {runs.map((r, i) => (
                        <tr key={i} className={`border-t border-slate-100 ${r.valid ? 'bg-white' : 'bg-slate-50 text-slate-600'}`}>
                          <td className="px-2 py-1 font-mono">{i + 1}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{shortDate(r.date)}</td>
                          <td className="px-2 py-1 font-mono">{String(r.startHour).padStart(2, '0')}:00</td>
                          <td className="px-2 py-1 font-semibold">{int(r.pieces)}</td>
                          <td className="px-2 py-1">{int(r.rework)}</td>
                          <td className="px-2 py-1 font-semibold">{f1(r.clean)} s</td>
                          <td className="px-2 py-1">{f1(r.incl)} s</td>
                          <td className="px-2 py-1">{r.valid ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-fs-12 font-extrabold text-blue-700">Valid</span> : <span className="text-fs-12 font-semibold">Excluded</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>No runs found in this period.</Empty>}
            </Card>
          </div>
        </div>
      )}

      {/* ── All models: table, chart, Excel and print ── */}
      <StdModelList models={models} start={start} end={end} kgMap={kgMap} onKgChange={setKgFor}
        settings={{ minSec, maxSec, minPieces, maxRework, breakSec }} />
    </div>
  );
}

/** Labelled number input. The label wraps instead of truncating, so every field name stays readable. */
function NumField({ label, value, step, onChange }) {
  return (
    <label className="md:col-span-3 lg:col-span-2 flex flex-col gap-1 min-w-0">
      <span className="text-fs-12 font-bold text-slate-600 leading-snug">{label}</span>
      <input type="number" min="0" step={step} value={value}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) onChange(v); }}
        className="h-10 w-full rounded-lg border border-slate-300 px-2 text-fs-14 font-semibold tabular-nums focus:outline-2 focus:outline-blue-600" />
    </label>
  );
}

function Bar2({ label, value, max, color }) {
  const pct = value && max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-fs-13 font-bold text-slate-700">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-slate-900">{value == null ? '—' : `${value.toFixed(1)} s`}</span>
      </div>
      <div className="mt-1 h-3.5 rounded-full bg-slate-100 overflow-hidden">
        <div key={pct.toFixed(1)} className={`sc-bar h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
