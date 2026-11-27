/**
 * 27-11-2026: CAPA verification — the last step of the CAPA: was the action really done on the line, and did it work?
 *   tiles   actions written · to verify · verification due (target passed) · effective · not effective
 *   list    every RCA of the month with an action: root cause, why count, corrective / preventive action, owner, target,
 *           the same defect on the same line 7 days before the RCA and 7 days after the action (from the loss entries)
 *   verify  implemented yes / partly / no, verified by, date, note → "Effective — close" or "Not effective — reopen"
 *   PDF     the CAPA form of a row (with the verification)
 * Saved on the same RCA record (capa.implemented / verifiedBy / verifyDate / verifyNote), so the CAPA register and the
 * PDF show it too.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, FileDown, RefreshCw, X } from 'lucide-react';
import HeaderBar, { fieldCls } from '../components/HeaderBar';
import MesDrawer from '../components/MesDrawer';
import { api } from '../api';
import { serverToday } from '../utils/serverTime';
import { normEntry, rcaStatus, KIND_TEXT } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { guessDept } from '../utils/deptRules';
import { addDaysYmd } from '../utils/rcaEffect';
import { capaHead, capaPdf, capaFileName, downloadBlob } from '../utils/capaForm';
import { savedUi } from '../hooks/useUiSettings';
import { useAuth } from '../components/AuthGate';
import { nf, dmy, inp, card, StatusChip, useOleLines, monthOf, monthRange } from '../components/OleParts';

const WIN = 7;
const LIST = { stop: 'stops', loss: 'losses', reject: 'rejects', rework: 'rework' };
const tidy = (s) => String(s ?? '').trim();
const IMPL = { yes: 'Effective', partly: 'Partly done', no: 'Not effective' };

/** the same reason on the same line: amount per day */
function dayAmounts(entries, line, kind, reason) {
  const m = new Map(); const num = kind === 'stop' || kind === 'loss' ? 'min' : 'qty';
  for (const [k, raw] of Object.entries(entries || {})) {
    const [d, l] = k.split('|'); if (String(l) !== String(line)) continue;
    for (const x of normEntry(raw)[LIST[kind]] || []) if (tidy(x.reason).toLowerCase() === reason.toLowerCase()) m.set(d, (m.get(d) || 0) + (Number(x[num]) || 0));
  }
  return m;
}
const sumDays = (m, from, to) => { let s = 0; for (const [d, v] of m) if (d >= from && d <= to) s += v; return s; };

export function verifyState(r) {
  const c = r?.capa || {};
  if (c.implemented === 'yes') return 'effective';
  if (c.implemented === 'no' || c.implemented === 'partly') return 'noteff';
  return 'toverify';
}

export default function CapaVerifyPage({ isAdmin = true }) {
  const IDS = useOleLines();
  const today = serverToday();
  const [month, setMonth] = useState(monthOf(today));
  const range = monthRange(month, today);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true; setErr('');
    const end = addDaysYmd(range.end, WIN + 1) > today ? today : addDaysYmd(range.end, WIN + 1);
    api.oleEntries(addDaysYmd(range.start, -WIN), end).then((e) => { if (live) setData({ entries: e?.entries || {}, rca: e?.rca || {} }); }).catch((x) => live && setErr(`Could not read: ${x.message}`));
    return () => { live = false; };
  }, [range.start, range.end, today, tick]);

  const rows = useMemo(() => {
    if (!data) return [];
    return Object.values(data.rca).filter((r) => r && r.date >= range.start && r.date <= range.end && tidy(r.action) && IDS.includes(String(r.line))).map((r) => {
      const m = dayAmounts(data.entries, r.line, r.kind, r.reason);
      const from = r.closeDate || r.targetDate || r.date;   // the action is on the line from its close date (else target, else the day)
      const before = sumDays(m, addDaysYmd(r.date, -(WIN - 1)), r.date);
      const aFrom = addDaysYmd(from, 1), aTo = addDaysYmd(from, WIN) > today ? today : addDaysYmd(from, WIN);
      const after = aFrom <= aTo ? sumDays(m, aFrom, aTo) : null;
      const daysAfter = aFrom <= aTo ? Math.round((new Date(`${aTo}T00:00:00Z`) - new Date(`${aFrom}T00:00:00Z`)) / 864e5) + 1 : 0;
      const vs = verifyState(r);
      const due = vs === 'toverify' && !!(r.targetDate || r.closeDate) && (r.closeDate || r.targetDate) <= today;
      return { ...r, dept: deptName(r.dept) || guessDept(r.kind, r.reason), unit: r.kind === 'stop' || r.kind === 'loss' ? 'min' : 'pcs', before, after, daysAfter, vs, due, nWhy: (r.whys || []).filter(Boolean).length };
    }).sort((a, b) => (b.due - a.due) || ((a.vs === 'toverify' ? 0 : 1) - (b.vs === 'toverify' ? 0 : 1)) || b.date.localeCompare(a.date));
  }, [data, range.start, range.end, IDS.join(), today]); // eslint-disable-line react-hooks/exhaustive-deps

  const [line, setLine] = useState('all');
  const [dept, setDept] = useState('all');
  const [show, setShow] = useState('toverify');
  // 27-11-2026: the admin takes out RCAs saved by mistake (to the archive) and can put them back
  const [sel, setSel] = useState(() => new Set());
  const [arc, setArc] = useState(null);
  const [note, setNote] = useState(null);
  const keyOf = (r) => `${r.date}|${r.line}|${r.kind}|${r.reason}`;
  const depts = [...new Set(rows.map((r) => r.dept))].sort();
  const base = rows.filter((r) => (line === 'all' || String(r.line) === line) && (dept === 'all' || r.dept === dept));
  const T = { few: base.filter((r) => r.nWhy < 3).length, all: base.length, toverify: base.filter((r) => r.vs === 'toverify').length, due: base.filter((r) => r.due).length, effective: base.filter((r) => r.vs === 'effective').length, noteff: base.filter((r) => r.vs === 'noteff').length };
  const shown = base.filter((r) => show === 'all' || (show === 'few' ? r.nWhy < 3 : show === 'due' ? r.due : r.vs === show));
  const removeSel = async () => {
    const keys = [...sel].filter((k) => shown.some((r) => keyOf(r) === k));
    if (!keys.length) return;
    if (!window.confirm(`Take out ${keys.length} RCA${keys.length > 1 ? 's' : ''}? They go to the archive (not deleted) and can be put back from "Removed".`)) return;
    setNote(null);
    try { const r = await api.rcaRemove(keys); setNote({ bad: false, text: `${r?.moved ?? keys.length} RCA taken out — kept in the archive ("Removed").` }); setSel(new Set()); setArc(null); setTick((t) => t + 1); }
    catch (e) { setNote({ bad: true, text: `Could not take out: ${e.message}` }); }
  };
  const loadArc = async () => { try { const r = await api.rcaRemoved(); setArc(r?.items || []); } catch (e) { setNote({ bad: true, text: `Archive could not be read: ${e.message}` }); } };
  const restore = async (k) => { try { await api.rcaRestore([k]); setNote({ bad: false, text: 'Put back.' }); await loadArc(); setTick((t) => t + 1); } catch (e) { setNote({ bad: true, text: `Could not put back: ${e.message}` }); } };
  const [open, setOpen] = useState(null);
  const head = useMemo(() => capaHead(savedUi().capa), []);
  const [pdfBusy, setPdfBusy] = useState('');
  const pdf = async (r) => { setPdfBusy(r.key || r.reason); try { downloadBlob(await capaPdf([r], head, api.fileUrl), capaFileName(r)); } catch (e) { setErr(`PDF could not be made: ${e.message}`); } setPdfBusy(''); };

  const Tile = ({ k, name, value, tone }) => (
    <button type="button" onClick={() => setShow(k)} aria-pressed={show === k} data-testid={`cv-tile-${k}`}
      className={`lp-tile rounded-xl border bg-white px-3 py-2 text-left transition ${show === k ? 'border-blue-700 ring-2 ring-blue-200' : 'border-slate-200 hover:border-blue-300'}`}>
      <div className="text-fs-11 font-bold uppercase tracking-wide text-slate-500">{name}</div>
      <div className={`font-mono text-fs-24 font-extrabold ${tone}`}>{nf(value)}</div>
    </button>
  );
  const th = 'border-b-2 border-slate-300 px-2 py-1.5 text-left text-fs-12 font-bold text-slate-600 whitespace-nowrap';
  const td = 'border-b border-slate-100 px-2 py-2 align-top';

  return (
    <div className="flex flex-col gap-3" data-testid="capa-verify">
      <HeaderBar label="CAPA verification filters">
        <input type="month" aria-label="Choose month" max={monthOf(today)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
        <select aria-label="Line" value={line} onChange={(e) => setLine(e.target.value)} className={fieldCls}><option value="all">All lines</option>{IDS.map((l) => <option key={l} value={l}>Line {l}</option>)}</select>
        <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={fieldCls}><option value="all">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <button type="button" onClick={() => setTick((t) => t + 1)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-100"><RefreshCw size={15} />Refresh</button>
      </HeaderBar>

      <div className="lp-kpis grid gap-2" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
        <Tile k="all" name="Actions written" value={T.all} tone="text-slate-900" />
        <Tile k="toverify" name="To verify" value={T.toverify} tone={T.toverify ? 'text-blue-800' : 'text-slate-900'} />
        <Tile k="due" name="Verification due" value={T.due} tone={T.due ? 'text-red-700' : 'text-slate-900'} />
        <Tile k="effective" name="Effective" value={T.effective} tone="text-emerald-700" />
        <Tile k="noteff" name="Not effective" value={T.noteff} tone={T.noteff ? 'text-amber-700' : 'text-slate-900'} />
      </div>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 no-print" aria-label="Clean up">
          <button type="button" onClick={() => setShow('few')} aria-pressed={show === 'few'} data-testid="cv-few" className={`rounded-lg border px-3 py-1.5 text-fs-13 font-bold ${show === 'few' ? 'border-amber-700 bg-amber-100 text-amber-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>Saved with less than 3 whys <span className="font-mono">{T.few}</span></button>
          <button type="button" disabled={!sel.size} onClick={removeSel} data-testid="cv-remove" className="rounded-lg border border-red-600 bg-white px-3 py-1.5 text-fs-13 font-bold text-red-700 hover:bg-red-50 disabled:opacity-40">Take out selected ({sel.size})</button>
          <button type="button" onClick={() => (arc ? setArc(null) : loadArc())} data-testid="cv-archive" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-100">{arc ? 'Hide removed' : 'Removed (archive)'}</button>
          <span className="text-fs-12 text-slate-500">Taken out = moved to the archive, never deleted; it can be put back.</span>
        </div>)}
      {note && <div role="status" className={`rounded-xl border px-4 py-2 text-fs-13 font-semibold ${note.bad ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{note.text}</div>}
      {arc && (
        <section className={card} aria-label="Removed RCAs" data-testid="cv-arc">
          <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Removed RCAs (archive) · {arc.length}</h3>
          {!arc.length ? <p className="text-fs-13 text-slate-500">Nothing removed.</p> : (
            <div className="overflow-auto" style={{ maxHeight: 320 }}>
              <table className="w-full text-fs-13">
                <thead><tr>{['Date', 'Line', 'Defect / reason', 'Root cause', 'Action', 'Removed by', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{[...arc].reverse().map((a, j) => (
                  <tr key={`${a.key}|${j}`}>
                    <td className={td}>{dmy(a.rec?.date)}</td><td className={td}>Line {a.rec?.line}</td><td className={td}><b>{a.rec?.reason}</b></td>
                    <td className={td}>{a.rec?.rootCause}</td><td className={td}>{a.rec?.action}</td><td className={`${td} whitespace-nowrap`}>{a.removedBy} · {a.removedAt}</td>
                    <td className={td}><button type="button" onClick={() => restore(a.key)} className="rounded-lg border border-slate-300 px-2 py-1 text-fs-12 font-bold text-slate-700 hover:bg-slate-100">Put back</button></td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </section>)}

      {err && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
      <section className={card} aria-label="CAPA to verify">
        <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">
          {{ few: 'Saved with less than 3 whys', all: 'All actions', toverify: 'To verify', due: 'Verification due', effective: 'Verified — effective', noteff: 'Verified — not effective' }[show]} <span className="font-normal text-slate-500">· {shown.length}</span>
        </h3>
        {!data && !err ? <p className="text-fs-14 text-slate-500">Reading the CAPAs …</p> : !shown.length ? <p className="text-fs-14 text-slate-500">Nothing here.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-fs-13 tabular-nums" style={{ minWidth: 1300 }} data-testid="cv-table">
              <thead><tr>{isAdmin && <th className={th}><input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((r) => sel.has(keyOf(r)))} onChange={(e) => setSel(e.target.checked ? new Set(shown.map(keyOf)) : new Set())} /></th>}{['Date', 'Line', 'Defect / reason', 'Dept.', 'Root cause', 'Whys', 'Corrective action', 'Responsibility', 'Target', `${WIN} days before`, `${WIN} days after action`, 'Verification', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((r) => {
                  const better = r.after != null && r.after < r.before, worse = r.after != null && r.after > 0 && r.after >= r.before;
                  return (
                    <tr key={`${r.date}|${r.line}|${r.kind}|${r.reason}`} data-testid="cv-row" className={r.due ? 'bg-red-50/50' : ''}>
                      {isAdmin && <td className={td}><input type="checkbox" aria-label={`Select ${r.reason} ${dmy(r.date)} Line ${r.line}`} checked={sel.has(keyOf(r))} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(keyOf(r)); else n.delete(keyOf(r)); return n; })} /></td>}
                      <td className={`${td} whitespace-nowrap font-bold`}>{dmy(r.date)}</td>
                      <td className={`${td} whitespace-nowrap`}>Line {r.line}</td>
                      <td className={td}><b>{r.reason}</b><div className="text-fs-11 font-semibold uppercase text-slate-500">{KIND_TEXT[r.kind]}</div></td>
                      <td className={`${td} whitespace-nowrap`}>{r.dept}</td>
                      <td className={td} style={{ minWidth: 170 }}>{r.cat && <span className="mr-1 rounded-full bg-blue-50 px-2 py-0.5 text-fs-11 font-bold text-blue-800">{r.cat}</span>}{r.rootCause}</td>
                      <td className={`${td} text-center font-mono font-bold ${r.nWhy < 3 ? 'text-amber-700' : 'text-slate-700'}`} title={r.nWhy < 3 ? 'Less than 3 whys' : ''}>{r.nWhy}</td>
                      <td className={td} style={{ minWidth: 170 }}>{r.action}{r.preventive && <div className="text-slate-500"><b>Prev.:</b> {r.preventive}</div>}</td>
                      <td className={`${td} whitespace-nowrap`}>{r.owner || '—'}</td>
                      <td className={`${td} whitespace-nowrap ${r.due ? 'font-bold text-red-700' : ''}`}>{r.targetDate ? dmy(r.targetDate) : '—'}{r.closeDate && <div className="text-fs-11 text-slate-500">done {dmy(r.closeDate)}</div>}</td>
                      <td className={`${td} whitespace-nowrap text-right font-mono font-bold text-red-700`}>{nf(r.before)} {r.unit}</td>
                      <td className={`${td} whitespace-nowrap text-right font-mono font-bold`} data-testid="cv-after">
                        {r.after == null ? <span className="text-slate-400">not yet</span> : <span className={better || r.after === 0 ? 'text-emerald-700' : worse ? 'text-red-700' : 'text-slate-700'}>{nf(r.after)} {r.unit}{r.after === 0 ? ' ✓' : better ? ' ↓' : worse ? ' ↑' : ''}</span>}
                        {r.after != null && <div className="text-fs-11 font-normal text-slate-500">{r.daysAfter} day{r.daysAfter > 1 ? 's' : ''}</div>}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {r.vs === 'toverify' ? <span className={`rounded px-1.5 py-0.5 text-fs-12 font-bold ${r.due ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{r.due ? 'Due' : 'To verify'}</span>
                          : <span className={`rounded px-1.5 py-0.5 text-fs-12 font-bold ${r.vs === 'effective' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{IMPL[r.capa?.implemented]}</span>}
                        {r.capa?.verifiedBy && <div className="text-fs-11 text-slate-500">{r.capa.verifiedBy}{r.capa.verifyDate ? ` · ${dmy(r.capa.verifyDate)}` : ''}</div>}
                        <div className="mt-0.5"><StatusChip st={rcaStatus(r)} /></div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <div className="flex gap-1.5">
                          {isAdmin && <button type="button" onClick={() => setOpen(r)} data-testid="cv-verify" className="inline-flex h-8 items-center gap-1 rounded-lg bg-blue-700 px-2.5 text-fs-13 font-bold text-white hover:bg-blue-800"><BadgeCheck size={14} />{r.vs === 'toverify' ? 'Verify' : 'Edit'}</button>}
                          <button type="button" disabled={!!pdfBusy} onClick={() => pdf(r)} className="inline-flex h-8 items-center gap-1 rounded-lg border bg-white px-2.5 text-fs-13 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50" style={{ borderColor: '#B91C1C' }}><FileDown size={14} />PDF</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>)}
        <p className="mt-2 text-fs-12 text-slate-500">"{WIN} days after action": the same defect / reason on the same line in the {WIN} days after the action was done (close date, else target date) — from the loss entries. ✓ none came again · ↓ less than before · ↑ not less.</p>
      </section>
      {open && <VerifyDialog r={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); setTick((t) => t + 1); }} onPdf={pdf} />}
    </div>
  );
}

export function VerifyDialog({ r, onClose, onSaved, onPdf }) {
  const today = serverToday();
  const me = useAuth()?.user || '';
  const c0 = r.capa || {};
  const [v, setV] = useState({ implemented: c0.implemented || (r.after === 0 ? 'yes' : ''), verifiedBy: c0.verifiedBy || me, verifyDate: c0.verifyDate || today, verifyNote: c0.verifyNote || (r.after != null ? `${r.after === 0 ? 'Not seen again' : `${nf(r.after)} ${r.unit} again`} in ${r.daysAfter} day(s) after the action (${nf(r.before)} ${r.unit} in the ${WIN} days before).` : '') });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (implemented) => {
    setErr('');
    if (!tidy(v.verifiedBy)) { setErr('Write who verified it.'); return; }
    const capa = { ...c0, implemented, verifiedBy: tidy(v.verifiedBy), verifyDate: v.verifyDate || today, verifyNote: tidy(v.verifyNote) };
    // effective → closed (done); not effective / partly → open again (submitted) so the department works on it again
    const status = implemented === 'yes' ? 'closed' : 'submitted';
    setBusy(true);
    try {
      await api.saveRca([{ date: r.date, line: Number(r.line), kind: r.kind, reason: r.reason, cat: r.cat, rootCause: r.rootCause, whys: r.whys || [], action: r.action, preventive: r.preventive || '', owner: r.owner || '', targetDate: r.targetDate || '',
        closeDate: status === 'closed' ? (r.closeDate || capa.verifyDate) : '', status, evidence: (r.evidence || []).map((e) => ({ id: e.id })), capa }]);
      onSaved();
    } catch (e) { setErr(`Could not save: ${e.message}`); setBusy(false); }
  };
  const L = 'grid gap-1 text-fs-13 font-bold text-slate-700';
  const row = (k, val) => <div className="grid gap-2 border-b border-slate-100 py-1.5 text-fs-13" style={{ gridTemplateColumns: '150px minmax(0,1fr)' }}><span className="font-bold text-slate-500">{k}</span><span>{val || '—'}</span></div>;
  return (
    <MesDrawer title={<>Verify CAPA · {r.reason}</>} sub={<>Line {r.line} · {dmy(r.date)} · {KIND_TEXT[r.kind]} · <b>{r.dept}</b></>} icon={BadgeCheck} onClose={onClose} label="Verify CAPA" method="center" width={50} canExpand={false}>
      <div className="grid gap-3 p-4" data-testid="cv-dialog">
        <div>
          {row('Root cause', <>{r.cat && <b>[{r.cat}] </b>}{r.rootCause}</>)}
          {row('Why-why', (r.whys || []).filter(Boolean).map((w, k) => <div key={k}><b>Why {k + 1}:</b> {w}</div>))}
          {row('Corrective action', r.action)}
          {row('Preventive action', r.preventive)}
          {row('Responsibility · target', `${r.owner || '—'} · ${r.targetDate ? dmy(r.targetDate) : '—'}${r.closeDate ? ` · done ${dmy(r.closeDate)}` : ''}`)}
          {row('On the line', <span className="font-mono"><b className="text-red-700">{nf(r.before)} {r.unit}</b> in the {WIN} days before → <b className={r.after === 0 ? 'text-emerald-700' : 'text-red-700'}>{r.after == null ? 'not yet' : `${nf(r.after)} ${r.unit}`}</b>{r.after != null ? ` in ${r.daysAfter} day(s) after the action` : ''}</span>)}
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="text-fs-13 font-bold text-slate-700">Action implemented on the line and working?</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup">
            {[['yes', 'Yes — effective'], ['partly', 'Partly'], ['no', 'No — not effective']].map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={v.implemented === k} data-testid={`cv-impl-${k}`} onClick={() => setV((o) => ({ ...o, implemented: k }))}
                className={`h-9 rounded-full border px-3.5 text-fs-13 font-bold ${v.implemented === k ? (k === 'yes' ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-amber-700 text-white lp-amber-solid') : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{t}</button>))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={L}>Verified by (sign)<input className={inp} maxLength={80} value={v.verifiedBy} onChange={(e) => setV((o) => ({ ...o, verifiedBy: e.target.value }))} aria-label="Verified by" /></label>
          <label className={L}>Verified on<input type="date" className={inp} max={today} value={v.verifyDate} onChange={(e) => setV((o) => ({ ...o, verifyDate: e.target.value }))} aria-label="Verified on" /></label>
        </div>
        <label className={L}>Verification note <span className="font-normal text-slate-500">(what was seen on the line)</span><textarea className={`${inp} h-auto py-1.5`} style={{ minHeight: 56 }} maxLength={300} value={v.verifyNote} onChange={(e) => setV((o) => ({ ...o, verifyNote: e.target.value }))} aria-label="Verification note" /></label>
        {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onPdf({ ...r, capa: { ...c0, ...v } })} className="mr-auto inline-flex h-10 items-center gap-1.5 rounded-lg border bg-white px-4 text-fs-14 font-bold text-red-700 hover:bg-red-50" style={{ borderColor: '#B91C1C' }}><FileDown size={15} />PDF</button>
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700"><X size={15} />Cancel</button>
          <button type="button" disabled={busy || !v.implemented || v.implemented === 'yes'} onClick={() => save(v.implemented)} data-testid="cv-reopen" className="lp-amber-solid h-10 rounded-lg px-4 text-fs-14 font-bold text-white disabled:opacity-40">Not effective — reopen</button>
          <button type="button" disabled={busy || v.implemented !== 'yes'} onClick={() => save('yes')} data-testid="cv-ok" className="h-10 rounded-lg bg-emerald-700 px-4 text-fs-14 font-bold text-white disabled:opacity-40">Effective — verify &amp; close</button>
        </div>
      </div>
    </MesDrawer>
  );
}
