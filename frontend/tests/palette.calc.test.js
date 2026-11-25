import { describe, it, expect } from 'vitest';
import { score } from '../src/components/CommandPalette.jsx';

// 25-11-2026: the Ctrl+K palette finds a page from part of its name
describe('command palette match', () => {
  it('a name that starts with the text comes first', () => {
    expect(score('OLE calendar', 'Overview', 'ole')).toBeGreaterThan(score('Monthly OLE', 'Overview', 'ole'));
  });
  it('words in any order, letters in order, folder names too', () => {
    expect(score('OLE calendar', 'Overview', 'cal ole')).toBeGreaterThan(0);
    expect(score('Quality dashboard', 'Quality', 'qd')).toBeGreaterThan(0);
    expect(score('Loss analysis', 'Availability', 'availab')).toBeGreaterThan(0);
  });
  it('no match → 0; an empty box matches everything', () => {
    expect(score('Reports', 'Reports', 'zzz')).toBe(0);
    expect(score('Reports', 'Reports', '  ')).toBe(1);
  });
});
