/* Standard cycle time — two methods, computed in the browser so every setting change is instant.
 *
 *  A · Window average
 *      every scan gap of the model in the period that lies inside [min, max] (default 1 … 22 s)
 *      std = mean of those gaps
 *
 *  B · Continuous run
 *      the model's own pieces, one after another on the line (same day).
 *      A run CONTINUES while
 *        - the gap to the previous piece is not a stop  (gap ≤ breakSec)
 *        - at most `maxRework` scans of OTHER models sit between two pieces (rework → ignored)
 *      A run is VALID when it has at least `minPieces` pieces.
 *      clean cycle = Σ gaps with NO rework next to them AND inside [min, max] ÷ count  (rework and stops ignored)
 *      incl. cycle = Σ all gaps of the run ÷ count                              (rework time kept, stops below breakSec kept)
 *      std (B)     = Σ over valid runs of the clean gaps ÷ their count
 */

/* ───────── kg from the model name / code (e.g. "PLAIN 6.5KG", "Glagg 7 kg") ───────── */
export const KG_RE = /(\d+(?:[.,]\d+)?)\s*kg/i;

export function kgOf(...names) {
  for (const n of names) {
    const m = String(n ?? '').match(KG_RE);
    if (m) return Number(m[1].replace(',', '.'));
  }
  return null;
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const stdev = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/* ───────── Method A ───────── */
/** days = { 'YYYY-MM-DD': { g: [gap…], o: aboveCapCount } } as sent by model_control.php */
export function windowStd(days, { min = 1, max = 22 } = {}) {
  const vals = [];
  const daily = [];
  let below = 0, above = 0;
  for (const d of Object.keys(days || {}).sort()) {
    const day = days[d];
    const kept = [];
    for (const v of day.g || []) {
      if (v < min) below++;
      else if (v > max) above++;
      else { kept.push(v); vals.push(v); }
    }
    above += day.o || 0; // gaps above the data cap are above max too
    if (kept.length) daily.push({ date: d, n: kept.length, mean: mean(kept) });
  }
  const m = mean(vals);
  const sd = stdev(vals);
  return {
    n: vals.length, mean: m, median: median(vals), sd, cv: m && sd != null ? (sd / m) * 100 : null,
    min, max, below, above, daily,
  };
}

/* ───────── Method B ───────── */
/** rows = [ [date, hour, gapSec|null, rework], … ] of ONE model in time order (model_runs.php) */
export function continuousRuns(rows, { minPieces = 200, maxRework = 3, breakSec = 300, minGap = 0, maxGap = Infinity } = {}) {
  const runs = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    runs.push({
      date: cur.date, startHour: cur.startHour, pieces: cur.pieces, rework: cur.rework,
      valid: cur.pieces >= minPieces,
      clean: cur.cleanGaps ? cur.cleanSpan / cur.cleanGaps : null,
      incl: cur.allGaps ? cur.allSpan / cur.allGaps : null,
      cleanGaps: cur.cleanGaps, cleanSpan: cur.cleanSpan, allGaps: cur.allGaps, allSpan: cur.allSpan,
    });
    cur = null;
  };
  for (const [d, h, gRaw, rwRaw] of rows) {
    // numbers may arrive as strings from PHP/JSON: "12" + "10" must not concatenate, and "0" must count as no rework
    const g = gRaw == null || gRaw === '' || !Number.isFinite(Number(gRaw)) ? null : Number(gRaw);
    const rw = Number(rwRaw) || 0;
    // first piece of the day (or a new day: a run never spans two days), a stop, or too much rework
    const brk = g == null || (cur != null && d !== cur.date) || rw > maxRework || g > breakSec;
    if (brk) flush();
    if (!cur) cur = { date: d, startHour: h, pieces: 0, rework: 0, cleanSpan: 0, cleanGaps: 0, allSpan: 0, allGaps: 0 };
    cur.pieces++;
    if (!brk) {
      cur.allSpan += g; cur.allGaps++;
      cur.rework += rw;
      // clean = no rework next to this gap AND the gap is a normal cycle (same Min–Max window as Method A)
      if (rw === 0 && g >= minGap && g <= maxGap) { cur.cleanSpan += g; cur.cleanGaps++; }
    }
  }
  flush();
  return runs;
}

/** Totals over the VALID runs only. */
export function runStd(runs) {
  const valid = runs.filter((r) => r.valid);
  const sum = (k) => valid.reduce((s, r) => s + r[k], 0);
  const cleanGaps = sum('cleanGaps'), allGaps = sum('allGaps');
  return {
    totalRuns: runs.length,
    validRuns: valid.length,
    pieces: sum('pieces'),
    rework: sum('rework'),
    clean: cleanGaps ? sum('cleanSpan') / cleanGaps : null,
    incl: allGaps ? sum('allSpan') / allGaps : null,
    medianRun: median(valid.map((r) => r.clean).filter((v) => v != null)),
  };
}
