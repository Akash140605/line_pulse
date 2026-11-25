/* Cycle-time loss vs a target cycle time (client side, instant).
 *
 *  extra  = actual − target            (only cycles slower than the target are a loss)
 *  loss   = Σ extra                    (seconds)
 *  lost pieces = loss ÷ target         (pieces that could have been made in that time)
 *  % of run time = loss ÷ Σ actual     (of the cycles compared)
 *
 * basis:  'valid' → only gaps inside the Min–Max window (normal cycles)
 *         'upto'  → every gap ≤ Max (valid + removed-below-Min)
 *         'all'   → everything, also gaps above Max (stops, changeovers)
 * onlyBin: when a "second" bin is picked, totals / byDay / byHour / samples are restricted to that bin,
 *          while `bins` always describe the full picture (for the chart and the table).
 * Bin s = (s−1, s] seconds; the last bin holds everything above Max (same as secondCounts in spc.js).
 */
export function lossAnalysis(days, win, maxSec, target, basis = 'valid', onlyBin = null) {
  const top = Math.max(1, Math.ceil(maxSec));
  const OVER = top + 1;
  const T = Number(target) > 0 ? Number(target) : 0;
  const bins = Array.from({ length: top + 2 }, (_, i) => ({
    sec: i, over: i === OVER, label: i === OVER ? `>${maxSec}s` : `${i}s`, n: 0, sum: 0, slowN: 0, slowSum: 0, loss: 0,
  }));
  const byDay = {}, byHour = {};
  const out = { target: T, basis, n: 0, time: 0, slowN: 0, slowSum: 0, fastN: 0, loss: 0, gain: 0, capN: 0, samples: [] };

  for (const d of Object.keys(days).sort()) {
    const { g, h, o } = days[d];
    if (basis === 'all' && o && onlyBin === null) out.capN += o;
    for (let i = 0; i < g.length; i++) {
      const v = g[i];
      const inc = basis === 'valid' ? (v >= win.lo && v <= win.hi) : basis === 'upto' ? v <= maxSec : true;
      if (!inc) continue;
      const bi = v > maxSec ? OVER : Math.min(top, Math.ceil(v));
      const b = bins[bi];
      const extra = v - T;
      const slow = T > 0 && extra > 0;
      b.n++; b.sum += v;
      if (slow) { b.slowN++; b.slowSum += v; b.loss += extra; }
      if (onlyBin !== null && bi !== onlyBin) continue;

      out.n++; out.time += v;
      const dd = byDay[d] || (byDay[d] = { date: d, n: 0, time: 0, slowN: 0, loss: 0 });
      const hh = byHour[h[i]] || (byHour[h[i]] = { hour: h[i], n: 0, time: 0, slowN: 0, loss: 0 });
      dd.n++; dd.time += v; hh.n++; hh.time += v;
      if (slow) {
        out.slowN++; out.slowSum += v; out.loss += extra;
        dd.slowN++; dd.loss += extra; hh.slowN++; hh.loss += extra;
        const s = out.samples;
        if (s.length < 6 || extra > s[s.length - 1].extra) {
          s.push({ d, h: h[i], v, extra }); s.sort((x, y) => y.extra - x.extra); if (s.length > 6) s.length = 6;
        }
      } else if (T > 0) { out.fastN++; out.gain += T - v; }
    }
  }

  const allLoss = bins.reduce((s, b) => s + b.loss, 0);
  let run = 0;
  const outBins = bins.map((b) => {
    run += b.loss;
    return { ...b, avg: b.n ? b.sum / b.n : null, avgSlow: b.slowN ? b.slowSum / b.slowN : null, extraPer: b.slowN ? b.loss / b.slowN : 0,
      share: allLoss ? (b.loss / allLoss) * 100 : 0, cum: allLoss ? (run / allLoss) * 100 : 0 };
  });
  return {
    ...out,
    lostPcs: T > 0 ? out.loss / T : 0,
    pctTime: out.time > 0 ? (out.loss / out.time) * 100 : 0,
    avgExtra: out.slowN ? out.loss / out.slowN : 0,
    avgSlow: out.slowN ? out.slowSum / out.slowN : null,
    avgActual: out.n ? out.time / out.n : null,
    allLoss, bins: outBins, OVER,
    days: Object.values(byDay).sort((a, b) => (a.date < b.date ? -1 : 1)),
    hours: Object.values(byHour).sort((a, b) => a.hour - b.hour),
  };
}
