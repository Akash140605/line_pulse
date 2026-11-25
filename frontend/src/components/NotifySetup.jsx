import React, { useEffect, useState } from 'react';
import { Bell, MessageSquare } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { NOTIFY_GROUPS, NOTIFY_RULES, WELCOME_DEFAULT } from '../utils/notifyConfig';
import { welcomeText } from '../utils/notify';

/**
 * 23-11-2026: Setup → Notifications (administrator). For every alert: on / off, its limit, the groups and single logins
 * that receive it and the lines it covers; and the welcome message shown after login. Saved with the Setup "Save" button.
 */
const chip = (on) => `rounded-[3px] border px-2 py-0.5 text-fs-12 font-bold ${on ? 'border-[#1F4E79] bg-[#1F4E79] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`;

/** a number typed freely, kept within its limits when the field is left (or Enter) */
function NumField({ value, min, max, label, onCommit }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => { const n = Number(v); onCommit(Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : value); };
  return <input type="number" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} aria-label={label} className="h-8 w-20 rounded-md border border-slate-300 px-2 text-right font-mono text-fs-14 font-bold" />;
}

export default function NotifySetup({ ui, set }) {
  const n = ui.notify; const w = ui.welcome;
  const [users, setUsers] = useState([]);
  useEffect(() => { api.users().then((j) => setUsers((j.users || []).filter((u) => u.role !== 'tv'))).catch(() => {}); }, []);
  const edit = (id, fn) => set((u) => { const r = { ...u.notify.rules[id] }; fn(r); u.notify = { ...u.notify, rules: { ...u.notify.rules, [id]: r } }; return u; });
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="notify-setup">
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Bell size={18} className="text-[#1F4E79]" aria-hidden />
          <h2 className="mr-auto text-fs-16 font-bold text-slate-900">Notifications</h2>
          <label className="inline-flex items-center gap-2 text-fs-14 font-bold text-slate-800">
            <input type="checkbox" checked={n.on} onChange={(e) => set((u) => { u.notify = { ...u.notify, on: e.target.checked }; return u; })} aria-label="Notifications for all users" />
            Notifications for all users
          </label>
        </div>
        <p className="mt-1 text-fs-13 text-slate-600">Select for each alert whether it is active, its limit, which users receive it and which lines it covers. A user receives an alert when their group or their login is selected, and only for the lines assigned to that login. Click <b>Save</b> at the top to apply the changes.</p>
        <div className={`mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 ${n.on ? '' : 'opacity-60'}`}>
          {NOTIFY_RULES.map((r) => {
            const c = n.rules[r.id];
            return (
              <div key={r.id} className={`px-3 py-3 ${c.on ? '' : 'bg-slate-50'}`} data-testid={`rule-${r.id}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <label className="flex min-w-0 flex-1 items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={c.on} onChange={(e) => edit(r.id, (x) => { x.on = e.target.checked; })} aria-label={`${r.label} active`} />
                    <span className="min-w-0">
                      <span className="block text-fs-15 font-bold text-slate-900">{r.label}</span>
                      <span className="block text-fs-12 text-slate-600">{r.about}</span>
                    </span>
                  </label>
                  {r.param && (
                    <label className="flex shrink-0 items-center gap-1.5 text-fs-13 font-semibold text-slate-700">
                      {r.param.label}
                      {r.param.kind === 'time'
                        ? <input type="time" value={c[r.param.key]} onChange={(e) => edit(r.id, (x) => { x[r.param.key] = e.target.value; })} aria-label={`${r.label}: ${r.param.label}`} className="h-8 rounded-md border border-slate-300 px-2 font-mono text-fs-14 font-bold" />
                        : <NumField value={c[r.param.key]} min={r.param.min} max={r.param.max} label={`${r.label}: ${r.param.label}`} onCommit={(v) => edit(r.id, (x) => { x[r.param.key] = v; })} />}
                      <span className="text-fs-12 font-normal text-slate-500">{r.param.unit}</span>
                    </label>
                  )}
                </div>
                {c.on && (
                  <div className="mt-2 grid gap-1.5 text-fs-12" style={{ paddingLeft: 24 }}>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${r.label}: groups`}>
                      <span className="w-16 font-bold text-slate-500">Groups</span>
                      {NOTIFY_GROUPS.map(([g, l]) => <button key={g} type="button" aria-pressed={c.to.includes(g)} onClick={() => edit(r.id, (x) => { x.to = toggleIn(x.to, g); })} className={chip(c.to.includes(g))}>{l}</button>)}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${r.label}: lines`}>
                      <span className="w-16 font-bold text-slate-500">Lines</span>
                      <button type="button" aria-pressed={!c.lines.length} onClick={() => edit(r.id, (x) => { x.lines = []; })} className={chip(!c.lines.length)}>All lines</button>
                      {LINE_IDS.map(String).map((l) => <button key={l} type="button" aria-pressed={c.lines.includes(l)} onClick={() => edit(r.id, (x) => { x.lines = toggleIn(x.lines, l).sort(); })} className={chip(c.lines.includes(l))}>Line {l}</button>)}
                    </div>
                    {users.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${r.label}: also these logins`}>
                        <span className="w-16 font-bold text-slate-500">Also</span>
                        {users.map((u) => { const id = String(u.user).toLowerCase(); return <button key={id} type="button" aria-pressed={c.users.includes(id)} title={u.display || u.user} onClick={() => edit(r.id, (x) => { x.users = toggleIn(x.users, id); })} className={chip(c.users.includes(id))}>{u.display || u.user}</button>; })}
                      </div>
                    )}
                    {!c.to.length && !c.users.length && <span className="font-semibold text-amber-800">No user receives this alert. Please select a group or a login.</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm" data-testid="welcome-setup">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-[#1F4E79]" aria-hidden />
          <h2 className="mr-auto text-fs-16 font-bold text-slate-900">Welcome message</h2>
          <label className="inline-flex items-center gap-2 text-fs-13 font-bold text-slate-800">
            <input type="checkbox" checked={w.on} onChange={(e) => set((u) => { u.welcome = { ...u.welcome, on: e.target.checked }; return u; })} aria-label="Show the welcome message" /> Show
          </label>
        </div>
        <p className="mt-1 text-fs-12 text-slate-600">Shown once after each login. <code>{'{greeting}'}</code> becomes Good morning / afternoon / evening, <code>{'{name}'}</code> the user's name and <code>{'{role}'}</code> the user's group.</p>
        <label className="mt-3 block text-fs-12 font-bold text-slate-700">Heading
          <input value={w.title} maxLength={80} onChange={(e) => set((u) => { u.welcome = { ...u.welcome, title: e.target.value }; return u; })} className="mt-1 block h-9 w-full rounded-md border border-slate-300 px-2 text-fs-14" aria-label="Welcome heading" />
        </label>
        <label className="mt-2 block text-fs-12 font-bold text-slate-700">Message
          <textarea value={w.text} maxLength={240} rows={3} onChange={(e) => set((u) => { u.welcome = { ...u.welcome, text: e.target.value }; return u; })} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-fs-14" aria-label="Welcome message" />
        </label>
        <button type="button" onClick={() => set((u) => { u.welcome = { ...WELCOME_DEFAULT }; return u; })} className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-fs-12 font-bold text-slate-700 hover:bg-slate-50">Standard text</button>
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="text-fs-11 font-bold uppercase tracking-wide text-slate-500">Preview</div>
          <div className="mt-1 text-fs-15 font-bold text-[#1F3864]">{welcomeText(w.title, { name: 'Akash Gupta', hour: 10, role: 'Supervisor' })}</div>
          <p className="text-fs-13 text-slate-700">{welcomeText(w.text, { name: 'Akash Gupta', hour: 10, role: 'Supervisor' })}</p>
        </div>
      </section>
    </div>
  );
}
