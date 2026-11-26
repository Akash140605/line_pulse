import React, { useMemo, useState } from 'react';
import { useLastScans } from '../hooks/useLastScans';
import { createPortal } from 'react-dom';
import { Clock, Timer, AlertTriangle, Gauge as GaugeIcon, Target, Package, PackageX, CheckCircle2, RotateCcw, TrendingDown, Activity, Hash } from 'lucide-react';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, oleSum, hm, okFrom, watchFrom, normEntry, planTargetOf } from '../utils/ole';
import { LINE_COLOR, nf, dmy, useOleLines, groupNameOf, useOleData, band, inkOf, plantOf, plantsText, companyOf, CompanyCell } from '../components/OleParts';
import { PeriodBar, periodKind } from '../components/PeriodBar';
import { useHeaderSlot } from './CleanDashboardPage';
import { takeOleFocus } from '../utils/drillLink';

/*
 * The three deep pages of the OLE, as the C8 MES "focus pages" (19-11-2026):
 *   Availability — where the time went: idle reasons Pareto, share by department, when (hour of the day), lines, reasons
 *   Performance  — speed vs standard: lines vs target, models losing most time, when, models slower than standard
 *   Quality      — why pieces are rejected: reasons Pareto, share, when, rejection by line and by model
 * Each: a navy band, five KPI tiles, then cards. Same data and maths as OLE Overview (utils/ole.js oleRange).
 */
const NAVY = '#1F3864', RED = '#C00000', GREEN = '#138A36', AMBER = '#D98E04', STEEL = '#2E75B6', HAIR = '#D4D4D4';
const card = 'rounded-[2px] border border-[#BFBFBF] bg-white shadow-[0_1px_3px_rgba(15,29,36,0.10)]';
const pc = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100 * 10 ** d) / 10 ** d}%`);
const hrs = (min) => hm(Math.max(0, Number(min) || 0));
const toneOf = (v, k = null) => (v == null ? '#777' : v >= okFrom(k) ? GREEN : v >= watchFrom(k) ? AMBER : RED);
const PALETTE = ['#1F3864', '#2E75B6', '#C00000', '#ED7D31', '#70AD47', '#FFC000', '#7030A0', '#5B9BD5', '#A5A5A5', '#264478'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ───────────── pieces ───────────── */

function Band({ title, sub, chip }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1F3864] px-4 py-2 text-white">
      <h2 className="lp-caps font-extrabold leading-tight tracking-[0.03em]" style={{ fontSize: 'calc(20px * var(--fs, 1))' }}>{title}{sub && <span className="ml-2 font-semibold normal-case tracking-normal text-[#BDD7EE]" style={{ fontSize: 'calc(14px * var(--fs, 1))' }}>{sub}</span>}</h2>
      {chip && <span className="rounded-[3px] border border-white/40 px-3 py-1 font-bold" style={{ fontSize: 'calc(15px * var(--fs, 1))' }}>{chip}</span>}
    </div>
  );
}

/** a KPI tile: coloured icon, label in capitals, the value, a note */
function Kpi({ icon: Icon, label, value, note, color = NAVY }) {
  return (
    <div className="flex min-w-0 items-start gap-3 border-t-[3px] bg-white px-3.5 py-3" style={{ borderTopColor: color }}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[3px]" style={{ background: `${color}1A`, color }}><Icon size={20} strokeWidth={2} /></span>
      <div className="min-w-0 leading-tight">
        <div className="lp-caps text-[12px] font-bold tracking-[0.08em] text-[#555]">{label}</div>
        <div className="lp-clamp2 mt-0.5 font-bold leading-tight tabular-nums" style={{ color: inkOf(color), fontSize: `calc(${typeof value === 'string' && !/\d/.test(value) && value.length > 9 ? 18 : 24}px * var(--fs, 1))` }} title={typeof value === 'string' ? value : undefined}>{value}</div>
        {note && <div className="lp-clamp2 mt-0.5 text-[13px] leading-tight text-[#666]" title={typeof note === 'string' ? note : undefined}>{note}</div>}
      </div>
    </div>
  );
}

function Card({ title, sub, children, className = '', right = null }) {
  return (
    <section className={`${card} flex min-w-0 flex-col ${className}`} aria-label={title}>
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-[#D4D4D4] px-3.5 py-2">
        <h3 className="border-l-4 border-[#1F3864] pl-2 font-bold text-[#1F3864]" style={{ fontSize: 'calc(17px * var(--fs, 1))' }}>{title}</h3>
        {sub && <span className="text-[13px] text-[#666]">· {sub}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="min-w-0 flex-1 p-3">{children}</div>
    </section>
  );
}

const Empty = ({ children }) => <p className="py-6 text-center text-[14px] text-[#666]">{children}</p>;

/** Pareto: bars (largest first) + the cumulative % line and the 80 % line, as the MES */
// 25-11-2026: a "nice" left axis (0 · ¼ · ½ · ¾ · top on round numbers) — no more 0.1 h / 0.1 h / 0.2 h / 0.2 h
const NICE = [1, 2, 2.5, 5, 10];
export function niceTop(max, time = false) {
  if (!(max > 0)) return 4;
  const q = max / 4;
  if (time && q >= 1) { const t = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440].find((x) => x >= q); if (t) return t * 4; }
  const e = 10 ** Math.floor(Math.log10(q)); const m = NICE.find((x) => x * e >= q - 1e-9) || 10;
  return m * e * 4;
}
const axisMin = (v) => (v >= 120 ? `${+(v / 60).toFixed(v % 60 ? 1 : 0)} h` : `${+v.toFixed(v < 10 && v % 1 ? 1 : 0)} min`);
export function Pareto({ rows, fmt = nf, unit = '', color = STEEL, empty, time = false }) {
  const top = rows.filter((r) => r.value > 0).slice(0, 10);
  if (!top.length) return <Empty>{empty}</Empty>;
  const total = rows.reduce((a, r) => a + r.value, 0);
  let cum = 0;
  const u = top.map((r) => { cum += r.value; return { ...r, cum: (cum / total) * 100 }; });
  const W = 720, L = 48, Rr = 680, T = 18, B = 232;
  const max = niceTop(Math.max(...u.map((r) => r.value)), time);
  const n = u.length, step = (Rr - L) / n, bw = Math.min(56, step * 0.62);
  // 26-11-2026: the whole name under its bar, word by word on as many lines as it needs (never cut with …)
  const per = Math.max(5, Math.floor(step / 7.2));   // letters that fit under one bar
  const wrap = (t) => { const out = []; let cur = ''; for (const w0 of String(t).split(/\s+/)) { for (let w = w0; w.length;) { const room = per - (cur ? cur.length + 1 : 0); if (w.length <= room) { cur = cur ? `${cur} ${w}` : w; w = ''; } else if (!cur) { out.push(w.slice(0, per)); w = w.slice(per); } else { out.push(cur); cur = ''; } } } if (cur) out.push(cur); return out; };
  const lab = u.map((r) => wrap(r.label));
  const H = B + 22 + 12 * Math.max(1, ...lab.map((l) => l.length));
  const axisFmt = time ? axisMin : (v) => nf(Math.round(v * 100) / 100);
  const x = (i) => L + step * (i + 0.5), y = (v) => B - (v / max) * (B - T), yc = (p) => B - (p / 100) * (B - T);
  const i80 = u.findIndex((r) => r.cum >= 80);
  const vital = i80 >= 0 ? i80 + 1 : u.length;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Pareto chart">
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line x1={L} x2={Rr} y1={yc(p)} y2={yc(p)} stroke="#E3E6EA" strokeDasharray={p ? '3 3' : undefined} />
            <text x={L - 6} y={yc(p) + 4} textAnchor="end" fontSize="11" fill="#555">{axisFmt((max * p) / 100)}</text>
            <text x={Rr + 6} y={yc(p) + 4} fontSize="11" fill="#555">{p}%</text>
          </g>
        ))}
        <line x1={L} x2={Rr} y1={yc(80)} y2={yc(80)} stroke={RED} strokeWidth="1.5" strokeDasharray="6 4" />
        <text x={Rr - 4} y={yc(80) - 5} textAnchor="end" fontSize="11" fontWeight="700" fill={RED}>80%</text>
        {u.map((r, i) => (
          <g key={r.label}>
            <rect x={x(i) - bw / 2} y={y(r.value)} width={bw} height={Math.max(1, B - y(r.value))} rx="2" fill={i < vital ? color : '#9DB7D5'}><title>{`${r.label}: ${fmt(r.value)}${unit}`}</title></rect>
            <text x={x(i)} y={y(r.value) - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#222">{fmt(r.value)}</text>
            <text x={x(i)} y={B + 15} textAnchor="middle" fontSize="10.5" fill="#333">{lab[i].map((t, k) => <tspan key={k} x={x(i)} dy={k ? 12 : 0}>{t}</tspan>)}<title>{r.label}</title></text>
          </g>
        ))}
        <polyline points={u.map((r, i) => `${x(i)},${yc(r.cum)}`).join(' ')} fill="none" stroke={NAVY} strokeWidth="2" />
        {u.map((r, i) => <circle key={r.label} cx={x(i)} cy={yc(r.cum)} r="3.5" fill="#fff" stroke={NAVY} strokeWidth="2" />)}
      </svg>
      <p className="mt-1 text-[13px] text-[#555]"><b className="text-[#1F3864]">{vital}</b> of {rows.filter((r) => r.value > 0).length} make <b className="text-[#1F3864]">{Math.round(u[Math.max(vital - 1, 0)].cum)}%</b> of the total{unit}</p>
    </div>
  );
}

/** Donut of shares with its legend (value · %) */
export function Donut({ rows, fmt = nf, unit = '', centre = 'Total', empty }) {
  const list = rows.filter((r) => r.value > 0);
  if (!list.length) return <Empty>{empty}</Empty>;
  const top = list.slice(0, 7);
  const rest = list.slice(7).reduce((a, r) => a + r.value, 0);
  const parts = rest > 0 ? [...top, { label: 'Others', value: rest }] : top;
  const total = parts.reduce((a, r) => a + r.value, 0);
  const R0 = 66, R1 = 42, C = 80;
  let a0 = -Math.PI / 2;
  const arc = (from, to) => {
    const p = (r, a) => `${C + r * Math.cos(a)} ${C + r * Math.sin(a)}`;
    const big = to - from > Math.PI ? 1 : 0;
    return `M ${p(R0, from)} A ${R0} ${R0} 0 ${big} 1 ${p(R0, to)} L ${p(R1, to)} A ${R1} ${R1} 0 ${big} 0 ${p(R1, from)} Z`;
  };
  const seg = parts.map((r, i) => { const a = (r.value / total) * Math.PI * 2; const s = { ...r, from: a0, to: a0 + Math.max(a - 0.0001, 0.0001), color: r.label === 'Others' ? '#A5A5A5' : PALETTE[i % PALETTE.length], pct: (r.value / total) * 100 }; a0 += a; return s; });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 160 160" className="h-[170px] w-[170px] shrink-0" role="img" aria-label="Share chart">
        {seg.map((s) => <path key={s.label} d={arc(s.from, s.to)} fill={s.color} stroke="#fff" strokeWidth="1.5"><title>{`${s.label}: ${fmt(s.value)}${unit}`}</title></path>)}
        <text x={C} y={C - 2} textAnchor="middle" fontSize="17" fontWeight="700" fill={NAVY}>{fmt(total)}</text>
        <text x={C} y={C + 15} textAnchor="middle" fontSize="11" fill="#666">{centre}</text>
      </svg>
      <ul className="min-w-[12rem] flex-1 space-y-1.5">
        {seg.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[14px]">
            <i className="h-3 w-3 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 break-words leading-tight text-[#333]" title={s.label}>{s.label}</span>
            <b className="tabular-nums text-[#111]">{fmt(s.value)}{unit}</b>
            <span className="w-12 text-right tabular-nums text-[#666]">{Math.round(s.pct)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 25-11-2026: under the department donut — what each department owns: its share, its biggest reasons (time and how
 * often) and where to start (fills the card beside the Pareto)
 */
export function DeptOwners({ depts, byDept = {}, fmt = nf }) {
  const list = depts.filter((d) => d.value > 0);   // 26-11-2026: every department (was the first 4)
  if (!list.length) return null;
  const total = depts.reduce((a, d) => a + d.value, 0);
  const max = Math.max(...list.map((d) => d.value));
  const of = (d) => byDept[d.label] || [];   // every reason (was 2)
  const first = list[0];
  return (
    <div className="mt-2 border-t border-[#E5E7EB] pt-2" data-testid="dept-owners">
      <div className="mb-1 text-[11.5px] font-extrabold uppercase tracking-wide text-[#1F3864]">What each department owns</div>
      <div className="flex flex-col gap-1">
        {list.map((d, i) => (
          <div key={d.label} className="rounded-md px-1.5 py-1 hover:bg-[#F5F8FC]" title={of(d).map((r) => `${r.label}: ${fmt(r.value)} · ${r.n} times`).join('\n')}>
            <div className="flex items-center gap-2 text-[12.5px]">
              <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <b className="shrink-0 break-words leading-tight text-[#111]" style={{ width: 110 }}>{d.label}</b>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#EEF2F7]"><span className="block h-full rounded-full" style={{ width: `${Math.max(4, (d.value / max) * 100)}%`, background: PALETTE[i % PALETTE.length] }} /></span>
              <b className="w-12 shrink-0 text-right tabular-nums text-[#C00000]">{fmt(d.value)}</b>
            </div>
            <div className="break-words text-[11.5px] leading-snug text-[#555]" style={{ paddingLeft: 18 }}>{of(d).map((r, k) => <span key={r.label}>{k > 0 && ' · '}{r.label} <b className="text-[#222]">{fmt(r.value)}</b> <span className="text-[#777]">×{r.n}</span></span>)}</div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 rounded-md bg-[#FFF7E6] px-2 py-1 text-[11.5px] text-[#7A4B00]">Start with <b>{first.label}</b> ({Math.round((first.value / total) * 100)}% of the idle time){of(first)[0] ? <> — mostly <b>{of(first)[0].label}</b></> : null}.</p>
    </div>
  );
}

/** When: by clock hour of the day (summed over the period) */
function When({ hours, fmt = nf, unit = '', color = RED, empty }) {
  const list = hours.filter((h) => h.value > 0);
  if (!list.length) return <Empty>{empty}</Empty>;
  const from = Math.min(...hours.filter((h) => h.any).map((h) => h.hour)), to = Math.max(...hours.filter((h) => h.any).map((h) => h.hour));
  const H = hours.filter((h) => h.hour >= from && h.hour <= to);
  const max = Math.max(...H.map((h) => h.value), 1);
  const W = 720, B = 200, T = 16, L = 10, Rr = 710, step = (Rr - L) / H.length, bw = Math.min(40, step * 0.7);
  const worst = H.reduce((b, h) => (h.value > (b?.value ?? -1) ? h : b), null);
  return (
    <div>
      <svg viewBox={`0 0 ${W} 228`} className="h-auto w-full" role="img" aria-label="When it happens">
        <line x1={L} x2={Rr} y1={B} y2={B} stroke="#BFBFBF" />
        {H.map((h, i) => {
          const x = L + step * (i + 0.5), y = B - (h.value / max) * (B - T);
          return (
            <g key={h.hour}>
              <rect x={x - bw / 2} y={y} width={bw} height={Math.max(h.value > 0 ? 2 : 0, B - y)} rx="2" fill={h === worst ? color : `${color}99`}><title>{`${String(h.hour).padStart(2, '0')}:00 – ${fmt(h.value)}${unit}`}</title></rect>
              {h.value > 0 && <text x={x} y={y - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#222">{fmt(h.value)}</text>}
              <text x={x} y={B + 16} textAnchor="middle" fontSize="11" fill="#333">{String(h.hour).padStart(2, '0')}</text>
            </g>
          );
        })}
      </svg>
      {worst && <p className="mt-1 text-[13px] text-[#555]">Worst hour <b className="text-[#C00000]">{String(worst.hour).padStart(2, '0')}:00–{String(worst.hour + 1).padStart(2, '0')}:00</b> · {fmt(worst.value)}{unit}</p>}
    </div>
  );
}

/** a table in the MES look: light-blue head, hair lines, numbers on the right */
function Table({ cols, rows: all, empty, label, top = 20 }) {
  const [more, setMore] = useState(false);
  if (!all.length) return <Empty>{empty}</Empty>;
  const rows = more ? all : all.slice(0, top);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]" aria-label={label}>
        <thead><tr>{cols.map((c) => <th key={c.label} className={`whitespace-nowrap border border-[#BFBFBF] bg-[#DDEBF7] px-2.5 py-1.5 font-bold text-[#1F3864] ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key ?? i} className="even:bg-[#F7F9FC] hover:bg-[#EAF2FB]">
              {cols.map((c) => <td key={c.label} className={`border border-[#E1E4E8] px-2.5 py-1.5 tabular-nums ${c.right ? 'text-right' : ''}`}>{c.get(r, i)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {all.length > top && <button type="button" onClick={() => setMore((v) => !v)} className="mt-2 rounded-[3px] border border-[#BFBFBF] bg-white px-3 py-1 text-[13px] font-semibold text-[#1F3864] hover:bg-[#EAF2FB]">{more ? 'Show top ' + top : `Show all ${all.length}`}</button>}
    </div>
  );
}

const LineName = ({ l }) => <span className="whitespace-nowrap font-semibold">Line {l}{plantOf(l) ? <span className="ml-1 text-[12px] text-[#777]">({plantOf(l)})</span> : null}</span>;
const Pct = ({ v, k = null }) => <b style={{ color: inkOf(toneOf(v, k)) }}>{pc(v)}</b>;
const Bar = ({ v, color = STEEL }) => <span className="inline-block h-2 w-24 overflow-hidden rounded-[2px] bg-[#E5E7EB] align-middle"><span className="block h-full" style={{ width: `${Math.min(100, Math.max(0, v * 100))}%`, background: color }} /></span>;

/* ───────────── the figures ───────────── */

function figures(R, IDS) {
  const lines = {};
  const hoursA = new Map(), hoursP = new Map(), hoursQ = new Map();
  const deptR = new Map();   // 25-11-2026: dept → reason → { value, n } (what each department owns)
  const reasonsA = new Map(), deptA = new Map(), reasonsQ = new Map(), stationQ = new Map();
  const models = new Map();
  let stops = 0;
  const addH = (m, h, v) => { const o = m.get(h) || { hour: h, value: 0, any: false }; o.value += v; o.any = true; m.set(h, o); };
  for (const l of IDS) {
    const rows = (R?.days || []).flatMap((d) => d.byLine[l]?.rows || []);
    const t = oleSum((R?.days || []).map((d) => d.byLine[l]?.total));
    const lr = { line: l, t, stops: 0, idle: 0, top: new Map(), rej: 0, rwk: 0, dis: 0, qty: t.qty || 0 };
    for (const r of rows) {
      if (r.future) continue;
      if (r.totalMin > 0 || r.qty > 0) { addH(hoursA, r.hour, 0); addH(hoursP, r.hour, 0); addH(hoursQ, r.hour, 0); }
      const e = r.e || normEntry(r.entry);
      for (const x of [...e.stops, ...e.losses]) {
        const min = Number(x.min) || 0; if (!min) continue;
        lr.stops += 1; stops += 1; lr.idle += min;
        const k = x.reason || 'Not given';
        lr.top.set(k, (lr.top.get(k) || 0) + min);
        const o = reasonsA.get(k) || { label: k, dept: x.dept || 'Not set', value: 0, n: 0, mm: new Map() }; o.value += min; o.n += 1; reasonsA.set(k, o);
        if (x.model) o.mm.set(x.model, (o.mm.get(x.model) || 0) + min);   // 20-11-2026: the models the reason was written on
        const dk = x.dept || 'Not set'; deptA.set(dk, (deptA.get(dk) || 0) + min); { const m = deptR.get(dk) || new Map(); const rk = x.reason || 'Not given'; const o = m.get(rk) || { label: rk, value: 0, n: 0 }; o.value += min; o.n += 1; m.set(rk, o); deptR.set(dk, m); }
      }
      addH(hoursA, r.hour, (r.lossMin || 0) + (r.stopMin || 0));
      if (r.speedMin > 0) addH(hoursP, r.hour, r.speedMin);
      // 23-11-2026: no separate rejection — the defects of the hour are its rework rows (and any old rejection row)
      for (const x of [...e.rejects, ...e.rework]) {
        const q = Number(x.qty) || 0; if (!q) continue;
        lr.rej += q; lr.dis += Number(x.dismantle) || 0;
        const k = x.reason || 'Not given';
        const o = reasonsQ.get(k) || { label: k, value: 0 }; o.value += q; reasonsQ.set(k, o);
        const sk = x.station || 'Station not given'; stationQ.set(sk, (stationQ.get(sk) || 0) + q);
        addH(hoursQ, r.hour, q);
        if (x.model) { const mk = `${l}|${x.model}`; const m = models.get(mk) || { key: mk, line: l, model: x.model, qty: 0, rej: 0, actSec: 0, stdSec: 0, stdQty: 0 }; m.rej += q; models.set(mk, m); }
      }
      for (const x of e.rework) lr.rwk += Number(x.qty) || 0;   // (rework pieces, also counted in the defects above)
      // models: pieces, run time share, std time
      if (r.qty > 0 && r.actualMin > 0) {
        for (const m0 of r.models || []) {
          const q = Number(m0.quantity) || 0; if (!q) continue;
          const mk = `${l}|${m0.model}`;
          const m = models.get(mk) || { key: mk, line: l, model: m0.model || '—', qty: 0, rej: 0, actSec: 0, stdSec: 0, stdQty: 0 };
          m.qty += q; m.actSec += r.actualMin * 60 * (q / r.qty);
          if (m0.std) { m.stdSec += q * m0.std; m.stdQty += q; }
          models.set(mk, m);
        }
      }
    }
    lr.topReason = [...lr.top.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    lines[l] = lr;
  }
  const hours = (m) => Array.from({ length: 24 }, (_, h) => m.get(h) || { hour: h, value: 0, any: false });
  const M = [...models.values()].map((o) => {
    const std = o.stdQty ? o.stdSec / o.stdQty : null, act = o.qty ? o.actSec / o.qty : null;
    const target = std ? Math.round(o.actSec / std) : null;
    const lostMin = std ? Math.max(0, (o.actSec * (o.stdQty / o.qty) - o.stdSec) / 60) : null;
    return { ...o, std, act, target, lostMin, perf: target ? o.qty / target : null };
  });
  return {
    lines, stops, M,
    hoursA: hours(hoursA), hoursP: hours(hoursP), hoursQ: hours(hoursQ),
    reasonsA: [...reasonsA.values()].map(({ mm, ...o }) => ({ ...o, models: [...mm.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) })).sort((a, b) => b.value - a.value),
    deptA: [...deptA.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    deptR: Object.fromEntries([...deptR.entries()].map(([d, m]) => [d, [...m.values()].sort((a, b) => b.value - a.value)])),
    reasonsQ: [...reasonsQ.values()].sort((a, b) => b.value - a.value),
    stationQ: [...stationQ.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
  };
}

/* ───────────── the page ───────────── */

const TITLE = { A: ['Availability', 'Run time ÷ planned time · where the time went'], P: ['Performance', 'speed vs standard cycle time'], Q: ['Quality', 'Good Qty ÷ Actual Qty · why pieces are rejected'] };

export default function OleFocusPage({ factor = 'A' }) {
  const ALL = useOleLines();
  const today = serverToday();
  const slot = useHeaderSlot();
  const [hand] = useState(() => takeOleFocus(factor));   // opened from OLE Overview: its period and line
  const [only, setOnly] = useState(() => (hand?.line ? String(hand.line) : 'all'));
  const IDS = useMemo(() => (only !== 'all' && ALL.includes(only) ? [only] : ALL), [only, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState(() => (hand ? { start: hand.start, end: hand.end } : { start: `${today.slice(0, 8)}01`, end: today }));   // from the sidebar: this month, as the MES
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS, pollEntries: true });
  const R0 = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }) : null),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, IDS]);
  // 25-11-2026: the finished days end at the line's last scan, as in the HPR / SAWM KPI (same Plan Target Qty)
  const lastScans = useLastScans({ R: R0, ids: IDS, today });
  const R = useMemo(() => (R0 && Object.keys(lastScans).length ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS, lastScans }) : R0), [R0, lastScans]); // eslint-disable-line react-hooks/exhaustive-deps // eslint-disable-line react-hooks/exhaustive-deps
  const co = useMemo(() => companyOf(D.al), [D.al]);   // 20-11-2026: the company of every model
  const F = useMemo(() => figures(R, IDS), [R, IDS]);
  const T = R?.total || oleSum([]);
  const kind = periodKind(range, today);
  const periodChip = kind === 'month' || (range.start.endsWith('-01') && range.start.slice(0, 7) === range.end.slice(0, 7))
    ? `${MONTH_FULL[Number(range.start.slice(5, 7)) - 1]} ${range.start.slice(0, 4)}` : range.start === range.end ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  const busy = !!R && (D.stale || D.loading);
  const allView = only === 'all' && IDS.length > 1;
  const who = allView ? plantsText(IDS) : groupNameOf(IDS);
  const seg = (on) => `h-8 whitespace-nowrap border-r border-[#BFBFBF] px-3 text-[14px] font-semibold last:border-r-0 ${on ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-[#EAF2FB]'}`;
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      {ALL.length > 1 && (
        <div className="flex overflow-hidden rounded-[3px] border border-[#BFBFBF]" role="group" aria-label="Lines">
          {['all', ...ALL].map((v) => <button key={v} type="button" aria-pressed={only === v} onClick={() => setOnly(v)} className={seg(only === v)}>{v === 'all' ? 'Overall' : `Line ${v}`}</button>)}
        </div>
      )}
      <PeriodBar header today={today} range={range} setRange={setRange} text={periodChip} busy={busy} />
    </div>
  );
  const [title, sub] = TITLE[factor];
  const lineList = IDS.map((l) => F.lines[l]);

  let body = null;
  if (factor === 'A') {
    const top = F.reasonsA[0];
    body = (
      <>
        <div className={`${card} grid grid-cols-2 gap-px overflow-hidden bg-[#D4D4D4] md:grid-cols-3 xl:grid-cols-5`}>
          <Kpi icon={GaugeIcon} label="Availability" value={pc(T.A)} note={`${hrs(T.actualMin)} run of ${hrs(T.plannedMin)} planned`} color={toneOf(T.A, 'A')} />
          <Kpi icon={Clock} label="Idle time" value={hrs(T.lossMin)} note={T.plannedMin ? `${pc(T.lossMin / T.plannedMin)} of planned time` : 'no planned time'} color={RED} />
          <Kpi icon={Hash} label="Stops written" value={nf(F.stops)} note="loss entries with minutes" color={NAVY} />
          <Kpi icon={Timer} label="Average stop" value={F.stops ? hrs(T.lossMin / F.stops) : '—'} note="idle time ÷ stops" color={AMBER} />
          <Kpi icon={AlertTriangle} label="Top reason" value={top ? top.label : '—'} note={top ? `${hrs(top.value)} · ${top.dept}` : 'no idle time'} color={RED} />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <Card title="Idle time reasons" sub="Pareto by time lost" className="xl:col-span-2"><Pareto rows={F.reasonsA} fmt={(v) => hrs(v)} time empty="No idle time in this period." color={RED} /></Card>
          <Card title="Share by department" sub="who owns the lost time"><Donut rows={F.deptA} fmt={(v) => hrs(v)} centre="idle time" empty="No idle time in this period." /><DeptOwners depts={F.deptA} byDept={F.deptR} fmt={(v) => hrs(v)} /></Card>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card title="When it happens" sub="idle time by hour of the day"><When hours={F.hoursA} fmt={(v) => `${Math.round(v)}`} unit=" min" empty="No idle time in this period." /></Card>
          <Card title="Lines with idle time" sub="time, how often, main reason">
            <Table label="Lines with idle time" rows={lineList} empty="No line in this period." cols={[
              { label: 'Line', get: (r) => <LineName l={r.line} /> },
              { label: 'Planned', right: true, get: (r) => hrs(r.t.plannedMin) },
              { label: 'Idle', right: true, get: (r) => <b className={r.t.lossMin > 0 ? 'text-[#C00000]' : ''}>{hrs(r.t.lossMin)}</b> },
              { label: 'Stops', right: true, get: (r) => nf(r.stops) },
              { label: 'Avg', right: true, get: (r) => (r.stops ? hrs(r.idle / r.stops) : '—') },
              { label: 'Availability', right: true, get: (r) => <Pct v={r.t.A} k="A" /> },
              { label: 'Main reason', get: (r) => r.topReason || '—' },
            ]} />
          </Card>
        </div>
        <Card title="All idle reasons" sub="minutes, share and owner">
          <Table label="All idle reasons" rows={F.reasonsA.map((r) => ({ ...r, key: r.label }))} empty="No idle time in this period." cols={[
            { label: '#', get: (r, i) => i + 1 },
            { label: 'Reason', get: (r) => <b>{r.label}</b> },
            { label: 'Model', get: (r) => (!r.models?.length ? <span className="text-[#999]">—</span>
              : r.models.length === 1 ? <span className="whitespace-nowrap">{co(r.models[0].name) && <span className="mr-1 text-[11px] font-bold uppercase text-[#777]">{co(r.models[0].name)}</span>}<b className="font-mono font-semibold">{r.models[0].name}</b></span>
              // 26-11-2026: every model named (no "+2"), one under the other with its time
              : <span className="flex flex-col gap-0.5">{r.models.map((m) => <span key={m.name} className="flex items-baseline justify-between gap-3 whitespace-nowrap"><span>{co(m.name) && <span className="mr-1 text-[11px] font-bold uppercase text-[#777]">{co(m.name)}</span>}<b className="font-mono font-semibold">{m.name}</b></span><span className="text-[12px] text-[#777]">{hrs(m.value)}</span></span>)}</span>) },
            { label: 'Department', get: (r) => r.dept },
            { label: 'Times', right: true, get: (r) => nf(r.n) },
            { label: 'Time lost', right: true, get: (r) => <b className="text-[#C00000]">{hrs(r.value)}</b> },
            { label: 'Share', right: true, get: (r) => { const s = T.lossMin ? r.value / F.reasonsA.reduce((a, x) => a + x.value, 0) : 0; return <span className="inline-flex items-center gap-2"><Bar v={s} color={RED} />{pc(s, 0)}</span>; } },
          ]} />
        </Card>
      </>
    );
  } else if (factor === 'P') {
    const target = planTargetOf(T) ?? 0;
    const behind = lineList.filter((r) => r.t.P != null && r.t.P < 1).length;
    const slow = F.M.filter((m) => m.lostMin != null && m.lostMin >= 1).sort((a, b) => b.lostMin - a.lostMin);
    body = (
      <>
        <div className={`${card} grid grid-cols-2 gap-px overflow-hidden bg-[#D4D4D4] md:grid-cols-3 xl:grid-cols-5`}>
          <Kpi icon={GaugeIcon} label="Performance" value={pc(T.P)} note="std time of output ÷ run time" color={toneOf(T.P, 'P')} />
          <Kpi icon={Target} label="Target qty" value={nf(target)} note="pcs planned in the run time" color={NAVY} />
          <Kpi icon={Package} label="Actual qty" value={nf(T.qty)} note={target ? `${pc(T.qty / target)} of target` : 'pcs made'} color={T.qty >= target ? GREEN : RED} />
          <Kpi icon={TrendingDown} label="Lines behind" value={`${behind} of ${lineList.length}`} note="below 100 % performance" color={behind ? RED : GREEN} />
          <Kpi icon={Timer} label="Lost vs standard" value={hrs(T.speedMin || 0)} note="slow running" color={AMBER} />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <Card title="Lines vs target" sub="target qty, actual qty, attainment" className="xl:col-span-1">
            <Table label="Lines vs target" rows={lineList} empty="No production in this period." cols={[
              { label: 'Line', get: (r) => <LineName l={r.line} /> },
              { label: 'Target', right: true, get: (r) => nf(planTargetOf(r.t) ?? 0) },
              { label: 'Actual', right: true, get: (r) => nf(r.t.qty) },
              { label: 'Perf.', right: true, get: (r) => <Pct v={r.t.P} k="P" /> },
            ]} />
          </Card>
          <Card title="Where the speed is lost" sub="Pareto of time lost by model" className="xl:col-span-2"><Pareto rows={slow.map((m) => ({ label: m.model, value: m.lostMin }))} fmt={(v) => hrs(v)} time color={AMBER} empty="No model ran slower than its standard." /></Card>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card title="When it runs slow" sub="time lost vs standard by hour of the day"><When hours={F.hoursP} fmt={(v) => `${Math.round(v)}`} unit=" min" color={AMBER} empty="No slow running in this period." /></Card>
          <Card title="Share of slow running by line" sub="time lost vs standard"><Donut rows={lineList.map((r) => ({ label: `Line ${r.line}`, value: Math.max(0, r.t.speedMin || 0) }))} fmt={(v) => hrs(v)} centre="lost vs std" empty="No slow running in this period." /></Card>
        </div>
        <Card title="Models running slower than standard" sub="most time lost first">
          <Table label="Models running slower than standard" rows={slow} empty="No production in this period." cols={[
            { label: 'Company', get: (r) => <CompanyCell name={co(r.model)} /> },
            { label: 'Model', get: (r) => <b className="font-mono">{r.model}</b> },
            { label: 'Line', get: (r) => <LineName l={r.line} /> },
            { label: 'Std cycle', right: true, get: (r) => (r.std ? `${Math.round(r.std * 10) / 10} s` : '—') },
            { label: 'Actual cycle', right: true, get: (r) => (r.act ? <span className={r.std && r.act > r.std ? 'font-bold text-[#C00000]' : ''}>{Math.round(r.act * 10) / 10} s</span> : '—') },
            { label: 'Target', right: true, get: (r) => (r.target == null ? '—' : nf(r.target)) },
            { label: 'Actual', right: true, get: (r) => nf(r.qty) },
            { label: 'Perf.', right: true, get: (r) => <Pct v={r.perf} k="P" /> },
            { label: 'Time lost', right: true, get: (r) => <b className="text-[#C00000]">{hrs(r.lostMin)}</b> },
          ]} />
        </Card>
      </>
    );
  } else {
    const worst = lineList.filter((r) => r.qty > 0).map((r) => ({ ...r, rate: r.rej / r.qty })).sort((a, b) => b.rate - a.rate)[0];
    const totRej = lineList.reduce((a, r) => a + r.rej, 0);
    const byModel = F.M.filter((m) => m.rej > 0).map((m) => ({ ...m, rate: m.qty ? m.rej / m.qty : null })).sort((a, b) => b.rej - a.rej);
    body = (
      <>
        <div className={`${card} grid grid-cols-2 gap-px overflow-hidden bg-[#D4D4D4] md:grid-cols-3 xl:grid-cols-5`}>
          <Kpi icon={GaugeIcon} label="Quality" value={pc(T.Q ?? (T.qty > 0 ? 1 : 0))} note="good qty ÷ actual qty" color={toneOf(T.Q ?? 1, 'Q')} />
          <Kpi icon={CheckCircle2} label="Good qty" value={nf((T.qty || 0) - (T.rejects || 0))} note={`of ${nf(T.qty)} made`} color={GREEN} />
          <Kpi icon={RotateCcw} label="Rework" value={nf(lineList.reduce((a, r) => a + r.rwk, 0))} note={T.qty ? `${pc(lineList.reduce((a, r) => a + r.rwk, 0) / T.qty, 2)} of production` : 'pcs reworked'} color={AMBER} />
          <Kpi icon={PackageX} label="Dismantled" value={nf(lineList.reduce((a, r) => a + r.dis, 0))} note="pcs dismantled" color={RED} />
          <Kpi icon={Activity} label="Worst line" value={worst && worst.rej ? `Line ${worst.line}` : '—'} note={worst && worst.rej ? `${pc(worst.rate, 2)} defects · ${nf(worst.rej)} pcs` : 'no rejection'} color={RED} />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <Card title="Why parts are reworked" sub="Pareto of the defects (rework)" className="xl:col-span-2"><Pareto rows={F.reasonsQ} unit=" pcs" color={RED} empty="No rework in this period." /></Card>
          <Card title="Defects by reason" sub="share of every reason"><Donut rows={F.reasonsQ} unit=" pcs" centre="pcs reworked" empty="No rework in this period." /></Card>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card title="When defects come" sub="pieces reworked by hour of the day"><When hours={F.hoursQ} unit=" pcs" empty="No rework in this period." /></Card>
          <Card title="Defects by station" sub="where it was caught"><Donut rows={F.stationQ} unit=" pcs" centre="pcs reworked" empty="No rework in this period." /></Card>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card title="Defects by line" sub="% of each line's actual qty">
            <Table label="Defects by line" rows={lineList} empty="No line in this period." cols={[
              { label: 'Line', get: (r) => <LineName l={r.line} /> },
              { label: 'Actual Qty', right: true, get: (r) => nf(r.qty) },
              { label: 'Defects', right: true, get: (r) => <b className={r.rej ? 'text-[#C00000]' : ''}>{nf(r.rej)}</b> },
              { label: 'Defect %', right: true, get: (r) => (r.qty ? <b className={r.rej ? 'text-[#C00000]' : 'text-[#138A36]'}>{pc(r.rej / r.qty, 2)}</b> : '—') },
              { label: 'Share', right: true, get: (r) => <span className="inline-flex items-center gap-2"><Bar v={totRej ? r.rej / totRej : 0} color={RED} />{pc(totRej ? r.rej / totRej : 0, 0)}</span> },
            ]} />
          </Card>
          <Card title="Defects by model" sub="most pieces first">
            <Table label="Defects by model" rows={byModel} empty="No rework written against a model." cols={[
              { label: 'Company', get: (r) => <CompanyCell name={co(r.model)} /> },
              { label: 'Model', get: (r) => <b className="font-mono">{r.model}</b> },
              { label: 'Line', get: (r) => <LineName l={r.line} /> },
              { label: 'Made', right: true, get: (r) => nf(r.qty) },
              { label: 'Defects', right: true, get: (r) => <b className="text-[#C00000]">{nf(r.rej)}</b> },
              { label: 'Defect %', right: true, get: (r) => (r.rate == null ? '—' : <b className="text-[#C00000]">{pc(r.rate, 2)}</b>) },
            ]} />
          </Card>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-label={`${title} focus`}>
      {slot ? createPortal(filters, slot) : <div className="flex min-w-0 flex-col gap-2">{filters}</div>}
      {D.err && <div role="alert" className="rounded-[3px] border border-slate-300 bg-slate-50 px-4 py-2 text-[14px] font-semibold text-slate-700">{D.err}</div>}
      {/* 24-11-2026: no navy band under the filters — the page title, the line buttons and the period above already say it */}
      {!R && !D.err ? <div className={`${card} px-4 py-10 text-center text-[15px] text-[#555]`}>Reading {who} · {periodChip} …</div> : body}
    </div>
  );
}

export const AvailabilityFocusPage = () => <OleFocusPage factor="A" />;
export const PerformanceFocusPage = () => <OleFocusPage factor="P" />;
export const QualityFocusPage = () => <OleFocusPage factor="Q" />;
