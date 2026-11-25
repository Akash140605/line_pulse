// Notifications (utils/notify.js): who receives which alert, and the alerts worked out from the day's data.
import { describe, it, expect } from 'vitest';
import { normalizeNotify, normalizeWelcome, receives, coversLine, groupOf, buildNotices, welcomeText, greetingOf } from '../src/utils/notify';

const admin = { user: 'admin', role: 'admin' };
const sup = { user: 'line1', role: 'management', oleEdit: true, pages: ['daily', 'oleentry'], lines: ['1'] };
const qa = { user: 'qa', role: 'management', dept: 'Quality', lines: [] };
const viewer = { user: 'mgr', role: 'management', lines: [] };
const tv = { user: 'tv1', role: 'tv' };
const shift = { start: '09:00', end: '21:00', lunchStart: '13:00', lunchEnd: '13:30' };

describe('setup', () => {
  it('standard: every alert on, standard groups and limits', () => {
    const n = normalizeNotify(null);
    expect(n.on).toBe(true);
    expect(n.rules.lowHour).toEqual({ on: true, to: ['admin', 'sup', 'view'], users: [], lines: [], pct: 85 });
    expect(n.rules.morning.at).toBe('09:30');
  });
  it('limits, groups, logins and lines cleaned', () => {
    const n = normalizeNotify({ rules: { lowHour: { pct: 5, to: ['sup', 'x'], users: ['Akash', 'a b'], lines: [2, 'z'] }, morning: { at: '9:45' }, rejects: { pcs: 'x' } } });
    expect(n.rules.lowHour).toEqual({ on: true, to: ['sup'], users: ['akash'], lines: ['2'], pct: 50 });
    expect(n.rules.morning.at).toBe('09:45');
    expect(n.rules.rejects.pcs).toBe(10);
  });
  it('welcome: typed text kept, tags removed', () => {
    expect(normalizeWelcome({ title: 'Hello <b>', text: 'Good day ' })).toEqual({ on: true, title: 'Hello b', text: 'Good day ' });
    expect(welcomeText('{greeting}, {name}', { name: 'Akash', hour: 9 })).toBe('Good morning, Akash');
    expect(greetingOf(14)).toBe('Good afternoon');
    expect(greetingOf(19)).toBe('Good evening');
  });
});

describe('who receives', () => {
  const cfg = normalizeNotify({ rules: { rejects: { to: ['dept'], users: ['mgr'] } } });
  it('groups of the logins', () => {
    expect([admin, sup, qa, viewer, tv].map(groupOf)).toEqual(['admin', 'sup', 'dept', 'view', 'tv']);
  });
  it('by group or by login; never a TV; nothing when switched off', () => {
    expect(receives(cfg, 'rejects', qa)).toBe(true);
    expect(receives(cfg, 'rejects', viewer)).toBe(true);    // chosen by login
    expect(receives(cfg, 'rejects', admin)).toBe(false);
    expect(receives(cfg, 'offline', tv)).toBe(false);
    expect(receives({ ...cfg, on: false }, 'offline', admin)).toBe(false);
  });
  it('only the lines of the login and of the rule', () => {
    expect(coversLine(cfg, 'offline', sup, '1')).toBe(true);
    expect(coversLine(cfg, 'offline', sup, '2')).toBe(false);
    const c2 = normalizeNotify({ rules: { offline: { lines: ['3'] } } });
    expect(coversLine(c2, 'offline', admin, '2')).toBe(false);
    expect(coversLine(c2, 'offline', admin, '3')).toBe(true);
  });
});

describe('the alerts of the day', () => {
  const date = '2026-11-23';
  const rows = [
    { line: '1', name: 'Line 1', ok: true, total: 300, lastHour: 11, hours: [{ hour: 9, quantity: 170 }, { hour: 10, quantity: 100 }, { hour: 11, quantity: 30 }],
      hourModels: [{ hour: 9, mmId: 1, model: 'A', qty: 170 }, { hour: 10, mmId: 1, model: 'A', qty: 100 }, { hour: 11, mmId: 1, model: 'A', qty: 30 }] },
    { line: '2', name: 'Line 2', ok: false, error: 'timeout', hours: [] },
  ];
  const lineSet = { 1: { shift, targets: { 1: { cycle: 20 } } }, 2: { shift, targets: {} } };   // 20 s → 180 pcs per full hour
  const cfg = normalizeNotify(null);
  it('offline line, hour below target, loss entry pending, morning entry missing', () => {
    const n = buildNotices({ date, nowMin: 11 * 60 + 40, rows, lineSet, entries: {}, setups: {}, cfg, me: admin, autoReady: true });
    const ids = n.map((x) => x.id);
    expect(ids).toContain('offline|2026-11-23|2');
    expect(ids).toContain('lowHour|2026-11-23|1|10');          // 100 of 180
    expect(ids).not.toContain('lowHour|2026-11-23|1|9');       // 170 of 180 = 94 %
    expect(ids).toContain('lossPending|2026-11-23|1|10');      // ended 11:00, 40 min ago
    expect(ids).not.toContain('lowHour|2026-11-23|1|11');      // not finished
    expect(ids).toContain('morning|2026-11-23|1');
    expect(n.find((x) => x.id === 'lowHour|2026-11-23|1|10').text).toBe('100 of 180 pcs produced (55% of target).');
  });
  it('a saved entry or morning entry ends the alert; the supervisor sees only Line 1', () => {
    const n = buildNotices({ date, nowMin: 11 * 60 + 40, rows, lineSet, entries: { '2026-11-23|1|10': { losses: [{ min: 20 }] } }, setups: { '2026-11-23|1': { mp: 100 } }, cfg, me: sup, autoReady: true });
    const ids = n.map((x) => x.id);
    expect(ids).not.toContain('lossPending|2026-11-23|1|10');
    expect(ids).not.toContain('morning|2026-11-23|1');
    expect(n.some((x) => x.line === '2')).toBe(false);
  });
  it('model without a cycle time (only when the targets are worked out) and high rejection', () => {
    const noTg = { 1: { shift, targets: {} } };
    expect(buildNotices({ date, nowMin: 700, rows: [rows[0]], lineSet: noTg, cfg, me: admin, autoReady: false }).some((x) => x.rule === 'noCycle')).toBe(false);
    expect(buildNotices({ date, nowMin: 700, rows: [rows[0]], lineSet: noTg, cfg, me: admin, autoReady: true }).map((x) => x.id)).toContain('noCycle|2026-11-23|1|1');
    const ent = { '2026-11-23|1|9': { rejects: [{ qty: 7 }] }, '2026-11-23|1|10': { rejects: [{ qty: 6 }] } };
    const r = buildNotices({ date, nowMin: 700, rows: null, entries: ent, cfg, me: qa });
    expect(r.map((x) => x.rule)).toEqual(['rejects']);
    expect(r[0].text).toBe('13 pieces rejected today (limit 10).');
  });
  it('older entries with the rejected quantity as a number, and odd data, do not fail', () => {
    const ent = { '2026-11-23|1|9': { rejects: 8 }, '2026-11-23|1|10': { rejects: [{ qty: 5 }] }, '2026-11-23|2|9': { rejects: null }, 'bad': 3, '2026-11-23|3|9': null };
    const r = buildNotices({ date, nowMin: 700, rows: null, entries: ent, cfg, me: qa });
    expect(r.map((x) => x.text)).toEqual(['13 pieces rejected today (limit 10).']);
  });
});
