// 20-11-2026: reasons used lately come first on the entry pages (utils/recentReasons.js)
import { describe, it, expect, beforeEach } from 'vitest';
import { recentScope, recentOf, bumpRecent, withRecent } from '../src/utils/recentReasons';

const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };

describe('recent reasons', () => {
  beforeEach(() => { for (const k of Object.keys(mem)) delete mem[k]; });
  it('newest first, counted, one entry per reason (any case), at most 12', () => {
    const sc = recentScope('loss', '2');
    bumpRecent(sc, [{ reason: 'Power cut', dept: 'Utility' }], 1);
    bumpRecent(sc, [{ reason: 'Breakdown', dept: 'Maint' }], 2);
    bumpRecent(sc, [{ reason: 'power cut' }], 3);
    const r = recentOf(sc);
    expect(r.map((x) => [x.reason, x.n, x.dept])).toEqual([['power cut', 2, 'Utility'], ['Breakdown', 1, 'Maint']]);
    for (let i = 0; i < 20; i++) bumpRecent(sc, [{ reason: `R${i}` }], 10 + i);
    expect(recentOf(sc)).toHaveLength(12);
    expect(recentOf(sc)[0].reason).toBe('R19');
  });
  it('scope per kind, line and station', () => {
    expect(recentScope('rework', '1', 'HVIR')).toBe('rework|1|hvir');
    bumpRecent(recentScope('rework', '1', 'HVIR'), [{ reason: 'No power' }]);
    expect(recentOf(recentScope('rework', '1', 'Leakage'))).toEqual([]);
    expect(recentOf(recentScope('rework', '2', 'HVIR'))).toEqual([]);
  });
  it('withRecent: list items first (with their department), a reason written by hand kept, the rest after', () => {
    const list = [{ reason: 'Breakdown', dept: 'Maint' }, { reason: 'Power cut', dept: 'Utility' }, { reason: 'Other', dept: 'Prod' }];
    const recent = [{ reason: 'Belt slip', dept: 'Maint', manual: true }, { reason: 'power cut' }, { reason: 'Gone from the list' }];
    const { recent: top, rest } = withRecent(list, recent);
    expect(top.map((x) => [x.reason, x.dept, !!x.manual])).toEqual([['Belt slip', 'Maint', true], ['Power cut', 'Utility', false]]);
    expect(rest.map((x) => x.reason)).toEqual(['Breakdown', 'Other']);
  });
  it('broken storage: nothing kept, no error', () => {
    mem['ems.recentReasons.v1'] = '{bad';
    expect(recentOf('loss|1')).toEqual([]);
    expect(() => bumpRecent('loss|1', [{ reason: 'X' }])).not.toThrow();
  });
});
