/**
 * 20-11-2026: Report compare — the plant's own Excel reports against the same reports of Line Pulse.
 *
 * Both sides are read the same way (readWorkbook → parseReport), so a report downloaded from Line Pulse and the plant's
 * file are read by one code:
 *   kpi  SAWM KPI report: Summary (date × line), FTY & RTY (date × line, the six stages), day sheets (date × line × model)
 *   hpr  HPR: one sheet per day — line summary (date × line) and the hours (date × line × hour, models in the hour);
 *        the hour target = the Tgt cells of the hour's rows (the plant file writes it once, Line Pulse per model)
 *   rwk  Hourly rework data (IPQC, "Book1"): date × line × stage × defect × model with the pieces of every hour and ₹
 *   oleDay · oleHour · modelDay · losses · targets · master — the table reports of the Reports page (one header row,
 *        one row per date · line · hour / model / reason; columns found by their label)
 *   cell any two Excel files cell by cell (same sheet, same cell)
 * Columns are found by their header text (not by letter), dates may be Excel day numbers or text, a date written once
 * for several rows (merged cells) carries down. Line names: FA-01, Line-1, Line-1(C8), Line-1 C8 → line 1.
 *
 * Every number becomes a fact { measure, date, line, where, v }. compareFacts joins the two sides on
 * measure + date + line + where:
 *   same    difference within the rounding of the measure (pieces ±0.5, ₹ ±1, % ±0.05 …)
 *   close   small difference (2 % — % / FPY: 0.2 points)
 *   diff    more than that
 *   theirs  only in their report · ours = only in Line Pulse (a missing value against 0 counts as the same)
 * fileChecks works their own numbers out again from their own cells (sum of the models, gap, I/T, loss ₹, FPY, RTY,
 * totals, ₹ of the rework) and lists the rows that do not add up and what the file uses (people in the loss ₹, hours of
 * the UPH, ₹ per piece). formatCheck puts the header rows (and the sheets) of the two files side by side, column by column.
 * Pure — tested in tests/reportCompare.calc.test.js.
 */
import { cellDate } from './sheetRead';
import { KPI_STAGES, stageOf } from './kpiStages';
import { REPORTS } from './reportDefs';

const low = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const tight = (s) => low(s).replace(/\s+/g, '');
const pad = (n) => String(n).padStart(2, '0');
/** model / defect names as one key: capitals, single spaces */
export const normName = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/[\s.]+$/, '');
export const num = (v) => { const s = String(v ?? '').trim(); if (!s || s.startsWith('#')) return null; const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
/** 'FA-01', 'Line-1', 'Line-1(C8)', 'Line-1 C8', 'L1', 'Line 1' → '1'; 'PKG-01', 'TRC', 'Total' → null */
export function lineOf(v) {
  const m = /^(?:fa|line|l)\s*[-_ ]?\s*0*(\d{1,2})(?!\d)/i.exec(String(v ?? '').trim());
  return m && Number(m[1]) > 0 ? String(Number(m[1])) : null;
}
/** '09:00-10:00', ' 13:30-14:00', '09-10' → { h: 13, min: 30 } (start hour, minutes of the slot) */
export function slotOf(v) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.](\d{2}))?$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2] || 0); let b = Number(m[3]) * 60 + Number(m[4] || 0);
  if (b <= a) b += 24 * 60;
  return { h: Number(m[1]), min: b - a };
}
const DEPTS = [[/^maint|^mnt|^mtc|^m\/c/, 'maintenance'], [/^prod|^mfg|^manuf|^assembly/, 'production'], [/^qual|^qa\b|^qc\b|^ipqc|^q$/, 'quality'],
  [/^it\b|^i\.t|^info/, 'it'], [/^stor|^scm|^supply|^mat|^ware|^logis/, 'stores / scm'], [/^ppc|^plan/, 'ppc'], [/^util|^elec|^power/, 'utility'],
  [/^eng|^ie\b|^process|^npi|^ped|^me\b/, 'engineering'], [/^hr\b|^human|^admin/, 'hr / admin'], [/^r ?& ?d|^rnd|^design/, 'r&d']];
/** department as one key: Maint / Maintenance → maintenance, Prod → production … */
export const deptKey = (s) => { const t = low(s); if (!t) return ''; for (const [re, k] of DEPTS) if (re.test(t)) return k; return t; };

const M = (id, rep, label, kind, unit = '', sum = ['count', 'money', 'min'].includes(kind)) => ({ id, rep, label, kind, unit, sum });
/** the measures, in the order they are shown */
export const MEASURES = Object.fromEntries([
  M('kpi.plan', 'kpi', 'Plan (Summary)', 'count', 'pcs'),
  M('kpi.qty', 'kpi', 'Actual (Summary)', 'count', 'pcs'),
  M('kpi.uphT', 'kpi', 'UPH target', 'dec'),
  M('kpi.uphA', 'kpi', 'UPH actual', 'dec'),
  M('kpi.upphT', 'kpi', 'UPPH target', 'dec'),
  M('kpi.upphA', 'kpi', 'UPPH actual', 'dec'),
  M('kpi.rty', 'kpi', 'RTY % (Summary)', 'pct', '%'),
  M('kpi.osd', 'kpi', 'OS&D (₹)', 'money', '₹'),
  M('kpi.otPlan', 'kpi', 'OT planned (man-hours)', 'dec', '', true),
  M('kpi.otUnplan', 'kpi', 'OT unplanned (man-hours)', 'dec', '', true),
  M('kpi.wo7', 'kpi', '>7 days WO', 'dec', '', true),
  M('kpi.trc3', 'kpi', 'TRC lying >3 days', 'dec', '', true),
  M('kpi.wip7', 'kpi', 'WIP lying >7 days', 'dec', '', true),
  M('fty.qty', 'kpi', 'Line production (FTY & RTY)', 'count', 'pcs'),
  M('fty.defects', 'kpi', 'Defects (FTY & RTY)', 'count', 'pcs'),
  M('fty.dismantle', 'kpi', 'Dismantled', 'count', 'pcs'),
  ...KPI_STAGES.map((s, i) => M(`fty.s${i}`, 'kpi', `Defects at ${s}`, 'count', 'pcs')),
  ...KPI_STAGES.map((s, i) => M(`fty.f${i}`, 'kpi', `FPY ${s}`, 'ratio')),
  M('fty.rty', 'kpi', 'RTY (FTY & RTY)', 'ratio'),
  M('mdl.plan', 'kpi', 'Model plan (day sheet)', 'count', 'pcs'),
  M('mdl.qty', 'kpi', 'Model actual (day sheet)', 'count', 'pcs'),
  M('mdl.uphT', 'kpi', 'Model UPH target', 'dec'),
  M('mdl.uphA', 'kpi', 'Model UPH actual', 'dec'),
  M('hpr.tgt', 'hpr', 'Target of the day', 'count', 'pcs'),
  M('hpr.prod', 'hpr', 'Production of the day', 'count', 'pcs'),
  M('hpr.gap', 'hpr', 'Gap of the day', 'count', 'pcs'),
  M('hpr.itMin', 'hpr', 'I/T of the day (min)', 'min', 'min'),
  M('hpr.loss', 'hpr', 'Loss ₹ of the day', 'money', '₹'),
  M('hpr.mp', 'hpr', 'M/P', 'count', '', false),
  M('hpr.ach', 'hpr', '% Ach', 'ratio'),
  M('hpr.uphT', 'hpr', 'TGT UPH', 'dec'),
  M('hpr.uphA', 'hpr', 'Ach UPH', 'dec'),
  M('hpr.uph1T', 'hpr', 'TGT UPH (1st hr)', 'count', '', false),
  M('hpr.uph1A', 'hpr', 'Ach UPH (1st hr)', 'count', '', false),
  M('hpr.upphT', 'hpr', 'TGT UPPH', 'dec'),
  M('hpr.upphA', 'hpr', 'Ach UPPH', 'dec'),
  M('hr.tgt', 'hpr', 'Hour target', 'count', 'pcs'),
  M('hr.ttl', 'hpr', 'Hour production (TTL)', 'count', 'pcs'),
  M('hr.gap', 'hpr', 'Hour gap', 'count', 'pcs'),
  M('hr.it', 'hpr', 'Hour I/T (min)', 'min', 'min'),
  M('hr.loss', 'hpr', 'Hour loss ₹', 'money', '₹'),
  M('hm.qty', 'hpr', 'Model pieces in the hour', 'count', 'pcs'),
  M('hr.dept', 'hpr', 'Loss department', 'text'),
  M('hr.reason', 'hpr', 'Loss reason (wording)', 'text'),
  M('rw.line', 'rwk', 'Rework pieces of the day', 'count', 'pcs'),
  M('rw.inr', 'rwk', 'Rework ₹ of the day', 'money', '₹'),
  M('rw.stage', 'rwk', 'Pieces at the stage', 'count', 'pcs'),
  M('rw.def', 'rwk', 'Pieces of the defect', 'count', 'pcs'),
  M('rw.model', 'rwk', 'Pieces of the model', 'count', 'pcs'),
  M('rw.hour', 'rwk', 'Pieces in the hour', 'count', 'pcs'),
].map((m, i) => [m.id, { ...m, order: i }]));

export const REPORT_NAMES = { kpi: 'SAWM KPI report', hpr: 'HPR — hourly production report', rwk: 'Hourly rework data (IPQC)' };

// the table reports of the Reports page: the columns that make a row (keys) — every other column is compared
const TABLE_KEYS = { oleDay: ['date', 'line'], oleHour: ['date', 'line', 'hour'], modelDay: ['date', 'line', 'model'], losses: ['date', 'line', 'kind', 'reason'], targets: ['line', 'model'], master: ['company', 'model'] };
export const TABLE_TYPES = REPORTS.filter((r) => TABLE_KEYS[r.id]).map((r) => ({ id: r.id, name: r.name, src: r.src, keys: TABLE_KEYS[r.id], cols: r.cols, dated: TABLE_KEYS[r.id].includes('date'), lined: TABLE_KEYS[r.id].includes('line') }));
const colKind = (c) => (c[3] === 'int' ? 'count' : c[3] === 'dec1' ? (/%/.test(c[1]) ? 'pct' : 'dec') : 'text');
{
  let o = Object.keys(MEASURES).length;
  for (const t of TABLE_TYPES) {
    REPORT_NAMES[t.id] = t.name;
    for (const c of t.cols) if (!t.keys.includes(c[0])) MEASURES[`${t.id}.${c[0]}`] = { ...M(`${t.id}.${c[0]}`, t.id, c[1], colKind(c)), order: o++ };
  }
  MEASURES.cell = { ...M('cell', 'cell', 'Cell', 'any', '', false), order: o++ };
  REPORT_NAMES.cell = 'Any Excel — cell by cell';
}
/** every type that can be compared, in the order of the type list */
export const COMPARE_TYPES = [['kpi', REPORT_NAMES.kpi], ['hpr', REPORT_NAMES.hpr], ['rwk', REPORT_NAMES.rwk], ...TABLE_TYPES.map((t) => [t.id, t.name]), ['cell', REPORT_NAMES.cell]];
/** the type has dates / lines (Targets and Model master do not; a cell-by-cell compare has neither) */
export const typeHas = (type) => { const t = TABLE_TYPES.find((x) => x.id === type); return t ? { date: t.dated, line: t.lined } : type === 'cell' ? { date: false, line: false } : { date: true, line: true }; };

// ── reading ──────────────────────────────────────────────────────────────────
const has = (r, w) => r.some((c) => low(c).startsWith(w));
/** two header rows → [{ i, top, sub }] (a merged top header carries over the columns under it) */
function headCols(top = [], sub = []) {
  const n = Math.max(top.length, sub.length); const out = []; let carry = '';
  for (let i = 0; i < n; i++) {
    const t = low(top[i]); const s = low(sub[i]);
    if (t) carry = t;
    out.push({ i, top: t || (s ? carry : ''), sub: s, t: tight(top[i]) });
  }
  return out;
}
const colOf = (C, top, sub = '') => C.find((x) => x.top.startsWith(top) && x.sub.startsWith(sub))?.i ?? -1;
/** the column letter of index i (0 → A) */
export const colLetter = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
/** a header (one or two rows) as labels by column: 'Production / Plan' (the merged top header carried over) */
function headLabels(top = [], sub = []) {
  const n = Math.max(top.length, sub.length); const out = []; let carry = '';
  for (let i = 0; i < n; i++) {
    const t = String(top[i] ?? '').trim(); const u = String(sub[i] ?? '').trim();
    if (t) carry = t;
    out.push(u ? `${t || carry} / ${u}` : t);
  }
  return out;
}
/** the first header row of each table of a file (for the format check and the preview) */
const keepHead = (R, table, sheet, top, sub = null) => { if (!R.heads.some((h) => h.table === table)) R.heads.push({ table, sheet: sheet.name, row: top.n, rows: sub ? [top.n, sub.n] : [top.n], labels: headLabels(top, sub || []) }); };
const exact = (C, t) => C.find((x) => x.t === t)?.i ?? -1;
const starts = (C, t) => C.find((x) => x.t.startsWith(t))?.i ?? -1;

/**
 * a day sheet named by its day ('15', or '15-10' when the file has more months) whose date cell says another day:
 * the sheet's day is taken (a copied sheet whose date was not changed) — listed in the checks
 */
function sheetDate(name, date) {
  if (!date) return null;
  const n = String(name || '').trim();
  let want = null;
  let m = /^(\d{1,2})$/.exec(n);
  if (m) want = `${date.slice(0, 8)}${pad(Number(m[1]))}`;
  m = /^(\d{1,2})-(\d{1,2})$/.exec(n);
  if (m) want = `${date.slice(0, 4)}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  if (!want || want === date) return null;
  const d = new Date(`${want}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === want ? want : null;
}

function store() {
  const map = new Map();
  return {
    map,
    add(measure, date, line, where, v, show = where) {
      if (v == null || v === '' || date == null || line == null) return;
      const def = MEASURES[measure];
      const key = `${measure}|${date}|${line}|${where}`;
      const f = map.get(key);
      if (!f) { map.set(key, { key, measure, date, line, where, show: show || '', v }); return; }
      if (def.kind === 'text') { if (!String(f.v).split(' · ').includes(String(v))) f.v = `${f.v} · ${v}`; return; }
      if (def.sum) f.v += v; else f.dup = (f.dup || 0) + 1;   // a rate written twice: the first one is kept
    },
  };
}

/** which plant report the sheets are (null = none of the three) */
export function detectType(sheets) {
  const any = (pred) => sheets.some((s) => s.rows.slice(0, 80).some(pred));
  if (any((r) => has(r, 'defect') && has(r, 'stage') && has(r, 'model'))) return 'rwk';
  if (any((r) => has(r, 'tgt uph') || (has(r, 'model') && has(r, 'i/t')))) return 'hpr';
  if (any((r) => has(r, 'line no')) || sheets.some((s) => low(s.name) === 'fty & rty')) return 'kpi';
  return null;
}

function parseKpi(sheets, F, R) {
  for (const s of sheets) {
    const rows = s.rows;
    // Summary: Date | Line No. | SAP | Production Plan / Actual | UPH | UPPH | RTY | OS&D | OS&D MTD | OT | WO | TRC | WIP
    const hs = rows.findIndex((r) => has(r, 'date') && has(r, 'line no') && !has(r, 'model'));
    if (hs >= 0 && rows.slice(hs, hs + 2).some((r) => has(r, 'plan'))) {
      keepHead(R, 'KPI Summary', s, rows[hs], rows[hs + 1]);
      const C = headCols(rows[hs], rows[hs + 1]);
      const cDate = colOf(C, 'date'), cLine = colOf(C, 'line no');
      const map = [['kpi.plan', colOf(C, 'production', 'plan')], ['kpi.qty', colOf(C, 'production', 'actual')], ['kpi.uphT', colOf(C, 'uph', 'target')], ['kpi.uphA', colOf(C, 'uph', 'actual')],
        ['kpi.upphT', colOf(C, 'upph', 'target')], ['kpi.upphA', colOf(C, 'upph', 'actual')], ['kpi.rty', colOf(C, 'rty', 'actual')], ['kpi.osd', colOf(C, 'os&d (rep', 'value')],
        ['kpi.otPlan', colOf(C, 'actual ot', 'planned')], ['kpi.otUnplan', colOf(C, 'actual ot', 'unplanned')], ['kpi.wo7', colOf(C, '>7 days wo')], ['kpi.trc3', colOf(C, 'trc lying')], ['kpi.wip7', colOf(C, 'wip lying')]];
      let date = null;
      for (const r of rows.slice(hs + 2)) {
        const d = cellDate(r[cDate]); if (d) date = d;
        const line = lineOf(r[cLine]);
        if (!date || !line) continue;
        const rec = { sheet: s.name, row: r.n, date, line };
        for (const [m, i] of map) if (i >= 0) { rec[m] = num(r[i]); F.add(m, date, line, '', rec[m]); }
        R.sum.push(rec);
      }
      continue;
    }
    // FTY & RTY: Date | Line | Line Wise Production | Total | Defect | Dismental | 6 stages | 6 stage FPY | Target | RTY
    const hf = rows.findIndex((r) => has(r, 'line wise'));
    if (hf >= 0) {
      keepHead(R, 'KPI FTY & RTY', s, rows[hf], rows[hf + 1]);
      const C = headCols(rows[hf], rows[hf + 1]);
      const cDate = colOf(C, 'date'), cLine = C.find((x) => x.top === 'line')?.i ?? -1, cProd = colOf(C, 'line wise'), cDef = colOf(C, 'defect'), cDis = colOf(C, 'dism'), cRty = colOf(C, 'rty');
      const stg = C.filter((x) => x.top.startsWith('stages') && x.sub).map((x, k) => ({ i: x.i, s: stageOf(x.sub) ?? k }));
      const fpy = C.filter((x) => x.top.startsWith('stage wise') && x.sub).map((x, k) => ({ i: x.i, s: stageOf(x.sub) ?? k }));
      let date = null;
      for (const r of rows.slice(hf + 2)) {
        const d = cellDate(r[cDate]); if (d) date = d;
        const line = lineOf(r[cLine]);
        if (!date || !line) continue;
        const rec = { sheet: s.name, row: r.n, date, line, qty: num(r[cProd]), defects: num(r[cDef]), dismantle: num(r[cDis]), stages: [0, 0, 0, 0, 0, 0], fpy: [null, null, null, null, null, null], rty: num(r[cRty]) };
        F.add('fty.qty', date, line, '', rec.qty); F.add('fty.defects', date, line, '', rec.defects ?? (rec.qty != null ? 0 : null)); F.add('fty.dismantle', date, line, '', rec.dismantle);
        for (const { i, s: k } of stg) { rec.stages[k] = num(r[i]) || 0; F.add(`fty.s${k}`, date, line, '', rec.stages[k]); }
        for (const { i, s: k } of fpy) { rec.fpy[k] = num(r[i]); F.add(`fty.f${k}`, date, line, '', rec.fpy[k]); }
        F.add('fty.rty', date, line, '', rec.rty);
        R.fty.push(rec);
      }
      continue;
    }
    // a day sheet: "Date" + date at the top, then Line No. | SAP | Model | Production Plan / Actual | UPH Target / Actual | UPPH …
    const dr = rows.slice(0, 8).find((r) => r.some((c, i) => low(c) === 'date' && cellDate(r[i + 1])));
    const hd = rows.findIndex((r) => has(r, 'line no') && has(r, 'production'));
    if (!dr || hd < 0) continue;
    const said = cellDate(dr[dr.findIndex((c) => low(c) === 'date') + 1]);
    const fixed = sheetDate(s.name, said);
    if (fixed) R.dateFix.push({ sheet: s.name, row: dr.n, date: said, fixed, line: '' });
    const date = fixed || said;
    keepHead(R, 'KPI day sheet', s, rows[hd], rows[hd + 1]);
    const C = headCols(rows[hd], rows[hd + 1]);
    const cLine = colOf(C, 'line no'), cPlan = colOf(C, 'production', 'plan'), cAct = colOf(C, 'production', 'actual');
    // the model column: its header, else the empty-headed column between SAP location and Production (some plant sheets leave it blank)
    let cModel = colOf(C, 'model');
    if (cModel < 0) { const sap = colOf(C, 'sap'); cModel = sap >= 0 && sap + 1 < cPlan ? sap + 1 : cPlan - 1; }
    const cUT = colOf(C, 'uph', 'target'), cUA = colOf(C, 'uph', 'actual'), cPT = colOf(C, 'upph', 'program'), cPA = colOf(C, 'upph', 'actual');
    for (const r of rows.slice(hd + 2)) {
      if (has(r, 'line no')) break;   // the SMT block of the plant file
      const line = lineOf(r[cLine]); const model = String(r[cModel] ?? '').trim();
      if (!line || !model) continue;
      const k = normName(model);
      const rec = { sheet: s.name, row: r.n, date, line, model, plan: num(r[cPlan]), qty: num(r[cAct]), uphT: num(r[cUT]), uphA: num(r[cUA]), upphT: num(r[cPT]), upphA: num(r[cPA]) };
      F.add('mdl.plan', date, line, k, rec.plan, model); F.add('mdl.qty', date, line, k, rec.qty, model);
      F.add('mdl.uphT', date, line, k, rec.uphT, model); F.add('mdl.uphA', date, line, k, rec.uphA, model);
      R.models.push(rec);
    }
  }
}

function parseHpr(sheets, F, R) {
  for (const s of sheets) {
    const rows = s.rows;
    let sheetDay = null;
    // the date of the sheet: the first date written in it; a copied sheet with another day's date takes its own day
    let said = null; let fixed = null;
    for (const r of rows) { for (const v of r) { const d = /^\d{5}(\.\d+)?$/.test(String(v)) || /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? cellDate(v) : null; if (d) { said = d; break; } } if (said) { fixed = sheetDate(s.name, said); if (fixed) R.dateFix.push({ sheet: s.name, row: r.n, date: said, fixed, line: '' }); break; } }
    const dayOf = (v) => { const d = cellDate(v); return d && fixed && d === said ? fixed : d; };
    // line summary: Line | Date | TGT UPH (1st HR) | ACH UPH (1st HR) | TGT UPH | Ach UPH | Tgt | Prod | Gap | I/T (Hrs) | % Ach | Loss | M/P | I/T (Minutes) | TGT UPPH | Ach UPPH
    const hs = rows.findIndex((r) => has(r, 'tgt uph'));
    if (hs >= 0) {
      keepHead(R, 'HPR line summary', s, rows[hs]);
      const C = headCols(rows[hs]);
      const c = { line: exact(C, 'line'), date: exact(C, 'date'), uph1T: starts(C, 'tgtuph(1'), uph1A: starts(C, 'achuph(1'), uphT: exact(C, 'tgtuph'), uphA: exact(C, 'achuph'),
        tgt: exact(C, 'tgt'), prod: exact(C, 'prod'), gap: exact(C, 'gap'), itHrs: starts(C, 'i/t(h'), ach: starts(C, '%ach'), loss: starts(C, 'loss'), mp: exact(C, 'm/p'),
        itMin: starts(C, 'i/t(m'), upphT: exact(C, 'tgtupph'), upphA: exact(C, 'achupph') };
      for (const r of rows.slice(hs + 1)) {
        const line = lineOf(r[c.line]);
        if (!line) { if (low(r[c.line]) === 'total' || has(r, 'ttl mp')) break; continue; }
        const date = dayOf(r[c.date]) || sheetDay; if (!date) continue;
        sheetDay = date;
        const rec = { sheet: s.name, row: r.n, date, line };
        for (const [k, i] of Object.entries(c)) if (!['line', 'date'].includes(k) && i >= 0) { rec[k] = num(r[i]); if (MEASURES[`hpr.${k}`]) F.add(`hpr.${k}`, date, line, '', rec[k]); }
        R.sum.push(rec);
      }
    }
    // hours of every line: Line | Date | slot | Model | Tgt | Ach | TTL | Gap | I/T (Mins) | %Eff | Parts | Dept | Owner | Reason | … | Total Loss (₹) | TGT UPPH | Ach UPPH
    let C = null, c = null, blockLine = null, cur = null;
    for (const r of rows) {
      if (has(r, 'model') && (has(r, 'ttl') || has(r, 'i/t'))) {
        keepHead(R, 'HPR hours of a line', s, r);
        C = headCols(r);
        const cModel = exact(C, 'model');
        c = { line: exact(C, 'line'), date: exact(C, 'date'), slot: cModel - 1, model: cModel, tgt: exact(C, 'tgt'), ach: exact(C, 'ach'), ttl: exact(C, 'ttl'), gap: exact(C, 'gap'),
          it: starts(C, 'i/t'), dept: starts(C, 'losscont') >= 0 ? starts(C, 'losscont') : starts(C, 'dept'), reason: starts(C, 'lineloss') >= 0 ? starts(C, 'lineloss') : starts(C, 'reason'),
          loss: starts(C, 'totalloss') };
        blockLine = lineOf(r[c.slot]); cur = null;
        continue;
      }
      if (!c) continue;
      if (has(r, 'ttl mp')) { c = null; cur = null; continue; }
      const line = lineOf(r[c.line]) || blockLine;
      const date = dayOf(r[c.date]) || sheetDay;
      const model = String(r[c.model] ?? '').trim(); const slot = String(r[c.slot] ?? '').trim();
      if (!line || !date) continue;
      if (low(model) === 'ttl') { R.ttl.push({ sheet: s.name, row: r.n, date, line, tgt: num(r[c.tgt]), ttl: num(r[c.ttl]), gap: num(r[c.gap]), it: num(r[c.it]), loss: num(r[c.loss]) }); cur = null; continue; }
      const sl = slot ? slotOf(slot) : null;
      if (sl) {
        const h = { sheet: s.name, row: r.n, date, line, h: sl.h, min: sl.min, slot, tgt: num(r[c.tgt]), ttl: num(r[c.ttl]), gap: num(r[c.gap]), it: num(r[c.it]), loss: num(r[c.loss]),
          dept: String(r[c.dept] ?? '').trim(), reason: String(r[c.reason] ?? '').trim(), models: [] };
        if (h.tgt == null && !h.ttl && !model) { cur = null; continue; }   // an empty slot of the template
        cur = h; R.hours.push(h);
        if (model) h.models.push({ model, ach: num(r[c.ach]), row: r.n });
      } else if (model && cur && cur.line === line) {
        cur.models.push({ model, ach: num(r[c.ach]), row: r.n });
        const t = num(r[c.tgt]); if (t != null) cur.tgt = (cur.tgt || 0) + t;   // Line Pulse writes each model's share of the hour target on its own row
      }
    }
  }
  for (const h of R.hours) {
    const w = pad(h.h);
    F.add('hr.tgt', h.date, h.line, w, h.tgt, h.slot); F.add('hr.ttl', h.date, h.line, w, h.ttl, h.slot); F.add('hr.gap', h.date, h.line, w, h.gap, h.slot);
    F.add('hr.it', h.date, h.line, w, h.it, h.slot); F.add('hr.loss', h.date, h.line, w, h.loss, h.slot);
    if (h.dept) F.add('hr.dept', h.date, h.line, w, h.dept, h.slot);
    if (h.reason) F.add('hr.reason', h.date, h.line, w, h.reason, h.slot);
    for (const m of h.models) F.add('hm.qty', h.date, h.line, `${w}|${normName(m.model)}`, m.ach, `${h.slot} · ${m.model}`);
  }
}

function parseRwk(sheets, F, R) {
  for (const s of sheets) {
    const rows = s.rows;
    const hh = rows.findIndex((r) => has(r, 'defect') && has(r, 'stage') && has(r, 'model'));
    if (hh < 0) continue;
    keepHead(R, 'Hourly rework sheet', s, rows[hh]);
    const C = headCols(rows[hh]);
    const c = { date: exact(C, 'date'), stage: exact(C, 'stage'), line: exact(C, 'line'), model: exact(C, 'model'), defect: starts(C, 'defect'), total: exact(C, 'total'), inr: starts(C, 'inr') >= 0 ? starts(C, 'inr') : starts(C, '₹') };
    const hours = C.filter((x) => /^\d{1,2}-\d{1,2}$/.test(x.t)).map((x) => ({ i: x.i, h: Number(x.t.split('-')[0]) }));
    for (const r of rows.slice(hh + 1)) {
      const date = cellDate(r[c.date]); const line = lineOf(r[c.line]);
      if (!date || !line) continue;
      const total = num(r[c.total]);
      const hv = hours.map((x) => ({ h: x.h, v: num(r[x.i]) })).filter((x) => x.v);
      const stRaw = String(r[c.stage] ?? '').trim(); const st = stageOf(stRaw);
      const stage = st != null ? KPI_STAGES[st] : (stRaw || 'No stage');
      const defect = String(r[c.defect] ?? '').trim() || 'Not given'; const model = String(r[c.model] ?? '').trim() || 'Not given';
      const n = total ?? hv.reduce((a, x) => a + x.v, 0);
      const rec = { sheet: s.name, row: r.n, date, line, stage, defect, model, total, hours: hv, inr: num(r[c.inr]) };
      R.rows.push(rec);
      F.add('rw.line', date, line, '', n); F.add('rw.inr', date, line, '', rec.inr);
      F.add('rw.stage', date, line, normName(stage), n, stage);
      F.add('rw.def', date, line, `${normName(stage)}|${normName(defect)}`, n, `${stage} · ${defect}`);
      F.add('rw.model', date, line, normName(model), n, model);
      for (const x of hv) F.add('rw.hour', date, line, pad(x.h), x.v, `${pad(x.h)}-${pad((x.h + 1) % 24)}`);
    }
  }
}

// ── table reports (Reports page) and cell by cell ────────────────────────────
const labelKey = (x) => low(x).replace(/[^a-z0-9%₹]+/g, '');
/** the row (of the first `upto` rows of every sheet) that carries most of these column labels */
function findHeader(sheets, cols, upto = 40) {
  let best = null;
  for (const s of sheets) for (let i = 0; i < Math.min(s.rows.length, upto); i++) {
    const cells = s.rows[i].map(labelKey); const idx = {}; let hits = 0;
    for (const c of cols) { const j = cells.indexOf(labelKey(c[1])); if (j >= 0) { idx[c[0]] = j; hits += 1; } }
    if (hits && (!best || hits > best.hits)) best = { s, i, idx, hits };
  }
  return best;
}
function parseTable(sheets, t, F, R) {
  const h = findHeader(sheets, t.cols);
  if (!h || h.hits < Math.max(2, Math.ceil(t.cols.length * 0.5)) || t.keys.some((k) => h.idx[k] == null)) {
    throw new Error(`No header row of "${t.name}" was found — its columns: ${t.cols.map((c) => c[1]).join(', ')}.`);
  }
  keepHead(R, t.name, h.s, h.s.rows[h.i]);
  R.cols = t.cols.filter((c) => !t.keys.includes(c[0]) && h.idx[c[0]] != null).map((c) => `${t.id}.${c[0]}`);   // the measures this file has a column of
  const other = t.keys.filter((k) => k !== 'date' && k !== 'line');
  for (const r of h.s.rows.slice(h.i + 1)) {
    const get = (k) => (h.idx[k] != null ? r[h.idx[k]] : '');
    const date = t.dated ? cellDate(get('date')) : '';
    const line = t.lined ? lineOf(get('line')) : '';
    if (date == null || line == null) continue;
    const parts = other.map((k) => {
      if (k === 'hour') { const sl = slotOf(String(get(k) ?? '').replace(/\s*\(.*\)\s*$/, '')); return sl ? pad(sl.h) : null; }
      return normName(get(k)) || null;
    });
    if (parts.some((x) => x == null)) continue;
    const where = parts.join('|');
    const show = other.map((k) => String(get(k) ?? '').trim()).join(' · ');
    R.rows.push({ sheet: h.s.name, row: r.n, date, line, where });
    for (const c of t.cols) {
      if (t.keys.includes(c[0]) || h.idx[c[0]] == null) continue;
      const id = `${t.id}.${c[0]}`; const raw = get(c[0]);
      F.add(id, date, line, where, MEASURES[id].kind === 'text' ? (String(raw ?? '').trim() || null) : num(raw), show);
    }
  }
}
export const CELL_ROWS = 5000;   // a cell-by-cell compare reads the first 5000 rows of a sheet
function parseCells(sheets, F, R) {
  const one = sheets.length === 1;
  // the header of every sheet (for the format check and the preview): of its first 15 rows, the one with the most text cells
  for (const s of sheets.slice(0, 20)) {
    let best = null;
    for (const r of s.rows.slice(0, 15)) {
      const n = r.filter((v) => v !== '' && v != null && num(v) == null).length;
      if (n >= 2 && (!best || n > best.n)) best = { r, n };
    }
    if (best) keepHead(R, `Sheet "${s.name}"`, s, best.r);
  }
  for (const s of sheets) {
    for (const r of s.rows.slice(0, CELL_ROWS)) r.forEach((v, i) => {
      if (v === '' || v == null) return;
      const ref = `${colLetter(i)}${r.n}`;
      F.add('cell', '', '', `${one ? '' : `${s.name}!`}${ref}`, String(v), `${one ? '' : `${s.name} `}${ref}`);
    });
    if (s.rows.length > CELL_ROWS) R.warn.push(`Sheet ${s.name}: only the first ${CELL_ROWS} rows are compared.`);
  }
}

/** a table report: the one whose column labels a header row (of the first 12 rows) carries most */
function detectTable(sheets) {
  let best = null;
  for (const t of TABLE_TYPES) {
    const h = findHeader(sheets, t.cols, 12);
    const share = h ? h.hits / t.cols.length : 0;
    if (h && h.hits >= 3 && share >= 0.6 && t.keys.every((k) => h.idx[k] != null) && (!best || share > best.share)) best = { id: t.id, share };
  }
  return best?.id || null;
}

/**
 * sheets (readWorkbook) → { type, facts: Map, recs, dates: [first, last], days: [dates], lines: [lines], n (facts), sheets, sheetNames }
 * type: 'kpi' | 'hpr' | 'rwk' | a table report id | 'cell' (forced with `as`, else found from the headers)
 */
export function parseReport(sheets, { as = null } = {}) {
  const type = as || detectType(sheets || []) || detectTable(sheets || []);
  if (!type) throw new Error('This file is not a report Line Pulse knows (SAWM KPI, HPR, hourly rework data or a table of the Reports page): no known header row was found. Choose its type — or "Any Excel — cell by cell" for two files of the same layout.');
  const F = store();
  const R = { sum: [], fty: [], models: [], hours: [], ttl: [], rows: [], dateFix: [], heads: [], warn: [] };
  const table = TABLE_TYPES.find((t) => t.id === type);
  if (type === 'kpi') parseKpi(sheets, F, R);
  else if (type === 'hpr') parseHpr(sheets, F, R);
  else if (type === 'rwk') parseRwk(sheets, F, R);
  else if (type === 'cell') parseCells(sheets, F, R);
  else if (table) parseTable(sheets, table, F, R);
  else throw new Error(`Unknown report type "${type}".`);
  const days = [...new Set([...F.map.values()].map((f) => f.date).filter(Boolean))].sort();
  const lines = [...new Set([...F.map.values()].map((f) => f.line).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  return { type, facts: F.map, recs: R, days, dates: days.length ? [days[0], days[days.length - 1]] : null, lines, n: F.map.size, sheets, sheetNames: sheets.map((x) => x.name) };
}

/**
 * The layout of the two files side by side: every header row (KPI Summary, HPR hours, a table report …) column by
 * column — same / different text / moved to another column / only in one file — and the sheets of each file.
 */
export function formatCheck(A, B) {
  const norm = (x) => low(x).replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  const names = [...new Set([...A.recs.heads.map((h) => h.table), ...B.recs.heads.map((h) => h.table)])];
  const tables = names.map((t) => {
    const a = A.recs.heads.find((h) => h.table === t); const b = B.recs.heads.find((h) => h.table === t);
    if (!a || !b) return { table: t, only: a ? 'theirs' : 'ours', a, b, cols: [], ok: false };
    const cols = [];
    for (let i = 0; i < Math.max(a.labels.length, b.labels.length); i++) {
      const x = String(a.labels[i] || '').trim(); const y = String(b.labels[i] || '').trim();
      if (!x && !y) continue;
      let status = norm(x) === norm(y) ? 'same' : !x ? 'ours' : !y ? 'theirs' : 'diff';
      let to = null;
      if (status !== 'same' && x) { const j = b.labels.findIndex((l) => norm(l) === norm(x)); if (j >= 0) { status = 'moved'; to = colLetter(j); } }
      cols.push({ col: colLetter(i), theirs: x, ours: y, status, to });
    }
    return { table: t, a, b, cols, ok: cols.every((c) => c.status === 'same') };
  });
  const day = (n) => /^\d{1,2}(-\d{1,2})?$/.test(String(n).trim());
  const sa = A.sheetNames || []; const sb = B.sheetNames || [];
  const named = (l) => l.filter((x) => !day(x));
  return {
    tables,
    sheets: { theirs: sa, ours: sb, onlyTheirs: named(sa).filter((x) => !sb.includes(x)), onlyOurs: named(sb).filter((x) => !sa.includes(x)), daysTheirs: sa.filter(day).length, daysOurs: sb.filter(day).length },
    ok: tables.every((t) => t.ok),
  };
}

// ── comparing ────────────────────────────────────────────────────────────────
const EPS = { count: () => 0.5, dec: (a, b) => Math.max(0.01, 0.001 * Math.max(Math.abs(a), Math.abs(b))), pct: () => 0.05, ratio: () => 0.0005, money: () => 1, min: () => 0.05 };
const CLOSE = { count: (a, b) => Math.max(1, 0.02 * Math.max(Math.abs(a), Math.abs(b))), dec: (a, b) => 0.02 * Math.max(Math.abs(a), Math.abs(b)), pct: () => 0.2, ratio: () => 0.002,
  money: (a, b) => Math.max(10, 0.02 * Math.max(Math.abs(a), Math.abs(b))), min: (a, b) => Math.max(1, 0.02 * Math.max(Math.abs(a), Math.abs(b))) };
const textKey = (measure, v) => {
  if (v == null || v === '') return '';
  if (measure === 'hr.dept') return [...new Set(String(v).split(/\s*[·,/+&]\s*|\s+and\s+/i).map(deptKey).filter(Boolean))].sort().join(' + ');
  return [...new Set(String(v).split(' · ').map((x) => low(x).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean))].sort().join(' + ');
};
export const STATUS = {
  diff: { label: 'Different', order: 0 },
  theirs: { label: 'Only in their report', order: 1 },
  ours: { label: 'Only in Line Pulse', order: 2 },
  close: { label: 'Small difference', order: 3 },
  same: { label: 'Same', order: 4 },
};

/** one fact of each side → { …, theirs, ours, diff, pct, status } */
export function judge(measure, a, b) {
  const def = MEASURES[measure];
  const f = a || b;
  const base = { key: f.key, measure, date: f.date, line: f.line, where: f.where, show: a?.show || b?.show || '', theirs: a?.v ?? null, ours: b?.v ?? null, diff: null, pct: null };
  if (def.kind === 'text') {
    const x = textKey(measure, a?.v), y = textKey(measure, b?.v);
    return { ...base, status: !x && !y ? 'same' : !y ? 'theirs' : !x ? 'ours' : x === y ? 'same' : 'diff' };
  }
  if (def.kind === 'any') {
    const p = num(a?.v), q = num(b?.v);
    if (p != null && q != null) {   // cell by cell: equal up to the float noise of Excel; a small gap (≤ 2 %) is a small difference
      const d = q - p; const big = Math.max(Math.abs(p), Math.abs(q));
      return { ...base, theirs: p, ours: q, diff: d, pct: p !== 0 ? d / Math.abs(p) : null, status: Math.abs(d) <= 1e-9 * Math.max(1, big) ? 'same' : Math.abs(d) <= Math.max(0.005, 0.02 * big) ? 'close' : 'diff' };
    }
    const x = low(a?.v ?? ''), y = low(b?.v ?? '');
    return { ...base, status: x === y ? 'same' : !y ? 'theirs' : !x ? 'ours' : 'diff' };
  }
  const x = a?.v ?? null, y = b?.v ?? null;
  if (x == null || y == null) {
    const v = x ?? y;
    return { ...base, status: Math.abs(v) <= EPS[def.kind](v, v) ? 'same' : x == null ? 'ours' : 'theirs' };
  }
  const d = y - x;
  const status = Math.abs(d) <= EPS[def.kind](x, y) ? 'same' : Math.abs(d) <= CLOSE[def.kind](x, y) ? 'close' : 'diff';
  return { ...base, diff: d, pct: x !== 0 ? d / Math.abs(x) : null, status };
}

/**
 * a table report: the measures of a column only one of the two files has (a column switched off in Reports) are not
 * compared number by number — the format check names them. → { measures: Set | null, onlyTheirs: [ids], onlyOurs: [ids] }
 */
export function sharedColumns(A, B) {
  if (!A?.recs?.cols || !B?.recs?.cols) return { measures: null, onlyTheirs: [], onlyOurs: [] };
  return { measures: new Set(A.recs.cols.filter((m) => B.recs.cols.includes(m))), onlyTheirs: A.recs.cols.filter((m) => !B.recs.cols.includes(m)), onlyOurs: B.recs.cols.filter((m) => !A.recs.cols.includes(m)) };
}

/** their facts × ours → rows (one per measure · date · line · where), worst first within a day and line */
/**
 * 23-11-2026: the plant writes its own model names ("GOD RIO 10.0 TB3 SLGR", "WT10C4260GG/TL") where Line Pulse writes the
 * scanner's ("UNO 1005.0SB3SLGR", "WT10C4260GG"). On one date · line, a model found on one side only is paired with the
 * most alike model found on the other side only (same pieces, or a name that is alike enough), and compared as one.
 */
const BRAND_WORDS = /^(GOD|GODREJ|CELLECOR|MIDEA|WM|BELTEK|RENTMOJO|LIFEBIRD|ELITAS|AKSA|VOLTAS|SAMSUNG|WHIRLPOOL|HAIER|KENSTAR)\s+/;
export const modelCore = (s) => String(s ?? '').toUpperCase().replace(BRAND_WORDS, '').replace(/\/TL$/, '').replace(/[^A-Z0-9]/g, '');
const bigrams = (s) => { const o = new Map(); for (let i = 0; i < s.length - 1; i += 1) { const b = s.slice(i, i + 2); o.set(b, (o.get(b) || 0) + 1); } return o; };
export function alike(a, b) {
  const x = modelCore(a), y = modelCore(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const A = bigrams(x), B = bigrams(y); let both = 0;
  for (const [k, n] of A) both += Math.min(n, B.get(k) || 0);
  return (2 * both) / Math.max(1, x.length - 1 + y.length - 1);
}
export function pairModels(theirs, ours) {
  const MDL = ['mdl.plan', 'mdl.qty', 'mdl.uphT', 'mdl.uphA'];
  const side = (map) => { const g = new Map(); for (const f of map.values()) if (f.measure === 'mdl.qty') { const k = `${f.date}|${f.line}`; (g.get(k) || g.set(k, []).get(k)).push(f); } return g; };
  const T = side(theirs), O = side(ours);
  for (const [dl, tl] of T) {
    const ol = O.get(dl); if (!ol) continue;
    const onlyT = tl.filter((f) => !ours.has(f.key)), onlyO = ol.filter((f) => !theirs.has(f.key));
    const cand = [];
    for (const a of onlyT) for (const b of onlyO) {
      const sim = alike(a.show || a.where, b.show || b.where);
      const sameQty = a.v != null && a.v === b.v && a.v > 0;
      const score = sim + (sameQty ? 0.5 : 0);
      if (sim >= 0.55 || (sameQty && sim >= 0.25)) cand.push({ a, b, score });
    }
    cand.sort((p, q) => q.score - p.score);
    const usedA = new Set(), usedB = new Set();
    for (const { a, b } of cand) {
      if (usedA.has(a.where) || usedB.has(b.where)) continue;
      usedA.add(a.where); usedB.add(b.where);
      // our facts of that model take their key; the row shows both names
      for (const m of MDL) {
        const ok = `${m}|${dl}|${b.where}`, nk = `${m}|${dl}|${a.where}`;
        const f = ours.get(ok); if (!f || ours.has(nk)) continue;
        ours.delete(ok); ours.set(nk, { ...f, key: nk, where: a.where, show: `${a.show || a.where} ⇄ ${f.show || b.where}` });
        const t = theirs.get(nk); if (t) theirs.set(nk, { ...t, show: `${t.show || a.where} ⇄ ${f.show || b.where}` });
      }
    }
  }
}

export function compareFacts(theirs, ours, { from = '', to = '9999-12-31', lines = null, measures = null } = {}) {
  theirs = new Map(theirs); ours = new Map(ours);   // the files' own facts stay as read
  pairModels(theirs, ours);
  const inside = (f) => (!f.date || (f.date >= from && f.date <= to)) && (!lines || !f.line || lines.includes(f.line)) && (!measures || measures.has(f.measure));
  const keys = new Set([...theirs.keys(), ...ours.keys()]);
  const out = [];
  for (const k of keys) {
    const a = theirs.get(k), b = ours.get(k);
    const f = a || b;
    if (!inside(f)) continue;
    out.push(judge(f.measure, a, b));
  }
  return out.sort((p, q) => p.date.localeCompare(q.date) || Number(p.line || 0) - Number(q.line || 0) || MEASURES[p.measure].order - MEASURES[q.measure].order || p.where.localeCompare(q.where, undefined, { numeric: true }));
}

/** totals: tiles (numbers only; text apart), per measure and per day · line */
export function summarize(rows) {
  const tiles = { all: 0, same: 0, close: 0, diff: 0, theirs: 0, ours: 0, text: 0, textDiff: 0 };
  const byM = new Map(); const byDay = new Map();
  for (const r of rows) {
    const def = MEASURES[r.measure];
    if (def.kind === 'text') { tiles.text += 1; if (r.status !== 'same') tiles.textDiff += 1; } else { tiles.all += 1; tiles[r.status] += 1; }
    const m = byM.get(r.measure) || { measure: r.measure, label: def.label, rep: def.rep, kind: def.kind, unit: def.unit, sumOk: def.sum, n: 0, same: 0, close: 0, diff: 0, theirs: 0, ours: 0, sumT: 0, sumO: 0, worst: null };
    m.n += 1; m[r.status] += 1;
    if (def.sum) { m.sumT += r.theirs || 0; m.sumO += r.ours || 0; }
    const size = r.diff != null ? Math.abs(r.diff) : Math.abs(num(r.theirs ?? r.ours) ?? 0);
    if (r.status !== 'same' && def.kind !== 'text' && (!m.worst || size > m.worst.size)) m.worst = { ...r, size };
    byM.set(r.measure, m);
    const dk = `${r.date}|${r.line}`;
    const d = byDay.get(dk) || { date: r.date, line: r.line, n: 0, bad: 0, close: 0 };
    if (def.kind !== 'text') { d.n += 1; if (['diff', 'theirs', 'ours'].includes(r.status)) d.bad += 1; if (r.status === 'close') d.close += 1; }
    byDay.set(dk, d);
  }
  return { tiles, byMeasure: [...byM.values()].sort((a, b) => MEASURES[a.measure].order - MEASURES[b.measure].order), byDay: [...byDay.values()] };
}

// ── checks of a file's own numbers ───────────────────────────────────────────
const mode = (vals) => { const m = new Map(); for (const v of vals) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0] || null; };
const near = (a, b, e) => a != null && b != null && Math.abs(a - b) <= e;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const fmtD = (s) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;

/**
 * The file's own numbers worked out again from its own cells.
 * → [{ id, label, checked, bad: [{ sheet, row, date, line, where, value, expected, note }], uses: text | null }]
 * hpr = { rate, otX, otFrom } of Setup → HPR (the plant file: ₹65 per man-hour, overtime ×2 from 18:00).
 */
export function fileChecks(P, { rate = 65, otX = 2, otFrom = '18:00' } = {}) {
  const R = P.recs; const out = [];
  const check = (id, label) => { const c = { id, label, checked: 0, bad: [], uses: null }; out.push(c); return c; };
  const bad = (c, rec, where, value, expected, note = '') => c.bad.push({ sheet: rec.sheet, row: rec.row, date: rec.date, line: rec.line, where, value, expected, note });
  if (P.type !== 'rwk') {
    const cDt = check('dates', 'Date written in a day sheet = the day of the sheet');
    cDt.checked = new Set([...(R.hours || []).map((h) => h.sheet), ...(R.models || []).map((m) => m.sheet), ...(R.dateFix || []).map((x) => x.sheet)]).size;
    for (const x of R.dateFix || []) bad(cDt, { ...x, date: x.fixed }, `Sheet ${x.sheet}`, fmtD(x.date), fmtD(x.fixed), `the sheet says ${fmtD(x.date)} — read as ${fmtD(x.fixed)} (its own day; a copied sheet?)`);
  }
  if (P.type === 'hpr') {
    const otMin = (() => { const [h, m] = String(otFrom).split(':').map(Number); return h * 60 + (m || 0); })();
    const cSum = check('hr-models', 'TTL of the hour = sum of the models (Ach)');
    const cGap = check('hr-gap', 'Gap = TTL − Tgt');
    const cIt = check('hr-it', 'I/T (min) = minutes of the slot ÷ Tgt × Gap');
    const cRs = check('hr-loss', `Loss ₹ = ₹${rate} × I/T ÷ 60 × manpower (× ${otX} from ${otFrom})`);
    const people = [];
    for (const h of R.hours) {
      const where = h.slot;
      if (h.models.length > 1 && h.ttl != null) {
        cSum.checked += 1; const s = h.models.reduce((a, m) => a + (m.ach || 0), 0);
        if (!near(s, h.ttl, 0.5)) bad(cSum, h, where, h.ttl, s, `models: ${h.models.map((m) => `${m.model} ${m.ach ?? 0}`).join(' + ')}`);
      }
      if (h.tgt != null && h.ttl != null && h.gap != null) { cGap.checked += 1; if (!near(h.ttl - h.tgt, h.gap, 0.5)) bad(cGap, h, where, h.gap, h.ttl - h.tgt); }
      if (h.tgt > 0 && h.gap != null && h.it != null) {
        cIt.checked += 1; const e = (h.min / h.tgt) * h.gap;
        if (!near(e, h.it, 0.05 + Math.abs(e) * 0.001)) {
          const m = h.it && h.gap ? (h.it * h.tgt) / h.gap : null;
          bad(cIt, h, where, r2(h.it), r2(e), m ? `the file uses ${r1(m)} min for a ${h.min}-min slot` : '');
        }
      }
      if (h.it && h.loss != null && Math.abs(h.it) >= 0.5) {   // a tiny I/T: its rounding says nothing about the people
        const ot = h.h * 60 >= otMin ? otX : 1;
        const k = h.loss / ((rate * h.it) / 60 * ot);
        people.push({ h, k: Math.abs(k - Math.round(k)) <= 0.3 ? Math.round(k) : r1(k) });
      }
    }
    // the people of the loss ₹: the most used number on each line (the plant file writes it into the formula)
    cRs.checked = people.length;
    const lineMp = new Map(); for (const x of R.sum) if (x.mp != null) { const st = lineMp.get(x.line) || new Set(); st.add(x.mp); lineMp.set(x.line, st); }
    const per = [];
    for (const l of [...new Set(people.map((p) => p.h.line))].sort((x, y) => Number(x) - Number(y))) {
      const ps = people.filter((p) => p.h.line === l);
      const top = mode(ps.map((p) => p.k)); if (!top) continue;
      per.push(`Line ${l}: ${top[0]} people (${top[1]} of ${ps.length} hours)${lineMp.has(l) ? ` — M/P written ${[...lineMp.get(l)].sort((x, y) => x - y).join(' / ')}` : ''}`);
      for (const p of ps) if (Math.abs(p.k - top[0]) > 0.5) bad(cRs, p.h, p.h.slot, r2(p.h.loss), r2((rate * p.h.it) / 60 * top[0] * (p.h.h * 60 >= otMin ? otX : 1)), `this row uses ${p.k} people${Math.abs(p.k - top[0] * otX) < 1 ? ` (= ${top[0]} × ${otX}: overtime counted before ${otFrom})` : ''}`);
    }
    if (per.length) cRs.uses = `Loss ₹ = ₹${rate} × I/T ÷ 60 × a fixed number of people: ${per.join('; ')}. Line Pulse uses the M/P of the morning entry of that day.`;
    // the day summary of every line against its hours
    const cS = check('sum', 'Line summary = its hours (Tgt, Prod, Gap, I/T, Loss ₹, % Ach)');
    const cU = check('upph', 'UPPH = UPH ÷ M/P');
    const hrsUsed = new Map();
    for (const s of R.sum) {
      const hs = R.hours.filter((h) => h.date === s.date && h.line === s.line);
      if (!hs.length) continue;
      cS.checked += 1;
      const T = hs.reduce((a, h) => a + (h.tgt || 0), 0), P2 = hs.reduce((a, h) => a + (h.ttl || 0), 0), I = hs.reduce((a, h) => a + (h.it || 0), 0), L = hs.reduce((a, h) => a + (h.loss || 0), 0);
      const why = [];
      if (s.tgt != null && !near(s.tgt, T, 0.5)) why.push(`Tgt ${s.tgt} vs hours ${T}`);
      const PA = hs.reduce((a, h) => a + (h.models.length ? h.models.reduce((x, m) => x + (m.ach || 0), 0) : (h.ttl || 0)), 0);   // the summary may add the models' Ach
      if (s.prod != null && !near(s.prod, P2, 0.5) && !near(s.prod, PA, 0.5)) why.push(`Prod ${s.prod} vs hours ${P2}${PA !== P2 ? ` (models ${PA})` : ''}`);
      if (s.gap != null && s.tgt != null && s.prod != null && !near(s.gap, s.prod - s.tgt, 0.5)) why.push(`Gap ${s.gap} vs ${s.prod - s.tgt}`);
      if (s.itMin != null && !near(s.itMin, I, 0.1 + Math.abs(I) * 0.001)) why.push(`I/T ${r2(s.itMin)} vs hours ${r2(I)} min`);
      if (s.loss != null && !near(s.loss, L, 1 + Math.abs(L) * 0.001)) why.push(`Loss ₹ ${Math.round(s.loss)} vs hours ${Math.round(L)}`);
      if (s.ach != null && s.tgt > 0 && s.prod != null && !near(s.ach, s.prod / s.tgt, 0.0005)) why.push(`% Ach ${r2(s.ach * 100)} vs ${r2((s.prod / s.tgt) * 100)}`);
      if (why.length) bad(cS, s, 'Summary', null, null, why.join(' · '));
      if (s.mp > 0) {
        if (s.uphT != null && s.upphT != null) { cU.checked += 1; if (!near(s.upphT, s.uphT / s.mp, 0.005)) bad(cU, s, 'TGT UPPH', r2(s.upphT), r2(s.uphT / s.mp)); }
        if (s.uphA != null && s.upphA != null) { cU.checked += 1; if (!near(s.upphA, s.uphA / s.mp, 0.005)) bad(cU, s, 'Ach UPPH', r2(s.upphA), r2(s.uphA / s.mp)); }
      }
      if (s.uphT > 0 && s.tgt > 0) { const k = `Line ${s.line}`; const h = r2(s.tgt / s.uphT); const set = hrsUsed.get(k) || new Map(); set.set(h, (set.get(h) || 0) + 1); hrsUsed.set(k, set); }
    }
    const cH = check('uph-hours', 'TGT UPH = Tgt ÷ hours');
    cH.checked = R.sum.filter((s) => s.uphT > 0 && s.tgt > 0).length;
    if (hrsUsed.size) cH.uses = `TGT UPH divides the day's target by ${[...hrsUsed.entries()].sort().map(([l, m]) => `${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => `${h} h`).join(' / ')} (${l})`).join(', ')} — Line Pulse divides by the working hours of the line's shift (morning entry, else the shift master).`;
  }
  if (P.type === 'kpi') {
    const cD = check('fty-defects', 'Defect = sum of the six stages');
    const cF = check('fty-fpy', 'Stage FPY = 1 − stage defects ÷ production');
    const cR = check('fty-rty', 'RTY = product of the six FPY');
    for (const f of R.fty) {
      if (f.qty > 0) {
        const s = f.stages.reduce((a, n) => a + n, 0);
        cD.checked += 1; if (!near(f.defects ?? 0, s, 0.5)) bad(cD, f, 'FTY & RTY', f.defects, s, `stages ${f.stages.join(' + ')}`);
        f.fpy.forEach((v, k) => { if (v == null) return; cF.checked += 1; const e = 1 - f.stages[k] / f.qty; if (!near(v, e, 0.0005)) bad(cF, f, `FPY ${KPI_STAGES[k]}`, v, e, `${f.stages[k]} of ${f.qty}`); });
        if (f.rty != null && f.fpy.some((v) => v != null)) { cR.checked += 1; const e = f.fpy.reduce((p, v) => p * (v ?? 1), 1); if (!near(f.rty, e, 0.0005)) bad(cR, f, 'RTY', f.rty, e); }
      }
    }
    const cQ = check('sum-fty', 'Summary actual and RTY = FTY & RTY sheet');
    for (const s of R.sum) {
      const f = R.fty.find((x) => x.date === s.date && x.line === s.line);
      if (!f) continue;
      cQ.checked += 1; const why = [];
      if (s['kpi.qty'] != null && f.qty != null && !near(s['kpi.qty'], f.qty, 0.5)) why.push(`actual ${s['kpi.qty']} vs FTY ${f.qty}`);
      if (s['kpi.rty'] != null && f.rty != null && !near(s['kpi.rty'], f.rty * 100, 0.05)) why.push(`RTY ${s['kpi.rty']} vs FTY ${r2(f.rty * 100)}`);
      if (why.length) bad(cQ, s, 'Summary', null, null, why.join(' · '));
    }
    const cM = check('sum-models', 'Summary plan and actual = sum of the day sheet models');
    for (const s of R.sum) {
      const ms = R.models.filter((m) => m.date === s.date && m.line === s.line);
      if (!ms.length) continue;
      cM.checked += 1; const why = [];
      const P2 = ms.reduce((a, m) => a + (m.plan || 0), 0), Q = ms.reduce((a, m) => a + (m.qty || 0), 0);
      if (s['kpi.plan'] != null && !near(s['kpi.plan'], P2, 0.5)) why.push(`plan ${r1(s['kpi.plan'])} vs models ${r1(P2)}`);
      if (s['kpi.qty'] != null && !near(s['kpi.qty'], Q, 0.5)) why.push(`actual ${s['kpi.qty']} vs models ${Q}`);
      if (why.length) bad(cM, s, 'Summary', null, null, why.join(' · '));
    }
    const cA = check('mdl-uph', 'Model UPH actual = UPH target × actual ÷ plan');
    const mpUsed = new Map();
    for (const m of R.models) {
      if (m.uphT > 0 && m.plan > 0 && m.qty != null && m.uphA != null) {
        cA.checked += 1; const e = (m.uphT * m.qty) / m.plan;
        if (!near(m.uphA, e, Math.max(0.05, e * 0.002))) bad(cA, m, m.model, r2(m.uphA), r2(e));
      }
      if (m.uphT > 0 && m.upphT > 0) { const k = `Line ${m.line}`; const p = Math.round(m.uphT / m.upphT); const s = mpUsed.get(k) || new Map(); s.set(p, (s.get(p) || 0) + 1); mpUsed.set(k, s); }
    }
    const cP = check('mdl-upph', 'Model UPPH = UPH ÷ manpower (the same people every day on a line)');
    cP.checked = R.models.filter((m) => m.uphT > 0 && m.upphT > 0).length;
    if (mpUsed.size) cP.uses = `UPPH divides by ${[...mpUsed.entries()].sort().map(([l, m]) => `${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).join(' / ')} people (${l})`).join(', ')} — Line Pulse uses the M/P of the morning entry of that day and line.`;
    // a day whose people differ from the line's usual number (another line's number copied?) — one row per day and line
    const seenDay = new Set();
    for (const m of R.models) {
      if (!(m.uphT > 0 && m.upphT > 0)) continue;
      const usual = [...(mpUsed.get(`Line ${m.line}`) || new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const p = Math.round(m.uphT / m.upphT);
      if (usual == null || p === usual || seenDay.has(`${m.date}|${m.line}`)) continue;
      seenDay.add(`${m.date}|${m.line}`);
      const other = [...mpUsed.entries()].filter(([l, mm]) => l !== `Line ${m.line}` && [...mm.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] === p).map(([l]) => l);
      bad(cP, m, m.model, p, usual, `this day uses ${p} people — Line ${m.line} usually ${usual}${other.length ? ` (${p} is the number of ${other.join(', ')})` : ''}`);
    }
    const cH = check('sum-hours', 'Summary UPH target = plan ÷ hours');
    const hs = new Map();
    for (const s of R.sum) if (s['kpi.uphT'] > 0 && s['kpi.plan'] > 0) { cH.checked += 1; const k = `Line ${s.line}`; const h = r2(s['kpi.plan'] / s['kpi.uphT']); const m = hs.get(k) || new Map(); m.set(h, (m.get(h) || 0) + 1); hs.set(k, m); }
    if (hs.size) cH.uses = `Summary UPH = plan ÷ ${[...hs.entries()].sort().map(([l, m]) => `${[...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => `${h} h`).join(' / ')} (${l})`).join(', ')} — Line Pulse: plan ÷ the hours the plan gave the models (pieces × std cycle).`;
  }
  if (P.type === 'rwk') {
    const cT = check('rw-total', 'Total = sum of the hours');
    const cI = check('rw-inr', 'INR = pieces × ₹ per piece');
    const per = [];
    for (const r of R.rows) {
      if (r.total != null && r.hours.length) { cT.checked += 1; const s = r.hours.reduce((a, x) => a + x.v, 0); if (!near(s, r.total, 0.5)) bad(cT, r, `${r.stage} · ${r.defect}`, r.total, s, `hours ${r.hours.map((x) => `${pad(x.h)}:${x.v}`).join(' ')}`); }
      if (r.total > 0 && r.inr != null) per.push({ r, k: r2(r.inr / r.total) });
    }
    const top = mode(per.map((p) => p.k));
    if (top) {
      cI.checked = per.length;
      for (const p of per) if (Math.abs(p.k - top[0]) > 0.01) bad(cI, p.r, `${p.r.stage} · ${p.r.defect}`, p.r.inr, r2(p.r.total * top[0]), `this row uses ₹${p.k} per piece`);
      cI.uses = `₹${top[0]} per piece in ${top[1]} of ${per.length} rows.`;
    }
  }
  return out;
}

/** the checks as lines of text, for the downloaded file */
export const checkText = (c) => c.bad.map((b) => `${b.sheet ? `Sheet ${b.sheet}, row ${b.row}` : ''} · ${fmtD(b.date)} · Line ${b.line} · ${b.where}: ${b.value ?? ''}${b.expected != null ? ` (works out to ${typeof b.expected === 'number' ? r2(b.expected) : b.expected})` : ''}${b.note ? ` — ${b.note}` : ''}`);
