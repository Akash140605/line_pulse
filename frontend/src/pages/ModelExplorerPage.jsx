import { LINE_COLOR, fs } from '../theme';
import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts';
import { Filter, X, Search, FileSpreadsheet, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';
import useControlData from '../hooks/useControlData';
import useMediaQuery from '../hooks/useMediaQuery';
import { Card, Empty } from '../components/UiKit';
import LidIcon from '../components/LidIcon';
import MultiSelect from '../components/MultiSelect';
import { addDays } from '../utils/mainFilter';
import { LID } from '../utils/lid';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import {
  buildExplorerRows, assignPqClass, filterRows, sortRows, toggleSort, groupRows, optionCounts, explorerKpis,
  activeFilterText, explorerWorkbook, filterCount, EMPTY_FILTERS, GROUPS, EXPLORER_COLUMNS,
} from '../utils/modelExplorer';
import { serverNow } from '../utils/serverTime';

const CLS_COLOR = { A: '#1D4ED8', B: '#F59E0B', C: '#94A3B8' };
const LID_COLOR = { full: '#0369A1', half: '#4338CA', glass: '#0F766E', none: '#64748B', unknown: '#DC2626' };

const BAND_COLOR = ['#0EA5E9', '#14B8A6', '#22C55E', '#EAB308', '#F97316', '#CBD5E1'];
const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const f1 = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(1));
const tick = { fontSize: fs(11.5), fill: '#475569' };
const DEC = new Set(['share', 'cumPct', 'mean', 'median', 'cv', 'kg', 'weightT', 'achievedShare', 'achievedPph']);   // shown with one decimal
const LS = (line) => `ems.explorer.${line}`;
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const readLid = () => read('ems.lid', {});
const readKg = () => read('ems.stdcycle.kg', {});
const monthStart = (ds) => `${String(ds).slice(0, 8)}01`;
// addDays: local calendar (the old toISOString version moved dates one day back in India, UTC+5:30)

function RangeBox({ label, unit, lo, hi, onLo, onHi }) {
  const cls = 'w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-fs-13 font-mono';
  return (
    <div className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${lo !== '' || hi !== '' ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'}`}>
      <span className="shrink-0 text-fs-13 font-bold text-slate-600">{label}</span>
      <input inputMode="decimal" value={lo} onChange={(e) => onLo(e.target.value)} placeholder="min" className={cls} aria-label={`${label} minimum`} />
      <span className="text-slate-600">–</span>
      <input inputMode="decimal" value={hi} onChange={(e) => onHi(e.target.value)} placeholder="max" className={cls} aria-label={`${label} maximum`} />
      <span className="shrink-0 text-fs-12 text-slate-600">{unit}</span>
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'text-slate-900', bar = 'bg-blue-600' }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="text-fs-12 font-extrabold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`font-mono text-fs-24 font-extrabold leading-tight ${tone}`}>{value}</div>
      {sub && <div className="text-fs-12 text-slate-600 leading-snug">{sub}</div>}
    </div>
  );
}

function ChartTip({ active, payload, unit = 'pcs' }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-fs-13 shadow-xl">
      <div className="font-extrabold text-slate-900">{p.label ?? p.model}</div>
      {p.company && p.model && <div className="text-slate-600">{p.company}{p.lineName ? ` · ${p.lineName}` : ''}</div>}
      <div className="font-mono">{n0(p.pcs)} {unit}{p.share != null ? ` · ${f1(p.share)} %` : ''}</div>
      {p.models != null && <div className="text-slate-600">{p.models} models · mean {f1(p.mean)} s</div>}
      {p.cls && <div>Class <b>{p.cls}</b> · achieved {p.achieved ?? '—'} s</div>}
    </div>
  );
}

/* ───────────── page ───────────── */
export default function ModelExplorerPage({ line, latestDate, range: rangeProp }) {
  const isAll = line === 'all';
  const narrow = useMediaQuery('(max-width: 640px)');
  const saved = read(LS(line), {});
  const [own, setOwn] = useState(() => ({ start: '', end: '', preset: saved.preset || '30' }));
  useEffect(() => {
    if (rangeProp || !latestDate) return;
    setOwn((o) => (o.end ? o : { ...o, start: o.preset === 'month' ? monthStart(latestDate) : addDays(latestDate, -(Number(o.preset) - 1)), end: latestDate }));
  }, [latestDate, rangeProp]);
  const range = rangeProp?.start ? rangeProp : own;   // line view: the period of the filter bar above
  const [win, setWin] = useState(saved.win || { min: 1, max: 22 });
  const [f, setF] = useState({ ...EMPTY_FILTERS, ...(saved.f || {}) });
  const [sorts, setSorts] = useState(saved.sorts || [{ key: 'pcs', dir: 'desc' }]);
  const [groupKey, setGroupKey] = useState(saved.groupKey || 'company');
  const [showAll, setShowAll] = useState(false);
  const [xlErr, setXlErr] = useState('');
  useEffect(() => { write(LS(line), { f, sorts, groupKey, win, preset: own.preset }); }, [line, f, sorts, groupKey, win, own.preset]);

  const span = range.start && range.end ? Math.round((new Date(range.end) - new Date(range.start)) / 86400000) + 1 : 0;
  const { data, loading, error, reload } = useControlData({ start: range.start, end: range.end, companyId: '', line: isAll ? 'all' : String(line), enabled: span > 0 && span <= 400 });

  const all = useMemo(() => assignPqClass(buildExplorerRows(data?.models || [], { win, lidMap: readLid(), kgMap: isAll ? {} : readKg() }).filter((r) => r.pcs > 0)), [data, win, isAll]);
  const shown = useMemo(() => sortRows(filterRows(all, f), sorts), [all, f, sorts]);
  const k = useMemo(() => explorerKpis(shown, all), [shown, all]);
  // option lists show the counts of ALL models of the period (like Excel's list), so a value never disappears
  const opts = useMemo(() => ({
    lines: optionCounts(all, 'line').map((o) => ({ ...o, label: `Line ${o.value}` })), companies: optionCounts(all, 'company'),
    classes: optionCounts(all, 'cls'), lids: optionCounts(all, 'lid'), weightBands: optionCounts(all, 'weightBand'), achBands: optionCounts(all, 'achBand'),
  }), [all]);
  const set = (key) => (v) => setF((o) => ({ ...o, [key]: v }));
  const toggleIn = (key, v) => setF((o) => ({ ...o, [key]: o[key].map(String).includes(String(v)) ? o[key].filter((x) => String(x) !== String(v)) : [...o[key], String(v)] }));
  const nF = filterCount(f);
  const chips = activeFilterText(f);

  // charts follow the filters
  const pq = useMemo(() => {
    const top = [...shown].sort((a, b) => b.pcs - a.pcs);
    const total = top.reduce((s, r) => s + r.pcs, 0);
    let cum = 0;
    return top.slice(0, narrow ? 10 : 30).map((r) => { cum += r.pcs; return { ...r, label: r.model, cumLocal: total ? (cum / total) * 100 : 0 }; });
  }, [shown, narrow]);
  const byCompany = useMemo(() => groupRows(shown, 'company').slice(0, 12), [shown]);
  const byLine = useMemo(() => groupRows(shown, 'line'), [shown]);
  const byLid = useMemo(() => groupRows(shown, 'lid'), [shown]);
  const byWeight = useMemo(() => groupRows(shown, 'weightBand'), [shown]);
  const byAch = useMemo(() => groupRows(shown, 'achBand'), [shown]);
  const groups = useMemo(() => groupRows(shown, groupKey), [shown, groupKey]);

  const cols = EXPLORER_COLUMNS.filter((c) => c[4] && (!c[5] || isAll));
  const typeOf = (key) => (['company', 'model', 'code', 'cls', 'lid', 'kgFrom', 'line'].includes(key) ? 'text' : 'number');
  const onSort = (key, e) => setSorts((s) => toggleSort(s, key, e.shiftKey, typeOf(key)));
  const LIMIT = 200;
  const tableRows = showAll ? shown : shown.slice(0, LIMIT);

  const exportXl = () => {
    setXlErr('');
    try {
      const wb = explorerWorkbook(shown, all, f, { lineLabel: isAll ? 'All lines' : `Line ${line}`, start: range.start, end: range.end, generatedAt: serverNow(), allLines: isAll, sort: sorts });
      downloadXlsx(buildXlsx(wb.sheets), wb.fileName);
    } catch (e) { setXlErr(String(e.message || e)); }
  };

  // click on a bar = filter by that group (recharts puts the bar's number in d.value; the group is in d.payload.value)
  const barChart = (dataRows, key, colorOf, height = 220, horizontal = false) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={dataRows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 18, right: 16, left: horizontal ? 0 : 4, bottom: 4 }}>
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={tick} tickFormatter={(v) => n0(v)} />
            <YAxis type="category" dataKey="label" width={narrow ? 92 : 130} tick={{ ...tick, fontSize: narrow ? fs(10.5) : fs(11.5) }} interval={0}
              tickFormatter={(v) => (String(v).length > (narrow ? 12 : 18) ? `${String(v).slice(0, narrow ? 11 : 17)}…` : v)} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={{ ...tick, fontSize: narrow ? fs(10) : fs(11) }} interval={0}
              tickFormatter={(v) => { const t = String(v).replace(' — ', ' ').split(' (')[0]; return narrow ? t.replace(' glass', '').replace('Weight not set', 'No kg').replace('No valid cycles', 'None').slice(0, 9) : t.slice(0, 16); }} />
            <YAxis tick={tick} tickFormatter={(v) => n0(v)} width={56} />
          </>
        )}
        <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
        <Bar dataKey="pcs" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} cursor="pointer" onClick={(d) => toggleIn(key, d?.payload?.value ?? d.value)}
          label={{ position: horizontal ? 'right' : 'top', fontSize: fs(11), fill: '#334155', formatter: (v) => n0(v) }}>
          {dataRows.map((d, i) => <Cell key={d.value} fill={colorOf(d, i)} opacity={f[key].length && !f[key].map(String).includes(String(d.value)) ? 0.35 : 1} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* ── filters ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-2 text-fs-15 font-extrabold text-slate-800"><Filter size={16} aria-hidden />
            <span className="font-semibold text-slate-600">{isAll ? 'all lines' : `Line ${line}`} · {range.start || '…'} → {range.end || '…'}</span></h2>
          {!rangeProp && (
            // the period in the top bar, like every page (HeaderBar standard)
            <HeaderBar label="Model explorer filters">
              <div className={segGroup} role="group" aria-label="Period">
                {[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month']].map(([p, l]) => (
                  <button key={p} type="button" aria-pressed={own.preset === p} onClick={() => latestDate && setOwn({ preset: p, end: latestDate, start: p === 'month' ? monthStart(latestDate) : addDays(latestDate, -(Number(p) - 1)) })}
                    className={segBtn(own.preset === p)}>{l}</button>
                ))}
              </div>
              <input type="date" value={own.start} max={own.end || undefined} onChange={(e) => setOwn((o) => ({ ...o, preset: '', start: e.target.value }))} className={fieldCls} aria-label="From" />
              <span className="text-slate-400">→</span>
              <input type="date" value={own.end} min={own.start || undefined} onChange={(e) => setOwn((o) => ({ ...o, preset: '', end: e.target.value }))} className={fieldCls} aria-label="To" />
            </HeaderBar>
          )}
          <button type="button" onClick={exportXl} disabled={!shown.length}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-fs-13 font-bold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50">
            <FileSpreadsheet size={16} aria-hidden /> Download Excel ({shown.length} models)
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {isAll && <MultiSelect label="Line" options={opts.lines} selected={f.lines} onChange={set('lines')} />}
          <MultiSelect label="Company" options={opts.companies} selected={f.companies} onChange={set('companies')} />
          <MultiSelect label="P-Q class" options={opts.classes} selected={f.classes} onChange={set('classes')}
            render={(o) => <span><b style={{ color: CLS_COLOR[o.value] }}>{o.value}</b> <span className="text-slate-600">{o.label.split('—')[1]}</span></span>} />
          <MultiSelect label="Glass" options={opts.lids} selected={f.lids} onChange={set('lids')}
            render={(o) => <span className="inline-flex items-center gap-1.5"><LidIcon type={o.value} size={14} />{o.label}</span>} />
          <MultiSelect label="Weight" options={opts.weightBands} selected={f.weightBands} onChange={set('weightBands')} />
          <MultiSelect label="Achieved cycle" options={opts.achBands} selected={f.achBands} onChange={set('achBands')} />
          <RangeBox label="kg" unit="kg" lo={f.kgMin} hi={f.kgMax} onLo={set('kgMin')} onHi={set('kgMax')} />
          <RangeBox label="Achieved" unit="s" lo={f.achMin} hi={f.achMax} onLo={set('achMin')} onHi={set('achMax')} />
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2">
            <Search size={14} className="text-slate-600" aria-hidden />
            <input value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search model / code / company" className="w-full py-1.5 text-fs-13 outline-none" />
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1">
            <span className="shrink-0 text-fs-13 font-bold text-slate-600">Min pcs</span>
            <input inputMode="numeric" value={f.minPcs} onChange={(e) => set('minPcs')(e.target.value)} className="w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1 text-fs-13 font-mono" />
            <span className="shrink-0 text-fs-13 font-bold text-slate-600" title="valid cycle window (seconds)">Cycle</span>
            <input inputMode="numeric" value={win.min} onChange={(e) => setWin((w) => ({ ...w, min: e.target.value }))} className="w-12 rounded-lg border border-slate-300 px-1.5 py-1 text-fs-13 font-mono" aria-label="valid cycle minimum" />
            <input inputMode="numeric" value={win.max} onChange={(e) => setWin((w) => ({ ...w, max: e.target.value }))} className="w-12 rounded-lg border border-slate-300 px-1.5 py-1 text-fs-13 font-mono" aria-label="valid cycle maximum" />
          </div>
        </div>
        {rangeProp && (
          null
        )}
        {(nF > 0 || sorts.length > 1) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => <span key={c} className="rounded-full bg-blue-100 px-2.5 py-1 text-fs-12 font-bold text-blue-900">{c}</span>)}
            <button type="button" onClick={() => setF({ ...EMPTY_FILTERS })} className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-fs-12 font-bold text-white"><X size={12} aria-hidden /> Clear all filters</button>
            {sorts.length > 1 && <button type="button" onClick={() => setSorts([{ key: 'pcs', dir: 'desc' }])} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-fs-12 font-bold text-slate-700"><RotateCcw size={12} aria-hidden /> Reset sort</button>}
          </div>
        )}
        {xlErr && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-fs-13 text-red-800">Excel not created: {xlErr}</div>}
      </div>

      {error && <div className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2.5 text-fs-14 font-semibold text-red-800">{error} <button type="button" className="ml-2 underline" onClick={reload}>Retry</button></div>}
      {loading && !data && <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-fs-14 font-semibold text-slate-600 shadow-sm">Loading models…</div>}
      {data && !all.length && <Empty>No production in this period</Empty>}

      {all.length > 0 && (
        <>
          {/* ── KPIs of the filtered models ── */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Models" value={`${k.models}`} sub={`of ${k.allModels} · A ${k.classes.A} · B ${k.classes.B} · C ${k.classes.C}`} />
            <Kpi label="Qty" value={n0(k.pcs)} sub={`${f1(k.sharePct)} % of ${n0(k.allPcs)}`} tone="text-sky-700" bar="bg-sky-600" />
            <Kpi label="Companies" value={`${k.companies}`} sub={isAll ? `${k.lines} lines` : `Line ${line}`} bar="bg-blue-600" />
            <Kpi label="Mean cycle" value={k.mean != null ? `${f1(k.mean)} s` : '—'} sub={`${n0(k.valid)} valid cycles`} tone="text-sky-700" bar="bg-sky-600" />
            <Kpi label="Achieved (avg)" value={k.achievedAvg != null ? `${f1(k.achievedAvg)} s` : '—'} sub="weighted by pieces" tone="text-sky-700" bar="bg-sky-600" />
            <Kpi label="Weight shipped" value={`${f1(k.weightT)} t`} sub={`${k.kgKnown} of ${k.models} models with weight`} tone="text-slate-700" bar="bg-slate-500" />
          </div>

          {!shown.length ? <Empty>No model matches these filters — change or clear a filter.</Empty> : (
            <>
              {/* ── charts (follow the filters; click a bar to filter) ── */}
              <Card title="P-Q chart — filtered models" sub={`Top ${pq.length} of ${shown.length} · bars = pieces (colour = class over all models) · line = cumulative % of the filtered pieces`}>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={pq} margin={{ top: 18, right: 8, left: 4, bottom: narrow ? 70 : 60 }}>
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="label" tick={{ ...tick, fontSize: fs(10.5) }} interval={0} angle={-40} textAnchor="end" height={narrow ? 70 : 60} tickFormatter={(v) => String(v).slice(0, 14)} />
                    <YAxis yAxisId="q" tick={tick} tickFormatter={(v) => n0(v)} width={56} />
                    <YAxis yAxisId="p" orientation="right" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={tick} width={36} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<ChartTip />} />
                    <ReferenceLine yAxisId="p" y={80} stroke="#DC2626" strokeDasharray="5 3" />
                    <ReferenceLine yAxisId="p" y={95} stroke="#F59E0B" strokeDasharray="5 3" />
                    <Bar yAxisId="q" dataKey="pcs" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => set('q')(d?.payload?.model ?? d.model)}>
                      {pq.map((d) => <Cell key={d.key} fill={CLS_COLOR[d.cls]} />)}
                    </Bar>
                    <Line yAxisId="p" dataKey="cumLocal" stroke="#7C3AED" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <Card title="Qty by company" sub={`Top ${byCompany.length}`}>
                  {barChart(byCompany, 'companies', (d, i) => ['#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD'][Math.min(i, 4)], Math.max(200, byCompany.length * 28 + 40), true)}
                </Card>
                {isAll && (
                  <Card title="Qty by line">
                    {barChart(byLine.map((g) => ({ ...g, label: `Line ${g.value}` })), 'lines', (d) => LINE_COLOR[d.value] || '#64748B')}
                  </Card>
                )}
                <Card title="Qty by glass type">
                  {barChart(byLid, 'lids', (d) => LID_COLOR[d.value] || '#64748B')}
                </Card>
                <Card title="Qty by weight">
                  {barChart(byWeight, 'weightBands', (d, i) => BAND_COLOR[i % BAND_COLOR.length])}
                </Card>
                <Card title="Qty by achieved cycle">
                  {barChart(byAch, 'achBands', (d, i) => BAND_COLOR[i % BAND_COLOR.length])}
                </Card>
              </div>

              {/* ── group summary ── */}
              <Card title="Summary by group" sub="of the filtered models" right={(
                <select value={groupKey} onChange={(e) => setGroupKey(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-fs-13 font-semibold" aria-label="Group by">
                  {Object.entries(GROUPS).filter(([kk]) => kk !== 'line' || isAll).map(([kk, g]) => <option key={kk} value={kk}>Group by {g.label}</option>)}
                </select>
              )}>
                <div className="overflow-x-auto">
                  <table className="w-full text-fs-13">
                    <thead><tr className="whitespace-nowrap border-b-2 border-slate-200 text-left text-fs-12 uppercase text-slate-600">
                      <th className="px-2 py-2">{GROUPS[groupKey].label}</th><th className="px-2 text-right">Models</th><th className="px-2 text-right">Qty</th><th className="px-2 text-right">Share</th>
                      <th className="px-2 text-right">Mean cycle</th><th className="px-2 text-right">Weight shipped</th><th className="px-2" />
                    </tr></thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.value} className="whitespace-nowrap border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-semibold">{g.label}</td><td className="px-2 text-right font-mono">{g.models}</td>
                          <td className="px-2 text-right font-mono font-bold">{n0(g.pcs)}</td><td className="px-2 text-right font-mono">{f1(g.share)} %</td>
                          <td className="px-2 text-right font-mono">{f1(g.mean)} s</td><td className="px-2 text-right font-mono">{f1(g.weightT)} t</td>
                          <td className="w-[28%] min-w-[90px] px-2"><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-blue-600" style={{ width: `${Math.min(100, g.share)}%` }} /></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* ── table: click a header to sort, shift+click to add a level ── */}
              <Card title={`Models (${shown.length})`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-fs-13">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b-2 border-slate-200 text-fs-12 uppercase text-slate-600">
                        {cols.map(([h, , , , key]) => {
                          const i = sorts.findIndex((s) => s.key === key);
                          const s = sorts[i];
                          return (
                            <th key={key} scope="col" className={`whitespace-nowrap px-2 py-2 ${typeOf(key) === 'number' ? 'text-right' : 'text-left'}`}
                              aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                              <button type="button" onClick={(e) => onSort(key, e)} className={`inline-flex items-center gap-0.5 font-extrabold uppercase hover:text-blue-700 ${s ? 'text-blue-700' : ''}`}>
                                {h.replace(' (s)', '').replace(' (%)', ' %')}
                                {s && (s.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
                                {s && sorts.length > 1 && <sup>{i + 1}</sup>}
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r) => (
                        <tr key={r.key} className="border-b border-slate-100 hover:bg-blue-50/40">
                          {cols.map(([, , get, , key]) => {
                            const v = get(r);
                            if (key === 'cls') return <td key={key} className="px-2"><span className="inline-block w-6 rounded text-center font-extrabold text-white" style={{ background: CLS_COLOR[r.cls] }}>{r.cls}</span></td>;
                            if (key === 'lid') return <td key={key} className="whitespace-nowrap px-2"><span className="inline-flex items-center gap-1"><LidIcon type={r.lid} size={14} />{LID[r.lid]?.short}</span></td>;
                            if (key === 'line') return <td key={key} className="px-2 font-bold" style={{ color: LINE_COLOR[r.line] }}>{r.lineName}</td>;
                            const isNum = typeOf(key) === 'number';
                            return <td key={key} className={`whitespace-nowrap px-2 py-1.5 ${isNum ? 'text-right font-mono' : ''} ${key === 'model' ? 'font-bold text-slate-900' : ''} ${key === 'pcs' ? 'font-bold' : ''}`}>
                              {v == null ? '—' : isNum ? (DEC.has(key) ? f1(v) : n0(v)) : v}
                            </td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
                        {cols.map(([, , , , key], i) => (
                          <td key={key} className={`whitespace-nowrap px-2 py-2 ${typeOf(key) === 'number' ? 'text-right font-mono' : ''}`}>
                            {i === 0 ? 'Total' : key === 'model' ? `${shown.length} models` : key === 'pcs' ? n0(k.pcs) : key === 'share' ? `${f1(k.sharePct)}` : key === 'valid' ? n0(k.valid) : key === 'mean' ? f1(k.mean) : key === 'weightT' ? f1(k.weightT) : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {shown.length > LIMIT && (
                  <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-2 rounded-lg bg-slate-100 px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-200">
                    {showAll ? `Show the first ${LIMIT}` : `Show all ${shown.length} models`} (the Excel file always has all)
                  </button>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
