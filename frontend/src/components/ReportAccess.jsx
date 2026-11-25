import React, { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { api } from '../api';

/**
 * 23-11-2026: the admin chooses which reports every login sees on the Reports page.
 * A login left on "All reports" is not stored (it sees every report, also the ones added later);
 * a login with ticks sees only those. Kept in the screen setup (ui_settings.json → reports.access).
 */
const card = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm';
const ROLE = { management: 'Management', line: 'Line', dept: 'Department', viewer: 'Viewer' };

export default function ReportAccess({ ui, save, reports }) {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [acc, setAcc] = useState(() => ({ ...(ui.reports?.access || {}) }));
  useEffect(() => { api.users().then((j) => setUsers((j.users || []).filter((u) => u.role !== 'admin' && u.role !== 'tv'))).catch((x) => setErr(x.message)); }, []);
  const dirty = useMemo(() => JSON.stringify(acc) !== JSON.stringify(ui.reports?.access || {}), [acc, ui.reports]);
  const key = (u) => String(u.user).toLowerCase();
  const setAll = (u, all) => setAcc((a) => { const n = { ...a }; if (all) delete n[key(u)]; else n[key(u)] = []; return n; });
  const flip = (u, id) => setAcc((a) => {
    const cur = a[key(u)] ?? reports.map((r) => r.id);   // from "all": every box ticked, then the one changed
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const n = { ...a };
    if (reports.every((r) => next.includes(r.id))) delete n[key(u)]; else n[key(u)] = reports.map((r) => r.id).filter((x) => next.includes(x));
    return n;
  });
  const doSave = async () => {
    setBusy(true); setMsg('');
    try { await save({ ...ui, reports: { access: acc } }); setMsg('Saved — each login sees its reports the next time the Reports page opens.'); }
    catch (x) { setMsg(`Could not save: ${x.message}`); } finally { setBusy(false); }
  };
  return (
    <section className={card} aria-label="Who sees which report">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-fs-16 font-extrabold text-dixon-navy">Who sees which report</h3>
        <span className="text-fs-12 text-slate-600">"All reports" = every report, also new ones. The administrator always sees all.</span>
        <button type="button" disabled={!dirty || busy} onClick={() => setAcc({ ...(ui.reports?.access || {}) })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw size={14} aria-hidden />Undo</button>
        <button type="button" disabled={!dirty || busy} onClick={doSave} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3 text-fs-13 font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save size={14} aria-hidden />{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {msg && <p role="status" className={`mt-2 text-fs-13 font-semibold ${msg.startsWith('Not') ? 'text-red-700' : 'text-emerald-700'}`}>{msg}</p>}
      {err && <p role="alert" className="mt-2 text-fs-13 font-semibold text-red-700">Logins could not be read: {err}</p>}
      {!users && !err && <p className="mt-3 text-fs-13 text-slate-500">Reading the logins…</p>}
      {users && !users.length && <p className="mt-3 text-fs-13 text-slate-500">No login besides the administrator yet (Setup → Users &amp; logins).</p>}
      {users && users.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-fs-13" aria-label="Reports per login">
            <thead>
              <tr className="bg-slate-50 text-left text-fs-12 text-slate-700">
                <th className="border border-slate-200 px-2 py-1.5" style={{ position: 'sticky', left: 0, background: '#F8FAFC', minWidth: 160 }}>Login</th>
                <th className="border border-slate-200 px-2 py-1.5 text-center">All reports</th>
                {reports.map((r) => <th key={r.id} className="border border-slate-200 px-1.5 py-1.5 text-center align-bottom font-bold" style={{ minWidth: 92, maxWidth: 120 }} title={r.about}>{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const own = acc[key(u)]; const all = !own;
                return (
                  <tr key={u.user} className="hover:bg-blue-50/40">
                    <td className="border border-slate-200 px-2 py-1" style={{ position: 'sticky', left: 0, background: '#fff' }}>
                      <b>{u.display || u.user}</b> <span className="text-fs-11 text-slate-500">{u.user}{ROLE[u.role] ? ` · ${ROLE[u.role]}` : ''}{u.active === false ? ' · off' : ''}</span>
                    </td>
                    <td className="border border-slate-200 text-center">
                      <input type="checkbox" checked={all} onChange={(e) => setAll(u, e.target.checked)} aria-label={`${u.user}: all reports`} className="h-4 w-4 accent-blue-700" />
                    </td>
                    {reports.map((r) => (
                      <td key={r.id} className={`border border-slate-200 text-center ${all ? 'bg-slate-50' : ''}`}>
                        <input type="checkbox" checked={all || own.includes(r.id)} onChange={() => flip(u, r.id)} aria-label={`${u.user}: ${r.name}`} className="h-4 w-4 accent-blue-700" />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
