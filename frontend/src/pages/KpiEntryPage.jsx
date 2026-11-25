import React, { useEffect, useMemo, useState } from 'react';
import { Save, ClipboardList } from 'lucide-react';
import HeaderBar, { arrowBtn, fieldCls } from '../components/HeaderBar';
import { api } from '../api';
import { useAuth } from '../components/AuthGate';
import { useOleLines, LINE_COLOR, dmy } from '../components/OleParts';
import { addDays } from '../utils/mainFilter';
import { serverToday } from '../utils/serverTime';
import { KPI_LINES } from '../utils/kpiStages';

/**
 * KPI entry (19-11-2026) — what the plant's SAWM KPI report needs that Line Pulse cannot read from the scans:
 * OS&D value, BOM value, actual OT man-hours (planned / unplanned), open work orders > 7 days, TRC lying > 3 days,
 * WIP lying > 7 days and dismantled pieces — one row per line and day (api/ole.php action 'kpi').
 * Production, plan, UPH, UPPH, RTY and the loss reasons come by themselves (Reports → SAWM KPI report).
 */
export const KPI_FIELDS = [
  { k: 'osd', label: 'OS&D value', unit: '₹', step: '0.01', hint: 'OS&D of the reporting date' },
  { k: 'bom', label: 'BOM value', unit: 'Cr', step: '0.0001', hint: 'BOM value of the day (OS&D % = OS&D ÷ BOM)' },
  { k: 'otPlan', label: 'OT planned', unit: 'man-hr', step: '0.5' },
  { k: 'otUnplan', label: 'OT unplanned', unit: 'man-hr', step: '0.5' },
  { k: 'wo7', label: '> 7 days WO', unit: 'bal qty', step: '1', hint: 'Sum of the balance qty of work orders open more than 7 days' },
  { k: 'trc3', label: 'TRC lying > 3 days', unit: '₹', step: '0.01' },
  { k: 'wip7', label: 'WIP lying > 7 days', unit: '₹', step: '0.01' },
  { k: 'dismantle', label: 'Dismantle', unit: 'pcs', step: '1', hint: 'Pieces dismantled (FTY & RTY sheet)' },
];
const inp = 'h-10 w-full min-w-[84px] rounded-lg border border-slate-300 bg-white px-2 text-right font-mono text-fs-15 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
const fmt = (v) => (v == null || v === '' ? '' : String(v));
const num = (v) => (v === '' || v == null ? null : Number(v));
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

export default function KpiEntryPage() {
  const me = useAuth();
  const isAdmin = me?.role === 'admin';
  const canEdit = isAdmin || !!me?.oleEdit;
  const today = serverToday();
  const [date, setDate] = useState(today);
  const ids = useOleLines();
  const [rows, setRows] = useState(null);        // saved rows of the month so far { "date|line": {...} }
  const [form, setForm] = useState({});          // { line: { field: 'text' } }
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const monthStart = `${date.slice(0, 8)}01`;
  const load = async () => {
    setErr('');
    try { const j = await api.oleEntries(monthStart, date); setRows(j?.kpi || {}); } catch (x) { setErr(`Could not read the entries: ${x.message}`); setRows((r) => r || {}); }
  };
  useEffect(() => { setRows(null); setMsg(''); load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  // the form starts with what was saved for the day
  useEffect(() => {
    if (!rows) return;
    setForm(Object.fromEntries(ids.map((l) => { const r = rows[`${date}|${l}`] || {}; return [l, Object.fromEntries([...KPI_FIELDS.map((f) => [f.k, fmt(r[f.k])]), ['note', r.note || '']])]; })));
  }, [rows, date, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // OS&D month to date (the report's "OS&D MTD"): saved days before this one + what is on the form today
  const mtd = useMemo(() => Object.fromEntries(ids.map((l) => {
    const before = Object.values(rows || {}).filter((r) => String(r.line) === l && r.date < date).reduce((a, r) => a + (Number(r.osd) || 0), 0);
    return [l, before + (Number(form[l]?.osd) || 0)];
  })), [rows, form, ids, date]);
  const changed = (l) => { const r = rows?.[`${date}|${l}`] || {}; return KPI_FIELDS.some((f) => fmt(r[f.k]) !== (form[l]?.[f.k] ?? '')) || (r.note || '') !== (form[l]?.note ?? ''); };
  const bad = (l) => KPI_FIELDS.find((f) => { const v = form[l]?.[f.k]; return v !== '' && v != null && !(Number(v) >= 0); });
  const save = async (l) => {
    const b = bad(l);
    if (b) { setMsg(`Line ${l}: ${b.label} must be 0 or more.`); return false; }
    setBusy(l); setMsg('');
    try {
      await api.saveOleKpi({ date, line: Number(l), ...Object.fromEntries(KPI_FIELDS.map((f) => [f.k, num(form[l]?.[f.k])])), note: form[l]?.note || '' });
      return true;
    } catch (x) { setMsg(`Line ${l} not saved: ${x.message}`); return false; } finally { setBusy(''); }
  };
  const saveAll = async () => {
    const todo = ids.filter(changed);
    if (!todo.length) return;
    let n = 0; for (const l of todo) if (await save(l)) n += 1;
    await load();
    if (n === todo.length) setMsg(`Saved ${n === 1 ? `Line ${todo[0]}` : `${n} lines`} for ${dmy(date)}.`);
  };
  const set = (l, k, v) => { setMsg(''); setForm((f) => ({ ...f, [l]: { ...f[l], [k]: v } })); };
  const filled = ids.filter((l) => rows?.[`${date}|${l}`]).length;
  const lineOf = (l) => KPI_LINES.find((x) => x.line === l);
  const any = ids.some(changed);
  return (
    <div className="flex flex-col gap-3" role="region" aria-label="KPI entry">
      <HeaderBar label="KPI entry filters">
        <button type="button" className={arrowBtn} aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}>‹</button>
        <input type="date" className={fieldCls} aria-label="Day" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value > today ? today : e.target.value)} />
        <button type="button" className={arrowBtn} aria-label="Next day" disabled={date >= today} onClick={() => setDate((d) => (addDays(d, 1) > today ? today : addDays(d, 1)))}>›</button>
        {date !== today && <button type="button" className={`${fieldCls} font-bold text-blue-700`} onClick={() => setDate(today)}>Today</button>}
        <span className="text-fs-13 font-semibold text-slate-600"><ClipboardList size={14} className="mr-1 inline align-[-2px]" aria-hidden />{dmy(date)} · {filled} of {ids.length} lines filled</span>
      </HeaderBar>
      <p className="text-fs-14 text-slate-600">The numbers of the <b>SAWM KPI report</b> that Line Pulse cannot read from the scans. Production, plan, UPH, UPPH, RTY and loss reasons fill themselves (Reports → SAWM KPI report).</p>
      {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
      {rows == null ? <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-fs-14 font-semibold text-slate-600">Reading the entries…</div> : (
        <section className="overflow-hidden rounded-[3px] border border-[#BFBFBF] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-fs-14" aria-label={`KPI entry ${dmy(date)}`}>
              <thead>
                <tr className="bg-[#1F3864] text-left text-fs-13 text-white">
                  <th className="px-3 py-2 font-bold">Line</th>
                  {KPI_FIELDS.map((f) => <th key={f.k} className="px-2 py-2 text-right font-bold whitespace-nowrap" title={f.hint || ''}>{f.label}<span className="block text-fs-11 font-semibold text-white/70">{f.unit}</span></th>)}
                  <th className="px-2 py-2 text-right font-bold whitespace-nowrap">OS&amp;D MTD<span className="block text-fs-11 font-semibold text-white/70">₹ · month to date</span></th>
                  <th className="px-2 py-2 font-bold">Note</th>
                  {canEdit && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {ids.map((l) => {
                  const k = lineOf(l), saved = rows[`${date}|${l}`];
                  return (
                    <tr key={l} className="border-b border-slate-200 align-middle">
                      <th scope="row" className="px-3 py-2 text-left whitespace-nowrap">
                        <span className="font-extrabold text-[#1F3864]">Line {l}</span>
                        <span className="block text-fs-12 font-semibold text-slate-500">{k ? `${k.fa} · SAP ${k.sap}` : ''}{saved ? ` · by ${saved.by}` : ''}</span>
                      </th>
                      {KPI_FIELDS.map((f) => (
                        <td key={f.k} className="px-1.5 py-1.5">
                          <input type="number" min="0" step={f.step} inputMode="decimal" disabled={!canEdit} aria-label={`${f.label} Line ${l}`} value={form[l]?.[f.k] ?? ''} placeholder="—"
                            onChange={(e) => set(l, f.k, e.target.value)} className={`${inp} ${form[l]?.[f.k] !== '' && !(Number(form[l]?.[f.k]) >= 0) ? 'border-red-400 bg-red-50' : ''}`} />
                        </td>
                      ))}
                      <td className="px-2 text-right font-mono font-bold text-slate-800 whitespace-nowrap">{money(mtd[l] || 0)}</td>
                      <td className="px-1.5 py-1.5"><input disabled={!canEdit} maxLength={300} aria-label={`Note Line ${l}`} value={form[l]?.note ?? ''} onChange={(e) => set(l, 'note', e.target.value)} className="h-10 w-full min-w-[140px] rounded-lg border border-slate-300 px-2 text-fs-14" placeholder="optional" /></td>
                      {canEdit && <td className="px-2"><button type="button" disabled={!!busy || !changed(l)} onClick={async () => { if (await save(l)) { await load(); setMsg(`Saved Line ${l} for ${dmy(date)}.`); } }} aria-label={`Save Line ${l}`}
                        className="inline-flex h-10 items-center gap-1 rounded-lg bg-blue-700 px-3 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-40"><Save size={15} aria-hidden /> {busy === l ? '…' : 'Save'}</button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canEdit && ids.length > 1 && (
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-3 py-2">
              {any && <span className="text-fs-13 font-bold text-amber-700">Unsaved changes</span>}
              <button type="button" onClick={saveAll} disabled={!!busy || !any} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-dixon-navy px-4 text-fs-14 font-bold text-white disabled:opacity-50"><Save size={15} aria-hidden /> Save all lines</button>
            </div>
          )}
        </section>
      )}
      {msg && <p role="status" className={`text-fs-14 font-bold ${/not saved|must be/i.test(msg) ? 'text-red-700' : 'text-emerald-700'}`}>{msg}</p>}
      {!canEdit && <p className="text-fs-13 text-slate-500">This login can see the entries; the administrator can allow it to fill them (Users &amp; logins).</p>}
    </div>
  );
}
