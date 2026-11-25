import { PageLoader } from '../components/Loader';
import HeaderBar, { segGroup, segBtn } from '../components/HeaderBar';
import React, { useMemo, useState } from 'react';
import { addDays } from '../utils/mainFilter';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange, qualityOf, hoursOf, stationsFor } from '../utils/ole';
import StationSetup from '../components/StationSetup';
import { LINE_COLOR, nf, dmy, p2, card, useOleLines, groupNameOf, useOleData, shortSt, normReasons, DEFAULT_QUALITY } from '../components/OleParts';
import { PeriodBar } from '../components/PeriodBar';
import { KPI_STAGES, ftyRows } from '../utils/kpiStages';

/**
 * Quality — FPY and RTY of the login's lines (only for the logins the admin gives this page: Setup → Management view,
 * or Setup → Users & logins → pages of a login). Built from the rejection and rework rows of Loss entry (station, model,
 * defect) and the scanned pieces:
 *   FPY = (input − rejected − reworked) ÷ input · RTY = Π station FPY · final yield = (input − rejected) ÷ input
 *   (utils/ole.js qualityOf)
 */
const pc = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
/** Yield colours against the admin's targets: at or over the FPY target green, at or over the RTY target amber, below red. */
let TGT = { g: DEFAULT_QUALITY.fpyTarget / 100, a: DEFAULT_QUALITY.rtyTarget / 100 };
const qTone = (v) => (v == null ? 'text-slate-500' : v >= TGT.g ? 'text-emerald-700' : v >= TGT.a ? 'text-amber-700' : 'text-red-700');
const qBar = (v) => (v == null ? '#CBD5E1' : v >= TGT.g ? '#059669' : v >= TGT.a ? '#D97706' : '#DC2626');

function Big({ name, value, sub, help, target = null }) {
  const tone = target == null || value == null ? qTone(value) : value >= target ? 'text-emerald-700' : 'text-red-700';
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3" title={help}>
      <div className="text-fs-13 font-bold leading-snug text-slate-600">{name}</div>
      <div className={`mt-1 font-mono text-fs-34 font-extrabold leading-none tabular-nums ${tone}`}>{pc(value, value != null && value < 1 && value >= 0.9995 ? 2 : 1)}</div>
      <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`, background: target != null && value != null ? (value >= target ? '#059669' : '#DC2626') : qBar(value) }} />{target != null && <i className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${target * 100}%` }} />}</div>
      {target != null && <div className="mt-1 text-fs-12 font-bold text-slate-700">Target {(target * 100).toFixed(1)}% · {value == null ? '—' : value >= target ? 'Met' : `${((target - value) * 100).toFixed(2)} pts short`}</div>}
      {sub && <div className="mt-1 break-words text-fs-12 leading-snug text-slate-600" title={sub}>{sub}</div>}
    </div>
  );
}
function Small({ name, value, unit, sub, tone = 'text-slate-900' }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className={`mt-1 whitespace-nowrap font-mono text-fs-24 font-extrabold leading-none tabular-nums ${tone}`}>{value}{unit && <span className="ml-1 text-fs-13 font-semibold text-slate-500">{unit}</span>}</div>
      {sub && <div className="mt-1 break-words text-fs-12 leading-snug text-slate-600">{sub}</div>}
    </div>
  );
}

/** FPY (bar) and RTY (red mark) per hour or per day; the scale starts a bit under the lowest value. */
function YieldChart({ slots }) {
  const vals = slots.flatMap((s) => [s.fpy, s.rty]).filter((v) => v != null);
  const lo = vals.length ? Math.max(0, Math.floor((Math.min(...vals) - 0.02) * 50) / 50) : 0.9;
  const h = (v) => (v == null ? 0 : Math.max(2, ((v - lo) / (1 - lo)) * 100));
  return (
    <div className="flex h-[240px] flex-col" role="img" aria-label="FPY and RTY trend">
      <div className="mb-1 flex flex-wrap gap-3 text-fs-12 text-slate-600"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-800" />FPY</span><span><i className="mr-1 inline-block h-0.5 w-3 bg-red-600 align-middle" />RTY</span><span className="text-slate-400">scale {pc(lo, 0)} – 100%</span></div>
      <div className="flex min-h-0 flex-1 items-end gap-1 border-b border-slate-200">
        {slots.map((s) => (
          <div key={s.key} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${s.title}: FPY ${pc(s.fpy)} · RTY ${pc(s.rty)} · ${nf(s.qty)} pcs`}>
            {s.fpy != null && <div className="mb-0.5 text-center font-mono text-fs-11 font-bold text-slate-700">{(s.fpy * 100).toFixed(s.fpy >= 0.995 ? 0 : 1)}</div>}
            <div className="mx-auto w-full max-w-[44px] rounded-t bg-blue-800" style={{ height: `${h(s.fpy)}%`, opacity: s.qty ? 1 : 0.15 }} />
            {s.rty != null && <div className="absolute inset-x-0 mx-auto h-0.5 max-w-[52px] bg-red-600" style={{ bottom: `${h(s.rty)}%` }} />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">{slots.map((s) => <div key={s.key} className="min-w-0 flex-1 truncate text-center font-mono text-fs-11 text-slate-500">{s.label}</div>)}</div>
    </div>
  );
}

export default function QualityPage({ onOpen = null, isAdmin = false }) {
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: today, end: today });
  const [sel, setSel] = useState('all');
  const IDS = sel === 'all' ? ALL : [sel];
  const oneDay = range.start === range.end;
  const settings = useAllLineSettings(ALL);
  const D = useOleData({ start: range.start, end: range.end, ids: ALL });
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start: range.start, end: range.end, today, nowMin: D.endMin, ids: ALL }) : null),
    [D.al, settings, D.ent.entries, range.start, range.end, today, D.endMin, ALL]);
  // the admin's station setup for the chosen lines (switched-off ones too: their old entries still count)
  const names = useMemo(() => stationsFor(D.ent.reasons.station || [], IDS, { all: true }), [D.ent.reasons, IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = { ...DEFAULT_QUALITY, ...(D.ent.reasons.quality || {}) };
  TGT = { g: qs.fpyTarget / 100, a: qs.rtyTarget / 100 };
  const rowsOf = (days, ids) => (days || []).flatMap((d) => ids.flatMap((l) => d.byLine[l]?.rows || []));
  const Q = useMemo(() => qualityOf(rowsOf(R?.days, IDS), names), [R, IDS.join(), names]); // eslint-disable-line react-hooks/exhaustive-deps
  const perLine = useMemo(() => ALL.map((l) => ({ l, q: qualityOf(rowsOf(R?.days, [l]), names) })), [R, ALL, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const slots = useMemo(() => {
    if (!R) return [];
    if (oneDay) {
      const day = R.days.find((d) => d.date === range.start);
      return hoursOf(day?.byLine, IDS).map((h) => { const q = qualityOf(IDS.flatMap((l) => (day?.byLine[l]?.rows || []).filter((r) => r.hour === h)), names); return { key: h, label: p2(h), title: `${p2(h)}–${p2(h + 1)}`, ...q }; });
    }
    return R.days.map((d) => { const q = qualityOf(rowsOf([d], IDS), names); return { key: d.date, label: d.date.slice(8), title: dmy(d.date), ...q }; });
  }, [R, oneDay, range.start, IDS.join(), names]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodText = oneDay
    ? `${range.start === today ? 'Today' : range.start === addDays(today, -1) ? 'Yesterday' : 'Day'} · ${dmy(range.start)}`
    : `${dmy(range.start)} – ${dmy(range.end)} · ${R ? R.days.length : 0} working day${R?.days.length === 1 ? '' : 's'}`;
  const group = sel === 'all' ? groupNameOf(ALL) : `Line ${sel}`;
  const btn = (on) => `h-8 px-3 text-fs-13 font-semibold border-r last:border-r-0 border-slate-300 whitespace-nowrap ${on ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
  // the FTY & RTY sheet of the SAWM KPI report: day × line, defects per stage, stage FPY, RTY against the target
  const fty = useMemo(() => ftyRows(R?.days, IDS, D.ent.reasons.station || [], D.ent.kpi || {}), [R, IDS.join(), D.ent]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxDef = Math.max(1, ...Q.defects.map((d) => d.rej + d.rwk));
  const shown = Q.stations.filter((s) => (s.setup && s.active) || s.rej + s.rwk > 0);
  const inRty = shown.filter((s) => s.rty);
  if (!ALL.length) return <div className={`${card} text-fs-14 font-semibold text-slate-600`}>This login has no line.</div>;
  return (
    <div className="flex flex-col gap-3" aria-label="Quality FPY RTY" role="region">
      <HeaderBar label="Quality filters">
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!R} />
      </HeaderBar>
      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-fs-14 font-semibold text-slate-700">{D.err}</div>}
      {!R ? <PageLoader label="Reading the lines" sub="Rejections, FPY and RTY" /> : (
        <>
          {/* the period in five boxes (19-11-2026: short, one row) */}
          <section className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="Yields of the period">
            <Big name="FPY" value={Q.fpy} target={qs.fpyTarget / 100} sub={`${nf(Q.qty - Q.rej - Q.rwk)} of ${nf(Q.qty)} right first time`} help="(input − rejected − reworked) ÷ input" />
            <Big name="RTY" value={Q.rty} target={qs.rtyTarget / 100} sub={`${inRty.length} stages`} help={`product of the stage FPYs: ${inRty.map((st) => st.label).join(' × ')}`} />
            <Big name="Final yield" value={Q.finalYield} sub={`Good ${nf(Q.qty - Q.rej)} of ${nf(Q.qty)}`} help="(input − rejected) ÷ input — the Quality of OLE" />
            <Small name="Rejected" value={nf(Q.rej)} unit="pcs" sub={Q.qty ? `${pc(Q.rej / Q.qty, 2)} of ${nf(Q.qty)}` : '—'} tone={Q.rej ? 'text-red-700' : 'text-slate-900'} />
            <Small name="Reworked" value={nf(Q.rwk)} unit="pcs" sub={Q.qty ? `${pc(Q.rwk / Q.qty, 2)} · DPHU ${Q.dphu == null ? '—' : Q.dphu.toFixed(2)}` : '—'} tone={Q.rwk ? 'text-amber-700' : 'text-slate-900'} />
          </section>

          {/* 19-11-2026: as the FTY & RTY sheet of the SAWM KPI report */}
          <section className={card} aria-label="FTY and RTY">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-fs-16 font-bold text-slate-900">FTY &amp; RTY — stage wise · {group}</h3>
              <span className="text-fs-12 font-semibold text-slate-500">stage FPY = 1 − defects at the stage ÷ production · RTY = Π stage FPY · target {qs.rtyTarget}%</span>
            </div>
            {!fty.length ? <p className="mt-2 text-fs-14 text-slate-600">No production in this period.</p> : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="FTY and RTY by day and line">
                  <thead>
                    <tr className="bg-[#1F3864] text-center text-fs-12 text-white">
                      <th rowSpan={2} className="border border-[#BFBFBF] px-1.5 py-1">Date</th><th rowSpan={2} className="border border-[#BFBFBF] px-1.5">Line</th>
                      <th rowSpan={2} className="border border-[#BFBFBF] px-1.5">Production</th><th rowSpan={2} className="border border-[#BFBFBF] px-1.5">Defect</th><th rowSpan={2} className="border border-[#BFBFBF] px-1.5">Dismantle</th>
                      <th colSpan={6} className="border border-[#BFBFBF] px-1.5 py-1">Stages (defects)</th><th colSpan={6} className="border border-[#BFBFBF] px-1.5">Stage wise FPY (%)</th>
                      <th rowSpan={2} className="border border-[#BFBFBF] px-1.5">Target</th><th rowSpan={2} className="border border-[#BFBFBF] px-1.5">RTY (%)</th>
                    </tr>
                    <tr className="bg-[#DDEBF7] text-center text-fs-11 text-[#1F3864]">
                      {[...KPI_STAGES, ...KPI_STAGES].map((n, i) => <th key={i} className="border border-[#BFBFBF] px-1 py-1 font-bold leading-tight">{n}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {fty.map((r, i) => (
                      <tr key={`${r.date}|${r.line}`} className="text-center hover:bg-[#DDEBF7]/50">
                        <td className="border border-[#D4D4D4] px-1.5 py-1 whitespace-nowrap font-semibold">{i === 0 || fty[i - 1].date !== r.date ? dmy(r.date) : ''}</td>
                        <td className="border border-[#D4D4D4] px-1.5 whitespace-nowrap font-bold">{r.label}</td>
                        <td className="border border-[#D4D4D4] px-1.5 font-mono">{nf(r.qty)}</td>
                        <td className="border border-[#D4D4D4] px-1.5 font-mono text-red-700">{r.defects || ''}</td>
                        <td className="border border-[#D4D4D4] px-1.5 font-mono">{r.dismantle ?? ''}</td>
                        {r.stages.map((n, k) => <td key={k} className="border border-[#D4D4D4] px-1.5 font-mono">{n || ''}</td>)}
                        {r.fpy.map((v, k) => <td key={k} className={`border border-[#D4D4D4] px-1.5 font-mono ${v < qs.fpyTarget / 100 ? 'font-bold text-red-700' : 'text-slate-700'}`}>{(v * 100).toFixed(2)}%</td>)}
                        <td className="border border-[#D4D4D4] px-1.5 font-mono">{qs.rtyTarget}%</td>
                        <td className={`border border-[#D4D4D4] px-1.5 font-mono font-extrabold ${r.rty >= qs.rtyTarget / 100 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{(r.rty * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section className={card} aria-label="Quality by line">
              <h3 className="text-fs-16 font-bold text-slate-900">By line</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-fs-13 tabular-nums" aria-label="FPY and RTY by line">
                  <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Line', 'Input', 'Rejected', 'Reworked', 'FPY', 'RTY', 'Final yield'].map((x) => <th key={x} className="whitespace-nowrap px-1.5 py-1.5 font-semibold">{x}</th>)}</tr></thead>
                  <tbody>
                    {perLine.map(({ l, q }) => (
                      <tr key={l} className={`border-b border-slate-100 ${sel === l ? 'bg-sky-50' : ''}`}>
                        <td className="whitespace-nowrap px-2 py-1.5 font-bold">Line {l}</td>
                        <td className="px-2 font-mono">{nf(q.qty)}</td><td className="px-2 font-mono text-red-700">{nf(q.rej)}</td><td className="px-2 font-mono text-amber-700">{nf(q.rwk)}</td>
                        <td className={`px-2 font-mono font-extrabold ${qTone(q.fpy)}`}>{pc(q.fpy, 2)}</td><td className={`px-2 font-mono font-extrabold ${qTone(q.rty)}`}>{pc(q.rty, 2)}</td><td className={`px-2 font-mono ${qTone(q.finalYield)}`}>{pc(q.finalYield, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className={`${card} flex flex-col`} aria-label="Yield trend">
              <h3 className="text-fs-16 font-bold text-slate-900">FPY &amp; RTY — {oneDay ? `by hour, ${dmy(range.start)}` : 'by day'} · {group}</h3>
              <div className="mt-2 flex-1"><YieldChart slots={slots} /></div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className={card} aria-label="Quality by model">
              <h3 className="text-fs-16 font-bold text-slate-900">By model</h3>
              <div className="mt-2 max-h-[360px] overflow-auto">
                <table className="w-full text-fs-13 tabular-nums" aria-label="FPY by model">
                  <thead className="sticky top-0 bg-white"><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Model', 'Made', 'Rejected', 'Reworked', 'FPY'].map((x) => <th key={x} className="px-2 py-1.5 font-semibold">{x}</th>)}</tr></thead>
                  <tbody>
                    {Q.models.map((m) => (
                      <tr key={m.name} className="border-b border-slate-100">
                        <td className="min-w-[140px] max-w-[300px] break-words px-2 py-1 font-mono font-bold text-slate-800" title={m.name}>{m.name}</td>
                        <td className="px-2 font-mono">{nf(m.qty)}</td><td className="px-2 font-mono text-red-700">{nf(m.rej) || '—'}</td><td className="px-2 font-mono text-amber-700">{nf(m.rwk) || '—'}</td>
                        <td className={`px-2 font-mono font-extrabold ${qTone(m.fpy)}`}>{pc(m.fpy, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className={card} aria-label="Top defects">
              <h3 className="text-fs-16 font-bold text-slate-900">Top defects</h3>
              {!Q.defects.length ? <p className="mt-2 text-fs-13 text-slate-500">No defect entered in this period.</p> : (
                <ul className="mt-2 flex flex-col gap-2">
                  {Q.defects.slice(0, 10).map((d) => (
                    <li key={d.name} className="text-fs-13">
                      <div className="flex items-baseline justify-between gap-2"><b className="break-words text-slate-900">{d.name}</b><span className="shrink-0 font-mono text-slate-700"><b className="text-red-700">{nf(d.rej)}</b> rej · <b className="text-amber-700">{nf(d.rwk)}</b> rwk</span></div>
                      <div className="mt-0.5 flex h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="h-full bg-red-500" style={{ width: `${(d.rej / maxDef) * 100}%` }} /><span className="h-full bg-amber-500" style={{ width: `${(d.rwk / maxDef) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
              {shown.some((s) => s.rej + s.rwk > 0) && <p className="mt-3 text-fs-12 text-slate-500">Stations: {shown.filter((s) => s.rej + s.rwk > 0).map((s) => `${shortSt(s.name)} ${s.rej + s.rwk}`).join(' · ')}</p>}
            </section>
          </div>

          {isAdmin && <StationSetup reasons={D.ent.reasons} onSaved={(r) => D.setEnt((x) => ({ ...x, reasons: normReasons(r) }))} />}
        </>
      )}
    </div>
  );
}
