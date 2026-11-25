import { describe, it, expect } from 'vitest';
import { advise, adviceText, lossKind } from '../src/utils/aiAdvisor';

// 25-11-2026: AI advisor — what to do, why, what happens if not, who and by when
const today = '2026-11-25';
const shift = { start: 9 * 60, end: 21 * 60, lunchStart: 13 * 60, lunchEnd: 13 * 60 + 30 };
const days = {};
// 6 days where 09–10 is weak (60 %), other hours fine
for (let i = 1; i <= 6; i++) {
  const d = `2026-11-${String(25 - i).padStart(2, '0')}`;
  days[d] = { td: { rows: [{ hour: 9, qty: 60, plan: 100 }, { hour: 10, qty: 100, plan: 100 }, { hour: 11, qty: 98, plan: 100 }] } };
}
const entries = {};
for (let i = 0; i < 4; i++) {
  const d = `2026-11-${String(25 - i).padStart(2, '0')}`;
  entries[`${d}|1|10`] = { losses: [{ model: 'A', reason: 'Motor Shortage', dept: 'Store', min: 40 }], rework: [{ station: 'Leak test', model: 'A', reason: 'Seal bellow leakage', qty: 3, cat: 'Process' }] };
}
const per = [{ line: '1', name: 'Line 1', ok: true, shift, days, day: { lostSec: 120 * 60, avgCycle: 20 }, live: { lastScan: '2026-11-25 15:00:00', model: 'A' } }];
const now = new Date('2026-11-25T15:40:00');
const run = (o = {}) => advise({ per, isToday: true, nowMin: 15 * 60 + 40, now, today, entries, setup: { '2026-11-25|1': { mp: 90 } }, stdMp: { 1: 100 }, forecast: () => ({ state: 'live', target: 1000, projected: 900, verdict: 'will-miss', recent: 80, need: 110 }), ...o });

describe('AI advisor', () => {
  it('kind of a loss reason', () => {
    expect(lossKind('Motor Shortage')).toBe('material');
    expect(lossKind('Model Change')).toBe('changeover');
    expect(lossKind('Conveyor breakdown')).toBe('breakdown');
  });
  it('stopped now first, with the frequent stop to check and the steps', () => {
    const a = run();
    const s = a.items[0];
    expect(s.kind).toBe('stopped');
    expect(s.sev).toBe('now');
    expect(s.cause.join(' ')).toContain('Motor Shortage');
    expect(s.actions.length).toBeGreaterThan(1);
  });
  it('will miss: gap, cause from today, overtime to make it up', () => {
    const t = run().items.find((x) => x.kind === 'target');
    expect(t.title).toContain('100 pcs');
    expect(t.cause.join(' ')).toContain('Motor Shortage 40 min');
    expect(t.risk).toContain('overtime');
  });
  it('a reason on 4 days is chronic with store / PPC steps and the monthly risk', () => {
    const c = run().items.find((x) => x.kind === 'chronic-material');
    expect(c.title).toContain('4 of 7 days');
    expect(c.owner).toBe('Store');
    expect(c.actions.join(' ')).toContain('Store');
  });
  it('a repeating defect gets the plant\'s likely causes and proven actions', () => {
    const d = run().items.find((x) => x.kind === 'defect');
    expect(d.title).toContain('Seal bellow leakage');
    expect(d.cause.join(' ')).toMatch(/Likely \(plant history\)/);
    expect(d.actions.join(' ')).toMatch(/Proven action/);
  });
  it('an hour short day after day is predicted, with start-up steps', () => {
    const p = run().items.find((x) => x.kind === 'pattern');
    expect(p.title).toContain('09:00–10:00');
    expect(p.cause.join(' ')).toContain('start of the shift');
  });
  it('manpower short and unexplained lost time', () => {
    const a = run();
    expect(a.items.find((x) => x.kind === 'manpower').title).toContain('90 of 100');
    expect(a.items.find((x) => x.kind === 'unexplained').title).toContain('lost with no reason');
  });
  it('the plan as text, grouped now / today / week', () => {
    const t = adviceText(run());
    expect(t).toContain('DO NOW'); expect(t).toContain('TODAY'); expect(t).toContain('THIS WEEK');
    expect(t).toContain('Owner:');
  });
  it('a quiet line: nothing to do', () => {
    const a = advise({ per: [{ line: '2', name: 'Line 2', ok: true, shift, days: {}, day: null, live: null }], today, entries: {}, now, nowMin: 600 });
    expect(a.items).toEqual([]);
  });
});
