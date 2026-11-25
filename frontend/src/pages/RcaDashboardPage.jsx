import React, { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, ChevronRight } from 'lucide-react';
import HeaderBar, { segGroup, segBtn } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { PeriodBar } from '../components/PeriodBar';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, issuesOf, needsRca, KIND_TEXT } from '../utils/ole';
import { deptName } from '../utils/lossan';
import { nf, dmy, useOleData, useOleLines, groupNameOf, StatusChip } from '../components/OleParts';
import { exportPanel } from '../utils/domExcel';
import { rcaRows, rcaTotals, rcaByDept, rcaAgeing } from '../utils/rcaDash';
import RcaEffect from '../components/RcaEffect';

/**
 * RCA dashboard (20-11-2026) — how the departments close their RCAs: pending / submitted / closed, overdue (target date
 * passed), closure %, days to close, department table, ageing of the open ones and the oldest open RCAs.
 * Formulas: utils/rcaDash.js. A click on a department filters everything below; "Open RCA" goes to the RCA page.
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const th = 'border border-[#BFBFBF] px-2 py-1.5';
const td = 'border border-[#D4D4D4] px-2 py-1.5';

function Tile({ name, value, sub, tone = 'text-slate-900', testid }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid={testid}>
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className={`mt-1 font-mono text-fs-28 font-extrabold leading-none tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-fs-12 text-slate-600">{sub}</div>}
    </div>
  );
}

export default function RcaDashboardPage({ onOpen = null, canOpen = [] }) {
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: `${today.slice(0, 8)}01`, end: today });
  const [sel, setSel] = useState('all');
  const [dept, setDept] = useState(null);
  const IDS = sel === 'all' ? ALL : [sel];
  const settings = useAllLineSettings(ALL);
  const D = useOleData({ start: range.start, end: range.end, ids: ALL });
  const issues = useMemo(() => (D.al ? issuesOf(oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL }).days).filter(needsRca) : null),
    [D.al, settings, D.ent.entries, D.ent.days, D.ent.setup, range.start, range.end, today, D.endMin, ALL]);
  const all = useMemo(() => (issues ? rcaRows(issues.filter((i) => IDS.includes(String(i.line))), D.ent.rca || {}, today) : []), [issues, D.ent.rca, IDS.join(), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = dept ? all.filter((r) => deptName(r.dept) === dept) : all;
  const T = rcaTotals(rows);
  const byDept = useMemo(() => rcaByDept(all, deptName), [all]);
  const ageing = rcaAgeing(rows);
  const maxAge = Math.max(1, ...ageing.map((a) => a.n));
  const open = rows.filter((r) => r.st !== 'closed').sort((a, b) => (b.overdue - a.overdue) || (b.age ?? 0) - (a.age ?? 0));
  const byKind = ['loss', 'reject', 'rework'].map((k) => ({ k, ...rcaTotals(rows.filter((r) => r.kind === k)) })).filter((x) => x.n);
  const bodyRef = useRef(null);
  const oneDay = range.start === range.end;
  const periodText = oneDay ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  const can = (id) => onOpen && canOpen.includes(id);

  if (!ALL.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  return (
    <div className="flex flex-col gap-3" aria-label="RCA dashboard" role="region">
      <HeaderBar label="RCA dashboard filters">
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!issues} />
        <button type="button" disabled={!issues} onClick={() => exportPanel(bodyRef.current, 'RCA dashboard', periodText)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50" aria-label="Export to Excel"><FileSpreadsheet size={15} />Excel</button>
      </HeaderBar>
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!issues ? <PageLoader label="Reading the RCAs" sub="Losses, rejection and rework of the period" /> : (
        <div ref={bodyRef} className="flex flex-col gap-3">
          {dept && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-fs-13 font-semibold text-blue-900">
              Department: <b>{dept}</b><button type="button" onClick={() => setDept(null)} className="ml-auto rounded-md border border-blue-300 bg-white px-2 py-0.5 font-bold hover:bg-blue-100">All departments ✕</button>
            </div>
          )}
          <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7" aria-label="RCA totals">
            <Tile testid="rca-total" name="RCA needed" value={nf(T.n)} sub="losses, rejection, rework" />
            <Tile testid="rca-pending" name="Pending" value={nf(T.pending)} sub="nothing written yet" tone={T.pending ? 'text-red-700' : 'text-slate-900'} />
            <Tile testid="rca-submitted" name="Submitted" value={nf(T.submitted)} sub="written, action open" tone={T.submitted ? 'text-amber-700' : 'text-slate-900'} />
            <Tile testid="rca-closed" name="Closed" value={nf(T.closed)} sub="action done" tone="text-emerald-700" />
            <Tile testid="rca-overdue" name="Overdue" value={nf(T.overdue)} sub="target date passed" tone={T.overdue ? 'text-red-700' : 'text-slate-900'} />
            <Tile testid="rca-closure" name="Closure" value={pc(T.closure)} sub="closed ÷ needed" tone={T.closure == null ? 'text-slate-500' : T.closure >= 0.9 ? 'text-emerald-700' : T.closure >= 0.6 ? 'text-amber-700' : 'text-red-700'} />
            <Tile testid="rca-days" name="Days to close" value={T.avgClose == null ? '—' : T.avgClose.toFixed(1)} sub="average, loss → close date" />
          </section>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className={card} aria-label="RCA by department">
              <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">By department</h3>
              {!byDept.length ? <p className="text-fs-14 text-slate-600">No RCA needed in this period.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="RCA by department table">
                    <thead><tr className="bg-[#1F3864] text-center text-fs-12 text-white">{['Department', 'Needed', 'Pending', 'Submitted', 'Closed', 'Overdue', 'Closure', 'Days to close'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {byDept.map((d) => (
                        <tr key={d.dept} onClick={() => setDept(dept === d.dept ? null : d.dept)} className={`cursor-pointer text-center hover:bg-[#DDEBF7]/60 ${dept === d.dept ? 'bg-[#DDEBF7]' : ''}`} aria-label={`Department ${d.dept}`}>
                          <td className={`${td} text-left font-bold`}>{d.dept} <ChevronRight size={12} className="inline text-slate-400" aria-hidden /></td>
                          <td className={`${td} font-mono`}>{d.n}</td>
                          <td className={`${td} font-mono ${d.pending ? 'font-bold text-red-700' : ''}`}>{d.pending}</td>
                          <td className={`${td} font-mono ${d.submitted ? 'text-amber-700' : ''}`}>{d.submitted}</td>
                          <td className={`${td} font-mono text-emerald-700`}>{d.closed}</td>
                          <td className={`${td} font-mono ${d.overdue ? 'font-bold text-red-700' : ''}`}>{d.overdue}</td>
                          <td className={`${td} font-mono font-bold`}>{pc(d.closure)}</td>
                          <td className={`${td} font-mono`}>{d.avgClose == null ? '—' : d.avgClose.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className={card} aria-label="Ageing of open RCAs">
              <h3 className="lp-caps mb-2 border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Open RCAs — age</h3>
              <div className="flex flex-col gap-2">
                {ageing.map((a, i) => (
                  <div key={a.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-fs-13">
                    <span className="font-semibold text-slate-700">{a.label}</span>
                    <div className="h-4 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${(a.n / maxAge) * 100}%`, background: ['#9DB7D5', '#5B8DC9', '#D98E04', '#C00000'][i] }} /></div>
                    <b className="text-right font-mono">{a.n}</b>
                  </div>
                ))}
              </div>
              {byKind.length > 0 && (
                <table className="mt-3 w-full border-collapse text-fs-13 tabular-nums" aria-label="RCA by type">
                  <thead><tr className="bg-[#DDEBF7] text-center text-fs-12 text-[#1F3864]">{['Type', 'Needed', 'Open', 'Closed', 'Closure'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>{byKind.map((k) => <tr key={k.k} className="text-center"><td className={`${td} text-left font-bold`}>{KIND_TEXT[k.k]}</td><td className={`${td} font-mono`}>{k.n}</td><td className={`${td} font-mono`}>{k.pending + k.submitted}</td><td className={`${td} font-mono`}>{k.closed}</td><td className={`${td} font-mono font-bold`}>{pc(k.closure)}</td></tr>)}</tbody>
                </table>
              )}
            </section>
          </div>

          {/* 20-11-2026: do the actions work? the loss per day of each reason before and after its RCA action */}
          <RcaEffect ids={IDS} dept={dept} today={today} />

          <section className={card} aria-label="Open RCAs">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Open RCAs — oldest first</h3>
              <span className="text-fs-12 font-semibold text-slate-500">overdue on top</span>
              {can('rca') && <button type="button" onClick={() => onOpen('rca')} className="ml-auto rounded-md border border-blue-300 bg-white px-2.5 py-1 text-fs-13 font-bold text-blue-800 hover:bg-blue-50">Open RCA page ›</button>}
            </div>
            {!open.length ? <p className="text-fs-14 font-semibold text-emerald-700">No open RCA. 👍</p> : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Open RCAs table">
                  <thead className="sticky top-0"><tr className="bg-[#1F3864] text-center text-fs-12 text-white">{['Date', 'Line', 'Type', 'Reason', 'Department', 'Qty / min', 'Status', 'Target date', 'Age (days)', 'Root cause'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {open.slice(0, 200).map((r) => (
                      <tr key={r.key} className={`text-center ${r.overdue ? 'bg-red-50' : ''}`}>
                        <td className={`${td} whitespace-nowrap`}>{dmy(r.date)}</td><td className={td}>L{r.line}</td><td className={td}>{KIND_TEXT[r.kind]}</td>
                        <td className={`${td} text-left font-semibold`}>{r.reason}</td><td className={td}>{deptName(r.dept)}</td><td className={`${td} font-mono`}>{nf(r.value)} {r.unit}</td>
                        <td className={td}><StatusChip st={r.st} /></td>
                        <td className={`${td} whitespace-nowrap ${r.overdue ? 'font-bold text-red-700' : ''}`}>{r.rec?.targetDate ? dmy(r.rec.targetDate) : '—'}</td>
                        <td className={`${td} font-mono font-bold ${r.age > 15 ? 'text-red-700' : r.age > 7 ? 'text-amber-700' : ''}`}>{r.age ?? '—'}</td>
                        <td className={`${td} max-w-[280px] truncate text-left`} title={r.rec?.rootCause || ''}>{r.rec?.rootCause || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
