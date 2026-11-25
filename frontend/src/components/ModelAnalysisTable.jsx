import { normShift, fmtMin } from '../utils/shift';
import React, { useState } from 'react';
import { fmtSeconds } from '../api';

// Same working window as the hourly matrix, so a model's breakdown lines up
// with how the rest of the app reads "the day".
// working window and lunch come from the line's shift settings (Shift & lunch) through the `shift` prop

const pad2 = (n) => String(n).padStart(2, '0');
const hourRangeLabel = (h) => `${pad2(h)}-${pad2(h + 1)}`;

function HourlyBreakdown({ hourly, shift }) {
  const sh = normShift(shift);
  const START = Math.floor(sh.start / 60), END = Math.ceil(sh.end / 60), LUNCH = sh.lunchStart == null ? null : Math.floor(sh.lunchStart / 60);
  // Always render the full 09-21 window, filling in zero-quantity hours,
  // so gaps in a model's activity show up as empty space at the right
  // hour position instead of pulling the bars next to each other and
  // making the x-axis misleading.
  const byHour = {};
  for (const h of hourly || []) byHour[h.hour] = h;

  // the shift window always + any hour outside it in which this model was made (early start, overtime)
  const hs = new Set();
  for (let h = START; h < END; h++) hs.add(h);
  for (const h of hourly || []) if ((h.quantity || 0) > 0) hs.add(Number(h.hour));
  const hours = [...hs].sort((a, b) => a - b).map((h) => byHour[h] || { hour: h, quantity: 0, theoreticalCycleSeconds: null });

  const max = Math.max(1, ...hours.map((h) => h.quantity));
  const CHART_HEIGHT = 80; // px — must match the fixed pixel height below

  return (
    <div className="bg-white rounded-md p-2.5 my-2 border border-slate-200">
      <div className="text-slate-700 text-fs-13 mb-2 font-mono">quantity by hour ({pad2(START)}-{pad2(END)}{LUNCH != null ? `, lunch ${fmtMin(sh.lunchStart)}–${fmtMin(sh.lunchEnd)}` : ''})</div>
      <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
        {hours.map((h) => {
          const isLunch = h.hour === LUNCH;
          const barHeight = h.quantity > 0 ? Math.max(3, (h.quantity / max) * CHART_HEIGHT) : 0;
          return (
            <div
              key={h.hour}
              className="flex-1 h-full flex flex-col items-center justify-end group relative"
            >
              <div
                className={`w-full rounded-sm transition-colors ${
                  h.quantity > 0 ? 'bg-sky-600/70 group-hover:bg-sky-600' : 'bg-slate-200/30'
                }`}
                style={{ height: `${barHeight}px` }}
              />
              <span
                className={`text-fs-12 mt-1 font-mono ${isLunch ? 'text-slate-700' : 'text-slate-700'}`}
              >
                {pad2(h.hour)}
              </span>
              {h.quantity > 0 && (
                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-white border border-slate-200
                                rounded px-2 py-1 text-fs-13 font-mono text-slate-900 whitespace-nowrap z-10">
                  {hourRangeLabel(h.hour)} · {h.quantity} units · theory {fmtSeconds(h.theoreticalCycleSeconds)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ModelAnalysisTable({ models, lowVolumeModels, minQty, shift }) {
  const [expanded, setExpanded] = useState(null);

  if (!models) return null;

  const maxQty = Math.max(1, ...models.map((m) => m.quantity));

  return (
    <div className="bg-white border border-slate-300 rounded-xl shadow-sm shadow-slate-200/70 overflow-hidden">
      <div className="px-2.5 sm:px-2.5 pt-3 pb-2">
        <h2 className="text-slate-950 text-fs-13 sm:text-fs-18 font-extrabold">Model-wise cycle time</h2>
      </div>

      <div className="overflow-x-auto max-h-[270px] overflow-y-auto">
        <table className="w-full text-fs-13">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="text-slate-700 text-fs-13 uppercase tracking-wide border-t border-b border-slate-200">
              <th className="text-left font-normal px-5 py-2.5">Model</th>
              <th className="text-left font-normal px-2.5 py-2.5">Company</th>
              <th className="text-right font-normal px-2.5 py-2.5">Qty</th>
              <th className="text-right font-normal px-2.5 py-2.5">Active hrs</th>
              <th className="text-right font-normal px-2.5 py-2.5 text-sky-600">Avg actual</th>
              <th className="text-right font-normal px-2.5 py-2.5">Min actual</th>
              <th className="text-right font-normal px-2.5 py-2.5">Max actual</th>
              <th className="text-right font-normal px-5 py-2.5 text-slate-700">Avg theoretical</th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-700 py-8">
                  No scans recorded for this date.
                </td>
              </tr>
            )}
            {models.map((m, idx) => {
              const isOpen = expanded === m.mmId;
              const bottleneck =
                m.avgActualCycleSeconds &&
                m.avgTheoreticalCycleSeconds &&
                m.avgActualCycleSeconds > m.avgTheoreticalCycleSeconds * 1.3;
              return (
                <React.Fragment key={m.mmId}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : m.mmId)}
                    className={`border-b border-slate-200 hover:bg-white cursor-pointer transition-colors ${
                      isOpen ? 'bg-white' : idx % 2 === 1 ? 'bg-white/40' : ''
                    }`}
                  >
                    <td className="px-5 py-2.5 font-mono text-slate-900">
                      <span className="text-slate-700 mr-1.5">{isOpen ? '▾' : '▸'}</span>
                      {idx < 3 && <span className="mr-1.5">{['🥇', '🥈', '🥉'][idx]}</span>}
                      {m.model}
                      {m.modelCode && <span className="text-slate-700 ml-1.5 text-fs-13">({m.modelCode})</span>}
                    </td>
                    <td className="px-2.5 py-2.5 text-slate-600">{m.companyTitle}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-slate-900">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-14 h-1.5 bg-white rounded-full overflow-hidden hidden sm:block">
                          <div
                            className="h-full bg-sky-600/70 rounded-full"
                            style={{ width: `${(m.quantity / maxQty) * 100}%` }}
                          />
                        </div>
                        <span>{m.quantity}</span>
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-slate-600">{m.activeHours}</td>
                    <td className={`px-2.5 py-2.5 text-right font-mono ${bottleneck ? 'text-red-600' : 'text-sky-600'}`}>
                      {fmtSeconds(m.avgActualCycleSeconds)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-slate-600">{fmtSeconds(m.minActualCycleSeconds)}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono text-slate-600">{fmtSeconds(m.maxActualCycleSeconds)}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-slate-700">
                      {fmtSeconds(m.avgTheoreticalCycleSeconds)}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8} className="px-5 pb-3">
                        <HourlyBreakdown shift={shift} hourly={m.hourly} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {lowVolumeModels && lowVolumeModels.length > 0 && (
        <div className="border-t border-slate-200 px-5 py-2">
          <h3 className="text-slate-600 text-fs-13 uppercase tracking-wide mb-2">
            Low-volume / rework models (&lt; {minQty} pcs today)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {lowVolumeModels.map((m) => (
              <div
                key={m.mmId}
                className="bg-white border border-slate-200/70 rounded-md px-2.5 py-1.5 text-fs-13 font-mono text-slate-700"
                title={`avg ${m.avgActualCycleSeconds ?? '—'}s · min ${m.minActualCycleSeconds ?? '—'}s · max ${m.maxActualCycleSeconds ?? '—'}s (unreliable, low sample size)`}
              >
                {m.model} <span className="text-slate-700">·</span> {m.quantity} pcs
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}