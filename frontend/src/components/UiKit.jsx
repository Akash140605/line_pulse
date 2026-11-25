import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const STATUS_STYLE = {
  ok: ['OK', 'bg-sky-100 text-sky-700'], watch: ['Watch', 'bg-slate-100 text-slate-700'],
  behind: ['Bad', 'bg-red-100 text-red-700'], idle: ['—', 'bg-slate-100 text-slate-600'],
};
export function StatusChip({ s, labels }) {
  const [t, c] = STATUS_STYLE[s] || STATUS_STYLE.idle;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-fs-12 font-extrabold ${c}`}>{labels?.[s] ?? t}</span>;
}

/** Chart / table card. `formula` shows on the ƒ beside the title (hover / focus). */
export function Card({ title, sub, formula, right, children, className = '' }) {
  return (
    <div className={`lp-card bg-white border border-slate-200/90 rounded-2xl shadow-sm p-4 min-w-0 ${className}`}>
      <div className="lp-card-head flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
        <div className="min-w-0">
          <div className="flex items-start gap-1.5">
            <h3 className="lp-card-title text-fs-16 font-bold text-dixon-ink leading-snug tracking-[-0.005em]">{title}</h3>
            {formula && <FormulaTip text={formula} />}
          </div>
          {sub && <p className="lp-card-sub text-fs-13 text-slate-600 mt-0.5 leading-snug">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="lp-card-body">{children}</div>
    </div>
  );
}

/* How a card's numbers are worked out: a small ƒ that shows the formula on hover / keyboard focus, so no note text sits on the page.
 * The readout opens only while pointed at (never part of the page width) and stays inside the screen. */
export function FormulaTip({ text }) {
  const ref = useRef(null);
  const [at, setAt] = useState(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setAt(r.top > window.innerHeight * 0.6 ? { left, width, bottom: window.innerHeight - r.top + 6 } : { left, width, top: r.bottom + 6 });
  };
  const hide = () => setAt(null);
  useEffect(() => {   // the page moves under it: close
    if (!at) return undefined;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [at]);
  return (
    <>
      <span ref={ref} tabIndex={0} role="img" aria-label={typeof text === 'string' ? `Formula: ${text}` : 'Formula'} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 cursor-help select-none items-center justify-center rounded-full border border-blue-300 bg-blue-50 font-mono text-[11px] font-bold leading-none text-blue-700 hover:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">ƒ</span>
      {at && createPortal(
        <div role="tooltip" style={at} className="pointer-events-none fixed z-[70] rounded-md border border-slate-200 bg-white px-2.5 py-2 font-mono text-fs-12 leading-snug text-slate-700 shadow-lg">{text}</div>,
        document.body,
      )}
    </>
  );
}

export function Stat({ label, value, sub, tone = 'text-slate-900', bar = 'bg-blue-600', barColor }) {
  return (
    <div className="lp-stat relative bg-white border border-slate-200/90 rounded-xl p-3 pt-3.5 shadow-sm overflow-hidden min-h-[96px]">
      <div className={`lp-stat-bar absolute left-3 right-3 top-0 h-[3px] rounded-b ${barColor ? '' : bar}`} style={barColor ? { background: barColor } : undefined} />
      <div className="lp-stat-label text-fs-13 font-semibold text-slate-600">{label}</div>
      <div className={`lp-stat-val font-mono tabular-nums text-fs-24 font-bold leading-tight mt-1 tracking-[-0.01em] ${tone}`}>{value}</div>
      {sub && <div className="lp-stat-sub text-fs-12 font-semibold text-slate-600 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}

export function Empty({ children = 'No data for this selection' }) {
  return <div className="py-12 text-center text-fs-14 font-semibold text-slate-600">{children}</div>;
}

export function PageLoading({ loading, error }) {
  if (error) return <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-xl px-3 py-2.5 text-fs-14 font-semibold break-all">{error}</div>;
  return <div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">{loading ? 'Loading analytics…' : 'No data'}</div>;
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border border-slate-300 bg-white p-0.5 gap-0.5 text-fs-13 font-bold">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rounded-md px-2.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${value === k ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{l}</button>
      ))}
    </div>
  );
}

