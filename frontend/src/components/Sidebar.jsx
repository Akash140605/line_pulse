import React, { useEffect, useState } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';
import DixonLogo, { DixonMark } from './DixonLogo';
import CommandPalette from './CommandPalette';
import { FOLDER_DEFAULT, RETIRED_PAGES } from '../utils/uiSettings';
import { Box, Barcode, Building2, LayoutDashboard, Gauge, Clock, ShieldAlert, Boxes, BarChart3, ListOrdered, TrendingUp, Sigma, ChevronsLeft, ChevronsRight, ChevronDown, ChevronRight, Folder, FolderOpen, Search, LineChart, Timer, Filter, Sparkles, Target, ClipboardList, Settings2, ClipboardCheck, Crosshair, Wrench, LayoutGrid, ShieldCheck, CalendarDays, Database, FileSpreadsheet, Sunrise, PackageX, RotateCcw, CalendarRange, ListChecks, Layers , CalendarClock, GitCompare, Menu, X } from 'lucide-react';

export const PAGES = [
  { id: 'overview', label: 'Plant overview', icon: LayoutDashboard, color: 'text-sky-300' },
  { id: 'dash', label: 'Dashboard', icon: LayoutGrid, color: 'text-sky-300' },
  { id: 'oleview', label: 'Plant Efficiency', icon: Gauge, color: 'text-sky-300' },
  { id: 'adash', label: 'Availability dashboard', icon: Timer, color: 'text-sky-300' },
  { id: 'pdash', label: 'Performance dashboard', icon: TrendingUp, color: 'text-sky-300' },
  { id: 'olea', label: 'Availability', icon: Timer, color: 'text-sky-300' },
  { id: 'olep', label: 'Performance', icon: TrendingUp, color: 'text-sky-300' },
  { id: 'oleq', label: 'OLE quality', icon: ShieldCheck, color: 'text-sky-300' },
  { id: 'olecal', label: 'OLE calendar', icon: CalendarDays, color: 'text-sky-300' },
  { id: 'olemonth', label: 'Monthly OLE', icon: CalendarRange, color: 'text-sky-300' },
  { id: 'oledrill', label: 'OLE drill-down', icon: Layers, color: 'text-sky-300' },
  { id: 'ole', label: 'OLE dashboard', icon: Gauge, color: 'text-sky-300' },
  { id: 'daily', label: 'Morning entry', icon: Sunrise, color: 'text-sky-300' },
  { id: 'lqentry', label: 'Loss & quality', icon: ClipboardList, color: 'text-sky-300' },
  { id: 'kpidash', label: 'KPI dashboard', icon: LayoutGrid, color: 'text-sky-300' },
  { id: 'rcadash', label: 'RCA dashboard', icon: Wrench, color: 'text-sky-300' },
  { id: 'qdash', label: 'Quality dashboard', icon: ClipboardCheck, color: 'text-sky-300' },
  { id: 'rwkdash', label: 'Rework dashboard', icon: RotateCcw, color: 'text-sky-300' },
  { id: 'oleentry', label: 'Loss entry', icon: ClipboardList, color: 'text-sky-300' },
  { id: 'qentry', label: 'Quality entry', icon: ClipboardList, color: 'text-amber-300' },
  { id: 'rca', label: 'RCA Entry', icon: Wrench, color: 'text-sky-300' },
  { id: 'capaday', label: 'Daily CAPA — rework', icon: ClipboardList, color: 'text-amber-300' },
  { id: 'idleday', label: 'Daily CAPA — idle time', icon: ClipboardList, color: 'text-sky-300' },
  { id: 'capatrack', label: 'CAPA tracker', icon: ListChecks, color: 'text-sky-300' },
  { id: 'entrydash', label: 'Entry dashboard', icon: ListChecks, color: 'text-sky-300' },
  { id: 'lossan', label: 'Loss analysis', icon: BarChart3, color: 'text-sky-300' },
  { id: 'rejan', label: 'Rejection analysis', icon: PackageX, color: 'text-sky-300' },
  { id: 'rwkan', label: 'Rework analysis', icon: RotateCcw, color: 'text-sky-300' },
  { id: 'quality', label: 'FPY / RTY yield', icon: ShieldCheck, color: 'text-sky-300' },
  { id: 'master', label: 'Model master', icon: Database, color: 'text-sky-300' },
  { id: 'linetargets', label: 'Line target method', icon: Crosshair, color: 'text-sky-300' },
  { id: 'targetcheck', label: 'Target rule & check', icon: ClipboardCheck, color: 'text-sky-300' },
  { id: 'targets', label: 'Target methods', icon: Target, color: 'text-sky-300' },
  { id: 'methodplan', label: 'Method by date', icon: CalendarClock, color: 'text-sky-300' },
  { id: 'ai', label: 'AI analysis', icon: Sparkles, color: 'text-sky-300' },
  { id: 'analysis', label: 'Cycle time vs takt', icon: Gauge, color: 'text-sky-300' },
  { id: 'distribution', label: 'Cycle time spread', icon: BarChart3, color: 'text-sky-300' },
  { id: 'pareto', label: 'Pareto', icon: ListOrdered, color: 'text-sky-300' },
  { id: 'models', label: 'Model analysis', icon: Boxes, color: 'text-sky-300' },
  { id: 'explorer', label: 'Model explorer', icon: Filter, color: 'text-sky-300' },
  { id: 'universe', label: '3D model view', icon: Box, color: 'text-sky-300' },
  { id: 'capa', label: 'CAPA register', icon: ClipboardCheck, color: 'text-sky-300' },
  { id: 'trends', label: 'Daily trends & SPC', icon: TrendingUp, color: 'text-sky-300' },
  { id: 'control', label: 'Control charts', icon: LineChart, color: 'text-sky-300' },
  { id: 'stdcycle', label: 'Std cycle time', icon: Timer, color: 'text-sky-300' },
  { id: 'hourly', label: 'Hourly analysis', icon: Clock, color: 'text-sky-300' },
  { id: 'rejection', label: 'Rejections', icon: ShieldAlert, color: 'text-sky-300' },
  { id: 'kpientry', label: 'KPI entry', icon: ClipboardCheck, color: 'text-sky-300' },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet, color: 'text-sky-300' },
  { id: 'custprod', label: 'Customer production', icon: Building2, color: 'text-sky-300' },
  { id: 'serials', label: 'Serial & carton', icon: Barcode, color: 'text-sky-300' },
  { id: 'repcmp', label: 'Report compare', icon: GitCompare, color: 'text-sky-300' },
  { id: 'formulas', label: 'Formulas', icon: Sigma, color: 'text-sky-300' },
];

/** Admin only: the screen setup (always the last entry, cannot be hidden). */
export const SETUP_PAGE = { id: 'setup', label: 'Setup', icon: Settings2, color: 'text-sky-300' };

/** Sidebar folders: the admin's (Setup → Menu folders), else the standard ones (as the C8 MES). */
let FOLDERS = FOLDER_DEFAULT;
const groupOf = (id) => FOLDERS.find((f) => f.ids.includes(id))?.name || 'More';
const gi = (id) => { const k = FOLDERS.findIndex((f) => f.ids.includes(id)); return k < 0 ? FOLDERS.length : k; };

/** the sidebar folder of a page label (the header shows it in the page's path) */
export const pathOf = (label) => { const pg = [...PAGES, SETUP_PAGE].find((p) => p.label === label); return pg ? groupOf(pg.id) : ''; };
/** parts of a long page the tree jumps to (as the MES: Overview → Summary · Lines · Trend · Availability · Performance · Quality) */
const SUBS = { oleview: [['ov-summary', 'Summary'], ['ov-lines', 'Lines'], ['ov-trend', 'Trend'], ['ov-availability', 'Availability'], ['ov-performance', 'Performance'], ['ov-quality', 'Quality']] };
// 20-11-2026: the section lands just under the bars that stay on top (title band + filter bar), not hidden behind them
export function stuckHeight(el) {
  const r = el.getBoundingClientRect(); let h = 0;
  for (const x of document.querySelectorAll('header, nav, div, section')) {
    if (x.contains(el)) continue;
    const st = getComputedStyle(x);
    if (st.position !== 'sticky' && st.position !== 'fixed') continue;
    const b = x.getBoundingClientRect();
    if (!b.height || b.height > window.innerHeight * 0.4 || b.right <= r.left || b.left >= r.right) continue;
    const top = st.position === 'fixed' ? b.top : parseFloat(st.top) || 0;
    if (top > 200) continue;
    h = Math.max(h, top + b.height);
  }
  return h;
}
const jump = (id) => {
  const el = document.getElementById(id);
  if (el) { el.style.scrollMarginTop = `${Math.round(stuckHeight(el)) + 10}px`; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  return !!el;
};
const OPEN_KEY = 'ems.side.closed';
// a short name for the phone's bottom bar: "Plant overview" → "Overview", "OLE calendar" → "Calendar", "Plant Efficiency" → "Efficiency"
const short = (label) => { const w = String(label).split(' ').filter(Boolean); const k = w.length > 1 && w[1] !== '&' && /^(OLE|Plant|Line|Loss|Model|Target|Daily|Cycle)$/i.test(w[0]) ? w[1] : w[0]; return k.charAt(0).toUpperCase() + k.slice(1); };

export default function Sidebar({ page, onChange, focusDate, loading, pages: pagesIn = PAGES, brand = null, sections = false, folders = null }) {
  if (folders?.length) FOLDERS = folders;
  // every login: the pages folder by folder (the folder order of the admin), the saved order kept inside a folder
  const pages = pagesIn.filter((p) => !RETIRED_PAGES.has(p.id)).map((p, i) => [p, i]).sort((x, y) => gi(x[0].id) - gi(y[0].id) || x[1] - y[1]).map(([p]) => p);
  const runs = pages.map((p) => groupOf(p.id)).filter((g, i, a) => i === 0 || a[i - 1] !== g);
  const grouped = pages.length > 7 && new Set(runs).size === runs.length;
  const bg = { background: 'rgb(var(--sidebar))' };   // sidebar colour of Setup → Theme (phones' bottom bar)
  const tablet = useMediaQuery('(max-width: 1100px)'); // icons-only on tablets so content keeps its width
  const [collapsed, setCollapsed] = useState(tablet);
  useEffect(() => setCollapsed(tablet), [tablet]);
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(false);   // 25-11-2026: phones — the full menu
  useEffect(() => { setSheet(false); }, [page]);
  // groups the user folded (remembered in this browser); every group is open at first, the open page's group always
  const [closed, setClosed] = useState(() => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'); } catch { return []; } });
  const toggle = (g) => setClosed((c) => { const n = c.includes(g) ? c.filter((x) => x !== g) : [...c, g]; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* blocked */ } return n; });
  // the sections: the groups of a long list, else one "My Pages"
  const secs = [];
  for (const p of pages) { const g = groupOf(p.id);   // 19-11-2026: always the group's name (Overview, OLE & losses …), never "My Pages"
    const sec = secs.find((x) => x.g === g); if (sec) sec.items.push(p); else secs.push({ g, items: [p] }); }
  const needle = q.trim().toLowerCase();
  const found = needle ? pages.filter((p) => p.label.toLowerCase().includes(needle)) : null;

  const tree0 = true;
  // 26-11-2026: inside its folder a page needs no folder word — "Availability dashboard" in AVAILABILITY is "Dashboard"
  // (the whole name stays on hover, in search and in Ctrl+K). A name the admin gave is shown as given.
  const SIDE_NAME = { adash: ['Availability dashboard', 'Dashboard'], pdash: ['Performance dashboard', 'Dashboard'], qdash: ['Quality dashboard', 'Dashboard'],
    targetcheck: ['Target rule & check', 'Target check'], custprod: ['Customer production', 'Customer output'], linetargets: ['Line target method', 'Target method'], rejan: ['Rejection analysis', 'Rejections'] };
  const inFolder = (id, label) => { const x = SIDE_NAME[id]; return x && String(label).toLowerCase() === x[0].toLowerCase() ? x[1] : label; };
  const item = ({ id, label, icon: Icon }, tree = true, folder = false) => {
    const active = page === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        title={label}
        aria-current={active ? 'page' : undefined}
        className={`lp-side-item ${tree ? 'lp-side-leaf' : ''} ${collapsed ? 'justify-center' : ''} relative flex w-full items-center gap-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2E75B6] ${active ? 'is-on' : ''}`}
      >
        <Icon size={15} strokeWidth={2} className="shrink-0" />
        {/* 26-11-2026: a long name on two lines, never cut */}
        {!collapsed && <span className="min-w-0 break-words leading-tight">{folder ? inFolder(id, label) : label}</span>}
      </button>
    );
  };
  // the open page's parts, one level deeper on the tree (a click scrolls the page to that part)
  const subs = (id) => (!collapsed && tree0 && page === id && SUBS[id] ? (
    <div className="lp-side-subs" role="group" aria-label={`Parts of ${pages.find((p) => p.id === id)?.label || id}`}>
      {SUBS[id].map(([a, l]) => <button key={a} type="button" className="lp-side-sub" onClick={() => { try { window.dispatchEvent(new CustomEvent('ems:ov-part', { detail: a })); } catch { /* old browser */ } if (a === 'ov-trend') { if (page !== id) onChange(id); setTimeout(() => jump(a), 1200); setTimeout(() => jump(a), 3500); } else if (!jump(a)) { onChange(id); setTimeout(() => jump(a), 900); } }}>{l}</button>)}
    </div>
  ) : null);

  return (
    <>
      {/* Desktop / tablet sidebar — the C8 MES menu: logo, search, folder groups with a count, pages on a tree line */}
      <aside
        // 26-11-2026: 184 px open — short names in their folder keep every name whole on one line · 25-11-2026 (admin): slimmer — 180 px open, 56 px folded (a long name ends in … and shows whole on hover)
        style={{ width: collapsed ? 56 : 184 }}
        className="lp-side hidden md:flex shrink-0 flex-col sticky top-0 h-screen z-40 transition-all duration-200"
      >
        <div className={`lp-side-logo flex shrink-0 items-center ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
          {collapsed ? <DixonMark /> : (
            <div className="min-w-0 w-full text-center leading-tight">
              <DixonLogo className="mx-auto h-[26px]" />
              <div className="lp-side-tag mt-1 truncate">{[brand?.name && brand.name.trim().toUpperCase() !== 'DIXON' ? brand.name : '', brand?.tagline || 'Line Pulse — EMS'].filter(Boolean).join(' · ')}</div>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="lp-side-search shrink-0 px-2 pt-2 pb-1.5">
            <label className="flex items-center gap-2 rounded-[3px] border border-[#BFBFBF] bg-white px-2.5 py-1.5 focus-within:border-[#2E75B6] focus-within:ring-2 focus-within:ring-[#BDD7EE]">
              <Search size={14} className="shrink-0 text-[#777]" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages" aria-label="Search pages" className="min-w-0 flex-1 bg-transparent text-[13px] text-[#222] outline-none placeholder:text-[#888]" />
            </label>
          </div>
        )}

        <nav aria-label="Pages" className="lp-side-nav flex-1 min-h-0 overflow-y-auto px-2 py-1.5">
          {collapsed ? pages.map((p, i) => (
            <React.Fragment key={p.id}>
              {grouped && i > 0 && groupOf(pages[i - 1].id) !== groupOf(p.id) && <div className="mx-2 my-1 h-px bg-[#E2E7EE]" aria-hidden />}
              {item(p, false)}
            </React.Fragment>
          )) : found ? (
            <div className="lp-side-box">
              {found.length ? found.map((p) => item(p)) : <p className="px-2 py-2 text-[12px] text-[#777]">No page called “{q}”.</p>}
            </div>
          ) : secs.map(({ g, items }) => {
            const hasOn = items.some((p) => p.id === page);
            const open = hasOn || !closed.includes(g);
            // 26-11-2026: a folder with one page (a management login) — no folder to open: its name as a small caption, the page under it
            if (items.length === 1) return (
              <section key={g} className="lp-side-sec lp-side-solo" aria-label={`Pages: ${g}`}>
                <div className="lp-side-cap" aria-hidden>{g}</div>
                {item(items[0], false, true)}{subs(items[0].id)}
              </section>
            );
            return (
              <section key={g} className="lp-side-sec" aria-label={`Pages: ${g}`}>
                <button type="button" onClick={() => !hasOn && toggle(g)} aria-expanded={open} className={`lp-side-group ${open ? 'is-open' : ''}`} aria-label={hasOn ? g : open ? `Fold ${g}` : `Open ${g}`}>
                  <span className="lp-side-folder" aria-hidden>{open ? <FolderOpen size={13} /> : <Folder size={13} />}</span>
                  <span className="lp-side-gname min-w-0 flex-1 text-left" title={g}>{g}</span>
                  <span className="lp-side-count">{items.length}</span>
                  {open ? <ChevronDown size={13} className="shrink-0 text-[#777]" /> : <ChevronRight size={13} className="shrink-0 text-[#777]" />}
                </button>
                {open && <div className="lp-side-box">{items.map((p) => <React.Fragment key={p.id}>{item(p, true, true)}{subs(p.id)}</React.Fragment>)}</div>}
              </section>
            );
          })}
        </nav>

        <div className="lp-side-foot shrink-0">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center gap-2 px-4 py-2 text-[12.5px] font-semibold"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={16} className="mx-auto" /> : <><ChevronsLeft size={16} /> Collapse menu</>}
          </button>
        </div>
      </aside>

      {/* 25-11-2026: Ctrl+K command palette — every page of this login, by name */}
      <CommandPalette pages={pages} page={page} onChange={onChange} folderOf={groupOf} />
      {/* 25-11-2026 phones: a short bottom bar — four pages (the open page always among them) and Menu, which opens every page
          folder by folder with a search (the long scrolling strip of 49 pages is gone) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex pb-[env(safe-area-inset-bottom)] bg-dixon-navy border-t border-t-white/10 text-white" style={bg} aria-label="Pages (phone)">
        {(() => {
          const first = pages.slice(0, 4);
          const cur = pages.find((p) => p.id === page);
          const quick = cur && !first.some((p) => p.id === page) ? [...first.slice(0, 3), cur] : first;
          return quick.map(({ id, label, icon: Icon, color }) => {
            const active = page === id;
            return (
              <button key={id} type="button" title={label} aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => { setSheet(false); onChange(id); }}
                className={`min-w-0 flex-1 flex flex-col items-center gap-0.5 py-2 text-fs-12 font-semibold ${active ? 'bg-white/15' : 'text-slate-300'}`}>
                <Icon size={18} className={active ? color : ''} />
                <span className="w-full truncate px-1 text-center">{short(label)}</span>
              </button>
            );
          });
        })()}
        <button type="button" aria-label="Menu — all pages" aria-expanded={sheet} data-testid="mobile-menu" onClick={() => setSheet((v) => !v)}
          className={`min-w-0 flex-1 flex flex-col items-center gap-0.5 py-2 text-fs-12 font-semibold ${sheet ? 'bg-white/15' : 'text-slate-300'}`}>
          {sheet ? <X size={18} /> : <Menu size={18} />}
          <span>{sheet ? 'Close' : 'Menu'}</span>
        </button>
      </nav>
      {sheet && (
        <div className="md:hidden fixed inset-x-0 top-0 flex flex-col bg-white" style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))', zIndex: 2000 }} role="dialog" aria-label="All pages">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2">
            <label className="flex flex-1 items-center gap-2 rounded-md border border-slate-300 px-2.5 py-2 focus-within:border-[#2E75B6]">
              <Search size={15} className="shrink-0 text-slate-500" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages" aria-label="Search pages" className="min-w-0 flex-1 bg-transparent text-fs-15 outline-none" />
            </label>
            <button type="button" onClick={() => setSheet(false)} aria-label="Close the menu" className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 text-slate-700"><X size={18} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {(found ? [{ g: found.length ? 'Found' : `No page called “${q}”`, items: found }] : secs).map(({ g, items }) => (
              <section key={g} className="mt-3" aria-label={`Pages: ${g}`}>
                <h3 className="lp-caps mb-1.5 text-fs-12 font-extrabold tracking-wide text-slate-500">{g}</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map(({ id, label, icon: Icon }) => {
                    const active = page === id;
                    return (
                      <button key={id} type="button" aria-current={active ? 'page' : undefined} onClick={() => { setSheet(false); setQ(''); onChange(id); }}
                        style={{ minHeight: 44 }} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-fs-14 font-semibold ${active ? 'border-dixon-navy bg-dixon-navy text-white' : 'border-slate-200 bg-slate-50 text-slate-800'}`}>
                        <Icon size={16} className="shrink-0" /><span className="min-w-0 leading-tight">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
