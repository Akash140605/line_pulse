import React, { useEffect, useState } from 'react';
import { subscribeBusy } from '../api';

/*
 * Loading screens: never an empty white page while data is on its way.
 *  - PageLoader: a card with a small assembly line (cartons riding a belt into a truck) and a moving progress bar.
 *  - GlobalBusyBar: thin bar at the very top while any data request is running (shown after 250 ms, so quick
 *    answers do not flicker). The live polling of the line servers does not count (the cards show their own state).
 */
const CSS = `
.ldr-belt{position:relative;height:46px;overflow:hidden}
.ldr-belt:before{content:"";position:absolute;left:0;right:46px;bottom:8px;height:6px;border-radius:3px;
  background:repeating-linear-gradient(90deg,#94A3B8 0 10px,#CBD5E1 10px 20px);background-size:20px 6px;animation:ldrBelt .6s linear infinite}
.ldr-box{position:absolute;bottom:14px;width:22px;height:18px;border-radius:3px;background:#D6A86B;box-shadow:inset 0 -3px 0 rgba(0,0,0,.15);
  animation:ldrRide 2.4s linear infinite;opacity:0}
.ldr-box:after{content:"";position:absolute;left:9px;top:0;width:4px;height:100%;background:rgba(255,255,255,.45)}
.ldr-box.b2{animation-delay:.8s}.ldr-box.b3{animation-delay:1.6s}
.ldr-truck{position:absolute;right:0;bottom:6px;width:42px;height:30px;border-radius:4px 8px 4px 4px;background:rgb(var(--navy,15 37 84))}
.ldr-truck:after{content:"";position:absolute;left:6px;bottom:-5px;width:9px;height:9px;border-radius:50%;background:#1E293B;box-shadow:22px 0 0 #1E293B}
.ldr-bar{height:6px;border-radius:3px;background:#E2E8F0;overflow:hidden}
.ldr-bar>i{display:block;height:100%;width:35%;border-radius:3px;background:linear-gradient(90deg,#38BDF8,#2563EB,#DC2626);animation:ldrBar 1.3s ease-in-out infinite}
.ldr-dots:after{content:"";animation:ldrDots 1.2s steps(4) infinite}
@keyframes ldrBelt{to{background-position:-20px 0}}
@keyframes ldrRide{0%{left:-24px;opacity:0}8%{opacity:1}88%{opacity:1}100%{left:calc(100% - 52px);opacity:0}}
@keyframes ldrBar{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}
@keyframes ldrDots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
@media (prefers-reduced-motion:reduce){.ldr-belt:before,.ldr-box,.ldr-bar>i,.ldr-dots:after{animation:none}.ldr-box{opacity:1;left:40%}}
`;

const STEPS = ['Connecting to the server', 'Reading the line data', 'Working out OLE, losses and targets', 'Preparing the screen'];

/** Card shown while a page reads its data: a small assembly line, a moving bar and the steps ticked off one by one. */
export function PageLoader({ label = 'Loading', sub = '', className = '', steps = STEPS }) {
  // the steps are ticked as time goes on; the last one stays "in progress" until the data is really there
  const [done, setDone] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDone((d) => Math.min(steps.length - 1, d + 1)), 1100);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div role="status" aria-live="polite" className={`rounded-xl border border-slate-200 bg-white px-5 py-6 shadow-sm ${className}`}>
      <style>{CSS}</style>
      <div className="mx-auto flex max-w-md flex-col gap-3">
        <div className="ldr-belt" aria-hidden><span className="ldr-box" /><span className="ldr-box b2" /><span className="ldr-box b3" /><span className="ldr-truck" /></div>
        <div className="ldr-bar" aria-hidden><i /></div>
        <div className="text-center">
          <div className="text-fs-16 font-extrabold text-slate-900"><span className="ldr-dots">{label}</span></div>
          {sub && <div className="mt-0.5 text-fs-13 font-semibold text-slate-600">{sub}</div>}
        </div>
        <ol className="mx-auto mt-1 flex w-full max-w-xs flex-col gap-1.5" aria-label="Loading steps">
          {steps.map((t, i) => (
            <li key={t} className={`flex items-center gap-2 text-fs-13 font-semibold ${i < done ? 'text-emerald-700' : i === done ? 'text-slate-900' : 'text-slate-400'}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-fs-11 font-extrabold ${i < done ? 'bg-emerald-600 text-white' : i === done ? 'border-2 border-blue-600 border-t-transparent animate-spin' : 'border-2 border-slate-300'}`} aria-hidden>{i < done ? '✓' : ''}</span>
              {t}{i < done ? <span className="sr-only"> — done</span> : i === done ? <span className="sr-only"> — in progress</span> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Thin moving bar at the top of the window while data requests are running. */
export function GlobalBusyBar() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let t = null;
    const off = subscribeBusy((n) => {
      clearTimeout(t);
      if (n > 0) t = setTimeout(() => setBusy(true), 250); else setBusy(false);
    });
    return () => { clearTimeout(t); off(); };
  }, []);
  return (
    <div aria-hidden className={`pointer-events-none fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden transition-opacity duration-300 ${busy ? 'opacity-100' : 'opacity-0'}`}>
      <style>{CSS}</style>
      <div className="ldr-bar h-1 rounded-none bg-transparent"><i /></div>
    </div>
  );
}
