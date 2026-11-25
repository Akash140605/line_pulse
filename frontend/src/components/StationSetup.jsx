import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, Plus, Trash2, Save, Settings2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../api';
import { STATION_TYPES, normStation } from '../utils/ole';
import { KPI_STAGES, stageOf } from '../utils/kpiStages';
import { stageDefects } from '../utils/defectBook';
import { LINE_COLOR, inp, card, useOleLines, DEFAULT_QUALITY } from './OleParts';

/**
 * Admin: the quality stations of FPY / RTY, fully set up — order on the line, code (LQC, FQC …), name, kind, owner,
 * counted in RTY or not, rework allowed, switched on / off, the lines that have it, its own defects — and the FPY / RTY
 * targets. A renamed station keeps its old name as an alias, so the entries saved before still count for it.
 * Saved with the reason lists (api/ole.php action 'reasons'); the other lists are sent back unchanged.
 */
const KIND_SHORT = { inline: 'In-line', test: 'Test', final: 'Final', audit: 'Audit' };

/**
 * The six stages of the plant's SAWM KPI report (FTY & RTY sheet), in its order: a station of the list that is one of
 * them (by name / code, e.g. "Leak test" → Leakage Inspection) becomes that stage and keeps its old names, so its saved
 * entries still count there. Stations that are none of the six stay after them, out of RTY.
 */
const KPI_CODES = ['HVIR', 'LEAK', 'FUNC', 'FRONT', 'PREFINAL', 'FINAL'];
const KPI_TYPES = ['test', 'test', 'test', 'inline', 'inline', 'final'];
export function kpiStations(rows) {
  const by = KPI_STAGES.map(() => []), rest = [];
  for (const r of rows) { const k = stageOf(r.reason, r.code); if (k == null) rest.push(r); else by[k].push(r); }
  const six = KPI_STAGES.map((name, k) => {
    const old = by[k], first = old[0] || {};
    const aliases = [...new Set([...old.flatMap((r) => [r.reason, r.was, ...(r.aliases || [])]), ...old.map((r) => r.code)].filter((x) => x && x.toLowerCase() !== name.toLowerCase()))];
    return { ...normStation({ reason: name }), dept: first.dept || 'Quality', code: KPI_CODES[k], type: KPI_TYPES[k], rty: true, active: true, rework: true, lines: [],
      defects: [...new Set(old.flatMap((r) => r.defects || []))], aliases, was: first.was || '' };
  });
  return [...six, ...rest.map((r) => ({ ...r, rty: false }))];
}

export default function StationSetup({ reasons, onSaved, startOpen = false }) {
  const IDS = useOleLines();
  const [open, setOpen] = useState(startOpen);
  const fresh = () => (reasons.station || []).map((x) => ({ ...normStation(x), was: normStation(x).reason }));
  const [rows, setRows] = useState(fresh);
  const [q, setQ] = useState(() => ({ ...DEFAULT_QUALITY, ...(reasons.quality || {}) }));
  const [more, setMore] = useState(-1);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(fresh()); setQ({ ...DEFAULT_QUALITY, ...(reasons.quality || {}) }); }, [reasons]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i, k, v) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i, d) => setRows((x) => { const j = i + d; if (j < 0 || j >= x.length) return x; const y = [...x]; [y[i], y[j]] = [y[j], y[i]]; return y; });
  const defectList = useMemo(() => [...new Set([...(reasons.reject || []), ...(reasons.rework || [])].map((x) => x.reason))], [reasons]);
  const names = rows.map((r) => r.reason.trim().toLowerCase());
  const dup = names.some((n, i) => n && names.indexOf(n) !== i);
  const empty = rows.some((r) => !r.reason.trim());
  const changed = JSON.stringify(rows.map(({ was, ...r }) => r)) !== JSON.stringify(fresh().map(({ was, ...r }) => r)) || JSON.stringify(q) !== JSON.stringify({ ...DEFAULT_QUALITY, ...(reasons.quality || {}) });
  const rtyOf = rows.filter((r) => r.active && r.rty);
  const save = async () => {
    setMsg('');
    if (empty) { setMsg('Could not save: every station needs a name.'); return; }
    if (dup) { setMsg('Could not save: two stations have the same name.'); return; }
    if (!rows.some((r) => r.active)) { setMsg('Could not save: switch on at least one station.'); return; }
    // a renamed station keeps its old name, so its saved entries still count for it
    const station = rows.map(({ was, ...r }) => ({ ...r, reason: r.reason.trim(), code: r.code.trim(), aliases: [...new Set([...(r.aliases || []), ...(was && was !== r.reason.trim() ? [was] : [])])] }));
    setBusy(true);
    try {
      const j = await api.saveOleReasons({ stop: reasons.stop, loss: reasons.loss, reject: reasons.reject, rework: reasons.rework, station, quality: { fpyTarget: Number(q.fpyTarget), rtyTarget: Number(q.rtyTarget) } });
      setMsg('Saved — Loss entry, Quality, OLE and Dashboard use the new setup.');
      onSaved(j?.reasons || { ...reasons, station, quality: q });
    } catch (x) { setMsg(`Could not save: ${x.message}`); }
    setBusy(false);
  };
  const tog = (on, label, onClick) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'bg-emerald-600' : 'bg-slate-300'}`}>
      <span className={`h-6 w-6 rounded-full bg-white shadow transition ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
  return (
    <section className={card} aria-label="Quality stations setup">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-2 text-left">
        <Settings2 size={20} className="text-blue-800" aria-hidden />
        <span className="text-fs-18 font-bold text-slate-900">Quality stations — FPY / RTY setup</span>
        <span className="text-fs-14 text-slate-600">{rows.filter((r) => r.active).length} on · RTY = {rtyOf.map((r) => r.code || r.reason).join(' × ') || '—'}</span>
        <span className="ml-auto text-fs-14 font-bold text-blue-700">{open ? 'Close' : 'Change'}</span>
      </button>
      {open && (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="text-fs-14 font-bold text-slate-700">FPY target %</span>
              <input type="number" min="50" max="100" step="0.1" aria-label="FPY target" value={q.fpyTarget} onChange={(e) => setQ((x) => ({ ...x, fpyTarget: e.target.value }))} className={`${inp} mt-1 h-10 font-mono text-fs-16`} />
            </label>
            <label className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="text-fs-14 font-bold text-slate-700">RTY target %</span>
              <input type="number" min="50" max="100" step="0.1" aria-label="RTY target" value={q.rtyTarget} onChange={(e) => setQ((x) => ({ ...x, rtyTarget: e.target.value }))} className={`${inp} mt-1 h-10 font-mono text-fs-16`} />
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-fs-13 leading-snug text-slate-700 lg:col-span-2">
              <b className="text-fs-14 text-slate-900">How it is used</b><br />
              Loss entry offers only the stations that are <b>on</b> and on that line, in this order. <b>In RTY</b> = the station's FPY is multiplied into RTY (an audit station is often left out). <b>Defects</b>: when chosen, only those are offered at the station. Renaming keeps the old name, so saved entries still count.
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1200px] table-fixed text-fs-14" aria-label="Quality stations">
              <colgroup>{[78, 86, null, 104, 124, 60, 66, 56, 44 + 42 * IDS.length, 168].map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>
              <thead><tr className="border-b-2 border-slate-300 text-left text-fs-13 text-slate-600">
                {['#', 'Code', 'Station name', 'Kind', 'Owner', 'In RTY', 'Rework', 'On', 'Lines', ''].map((h, i) => <th key={i} className="whitespace-nowrap px-1.5 py-2 font-bold">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <React.Fragment key={i}>
                    <tr className={`border-b border-slate-100 align-middle ${r.active ? '' : 'bg-slate-50 text-slate-500'}`}>
                      <td className="whitespace-nowrap px-1 py-2">
                        <div className="flex items-center gap-0.5">
                          <span className="w-5 text-center font-mono font-bold">{i + 1}</span>
                          <button type="button" aria-label={`Move ${r.reason || 'station'} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ArrowUp size={15} /></button>
                          <button type="button" aria-label={`Move ${r.reason || 'station'} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ArrowDown size={15} /></button>
                        </div>
                      </td>
                      <td className="w-[84px] px-1"><input className={`${inp} h-10 font-mono uppercase`} aria-label={`Station ${i + 1} code`} maxLength={12} placeholder="LQC" value={r.code} onChange={(e) => set(i, 'code', e.target.value.toUpperCase())} /></td>
                      <td className="min-w-[250px] px-1">
                        <input title={r.reason} className={`${inp} h-10 ${!r.reason.trim() || names.indexOf(r.reason.trim().toLowerCase()) !== i ? 'border-red-400 bg-red-50' : ''}`} aria-label={`Station ${i + 1} name`} maxLength={60} value={r.reason} onChange={(e) => set(i, 'reason', e.target.value)} />
                        {r.was && r.was !== r.reason.trim() && <div className="mt-0.5 text-fs-12 text-amber-700">renamed from “{r.was}” — old entries count here</div>}
                      </td>
                      <td className="w-[112px] px-1"><select className={`${inp} h-10 pr-1`} aria-label={`Station ${i + 1} kind`} title={STATION_TYPES.find(([k]) => k === r.type)?.[1]} value={r.type} onChange={(e) => set(i, 'type', e.target.value)}>{STATION_TYPES.map(([k, t]) => <option key={k} value={k}>{KIND_SHORT[k]}</option>)}</select></td>
                      <td className="w-[130px] px-1"><input className={`${inp} h-10`} aria-label={`Station ${i + 1} owner`} maxLength={40} placeholder="Quality" value={r.dept === 'Not set' ? '' : r.dept} onChange={(e) => set(i, 'dept', e.target.value)} /></td>
                      <td className="px-1.5">{tog(r.rty, `Station ${i + 1} in RTY`, () => set(i, 'rty', !r.rty))}</td>
                      <td className="px-1.5">{tog(r.rework, `Station ${i + 1} rework`, () => set(i, 'rework', !r.rework))}</td>
                      <td className="px-1.5">{tog(r.active, `Station ${i + 1} on`, () => set(i, 'active', !r.active))}</td>
                      <td className="px-1">
                        <div className="flex flex-nowrap gap-1" role="group" aria-label={`Station ${i + 1} lines`}>
                          <button type="button" aria-pressed={!r.lines.length} onClick={() => set(i, 'lines', [])} className={`rounded-md px-2 py-1 text-fs-13 font-bold ${!r.lines.length ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-700'}`}>All</button>
                          {IDS.map((l) => { const on = r.lines.includes(l); return (
                            <button key={l} type="button" aria-pressed={on} onClick={() => set(i, 'lines', on ? r.lines.filter((x) => x !== l) : [...r.lines, l].sort((a, b) => a - b))}
                              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-fs-13 font-bold ${on ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}>L{l}</button>
                          ); })}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-1">
                        <button type="button" onClick={() => setMore(more === i ? -1 : i)} aria-expanded={more === i} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-fs-13 font-bold text-blue-700 hover:bg-blue-50">Defects {r.defects.length ? `(${r.defects.length})` : '(all)'} {more === i ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                        <button type="button" aria-label={`Remove station ${i + 1}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-700" title="Remove (saved entries of it stay, shown under its name). To keep it but stop offering it, switch it off."><Trash2 size={16} /></button>
                      </td>
                    </tr>
                    {more === i && (
                      <tr className="border-b border-slate-200 bg-blue-50/40"><td colSpan={10} className="px-3 py-3">
                        <div className="text-fs-13 font-bold text-slate-700">Defects found at {r.code || r.reason || 'this station'} — none ticked = the whole rejection / rework list</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {[...new Set([...defectList, ...r.defects])].map((d) => { const on = r.defects.includes(d); return (
                            <button key={d} type="button" aria-pressed={on} onClick={() => set(i, 'defects', on ? r.defects.filter((x) => x !== d) : [...r.defects, d])}
                              className={`rounded-md border px-2.5 py-1 text-fs-13 font-semibold ${on ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'}`}>{d}</button>
                          ); })}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setRows((x) => [...x, { ...normStation({ reason: '' }), was: '' }])} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-slate-400 px-3 text-fs-14 font-bold text-slate-700 hover:bg-slate-50"><Plus size={16} aria-hidden /> Add station</button>
            <button type="button" onClick={() => { setRows((x) => kpiStations(x).map((r) => { const k = stageOf(r.reason, r.code); const L = stageDefects(k); return !L.length ? r : { ...r, defects: [...new Set([...(r.defects || []), ...L])].slice(0, 80) }; })); setMsg('The defects of the plant sheets (Book1 rework data + PAD Defect Tag) are put on the six stages (Leakage, Functional, Front, Pre-final, Final, HVIR) — press Save stations.'); }}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-fs-14 font-bold text-emerald-800 hover:bg-emerald-100" title="The defects of the plant's PAD print Defect Tag, stage by stage">Use the defect tag list</button>
            <button type="button" onClick={() => { setRows((x) => kpiStations(x)); setQ((v) => ({ ...v, rtyTarget: 97 })); setMsg('The six stages of the KPI report are set (HVIR → Final Inspection, RTY target 97 %) — press Save stations.'); }}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 text-fs-14 font-bold text-violet-800 hover:bg-violet-100" title="HVIR · Leakage Inspection · Functional · Front Inspection · Pre-Final Inspection · Final Inspection">Use the KPI report stages</button>
            {changed && <button type="button" onClick={() => { setRows(fresh()); setQ({ ...DEFAULT_QUALITY, ...(reasons.quality || {}) }); setMsg(''); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-fs-14 font-bold text-slate-600 hover:bg-slate-100"><RotateCcw size={15} aria-hidden /> Undo changes</button>}
            <button type="button" onClick={save} disabled={busy || !changed} className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={16} aria-hidden /> {busy ? 'Saving…' : 'Save stations'}</button>
          </div>
          {msg && <p role="status" className={`mt-2 text-fs-14 font-bold ${msg.startsWith('Not') ? 'text-red-700' : 'text-emerald-700'}`}>{msg}</p>}
        </div>
      )}
    </section>
  );
}
