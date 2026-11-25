import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Save, Lock, CheckCircle2 } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { lineCfg, lineRows, lineTargets, cycleBy, masterFor, linePeriods, sameCfg } from '../utils/targetMethods';
import { getAuth } from '../auth';
import { serverNow } from '../utils/serverTime';
import { loadMaster } from '../hooks/useAutoTargets';
import { lossMatrix } from '../utils/money';
import { normalizeRule, ruleKeyOf, ruleStart, ruleEnd } from '../utils/uiSettings';
import { addDays } from '../utils/mainFilter';
import useUiSettings from '../hooks/useUiSettings';
import useAutoTargets, { loadAutoTargets, mergeTargets } from '../hooks/useAutoTargets';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';

/**
 * Line target method: which method sets the target cycle on each line.
 *   A = the second with the most pieces (+ allowance)        — strictest
 *   B = the second within which B % of the pieces were made   — most reachable
 *   C = the average running cycle (gaps 1..gap limit)        — in between
 * All three from the same valid scans (rule: data from, gap limit, min. gaps — Target rule & check page).
 * The chosen method + allowance of a line is used by every screen of that line: target qty, loss, hour targets, TV.
 * A target locked for a model (Target rule & check page) still wins.
 * Before saving, the page shows what each method would have given in a chosen period (target, achievement, loss).
 */
const METHODS = {
  A: { name: 'Most common cycle', short: 'A', text: 'The second in which the most pieces were made + allowance. Strictest target.', tone: 'border-slate-500 bg-slate-50 text-slate-950', dot: 'bg-slate-500' },
  B: { name: '% of pieces within', short: 'B', text: 'The second within which the chosen % of pieces were made. Most reachable.', tone: 'border-sky-500 bg-sky-50 text-sky-950', dot: 'bg-sky-500' },
  C: { name: 'Average cycle', short: 'C', text: 'The average running cycle (stops left out). In between A and B.', tone: 'border-blue-500 bg-blue-50 text-blue-950', dot: 'bg-blue-500' },
  D: { name: 'Model master', short: 'D', text: 'The cycle time of the Model master (+ allowance). A model not in the master has no target (—).', tone: 'border-violet-500 bg-violet-50 text-violet-950', dot: 'bg-violet-500' },
};
const DEFAULT_ADD = { A: 3, B: 0, C: 0, D: 0 };
const PERIODS = [['today', 'Today'], ['yday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days']];
const nf = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN'));
const hm = (sec) => { if (sec == null) return '—'; const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const dmy = (s) => { const [y, m, d] = String(s || '').split('-'); return d ? `${d}-${m}-${y}` : '—'; };
const inp = 'h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-fs-14 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40';

export default function LineTargetsPage({ canEdit = false }) {
  const { ui, save: saveUi } = useUiSettings();
  const rule = ui.targetRule;
  const auto = useAutoTargets();
  const settings = useAllLineSettings(LINE_IDS);
  const today = serverToday();
  const [draft, setDraft] = useState(() => Object.fromEntries(LINE_IDS.map((l) => [l, lineCfg(rule, l)])));
  useEffect(() => { setDraft(Object.fromEntries(LINE_IDS.map((l) => [l, lineCfg(rule, l)]))); }, [ruleKeyOf(rule)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [period, setPeriod] = useState('7');
  const [cd, setCd] = useState(null);
  const [al, setAl] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setMasterTick] = useState(0);
  useEffect(() => { loadMaster().then(() => setMasterTick((n) => n + 1)); }, []);   // Method D: the Model master
  const ctl = useRef(null);
  const ctl2 = useRef(null);

  const range = useMemo(() => {
    if (period === 'today') return { start: today, end: today };
    if (period === 'yday') { const y = addDays(today, -1); return { start: y, end: y }; }
    return { start: addDays(today, -(Number(period) - 1)), end: today };
  }, [period, today]);

  // the same scans the automatic targets use (rule start date → today)
  const loadModels = async (fresh = false) => {
    ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
    setLoading(true); setErr('');
    try { setCd(await api.controlDataAll(ruleStart(rule, today), ruleEnd(rule, today), { cap: Math.max(60, rule.cap), signal: c.signal, fresh })); }
    catch (e) { if (e.name !== 'AbortError') setErr(String(e.message || e)); }
    finally { if (ctl.current === c) setLoading(false); }
  };
  useEffect(() => { loadModels(false); return () => ctl.current?.abort(); }, [rule.from, rule.to, rule.cap]); // eslint-disable-line react-hooks/exhaustive-deps
  // production of the period, to show what each method would give
  useEffect(() => {
    ctl2.current?.abort(); const c = new AbortController(); ctl2.current = c;
    setAl(null);
    api.allLinesParallel({ ...range, cmin: 1, cmax: rule.cap }, { signal: c.signal }).then((j) => { if (ctl2.current === c) setAl(j); }).catch(() => {});
    return () => c.abort();
  }, [range.start, range.end, rule.cap]); // eslint-disable-line react-hooks/exhaustive-deps

  // the methods chosen on the page, as if they held on every day (the comparison below); saved from a date (20-11-2026)
  const draftRule = useMemo(() => normalizeRule({ ...rule, lines: draft, plan: [] }), [rule, draft]);
  const changedLines = LINE_IDS.filter((l) => !sameCfg(lineCfg(draftRule, l), lineCfg(rule, l)));
  const dirty = changedLines.length > 0;
  const [fromDate, setFromDate] = useState(today);
  const [allDays, setAllDays] = useState(false);

  // per line: model rows, and what A / B / C would give in the period
  const view = useMemo(() => LINE_IDS.map((l) => {
    const cfg = lineCfg(draftRule, l);
    const rows = cd ? lineRows(cd.models, draftRule, l) : [];
    const st = settings[l] || {};
    const locked = Object.entries(st.savedTargets || {}).filter(([, t]) => t?.manual).length;
    const line = (al?.lines || []).find((x) => String(x.line) === l);
    const cmp = Object.fromEntries(Object.keys(METHODS).map((m) => {
      const add = m === cfg.method ? cfg.add : DEFAULT_ADD[m];
      const t = cd ? lineTargets(cd.models, draftRule, l, { method: m, add }) : {};
      const res = { add, models: Object.keys(t).length, total: null };
      if (line?.ok) {
        const mx = lossMatrix([line], { [l]: { ...st, targets: mergeTargets(st.savedTargets, t, m === 'D') } }, { range });
        res.total = mx.lines[0]?.total || null;
      }
      return [m, res];
    }));
    return { line: l, name: line?.name || `Line ${l}`, cfg, rows, cmp, locked, ok: line ? line.ok : null };
  }), [draftRule, cd, al, settings, range]);

  const setLine = (l, patch) => setDraft((d) => ({ ...d, [l]: { ...d[l], ...patch } }));
  const pick = (l, m) => setLine(l, { method: m, add: draft[l].method === m ? draft[l].add : DEFAULT_ADD[m] });

  // 20-11-2026: a method is saved from a date — the days before keep the method they had (target method by date);
  // "All dates" changes the line's starting method and removes its dated changes
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      let plan = [...(rule.plan || [])]; const lines = { ...rule.lines };
      const n = serverNow(); const at = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
      for (const l of changedLines) {
        const c = lineCfg(draftRule, l);
        if (allDays) { lines[l] = c; plan = plan.filter((p) => p.line !== l); }
        else { plan = plan.filter((p) => !(p.line === l && p.from === fromDate)); plan.push({ line: l, from: fromDate, ...c, by: getAuth()?.user || '', at }); }
      }
      const next = normalizeRule({ ...rule, lines, plan });
      await saveUi({ ...ui, targetRule: next });
      await loadAutoTargets(true);
      const txt = (c) => `Method ${c.method}${c.method === 'B' ? ` ${c.pct}%` : ''} + ${c.add} s`;
      setMsg(`Saved — ${changedLines.map((l) => `Line ${l}: ${txt(lineCfg(draftRule, l))} ${allDays ? 'on every date' : `from ${dmy(fromDate)}`}`).join(' · ')}.${allDays ? '' : ' The days before keep their old method.'}`);
    } catch (e) { setMsg(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };

  const savedMethods = auto?.methods;
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5" aria-label="Line target method">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
          </div>
          <button type="button" onClick={() => loadModels(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden /> Reload
          </button>
        </div>
        <ul className="mt-3 grid gap-2 md:grid-cols-3 text-fs-14">
          {Object.entries(METHODS).map(([k, m]) => (
            <li key={k} className={`rounded-xl border-l-4 border border-slate-200 px-3 py-2 ${m.tone}`}>
              <div className="font-extrabold">Method {k} — {m.name}</div>
              <div className="leading-snug text-slate-800">{m.text}</div>
            </li>
          ))}
        </ul>
        
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-fs-14 font-semibold text-slate-700">Show the effect for</span>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Period">
            {PERIODS.map(([k, t]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)} className={`h-9 px-3 text-fs-14 font-semibold border-r last:border-r-0 border-slate-300 ${period === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{t}</button>)}
          </div>
          <span className="text-fs-13 text-slate-500">{dmy(range.start)}{range.end !== range.start ? ` → ${dmy(range.end)}` : ''}</span>
        </div>
      </section>

      {err && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-fs-14 font-semibold text-red-800">{err}</div>}
      {!cd && !err && <div className="rounded-2xl border border-slate-200 bg-white shadow-sm py-14 text-center text-fs-14 font-semibold text-slate-600">Reading every scan since {dmy(rule.from)}…</div>}

      {cd && (
        <div className="grid gap-4 xl:grid-cols-2">
          {view.map((v) => {
            const d = draft[v.line] || v.cfg;
            const inUse = savedMethods?.[v.line];
            return (
              <section key={v.line} className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm p-4" aria-label={`Line ${v.line} target method`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-fs-18 font-extrabold text-slate-900">{v.name}</h3>
                  {inUse && <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-fs-13 font-bold text-sky-900"><CheckCircle2 size={13} aria-hidden /> In use: Method {inUse.method}{inUse.method === 'B' ? ` ${inUse.pct}%` : ''} + {inUse.add} s</span>}
                  {v.locked > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-fs-13 font-bold text-blue-900" title="Locked targets win over the method"><Lock size={12} aria-hidden /> {v.locked} locked</span>}
                </div>
                {linePeriods(rule, v.line).length > 1 && (
                  <p className="mt-1 text-fs-13 text-slate-600" aria-label={`Line ${v.line} method by date`}>
                    By date: {linePeriods(rule, v.line).map((p, i) => <span key={i} className={`mr-1.5 inline-block rounded px-1.5 py-0.5 font-semibold ${(!p.from || today >= p.from) && (!p.to || today <= p.to) ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-700'}`}>{p.method}{p.method === 'B' ? ` ${p.pct}%` : ''} + {p.add} s {p.from ? `from ${dmy(p.from)}` : 'at the start'}{p.to ? ` to ${dmy(p.to)}` : ''}</span>)}
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0" role="radiogroup" aria-label={`Method for line ${v.line}`}>
                  {Object.entries(METHODS).map(([k, m]) => {
                    const on = d.method === k;
                    return (
                      <button key={k} type="button" role="radio" aria-checked={on} disabled={!canEdit} onClick={() => pick(v.line, k)}
                        className={`min-w-0 rounded-xl border-2 px-2.5 py-2 text-left transition ${on ? m.tone : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'} ${canEdit ? '' : 'cursor-default'}`}>
                        <div className="flex items-center gap-1.5 text-fs-16 font-extrabold"><span className={`h-2.5 w-2.5 rounded-full ${on ? m.dot : 'bg-slate-300'}`} aria-hidden />Method {k}</div>
                        <div className="text-fs-12 font-semibold leading-tight">{m.name}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <label className="text-fs-13 font-semibold text-slate-700">Allowance (s)
                    <input type="number" min="0" max="30" step="0.5" disabled={!canEdit} aria-label={`Allowance seconds line ${v.line}`} value={d.add} onChange={(e) => setLine(v.line, { add: e.target.value })} className={`${inp} block mt-1`} />
                  </label>
                  {d.method === 'B' && (
                    <label className="text-fs-13 font-semibold text-slate-700">B: % of pieces
                      <input type="number" min="50" max="95" step="5" disabled={!canEdit} aria-label={`B percent line ${v.line}`} value={d.pct} onChange={(e) => setLine(v.line, { pct: e.target.value })} className={`${inp} block mt-1`} />
                    </label>
                  )}
                  <p className="text-fs-13 text-slate-600 pb-1">Target cycle = Method {v.cfg.method} second{v.cfg.method === 'B' ? ` (${v.cfg.pct}%)` : ''} + {v.cfg.add} s</p>
                </div>

                {/* what each method would give in the period */}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-fs-13 tabular-nums" aria-label={`Line ${v.line} methods compared`}>
                    <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">
                      {['Method', 'Models', 'Target pcs', 'Made pcs', 'Achieved %', 'Short pcs', 'Loss time'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {Object.keys(METHODS).map((k) => {
                        const c = v.cmp[k]; const t = c.total; const on = v.cfg.method === k;
                        return (
                          <tr key={k} className={`border-b border-slate-100 ${on ? 'bg-slate-50 font-bold' : ''}`}>
                            <td className="px-2 py-1.5 whitespace-nowrap">{on ? '▶ ' : ''}{k}{k === 'B' ? ` ${v.cfg.pct}%` : ''} + {c.add} s</td>
                            <td className="px-2">{c.models}</td>
                            <td className="px-2">{t ? nf(t.target) : al ? '—' : '…'}</td>
                            <td className="px-2">{t ? nf(t.actualPlanned ?? t.actual) : al ? '—' : '…'}</td>
                            <td className={`px-2 ${t?.pct != null ? (t.pct >= 95 ? 'text-sky-700' : t.pct >= 85 ? 'text-slate-700' : 'text-red-700') : ''}`}>{t?.pct != null ? `${t.pct.toFixed(1)}%` : '—'}</td>
                            <td className="px-2">{t?.short != null ? nf(t.short) : '—'}</td>
                            <td className="px-2 whitespace-nowrap">{t?.lostSec != null ? hm(t.lostSec) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {v.ok === false && <p className="mt-1 text-fs-13 font-semibold text-red-700">Line not reachable — effect not shown.</p>}
                </div>

                {/* biggest models: their target with each method */}
                <details className="mt-3" open={false}>
                  <summary className="cursor-pointer text-fs-14 font-bold text-blue-800">Model targets on this line ({v.rows.length})</summary>
                  <div className="mt-2 max-h-72 overflow-auto">
                    <table className="w-full text-fs-13 tabular-nums" aria-label={`Line ${v.line} model targets`}>
                      <thead className="sticky top-0 bg-white"><tr className="border-b-2 border-slate-300 text-left text-slate-600">
                        {['Model', 'Qty', 'A (s)', 'B (s)', 'C (s)', 'D master (s)', 'Target (s)', 'Target pcs/hr'].map((h) => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {v.rows.map((r) => {
                          const lk = settings[v.line]?.savedTargets?.[String(r.mmId)];
                          const t = lk?.manual ? lk.cycle : cycleBy(r, v.cfg.method, v.cfg.add);
                          return (
                            <tr key={r.mmId} className="border-b border-slate-100">
                              <td className="px-2 py-1 font-semibold whitespace-nowrap">{r.model}</td>
                              <td className="px-2">{nf(r.qty)}</td>
                              {['A', 'B', 'C'].map((k) => <td key={k} className={`px-2 ${v.cfg.method === k ? 'font-extrabold text-slate-950' : 'text-slate-500'}`}>{r[k]?.sec != null ? `${r[k].sec}` : r.tooFew ? 'few' : '—'}</td>)}
                              <td className={`px-2 ${v.cfg.method === 'D' ? 'font-extrabold text-slate-950' : 'text-slate-500'}`} title={masterFor(r) ? 'Cycle time in the Model master' : 'Not in the Model master'}>{masterFor(r) ? `${masterFor(r).cycle}` : '—'}</td>
                              <td className="px-2 font-extrabold">{t != null ? `${t} s` : '—'}{lk?.manual && <Lock size={11} className="ml-1 inline text-blue-700" aria-label="locked" />}</td>
                              <td className="px-2">{t ? nf(3600 / t) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/95 px-4 py-3 shadow-md">
          <label className="text-fs-14 font-semibold text-slate-800">Use from
            <input type="date" aria-label="Use the method from" value={fromDate} disabled={allDays} onChange={(e) => e.target.value && setFromDate(e.target.value)} className="ml-1.5 h-10 rounded-lg border border-slate-300 bg-white px-2 text-fs-14 font-semibold disabled:opacity-50" />
          </label>
          <label className="inline-flex items-center gap-1.5 text-fs-13 font-semibold text-slate-700" title="Also the days before (the line's starting method; its dated changes are removed)">
            <input type="checkbox" checked={allDays} onChange={(e) => setAllDays(e.target.checked)} className="h-4 w-4" /> All dates (the past too)
          </label>
          <button type="button" disabled={!dirty || busy} onClick={save} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={16} aria-hidden /> {busy ? 'Saving…' : 'Save line targets'}</button>
          {dirty && !busy && <button type="button" onClick={() => setDraft(Object.fromEntries(LINE_IDS.map((l) => [l, lineCfg(rule, l)])))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-semibold text-slate-700">Undo changes</button>}
          <span role="status" className={`text-fs-14 font-semibold ${msg.startsWith('Not') ? 'text-red-700' : 'text-sky-800'}`}>{msg || (dirty ? 'Not saved yet.' : 'No changes.')}</span>
        </div>
      ) : (
        null
      )}
    </div>
  );
}
