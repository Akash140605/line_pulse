import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, oleSum, hm, okFrom, watchFrom, oleConfig } from '../utils/ole';
import { LINE_COLOR, nf, dmy, p2, useOleLines, useOleData, groupNameOf, plantsText } from '../components/OleParts';
import { PeriodBar, periodKind } from '../components/PeriodBar';
import { takeOleDrill } from '../utils/drillLink';
import HeaderBar, { useHeaderSlot } from '../components/HeaderBar';

/*
 * OLE drill-down (18-11-2026): OLE of the period → one factor (Availability / Performance / Quality) → line → day → hour
 * → model → its entries. Every level shows A · P · Q · OLE and the loss of the chosen factor, worst first, and the reasons
 * behind it; a click goes one level down, the path on top goes back. Same maths as Overall OLE (utils/ole.js).
 */
const card = 'rounded-md border border-slate-300 bg-white shadow-sm';
const FACTORS = {
  A: { name: 'Availability', loss: 'Idle time', unit: 'min', of: (t) => t.lossMin || 0 },
  P: { name: 'Performance', loss: 'Performance loss', unit: 'min', of: (t) => t.speedMin || 0 },
  Q: { name: 'Quality', loss: 'Rejected', unit: 'pcs', of: (t) => t.rejects || 0 },
};
const pc = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const tone = (v) => (v == null ? 'text-slate-400' : v >= okFrom() ? 'text-emerald-700' : v >= watchFrom() ? 'text-amber-700' : 'text-red-700');
const bar = (v) => (v == null ? '#CBD5E1' : v >= okFrom() ? '#059669' : v >= watchFrom() ? '#D97706' : '#DC2626');
const lossTxt = (f, v) => (FACTORS[f].unit === 'min' ? hm(Math.max(0, v)) : `${nf(v)} pcs`);

/** reasons of the chosen factor in some hour rows: A = idle rows (no model), P = model rows + not written, Q = defects */
function reasonsOf(f, rows) {
  const m = new Map();
  const add = (k, dept, v) => { if (!(v > 0)) return; const o = m.get(k) || { k, dept, v: 0, n: 0 }; o.v += v; o.n += 1; m.set(k, o); };
  let written = 0, speed = 0;
  const modelInA = oleConfig().lossIn === 'avail';   // admin choice: model loss counts in Availability
  for (const r of rows) {
    const e = r.e || {};
    if (f === 'A') {
      for (const x of e.stops || []) add(x.reason || 'Not given', x.dept, x.min);
      for (const x of e.losses || []) if (!x.model || modelInA) add(x.reason || 'Not given', x.dept, x.min);
      if (r.idleAuto > 0) add('No scans, nothing written', '', r.idleAuto);
    } else if (f === 'P') {
      for (const x of e.losses || []) if (x.model && !modelInA) { add(x.reason || 'Not given', x.dept, x.min); written += x.min; }
      speed += r.speedMin || 0;
    } else {
      for (const x of e.rejects || []) add(`${x.reason || 'Not given'}${x.station ? ` · ${x.station}` : ''}`, x.dept, x.qty);
    }
  }
  const out = [...m.values()].sort((a, b) => b.v - a.v);
  if (f === 'P' && speed - written >= 1) out.push({ k: 'Not written (slow running)', dept: '', v: speed - written, n: 0, open: true });
  return out;
}

function Kpi({ k, label, t, on, onPick }) {
  const v = k === 'ole' ? t.ole : t[k];
  return (
    <button type="button" onClick={onPick} disabled={!onPick} aria-pressed={on} aria-label={`${label} ${pc(v)}`}
      className={`min-w-0 rounded-md border px-4 py-3 text-left ${on ? 'border-dixon-navy bg-blue-50 ring-2 ring-dixon-navy' : 'border-slate-300 bg-white'} ${onPick ? 'hover:border-blue-500' : ''}`}>
      <div className="text-fs-13 font-bold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`font-mono text-fs-30 font-extrabold tabular-nums ${tone(v)}`}>{pc(v)}</div>
      {k !== 'ole' && <div className="text-fs-13 font-semibold text-slate-600">{FACTORS[k].loss}: <b className="font-mono text-slate-900">{lossTxt(k, FACTORS[k].of(t))}</b></div>}
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full" style={{ width: `${Math.min(100, (v ?? 0) * 100)}%`, background: bar(v) }} /></div>
    </button>
  );
}

export default function OleDrillPage() {
  const ALL = useOleLines();
  const today = serverToday();
  const slot = useHeaderSlot();
  // opened from Overall OLE (a factor or a line clicked there): its factor, line and period
  const [open0] = useState(() => takeOleDrill());
  const [range, setRange] = useState(open0 ? { start: open0.start, end: open0.end } : { start: today, end: today });
  const [path, setPath] = useState({ f: open0?.f || 'P', line: open0?.line && ALL.includes(String(open0.line)) ? String(open0.line) : null, date: null, hour: null, model: null });
  const settings = useAllLineSettings(ALL);
  const D = useOleData({ start: range.start, end: range.end, ids: ALL, pollEntries: true });
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL }) : null),
    [D.al, D.ent, settings, range.start, range.end, today, D.endMin, ALL]);
  const f = path.f;
  const F = FACTORS[f];
  const set = (p) => setPath((x) => ({ ...x, ...p }));
  const setRange2 = (r) => { setRange(r); setPath((x) => ({ f: x.f, line: null, date: null, hour: null, model: null })); };
  const kind = periodKind(range, today);
  const periodText = `${{ today: 'Today', yesterday: 'Yesterday', day: 'Day', week: 'Week', month: 'Month', range: 'Range' }[kind]} · ${range.start === range.end ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`}`;

  // hour rows of a scope (line / date / hour), each with its line and date
  const rowsOf = (line, date, hour) => (R?.days || []).filter((d) => !date || d.date === date).flatMap((d) => (line ? [line] : ALL)
    .flatMap((l) => (d.byLine[l]?.rows || []).filter((r) => !r.future && (hour == null || r.hour === hour)).map((r) => ({ ...r, line: l, date: d.date }))));
  const scopeRows = useMemo(() => rowsOf(path.line, path.date, path.hour), [R, path.line, path.date, path.hour]); // eslint-disable-line react-hooks/exhaustive-deps
  const T = useMemo(() => oleSum(scopeRows), [scopeRows]);

  // the list of the level below: lines → days → hours → models
  const level = !path.line ? 'line' : !path.date ? 'day' : path.hour == null ? 'hour' : !path.model ? 'model' : 'entry';
  const items = useMemo(() => {
    if (!R) return [];
    if (level === 'line') return ALL.map((l) => { const t = oleSum(rowsOf(l)); return { key: l, label: `Line ${l}`, t, color: LINE_COLOR[l], go: () => set({ line: l }) }; });
    if (level === 'day') return R.days.map((d) => { const t = oleSum(rowsOf(path.line, d.date)); return { key: d.date, label: dmy(d.date), t, go: () => set({ date: d.date }) }; }).filter((x) => x.t.totalMin > 0 || x.t.qty > 0);
    if (level === 'hour') return rowsOf(path.line, path.date).map((r) => ({ key: r.hour, label: `${p2(r.hour)}:00–${p2(r.hour + 1)}:00`, t: r, go: () => set({ hour: r.hour }) }));
    if (level === 'model') {
      const r = scopeRows[0]; if (!r) return [];
      return (r.models || []).map((m) => {
        const loss = (r.e?.losses || []).filter((x) => x.model === m.model).reduce((a, x) => a + x.min, 0);
        const rej = (r.e?.rejects || []).filter((x) => x.model === m.model).reduce((a, x) => a + x.qty, 0);
        return { key: m.model, label: m.model, qty: Number(m.quantity) || 0, std: m.std, loss, rej, go: () => set({ model: m.model }) };
      }).sort((a, b) => b.qty - a.qty);
    }
    return [];
  }, [R, level, path.line, path.date, path.hour, scopeRows]); // eslint-disable-line react-hooks/exhaustive-deps
  // worst first for the chosen factor (a line / day / hour without a value goes last)
  const sorted = level === 'model' ? items : [...items].sort((a, b) => (a.t[f] ?? 9) - (b.t[f] ?? 9));
  const reasons = useMemo(() => {
    const rs = path.model ? scopeRows.map((r) => ({ ...r, e: { ...r.e, stops: [], losses: (r.e?.losses || []).filter((x) => x.model === path.model), rejects: (r.e?.rejects || []).filter((x) => x.model === path.model) }, speedMin: 0, idleAuto: 0 })) : scopeRows;
    return reasonsOf(f, rs);
  }, [f, scopeRows, path.model]);
  const entriesOfModel = path.model && scopeRows[0] ? [
    ...(scopeRows[0].e?.losses || []).filter((x) => x.model === path.model).map((x) => ['Loss', x.reason, x.dept, `${x.min} min`, x.part]),
    ...(scopeRows[0].e?.rejects || []).filter((x) => x.model === path.model).map((x) => ['Rejection', x.reason, x.dept, `${x.qty} pcs`, x.station]),
    ...(scopeRows[0].e?.rework || []).filter((x) => x.model === path.model).map((x) => ['Rework', x.reason, x.dept, `${x.qty} pcs`, x.station]),
  ] : [];

  const crumbs = [
    [`${ALL.length > 1 ? plantsText(ALL) : groupNameOf(ALL)} · ${F.name}`, () => setPath({ f, line: null, date: null, hour: null, model: null })],
    ...(path.line ? [[`Line ${path.line}`, () => set({ date: null, hour: null, model: null })]] : []),
    ...(path.date ? [[dmy(path.date), () => set({ hour: null, model: null })]] : []),
    ...(path.hour != null ? [[`${p2(path.hour)}:00–${p2(path.hour + 1)}:00`, () => set({ model: null })]] : []),
    ...(path.model ? [[path.model, () => {}]] : []),
  ];
  const back = () => set(path.model ? { model: null } : path.hour != null ? { hour: null } : path.date ? { date: null } : { line: null });
  const levelName = { line: 'Line by line', day: 'Day by day', hour: 'Hour by hour', model: 'Model by model' }[level];

  return (
    <div className="flex flex-col gap-3" aria-label="OLE drill-down">
      <HeaderBar label="Drill-down filters">
        {slot ? <PeriodBar header today={today} range={range} setRange={setRange2} text={periodText} busy={!!R && (D.stale || D.loading)} />
          : <div className="flex w-full min-w-0 flex-col"><PeriodBar today={today} range={range} setRange={setRange2} text={periodText} busy={!!R && (D.stale || D.loading)} /></div>}
      </HeaderBar>
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}
      {!R && !D.err && <div role="status" className={`${card} px-4 py-10 text-center text-fs-14 font-semibold text-slate-500`}><span className="lp-dots">Reading the lines</span></div>}
      {R && (
        <>
          <nav aria-label="Drill path" className="flex flex-wrap items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
            {crumbs.map(([t, go], i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight size={14} className="text-blue-400" aria-hidden />}
                <button type="button" onClick={go} disabled={i === crumbs.length - 1}
                  className={`rounded-full px-2.5 py-0.5 text-fs-14 font-bold ${i === crumbs.length - 1 ? 'bg-dixon-navy text-white' : 'text-blue-800 hover:bg-blue-100'}`}>{t}</button>
              </React.Fragment>
            ))}
            {crumbs.length > 1 && <button type="button" onClick={back} className="ml-auto h-7 rounded-md border border-blue-300 bg-white px-2.5 text-fs-13 font-bold text-blue-800 hover:bg-blue-100">‹ Back</button>}
          </nav>

          <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="OLE of the scope">
            <Kpi k="ole" label="OLE" t={T} />
            {['A', 'P', 'Q'].map((k) => <Kpi key={k} k={k} label={FACTORS[k].name} t={T} on={f === k} onPick={() => set({ f: k })} />)}
          </section>

          <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {level !== 'entry' ? (
              <section className={`${card} min-w-0 overflow-hidden`} aria-label={levelName}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-2">
                  <h3 className="text-fs-16 font-extrabold text-dixon-navy">{levelName}</h3>
                  {level !== 'model' && <span className="text-fs-12 font-semibold text-slate-500">{F.name} · lowest first</span>}
                </div>
                {!sorted.length ? <p className="px-4 py-8 text-center text-fs-14 text-slate-500">Nothing in this period.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-fs-14" aria-label={`${levelName} table`}>
                      <thead>
                        <tr className="bg-[#e3ecf8] text-left text-fs-12 text-dixon-navy">
                          {(level === 'model' ? ['Model', 'Qty', 'Std cycle', 'Loss written', 'Rejected', ''] : [level === 'line' ? 'Line' : level === 'day' ? 'Day' : 'Hour', F.name, F.loss, 'A', 'P', 'Q', 'OLE', 'Qty', ''])
                            .map((h, i) => <th key={h + i} className={`whitespace-nowrap border-b border-slate-300 px-3 py-2 font-extrabold ${i ? 'text-right' : ''}`}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((x) => level === 'model' ? (
                          <tr key={x.key} className="cursor-pointer border-b border-slate-100 hover:bg-blue-50" onClick={x.go} aria-label={`Model ${x.label}`}>
                            <td className="px-3 py-2 font-mono font-bold">{x.label}</td>
                            <td className="px-3 text-right font-mono">{nf(x.qty)}</td>
                            <td className="px-3 text-right font-mono">{x.std ? `${Math.round(x.std * 10) / 10} s` : '—'}</td>
                            <td className="px-3 text-right font-mono">{x.loss ? `${x.loss} min` : '—'}</td>
                            <td className="px-3 text-right font-mono">{x.rej ? `${x.rej} pcs` : '—'}</td>
                            <td className="px-3 text-right text-blue-700"><ChevronRight size={16} className="inline" aria-hidden /></td>
                          </tr>
                        ) : (
                          <tr key={x.key} className="cursor-pointer border-b border-slate-100 hover:bg-blue-50" onClick={x.go} aria-label={`${levelName} ${x.label}`}>
                            <td className="whitespace-nowrap px-3 py-2 font-bold">{x.label}</td>
                            <td className="px-3">
                              <div className="flex items-center justify-end gap-2">
                                <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-slate-100 sm:block"><div className="h-full" style={{ width: `${Math.min(100, (x.t[f] ?? 0) * 100)}%`, background: bar(x.t[f]) }} /></div>
                                <b className={`font-mono ${tone(x.t[f])}`}>{pc(x.t[f])}</b>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 text-right font-mono">{lossTxt(f, F.of(x.t))}</td>
                            {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-3 text-right font-mono ${tone(x.t[k])}`}>{pc(x.t[k])}</td>)}
                            <td className="px-3 text-right font-mono">{nf(x.t.qty)}</td>
                            <td className="px-3 text-right text-blue-700"><ChevronRight size={16} className="inline" aria-hidden /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (
              <section className={`${card} min-w-0 overflow-hidden`} aria-label="Entries of the model">
                <h3 className="border-b border-slate-200 px-4 py-2 text-fs-16 font-extrabold text-dixon-navy">{path.model} · what was written</h3>
                {!entriesOfModel.length ? <p className="px-4 py-8 text-center text-fs-14 text-slate-500">Nothing written for this model in this hour.</p> : (
                  <table className="w-full text-fs-14" aria-label="Entries of the model table">
                    <thead><tr className="bg-[#e3ecf8] text-left text-fs-12 text-dixon-navy">{['Kind', 'Reason', 'Department', 'Value', 'Part / station'].map((h) => <th key={h} className="border-b border-slate-300 px-3 py-2 font-extrabold">{h}</th>)}</tr></thead>
                    <tbody>{entriesOfModel.map((r, i) => <tr key={i} className="border-b border-slate-100">{r.map((c, j) => <td key={j} className={`px-3 py-2 ${j === 3 ? 'font-mono font-bold' : ''}`}>{c || '—'}</td>)}</tr>)}</tbody>
                  </table>
                )}
              </section>
            )}

            <section className={`${card} min-w-0 overflow-hidden`} aria-label={`${F.loss} reasons`}>
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-2">
                <h3 className="text-fs-16 font-extrabold text-dixon-navy">{F.loss} · reasons</h3>
                <span className="font-mono text-fs-14 font-bold text-slate-900">{lossTxt(f, path.model ? reasons.reduce((a, r) => a + r.v, 0) : F.of(T))}</span>
              </div>
              {!reasons.length ? <p className="px-4 py-6 text-center text-fs-14 text-slate-500">No {F.loss.toLowerCase()} here.</p> : (
                <ul className="divide-y divide-slate-100 px-4 py-1">
                  {reasons.map((r) => {
                    const tot = reasons.reduce((a, x) => a + x.v, 0);
                    return (
                      <li key={r.k} className="py-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`min-w-0 truncate text-fs-14 font-semibold ${r.open ? 'italic text-amber-800' : 'text-slate-800'}`} title={r.k}>{r.k}{r.dept && <span className="ml-1.5 text-fs-12 font-normal text-slate-500">{r.dept}</span>}</span>
                          <span className="shrink-0 font-mono text-fs-14 font-bold tabular-nums">{lossTxt(f, r.v)}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${tot ? Math.max(2, (r.v / tot) * 100) : 0}%`, background: r.open ? '#D97706' : '#2563EB' }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
