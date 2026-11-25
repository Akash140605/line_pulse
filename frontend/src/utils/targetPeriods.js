/**
 * 20-11-2026: target method by date. A line whose method was changed from a date (Setup → Target method by date) has
 * settings.targetPeriods = [{ from, to, method, targets }] (useLineSettings); a day is counted against the targets of
 * the method in force that day. A line without dated changes has none, and settings.targets (today's) is used.
 */

/** the targets of a line on one day ('YYYY-MM-DD') */
export function targetsOn(st, date) {
  const P = st?.targetPeriods;
  if (!P?.length || !date) return st?.targets || {};
  const p = P.find((x) => (!x.from || date >= x.from) && (!x.to || date <= x.to));
  return p ? p.targets || {} : st?.targets || {};
}

/** the method period of a line on one day ({ from, to, method } or null) */
export function periodOn(st, date) {
  const P = st?.targetPeriods;
  if (!P?.length || !date) return null;
  return P.find((x) => (!x.from || date >= x.from) && (!x.to || date <= x.to)) || null;
}

/** the settings of a line as they were on one day (targets of that day's method) */
export const settingsOn = (st, date) => (st?.targetPeriods?.length && date ? { ...st, targets: targetsOn(st, date) } : st);
