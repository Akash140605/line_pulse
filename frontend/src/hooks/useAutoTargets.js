import { useEffect, useState } from 'react';
import { api, LINE_IDS } from '../api';
import { lineTargets, lineCfg, linePeriods, sameCfg, setMasterRows, masterLoadedAt, masterReady, setFallbackRule } from '../utils/targetMethods';
import { normalizeRule, normalizeUi, ruleKeyOf, ruleStart, ruleEnd } from '../utils/uiSettings';
import { serverToday, syncServerTime, isServerTimeSynced } from '../utils/serverTime';

/**
 * Automatic targets: every model's target cycle = the method chosen for its line (Line target method page: A most common,
 * B % rule, C average) + that line's allowance, worked out from its scans since the rule's start date
 * (default 1 Aug 2026, gaps 1–22 s, at least 20 of them). Default: Method A + 3 s on every line.
 * The rule is set on the Target rule & check page (ui_settings.json → targetRule) and is the same for every screen.
 * Every screen (Main, All lines, Plant overview, line pages, loss) uses these through useLineSettings / useAllLineSettings.
 * A model with too few scans keeps its saved target; a target the admin locked ("manual") always wins.
 *
 * Worked out once and shared by every view on the page; kept in the browser for 6 h (or until the rule changes).
 * "Today" = DB server ki date (serverToday), browser ka clock nahi.
 */
const KEY = 'ems.autoTargets.v3';
const TTL_MS = 6 * 3600 * 1000;
// a partial set (master / a line's model list missing) is worked out again in a minute; with every line on Method D
// (light: the master + the lines' model lists) every 10 minutes, so a model new on a line gets its target the same shift
const ttlOf = (m) => (m?.partial ? (m.onlyD ? 45 : 300) * 1000 : m?.onlyD ? 10 * 60 * 1000 : TTL_MS);
export const AUTO_EVENT = 'ems:auto-targets';
const UI_EVENT = 'ems:ui-settings';

let mem = null;
let inflight = null;
const subs = new Set();
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 19-11-2026: the last non-empty Method D targets of every line, kept apart from the rule-keyed cache. A Line 3 / 4
// server that answers slowly (or a first load still running) never leaves the line with no target at all.
const GOOD_KEY = 'ems.autoTargets.goodD';
let goodMem = null;
const readGood = () => { if (!goodMem) { try { goodMem = JSON.parse(localStorage.getItem(GOOD_KEY) || 'null') || {}; } catch { goodMem = {}; } } return goodMem; };
/** The last good Method D targets of one line ({} when none yet). */
export const goodD = (line) => readGood()[String(line)] || {};
const keepGood = (byLine, dLines) => {
  const g = { ...readGood() }; let changed = false;
  for (const l of dLines) if (Object.keys(byLine[l] || {}).length) { g[String(l)] = byLine[l]; changed = true; }
  if (changed) { goodMem = g; try { localStorage.setItem(GOOD_KEY, JSON.stringify(g)); } catch { /* storage blocked */ } }
};
const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
/** The rule in force: from the screen setup the app keeps in the browser (useUiSettings), else the default. */
export function currentRule() {
  try { return normalizeRule(JSON.parse(localStorage.getItem('ems.ui') || 'null')?.targetRule); } catch { return normalizeRule(null); }
}
const ruleKey = ruleKeyOf;
/** Method options of a rule (utils/targetMethods.js). */
export const ruleOpts = (r) => ({ capA: r.cap, lowA: r.low ?? 1, addA: r.add, minPieces: r.min });

/**
 * A model that has too few clean gaps on its own line (new on that line, or the line runs slower than the gap limit)
 * gets the target the same model (same company + name) has on another line, marked `from: 'Line N'`.
 */
export function fillFromOtherLines(byLine, models, skip = []) {
  const key = (t) => `${String(t.company || '').trim().toUpperCase()}|${String(t.model || '').trim().toUpperCase()}`;
  const known = new Map();
  for (const [l, ts] of Object.entries(byLine)) for (const t of Object.values(ts)) if (t?.cycle > 0 && !known.has(key(t))) known.set(key(t), { ...t, line: l });
  for (const m of models || []) {
    const l = String(m.line); const id = String(m.mmId);
    if (!byLine[l] || byLine[l][id] || skip.includes(l)) continue;   // a Method D line takes only the master
    const o = known.get(key(m));
    if (o && o.line !== l) byLine[l][id] = { cycle: o.cycle, model: m.model, company: m.company || '', method: o.method, from: `Line ${o.line}` };
  }
  return byLine;
}

/** Method D: the model master is read (again) before the targets; its save time is part of the cache key. */
let masterAskedAt = 0;
export async function loadMaster() {
  // asked at most once a minute (the 30 s target check of every screen read it each time: ~2 reads a minute a PC)
  if (Date.now() - masterAskedAt < 60_000 && masterLoadedAt()) return masterLoadedAt();
  masterAskedAt = Date.now();
  try { const j = await api.modelMaster(); setMasterRows(j?.rows || [], j?.updatedAt || null); return j?.updatedAt || null; } catch { return masterLoadedAt(); }
}
// 20-11-2026: every method period of a line counts (target method by date): a line on Method D now that used Method A
// before still needs the scans for its Method A days
const usesD = (rule) => LINE_IDS.some((l) => linePeriods(rule, l).some((p) => p.method === 'D'));
const onlyD = (rule) => LINE_IDS.every((l) => linePeriods(rule, l).every((p) => p.method === 'D'));
const dated = (rule) => (rule?.plan || []).length > 0;

/**
 * The target rule from the SERVER: every login (admin, management, TV) works its targets out with the rule
 * the admin saved — never with an old copy in this browser or the default (a TV login never opened the setup, so its
 * browser had no rule and fell back to Method A). The server copy is kept here too; offline: the kept copy.
 */
let ruleAt = 0;
async function serverRule() {
  if (Date.now() - ruleAt < 60_000) return currentRule();
  try {
    const j = await api.uiSettings();
    if (j) {
      const n = normalizeUi(j);
      try { localStorage.setItem('ems.ui', JSON.stringify(n)); } catch { /* storage blocked */ }
      ruleAt = Date.now();
      return normalizeRule(n.targetRule);
    }
  } catch { /* server not reachable: the kept rule */ }
  return currentRule();
}

/** Is this line on Method D (by the targets worked out, else by the rule in force)? */
export const isLineD = (auto, line) => (auto?.methods?.[String(line)]?.method ?? lineCfg(currentRule(), line).method) === 'D';

export function loadAutoTargets(force = false) {
  if (!mem) mem = readLocal();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const rule = await serverRule();
      setFallbackRule(rule);   // Method D: a model missing from a line's set takes the master's cycle (utils/ole.js)
      const key = ruleKey(rule);
      // no line on Method D: the cached targets are used while the rule is the same (6 h)
      const sameDay = (m) => !dated(rule) || m?.day === serverToday();   // a dated change can start today
      if (!force && !usesD(rule) && mem && mem.rule === key && sameDay(mem) && Date.now() - mem.at < ttlOf(mem)) { inflight = null; return mem; }
      // Method D: the master is read first
      const mAt = usesD(rule) ? await loadMaster() : null;
      if (!force && mem && mem.rule === key && sameDay(mem) && (mem.masterAt || null) === (mAt || null) && Date.now() - mem.at < ttlOf(mem)) { inflight = null; return mem; }
      if (!isServerTimeSynced()) await syncServerTime();
      const today = serverToday();
      const to = ruleEnd(rule, today);   // fixed window (e.g. 01-08 → 31-10): later months do not change the targets
      const from = ruleStart(rule, today);
      // every line on Method D: the targets come from the master and the lines' model lists only — the heavy read of
      // every scan since the start date is not needed (targets ready in a second, on every screen and TV)
      const j = onlyD(rule) ? { models: [] } : await api.controlDataAll(from, to, { cap: Math.max(60, rule.cap) });
      // every line with its own method (Line target method page): A / B / C + that line's allowance
      // Method D lines: the line's whole model list (a model of the master with no scans in the window still gets its target)
      const dLines = LINE_IDS.filter((l) => lineCfg(rule, l).method === 'D');
      // lines that use Method D on some days (target method by date): their model lists are needed too
      const dAny = LINE_IDS.filter((l) => linePeriods(rule, l).some((p) => p.method === 'D'));
      // a line server that does not answer at once is asked once more (Line 3 / 4 sit on their own servers)
      const listOf = (l) => api.lineModels(l).catch(() => new Promise((ok) => setTimeout(ok, 1500)).then(() => api.lineModels(l)).catch(() => null));
      const lists = await Promise.all(dAny.map(listOf));
      const lm = Object.fromEntries(dAny.map((l, i) => [l, Array.isArray(lists[i]) ? lists[i] : (lists[i]?.models || null)]));
      const missed = [];
      const byLine = Object.fromEntries(LINE_IDS.map((l) => {
        // a D line whose model list did not come: its last targets of the same rule stay (nothing old of another rule)
        // the same when the master could not be read (no master in this browser yet): never an empty set for hours
        const kept0 = mem?.rule === key ? (mem.byLine?.[l] || {}) : {};
        const kept = dLines.includes(l) && !Object.keys(kept0).length ? goodD(l) : kept0;
        if (dLines.includes(l) && ((!lm[l] && onlyD(rule)) || !masterReady())) return [l, kept];
        const t = lineTargets(j?.models, rule, l, null, lm[l]);
        // 19-11-2026: a line whose server did not answer this time (its data missing: no target at all) keeps its last
        // targets of the same rule — Line 3 / 4 targets no longer vanish now and then
        // (a D line whose model list came back empty counts as not answered too: its last good set stays)
        if (!Object.keys(t).length && (Object.keys(kept0).length || (dLines.includes(l) && !(lm[l] || []).length))) { missed.push(l); return [l, kept]; }
        // a D line without its model list: the models of the data window, plus the last targets of the models not in it
        return [l, dLines.includes(l) && !lm[l] ? { ...kept, ...t } : t];
      }));
      // part of the targets could not be worked out (master or a line's model list missing): try again in a minute, not in 6 h
      const partial = missed.length > 0 || (dLines.length > 0 && (!masterReady() || dLines.some((l) => !lm[l])));
      fillFromOtherLines(byLine, j?.models, dLines);
      keepGood(byLine, dLines);
      const methods = Object.fromEntries(LINE_IDS.map((l) => [l, lineCfg(rule, l)]));
      // 20-11-2026: target method by date — the targets of every method period of a line (the period of today = byLine);
      // a day is counted against the targets of the method in force that day (utils/targetPeriods.js)
      const periods = {};
      for (const l of LINE_IDS) {
        const P = linePeriods(rule, l);
        if (P.length < 2) continue;
        periods[l] = P.map((p) => ({ from: p.from, to: p.to, method: p.method, add: p.add, pct: p.pct,
          targets: sameCfg(p, methods[l]) ? byLine[l] : lineTargets(j?.models, rule, l, { method: p.method, add: p.add, pct: p.pct }, lm[l]) }));
      }
      mem = { at: Date.now(), day: today, partial, onlyD: onlyD(rule), rule: key, masterAt: mAt || null, from, to, add: rule.add, cap: rule.cap, low: rule.low, min: rule.min, methods, byLine, periods };
      try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* storage blocked */ }
      subs.forEach((f) => f(mem));
      try { window.dispatchEvent(new Event(AUTO_EVENT)); } catch { /* old browser */ }
    } catch { /* server not reachable: keep the last known targets */ }
    inflight = null;
    return mem;
  })();
  return inflight;
}

/** { at, from, to, add, cap, min, byLine: { [line]: { [mmId]: { cycle, model, company } } } } or null while loading. */
export default function useAutoTargets() {
  setFallbackRule(currentRule());
  // a kept copy is shown at once only when it was made with the rule in force (never targets of another method)
  const [v, setV] = useState(() => { const k = mem || readLocal(); return k && k.rule === ruleKey(currentRule()) ? k : null; });
  useEffect(() => {
    subs.add(setV);
    const go = () => loadAutoTargets().then((x) => { if (x) setV(x); });
    // the targets are worked out from every scan since the rule's start date — a heavy read. When the kept copy is
    // still good it is used at once; otherwise the page's own numbers are read first and the targets a little later.
    const kept = mem || readLocal();
    const good = kept && kept.rule === ruleKey(currentRule()) && Date.now() - kept.at < ttlOf(kept);
    const t0 = setTimeout(go, good || onlyD(currentRule()) ? 0 : kept ? 12000 : 4000);   // Method D everywhere: light, at once
    window.addEventListener(UI_EVENT, go);          // the rule was changed on the Target rule & check page
    const goNow = () => loadAutoTargets(true).then((x) => { if (x) setV(x); });
    window.addEventListener('ems:target-rule', goNow);   // the server's rule differs from the kept one (useUiSettings)
    const id = setInterval(() => { if (!document.hidden) loadAutoTargets(); }, 30 * 60 * 1000);
    // a partial set or Method D everywhere: checked every 30 s (loadAutoTargets reads again only when its time is up)
    const id2 = setInterval(() => { if (!document.hidden && (mem?.partial || mem?.onlyD)) loadAutoTargets().then((x) => { if (x) setV(x); }); }, 30 * 1000);
    return () => { subs.delete(setV); window.removeEventListener(UI_EVENT, go); window.removeEventListener('ems:target-rule', goNow); clearInterval(id); clearInterval(id2); clearTimeout(t0); };
  }, []);
  return v;
}

/**
 * Target in force per model: the saved target, replaced by the automatic one (Method A + allowance),
 * except a target the admin locked (manual: true), which always wins.
 */
export function mergeTargets(saved, auto, onlyAuto = false) {
  // Method D line (onlyAuto): only the master's targets (and targets the admin locked) — a model not in the master has none
  if (onlyAuto) {
    const o = { ...(auto || {}) };
    // a target locked from the master counts only while the master still has a cycle for it
    for (const [id, t] of Object.entries(saved || {})) if (t?.manual && (t.source !== 'master' || o[id])) o[id] = t;
    return o;
  }
  const out = { ...(saved || {}), ...(auto || {}) };
  // a saved target of this line beats one borrowed from another line; a locked ("manual") one always wins
  for (const [id, t] of Object.entries(saved || {})) if (t?.manual || (t?.cycle > 0 && auto?.[id]?.from)) out[id] = t;
  return out;
}

/** Where the target in force of one model comes from: 'manual' | 'auto' | 'saved' | null. */
export function targetSource(saved, auto, id) {
  const s = saved?.[id], a = auto?.[id];
  if (s?.manual) return s.source === 'master' ? 'master' : 'manual';
  if (a) return 'auto';
  return s ? 'saved' : null;
}