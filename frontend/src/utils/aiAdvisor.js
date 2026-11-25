/**
 * 25-11-2026: AI advisor — not numbers but what to DO (offline, pure). For every line it reads what is happening now,
 * finds the root cause in the plant's own data, says what will happen if nothing is done and gives the steps, the owner
 * and by when:
 *   now    — line stopped now
 *   today  — will miss today's target · lost time with no reason · manpower short · a defect repeating today
 *   week   — a loss reason that keeps coming back (shortage, model change, breakdown …) · a defect that repeats
 *            (likely root cause + actions that worked, from the plant's Quality MIS) · an hour that is short day after
 *            day (it will be short again) · RCAs not closed
 * Sources: the AI page context (utils/aiMain.js: day × hour × model, forecast, live last scan), the loss / quality
 * entries and RCAs of the app's own store, the morning entry (manpower).
 */
import { normEntry, rcaStatus, RCA_FROM } from './ole';
import { rcaHint } from './rcaBook';

const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
const p2 = (n) => String(n).padStart(2, '0');
const hh = (h) => `${p2(h)}:00–${p2((h + 1) % 24)}:00`;
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const minTxt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const SEV_W = { now: 300, today: 200, week: 100 };

/** what kind of loss a reason is (for the steps and the owner) */
export function lossKind(reason = '', dept = '') {
  const s = `${reason} ${dept}`.toLowerCase();
  if (/shortage|short supply|kitting|store|material|part not|no part|waiting for part|supply/.test(s)) return 'material';
  if (/model change|changeover|change over|setup change|t-9/.test(s)) return 'changeover';
  if (/breakdown|machine|motor fail|maint|jig|fixture|conveyor|tool|leak tester|tester|equipment/.test(s)) return 'breakdown';
  if (/power|electric|air pressure|compressor|utility/.test(s)) return 'utility';
  if (/manpower|absent|operator|man power|training|skill/.test(s)) return 'manpower';
  if (/quality|rework|reject|inspection|defect/.test(s)) return 'quality';
  if (/productivity|efficiency|slow|speed/.test(s)) return 'speed';
  return 'other';
}
const KIND_STEPS = {
  material: { owner: 'Store / PPC', steps: ['Store: check the kit of the models planned for the next 4 hours and send what is short now', 'PPC: keep at least 2 hours of buffer at the line side for the parts that ran short', 'Daily 9:00 shortage review (Store, PPC, Purchase) until it stops'] },
  changeover: { owner: 'PPC / Production', steps: ['PPC: plan the same model in longer runs (fewer changes per shift)', 'Production: prepare the next model (parts, jigs, program) before the change — SMED checklist', 'Note the change time each time; target ≤ 10 min'] },
  breakdown: { owner: 'Maintenance', steps: ['Maintenance: find the failed part and fix the root cause (not only restart)', 'Add it to the preventive maintenance check list; keep a spare at the line', 'Production: record each stop with its minutes so the repeat is seen'] },
  utility: { owner: 'Utility / Maintenance', steps: ['Utility: check the supply (power / air) log for the stop times', 'Arrange a backup (UPS / receiver tank) for the critical stations'] },
  manpower: { owner: 'HR / Production', steps: ['Production: move a trained operator from a non-bottleneck station now', 'HR: arrange relievers for absentees before shift start', 'Train a back-up operator on the bottleneck stations'] },
  quality: { owner: 'Quality / Production', steps: ['Quality: hold and check the suspect lot, find the station that makes the defect', 'Production: correct the method at that station (work instruction, poka-yoke)'] },
  speed: { owner: 'Production / IE', steps: ['IE: re-balance the line — find the slowest station (bottleneck) and split its work', 'Production: check the manpower against the standard and the skill of the bottleneck operator'] },
  other: { owner: 'Production', steps: ['Department of the reason: write the 5-Why RCA and one action with a date'] },
};
const CAT_OWNER = { Moulding: 'Moulding / supplier', Part: 'Store / SQA (supplier)', 'Kitting Store': 'Kitting store', 'Plastic Store': 'Plastic store', Process: 'Production', Assy: 'Production', Production: 'Production' };

/** the entries of one line-day, hour by hour → { losses: [{reason, dept, min, hour}], defects: [{kind, reason, qty, station, model, cat, cause, action, dismantle, hour}] } */
function dayEntries(entries, date, line) {
  const out = { losses: [], defects: [], noLoss: 0 };
  for (let h = 0; h < 24; h++) {
    const raw = entries?.[`${date}|${line}|${h}`];
    if (!raw) continue;
    const e = normEntry(raw);
    for (const x of [...e.stops, ...e.losses]) if (Number(x.min) > 0) out.losses.push({ reason: x.reason || 'Not given', dept: x.dept || '', min: Number(x.min), hour: h, model: x.model || '' });
    for (const [k, list] of [['rework', e.rework], ['reject', e.rejects]]) for (const x of list) if (Number(x.qty) > 0) out.defects.push({ kind: k, reason: x.reason || 'Not given', qty: Number(x.qty), station: x.station || '', model: x.model || '', cat: x.cat || '', cause: x.cause || '', action: x.action || '', dismantle: Number(x.dismantle) || 0, hour: h });
  }
  return out;
}
const top = (m, n = 3) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const most = (arr) => { const m = new Map(); for (const v of arr.filter(Boolean)) m.set(v, (m.get(v) || 0) + 1); return top(m, 2).map(([k]) => k); };

/**
 * advise({ per, isToday, nowMin, now, today, forecast, entries, rca, setup, stdMp, ids }) → { items, counts }
 *   per = ctx.per of utils/aiMain.js (one line each), forecast(p) = lineForecast(p, ctx)
 */
export function advise({ per = [], isToday = true, nowMin = 0, now = new Date(), today, forecast = () => null, entries = {}, rca = {}, setup = {}, stdMp = {}, ids = null } = {}) {
  const items = [];
  const add = (o) => items.push({ id: `${o.kind}-${o.line ?? 'all'}-${items.length}`, score: SEV_W[o.sev] + (o.weight || 0), ...o });
  const lines = per.filter((p) => p.ok && (!ids || ids.map(String).includes(String(p.line))));
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, -i));   // today and the 6 days before

  for (const p of lines) {
    const L = String(p.line); const name = p.name || `Line ${L}`;
    const dl = p.day; const f = forecast(p);
    const tdE = dayEntries(entries, today, L);
    const wk = week.map((d) => ({ d, ...dayEntries(entries, d, L) }));
    const cycle = dl?.avgCycle || (f?.rate ? 3600 / f.rate : null);   // seconds per piece
    const pcsOf = (min) => (cycle ? Math.round((min * 60) / cycle) : null);

    // ── NOW: the line stopped ──
    if (isToday && p.live?.lastScan && nowMin > p.shift.start && nowMin < p.shift.end) {
      const t = new Date(String(p.live.lastScan).replace(' ', 'T'));
      const ago = (now - t) / 60000;
      const lunch = p.shift.lunchStart != null && nowMin >= p.shift.lunchStart && nowMin < p.shift.lunchEnd;
      if (!lunch && ago >= 10 && ago < 6 * 60) {
        const hNow = Math.floor(nowMin / 60);
        const rec = tdE.losses.filter((x) => x.hour >= hNow - 1);
        const freq = new Map(); for (const d of wk) for (const x of d.losses) freq.set(x.reason, (freq.get(x.reason) || 0) + 1);
        const [fr] = top(freq, 1);
        const rate = f?.recent || f?.rate || null;
        add({ sev: 'now', kind: 'stopped', line: L, weight: Math.min(90, ago), title: `${name} stopped — no piece for ${Math.round(ago)} min`,
          situation: `Last piece at ${String(p.live.lastScan).slice(11, 16)}${p.live.model ? ` (${p.live.model})` : ''}.`,
          cause: [rec.length ? `Written for this hour: ${rec.map((x) => `${x.reason} ${x.min} min`).join(', ')}` : 'No reason written yet for this stop',
            ...(fr ? [`Most frequent stop on ${name} this week: ${fr[0]} (${fr[1]} times) — check this first`] : [])],
          risk: rate ? `Every 10 more minutes ≈ ${nf(rate / 6)} pcs lost${f?.target ? `; today's target ${nf(f.target)} gets harder` : ''}.` : 'Pieces are lost every minute the line stands.',
          actions: ['Supervisor: go to the line now and find why it stopped', fr ? `If it is ${fr[0]} again → ${KIND_STEPS[lossKind(fr[0])].owner} at once` : 'Breakdown → call Maintenance; parts → call Store', `Write the reason in Loss entry for ${hh(hNow)} as soon as it runs`],
          owner: 'Production supervisor', by: 'Now' });
      }
    }

    // ── TODAY: will miss the target ──
    if (isToday && f?.state === 'live' && f.target > 0 && (f.verdict === 'will-miss' || f.verdict === 'at-risk')) {
      const gap = Math.max(0, f.target - f.projected);
      const byR = new Map(); for (const x of tdE.losses) byR.set(x.reason, (byR.get(x.reason) || 0) + x.min);
      const entered = tdE.losses.reduce((a, x) => a + x.min, 0);
      const lostMin = dl?.lostSec ? dl.lostSec / 60 : null;
      const tr = top(byR, 3);
      const cause = [];
      if (tr.length) cause.push(`Time lost today: ${tr.map(([r, m]) => `${r} ${Math.round(m)} min`).join(', ')}`);
      if (lostMin != null && lostMin - entered >= 20) cause.push(`${minTxt(lostMin - entered)} of the lost time has no reason written — the cause is not known yet`);
      if (f.recent && f.need && f.recent < f.need) cause.push(`Running at ${nf(f.recent)} pcs/hr, needs ${nf(f.need)} pcs/hr to reach the target`);
      const otMin = f.recent > 0 ? Math.ceil((gap / f.recent) * 60) : null;
      const k = tr.length ? lossKind(tr[0][0]) : 'speed';
      add({ sev: 'today', kind: 'target', line: L, weight: Math.min(90, (gap / f.target) * 300), title: `${name} will miss today's target by ≈ ${nf(gap)} pcs`,
        situation: `Expected ${nf(f.projected)} of ${nf(f.target)} pcs at shift end.`, cause: cause.length ? cause : ['Speed below the plan through the day'],
        risk: `${nf(gap)} pcs short today${otMin ? ` — ${minTxt(otMin)} of overtime at the present speed to make them up` : ''}.`,
        actions: [f.need ? `Hold ${nf(f.need)} pcs/hr from now (now ${nf(f.recent)}) — supervisor to watch every hour` : 'Watch the output every hour',
          tr.length ? `Fix first: ${tr[0][0]} (${Math.round(tr[0][1])} min today) → ${KIND_STEPS[k].owner}` : 'Find the slowest station and support it',
          otMin ? `If not recovered by 2 hours before shift end: plan ${minTxt(otMin)} overtime or tell PPC to move ${nf(gap)} pcs to tomorrow` : 'Tell PPC early if the plan cannot be met'],
        owner: 'Production head', by: `Before ${p2(Math.floor(p.shift.end / 60))}:${p2(p.shift.end % 60)}` });
    }

    // ── TODAY: lost time with no reason ──
    if (dl?.lostSec) {
      const entered = tdE.losses.reduce((a, x) => a + x.min, 0);
      const un = dl.lostSec / 60 - entered;
      if (un >= 30) add({ sev: 'today', kind: 'unexplained', line: L, weight: Math.min(60, un / 3), title: `${name}: ${minTxt(un)} lost with no reason written`,
        situation: `Short against the target ≈ ${minTxt(dl.lostSec / 60)}; written in Loss entry ${minTxt(entered)}.`,
        cause: ['Hours not filled in Loss entry — the root cause cannot be found and nobody owns it'],
        risk: 'The loss will repeat: no RCA, no department, no action.', actions: ['Supervisor: fill the pending hours in Loss entry today (reason + department)', 'Use "Next empty" on Loss entry to go hour by hour'], owner: 'Line supervisor', by: 'Today' });
    }

    // ── TODAY: manpower short ──
    const mp = Number(setup?.[`${today}|${L}`]?.mp); const smp = Number(stdMp?.[L]);
    if (mp > 0 && smp > 0 && mp < smp) {
      add({ sev: 'today', kind: 'manpower', line: L, weight: ((smp - mp) / smp) * 100, title: `${name} running with ${mp} of ${smp} people`,
        situation: `Morning entry: ${mp} present, standard ${smp}.`, cause: [`${smp - mp} short — the bottleneck stations slow the whole line`],
        risk: `≈ ${Math.round(((smp - mp) / smp) * 100)}% lower output if the gap is on the bottleneck.`, actions: KIND_STEPS.manpower.steps, owner: KIND_STEPS.manpower.owner, by: 'Now' });
    }

    // ── WEEK: a loss reason that keeps coming back ──
    const rs = new Map();
    for (const d of wk) for (const x of d.losses) {
      const o = rs.get(x.reason) || { reason: x.reason, dept: x.dept, min: 0, days: new Set(), hours: new Map(), models: new Map() };
      o.min += x.min; o.days.add(d.d); o.hours.set(x.hour, (o.hours.get(x.hour) || 0) + 1); if (x.model) o.models.set(x.model, (o.models.get(x.model) || 0) + x.min);
      rs.set(x.reason, o);
    }
    const chronic = [...rs.values()].filter((o) => o.days.size >= 3 || o.min >= 120).sort((a, b) => b.min - a.min).slice(0, 3);
    for (const o of chronic) {
      const k = lossKind(o.reason, o.dept); const S = KIND_STEPS[k];
      const hrs = top(o.hours, 2).filter(([, n]) => n >= 2).map(([h]) => hh(h));
      const mdl = top(o.models, 2).map(([m]) => m);
      // an RCA of this reason on this line this week (rcaKey = date|line|kind|reason) that is not closed
      const open = Object.entries(rca || {}).some(([key, r]) => { const [d, l, , rr] = key.split('|'); return d >= week[6] && String(l) === L && String(rr || '').toLowerCase() === o.reason.toLowerCase() && rcaStatus(r) !== 'closed'; });
      add({ sev: 'week', kind: `chronic-${k}`, line: L, weight: Math.min(90, o.min / 5), title: `${o.reason} keeps coming back on ${name}: ${o.days.size} of 7 days, ${minTxt(o.min)}`,
        situation: `${o.dept ? `${o.dept} · ` : ''}${hrs.length ? `mostly at ${hrs.join(', ')}` : 'at different hours'}${mdl.length ? ` · models ${mdl.join(', ')}` : ''}.`,
        cause: [`A repeat, not a one-off: ${o.days.size} days this week`, ...(hrs.length ? [`Same hour again and again (${hrs.join(', ')}) — points to a fixed cause (start-up, a shift change, a delivery time)`] : []), ...(mdl.length ? [`Linked to ${mdl.join(', ')}`] : []), open ? 'An RCA is open but the loss continues — its action is not working' : 'No RCA closed for it this month'],
        risk: `≈ ${minTxt(o.min)} a week${pcsOf(o.min) ? ` (≈ ${nf(pcsOf(o.min))} pcs)` : ''} will keep being lost — ≈ ${minTxt((o.min / 7) * 26)} a month.`,
        actions: [...S.steps, `${o.dept || S.owner}: 5-Why RCA with one action and a date within 48 hours`], owner: o.dept || S.owner, by: '48 hours' });
    }

    // ── WEEK / TODAY: a defect that repeats ──
    const ds = new Map();
    for (const d of wk) for (const x of d.defects) {
      const key = `${x.reason}|${x.station}`;
      const o = ds.get(key) || { reason: x.reason, station: x.station, kind: x.kind, qty: 0, today: 0, days: new Set(), models: new Map(), cats: [], causes: [], actions: [], dismantle: 0 };
      o.qty += x.qty; if (d.d === today) o.today += x.qty; o.days.add(d.d); if (x.model) o.models.set(x.model, (o.models.get(x.model) || 0) + x.qty);
      o.cats.push(x.cat); o.causes.push(x.cause); o.actions.push(x.action); o.dismantle += x.dismantle; ds.set(key, o);
    }
    const rep = [...ds.values()].filter((o) => o.qty >= 8 || o.days.size >= 3 || o.today >= 5).sort((a, b) => b.qty - a.qty).slice(0, 3);
    for (const o of rep) {
      const h = rcaHint(o.reason);
      const own = most(o.causes); const ownA = most(o.actions); const cat = most(o.cats)[0] || '';
      const mdl = top(o.models, 2).map(([m]) => m);
      add({ sev: o.today >= 5 ? 'today' : 'week', kind: 'defect', line: L, weight: Math.min(90, o.qty * 2 + o.dismantle * 5),
        title: `${o.reason}${o.station ? ` at ${o.station}` : ''} on ${name}: ${o.qty} pcs in ${o.days.size} day${o.days.size > 1 ? 's' : ''}${o.today ? ` (${o.today} today)` : ''}`,
        situation: `${o.kind === 'reject' ? 'Rejection' : 'Rework'}${cat ? ` · ${cat}` : ''}${mdl.length ? ` · models ${mdl.join(', ')}` : ''}${o.dismantle ? ` · ${o.dismantle} dismantled` : ''}.`,
        cause: [...(own.length ? [`Written by the line: ${own.join('; ')}`] : []), ...(h.c.length ? [`Likely (plant history): ${h.c.slice(0, 3).join('; ')}`] : []), ...(!own.length && !h.c.length ? ['No root cause written yet'] : [])],
        risk: `≈ ${Math.round(o.qty / Math.max(1, o.days.size))} pcs a day more rework${o.dismantle ? ' and dismantling (costly)' : ''}; FPY of ${name} goes down.`,
        actions: [...(ownA.length ? [`Continue / check: ${ownA[0]}`] : []), ...h.a.slice(0, 2).map((a) => `Proven action (plant history): ${a}`), `${o.station || 'Quality'}: check the first pieces of every model change for this defect`, ...(cat === 'Moulding' || cat === 'Part' ? ['Raise it to the supplier / moulding with the photos (SQA)'] : [])].slice(0, 4),
        owner: CAT_OWNER[cat] || 'Quality / Production', by: o.today >= 5 ? 'Today' : '3 days' });
    }

    // ── PREDICTION: an hour that is short day after day ──
    const seen = new Map();
    for (const [d, day] of Object.entries(p.days || {})) {
      if (d === today) continue;
      for (const r of day?.td?.rows || []) {
        const plan = r.plan ?? r.planFull;
        if (!(plan > 0) || !(r.qty > 0) || r.future) continue;
        const o = seen.get(r.hour) || { n: 0, low: 0, sum: 0 }; o.n++; o.sum += r.qty / plan; if (r.qty / plan < 0.8) o.low++; seen.set(r.hour, o);
      }
    }
    const weak = [...seen.entries()].filter(([, o]) => o.n >= 4 && o.low / o.n >= 0.6).sort((a, b) => a[1].sum / a[1].n - b[1].sum / b[1].n).slice(0, 2);
    for (const [h, o] of weak) {
      const first = h * 60 <= p.shift.start + 60; const lunchAfter = p.shift.lunchEnd != null && h * 60 >= p.shift.lunchEnd - 30 && h * 60 <= p.shift.lunchEnd + 30;
      const last = (h + 1) * 60 >= p.shift.end;
      const ahead = isToday && (h + 1) * 60 > nowMin;
      const why = first ? 'start of the shift (line not ready when the shift starts)' : lunchAfter ? 'restart after lunch' : last ? 'end of the shift' : 'a fixed time — look at deliveries, shift change or breaks at that hour';
      const acts = first ? ['Material, jigs and operators at the stations 10 min before the shift', 'Pre-shift checklist + first-piece check done before the start time']
        : lunchAfter ? ['Staggered lunch for the bottleneck stations, or a relief operator', 'Line leader restarts the line on time and checks the first pieces'] : last ? ['Keep the material for the last hour at the line before', 'Do not start a model change in the last hour'] : ['Find what happens at this hour (deliveries, meetings, changeovers) and move it'];
      const tr = [...rs.values()].filter((x) => x.hours.has(h)).sort((a, b) => b.min - a.min)[0];
      add({ sev: ahead ? 'today' : 'week', kind: 'pattern', line: L, weight: (1 - o.sum / o.n) * 100, title: `${hh(h)} is short on ${name} ${o.low} of ${o.n} days — it will likely be short ${ahead ? 'again today' : 'tomorrow'}`,
        situation: `That hour makes ${Math.round((o.sum / o.n) * 100)}% of its target on average.`, cause: [`Pattern: ${why}`, ...(tr ? [`Reason written most at this hour: ${tr.reason}`] : [])],
        risk: `≈ ${Math.round((1 - o.sum / o.n) * 100)}% of that hour lost every day.`, actions: acts, owner: 'Production supervisor', by: ahead ? `Before ${p2(h)}:00` : 'Tomorrow' });
    }
  }

  // ── RCAs not closed (all the lines asked) ──
  let overdue = 0, pending = 0;
  const from30 = addDays(today, -29);
  for (const [k, r] of Object.entries(rca || {})) {
    const [d, l] = k.split('|');
    if (d < from30 || d < RCA_FROM || d > today || (ids && !ids.map(String).includes(String(l)))) continue;
    const st = rcaStatus(r);
    if (st === 'pending') pending++;
    if (st !== 'closed' && r?.targetDate && r.targetDate < today) overdue++;
  }
  if (overdue || pending >= 5) add({ sev: 'week', kind: 'rca', line: null, weight: overdue * 5 + pending, title: `${overdue ? `${overdue} RCA${overdue > 1 ? 's' : ''} past the target date` : ''}${overdue && pending >= 5 ? ' · ' : ''}${pending >= 5 ? `${pending} losses with no RCA` : ''}`,
    situation: 'Losses of the last 30 days.', cause: ['The departments have not written / closed the root cause'], risk: 'The same losses come back: nobody owns them.',
    actions: ['RCA dashboard → open RCAs: each department closes its own or gives a new date', 'Plant head: 10-minute RCA review in the morning meeting'], owner: 'All departments', by: 'This week' });

  items.sort((a, b) => b.score - a.score);
  const counts = { now: items.filter((x) => x.sev === 'now').length, today: items.filter((x) => x.sev === 'today').length, week: items.filter((x) => x.sev === 'week').length };
  return { items, counts };
}

/** the plan as text (copy / download) */
export function adviceText(a) {
  if (!a?.items?.length) return '\nACTION PLAN\nNothing to act on.';
  const H = { now: 'DO NOW', today: 'TODAY', week: 'THIS WEEK — stop it coming back' };
  const out = ['', 'ACTION PLAN'];
  for (const s of ['now', 'today', 'week']) {
    const xs = a.items.filter((x) => x.sev === s); if (!xs.length) continue;
    out.push('', H[s]);
    xs.forEach((x, i) => {
      out.push(`${i + 1}. ${x.title}`, `   Why: ${x.cause.join(' | ')}`, `   If nothing is done: ${x.risk}`);
      x.actions.forEach((t, j) => out.push(`   ${j + 1}) ${t}`));
      out.push(`   Owner: ${x.owner} · By: ${x.by}`);
    });
  }
  return out.join('\n');
}
