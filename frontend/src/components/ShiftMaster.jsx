import React, { useEffect, useState } from 'react';
import { Save, Clock, Plus, X, Coffee } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { settingsChanged } from '../hooks/useLineSettings';
import { MAX_BREAKS } from '../utils/shift';

/**
 * Admin (Setup → Masters): shift, lunch and tea breaks of every line on one screen (backend line_settings.php action 'shift').
 * Lunch and breaks are no working time: no target, and not in the OLE planned time (they never lower Availability).
 * "Same for every line" saves the first row for all lines at once.
 */
const inp = 'h-9 w-28 rounded-md border border-slate-300 bg-white px-2 text-fs-14 font-semibold text-slate-900';
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function problem(s) {
  const st = toMin(s.start), en = toMin(s.end), ls = toMin(s.lunchStart), le = toMin(s.lunchEnd);
  if (st == null || en == null) return 'Give the shift start and end';
  if (en <= st) return 'Shift end must be after the start';
  if ((ls == null) !== (le == null)) return 'Give both lunch times, or neither';
  if (ls != null && (le <= ls || ls <= st || le >= en)) return 'Lunch must be inside the shift';
  const bs = (s.breaks || []).map((b, i) => ({ i, name: b.name, a: toMin(b.start), z: toMin(b.end) }));
  for (const b of bs) {
    if (b.a == null || b.z == null) return `Break ${b.i + 1}: give its start and end`;
    if (b.z <= b.a) return `Break ${b.i + 1}: end must be after the start`;
    if (b.a < st || b.z > en) return `Break ${b.i + 1}: must be inside the shift`;
    if (ls != null && b.a < le && b.z > ls) return `Break ${b.i + 1}: overlaps lunch`;
  }
  const o = [...bs].sort((p, q) => p.a - q.a);
  for (let i = 1; i < o.length; i++) if (o[i].a < o[i - 1].z) return `Break ${o[i].i + 1} overlaps break ${o[i - 1].i + 1}`;
  return '';
}
const offMin = (s) => {
  const d = (a, z) => (toMin(a) != null && toMin(z) != null && toMin(z) > toMin(a) ? toMin(z) - toMin(a) : 0);
  return d(s.lunchStart, s.lunchEnd) + (s.breaks || []).reduce((t, b) => t + d(b.start, b.end), 0);
};
const fromServer = (sh) => ({ start: sh?.start || '09:00', end: sh?.end || '21:00', lunchStart: sh?.lunchStart || '', lunchEnd: sh?.lunchEnd || '',
  breaks: (Array.isArray(sh?.breaks) ? sh.breaks : []).map((b) => ({ name: b.name || 'Tea break', start: b.start || '', end: b.end || '' })) });

export default function ShiftMaster() {
  const [rows, setRows] = useState(null);
  const [orig, setOrig] = useState(null);
  const [same, setSame] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const out = {};
    for (const l of LINE_IDS) {
      try { const s = await api.lineSettings(l); out[l] = fromServer(s?.shift); }
      catch { out[l] = fromServer({ lunchStart: '13:00', lunchEnd: '13:30' }); }
    }
    setRows(out); setOrig(out);
  };
  useEffect(() => { load(); }, []);
  if (!rows) return <div className="py-6 text-center text-fs-14 text-slate-500">Reading the shift of every line …</div>;
  const set = (l, k, v) => setRows((r) => ({ ...r, [l]: { ...r[l], [k]: v } }));
  const setBreak = (l, i, k, v) => setRows((r) => ({ ...r, [l]: { ...r[l], breaks: r[l].breaks.map((b, j) => (j === i ? { ...b, [k]: v } : b)) } }));
  const addBreak = (l) => setRows((r) => ({ ...r, [l]: { ...r[l], breaks: [...r[l].breaks, { name: r[l].breaks.length ? 'Tea break 2' : 'Tea break', start: '', end: '' }] } }));
  const delBreak = (l, i) => setRows((r) => ({ ...r, [l]: { ...r[l], breaks: r[l].breaks.filter((_, j) => j !== i) } }));
  const list = same ? [LINE_IDS[0]] : LINE_IDS;
  const probs = Object.fromEntries(list.map((l) => [l, problem(rows[l])]));
  const changed = same || JSON.stringify(rows) !== JSON.stringify(orig);
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const body = (l) => ({ start: rows[l].start, end: rows[l].end, lunchStart: rows[l].lunchStart || null, lunchEnd: rows[l].lunchEnd || null,
        breaks: rows[l].breaks.map((b) => ({ name: (b.name || '').trim() || 'Break', start: b.start, end: b.end })) });
      if (same) await api.saveLineSettings(LINE_IDS[0], { action: 'shift', shift: body(LINE_IDS[0]), allLines: true });
      else for (const l of LINE_IDS) if (JSON.stringify(rows[l]) !== JSON.stringify(orig[l])) await api.saveLineSettings(l, { action: 'shift', shift: body(l) });
      settingsChanged(); await load(); setSame(false); setMsg('Saved — every screen uses the new shift and breaks.');
    } catch (e) { setMsg(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3" aria-label="Shift and lunch of the lines">
      <label className="inline-flex items-center gap-2 text-fs-14 font-semibold text-slate-700"><input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />Same shift, lunch and breaks for every line</label>
      <div className="flex flex-col gap-3">
        {list.map((l) => {
          const who = same ? 'Every line' : `Line ${l}`;
          const r = rows[l];
          const span = toMin(r.end) - toMin(r.start);
          const work = Number.isFinite(span) && span > 0 ? span - offMin(r) : null;
          return (
            <section key={l} className="rounded-xl border border-slate-200 bg-white p-3" aria-label={`${who} shift`}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[90px] pb-2 text-fs-15 font-extrabold text-slate-900"><Clock size={14} className="mr-1 inline text-slate-400" />{who}</div>
                {[['start', 'Shift start'], ['end', 'Shift end'], ['lunchStart', 'Lunch start'], ['lunchEnd', 'Lunch end']].map(([k, t]) => (
                  <label key={k} className="flex flex-col text-fs-12 font-bold text-slate-500">{t}
                    <input type="time" className={inp} value={r[k] || ''} onChange={(e) => set(l, k, e.target.value)} aria-label={`${who} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`} />
                  </label>
                ))}
                {work != null && <div className="pb-2 text-fs-13 font-semibold text-slate-600">Working time <b className="text-slate-900">{Math.floor(work / 60)} h {String(work % 60).padStart(2, '0')} m</b></div>}
              </div>
              <div className="mt-2 flex flex-col gap-1.5" aria-label={`${who} breaks`}>
                {r.breaks.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Coffee size={14} className="text-amber-600" aria-hidden />
                    <input className={`${inp} w-36`} value={b.name} maxLength={30} onChange={(e) => setBreak(l, i, 'name', e.target.value)} aria-label={`${who} break ${i + 1} name`} />
                    <input type="time" className={inp} value={b.start} onChange={(e) => setBreak(l, i, 'start', e.target.value)} aria-label={`${who} break ${i + 1} start`} />
                    <span className="text-slate-400">–</span>
                    <input type="time" className={inp} value={b.end} onChange={(e) => setBreak(l, i, 'end', e.target.value)} aria-label={`${who} break ${i + 1} end`} />
                    <button type="button" onClick={() => delBreak(l, i)} className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${who} break ${i + 1}`}><X size={15} /></button>
                  </div>
                ))}
                {r.breaks.length < MAX_BREAKS && (
                  <button type="button" onClick={() => addBreak(l)} className="inline-flex w-fit items-center gap-1 rounded-md border border-dashed border-slate-400 px-2.5 py-1 text-fs-13 font-bold text-slate-700 hover:bg-slate-50"><Plus size={14} />Add tea / other break</button>
                )}
              </div>
              {probs[l] && <p className="mt-1.5 text-fs-13 font-semibold text-red-700" role="alert">{probs[l]}</p>}
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !changed || Object.values(probs).some(Boolean)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 text-fs-14 font-bold text-white disabled:opacity-50"><Save size={15} />Save shift</button>
        {msg && <span role="status" className={`text-fs-13 font-bold ${msg.startsWith('Not') ? 'text-red-700' : 'text-emerald-700'}`}>{msg}</span>}
        <span className="text-fs-12 text-slate-500">Used for the hour targets, OLE time and the live screens. Lunch and breaks are not working time: no target, and they do not lower Availability. Empty lunch = no lunch break.</span>
      </div>
    </div>
  );
}
