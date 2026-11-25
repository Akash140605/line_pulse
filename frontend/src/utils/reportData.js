/**
 * 20-11-2026: the data of the plant-layout reports (HPR, SAWM KPI, hourly rework data) from the OLE data of a period —
 * shared by Reports (download) and Report compare (the same report made again to compare with the plant's file).
 * ctx = { R (oleRange), D (useOleData), ids, settings } as OleSource hands it; auto = loadAutoTargets().
 */
import { hprHours, workMinOf } from './hpr';
import { shiftOfDay, SHIFT_PLANT } from './shift';
import { kpiDays } from './kpiReport';
import { reworkSheet, RWK_RATE } from './reworkReport';
import { targetsOn } from './targetPeriods';
import { serverToday } from './serverTime';
import { mergeTargets, isLineD } from '../hooks/useAutoTargets';

/** targets of line l on a date: the method in force that day (target method by date), else the targets in force now */
export const targetsFor = (st = {}, auto = {}) => (l, date) => (st[l]?.targetPeriods?.length ? targetsOn(st[l], date)
  : mergeTargets(st[l]?.targets || {}, auto?.byLine?.[l] || {}, isLineD(auto, l)));

/** HPR: every day and line of the period with its hours (target = the line's hourly plan, M/P + times = the morning entry) */
export function hprDataOf(ctx, auto, hprSet = {}) {
  if (!ctx?.R || !auto) return null;
  const { R, D, settings: st = {} } = ctx;
  const setups = D.ent.setup || {};
  const tOf = targetsFor(st, auto);
  const today = serverToday();
  return R.days.map((d) => ({
    date: d.date,
    lines: (ctx.ids || []).map((l) => {
      const L = d.byLine[l]; const su = setups[`${d.date}|${l}`] || null;
      const shift = shiftOfDay(setups, d.date, l, st[l]?.shift || null) || SHIFT_PLANT;
      const hours = L?.ok ? hprHours({ rows: L.rows, shift, targets: tOf(l, d.date), otFrom: hprSet.otFrom, date: d.date, line: l, rca: D.ent.rca || {}, lastMin: ctx.lastScans?.[`${d.date}|${l}`] ?? null }) : [];
      return { line: l, mp: su?.mp ?? null, fromEntry: !!su, shift, hrs: hours.length ? workMinOf(shift) / 60 : 0, rate: hprSet.rate, otX: hprSet.otX, error: L && !L.ok ? (L.error || 'No answer') : null, hours };
    }).filter((x) => x.hours.some((h) => h.qty > 0 || h.reasons.length) || (x.error && d.date === today)),
  })).filter((d) => d.lines.length);
}

/** SAWM KPI: every day and line with its models (plan from the line's hourly plan), M/P of the morning entry and quality by stage */
export function kpiDataOf(ctx, auto) {
  if (!ctx?.R || !auto) return null;
  const { R, D, settings: st = {} } = ctx;
  const setups = D.ent.setup || {};
  return kpiDays({
    R, setups, stations: D.ent.reasons?.station || [], today: serverToday(), nowMin: D.endMin, lines: ctx.ids || [], kpi: D.ent.kpi || {},
    targetsOf: targetsFor(st, auto), lastScans: ctx.lastScans || {},
    shiftOf: (date, l) => shiftOfDay(setups, date, l, st[l]?.shift || null) || SHIFT_PLANT,
  });
}

/** Hourly rework data (IPQC): the rework + rejection rows of the period, hour by hour */
export function rwkDataOf(ctx, from, to) {
  if (!ctx?.D) return null;
  const co = new Map();
  for (const L of ctx.D.al?.lines || []) for (const m of L.models || []) if (m.model && m.company) co.set(m.model, m.company);
  return reworkSheet({ entries: ctx.D.ent.entries || {}, start: from, end: to, ids: ctx.ids || null, stations: ctx.D.ent.reasons?.station || [], companyOf: (m) => co.get(m) || '', rate: RWK_RATE });
}
