import React, { useEffect, useMemo, useState } from 'react';
import MesDrawer from './MesDrawer';
import { UserPlus, Search, ShieldCheck, ShieldAlert, X, KeyRound, Pencil, Trash2, Tv, User, Users, Building2, UserRound, History, Power } from 'lucide-react';
import { api } from '../api';
import { useAuth, linesText, PRESETS, LinePick, DeptInput, OleEditBox, PasswordForm } from './AuthGate';
import { MGMT_CATALOG, RETIRED_PAGES, FOLDER_DEFAULT } from '../utils/uiSettings';
import { fmtDateTime } from '../theme';

/**
 * Setup → Users & logins (admin): every login in one table.
 *   Kinds: Admin (everything) · View (management / line logins, limited to lines, may fill OLE entries,
 *   may write the RCA of one department, may have its own page list) · TV (only the live line screen).
 *   Add / edit / password / switch off / remove; server protection on / off.
 */
// a supervisor = a view login that may fill the entries and has the Morning entry page
const KIND = (u) => (u.role === 'admin' ? 'admin' : u.role === 'tv' ? 'tv' : u.oleEdit && (u.pages || []).includes('daily') ? 'sup' : u.dept ? 'dept' : 'view');
const KIND_TEXT = { admin: 'Admin', sup: 'Supervisor', view: 'View', dept: 'Department', tv: 'TV screen' };
const KIND_CLS = { admin: 'bg-dixon-navy text-white', sup: 'bg-amber-100 text-amber-900', view: 'bg-blue-100 text-blue-900', dept: 'bg-slate-100 text-slate-900', tv: 'bg-sky-100 text-sky-900' };
const FILTERS = [['all', 'All'], ['admin', 'Admin'], ['sup', 'Supervisor'], ['view', 'View'], ['dept', 'Department'], ['tv', 'TV'], ['off', 'Switched off']];
const inp = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-fs-14 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50';
const ico = 'inline-grid h-8 w-8 place-items-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';   // 27-11-2026: icon buttons (name on hover)

/** 27-11-2026: the pages of a login — the first few, the rest on a click (no wall of text) */
function PagesCell({ names }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(names)) return <span className="text-slate-600">{names}</span>;
  const few = open ? names : names.slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-1" title={names.join(', ')}>
      {few.map((n) => <span key={n} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-fs-12 font-semibold text-slate-700 whitespace-nowrap">{n}</span>)}
      {names.length > 3 && <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md px-1.5 py-0.5 text-fs-12 font-bold text-blue-700 hover:bg-blue-50">{open ? 'less' : `+${names.length - 3} more`}</button>}
    </div>
  );
}

// the MES drawer (components/MesDrawer.jsx): a form opens as the small window in the middle
function Modal({ title, onClose, children, wide = false }) {
  return <MesDrawer title={title} icon={UserRound} onClose={onClose} method="center" width={wide ? 46 : 32} canExpand={false} bodyClass="p-4">{children}</MesDrawer>;
}

/** Page tick boxes of a login: none = the pages of Setup → Management view. */
function PagePick({ value, onChange }) {
  const own = value.length > 0;
  const flip = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const [q, setQ] = useState('');
  const all = MGMT_CATALOG.filter((p) => !RETIRED_PAGES.has(p.id));
  const groups = (() => {
    const used = new Set();
    const g = FOLDER_DEFAULT.map((f) => ({ name: f.name, pages: f.ids.map((id) => all.find((p) => p.id === id)).filter((p) => p && !used.has(p.id) && used.add(p.id)) })).filter((x) => x.pages.length);
    const rest = all.filter((p) => !used.has(p.id));
    return rest.length ? [...g, { name: 'Other', pages: rest }] : g;
  })();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Pages of this login">
        <button type="button" role="radio" aria-checked={!own} onClick={() => onChange([])} className={`h-8 rounded-lg border px-2.5 text-fs-13 font-bold ${!own ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>Same as Management view</button>
        <button type="button" role="radio" aria-checked={own} onClick={() => !own && onChange(['dash'])} className={`h-8 rounded-lg border px-2.5 text-fs-13 font-bold ${own ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>Only these pages</button>
      </div>
      {own && (
        <div className="grid gap-2" role="group" aria-label="Pages">
          {/* 28-11-2026: the pages in their menu folders, with a search and All / None per folder */}
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a page …" aria-label="Search pages" className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 text-fs-13" />
            <span className="text-fs-12 font-semibold text-slate-500">{value.length} of {all.length} pages ticked</span>
          </div>
          {groups.map((g) => {
            const list = g.pages.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase()));
            if (!list.length) return null;
            const on = g.pages.filter((p) => value.includes(p.id)).length;
            return (
              <div key={g.name} className="rounded-lg border border-slate-200" data-testid={`pg-group-${g.name}`}>
                <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1">
                  <span className="text-fs-12 font-extrabold uppercase tracking-wide text-[#1F3864]">{g.name}</span>
                  <span className="text-fs-12 font-semibold text-slate-500">{on}/{g.pages.length}</span>
                  <button type="button" onClick={() => onChange([...new Set([...value, ...g.pages.map((p) => p.id)])])} className="ml-auto rounded px-2 py-0.5 text-fs-12 font-bold text-blue-700 hover:bg-blue-50">All</button>
                  <button type="button" onClick={() => onChange(value.filter((id) => !g.pages.some((p) => p.id === id)))} className="rounded px-2 py-0.5 text-fs-12 font-bold text-slate-600 hover:bg-slate-100">None</button>
                </div>
                <div className="grid grid-cols-2 gap-1 p-1.5 sm:grid-cols-3">
                  {list.map((p) => (
                    <label key={p.id} className={`flex items-center gap-2 rounded-md px-2 py-1 text-fs-13 font-semibold ${value.includes(p.id) ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                      <input type="checkbox" checked={value.includes(p.id)} onChange={() => flip(p.id)} aria-label={`Page ${p.label}`} className="h-4 w-4 accent-blue-700" />{p.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** New or changed view / department login. */
function LoginEditor({ u, taken, onClose, onSaved }) {
  const isNew = !u;
  const [f, setF] = useState(() => ({
    user: u?.user || '', display: u?.display || '', lines: (u?.lines || []).map(String), oleEdit: !!u?.oleEdit, dept: u?.dept || '',
    pages: u?.pages || [], active: u ? u.active !== false : true, pass: '', pass2: '',
  }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setErr('');
    const user = f.user.trim().toLowerCase();
    if (isNew && !/^[a-z0-9_-]{2,20}$/.test(user)) { setErr('User ID: 2–20 small letters, digits, - or _'); return; }
    if (isNew && taken.includes(user)) { setErr(`"${user}" already exists.`); return; }
    if (isNew && !f.pass) { setErr('Give a password.'); return; }
    if (f.pass !== f.pass2) { setErr('The two passwords are not the same.'); return; }
    setBusy(true);
    try {
      await api.saveUser(user, { display: f.display.trim() || user, lines: f.lines, oleEdit: f.oleEdit, dept: f.dept.trim(), pages: f.pages, active: f.active, pass: f.pass || undefined });
      onSaved(`${isNew ? 'Login made' : 'Saved'}: "${user}" — ${linesText(f.lines)}${f.oleEdit ? ', fills OLE' : ''}${f.dept.trim() ? `, RCA of ${f.dept.trim()}` : ''}${f.pages.length ? `, ${f.pages.length} pages` : ''}${f.active ? '' : ' (switched off)'}.`);
    } catch (x) { setErr(`Could not save: ${x.message}`); setBusy(false); }
  };
  const row = 'grid gap-1 text-fs-13 font-bold text-slate-600';
  return (
    <Modal title={isNew ? 'New login' : `Edit login ${u.user}`} onClose={onClose} wide>
      <div className="grid gap-3">
        {isNew && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ready-made logins">
            {PRESETS.filter((p) => !taken.includes(p.user)).map((p) => (
              <button key={p.user} type="button" onClick={() => setF((x) => ({ ...x, user: p.user, display: p.display, lines: p.lines, oleEdit: p.oleEdit, dept: p.dept || '', pages: p.pages || [] }))} className="h-8 rounded-full border border-blue-300 bg-blue-50 px-3 text-fs-13 font-bold text-blue-800 hover:bg-blue-100">{p.label}</button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={row}>User ID<input className={inp} aria-label="User ID of the login" value={f.user} disabled={!isNew} onChange={(e) => set('user', e.target.value)} placeholder="e.g. line12" autoComplete="off" autoCapitalize="none" /></label>
          <label className={row}>Name shown<input className={inp} aria-label="Name shown" value={f.display} onChange={(e) => set('display', e.target.value)} placeholder="e.g. Line 1 & 2" maxLength={40} /></label>
        </div>
        <div className={row}>Lines it sees<LinePick value={f.lines} onChange={(v) => set('lines', v)} label="Lines of the login" /></div>
        <OleEditBox value={f.oleEdit} onChange={(v) => set('oleEdit', v)} label="Login can fill OLE entries" />
        <DeptInput value={f.dept} onChange={(v) => set('dept', v)} label="Department of the login" />
        <div className={row}>Pages it opens<PagePick value={f.pages} onChange={(v) => set('pages', v)} /></div>
        <label className="flex items-center gap-2 text-fs-13 font-semibold text-slate-700"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} aria-label="Login is switched on" className="h-4 w-4 accent-blue-700" /> Switched on (can log in)</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={row}>{isNew ? 'Password' : 'New password (empty = keep)'}<input type="password" className={inp} aria-label="Password of the login" value={f.pass} onChange={(e) => set('pass', e.target.value)} placeholder="8+ characters, letters and digits" autoComplete="new-password" /></label>
          <label className={row}>Repeat password<input type="password" className={inp} aria-label="Repeat password of the login" value={f.pass2} onChange={(e) => set('pass2', e.target.value)} autoComplete="new-password" /></label>
        </div>
        {err && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-4 text-fs-14 font-bold text-slate-700">Cancel</button>
          <button type="button" disabled={busy} onClick={save} className="h-10 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white disabled:opacity-60">{busy ? 'Saving…' : isNew ? 'Create login' : 'Save login'}</button>
        </div>
      </div>
    </Modal>
  );
}

/** New TV login (or a new password for one). */
function TvEditor({ onClose, onSaved }) {
  const [f, setF] = useState({ user: 'tv', pass: '', pass2: '' });
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    if (f.pass !== f.pass2) { setErr('The two passwords are not the same.'); return; }
    try { const j = await api.tvUser(f.user.trim().toLowerCase(), f.pass); onSaved(`TV login "${j.user}" is ready — log each TV in with it once (user ID + password); the TV keeps it for 7 days.`); }
    catch (x) { setErr(`Could not save: ${x.message}`); }
  };
  return (
    <Modal title="TV screen login" onClose={onClose}>
      <div className="grid gap-3">
        
        <input className={inp} aria-label="TV login name" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder="e.g. tv-line3" autoComplete="off" />
        <input type="password" className={inp} aria-label="TV password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} placeholder="Password" autoComplete="new-password" />
        <input type="password" className={inp} aria-label="Repeat TV password" value={f.pass2} onChange={(e) => setF({ ...f, pass2: e.target.value })} placeholder="Repeat password" autoComplete="new-password" />
        {err && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-fs-13 font-semibold text-red-800">{err}</div>}
        <button type="button" disabled={!f.user || !f.pass} onClick={save} className="h-10 rounded-lg bg-sky-700 text-fs-14 font-bold text-white disabled:opacity-50">Create / reset TV login</button>
      </div>
    </Modal>
  );
}

export default function UserManager({ onActivity = null }) {
  const me = useAuth();
  const [users, setUsers] = useState(null);
  const [enforce, setEnforce] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);     // {u} or {new:true}
  const [tv, setTv] = useState(false);
  const [pw, setPw] = useState(null);
  const [del, setDel] = useState(null);
  const load = () => api.users().then((j) => { setUsers(j.users || []); setEnforce(j.enforce); setErr(''); }).catch((x) => setErr(x.message));
  useEffect(() => { load(); }, []);
  const done = (text) => { setEdit(null); setTv(false); setMsg(text); load(); };
  const counts = useMemo(() => {
    const c = { all: 0, admin: 0, sup: 0, view: 0, dept: 0, tv: 0, off: 0 };   // 27-11-2026: sup was missing (NaN)
    for (const u of users || []) { c.all++; c[KIND(u)]++; if (u.active === false) c.off++; }
    return c;
  }, [users]);
  const shown = (users || []).filter((u) => (filter === 'all' || (filter === 'off' ? u.active === false : KIND(u) === filter))
    && (!q || `${u.user} ${u.display} ${u.dept}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = async (u) => { setMsg(''); try { await api.setActive(u.user, u.active === false); setMsg(`"${u.user}" switched ${u.active === false ? 'on' : 'off'}.`); load(); } catch (x) { setMsg(`Not changed: ${x.message}`); } };
  const remove = async (u) => {
    setMsg('');
    try { if (u.role === 'tv') await api.tvRemove(u.user); else await api.removeUser(u.user); setDel(null); setMsg(`Login "${u.user}" removed.`); load(); }
    catch (x) { setMsg(`Not removed: ${x.message}`); }
  };
  const protect = async () => {
    try { const j = await api.setEnforce(!enforce); setEnforce(j.enforce); setMsg(j.enforce ? 'Server protection is on: nobody can read data without logging in.' : 'Server protection is off.'); }
    catch (x) { setMsg(`Not changed: ${x.message}`); }
  };
  const pagesText = (u) => (u.role !== 'management' ? '—' : u.pages?.length ? u.pages.map((id) => MGMT_CATALOG.find((p) => p.id === id)?.label || id) : 'Management view');

  return (
    <div className="flex flex-col gap-3" aria-label="Users and logins">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h3 className="flex items-center gap-2 text-fs-18 font-bold text-slate-900"><Users size={18} aria-hidden /> Users &amp; logins</h3>
            
          </div>
          <button type="button" onClick={() => setEdit({ new: true })} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-fs-14 font-bold text-white hover:bg-blue-800"><UserPlus size={16} aria-hidden /> Add login</button>
          <button type="button" onClick={() => setTv(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-sky-600 bg-white px-3 text-fs-14 font-bold text-sky-800 hover:bg-sky-50"><Tv size={16} aria-hidden /> Add TV login</button>
        </div>
        <div className={`mt-3 flex flex-wrap items-center gap-3 rounded-xl border p-3 ${enforce ? 'border-sky-300 bg-sky-50' : 'border-slate-300 bg-slate-50'}`}>
          {enforce ? <ShieldCheck size={20} className="text-sky-700" aria-hidden /> : <ShieldAlert size={20} className="text-slate-700" aria-hidden />}
          <div className="min-w-0 flex-1 text-fs-13"><b>Server protection: {enforce == null ? '…' : enforce ? 'ON' : 'OFF'}</b> — {enforce ? 'every data request needs a login; line and department limits are fully enforced. It always stays on (Setup → Security for blocked PCs and logins locked to their PCs).' : 'turn it on once every screen runs the new build; until then a screen without login still gets data.'}</div>
          {/* 25-11-2026: protection is always on (the server never gives data without a login) — it can only be switched on */}
          {!enforce && <button type="button" onClick={protect} disabled={enforce == null} aria-label="Server protection" className="rounded-lg bg-sky-700 px-3 py-1.5 text-fs-13 font-bold text-white">Turn on</button>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Show">
            {FILTERS.map(([k, t]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`h-9 px-3 text-fs-13 font-semibold border-r last:border-r-0 border-slate-300 ${filter === k ? 'bg-blue-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{t} <span className="opacity-70">({counts[k]})</span></button>)}
          </div>
          <label className="relative ml-auto"><Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden /><input className="h-9 w-56 rounded-lg border border-slate-300 pl-8 pr-2 text-fs-14" placeholder="Search login" aria-label="Search login" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        {msg && <p role="status" className={`mt-2 text-fs-13 font-bold ${msg.startsWith('Not') ? 'text-red-700' : 'text-sky-700'}`}>{msg}</p>}
        {err && <p role="alert" className="mt-2 text-fs-13 font-bold text-red-700">{err}</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-2 sm:p-3 overflow-x-auto">
        {!users ? <p className="p-3 text-fs-14 text-slate-500">Reading the logins …</p> : (
          <table className="w-full text-fs-13" aria-label="Logins">
            <thead><tr className="border-b-2 border-slate-300 text-left text-fs-12 text-slate-600">{['Login', 'Kind', 'Lines', 'Fills OLE', 'RCA department', 'Pages', 'Status', 'Last login', ''].map((h, i) => <th key={i} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((u) => {
                const k = KIND(u); const self = u.user === me?.user;
                return (
                  <tr key={u.user} className={`border-b border-slate-100 align-top ${u.active === false ? 'opacity-60' : ''}`} aria-label={`Login ${u.user}`}>
                    <td className="px-2 py-2"><div className="flex items-center gap-2">{k === 'tv' ? <Tv size={15} /> : k === 'dept' ? <Building2 size={15} /> : k === 'admin' ? <ShieldCheck size={15} /> : <User size={15} />}<b className="text-slate-900">{u.user}</b>{self && <span className="text-fs-12 font-bold text-blue-700">you</span>}</div><div className="text-fs-12 text-slate-500">{u.display}</div></td>
                    <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-fs-12 font-bold whitespace-nowrap ${KIND_CLS[k]}`}>{KIND_TEXT[k]}</span></td>
                    <td className="px-2 py-2 whitespace-nowrap">{u.role === 'management' ? linesText(u.lines) : 'All lines'}</td>
                    <td className="px-2 py-2">{u.role === 'admin' ? 'Yes' : u.oleEdit ? 'Yes' : '—'}</td>
                    <td className="px-2 py-2">{u.role === 'admin' ? 'All' : u.dept || '—'}</td>
                    <td className="px-2 py-2 text-fs-13 text-slate-600" style={{ minWidth: 220, maxWidth: 360 }}>{u.role === 'admin' ? 'All' : u.role === 'tv' ? 'Live line screen' : <PagesCell names={pagesText(u)} />}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{u.active === false ? <span className="font-bold text-slate-500">Switched off</span> : <span className="font-bold text-sky-700">Active</span>}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-fs-12 text-slate-600">{u.lastLogin ? fmtDateTime(u.lastLogin) : '—'}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-nowrap justify-end gap-1 whitespace-nowrap">
                        {u.role === 'management' && <button type="button" className={btn} onClick={() => setEdit({ u })} aria-label={`Edit ${u.user}`}><Pencil size={13} /> Edit</button>}
                        {onActivity && u.role !== 'tv' && <button type="button" className={ico} onClick={() => onActivity(u.user)} aria-label={`Activity of ${u.user}`} title="Activity — logins and changes"><History size={15} /></button>}
                        <button type="button" className={ico} onClick={() => setPw(u)} aria-label={`Password ${u.user}`} title="Change password"><KeyRound size={15} /></button>
                        {u.role !== 'admin' && <button type="button" className={ico} onClick={() => toggle(u)} aria-label={`${u.active === false ? 'Switch on' : 'Switch off'} ${u.user}`} title={u.active === false ? 'Switch on' : 'Switch off'}><Power size={15} className={u.active === false ? 'text-slate-400' : 'text-emerald-700'} /></button>}
                        {u.role !== 'admin' && (del === u.user
                          ? <span className="inline-flex items-center gap-1"><button type="button" onClick={() => remove(u)} className="h-8 rounded-lg bg-red-700 px-2.5 text-fs-13 font-bold text-white">Yes, remove</button><button type="button" onClick={() => setDel(null)} className={btn}>No</button></span>
                          : <button type="button" className={`${ico} text-red-700 hover:bg-red-50`} onClick={() => setDel(u.user)} aria-label={`Remove ${u.user}`} title="Remove login"><Trash2 size={15} /></button>)}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={9} className="px-2 py-4 text-slate-500">No login here.</td></tr>}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 text-fs-13 text-slate-700" aria-label="Kinds of login">
        <b>Kinds of login</b>
        <ul className="mt-1 grid gap-1 sm:grid-cols-2">
          <li><span className={`mr-1 rounded-full px-2 py-0.5 text-fs-12 font-bold ${KIND_CLS.admin}`}>Admin</span> every page and setting.</li>
          <li><span className={`mr-1 rounded-full px-2 py-0.5 text-fs-12 font-bold ${KIND_CLS.sup}`}>Supervisor</span> its lines: morning entry (manpower, start, lunch, tea, close), loss entry, RCA and live lines.</li>
          <li><span className={`mr-1 rounded-full px-2 py-0.5 text-fs-12 font-bold ${KIND_CLS.view}`}>View</span> management or a line team: only its lines, read only; can be allowed to fill the OLE entries.</li>
          <li><span className={`mr-1 rounded-full px-2 py-0.5 text-fs-12 font-bold ${KIND_CLS.dept}`}>Department</span> a view login with a department: writes and submits the RCA of that department.</li>
          <li><span className={`mr-1 rounded-full px-2 py-0.5 text-fs-12 font-bold ${KIND_CLS.tv}`}>TV screen</span> only the live line screen; the TV logs in with it (no screen opens without a login).</li>
        </ul>
      </section>

      {edit && <LoginEditor u={edit.u} taken={(users || []).map((u) => u.user)} onClose={() => setEdit(null)} onSaved={done} />}
      {tv && <TvEditor onClose={() => setTv(false)} onSaved={done} />}
      {pw && <Modal title={`Password of ${pw.user}`} onClose={() => setPw(null)}><PasswordForm user={pw.user} self={pw.user === me?.user} onDone={() => { setPw(null); setMsg(`Password of "${pw.user}" changed.`); }} /></Modal>}
    </div>
  );
}
