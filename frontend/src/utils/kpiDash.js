/**
 * KPI dashboard (20-11-2026) — the Summary sheet of the plant's SAWM KPI report on screen.
 * Built from kpiDays() (plan, actual, hours, M/P, RTY of every line and day) and the KPI entry rows (OS&D, OT, WO, TRC, WIP).
 *
 *   UPH  target = plan ÷ hours of the plan · actual = pieces ÷ hours of the plan
 *   UPPH target = plan ÷ man-hours · actual = pieces ÷ man-hours   (man-hours = hours of the plan × M/P of the morning entry;
 *        only line-days with an M/P count, so a day without M/P does not pull UPPH down)
 *   RTY  = average of the line-day RTYs (as the report's AVERAGE), target 97 %
 *   OS&D, OT = sum of the KPI entries · WO, TRC, WIP = the latest entry of the period (they are stock, not flow)
 */
export const KPI_RTY_TARGET = 97;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** Sum of line-days [{ qty, plan, hours, mp, rty }] → plan, qty, UPH, UPPH, RTY, man-hours, average M/P. */
export function kpiAgg(items) {
  let plan = 0, qty = 0, hours = 0, mh = 0, qMh = 0, pMh = 0, mpSum = 0, mpN = 0, rtySum = 0, rtyN = 0, n = 0;
  for (const x of items || []) {
    if (!x) continue;
    n += 1;
    plan += fin(x.plan) ? x.plan : 0; qty += fin(x.qty) ? x.qty : 0; hours += fin(x.hours) ? x.hours : 0;
    if (fin(x.mp) && x.mp > 0 && x.hours > 0) { mh += x.hours * x.mp; qMh += x.qty || 0; pMh += x.plan || 0; mpSum += x.mp; mpN += 1; }
    if (fin(x.rty)) { rtySum += x.rty * 100; rtyN += 1; }
  }
  return {
    n, plan: plan > 0 ? plan : null, qty, hours, manHours: mh || null,
    ach: plan > 0 ? (qty / plan) * 100 : null,
    uphT: hours > 0 && plan > 0 ? plan / hours : null, uphA: hours > 0 ? qty / hours : null,
    upphT: mh > 0 && pMh > 0 ? pMh / mh : null, upphA: mh > 0 ? qMh / mh : null,
    rty: rtyN ? rtySum / rtyN : null, mpAvg: mpN ? mpSum / mpN : null,
  };
}

/** The KPI entry rows of these lines and dates: OS&D and OT summed; WO / TRC / WIP of the latest day that has them. */
export function kpiEntryAgg(kpi, dates, lines) {
  const keep = new Set(dates); const ls = new Set(lines.map(String));
  const rows = Object.values(kpi || {}).filter((r) => r && keep.has(r.date) && ls.has(String(r.line)));
  const sum = (k) => { const v = rows.filter((r) => fin(Number(r[k])) && r[k] !== null && r[k] !== ''); return v.length ? v.reduce((a, r) => a + Number(r[k]), 0) : null; };
  const latest = (k) => {
    const v = rows.filter((r) => r[k] !== null && r[k] !== '' && r[k] !== undefined && fin(Number(r[k])));
    if (!v.length) return null;
    const last = v.reduce((a, r) => (r.date > a ? r.date : a), '');
    return { date: last, value: v.filter((r) => r.date === last).reduce((a, r) => a + Number(r[k]), 0) };
  };
  return { osd: sum('osd'), otPlan: sum('otPlan'), otUnplan: sum('otUnplan'), dismantle: sum('dismantle'), wo7: latest('wo7'), trc3: latest('trc3'), wip7: latest('wip7'), rows: rows.length };
}

/** Day rows of the Summary: [{ date, lines: { [line]: vals }, total }] with vals = kpiAgg of that one line-day. */
export function kpiSummaryDays(K, lines) {
  return (K || []).map((d) => {
    const per = Object.fromEntries(lines.map((l) => [l, d.lines[l] ? kpiAgg([d.lines[l]]) : null]));
    return { date: d.date, lines: per, total: kpiAgg(lines.map((l) => d.lines[l]).filter(Boolean)), kpi: d.kpi || {} };
  }).filter((d) => d.total.n > 0 || lines.some((l) => d.kpi?.[l]));
}

/**
 * Manpower of every day and line from the oleRange days (morning entry: M/P at open / close, the admin's standard M/P).
 * → { days: [{ date, lines: { [line]: { mp, open, close, std } }, total }], last: { date, lines, total, std } }
 */
export function manpowerDays(Rdays, setups, lines, std = {}) {
  const days = [];
  for (const d of Rdays || []) {
    const per = {};
    let any = false;
    for (const l of lines) {
      const su = setups?.[`${d.date}|${l}`] || null;
      const open = su?.mp != null && Number(su.mp) > 0 ? Number(su.mp) : null;
      const close = su?.mpClose != null && Number(su.mpClose) > 0 ? Number(su.mpClose) : null;
      const mp = d.byLine?.[l]?.mp ?? open;
      if (open != null || close != null) any = true;
      per[l] = { mp: fin(mp) && mp > 0 ? mp : null, open, close, std: Number(std?.[l]) || null };
    }
    if (!any) continue;
    const total = lines.reduce((a, l) => a + (per[l].open || 0), 0);
    days.push({ date: d.date, lines: per, total: total || null });
  }
  const last = days.length ? days[days.length - 1] : null;
  const stdTot = lines.reduce((a, l) => a + (Number(std?.[l]) || 0), 0) || null;
  return { days, last, stdTot, avg: days.length ? days.reduce((a, d) => a + (d.total || 0), 0) / days.filter((d) => d.total).length || null : null };
}
