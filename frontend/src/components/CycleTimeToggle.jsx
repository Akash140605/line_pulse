
import React from 'react';

export default function CycleTimeToggle({ mode, onChange }) {
  const opts = [
    { key: 'actual', label: 'Actual (scan gaps)' },
    { key: 'theoretical', label: 'Theoretical (3600 ÷ qty)' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-fs-13 sm:text-fs-13 font-bold bg-white border border-slate-200 shadow-sm hover:shadow-md transition">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2.5 sm:px-2.5 py-1.5 transition-colors whitespace-nowrap ${
            mode === o.key
              ? 'bg-sky-600 text-white'
              : 'bg-white text-slate-600 hover:text-slate-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

