import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Maximize2, Minimize2, X, PanelRight, FileSpreadsheet } from 'lucide-react';
import { exportPanel } from '../utils/domExcel';

/**
 * The detail drawer of the Dixon MES (Production Management System), the same look and the same way of opening:
 * a white card that glides in from the right (10 px from the screen edges, 75 % of the screen wide, at least 560 px),
 * a blurred backdrop, the navy → steel → accent header with its icon tile, path (breadcrumb), level badge, 15 px title,
 * 12 px subtitle and 32 px square buttons (back, full screen, close — close turns red on hover), the content rising in
 * a moment later. Phones: full screen. Esc or a click on the backdrop closes it.
 *
 *   method   'right' (detail drawer) · 'center' (a small form in the middle) · 'fullscreen'
 *   crumbs   [{ label, onClick }] — the drill path above the title; onBack shows the ‹ button
 *   fit      (20-11-2026) a drawer of tables: only as wide and as tall as its tables (at least minWidth px, at most `width` % of the screen);
 *            fit="width": only the width (a drawer another one opens over keeps the full height)
 */
// open drawers, newest last: Esc goes to the top one only (a day drawer opened over another window closes alone)
const OPEN = [];

export default function MesDrawer({
  title, sub = null, icon: Icon = PanelRight, crumbs = [], onBack = null, onClose, children, footer = null,
  method = 'right', width = 75, label, closeLabel = 'Close', backdropLabel = 'Close', canExpand = true, tint = false, bodyClass = '', excel = true, fit = false, minWidth = 560,
}) {
  const bodyRef = useRef(null);
  const [full, setFull] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);
  const me = useRef({});
  useEffect(() => { const k = me.current; OPEN.push(k); return () => { const i = OPEN.indexOf(k); if (i >= 0) OPEN.splice(i, 1); }; }, []);
  const close = () => {
    if (closing) return;
    const quiet = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (quiet) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, 170);
  };
  useEffect(() => {
    const k = (e) => { if (e.key !== 'Escape' || OPEN[OPEN.length - 1] !== me.current) return; e.stopPropagation(); onBack ? onBack() : close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onBack, closing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const m = full ? 'fullscreen' : method;
  const depth = crumbs.length;
  return createPortal(
    <>
      <button type="button" tabIndex={-1} aria-label={backdropLabel} onClick={close}
        className={`mes-drawer-overlay fixed inset-0 z-[79] ${closing ? 'mes-drawer-overlay-out' : 'mes-drawer-overlay-in'}`} data-backdrop="blur" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-hidden={closing || undefined} aria-label={label || (typeof title === 'string' ? title : 'Details')} tabIndex={-1}
        className={`mes-drawer z-[80] focus:outline-none ${closing ? 'mes-drawer-closing' : 'mes-drawer-in'}`} data-method={m} data-fit={fit ? (fit === 'width' ? 'w' : 'all') : undefined} style={{ '--mes-drawer-w': `${width}vw`, '--mes-drawer-min': `${minWidth}px` }}>
        <header className={`mes-drawer-head flex shrink-0 items-center gap-2.5 px-3.5 pb-3 pt-2.5 ${scrolled ? 'mes-drawer-scrolled' : ''}`} data-style="navy">
          {onBack && <button type="button" onClick={onBack} className="mes-drawer-btn relative" aria-label="Back" title="Back (Esc)"><ChevronLeft className="h-4 w-4" /></button>}
          <span className="mes-drawer-icon relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px]" aria-hidden><Icon className="h-[18px] w-[18px]" /></span>
          <div className="mes-drawer-titles relative min-w-0 flex-1">
            {depth > 0 && (
              <nav className="mes-drawer-crumbs" aria-label="Path">
                {crumbs.map((c, i) => (
                  <span key={i} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 && <span className="mes-drawer-crumb-sep" aria-hidden>›</span>}
                    <button type="button" className="mes-drawer-crumb" onClick={c.onClick}>{c.label}</button>
                  </span>
                ))}
                <span className="mes-drawer-crumb-sep" aria-hidden>›</span>
              </nav>
            )}
            <div className="flex min-w-0 items-center gap-2 font-bold leading-tight tracking-[0.005em]" style={{ fontSize: 'min(calc(15px * var(--fs, 1)), 20px)' }} title={typeof title === 'string' ? title : undefined}>
              <span className="truncate">{title}</span>
              {depth > 0 && <span className="mes-drawer-depth" title={`Level ${depth + 1}`}>{depth + 1}</span>}
            </div>
            {sub && <div className="mes-drawer-sub mt-1 truncate text-mes-label">{sub}</div>}
          </div>
          <div className="relative flex shrink-0 items-center gap-1.5">
            {/* 19-11-2026: every details panel to Excel (its tables + the A · P · Q summary) */}
            {excel && <button type="button" onClick={() => exportPanel(bodyRef.current, typeof title === 'string' ? title : (label || 'Details'), typeof sub === 'string' ? sub : '')}
              className="mes-drawer-btn relative inline-flex w-auto gap-1 px-2" aria-label="Export to Excel" title="Export to Excel"><FileSpreadsheet className="h-4 w-4" /><span className="hidden text-[12px] font-bold sm:inline">Excel</span></button>}
            {canExpand && method !== 'fullscreen' && <>
              <span className="mes-drawer-sep relative mx-0.5 hidden h-6 w-px md:block" aria-hidden />
              <button type="button" onClick={() => setFull((v) => !v)} className="mes-drawer-btn relative hidden md:inline-flex" aria-label={full ? 'Smaller' : 'Full screen'} title={full ? 'Smaller' : 'Full screen'}>
                {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </>}
            <button type="button" onClick={close} className="mes-drawer-btn mes-drawer-close relative" aria-label={closeLabel} title="Close (Esc)"><X className="h-4 w-4" /></button>
          </div>
        </header>
        <div ref={bodyRef} className={`mes-drawer-body min-h-0 flex-1 overflow-auto ${tint ? 'bg-[#EAF2FB]' : 'bg-white'} ${bodyClass}`} onScroll={(e) => { const s = e.currentTarget.scrollTop > 4; if (s !== scrolled) setScrolled(s); }}>
          {children}
        </div>
        {footer && <footer className="mes-drawer-foot flex shrink-0 items-center justify-end gap-2 border-t border-[#BFBFBF] px-3.5 py-2.5">{footer}</footer>}
      </aside>
    </>,
    document.body,
  );
}
