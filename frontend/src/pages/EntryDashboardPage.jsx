import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Download, CheckCircle2, Clock, PencilLine, Sunrise } from 'lucide-react';
import { oleDayLines, modelTimeOfHour } from '../utils/ole';
import { lineDayStatus, sumStatus, pendingList, noLossHour, lostWhole } from '../utils/entryStatus';
import { setEntryJump } from '../utils/entryJump';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { LINE_COLOR, nf, dmy, p2, useOleLines, useOleData, groupNameOf } from '../components/OleParts';
import { PeriodBar, periodKind } from '../components/PeriodBar';
import HeaderBar, { segGroup, segBtn, useHeaderSlot } from '../components/HeaderBar';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';

/*
 * Entry dashboard (18-11-2026): what the lines wrote on Loss entry and Quality entry, for a period —
 * loss (planned stop + unplanned loss, minutes), rejection and rework (pieces): totals, by reason / department / line,
 * and every entry with its hour, model, who filled it and when. Reads only the entries (no line database).
 */
const card = 'rounded-md border border-slate-300 bg-white shadow-sm';
const TABS = [
  { k: 'loss', label: 'Loss', unit: 'min', num: 'min', what: 'Reason', color: '#DC2626' },
  { k: 'rej', label: 'Rejection', unit: 'pcs', num: 'qty', what: 'Defect', color: '#F97316' },
  { k: 'rwk', label: 'Rework', unit: 'pcs', num: 'qty', what: 'Defect', color: '#2563EB' },
];
const hrsTxt = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${p2(Math.round(min % 60))} m` : `${Math.round(min)} min`);
const valTxt = (t, v) => (t.unit === 'min' ? hrsTxt(v) : `${nf(v)} pcs`);
const ent = (n) => `${n} entr${n === 1 ? 'y' : 'ies'}`;
const atTxt = (s) => (s ? `${dmy(String(s).slice(0, 10))} ${String(s).slice(11, 16)}` : '—');

/** the entries of the period as flat rows, one per written row */
function flatten(entries, ids) {
  const out = { loss: [], rej: [], rwk: [] };
  let hours = 0;
  for (const [key, e] of Object.entries(entries || {})) {
    const [date, line, hour] = key.split('|');
    if (!ids.includes(String(line))) continue;
    const base = { date, line: String(line), hour: Number(hour), by: e.updatedBy || '', at: e.updatedAt || '', note: e.note || '' };
    let any = false;
    for (const x of e.stops || []) { out.loss.push({ ...base, kind: 'Planned stop', model: x.model || '', reason: x.reason || '', dept: x.dept || '', v: Number(x.min) || 0, part: '' }); any = true; }
    for (const x of e.losses || []) { out.loss.push({ ...base, kind: 'Unplanned loss', model: x.model || '', reason: x.reason || '', dept: x.dept || '', v: Number(x.min) || 0, part: x.part || '' }); any = true; }
    for (const x of e.rejects || []) { out.rej.push({ ...base, station: x.station || '', model: x.model || '', reason: x.reason || '', dept: x.dept || '', v: Number(x.qty) || 0 }); any = true; }
    for (const x of e.rework || []) { out.rwk.push({ ...base, station: x.station || '', model: x.model || '', reason: x.reason || '', dept: x.dept || '', v: Number(x.qty) || 0 }); any = true; }
    if (any) hours += 1;
  }
  const order = (a, b) => (b.date + p2(b.hour)).localeCompare(a.date + p2(a.hour)) || a.line.localeCompare(b.line);
  for (const k of Object.keys(out)) out[k].sort(order);
  return { ...out, hours };
}
const groupBy = (rows, f) => {
  const m = new Map();
  for (const r of rows) { const k = f(r) || '—'; const o = m.get(k) || { k, v: 0, n: 0 }; o.v += r.v; o.n += 1; m.set(k, o); }
  return [...m.values()].sort((a, b) => b.v - a.v);
};

function Kpi({ label, value, sub, color }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-fs-13 font-bold uppercase tracking-wide text-slate-600">{color && <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}{label}</div>
      <div className="mt-0.5 truncate font-mono text-fs-28 font-extrabold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="lp-clamp2 text-fs-13 font-semibold text-slate-600">{sub}</div>}
    </div>
  );
}

/** a ranked list with a bar per row (share of the total) */
function Ranked({ title, rows, t, line = false }) {
  const tot = rows.reduce((a, r) => a + r.v, 0);
  return (
    <section className={`${card} min-w-0 overflow-hidden`} aria-label={title}>
      <h3 className="border-b border-slate-200 px-4 py-2 text-fs-15 font-extrabold text-dixon-navy">{title}</h3>
      {!rows.length ? <p className="px-4 py-6 text-center text-fs-14 text-slate-500">Nothing written.</p> : (
        <ul className="divide-y divide-slate-100 px-4 py-1">
          {rows.slice(0, 10).map((r) => (
            <li key={r.k} className="py-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-fs-14 font-semibold text-slate-800" title={r.k}>
                  {r.k}
                </span>
                <span className="shrink-0 font-mono text-fs-14 font-bold tabular-nums text-slate-900">{valTxt(t, r.v)} <span className="text-fs-12 font-semibold text-slate-500">· {r.n}</span></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${tot ? Math.max(2, (r.v / tot) * 100) : 0}%`, background: t.color }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// 23-11-2026: entry status — what is filled and what is left, line by line and hour by hour
// 25-11-2026: colours readable as text on their cell (WCAG AA): darker green, dark text on amber, darker greys
const ST = {
  done: { bg: '#047857', fg: '#fff', t: 'Done' },
  auto: { bg: '#A7F3D0', fg: '#065F46', t: 'No loss (automatic)' },
  pending: { bg: '#F59E0B', fg: '#1F2937', t: 'Pending' },
  running: { bg: '#BAE6FD', fg: '#075985', t: 'Running hour' },
  na: { bg: '#F1F5F9', fg: '#4B5563', t: 'Not needed' },
  future: { bg: '#fff', fg: '#64748B', t: 'Not yet' },
};
const pctTxt = (p) => (p == null ? '—' : `${Math.floor(p * 100)}%`);
const pctColor = (p) => (p == null ? '#64748B' : p >= 0.999 ? '#047857' : p >= 0.8 ? '#B45309' : '#DC2626');
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

function Meter({ label, c, sub, icon: Icon }) {
  const p = c.pct;
  return (
    <div className="min-w-0 bg-white px-4 py-3" data-testid={`meter-${label.toLowerCase()}`}>
      <div className="flex items-center gap-1.5 text-fs-13 font-bold uppercase tracking-wide text-slate-600">{Icon && <Icon size={14} aria-hidden />}{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="font-mono text-fs-28 font-extrabold tabular-nums" style={{ color: pctColor(p) }}>{pctTxt(p)}</span>
        <span className="lp-clamp2 text-fs-13 font-semibold text-slate-600">{sub ?? `${c.done} of ${c.need}`}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${label} complete`} aria-valuenow={p == null ? 0 : Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all" style={{ width: `${p == null ? 0 : Math.max(2, p * 100)}%`, background: pctColor(p) }} />
      </div>
    </div>
  );
}

/** one hour cell: L (loss) and Q (quality) halves */
function Cell({ h, onOpen }) {
  const L = ST[h.loss], Q = ST[h.quality];
  const fut = h.loss === 'future';
  const open = !fut && (h.loss === 'pending' || h.quality === 'pending' || h.loss === 'done' || h.quality === 'done' || h.loss === 'auto');
  const tip = `${p2(h.hour)}:00–${p2(h.hour + 1)}:00 · Loss: ${L.t} · Quality: ${Q.t}`;
  const inner = (
    <span className="flex h-9 w-full overflow-hidden rounded-md border border-slate-200 text-fs-11 font-extrabold">
      <span className="flex flex-1 items-center justify-center" style={{ background: L.bg, color: L.fg }}>L</span>
      <span className="flex flex-1 items-center justify-center" style={{ background: Q.bg, color: Q.fg, borderLeft: '1px solid rgba(255,255,255,.7)' }}>Q</span>
    </span>
  );
  return open
    ? <button type="button" onClick={onOpen} title={`${tip} — click to open`} aria-label={tip} className="lp-ed-hit block w-full rounded-md">{inner}</button>
    : <span title={tip} aria-label={tip} className="block w-full">{inner}</span>;
}

/**
 * One day: an hour that looks like "No loss" by its totals is checked model by model from its scans, as the Loss entry
 * does (a fast model never hides a slow one) — only those hours are read, once per pieces count.
 * → { line: { hour: minutes lost } }
 */
function useLostCheck(date, LD, IDS, today, D) {
  const cache = useRef(new Map());
  const [ver, setVer] = useState(0);
  const isToday = date === today;
  const jobs = [];
  for (const l of date ? IDS : []) {
    const L = LD?.[l]; if (!L?.ok) continue;
    const endM = isToday ? (D.endMin?.[l] ?? D.nowMin) : null;
    const lastProd = L.rows.filter((r) => !r.extra && r.qty > 0).map((r) => r.hour).pop() ?? null;
    const lastH = isToday && D.endMin?.[l] != null ? Math.floor(D.endMin[l] / 60) : lastProd;
    for (const r of L.rows) {
      if (r.extra || r.future || !noLossHour(r) || r.e.noLoss || r.e.stops.length + r.e.losses.length) continue;
      if (isToday && (r.hour + 1) * 60 > (D.nowMin ?? 0)) continue;
      jobs.push({ l, r, k: `${l}|${date}|${r.hour}|${r.qty}`, endM, lastH, shift: L.shift });
    }
  }
  const needKey = jobs.filter((j) => !cache.current.has(j.k)).map((j) => j.k).join(',');
  useEffect(() => {
    const todo = jobs.filter((j) => !cache.current.has(j.k));
    if (!todo.length) return undefined;
    let gone = false; const c = new AbortController();
    const worker = async () => {
      while (todo.length && !gone) {
        const j = todo.shift();
        try {
          const d = await api.hourDetail(date, j.r.hour, { line: j.l }, { signal: c.signal });
          const sc = Array.isArray(d?.scans) ? d.scans : [];
          const mt = sc.length ? modelTimeOfHour({ hour: j.r.hour, scans: sc, models: j.r.models, stops: j.r.e.stops, totalMin: j.r.totalMin, nowMin: j.endM, shift: j.shift, endAtLastScan: j.r.hour === j.lastH }) : null;
          if (!gone) cache.current.set(j.k, mt && !mt.estimated ? lostWhole(mt) : null);
        } catch (x) { if (!gone && x?.name !== 'AbortError') cache.current.set(j.k, null); }
      }
    };
    Promise.all([worker(), worker()]).then(() => { if (!gone) setVer((v) => v + 1); });
    return () => { gone = true; c.abort(); };
  }, [needKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = {};
  for (const j of jobs) { const v = cache.current.get(j.k); (out[j.l] ||= {})[j.r.hour] = v === undefined ? null : v; }
  return { lost: out, busy: needKey.length > 0, ver };
}

function EntryStatus({ IDS, range, today, D, settings, onOpen, canOpen }) {
  const dates = useMemo(() => { const o = []; for (let d = range.start, k = 0; d <= range.end && k < 31 && d <= today; d = addDays(d, 1), k += 1) o.push(d); return o; }, [range.start, range.end, today]);
  const LDs = useMemo(() => (D.al ? dates.map((d) => ({ date: d, LD: oleDayLines({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, date: d, nowMin: d === today ? D.endMin : null, ids: IDS }) })) : []),
    [D.al, D.ent, D.endMin, settings, IDS, dates, today]);
  // one day: the "No loss by itself" hours are checked model by model (the Loss entry's own rule)
  const chk = useLostCheck(LDs.length === 1 ? LDs[0].date : null, LDs[0]?.LD, IDS, today, D);
  const days = useMemo(() => LDs.map(({ date: d, LD }) => {
    const isToday = d === today;
    return { date: d, lines: IDS.map((l) => ({ ...lineDayStatus(LD[l], { morning: !!D.ent.setup?.[`${d}|${l}`], nowMin: D.nowMin, lastMin: isToday ? (D.endMin?.[l] ?? null) : null, today: isToday, lost: LDs.length === 1 ? (chk.lost[l] || {}) : null }), name: LD[l]?.name || `Line ${l}` })) };
  }), [LDs, chk.ver, chk.lost, D.ent.setup, D.nowMin, D.endMin, IDS, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = sumStatus(days.flatMap((d) => d.lines.filter((x) => x.ok !== false)));
  const left = pendingList(days);
  const single = days.length === 1 ? days[0] : null;
  const hours = single ? [...new Set(single.lines.flatMap((x) => x.hours.map((h) => h.hour)))].sort((a, b) => a - b) : [];
  // where a click goes: the combined page when this login has it, else the page of that part
  const target = (what) => (what === 'Morning' ? 'daily' : canOpen.includes('lqentry') ? 'lqentry' : what === 'Quality' ? 'qentry' : 'oleentry');
  const go = (line, date, hour, what = 'Loss') => {
    const pg = target(what);
    if (!onOpen || !canOpen.includes(pg)) return;
    setEntryJump({ line, date, hour }); onOpen(pg);
  };
  const can = !!onOpen && (canOpen.includes('lqentry') || canOpen.includes('oleentry') || canOpen.includes('qentry'));

  if (!D.al) return <section className={`${card} px-4 py-6 text-center text-fs-14 text-slate-500`} aria-label="Entry status">Reading the lines…</section>;
  return (
    <section className={`${card} overflow-hidden`} aria-label="Entry status">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <h3 className="min-w-0 flex-1 text-fs-16 font-extrabold text-dixon-navy" style={{ minWidth: 220 }}>Entry status — what is filled and what is left</h3>
        {left.length > 0 && can && (
          <button type="button" onClick={() => go(left[0].line, left[0].date, left[0].hour, left[0].what)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-dixon-navy px-3 text-fs-13 font-bold text-white hover:bg-blue-900">
            <PencilLine size={14} aria-hidden />Fill next: Line {left[0].line}{left[0].hour != null ? ` · ${p2(left[0].hour)}:00` : ''} · {left[0].what}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-200 lg:grid-cols-4">
        <Meter label="Overall" c={all.all} icon={CheckCircle2} sub={`${all.all.left} left`} />
        <Meter label="Loss" c={all.loss} icon={Clock} />
        <Meter label="Quality" c={all.quality} icon={CheckCircle2} />
        <Meter label="Morning" c={{ ...all.morning, pct: all.morning.need ? all.morning.done / all.morning.need : null }} icon={Sunrise} sub={`${all.morning.done} of ${all.morning.need} line-days`} />
      </div>

      {single ? (
        <div className="overflow-x-auto p-3">
          <table className="w-full border-separate text-fs-13" style={{ borderSpacing: '4px' }} aria-label="Entry status by line and hour">
            <thead>
              <tr className="text-fs-12 text-slate-600">
                <th className="px-2 text-left font-extrabold" style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff' }}>Line</th>
                <th className="px-1 font-extrabold">Morning</th>
                {hours.map((h) => <th key={h} className="px-0.5 text-center font-mono font-bold" style={{ minWidth: 46 }}>{p2(h)}–{p2(h + 1)}</th>)}
                <th className="px-2 text-right font-extrabold">Loss</th>
                <th className="px-2 text-right font-extrabold">Quality</th>
                <th className="px-2 text-right font-extrabold">Done</th>
              </tr>
            </thead>
            <tbody>
              {single.lines.map((s) => (
                <tr key={s.line} data-testid={`status-line-${s.line}`}>
                  <td className="whitespace-nowrap px-2 font-extrabold text-slate-900" style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff' }}><i aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: LINE_COLOR[s.line] || '#334155' }} />{s.name}</td>
                  <td className="px-1 text-center">
                    {s.morning ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-fs-12 font-bold text-emerald-800"><CheckCircle2 size={12} aria-hidden />Saved</span>
                      : <button type="button" disabled={!onOpen || !canOpen.includes('daily')} onClick={() => go(s.line, single.date, null, 'Morning')} className="rounded-full bg-amber-100 px-2 py-0.5 text-fs-12 font-bold text-amber-800 disabled:cursor-default">Pending</button>}
                  </td>
                  {s.ok === false ? <td colSpan={hours.length} className="px-2 text-fs-12 text-slate-500">Line not answering — status after it answers</td>
                    : hours.map((h) => { const x = s.hours.find((y) => y.hour === h); return <td key={h} className="p-0">{x ? <Cell h={x} onOpen={() => go(s.line, single.date, h)} /> : null}</td>; })}
                  <td className="whitespace-nowrap px-2 text-right font-mono font-bold" style={{ color: pctColor(s.loss.pct) }}>{pctTxt(s.loss.pct)}<span className="block text-fs-11 font-semibold text-slate-500">{s.loss.done}/{s.loss.need}</span></td>
                  <td className="whitespace-nowrap px-2 text-right font-mono font-bold" style={{ color: pctColor(s.quality.pct) }}>{pctTxt(s.quality.pct)}<span className="block text-fs-11 font-semibold text-slate-500">{s.quality.done}/{s.quality.need}</span></td>
                  <td className="whitespace-nowrap px-2 text-right font-mono text-fs-16 font-extrabold" style={{ color: pctColor(s.all.pct) }}>{pctTxt(s.all.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-fs-12 font-semibold text-slate-600" aria-label="Legend">
            {Object.entries(ST).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><i aria-hidden className="inline-block h-3 w-3 rounded-sm border border-slate-300" style={{ background: v.bg }} />{v.t}</span>)}
            <span>· L = Loss entry, Q = Quality entry{can ? ' · click an hour to open it' : ''}</span>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="w-full text-fs-13" aria-label="Entry status by day and line">
            <thead>
              <tr className="border-b border-slate-200 text-left text-fs-12 text-slate-600">
                <th className="px-2 py-1.5 font-extrabold">Day</th>
                {IDS.map((l) => <th key={l} className="px-2 py-1.5 text-center font-extrabold">Line {l}</th>)}
                <th className="px-2 py-1.5 text-right font-extrabold">Day</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => { const t = sumStatus(d.lines); return (
                <tr key={d.date} className="border-b border-slate-100 last:border-b-0">
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono font-bold">{dmy(d.date)}</td>
                  {d.lines.map((s) => (
                    <td key={s.line} className="px-2 py-1 text-center">
                      <button type="button" disabled={!can || s.all.left === 0} onClick={() => { const n = s.hours.find((h) => h.loss === 'pending' || h.quality === 'pending'); go(s.line, d.date, n ? n.hour : null); }}
                        title={`Line ${s.line} · Loss ${s.loss.done}/${s.loss.need} · Quality ${s.quality.done}/${s.quality.need} · Morning ${s.morning ? 'saved' : 'pending'}`}
                        className="lp-ed-hit inline-flex flex-col items-center rounded-md border border-slate-200 px-2 py-1 disabled:cursor-default" style={{ minWidth: 96 }}>
                        <span className="font-mono text-fs-15 font-extrabold" style={{ color: pctColor(s.all.pct) }}>{pctTxt(s.all.pct)}</span>
                        <span className="text-fs-11 font-semibold text-slate-500">L {s.loss.done}/{s.loss.need} · Q {s.quality.done}/{s.quality.need}{s.morning ? '' : ' · M'}</span>
                      </button>
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 text-right font-mono font-extrabold" style={{ color: pctColor(t.all.pct) }}>{pctTxt(t.all.pct)}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}

      {left.length > 0 && (
        <details className="border-t border-slate-200" open={left.length <= 12}>
          <summary className="cursor-pointer px-4 py-2 text-fs-14 font-extrabold text-slate-800">Left to fill · {left.length}</summary>
          <ul className="flex flex-wrap gap-1.5 px-4 pb-3" aria-label="Left to fill">
            {left.slice(0, 60).map((x, i) => (
              <li key={i}>
                <button type="button" disabled={!onOpen || !canOpen.includes(target(x.what))} onClick={() => go(x.line, x.date, x.hour, x.what)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-fs-12 font-bold text-amber-900 hover:bg-amber-100 disabled:cursor-default">
                  {days.length > 1 && <span className="font-mono">{dmy(x.date).slice(0, 5)}</span>} Line {x.line}{x.hour != null ? ` · ${p2(x.hour)}:00` : ''} · {x.what}
                </button>
              </li>
            ))}
            {left.length > 60 && <li className="px-1 py-1 text-fs-12 text-slate-500">… and {left.length - 60} more</li>}
          </ul>
        </details>
      )}
      {!left.length && all.all.need > 0 && <p className="border-t border-slate-200 px-4 py-2 text-fs-14 font-bold text-emerald-700">Everything is filled for this period.</p>}
    </section>
  );
}

export default function EntryDashboardPage({ onOpen = null, canOpen = [] }) {
  const ALL = useOleLines();
  const today = serverToday();
  const slot = useHeaderSlot();
  const [only, setOnly] = useState('all');
  const IDS = useMemo(() => (only !== 'all' && ALL.includes(only) ? [only] : ALL), [only, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState({ start: today, end: today });
  const [tab, setTab] = useState('loss');
  // 23-11-2026: the line data too (prod) — the hours that need entries come from the scans (up to 31 days)
  const D = useOleData({ start: range.start, end: range.end, ids: IDS, prod: true, pollEntries: true });
  const settings = useAllLineSettings(IDS);
  const F = useMemo(() => flatten(D.ent.entries, IDS), [D.ent.entries, IDS]);
  // 20-11-2026: no separate rejection any more — its tab and box show only when old rejection entries are in the period
  const TB = TABS.filter((x) => x.k !== 'rej' || F.rej.length > 0);
  const tk = TB.some((x) => x.k === tab) ? tab : 'loss';
  const t = TB.find((x) => x.k === tk);
  const rows = F[tk];
  const total = (k) => F[k].reduce((a, r) => a + r.v, 0);
  const last = [...F.loss, ...F.rej, ...F.rwk].reduce((b, r) => (r.at && (!b || r.at > b.at) ? r : b), null);
  const kind = periodKind(range, today);
  const periodText = `${{ today: 'Today', yesterday: 'Yesterday', day: 'Day', week: 'Week', month: 'Month', range: 'Range' }[kind]} · ${range.start === range.end ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`}`;
  const group = groupNameOf(IDS);

  const excel = () => {
    const sheet = (x) => {
      const L = F[x.k];
      const cols = x.k === 'loss'
        ? [['Date', 12], ['Line', 8], ['Hour', 9], ['Model', 24], ['Reason', 28], ['Department', 18], ['Minutes', 10], ['Part', 18], ['Note', 30]]
        : [['Date', 12], ['Line', 8], ['Hour', 9], ['Station', 16], ['Model', 24], ['Defect', 28], ['Department', 18], ['Qty', 10], ['Note', 30]];
      const head = cols.map(([h]) => ({ v: h, s: 'head' }));
      const body = L.map((r) => [{ v: dmy(r.date), s: 'center' }, { v: `Line ${r.line}`, s: 'center' }, { v: `${p2(r.hour)}-${p2(r.hour + 1)}`, s: 'center' },
        ...(x.k === 'loss' ? [] : [{ v: r.station, s: 'text' }]), { v: r.model, s: 'textBold' }, { v: r.reason, s: 'text' }, { v: r.dept, s: 'text' }, { v: r.v, s: 'int' },
        ...(x.k === 'loss' ? [{ v: r.part, s: 'text' }] : []), { v: r.note, s: 'text' }]);
      const tot = cols.map((c, i) => (i === 0 ? { v: 'Total', s: 'totalLabel' } : c[0] === 'Minutes' || c[0] === 'Qty' ? { v: total(x.k), s: 'totalInt' } : null));
      return { name: x.label, cols: cols.map(([, w]) => ({ width: w })), rows: [head, ...body, tot], freezeRow: 1, headerRow: 1 };
    };
    downloadXlsx(buildXlsx(TB.map(sheet)), `Entries_${group.replace(/ /g, '_')}_${range.start}_to_${range.end}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-3" aria-label="Entry dashboard">
      <HeaderBar label="Entry dashboard filters">
        {ALL.length > 1 && (
          <div className={segGroup} role="group" aria-label="Entry dashboard view">
            {['all', ...ALL].map((v) => (
              <button key={v} type="button" aria-pressed={only === v} onClick={() => setOnly(v)} aria-label={v === 'all' ? 'Entries of all lines' : `Entries of Line ${v}`}
                className={segBtn(only === v, 'navy')}>{v === 'all' ? 'Overall' : `Line ${v}`}</button>
            ))}
          </div>
        )}
        {slot ? <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading} />
          : <div className="flex w-full min-w-0 flex-col"><PeriodBar today={today} range={range} setRange={setRange} text={periodText} busy={D.loading} /></div>}
      </HeaderBar>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}

      <EntryStatus IDS={IDS} range={range} today={today} D={D} settings={settings} onOpen={onOpen} canOpen={canOpen} />

      <section className={`${card} overflow-hidden`} aria-label="Entries of the period">
        <div className="flex flex-wrap items-center gap-2 bg-dixon-navy px-4 py-2.5 text-white">
          <h2 className="lp-caps min-w-0 flex-1 text-fs-18 font-extrabold tracking-wide sm:text-fs-22" style={{ minWidth: 'min(100%, 260px)' }}>{group} · Loss{F.rej.length ? ', rejection' : ''} & rework entries</h2>
          <span className="rounded border border-white/40 bg-white/10 px-3 py-1 text-fs-14 font-bold">{periodText}</span>
          <button type="button" onClick={excel} disabled={!F.loss.length && !F.rej.length && !F.rwk.length}
            className="inline-flex items-center gap-1.5 rounded border border-white/40 bg-white px-3 py-1 text-fs-14 font-bold text-dixon-navy hover:bg-blue-50 disabled:opacity-50"><Download size={15} aria-hidden />Excel</button>
        </div>
        <div className={`grid grid-cols-2 gap-px bg-slate-200 ${F.rej.length ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
          <Kpi label="Loss" color={TABS[0].color} value={hrsTxt(total('loss'))} sub={ent(F.loss.length)} />
          {F.rej.length > 0 && <Kpi label="Rejection" color={TABS[1].color} value={`${nf(total('rej'))} pcs`} sub={ent(F.rej.length)} />}
          <Kpi label="Rework" color={TABS[2].color} value={`${nf(total('rwk'))} pcs`} sub={ent(F.rwk.length)} />
          <Kpi label="Hours filled" value={nf(F.hours)} sub="hours with an entry" />
          <Kpi label="Last entry" value={last ? `${last.by || '—'}` : '—'} sub={last ? atTxt(last.at) : 'nothing written'} />
        </div>
      </section>

      <div className="flex overflow-hidden rounded-md border border-slate-300 self-start" role="tablist" aria-label="Entry kind">
        {TB.map((x) => (
          <button key={x.k} type="button" role="tab" aria-selected={tk === x.k} onClick={() => setTab(x.k)}
            className={`h-10 border-r border-slate-300 px-4 text-fs-14 font-bold last:border-r-0 ${tk === x.k ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>
            {x.label} <span className={`ml-1 rounded px-1.5 font-mono text-fs-12 ${tk === x.k ? 'bg-white/20' : 'bg-slate-100'}`}>{F[x.k].length}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Ranked title={`${t.label} by ${t.what.toLowerCase()}`} rows={groupBy(rows, (r) => r.reason)} t={t} />
        <Ranked title={`${t.label} by department`} rows={groupBy(rows, (r) => r.dept)} t={t} />
        <Ranked title={`${t.label} by line`} rows={groupBy(rows, (r) => `Line ${r.line}`)} t={t} line />
      </div>

      <section className={`${card} overflow-hidden`} aria-label={`${t.label} entries`}>
        <h3 className="border-b border-slate-200 px-4 py-2 text-fs-15 font-extrabold text-dixon-navy">{t.label} entries · {rows.length}</h3>
        {!rows.length ? <p className="px-4 py-8 text-center text-fs-14 text-slate-500">No {t.label.toLowerCase()} written in this period.</p> : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-fs-14" aria-label={`${t.label} entries table`}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#e3ecf8] text-left text-fs-12 text-dixon-navy">
                  {['Date', 'Line', 'Hour', ...(tk === 'loss' ? [] : ['Station']), 'Model', t.what, 'Department', tk === 'loss' ? 'Minutes' : 'Qty'].map((h, _i, a) => (
                    <th key={h} className={`whitespace-nowrap border-b border-slate-300 px-3 py-2 font-extrabold ${h === a[a.length - 1] ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 align-top last:border-b-0 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">{dmy(r.date)}</td>
                    <td className="whitespace-nowrap px-3 font-bold">Line {r.line}</td>
                    <td className="whitespace-nowrap px-3 font-mono">{p2(r.hour)}–{p2(r.hour + 1)}</td>
                    {tk !== 'loss' && <td className="whitespace-nowrap px-3">{r.station || '—'}</td>}
                    <td className="px-3 font-mono font-semibold">{r.model || '—'}</td>
                    <td className="px-3 font-semibold text-slate-900">{r.reason || '—'}{r.part && <span className="block text-fs-12 font-normal text-slate-500">Part: {r.part}</span>}{r.note && <span className="block text-fs-12 font-normal text-slate-500">Note: {r.note}</span>}</td>
                    <td className="px-3">{r.dept || '—'}</td>
                    <td className="whitespace-nowrap px-3 text-right font-mono font-extrabold tabular-nums">{tk === 'loss' ? `${nf(r.v)}′` : nf(r.v)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                  <td className="px-3 py-2" colSpan={tk === 'loss' ? 6 : 7}>Total · {ent(rows.length)}</td>
                  <td className="whitespace-nowrap px-3 text-right font-mono">{tk === 'loss' ? hrsTxt(total(tk)) : nf(total(tk))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
