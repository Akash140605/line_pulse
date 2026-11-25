import React, { useEffect, useRef, useState } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

/* ───────────── Excel-style multi-select ───────────── */
/** options: [{ value, label, count, pcs }]; selected: values; empty selection = All. */
export default function MultiSelect({ label, options, selected, onChange, render }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const sel = new Set(selected.map(String));
  const shown = options.filter((o) => !q || String(o.label).toLowerCase().includes(q.toLowerCase()));
  const toggle = (v) => onChange(sel.has(v) ? selected.filter((x) => String(x) !== v) : [...selected, v]);
  const summary = !selected.length ? 'All' : selected.length === 1 ? (options.find((o) => o.value === String(selected[0]))?.label ?? selected[0]) : `${selected.length} selected`;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-fs-13 font-semibold ${selected.length ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-slate-300 bg-white text-slate-800'}`}>
        <span className="min-w-0 truncate"><span className="text-slate-600 font-bold mr-1">{label}:</span>{summary}</span>
        <ChevronDown size={15} className="shrink-0 opacity-60" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-[min(320px,90vw)] rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2">
              <Search size={14} className="text-slate-600" aria-hidden />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full py-1.5 text-fs-13 outline-none" />
            </div>
            <div className="mt-1.5 flex gap-1.5 text-fs-12 font-bold">
              <button type="button" className="rounded-md bg-slate-100 px-2 py-1 hover:bg-slate-200" onClick={() => onChange([...new Set([...selected.map(String), ...shown.map((o) => o.value)])])}>Select all{q ? ' shown' : ''}</button>
              <button type="button" className="rounded-md bg-slate-100 px-2 py-1 hover:bg-slate-200" onClick={() => onChange([])}>Clear</button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <div className="px-3 py-2 text-fs-13 text-slate-600">Nothing found</div>}
            {shown.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-fs-13 hover:bg-slate-50">
                <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={sel.has(o.value)} onChange={() => toggle(o.value)} />
                <span className="min-w-0 flex-1 truncate">{render ? render(o) : o.label}</span>
                <span className="shrink-0 tabular-nums text-fs-12 text-slate-600">{o.count} · {n0(o.pcs)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end border-t border-slate-100 p-2">
            <button type="button" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-fs-13 font-bold text-white"><Check size={14} aria-hidden /> OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
