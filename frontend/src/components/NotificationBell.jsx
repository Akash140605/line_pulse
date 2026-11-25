import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, Settings2, X, AlertTriangle, Clock3, Info } from 'lucide-react';
import { api, LINE_IDS } from '../api';
import { useAuth } from './AuthGate';
import { savedUi, UI_EVENT } from '../hooks/useUiSettings';
import { useAllLineSettings } from '../hooks/useLineSettings';
import useAutoTargets from '../hooks/useAutoTargets';
import { serverNow, serverToday } from '../utils/serverTime';
import { shiftOfDay, SHIFT_PLANT } from '../utils/shift';
import { refreshMs } from '../utils/refreshConfig';
import { buildNotices, receives, welcomeText, NOTIFY_RULES, groupOf, WELCOME_DEFAULT } from '../utils/notify';

/**
 * 23-11-2026: the bell in the top bar — the alerts this login receives (Setup → Notifications), newest first,
 * with the number not yet read; a click opens the page where the alert is dealt with. Plus the welcome message
 * once per login. Nothing is written: "read" is kept in this browser only.
 */
export const OPEN_PAGE_EVENT = 'ems:open-page';
export const openPage = (page, extra = {}) => { try { window.dispatchEvent(new CustomEvent(OPEN_PAGE_EVENT, { detail: { page, ...extra } })); } catch { /* old browser */ } };
const readKey = (u) => `ems.notifyRead.${u}`;
const readSet = (u) => { try { return new Set(JSON.parse(localStorage.getItem(readKey(u)) || '[]')); } catch { return new Set(); } };
const writeSet = (u, s) => { try { localStorage.setItem(readKey(u), JSON.stringify([...s].slice(-400))); } catch { /* private window */ } };
const ROLE_TEXT = { admin: 'Administrator', sup: 'Supervisor', dept: 'Department user', view: 'Management viewer' };
const SEV = {
  high: { icon: AlertTriangle, cls: 'text-red-700 bg-red-50 border-red-200' },
  mid: { icon: Clock3, cls: 'text-amber-800 bg-amber-50 border-amber-200' },
  low: { icon: Info, cls: 'text-sky-800 bg-sky-50 border-sky-200' },
};
const clockOf = (m) => (m == null ? '' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/** the setup kept in this browser, fresh after every save / read of the settings */
function useNotifySetup() {
  const [ui, setUi] = useState(() => savedUi());
  useEffect(() => {
    const on = () => setUi(savedUi());
    window.addEventListener(UI_EVENT, on);
    const id = setInterval(on, 60_000);
    return () => { window.removeEventListener(UI_EVENT, on); clearInterval(id); };
  }, []);
  return ui;
}

function BellInner() {
  const me = useAuth();
  const ui = useNotifySetup();
  const cfg = ui.notify;
  const lines = useMemo(() => LINE_IDS.map(String), [LINE_IDS.join()]); // eslint-disable-line react-hooks/exhaustive-deps -- 25-11-2026: follows the login's lines
  const sets = useAllLineSettings(lines);
  const auto = useAutoTargets();
  const [rows, setRows] = useState(null);
  const [day, setDay] = useState(null);   // { entries, setup } of today
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(() => readSet(me?.user || ''));
  const busy = useRef(false);
  const btn = useRef(null);
  const today = serverToday();

  const mine = useMemo(() => NOTIFY_RULES.filter((r) => receives(cfg, r.id, me)).map((r) => r.id), [cfg, me]);
  const needLive = mine.some((id) => ['offline', 'noCycle', 'lowHour', 'lossPending', 'morning'].includes(id));
  const needDay = mine.some((id) => ['lossPending', 'morning', 'rejects'].includes(id));
  useEffect(() => { setRead(readSet(me?.user || '')); }, [me?.user]);
  useEffect(() => {
    if (!mine.length) return undefined;
    let alive = true;
    const load = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const [lv, dy] = await Promise.allSettled([
          needLive ? api.liveLinesParallel({ cmin: 1, cmax: 22 }) : Promise.resolve(null),
          needDay ? api.oleEntries(today, today) : Promise.resolve(null),
        ]);
        if (!alive) return;
        if (lv.status === 'fulfilled' && lv.value) setRows((lv.value.lines || []).filter((x) => x.backup || !x.day || x.day === today));
        if (dy.status === 'fulfilled' && dy.value) setDay({ entries: dy.value.entries || {}, setup: dy.value.setup || {} });
        setTick((t) => t + 1);
      } finally { busy.current = false; }
    };
    const t0 = setTimeout(load, 4000);   // after the page's own first reads
    const id = setInterval(load, Math.max(60_000, refreshMs('dash') * 3));
    return () => { alive = false; clearTimeout(t0); clearInterval(id); };
  }, [mine.join(','), needLive, needDay, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const notices = useMemo(() => {
    if (!me || !mine.length) return [];
    const now = serverNow();
    const lineSet = Object.fromEntries(lines.map((l) => [l, { targets: sets[l]?.targets || {}, shift: shiftOfDay(day?.setup || {}, today, l, sets[l]?.shift || null) || SHIFT_PLANT }]));
    // the bell must never stop the screens: unexpected data gives no alerts instead of an error
    try {
      return buildNotices({ date: today, nowMin: now.getHours() * 60 + now.getMinutes(), rows: Array.isArray(rows) ? rows : null, lineSet, entries: day?.entries && typeof day.entries === 'object' ? day.entries : null, setups: day?.setup && typeof day.setup === 'object' ? day.setup : null, cfg, me, autoReady: !!auto });
    } catch (e) { console.warn('[notifications]', e); return []; }
  }, [rows, day, sets, auto, cfg, me, mine.length, today, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const unread = notices.filter((n) => !read.has(n.id));

  const mark = (ids) => { const s = new Set(read); ids.forEach((i) => s.add(i)); setRead(s); writeSet(me.user, s); };
  const go = (n) => { mark([n.id]); setOpen(false); openPage(n.page, { line: n.line }); };
  const manage = () => { setOpen(false); try { sessionStorage.setItem('ems.setupTab', 'notify'); } catch { /* private */ } openPage('setup', { tab: 'notify' }); };
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  if (!me || me.role === 'tv') return null;
  const isAdmin = me.role === 'admin';
  if (!cfg?.on && !isAdmin) return null;
  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} title="Notifications" data-testid="notify-bell"
        style={{ width: 34, height: 34 }} className="relative grid shrink-0 place-items-center rounded-[3px] border border-white/25 bg-white/[0.06] text-white hover:bg-white/15">
        <Bell size={17} strokeWidth={2.2} className={unread.length ? 'lp-bell-ring' : ''} />
        {unread.length > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-[18px] place-items-center rounded-full bg-red-600 px-1 text-[11px] font-extrabold leading-none text-white ring-2 ring-[#1F3864]" style={{ minWidth: 18 }} data-testid="notify-count">{unread.length > 99 ? '99+' : unread.length}</span>}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} aria-hidden />
          <section role="dialog" aria-label="Notifications" data-testid="notify-panel"
            className="fixed flex flex-col overflow-hidden rounded-md border border-slate-300 bg-white shadow-2xl"
            style={{ zIndex: 61, top: (r?.bottom || 56) + 6, right: Math.max(8, window.innerWidth - (r?.right || window.innerWidth - 8)), width: 'min(400px, calc(100vw - 16px))', maxHeight: '72vh' }}>
            <header className="flex items-center gap-2 border-b border-slate-200 bg-[#1F3864] px-3 py-2 text-white">
              <Bell size={15} aria-hidden />
              <h2 className="text-fs-14 font-bold">Notifications</h2>
              <span className="text-fs-12 text-[#BDD7EE]">{unread.length ? `${unread.length} unread` : 'All read'}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ml-auto rounded-[3px] p-1 hover:bg-white/15"><X size={15} /></button>
            </header>
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
              <button type="button" disabled={!unread.length} onClick={() => mark(notices.map((n) => n.id))} className="inline-flex items-center gap-1 text-fs-12 font-bold text-[#1F4E79] hover:underline disabled:opacity-40"><CheckCheck size={14} /> Mark all as read</button>
              {isAdmin && <button type="button" onClick={manage} className="ml-auto inline-flex items-center gap-1 text-fs-12 font-bold text-[#1F4E79] hover:underline" data-testid="notify-manage"><Settings2 size={14} /> Manage notifications</button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!cfg?.on ? <p className="px-4 py-6 text-center text-fs-13 text-slate-600">Notifications are switched off for all users. They can be switched on in Setup → Notifications.</p>
                : !mine.length ? <p className="px-4 py-6 text-center text-fs-13 text-slate-600">No notifications are assigned to your login.</p>
                  : !notices.length ? <p className="px-4 py-6 text-center text-fs-13 text-slate-600">{rows || day ? 'There are no notifications at present.' : 'Checking the lines…'}</p>
                    : notices.map((n) => {
                      const S = SEV[n.sev] || SEV.low; const Icon = S.icon; const isNew = !read.has(n.id);
                      return (
                        <button key={n.id} type="button" onClick={() => go(n)} data-testid="notify-item"
                          className={`flex w-full items-start gap-2.5 border-b border-slate-100 px-3 py-2 text-left hover:bg-[#EAF2FB] ${isNew ? 'bg-white' : 'bg-slate-50/70'}`}>
                          <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${S.cls}`}><Icon size={14} aria-hidden /></span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-fs-13 ${isNew ? 'font-bold text-slate-900' : 'font-semibold text-slate-600'}`}>{n.title}</span>
                            <span className="block text-fs-12 text-slate-600">{n.text}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-fs-11 text-slate-500">{clockOf(n.at)}</span>
                            {isNew && <i className="ml-auto mt-1 block h-2 w-2 rounded-full bg-[#2E75B6]" aria-label="Unread" />}
                          </span>
                        </button>
                      );
                    })}
            </div>
          </section>
        </>, document.body)}
      <Welcome me={me} ui={ui} unread={unread.length} />
    </>
  );
}

/** the welcome message, once per login (the administrator sets the text in Setup → Notifications) */
function Welcome({ me, ui, unread }) {
  const w = ui.welcome;
  const key = `${me.user}|${me.exp}`;
  const [show, setShow] = useState(() => { try { return localStorage.getItem('ems.welcomed') !== key; } catch { return false; } });
  useEffect(() => {
    if (!show || !w?.on) return undefined;
    try { localStorage.setItem('ems.welcomed', key); } catch { /* private window */ }
    const id = setTimeout(() => setShow(false), 9000);
    return () => clearTimeout(id);
  }, [show, w?.on, key]);
  if (!show || !w?.on) return null;
  const name = me.display || me.user;
  const role = ROLE_TEXT[groupOf(me)] || '';
  const hour = serverNow().getHours();
  return createPortal(
    <div role="status" aria-live="polite" data-testid="welcome" className="lp-welcome fixed overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl" style={{ top: 70, right: 16, zIndex: 55, width: 'min(380px, calc(100vw - 32px))' }}>
      <div className="h-1 bg-gradient-to-r from-sky-300 via-blue-500 to-red-500" aria-hidden />
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-fs-16 font-bold text-[#1F3864]">{welcomeText(w.title.trim() || WELCOME_DEFAULT.title, { name, hour, role })}</div>
          <p className="mt-0.5 text-fs-13 text-slate-700">{welcomeText(w.text.trim() || WELCOME_DEFAULT.text, { name, hour, role })}</p>
          <p className="mt-1.5 text-fs-12 font-semibold text-slate-500">{role ? `Signed in as ${role}` : 'Signed in'}{unread ? ` · ${unread} unread notification${unread === 1 ? '' : 's'}` : ''}</p>
        </div>
        <button type="button" onClick={() => setShow(false)} aria-label="Close welcome message" className="rounded-[3px] p-1 text-slate-500 hover:bg-slate-100"><X size={15} /></button>
      </div>
    </div>, document.body);
}

/** a fault inside the bell or the welcome message hides them; the rest of the screen keeps working */
class BellGuard extends React.Component {
  constructor(p) { super(p); this.state = { bad: false }; }
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch(e) { console.warn('[notifications] hidden after an error', e); }
  render() { return this.state.bad ? null : this.props.children; }
}
export default function NotificationBell() {
  return <BellGuard><BellInner /></BellGuard>;
}
