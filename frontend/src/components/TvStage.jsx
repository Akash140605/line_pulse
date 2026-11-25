import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, X, Palette } from 'lucide-react';

/**
 * TV mode: the children fill the whole screen of a big TV.
 * They are laid out at a fixed design width (base) and scaled to fit the screen, so a 1080p or 4K TV shows the same
 * picture, only bigger. Esc or the X closes it; the buttons and cursor hide after 3 s without mouse movement.
 * The screen is kept awake (Wake Lock) where the browser allows it.
 * fill: the children get the whole screen (width = base, height = whatever the screen's shape gives) and must stretch
 * with h-full — no empty bands above and below on any TV.
 */
/**
 * TV colours and text size, chosen on the TV itself (buttons bottom-right; kept in this browser only).
 * A colour set overrides the dark-panel colours of the theme (--navy, --tv-a/-c and the dark primary shades) inside TV mode.
 */
const L = (bg, card, line, a, ink, ink2, acc) => ({ '--tvl-bg': bg, '--tvl-card': card, '--tvl-line': line, '--tvl-a': a, '--tvl-ink': ink, '--tvl-ink2': ink2, '--tvl-acc': acc });
const D = (navy, a, c, b8, b9, b95) => ({ '--navy': navy, '--tv-a': a, '--tv-c': c, '--blue-800': b8, '--blue-900': b9, '--blue-950': b95 });
export const TV_LOOKS = {
  // dark
  navy: { label: 'Navy', swatch: '#0B2545', vars: {} },
  midnight: { label: 'Midnight', swatch: '#0F172A', vars: D('15 23 42', '30 41 59', '2 6 23', '30 41 59', '15 23 42', '2 6 23') },
  dixon: { label: 'Dixon blue', swatch: '#1E1B64', vars: D('30 27 100', '52 47 150', '15 13 58', '52 47 150', '30 27 100', '15 13 58') },
  teal: { label: 'Deep teal', swatch: '#083338', vars: D('8 51 56', '17 94 89', '3 27 30', '17 94 89', '8 51 56', '3 27 30') },
  plum: { label: 'Plum', swatch: '#3B1747', vars: D('59 23 71', '94 43 110', '30 10 38', '94 43 110', '59 23 71', '30 10 38') },
  black: { label: 'High contrast', swatch: '#000000', vars: D('0 0 0', '30 30 34', '0 0 0', '39 39 42', '12 12 14', '0 0 0') },
  // light: white cards, dark ink. MES light = the colours of the MES screens (default)
  mes: { label: 'MES light', light: true, swatch: '#EEF1F5', vars: L('238 241 245', '255 255 255', '203 211 222', '226 232 240', '11 37 69', '71 85 105', '29 78 216') },
  day: { label: 'Day white', light: true, swatch: '#F1F4F8', vars: L('241 244 248', '255 255 255', '214 221 231', '226 233 243', '15 27 45', '51 65 85', '11 70 143') },
  paper: { label: 'Paper', light: true, swatch: '#F5F1EA', vars: L('245 241 234', '255 253 248', '226 218 204', '236 228 214', '41 33 22', '87 74 56', '154 52 18') },
  sky: { label: 'Sky', light: true, swatch: '#E3EEF9', vars: L('227 238 249', '255 255 255', '196 216 238', '206 225 245', '12 38 72', '43 72 107', '2 105 161') },
  mint: { label: 'Mint', light: true, swatch: '#E4F3EC', vars: L('228 243 236', '255 255 255', '196 226 211', '209 236 223', '12 51 38', '45 86 70', '4 120 87') },
  silver: { label: 'Silver', light: true, swatch: '#E8EAEE', vars: L('232 234 238', '250 250 251', '208 212 220', '220 223 229', '24 24 27', '63 63 70', '55 65 81') },
  dixonlight: { label: 'Dixon light', light: true, swatch: '#EEEDF8', vars: L('238 237 248', '255 255 255', '208 205 236', '224 222 245', '30 27 100', '67 63 130', '218 33 40') },
};
export const TV_STYLES = { glass: 'Glass', solid: 'Solid', outline: 'Outline', raised: 'Raised', sharp: 'Sharp corners' };
const TV_SIZES = [0.9, 1, 1.1, 1.2, 1.3];
const LOOK_KEY = 'ems.tv.look.v2';   // v2 (14-11-2026): MES light became the default for every TV
const readLook = () => { try { const v = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}'); return { theme: TV_LOOKS[v.theme] ? v.theme : 'mes', style: TV_STYLES[v.style] ? v.style : 'solid', size: TV_SIZES.includes(v.size) ? v.size : 1 }; } catch { return { theme: 'mes', style: 'solid', size: 1 }; } };

export default function TvStage({ base = 1280, title, onClose, children, fill = false, closeLabel = 'Close' }) {
  const inner = useRef(null);
  const [scale, setScale] = useState(1);
  const [vh, setVh] = useState(() => window.innerHeight);
  const [width, setWidth] = useState(base);   // fill: design width (wider on ultrawide screens, so the height never gets too small)
  const [idle, setIdle] = useState(false);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const [look, setLook] = useState(readLook);
  const putLook = (v) => { setLook(v); try { localStorage.setItem(LOOK_KEY, JSON.stringify(v)); } catch { /* private window */ } };
  const [panel, setPanel] = useState(false);
  useEffect(() => { if (idle) setPanel(false); }, [idle]);
  const sizeBy = (d) => { const i = Math.max(0, Math.min(TV_SIZES.length - 1, TV_SIZES.indexOf(look.size) + d)); putLook({ ...look, size: TV_SIZES[i] }); };
  // text size: the theme's text size × the TV's own choice (every text-fs-N inside follows --fs)
  const baseFs = (() => { try { return Number(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1; } catch { return 1; } })();
  const lookStyle = { ...TV_LOOKS[look.theme].vars, ...(look.size !== 1 ? { '--fs': String(Math.round(baseFs * look.size * 100) / 100) } : {}) };

  // fit: scale so the content fills the width, or the height when it is the tighter side
  useLayoutEffect(() => {
    const fit = () => {
      setVh(window.innerHeight);
      if (fill) {
        const w = Math.max(base, (720 * window.innerWidth) / Math.max(1, window.innerHeight));
        setWidth(w); setScale(Math.max(0.05, window.innerWidth / w) || 1); return;   // a hidden window can report 0 × 0
      }
      const el = inner.current; if (!el) return;
      const h = el.offsetHeight || 1;
      setScale(Math.min(window.innerWidth / base, window.innerHeight / h));
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro && inner.current) ro.observe(inner.current);
    window.addEventListener('resize', fit);
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit); };
  }, [base, fill]);

  // Esc closes; mouse movement shows the controls for 3 s
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), 3000);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000); };
    const key = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) onClose(); };
    const fs = () => setFull(!!document.fullscreenElement);
    window.addEventListener('mousemove', wake); window.addEventListener('keydown', key); document.addEventListener('fullscreenchange', fs);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fs); };
  }, [onClose]);

  // keep the TV from sleeping
  useEffect(() => {
    let lock = null; let gone = false;
    const get = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ } };
    get();
    const vis = () => { if (!gone && document.visibilityState === 'visible') get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { gone = true; document.removeEventListener('visibilitychange', vis); try { lock?.release(); } catch { /* ignore */ } };
  }, []);

  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, []);

  const toggleFull = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* blocked */ }
  };
  const close = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ } onClose(); };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`TV mode — ${title}`} data-tv-look={look.theme} data-tv-style={look.style} data-tv-light={TV_LOOKS[look.theme].light ? '1' : undefined} style={lookStyle} className={`fixed inset-0 z-[200] bg-blue-950 overflow-hidden ${idle ? 'cursor-none' : ''}`}>
      {fill ? (
        <div className="absolute left-0 top-0" style={{ width, height: Math.max(300, (vh || 720) / (scale || 1)), transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div ref={inner} className="h-full p-3">{children}</div>
        </div>
      ) : (
        <div className="absolute left-1/2 top-1/2" style={{ width: base, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center center' }}>
          <div ref={inner} className="p-3">{children}</div>
        </div>
      )}
      {panel && (
        <div role="region" aria-label="TV look" className="absolute bottom-16 right-3 z-10 w-[420px] max-w-[calc(100vw-24px)] rounded-2xl bg-[#0f172aee] p-4 text-[#fff] shadow-2xl ring-1 ring-[#ffffff26] backdrop-blur">
          {[['Dark colours', false], ['Light colours', true]].map(([head, light]) => (
            <div key={head} className="mb-3">
              <div className="mb-1.5 text-fs-13 font-bold text-[#cbd5e1]">{head}</div>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={head}>
                {Object.entries(TV_LOOKS).filter(([, v]) => !!v.light === light).map(([id, v]) => (
                  <button key={id} type="button" role="radio" aria-checked={look.theme === id} onClick={() => putLook({ ...look, theme: id })}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fs-13 font-semibold ${look.theme === id ? 'bg-[#ffffff26] ring-2 ring-[#38bdf8]' : 'bg-[#ffffff0f] hover:bg-[#ffffff1f]'}`}>
                    <i className="h-5 w-5 shrink-0 rounded-md ring-1 ring-[#ffffff4d]" style={{ background: v.swatch }} aria-hidden />{v.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="mb-1.5 text-fs-13 font-bold text-[#cbd5e1]">Card style</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Card style">
            {Object.entries(TV_STYLES).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={look.style === id} onClick={() => putLook({ ...look, style: id })}
                className={`rounded-lg px-3 py-1.5 text-fs-13 font-semibold ${look.style === id ? 'bg-[#38bdf8] text-[#0f172a]' : 'bg-[#ffffff14] hover:bg-[#ffffff26]'}`}>{label}</button>
            ))}
          </div>
          <p className="mt-3 text-fs-12 text-[#94a3b8]">Kept on this TV only. Text size: A− / A+ below.</p>
        </div>
      )}
      <div data-tv-ui className={`absolute right-3 bottom-3 flex gap-2 transition-opacity duration-300 ${idle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <button type="button" onClick={() => setPanel((v) => !v)} aria-expanded={panel} aria-label={`TV look: ${TV_LOOKS[look.theme].label}, ${TV_STYLES[look.style]} (change)`} title="Colours and style of the TV" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/70 px-3 py-2 text-fs-14 font-bold text-[#fff] hover:bg-slate-900/85 backdrop-blur">
          <i className="h-4 w-4 rounded-full ring-2 ring-white/70" style={{ background: TV_LOOKS[look.theme].swatch }} aria-hidden /><Palette size={16} aria-hidden /> {TV_LOOKS[look.theme].label}
        </button>
        <div className="inline-flex overflow-hidden rounded-lg bg-slate-900/70 backdrop-blur" role="group" aria-label="TV text size">
          <button type="button" onClick={() => sizeBy(-1)} disabled={look.size === TV_SIZES[0]} aria-label="Smaller text" className="px-3 py-2 text-fs-14 font-extrabold text-[#fff] hover:bg-white/20 disabled:opacity-40">A−</button>
          <span className="flex items-center border-x border-[#ffffff33] px-2 font-mono text-fs-13 font-bold text-[#fff]">{Math.round(look.size * 100)}%</span>
          <button type="button" onClick={() => sizeBy(1)} disabled={look.size === TV_SIZES[TV_SIZES.length - 1]} aria-label="Bigger text" className="px-3 py-2 text-fs-14 font-extrabold text-[#fff] hover:bg-white/20 disabled:opacity-40">A+</button>
        </div>
        <button type="button" onClick={toggleFull} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/70 px-3 py-2 text-fs-14 font-bold text-[#fff] hover:bg-slate-900/85 backdrop-blur">
          {full ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />} {full ? 'Exit full screen' : 'Full screen'}
        </button>
        <button type="button" onClick={close} aria-label="Close TV mode" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/70 px-3 py-2 text-fs-14 font-bold text-[#fff] hover:bg-slate-900/85 backdrop-blur">
          <X size={16} aria-hidden /> {closeLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Header button that opens TV mode. */
export function TvButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} title="Show on a big TV, full screen" aria-label="TV mode"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-fs-13 font-extrabold text-slate-800 shadow-sm hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">
      <Maximize2 size={13} strokeWidth={2.5} aria-hidden /><span className="hidden min-[1800px]:inline">TV mode</span>
    </button>
  );
}

/** ?tv in the address opens TV mode at once (bookmark for the TV). */
export const tvFromUrl = () => { try { return new URLSearchParams(window.location.search).has('tv'); } catch { return false; } };
