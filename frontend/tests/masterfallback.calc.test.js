// 21-11-2026: a Method D line whose worked-out targets miss a model takes the master's cycle (OLE / loss entry)
import { describe, it, expect } from 'vitest';
import { oleDayLines } from '../src/utils/ole';
import { setMasterRows, setFallbackRule } from '../src/utils/targetMethods';

const lines = [{ line: '3', ok: true, name: 'Line 3', models: [{ mmId: 590, model: 'WT70C3000RR', company: 'SAMSUNG' }], dhm: [['2026-11-20', 10, 590, 150]] }];
describe('Method D target from the master', () => {
  it('no target without the fallback rule', () => {
    setMasterRows([{ company: 'SAMSUNG', model: 'WT70C3000RR', cycle: 20, lines: [3] }]);
    setFallbackRule(null);
    const L = oleDayLines({ lines, settings: { 3: { targets: {} } }, date: '2026-11-20', ids: ['3'] })['3'];
    expect(L.rows.find((r) => r.hour === 10).stdSec).toBe(0);
  });
  it('Method D line: the master cycle fills the gap', () => {
    setFallbackRule({ from: '2026-08-01', add: 3, lines: { 3: { method: 'D', add: 0 } } });
    const L = oleDayLines({ lines, settings: { 3: { targets: {} } }, date: '2026-11-20', ids: ['3'] })['3'];
    expect(L.rows.find((r) => r.hour === 10).stdSec).toBe(3000);
  });
  it('a saved target wins; a Method A line is not filled', () => {
    const L = oleDayLines({ lines, settings: { 3: { targets: { 590: { cycle: 25 } } } }, date: '2026-11-20', ids: ['3'] })['3'];
    expect(L.rows.find((r) => r.hour === 10).stdSec).toBe(3750);
    setFallbackRule({ from: '2026-08-01', add: 3, lines: { 3: { method: 'A', add: 3 } } });
    const A = oleDayLines({ lines, settings: { 3: { targets: {} } }, date: '2026-11-20', ids: ['3'] })['3'];
    expect(A.rows.find((r) => r.hour === 10).stdSec).toBe(0);
    setFallbackRule(null);
  });
});

// 27-11-2026: the live screens fill a missing Line 3 / 4 target from the master too
import { withMasterFallback } from '../src/utils/targetMethods';
describe('Live screen: master fallback', () => {
  it('fills only the missing models of a Method D line, keeps the rest', () => {
    setMasterRows([{ company: 'SAMSUNG', model: 'WT70C3000RR/TL', cycle: 18, lines: [3] }, { company: 'VOLTAS', model: '70DLIM BK4GTD', cycle: 21.05, lines: [4] }]);
    setFallbackRule({ from: '2026-08-01', add: 3, lines: { 3: { method: 'D', add: 0 }, 4: { method: 'D', add: 0 } } });
    const t3 = withMasterFallback({}, '3', [{ mmId: 590, model: 'WT70C3000RR', company: 'SAMSUNG' }]);
    expect(t3['590'].cycle).toBe(18);
    const t4 = withMasterFallback({ 7: { cycle: 30 } }, '4', [{ mmId: 7, model: 'X' }, { mmId: 8, model: '70DLIM BK4GTD', companyTitle: 'VOLTAS' }]);
    expect(t4['7'].cycle).toBe(30);
    expect(t4['8'].cycle).toBe(21.1);
    const same = { 1: { cycle: 20 } };
    expect(withMasterFallback(same, '4', [{ mmId: 1, model: 'A' }])).toBe(same);
    setFallbackRule({ from: '2026-08-01', add: 3, lines: { 3: { method: 'A', add: 3 } } });
    expect(withMasterFallback({}, '3', [{ mmId: 590, model: 'WT70C3000RR', company: 'SAMSUNG' }])['590']).toBeUndefined();
    setFallbackRule(null);
  });
});
