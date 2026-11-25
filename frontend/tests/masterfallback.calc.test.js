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
