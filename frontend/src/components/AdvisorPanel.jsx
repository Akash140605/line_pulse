import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { plantContext, lineForecast } from '../utils/aiMain';
import { advise } from '../utils/aiAdvisor';
import { oleConfig } from '../utils/ole';
import { serverNow, serverToday } from '../utils/serverTime';
import { addDays } from '../utils/mainFilter';
import { Siren, CalendarClock, CalendarRange, CheckCircle2, ChevronDown, User, Clock3, TriangleAlert, Wrench, Lightbulb } from 'lucide-react';
import { LINE_COLOR } from '../theme';

/**
 * 25-11-2026: AI analysis → Action plan. Each card: the situation, WHY (root cause from the plant's data), what happens
 * if nothing is done, the steps, the owner and by when (utils/aiAdvisor.js). Grouped: do now · today · this week.
 */
const GROUPS = [
  ['now', 'Do now', Siren, 'border-red-500', 'bg-red-600', 'text-red-700'],
  ['today', 'Today — before the shift ends', CalendarClock, 'border-amber-500', 'bg-amber-500', 'text-amber-800'],
  ['week', 'This week — stop it coming back', CalendarRange, 'border-blue-600', 'bg-blue-700', 'text-blue-800'],
];

function Item({ x, open, onToggle, color }) {
  return (
    <article className={`rounded-lg border border-slate-200 border-l-4 bg-white ${color}`} data-testid="advice-item">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        {x.line != null && <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-fs-11 font-extrabold text-white" style={{ background: LINE_COLOR[x.line] || '#1F3864' }}>L{x.line}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-fs-14 font-extrabold leading-snug text-slate-900">{x.title}</span>
          {x.situation && <span className="block text-fs-12 text-slate-600">{x.situation}</span>}
        </span>
        <span className="shrink-0 text-right text-fs-11 font-bold text-slate-600"><span className="inline-flex items-center gap-1"><User size={11} aria-hidden />{x.owner}</span><br /><span className="inline-flex items-center gap-1"><Clock3 size={11} aria-hidden />{x.by}</span></span>
        <ChevronDown size={16} className={`mt-0.5 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-2 border-t border-slate-100 px-3 py-2 md:grid-cols-3">
          <div><div className="mb-0.5 flex items-center gap-1 text-fs-11 font-extrabold uppercase tracking-wide text-slate-500"><Lightbulb size={12} aria-hidden /> Why (root cause)</div>
            <ul className="list-disc pl-4 text-fs-13 leading-snug text-slate-800">{x.cause.map((c) => <li key={c}>{c}</li>)}</ul></div>
          <div><div className="mb-0.5 flex items-center gap-1 text-fs-11 font-extrabold uppercase tracking-wide text-red-700"><TriangleAlert size={12} aria-hidden /> If nothing is done</div>
            <p className="text-fs-13 leading-snug text-slate-800">{x.risk}</p></div>
          <div><div className="mb-0.5 flex items-center gap-1 text-fs-11 font-extrabold uppercase tracking-wide text-emerald-700"><Wrench size={12} aria-hidden /> Do this</div>
            <ol className="list-decimal pl-4 text-fs-13 leading-snug text-slate-900">{x.actions.map((a) => <li key={a} className="font-semibold">{a}</li>)}</ol></div>
        </div>
      )}
    </article>
  );
}

export default function AdvisorPanel({ advice, lines = [] }) {
  const [line, setLine] = useState('all');
  const [open, setOpen] = useState(() => new Set());
  const items = useMemo(() => (advice?.items || []).filter((x) => line === 'all' || x.line == null || String(x.line) === line), [advice, line]);
  const firstIds = useMemo(() => new Set(items.filter((x) => x.sev !== 'week').slice(0, 3).map((x) => x.id)), [items]);
  const isOpen = (id) => (open.has(id) ? true : open.has(`-${id}`) ? false : firstIds.has(id));
  const toggle = (id) => setOpen((s) => { const n = new Set(s); const was = isOpen(id); n.delete(id); n.delete(`-${id}`); n.add(was ? `-${id}` : id); return n; });
  if (!advice) return <section className="rounded-xl border border-slate-200 bg-white p-4 text-fs-13 text-slate-600 shadow-sm">Reading the loss and quality entries for the action plan…</section>;
  return (
    <section aria-label="Action plan" data-testid="advisor" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="border-l-4 border-[#1F3864] pl-2.5 text-fs-15 font-extrabold uppercase tracking-wide text-[#1F3864]" style={{ margin: 0 }}>Action plan — what to do</h2>
        <span className="text-fs-12 text-slate-600">root cause from your own entries, scans and the plant's quality history · owner and by when</span>
        {lines.length > 1 && <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Line">
          {['all', ...lines.map(String)].map((l) => <button key={l} type="button" aria-pressed={line === l} onClick={() => setLine(l)} className={`rounded-md border px-2 py-0.5 text-fs-12 font-bold ${line === l ? 'border-[#1F3864] bg-[#1F3864] text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{l === 'all' ? 'All lines' : `Line ${l}`}</button>)}
        </div>}
      </div>
      {!items.length ? (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-fs-14 font-semibold text-emerald-800"><CheckCircle2 size={18} aria-hidden /> Nothing needs action now — no stop, no target at risk, no repeating loss or defect.</p>
      ) : GROUPS.map(([k, label, Icon, border, badge, txt]) => {
        const xs = items.filter((x) => x.sev === k);
        if (!xs.length) return null;
        return (
          <div key={k} className="mb-2.5">
            <div className={`mb-1 flex items-center gap-1.5 text-fs-13 font-extrabold ${txt}`}><Icon size={15} aria-hidden /> {label} <span className={`rounded-full px-1.5 text-fs-11 text-white ${badge}`}>{xs.length}</span></div>
            <div className="flex flex-col gap-1.5">{xs.map((x) => <Item key={x.id} x={x} open={isOpen(x.id)} onToggle={() => toggle(x.id)} color={border} />)}</div>
          </div>
        );
      })}
    </section>
  );
}

/**
 * the action plan of some lines, read by itself (the AI page of one line): the last 7 days of production, the live last
 * scan and 90 days of loss / quality entries — re-read every 2 minutes
 */
export function useAdvice(ids) {
  const today = serverToday();
  const settings = useAllLineSettings(ids);
  const [d, setD] = useState(null);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const range = { start: addDays(today, -6), end: today };
        const [j, lv, e] = await Promise.all([
          api.allLinesParallel({ ...range, cmin: 1, cmax: 22 }),
          api.liveLinesParallel({ cmin: 1, cmax: 22 }).catch(() => null),
          api.oleEntries(addDays(today, -89), today).catch(() => null),
        ]);
        if (alive) setD({ j, lv, e, range, now: serverNow() });
      } catch { /* the plan stays as it was */ }
    };
    load();
    const id = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(id); };
  }, [key, today]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!d?.j || !d.e) return null;
    try {
      const lines = (d.j.lines || []).filter((l) => ids.map(String).includes(String(l.line)));
      const ctx = plantContext({ lines, settings, live: d.lv, losses: {}, now: d.now, range: d.range });
      return advise({ per: ctx.per, isToday: ctx.isToday, nowMin: ctx.nowMin, now: ctx.now, today: ctx.focus, forecast: (p) => lineForecast(p, ctx), entries: d.e.entries || {}, rca: d.e.rca || {}, setup: d.e.setup || {}, stdMp: oleConfig().stdMp || {}, ids });
    } catch (x) { console.warn('[advisor]', x); return { items: [], counts: {} }; }
  }, [d, settings, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** the panel that reads its own data (the AI page of one line) */
export function AdvisorFor({ ids }) {
  const adv = useAdvice(ids);
  return <AdvisorPanel advice={adv} lines={ids.length > 1 ? ids : []} />;
}
