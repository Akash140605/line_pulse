/** Local date as YYYY-MM-DD. */
export function ymd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * First day of a period that ends on `latest` (YYYY-MM-DD) and spans `months` calendar months.
 * The start is the day after the same calendar date `months` earlier, clamped to the end of the target month:
 *   2026-10-23, 2 months → 2026-08-24
 *   2026-03-31, 1 month  → 2026-03-01   (28 Feb is the clamped anchor, so the start is 1 Mar)
 */
export function periodStart(latest, months) {
  const [y, m, day] = String(latest).split('-').map(Number);
  const target = new Date(y, m - 1 - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay) + 1);
  return ymd(target);
}
