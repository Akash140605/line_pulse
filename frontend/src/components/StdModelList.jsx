import { fs } from '../theme';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from 'recharts';
import { api, getLine, LINES } from '../api';
import { exportReportXlsx, printReport } from '../utils/stdReport';
import { Card, Empty } from './UiKit';
import { windowStd, continuousRuns, runStd } from '../utils/stdCycle';
import { weightInfo } from '../config/modelWeights';
import useMediaQuery from '../hooks/useMediaQuery';
import { serverNow } from '../utils/serverTime';

// Where a weight came from (shown next to the value and in the Excel export).
const KG_SOURCE = {
  manual: ['manual', 'Entered on this page (saved in this browser)', 'bg-blue-100 text-blue-800'],
  name: ['list', 'Written in the master-list item name', 'bg-sky-100 text-sky-800'],
  user: ['confirmed', 'Confirmed by the production team', 'bg-sky-100 text-sky-800'],
  code: ['from code', 'Read from the capacity digits of the model code, checked against the tub type', 'bg-slate-100 text-slate-800'],
  series: ['series', 'Samsung series rule (WT85 = 8.5 kg)', 'bg-slate-100 text-slate-800'],
};

const CONCURRENCY = 3;
const CHART_ROWS = 25;

const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const f1 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
const int = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString());

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #std-model-list, #std-model-list * { visibility: visible !important; }
  #std-model-list { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
  .no-print { display: none !important; }
}
`;

const COLUMNS = [
  ['model', 'Model', 'text'],
  ['kg', 'Weight (kg)', 'num'],
  ['n', 'Valid cycles', 'num'],
  ['aStd', 'Standard A (s)', 'num'],
  ['aMed', 'Median A (s)', 'num'],
  ['aSd', 'Std dev A (s)', 'num'],
  ['bStd', 'Standard B (s)', 'num'],
  ['bRuns', 'Valid runs B', 'num'],
  ['diff', 'B vs A (%)', 'num'],
];

/**
 * All models in one list for the selected period.
 * Method A is computed from one model_control request (all companies).
 * Method B needs one model_runs request per model, so it is computed on demand with a progress indicator.
 * Changing any threshold recalculates both methods instantly.
 */
export default function StdModelList({ models, start, end, kgMap, settings, onKgChange }) {
  const narrow = useMediaQuery('(max-width: 640px)'); // phones: shorter model names on the chart axis
  const { minSec, maxSec, minPieces, maxRework, breakSec } = settings;
  const [control, setControl] = useState(null);
  const [runsByModel, setRunsByModel] = useState({});
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('aStd');
  const [sortDir, setSortDir] = useState(-1);
  const runToken = useRef(0);

  // New period: reset everything and load Method A data.
  useEffect(() => {
    if (!start || !end) return undefined;
    const c = new AbortController();
    runToken.current++;
    setControl(null); setRunsByModel({}); setProgress(null); setError(''); setLoading(true);
    api.controlData(start, end, null, { signal: c.signal })
      .then((j) => { if (!j?.models) throw new Error(j?.error || 'No data returned'); setControl(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(String(e.message || e)); })
      .finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [start, end]);

  const computeMethodB = async () => {
    const token = ++runToken.current;
    const list = models;
    const total = list.length;
    const out = {};
    let next = 0, done = 0, failed = 0;
    setProgress({ done: 0, total, failed: 0, running: true });
    const worker = async () => {
      while (next < total) {
        const m = list[next++];
        try {
          const r = await api.modelRuns(start, end, m.mmId);
          if (r?.rows) out[m.mmId] = r.rows; else { out[m.mmId] = []; failed++; }
        } catch { out[m.mmId] = []; failed++; }
        done++;
        if (token === runToken.current) setProgress({ done, total, failed, running: done < total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    if (token === runToken.current) { setRunsByModel(out); setProgress({ done: total, total, failed, running: false }); }
  };

  const daysById = useMemo(() => {
    const map = {};
    for (const m of control?.models || []) map[String(m.mmId)] = m.days || {};
    return map;
  }, [control]);

  const rows = useMemo(() => models.map((m) => {
    const id = String(m.mmId);
    const A = windowStd(daysById[id] || {}, { min: minSec, max: maxSec });
    const rr = runsByModel[m.mmId];
    const B = rr ? runStd(continuousRuns(rr, { minPieces, maxRework, breakSec, minGap: minSec, maxGap: maxSec })) : null;
    const bStd = B ? B.clean : null;
    const w = weightInfo(m, kgMap?.[id]);
    return {
      mmId: m.mmId, model: m.model, code: m.modelCode || '', company: m.companyTitle || '',
      kg: w.kg, kgSrc: w.source, kgItem: w.item,
      n: A.n, aStd: A.mean, aMed: A.median, aSd: A.sd,
      bStd, bRuns: B ? B.validRuns : null, bTotal: B ? B.totalRuns : null,
      diff: A.mean && bStd ? ((bStd - A.mean) / A.mean) * 100 : null,
    };
  }), [models, daysById, runsByModel, minSec, maxSec, minPieces, maxRework, breakSec, kgMap]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => (r.n > 0 || r.bStd != null) && (!q || `${r.model} ${r.code} ${r.company}`.toLowerCase().includes(q)));
    list.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return x.localeCompare(y) * sortDir;
      return (x - y) * sortDir;
    });
    return list;
  }, [rows, query, sortKey, sortDir]);

  const hiddenCount = rows.length - rows.filter((r) => r.n > 0 || r.bStd != null).length;
  const chartData = useMemo(() => [...view].filter((r) => r.aStd != null)
    .sort((a, b) => b.aStd - a.aStd).slice(0, CHART_ROWS)
    .map((r) => ({ name: r.code ? `${r.model} (${r.code})` : r.model, aStd: r1(r.aStd), bStd: r1(r.bStd) })), [view]);
  const overallA = useMemo(() => {
    const vals = view.map((r) => r.aStd).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [view]);
  const bDone = Object.keys(runsByModel).length > 0;

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(key === 'model' || key === 'code' ? 1 : -1); }
  };

  // Same content for the Excel file and the printed page: line, period, date, settings and the full table.
  const reportInput = () => {
    const lineId = getLine();
    const lineLabel = LINES.find(([id]) => String(id) === String(lineId))?.[1] || `Line ${lineId}`;
    const rowsOut = view.map((r) => ({ ...r, kgLabel: r.kgSrc ? KG_SOURCE[r.kgSrc][0] : null }));
    const meta = {
      lineLabel, start, end, generatedAt: serverNow(), count: rowsOut.length, overallA, bDone, query: query.trim(),
      settings: { minSec, maxSec, minPieces, maxRework, breakSec },
    };
    return { rowsOut, meta };
  };
  const exportExcel = () => {
    const { rowsOut, meta } = reportInput();
    try { exportReportXlsx(rowsOut, meta, chartData); } catch (e) { setError(`Excel export failed: ${e.message || e}`); }
  };
  const printList = () => {
    const { rowsOut, meta } = reportInput();
    try { printReport(rowsOut, meta); } catch (e) { setError(`Print failed: ${e.message || e}`); }
  };

  const sortMark = (key) => (key === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : '');

  return (
    <div id="std-model-list" className="sc-up">
      <style>{PRINT_CSS}</style>
      <Card title="All models — standard cycle time"
        sub={`${view.length} models shown${hiddenCount > 0 ? ` · ${hiddenCount} without valid cycles hidden` : ''} · period ${start || '—'} to ${end || '—'}`}
        formula="Method A = mean of valid gaps in [min, max] · Method B = mean of gaps in [min, max] with no rework next to them, over valid runs · difference = (B − A) ÷ A × 100"
        right={
          <div className="no-print flex flex-wrap items-center gap-2">
            <button type="button" onClick={computeMethodB} disabled={!models.length || progress?.running}
              className="h-9 rounded-lg bg-blue-600 px-3 text-fs-13 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {progress?.running ? `Computing B… ${progress.done}/${progress.total}` : bDone ? 'Recompute Method B' : 'Compute Method B'}
            </button>
            <button type="button" onClick={exportExcel} disabled={!view.length}
              className="h-9 rounded-lg border border-sky-600 px-3 text-fs-13 font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-50">
              Export Excel
            </button>
            <button type="button" onClick={printList} disabled={!view.length}
              className="h-9 rounded-lg border border-slate-400 px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Print
            </button>
          </div>
        }>
        {error && <div role="alert" className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-fs-13 font-semibold text-red-800 break-all">{error}</div>}
        {progress && !progress.running && progress.failed > 0 && (
          <div className="mb-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-fs-13 font-semibold text-slate-800">{progress.failed} of {progress.total} models could not be loaded for Method B.</div>
        )}

        <div className="no-print flex flex-wrap items-center gap-3 mb-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search model, code or company"
            aria-label="Search models"
            className="h-9 w-72 max-w-full rounded-lg border border-slate-300 px-3 text-fs-13 font-semibold focus:outline-2 focus:outline-blue-600" />
          <span className="text-fs-13 font-semibold text-slate-600" title="Simple mean of each model's Method A value. Each model has equal weight, regardless of its piece count.">Mean of model Method A values (unweighted): <span className="font-mono font-extrabold text-slate-900">{f1(overallA)} s</span></span>
        </div>

        {loading && <div className="py-10 text-center text-fs-14 font-semibold text-slate-600">Loading all models…</div>}
        {!loading && !error && !view.length && <Empty>No models with valid cycles in this period.</Empty>}

        {view.length > 0 && (
          <>
            <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-fs-13 tabular-nums">
                <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-left font-extrabold">#</th>
                    {COLUMNS.map(([key, label]) => (
                      <th key={key} scope="col" className="px-2 py-2 text-left font-extrabold whitespace-nowrap">
                        <button type="button" onClick={() => toggleSort(key)} className="no-print hover:text-blue-700">{label}{sortMark(key)}</button>
                        <span className="hidden print:inline">{label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.map((r, i) => (
                    <tr key={r.mmId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-mono text-slate-600">{i + 1}</td>
                      <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{r.model}{r.code ? <span className="font-normal text-slate-600"> ({r.code})</span> : null}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-10 text-right font-mono font-extrabold ${r.kg != null ? 'text-slate-900' : 'text-red-600'}`}>{r.kg != null ? r.kg : '—'}</span>
                          {r.kgSrc ? (
                            <span title={`${KG_SOURCE[r.kgSrc][1]}${r.kgItem ? ` · ${r.kgItem}` : ''}`}
                              className={`rounded px-1.5 py-0.5 text-fs-11 font-bold ${KG_SOURCE[r.kgSrc][2]}`}>{KG_SOURCE[r.kgSrc][0]}</span>
                          ) : <span className="text-fs-11 font-bold text-red-600">not set</span>}
                          <input type="number" min="0" step="0.1" value={kgMap?.[String(r.mmId)] ?? ''} placeholder="edit"
                            title="Type a weight to override; clear the box to go back to the automatic value"
                            aria-label={`Override weight in kg for ${r.model}`} onChange={(e) => onKgChange?.(String(r.mmId), e.target.value)}
                            className="no-print h-7 w-16 rounded-md border border-slate-300 px-1.5 font-mono text-fs-12 font-semibold focus:outline-2 focus:outline-blue-600" />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">{int(r.n)}</td>
                      <td className="px-2 py-1.5 font-mono font-extrabold text-sky-700">{f1(r.aStd)}</td>
                      <td className="px-2 py-1.5 font-mono">{f1(r.aMed)}</td>
                      <td className="px-2 py-1.5 font-mono">{f1(r.aSd)}</td>
                      <td className="px-2 py-1.5 font-mono font-extrabold text-blue-700">{f1(r.bStd)}</td>
                      <td className="px-2 py-1.5">{r.bRuns == null ? '—' : `${int(r.bRuns)} / ${int(r.bTotal)}`}</td>
                      <td className={`px-2 py-1.5 font-mono font-semibold ${r.diff == null ? '' : Math.abs(r.diff) < 3 ? 'text-sky-700' : r.diff > 0 ? 'text-slate-700' : 'text-sky-700'}`}>
                        {r.diff == null ? '—' : `${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <div className="text-fs-14 font-extrabold text-slate-900">Standard cycle by model (top {Math.min(CHART_ROWS, chartData.length)})</div>
              <div className="text-fs-12 text-slate-600 font-medium mb-2">Bars show Method A; dashed line = average of the shown models. Method B values are in the table and the Excel export.</div>
              <div style={{ height: Math.max(220, chartData.length * 26 + 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: narrow ? 20 : 56, left: narrow ? 0 : 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" unit=" s" tick={{ fontSize: fs(11), fill: '#334155' }} />
                    <YAxis type="category" dataKey="name" width={narrow ? 104 : 230} tick={{ fontSize: narrow ? fs(10.5) : fs(11), fill: '#334155' }}
                      tickFormatter={(v) => (narrow && String(v).length > 15 ? `${String(v).slice(0, 14)}…` : v)} />
                    <Tooltip formatter={(v, n) => [`${v} s`, n === 'aStd' ? 'Method A' : 'Method B']} />
                    {overallA != null && <ReferenceLine x={overallA} stroke="#0F172A" strokeDasharray="6 4" />}
                    <Bar dataKey="aStd" name="aStd" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={800}>
                      {chartData.map((r) => <Cell key={r.name} fill={overallA && r.aStd > overallA * 1.1 ? '#F59E0B' : '#14B8A6'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
