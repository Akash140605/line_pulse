import { api } from '../api';

let offset = 0;          // DB wall-clock minus browser clock (ms)
let synced = false;
let inflight = null;
let source = '';         // which server's clock (server_time.php 'source')
let skew = 0;            // the server clock minus this PC's clock (ms), even when it is not used
/** A server clock further off than this (a wrong date, hours) is not used: this PC's clock is (the warning still shows). */
const MAX_SKEW = 2 * 3600 * 1000;
const subs = new Set();
// the last offset read is kept in this browser: the next start uses it at once (no wait for the server clock)
const SAVED = 'ems.clock.v1';
try {
  const k = JSON.parse(localStorage.getItem(SAVED) || 'null');
  if (k && Date.now() - k.at < 12 * 3600 * 1000 && Number.isFinite(k.skew)) { skew = k.skew; offset = Math.abs(skew) > MAX_SKEW ? 0 : skew; source = String(k.source || ''); }
} catch { /* storage blocked */ }
/** A clock offset from an earlier visit (12 h) is in use: the screen can be drawn before the server answers. */
export const hasSavedClock = () => { try { const k = JSON.parse(localStorage.getItem(SAVED) || 'null'); return !!k && Date.now() - k.at < 12 * 3600 * 1000; } catch { return false; } };
/** The clock in use: offset to this PC (ms), its source, and whether it was read. */
export const clockInfo = () => ({ offset, skew, source, synced, now: new Date(Date.now() + skew) });
export const subscribeClock = (f) => { subs.add(f); return () => subs.delete(f); };
const pad = (n) => String(n).padStart(2, '0');

/** DB server ka abhi ka time (Date; local getters = DB ka wall clock). */
export const serverNow = () => new Date(Date.now() + offset);
export const serverToday = () => { const d = serverNow(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const isServerTimeSynced = () => synced;

export function syncServerTime() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const t0 = Date.now();
      const j = await api.serverTime();
      const t1 = Date.now();
      const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(j?.now || '');
      if (m) {
        const wall = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        skew = wall + (t1 - t0) / 2 - t1;   // network delay ka half compensate
        offset = Math.abs(skew) > MAX_SKEW ? 0 : skew;   // line server ki ghadi bahut galat: is PC ki ghadi chalegi
        synced = true; source = String(j?.source ?? '');
        try { localStorage.setItem(SAVED, JSON.stringify({ at: Date.now(), skew, source })); } catch { /* storage blocked */ }
        subs.forEach((f) => { try { f(clockInfo()); } catch { /* */ } });
      }
    } catch { /* server nahi mila: purana offset chalega */ }
    inflight = null;
  })();
  return inflight;
}