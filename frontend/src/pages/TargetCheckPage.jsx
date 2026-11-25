import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Clock, Lock, Unlock, RefreshCw, Search, Save, BarChart3 } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { lineRows, lineCfg, cycleBy } from '../utils/targetMethods';
import { coKey } from '../utils/mainFilter';
import { realCycleSec, normShift } from '../utils/shift';
import useUiSettings from '../hooks/useUiSettings';
import { normalizeRule, ruleKeyOf, ruleStart, ruleEnd } from '../utils/uiSettings';
import useAutoTargets, { loadAutoTargets, targetSource, ymd, loadMaster } from '../hooks/useAutoTargets';
import { useAllLineSettings, settingsChanged } from '../hooks/useLineSettings';
import { serverNow } from '../utils/serverTime';

/**
 * Target rule & check: how every target cycle is worked out, checked on the spot, and managed in one place.
 *   1. the rule (data from a start date, gap limit; each line's method + allowance is set on the Line target method page)
 *   2. self-checks: the numbers every screen uses are recomputed here and compared (PASS / CHECK)
 *   3. today's actual cycle of each line, worked out step by step
 *   4. every model: valid gaps, Method A, target, pcs/hr, target in force and where it comes from;
 *      the admin can lock a manual target for a model (it then wins over the automatic one)
 *   5. click a model: its 1-second histogram and the calculation written out
 */
const nf = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN'));
const d1 = (v) => (v == null || Number.isNaN(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const dmy = (s) => { const [y, m, d] = String(s || '').split('-'); return d ? `${d}-${m}-${y}` : '—'; };
const hhmm = (s) => (s ? String(s).slice(11, 16) : '—');
const inp = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-14 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40';
const SRC = {
  manual: ['Locked', 'bg-blue-100 text-blue-900'],
  master: ['Master', 'bg-violet-100 text-violet-900'],
  auto: ['Auto (line method)', 'bg-sky-100 text-sky-900'],
  saved: ['Saved (few scans)', 'bg-slate-100 text-slate-900'],
  none: ['No target', 'bg-slate-100 text-slate-700'],
};

function Check({ ok, title, children }) {
  const Icon = ok === true ? CheckCircle2 : ok === false ? AlertTriangle : Clock;
  const tone = ok === true ? 'border-sky-200 bg-sky-50 text-sky-900' : ok === false ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-800';
  return (
    <li className={`flex gap-3 rounded-xl border px-3.5 py-2.5 ${tone}`}>
      <Icon size={20} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <div className="text-fs-14 font-bold"><span className="mr-2 rounded px-1.5 py-0.5 text-fs-11 font-extrabold bg-white/70">{ok === true ? 'PASS' : ok === false ? 'CHECK' : 'WAIT'}</span>{title}</div>
        <div className="text-fs-13 leading-snug mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/** 1-second histogram of the valid gaps of one model (low..cap s), Method A bar highlighted. */
function Histogram({ gaps, cap, a }) {
  const counts = Array.from({ length: cap }, () => 0);
  for (const g of gaps) { const s = Math.ceil(g); if (s >= 1 && s <= cap) counts[s - 1]++; }
  const max = Math.max(1, ...counts);
  return (
    <div>
      <div className="flex items-end gap-[3px] h-44 border-b border-slate-300" role="img" aria-label="Gaps per second">
        {counts.map((c, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${i}–${i + 1} s: ${c} gaps`}>
            <span className={`text-fs-10 font-mono leading-none mb-0.5 ${i + 1 === a ? 'font-extrabold text-slate-800' : 'text-slate-500'}`}>{c || ''}</span>
            <div className={`w-full rounded-t ${i + 1 === a ? 'bg-slate-500' : 'bg-sky-400/80'}`} style={{ height: `${(c / max) * 88}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] mt-0.5">{counts.map((_, i) => <span key={i} className={`flex-1 text-center text-fs-10 font-mono ${i + 1 === a ? 'font-extrabold text-slate-800' : 'text-slate-500'}`}>{i + 1}</span>)}</div>
      <div className="text-fs-12 text-slate-600 mt-1">seconds per piece (a gap of 9.4 s counts in the 10 s bar) · orange = Method A, the second with the most pieces</div>
    </div>
  );
}

/** What a changed rule would do: every model's target now and with the new rule; Apply saves it for every screen. */
function RulePreview({ prev, rule, q, setQ, onApply, onClose, stale }) {
  const [sure, setSure] = useState(false);
  const r2 = prev.rule, list = prev.list || [];
  const n = (k) => list.reduce((a, x) => a + (x[k] || 0), 0);
  const both = list.filter((x) => x.diff != null);
  const up = both.filter((x) => x.diff > 0.05), down = both.filter((x) => x.diff < -0.05);
  const lost = list.filter((x) => x.tOld != null && x.tNew == null), gained = list.filter((x) => x.tOld == null && x.tNew != null);
  // biggest change first: a target that goes away, then the biggest change in seconds, a new target, then the rest by pieces
  const rank = (x) => (x.tOld != null && x.tNew == null ? 1000 : x.diff != null ? Math.abs(x.diff) * 10 : x.tOld == null && x.tNew != null ? 5 : -1);
  const needle = q.trim().toUpperCase();
  const shown = list.filter((x) => !needle || `${x.model} ${x.company || ''}`.toUpperCase().includes(needle))
    .sort((a, b) => rank(b) - rank(a) || b.qty - a.qty);
  const what = [r2.from !== rule.from && `data from ${dmy(rule.from)} → ${dmy(r2.from)}`, (r2.to || '') !== (rule.to || '') && `data to ${rule.to ? dmy(rule.to) : 'today'} → ${r2.to ? dmy(r2.to) : 'today'}`, r2.low !== rule.low && `eliminate below ${rule.low} → ${r2.low} s`, r2.cap !== rule.cap && `eliminate above ${rule.cap} → ${r2.cap} s`, r2.min !== rule.min && `min. gaps ${rule.min} → ${r2.min}`].filter(Boolean).join(' · ');
  const tile = (k, v, tone = 'text-slate-900') => <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><div className="text-fs-12 font-bold text-slate-600">{k}</div><div className={`font-mono text-fs-20 font-extrabold leading-tight ${tone}`}>{v}</div></div>;
  return (
    <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50/60 p-3.5" role="region" aria-label="Rule analysis">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-fs-16 font-extrabold text-slate-900">Analysis — not applied yet</h3>
        <span className="text-fs-14 text-slate-700">{what}</span>
        <button type="button" onClick={onClose} className="ml-auto text-fs-13 font-bold text-slate-600 hover:underline">Close</button>
      </div>
      {stale && <p className="mt-1 text-fs-13 font-bold text-red-700">The values were changed after this analysis — press “Analyse change” again.</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {tile('Gaps read', nf(n('gaps')))}
        {tile(`< ${r2.low} s eliminated`, nf(n('belowLow')), 'text-red-700')}
        {tile(`> ${r2.cap} s eliminated`, nf(n('aboveCap')), 'text-red-700')}
        {tile('Valid scans', nf(n('validNew')), 'text-emerald-800')}
        {tile('Models', nf(list.length))}
        {tile('Target slower', nf(up.length), up.length ? 'text-amber-700' : 'text-slate-900')}
        {tile('Target faster', nf(down.length), down.length ? 'text-blue-800' : 'text-slate-900')}
        {tile('Target lost / new', `${nf(lost.length)} / ${nf(gained.length)}`, lost.length ? 'text-red-700' : 'text-slate-900')}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="relative"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" aria-hidden /><input aria-label="Find a model in the analysis" placeholder="Find model / company" value={q} onChange={(e) => setQ(e.target.value)} className={`${inp} w-64 pl-7`} /></label>
        <span className="text-fs-13 text-slate-600">biggest change first · target = the line's method + allowance · locked targets stay as they are</span>
      </div>
      <div className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-fs-14 tabular-nums" aria-label="Targets now and with the new rule">
          <thead className="sticky top-0 bg-slate-100"><tr className="text-left text-fs-13 text-slate-700">
            {['Line', 'Model', 'Company', 'Qty', `< ${r2.low} s out`, `> ${r2.cap} s out`, 'Valid now → new', 'Target now (s)', 'New target (s)', 'Change', 'Target source'].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2 font-bold">{h}</th>)}
          </tr></thead>
          <tbody>
            {shown.slice(0, 300).map((x) => (
              <tr key={`${x.line}-${x.mmId}`} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-2.5 py-1.5 font-bold">L{x.line}</td>
                <td className="min-w-[160px] break-words px-2.5 font-mono font-bold text-slate-900">{x.model}</td>
                <td className="px-2.5 text-slate-700">{x.company || '—'}</td>
                <td className="px-2.5 font-mono">{nf(x.qty)}</td>
                <td className="px-2.5 font-mono text-red-700">{nf(x.belowLow)}</td>
                <td className="px-2.5 font-mono text-red-700">{nf(x.aboveCap)}</td>
                <td className="whitespace-nowrap px-2.5 font-mono">{nf(x.validOld)} → <b>{nf(x.validNew)}</b></td>
                <td className="px-2.5 font-mono">{x.tOld != null ? d1(x.tOld) : x.inForce != null ? <>{d1(x.inForce)} <span className="font-sans text-fs-12 text-slate-500">saved</span></> : '—'}</td>
                <td className="px-2.5 font-mono font-extrabold">{x.tNew != null ? d1(x.tNew) : <span className="font-sans text-fs-13 font-semibold text-amber-800">{x.saved != null ? `keeps saved ${d1(x.saved)} s` : 'no target'} · too few gaps</span>}</td>
                <td className={`whitespace-nowrap px-2.5 font-mono font-extrabold ${x.diff > 0.05 ? 'text-amber-700' : x.diff < -0.05 ? 'text-blue-800' : 'text-slate-500'}`}>{x.diff == null ? '—' : x.diff > 0 ? `+${d1(x.diff)} s` : x.diff < 0 ? `${d1(x.diff)} s` : 'same'}</td>
                <td className="px-2.5 text-fs-13">{x.src === 'manual' ? <b className="text-blue-900">Locked (stays)</b> : (SRC[x.src] || SRC.none)[0]}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-500">No model.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!sure ? (
          <button type="button" disabled={stale} onClick={() => setSure(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={15} aria-hidden /> Apply this rule…</button>
        ) : (
          <>
            <span className="text-fs-14 font-bold text-slate-900">Apply to every screen? {nf(up.length + down.length + lost.length + gained.length)} model targets change.</span>
            <button type="button" onClick={onApply} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-800 px-4 text-fs-14 font-bold text-white hover:bg-blue-900"><Save size={15} aria-hidden /> Yes, apply rule</button>
            <button type="button" onClick={() => setSure(false)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-bold text-slate-700">Not now</button>
          </>
        )}
        <span className="text-fs-13 text-slate-600">Until then every screen keeps the rule in force ({rule.low}–{rule.cap} s).</span>
      </div>
    </div>
  );
}

export default function TargetCheckPage({ fixedLine = null, canEdit = false }) {
  const { ui, save: saveUi } = useUiSettings();
  const rule = ui.targetRule;
  const auto = useAutoTargets();
  const settings = useAllLineSettings(LINE_IDS);
  const [, setMasterTick] = useState(0);
  useEffect(() => { loadMaster().then(() => setMasterTick((n) => n + 1)); }, []);   // Method D: the Model master
  const [form, setForm] = useState(rule);
  useEffect(() => { setForm(rule); }, [ruleKeyOf(rule)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState('');
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [lineSel, setLineSel] = useState(fixedLine || 'all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({});
  const [prev, setPrev] = useState(null);   // analysis of a changed rule: { busy, rule, list }
  const [prevQ, setPrevQ] = useState('');
  const ctl = useRef(null);
  const to = ymd(serverNow());

  const load = async (fresh = false) => {
    ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
    setLoading(true); setErr('');
    try {
      const [j, l] = await Promise.all([
        api.controlDataAll(ruleStart(rule, to), ruleEnd(rule, to), { cap: Math.max(60, rule.cap), signal: c.signal, fresh }),
        api.liveLinesParallel({ cmin: 1, cmax: rule.cap }).catch(() => null),
      ]);
      setData(j); setLive(l);
    } catch (e) { if (e.name !== 'AbortError') setErr(String(e.message || e)); } finally { if (ctl.current === c) setLoading(false); }
  };
  useEffect(() => { load(false); return () => ctl.current?.abort(); }, [rule.from, rule.to, rule.cap]); // eslint-disable-line react-hooks/exhaustive-deps

  const models = useMemo(() => new Map((data?.models || []).map((m) => [`${m.line}-${String(m.mmId).replace(/^L\d+-/, '')}`, m])), [data]);
  const rows = useMemo(() => LINE_IDS.flatMap((l) => lineRows(data?.models, rule, l)).sort((a, b) => b.qty - a.qty).map((r) => {
    const cfg = lineCfg(rule, r.line);
    const saved = settings[r.line]?.savedTargets || {}, au = auto?.byLine?.[r.line] || {};
    const src = targetSource(saved, au, String(r.mmId)) || 'none';
    const inForce = settings[r.line]?.targets?.[String(r.mmId)]?.cycle ?? null;
    return { ...r, cfg, expect: cycleBy(r, cfg.method, cfg.add), src, inForce, saved: saved[String(r.mmId)]?.cycle ?? null, autoT: au[String(r.mmId)]?.cycle ?? null };
  }), [data, rule, settings, auto]);
  const needle = q.trim().toUpperCase();
  const shown = rows.filter((r) => (lineSel === 'all' || String(r.line) === String(lineSel)) && (!needle || `${r.model} ${r.modelCode || ''} ${r.company || ''}`.toUpperCase().includes(needle)));

  // ── self-checks ──
  const ruleKey = ruleKeyOf(rule);
  const autoReady = auto && auto.rule === ruleKey;
  const withA = rows.filter((r) => r.A);
  const withT = rows.filter((r) => r.expect != null);
  const badAuto = autoReady ? withT.filter((r) => r.src !== 'manual' && r.autoT != null && Math.abs(r.autoT - r.expect) > 0.01) : [];
  const missingAuto = autoReady ? withT.filter((r) => r.autoT == null) : [];
  const badPph = withA.filter((r) => Math.abs(r.A.pph * r.A.target - 3600) > 0.5);
  const badForce = rows.filter((r) => {
    const want = r.src === 'manual' ? r.saved : r.src === 'auto' ? r.autoT : r.src === 'saved' ? r.saved : null;
    return want != null && r.inForce != null && Math.abs(want - r.inForce) > 0.01;
  });
  const liveLines = (live?.lines || []).filter((l) => l.ok && (lineSel === 'all' || String(l.line) === String(lineSel)));
  const liveChecks = liveLines.map((l) => {
    const st = settings[l.line] || {};
    const mm = String(l.mmId ?? l.running?.mmId ?? '');
    const row = rows.find((r) => String(r.line) === String(l.line) && String(r.mmId) === mm);
    const t = st.targets?.[mm]?.cycle ?? null;
    const sh = normShift(st.shift);
    const real = realCycleSec(st.shift, l.firstScan, l.lastScan, l.total);
    const tm = (s) => { const m = /(\d{2}):(\d{2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60 : null; };
    const a = tm(l.firstScan), b = tm(l.lastScan);
    const lunch = a != null && b != null && sh.lunchStart != null ? Math.max(0, Math.min(b, sh.lunchEnd) - Math.max(a, sh.lunchStart)) : 0;
    return { l, mm, row, t, real, lunch, span: a != null && b != null ? b - a : null, sh };
  });

  // a changed rule is first analysed (old vs new target of every model) and only applied when the admin says so
  const draft = normalizeRule({ ...rule, ...form, lines: rule.lines });
  const changed = ruleKeyOf(draft) !== ruleKeyOf(rule);
  const analyse = async () => {
    setMsg(''); setPrev({ busy: true, rule: draft });
    try {
      // the scans already read do when the start date is the same and the gap limit is inside what was read
      const reuse = data && draft.from === rule.from && draft.to === rule.to && Math.max(60, draft.cap) <= Math.max(60, rule.cap);
      const j = reuse ? data : await api.controlDataAll(ruleStart(draft, to), ruleEnd(draft, to), { cap: Math.max(60, draft.cap) });
      const now = new Map(rows.map((r) => [`${r.line}-${r.mmId}`, r]));
      const list = LINE_IDS.flatMap((l) => lineRows(j?.models, draft, l)).map((n) => {
        const cfg = lineCfg(draft, n.line); const o = now.get(`${n.line}-${n.mmId}`);
        const tNew = cycleBy(n, cfg.method, cfg.add), tOld = o?.expect ?? null;
        return { line: n.line, mmId: n.mmId, model: n.model, company: n.company, qty: n.qty, gaps: n.gaps, belowLow: n.belowLow, aboveCap: n.aboveCap, validNew: n.valid, validOld: o?.valid ?? null,
          tOld, tNew, diff: tOld != null && tNew != null ? Math.round((tNew - tOld) * 10) / 10 : null, method: cfg.method, src: o?.src || 'none', inForce: o?.inForce ?? null, saved: o?.saved ?? null };
      }).filter((r) => r.qty > 0);
      setPrev({ busy: false, rule: draft, list });
    } catch (e) { setPrev(null); setMsg(`Not analysed: ${e.message}`); }
  };
  const saveRule = async () => {
    setMsg('');
    try { await saveUi({ ...ui, targetRule: draft }); setPrev(null); setMsg('Rule applied — every screen now uses it (targets are worked out again).'); loadAutoTargets(true); } catch (e) { setMsg(`Could not save: ${e.message}`); }
  };
  const lock = async (r, cycle) => {
    const c = Number(cycle);
    if (!(c >= 1 && c <= 3600)) { setMsg('Enter a target cycle between 1 and 3600 s.'); return; }
    try { await api.saveLineSettings(r.line, { action: 'target', mmId: Number(r.mmId), cycle: c, model: r.model, company: r.company || '', manual: true }); settingsChanged(); setMsg(`${r.model} (Line ${r.line}) locked at ${c} s.`); setEdit((e) => ({ ...e, [`${r.line}-${r.mmId}`]: undefined })); } catch (e) { setMsg(`Could not save: ${e.message}`); }
  };
  const unlock = async (r) => {
    try { await api.saveLineSettings(r.line, { action: 'target', mmId: Number(r.mmId), cycle: null }); settingsChanged(); setMsg(`${r.model} (Line ${r.line}) uses the automatic target again.`); } catch (e) { setMsg(`Could not save: ${e.message}`); }
  };

  const selRow = sel ? rows.find((r) => `${r.line}-${r.mmId}` === sel) : null;
  const selGaps = useMemo(() => {
    const m = selRow ? models.get(`${selRow.line}-${selRow.mmId}`) : null;
    const g = []; for (const d of Object.values(m?.days || {})) for (const x of d.g || []) if (x >= rule.low && x <= rule.cap) g.push(x);
    return g;
  }, [selRow, models, rule.cap, rule.low]);

  return (
    <div className="flex flex-col gap-4">
      {/* 1 · the rule */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5" aria-label="Target rule">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
          </div>
          <button type="button" onClick={() => { load(true); loadAutoTargets(true); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden /> Work out again
          </button>
        </div>
        <ol className="mt-3 grid gap-2 md:grid-cols-4 text-fs-14">
          {[
            ['1', 'Data', <>Every scan of the model from <b>{dmy(rule.from)}</b> to <b>{rule.to && rule.to < to ? dmy(rule.to) : 'today'}</b>, all lines{rule.to && rule.to < to ? ' (fixed: later days do not change the targets)' : ''}.</>],
            ['2', 'Clean', <>Gap between two pieces of the same model. Only gaps <b>{rule.low}–{rule.cap} s</b> count (shorter = double scan / glitch, longer = stop, changeover, break) — both are eliminated.</>],
            ['3', 'Method A', <>The whole second with the <b>most pieces</b> (needs at least {rule.min} valid gaps).</>],
            ['4', 'Target', <>Target cycle = <b>the line's method + allowance</b> ({LINE_IDS.map((l) => { const c = lineCfg(rule, l); return `L${l} ${c.method}${c.method === 'B' ? ` ${c.pct}%` : ''} + ${c.add} s`; }).join(' · ')}) · target pcs/hr = 3600 ÷ target cycle · loss = target − actual. Change it on <b>Line target method</b>.</>],
          ].map(([n, t, x]) => (
            <li key={n} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="text-fs-13 font-extrabold text-blue-800">{n} · {t}</div>
              <div className="text-slate-800 leading-snug">{x}</div>
            </li>
          ))}
        </ol>
        
        {canEdit && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-3.5 py-3" role="group" aria-label="Change the rule">
            <label className="text-fs-13 font-semibold text-slate-700">Data from<input type="date" aria-label="Data from" value={form.from} max={to} onChange={(e) => setForm({ ...form, from: e.target.value })} className={`${inp} block mt-1`} /></label>
            <label className="text-fs-13 font-semibold text-slate-700">Data to <span className="font-normal text-slate-500">(empty = today)</span><input type="date" aria-label="Data to" value={form.to || ''} min={form.from} max={to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={`${inp} block mt-1`} /></label>
            <label className="text-fs-13 font-semibold text-slate-700">Eliminate gaps below (s)<input type="number" min="0" max="60" step="0.1" aria-label="Lowest valid gap seconds" title="Gaps shorter than this (double scans, glitches) are eliminated" value={form.low ?? 1} onChange={(e) => setForm({ ...form, low: e.target.value })} className={`${inp} block mt-1 w-24`} /></label>
            <label className="text-fs-13 font-semibold text-slate-700">Eliminate gaps above (s)<input type="number" min="5" max="120" aria-label="Gap limit seconds" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} className={`${inp} block mt-1 w-24`} /></label>
            <label className="text-fs-13 font-semibold text-slate-700">Min. gaps for a target<input type="number" min="5" max="500" aria-label="Minimum valid gaps" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} className={`${inp} block mt-1 w-24`} /></label>
            <button type="button" onClick={analyse} disabled={!changed || prev?.busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><BarChart3 size={15} aria-hidden /> {prev?.busy ? 'Analysing…' : 'Analyse change'}</button>
            {changed && <button type="button" onClick={() => { setForm(rule); setPrev(null); }} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-bold text-slate-700 hover:bg-slate-50">Undo</button>}
            <span className="w-full text-fs-13 text-slate-600">{changed ? 'Not applied yet — analyse first: the targets of every model with the new rule, side by side with today\'s. Nothing changes on the screens until you press Apply.' : 'Change a value, then analyse its effect before applying it.'}</span>
          </div>
        )}
        {canEdit && prev && !prev.busy && <RulePreview prev={prev} rule={rule} q={prevQ} setQ={setPrevQ} onApply={saveRule} onClose={() => setPrev(null)} stale={ruleKeyOf(prev.rule) !== ruleKeyOf(draft)} />}
        {msg && <div role="status" className={`mt-2 text-fs-14 font-bold ${msg.startsWith('Not') || msg.startsWith('Enter') ? 'text-red-700' : 'text-sky-800'}`}>{msg}</div>}
      </section>

      {err && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-fs-14 font-semibold text-red-800">{err}</div>}
      {!data && !err && <div className="rounded-2xl border border-slate-200 bg-white shadow-sm py-14 text-center text-fs-14 font-semibold text-slate-600">Reading every scan since {dmy(rule.from)}…</div>}

      {data && (
        <>
          {/* 2 · self-checks */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5" aria-label="Self-checks">
            <h3 className="text-fs-16 font-bold text-slate-900">Self-checks</h3>
            
            <ul className="grid gap-2 lg:grid-cols-2">
              <Check ok={autoReady ? true : null} title="Targets worked out with this rule">
                {autoReady ? <>Data {dmy(auto.from)} → {dmy(auto.to)} · gaps {auto.low ?? 1}–{auto.cap} s · {Object.values(auto.byLine).reduce((s, x) => s + Object.keys(x).length, 0)} models with an automatic target.</> : 'Working out the targets…'}
              </Check>
              <Check ok={autoReady ? badAuto.length === 0 && missingAuto.length === 0 : null} title="Target = the line's method + allowance for every model">
                {badAuto.length || missingAuto.length ? <>{badAuto.length + missingAuto.length} model(s) differ: {[...badAuto, ...missingAuto].slice(0, 4).map((r) => `${r.model} (L${r.line})`).join(', ')} — press “Work out again”.</> : <>{withT.length} models checked, all equal.</>}
              </Check>
              <Check ok={badPph.length === 0} title="Target pcs/hr = 3600 ÷ target cycle">{badPph.length ? `${badPph.length} model(s) off.` : `${withA.length} models checked.`}</Check>
              <Check ok={badForce.length === 0} title="Every screen uses the target in force (locked › automatic › saved)">{badForce.length ? `${badForce.length} model(s) differ: ${badForce.slice(0, 4).map((r) => r.model).join(', ')}.` : `${rows.filter((r) => r.inForce != null).length} models with a target, all as expected.`}</Check>
              {liveChecks.map(({ l, row, t, real }) => (
                <Check key={l.line} ok={t != null && real != null ? true : null} title={`Line ${l.line} now: ${l.model || '—'}`}>
                  Target on the live card <b>{t != null ? `${t} s` : '—'}</b>{row?.expect != null ? <> (Method {row.cfg.method} {row[row.cfg.method].sec} s + {row.cfg.add} s{row.src === 'manual' ? ', locked' : ''})</> : row ? ' (too few scans: saved target)' : t != null ? ' (no scans since the start date: saved target)' : ''} · actual cycle today <b>{real != null ? `${d1(real)} s` : '—'}</b>
                </Check>
              ))}
            </ul>
          </section>

          {/* 3 · actual cycle today */}
          {liveChecks.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5" aria-label="Actual cycle today">
              <h3 className="text-fs-16 font-bold text-slate-900">Actual cycle today — worked out</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-fs-14 tabular-nums" aria-label="Actual cycle">
                  <thead><tr className="border-b-2 border-slate-300 text-left text-fs-13 text-slate-600">
                    {['Line', 'First scan', 'Last scan', 'Minutes', 'Lunch', 'Qty', 'Actual cycle', 'Running speed (gaps ≤ ' + rule.cap + ' s)', 'Target in force'].map((h) => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {liveChecks.map(({ l, t, real, lunch, span }) => (
                      <tr key={l.line} className="border-b border-slate-100">
                        <td className="px-2.5 py-2 font-bold">Line {l.line}</td>
                        <td className="px-2.5">{hhmm(l.firstScan)}</td><td className="px-2.5">{hhmm(l.lastScan)}</td>
                        <td className="px-2.5">{span != null ? d1(span) : '—'}</td><td className="px-2.5">{d1(lunch)}</td>
                        <td className="px-2.5">{nf(l.total)}</td>
                        <td className="px-2.5 whitespace-nowrap"><b className="text-fs-16">{real != null ? `${d1(real)} s` : '—'}</b>{span != null && l.total > 1 && <span className="ml-1.5 text-fs-12 text-slate-500">= ({d1(span)} − {d1(lunch)}) × 60 ÷ {nf(l.total - 1)}</span>}</td>
                        <td className="px-2.5">{l.avgCycle != null ? `${d1(l.avgCycle)} s` : '—'}</td>
                        <td className="px-2.5 font-bold">{t != null ? `${t} s` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
            </section>
          )}

          {/* 4 · every model */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Model targets">
            <div className="flex flex-wrap items-end gap-3 px-4 sm:px-5 py-3 border-b border-slate-100">
              <h3 className="mr-auto text-fs-16 font-bold text-slate-900">Every model <span className="ml-1 text-fs-13 font-semibold text-slate-500">{shown.length}</span></h3>
              {!fixedLine && (
                <div className="flex rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Line">
                  {[['all', 'All'], ...LINE_IDS.map((l) => [l, `Line ${l}`])].map(([k, l]) => <button key={k} type="button" aria-pressed={lineSel === k} onClick={() => setLineSel(k)} className={`h-9 px-3 text-fs-14 font-semibold border-r last:border-r-0 border-slate-300 ${lineSel === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{l}</button>)}
                </div>
              )}
              <div className="relative"><Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model or customer" aria-label="Search model" className={`${inp} pl-8 w-56 font-medium`} /></div>
            </div>
            <div className="overflow-auto max-h-[620px]">
              <table className="w-full text-fs-14 tabular-nums" aria-label="Every model">
                <thead className="sticky top-0 z-10 bg-white"><tr className="border-b-2 border-slate-300 text-left text-fs-13 text-slate-600">
                  {['Line', 'Model · customer', 'Valid gaps', 'A: most common (s)', 'Line method', 'Target (s)', 'Target pcs/hr', 'In force (s)', 'Target source', ...(canEdit ? ['Lock a target'] : [])].map((h) => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const k = `${r.line}-${r.mmId}`;
                    const [sl, sc] = SRC[r.src];
                    return (
                      <tr key={k} onClick={() => setSel(sel === k ? null : k)} className={`cursor-pointer border-b border-slate-100 hover:bg-blue-50/60 ${sel === k ? 'bg-blue-50' : ''}`}>
                        <td className="px-2.5 py-2 font-semibold">L{r.line}</td>
                        <td className="px-2.5 py-1.5"><div className="font-semibold text-slate-900 whitespace-nowrap">{r.model}</div><div className="text-fs-12 text-slate-500">{coKey(r.company)}</div></td>
                        <td className="px-2.5">{r.A ? nf(r.A.kept) : <span className="text-slate-500">&lt; {rule.min}</span>}</td>
                        <td className="px-2.5 whitespace-nowrap">{r.A ? <><b>{r.A.sec} s</b> <span className="text-fs-12 text-slate-500">{d1(r.A.share)}% ≤ A</span></> : <span className="text-slate-500 italic">too few</span>}</td>
                        <td className="px-2.5 whitespace-nowrap text-fs-13">{r.expect != null ? <><b>{r.cfg.method}</b> {r[r.cfg.method].sec} s + {r.cfg.add} s</> : '—'}</td>
                        <td className="px-2.5"><span className="rounded bg-blue-100 px-1.5 py-0.5 font-extrabold text-blue-950">{r.expect != null ? `${r.expect} s` : '—'}</span></td>
                        <td className="px-2.5">{nf(r.expect ? 3600 / r.expect : null)}</td>
                        <td className="px-2.5 font-bold">{r.inForce != null ? `${r.inForce} s` : '—'}</td>
                        <td className="px-2.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-fs-12 font-bold ${sc}`}>{sl}</span></td>
                        {canEdit && (
                          <td className="px-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <input type="number" min="1" max="3600" step="0.5" aria-label={`Locked target for ${r.model} line ${r.line}`} placeholder={r.inForce ?? ''} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} className={`${inp} h-8 w-20`} />
                            <button type="button" onClick={() => lock(r, edit[k] ?? r.inForce)} className="ml-1.5 inline-flex h-8 items-center gap-1 rounded-lg border border-blue-500 bg-white px-2 text-fs-13 font-bold text-blue-800 hover:bg-blue-50"><Lock size={13} aria-hidden /> Lock</button>
                            {r.src === 'manual' && <button type="button" onClick={() => unlock(r)} className="ml-1 inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold text-slate-700 hover:bg-slate-50"><Unlock size={13} aria-hidden /> Auto</button>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!shown.length && <tr><td colSpan={canEdit ? 10 : 9} className="py-10 text-center text-slate-600">No model{needle ? ' with this search' : ''}.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* 5 · one model, step by step */}
          {selRow && (
            <section className="rounded-2xl border-2 border-blue-200 bg-white shadow-sm p-4 sm:p-5" aria-label="Model calculation">
              <h3 className="text-fs-16 font-bold text-slate-900">{selRow.model} · Line {selRow.line} — calculation</h3>
              <ol className="mt-2 space-y-1 text-fs-14 text-slate-800 list-decimal pl-5">
                <li>{nf(selRow.qty)} pieces since {dmy(rule.from)}; <b>{nf(selGaps.length)}</b> gaps between {rule.low} and {rule.cap} s are kept — eliminated: <b>{nf(selRow.belowLow)}</b> below {rule.low} s, <b>{nf(selRow.aboveCap)}</b> above {rule.cap} s.</li>
                {selRow.A ? (
                  <>
                    <li>Most pieces were made in the <b>{selRow.A.sec} s</b> bar → Method A = {selRow.A.sec} s ({d1(selRow.A.share)}% of the kept gaps were {selRow.A.sec} s or faster).</li>
                    <li>Line {selRow.line} uses <b>Method {selRow.cfg.method}</b>{selRow.cfg.method === 'B' ? ` (${selRow.cfg.pct}% rule)` : ''}: {selRow[selRow.cfg.method]?.sec ?? '—'} s + {selRow.cfg.add} s allowance = <b>{selRow.expect ?? '—'} s</b> → target = 3600 ÷ {selRow.expect ?? '—'} = <b>{nf(selRow.expect ? 3600 / selRow.expect : null)} pcs/hr</b>. (A {selRow.A.sec} s · B {selRow.B?.sec ?? '—'} s · C {selRow.C?.sec ?? '—'} s)</li>
                  </>
                ) : <li>Fewer than {rule.min} valid gaps: no automatic target — the saved target is used{selRow.saved != null ? ` (${selRow.saved} s)` : ' (none saved)'}.</li>}
                <li>In force on every screen: <b>{selRow.inForce != null ? `${selRow.inForce} s` : 'no target'}</b> ({SRC[selRow.src][0]}).</li>
              </ol>
              <div className="mt-3"><Histogram gaps={selGaps} cap={rule.cap} a={selRow.A?.sec} /></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
