import React, { useEffect, useMemo, useState } from 'react';
import { GitCompare, FileUp, Download, AlertTriangle, CheckCircle2, ListChecks, Info, X, Eye, Columns3 } from 'lucide-react';
import { serverToday, serverNow } from '../utils/serverTime';
import { useOleLines } from '../components/OleParts';
import OleSource from '../components/OleSource';
import useUiSettings from '../hooks/useUiSettings';
import { loadAutoTargets } from '../hooks/useAutoTargets';
import { readWorkbook } from '../utils/sheetRead';
import { formatCell } from '../utils/xlsxFormat';
import { parseReport, fileChecks, compareFacts, summarize, formatCheck, sharedColumns, MEASURES, STATUS, REPORT_NAMES, COMPARE_TYPES, TABLE_TYPES, typeHas, colLetter, CELL_ROWS } from '../utils/reportCompare';
import { REPORTS, tableSheet, loadMasterRows, loadTargetRows } from '../utils/reportDefs';
import { hprDataOf, kpiDataOf, rwkDataOf } from '../utils/reportData';
import { loadLastScans } from '../utils/lastScans';
import { buildHprSheets } from '../utils/hpr';
import { buildKpiXlsx } from '../utils/kpiReport';
import { reworkXlsxSheet } from '../utils/reworkReport';
import { buildXlsx, downloadXlsx, colName } from '../utils/xlsxWriter';

/**
 * 20-11-2026: Report compare — import a report (the plant's SAWM KPI, HPR or hourly rework data, any table of the Reports
 * page, or any Excel cell by cell) and see where it differs from Line Pulse: Line Pulse makes the same report for the
 * same days (or a second Excel file is read), both are read by one reader (utils/reportCompare.js) and every number is
 * put side by side. First a preview of both files as they look in Excel and a format check (sheets and header columns
 * side by side); the checks list the rows of their file whose own numbers do not add up.
 */
const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5';
const inp = 'h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-14 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50';
const th = 'border border-[#BFBFBF] px-2 py-1.5';
const td = 'border border-[#D4D4D4] px-2 py-1.5';
const dmy = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '');
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const MAX_DAYS = 62;
const fmtN = (v, d) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: d }));
/** a value as its measure shows it */
export function showVal(measure, v) {
  if (v == null || v === '') return '—';
  const k = MEASURES[measure]?.kind;
  if (k === 'text' || (k === 'any' && (typeof v !== 'number' && !/^-?\d+(\.\d+)?$/.test(String(v))))) return String(v);
  if (k === 'any') return fmtN(Number(v), 4);
  if (k === 'ratio') return `${fmtN(v * 100, 2)} %`;
  if (k === 'pct') return `${fmtN(v, 2)} %`;
  if (k === 'money') return `₹${fmtN(v, 0)}`;
  if (k === 'count') return fmtN(v, Number.isInteger(v) ? 0 : 1);
  return fmtN(v, 2);
}
const showDiff = (r) => {
  if (r.diff == null) return '—';
  const k = MEASURES[r.measure].kind;
  const v = k === 'ratio' ? r.diff * 100 : r.diff;
  const s = k === 'money' ? `₹${fmtN(Math.abs(v), 0)}` : fmtN(Math.abs(v), k === 'count' && Number.isInteger(v) ? 0 : 2);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}${k === 'ratio' || k === 'pct' ? ' pts' : ''}`;
};
const TONE = { diff: 'bg-red-100 text-red-800 ring-red-300', theirs: 'bg-orange-100 text-orange-800 ring-orange-300', ours: 'bg-violet-100 text-violet-800 ring-violet-300', close: 'bg-amber-100 text-amber-800 ring-amber-300', same: 'bg-emerald-100 text-emerald-800 ring-emerald-300' };
const BAD = ['diff', 'theirs', 'ours'];

/** how each side works the numbers out (shown with the results) */
const HOW = {
  hpr: [
    ['Hour target', 'Their file: written in by hand (UPH target of the hour).', 'Line Pulse: the line\'s hourly plan — the target cycle of the models made in the hour, over the working minutes of the hour.'],
    ['I/T (min)', 'Both: minutes of the slot ÷ Tgt × Gap. Their file types the minutes (60 / 45 / 30).', 'Line Pulse takes the working minutes from the shift of that day (morning entry): lunch and tea breaks out.'],
    ['Loss ₹', 'Their file: ₹65 × I/T ÷ 60 × a fixed number of people per line (see the checks), × 2 for overtime.', 'Line Pulse: ₹ per man-hour (Setup → HPR) × I/T ÷ 60 × M/P of the morning entry, × overtime factor from the overtime time.'],
    ['TGT UPH', 'Their file: day target ÷ hours typed in the formula.', 'Line Pulse: day target ÷ working hours of the shift.'],
  ],
  kpi: [
    ['Plan of a model', 'Their file: from the plant\'s plan (typed in).', 'Line Pulse: the line\'s hourly plan shared over the models of the hour by their pieces.'],
    ['UPH / UPPH', 'Their file: UPH target = 3600 ÷ cycle; UPPH ÷ a fixed number of people per line (see the checks).', 'Line Pulse: UPH target = 3600 ÷ target cycle in force that day; UPPH ÷ M/P of the morning entry.'],
    ['FPY / RTY', 'Both: stage FPY = 1 − stage defects ÷ production; RTY = product of the six FPY.', 'Differences come from the defect counts (Quality entry stages) or the production.'],
  ],
  rwk: [
    ['Pieces', 'Their file: typed per hour by IPQC.', 'Line Pulse: the rework and rejection rows of the Quality entry page, hour by hour.'],
    ['₹', 'Both: pieces × ₹55.', ''],
  ],
  cell: [['Cell by cell', 'Every cell of the same sheet and the same place (B7 against B7): a number is the same only when it is equal (a gap up to 2 % shows as a small difference); text is the same when it reads the same (capitals and extra spaces aside).', 'Use it for two files of the same layout (two versions of one report).']],
};
for (const t of TABLE_TYPES) HOW[t.id] = [['Columns', `Both: the columns of Reports → ${t.name}; one row per ${t.keys.join(' · ')}.`, 'Line Pulse makes the same report from its own data for the same days.']];

/** the comparison as an Excel file: Summary, Differences, By day, Checks of their file */
function compareXlsx({ type, theirName, ourName, from, to, S, rows, checks, fmt }) {
  const L = (l) => (l ? `Line ${l}` : '');
  const head = (list) => list.map((v) => ({ v, s: 'hprHead' }));
  const n = (measure, v) => {
    if (v == null || v === '') return { v: '', s: 'hprCenter' };
    const k = MEASURES[measure]?.kind;
    if (k === 'text' || typeof v !== 'number') return { v: String(v), s: 'hprText' };
    const d = k === 'ratio' ? 4 : k === 'money' ? 0 : 2;
    return { v: Math.round(v * 10 ** d) / 10 ** d, s: 'hprCenter' };
  };
  const t = (v) => ({ v: v ?? '', s: 'hprText' });
  const c = (v) => ({ v: v ?? '', s: 'hprCenter' });
  const now = serverNow();
  const made = `${dmy(serverToday())} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const sub = `Their file: ${theirName} · Line Pulse: ${ourName} · ${dmy(from)} to ${dmy(to)} · made ${made}`;
  const sumRows = [
    [{ v: `Report compare — ${REPORT_NAMES[type]}`, s: 'title' }], [{ v: sub, s: 'subtitle' }], [],
    head(['Compared', 'Same', 'Small difference', 'Different', 'Only in their report', 'Only in Line Pulse', 'Text (reason / dept) not the same']),
    [c(S.tiles.all), c(S.tiles.same), c(S.tiles.close), c(S.tiles.diff), c(S.tiles.theirs), c(S.tiles.ours), c(S.tiles.textDiff)], [],
    head(['Measure', 'Compared', 'Same', 'Small difference', 'Different', 'Only theirs', 'Only Line Pulse', 'Their total', 'Line Pulse total', 'Largest difference']),
    ...S.byMeasure.map((m) => [t(m.label), c(m.n), c(m.same), c(m.close), c(m.diff), c(m.theirs), c(m.ours), m.sumOk ? n(m.measure, m.sumT) : c(''), m.sumOk ? n(m.measure, m.sumO) : c(''),
      t(m.worst ? `${[dmy(m.worst.date), L(m.worst.line), m.worst.show].filter(Boolean).join(' · ')}: theirs ${showVal(m.measure, m.worst.theirs)}, Line Pulse ${showVal(m.measure, m.worst.ours)}` : '')]),
  ];
  const diffs = rows.filter((r) => r.status !== 'same');
  const difRows = [
    [{ v: `Differences — ${REPORT_NAMES[type]}`, s: 'title' }], [{ v: sub, s: 'subtitle' }], [],
    head(['Date', 'Line', 'Where', 'Measure', 'Their report', 'Line Pulse', 'Difference', 'Difference %', 'Status']),
    ...diffs.map((r) => [c(dmy(r.date)), c(L(r.line)), t(r.show), t(MEASURES[r.measure].label), n(r.measure, r.theirs), n(r.measure, r.ours), n(r.measure, r.diff), c(r.pct == null ? '' : Math.round(r.pct * 1000) / 10), t(STATUS[r.status].label)]),
  ];
  const dayRows = [
    [{ v: 'By day and line', s: 'title' }], [{ v: sub, s: 'subtitle' }], [],
    head(['Date', 'Line', 'Compared', 'Different or missing', 'Small difference']),
    ...[...S.byDay].sort((a, b) => a.date.localeCompare(b.date) || Number(a.line || 0) - Number(b.line || 0)).map((d) => [c(dmy(d.date)), c(L(d.line)), c(d.n), c(d.bad), c(d.close)]),
  ];
  const chkRows = [
    [{ v: 'Checks of their file — its own numbers worked out again', s: 'title' }], [{ v: `Their file: ${theirName}`, s: 'subtitle' }], [],
    head(['Check', 'Checked', 'Not adding up', 'What their file uses']),
    ...checks.map((k) => [t(k.label), c(k.checked), c(k.bad.length), t(k.uses || '')]), [],
    head(['Check', 'Sheet', 'Row', 'Date', 'Line', 'Where', 'Their value', 'Works out to', 'Note']),
    ...checks.flatMap((k) => k.bad.map((b) => [t(k.label), c(b.sheet), c(b.row), c(dmy(b.date)), c(L(b.line)), t(b.where), c(b.value), c(typeof b.expected === 'number' ? Math.round(b.expected * 10000) / 10000 : b.expected ?? ''), t(b.note)])),
  ];
  const sheet = (name, rs, widths, headRow) => ({ name, rows: rs, cols: widths.map((w) => ({ width: w })), freezeRow: headRow, headerRow: headRow,
    merges: [`A1:${colName(widths.length - 1)}1`, `A2:${colName(widths.length - 1)}2`] });
  const FST = { same: 'Same', diff: 'Different text', moved: 'Moved', theirs: 'Only in their file', ours: 'Only in Line Pulse' };
  const fmtRows = fmt ? [
    [{ v: 'Format check — sheets and header columns side by side', s: 'title' }], [{ v: sub, s: 'subtitle' }], [],
    head(['Sheets', 'Their file', 'Line Pulse']),
    [t('Sheets'), t(fmt.sheets.theirs.join(', ')), t(fmt.sheets.ours.join(', '))], [],
    head(['Table', 'Column', 'Their header', 'Line Pulse header', 'Status']),
    ...fmt.tables.flatMap((x) => (x.only ? [[t(x.table), c(''), t(x.only === 'theirs' ? '(in their file)' : ''), t(x.only === 'ours' ? '(in Line Pulse)' : ''), t(x.only === 'theirs' ? 'Only in their file' : 'Only in Line Pulse')]]
      : x.cols.map((k) => [t(x.table), c(k.col), t(k.theirs), t(k.ours), t(k.status === 'moved' ? `Moved to ${k.to}` : FST[k.status])]))),
  ] : null;
  return buildXlsx([
    sheet('Summary', sumRows, [30, 11, 11, 13, 11, 13, 13, 14, 14, 60], 0),
    { ...sheet('Differences', difRows, [12, 9, 34, 30, 14, 14, 13, 12, 20], 4), autoFilter: diffs.length ? `A4:I${4 + diffs.length}` : null },
    sheet('By day', dayRows, [12, 9, 11, 18, 15], 4),
    sheet('Checks of their file', chkRows, [44, 10, 9, 12, 9, 26, 13, 13, 50], 0),
    ...(fmtRows ? [sheet('Format check', fmtRows, [26, 9, 34, 34, 22], 0)] : []),
  ]);
}

/** an Excel cell as the preview shows it: in its number format (dates, %, ₹ …), long text cut */
const cellText = (v, code, d1904) => {
  const s = formatCell(v, code, d1904);
  return s.length > 42 ? `${s.slice(0, 40)}…` : s;
};
const FMT = {
  same: { label: 'Same', tone: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  diff: { label: 'Different text', tone: 'bg-red-100 text-red-800 ring-red-300' },
  moved: { label: 'Moved', tone: 'bg-amber-100 text-amber-800 ring-amber-300' },
  theirs: { label: 'Only in their file', tone: 'bg-orange-100 text-orange-800 ring-orange-300' },
  ours: { label: 'Only in Line Pulse', tone: 'bg-violet-100 text-violet-800 ring-violet-300' },
};

/** a file as it looks in Excel: its sheets as tabs, the first rows with column letters and row numbers, header rows marked */
function SheetPreview({ file, label }) {
  const sheets = file?.sheets || [];
  const heads = file?.P?.recs?.heads || [];
  const first = Math.max(0, sheets.findIndex((s) => heads.some((h) => h.sheet === s.name)));
  const [si, setSi] = useState(first);
  useEffect(() => { setSi(first); }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  const sh = sheets[si] || sheets[0];
  if (!sh) return <p className="p-3 text-fs-13 text-slate-500">No sheet.</p>;
  const headRows = new Set(heads.filter((h) => h.sheet === sh.name).flatMap((h) => h.rows || [h.row]));
  const rows = sh.rows.slice(0, 40);
  const ncol = Math.min(30, Math.max(1, ...rows.map((r) => r.length)));
  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2" role="tablist" aria-label={`${label} sheets`}>
        {sheets.slice(0, 45).map((s, i) => (
          <button key={`${s.name}-${i}`} type="button" role="tab" aria-selected={i === si} onClick={() => setSi(i)}
            className={`h-8 rounded-md border px-2.5 text-fs-12 font-bold ${i === si ? 'border-[#1F3864] bg-[#1F3864] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}><span className="normal-case">{s.name}</span></button>
        ))}
        {sheets.length > 45 && <span className="self-center text-fs-12 text-slate-500">+{sheets.length - 45} more sheets</span>}
      </div>
      <div className="mt-2 max-h-[440px] overflow-auto rounded-md border border-[#BFBFBF]">
        <table className="border-collapse text-fs-12 tabular-nums" aria-label={`${label} preview`}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F3F3F3] text-center text-fs-11 font-bold text-slate-600">
              <th className="sticky left-0 z-20 w-10 border border-[#D4D4D4] bg-[#F3F3F3] px-1" />
              {Array.from({ length: ncol }, (_, i) => <th key={i} className="min-w-[56px] border border-[#D4D4D4] px-1">{colLetter(i)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className={headRows.has(r.n) ? 'bg-[#DDEBF7] font-bold text-[#1F3864]' : 'bg-white'} aria-label={headRows.has(r.n) ? `Header row ${r.n}` : undefined}>
                <th className="sticky left-0 border border-[#D4D4D4] bg-[#F3F3F3] px-1 text-center text-fs-11 font-bold text-slate-600">{r.n}</th>
                {Array.from({ length: ncol }, (_, i) => {
                  const code = sh.formats?.[r.s?.[i]] || '';
                  const num = r[i] != null && String(r[i]).trim() !== '' && Number.isFinite(Number(r[i]));   // numbers to the right, as in Excel
                  return <td key={i} title={String(r[i] ?? '')} className={`max-w-[220px] whitespace-nowrap border border-[#E5E7EB] px-1.5 py-0.5 ${num ? 'text-right' : ''}`}>{cellText(r[i], code, sh.date1904)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-fs-12 text-slate-500">Sheet "{sh.name}": first {rows.length} filled rows of {sh.rows.length}{(sh.rows[sh.rows.length - 1]?.n || 0) > rows.length ? ` (rows up to ${sh.rows[sh.rows.length - 1].n})` : ''}. Blue: the header rows the reader found.</p>
    </div>
  );
}

/** a report's name for a file name: HPR, SAWM KPI report, OLE — day by line … (no characters Windows refuses) */
const shortName = (t) => (['kpi', 'hpr'].includes(t) ? REPORT_NAMES[t].split(' —')[0] : REPORT_NAMES[t] || t).replace(/[\\/:*?"<>|]/g, ' ');

/** the sheets of a file in a line: its named sheets + "21 day sheets" */
const sheetList = (names, days) => [names.filter((x) => !/^\d{1,2}(-\d{1,2})?$/.test(String(x).trim())).join(', '), days ? `${days} day sheet${days === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ') || '—';

/** sheets and header columns of the two files side by side */
function FormatView({ fmt, lpName = 'Line Pulse' }) {
  if (!fmt) return <p className="p-3 text-fs-13 text-slate-500">Make the Line Pulse report (or choose the other file) to see the format check.</p>;
  const S = fmt.sheets;
  const onlyOurs = lpName === 'Line Pulse' ? 'Only in Line Pulse' : 'Only in the other file';
  const lab = (st) => (st === 'ours' ? onlyOurs : FMT[st].label);
  return (
    <div className="flex flex-col gap-3" aria-label="Format check">
      <div className={`rounded-lg border px-3 py-2 text-fs-13 ${fmt.ok && !S.onlyTheirs.length && !S.onlyOurs.length ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`} role="status">
        <b>{fmt.ok && !S.onlyTheirs.length && !S.onlyOurs.length ? 'The format matches: the same sheets and the same header columns.' : 'The format is not the same in every place — see below.'}</b>
        <span className="block">Their sheets: {sheetList(S.theirs, S.daysTheirs)} · {lpName}: {sheetList(S.ours, S.daysOurs)}</span>
        {S.onlyTheirs.length > 0 && <span className="block">Only in their file: {S.onlyTheirs.join(', ')}</span>}
        {S.onlyOurs.length > 0 && <span className="block">{onlyOurs}: {S.onlyOurs.join(', ')}</span>}
      </div>
      {fmt.tables.map((x) => (
        <section key={x.table} className="rounded-lg border border-slate-200" aria-label={`Format of ${x.table}`}>
          <h4 className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-fs-13 font-extrabold text-slate-900">
            {x.table}
            {x.a && <span className="text-fs-12 font-semibold normal-case text-slate-500">their sheet "{x.a.sheet}" row {x.a.row}</span>}
            {x.b && <span className="text-fs-12 font-semibold normal-case text-slate-500">· {lpName} sheet "{x.b.sheet}" row {x.b.row}</span>}
            <span className={`ml-auto rounded-full px-2 py-0.5 text-fs-12 font-bold normal-case ring-1 ${x.ok ? FMT.same.tone : x.only ? FMT[x.only].tone : FMT.diff.tone}`}>
              {x.only ? lab(x.only) : x.ok ? 'Same columns' : `${x.cols.filter((c) => c.status !== 'same').length} of ${x.cols.length} columns differ`}
            </span>
          </h4>
          {!x.only && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-fs-12" aria-label={`Columns of ${x.table}`}>
                <thead><tr className="bg-[#1F3864] text-white">{['Column', 'Their header', `${lpName} header`, 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{x.cols.map((c) => (
                  <tr key={c.col} className={c.status === 'same' ? '' : 'bg-red-50/40'}>
                    <td className={`${td} text-center font-mono font-bold`}>{c.col}</td><td className={td}>{c.theirs || '—'}</td><td className={td}>{c.ours || '—'}</td>
                    <td className={td}><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-bold ring-1 ${FMT[c.status].tone}`}>{c.status === 'moved' ? `Moved to ${c.to}` : lab(c.status)}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export default function ReportComparePage() {
  const today = serverToday();
  const ALL = useOleLines();
  const { ui } = useUiSettings();
  const hprSet = ui.hpr || { rate: 65, otFrom: '18:00', otX: 2 };
  const [asType, setAsType] = useState('auto');    // the type of the files: found from the headers, or chosen
  const [their, setTheir] = useState(null);       // { name, sheets, P, C, error }
  const [mode, setMode] = useState('lp');          // 'lp' = Line Pulse makes the report now · 'file' = another Excel file
  const [ourFile, setOurFile] = useState(null);    // { name, sheets, P, error }
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [run, setRun] = useState(null);            // { type, from, to, n } of the Line Pulse report being made
  const [ctx, setCtx] = useState(null);
  const [made, setMade] = useState(null);          // { from, to, ourName, P, sheets, bytes, fileName } of the comparison on the screen
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [view, setView] = useState('theirs');      // preview tab: theirs · ours · format
  const [show, setShow] = useState('bad');
  const [fMeasure, setFMeasure] = useState('');
  const [fLine, setFLine] = useState('');
  const [fDay, setFDay] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(200);
  const [openCheck, setOpenCheck] = useState(null);

  /** sheets → the parsed file (type found or chosen); a file whose type is not found keeps its sheets for the preview */
  const parse = (name, sheets, as) => {
    try {
      const P = parseReport(sheets, { as: as === 'auto' ? null : as });
      if (!P.n) return { name, sheets, P: null, error: `No numbers were found under the headers of the ${REPORT_NAMES[P.type]}.` };
      return { name, sheets, P, error: null };
    } catch (e) { return { name, sheets, P: null, error: String(e.message || e) }; }
  };
  const setTheirFile = (f) => {
    setTheir(f ? { ...f, C: f.P ? fileChecks(f.P, hprSet) : [] } : null);
    setMade(null); setRun(null); setCtx(null); setView('theirs');
    if (f?.P?.dates) {
      const last = f.P.dates[1];
      setFrom(daysBetween(f.P.dates[0], last) >= MAX_DAYS ? addDays(last, -(MAX_DAYS - 1)) : f.P.dates[0]); setTo(last);
    }
  };
  const read = async (file, side) => {
    if (!file) return;
    setErr(''); setBusy(`Reading ${file.name}…`);
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('choose an .xlsx (Excel) file. An old .xls file: open it in Excel and save it as .xlsx.');
      const sheets = await readWorkbook(await file.arrayBuffer());
      // the second file is read as the type of their file
      const f = parse(file.name, sheets, side === 'their' ? asType : (their?.P?.type || asType));
      if (side === 'their') setTheirFile(f); else { setOurFile(f); setMade(null); }
    } catch (e) { setErr(`${file.name}: ${e.message || e}`); }
    finally { setBusy(''); }
  };
  const chooseType = (t) => {
    setAsType(t); setErr('');
    if (their?.sheets) setTheirFile(parse(their.name, their.sheets, t));
    if (ourFile?.sheets) setOurFile(parse(ourFile.name, ourFile.sheets, t === 'auto' ? (their?.P?.type || 'auto') : t));
  };

  const type = their?.P?.type || null;
  const has = typeHas(type);
  const rep = REPORTS.find((r) => r.id === type) || null;
  const compare = () => {
    setErr(''); setLimit(200); setFDay(''); setFLine(''); setFMeasure('');
    if (!their?.P) { setErr(their ? 'Choose the type of their file first (it was not found from its headers).' : 'Choose their report first.'); return; }
    if (has.date && (!from || !to || from > to)) { setErr('Choose the days to compare ("From" before "To").'); return; }
    if (mode === 'file' || type === 'cell') {
      if (mode !== 'file') { setErr('"Any Excel — cell by cell" compares two files: choose "Another Excel file" and the second file.'); return; }
      if (!ourFile?.P) { setErr(ourFile ? `The second file: ${ourFile.error}` : 'Choose the second file (a report downloaded from Line Pulse, or another Excel).'); return; }
      if (ourFile.P.type !== type) { setErr(`Both files must be the same report: theirs is the ${REPORT_NAMES[type]}, the other is the ${REPORT_NAMES[ourFile.P.type]}.`); return; }
      setMade({ from: has.date ? from : '', to: has.date ? to : '9999-12-31', ourName: ourFile.name, P: ourFile.P, sheets: ourFile.sheets });
      setView('format');
      return;
    }
    const t = has.date && to > today ? today : to;   // Line Pulse has data up to today
    if (has.date && from > t) { setErr(`These days are after today (${dmy(today)}): Line Pulse has no data for them yet.`); return; }
    if (has.date && daysBetween(from, t) >= MAX_DAYS) { setErr(`Line Pulse makes at most ${MAX_DAYS} days at a time — make "From" later.`); return; }
    setMade(null); setCtx(null);
    setRun({ type, from: has.date ? from : today, to: has.date ? t : today, n: Date.now(), ole: !rep || rep.src === 'ole' });
    setBusy(rep && rep.src !== 'ole' ? `Reading the ${rep.name} of Line Pulse…` : 'Reading the Line Pulse data of these days…');
  };

  // Line Pulse makes the same report (in the same layout as its download) and it is read like their file
  useEffect(() => {
    if (!run || (run.ole && !ctx)) return undefined;
    let live = true;
    (async () => {
      try {
        setBusy(`Making the ${REPORT_NAMES[run.type]} of Line Pulse…`);
        const R0 = REPORTS.find((r) => r.id === run.type);
        let bytes = null; let fileName = `Line Pulse ${shortName(run.type)} ${run.from} to ${run.to}.xlsx`;
        if (run.type === 'rwk') bytes = buildXlsx([reworkXlsxSheet(rwkDataOf(ctx, run.from, run.to) || { rows: [], hours: [], totals: { total: 0, rs: 0, hours: {} } })]);
        else if (run.type === 'kpi' || run.type === 'hpr') {
          const auto = (await loadAutoTargets(false).catch(() => null)) || {};
          const ctxL = { ...ctx, lastScans: await loadLastScans(ctx, today).catch(() => ({})) };   // 21-11-2026: last hour up to the last scan
          if (run.type === 'kpi') { bytes = buildKpiXlsx(kpiDataOf(ctxL, auto) || []); fileName = `Line Pulse SAWM KPI ${run.from} to ${run.to}.xlsx`; }
          else { const days = hprDataOf(ctxL, auto, hprSet) || []; bytes = days.length ? buildXlsx(buildHprSheets(days, hprSet)) : null; }
        } else if (R0) {
          const rows = R0.src === 'master' ? await loadMasterRows(ALL) : R0.src === 'targets' ? await loadTargetRows(ALL) : R0.rows({ ...ctx });
          const lines = `${ALL.length === 4 ? 'All lines' : ALL.map((l) => `Line ${l}`).join(', ')}`;
          bytes = buildXlsx([tableSheet(R0, rows, R0.cols, `${R0.name} · ${R0.src === 'ole' ? `${dmy(run.from)} to ${dmy(run.to)} · ` : ''}${lines}`, `Dixon Line Pulse · made ${dmy(today)} · ${rows.length} rows`)]);
          if (R0.src !== 'ole') fileName = `Line Pulse ${R0.name} ${today}.xlsx`;
        }
        const sheets = bytes ? await readWorkbook(bytes) : [];
        const P = bytes ? parseReport(sheets, { as: run.type }) : { type: run.type, facts: new Map(), recs: { heads: [], warn: [] }, days: [], dates: null, lines: [], n: 0, sheets: [], sheetNames: [] };
        if (!live) return;
        const d = typeHas(run.type).date;
        setMade({ from: d ? run.from : '', to: d ? run.to : '9999-12-31', ourName: `Line Pulse (made ${dmy(today)})`, P, sheets, bytes, fileName });
        setView('ours');
        setBusy('');
      } catch (e) { if (live) { setErr(`The Line Pulse report could not be made: ${e.message || e}`); setBusy(''); } }
    })();
    return () => { live = false; };
  }, [ctx, run]); // eslint-disable-line react-hooks/exhaustive-deps

  // the lines of their file only (a plant file of two lines is not compared with the other lines of Line Pulse)
  const cmpLines = useMemo(() => (their?.P && has.line ? their.P.lines.filter((l) => mode !== 'lp' || ALL.includes(l)) : null), [their, mode, has.line, ALL.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const shared = useMemo(() => (their?.P && made?.P ? sharedColumns(their.P, made.P) : null), [their, made]);
  const rows = useMemo(() => (their?.P && made ? compareFacts(their.P.facts, made.P.facts, { from: made.from, to: made.to, lines: cmpLines, measures: shared?.measures || null }) : null), [their, made, cmpLines, shared]);
  const S = useMemo(() => (rows ? summarize(rows) : null), [rows]);
  const fmt = useMemo(() => (their?.P && made?.P ? formatCheck(their.P, made.P) : null), [their, made]);
  const shown = useMemo(() => {
    if (!rows) return [];
    const ql = q.trim().toLowerCase();
    return rows.filter((r) => (show === 'all' ? true : show === 'bad' ? BAD.includes(r.status) : show === 'text' ? MEASURES[r.measure].kind === 'text' && r.status !== 'same' : r.status === show)
      && (show === 'text' || show === 'all' || MEASURES[r.measure].kind !== 'text')
      && (!fMeasure || r.measure === fMeasure) && (!fLine || r.line === fLine) && (!fDay || r.date === fDay)
      && (!ql || `${r.show} ${MEASURES[r.measure].label} ${r.theirs ?? ''} ${r.ours ?? ''}`.toLowerCase().includes(ql)));
  }, [rows, show, fMeasure, fLine, fDay, q]);
  const days = useMemo(() => (S ? [...new Set(S.byDay.map((d) => d.date))].sort() : []), [S]);
  const lines = useMemo(() => (S ? [...new Set(S.byDay.map((d) => d.line))].sort((a, b) => Number(a || 0) - Number(b || 0)) : []), [S]);
  const dayCell = (d, l) => S?.byDay.find((x) => x.date === d && x.line === l) || null;

  const download = () => {
    if (!S) return;
    const bytes = compareXlsx({ type, theirName: their.name, ourName: made.ourName, from: made.from, to: made.to, S, rows, checks: their.C, fmt });
    downloadXlsx(bytes, `Report compare ${shortName(type)}${has.date ? ` ${made.from} to ${made.to}` : ''}.xlsx`);
  };
  const tile = (k, label, n, tone, onClick) => (
    <button type="button" key={k} data-testid={`cmp-${k}`} onClick={onClick} disabled={!onClick}
      className={`rounded-xl border px-3 py-2 text-left transition ${onClick ? 'hover:bg-slate-50' : ''} ${show === k ? 'border-blue-600 ring-2 ring-blue-600' : 'border-slate-200'}`}>
      <div className="text-fs-12 font-bold text-slate-600">{label}</div>
      <div className={`font-mono text-fs-24 font-extrabold leading-tight ${n ? tone : 'text-slate-400'}`}>{n.toLocaleString('en-IN')}</div>
    </button>
  );
  const checksBad = their?.C ? their.C.reduce((a, c) => a + c.bad.length, 0) : 0;
  const ourSide = made ? { name: made.ourName, sheets: made.sheets, P: made.P } : mode === 'file' ? ourFile : null;
  const tdef = TABLE_TYPES.find((t) => t.id === type);
  // the "Where" column: Cell (cell by cell), the key columns of a table report (none for a day × line table), else Where
  const whereHead = type === 'cell' ? 'Cell' : tdef ? tdef.keys.filter((k) => k !== 'date' && k !== 'line').map((k) => tdef.cols.find((c) => c[0] === k)?.[1] || k).join(' · ') : 'Where';
  const tabBtn = (k, label, on = true) => (
    <button key={k} type="button" role="tab" aria-selected={view === k} disabled={!on} onClick={() => setView(k)}
      className={`h-9 border-r border-slate-300 px-3 text-fs-13 font-bold last:border-r-0 disabled:opacity-40 ${view === k ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-slate-50'}`}>{label}</button>
  );

  return (
    <div className="flex flex-col gap-3" aria-label="Report compare">
      {run?.ole && mode === 'lp' && <OleSource key={run.n} start={run.from} end={run.to} ids={ALL} onReady={(c, e) => { if (c) setCtx(c); if (e) { setErr(`Line Pulse data could not be read: ${e}`); setBusy(''); } }} />}
      <section className={card} aria-label="Reports to compare">
        <h2 className="flex items-center gap-2 text-fs-18 font-extrabold text-slate-900"><GitCompare size={20} className="text-blue-700" aria-hidden /> Report compare — their Excel against Line Pulse</h2>
        <p className="mt-1 text-fs-13 text-slate-600">Every report can be compared: the plant's SAWM KPI, HPR and hourly rework data (Book1), every table of the Reports page, or any two Excel files cell by cell. First see both files as they look in Excel and whether their format is the same, then every number side by side.</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-fs-13 font-extrabold uppercase tracking-wide text-slate-700">1 · Their report</div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 text-fs-14 font-bold text-blue-800 hover:bg-blue-50">
                <FileUp size={16} aria-hidden /> Choose Excel file
                <input type="file" accept=".xlsx" aria-label="Their report (Excel)" className="sr-only" onChange={(e) => { read(e.target.files?.[0], 'their'); e.target.value = ''; }} />
              </label>
              <label className="text-fs-12 font-bold text-slate-700">Report type
                <select aria-label="Report type" value={asType} onChange={(e) => chooseType(e.target.value)} className={`${inp} mt-0.5 block h-10 max-w-[300px]`}>
                  <option value="auto">Find from the headers{type && asType === 'auto' ? ` (${REPORT_NAMES[type]})` : ''}</option>
                  {COMPARE_TYPES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            </div>
            {their && (
              <div className="mt-2 text-fs-13 text-slate-800" aria-label="Their report read">
                <b>{their.name}</b>{their.P ? <> — <span className="font-bold text-blue-800">{REPORT_NAMES[type]}</span></> : null}
                {their.P && <span className="block text-slate-600">{has.date ? `${their.P.days.length} day${their.P.days.length === 1 ? '' : 's'} (${dmy(their.P.dates?.[0])} → ${dmy(their.P.dates?.[1])}) · ` : ''}{has.line ? `lines ${their.P.lines.join(', ')} · ` : ''}{their.sheets.length} sheet{their.sheets.length === 1 ? '' : 's'} · {their.P.n.toLocaleString('en-IN')} {type === 'cell' ? 'cells' : 'numbers'} read</span>}
                {their.error && <span className="mt-1 block rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-900" role="alert">{their.error}</span>}
                {(their.P?.recs?.warn || []).map((w) => <span key={w} className="block text-fs-12 text-amber-800">{w}</span>)}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-fs-13 font-extrabold uppercase tracking-wide text-slate-700">2 · Compare with</div>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Compare with">
              {[['lp', 'Line Pulse (made now)'], ['file', 'Another Excel file']].map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setMade(null); }}
                  className={`h-10 rounded-lg border px-3 text-fs-14 font-bold ${mode === k ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
            {mode === 'file' && (
              <div className="mt-2">
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-violet-300 bg-white px-3 text-fs-14 font-bold text-violet-800 hover:bg-violet-50">
                  <FileUp size={16} aria-hidden /> Choose the other file
                  <input type="file" accept=".xlsx" aria-label="Line Pulse report (Excel)" className="sr-only" onChange={(e) => { read(e.target.files?.[0], 'ours'); e.target.value = ''; }} />
                </label>
                {ourFile && <div className="mt-1 text-fs-13 text-slate-800"><b>{ourFile.name}</b>{ourFile.P ? <> — {REPORT_NAMES[ourFile.P.type]}{ourFile.P.dates ? ` · ${ourFile.P.days.length} day${ourFile.P.days.length === 1 ? '' : 's'} (${dmy(ourFile.P.dates[0])} → ${dmy(ourFile.P.dates[1])})` : ''}</> : <span className="block font-semibold text-amber-800">{ourFile.error}</span>}</div>}
              </div>
            )}
            {mode === 'lp' && <p className="mt-2 text-fs-12 text-slate-600">{type === 'cell' ? '"Any Excel — cell by cell" needs a second file: choose "Another Excel file".' : `Line Pulse makes the ${type ? REPORT_NAMES[type] : 'same report'} from its own data — exactly as Reports → download makes it${has.date ? ` (at most ${MAX_DAYS} days at a time)` : ''}.`}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {has.date && <>
            <label className="text-fs-13 font-bold text-slate-700">From<input type="date" aria-label="Compare from" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inp} mt-1 block`} /></label>
            <label className="text-fs-13 font-bold text-slate-700">To<input type="date" aria-label="Compare to" value={to} onChange={(e) => setTo(e.target.value)} className={`${inp} mt-1 block`} /></label>
          </>}
          <button type="button" onClick={compare} disabled={!their?.P || !!busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><GitCompare size={16} aria-hidden /> {mode === 'lp' ? 'Make Line Pulse report & compare' : 'Compare'}</button>
          {made?.bytes && <button type="button" onClick={() => downloadXlsx(made.bytes, made.fileName)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-blue-600 bg-white px-3 text-fs-14 font-bold text-blue-800 hover:bg-blue-50"><Download size={16} aria-hidden /> Line Pulse file</button>}
          {S && <button type="button" onClick={download} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-3 text-fs-14 font-bold text-emerald-800 hover:bg-emerald-50"><Download size={16} aria-hidden /> Download differences (Excel)</button>}
          <span role="status" className="text-fs-13 font-semibold text-sky-800">{busy}</span>
        </div>
        {has.date && their?.P?.dates && (their.P.dates[0] < from || their.P.dates[1] > to) && <p className="mt-2 text-fs-12 text-slate-600">Their file has {dmy(their.P.dates[0])} → {dmy(their.P.dates[1])}; only {dmy(from)} → {dmy(to)} is compared.</p>}
        {err && <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />{err}<button type="button" aria-label="Close the message" onClick={() => setErr('')} className="ml-auto"><X size={14} /></button></div>}
      </section>

      {their && (
        <section className={card} aria-label="Preview">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto flex items-center gap-2 text-fs-15 font-extrabold text-slate-900"><Eye size={18} className="text-blue-700" aria-hidden /> Preview — the files as they look in Excel</h3>
            <div className="flex overflow-hidden rounded-md border border-slate-300" role="tablist" aria-label="Preview of">
              {tabBtn('theirs', 'Their file')}
              {tabBtn('ours', mode === 'lp' ? 'Line Pulse' : 'Other file', !!ourSide?.sheets?.length)}
              {tabBtn('format', 'Format check', !!fmt)}
            </div>
          </div>
          <div className="mt-2">
            {view === 'theirs' && <SheetPreview file={their} label="Their file" />}
            {view === 'ours' && (ourSide?.sheets?.length ? <SheetPreview file={ourSide} label={mode === 'lp' ? 'Line Pulse' : 'Other file'} /> : <p className="p-3 text-fs-13 text-slate-500">Press "{mode === 'lp' ? 'Make Line Pulse report & compare' : 'Compare'}" to see it.</p>)}
            {view === 'format' && <FormatView fmt={fmt} lpName={mode === 'lp' ? 'Line Pulse' : 'Other file'} />}
          </div>
          {fmt && view !== 'format' && (
            <button type="button" onClick={() => setView('format')} className={`mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-fs-13 font-bold ${fmt.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              <Columns3 size={15} aria-hidden /> Format: {fmt.ok ? 'the same columns in both' : `${fmt.tables.reduce((a, x) => a + (x.only ? 1 : x.cols.filter((c) => c.status !== 'same').length), 0)} differences in the headers`} — see the format check
            </button>
          )}
        </section>
      )}

      {their?.P && their.C.length > 0 && (
        <section className={card} aria-label="Checks of their file">
          <h3 className="flex items-center gap-2 text-fs-15 font-extrabold text-slate-900"><ListChecks size={18} className="text-blue-700" aria-hidden /> Checks of their file — its own numbers worked out again
            <span className={`ml-auto rounded-full px-2 py-0.5 text-fs-12 font-bold ${checksBad ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>{checksBad ? `${checksBad} rows do not add up` : 'all add up'}</span></h3>
          <ul className="mt-2 grid gap-1.5">
            {their.C.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200">
                <button type="button" onClick={() => setOpenCheck(openCheck === c.id ? null : c.id)} aria-expanded={openCheck === c.id} aria-label={`Check ${c.label}`} disabled={!c.bad.length}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
                  {c.bad.length ? <AlertTriangle size={15} className="text-red-700" aria-hidden /> : <CheckCircle2 size={15} className="text-emerald-700" aria-hidden />}
                  <span className="text-fs-14 font-bold text-slate-900">{c.label}</span>
                  <span className="text-fs-12 text-slate-600">{c.checked.toLocaleString('en-IN')} checked</span>
                  <span className={`ml-auto font-mono text-fs-13 font-bold ${c.bad.length ? 'text-red-700' : 'text-emerald-700'}`}>{c.bad.length ? `${c.bad.length} not adding up` : 'OK'}</span>
                </button>
                {c.uses && <p className="flex items-start gap-1.5 px-3 pb-2 text-fs-13 text-slate-700"><Info size={14} className="mt-0.5 shrink-0 text-blue-700" aria-hidden />{c.uses}</p>}
                {openCheck === c.id && c.bad.length > 0 && (
                  <div className="overflow-x-auto px-3 pb-3">
                    <table className="w-full border-collapse text-fs-12 tabular-nums" aria-label={`Rows of ${c.label}`}>
                      <thead><tr className="bg-[#1F3864] text-white">{['Sheet', 'Row', 'Date', 'Line', 'Where', 'Their value', 'Works out to', 'Note'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                      <tbody>{c.bad.slice(0, 100).map((b, i) => (
                        <tr key={i} className="text-center">
                          <td className={td}>{b.sheet}</td><td className={td}>{b.row}</td><td className={`${td} whitespace-nowrap`}>{dmy(b.date)}</td><td className={td}>{b.line ? `L${b.line}` : ''}</td>
                          <td className={`${td} text-left`}>{b.where}</td><td className={`${td} font-mono`}>{b.value ?? '—'}</td>
                          <td className={`${td} font-mono`}>{typeof b.expected === 'number' ? fmtN(b.expected, 4) : (b.expected ?? '—')}</td><td className={`${td} text-left`}>{b.note}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {c.bad.length > 100 && <p className="mt-1 text-fs-12 text-slate-500">First 100 of {c.bad.length} — all are in the downloaded Excel.</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {S && (
        <section className={card} aria-label="Compare result">
          <h3 className="text-fs-15 font-extrabold text-slate-900">{REPORT_NAMES[type]}{has.date ? ` · ${dmy(made.from)} → ${dmy(made.to)}` : ''} · their file vs {made.ourName}</h3>
          {has.line && cmpLines && <p className="text-fs-12 text-slate-600">Lines compared: {cmpLines.map((l) => `Line ${l}`).join(', ')} (the lines in their file).{has.date ? ' A day missing in one of the two shows as "only in …".' : ''}</p>}
          {shared && (shared.onlyTheirs.length + shared.onlyOurs.length > 0) && (
            <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-fs-12 font-semibold text-amber-900" aria-label="Columns not compared">
              Not compared — a column only one file has (see the format check): {[...shared.onlyTheirs.map((m) => `${MEASURES[m].label} (only theirs)`), ...shared.onlyOurs.map((m) => `${MEASURES[m].label} (only ${mode === 'lp' ? 'Line Pulse' : 'the other file'})`)].join(', ')}.
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label="Compare totals">
            {tile('all', type === 'cell' ? 'Cells compared' : 'Numbers compared', S.tiles.all, 'text-slate-900', () => setShow('all'))}
            {tile('same', 'Same', S.tiles.same, 'text-emerald-700', () => setShow('same'))}
            {tile('close', 'Small difference (≤ 2 %)', S.tiles.close, 'text-amber-700', () => setShow('close'))}
            {tile('diff', 'Different', S.tiles.diff, 'text-red-700', () => setShow('diff'))}
            {tile('theirs', 'Only in their report', S.tiles.theirs, 'text-orange-700', () => setShow('theirs'))}
            {tile('ours', mode === 'lp' ? 'Only in Line Pulse' : 'Only in the other file', S.tiles.ours, 'text-violet-700', () => setShow('ours'))}
            {tile('text', 'Text / wording differs', S.tiles.textDiff, 'text-slate-700', S.tiles.text ? () => setShow('text') : null)}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Compare by measure">
              <thead><tr className="bg-[#1F3864] text-center text-fs-12 text-white">{['Measure', 'Compared', 'Same', 'Small', 'Different', 'Only theirs', mode === 'lp' ? 'Only Line Pulse' : 'Only other', 'Their total', mode === 'lp' ? 'Line Pulse total' : 'Other total', 'Largest difference'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{S.byMeasure.map((m) => {
                const bad = m.diff + m.theirs + m.ours;
                return (
                  <tr key={m.measure} aria-label={`Measure ${m.label}`} onClick={() => { setFMeasure(m.measure); setShow(m.kind === 'text' ? 'text' : bad ? 'bad' : 'all'); }}
                    className={`cursor-pointer text-center hover:bg-[#DDEBF7]/50 ${fMeasure === m.measure ? 'bg-blue-50' : bad ? 'bg-red-50/40' : ''}`}>
                    <td className={`${td} text-left font-semibold`}>{m.label}</td><td className={td}>{m.n}</td>
                    <td className={`${td} text-emerald-700`}>{m.same || ''}</td><td className={`${td} text-amber-700`}>{m.close || ''}</td><td className={`${td} font-bold text-red-700`}>{m.diff || ''}</td>
                    <td className={`${td} text-orange-700`}>{m.theirs || ''}</td><td className={`${td} text-violet-700`}>{m.ours || ''}</td>
                    <td className={`${td} font-mono`}>{m.sumOk ? showVal(m.measure, m.sumT) : ''}</td><td className={`${td} font-mono`}>{m.sumOk ? showVal(m.measure, m.sumO) : ''}</td>
                    <td className={`${td} text-left text-fs-12`}>{m.worst ? `${[dmy(m.worst.date), m.worst.line ? `L${m.worst.line}` : '', m.worst.show].filter(Boolean).join(' · ')}: ${showVal(m.measure, m.worst.theirs)} vs ${showVal(m.measure, m.worst.ours)}` : ''}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>

          {has.date && (
            <div className="mt-4 overflow-x-auto">
              <table className="border-collapse text-fs-12 tabular-nums" aria-label="Compare by day and line">
                <thead><tr className="bg-[#1F3864] text-center text-white"><th className={th}>Day</th>{lines.map((l) => <th key={l} className={th}>{l ? `Line ${l}` : 'All'}</th>)}</tr></thead>
                <tbody>{days.map((d) => (
                  <tr key={d} className="text-center">
                    <td className={`${td} whitespace-nowrap font-semibold`}>{dmy(d)}</td>
                    {lines.map((l) => {
                      const x = dayCell(d, l);
                      if (!x || !x.n) return <td key={l} className={`${td} text-slate-400`}>—</td>;
                      const share = x.bad / x.n;
                      return (
                        <td key={l} className={`${td} p-0`}>
                          <button type="button" aria-label={`Day ${dmy(d)} line ${l}: ${x.bad} of ${x.n} different`} onClick={() => { setFDay(d); setFLine(l); setShow('bad'); }}
                            className={`w-full px-2 py-1 font-mono font-bold ${share === 0 ? 'bg-emerald-50 text-emerald-800' : share <= 0.1 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800'} ${fDay === d && fLine === l ? 'ring-2 ring-inset ring-blue-600' : ''}`}>
                            {x.bad ? `${x.bad} / ${x.n}` : '✓'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-1 text-fs-12 text-slate-500">Numbers different or missing / compared, per day and line. Click a cell for its rows.</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2" aria-label="Difference filters">
            <div className="flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Show">
              {[['bad', 'Different & missing'], ['close', 'Small'], ['same', 'Same'], ['text', 'Wording'], ['all', 'All']].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`h-9 border-r border-slate-300 px-2.5 text-fs-13 font-bold last:border-r-0 ${show === k ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
            <select aria-label="Measure filter" value={fMeasure} onChange={(e) => setFMeasure(e.target.value)} className={`${inp} h-9`}>
              <option value="">All measures</option>
              {S.byMeasure.map((m) => <option key={m.measure} value={m.measure}>{m.label}</option>)}
            </select>
            {has.line && (
              <select aria-label="Line filter" value={fLine} onChange={(e) => setFLine(e.target.value)} className={`${inp} h-9`}>
                <option value="">All lines</option>
                {lines.filter(Boolean).map((l) => <option key={l} value={l}>Line {l}</option>)}
              </select>
            )}
            {has.date && (
              <select aria-label="Day filter" value={fDay} onChange={(e) => setFDay(e.target.value)} className={`${inp} h-9`}>
                <option value="">All days</option>
                {days.map((d) => <option key={d} value={d}>{dmy(d)}</option>)}
              </select>
            )}
            <input type="search" aria-label="Search differences" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model, defect, hour, cell…" className={`${inp} h-9 w-48`} />
            {(fMeasure || fLine || fDay || q) && <button type="button" onClick={() => { setFMeasure(''); setFLine(''); setFDay(''); setQ(''); }} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-semibold text-slate-700">Clear filters</button>}
            <span className="ml-auto text-fs-13 font-semibold text-slate-600" aria-label="Rows shown">{shown.length.toLocaleString('en-IN')} rows</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Differences">
              <thead><tr className="bg-[#1F3864] text-center text-fs-12 text-white">{[...(has.date ? ['Date'] : []), ...(has.line ? ['Line'] : []), ...(whereHead ? [whereHead] : []), ...(type === 'cell' ? [] : ['Measure']), 'Their report', mode === 'lp' ? 'Line Pulse' : 'Other file', 'Difference', '%', 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{shown.slice(0, limit).map((r) => (
                <tr key={r.key} className="text-center">
                  {has.date && <td className={`${td} whitespace-nowrap`}>{dmy(r.date)}</td>}{has.line && <td className={td}>{r.line ? `L${r.line}` : ''}</td>}
                  {whereHead && <td className={`${td} text-left`}>{r.show || '—'}</td>}{type !== 'cell' && <td className={`${td} text-left`}>{MEASURES[r.measure].label}</td>}
                  <td className={`${td} font-mono`}>{showVal(r.measure, r.theirs)}</td><td className={`${td} font-mono`}>{showVal(r.measure, r.ours)}</td>
                  <td className={`${td} font-mono font-bold ${r.status === 'diff' ? 'text-red-700' : r.status === 'close' ? 'text-amber-700' : ''}`}>{showDiff(r)}</td>
                  <td className={`${td} font-mono`}>{r.pct == null ? '—' : `${r.pct > 0 ? '+' : ''}${fmtN(r.pct * 100, 1)}%`}</td>
                  <td className={td}><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-fs-12 font-bold ring-1 ${TONE[r.status]}`}>{STATUS[r.status].label}</span></td>
                </tr>
              ))}</tbody>
            </table>
            {!shown.length && <p className="py-4 text-center text-fs-14 font-semibold text-emerald-700">Nothing to show with these filters{show === 'bad' ? ' — no differences' : ''}.</p>}
            {shown.length > limit && <button type="button" onClick={() => setLimit(limit + 300)} className="mt-2 h-9 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-800">Show 300 more ({(shown.length - limit).toLocaleString('en-IN')} left)</button>}
          </div>

          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-3" aria-label="How the two work it out">
            <div className="flex items-center gap-1.5 text-fs-13 font-extrabold uppercase tracking-wide text-blue-900"><Info size={15} aria-hidden /> How the two work it out</div>
            <ul className="mt-1 grid gap-1 text-fs-13 text-slate-800">
              {(HOW[type] || []).map(([k, a, b]) => <li key={k}><b>{k}:</b> {a} {b}</li>)}
              {(their.C || []).filter((c) => c.uses).map((c) => <li key={c.id}><b>Their file:</b> {c.uses}</li>)}
              {type === 'cell' && <li>Up to {CELL_ROWS.toLocaleString('en-IN')} rows of every sheet are compared.</li>}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
