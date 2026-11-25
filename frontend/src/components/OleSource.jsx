import { useEffect, useMemo } from 'react';
import { useAllLineSettings } from '../hooks/useLineSettings';
import { serverToday } from '../utils/serverTime';
import { oleRange } from '../utils/ole';
import { useOleData } from './OleParts';

/**
 * Reads the OLE data of a period (only while it is mounted) and hands it to the page: onReady({ R, D, ids, settings }, err).
 * Used by Reports and Report compare.
 */
export default function OleSource({ start, end, ids, onReady }) {
  const settings = useAllLineSettings(ids);
  const D = useOleData({ start, end, ids });
  const today = serverToday();
  const R = useMemo(() => (D.al ? oleRange({ lines: D.al.lines, settings, entries: D.ent.entries, days: D.ent.days, setups: D.ent.setup, start, end, today, nowMin: D.endMin, ids }) : null),
    [D.al, settings, D.ent.entries, D.ent.days, start, end, today, D.endMin, ids]);
  useEffect(() => { onReady(R ? { R, D, ids, settings } : null, D.err); }, [R, D.ent, D.err, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
