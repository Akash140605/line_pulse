import { useEffect, useState } from 'react';
import { serverNow, syncServerTime } from '../utils/serverTime';

/** DB server ka time, har tickMs pe update; har 5 min mein dobara sync. */
export default function useServerNow(tickMs = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    let alive = true;
    const sync = () => syncServerTime().then(() => alive && setNow(serverNow()));
    sync();
    const a = setInterval(() => setNow(serverNow()), tickMs);
    const b = setInterval(sync, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [tickMs]);
  return now;
}