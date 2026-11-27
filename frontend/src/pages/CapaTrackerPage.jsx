/**
 * 27-11-2026: CAPA loop & follow-up — the closed CAPA loop of the assembly line in one page (utils/capaLoop.js):
 *   loop      1 Write CAPA → 2 Action on line (or Redo) → 3 Verify on line (or Came back) → 4 Watch 30 days → 5 Closed
 *             each box: how many are at that step and how many are late; a click shows them
 *   escalate  L1 owner (1–2 days late) · L2 department head (3–6) · L3 plant head (7+)
 *   follow-up every loss of the month with its step, what has to be done next and by whom, due date, days late,
 *             escalation, and the button that does it: write / edit the CAPA, verify, reopen when it came back
 *   day×line  every day of the month, each line: losses in the loop / closed — a click opens that day's Daily CAPA sheet
 *   owners    who has how many open, late, closed
 * The records are the same RCAs as the Daily CAPA sheets, RCA Entry, the CAPA register and CAPA verification.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, ExternalLink, ChevronRight, RefreshCw } from 'lucide-react';
import HeaderBar, { fieldCls } from '../components/HeaderBar';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, issuesOf, needsRca } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { guessDept } from '../utils/deptRules';
import { addDaysYmd } from '../utils/rcaEffect';
import { loopRows, loopTotals, STAGES, STAGE_BY_ID, ESC, WATCH_DAYS, VERIFY_AFTER } from '../utils/capaLoop';
import { api } from '../api';
import { nf, dmy, card, useOleLines, monthOf, monthRange, useOleData } from '../components/OleParts';
import { exportPanel } from '../utils/domExcel';
import { openPage } from '../components/NotificationBell';
import { RcaDialog } from './RcaPage';
import { VerifyDialog } from './CapaVerifyPage';
import { capaHead, capaPdf, capaFileName, downloadBlob } from '../utils/capaForm';
import { savedUi } from '../hooks/useUiSettings';

export const CAPA_OPEN_KEY = 'lp:capa-open';   // → the Daily CAPA sheet of a day and line
const KINDS = { rework: ['rework', 'reject'], idle: ['loss', 'stop'] };
const KIND_LABEL = { rework: 'Rework', reject: 'Rejection', loss: 'Idle time', stop: 'Stoppage' };
const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const TONE = {
  write: 'bg-red-100 text-red-800', action: 'bg-blue-100 text-blue-800', redo: 'bg-amber-100 text-amber-800', verify: 'bg-violet-100 text-violet-800',
  back: 'bg-red-100 text-red-800', watch: 'bg-sky-100 text-sky-800', closed: 'bg-emerald-100 text-emerald-800',
};
const ESC_TONE = ['text-slate-500', 'bg-amber-100 text-amber-800', 'bg-orange-100 text-orange-800', 'bg-red-600 text-white'];
const same = (a, b) => deptName(a).toLowerCase() === deptName(b).toLowerCase();

export function StageChip({ stage }) {
  const s = STAGE_BY_ID[stage];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-fs-12 font-bold ${TONE[stage]}`} data-testid={`stage-${stage}`}>{s.step} · {s.name}</span>;
}

export default function CapaTrackerPage({ isAdmin = false, myDept = '' }) {
  const IDS = useOleLines();
  const today = serverToday();
  const [month, setMonth] = useState(monthOf(today));
  const range = monthRange(month, today);
  const [kind, setKind] = useState('all');
  const [line, setLine] = useState('all');
  const [dept, setDept] = useState(myDept || 'all');
  const [show, setShow] = useState('open');   // open · late · a stage id · esc1/2/3 · all
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS });
  // the line after the month too (verification and the 30-day watch run past the month end) and the week before it
  const [ext, setExt] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    api.oleEntries(addDaysYmd(range.start, -7), today).then((e) => { if (live) setExt({ entries: e?.entries || {}, rca: e?.rca || {} }); }).catch(() => live && setExt({ entries: {}, rca: {} }));
    return () => { live = false; };
  }, [range.start, today, tick]);
  const issues = useMemo(() => (D.al ? issuesOf(oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }).days).filter(needsRca) : []),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, IDS]);
  const rca = useMemo(() => ({ ...(D.ent.rca || {}), ...(ext?.rca || {}) }), [D.ent.rca, ext]);
  const all = useMemo(() => (ext ? loopRows(issues, rca, ext.entries, today) : []).map((r) => ({ ...r, dept: deptName(r.rec?.dept || r.dept) || guessDept(r.kind, r.reason), sheet: KINDS.rework.includes(r.kind) ? 'rework' : 'idle' })),
    [issues, rca, ext, today]);
  const depts = useMemo(() => [...new Set(all.map((r) => r.dept))].sort(), [all]);
  const rows = all.filter((r) => (kind === 'all' || r.sheet === kind) && (line === 'all' || String(r.line) === line) && (dept === 'all' || same(r.dept, dept)));
  const T = loopTotals(rows);
  const list = rows.filter((r) => (show === 'all' ? true : show === 'open' ? STAGE_BY_ID[r.stage].open : show === 'late' ? r.late > 0 : show.startsWith('esc') ? STAGE_BY_ID[r.stage].open && r.esc === Number(show.slice(3)) : r.stage === show));
  const canWrite = (r) => isAdmin || (myDept && same(myDept, r.dept));
  const openSheet = (date, ln, sheet) => {
    try { sessionStorage.setItem(CAPA_OPEN_KEY, JSON.stringify({ date, line: String(ln) })); } catch { /* private mode */ }
    openPage(sheet === 'idle' ? 'idleday' : 'capaday');
  };
  const reload = async () => { setTick((t) => t + 1); await D.reloadEnt?.(); };
  const [dlg, setDlg] = useState(null);   // { type: 'rca' | 'verify', r }
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  // came back in the watch → reopen: back to the owner, verified "not effective" with the day it came back
  const reopen = async (r) => {
    const x = r.rec; if (!x) return;
    setBusy(r.key); setMsg(null);
    try {
      await api.saveRca([{ date: r.date, line: Number(r.line), kind: r.kind, reason: r.reason, cat: x.cat, rootCause: x.rootCause, whys: x.whys || [], action: x.action, preventive: x.preventive || '', owner: x.owner || '', targetDate: addDaysYmd(today, 3),
        closeDate: '', status: 'submitted', evidence: (x.evidence || []).map((e) => ({ id: e.id })),
        capa: { ...(x.capa || {}), implemented: 'no', verifyDate: today, verifyNote: `Came back on ${dmy(r.backOn)} (${nf(r.backQty)} ${r.unit}) within ${WATCH_DAYS} days — reopened`.slice(0, 300) } }]);
      setMsg({ bad: false, text: `${r.reason} (Line ${r.line}, ${dmy(r.date)}) reopened — back to ${x.owner || r.dept}, new target ${dmy(addDaysYmd(today, 3))}.` });
      await reload();
    } catch (e) { setMsg({ bad: true, text: `Could not reopen: ${e.message}` }); }
    setBusy('');
  };
  const act = (r) => {
    const can = canWrite(r);
    if (r.stage === 'verify' && isAdmin) return { label: 'Verify', on: () => setDlg({ type: 'verify', r }) };
    if (r.stage === 'back' && isAdmin) return { label: busy === r.key ? 'Reopening…' : 'Reopen', on: () => reopen(r), warn: true };
    if (r.stage === 'write') return { label: can ? 'Write CAPA' : 'View', on: () => setDlg({ type: 'rca', r }), main: can };
    if (r.stage === 'action' || r.stage === 'redo') return { label: can ? 'Update / done' : 'View', on: () => setDlg({ type: 'rca', r }), main: can };
    return { label: 'View', on: () => setDlg({ type: 'rca', r }) };
  };
  // day × line
  const days = useMemo(() => [...new Set(rows.map((r) => r.date))].sort().reverse(), [rows]);
  const cell = (d, l) => { const rs = rows.filter((r) => r.date === d && String(r.line) === l); return { n: rs.length, write: rs.filter((r) => r.stage === 'write').length, open: rs.filter((r) => STAGE_BY_ID[r.stage].open).length, late: rs.filter((r) => r.late > 0).length }; };
  const lines = line === 'all' ? IDS : [line];
  const owners = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (r.stage === 'write') continue;
      const k = (r.rec?.owner || '').trim() || `${r.dept} (no name)`;
      const o = m.get(k) || { owner: k, open: 0, late: 0, esc3: 0, done: 0 };
      if (STAGE_BY_ID[r.stage].open) o.open += 1; else o.done += 1;
      if (r.late > 0) o.late += 1; if (r.esc === 3) o.esc3 += 1;
      m.set(k, o);
    }
    return [...m.values()].sort((a, b) => b.esc3 - a.esc3 || b.late - a.late || b.open - a.open);
  }, [rows]);
  const th = 'border border-slate-300 bg-[#DCE6F2] px-2 py-1.5 text-left text-fs-12 font-bold text-[#1F3864] whitespace-nowrap';
  const td = 'border border-slate-200 px-2 py-1.5 text-fs-13 align-top';
  const seg = (on) => `h-9 px-3 text-fs-13 font-bold whitespace-nowrap ${on ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
  const bodyRef = React.useRef(null);
  // the loop: 5 steps, the two side steps (redo, came back) under their step
  const STEP = [
    { ids: ['write'], name: 'Write CAPA', who: 'Department · next day' },
    { ids: ['action', 'redo'], name: 'Action on line', who: 'Responsibility · target date' },
    { ids: ['verify', 'back'], name: 'Verify on line', who: `Quality · ${VERIFY_AFTER} days after the action` },
    { ids: ['watch'], name: `Watch ${WATCH_DAYS} days`, who: 'The line data' },
    { ids: ['closed'], name: 'Loop closed', who: 'Proven gone' },
  ];
  const lateOf = (ids) => rows.filter((r) => ids.includes(r.stage) && r.late > 0).length;

  return (
    <div className="flex flex-col gap-3" data-testid="capa-tracker">
      <HeaderBar label="CAPA loop filters">
        <input type="month" aria-label="Month" max={monthOf(today)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
        <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Sheet">
          {[['all', 'Both'], ['rework', 'Rework'], ['idle', 'Idle time']].map(([k, t]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={seg(kind === k)}>{t}</button>)}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Line">
          {['all', ...IDS].map((l) => <button key={l} type="button" aria-pressed={line === l} onClick={() => setLine(l)} className={seg(line === l)}>{l === 'all' ? 'All lines' : `Line ${l}`}</button>)}
        </div>
        <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={fieldCls}>
          <option value="all">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={reload} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-100"><RefreshCw size={15} />Refresh</button>
          <button type="button" onClick={() => exportPanel(bodyRef.current, 'CAPA loop & follow-up', `${month}`)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-100"><FileSpreadsheet size={15} />Excel</button>
        </div>
      </HeaderBar>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {(!D.al || !ext) && !D.err && <div className={`${card} text-fs-14 font-semibold text-slate-500`}>Reading the month …</div>}
      {msg && <div role="status" className={`rounded-xl border px-4 py-2 text-fs-13 font-semibold ${msg.bad ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{msg.text}</div>}
      {D.al && ext && (
        <div ref={bodyRef} className="flex flex-col gap-3">
          {/* the loop */}
          <section className={card} aria-label="CAPA loop">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">CAPA loop — assembly line</h3>
              <span className="text-fs-13 text-slate-600"><b className="font-mono">{nf(T.n)}</b> losses · <b className="font-mono">{nf(T.open)}</b> open · <b className={`font-mono ${T.late ? 'text-red-700' : ''}`}>{nf(T.late)}</b> late · loop closed <b className="font-mono text-emerald-700">{pc(T.closedPct)}</b> · proven effective <b className="font-mono text-emerald-700">{nf(T.effective)}</b></span>
              <button type="button" onClick={() => setShow('all')} aria-pressed={show === 'all'} className={`ml-auto rounded-full border px-3 py-0.5 text-fs-12 font-bold ${show === 'all' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 text-slate-600'}`}>Show all</button>
              <button type="button" onClick={() => setShow('open')} aria-pressed={show === 'open'} className={`rounded-full border px-3 py-0.5 text-fs-12 font-bold ${show === 'open' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 text-slate-600'}`}>Open only</button>
            </div>
            <div className="lp-loop" data-testid="capa-loop">
              {STEP.map((s, k) => (
                <React.Fragment key={s.name}>
                  <div className="lp-loop-step">
                    <button type="button" onClick={() => setShow(s.ids[0])} aria-pressed={show === s.ids[0]} data-testid={`loop-${s.ids[0]}`} className={`lp-loop-box ${show === s.ids[0] ? 'lp-loop-on' : ''}`}>
                      <div className="text-fs-11 font-extrabold uppercase tracking-wide text-slate-500">Step {k + 1}</div>
                      <div className="text-fs-14 font-extrabold text-[#1F3864]">{s.name}</div>
                      <div className="font-mono text-fs-28 font-extrabold leading-tight text-slate-900">{nf(T.st[s.ids[0]])}</div>
                      <div className="text-fs-11 text-slate-500">{s.who}</div>
                      {lateOf([s.ids[0]]) > 0 && <div className="mt-0.5 text-fs-12 font-bold text-red-700">{lateOf([s.ids[0]])} late</div>}
                    </button>
                    {s.ids[1] && (
                      <button type="button" onClick={() => setShow(s.ids[1])} aria-pressed={show === s.ids[1]} data-testid={`loop-${s.ids[1]}`} className={`lp-loop-side ${TONE[s.ids[1]]} ${show === s.ids[1] ? 'lp-loop-on' : ''}`}>
                        ↺ {STAGE_BY_ID[s.ids[1]].name} <b className="font-mono">{nf(T.st[s.ids[1]])}</b>{lateOf([s.ids[1]]) > 0 && <span className="text-red-700"> · {lateOf([s.ids[1]])} late</span>}
                      </button>)}
                  </div>
                  {k < STEP.length - 1 && <ChevronRight className="lp-loop-arrow text-slate-400" size={22} aria-hidden />}
                </React.Fragment>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Escalation">
              <span className="text-fs-12 font-extrabold uppercase tracking-wide text-slate-500">Escalation of late steps</span>
              {[1, 2, 3].map((e) => (
                <button key={e} type="button" onClick={() => setShow(`esc${e}`)} aria-pressed={show === `esc${e}`} data-testid={`esc-${e}`}
                  className={`rounded-lg px-3 py-1 text-fs-13 font-bold ${ESC_TONE[e]} ${show === `esc${e}` ? 'ring-2 ring-blue-500' : ''}`}>{ESC[e].name} <span className="font-mono">{T.esc[e]}</span></button>))}
              <span className="text-fs-12 text-slate-500">L1 1–2 days late · L2 3–6 · L3 7 or more</span>
            </div>
          </section>

          {/* follow-up */}
          <section className={card} aria-label="Follow-up">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">
                Follow-up — {show === 'open' ? 'open' : show === 'all' ? 'all' : show === 'late' ? 'late' : show.startsWith('esc') ? ESC[Number(show.slice(3))].name : STAGE_BY_ID[show]?.name}
              </h3>
              <span className="ml-auto text-fs-12 text-slate-500">{list.length} rows · late and escalated first</span>
            </div>
            {!list.length ? <p className="text-fs-13 text-slate-600">Nothing here.</p> : (
              <div className="overflow-auto" style={{ maxHeight: 620 }}>
                <table className="w-full border-collapse" style={{ minWidth: 1250 }} data-testid="ct-list">
                  <thead className="sticky top-0 z-[1]"><tr>{['Date', 'Line', 'Defect / reason', 'Dept.', 'Loop step', 'Next — what and who', 'Responsibility', 'Due', 'Late', 'Escalation', '', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {list.map((r) => {
                      const a = act(r);
                      return (
                        <tr key={r.key} className={r.esc === 3 ? 'bg-red-50' : r.late > 0 ? 'bg-amber-50/50' : ''} data-testid="ct-row">
                          <td className={`${td} whitespace-nowrap`}>{dmy(r.date)}</td>
                          <td className={`${td} whitespace-nowrap`}>Line {r.line}</td>
                          <td className={`${td} font-semibold`}>{r.reason}<div className="text-fs-11 font-normal text-slate-500">{KIND_LABEL[r.kind]} · {r.unit === 'min' ? `${Math.round(r.value)} min` : `${nf(r.value)} pcs`}{r.models?.length ? ` · ${r.models.slice(0, 2).join(', ')}` : ''}</div></td>
                          <td className={`${td} whitespace-nowrap`}>{r.dept}</td>
                          <td className={`${td} whitespace-nowrap`}><StageChip stage={r.stage} /></td>
                          <td className={td} style={{ minWidth: 220 }}>
                            <div>{r.next}</div>
                            {r.stage === 'verify' && r.after != null && <div className="text-fs-12 text-slate-500">After the action: <b className={r.after ? 'text-red-700' : 'text-emerald-700'}>{nf(r.after)} {r.unit}</b> in {r.daysAfter} day(s) · before {nf(r.before)}</div>}
                            {r.stage === 'back' && <div className="text-fs-12 font-semibold text-red-700">{nf(r.backQty)} {r.unit} again</div>}
                            {r.rec?.action && !['write'].includes(r.stage) && <div className="text-fs-12 text-slate-500"><b>Action:</b> {r.rec.action}</div>}
                          </td>
                          <td className={`${td} whitespace-nowrap`}>{r.rec?.owner || <span className="text-slate-400">—</span>}</td>
                          <td className={`${td} whitespace-nowrap`}>{r.due ? dmy(r.due) : '—'}</td>
                          <td className={`${td} whitespace-nowrap text-right font-mono font-bold ${r.late ? 'text-red-700' : 'text-slate-500'}`} data-testid="ct-late">{!STAGE_BY_ID[r.stage].open ? '—' : r.late ? `${r.late} d` : r.left != null ? `${r.left} d left` : ''}</td>
                          <td className={`${td} whitespace-nowrap`}>{r.esc ? <span className={`rounded px-1.5 py-0.5 text-fs-12 font-bold ${ESC_TONE[r.esc]}`}>{ESC[r.esc].name}</span> : <span className="text-fs-12 text-slate-400">—</span>}</td>
                          <td className={`${td} whitespace-nowrap p-1`}>
                            <button type="button" disabled={busy === r.key} onClick={a.on} data-testid="ct-act"
                              className={`h-8 rounded-lg px-2.5 text-fs-13 font-bold disabled:opacity-50 ${a.warn ? 'lp-amber-solid text-white' : a.main || a.label === 'Verify' ? 'bg-blue-700 text-white hover:bg-blue-800' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>{a.label}</button>
                          </td>
                          <td className={`${td} p-1`}><button type="button" onClick={() => openSheet(r.date, r.line, r.sheet)} title="Open the day's Daily CAPA sheet" aria-label={`Open the sheet of ${dmy(r.date)} line ${r.line}`} className="rounded p-1 text-blue-700 hover:bg-blue-50"><ExternalLink size={15} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="lp-ctrack-grid grid grid-cols-1 gap-3">
            <section className={card} aria-label="Day by line">
              <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Day × line — open / losses</h3>
              {!days.length ? <p className="text-fs-13 text-slate-600">Nothing in this month.</p> : (
                <div className="overflow-auto" style={{ maxHeight: 420 }}>
                  <table className="w-full border-collapse text-fs-13 tabular-nums" data-testid="ct-days">
                    <thead className="sticky top-0"><tr><th className={th}>Day</th>{lines.map((l) => <th key={l} className={`${th} text-center`}>Line {l}</th>)}</tr></thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d}>
                          <td className={`${td} whitespace-nowrap font-semibold`}>{dmy(d)}</td>
                          {lines.map((l) => {
                            const c = cell(d, l);
                            if (!c.n) return <td key={l} className={`${td} text-center text-slate-400`}>—</td>;
                            const tone = c.open === 0 ? 'bg-emerald-100 text-emerald-800' : c.write === c.n ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
                            return (
                              <td key={l} className={`${td} p-1 text-center`}>
                                <button type="button" onClick={() => openSheet(d, l, kind === 'idle' ? 'idle' : 'rework')} title={`${c.open} of ${c.n} still in the loop · ${c.write} without a CAPA${c.late ? ` · ${c.late} late` : ''} — open the sheet`}
                                  className={`w-full rounded-md px-2 py-1 font-mono font-bold ${tone} lp-ct-cell`}>{c.open}/{c.n}{c.late ? <span className="ml-1 text-red-700">!</span> : null}</button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-fs-12 text-slate-500"><span className="rounded bg-emerald-100 px-1 text-emerald-800">green</span> nothing open · <span className="rounded bg-amber-100 px-1 text-amber-800">amber</span> in the loop · <span className="rounded bg-red-100 px-1 text-red-800">red</span> no CAPA written · ! late · click to open the day&apos;s sheet</p>
            </section>

            <section className={card} aria-label="Responsibility">
              <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Responsibility — who has what</h3>
              {!owners.length ? <p className="text-fs-13 text-slate-600">No action written yet.</p> : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {owners.map((o) => (
                    <div key={o.owner} className={`rounded-lg border p-2.5 ${o.esc3 ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                      <div className="truncate text-fs-14 font-bold text-slate-900" title={o.owner}>{o.owner}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-fs-13"><span><b className="font-mono">{o.open}</b> open</span><span className={o.late ? 'text-red-700' : 'text-slate-500'}><b className="font-mono">{o.late}</b> late</span>{o.esc3 > 0 && <span className="font-bold text-red-700">{o.esc3} at plant head</span>}<span className="text-emerald-700"><b className="font-mono">{o.done}</b> verified</span></div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
      {dlg?.type === 'rca' && <RcaDialog i={dlg.r} x={dlg.r.rec} canWrite={canWrite(dlg.r)} isAdmin={isAdmin} onClose={() => setDlg(null)} onSaved={async () => { setDlg(null); await reload(); }} />}
      {dlg?.type === 'verify' && (
        <VerifyDialog r={{ ...dlg.r.rec, dept: dlg.r.dept, unit: dlg.r.unit, before: dlg.r.before, after: dlg.r.after, daysAfter: dlg.r.daysAfter, closeDate: dlg.r.rec?.closeDate || dlg.r.done }}
          onClose={() => setDlg(null)} onSaved={async () => { setDlg(null); await reload(); }} onPdf={async (x) => { try { downloadBlob(await capaPdf([x], capaHead(savedUi().capa), api.fileUrl), capaFileName(x)); } catch (e) { setMsg({ bad: true, text: `PDF could not be made: ${e.message}` }); } }} />)}
    </div>
  );
}
