import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/*
 * One standard for the filters of every page: on a wide screen (≥ 1280 px) they sit in the top bar, in the same
 * row as the page title (Header.jsx #lp-header-slot); on a narrow screen they show at the top of the page.
 * The pieces below give every page the same buttons: lines (navy when chosen), periods (blue), arrows, dates, selects.
 */
export function useHeaderSlot() {
  const [el, setEl] = useState(null);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches);
  useEffect(() => {
    setEl(document.getElementById('lp-header-slot'));
    const mq = window.matchMedia?.('(min-width: 1280px)'); if (!mq) return undefined;
    const on = () => setWide(mq.matches); mq.addEventListener?.('change', on); return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide ? el : null;
}

/** 24-11-2026: the right side of the strip (beside Refresh) — page actions that should not push the filters to a second line */
export function useHeaderActionsSlot() {
  const [el, setEl] = useState(null);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches);
  useEffect(() => {
    setEl(document.getElementById('lp-header-actions'));
    const mq = window.matchMedia?.('(min-width: 1280px)'); if (!mq) return undefined;
    const on = () => setWide(mq.matches); mq.addEventListener?.('change', on); return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide ? el : null;
}

export const segGroup = 'lp-seg flex shrink-0 overflow-hidden rounded-md border border-slate-300';
export const segBtn = (on, tone = 'blue') => `lp-segbtn inline-flex h-8 items-center whitespace-nowrap border-r border-slate-300 px-2.5 text-fs-13 font-semibold last:border-r-0 ${on ? (tone === 'navy' ? 'bg-dixon-navy text-white' : 'bg-blue-600 text-white') : 'bg-white text-slate-700 hover:bg-slate-100'}`;
export const arrowBtn = 'lp-arrow grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white';
export const fieldCls = 'lp-field h-8 rounded-md border border-slate-300 bg-white px-2 text-fs-13 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500';

/** The page's filters: in the top bar on a wide screen, else a slim bar at the top of the page. */
export default function HeaderBar({ label = 'Filters', children }) {
  const slot = useHeaderSlot();
  const row = <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={label}>{children}</div>;
  if (slot) return createPortal(row, slot);
  return <div className="lp-filterbar rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">{row}</div>;
}
