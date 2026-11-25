import { describe, it, expect } from 'vitest';
import { notePageError } from '../src/utils/activityTrack';
import { setAuth } from '../src/auth';

// 25-11-2026: a page that crashed is noted in the activity log (once per 10 minutes for the same error), never for a TV
describe('page error note', () => {
  it('sends the message, stack and build once; a TV login sends nothing', () => {
    const store = {};
    if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
    if (typeof globalThis.localStorage === 'undefined') globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    if (typeof globalThis.window.dispatchEvent !== 'function') globalThis.window.dispatchEvent = () => true;
    if (typeof globalThis.Event === 'undefined') globalThis.Event = class { constructor(t) { this.type = t; } };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sent = [];
    globalThis.fetch = (url, o) => { sent.push({ url, body: JSON.parse(o.body) }); return Promise.resolve({ ok: true }); };
    window.__LP_BUILD__ = '20261125-200500';
    setAuth({ user: 'admin', role: 'admin', token: 't1', exp });
    const err = new Error('boom'); err.stack = 'Error: boom\n    at A (app.js:1:2)\n    at B (app.js:3:4)';
    notePageError(err, { componentStack: '\n    in TargetCheckPage\n    in ErrorBoundary' });
    notePageError(err, {});
    expect(sent.length).toBe(1);
    expect(sent[0].url).toMatch(/activity\.php$/);
    expect(sent[0].body.action).toBe('error');
    expect(sent[0].body.message).toBe('boom');
    expect(sent[0].body.build).toBe('20261125-200500');
    expect(sent[0].body.stack).toContain('at A (app.js:1:2)');
    expect(sent[0].body.stack).toContain('in TargetCheckPage');
    setAuth({ user: 'tv', role: 'tv', token: 't2', exp });
    notePageError(new Error('other'), {});
    expect(sent.length).toBe(1);
    setAuth(null);
  });
});
