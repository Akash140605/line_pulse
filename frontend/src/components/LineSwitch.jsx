import React from 'react';
import { LINES } from '../api';
import { segGroup, segBtn } from './HeaderBar';

/** Overall (all lines) + Line 1–4 — the same look as the line buttons of every other page (HeaderBar standard). */
export default function LineSwitch({ line, onChange }) {
  const list = [...LINES.filter(([k]) => k === 'all'), ...LINES.filter(([k]) => k !== 'all')];
  return (
    <div className={segGroup} role="tablist" aria-label="Production line">
      {list.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={line === k} onClick={() => line !== k && onChange(k)}
          className={`${segBtn(line === k, 'navy')} focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600`}>
          {k === 'all' ? 'Overall' : l}
        </button>
      ))}
    </div>
  );
}
