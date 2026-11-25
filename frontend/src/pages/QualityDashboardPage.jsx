import React, { useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts';
import { Download, FileSpreadsheet } from 'lucide-react';
import HeaderBar, { segGroup, segBtn } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { PeriodBar } from '../components/PeriodBar';
import { serverToday } from '../utils/serverTime';
import { nf, dmy, p2, useOleData, useOleLines, groupNameOf, DEFAULT_QUALITY } from '../components/OleParts';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { oleRange, stationsFor } from '../utils/ole';
import { reworkSheet, lineName, hourCol } from '../utils/reworkReport';
import { qualityDash, qualitySheets } from '../utils/qualityDash';
import { ftyRows, stageSummary, stageDetail, KPI_STAGES, KPI_LINES } from '../utils/kpiStages';
import MesDrawer from '../components/MesDrawer';
import { ChevronRight, Layers } from 'lucide-react';
import { exportPanel } from '../utils/domExcel';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';
import { fs } from '../theme';

/**
 * Quality dashboard (23-11-2026) — one page for quality: pieces made against pieces reworked (old rejection counted as
 * rework), rework % and PPM, dismantled, FPY / RTY against the admin's targets, RCA still to write, the trend,
 * each line, the defect Pareto, category (Production, Assy, Part, Process, Moulding, Kitting Store, Plastic Store),
 * stations, models and the hour of the day. Excel of all of it. (utils/qualityDash.js)
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const NAVY = '#1F3864', GRID = '#E2E8F0', RED = '#B91C1C';
const tick = () => ({ fontSize: fs(12), fill: '#334155' });
const pc = (v, d = 2) => (v == null ? '—' : `${v.toFixed(d)}%`);
const yp = (v) => (v == null ? '—' : `${(v * 100).toFixed(v >= 0.9995 && v < 1 ? 2 : 1)}%`);
const th = 'border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-fs-12 font-extrabold text-slate-700';
const td = 'border-b border-slate-100 px-2 py-1.5';

function Tile({ name, value, sub, tone = 'text-slate-900', onClick, testid }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C type={onClick ? 'button' : undefined} onClick={onClick} data-testid={testid}
      className={`min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm ${onClick ? 'lp-ed-hit cursor-pointer hover:bg-slate-50' : ''}`}>
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className={`lp-clamp2 mt-1 font-extrabold leading-tight tabular-nums ${typeof value === 'string' && !/\d/.test(value) && value.length > 9 ? 'text-fs-20' : 'font-mono text-fs-28'} ${tone}`} title={String(value)}>{value}</div>   {/* 25-11-2026: a name (top stage, category) in a smaller font */}
      {sub && <div className="lp-clamp2 mt-1 text-fs-12 text-slate-600" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>}
    </C>
  );
}
function Title({ children, right }) {
  return <div className="mb-2 flex flex-wrap items-baseline gap-2"><h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">{children}</h3>{right && <span className="ml-auto text-fs-12 font-semibold text-slate-500">{right}</span>}</div>;
}
const Empty = () => <p className="py-4 text-center text-fs-13 font-semibold text-slate-500">No rework in this period.</p>;

/** ranked bars of one hue; `right` = the text after the bar */
function Ranked({ rows, label, max = 10, right }) {
  const top = rows.slice(0, max);
  const hi = Math.max(1, ...top.map((r) => r.bad));
  if (!top.length) return <Empty />;
  return (
    <div className="flex flex-col gap-1" role="list" aria-label={label}>
      {top.map((r) => (
        <div key={r.name} role="listitem" className="grid items-center gap-2 px-1 py-0.5 text-fs-13" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr) 6.5rem' }} title={r.title || r.name}>
          <span className="lp-clamp2 font-semibold text-slate-800">{r.label || r.name}</span>
          <span className="h-3 overflow-hidden rounded bg-slate-100"><span className="block h-full rounded" style={{ width: `${(r.bad / hi) * 100}%`, background: NAVY }} /></span>
          <span className="text-right font-mono font-bold text-slate-900">{right(r)}</span>
        </div>
      ))}
    </div>
  );
}

export default function QualityDashboardPage({ onOpen = null, canOpen = [] }) {
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: `${today.slice(0, 8)}01`, end: today });
  const [sel, setSel] = useState('all');
  const IDS = sel === 'all' ? ALL : [sel];
  const oneDay = range.start === range.end;
  const settings = useAllLineSettings(ALL);
  const D = useOleData({ start: range.start, end: range.end, ids: ALL });
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, range.start, range.end, today, D.endMin, ALL]); // eslint-disable-line react-hooks/exhaustive-deps
  const stations = D.ent.reasons.station || [];
  const names = useMemo(() => stationsFor(stations, IDS, { all: true }), [stations, IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet = useMemo(() => (R ? reworkSheet({ entries: D.ent.entries || {}, start: range.start, end: range.end, ids: IDS, stations, kinds: ['rework', 'reject'] }).rows : null),
    [R, D.ent, range.start, range.end, IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const Q = useMemo(() => (R && sheet ? qualityDash({ days: R.days, ids: IDS.map(String), stations: names, sheet, rca: D.ent.rca || {}, oneDay }) : null),
    [R, sheet, D.ent.rca, IDS.join(), names, oneDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const [stage, setStage] = useState(null);   // { idx, line } of the stage drawer (click a stage)
  // 25-11-2026: the assembly stages (HVIR → Leakage → Functional → Front → Pre-final → Final): stage FPY and RTY = Π, per line
  const S = useMemo(() => {
    if (!R) return null;
    const rows = ftyRows(R.days, IDS.map(String), stations, D.ent.kpi || {});
    return { all: stageSummary(rows), lines: IDS.map((l) => ({ line: String(l), ...stageSummary(rows.filter((r) => r.line === String(l))) })) };
  }, [R, IDS.join(), stations, D.ent.kpi]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = { ...DEFAULT_QUALITY, ...(D.ent.reasons.quality || {}) };
  const fpyT = qs.fpyTarget / 100, rtyT = qs.rtyTarget / 100;
  const limit = 100 - qs.fpyTarget;   // rework % allowed by the FPY target
  const bodyRef = useRef(null);
  const periodText = oneDay ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  const group = sel === 'all' ? groupNameOf(ALL) : `Line ${sel}`;
  const go = (id) => (onOpen && canOpen.includes(id) ? () => onOpen(id) : undefined);
  const rateTone = (v) => (v == null ? 'text-slate-500' : v <= limit ? 'text-emerald-700' : 'text-red-700');
  const yTone = (v, t) => (v == null ? 'text-slate-500' : v >= t ? 'text-emerald-700' : 'text-red-700');
  const excel = () => downloadXlsx(buildXlsx(qualitySheets(Q, { title: `Quality — ${group}`, period: periodText, lineName })), `Quality dashboard ${group} ${range.start}${oneDay ? '' : `_${range.end}`}.xlsx`);

  if (!ALL.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  const t = Q?.total;
  const heatMax = Math.max(1, ...(Q?.heat || []).flatMap((h) => Object.values(h.by)));
  return (
    <div className="flex flex-col gap-3" aria-label="Quality dashboard" role="region">
      <HeaderBar label="Quality dashboard filters">
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!R} />
        <button type="button" disabled={!Q} onClick={() => exportPanel(bodyRef.current, `Quality dashboard ${group}`, periodText)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50" aria-label="Download the screen as Excel">
          <FileSpreadsheet size={15} aria-hidden="true" /> Screen
        </button>
        <button type="button" disabled={!Q} onClick={excel} data-testid="qd-excel"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-700 bg-blue-700 px-2.5 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-50" aria-label="Download the quality Excel">
          <Download size={15} aria-hidden="true" /> Excel
        </button>
      </HeaderBar>
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!Q ? <PageLoader label="Reading the lines" sub="Pieces made, rework, defects" /> : (
        <div ref={bodyRef} className="flex flex-col gap-3">
          <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7" aria-label="Quality of the period">
            <Tile testid="qd-made" name="Pieces made" value={nf(t.made)} sub={group} />
            <Tile testid="qd-bad" name="Rework pcs" value={nf(t.bad)} sub={`${nf(t.defects)} defect types`} tone={t.bad ? 'text-red-700' : 'text-slate-900'} />
            <Tile testid="qd-pct" name="Rework %" value={pc(t.pct)} sub={t.ppm == null ? '—' : `${nf(t.ppm)} PPM · limit ${limit.toFixed(1)}%`} tone={rateTone(t.pct)} />
            <Tile testid="qd-dis" name="Dismantled" value={nf(t.dismantle)} sub={t.bad ? `${Math.round((t.dismantle / t.bad) * 100)}% of the rework` : '—'} tone={t.dismantle ? 'text-red-700' : 'text-slate-900'} />
            <Tile testid="qd-fpy" name="FPY" value={yp(t.fpy)} sub={`Target ${qs.fpyTarget}%`} tone={yTone(t.fpy, fpyT)} />
            <Tile testid="qd-rty" name="RTY" value={yp(S?.all.rty ?? t.rty)} sub={`Π of the 6 stages · target ${qs.rtyTarget}%`} tone={yTone(S?.all.rty ?? t.rty, rtyT)} />
            <Tile testid="qd-rca" name="RCA pending" value={nf(t.rcaOpen)} sub={`of ${nf(t.rcaAll)} rework issues`} tone={t.rcaOpen ? 'text-amber-700' : 'text-emerald-700'} onClick={go('rca')} />
          </section>

          {S && <StageFlow S={S} fpyT={fpyT} rtyT={rtyT} qs={qs} onPick={(idx, line = '') => setStage({ idx, line })} />}
          {S && stage && <StageDrawer S={S} sheet={sheet || []} stations={stations} pick={stage} setPick={setStage} onClose={() => setStage(null)} fpyT={fpyT} group={group} period={periodText} ids={IDS.map(String)} />}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className={card} aria-label="Rework trend">
              <Title right={`rework % · red over ${limit.toFixed(1)}%`}>{oneDay ? 'Hour by hour' : 'Day by day'}</Title>
              <div className="h-[240px]">
                {!Q.trend.length ? <p className="grid h-full place-items-center text-fs-13 font-semibold text-slate-500">No pieces in this period.</p> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Q.trend.map((d) => ({ ...d, v: d.pct == null ? 0 : Number(d.pct.toFixed(2)) }))} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                      <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="label" tick={tick()} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval={0} />
                      <YAxis tick={tick()} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => `${Number(v).toFixed(v >= 10 ? 0 : 2)}%`} />
                      <Tooltip cursor={{ fill: 'rgba(148,163,184,0.14)' }} isAnimationActive={false}
                        labelFormatter={(_, p) => { const d = p?.[0]?.payload; return d ? (oneDay ? hourCol(Number(d.key)) : dmy(d.key)) : ''; }}
                        formatter={(v, _, p) => [`${v}% · ${nf(p.payload.bad)} of ${nf(p.payload.made)} pcs`, 'Rework']} />
                      <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                        {Q.trend.map((d) => <Cell key={d.key} fill={d.pct != null && d.pct > limit ? RED : NAVY} />)}
                        <LabelList dataKey="v" position="top" formatter={(v) => (v && (Q.trend.length <= 14 || v > limit) ? v : '')} style={{ fontSize: fs(11), fill: '#334155', fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
            <section className={card} aria-label="Lines">
              <Title right={worstText(Q.worstLine, lineName)}>Line by line</Title>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-fs-13">
                  <thead><tr><th className={th}>Line</th><th className={`${th} text-right`}>Made</th><th className={`${th} text-right`}>Rework</th><th className={`${th} text-right`}>%</th><th className={`${th} text-right`}>PPM</th><th className={`${th} text-right`}>Dism.</th><th className={`${th} text-right`}>FPY</th><th className={th}>Top defect</th><th className={`${th} text-right`}>RCA</th></tr></thead>
                  <tbody>
                    {Q.lines.map((r) => (
                      <tr key={r.line} className="hover:bg-slate-50">
                        <td className={`${td} whitespace-nowrap font-bold text-slate-800`}>{lineName(r.line)}</td>
                        <td className={`${td} text-right font-mono`}>{nf(r.made)}</td>
                        <td className={`${td} text-right font-mono font-bold`}>{nf(r.bad)}</td>
                        <td className={`${td} text-right font-mono font-bold ${rateTone(r.pct)}`}>{pc(r.pct)}</td>
                        <td className={`${td} text-right font-mono`}>{r.ppm == null ? '—' : nf(r.ppm)}</td>
                        <td className={`${td} text-right font-mono`}>{nf(r.dismantle)}</td>
                        <td className={`${td} text-right font-mono font-bold ${yTone(r.fpy, fpyT)}`}>{yp(r.fpy)}</td>
                        <td className={`${td} max-w-[180px] truncate text-slate-700`} title={r.top}>{r.top || '—'}</td>
                        <td className={`${td} text-right font-mono ${r.rcaOpen ? 'font-bold text-amber-700' : 'text-slate-500'}`}>{r.rcaOpen}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <section className={card} aria-label="Top defects">
              <Title right="pcs · share · Σ running">Top defects (Pareto)</Title>
              <Ranked rows={Q.defects} label="Top defects" right={(r) => <>{nf(r.bad)} <span className="text-fs-11 font-semibold text-slate-500">{Math.round(r.share || 0)}% · Σ{Math.round(r.cum || 0)}</span></>} />
            </section>
            <section className={card} aria-label="Category">
              <Title right="pcs · share">Category</Title>
              <Ranked rows={Q.cats} label="Category" right={(r) => <>{nf(r.bad)} <span className="text-fs-11 font-semibold text-slate-500">{Math.round(r.share || 0)}%</span></>} />
            </section>
            <section className={card} aria-label="Stations">
              <Title right="pcs · station FPY">Stations</Title>
              <Ranked rows={Q.stations.filter((s) => s.bad > 0)} label="Stations" right={(r) => <>{nf(r.bad)} <span className={`text-fs-11 font-semibold ${yTone(r.fpy, fpyT)}`}>{yp(r.fpy)}</span></>} />
            </section>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className={card} aria-label="Models">
              <Title right={worstText(Q.worstModel, (n) => n)}>Models</Title>
              {!Q.models.length ? <Empty /> : (
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full border-collapse text-fs-13">
                    <thead className="sticky top-0"><tr><th className={th}>Model</th><th className={`${th} text-right`}>Made</th><th className={`${th} text-right`}>Rework</th><th className={`${th} text-right`}>%</th><th className={`${th} text-right`}>PPM</th><th className={th}>Top defect</th></tr></thead>
                    <tbody>
                      {Q.models.map((r) => (
                        <tr key={r.name} className="hover:bg-slate-50">
                          <td className={`${td} whitespace-nowrap font-semibold text-slate-800`}>{r.name}</td>
                          <td className={`${td} text-right font-mono`}>{nf(r.made)}</td>
                          <td className={`${td} text-right font-mono font-bold`}>{nf(r.bad)}</td>
                          <td className={`${td} text-right font-mono font-bold ${r.bad ? rateTone(r.pct) : 'text-slate-500'}`}>{pc(r.pct)}</td>
                          <td className={`${td} text-right font-mono`}>{r.ppm == null ? '—' : nf(r.ppm)}</td>
                          <td className={`${td} max-w-[200px] truncate text-slate-700`} title={r.top}>{r.top || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className={card} aria-label="Line and hour">
              <Title right="rework pcs">Line × hour of the day</Title>
              {!Q.hours.length ? <Empty /> : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-center text-fs-12">
                    <thead><tr><th className={th}>Line</th>{Q.hours.map((h) => <th key={h} className={`${th} text-center font-mono`} title={hourCol(h)}>{p2(h)}</th>)}<th className={`${th} text-right`}>Total</th></tr></thead>
                    <tbody>
                      {Q.heat.map((r) => (
                        <tr key={r.line}>
                          <td className={`${td} whitespace-nowrap text-left font-bold text-slate-800`}>{lineName(r.line)}</td>
                          {Q.hours.map((h) => {
                            const n = r.by[h] || 0;
                            const a = n ? 0.12 + 0.78 * (n / heatMax) : 0;
                            return <td key={h} className="border border-white px-1 py-1.5 font-mono font-bold" title={`${lineName(r.line)} ${hourCol(h)}: ${n} pcs`}
                              style={{ background: n ? `rgba(31,56,100,${a.toFixed(2)})` : '#F8FAFC', color: a > 0.5 ? '#fff' : '#0F172A' }}>{n || ''}</td>;
                          })}
                          <td className={`${td} text-right font-mono font-extrabold`}>{nf(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* 25-11-2026: the assembly line's quality gates in their order — each stage's FPY, and RTY = their product */
const STAGE_SHORT = ['HVIR', 'Leakage', 'Functional', 'Front', 'Pre-final', 'Final'];
const ypc = (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);   // as the SAWM KPI FTY & RTY sheet
function StageFlow({ S, fpyT, rtyT, qs, onPick }) {
  const a = S.all;
  const stT = Math.max(fpyT, 0.995);   // a single gate is expected to pass at least the FPY target (99.5 % floor)
  const tone = (v, t) => (v == null ? 'text-slate-500' : v >= t ? 'text-emerald-700' : 'text-red-700');
  const bar = (v, t) => (v == null ? '#CBD5E1' : v >= t ? '#16A34A' : '#DC2626');
  const worst = a.fpy.map((v, i) => [v, i]).filter(([v]) => v != null && v < 1).sort((p, q) => p[0] - q[0])[0];
  return (
    <section className={card} aria-label="Assembly stages">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 style={{ margin: 0 }} className="border-l-4 border-[#1F3864] pl-2.5 text-fs-15 font-extrabold uppercase tracking-wide text-[#1F3864]">Assembly stages · FPY and RTY</h3>
        <span className="text-fs-12 text-slate-600">stage FPY = 1 − defects at the stage ÷ pieces made · RTY = product of the 6 stages{worst ? <> · weakest: <b className="text-red-700">{KPI_STAGES[worst[1]]}</b></> : ''}</span>
      </div>
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Stages in line order">
        {KPI_STAGES.map((name, i) => (
          <React.Fragment key={name}>
            <button type="button" role="listitem" data-testid={`qd-stage-${i}`} onClick={() => onPick(i)} style={{ minWidth: 128 }} className="flex-1 cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-[#1F3864] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" title={`${name}: ${nf(a.stages[i])} pcs with a defect of ${nf(a.qty)} made — click for the details`} aria-label={`${name} details`}>
              <div className="flex items-center gap-1.5 text-fs-12 font-bold uppercase tracking-wide text-slate-500"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#1F3864] text-fs-11 text-white">{i + 1}</span>{STAGE_SHORT[i]}</div>
              <div className={`mt-1 font-mono text-fs-22 font-extrabold tabular-nums ${tone(a.fpy[i], stT)}`}>{ypc(a.fpy[i])}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${a.qty ? Math.max(2, Math.min(100, (a.stages[i] / Math.max(1, ...a.stages)) * 100)) : 0}%`, background: bar(a.fpy[i], stT) }} /></div>
              <div className="mt-1 flex items-center justify-between gap-1 text-fs-12 text-slate-600"><span><b className={a.stages[i] ? 'text-red-700' : 'text-slate-700'}>{nf(a.stages[i])}</b> pcs defect</span><span className="font-bold text-blue-700">Details ›</span></div>
            </button>
            <div className="grid place-items-center text-slate-400" aria-hidden="true"><ChevronRight size={16} /></div>
          </React.Fragment>
        ))}
        <div role="listitem" className="min-w-[140px] flex-1 rounded-lg border-2 border-[#1F3864] bg-[#EEF3FB] px-2.5 py-2" title="Rolled throughput yield: the share of pieces that pass all six stages first time">
          <div className="text-fs-12 font-extrabold uppercase tracking-wide text-[#1F3864]">RTY</div>
          <div className={`mt-1 font-mono text-fs-22 font-extrabold tabular-nums ${tone(a.rty, rtyT)}`}>{ypc(a.rty)}</div>
          <div className="mt-1 text-fs-12 text-slate-600">target {qs.rtyTarget}% · {nf(a.qty)} made</div>
          {a.unmapped > 0 && <div role="button" tabIndex={0} onClick={() => onPick(-1)} onKeyDown={(e) => e.key === 'Enter' && onPick(-1)} className="mt-0.5 cursor-pointer text-fs-12 text-amber-800 underline" title="Rework / rejection written at a station that is not one of the six stages (Setup → stations)">{nf(a.unmapped)} pcs at no stage</div>}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-fs-13" aria-label="Stage FPY by line">
          <thead><tr className="bg-[#DCE6F2] text-[#1F3864]">
            <th className="px-2 py-1.5 text-left">Line</th><th className="px-2 py-1.5 text-right">Made</th>
            {STAGE_SHORT.map((n) => <th key={n} className="px-2 py-1.5 text-right">{n}</th>)}
            <th className="px-2 py-1.5 text-right">No stage</th><th className="px-2 py-1.5 text-right">RTY</th>
          </tr></thead>
          <tbody>
            {S.lines.map((r) => (
              <tr key={r.line} className="border-b border-slate-100">
                <td className="px-2 py-1.5 font-bold">{KPI_LINES.find((k) => k.line === r.line)?.label || `Line ${r.line}`}</td>
                <td className="px-2 py-1.5 text-right font-mono">{nf(r.qty)}</td>
                {r.fpy.map((v, i) => (
                  <td key={i} onClick={() => onPick(i, r.line)} className={`cursor-pointer px-2 py-1.5 text-right font-mono hover:bg-blue-50 ${r.stages[i] ? tone(v, stT) : 'text-slate-400'}`} title={`${r.stages[i]} pcs — click for the details`}>
                    {r.qty ? ypc(v) : '—'}{r.stages[i] ? <span className="ml-1 text-fs-11 text-slate-500">({r.stages[i]})</span> : null}
                  </td>
                ))}
                <td onClick={r.unmapped ? () => onPick(-1, r.line) : undefined} className={`px-2 py-1.5 text-right font-mono ${r.unmapped ? 'cursor-pointer text-amber-800 underline hover:bg-amber-50' : 'text-slate-400'}`}>{nf(r.unmapped)}</td>
                <td className={`px-2 py-1.5 text-right font-mono font-extrabold ${tone(r.rty, rtyT)}`}>{ypc(r.rty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * 25-11-2026: the side drawer of one assembly stage (click a stage card, a cell of the Line × Stage table or "no stage"):
 * stage FPY, pcs, PPM, dismantled, RCA written · the defects most first · by line · by model · by hour · day by day ·
 * category and station · every entry of the period. Line chips and stage chips switch it without closing.
 */
function StageDrawer({ S, sheet, stations, pick, setPick, onClose, fpyT, group, period, ids }) {
  const { idx, line } = pick;
  const d = useMemo(() => stageDetail(sheet, stations, idx, line), [sheet, stations, idx, line]);
  const base = line ? S.lines.find((r) => r.line === String(line)) || S.all : S.all;
  const made = base.qty || 0;
  const fpy = idx >= 0 ? base.fpy[idx] : null;
  const stT = Math.max(fpyT, 0.995);
  const name = idx >= 0 ? KPI_STAGES[idx] : 'No stage';
  const lineLbl = (l) => KPI_LINES.find((k) => k.line === String(l))?.label || `Line ${l}`;
  const allDef = base.defects || 0;
  const ppm = made ? Math.round((d.total / made) * 1e6) : null;
  const max = (a) => Math.max(1, ...a.map((x) => x.total));
  const chip = (on) => `rounded-md border px-2 py-0.5 text-fs-12 font-bold ${on ? 'border-[#1F3864] bg-[#1F3864] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`;
  const box = 'rounded-lg border border-slate-200 bg-white p-2.5';
  const h4 = 'mb-1.5 text-fs-12 font-extrabold uppercase tracking-wide text-[#1F3864]';
  const Bars = ({ list, label = (k) => k, top = 10, testid }) => (
    !list.length ? <div className="text-fs-12 text-slate-500">Nothing written</div> : (
      <div className="flex flex-col gap-1" data-testid={testid}>
        {list.slice(0, top).map((x) => (
          <div key={x.key} className="grid items-center gap-2 text-fs-12" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) 64px' }} title={`${label(x.key)}: ${nf(x.total)} pcs${x.dismantle ? ` · ${nf(x.dismantle)} dismantled` : ''}`}>
            <span className="truncate font-semibold text-slate-800">{label(x.key)}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-[#1F3864]" style={{ width: `${Math.max(3, (x.total / max(list)) * 100)}%` }} /></span>
            <span className="text-right font-mono font-bold text-slate-900">{nf(x.total)} <span className="font-normal text-slate-500">{d.total ? `${Math.round((x.total / d.total) * 100)}%` : ''}</span></span>
          </div>
        ))}
        {list.length > top && <div className="text-fs-11 text-slate-500">+ {list.length - top} more (in the entries below)</div>}
      </div>
    ));
  const Cols = ({ list, label, testid }) => (
    !list.length ? <div className="text-fs-12 text-slate-500">Nothing written</div> : (
      <div className="flex items-end gap-1 overflow-x-auto pb-0.5" style={{ height: 96 }} data-testid={testid}>
        {list.map((x) => (
          <div key={x.key} className="flex flex-1 flex-col items-center justify-end gap-0.5" style={{ height: "100%", minWidth: 30 }} title={`${label(x.key)}: ${nf(x.total)} pcs`}>
            <span className="font-mono text-fs-11 font-bold text-slate-800">{nf(x.total)}</span>
            <span className="w-full rounded-t bg-[#1F3864]" style={{ height: `${Math.max(4, (x.total / max(list)) * 60)}px` }} />
            <span className="whitespace-nowrap font-mono text-fs-11 text-slate-600">{label(x.key, true)}</span>
          </div>
        ))}
      </div>
    ));
  const tiles = [
    ['Stage FPY', idx >= 0 ? ypc(fpy) : '—', fpy == null ? 'text-slate-700' : fpy >= stT ? 'text-emerald-700' : 'text-red-700', idx >= 0 ? `target ${(stT * 100).toFixed(1)}%` : 'not one of the 6 stages'],
    ['Defect pcs', nf(d.total), d.total ? 'text-red-700' : 'text-slate-900', `of ${nf(made)} made`],
    ['PPM', ppm == null ? '—' : nf(ppm), 'text-slate-900', 'defects per million'],
    ['Share', allDef ? `${Math.round((d.total / allDef) * 100)}%` : '—', 'text-slate-900', `of all ${nf(allDef)} defects`],
    ['Dismantled', nf(d.dismantle), d.dismantle ? 'text-red-700' : 'text-slate-900', d.total ? `${Math.round((d.dismantle / d.total) * 100)}% of these` : '—'],
    ['Cause written', d.total ? `${Math.round((d.withCause / d.total) * 100)}%` : '—', d.total && d.withCause < d.total ? 'text-amber-700' : 'text-emerald-700', `${nf(d.total - d.withCause)} pcs without`],
  ];
  return (
    <MesDrawer title={`${name}${line ? ` · ${lineLbl(line)}` : ''}`} sub={`${line ? lineLbl(line) : group} · ${period} · stage ${idx >= 0 ? idx + 1 : '—'} of 6`} icon={Layers} onClose={onClose} label={`${name} stage details`} width={64} bodyClass="p-3">
      <div className="flex flex-col gap-2.5" data-testid="qd-stage-drawer">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Stage">
            {STAGE_SHORT.map((n, i) => <button key={n} type="button" aria-pressed={idx === i} onClick={() => setPick({ idx: i, line })} className={chip(idx === i)}>{i + 1}. {n}</button>)}
            {(S.all.unmapped > 0 || idx < 0) && <button type="button" aria-pressed={idx < 0} onClick={() => setPick({ idx: -1, line })} className={chip(idx < 0)}>No stage</button>}
          </div>
          {ids.length > 1 && (
            <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Line">
              <button type="button" aria-pressed={!line} onClick={() => setPick({ idx, line: '' })} className={chip(!line)}>All lines</button>
              {ids.map((l) => <button key={l} type="button" aria-pressed={String(line) === l} onClick={() => setPick({ idx, line: l })} className={chip(String(line) === l)}>{lineLbl(l)}</button>)}
            </div>
          )}
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          {tiles.map(([n, v, tone, sub]) => (
            <div key={n} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
              <div className="text-fs-11 font-bold uppercase tracking-wide text-slate-500">{n}</div>
              <div className={`font-mono text-fs-18 font-extrabold tabular-nums ${tone}`}>{v}</div>
              <div className="truncate text-fs-11 text-slate-600" title={sub}>{sub}</div>
            </div>
          ))}
        </div>
        {!d.total ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-4 text-center text-fs-14 font-semibold text-emerald-800">No defect written at {name} in this period.</div>
        ) : (
          <>
            <div className="grid gap-2.5 lg:grid-cols-2">
              <div className={box}><div className={h4}>Defects · most first</div><Bars list={d.defects} testid="qd-sd-defects" /></div>
              <div className={box}><div className={h4}>Models</div><Bars list={d.models} top={8} /></div>
            </div>
            <div className="grid gap-2.5 lg:grid-cols-2">
              <div className={box}>
                <div className={h4}>By line</div>
                <table className="w-full border-collapse text-fs-12">
                  <thead><tr className="text-left text-slate-600"><th className="py-1">Line</th><th className="py-1 text-right">Made</th><th className="py-1 text-right">Pcs</th><th className="py-1 text-right">FPY</th><th className="py-1 text-right">Dism.</th></tr></thead>
                  <tbody>
                    {S.lines.filter((r) => !line || r.line === String(line)).map((r) => {
                      const g = d.lines.find((x) => x.key === r.line);
                      const v = idx >= 0 ? r.fpy[idx] : null;
                      return (
                        <tr key={r.line} onClick={ids.length > 1 ? () => setPick({ idx, line: line ? '' : r.line }) : undefined} className={`border-t border-slate-100 ${ids.length > 1 ? 'cursor-pointer hover:bg-blue-50' : ''}`}>
                          <td className="py-1 font-bold">{lineLbl(r.line)}</td>
                          <td className="py-1 text-right font-mono">{nf(r.qty)}</td>
                          <td className={`py-1 text-right font-mono font-bold ${g?.total ? 'text-red-700' : 'text-slate-400'}`}>{nf(g?.total || 0)}</td>
                          <td className={`py-1 text-right font-mono font-bold ${v == null ? 'text-slate-400' : v >= stT ? 'text-emerald-700' : 'text-red-700'}`}>{idx >= 0 && r.qty ? ypc(v) : '—'}</td>
                          <td className="py-1 text-right font-mono">{nf(g?.dismantle || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={box}><div className={h4}>Hour of the day</div><Cols list={d.hours} label={(h, short) => (short ? p2(h) : hourCol(h))} testid="qd-sd-hours" /></div>
            </div>
            <div className="grid gap-2.5 lg:grid-cols-2">
              {d.days.length > 1 && <div className={box}><div className={h4}>Day by day</div><Cols list={d.days} label={(k, short) => (short ? k.slice(8, 10) : dmy(k))} /></div>}
              <div className={box}>
                <div className={h4}>Category · station</div>
                <div className="flex flex-wrap gap-1">
                  {d.cats.map((x) => <span key={`c${x.key}`} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-fs-12"><b>{x.key}</b> {nf(x.total)}</span>)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {d.stations.map((x) => <span key={`s${x.key}`} className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-fs-12 text-blue-900">{x.key} <b>{nf(x.total)}</b></span>)}
                </div>
              </div>
            </div>
            <div className={box}>
              <div className={h4}>Entries · {nf(d.rows.length)}</div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-fs-12" data-testid="qd-sd-rows">
                  <thead><tr className="bg-[#DCE6F2] text-left text-[#1F3864]">
                    <th className="px-1.5 py-1">Date</th><th className="px-1.5 py-1">Line</th><th className="px-1.5 py-1">Hour</th><th className="px-1.5 py-1">Model</th><th className="px-1.5 py-1">Defect</th><th className="px-1.5 py-1">Category</th><th className="px-1.5 py-1 text-right">Pcs</th><th className="px-1.5 py-1 text-right">Dism.</th><th className="px-1.5 py-1">Cause / action</th>
                  </tr></thead>
                  <tbody>
                    {d.rows.slice(0, 300).map((r, i) => (
                      <tr key={i} className="border-b border-slate-100 align-top">
                        <td className="whitespace-nowrap px-1.5 py-1 font-mono">{dmy(r.date)}</td>
                        <td className="whitespace-nowrap px-1.5 py-1">{lineLbl(r.line)}</td>
                        <td className="whitespace-nowrap px-1.5 py-1 font-mono">{Object.keys(r.hours || {}).map((h) => p2(Number(h))).join(', ')}</td>
                        <td className="px-1.5 py-1">{r.model || '—'}</td>
                        <td className="px-1.5 py-1 font-semibold">{r.defect || '—'}</td>
                        <td className="px-1.5 py-1">{r.cat || '—'}</td>
                        <td className="px-1.5 py-1 text-right font-mono font-bold text-red-700">{nf(r.total)}</td>
                        <td className="px-1.5 py-1 text-right font-mono">{r.dismantle ? nf(r.dismantle) : ''}</td>
                        <td className="px-1.5 py-1 text-slate-700">{r.cause || r.action ? <>{r.cause}{r.cause && r.action ? ' → ' : ''}{r.action}</> : <span className="text-amber-700">not written</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.rows.length > 300 && <div className="mt-1 text-fs-11 text-slate-500">First 300 of {nf(d.rows.length)} — the Excel button above has all of them.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </MesDrawer>
  );
}

function worstText(w, name) {
  return w ? `Highest: ${name(w.line || w.name)} ${w.pct.toFixed(2)}%` : '';
}
