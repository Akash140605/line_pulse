import React, { useMemo, useState } from 'react';
import { CalendarClock, Plus, Pencil, Trash2, Save, X, CheckCircle2 } from 'lucide-react';
import { LINE_IDS } from '../api';
import { getAuth } from '../auth';
import useUiSettings from '../hooks/useUiSettings';
import useAutoTargets, { loadAutoTargets } from '../hooks/useAutoTargets';
import { normalizeRule, PLAN_MAX } from '../utils/uiSettings';
import { linePeriods } from '../utils/targetMethods';
import { serverToday, serverNow } from '../utils/serverTime';

/**
 * 20-11-2026: Target method by date (admin). A line's method can change from a date: from that day on its targets come
 * from the new method; the days before keep the method they had, so their OLE, target, loss ₹, HPR and KPI do not
 * change. The days before the first change use the line's starting method. Kept in the target rule (ui_settings →
 * targetRule.plan, cleaned by backend/lib/ui.php ui_plan).
 */
const METHODS = {
  A: { name: 'Most common cycle', add: null, chip: 'bg-slate-700 text-white', soft: 'border-slate-400 bg-slate-50' },
  B: { name: '% of pieces within', add: 0, chip: 'bg-sky-700 text-white', soft: 'border-sky-400 bg-sky-50' },
  C: { name: 'Average cycle', add: 0, chip: 'bg-blue-700 text-white', soft: 'border-blue-400 bg-blue-50' },
  D: { name: 'Model master', add: 0, chip: 'bg-violet-700 text-white', soft: 'border-violet-400 bg-violet-50' },
};
const dmy = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '');
const p2 = (n) => String(n).padStart(2, '0');
const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5';
const inp = 'h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-14 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50';
const cfgText = (c) => `Method ${c.method}${c.method === 'B' ? ` ${c.pct}%` : ''} + ${c.add} s`;
const daysTo = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

export default function MethodPlanPage({ canEdit = false }) {
  const { ui, save: saveUi } = useUiSettings();
  const rule = ui.targetRule;
  const auto = useAutoTargets();
  const today = serverToday();
  const blank = { lines: [], method: 'D', from: today, add: '', pct: 70, note: '' };
  const [form, setForm] = useState(blank);
  const [edit, setEdit] = useState(null);       // the change being edited: `${line}|${from}`
  const [ask, setAsk] = useState(null);         // the change asked to be removed
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const plan = rule.plan || [];
  const P = useMemo(() => Object.fromEntries(LINE_IDS.map((l) => [l, linePeriods(rule, l)])), [rule]);
  const inForce = (p) => (!p.from || today >= p.from) && (!p.to || today <= p.to);
  // models with a target in each period (worked out on this PC; the period of today = the targets on every screen)
  const nModels = (l, i) => { const ps = auto?.periods?.[l]; const t = ps ? ps[i]?.targets : i === 0 ? auto?.byLine?.[l] : null; return t ? Object.keys(t).length : null; };

  const stamp = () => { const n = serverNow(); return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())} ${p2(n.getHours())}:${p2(n.getMinutes())}`; };
  const commit = async (nextPlan, nextLines, what) => {
    setBusy(true); setMsg('');
    try {
      await saveUi({ ...ui, targetRule: normalizeRule({ ...rule, lines: nextLines || rule.lines, plan: nextPlan }) });
      await loadAutoTargets(true);
      setMsg(`${what} Every screen now counts each day against the method in force that day.`);
      return true;
    } catch (e) { setMsg(`Could not save: ${e.message}`); return false; } finally { setBusy(false); }
  };
  const addOrSave = async () => {
    if (!form.lines.length) { setMsg('Could not save: choose the line(s).'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.from)) { setMsg('Could not save: choose the date from which the method is used.'); return; }
    const add = form.add === '' ? (form.method === 'A' ? rule.add : 0) : Number(form.add);
    let next = plan.filter((p) => !(edit && `${p.line}|${p.from}` === edit));
    next = next.filter((p) => !(form.lines.includes(p.line) && p.from === form.from));
    if (next.length + form.lines.length > PLAN_MAX) { setMsg(`Could not save: at most ${PLAN_MAX} dated changes — remove old ones first.`); return; }
    for (const l of form.lines) next.push({ line: l, from: form.from, method: form.method, add, pct: Number(form.pct) || 70, note: form.note, by: getAuth()?.user || '', at: stamp() });
    const ok = await commit(next, null, `Saved — ${form.lines.map((l) => `Line ${l}`).join(', ')}: ${cfgText({ method: form.method, add, pct: form.pct })} from ${dmy(form.from)}.`);
    if (ok) { setForm(blank); setEdit(null); }
  };
  const startEdit = (p) => { setEdit(`${p.line}|${p.from}`); setForm({ lines: [p.line], method: p.method, from: p.from, add: String(p.add), pct: p.pct, note: p.note || '' }); setMsg(''); window.scrollTo?.({ top: 0, behavior: 'smooth' }); };
  const remove = async (p) => { setAsk(null); await commit(plan.filter((x) => !(x.line === p.line && x.from === p.from)), null, `Removed — Line ${p.line}, ${cfgText(p)} from ${dmy(p.from)}. Those days use the method before it again.`); };
  const setStart = async (l, method) => {
    const c = { method, add: method === 'A' ? rule.add : 0, pct: rule.lines?.[l]?.pct || 70 };
    await commit(plan, { ...rule.lines, [l]: c }, `Saved — Line ${l} starts with ${cfgText(c)} (the days before its first dated change).`);
  };
  const toggleLine = (l) => setForm((f) => ({ ...f, lines: f.lines.includes(l) ? f.lines.filter((x) => x !== l) : [...f.lines, l].sort() }));
  const future = form.from > today;
  const past = form.from < today;

  return (
    <div className="flex flex-col gap-4">
      <section className={card} aria-label="Target method by date">
        <div className="flex flex-wrap items-start gap-3">
          <CalendarClock size={26} className="mt-0.5 shrink-0 text-blue-800" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-fs-20 font-extrabold text-slate-900">Target method by date</h2>
            <p className="mt-0.5 text-fs-14 leading-snug text-slate-700">
              Change a line's target method <b>from a date</b>. From that day on, its targets come from the new method; the days before
              keep the method they had, so their target, achievement, OLE, loss ₹, HPR and KPI do not change.
              Methods: <b>A</b> most common cycle + allowance · <b>B</b> % of pieces within · <b>C</b> average cycle · <b>D</b> Model master.
            </p>
          </div>
        </div>

        {/* every line: its methods one after the other */}
        <div className="mt-4 grid gap-2" role="list" aria-label="Method of every line by date">
          {LINE_IDS.map((l) => (
            <div key={l} role="listitem" aria-label={`Line ${l} methods`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
              <b className="w-16 shrink-0 text-fs-16 text-slate-900">Line {l}</b>
              {P[l].map((p, i) => {
                const now = inForce(p); const soon = p.from && p.from > today; const n = nModels(l, i);
                return (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-slate-400" aria-hidden>→</span>}
                    <span className={`inline-flex flex-col rounded-lg border-2 px-2.5 py-1 leading-tight ${now ? METHODS[p.method].soft : 'border-slate-200 bg-white'}`}
                      title={p.note || undefined}>
                      <span className="flex items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-fs-12 font-extrabold ${METHODS[p.method].chip}`}>{p.method}{p.method === 'B' ? ` ${p.pct}%` : ''}</span>
                        <span className="text-fs-13 font-bold text-slate-900">+ {p.add} s</span>
                        {now && <span className="inline-flex items-center gap-0.5 text-fs-12 font-bold text-emerald-700"><CheckCircle2 size={12} aria-hidden /> today</span>}
                        {soon && <span className="text-fs-12 font-bold text-amber-700">in {daysTo(today, p.from)} day{daysTo(today, p.from) === 1 ? '' : 's'}</span>}
                      </span>
                      <span className="text-fs-12 text-slate-600">{p.from ? dmy(p.from) : 'start'} → {p.to ? dmy(p.to) : 'on'}{n != null ? ` · ${n} models` : ''}</span>
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {canEdit && (
        <section className={card} aria-label={edit ? 'Change the dated method' : 'Add a method change'}>
          <h3 className="text-fs-18 font-extrabold text-slate-900">{edit ? 'Change the dated method' : 'Use a method from a date'}</h3>
          <div className="mt-3 grid gap-4 lg:grid-cols-[auto_1fr]">
            <div>
              <div className="mb-1 text-fs-13 font-bold text-slate-700">Line(s)</div>
              <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Lines of the change">
                {LINE_IDS.map((l) => <button key={l} type="button" aria-pressed={form.lines.includes(l)} disabled={!!edit} onClick={() => toggleLine(l)}
                  className={`h-10 border-r border-slate-300 px-3.5 text-fs-14 font-bold last:border-r-0 ${form.lines.includes(l) ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Line {l}</button>)}
              </div>
              {!edit && <button type="button" onClick={() => setForm((f) => ({ ...f, lines: f.lines.length === LINE_IDS.length ? [] : [...LINE_IDS] }))} className="mt-1 text-fs-12 font-bold text-blue-800 hover:underline">{form.lines.length === LINE_IDS.length ? 'None' : 'All lines'}</button>}
            </div>
            <div>
              <div className="mb-1 text-fs-13 font-bold text-slate-700">Method</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Method of the change">
                {Object.entries(METHODS).map(([k, m]) => (
                  <button key={k} type="button" role="radio" aria-checked={form.method === k} onClick={() => setForm((f) => ({ ...f, method: k, add: '' }))}
                    className={`rounded-xl border-2 px-2.5 py-1.5 text-left ${form.method === k ? m.soft : 'border-slate-200 bg-white hover:border-slate-400'}`}>
                    <div className="text-fs-15 font-extrabold text-slate-900">Method {k}</div>
                    <div className="text-fs-12 font-semibold leading-tight text-slate-600">{m.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-fs-13 font-bold text-slate-700">From date
              <input type="date" aria-label="From date of the change" value={form.from} onChange={(e) => e.target.value && setForm((f) => ({ ...f, from: e.target.value }))} className={`${inp} mt-1 block`} />
            </label>
            <label className="text-fs-13 font-bold text-slate-700">Allowance (s)
              <input type="number" min="0" max="30" step="0.5" aria-label="Allowance seconds of the change" placeholder={String(form.method === 'A' ? rule.add : 0)} value={form.add} onChange={(e) => setForm((f) => ({ ...f, add: e.target.value }))} className={`${inp} mt-1 block w-24`} />
            </label>
            {form.method === 'B' && (
              <label className="text-fs-13 font-bold text-slate-700">B: % of pieces
                <input type="number" min="50" max="95" step="5" aria-label="B percent of the change" value={form.pct} onChange={(e) => setForm((f) => ({ ...f, pct: e.target.value }))} className={`${inp} mt-1 block w-24`} />
              </label>
            )}
            <label className="min-w-[14rem] flex-1 text-fs-13 font-bold text-slate-700">Note (why)
              <input type="text" maxLength={80} aria-label="Note of the change" value={form.note} placeholder="e.g. master cycle times checked by IE" onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={`${inp} mt-1 block w-full`} />
            </label>
          </div>
          <p className={`mt-2 rounded-lg px-3 py-2 text-fs-13 font-semibold ${past ? 'bg-amber-50 text-amber-900' : 'bg-blue-50 text-blue-900'}`}>
            {form.lines.length ? `${form.lines.map((l) => `Line ${l}`).join(', ')}: ` : ''}
            {cfgText({ method: form.method, add: form.add === '' ? (form.method === 'A' ? rule.add : 0) : form.add, pct: form.pct })} from <b>{dmy(form.from)}</b>
            {future ? ' — starts on that day; until then the method in force now stays.' : past ? ' — a date in the past: the days from then on are counted again with this method (their target, OLE, loss ₹ change).' : ' — from today.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !form.lines.length} onClick={addOrSave} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
              {edit ? <Save size={16} aria-hidden /> : <Plus size={16} aria-hidden />} {busy ? 'Saving…' : edit ? 'Save the change' : 'Add the change'}
            </button>
            {edit && <button type="button" onClick={() => { setEdit(null); setForm(blank); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-semibold text-slate-700"><X size={15} aria-hidden /> Cancel</button>}
          </div>
        </section>
      )}

      {msg && <div role="status" className={`rounded-xl border px-4 py-2.5 text-fs-14 font-semibold ${msg.startsWith('Not') ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>{msg}</div>}

      <section className={card} aria-label="Dated method changes">
        <h3 className="text-fs-18 font-extrabold text-slate-900">All changes <span className="text-fs-14 font-semibold text-slate-500">({plan.length} of {PLAN_MAX})</span></h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-fs-14 tabular-nums" aria-label="Method changes">
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-13 text-slate-600">
              {['Line', 'From', 'Until', 'Method', 'Note', 'Saved by', ''].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {LINE_IDS.map((l) => (
                <React.Fragment key={l}>
                  <tr className="border-b border-slate-100 bg-slate-50/70" aria-label={`Line ${l} starting method`}>
                    <td className="px-2 py-1.5 font-bold">Line {l}</td>
                    <td className="px-2 text-slate-500">start</td>
                    <td className="px-2 whitespace-nowrap">{P[l][0].to ? dmy(P[l][0].to) : 'on'}</td>
                    <td className="px-2">
                      {canEdit ? (
                        <select aria-label={`Starting method line ${l}`} value={P[l][0].method} disabled={busy} onChange={(e) => setStart(l, e.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-1.5 text-fs-13 font-bold">
                          {Object.keys(METHODS).map((k) => <option key={k} value={k}>Method {k}</option>)}
                        </select>
                      ) : <b>{cfgText(P[l][0])}</b>}
                      {canEdit && <span className="ml-1.5 text-fs-12 text-slate-500">+ {P[l][0].add} s</span>}
                    </td>
                    <td className="px-2 text-fs-13 text-slate-500" colSpan={3}>Starting method (the days before the first change)</td>
                  </tr>
                  {plan.filter((p) => p.line === l).map((p) => {
                    const per = P[l].find((x) => x.from === p.from);
                    const k = `${p.line}|${p.from}`;
                    return (
                      <tr key={k} className={`border-b border-slate-100 ${edit === k ? 'bg-blue-50' : ''}`} aria-label={`Line ${p.line} from ${dmy(p.from)}`}>
                        <td className="px-2 py-1.5">Line {p.line}</td>
                        <td className="px-2 whitespace-nowrap font-bold">{dmy(p.from)}{p.from > today && <span className="ml-1 text-fs-12 font-bold text-amber-700">(coming)</span>}</td>
                        <td className="px-2 whitespace-nowrap">{per?.to ? dmy(per.to) : 'on'}</td>
                        <td className="px-2 whitespace-nowrap"><span className={`mr-1 rounded px-1.5 py-0.5 text-fs-12 font-extrabold ${METHODS[p.method].chip}`}>{p.method}</span>{p.method === 'B' ? `${p.pct}% ` : ''}+ {p.add} s</td>
                        <td className="px-2 text-fs-13 text-slate-700">{p.note || '—'}</td>
                        <td className="px-2 whitespace-nowrap text-fs-13 text-slate-600">{p.by || '—'}{p.at ? ` · ${dmy(p.at.slice(0, 10))} ${p.at.slice(11)}` : ''}</td>
                        <td className="px-2 whitespace-nowrap text-right">
                          {canEdit && (ask === k ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-fs-13 font-semibold text-red-800">Remove?</span>
                              <button type="button" disabled={busy} onClick={() => remove(p)} className="h-8 rounded-md bg-red-700 px-2.5 text-fs-13 font-bold text-white">Yes</button>
                              <button type="button" onClick={() => setAsk(null)} className="h-8 rounded-md border border-slate-300 px-2.5 text-fs-13 font-bold">No</button>
                            </span>
                          ) : (
                            <span className="inline-flex gap-1">
                              <button type="button" onClick={() => startEdit(p)} aria-label={`Edit Line ${p.line} from ${dmy(p.from)}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-fs-13 font-bold text-slate-800 hover:border-blue-500"><Pencil size={13} aria-hidden /> Edit</button>
                              <button type="button" onClick={() => setAsk(k)} aria-label={`Remove Line ${p.line} from ${dmy(p.from)}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 bg-white px-2 text-fs-13 font-bold text-red-700 hover:bg-red-50"><Trash2 size={13} aria-hidden /> Remove</button>
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-fs-13 text-slate-500">A target locked for a model (Target rule &amp; check page) still wins on every day. The data window of methods A, B and C stays the one of the target rule ({dmy(rule.from)} → {rule.to ? dmy(rule.to) : 'today'}).</p>
      </section>
    </div>
  );
}
