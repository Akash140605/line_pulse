/**
 * 20-11-2026: the reports of Line Pulse (Reports page) — their columns, their rows and the Excel sheet of a table report.
 * Shared by Reports (download) and Report compare (the same report made again to put next to another file).
 * [key, label, width, style, get(row)] — style: text / textBold / int / dec1
 */
import { api } from '../api';
import { issuesOf, rcaStatus, needsRca } from './ole';
import { KPI_LINES } from './kpiStages';
import { colName } from './xlsxWriter';
import { dprRows, custRows } from './prodReports';
import { loadAutoTargets, mergeTargets, targetSource, isLineD } from '../hooks/useAutoTargets';

export const pad = (n) => String(n).padStart(2, '0');
export const dmy = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '');
export const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);
export const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
export const hrs = (min) => (min == null ? null : Math.round((min / 60) * 100) / 100);
export const KIND = { stop: 'Idle time', loss: 'Idle time', reject: 'Rejection', rework: 'Rework' };

// [key, label, width, style, get(row)]  — style: text / textBold / int / dec1
export const REPORTS = [
  {
    id: 'hpr', name: 'HPR — hourly production report', src: 'ole', hpr: true,
    about: 'The plant\'s HPR Excel: one sheet per day — line summary, hour by hour per model with target, gap, I/T, loss reason, department, owner, RCA and loss ₹.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['line', 'Line', 8, 'text', (r) => `Line ${r.line}`], ['mp', 'M/P', 7, 'int'], ['hrs', 'Work hrs', 9, 'dec1'], ['tgt', 'Tgt', 9, 'int'], ['prod', 'Prod', 9, 'int'],
      ['gap', 'Gap', 8, 'int'], ['ach', '% Ach', 8, 'dec1'], ['itMin', 'I/T (min)', 10, 'dec1'], ['lossRs', 'Loss (₹)', 11, 'int'], ['reasons', 'Hours with a loss reason', 12, 'int']],
    rows: ({ H }) => (H || []).flatMap((d) => d.lines.map((l) => {
      const tgt = l.hours.reduce((a, h) => a + (h.target || 0), 0), prod = l.hours.reduce((a, h) => a + h.qty, 0);
      const it = l.hours.reduce((a, h) => a + (h.target > 0 ? (h.workMin / h.target) * (h.qty - h.target) : 0), 0);
      const rs = l.mp != null ? l.hours.reduce((a, h) => a + (h.target > 0 ? (h.workMin / h.target) * (h.qty - h.target) : 0) / 60 * l.mp * (h.ot ? l.otX : 1) * l.rate, 0) : null;
      return { date: d.date, line: l.line, mp: l.mp, hrs: r1(l.hrs), tgt, prod, gap: prod - tgt, ach: tgt ? r1((prod / tgt) * 100) : null, itMin: r1(it), lossRs: rs == null ? null : Math.round(rs), reasons: l.hours.filter((h) => h.reasons.length).length };
    })),
  },
  {
    id: 'kpi', name: 'SAWM KPI report', src: 'ole', kpi: true,
    about: 'The plant\'s SAWM KPI Excel in its own design: Summary, FTY & RTY and one sheet per day (model-wise plan, actual, UPH, UPPH, RTY, loss reason). OS&D, BOM, OT, WO, TRC, WIP and dismantle come from the KPI entry page; PKG and SMT stay blank.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['fa', 'Line No.', 9, 'text'], ['sap', 'SAP Location', 11, 'int'], ['plan', 'Plan', 9, 'int'], ['qty', 'Actual', 9, 'int'],
      ['uphT', 'UPH target', 10, 'dec1'], ['uphA', 'UPH actual', 10, 'dec1'], ['upphT', 'UPPH target', 11, 'dec1'], ['upphA', 'UPPH actual', 11, 'dec1'], ['rty', 'RTY %', 8, 'dec1'], ['osd', 'OS&D ₹', 11, 'dec1'], ['otPlan', 'OT planned', 10, 'dec1'], ['otUnplan', 'OT unplanned', 11, 'dec1'], ['wo7', '>7 days WO', 10, 'int'], ['trc3', 'TRC >3 days ₹', 12, 'dec1'], ['wip7', 'WIP >7 days ₹', 12, 'dec1'], ['dismantle', 'Dismantle', 9, 'int'], ['reasons', 'Loss reason', 40, 'text']],
    rows: ({ K }) => (K || []).flatMap((d) => KPI_LINES.filter((k) => d.lines[k.line] || d.kpi?.[k.line]).map((k) => {
      const x = d.lines[k.line] || { qty: 0, plan: null, hours: 0, mp: null, rty: null, reasons: '' }; const e = d.kpi?.[k.line] || {};
      const uphT = x.plan && x.hours > 0 ? x.plan / x.hours : null, uphA = x.hours > 0 ? x.qty / x.hours : null;
      const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
      return { date: d.date, fa: k.fa, sap: k.sap, plan: x.plan == null ? null : Math.round(x.plan), qty: x.qty, uphT: r1(uphT), uphA: r1(uphA), upphT: r2(uphT && x.mp ? uphT / x.mp : null), upphA: r2(uphA && x.mp ? uphA / x.mp : null), rty: x.rty == null ? null : r2(x.rty * 100), osd: e.osd ?? null, otPlan: e.otPlan ?? null, otUnplan: e.otUnplan ?? null, wo7: e.wo7 ?? null, trc3: e.trc3 ?? null, wip7: e.wip7 ?? null, dismantle: e.dismantle ?? null, reasons: x.reasons };
    })),
  },
  {
    // 20-11-2026: the plant's "Hrly. Rework data (IPQC)" sheet (Book1)
    id: 'rwk', name: 'Hourly rework data (IPQC)', src: 'ole', rwk: true,
    about: 'The plant\'s rework sheet: date, stage, line, brand, model, category, defect, root cause, action, pieces hour by hour (09-10 … 20-21), total and ₹ loss.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['stage', 'Stage', 18, 'text'], ['lineName', 'Line', 11, 'text'], ['brand', 'Brand', 11, 'text'], ['model', 'Model', 18, 'text'], ['cat', 'Category', 11, 'text'],
      ['defect', 'Defect', 26, 'text'], ['cause', 'Root cause', 24, 'text'], ['action', 'Action', 18, 'text'], ['total', 'Total', 8, 'int'], ['dismantle', 'Dismantled', 10, 'int'], ['rs', 'INR (Rs)', 10, 'int']],
    rows: ({ W }) => W?.rows || [],
  },
  {
    // 25-11-2026: the plant's Quality MIS workbook — the sheets Line Pulse can fill (utils/qualityMis.js)
    id: 'mis', name: 'Quality MIS (IPQC daily, top defects, summary, hourly rework)', src: 'ole', mis: true,
    about: 'The plant\'s Quality MIS: IPQC(Daily) defect qty / production / defect % of every line and day, Daily Top Defect Action (root cause, action, responsibility, status from the RCA), Summary of the defects per line and the Hrly. Rework data (IPQC). LAR / LRN (incoming) are not in Line Pulse.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['name', 'Line', 12, 'text'], ['prod', 'Production', 11, 'int'], ['def', 'Defect qty', 10, 'int'], ['pct', 'Defect %', 10, 'dec1'], ['top', 'Top defect', 30, 'text']],
    rows: ({ M }) => (M?.lines || []).flatMap((l) => M.days.map((d) => ({ date: d, name: l.name, prod: l.byDay[d].prod, def: l.byDay[d].def, pct: l.byDay[d].prod ? (l.byDay[d].def / l.byDay[d].prod) * 100 : null,
      top: (M.top.find((t) => t.date === d && t.line === l.line) || {}).defect || '' })).filter((r) => r.prod || r.def)),
  },
  {
    // 23-11-2026: the line's paper "Daily Production Report" — serial numbers from the good scans (read only)
    id: 'dpr', name: 'Daily production report (serial nos.)', src: 'ole', dpr: true, maxDays: 7,
    about: 'The line\'s daily paper: customer, model, plan (to fill), starting and ending serial number, total production, remarks — one sheet per line and day (up to 7 days).',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['line', 'Line', 8, 'text', (r) => `Line ${r.line}`], ['sr', 'Sr. No.', 7, 'int'], ['company', 'Customer', 16, 'text'], ['model', 'Model', 22, 'textBold'],
      ['start', 'Starting Sr. Number', 22, 'text'], ['end', 'Ending Sr. Number', 22, 'text'], ['qty', 'Total production', 12, 'int'], ['modelTotal', 'Model total', 11, 'int']],
    rows: ({ P }) => dprRows(P),
  },
  {
    // 25-11-2026: the plant's "Daily_Production_Lines" workbook — Summary (line · brand · model · qty) + every scan of each line
    id: 'srl', name: 'Daily production — serial list (all scans)', src: 'ole', srl: true, maxDays: 7,
    about: 'Summary of every line by brand and model (with line totals and all lines), and one sheet per line with every good scan: serial, carton, time, model code, component. Brand filter. Up to 7 days.',
    cols: [['line', 'Line', 12, 'text'], ['brand', 'Brand', 16, 'text'], ['model', 'Model', 26, 'textBold'], ['qty', 'Quantity', 11, 'int'], ['period', 'Period', 22, 'text']],
    rows: ({ B }) => (B?.lines || []).flatMap((l) => (l.total ? [...l.models.map((m) => ({ line: `Line ${l.line}`, brand: m.brand, model: m.model, qty: m.qty, period: B.period })), { line: `Line ${l.line} total`, brand: '', model: '', qty: l.total, period: B.period }] : [])).concat(B ? [{ line: 'ALL SELECTED LINES', brand: '', model: '', qty: B.total, period: B.period }] : []),
  },
  {
    // 23-11-2026: the plant's "Customer_wise_production" workbook — Summary + one sheet per customer
    id: 'cust', name: 'Customer wise production', src: 'ole', cust: true,
    about: 'The plant\'s customer-wise workbook: Summary (customer × date, total, plan, backlog, balance, line totals) and one sheet per customer (model × date).',
    cols: [['customer', 'Customer', 18, 'textBold'], ['custTotal', 'Customer total', 12, 'int'], ['model', 'Model', 24, 'text'], ['total', 'Pieces', 10, 'int'], ['days', 'Days made', 9, 'int'], ['best', 'Best day', 9, 'int']],
    rows: ({ C }) => custRows(C),
  },
  {
    id: 'oleDay', name: 'OLE — day by line', src: 'ole', about: 'Every day and line: pieces, time, availability, performance, quality and OLE.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['line', 'Line', 8, 'text', (r) => `Line ${r.line}`], ['qty', 'Qty', 10, 'int'], ['totalMin', 'Shift time (min)', 14, 'int'],
      ['stopMin', 'Planned stop (min)', 15, 'int'], ['plannedMin', 'Planned time (min)', 15, 'int'], ['lossMin', 'Idle time (min)', 17, 'int'], ['actualMin', 'Run time (min)', 13, 'int'],
      ['stdMin', 'Std time (min)', 13, 'dec1'], ['rejects', 'Rejected', 10, 'int'], ['rework', 'Rework', 9, 'int'], ['A', 'Availability %', 13, 'dec1'], ['P', 'Performance %', 13, 'dec1'],
      ['Q', 'Quality %', 11, 'dec1'], ['ole', 'OLE %', 9, 'dec1'], ['lostH', 'Lost time (h)', 12, 'dec1']],
    rows: ({ R, ids }) => R.days.flatMap((d) => ids.map((l) => ({ date: d.date, line: l, t: d.byLine[l]?.total })).filter((x) => x.t && (x.t.qty > 0 || x.t.totalMin > 0)))
      .map(({ date, line, t }) => ({ date, line, qty: t.qty, totalMin: Math.round(t.totalMin), stopMin: Math.round(t.stopMin), plannedMin: Math.round(t.plannedMin), lossMin: Math.round(t.lossMin), actualMin: Math.round(t.actualMin), stdMin: r1(t.stdSec / 60), rejects: t.rejects, rework: t.rework, A: pct(t.A), P: pct(t.P), Q: pct(t.Q), ole: pct(t.ole), lostH: hrs((t.lossMin || 0) + (t.speedMin || 0)) })),
  },
  {
    id: 'oleHour', name: 'OLE — hour by hour', src: 'ole', about: 'Every hour of every day and line, with the models made in it.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['line', 'Line', 8, 'text', (r) => `Line ${r.line}`], ['hour', 'Hour', 10, 'text', (r) => `${pad(r.hour)}-${pad(r.hour + 1)}${r.extra ? ' (extra)' : ''}`],
      ['models', 'Models', 34, 'text'], ['qty', 'Qty', 9, 'int'], ['stopMin', 'Planned stop (min)', 15, 'dec1'], ['lossMin', 'Idle time (min)', 17, 'dec1'], ['actualMin', 'Run time (min)', 13, 'dec1'],
      ['rejects', 'Rejected', 10, 'int'], ['A', 'Availability %', 13, 'dec1'], ['P', 'Performance %', 13, 'dec1'], ['Q', 'Quality %', 11, 'dec1'], ['ole', 'OLE %', 9, 'dec1']],
    rows: ({ R, ids }) => R.days.flatMap((d) => ids.flatMap((l) => (d.byLine[l]?.rows || []).filter((r) => !r.future && (r.qty > 0 || r.totalMin > 0) && !r.closed).map((r) => ({
      date: d.date, line: l, hour: r.hour, extra: r.extra, models: (r.models || []).map((m) => `${m.model} (${m.quantity})`).join(', '), qty: r.qty, stopMin: r1(r.stopMin), lossMin: r1(r.lossMin), actualMin: r1(r.actualMin),
      rejects: r.rejects, A: pct(r.A), P: pct(r.P), Q: pct(r.Q), ole: pct(r.ole),
    })))),
  },
  {
    id: 'modelDay', name: 'Production — model by day', src: 'ole', about: 'Pieces of every model per day and line, with its std cycle.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['line', 'Line', 8, 'text', (r) => `Line ${r.line}`], ['model', 'Model', 30, 'textBold'], ['qty', 'Qty', 10, 'int'],
      ['std', 'Std cycle (s)', 12, 'dec1'], ['stdMin', 'Std time (min)', 13, 'dec1']],
    rows: ({ R, ids }) => R.days.flatMap((d) => ids.flatMap((l) => {
      const m = new Map();
      for (const r of d.byLine[l]?.rows || []) for (const x of r.models || []) { const o = m.get(x.model) || { date: d.date, line: l, model: x.model, qty: 0, std: x.std || null }; o.qty += Number(x.quantity) || 0; m.set(x.model, o); }
      return [...m.values()].sort((a, b) => b.qty - a.qty).map((o) => ({ ...o, std: r1(o.std), stdMin: o.std ? r1((o.qty * o.std) / 60) : null }));
    })),
  },
  {
    id: 'losses', name: 'Losses & rework with RCA', src: 'ole', about: 'Every entered stoppage, loss, rejection and rework with department and RCA status.',
    cols: [['date', 'Date', 12, 'text', (r) => dmy(r.date)], ['line', 'Line', 8, 'text', (r) => `Line ${r.line}`], ['kind', 'Kind', 17, 'text'], ['reason', 'Reason', 28, 'textBold'], ['dept', 'Department', 16, 'text'],
      ['value', 'Amount', 9, 'int'], ['unit', 'Unit', 7, 'text'], ['hours', 'Hours', 14, 'text'], ['models', 'Models', 26, 'text'], ['rca', 'RCA', 12, 'text'], ['rootCause', 'Root cause', 30, 'text'], ['action', 'Action', 30, 'text']],
    rows: ({ R, D }) => issuesOf(R.days).map((i) => {
      const rec = D.ent.rca?.[i.key]; const x = rec || {};
      return { date: i.date, line: i.line, kind: KIND[i.kind] || i.kind, reason: i.reason, dept: i.dept, value: Math.round(i.value * 10) / 10, unit: i.unit, hours: i.hours.sort((a, b) => a - b).map((h) => `${pad(h)}:00`).join(', '), models: i.models.join(', '),
        rca: needsRca(i) ? ({ pending: 'Pending', submitted: 'Submitted', closed: 'Closed' }[rcaStatus(rec)] || rcaStatus(rec)) : 'Not needed', rootCause: x.cause || x.rootCause || '', action: x.action || '' };
    }),
  },
  {
    id: 'targets', name: 'Targets in force per line', src: 'targets', about: 'The target cycle of every model on each line now, with where it comes from (Master, Locked, Auto method, Saved).',
    cols: [['line', 'Line', 8, 'text', (r) => `Line ${r.line}`], ['company', 'Company', 16, 'text'], ['model', 'Model', 30, 'textBold'], ['cycle', 'Target cycle (s)', 15, 'dec1'], ['pph', 'Pcs / hr', 10, 'int'], ['source', 'Source', 16, 'text']],
    rows: ({ T }) => T,
  },
  {
    id: 'master', name: 'Model master', src: 'master', about: 'Company, model, cycle time and lines of the model master.',
    cols: [['company', 'Company', 18, 'text'], ['model', 'Model', 30, 'textBold'], ['cycle', 'Cycle time (s)', 14, 'dec1'], ['pph', 'Pcs / hr', 10, 'int'], ['lines', 'Lines', 12, 'text'], ['note', 'Note', 30, 'text'], ['updatedAt', 'Updated', 18, 'text']],
    rows: ({ M }) => M,
  },
];

/** the rows of "Model master" (only the models of these lines, or of every line) */
export async function loadMasterRows(ids) {
  const j = await api.modelMaster();
  return (j?.rows || []).filter((r) => !(r.lines || []).length || (r.lines || []).some((l) => ids.includes(String(l))))
    .map((r) => ({ ...r, pph: r.cycle > 0 ? Math.round(3600 / r.cycle) : null, lines: (r.lines || []).join(', ') }));
}

/** the rows of "Targets in force per line": the targets each line uses now, with where they come from */
export async function loadTargetRows(ids) {
  const auto = await loadAutoTargets(false).catch(() => null);
  const T = [];
  for (const l of ids) {
    const s = await api.lineSettings(l).catch(() => null);
    const savedT = s?.targets || {}; const a = auto?.byLine?.[l] || {};
    const merged = mergeTargets(savedT, a, isLineD(auto, l));
    for (const [mm, t] of Object.entries(merged)) {
      if (!(t?.cycle > 0)) continue;
      const src = targetSource(savedT, a, mm);
      T.push({ line: l, company: t.company || savedT[mm]?.company || '', model: t.model || savedT[mm]?.model || `#${mm}`, cycle: r1(t.cycle), pph: Math.round(3600 / t.cycle), source: { master: 'Master', manual: 'Locked', auto: 'Auto (line method)', saved: 'Saved' }[src] || src || '' });
    }
  }
  return T.sort((x, y) => x.line.localeCompare(y.line) || x.model.localeCompare(y.model));
}

/** the value of a column of a row as the report shows it */
export const cellVal = (c, r) => (c[4] ? c[4](r) : r[c[0]]);

/** a table report as one Excel sheet: title, subtitle, header on row 4, frozen header, filters (the Reports download) */
export function tableSheet(rep, rows, cols, title, sub) {
  const head = cols.map((c) => ({ v: c[1], s: 'head' }));
  const body = rows.map((r) => cols.map((c) => { const v = cellVal(c, r); return { v: v ?? '', s: v == null || v === '' ? 'text' : c[3] }; }));
  return { name: rep.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), cols: cols.map((c) => ({ width: c[2] })),
    rows: [[{ v: title, s: 'title' }], [{ v: sub, s: 'subtitle' }], [], head, ...body],
    merges: [`A1:${colName(Math.max(0, cols.length - 1))}1`, `A2:${colName(Math.max(0, cols.length - 1))}2`], freezeRow: 4, headerRow: 4,
    autoFilter: rows.length ? `A4:${colName(cols.length - 1)}${4 + rows.length}` : null };
}
