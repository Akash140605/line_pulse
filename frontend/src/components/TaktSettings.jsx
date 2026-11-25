import React, { useState } from 'react';
import MesDrawer from './MesDrawer';
import { X, Timer } from 'lucide-react';
import { DEFAULT_SETTINGS, windowHours, hourShare } from '../utils/analysis';
import { shiftText } from '../utils/shift';

const inp = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-fs-16 font-bold font-mono outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

export default function TaktSettings({ settings, models, onSave, onClose, shift, onOpenShift, onOpenTargets }) {
  const [s, setS] = useState(settings);
  const withShift = shift ? { ...s, shift } : s;
  const avail = Math.round(windowHours(withShift).reduce((a, h) => a + hourShare(withShift, h), 0) * 3600);
  const target = s.taktSec > 0 ? Math.round(avail / s.taktSec) : '';
  const num = (v) => (v === '' ? null : Number(v));
  const setModel = (id, v) => {
    const m = { ...s.models };
    if (v === '' || Number(v) <= 0) delete m[id]; else m[id] = Number(v);
    setS({ ...s, models: m });
  };

  return (
    <MesDrawer title="Takt & working time settings" icon={Timer} onClose={onClose} label="Takt and working time settings" method="center" width={46} canExpand={false}
      footer={<>
          <button onClick={() => setS(DEFAULT_SETTINGS)} className="mr-auto rounded-[2px] px-2 py-1 text-mes-body font-semibold text-[#2E75B6] hover:bg-[#EAF2FB]">Reset</button>
          <button onClick={onClose} className="rounded-[2px] border border-[#BFBFBF] bg-white px-3 py-1 text-mes-body hover:bg-[#DDEBF7]">Cancel</button>
          <button onClick={() => { onSave(s); onClose(); }} className="rounded-[2px] bg-[#2E75B6] px-3 py-1 text-mes-body font-semibold text-white hover:bg-[#1F4E79]">Save</button>
      </>}>
        <div className="p-5 space-y-5 text-fs-14 font-bold text-slate-700">
          <section className="space-y-2">
            <div className="text-fs-13 uppercase tracking-wide text-slate-700">Working time (shared shift of this line)</div>
            {shift ? (
              <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900">
                {shiftText(shift)}
                {onOpenShift && <button type="button" onClick={onOpenShift} className="ml-2 rounded-md border border-blue-600 px-2 py-0.5 text-fs-13 font-extrabold text-blue-800 hover:bg-blue-50">Change shift &amp; lunch</button>}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <label>Start hour<input type="number" min={0} max={23} className={inp} value={s.startHour} onChange={(e) => setS({ ...s, startHour: Number(e.target.value) })} /></label>
                <label>End hour<input type="number" min={1} max={24} className={inp} value={s.endHour} onChange={(e) => setS({ ...s, endHour: Number(e.target.value) })} /></label>
                <label>Lunch hour (exclude)
                  <select className={inp} value={s.lunchHour ?? ''} onChange={(e) => setS({ ...s, lunchHour: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">None</option>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="text-slate-700">Available time: <span className="font-mono text-slate-900">{(avail / 3600).toFixed(1)} hr</span> ({avail} s)</div>
          </section>

          <section className="space-y-2">
            <div className="text-fs-13 uppercase tracking-wide text-slate-600">Takt time = available time ÷ demand</div>
            <div className="grid grid-cols-2 gap-3">
              <label>Takt (seconds / pc)
                <input type="number" min={0} step="0.1" className={inp} value={s.taktSec ?? ''} placeholder="e.g. 45" onChange={(e) => setS({ ...s, taktSec: num(e.target.value) })} />
              </label>
              <label>Target qty / day
                <input type="number" min={0} className={inp} value={target} placeholder="e.g. 800"
                  onChange={(e) => setS({ ...s, taktSec: e.target.value > 0 ? Math.round((avail / Number(e.target.value)) * 10) / 10 : null })} />
              </label>
            </div>
            <div className="text-slate-600">The two fields are linked — changing one updates the other automatically.</div>
          </section>

          {onOpenTargets ? (
            <section className="space-y-2">
              <div className="text-fs-13 uppercase tracking-wide text-slate-700">Model-wise targets</div>
              <div className="text-slate-800">Each model's own target (pieces per hour / cycle) is kept on the server for every screen.
                <button type="button" onClick={onOpenTargets} className="ml-2 rounded-md border border-blue-600 px-2 py-0.5 text-fs-13 font-extrabold text-blue-800 hover:bg-blue-50">Open model targets</button>
              </div>
            </section>
          ) : (
          <section className="space-y-2">
              <div className="text-fs-13 uppercase tracking-wide text-slate-600">Model-wise takt (optional — blank = global takt)</div>
              <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                {(models || []).length === 0 && <div className="p-3 text-slate-600">Models will appear here once they have loaded.</div>}
                {(models || []).map((m) => (
                  <div key={m.mmId} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="font-mono break-words">{m.model}{m.modelCode ? ` (${m.modelCode})` : ''}</span>
                    <input type="number" min={0} step="0.1" placeholder="global" className={`${inp} !w-28`} value={s.models?.[m.mmId] ?? ''} onChange={(e) => setModel(m.mmId, e.target.value)} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

    </MesDrawer>
  );
}
