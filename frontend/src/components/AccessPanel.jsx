import React, { useEffect, useMemo, useState } from 'react';
import { Printer, Save, KeyRound, ToggleLeft, CheckSquare, Square } from 'lucide-react';
import { api } from '../api';
import { mgmtPages, adminPages, reportsAllowed, ENTRY_METHODS, normalizeEntry } from '../utils/uiSettings';
import { PAGES, SETUP_PAGE } from './Sidebar';
import { REPORTS } from '../utils/reportDefs';

/**
 * Setup → Access & entry (25-11-2026, admin):
 *  1. the ways of filling an hour (Loss / Quality entry) switched on or off for everybody
 *  2. who may open what: for the logins ticked — role, lines, pages (fill or only see), reports, RCA department,
 *     the PCs a login is locked to, last login — and one click prints it (or saves it as PDF from the print window)
 */
const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-fs-13 font-bold';
const ENTRY_PAGES = new Set(['daily', 'oleentry', 'qentry', 'lqentry', 'kpientry']);
const ROLE = { admin: 'Admin (everything)', management: 'Management / line login', tv: 'TV screen' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dmyt = (s) => (s ? `${String(s).slice(8, 10)}-${String(s).slice(5, 7)}-${String(s).slice(0, 4)} ${String(s).slice(11, 16)}` : '—');

/** what one login may open (as App.jsx builds its menu) */
export function accessOf(u, ui, locks = {}) {
  const role = u.role;
  const lines = Array.isArray(u.lines) && u.lines.length ? u.lines.map((l) => `Line ${l}`).join(', ') : 'All lines';
  let pages = []; let linePages = [];
  if (role === 'admin') pages = adminPages(ui, PAGES, SETUP_PAGE).map((p) => ({ id: p.id, label: p.label, can: ENTRY_PAGES.has(p.id) || p.id === 'rca' || p.id === 'setup' ? 'Fill / change' : 'See' }));
  else if (role === 'tv') pages = [{ id: 'live', label: 'Live lines (TV animation)', can: 'See' }];
  else {
    const own = Array.isArray(u.pages) && u.pages.length ? u.pages : null;
    const base = own ? mgmtPages({ ...ui, management: { ...ui.management, pages: ui.management.pages.map((p) => ({ ...p, on: own.includes(p.id) })) } }) : mgmtPages(ui);
    pages = base.map((p) => ({ id: p.id, label: p.label, can: ENTRY_PAGES.has(p.id) ? (u.oleEdit ? 'Fill' : 'See only') : p.id === 'rca' ? (u.dept ? `Write RCA of ${u.dept}` : 'See only') : 'See' }));
    linePages = adminPages(ui, PAGES, SETUP_PAGE).filter((p) => p.id !== 'setup').map((p) => p.label);
  }
  const seesReports = role === 'admin' || pages.some((p) => p.id === 'reports');
  const allowed = reportsAllowed(ui, u.user, role === 'admin');
  const reports = !seesReports ? [] : REPORTS.filter((r) => !allowed || allowed.includes(r.id)).map((r) => r.name);
  return {
    user: u.user, name: u.display || u.user, role: ROLE[role] || role, active: u.active !== false, lines, pages, linePages, reports,
    fill: role === 'admin' ? 'Yes (all lines)' : role === 'tv' ? 'No' : u.oleEdit ? `Yes (${lines})` : 'No (read only)',
    dept: u.dept || '—', lock: (locks[u.user] || []).join(', ') || 'Any PC', last: u.lastLogin || null,
  };
}

function printAccess(list, by) {
  const now = new Date();
  const when = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const block = (a) => `
    <section>
      <h2>${esc(a.name)} <small>(${esc(a.user)})</small>${a.active ? '' : ' <span class="off">SWITCHED OFF</span>'}</h2>
      <table class="kv">
        <tr><th>Role</th><td>${esc(a.role)}</td><th>Lines</th><td>${esc(a.lines)}</td></tr>
        <tr><th>Fills entries</th><td>${esc(a.fill)}</td><th>RCA department</th><td>${esc(a.dept)}</td></tr>
        <tr><th>Works on PC</th><td>${esc(a.lock)}</td><th>Last login</th><td>${esc(dmyt(a.last))}</td></tr>
      </table>
      <h3>Pages (${a.pages.length})</h3>
      <table class="list"><tr><th>#</th><th>Page</th><th>Access</th></tr>${a.pages.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.label)}</td><td>${esc(p.can)}</td></tr>`).join('')}</table>
      ${a.reports.length ? `<h3>Reports it can download (${a.reports.length})</h3><p>${a.reports.map(esc).join(' · ')}</p>` : '<h3>Reports</h3><p>None</p>'}
      ${a.linePages.length ? `<h3>Line dashboards (Line 1–4 at the top, read only)</h3><p>${a.linePages.map(esc).join(' · ')}</p>` : ''}
    </section>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Line Pulse — access of logins</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:18px;font-size:12px}
    h1{font-size:18px;margin:0 0 2px;color:#1F3864} .sub{color:#475569;margin-bottom:12px}
    section{border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;margin:0 0 12px;page-break-inside:avoid}
    h2{font-size:15px;margin:0 0 6px;color:#1F3864} h2 small{color:#64748b;font-weight:normal} .off{background:#dc2626;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px}
    h3{font-size:12px;margin:8px 0 3px;color:#1F3864;text-transform:uppercase} p{margin:0;line-height:1.5}
    table{border-collapse:collapse;width:100%} .kv th{text-align:left;background:#f1f5f9;width:16%;padding:3px 6px;border:1px solid #e2e8f0} .kv td{padding:3px 6px;border:1px solid #e2e8f0}
    .list th{background:#DCE6F2;text-align:left;padding:3px 6px;border:1px solid #cbd5e1} .list td{padding:2px 6px;border:1px solid #e2e8f0}
    @media print{body{margin:8mm}}
  </style></head><body><h1>Line Pulse — who may open what</h1><div class="sub">${list.length} login${list.length > 1 ? 's' : ''} · printed ${when}${by ? ` by ${esc(by)}` : ''}</div>${list.map(block).join('')}</body></html>`;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  w.focus(); setTimeout(() => { try { w.print(); } catch { /* the window stays for the user */ } }, 300);
  return true;
}

export default function AccessPanel({ ui, save, me }) {
  const [users, setUsers] = useState(null);
  const [locks, setLocks] = useState({});
  const [pick, setPick] = useState(() => new Set());
  const [em, setEm] = useState(() => normalizeEntry(ui.entry));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.users().then((j) => { setUsers(j.users || []); setPick(new Set((j.users || []).map((u) => u.user))); }).catch((x) => setErr(x.message));
    api.security().then((s) => setLocks(Array.isArray(s.conf?.lock) ? {} : s.conf?.lock || {})).catch(() => {});
  }, []);
  useEffect(() => { setEm(normalizeEntry(ui.entry)); }, [ui.entry]);
  const list = useMemo(() => (users || []).map((u) => accessOf(u, ui, locks)), [users, ui, locks]);
  const chosen = list.filter((a) => pick.has(a.user));
  const dirty = JSON.stringify(em) !== JSON.stringify(normalizeEntry(ui.entry));
  const saveEm = async () => {
    setBusy(true); setMsg(''); setErr('');
    try { await save({ ...ui, entry: em }, 'save'); setMsg('Entry methods saved — every entry screen follows at its next reading.'); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const toggle = (u) => setPick((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
  return (
    <div className="flex flex-col gap-3" data-testid="access-panel">
      <section className={card} aria-label="Entry methods">
        <h2 className="flex items-center gap-2 text-fs-17 font-extrabold text-slate-900" style={{ margin: 0 }}><ToggleLeft size={20} className="text-[#1F3864]" aria-hidden /> Entry methods · Loss & Quality entry</h2>
        <p className="mt-0.5 text-fs-13 text-slate-600">Switch a way of filling the hour off for everybody. The hour form itself always stays.</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {ENTRY_METHODS.map(([k, label, about]) => (
            <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${em[k] ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
              <input type="checkbox" data-testid={`em-${k}`} checked={em[k]} onChange={(e) => setEm((x) => ({ ...x, [k]: e.target.checked }))} className="mt-0.5 h-4 w-4" />
              <span><b className="text-fs-14 text-slate-900">{label}</b> <span className={`ml-1 rounded px-1.5 py-0.5 text-fs-11 font-bold ${em[k] ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-700'}`}>{em[k] ? 'ON' : 'OFF'}</span><br /><span className="text-fs-12 text-slate-600">{about}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" data-testid="em-save" disabled={!dirty || busy} onClick={saveEm} className={`${btn} border-[#1F3864] bg-[#1F3864] text-white hover:bg-blue-900 disabled:opacity-50`}><Save size={14} aria-hidden /> Save entry methods</button>
          {msg && <span role="status" className="text-fs-13 font-bold text-emerald-700">{msg}</span>}
          {err && <span role="alert" className="text-fs-13 font-bold text-red-700">{err}</span>}
        </div>
      </section>

      <section className={card} aria-label="Access of logins">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-fs-17 font-extrabold text-slate-900" style={{ margin: 0 }}><KeyRound size={20} className="text-[#1F3864]" aria-hidden /> Who may open what</h2>
          <span className="text-fs-13 text-slate-600">tick the logins, then print (or save as PDF from the print window)</span>
          <button type="button" data-testid="access-print" disabled={!chosen.length} onClick={() => { if (!printAccess(chosen, me?.display || me?.user)) setErr('The print window was blocked by the browser — allow pop-ups for Line Pulse.'); }}
            className={`${btn} ml-auto border-[#1F3864] bg-[#1F3864] text-white hover:bg-blue-900 disabled:opacity-50`}><Printer size={15} aria-hidden /> Print {chosen.length} login{chosen.length === 1 ? '' : 's'}</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setPick(new Set(list.map((a) => a.user)))} className={`${btn} h-8 border-slate-300 bg-white text-slate-700`}><CheckSquare size={14} aria-hidden /> All</button>
          <button type="button" onClick={() => setPick(new Set())} className={`${btn} h-8 border-slate-300 bg-white text-slate-700`}><Square size={14} aria-hidden /> None</button>
          {list.map((a) => (
            <button key={a.user} type="button" aria-pressed={pick.has(a.user)} onClick={() => toggle(a.user)}
              className={`rounded-full border px-2.5 py-1 text-fs-12 font-bold ${pick.has(a.user) ? 'border-[#1F3864] bg-[#1F3864] text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{a.name}{a.name !== a.user ? ` (${a.user})` : ''}</button>
          ))}
        </div>
        {!users && !err && <p className="mt-3 text-fs-13 text-slate-600">Reading the logins…</p>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-fs-12" data-testid="access-table">
            <thead><tr className="bg-[#DCE6F2] text-left text-[#1F3864]"><th className="px-2 py-1.5">Login</th><th className="px-2 py-1.5">Role</th><th className="px-2 py-1.5">Lines</th><th className="px-2 py-1.5">Fills entries</th><th className="px-2 py-1.5">RCA dept</th><th className="px-2 py-1.5">Works on PC</th><th className="px-2 py-1.5">Pages</th><th className="px-2 py-1.5">Reports</th><th className="px-2 py-1.5">Last login</th></tr></thead>
            <tbody>
              {chosen.map((a) => (
                <tr key={a.user} className={`border-b border-slate-100 align-top ${a.active ? '' : 'opacity-60'}`}>
                  <td className="px-2 py-1.5"><b>{a.name}</b><div className="text-slate-500">{a.user}{a.active ? '' : ' · off'}</div></td>
                  <td className="px-2 py-1.5">{a.role}</td>
                  <td className="px-2 py-1.5">{a.lines}</td>
                  <td className="px-2 py-1.5">{a.fill}</td>
                  <td className="px-2 py-1.5">{a.dept}</td>
                  <td className="px-2 py-1.5 font-mono">{a.lock}</td>
                  <td className="px-2 py-1.5" style={{ minWidth: 260 }}>{a.pages.map((p) => <span key={p.id} className={`mb-0.5 mr-1 inline-block rounded px-1.5 py-0.5 ${p.can.startsWith('Fill') || p.can.startsWith('Write') ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`} title={p.can}>{p.label}{p.can !== 'See' ? ` · ${p.can}` : ''}</span>)}</td>
                  <td className="px-2 py-1.5" style={{ minWidth: 160 }}>{a.reports.length ? a.reports.length === REPORTS.length ? `All ${a.reports.length}` : a.reports.join(' · ') : 'None'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono">{dmyt(a.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
