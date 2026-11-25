/**
 * 21-11-2026: the minute of every line's actual last scan on each day of a report period (HPR, SAWM KPI) — the day's
 * last hour is counted only up to it, as on the Loss entry page (a line that stopped at 17:31 is not given the target
 * of 17:31–18:00). Finished days: the scans of the day's last hour with pieces (hour_detail.php, kept by the server);
 * today: the live last scan the OLE data already has (D.endMin). → { "YYYY-MM-DD|line": minute of the day }
 */
import { api } from '../api';

const memo = new Map();   // "date|line|hour|qty" → minute | null (a finished day does not change)
const minOf = (s) => { const m = String(s || '').match(/(\d{1,2}):(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) + (Number(m[3]) > 0 ? 1 : 0) : null; };

export async function loadLastScans(ctx, today, { signal } = {}) {
  const out = {};
  const todo = [];
  for (const d of ctx?.R?.days || []) {
    for (const l of ctx.ids || Object.keys(d.byLine || {})) {
      const L = d.byLine?.[l];
      if (!L?.ok) continue;
      if (d.date === today) {
        const m = ctx.D?.endMin?.[l];
        if (m != null) out[`${d.date}|${l}`] = m;
        continue;
      }
      const last = (L.rows || []).filter((r) => (r.qty || 0) > 0).map((r) => r.hour).pop();
      if (last == null) continue;
      const k = `${d.date}|${l}|${last}|${L.rows.find((r) => r.hour === last)?.qty}`;
      if (memo.has(k)) { if (memo.get(k) != null) out[`${d.date}|${l}`] = memo.get(k); continue; }
      todo.push({ date: d.date, line: l, hour: last, k });
    }
  }
  const worker = async () => {
    while (todo.length) {
      const t = todo.shift();
      try {
        const j = await api.hourDetail(t.date, t.hour, { line: t.line }, { signal });
        const m = (Array.isArray(j?.scans) ? j.scans : []).map((x) => minOf(x.scanDate)).filter((x) => x != null && x >= t.hour * 60 && x <= t.hour * 60 + 60);
        const v = m.length ? Math.max(...m) : null;
        memo.set(t.k, v);
        if (v != null) out[`${t.date}|${t.line}`] = v;
      } catch (e) { if (e?.name === 'AbortError') throw e; /* not read: that day keeps its whole last hour */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
