import { fs } from '../theme';
import { AdvisorFor } from '../components/AdvisorPanel';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Sparkles, XOctagon, AlertTriangle, Info, CheckCircle2, Copy, Download, Send, ShieldCheck, TrendingUp, ListChecks, MessageSquare, Check } from 'lucide-react';
import { Card } from '../components/UiKit';
import { brief, briefText, ask, SUGGESTIONS, fmtN, fmtPct, fmtMins } from '../utils/ai';

export const LEVEL = {
  bad: { cls: 'border-l-red-600 bg-red-50/70', icon: XOctagon, ic: 'text-red-600', label: 'Critical' },
  warn: { cls: 'border-l-slate-500 bg-slate-50/70', icon: AlertTriangle, ic: 'text-slate-600', label: 'Warning' },
  info: { cls: 'border-l-blue-500 bg-blue-50/60', icon: Info, ic: 'text-blue-600', label: 'Note' },
  good: { cls: 'border-l-sky-600 bg-sky-50/70', icon: CheckCircle2, ic: 'text-sky-600', label: 'Good' },
};
export const VERDICT = {
  'on-track': 'bg-sky-100 text-sky-800 border-sky-300',
  'at-risk': 'bg-slate-100 text-slate-800 border-slate-300',
  'will-miss': 'bg-red-100 text-red-800 border-red-300',
};

export function ScoreRing({ score, grade }) {
  const r = 34, c = 2 * Math.PI * r, v = score == null ? 0 : score / 100;
  const col = score == null ? '#94A3B8' : score >= 85 ? '#34D399' : score >= 70 ? '#FBBF24' : '#F87171';
  return (
    <div className="relative h-[88px] w-[88px] shrink-0" role="img" aria-label={`Line health ${score ?? '—'} of 100`}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="7" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-mono text-fs-24 font-bold text-white">{score ?? '—'}</span>
        <span className="text-fs-11 font-semibold text-slate-200 mt-0.5">{grade || 'no score'}</span>
      </div>
    </div>
  );
}

export function AlertList({ alerts, onPickHour }) {
  const [show, setShow] = useState('all');
  const counts = useMemo(() => alerts.reduce((o, a) => ({ ...o, [a.level]: (o[a.level] || 0) + 1 }), {}), [alerts]);
  const list = show === 'all' ? alerts : alerts.filter((a) => a.level === show);
  return (
    <Card title="Alerts"
      right={(
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter alerts">
          {[['all', `All ${alerts.length}`], ...['bad', 'warn', 'info', 'good'].filter((k) => counts[k]).map((k) => [k, `${LEVEL[k].label} ${counts[k]}`])].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setShow(k)} aria-pressed={show === k}
              className={`rounded-full border px-2.5 py-0.5 text-fs-12 font-bold ${show === k ? 'bg-dixon-navy text-white border-dixon-navy' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}>
      {!list.length ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2.5 text-fs-14 font-semibold text-sky-800">
          <CheckCircle2 size={18} /> No problem found for this day.
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Alert list">
          {list.map((a) => {
            const L = LEVEL[a.level]; const Icon = L.icon;
            return (
              <li key={a.id} className={`border-l-4 rounded-r-lg px-3 py-2 ${L.cls}`}>
                <div className="flex items-start gap-2">
                  <Icon size={17} className={`${L.ic} shrink-0 mt-0.5`} aria-label={L.label} />
                  <div className="min-w-0 flex-1">
                    <div className="text-fs-14 font-bold text-slate-900 leading-snug">{a.title}</div>
                    <div className="text-fs-13 text-slate-700 leading-snug mt-0.5">{a.detail}</div>
                  </div>
                  {a.hour != null && onPickHour && (
                    <button type="button" onClick={() => onPickHour(a.hour)} title="Open the scans of this hour"
                      className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-fs-12 font-bold text-blue-700 hover:bg-blue-50">Scans</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function ForecastCard({ f, isToday }) {
  const data = f?.curve || [];
  const hasT = data.some((d) => d.target != null);
  return (
    <Card title={isToday ? 'Forecast to shift end' : 'Day result'}
      right={f?.verdictText && <span className={`rounded-full border px-2.5 py-0.5 text-fs-13 font-bold ${VERDICT[f.verdict]}`}>{f.verdictText}</span>}>
      <p className="mt-2 text-fs-14 font-semibold text-slate-800 leading-snug" data-testid="forecast-text">{f?.text}</p>
      {f?.state === 'live' && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['Expected', fmtN(f.projected), `${fmtN(f.low)}–${fmtN(f.high)}`],
            ['Target', f.target != null ? fmtN(f.target) : '—', f.target != null ? `${f.projected >= f.target ? '+' : '−'}${fmtN(Math.abs(f.projected - f.target))} expected` : 'no model targets'],
            ['Needed rate', f.need != null ? `${fmtN(f.need)}/hr` : '—', `now ${fmtN(f.recentRate)}/hr`],
            ['Chance', f.chance != null ? fmtPct(f.chance) : '—', `${fmtMins(f.remainingSec)} left`],
          ].map(([l, v, s]) => (
            <div key={l} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
              <div className="text-fs-12 font-semibold text-slate-600">{l}</div>
              <div className="font-mono text-fs-20 font-bold text-slate-900 leading-tight">{v}</div>
              <div className="text-fs-12 text-slate-600 leading-tight">{s}</div>
            </div>
          ))}
        </div>
      )}
      {data.length > 1 && (
        <div className="h-[220px] mt-3" aria-label="Cumulative production chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: fs(11), fill: '#475569' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: fs(11), fill: '#475569' }} />
              <Tooltip formatter={(v, n) => [fmtN(v), n]} />
              <Legend wrapperStyle={{ fontSize: fs(12) }} />
              <Area type="monotone" dataKey="actual" name="Actual (cumulative)" stroke="rgb(var(--navy))" fill="rgb(var(--navy))" fillOpacity={0.08} strokeWidth={2.5} connectNulls={false} isAnimationActive={false} />
              {f.state === 'live' && <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#2F6FD0" strokeDasharray="6 4" strokeWidth={2.5} dot={false} isAnimationActive={false} />}
              {hasT && <Line type="monotone" dataKey="target" name="Target (cumulative)" stroke="#C2410C" strokeDasharray="3 3" strokeWidth={2} dot={false} isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/* ───────────── questions ───────────── */

function Answer({ a, onAsk }) {
  return (
    <div className="rounded-xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2.5 shadow-sm min-w-0">
      <div className="text-fs-14 font-bold text-dixon-ink">{a.title}</div>
      {a.lines.map((l, i) => <p key={i} className="text-fs-14 text-slate-800 leading-snug mt-1">{l}</p>)}
      {a.bullets?.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 space-y-1 text-fs-14 text-slate-800 leading-snug">
          {a.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
      {a.table && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-fs-13">
            <thead><tr className="text-left text-slate-600">{a.table.head.map((h) => <th key={h} className="py-1 pr-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>{a.table.rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className={`py-1 pr-2 whitespace-nowrap ${j >= 2 ? 'font-mono tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {a.follow?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {a.follow.map((s) => <button key={s} type="button" onClick={() => onAsk(s)} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-fs-12 font-semibold text-blue-800 hover:bg-blue-100">{s}</button>)}
        </div>
      )}
    </div>
  );
}

export function AskPanel({ ctx, askFn = ask, suggestions = SUGGESTIONS, title = 'Ask about this line', sub = null, placeholder = 'e.g. line peeche kyun hai?' }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const box = useRef(null);
  const send = (q) => {
    const s = String(q ?? text).trim();
    if (!s) return;
    setMsgs((m) => [...m, { id: Date.now() + Math.random(), q: s, a: askFn(s, ctx) }].slice(-30));
    setText('');
  };
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs]);
  return (
    <Card title={title} sub={sub} className="flex flex-col">
      <div ref={box} className="mt-3 flex-1 min-h-[220px] max-h-[520px] overflow-y-auto rounded-xl bg-slate-50 border border-slate-200 p-2.5 flex flex-col gap-2.5" aria-live="polite" aria-label="Conversation">
        {!msgs.length && (
          <div className="text-fs-13 text-slate-600 px-1">
            <div className="font-semibold text-slate-700 mb-1.5">Try a question:</div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-fs-13 font-semibold text-slate-800 hover:border-blue-400 hover:bg-blue-50">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className="flex flex-col gap-1.5">
            <div className="self-end max-w-[85%] rounded-xl rounded-tr-sm bg-dixon-navy text-white px-3 py-1.5 text-fs-14 font-medium">{m.q}</div>
            <div className="max-w-[95%]"><Answer a={m.a} onAsk={send} /></div>
          </div>
        ))}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="ai-q" className="sr-only">Your question</label>
        <input id="ai-q" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoComplete="off"
          className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-fs-14 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={!text.trim()} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-40">
          <Send size={15} /> Ask
        </button>
      </form>
      {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="self-start mt-1.5 text-fs-12 font-semibold text-slate-600 hover:text-slate-900">Clear conversation</button>}
    </Card>
  );
}

/* ───────────── page ───────────── */

export default function AIAnalysisPage({ ctx, onPickHour, busy }) {
  const b = useMemo(() => (ctx ? brief(ctx) : null), [ctx]);
  const [copied, setCopied] = useState(false);
  if (!b) return <div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading data for the analysis…</div>;
  const text = briefText(b, ctx);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* ignore */ } t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `AI_analysis_Line${ctx.line}_${ctx.focusDate}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const crit = b.alerts.filter((a) => a.level === 'bad').length, warn = b.alerts.filter((a) => a.level === 'warn').length;

  return (
    <div className="flex flex-col gap-3" aria-busy={busy || undefined}>
      {/* headline */}
      <section aria-label="AI summary" className="rounded-2xl bg-gradient-to-br from-dixon-navy to-blue-800 text-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-fs-13 font-bold text-sky-200"><Sparkles size={16} /> AI analysis</span>
          <span className="text-fs-13 text-slate-300">Line {ctx.line} · <span className="font-mono">{ctx.focusDate}</span>{ctx.isToday ? ' · live' : ''}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-fs-12 font-semibold text-sky-200" title="All analysis runs in the browser on the dashboard's data; nothing is sent outside the plant network.">
            <ShieldCheck size={13} /> Offline · data stays in the plant
          </span>
        </div>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-4">
          <ScoreRing score={b.score} grade={b.grade} />
          <div className="min-w-0 flex-1">
            <p className="text-fs-18 sm:text-fs-20 font-semibold leading-snug" data-testid="ai-headline">{b.headline}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-fs-12 font-semibold">
              {crit > 0 && <span className="rounded-full bg-red-500/25 text-red-100 px-2 py-0.5">{crit} critical</span>}
              {warn > 0 && <span className="rounded-full bg-slate-400/25 text-slate-100 px-2 py-0.5">{warn} warning{warn === 1 ? '' : 's'}</span>}
              {b.scoreParts.map((p) => <span key={p.k} className="rounded-full bg-white/10 text-slate-100 px-2 py-0.5" title={`Weight ${p.w}`}>{p.k} {p.pct}%</span>)}
            </div>
          </div>
          <div className="flex flex-wrap sm:flex-col gap-2 shrink-0">
            <button type="button" onClick={copy} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white text-dixon-navy px-3 py-1.5 text-fs-13 font-bold hover:bg-slate-100">
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy report'}
            </button>
            <button type="button" onClick={download} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/40 px-3 py-1.5 text-fs-13 font-bold hover:bg-white/10">
              <Download size={15} /> Download report
            </button>
            <button type="button" onClick={() => { const el = document.getElementById('ai-q'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }}
              className="xl:hidden inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/40 px-3 py-1.5 text-fs-13 font-bold hover:bg-white/10">
              <MessageSquare size={15} /> Ask a question
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-12 xl:col-span-8 flex flex-col gap-3 min-w-0">
          <ForecastCard f={b.forecast} isToday={ctx.isToday} />
          {/* 25-11-2026: the action plan of this line — why, what happens if not, what to do, who, by when */}
          {ctx.line && <AdvisorFor ids={[String(ctx.line)]} />}

          <Card title="What to do">
            {b.actions.length ? (
              <ol className="mt-3 flex flex-col gap-2" aria-label="Actions">
                {b.actions.map((a, i) => (
                  <li key={a.key} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="shrink-0 h-6 w-6 rounded-full bg-dixon-navy text-white text-fs-12 font-bold flex items-center justify-center">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-fs-14 font-bold text-slate-900">{a.title}</span>
                        {a.gain >= 1 && <span className="font-mono text-fs-13 font-bold text-sky-700">+{fmtN(a.gain)} pcs</span>}
                      </div>
                      <div className="text-fs-13 text-slate-700 leading-snug">{a.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-fs-14 text-slate-700">No action with a clear gain found.</p>}
          </Card>

          <AlertList alerts={b.alerts} onPickHour={onPickHour} />

          <Card title="Day report">
            <div className="mt-2 grid md:grid-cols-2 gap-x-5 gap-y-3">
              {b.sections.map((s) => (
                <div key={s.key}>
                  <h4 className="text-fs-13 font-bold text-slate-600 mb-1 inline-flex items-center gap-1.5">
                    {s.key === 'production' ? <TrendingUp size={14} /> : s.key === 'time' ? <ListChecks size={14} /> : <MessageSquare size={14} />}{s.title}
                  </h4>
                  <ul className="list-disc pl-4 space-y-1 text-fs-14 text-slate-800 leading-snug">{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4 xl:sticky xl:top-3 min-w-0">
          <AskPanel ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
