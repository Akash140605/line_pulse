import React from 'react';
import { TARGET_GREY, ACH_GREEN, ACH_ORANGE, ACH_RED, ACH_ORANGE_FROM, NO_CYCLE } from '../utils/achieve';

const sq = (c) => <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c }} aria-hidden />;
/** 24-11-2026: the key of every target-vs-actual chart: grey target, actual green / orange / red by % achieved */
export default function AchKey({ target = 'Target', noCycle = false, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-fs-13 font-semibold text-slate-600 ${className}`} aria-label="Key">
      <span className="inline-flex items-center gap-1.5">{sq(TARGET_GREY)}{target}</span>
      <span className="inline-flex items-center gap-1.5">{sq(ACH_GREEN)}≥ 100 %</span>
      <span className="inline-flex items-center gap-1.5">{sq(ACH_ORANGE)}{ACH_ORANGE_FROM}–99 %</span>
      <span className="inline-flex items-center gap-1.5">{sq(ACH_RED)}below {ACH_ORANGE_FROM} %</span>
      {noCycle && <span className="inline-flex items-center gap-1.5">{sq(NO_CYCLE)}No cycle time</span>}
    </div>
  );
}
