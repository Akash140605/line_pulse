/**
 * 27-11-2026: CAPA tracker — follows the Daily CAPA sheets of a month.
 *   tiles      needed · filled · pending · closed · overdue · due in 3 days · closure %
 *   day × line every day of the month, each line: filled / needed (green all closed, amber some open, red nothing written);
 *              a click opens that day's sheet
 *   follow-up  the open actions by target date (overdue first), with the department, 6M, action and responsibility
 *   owners     who has how many open / overdue / closed
 * The rows are the RCAs of the losses (same records as the Daily CAPA sheet, RCA Entry and the CAPA register).
 */
import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, ExternalLink } from 'lucide-react';
import HeaderBar, { fieldCls } from '../components/HeaderBar';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, issuesOf } from '../utils/ole';
import { rcaRows, daysBetween } from '../utils/rcaDash';
import { deptName } from '../utils/lossan';
import { guessDept } from '../utils/deptRules';
import { nf, dmy, card, StatusChip, useOleLines, monthOf, monthRange, useOleData } from '../components/OleParts';
import { exportPanel } from '../utils/domExcel';
import { openPage } from '../components/NotificationBell';

export const CAPA_OPEN_KEY = 'lp:capa-open';   // the tracker → the Daily CAPA sheet of a day and line
const KINDS = { rework: ['rework', 'reject'], idle: ['loss', 'stop'] };
const KIND_LABEL = { rework: 'Rework', reject: 'Rejection', loss: 'Idle time', stop: 'Stoppage' };
const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function Tile({ name, value, tone = 'text-slate-900', on, onClick, testid }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={testid} className={`lp-tile min-w-0 text-left ${on ? 'ring-2 ring-blue-400' : ''}`}>
      <div>{name}</div>
      <div className={`font-mono text-fs-28 font-extrabold leading-tight tabular-nums ${tone}`}>{value}</div>
    </button>
  );
}

export default function CapaTrackerPage() {
  const IDS = useOleLines();
  const today = serverToday();
  const [month, setMonth] = useState(monthOf(today));
  const range = monthRange(month, today);
  const [kind, setKind] = useState('all');   // all · rework · idle
  const [line, setLine] = useState('all');
  const [dept, setDept] = useState('all');
  const [show, setShow] = useState('open');   // follow-up list: open · overdue · soon · closed · all
  const settings = useAllLineSettings(IDS);
  const D = useOleData({ start: range.start, end: range.end, ids: IDS });
  const issues = useMemo(() => (D.al ? issuesOf(oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: IDS }).days) : []),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, IDS]);
  const all = useMemo(() => rcaRows(issues, D.ent.rca || {}, today).map((r) => ({ ...r, dept: deptName(r.rec?.dept || r.dept) || guessDept(r.kind, r.reason), sheet: KINDS.rework.includes(r.kind) ? 'rework' : 'idle' })), [issues, D.ent.rca, today]);
  const depts = useMemo(() => [...new Set(all.map((r) => r.dept))].sort(), [all]);
  const rows = all.filter((r) => (kind === 'all' || r.sheet === kind) && (line === 'all' || String(r.line) === line) && (dept === 'all' || r.dept === dept));
  const soonDays = 3;
  const left = (r) => (r.rec?.targetDate ? daysBetween(today, r.rec.targetDate) : null);
  const T = {
    n: rows.length, filled: rows.filter((r) => r.st !== 'pending').length, pending: rows.filter((r) => r.st === 'pending').length,
    closed: rows.filter((r) => r.st === 'closed').length, overdue: rows.filter((r) => r.overdue).length,
    soon: rows.filter((r) => r.st !== 'closed' && !r.overdue && left(r) != null && left(r) <= soonDays).length,
  };
  const open = (date, ln, sheet) => {
    try { sessionStorage.setItem(CAPA_OPEN_KEY, JSON.stringify({ date, line: String(ln) })); } catch { /* private mode */ }
    openPage(sheet === 'idle' ? 'idleday' : 'capaday');
  };
  // day × line
  const days = useMemo(() => [...new Set(rows.map((r) => r.date))].sort().reverse(), [rows]);
  const cell = (d, l) => { const rs = rows.filter((r) => r.date === d && String(r.line) === l); return { n: rs.length, filled: rs.filter((r) => r.st !== 'pending').length, closed: rs.filter((r) => r.st === 'closed').length, over: rs.filter((r) => r.overdue).length }; };
  const lines = line === 'all' ? IDS : [line];
  // follow-up list
  const list = rows.filter((r) => (show === 'all' ? true : show === 'closed' ? r.st === 'closed' : show === 'overdue' ? r.overdue : show === 'soon' ? r.st !== 'closed' && !r.overdue && left(r) != null && left(r) <= soonDays : show === 'pending' ? r.st === 'pending' : r.st !== 'closed'))
    .sort((a, b) => (b.overdue - a.overdue) || ((a.rec?.targetDate || '9999') < (b.rec?.targetDate || '9999') ? -1 : (a.rec?.targetDate || '9999') > (b.rec?.targetDate || '9999') ? 1 : 0) || (a.date < b.date ? -1 : 1));
  // owners
  const owners = useMemo(() => {
    const m = new Map();
    for (const r of rows) { if (r.st === 'pending') continue; const k = (r.rec?.owner || '').trim() || 'Not given'; const o = m.get(k) || { owner: k, open: 0, overdue: 0, closed: 0 }; if (r.st === 'closed') o.closed += 1; else o.open += 1; if (r.overdue) o.overdue += 1; m.set(k, o); }
    return [...m.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  }, [rows]);
  const th = 'border border-slate-300 bg-[#DCE6F2] px-2 py-1.5 text-left text-fs-12 font-bold text-[#1F3864] whitespace-nowrap';
  const td = 'border border-slate-200 px-2 py-1.5 text-fs-13 align-top';
  const seg = (on) => `h-9 px-3 text-fs-13 font-bold whitespace-nowrap ${on ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
  const bodyRef = React.useRef(null);

  return (
    <div className="flex flex-col gap-3" data-testid="capa-tracker">
      <HeaderBar label="CAPA tracker filters">
        <input type="month" aria-label="Month" max={monthOf(today)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
        <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Sheet">
          {[['all', 'Both sheets'], ['rework', 'Rework'], ['idle', 'Idle time']].map(([k, t]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={seg(kind === k)}>{t}</button>)}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Line">
          {['all', ...IDS].map((l) => <button key={l} type="button" aria-pressed={line === l} onClick={() => setLine(l)} className={seg(line === l)}>{l === 'all' ? 'All lines' : `Line ${l}`}</button>)}
        </div>
        <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className={fieldCls}>
          <option value="all">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button type="button" onClick={() => exportPanel(bodyRef.current, 'CAPA tracker', `${month}`)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-100"><FileSpreadsheet size={15} />Excel</button>
      </HeaderBar>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!D.al && !D.err && <div className={`${card} text-fs-14 font-semibold text-slate-500`}>Reading the month …</div>}
      {D.al && (
        <div ref={bodyRef} className="flex flex-col gap-3">
          <section className="lp-kpis grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="CAPA totals">
            <Tile name="Needed" value={nf(T.n)} on={show === 'all'} onClick={() => setShow('all')} testid="ct-needed" />
            <Tile name="Filled" value={nf(T.filled)} tone="text-blue-800" on={show === 'open'} onClick={() => setShow('open')} />
            <Tile name="Not filled" value={nf(T.pending)} tone={T.pending ? 'text-red-700' : 'text-slate-900'} on={show === 'pending'} onClick={() => setShow('pending')} testid="ct-pending" />
            <Tile name="Overdue" value={nf(T.overdue)} tone={T.overdue ? 'text-red-700' : 'text-slate-900'} on={show === 'overdue'} onClick={() => setShow('overdue')} />
            <Tile name={`Due in ${soonDays} days`} value={nf(T.soon)} tone={T.soon ? 'text-amber-700' : 'text-slate-900'} on={show === 'soon'} onClick={() => setShow('soon')} />
            <Tile name="Closed" value={nf(T.closed)} tone="text-emerald-700" on={show === 'closed'} onClick={() => setShow('closed')} />
            <Tile name="Closure" value={pc(T.n ? T.closed / T.n : null)} tone={T.n && T.closed / T.n >= 0.8 ? 'text-emerald-700' : 'text-amber-700'} />
          </section>

          <div className="lp-ctrack-grid grid grid-cols-1 gap-3">
            <section className={card} aria-label="Day by line">
              <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Day × line — filled / needed</h3>
              {!days.length ? <p className="text-fs-13 text-slate-600">Nothing to track in this month.</p> : (
                <div className="overflow-auto" style={{ maxHeight: 520 }}>
                  <table className="w-full border-collapse text-fs-13 tabular-nums" data-testid="ct-days">
                    <thead className="sticky top-0"><tr><th className={th}>Day</th>{lines.map((l) => <th key={l} className={`${th} text-center`}>Line {l}</th>)}</tr></thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d}>
                          <td className={`${td} whitespace-nowrap font-semibold`}>{dmy(d)}</td>
                          {lines.map((l) => {
                            const c = cell(d, l);
                            if (!c.n) return <td key={l} className={`${td} text-center text-slate-400`}>—</td>;
                            const tone = c.closed === c.n ? 'bg-emerald-100 text-emerald-800' : c.filled === 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
                            return (
                              <td key={l} className={`${td} p-1 text-center`}>
                                <button type="button" onClick={() => open(d, l, kind === 'idle' ? 'idle' : 'rework')} title={`${c.filled} of ${c.n} filled · ${c.closed} closed${c.over ? ` · ${c.over} overdue` : ''} — open the sheet`}
                                  className={`w-full rounded-md px-2 py-1 font-mono font-bold ${tone} lp-ct-cell`}>{c.filled}/{c.n}{c.over ? <span className="ml-1 text-red-700">!</span> : null}</button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-fs-12 text-slate-500"><span className="rounded bg-emerald-100 px-1 text-emerald-800">green</span> all closed · <span className="rounded bg-amber-100 px-1 text-amber-800">amber</span> some open · <span className="rounded bg-red-100 px-1 text-red-800">red</span> nothing written · ! overdue · click to open the day&apos;s sheet</p>
            </section>

            <section className={card} aria-label="Follow-up">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Follow-up — {({ open: 'open actions', overdue: 'overdue', soon: `due in ${soonDays} days`, closed: 'closed', pending: 'not filled', all: 'all' })[show]}</h3>
                <span className="ml-auto text-fs-12 text-slate-500">{list.length} rows · overdue first, then by target date</span>
              </div>
              {!list.length ? <p className="text-fs-13 text-slate-600">Nothing here.</p> : (
                <div className="overflow-auto" style={{ maxHeight: 520 }}>
                  <table className="w-full border-collapse" style={{ minWidth: 980 }} data-testid="ct-list">
                    <thead className="sticky top-0"><tr>{['Date', 'Line', 'Type', 'Defect / reason', 'Dept.', '6M', 'Corrective action', 'Responsibility', 'Target', 'Days', 'Status', ''].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {list.map((r) => {
                        const dl = left(r);
                        return (
                          <tr key={r.key} className={r.overdue ? 'bg-red-50/60' : ''}>
                            <td className={`${td} whitespace-nowrap`}>{dmy(r.date)}</td>
                            <td className={`${td} whitespace-nowrap`}>Line {r.line}</td>
                            <td className={`${td} whitespace-nowrap text-fs-12`}>{KIND_LABEL[r.kind]}</td>
                            <td className={`${td} font-semibold`}>{r.reason}<div className="text-fs-11 font-normal text-slate-500">{r.unit === 'min' ? `${Math.round(r.value)} min` : `${nf(r.value)} pcs`}</div></td>
                            <td className={`${td} whitespace-nowrap`}>{r.dept}</td>
                            <td className={`${td} whitespace-nowrap`}>{r.rec?.cat || '—'}</td>
                            <td className={td}>{r.rec?.action || <span className="text-amber-700">not written</span>}</td>
                            <td className={`${td} whitespace-nowrap`}>{r.rec?.owner || '—'}</td>
                            <td className={`${td} whitespace-nowrap`}>{r.rec?.targetDate ? dmy(r.rec.targetDate) : '—'}</td>
                            <td className={`${td} whitespace-nowrap text-right font-mono font-bold ${r.overdue ? 'text-red-700' : dl != null && dl <= soonDays ? 'text-amber-700' : 'text-slate-600'}`}>{r.st === 'closed' ? (r.age != null ? `${r.age} d` : '—') : r.overdue ? `${-dl} late` : dl != null ? `${dl} left` : `${r.age ?? 0} open`}</td>
                            <td className={`${td} whitespace-nowrap`}><StatusChip st={r.st} /></td>
                            <td className={`${td} p-1`}><button type="button" onClick={() => open(r.date, r.line, r.sheet)} title="Open the day's sheet" aria-label={`Open the sheet of ${dmy(r.date)} line ${r.line}`} className="rounded p-1 text-blue-700 hover:bg-blue-50"><ExternalLink size={15} /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className={card} aria-label="Responsibility">
            <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Responsibility — who has what</h3>
            {!owners.length ? <p className="text-fs-13 text-slate-600">No action written yet.</p> : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {owners.map((o) => (
                  <div key={o.owner} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="truncate text-fs-14 font-bold text-slate-900" title={o.owner}>{o.owner}</div>
                    <div className="mt-1 flex gap-3 text-fs-13"><span><b className="font-mono">{o.open}</b> open</span><span className={o.overdue ? 'text-red-700' : 'text-slate-500'}><b className="font-mono">{o.overdue}</b> overdue</span><span className="text-emerald-700"><b className="font-mono">{o.closed}</b> closed</span></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
