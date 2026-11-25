/**
 * 3D model view (24-11-2026, admin): every company and its models with the standard cycle time of the Model master and
 * the pieces made in the period. Pure functions — the page (pages/ModelUniversePage.jsx) draws them.
 */

const an = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cname = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase() || 'NO COMPANY';
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** cycle-time bands (seconds) — colour of a model by its standard cycle */
export const CYCLE_BANDS = [
  { id: 'fast', label: '≤ 15 s', max: 15, color: '#0EA5A4' },
  { id: 'std', label: '15–20 s', max: 20, color: '#2563EB' },
  { id: 'slow', label: '20–25 s', max: 25, color: '#F59E0B' },
  { id: 'vslow', label: '> 25 s', max: Infinity, color: '#E11D48' },
];
export const NO_STD = { id: 'none', label: 'No std cycle', color: '#94A3B8' };
export function bandOf(cycle) {
  const c = num(cycle);
  if (c == null) return NO_STD;
  return CYCLE_BANDS.find((b) => c <= b.max) || CYCLE_BANDS[CYCLE_BANDS.length - 1];
}
/** company colours: fixed order, never cycled into a new hue (more companies share by index) */
export const COMPANY_COLORS = ['#2563EB', '#0EA5A4', '#F59E0B', '#7C3AED', '#E11D48', '#16A34A', '#EA580C', '#0891B2', '#DB2777', '#65A30D', '#4F46E5', '#B45309'];

/**
 * The models of the period, one row per company + model (lines merged), with the master's std cycle.
 *   lines       all_lines answer per line: [{ line, models: [{ mmId, model, modelCode, company, qty, days, validCycles, avgCycle }] }]
 *   ids         the lines to count
 *   masterOf    (m) => master row or null  (utils/targetMethods masterAnyFor)
 *   masterRows  every master row (for "models in the master that did not run")
 *   withMaster  add the master's models that made no pieces in the period (on the chosen lines)
 */
export function buildUniverse({ lines = [], ids = [], masterOf = () => null, masterRows = [], withMaster = false }) {
  const want = new Set(ids.map(String));
  const M = new Map();
  const usedMaster = new Set();
  for (const L of lines) {
    const line = String(L?.line ?? '');
    if (!want.has(line)) continue;
    for (const m of L?.models || []) {
      const qty = Number(m?.qty) || 0;
      if (!m?.model || qty <= 0) continue;
      const company = cname(m.company);
      const key = `${an(company)}|${an(m.model)}`;
      let x = M.get(key);
      if (!x) {
        const mr = masterOf({ model: m.model, company: m.company, modelCode: m.modelCode }) || null;
        if (mr) usedMaster.add(mr);
        x = { key, company, model: String(m.model).trim(), code: m.modelCode || mr?.code || '', std: num(mr?.cycle), master: mr ? String(mr.model || '') : '',
          segment: mr?.segment || '', capacity: mr?.capacity || '', type: mr?.type || '', qty: 0, days: 0, lines: [], cyc: 0, cycN: 0 };
        M.set(key, x);
      }
      x.qty += qty;
      x.days += Number(m.days) || 0;
      if (!x.lines.includes(line)) x.lines.push(line);
      const n = Number(m.validCycles) || 0, a = num(m.avgCycle);
      if (a != null && n > 0) { x.cyc += a * n; x.cycN += n; }
    }
  }
  if (withMaster) {
    for (const r of masterRows || []) {
      if (!r?.model || usedMaster.has(r)) continue;
      const rl = (Array.isArray(r.lines) ? r.lines : []).map(String);
      if (rl.length && !rl.some((l) => want.has(l))) continue;
      const company = cname(r.company);
      const key = `${an(company)}|${an(r.model)}`;
      if (M.has(key)) continue;
      M.set(key, { key, company, model: String(r.model).trim(), code: r.code || '', std: num(r.cycle), master: String(r.model), segment: r.segment || '', capacity: r.capacity || '',
        type: r.type || '', qty: 0, days: 0, lines: rl.filter((l) => want.has(l)), cyc: 0, cycN: 0, masterOnly: true });
    }
  }
  const C = new Map();
  for (const x of M.values()) {
    const { cyc, cycN, ...rest } = x;
    const row = { ...rest, actual: cycN ? Math.round((cyc / cycN) * 10) / 10 : null, lines: [...x.lines].sort() };
    const c = C.get(x.company) || { name: x.company, qty: 0, models: [] };
    c.qty += row.qty; c.models.push(row); C.set(x.company, c);
  }
  const companies = [...C.values()].map((c) => {
    c.models.sort((a, b) => b.qty - a.qty || (a.std ?? 999) - (b.std ?? 999) || a.model.localeCompare(b.model));
    const w = c.models.filter((m) => m.std != null && m.qty > 0);
    const wq = w.reduce((t, m) => t + m.qty, 0);
    c.stdAvg = wq ? Math.round((w.reduce((t, m) => t + m.std * m.qty, 0) / wq) * 10) / 10
      : (c.models.some((m) => m.std != null) ? Math.round((c.models.filter((m) => m.std != null).reduce((t, m) => t + m.std, 0) / c.models.filter((m) => m.std != null).length) * 10) / 10 : null);
    return c;
  }).sort((a, b) => b.qty - a.qty || b.models.length - a.models.length || a.name.localeCompare(b.name));
  companies.forEach((c, i) => { c.color = COMPANY_COLORS[i % COMPANY_COLORS.length]; });
  return companies;
}

/** filters of the page: company, search text, cycle band, only with / without std */
export function filterUniverse(companies, { company = 'all', q = '', band = 'all' } = {}) {
  const t = an(q);
  return companies.map((c) => {
    if (company !== 'all' && c.name !== company) return null;
    const models = c.models.filter((m) => (!t || an(m.model).includes(t) || an(m.code).includes(t) || an(c.name).includes(t))
      && (band === 'all' || bandOf(m.std).id === band));
    return models.length ? { ...c, models, qty: models.reduce((a, m) => a + m.qty, 0) } : null;
  }).filter(Boolean);
}

/** tiles: companies, models, pieces, weighted std cycle, models without std */
export function universeTotals(companies) {
  const all = companies.flatMap((c) => c.models);
  const w = all.filter((m) => m.std != null && m.qty > 0); const wq = w.reduce((t, m) => t + m.qty, 0);
  return {
    companies: companies.length, models: all.length, qty: all.reduce((t, m) => t + m.qty, 0),
    std: wq ? Math.round((w.reduce((t, m) => t + m.std * m.qty, 0) / wq) * 10) / 10 : null,
    noStd: all.filter((m) => m.std == null).length, noStdQty: all.filter((m) => m.std == null).reduce((t, m) => t + m.qty, 0),
    ran: all.filter((m) => m.qty > 0).length,
  };
}

/**
 * Layout of the 3D city: one plate per company (a square grid of model towers), plates packed in rows.
 *   → { plates: [{ c, x, y, w, h, bars: [{ m, x, y }] }], width, height, size }   (px on the floor)
 */
export function layoutUniverse(companies, { bar = 28, gap = 12, pad = 16, label = 30, maxW = 1500, plateGap = 34, maxModels = 36, minW = 170 } = {}) {
  const plates = [];
  let x = 0, y = 0, rowH = 0, width = 0;
  for (const c of companies) {
    const ms = c.models.slice(0, maxModels);
    const cols = Math.max(1, Math.ceil(Math.sqrt(ms.length)));
    const rows = Math.max(1, Math.ceil(ms.length / cols));
    const inner = cols * bar + (cols - 1) * gap;
    const w = Math.max(minW, pad * 2 + inner);   // wide enough for the company name; the towers sit in the middle
    const off = (w - inner) / 2;
    const h = pad * 2 + rows * bar + (rows - 1) * gap + label;
    if (x > 0 && x + w > maxW) { x = 0; y += rowH + plateGap; rowH = 0; }
    plates.push({ c, x, y, w, h, more: c.models.length - ms.length,
      bars: ms.map((m, i) => ({ m, x: off + (i % cols) * (bar + gap), y: pad + Math.floor(i / cols) * (bar + gap) })) });
    x += w + plateGap; rowH = Math.max(rowH, h); width = Math.max(width, x - plateGap);
  }
  return { plates, width, height: y + rowH, size: bar };
}
