/**
 * Two ways to set a model's target cycle from its own scan history (model_control.php gaps between pieces):
 *
 *   Method A — "most common cycle":   gaps above A.cap seconds (default 22 s: stops, changeovers, breaks) are left out;
 *              the target is the whole second in which the most pieces were made (the mode).
 *              Covered = pieces made at that speed or faster (their share of the pieces kept).
 *   Method C — "control chart":       the centre line of the control chart = mean of the gaps from 1 s up to A.cap seconds
 *              (same window as Control charts, default 1–22 s), to 0.1 s. Covered = pieces made at that speed or faster.
 *   Method B — "70 % rule":           the same valid scans as Method A and Control charts (gaps 1 s up to A.cap, default 22 s);
 *              the target is the smallest whole second within which B.pct % (default 70 %) of those pieces were made
 *              (= "70 % of valid cycles by …" on the Control charts page).
 *
 * Valid scans of every method = gaps from lowA (default 1 s: double scans / glitches below are eliminated) up to capA.
 * Method A target cycle = A second + addA (default 3 s allowance); B and C targets = their own cycle.
 * Target pieces per hour = 3600 ÷ target cycle. A is usually the strictest, B the most reachable, C (the average running speed) in between.
 */
import { achievedCycle } from './spc';
import { lossMatrix, sumLoss } from './money';
import { serverNow, serverToday } from './serverTime';

export const METHOD_DEFAULTS = { capA: 22, pctB: 70, minPieces: 20, addA: 3, lowA: 1 };

/** Smallest whole second S with share(ceil(gap) ≤ S) ≥ pct. */
export function percentileSecond(gaps, pct) {
  if (!gaps?.length) return null;
  const counts = new Map();
  for (const g of gaps) { const s = Math.max(0, Math.ceil(g)); counts.set(s, (counts.get(s) || 0) + 1); }
  const keys = [...counts.keys()].sort((a, b) => a - b);
  const need = (pct / 100) * gaps.length;
  let cum = 0;
  for (const k of keys) { cum += counts.get(k); if (cum >= need - 1e-9) return { sec: k, upTo: cum, share: (cum / gaps.length) * 100 }; }
  const k = keys[keys.length - 1];
  return { sec: k, upTo: gaps.length, share: 100 };
}

/** Both methods for one model of model_control.php. */
export function modelMethods(m, opts = {}) {
  const o = { ...METHOD_DEFAULTS, ...opts };
  const all = [];
  let qty = 0, days = 0;
  for (const d of Object.values(m.days || {})) { qty += Number(d.q) || 0; if ((Number(d.q) || 0) > 0) days++; for (const g of d.g || []) all.push(g); }
  const low = Number.isFinite(Number(o.lowA)) ? Number(o.lowA) : 1;
  const a = all.filter((g) => g >= low && g <= o.capA);
  const b = a;   // Method B uses the same valid scans (gaps lowA..capA) as Method A and Control charts
  const out = { mmId: m.mmId, model: m.model, modelCode: m.modelCode, company: m.company, line: m.line, qty, days, gaps: all.length,
    low, cap: o.capA, belowLow: all.filter((g) => g < low).length, aboveCap: all.filter((g) => g > o.capA).length, valid: a.length };
  out.avg = a.length ? a.reduce((s, g) => s + g, 0) / a.length : null;           // average running cycle (gaps ≤ cap)
  out.avgPph = out.avg ? 3600 / out.avg : null;
  if (a.length < o.minPieces) { out.A = null; out.B = null; out.C = null; out.tooFew = true; return out; }
  const ach = achievedCycle(a);
  const tA = ach.sec > 0 ? ach.sec + (Number(o.addA) || 0) : null;   // target cycle = A + allowance
  out.A = { sec: ach.sec, target: tA, add: Number(o.addA) || 0, pph: tA ? 3600 / tA : null, upTo: ach.upTo, share: ach.upToShare, kept: a.length, removed: all.length - a.length };
  const p = percentileSecond(b, o.pctB);
  out.B = p ? { sec: p.sec, pph: p.sec > 0 ? 3600 / p.sec : null, upTo: p.upTo, share: p.share, kept: b.length } : null;
  const cSec = Math.round(out.avg * 10) / 10;
  const cUp = a.filter((g) => g <= cSec).length;
  out.C = cSec > 0 ? { sec: cSec, pph: 3600 / cSec, upTo: cUp, share: (cUp / a.length) * 100, kept: a.length } : null;
  out.diffPct = out.A?.pph && out.B?.pph ? ((out.A.pph - out.B.pph) / out.B.pph) * 100 : null;   // how much stricter A is
  return out;
}

/** All models: rows sorted by quantity. models = controlData(All) models (mmId may be "L2-123"). */
export function methodRows(models, opts = {}) {
  return (models || []).map((m) => modelMethods({ ...m, mmId: String(m.mmId).replace(/^L\d+-/, '') }, opts)).sort((x, y) => y.qty - x.qty);
}

/** Targets object {mmId: {cycle}} of one line from a method ('A' | 'B' | 'C'). */
export function targetsOf(rows, line, method) {
  const t = {};
  for (const r of rows) if (String(r.line) === String(line) && r[method]?.sec > 0) t[String(r.mmId)] = { cycle: method === 'A' ? (r.A.target ?? r.A.sec) : r[method].sec, model: r.model, company: r.company || '' };
  return t;
}

/*
 * Method D = the cycle time of the Model master (Setup → Masters / Model master) + allowance (normally 0).
 * A model is found in the master by its material code (ModelCode), else company + model name, else model name.
 * A model that is not in the master (or has no cycle time there) has NO target on a Method D line (shown as "—").
 */
const an = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');                 // letters and digits only
const baseOf = (s) => an(String(s || '').split(/[/\\(]|\s{1,}(?=[A-Z]{2,}\b)/)[0]);          // the part before "/", "\\", "(" …
let MASTER = null;
let MASTER_AT = null;
/** The model master rows used by Method D (loaded by useAutoTargets / the target pages). */
let MASTER_ALL = null;   // every row, with or without a cycle time (details of a model: segment, "in the master without a cycle")
function indexOf(rows, needCycle) {
  const list = []; const byCode = new Map(); const byA = new Map();
  for (const r of rows || []) {
    if (needCycle && !(Number(r?.cycle) > 0)) continue;
    if (!r?.model) continue;
    const x = { r, comp: an(r.company), a: an(r.model), base: baseOf(r.model) };
    list.push(x);
    if (r.code && !byCode.has(an(r.code))) byCode.set(an(r.code), r);
    if (!byA.has(x.a)) byA.set(x.a, []); byA.get(x.a).push(x);
  }
  return { list, byCode, byA, memo: new Map() };
}
export function setMasterRows(rows, updatedAt = null) {
  MASTER = indexOf(rows, true); MASTER_ALL = indexOf(rows, false); MASTER_AT = updatedAt;
}
export const masterLoadedAt = () => MASTER_AT;
export const masterReady = () => !!MASTER;
/** most common cycle of the candidates (same company first) */
function pickOf(c, comp) {
  const same = comp ? c.filter((x) => x.comp === comp) : [];
  const use = same.length ? same : c;
  if (!use.length) return null;
  const n = new Map(); for (const x of use) n.set(Number(x.r.cycle) || 0, (n.get(Number(x.r.cycle) || 0) || 0) + 1);
  const cyc = [...n.entries()].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0][0];
  return use.find((x) => (Number(x.r.cycle) || 0) === cyc).r;
}
/**
 * The master row of a line model ({model, company, modelCode}) or null. The names on the line and in the master are
 * often written a little differently (WT11A4260GD ↔ WT11A4260GD/TL, 85DGRG/FLRB5 ↔ WTT85DGRG/FLRB5, "\\" ↔ "/",
 * MWMSA120GDXKG ↔ MWMSA120GDX(KG) BK HGL), so the match goes step by step:
 *   1 material code = line model code · 2 same letters + digits · 3 master name starts with the line name
 *   4 same part before "/" (or one ends with the other) — always the same company when the company is known.
 * Several candidates: the most common cycle time among them.
 */
function matchIn(M, m) {
  if (!M || !m) return null;
  const a = an(m.model); const comp = an(m.company);
  const key = `${an(m.modelCode)}|${comp}|${a}`;
  if (M.memo.has(key)) return M.memo.get(key);
  let hit = (m.modelCode && M.byCode.get(an(m.modelCode))) || null;
  if (!hit && a) hit = pickOf(M.byA.get(a) || [], comp);
  const okComp = (x) => !comp || !x.comp || x.comp === comp || x.comp.startsWith(comp) || comp.startsWith(x.comp);
  if (!hit && a.length >= 6) hit = pickOf(M.list.filter((x) => okComp(x) && x.a.startsWith(a)), comp);
  if (!hit) {
    const b = baseOf(m.model);
    if (b.length >= 5) hit = pickOf(M.list.filter((x) => okComp(x) && x.base.length >= 5 && (x.base === b || x.base.endsWith(b) || b.endsWith(x.base))), comp);
  }
  if (!hit && a.length >= 6) hit = pickOf(M.list.filter((x) => okComp(x) && x.a.length >= 6 && a.startsWith(x.a)), comp);
  M.memo.set(key, hit || null);
  return hit || null;
}
/** The master row with a cycle time (Method D target) of a line model, or null. */
export const masterFor = (m) => matchIn(MASTER, m);
/**
 * 21-11-2026: Method D target straight from the master for a model the line's worked-out targets do not have yet
 * (a Line 3 / 4 model list that did not come from its server, a browser with no kept set). The rule in force is handed
 * over by useAutoTargets (setFallbackRule). → cycle s, or null (line not on Method D that day / model not in the master).
 */
let FB_RULE = null;
export const setFallbackRule = (rule) => { FB_RULE = rule || null; };
export function masterTargetOf(line, m, date = null) {
  if (!FB_RULE || !MASTER || !m) return null;
  let cfg; try { cfg = lineCfg(FB_RULE, line, date); } catch { return null; }
  if (cfg?.method !== 'D') return null;
  const r = masterFor({ model: m.model, company: m.companyTitle || m.company, modelCode: m.modelCode });
  return r && Number(r.cycle) > 0 ? Math.round((Number(r.cycle) + (Number(cfg.add) || 0)) * 10) / 10 : null;
}
/**
 * 27-11-2026: the live screens — a model running on a Method D line whose target is not in the line's set yet (Line 3 / 4
 * model list late, a browser with an old set) takes its cycle straight from the master, as OLE already does.
 * models = [{ mmId, model, company | companyTitle, modelCode }] → the same targets object when nothing is added.
 */
export function withMasterFallback(targets, line, models) {
  let out = targets || {};
  for (const m of models || []) {
    if (!m || m.mmId == null || Number(out?.[String(m.mmId)]?.cycle) > 0) continue;
    const c = masterTargetOf(line, m);
    if (c > 0) { if (out === targets || out === undefined) out = { ...(targets || {}) }; out[String(m.mmId)] = { cycle: c, model: m.model, company: m.companyTitle || m.company || '', method: 'D', source: 'master-fallback' }; }
  }
  return out;
}
/** The master row of a line model even without a cycle time (its details), or null when it is not in the master at all. */
export const masterAnyFor = (m) => matchIn(MASTER_ALL, m) || matchIn(MASTER, m);

/** { method, add, pct } of one setting (a line's starting method or a dated change) */
function cfgOf(c, rule) {
  const method = ['A', 'B', 'C', 'D'].includes(c?.method) ? c.method : 'A';
  const add = Number.isFinite(Number(c?.add)) && c?.add !== '' && c?.add != null ? Number(c.add) : (method === 'A' ? Number(rule?.add ?? 3) : 0);
  const pct = Number.isFinite(Number(c?.pct)) && c?.pct ? Number(c.pct) : 70;
  return { method, add, pct };
}
const dayBefore = (s) => { const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/**
 * 20-11-2026: target method by date. The method periods of one line: [{ from, to, method, add, pct, note }]
 * (from null = since always, to null = from then on). The line's starting method (rule.lines) holds until its first
 * dated change (rule.plan); each change holds until the next change of the same line.
 */
export function linePeriods(rule, line) {
  const l = String(line);
  const changes = (rule?.plan || []).filter((p) => String(p.line) === l).sort((a, b) => a.from.localeCompare(b.from));
  const out = [{ from: null, to: null, ...cfgOf(rule?.lines?.[l] || {}, rule), start: true }];
  for (const p of changes) {
    const last = out[out.length - 1];
    last.to = dayBefore(p.from);
    out.push({ from: p.from, to: null, ...cfgOf(p, rule), ...(p.note ? { note: p.note } : {}) });
  }
  return out;
}
/** Settings of one line from the target rule on a day (default: today): { method: 'A'|'B'|'C'|'D', add, pct }. */
export function lineCfg(rule, line, date = null) {
  const d = date || serverToday();
  const P = linePeriods(rule, line);
  const p = P.find((x) => (!x.from || d >= x.from) && (!x.to || d <= x.to)) || P[P.length - 1];
  return { method: p.method, add: p.add, pct: p.pct };
}
/** same setting? */
export const sameCfg = (a, b) => !!a && !!b && a.method === b.method && Number(a.add) === Number(b.add) && (a.method !== 'B' || Number(a.pct) === Number(b.pct));

/** Method options of one line (gap limit, min gaps from the rule; allowance and B % from the line). */
export const lineOpts = (rule, cfg) => ({ capA: rule?.cap ?? METHOD_DEFAULTS.capA, lowA: rule?.low ?? METHOD_DEFAULTS.lowA, minPieces: rule?.min ?? METHOD_DEFAULTS.minPieces, addA: cfg.add, pctB: cfg.pct });

/** Target cycle of one model row with a method + allowance: A = A second + add, B = B second + add, C = average + add. */
export function cycleBy(r, method, add = 0) {
  if (method === 'D') {
    const mm = masterFor(r);
    return mm ? Math.round((Number(mm.cycle) + (Number(add) || 0)) * 10) / 10 : null;   // not in the master: no target
  }
  const m = r?.[method];
  if (!(m?.sec > 0)) return null;
  return Math.round((m.sec + (Number(add) || 0)) * 10) / 10;
}

/**
 * Model rows of one line worked out with that line's own settings (allowance, B %).
 * models = controlData(All) models (each has .line).
 */
export function lineRows(models, rule, line) {
  const cfg = lineCfg(rule, line);
  return methodRows((models || []).filter((m) => String(m.line) === String(line)), lineOpts(rule, cfg));
}

/** Targets {mmId: {cycle, model, company, method}} of one line with its chosen method (or `method` / `add` to try another). */
export function lineTargets(models, rule, line, override = null, lineModels = null) {
  const cfg = { ...lineCfg(rule, line), ...(override || {}) };
  const rows = methodRows((models || []).filter((m) => String(m.line) === String(line)), lineOpts(rule, cfg));
  const t = {};
  for (const r of rows) {
    const c = cycleBy(r, cfg.method, cfg.add);
    if (c > 0) t[String(r.mmId)] = { cycle: c, model: r.model, company: r.company || '', method: cfg.method };
  }
  // Method D: every model of the line that is in the master gets its target, also one with no scans in the data window
  if (cfg.method === 'D') {
    for (const m of lineModels || []) {
      const id = String(m.mmId); if (t[id]) continue;
      const mm = masterFor({ model: m.model, company: m.companyTitle || m.company, modelCode: m.modelCode });
      if (mm) t[id] = { cycle: Math.round((Number(mm.cycle) + (Number(cfg.add) || 0)) * 10) / 10, model: m.model, company: m.companyTitle || m.company || '', method: 'D' };
    }
  }
  return t;
}

/**
 * Period result of every line with three targets side by side: the saved targets, Method A and Method B.
 *   lines = all_lines.php lines (dhm), settings = {line: {shift, targets, money}}, rows = methodRows(...)
 * → [{ line, name, ok, actual, saved:{target,pct,short,rsTotal}, A:{…}, B:{…} }]
 * now = DB server ka time (serverNow), browser ka clock nahi.
 */
export function lineComparison(lines, settings, rows, { now = serverNow(), range = null } = {}) {
  const ok = (lines || []).filter((l) => l.ok);
  const mk = (method) => Object.fromEntries(ok.map((l) => [l.line, { ...(settings?.[l.line] || {}), targets: method ? targetsOf(rows, l.line, method) : (settings?.[l.line]?.targets || {}) }]));
  const pick = (mx, line) => mx.lines.find((x) => x.line === line)?.total || sumLoss([]);
  // saved = the targets in force (each day with the method of that day: target method by date); A … D = one method on every day
  const mS = lossMatrix(ok, mk(null), { now, range });
  const M = ['A', 'B', 'C', 'D'].filter((m) => m !== 'D' || (rows || []).some((r) => r.D));   // D: rows with the Model master cycle (r.D)
  const mx = Object.fromEntries(M.map((m) => [m, lossMatrix(ok, Object.fromEntries(Object.entries(mk(m)).map(([k, v]) => [k, { ...v, targetPeriods: undefined }])), { now, range })]));
  const part = (t) => ({ target: t.target, pct: t.pct, short: t.short, lostSec: t.lostSec, rsTotal: t.rsTotal, actualPlanned: t.actualPlanned });
  const out = ok.map((l) => ({ line: l.line, name: l.name, actual: pick(mS, l.line).actual, saved: part(pick(mS, l.line)), ...Object.fromEntries(M.map((m) => [m, part(pick(mx[m], l.line))])) }));
  const tot = (x) => part(x.grand);
  return { lines: out, methods: M, total: { line: 'all', name: 'All lines', actual: mS.grand.actual, saved: tot(mS), ...Object.fromEntries(M.map((m) => [m, tot(mx[m])])) } };
}