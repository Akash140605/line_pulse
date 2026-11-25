/**
 * Main view (all lines): quick periods and the company filter.
 *
 * all_lines.php returns per line `daily` / `hourly` totals and the same split by company
 * (`dailyCo` [{d, c, q}], `hourlyCo` [{h, c, q}]). With companies selected, the totals are rebuilt from
 * the company rows of those companies only; the models list is filtered by company. Rejections have no company
 * in the database, so they stay for all companies (the page says so).
 */
import { ymd, periodStart } from './period';

const parse = (ds) => { const [y, m, d] = String(ds).split('-').map(Number); return new Date(y, m - 1, d); };
/** ds ± n days, local calendar (no UTC shift). */
export const addDays = (ds, n) => { const d = parse(ds); d.setDate(d.getDate() + n); return ymd(d); };
export const NO_CO = '(no company)';
/** Company name as one key: trimmed; empty → "(no company)". */
export const coKey = (c) => String(c ?? '').trim() || NO_CO;

/** Quick periods that end on (or before) `today`. */
export function quickPeriods(today) {
  const first = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(first, -1);
  return [
    { key: 'today', label: 'Today', start: today, end: today },
    { key: 'yesterday', label: 'Yesterday', start: addDays(today, -1), end: addDays(today, -1) },
    { key: '7d', label: 'Last 7 days', start: addDays(today, -6), end: today },
    { key: '30d', label: 'Last 30 days', start: addDays(today, -29), end: today },
    { key: 'month', label: 'This month', start: first, end: today },
    { key: 'lastMonth', label: 'Last month', start: `${lastMonthEnd.slice(0, 8)}01`, end: lastMonthEnd },
    { key: '3m', label: '3 months', start: periodStart(today, 3), end: today },
    { key: '6m', label: '6 months', start: periodStart(today, 6), end: today },
  ];
}

/** The quick period that matches a range exactly (or null = custom dates). */
export const matchPeriod = (today, range) => quickPeriods(today).find((p) => p.start === range.start && p.end === range.end) || null;

/** Readable period: "Yesterday · 2026-10-25", "Last 7 days · 2026-10-20 → 2026-10-26", "2026-10-01 → 2026-10-15". */
export function periodText(today, range) {
  const p = matchPeriod(today, range);
  const dates = range.start === range.end ? range.start : `${range.start} → ${range.end}`;
  return p ? `${p.label} · ${dates}` : dates;
}

/** Company list for the filter: value, label, models, pieces (largest first). */
export function companyOptions(lines) {
  const m = new Map();
  for (const l of lines || []) for (const md of l.models || []) {
    const k = coKey(md.company);
    const o = m.get(k) || { value: k, label: k, count: 0, pcs: 0 };
    o.count += 1; o.pcs += md.qty || 0; m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.pcs - a.pcs || a.label.localeCompare(b.label));
}

const sumBy = (rows, keyOf, keep) => {
  const m = new Map();
  for (const r of rows || []) if (keep(r)) { const k = keyOf(r); m.set(k, (m.get(k) || 0) + (r.q || 0)); }
  return m;
};

/**
 * Lines limited to the selected companies (empty selection = unchanged).
 * daily keeps each day's rejections (not split by company); `coFiltered` marks a line that was filtered.
 */
export function filterLinesByCompany(lines, companies) {
  if (!companies?.length) return lines || [];
  const sel = new Set(companies.map(coKey));
  const keep = (r) => sel.has(coKey(r.c));
  return (lines || []).map((l) => {
    if (!l.ok) return l;
    const dq = sumBy(l.dailyCo, (r) => r.d, keep);
    const rej = new Map((l.daily || []).map((r) => [r.d, r.rej || 0]));
    const days = [...new Set([...dq.keys(), ...[...rej.entries()].filter(([, n]) => n > 0).map(([d]) => d)])].sort();
    return {
      ...l,
      coFiltered: true,
      daily: days.map((d) => ({ d, q: dq.get(d) || 0, rej: rej.get(d) || 0 })),
      hourly: filterHourly(l.hourlyCo, companies),
      models: (l.models || []).filter((m) => sel.has(coKey(m.company))),
    };
  });
}

/** Hourly totals [{h, q}] of the selected companies from hourlyCo. */
export function filterHourly(hourlyCo, companies) {
  const sel = new Set((companies || []).map(coKey));
  const m = sumBy(hourlyCo, (r) => r.h, (r) => sel.has(coKey(r.c)));
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([h, q]) => ({ h, q }));
}

/**
 * Company-wise production over the shown lines: one row per company with the quantity per line,
 * total, share of all shown quantity, models and active days. Biggest first.
 * With companies selected, only those companies are listed (shares then add up to 100 % of the selection).
 */
export function companySummary(lines, companies = []) {
  const sel = companies.length ? new Set(companies.map(coKey)) : null;
  const by = new Map(); let all = 0;
  for (const l of lines || []) {
    if (!l.ok) continue;
    for (const r of l.dailyCo || []) {
      const k = coKey(r.c);
      if (sel && !sel.has(k)) continue;
      const o = by.get(k) || { company: k, total: 0, lines: {}, models: 0, days: new Set() };
      o.total += r.q; o.lines[l.line] = (o.lines[l.line] || 0) + r.q; if (r.q > 0) o.days.add(r.d);
      by.set(k, o); all += r.q;
    }
    for (const m of l.models || []) { const o = by.get(coKey(m.company)); if (o) o.models += 1; }
  }
  return [...by.values()]
    .map((o) => ({ ...o, days: o.days.size, share: all ? (o.total / all) * 100 : 0 }))
    .sort((a, b) => b.total - a.total || a.company.localeCompare(b.company));
}

/* ───────────── model filter (Main view) ───────────── */

/** Model list for the filter: one entry per model name (a model made on two lines is one entry), narrowed to the selected companies. */
export function modelOptions(lines, companies = []) {
  const sel = companies.length ? new Set(companies.map(coKey)) : null;
  const m = new Map();
  for (const l of lines || []) for (const md of l.models || []) {
    if (sel && !sel.has(coKey(md.company))) continue;
    const k = String(md.model);
    const o = m.get(k) || { value: k, label: `${k} · ${coKey(md.company)}`, count: 0, pcs: 0 };
    o.count += 1; o.pcs += md.qty || 0; m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.pcs - a.pcs || a.label.localeCompare(b.label));
}

/**
 * Lines limited to the selected model names (empty = unchanged). Daily, hourly (of hourDate) and the company split are
 * rebuilt from dhm [[date, hour, mmId, qty]], so every chart and total shows only those models. Rejections stay per day.
 */
export function filterLinesByModel(lines, models, hourDate) {
  if (!models?.length) return lines || [];
  const names = new Set(models.map(String));
  return (lines || []).map((l) => {
    if (!l.ok) return l;
    const ids = new Set((l.models || []).filter((m) => names.has(String(m.model))).map((m) => Number(m.mmId)));
    const dhm = (l.dhm || []).filter((r) => ids.has(Number(r[2])));
    const co = (id) => coKey(l.mmCo?.[String(id)]);
    const dq = new Map(), dco = new Map(), hq = new Map(), hco = new Map();
    for (const [d, h, m, q] of dhm) {
      dq.set(d, (dq.get(d) || 0) + q);
      const kc = `${d}\t${co(m)}`; dco.set(kc, (dco.get(kc) || 0) + q);
      if (d === hourDate) { hq.set(h, (hq.get(h) || 0) + q); const kh = `${h}\t${co(m)}`; hco.set(kh, (hco.get(kh) || 0) + q); }
    }
    const rej = new Map((l.daily || []).map((r) => [r.d, r.rej || 0]));
    const days = [...new Set([...dq.keys(), ...[...rej.entries()].filter(([, n]) => n > 0).map(([d]) => d)])].sort();
    return {
      ...l, modelFiltered: true, dhm,
      daily: days.map((d) => ({ d, q: dq.get(d) || 0, rej: rej.get(d) || 0 })),
      dailyCo: [...dco.entries()].map(([k, q]) => { const [d, c] = k.split('\t'); return { d, c, q }; }),
      hourly: [...hq.entries()].sort((a, b) => a[0] - b[0]).map(([h, q]) => ({ h, q })),
      hourlyCo: [...hco.entries()].map(([k, q]) => { const [h, c] = k.split('\t'); return { h: Number(h), c, q }; }),
      models: (l.models || []).filter((m) => names.has(String(m.model))),
    };
  });
}
