import React from 'react';
import { refreshSec } from '../utils/refreshConfig';

/** LIVE badge + toggle. Polling only runs on the latest day (older days never change). */
export default function LiveControl({ live, onToggle, active, lastUpdated }) {
  const time = lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  return (
    <button
      type="button"
      onClick={onToggle}
      title={live ? `Live updates are ON (every ${refreshSec('dash')} seconds) — click to pause` : 'Live updates are paused — click to resume'}
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-fs-13 font-extrabold shadow-sm transition
        ${live && active ? 'border-sky-300 bg-sky-50 text-sky-700' : !live ? 'border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
    >
      <span className={`h-2 w-2 rounded-full ${live && active ? 'bg-sky-500 animate-pulse' : !live ? 'bg-slate-500' : 'bg-slate-400'}`} />
      <span>{live ? (active ? 'LIVE' : 'Live (old day)') : 'Paused · resume'}</span>
      <span className="hidden xl:inline font-mono font-semibold text-slate-600">{time}</span>
    </button>
  );
}
