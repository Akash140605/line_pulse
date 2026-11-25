import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { UserMenu } from './AuthGate';
import DixonLogo from './DixonLogo';
import NotificationBell from './NotificationBell';
import SecurityAlertWatch from './SecurityAlertWatch';
import { pathOf } from './Sidebar';
import { LINE_IDS, subscribeBusy } from '../api';
import { getAuth } from '../auth';
import { serverNow, subscribeClock } from '../utils/serverTime';
import { getBackupState, subscribeBackup } from '../utils/backup';

/*
 * The top of every screen in the look of the Dixon MES (Production Management System, C8 overall dashboard), 19-11-2026:
 *   navy bar   — page title (20 px) with its path below (PLANT › GROUP › PAGE), then PLANT · SHIFT · LINK, the clock and the user
 *   light strip — the page's own filters (#lp-header-slot), "Up to date" and Refresh
 *   status bar — fixed at the bottom (PC): system online, plant | page, last updated · live data
 * TV screens have their own stage and never show this header.
 */
const PLANT_OF = { 1: 'C8', 2: 'C8', 3: 'C3', 4: 'C2' };   // same as OleParts PLANT_OF
const plantCodes = () => {
  const a = getAuth();
  const lines = a?.role === 'management' && a.lines?.length ? a.lines : LINE_IDS;
  return [...new Set(lines.map((l) => PLANT_OF[Number(l)]).filter(Boolean))];
};
const p2 = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = (d) => { const h = d.getHours(); return `${p2(((h + 11) % 12) + 1)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${h < 12 ? 'AM' : 'PM'}`; };
const dayText = (d) => `${DAYS[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;

/** the server clock, every second (only this small part redraws) */
function useNow() {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000);
    const off = subscribeClock(() => setNow(serverNow()));
    return () => { clearInterval(id); off(); };
  }, []);
  return now;
}
/** lines answered from the backup copy (offline) */
function useOffline() {
  const [st, setSt] = useState(() => getBackupState());
  useEffect(() => subscribeBackup(setSt), []);
  return Object.keys(st || {}).sort();
}
/** the app is reading from the server; the time of the last finished read */
function useBusy() {
  const [busy, setBusy] = useState(0);
  const [at, setAt] = useState(() => serverNow());
  useEffect(() => { let was = 0; return subscribeBusy((n) => { setBusy(n); if (was > 0 && n === 0) setAt(serverNow()); was = n; }); }, []);
  return [busy > 0, at];
}

function Clock() {
  const now = useNow();
  return (
    <div className="lp-top-box hidden flex-col items-end justify-center px-3 leading-tight md:flex" aria-label="Server time">
      <b className="text-[14px] font-bold tabular-nums text-white">{clock(now)}</b>
      <span className="text-[11px] font-semibold text-[#BDD7EE]">{dayText(now)}</span>
    </div>
  );
}

function InfoBox() {
  const off = useOffline();
  const plants = plantCodes();
  const cell = 'flex flex-col justify-center px-3 leading-tight';
  const cap = 'text-[11px] font-bold lp-caps tracking-[0.1em] text-[#8FB4DA]';
  return (
    <div className="lp-top-box hidden items-stretch divide-x divide-white/15 lg:flex" aria-label="Plant and link">
      <div className={cell}><span className={cap}>Plant</span><b className="max-w-[9rem] truncate text-[14px] font-bold text-white" title={plants.join(' · ')}>{plants.join(' · ') || '—'}</b></div>
      <div className={cell}><span className={cap}>Lines</span><b className="text-[14px] font-bold text-white">{LINE_IDS.length}</b></div>
      <div className={cell}>
        <span className={cap}>Link</span>
        {off.length
          ? <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#FFEB9C] px-2 py-px text-[11px] font-extrabold text-[#9C5700]" title={`Line ${off.join(', ')} answered from the backup copy`}><i className="h-1.5 w-1.5 rounded-full bg-[#C65911]" />BACKUP L{off.join(",")}</span>
          : <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#C6EFCE] px-2 py-px text-[11px] font-extrabold text-[#006100]"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00A651]" />LIVE</span>}
      </div>
    </div>
  );
}

function StatusBar({ title }) {
  const off = useOffline();
  const [, at] = useBusy();
  const plants = plantCodes();
  return createPortal(
    <footer className="lp-status fixed inset-x-0 bottom-0 z-30 hidden h-7 items-center bg-[#1F3864] text-[12px] font-semibold text-white md:flex" aria-label="Status">
      <div className="lp-status-side flex h-full shrink-0 items-center gap-2 border-r border-white/15 px-4">
        <i className={`h-2 w-2 rounded-full ${off.length ? 'bg-[#FFC000]' : 'bg-[#22C55E]'}`} />{off.length ? `Line ${off.join(", ")} on backup copy` : 'System online · live'}
      </div>
      <div className="min-w-0 flex-1 truncate px-4">Dixon – {plants.length ? plants.join(' · ') : 'EMS'} {plants.length > 1 ? 'Plants' : 'Plant'} | {title}</div>
      <div className="shrink-0 px-4 tabular-nums">Last Updated: {dayText(at).replace(/^\w+, /, '')}, {clock(at).toLowerCase()} <span className="ml-1 font-bold">● Live Data</span></div>
    </footer>,
    document.body,
  );
}

export default function Header({ onRefresh, loading, title, extra }) {
  const [busy] = useBusy();
  const plants = plantCodes();
  const base = String(title || 'Dixon Line Pulse').split(' · ')[0];
  // the plant efficiency page reads as the plant's own heading: "C8 Plant Efficiency — Assembly Lines"
  const name = base === 'Plant Efficiency' ? `${plants.length === 1 ? `${plants[0]} ` : ''}Plant Efficiency — Assembly Lines` : title || 'Dixon Line Pulse';
  const path = [plants.length === 1 ? `${plants[0]} Plant` : 'Dixon EMS', pathOf(base), base].filter(Boolean);
  const refreshing = loading || busy;
  useEffect(() => { document.body.classList.add('lp-has-status'); return () => document.body.classList.remove('lp-has-status'); }, []);
  return (
    <header className="lp-top sticky top-0 z-30">
      {/* 1 — the navy bar: title and its path | plant · lines · link | clock | user */}
      <div className="lp-top-row flex w-full items-center gap-3 px-3 py-1.5 lg:px-4">
        {/* phones have no sidebar: the Dixon logo sits here; wider screens show it in the sidebar */}
        <DixonLogo className="lp-top-logo h-[13px] shrink-0 md:hidden" />
        <div className="min-w-0 flex-1">
          <h1 className="lp-top-title truncate text-fs-18 font-bold text-dixon-ink" title={name}>{name}</h1>
          <nav aria-label="Path" className="lp-top-path hidden min-w-0 items-center gap-1.5 truncate sm:flex">
            {path.map((p, i) => (
              <React.Fragment key={`${p}-${i}`}>
                {i > 0 && <span aria-hidden className="opacity-60">›</span>}
                <span className={i === path.length - 1 ? 'lp-top-path-now' : ''}>{p}</span>
              </React.Fragment>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <InfoBox />
          <Clock />
          <SecurityAlertWatch />
          <NotificationBell />
          <UserMenu top />
        </div>
      </div>
      {/* 2 — the light strip: the page's filters, then Up to date and Refresh */}
      <div className="lp-top-strip flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 lg:px-4">
        <div id="lp-header-slot" className="flex min-w-0 flex-1 flex-wrap items-center gap-2" />
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <div id="lp-header-actions" className="flex shrink-0 items-center gap-1.5" />
          {extra}
          <span className={`lp-uptodate inline-flex shrink-0 items-center gap-1.5 rounded-[3px] border px-2.5 py-1 text-fs-13 font-semibold ${refreshing ? 'border-[#FFE699] bg-[#FFF8E1] text-[#9C5700]' : 'border-[#BDD7EE] bg-[#EAF2FB] text-[#1F4E79]'}`} aria-live="polite" title={refreshing ? 'Refreshing…' : 'Up to date'}>
            <i className={`h-2 w-2 rounded-full ${refreshing ? 'animate-pulse bg-[#FFC000]' : 'bg-[#2E75B6]'}`} /><span className="lp-wide-text">{refreshing ? 'Refreshing…' : 'Up to date'}</span>
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh now"
            aria-label="Refresh now"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[3px] border border-[#BFBFBF] bg-white px-2.5 py-1 text-fs-13 font-semibold text-[#1F3864] shadow-sm transition-colors hover:border-[#2E75B6] hover:bg-[#EAF2FB] disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={13} strokeWidth={2.5} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>
      <StatusBar title={base} />
    </header>
  );
}
