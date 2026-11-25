/**
 * 25-11-2026: the SAWM KPI report's sheets as screens (KPI dashboard → Summary / Day / FPY & RTY).
 * The same numbers as the Excel (utils/kpiReport.js): lineVals for UPH / UPPH / RTY, the KPI entry for OS&D, OT, WO,
 * TRC, WIP. The day screen keeps only the FA lines (the PKG and SMT blocks of the plant file are left out).
 * K = kpiDays(...), ids = the lines shown.
 */
import { KPI_LINES, KPI_STAGES, lineVals } from './kpiReport';

export const KPI_RTY_T = 97;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const sumN = (a) => { const p = a.filter(fin); return p.length ? p.reduce((x, y) => x + y, 0) : null; };
const avgPos = (a) => { const p = a.filter((v) => fin(v) && v > 0); return p.length ? p.reduce((x, y) => x + y, 0) / p.length : null; };
const avg = (a) => { const p = a.filter(fin); return p.length ? p.reduce((x, y) => x + y, 0) / p.length : null; };
const linesOf = (ids) => KPI_LINES.filter((k) => !ids || ids.map(String).includes(k.line));
const ENTRY = ['osd', 'otPlan', 'otUnplan', 'wo7', 'trc3', 'wip7'];

/** OS&D month to date of every day and line (resets with the month): { 'date|line': value } */
export function osdMtdOf(K) {
  const out = {}; const run = {}; let mon = '';
  for (const d of K || []) {
    if (d.date.slice(0, 7) !== mon) { mon = d.date.slice(0, 7); for (const k in run) delete run[k]; }
    for (const k of KPI_LINES) { const v = num(d.kpi?.[k.line]?.osd); run[k.line] = (run[k.line] || 0) + (v || 0); out[`${d.date}|${k.line}`] = v != null || run[k.line] ? run[k.line] : null; }
  }
  return out;
}

/** Summary sheet: [{ date, rows: [{ fa, sap, line, v, e, mtd }], total }] — the newest day first. */
export function summaryTable(K, ids) {
  const mtd = osdMtdOf(K);
  const out = [];
  for (const d of K || []) {
    const rows = linesOf(ids).map((k) => {
      const e = d.kpi?.[k.line] || null;
      return { fa: k.fa, sap: k.sap, line: k.line, v: lineVals(d.lines[k.line]), e: e && Object.fromEntries(ENTRY.map((f) => [f, num(e[f])])), mtd: mtd[`${d.date}|${k.line}`] ?? null };
    });
    if (!rows.some((r) => r.v || r.e)) continue;
    const col = (f) => rows.map((r) => r.v?.[f] ?? null);
    const ent = (f) => sumN(rows.map((r) => r.e?.[f] ?? null));
    out.push({
      date: d.date, rows,
      total: {
        plan: sumN(col('plan')), qty: sumN(col('qty')), uphT: avgPos(col('uphT')), uphA: avgPos(col('uphA')), upphT: avgPos(col('upphT')), upphA: avgPos(col('upphA')),
        rtyT: rows.some((r) => r.v) ? KPI_RTY_T : null, rty: avg(col('rty')), mtd: sumN(rows.map((r) => r.mtd)),
        ...Object.fromEntries(ENTRY.map((f) => [f, ent(f)])),
      },
    });
  }
  return out.reverse();
}

/** One day sheet, FA lines only: { date, lines: [{ fa, sap, line, label, models, mp, rty, reasons, e, mtd }], total } */
export function dayTable(K, date, ids) {
  const d = (K || []).find((x) => x.date === date);
  if (!d) return null;
  const mtd = osdMtdOf(K);
  const lines = linesOf(ids).map((k) => {
    const x = d.lines[k.line] || null;
    const e = d.kpi?.[k.line] || null;
    const models = (x?.models || []).map((m) => ({
      model: m.model, plan: m.plan, qty: m.qty, uphT: m.uph, uphA: m.uphAct,
      upphT: m.uph && x.mp ? m.uph / x.mp : null, upphA: m.uphAct && x.mp ? m.uphAct / x.mp : null,
    }));
    return {
      fa: k.fa, sap: k.sap, line: k.line, label: k.label, models, mp: x?.mp ?? null, qty: x?.qty ?? 0, plan: x?.plan ?? null,
      rty: x ? Math.round(x.rty * 10000) / 100 : null, reasons: x?.reasons || '', e: e && Object.fromEntries(ENTRY.map((f) => [f, num(e[f])])), mtd: mtd[`${d.date}|${k.line}`] ?? null, bom: num(e?.bom),
    };
  }).filter((l) => l.models.length || l.e);
  const s = (f) => sumN(lines.map((l) => l.e?.[f] ?? null));
  return {
    date: d.date, lines,
    total: { plan: sumN(lines.flatMap((l) => l.models.map((m) => m.plan))), qty: sumN(lines.map((l) => l.qty)) || 0, mtd: sumN(lines.map((l) => l.mtd)), bom: sumN(lines.map((l) => l.bom)), ...Object.fromEntries(ENTRY.map((f) => [f, s(f)])) },
  };
}

/** FTY & RTY sheet: [{ date, total, rows: [{ line, label, qty, defects, dismantle, stages[6], fpy[6], rty }] }] — newest first. */
export function ftyTable(K, ids) {
  const out = [];
  for (const d of K || []) {
    const rows = linesOf(ids).filter((k) => d.lines[k.line]).map((k) => {
      const x = d.lines[k.line];
      const fpy = x.stages.map((n) => 1 - n / x.qty);
      return { line: k.line, label: k.label, qty: x.qty, defects: x.defects || 0, dismantle: num(d.kpi?.[k.line]?.dismantle) ?? (x.dismantled || null), stages: x.stages, fpy, rty: fpy.reduce((a, v) => a * v, 1) };
    });
    if (rows.length) out.push({ date: d.date, total: rows.reduce((a, r) => a + r.qty, 0), rows });
  }
  return out.reverse();
}

/** The period of the FTY sheet in one row: stage-wise FPY over all the pieces, RTY = Π FPY. */
export function ftyPeriod(T) {
  const rows = (T || []).flatMap((d) => d.rows);
  const qty = rows.reduce((a, r) => a + r.qty, 0);
  if (!qty) return null;
  const stages = KPI_STAGES.map((_, i) => rows.reduce((a, r) => a + r.stages[i], 0));
  const fpy = stages.map((n) => 1 - n / qty);
  return { qty, defects: rows.reduce((a, r) => a + r.defects, 0), dismantle: sumN(rows.map((r) => r.dismantle)), stages, fpy, rty: fpy.reduce((a, v) => a * v, 1) };
}
