import React, { useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, Download, Search, LogIn, LogOut, ShieldAlert, Pencil, Eye, Ban, X, Bug } from 'lucide-react';
import { api } from '../api';
import { serverToday } from '../utils/serverTime';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';

/**
 * Setup → Activity log (20-11-2026, admin): who logged in (and who tried and failed), who logged out, which pages each
 * login opened and every change it made — what, where, when and from which PC (backend lib/activity.php, api/activity.php).
 * Kept on the server in backend/data/activity (one file a month), never in a database; passwords are never written and
 * TV screens are not logged.
 */
const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const inp = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-13 font-semibold text-slate-900';
const th = 'border border-[#BFBFBF] px-2 py-1.5 text-left font-bold whitespace-nowrap';
const td = 'border border-[#E2E8F0] px-2 py-1.5 align-top';
const pad = (n) => String(n).padStart(2, '0');
const dmy = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : '');
const dmyt = (s) => (s ? `${dmy(s)} ${s.slice(11, 19)}` : '—');
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nf = (n) => Number(n || 0).toLocaleString('en-IN');

/** the kind of an event: a change answered with 401 / 403 was refused, other errors were not saved */
export const kindOf = (e) => (e.ev === 'change' ? ((e.status ?? 200) >= 400 ? ([401, 403, 429].includes(e.status) ? 'refused' : 'failed') : 'change') : e.ev);
export const KIND = {
  login: { label: 'Logged in', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300', icon: LogIn },
  login_fail: { label: 'Login failed', cls: 'bg-red-100 text-red-800 ring-red-300', icon: ShieldAlert },
  logout: { label: 'Logged out', cls: 'bg-slate-100 text-slate-700 ring-slate-300', icon: LogOut },
  view: { label: 'Opened page', cls: 'bg-sky-50 text-sky-800 ring-sky-200', icon: Eye },
  change: { label: 'Changed', cls: 'bg-blue-100 text-blue-800 ring-blue-300', icon: Pencil },
  refused: { label: 'Refused', cls: 'bg-amber-100 text-amber-900 ring-amber-300', icon: Ban },
  failed: { label: 'Not saved', cls: 'bg-red-100 text-red-800 ring-red-300', icon: Ban },
  download: { label: 'Downloaded', cls: 'bg-violet-100 text-violet-800 ring-violet-300', icon: Download },   // 25-11-2026: a report / file given
  error: { label: 'Page error', cls: 'bg-rose-100 text-rose-800 ring-rose-300', icon: Bug },   // 25-11-2026: a page crashed in the browser
};
const WHY = { wrong: 'wrong password', unknown: 'no such user ID', off: 'login switched off', throttled: 'too many tries — wait 10 min' };
const AREA = {
  'ole.php': { save: 'Loss / quality entry', setup: 'Morning entry', day: 'Line off all day', kpi: 'KPI entry', rca: 'RCA', reasons: 'Reason lists' },
  'line_settings.php': { shift: 'Shift', target: 'Line target', targets: 'Line targets', money: '₹ rates' },
  'model_master.php': { save: 'Model master' },
  'ui_settings.php': { save: 'Setup', reset: 'Setup reset' },
  'losses.php': { save: 'Loss register', delete: 'Loss register', import: 'Loss register' },
  'files.php': { upload: 'RCA evidence', avatar: 'Own picture' },
  'auth.php': { password: 'Password', user: 'Users & logins', userremove: 'Users & logins', active: 'Users & logins', enforce: 'Server protection', tvuser: 'TV login', tvremove: 'TV login', tvlink: 'TV link' },
};
const ROLE = { admin: 'Admin', management: 'View / line', tv: 'TV' };
/** where it happened: the page opened, or the part of Line Pulse that was changed */
export const areaOf = (e) => (e.ev === 'error' ? `${e.title || e.page || 'Page'}${e.build ? ` · build ${e.build}` : ''}` : e.ev === 'download' ? `${e.title || 'Report'} · ${e.file || ''}${e.range ? ` · ${e.range}` : ''}${e.line && e.line !== 'all' ? ` · Line ${e.line}` : e.line === 'all' ? ' · all lines' : ''}`
  : e.ev === 'view' ? `${e.title || e.page}${e.line && e.line !== 'all' ? ` · Line ${e.line}` : ''}`
  : e.ev === 'change' ? (AREA[e.api]?.[e.action] || `${String(e.api || '').replace('.php', '')} ${e.action || ''}`.trim()) : '');
/** "Chrome · Windows" from the browser text */
export function device(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua ? 'Browser' : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return [b, os].filter(Boolean).join(' · ');
}
const detailOf = (e) => (e.ev === 'login_fail' ? WHY[e.why] || e.why || '' : (e.what || []).join('\n'));

const SHOW = [['all', 'All'], ['login', 'Logins'], ['login_fail', 'Failed logins'], ['logout', 'Log outs'], ['change', 'Changes'], ['refused', 'Refused / not saved'], ['view', 'Pages opened'], ['download', 'Downloads'], ['error', 'Page errors']];
const showOk = (e, k) => k === 'all' || (k === 'refused' ? ['refused', 'failed'].includes(kindOf(e)) : kindOf(e) === k);

export default function ActivityLog({ user: userIn = '', onUser = null }) {
  const today = serverToday();
  const PERIODS = useMemo(() => [
    ['today', 'Today', today, today], ['yesterday', 'Yesterday', addDays(today, -1), addDays(today, -1)], ['7', 'Last 7 days', addDays(today, -6), today],
    ['month', 'This month', `${today.slice(0, 8)}01`, today],
    ['last', 'Last month', (() => { const d = new Date(`${today.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })(), addDays(`${today.slice(0, 8)}01`, -1)],
  ], [today]);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [user, setUser] = useState(userIn || '');
  const [show, setShow] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [limit, setLimit] = useState(200);
  const [n, setN] = useState(0);   // Refresh
  useEffect(() => { setUser(userIn || ''); }, [userIn]);
  useEffect(() => {
    let live = true;
    if (!from || !to || from > to) { setErr('Choose the days: "From" not after "To".'); return undefined; }
    setBusy(true); setErr('');
    api.activity({ from, to, user, limit: 5000 }).then((j) => { if (live) { setData(j); setLimit(200); } })
      .catch((e) => { if (live) setErr(`The activity log could not be read: ${e.message}`); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [from, to, user, n]);
  const pickUser = (u) => { setUser(u); onUser?.(u); };
  const events = data?.events || [];
  const ql = q.trim().toLowerCase();
  const shown = useMemo(() => events.filter((e) => showOk(e, show) && (!ql || [e.user, e.name, areaOf(e), detailOf(e), e.ip, e.error, device(e.ua)].join(' ').toLowerCase().includes(ql))), [events, show, ql]);
  const c = data?.counts || {};
  const users = data?.users || [];
  const period = PERIODS.find(([, , f, t]) => f === from && t === to)?.[0] || '';
  const tile = (label, value, tone, k) => (
    <button type="button" key={label} onClick={() => setShow(k)} aria-pressed={show === k}
      className={`rounded-xl border px-3 py-2 text-left hover:bg-slate-50 ${show === k ? 'border-blue-600 ring-2 ring-blue-600' : 'border-slate-200'}`}>
      <div className="text-fs-12 font-bold text-slate-600">{label}</div>
      <div className={`font-mono text-fs-24 font-extrabold leading-tight ${value ? tone : 'text-slate-400'}`}>{nf(value)}</div>
    </button>
  );

  const excel = () => {
    const h = (list) => list.map((v) => ({ v, s: 'head' }));
    const t = (v) => ({ v: v ?? '', s: 'text' }); const w = (v) => ({ v: v ?? '', s: 'wrap' }); const i = (v) => ({ v: v ?? 0, s: 'int' });
    const sub = `Dixon Line Pulse · ${dmy(from)} to ${dmy(to)}${user ? ` · login ${user}` : ''} · ${shown.length} rows`;
    const rows = [[{ v: 'Activity log — logins and changes', s: 'title' }], [{ v: sub, s: 'subtitle' }], [],
      h(['Time', 'User ID', 'Name', 'Role', 'What happened', 'Where', 'Details', 'Status', 'PC (IP)', 'Browser']),
      ...shown.map((e) => [t(dmyt(e.time)), t(e.user || '—'), t(e.name || ''), t(ROLE[e.role] || e.role || ''), t(KIND[kindOf(e)]?.label || e.ev), t(areaOf(e)),
        w([detailOf(e), e.error ? `Error: ${e.error}` : ''].filter(Boolean).join('\n')), t(e.ev === 'change' ? String(e.status ?? '') : ''), t(e.ip || ''), t(device(e.ua))])];
    const urows = [[{ v: 'Activity by login', s: 'title' }], [{ v: `Dixon Line Pulse · ${dmy(from)} to ${dmy(to)}`, s: 'subtitle' }], [],
      h(['User ID', 'Name', 'Role', 'Logins', 'Last login', 'Changes', 'Refused / not saved', 'Failed logins', 'Pages opened', 'Last seen', 'PCs (IP)']),
      ...users.map((u) => [t(u.user), t(u.name), t(ROLE[u.role] || u.role), i(u.logins), t(dmyt(u.lastLogin)), i(u.changes), i(u.refused), i(u.fails), i(u.views), t(dmyt(u.lastSeen)), t((u.ips || []).join(', '))])];
    downloadXlsx(buildXlsx([
      { name: 'Activity', rows, cols: [19, 14, 20, 12, 15, 22, 70, 8, 15, 18].map((x) => ({ width: x })), freezeRow: 4, headerRow: 4, merges: ['A1:J1', 'A2:J2'], autoFilter: shown.length ? `A4:J${4 + shown.length}` : null },
      { name: 'By login', rows: urows, cols: [14, 20, 12, 9, 19, 10, 12, 10, 11, 19, 30].map((x) => ({ width: x })), freezeRow: 4, headerRow: 4, merges: ['A1:K1', 'A2:K2'] },
    ]), `Activity log ${from} to ${to}${user ? ` ${user}` : ''}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-3" aria-label="Activity log">
      <section className={`${card} p-4 sm:p-5`} aria-label="Activity log period">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h3 className="flex items-center gap-2 text-fs-18 font-bold text-slate-900"><History size={18} aria-hidden /> Activity log</h3>
            <p className="mt-0.5 text-fs-13 text-slate-600">Who logged in (and who tried), who logged out, the pages each login opened and every change it made — what, where, when and from which PC.</p>
          </div>
          <button type="button" onClick={() => setN((x) => x + 1)} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} aria-hidden className={busy ? 'animate-spin' : ''} /> Refresh</button>
          <button type="button" onClick={excel} disabled={!shown.length} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-700 px-3 text-fs-13 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"><Download size={14} aria-hidden /> Excel</button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Period">
            {PERIODS.map(([k, label, f, t]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => { setFrom(f); setTo(t); }} className={`h-9 border-r border-slate-300 px-3 text-fs-13 font-semibold last:border-r-0 ${period === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{label}</button>)}
          </div>
          <label className="text-fs-12 font-bold text-slate-700">From<input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${inp} ml-1`} /></label>
          <label className="text-fs-12 font-bold text-slate-700">To<input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${inp} ml-1`} /></label>
          <label className="text-fs-12 font-bold text-slate-700">Login
            <select aria-label="Login" value={user} onChange={(e) => pickUser(e.target.value)} className={`${inp} ml-1 max-w-[220px]`}>
              <option value="">Every login</option>
              {[...new Set([...users.map((u) => u.user), ...(user ? [user] : [])])].map((id) => { const u = users.find((x) => x.user === id); return <option key={id} value={id}>{u?.name && u.name !== id ? `${u.name} (${id})` : id}</option>; })}
            </select>
          </label>
          {user && <button type="button" onClick={() => pickUser('')} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-700"><X size={13} aria-hidden /> Every login</button>}
        </div>
        {err && <p role="alert" className="mt-2 text-fs-13 font-bold text-red-700">{err}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" aria-label="Activity totals">
          {tile('Logins', c.login, 'text-emerald-700', 'login')}
          {tile('Failed logins', c.login_fail, 'text-red-700', 'login_fail')}
          {tile('Changes', c.change, 'text-blue-800', 'change')}
          {tile('Refused / not saved', c.refused, 'text-amber-700', 'refused')}
          {tile('Pages opened', c.view, 'text-sky-800', 'view')}
          {tile('Log outs', c.logout, 'text-slate-800', 'logout')}
          {tile('Reports downloaded', c.download, 'text-violet-800', 'download')}
          {tile('Page errors', c.error, 'text-rose-700', 'error')}
        </div>
      </section>

      <section className={`${card} p-3 sm:p-4`} aria-label="Activity by login">
        <h4 className="text-fs-15 font-extrabold text-slate-900">By login <span className="text-fs-12 font-semibold normal-case text-slate-500">— {dmy(from)} to {dmy(to)}; click a login to see only its activity</span></h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-fs-13 tabular-nums" aria-label="Logins and their activity">
            <thead><tr className="bg-[#1F3864] text-fs-12 text-white">{['Login', 'Role', 'Logins', 'Last login', 'Changes', 'Refused', 'Failed logins', 'Pages opened', 'Last seen', 'PCs (IP)'].map((x) => <th key={x} className={th}>{x}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user} onClick={() => pickUser(user === u.user ? '' : u.user)} aria-label={`Activity of ${u.user}`} className={`cursor-pointer hover:bg-[#DDEBF7]/50 ${user === u.user ? 'bg-blue-50' : ''}`}>
                  <td className={td}><b className="text-slate-900">{u.name || u.user}</b>{u.name && u.name !== u.user && <span className="ml-1 text-fs-12 text-slate-500">{u.user}</span>}</td>
                  <td className={td}>{ROLE[u.role] || u.role || '—'}</td>
                  <td className={`${td} text-right font-mono`}>{nf(u.logins)}</td>
                  <td className={`${td} whitespace-nowrap`}>{dmyt(u.lastLogin)}</td>
                  <td className={`${td} text-right font-mono font-bold text-blue-800`}>{u.changes ? nf(u.changes) : ''}</td>
                  <td className={`${td} text-right font-mono font-bold text-amber-700`}>{u.refused ? nf(u.refused) : ''}</td>
                  <td className={`${td} text-right font-mono font-bold text-red-700`}>{u.fails ? nf(u.fails) : ''}</td>
                  <td className={`${td} text-right font-mono`}>{u.views ? nf(u.views) : ''}</td>
                  <td className={`${td} whitespace-nowrap`}>{dmyt(u.lastSeen)}</td>
                  <td className={`${td} text-fs-12 text-slate-600`}>{(u.ips || []).join(', ')}</td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={10} className={`${td} py-4 text-center text-slate-500`}>{busy ? 'Reading the activity log …' : 'Nobody logged in on these days.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} p-3 sm:p-4`} aria-label="Activity">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Show">
            {SHOW.map(([k, label]) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`h-9 border-r border-slate-300 px-2.5 text-fs-13 font-semibold last:border-r-0 ${show === k ? 'bg-[#1F3864] text-white' : 'bg-white text-[#1F3864] hover:bg-slate-50'}`}>{label}</button>)}
          </div>
          <label className="relative"><Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden /><input type="search" aria-label="Search the activity" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Line, model, reason, page, IP …" className={`${inp} w-60 pl-8`} /></label>
          <span className="ml-auto text-fs-13 font-semibold text-slate-600" aria-label="Rows shown">{nf(shown.length)} rows{data?.truncated ? ` (the newest ${nf(events.length)} of ${nf(data.total)} — choose fewer days or one login)` : ''}</span>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-fs-13" aria-label="Activity list">
            <thead><tr className="bg-[#1F3864] text-fs-12 text-white">{['Time', 'Login', 'What happened', 'Where', 'Details', 'PC'].map((x) => <th key={x} className={th}>{x}</th>)}</tr></thead>
            <tbody>
              {shown.slice(0, limit).map((e, i) => {
                const k = kindOf(e); const K = KIND[k] || KIND.view; const Icon = K.icon;
                return (
                  <tr key={`${e.time}-${i}`} className={k === 'login_fail' || k === 'failed' ? 'bg-red-50/40' : k === 'refused' ? 'bg-amber-50/40' : ''}>
                    <td className={`${td} whitespace-nowrap font-mono text-fs-12`}>{dmyt(e.time)}</td>
                    <td className={`${td} min-w-[120px]`}>{e.user ? <><b className="whitespace-nowrap text-slate-900">{e.name || e.user}</b>{e.name && e.name !== e.user && <span className="block text-fs-12 text-slate-500">{e.user}</span>}</> : <span className="text-slate-500">—</span>}</td>
                    <td className={td}><span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-fs-12 font-bold ring-1 ${K.cls}`}><Icon size={12} aria-hidden />{K.label}</span></td>
                    <td className={`${td} min-w-[140px] font-semibold text-slate-800`}>{areaOf(e) || '—'}</td>
                    <td className={`${td} min-w-[260px] text-fs-12 text-slate-800`}>
                      {e.ev === 'login_fail' && <span className="font-semibold text-red-800">{WHY[e.why] || e.why}</span>}
                      {(e.what || []).map((x, j) => <div key={j} className="leading-snug">{x}</div>)}
                      {e.error && <div className="font-semibold text-red-700">{e.status ? `${e.status} · ` : ''}{e.error}</div>}
                    </td>
                    <td className={`${td} whitespace-nowrap text-fs-12 text-slate-600`}>{e.ip || '—'}<span className="block text-slate-500">{device(e.ua)}</span></td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={6} className={`${td} py-4 text-center text-slate-500`}>{busy ? 'Reading the activity log …' : 'Nothing to show for these days and filters.'}</td></tr>}
            </tbody>
          </table>
          {shown.length > limit && <button type="button" onClick={() => setLimit((x) => x + 300)} className="mt-2 h-9 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-800">Show 300 more ({nf(shown.length - limit)} left)</button>}
        </div>
        <p className="mt-2 text-fs-12 text-slate-500">Kept on the server (backend/data/activity, one file a month) — never in a database. Passwords are never written. TV screens are not logged. A change shows what it was before (“was: …”).</p>
      </section>
    </div>
  );
}
