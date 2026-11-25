import React from 'react';
import { AlertTriangle, Check, Minus, Plus } from 'lucide-react';
import { FONTS, MONOS, THEME_DEFAULT, THEME_PRESETS, SHADES, shadesOf, contrastWithWhite } from '../utils/themeEngine';

/**
 * Setup → Theme: one place for the look of every page and TV screen — colours, line colours, fonts and text size.
 * The page shows the choice at once (preview); Save on top stores it for every login.
 */
const COLOURS = [
  ['primary', 'Primary', 'Buttons, links, chosen tab, headers, TV cards', 800],
  ['accent', 'Accent', 'Dixon red: errors, delete, "now" mark', 600],
  ['data', 'Data', 'Bars, rings and actual values in charts', 500],
  ['sidebar', 'Sidebar', 'Left menu (white text on it)', null],
  ['page', 'Page background', 'Behind the white cards', null],
];
const hexOk = (v) => /^#[0-9A-Fa-f]{6}$/.test(v);

function ColourRow({ k, label, about, anchor, value, onChange }) {
  const sh = anchor ? shadesOf(value, anchor) : null;
  const weak = (k === 'primary' || k === 'sidebar') && contrastWithWhite(value) < 4.5;
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={`${label} colour`}
        className="h-10 w-12 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5" />
      <div className="min-w-[11rem] flex-1">
        <div className="text-fs-14 font-bold text-slate-900">{label}</div>
        <div className="text-fs-12 text-slate-600">{about}</div>
        {weak && <div className="mt-0.5 inline-flex items-center gap-1 text-fs-12 font-semibold text-red-700"><AlertTriangle size={13} /> Too light for white text — choose a darker colour</div>}
      </div>
      <input value={value} maxLength={7} aria-label={`${label} code`} spellCheck={false}
        onChange={(e) => { const v = e.target.value.trim(); if (hexOk(v)) onChange(v.toUpperCase()); }}
        className="w-24 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-fs-13 uppercase" />
      {sh && (
        <div className="flex overflow-hidden rounded-md border border-slate-200" aria-hidden="true" title="Shades used on the pages">
          {SHADES.map((s) => <span key={s} className="h-7 w-4" style={{ background: `rgb(${sh[s]})` }} />)}
        </div>
      )}
    </div>
  );
}

function Stepper({ label, about, value, min, max, step, onChange }) {
  const b = 'h-9 w-9 grid place-items-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-[11rem] flex-1"><div className="text-fs-14 font-bold text-slate-900">{label}</div><div className="text-fs-12 text-slate-600">{about}</div></div>
      <button type="button" className={b} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} aria-label={`${label} smaller`}><Minus size={15} /></button>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="w-40 accent-blue-700" />
      <button type="button" className={b} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} aria-label={`${label} bigger`}><Plus size={15} /></button>
      <span className="w-14 text-right font-mono text-fs-14 font-bold text-slate-900">{value}%</span>
    </div>
  );
}

/** A small page made of the real classes, so the admin sees buttons, tabs, chips, bars and numbers in the chosen look. */
export function ThemeSample({ theme }) {
  const bars = [62, 88, 74, 96, 40];
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-dixon-steel" aria-label="Theme preview">
      <div className="px-4 py-2.5 text-white flex items-center gap-2" style={{ background: 'rgb(var(--sidebar))' }}>
        <span className="h-7 w-7 rounded-md bg-dixon-red" /><span className="font-bold tracking-[0.12em] text-fs-14">DIXON</span>
        <span className="ml-auto text-fs-12 text-slate-300">Sidebar</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-fs-18 font-bold text-slate-900">Card title</div>
            <div className="flex gap-1.5">
              <span className="rounded-lg bg-blue-700 px-2.5 py-1 text-fs-13 font-bold text-white">Day</span>
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-fs-13 font-bold text-slate-700">Month</span>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[['Produced', '1,284', 'text-slate-900'], ['OLE', '78.4%', 'text-sky-700'], ['Stoppage', '42 min', 'text-red-700']].map(([l, v, c]) => (
              <div key={l} className="rounded-lg border border-slate-200 px-2 py-1.5"><div className="text-fs-12 text-slate-600">{l}</div><div className={`font-mono text-fs-20 font-bold ${c}`}>{v}</div></div>
            ))}
          </div>
          <div className="mt-2 flex h-16 items-end gap-1.5" aria-hidden="true">
            {bars.map((h, i) => <span key={i} className={`flex-1 rounded-t ${i === 3 ? 'bg-sky-700' : 'bg-sky-500'}`} style={{ height: `${h}%` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-fs-13">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">Chip</span>
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700">Error</span>
            <a className="font-semibold text-blue-700 underline">Link</a>
            {['1', '2', '3', '4'].map((l) => <span key={l} className="inline-flex items-center gap-1 text-slate-700"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: theme.lines[l] }} />Line {l}</span>)}
          </div>
        </div>
        <div className="rounded-xl p-3 text-white lp-tv-bg">
          <div className="text-fs-12 font-bold text-sky-100">TV card · Today</div>
          <div className="flex items-end gap-2"><span className="font-mono font-extrabold leading-none" style={{ fontSize: 'calc(30px * var(--fs-tv, 1))' }}>837</span>
            <span className="rounded bg-white px-1 font-mono text-fs-13 font-extrabold text-dixon-navy">/488</span></div>
        </div>
      </div>
    </div>
  );
}

export default function ThemeEditor({ theme, onChange, onApplyStandard = null, busy = false }) {
  const put = (patch) => onChange({ ...theme, preset: 'custom', ...patch });   // a colour changed: own colours
  const putKeep = (patch) => onChange({ ...theme, ...patch });                // font / size: the theme keeps its name
  const usePreset = (k) => { const { label, ...p } = THEME_PRESETS[k]; onChange({ ...theme, ...p, preset: k }); };
  const sel = 'block mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-fs-14';
  return (
    <div className="space-y-3">
      {onApplyStandard && (
        // one click: the Dixon OEE Dashboard – UI Design Standard on every page of every screen (saved at once)
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-blue-700 bg-blue-50 px-5 py-4" aria-label="Dixon OEE standard">
          <div className="min-w-0 flex-1">
            <h3 className="text-fs-18 font-bold text-slate-900">Dixon OEE standard — one click</h3>
            
          </div>
          <button type="button" disabled={busy || theme.preset === 'oee'} onClick={onApplyStandard}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 text-fs-15 font-bold text-white hover:bg-blue-800 disabled:opacity-60">
            <Check size={16} />{theme.preset === 'oee' ? 'In use on every page' : 'Apply to the whole software'}
          </button>
        </section>
      )}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <h3 className="text-fs-18 font-bold text-slate-900">Ready themes</h3>
        
        {/* 23-11-2026: every ready theme as a small picture of the screen — menu, header, a chart, the warning colour */}
        <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }} role="radiogroup" aria-label="Ready themes">
          {Object.entries(THEME_PRESETS).map(([k, p]) => {
            const on = theme.preset === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} onClick={() => usePreset(k)} title={p.label}
                className={`overflow-hidden rounded-xl border-2 text-left transition ${on ? 'border-blue-700 shadow-md' : 'border-slate-200 hover:border-slate-400'}`}>
                <span className="flex" aria-hidden style={{ background: p.page, height: 92 }}>
                  <span className="flex w-9 flex-col gap-1.5 px-1.5 pt-2" style={{ background: p.sidebar }}>
                    {[0, 1, 2, 3].map((x) => <span key={x} className="h-1.5 rounded-full" style={{ background: x === 1 ? '#fff' : 'rgba(255,255,255,.35)' }} />)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="h-4 w-full" style={{ background: p.primary }} />
                    <span className="flex flex-1 gap-1.5 p-1.5">
                      <span className="flex flex-1 items-end gap-1 rounded bg-white p-1.5 shadow-sm" style={{ height: 58 }}>
                        {[45, 70, 55, 85, 62].map((h, x) => <span key={x} className="block flex-1 rounded-sm" style={{ height: `${(h / 100) * 46}px`, background: x === 3 ? p.accent : p.data }} />)}
                      </span>
                      <span className="flex w-10 flex-col gap-1" style={{ height: 58 }}>
                        <span className="flex-1 rounded bg-white shadow-sm" style={{ borderTop: `3px solid ${p.primary}` }} />
                        <span className="flex-1 rounded bg-white shadow-sm" style={{ borderTop: `3px solid ${p.accent}` }} />
                      </span>
                    </span>
                  </span>
                </span>
                <span className={`flex items-center justify-between gap-2 px-2.5 py-2 text-fs-13 font-bold ${on ? 'bg-blue-50 text-blue-900' : 'bg-white text-slate-800'}`}>
                  <span className="min-w-0 truncate">{p.label}</span>{on && <Check size={15} className="shrink-0" />}
                </span>
              </button>
            );
          })}
          {theme.preset === 'custom' && <span className="grid place-items-center rounded-xl border-2 border-blue-700 bg-blue-50 px-3 py-2 text-fs-14 font-bold text-blue-900">Own colours (changed below)</span>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <h3 className="text-fs-18 font-bold text-slate-900">Colours</h3>
        <div className="divide-y divide-slate-100">
          {COLOURS.map(([k, l, a, anchor]) => <ColourRow key={k} k={k} label={l} about={a} anchor={anchor} value={theme[k]} onChange={(v) => put({ [k]: v })} />)}
        </div>
        <div className="mt-3 text-fs-14 font-bold text-slate-900">Line colours <span className="font-normal text-fs-12 text-slate-600">— dot and legend of each line in every chart</span></div>
        <div className="mt-2 flex flex-wrap gap-3">
          {['1', '2', '3', '4'].map((l) => (
            <label key={l} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-fs-14 font-semibold text-slate-800">
              <input type="color" value={theme.lines[l]} onChange={(e) => put({ lines: { ...theme.lines, [l]: e.target.value.toUpperCase() } })} aria-label={`Line ${l} colour`}
                className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5" />Line {l}
            </label>
          ))}
          <button type="button" onClick={() => put({ lines: { ...THEME_DEFAULT.lines } })} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-fs-13 font-bold text-slate-700 hover:bg-slate-50">Standard line colours</button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4">
        <h3 className="text-fs-18 font-bold text-slate-900">Fonts and text size</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <label className="text-fs-14 font-semibold text-slate-800">Text font
            <select value={theme.font} onChange={(e) => putKeep({ font: e.target.value })} className={sel}>
              {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </select>
          </label>
          <label className="text-fs-14 font-semibold text-slate-800">Number font
            <select value={theme.mono} onChange={(e) => putKeep({ mono: e.target.value })} className={sel}>
              {Object.entries(MONOS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </select>
          </label>
        </div>
        
        <div className="mt-1 divide-y divide-slate-100">
          <Stepper label="Text size" about="Every page, table and chart label (100% = standard)" value={theme.scale} min={80} max={130} step={5} onChange={(v) => putKeep({ scale: v })} />
          <Stepper label="TV numbers size" about="Big numbers on the TV wall cards" value={theme.tvScale} min={80} max={150} step={5} onChange={(v) => putKeep({ tvScale: v })} />
        </div>
      </section>
    </div>
  );
}
