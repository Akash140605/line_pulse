/**
 * 27-11-2026: Daily CAPA sheet — one day, one line, as the plant's daily sheet.
 *   kind 'rework' : the top 5 defects of the day (rework + rejection, pieces). When the day's RTY is under 97 %
 *                   the sheet is marked "CAPA needed".
 *   kind 'idle'   : the top 5 idle time reasons of the day (minutes).
 * Every row: department (never empty), 6M category, root cause, corrective action, preventive action, responsibility,
 * target date and status — saved as the RCA of that loss (same record as RCA Entry, so the RCA dashboard and the
 * CAPA register see it). Cause / action typed on the rework grid start the row.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Printer, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import HeaderBar, { fieldCls } from '../components/HeaderBar';
import { api } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, normEntry, rcaStatus, qualityOf } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { RCA_CATS, RCA_CAT_HINT, guessRcaCat, deptOfRow } from '../utils/deptRules';
import { nf, dmy, card, StatusChip, useOleLines, useOleData } from '../components/OleParts';
import { exportPanel } from '../utils/domExcel';

const RTY_MIN = 0.97;
const TOP = 5;
const tidy = (s) => String(s ?? '').trim();
const pc = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);

/** the day's top reasons of a line: rework + rejection (pcs) or idle time (min), with stages, models and what the grid already says */
function topOf(rows, kind, limit = TOP) {
  const m = new Map();
  for (const r of rows || []) {
    const e = r.e || normEntry(r.entry);
    const lists = kind === 'idle' ? [[e.losses, 'loss', 'min'], [e.stops, 'stop', 'min']] : [[e.rework, 'rework', 'qty'], [e.rejects, 'reject', 'qty']];   // idle time = stoppage + loss minutes (as the Availability pages)
    for (const [list, k, num] of lists) {
      for (const x of list || []) {
        const v = Number(x[num]) || 0; if (!(v > 0)) continue;
        const reason = tidy(x.reason) || 'Not given';
        const key = `${k}|${reason}`;
        const o = m.get(key) || { kind: k, reason, value: 0, dis: 0, hours: new Set(), stages: new Set(), models: new Map(), cause: '', action: '', dept: '', cat: '' };
        o.value += v; o.dis += Number(x.dismantle) || 0; o.hours.add(r.hour);
        if (x.station) o.stages.add(x.station);
        if (x.model) o.models.set(x.model, (o.models.get(x.model) || 0) + v);
        if (!o.cause && tidy(x.cause)) o.cause = tidy(x.cause);
        if (!o.action && tidy(x.action)) o.action = tidy(x.action);
        if (!o.dept) o.dept = deptOfRow(x, k, deptName);
        if (!o.cat && x.cat) o.cat = x.cat;
        m.set(key, o);
      }
    }
  }
  return [...m.values()].sort((a, b) => b.value - a.value).slice(0, limit || undefined);
}

export default function DailyCapaPage({ kind = 'rework', isAdmin = true, myDept = '' }) {
  const IDS = useOleLines();
  const today = serverToday();
  const [date, setDate] = useState(today);
  const [line, setLine] = useState(IDS[0] || '1');
  useEffect(() => { if (!IDS.includes(line)) setLine(IDS[0]); }, [IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start: date, end: date, ids: IDS });
  const day = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: date, end: date, today, nowMin: D.endMin, ids: IDS }).days?.[0] : null),
    [D.al, settings, D.ent.entries, date, today, D.endMin, IDS]);
  const rows = day?.byLine?.[line]?.rows || [];
  // 27-11-2026: every defect / reason of the day by default; Top 5 on a click
  const [all, setAll] = useState(true);
  const top = useMemo(() => topOf(rows, kind, all ? 0 : TOP), [rows, kind, all]);
  const Q = useMemo(() => (kind === 'rework' ? qualityOf(rows, D.ent.reasons.station || []) : null), [rows, kind, D.ent.reasons]);
  const made = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const lowRty = Q?.rty != null && Q.rty < RTY_MIN;
  const rcaKey = (t) => `${date}|${line}|${t.kind}|${t.reason}`;

  // the form: one entry per top row, from the saved RCA, else from the grid's cause / action and the guesses
  const [f, setF] = useState({});
  useEffect(() => {
    const o = {};
    for (const t of top) {
      const x = D.ent.rca?.[rcaKey(t)] || null;
      o[rcaKey(t)] = {
        cat: x?.cat || guessRcaCat(t.reason, t.dept), rootCause: x?.rootCause || t.cause, action: x?.action || t.action, preventive: x?.preventive || '',
        owner: x?.owner || '', targetDate: x?.targetDate || '', status: x ? rcaStatus(x) : 'pending', saved: !!x, dirty: false,
      };
    }
    setF(o);
  }, [top.map((t) => rcaKey(t)).join(), D.ent.rca]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, field, v) => setF((o) => ({ ...o, [k]: { ...o[k], [field]: v, dirty: true } }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const sameDept = (a, b) => deptName(a).toLowerCase() === deptName(b).toLowerCase();
  const canWrite = (t) => isAdmin || (myDept && sameDept(myDept, t.dept));
  const dirty = top.filter((t) => f[rcaKey(t)]?.dirty && canWrite(t));
  const save = async (close = false) => {
    setMsg(null);
    const items = [], skipped = [];
    for (const t of (close ? top : dirty)) {
      const r = f[rcaKey(t)]; if (!r || !canWrite(t)) continue;
      if (!tidy(r.rootCause)) { if (r.dirty) skipped.push(t.reason); continue; }
      items.push({ date, line: Number(line), kind: t.kind, reason: t.reason, cat: r.cat, rootCause: tidy(r.rootCause), action: tidy(r.action), preventive: tidy(r.preventive),
        owner: tidy(r.owner), targetDate: r.targetDate, status: close && tidy(r.action) ? 'closed' : (r.status === 'closed' ? 'closed' : 'submitted') });
    }
    if (!items.length) { setMsg({ bad: true, text: skipped.length ? `Write the root cause first: ${skipped.join(', ')}` : 'Nothing changed.' }); return; }
    setBusy(true);
    try {
      await api.saveRca(items);
      setMsg({ bad: false, text: `${items.length} saved as RCA${skipped.length ? ` · without a root cause, not saved: ${skipped.join(', ')}` : ''}` });
      D.reloadEnt?.();
    } catch (e) { setMsg({ bad: true, text: e?.message || 'Could not save.' }); }
    setBusy(false);
  };

  const bodyRef = useRef(null);
  const title = kind === 'rework' ? 'Daily CAPA sheet — Rework / Rejection' : 'Daily CAPA sheet — Idle time';
  const th = 'border border-slate-300 bg-[#DCE6F2] px-1.5 py-1.5 text-left text-fs-12 font-bold text-[#1F3864] whitespace-nowrap';
  const td = 'border border-slate-200 px-1 py-1 align-top';
  const inp = 'w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-fs-13 focus:border-blue-500 focus:outline-none disabled:bg-slate-50';
  const unit = kind === 'rework' ? 'pcs' : 'min';
  const total = top.reduce((a, t) => a + t.value, 0);

  return (
    <div className="flex flex-col gap-3" data-testid={`daily-capa-${kind}`}>
      <HeaderBar label="Daily CAPA filters">
        <input type="date" aria-label="Day" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={fieldCls} />
        <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Line">
          {IDS.map((l) => <button key={l} type="button" aria-pressed={line === l} onClick={() => setLine(l)} className={`h-9 px-3 text-fs-13 font-bold ${line === l ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>Line {l}</button>)}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Rows">
          {[[true, 'All'], [false, `Top ${TOP}`]].map(([v, t]) => <button key={t} type="button" aria-pressed={all === v} data-testid={`capa-${v ? 'all' : 'top'}`} onClick={() => setAll(v)} className={`h-9 px-3 text-fs-13 font-bold ${all === v ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{t}</button>)}
        </div>
        <div className="ml-auto flex gap-2 no-print">
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-100"><Printer size={15} />Print</button>
          <button type="button" onClick={() => exportPanel(bodyRef.current, title, `Line ${line} · ${dmy(date)}`)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-100"><FileSpreadsheet size={15} />Excel</button>
        </div>
      </HeaderBar>

      <div ref={bodyRef} className="flex flex-col gap-3">
        <section className={card} aria-label="Sheet head">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div><div className="text-fs-18 font-extrabold text-[#1F3864]">{title}</div><div className="text-fs-13 text-slate-600">Line {line} · {dmy(date)} · {all ? `all ${top.length}` : `top ${TOP}`} {kind === 'rework' ? 'defects' : 'idle reasons'} of the day</div></div>
            {kind === 'rework' ? (<>
              <div className="text-fs-13"><span className="text-slate-500">Made</span> <b className="font-mono">{nf(made)}</b></div>
              <div className="text-fs-13"><span className="text-slate-500">Rework + rejection</span> <b className="font-mono text-red-700">{nf(Q ? Q.rej + Q.rwk : 0)}</b></div>
              <div className="text-fs-13"><span className="text-slate-500">RTY</span> <b className={`font-mono ${lowRty ? 'text-red-700' : 'text-emerald-700'}`}>{pc(Q?.rty)}</b> <span className="text-slate-500">(min {RTY_MIN * 100}%)</span></div>
            </>) : <div className="text-fs-13"><span className="text-slate-500">Idle time{all ? '' : ` (top ${TOP})`}</span> <b className="font-mono text-red-700">{hm(total)}</b></div>}
            {kind === 'rework' && Q?.rty != null && (lowRty
              ? <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-fs-13 font-bold text-white" data-testid="rty-low"><AlertTriangle size={15} />RTY under 97% — CAPA needed</span>
              : <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-fs-13 font-bold text-white"><CheckCircle2 size={15} />RTY 97% or more</span>)}
          </div>
        </section>

        {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
        {!D.al && !D.err && <div className={`${card} text-fs-14 font-semibold text-slate-500`}>Reading the day …</div>}
        {D.al && !top.length && <div className={`${card} text-fs-14 font-semibold text-slate-600`}>No {kind === 'rework' ? 'rework or rejection' : 'idle time'} written for Line {line} on {dmy(date)}.</div>}

        {top.length > 0 && (
          <section className={`${card} overflow-x-auto`} aria-label="CAPA rows">
            <table className="w-full border-collapse" style={{ minWidth: 1250 }} data-testid="capa-table">
              <thead><tr>{['#', kind === 'rework' ? 'Defect' : 'Reason', 'Qty', kind === 'rework' ? 'Stage · models' : 'Models · hours', 'Department', 'Category (6M)', 'Root cause', 'Corrective action', 'Preventive action', 'Responsibility', 'Target date', 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {top.map((t, i) => {
                  const k = rcaKey(t), r = f[k] || {}, can = canWrite(t);
                  return (
                    <tr key={k} className={i % 2 ? 'bg-slate-50/60' : ''} data-testid="capa-row">
                      <td className={`${td} text-center font-mono text-fs-13 text-slate-500`}>{i + 1}</td>
                      <td className={`${td} min-w-[150px]`}><div className="text-fs-13 font-bold text-slate-900">{t.reason}</div><div className="text-fs-11 font-semibold uppercase text-slate-500">{t.kind === 'reject' ? 'Rejection' : t.kind === 'rework' ? 'Rework' : t.kind === 'stop' ? 'Stoppage' : 'Idle time'}</div></td>
                      <td className={`${td} whitespace-nowrap text-right font-mono text-fs-14 font-extrabold text-red-700`}>{unit === 'min' ? hm(t.value) : `${nf(t.value)} pcs`}{t.dis > 0 && <div className="text-fs-11 font-semibold text-slate-500">{t.dis} dism.</div>}</td>
                      <td className={`${td} min-w-[170px] text-fs-12 text-slate-700`}>
                        {t.stages.size > 0 && <div className="font-semibold">{[...t.stages].join(', ')}</div>}
                        {[...t.models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, v]) => <div key={m} className="font-mono">{m} <span className="text-slate-500">{v}</span></div>)}
                        <div className="text-slate-500">{[...t.hours].sort((a, b) => a - b).map((h) => `${String(h).padStart(2, '0')}`).join(', ')} h</div>
                      </td>
                      <td className={`${td} whitespace-nowrap text-fs-13 font-semibold`}>{t.dept}</td>
                      <td className={`${td} min-w-[120px]`}>
                        <select aria-label={`Row ${i + 1} category`} disabled={!can} value={r.cat || ''} title={RCA_CAT_HINT[r.cat] || ''} onChange={(e) => set(k, 'cat', e.target.value)} className={inp}>
                          {RCA_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      {['rootCause', 'action', 'preventive'].map((fl) => (
                        <td key={fl} className={`${td} min-w-[170px]`}><textarea aria-label={`Row ${i + 1} ${fl}`} disabled={!can} rows={2} maxLength={1000} value={r[fl] || ''} onChange={(e) => set(k, fl, e.target.value)}
                          placeholder={fl === 'rootCause' ? 'Why did it happen?' : fl === 'action' ? 'What was done / will be done' : 'So it does not come again'} className={`${inp} ${fl === 'rootCause' && r.dirty && !tidy(r.rootCause) ? 'border-red-500 bg-red-50' : ''}`} /></td>))}
                      <td className={`${td} min-w-[120px]`}><input aria-label={`Row ${i + 1} responsibility`} disabled={!can} maxLength={60} value={r.owner || ''} onChange={(e) => set(k, 'owner', e.target.value)} placeholder="Name" className={inp} /></td>
                      <td className={td} style={{ minWidth: 130 }}><input type="date" aria-label={`Row ${i + 1} target date`} disabled={!can} value={r.targetDate || ''} onChange={(e) => set(k, 'targetDate', e.target.value)} className={inp} /></td>
                      <td className={`${td} whitespace-nowrap`}>{r.dirty ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-fs-12 font-bold text-amber-800">not saved</span> : <StatusChip st={r.status || 'pending'} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
              <button type="button" disabled={busy || !dirty.length} onClick={() => save(false)} data-testid="capa-save" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-800 px-4 text-fs-14 font-bold text-white hover:bg-blue-900 disabled:opacity-50"><Save size={16} />Save sheet{dirty.length ? ` (${dirty.length})` : ''}</button>
              {isAdmin && <button type="button" disabled={busy} onClick={() => save(true)} className="h-10 rounded-lg bg-slate-800 px-4 text-fs-14 font-bold text-white disabled:opacity-50">Save &amp; close the rows with an action</button>}
              {msg && <span role="status" className={`text-fs-13 font-semibold ${msg.bad ? 'text-red-700' : 'text-emerald-700'}`}>{msg.text}</span>}
              <span className="ml-auto text-fs-12 text-slate-500">Saved as the RCA of each {kind === 'rework' ? 'defect' : 'reason'} — the RCA dashboard and the CAPA register show it too.</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
