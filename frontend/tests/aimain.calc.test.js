// AI analysis for all lines (src/utils/aiMain.js).
import { describe, it, expect } from 'vitest';
import { plantContext, plantBrief, plantAlerts, plantAsk, plantText, lineForecast } from '../src/utils/aiMain';

const SHIFT = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };
const HRS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const day = (d, m, per, upTo = 21) => HRS.filter((h) => h < upTo).map((h) => [d, h, m, h === 13 ? per / 2 : per]);
const lines = [
  { line: '1', name: 'Line 1', ok: true, models: [{ mmId: 1, model: 'A1', company: 'SAMSUNG', qty: 2000 }],
    daily: [{ d: '2026-10-26', q: 690, rej: 5 }, { d: '2026-10-27', q: 360, rej: 40 }], dhm: [...day('2026-10-26', 1, 60), ...day('2026-10-27', 1, 60, 15)] },
  { line: '2', name: 'Line 2', ok: true, models: [{ mmId: 2, model: 'B2', company: 'MIDEA', qty: 900 }],
    daily: [{ d: '2026-10-26', q: 460, rej: 0 }, { d: '2026-10-27', q: 160, rej: 0 }], dhm: [...day('2026-10-26', 2, 40), ...day('2026-10-27', 2, 40, 13)] },
  { line: '3', name: 'Line 3', ok: true, models: [{ mmId: 3, model: 'C3', company: 'LG', qty: 300 }], daily: [], dhm: day('2026-10-27', 3, 30, 15) },
  { line: '4', name: 'Line 4', ok: false, error: 'Login failed', models: [], daily: [], dhm: [] },
];
const settings = {
  1: { shift: SHIFT, targets: { 1: { cycle: 60 } }, money: { pcValue: 100, hourCost: 3600, values: {} } },
  2: { shift: SHIFT, targets: { 2: { cycle: 60 } }, money: { pcValue: 200, hourCost: null, values: {} } },
  3: { shift: SHIFT, targets: {}, money: {} },
};
const live = { lines: [{ line: '1', lastScan: '2026-10-27 14:59:00', model: 'A1', company: 'SAMSUNG' }, { line: '2', lastScan: '2026-10-27 12:58:00', model: 'B2', company: 'MIDEA' }] };
const now = new Date('2026-10-27T15:00:00');
const ctx = plantContext({ lines, settings, live, losses: { 1: [{ date: '2026-10-27', hour: 10, minutes: 20, reason: 'Breakdown' }] }, now, range: { start: '2026-10-21', end: '2026-10-27' } });

describe('plant context and forecast', () => {
  it('focus is today; per-line day loss', () => {
    expect(ctx.focus).toBe('2026-10-27');
    const l1 = ctx.per[0].day;
    expect(l1.actual).toBe(330);                 // 5 full hours + half of 13 = 5.5 × 60
    expect(Math.round(l1.target)).toBe(330);     // 09–15 minus lunch = 5.5 h × 60
  });
  it('line 1 on target → forecast on track; line 2 stopped since 13:00 → will miss', () => {
    const f1 = lineForecast(ctx.per[0], ctx);
    expect(f1.state).toBe('live');
    expect(Math.round(f1.projected)).toBe(690);
    expect(f1.verdict).toBe('on-track');
    const f2 = lineForecast(ctx.per[1], ctx);
    expect(f2.verdict).toBe('will-miss');
  });
});

describe('alerts', () => {
  const al = plantAlerts(ctx);
  const k = al.map((a) => `${a.kind}:${a.line ?? ''}`);
  it('offline, stopped, behind target, will miss, rejection, no target', () => {
    expect(k).toContain('offline:4');
    expect(k).toContain('stopped:2');             // last scan 12:58, now 15:00
    expect(k).not.toContain('stopped:1');
    expect(k).toContain('target:2');
    expect(k).toContain('forecast:2');
    expect(k).toContain('rejection:1');           // 40 of 400
    expect(k).toContain('no-target:3');
    expect(al[0].level).toBe('bad');
  });
});

describe('brief and text', () => {
  const b = plantBrief(ctx);
  it('headline, rows and actions', () => {
    expect(b.headline).toMatch(/^All lines: 655 pcs today so far — lines with targets at 74% \(490 of 660 pcs\)/);
    expect(b.rows.map((r) => r.status)).toEqual(['ok', 'stopped', 'no-target', 'offline']);
    expect(b.actions[0].title).toBe("Recover Line 2's shortfall");
    expect(b.score).toBeGreaterThan(0);
  });
  it('report text', () => {
    const t = plantText(b, ctx);
    expect(t).toMatch(/^EMS Line Pulse — AI analysis · All lines · 2026-10-27/);
    expect(t).toMatch(/• Line 4: offline/);
  });
});

describe('questions', () => {
  it('biggest loss, line status, compare, period loss, yesterday, stopped, forecast, help', () => {
    expect(plantAsk('sabse zyada loss kis line ka', ctx).title).toBe('Biggest loss: Line 2');
    expect(plantAsk('line 2 kaisi chal rahi hai', ctx).title).toBe('Line 2 — 27 Oct');
    expect(plantAsk('line 1 vs line 2', ctx).table.rows.length).toBe(2);
    expect(plantAsk('is period ka total loss', ctx).title).toMatch(/^Period loss: ₹/);
    expect(plantAsk('kal kitna bana', ctx).title).toBe('26 Oct: 1,150 pcs');
    expect(plantAsk('kaunsi line band hai', ctx).bullets.length).toBe(2);
    expect(plantAsk('target poora hoga?', ctx).title).toBe('Forecast to shift end');
    expect(plantAsk('help', ctx).bullets.length).toBeGreaterThan(3);
    expect(plantAsk('qwerty', ctx).title).toBe('Not understood');
  });
});
