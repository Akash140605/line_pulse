/**
 * 20-11-2026: AI analysis — what the loss / quality entries and the RCAs say (offline, pure).
 * entries / rca = ole.php of the look-back period (the app's own store). Week = the 7 days up to `today`, compared with
 * the 7 days before. Gives the reasons and defects that grow, the RCAs left open, the actions that did not work, and
 * actions for the "What to do" list.
 */
import { normEntry, rcaStatus, RCA_FROM } from './ole';
import { rcaEffect, addDaysYmd } from './rcaEffect';

const KINDS = [['losses', 'min', 'loss'], ['rejects', 'qty', 'reject'], ['rework', 'qty', 'rework']];

export function entryInsights({ entries = {}, rca = {}, today, ids = null, back = 90 } = {}) {
  const ok = (l) => !ids || ids.map(String).includes(String(l));
  const w1 = addDaysYmd(today, -6), w0 = addDaysYmd(today, -13), w0e = addDaysYmd(today, -7);
  const agg = new Map();          // kind|reason → { kind, reason, dept, unit, now, prev, lines:Set, stations:Map, dismantle }
  for (const [k, raw] of Object.entries(entries || {})) {
    const [date, line] = k.split('|');
    if (!date || date < w0 || date > today || !ok(line)) continue;
    const e = normEntry(raw);
    for (const [field, num, kind] of KINDS) {
      for (const x of e[field] || []) {
        const v = Number(x[num]) || 0; if (!(v > 0)) continue;
        const key = `${kind}|${String(x.reason || 'Not given').toLowerCase()}`;
        const o = agg.get(key) || { kind, reason: x.reason || 'Not given', dept: x.dept || 'Not set', unit: num === 'min' ? 'min' : 'pcs', now: 0, prev: 0, lines: new Set(), stations: new Map(), dismantle: 0 };
        if (date >= w1) { o.now += v; o.lines.add(String(line)); if (x.station) o.stations.set(x.station, (o.stations.get(x.station) || 0) + v); o.dismantle += Number(x.dismantle) || 0; }
        else if (date <= w0e) o.prev += v;
        agg.set(key, o);
      }
    }
  }
  const list = [...agg.values()].map((o) => ({ ...o, lines: [...o.lines].sort(), stations: [...o.stations.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s), change: o.prev > 0 ? o.now / o.prev - 1 : (o.now > 0 ? null : 0) }));
  const top = (kind, n = 6) => list.filter((x) => x.kind === kind && (x.now > 0 || x.prev > 0)).sort((a, b) => b.now - a.now || b.prev - a.prev).slice(0, n);
  const losses = top('loss'); const rejects = top('reject'); const rework = top('rework');
  const sum = (kind, k) => list.filter((x) => x.kind === kind).reduce((a, x) => a + x[k], 0);
  const totals = Object.fromEntries(['loss', 'reject', 'rework'].map((k) => [k, { now: sum(k, 'now'), prev: sum(k, 'prev') }]));
  // growing: at least 30 % more than last week and a real amount (≥ 60 min / ≥ 10 pcs this week)
  const growing = list.filter((x) => x.now >= (x.unit === 'min' ? 60 : 10) && (x.prev === 0 || x.now >= x.prev * 1.3)).sort((a, b) => b.now - a.now);
  // RCAs of the last 30 days: pending (nothing written) and overdue (target date passed, not closed)
  let pending = 0, overdue = 0;
  const from30 = addDaysYmd(today, -29);
  for (const [k, rec] of Object.entries(rca || {})) {
    const [date, line] = k.split('|');
    if (date < from30 || date < RCA_FROM || date > today || !ok(line)) continue;   // RCAs from 23-11-2026
    const st = rcaStatus(rec);
    if (st === 'pending') pending += 1;
    if (st !== 'closed' && rec?.targetDate && rec.targetDate < today) overdue += 1;
  }
  const effect = rcaEffect({ entries, rca, start: addDaysYmd(today, -(back - 1)), end: today, ids, win: 14 });
  const stuck = effect.filter((r) => r.status === 'not' || r.status === 'new');
  // "What to do" from the entries
  const actions = [];
  for (const r of stuck.slice(0, 3)) {
    actions.push({ key: `rca-${r.key}`, kind: 'rca', title: `${r.reason}: the RCA action${r.nActions > 1 ? `s (${r.nActions})` : ''} did not bring it down`,
      detail: `${r.lines.map((l) => `Line ${l}`).join(', ')} · ${Math.round(r.after ?? 0)} ${r.unit}/day after the action (${Math.round(r.before ?? 0)} before). Do the 5-Why again — ${r.dept}.` });
  }
  for (const g of growing.slice(0, 3)) {
    actions.push({ key: `grow-${g.kind}-${g.reason}`, kind: 'grow', title: `${g.reason} is growing: ${Math.round(g.now)} ${g.unit} this week${g.prev ? ` (+${Math.round((g.now / g.prev - 1) * 100)}% vs last week)` : ' (none last week)'}`,
      detail: `${g.kind === 'loss' ? 'Loss' : g.kind === 'reject' ? 'Rejection' : 'Rework'} · ${g.lines.map((l) => `Line ${l}`).join(', ')}${g.stations.length ? ` · ${g.stations.slice(0, 2).join(', ')}` : ''} · ${g.dept}.` });
  }
  if (overdue) actions.push({ key: 'rca-overdue', kind: 'rca', title: `${overdue} RCA${overdue === 1 ? '' : 's'} past the target date`, detail: 'RCA dashboard → Open RCAs (overdue on top): close them or give a new date.' });
  if (pending >= 5) actions.push({ key: 'rca-pending', kind: 'rca', title: `${pending} losses of the last 30 days have no RCA yet`, detail: 'RCA page: the departments write the root cause and the action.' });
  return { week: { from: w1, to: today, prevFrom: w0, prevTo: w0e }, losses, rejects, rework, totals, growing, pending, overdue, effect, stuck, actions };
}

/** a few lines for the copied / downloaded text */
export function insightText(x) {
  if (!x) return '';
  const f = (r) => `${r.reason} ${Math.round(r.now)} ${r.unit}${r.prev ? ` (last week ${Math.round(r.prev)})` : ''}`;
  const out = ['', 'LOSS ENTRIES (this week vs last week)'];
  if (x.losses.length) out.push(`Loss: ${x.losses.slice(0, 4).map(f).join('; ')}`);
  if (x.rejects.length) out.push(`Rejection: ${x.rejects.slice(0, 3).map(f).join('; ')}`);
  if (x.rework.length) out.push(`Rework: ${x.rework.slice(0, 3).map(f).join('; ')}`);
  out.push(`RCA: ${x.pending} without RCA, ${x.overdue} overdue, ${x.stuck.length} action(s) not working`);
  for (const a of x.actions) out.push(`- ${a.title}. ${a.detail}`);
  return out.join('\n');
}
