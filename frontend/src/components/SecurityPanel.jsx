import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, Ban, Lock, RefreshCw, Save, X, Plus, Mail, Bell, CheckCheck, Send } from 'lucide-react';
import { api } from '../api';
import { device } from './ActivityLog';

/**
 * Setup → Security (25-11-2026, admin). The API answers only Line Pulse open in a browser (backend lib/security.php):
 * a program that copies the data is refused. Here the admin sees which PCs use Line Pulse and what was refused, blocks a
 * PC, and locks a login (a TV login to its TV, the admin login to the admin PC) to its PCs.
 */
const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
const inp = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-13 font-semibold text-slate-900';
const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-fs-13 font-bold';
const WHY = { 'no-page': 'Not from a Line Pulse page (script / program)', blocked: 'PC blocked', locked: 'Login used on another PC', 'too-many': 'Too many requests in a minute', ok: '', 'security settings': 'Security settings changed' };
const EV = { refused: ['Refused', 'bg-red-100 text-red-800'], login: ['Login', 'bg-emerald-100 text-emerald-800'], change: ['Changed', 'bg-blue-100 text-blue-800'] };
const ROLE = { admin: 'Admin', management: 'Office', tv: 'TV' };
const ipOk = (s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /^(\d{1,3}\.){1,3}\*$/.test(s) || s === '::1';
const dmyt = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)} ${s.slice(11, 16)}` : '');

export default function SecurityPanel() {
  const [d, setD] = useState(null);
  const [users, setUsers] = useState([]);
  const [block, setBlock] = useState([]);
  const [lock, setLock] = useState({});
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setErr('');
    try {
      const [s, u] = await Promise.all([api.security(), api.users()]);
      setD(s); setUsers(u.users || []);
      setBlock(s.conf?.block || []);
      setLock(Array.isArray(s.conf?.lock) ? {} : (s.conf?.lock || {}));
    } catch (x) { setErr(x.message); }
  };
  useEffect(() => { load(); }, []);
  // every PC of the log: the logins used there, what was refused, last seen
  const pcs = useMemo(() => {
    const m = new Map();
    for (const e of d?.log || []) {
      const o = m.get(e.ip) || { ip: e.ip, users: new Set(), roles: {}, refused: 0, why: new Set(), last: e.time, ua: new Set() };
      if (e.user) { o.users.add(e.user); o.roles[e.user] = e.role || o.roles[e.user]; }
      if (e.ev === 'refused') { o.refused++; o.why.add(e.why); }
      if (e.ua) o.ua.add(device(e.ua) || e.ua.slice(0, 30));
      m.set(e.ip, o);
    }
    return [...m.values()].sort((a, b) => b.refused - a.refused || String(b.last).localeCompare(String(a.last)));
  }, [d]);
  const save = async (b = block, l = lock, text = 'Saved.') => {
    setBusy(true); setMsg(''); setErr('');
    try { const j = await api.saveSecurity({ block: b, lock: l }); setBlock(j.conf.block || []); setLock(Array.isArray(j.conf.lock) ? {} : j.conf.lock || {}); setMsg(text); await load(); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const addBlock = (ip) => { const v = ip.trim(); if (!ipOk(v)) { setErr(`"${v}" is not an IP address (192.168.3.71) or a range (192.168.3.*).`); return; } save([...new Set([...block, v])], lock, `PC ${v} blocked — it gets no data any more.`); setAdd(''); };
  const setLockText = (u, txt) => setLock((x) => ({ ...x, [u]: txt.split(/[\s,]+/).filter(Boolean) }));
  if (err && !d) return <div className={`${card} text-fs-14 font-semibold text-red-700`}>Security settings could not be read: {err}</div>;
  if (!d) return <div className={`${card} text-fs-14 text-slate-600`}>Reading the security settings…</div>;
  // this PC: its address; on the server PC itself also localhost (the same PC opened as localhost:8080)
  const local = ['::1', '127.0.0.1'];
  const herePcs = [...new Set([d.you, ...(local.includes(d.you) || (d.server && d.you === d.server) ? [...local, d.server].filter(Boolean) : [])])];
  const tvs = users.filter((u) => u.role === 'tv');
  const office = users.filter((u) => u.role !== 'tv');
  return (
    <div className="flex flex-col gap-3" data-testid="security-panel">
      <section className={card}>
        <div className="flex flex-wrap items-start gap-3">
          <ShieldCheck size={28} className="text-emerald-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-fs-18 font-extrabold text-slate-900" style={{ margin: 0 }}>Security · who may read Line Pulse data</h2>
            <ul className="mt-1 list-disc pl-5 text-fs-13 leading-relaxed text-slate-700">
              <li>The data is given only to <b>Line Pulse open in a browser</b> of this server — a script or program that calls the API directly is refused.</li>
              <li>An office login (admin / management) works only on the PC it logged in on; its key copied to another PC is refused.</li>
              <li>No data without a login (always on) · at most 900 requests a minute per PC · web pages of Line Pulse carry the browser security headers.</li>
              <li>Block a PC below, or lock a login to its own PCs (a TV login to its TV) — then nobody can use that login anywhere else. "This PC" adds the PC you are on. A new password ends every other login of that user at once.</li>
            </ul>
            <div className="mt-1 text-fs-12 text-slate-500">This PC: <b className="font-mono">{d.you}</b></div>
          </div>
          <button type="button" onClick={load} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><RefreshCw size={14} aria-hidden /> Refresh</button>
        </div>
        {msg && <div role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-fs-13 font-bold text-emerald-800">{msg}</div>}
        {err && <div role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-fs-13 font-bold text-red-700">{err}</div>}
      </section>

      <AlertsCard />
      <MailCard />
      <section className={card} aria-label="PCs">
        <h3 className="mb-2 text-fs-15 font-extrabold text-[#1F3864]" style={{ margin: 0 }}>PCs that used Line Pulse (last {d.log.length} events)</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-fs-13" data-testid="sec-pcs">
            <thead><tr className="bg-[#DCE6F2] text-left text-[#1F3864]"><th className="px-2 py-1.5">PC (IP)</th><th className="px-2 py-1.5">Logins used</th><th className="px-2 py-1.5">Browser</th><th className="px-2 py-1.5 text-right">Refused</th><th className="px-2 py-1.5">Why</th><th className="px-2 py-1.5">Last</th><th className="px-2 py-1.5" /></tr></thead>
            <tbody>
              {pcs.map((p) => {
                const blocked = block.includes(p.ip);
                return (
                  <tr key={p.ip} className={`border-b border-slate-100 ${p.refused ? 'bg-red-50/40' : ''}`}>
                    <td className="px-2 py-1.5 font-mono font-bold">{p.ip}{p.ip === d.you && <span className="ml-1 rounded bg-slate-200 px-1 text-fs-11">this PC</span>}</td>
                    <td className="px-2 py-1.5">{[...p.users].map((u) => <span key={u} className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-fs-12">{u} <span className="text-slate-500">{ROLE[p.roles[u]] || ''}</span></span>)}</td>
                    <td className="px-2 py-1.5 text-fs-12 text-slate-600">{[...p.ua].slice(0, 2).join(' · ')}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-bold ${p.refused ? 'text-red-700' : 'text-slate-400'}`}>{p.refused}</td>
                    <td className="px-2 py-1.5 text-fs-12 text-slate-700">{[...p.why].map((w) => WHY[w] || w).join(' · ')}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-fs-12">{dmyt(p.last)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {p.ip !== d.you && !blocked && <button type="button" disabled={busy} data-testid={`sec-block-${p.ip}`} onClick={() => addBlock(p.ip)} className={`${btn} h-8 border-red-300 bg-white text-red-700 hover:bg-red-50`}><Ban size={13} aria-hidden /> Block</button>}
                      {blocked && <span className="rounded bg-red-600 px-2 py-0.5 text-fs-12 font-bold text-white">Blocked</span>}
                    </td>
                  </tr>
                );
              })}
              {!pcs.length && <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-500">Nothing yet — the log starts with this version.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className={card} aria-label="Blocked PCs">
          <h3 className="mb-2 flex items-center gap-1.5 text-fs-15 font-extrabold text-[#1F3864]" style={{ margin: 0 }}><Ban size={16} aria-hidden /> Blocked PCs</h3>
          <div className="flex flex-wrap gap-1.5">
            {block.map((ip) => (
              <span key={ip} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 font-mono text-fs-13 font-bold text-red-800">{ip}
                <button type="button" aria-label={`Unblock ${ip}`} disabled={busy} onClick={() => save(block.filter((x) => x !== ip), lock, `PC ${ip} unblocked.`)} className="rounded-full p-0.5 hover:bg-red-200"><X size={13} aria-hidden /></button>
              </span>
            ))}
            {!block.length && <span className="text-fs-13 text-slate-500">No PC is blocked.</span>}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add && addBlock(add)} placeholder="192.168.3.71 or 192.168.3.*" aria-label="IP to block" className={`${inp} w-56 font-mono`} />
            <button type="button" disabled={busy || !add} onClick={() => addBlock(add)} className={`${btn} border-red-600 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50`}><Plus size={14} aria-hidden /> Block</button>
          </div>
        </section>

        <section className={card} aria-label="Logins locked to their PCs">
          <h3 className="mb-1 flex items-center gap-1.5 text-fs-15 font-extrabold text-[#1F3864]" style={{ margin: 0 }}><Lock size={16} aria-hidden /> Logins locked to their PCs</h3>
          <p className="mb-2 text-fs-12 text-slate-600">IP addresses (or a range like 192.168.2.*) separated by commas. Empty = the login works on every PC. Lock each TV login to its TV.</p>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full border-collapse text-fs-13">
              <tbody>
                {[...tvs, ...office].map((u) => {
                  const seen = pcs.filter((p) => p.users.has(u.user) && !p.refused).map((p) => p.ip);
                  return (
                    <tr key={u.user} className="border-b border-slate-100">
                      <td className="whitespace-nowrap py-1 pr-2 font-bold">{u.user} <span className="text-fs-11 font-semibold text-slate-500">{ROLE[u.role] || u.role}</span></td>
                      <td className="w-full py-1"><input aria-label={`PCs of ${u.user}`} value={(lock[u.user] || []).join(', ')} onChange={(e) => setLockText(u.user, e.target.value)} placeholder={seen.length ? `seen on ${seen.join(', ')}` : 'any PC'} className={`${inp} w-full font-mono`} /></td>
                      <td className="whitespace-nowrap py-1 pl-1">
                        {/* 25-11-2026: one click — this login only on the PC in front of you (the server PC also by localhost) */}
                        <button type="button" data-testid={`lock-here-${u.user}`} onClick={() => setLock((x) => ({ ...x, [u.user]: [...new Set([...(x[u.user] || []), ...herePcs])] }))} className="mr-1 rounded border border-[#1F3864] px-1.5 py-1 text-fs-11 font-bold text-[#1F3864] hover:bg-[#EEF3FB]" title={`Allow this login on this PC (${herePcs.join(', ')})`}>This PC</button>
                        {seen.length > 0 && !(lock[u.user] || []).length && <button type="button" onClick={() => setLock((x) => ({ ...x, [u.user]: seen }))} className="rounded border border-slate-300 px-1.5 py-1 text-fs-11 font-bold text-slate-700 hover:bg-slate-50" title="Lock to the PCs it was used on">Use seen</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={busy} data-testid="sec-save" onClick={() => {
            const bad = Object.values(lock).flat().find((x) => !ipOk(x));
            if (bad) { setErr(`"${bad}" is not an IP address or a range.`); return; }
            save(block, Object.fromEntries(Object.entries(lock).filter(([, v]) => v.length)), 'Login locks saved.');
          }} className={`${btn} mt-2 border-[#1F3864] bg-[#1F3864] text-white hover:bg-blue-900 disabled:opacity-50`}><Save size={14} aria-hidden /> Save locks</button>
        </section>
      </div>

      <section className={card} aria-label="Security log">
        <h3 className="mb-2 flex items-center gap-1.5 text-fs-15 font-extrabold text-[#1F3864]" style={{ margin: 0 }}><ShieldAlert size={16} aria-hidden /> Security log</h3>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full border-collapse text-fs-12">
            <thead><tr className="sticky top-0 bg-slate-100 text-left"><th className="px-2 py-1">Time</th><th className="px-2 py-1">Event</th><th className="px-2 py-1">Login</th><th className="px-2 py-1">PC</th><th className="px-2 py-1">Why</th><th className="px-2 py-1">API</th><th className="px-2 py-1">Browser / program</th></tr></thead>
            <tbody>
              {d.log.map((e, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1 font-mono">{dmyt(e.time)}</td>
                  <td className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 font-bold ${(EV[e.ev] || ['', 'bg-slate-100'])[1]}`}>{(EV[e.ev] || [e.ev])[0]}</span></td>
                  <td className="px-2 py-1">{e.user || '—'}{e.role ? <span className="ml-1 text-slate-500">{ROLE[e.role] || e.role}</span> : null}</td>
                  <td className="px-2 py-1 font-mono">{e.ip}</td>
                  <td className="px-2 py-1">{WHY[e.why] ?? e.why}</td>
                  <td className="px-2 py-1 font-mono">{e.api}</td>
                  <td className="max-w-[260px] truncate px-2 py-1 text-slate-600" title={e.ua}>{e.ua || '— (no browser name)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** 25-11-2026: the security alerts (newest first) — read / unread, the PC, the login, what happened */
function AlertsCard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.securityAlerts().then(setD).catch((x) => setErr(x.message));
  useEffect(() => { load(); }, []);
  const readAll = async () => { try { await api.alertsRead([], true); load(); } catch (x) { setErr(x.message); } };
  const list = d?.alerts || [];
  return (
    <section className={card} aria-label="Security alerts" data-testid="sec-alerts">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-fs-15 font-extrabold text-[#1F3864]" style={{ margin: 0 }}><Bell size={16} aria-hidden /> Security alerts</h3>
        {d && <span className={`rounded-full px-2 py-0.5 text-fs-12 font-bold ${d.unread ? 'bg-red-600 text-white' : 'bg-emerald-100 text-emerald-800'}`}>{d.unread ? `${d.unread} not read` : 'All read'}</span>}
        <span className="text-fs-12 text-slate-500">the admin sees them on the red shield beside the bell{d?.mail?.on ? ' and gets them by e-mail' : ''}</span>
        <button type="button" disabled={!d?.unread} onClick={readAll} className={`${btn} ml-auto h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50`}><CheckCheck size={14} aria-hidden /> Mark all read</button>
      </div>
      {err && <div role="alert" className="mb-2 text-fs-13 font-bold text-red-700">{err}</div>}
      <div className="max-h-[300px] overflow-auto">
        <table className="w-full border-collapse text-fs-12">
          <thead><tr className="sticky top-0 bg-slate-100 text-left"><th className="px-2 py-1">Time</th><th className="px-2 py-1">Alert</th><th className="px-2 py-1">PC</th><th className="px-2 py-1">Login</th><th className="px-2 py-1">Detail</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className={`border-b border-slate-100 ${a.read ? '' : 'bg-red-50 font-semibold'}`}>
                <td className="whitespace-nowrap px-2 py-1 font-mono">{dmyt(a.time)}</td>
                <td className="px-2 py-1">{!a.read && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-600" />}{a.text}</td>
                <td className="px-2 py-1 font-mono">{a.ip}</td>
                <td className="px-2 py-1">{a.user || '—'}</td>
                <td className="max-w-[360px] truncate px-2 py-1 text-slate-600" title={`${a.detail || ''}${a.ua ? ` · ${a.ua}` : ''}`}>{a.detail || '—'}</td>
              </tr>
            ))}
            {d && !list.length && <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-500">No alert yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 25-11-2026: alerts by e-mail through the plant's mail server (SMTP). The password is typed here and kept encrypted on the server — never shown again. */
function MailCard() {
  const [m, setM] = useState(null);
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.securityAlerts().then((j) => setM({ ...j.mail, toText: (j.mail?.to || []).join(', ') })).catch((x) => setErr(x.message)); }, []);
  if (!m) return null;
  const set = (k, v) => setM((x) => ({ ...x, [k]: v }));
  const body = () => ({ on: !!m.on, host: m.host, port: Number(m.port) || 587, secure: m.secure, user: m.user, from: m.from, to: String(m.toText || '').split(/[\s,;]+/).filter(Boolean), ...(pass ? { pass } : {}) });
  const save = async () => {
    setBusy(true); setMsg(''); setErr('');
    try { const j = await api.mailSave(body()); setM({ ...j.mail, toText: (j.mail.to || []).join(', ') }); setPass(''); setMsg(j.mail.on ? 'Saved — alerts go by e-mail too.' : 'Saved (e-mail off).'); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true); setMsg(''); setErr('');
    try { const j = await api.mailTest(); if (j.ok) setMsg('Test mail sent — check the inbox.'); else setErr(`Not sent: ${j.error}`); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const f = (label, el) => <label className="flex flex-col gap-0.5 text-fs-12 font-bold text-slate-600">{label}{el}</label>;
  return (
    <section className={card} aria-label="Alert e-mail" data-testid="sec-mail">
      <h3 className="mb-1 flex items-center gap-1.5 text-fs-15 font-extrabold text-[#1F3864]" style={{ margin: 0 }}><Mail size={16} aria-hidden /> Alerts by e-mail</h3>
      <p className="mb-2 text-fs-12 text-slate-600">The plant's mail server (ask IT: server, port, user). The password is kept encrypted on the server and never shown again — leave it empty to keep the saved one.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {f('Mail server (SMTP)', <input value={m.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.office365.com" className={inp} />)}
        {f('Port', <input value={m.port} onChange={(e) => set('port', e.target.value.replace(/[^0-9]/g, ''))} placeholder="587" className={inp} />)}
        {f('Security', <select value={m.secure} onChange={(e) => set('secure', e.target.value)} className={inp}><option value="tls">STARTTLS (587)</option><option value="ssl">SSL (465)</option><option value="none">None (25, inside the plant)</option></select>)}
        {f('Mail user', <input value={m.user} onChange={(e) => set('user', e.target.value)} placeholder="linepulse@dixon…" autoComplete="off" className={inp} />)}
        {f(`Password${m.hasPass ? ' (saved — type only to change)' : ''}`, <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" placeholder={m.hasPass ? '••••••••' : ''} className={inp} />)}
        {f('From', <input value={m.from} onChange={(e) => set('from', e.target.value)} placeholder="linepulse@dixon…" className={inp} />)}
        <div className="sm:col-span-2">{f('To (one or more, comma between)', <input value={m.toText} onChange={(e) => set('toText', e.target.value)} placeholder="admin@dixon…, it@dixon…" className={`${inp} w-full`} />)}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-fs-13 font-bold text-slate-800"><input type="checkbox" checked={!!m.on} onChange={(e) => set('on', e.target.checked)} className="h-4 w-4" /> Send the alerts by e-mail</label>
        <button type="button" disabled={busy} onClick={save} className={`${btn} border-[#1F3864] bg-[#1F3864] text-white hover:bg-blue-900 disabled:opacity-50`}><Save size={14} aria-hidden /> Save</button>
        <button type="button" disabled={busy || !m.host} onClick={test} className={`${btn} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50`}><Send size={14} aria-hidden /> Send a test mail</button>
        {msg && <span role="status" className="text-fs-13 font-bold text-emerald-700">{msg}</span>}
        {err && <span role="alert" className="text-fs-13 font-bold text-red-700">{err}</span>}
      </div>
    </section>
  );
}
