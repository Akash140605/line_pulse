import { LINE_COLOR } from '../theme';
import MesDrawer from './MesDrawer';
import React, { useEffect, useMemo, useState } from 'react';
import { IndianRupee, ListTree, X, ChevronLeft, ChevronRight, Download, Target, Info } from 'lucide-react';
import { Card, Empty } from './UiKit';
import { api, LINE_IDS } from '../api';
import { useAllLineSettings, settingsChanged } from '../hooks/useLineSettings';
import { lossMatrix, hourLoss, reasonLoss, rupees, hasRates, missingTargets, SKIP_PCT } from '../utils/money';
import { lossMatrixWorkbook } from '../utils/moneyExport';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { achievedByModel } from '../utils/modelReport';
import { addDays } from '../utils/mainFilter';
import { serverNow } from '../utils/serverTime';

const IDS = LINE_IDS;   // the lines this login may see (api.js)
const COLORS = LINE_COLOR;
const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
const pctT = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const hm = (sec) => { if (sec == null) return '—'; const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };
const dmy = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}` : '');
const pctTone = (p) => (p == null ? 'text-slate-500' : p >= 100 ? 'text-sky-700' : p >= 90 ? 'text-slate-700' : 'text-red-700');
const inp = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-fs-14 font-mono font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

// the MES drawer (components/MesDrawer.jsx): wide = the detail drawer on the right, else the small window in the middle
function Modal({ title, sub, onClose, children, wide = false, label }) {
  return <MesDrawer title={title} sub={sub} icon={wide ? ListTree : IndianRupee} onClose={onClose} label={label || title} method={wide ? 'right' : 'center'} width={wide ? 75 : 40} canExpand={wide} bodyClass="p-4">{children}</MesDrawer>;
}

/* ───────────── ₹ rates ───────────── */

function RatesDialog({ settings, lines, onClose }) {
  const [form, setForm] = useState(() => Object.fromEntries(IDS.map((l) => [l, {
    pcValue: settings[l]?.money?.pcValue ?? '', hourCost: settings[l]?.money?.hourCost ?? '',
    values: Object.fromEntries(Object.entries(settings[l]?.money?.values || {}).map(([k, v]) => [k, v])),
  }])));
  const [same, setSame] = useState(false);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (l, k, v) => setForm((f) => (same && k !== 'values' ? Object.fromEntries(IDS.map((x) => [x, { ...f[x], [k]: v }])) : { ...f, [l]: { ...f[l], [k]: v } }));
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      for (const l of IDS) await api.saveLineSettings(l, { action: 'money', money: form[l], allLines: false });
      settingsChanged();
      setMsg('Saved. Loss in ₹ is updated on every screen.');
    } catch (e) { setMsg(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };
  const models = (l) => (lines.find((x) => x.line === l)?.models || []).slice(0, 80);
  return (
    <Modal title="₹ rates for the loss" sub="Used to convert lost production into rupees. Stored on the server for every screen." onClose={onClose}>
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-fs-13 text-blue-900 leading-snug">
        <b>₹ pieces</b> = pieces short of target × value of one piece. <b>₹ line time</b> = time lost (short pieces × target cycle) × cost of the line for one hour (manpower + overhead).
        Leave a box empty if you do not want that part.
      </div>
      <label className="mt-3 inline-flex items-center gap-2 text-fs-14 font-semibold text-slate-800">
        <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="h-4 w-4" /> Same rates for all lines
      </label>
      <div className="mt-2 flex flex-col gap-2">
        {IDS.map((l) => (
          <div key={l} className="rounded-xl border border-slate-200 p-3">
            <div className="font-bold text-fs-14 mb-2"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: COLORS[l] }} />Line {l}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-fs-13 font-semibold text-slate-700">₹ per piece (default)
                <input type="number" min="0" step="any" inputMode="decimal" aria-label={`Rupees per piece Line ${l}`} className={inp} value={form[l].pcValue} onChange={(e) => set(l, 'pcValue', e.target.value)} placeholder="e.g. 150" />
              </label>
              <label className="text-fs-13 font-semibold text-slate-700">₹ per line-hour
                <input type="number" min="0" step="any" inputMode="decimal" aria-label={`Rupees per line hour Line ${l}`} className={inp} value={form[l].hourCost} onChange={(e) => set(l, 'hourCost', e.target.value)} placeholder="e.g. 12000" />
              </label>
            </div>
            <button type="button" onClick={() => setOpen(open === l ? null : l)} className="mt-2 text-fs-13 font-semibold text-blue-700 hover:underline">
              {open === l ? 'Hide' : 'Model-wise value per piece'} ({Object.values(form[l].values).filter((v) => Number(v) > 0).length} set)
            </button>
            {open === l && (
              <div className="mt-2 max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {models(l).length ? models(l).map((m) => (
                  <div key={m.mmId} className="flex items-center gap-2 px-2 py-1.5">
                    <div className="min-w-0 flex-1 text-fs-13"><div className="font-semibold break-words">{m.model}</div><div className="text-slate-600 text-fs-12">{m.company} · {nf(m.qty)} pcs</div></div>
                    <input type="number" min="0" step="any" aria-label={`Rupees per piece ${m.model}`} className={`${inp} w-28`} placeholder={form[l].pcValue ? `${form[l].pcValue}` : '₹'}
                      value={form[l].values[m.mmId] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [l]: { ...f[l], values: { ...f[l].values, [m.mmId]: e.target.value } } }))} />
                  </div>
                )) : <div className="p-3 text-fs-13 text-slate-600">No models in the selected period.</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <div role="status" className={`mt-3 text-fs-13 font-semibold ${msg.startsWith('Saved') ? 'text-sky-700' : 'text-red-700'}`}>{msg}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 text-fs-14 font-bold">Close</button>
        <button type="button" onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-blue-700 text-white text-fs-14 font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save rates'}</button>
      </div>
    </Modal>
  );
}

/* ───────────── deep dive of one line and day ───────────── */

function DeepDive({ mx, line, date, onClose, onNav }) {
  const L = mx.lines.find((x) => x.line === line);
  const dl = L?.days[date];
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    let alive = true; setEntries(null);
    api.losses(line, date, date).then((j) => { if (alive) setEntries(j?.entries || []); }).catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [line, date]);
  const hrs = useMemo(() => hourLoss(dl), [dl]);
  const rl = useMemo(() => (entries ? reasonLoss(dl, entries) : null), [dl, entries]);
  const idx = mx.days.indexOf(date);
  if (!dl) return null;
  const maxShort = Math.max(1, ...hrs.map((h) => h.short || 0));
  return (
    <Modal wide label="Loss deep dive" title={`Line ${line} · ${date} — loss deep dive`} onClose={onClose}
      sub={dl.hasPlan ? `Target from the model targets over ${hm(dl.workSec)} working time (lunch excluded)` : 'No model targets for this day'}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" disabled={idx >= mx.days.length - 1} onClick={() => onNav(line, mx.days[idx + 1])} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-fs-13 font-bold disabled:opacity-40"><ChevronLeft size={15} /> Earlier day</button>
        <button type="button" disabled={idx <= 0} onClick={() => onNav(line, mx.days[idx - 1])} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-fs-13 font-bold disabled:opacity-40">Later day <ChevronRight size={15} /></button>
        <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-fs-13 font-bold" role="group" aria-label="Line">
          {mx.lines.filter((x) => x.days[date]).map((x) => <button key={x.line} type="button" onClick={() => onNav(x.line, date)} className={`px-2.5 py-1 ${x.line === line ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700'}`}>Line {x.line}</button>)}
        </div>
        {dl.skipped && <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-fs-12 font-bold text-slate-700">Not counted: output below {SKIP_PCT}% of target (holiday / trial)</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
        {[
          ['Actual', nf(dl.actual), 'pcs'], ['Target', nf(dl.target), dl.coverage != null && dl.coverage < 100 ? `${Math.round(dl.coverage)}% of pcs have a target` : 'pcs'],
          ['Achievement', pctT(dl.pct), dl.pct != null && dl.pct >= 100 ? 'target reached' : 'of target', pctTone(dl.pct)],
          ['Short', nf(dl.short), 'pcs below target', dl.short > 0 ? 'text-red-700' : ''], ['Lost time', hm(dl.lostSec), dl.avgCycle ? `at ${Math.round(dl.avgCycle * 10) / 10} s / pc` : ''],
          ['Loss ₹', rupees(dl.rsTotal), dl.rsTotal == null ? 'Set ₹ rates' : `${rupees(dl.rsPcs)} pcs + ${rupees(dl.rsTime)} time`, dl.rsTotal ? 'text-red-700' : ''],
          ['Rejected', nf(dl.rej), 'false scans'],
        ].map(([l, v, s, tone]) => (
          <div key={l} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="text-fs-12 font-semibold text-slate-600">{l}</div>
            <div className={`font-mono text-fs-20 font-bold leading-tight ${tone || 'text-slate-900'}`}>{v}</div>
            <div className="text-fs-12 text-slate-600 leading-tight">{s}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid xl:grid-cols-5 gap-4">
        <section className="xl:col-span-3 min-w-0" aria-label="Hour-wise loss">
          <h4 className="text-fs-14 font-bold text-slate-800 mb-1.5">Where — hour by hour</h4>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-fs-13">
              <thead className="bg-slate-50"><tr className="text-left text-slate-600">{['Hour', 'Actual', 'Target', '%', 'Short', '', 'Loss ₹', 'Models'].map((h, i) => <th key={i} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {hrs.map((h) => (
                  <tr key={h.hour} className="border-t border-slate-100 font-mono">
                    <td className="px-2 py-1 whitespace-nowrap font-bold">{h.label}{h.workSec > 0 && h.workSec < 3600 ? <span className="font-sans font-normal text-slate-500 text-fs-11"> {Math.round(h.workSec / 60)} min</span> : null}</td>
                    <td className="px-2">{nf(h.qty)}</td><td className="px-2">{nf(h.plan)}</td><td className={`px-2 ${pctTone(h.pct)}`}>{pctT(h.pct)}</td>
                    <td className={`px-2 ${h.short > 0.5 ? 'text-red-700 font-bold' : ''}`}>{nf(h.short)}</td>
                    <td className="px-2 w-24"><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-red-400" style={{ width: `${((h.short || 0) / maxShort) * 100}%` }} /></div></td>
                    <td className="px-2 whitespace-nowrap">{rupees(h.rsTotal)}</td>
                    <td className="px-2 font-sans text-fs-12 text-slate-600 min-w-[140px] max-w-[300px] break-words" title={h.models.map((m) => `${m.model} ${m.qty}`).join(', ')}>{h.models.map((m) => `${m.model} ${m.qty}`).join(', ') || (h.qty ? '' : 'no production')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
          <section aria-label="Reason-wise loss">
            <h4 className="text-fs-14 font-bold text-slate-800 mb-1.5">Why — loss register</h4>
            {!rl ? <div className="text-fs-13 text-slate-600">Loading loss register…</div> : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-fs-13">
                  <thead className="bg-slate-50"><tr className="text-left text-slate-600">{['Reason', 'Minutes', 'Qty', 'Loss ₹'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {rl.rows.map((r) => <tr key={r.reason} className="border-t border-slate-100"><td className="px-2 py-1 font-semibold">{r.reason}{r.dept ? <span className="block text-fs-11 font-normal text-slate-500">{r.dept}</span> : null}</td><td className="px-2 font-mono">{nf(r.minutes)}</td><td className="px-2 font-mono">{nf(r.pcs)}</td><td className="px-2 font-mono whitespace-nowrap">{rupees(r.rsTotal)}</td></tr>)}
                    {rl.open && rl.open.minutes >= 1 && <tr className="border-t border-slate-100 bg-slate-50"><td className="px-2 py-1 font-semibold text-slate-900">Not recorded<span className="block text-fs-11 font-normal">record it on the line page → Loss register</span></td><td className="px-2 font-mono">{nf(rl.open.minutes)}</td><td className="px-2 font-mono">{nf(rl.open.pcs)}</td><td className="px-2 font-mono whitespace-nowrap">{rupees(rl.open.rsTotal)}</td></tr>}
                    {!rl.rows.length && !(rl.open && rl.open.minutes >= 1) && <tr><td colSpan={4} className="px-2 py-3 text-slate-600">No loss recorded and no time lost.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section aria-label="Model-wise output">
            <h4 className="text-fs-14 font-bold text-slate-800 mb-1.5">Which models</h4>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-fs-13">
                <thead className="bg-slate-50"><tr className="text-left text-slate-600">{['Model', 'Qty', 'Target', '₹ per piece'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{dl.models.map((m) => <tr key={m.mmId} className="border-t border-slate-100"><td className="px-2 py-1 font-semibold">{m.model}</td><td className="px-2 font-mono">{nf(m.qty)}</td><td className="px-2 font-mono whitespace-nowrap">{m.target ? `${m.target} s · ${Math.round(3600 / m.target)}/hr` : <span className="text-slate-700 font-sans">no target</span>}</td><td className="px-2 font-mono">{m.value != null ? rupees(m.value) : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── board ───────────── */

export default function LossBoard({ lines, range, period, latestDate, readOnly = false }) {
  const settings = useAllLineSettings(IDS);
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60_000); return () => clearInterval(id); }, []);
  const ok = useMemo(() => (lines || []).filter((l) => l.ok), [lines]);
  const mx = useMemo(() => lossMatrix(ok, settings, { now: serverNow(), range }), [ok, settings, range, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState('rs');
  const [dive, setDive] = useState(null);
  const [rates, setRates] = useState(false);
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const anyRates = IDS.some((l) => hasRates(settings[l]?.money));
  const missing = useMemo(() => missingTargets(ok, settings), [ok, settings]);
  const effMode = mode === 'rs' && !anyRates ? 'pcs' : mode;

  const cellVal = (dl) => (!dl ? null : effMode === 'rs' ? dl.rsTotal : effMode === 'pcs' ? dl.short : dl.pct);
  const maxCell = Math.max(1, ...mx.days.flatMap((d) => mx.lines.map((l) => { const x = l.days[d]; return x && !x.skipped && effMode !== 'pct' ? cellVal(x) || 0 : 0; })));
  const heat = (dl) => {
    if (!dl || dl.skipped || !dl.hasPlan) return '';
    if (effMode === 'pct') return dl.pct >= 100 ? 'bg-sky-100' : dl.pct >= 90 ? 'bg-slate-100' : dl.pct >= 75 ? 'bg-slate-200' : 'bg-red-200';
    const r = (cellVal(dl) || 0) / maxCell;
    return r <= 0.001 ? 'bg-sky-100' : r < 0.25 ? 'bg-slate-50' : r < 0.5 ? 'bg-slate-100' : r < 0.75 ? 'bg-slate-200' : 'bg-red-200';
  };
  const show = (dl) => {
    if (!dl) return '';
    if (!dl.hasPlan) return 'no target';
    const v = cellVal(dl);
    return effMode === 'rs' ? rupees(v, { short: true }) : effMode === 'pcs' ? nf(v) : pctT(v);
  };
  const totShow = (t) => (effMode === 'rs' ? rupees(t.rsTotal, { short: true }) : effMode === 'pcs' ? nf(t.short) : pctT(t.pct));

  const setFromAchieved = async () => {
    setBusy(true); setMsg('');
    try {
      const end = latestDate, start = addDays(latestDate, -29);
      const cd = await api.controlDataAll(start, end);
      let n = 0;
      for (const l of IDS) {
        const need = new Set(missing.filter((m) => m.line === l).map((m) => String(m.mmId)));
        if (!need.size) continue;
        const ms = (cd.models || []).filter((m) => m.line === l).map((m) => ({ ...m, mmId: String(m.mmId).replace(/^L\d+-/, '') }));
        const ach = achievedByModel(ms);
        const items = [...need].filter((id) => ach[id]?.ach > 0).map((id) => {
          const m = missing.find((x) => x.line === l && String(x.mmId) === id);
          return { mmId: Number(id), cycle: ach[id].ach, model: m?.model || '', company: m?.company || '' };
        });
        if (items.length) { await api.saveLineSettings(l, { action: 'targets', items }); n += items.length; }
      }
      settingsChanged();
      setMsg(n ? `${n} targets set from the achieved cycle of the last 30 days.` : 'No achieved cycle found for the models without a target.');
    } catch (e) { setMsg(`Could not save: ${e.message}`); } finally { setBusy(false); setAsk(false); }
  };
  const excel = () => { const wb = lossMatrixWorkbook(mx, range); downloadXlsx(buildXlsx(wb.sheets), wb.fileName); };

  if (!ok.length) return null;
  const g = mx.grand;
  return (
    <>
      <Card title="Target and loss — all lines" sub={`${period} · day target from the model targets of each line; loss converted to ₹ with the line's rates.`}
        formula={`target = working time (lunch excluded) ÷ target cycle of the models made · short = target − actual · ₹ = short × ₹/pc + lost time × ₹/line-hour · days under ${SKIP_PCT}% of target are not counted`}
        right={(
          <div className="flex flex-wrap gap-1.5">
            {!readOnly && <button type="button" onClick={() => setRates(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-fs-13 font-bold hover:bg-slate-50"><IndianRupee size={14} /> Rates</button>}
            <button type="button" onClick={excel} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-fs-13 font-bold hover:bg-slate-50"><Download size={14} /> Excel</button>
          </div>
        )}>
        {!anyRates && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-fs-13 font-semibold text-slate-900">
            <Info size={15} /> ₹ rates are not set yet — the loss is shown in pieces and time.
            {!readOnly && <button type="button" onClick={() => setRates(true)} className="rounded-md bg-slate-600 px-2.5 py-1 text-white font-bold">Set ₹ rates</button>}
          </div>
        )}
        {missing.length > 0 && !readOnly && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-fs-13 font-semibold text-blue-900">
            <Target size={15} /> {missing.length} model{missing.length === 1 ? ' has' : 's have'} no target ({nf(missing.reduce((s, m) => s + m.qty, 0))} pcs in the period) — their hours take the target of the models around them, or none.
            {ask ? (
              <span className="inline-flex gap-1.5">
                <button type="button" disabled={busy} onClick={setFromAchieved} className="rounded-md bg-blue-700 px-2.5 py-1 text-white font-bold disabled:opacity-50">{busy ? 'Setting…' : 'Yes, set them'}</button>
                <button type="button" onClick={() => setAsk(false)} className="rounded-md border border-blue-300 px-2.5 py-1 font-bold">Cancel</button>
              </span>
            ) : <button type="button" onClick={() => setAsk(true)} className="rounded-md bg-blue-700 px-2.5 py-1 text-white font-bold">Set targets from achieved cycle</button>}
          </div>
        )}
        {msg && <div role="status" className={`mt-2 text-fs-13 font-semibold ${msg.startsWith('Not') ? 'text-red-700' : 'text-sky-700'}`}>{msg}</div>}

        <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-2">
          {[
            ['Actual', nf(g.actual), g.actualPlanned != null && g.actualPlanned !== g.actual ? `pcs · ${nf(g.actualPlanned)} on line-days with a target` : 'pcs, all lines'], ['Target', nf(g.target), `${g.plannedDays} line-days with a target`],
            ['Achievement', pctT(g.pct), 'Actual ÷ target', pctTone(g.pct)], ['Short', nf(g.short), `pcs · ${hm(g.lostSec)} lost`, g.short > 0 ? 'text-red-700' : ''],
            ['Total loss', rupees(g.rsTotal, { short: true }), g.rsTotal != null ? `${rupees(g.rsPcs, { short: true })} pcs + ${rupees(g.rsTime, { short: true })} time` : 'Set ₹ rates', g.rsTotal ? 'text-red-700' : ''],
          ].map(([l, v, s, tone]) => (
            <div key={l} className="rounded-xl border border-slate-200 px-3 py-2">
              <div className="text-fs-12 font-semibold text-slate-600">{l}</div>
              <div className={`font-mono text-fs-24 font-bold leading-tight ${tone || 'text-slate-900'}`} data-testid={`loss-${l.toLowerCase().replace(/\s+/g, '-')}`}>{v}</div>
              <div className="text-fs-12 text-slate-600">{s}</div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-fs-13" aria-label="Line-wise target and loss">
            <thead><tr className="text-left text-slate-600 border-b border-slate-200">
              {['Line', 'Actual', 'Target', 'Achieved', 'Short pcs', 'Lost time', '₹ pieces', '₹ line time', '₹ total', 'Rejected', 'Rates'].map((h) => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {mx.lines.map((l) => (
                <tr key={l.line} className="border-b border-slate-100 font-mono">
                  <td className="px-2.5 py-1.5 font-sans font-bold whitespace-nowrap"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: COLORS[l.line] }} />{l.name}</td>
                  <td className="px-2.5">{nf(l.total.actual)}</td><td className="px-2.5">{l.total.target != null ? nf(l.total.target) : <span className="font-sans text-slate-700">no targets</span>}</td>
                  <td className={`px-2.5 font-bold ${pctTone(l.total.pct)}`}>{pctT(l.total.pct)}</td>
                  <td className={`px-2.5 ${l.total.short > 0 ? 'text-red-700 font-bold' : ''}`}>{nf(l.total.short)}</td><td className="px-2.5 whitespace-nowrap">{hm(l.total.lostSec)}</td>
                  <td className="px-2.5 whitespace-nowrap">{rupees(l.total.rsPcs)}</td><td className="px-2.5 whitespace-nowrap">{rupees(l.total.rsTime)}</td>
                  <td className="px-2.5 whitespace-nowrap font-bold text-red-700">{rupees(l.total.rsTotal)}</td><td className="px-2.5">{nf(l.total.rej)}</td>
                  <td className="px-2.5 font-sans text-fs-12 text-slate-600 whitespace-nowrap">{hasRates(l.money) ? `${l.money.pcValue ? `₹${l.money.pcValue}/pc` : ''}${l.money.pcValue && l.money.hourCost ? ' · ' : ''}${l.money.hourCost ? `₹${l.money.hourCost}/hr` : ''}` : 'not set'}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-mono font-bold border-t-2 border-slate-300">
                <td className="px-2.5 py-2 font-sans">TOTAL</td><td className="px-2.5">{nf(g.actual)}</td><td className="px-2.5">{nf(g.target)}</td><td className={`px-2.5 ${pctTone(g.pct)}`}>{pctT(g.pct)}</td>
                <td className="px-2.5">{nf(g.short)}</td><td className="px-2.5 whitespace-nowrap">{hm(g.lostSec)}</td><td className="px-2.5 whitespace-nowrap">{rupees(g.rsPcs)}</td>
                <td className="px-2.5 whitespace-nowrap">{rupees(g.rsTime)}</td><td className="px-2.5 whitespace-nowrap text-red-700">{rupees(g.rsTotal)}</td><td className="px-2.5">{nf(g.rej)}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Daily loss matrix" sub="Day × line. Click a cell for the deep dive: hour by hour, reasons from the loss register and models."
        right={(
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 gap-0.5 text-fs-13 font-bold" role="group" aria-label="Matrix values">
            {[['rs', '₹ loss'], ['pcs', 'Short pcs'], ['pct', 'Achieved %']].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={effMode === k} disabled={k === 'rs' && !anyRates} title={k === 'rs' && !anyRates ? 'Set ₹ rates first' : undefined} onClick={() => setMode(k)}
                className={`rounded-md px-2.5 py-1 disabled:opacity-40 ${effMode === k ? 'bg-dixon-navy text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
        )}>
        {mx.days.length ? (
          <div className="overflow-auto max-h-[560px] mt-2 border border-slate-200 rounded-lg">
            <table className="w-full text-fs-13" aria-label="Daily loss matrix">
              <thead className="sticky top-0 z-10 bg-white"><tr className="text-left text-slate-600 border-b border-slate-200">
                <th className="px-2.5 py-2 font-semibold sticky left-0 bg-white">Date</th>
                {mx.lines.map((l) => <th key={l.line} className="px-2.5 py-2 font-semibold whitespace-nowrap text-right"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: COLORS[l.line] }} />{l.name}</th>)}
                <th className="px-2.5 py-2 font-semibold text-right">Total</th>
              </tr></thead>
              <tbody>
                {mx.days.map((d) => (
                  <tr key={d} className="border-b border-slate-100">
                    <td className="px-2.5 py-1.5 font-mono font-bold whitespace-nowrap sticky left-0 bg-white">{d}{d === mx.today ? <span className="ml-1 font-sans text-fs-11 text-blue-700">today, so far</span> : ''}</td>
                    {mx.lines.map((l) => {
                      const x = l.days[d];
                      return (
                        <td key={l.line} className={`px-1 py-1 text-right ${heat(x)}`}>
                          {x ? (
                            <button type="button" onClick={() => setDive({ line: l.line, date: d })} aria-label={`Deep dive Line ${l.line} ${d}`}
                              className={`w-full text-right font-mono px-1.5 py-0.5 rounded hover:ring-2 hover:ring-blue-400 ${x.skipped ? 'text-slate-400 line-through' : 'font-bold text-slate-900'}`}
                              title={x.skipped ? `Not counted: below ${SKIP_PCT}% of target` : `${nf(x.actual)} / ${nf(x.target)} pcs · short ${nf(x.short)} · ${rupees(x.rsTotal)}`}>{show(x)}</button>
                          ) : <span className="text-slate-300 px-1.5">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-2.5 text-right font-mono font-bold whitespace-nowrap">{totShow(mx.dayTotal[d])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-slate-100">
                <tr className="font-mono font-bold border-t-2 border-slate-300">
                  <td className="px-2.5 py-2 font-sans sticky left-0 bg-slate-100">TOTAL</td>
                  {mx.lines.map((l) => <td key={l.line} className="px-2.5 text-right whitespace-nowrap">{totShow(l.total)}</td>)}
                  <td className="px-2.5 text-right whitespace-nowrap text-red-700">{totShow(g)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <Empty>No production in this period.</Empty>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-fs-12 text-slate-600">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-100 border border-sky-200" /> target reached</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-200" /> small loss</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 border border-red-300" /> big loss</span>
          <span className="inline-flex items-center gap-1"><span className="line-through text-slate-400 font-mono">123</span> not counted (below {SKIP_PCT}% of target)</span>
        </div>
      </Card>

      {rates && <RatesDialog settings={settings} lines={ok} onClose={() => setRates(false)} />}
      {dive && <DeepDive mx={mx} line={dive.line} date={dive.date} onClose={() => setDive(null)} onNav={(line, date) => setDive({ line, date })} />}
    </>
  );
}
