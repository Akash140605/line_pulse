import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Boxes, FileSpreadsheet, RefreshCw, Search, X } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { METHOD_DEFAULTS, methodRows } from '../utils/targetMethods';
import { currentRule } from '../hooks/useAutoTargets';
import { addDays, coKey } from '../utils/mainFilter';
import MultiSelect from '../components/MultiSelect';
import CtSummaryDialog from '../components/CtSummaryDialog';

/**
 * Model analysis on the Main (all lines) page: every model of the chosen lines and period with its quantity,
 * quantity after gaps above 22 s are eliminated, Max achieved CT %, Method A / B / C cycle and target —
 * and the CT summary Excel with a choice of customers.
 * Wide screens: one table (sticky header and model column, sortable). Phones: one card per model.
 */
/** The valid-scan window of the target rule (default 1–22 s). */
const vw = () => { const r = currentRule(); return { lo: r.low ?? 1, cap: r.cap ?? METHOD_DEFAULTS.capA }; };
const PERIODS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
const nf = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN'));
const d1 = (v) => (v == null || Number.isNaN(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const sgn = (v, f = (x) => String(x)) => (v == null || Number.isNaN(v) ? '—' : v > 0 ? `+${f(v)}` : f(v));
const dmy = (s) => { const [y, m, d] = String(s || '').split('-'); return d ? `${d}-${m}-${y}` : '—'; };

/* one colour per method, used the same way everywhere on the page */
const M = {
  A: { name: 'Method A', get hint() { const w = vw(); return `most common cycle (gaps ${w.lo}–${w.cap} s) + ${METHOD_DEFAULTS.addA} s = target`; }, band: 'bg-blue-50 text-blue-900', dot: 'bg-blue-600', text: 'text-blue-800' },
  B: { name: 'Method B', get hint() { const w = vw(); return `${METHOD_DEFAULTS.pctB} % of pieces within (valid scans, gaps ${w.lo}–${w.cap} s)`; }, band: 'bg-sky-50 text-sky-900', dot: 'bg-sky-600', text: 'text-sky-800' },
  C: { name: 'Method C', get hint() { const w = vw(); return `control chart average (gaps ${w.lo}–${w.cap} s)`; }, band: 'bg-blue-50 text-blue-900', dot: 'bg-blue-600', text: 'text-blue-800' },
};

const ctl = 'h-9 rounded-lg border border-slate-300 bg-white text-fs-14 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500';
const lbl = 'block text-fs-12 font-semibold uppercase tracking-wide text-slate-500 mb-1';

/* sortable columns: key → value of a row */
const SORT = {
  line: (r) => Number(r.line) || 0, model: (r) => r.model || '', qty: (r) => r.qty, kept: (r) => r.A?.kept ?? -1, share: (r) => r.A?.share ?? -1,
  a: (r) => r.A?.sec ?? 1e9, at: (r) => r.A?.target ?? 1e9, b: (r) => r.B?.sec ?? 1e9, c: (r) => r.C?.sec ?? 1e9,
  ba: (r) => (r.A && r.B ? r.B.sec - r.A.sec : -1e9), ca: (r) => (r.A && r.C ? r.C.sec - r.A.sec : -1e9),
};

function Kpi({ label, value, sub, accent = 'border-l-slate-300' }) {
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${accent} bg-white px-4 py-3 min-w-0`}>
      <div className="text-fs-12 font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-fs-24 leading-tight font-bold text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-fs-13 text-slate-600 break-words">{sub}</div>}
    </div>
  );
}

/** Max CT % (share of the valid scans at the Method A second or faster) */
function Share({ v }) {
  if (v == null) return <span className="text-slate-400">—</span>;
  return <span>{d1(v)}</span>;
}

export default function MainModelsPage({ latestDate }) {
  const [days, setDays] = useState('30');
  const [custom, setCustom] = useState(null);
  const [lineSel, setLineSel] = useState('all');
  const [coSel, setCoSel] = useState([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'qty', dir: -1 });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [ctOpen, setCtOpen] = useState(false);
  const abort = useRef(null);
  const range = useMemo(() => custom || { start: addDays(latestDate, -(Number(days) - 1)), end: latestDate }, [latestDate, days, custom]);

  const load = async (fresh = false) => {
    abort.current?.abort();
    const c = new AbortController(); abort.current = c;
    setLoading(true); setErr('');
    try {
      const j = lineSel === 'all'
        ? await api.controlDataAll(range.start, range.end, { signal: c.signal, fresh })
        : await api.controlData(range.start, range.end, null, { signal: c.signal, fresh }, lineSel);
      if (j?.error) throw new Error(j.error);
      setData({ ...j, models: (j.models || []).map((m) => ({ line: lineSel, ...m })) });
    } catch (e) { if (e.name !== 'AbortError') setErr(String(e.message || e)); } finally { if (abort.current === c) setLoading(false); }
  };
  useEffect(() => { load(false); return () => abort.current?.abort(); }, [range.start, range.end, lineSel]); // eslint-disable-line react-hooks/exhaustive-deps

  const { lo: LOW, cap: CAP } = vw();
  const rowsAll = useMemo(() => methodRows(data?.models, { lowA: LOW, capA: CAP }).filter((r) => r.qty > 0), [data, LOW, CAP]);
  const coOpts = useMemo(() => { const m = new Map(); for (const r of rowsAll) { const k = coKey(r.company); const o = m.get(k) || { value: k, label: k, count: 0, pcs: 0 }; o.count++; o.pcs += r.qty; m.set(k, o); } return [...m.values()].sort((a, b) => b.pcs - a.pcs); }, [rowsAll]);
  const needle = q.trim().toUpperCase();
  const rows = useMemo(() => {
    const f = rowsAll.filter((r) => (!coSel.length || coSel.includes(coKey(r.company))) && (!needle || `${r.model} ${r.modelCode || ''} ${r.company || ''}`.toUpperCase().includes(needle)));
    const get = SORT[sort.key] || SORT.qty;
    return [...f].sort((x, y) => { const a = get(x), b = get(y); return (typeof a === 'string' ? a.localeCompare(b) : a - b) * sort.dir || y.qty - x.qty; });
  }, [rowsAll, coSel, needle, sort]);

  const tot = rows.reduce((s, r) => s + r.qty, 0);
  const totKept = rows.reduce((s, r) => s + (r.A?.kept || 0), 0);
  const withA = rows.filter((r) => r.A?.share != null && r.A?.kept);
  const wShare = withA.length ? withA.reduce((s, r) => s + r.A.share * r.A.kept, 0) / withA.reduce((s, r) => s + r.A.kept, 0) : null;
  const lineText = lineSel === 'all' ? 'All lines' : `Line ${lineSel}`;
  const periodText = custom ? 'Custom dates' : PERIODS.find(([k]) => k === days)?.[1];
  const filtered = coSel.length || needle;

  const Th = ({ k, children, left, className = '' }) => {
    const on = sort.key === k;
    return (
      <th scope="col" aria-sort={on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'} className={`px-2.5 py-2 font-semibold whitespace-nowrap ${left ? 'text-left' : 'text-right'} ${className}`}>
        <button type="button" onClick={() => setSort(on ? { key: k, dir: -sort.dir } : { key: k, dir: k === 'model' || k === 'line' || ['a', 'at', 'b', 'c'].includes(k) ? 1 : -1 })}
          className={`inline-flex items-center gap-1 hover:text-blue-700 ${on ? 'text-slate-900' : ''}`}>
          {children}{on && (sort.dir > 0 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
        </button>
      </th>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {ctOpen && <CtSummaryDialog rows={rows} opts={{ ...METHOD_DEFAULTS, lowA: LOW, capA: CAP }} range={range} lineText={lineText} onClose={() => setCtOpen(false)} />}

      {/* ── title + filters ── */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 px-4 sm:px-5 pt-4">
          <span className="hidden sm:grid h-10 w-10 place-items-center rounded-xl bg-blue-800 text-white shrink-0"><Boxes size={20} aria-hidden /></span>
          <div className="mr-auto min-w-0">
            <p className="text-fs-14 text-slate-600">{periodText} · {dmy(range.start)} to {dmy(range.end)}</p>
          </div>
          <div className="flex w-full sm:w-auto gap-2">
            <button type="button" onClick={() => load(true)} aria-label="Reload" title="Reload" className="inline-flex h-9 w-9 sm:w-auto flex-none items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-semibold text-slate-700 hover:bg-slate-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden /><span className="hidden sm:inline">Reload</span>
            </button>
            <button type="button" disabled={!rows.length} onClick={() => setCtOpen(true)} className="inline-flex h-9 flex-1 sm:flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-700 px-3.5 text-fs-14 font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-50">
              <FileSpreadsheet size={16} aria-hidden /> CT summary Excel
            </button>
          </div>
        </div>
        <HeaderBar label="Model analysis filters">
          <div className={segGroup} role="group" aria-label="Line">
            {[['all', 'All lines'], ...LINE_IDS.map((l) => [l, `Line ${l}`])].map(([k, l]) => <button key={k} type="button" aria-pressed={lineSel === k} onClick={() => setLineSel(k)} className={segBtn(lineSel === k, 'navy')}>{l}</button>)}
          </div>
          <div className={segGroup} role="group" aria-label="Period">
            {PERIODS.map(([k, l]) => <button key={k} type="button" aria-pressed={!custom && days === k} onClick={() => { setCustom(null); setDays(k); }} className={segBtn(!custom && days === k)}>{l}</button>)}
          </div>
          <input type="date" aria-label="From date" value={range.start} max={range.end} onChange={(e) => e.target.value && setCustom({ start: e.target.value, end: range.end })} className={fieldCls} />
          <span className="text-slate-400" aria-hidden>→</span>
          <input type="date" aria-label="To date" value={range.end} max={latestDate} onChange={(e) => e.target.value && setCustom({ start: range.start, end: e.target.value })} className={fieldCls} />
        </HeaderBar>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-start gap-3 border-t border-slate-100 px-4 sm:px-5 py-3.5 bg-slate-50/60 rounded-b-2xl">
          <div className="xl:w-56 [&>div>button]:h-9"><span className={lbl}>Customer</span><MultiSelect label="Customer" options={coOpts} selected={coSel} onChange={setCoSel} /></div>
          <div className="sm:col-span-2 xl:col-span-1 xl:w-64">
            <span className={lbl}>Search</span>
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model, code or customer" aria-label="Search model" className={`${ctl} w-full pl-8 pr-8 font-medium`} />
              {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-500 hover:text-slate-800"><X size={15} /></button>}
            </div>
          </div>
        </div>
      </section>

      {err && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-fs-14 font-semibold text-red-800">{err}</div>}
      {!data && !err && <div className="rounded-2xl border border-slate-200 bg-white shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading the scans of every model…</div>}

      {data && (
        <>
          {/* ── key numbers ── */}
          <section aria-label="Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Models" value={nf(rows.length)} sub={filtered ? `of ${nf(rowsAll.length)} in the period` : `${coOpts.length} customers`} />
            <Kpi label="Qty (pcs)" value={nf(tot)} sub="All scans in the period" />
            <Kpi label={`Qty valid (${LOW}–${CAP} s)`} value={nf(totKept)} sub={tot ? `${d1((totKept / tot) * 100)} % of the qty kept` : ''} accent="border-l-blue-600" />
            <Kpi label="Max achieved CT %" value={wShare == null ? '—' : `${d1(wShare)} %`} sub="Weighted by valid scans" />
          </section>

          {/* ── models ── */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Models">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 sm:px-5 py-3 border-b border-slate-100">
              <h3 className="mr-auto text-fs-16 font-bold text-slate-900">Models <span className="ml-1 text-fs-13 font-semibold text-slate-500">{nf(rows.length)}</span></h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-fs-13 text-slate-600">
                {Object.entries(M).map(([k, m]) => <li key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} aria-hidden /><b className="text-slate-800">{k}</b> {m.hint}</li>)}
              </ul>
            </div>

            {/* wide screens: table */}
            <div className="hidden md:block overflow-auto max-h-[calc(100dvh-260px)] min-h-[320px]">
              <table className="w-full text-fs-14 tabular-nums" aria-label="Model table">
                <thead className="sticky top-0 z-20 text-slate-700">
                  <tr className="text-fs-12 uppercase tracking-wide">
                    <th colSpan={2} className="sticky left-0 z-30 bg-slate-100 px-2.5 py-1.5 text-left font-semibold">Model</th>
                    <th colSpan={3} className="bg-slate-100 px-2.5 py-1.5 text-center font-semibold border-l border-slate-200">Volume</th>
                    {Object.entries(M).map(([k, m]) => <th key={k} colSpan={k === 'A' ? 3 : 2} className={`${m.band} px-2.5 py-1.5 text-center font-bold border-l border-white`}>{m.name}</th>)}
                    <th colSpan={2} className="bg-slate-100 px-2.5 py-1.5 text-center font-semibold border-l border-slate-200">Difference</th>
                  </tr>
                  <tr className="bg-white border-b-2 border-slate-300 text-fs-13 text-slate-600">
                    <Th k="line" left className="sticky left-0 z-30 bg-white w-12">Line</Th>
                    <Th k="model" left className="sticky left-12 z-30 bg-white">Model · customer</Th>
                    <Th k="qty" className="border-l border-slate-200">Qty</Th>
                    <Th k="kept">Qty valid ({LOW}–{CAP} s)</Th>
                    <Th k="share">Max achieved CT %</Th>
                    <Th k="a" className="border-l border-slate-200">Cycle s</Th><Th k="at">Target s (+{METHOD_DEFAULTS.addA})</Th><th scope="col" className="px-2.5 py-2 text-right font-semibold">pcs/hr</th>
                    <Th k="b" className="border-l border-slate-200">Cycle s</Th><th scope="col" className="px-2.5 py-2 text-right font-semibold">pcs/hr</th>
                    <Th k="c" className="border-l border-slate-200">Cycle s</Th><th scope="col" className="px-2.5 py-2 text-right font-semibold">pcs/hr</th>
                    <Th k="ba" className="border-l border-slate-200">B − A</Th>
                    <Th k="ca">C − A (s)</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.line}-${r.mmId}`} className="group border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                      <td className="sticky left-0 z-10 bg-inherit group-hover:bg-blue-50 px-2.5 py-2 font-semibold text-slate-700 whitespace-nowrap">L{r.line}</td>
                      <td className="sticky left-12 z-10 bg-inherit group-hover:bg-blue-50 px-2.5 py-1.5 min-w-[200px]">
                        <div className="font-semibold text-slate-900 whitespace-nowrap">{r.model}{r.modelCode ? <span className="ml-1.5 text-fs-12 font-normal text-slate-500">{r.modelCode}</span> : null}</div>
                        <div className="text-fs-12 text-slate-500">{r.company || 'No company'}</div>
                      </td>
                      <td className="px-2.5 text-right font-semibold text-slate-900 border-l border-slate-100">{nf(r.qty)}</td>
                      <td className="px-2.5 text-right font-bold text-blue-800" title={`scans after gaps below ${LOW} s and above ${CAP} s are eliminated`}>{nf(r.A?.kept)}</td>
                      {r.tooFew ? <td colSpan={10} className="px-2.5 text-slate-500 italic">too few scans for the methods</td> : (
                        <>
                          <td className="px-2.5 text-right text-slate-800"><Share v={r.A?.share} /></td>
                          <td className={`px-2.5 text-right font-bold ${M.A.text} border-l border-slate-100`}>{r.A?.sec ?? '—'}</td><td className="px-2.5 text-right"><span className="rounded bg-blue-100 px-1.5 py-0.5 font-extrabold text-blue-950" title={`target cycle = ${r.A?.sec} s + ${r.A?.add} s`}>{r.A?.target ?? '—'}</span></td><td className="px-2.5 text-right text-slate-700">{nf(r.A?.pph)}</td>
                          <td className={`px-2.5 text-right font-bold ${M.B.text} border-l border-slate-100`}>{r.B?.sec ?? '—'}</td><td className="px-2.5 text-right text-slate-700">{nf(r.B?.pph)}</td>
                          <td className={`px-2.5 text-right font-bold ${M.C.text} border-l border-slate-100`}>{d1(r.C?.sec)}</td><td className="px-2.5 text-right text-slate-700">{nf(r.C?.pph)}</td>
                          <td className="px-2.5 text-right text-slate-700 border-l border-slate-100">{r.A && r.B ? sgn(r.B.sec - r.A.sec) : '—'}</td>
                          <td className="px-2.5 text-right text-slate-700">{r.A && r.C ? sgn(Math.round((r.C.sec - r.A.sec) * 10) / 10, d1) : '—'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={15} className="py-10 text-center text-slate-600">No model in this period{filtered ? ' with this filter' : ''}.</td></tr>}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="sticky bottom-0 z-20">
                    <tr className="bg-blue-800 text-white font-semibold">
                      <td colSpan={2} className="sticky left-0 z-30 bg-blue-800 px-2.5 py-2.5">Total · {nf(rows.length)} models</td>
                      <td className="px-2.5 text-right">{nf(tot)}</td>
                      <td className="px-2.5 text-right text-blue-200 font-bold">{nf(totKept)}</td>
                      <td className="px-2.5 text-right">{d1(wShare)}</td>
                      <td colSpan={9} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* phones: one card per model */}
            <ul className="md:hidden divide-y divide-slate-100" aria-label="Model cards">
              {rows.map((r) => (
                <li key={`${r.line}-${r.mmId}`} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-md bg-slate-900 px-1.5 py-0.5 text-fs-12 font-bold text-white">L{r.line}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 break-words">{r.model}{r.modelCode ? <span className="ml-1.5 text-fs-12 font-normal text-slate-500">{r.modelCode}</span> : null}</div>
                      <div className="text-fs-13 text-slate-500">{r.company || 'No company'}</div>
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center tabular-nums">
                    <div className="rounded-lg bg-slate-50 py-1.5"><dt className="text-fs-11 font-semibold uppercase text-slate-500">Qty</dt><dd className="text-fs-16 font-bold text-slate-900">{nf(r.qty)}</dd></div>
                    <div className="rounded-lg bg-blue-50 py-1.5"><dt className="text-fs-11 font-semibold uppercase text-blue-800">valid {LOW}–{CAP} s</dt><dd className="text-fs-16 font-bold text-blue-900">{nf(r.A?.kept)}</dd></div>
                    <div className="rounded-lg bg-slate-50 py-1.5"><dt className="text-fs-11 font-semibold uppercase text-slate-500">Max CT %</dt><dd className="text-fs-16 font-bold text-slate-900">{d1(r.A?.share)}</dd></div>
                  </dl>
                  {r.tooFew ? <p className="mt-2 text-fs-13 italic text-slate-500">too few scans for the methods</p> : (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-fs-13 tabular-nums">
                      {[['A', r.A?.sec, r.A?.pph, r.A?.target], ['B', r.B?.sec, r.B?.pph], ['C', r.C ? d1(r.C.sec) : null, r.C?.pph]].map(([k, s, p, t]) => (
                        <div key={k} className={`rounded-lg px-2 py-1.5 ${M[k].band}`}>
                          <div className="text-fs-11 font-bold uppercase">{M[k].name}</div>
                          <div className="leading-tight"><b className="text-fs-16">{s ?? '—'}</b> s</div>
                          {t != null && <div className="text-fs-12 font-bold">target {t} s</div>}
                          <div className="text-fs-12 opacity-80">{nf(p)} pcs/hr</div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
              {!rows.length && <li className="py-10 text-center text-slate-600">No model in this period{filtered ? ' with this filter' : ''}.</li>}
              {rows.length > 0 && <li className="bg-slate-900 px-4 py-3 text-white font-semibold flex justify-between"><span>Total</span><span>{nf(tot)} pcs · <span className="text-blue-200">{nf(totKept)}</span> after &gt;{CAP} s</span></li>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
