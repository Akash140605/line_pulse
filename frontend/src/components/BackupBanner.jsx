import React, { useEffect, useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { backupNotice, getBackupState, subscribeBackup, backupAgeMin, ageText } from '../utils/backup';
import useServerNow from '../hooks/useServerNow';
import { LINE_IDS } from '../api';
import { clockInfo, subscribeClock } from '../utils/serverTime';

/** The day and time of the whole dashboard come from the line database server's clock: when that clock is far from
 *  this PC's clock (wrong date, an hour off), every "today" is wrong — say so loudly, with both times. */
export function ClockWarning() {
  const [c, setC] = useState(clockInfo);
  useEffect(() => subscribeClock(setC), []);
  if (!c.synced || Math.abs(c.skew) < 30 * 60 * 1000) return null;
  const ignored = c.offset === 0 && c.skew !== 0;
  const f = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const pc = new Date(Date.now());
  return (
    <div role="alert" aria-label="Server clock wrong" className="rounded-xl border-2 border-red-600 bg-red-50 px-3 py-2 text-fs-14 text-red-950">
      <b>Line server clock is wrong:</b> the database server{c.source ? ` (${c.source})` : ''} says <b className="font-mono">{f(c.now)}</b>, this PC says <b className="font-mono">{f(pc)}</b>.
      {' '}{ignored ? 'The difference is too big, so the dashboard uses this PC’s clock for “today” and “yesterday”. Scans saved by that line can still carry the wrong date.' : 'The dashboard takes “today” and the current hour from that server, so the day shown can be wrong.'}
      {' '}Set the date and time of that line PC correctly (Windows: Settings → Time → Set time automatically).
    </div>
  );
}

/** Shown while a line's server is offline and its numbers come from the local backup copy. line = '1'..'4' or 'all'. */
export default function BackupBanner({ line }) {
  const [state, setState] = useState(getBackupState);
  useEffect(() => subscribeBackup(setState), []);
  const now = useServerNow(30000);
  const rows = Object.entries(state).filter(([l]) => LINE_IDS.includes(l) && (line === 'all' || l === String(line)))   // only the lines of this login.sort(([a], [b]) => a.localeCompare(b));
  if (!rows.length) return <ClockWarning />;
  return (
    <>
    <ClockWarning />
    <div role="status" aria-label="Offline lines" className="rounded-xl border-2 border-slate-400 bg-slate-50 text-slate-950 px-3 py-2 text-fs-14 flex flex-col gap-1.5">
      {rows.map(([l, info]) => {
        const age = backupAgeMin(info, now);
        return (
          <div key={l} className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-fs-12 font-extrabold uppercase tracking-wide text-white"><DatabaseBackup size={13} aria-hidden /> Line {l} offline</span>
            {age != null && <span className={`shrink-0 rounded-md px-2 py-0.5 text-fs-12 font-extrabold ${age > 60 ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-900'}`}>data {ageText(age)}</span>}
            <span className="min-w-0 flex-1">{backupNotice(l, info)} Live data returns by itself when the server is reachable again.</span>
          </div>
        );
      })}
    </div>
    </>
  );
}
