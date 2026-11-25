import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Download, RotateCcw, Play, Pause, Search, X, ZoomIn, ZoomOut, Layers } from 'lucide-react';
import HeaderBar, { segGroup, segBtn, fieldCls } from '../components/HeaderBar';
import { PageLoader } from '../components/Loader';
import { PeriodBar } from '../components/PeriodBar';
import { serverToday } from '../utils/serverTime';
import { nf, dmy, useOleData, useOleLines, groupNameOf } from '../components/OleParts';
import { api } from '../api';
import { setMasterRows, masterAnyFor } from '../utils/targetMethods';
import { buildUniverse, filterUniverse, universeTotals, layoutUniverse, bandOf, CYCLE_BANDS, NO_STD } from '../utils/modelUniverse';
import { buildXlsx, downloadXlsx } from '../utils/xlsxWriter';

/**
 * 3D model view (24-11-2026, admin only): every company as a plate, its models as towers — the height is the pieces
 * made in the period (or the std cycle time), the colour the std cycle band of the Model master (or the company).
 * Drag to turn, wheel / buttons to zoom, hover a tower for its numbers, click it to pin it. The table below lists the same.
 */
const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4';
const MAX_H = 190;          // tallest tower (px)
const CSS = `
.lp3-stage{position:relative;height:clamp(440px,62vh,720px);overflow:hidden;border-radius:14px;cursor:grab;touch-action:none;
  background:radial-gradient(1200px 520px at 50% 0%,#24407a 0%,#14254a 45%,#0b1730 100%)}
.lp3-stage:active{cursor:grabbing}
.lp3-stage:before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.55) 1px,transparent 1px);background-size:3px 3px;opacity:.06;pointer-events:none}
.lp3-cam{position:absolute;left:50%;top:54%;width:0;height:0;perspective:1900px;perspective-origin:50% 30%}
.lp3-world{position:absolute;transform-style:preserve-3d;transition:transform .08s linear}
.lp3-floor{position:absolute;border-radius:18px;background:rgba(148,163,184,.07);box-shadow:0 0 0 1px rgba(148,163,184,.14) inset;
  background-image:linear-gradient(rgba(148,163,184,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.10) 1px,transparent 1px);background-size:40px 40px}
.lp3-plate{position:absolute;transform-style:preserve-3d;border-radius:10px;background:linear-gradient(135deg,rgba(255,255,255,.16),rgba(255,255,255,.05));
  box-shadow:0 0 0 1.5px var(--pc) inset,0 12px 30px rgba(0,0,0,.35)}
.lp3-plate.dim{opacity:.28}
.lp3-plabel{position:absolute;left:10px;right:10px;bottom:6px;display:flex;justify-content:space-between;gap:6px;font:800 13px/1.1 Poppins,system-ui,sans-serif;color:#fff;
  text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:nowrap;overflow:hidden;cursor:pointer}
.lp3-plabel b{overflow:hidden;text-overflow:ellipsis}
.lp3-plabel span{font-family:"IBM Plex Mono",monospace;font-weight:700;opacity:.85}
.lp3-bar{position:absolute;transform-style:preserve-3d;cursor:pointer}
.lp3-bar>i{position:absolute;display:block;backface-visibility:visible}
.lp3-top{inset:0;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.35) inset}
.lp3-bar:hover .lp3-top,.lp3-bar.on .lp3-top{box-shadow:0 0 0 2px #fff inset,0 0 18px #fff}
.lp3-bar.zero>i{opacity:.55}
.lp3-shadow{position:absolute;border-radius:3px;background:rgba(0,0,0,.35);filter:blur(3px)}
.lp3-tip{position:absolute;z-index:5;pointer-events:none;min-width:200px;max-width:280px;border-radius:12px;background:rgba(255,255,255,.97);color:#0f172a;
  padding:10px 12px;box-shadow:0 12px 30px rgba(0,0,0,.35);font:500 13px/1.35 Poppins,system-ui,sans-serif}
.lp3-hud{position:absolute;z-index:4;display:flex;gap:6px;flex-wrap:wrap}
.lp3-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);
  background:rgba(15,23,42,.55);color:#fff;font:600 13px Poppins,system-ui,sans-serif;backdrop-filter:blur(4px)}
.lp3-btn:hover{background:rgba(30,58,138,.8)}
.lp3-btn.on{background:#fff;color:#1F3864}
.lp3-key{position:absolute;z-index:4;left:12px;bottom:12px;display:flex;flex-wrap:wrap;gap:6px 12px;max-width:calc(100% - 24px);padding:7px 10px;border-radius:10px;
  background:rgba(15,23,42,.6);color:#e2e8f0;font:600 12.5px Poppins,system-ui,sans-serif;backdrop-filter:blur(4px)}
.lp3-key i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px}
@media (prefers-reduced-motion:reduce){.lp3-world{transition:none}}
`;

/** one tower: top + four sides, w × w on the floor, h high (sides darker, so the light reads from the top-left) */
function Tower({ b, w, h, color, on, onEnter, onLeave, onPick }) {
  const side = (k) => `linear-gradient(to top, ${shade(color, -0.42 * k)}, ${shade(color, -0.12 * k)})`;
  const hh = Math.max(2, h);
  return (
    <div className={`lp3-bar${on ? ' on' : ''}${b.m.qty ? '' : ' zero'}`} style={{ left: b.x, top: b.y, width: w, height: w }}
      onPointerEnter={onEnter} onPointerLeave={onLeave} onClick={(e) => { e.stopPropagation(); onPick(); }} role="button" aria-label={`${b.m.company} ${b.m.model}`}>
      <i className="lp3-shadow" style={{ inset: -2, transform: 'translateZ(0.5px)' }} />
      {/* +y (front) */}
      <i style={{ left: 0, top: w - hh / 2, width: w, height: hh, background: side(1), transform: `translateZ(${hh / 2}px) rotateX(-90deg)` }} />
      {/* -y (back) */}
      <i style={{ left: 0, top: -hh / 2, width: w, height: hh, background: side(0.7), transform: `translateZ(${hh / 2}px) rotateX(90deg)` }} />
      {/* +x (right) */}
      <i style={{ left: w - hh / 2, top: 0, width: hh, height: w, background: side(1.25).replace('to top', 'to left'), transform: `translateZ(${hh / 2}px) rotateY(90deg)` }} />
      {/* -x (left) */}
      <i style={{ left: -hh / 2, top: 0, width: hh, height: w, background: side(0.55).replace('to top', 'to right'), transform: `translateZ(${hh / 2}px) rotateY(-90deg)` }} />
      <i className="lp3-top" style={{ background: `linear-gradient(135deg, ${shade(color, 0.35)}, ${color})`, transform: `translateZ(${hh}px)` }} />
    </div>
  );
}

/** lighter (k > 0) / darker (k < 0) of a #rrggbb colour */
function shade(hex, k) {
  const n = parseInt(String(hex).slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
}

function Tile({ name, value, sub }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-fs-13 font-bold text-slate-600">{name}</div>
      <div className="mt-1 font-mono text-fs-28 font-extrabold leading-tight tabular-nums text-slate-900">{value}</div>
      {sub && <div className="lp-clamp2 mt-1 text-fs-12 text-slate-600">{sub}</div>}
    </div>
  );
}

const SORTS = { qty: (a, b) => b.qty - a.qty, std: (a, b) => (a.std ?? 1e9) - (b.std ?? 1e9), company: (a, b) => a.company.localeCompare(b.company) || b.qty - a.qty, model: (a, b) => a.model.localeCompare(b.model) };

export default function ModelUniversePage() {
  const ALL = useOleLines();
  const today = serverToday();
  const [range, setRange] = useState({ start: `${today.slice(0, 8)}01`, end: today });
  const [sel, setSel] = useState('all');
  const [company, setCompany] = useState('all');
  const [band, setBand] = useState('all');
  const [q, setQ] = useState('');
  const [height, setHeight] = useState('qty');       // tower height: pieces | std cycle
  const [color, setColor] = useState('cycle');       // colour: cycle band | company
  const [withMaster, setWithMaster] = useState(false);
  const [master, setMaster] = useState(null);
  const [view, setView] = useState({ rx: 58, rz: -32, z: 0.8 });
  const [spin, setSpin] = useState(false);
  const [hover, setHover] = useState(null);
  const [tipAt, setTipAt] = useState({ x: 0, y: 0 });
  const [pin, setPin] = useState(null);
  const [sort, setSort] = useState('qty');
  const stage = useRef(null); const drag = useRef(null); const mouse = useRef({ x: 0, y: 0 });
  const IDS = sel === 'all' ? ALL : [sel];
  const D = useOleData({ start: range.start, end: range.end, ids: ALL, prod: true });

  useEffect(() => {
    let live = true;
    api.modelMaster().then((j) => { if (!live) return; const rows = j?.rows || []; setMasterRows(rows, j?.updatedAt || null); setMaster(rows); }).catch(() => live && setMaster([]));
    return () => { live = false; };
  }, []);

  const all = useMemo(() => (D.al && master ? buildUniverse({ lines: D.al.lines, ids: IDS, masterOf: masterAnyFor, masterRows: master, withMaster }) : null),
    [D.al, master, IDS.join(), withMaster]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (all ? filterUniverse(all, { company, q, band }) : null), [all, company, q, band]);
  const T = useMemo(() => (shown ? universeTotals(shown) : null), [shown]);
  // floor about square: ~√n plates per row (6 companies → 3 a row, 40 → 7)
  const L = useMemo(() => (shown ? layoutUniverse(shown.slice(0, 40), { maxW: Math.max(520, Math.min(1600, 250 * Math.ceil(Math.sqrt(Math.min(40, shown.length))))) }) : null), [shown]);
  const colorOf = useMemo(() => { const m = new Map((all || []).map((c) => [c.name, c.color])); return (x) => (color === 'company' ? m.get(x.company) || '#2563EB' : bandOf(x.std).color); }, [all, color]);
  const maxV = useMemo(() => Math.max(1, ...(shown || []).flatMap((c) => c.models.map((m) => (height === 'qty' ? m.qty : m.std || 0)))), [shown, height]);
  const hOf = (m) => { const v = height === 'qty' ? m.qty : m.std || 0; return v > 0 ? 6 + Math.sqrt(v / maxV) * (MAX_H - 6) : 2; };
  // the towers are drawn once per filter / mode / pin — turning, zooming and hovering only move the camera and the tip
  const enter = useRef((m) => setHover({ m })); const leave = useRef(() => setHover(null)); const pick = useRef((m) => setPin((x) => (x?.key === m.key ? null : m)));
  const scene = useMemo(() => (L ? (
                    L.plates.map((p) => {
                      const c = (all || []).find((x) => x.name === p.c.name);
                      const dim = pin && pin.company !== p.c.name;
                      return (
                        <div key={p.c.name} className={`lp3-plate${dim ? ' dim' : ''}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h, '--pc': c?.color || '#94A3B8' }}>
                          {p.bars.map((b) => (
                            <Tower key={b.m.key} b={b} w={L.size} h={hOf(b.m)} color={colorOf(b.m)} on={pin?.key === b.m.key}
                              onEnter={() => enter.current(b.m)} onLeave={leave.current} onPick={() => pick.current(b.m)} />
                          ))}
                          <div className="lp3-plabel" style={{ transform: 'translateZ(1px)' }} onClick={(e) => { e.stopPropagation(); setCompany((x) => (x === p.c.name ? 'all' : p.c.name)); }}
                            title={`${p.c.name}: ${p.c.models.length} models · ${nf(p.c.qty)} pcs — click to show only this company`}>
                            <b>{p.c.name}</b><span>{nf(p.c.qty)}{p.more > 0 ? ` · +${p.more}` : ''}</span>
                          </div>
                        </div>
                      );
                    })
) : null), [L, all, colorOf, height, maxV, pin]); // eslint-disable-line react-hooks/exhaustive-deps

  // the whole city in the stage: the zoom follows the size of the layout (a filter to one company zooms in)
  useLayoutEffect(() => {
    const W = stage.current?.clientWidth; if (!W || !L?.plates.length) return;
    const z = Math.max(0.35, Math.min(1.6, (W * 0.92) / (Math.max(L.width, L.height * 1.25) + 120)));
    setView((v) => ({ ...v, z: Math.round(z * 100) / 100 }));
  }, [L]);
  // auto turn
  useEffect(() => {
    if (!spin) return undefined;
    const id = setInterval(() => setView((v) => ({ ...v, rz: v.rz + 0.6 })), 40);
    return () => clearInterval(id);
  }, [spin]);
  // the wheel zooms the scene, not the page
  useEffect(() => {
    const el = stage.current; if (!el) return undefined;
    const f = (e) => { e.preventDefault(); setView((v) => ({ ...v, z: Math.min(2.2, Math.max(0.3, v.z * (e.deltaY > 0 ? 0.92 : 1.08))) })); };
    el.addEventListener('wheel', f, { passive: false });
    return () => el.removeEventListener('wheel', f);
  }, [L]);
  const down = (e) => { drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false }; setSpin(false); };
  const move = (e) => {
    const r = stage.current?.getBoundingClientRect(); if (r) mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    const d = drag.current; if (!d) { if (hover) setTipAt({ ...mouse.current }); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView({ ...d.v, rz: d.v.rz + dx * 0.35, rx: Math.min(80, Math.max(15, d.v.rx - dy * 0.25)) });
  };
  const up = () => { drag.current = null; };

  const periodText = range.start === range.end ? dmy(range.start) : `${dmy(range.start)} – ${dmy(range.end)}`;
  const tipM = hover?.m || null;
  const rows = useMemo(() => (shown ? shown.flatMap((c) => c.models).sort(SORTS[sort]) : []), [shown, sort]);
  const excel = () => {
    const head = ['Company', 'Model', 'Model Code', 'Std Cycle (s) — Model Master', 'Actual avg cycle (s)', 'Pieces', 'Line-days', 'Lines', 'Segment', 'Capacity', 'Type'];
    const body = rows.map((m) => [m.company, m.model, m.code, m.std ?? '', m.actual ?? '', m.qty, m.days, m.lines.map((l) => `L${l}`).join(', '), m.segment, m.capacity, m.type]);
    downloadXlsx(buildXlsx([{ name: 'Models', title: `Models ${periodText}`, cols: head.map((h, i) => ({ width: [20, 30, 14, 14, 14, 12, 10, 12, 14, 12, 12][i] })), rows: [head.map((v) => ({ v, s: 'hprHead' })), ...body.map((r) => r.map((v) => ({ v })))] }]),
      `Model_3D_${range.start}_${range.end}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-3" aria-label="3D model view" role="region">
      <style>{CSS}</style>
      <HeaderBar label="3D model view filters">
        <div className={segGroup} role="group" aria-label="Lines">
          {ALL.length > 1 && <button type="button" aria-pressed={sel === 'all'} onClick={() => setSel('all')} className={segBtn(sel === 'all', 'navy')}>{groupNameOf(ALL)}</button>}
          {ALL.map((l) => <button key={l} type="button" aria-pressed={sel === l} onClick={() => setSel(l)} className={segBtn(sel === l, 'navy')}>Line {l}</button>)}
        </div>
        <PeriodBar header today={today} range={range} setRange={setRange} text={periodText} busy={D.loading && !!all} />
        <button type="button" disabled={!rows.length} onClick={excel} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-700 px-2.5 text-fs-13 font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
          <Download size={14} aria-hidden />Excel</button>
      </HeaderBar>

      {D.err && <div role="alert" className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-fs-13 font-semibold text-slate-700">{D.err}</div>}
      {!all ? <PageLoader label="Reading the models" sub={periodText} /> : (
        <>
          {/* second filter row: company, cycle band, search, master models */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Model filters">
            <select className={fieldCls} style={{ minWidth: 190 }} value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company">
              <option value="all">All companies ({all.length})</option>
              {all.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.models.length}</option>)}
            </select>
            <select className={`${fieldCls} sm:hidden`} value={band} onChange={(e) => setBand(e.target.value)} aria-label="Std cycle">
              <option value="all">All cycles</option>
              {[...CYCLE_BANDS, NO_STD].map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            <div className={`${segGroup} hidden sm:flex`} role="group" aria-label="Std cycle">
              <button type="button" aria-pressed={band === 'all'} onClick={() => setBand('all')} className={segBtn(band === 'all', 'navy')}>All cycles</button>
              {[...CYCLE_BANDS, NO_STD].map((b) => (
                <button key={b.id} type="button" aria-pressed={band === b.id} onClick={() => setBand(b.id)} className={segBtn(band === b.id, 'navy')}>
                  <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} aria-hidden />{b.label}</button>
              ))}
            </div>
            <label className="relative inline-flex items-center">
              <Search size={14} className="pointer-events-none absolute left-2 text-slate-500" aria-hidden />
              <input className={fieldCls} style={{ paddingLeft: 26, width: 210 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model, code or company" aria-label="Search" />
              {q && <button type="button" onClick={() => setQ('')} className="absolute right-1.5 text-slate-500 hover:text-slate-900" aria-label="Clear search"><X size={14} /></button>}
            </label>
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-semibold text-slate-700">
              <input type="checkbox" checked={withMaster} onChange={(e) => setWithMaster(e.target.checked)} />Also master models not made
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile name="Companies" value={nf(T.companies)} sub={shown[0] ? `Top: ${shown[0].name} · ${nf(shown[0].qty)} pcs` : '—'} />
            <Tile name="Models" value={nf(T.models)} sub={`${nf(T.ran)} made in the period${withMaster ? ` · ${nf(T.models - T.ran)} from the master only` : ''}`} />
            <Tile name="Pieces" value={nf(T.qty)} sub={`${groupNameOf(IDS)} · ${periodText}`} />
            <Tile name="Std cycle (weighted)" value={T.std != null ? `${T.std} s` : '—'} sub="Model Master, weighted by pieces" />
            <Tile name="No std cycle" value={nf(T.noStd)} sub={T.noStd ? `${nf(T.noStdQty)} pcs made without a master cycle` : 'every model has a cycle time'} />
          </div>

          <section className={card} aria-label="3D view">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">Companies & models in 3D</h3>
              <span className="text-fs-13 text-slate-600">Plate = company · tower = model · drag to turn · wheel to zoom · click a tower</span>
              {shown.length > 40 && <span className="rounded bg-amber-50 px-2 py-0.5 text-fs-12 font-semibold text-amber-800">Showing the top 40 companies — pick a company to see the others</span>}
            </div>
            {!L.plates.length ? <p className="py-10 text-center text-fs-14 text-slate-500">No model matches the filters.</p> : (
              <div ref={stage} className="lp3-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { up(); setHover(null); }}
                onClick={() => { if (!drag.current?.moved) setPin(null); }} role="img" aria-label="3D view of companies and models">
                <div className="lp3-hud" style={{ top: 12, left: 12 }}>
                  <button type="button" className={`lp3-btn${height === 'qty' ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); setHeight('qty'); }}>Height: Pieces</button>
                  <button type="button" className={`lp3-btn${height === 'std' ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); setHeight('std'); }}>Height: Cycle time</button>
                  <button type="button" className={`lp3-btn${color === 'cycle' ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); setColor('cycle'); }}>Colour: Cycle</button>
                  <button type="button" className={`lp3-btn${color === 'company' ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); setColor('company'); }}><Layers size={14} aria-hidden />Company</button>
                </div>
                <div className="lp3-hud" style={{ top: 12, right: 12 }}>
                  <button type="button" className="lp3-btn" onClick={(e) => { e.stopPropagation(); setView((v) => ({ ...v, z: Math.min(2.2, v.z * 1.15) })); }} aria-label="Zoom in"><ZoomIn size={15} /></button>
                  <button type="button" className="lp3-btn" onClick={(e) => { e.stopPropagation(); setView((v) => ({ ...v, z: Math.max(0.3, v.z / 1.15) })); }} aria-label="Zoom out"><ZoomOut size={15} /></button>
                  <button type="button" className={`lp3-btn${spin ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); setSpin((s) => !s); }}>{spin ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}Turn</button>
                  <button type="button" className="lp3-btn" onClick={(e) => { e.stopPropagation(); setView((v) => ({ rx: 58, rz: -32, z: v.z })); setSpin(false); }}><RotateCcw size={14} aria-hidden />Reset</button>
                </div>
                <div className="lp3-cam">
                  <div className="lp3-world" style={{ width: L.width, height: L.height, left: -L.width / 2, top: -L.height / 2, transform: `scale(${view.z}) rotateX(${view.rx}deg) rotateZ(${view.rz}deg)` }}>
                    <div className="lp3-floor" style={{ left: -40, top: -40, width: L.width + 80, height: L.height + 80 }} />
                    {scene}
                  </div>
                </div>
                {tipM && (
                  <div className="lp3-tip" style={{ left: Math.min(tipAt.x + 16, (stage.current?.clientWidth || 600) - 290), top: Math.max(8, Math.min(tipAt.y - 10, (stage.current?.clientHeight || 500) - 200)) }}>
                    <ModelCard m={tipM} />
                  </div>
                )}
                <div className="lp3-key" aria-label="Key">
                  {color === 'cycle'
                    ? [...CYCLE_BANDS, NO_STD].map((b) => <span key={b.id}><i style={{ background: b.color }} />{b.label}</span>)
                    : shown.slice(0, 12).map((c) => <span key={c.name}><i style={{ background: c.color }} />{c.name}</span>)}
                  <span style={{ opacity: 0.8 }}>· height = {height === 'qty' ? 'pieces' : 'std cycle'}</span>
                </div>
              </div>
            )}
            {pin && (
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border-2 border-dixon-navy bg-slate-50 p-3">
                <ModelCard m={pin} big />
                <button type="button" onClick={() => setPin(null)} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-fs-13 font-semibold text-slate-700 hover:bg-slate-100"><X size={14} aria-hidden />Close</button>
              </div>
            )}
          </section>

          <section className={card} aria-label="Models table">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="lp-caps border-l-4 border-dixon-navy pl-2 text-fs-15 font-extrabold tracking-wide text-dixon-navy">All models</h3>
              <span className="text-fs-13 text-slate-600">{nf(rows.length)} models · sort:</span>
              <div className={segGroup} role="group" aria-label="Sort">
                {[['qty', 'Pieces'], ['std', 'Cycle time'], ['company', 'Company'], ['model', 'Model']].map(([k, t]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={segBtn(sort === k, 'navy')}>{t}</button>)}
              </div>
            </div>
            <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-fs-13">
                <thead className="sticky top-0 z-10 bg-dixon-navy text-white">
                  <tr>{['Company', 'Model', 'Std cycle', 'Actual cycle', 'Pieces', 'Lines'].map((h, i) => <th key={h} scope="col" className={`whitespace-nowrap px-2.5 py-2 font-bold ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 800).map((m) => (
                    <tr key={m.key} className={`border-t border-slate-100 hover:bg-sky-50 ${pin?.key === m.key ? 'bg-sky-100' : ''}`} onClick={() => setPin(m)} style={{ cursor: 'pointer' }}>
                      <td className="px-2.5 py-1.5 font-semibold text-slate-800">{m.company}</td>
                      <td className="px-2.5 py-1.5 font-mono text-slate-900" style={{ wordBreak: 'break-word' }}>{m.model}{m.masterOnly && <span className="ml-1.5 rounded bg-slate-100 px-1 text-fs-11 font-sans font-semibold text-slate-600">master only</span>}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono font-bold">
                        {m.std != null ? <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: bandOf(m.std).color }} aria-hidden />{m.std} s</span> : <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono text-slate-700">{m.actual != null ? `${m.actual} s` : '—'}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono font-bold">{nf(m.qty)}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-slate-700">{m.lines.map((l) => `L${l}`).join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 800 && <p className="px-3 py-2 text-fs-12 text-slate-600">First 800 shown — the Excel has all {nf(rows.length)}.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ModelCard({ m, big = false }) {
  const b = bandOf(m.std);
  return (
    <div className="min-w-0">
      <div className="text-fs-12 font-bold uppercase tracking-wide text-slate-500">{m.company}</div>
      <div className={`font-mono font-extrabold text-slate-900 ${big ? 'text-fs-20' : 'text-fs-15'}`} style={{ wordBreak: 'break-word' }}>{m.model}</div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-fs-13">
        <span className="text-slate-500">Std cycle</span>
        <b className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} aria-hidden />{m.std != null ? `${m.std} s` : 'not in master'}</b>
        <span className="text-slate-500">Actual cycle</span><b>{m.actual != null ? `${m.actual} s` : '—'}</b>
        <span className="text-slate-500">Pieces</span><b className="font-mono">{nf(m.qty)}</b>
        <span className="text-slate-500">Lines</span><b>{m.lines.length ? m.lines.map((l) => `Line ${l}`).join(', ') : '—'}</b>
        {m.code && <><span className="text-slate-500">Model code</span><b className="font-mono">{m.code}</b></>}
        {big && m.master && m.master !== m.model && <><span className="text-slate-500">Master name</span><b className="font-mono">{m.master}</b></>}
        {big && (m.segment || m.capacity || m.type) && <><span className="text-slate-500">Segment</span><b>{[m.segment, m.capacity, m.type].filter(Boolean).join(' · ')}</b></>}
      </div>
    </div>
  );
}
