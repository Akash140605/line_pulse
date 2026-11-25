import { LINE_COLOR } from '../theme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, ShieldCheck, Copy, Check, Download, RefreshCw, MessageSquare } from 'lucide-react';
import { Card } from '../components/UiKit';
import { api, LINE_IDS } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { plantContext, plantBrief, plantText, plantAsk, PLANT_SUGGESTIONS, lineForecast } from '../utils/aiMain';
import { rupees } from '../utils/money';
import { addDays } from '../utils/mainFilter';
import { fmtMin } from '../utils/shift';
import { ScoreRing, AlertList, AskPanel } from './AIAnalysisPage';
import { serverNow } from '../utils/serverTime';
import { entryInsights, insightText } from '../utils/aiInsights';
import { deptName } from '../utils/lossan';
import { advise, adviceText } from '../utils/aiAdvisor';
import { oleConfig } from '../utils/ole';
import AdvisorPanel from '../components/AdvisorPanel';

const COLORS = LINE_COLOR;
const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
const pc = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const STATUS = {
  ok: ['On target', 'bg-sky-100 text-sky-800'], watch: ['Watch', 'bg-slate-100 text-slate-800'], behind: ['Behind', 'bg-red-100 text-red-800'],
  stopped: ['Stopped', 'bg-red-600 text-white'], offline: ['Offline', 'bg-slate-700 text-white'], idle: ['No production', 'bg-slate-200 text-slate-700'], 'no-target': ['No target', 'bg-blue-100 text-blue-800'],
};
const PERIODS = [['7', 'Last 7 days'], ['30', 'Last 30 days']];

export default function MainAIPage({ today }) {
  const [days, setDays] = useState('7');
  const range = useMemo(() => ({ start: addDays(today, -(Number(days) - 1)), end: today }), [today, days]);
  const settings = useAllLineSettings(LINE_IDS);
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [losses, setLosses] = useState({});
  const [ent, setEnt] = useState(null);   // 20-11-2026: loss / quality entries + RCAs of 90 days (the app's own store)
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => serverNow());
  const [copied, setCopied] = useState(false);
  const ctl = useRef(null);

  const load = useCallback(async (fresh = false) => {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setLoading(true); setErr('');
    try {
      const [j, lv, ...ls] = await Promise.all([
        api.allLinesParallel({ ...range, cmin: 1, cmax: 22 }, { signal: c.signal, fresh }),
        api.liveLinesParallel({ cmin: 1, cmax: 22 }).catch(() => null),
        ...LINE_IDS.map((l) => api.losses(l, range.start, range.end).catch(() => ({ entries: [] }))),
      ]);
      setData(j); setLive(lv); setLosses(Object.fromEntries(LINE_IDS.map((l, i) => [l, ls[i]?.entries || []]))); setNow(serverNow());
      api.oleEntries(addDays(today, -89), today).then((e) => { if (ctl.current === c) setEnt({ entries: e?.entries || {}, rca: e?.rca || {}, setup: e?.setup || {} }); }).catch(() => {});
    } catch (e) { if (e.name !== 'AbortError') setErr(String(e.message || e)); } finally { if (ctl.current === c) setLoading(false); }
  }, [range]);
  useEffect(() => { load(false); return () => ctl.current?.abort(); }, [load]);
  // today: fresh numbers every minute
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) load(false); }, 60_000); return () => clearInterval(id); }, [load]);

  const ctx = useMemo(() => (data ? plantContext({ lines: data.lines, settings, live, losses, now, range }) : null), [data, settings, live, losses, now, range]);
  const b = useMemo(() => (ctx ? plantBrief(ctx) : null), [ctx]);
  const ins = useMemo(() => (ent ? entryInsights({ entries: ent.entries, rca: ent.rca, today, ids: LINE_IDS }) : null), [ent, today]);
  // 25-11-2026: the action plan — what to do, why, what happens if not, who and by when (utils/aiAdvisor.js)
  const adv = useMemo(() => {
    if (!ent || !ctx) return null;
    try {
      return advise({ per: ctx.per, isToday: ctx.isToday, nowMin: ctx.nowMin, now: ctx.now, today: ctx.focus, forecast: (p) => lineForecast(p, ctx), entries: ent.entries, rca: ent.rca, setup: ent.setup, stdMp: oleConfig().stdMp || {}, ids: LINE_IDS });
    } catch (e) { console.warn('[advisor]', e); return { items: [], counts: {} }; }
  }, [ent, ctx]);

  if (err && !data) return <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-fs-14 font-semibold text-red-800">AI analysis could not load the lines: {err}</div>;
  if (!b) return <div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading all lines for the AI analysis…</div>;

  const text = plantText(b, ctx) + adviceText(adv) + insightText(ins);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* ignore */ } t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `AI_analysis_all_lines_${ctx.focus}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const crit = b.alerts.filter((a) => a.level === 'bad').length, warn = b.alerts.filter((a) => a.level === 'warn').length;

  return (
    <div className="flex flex-col gap-3" aria-busy={loading || undefined}>
      <section aria-label="AI summary" className="rounded-2xl bg-gradient-to-br from-dixon-navy to-blue-800 text-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-fs-13 font-bold text-sky-200"><Sparkles size={16} /> AI analysis</span>
          <span className="text-fs-13 text-slate-300">All lines · <span className="font-mono">{ctx.focus}</span>{ctx.isToday ? ' · live' : ''}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-fs-12 font-semibold text-sky-200"><ShieldCheck size={13} /> Offline · data stays in the plant</span>
          <div className="ml-auto inline-flex rounded-lg bg-white/10 p-0.5 text-fs-12 font-bold" role="group" aria-label="Period">
            {PERIODS.map(([k, l]) => <button key={k} type="button" aria-pressed={days === k} onClick={() => setDays(k)} className={`rounded-md px-2.5 py-1 ${days === k ? 'bg-white text-dixon-navy' : 'text-slate-200 hover:bg-white/10'}`}>{l}</button>)}
          </div>
        </div>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-4">
          <ScoreRing score={b.score} grade={b.grade} />
          <div className="min-w-0 flex-1">
            <p className="text-fs-18 sm:text-fs-20 font-semibold leading-snug" data-testid="ai-headline">{b.headline}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-fs-12 font-semibold">
              {crit > 0 && <span className="rounded-full bg-red-500/25 text-red-100 px-2 py-0.5">{crit} critical</span>}
              {warn > 0 && <span className="rounded-full bg-slate-400/25 text-slate-100 px-2 py-0.5">{warn} warning{warn === 1 ? '' : 's'}</span>}
              {b.scoreParts.map((p) => <span key={p.k} className="rounded-full bg-white/10 text-slate-100 px-2 py-0.5">{p.k} {p.pct}%</span>)}
            </div>
          </div>
          <div className="flex flex-wrap sm:flex-col gap-2 shrink-0">
            <button type="button" onClick={copy} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white text-dixon-navy px-3 py-1.5 text-fs-13 font-bold hover:bg-slate-100">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy report'}</button>
            <button type="button" onClick={download} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/40 px-3 py-1.5 text-fs-13 font-bold hover:bg-white/10"><Download size={15} /> Download report</button>
            <button type="button" onClick={() => load(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/40 px-3 py-1.5 text-fs-13 font-bold hover:bg-white/10"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button>
            <button type="button" onClick={() => { const el = document.getElementById('ai-q'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }}
              className="xl:hidden inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/40 px-3 py-1.5 text-fs-13 font-bold hover:bg-white/10"><MessageSquare size={15} /> Ask a question</button>
          </div>
        </div>
      </section>

      <AdvisorPanel advice={adv} lines={LINE_IDS} />

      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-12 xl:col-span-8 flex flex-col gap-3 min-w-0">
          <Card title={ctx.isToday ? 'Lines today' : `Lines on ${ctx.focus}`}>
            <div className="mt-3 grid sm:grid-cols-2 gap-2" aria-label="Line status">
              {b.rows.map((r) => {
                const [st, cls] = STATUS[r.status] || STATUS.idle;
                const d = r.dl;
                const w = d?.pct != null ? Math.min(100, d.pct) : 0;
                return (
                  <div key={r.line} className="rounded-xl border border-slate-200 p-3" data-testid={`line-card-${r.line}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-fs-16"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: COLORS[r.line] }} />{r.name}</div>
                      <span className={`rounded-full px-2 py-0.5 text-fs-12 font-bold ${cls}`}>{st}</span>
                    </div>
                    {r.status === 'offline' ? <div className="mt-2 text-fs-13 text-slate-600">Server not reachable.</div> : (
                      <>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="font-mono text-fs-24 font-bold">{nf(d?.actual ?? 0)}</span>
                          <span className="text-fs-13 text-slate-600">{d?.target != null ? `of ${nf(d.target)} target · ${pc(d.pct)}` : 'pcs · no target'}</span>
                        </div>
                        <div className="mt-1 h-2 rounded bg-slate-100"><div className={`h-2 rounded ${d?.pct >= 100 ? 'bg-sky-500' : d?.pct >= 90 ? 'bg-slate-500' : 'bg-red-500'}`} style={{ width: `${w}%` }} /></div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-fs-12">
                          <div><div className="text-slate-600">Short</div><div className="font-mono font-bold text-fs-14">{nf(d?.short)}</div></div>
                          <div><div className="text-slate-600">Loss</div><div className="font-mono font-bold text-fs-14 text-red-700">{d?.rsTotal != null ? rupees(d.rsTotal, { short: true }) : '—'}</div></div>
                          <div><div className="text-slate-600">Forecast</div><div className="font-mono font-bold text-fs-14">{r.f?.state === 'live' ? nf(r.f.projected) : r.f?.state === 'closed' ? 'closed' : '—'}</div></div>
                        </div>
                        {r.running && <div className="mt-2 text-fs-12 text-slate-600 break-words">Running: <b className="text-slate-800">{r.running}</b></div>}
                        {r.f?.state === 'live' && r.f.target && <div className="mt-1 text-fs-12 text-slate-600">Needs {nf(r.f.need)}/hr to {fmtMin(ctx.per.find((p) => p.line === r.line).shift.end)} · making {nf(r.f.recent)}/hr</div>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-fs-13 text-slate-700">
              Period {ctx.range.start} → {ctx.range.end}: <b>{nf(b.period.actual)}</b> pcs{b.period.target ? <>; lines with targets <b>{nf(b.period.actualPlanned)}</b> of <b>{nf(b.period.target)}</b> ({pc(b.period.pct)}), short <b>{nf(b.period.short)}</b></> : ''}{b.period.rsTotal != null ? <>, loss <b className="text-red-700">{rupees(b.period.rsTotal)}</b></> : ''}.
            </div>
          </Card>

          <Card title="What to do" sub="Largest loss first.">
            <ol className="mt-3 flex flex-col gap-2" aria-label="Actions">
              {[...b.actions, ...(ins?.actions || [])].map((a, i) => (
                <li key={a.key} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="shrink-0 h-6 w-6 rounded-full bg-dixon-navy text-white text-fs-12 font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0"><div className="text-fs-14 font-bold text-slate-900">{a.title}{a.rs != null ? <span className="ml-2 font-mono text-fs-13 text-red-700">{rupees(a.rs)}</span> : a.gain >= 1 ? <span className="ml-2 font-mono text-fs-13 text-red-700">{nf(a.gain)} pcs</span> : null}</div><div className="text-fs-13 text-slate-700 leading-snug">{a.detail}</div></div>
                </li>
              ))}
              {!b.actions.length && !(ins?.actions || []).length && <li className="text-fs-14 text-slate-700">Nothing urgent — all lines are on target.</li>}
            </ol>
          </Card>

          {ins && <EntriesCard x={ins} />}
          <AlertList alerts={b.alerts} />
        </div>
        <div className="col-span-12 xl:col-span-4 xl:sticky xl:top-3 min-w-0">
          <AskPanel ctx={ctx} askFn={plantAsk} suggestions={PLANT_SUGGESTIONS} title="Ask about all lines" placeholder="e.g. sabse zyada loss kis line ka?" />
        </div>
      </div>
    </div>
  );
}

/** 20-11-2026: what the loss and quality entries say — this week vs last week, and the RCAs */
function EntriesCard({ x }) {
  const arrow = (r) => {
    if (!r.prev && r.now) return <span className="font-bold text-orange-700">new</span>;
    if (!r.prev) return '—';
    const c = r.now / r.prev - 1;
    return <span className={`font-bold ${c >= 0.3 ? 'text-red-700' : c <= -0.3 ? 'text-emerald-700' : 'text-slate-600'}`}>{c > 0 ? '▲' : c < 0 ? '▼' : '='} {Math.abs(Math.round(c * 100))}%</span>;
  };
  const T = ({ title, rows, unit }) => (
    <div className="min-w-0">
      <div className="text-fs-13 font-extrabold text-slate-800">{title}</div>
      {!rows.length ? <p className="text-fs-13 text-slate-500">None in the two weeks.</p> : (
        <table className="mt-1 w-full text-fs-13 tabular-nums" aria-label={`${title} this week`}>
          <thead><tr className="border-b border-slate-200 text-left text-fs-12 text-slate-500"><th className="py-1 font-semibold">Reason</th><th className="py-1 text-right font-semibold">This week</th><th className="py-1 text-right font-semibold">Last week</th><th className="py-1 text-right font-semibold">Change</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.reason} className="border-b border-slate-100">
              <td className="py-1 pr-2"><b>{r.reason}</b><span className="block text-fs-11 text-slate-500">{deptName(r.dept)}{r.lines.length ? ` · ${r.lines.map((l) => `L${l}`).join(', ')}` : ''}{r.dismantle ? ` · ${r.dismantle} dismantled` : ''}</span></td>
              <td className="py-1 text-right font-mono font-bold">{Math.round(r.now)} {unit}</td>
              <td className="py-1 text-right font-mono text-slate-600">{Math.round(r.prev)} {unit}</td>
              <td className="py-1 text-right">{arrow(r)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
  const tot = (k, unit) => { const t = x.totals[k]; return `${Math.round(t.now)} ${unit}${t.prev ? ` (${t.now >= t.prev ? '+' : ''}${Math.round((t.now / t.prev - 1) * 100)}%)` : ''}`; };
  return (
    <Card title="Losses & quality — this week vs last week" sub={`From the Loss / Quality entry pages: ${x.week.from} → ${x.week.to} against ${x.week.prevFrom} → ${x.week.prevTo}.`}>
      <div className="mt-2 flex flex-wrap gap-1.5 text-fs-12 font-semibold" aria-label="Entries totals">
        <span className="rounded-full bg-slate-100 px-2 py-0.5">Loss {tot('loss', 'min')}</span>
        {x.rejects?.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5">Rejection {tot('reject', 'pcs')}</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5">Rework {tot('rework', 'pcs')}</span>
        <span className={`rounded-full px-2 py-0.5 ${x.pending ? 'bg-red-100 text-red-800' : 'bg-slate-100'}`}>{x.pending} without RCA (30 days)</span>
        <span className={`rounded-full px-2 py-0.5 ${x.overdue ? 'bg-red-100 text-red-800' : 'bg-slate-100'}`}>{x.overdue} RCA overdue</span>
        <span className={`rounded-full px-2 py-0.5 ${x.stuck.length ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>{x.stuck.length} action{x.stuck.length === 1 ? '' : 's'} not working</span>
      </div>
      <div className={`mt-3 grid gap-4 ${x.rejects?.length ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <T title="Loss reasons" rows={x.losses} unit="min" />
        {x.rejects?.length > 0 && <T title="Rejection defects" rows={x.rejects} unit="pcs" />}
        <T title="Rework defects" rows={x.rework} unit="pcs" />
      </div>
      {x.stuck.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 text-red-900" aria-label="RCA actions not working">
          <b>RCA actions that did not bring the loss down:</b>
          <ul className="mt-1 list-disc pl-5">{x.stuck.slice(0, 5).map((r) => <li key={r.key}><b>{r.reason}</b> ({r.lines.map((l) => `L${l}`).join(', ')}) — {r.nActions} action{r.nActions === 1 ? '' : 's'}, last {r.last}: {Math.round(r.before ?? 0)} → {Math.round(r.after ?? 0)} {r.unit}/day. {r.actions[r.actions.length - 1]?.action ? `“${r.actions[r.actions.length - 1].action}”` : ''}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}
