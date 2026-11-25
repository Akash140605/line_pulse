import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search, PackageCheck, Barcode, Boxes, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import HeaderBar, { segGroup, segBtn, arrowBtn, fieldCls } from '../components/HeaderBar';
import { api, LINE_IDS } from '../api';
import { serverToday } from '../utils/serverTime';
import { addDays } from '../utils/mainFilter';
import { card, nf, dmy } from '../components/OleParts';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { mergeRows, totals, byModel, filterRows, duplicateSerials, byHour, serialSheets } from '../utils/serials';

/**
 * Carton & serial report (23-11-2026): every piece of the day with its serial number (ProductBarcode), carton number
 * (CartonBarcode) and component barcode — all lines or one line. Today's list grows by itself (every 20 s only the new
 * scans are read, the page is never reloaded). Download: the Excel file of the day (Serial & carton + By model).
 */
const POLL_MS = 20_000;
const PAGE = 300;   // rows drawn at a time in the preview (the Excel has them all)

export default function SerialsPage() {
  const today = serverToday();
  const [date, setDate] = useState(today);
  const [line, setLine] = useState('all');
  const [data, setData] = useState({ key: '', rows: [], last: {}, err: {}, at: null });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [model, setModel] = useState('');
  const [show, setShow] = useState(PAGE);
  const ids = line === 'all' ? LINE_IDS : [line];
  const key = `${date}|${ids.join(',')}`;
  const keyRef = useRef(key); keyRef.current = key;
  const lastRef = useRef({});

  // the whole day of every line asked for; then (today) only the new scans of each line
  const load = async (more) => {
    const k = key;
    if (!more) setBusy(true);
    const res = await Promise.allSettled(ids.map((l) => api.serials(l, date, more ? (lastRef.current[l] || 0) : 0)));
    if (keyRef.current !== k) return;
    setData((d) => {
      let rows = more && d.key === k ? d.rows : [];
      const last = more && d.key === k ? { ...d.last } : {}, err = {};
      res.forEach((r, i) => {
        const l = ids[i];
        if (r.status !== 'fulfilled') { err[l] = String(r.reason?.message || r.reason || 'No answer'); return; }
        rows = mergeRows(rows, (r.value?.rows || []).map((x) => ({ ...x, line: l })));
        last[l] = Math.max(last[l] || 0, Number(r.value?.lastId) || 0);
      });
      lastRef.current = last;
      return { key: k, rows, last, err, at: new Date() };
    });
    if (!more) setBusy(false);
  };
  useEffect(() => { lastRef.current = {}; setShow(PAGE); setModel(''); load(false); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (date !== today) return undefined;
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [key, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data.key === key ? data.rows : [];
  const T = useMemo(() => totals(rows), [rows]);
  const BM = useMemo(() => byModel(rows), [rows]);
  const dup = useMemo(() => duplicateSerials(rows), [rows]);
  const list = useMemo(() => filterRows(rows, { q, model }), [rows, q, model]);
  const H = useMemo(() => byHour(rows), [rows]);
  const hours = Object.keys(H).map(Number).sort((a, b) => a - b);
  const maxH = Math.max(1, ...hours.map((h) => Object.values(H[h]).reduce((a, v) => a + v, 0)));
  const lineLabel = line === 'all' ? 'All lines' : `Line ${line}`;
  const errs = Object.entries(data.key === key ? data.err : {});
  const download = () => downloadXlsx(buildXlsx(serialSheets(list.length === rows.length ? rows : list, { date: dmy(date), lineLabel })),
    `Serial & carton ${lineLabel} ${date}${list.length !== rows.length ? ' (filtered)' : ''}.xlsx`);
  const tile = 'rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm';

  return (
    <div className="flex flex-col gap-4">
      <HeaderBar label="Serial & carton filters">
        <div className={segGroup} role="group" aria-label="Line">
          <button type="button" aria-pressed={line === 'all'} onClick={() => setLine('all')} className={segBtn(line === 'all', 'navy')}>All lines</button>
          {LINE_IDS.map((l) => <button key={l} type="button" aria-pressed={line === l} onClick={() => setLine(l)} className={segBtn(line === l, 'navy')}>Line {l}</button>)}
        </div>
        <div className={segGroup} role="group" aria-label="Day">
          <button type="button" aria-pressed={date === today} onClick={() => setDate(today)} className={segBtn(date === today)}>Today</button>
          <button type="button" aria-pressed={date === addDays(today, -1)} onClick={() => setDate(addDays(today, -1))} className={segBtn(date === addDays(today, -1))}>Yesterday</button>
        </div>
        <button type="button" aria-label="Day before" title="Day before" onClick={() => setDate(addDays(date, -1))} className={arrowBtn}><ChevronLeft size={15} aria-hidden /></button>
        <input type="date" aria-label="Choose day" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={fieldCls} />
        <button type="button" aria-label="Day after" title="Day after" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} className={arrowBtn}><ChevronRight size={15} aria-hidden /></button>
        <button type="button" onClick={download} disabled={!rows.length} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-700 px-3 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Download size={14} aria-hidden /> Download Excel</button>
      </HeaderBar>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Day totals">
        <div className={tile}><div className="flex items-center gap-1.5 text-fs-12 font-bold uppercase text-slate-500"><PackageCheck size={14} aria-hidden />Pieces</div><div className="font-mono text-fs-28 font-extrabold text-slate-900" data-testid="tot-qty">{nf(T.qty)}</div><div className="text-fs-12 text-slate-500">{lineLabel} · {dmy(date)}</div></div>
        <div className={tile}><div className="flex items-center gap-1.5 text-fs-12 font-bold uppercase text-slate-500"><Barcode size={14} aria-hidden />Serial numbers</div><div className="font-mono text-fs-28 font-extrabold text-slate-900">{nf(T.serials)}</div><div className="text-fs-12 text-slate-500">different serials</div></div>
        <div className={tile}><div className="flex items-center gap-1.5 text-fs-12 font-bold uppercase text-slate-500"><Boxes size={14} aria-hidden />Cartons</div><div className="font-mono text-fs-28 font-extrabold text-slate-900" data-testid="tot-cartons">{nf(T.cartons)}</div><div className="text-fs-12 text-slate-500">different carton numbers</div></div>
        <div className={tile}><div className="flex items-center gap-1.5 text-fs-12 font-bold uppercase text-slate-500"><Clock size={14} aria-hidden />Last scan</div><div className="font-mono text-fs-28 font-extrabold text-slate-900">{T.last ? T.last.at.slice(11, 16) : '—'}</div><div className="truncate text-fs-12 text-slate-500" title={T.last ? `${T.last.model} · ${T.last.serial}` : ''}>{T.last ? `Line ${T.last.line} · ${T.last.model}` : 'no scan'}</div></div>
        <div className={`${tile} ${T.dup ? 'border-amber-300 bg-amber-50' : ''}`}><div className="flex items-center gap-1.5 text-fs-12 font-bold uppercase text-slate-500"><AlertTriangle size={14} aria-hidden />Duplicate serials</div><div className={`font-mono text-fs-28 font-extrabold ${T.dup ? 'text-amber-800' : 'text-slate-900'}`}>{nf(T.dup)}</div><div className="text-fs-12 text-slate-500">serial scanned more than once</div></div>
      </section>

      <div className="flex flex-wrap items-center gap-2 text-fs-13">
        {date === today
          ? <span className="rounded-md bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800" title="New scans are added every 20 s, without reloading the page">● Live{data.at ? ` · ${String(data.at.getHours()).padStart(2, '0')}:${String(data.at.getMinutes()).padStart(2, '0')}:${String(data.at.getSeconds()).padStart(2, '0')}` : ''}</span>
          : <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">Finished day</span>}
        {busy && <span className="text-slate-500">Reading the scans…</span>}
        <button type="button" onClick={() => { lastRef.current = {}; load(false); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold text-blue-700 hover:bg-blue-50"><RefreshCw size={13} aria-hidden /> Refresh</button>
        {errs.map(([l, e]) => <span key={l} role="alert" className="rounded-md bg-red-50 px-2.5 py-1 font-semibold text-red-800">Line {l}: {e}</span>)}
      </div>

      {hours.length > 0 && (
        <section className={card} aria-label="Pieces per hour">
          <h3 className="text-fs-16 font-bold text-slate-900">Pieces per hour · {lineLabel}</h3>
          <div className="mt-3 flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 150 }}>
            {hours.map((h) => { const t = Object.values(H[h]).reduce((a, v) => a + v, 0); return (
              <div key={h} className="flex min-w-[2.6rem] flex-1 flex-col items-center justify-end gap-1" title={Object.entries(H[h]).map(([l, n]) => `Line ${l}: ${n}`).join('\n')}>
                <span className="font-mono text-fs-12 font-bold text-slate-800">{t}</span>
                <div className="w-full rounded-t bg-blue-600" style={{ height: `${Math.max(3, (t / maxH) * 100)}px` }} />
                <span className="font-mono text-fs-11 text-slate-500">{String(h).padStart(2, '0')}</span>
              </div>
            ); })}
          </div>
        </section>
      )}

      <section className={card} aria-label="By model">
        <h3 className="text-fs-16 font-bold text-slate-900">By model</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-fs-14 tabular-nums" aria-label="Pieces and cartons by model">
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Line', 'Company', 'Model', 'Pieces', 'Cartons', 'First scan', 'Last scan', 'First serial', 'Last serial', ''].map((h, i) => <th key={i} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {BM.map((o) => { const k = `${o.line}|${o.mmId}`; return (
                <tr key={k} className={`border-b border-slate-100 ${model === k ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-1.5 font-semibold">Line {o.line}</td><td className="px-2">{o.company}</td><td className="px-2 font-mono font-bold text-slate-900">{o.model}</td>
                  <td className="px-2 font-mono font-bold">{nf(o.qty)}</td><td className="px-2 font-mono">{nf(o.cartons)}{o.noCarton ? <span className="ml-1 text-fs-12 text-amber-700" title="pieces without a carton number">({o.noCarton} without)</span> : null}</td>
                  <td className="px-2 font-mono">{o.first.at.slice(11, 19)}</td><td className="px-2 font-mono">{o.last.at.slice(11, 19)}</td>
                  <td className="px-2 font-mono text-fs-13">{o.first.serial || '—'}</td><td className="px-2 font-mono text-fs-13">{o.last.serial || '—'}</td>
                  <td className="px-2"><button type="button" onClick={() => setModel(model === k ? '' : k)} className="text-fs-13 font-bold text-blue-700 hover:underline">{model === k ? 'Show all' : 'Show pieces'}</button></td>
                </tr>
              ); })}
              {!BM.length && <tr><td colSpan={10} className="px-2 py-4 text-slate-500">{busy ? 'Reading…' : 'No scan on this day.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card} aria-label="Serial and carton list">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-fs-16 font-bold text-slate-900">Serial &amp; carton numbers</h3>
          <span className="text-fs-13 text-slate-500">{list.length === rows.length ? `${nf(rows.length)} pieces, newest first` : `${nf(list.length)} of ${nf(rows.length)} pieces`}</span>
          <label className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5">
            <Search size={14} className="text-slate-500" aria-hidden />
            <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShow(PAGE); }} placeholder="Serial, carton, model…" aria-label="Search serial or carton" className="w-56 bg-transparent text-fs-14 outline-none" />
          </label>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-fs-14 tabular-nums" aria-label="Pieces with serial and carton">
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['#', 'Line', 'Time', 'Company', 'Model', 'Serial no.', 'Carton no.', 'Component'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {list.slice(0, show).map((r, i) => (
                <tr key={`${r.line}|${r.id}`} className={`border-b border-slate-100 ${dup.has(r.serial) ? 'bg-amber-50' : ''}`}>
                  <td className="px-2 py-1 font-mono text-slate-500">{list.length - i}</td><td className="px-2">Line {r.line}</td><td className="px-2 font-mono">{r.at.slice(11, 19)}</td><td className="px-2">{r.company}</td>
                  <td className="px-2 font-mono font-semibold text-slate-900">{r.model}</td>
                  <td className="px-2 font-mono font-bold text-slate-900">{r.serial || '—'}{dup.has(r.serial) && <span className="ml-1.5 rounded bg-amber-100 px-1 text-fs-11 font-bold text-amber-800" title="This serial was scanned more than once">×{dup.get(r.serial)}</span>}</td>
                  <td className="px-2 font-mono">{r.carton || <span className="text-slate-400">—</span>}</td><td className="px-2 font-mono text-fs-13 text-slate-600">{r.component || '—'}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={8} className="px-2 py-4 text-slate-500">{rows.length ? 'Nothing matches the search.' : busy ? 'Reading…' : 'No scan on this day.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {list.length > show && <button type="button" onClick={() => setShow((v) => v + PAGE)} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">Show {Math.min(PAGE, list.length - show)} more ({nf(list.length - show)} left)</button>}
      </section>
    </div>
  );
}
