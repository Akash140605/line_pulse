import React from 'react';
import { hm, okFrom, watchFrom, planTargetOf, goodOf } from '../utils/ole';
import { nf, Gauge, band } from './OleParts';

/*
 * A · P · Q of a total in the look of the Dixon MES (Production Management System): per factor its name ›, its %, the
 * formula, a bar, the figures behind it and its loss. Shared by Overall OLE (KPI panel, line tiles) and every drawer
 * (Day by day, the calendar's day / line / hour) — 19-11-2026: a drawer always shows all three, with 0 where nothing ran.
 */
const NAVY = 'text-[#1F3864]', HAIR = 'border-[#D4D4D4]', STRIP = 'bg-[#F3F3F3]/70';
const hrs = (min) => hm(Math.max(0, Number(min) || 0));
const FACT = [['A', 'Availability'], ['P', 'Performance'], ['Q', 'Quality']];
const weakOf = (t) => FACT.filter(([k]) => t?.[k] != null).sort((a, b) => t[a[0]] - t[b[0]])[0] || null;
const pc1 = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const tone = (v, k = null) => (v == null ? 'text-slate-500' : v >= okFrom(k) ? 'text-[#138A36]' : v >= watchFrom(k) ? 'text-[#9C5700]' : 'text-[#C00000]');   // the MES colours (19-11-2026)
// 19-11-2026: in words, not + / − — "Short 28" · "Excess 116" · "On target"
const signed = (v) => (v > 0 ? `Excess ${nf(v)}` : v < 0 ? `Short ${nf(-v)}` : 'On target');

/** nothing ran (or a figure is missing): every figure 0 instead of a dash (the drawers) */
export function zeroed(t) {
  const z = { ...(t || {}) };
  for (const k of ['A', 'P', 'Q', 'ole']) if (z[k] == null || !Number.isFinite(z[k])) z[k] = 0;
  for (const k of ['plannedMin', 'actualMin', 'lossMin', 'speedMin', 'qty', 'rejects', 'rework', 'dismantle', 'stdSec']) z[k] = Number(z[k]) || 0;
  return z;
}

/** one factor of the KPI panel: name ›, its %, the formula, a bar, the figures behind it and the loss */
export function Factor({ k = null, name, value, formula, rows, lossName, loss, weak = false, compact = false, onOpen = null }) {
  return (
    // sizes of the MES: full = name 14 · value 20 · rows 13 px; in a line tile = name 13 · value 15 · rows 12 px; rows 3 px apart
    // as the C8 MES (19-11-2026): a 3 px line of the factor's colour on top, the bar in 4 parts (25 · 50 · 75 %)
    <div className={`group lp-fac flex min-w-0 flex-col border-t-[3px] ${weak ? 'bg-[#F3F3F3]' : 'bg-white'} ${onOpen ? 'cursor-pointer transition-colors hover:bg-[#F5F9FE]' : ''}`} style={{ borderTopColor: value == null ? '#BFBFBF' : band(value, k) }}
      onClick={onOpen ? (e) => { if (!e.target.closest('button')) onOpen(); } : undefined} title={onOpen ? `${name} — open details` : undefined}>
      <div className={`flex min-w-0 flex-col ${compact ? 'gap-1.5 px-2.5 pt-2' : 'gap-2 px-3 pt-2.5 xl:px-3.5'} pb-2`}>
        <div className={`flex items-center justify-between ${compact ? 'flex-wrap gap-x-1.5 gap-y-0.5' : 'gap-1.5'}`}>
          <button type="button" onClick={onOpen || undefined} disabled={!onOpen} className={`min-w-0 ${compact ? 'whitespace-nowrap' : 'truncate'} text-left font-bold ${NAVY} ${compact ? 'lp-fac-name' : 'text-[calc(17px*var(--fs,1))]'} ${onOpen ? 'hover:underline' : ''}`} title={onOpen ? `${name} — details` : name}>
            {name} {onOpen && <span className="text-[#777] transition-transform group-hover:text-[#2E75B6]">›</span>}
          </button>
          <span className={`ml-auto shrink-0 font-bold leading-none tabular-nums ${tone(value, k)} ${compact ? 'lp-fac-val' : 'text-[calc(27px*var(--fs,1))]'}`}>{pc1(value)}</span>
        </div>
        {formula && !compact && <div className="flex min-w-0 items-baseline gap-1.5 text-mes-body text-[#444]"><i className="shrink-0 font-serif font-bold italic text-[#2E75B6]">ƒ</i><span className="min-w-0 truncate">{formula}</span></div>}
        <div className={`${compact ? 'h-2' : 'h-2.5'} relative w-full overflow-hidden rounded-[2px] bg-[#E5E7EB] shadow-[inset_0_1px_1px_rgba(15,29,36,0.08)]`}><div className="h-full rounded-[2px] transition-[width] duration-1000 ease-out" style={{ width: `${Math.min(100, (value ?? 0) * 100)}%`, background: band(value, k) }} />{[25, 50, 75].map((x) => <i key={x} aria-hidden className="absolute inset-y-0 w-[2px] bg-white/90" style={{ left: `calc(${x}% - 1px)` }} />)}</div>
      </div>
      <div className={`flex min-w-0 flex-1 flex-col ${compact ? 'px-2.5 text-mes-body' : 'px-3 text-[calc(16px*var(--fs,1))] xl:px-3.5'} pb-1.5`}>
        {rows.map(([k, v, cls, sub, short]) => (
          <div key={k} className={`flex flex-1 items-center justify-between ${compact ? 'gap-2' : 'gap-3'} ${sub ? 'border-t border-dashed border-[#E5E7EB]' : `border-t ${HAIR}`} ${compact ? 'min-h-[28px] py-[3px]' : 'min-h-[32px] py-[4px]'}`}>
            {/* a part of the row above (sub): set in, smaller, with ↳ */}
            <span className={`min-w-0 break-words leading-tight ${sub ? 'pl-3 text-[0.88em] text-[#555]' : 'text-[#333]'}`}>{sub && <span aria-hidden className="mr-1 text-[#999]">↳</span>}{compact && short ? <span title={k} className="whitespace-nowrap">{short}</span> : k}</span>
            <span className={`shrink-0 text-right font-semibold tabular-nums ${cls || 'text-[#111]'}`}>{v}</span>
          </div>
        ))}
      </div>
      <div className={`mt-auto flex items-center justify-between gap-3 border-t ${HAIR} ${STRIP} ${compact ? 'px-2.5 py-1.5 text-mes-body' : 'lp-apq-foot px-3 text-[calc(16px*var(--fs,1))] xl:px-3.5'}`}>
        {compact
          // 26-11-2026: a narrow line tile says "Loss" (the tile is already named) — the whole name from 210 px (index.css)
          ? <span className="min-w-0 whitespace-nowrap font-semibold leading-tight text-[#111]"><span className="lp-fac-lf">{lossName}</span><span className="lp-fac-ls">Loss</span></span>
          : <span className="min-w-0 break-words font-semibold leading-tight text-[#111]">{lossName}</span>}
        <span className="shrink-0 font-bold tabular-nums text-[#111]">{pc1(loss)}</span>
      </div>
    </div>
  );
}

/** FPY of a total: the page's own (stations) when given, else 1 − (rework + rejected) ÷ pieces */
const fpyOf = (t) => (t?.fpy != null ? t.fpy : t?.qty > 0 ? Math.max(0, 1 - ((t.rework || 0) + (t.rejects || 0)) / t.qty) : null);
const yPct = (v) => (v == null ? '—' : `${(Math.round(v * 1000) / 10).toFixed(1)}%`);
const yNum = (v) => (v == null ? '—' : (Math.round(v * 1000) / 10).toFixed(1));   // the FPY before " / RTY%" (one % sign: fits a line card)

/** the figures behind A, P and Q of a total */
export function factorsOf(t, zero = false) {
  const target = planTargetOf(t) ?? (zero ? 0 : null);   // 25-11-2026: the HPR / SAWM KPI plan
  return [
    { k: 'A', name: 'Availability', value: t.A, formula: 'Run Time ÷ Planned Time', lossName: 'Availability Loss', loss: t.A == null ? null : 1 - t.A,
      rows: [['Planned Time', hrs(t.plannedMin)], ['Run Time', hrs(t.actualMin)], ['Idle Time', hrs(t.lossMin), t.lossMin ? 'text-[#C00000]' : '']] },
    { k: 'P', name: 'Performance', value: t.P, formula: 'Std Time Of Output ÷ Run Time', lossName: 'Performance Loss', loss: t.P == null ? null : Math.max(0, 1 - t.P),
      rows: [['Plan Target Qty', target == null ? '—' : nf(target)], ['Actual Qty', nf(t.qty)], [target != null && t.qty < target ? 'Short Qty' : 'Excess Qty', target == null ? '—' : nf(Math.abs(t.qty - target)), target != null && t.qty < target ? 'text-[#C00000]' : 'text-[#138A36]']] },
    // 23-11-2026: no rejection any more (a bad piece is reworked or dismantled) — the third row is the rework; an old
    // rejection still shows in its place when the period has one
    { k: 'Q', name: 'Quality', value: t.Q, formula: 'Good Qty ÷ Actual Qty', lossName: 'Quality Loss', loss: t.Q == null ? null : 1 - t.Q,
      // 25-11-2026: Actual = Good + Rework (+ Rejected) — Good is what passed first time (the same "out" as the Q formula)
      // 26-11-2026: FPY / RTY in place of Good Qty (FPY = 1 − defects ÷ pieces; RTY = product of the stations' FPY,
      // from the page when it knows the stations — else '—')
      rows: [['Actual Qty', nf(t.qty)], ['FPY / RTY', <span key="fr" title={`FPY (first pass yield) = 1 − defects ÷ pieces made · RTY (rolled throughput yield) = product of every station's FPY · good pieces ${nf(goodOf(t))}`}>
          <span className="whitespace-nowrap text-[#0E6E2E]">{yNum(fpyOf(t))}</span><span className="text-[#999]"> / </span><span className="whitespace-nowrap text-[#0E6E2E]">{yPct(t.rty)}</span></span>, '', false, 'FPY/RTY'],
        // 26-11-2026: the rework and what became of it in ONE row — reworked / passed after rework / dismantled (88 / 70 / 18)
        ['Rework / Passed / Dismantled', <span key="r" title={`${nf(t.rework || 0)} reworked: ${nf(Math.max(0, (t.rework || 0) - (t.dismantle || 0)))} passed after rework, ${nf(t.dismantle || 0)} dismantled`}>
          <span className={t.rework ? 'text-[#C00000]' : ''}>{nf(t.rework || 0)}</span><span className="text-[#999]"> / </span>
          <span className={(t.rework || 0) > (t.dismantle || 0) ? 'text-[#0E6E2E]' : ''}>{nf(Math.max(0, (t.rework || 0) - (t.dismantle || 0)))}</span><span className="text-[#999]"> / </span>
          <span className={t.dismantle ? 'text-[#C00000]' : ''}>{nf(t.dismantle || 0)}</span></span>, '', false, 'R / P / D'], ...(t.rejects > 0 ? [['Rejected Qty', nf(t.rejects), 'text-[#C00000]']] : [])] },
  ];
}

/** the KPI panel of the plant (or one line): gauge | A | P | Q */
export function KpiPanel({ t: t0, onFactor = null, zero = false, gauge = 206, onOle = null }) {
  const t = zero ? zeroed(t0) : t0;
  const F = factorsOf(t, zero);
  const w = weakOf(t);
  return (
    <div className="grid gap-px bg-[#D4D4D4] lg:grid-cols-[minmax(0,0.85fr)_repeat(3,minmax(0,1fr))]">
      <div className="flex min-w-0 flex-col border-t-[3px] bg-white" style={{ borderTopColor: t.ole == null ? '#BFBFBF' : band(t.ole) }}>
        {/* the OLE gauge: a click opens its details from the right (when the page gives a drawer) */}
        <div role={onOle ? 'button' : undefined} tabIndex={onOle ? 0 : undefined} aria-label={onOle ? 'OLE — open the details' : undefined}
          onClick={onOle || undefined} onKeyDown={onOle ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOle(); } } : undefined}
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-3 pb-1.5 pt-2 ${onOle ? 'cursor-pointer hover:bg-[#F5F9FE]' : ''}`}>
          <div className="flex items-center gap-1.5"><span className="text-mes-label font-bold uppercase tracking-[0.12em] text-[#777]">OLE</span></div>
          <Gauge value={t.ole} size={gauge} label="" />
        </div>
        <div className={`lp-apq-foot mt-auto flex flex-col items-center justify-center border-t ${HAIR} ${STRIP} px-2 text-center leading-tight`}>
          <div className={`whitespace-nowrap text-mes-body font-bold ${NAVY}`}>OLE = A × P × Q</div>
          <div className="text-mes-label font-semibold tabular-nums text-[#555]">{pc1(t.A)} × {pc1(t.P)} × {pc1(t.Q)}</div>
        </div>
      </div>
      {F.map((f) => <Factor key={f.k} {...f} weak={!!w && w[0] === f.k && t[f.k] < okFrom(f.k)} onOpen={onFactor ? () => onFactor(f.k) : null} />)}
    </div>
  );
}

