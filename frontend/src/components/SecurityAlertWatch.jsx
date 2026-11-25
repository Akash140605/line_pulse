import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from './AuthGate';
import { openPage } from './NotificationBell';

/**
 * 25-11-2026: the security alerts of the admin (backend lib/alerts.php) beside the bell — a program that tried to copy
 * the data, a blocked PC, a login used elsewhere, many wrong passwords, the admin login on a new PC, many reports
 * downloaded … A red shield with the count of unread alerts; a new alert pops up at once. Read every minute.
 */
export default function SecurityAlertWatch() {
  const me = useAuth();
  const [d, setD] = useState(null);
  const [pop, setPop] = useState(null);
  const seen = useRef(null);
  const isAdmin = me?.role === 'admin';
  useEffect(() => {
    if (!isAdmin) return undefined;
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const j = await api.securityAlerts();
        if (!alive) return;
        setD(j);
        const ids = (j.alerts || []).filter((a) => !a.read).map((a) => a.id);
        if (seen.current) { const fresh = (j.alerts || []).find((a) => !a.read && !seen.current.has(a.id)); if (fresh) setPop(fresh); }
        seen.current = new Set([...(seen.current || []), ...ids]);
      } catch { /* the watch is never in the way */ }
    };
    const t0 = setTimeout(load, 3000);
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearTimeout(t0); clearInterval(id); };
  }, [isAdmin]);
  if (!isAdmin || !d) return null;
  const n = d.unread || 0;
  const open = () => { setPop(null); try { sessionStorage.setItem('ems.setupTab', 'security'); } catch { /* private */ } openPage('setup', { tab: 'security' }); };
  return (
    <>
      <button type="button" onClick={open} data-testid="sec-alert-btn" aria-label={`Security alerts${n ? `, ${n} unread` : ''}`} title={n ? `${n} security alert${n > 1 ? 's' : ''} not read — open Setup → Security` : 'Security alerts: none new'}
        style={{ width: 34, height: 34 }} className={`relative grid shrink-0 place-items-center rounded-[3px] border text-white ${n ? 'border-red-300 bg-red-600 hover:bg-red-700' : 'border-white/25 bg-white/[0.06] hover:bg-white/15'}`}>
        <ShieldAlert size={17} strokeWidth={2.2} />
        {n > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-[18px] place-items-center rounded-full bg-white px-1 text-[11px] font-extrabold leading-none text-red-700 ring-2 ring-white" style={{ minWidth: 18, boxShadow: '0 0 0 2px #DC2626' }}>{n > 99 ? '99+' : n}</span>}
      </button>
      {pop && (
        <div role="alert" data-testid="sec-alert-pop" style={{ top: 64, width: 'min(380px, calc(100vw - 24px))' }} className="fixed right-3 z-[70] overflow-hidden rounded-lg border-2 border-red-500 bg-white shadow-2xl">
          <div className="flex items-center gap-2 bg-red-600 px-3 py-2 text-white">
            <ShieldAlert size={16} aria-hidden /><b className="text-fs-14">Security alert</b>
            <button type="button" onClick={() => setPop(null)} aria-label="Close" className="ml-auto rounded p-0.5 hover:bg-white/20"><X size={15} /></button>
          </div>
          <div className="px-3 py-2 text-fs-13 text-slate-800">
            <div className="font-bold">{pop.text}</div>
            <div className="mt-0.5 text-slate-600">PC <b className="font-mono">{pop.ip}</b>{pop.user ? <> · login <b>{pop.user}</b></> : null} · {pop.time?.slice(11, 16)}</div>
            {pop.detail && <div className="mt-0.5 text-fs-12 text-slate-600">{pop.detail}</div>}
            <button type="button" onClick={open} className="mt-2 rounded-md bg-[#1F3864] px-3 py-1.5 text-fs-13 font-bold text-white">Open Security</button>
          </div>
        </div>
      )}
    </>
  );
}
