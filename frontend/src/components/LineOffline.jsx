import React, { useEffect, useRef, useState } from 'react';
import { WifiOff, KeyRound, Timer, AlertTriangle, RefreshCw } from 'lucide-react';
import { describeLoadError } from '../utils/offline';

const ICON = { offline: WifiOff, login: KeyRound, slow: Timer, error: AlertTriangle };

/**
 * A line whose data cannot be loaded: plain-language reason, automatic retry with a countdown, "Retry now",
 * buttons for the other lines, and the technical text folded away.
 * compact = card inside the Main view (2×2 grid).
 */
export default function LineOffline({ lineName, error, onRetry, otherLines = [], onPickLine, compact = false, accent, note = '' }) {
  const info = describeLoadError(error, lineName);
  const auto = info.kind === 'offline' || info.kind === 'slow';
  const start = info.retryIn ?? 30;
  const [left, setLeft] = useState(start);
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  useEffect(() => { setLeft(start); }, [error, start]);
  useEffect(() => {
    if (!auto || !onRetry) return undefined;
    const t = setInterval(() => setLeft((s) => {
      if (s <= 1) { retryRef.current?.(); return start; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [auto, start, onRetry]);
  const Icon = ICON[info.kind] || AlertTriangle;
  const tone = info.kind === 'login' ? 'amber' : 'red';
  const box = tone === 'amber' ? 'border-slate-200 bg-slate-50 text-slate-900' : 'border-red-200 bg-red-50 text-red-900';
  const iconBox = tone === 'amber' ? 'bg-slate-100 text-slate-700' : 'bg-red-100 text-red-700';

  return (
    <div role="alert" className={`rounded-2xl border-2 ${box} ${compact ? 'p-3' : 'p-5'} shadow-sm overflow-auto`}
      style={accent ? { borderTop: `5px solid ${accent}` } : undefined}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 rounded-xl ${iconBox} ${compact ? 'p-2' : 'p-3'}`}><Icon size={compact ? 22 : 30} aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <div className={`${compact ? 'text-lg' : 'text-xl'} font-extrabold leading-tight`}>{info.title}</div>
          <div className={`${compact ? 'text-fs-13' : 'text-fs-14'} mt-1 leading-snug`}>{info.hint}</div>
          {note && <div className={`${compact ? 'text-fs-13' : 'text-fs-14'} mt-1.5 leading-snug font-semibold opacity-90`}>{note}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onRetry && (
              <button type="button" onClick={() => { setLeft(start); onRetry(); }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-black/10 px-3 py-1.5 text-fs-13 font-bold shadow-sm hover:bg-white/70">
                <RefreshCw size={14} aria-hidden /> Retry now
              </button>
            )}
            {auto && onRetry && <span className="text-fs-13 font-semibold opacity-80 tabular-nums">Next automatic try in {left} s</span>}
            {!compact && otherLines.length > 0 && onPickLine && (
              <span className="flex flex-wrap items-center gap-1.5 text-fs-13">
                <span className="opacity-70 ml-1">Open another line:</span>
                {otherLines.map(([id, name]) => (
                  <button key={id} type="button" onClick={() => onPickLine(id)}
                    className="rounded-lg bg-white/80 border border-slate-200 px-2.5 py-1 font-bold text-slate-800 hover:bg-white">{name}</button>
                ))}
              </span>
            )}
          </div>
          <details className="mt-3 text-fs-12 opacity-80">
            <summary className="cursor-pointer font-semibold select-none">Technical details</summary>
            <div className="mt-1 font-mono break-all">{info.detail}</div>
          </details>
        </div>
      </div>
    </div>
  );
}
