/**
 * AI analysis for the Main view (all lines), offline.
 *
 *   plantContext({ lines, settings, live, losses, now, range }) → one object with the loss matrix and per-line today
 *   plantBrief(ctx)     → headline, health score, per-line status + forecast, alerts, actions
 *   plantAsk(q, ctx)    → answers in English / Hinglish: "line 2 kitna bana", "sabse zyada loss kis line ka", "kal ka loss" …
 *
 * Numbers come from all_lines.php (day × hour × model), live_lines.php (last scan, running model), the line settings
 * (shift, model targets, ₹ rates) and the loss registers — the same sources as the Main page tables.
 */
import { lossMatrix, rupees, hasRates, sumLoss } from './money';
import { fmtMin, normShift } from './shift';
import { serverNow } from './serverTime';

const pad = (n) => String(n).padStart(2, '0');
const nf = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
const pc = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const hm = (sec) => { if (sec == null) return '—'; const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`; };
const fmtDay = (d) => { if (!d) return ''; const t = new Date(`${d}T00:00:00`); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); };
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function plantContext({ lines = [], settings = {}, live = null, losses = {}, now = serverNow(), range = null }) {
  const today = localDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const ok = lines.filter((l) => l.ok);
  const mx = lossMatrix(ok, settings, { now, range });
  const focus = mx.days.includes(today) ? today : mx.days[0] || today;
  const liveBy = Object.fromEntries((live?.lines || []).map((l) => [String(l.line), l]));
  const per = lines.map((l) => {
    const L = mx.lines.find((x) => x.line === l.line);
    const st = settings[l.line] || {};
    return {
      line: l.line, name: l.name || `Line ${l.line}`, ok: l.ok, error: l.error, backup: !!l.backup,
      day: L?.days[focus] || null, total: L?.total || null, days: L?.days || {}, money: st.money || {}, shift: normShift(st.shift),
      hasTargets: Object.keys(st.targets || {}).length > 0, live: liveBy[l.line] || null, losses: losses[l.line] || [],
      models: l.models || [],
    };
  });
  return { now, today, nowMin, focus, isToday: focus === today, mx, per, range, anyRates: per.some((p) => hasRates(p.money)) };
}

/** Today's projection of one line to its shift end (recent rate 60 % + day rate 40 %). */
export function lineForecast(p, ctx) {
  const dl = p.day;
  if (!dl || !ctx.isToday) return null;
  const sh = p.shift;
  if (ctx.nowMin >= sh.end) return { state: 'closed', projected: dl.actual, target: dl.target };
  const rows = (dl.td?.rows || []).filter((r) => !r.future && r.workSec > 0);
  const sec = rows.reduce((s, r) => s + r.workSec, 0);
  const q = rows.reduce((s, r) => s + r.qty, 0);
  if (sec < 900 || q === 0) return { state: 'early', projected: null, target: dl.td?.total?.planFull ?? null };
  const dayRate = q / (sec / 3600);
  let rq = 0, rs = 0;
  for (const r of [...rows].reverse()) { if (rs >= 7200) break; if (r.running && r.workSec < 900) continue; rq += r.qty; rs += r.workSec; }
  const recent = rs > 0 ? rq / (rs / 3600) : dayRate;
  const rate = 0.6 * recent + 0.4 * dayRate;
  const remaining = dl.td.total.remainingSec;
  const projected = dl.actual + (rate * remaining) / 3600;
  const target = dl.td.total.planFull;
  const need = target != null && remaining > 0 ? Math.max(0, target - dl.actual) / (remaining / 3600) : null;
  return { state: 'live', projected, target, rate, recent, need, remaining, verdict: target ? (projected >= target ? 'on-track' : projected >= target * 0.95 ? 'at-risk' : 'will-miss') : null };
}

const VERDICT = { 'on-track': 'on track', 'at-risk': 'at risk', 'will-miss': 'will miss target' };

export function plantAlerts(ctx) {
  const out = [];
  const add = (level, kind, title, detail, extra = {}) => out.push({ id: `${kind}-${extra.line ?? ''}-${out.length}`, level, kind, title, detail, ...extra });
  for (const p of ctx.per) {
    if (!p.ok) { add('bad', 'offline', `${p.name} is not reachable`, `The line server did not answer (${String(p.error || '').slice(0, 80)}). Its numbers are missing from the totals.`, { line: p.line }); continue; }
    const dl = p.day;
    // stopped now (today, inside the shift, last scan long ago)
    if (ctx.isToday && p.live?.lastScan && ctx.nowMin > p.shift.start && ctx.nowMin < p.shift.end) {
      const t = new Date(p.live.lastScan.replace(' ', 'T'));
      const ago = (ctx.now - t) / 60000;
      const inLunch = p.shift.lunchStart != null && ctx.nowMin >= p.shift.lunchStart && ctx.nowMin < p.shift.lunchEnd;
      if (!inLunch && ago >= 15 && ago < 24 * 60) add(ago >= 30 ? 'bad' : 'warn', 'stopped', `${p.name} has not scanned for ${Math.round(ago)} min`, `Last piece at ${p.live.lastScan.slice(11, 16)}${p.live.model ? ` (${p.live.model})` : ''}. Check the line now and record the reason.`, { line: p.line });
    }
    if (ctx.isToday && ctx.nowMin > p.shift.start + 30 && !dl && p.hasTargets) add('bad', 'no-production', `${p.name}: no production today`, `The shift started at ${fmtMin(p.shift.start)} and no piece has been scanned yet.`, { line: p.line });
    if (dl?.hasPlan && !dl.skipped && dl.pct != null && dl.pct < 90) {
      add(dl.pct < 75 ? 'bad' : 'warn', 'target', `${p.name} at ${pc(dl.pct)} of target ${ctx.isToday ? 'so far' : `on ${fmtDay(ctx.focus)}`}`,
        `${nf(dl.actual)} of ${nf(dl.target)} pcs — short ${nf(dl.short)} pcs (${hm(dl.lostSec)})${dl.rsTotal != null ? `, loss ${rupees(dl.rsTotal)}` : ''}.`, { line: p.line });
    }
    if (dl && !dl.hasPlan) add('info', 'no-target', `${p.name} has no model targets for ${ctx.isToday ? 'today' : fmtDay(ctx.focus)}`, 'Set targets (Main → Target and loss → "Set targets from achieved cycle", or on the line page) to see target and loss.', { line: p.line });
    const f = lineForecast(p, ctx);
    if (f?.state === 'live' && f.verdict === 'will-miss') add('warn', 'forecast', `${p.name} will miss today's target`, `Expected ${nf(f.projected)} of ${nf(f.target)} pcs at ${fmtMin(p.shift.end)}. Needs ${nf(f.need)} pcs/hr from now; making ${nf(f.recent)} pcs/hr.`, { line: p.line });
    if (dl && dl.actual > 50 && dl.rej / (dl.actual + dl.rej) > 0.03) add('warn', 'rejection', `${p.name} rejection ${pc((dl.rej / (dl.actual + dl.rej)) * 100)}`, `${nf(dl.rej)} rejected scans vs ${nf(dl.actual)} good pieces ${ctx.isToday ? 'today' : `on ${fmtDay(ctx.focus)}`}.`, { line: p.line });
    if (dl?.hasPlan && dl.short > 0 && dl.lostSec >= 1800) {
      const rec = p.losses.filter((e) => e.date === ctx.focus).reduce((s, e) => s + (Number(e.minutes) || 0), 0);
      if (rec < (dl.lostSec / 60) * 0.5) add('info', 'unrecorded', `${p.name}: ${hm(dl.lostSec - rec * 60)} of lost time has no reason`, `${rec ? `${rec} min recorded in the loss register; ` : 'Nothing recorded in the loss register; '}record the reasons on the line page so the loss can be acted on.`, { line: p.line });
    }
  }
  // period: worst line
  const withRs = ctx.per.filter((p) => p.total?.rsTotal != null);
  if (withRs.length > 1) {
    const w = [...withRs].sort((a, b) => b.total.rsTotal - a.total.rsTotal)[0];
    if (w.total.rsTotal > 0) add('info', 'worst-line', `Biggest loss in the period: ${w.name} ${rupees(w.total.rsTotal, { short: true })}`, `${nf(w.total.short)} pcs short over ${w.total.plannedDays} days (${pc(w.total.pct)} of target).`, { line: w.line });
  }
  if (!ctx.anyRates) add('info', 'rates', '₹ rates are not set', 'Set ₹ per piece and ₹ per line-hour in Main → Target and loss → Rates to see the loss in rupees.');
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level] || String(a.line ?? 9).localeCompare(String(b.line ?? 9)));
}

export function plantBrief(ctx) {
  const okPer = ctx.per.filter((p) => p.ok);
  const day = sumLoss(okPer.map((p) => p.day).filter(Boolean));
  const fc = okPer.map((p) => ({ line: p.line, f: lineForecast(p, ctx) }));
  // plant forecast = Σ line forecasts (a line without a forecast yet counts with what it has made)
  const projected = fc.some((x) => x.f?.state === 'live')
    ? fc.reduce((s, x) => s + (x.f?.projected ?? okPer.find((p) => p.line === x.line)?.day?.actual ?? 0), 0) : null;
  const dayTarget = fc.reduce((s, x) => s + (x.f?.target ?? 0), 0) || null;
  const alerts = plantAlerts(ctx);
  const when = ctx.isToday ? 'today so far' : `on ${fmtDay(ctx.focus)}`;
  let headline = `All lines: ${nf(day.actual)} pcs ${when}`;
  if (day.target) headline += day.actualPlanned !== day.actual
    ? ` — lines with targets at ${pc(day.pct)} (${nf(day.actualPlanned)} of ${nf(day.target)} pcs)`
    : ` — ${pc(day.pct)} of target (${nf(day.target)} pcs)`;
  if (day.rsTotal != null) headline += `, loss ${rupees(day.rsTotal)}`;
  headline += '.';
  if (ctx.isToday && projected != null) headline += ` Forecast at shift end: ${nf(projected)} pcs${dayTarget ? ` vs ${nf(dayTarget)} target` : ''}.`;

  // health: target 50, lines running 20, quality 15, loss recorded 15
  const parts = [];
  if (day.pct != null) parts.push({ k: 'Target', w: 50, v: Math.max(0, Math.min(1, (day.pct - 50) / 50)) });
  parts.push({ k: 'Lines up', w: 20, v: ctx.per.filter((p) => p.ok).length / Math.max(1, ctx.per.length) });
  const rejR = day.actual + day.rej > 0 ? day.rej / (day.actual + day.rej) : 0;
  parts.push({ k: 'Quality', w: 15, v: Math.max(0, 1 - rejR * 10) });
  const stopped = alerts.filter((a) => a.kind === 'stopped').length;
  parts.push({ k: 'Running now', w: 15, v: ctx.isToday ? 1 - stopped / Math.max(1, okPer.length) : 1 });
  const W = parts.reduce((s, p) => s + p.w, 0);
  const score = Math.round((parts.reduce((s, p) => s + p.w * p.v, 0) / W) * 100);
  const grade = score >= 85 ? 'Good' : score >= 70 ? 'Fair' : 'Poor';

  const rows = ctx.per.map((p) => {
    const f = fc.find((x) => x.line === p.line)?.f || null;
    const dl = p.day;
    const status = !p.ok ? 'offline' : alerts.some((a) => a.line === p.line && a.kind === 'stopped') ? 'stopped' : !dl ? 'idle' : !dl.hasPlan ? 'no-target' : dl.pct >= 100 ? 'ok' : dl.pct >= 90 ? 'watch' : 'behind';
    return { line: p.line, name: p.name, status, dl, f, running: p.live?.model ? `${p.live.company ? `${p.live.company} · ` : ''}${p.live.model}` : null, total: p.total };
  });

  const actions = [];
  for (const r of rows) {
    if (r.status === 'offline') actions.push({ key: `off${r.line}`, title: `Bring ${r.name} back online`, gain: 0, detail: 'Check the line PC / SQL server and the network. Its data is missing.' });
    if (r.dl?.hasPlan && r.dl.short > 0) actions.push({ key: `short${r.line}`, title: `Recover ${r.name}'s shortfall`, gain: r.dl.short, rs: r.dl.rsTotal,
      detail: `${nf(r.dl.short)} pcs short (${hm(r.dl.lostSec)})${r.dl.rsTotal != null ? ` = ${rupees(r.dl.rsTotal)}` : ''}. Open its cell in the daily loss matrix to see the hours and reasons.` });
  }
  if (!ctx.anyRates) actions.push({ key: 'rates', title: 'Set ₹ rates', gain: 0, detail: 'Main → Target and loss → Rates: ₹ per piece and ₹ per line-hour for each line.' });
  const noT = rows.filter((r) => r.status === 'no-target');
  if (noT.length) actions.push({ key: 'targets', title: 'Set model targets', gain: 0, detail: `${noT.map((r) => r.name).join(', ')} — use "Set targets from achieved cycle".` });
  actions.sort((a, b) => (b.rs ?? b.gain) - (a.rs ?? a.gain));

  return { headline, score, grade, scoreParts: parts.map((p) => ({ ...p, pct: Math.round(p.v * 100) })), rows, alerts, actions, day, projected, dayTarget, period: ctx.mx.grand };
}

/** Plain-text plant report for WhatsApp / mail. */
export function plantText(b, ctx) {
  const L = [`EMS Line Pulse — AI analysis · All lines · ${ctx.focus}`, '', b.headline, `Plant health: ${b.score}/100 (${b.grade})`, '', 'LINES'];
  for (const r of b.rows) {
    if (r.status === 'offline') { L.push(`• ${r.name}: offline`); continue; }
    const d = r.dl;
    L.push(`• ${r.name}: ${nf(d?.actual ?? 0)} pcs${d?.target ? ` / ${nf(d.target)} target (${pc(d.pct)})` : ''}${d?.rsTotal != null ? `, loss ${rupees(d.rsTotal)}` : ''}${r.f?.state === 'live' ? `, forecast ${nf(r.f.projected)}` : ''}${r.running ? ` — running ${r.running}` : ''}`);
  }
  if (b.period?.rsTotal != null || b.period?.short != null) L.push('', `PERIOD: ${nf(b.period.actual)} pcs, short ${nf(b.period.short)} pcs${b.period.rsTotal != null ? `, loss ${rupees(b.period.rsTotal)}` : ''}`);
  const top = b.alerts.filter((a) => a.level !== 'info' && a.level !== 'good').slice(0, 6);
  if (top.length) { L.push('', 'ALERTS'); top.forEach((a) => L.push(`• ${a.title}`)); }
  if (b.actions.length) { L.push('', 'WHAT TO DO'); b.actions.slice(0, 5).forEach((a, i) => L.push(`${i + 1}. ${a.title} — ${a.detail}`)); }
  return L.join('\n');
}

/* ───────────── questions ───────────── */

export const PLANT_SUGGESTIONS = ['Aaj total kitna bana?', 'Sabse zyada loss kis line ka?', 'Line 2 kaisi chal rahi hai?', 'Target poora hoga?', 'Kal ka loss kitna tha?', 'Kaunsi line band hai?', 'Is period ka total loss?', 'Line 1 vs Line 3'];

const has = (q, re) => re.test(q);

function dayOf(q, ctx) {
  const days = [...ctx.mx.days].sort();
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(q);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/.exec(q);
  if (m && !/^\s*(se|to|-)?\s*line/.test(q.slice(m.index + m[0].length))) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : ctx.today.slice(0, 4);
    return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  if (has(q, /\bparso\b/)) return days.filter((d) => d < ctx.today).slice(-2)[0] || 'none';
  if (has(q, /\b(kal|yesterday)\b/)) return days.filter((d) => d < ctx.today).pop() || 'none';
  if (has(q, /\b(aaj|today)\b/)) return ctx.today;
  return null;
}

function lineSummary(p, ctx, d) {
  const dl = p.days[d];
  if (!p.ok) return `${p.name}: offline (${String(p.error || '').slice(0, 60)}).`;
  if (!dl) return `${p.name}: no production on ${fmtDay(d)}.`;
  const f = d === ctx.today ? lineForecast(p, ctx) : null;
  return `${p.name}: ${nf(dl.actual)} pcs${dl.hasPlan ? ` of ${nf(dl.target)} target (${pc(dl.pct)}), short ${nf(dl.short)} pcs, ${hm(dl.lostSec)} lost` : ' (no model targets)'}${dl.rsTotal != null ? `, loss ${rupees(dl.rsTotal)}` : ''}${f?.state === 'live' ? `; forecast ${nf(f.projected)} pcs at ${fmtMin(p.shift.end)}${f.verdict ? ` (${VERDICT[f.verdict]})` : ''}` : ''}${dl.skipped ? ' — not counted (below 5% of target)' : ''}.`;
}

export function plantAsk(question, ctx) {
  const q = ` ${String(question || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const res = (title, lines, extra = {}) => ({ title, lines: lines.filter(Boolean), follow: extra.follow || [], ...extra });
  if (!q.trim()) return res('Ask a question', ['Type a question about the lines, in English or Hinglish.'], { follow: PLANT_SUGGESTIONS.slice(0, 4) });
  const lineNums = [...q.matchAll(/line\s*-?\s*(\d)/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  const sel = lineNums.length ? ctx.per.filter((p) => lineNums.includes(p.line)) : ctx.per;
  const day = dayOf(q, ctx);
  if (day === 'none') return res('Earlier day not in the period', ['Select a longer period on the Main page, then ask again.']);
  const d = day || ctx.focus;
  if (day && !ctx.mx.days.includes(day) && day !== ctx.today) return res(`No data for ${fmtDay(day)}`, [`${fmtDay(day)} is outside the loaded period (${fmtDay(ctx.range?.start)} – ${fmtDay(ctx.range?.end)}).`]);

  if (has(q, /\b(help|madad|kya puch|what can)\b/)) {
    return res('What you can ask', ['Answers come from all lines\' data of the loaded period (no internet needed).'],
      { bullets: ['Production: "aaj total kitna bana", "line 2 kitna bana", "kal kitna bana"', 'Loss: "sabse zyada loss kis line ka", "kal ka loss", "is period ka total loss"', 'Target and forecast: "target poora hoga?", "line 3 ka target"', 'Status: "kaunsi line band hai", "kya problem hai"', 'Compare: "line 1 vs line 3"', 'A date: "25-10 ka loss"'], follow: PLANT_SUGGESTIONS.slice(0, 4) });
  }

  if (has(q, /\bvs\b|compare|muqabla|tulna/) && sel.length >= 2) {
    return res(`${sel.map((p) => p.name).join(' vs ')} — ${fmtDay(d)}`, [], {
      table: { head: ['Line', 'Actual', 'Target', '%', 'Short', 'Loss ₹', 'Period loss ₹'], rows: sel.map((p) => { const x = p.days[d]; return [p.name, nf(x?.actual), nf(x?.target), pc(x?.pct), nf(x?.short), rupees(x?.rsTotal), rupees(p.total?.rsTotal, { short: true })]; }) },
      follow: ['Sabse zyada loss kis line ka?'] });
  }

  if (has(q, /band|stop|ruk|offline|chal nahi|not running|down/)) {
    const al = plantAlerts(ctx).filter((a) => ['offline', 'stopped', 'no-production'].includes(a.kind));
    if (!al.length) return res('All lines are running', [ctx.isToday ? 'Every reachable line has scanned in the last 15 minutes (or is in lunch / outside the shift).' : 'This check works for today.']);
    return res(`${al.length} line${al.length === 1 ? '' : 's'} need attention`, [], { bullets: al.map((a) => `${a.title} — ${a.detail}`), follow: ['Kya problem hai?'] });
  }

  if (has(q, /forecast|banega|ho jayega|ho payega|poora|pura|reach|projection|end tak|complete/)) {
    if (!ctx.isToday) return res('Forecast', ['The forecast is for today; today has no data in the loaded period.']);
    const rows = sel.filter((p) => p.ok).map((p) => ({ p, f: lineForecast(p, ctx) }));
    return res('Forecast to shift end', [], { bullets: rows.map(({ p, f }) => !f ? `${p.name}: no production yet.` : f.state === 'early' ? `${p.name}: too early for a forecast.` : f.state === 'closed' ? `${p.name}: shift ended at ${nf(f.projected)} pcs.` : `${p.name}: about ${nf(f.projected)} pcs${f.target ? ` vs ${nf(f.target)} target — ${VERDICT[f.verdict]}; needs ${nf(f.need)} pcs/hr, making ${nf(f.recent)} pcs/hr` : ''}.`), follow: ['Kaunsi line band hai?'] });
  }

  if (has(q, /kyu|kyun|why|problem|issue|dikkat|alert|peeche|behind|kya hua/)) {
    const al = plantAlerts(ctx).filter((a) => a.level !== 'good' && (!lineNums.length || lineNums.includes(a.line)));
    if (!al.length) return res('No problem found', ['No line is offline, stopped or below 90% of target.']);
    return res('What needs attention', [], { bullets: al.slice(0, 8).map((a) => `${a.title} — ${a.detail}`), follow: ['Sabse zyada loss kis line ka?'] });
  }

  if (has(q, /sabse (zyada|jyada)|most|highest|worst|kharab|maximum/) && has(q, /loss|nuksan|short|kam/)) {
    const scope = day ? 'day' : 'period';
    const val = (p) => (scope === 'day' ? p.days[d]?.rsTotal ?? p.days[d]?.short : p.total?.rsTotal ?? p.total?.short);
    const list = ctx.per.filter((p) => p.ok && val(p) != null).sort((a, b) => val(b) - val(a));
    if (!list.length) return res('Biggest loss', ['No line has a target in this period, so no loss can be worked out. Set model targets first.']);
    const w = list[0];
    const x = scope === 'day' ? w.days[d] : w.total;
    return res(`Biggest loss: ${w.name}`, [`${scope === 'day' ? fmtDay(d) : 'Loaded period'}: ${w.name} is short ${nf(x.short)} pcs (${hm(x.lostSec)})${x.rsTotal != null ? ` = ${rupees(x.rsTotal)}` : ''}, ${pc(x.pct)} of target.`],
      { bullets: list.map((p) => { const y = scope === 'day' ? p.days[d] : p.total; return `${p.name}: ${y.rsTotal != null ? rupees(y.rsTotal) : `${nf(y.short)} pcs`}`; }), follow: [`${w.name} kaisi chal rahi hai?`] });
  }
  if (has(q, /sabse (acha|accha|best)|best|top line|highest output|sabse zyada (bana|production)/)) {
    const list = ctx.per.filter((p) => p.ok && p.days[d]).sort((a, b) => (b.days[d].pct ?? -1) - (a.days[d].pct ?? -1) || b.days[d].actual - a.days[d].actual);
    if (!list.length) return res('Best line', [`No production on ${fmtDay(d)}.`]);
    return res(`Best line: ${list[0].name}`, [lineSummary(list[0], ctx, d)], { bullets: list.slice(1).map((p) => lineSummary(p, ctx, d)) });
  }

  if (has(q, /loss|nuksan|rupe|₹|rs\b|paisa|kharcha|cost/)) {
    const period = has(q, /period|month|mahina|week|hafta|total loss|is period|sab din|overall/) && !day;
    if (period) {
      const g = sumLoss(sel.flatMap((p) => Object.values(p.days)));
      return res(`Period loss: ${g.rsTotal != null ? rupees(g.rsTotal, { short: true }) : `${nf(g.short)} pcs`}`, [`${fmtDay(ctx.range?.start)} – ${fmtDay(ctx.range?.end)}${lineNums.length ? ` · ${sel.map((p) => p.name).join(', ')}` : ' · all lines'}: ${nf(g.actual)} pcs${g.target ? `; lines with targets ${nf(g.actualPlanned)} of ${nf(g.target)} pcs (${pc(g.pct)})` : ''}, short ${nf(g.short)} pcs, ${hm(g.lostSec)} lost${g.rsTotal != null ? ` = ${rupees(g.rsTotal)} (${rupees(g.rsPcs)} pieces + ${rupees(g.rsTime)} line time)` : ''}.`],
        { bullets: sel.filter((p) => p.ok).map((p) => `${p.name}: ${p.total?.rsTotal != null ? rupees(p.total.rsTotal) : p.total?.short != null ? `${nf(p.total.short)} pcs short` : 'no targets'}`), follow: ['Sabse zyada loss kis line ka?'] });
    }
    const g = sumLoss(sel.map((p) => p.days[d]).filter(Boolean));
    return res(`Loss ${fmtDay(d)}: ${g.rsTotal != null ? rupees(g.rsTotal) : `${nf(g.short)} pcs`}`, [!ctx.anyRates ? '₹ rates are not set, so the loss is in pieces and time.' : null], { bullets: sel.map((p) => lineSummary(p, ctx, d)), follow: ['Is period ka total loss?'] });
  }

  if (has(q, /target/)) {
    return res(`Target ${fmtDay(d)}`, [], { bullets: sel.map((p) => lineSummary(p, ctx, d)), follow: ['Target poora hoga?'] });
  }

  if (has(q, /reject|false|quality/)) {
    return res(`Rejections ${fmtDay(d)}`, [], { bullets: sel.filter((p) => p.ok).map((p) => { const x = p.days[d]; return `${p.name}: ${nf(x?.rej || 0)} rejected${x?.actual ? ` (${pc(((x.rej || 0) / (x.actual + (x.rej || 0))) * 100)})` : ''}`; }) });
  }

  if (has(q, /running|chal raha|chal rahi|chal rha|model|kaisi|kaisa|status|haal|hal /) || lineNums.length) {
    return res(lineNums.length === 1 ? `${sel[0].name} — ${fmtDay(d)}` : `All lines — ${fmtDay(d)}`, [], {
      bullets: sel.map((p) => `${lineSummary(p, ctx, d)}${d === ctx.today && p.live?.model ? ` Running now: ${p.live.company ? `${p.live.company} · ` : ''}${p.live.model}${p.live.lastScan ? `, last scan ${p.live.lastScan.slice(11, 16)}` : ''}.` : ''}`),
      follow: lineNums.length === 1 ? [`Line ${lineNums[0]} ka loss`, 'Target poora hoga?'] : ['Sabse zyada loss kis line ka?'] });
  }

  if (has(q, /kitna|kitne|total|production|qty|pcs|bana|bani|output|summary|report|overall/)) {
    const g = sumLoss(ctx.per.map((p) => p.days[d]).filter(Boolean));
    return res(`${fmtDay(d)}: ${nf(g.actual)} pcs`, [g.target ? `All lines: ${nf(g.actual)} pcs; lines with targets ${nf(g.actualPlanned)} of ${nf(g.target)} (${pc(g.pct)})${g.rsTotal != null ? `, loss ${rupees(g.rsTotal)}` : ''}.` : null], { bullets: ctx.per.map((p) => lineSummary(p, ctx, d)), follow: ['Sabse zyada loss kis line ka?', 'Target poora hoga?'] });
  }

  return res('Not understood', ['I could not match the question. Try one of these, or type "help".'], { follow: PLANT_SUGGESTIONS.slice(0, 6) });
}

