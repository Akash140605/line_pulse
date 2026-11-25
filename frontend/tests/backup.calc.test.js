// Offline fallback (src/utils/backup.js): when a line's server is offline the backend answers from the local backup copy
// and says so in the X-EMS-Backup header. These tests cover reading that header, which lines it concerns and the notice text.
import { describe, it, expect } from 'vitest';
import { parseBackupHeader, linesOfRequest, mergeBackupState, backupNotice, backupShort, backupAgeMin, ageText } from '../src/utils/backup';

const H = '{"2":{"upTo":"2026-10-25 22:41:07","syncedAt":"2026-10-26 10:05:00"}}';

describe('parseBackupHeader', () => {
  it('reads the lines answered from backup', () => {
    expect(parseBackupHeader(H)).toEqual({ 2: { upTo: '2026-10-25 22:41:07', syncedAt: '2026-10-26 10:05:00' } });
  });
  it('missing or broken header → nothing from backup', () => {
    expect(parseBackupHeader(null)).toEqual({});
    expect(parseBackupHeader('')).toEqual({});
    expect(parseBackupHeader('{oops')).toEqual({});
  });
});

describe('linesOfRequest — which lines a response speaks for', () => {
  it('per-line request: its line', () => {
    expect(linesOfRequest('http://x/api/day_overview.php?date=2026-10-26&line=3')).toEqual(['3']);
  });
  it('one line of the Main view (lineOnly)', () => {
    expect(linesOfRequest('http://x/api/all_lines.php?start=a&lineOnly=2&line=1')).toEqual(['2']);
  });
  it('all-lines endpoints speak for every line', () => {
    expect(linesOfRequest('http://x/api/live_lines.php?line=1')).toEqual(['1', '2', '3', '4']);
    expect(linesOfRequest('http://x/api/all_lines.php?start=a&end=b&line=1')).toEqual(['1', '2', '3', '4']);
  });
});

describe('mergeBackupState', () => {
  it('marks the lines in the header and clears the others the request spoke for', () => {
    const prev = { 3: { upTo: 'old', syncedAt: 'old' } };
    const next = mergeBackupState(prev, ['1', '2', '3', '4'], parseBackupHeader(H));
    expect(Object.keys(next)).toEqual(['2']);
  });
  it('a per-line answer leaves other lines alone', () => {
    const prev = { 3: { upTo: 'x', syncedAt: 'y' } };
    expect(mergeBackupState(prev, ['1'], {})).toEqual(prev);
  });
  it('same state → same object (no needless re-render)', () => {
    const prev = { 2: { upTo: '2026-10-25 22:41:07', syncedAt: '2026-10-26 10:05:00' } };
    expect(mergeBackupState(prev, ['2'], parseBackupHeader(H))).toBe(prev);
  });
});

describe('backupNotice', () => {
  it('explains which line, up to when, and when the copy was made', () => {
    const t = backupNotice('2', { upTo: '2026-10-25 22:41:07', syncedAt: '2026-10-26 10:05:00' });
    expect(t).toBe('Line 2 server is offline. Showing data from the local backup: scans up to 25 Oct 2026, 22:41 (backup updated 26 Oct 2026, 10:05).');
  });
  it('without a copy time', () => {
    expect(backupNotice('4', { upTo: '2026-10-25 22:41:07', syncedAt: null }))
      .toBe('Line 4 server is offline. Showing data from the local backup: scans up to 25 Oct 2026, 22:41.');
  });
});

describe('last data read from the line (snapshot)', () => {
  const S = '{"3":{"upTo":"2026-11-03 08:41:10","syncedAt":"2026-11-03 08:42:00","kind":"snapshot"}}';
  it('kind is kept in the state', () => {
    expect(mergeBackupState({}, ['3'], parseBackupHeader(S))).toEqual({ 3: { upTo: '2026-11-03 08:41:10', syncedAt: '2026-11-03 08:42:00', kind: 'snapshot' } });
  });
  it('notice says it is the last data read, not a backup copy', () => {
    expect(backupNotice('3', parseBackupHeader(S)['3'])).toBe('Line 3 server is offline. Showing the last data read from the line: scans up to 3 Nov 2026, 08:41 (read 3 Nov 2026, 08:42).');
  });
  it('short time: only HH:MM on the same day, with the date otherwise', () => {
    expect(backupShort({ upTo: '2026-11-03 08:41:10' }, '2026-11-03')).toBe('08:41');
    expect(backupShort({ upTo: '2026-11-02 20:05:00' }, '2026-11-03')).toBe('2 Nov, 20:05');
  });
  it('age of the data', () => {
    expect(backupAgeMin({ upTo: '2026-11-03 08:41:10' }, new Date(2026, 10, 3, 9, 11, 10))).toBe(30);
    expect(ageText(30)).toBe('30 min old');
    expect(ageText(135)).toBe('2 h 15 min old');
    expect(ageText(3000)).toBe('2 days old');
  });
});
