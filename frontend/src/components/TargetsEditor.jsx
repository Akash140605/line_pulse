import React, { useMemo, useState } from 'react';
import MesDrawer from './MesDrawer';
import { X, Search, Target, Clock, Utensils } from 'lucide-react';
import { cycleOfPph, pphOf, targetOf } from '../utils/targets';
import { fmtMin, segments, shiftText, toMin } from '../utils/shift';

const inp = 'h-9 w-full rounded-lg border border-slate-400 bg-white px-2 text-fs-16 font-bold font-mono text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200';
const r1 = (v) => (v == null ? '' : String(Math.round(v * 10) / 10));

function ShiftForm({ shift, onSave, saving }) {
  const [s, setS] = useState({ ...shift });
  const [all, setAll] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value || null });
  // same rules as the server (lib/store.php)
  const st = toMin(s.start), en = toMin(s.end), ls = toMin(s.lunchStart), le = toMin(s.lunchEnd);
  const problem = st == null || en == null ? 'Enter shift start and end.'
    : en <= st ? 'Shift end must be after shift start.'
      : (ls == null) !== (le == null) ? 'Enter both lunch start and lunch end (or clear both).'
        : ls != null && le <= ls ? 'Lunch end must be after lunch start.'
          : ls != null && (ls <= st || le >= en) ? 'Lunch must lie inside the shift.' : '';
  const parts = problem ? [] : segments(s);
  const save = async () => {
    setMsg('');
    try { await onSave(s, all); setMsg('Saved — every screen of this line uses the new shift within a minute.'); }
    catch (e) { setMsg(`Could not save: ${e.message}`); }
  };
  return (
    <div className="space-y-4 text-fs-14 font-bold text-slate-800">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label>Shift start<input type="time" className={inp} value={s.start || ''} onChange={set('start')} /></label>
        <label>Lunch start<input type="time" className={inp} value={s.lunchStart || ''} onChange={set('lunchStart')} /></label>
        <label>Lunch end<input type="time" className={inp} value={s.lunchEnd || ''} onChange={set('lunchEnd')} /></label>
        <label>Shift end<input type="time" className={inp} value={s.end || ''} onChange={set('end')} /></label>
      </div>
      {problem ? <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">{problem}</div> : (
        <div>
          <div className="text-fs-13 uppercase tracking-wide text-slate-700 mb-1">The day in two segments</div>
          <div className="flex rounded-xl overflow-hidden border-2 border-slate-300 text-fs-13">
            {parts.map((p) => (
              <div key={p.key} className={`px-2 py-2 text-center ${p.work ? 'bg-blue-50 text-blue-950' : 'bg-slate-200 text-slate-900'}`} style={{ flex: Math.max(1, p.to - p.from) }}>
                <div className="font-extrabold flex items-center justify-center gap-1">{!p.work && <Utensils size={12} aria-hidden />}{p.label}</div>
                <div className="font-mono">{fmtMin(p.from)}–{fmtMin(p.to)}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 font-semibold text-slate-700">{shiftText(s)}. Targets and loss leave the lunch window out.</div>
        </div>
      )}
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="h-4 w-4" checked={all} onChange={(e) => setAll(e.target.checked)} /> Use this shift for all lines</label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!!problem || saving} className="rounded-lg bg-blue-700 px-4 py-2 text-fs-14 font-extrabold text-white hover:bg-blue-800 disabled:opacity-40">{saving ? 'Saving…' : 'Save shift'}</button>
        <button type="button" onClick={() => setS({ ...s, start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' })} className="rounded-lg border border-slate-400 px-3 py-2 text-fs-14 font-bold hover:bg-slate-50">09:00–21:00, lunch 13:00–13:30</button>
        {msg && <span role="status" className={msg.startsWith('Not') ? 'text-red-700' : 'text-sky-700'}>{msg}</span>}
      </div>
    </div>
  );
}

function TargetsForm({ models, avgCycle, todayIds, targets, focus, onSave, saving }) {
  const [q, setQ] = useState(focus?.model || '');
  const [only, setOnly] = useState(focus ? 'all' : (todayIds.size ? 'today' : 'all'));
  const [edit, setEdit] = useState({});   // mmId → cycle text
  const [pphText, setPphText] = useState({});   // mmId → pieces/hr exactly as typed (no jumping while typing)
  const [msg, setMsg] = useState('');
  const cur = (id) => (edit[id] !== undefined ? edit[id] : r1(targetOf(targets, id)));
  const rows = useMemo(() => models
    .filter((m) => only === 'all' || (only === 'today' ? todayIds.has(String(m.mmId)) : !targetOf(targets, m.mmId)))
    .filter((m) => !q || `${m.model} ${m.modelCode || ''} ${m.companyTitle || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (todayIds.has(String(b.mmId)) - todayIds.has(String(a.mmId))) || String(a.companyTitle || '').localeCompare(String(b.companyTitle || '')) || a.model.localeCompare(b.model)),
  [models, only, q, todayIds, targets]);
  const same = (a, b) => (a === '' || a == null ? '' : String(Number(a))) === (b === '' || b == null ? '' : String(Number(b)));
  const changed = Object.keys(edit).filter((id) => !same(targetOf(targets, id), edit[id]));
  const bad = changed.filter((id) => edit[id] !== '' && !(Number(edit[id]) >= 1 && Number(edit[id]) <= 3600));
  const save = async () => {
    setMsg('');
    try {
      const items = changed.map((id) => { const m = models.find((x) => String(x.mmId) === String(id)); return { mmId: Number(id), cycle: edit[id] === '' ? null : Number(edit[id]), model: m?.model || '', company: m?.companyTitle || '' }; });
      await onSave(items); setEdit({}); setPphText({}); setMsg(`Saved ${items.length} target${items.length === 1 ? '' : 's'}.`);
    } catch (e) { setMsg(`Could not save: ${e.message}`); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-400 px-2 flex-1 min-w-[12rem]">
          <Search size={15} className="text-slate-600" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model / company" className="w-full py-2 text-fs-14 font-semibold outline-none" aria-label="Search model" />
        </div>
        <div className="inline-flex rounded-lg border border-slate-400 overflow-hidden text-fs-13 font-bold" role="group" aria-label="Which models">
          {[['today', `Run today (${todayIds.size})`], ['missing', 'Without target'], ['all', `All (${models.length})`]].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={only === k} onClick={() => setOnly(k)} className={`px-2.5 py-1.5 ${only === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-800 hover:bg-slate-100'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="text-fs-13 font-semibold text-slate-700">Enter the target as <b>pieces per hour</b> or as <b>cycle seconds per piece</b> — the other is filled in. Empty = no target. "Use" takes the model's average cycle of the selected period.</div>
      <div className="border border-slate-300 rounded-lg max-h-[46dvh] overflow-auto">
        <table className="w-full text-fs-13">
          <thead className="sticky top-0 bg-slate-100 z-10"><tr className="text-left text-slate-800 uppercase tracking-wide border-b-2 border-slate-300">
            {['Company', 'Model', 'Avg cycle (period)', 'Target pcs / hr', 'Target cycle (s)', ''].map((h) => <th key={h} className="px-2 py-2 font-extrabold whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((m) => {
              const id = String(m.mmId); const c = cur(id); const avg = avgCycle[id];
              const isFocus = focus && String(focus.mmId) === id;
              const dirty = edit[id] !== undefined && !same(targetOf(targets, id), edit[id]);
              return (
                <tr key={id} className={`border-b border-slate-200 ${isFocus ? 'bg-slate-50' : dirty ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-1 font-bold text-slate-900 whitespace-nowrap">{m.companyTitle || '—'}</td>
                  <td className="px-2 py-1 font-mono font-extrabold text-slate-950 whitespace-nowrap">{m.model}{m.modelCode ? <span className="font-normal text-slate-700"> ({m.modelCode})</span> : null}{todayIds.has(id) && <span className="ml-1 rounded bg-sky-100 px-1 text-fs-11 font-sans font-extrabold text-sky-800">today</span>}</td>
                  <td className="px-2 py-1 font-mono text-slate-900">{avg ? `${avg.toFixed(1)} s · ${Math.round(3600 / avg)}/hr` : '—'}</td>
                  <td className="px-2 py-1 w-32"><input type="number" min={1} step={1} className={inp} aria-label={`Target pieces per hour for ${m.model}${m.modelCode ? ` (${m.modelCode})` : ''}`}
                    value={pphText[id] !== undefined ? pphText[id] : c === '' ? '' : String(Math.round(pphOf(Number(c)) * 10) / 10)}
                    onChange={(e) => { const v = e.target.value; setPphText({ ...pphText, [id]: v }); setEdit({ ...edit, [id]: v === '' || !(Number(v) > 0) ? '' : String(cycleOfPph(Number(v))) }); }} /></td>
                  <td className="px-2 py-1 w-32"><input type="number" min={1} step={0.1} className={inp} aria-label={`Target cycle seconds for ${m.model}${m.modelCode ? ` (${m.modelCode})` : ''}`}
                    value={c} onChange={(e) => { setPphText({ ...pphText, [id]: undefined }); setEdit({ ...edit, [id]: e.target.value }); }} /></td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {avg && <button type="button" onClick={() => { setPphText({ ...pphText, [id]: undefined }); setEdit({ ...edit, [id]: r1(avg) }); }} className="rounded-md border border-blue-600 px-2 py-0.5 text-fs-12 font-extrabold text-blue-800 hover:bg-blue-50">Use {avg.toFixed(1)} s</button>}
                    {c !== '' && <button type="button" onClick={() => { setPphText({ ...pphText, [id]: undefined }); setEdit({ ...edit, [id]: '' }); }} className="ml-1 rounded-md border border-slate-400 px-2 py-0.5 text-fs-12 font-bold text-slate-800 hover:bg-slate-50">Clear</button>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-fs-14 font-semibold text-slate-700">No models match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={!changed.length || bad.length > 0 || saving} className="rounded-lg bg-blue-700 px-4 py-2 text-fs-14 font-extrabold text-white hover:bg-blue-800 disabled:opacity-40">
          {saving ? 'Saving…' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`}
        </button>
        {changed.length > 0 && <button type="button" onClick={() => { setEdit({}); setPphText({}); }} className="rounded-lg border border-slate-400 px-3 py-2 text-fs-14 font-bold hover:bg-slate-50">Undo changes</button>}
        {bad.length > 0 && <span className="text-fs-13 font-bold text-red-700">Cycle must be 1–3600 s.</span>}
        {msg && <span role="status" className={`text-fs-13 font-bold ${msg.startsWith('Not') ? 'text-red-700' : 'text-sky-700'}`}>{msg}</span>}
      </div>
    </div>
  );
}

/**
 * Model targets and shift / lunch window of a line. Saved on the server (every screen sees them).
 * models = line models [{mmId, model, modelCode, companyTitle}], avgCycle = {mmId: s} of the selected period,
 * todayIds = Set of mmIds that ran on the focus day, focus = model to show first.
 */
export default function TargetsEditor({ line, tab: tab0 = 'targets', models, avgCycle, todayIds, focus, settings, onClose }) {
  const [tab, setTab] = useState(tab0);
  return (
    <MesDrawer title={`Line ${line} — targets & shift`} icon={Target} onClose={onClose} label="Targets and shift" width={62}>
        <div className="flex gap-1 px-4 pt-2 border-b-2 border-slate-200" role="tablist">
          {[['targets', 'Model targets', Target], ['shift', 'Shift & lunch', Clock]].map(([k, l, I]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 -mb-[2px] border-b-2 text-fs-14 font-extrabold ${tab === k ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-700 hover:text-slate-950'}`}><I size={14} aria-hidden /> {l}</button>
          ))}
        </div>
        <div className="p-4">
          {settings.error && <div className="mb-2 rounded-lg border border-slate-400 bg-slate-50 px-3 py-2 text-fs-13 font-bold text-slate-900">The server could not be reached ({settings.error}). Showing the last known values; saving needs the server.</div>}
          {tab === 'targets'
            ? <TargetsForm models={models} avgCycle={avgCycle} todayIds={todayIds} targets={settings.targets} focus={focus} onSave={settings.saveTargets} saving={settings.saving} />
            : <ShiftForm shift={settings.shift} onSave={settings.saveShift} saving={settings.saving} />}
        </div>
    </MesDrawer>
  );
}
