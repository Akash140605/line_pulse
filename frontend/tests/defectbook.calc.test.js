import { describe, it, expect } from 'vitest';
import { stageDefects, stationDefects, defectHint, BOOK_DEFECTS } from '../src/utils/defectBook';

describe('defect book (Book1 + PAD Defect Tag)', () => {
  it('every stage has its defects, most frequent first, no doubles, Other last', () => {
    for (let k = 0; k < 6; k++) {
      const L = stageDefects(k);
      expect(L.length).toBeGreaterThan(5);
      expect(L[0]).toBe(BOOK_DEFECTS[k][0]);
      expect(L[L.length - 1]).toBe('Other');
      expect(new Set(L.map((x) => x.toLowerCase())).size).toBe(L.length);
      expect(L.length).toBeLessThanOrEqual(80);
    }
  });
  it('Defect Tag names that Book1 writes differently are not doubled', () => {
    const L = stageDefects(1);
    expect(L.filter((x) => /^seal bellow leak/i.test(x)).length).toBe(1);
    expect(stageDefects(2).filter((x) => /^angle (ng|not good)$/i.test(x)).length).toBe(1);
  });
  it('a station gets the list of its stage by name or code', () => {
    expect(stationDefects('HVIR')[0]).toBe('No power');
    expect(stationDefects('Leakage Test')).toContain('Tub leak');
    expect(stationDefects('Packing')).toBe(null);
  });
  it('hints: the root cause and action written most often', () => {
    expect(defectHint('Tub leakage')).toEqual({ cat: 'Moulding', cause: 'Molding issue', action: 'Dismantle' });
    expect(defectHint('Pulsator touching').action).toBe('Flash removed');
    expect(defectHint('Never seen')).toEqual({});
  });
});
