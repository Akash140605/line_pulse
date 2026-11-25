import { serverNow } from './serverTime';
// Builds Excel sheets from the data already on screen (same numbers as the dashboard). xlsx is loaded only on click.
const r1 = (v, d = 1) => (v === null || v === undefined ? '' : Math.round(v * 10 ** d) / 10 ** d);
const mins = (s) => (s ? Math.round((s / 60) * 10) / 10 : 0);

/** Pure: returns { sheetName: rows[] } — unit-tested. */
export function buildSheets({ range, focusDate, filters, settings, summary, daily, modelData, analytics, companyName, modelName }) {
  const sheets = {};
  const o = filters || {};
  sheets['Info'] = [
    ['Report', 'Dixon Line Pulse — shopfloor analytics'],
    ['Date range', range ? `${range.start} to ${range.end}` : ''],
    ['Focus day', focusDate || ''],
    ['Company filter', companyName || 'All'],
    ['Model filter', modelName || 'All'],
    ['Outlier filter', o.outlierMode === 'fixed' ? `Fixed > ${o.outlierMax}s` : o.outlierMode === 'off' ? 'Off' : `Auto > ${o.outlierMult} x median (max ${o.outlierMax ?? 300}s)`],
    ['Min gap (s)', o.outlierMin ?? ''],
    ['Idle threshold (s)', o.outlierIdle ?? ''],
    ['Low-volume threshold (pcs)', o.minQty ?? ''],
    ['Takt (s)', settings?.taktSec || 'not set'],
    ['Working window', settings ? `${settings.startHour}:00-${settings.endHour}:00 (lunch ${settings.lunchHour ?? 'none'})` : ''],
    ['Generated', serverNow().toLocaleString()],
  ].map(([Parameter, Value]) => ({ Parameter, Value }));

  if (summary?.hours) {
    sheets['Hourly (focus day)'] = summary.hours.filter((h) => h.quantity > 0).map((h) => ({
      Hour: h.label, Qty: h.quantity, 'Excluded qty (low-volume)': h.excludedQuantity, 'Avg cycle (s)': r1(h.avgActualCycleSeconds),
      'Min cycle (s)': h.minActualCycleSeconds ?? '', 'Max cycle (s)': h.maxActualCycleSeconds ?? '', 'Theoretical cycle (s)': r1(h.theoreticalCycleSeconds),
      Models: h.distinctModels, 'Cycle samples': h.cycleSamples ?? '', 'Outlier gaps': h.outlierGaps ?? 0, 'Model gap time (min)': mins(h.outlierSeconds),
      'Line idle (min)': mins(h.idleSeconds), 'Idle stops': h.idleGaps ?? 0,
    }));
  }
  if (daily?.days) {
    sheets['Daily'] = daily.days.map((d) => ({
      Date: d.date, Qty: d.quantity, Models: d.distinctModels, 'Active hours': d.activeHours, 'Avg cycle (s)': r1(d.avgActualCycleSeconds),
      'Theoretical cycle (s)': r1(d.theoreticalCycleSeconds), 'Outlier gaps': d.outlierGaps ?? 0, 'Model gap time (min)': mins(d.outlierSeconds),
      'Line idle (min)': mins(d.idleSeconds), 'Idle stops': d.idleGaps ?? 0,
    }));
  }
  if (modelData) {
    const row = (m, low) => ({
      Model: m.model, Code: m.modelCode ?? '', Company: m.companyTitle ?? '', Qty: m.quantity, 'Active hours': m.activeHours, 'Avg cycle (s)': r1(m.avgActualCycleSeconds),
      'Min cycle (s)': m.minActualCycleSeconds ?? '', 'Max cycle (s)': m.maxActualCycleSeconds ?? '', 'Avg theoretical (s)': r1(m.avgTheoreticalCycleSeconds),
      'Outlier gaps': m.outlierGaps ?? 0, 'Gap time (min)': mins(m.stoppageSeconds), 'Low volume': low ? 'yes' : '',
    });
    sheets['Models'] = [...(modelData.models || []).map((m) => row(m, false)), ...(modelData.lowVolumeModels || []).map((m) => row(m, true))];
  }
  if (analytics) {
    sheets['Cycle stats by model'] = analytics.models.map((m) => ({
      Model: m.model, Code: m.modelCode ?? '', Qty: m.qty, 'Valid cycles': m.n, 'Mean (s)': m.mean, 'Median (s)': m.median, 'Std dev (s)': m.std, 'CV %': m.cv,
      'P10 (s)': m.p10, 'P90 (s)': m.p90, 'P95 (s)': m.p95, 'Min (s)': m.min, 'Max (s)': m.max, 'Gap time (min)': mins(m.stoppageSec), 'Outlier gaps': m.outlierGaps,
    }));
    const w = analytics.overall.histogram.width;
    sheets['Histogram'] = analytics.overall.histogram.counts.map((c, i) => ({ 'From (s)': i * w, 'To (s)': (i + 1) * w, Count: c }));
    sheets['Rejection reasons'] = analytics.rejection.reasons.map((r) => ({ Reason: r.reason, Qty: r.qty, 'Share %': r.pct, 'Cumulative %': r.cumPct }));
    sheets['Rejection by model'] = analytics.rejection.models.map((m) => ({ Model: m.model, Rejections: m.qty, 'Good scans': m.good, 'Rate %': m.rate }));
  }
  return sheets;
}

export async function exportWorkbook(ctx) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(buildSheets(ctx))) {
    if (!rows.length) continue;
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: Math.max(10, String(k).length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const r = ctx.range;
  XLSX.writeFile(wb, `line-pulse_${r ? `${r.start}_${r.end}` : 'export'}.xlsx`);
}
