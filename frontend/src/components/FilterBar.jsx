import React from 'react';
import { shiftDate } from '../api';

function presetRanges(latestDate) {
  if (!latestDate) return [];
  const d = new Date(`${latestDate}T00:00:00`);
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const lastMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);

  return [
    { label: 'Latest day', short: 'Latest', start: latestDate, end: latestDate },
    { label: 'Last 7 days', short: '7 days', start: shiftDate(latestDate, -6), end: latestDate },
    { label: 'Last 10 days', short: '10 days', start: shiftDate(latestDate, -9), end: latestDate },
    { label: 'Last 30 days', short: '30 days', start: shiftDate(latestDate, -29), end: latestDate },
    { label: 'This month', short: 'This month', start: firstOfMonth, end: latestDate },
    {
      label: 'Last month',
      short: 'Last month',
      start: lastMonthStart.toISOString().slice(0, 10),
      end: lastMonthEnd.toISOString().slice(0, 10),
    },
  ];
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-8 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-2.5 text-fs-13 font-bold text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:max-w-[190px]"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function FilterBar({
  companies,
  models,
  companyId,
  mmId,
  onCompanyChange,
  onModelChange,
  range,
  onRangeChange,
  minQty,
  onMinQtyChange,
  latestDate,
  bare = false,
  inline = false,   // inside the page's top row (no padding of its own)
}) {
  const presets = presetRanges(latestDate);
  const activePreset = presets.find((p) => p.start === range.start && p.end === range.end);

  return (
    <div className={inline ? 'contents' : `${bare ? '' : 'rounded-xl border border-slate-200 bg-white shadow-sm'} px-2.5 py-1.5 flex flex-wrap items-center gap-1.5`}>
      <Select
        value={companyId}
        onChange={onCompanyChange}
        placeholder="All companies"
        options={companies.map((c) => ({ value: c.CompanyId, label: c.CompanyTitle }))}
      />
      <Select
        value={mmId}
        onChange={onModelChange}
        placeholder="All models"
        options={models.map((m) => ({ value: m.mmId, label: `${m.model}${m.modelCode ? ` (${m.modelCode})` : ''}` }))}
      />

      <div className="hidden h-6 w-px bg-slate-200 sm:block" />

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={range.start}
          onChange={(e) => onRangeChange({ start: e.target.value, end: range.end })}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold font-mono text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <span className="text-slate-600 text-fs-13">→</span>
        <input
          type="date"
          value={range.end}
          onChange={(e) => onRangeChange({ start: range.start, end: e.target.value })}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold font-mono text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Quick period">
        {presets.map((p, i) => (
          <button
            key={p.label}
            type="button"
            title={`${p.label}: ${p.start} to ${p.end}`}
            aria-pressed={activePreset?.label === p.label}
            onClick={() => onRangeChange({ start: p.start, end: p.end })}
            className={`h-8 px-2.5 text-fs-12 font-extrabold transition-colors ${i ? 'border-l border-slate-200' : ''} ${
              activePreset?.label === p.label
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-700'
            }`}
          >
            {p.short || p.label}
          </button>
        ))}
      </div>

      <div className="hidden h-6 w-px bg-slate-200 sm:block" />

      <label
        className="ml-auto flex items-center gap-1.5 text-fs-12 font-bold text-slate-600"
        title="Models with fewer than this many pieces across the selected range (rework, line setup, one-off scans) are excluded from cycle-time averages so they cannot skew the numbers."
      >
        <span>Min pcs</span>
        <input
          type="number"
          min={1}
          value={minQty}
          onChange={(e) => onMinQtyChange(Math.max(1, Number(e.target.value) || 1))}
          className="h-8 w-14 rounded-lg border border-slate-300 bg-white px-2 text-fs-13 font-bold font-mono text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </label>
    </div>
  );
}
