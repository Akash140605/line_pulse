import React from 'react';

/** Lid symbol drawn as SVG (the ◐ glyph is missing in some fonts). Same meaning as the text symbols in Excel. */
export default function LidIcon({ type, size = 15 }) {
  const c = { full: '#0369A1', half: '#4338CA', glass: '#0F766E', none: '#64748B', unknown: '#DC2626' }[type || 'unknown'];
  const r = 6.2;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="inline-block shrink-0 align-[-2px]">
      {type === 'full' && <circle cx="8" cy="8" r={r} fill={c} stroke={c} strokeWidth="1.6" />}
      {type === 'half' && <><circle cx="8" cy="8" r={r} fill="white" stroke={c} strokeWidth="1.6" /><path d={`M8 ${8 - r} A${r} ${r} 0 0 0 8 ${8 + r} Z`} fill={c} /></>}
      {type === 'glass' && <><circle cx="8" cy="8" r={r} fill="white" stroke={c} strokeWidth="1.6" /><circle cx="8" cy="8" r="2.8" fill={c} /></>}
      {type === 'none' && <circle cx="8" cy="8" r={r} fill="white" stroke={c} strokeWidth="1.6" />}
      {(!type || type === 'unknown') && <text x="8" y="12.5" textAnchor="middle" fontSize="13" fontWeight="800" fill={c}>?</text>}
    </svg>
  );
}
