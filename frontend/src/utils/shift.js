/**
 * Shift and lunch window: the working day in two segments.
 *   Segment 1 = shift start → lunch start, Lunch = lunch start → lunch end (no target), Segment 2 = lunch end → shift end.
 * All times are 'HH:MM' strings; internally minutes of the day.
 */
export const SHIFT_DEFAULT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
// 24-11-2026: the plant's day when a line has neither a morning entry nor a shift master — 09:00–21:00, lunch 13:00–13:30 and the
// tea break 18:30–18:45 (as the supervisors enter it every morning, and as the plant's SAWM KPI file counts it: 11.25 working hours)
export const SHIFT_PLANT = { ...SHIFT_DEFAULT, breaks: [{ name: 'Tea break', start: '18:30', end: '18:45' }] };

const pad = (n) => String(n).padStart(2, '0');
/** 'HH:MM' → minutes of the day (null if not a time). */
export function toMin(t) {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(String(t ?? '').trim());
  if (!m || Number(m[1]) > 24) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
/** minutes of the day → 'HH:MM'. */
export const fmtMin = (m) => `${pad(Math.floor(m / 60))}:${pad(Math.round(m % 60))}`;
const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${Math.round(min % 60)} min` : ''}` : `${Math.round(min)} min`);
export { fmtDur };

export const MAX_BREAKS = 6;
/**
 * Tea breaks and other fixed breaks of a line ([{name, start, end}] as 'HH:MM'): kept only when inside the shift,
 * sorted. Like lunch they are no working time — no target, not in the OLE planned time.
 */
function cleanBreaks(list, st, en) {
  const out = [];
  for (const b of Array.isArray(list) ? list : []) {
    const a = toMin(b?.start), z = toMin(b?.end);
    if (a == null || z == null || z <= a || a < st || z > en) continue;
    out.push({ name: String(b?.name || 'Break').slice(0, 30), from: a, to: z });
  }
  return out.sort((p, q) => p.from - q.from).slice(0, MAX_BREAKS);
}

/** Shift with sensible fallbacks (bad / missing values → default). */
export function normShift(s) {
  const x = { ...SHIFT_DEFAULT, ...(s || {}) };
  let st = toMin(x.start), en = toMin(x.end);
  if (st == null || en == null || en <= st) { st = toMin(SHIFT_DEFAULT.start); en = toMin(SHIFT_DEFAULT.end); }
  let ls = toMin(x.lunchStart), le = toMin(x.lunchEnd);
  if (ls == null || le == null || le <= ls || ls <= st || le >= en) { ls = null; le = null; }
  const breaks = cleanBreaks(x.breaks, st, en);
  // all the no-work windows of the day (lunch + breaks), overlaps merged
  const w = [...(ls != null ? [[ls, le]] : []), ...breaks.map((b) => [b.from, b.to])].sort((p, q) => p[0] - q[0]);
  const off = [];
  for (const [a, z] of w) { const l = off[off.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], z); else off.push([a, z]); }
  return { start: st, end: en, lunchStart: ls, lunchEnd: le, breaks, off };
}

/** No-work minutes (lunch + breaks) between minute a and b of a shift already normalised (normShift). */
export function offMinOf(n, a, b) {
  let t = 0;
  for (const [x, y] of n?.off || []) t += Math.max(0, Math.min(b, y) - Math.max(a, x));
  return t;
}
/** Break minutes only (lunch left out) between a and b of a normalised shift. */
export function breakMinOf(n, a, b) {
  return offMinOf(n, a, b) - (n?.lunchStart == null ? 0 : Math.max(0, Math.min(b, n.lunchEnd) - Math.max(a, n.lunchStart)));
}

/** The day's parts: [{key, label, from, to, work}] — 's1', 'lunch', 's2' (or one 'shift' part without lunch). */
export function segments(shift) {
  const s = normShift(shift);
  if (s.lunchStart == null) return [{ key: 'shift', label: 'Shift', from: s.start, to: s.end, work: true }];
  return [
    { key: 's1', label: 'Segment 1', from: s.start, to: s.lunchStart, work: true },
    { key: 'lunch', label: 'Lunch', from: s.lunchStart, to: s.lunchEnd, work: false },
    { key: 's2', label: 'Segment 2', from: s.lunchEnd, to: s.end, work: true },
  ];
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Working seconds of clock hour h (lunch excluded). nowMin (minutes of the day, may be fractional) cuts the time
 * at "now" for today's running hour; future time counts 0.
 */
export function workSecInHour(shift, h, nowMin = null) {
  const s = normShift(shift);
  const a = h * 60, b = Math.min(h * 60 + 60, nowMin == null ? Infinity : nowMin);
  if (b <= a) return 0;
  const x = Math.max(a, s.start), y = Math.min(b, s.end);
  if (y <= x) return 0;
  return Math.max(0, y - x - offMinOf(s, x, y)) * 60;   // lunch and tea breaks are no working time
}

/**
 * Label of clock hour h with the lunch (and shift start / end) cut off: lunch 13:00–13:30 → hour 13 = '13:30-14';
 * an hour without a cut stays '09-10'.
 */
export function hourSpanLabel(shift, h) {
  const s = normShift(shift);
  const hm = (m) => (m % 60 ? fmtMin(m) : pad(Math.floor(m / 60)));
  const h0 = h * 60, h1 = h0 + 60;
  let a = h0, b = h1;
  if (s.start > a && s.start < b) a = s.start;
  if (s.end > a && s.end < b) b = s.end;
  if (s.lunchStart != null) {
    if (s.lunchStart <= a && s.lunchEnd > a) a = s.lunchEnd;          // lunch at the start of the hour
    else if (s.lunchStart > a && s.lunchStart < b && s.lunchEnd >= b) b = s.lunchStart; // lunch at the end of the hour
  }
  return a < b ? `${hm(a)}-${hm(b)}` : `${hm(h0)}-${hm(h1)}`;
}

/**
 * Real cycle of the day: time from the first to the last scan (lunch taken out) ÷ the gaps between the pieces.
 * Every stop counts — no 22 s limit. first / last = 'YYYY-MM-DD HH:MM:SS'. null when it cannot be worked out.
 */
export function realCycleSec(shift, first, last, pieces) {
  const t = (v) => { const m = /(\d{2}):(\d{2}):(\d{2})/.exec(String(v || '')); return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60 : null; };
  const a = t(first), b = t(last);
  if (a == null || b == null || !(pieces > 1) || b <= a) return null;
  const s = normShift(shift);
  const min = b - a - offMinOf(s, a, b);   // lunch and breaks taken out
  return min > 0 ? Math.round(((min * 60) / (pieces - 1)) * 10) / 10 : null;
}

/**
 * Actual cycle of the model running now: its continuous run since the line last changed to it —
 * (last scan − first scan of the run − lunch / tea breaks) ÷ (pieces − 1). No gap is taken out (a stop inside the run
 * counts), so it is the real speed of the model; the old "gaps 1–22 s" average is only a fallback while the server has no run.
 */
export function runCycleOf(shift, run) {
  if (!run) return null;
  const c = realCycleSec(shift, run.runFirst, run.runLast ?? run.lastScan, run.runQty);
  return c ?? (run.runFirst ? null : run.avgCycle ?? null);
}

/** Lunch minutes inside clock hour h. */
export function lunchMinInHour(shift, h) {
  const s = normShift(shift);
  return s.lunchStart == null ? 0 : overlap(h * 60, h * 60 + 60, s.lunchStart, s.lunchEnd);
}

/** Clock hours touched by the shift: [9, 10, …, 20] for 09:00–21:00. */
export function shiftHours(shift) {
  const s = normShift(shift);
  const out = [];
  for (let h = Math.floor(s.start / 60); h * 60 < s.end; h++) out.push(h);
  return out;
}

/** Readable text: "09:00–13:00 · Lunch 13:00–13:30 · 13:30–21:00 (11 h 30 min)". */
export function shiftText(shift) {
  const s = normShift(shift);
  const total = (s.end - s.start) - (s.lunchStart != null ? s.lunchEnd - s.lunchStart : 0);
  return s.lunchStart == null
    ? `${fmtMin(s.start)}–${fmtMin(s.end)} (${fmtDur(total)})`
    : `${fmtMin(s.start)}–${fmtMin(s.lunchStart)} · Lunch ${fmtMin(s.lunchStart)}–${fmtMin(s.lunchEnd)} · ${fmtMin(s.lunchEnd)}–${fmtMin(s.end)} (${fmtDur(total)} working)`;
}

/**
 * Rows of an hourly table with the lunch window as its own row.
 * An hour that holds (part of) the lunch is split into the lunch part and the worked part, in time order:
 *   lunch 13:00–13:30 → [… 12, {lunch 13:00–13:30}, {work 13:30–14:00}, 14 …]
 * Each row: { key, kind: 'hour' | 'lunch' | 'work', hour, from, to, label, min (minutes) }.
 */
export function splitHours(shift, hours) {
  const s = normShift(shift);
  const out = [];
  for (const h of hours) {
    const a = h * 60, b = a + 60;
    const la = s.lunchStart == null ? null : Math.max(a, s.lunchStart), lb = s.lunchStart == null ? null : Math.min(b, s.lunchEnd);
    if (la == null || lb <= la) { out.push({ key: `h${h}`, kind: 'hour', hour: h, from: a, to: b, label: `${pad(h)}-${pad(h + 1)}`, min: 60 }); continue; }
    const lunch = { key: `l${h}`, kind: 'lunch', hour: h, from: la, to: lb, label: `Lunch ${fmtMin(la)}–${fmtMin(lb)}`, min: lb - la };
    const workMin = 60 - (lb - la);
    const work = workMin > 0
      ? { key: `w${h}`, kind: 'work', hour: h, from: la === a ? lb : a, to: la === a ? b : la, min: workMin,
          label: la > a && lb < b ? `${fmtMin(a)}–${fmtMin(la)} + ${fmtMin(lb)}–${fmtMin(b)}` : la === a ? `${fmtMin(lb)}–${fmtMin(b)}` : `${fmtMin(a)}–${fmtMin(la)}` }
      : null;
    if (la === a) { out.push(lunch); if (work) out.push(work); } else { if (work) out.push(work); out.push(lunch); }
  }
  return out;
}

/**
 * Morning entry of a line and day (api/ole.php setup: start, end, lunchStart, lunchEnd, breaks) as a shift the screens
 * use instead of the shift master for that day, or null when there is none.
 */
export function setupShift(su) {
  if (!su || !su.start || !su.end) return null;
  return { start: su.start, end: su.end, lunchStart: su.lunchStart || '', lunchEnd: su.lunchEnd || '', breaks: Array.isArray(su.breaks) ? su.breaks : [] };
}
/** The shift of a line on a day: its morning entry, else the master. setups = { "date|line": setup }. */
export const shiftOfDay = (setups, date, line, master) => setupShift(setups?.[`${date}|${line}`]) || master || null;

/**
 * 23-11-2026: the hour detail of an hour with lunch in it (13:00–14:00 with lunch 13:00–13:30): the scans made during
 * lunch are told apart from the worked part, as the Hourly matrix shows them (13:30–14:00 row + Lunch row).
 * detail = hour_detail.php { hour, models:[{mmId, quantity}], scans:[{mmId, scanDate}] } →
 * null (no lunch in the hour) | { from, to, workSec, lunchQty, workQty, byModel: { mmId: { work, lunch } }, theo (s per piece) }
 */
export function lunchSplitOf(detail, shift) {
  if (!detail || detail.hour == null) return null;
  const s = normShift(shift);
  const h = Number(detail.hour);
  if (s.lunchStart == null || !(lunchMinInHour(shift, h) > 0)) return null;
  const a = Math.max(h * 60, s.lunchStart), b = Math.min(h * 60 + 60, s.lunchEnd);
  const byModel = {};
  let lunchQty = 0;
  for (const sc of detail.scans || []) {
    const m = String(sc.scanDate || '').match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
    const o = byModel[sc.mmId] || (byModel[sc.mmId] = { work: 0, lunch: 0 });
    if (t >= a && t < b) { o.lunch += 1; lunchQty += 1; } else o.work += 1;
  }
  const total = Number(detail.totalQuantity) || (detail.models || []).reduce((x, m) => x + (Number(m.quantity) || 0), 0);
  const workQty = Math.max(0, total - lunchQty);
  const workSec = workSecInHour(shift, h);
  const p = (n) => String(n).padStart(2, '0');
  return { from: `${p(Math.floor(a / 60))}:${p(Math.round(a % 60))}`, to: `${p(Math.floor(b / 60))}:${p(Math.round(b % 60))}`,
    workSec, lunchQty, workQty, byModel, theo: workQty > 0 && workSec > 0 ? Math.round(workSec / workQty) : null };
}
