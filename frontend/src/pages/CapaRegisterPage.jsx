import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Download, Search, X, Settings2, RefreshCw, Camera } from 'lucide-react';
import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { api } from '../api';
import { serverToday } from '../utils/serverTime';
import { KIND_TEXT, rcaStatus } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { nf, dmy, StatusChip, useOleLines, inp } from '../components/OleParts';
import useUiSettings from '../hooks/useUiSettings';
import { capaHead, capaPdf, capaFileName, downloadBlob, registerRows, registerTotals, capaOverdue, IMPL_TEXT } from '../utils/capaForm';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { RcaDialog } from './RcaPage';

/**
 * CAPA register (24-11-2026, admin): every RCA with its Corrective and Preventive Action Plan — open / closed / overdue,
 * the form as PDF (one, or all shown in one file, with the evidence photos), Excel of the list, and the form header
 * (doc no, revision) as on the plant's paper.
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00`); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

function Tile({ name, value, sub, tone = 'text-slate-900', on, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`min-w-0 rounded-xl border bg-white p-3 text-left shadow-sm hover:border-blue-400 ${on ? 'border-blue-600 ring-2 ring-blue-200' : 'border-slate-200'}`}>
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className={`mt-1 font-mono text-fs-28 font-extrabold leading-tight tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-fs-12 text-slate-600">{sub}</div>}
    </button>
  );
}

export default function CapaRegisterPage() {
  const IDS = useOleLines();
  const today = serverToday();
  const { ui, save: saveUi } = useUiSettings();
  const head = capaHead(ui.capa);
  const [preset, setPreset] = useState('3m');
  const [from, setFrom] = useState(addDays(today, -90));
  const [to, setTo] = useState(today);
  const [line, setLine] = useState('all');
  const [dept, setDept] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [rca, setRca] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [pdfBusy, setPdfBusy] = useState('');
  const [headOpen, setHeadOpen] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try { const j = await api.oleEntries(from, to); setRca(j?.rca || {}); }
    catch (e) { setErr(`Could not read the RCAs: ${e.message}`); setRca((x) => x || {}); }
    finally { setBusy(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  const pick = (p) => {
    setPreset(p);
    if (p === 'month') { setFrom(`${today.slice(0, 8)}01`); setTo(today); }
    if (p === '3m') { setFrom(addDays(today, -90)); setTo(today); }
    if (p === 'year') { setFrom(`${today.slice(0, 4)}-01-01`); setTo(today); }
    if (p === 'all') { setFrom('2020-01-01'); setTo(today); }
  };

  const base = useMemo(() => registerRows(rca || {}, { from, to, line, today }, deptName), [rca, from, to, line, today]);
  const depts = useMemo(() => [...new Set(base.map((r) => deptName(r.dept)).filter(Boolean))].sort(), [base]);
  const rows = useMemo(() => registerRows(rca || {}, { from, to, line, dept, status, q, today }, deptName), [rca, from, to, line, dept, status, q, today]);
  const T = registerTotals(base.filter((r) => dept === 'all' || deptName(r.dept).toLowerCase() === dept.toLowerCase()), today);

  const pdfOf = async (list, name, key) => {
    setPdfBusy(key); setErr('');
    try { downloadBlob(await capaPdf(list, head, api.fileUrl), name); }
    catch (e) { setErr(`PDF could not be made: ${e.message}`); } finally { setPdfBusy(''); }
  };
  const excel = () => {
    const H = ['Date', 'Line', 'Type', 'Reason', 'Department', 'Equipment', 'Hall', 'Problem', 'Correction', 'Why 1', 'Why 2', 'Why 3', 'Why 4', 'Why 5', 'Root cause', 'Corrective action', 'CA target', 'CA responsibility',
      'Preventive action', 'PA target', 'PA responsibility', 'Status', 'Overdue', 'Implemented', 'Verified by', 'Verified on', 'Close date', 'Photos / files', 'Last saved'];
    const body = rows.map((r) => { const c = r.capa || {}; return [dmy(r.date), `Line ${r.line}`, KIND_TEXT[r.kind] || r.kind, r.reason, deptName(r.dept), c.equip || '', c.hall || '', c.problem || '', c.correction || '',
      ...[0, 1, 2, 3, 4].map((k) => [c.whyQ?.[k], r.whys?.[k]].filter(Boolean).join(' → ')), r.rootCause || '', r.action || '', dmy(c.caTarget || r.targetDate), c.caResp || r.owner || '',
      r.preventive || '', dmy(c.paTarget), c.paResp || '', r.status === 'closed' ? 'Closed' : 'Open', capaOverdue(r, today) ? 'Yes' : '', IMPL_TEXT[c.implemented || ''] || '', c.verifiedBy || '', dmy(c.verifyDate), dmy(r.closeDate),
      (r.evidence || []).length, `${r.updatedBy || ''} ${r.updatedAt || ''}`.trim()]; });
    downloadXlsx(buildXlsx([{ name: 'CAPA register', title: `CAPA register ${dmy(from)} – ${dmy(to)}`, cols: H.map((h) => ({ width: /action|cause|Problem|Correction|Why/.test(h) ? 34 : h === 'Reason' ? 26 : 13 })),
      rows: [H.map((v) => ({ v, s: 'hprHead' })), ...body.map((r) => r.map((v) => ({ v, s: typeof v === 'number' ? 'hprInt' : 'hprText' })))] }]), `CAPA_register_${from}_${to}.xlsx`);
  };
  const statuses = [['all', 'All', T.all], ['open', 'Open', T.open], ['overdue', 'Overdue', T.overdue], ['closed', 'Closed', T.closed], ['verified', 'Verified', T.verified]];

  return (
    <div className="flex flex-col gap-3" role="region" aria-label="CAPA register">
      <HeaderBar label="CAPA register filters">
        <div className={segGroup} role="group" aria-label="Period">
          {[['month', 'This month'], ['3m', '3 months'], ['year', 'This year'], ['all', 'All']].map(([k, t]) => <button key={k} type="button" aria-pressed={preset === k} onClick={() => pick(k)} className={segBtn(preset === k, 'navy')}>{t}</button>)}
        </div>
        <input type="date" className={fieldCls} value={from} max={to} onChange={(e) => { setPreset(''); e.target.value && setFrom(e.target.value); }} aria-label="From" />
        <input type="date" className={fieldCls} value={to} min={from} max={today} onChange={(e) => { setPreset(''); e.target.value && setTo(e.target.value); }} aria-label="To" />
        <div className={segGroup} role="group" aria-label="Lines">
          <button type="button" aria-pressed={line === 'all'} onClick={() => setLine('all')} className={segBtn(line === 'all', 'navy')}>All lines</button>
          {IDS.map((l) => <button key={l} type="button" aria-pressed={line === l} onClick={() => setLine(l)} className={segBtn(line === l, 'navy')}>Line {l}</button>)}
        </div>
        <button type="button" onClick={load} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60" aria-label="Read again"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden /></button>
      </HeaderBar>

      {err && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
      {!rca ? <PageLoader label="Reading the RCAs" sub={`${dmy(from)} – ${dmy(to)}`} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Tile name="All RCAs" value={nf(T.all)} sub={`${dmy(from)} – ${dmy(to)}`} on={status === 'all'} onClick={() => setStatus('all')} />
            <Tile name="Open" value={nf(T.open)} sub="submitted, action not closed" tone="text-amber-700" on={status === 'open'} onClick={() => setStatus('open')} />
            <Tile name="Overdue" value={nf(T.overdue)} sub="past the corrective target date" tone={T.overdue ? 'text-red-700' : 'text-slate-900'} on={status === 'overdue'} onClick={() => setStatus('overdue')} />
            <Tile name="Closed" value={nf(T.closed)} sub={T.all ? `${Math.round((T.closed / T.all) * 100)}% of the RCAs` : '—'} tone="text-emerald-700" on={status === 'closed'} onClick={() => setStatus('closed')} />
            <Tile name="Verified" value={nf(T.verified)} sub={`${nf(T.photos)} with photo / file evidence`} tone="text-blue-700" on={status === 'verified'} onClick={() => setStatus('verified')} />
          </div>

          <section className={card} aria-label="CAPA list">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Corrective &amp; preventive action plans</h3>
              <span className="text-fs-13 text-slate-600">{nf(rows.length)} shown</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <select className={fieldCls} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" style={{ minWidth: 170 }}>
                  <option value="all">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <div className={segGroup} role="group" aria-label="Status">
                  {statuses.map(([k, t, n]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={segBtn(status === k, 'navy')}>{t} <span className="ml-1" style={{ opacity: 0.75 }}>{n}</span></button>)}
                </div>
                <label className="relative inline-flex items-center">
                  <Search size={14} className="pointer-events-none absolute left-2 text-slate-500" aria-hidden />
                  <input className={fieldCls} style={{ paddingLeft: 26, width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reason, cause, action…" aria-label="Search" />
                  {q && <button type="button" onClick={() => setQ('')} className="absolute right-1.5 text-slate-500" aria-label="Clear search"><X size={14} /></button>}
                </label>
                <button type="button" disabled={!rows.length || !!pdfBusy} onClick={() => pdfOf(rows.slice(0, 40), `CAPA_${from}_${to}.pdf`, 'all')} title="All shown RCAs in one PDF (first 40), each with its photos"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-fs-13 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50" style={{ borderColor: '#B91C1C' }}><FileDown size={14} aria-hidden />{pdfBusy === 'all' ? 'Making…' : `PDF (${Math.min(40, rows.length)})`}</button>
                <button type="button" disabled={!rows.length} onClick={excel} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-700 px-2.5 text-fs-13 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"><Download size={14} aria-hidden />Excel</button>
                <button type="button" onClick={() => setHeadOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-semibold text-slate-700 hover:bg-slate-100"><Settings2 size={14} aria-hidden />Form header</button>
              </div>
            </div>
            {!rows.length ? <p className="py-6 text-center text-fs-14 text-slate-500">No RCA in this period with these filters.</p> : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-fs-13" aria-label="CAPA register table">
                  <thead className="bg-dixon-navy text-white">
                    <tr>{['Date', 'Line', 'Reason', 'Department', 'Root cause', 'Corrective action', 'Target · Resp.', 'Status', 'Verified', ''].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2.5 py-2 text-left font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const c = r.capa || {}; const late = capaOverdue(r, today); const ev = (r.evidence || []).length;
                      return (
                        <tr key={r.key} className="border-t border-slate-100 align-top hover:bg-sky-50">
                          <td className="whitespace-nowrap px-2.5 py-2 font-bold">{dmy(r.date)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2">Line {r.line}</td>
                          <td className="px-2.5 py-2" style={{ minWidth: 150 }}><div className="font-bold text-slate-900">{r.reason}</div><div className="text-fs-12 text-slate-500">{KIND_TEXT[r.kind]}{c.equip ? ` · ${c.equip}` : ''}</div></td>
                          <td className="whitespace-nowrap px-2.5 py-2">{deptName(r.dept)}</td>
                          <td className="px-2.5 py-2 text-slate-700" style={{ minWidth: 180, maxWidth: 320 }}><span className="lp-clamp2">{r.rootCause || '—'}</span></td>
                          <td className="px-2.5 py-2 text-slate-700" style={{ minWidth: 180, maxWidth: 320 }}><span className="lp-clamp2">{r.action || '—'}</span></td>
                          <td className="whitespace-nowrap px-2.5 py-2"><span className={late ? 'font-bold text-red-700' : ''}>{dmy(c.caTarget || r.targetDate) || '—'}</span><div className="text-fs-12 text-slate-500">{c.caResp || r.owner || ''}</div></td>
                          <td className="whitespace-nowrap px-2.5 py-2"><StatusChip st={rcaStatus(r)} />{late && <div className="mt-1 text-fs-12 font-bold text-red-700">Overdue</div>}</td>
                          <td className="whitespace-nowrap px-2.5 py-2">{c.implemented ? <span className={`font-semibold ${c.implemented === 'yes' ? 'text-emerald-700' : c.implemented === 'no' ? 'text-red-700' : 'text-amber-700'}`}>{IMPL_TEXT[c.implemented].split(' —')[0]}</span> : <span className="text-slate-400">—</span>}
                            {c.verifiedBy && <div className="text-fs-12 text-slate-500">{c.verifiedBy}</div>}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {ev > 0 && <span className="inline-flex items-center gap-1 text-fs-12 font-semibold text-slate-600" title={`${ev} evidence file${ev > 1 ? 's' : ''}`}><Camera size={13} aria-hidden />{ev}</span>}
                              <button type="button" onClick={() => setOpen(r)} className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-800 hover:bg-slate-100">Open</button>
                              <button type="button" disabled={!!pdfBusy} onClick={() => pdfOf([r], capaFileName(r), r.key)} className="inline-flex h-8 items-center gap-1 rounded-md bg-red-700 px-2.5 text-fs-13 font-bold text-white disabled:opacity-60"><FileDown size={13} aria-hidden />{pdfBusy === r.key ? '…' : 'PDF'}</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {open && <RcaDialog i={{ date: open.date, line: open.line, kind: open.kind, reason: open.reason, dept: open.dept, hours: [], models: [], value: null }} x={open} canWrite isAdmin
        onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await load(); }} />}
      {headOpen && <HeadDialog head={head} onClose={() => setHeadOpen(false)} onSave={async (h) => { await saveUi({ ...ui, capa: h }); setHeadOpen(false); }} />}
    </div>
  );
}

function HeadDialog({ head, onClose, onSave }) {
  const [h, setH] = useState(head);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const F = [['company', 'Company', 80], ['title', 'Form title', 80], ['docNo', 'Doc. no', 40], ['revNo', 'Revise no.', 10], ['revDate', 'Rev. date', 20], ['hall', 'Hall no. (filled on a new form)', 40]];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(15,23,42,.5)' }} role="dialog" aria-modal="true" aria-label="CAPA form header">
      <div className="w-full rounded-xl bg-white p-4 shadow-xl" style={{ maxWidth: 520 }}>
        <h3 className="text-fs-16 font-extrabold text-dixon-navy">CAPA form header</h3>
        <p className="mb-3 text-fs-13 text-slate-600">Printed on top of every CAPA PDF, as on the plant's paper form.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {F.map(([k, t, max]) => <label key={k} className={`grid gap-1 text-fs-13 font-bold text-slate-700 ${k === 'company' || k === 'title' ? 'sm:col-span-2' : ''}`}>{t}<input className={inp} value={h[k]} maxLength={max} onChange={(e) => setH((o) => ({ ...o, [k]: e.target.value }))} /></label>)}
        </div>
        {err && <div role="alert" className="mt-2 rounded bg-red-50 px-2 py-1 text-fs-13 font-semibold text-red-800">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700">Cancel</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { await onSave(capaHead(h)); } catch (e) { setErr(e.message); setBusy(false); } }} className="h-9 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white disabled:opacity-60">Save</button>
        </div>
      </div>
    </div>
  );
}
