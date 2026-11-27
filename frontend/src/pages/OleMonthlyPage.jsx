import React, { useMemo, useState } from 'react';
import { useLastScans } from '../hooks/useLastScans';
import { BarChart, Bar, Cell, LabelList, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import AchKey from '../components/AchKey';
import { TARGET_GREY, achColor } from '../utils/achieve';
import { ChevronLeft, ChevronRight, CalendarDays, Factory } from 'lucide-react';
import { useAllLineSettings } from '../hooks/useLineSettings';
import useMediaQuery from '../hooks/useMediaQuery';
import { serverToday } from '../utils/serverTime';
import { oleRange, oleSum, hm, okFrom, watchFrom, modelPerf, planTargetOf } from '../utils/ole';
import MesDrawer from '../components/MesDrawer';
import { LINE_COLOR, nf, useOleLines, groupNameOf, useOleData, band, plantOf, plantsText, companyOf } from '../components/OleParts';
import HeaderBar, { segGroup, segBtn, arrowBtn, fieldCls } from '../components/HeaderBar';
import { BAND, fs } from '../theme';

/*
 * Monthly OLE — one year month by month, for the plant or one line:
 *   navy band with the year's OLE, best / lowest month → OLE per month (bars, benchmark line) → A · P · Q · OLE per month
 *   (lines) → analysis: line-wise OLE, lost time, pieces made, rejection % per month → the month table.
 * Same maths as Overall OLE (utils/ole.js oleRange / oleSum); the good / watch limits are the admin's (okFrom / watchFrom).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const card = 'rounded-md border border-slate-300 bg-white shadow-sm';
// one colour per measure (checked for colour-blind separation); never a line colour or a band colour
const SERIES = [['ole', 'OLE', '#4F46E5'], ['A', 'Availability', '#0891B2'], ['P', 'Performance', '#D9468C'], ['Q', 'Quality', '#8A6A12']];
const COL = Object.fromEntries(SERIES.map(([k, , c]) => [k, c]));
const QTY = '#2563EB', TGT = TARGET_GREY;   // 24-11-2026: target standard grey, actual green / orange / red by % achieved
const GRID = '#E2E8F0';
const BENCH = '#C00000';
const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => (v == null ? null : r1(v * 100));
const pc = (v) => (v == null ? '—' : `${r1(v * 100)}%`);
const tone = (v) => (v == null ? 'text-slate-500' : v >= okFrom() ? 'text-emerald-700' : v >= watchFrom() ? 'text-amber-700' : 'text-red-700');
const cellTone = (v) => (v == null ? '' : v >= okFrom() ? 'bg-emerald-50 text-emerald-800' : v >= watchFrom() ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800');
const hrs = (min) => hm(Math.max(0, Number(min) || 0));
const pts = (d) => (d == null ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(r1(d))} pts`);
const short = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
const tick = () => ({ fontSize: fs(12), fill: '#334155' });
const pctAxis = { domain: [0, (m) => Math.max(100, Math.ceil(m / 25) * 25)], allowDecimals: false, tickFormatter: (v) => `${v}%` };

/** section title: navy bar on the left, upper case; the chart's key on the right */
function Head({ title, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-4 py-2">
      <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-16 font-extrabold tracking-wide text-dixon-navy">{title}</h3>
      {children && <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-fs-12 font-semibold text-slate-600">{children}</div>}
    </div>
  );
}
/** a key of a chart: a swatch (box) or a line (dashed for the benchmark) */
function Key({ color, line = false, dash = false, children }) {
  const mark = line
    ? <i aria-hidden className="inline-block h-0.5 w-4" style={{ background: dash ? `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 8px)` : color }} />
    : <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{mark}{children}</span>;
}

/** a chart in its card; wide = scrolls sideways on a phone instead of squeezing the bars */
function ChartCard({ title, label, keys, height = 280, wide = false, children }) {
  return (
    <section className={`${card} min-w-0 overflow-hidden`} aria-label={title}>
      <Head title={title}>{keys}</Head>
      <div className={wide ? 'overflow-x-auto' : ''}>
        <div className={`px-2 pb-2 pt-3 ${wide ? 'min-w-[560px]' : ''}`} style={{ height }} role="img" aria-label={label}>
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

/** hover readout of one month: its name, then the values (value first, in the text colour) */
function MonthTip({ active, payload, rows }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="min-w-[170px] rounded-md border border-slate-200 bg-white px-3 py-2 text-fs-12 shadow-lg">
      <div className="mb-1 font-bold text-slate-900">{r.full}</div>
      {!r.run ? <div className="text-slate-500">No production</div> : rows(r).map(([k, v, color]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-px">
          <span className="flex items-center gap-1.5 text-slate-600">{color && <i aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}{k}</span>
          <b className="font-mono tabular-nums text-slate-900">{v}</b>
        </div>
      ))}
    </div>
  );
}
const tipProps = { cursor: { fill: 'rgba(148,163,184,0.14)' }, wrapperStyle: { outline: 'none' }, isAnimationActive: false };
const val = (v, unit = '%') => (v == null ? '—' : `${v}${unit}`);

/** a figure of the year in the band below the title */
function Tile({ label, value, sub, cls = 'text-slate-900', className = '' }) {
  return (
    <div className={`min-w-0 bg-white px-4 py-3 ${className}`}>
      <div className="truncate text-fs-13 font-bold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-fs-28 font-extrabold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-fs-13 font-semibold text-slate-600">{sub}</div>}
    </div>
  );
}

function Skeleton({ label, lines }) {
  const block = (h) => <span className={`lp-skel block ${h} rounded`} />;
  return (
    <div role="status" aria-live="polite" aria-label={label} className="flex flex-col gap-3">
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-3 bg-dixon-navy px-4 py-3">
          <span className="lp-skel lp-skel-dark block h-5 w-72 max-w-full rounded" />
          <span className="ml-auto text-fs-13 font-semibold text-white/85"><span className="lp-dots">{label}</span></span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex flex-col gap-2">{block('h-3')}{block('h-8')}</div>)}</div>
      </section>
      <div className={`${card} p-4`}>{block('h-[240px]')}</div>
      <div className="grid gap-3 xl:grid-cols-2">{Array.from({ length: lines > 1 ? 2 : 1 }, (_, i) => <div key={i} className={`${card} p-4`}>{block('h-[200px]')}</div>)}</div>
    </div>
  );
}

export default function OleMonthlyPage() {
  const ALL = useOleLines();
  const today = serverToday();
  // 26-11-2026: financial year (April → March): FY 2026-27 = Apr 2026 … Mar 2027; `year` = the year it starts in
  const thisYear = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const [only, setOnly] = useState('all');
  const [pick, setPick] = useState(null);   // a month picked: its models in a drawer (19-11-2026)
  const IDS = useMemo(() => (only !== 'all' && ALL.includes(only) ? [only] : ALL), [only, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [year, setYear] = useState(thisYear);
  const years = Array.from({ length: 4 }, (_, i) => thisYear - i);
  const fy = `FY ${year}-${String(year + 1).slice(2)}`;
  const start = `${year}-04-01`;
  const end = `${year + 1}-03-31` > today ? today : `${year + 1}-03-31`;
  const settings = useAllLineSettings(IDS);
  // a whole year: read once (no 20-second refresh of twelve months)
  const D = useOleData({ start, end, ids: IDS, paused: true });
  const R0 = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start, end, today, nowMin: D.endMin, ids: IDS }) : null),
    [D.al, D.ent, settings, start, end, today, D.endMin, IDS]);
  // 25-11-2026: the finished days end at the line's last scan, as in the HPR / SAWM KPI (same Plan Target Qty)
  const lastScans = useLastScans({ R: R0, ids: IDS, today });
  const R = useMemo(() => (R0 && Object.keys(lastScans).length ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start, end, today, nowMin: D.endMin, ids: IDS, lastScans }) : R0), [R0, lastScans]); // eslint-disable-line react-hooks/exhaustive-deps

  // month by month (up to this month): the plant / line total and every line
  const rows = useMemo(() => {
    if (!R) return [];
    const out = [];
    for (let i = 0; i < 12; i += 1) {
      const mi = (i + 3) % 12, cy = i >= 9 ? year + 1 : year;   // Apr … Dec of the start year, Jan … Mar of the next
      const ym = `${cy}-${String(mi + 1).padStart(2, '0')}`;
      if (`${ym}-01` > today) break;
      const ds = R.days.filter((d) => d.date.startsWith(ym));
      const t = oleSum(ds.map((d) => d.total));
      const run = ds.filter((d) => d.total.qty > 0).length;
      const on = run > 0 && t.ole != null;
      const row = {
        k: MONTHS[mi], ym, full: `${MONTHS[mi]} ${cy}`, run, on, t,
        ole: on ? pct(t.ole) : null, A: on ? pct(t.A) : null, P: on ? pct(t.P) : null, Q: on ? pct(t.Q) : null,
        qty: run ? t.qty : null, rejects: run ? t.rejects : null,
        // target pieces = what the run time could make at the std cycle (same as "Plan Target Qty" of Overall OLE)
        target: run ? planTargetOf(t) : null,
        idleH: run ? r1((t.lossMin || 0) / 60) : null, slowH: run ? r1((t.speedMin || 0) / 60) : null,
        rej: run && t.qty ? Math.round((t.rejects / t.qty) * 1000) / 10 : null,
      };
      for (const l of IDS) {
        const lt = oleSum(ds.map((d) => d.byLine[l]?.total));
        row[`L${l}`] = lt.qty > 0 && lt.ole != null ? pct(lt.ole) : null;
      }
      out.push(row);
    }
    const first = out.findIndex((r) => r.run > 0);
    return first > 0 ? out.slice(first) : out;
  }, [R, year, today, IDS]);
  const narrow = useMediaQuery('(max-width: 640px)');
  const labels = !narrow || rows.length <= 6;   // value labels on the bars only where they fit

  const T = R?.total || oleSum([]);
  const ran = rows.filter((r) => r.on);
  const best = ran.reduce((b, r) => (!b || r.t.ole > b.t.ole ? r : b), null);
  const worst = ran.reduce((b, r) => (!b || r.t.ole < b.t.ole ? r : b), null);
  const good = Math.round(okFrom() * 100);
  const watch = Math.round(watchFrom() * 100);
  const atGood = ran.filter((r) => r.t.ole >= okFrom()).length;
  const last = ran[ran.length - 1] || null;
  const prev = ran[ran.length - 2] || null;
  const change = last && prev ? (last.t.ole - prev.t.ole) * 100 : null;
  const group = groupNameOf(IDS);
  const allView = only === 'all' && IDS.length > 1;
  const title = allView ? `${plantsText(IDS)} · Monthly OLE` : `${plantOf(IDS[0]) ? `${plantOf(IDS[0])} · ` : ''}${group} · Monthly OLE`;
  const busy = !!R && (D.stale || D.loading);
  const said = (key) => ran.map((r) => `${r.k} ${r[key]}%`).join(', ') || 'no production';

  return (
    <div className="flex flex-col gap-3" aria-label="Monthly OLE">
      <HeaderBar label="Monthly OLE filters">
        {ALL.length > 1 && (
          <div className={segGroup} role="group" aria-label="Monthly OLE view">
            {['all', ...ALL].map((v) => (
              <button key={v} type="button" aria-pressed={only === v} onClick={() => setOnly(v)} aria-label={v === 'all' ? 'Monthly OLE of all lines' : `Monthly OLE of Line ${v}`}
                className={segBtn(only === v, 'navy')}>{v === 'all' ? 'Overall' : `Line ${v}`}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1" role="group" aria-label="Year">
          <button type="button" className={arrowBtn} onClick={() => setYear(year - 1)} disabled={year <= years[years.length - 1]} aria-label="Earlier financial year" title="Earlier financial year"><ChevronLeft size={15} aria-hidden /></button>
          <select aria-label="Financial year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={fieldCls}>
            {years.map((v) => <option key={v} value={v}>{`FY ${v}-${String(v + 1).slice(2)}`}</option>)}
          </select>
          <button type="button" className={arrowBtn} onClick={() => setYear(year + 1)} disabled={year >= thisYear} aria-label="Later financial year" title="Later financial year"><ChevronRight size={15} aria-hidden /></button>
        </div>
        {busy && <span className="text-fs-12 font-semibold text-slate-500">Updating …</span>}
      </HeaderBar>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}
      {!R && !D.err && <Skeleton label={`Reading ${group} · ${fy}`} lines={IDS.length} />}

      {R && (
        <>
          {/* the year: band + its figures */}
          <section className={`${card} overflow-hidden`} aria-label="Year OLE">
            <div className="flex flex-wrap items-center gap-2 bg-dixon-navy px-4 py-2.5 text-white">
              <h2 className="lp-caps min-w-0 flex-1 text-fs-18 font-extrabold tracking-wide sm:text-fs-22">{title}</h2>
              <span aria-label="Year" className="inline-flex items-center gap-1.5 rounded border border-white/40 bg-white/10 px-3 py-1 text-fs-15 font-bold"><CalendarDays size={15} aria-hidden />{fy}</span>
              <span aria-label="Lines" className="inline-flex items-center gap-1.5 rounded border border-white/40 bg-white/10 px-3 py-1 text-fs-15 font-bold"><Factory size={15} aria-hidden />{IDS.length === 1 ? `Line ${IDS[0]}` : <>Lines <b className="ml-1 rounded bg-white px-1.5 text-dixon-navy">{IDS.length}</b></>}</span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-slate-200 lg:grid-cols-5">
              <Tile label={`OLE ${fy}`} value={pc(T.ole)} cls={tone(T.ole)} sub={`A ${pc(T.A)} · P ${pc(T.P)} · Q ${pc(T.Q)}`} />
              <Tile label="Best month" value={best ? best.full : '—'} sub={best ? `OLE ${pc(best.t.ole)}` : ''} cls={best ? tone(best.t.ole) : 'text-slate-500'} />
              <Tile label="Lowest month" value={worst ? worst.full : '—'} sub={worst ? `OLE ${pc(worst.t.ole)}` : ''} cls={worst ? tone(worst.t.ole) : 'text-slate-500'} />
              <Tile label={`Months at ${good}%+`} value={ran.length ? `${atGood} of ${ran.length}` : '—'} cls={ran.length && atGood === ran.length ? 'text-emerald-700' : 'text-slate-900'} />
              <Tile label={last && prev ? `${last.k} vs ${prev.k}` : 'Month on month'} value={pts(change)} cls={change == null ? 'text-slate-500' : change >= 0 ? 'text-emerald-700' : 'text-red-700'} className="col-span-2 lg:col-span-1" />
            </div>
          </section>

          {!ran.length ? (
            <p className={`${card} px-4 py-10 text-center text-fs-14 font-semibold text-slate-500`}>No production in {fy}.</p>
          ) : (
            <>
              {/* OLE per month: bars in the band colours, the benchmark dashed */}
              <ChartCard title="Month-Wise OLE" label={`OLE per month ${fy}: ${said('ole')}`} height={300}
                keys={<><Key color={BAND.ok}>{good}% & above</Key><Key color={BAND.mid}>{watch}–{good}%</Key><Key color={BAND.bad}>Below {watch}%</Key><Key color={BENCH} line dash>{good}% benchmark</Key></>}>
                <BarChart data={rows} margin={{ top: 24, right: 12, left: 0, bottom: 0 }} barCategoryGap="26%">
                  <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
                  <YAxis {...pctAxis} tick={tick()} tickLine={false} axisLine={false} width={46} />
                  <Tooltip {...tipProps} content={<MonthTip rows={(r) => [['OLE', val(r.ole), COL.ole], ['Availability', val(r.A), COL.A], ['Performance', val(r.P), COL.P], ['Quality', val(r.Q), COL.Q], ['Qty', nf(r.qty)], ['Days run', r.run]]} />} />
                  <ReferenceLine y={good} stroke={BENCH} strokeDasharray="6 4" ifOverflow="extendDomain" />
                  <Bar dataKey="ole" name="OLE" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                    {rows.map((r) => <Cell key={r.ym} fill={band(r.on ? r.t.ole : null)} />)}
                    {labels && <LabelList dataKey="ole" position="top" formatter={(v) => (v == null ? '' : `${v}%`)} style={{ fontSize: fs(12), fontWeight: 700, fill: '#0F172A' }} />}
                  </Bar>
                </BarChart>
              </ChartCard>

              {/* OLE with its three factors: one line each */}
              <ChartCard title="OLE · A · P · Q Trend" label={`OLE, availability, performance and quality per month ${fy}`} height={300}
                keys={<>{SERIES.map(([k, n, c]) => <Key key={k} color={c} line>{n}</Key>)}<Key color={BENCH} line dash>{good}%</Key></>}>
                <LineChart data={rows} margin={{ top: 14, right: 18, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} padding={{ left: 18, right: 18 }} />
                  <YAxis {...pctAxis} tick={tick()} tickLine={false} axisLine={false} width={46} />
                  <Tooltip {...tipProps} cursor={{ stroke: '#94A3B8', strokeDasharray: '3 3' }} content={<MonthTip rows={(r) => SERIES.map(([k, n, c]) => [n, val(r[k]), c])} />} />
                  <ReferenceLine y={good} stroke={BENCH} strokeDasharray="6 4" ifOverflow="extendDomain" />
                  {SERIES.map(([k, n, c]) => (
                    <Line key={k} type="monotone" dataKey={k} name={n} stroke={c} strokeWidth={k === 'ole' ? 3 : 2} connectNulls={false} isAnimationActive={false}
                      dot={{ r: 4, fill: '#fff', stroke: c, strokeWidth: 2 }} activeDot={{ r: 5, fill: c, stroke: '#fff', strokeWidth: 2 }} />
                  ))}
                </LineChart>
              </ChartCard>

              {/* analysis */}
              <div className="grid gap-3 xl:grid-cols-2">
                {allView && (
                  <ChartCard title="Line-Wise OLE" label={`OLE of every line per month ${fy}`} wide
                    keys={IDS.map((l) => <Key key={l} color={LINE_COLOR[l]}>Line {l}{plantOf(l) ? ` · ${plantOf(l)}` : ''}</Key>)}>
                    <BarChart data={rows} margin={{ top: 14, right: 12, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={2}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
                      <YAxis {...pctAxis} tick={tick()} tickLine={false} axisLine={false} width={46} />
                      <Tooltip {...tipProps} content={<MonthTip rows={(r) => IDS.map((l) => [`Line ${l}`, val(r[`L${l}`]), LINE_COLOR[l]])} />} />
                      <ReferenceLine y={good} stroke={BENCH} strokeDasharray="6 4" ifOverflow="extendDomain" />
                      {IDS.map((l) => <Bar key={l} dataKey={`L${l}`} name={`Line ${l}`} fill={LINE_COLOR[l]} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />)}
                    </BarChart>
                  </ChartCard>
                )}
                <ChartCard title="Lost Time" label={`Idle time and slow running per month ${fy}, in hours`}
                  keys={<><Key color={COL.A}>Idle time</Key><Key color={COL.P}>Slow running</Key></>}>
                  <BarChart data={rows} margin={{ top: 14, right: 12, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
                    <YAxis allowDecimals={false} tickFormatter={(v) => `${v} h`} tick={tick()} tickLine={false} axisLine={false} width={50} />
                    <Tooltip {...tipProps} content={<MonthTip rows={(r) => [['Idle time', hrs(r.t.lossMin), COL.A], ['Slow running', hrs(r.t.speedMin), COL.P], ['Lost time', hrs((r.t.lossMin || 0) + (r.t.speedMin || 0))]]} />} />
                    <Bar dataKey="idleH" name="Idle time" stackId="t" fill={COL.A} stroke="#fff" strokeWidth={1} maxBarSize={48} isAnimationActive={false} />
                    <Bar dataKey="slowH" name="Slow running" stackId="t" fill={COL.P} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                  </BarChart>
                </ChartCard>
                <ChartCard title="Target vs Actual Qty" label={`Target and actual qty per month ${fy}`}
                  keys={<AchKey />}>
                  <BarChart data={rows} margin={{ top: 22, right: 12, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
                    <YAxis allowDecimals={false} tickFormatter={short} tick={tick()} tickLine={false} axisLine={false} width={50} />
                    <Tooltip {...tipProps} content={<MonthTip rows={(r) => [['Target', nf(r.target), TGT], ['Actual', nf(r.qty), achColor(r.qty, r.target, QTY)], ['Achieved', r.target ? `${Math.round((r.qty / r.target) * 1000) / 10}%` : '—'], ['Rejected', nf(r.rejects)], ['Days run', r.run]]} />} />
                    {/* 19-11-2026: one label per month (the actual) — the target is in the tooltip, labels never overlap */}
                    <Bar dataKey="target" name="Target" fill={TGT} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} cursor="pointer" onClick={(e) => e?.payload?.run && setPick(e.payload)} />
                    <Bar dataKey="qty" name="Actual" fill={QTY} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} cursor="pointer" onClick={(e) => e?.payload?.run && setPick(e.payload)}>
                      {rows.map((r, i) => <Cell key={i} fill={achColor(r.qty, r.target, QTY)} />)}
                      {labels && <LabelList dataKey="qty" position="top" formatter={(v) => (v ? short(v) : '')} style={{ fontSize: fs(11), fontWeight: 700, fill: '#334155' }} />}
                    </Bar>
                  </BarChart>
                </ChartCard>
                <ChartCard title="Rejection %" label={`Rejected pieces as % of the pieces made, per month ${fy}`}>
                  <LineChart data={rows} margin={{ top: 14, right: 18, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="k" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} padding={{ left: 18, right: 18 }} />
                    <YAxis domain={[0, (m) => Math.max(1, Math.ceil(m))]} tickFormatter={(v) => `${v}%`} tick={tick()} tickLine={false} axisLine={false} width={46} />
                    <Tooltip {...tipProps} cursor={{ stroke: '#94A3B8', strokeDasharray: '3 3' }} content={<MonthTip rows={(r) => [['Rejection', val(r.rej), COL.Q], ['Rejected', nf(r.rejects)], ['Qty', nf(r.qty)]]} />} />
                    <Line type="monotone" dataKey="rej" name="Rejection %" stroke={COL.Q} strokeWidth={2} connectNulls={false} isAnimationActive={false}
                      dot={{ r: 4, fill: '#fff', stroke: COL.Q, strokeWidth: 2 }} activeDot={{ r: 5, fill: COL.Q, stroke: '#fff', strokeWidth: 2 }} />
                  </LineChart>
                </ChartCard>
              </div>

              {/* the numbers behind the charts */}
              <section className={`${card} overflow-hidden`} aria-label="Monthly OLE table">
                <Head title={`${fy} Month by Month`} />
                <div className="overflow-x-auto">
                  <table className="w-full text-fs-14" aria-label={`OLE month by month ${fy}`}>
                    <thead>
                      <tr className="bg-[#e3ecf8] text-left text-fs-12 text-dixon-navy">
                        {['Month', 'Days run', 'Target', 'Qty', 'Achieved', 'Availability', 'Performance', 'Quality', 'OLE', 'vs last month', 'Idle time', 'Slow running', 'Rejection %'].map((h, i) => (
                          <th key={h} className={`whitespace-nowrap border-b border-slate-300 px-3 py-2 font-extrabold ${i ? 'text-right' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const before = rows.slice(0, i).reverse().find((x) => x.on);
                        const d = r.on && before ? (r.t.ole - before.t.ole) * 100 : null;
                        return (
                          <tr key={r.ym} onClick={r.run ? () => setPick(r) : undefined} className={`border-b border-slate-100 last:border-b-0 ${r.run ? 'cursor-pointer hover:bg-blue-50' : 'text-slate-400'}`} aria-label={`Month ${r.full}`}>
                            <td className="whitespace-nowrap px-3 py-2 font-bold">{r.full}{r.run ? <span className="ml-1 text-[#2E75B6]">›</span> : null}</td>
                            <td className="px-3 text-right font-mono">{r.run || '—'}</td>
                            <td className="px-3 text-right font-mono">{r.target != null ? nf(r.target) : '—'}</td>
                            <td className="px-3 text-right font-mono">{r.run ? nf(r.qty) : '—'}</td>
                            <td className={`px-3 text-right font-mono font-bold ${r.target ? (r.qty >= r.target ? 'text-emerald-700' : 'text-red-700') : ''}`}>{r.target ? `${Math.round((r.qty / r.target) * 1000) / 10}%` : '—'}</td>
                            {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-3 text-right font-mono font-bold ${r.on ? cellTone(r.t[k]) : ''}`}>{r.on ? pc(r.t[k]) : '—'}</td>)}
                            <td className={`whitespace-nowrap px-3 text-right font-mono font-semibold ${d == null ? '' : d >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{d == null ? '—' : pts(d)}</td>
                            <td className="whitespace-nowrap px-3 text-right font-mono">{r.run ? hrs(r.t.lossMin) : '—'}</td>
                            <td className="whitespace-nowrap px-3 text-right font-mono">{r.run ? hrs(r.t.speedMin) : '—'}</td>
                            <td className="px-3 text-right font-mono">{r.rej == null ? '—' : `${r.rej}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold" aria-label={fy}>
                        <td className="px-3 py-2">{fy}</td>
                        <td className="px-3 text-right font-mono">{rows.reduce((a, r) => a + r.run, 0)}</td>
                        <td className="px-3 text-right font-mono">{planTargetOf(T) != null ? nf(planTargetOf(T)) : '—'}</td>
                        <td className="px-3 text-right font-mono">{nf(T.qty)}</td>
                        <td className="px-3 text-right font-mono">{(T.Praw ?? T.P) > 0 ? `${Math.round((T.Praw ?? T.P) * 1000) / 10}%` : '—'}</td>
                        {['A', 'P', 'Q', 'ole'].map((k) => <td key={k} className={`px-3 text-right font-mono ${cellTone(T[k])}`}>{pc(T[k])}</td>)}
                        <td className="px-3 text-right font-mono">—</td>
                        <td className="whitespace-nowrap px-3 text-right font-mono">{hrs(T.lossMin)}</td>
                        <td className="whitespace-nowrap px-3 text-right font-mono">{hrs(T.speedMin)}</td>
                        <td className="px-3 text-right font-mono">{T.qty ? `${Math.round((T.rejects / T.qty) * 1000) / 10}%` : '—'}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
      {pick && R && <MonthModels row={pick} R={R} ids={IDS} co={companyOf(D.al)} onClose={() => setPick(null)} />}
    </div>
  );
}

/** One month, model by model (per line): target, actual, short / excess, achieved, std / actual cycle, time lost — Excel in the drawer head. */
function MonthModels({ row, R, ids, onClose, co = () => '' }) {
  const Rm = { days: (R.days || []).filter((d) => d.date.startsWith(row.ym)) };
  const list = modelPerf(Rm, ids).sort((a, b) => Number(a.line) - Number(b.line) || b.qty - a.qty);
  const tot = list.reduce((a, x) => ({ qty: a.qty + x.qty, target: a.target + (x.target || 0), lost: a.lost + (x.lostMin || 0) }), { qty: 0, target: 0, lost: 0 });
  const sec = (v) => (v == null ? '—' : `${Math.round(v * 10) / 10}s`);
  const se = (v) => (v == null ? '—' : v > 0 ? `+${nf(v)}` : v < 0 ? `−${nf(-v)}` : '0');
  const th = 'whitespace-nowrap border border-[#BFBFBF] px-2 py-1.5 font-bold';
  return (
    <MesDrawer title={`${row.full} — model wise`} sub={`${groupNameOf(ids)} · ${row.run} day${row.run === 1 ? '' : 's'} run · OLE ${row.on ? `${row.ole}%` : '—'}`} icon={CalendarDays} onClose={onClose} width={70} fit label={`${row.full} models`}>
      <div className="p-3">
        {!list.length ? <p className="text-fs-14 text-slate-600">No production in this month.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-fs-14 tabular-nums" aria-label={`${row.full} models`}>
              <thead><tr className="bg-[#DDEBF7] text-left text-fs-13 text-[#1F3864]">{['Line', 'Company', 'Model', 'Target', 'Actual', 'Short / Excess', 'Achieved', 'Std CT', 'Actual CT', 'Time lost'].map((h, i) => <th key={h} className={`${th} ${i > 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {list.map((x, i) => (
                  <tr key={x.key} className={`hover:bg-[#DDEBF7]/50 ${i && list[i - 1].line !== x.line ? 'border-t-2 border-t-[#1F3864]' : ''}`}>
                    <td className="whitespace-nowrap border border-[#D4D4D4] px-2 py-1 font-bold">Line {x.line}</td>
                    <td className="whitespace-nowrap border border-[#D4D4D4] px-2 text-fs-12 font-bold uppercase text-[#555]">{co(x.model) || '—'}</td>
                    <td className="border border-[#D4D4D4] px-2 font-mono font-semibold">{x.model}</td>
                    <td className="border border-[#D4D4D4] px-2 text-right font-mono">{x.target == null ? '—' : nf(x.target)}</td>
                    <td className="border border-[#D4D4D4] px-2 text-right font-mono font-bold">{nf(x.qty)}</td>
                    <td className={`whitespace-nowrap border border-[#D4D4D4] px-2 text-right font-bold ${x.short == null ? '' : x.short < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{x.few ? '—' : se(x.short)}</td>
                    <td className={`border border-[#D4D4D4] px-2 text-right font-mono font-bold ${x.ach == null || x.few ? '' : x.ach >= 1 ? 'text-emerald-700' : 'text-red-700'}`}>{x.ach == null || x.few ? '—' : `${Math.round(x.ach * 1000) / 10}%`}</td>
                    <td className="border border-[#D4D4D4] px-2 text-right font-mono">{sec(x.std)}</td>
                    <td className={`border border-[#D4D4D4] px-2 text-right font-mono ${x.std && x.act > x.std * 1.005 && !x.few ? 'font-bold text-red-700' : ''}`}>{x.few ? '—' : sec(x.act)}</td>
                    <td className="whitespace-nowrap border border-[#D4D4D4] px-2 text-right font-mono">{x.lostMin == null || x.few ? '—' : hrs(Math.max(0, x.lostMin))}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className="border border-[#BFBFBF] px-2 py-1.5" colSpan={3}>Total</td>
                  <td className="border border-[#BFBFBF] px-2 text-right font-mono">{nf(tot.target)}</td>
                  <td className="border border-[#BFBFBF] px-2 text-right font-mono">{nf(tot.qty)}</td>
                  <td className={`whitespace-nowrap border border-[#BFBFBF] px-2 text-right ${tot.qty < tot.target ? 'text-red-700' : 'text-emerald-700'}`}>{se(tot.qty - tot.target)}</td>
                  <td className="border border-[#BFBFBF] px-2 text-right font-mono">{tot.target ? `${Math.round((tot.qty / tot.target) * 1000) / 10}%` : '—'}</td>
                  <td className="border border-[#BFBFBF]" /><td className="border border-[#BFBFBF]" />
                  <td className="whitespace-nowrap border border-[#BFBFBF] px-2 text-right font-mono">{hrs(Math.max(0, tot.lost))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MesDrawer>
  );
}
