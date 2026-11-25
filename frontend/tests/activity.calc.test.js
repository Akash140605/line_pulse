import { describe, it, expect } from 'vitest';
import { kindOf, areaOf, device, KIND } from '../src/components/ActivityLog';

// 20-11-2026: Setup → Activity log — how an event is shown
describe('activity log: how an event reads', () => {
  it('a change answered 401 / 403 was refused, another error was not saved', () => {
    expect(kindOf({ ev: 'change', status: 200 })).toBe('change');
    expect(kindOf({ ev: 'change', status: 403 })).toBe('refused');
    expect(kindOf({ ev: 'change', status: 401 })).toBe('refused');
    expect(kindOf({ ev: 'change', status: 400 })).toBe('failed');
    expect(kindOf({ ev: 'change', status: 500 })).toBe('failed');
    expect(kindOf({ ev: 'change' })).toBe('change');
    expect(kindOf({ ev: 'login_fail' })).toBe('login_fail');
    expect(Object.keys(KIND)).toEqual(['login', 'login_fail', 'logout', 'view', 'change', 'refused', 'failed', 'download', 'error']);
  });
  it('a download reads as the report, the file, its days and lines (25-11-2026)', () => {
    expect(areaOf({ ev: 'download', title: 'Reports', file: 'SAWM KPI 2026-11-01_2026-11-25.xlsx', range: '01-11-2026 – 25-11-2026', line: 'all' }))
      .toBe('Reports · SAWM KPI 2026-11-01_2026-11-25.xlsx · 01-11-2026 – 25-11-2026 · all lines');
  });
  it('where: the part of Line Pulse that changed, the page opened (with its line)', () => {
    expect(areaOf({ ev: 'change', api: 'ole.php', action: 'save' })).toBe('Loss / quality entry');
    expect(areaOf({ ev: 'change', api: 'ole.php', action: 'setup' })).toBe('Morning entry');
    expect(areaOf({ ev: 'change', api: 'line_settings.php', action: 'targets' })).toBe('Line targets');
    expect(areaOf({ ev: 'change', api: 'auth.php', action: 'userremove' })).toBe('Users & logins');
    expect(areaOf({ ev: 'change', api: 'new_thing.php', action: 'go' })).toBe('new_thing go');
    expect(areaOf({ ev: 'view', page: 'oleentry', title: 'Loss entry', line: '2' })).toBe('Loss entry · Line 2');
    expect(areaOf({ ev: 'view', page: 'oleview', line: 'all' })).toBe('oleview');
    expect(areaOf({ ev: 'login' })).toBe('');
  });
  it('the PC: browser and system in short', () => {
    expect(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(device('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0')).toBe('Edge · Windows');
    expect(device('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(device('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iPhone / iPad');
    expect(device('')).toBe('');
  });
});

import { rangeOf, lineOf } from '../src/utils/downloadLog';
describe('download note: days and lines read from the file name', () => {
  it('a range, one day, none', () => {
    expect(rangeOf('Quality dashboard All lines 2026-11-01_2026-11-25.xlsx')).toBe('01-11-2026 – 25-11-2026');
    expect(rangeOf('HPR Line 2 2026-11-24.xlsx')).toBe('24-11-2026');
    expect(rangeOf('Model master.xlsx')).toBe('');
  });
  it('the lines', () => {
    expect(lineOf('HPR Line 2 2026-11-24.xlsx')).toBe('2');
    expect(lineOf('OLE Line 1 & 2.xlsx')).toBe('1&2');
    expect(lineOf('Quality dashboard All lines.xlsx')).toBe('all');
  });
});

describe('activity log: page errors (25-11-2026)', () => {
  it('a page error reads as the page and its build', async () => {
    const { areaOf, kindOf } = await import('../src/components/ActivityLog.jsx');
    const e = { ev: 'error', page: 'targetcheck', title: 'Target Rule & Check', build: '20261125-200500', error: 'x is undefined' };
    expect(kindOf(e)).toBe('error');
    expect(areaOf(e)).toBe('Target Rule & Check · build 20261125-200500');
  });
});
