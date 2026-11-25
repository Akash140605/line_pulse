import React, { useState } from 'react';
import { Download, Printer } from 'lucide-react';

const btn = 'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-fs-13 font-extrabold text-slate-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50';

/** Excel export (all numbers on screen) + print / save-as-PDF. */
export default function ExportBar({ onExcel }) {
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await onExcel(); } finally { setBusy(false); } };
  return (
    <>
      <button type="button" onClick={run} disabled={busy} className={btn} title="Download Excel (hourly, daily, models, cycle stats, rejections)" aria-label="Excel">
        <Download size={13} strokeWidth={2.5} /><span className="hidden min-[1800px]:inline">{busy ? 'Preparing…' : 'Excel'}</span>
      </button>
      <button type="button" onClick={() => window.print()} className={`${btn} hidden md:inline-flex`} title="Print / Save as PDF" aria-label="Print">
        <Printer size={13} strokeWidth={2.5} /><span className="hidden min-[1800px]:inline">Print</span>
      </button>
    </>
  );
}
