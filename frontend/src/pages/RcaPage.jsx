import HeaderBar, { fieldCls } from '../components/HeaderBar';
import MesDrawer from '../components/MesDrawer';
import Evidence from '../components/Evidence';
import React, { useEffect, useMemo, useState } from 'react';
import { Save, X, Wrench, FileDown } from 'lucide-react';
import { capaHead, capaPdf, capaFileName, downloadBlob, EMPTY_CAPA } from '../utils/capaForm';
import { savedUi } from '../hooks/useUiSettings';
import { api } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, issuesOf, rcaStatus, KIND_TEXT, needsRca, RCA_FROM } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { nf, dmy, p2, inp, card, StatusChip, useOleLines, monthOf, monthRange, useOleData } from '../components/OleParts';

/**
 * RCA — every loss (one reason of planned stoppage / unplanned loss / rejection / rework on one line and day) goes to the department of its reason.
 * The department writes the root cause, corrective and preventive action, owner and target date, then submits; it is
 * closed when the action is done. Who writes: the admin, and logins of that department (Users and passwords → Department).
 */
// one department under one name (Maint = Maintenance, Prod = Production …): no double tabs
const same = (a, b) => deptName(a).toLowerCase() === deptName(b).toLowerCase();

export default function RcaPage({ isAdmin = false, myDept = '' }) {
  const IDS = useOleLines();
  const today = serverToday();
  const [month, setMonth] = useState(monthOf(today));
  const range = monthRange(month, today);
  const settings = useAllLineSettings(IDS);
  const [open, setOpen] = useState(null);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS, paused: !!open });
  // 23-11-2026: RCAs start on RCA_FROM; the older ones are kept (records untouched) and shown with "Older RCAs"
  const [old, setOld] = useState(false);
  const issues = useMemo(() => (D.al ? issuesOf(oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }).days)
    .filter((i) => (old ? i.kind !== 'stop' && i.date < RCA_FROM : needsRca(i))) : []),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, IDS, old]);
  const depts = useMemo(() => [...new Set(issues.map((i) => deptName(i.dept)).filter(Boolean))].sort(), [issues]);
  const [dept, setDept] = useState(myDept || 'all');
  const [status, setStatus] = useState('pending');
  const canWrite = (i) => isAdmin || (myDept && same(myDept, i.dept));
  const shown = issues.filter((i) => (dept === 'all' || same(i.dept, dept)) && (status === 'all' || rcaStatus(D.ent.rca[i.key]) === status));
  const count = (st) => issues.filter((i) => (dept === 'all' || same(i.dept, dept)) && (st === 'all' || rcaStatus(D.ent.rca[i.key]) === st)).length;
  const btn = (on) => `h-9 px-3 text-fs-13 font-semibold border-r last:border-r-0 border-slate-300 whitespace-nowrap ${on ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
  return (
    <div className="flex flex-col gap-4">
      <HeaderBar label="RCA filters">
        <input type="month" aria-label="Choose month" max={monthOf(today)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
        {range.start < RCA_FROM && (
          <button type="button" aria-pressed={old} onClick={() => setOld((v) => !v)} title={`RCAs start on ${RCA_FROM.split('-').reverse().join('-')}; the losses before it are kept and can be seen here`}
            className={`h-9 rounded-lg border px-3 text-fs-13 font-bold whitespace-nowrap ${old ? 'border-amber-600 bg-amber-100 text-amber-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}>
            {old ? `Showing older RCAs (before ${RCA_FROM.slice(8, 10)}-${RCA_FROM.slice(5, 7)}) — back to current` : `Older RCAs (before ${RCA_FROM.slice(8, 10)}-${RCA_FROM.slice(5, 7)})`}
          </button>
        )}
        {myDept && <span className="whitespace-nowrap text-fs-13 font-semibold text-slate-600">You write for <b>{myDept}</b></span>}
      </HeaderBar>
      <section className={card} aria-label="RCA">
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Department">
            {['all', ...depts.filter((d) => !same(d, 'all'))].map((d) => <button key={d} type="button" aria-pressed={same(dept, d)} onClick={() => setDept(d)} className={btn(same(dept, d))}>{d === 'all' ? 'All departments' : d}</button>)}
            {myDept && !depts.some((d) => same(d, myDept)) && <button type="button" aria-pressed={same(dept, myDept)} onClick={() => setDept(myDept)} className={btn(same(dept, myDept))}>{myDept}</button>}
          </div>
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-300" role="group" aria-label="Status">
            {[['pending', 'RCA pending'], ['submitted', 'Submitted'], ['closed', 'Closed'], ['all', 'All']].map(([k, t]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={btn(status === k)}>{t} <span className="opacity-70">({count(k)})</span></button>)}
          </div>
        </div>
      </section>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!D.al && !D.err && <div className={`${card} text-fs-14 font-semibold text-slate-500`}>Reading the losses …</div>}
      {D.al && (
        <section className={card} aria-label="Losses for RCA">
          {!shown.length ? <p className="text-fs-14 text-slate-500">Nothing here{status === 'pending' ? ' — no RCA pending' : ''}.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-fs-13 tabular-nums" aria-label="RCA list">
                <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Date', 'Line', 'Loss', 'Reason', 'Department', 'Amount', 'Hours', 'Models', 'Status', 'Root cause / action', ''].map((h, i) => <th key={i} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((i) => {
                    const x = D.ent.rca[i.key]; const st = rcaStatus(x);
                    return (
                      <tr key={i.key} className="border-b border-slate-100 align-top" aria-label={`RCA ${dmy(i.date)} Line ${i.line} ${i.reason}`}>
                        <td className="px-2 py-2 font-bold whitespace-nowrap">{dmy(i.date)}</td>
                        <td className="px-2 py-2 whitespace-nowrap">Line {i.line}</td>
                        <td className="px-2 py-2">{KIND_TEXT[i.kind]}</td>
                        <td className="px-2 py-2 font-bold text-slate-900">{i.reason}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{deptName(i.dept)}</td>
                        <td className="px-2 py-2 font-mono font-bold whitespace-nowrap">{nf(i.value)} {i.unit}</td>
                        <td className="px-2 py-2 font-mono whitespace-nowrap">{[...i.hours].sort((a, b) => a - b).map((h) => `${p2(h)}`).join(', ')}</td>
                        <td className="px-2 py-2">{i.models.join(', ') || '—'}</td>
                        <td className="px-2 py-2"><StatusChip st={st} /></td>
                        <td className="px-2 py-2 text-fs-13 text-slate-700 min-w-[200px]">{x ? <><b>Cause:</b> {x.rootCause}{x.action && <><br /><b>Action:</b> {x.action}</>}{(x.owner || x.targetDate || x.closeDate) && <div className="text-slate-500">{x.owner}{x.targetDate ? ` · by ${dmy(x.targetDate)}` : ''}{x.closeDate ? ` · closed ${dmy(x.closeDate)}` : ''}</div>}{x.evidence?.length > 0 && <div className="font-semibold text-blue-800">📎 {x.evidence.length} evidence</div>}</> : '—'}</td>
                        <td className="px-2 py-1.5">
                          <button type="button" onClick={() => setOpen(i)} aria-label={`${canWrite(i) ? (x ? 'Edit' : 'Write') : 'View'} RCA ${dmy(i.date)} Line ${i.line} ${i.reason}`}
                            className={`h-8 rounded-lg px-2.5 text-fs-13 font-bold whitespace-nowrap ${canWrite(i) && !x ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-800'}`}>{canWrite(i) ? (x ? 'Edit RCA' : 'Write RCA') : 'View'}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {open && <RcaDialog i={open} x={D.ent.rca[open.key]} canWrite={canWrite(open)} isAdmin={isAdmin} onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await D.reloadEnt(); }} />}
    </div>
  );
}

export function RcaDialog({ i, x, canWrite, isAdmin, onClose, onSaved }) {
  const head = useMemo(() => capaHead(savedUi().capa), []);
  const [f, setF] = useState({ rootCause: x?.rootCause || '', whys: [0, 1, 2, 3, 4].map((k) => x?.whys?.[k] || ''), action: x?.action || '', preventive: x?.preventive || '', owner: x?.owner || '', targetDate: x?.targetDate || '', closeDate: x?.closeDate || '', status: x?.status || 'submitted', evidence: x?.evidence || [],
    // 24-11-2026: the paper CAPA form (Corrective and Preventive Action Plan)
    capa: { ...EMPTY_CAPA, hall: head.hall, ...(x?.capa || {}), whyQ: [0, 1, 2, 3, 4].map((k) => x?.capa?.whyQ?.[k] || '') } });
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const setC = (k, v) => setF((o) => ({ ...o, capa: { ...o.capa, [k]: v } }));
  const record = () => ({ ...(x || {}), date: i.date, line: Number(i.line), kind: i.kind, reason: i.reason, dept: i.dept || x?.dept, ...f, whys: f.whys.map((w) => w.trim()) });
  const save = async (status) => {
    setErr('');
    // 20-11-2026: 5-Why — the last why written is the root cause when the box is left empty
    const lastWhy = [...f.whys].reverse().find((w) => w.trim()) || '';
    const rootCause = f.rootCause.trim() || lastWhy.trim();
    if (!rootCause) { setErr('Write the root cause (or the 5 whys).'); return; }
    if (status === 'closed' && !f.action.trim()) { setErr('Write the corrective action before closing.'); return; }
    setBusy(true);
    try { await api.saveRca([{ date: i.date, line: Number(i.line), kind: i.kind, reason: i.reason, ...f, rootCause, whys: f.whys.map((w) => w.trim()), evidence: f.evidence.map((e) => ({ id: e.id })), closeDate: status === 'closed' ? (f.closeDate || serverToday()) : '', status }]); onSaved(); }
    catch (e) { setErr(`Could not save: ${e.message}`); setBusy(false); }
  };
  const pdf = async () => {
    setPdfBusy(true); setErr('');
    try { const r = record(); downloadBlob(await capaPdf([r], head, api.fileUrl), capaFileName(r)); }
    catch (e) { setErr(`PDF could not be made: ${e.message}`); } finally { setPdfBusy(false); }
  };
  const ta = `${inp} h-auto min-h-[56px] py-1.5`;
  const L = 'grid gap-1 text-fs-13 font-bold text-slate-700';
  const sec = 'grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5';
  const leg = 'px-1 text-fs-13 font-extrabold text-[#1F3864]';
  const hrs = [...(i.hours || [])].sort((a, b) => a - b);
  return (
    <MesDrawer title={<>{KIND_TEXT[i.kind]} · {i.reason}{i.value != null ? <> — {nf(i.value)} {i.unit}</> : null}</>}
      sub={<>Line {i.line} · {dmy(i.date)}{hrs.length ? <> · {hrs.length > 1 ? 'Hours' : 'Hour'} {hrs.map((h) => `${p2(h)}–${p2(h + 1)}`).join(', ')}</> : null}{i.models?.length ? ` · ${i.models.join(', ')}` : ''} · <b>{deptName(i.dept || x?.dept)}</b></>}
      icon={Wrench} onClose={onClose} label="RCA" method="center" width={58} canExpand={false}>
        <div className="p-4 grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-fs-13 text-slate-600">
            {x && <><StatusChip st={rcaStatus(x)} /> by {x.updatedBy} · {x.updatedAt}{x.closedBy ? ` · closed by ${x.closedBy}` : ''}</>}
            <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-fs-12 font-semibold text-slate-600">{head.title} · Doc {head.docNo}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={L}>Equipment<input disabled={!canWrite} className={inp} value={f.capa.equip} maxLength={80} onChange={(e) => setC('equip', e.target.value)} placeholder="Machine / station" aria-label="Equipment" /></label>
            <label className={L}>Hall no.<input disabled={!canWrite} className={inp} value={f.capa.hall} maxLength={40} onChange={(e) => setC('hall', e.target.value)} aria-label="Hall no" /></label>
            <label className={L}>Date<input disabled className={inp} value={dmy(i.date)} aria-label="Date" /></label>
          </div>
          <label className={L}>Identification of problem<textarea disabled={!canWrite} className={ta} value={f.capa.problem} maxLength={1000} onChange={(e) => setC('problem', e.target.value)} placeholder={`${KIND_TEXT[i.kind]}: ${i.reason} — Line ${i.line}, ${dmy(i.date)} (written like this when left empty)`} aria-label="Identification of problem" /></label>
          <label className={L}>Correction <span className="font-normal text-slate-500">(done at once, on the spot)</span><textarea disabled={!canWrite} className={ta} value={f.capa.correction} maxLength={1000} onChange={(e) => setC('correction', e.target.value)} aria-label="Correction" /></label>
          <fieldset className={sec} aria-label="Why-why analysis">
            <legend className={leg}>Why-why analysis</legend>
            {f.whys.map((w, k) => (
              <div key={k} className="grid items-center gap-1.5" style={{ gridTemplateColumns: '52px minmax(0,1fr) 32px minmax(0,1fr)' }}>
                <span className="text-fs-13 font-extrabold text-[#1F3864]">Why {k + 1}</span>
                <input disabled={!canWrite} className={inp} value={f.capa.whyQ[k]} maxLength={300} aria-label={`Why ${k + 1} question`} placeholder={k === 0 ? 'Why did it happen?' : `Why? (from answer ${k})`}
                  onChange={(e) => setF((o) => ({ ...o, capa: { ...o.capa, whyQ: o.capa.whyQ.map((v, j) => (j === k ? e.target.value : v)) } }))} />
                <span className="text-fs-13 font-bold text-slate-600">Ans.</span>
                <input disabled={!canWrite} className={inp} value={w} maxLength={300} aria-label={`Why ${k + 1} answer`} placeholder="Answer"
                  onChange={(e) => setF((o) => ({ ...o, whys: o.whys.map((v, j) => (j === k ? e.target.value : v)) }))} />
              </div>
            ))}
          </fieldset>
          <label className={L}>Root cause <span className="font-normal text-slate-500">(the last answer if left empty)</span><textarea disabled={!canWrite} className={ta} value={f.rootCause} onChange={(e) => set('rootCause', e.target.value)} maxLength={1000} aria-label="Root cause" /></label>
          <fieldset className={sec} aria-label="Implementation of action plan">
            <legend className={leg}>Implementation of action plan</legend>
            <label className={L}>Corrective action<textarea disabled={!canWrite} className={ta} value={f.action} onChange={(e) => set('action', e.target.value)} maxLength={1000} aria-label="Corrective action" /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={L}>Target date<input type="date" disabled={!canWrite} className={inp} value={f.targetDate} onChange={(e) => { set('targetDate', e.target.value); setC('caTarget', e.target.value); }} aria-label="Corrective action target date" /></label>
              <label className={L}>Responsibility<input disabled={!canWrite} className={inp} value={f.owner} maxLength={60} onChange={(e) => { set('owner', e.target.value); setC('caResp', e.target.value); }} aria-label="Corrective action responsibility" /></label>
            </div>
            <label className={L}>Preventive action <span className="font-normal text-slate-500">(so it does not come again)</span><textarea disabled={!canWrite} className={ta} value={f.preventive} onChange={(e) => set('preventive', e.target.value)} maxLength={1000} aria-label="Preventive action" /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={L}>Target date<input type="date" disabled={!canWrite} className={inp} value={f.capa.paTarget} onChange={(e) => setC('paTarget', e.target.value)} aria-label="Preventive action target date" /></label>
              <label className={L}>Responsibility<input disabled={!canWrite} className={inp} value={f.capa.paResp} maxLength={80} onChange={(e) => setC('paResp', e.target.value)} aria-label="Preventive action responsibility" /></label>
            </div>
          </fieldset>
          <fieldset className={sec} aria-label="Verification">
            <legend className={leg}>Verification of implemented action plan</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={L}>Implemented
                <select disabled={!canWrite} className={inp} value={f.capa.implemented} onChange={(e) => setC('implemented', e.target.value)} aria-label="Implemented">
                  <option value="">— not checked yet</option><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option>
                </select></label>
              <label className={L}>Verified by (sign)<input disabled={!canWrite} className={inp} value={f.capa.verifiedBy} maxLength={80} onChange={(e) => setC('verifiedBy', e.target.value)} aria-label="Verified by" /></label>
              <label className={L}>Verified on<input type="date" disabled={!canWrite} className={inp} value={f.capa.verifyDate} max={serverToday()} onChange={(e) => setC('verifyDate', e.target.value)} aria-label="Verified on" /></label>
            </div>
            <label className={L}>Verification note<input disabled={!canWrite} className={inp} value={f.capa.verifyNote} maxLength={300} onChange={(e) => setC('verifyNote', e.target.value)} aria-label="Verification note" /></label>
          </fieldset>
          <label className={L} style={{ maxWidth: 260 }}>Close date <span className="font-normal text-slate-500">(when closed; today if empty)</span><input type="date" disabled={!canWrite} className={inp} value={f.closeDate} max={serverToday()} onChange={(e) => set('closeDate', e.target.value)} aria-label="Close date" /></label>
          <Evidence list={f.evidence} canEdit={canWrite} onChange={(l) => set('evidence', l)} />
          {err && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" disabled={pdfBusy} onClick={pdf} className="mr-auto inline-flex h-10 items-center gap-1.5 rounded-lg border bg-white px-4 text-fs-14 font-bold text-red-700 hover:bg-red-50 disabled:opacity-60" style={{ borderColor: '#B91C1C' }} title="The CAPA form as a PDF, with the evidence photos"><FileDown size={15} aria-hidden />{pdfBusy ? 'Making PDF…' : 'PDF'}</button>
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700">{canWrite ? 'Cancel' : 'Close'}</button>
            {canWrite && <>
              <button type="button" disabled={busy} onClick={() => save('submitted')} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white disabled:opacity-60"><Save size={15} aria-hidden /> Save RCA</button>
              <button type="button" disabled={busy} onClick={() => save('closed')} className="h-10 rounded-lg bg-slate-800 px-4 text-fs-14 font-bold text-white disabled:opacity-60">Save &amp; close RCA{isAdmin ? '' : ' (action done)'}</button>
            </>}
          </div>
        </div>
    </MesDrawer>
  );
}
