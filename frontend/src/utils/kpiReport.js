/**
 * SAWM KPI report — the plant's own "SAWM_KPI_Report" workbook, made from Line Pulse data in the same design
 * (fonts, borders, colours, number formats, widths and panes are copied from the plant file, see kpiTemplate.js).
 *
 *   Summary      every day: FA-01 … FA-04 — SAP location, Production plan / actual, UPH, UPPH, RTY, OS&D, OT, WO, TRC, WIP
 *   FTY & RTY    every day and line that made pieces: defects per stage, stage FPY = 1 − defects ÷ production, RTY = Π FPY
 *   1, 2, 3 …    one sheet per day: model by model per line, then the PKG and SMT blocks of the plant file
 *
 * Line Pulse fills what it has: plan, actual, UPH, UPPH (M/P of the morning entry), RTY and loss reasons.
 * OS&D, BOM value, OT, open work orders, TRC / WIP lying, dismantle, PKG and SMT are not in Line Pulse: those cells stay
 * blank (their total formulas stay, as in the plant file).
 *
 * Plan of a model = the line screen's hour plan (buildTargetDay) shared over the hour's models by their pieces; an hour
 * without pieces keeps the plan of the models before it. The day's plan ends at the line's last scan (a finished day),
 * lunch and tea breaks are no plan time, pieces made outside the shift count as actual with no plan (24-11-2026). UPH target = 3600 ÷ std cycle. UPH actual = UPH target × actual ÷ plan
 * (the pieces made in the time the plan gave the model). UPPH = UPH ÷ M/P. Day UPH = pieces ÷ hours of the plan.
 */
import { buildTargetDay, targetOf } from './targets';
import { normEntry } from './ole';
import { dayPlanOf } from './dayPlan';   // 25-11-2026: one plan of a line-day for the screens and the reports
import { zipStored, colName } from './xlsxWriter';
import { KPI_STYLES, KPI_THEME, KPI_SHEETS } from './kpiTemplate';

export { KPI_LINES, KPI_STAGES, stageOf } from './kpiStages';
import { KPI_LINES, KPI_STAGES, stageOf } from './kpiStages';
const RTY_TARGET = 97;
const PLANT = 'Washing Machine Unit Dehradun';

/**
 * Data of the report: [{ date, lines: { [line]: { qty, plan, hours, mp, models: [{ model, plan, qty, uph }], defects, stages[6], rty, reasons } } }]
 * Only days on which a line made pieces. R = oleRange, setups = morning entries, targetsOf(line) = targets in force,
 * shiftOf(date, line) = 'HH:MM' shift, stations = quality stations of Setup.
 */
export function kpiDays({ R, setups = {}, targetsOf, shiftOf, stations = [], today = null, nowMin = null, lines = KPI_LINES.map((x) => x.line), kpi = {}, lastScans = {} }) {
  const look = new Map();
  for (const s of stations || []) { const st = stageOf(s.reason, s.code); look.set(String(s.reason || '').toLowerCase(), st); for (const a of s.aliases || []) look.set(String(a).toLowerCase(), st); if (s.code) look.set(String(s.code).toLowerCase(), st); }
  const stageOfEntry = (x) => { const k = String(x.station || '').toLowerCase(); return look.has(k) ? look.get(k) : stageOf(x.station); };
  const out = [];
  for (const d of R?.days || []) {
    // the KPI entry of each line (OS&D, BOM, OT, WO, TRC, WIP, dismantle — page KPI entry)
    const day = { date: d.date, lines: {}, kpi: Object.fromEntries(lines.map((l) => [l, kpi?.[`${d.date}|${l}`] || null])) };
    for (const l of lines) {
      const L = d.byLine?.[l];
      if (!L?.ok) continue;
      const rows = (L.rows || []).filter((r) => !r.closed && !r.future);
      const qty = rows.reduce((a, r) => a + (r.qty || 0), 0);
      if (!(qty > 0)) continue;
      // 20-11-2026: the targets of the method in force that day; 21-11-2026: a model with no std cycle takes the line's
      // average of the day (fillNoStd), so the plan of its hours does not land on the other models
      // 25-11-2026: the plan of the day from the one function every screen uses (utils/dayPlan.js)
      const endMin = d.date === today ? (nowMin && typeof nowMin === 'object' ? (nowMin[l] ?? nowMin.now ?? null) : nowMin) : (lastScans[`${d.date}|${l}`] ?? null);
      const dp = dayPlanOf({ rows: L.rows || [], targets: targetsOf(l, d.date) || {}, shift: shiftOf(d.date, l), endMin }) || { byModel: {} };
      const M = new Map(Object.entries(dp.byModel));
      const models = [...M.values()].filter((m) => m.qty > 0 || m.plan > 0).map((m) => {
        const uph = m.cycle > 0 ? 3600 / m.cycle : null;
        return { model: m.model, plan: m.plan > 0 ? m.plan : null, qty: m.qty, uph, uphAct: uph && m.plan > 0 ? (uph * m.qty) / m.plan : null, hours: uph && m.plan > 0 ? m.plan / uph : 0 };
      });
      const plan = Math.round(models.reduce((a, m) => a + (m.plan || 0), 0) * 1e6) / 1e6;   // a sum of whole hour plans: no 1966.9999
      const hours = models.reduce((a, m) => a + m.hours, 0);
      const su = setups[`${d.date}|${l}`] || null;
      const mp = su?.mp != null && Number(su.mp) > 0 ? Number(su.mp) : null;
      // quality: rejection + rework found at each stage (an entry without a known stage counts in the defects only)
      const stages = [0, 0, 0, 0, 0, 0];
      let defects = 0, dismantled = 0;
      const why = new Map();
      for (const r of rows) {
        const e = r.e || normEntry(r.entry);
        for (const x of [...e.rejects, ...e.rework]) { const n = Number(x.qty) || 0; defects += n; dismantled += Number(x.dismantle) || 0; const s = stageOfEntry(x); if (s != null) stages[s] += n; }
        for (const x of [...e.losses, ...e.stops]) { const k = x.reason || 'Not given'; why.set(k, (why.get(k) || 0) + (Number(x.min) || 0)); }
      }
      const rty = stages.reduce((a, n) => a * (1 - n / qty), 1);
      const reasons = [...why.entries()].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]).map(([k, m]) => `${k} (${Math.round(m)} min)`).join(', ');
      day.lines[l] = { qty, plan: plan > 0 ? plan : null, hours, mp, models: models.sort((a, b) => a.model.localeCompare(b.model)), defects, dismantled, stages, rty, reasons };
    }
    if (Object.keys(day.lines).length || Object.values(day.kpi).some(Boolean)) out.push(day);
  }
  return out;
}

// ── workbook ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COL = (c) => c.charCodeAt(0) - 65;   // 'A' → 0 (the sheets never pass W)
export const excelDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 86400000; };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** A sheet being written: rows of cells { s, v, f } and merges. */
function grid() {
  const rows = new Map(), attrs = new Map(), merges = [];
  return {
    rows, attrs, merges,
    /** copy the style of every cell of template row `tr` into row r */
    styled(r, tpl, tr, extra = {}) {
      const t = tpl.rows[tr]; if (!t) return;
      const row = rows.get(r) || {}; rows.set(r, row);
      for (const [c, s] of Object.entries(t.c)) row[c] = { ...(row[c] || {}), s };
      if (t.a) attrs.set(r, t.a);
      for (const [c, v] of Object.entries(extra)) this.put(r, c, v);
    },
    put(r, c, v) {
      const row = rows.get(r) || {}; rows.set(r, row);
      const cell = row[c] || { s: 0 };
      if (v && typeof v === 'object' && 'f' in v) row[c] = { ...cell, f: v.f, v: v.v };
      else row[c] = { ...cell, v };
    },
    style(r, c, s) { const row = rows.get(r) || {}; rows.set(r, row); row[c] = { ...(row[c] || {}), s }; },
    merge(ref) { if (!/^([A-Z]+)(\d+):\1\2$/.test(ref)) merges.push(ref); },
  };
}

function cellXml(ref, c) {
  const s = ` s="${c.s || 0}"`;
  if (c.f) {
    if (typeof c.v === 'string') return `<c r="${ref}"${s} t="str"><f>${esc(c.f)}</f><v>${esc(c.v)}</v></c>`;
    return `<c r="${ref}"${s}><f>${esc(c.f)}</f>${fin(c.v) ? `<v>${c.v}</v>` : ''}</c>`;
  }
  if (c.v == null || c.v === '') return `<c r="${ref}"${s}/>`;
  if (fin(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
}

function sheetXml(g, tpl, { selected = false } = {}) {
  const nums = [...g.rows.keys(), ...g.attrs.keys()].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  let maxC = 0;
  const body = nums.map((r) => {
    const row = g.rows.get(r) || {};
    const cs = Object.keys(row).sort((a, b) => COL(a) - COL(b) || a.length - b.length);
    for (const c of cs) maxC = Math.max(maxC, COL(c));
    const a = g.attrs.get(r);
    return `<row r="${r}"${a ? ` ${a}` : ''}>${cs.map((c) => cellXml(`${c}${r}`, row[c])).join('')}</row>`;
  }).join('');
  const last = nums.length ? nums[nums.length - 1] : 1;
  const view = tpl.view.replace('<sheetView ', `<sheetView ${selected ? 'tabSelected="1" ' : ''}`);
  const split = (k) => Number((tpl.pane.match(new RegExp(`${k}="(\\d+)"`)) || [])[1] || 0);
  const pane = tpl.pane.replace(/topLeftCell="[^"]*"/, `topLeftCell="${colName(split('xSplit'))}${split('ySplit') + 1}"`);   // opens at the top, not where the plant file was scrolled
  const merges = g.merges.length ? `<mergeCells count="${g.merges.length}">${g.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="A1:${colName(maxC)}${last}"/><sheetViews>${view}${pane}</sheetView></sheetViews>${tpl.fmt}${tpl.cols}`
    + `<sheetData>${body}</sheetData>${merges}`
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>';
}

const sum = (a) => a.reduce((x, y) => x + (fin(y) ? y : 0), 0);
const avgPos = (a) => { const p = a.filter((v) => fin(v) && v > 0); return p.length ? p.reduce((x, y) => x + y, 0) / p.length : null; };
const avg = (a) => { const p = a.filter(fin); return p.length ? p.reduce((x, y) => x + y, 0) / p.length : null; };
const r2 = (v) => (fin(v) ? Math.round(v * 100) / 100 : null);

/** Line values of one day as the Summary and the day sheet show them. */
export function lineVals(x) {
  if (!x) return null;
  const uphT = x.plan && x.hours > 0 ? x.plan / x.hours : null;
  const uphA = x.hours > 0 ? x.qty / x.hours : null;
  return { plan: x.plan, qty: x.qty, uphT, uphA, upphT: uphT && x.mp ? uphT / x.mp : null, upphA: uphA && x.mp ? uphA / x.mp : null, rty: r2(x.rty * 100) };
}

function summarySheet(days) {
  const T = KPI_SHEETS.summary, g = grid();
  const H1 = { A: 'Date', B: 'Line No.', C: 'SAP Location', D: 'Production', F: 'UPH', H: 'UPPH', J: 'RTY (%)', L: 'OS&D (Reporting Date)', M: 'OS&D MTD', N: 'Actual OT (Manhours)', P: '>7 Days WO \n(Sum of Bal Qty)', Q: 'TRC Lying \n>3 Days (Rs)', R: 'WIP Lying \n>7 Days (Rs)' };
  const H2 = { D: 'Plan', E: 'Actual', F: 'Target ', G: 'Actual', H: 'Target ', I: 'Actual', J: 'Target ', K: 'Actual', L: 'Value', M: 'Value', N: 'Planned', O: 'Unplanned' };
  g.styled(1, T, 1, H1); g.styled(2, T, 2, H2);
  for (const m of ['R1:R2', 'A1:A2', 'B1:B2', 'C1:C2', 'P1:P2', 'Q1:Q2']) g.merge(m);
  let a = 3, prev = null;
  const mtd = KPI_LINES.map(() => 0);
  for (const d of days) {
    if (prev != null && d.date.slice(0, 7) !== days[days.indexOf(d) - 1]?.date.slice(0, 7)) mtd.fill(0);
    const vals = KPI_LINES.map((k) => lineVals(d.lines[k.line]));
    KPI_LINES.forEach((k, i) => {
      const r = a + i, v = vals[i];
      g.styled(r, T, 3 + i, { A: i === 0 ? excelDate(d.date) : null, B: k.fa, C: k.sap });
      if (v) {
        g.put(r, 'D', v.plan); g.put(r, 'E', v.qty); g.put(r, 'F', v.uphT); g.put(r, 'G', v.uphA); g.put(r, 'H', v.upphT); g.put(r, 'I', v.upphA);
        g.put(r, 'J', RTY_TARGET); g.put(r, 'K', v.rty);
      }
      const e = d.kpi?.[k.line];
      if (e) { for (const [c, f] of [['L', 'osd'], ['N', 'otPlan'], ['O', 'otUnplan'], ['P', 'wo7'], ['Q', 'trc3'], ['R', 'wip7']]) if (e[f] != null) g.put(r, c, e[f]); }
      mtd[i] += Number(e?.osd) || 0;
      g.put(r, 'M', { f: prev == null ? `L${r}` : `M${prev + i}+L${r}`, v: mtd[i] });
    });
    const kv = (f) => sum(KPI_LINES.map((k) => d.kpi?.[k.line]?.[f] ?? null));
    const t = a + 4, rr = (c) => `${c}${a}:${c}${a + 3}`;
    const col = (k) => vals.map((v) => v?.[k] ?? null);
    g.styled(t, T, 7, {
      D: { f: `SUM(${rr('D')})`, v: sum(col('plan')) }, E: { f: `SUM(${rr('E')})`, v: sum(col('qty')) },
      F: { f: `AVERAGEIF(${rr('F')},">0",${rr('F')})`, v: avgPos(col('uphT')) }, G: { f: `AVERAGEIF(${rr('G')},">0",${rr('G')})`, v: avgPos(col('uphA')) },
      H: { f: `AVERAGEIF(${rr('H')},">0",${rr('H')})`, v: avgPos(col('upphT')) }, I: { f: `AVERAGEIF(${rr('I')},">0",${rr('I')})`, v: avgPos(col('upphA')) },
      J: { f: `AVERAGE(${rr('J')})`, v: avg(vals.map((v) => (v ? RTY_TARGET : null))) }, K: { f: `AVERAGE(${rr('K')})`, v: avg(col('rty')) },
      L: { f: `SUM(${rr('L')})`, v: kv('osd') || 0 }, M: { f: `SUM(${rr('M')})`, v: sum(mtd) || 0 }, N: { f: `SUM(${rr('N')})`, v: kv('otPlan') || 0 },
      O: { f: `SUM(${rr('O')})`, v: kv('otUnplan') || 0 }, P: { f: `SUM(${rr('P')})`, v: kv('wo7') || 0 }, Q: { f: `SUM(${rr('Q')})`, v: kv('trc3') || 0 }, R: { f: `SUM(${rr('R')})`, v: kv('wip7') || 0 },
    });
    // a day whose UPH / UPPH cannot be worked out (no plan or no M/P on any line): no AVERAGEIF over nothing (#DIV/0!)
    for (const [c, k] of [['F', 'uphT'], ['G', 'uphA'], ['H', 'upphT'], ['I', 'upphA']]) if (avgPos(col(k)) == null) g.put(t, c, null);
    if (avg(col('rty')) == null) g.put(t, 'K', null);
    g.merge(`A${a}:A${a + 3}`); g.merge(`R${a}:R${a + 1}`);
    prev = a; a += 5;
  }
  return g;
}

function ftySheet(days) {
  const T = KPI_SHEETS.fty, g = grid();
  g.styled(1, T, 1, { B: 'Date', C: 'Line', D: 'Line Wise Production', E: 'Total Production', F: 'Defect', G: 'Dismental', H: 'STAGES', N: 'STAGE WISE FPY (%)', T: 'Target', U: 'RTY (%)' });
  g.styled(2, T, 2, Object.fromEntries(['H', 'I', 'J', 'K', 'L', 'M'].flatMap((c, i) => [[c, KPI_STAGES[i]], [String.fromCharCode(c.charCodeAt(0) + 6), KPI_STAGES[i]]])));
  for (const m of ['H1:M1', 'N1:S1', 'T1:T2', 'U1:U2', 'B1:B2', 'C1:C2', 'D1:D2', 'E1:E2', 'F1:F2', 'G1:G2']) g.merge(m);
  let r = 3;
  for (const d of days) {
    const ls = KPI_LINES.filter((k) => d.lines[k.line]);
    const a = r, z = r + ls.length - 1;
    const total = ls.reduce((s, k) => s + d.lines[k.line].qty, 0);
    ls.forEach((k, i) => {
      const x = d.lines[k.line], rr = a + i;
      g.styled(rr, T, 3, { C: k.label, D: x.qty, F: x.defects || null, G: d.kpi?.[k.line]?.dismantle ?? (x.dismantled || null), T: RTY_TARGET / 100 });
      // B and E carry the day's group border: one row, or top / middle / bottom of the group
      const one = ls.length === 1, pos = i === 0 ? 'top' : i === ls.length - 1 ? 'bot' : 'mid';
      g.style(rr, 'B', one ? 64 : { top: 120, mid: 122, bot: 121 }[pos]);
      g.style(rr, 'E', one ? 65 : { top: 106, mid: 107, bot: 108 }[pos]);
      if (i === 0) { g.put(rr, 'B', excelDate(d.date)); g.put(rr, 'E', { f: `SUM(D${a}:D${z})`, v: total }); }
      const fpy = [];
      ['H', 'I', 'J', 'K', 'L', 'M'].forEach((c, s) => {
        const n = x.stages[s];
        if (n > 0) g.put(rr, c, n);
        const v = 1 - n / x.qty; fpy.push(v);
        g.put(rr, String.fromCharCode(c.charCodeAt(0) + 6), { f: `100%-(${c}${rr}/D${rr})`, v });
      });
      g.put(rr, 'U', { f: `PRODUCT(N${rr}:S${rr})`, v: fpy.reduce((p, v) => p * v, 1) });
    });
    if (ls.length > 1) { g.merge(`B${a}:B${z}`); g.merge(`E${a}:E${z}`); }
    r = z + 1;
  }
  return g;
}

function daySheet(d) {
  const T = KPI_SHEETS.day, g = grid();
  g.styled(1, T, 1);
  g.styled(2, T, 2, { B: 'Date', C: excelDate(d.date) });
  g.styled(3, T, 3, { B: 'Plant Name', C: PLANT, O: 'BOM Value (Cr)', P: d.bom ?? null, Q: 'BOM Value (Cr)', R: d.bomMtd ?? null });
  g.styled(4, T, 4);
  g.styled(5, T, 5, { B: 'Line No.', C: 'SAP Location', D: 'Model', E: 'Production', G: 'UPH', I: 'UPPH', L: 'RTY (%)', N: 'Loss Reason', O: 'OS&D (Reporting Date)', Q: 'OS&D MTD', S: 'Actual OT (Manhours)', U: '>7 Days WO \n(Sum of Bal Qty)', V: 'TRC Lying \n>3 Days (Cr)', W: 'WIP Lying \n>7 Days (Cr)' });
  g.styled(6, T, 6, { E: 'Plan', F: 'Actual', G: 'Target ', H: 'Actual', I: 'Installed', J: 'Program', K: 'Actual', L: 'Target ', M: 'Actual', O: 'Value', P: '%', Q: 'Value', R: '%', S: 'Planned', T: 'Unplanned' });
  for (const m of ['B5:B6', 'C5:C6', 'D5:D6', 'N5:N6', 'U5:U6', 'V5:V6', 'W5:W6']) g.merge(m);
  let r = 7;
  for (const k of KPI_LINES) {
    const x = d.lines[k.line];
    const ms = [...(x?.models || [])];
    while (ms.length < 3) ms.push(null);   // the plant file keeps at least 3 rows per line, empty ones too
    const a = r;
    ms.forEach((m, i) => {
      g.styled(r, T, i === 0 ? 7 : 8, { B: k.fa, C: k.sap });
      if (m) {
        g.put(r, 'D', m.model); g.put(r, 'E', m.plan); g.put(r, 'F', m.qty); g.put(r, 'G', m.uph); g.put(r, 'H', m.uphAct);
        if (x.mp) { g.put(r, 'J', m.uph ? m.uph / x.mp : null); g.put(r, 'K', m.uphAct ? m.uphAct / x.mp : null); }
      }
      r += 1;
    });
    if (x) { g.put(a, 'L', RTY_TARGET); g.put(a, 'M', r2(x.rty * 100)); g.put(a, 'N', x.reasons || null); }
    // the KPI entry of the line: OS&D (₹) and its month to date, OT, WO, TRC / WIP (₹ → Cr as the plant file)
    const e = d.kpi?.[k.line];
    if (e) {
      if (e.osd != null) g.put(a, 'O', e.osd);
      if (e.osd != null || d.osdMtd?.[k.line]) g.put(a, 'Q', d.osdMtd?.[k.line] ?? e.osd);
      if (e.otPlan != null) g.put(a, 'S', e.otPlan); if (e.otUnplan != null) g.put(a, 'T', e.otUnplan);
      if (e.wo7 != null) g.put(a, 'U', e.wo7); if (e.trc3 != null) g.put(a, 'V', e.trc3 / 1e7); if (e.wip7 != null) g.put(a, 'W', e.wip7 / 1e7);
    }
    if (r - 1 > a) for (const c of ['L', 'M', 'N', 'O', 'Q', 'S', 'U', 'V', 'W']) g.merge(`${c}${a}:${c}${r - 1}`);
  }
  const lastFa = r - 1;
  const totalRow = (tr, label, from, to, blankTo, tplRow) => {
    const all = (c, z = to) => ({ f: `SUM(${c}${from}:${c}${z})`, v: 0 });
    g.styled(tr, T, tplRow, {
      B: label, D: 'Total', E: all('E'), F: all('F'), O: all('O'), P: { f: `IFERROR(O${tr}/P$3/10^7,"")`, v: '' }, Q: all('Q', blankTo),
      R: { f: `IFERROR(Q${tr}/R$3/10^7,"")`, v: '' }, S: all('S', blankTo), T: all('T', blankTo), U: all('U', blankTo), V: all('V', blankTo), W: all('W', blankTo),
    });
  };
  // FA: TRC, Other, a blank row, the FA total
  g.styled(r, T, 33, { B: 'TRC' }); g.styled(r + 1, T, 34, { B: 'Other' }); g.styled(r + 2, T, 35);
  totalRow(r + 3, 'FA', 7, lastFa, r + 2, 36);
  const faE = sum(KPI_LINES.flatMap((k) => (d.lines[k.line]?.models || []).map((m) => m.plan)));
  const faF = sum(KPI_LINES.map((k) => d.lines[k.line]?.qty || 0));
  g.put(r + 3, 'E', { f: `SUM(E7:E${lastFa})`, v: faE }); g.put(r + 3, 'F', { f: `SUM(F7:F${lastFa})`, v: faF });
  r += 4;
  g.styled(r, T, 37); r += 1;
  // PKG-01 … PKG-08, a blank row, the PKG total
  const pk = r;
  for (let i = 1; i <= 8; i++) { g.styled(r, T, 39, { B: `PKG-0${i}` }); r += 1; }
  g.styled(r, T, 46); r += 1;
  totalRow(r, 'PKG', pk, r - 1, r - 1, 47); r += 1;
  g.styled(r, T, 48); r += 1;
  // SMT: its own header, SMT-01 … SMT-06 (+ GS06), a blank row, TRC, Other, a blank row, the SMT total
  const h = r;
  g.styled(h, T, 49, { B: 'Line No.', C: 'SAP Location', D: 'Model', E: { f: '+E5', v: 'Production' }, G: 'CPH', I: { f: '+I5', v: 'UPPH' }, L: { f: '+L5', v: 'RTY (%)' }, O: { f: '+O5', v: 'OS&D (Reporting Date)' }, Q: { f: '+Q5', v: 'OS&D MTD' }, S: 'Actual OT (Manhours)', U: '>7 Days WO (Sum of Bal Qty)', V: 'TRC Lying \n>3 Days (Cr)', W: 'WIP Lying \n>7 Days (Cr)' });
  g.styled(h + 1, T, 50, { E: 'Plan', F: 'Actual', G: { f: '+G6', v: 'Target ' }, H: { f: '+H6', v: 'Actual' }, I: 'Installed', J: 'Program', K: 'Actual', L: { f: '+L6', v: 'Target ' }, M: { f: '+M6', v: 'Actual' }, O: 'Value', P: '%', Q: 'Value', R: '%', S: 'Planned', T: 'Unplanned' });
  for (const c of ['W', 'B', 'C', 'D', 'U', 'V']) g.merge(`${c}${h}:${c}${h + 1}`);
  g.merge(`S${h}:T${h}`);
  r = h + 2;
  const sm = r;
  for (const [b, c] of [['SMT-01', 'GT01'], ['SMT-02', 'GT02'], ['SMT-03', 'GT03'], ['SMT-04', 'GT04'], ['SMT-05', 'GT05'], ['SMT-06', 'GT06'], ['SMT-06', 'GS06']]) { g.styled(r, T, 51, { B: b, C: c }); r += 1; }
  g.styled(r, T, 58); g.styled(r + 1, T, 59, { B: 'TRC' }); g.styled(r + 2, T, 60, { B: 'Other' }); g.styled(r + 3, T, 61);
  totalRow(r + 4, 'SMT', sm, r - 1, r + 3, 62);
  return g;
}

/** The .xlsx bytes of the report for these days (kpiDays). */
export function buildKpiXlsx(days) {
  const months = new Set(days.map((d) => d.date.slice(0, 7)));
  // month to date of OS&D (per line) and BOM value (plant) for the day sheets
  const run = {}; let bomRun = 0, mon = '';
  for (const d of days) {
    if (d.date.slice(0, 7) !== mon) { mon = d.date.slice(0, 7); for (const k in run) delete run[k]; bomRun = 0; }
    const e = d.kpi || {};
    d.osdMtd = {}; for (const k of KPI_LINES) { run[k.line] = (run[k.line] || 0) + (Number(e[k.line]?.osd) || 0); d.osdMtd[k.line] = run[k.line] || null; }
    const b = sum(KPI_LINES.map((k) => e[k.line]?.bom ?? null)); d.bom = b || null; bomRun += b || 0; d.bomMtd = bomRun || null;
  }
  const sheets = [
    { name: 'Summary', g: summarySheet(days), tpl: KPI_SHEETS.summary, selected: true },
    { name: 'FTY & RTY', g: ftySheet(days), tpl: KPI_SHEETS.fty },
    ...days.map((d) => ({ name: months.size > 1 ? `${d.date.slice(8, 10)}-${d.date.slice(5, 7)}` : String(Number(d.date.slice(8, 10))), g: daySheet(d), tpl: KPI_SHEETS.day })),
  ];
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const n = sheets.length;
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`;
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="19200" windowHeight="6525"/></bookViews><sheets>'
    + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  return zipStored([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: KPI_STYLES },
    { name: 'xl/theme/theme1.xml', data: KPI_THEME },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.g, s.tpl, { selected: s.selected }) })),
  ]);
}

/** File name as the plant names it: SAWM_KPI_Report-Nov_26.xlsx (the month of the last day). */
export function kpiFileName(to) {
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(to.slice(5, 7)) - 1];
  return `SAWM_KPI_Report-${mon}_${to.slice(2, 4)}.xlsx`;
}
