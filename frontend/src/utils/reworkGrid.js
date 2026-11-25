/**
 * 25-11-2026: Quality entry → "Rework / Rejection: all hours" (key = 'rework' or 'rejects') — the rework of a whole day in one grid, one row per
 * model · station · defect (· category …), one box per hour. Only the rework is written: each hour's rejection rows,
 * note and the loss part stay as they are (the server keeps the loss part of a 'quality' save).
 */
const KEYS = ['model', 'station', 'reason', 'cat', 'dept', 'cause', 'action', 'owner', 'part'];
const keyOf = (x) => KEYS.map((k) => String(x[k] || '')).join('|');

/** rows = hour rows of oleLineDay (r.hour, r.e = normEntry) → grid rows [{ id, model, station, reason, cat, dept, cause, action, owner, part, q: {h: n}, dis: {h: n}, disAll }] */
export function gridFromRows(rows = [], key = 'rework') {
  const m = new Map();
  for (const r of rows) for (const x of r.e?.[key] || []) {
    const k = keyOf(x);
    const o = m.get(k) || { id: `g${m.size + 1}`, ...Object.fromEntries(KEYS.map((key) => [key, x[key] || ''])), orig: `${x.station || ''}|${x.reason || ''}`, q: {}, dis: {} };
    o.q[r.hour] = (o.q[r.hour] || 0) + (Number(x.qty) || 0);
    if (Number(x.dismantle) > 0) o.dis[r.hour] = (o.dis[r.hour] || 0) + Number(x.dismantle);
    m.set(k, o);
  }
  const out = [...m.values()];
  for (const o of out) o.q0 = { ...o.q };   // as saved: a box left as it was is never refused
  for (const o of out) {
    o.disAll = Object.keys(o.q).length > 0 && Object.keys(o.q).every((h) => (o.dis[h] || 0) >= o.q[h]);
    const d = Object.values(o.dis).reduce((x, v) => x + v, 0);
    o.disN = o.disAll || !d ? '' : String(d);   // 25-11-2026: some of the pieces dismantled (a number), or all of them (disAll)
  }
  return out;
}

const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * 25-11-2026: the dismantled pieces of a row, hour by hour. disAll → every piece; disN (a number for the whole row) → the
 * hours keep what was saved, the rest goes to the first hours with pieces; nothing typed → as saved.
 */
export function disOf(g) {
  const hs = Object.keys(g.q || {}).map(Number).filter((h) => num(g.q[h]) > 0).sort((a, b) => a - b);
  const orig = g.dis || {};
  const kept = Object.fromEntries(hs.map((h) => [h, Math.min(num(g.q[h]), orig[h] || 0)]).filter(([, v]) => v > 0));
  if (g.disAll) return Object.fromEntries(hs.map((h) => [h, num(g.q[h])]));
  if (g.disN == null || g.disN === '' && !Object.keys(kept).length) return kept;
  const want = num(g.disN);
  if (want === Object.values(kept).reduce((a, v) => a + v, 0)) return kept;
  let left = want; const out = {};
  for (const h of hs) { const k = Math.min(kept[h] || 0, left); if (k) { out[h] = k; left -= k; } }
  for (const h of hs) { if (!left) break; const k = Math.min(num(g.q[h]) - (out[h] || 0), left); if (k > 0) { out[h] = (out[h] || 0) + k; left -= k; } }
  return out;
}

/** the rework rows of one hour as the grid has them (rows with a number only) */
export function reworkOfHour(grid, h, deptOf = () => '') {
  const out = [];
  for (const g of grid) {
    const qty = num(g.q[h]);
    if (!qty) continue;
    const dismantle = disOf(g)[h] || 0;
    out.push({
      station: g.station || '', model: g.model || '', reason: String(g.reason || '').trim(), dept: (g.dept && g.orig === `${g.station || ''}|${g.reason || ''}` ? g.dept : deptOf(g) || g.dept) || '', qty,
      ...(g.owner ? { owner: g.owner } : {}), ...(g.part ? { part: g.part } : {}),
      ...(g.cat ? { cat: g.cat } : {}), ...(g.cause ? { cause: g.cause } : {}), ...(g.action ? { action: g.action } : {}),
      ...(dismantle > 0 ? { dismantle } : {}),
    });
  }
  return out;
}

const canon = (list) => JSON.stringify(list.map((x) => [x.station || '', x.model || '', x.reason || '', x.dept || '', Number(x.qty) || 0, x.cat || '', x.cause || '', x.action || '', Number(x.dismantle) || 0, x.owner || '', x.part || '']).sort());

/**
 * the entries to save: only the hours whose rework changed. hours = the hours the grid shows.
 * → [{ date, line, hour, stops: [], losses: [], rejects (as saved), rework, note (as saved), noQ?, part: 'quality' }]
 */
export function gridEntries({ grid, rows, hours, date, line, deptOf = () => '', key = 'rework' }) {
  const out = [];
  for (const h of hours) {
    const r = rows.find((x) => x.hour === h);
    const e = r?.e || { rejects: [], rework: [], note: '' };
    const mine = reworkOfHour(grid, h, deptOf);
    if (canon(mine) === canon(e[key] || [])) continue;
    // 25-11-2026: the grid writes one kind (rework or rejection); the other kind of the hour is sent back as saved
    const rejects = key === 'rejects' ? mine : e.rejects || [];
    const rework = key === 'rework' ? mine : e.rework || [];
    out.push({
      date, line: Number(line), hour: h, stops: [], losses: [], rejects, rework, note: e.note || '',
      ...(e.noQ && !rejects.length && !rework.length ? { noQ: true } : {}),
      part: 'quality',
    });
  }
  return out;
}

/** what is wrong in the grid before a save: rows with a number need a station and a defect; a box may not pass the pieces the hour made */
export function gridProblems(grid, made = {}, modelQty = {}) {
  const p = [];
  grid.forEach((g, i) => {
    const any = Object.values(g.q).some((v) => num(v) > 0);
    if (!any) return;
    if (!g.station) p.push({ row: i, text: `Row ${i + 1}: choose the stage` });
    if (!String(g.reason || '').trim()) p.push({ row: i, text: `Row ${i + 1}: choose the defect` });
    const tot = Object.values(g.q).reduce((x, v) => x + num(v), 0);
    if (!g.disAll && num(g.disN) > tot) p.push({ row: i, text: `Row ${i + 1}: ${num(g.disN)} dismantled — the row has only ${tot} pcs` });
  });
  // as the hour form: one row cannot have more pieces than the hour made
  // a row of a model: not more than that model made in the hour (25-11-2026)
  grid.forEach((g, i) => {
    for (const [h, v] of Object.entries(g.q)) {
      if (g.q0 && num(g.q0[h]) === num(v)) continue;
      const lim = g.model && modelQty[g.model] ? modelQty[g.model][h] || 0 : made[h];
      if (num(v) > 0 && g.model && modelQty[g.model] && !lim) p.push({ row: i, hour: Number(h), text: `Row ${i + 1}, ${String(h).padStart(2, '0')}:00 — ${g.model} did not run this hour` });
      else if (lim > 0 && num(v) > lim) p.push({ row: i, hour: Number(h), text: `Row ${i + 1}, ${String(h).padStart(2, '0')}:00 — ${num(v)} pcs, ${g.model && modelQty[g.model] ? g.model : 'the hour'} made only ${lim}` });
    }
  });
  return p;
}
