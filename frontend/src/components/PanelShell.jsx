import React from 'react';
import { Maximize2 } from 'lucide-react';

/** Wraps a panel with an expand button; dims while its data is refreshing. */
export default function PanelShell({ id, title, onExpand, className = '', scroll = false, busy = false, children }) {
  return (
    <div className={`relative group ${className}`}>
      <button
        type="button"
        onClick={() => onExpand(id)}
        title={`Expand ${title}`}
        className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded-lg bg-white/95 border border-slate-200 shadow-sm text-slate-600 hover:text-blue-600 hover:border-blue-400 opacity-80 group-hover:opacity-100 transition"
      >
        <Maximize2 size={14} strokeWidth={2.5} />
      </button>
      <div className={`h-full transition-opacity duration-150 ${busy ? 'opacity-60 pointer-events-none' : ''} ${scroll ? 'max-h-[560px] overflow-y-auto rounded-xl' : ''}`}>
        {children}
      </div>
    </div>
  );
}
