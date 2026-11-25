// A line that cannot be loaded: plain-language reason for the screen (src/utils/offline.js) instead of the raw driver text.
import { describe, it, expect } from 'vitest';
import { describeLoadError } from '../src/utils/offline';

const NET = 'Database connection failed (Line 1): SQLSTATE[08001]: [Microsoft][ODBC Driver 17 for SQL Server]TCP Provider: The wait operation timed out. (retrying in 24 s)';
const PIPES = 'SQLSTATE[08001]: [Microsoft][ODBC Driver 17 for SQL Server]Named Pipes Provider: Could not open a connection to SQL Server [53].';
const LOGIN = "Database connection failed (Line 2): SQLSTATE[28000]: [Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Login failed for user 'MES'.";

describe('describeLoadError', () => {
  it('network / timeout → server not reachable, with the retry time', () => {
    const r = describeLoadError(NET, 'Line 1');
    expect(r.kind).toBe('offline');
    expect(r.title).toBe('Line 1 server is not reachable');
    expect(r.retryIn).toBe(24);
    expect(r.hint).toMatch(/switched on/);
    expect(r.detail).toBe(NET);
  });
  it('Named Pipes error is the same case', () => {
    expect(describeLoadError(PIPES, 'Line 1').kind).toBe('offline');
  });
  it('login refused → its own message (settings, not network)', () => {
    const r = describeLoadError(LOGIN, 'Line 2');
    expect(r.kind).toBe('login');
    expect(r.title).toBe('Line 2 server refused the login');
    expect(r.retryIn).toBe(null);
  });
  it('slow answer', () => {
    expect(describeLoadError('The server took longer than 60 s to answer (analytics.php). Try a shorter period or Refresh.', 'Line 3').kind).toBe('slow');
  });
  it('anything else keeps a general title, never empty', () => {
    const r = describeLoadError('Request failed: 500', 'Line 4');
    expect(r.kind).toBe('error');
    expect(r.title).toBe('Line 4 data could not be loaded');
    expect(describeLoadError('', 'Line 4').title).toBe('Line 4 data could not be loaded');
  });
  it('the line name falls back to the one in the message', () => {
    expect(describeLoadError(NET).title).toBe('Line 1 server is not reachable');
  });
});
