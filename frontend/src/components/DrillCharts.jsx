import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LINE_COLOR } from '../theme';
import { NOT_WRITTEN, ticksOf } from '../utils/drill';

/*
 * Charts of the drill-down. Every mark is a button: a click drills in (the page adds a filter),
 * a second click on the same mark steps out. Built with plain HTML so they stay fast, keyboard friendly and readable on a
 * phone. Colours (data-viz method, validated): categorical slots in a fixed order — a department keeps its colour whatever
 * is filtered; lines keep the app's line colours; magnitude (heat map) is one blue ramp light → dark.
 */
export const SLOT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const ACCENT = SLOT[0];
export const MUTED = '#cbd5e1';
export const OTHER = '#a8a29e';
export const UNWRITTEN = '#57534e';
/** The departments with their own colour, in slot order (the stack order too); the rest are "Other". */
export const DEPT_ORDER = ['Prod', 'Kitting Store', 'Moulding Store', 'Maint', 'IT', 'Supplier', 'Moulding QA', 'Sub Assy'];
export const deptColor = (d) => (d === NOT_WRITTEN ? UNWRITTEN : DEPT_ORDER.includes(d) ? SLOT[DEPT_ORDER.indexOf(d)] : OTHER);
export const deptSeries = (d) => (d === NOT_WRITTEN || DEPT_ORDER.includes(d) ? d : 'Other');
export const lineColor = (l) => LINE_COLOR[l] || OTHER;
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
export const rampOf = (t) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))];
const inkOn = (hex) => { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0b0b0b' : '#ffffff'; };

/** ▲ +12 % / ▼ −8 % against the previous period: for a loss, up is worse (red) and down better (green); arrow + sign, never colour alone. */
export function Delta({ value, prev, fmt, small = false }) {
  if (value == null || prev == null) return null;
  const d = value - prev;
  if (Math.abs(d) < 1e-9) return <span className={`${small ? 'text-fs-11' : 'text-fs-12'} font-bold text-slate-500`}>= same</span>;
  const pct = prev > 0 ? Math.round((d / prev) * 100) : null;
  const up = d > 0;
  return (
    <span className={`${small ? 'text-fs-11' : 'text-fs-12'} whitespace-nowrap font-bold ${up ? 'text-red-700' : 'text-emerald-700'}`} title={`Previous period ${fmt ? fmt(prev) : prev}`}>
      {up ? '▲' : '▼'} {up ? '+' : '−'}{fmt ? fmt(Math.abs(d)) : Math.abs(d)}{pct != null ? ` (${up ? '+' : '−'}${Math.abs(pct)}%)` : prev === 0 ? ' (new)' : ''}
    </span>
  );
}

/** Legend: a swatch beside each name (text never wears the data colour). */
export function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-fs-12 font-semibold text-slate-700" aria-label="Legend">
      {items.map((it) => <li key={it.key} className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />{it.label}</li>)}
    </ul>
  );
}

/**
 * Pareto as ranked horizontal bars (long names stay readable, every row clickable): the "vital few" up to 80 % of the
 * total in the accent colour, the rest muted, a hairline where 80 % is reached. Share and cumulative % beside each bar.
 */
export function ParetoBars({ rows, valueText, onPick, active = null, label, prevOn = false, empty = 'Nothing in this slice.' }) {
  if (!rows?.length) return <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  const lastA = rows.reduce((i, r, j) => (r.cls === 'A' && !r.others ? j : i), -1);
  return (
    <ol className="flex flex-col" aria-label={label}>
      {rows.map((r, i) => {
        const on = active != null && r.key === String(active);
        const color = r.others ? MUTED : r.cls === 'A' ? ACCENT : '#93a4b8';
        return (
          <React.Fragment key={r.key ?? `others-${i}`}>
            <li>
              <button type="button" disabled={r.others || !onPick} onClick={() => onPick?.(r.key)} aria-pressed={on}
                aria-label={`${r.label}: ${valueText(r.value)}, ${r.share.toFixed(1)}% of the total, cumulative ${r.cumPct.toFixed(1)}%`}
                className={`group grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-1.5 py-1 text-left sm:grid-cols-[1.5rem_minmax(7rem,14rem)_minmax(0,1fr)_auto] ${on ? 'bg-blue-50 ring-1 ring-blue-300' : r.others ? '' : 'hover:bg-slate-50'} disabled:cursor-default`}>
                <span className="text-right font-mono text-fs-11 font-bold text-slate-400">{r.others ? '' : i + 1}</span>
                <span className="truncate text-fs-13 font-semibold text-slate-900" title={r.label}>{r.label}</span>
                <span className="col-span-3 col-start-2 row-start-2 flex items-center sm:col-span-1 sm:col-start-3 sm:row-start-1">
                  <span className="block h-3 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (r.value / (max || 1)) * 100)}%`, background: color }} />
                </span>
                <span className="col-start-3 row-start-1 flex flex-col items-end leading-tight sm:col-start-4">
                  <span className="whitespace-nowrap font-mono text-fs-13 font-bold tabular-nums text-slate-900">{valueText(r.value)}</span>
                  <span className="whitespace-nowrap text-fs-11 font-semibold tabular-nums text-slate-500">{r.share.toFixed(1)}% · cum {r.cumPct.toFixed(0)}%</span>
                  {prevOn && <Delta value={r.value} prev={r.prev} fmt={valueText} small />}
                </span>
              </button>
            </li>
            {i === lastA && i < rows.length - 1 && (
              <li aria-hidden className="my-1 flex items-center gap-2 px-1.5 text-fs-11 font-bold uppercase tracking-wide text-slate-500">
                <span className="h-px flex-1 bg-slate-300" />80 % of the total above this line<span className="h-px flex-1 bg-slate-300" />
              </li>
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/** Ranked bars of one series (one hue) — lines, owners, models, parts. dot = identity colour beside the name (lines). */
export function RankBars({ rows, valueText, onPick, active = null, label, dot = null, prevOn = false, empty = 'Nothing in this slice.' }) {
  if (!rows?.length) return <p className="py-6 text-center text-fs-13 font-semibold text-slate-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-0.5" aria-label={label}>
      {rows.map((r, i) => {
        const on = active != null && r.key === String(active);
        return (
          <li key={r.key ?? `o-${i}`}>
            <button type="button" disabled={r.others || !onPick} onClick={() => onPick?.(r.key)} aria-pressed={on}
              aria-label={`${r.label}: ${valueText(r.value)}, ${r.share.toFixed(1)}%`}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-left ${on ? 'bg-blue-50 ring-1 ring-blue-300' : r.others ? '' : 'hover:bg-slate-50'} disabled:cursor-default`}>
              <span className="flex min-w-0 items-center gap-1.5 text-fs-13 font-semibold text-slate-900">
                
                <span className="truncate" title={r.label}>{r.label}</span>
              </span>
              <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="font-mono text-fs-13 font-bold tabular-nums text-slate-900">{valueText(r.value)}</span>
                <span className="text-fs-11 font-semibold tabular-nums text-slate-500">{r.share.toFixed(0)}%</span>
              </span>
              <span className="col-span-2 flex h-2.5 items-center">
                <span className="block h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (r.value / (max || 1)) * 100)}%`, background: r.others ? MUTED : ACCENT }} />
              </span>
              {prevOn && r.prev != null && <span className="col-span-2 -mt-0.5"><Delta value={r.value} prev={r.prev} fmt={valueText} small /></span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Columns over time (or hours): stacked by series when there is more than one, a 2 px surface gap between the parts,
 * 4 px rounded top, hairline grid with clean ticks. Hover / focus shows the readout (value first); click drills in.
 */
export function Columns({ buckets, series = ['all'], colorOf = () => ACCENT, nameOf = (s) => s, valueText, axisText, onPick, isActive = () => false, label, height = 220, emptyText = 'Nothing in this slice.', steps = null }) {
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const on = () => setW(el.getBoundingClientRect().width || 600);
    on();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const max = Math.max(0, ...buckets.map((b) => b.total));
  const ticks = useMemo(() => ticksOf(max, 4, steps), [max, steps]);
  const top = ticks[ticks.length - 1] || 1;
  if (!(max > 0)) return <p className="py-10 text-center text-fs-13 font-semibold text-slate-500">{emptyText}</p>;
  const order = series;
  const show = (b, i, el) => {
    const r = el.getBoundingClientRect(), p = box.current.getBoundingClientRect();
    setTip({ b, x: r.left - p.left + r.width / 2, w: p.width, i });
  };
  // x labels: as many as fit (about one per 34 px), always the last one
  const step = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor((w - 48) / 34))));
  return (
    <div className="relative" ref={box} onMouseLeave={() => setTip(null)}>
      <div className="flex" style={{ height }}>
        {/* y axis */}
        <div className="relative mr-1 w-11 shrink-0 text-right font-mono text-fs-11 text-slate-500 tabular-nums" aria-hidden>
          {ticks.map((t) => <span key={t} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(t / top) * 100}%` }}>{axisText(t)}</span>)}
        </div>
        <div className="relative min-w-0 flex-1" role="group" aria-label={label}>
          {ticks.map((t) => <div key={t} aria-hidden className={`absolute inset-x-0 h-px ${t === 0 ? 'bg-slate-400' : 'bg-slate-200'}`} style={{ bottom: `${(t / top) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end justify-around">
            {buckets.map((b, i) => {
              const on = isActive(b);
              const parts = order.map((s) => [s, b.parts?.[s] || 0]).filter(([, v]) => v > 0);
              return (
                <button key={b.key} type="button" onClick={() => onPick?.(b)} disabled={!onPick || !(b.total > 0)}
                  onMouseEnter={(e) => show(b, i, e.currentTarget)} onFocus={(e) => show(b, i, e.currentTarget)} onBlur={() => setTip(null)}
                  aria-pressed={on} aria-label={`${b.label}: ${valueText(b.total)}${parts.length > 1 ? ` — ${parts.map(([s, v]) => `${nameOf(s)} ${valueText(v)}`).join(', ')}` : ''}`}
                  className={`group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end px-[1px] disabled:cursor-default ${on ? 'bg-blue-50' : ''}`}>
                  <span className="flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: `${(b.total / top) * 100}%` }}>
                    {parts.map(([s, v], j) => (
                      <span key={s} className={`block w-full ${j === parts.length - 1 ? 'rounded-t-[4px]' : ''} group-hover:opacity-90`} style={{ flex: `${v} 0 0`, minHeight: 1, background: colorOf(s) }} />
                    ))}
                  </span>
                  {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* x labels: every bar when they fit, else every few */}
      <div className="ml-12 flex h-4 justify-around" aria-hidden>
        {buckets.map((b, i) => (
          <span key={b.key} className="relative min-w-0 flex-1">
            {(i % step === 0 && (i + step <= buckets.length - 1 || i === buckets.length - 1)) || i === buckets.length - 1 ? <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap font-mono text-fs-10 text-slate-500">{b.short}</span> : null}
          </span>
        ))}
      </div>
      {tip && (
        <div role="status" className="pointer-events-none absolute top-0 z-20 min-w-[11rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-fs-12 shadow-lg"
          style={{ left: Math.min(Math.max(tip.x - 90, 0), Math.max(0, tip.w - 190)) }}>
          <div className="font-mono text-fs-14 font-extrabold text-slate-900">{valueText(tip.b.total)}</div>
          <div className="font-semibold text-slate-600">{tip.b.label}</div>
          {order.filter((s) => (tip.b.parts?.[s] || 0) > 0).length > 1 && (
            <ul className="mt-1 space-y-0.5">
              {[...order].reverse().filter((s) => (tip.b.parts?.[s] || 0) > 0).map((s) => (
                <li key={s} className="flex items-center gap-2"><i className="inline-block h-0.5 w-3" style={{ background: colorOf(s) }} /><b className="font-mono tabular-nums text-slate-900">{valueText(tip.b.parts[s])}</b><span className="truncate text-slate-600">{nameOf(s)}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Heat map: rows × cols, one blue ramp (more = darker), value inside when it fits; a cell click filters both. */
export function Heatmap({ m, valueText, cellText, onPick, rowLabel, colLabel, label, isActive = () => false }) {
  if (!m?.rows?.length || !(m.max > 0)) return <p className="py-8 text-center text-fs-13 font-semibold text-slate-500">Nothing in this slice.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-fs-11" aria-label={label}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-1 text-left text-fs-11 font-bold uppercase tracking-wide text-slate-500">{rowLabel} \ {colLabel}</th>
            {m.cols.map((c, j) => <th key={c.key ?? `o${j}`} className="min-w-[2.6rem] max-w-[7rem] truncate px-0.5 text-center font-semibold text-slate-600" title={c.label}>{c.label}</th>)}
            <th className="px-1 text-right font-bold text-slate-600">Total</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r, i) => (
            <tr key={r.key ?? `o${i}`}>
              <th scope="row" className="sticky left-0 z-10 max-w-[10rem] truncate bg-white px-1 text-left text-fs-12 font-semibold text-slate-800" title={r.label}>{r.label}</th>
              {m.cols.map((c, j) => {
                const v = m.grid[i][j];
                const bg = v > 0 ? rampOf(v / m.max) : '#f8fafc';
                const on = isActive(r, c);
                return (
                  <td key={c.key ?? `o${j}`} className="p-0">
                    <button type="button" disabled={!(v > 0) || r.other || c.other || !onPick} onClick={() => onPick?.(r, c)}
                      aria-label={`${r.label} · ${c.label}: ${v > 0 ? valueText(v) : 'nothing'}`} aria-pressed={on}
                      className={`grid h-8 w-full min-w-[2.6rem] place-items-center rounded-[3px] font-mono text-fs-11 font-bold tabular-nums disabled:cursor-default ${on ? 'outline outline-2 outline-offset-1 outline-slate-900' : ''}`}
                      style={{ background: bg, color: v > 0 ? inkOn(bg) : '#94a3b8' }} title={`${r.label} · ${c.label}: ${v > 0 ? valueText(v) : '—'}`}>
                      {v > 0 ? cellText(v) : ''}
                    </button>
                  </td>
                );
              })}
              <td className="px-1 text-right font-mono text-fs-12 font-bold tabular-nums text-slate-800">{cellText(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-fs-11 font-semibold text-slate-500" aria-hidden>
        Less <span className="flex">{RAMP.filter((_, i) => i % 2 === 0).map((c) => <i key={c} className="h-2.5 w-5" style={{ background: c }} />)}</span> More
      </div>
    </div>
  );
}
