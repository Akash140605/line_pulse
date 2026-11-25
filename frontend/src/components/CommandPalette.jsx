import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, RefreshCw, Maximize2, Keyboard, Clock3, X, Presentation, Pause, Play, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * 25-11-2026: command palette — Ctrl+K (⌘K) or "/" anywhere: type part of a page's name, ↑ ↓ to choose, Enter to open.
 * Empty box: the pages opened last on this PC. Also: refresh the data, full screen, keyboard shortcuts ("?").
 * Only the pages this login may open are offered (the same list as the sidebar).
 */
const RECENT_KEY = 'ems.recentPages';
export const PALETTE_EVENT = 'ems:palette';
export const SHOW_EVENT = 'ems:review-show';
const SHOW_MS = 20_000;
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => typeof x === 'string'); } catch { return []; } };

/** a forgiving match: every typed letter in order ("ole cal" finds "OLE calendar", "qd" finds "Quality dashboard") */
export function score(label, folder, q) {
  const t = `${label} ${folder}`.toLowerCase(); const n = q.trim().toLowerCase();
  if (!n) return 1;
  if (label.toLowerCase().startsWith(n)) return 100;
  const words = n.split(/\s+/);
  if (words.every((w) => t.includes(w))) return 60 - t.indexOf(words[0]) / 10;
  let i = 0; for (const ch of n.replace(/\s+/g, '')) { i = t.indexOf(ch, i); if (i < 0) return 0; i += 1; }
  return 20 - i / 20;
}

const typing = (e) => { const t = e.target; return t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)); };
const clickRefresh = () => { const b = [...document.querySelectorAll('header button, [role=region] button, main button')].find((x) => /^\s*refresh\s*$/i.test(x.textContent || '') && x.offsetParent); if (b) b.click(); };
const fullScreen = () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch { /* not allowed */ } };

export default function CommandPalette({ pages, page, onChange, folderOf }) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  const input = useRef(null);
  const list = useRef(null);
  const [show, setShow] = useState(null);   // review slideshow: { ids, i, paused, at }

  // the page opened goes to the top of "recent"
  useEffect(() => {
    if (!page) return;
    setRecent((r) => { const n = [page, ...r.filter((x) => x !== page)].slice(0, 6); try { localStorage.setItem(RECENT_KEY, JSON.stringify(n)); } catch { /* blocked */ } return n; });
  }, [page]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setHelp(false); setOpen((v) => !v); return; }
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setHelp(false); setOpen(true); }
      else if (e.key === '?') { e.preventDefault(); setOpen(false); setHelp((v) => !v); }
      else if (e.key === 'Escape') { setOpen(false); setHelp(false); }
    };
    const onOpen = () => { setHelp(false); setOpen(true); };
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(PALETTE_EVENT, onOpen); };
  }, []);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const actions = useMemo(() => [
    { id: 'act:refresh', label: 'Refresh the data', hint: 'Action', icon: RefreshCw, run: clickRefresh },
    { id: 'act:full', label: 'Full screen on / off', hint: 'Action', icon: Maximize2, run: fullScreen },
    { id: 'act:keys', label: 'Keyboard shortcuts', hint: 'Help · ?', icon: Keyboard, run: () => setHelp(true) },
    { id: 'act:show', label: 'Start review slideshow', hint: 'Meeting · 20 s a page', icon: Presentation, run: () => { try { window.dispatchEvent(new Event(SHOW_EVENT)); } catch { /* old browser */ } } },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => {
    const ps = pages.map((p) => ({ ...p, hint: folderOf(p.id), kind: 'page' }));
    if (!q.trim()) {
      const rec = recent.map((id) => ps.find((p) => p.id === id)).filter(Boolean).map((p) => ({ ...p, hint: 'Recent', recent: true }));
      const rest = ps.filter((p) => !recent.includes(p.id));
      return [...rec, ...actions, ...rest];
    }
    return [...ps, ...actions].map((x) => ({ x, s: score(x.label, x.hint || '', q) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).map((r) => r.x);
  }, [pages, recent, q, actions, folderOf]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const go = (it) => {
    if (!it) return;
    setOpen(false);
    if (it.run) it.run(); else onChange(it.id);
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  // 25-11-2026 review slideshow: the main pages of this login one after the other (20 s each), full screen, for a meeting
  const startShow = () => {
    const want = ['oleview', 'kpidash', 'qdash', 'olemonth', 'lossan', 'dash', 'overview'];
    const ids = want.filter((id) => pages.some((p) => p.id === id)).slice(0, 5);
    if (!ids.length) return;
    try { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); } catch { /* not allowed */ }
    setShow({ ids, i: 0, paused: false, at: Date.now() });
    onChange(ids[0]);
  };
  const stopShow = () => { setShow(null); try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* none */ } };
  const showRef = useRef(null); showRef.current = show;
  const step = (d) => { const s = showRef.current; if (!s) return; const i = (s.i + d + s.ids.length) % s.ids.length; onChange(s.ids[i]); setShow({ ...s, i, at: Date.now() }); };
  useEffect(() => {
    if (!show || show.paused) return undefined;
    const t = setTimeout(() => step(1), SHOW_MS - (Date.now() - show.at));
    return () => clearTimeout(t);
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') stopShow();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === ' ') { e.preventDefault(); setShow((s) => s && ({ ...s, paused: !s.paused, at: Date.now() })); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [!!show]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const on = () => startShow(); window.addEventListener(SHOW_EVENT, on); return () => window.removeEventListener(SHOW_EVENT, on); }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {open && (
        <div className="lp-palette-back fixed inset-0 flex items-start justify-center px-3" style={{ zIndex: 2100, paddingTop: '12vh' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Go to a page" data-testid="palette" className="lp-palette w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" style={{ maxWidth: 560 }}>
            <div className="flex items-center gap-2 border-b border-slate-200 px-3">
              <Search size={18} className="shrink-0 text-slate-500" aria-hidden />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Go to a page or an action…" aria-label="Search pages and actions"
                aria-controls="lp-palette-list" aria-activedescendant={items[sel] ? `lp-pal-${items[sel].id}` : undefined} style={{ height: 48 }} className="min-w-0 flex-1 bg-transparent text-fs-16 text-slate-900 outline-none" />
              <kbd className="lp-kbd lp-hide-xs">Esc</kbd>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 sm:hidden"><X size={16} /></button>
            </div>
            <ul ref={list} id="lp-palette-list" role="listbox" aria-label="Pages and actions" className="overflow-y-auto py-1" style={{ maxHeight: 'min(60vh, 420px)' }}>
              {!items.length && <li className="px-4 py-6 text-center text-fs-14 text-slate-500">No page or action called “{q}”.</li>}
              {items.map((it, i) => {
                const Icon = it.recent ? Clock3 : it.icon;
                const on = i === sel;
                return (
                  <li key={it.id} id={`lp-pal-${it.id}`} role="option" aria-selected={on} data-sel={on ? '1' : '0'} onMouseMove={() => setSel(i)} onClick={() => go(it)}
                    style={{ margin: '0 4px' }} className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${on ? 'bg-dixon-navy text-white' : 'text-slate-800'}`}>
                    {Icon && <Icon size={16} className={`shrink-0 ${on ? 'text-white' : 'text-slate-500'}`} aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-fs-14 font-semibold">{it.label}{it.id === page && <span className={`ml-2 text-fs-12 font-normal ${on ? 'text-white/80' : 'text-slate-500'}`}>open now</span>}</span>
                    <span className={`shrink-0 text-fs-12 ${on ? 'text-white/80' : 'text-slate-500'}`}>{it.hint}</span>
                    {on && <CornerDownLeft size={14} className="shrink-0 text-white/80" aria-hidden />}
                  </li>
                );
              })}
            </ul>
            <div className="hidden items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2 text-fs-12 text-slate-600 sm:flex">
              <span><kbd className="lp-kbd">↑</kbd> <kbd className="lp-kbd">↓</kbd> choose</span><span><kbd className="lp-kbd">Enter</kbd> open</span><span><kbd className="lp-kbd">?</kbd> shortcuts</span>
              <span className="ml-auto">{items.length} results</span>
            </div>
          </div>
        </div>
      )}
      {help && (
        <div className="lp-palette-back fixed inset-0 flex items-start justify-center px-3" style={{ zIndex: 2100, paddingTop: '14vh' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shortcuts" className="lp-palette w-full rounded-xl border border-slate-200 bg-white p-4 shadow-2xl" style={{ maxWidth: 420 }}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-fs-16 font-extrabold text-slate-900">Keyboard shortcuts</h2>
              <button type="button" onClick={() => setHelp(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100"><X size={16} /></button></div>
            <dl className="space-y-2 text-fs-14">
              {[[['Ctrl', 'K'], 'Go to a page (also /)'], [['↑', '↓', 'Enter'], 'Choose and open'], [['Esc'], 'Close a window'], [['?'], 'This list']].map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-3"><dt className="text-slate-700">{what}</dt><dd className="flex gap-1">{keys.map((k) => <kbd key={k} className="lp-kbd">{k}</kbd>)}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      )}
      {show && (
        <div role="toolbar" aria-label="Review slideshow" data-testid="show-bar" className="lp-showbar fixed flex items-center gap-1 rounded-full border px-2 py-1.5 text-white shadow-2xl" style={{ background: 'rgba(15, 30, 51, .94)', borderColor: 'rgba(255,255,255,.2)', zIndex: 2050, left: '50%', bottom: 18, transform: 'translateX(-50%)' }}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous page" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"><ChevronLeft size={18} /></button>
          <button type="button" onClick={() => setShow((s) => s && ({ ...s, paused: !s.paused, at: Date.now() }))} aria-label={show.paused ? 'Play' : 'Pause'} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15">{show.paused ? <Play size={16} /> : <Pause size={16} />}</button>
          <button type="button" onClick={() => step(1)} aria-label="Next page" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"><ChevronRight size={18} /></button>
          <span className="px-2 text-fs-13 font-semibold tabular-nums">{show.i + 1} / {show.ids.length} · {pages.find((p) => p.id === show.ids[show.i])?.label}</span>
          <span className="lp-showprog relative block h-1 w-16 overflow-hidden rounded-full bg-white/20" aria-hidden><i key={`${show.i}-${show.at}-${show.paused}`} className={show.paused ? '' : 'lp-showfill'} style={{ animationDuration: `${SHOW_MS - (Date.now() - show.at)}ms` }} /></span>
          <button type="button" onClick={stopShow} aria-label="Stop the slideshow (Esc)" className="ml-1 rounded-full bg-white/15 px-3 py-1.5 text-fs-12 font-bold hover:bg-white/25">Stop · Esc</button>
        </div>
      )}
    </>
  );
}
