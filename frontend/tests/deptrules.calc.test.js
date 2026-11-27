// 27-11-2026: a department for every loss / defect — never "Not set"
import { describe, it, expect } from 'vitest';
import { guessDept, deptOfRow, guessRcaCat, RCA_CATS } from '../src/utils/deptRules';
describe('Department rules', () => {
  it('follows the plant reason master', () => {
    expect(guessDept('loss', 'Motor Shortage')).toBe('Kitting Store');
    expect(guessDept('loss', 'Panel Shortage')).toBe('Moulding Store');
    expect(guessDept('loss', 'Control Table Shortage')).toBe('Moulding Store');
    expect(guessDept('rework', 'Pulsator touching')).toBe('Moulding QA');
    expect(guessDept('rework', 'Drain Assy Leakage')).toBe('Supplier');
    expect(guessDept('loss', 'Barcode / XML scan error')).toBe('IT');
    expect(guessDept('loss', 'Model Change')).toBe('Prod');
  });
  it('category first, then the words, never empty', () => {
    expect(guessDept('rework', 'anything', 'Moulding')).toBe('Moulding QA');
    expect(guessDept('rework', 'Tub scratch')).toBe('Moulding QA');
    expect(guessDept('rework', 'Spin motor not work')).toBe('Supplier');
    expect(guessDept('rework', 'Spin tub nut loose')).toBe('Prod');
    expect(guessDept('rework', 'zzz')).toBe('Quality');
    expect(guessDept('stop', 'zzz')).toBe('Prod');
    expect(deptOfRow({ dept: 'IT', reason: 'Tub scratch' }, 'rework')).toBe('IT');
    expect(deptOfRow({ reason: '' }, 'loss')).toBe('Prod');
  });
  it('6M category of a root cause', () => {
    expect(RCA_CATS).toHaveLength(6);
    expect(guessRcaCat('Operator negligence')).toBe('Man');
    expect(guessRcaCat('Jig loose')).toBe('Machine');
    expect(guessRcaCat('Motor Shortage')).toBe('Material');
    expect(guessRcaCat('Barcode scan error')).toBe('Measurement');
    expect(guessRcaCat('Wrong sequence')).toBe('Method');
  });
});
