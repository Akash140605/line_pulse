import React from 'react';
import { PageLoading, Card, Stat } from '../components/UiKit';
import { ParetoChart } from '../components/ChartKit';
import { pareto, PAL } from '../utils/stats';
import { taktFor } from './DistributionPage';

const hrLabel = (h) => `${String(h).padStart(2, '0')}-${String((h + 1) % 24).padStart(2, '0')}`;

export default function ParetoPage({ a, takt, loading, error, onPickModel }) {
  if (!a) return <PageLoading loading={loading} error={error} />;
  const R = a.rejection;
  const models = a.models;

  const prod = pareto(models.map((m) => ({ id: m.mmId, name: m.model, value: m.qty })));
  const stop = pareto(models.map((m) => ({ id: m.mmId, name: m.model, value: Math.round(m.stoppageSec / 60) })));
  const lost = pareto(models.map((m) => {
    const t = taktFor(takt, m.mmId);
    return { id: m.mmId, name: m.model, value: t && m.mean ? Math.max(0, Math.round(((m.mean - t) * m.n) / 60)) : 0 };
  }));
  const reasons = pareto(R.reasons.map((r) => ({ id: r.reason, name: r.reason, value: r.qty })));
  const rejModels = pareto(R.models.map((m) => ({ id: m.mmId, name: m.model, value: m.qty })));
  const rejHours = pareto(R.hourly.map((h) => ({ id: h.hour, name: hrLabel(h.hour), value: h.qty })), { top: 12 });
  const aCount = prod.filter((p) => p.cls === 'A' && !p.others).length;

  return (
    <div className={`space-y-3 transition-opacity ${loading ? 'opacity-70' : ''}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Models" value={models.length} sub={`${aCount} class-A models = 80% qty`} />
        <Stat label="Total qty" value={a.overall.scans} bar="bg-slate-500" />
        <Stat label="Rejections" value={R.total} sub={`${R.rate}% rate`} tone={R.rate > 2 ? 'text-red-600' : ''} bar="bg-red-500" />
        <Stat label="Line idle" value={`${Math.round((a.overall.idleSeconds || 0) / 60)} min`} sub={`${a.overall.idleGaps || 0} stops`} bar="bg-slate-500" />
      </div>
      <div className="text-fs-12 font-semibold text-slate-600 px-1">Colour: <b className="text-blue-700">A</b> (up to 80%) · <b className="text-slate-600">B</b> (up to 95%) · <b className="text-slate-600">C</b> (tail).</div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Production by model" formula="share = qty ÷ Σqty · cum % = running sum of share (sorted high→low) · A: cum-before < 80, B: < 95, C: rest">
          <ParetoChart data={prod} valueName="Qty" onPick={(d) => onPickModel(d.id)} />
        </Card>
        <Card title="Gap time by model" formula="gap time = Σ seconds of that model's gaps removed as outliers ÷ 60  (not additive across models)">
          <ParetoChart data={stop} valueName="Minutes" fmt={(v) => `${v}m`} color={PAL.red} onPick={(d) => onPickModel(d.id)} />
        </Card>
        <Card title="Time lost vs takt by model" sub={takt.taktSec > 0 || Object.keys(takt.models || {}).length ? 'Models slower than takt — which model loses the most time' : 'Set takt (Cycle time vs takt → Set takt)'}
          formula="lost min = max(0, mean cycle − takt) × valid cycles ÷ 60">
          <ParetoChart data={lost} valueName="Lost min" fmt={(v) => `${v}m`} color={PAL.violet} onPick={(d) => onPickModel(d.id)} />
        </Card>
        <Card title="Rejection reasons" sub="Selected range" formula="share = reason count ÷ total rejections · cum % = running sum (sorted high→low)">
          <ParetoChart data={reasons} valueName="Rejections" color={PAL.red} />
        </Card>
        <Card title="Rejections by model" sub="Model with the most false scans" formula="rejections = count of false scans · rate = rejections ÷ (good scans + rejections)">
          <ParetoChart data={rejModels} valueName="Rejections" color={PAL.red} onPick={(d) => onPickModel(d.id)} />
        </Card>
        <Card title="Rejections by hour" sub="Hour with the most rejections" formula="count of false scans per hour of day (selected range)">
          <ParetoChart data={rejHours} valueName="Rejections" color={PAL.amber} />
        </Card>
      </div>
    </div>
  );
}
