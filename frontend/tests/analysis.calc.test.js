// Calculation tests for src/utils/analysis.js (cycle vs takt KPIs) and src/utils/loss.js (hour-wise loss),
// cross-checked against the real API fixtures.
import { describe, it, expect } from 'vitest';
import { computeAnalysis, windowHours } from '../src/utils/analysis';
import { buildHourLoss, resolveStd, localDate } from '../src/utils/loss';
import day from './fixtures/day_overview.json';
import range from './fixtures/range_overview.json';
import analytics from './fixtures/analytics.json';

const SETTINGS = { taktSec: 45, startHour: 9, endHour: 21, lunchHour: 13, models: {} };
const OTHER_DAY = new Date(2026, 9, 23, 12, 0, 0);   // "now" is not the focus day → whole window counts
const sum = (a) => a.reduce((s, v) => s + v, 0);

describe('fixture consistency (API totals = sum of parts)', () => {
  it('day overview: total = Σ hours, samples = analytics daily n', () => {
    const H = day.hourly;
    expect(sum(H.hours.map((h) => h.quantity))).toBe(H.totalQuantity);                 // 820
    expect(H.hours.filter((h) => h.quantity > 0).length).toBe(H.activeHours);          // 11
    expect(sum(H.hours.map((h) => h.idleSeconds))).toBe(H.idleSeconds);                // 30 + 2650 + 360 = 3040
    const n = sum(H.hours.map((h) => h.cycleSamples));
    expect(n).toBe(analytics.daily.find((d) => d.date === H.date).n);                  // 787
    expect((H.activeHours * 3600) / H.totalQuantity).toBeCloseTo(H.dayTheoreticalCycleSeconds, 1);
  });
  it('range overview: total = Σ days, idle = Σ days, models add up', () => {
    const D = range.daily;
    expect(sum(D.days.map((d) => d.quantity))).toBe(D.totalQuantity);                  // 4188
    expect(sum(D.days.map((d) => d.idleSeconds))).toBe(D.idleSeconds);                 // 5440
    expect(sum(D.days.map((d) => d.idleGaps))).toBe(D.idleGaps);                       // 3
    const models = [...range.models.models, ...range.models.lowVolumeModels];
    expect(sum(models.map((m) => m.quantity))).toBe(D.totalQuantity);
    for (const m of range.models.models) expect(sum(m.hourly.map((h) => h.quantity))).toBe(m.quantity);
    expect(analytics.overall.scans).toBe(D.totalQuantity);
    expect(sum(analytics.daily.map((d) => d.qty))).toBe(D.totalQuantity);
  });
});

describe('windowHours', () => {
  it('start … end−1 without the lunch hour', () => {
    expect(windowHours(SETTINGS)).toEqual([9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20]);
    expect(windowHours({ startHour: 9, endHour: 12, lunchHour: null })).toEqual([9, 10, 11]);
    expect(windowHours({ startHour: 9, endHour: 9, lunchHour: 13 })).toEqual([]);
  });
});

describe('computeAnalysis — finished day (fixture 2026-10-05)', () => {
  const A = computeAnalysis({ summary: day.hourly, models: range.models.models, settings: SETTINGS, focusDate: '2026-10-05', now: OTHER_DAY });
  const k = A.kpis;
  // hand-computed from the fixture: Σ avg·samples = 37 825.3 over 787 samples
  const avg = 37825.3 / 787;

  it('plan, target and available time', () => {
    expect(k.availSec).toBe(11 * 3600);
    expect(k.target).toBe(880);                 // 39 600 / 45
    expect(k.qty).toBe(820);
    expect(k.outsideQty).toBe(0);
    expect(k.live).toBe(false);
    expect(k.projected).toBeNull();
  });
  it('cycle KPIs: sample-weighted average, theoretical = active time ÷ qty', () => {
    expect(k.avgActual).toBeCloseTo(avg, 9);
    expect(k.avgActual).toBeCloseTo(day.hourly.dayAvgActualCycleSeconds, 1);   // server: 48.1
    expect(k.theoretical).toBeCloseTo(39600 / 820, 9);                          // 48.29
    expect(k.theoretical).toBeCloseTo(day.hourly.dayTheoreticalCycleSeconds, 1);
    expect(k.demonstratedTakt).toBeCloseTo(39600 / 820, 9);
    expect(k.activeHours).toBe(11);
    expect(k.utilization).toBe(100);
  });
  it('takt ratios', () => {
    expect(k.achievement).toBeCloseTo((820 / 880) * 100, 9);
    expect(k.cycleVsTakt).toBeCloseTo((avg / 45) * 100, 9);
    expect(k.efficiency).toBeCloseTo((45 / avg) * 100, 9);
  });
  it('idle time inside the window only (lunch hour 13 excluded)', () => {
    expect(k.idleSec).toBe(30 + 360);
    expect(k.idleGaps).toBe(2);
  });
  it('hour rows: plan 80/hr, status ≥100 % ok, ≥90 % watch, else behind', () => {
    const h = A.hours;
    expect(h.map((x) => x.hour)).toEqual([9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20]);
    expect(h.every((x) => x.plan === 80)).toBe(true);
    // qty 73 76 70 81 78 70 72 77 75 70 78
    expect(h.map((x) => x.status)).toEqual(['watch', 'watch', 'behind', 'ok', 'watch', 'behind', 'watch', 'watch', 'watch', 'behind', 'watch']);
    expect(h[0].qtyPct).toBeCloseTo(91.25, 9);
    expect(h[0].gapVsTakt).toBeCloseTo(46.9 - 45, 9);
    expect(h[10].cumActual).toBe(820);
    expect(h[10].cumPlan).toBe(880);
    expect(h[3].cumActual).toBe(73 + 76 + 70 + 81);
  });
  it('model rows: ratio vs takt and lost seconds', () => {
    const m1 = A.modelRows.find((m) => m.mmId === 1);
    expect(m1.ratio).toBeCloseTo(38 / 45, 9);
    expect(m1.status).toBe('ok');
    expect(m1.lostSec).toBe((38 - 45) * 2207);
  });
  it('per-model takt override', () => {
    const B = computeAnalysis({ summary: day.hourly, models: range.models.models, settings: { ...SETTINGS, models: { 1: 35 } }, focusDate: '2026-10-05', now: OTHER_DAY });
    const m1 = B.modelRows.find((m) => m.mmId === 1);
    expect([m1.takt, m1.ownTakt, m1.status]).toEqual([35, true, 'watch']);    // 38 / 35 = 1.086 → (1, 1.1] = watch
  });
});

describe('computeAnalysis — live day (synthetic, hand-computed)', () => {
  const summary = { totalQuantity: 250, hours: [{ hour: 9, quantity: 100 }, { hour: 10, quantity: 100 }, { hour: 11, quantity: 50 }] };
  const settings = { taktSec: 36, startHour: 9, endHour: 14, lunchHour: 12, models: {} };   // window 9, 10, 11, 13
  const now = new Date(2026, 9, 5, 11, 30, 0);
  const A = computeAnalysis({ summary, models: [], settings, focusDate: localDate(now), now });
  const k = A.kpis;

  it('elapsed window, plan-to-now and projection', () => {
    expect(k.elapsedWin).toBe(2.5);
    expect(k.live).toBe(true);
    expect(k.target).toBe(400);                 // 4 h · 3600 / 36
    expect(k.planToNow).toBe(250);              // 100/hr · 2.5 h
    expect(k.achievement).toBe(100);            // 250 / 250
    expect(k.projected).toBe(400);              // 250 + 100/hr · 1.5 h
  });
  it('partial hour counts as half an hour of active time', () => {
    expect(k.theoretical).toBe(9000 / 250);     // (3600 + 3600 + 1800) / 250
    expect(k.utilization).toBe(100);
    const h11 = A.hours.find((h) => h.hour === 11);
    expect([h11.partial, h11.plan, h11.status]).toEqual([true, 50, 'ok']);
    const h13 = A.hours.find((h) => h.hour === 13);
    expect([h13.future, h13.status, h13.cumActual, h13.cumPlan]).toEqual([true, 'future', null, null]);
  });
  it('projection insight', () => {
    expect(A.insights.some((i) => i.title === 'Projection: 400 pcs — target of 400 will be reached' && i.level === 'good')).toBe(true);
  });
});

describe('computeAnalysis — edge cases', () => {
  it('no summary → null', () => {
    expect(computeAnalysis({ summary: null, settings: SETTINGS })).toBeNull();
  });
  it('no takt → no target / ratios, "Takt time is not set" insight', () => {
    const A = computeAnalysis({ summary: day.hourly, models: [], settings: { ...SETTINGS, taktSec: null }, focusDate: '2026-10-05', now: OTHER_DAY });
    expect([A.kpis.target, A.kpis.achievement, A.kpis.cycleVsTakt, A.kpis.planToNow]).toEqual([null, null, null, null]);
    expect(A.insights.some((i) => i.title === 'Takt time is not set')).toBe(true);
  });
  it('a day without production: zero qty, no division by zero', () => {
    const A = computeAnalysis({ summary: { totalQuantity: 0, hours: [] }, models: [], settings: SETTINGS, focusDate: '2026-10-05', now: OTHER_DAY });
    expect([A.kpis.qty, A.kpis.theoretical, A.kpis.avgActual, A.kpis.demonstratedTakt, A.kpis.utilization]).toEqual([0, null, null, null, 0]);
    expect(A.hours.every((h) => h.status === 'idle')).toBe(true);
  });
});

describe('resolveStd', () => {
  it('manual > clean actual average > fallback', () => {
    expect(resolveStd({ 7: '25' }, { mmId: 7, avgActualCycleSeconds: 30 })).toEqual({ sec: 25, auto: false });
    expect(resolveStd({ 7: 0 }, { mmId: 7, avgActualCycleSeconds: 30 })).toEqual({ sec: 30, auto: true });
    expect(resolveStd(null, { mmId: 7, avgActualCycleSeconds: null }, 22)).toEqual({ sec: 22, auto: true });
    expect(resolveStd({}, { mmId: 7 })).toEqual({ sec: null, auto: true });
  });
});

describe('buildHourLoss', () => {
  const settings = { startHour: 9, endHour: 11, lunchHour: null };
  const models = [
    { mmId: 1, model: 'A', quantity: 60, avgActualCycleSeconds: 20, hourly: [{ hour: 9, quantity: 60 }] },
    { mmId: 2, model: 'B', quantity: 40, avgActualCycleSeconds: 30, hourly: [{ hour: 9, quantity: 40 }] },
  ];
  const summary = { hours: [{ hour: 9, quantity: 100 }, { hour: 10, quantity: 0 }] };

  it('time used = Σ qty × std; loss = available − used, split pro rata', () => {
    // std A = 20 (auto), std B = 25 (manual) → used 1200 + 1000 = 2200 → loss 1400
    const L = buildHourLoss({ summary, models, stds: { 2: 25 }, settings, focusDate: '2026-10-05', now: OTHER_DAY });
    const [h9, h10] = L.rows;
    expect([h9.usedSec, h9.lossSec, h9.stdMix]).toEqual([2200, 1400, 22]);
    expect(h9.targetQty).toBeCloseTo(3600 / 22, 9);
    const a = h9.models.find((m) => m.mmId === 1), b = h9.models.find((m) => m.mmId === 2);
    expect(a.lossSec).toBeCloseTo((1400 * 1200) / 2200, 9);
    expect(b.lossSec).toBeCloseTo((1400 * 1000) / 2200, 9);
    expect(a.lossSec + b.lossSec).toBeCloseTo(1400, 9);
    expect([b.stdSec, b.stdAuto]).toEqual([25, false]);
    // an idle hour is all loss
    expect([h10.qty, h10.lossSec, h10.targetQty]).toEqual([0, 3600, null]);
    expect(L.totals).toEqual({ qty: 100, target: 3600 / 22, lossSec: 5000, availSec: 7200 });
    expect([L.scaled, L.hasData]).toEqual([false, true]);
  });

  it('model quantities are scaled to the hour total', () => {
    // hour total 50, models 60 + 40 → ×0.5 → 30·20 + 20·30 = 1200 → loss 2400
    const L = buildHourLoss({ summary: { hours: [{ hour: 9, quantity: 50 }] }, models, stds: {}, settings, focusDate: '2026-10-05', now: OTHER_DAY });
    expect(L.scaled).toBe(true);
    expect(L.rows[0].models.map((m) => m.qty)).toEqual([30, 20]);
    expect(L.rows[0].lossSec).toBe(2400);
  });

  it('no model breakdown → qty-weighted average cycle as fallback std', () => {
    // fallback = (60·20 + 40·30) / 100 = 24 → used 2400 → loss 1200
    const bare = models.map(({ hourly, ...m }) => m);
    const L = buildHourLoss({ summary, models: bare, stds: {}, settings, focusDate: '2026-10-05', now: OTHER_DAY });
    expect([L.rows[0].usedSec, L.rows[0].lossSec]).toEqual([2400, 1200]);
  });

  it('no standard at all → loss unknown (null), not 3600', () => {
    const L = buildHourLoss({ summary, models: [], stds: {}, settings, focusDate: '2026-10-05', now: OTHER_DAY });
    expect(L.rows[0].lossSec).toBeNull();
  });

  it('today: running hour uses elapsed seconds, future hours are skipped', () => {
    const now = new Date(2026, 9, 5, 9, 30, 15);
    const L = buildHourLoss({ summary, models, stds: { 2: 25 }, settings, focusDate: localDate(now), now });
    expect(L.rows).toHaveLength(1);
    expect([L.rows[0].availSec, L.rows[0].partial, L.rows[0].lossSec]).toEqual([1815, true, 0]);   // 2200 s used > 1815 s
  });

  it('fixture: model-wise loss adds up to the hour loss and model qty to the hour qty', () => {
    const L = buildHourLoss({ summary: day.hourly, models: range.models.models, low: range.models.lowVolumeModels, stds: {}, settings: SETTINGS, focusDate: '2026-10-05', now: OTHER_DAY });
    expect(L.rows).toHaveLength(11);
    expect(L.scaled).toBe(true);                         // range quantities scaled to one day
    expect(L.totals.qty).toBe(820);
    expect(L.totals.availSec).toBe(11 * 3600);
    for (const r of L.rows) {
      expect(sum(r.models.map((m) => m.qty))).toBeCloseTo(r.qty, 9);
      expect(sum(r.models.map((m) => m.lossSec))).toBeCloseTo(r.lossSec, 6);
      expect(r.lossSec).toBe(Math.max(0, 3600 - r.usedSec));
    }
    // hour 9 by hand: raw 194 / x / y per model, k = 73 / Σraw, used = Σ raw·k·avg
    const raw = range.models.models.map((m) => [m.hourly.find((h) => h.hour === 9)?.quantity || 0, m.avgActualCycleSeconds]);
    const kk = 73 / sum(raw.map(([q]) => q));
    expect(L.rows[0].usedSec).toBeCloseTo(sum(raw.map(([q, a]) => q * kk * a)), 9);
  });

  it('no summary → null', () => {
    expect(buildHourLoss({ summary: null, settings })).toBeNull();
  });
});
