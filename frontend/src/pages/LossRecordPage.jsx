import { LINE_COLOR, fs } from '../theme';
import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, Cell } from 'recharts';
import { Download, RefreshCw } from 'lucide-react';
import { Card, Empty } from '../components/UiKit';
import { api, LINE_IDS } from '../api';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { quickPeriods, matchPeriod, coKey } from '../utils/mainFilter';
import MultiSelect from '../components/MultiSelect';
import { rupees } from '../utils/money';
import { buildXlsx, downloadXlsx, colName } from '../utils/xlsxWriter';
import { hm as hmOle } from '../utils/ole';

const LCOL = LINE_COLOR;
const PAL = ['rgb(var(--navy))', '#2F6FD0', '#12866F', '#C9821A', '#7A4FB8', '#B42318', '#0E7490', '#64748B'];
const pad = (n) => String(n).padStart(2, '0');
const hm = (min) => hmOle(Number(min) || 0);   // the admin's time format (Setup → OLE formulas)
const dmy = (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const inp = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-14 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const tick = { fontSize: fs(12), fill: '#1E293B' };

function group(list, key) {
  const m = new Map();
  for (const e of list) { const k = key(e) || 'Not specified'; const o = m.get(k) || { k, min: 0, n: 0, rs: 0 }; o.min += e.minutes; o.n += 1; o.rs += e.rs || 0; m.set(k, o); }
  return [...m.values()].sort((a, b) => b.min - a.min);
}

function exportXlsx(list, range) {
  const head = (t, n) => ({ rows: [[{ v: t, s: 'title' }], [{ v: `All lines · ${dmy(range.start)} to ${dmy(range.end)}`, s: 'subtitle' }], []], merges: [`A1:${colName(n - 1)}1`, `A2:${colName(n - 1)}2`] });
  const C = [['Date', 12], ['Line', 8], ['Hour', 9], ['From', 8], ['To', 8], ['Model', 24], ['Loss (min)', 10], ['Loss ₹ (line time)', 14], ['Reason', 24], ['Department', 20], ['Responsible person', 18], ['Remarks', 34]];
  const s1 = head('Loss record', C.length); const h1 = s1.rows.length + 1;
  s1.rows.push(C.map(([h]) => ({ v: h, s: 'head' })));
  list.forEach((e) => s1.rows.push([{ v: dmy(e.date), s: 'center' }, { v: `Line ${e.line}`, s: 'center' }, { v: `${pad(e.hour)}-${pad(e.hour + 1)}`, s: 'center' }, { v: e.from || '', s: 'center' }, { v: e.to || '', s: 'center' },
    { v: e.model || 'Whole line', s: 'textBold' }, { v: e.minutes, s: 'int' }, { v: e.rs != null ? Math.round(e.rs) : null, s: 'int' }, { v: e.reason, s: 'text' }, { v: e.dept || '', s: 'text' }, { v: e.person || '', s: 'text' }, { v: e.remarks || '', s: 'wrap' }]));
  const tot = list.reduce((s, e) => s + e.minutes, 0);
  s1.rows.push([{ v: 'Total', s: 'totalLabel' }, null, null, null, null, { v: `${list.length} entries`, s: 'totalLabel' }, { v: tot, s: 'totalInt' }, { v: Math.round(list.reduce((s, e) => s + (e.rs || 0), 0)), s: 'totalInt' }, null, null, null, null].map((x) => x || { v: null, s: 'totalLabel' }));
  const sum = (name, title, label, key) => {
    const g = group(list, key);
    const S = [[label, 30], ['Entries', 10], ['Loss (min)', 12], ['Loss (h)', 10], ['Loss ₹', 14], ['Share (%)', 10]];
    const s = head(title, S.length); const hr = s.rows.length + 1;
    s.rows.push(S.map(([h]) => ({ v: h, s: 'head' })));
    g.forEach((x) => s.rows.push([{ v: x.k, s: 'textBold' }, { v: x.n, s: 'int' }, { v: x.min, s: 'int' }, { v: Math.round((x.min / 60) * 10) / 10, s: 'dec1' }, { v: Math.round(x.rs), s: 'int' }, { v: tot ? Math.round((x.min / tot) * 1000) / 10 : 0, s: 'dec1' }]));
    return { name, cols: S.map(([, w]) => ({ width: w })), rows: s.rows, merges: s.merges, freezeRow: hr, headerRow: hr };
  };
  downloadXlsx(buildXlsx([
    { name: 'Loss record', cols: C.map(([, w]) => ({ width: w })), rows: s1.rows, merges: s1.merges, freezeRow: h1, headerRow: h1, autoFilter: list.length ? `A${h1}:${colName(C.length - 1)}${h1 + list.length}` : null },
    sum('By reason', 'Loss by reason', 'Reason', (e) => e.reason),
    sum('By line', 'Loss by line', 'Line', (e) => `Line ${e.line}`),
    sum('By department', 'Loss by department', 'Department', (e) => e.dept),
    sum('By day', 'Loss by day', 'Day', (e) => dmy(e.date)),
  ]), `Loss_record_all_lines_${range.start}_to_${range.end}.xlsx`);
}

function HBars({ rows, color, money }) {
  if (!rows.length) return <Empty>No loss recorded.</Empty>;
  const data = rows.slice(0, 10).map((r, i) => ({ name: r.k, min: r.min, rs: r.rs, fill: typeof color === 'function' ? color(r, i) : color }));
  return (
    <div style={{ height: Math.max(180, data.length * 38) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="#EEF2F7" horizontal={false} />
          <XAxis type="number" tick={tick} tickFormatter={(v) => `${v}`} />
          <YAxis type="category" dataKey="name" width={150} tick={{ ...tick, fontSize: fs(12) }} interval={0} />
          <Tooltip formatter={(v, n, p) => [`${hm(v)}${money && p.payload.rs ? ` · ${rupees(p.payload.rs)}` : ''}`, 'Loss']} />
          <Bar dataKey="min" isAnimationActive={false} radius={[0, 4, 4, 0]}>
            {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
            <LabelList dataKey="min" position="right" formatter={(v) => hm(v).replace(/ /g, '\u00a0')} style={{ fontSize: fs(11), fill: '#334155', fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Loss register of every line, read only: what stopped the lines, for how long, and what it cost. */
export default function LossRecordPage({ latestDate }) {
  const periods = useMemo(() => quickPeriods(latestDate).filter((p) => ['today', 'yesterday', '7d', '30d', 'month', 'lastMonth'].includes(p.key)), [latestDate]);
  const [range, setRange] = useState(() => { const p = periods.find((x) => x.key === '7d'); return { start: p.start, end: p.end }; });
  const [lineSel, setLineSel] = useState('all');
  const [q, setQ] = useState('');
  const [coSel, setCoSel] = useState([]);
  const [moSel, setMoSel] = useState([]);
  const [coMap, setCoMap] = useState({});   // 'line:mmId' → company
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const settings = useAllLineSettings(LINE_IDS);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const res = await Promise.all(LINE_IDS.map((l) => api.losses(l, range.start, range.end).then((j) => (j.entries || []).map((e) => ({ ...e, line: l }))).catch(() => [])));
      setData(res.flat());
    } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range.start, range.end]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    Promise.all(LINE_IDS.map((l) => api.lineModels(l).then((ms) => (Array.isArray(ms) ? ms : []).map((m) => [`${l}:${m.mmId}`, m.companyTitle])).catch(() => [])))
      .then((r) => setCoMap(Object.fromEntries(r.flat())));
  }, []);

  // ₹ of an entry = its minutes × the line's cost per hour (when set)
  const all = useMemo(() => (data || []).map((e) => {
    const hc = Number(settings[e.line]?.money?.hourCost) || 0;
    return { ...e, minutes: Number(e.minutes) || 0, rs: hc > 0 ? ((Number(e.minutes) || 0) / 60) * hc : null, company: e.mmId != null ? coKey(coMap[`${e.line}:${e.mmId}`]) : 'Whole line' };
  }), [data, settings, coMap]);
  const coOpts = useMemo(() => { const m = new Map(); for (const e of all) { if (e.mmId == null) continue; const o = m.get(e.company) || { value: e.company, label: e.company, count: 0, pcs: 0 }; o.count++; o.pcs += e.minutes; m.set(e.company, o); } return [...m.values()].sort((a, b) => b.pcs - a.pcs); }, [all]);
  const moOpts = useMemo(() => { const m = new Map(); for (const e of all) { if (!e.model || (coSel.length && !coSel.includes(e.company))) continue; const o = m.get(e.model) || { value: e.model, label: `${e.model} · ${e.company}`, count: 0, pcs: 0 }; o.count++; o.pcs += e.minutes; m.set(e.model, o); } return [...m.values()].sort((a, b) => b.pcs - a.pcs); }, [all, coSel]);
  const list = all.filter((e) => (lineSel === 'all' || e.line === lineSel) && (!coSel.length || coSel.includes(e.company)) && (!moSel.length || moSel.includes(e.model)) && (!q || `${e.reason} ${e.dept} ${e.model} ${e.person} ${e.remarks}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.date + pad(b.hour) + (b.from || '')).localeCompare(a.date + pad(a.hour) + (a.from || '')));
  const total = list.reduce((s, e) => s + e.minutes, 0);
  const rs = list.some((e) => e.rs != null) ? list.reduce((s, e) => s + (e.rs || 0), 0) : null;
  const byReason = group(list, (e) => e.reason);
  const byLine = group(list, (e) => `Line ${e.line}`);
  const byDept = group(list, (e) => e.dept);
  const active = matchPeriod(latestDate, range)?.key;

  return (
    <div className="flex flex-col gap-3">
      <Card title="Loss record — all lines"
        right={(
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-fs-13 font-bold hover:bg-slate-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Reload</button>
            <button type="button" disabled={!list.length} onClick={() => exportXlsx(list, range)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 text-white px-3 py-1.5 text-fs-13 font-bold disabled:opacity-50"><Download size={14} /> Export Excel</button>
          </div>
        )}>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="inline-flex flex-wrap rounded-lg border border-slate-300 overflow-hidden text-fs-13 font-bold" role="group" aria-label="Period">
            {periods.map((p) => <button key={p.key} type="button" aria-pressed={active === p.key} onClick={() => setRange({ start: p.start, end: p.end })} className={`px-3 py-1.5 ${active === p.key ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{p.label}</button>)}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" aria-label="From date" className={inp} value={range.start} max={latestDate} onChange={(e) => e.target.value && setRange({ ...range, start: e.target.value })} />
            <span className="text-slate-500">→</span>
            <input type="date" aria-label="To date" className={inp} value={range.end} max={latestDate} onChange={(e) => e.target.value && setRange({ ...range, end: e.target.value })} />
          </div>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-fs-13 font-bold" role="group" aria-label="Line">
            {[['all', 'All lines'], ...LINE_IDS.map((l) => [l, `Line ${l}`])].map(([k, l]) => <button key={k} type="button" aria-pressed={lineSel === k} onClick={() => setLineSel(k)} className={`px-2.5 py-1.5 ${lineSel === k ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}
          </div>
          <div className="w-full sm:w-56"><MultiSelect label="Company" options={coOpts} selected={coSel} onChange={(v) => { setCoSel(v); setMoSel([]); }} /></div>
          <div className="w-full sm:w-64"><MultiSelect label="Model" options={moOpts} selected={moSel} onChange={setMoSel} /></div>
          <input className={`${inp} w-56`} placeholder="Search reason, model, person…" aria-label="Search losses" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            ['Total loss', hm(total), `${list.length} entries`],
            ['Loss ₹ (line time)', rs != null ? rupees(rs, { short: true }) : '—', rs != null ? 'minutes × ₹ per line-hour' : '₹ per line-hour not set'],
            ['Biggest reason', byReason[0]?.k || '—', byReason[0] ? `${hm(byReason[0].min)} · ${Math.round((byReason[0].min / (total || 1)) * 100)}%` : ''],
            ['Most affected line', byLine[0]?.k || '—', byLine[0] ? hm(byLine[0].min) : ''],
          ].map(([l, v, s]) => (
            <div key={l} className="rounded-xl border border-slate-200 px-3 py-2">
              <div className="text-fs-12 font-semibold text-slate-600">{l}</div>
              <div className="text-fs-20 font-bold leading-tight text-slate-900 truncate" data-testid={`lr-${l.split(' ')[0].toLowerCase()}`}>{v}</div>
              <div className="text-fs-12 text-slate-600">{s}</div>
            </div>
          ))}
        </div>
      </Card>

      {err && <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-fs-14 font-semibold text-red-800">{err}</div>}
      {!data && !err && <div className="bg-white border border-slate-200 rounded-xl shadow-sm py-16 text-center text-fs-14 font-semibold text-slate-600">Loading loss records…</div>}

      {data && (
        <>
          <div className="grid gap-3 xl:grid-cols-3">
            <Card title="By reason" sub="Top 10 reasons by time lost."><div className="mt-2" aria-label="Loss by reason chart"><HBars rows={byReason} color={(r, i) => PAL[i % PAL.length]} money /></div></Card>
            <Card title="By line" sub="Time lost per line."><div className="mt-2"><HBars rows={byLine} color={(r) => LCOL[r.k.replace('Line ', '')] || '#64748B'} money /></div></Card>
            <Card title="By department" sub="Who has to act."><div className="mt-2"><HBars rows={byDept} color="rgb(var(--navy))" money /></div></Card>
          </div>
          <Card title="All entries" sub={`${list.length} entries · newest first`}>
            {list.length ? (
              <div className="overflow-auto max-h-[560px] mt-2 border border-slate-200 rounded-lg">
                <table className="w-full text-fs-13" aria-label="Loss entries">
                  <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-slate-600 border-b border-slate-200">
                    {['Date', 'Line', 'Time', 'Loss', 'Reason', 'Department', 'Model', 'Person', 'Remarks', '₹'].map((h) => <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={`${e.line}-${e.id}`} className="border-b border-slate-100">
                        <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{dmy(e.date)}</td>
                        <td className="px-2.5 whitespace-nowrap"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: LCOL[e.line] }} />L{e.line}</td>
                        <td className="px-2.5 font-mono whitespace-nowrap">{e.from && e.to ? `${e.from}–${e.to}` : `${pad(e.hour)}-${pad(e.hour + 1)}`}</td>
                        <td className="px-2.5 font-mono font-bold text-red-700 whitespace-nowrap">{e.minutes} min</td>
                        <td className="px-2.5 font-semibold">{e.reason}</td>
                        <td className="px-2.5 text-slate-700">{e.dept || '—'}</td>
                        <td className="px-2.5 text-slate-700 whitespace-nowrap">{e.model || 'Whole line'}</td>
                        <td className="px-2.5 text-slate-700">{e.person || '—'}</td>
                        <td className="px-2.5 text-slate-600 min-w-[160px] max-w-[360px] break-words" title={e.remarks || ''}>{e.remarks || ''}</td>
                        <td className="px-2.5 font-mono whitespace-nowrap">{e.rs != null ? rupees(e.rs) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No loss recorded in this period{lineSel !== 'all' ? ` for Line ${lineSel}` : ''}.</Empty>}
          </Card>
        </>
      )}
    </div>
  );
}
