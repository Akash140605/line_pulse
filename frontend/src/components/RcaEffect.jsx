import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { KIND_TEXT } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { rcaEffect, effectTotals, EFFECT_STATUS, addDaysYmd } from '../utils/rcaEffect';

/**
 * 20-11-2026: RCA action effectiveness (RCA dashboard) — for every reason with an RCA action: the loss per working day
 * before the first action and after the last one, how often an action was taken, and whether it worked.
 * Reads the loss / quality entries of the look-back period (the app's own store, ole.php) — no scan data.
 * Formulas: utils/rcaEffect.js.
 */
const dmy = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '');
const th = 'border border-[#BFBFBF] px-2 py-1.5';
const td = 'border border-[#D4D4D4] px-2 py-1.5';
const num = (v, unit) => (v == null ? '—' : `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${unit}`);

/** daily loss as small bars, the action days marked */
function Spark({ daily, from, to, actions }) {
  const days = []; for (let d = from; d <= to && days.length < 400; d = addDaysYmd(d, 1)) days.push(d);
  const m = new Map(daily); const max = Math.max(1, ...daily.map(([, v]) => v));
  const W = 150, H = 30, bw = W / Math.max(1, days.length);
  const marks = new Set(actions.map((a) => a.at));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Loss per day, action days marked" className="block">
      {days.map((d, i) => {
        const v = m.get(d) || 0; const h = v ? Math.max(2, (v / max) * (H - 4)) : 0;
        return <React.Fragment key={d}>
          {marks.has(d) && <rect x={i * bw} y={0} width={Math.max(1.5, bw)} height={H} fill="#2563EB" opacity="0.85" />}
          {h > 0 && <rect x={i * bw + 0.2} y={H - h} width={Math.max(1, bw - 0.4)} height={h} fill="#C2410C" opacity="0.8" />}
        </React.Fragment>;
      })}
    </svg>
  );
}

export default function RcaEffect({ ids, dept = null, today }) {
  const [back, setBack] = useState(90);
  const [win, setWin] = useState(14);
  const [byLine, setByLine] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const start = addDaysYmd(today, -(back - 1));
  useEffect(() => {
    let live = true; setErr('');
    api.oleEntries(start, today).then((j) => { if (live) setData({ entries: j?.entries || {}, rca: j?.rca || {} }); }, (e) => { if (live) setErr(String(e.message || e)); });
    return () => { live = false; };
  }, [start, today]);
  const rows = useMemo(() => (data ? rcaEffect({ entries: data.entries, rca: data.rca, start, end: today, ids, win, byLine }) : null), [data, start, today, ids.join(), win, byLine]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (rows || []).filter((r) => !dept || deptName(r.dept) === dept);
  const T = effectTotals(shown);
  const stuck = shown.filter((r) => r.status === 'not' && r.nActions >= 2);
  const seg = (on) => `h-8 border-r border-slate-300 px-2.5 text-fs-13 font-bold last:border-r-0 ${on ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-slate-50'}`;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-label="RCA action effectiveness">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="lp-caps mr-auto border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Action effectiveness — does the loss go down after the action?</h3>
        <div className="flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Look back">
          {[60, 90, 180].map((n) => <button key={n} type="button" aria-pressed={back === n} onClick={() => setBack(n)} className={seg(back === n)}>{n} days</button>)}
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Days compared before and after">
          {[7, 14, 30].map((n) => <button key={n} type="button" aria-pressed={win === n} onClick={() => setWin(n)} className={seg(win === n)}>±{n} d</button>)}
        </div>
        <label className="inline-flex items-center gap-1.5 text-fs-13 font-semibold text-slate-700"><input type="checkbox" checked={byLine} onChange={(e) => setByLine(e.target.checked)} className="h-4 w-4" /> Each line apart</label>
      </div>
      <p className="mb-2 text-fs-13 text-slate-600">Loss per working day of the reason in the {win} days before the first action and after the last one (action date = close date; an open action: the day it was written). Effective = at most half; partly = 50–80 %; not effective = more than 80 % left.</p>
      {err && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">Entries could not be read: {err}</div>}
      {!rows && !err && <p className="py-6 text-center text-fs-14 font-semibold text-slate-500">Reading the entries of {back} days…</p>}
      {rows && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Action effectiveness totals">
            {[['all', 'Reasons with an action', shown.length, 'text-slate-900'], ...Object.entries(EFFECT_STATUS).map(([k, s]) => [k, s.label, T[k], k === 'not' ? 'text-red-700' : k === 'new' ? 'text-orange-700' : k === 'partly' ? 'text-amber-700' : k === 'effective' ? 'text-emerald-700' : 'text-slate-600'])].map(([k, label, n, tone]) => (
              <div key={k} className="rounded-lg border border-slate-200 px-3 py-2" data-testid={`eff-${k}`}>
                <div className="text-fs-12 font-bold text-slate-600">{label}</div>
                <div className={`font-mono text-fs-24 font-extrabold leading-tight ${n ? tone : 'text-slate-400'}`}>{n}</div>
              </div>
            ))}
          </div>
          {stuck.length > 0 && (
            <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-fs-13 text-red-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span><b>{stuck.length} reason{stuck.length === 1 ? '' : 's'} got 2 or more actions but the loss did not come down:</b> {stuck.slice(0, 5).map((r) => `${r.reason} (${r.nActions} actions)`).join(', ')}{stuck.length > 5 ? ' …' : ''}. The root cause was probably not found — do the 5-Why again with the line, maintenance and quality together.</span>
            </div>
          )}
          {!shown.length ? <p className="mt-3 text-fs-14 text-slate-600">No RCA with an action in the last {back} days{dept ? ` for ${dept}` : ''}.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Action effectiveness table">
                <thead><tr className="bg-[#1F3864] text-center text-fs-12 text-white">{['Status', 'Type', 'Reason', 'Department', 'Line', 'Actions', `Before (per day)`, `After (per day)`, 'Change', 'Days with it after', `Last ${back} days`].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {shown.slice(0, 150).map((r) => {
                    const s = EFFECT_STATUS[r.status];
                    return (
                      <React.Fragment key={r.key}>
                        <tr className={`cursor-pointer text-center hover:bg-[#DDEBF7]/50 ${r.status === 'not' ? 'bg-red-50/60' : ''}`} onClick={() => setOpen(open === r.key ? null : r.key)} aria-label={`Effect ${r.reason}`} aria-expanded={open === r.key}>
                          <td className={td}><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-fs-12 font-bold ring-1 ${s.tone}`}>{s.label}</span></td>
                          <td className={td}>{KIND_TEXT[r.kind] || r.kind}</td>
                          <td className={`${td} text-left font-semibold`}><ChevronRight size={12} className={`mr-1 inline text-slate-400 transition-transform ${open === r.key ? 'rotate-90' : ''}`} aria-hidden />{r.reason}</td>
                          <td className={td}>{deptName(r.dept)}</td>
                          <td className={`${td} whitespace-nowrap`}>{r.lines.map((l) => `L${l}`).join(', ')}</td>
                          <td className={`${td} whitespace-nowrap ${r.nActions >= 2 && r.status === 'not' ? 'font-bold text-red-700' : ''}`}>{r.nActions} · {dmy(r.last)}</td>
                          <td className={`${td} font-mono`}>{num(r.before, r.unit)}<span className="block text-fs-11 text-slate-500">{r.beforeDays} days</span></td>
                          <td className={`${td} font-mono`}>{num(r.after, r.unit)}<span className="block text-fs-11 text-slate-500">{r.afterDays} days</span></td>
                          <td className={`${td} font-mono font-bold ${r.change == null ? '' : r.change <= -0.5 ? 'text-emerald-700' : r.change <= -0.2 ? 'text-amber-700' : 'text-red-700'}`}>{r.change == null ? '—' : `${r.change > 0 ? '+' : ''}${Math.round(r.change * 100)}%`}</td>
                          <td className={`${td} font-mono`}>{r.repeats}</td>
                          <td className={`${td} p-1`}><Spark daily={r.daily} from={start} to={today} actions={r.actions} /></td>
                        </tr>
                        {open === r.key && (
                          <tr><td colSpan={11} className="border border-[#D4D4D4] bg-slate-50 px-3 py-2 text-left">
                            <div className="text-fs-12 font-bold uppercase tracking-wide text-slate-600">Actions taken</div>
                            <ul className="mt-1 grid gap-1">
                              {r.actions.map((a, i) => (
                                <li key={i} className="text-fs-13 text-slate-800"><b className="font-mono">{dmy(a.at)}</b> · L{a.line} · {a.status === 'closed' ? 'closed' : 'open'}{a.by ? ` · ${a.by}` : ''} — <b>Action:</b> {a.action}{a.rootCause ? <> · <b>Cause:</b> {a.rootCause}</> : null}</li>
                              ))}
                            </ul>
                            {r.status === 'not' && <p className="mt-1 text-fs-13 font-semibold text-red-800">The loss per day is still {num(r.after, r.unit)} after the action ({num(r.before, r.unit)} before). Check whether the action is really done on the line, and look for another root cause.</p>}
                            {r.status === 'new' && <p className="mt-1 text-fs-13 font-semibold text-orange-800">There was none in the {win} days before the action, but it came again after it.</p>}
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-fs-12 text-slate-500">Bars: loss per day (orange); blue lines: action days. Click a reason for its actions.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
