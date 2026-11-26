import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import DixonLogo from './DixonLogo';
import { LogOut, KeyRound, ShieldCheck, ShieldAlert, Eye, EyeOff, X, User, Tv, UserPlus, Trash2, Radio, Gauge, ClipboardList, Wrench } from 'lucide-react';
import { api, ALL_LINE_IDS } from '../api';
import { AvatarPic, ProfileDialog, useAvatars } from './Avatar';
import { getAuth, setAuth, clearAuth, AUTH_EVENT } from '../auth';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
const inp = 'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-fs-16 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';

/* ───────────── login page ───────────── */

function LoginPage() {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!user.trim() || !pass) { setErr('Enter your user ID and password.'); return; }
    setBusy(true); setErr('');
    try {
      const j = await api.login(user.trim(), pass);
      setAuth({ token: j.token, exp: j.exp, user: j.user, role: j.role, display: j.display, lines: Array.isArray(j.lines) ? j.lines.map(String) : [], oleEdit: !!j.oleEdit, dept: j.dept || '', pages: Array.isArray(j.pages) ? j.pages : [] });
    } catch (x) {
      setErr(String(x.message || x) === 'Failed to fetch' ? 'The server did not answer. Check the network and try again.' : String(x.message || x));
    } finally { setBusy(false); }
  };
  const [caps, setCaps] = useState(false);
  const capsOf = (e) => { try { setCaps(!!e.getModifierState?.('CapsLock')); } catch { /* old browser */ } };
  const FEAT = [
    [Radio, 'Live lines', 'Every line hour by hour — pieces, target, running model'],
    [Gauge, 'OLE & losses', 'Availability, performance and quality of every line'],
    [ClipboardList, 'Loss & quality entry', 'Idle time, rework and dismantle — hour by hour'],
    [Wrench, 'RCA & CAPA', 'Every loss reaches its department for the root cause'],
  ];
  // 26-11-2026: the hour bars of the animated line on the left (heights in %, the last one is "this hour")
  const BARS = [62, 78, 70, 88, 54, 92, 80, 96];
  return (
    <div className="lp-login min-h-screen grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-[#F3F6FB]">
      {/* left: what the system is — animated (moving gradient, a running line, rising hour bars); phones show only the form */}
      <aside className="lp-login-hero relative hidden overflow-hidden px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <span aria-hidden className="lp-login-grid" />
        <span aria-hidden className="lp-login-orb lp-login-orb1" />
        <span aria-hidden className="lp-login-orb lp-login-orb2" />
        <div className="relative z-10 flex items-center gap-3">
          <DixonLogo white className="h-8" />
          <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 text-fs-12 font-bold tracking-wide text-sky-100 backdrop-blur">Line Pulse</span>
        </div>
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1 text-fs-12 font-bold uppercase tracking-wider text-emerald-200">
            <span className="lp-login-live" aria-hidden /> Live · Washing machine assembly
          </div>
          <h2 className="mt-4 text-fs-40 font-extrabold leading-[1.1]">Every line.<br /><span className="lp-login-shine">Every hour. Every piece.</span></h2>
          <p className="mt-3 max-w-xl text-fs-16 text-sky-100/90">Live output, OLE, losses and root cause of every line — one screen for supervisors and management.</p>
          {/* the running line: hour bars rising against the target, boxes moving on the conveyor */}
          <div className="lp-login-card mt-7 max-w-xl rounded-2xl border border-white/15 bg-white/[.06] p-4 backdrop-blur" aria-hidden>
            <div className="mb-2 flex items-center justify-between text-fs-12 font-bold uppercase tracking-wider text-sky-100/80"><span>Output by hour</span><span className="text-emerald-300">104%</span></div>
            <div className="relative flex h-28 items-end gap-2">
              <span className="absolute inset-x-0 border-t-2 border-dashed border-white/40" style={{ bottom: '72%' }} />
              {BARS.map((h, k) => <span key={k} className="lp-login-bar flex-1 rounded-t-md" style={{ height: `${h}%`, animationDelay: `${k * 0.12}s`, background: h >= 72 ? 'linear-gradient(180deg,#34D399,#059669)' : 'linear-gradient(180deg,#FBBF24,#D97706)' }} />)}
            </div>
            <div className="lp-login-belt mt-3 h-3 rounded-full">{[0, 1, 2, 3].map((k) => <span key={k} className="lp-login-box" style={{ animationDelay: `${k * 1.1}s` }} />)}</div>
          </div>
          <ul className="mt-7 grid max-w-xl grid-cols-2 gap-3">
            {FEAT.map(([Icon, t, d], k) => (
              <li key={t} className="lp-login-feat flex items-start gap-3 rounded-xl border border-white/10 bg-white/[.05] p-3" style={{ animationDelay: `${0.3 + k * 0.1}s` }}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-sky-400/30 to-indigo-400/20 text-sky-100"><Icon size={18} aria-hidden /></span>
                <span><span className="block text-fs-14 font-bold">{t}</span><span className="block text-fs-12 leading-snug text-sky-100/80">{d}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-fs-12 text-sky-100/70">Dixon Technologies (India) Ltd · For plant use only</p>
      </aside>
      {/* right: sign in */}
      <div className="relative flex items-center justify-center overflow-hidden p-4 sm:p-8">
        <span aria-hidden className="lp-login-soft" />
        <div className="relative w-full max-w-md">
          <DixonLogo className="mb-6 h-8 lg:hidden" />
          <form onSubmit={submit} aria-label="Login" className="lp-login-form rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-[0_20px_60px_-20px_rgba(31,56,100,.35)] backdrop-blur sm:p-8">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center text-white shadow-md" style={{ borderRadius: 12, background: 'linear-gradient(135deg,#1F3864,#2E75B6)' }}><ShieldCheck size={22} aria-hidden /></span>
              <div><h1 className="text-fs-24 font-extrabold leading-tight text-dixon-ink">Welcome back</h1><p className="text-fs-14 text-slate-600">Sign in to Line Pulse</p></div>
            </div>
            <label className="block text-fs-14 font-semibold text-slate-800" htmlFor="login-user">User ID</label>
            <div className="relative mt-1">
              <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input id="login-user" className={`${inp} h-12 rounded-xl pl-9 text-fs-15 transition-shadow`} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus placeholder="e.g. line12" />
            </div>
            <label className="mt-4 block text-fs-14 font-semibold text-slate-800" htmlFor="login-pass">Password</label>
            <div className="relative mt-1">
              <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input id="login-pass" type={show ? 'text' : 'password'} className={`${inp} h-12 rounded-xl pl-9 pr-11 text-fs-15 transition-shadow`} value={pass} onChange={(e) => setPass(e.target.value)} onKeyUp={capsOf} onKeyDown={capsOf} autoComplete="current-password" placeholder="Password" />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            {caps && <div role="status" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-fs-12 font-semibold text-amber-800"><ShieldAlert size={14} aria-hidden /> Caps Lock is on</div>}
            {err && <div role="alert" className="lp-login-shake mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
            <button type="submit" disabled={busy} className="lp-login-btn mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-fs-16 font-bold text-white disabled:opacity-70">
              {busy ? <><span className="lp-login-spin" aria-hidden /> Checking…</> : 'Log in'}
            </button>
            <p className="mt-4 text-center text-fs-13 text-slate-500">You stay signed in on this device for 7 days. Forgot your password? Ask the administrator.</p>
          </form>
          <p className="mt-4 text-center text-fs-12 text-slate-400">Line Pulse · Dixon EMS</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────── users & passwords (admin) ───────────── */

export function PasswordForm({ user, self, onDone }) {
  const [old, setOld] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const me = useAuth();
  const save = async (e) => {
    e.preventDefault();
    if (nw !== nw2) { setMsg('The two new passwords are not the same.'); return; }
    setBusy(true); setMsg('');
    try {
      const j = await api.setPassword(user, nw, self && me.role !== 'admin' ? old : undefined);
      if (j.token) setAuth({ ...getAuth(), token: j.token, exp: j.exp });
      setMsg(`Password of "${user}" changed.${self ? '' : ' That user must log in again.'}`);
      setOld(''); setNw(''); setNw2('');
      onDone?.();
    } catch (x) { setMsg(`Not changed: ${x.message}`); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="grid gap-2" aria-label={`Change password of ${user}`}>
      {self && me.role !== 'admin' && <input type="password" className={inp} placeholder="Current password" aria-label="Current password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" />}
      <input type="password" className={inp} placeholder="New password (8+ characters, letters and digits)" aria-label={`New password for ${user}`} value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" />
      <input type="password" className={inp} placeholder="New password again" aria-label={`Repeat new password for ${user}`} value={nw2} onChange={(e) => setNw2(e.target.value)} autoComplete="new-password" />
      <button type="submit" disabled={busy || !nw} className="h-10 rounded-lg bg-blue-700 text-white text-fs-14 font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Change password'}</button>
      {msg && <div role="status" className={`text-fs-13 font-semibold ${msg.startsWith('Not') || msg.startsWith('The two') ? 'text-red-700' : 'text-sky-700'}`}>{msg}</div>}
    </form>
  );
}

const ROLE_TEXT = { admin: 'Admin — everything', management: 'View only', tv: 'TV screen — only the live line animation' };
/** "Line 1 & 2" / "All lines" for a list of lines ([] = all). */
export const linesText = (lines) => (!lines?.length || lines.length >= ALL_LINE_IDS.length ? 'All lines' : `Line ${lines.join(' & ')}`);
export const PRESETS = [
  // a supervisor fills the morning entry, the loss entry and the RCA of its lines (the admin ticks the lines)
  { label: 'Supervisor', user: 'supervisor', display: 'Supervisor', lines: [], oleEdit: true, pages: ['daily', 'live', 'oleentry', 'qentry', 'rca'] },
  { label: 'Management (loss analysis)', user: 'management', display: 'Management', lines: [], oleEdit: false, pages: ['lossan', 'rejan', 'rwkan', 'dash', 'oleview', 'olecal', 'losses', 'rca'] },
  { label: 'Line 1 & 2', user: 'line12', display: 'Line 1 & 2', lines: ['1', '2'], oleEdit: true },
  { label: 'Line 3 & 4', user: 'line34', display: 'Line 3 & 4', lines: ['3', '4'], oleEdit: true },
  { label: 'All four lines', user: 'alllines', display: 'All lines', lines: [], oleEdit: true },
  { label: 'Prod (RCA)', user: 'prod', display: 'Prod', lines: [], oleEdit: false, dept: 'Prod' },
  { label: 'Maint (RCA)', user: 'maint', display: 'Maint', lines: [], oleEdit: false, dept: 'Maint' },
  { label: 'Moulding Store (RCA)', user: 'mouldstore', display: 'Moulding Store', lines: [], oleEdit: false, dept: 'Moulding Store' },
  { label: 'Kitting Store (RCA)', user: 'kitstore', display: 'Kitting Store', lines: [], oleEdit: false, dept: 'Kitting Store' },
];

/** Line tick boxes: none ticked = all lines. */
export function LinePick({ value, onChange, label }) {
  const all = !value.length;
  const flip = (l) => { const n = value.includes(l) ? value.filter((x) => x !== l) : [...value, l].sort(); onChange(n.length === ALL_LINE_IDS.length ? [] : n); };
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <button type="button" aria-pressed={all} onClick={() => onChange([])} className={`h-8 rounded-lg border px-2.5 text-fs-13 font-bold ${all ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>All lines</button>
      {ALL_LINE_IDS.map((l) => {
        const on = !all && value.includes(l);
        return <button key={l} type="button" aria-pressed={on} onClick={() => flip(l)} className={`h-8 rounded-lg border px-2.5 text-fs-13 font-bold ${on ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>Line {l}</button>;
      })}
    </div>
  );
}

/** Departments of the plant (the HPR's "Loss Cont Dept"); the reason master gives every reason one of them. */
export const DEPTS = ['Prod', 'Maint', 'IT', 'Moulding Store', 'Kitting Store', 'Moulding QA', 'Supplier', 'Sub Assy', 'R&D', 'Outsourcing', 'Logistics', 'Quality', 'PPC', 'Utility', 'Engineering'];
/** Department of a login: it writes the RCA of the losses of that department. Empty = none. */
export function DeptInput({ value, onChange, label }) {
  return (
    <label className="grid gap-1 text-fs-13 font-semibold text-slate-600">Department for RCA (empty = none)
      <input list="ems-depts" className={inp} aria-label={label} placeholder="e.g. Maintenance" value={value} onChange={(e) => onChange(e.target.value)} maxLength={40} />
      <datalist id="ems-depts">{DEPTS.map((d) => <option key={d} value={d} />)}</datalist>
    </label>
  );
}

/** "Can fill OLE entries" tick box. */
export function OleEditBox({ value, onChange, label }) {
  return (
    <label className="flex items-center gap-2 text-fs-13 font-semibold text-slate-700">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="h-4 w-4 accent-blue-700" />
      Can fill OLE entries of its lines (stoppage, rejection, rework)
    </label>
  );
}

/** Admin: a new view-only login, limited to some lines or all lines. */
function NewLoginForm({ taken, onDone }) {
  const [f, setF] = useState({ user: '', display: '', lines: [], oleEdit: false, dept: '', pages: [], pass: '', pass2: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setMsg('');
    const user = f.user.trim().toLowerCase();
    if (taken.includes(user)) { setMsg(`Could not save: "${user}" already exists — change it below.`); return; }
    if (f.pass !== f.pass2) { setMsg('The two passwords are not the same.'); return; }
    setBusy(true);
    try { await api.saveUser(user, { display: f.display.trim() || user, lines: f.lines, oleEdit: f.oleEdit, dept: f.dept.trim(), ...(f.pages.length ? { pages: f.pages } : {}), pass: f.pass }); setMsg(`Login "${user}" made — it sees ${linesText(f.lines)}${f.oleEdit ? ' and can fill the OLE entries' : ''}${f.dept.trim() ? ` and writes the RCA of ${f.dept.trim()}` : ''}.`); setF({ user: '', display: '', lines: [], oleEdit: false, dept: '', pass: '', pass2: '' }); onDone?.(); }
    catch (x) { setMsg(`Could not save: ${x.message}`); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} aria-label="New login" className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 grid gap-2">
      <div className="flex items-center gap-2"><UserPlus size={16} /><b className="text-fs-14">New login</b><span className="text-fs-12 text-slate-600">view only · sees only the lines you pick</span></div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ready-made logins">
        {PRESETS.filter((p) => !taken.includes(p.user)).map((p) => <button key={p.user} type="button" onClick={() => setF((x) => ({ ...x, user: p.user, display: p.display, lines: p.lines, oleEdit: p.oleEdit, dept: p.dept || '', pages: p.pages || [] }))} className="h-8 rounded-full border border-blue-300 bg-white px-3 text-fs-13 font-bold text-blue-800 hover:bg-blue-100">{p.label}</button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inp} aria-label="New user ID" placeholder="User ID, e.g. line12" value={f.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" autoCapitalize="none" />
        <input className={inp} aria-label="Name shown" placeholder="Name shown, e.g. Line 1 & 2" value={f.display} onChange={(e) => set('display', e.target.value)} autoComplete="off" />
      </div>
      <LinePick value={f.lines} onChange={(v) => set('lines', v)} label="Lines of the new login" />
      <OleEditBox value={f.oleEdit} onChange={(v) => set('oleEdit', v)} label="New login can fill OLE entries" />
      <DeptInput value={f.dept} onChange={(v) => set('dept', v)} label="Department of the new login" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input type="password" className={inp} aria-label="Password of the new login" placeholder="Password (8+, letters and digits)" value={f.pass} onChange={(e) => set('pass', e.target.value)} autoComplete="new-password" />
        <input type="password" className={inp} aria-label="Repeat password of the new login" placeholder="Repeat password" value={f.pass2} onChange={(e) => set('pass2', e.target.value)} autoComplete="new-password" />
      </div>
      <button type="submit" disabled={busy || !f.user.trim() || !f.pass} className="h-10 rounded-lg bg-blue-700 text-white text-fs-14 font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Create login'}</button>
      {msg && <div role="status" className={`text-fs-13 font-semibold ${msg.startsWith('Not') || msg.startsWith('The two') ? 'text-red-700' : 'text-sky-700'}`}>{msg}</div>}
    </form>
  );
}

/** Admin: name and lines of an existing view-only login, and removing it. */
function LoginLines({ u, onDone }) {
  const [display, setDisplay] = useState(u.display || u.user);
  const [lines, setLines] = useState((u.lines || []).map(String));
  const [oleEdit, setOleEdit] = useState(!!u.oleEdit);
  const [dept, setDept] = useState(u.dept || '');
  const [msg, setMsg] = useState('');
  const changed = display !== (u.display || u.user) || lines.join() !== (u.lines || []).map(String).join() || oleEdit !== !!u.oleEdit || dept.trim() !== (u.dept || '');
  const save = async () => { setMsg(''); try { await api.saveUser(u.user, { display, lines, oleEdit, dept: dept.trim() }); setMsg(`Saved — "${u.user}" now sees ${linesText(lines)}${oleEdit ? ' and can fill the OLE entries' : ''}${dept.trim() ? ` and writes the RCA of ${dept.trim()}` : ''}.`); onDone?.(); } catch (x) { setMsg(`Could not save: ${x.message}`); } };
  const remove = async () => {
    if (!window.confirm(`Remove the login "${u.user}"? It cannot log in any more.`)) return;
    try { await api.removeUser(u.user); onDone?.(); } catch (x) { setMsg(`Not removed: ${x.message}`); }
  };
  return (
    <div className="grid gap-2 mb-3">
      <input className={inp} aria-label={`Name shown for ${u.user}`} value={display} onChange={(e) => setDisplay(e.target.value)} />
      <LinePick value={lines} onChange={setLines} label={`Lines of ${u.user}`} />
      <OleEditBox value={oleEdit} onChange={setOleEdit} label={`${u.user} can fill OLE entries`} />
      <DeptInput value={dept} onChange={setDept} label={`Department of ${u.user}`} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!changed} onClick={save} className="h-9 rounded-lg bg-blue-700 px-3 text-fs-13 font-bold text-white disabled:opacity-50">Save login</button>
        <button type="button" onClick={remove} className="ml-auto inline-flex h-9 items-center gap-1 rounded-lg border border-red-300 px-3 text-fs-13 font-bold text-red-700 hover:bg-red-50"><Trash2 size={14} aria-hidden /> Remove login</button>
      </div>
      {msg && <div role="status" className={`text-fs-13 font-semibold ${msg.startsWith('Not') ? 'text-red-700' : 'text-sky-700'}`}>{msg}</div>}
    </div>
  );
}

/** Admin: create (or reset the password of) a TV login, which only shows the live line animation full screen. */
function TvLoginForm({ onDone }) {
  const [user, setUser] = useState('tv');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setMsg('');
    if (pw !== pw2) { setMsg('The two passwords are not the same.'); return; }
    setBusy(true);
    try { const j = await api.tvUser(user.trim().toLowerCase(), pw); setMsg(`TV login "${j.user}" is ready. Log in with it on the TV and pick the line.`); setPw(''); setPw2(''); onDone?.(); }
    catch (x) { setMsg(`Could not save: ${x.message}`); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} aria-label="TV login" className="rounded-xl border-2 border-sky-200 bg-sky-50 p-3 grid gap-2">
      <div className="flex items-center gap-2"><Tv size={16} /><b className="text-fs-14">TV screen login</b><span className="text-fs-12 text-slate-600">only the live line animation, nothing else</span></div>
      <input className={inp} aria-label="TV login name" placeholder="Login name, e.g. tv or tv-line3" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
      <input type="password" className={inp} aria-label="TV password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      <input type="password" className={inp} aria-label="Repeat TV password" placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      <button type="submit" disabled={busy || !user || !pw} className="h-10 rounded-lg bg-sky-700 text-white text-fs-14 font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Create / reset TV login'}</button>
      {msg && <div role="status" className={`text-fs-13 font-semibold ${msg.startsWith('Not') || msg.startsWith('The two') ? 'text-red-700' : 'text-sky-700'}`}>{msg}</div>}
    </form>
  );
}

function UsersDialog({ onClose }) {
  const me = useAuth();
  const admin = me.role === 'admin';
  const [users, setUsers] = useState(null);
  const [enforce, setEnforce] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.users().then((j) => { setUsers(j.users); setEnforce(j.enforce); }).catch((x) => setMsg(x.message));
  useEffect(() => { if (admin) load(); }, [admin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const toggle = async () => {
    try { const j = await api.setEnforce(!enforce); setEnforce(j.enforce); setMsg(j.enforce ? 'Server protection is on: nobody can read data without logging in.' : 'Server protection is off.'); }
    catch (x) { setMsg(`Not changed: ${x.message}`); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Users and passwords" onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="sticky top-0 bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div className="text-fs-18 font-bold text-dixon-ink">{admin ? 'Users and passwords' : 'My password'}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-200"><X size={20} /></button>
        </div>
        <div className="p-4 flex flex-col gap-4">
          {!admin && <PasswordForm user={me.user} self />}
          {admin && (
            <>
              <div className={`rounded-xl border p-3 ${enforce ? 'border-sky-300 bg-sky-50' : 'border-slate-300 bg-slate-50'}`}>
                <div className="flex items-start gap-2">
                  {enforce ? <ShieldCheck size={20} className="text-sky-700 shrink-0" /> : <ShieldAlert size={20} className="text-slate-700 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-fs-14">Server protection: {enforce == null ? '…' : enforce ? 'ON' : 'OFF'}</div>
                    <div className="text-fs-13 text-slate-700 leading-snug">{enforce ? 'Every data request needs a login.' : 'Turn this on after the new dashboard build (npm run build) is in use on every screen. Until then old screens keep working without a login.'}</div>
                  </div>
                  <button type="button" onClick={toggle} disabled={enforce == null} className={`shrink-0 rounded-lg px-3 py-1.5 text-fs-13 font-bold text-white ${enforce ? 'bg-slate-600' : 'bg-sky-700'}`}>{enforce ? 'Turn off' : 'Turn on'}</button>
                </div>
              </div>
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-fs-13 text-blue-900">All logins in one table (edit, pages, switch off, last login): <b>Setup → Users &amp; logins</b>.</p>
              <NewLoginForm taken={(users || []).map((u) => u.user)} onDone={load} />
              <TvLoginForm onDone={load} />
              {(users || []).map((u) => (
                <div key={`${u.user}|${(u.lines || []).join()}|${u.display}|${u.oleEdit ? 1 : 0}|${u.dept || ''}`} className="rounded-xl border border-slate-200 p-3" aria-label={`Login ${u.user}`}>
                  <div className="flex flex-wrap items-center gap-2 mb-2"><User size={16} /><b className="text-fs-14">{u.user}</b><span className="rounded-full bg-slate-100 px-2 py-0.5 text-fs-12 font-semibold text-slate-700">{ROLE_TEXT[u.role] || u.role}</span>{u.role === 'management' && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-fs-12 font-bold text-blue-800">{linesText(u.lines)}</span>}{u.oleEdit && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-fs-12 font-bold text-sky-800">fills OLE</span>}{u.dept && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-fs-12 font-bold text-slate-900">RCA: {u.dept}</span>}{u.role === 'tv' && <button type="button" onClick={async () => { try { await api.tvRemove(u.user); setMsg(`TV login ${u.user} removed.`); load(); } catch (x) { setMsg(`Not removed: ${x.message}`); } }} className="ml-auto rounded-md border border-red-300 px-2 py-0.5 text-fs-12 font-bold text-red-700 hover:bg-red-50">Remove</button>}{u.user === me.user && <span className="text-fs-12 text-blue-700 font-semibold">you</span>}</div>
                  {u.role === 'management' && <LoginLines u={u} onDone={load} />}
                  <PasswordForm user={u.user} self={u.user === me.user} />
                </div>
              ))}
            </>
          )}
          {msg && <div role="status" className="text-fs-13 font-semibold text-slate-800">{msg}</div>}
        </div>
      </div>
    </div>
  );
}

/** Name, role, password and log-out — shown in the header of every screen. */
export function UserMenu({ top = false }) {
  const me = useAuth();
  const [open, setOpen] = useState(false);
  const [pic, setPic] = useState(false);
  const avatars = useAvatars(!!me && me.role !== 'tv');   // a TV screen does not ask
  if (!me) return null;
  const roleTag = me.role === 'admin' ? 'Administrator' : me.role === 'tv' ? 'TV screen' : linesText(me.lines);
  const name = me.display || me.user;
  const initials = String(name).trim().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'U';
  const keyLabel = me.role === 'admin' ? 'Users and passwords' : 'Change my password';
  // the MES top bar (19-11-2026): avatar with the initials and a green dot, name, role in capitals, then key and log out
  if (top) return (
    <>
      <div className="lp-user flex shrink-0 items-center gap-2 rounded-[3px] border border-white/25 bg-white/[0.06] py-1 pl-1.5 pr-1">
        {me.role === 'tv' ? (
          <span className="relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-white text-[12px] font-extrabold text-[#1F3864]" aria-hidden>
            {initials}<i className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-[#22C55E] ring-2 ring-[#1F3864]" />
          </span>
        ) : (
          // 20-11-2026: the login's picture (photo or fun picture) — a click changes it
          <button type="button" onClick={() => setPic(true)} title="Change my picture" aria-label="Change my picture" className="relative shrink-0 rounded-full hover:ring-2 hover:ring-white/70">
            <AvatarPic av={avatars[me.user]} name={name} size={30} />
            <i className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-[#22C55E] ring-2 ring-[#1F3864]" />
          </button>
        )}
        <span className="flex min-w-0 flex-col leading-tight" title={`Logged in as ${me.user} (${me.role})`}>
          <b className="max-w-[4.5rem] truncate text-[12px] font-bold text-white sm:max-w-[11rem] sm:text-[13px]">{name}</b>
          <span className="hidden max-w-[11rem] truncate text-[11px] font-bold lp-caps sm:block tracking-[0.06em] text-[#BDD7EE]">{roleTag}</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} title={keyLabel} aria-label={keyLabel} className="rounded-[3px] p-1.5 text-[#BDD7EE] hover:bg-white/15 hover:text-white"><KeyRound size={14} /></button>
        <button type="button" onClick={clearAuth} title="Log out" aria-label="Log out" className="rounded-[3px] p-1.5 text-[#BDD7EE] hover:bg-red-600 hover:text-white"><LogOut size={14} /></button>
      </div>
      {open && createPortal(<UsersDialog onClose={() => setOpen(false)} />, document.body)}
      {pic && <ProfileDialog me={me} onClose={() => setPic(false)} />}
    </>
  );
  return (
    <>
      <div className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white pl-2.5 pr-1 py-1 text-fs-13 shadow-sm">
        {me.role !== 'tv' && <button type="button" onClick={() => setPic(true)} title="Change my picture" aria-label="Change my picture" className="-ml-1 mr-0.5 rounded-full ring-1 ring-slate-300 hover:ring-blue-500"><AvatarPic av={avatars[me.user]} name={me.display || me.user} size={24} /></button>}
        {/* the name once; the role tag only when it says something the name does not */}
        <span className="font-bold text-slate-800" title={`Logged in as ${me.user} (${me.role})`}>{me.display || me.user}</span>
        {(() => { const tag = me.role === 'admin' ? 'Admin' : me.role === 'tv' ? 'TV' : me.lines?.length ? linesText(me.lines) : 'Management'; return String(me.display || me.user).toLowerCase() !== tag.toLowerCase(); })() && <span className={`rounded px-1.5 py-0.5 text-fs-11 font-bold ${me.role === 'admin' ? 'bg-dixon-navy text-white' : 'bg-blue-100 text-blue-800'}`}>{me.role === 'admin' ? 'Admin' : me.role === 'tv' ? 'TV' : me.lines?.length ? linesText(me.lines) : 'Management'}</span>}
        <button type="button" onClick={() => setOpen(true)} title={me.role === 'admin' ? 'Users and passwords' : 'Change my password'} aria-label={me.role === 'admin' ? 'Users and passwords' : 'Change my password'} className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100"><KeyRound size={15} /></button>
        <button type="button" onClick={clearAuth} title="Log out" aria-label="Log out" className="p-1.5 rounded-md text-slate-600 hover:bg-red-50 hover:text-red-700"><LogOut size={15} /></button>
      </div>
      {/* portal: the header's blur would otherwise trap the fixed dialog inside the header */}
      {open && createPortal(<UsersDialog onClose={() => setOpen(false)} />, document.body)}
      {pic && <ProfileDialog me={me} onClose={() => setPic(false)} />}
    </>
  );
}

/** Shows the login page until a user is logged in, then the app with the user in context. */
export default function AuthGate({ children }) {
  const [auth, setA] = useState(() => getAuth());
  useEffect(() => {
    const on = () => setA(getAuth());
    window.addEventListener(AUTH_EVENT, on);
    window.addEventListener('storage', on);                  // logout in another tab
    const id = setInterval(on, 60_000);                      // expiry
    return () => { window.removeEventListener(AUTH_EVENT, on); window.removeEventListener('storage', on); clearInterval(id); };
  }, []);
  // confirm the stored login once with the server (password changed, user removed …)
  // … and take over a change of name or lines made by the admin
  // 24-11-2026: a screen that stays open (TV) renews its login every 3 hours — it no longer logs out after 7 days
  useEffect(() => {
    if (!auth?.token) return undefined;
    const renew = () => api.me().then((j) => { const cur = getAuth(); if (cur && j?.renew?.token && j.user === cur.user) setAuth({ ...cur, token: j.renew.token, exp: j.renew.exp }); }).catch(() => { /* offline: next time */ });
    const id = setInterval(renew, 3 * 3600_000);
    return () => clearInterval(id);
  }, [auth?.user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!auth?.token) return;
    api.me().then((j) => {
      const cur = getAuth(); if (!cur || !j) return;
      // 25-11-2026: the fresh 7 days AND the lines / pages the admin gave this login, in one go (the renewal used to skip the lines)
      const tok = j.renew?.token && j.user === cur.user ? { token: j.renew.token, exp: j.renew.exp } : {};
      const lines = Array.isArray(j.lines) ? j.lines.map(String) : [];
      const pages = Array.isArray(j.pages) ? j.pages : [];
      const changed = lines.join() !== (cur.lines || []).join() || !!j.oleEdit !== !!cur.oleEdit || (j.dept || '') !== (cur.dept || '') || pages.join() !== (cur.pages || []).join() || (j.display && j.display !== cur.display);
      if (changed || tok.token) setAuth({ ...cur, ...tok, ...(changed ? { lines, pages, oleEdit: !!j.oleEdit, dept: j.dept || '', display: j.display || cur.display } : {}) });
    }).catch(() => { /* a 401 logs out by itself */ });
  }, [auth?.token]);
  if (!auth) return <LoginPage />;   // every screen logs in (no TV without a login, no TV links)
  return <AuthCtx.Provider value={auth}>{children(auth)}</AuthCtx.Provider>;
}
