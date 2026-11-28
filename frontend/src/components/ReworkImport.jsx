/**
 * 28-11-2026: Import the plant's rework sheet (Line Rejection MIS) into the Quality entries — admin only.
 * Paste the sheet or choose the file → a check per day and line (rows, pieces, dismantled; "already in Line Pulse" days are
 * left as they are) → Import. Saved with the normal Quality entry save (part 'quality': the loss part of the hour stays).
 */
import React, { useRef, useState } from 'react';
import { Upload, FileUp, X } from 'lucide-react';
import MesDrawer from './MesDrawer';
import { api } from '../api';
import { readSheetFile, parseDelimited } from '../utils/sheetRead';
import { parseMis, planImport } from '../utils/reworkImport';
import { nf, dmy } from './OleParts';

export default function ReworkImport({ onClose, onDone }) {
  const fileRef = useRef(null);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(null);   // { items, bad, save, days }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(null);
  const check = async (rows) => {
    setErr(''); setPlan(null); setDone(null); setBusy('Checking …');
    try {
      const { items, bad } = parseMis(rows);
      if (!items.length) throw new Error('No rework rows were found under the header.');
      const dates = items.map((i) => i.date).sort();
      const e = await api.oleEntries(dates[0], dates[dates.length - 1]);
      setPlan({ items, bad, ...planImport(items, e?.entries || {}) });
    } catch (x) { setErr(String(x.message || x)); }
    setBusy('');
  };
  const onFile = async (ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) { try { await check(await readSheetFile(f)); } catch (x) { setErr(String(x.message || x)); } } };
  const run = async () => {
    if (!plan?.save.length) return;
    setErr('');
    try {
      for (let i = 0; i < plan.save.length; i += 400) {
        setBusy(`Saving ${nf(Math.min(i + 400, plan.save.length))} of ${nf(plan.save.length)} hours …`);
        await api.saveOle(plan.save.slice(i, i + 400));
      }
      const add = plan.days.filter((d) => !d.skip);
      setDone({ days: add.length, pcs: add.reduce((a, d) => a + d.pcs, 0), hours: plan.save.length });
      setPlan(null); setText('');
      onDone?.();
    } catch (x) { setErr(`Stopped: ${x.message} — the hours saved so far stay; check again and import the rest.`); }
    setBusy('');
  };
  const add = plan ? plan.days.filter((d) => !d.skip) : [];
  const skip = plan ? plan.days.filter((d) => d.skip) : [];
  const th = 'border-b border-slate-300 bg-[#DCE6F2] px-2 py-1 text-left text-fs-12 font-bold text-[#1F3864]';
  return (
    <MesDrawer title="Import rework sheet (MIS)" sub="the plant's Line Rejection sheet → Quality entries · only the days without rework in Line Pulse" icon={FileUp} onClose={onClose} label="Import rework sheet" method="center" width={64}>
      <div className="grid gap-3 p-4" data-testid="ri-dialog">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv" className="hidden" onChange={onFile} aria-label="Rework sheet file" />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1F3864] px-3 text-fs-13 font-bold text-white"><Upload size={15} />Choose the sheet (.xlsx / .csv / .txt)</button>
          <span className="text-fs-12 text-slate-500">or paste it below (with its header row: DATE · Stage · Line · … · 09-10 · 10-11 …)</span>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Paste the rework sheet" placeholder="Paste the sheet from Excel here …" rows={4} className="w-full rounded-lg border border-slate-300 p-2 font-mono text-fs-12" />
        <div className="flex gap-2"><button type="button" disabled={!text.trim() || !!busy} onClick={() => check(parseDelimited(text))} data-testid="ri-check" className="h-9 rounded-lg border border-[#1F3864] px-3 text-fs-13 font-bold text-[#1F3864] disabled:opacity-40">Check the pasted sheet</button>{busy && <span className="self-center text-fs-13 font-semibold text-slate-600">{busy}</span>}</div>
        {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
        {done && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-fs-13 font-semibold text-emerald-800" data-testid="ri-done">Imported: {nf(done.pcs)} pcs of rework in {nf(done.days)} day-lines ({nf(done.hours)} hours). The dashboards and reports show it now.</div>}
        {plan && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-fs-13" data-testid="ri-summary">
              <span><b className="font-mono">{nf(plan.items.length)}</b> rows · <b className="font-mono">{nf(plan.items.reduce((a, i) => a + i.total, 0))}</b> pcs in the sheet</span>
              <span className="text-emerald-700"><b className="font-mono">{nf(add.length)}</b> day-lines to add · <b className="font-mono">{nf(add.reduce((a, d) => a + d.pcs, 0))}</b> pcs</span>
              <span className="text-slate-600"><b className="font-mono">{nf(skip.length)}</b> day-lines already in Line Pulse — left as they are</span>
              {plan.bad.length > 0 && <span className="text-amber-700" title={plan.bad.map((b) => `row ${b.row}: ${b.why}`).join('\n')}><b className="font-mono">{plan.bad.length}</b> rows not read (hover)</span>}
            </div>
            <div className="overflow-auto rounded-lg border border-slate-200" style={{ maxHeight: "42vh" }}>
              <table className="w-full border-collapse text-fs-13">
                <thead className="sticky top-0"><tr>{['Date', 'Line', 'Rows', 'Pcs', 'Dismantled', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{plan.days.map((d) => (
                  <tr key={`${d.date}|${d.line}`} className={`border-b border-slate-100 ${d.skip ? 'text-slate-400' : ''}`} data-testid="ri-day">
                    <td className="px-2 py-1 font-mono">{dmy(d.date)}</td><td className="px-2 py-1">Line {d.line}</td>
                    <td className="px-2 py-1 text-right font-mono">{nf(d.rows)}</td><td className="px-2 py-1 text-right font-mono font-bold">{nf(d.pcs)}</td><td className="px-2 py-1 text-right font-mono">{d.dism ? nf(d.dism) : ''}</td>
                    <td className="px-2 py-1">{d.skip ? <span className="text-fs-12 font-semibold">already in Line Pulse — skipped</span> : <span className="text-fs-12 font-bold text-emerald-700">will be added</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700"><X size={15} />Cancel</button>
              <button type="button" disabled={!plan.save.length || !!busy} onClick={run} data-testid="ri-run" className="h-10 rounded-lg bg-emerald-700 px-4 text-fs-14 font-bold text-white disabled:opacity-40">Import {nf(add.length)} day-lines ({nf(add.reduce((a, d) => a + d.pcs, 0))} pcs)</button>
            </div>
          </>
        )}
        <p className="text-fs-12 text-slate-500">Stage, model, category, department, defect, root cause and action are kept as in the sheet; ACTION "Dismental" marks the pieces dismantled. A day and line that already has rework written in Line Pulse is never changed (no double count).</p>
      </div>
    </MesDrawer>
  );
}
