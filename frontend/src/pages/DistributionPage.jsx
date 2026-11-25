import React, { useState } from 'react';
import { fmtSeconds } from '../api';
import { Card, Stat, PageLoading, StatusChip } from '../components/UiKit';
import { HistogramChart, ModelRangeChart } from '../components/ChartKit';
import { PAL, shareWithin, cpk, stabilityOf } from '../utils/stats';

export const taktFor = (t, id) => (Number(t.models?.[id]) > 0 ? Number(t.models[id]) : t.taktSec > 0 ? Number(t.taktSec) : null);
const f1 = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

export default function DistributionPage({ a, takt, loading, error }) {
  const [sel, setSel] = useState('all');
  if (!a) return <PageLoading loading={loading} error={error} />;

  const o = a.overall;
  const models = a.models.filter((m) => m.n > 0);
  const model = sel === 'all' ? null : models.find((m) => String(m.mmId) === sel);
  const src = model || o;
  const counts = model ? model.histogram : o.histogram.counts;
  const width = o.histogram.width;
  const limit = model ? taktFor(takt, model.mmId) : takt.taktSec > 0 ? Number(takt.taktSec) : null;
  const within = shareWithin(counts, width, limit);
  const outPct = o.n + o.outlierGaps > 0 ? (o.outlierGaps / (o.n + o.outlierGaps)) * 100 : 0;

  const markers = [
    { value: src.mean, label: `Mean ${fmtSeconds(src.mean)}`, color: PAL.green },
    { value: src.median, label: `P50 ${fmtSeconds(src.median)}`, color: PAL.blue },
    { value: src.p95, label: `P95 ${fmtSeconds(src.p95)}`, color: PAL.violet },
    limit && { value: limit, label: `Takt ${fmtSeconds(limit)}`, color: PAL.red },
  ].filter(Boolean);

  return (
    <div className={`space-y-3 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9 gap-2">
        <Stat label="Valid cycles" value={src.n} sub={model ? model.model : 'all models'} />
        <Stat label="Mean" value={fmtSeconds(src.mean)} tone="text-sky-700" bar="bg-sky-500" />
        <Stat label="Median (P50)" value={fmtSeconds(src.median)} bar="bg-blue-500" />
        <Stat label="Std dev" value={fmtSeconds(src.std)} sub="sample σ" bar="bg-slate-400" />
        <Stat label="CV" value={src.cv != null ? `${src.cv}%` : '—'} sub={{ ok: 'stable', watch: 'watch', behind: 'unstable', idle: '' }[stabilityOf(src.cv)]}
          tone={src.cv > 30 ? 'text-red-600' : src.cv > 15 ? 'text-slate-600' : 'text-slate-900'} bar="bg-slate-500" />
        <Stat label="P90" value={fmtSeconds(src.p90)} sub="90% of cycles ≤" bar="bg-blue-500" />
        <Stat label="P95" value={fmtSeconds(src.p95)} sub="95% of cycles ≤" bar="bg-blue-500" />
        <Stat label="Within takt (≈)" value={within != null ? `${within.toFixed(0)}%` : '—'} sub={limit ? `cycles ≤ ${fmtSeconds(limit)}` : 'set takt to enable'}
          tone={within == null ? '' : within >= 90 ? 'text-sky-600' : within >= 70 ? 'text-slate-600' : 'text-red-600'} bar="bg-sky-500" />
        <Stat label="Outliers removed" value={o.outlierGaps} sub={`${outPct.toFixed(1)}% of gaps`} bar="bg-slate-500" />
      </div>

      <Card title="Cycle-time histogram"
        formula="bin = floor(cycle ÷ width) · height = count of valid cycles in the bin · share % = count ÷ total valid cycles"
        right={
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="h-8 max-w-[200px] rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold">
            <option value="all">All models</option>
            {models.map((m) => <option key={m.mmId} value={m.mmId}>{m.model} ({m.n})</option>)}
          </select>
        }>
        <HistogramChart counts={counts} width={width} markers={markers} limit={limit} />
        <div className="text-fs-12 text-slate-600 font-medium mt-1">Bin width {width}s · last bar = overflow (≥ edge). Outlier gaps (lunch / stoppages) are not included in this chart.</div>
      </Card>

      <Card title="Model-wise spread — P10 → Median → P90"
        formula="P(p) = value at rank (n−1)·p after sorting (Excel PERCENTILE.INC) · bar = P10→P50 (light) + P50→P90 (dark)">
        <ModelRangeChart rows={models.slice(0, 15)} takt={takt.taktSec > 0 ? Number(takt.taktSec) : null} />
      </Card>

      <Card title="Statistics table — every model"
        formula="σ = sqrt(Σ(x−mean)² ÷ (n−1)) · CV = σ ÷ mean · Cpk = (takt − mean) ÷ (3σ)  [takt = upper limit]">
        <div className="overflow-x-auto max-h-[440px] overflow-y-auto">
          <table className="w-full text-fs-13">
            <thead className="sticky top-0 bg-white"><tr className="text-left text-slate-600 uppercase tracking-wide border-b border-slate-200">
              {['Model', 'Gaps (n)', 'Mean (s)', 'Median (s)', 'Spread σ (s)', 'Variation (CV)', '90 % within (s)', '95 % within (s)', 'Fastest (s)', 'Slowest (s)', 'Takt (s)', 'Capability (Cpk)', 'Stability'].map((h) => <th key={h} className="px-2 py-2 font-bold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>{models.map((m) => {
              const tk = taktFor(takt, m.mmId); const c = tk ? cpk(m.mean, m.std, tk) : null;
              return (
                <tr key={m.mmId} className="border-b border-slate-100 font-mono">
                  <td className="px-2 py-1.5 font-bold whitespace-nowrap sticky left-0 z-[1] bg-white">{m.model}</td><td className="px-2">{m.n}</td>
                  <td className="px-2 font-bold text-sky-700">{fmtSeconds(m.mean)}</td><td className="px-2">{fmtSeconds(m.median)}</td>
                  <td className="px-2">{f1(m.std)}</td><td className="px-2">{m.cv != null ? `${m.cv}%` : '—'}</td>
                  <td className="px-2">{fmtSeconds(m.p90)}</td><td className="px-2">{fmtSeconds(m.p95)}</td>
                  <td className="px-2">{fmtSeconds(m.min)}</td><td className="px-2">{fmtSeconds(m.max)}</td>
                  <td className="px-2">{tk ? fmtSeconds(tk) : '—'}</td>
                  <td className={`px-2 font-bold ${c == null ? '' : c >= 1.33 ? 'text-sky-600' : c >= 1 ? 'text-slate-600' : 'text-red-600'}`}>{c != null ? c.toFixed(2) : '—'}</td>
                  <td className="px-2 font-sans"><StatusChip s={stabilityOf(m.cv)} labels={{ ok: 'Stable', watch: 'Watch', behind: 'Unstable' }} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="text-fs-12 text-slate-600 font-medium mt-1.5">Cpk ≥ 1.33 capable · 1.00–1.33 marginal · &lt; 1.00 the takt will be missed. Takt values are taken from the Cycle &amp; Takt settings.</div>
      </Card>
    </div>
  );
}
