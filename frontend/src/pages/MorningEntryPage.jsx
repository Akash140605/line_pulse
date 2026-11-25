import React, { useEffect, useMemo, useState } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';
import { Save, Sunrise, CheckCircle2 } from 'lucide-react';
import HeaderBar, { arrowBtn, fieldCls } from '../components/HeaderBar';
import { api } from '../api';
import { useAuth } from '../components/AuthGate';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { useOleLines, LINE_COLOR, card, dmy } from '../components/OleParts';
import { setupSaved } from '../hooks/useDaySetups';
import { addDays } from '../utils/mainFilter';
import { serverToday } from '../utils/serverTime';
import { normShift } from '../utils/shift';
import { hm, oleConfig } from '../utils/ole';
import { takeEntryJump, clearEntryJump } from '../utils/entryJump';

/**
 * Morning entry — every morning, for each line: shift open / close, tea breaks, lunch, manpower at open and close
 * (saved with api/ole.php action 'setup'). That day's targets, OLE time and the HPR use these times instead of the
 * shift master; the manpower goes into the HPR (M/P, UPPH, Loss ₹) and, when the admin turns it on, the manpower sync.
 * Actual open / close = the first / last scan of the day (today: live; a finished day: its first / last hour's scans). A line without an entry keeps the shift master.
 */
const inp = 'h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-15 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';

const fromShift = (sh, mp = '', mpClose = '') => ({
  mp: mp === null || mp === undefined ? '' : String(mp), mpClose: mpClose === null || mpClose === undefined ? '' : String(mpClose),
  start: sh?.start || '09:00', end: sh?.end || '21:00',
  lunchStart: sh?.lunchStart || '', lunchEnd: sh?.lunchEnd || '',
  // 23-11-2026: one tea break on the form (was Tea break 1 and 2); an empty one is not saved
  breaks: [0].map((i) => { const b = (sh?.breaks || [])[i]; return { name: 'Tea break', start: b?.start || '', end: b?.end || '' }; }), note: '',
});
/** 20-11-2026: a new day's form shows the evening tea (the tea break) 18:30–18:45 filled in, when the shift runs past it. */
const EVENING_TEA = { start: '18:30', end: '18:45' };
const withEveningTea = (f) => {
  if (f.breaks[0].start || f.breaks[0].end || !(f.end >= EVENING_TEA.end && f.start <= EVENING_TEA.start)) return f;
  if (f.breaks.some((b) => b.start === EVENING_TEA.start)) return f;
  return { ...f, breaks: [{ ...f.breaks[0], start: EVENING_TEA.start, end: EVENING_TEA.end }] };
};
/** Working minutes of a form (shift − lunch − breaks), or null when the times are not right. */
function workMin(f) {
  const n = normShift({ start: f.start, end: f.end, lunchStart: f.lunchStart, lunchEnd: f.lunchEnd, breaks: f.breaks.filter((b) => b.start && b.end) });
  if (n.start == null || n.end == null) return null;
  return { total: n.end - n.start, work: n.end - n.start - n.off.reduce((a, [x, y]) => a + (y - x), 0) };
}
const badOf = (f) => (!f.start || !f.end || f.end <= f.start ? 'Close time must be after the open time.'
  : (f.lunchStart || f.lunchEnd) && !(f.lunchStart && f.lunchEnd && f.lunchEnd > f.lunchStart && f.lunchStart > f.start && f.lunchEnd < f.end) ? 'Lunch must be inside the shift.'
  : f.breaks.some((b) => (b.start || b.end) && !(b.start && b.end && b.end > b.start && b.start >= f.start && b.end <= f.end)) ? 'A tea break must be inside the shift.'
  : [f.mp, f.mpClose].some((v) => v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1000)) ? 'Manpower must be a whole number.'
  : f.mp === '' ? 'Write the manpower at open.' : '');
const hhmm = (t) => (t && String(t).length >= 16 ? String(t).slice(11, 16) : '—');

/**
 * one vertical form — a column per line, side by side; rows: open (written) and actual open (first
 * scan), close (written) and actual close (last scan), one tea break (evening 18:30–18:45 by default), lunch, manpower at open.
 */
function MorningGrid({ ids, date, today, setups, settings, lastMp, canEdit, isAdmin, onSaved }) {
  const init = () => Object.fromEntries(ids.map((l) => {
    const sv = setups[`${date}|${l}`];
    return [l, sv ? { ...fromShift(sv, sv.mp, sv.mpClose), note: sv.note || '' } : withEveningTea(fromShift(settings[l]?.shift, lastMp[l] ?? ''))];
  }));
  const [F, setF] = useState(init);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  useEffect(() => { setF(init()); setMsg({}); }, [date, JSON.stringify(setups), JSON.stringify(ids.map((l) => settings[l]?.shift))]); // eslint-disable-line react-hooks/exhaustive-deps
  // today: the actual open / close of every line = its first and last scan
  const [scan, setScan] = useState({});
  useEffect(() => {
    if (date > today) { setScan({}); return undefined; }
    let alive = true;
    if (date !== today) {
      // a finished day (19-11-2026): its hours with production → the first and the last scan of that day, per line
      setScan({});
      const one = async (l) => {
        const h = await api.hourlyOfDay(l, date);
        const hrs = (h?.lines?.[0]?.hourly || []).filter((x) => Number(x.q) > 0).map((x) => Number(x.h)).sort((a, b) => a - b);
        if (!hrs.length) return [l, { first: null, last: null, none: true }];
        const scanAt = async (hour, end) => { const d = await api.hourDetail(date, hour, { line: l }); const sc = Array.isArray(d?.scans) ? d.scans : []; const x = end ? sc[sc.length - 1] : sc[0]; return x?.scanDate ? String(x.scanDate).replace('T', ' ').slice(0, 19) : null; };
        const [first, last] = await Promise.all([scanAt(hrs[0], false), scanAt(hrs[hrs.length - 1], true)]);
        return [l, { first, last }];
      };
      Promise.allSettled(ids.map(one)).then((rs) => { if (alive) setScan(Object.fromEntries(rs.map((r, i) => [ids[i], r.status === 'fulfilled' ? r.value[1] : { first: null, last: null }]))); });
      return () => { alive = false; };
    }
    Promise.allSettled(ids.map((l) => api.liveLinesOne(l, { cmin: 1, cmax: 22 }))).then((rs) => {
      if (!alive) return;
      setScan(Object.fromEntries(rs.map((r, i) => { const row = r.status === 'fulfilled' ? r.value?.lines?.[0] : null; return [ids[i], { first: String(row?.firstScan || '').slice(0, 10) === today ? row.firstScan : null, last: String(row?.lastScan || '').slice(0, 10) === today ? row.lastScan : null }]; })));
    });
    return () => { alive = false; };
  }, [date, today, ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (l, k, v) => setF((x) => ({ ...x, [l]: { ...x[l], [k]: v } }));
  const setBr = (l, i, k, v) => setF((x) => ({ ...x, [l]: { ...x[l], breaks: x[l].breaks.map((b, j) => (j === i ? { ...b, [k]: v } : b)) } }));
  const save = async (l) => {
    const f = F[l]; const bad = badOf(f);
    if (bad) { setMsg((m) => ({ ...m, [l]: bad })); return false; }
    setBusy(l);
    try {
      await api.saveOleSetup({ date, line: Number(l), mp: Number(f.mp), mpClose: f.mpClose === '' ? null : Number(f.mpClose), start: f.start, end: f.end, lunchStart: f.lunchStart, lunchEnd: f.lunchEnd, breaks: f.breaks.filter((b) => b.start || b.end), note: f.note });
      setMsg((m) => ({ ...m, [l]: 'Saved' })); return true;
    } catch (x) { setMsg((m) => ({ ...m, [l]: `Could not save: ${x.message}` })); return false; } finally { setBusy(''); }
  };
  const saveAll = async () => { let ok = true; for (const l of ids) ok = (await save(l)) && ok; setupSaved(); onSaved(); return ok; };
  const clear = async (l) => {
    setBusy(l);
    try { await api.saveOleSetup({ date, line: Number(l), clear: true }); setMsg((m) => ({ ...m, [l]: 'Removed' })); setupSaved(); onSaved(); }
    catch (x) { setMsg((m) => ({ ...m, [l]: `Not removed: ${x.message}` })); } finally { setBusy(''); }
  };
  const ro = !canEdit;
  // a phone: one line at a time (line buttons on top), the form stays one column
  const narrow = useMediaQuery('(max-width: 767px)');
  const [one, setOne] = useState(ids[0]);
  const cols = narrow ? [ids.includes(one) ? one : ids[0]] : ids;
  const cellIn = `${inp} font-mono`;
  const stdOf = (l) => Number(oleConfig().stdMp?.[l]) || null;   // the admin's standard manpower of the line (Setup → OLE formulas)
  const time = (l, k, label) => <input type="time" disabled={ro || busy === l} className={cellIn} aria-label={`${label} Line ${l}`} value={F[l]?.[k] || ''} onChange={(e) => set(l, k, e.target.value)} />;
  const range = (l, a, b, label) => (
    <div className="grid gap-1.5 2xl:grid-cols-2">{time(l, a, `${label} start`)}{time(l, b, `${label} end`)}</div>
  );
  const ROWS = [
    ['Shift open', (l) => time(l, 'start', 'Open time')],
    ['Actual open', (l) => <div className="flex h-10 items-center rounded-lg bg-slate-100 px-2.5 font-mono text-fs-15 font-bold text-slate-700" aria-label={`Actual open Line ${l}`}>{hhmm(scan[l]?.first)}</div>, 'first scan'],
    ['Shift close', (l) => time(l, 'end', 'Close time')],
    ['Actual close', (l) => <div className="flex h-10 items-center rounded-lg bg-slate-100 px-2.5 font-mono text-fs-15 font-bold text-slate-700" aria-label={`Actual close Line ${l}`}>{hhmm(scan[l]?.last)}</div>, 'last scan'],
    ['Tea break', (l) => <div className="grid gap-1.5 2xl:grid-cols-2">{['start', 'end'].map((k) => <input key={k} type="time" disabled={ro || busy === l} className={cellIn} aria-label={`Tea break ${k} Line ${l}`} value={F[l]?.breaks[0][k] || ''} onChange={(e) => setBr(l, 0, k, e.target.value)} />)}</div>],
    ['Lunch', (l) => range(l, 'lunchStart', 'lunchEnd', 'Lunch')],
    ['Manpower at open', (l) => <div className="flex items-center gap-2"><input type="number" inputMode="numeric" min="0" max="1000" disabled={ro || busy === l} className={`${cellIn} ${!ro && !F[l]?.mp ? 'border-amber-400 bg-amber-50' : ''}`} placeholder={ro ? '' : 'Write M/P'} aria-label={`Manpower Line ${l}`} value={F[l]?.mp || ''} onChange={(e) => set(l, 'mp', e.target.value)} />{stdOf(l) ? <span className="shrink-0 font-mono text-fs-14 font-bold text-slate-500" aria-label={`Standard manpower Line ${l}`}>/ {stdOf(l)}</span> : null}</div>],
    // 20-11-2026: "Manpower at close" taken off the form (a value saved before is kept)
    ['Working time', (l) => { const w = F[l] && workMin(F[l]); return <div className="flex h-10 items-center font-mono text-fs-16 font-extrabold text-slate-900" aria-label={`Working time Line ${l}`}>{w ? hm(w.work) : '—'}</div>; }],
  ];
  return (
    <section className={`${card} overflow-x-auto p-0`} aria-label="Morning entry form">
      {narrow && ids.length > 1 && (
        <div className="flex border-b border-slate-200" role="group" aria-label="Line">
          {ids.map((l) => <button key={l} type="button" aria-pressed={cols[0] === l} onClick={() => setOne(l)} className={`h-11 flex-1 border-r border-slate-200 text-fs-14 font-bold last:border-r-0 ${cols[0] === l ? 'bg-dixon-navy text-white' : 'bg-white text-slate-700'}`}>Line {l}</button>)}
        </div>
      )}
      <table className={`w-full border-collapse text-fs-14 ${narrow ? '' : 'min-w-[640px]'}`}>
        <thead>
          <tr className="bg-dixon-navy text-left text-white">
            <th className={`${narrow ? 'w-32' : 'w-44'} px-3 py-2 text-fs-14 font-extrabold`}>{dmy(date)}</th>
            {cols.map((l) => {
              const sv = setups[`${date}|${l}`];
              return (
                <th key={l} className={`${narrow ? '' : 'min-w-[200px]'} px-3 py-2`} aria-label={`Line ${l}`}>
                  <span className="inline-flex items-center gap-2 text-fs-16 font-extrabold">Line {l}</span>
                  {sv && <span className="ml-2 inline-flex items-center gap-1 text-fs-12 font-bold text-emerald-700" title={`Morning entry saved${sv.by ? ` by ${sv.by}` : ''}${sv.at ? ` at ${sv.at}` : ''}`}><CheckCircle2 size={12} aria-hidden />Saved {String(sv.at || '').slice(11, 16)}{sv.by ? ` · ${sv.by}` : ''}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, cell, sub]) => (
            <tr key={label} className="border-b border-slate-200 align-middle">
              <th scope="row" className="bg-slate-50 px-3 py-2 text-left text-fs-14 font-bold text-slate-800">{label}{sub && <span className="block text-fs-11 font-semibold text-slate-500">{sub}</span>}</th>
              {cols.map((l) => <td key={l} className="px-2 py-1.5">{cell(l)}</td>)}
            </tr>
          ))}
          {!ro && (
            <tr>
              <th className="bg-slate-50 px-3 py-2" />
              {cols.map((l) => (
                <td key={l} className="px-2 py-2 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={async () => { if (await save(l)) { setupSaved(); onSaved(); } }} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-60"><Save size={14} aria-hidden /> Save Line {l}</button>
                    {setups[`${date}|${l}`] && isAdmin && <button type="button" onClick={() => clear(l)} disabled={!!busy} className="h-9 rounded-lg border border-red-200 px-2.5 text-fs-13 font-bold text-red-700 hover:bg-red-50">Remove</button>}
                  </div>
                  {msg[l] && <div role="status" className={`mt-1 text-fs-13 font-bold ${/^(Not|Write|Close|Lunch|A tea|Manpower)/.test(msg[l]) ? 'text-red-700' : 'text-emerald-700'}`}>{msg[l]}</div>}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      {!ro && ids.length > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-3 py-2">
          {/* 23-11-2026: one click gives every line the shift, lunch and tea break of the first line (manpower stays per line) */}
          <button type="button" disabled={!!busy} title={`Shift open / close, tea break and lunch of Line ${ids[0]} into every line (manpower is not copied)`}
            onClick={() => setF((x) => { const s0 = x[ids[0]]; return Object.fromEntries(ids.map((l) => [l, l === ids[0] ? s0 : { ...x[l], start: s0.start, end: s0.end, lunchStart: s0.lunchStart, lunchEnd: s0.lunchEnd, breaks: s0.breaks.map((b) => ({ ...b })) }])); })}
            className="mr-auto inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Same times as Line {ids[0]} for all lines</button>
          <button type="button" onClick={saveAll} disabled={!!busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-dixon-navy px-4 text-fs-14 font-bold text-white disabled:opacity-60"><Save size={15} aria-hidden /> Save all lines</button>
        </div>
      )}
    </section>
  );
}

export default function MorningEntryPage() {
  const me = useAuth();
  const isAdmin = me?.role === 'admin';
  const canEdit = isAdmin || !!me?.oleEdit;
  const today = serverToday();
  // 23-11-2026: opened from the Entry dashboard for one day
  const [date, setDate] = useState(() => { const j = takeEntryJump(); return j?.date && j.date <= today ? j.date : today; });
  useEffect(() => { clearEntryJump(); }, []);
  const ids = useOleLines();
  const settings = useAllLineSettings(ids);
  const [setups, setSetups] = useState(null);
  const [err, setErr] = useState('');
  const from = addDays(date, -10);
  const load = async () => {
    setErr('');
    try { const j = await api.oleEntries(from, date); setSetups(j?.setup || {}); } catch (x) { setErr(`Could not read the entries: ${x.message}`); setSetups((s) => s || {}); }
  };
  useEffect(() => { setSetups(null); load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  // manpower of the line's last entry before this day (a new day starts with it)
  const lastMp = useMemo(() => Object.fromEntries(ids.map((l) => {
    const prev = Object.values(setups || {}).filter((x) => String(x.line) === l && x.date < date && x.mp != null).sort((a, b) => b.date.localeCompare(a.date))[0];
    return [l, prev ? prev.mp : null];
  })), [setups, ids, date]);
  const filled = ids.filter((l) => setups?.[`${date}|${l}`]).length;
  return (
    <div className="flex flex-col gap-3" role="region" aria-label="Morning entry">
      <HeaderBar label="Morning entry filters">
        <button type="button" className={arrowBtn} aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}>‹</button>
        <input type="date" className={fieldCls} aria-label="Day" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value > today ? today : e.target.value)} />
        <button type="button" className={arrowBtn} aria-label="Next day" disabled={date >= today} onClick={() => setDate((d) => (addDays(d, 1) > today ? today : addDays(d, 1)))}>›</button>
        {date !== today && <button type="button" className={`${fieldCls} font-bold text-blue-700`} onClick={() => setDate(today)}>Today</button>}
        <span className="text-fs-13 font-semibold text-slate-600"><Sunrise size={14} className="mr-1 inline align-[-2px]" aria-hidden />{dmy(date)} · {filled} of {ids.length} lines filled</span>
      </HeaderBar>
      {err && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
      {setups == null ? <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-fs-14 font-semibold text-slate-600">Reading the entries…</div>
        : ids.length > 0 && <MorningGrid ids={ids} date={date} today={today} setups={setups} settings={settings} lastMp={lastMp} canEdit={canEdit} isAdmin={isAdmin} onSaved={load} />}
      {!ids.length && <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-fs-14 text-slate-600">This login has no line.</div>}
    </div>
  );
}
