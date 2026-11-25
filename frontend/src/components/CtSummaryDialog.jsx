import React, { useEffect, useMemo, useState } from 'react';
import MesDrawer from './MesDrawer';
import { createPortal } from 'react-dom';
import { Download, X, FileSpreadsheet } from 'lucide-react';
import { ctCompanies, ctCompany, exportCycleSummary } from '../utils/ctSummary';

/**
 * CT summary: pick the customers (check boxes, "All customers" at the top), then download.
 * rows = target-method rows ({ line, model, modelCode, company, qty, A, B, avg }).
 */
const nf = (v) => Math.round(v || 0).toLocaleString('en-IN');

export default function CtSummaryDialog({ rows, opts, range, lineText, onClose }) {
  const list = useMemo(() => ctCompanies(rows), [rows]);
  const [sel, setSel] = useState(() => new Set(list.map((c) => c.key)));
  const [groupOthers, setGroupOthers] = useState(true);
  const all = sel.size === list.length && list.length > 0;
  const some = sel.size > 0 && !all;
  const toggle = (k) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const picked = list.filter((c) => sel.has(c.key));
  const big = /SAMSUNG|VOLTAS|GODREJ/;
  const others = picked.filter((c) => !big.test(c.key));
  const nSheets = picked.filter((c) => big.test(c.key)).length + (groupOthers ? (others.length ? 1 : 0) : others.length);
  // the valid-scan rule and what it eliminates in the chosen customers
  const lo = opts?.lowA ?? 1, hi = opts?.capA ?? 22;
  const inSel = (rows || []).filter((r) => r.A && r.B && sel.has(ctCompany(r.company)));
  const sum = (k) => inSel.reduce((a, r) => a + (Number(k(r)) || 0), 0);
  const qty = sum((r) => r.qty), below = sum((r) => r.belowLow), above = sum((r) => r.aboveCap), kept = sum((r) => r.A?.kept);
  const hasElim = inSel.some((r) => r.belowLow != null);

  return (
    <MesDrawer title="CT summary — choose customers" sub={`${lineText} · ${range?.start} to ${range?.end} · ${list.length} customers with enough scans`} icon={FileSpreadsheet}
      onClose={onClose} label="CT summary customers" method="center" width={36} canExpand={false}
      footer={<>
          <span className="mr-auto text-fs-13 text-slate-600">{nSheets} sheet{nSheets === 1 ? '' : 's'} · Samsung, Voltas, Godrej each get their own</span>
          <button type="button" onClick={onClose} className="rounded-[2px] border border-[#BFBFBF] bg-white px-3 py-1 text-mes-body text-[#222] hover:bg-[#DDEBF7]">Cancel</button>
          <button type="button" disabled={!sel.size} onClick={() => { exportCycleSummary(rows, opts, range, lineText, { companies: [...sel], groupOthers }); onClose(); }}
            className="inline-flex items-center gap-1.5 rounded-[2px] bg-[#2E75B6] px-3 py-1 text-mes-body font-semibold text-white hover:bg-[#1F4E79] disabled:opacity-50">
            <Download size={15} /> Download Excel
          </button>
      </>}>
        <div className="px-5 py-3">
          <label className="flex items-center gap-3 rounded-lg border-2 border-slate-300 bg-slate-50 px-3 py-2.5 text-fs-16 font-bold text-slate-900 cursor-pointer">
            <input type="checkbox" className="h-5 w-5 accent-blue-700" checked={all} ref={(el) => { if (el) el.indeterminate = some; }}
              onChange={() => setSel(all ? new Set() : new Set(list.map((c) => c.key)))} aria-label="All customers" />
            All customers <span className="ml-auto text-fs-13 font-semibold text-slate-600">{sel.size} of {list.length} selected</span>
          </label>
          <div className="mt-2 space-y-1">
            {list.map((c) => (
              <label key={c.key} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-fs-14 cursor-pointer hover:bg-slate-50 ${sel.has(c.key) ? 'text-slate-900' : 'text-slate-500'}`}>
                <input type="checkbox" className="h-4 w-4 accent-blue-700" checked={sel.has(c.key)} onChange={() => toggle(c.key)} aria-label={c.label} />
                <span className="font-semibold">{c.label}</span>
                <span className="ml-auto font-mono text-fs-13 text-slate-600">{c.models} models · {nf(c.qty)} pcs</span>
              </label>
            ))}
            {!list.length && <div className="py-6 text-center text-fs-14 text-slate-600">No model with enough scans in this period.</div>}
          </div>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-fs-14 text-amber-950" aria-label="Valid scan rule">
            <div className="font-bold">Valid scans: gaps {lo}–{hi} s</div>
            <div className="text-fs-13">Gaps below <b>{lo} s</b> (double scans, glitches) and above <b>{hi} s</b> (stops, changeovers) are eliminated — set on Target rule & check (rule) or Target methods A/B/C.</div>
            {hasElim && inSel.length > 0 && (
              <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-fs-13 sm:grid-cols-4">
                <span>Qty <b>{nf(qty)}</b></span><span>&lt; {lo} s <b className="text-red-700">−{nf(below)}</b></span><span>&gt; {hi} s <b className="text-red-700">−{nf(above)}</b></span><span>Valid <b className="text-emerald-800">{nf(kept)}</b></span>
              </div>
            )}
          </div>
          {others.length > 1 && (
            <label className="mt-3 flex items-center gap-3 rounded-lg bg-blue-50 px-3 py-2 text-fs-14 font-semibold text-blue-950">
              <input type="checkbox" className="h-4 w-4 accent-blue-700" checked={groupOthers} onChange={(e) => setGroupOthers(e.target.checked)} />
              Put the other customers ({others.length}) together in one “Remaining” sheet
            </label>
          )}
        </div>
    </MesDrawer>
  );
}
