/**
 * Rejection analysis and Rework analysis: the quality rows of the Loss entry page (station, model, defect, pieces)
 * as drill-down facts (utils/drill.js buildFacts), with the pieces the lines made for the rates. Pure — tested in
 * tests/qdrill.calc.test.js, so every number on the two pages can be checked by hand.
 *
 *   rate %  = pieces rejected (or reworked) ÷ pieces made × 100, in the same line / day / hour / model slice
 *   PPM     = the same per million pieces made
 * Production is not split by station, defect or department: for those the rate is against all the pieces made in the
 * slice (every piece passes every station) — "of the pieces made".
 */
import { stationLookup, normStation } from './ole';
import { bucketOf } from './drill';

/** The two pages: the fact kind they analyse and the words they use. */
export const QKINDS = {
  reject: { id: 'reject', page: 'rejan', label: 'Rejection', title: 'Rejection analysis', done: 'rejected', field: 'rejects', other: 'rework' },
  rework: { id: 'rework', page: 'rwkan', label: 'Rework', title: 'Rework analysis', done: 'reworked', field: 'rework', other: 'reject' },
};
export const qkindOf = (k) => QKINDS[k] || QKINDS.reject;

export const NO_STATION = 'Station not given';

/**
 * The facts of one kind, ready for the quality pages: the station as the admin's station (a row written with a code or an
 * old name finds it), its short label, and the defect (= the reason of the row).
 */
export function qualityFacts(facts = [], kind = 'reject', stationList = []) {
  const look = stationLookup(stationList || []);
  const byCode = new Map((stationList || []).map(normStation).filter((x) => x.reason && x.code).map((x) => [x.code.toLowerCase(), x]));
  return facts.filter((f) => f.kind === kind && !f.pseudo).map((f) => {
    const w = String(f.station || '').toLowerCase();
    const st = look.get(w) || byCode.get(w);
    const station = st?.reason || f.station || NO_STATION;
    return { ...f, station, stationCode: st?.code || '', defect: f.reason };
  });
}

/** Short name of a station on the page: its code, else the name without the "(…)" part. */
export function stationShort(name, stationList = []) {
  if (!name || name === NO_STATION) return name || NO_STATION;
  const st = stationLookup(stationList || []).get(String(name).toLowerCase());
  return st?.code || String(st?.reason || name).replace(/\s*\(.*\)\s*$/, '');
}

/**
 * Pieces made, one row per line × day × hour × model, from oleRange(…).days (lines that answered; hours to come left out).
 * Pieces of an hour that no model claims (old data without model detail) get model ''.
 */
export function prodRows(days = [], ids = []) {
  const out = [];
  for (const d of days || []) {
    for (const l of ids || []) {
      const L = d.byLine?.[l];
      if (!L || L.ok === false) continue;
      for (const r of L.rows || []) {
        if (r.future) continue;
        const qty = Number(r.qty) || 0;
        if (!qty) continue;
        let left = qty;
        for (const m of r.models || []) {
          const q = Number(m.quantity) || 0;
          if (q <= 0) continue;
          out.push({ date: d.date, line: String(l), hour: Number(r.hour), model: String(m.model || ''), qty: q });
          left -= q;
        }
        if (left > 0) out.push({ date: d.date, line: String(l), hour: Number(r.hour), model: '', qty: left });
      }
    }
  }
  return out;
}

/** The filters that cut production (the others — station, defect, department, owner — do not). */
export const PROD_DIMS = ['line', 'date', 'span', 'hour', 'model'];
const pkey = (p, dim) => (dim === 'line' ? p.line : dim === 'hour' ? String(p.hour) : dim === 'date' ? p.date : dim === 'model' ? p.model : null);

/** Production rows of a slice: inside [from, to] and passing its line / day / span / hour / model filters (but `skip`). */
export function prodIn(rows = [], { filters = [], from = '', to = '', skip = [] } = {}) {
  const fl = (filters || []).filter((f) => PROD_DIMS.includes(f.dim) && !skip.includes(f.dim));
  return rows.filter((p) => (!from || p.date >= from) && (!to || p.date <= to)
    && fl.every((f) => (f.dim === 'span' ? p.date >= f.value.from && p.date <= f.value.to : String(pkey(p, f.dim)) === String(f.value))));
}
export const madeOf = (rows = []) => rows.reduce((a, p) => a + (Number(p.qty) || 0), 0);
/** Pieces made per key of a production dimension (line / date / hour / model). */
export function madeBy(rows = [], dim = 'line') {
  const m = new Map();
  for (const p of rows) {
    const k = pkey(p, dim);
    if (k == null) continue;
    m.set(String(k), (m.get(String(k)) || 0) + (Number(p.qty) || 0));
  }
  return m;
}
/** Pieces made per bucket of the trend (day / week / month). */
export function madeByBucket(rows = [], grain = 'day') {
  const m = new Map();
  for (const p of rows) { const k = bucketOf(p.date, grain); m.set(k, (m.get(k) || 0) + (Number(p.qty) || 0)); }
  return m;
}

export const rateOf = (bad, made) => (made > 0 ? (bad / made) * 100 : null);
export const ppmOf = (bad, made) => (made > 0 ? (bad / made) * 1e6 : null);
/** 12.34 → "12.3%", 0.4213 → "0.42%", 0.0031 → "0.003%" (a small rate keeps its digits), 0 → "0%"; no production → "—". */
export const pctText = (v) => (v == null || !Number.isFinite(v) ? '—' : v === 0 ? '0%' : v >= 10 ? `${v.toFixed(1)}%` : v >= 0.1 ? `${v.toFixed(2)}%` : v >= 0.001 ? `${v.toFixed(3)}%` : '<0.001%');
export const ppmText = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString('en-IN')} PPM`);

/**
 * Groups (drill.js groupBy) with the pieces made and the rate: a production dimension (line / day / hour / model) against the
 * pieces of that key, any other (station, defect, department …) against all the pieces made in the slice.
 */
export function withRate(groups = [], dim, prod = [], sliceMade = 0) {
  const by = PROD_DIMS.includes(dim) ? madeBy(prod, dim === 'span' ? 'date' : dim) : null;
  return groups.map((g) => {
    if (g.others) return { ...g, made: null, rate: null };
    const made = by ? (by.get(String(g.key)) || 0) : sliceMade;
    return { ...g, made, rate: rateOf(g.value, made) };
  });
}

/** Totals of a slice for the tiles: pieces, entries, days, made, rate, PPM and the top defect / station / model. */
export function qualityKpis(facts = [], made = 0) {
  const total = facts.reduce((a, f) => a + (Number(f.value) || 0), 0);
  const top = (key) => {
    const m = new Map();
    for (const f of facts) { const k = f[key] || ''; m.set(k, (m.get(k) || 0) + (Number(f.value) || 0)); }
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
    return best ? { key: best[0], value: best[1], share: total ? (best[1] / total) * 100 : 0 } : null;
  };
  return {
    total, entries: facts.length, days: new Set(facts.map((f) => f.date)).size, lines: new Set(facts.map((f) => f.line)).size,
    made, rate: rateOf(total, made), ppm: ppmOf(total, made),
    topDefect: top('defect'), topStation: top('station'), topModel: top('model'),
  };
}
