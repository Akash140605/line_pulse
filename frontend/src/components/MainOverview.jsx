import { LINE_COLOR, fs } from '../theme';
import { describeLoadError } from '../utils/offline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, ReferenceArea } from 'recharts';
import { RefreshCw, Download } from 'lucide-react';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { lossMatrix } from '../utils/money';
import { mainWorkbook } from '../utils/moneyExport';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { Card, Stat, Empty } from './UiKit';
import { api, LINE_IDS } from '../api';
import { axisTicks } from '../utils/axisTicks';
import { hourSpanLabel, SHIFT_DEFAULT } from '../utils/shift';
import MultiSelect from './MultiSelect';
import LossBoard from './LossBoard';
import { quickPeriods, matchPeriod, periodText, companyOptions, filterLinesByCompany, companySummary, modelOptions, filterLinesByModel } from '../utils/mainFilter';
import { serverNow } from '../utils/serverTime';

const pad = (n) => String(n).padStart(2, '0');
const nf = (v) => (v == null ? '—' : Number(v).toLocaleString());
const f1 = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const tick = { fontSize: fs(13), fill: '#1E293B', fontFamily: '"IBM Plex Mono", ui-monospace, monospace' };
const inpCls = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-14 font-bold font-mono text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const IDS = LINE_IDS;   // the lines this login may see (api.js)
const COLORS = LINE_COLOR;

const cache = new Map();

function NumInput({ value, onCommit, min = 0, step = 1, w = 'w-20' }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Number(v); if (v !== '' && Number.isFinite(n) && n >= min) onCommit(n); else setV(String(value)); };
  return <input type="number" min={min} step={step} value={v} className={`${inpCls} ${w}`} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

/** Weighted mean of per-model cycle averages (weights = valid cycles). */
const wmean = (rows) => { let n = 0, s = 0; for (const r of rows) if (r.avgCycle != null && r.validCycles) { n += r.validCycles; s += r.avgCycle * r.validCycles; } return n ? s / n : null; };

export default function MainOverview({ latestDate, simple = false }) {
  // Last 30 days by default (opens fast); Today, Yesterday, 7 days, months … are one click away, or any dates.
  const periods = useMemo(() => quickPeriods(latestDate), [latestDate]);
  const [range, setRange] = useState(() => { const p = periods.find((x) => x.key === '30d'); return { start: p.start, end: p.end }; });
  const [companies, setCompanies] = useState([]);
  const [modelSel, setModelSel] = useState([]);       // model names; empty = all models      // empty = all companies
  const [win, setWin] = useState({ min: 1, max: 22 });
  const [main, setMain] = useState(null);
  const [hour, setHour] = useState(null);           // { date, byLine }
  const [loading, setLoading] = useState(false);
  const [hLoading, setHLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [lineFilter, setLineFilter] = useState('all');
  const ctl = useRef(null);

  const spanDays = Math.round((new Date(range.end) - new Date(range.start)) / 86400000) + 1;
  const rangeOk = spanDays > 0 && spanDays <= 400;

  const load = useCallback(async (force = false) => {
    if (!rangeOk) return;
    const key = `${range.start}|${range.end}|${win.min}|${win.max}`;
    const apply = (j) => { setMain(j); setHour({ date: j.focus, byLine: Object.fromEntries(j.lines.map((l) => [l.line, { hourly: l.hourly, hourlyCo: l.hourlyCo }])) }); };
    if (!force && cache.has(key)) { apply(cache.get(key)); setError(''); return; }
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setLoading(true); setError('');
    try {
      const j = await api.allLinesParallel({ ...range, cmin: win.min, cmax: win.max }, { signal: c.signal, fresh: force });
      if (j?.error) throw new Error(j.error);
      cache.set(key, j); apply(j);
    } catch (e) {
      if (e.name !== 'AbortError') { setError(String(e.message || e) === 'Failed to fetch' ? 'The server did not respond (all_lines.php not found or timed out).' : String(e.message || e)); setMain(null); }
    } finally { if (ctl.current === c) setLoading(false); }
  }, [range, win, rangeOk]);

  useEffect(() => { load(false); return () => ctl.current?.abort(); }, [load]);

  const pickDay = async (date) => {
    if (!date || hour?.date === date) return;
    setHLoading(true);
    try {
      const j = await api.allLines({ ...range, date, only: 'hourly' }, {});
      setHour({ date, byLine: Object.fromEntries(j.lines.map((l) => [l.line, { hourly: l.hourly, hourlyCo: l.hourlyCo }])) });
    } catch (e) { setError(String(e.message || e)); } finally { setHLoading(false); }
  };

  const rawLines = main?.lines || [];
  // The hourly part belongs to the selected day (hour.date); the company filter rebuilds daily, hourly and models.
  const withHour = useMemo(() => rawLines.map((l) => (hour?.byLine?.[l.line] ? { ...l, ...hour.byLine[l.line] } : { ...l, hourly: [], hourlyCo: [] })), [rawLines, hour]);
  const coOptions = useMemo(() => companyOptions(rawLines.filter((l) => lineFilter === 'all' || l.line === lineFilter)), [rawLines, lineFilter]);
  const coMissing = rawLines.some((l) => l.ok && l.daily?.length && !Array.isArray(l.dailyCo));   // old backend without the company split
  const coActive = companies.length > 0 && !coMissing;
  const moOptions = useMemo(() => modelOptions(rawLines.filter((l) => lineFilter === 'all' || l.line === lineFilter), coActive ? companies : []), [rawLines, lineFilter, companies, coActive]);
  const moSel = modelSel.filter((m) => moOptions.some((o) => o.value === m));   // a model hidden by the company filter drops out
  const moActive = moSel.length > 0 && rawLines.some((l) => Array.isArray(l.dhm));
  const lines = useMemo(() => {
    const byCo = coActive ? filterLinesByCompany(withHour, companies) : withHour;
    return moActive ? filterLinesByModel(byCo.map((l) => ({ ...l, dhm: rawLines.find((r) => r.line === l.line)?.dhm, mmCo: rawLines.find((r) => r.line === l.line)?.mmCo })), moSel, hour?.date) : byCo;
  }, [withHour, companies, coActive, moActive, moSel.join('|'), hour?.date, rawLines]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = lines.filter((l) => lineFilter === 'all' || l.line === lineFilter);
  // The company table always lists every company (so more can be clicked); the selected ones are marked and summed.
  const coRows = useMemo(() => (coMissing ? [] : companySummary(rawLines.filter((l) => lineFilter === 'all' || l.line === lineFilter))), [rawLines, lineFilter, coMissing]);
  const coSel = coRows.filter((r) => companies.includes(r.company));
  const period = periodText(latestDate, range);
  const activePeriod = matchPeriod(latestDate, range)?.key;
  const allSettings = useAllLineSettings(IDS);
  const exportAll = () => {
    const mx = lossMatrix(rawLines.filter((l) => l.ok), allSettings, { now: serverNow(), range });
    const wb = mainWorkbook(shown, mx, { start: range.start, end: range.end, period });
    downloadXlsx(buildXlsx(wb.sheets), wb.fileName);
  };
  const toggleCompany = (c) => setCompanies((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  /* per-line totals */
  const totals = useMemo(() => lines.map((l) => {
    const qty = l.daily.reduce((s, r) => s + r.q, 0);
    const valid = l.models.reduce((s, m) => s + m.validCycles, 0);
    return { line: l.line, name: l.name, ok: l.ok, error: l.error, qty, days: l.daily.filter((r) => r.q > 0).length, models: l.models.length, valid,
      above: l.models.reduce((s, m) => s + m.aboveMax, 0), avgCycle: wmean(l.models), rej: l.rejections.total, top: l.rejections.top };
  }), [lines]);
  const visT = totals.filter((t) => lineFilter === 'all' || t.line === lineFilter);
  const grand = useMemo(() => {
    const g = { qty: 0, valid: 0, above: 0, rej: 0, models: 0 };
    for (const t of visT) { g.qty += t.qty; g.valid += t.valid; g.above += t.above; g.rej += t.rej; g.models += t.models; }
    g.avgCycle = wmean(shown.flatMap((l) => l.models));
    return g;
  }, [visT, shown]);

  /* daily stacked rows */
  const dailyRows = useMemo(() => {
    const m = new Map();
    for (const l of shown) for (const r of l.daily) {
      const o = m.get(r.d) || { d: r.d, label: r.d.slice(5), total: 0 };
      o[`L${l.line}`] = r.q; o.total += r.q; m.set(r.d, o);
    }
    return [...m.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  }, [shown]);

  /* hourly stacked rows for the focus day */
  const hourRows = useMemo(() => {
    if (!hour) return [];
    const by = {}; let lo = 24, hi = -1;
    for (const l of shown) for (const r of l.hourly || []) { (by[r.h] = by[r.h] || { total: 0 })[`L${l.line}`] = r.q; by[r.h].total += r.q; lo = Math.min(lo, r.h); hi = Math.max(hi, r.h); }
    if (hi < 0) return [];
    const out = [];
    const sh = allSettings?.[IDS[0]]?.shift || SHIFT_DEFAULT;   // one time axis for every line: the shift of Line 1
    for (let h = lo; h <= hi; h++) out.push({ h, label: hourSpanLabel(sh, h), total: 0, ...(by[h] || {}) });
    return out;
  }, [hour, shown, allSettings]);

  /* all models of all lines */
  const modelRows = useMemo(() => shown.flatMap((l) => l.models.map((m) => ({ ...m, line: l.line, lineName: l.name })))
    .filter((m) => !q || `${m.model} ${m.modelCode || ''} ${m.company || ''} ${m.lineName}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.qty - a.qty), [shown, q]);
  const mTot = useMemo(() => ({ qty: modelRows.reduce((s, m) => s + m.qty, 0), valid: modelRows.reduce((s, m) => s + m.validCycles, 0), above: modelRows.reduce((s, m) => s + m.aboveMax, 0), avg: wmean(modelRows) }), [modelRows]);

  const series = shown.map((l) => l.line);
  const chips = [['all', 'All lines'], ...IDS.map((i) => [i, `Line ${i}`])];

  // Quantity axes: daily = base 1000, step 200; hourly = base 100, step 20 (0 is always shown).
  const dailyMax = dailyRows.reduce((mx, r) => Math.max(mx, r.total || 0), 0);
  const hourlyMax = hourRows.reduce((mx, r) => Math.max(mx, r.total || 0), 0);
  const dailyAxis = axisTicks(dailyMax, 1000, 200, null, { fromZero: true, maxTicks: 9 }); // stacked bars: keep 0 so each line's share stays true
  const hourlyAxis = axisTicks(hourlyMax, 100, 20, null, { fromZero: true, maxTicks: 9 });

  return (
    <div className={`space-y-3 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <Card title="All lines — period and filters"
        sub={`${period}${coActive ? ` · ${companies.length === 1 ? companies[0] : `${companies.length} companies`}` : ' · all companies'}${moActive ? ` · ${moSel.length === 1 ? moSel[0] : `${moSel.length} models`}` : ''}`}
        formula="quantity = valid scans per line · cycle = mean(gaps between Min and Max) · TOTAL = sum of the selected lines and companies"
        right={(
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => load(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-fs-13 font-bold hover:bg-slate-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Reload data</button>
            <button type="button" disabled={!main} onClick={exportAll} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 text-white px-3 py-1.5 text-fs-13 font-bold hover:bg-blue-800 disabled:opacity-50"><Download size={14} /> Export Excel</button>
          </div>
        )}>
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-fs-13 font-bold text-slate-700 mb-1">Period</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {periods.map((p) => (
                <button key={p.key} type="button" aria-pressed={activePeriod === p.key} onClick={() => setRange({ start: p.start, end: p.end })}
                  className={`px-3 py-1.5 rounded-lg border text-fs-13 font-extrabold ${activePeriod === p.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{p.label}</button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <input type="date" aria-label="From date" className={inpCls} value={range.start} max={latestDate} onChange={(e) => e.target.value && setRange({ ...range, start: e.target.value })} />
              <span className="text-slate-600 font-bold">→</span>
              <input type="date" aria-label="To date" className={inpCls} value={range.end} max={latestDate} onChange={(e) => e.target.value && setRange({ ...range, end: e.target.value })} />
              <button type="button" onClick={() => setRange({ start: range.end, end: range.end })} title="Show only the 'to' date"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-fs-13 font-bold text-slate-700 hover:bg-slate-50">Single day</button>
              <span className={`text-fs-13 font-bold ${rangeOk ? 'text-slate-600' : 'text-red-600'}`}>{rangeOk ? `${spanDays} day${spanDays === 1 ? '' : 's'}` : 'Range must be 1–400 days'}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-full sm:w-72">
              <div className="text-fs-13 font-bold text-slate-700 mb-1">Company</div>
              <MultiSelect label="Company" options={coOptions} selected={companies} onChange={setCompanies} />
            </div>
            <div className="w-full sm:w-72">
              <div className="text-fs-13 font-bold text-slate-700 mb-1">Model</div>
              <MultiSelect label="Model" options={moOptions} selected={moSel} onChange={setModelSel} />
            </div>
            <div>
              <div className="text-fs-13 font-bold text-slate-700 mb-1">Line</div>
              <div className="inline-flex flex-wrap rounded-lg border border-slate-300 overflow-hidden text-fs-13 font-bold">
                {chips.map(([k, l]) => <button key={k} type="button" onClick={() => setLineFilter(k)} className={`px-2.5 py-1.5 ${lineFilter === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
              </div>
            </div>
            {!simple && <label className="flex flex-col gap-1 text-fs-13 font-bold text-slate-700">Minimum (s)<NumInput value={win.min} min={0} step={0.5} onCommit={(n) => setWin({ ...win, min: n })} /></label>}
            {!simple && <label className="flex flex-col gap-1 text-fs-13 font-bold text-slate-700">Maximum (s)<NumInput value={win.max} min={1} step={1} onCommit={(n) => setWin({ ...win, max: n })} /></label>}
          </div>
          {companies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-fs-13">
              {companies.map((c) => (
                <button key={c} type="button" onClick={() => toggleCompany(c)} title="Remove this company from the filter"
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 font-bold text-blue-900 hover:bg-blue-200">{c} <span aria-hidden>×</span></button>
              ))}
              <button type="button" onClick={() => setCompanies([])} className="rounded-full px-2 py-0.5 font-bold text-slate-600 underline hover:text-slate-900">All companies</button>
              <span className="text-slate-600">Rejections are not stored per company, so they stay for all companies.</span>
            </div>
          )}
          {coMissing && companies.length > 0 && (
            <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-fs-13 font-semibold text-slate-800">
              The company filter needs the updated backend (<b>backend/api/all_lines.php</b>). The figures below are for all companies.
            </div>
          )}
        </div>
      </Card>

      {error && <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-fs-14 font-semibold text-red-800"><div className="font-extrabold">Data could not be loaded</div><div className="font-mono break-all">{error}</div><div className="mt-1 text-fs-13">Confirm that <b>backend/api/all_lines.php</b> is deployed.</div></div>}
      {!error && loading && !main && <div className="rounded-xl bg-white border border-slate-200 py-16 text-center text-fs-16 font-bold text-slate-600">Loading all lines for {spanDays} days…</div>}

      {main && (
        <>
          {totals.some((t) => !t.ok) && (
            <div className="rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-fs-13 font-semibold text-slate-800">
              {totals.filter((t) => !t.ok).map((t) => (
                <div key={t.line} title={t.error}>{describeLoadError(t.error, t.name).title}. The totals below are for the other lines.</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
            <Stat label={moActive ? 'SELECTED MODELS — quantity' : coActive ? 'SELECTED COMPANIES — quantity' : 'ALL LINES — quantity'} value={nf(grand.qty)} sub={`${spanDays === 1 ? range.end : `${spanDays} days`} · ${nf(grand.valid)} valid cycles · mean ${f1(grand.avgCycle)}s`} tone="text-slate-950" bar="bg-slate-800" />
            {totals.map((t) => (
              <Stat key={t.line} label={t.name} value={t.ok ? nf(t.qty) : 'offline'} tone={t.ok ? 'text-slate-900' : 'text-red-600'} barColor={COLORS[t.line]}
                sub={t.ok ? `${grand.qty ? f1((t.qty / grand.qty) * 100) : '0.0'}% · mean ${f1(t.avgCycle)}s · ${t.models} models` : 'server not reachable'} />
            ))}
          </div>

          <LossBoard readOnly={simple} lines={rawLines} range={range} period={`${period}${coActive || moActive ? ' · target and loss use all companies and models (line time is shared)' : ''}`} latestDate={latestDate} />

          {!simple && (
          <Card title="Line-wise summary" sub={`${period} · comparison of the lines; total below.`}
            formula="share = line qty ÷ total qty · rejection % = rejected ÷ (quantity + rejected) · mean cycle weighted by valid cycles">
            <div className="overflow-auto mt-2">
              <table className="w-full text-fs-13">
                <thead><tr className="text-left text-slate-600 uppercase tracking-wide border-b border-slate-200">
                  {['Line', 'Models', 'Quantity', 'Share', 'Active days', 'Avg / day', 'Valid cycles', 'Mean cycle (s)', `Above ${win.max}s`, coActive ? 'Rejected (all co.)' : 'Rejected', 'Rejection %'].map((h) => <th key={h} className="px-2.5 py-2 font-bold whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {visT.map((t) => (
                    <tr key={t.line} className="border-b border-slate-100 font-mono">
                      <td className="px-2.5 py-1.5 font-sans font-extrabold whitespace-nowrap"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: COLORS[t.line] }} />{t.name}</td>
                      <td className="px-2.5">{t.models}</td><td className="px-2.5 font-bold">{nf(t.qty)}</td>
                      <td className="px-2.5">{grand.qty ? f1((t.qty / grand.qty) * 100) : '0.0'}%</td><td className="px-2.5">{t.days}</td>
                      <td className="px-2.5">{t.days ? nf(Math.round(t.qty / t.days)) : '—'}</td><td className="px-2.5 text-sky-700 font-bold">{nf(t.valid)}</td>
                      <td className="px-2.5 font-bold text-sky-700">{t.avgCycle != null ? `${f1(t.avgCycle)}s` : '—'}</td>
                      <td className={`px-2.5 ${t.above ? 'text-red-600 font-bold' : ''}`}>{nf(t.above)}</td>
                      <td className="px-2.5">{nf(t.rej)}</td><td className={`px-2.5 ${t.rej && t.qty && t.rej / (t.qty + t.rej) > 0.05 ? 'text-red-600 font-bold' : ''}`}>{t.qty + t.rej ? f1((t.rej / (t.qty + t.rej)) * 100) : '0.0'}%</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-mono font-extrabold border-t-2 border-slate-300">
                    <td className="px-2.5 py-2 font-sans">TOTAL</td><td className="px-2.5">{grand.models}</td><td className="px-2.5">{nf(grand.qty)}</td><td className="px-2.5">100%</td>
                    <td className="px-2.5">{dailyRows.filter((r) => r.total > 0).length}</td><td className="px-2.5">{dailyRows.length ? nf(Math.round(grand.qty / dailyRows.length)) : '—'}</td>
                    <td className="px-2.5 text-sky-700">{nf(grand.valid)}</td><td className="px-2.5 text-sky-700">{grand.avgCycle != null ? `${f1(grand.avgCycle)}s` : '—'}</td>
                    <td className="px-2.5">{nf(grand.above)}</td><td className="px-2.5">{nf(grand.rej)}</td><td className="px-2.5">{grand.qty + grand.rej ? f1((grand.rej / (grand.qty + grand.rej)) * 100) : '0.0'}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          )}

          {!simple && (
          <Card title="Company-wise production" sub={`${period} · ${coRows.length} ${coRows.length === 1 ? 'company' : 'companies'} · click companies to filter the whole page (click again to remove)`}
            formula="company qty = valid scans of the company's models · share = company qty ÷ qty of all companies of the shown lines">
            {coMissing ? <Empty>Company split needs the updated backend/api/all_lines.php.</Empty> : coRows.length ? (
              <div className="overflow-auto max-h-[420px] mt-2">
                <table className="w-full text-fs-13">
                  <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-slate-600 uppercase tracking-wide border-b border-slate-200">
                    <th className="px-2.5 py-2 font-bold">Company</th>
                    {shown.filter((l) => l.ok).map((l) => <th key={l.line} className="px-2.5 py-2 font-bold whitespace-nowrap text-right"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: COLORS[l.line] }} />{l.name}</th>)}
                    <th className="px-2.5 py-2 font-bold text-right">Total</th><th className="px-2.5 py-2 font-bold min-w-[150px]">Share</th>
                    <th className="px-2.5 py-2 font-bold text-right">Models</th><th className="px-2.5 py-2 font-bold text-right whitespace-nowrap">Active days</th>
                  </tr></thead>
                  <tbody>
                    {coRows.map((r) => {
                      const on = companies.includes(r.company);
                      return (
                        <tr key={r.company} onClick={() => toggleCompany(r.company)} title={on ? 'Click to remove from the filter' : 'Click to filter by this company'}
                          className={`border-b border-slate-100 font-mono cursor-pointer ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                          <td className="px-2.5 py-1.5 font-sans font-extrabold whitespace-nowrap">{on ? '✓ ' : ''}{r.company}</td>
                          {shown.filter((l) => l.ok).map((l) => <td key={l.line} className="px-2.5 text-right">{r.lines[l.line] ? nf(r.lines[l.line]) : '—'}</td>)}
                          <td className="px-2.5 text-right font-bold">{nf(r.total)}</td>
                          <td className="px-2.5"><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded bg-slate-100"><div className="h-2 rounded bg-blue-600" style={{ width: `${Math.min(100, r.share)}%` }} /></div><span className="w-12 text-right">{f1(r.share)}%</span></div></td>
                          <td className="px-2.5 text-right">{r.models}</td><td className="px-2.5 text-right">{r.days}</td>
                        </tr>
                      );
                    })}
                    {coSel.length > 0 && (
                      <tr className="sticky bottom-9 bg-blue-100 font-mono font-extrabold text-blue-950 border-t-2 border-blue-300">
                        <td className="px-2.5 py-2 font-sans whitespace-nowrap">SELECTED ({coSel.length})</td>
                        {shown.filter((l) => l.ok).map((l) => <td key={l.line} className="px-2.5 text-right">{nf(coSel.reduce((a, r) => a + (r.lines[l.line] || 0), 0))}</td>)}
                        <td className="px-2.5 text-right">{nf(coSel.reduce((a, r) => a + r.total, 0))}</td><td className="px-2.5">{f1(coSel.reduce((a, r) => a + r.share, 0))}%</td>
                        <td className="px-2.5 text-right">{coSel.reduce((a, r) => a + r.models, 0)}</td><td className="px-2.5 text-right">—</td>
                      </tr>
                    )}
                    <tr className="sticky bottom-0 bg-slate-100 font-mono font-extrabold border-t-2 border-slate-300">
                      <td className="px-2.5 py-2 font-sans">TOTAL</td>
                      {shown.filter((l) => l.ok).map((l) => <td key={l.line} className="px-2.5 text-right">{nf(coRows.reduce((a, r) => a + (r.lines[l.line] || 0), 0))}</td>)}
                      <td className="px-2.5 text-right">{nf(coRows.reduce((a, r) => a + r.total, 0))}</td><td className="px-2.5">100%</td>
                      <td className="px-2.5 text-right">{coRows.reduce((a, r) => a + r.models, 0)}</td><td className="px-2.5 text-right">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : <Empty>No scans in this period.</Empty>}
          </Card>
          )}

          <Card title={`Daily production — ${moActive ? (moSel.length === 1 ? moSel[0] : `${moSel.length} models`) : coActive ? (companies.length === 1 ? companies[0] : `${companies.length} companies`) : 'all lines'}`} sub={`${period} · daily quantity, stacked by line. Click a day to see its hourly breakdown below.`}
            formula="bar height = sum of the lines · colour = line">
            {dailyRows.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={dailyRows} margin={{ top: 12, right: 12, left: 0, bottom: 6 }} barCategoryGap={2}
                  onClick={(st) => { const p = st?.activePayload?.[0]?.payload; if (p) pickDay(p.d); }} style={{ cursor: 'pointer' }}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="label" tick={tick} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} width={64} allowDecimals={false} interval={0}
                    ticks={dailyAxis.ticks} domain={dailyAxis.domain} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip labelFormatter={(l, p) => p?.[0]?.payload?.d || l} />
                  <Legend wrapperStyle={{ fontSize: fs(13) }} />
                  {hour?.date && dailyRows.some((r) => r.d === hour.date) && <ReferenceArea x1={hour.date.slice(5)} x2={hour.date.slice(5)} fill="#0F172A" fillOpacity={0.12} />}
                  {series.map((id) => <Bar key={id} dataKey={`L${id}`} name={`Line ${id}`} stackId="a" fill={COLORS[id]} />)}
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty>No scans in this range.</Empty>}
          </Card>

          <Card title={`Hourly production — ${hour?.date || ''}`} sub={hLoading ? 'Loading…' : `Hourly quantity for the day, lines stacked; total on top${moActive ? ' · selected models only' : coActive ? ' · selected companies only' : ''}.`}
            formula="bar = scans in that clock hour · label on top = total of the selected lines">
            {hourRows.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={hourRows} margin={{ top: 22, right: 12, left: 0, bottom: 6 }} barCategoryGap={4}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="label" tick={tick} tickLine={false} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} width={64} allowDecimals={false} interval={0}
                    ticks={hourlyAxis.ticks} domain={hourlyAxis.domain} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: fs(13) }} />
                  {series.map((id) => <Bar key={id} dataKey={`L${id}`} name={`Line ${id}`} stackId="a" fill={COLORS[id]} />)}
                  <Line dataKey="total" stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none">
                    <LabelList dataKey="total" position="top" style={{ fontSize: fs(11), fill: '#334155', fontFamily: '"IBM Plex Mono", ui-monospace, monospace' }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            ) : <Empty>No scans on this day.</Empty>}
          </Card>


          {!simple && (
          <Card title="Top rejection reasons — per line" sub={`${period} · top 5 rejection reasons for each line${coActive ? ' (all companies: rejections have no company)' : ''}.`}
            formula="count of false scans grouped by error message">
            {visT.some((t) => t.top.length) ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {visT.map((t) => (
                  <div key={t.line} className="border border-slate-200 rounded-lg p-2.5">
                    <div className="font-extrabold text-fs-14 mb-1"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: COLORS[t.line] }} />{t.name} <span className="text-slate-600 font-mono text-fs-12">· {nf(t.rej)}</span></div>
                    {t.top.length ? t.top.map((r) => <div key={r.msg} className="flex justify-between gap-2 text-fs-12 border-b border-slate-100 py-1"><span className="text-slate-700 break-words min-w-0">{r.msg}</span><span className="font-mono font-bold">{nf(r.n)}</span></div>) : <div className="text-fs-12 text-slate-600 py-2">No rejections</div>}
                  </div>
                ))}
              </div>
            ) : <Empty>No rejections in this range.</Empty>}
          </Card>
          )}
        </>
      )}
    </div>
  );
}
