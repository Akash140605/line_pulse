import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, CheckSquare, Square, RotateCcw, Printer } from 'lucide-react';
import { PageLoader } from '../components/Loader';
import { serverToday } from '../utils/serverTime';
import { useOleLines } from '../components/OleParts';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { loadAutoTargets } from '../hooks/useAutoTargets';
import useUiSettings from '../hooks/useUiSettings';
import { buildHprSheets } from '../utils/hpr';
import { buildKpiXlsx, kpiFileName } from '../utils/kpiReport';
import { reworkXlsxSheet } from '../utils/reworkReport';
import { hprDataOf, kpiDataOf, rwkDataOf } from '../utils/reportData';
import { misData, misSheets, misFileName } from '../utils/qualityMis';
import { loadLastScans } from '../utils/lastScans';
import OleSource from '../components/OleSource';
import { REPORTS, dmy, pad, loadMasterRows, loadTargetRows, tableSheet, cellVal } from '../utils/reportDefs';
import { api } from '../api';
import { useAuth } from '../components/AuthGate';
import { reportsAllowed } from '../utils/uiSettings';
import ReportAccess from '../components/ReportAccess';
import { dprData, dprSheets, dprPrintHtml, custData, custSheets, daysOf, monthLabel, serialBook, serialSheets } from '../utils/prodReports';

/** 23-11-2026: the good scans with their serial numbers of some lines and days (serials.php, read only), 2 at a time */
async function loadSerials(days, ids, onStep) {
  const jobs = days.flatMap((d) => ids.map((l) => [d, l])); const S = {}; let done = 0;
  const one = async ([d, l]) => {
    const rows = []; let after = 0;
    for (let k = 0; k < 40; k += 1) {   // pages of the day (the server answers up to 50 000 rows a page)
      const a = await api.serials(l, d, after);
      rows.push(...(a?.rows || []));
      if (!a?.more || !a.rows?.length) break;
      after = a.lastId;
    }
    S[`${d}|${l}`] = rows; done += 1; onStep?.(done, jobs.length);
  };
  const q = [...jobs];
  await Promise.all([0, 1].map(async () => { while (q.length) await one(q.shift()); }));
  return S;
}

/*
 * Reports: pick a report, the period and the lines, switch columns on / off, see the first rows
 * and download it as Excel (formatted, with a title, filters and frozen header) or CSV. The admin's last choices
 * (columns of each report, lines) are kept in this browser.
 */
const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const inp = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-fs-13 font-semibold text-slate-900';
const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-fs-13 font-bold transition disabled:opacity-50';
const STORE = 'ems.reports';

const SRC_NAME = { oleDay: 'OLE', targets: 'Target' };

const readSaved = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };

export default function ReportsPage() {
  const today = serverToday();
  const ALL = useOleLines();
  const saved = readSaved();
  // 23-11-2026: the reports this login may open (the admin chooses them per login — "Who sees which report")
  const me = useAuth() || {};
  const isAdmin = me.role === 'admin';
  const { ui, save: saveUi } = useUiSettings();
  const allowed = reportsAllowed(ui, me.user, isAdmin);
  const LIST = allowed ? REPORTS.filter((r) => allowed.includes(r.id)) : REPORTS;
  const [rid0, setRid] = useState(saved.rid && REPORTS.some((r) => r.id === saved.rid) ? saved.rid : 'oleDay');
  const rid = LIST.some((r) => r.id === rid0) ? rid0 : (LIST[0]?.id || 'oleDay');
  const rep = REPORTS.find((r) => r.id === rid);
  const [access, setAccess] = useState(false);   // admin: the "who sees which report" table
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [lines, setLines] = useState(() => (Array.isArray(saved.lines) && saved.lines.length ? saved.lines.filter((l) => ALL.includes(l)) : ALL));
  const [colsBy, setColsBy] = useState(() => saved.cols || {});
  const [made, setMade] = useState(null);   // { rid, from, to, lines } of the report on the screen
  const [ctx, setCtx] = useState(null);
  const [auto, setAuto] = useState(null);   // HPR: the automatic targets (the line screens' targets in force)
  const [err, setErr] = useState('');
  const [step, setStep] = useState('');   // serial numbers: line-days read so far
  const hprSet = ui.hpr || { rate: 65, otFrom: '18:00', otX: 2 };
  const on = colsBy[rid] || rep.cols.map((c) => c[0]);
  const keep = (patch) => { try { localStorage.setItem(STORE, JSON.stringify({ ...readSaved(), ...patch })); } catch { /* storage blocked */ } };
  const setCols = (list) => { const n = { ...colsBy, [rid]: list }; setColsBy(n); keep({ cols: n }); };
  useEffect(() => { keep({ rid, lines }); }, [rid, lines.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const quick = [
    ['This month', `${today.slice(0, 8)}01`, today],
    ['Last month', (() => { const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; })(), (() => { const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })()],
    ['Today', today, today],
    ['01-08 → 31-10', `${today.slice(0, 4)}-08-01`, `${today.slice(0, 4)}-10-31`],
  ];
  const ids = useMemo(() => ALL.filter((l) => lines.includes(l)), [ALL.join(), lines.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const longRange = (new Date(to) - new Date(from)) / 86400000 > 100;

  const make = async () => {
    setErr(''); setCtx(null); setStep('');
    if (from > to) { setErr('"From" is after "To"'); return; }
    if (rep.maxDays && daysOf(from, to).length > rep.maxDays) { setErr(`This report is made for up to ${rep.maxDays} days at a time — select a shorter period.`); return; }
    const m = { rid, from, to, lines: ids };
    setMade(m);
    try {
      if (rep.hpr || rep.kpi) setAuto(await loadAutoTargets(false).catch(() => ({})) || {});
      if (rep.src === 'master') setCtx({ M: await loadMasterRows(ids) });
      else if (rep.src === 'targets') setCtx({ T: await loadTargetRows(ids) });
    } catch (e) { setErr(`Report could not be made: ${e.message}`); }
  };
  const needOle = made && REPORTS.find((r) => r.id === made.rid)?.src === 'ole';
  // HPR / KPI (21-11-2026): the day's last hour is counted only up to the line's actual last scan, read before the report is made
  const oleSeq = React.useRef(0);
  const onOle = async (c, e) => {
    if (e) setErr(e);
    if (!c) return;
    if (rep.dpr || rep.srl) {   // 23-11-2026: the serial numbers of every line and day (25-11-2026: also the serial list)
      const n = ++oleSeq.current;
      try {
        const S = await loadSerials(daysOf(made.from, made.to), made.lines, (k, all) => setStep(`${k} of ${all} line-days read`));
        if (n === oleSeq.current) setCtx({ ...c, S });
      } catch (e2) { if (n === oleSeq.current) setErr(`Serial numbers could not be read: ${e2.message}`); }
      return;
    }
    if (!(rep.hpr || rep.kpi)) { setCtx(c); return; }
    const n = ++oleSeq.current;
    const lastScans = await loadLastScans(c, today).catch(() => ({}));
    if (n === oleSeq.current) setCtx({ ...c, lastScans });   // only the newest read lands
  };
  // HPR / SAWM KPI / hourly rework data: the plant-layout reports (utils/reportData.js, shared with Report compare)
  const hprData = useMemo(() => (rep.hpr ? hprDataOf(ctx, auto, hprSet) : null), [ctx, auto, rep.hpr, JSON.stringify(hprSet)]); // eslint-disable-line react-hooks/exhaustive-deps
  const kpiData = useMemo(() => (rep.kpi ? kpiDataOf(ctx, auto) : null), [ctx, auto, rep.kpi]);
  const rwkData = useMemo(() => ((rep.rwk || rep.mis) && made ? rwkDataOf(ctx, made.from, made.to) : null), [ctx, made, rep.rwk, rep.mis]);
  // 25-11-2026: Quality MIS (IPQC daily, top defects with RCA, summary, hourly rework)
  const misD = useMemo(() => (rep.mis && made && rwkData && ctx?.R ? misData({ W: rwkData, R: ctx.R, ids: (made.lines || ctx.ids || []).map(String), rca: ctx.D?.ent?.rca || {}, from: made.from, to: made.to }) : null), [rep.mis, made, rwkData, ctx]);
  const dprD = useMemo(() => (rep.dpr && made && ctx?.S ? dprData(ctx.S, { from: made.from, to: made.to, ids: made.lines }) : null), [ctx, made, rep.dpr]);
  const custD = useMemo(() => (rep.cust && made && ctx?.R ? custData(ctx, made.from, made.to) : null), [ctx, made, rep.cust]);
  // 25-11-2026: Daily production — serial list (Summary + one sheet per line), one brand or all
  const [srlBrand, setSrlBrand] = useState('');
  const srlD = useMemo(() => (rep.srl && made && ctx?.S ? serialBook(ctx.S, { from: made.from, to: made.to, ids: made.lines, brand: srlBrand }) : null), [ctx, made, rep.srl, srlBrand]);
  // 23-11-2026: the serial pieces of a line-day against the pieces of the OLE screens (both from the good scans)
  const dprCheck = useMemo(() => {
    if (!dprD || !ctx?.R) return [];
    const out = [];
    for (const d of ctx.R.days || []) for (const l of made.lines) {
      const ole = (d.byLine?.[l]?.rows || []).reduce((a, r) => a + (r.future ? 0 : r.qty || 0), 0);
      const sr = dprD.find((x) => x.date === d.date && x.line === String(l))?.total || 0;
      if (ole !== sr) out.push(`Line ${l} ${dmy(d.date)}: ${sr} serials vs ${ole} pcs`);
    }
    return out;
  }, [dprD, ctx, made]);
  const rows = useMemo(() => {
    if (!made || !ctx || made.rid !== rid) return null;
    if ((rep.hpr || rep.kpi) && !auto) return null;
    if (rep.dpr && !dprD) return null;
    if (rep.srl && !srlD) return null;
    try { return rep.rows(rep.hpr ? { ...ctx, H: hprData } : rep.kpi ? { ...ctx, K: kpiData } : rep.rwk ? { ...ctx, W: rwkData } : rep.mis ? { ...ctx, M: misD } : rep.dpr ? { ...ctx, P: dprD } : rep.srl ? { ...ctx, B: srlD } : rep.cust ? { ...ctx, C: custD } : ctx); } catch (e) { return []; }
  }, [ctx, made, rid, auto, hprData, kpiData, rwkData, misD, dprD, custD]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = rep.cols.filter((c) => on.includes(c[0]));
  const val = cellVal;
  const title = `${rep.name} · ${rep.src === 'ole' ? `${dmy(made?.from)} to ${dmy(made?.to)} · ` : ''}${(made?.lines || []).length === ALL.length ? 'All lines' : (made?.lines || []).map((l) => `Line ${l}`).join(', ')}`;
  const fileBase = `${rep.name.replace(/[^A-Za-z0-9 &-]/g, '').replace(/\s+/g, ' ').trim()} ${rep.src === 'ole' ? `${made?.from} to ${made?.to}` : today}`;

  // 23-11-2026: Daily production report on paper — one A4 page per line and day, printed from a hidden frame
  const printDpr = () => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const doc = f.contentWindow.document; doc.open(); doc.write(dprPrintHtml(dprD || [])); doc.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 60000); } }, 300);
  };
  const excel = () => {
    if (rep.hpr) { downloadXlsx(buildXlsx(buildHprSheets(hprData || [], hprSet)), `HPR ${made?.from} to ${made?.to}.xlsx`); return; }
    if (rep.kpi) { downloadXlsx(buildKpiXlsx(kpiData || []), kpiFileName(made?.to || today)); return; }
    if (rep.dpr) { downloadXlsx(buildXlsx(dprSheets(dprD || [])), `Daily production report ${made?.from} to ${made?.to}.xlsx`); return; }
    if (rep.srl) { downloadXlsx(buildXlsx(serialSheets(srlD || { lines: [], total: 0 })), `Daily_Production_Lines${(made?.lines || []).join('')}_${made?.from}${made?.to !== made?.from ? `_${made?.to}` : ''}${srlBrand ? `_${srlD?.brand}` : ''}.xlsx`); return; }
    if (rep.cust) { downloadXlsx(buildXlsx(custSheets(custD || {})), `Customer_wise_production_${monthLabel(made?.from || today)}${made?.from?.slice(0, 7) !== made?.to?.slice(0, 7) ? ` to ${monthLabel(made?.to)}` : ''}.xlsx`); return; }
    if (rep.mis) { if (misD) downloadXlsx(buildXlsx(misSheets(misD, rwkData)), misFileName(made.to)); return; }
    if (rep.rwk) { downloadXlsx(buildXlsx([reworkXlsxSheet(rwkData || { rows: [], hours: [], totals: { total: 0, rs: 0, hours: {} } })]), `Hourly rework data ${made?.from} to ${made?.to}.xlsx`); return; }
    downloadXlsx(buildXlsx([tableSheet(rep, rows, cols, title, `Dixon Line Pulse · made ${dmy(today)} · ${rows.length} rows`)]), `${fileBase}.xlsx`);
  };
  const csv = () => {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [cols.map((c) => q(c[1])).join(','), ...rows.map((r) => cols.map((c) => q(val(c, r))).join(','))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = `${fileBase}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="flex flex-col gap-3" aria-label="Reports page">
      {needOle && <OleSource key={`${made.from}|${made.to}|${made.lines.join()}`} start={made.from} end={made.to} ids={made.lines} onReady={onOle} />}
      {isAdmin && (
        <div className="flex justify-end">
          <button type="button" aria-expanded={access} onClick={() => setAccess((v) => !v)} className={`${btn} ${access ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}>
            {access ? 'Close' : 'Who sees which report'}</button>
        </div>
      )}
      {isAdmin && access && <ReportAccess ui={ui} save={saveUi} reports={REPORTS} />}
      {!LIST.length && <div className={`${card} p-4 text-fs-14 font-semibold text-slate-600`}>No report is open for this login — the administrator chooses them (Reports → Who sees which report).</div>}
      {LIST.length > 0 && <>
      <section className={`${card} p-4`}>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Report">
          {LIST.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={rid === r.id} onClick={() => { setRid(r.id); setCtx(null); setMade(null); }}
              className={`rounded-lg border p-3 text-left transition ${rid === r.id ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-600' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <div className="flex items-center gap-2 text-fs-14 font-extrabold text-slate-900"><FileSpreadsheet size={16} className="text-blue-700" />{r.name}</div>
              <div className="mt-0.5 text-fs-12 text-slate-600">{r.about}</div>
            </button>
          ))}
        </div>
      </section>

      <section className={`${card} p-4`} aria-label="Report settings">
        <div className="flex flex-wrap items-end gap-3">
          {rep.src === 'ole' && (
            <>
              <label className="text-fs-13 font-bold text-slate-700">From<input type="date" aria-label="From" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={`${inp} mt-1 block`} /></label>
              <label className="text-fs-13 font-bold text-slate-700">To<input type="date" aria-label="To" value={to} max={today} onChange={(e) => setTo(e.target.value)} className={`${inp} mt-1 block`} /></label>
              <div className="flex flex-wrap gap-1">{quick.map(([l, a, b]) => <button key={l} type="button" onClick={() => { setFrom(a); setTo(b > today ? today : b); }} className={`${btn} h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 ${from === a && to === (b > today ? today : b) ? 'border-blue-600 text-blue-800' : ''}`}>{l}</button>)}</div>
            </>
          )}
          {ALL.length > 1 && (
            <div className="text-fs-13 font-bold text-slate-700">Lines
              <div className="mt-1 flex gap-1" role="group" aria-label="Lines">
                {ALL.map((l) => { const o = lines.includes(l); return <button key={l} type="button" aria-pressed={o} onClick={() => setLines(o ? lines.filter((x) => x !== l) : [...lines, l])} className={`${btn} ${o ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>Line {l}</button>; })}
              </div>
            </div>
          )}
          <button type="button" onClick={make} disabled={!ids.length} className={`${btn} ml-auto border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}>Make report</button>
        </div>
        {rep.src === 'ole' && longRange && <p className="mt-2 text-fs-12 font-semibold text-amber-800">A long period may take longer to load.</p>}
        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-fs-13 font-bold text-slate-700">Columns
            <button type="button" className="text-fs-12 font-bold text-blue-700 hover:underline" onClick={() => setCols(rep.cols.map((c) => c[0]))}>All</button>
            <button type="button" className="text-fs-12 font-bold text-blue-700 hover:underline" onClick={() => setCols(rep.cols.slice(0, 2).map((c) => c[0]))}>None</button>
            <button type="button" className="inline-flex items-center gap-1 text-fs-12 font-bold text-slate-500 hover:underline" onClick={() => setCols(rep.cols.map((c) => c[0]))}><RotateCcw size={12} />Default</button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Columns">
            {rep.cols.map((c) => { const o = on.includes(c[0]); return (
              <button key={c[0]} type="button" aria-pressed={o} onClick={() => setCols(o ? on.filter((x) => x !== c[0]) : rep.cols.map((y) => y[0]).filter((k) => k === c[0] || on.includes(k)))}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-fs-12 font-bold ${o ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-400'}`}>{o ? <CheckSquare size={13} /> : <Square size={13} />}{c[1]}</button>
            ); })}
          </div>
        </div>
      </section>

      {err && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
      {made && !rows && !err && <PageLoader label={`Making "${rep.name}"`} sub={rep.src === 'ole' ? `${dmy(made.from)} to ${dmy(made.to)}${(rep.dpr || rep.srl) && step ? ` · serial numbers: ${step}` : ''}` : ''} steps={['Connecting to the server', 'Reading the data', 'Working out the report', 'Preparing the table']} />}
      {rows && (
        <section className={`${card} p-4`} aria-label="Report preview">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-fs-16 font-extrabold text-slate-900">{title}</h3>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-fs-12 font-bold text-slate-700">{rows.length} rows · {cols.length} columns</span>
            {rep.dpr && dprD && <span className="rounded bg-sky-50 px-2 py-0.5 text-fs-12 font-bold text-sky-800">{dprD.length} sheets (one per line and day) · {dprD.reduce((a, d) => a + d.total, 0).toLocaleString('en-IN')} pcs</span>}
            {rep.srl && srlD && <span className="rounded bg-sky-50 px-2 py-0.5 text-fs-12 font-bold text-sky-800" data-testid="srl-info">Summary + {srlD.lines.filter((l) => l.total).length} line sheets · {srlD.total.toLocaleString('en-IN')} scans</span>}
            {rep.srl && srlD && <label className="inline-flex items-center gap-1.5 text-fs-12 font-bold text-slate-700">Brand
              <select data-testid="srl-brand" value={srlBrand} onChange={(e) => setSrlBrand(e.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-fs-13 font-semibold">
                <option value="">All brands</option>{srlD.brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select></label>}
            {rep.cust && custD && <span className="rounded bg-sky-50 px-2 py-0.5 text-fs-12 font-bold text-sky-800">Summery + {custD.customers.length} customer sheets · {custD.total.toLocaleString('en-IN')} pcs</span>}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={excel} disabled={!rows.length || !cols.length} className={`${btn} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`}><Download size={15} />Excel</button>
              <button type="button" onClick={csv} disabled={!rows.length || !cols.length} className={`${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}><FileText size={15} />CSV</button>
              {rep.dpr && dprD && <button type="button" onClick={printDpr} disabled={!dprD.length} className={`${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`} data-testid="dpr-print"><Printer size={15} />Print</button>}
            </div>
          </div>
          {rep.dpr && dprCheck.length > 0 && <p className="mt-2 text-fs-12 font-semibold text-amber-800" data-testid="dpr-check">Pieces differ from the line screens (a piece without a serial, or a serial scanned twice): {dprCheck.join(' · ')}</p>}
          {!rows.length ? <p className="mt-3 text-fs-14 text-slate-500">Nothing in this period for these lines.</p> : (
            <div className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-fs-13">
                <thead className="sticky top-0 bg-slate-100"><tr>{cols.map((c) => <th key={c[0]} className="whitespace-nowrap px-2 py-1.5 text-left font-bold text-slate-600">{c[1]}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i} className="border-t border-slate-100">{cols.map((c) => { const v = val(c, r); return <td key={c[0]} className={`whitespace-nowrap px-2 py-1 ${['int', 'dec1'].includes(c[3]) ? 'text-right font-mono' : ''} ${c[3] === 'textBold' ? 'font-bold' : ''}`}>{v ?? '—'}</td>; })}</tr>)}</tbody>
              </table>
              {rows.length > 200 && <div className="bg-slate-50 px-3 py-1.5 text-fs-12 font-semibold text-slate-500">First 200 rows shown — the download has all {rows.length}.</div>}
            </div>
          )}
        </section>
      )}
      </>}
    </div>
  );
}
export { SRC_NAME };
