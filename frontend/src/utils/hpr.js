/**
 * HPR — Hourly Production Report in the plant's own Excel layout. One sheet per day:
 *
 *   B2:C5   TTL Tgt / TTL Ach / Gap / TTL I/T Hrs              E2:F…  Line Loss by department (I/T minutes, negative = lost)
 *   B7:C9   Rate ₹ per man-hour · overtime from · overtime ×   (Setup → HPR; the Loss ₹ formulas use these cells)
 *   row 12  summary per line: TGT/ACH UPH (1st hr), TGT/Ach UPH, Tgt, Prod, Gap, I/T (Hrs), % Ach, Loss ₹, M/P, I/T (min), UPPH
 *   then per line: "TTL MP" row, yellow header, one row per model of every hour (the hour's cells merged over them), TTL row.
 *
 * Formulas as in the plant file (each with its value cached, so a viewer that does not calculate shows the numbers too):
 *   TTL      = SUM(Ach of the hour's models)        Gap = TTL − Tgt
 *   I/T min  = working minutes of the slot ÷ Tgt × Gap        (negative = time lost against the target)
 *   %Eff     = TTL ÷ Tgt                                       Loss ₹ = rate × I/T min ÷ 60 × M/P (× overtime factor)
 *   UPPH     = pieces ÷ M/P (per hour) · day UPPH = pieces ÷ (M/P × working hours)
 *
 * Hour target = the hourly plan of the line screen (hourPlanOf, the line's targets in force); M/P and the times come from that
 * day's morning entry, else the shift master. Reasons, department, owner and part come from the Loss entry page; root cause,
 * action, sustainability, given by and reviewed by from the RCA.
 */
import { hourPlanOf } from './targets';
import { normShift, workSecInHour, hourSpanLabel, toMin } from './shift';
import { normEntry, splitHourTarget } from './ole';
import { targetOf } from './targets';
import { deptName } from './lossan';

const COLS = [3.3, 15, 10, 12.5, 24, 9, 9, 9, 9, 10, 10, 16, 15, 17, 34, 30, 30, 22, 16, 16, 13, 9, 9];
const HEAD = ['Line', 'Date', null, 'Model', 'Tgt ', 'Ach ', 'TTL ', 'Gap', 'I/T (Mins)', '%Efficiency', 'Parts Involved', 'Loss Cont Dept', 'Owner', 'Line Loss Reason',
  'Root Cause', 'Action Taken', 'Sustainability', 'Action Plan given by', 'Action Plan Reviewed by', 'Total Loss (₹)', 'TGT UPPH', 'Ach UPPH'];   // B … W
export const FIRST_HOUR = 9;   // the summary's "1st HR" columns are the 09-10 hour (23-11-2026)
const SUM_HEAD = ['Line', 'Date', 'TGT UPH (1st HR)', 'ACH UPH(1st HR)', 'TGT UPH', 'Ach UPH', 'Tgt', 'Prod', 'Gap', 'I/T (Hrs)', '% Ach', 'Loss (₹)', 'M/P', 'I/T (Minutes)', 'TGT UPPH', 'Ach UPPH'];   // B … Q
const pad = (n) => String(n).padStart(2, '0');
const r2 = (v) => Math.round(v * 100) / 100;
/** Excel date number of 'YYYY-MM-DD'. */
export const excelDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 86400000; };
const L = (i) => String.fromCharCode(65 + i);   // 0 → A … 22 → W (the sheet never goes past W)
const uniq = (a) => [...new Set(a.filter(Boolean))];
const slotText = (lbl) => lbl.split('-').map((p) => (p.includes(':') ? p : `${p}:00`)).join('-');   // '09-10' → '09:00-10:00'

/** Working minutes of a shift ('HH:MM' form): shift − lunch − tea breaks. */
export function workMinOf(shift) {
  const n = normShift(shift);
  return n.end - n.start - n.off.reduce((a, [x, y]) => a + (y - x), 0);
}

/**
 * The hours of one line on one day for the HPR: [{ hour, slot, workMin, ot, target, models: [{model, qty}], qty, reasons: [...] }].
 * rows = oleLineDay rows (hour, models, qty, e / entry, extra, closed); shift = 'HH:MM' shift of that day; targets = targets in force.
 */
/**
 * 21-11-2026: a model with no std cycle (not in the model master) gets the line's average std cycle of that day (weighted
 * by the pieces of the models WITH a std cycle) for the reports — so its pieces get a fair target of their own, its hour
 * is not judged on a few pieces of the other models (a 5-piece target against 171 pieces), and its time never adds to the
 * plan of other models. → { targets (with the filled models marked noStd), noStd: [model names], avg (s) | null }.
 */
export function fillNoStd(targets = {}, rows = []) {
  let s = 0, q = 0; const miss = new Map();
  for (const r of rows || []) for (const m of r.models || []) {
    const n = Number(m.quantity ?? m.qty) || 0; if (!(n > 0)) continue;
    const c = targetOf(targets, m.mmId);
    if (c) { s += c * n; q += n; } else miss.set(String(m.mmId), m.model || `#${m.mmId}`);
  }
  const avg = q > 0 ? Math.round((s / q) * 100) / 100 : null;
  if (!avg || !miss.size) return { targets, noStd: [...miss.values()], avg: null };
  const t = { ...targets };
  for (const [id, model] of miss) t[id] = { cycle: avg, model, noStd: true };
  return { targets: t, noStd: [...new Set(miss.values())], avg };
}

export function hprHours({ rows = [], shift, targets: targets0 = {}, otFrom = '18:00', date, line, rca = {}, lastMin = null }) {
  // lastMin (21-11-2026): minute of the day's actual last scan — the last hour's target and minutes end there (utils/lastScans.js)
  const { targets } = fillNoStd(targets0, rows.filter((r) => !r.closed));
  const hours = rows.filter((r) => !r.closed).map((r) => ({ hour: r.hour, quantity: r.qty, models: r.models || [] }));
  const plan = hourPlanOf({ hours, shift, targets, nowMin: lastMin })?.targets || {};
  const ot = toMin(otFrom);
  // 21-11-2026: a finished day ends at its last scan (OLE "Day ends at: last scan", row.afterLast): the shift hours after
  // it are not in the report — no target for a line that had already stopped for the day, as on the Loss entry page
  return rows.filter((r) => !r.closed && !r.future && !r.afterLast).map((r) => {
    const e = r.e || normEntry(r.entry);
    const reasons = [
      ...e.losses.map((x) => ({ ...x, kind: 'loss' })),
      ...e.stops.map((x) => ({ ...x, kind: 'stop' })),
    ].sort((a, b) => b.min - a.min).map((x) => {
      const rec = x.kind === 'loss' ? rca[`${date}|${line}|loss|${x.reason || 'Not given'}`] || null : null;
      return { reason: x.reason || 'Not given', dept: deptName(x.dept), owner: x.owner || '', part: x.part || '', model: x.model || '', min: x.min, kind: x.kind, rca: rec };
    });
    // 20-11-2026: every model gets its own share of the hour target (by the time it took: pieces × std cycle)
    // an extra hour (before / after the shift) has no plan: its pieces are its target (it never moves the %, as in OLE)
    // 24-11-2026: an extra hour OUTSIDE the shift (08-09 before a 09:00 start, 21-22 at night after a 21:00 end) has no
    // target at all — its pieces are counted, no gap / I/T / %
    const early = !!r.extra;
    const tgt = early ? null : plan[r.hour] ?? null;
    const models = splitHourTarget(tgt, (r.models || []).filter((m) => Number(m.quantity) > 0).map((m) => ({ model: m.model || `#${m.mmId}`, qty: Number(m.quantity) || 0, cycle: targetOf(targets, m.mmId) || null, noStd: !!targets[String(m.mmId)]?.noStd })))
      .map((m) => ({ model: m.model, qty: m.qty, target: m.target, cycle: m.cycle, ...(m.noStd ? { noStd: true } : {}) }));
    const workSec = workSecInHour(shift, r.hour, lastMin);
    const work = Math.round(workSec / 60);
    return {
      hour: r.hour, slot: r.extra ? `${pad(r.hour)}:00-${pad(r.hour + 1)}:00` : slotText(hourSpanLabel(shift, r.hour)),
      workMin: work > 0 ? work : 60, workSec, extra: !!r.extra, early, ot: ot != null && r.hour * 60 >= ot, target: tgt, models, qty: models.reduce((a, m) => a + m.qty, 0), reasons,
    };
  });
}

/**
 * Sheets of the HPR workbook for buildXlsx: one per day.
 *   days     = [{ date, lines: [{ line, mp, shift ('HH:MM' form), hours: hprHours(…), error? }] }]
 *   hpr      = { rate, otFrom, otX }
 */
export function buildHprSheets(days, hpr = {}) {
  const rate = Number(hpr.rate ?? 65), otX = Number(hpr.otX ?? 2), otFrom = hpr.otFrom || '18:00';
  const months = new Set(days.map((d) => d.date.slice(0, 7)));
  return days.map((day) => hprSheet(day, { rate, otX, otFrom, name: months.size > 1 ? `${day.date.slice(8, 10)}-${day.date.slice(5, 7)}` : String(Number(day.date.slice(8, 10))) }));
}

/** an HPR model row's target: a formula over the pieces of the hour's rows (G) and their std cycles (written in it) */
function targetCell(h, a, z, q, mo) {
  const rowsOf = h.models.map((m, i) => ({ r: a + i, m })).filter((x) => x.r <= z);
  if (h.extra || !(h.workSec > 0)) return { f: `G${q}`, v: mo.target, s: 'hprInt' };   // no plan: its pieces are its target
  const withC = rowsOf.filter((x) => x.m.cycle > 0 && x.m.target != null);
  if (!withC.length || !(mo.cycle > 0)) return { v: mo.target, s: 'hprInt' };
  const sec = Math.round(h.workSec);
  const den = withC.map((x) => `G${x.r}*${+x.m.cycle.toFixed(3)}`).join('+');
  const v = Math.round((mo.qty * sec) / withC.reduce((t, x) => t + x.m.qty * x.m.cycle, 0));
  // 24-11-2026 (report audit): the models' targets add up to the hour target of the screens — the last model takes what is
  // left of the rounded hour target (160 = 82 + 1 + 19 + 58, not 159 from four roundings)
  const lastC = withC[withC.length - 1];
  if (withC.length > 1 && lastC.r === q) {
    const all = withC.map((x) => `G${x.r}`).join('+'), others = withC.slice(0, -1).map((x) => `F${x.r}`).join('+');
    const hv = Math.round((withC.reduce((t, x) => t + x.m.qty, 0) * sec) / withC.reduce((t, x) => t + x.m.qty * x.m.cycle, 0));
    const ov = withC.slice(0, -1).reduce((t, x) => t + Math.round((x.m.qty * sec) / withC.reduce((u, y) => u + y.m.qty * y.m.cycle, 0)), 0);
    return { f: `IFERROR(ROUND((${all})*${sec}/(${den}),0)-(${others}),0)`, v: Number.isFinite(hv - ov) ? hv - ov : mo.target, s: 'hprInt' };
  }
  return { f: `IFERROR(ROUND(G${q}*${sec}/(${den}),0),0)`, v: Number.isFinite(v) ? v : mo.target, s: 'hprInt' };
}

function hprSheet(day, { rate, otX, otFrom, name }) {
  const grid = [];   // grid[r][c] (1-based rows, 0-based cols)
  const merges = [];
  const put = (r, c, cell) => { (grid[r] = grid[r] || [])[c] = cell; };
  const dnum = excelDate(day.date);
  const lines = day.lines;

  // ── department split of the lost time (I/T < 0) — an hour with two departments is split by their entered minutes
  const deptMin = new Map();
  for (const ln of lines) {
    for (const h of ln.hours) {
      const it = h.target > 0 ? (h.workMin / h.target) * (h.qty - h.target) : 0;
      if (!(it < 0)) continue;
      const rs = h.reasons.filter((x) => x.min > 0);
      const tot = rs.reduce((a, x) => a + x.min, 0);
      if (!tot) { deptMin.set('Reason not written', (deptMin.get('Reason not written') || 0) + it); continue; }
      for (const x of rs) { const d = x.dept || 'Not set'; deptMin.set(d, (deptMin.get(d) || 0) + it * (x.min / tot)); }
    }
  }
  const depts = [...deptMin.entries()].filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => a[1] - b[1]);

  // ── layout: where every block starts
  const S = Math.max(12, 3 + depts.length + 3);      // summary header row
  const n = lines.length;
  const T = S + n + 1;                               // summary total row
  let r = T + 1;
  const blocks = lines.map((ln) => {
    const b = { ln, m: r, hdr: r + 1, first: r + 2 };
    let rr = b.first;
    b.slots = ln.hours.map((h) => { const k = Math.max(1, h.models.length); const s = { h, a: rr, z: rr + k - 1 }; rr += k; return s; });
    b.last = Math.max(b.first, rr - 1);
    b.tot = b.slots.length ? rr : b.first + 1;
    r = b.tot + 1;
    return b;
  });

  // ── line blocks (built first: the summary refers to their cells and their values)
  for (const b of blocks) {
    const { ln } = b;
    const lineName = `Line-${ln.line}`;
    const mp = ln.mp != null && ln.mp !== '' ? Number(ln.mp) : null;
    const hrs = r2(workMinOf(ln.shift) / 60);
    b.mpv = mp; b.hrs = hrs;
    put(b.m, 1, { v: 'TTL MP', s: 'hprLabel' });
    put(b.m, 2, mp != null ? { v: mp, s: 'hprIntB' } : { v: '', s: 'hprInput' });
    put(b.m, 3, { v: 'Work hrs', s: 'hprLabel' });
    put(b.m, 4, { v: hrs, s: 'hprDecB' });
    const noStd = uniq(ln.hours.flatMap((h) => h.models.filter((m) => m.noStd).map((m) => m.model)));
    put(b.m, 5, { v: `${mp != null ? `Shift ${ln.shift?.start || ''}–${ln.shift?.end || ''}${ln.fromEntry ? ' (morning entry)' : ' (shift master)'}` : 'M/P not entered (morning entry) — fill C for UPPH and Loss ₹'}${noStd.length ? ` · No std cycle in the model master (target at the line's average cycle): ${noStd.join(', ')}` : ''}`, s: 'hprNote' });
    HEAD.forEach((t, i) => put(b.hdr, i + 1, { v: i === 2 ? lineName : t, s: 'hprHead' }));
    const mpRef = `$C$${b.m}`, hrRef = `$E$${b.m}`;
    let sF = 0, sG = 0, sJ = 0, sU = 0, sGn = 0;
    const noT = [];   // first rows of the hours without a target (before the shift): their pieces stay out of the %
    if (ln.error && !b.slots.length) {
      put(b.first, 1, { v: lineName, s: 'hprCenter' }); put(b.first, 2, { v: dnum, s: 'hprDate' });
      put(b.first, 3, { v: `No data — ${ln.error}`, s: 'hprText' }); merges.push(`D${b.first}:W${b.first}`);
    }
    for (const { h, a, z } of b.slots) {
      for (let q = a; q <= z; q++) {
        const mo = h.models[q - a];
        put(q, 1, { v: lineName, s: 'hprCenter' });
        put(q, 2, { v: dnum, s: 'hprDate' });
        put(q, 4, { v: mo?.model || '', s: 'hprCenter' });
        put(q, 6, mo ? { v: mo.qty, s: 'hprInt' } : { v: '', s: 'hprInt' });
        // the model's own target (one row per model); an hour without models keeps the hour target in its row.
        // 23-11-2026: a formula — the hour's working time shared by the pieces at their std cycle:
        //   target = its pieces × working seconds ÷ Σ(pieces × std cycle) of the hour's models
        // so a quantity changed in the sheet moves the time to (or from) the other models of the hour by their cycle time
        put(q, 5, mo && mo.target != null ? targetCell(h, a, z, q, mo) : q === a && h.target != null && !mo ? { v: h.target, s: 'hprInt' } : { v: '', s: 'hprInt' });
      }
      const F = h.target, H = h.qty, I = H - (F || 0);
      const J = F > 0 ? (h.workMin / F) * I : 0;
      const K = F > 0 ? H / F : 0;
      const U = mp != null ? rate * J / 60 * mp * (h.ot ? otX : 1) : 0;
      sF += F || 0; sG += H; sJ += J; sU += U;
      const none = h.early && !(F > 0);
      if (none) { noT.push(a); sGn += H; }
      const ls = h.reasons.filter((x) => x.kind === 'loss' || x.kind === 'stop');
      const rc = ls.map((x) => x.rca).filter(Boolean);
      put(a, 3, { v: h.slot, s: 'hprCenter' });
      const FT = `SUM(F${a}:F${z})`;   // the hour target = the models' targets
      put(a, 7, { f: `SUM(G${a}:G${z})`, v: H, s: 'hprInt' });
      if (none) {
        put(a, 8, { v: '', s: 'hprInt' }); put(a, 9, { v: '', s: 'hprDec' }); put(a, 10, { v: '', s: 'hprPct' });
      } else {
        put(a, 8, { f: `H${a}-${FT}`, v: I, s: 'hprInt' });
        put(a, 9, { f: `IFERROR(${h.workMin}/${FT}*I${a},0)`, v: r2(J), s: 'hprDec' });
        put(a, 10, { f: `IFERROR(H${a}/${FT},0)`, v: K, s: 'hprPct' });
      }
      put(a, 11, { v: uniq(ls.map((x) => x.part)).join(', '), s: 'hprText' });
      put(a, 12, { v: uniq(ls.map((x) => x.dept)).join(' / '), s: 'hprCenter' });
      put(a, 13, { v: uniq(ls.map((x) => x.owner)).join(' / '), s: 'hprCenter' });
      put(a, 14, { v: ls.map((x) => `${x.reason}${x.model ? ` - ${x.model}` : ''} (${Math.round(x.min)} min${x.kind === 'stop' ? ', planned' : ''})`).join('; '), s: 'hprText' });
      put(a, 15, { v: uniq(rc.map((x) => x.rootCause || x.cause)).join('; '), s: 'hprText' });
      put(a, 16, { v: uniq(rc.map((x) => x.action)).join('; '), s: 'hprText' });
      put(a, 17, { v: uniq(rc.map((x) => x.preventive)).join('; '), s: 'hprText' });
      put(a, 18, { v: uniq(rc.map((x) => x.owner || x.updatedBy)).join(' / '), s: 'hprCenter' });
      put(a, 19, { v: uniq(rc.map((x) => x.closedBy)).join(' / '), s: 'hprCenter' });
      put(a, 20, { f: `IFERROR($C$7*J${a}/60*${mpRef}${h.ot ? '*$C$9' : ''},0)`, v: r2(U), s: 'hprDec' });
      put(a, 21, { f: `IFERROR(${FT}/${mpRef},0)`, v: mp ? (F || 0) / mp : 0, s: 'hprDec' });
      put(a, 22, { f: `IFERROR(H${a}/${mpRef},0)`, v: mp ? H / mp : 0, s: 'hprDec' });
      if (z > a) for (const c of [3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) merges.push(`${L(c)}${a}:${L(c)}${z}`);
    }
    const t = b.tot, f = b.first, l = b.last;
    put(t, 1, { v: lineName, s: 'hprTotal' });
    put(t, 4, { v: 'TTL', s: 'hprTotal' });
    put(t, 5, { f: `SUM(F${f}:F${l})`, v: sF, s: 'hprTotal' });
    put(t, 6, { f: `SUM(G${f}:G${l})`, v: sG, s: 'hprTotal' });
    put(t, 7, { f: `SUM(H${f}:H${l})`, v: sG, s: 'hprTotal' });
    const minusN = noT.map((x) => `-H${x}`).join('');   // pieces of the hours without a target: not in the gap / %
    put(t, 8, { f: `SUM(I${f}:I${l})`, v: sG - sGn - sF, s: 'hprTotal' });
    put(t, 9, { f: `SUM(J${f}:J${l})`, v: r2(sJ), s: 'hprTotalDec' });
    put(t, 10, { f: minusN ? `IFERROR((H${t}${minusN})/F${t},0)` : `IFERROR(H${t}/F${t},0)`, v: sF ? (sG - sGn) / sF : 0, s: 'hprTotalPct' });
    put(t, 20, { f: `SUM(U${f}:U${l})`, v: r2(sU), s: 'hprTotalDec' });
    put(t, 21, { f: `IFERROR(F${t}/(${mpRef}*${hrRef}),0)`, v: mp && hrs ? sF / (mp * hrs) : 0, s: 'hprTotalDec' });
    put(t, 22, { f: `IFERROR(G${t}/(${mpRef}*${hrRef}),0)`, v: mp && hrs ? sG / (mp * hrs) : 0, s: 'hprTotalDec' });
    for (const c of [2, 3, 11, 12, 13, 14, 15, 16, 17, 18, 19]) put(t, c, { v: '', s: 'hprTotal' });
    // 1st hour of the summary = the 09-10 hour, as the plant shows it (23-11-2026); a day without a 09-10 hour keeps
    // the first slot with a target (an early start before the shift has none)
    b.minusN = minusN; b.sGn = sGn;
    b.sum = { F: sF, G: sG, J: sJ, U: sU, first: b.slots.find((x) => x.h.hour === FIRST_HOUR && !x.h.extra) || b.slots.find((x) => x.h.target > 0) || b.slots[0] || null };
  }

  // ── summary table
  SUM_HEAD.forEach((t, i) => put(S, i + 1, { v: t, s: 'hprHead' }));
  let tH = 0, tI = 0, tK = 0, tM = 0, tN = 0;   // tN: pieces of hours without a target (not in gap / %)
  blocks.forEach((b, i) => {
    const q = S + 1 + i, s = b.sum, fs = s.first;
    const H = s.F, I = s.G, K = s.J / 60;
    tH += H; tI += I; tK += K; tM += s.U; tN += b.sGn || 0;
    put(q, 1, { v: `Line-${b.ln.line}`, s: 'hprTextB' });
    put(q, 2, fs ? { f: `C${fs.a}`, v: dnum, s: 'hprDateB' } : { v: dnum, s: 'hprDateB' });
    put(q, 3, fs ? { f: `SUM(F${fs.a}:F${fs.z})`, v: fs.h.target ?? 0, s: 'hprIntB' } : { v: '', s: 'hprIntB' });
    put(q, 4, fs ? { f: `H${fs.a}`, v: fs.h.qty, s: 'hprIntB' } : { v: '', s: 'hprIntB' });
    put(q, 5, { f: `IFERROR(H${q}/$E$${b.m},0)`, v: b.hrs ? H / b.hrs : 0, s: 'hprDecB' });
    put(q, 6, { f: `IFERROR(I${q}/$E$${b.m},0)`, v: b.hrs ? I / b.hrs : 0, s: 'hprDecB' });
    put(q, 7, { f: `F${b.tot}`, v: H, s: 'hprIntB' });
    put(q, 8, { f: `G${b.tot}`, v: I, s: 'hprIntB' });
    put(q, 9, b.minusN ? { f: `I${b.tot}`, v: I - b.sGn - H, s: 'hprIntB' } : { f: `I${q}-H${q}`, v: I - H, s: 'hprIntB' });
    put(q, 10, { f: `J${b.tot}/60`, v: r2(K), s: 'hprDecB' });
    put(q, 11, b.minusN ? { f: `IFERROR((I${q}${b.minusN})/H${q},0)`, v: H ? (I - b.sGn) / H : 0, s: 'hprPctB' } : { f: `IFERROR(I${q}/H${q},0)`, v: H ? I / H : 0, s: 'hprPctB' });
    put(q, 12, { f: `U${b.tot}`, v: r2(s.U), s: 'hprRsB' });
    put(q, 13, b.mpv != null ? { f: `C${b.m}`, v: b.mpv, s: 'hprIntB' } : { f: `C${b.m}`, v: 0, s: 'hprIntB' });
    put(q, 14, { f: `K${q}*60`, v: r2(K * 60), s: 'hprDecB' });
    put(q, 15, { f: `IFERROR(F${q}/$N${q},0)`, v: b.mpv && b.hrs ? H / b.hrs / b.mpv : 0, s: 'hprDecB' });
    put(q, 16, { f: `IFERROR(G${q}/$N${q},0)`, v: b.mpv && b.hrs ? I / b.hrs / b.mpv : 0, s: 'hprDecB' });
  });
  const a = S + 1, z = S + n;
  put(T, 1, { v: 'Total', s: 'hprTotal' });
  for (const c of [2, 3, 4, 5, 6, 13, 15, 16]) put(T, c, { v: '', s: 'hprTotal' });
  put(T, 7, { f: `SUM(H${a}:H${z})`, v: tH, s: 'hprTotal' });
  put(T, 8, { f: `SUM(I${a}:I${z})`, v: tI, s: 'hprTotal' });
  put(T, 9, { f: `SUM(J${a}:J${z})`, v: tI - tN - tH, s: 'hprTotal' });
  put(T, 10, { f: `SUM(K${a}:K${z})`, v: r2(tK), s: 'hprTotalDec' });
  put(T, 11, { f: `IFERROR((H${T}+J${T})/H${T},0)`, v: tH ? (tI - tN) / tH : 0, s: 'hprTotalPct' });
  put(T, 12, { f: `SUM(M${a}:M${z})`, v: r2(tM), s: 'hprTotalRs' });
  put(T, 14, { f: `SUM(O${a}:O${z})`, v: r2(tK * 60), s: 'hprTotalDec' });

  // ── top block: totals, rates, line loss by department
  put(2, 1, { v: 'TTL Tgt ', s: 'hprLabel' }); put(2, 2, { f: `H${T}`, v: tH, s: 'hprIntB' });
  put(3, 1, { v: 'TTL Ach ', s: 'hprLabel' }); put(3, 2, { f: `I${T}`, v: tI, s: 'hprIntB' });
  put(4, 1, { v: 'Gap', s: 'hprLabel' }); put(4, 2, { f: `J${T}`, v: tI - tN - tH, s: 'hprIntB' });
  put(5, 1, { v: 'TTL I/T Hrs', s: 'hprLabel' }); put(5, 2, { f: `IFERROR(K${T},0)`, v: r2(tK), s: 'hprDecB' });
  put(7, 1, { v: 'Rate ₹ / man-hr', s: 'hprLabel' }); put(7, 2, { v: rate, s: 'hprInput' });
  put(8, 1, { v: 'Overtime from', s: 'hprLabel' }); put(8, 2, { v: otFrom, s: 'hprInput' });
  put(9, 1, { v: 'Overtime ×', s: 'hprLabel' }); put(9, 2, { v: otX, s: 'hprInput' });
  put(2, 4, { v: 'Line Loss', s: 'hprHead' }); put(2, 5, { v: 'Time (Mins)', s: 'hprHead' });
  depts.forEach(([d, v], i) => { put(3 + i, 4, { v: d, s: 'hprTextB' }); put(3 + i, 5, { v: r2(v), s: 'hprDecB' }); });
  if (depts.length) { const e = 3 + depts.length; put(e, 4, { v: 'Total', s: 'hprTotal' }); put(e, 5, { f: `SUM(F3:F${e - 1})`, v: r2(depts.reduce((x, [, v]) => x + v, 0)), s: 'hprTotalDec' }); }
  else put(3, 4, { v: 'No lost time with a reason', s: 'hprNote' });
  put(2, 7, { v: `Hourly Production Report · ${day.date.slice(8, 10)}-${day.date.slice(5, 7)}-${day.date.slice(0, 4)}`, s: 'hprTitle' });
  put(3, 7, { v: 'I/T = working minutes ÷ Tgt × Gap (negative = time lost). Loss ₹ = C7 × I/T ÷ 60 × M/P (× C9 from C8). Yellow cells can be changed.', s: 'hprNote' });
  put(4, 7, { v: 'Made by Dixon Line Pulse from the line scans, the morning entry, the loss entries and the RCA.', s: 'hprNote' });

  const rows = [];
  for (let i = 1; i < grid.length; i++) rows[i - 1] = (grid[i] || []).map((c) => c ?? null);
  return {
    name, title: `HPR ${day.date}`, cols: COLS.map((width) => ({ width })), rows, merges, portrait: false,
    footer: `&LHPR ${day.date}&RPage &P of &N`,
  };
}
