import useMasterRow from '../hooks/useMasterRow';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDate, fs } from '../theme';
import { backupShort } from '../utils/backup';
import { fmtSeconds } from '../api';
import { WEIGHT_SOURCE } from '../config/modelWeights';
import { TARGET_GREY, ACH_GREEN, ACH_ORANGE, ACH_RED, ACH_ORANGE_FROM, NO_CYCLE, achColor, achText } from '../utils/achieve';

/* ───────────── 3D (oblique-projection) helpers ─────────────
   x → right, y → depth (back/up-right), z → up. Front faces are axis-aligned, so text can sit on them. */
const P = (x, y, z) => [x + 0.5 * y, -z - 0.35 * y];
const pts = (a) => a.map((q) => q.join(',')).join(' ');

function Box({ x, y, z = 0, w, d, h, c }) {
  return (
    <g stroke="rgba(2,6,23,.35)" strokeWidth="1" strokeLinejoin="round">
      <polygon fill={c[0]} points={pts([P(x, y, z), P(x + w, y, z), P(x + w, y, z + h), P(x, y, z + h)])} />
      <polygon fill={c[1]} points={pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)])} />
      <polygon fill={c[2]} points={pts([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)])} />
    </g>
  );
}

const BELT_Z = 28;

/** Company (brand) of a model from the master-list item name, e.g. "FA WM T2B2 SAMSUNG WT85C4200GG …" → "SAMSUNG". */
const SKIP = /^(FA|WM|KG|GL|PP|GM|PL|FG|DL|PM|HGL|FGL|GTF|WASHING|MACHINE|TOP|LID|FIX|FIXED|GLASS|HALF|FULL|PLAIN)$/;
function brandOf(model) {
  const m = String(model || '').trim().toUpperCase().replace(/\\/g, '/');
  if (m.length < 4) return '';
  let key = m.split('/')[0];
  let hit = WEIGHT_SOURCE.find(([item]) => item.toUpperCase().includes(key));
  if (!hit && /^[0-9][A-Z0-9]{3}WT/.test(key)) { key = key.slice(4); hit = WEIGHT_SOURCE.find(([item]) => item.toUpperCase().includes(key)); } // "1R82WT80F4560RD"
  if (!hit && /^WT\d/.test(key)) return 'SAMSUNG';
  if (!hit) return '';
  const words = hit[0].toUpperCase().replace(/[()]/g, ' ').split(/\s+/);
  for (const w of words) {
    if (w.includes(key) || SKIP.test(w) || /^T\d/.test(w) || /^P\d$/.test(w) || /\d/.test(w) || w.length < 3) continue;
    return w === 'PANA' ? 'PANASONIC' : w === 'BSH' ? 'BOSCH' : w;
  }
  return '';
}

function useCountUp(value) {
  const [v, setV] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return undefined;
    const a = from.current, b = value, t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900), e = 1 - (1 - p) ** 3;
      const cur = a + (b - a) * e;
      from.current = cur; setV(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return Math.round(v);
}

/* Decorative loops use steps() (a few frames per second) so the drawing is not repainted 60 times a second; only the moving pieces animate smoothly. */
const STYLE = `
@keyframes lpBelt{to{transform:translateX(40px)}}
/* one machine: assembled → poly wrap → thermocol top + bottom → carton (MRP printed) → 3 straps → truck; short stop at each step */
@keyframes lpMove{0%{transform:translate(-30px,0px);opacity:0}3%{opacity:1}8%,12%{transform:translate(0px,0px)}15%,25%{transform:translate(100px,0px)}28%,38%{transform:translate(190px,0px)}41%,53%{transform:translate(280px,0px)}56%,62%{transform:translate(370px,0px)}84%{transform:translate(540px,0px);opacity:1}88%,100%{transform:translate(540px,0px);opacity:0}}
@keyframes lpFork{0%,15%{transform:translate(0,0)}50%,65%{transform:translate(70px,0)}100%{transform:translate(0,0)}}
@keyframes lpLaser{0%,100%{opacity:.85}50%{opacity:.35}}
@keyframes lpScan{0%,7.5%{opacity:0}8%,12%{opacity:1}13%,100%{opacity:0}}
@keyframes lpBack{to{transform:translateX(-140px)}}
@keyframes lpBeltRev{to{transform:translateX(-40px)}}
@keyframes lpWork{0%,100%{transform:rotate(-25deg)}50%{transform:rotate(30deg)}}
@keyframes lpTower{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes lpBare{0%,48%{opacity:1}49%,100%{opacity:0}}
@keyframes lpWrap{0%,15%{opacity:0;transform:scaleY(0)}16%{opacity:1;transform:scaleY(.02)}23%{opacity:1;transform:scaleY(1)}48%{opacity:1;transform:scaleY(1)}49%,100%{opacity:0;transform:scaleY(1)}}
@keyframes lpFoam{0%,28.5%{opacity:0;transform:translateY(8px)}31%,48%{opacity:1;transform:translateY(0)}49%,100%{opacity:0;transform:translateY(0)}}
@keyframes lpCap{0%,31%{opacity:0;transform:translateY(-60px)}31.5%{opacity:1;transform:translateY(-60px)}35%,48%{opacity:1;transform:translateY(0)}49%,100%{opacity:0;transform:translateY(0)}}
@keyframes lpBox{0%,41.5%{opacity:0;transform:translateY(-120px)}42%{opacity:1;transform:translateY(-120px)}48%,100%{opacity:1;transform:translateY(0)}}
@keyframes lpTape{0%,49%{opacity:0}51%,100%{opacity:1}}
@keyframes lpPrint{0%,47.5%{opacity:0}48%,100%{opacity:1}}
@keyframes lpStrapF{0%,56.8%{opacity:0;transform:scaleY(0)}57%{opacity:1;transform:scaleY(.03)}58.6%,100%{opacity:1;transform:scaleY(1)}}
@keyframes lpStrapT{0%,58.4%{opacity:0}58.8%,100%{opacity:1}}
@keyframes lpTag0{0%,7.5%{opacity:0}8%,12%{opacity:1}13%,100%{opacity:0}}
@keyframes lpTag1{0%,15%{opacity:0}16%,25%{opacity:1}26%,100%{opacity:0}}
@keyframes lpTag2{0%,28%{opacity:0}29%,38%{opacity:1}39%,100%{opacity:0}}
@keyframes lpTag3{0%,41%{opacity:0}42%,53%{opacity:1}54%,100%{opacity:0}}
@keyframes lpTag4{0%,56%{opacity:0}57%,62%{opacity:1}63%,100%{opacity:0}}
@keyframes lpTag5{0%,63%{opacity:0}65%,82%{opacity:1}84%,100%{opacity:0}}
@keyframes lpRobot{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(16deg)}}
@keyframes lpElbow{0%,100%{transform:rotate(20deg)}50%{transform:rotate(-18deg)}}
@keyframes lpPuff{0%{transform:translate(0,0) scale(.5);opacity:.0}15%{opacity:.55}100%{transform:translate(18px,-38px) scale(1.8);opacity:0}}
@keyframes lpIdle{0%,100%{transform:translateY(0)}50%{transform:translateY(-.8px)}}
@keyframes lpBeam{0%,100%{opacity:.07}50%{opacity:.13}}
@keyframes lpMark{0%,100%{opacity:.12}50%{opacity:.4}}
@keyframes lpRoll{0%,100%{transform:translateY(0)}50%{transform:translateY(-34px)}}
@keyframes lpSpin{to{transform:rotate(360deg)}}
@keyframes lpPress{0%,100%{transform:translateY(0)}50%{transform:translateY(16px)}}
@keyframes lpBlink{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes lpFloat{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-46px);opacity:0}}
@keyframes lpFlash{0%{opacity:.95}100%{opacity:0}}
@keyframes lpBar{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
@keyframes lpRing{from{stroke-dashoffset:0}to{stroke-dashoffset:100}}
.lp-belt{animation:lpBelt 1.1s steps(6) infinite}
.lp-real{animation:lpMove 30s linear both}
.lp-fork{animation:lpFork 10s steps(50) infinite}
.lp-laser{animation:lpLaser 1s steps(2,end) infinite}
.lp-st-scan{animation:lpScan 30s linear both}
.lp-back{animation:lpBack 9s linear infinite}
.lp-belt-rev{animation:lpBeltRev 2.6s linear infinite}
.lp-tower{animation:lpTower 1s steps(2,end) infinite}
.lp-st-bare{animation:lpBare 30s linear both}
.lp-st-wrap{transform-box:fill-box;transform-origin:bottom;animation:lpWrap 30s linear both}
.lp-st-foam{animation:lpFoam 30s ease-out both}
.lp-st-cap{animation:lpCap 30s cubic-bezier(.3,.7,.4,1) both}
.lp-st-box{animation:lpBox 30s cubic-bezier(.3,.7,.4,1) both}
.lp-st-tape{animation:lpTape 30s linear both}
.lp-st-print{animation:lpPrint 30s linear both}
.lp-st-sf{transform-box:fill-box;transform-origin:bottom;animation:lpStrapF 30s ease-out both}
.lp-st-st{animation:lpStrapT 30s linear both}
.lp-tag0{animation:lpTag0 30s linear both}
.lp-tag1{animation:lpTag1 30s linear both}
.lp-tag2{animation:lpTag2 30s linear both}
.lp-tag3{animation:lpTag3 30s linear both}
.lp-tag4{animation:lpTag4 30s linear both}
.lp-tag5{animation:lpTag5 30s linear both}
.lp-robot{transform-box:view-box;animation:lpRobot 3.2s ease-in-out infinite}
.lp-elbow{transform-box:view-box;animation:lpElbow 3.2s ease-in-out infinite}
.lp-puff{transform-box:fill-box;transform-origin:center;animation:lpPuff 2.4s steps(12) infinite}
.lp-idle{animation:lpIdle 1.1s ease-in-out infinite}
.lp-beam{animation:lpBeam 6s ease-in-out infinite}
.lp-mark{animation:lpMark 2s ease-in-out infinite}
.lp-tvbars .lp-lunchtxt{font-size:17px !important}
.lp-lunchtxt{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%) rotate(-90deg);white-space:nowrap;font-weight:800;letter-spacing:.04em;color:#E2E8F0;text-shadow:0 1px 2px rgba(0,0,0,.6);display:flex;flex-direction:column;align-items:center;line-height:1.05}
.lp-lunchword{text-transform:uppercase;font-weight:900;letter-spacing:.08em}
[data-tv-light] .lp-lunchtxt{color:rgb(var(--tvl-ink, 15 23 42));text-shadow:none}
.lp-inbar{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-90deg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;font-size:10.5px;line-height:1;white-space:nowrap;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.lp-roll{animation:lpRoll 3s ease-in-out infinite}
.lp-spin{transform-box:fill-box;transform-origin:center;animation:lpSpin 2.4s steps(12) infinite}
.lp-press{animation:lpPress 1.6s ease-in-out infinite}
.lp-blink{animation:lpBlink 1.2s steps(2,end) infinite}
.lp-float{animation:lpFloat 2.6s ease-out both}
.lp-flash{animation:lpFlash 1.1s ease-out both}
.lp-eq{transform-box:fill-box;transform-origin:bottom;animation:lpBar 1.1s steps(5) infinite}
.lp-paused *{animation-play-state:paused !important}
@media (prefers-reduced-motion: reduce){.lp-scene *{animation:none !important}}
.lp-tvbars .text-\\[11px\\],.lp-tvbars .text-\\[12px\\],.lp-tvbars .text-\\[13px\\]{font-size:21px !important;line-height:1.25 !important}
.lp-tvbars .text-\\[10px\\]{font-size:17px !important;line-height:1.1 !important}
.lp-legend-sm>span:last-child{display:none}
.lp-roll{animation:lpRoll linear infinite}
.lp-roll:hover{animation-play-state:paused}
@keyframes lpRoll{from{transform:translateY(0)}to{transform:translateY(calc(-50% - 1.5px))}}
@media (prefers-reduced-motion:reduce){.lp-roll{animation:none}}
.lp-curbar{box-shadow:0 0 0 3px rgba(255,255,255,.85),0 0 18px rgba(255,255,255,.45);animation:lpCur 1.6s ease-in-out infinite}
.lp-fit,.lp-fit *{transition:none !important}
@keyframes lpCur{50%{box-shadow:0 0 0 3px rgba(255,255,255,.35),0 0 6px rgba(255,255,255,.2)}}
`;

/** Top-load washing machine (white body, smoked-glass lid, control panel with knobs and display). */
function WashingMachine({ uid, x = 185, y = 22, z = BELT_Z, brand = '', model = '' }) {
  const W = 50, D = 46, H = 56, PD = 12, PH = 10;
  const top = z + H;
  const lid = [P(x + 4, y + 3, top + 0.5), P(x + W - 4, y + 3, top + 0.5), P(x + W - 4, y + D - PD - 2, top + 0.5), P(x + 4, y + D - PD - 2, top + 0.5)];
  const shine = [P(x + 8, y + 5, top + 0.6), P(x + 20, y + 5, top + 0.6), P(x + 30, y + D - PD - 4, top + 0.6), P(x + 18, y + D - PD - 4, top + 0.6)];
  const [k1x, k1y] = P(x + 9, y + D - PD, top + 5);
  const [k2x, k2y] = P(x + W - 9, y + D - PD, top + 5);
  const [dx, dy] = P(x + 18, y + D - PD, top + 8);
  const [bx, by] = P(x + 15, y, z + 40);
  return (
    <g>
      <ellipse cx={P(x + W / 2, y + D / 2, z)[0]} cy={P(x + W / 2, y + D / 2, z)[1] + 2} rx="34" ry="8" fill="rgba(2,6,23,.45)" />
      <Box x={x} y={y} z={z} w={W} d={D} h={4} c={['#475569', '#64748B', '#334155']} />
      <Box x={x} y={y} z={z + 4} w={W} d={D} h={H - 4} c={[`url(#${uid}WmFront)`, '#F8FAFC', `url(#${uid}WmSide)`]} />
      <polygon points={pts(lid)} fill={`url(#${uid}Lid)`} stroke="#0F172A" strokeWidth="1" />
      <polygon points={pts(shine)} fill="rgba(255,255,255,.28)" />
      <Box x={x} y={y + D - PD} z={top} w={W} d={PD} h={PH} c={['#E2E8F0', '#F1F5F9', '#CBD5E1']} />
      <rect x={dx} y={dy - 5} width="13" height="5" rx="1" fill="#0EA5E9" />
      <circle cx={k1x} cy={k1y} r="3.2" fill="#94A3B8" stroke="#475569" strokeWidth="1" />
      <circle cx={k2x} cy={k2y} r="3.2" fill="#94A3B8" stroke="#475569" strokeWidth="1" />
      {brand ? (
        <text x={P(x + W / 2, y, z + 42)[0]} y={P(x + W / 2, y, z + 42)[1]} textAnchor="middle" fontSize="9.5" fontWeight="900" fill="#0B2A6F" fontFamily="Arial, sans-serif"
          {...(brand.length > 7 ? { textLength: W - 6, lengthAdjust: 'spacingAndGlyphs' } : {})}>{brand}</text>
      ) : <rect x={bx} y={by} width="20" height="4" rx="1" fill="#1D4ED8" opacity=".85" />}
      {model && (
        <text x={P(x + W / 2, y, z + 33)[0]} y={P(x + W / 2, y, z + 33)[1]} textAnchor="middle" fontSize="7" fontWeight="900" fill="#111827" fontFamily="Arial, sans-serif"
          {...(model.length > 9 ? { textLength: W - 6, lengthAdjust: 'spacingAndGlyphs' } : {})}>{model.slice(0, 16)}</text>
      )}
    </g>
  );
}

/** Clear poly film around the machine (after the POLY WRAP station). */
function PolyWrap({ x = 182, y = 19, z = BELT_Z }) {
  const W = 56, D = 52, H = 70;
  const c = ['rgba(186,230,253,.38)', 'rgba(224,242,254,.45)', 'rgba(125,211,252,.32)'];
  const [a1, a2] = [P(x + 6, y, z + 8), P(x + 30, y, z + H - 6)];
  const [b1, b2] = [P(x + 22, y, z + 4), P(x + 46, y, z + H - 14)];
  return (
    <g>
      <g stroke="rgba(255,255,255,.7)" strokeWidth="1.2" strokeLinejoin="round">
        <polygon fill={c[0]} points={pts([P(x, y, z), P(x + W, y, z), P(x + W, y, z + H), P(x, y, z + H)])} />
        <polygon fill={c[1]} points={pts([P(x, y, z + H), P(x + W, y, z + H), P(x + W, y + D, z + H), P(x, y + D, z + H)])} />
        <polygon fill={c[2]} points={pts([P(x + W, y, z), P(x + W, y + D, z), P(x + W, y + D, z + H), P(x + W, y, z + H)])} />
      </g>
      <line x1={a1[0]} y1={a1[1]} x2={a2[0]} y2={a2[1]} stroke="rgba(255,255,255,.75)" strokeWidth="2" strokeLinecap="round" />
      <line x1={b1[0]} y1={b1[1]} x2={b2[0]} y2={b2[1]} stroke="rgba(255,255,255,.45)" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

/** Thermocol (EPS) protection: bottom tray, then a top cap that comes down. */
const FOAM = ['#F8FAFC', '#FFFFFF', '#CBD5E1'];
function Thermocol({ x = 185, y = 22, z = BELT_Z, sideStyle, capStyle }) {
  const W = 50, D = 46;
  const dots = [];
  for (let i = 0; i < 6; i++) { const [dx, dy] = P(x + 2 + i * 9, y - 3, z + 63); dots.push(<circle key={i} cx={dx} cy={dy} r=".9" fill="#94A3B8" />); }
  return (
    <>
      <g className="lp-st-foam" style={sideStyle}>
        <Box x={x - 3} y={y - 3} z={z} w={W + 6} d={D + 6} h={10} c={FOAM} />
      </g>
      <g className="lp-st-cap" style={capStyle}>
        <Box x={x - 3} y={y - 3} z={z + 58} w={W + 6} d={D + 6} h={12} c={FOAM} />
        {dots}
      </g>
    </>
  );
}

/** Corrugated shipping carton with tape, print and hand holes (after the PACKING station). */
function Carton({ uid, x = 181, y = 18, z = BELT_Z, tapeStyle, brand, model }) {
  const W = 58, D = 54, H = 72;
  const tape = [P(x + W / 2 - 5, y, z + H + 0.3), P(x + W / 2 + 5, y, z + H + 0.3), P(x + W / 2 + 5, y + D, z + H + 0.3), P(x + W / 2 - 5, y + D, z + H + 0.3)];
  const [lx, ly] = P(x + 6, y, z + H - 19);
  const [mx, my] = P(x + 6, y, z + H - 28);
  const brandText = String(brand || '').trim().toUpperCase().slice(0, 14);
  const modelText = String(model || '').trim().toUpperCase().slice(0, 16);
  const [ix, iy] = P(x + 6, y, z + 22);
  const hole = (hx) => { const [cx, cy] = P(hx, y, z + H - 8); return <rect key={hx} x={cx - 6} y={cy - 2.5} width="12" height="5" rx="2.5" fill="#78350F" opacity=".7" />; };
  return (
    <g>
      <ellipse cx={P(x + W / 2, y + D / 2, z)[0]} cy={P(x + W / 2, y + D / 2, z)[1] + 2} rx="38" ry="9" fill="rgba(2,6,23,.45)" />
      <Box x={x} y={y} z={z} w={W} d={D} h={H} c={[`url(#${uid}Kraft)`, '#E7C38F', '#B9874E']} />
      <polygon className="lp-st-tape" style={tapeStyle} points={pts(tape)} fill="#D6A76A" stroke="rgba(120,53,15,.35)" strokeWidth=".8" />
      {/* washing-machine pictogram */}
      <g transform={`translate(${ix},${iy})`} stroke="#7C2D12" strokeWidth="1.3" fill="none">
        <rect x="0" y="-16" width="14" height="16" rx="1.5" />
        <line x1="0" y1="-12" x2="14" y2="-12" />
        <circle cx="7" cy="-6" r="3.2" />
      </g>
      {[x + 14, x + W - 14].map(hole)}
      <MrpLabel x={x} y={y} z={z} />
    </g>
  );
}

/** White print panel with company + model, drawn over the straps so it always stays readable. */
function CartonPrint({ x = 181, y = 18, z = BELT_Z, brand, model }) {
  const W = 58, H = 72;
  const brandText = String(brand || '').trim().toUpperCase().slice(0, 14);
  const modelText = String(model || '').trim().toUpperCase().slice(0, 16);
  return (
    <g>
      {/* company and model printed on a white panel of the carton, e.g. SAMSUNG / WT85C4200GG */}
      {(brandText || modelText) && (() => {
        const [px0, py0] = P(x + 3, y, z + H - 12);
        const pw = W - 6, ph = 24;
        return (
          <g>
            <rect x={px0} y={py0} width={pw} height={ph} rx="2" fill="#FFFFFF" stroke="#7C2D12" strokeWidth=".8" />
            {brandText && (
              <text x={px0 + pw / 2} y={py0 + 10.5} textAnchor="middle" fontSize="10.5" fontWeight="900" fill="#0B2A6F" fontFamily="Arial, sans-serif"
                {...(brandText.length > 8 ? { textLength: pw - 4, lengthAdjust: 'spacingAndGlyphs' } : {})}>{brandText}</text>
            )}
            {modelText && (
              <text x={px0 + pw / 2} y={py0 + 20} textAnchor="middle" fontSize="8" fontWeight="900" fill="#111827" fontFamily="Arial, sans-serif"
                {...(modelText.length > 9 ? { textLength: pw - 4, lengthAdjust: 'spacingAndGlyphs' } : {})}>{modelText}</text>
            )}
          </g>
        );
      })()}
    </g>
  );
}

/** Three PP straps: they rise together from below and then close over the top of the carton. */
function Straps({ x = 181, y = 18, z = BELT_Z, style }) {
  const W = 58, D = 54, H = 72, bw = 5;
  const band = (bx) => [
    [P(bx, y, z), P(bx + bw, y, z), P(bx + bw, y, z + H), P(bx, y, z + H)],
    [P(bx, y, z + H), P(bx + bw, y, z + H), P(bx + bw, y + D, z + H + 0.6), P(bx, y + D, z + H + 0.6)],
  ];
  // All three straps rise together from under the belt, then close over the top.
  const xs = [x + 3, x + W / 2 - 2, x + W - 7];
  return (
    <>
      <g className="lp-st-sf" style={{ opacity: 0, ...style }}>
        {xs.map((bx) => <polygon key={bx} points={pts(band(bx)[0])} fill="#1D4ED8" stroke="#BFDBFE" strokeWidth=".8" strokeLinejoin="round" />)}
      </g>
      <g className="lp-st-st" style={{ opacity: 0, ...style }}>
        {xs.map((bx) => <polygon key={bx} points={pts(band(bx)[1])} fill="#1D4ED8" stroke="#BFDBFE" strokeWidth=".8" strokeLinejoin="round" />)}
      </g>
    </>
  );
}

/** MRP label printed on the carton (comes with the carton). */
function MrpLabel({ x = 181, y = 18, z = BELT_Z }) {
  const [lx, ly] = P(x + 24, y, z + 28);
  return (
    <g>
      <rect x={lx} y={ly} width="20" height="20" rx="1.5" fill="#FFFFFF" stroke="#334155" strokeWidth=".8" />
      <text x={lx + 2} y={ly + 7} fontSize="5.5" fontWeight="900" fill="#0F172A" fontFamily="Arial, sans-serif">MRP ₹</text>
      {[10, 13, 16].map((dy) => <line key={dy} x1={lx + 2} y1={ly + dy} x2={lx + 18} y2={ly + dy} stroke="#64748B" strokeWidth=".8" />)}
    </g>
  );
}

/** Container truck: silver trailer with ribs and brand, blue cab with glass, lights, dual wheels. */
function Truck({ uid, loaded, active }) {
  const TX = 696, TW = 116, TD = 98, TZ = 22, TH = 84;
  const ribs = [];
  for (let x = TX + 8; x < TX + TW; x += 12) ribs.push(<line key={x} x1={P(x, -4, TZ + 2)[0]} y1={P(x, -4, TZ + 2)[1]} x2={P(x, -4, TZ + TH - 2)[0]} y2={P(x, -4, TZ + TH - 2)[1]} stroke="rgba(100,116,139,.45)" strokeWidth="1" />);
  const wheel = (x, key) => {
    const [wx, wy] = P(x, -4, 11);
    return (
      <g key={key}>
        <circle cx={wx} cy={wy} r="13" fill="#0B1220" stroke="#1F2937" strokeWidth="2" />
        <circle cx={wx} cy={wy} r="7" fill={`url(#${uid}Rim)`} stroke="#475569" strokeWidth="1" />
        <circle cx={wx} cy={wy} r="2" fill="#1F2937" />
      </g>
    );
  };
  const CX = 816, CW = 52, CD = 86, CZ = 14, CH = 68;
  const ws = [P(CX + CW, 10, CZ + 40), P(CX + CW, CD - 2, CZ + 40), P(CX + CW - 6, CD - 2, CZ + CH - 4), P(CX + CW - 6, 10, CZ + CH - 4)];
  const sideWin = [P(CX + 14, 4, CZ + 38), P(CX + CW - 6, 4, CZ + 38), P(CX + CW - 10, 4, CZ + CH - 6), P(CX + 14, 4, CZ + CH - 6)];
  const grille = [];
  for (let i = 0; i < 4; i++) grille.push(<polygon key={i} points={pts([P(CX + CW, 22, CZ + 10 + i * 6), P(CX + CW, CD - 14, CZ + 10 + i * 6), P(CX + CW, CD - 14, CZ + 13 + i * 6), P(CX + CW, 22, CZ + 13 + i * 6)])} fill="#0F172A" opacity=".7" />);
  const [lx1, ly1] = P(CX + CW, 12, CZ + 16);
  const [lx2, ly2] = P(CX + CW, CD - 6, CZ + 16);
  const [tlx, tly] = P(TX + 3, -4, TZ + 8);
  return (
    <g>
      <ellipse cx={P(790, 45, 0)[0]} cy={P(790, 45, 0)[1] + 4} rx="150" ry="16" fill="rgba(2,6,23,.55)" />
      {/* loading ramp from the belt */}
      <Box x={684} y={6} z={BELT_Z - 2} w={14} d={78} h={4} c={['#475569', '#94A3B8', '#334155']} />
      {/* chassis */}
      <Box x={TX} y={8} z={8} w={CX + CW - TX + 4} d={74} h={12} c={['#111827', '#1F2937', '#0B1220']} />
      {/* trailer */}
      <Box x={TX} y={-4} z={TZ} w={TW} d={TD} h={TH} c={[`url(#${uid}Steel)`, '#F1F5F9', '#94A3B8']} />
      {ribs}
      <Box x={TX} y={-4} z={TZ + TH} w={TW} d={TD} h={3} c={['#CBD5E1', '#E2E8F0', '#94A3B8']} />
      {/* LOADED counter board (today's pieces) */}
      {loaded != null && (() => { const [bx2, by2] = P(TX + 30, -4, TZ + 70); return (
        <g>
          <rect x={bx2} y={by2} width="56" height="24" rx="3" fill="#0B1220" stroke="#475569" />
          <text x={bx2 + 28} y={by2 + 9} textAnchor="middle" fontSize="6.5" fontWeight="800" fill="#94A3B8" fontFamily="Arial, sans-serif">LOADED TODAY</text>
          <text x={bx2 + 28} y={by2 + 20.5} textAnchor="middle" fontSize="11" fontWeight="900" fill="#FBBF24" fontFamily="ui-monospace, monospace">{loaded}</text>
        </g>); })()}
      {/* plain trailer: two colour stripes, no company name */}
      <polygon points={pts([P(TX, -4, TZ + 30), P(TX + TW, -4, TZ + 30), P(TX + TW, -4, TZ + 36), P(TX, -4, TZ + 36)])} fill="#2563EB" opacity=".85" />
      <polygon points={pts([P(TX, -4, TZ + 24), P(TX + TW, -4, TZ + 24), P(TX + TW, -4, TZ + 27), P(TX, -4, TZ + 27)])} fill="#F59E0B" opacity=".9" />
      <rect x={tlx} y={tly - 6} width="5" height="6" rx="1" fill="#EF4444" />
      {/* cab */}
      <Box x={CX - 6} y={20} z={CZ + 20} w={6} d={50} h={46} c={['#1F2937', '#374151', '#111827']} />
      <Box x={CX} y={4} z={CZ} w={CW} d={CD} h={CH} c={[`url(#${uid}Cab)`, '#60A5FA', '#1E40AF']} />
      <Box x={CX + 4} y={10} z={CZ + CH} w={CW - 14} d={CD - 12} h={10} c={['#2563EB', '#93C5FD', '#1D4ED8']} />
      <polygon points={pts(ws)} fill={`url(#${uid}Glass)`} stroke="#0F172A" strokeWidth="1" />
      <polygon points={pts(sideWin)} fill={`url(#${uid}Glass)`} stroke="#0F172A" strokeWidth="1" />
      <line x1={P(CX + 12, 4, CZ + 4)[0]} y1={P(CX + 12, 4, CZ + 4)[1]} x2={P(CX + 12, 4, CZ + CH - 6)[0]} y2={P(CX + 12, 4, CZ + CH - 6)[1]} stroke="rgba(15,23,42,.45)" />
      {grille}
      <circle cx={lx1} cy={ly1} r="3.5" fill="#FDE68A" stroke="#B45309" />
      <circle cx={lx2} cy={ly2} r="3.5" fill="#FDE68A" stroke="#B45309" />
      <Box x={CX + CW} y={2} z={CZ - 2} w={5} d={CD + 4} h={10} c={['#9CA3AF', '#D1D5DB', '#6B7280']} />
      <Box x={CX + 20} y={-2} z={CZ + 50} w={3} d={4} h={12} c={['#111827', '#374151', '#111827']} />
      {/* exhaust smoke while the line runs */}
      {active && [0, 0.8, 1.6].map((dl) => { const [ex, ey] = P(CX + 21, 0, CZ + 64); return <circle key={dl} className="lp-puff" cx={ex} cy={ey} r="4" fill="#CBD5E1" style={{ animationDelay: `${dl}s` }} />; })}
      {/* wheels: dual axle under the trailer, one under the cab */}
      {[TX + 22, TX + 50, CX + 28].map((x, i) => wheel(x, i))}
    </g>
  );
}

/**
 * 20-11-2026: a model code may wrap only after "/", "\\", "-" or "(" (or at a space): "WTT85DBLG/" + "FLRB5", never
 * "WTT85DBLG/FLR" + "B5". Used with break-words (a code with no such place still wraps rather than overflow).
 */
export function wrapCode(name) {
  const s = String(name ?? '');
  const parts = s.split(/(?<=[/\\(-])/);
  return parts.length < 2 ? s : parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <wbr />}{p}</React.Fragment>);
}

function Scene({ uid, compact, active, lite = false, hourQty, cartons, flashKey, deltaN, onDone, model, company, loaded }) {
  const beltTop = [P(170, 0, BELT_Z), P(690, 0, BELT_Z), P(690, 90, BELT_Z), P(170, 90, BELT_Z)];
  const stripes = [];
  for (let x = 130; x < 700; x += 40) {
    stripes.push(<polygon key={x} fill="rgba(148,163,184,.28)" points={pts([P(x, 0, BELT_Z), P(x + 12, 0, BELT_Z), P(x + 12, 90, BELT_Z), P(x, 90, BELT_Z)])} />);
  }
  const [scanX, scanY] = P(210, -6, BELT_Z + 112);
  const [fx, fy] = P(188, 30, 104);
  const name = String(model || '').trim();
  const brand = String(company || brandOf(name) || '').trim().toUpperCase();
  const TAGS = [['SCANNED ✓', '#86EFAC', 'lp-tag0'], ['WRAPPING', '#67E8F9', 'lp-tag1'], ['THERMOCOL', '#F1F5F9', 'lp-tag2'], ['PACKING', '#FCD34D', 'lp-tag3'], ['STRAPPING', '#93C5FD', 'lp-tag4'], ['TO TRUCK', '#86EFAC', 'lp-tag5']];
  const [tagX, tagY] = P(210, 18, BELT_Z + 112);
  // One piece = one scanned machine. It stops at each step and the step is shown happening:
  // it enters the packing line and is scanned → film wraps up → thermocol tray, corners and cap → carton comes down and is taped → three straps → truck.
  const prod = (key, delay) => {
    const d = { animationDelay: `${delay}s` };
    return (
      <g key={key} className="lp-real" style={{ opacity: 0, ...d }}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) onDone?.(key); }}>
        <g className="lp-st-bare" style={d}><WashingMachine uid={uid} brand={brand} model={name.toUpperCase()} /></g>
        <g className="lp-st-scan" style={{ opacity: 0, ...d }}>
          <polygon points={`${scanX},${scanY} ${P(186, 22, BELT_Z + 20)[0]},${P(186, 22, BELT_Z + 20)[1]} ${P(234, 22, BELT_Z + 20)[0]},${P(234, 22, BELT_Z + 20)[1]}`} fill="#EF4444" opacity=".28" />
          <line x1={P(186, 22, BELT_Z + 20)[0]} y1={P(186, 22, BELT_Z + 20)[1]} x2={P(234, 22, BELT_Z + 20)[0]} y2={P(234, 22, BELT_Z + 20)[1]} stroke="#F87171" strokeWidth="2.5" />
        </g>
        <g className="lp-st-wrap" style={{ opacity: 0, ...d }}><PolyWrap /></g>
        <Thermocol sideStyle={{ opacity: 0, ...d }} capStyle={{ opacity: 0, ...d }} />
        <g className="lp-st-box" style={{ opacity: 0, ...d }}>
          <Carton uid={uid} tapeStyle={{ opacity: 0, ...d }} />
          <Straps style={d} />
          <g className="lp-st-print" style={{ opacity: 0, ...d }}><CartonPrint brand={brand} model={name} /></g>
        </g>
      </g>
    );
  };
  const prodTag = (key, delay) => {
    const d = { animationDelay: `${delay}s` };
    return (
      <g key={`t${key}`} className="lp-real" style={{ opacity: 0, ...d }}>
          {/* step caption above the piece */}
          {TAGS.map(([t, c, cls]) => (
            <g key={cls} className={cls} style={{ opacity: 0, ...d }}>
              <rect x={tagX - 50} y={tagY - 15} width="100" height="20" rx="10" fill={c} stroke="rgba(255,255,255,.85)" strokeWidth="1.2" />
              <text x={tagX} y={tagY} textAnchor="middle" fontSize="12" fontWeight="900" fill="#0F172A" fontFamily="Arial, sans-serif">{t}</text>
            </g>
          ))}
      </g>
    );
  };
  // step positions on the belt (where the machine stops) and their floor marks
  const STEPS = [
    { x: 310, label: 'WRAP', color: '#22D3EE' },
    { x: 400, label: 'THERMOCOL', color: '#E2E8F0' },
    { x: 490, label: 'PACK', color: '#FBBF24' },
    { x: 580, label: 'STRAP', color: '#60A5FA' },
  ];
  const [rollX, rollY] = P(STEPS[0].x + 34, 104, BELT_Z + 30);
  const [coilX, coilY] = P(STEPS[3].x - 30, 108, BELT_Z + 44);

  return (
    <svg viewBox="-30 -232 950 274" className={`lp-scene select-none ${compact ? 'w-full h-full' : 'w-full h-auto'} ${active ? '' : 'lp-paused'}`} role="img"
      aria-label={`Animated production line${name ? ` for ${name}` : ''}: each scanned washing machine comes from assembly, is poly wrapped, packed in a carton with printed MRP, strapped and loaded into the truck`}>
      <defs>
        <clipPath id={`${uid}Back`}><rect x={P(200, 112, 0)[0]} y="-260" width={P(880, 112, 0)[0] - P(200, 112, 0)[0]} height="400" /></clipPath>
        <clipPath id={`${uid}Clip`}><polygon points={pts(beltTop)} /></clipPath>
        <linearGradient id={`${uid}Glow`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0F172A" /><stop offset="1" stopColor="#020617" /></linearGradient>
        <radialGradient id={`${uid}Floor`} cx="50%" cy="50%" r="60%"><stop offset="0" stopColor="#1E3A5F" stopOpacity=".55" /><stop offset="1" stopColor="#1E3A5F" stopOpacity="0" /></radialGradient>
        <linearGradient id={`${uid}WmFront`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#E2E8F0" /></linearGradient>
        <linearGradient id={`${uid}WmSide`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#CBD5E1" /><stop offset="1" stopColor="#94A3B8" /></linearGradient>
        <linearGradient id={`${uid}Lid`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#334155" stopOpacity=".95" /><stop offset="1" stopColor="#020617" stopOpacity=".95" /></linearGradient>
        <linearGradient id={`${uid}Steel`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F8FAFC" /><stop offset=".55" stopColor="#E2E8F0" /><stop offset="1" stopColor="#CBD5E1" /></linearGradient>
        <linearGradient id={`${uid}Cab`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3B82F6" /><stop offset="1" stopColor="#1D4ED8" /></linearGradient>
        <linearGradient id={`${uid}Glass`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#BAE6FD" stopOpacity=".95" /><stop offset=".5" stopColor="rgb(var(--sky-400))" stopOpacity=".7" /><stop offset="1" stopColor="#0C4A6E" stopOpacity=".95" /></linearGradient>
        <linearGradient id={`${uid}Kraft`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D9A867" /><stop offset="1" stopColor="#C08A4A" /></linearGradient>
        <pattern id={`${uid}Haz`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#111827" /><rect width="6" height="12" fill="#FACC15" /></pattern>
        <linearGradient id={`${uid}Wall`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0A1B33" /><stop offset="1" stopColor="#0F2747" /></linearGradient>
        <linearGradient id={`${uid}Win`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7DD3FC" stopOpacity=".55" /><stop offset="1" stopColor="#1E40AF" stopOpacity=".35" /></linearGradient>
        <radialGradient id={`${uid}Lamp`}><stop offset="0" stopColor="#FEF9C3" stopOpacity=".55" /><stop offset="1" stopColor="#FEF9C3" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${uid}Rim`}><stop offset="0" stopColor="#F1F5F9" /><stop offset="1" stopColor="#64748B" /></radialGradient>
      </defs>

      {/* factory back wall with windows, light beams and lamps */}
      {!lite && (<>
      <polygon points={pts([P(-40, 150, 0), P(900, 150, 0), P(900, 150, 260), P(-40, 150, 260)])} fill={`url(#${uid}Wall)`} />
      {[150, 330, 510, 690].map((wx) => {
        const [x0, y0] = P(wx, 150, 172); const [x1, y1] = P(wx + 110, 150, 122);
        return (
          <g key={wx}>
            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx="2" fill={`url(#${uid}Win)`} stroke="#1E3A5F" strokeWidth="2" />
            <line x1={(x0 + x1) / 2} y1={y0} x2={(x0 + x1) / 2} y2={y1} stroke="#1E3A5F" strokeWidth="2" />
            <polygon points={pts([P(wx, 150, 122), P(wx + 110, 150, 122), P(wx + 60, 20, 0), P(wx - 50, 20, 0)])} fill="#BAE6FD" opacity=".08" />
          </g>
        );
      })}
      {[260, 470, 640].map((lx2) => { const [cx2, cy2] = P(lx2, 60, 200); return (
        <g key={lx2}>
          <line x1={cx2} y1={cy2 - 40} x2={cx2} y2={cy2} stroke="#334155" strokeWidth="1.5" />
          <polygon points={`${cx2 - 12},${cy2 + 6} ${cx2 + 12},${cy2 + 6} ${cx2 + 6},${cy2} ${cx2 - 6},${cy2}`} fill="#475569" />
          <ellipse cx={cx2} cy={cy2 + 30} rx="46" ry="30" fill={`url(#${uid}Lamp)`} />
        </g>); })}

      </>)}

      {/* floor */}
      <ellipse cx="420" cy="6" rx="470" ry="34" fill={`url(#${uid}Floor)`} />
      <polygon fill="rgba(15,23,42,.55)" points={pts([P(-20, -20, 0), P(890, -20, 0), P(890, 150, 0), P(-20, 150, 0)])} />

      {/* belt legs + body + rollers */}
      {[200, 440, 640].map((x) => <Box key={x} x={x} y={10} z={0} w={14} d={10} h={14} c={['#0F172A', '#1E293B', '#020617']} />)}
      {[200, 440, 640].map((x) => <Box key={`b${x}`} x={x} y={70} z={0} w={14} d={10} h={14} c={['#0F172A', '#1E293B', '#020617']} />)}
      <Box x={170} y={0} z={14} w={520} d={90} h={14} c={['#1E293B', '#334155', '#0F172A']} />
      <g clipPath={`url(#${uid}Clip)`}><g className="lp-belt">{stripes}</g></g>
      <Box x={170} y={0} z={BELT_Z} w={520} d={5} h={6} c={['#94A3B8', '#E2E8F0', '#64748B']} />
      <Box x={170} y={85} z={BELT_Z} w={520} d={5} h={6} c={['#94A3B8', '#E2E8F0', '#64748B']} />
      {/* rollers on the belt side */}
      {Array.from({ length: 13 }, (_, i) => 186 + i * 40).map((rx2) => { const [cx3, cy3] = P(rx2, 0, 21); return (
        <g key={rx2}>
          <circle cx={cx3} cy={cy3} r="4.5" fill="#475569" stroke="#94A3B8" strokeWidth="1" />
          <g><line x1={cx3 - 3} y1={cy3} x2={cx3 + 3} y2={cy3} stroke="#E2E8F0" strokeWidth="1" /></g>
        </g>); })}
      {/* safety floor marking in front of the line */}
      <polygon points={pts([P(160, -26, 0.5), P(700, -26, 0.5), P(700, -16, 0.5), P(160, -16, 0.5)])} fill={`url(#${uid}Haz)`} opacity=".8" />

      {/* live board: big, low and readable – this hour, today and line status */}
      {[-20, 104].map((lx0) => <Box key={lx0} x={lx0} y={70} z={0} w={8} d={6} h={30} c={['#334155', '#64748B', '#1E293B']} />)}
      <Box x={-28} y={66} z={30} w={148} d={8} h={124} c={['#1E293B', '#334155', '#0F172A']} />
      {(() => {
        const [bx, by] = P(-24, 66, 150);
        const bw = 140, bh = 116;
        return (
          <g>
            <rect x={bx} y={by} width={bw} height={bh} rx="5" fill={`url(#${uid}Glow)`} stroke="rgb(var(--sky-400))" strokeWidth="1.5" />
            <rect x={bx} y={by} width={bw} height="20" rx="5" fill="#0B1220" />
            <circle cx={bx + 12} cy={by + 10} r="5" fill={active ? '#22C55E' : '#64748B'} className={active ? 'lp-blink' : ''} />
            <text x={bx + 22} y={by + 14} fontSize="10" fontWeight="900" fill={active ? '#86EFAC' : '#CBD5E1'} fontFamily="Arial, sans-serif">{active ? 'LINE RUNNING' : 'LINE PAUSED'}</text>
            <text x={bx + 10} y={by + 36} fontSize="9.5" fontWeight="800" fill="#7DD3FC" fontFamily="Arial, sans-serif">THIS HOUR</text>
            <text x={bx + 10} y={by + 66} fontSize="30" fontWeight="900" fill="#F8FAFC" fontFamily="ui-monospace, monospace">{hourQty ?? '—'}</text>
            <line x1={bx + 8} y1={by + 76} x2={bx + bw - 8} y2={by + 76} stroke="#1E3A5F" />
            <text x={bx + 10} y={by + 90} fontSize="9.5" fontWeight="800" fill="#FCD34D" fontFamily="Arial, sans-serif">TODAY</text>
            <text x={bx + 10} y={by + 109} fontSize="18" fontWeight="900" fill="#FBBF24" fontFamily="ui-monospace, monospace">{loaded ?? '—'}</text>
            {flashKey > 0 && <rect key={flashKey} className="lp-flash" x={bx} y={by} width={bw} height={bh} rx="5" fill="#FDE047" />}
          </g>
        );
      })()}

      {/* forklift carrying a pallet of packed cartons (decoration) */}
      {!lite && (
        <g transform="translate(26,0)">
        <g className={active ? 'lp-fork' : ''}>
          <Box x={-10} y={-50} z={0} w={34} d={30} h={4} c={['#92400E', '#B45309', '#78350F']} />
          {[[-8, -48], [8, -48], [-8, -34], [8, -34]].map(([bx3, by3]) => <Box key={`${bx3}${by3}`} x={bx3} y={by3} z={4} w={15} d={13} h={14} c={['#C08A4A', '#E7C38F', '#A0703A']} />)}
          <Box x={26} y={-48} z={0} w={4} d={26} h={40} c={['#374151', '#6B7280', '#1F2937']} />
          <Box x={30} y={-50} z={2} w={40} d={30} h={20} c={['#F59E0B', '#FCD34D', '#B45309']} />
          <Box x={48} y={-48} z={22} w={4} d={26} h={22} c={['#1F2937', '#374151', '#111827']} />
          <Box x={46} y={-50} z={44} w={26} d={30} h={3} c={['#1F2937', '#374151', '#111827']} />
          {[36, 62].map((wx2) => { const [wcx, wcy] = P(wx2, -50, 6); return <circle key={wx2} cx={wcx} cy={wcy} r="6" fill="#0B1220" stroke="#4B5563" strokeWidth="2" />; })}
        </g>
        </g>
      )}

      {/* barcode scanner: every scanned piece is one count on the dashboard */}
      <Box x={156} y={-24} z={0} w={10} d={10} h={BELT_Z + 104} c={['#475569', '#94A3B8', '#334155']} />
      <Box x={156} y={-24} z={BELT_Z + 104} w={52} d={18} h={12} c={['#111827', '#374151', '#0B1220']} />
      <circle cx={scanX} cy={scanY} r="3.5" fill="#EF4444" className={active ? 'lp-laser' : ''} />
      <text x={P(182, -24, BELT_Z + 107)[0]} y={P(182, -24, BELT_Z + 107)[1]} textAnchor="middle" fontSize="9" fontWeight="900" fill="#FCA5A5" fontFamily="Arial, sans-serif">● SCAN</text>

      {/* step marks on the belt front + small text, no overhead hoods */}
      {STEPS.map((st) => {
        const [tx, ty] = P(st.x, -2, 2);
        return (
          <g key={st.label}>
            <polygon points={pts([P(st.x - 32, 0, BELT_Z + 0.2), P(st.x + 32, 0, BELT_Z + 0.2), P(st.x + 32, 90, BELT_Z + 0.2), P(st.x - 32, 90, BELT_Z + 0.2)])} fill={st.color} opacity=".18" />
            <rect x={tx - (14 + st.label.length * 4)} y={ty - 11} width={28 + st.label.length * 8} height="15" rx="7.5" fill="#020617" stroke={st.color} strokeWidth="1.2" />
            <text x={tx} y={ty} textAnchor="middle" fontSize="11.5" fontWeight="900" fill={st.color} fontFamily="Arial, sans-serif">{st.label}</text>
          </g>
        );
      })}

      {/* WRAP: stretch-film mast behind the belt, the roll rides up and down */}
      <Box x={STEPS[0].x + 28} y={104} z={0} w={8} d={8} h={BELT_Z + 92} c={['#475569', '#94A3B8', '#334155']} />
      <g className={active ? 'lp-roll' : ''}>
        <rect x={rollX - 7} y={rollY - 22} width="14" height="26" rx="4" fill="rgba(186,230,253,.75)" stroke="#E0F2FE" strokeWidth="1.2" />
        <rect x={rollX - 2} y={rollY - 24} width="4" height="30" rx="1" fill="#0E7490" />
      </g>

      {/* andon tower lights on the steps */}
      {!lite && [STEPS[0].x - 40, STEPS[3].x + 40].map((tx0, i) => { const [ax, ay] = P(tx0, 96, BELT_Z + 60); return (
        <g key={`t${tx0}`}>
          <line x1={ax} y1={ay} x2={ax} y2={ay + 60} stroke="#475569" strokeWidth="2" />
          <rect x={ax - 3.5} y={ay - 21} width="7" height="7" rx="1.5" fill="#EF4444" opacity=".35" />
          <rect x={ax - 3.5} y={ay - 14} width="7" height="7" rx="1.5" fill="#F59E0B" className={active ? 'lp-tower' : ''} style={{ animationDelay: `${i * 0.5}s` }} />
          <rect x={ax - 3.5} y={ay - 7} width="7" height="7" rx="1.5" fill="#22C55E" />
        </g>); })}

      {/* STRAP: strap coil behind the belt (turns while the line runs) */}
      <Box x={STEPS[3].x - 44} y={104} z={0} w={28} d={14} h={BELT_Z + 30} c={['#1E3A8A', '#3B82F6', '#172554']} />
      <circle cx={coilX} cy={coilY} r="15" fill="#1D4ED8" stroke="#BFDBFE" strokeWidth="2" />
      <g className={active ? 'lp-spin' : ''}><line x1={coilX - 11} y1={coilY} x2={coilX + 11} y2={coilY} stroke="#BFDBFE" strokeWidth="2" /><line x1={coilX} y1={coilY - 11} x2={coilX} y2={coilY + 11} stroke="#BFDBFE" strokeWidth="2" /></g>

      {/* PACK: stack of flat cartons waiting behind the belt */}
      {[0, 1, 2, 3].map((i) => <Box key={i} x={STEPS[2].x - 20} y={104} z={i * 7} w={60} d={34} h={6} c={['#C08A4A', '#E7C38F', '#A0703A']} />)}
      {/* THERMOCOL: stack of foam caps waiting behind the belt */}
      {[0, 1, 2].map((i) => <Box key={`f${i}`} x={STEPS[1].x - 20} y={104} z={i * 12} w={50} d={40} h={11} c={FOAM} />)}

      {/* real pieces: every scanned washing machine goes through the steps into the truck */}
      {cartons.map((c) => prod(c.id, c.delay))}
      {cartons.map((c) => prodTag(c.id, c.delay))}


      {deltaN > 0 && (
        <text key={`f${flashKey}`} className="lp-float" x={fx} y={fy} fontSize="26" fontWeight="900" fill="#FDE047" stroke="#78350F" strokeWidth="1" paintOrder="stroke" fontFamily="ui-monospace, monospace">+{deltaN}</text>
      )}

      {/* truck (drawn after the pieces so they disappear inside it) */}
      <Truck uid={uid} loaded={loaded} active={active && !lite} />
    </svg>
  );
}

const pad2 = (n) => String(n).padStart(2, '0');
/** Bars: grey outlined target; the actual bar is green when the hour met its target, dark blue when it is behind (light blue: no target). */
const ACTUAL = 'rgb(var(--sky-400))';   // hour without a target
const MET = '#2563EB', TGT = '#F97316';   // 18-11-2026: actual always blue, target orange (no "behind" colour)
const PERF = { ok: MET, watch: MET, bad: MET, none: ACTUAL };
const PERF_AMBER = 100;
const EXTRA_C = '#8B5CF6';   // 26-11-2026: extra hour (outside the shift)

/**
 * Hour bars that fill whatever height the parent gives them.
 * Count sits on top of every bar. Click a bar → model + qty popup opens INSIDE the chart (never clipped).
 */
/* No dashed target line on the cards (every screen, TV too): the Hour and Cycle tiles carry the target. */
const NO_TGT = ACTUAL;   // pieces of a model without a target: the colour of an hour without a target (light blue, no stripes)
export function HourBars({ hours, nowHour, hourModels, lunch = null, targetPph = null, hint = '', hourTargets = null, hourNoTarget = null, small = false, std = false, shiftFrom = 9, shiftTo = 21 }) {
  // std (24-11-2026, the page; on the TV too since 24-11-2026 13:30): target standard grey, actual green / orange / red by % achieved,
  // pieces of a model without a cycle time on top of the actual bar (light blue) instead of a bar of their own
  const TGTc = std ? TARGET_GREY : TGT;
  const [sel, setSel] = useState(null);
  const q = new Map((hours || []).map((h) => [h.hour, Number(h.quantity) || 0]));
  let lo = 9, hi = 20;
  for (const [h, v] of q) if (v > 0) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  // TV (with targets): the whole shift 09–21 always (hours still to come stay empty), before 09 / after 21 only when something was made
  // lunch (e.g. 13:00–13:30): the bar of the hour after lunch starts at 13:30 — its label says so and the scans made
  // during lunch (shown in the lunch column) are not counted again in it
  const [lh, lm] = String(lunch?.to || '').split(':').map(Number);
  const lunchFromH = lunch?.from ? Number(String(lunch.from).split(':')[0]) : null;
  const afterLunch = lunch && Number.isFinite(lh) && lm > 0 && lunchFromH === lh ? lh : null;
  const rows = [];
  for (let h = lo; h <= hi; h++) {
    const raw = q.get(h) || 0;
    const qty = h === afterLunch && lunch.qty != null ? Math.max(0, raw - lunch.qty) : raw;
    rows.push({ hour: h, quantity: qty, label: h === afterLunch ? `${pad2(h)}:${pad2(lm)}` : pad2(h) });
  }
  const tg = (h) => (hourTargets && hourTargets[h] > 0 && (nowHour == null || h <= nowHour) ? hourTargets[h] : null);   // TV: target pieces of the hour (up to now)
  // pieces of models WITHOUT a cycle time / target in the hour: their own light-blue bar beside the hour's bar (17-11-2026),
  // never added to the bar that is compared with the target (an hour with no target at all keeps one light-blue bar)
  const ntOf = (r) => Math.min(r.quantity, Number(hourNoTarget?.[r.hour]?.qty) || 0);
  // 26-11-2026: EXTRA only for an hour outside the shift (before 09:00 / from 21:00); inside the shift an hour without a
  // target is shown as no cycle time (light blue), never as extra
  const outOfShift = (h) => h < shiftFrom || h >= shiftTo;
  const splitOf = (r) => !std && tg(r.hour) != null && ntOf(r) > 0;
  const mainOf = (r) => (splitOf(r) ? r.quantity - ntOf(r) : r.quantity);   // pieces on the hour's main bar
  const anyNt = rows.some((r) => ntOf(r) > 0);
  const max = Math.max(1, targetPph || 0, ...rows.map(mainOf), ...rows.map((r) => (splitOf(r) ? ntOf(r) : 0)), ...rows.map((r) => tg(r.hour) || 0));
  // room per hour (measured): with little room the target number goes inside its grey bar and the no-target bar is thinner
  const boxRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0, tv: false, fs: 1 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // page px (clientWidth / clientHeight): TV mode scales the whole page, the numbers and bars are laid out before that
    const on = () => {
      const w = el.clientWidth, h = el.clientHeight, tv = !!el.closest('[data-tv-look]');
      // the user's text size (Setup → font size, --fs): the numbers' width is measured with it (24-11-2026)
      let fs = 1; try { fs = parseFloat(getComputedStyle(el).getPropertyValue('--fs')) || 1; } catch { /* old browser */ }
      setBox((o) => (Math.abs(o.w - w) < 1 && Math.abs(o.h - h) < 1 && o.tv === tv && o.fs === fs ? o : { w, h, tv, fs }));
    };
    on();
    const ro = new ResizeObserver(on); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tgtPct = targetPph ? (targetPph / max) * 82 : null;   // same scale as the bars
  const models = sel != null ? (hourModels || []).filter((m) => m.hour === sel).sort((a, b) => b.qty - a.qty) : [];
  const selQty = sel != null ? q.get(sel) || 0 : 0;
  const selIdx = rows.findIndex((r) => r.hour === sel);
  const popRight = selIdx >= 0 && selIdx < rows.length / 2; // popup opens on the opposite side so the picked bar stays visible
  const dense = rows.length > 14;
  // lunch window as its own narrow grey column, placed before the hour it starts in
  const lunchHour = lunch?.from ? Number(String(lunch.from).split(':')[0]) : null;
  const lunchAtStart = lunch?.from ? String(lunch.from).split(':')[1] === '00' : true;
  const lunchShown = !!lunch && rows.some((r) => r.hour === lunchHour);
  const isFut = (r) => nowHour != null && r.hour > nowHour && !r.quantity;
  const units = rows.reduce((a, r) => a + (small && isFut(r) ? 0.45 : 1), 0) + (lunchShown ? 0.55 : 0);
  const gapsW = 2 * Math.max(0, rows.length + (lunchShown ? 1 : 0) - 1);
  const slotW = box.w ? (box.w - gapsW) / Math.max(1, units) : 80;   // equal shares (the line's TV)
  // the room an hour needs for its numbers side by side (17-11-2026): target + made + no-cycle-time bars > target + made >
  // one bar > an hour still to come. Cards share their width by this need, so the hours with three numbers get the room.
  const minW = (r) => (isFut(r) ? (small ? 20 : 24) : !hourTargets ? 30 : tg(r.hour) == null ? 34 : splitOf(r) ? 76 : 52);
  const LUNCH_W = 28;
  const needW = rows.reduce((a, r) => a + minW(r), 0) + (lunchShown ? LUNCH_W : 0) + gapsW;
  const kNeed = box.w ? (box.w - gapsW) / Math.max(1, needW - gapsW) : 1;
  // phones: even so too little room → each hour keeps the room it needs and the hours scroll sideways (opened at the hour
  // now running); computer screens and TVs have the room, so there nothing scrolls
  const scroll = box.w > 0 && !box.tv && (small ? kNeed < 0.7 : slotW < 36 && box.w + 1 < needW);   // a TV cannot be scrolled
  const byNeed = small && !scroll;
  const tight = scroll || small || slotW < 60;
  const slotOf = (r) => (scroll ? minW(r) : byNeed ? minW(r) * kNeed : slotW * (small && isFut(r) ? 0.45 : 1));
  const barAreaH = Math.max(0, box.h - (small ? 36 : 30));   // the hour label and the % under each bar
  const [edge, setEdge] = useState({ l: false, r: false });   // scrolling hours: more to see on the left / right
  const onScroll = (e) => {
    const el = e.currentTarget || e;
    const l = el.scrollLeft > 2, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((o) => (o.l === l && o.r === r ? o : { l, r }));
  };
  useEffect(() => {
    // scrolling hours: show the hour now running (at the right edge), the earlier hours to its left — starting at a whole hour
    const el = boxRef.current;
    if (!el || !scroll) return;
    const cur = el.querySelector('[data-cur="1"]');
    const right = cur ? cur.offsetLeft + cur.offsetWidth : el.scrollWidth;
    const want = Math.max(0, right - el.clientWidth + 8);
    const starts = [...(el.firstElementChild?.children || [])].map((c) => c.offsetLeft).filter((x) => x >= want);
    el.scrollLeft = starts.length ? Math.min(...starts) : want;
    onScroll(el);
  }, [scroll, nowHour, box.w]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a soft edge on the side that has more hours, so it reads as "swipe for more" (not as cut-off numbers)
  const fade = scroll ? `linear-gradient(to right, ${edge.l ? 'transparent 0, #000 10px' : '#000 0'}, ${edge.r ? '#000 calc(100% - 14px), transparent 100%' : '#000 100%'})` : undefined;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-1 shrink-0">
        <div className={`${small ? 'text-fs-14' : 'text-fs-12'} font-bold uppercase tracking-wide text-sky-100 cursor-help whitespace-nowrap`} title={hint || undefined}>{small ? 'By hour' : 'Output by hour (pcs)'}{hint && <span className="ml-1 normal-case font-normal text-sky-200/80" aria-hidden>ⓘ</span>}</div>
        {hourTargets && (
          <div className={`flex flex-wrap items-center justify-end ${small ? 'gap-x-2.5 text-fs-13 lp-legend-sm' : 'gap-x-4 gap-y-1 text-fs-12'} font-bold text-sky-100`} aria-label="Legend">
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-4 rounded-sm" style={{ background: TGTc }} aria-hidden />Target</span>
            {std
              ? <span className="inline-flex items-center gap-1.5" title={`Actual: green when the target is met, orange ${ACH_ORANGE_FROM}–99 %, red below ${ACH_ORANGE_FROM} %`}><span className="inline-flex gap-px" aria-hidden><i className="inline-block h-3 w-1.5" style={{ background: ACH_GREEN, borderRadius: "2px 0 0 2px" }} /><i className="inline-block h-3 w-1.5" style={{ background: ACH_ORANGE }} /><i className="inline-block h-3 w-1.5" style={{ background: ACH_RED, borderRadius: "0 2px 2px 0" }} /></span>Actual</span>
              : <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-4 rounded-sm" style={{ background: MET }} aria-hidden />Actual</span>}
            {anyNt && <span className="inline-flex items-center gap-1.5" title={std ? 'Pieces of a model without a cycle time (not in the Model master): light blue on top of the actual bar, not counted against the target' : 'Pieces of a model without a cycle time (not in the Model master): their own light-blue bar, not counted against the target'}><i className="inline-block h-3 w-4 rounded-sm" style={{ background: std ? NO_CYCLE : NO_TGT }} aria-hidden />No cycle time</span>}
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-4 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg, rgba(203,213,225,.45) 0 3px, transparent 3px 6px)' }} aria-hidden />Lunch</span>
          </div>
        )}
      </div>

      <div className={`relative flex-1 ${small ? 'min-h-0' : 'min-h-[110px]'}`}>
        {sel != null && (() => {
          // 26-11-2026: the hour's popup — the hour, its pieces against the target, then every model with its share
          const r0 = rows.find((x) => x.hour === sel);
          const t = r0 ? tg(sel) : null, nt = r0 ? ntOf(r0) : 0, tq = (r0?.quantity || 0) - nt;
          const p = t ? (tq / t) * 100 : null;
          const col = p == null ? '#60A5FA' : achColor(tq, t, '#60A5FA');   // the same colours as the bars (achievement bands)
          const extra = r0 && outOfShift(sel) && t == null && r0.quantity > 0 && nt < r0.quantity;
          const lbl = r0?.label?.includes(':') ? `${r0.label}–${pad2(sel + 1)}:00` : `${pad2(sel)}:00–${pad2(sel + 1)}:00`;
          const hiQ = Math.max(1, ...models.map((m) => m.qty));
          return (
            <div className={`absolute top-0 z-30 flex max-h-full flex-col rounded-xl border border-sky-400/40 bg-blue-950/95 p-2.5 shadow-2xl backdrop-blur ${popRight ? 'right-0' : 'left-0'}`} style={{ width: 'min(22rem, 94%)' }} data-testid="hour-pop">
              <div className="mb-1.5 flex shrink-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-fs-14 font-extrabold text-white">{lbl}</div>
                  <div className="text-fs-12 font-semibold text-slate-300">{selQty} pcs made{extra ? ' · extra hour (outside the shift, no target)' : ''}</div>
                </div>
                {p != null && <span className="rounded-md px-2 py-0.5 font-mono text-fs-15 font-extrabold" style={{ background: col, color: '#0B1020' }}>{Math.round(p)}%</span>}
                {extra && <span className="rounded-md bg-violet-500 px-2 py-0.5 text-fs-12 font-extrabold text-white">EXTRA</span>}
                <button type="button" onClick={() => setSel(null)} className="px-1 text-fs-14 font-bold leading-none text-slate-300 hover:text-white" aria-label="Close">✕</button>
              </div>
              {hourTargets && r0 && (t != null || nt > 0) && (
                <div className="mb-2 grid shrink-0 grid-cols-3 gap-1.5 text-center" data-testid="hour-split">
                  <div className="rounded-md bg-white/10 px-1 py-1"><div className="text-fs-11 font-bold uppercase tracking-wide text-slate-300">Target</div><div className="font-mono text-fs-16 font-extrabold text-white">{t ?? '—'}</div></div>
                  <div className="rounded-md bg-white/10 px-1 py-1"><div className="text-fs-11 font-bold uppercase tracking-wide text-slate-300">Made</div><div className="font-mono text-fs-16 font-extrabold" style={{ color: col }}>{t != null ? tq : r0.quantity}</div></div>
                  <div className="rounded-md bg-white/10 px-1 py-1"><div className="text-fs-11 font-bold uppercase tracking-wide text-slate-300">{t != null ? (tq >= t ? 'Excess' : 'Short') : 'No cycle'}</div><div className="font-mono text-fs-16 font-extrabold text-white">{t != null ? Math.abs(tq - t) : nt}</div></div>
                  {nt > 0 && t != null && <div className="col-span-3 text-left text-fs-11 font-semibold text-sky-200">+ {nt} pcs of a model without a cycle time (own light-blue bar, not counted)</div>}
                </div>
              )}
              <div className="mb-1 shrink-0 text-fs-11 font-bold uppercase tracking-wide text-slate-400">Models in this hour</div>
              <div className="min-h-0 space-y-1.5 overflow-auto">
                {models.length ? models.map((m) => (
                  <div key={m.model} className="rounded-md bg-white/10 px-1.5 py-1">
                    <div className="flex items-start gap-2 text-fs-13">
                      <span className="min-w-0 flex-1 break-words font-semibold leading-tight text-slate-100">{m.company && <span className="mr-1 text-fs-11 font-extrabold uppercase text-sky-300">{m.company}</span>}{m.model}{(hourNoTarget?.[sel]?.models || []).includes(m.model) && <span className="ml-1 rounded bg-sky-400/20 px-1 text-fs-11 text-sky-200">no cycle time</span>}</span>
                      <span className="font-mono font-extrabold tabular-nums text-white">{m.qty}</span>
                      <span className="w-10 text-right font-mono text-fs-12 text-slate-300">{selQty ? Math.round((m.qty / selQty) * 100) : 0}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-sky-400" style={{ width: `${(m.qty / hiQ) * 100}%` }} /></div>
                  </div>
                )) : <div className="text-fs-13 text-slate-300">{selQty ? 'Model detail is not available in the line data.' : 'No scans in this hour.'}</div>}
              </div>
            </div>
          );
        })()}

        {tgtPct != null && (
          <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ bottom: `calc(13px + (100% - 13px) * ${tgtPct / 100})` }} aria-label={`Target ${Math.round(targetPph)} per hour`}>
            <div className="border-t-2 border-dashed border-white" />
            <span className="absolute right-0 -top-[18px] rounded bg-white px-1 text-fs-12 font-extrabold leading-[16px] text-dixon-navy">Target {Math.round(targetPph)}/hr</span>
          </div>
        )}
        <div ref={boxRef} className={`absolute inset-0 ${scroll ? 'overflow-x-auto overflow-y-hidden overscroll-x-contain' : ''}`} onScroll={scroll ? onScroll : undefined}
          style={scroll ? { scrollbarWidth: 'thin', scrollSnapType: 'x proximity', WebkitMaskImage: fade, maskImage: fade } : undefined}
          data-testid="hour-bars" data-scroll={scroll ? '1' : undefined}>
        <div className="h-full flex items-stretch gap-[2px]" style={scroll ? { width: needW } : undefined}>
          {rows.flatMap((r) => {
            const cur = r.hour === nowHour, on = r.hour === sel;
            const lunchCol = lunch && r.hour === lunchHour ? (
              <div key={`lunch-${r.hour}`} title={`Lunch ${lunch.from}–${lunch.to}${lunch.qty != null ? ` · ${lunch.qty} scans during lunch` : ''}`}
                className={`${scroll || byNeed ? '' : 'flex-[0.55]'} min-w-0 h-full flex flex-col`} style={scroll ? { width: LUNCH_W, flex: 'none', scrollSnapAlign: 'start' } : byNeed ? { flex: `${LUNCH_W} 1 0px` } : undefined} role="img" aria-label={`Lunch ${lunch.from} to ${lunch.to}`}>
                <div className="relative flex-1 min-h-0 w-full flex flex-col items-center justify-end rounded-t border border-dashed border-slate-300/50"
                  style={{ background: 'repeating-linear-gradient(45deg, rgba(203,213,225,.18) 0 4px, transparent 4px 8px)' }}>
                  {/* the lunch window written inside the column: the next bar starts at the end of lunch */}
                  {(() => {
                    // written upright in the room above the lunch count (smaller when the column is short), never over the count
                    const chipH = lunch.qty != null ? 16 : 0, room = Math.max(0, box.h - 16 - chipH - 6);
                    const len = Math.max(`${lunch.from}–${lunch.to}`.length, 6) * 0.62;
                    const f = Math.max(7, Math.min(small ? fs(9) : fs(11), room / len));
                    return <span className="lp-lunchtxt" style={{ fontSize: f, top: `calc((100% - ${chipH}px) / 2)` }}><span className="lp-lunchword">Lunch</span>{lunch.from}–{lunch.to}</span>;
                  })()}
                  {lunch.qty != null && <span className={`relative mb-0.5 rounded bg-slate-200 px-0.5 font-mono font-extrabold leading-none text-dixon-navy ${small ? 'text-fs-10' : 'text-fs-11'}`} title="Pieces scanned during lunch">{lunch.qty}</span>}
                </div>
                <span className="text-fs-11 mt-0.5 leading-none text-center text-slate-200" aria-hidden>🍽</span>
              </div>
            ) : null;
            const bar = (() => {
            const TOP = small && hourTargets ? 80 : 82;   // tallest bar height (%); the rest stays free for the count labels
            const INBAR = 1000;   // the number always sits above its bar, written straight (readable from afar)
            const fut = nowHour != null && r.hour > nowHour && !r.quantity;
            const pct = r.quantity > 0 ? (r.quantity / max) * TOP : 0;
            return (
              <button key={r.hour} type="button" onClick={() => setSel(on ? null : r.hour)} aria-label={`${r.label.includes(':') ? r.label : `${r.label}:00`}, ${r.quantity} pieces${ntOf(r) ? `, ${ntOf(r)} without target` : ''}`}
                data-cur={cur ? '1' : undefined} style={scroll ? { width: minW(r), flex: 'none', scrollSnapAlign: 'start' } : byNeed ? { flex: `${minW(r)} 1 0px` } : undefined}
                className={`group ${scroll || byNeed ? '' : small && fut ? 'flex-[0.45]' : 'flex-1'} min-w-0 h-full flex flex-col rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300`}>
                {hourTargets ? (() => {
                  // TV: target bar (grey, outlined) and actual bar side by side, the actual coloured by % of target
                  // (andon colours: green ≥ 100 %, amber PERF_AMBER–99 %, red below; blue when the hour has no target)
                  const t = tg(r.hour);
                  const future = nowHour != null && r.hour > nowHour;
                  const nt = ntOf(r), tq = r.quantity - nt;
                  const split = splitOf(r);
                  const main = mainOf(r);
                  const p = t ? (tq / t) * 100 : null;
                  // 26-11-2026: an extra hour (made outside the shift, no target) in its own violet, so it reads at a glance
                  const isExtra = outOfShift(r.hour) && t == null && !future && r.quantity > 0 && nt < r.quantity;
                  const col = isExtra ? EXTRA_C : std ? achColor(tq, t, PERF.none) : p == null ? PERF.none : p >= 100 ? PERF.ok : p >= PERF_AMBER ? PERF.watch : PERF.bad;
                  const ntTop = std && nt > 0 && main > 0 ? (nt / main) * 100 : 0;   // std: share of the actual bar that has no cycle time (on top)
                  const mPct = main > 0 ? (main / max) * TOP : 0;
                  const nPct = split ? (nt / max) * TOP : 0;
                  // numbers never run into each other (17-11-2026): each number sits over its bar; where the target number and the
                  // made number would touch (bars of about the same height in a narrow hour), the LOWER bar's number moves inside
                  // the top of its own bar (behind: made inside, in a chip of the bar colour; met: target inside the grey bar)
                  const px = (v) => (v / max) * (TOP / 100) * barAreaH;
                  const nf = small ? (rows.length > 12 || tight ? 'text-fs-11' : 'text-fs-12') : 'text-fs-13';
                  const fsK = box.fs || 1, FT = (small ? (rows.length > 12 || tight ? 11.5 : 12.5) : 13) * fsK, FM = (small ? (rows.length > 12 || tight ? 13 : 14) : 14) * fsK;
                  const S = slotOf(r), cw = Math.min(S, split ? 190 : 150);
                  const padX = small ? 2 : 0.05 * cw, gapX = small ? 3 : 0.05 * cw;
                  const fr = split ? [1, 1, tight ? 0.7 : 1] : [1, 1];
                  const bw = fr.map((f) => (Math.max(0, cw - 2 * padX - gapX * (fr.length - 1)) * f) / fr.reduce((a, b) => a + b, 0));
                  const cx = bw.map((w, i) => (S - cw) / 2 + padX + bw.slice(0, i).reduce((a, b) => a + b + gapX, 0) + w / 2);
                  const lab = (i, v, f) => { const w = String(v).length * 0.6 * f, b = px(v) + 2; return { l: cx[i] - w / 2, r: cx[i] + w / 2, b, t: b + f }; };
                  const hit = (a, b) => a.l < b.r + 3 && b.l < a.r + 3 && a.b < b.t + 1 && b.b < a.t + 1;   // closer than 3 px reads as one number
                  const both = t != null && main > 0 && !(future && !r.quantity);
                  const clash = both && hit(lab(0, t, FT), lab(1, main, FM));
                  const tIn = clash && main > t && px(t) >= FT + 6;
                  const mIn = clash && main <= t && px(main) >= FM + 6;
                  // the no-target number: over its bar; if it would touch the made number, upright inside its bar (when tall enough)
                  const FC = (small ? 12.5 : 13) * fsK, cwM = String(main).length * 0.6 * FC + 4;   // the made number's chip (inside its bar)
                  // 24-11-2026: a number inside a narrow bar never spills over the next bar — smaller font to fit the bar (+ its gap)
                  const fitPx = (i, v, f) => Math.max(8, Math.min(f, (bw[i] + gapX - 2) / (0.62 * String(v).length)));
                  // touching numbers that cannot go inside a bar (short bars): each one shrinks to the width of its own bar
                  const shrink = clash && !tIn && !mIn;
                  const mLab = mIn ? { l: cx[1] - cwM / 2, r: cx[1] + cwM / 2, b: px(main) - 2 - FC, t: px(main) - 2 } : lab(1, main, FM);
                  const ntClash = split && (hit(mLab, lab(2, nt, FT)) || (tight && String(nt).length > 2 && bw[2] < String(nt).length * 0.6 * FT - 4));
                  const ntUp = ntClash && px(nt) >= String(nt).length * 8 + 6;
                  const ntNum = split && !ntUp;
                  const tip = `${r.label.includes(':') ? `${r.label}–${pad2(r.hour + 1)}:00 (${60 - lm} min after lunch: the target is for these minutes only)` : `${r.label}:00`}${r.hour === nowHour && t != null ? ' · running hour: target up to now' : ''}${t != null ? ` · target ${t} · made ${tq}${split ? ' with a target' : ''}` : ` · made ${r.quantity}`}${split ? ` · ${nt} of a model without a cycle time (own light-blue bar, not counted)` : std && nt > 0 ? ` · ${nt} of a model without a cycle time (light blue on top, not counted)` : ''}`;
                  return (
                    <div className="relative flex-1 min-h-0 w-full flex items-end justify-center" title={tip}>
                      <div className={`h-full w-full ${split ? 'max-w-[190px]' : 'max-w-[150px]'} flex items-end justify-center ${small ? 'gap-[3px] px-[2px]' : 'gap-[5%] px-[5%]'}`}>
                        <div className="flex-1 min-w-0 h-full flex flex-col items-center justify-end" aria-label={t != null ? `Target ${t} pieces` : undefined}>
                          {t != null && !tIn && <span className={`font-mono tabular-nums leading-none mb-0.5 whitespace-nowrap ${small ? `${nf} font-bold tracking-tighter text-slate-300` : 'text-fs-14 font-bold text-slate-200'}`} style={shrink ? { fontSize: `${Math.min(FT, fitPx(0, t, 99) - 0.5).toFixed(1)}px` } : undefined} aria-label={`Target ${t}`}>{t}</span>}
                          {t != null && (
                            <div className="relative w-full rounded-t" style={{ height: `${(t / max) * TOP}%`, minHeight: 3, background: TGTc }}>
                              {tIn && <span className={`absolute left-1/2 top-0.5 z-10 font-mono tabular-nums leading-none whitespace-nowrap ${nf} font-extrabold tracking-tighter`} style={{ transform: 'translateX(-50%)', color: '#1C1917', fontSize: `${Math.min(FT, fitPx(0, t, 99)).toFixed(1)}px` }} data-testid="target-in-bar" aria-label={`Target ${t}`}>{t}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 h-full flex flex-col items-center justify-end">
                          {!mIn && <span className={`font-mono tabular-nums leading-none mb-0.5 whitespace-nowrap font-extrabold ${small ? `${rows.length > 12 || tight ? 'text-fs-13' : 'text-fs-14'} tracking-tighter` : 'text-fs-14'} ${main ? 'text-sky-100' : 'text-slate-400'}`} style={shrink ? { fontSize: `${Math.min(FM, fitPx(1, main, 99) - 0.5).toFixed(1)}px` } : undefined} aria-label={split ? `${main} pieces with a target` : undefined}>{future && !r.quantity ? '' : main}</span>}
                          <div className={`relative w-full rounded-t transition-all duration-500 ${on ? 'ring-2 ring-white' : ''} ${cur ? 'lp-curbar' : ''}`}
                            style={{ height: `${mPct}%`, minHeight: main > 0 ? 3 : 0, background: col }}>
                            {ntTop > 0 && <div className="absolute inset-x-0 top-0 rounded-t" style={{ height: `${ntTop}%`, minHeight: 3, background: NO_CYCLE, borderBottom: '1px solid #fff' }} data-testid="no-cycle-top" aria-label={`${nt} pieces of a model without a cycle time`} />}
                            {/* white in a chip of the bar colour, centred on the bar (a little wider than a thin bar), in every colour set
                                (an inline colour: the light TV sets re-ink .text-white) */}
                            {mIn && <span className={`absolute left-1/2 top-0.5 z-10 rounded-[3px] px-[2px] font-mono tabular-nums leading-none whitespace-nowrap font-extrabold tracking-tighter ${small ? 'text-fs-12' : 'text-fs-13'}`} style={{ transform: 'translateX(-50%)', color: '#fff', background: col, fontSize: `${Math.min(FC, fitPx(1, main, 99)).toFixed(1)}px` }} data-testid="made-in-bar" aria-label={split ? `${main} pieces with a target` : undefined}>{main}</span>}
                          </div>
                        </div>
                        {split && (
                          <div className={`${tight ? 'flex-[0.7]' : 'flex-1'} min-w-0 h-full flex flex-col items-center justify-end`} data-testid="no-target-bar" aria-label={`${nt} pieces of a model without a cycle time`}>
                            {ntNum && <span className={`font-mono tabular-nums leading-none mb-0.5 whitespace-nowrap font-bold tracking-tighter ${small ? (tight && String(nt).length > 2 ? 'text-fs-10' : nf) : 'text-fs-13'} text-sky-300`}>{nt}</span>}
                            <div className="relative w-full rounded-t" style={{ height: `${nPct}%`, minHeight: 3, background: NO_TGT }}>
                              {ntUp && <span className="absolute inset-x-0 top-1 flex justify-center font-mono font-extrabold leading-none tabular-nums text-fs-11 text-dixon-navy" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{nt}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                <div className="relative flex-1 min-h-0 w-full flex flex-col items-center justify-end">
                  <span className={`relative font-mono tabular-nums leading-none mb-0.5 ${dense ? 'text-fs-11' : 'text-fs-13'} ${r.quantity ? (cur ? 'text-slate-300 font-extrabold' : 'text-sky-100 font-bold') : 'text-slate-400'}`}>{r.quantity}</span>
                  <div className={`w-full rounded-t transition-all duration-500 ${on ? 'bg-white' : cur ? 'bg-slate-400 shadow-[0_0_12px_rgba(251,191,36,.8)]' : 'bg-sky-400/70 group-hover:bg-sky-300'}`}
                    style={{ height: `${pct}%`, minHeight: r.quantity > 0 ? 3 : 0 }} />
                </div>
                )}
                {(() => {
                  // the hour under its bar: smaller when the hour is narrow ("13:30" after lunch), never into the next hour
                  const txt = `${r.label}${cur && !small ? ' ●' : ''}`, base = small ? 15 : 12.5, fit = (slotOf(r) - 2) / (0.6 * txt.length);
                  const sz = fit >= base ? (small ? 'text-fs-15' : 'text-fs-12') : fit >= 12.5 ? 'text-fs-12' : 'text-fs-10';
                  return <span className={`${sz} ${small ? 'font-bold' : 'font-semibold'} font-mono mt-0.5 leading-none text-center whitespace-nowrap ${on ? 'text-white font-bold' : cur ? 'text-white font-extrabold' : nowHour != null && r.hour > nowHour ? 'text-slate-400' : 'text-slate-100'}`}>{txt}</span>;
                })()}
                {hourTargets && (() => { const t = tg(r.hour); const p = t ? ((r.quantity - ntOf(r)) / t) * 100 : null; const col = p == null ? null : p >= 100 ? PERF.ok : p >= PERF_AMBER ? PERF.watch : PERF.bad;
                  const pc = std && p != null ? achText(achColor(r.quantity - ntOf(r), t)) : null;
                  if (outOfShift(r.hour) && t == null && r.quantity > 0 && ntOf(r) < r.quantity && !(nowHour != null && r.hour > nowHour)) return <span className={`mx-auto mt-0.5 rounded px-1 font-extrabold leading-tight text-white ${small ? 'text-fs-11' : 'text-fs-10'}`} style={{ background: EXTRA_C }} title="Extra hour: made outside the shift (no target)">EXTRA</span>;
                  return <span className={`${small ? 'text-fs-14' : 'text-fs-12'} font-mono font-extrabold mt-0.5 leading-none text-center`} style={{ color: pc || (col ? 'var(--tv-pct, #CBD5E1)' : 'transparent') }} data-ach={pc || undefined}>{p != null ? `${p < 100 ? Math.floor(p) : Math.round(p)}%` : '·'}</span>; })()}
              </button>
            );
            })();
            return lunchCol ? (lunchAtStart ? [lunchCol, bar] : [bar, lunchCol]) : [bar];
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

/** TV: every model made today with its pieces, biggest first; the running model is marked. */
function TvModels({ list, running, total, sm = false, cols = 1 }) {
  // fits: the rows as they are. More models than fit: the list rolls slowly upwards (and round again), nothing is cut off.
  // roll only when the rows really do not fit in the space the card gives (measured, so a bigger card shows more rows)
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const [roll, setRoll] = useState(false);
  const [clipH, setClipH] = useState(null);   // whole rows only: the box is cut to the rows that fit completely
  const [availH, setAvailH] = useState(null);   // room for the rows (rolling: the clip follows the rows now on top)
  useEffect(() => {
    const box = boxRef.current, ul = listRef.current;
    if (!box || !ul) return undefined;
    const check = () => {
      const g = sm ? 3 : 6;
      const firsts = [...ul.children].slice(0, list.length).filter((_, i) => i % cols === 0);
      const h = firsts.reduce((a, el) => a + el.offsetHeight, 0) + Math.max(0, firsts.length - 1) * g;
      const avail = box.parentElement ? box.parentElement.clientHeight - (box.offsetTop - box.parentElement.offsetTop) - (sm ? 4 : 8) : box.clientHeight;
      const over = h > avail + 1;
      setRoll(over); setAvailH(avail);
      if (over && firsts.length) {
        let used = 0, n = 0;
        for (const el of firsts) { const add = el.offsetHeight + (n ? g : 0); if (used + add > avail) break; used += add; n += 1; }
        setClipH(n ? used : null);
      } else setClipH(null);
    };
    check();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(box); if (box.parentElement) ro?.observe(box.parentElement);
    return () => ro?.disconnect();
  }, [list.length, sm, cols]);
  const rowCount = Math.ceil(list.length / cols);
  // more models than fit: one row up every 3 s (whole rows, never half a row moving), and round again
  const [step, setStep] = useState(0);
  const [anim, setAnim] = useState(true);
  useEffect(() => {
    if (!roll || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) { setStep(0); return undefined; }
    const id = setInterval(() => setStep((x) => x + 1), 3200);
    return () => clearInterval(id);
  }, [roll, list.length]);
  useEffect(() => {
    if (!roll || step < rowCount) return undefined;
    const t = setTimeout(() => { setAnim(false); setStep(0); requestAnimationFrame(() => requestAnimationFrame(() => setAnim(true))); }, 800);
    return () => clearTimeout(t);
  }, [step, roll, rowCount]);
  const gap = sm ? 3 : 6;
  const kids = listRef.current ? [...listRef.current.children] : [];
  let offset = 0; for (let r = 0; r < step; r++) offset += (kids[r * cols]?.offsetHeight || 0) + gap;
  // rows of different heights (a long name on two lines): cut the box to the whole rows from the one now on top
  let clipNow = clipH;
  if (roll && availH && kids.length) {
    let used = 0, n = 0;
    for (let r = step; r < step + rowCount; r++) { const el = kids[r * cols]; if (!el) break; const add = el.offsetHeight + (n ? gap : 0); if (used + add > availH) break; used += add; n += 1; }
    if (n) clipNow = used;
  }
  const top = Math.max(1, ...list.map((m) => m.qty));
  const big = !sm && list.length <= 3;   // few models: bigger rows, so the panel has no empty space
  const smBig = sm && list.length <= 3;   // wall card with few models: bigger rows too
  const row = (m, k) => {
    const on = running && m.name === running;
    return (
      <li key={k} className={`rounded-md shrink-0 ${smBig ? 'px-2 py-1.5' : sm ? 'px-1.5 py-[3px]' : big ? 'px-3 py-2.5' : 'px-2 py-1'} ${on ? 'bg-sky-400/15 ring-1 ring-sky-300/70' : 'bg-white/[.04]'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {/* company above the full model name (smaller when long, wraps instead of being cut off) */}
          <span className="min-w-0 flex-1 flex flex-col leading-[1.1]" title={[m.company, m.name].filter(Boolean).join(' · ')}>
            {m.company && <span className={`font-sans font-extrabold uppercase tracking-wide text-sky-300 break-words ${sm ? 'text-fs-12' : big ? 'text-fs-16' : 'text-fs-12'}`}>{m.company}</span>}
            <span className={`font-mono font-bold break-words text-slate-100 ${sm ? (smBig ? (m.name.length > 18 ? 'text-fs-14' : 'text-fs-16') : m.name.length > 18 ? 'text-fs-12' : 'text-fs-13') : big ? (m.name.length > 18 ? 'text-fs-20' : 'text-fs-24') : m.name.length > 22 ? 'text-fs-14' : m.name.length > 14 ? 'text-fs-16' : 'text-fs-18'}`}>{on ? '▶ ' : ''}{wrapCode(m.name)}</span>
          </span>
          <span className={`shrink-0 font-mono tabular-nums ${sm ? (smBig ? 'text-fs-22' : 'text-fs-16') : big ? 'text-fs-34' : 'text-fs-24'} font-extrabold leading-none text-white`}>{m.qty.toLocaleString('en-IN')}</span>
        </div>
        <div className={`${smBig ? 'mt-1 h-1' : sm ? 'mt-[2px] h-[2px]' : big ? 'mt-2 h-1.5' : 'mt-1 h-1'} rounded-full bg-white/10 overflow-hidden`} aria-hidden><div className="h-full rounded-full bg-sky-400" style={{ width: `${(m.qty / top) * 100}%` }} /></div>
      </li>
    );
  };
  return (
    <div className={`rounded-xl bg-white/[.07] border border-white/10 min-w-0 min-h-0 overflow-hidden flex flex-col ${sm ? 'px-1.5 py-1' : 'px-3 py-2'}`} aria-label="Models today">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 shrink-0">
        <span className={`${sm ? 'text-fs-13' : 'text-fs-18'} leading-tight font-extrabold uppercase tracking-wide text-white/90 whitespace-nowrap`}>Models today</span>
        <span className={`${sm ? 'text-fs-13' : 'text-fs-16'} font-bold text-sky-200 shrink-0 whitespace-nowrap tabular-nums`}>{list.length} · {Number(total ?? list.reduce((a, m) => a + m.qty, 0)).toLocaleString('en-IN')} pcs</span>
      </div>
      <div ref={boxRef} className={`relative min-h-0 overflow-hidden ${clipNow ? '' : 'flex-1'} ${sm ? 'mt-0.5' : 'mt-1.5'}`} style={clipNow ? { height: clipNow } : undefined}>
        {!list.length && <div className={`${sm ? 'text-fs-11' : 'text-fs-18'} font-semibold text-slate-300`}>No pieces yet</div>}
        {list.length > 0 && (
          <ul ref={listRef} className={`${cols > 1 ? 'grid grid-cols-2' : 'flex flex-col'} ${sm ? 'gap-[3px]' : 'gap-1.5'}`} style={roll ? { transform: `translateY(-${offset}px)`, transition: anim ? 'transform .7s ease' : 'none' } : undefined}>
            {list.map((m, i) => row(m, `a${i}`))}
            {/* second copy: the roll continues without a jump */}
            {roll && list.map((m, i) => <React.Fragment key={`b${i}`}>{React.cloneElement(row(m, `b${i}`), { 'aria-hidden': true })}</React.Fragment>)}
          </ul>
        )}

      </div>
    </div>
  );
}

/** Ahead / behind the plan: value − target as "+12" (green) or "−40" (red). */
const Gap = ({ value, target, tv = false, compact = false }) => {
  const v = Number(String(value).replace(/[^0-9.-]/g, '')), t = Number(target);
  if (!Number.isFinite(v) || !Number.isFinite(t) || target == null || value == null || value === '—') return null;
  const d = Math.round(v - t);
  return <span className={`shrink-0 rounded-md px-1.5 font-mono font-extrabold ${tv ? 'text-fs-18 leading-snug' : compact ? 'text-fs-11' : 'text-fs-13'} ${d >= 0 ? 'bg-emerald-500 text-white' : 'bg-red-600 text-white'}`} title={d >= 0 ? 'ahead of plan' : 'behind plan'}>{d >= 0 ? `+${d}` : `−${Math.abs(d)}`}</span>;
};

/** TV: the big number's size by its length, so it is never cut (smaller when a target sits next to it). */
const tvNum = (v, withTarget) => { const n = String(v ?? '').length; if (!withTarget) return n > 6 ? 'text-fs-40' : 'text-fs-50'; return n <= 2 ? 'text-fs-50' : n === 3 ? 'text-fs-42' : n === 4 ? 'text-fs-34' : 'text-fs-30'; };

/** TV: ahead / behind the target as coloured text (+12 green, −113 red). */
const GapText = ({ value, target }) => {
  const v = Number(String(value).replace(/[^0-9.-]/g, '')), t = Number(target);
  if (!Number.isFinite(v) || !Number.isFinite(t) || value == null || value === '—') return null;
  const d = Math.round(v - t);
  return <div className={`mt-1 whitespace-nowrap font-mono tabular-nums text-fs-15 font-extrabold text-white`} title={d >= 0 ? 'ahead of target so far' : 'behind target so far'}>{d >= 0 ? `+${d}` : `−${Math.abs(d)}`}</div>;
};

const Tile = ({ label, value, sub, target = null, targetLabel = 'Target', gap = false, gapValue = null, tone = 'text-white', compact, tv = false, hint = '', foot = null, onOpen = null }) => (tv ? (
  // TV mode: big numbers that read from across the line
  <div title={hint || undefined} className="rounded-xl bg-white/[.07] border border-white/10 min-w-0 min-h-0 overflow-hidden px-3 py-1.5 flex flex-col justify-center gap-1">
    <div className="text-fs-20 leading-tight font-extrabold text-white truncate" title={label}>{label}</div>
    {/* big value on the left; the target (and ahead / behind) small on the right — one row, nothing gets cut */}
    <div className="flex min-w-0 items-end justify-between gap-2">
      <div className={`shrink-0 whitespace-nowrap font-mono tabular-nums font-extrabold leading-none ${tvNum(value, target != null)} ${tone}`}>{value}</div>
      {target != null && (
        <div className="min-w-0 text-right leading-none">
          <div className="text-fs-15 font-bold text-sky-100">{targetLabel}</div>
          <div className={`mt-1 whitespace-nowrap font-mono tabular-nums font-extrabold text-sky-300 ${String(target).length > 4 ? 'text-fs-20' : 'text-fs-22'}`}>{target}</div>
          {gap && <GapText value={gapValue ?? value} target={target} />}
        </div>
      )}
    </div>
    {target == null && sub && <div className="text-fs-15 leading-tight font-semibold text-white/95 truncate">{sub}</div>}
    {foot && <div className="text-fs-15 leading-tight font-bold text-sky-100 truncate">{foot}</div>}
  </div>
) : (
  <div title={hint || undefined} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen || undefined} onKeyDown={onOpen ? (e) => e.key === 'Enter' && onOpen() : undefined}
    className={`rounded-lg bg-white/[.07] border border-white/10 min-w-0 ${onOpen ? 'cursor-pointer hover:bg-white/[.12]' : hint ? 'cursor-help' : ''} ${compact ? 'px-1.5 py-1' : 'px-2.5 py-1.5'}`}>
    <div className={`${compact ? 'text-fs-11' : 'text-fs-12'} font-bold uppercase tracking-wide leading-tight text-sky-100 break-words`}>{label}{hint && <span className="ml-1 normal-case font-normal text-sky-200/80" aria-hidden>ⓘ</span>}</div>
    <div className={`font-mono tabular-nums ${compact ? 'text-base' : 'text-2xl'} font-extrabold leading-tight truncate ${tone}`}>{value}</div>
    {/* target: a bright pill so it reads from a distance on the dark card */}
    {target != null
      ? (compact
        ? <><div className="mt-0.5 text-fs-11 font-bold leading-none text-sky-100">{targetLabel}</div><div className="mt-0.5 inline-block max-w-full truncate rounded bg-white px-1 font-mono text-fs-14 font-extrabold leading-[18px] text-dixon-navy">{target}</div></>
        : <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1"><div className="inline-flex max-w-full items-center gap-1 rounded bg-white px-1.5 py-px font-mono text-fs-13 font-extrabold text-dixon-navy"><span className="font-sans text-[#475569]">{targetLabel}</span><span className="truncate">{target}</span></div>{gap && <Gap value={gapValue ?? value} target={target} />}</div>)
      : sub && <div className={`${compact ? 'text-fs-11' : 'text-fs-12'} font-semibold text-slate-200 truncate`}>{sub}</div>}
    {/* the foot wraps onto a second line in a narrow tile (phones) instead of being cut ("412 no cyc…") */}
    {foot && <div className={`${compact ? 'text-fs-11' : 'text-fs-12'} mt-0.5 font-bold leading-tight text-sky-100 break-words`}>{foot}</div>}
  </div>
));

/**
 * Details of the running model (16-11-2026), opened by a click on the model or on its cycle:
 * company / model / segment from the Model master, whether the master has its cycle time (no cycle in the master =
 * no target on a Method D line), the target in force and the actual cycle of its continuous run.
 */
function ModelDetails({ model, company, mRow, target, cycle, run, onClose }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const inMaster = !!mRow; const mCyc = Number(mRow?.cycle) > 0 ? Number(mRow.cycle) : null;
  const status = !inMaster
    ? ['bg-red-50 text-red-800 border-red-200', 'Not in the Model master — no target is set for this model.', 'Add it with its cycle time in Setup → Masters → Model master; the target comes from there.']
    : !mCyc
      ? ['bg-amber-50 text-amber-800 border-amber-200', 'In the Model master without a cycle time — no target is set.', 'Fill its cycle time in Setup → Masters → Model master.']
      : ['bg-emerald-50 text-emerald-800 border-emerald-200', `In the Model master · cycle time ${mCyc} s`, 'The target of this model comes from the master.'];
  const hms = (t) => String(t || '').slice(11, 19);
  const rows = [
    ['Company', company || mRow?.company || '—'], ['Model', model || '—'],
    ...(mRow ? [['Material code', mRow.code], ['Description', mRow.desc], ['Segment', mRow.segment], ['Capacity', mRow.capacity], ['Type', mRow.type]].filter(([, v]) => v) : []),
    ['Target cycle', target ? `${target} s · ${Math.floor(3600 / Number(target))} pcs/hr` : '— (no target)'],
    ['Actual cycle', cycle != null ? `${fmtSeconds(cycle)}${run?.runFirst ? ` · since ${hms(run.runFirst)}, ${run.runQty} pcs in a row` : ''}` : '— (needs 2 pieces in a row)'],
    ...(target && cycle != null ? [['Against target', cycle <= Number(target) ? 'At or faster than target' : `${(cycle - Number(target)).toFixed(1)} s slower per piece`]] : []),
    ...(run?.qty != null ? [['Made today', `${run.qty} pcs${run.firstScan ? ` · first ${hms(run.firstScan)}` : ''}${run.lastScan ? ` · last ${hms(run.lastScan)}` : ''}`]] : []),
  ];
  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end" role="dialog" aria-modal="true" aria-label={`Model ${model} details`}>
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close details" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[460px] flex-col bg-white text-slate-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="min-w-0 truncate text-fs-18 font-extrabold">{model || 'Model'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md px-2 py-1 text-fs-16 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className={`rounded-lg border px-3 py-2 text-fs-14 ${status[0]}`} role="status"><b>{status[1]}</b><div className="mt-0.5 text-fs-13">{status[2]}</div></div>
          <dl className="mt-3 divide-y divide-slate-100 text-fs-14">
            {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-slate-600">{k}</dt><dd className="text-right font-semibold break-all">{v}</dd></div>)}
          </dl>
          <p className="mt-3 text-fs-12 text-slate-500">Actual cycle = (last scan − first scan of this run − lunch / breaks) ÷ (pieces − 1), every gap counted.</p>
        </div>
      </aside>
    </div>, document.body);
}

/**
 * Props: total, hourLabel, hourQty, model, avgCycle, hours, nowHour, active, refreshing, updated, focusDate, intervalSec
 * title (card heading), accent (top border colour), compact (fills its grid cell: used for the 2×2 "all lines" screen), hourModels.
 */
export default function LiveLine({ total, hourLabel, hourQty, model, company, avgCycle, hours, nowHour, active, refreshing, updated, focusDate, intervalSec = 5,
  title = 'Live Production Line', accent = null, compact = false, hourModels = null, paused = false, onResume = null,
  targetPph = null, targetCycle = null, hourTarget = null, currentCycle = null, modelCycle = null, lunch = null, tv = false, hourTargets = null, hourNoTarget = null, offline = null, wall = false, modelCompany = null, oldDay = null, lag = null , run = null, tvWall = false}) {
  // the running model's segment (and capacity) from the Model master, shown with the model on the TV and the live card
  const mRow = useMasterRow(model ? { model, company } : null);
  const segment = [mRow?.segment, mRow?.capacity].filter(Boolean).join(' · ');
  const [showModel, setShowModel] = useState(false);   // the running model's details (click on the model or its cycle)
  const uid = `lp${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // management TV wall: the card measures itself — a tall card (1 or 2 lines on the screen) gets a stacked layout, and
  // every number grows with the card (k), so no space stays empty whatever the TV and however many lines are chosen
  const wallRef = useRef(null);
  const [wbox, setWbox] = useState({ w: 700, h: 330 });
  useEffect(() => {
    const el = wallRef.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setWbox({ w: el.offsetWidth || 700, h: el.offsetHeight || 330 }));
    ro.observe(el); return () => ro.disconnect();
  }, [wall, compact]);
  const tall = wbox.h > wbox.w * 0.62;
  let lpAll = (lp) => lp;   // wall tiles: one label size for all four (set where the tiles are drawn)
  // wall tiles: the text sizes come from the card's room; a last check after drawing shrinks a tile's text (--fit) when it
  // still does not fit its tile (17-11-2026: "Today" / "/599" / "no cycle time" were cut at some screen sizes)
  const tilesRef = useRef(null);
  const tilesSig = useRef('');
  const fitTiles = (force = false) => {
    const g = tilesRef.current;
    if (!g) return;
    const sig = `${g.clientWidth}x${g.clientHeight}|${g.textContent}`;   // measure again only when the room or the text changed
    if (!force && sig === tilesSig.current) return;
    tilesSig.current = sig;
    for (const tile of g.children) {
      if (!(tile instanceof HTMLElement)) continue;
      let k = 1;
      for (let pass = 0; pass < 3; pass++) {
        tile.style.setProperty('--fit', String(k));
        const cs = getComputedStyle(tile);
        const availH = tile.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const availW = tile.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const kids = [...tile.children].filter((c) => c instanceof HTMLElement);
        if (!kids.length || availH <= 0 || availW <= 0) break;
        // page px throughout (offsetTop / offsetHeight, not the screen rectangle: TV mode scales the page)
        const top = Math.min(...kids.map((c) => c.offsetTop));
        const bot = Math.max(...kids.map((c) => c.offsetTop + c.offsetHeight));
        const needH = bot - top, needW = Math.max(...kids.map((c) => c.scrollWidth));
        const f = Math.min(availH / Math.max(1, needH), availW / Math.max(1, needW));
        if (f >= 0.995) break;
        k = Math.max(0.55, k * f * 0.98);
      }
      tile.style.setProperty('--fit', String(k));
    }
  };
  useLayoutEffect(() => { fitTiles(false); });
  useEffect(() => {
    // the tiles also change size without this card drawing again (the bars or the model list below them, fonts arriving)
    const g = tilesRef.current;
    if (!g || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fitTiles(true)); };
    const ro = new ResizeObserver(again);
    ro.observe(g);
    for (const t of g.children) ro.observe(t);
    document.fonts?.ready?.then(again);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [wall, compact, tall]);   // eslint-disable-line react-hooks/exhaustive-deps
  const k = Math.max(1, Math.min(2.2, tall ? wbox.w / 600 : Math.min(wbox.w / 700, wbox.h / 320)));
  const px = (n) => ({ fontSize: `calc(${Math.round(n * k)}px * var(--fs-tv, 1))` });   // × TV text size of Setup → Theme
  // Animations run only while the card is on screen and the browser tab is visible (saves CPU, keeps the page fast).
  const cardRef = useRef(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(typeof document === 'undefined' ? true : !document.hidden);
  useEffect(() => {
    const onVis = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    let io;
    if (cardRef.current && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.05 });
      io.observe(cardRef.current);
    }
    return () => { document.removeEventListener('visibilitychange', onVis); io?.disconnect(); };
  }, []);
  const running = active && onScreen && tabVisible;
  const shown = useCountUp(total);
  const [cartons, setCartons] = useState([]);
  const [last, setLast] = useState({ n: 0, at: '', key: 0 });
  const prev = useRef({ date: null, total: null });

  useEffect(() => {
    if (total == null) return;
    const p = prev.current;
    if (p.date === focusDate && p.total != null && total > p.total) {
      const n = total - p.total, key = Date.now();
      setLast({ n, at: updated, key });
      // New cartons are added alongside older ones; the flow does not stop in between
      setCartons((old) => [
        ...old,
        // spread over the refresh interval, at least 6 s apart so only one machine is at a step at a time
        ...Array.from({ length: Math.min(n, 6) }, (_, i) => ({ id: `${key}-${i}`, delay: i * Math.max(6, Math.min(15, intervalSec / Math.max(1, n))) })),
      ].slice(-14));
    }
    prev.current = { date: focusDate, total };
  }, [total, focusDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // A carton is removed once it completes its journey and reaches the truck
  const removeCarton = (id) => setCartons((c) => c.filter((x) => x.id !== id));

  // paused = latest day, but live updates switched off by the user; SNAPSHOT = an older day (it cannot change)
  // line server offline: numbers come from the backup / last saved data (offline = { upTo, syncedAt, kind })
  const offTime = offline ? backupShort(offline, focusDate) : '';
  const status = oldDay ? [`NO SCANS TODAY · LAST ${String(oldDay).slice(8, 10)}-${String(oldDay).slice(5, 7)}`, 'bg-amber-500 text-white'] : offline ? [compact ? 'OFFLINE' : `OFFLINE${offTime ? ` · DATA UP TO ${offTime}` : ''}`, 'bg-red-600 text-white ring-2 ring-red-300/60'] : paused ? ['PAUSED', 'bg-slate-500/25 text-slate-200'] : !active ? ['SNAPSHOT', 'bg-slate-500/30 text-slate-200'] : (hourQty > 0 ? ['RUNNING', 'bg-sky-500/25 text-sky-300'] : ['WAITING FOR SCANS', 'bg-slate-500/25 text-slate-300']);
  const circ = 100;

  // hover text of every number: what it is and how it is worked out
  const tcTxt = targetCycle ? `${Number.isInteger(Number(targetCycle)) ? Number(targetCycle) : Number(targetCycle).toFixed(1)}s` : null;
  // cycle (14-11-2026): the target is set per model, so the big number is the RUNNING model's actual cycle today
  // (16-11-2026) no line average any more, on any screen: only the running model's own cycle ("—" while it is not known)
  const cyc = modelCycle ?? currentCycle;
  const lineFoot = null;
  const hourNt = nowHour != null ? Number(hourNoTarget?.[nowHour]?.qty) || 0 : 0;   // this hour's pieces without a target
  // this hour as on its bar (17-11-2026): with a target, the pieces of a model without a cycle time are not in the number
  // compared with the target — they are said under it ("N no cycle time"), like their own light-blue bar
  const hourShown = hourQty != null && hourTarget != null && hourNt > 0 ? Math.max(0, hourQty - hourNt) : hourQty;
  const H = {
    today: `Produced today: every good piece scanned on this line since the first scan of the day.`,
    hour: `This hour${hourLabel ? ` (${hourLabel})` : ''}: pieces scanned in this hour${hourLabel && hourLabel.includes(':') ? ' (lunch scans not counted)' : ''}${hourNt > 0 && hourTarget != null ? ` — ${hourNt} pcs of a model without a cycle time are not in this number (own light-blue bar)` : ''}.`
      + (hourTarget != null && tcTxt ? `\nTarget ${hourTarget} = working seconds of the hour so far ÷ target cycle ${tcTxt} (rises through the hour).` : '\nNo target cycle for this model.'),
    cycle: `Model cycle: actual time per piece of the running model${model ? ` (${model})` : ''} since it started on the line this time — (last scan − its first scan − lunch / breaks) ÷ (pieces − 1), every gap counted — compared with that model's target cycle.`
      + (tcTxt ? `\nTarget cycle ${tcTxt} = the line's target method (Line target method page — Method D: cycle time of the Model master) + allowance.` : '')
      + (cyc != null && tcTxt ? `\n${cyc <= Number(targetCycle) ? 'At or faster than target.' : `${(cyc - Number(targetCycle)).toFixed(1)} s slower than target per piece.`}` : ''),
    fresh: `New pieces since the last refresh (every ${intervalSec} s).`,
    bars: `Output by hour: pieces scanned in each hour. Yellow = current hour. Striped = lunch (its own scans). The hour after lunch (e.g. 13:30) is shorter, so its target is smaller. Click a bar for the models.`,
  };
  // target of the day so far (sum of the hour targets up to now) and the pieces of every model made today
  const dayTarget = hourTargets ? Object.values(hourTargets).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  // pieces of models without a target today (not in the master / no cycle): not counted against the target (16-11-2026)
  const noTgtDay = hourNoTarget ? Object.values(hourNoTarget).reduce((a, x) => a + (Number(x?.qty) || 0), 0) : 0;
  const noTgtNames = hourNoTarget ? [...new Set(Object.values(hourNoTarget).flatMap((x) => x?.models || []))] : [];
  const tgtTotal = total != null ? Math.max(0, total - noTgtDay) : null;
  const achDay = dayTarget > 0 && tgtTotal != null ? ((tgtTotal / dayTarget) * 100).toFixed(1) : null;   // one decimal (18-11-2026)
  const noTgtTxt = noTgtDay > 0 ? `${noTgtDay} no cycle time` : '';
  const todayHint = H.today + (dayTarget > 0 ? `\nTarget ${Math.round(dayTarget)} = sum of the hour targets up to now (only the time of models with a target).` : '')
    + (noTgtDay > 0 ? `\n${noTgtDay} pcs of models without a target (${noTgtNames.join(', ') || 'not in the Model master'}) are not counted in Achieved.` : '')
    + (achDay != null ? `\nAchieved ${achDay}% = ${tgtTotal} pcs with a target ÷ target ${Math.round(dayTarget)}.` : '');
  const modelsToday = useMemo(() => {
    const by = new Map();
    const co = (m) => m.company || m.companyTitle || (modelCompany && m.mmId != null ? modelCompany[String(m.mmId)] : '') || '';
    const add = (m, q) => {
      if (!m.model || !(q > 0)) return;
      const o = by.get(m.model) || { name: m.model, company: '', qty: 0 };
      o.qty += q; if (!o.company) o.company = co(m);
      by.set(m.model, o);
    };
    if (hourModels?.length) for (const m of hourModels) add(m, Number(m.qty) || 0);
    else for (const h of hours || []) for (const m of h.models || []) add(m, Number(m.quantity ?? m.qty) || 0);
    return [...by.values()].sort((a, b) => b.qty - a.qty);
  }, [hours, hourModels, modelCompany]);
  // pieces of the running model today (TV: shown with the model, 18-11-2026)
  const modelQty = model ? (run?.qty ?? modelsToday.find((m) => m.name === model)?.qty ?? null) : null;
  const tiles = (
    <>
      <Tile compact={compact} hint={todayHint} label={compact ? 'Today' : 'Produced today'} value={shown} sub={noTgtTxt ? `pcs · ${noTgtTxt}` : 'pcs'}
        target={dayTarget > 0 ? Math.round(dayTarget) : null} targetLabel="Target" gap gapValue={noTgtDay > 0 ? tgtTotal : null} foot={dayTarget > 0 && noTgtTxt ? noTgtTxt : null}
        tone="text-white" />
      <Tile compact={compact} hint={H.hour} label={compact ? 'This hour' : hourLabel ? `Hour ${hourLabel}` : 'This hour'} value={hourShown ?? '—'}
        sub={[hourLabel || '—', hourNt > 0 ? `${hourNt} no cycle time` : ''].filter(Boolean).join(' · ')} target={hourTarget != null ? hourTarget : null} targetLabel="Target" gap
        gapValue={hourShown} foot={hourTarget != null && hourNt > 0 ? `${hourNt} no cycle time` : null}
        tone="text-white" />
      <Tile compact={compact} hint={H.cycle} label="Model cycle" value={fmtSeconds(cyc)} onOpen={model ? () => setShowModel(true) : null}
        sub={!tcTxt && model ? (mRow ? (Number(mRow.cycle) > 0 ? 'No target' : 'No cycle in master') : 'Not in master') : compact ? 'actual' : 'Running model'} target={tcTxt} foot={lineFoot}
        tone="text-white" />
      <Tile compact={compact} hint={H.fresh} label={compact ? 'New' : 'New pieces'} value={last.n > 0 ? `+${last.n}` : '0'} sub={last.n > 0 ? `at ${last.at}` : (compact ? 'none' : 'Since refresh')} tone="text-white" />
    </>
  );

  // actual against target: green when met, red when behind (white when there is no target)
  const vsT = () => 'text-white';   // 14-11-2026: numbers stay plain (black on the light look); the colour is on the hour bars only
  const achTv = achDay;
  const tilesTv = tv && (
    <>
      {/* Today, like the 4-line wall: label with the target so far, the big number, Achieved under it */}
      <div title={todayHint} className="row-span-2 min-w-0 min-h-0 overflow-hidden rounded-xl bg-white/[.07] border border-white/10 px-4 py-3 flex flex-col justify-center gap-3" style={{ containerType: 'inline-size' }} aria-label="Produced today">
        <span className="text-fs-22 font-extrabold uppercase tracking-wide text-sky-100 whitespace-nowrap truncate">Today</span>
        {/* 23-11-2026: the big number on its own line, the target under it across the tile — a 4-digit day total
            (afternoon) left no room for the target beside it and cut it off */}
        {/* the size also follows the tile's width (container units): a long number on a small screen shrinks, never cut */}
        {/* 25-11-2026: a TV browser without container units (cqw) dropped the whole size and showed the number tiny — the plain
            size comes first in the CSS (.lp-tv-today), the width-fitted one after it is used only where it is understood */}
        <div className="lp-tv-today font-mono tabular-nums font-extrabold leading-none whitespace-nowrap text-white" style={{ '--tvn': `${String(shown ?? '').length > 4 ? 56 : 68}px`, '--tvw': `${(100 / (Math.max(3, String(shown ?? '').length) * 0.64)).toFixed(1)}cqw` }}>{shown ?? '—'}</div>
        {dayTarget > 0 && (
          <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 leading-none" title="Target so far" data-testid="tv-today-target">
            <span className="text-fs-15 font-bold text-sky-100">Target</span>
            <span className={`whitespace-nowrap font-mono tabular-nums font-extrabold text-sky-300 ${String(Math.round(dayTarget)).length > 4 ? 'text-fs-20' : 'text-fs-22'}`}>{Math.round(dayTarget)}</span>
            {(() => { const v = Number(String(shown).replace(/[^0-9.-]/g, '')); const d = Math.round(v - Math.round(dayTarget)); return Number.isFinite(v) && shown != null && shown !== '—'
              ? <span className={`whitespace-nowrap font-mono tabular-nums text-fs-15 font-extrabold ${d >= 0 ? 'text-emerald-300' : 'text-red-300'}`} title={d >= 0 ? 'ahead of target so far' : 'behind target so far'}>{d >= 0 ? `+${d}` : `−${Math.abs(d)}`}</span> : null; })()}
          </div>
        )}
        <div className="flex flex-col gap-1 border-t border-white/15 pt-3">
          <span className="text-fs-22 font-extrabold uppercase tracking-wide text-sky-100">Achieved</span>
          <span className="font-mono tabular-nums font-extrabold leading-none text-white" style={{ fontSize: 'calc(46px * var(--fs, 1))' }}>{achTv == null ? '—' : `${achTv}%`}</span>
          {noTgtDay > 0 && <span className="text-fs-18 font-bold text-sky-100 whitespace-nowrap" title={`${noTgtDay} pcs of models without a cycle time — not counted in Achieved`}>{noTgtDay} no cycle time</span>}
        </div>
      </div>
      <Tile tv hint={H.hour} label={hourLabel ? `Hour ${hourLabel}` : 'This hour'} value={hourShown ?? '—'} target={hourTarget != null ? hourTarget : null} targetLabel="Target" gap
        gapValue={hourShown} foot={hourNt > 0 ? `${hourNt} no cycle time` : null}
        tone={vsT(hourTarget > 0 && hourShown != null ? hourShown >= hourTarget : null)} />
      <Tile tv hint={H.cycle} label="Model cycle" value={fmtSeconds(cyc)} target={tcTxt} targetLabel="Target"
        tone={vsT(tcTxt && cyc != null ? cyc <= Number(targetCycle) : null)} />
    </>
  );

  return (
    <>
    {showModel && <ModelDetails model={model} company={company} mRow={mRow} target={targetCycle} cycle={cyc} run={run} onClose={() => setShowModel(false)} />}
    <section ref={cardRef} className={`rounded-2xl overflow-hidden border border-dixon-navy shadow-lg lp-tv-bg text-white min-w-0 ${compact || tv ? 'h-full flex flex-col' : ''}`}
      style={accent ? { borderTop: `4px solid ${accent}` } : undefined}>
      <style>{STYLE}</style>
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 shrink-0 ${compact ? 'px-3 pt-2' : tv ? 'px-5 pt-3 pb-1' : 'px-5 pt-4'}`}>
        <div className="min-w-[210px] flex-1">
          <h2 className={`${compact ? 'text-lg' : tv ? 'text-fs-42 leading-none' : 'text-xl sm:text-2xl'} font-extrabold tracking-tight leading-tight`}>{title}</h2>
          <p className={`${compact ? 'text-fs-13' : tv ? 'text-fs-24 mt-1 font-semibold' : 'text-fs-16'} text-sky-100 font-medium ${tv ? 'truncate' : 'lp-clamp2'}`}>
            {fmtDate(focusDate)} · {hourLabel ? `Hour ${hourLabel}` : 'No production hour'}{model && !tv && !wall ? ` · ${company ? `${company} · ` : ''}${model}` : ''}
          </p>
          {offline && (
            <p role="status" className={`${compact ? 'text-fs-12' : tv ? 'text-fs-20 mt-1' : 'text-fs-13 mt-0.5'} font-bold text-slate-300 truncate`}>
              Line server offline — {offline.kind === 'snapshot' ? 'last data read from the line' : 'local backup copy'}{offTime ? `, scans up to ${offTime}` : ''}. Live again by itself.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full ${tv ? 'px-4 py-1.5 text-fs-24' : `px-2.5 py-0.5 ${compact ? 'text-fs-12' : 'text-fs-13'}`} font-extrabold ${status[1]}`}>
            <span className={`${tv ? 'h-3.5 w-3.5' : 'h-2 w-2'} rounded-full ${offline ? 'bg-white animate-pulse' : active ? 'bg-sky-400 animate-pulse' : 'bg-slate-400'}`} />{compact ? status[0].replace('WAITING FOR SCANS', 'WAITING') : status[0]}
          </span>
          {paused && onResume && (
            <button type="button" onClick={onResume} title="Live updates are paused — click to resume"
              className={`rounded-full bg-sky-500 px-3 py-0.5 ${compact ? 'text-fs-12' : 'text-fs-13'} font-extrabold text-white shadow hover:bg-sky-400`}>
              ▶ Resume live
            </button>
          )}
          {lag && !offline && (() => {
            // the line ran today but answered slowly: numbers are of the last read (time shown), the card stays "running"
            // the time the numbers reach (the last scan in them), not the time of the copy
            const t = String(lag.upTo || lag.syncedAt || '').slice(11, 16);
            return t ? <span title={`The line's computer is answering slowly or not at all — these numbers are up to ${String(lag.upTo || lag.syncedAt).slice(11, 19)}${lag.syncedAt ? ` (copy of ${String(lag.syncedAt).slice(11, 16)})` : ''}. They update by themselves when the line answers again.`}
              className={`rounded-full bg-amber-500 px-2 py-0.5 ${tv ? 'text-fs-20' : compact ? 'text-fs-12' : 'text-fs-13'} font-extrabold text-white`}>Data till {t}</span> : null;
          })()}
          {active && compact && <span className="font-mono text-fs-13 font-bold tabular-nums text-sky-100">{updated || '—'}</span>}
          {active && !compact && (
            <div className="flex items-center gap-2" title={`Data refreshes every ${intervalSec} seconds`}>
              <svg width="30" height="30" viewBox="0 0 36 36" className={refreshing ? 'animate-spin' : ''}>
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3.5" />
                <circle key={updated} cx="18" cy="18" r="15.9" fill="none" stroke="rgb(var(--sky-400))" strokeWidth="3.5" strokeLinecap="round" pathLength={circ}
                  strokeDasharray={circ} style={{ animation: refreshing ? 'none' : `lpRing ${intervalSec}s steps(${intervalSec * 2}) forwards`, transform: 'rotate(-90deg)', transformOrigin: 'center' }} />
              </svg>
              <div className="leading-tight">
                <div className={`${tv ? 'text-fs-18' : 'text-fs-13'} text-sky-100 font-bold`}>{refreshing ? 'Refreshing…' : 'Last update'}</div>
                <div className={`font-mono ${tv ? 'text-fs-24' : 'text-fs-14'} font-extrabold tabular-nums`}>{updated || '—'}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {tv ? (
        // TV mode: fills the whole screen — animation (full width of its box) + big numbers on top, output by hour below
        <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 pt-2">
          <div className="flex-[1.1] min-h-0 grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.78fr)_minmax(0,1fr)] gap-3">
            <div className="min-h-0 min-w-0 rounded-xl bg-gradient-to-b from-blue-800/70 to-blue-950 border border-white/10 px-2 py-2 flex flex-col gap-1">
              <div className="flex items-center gap-3 px-1 min-w-0 shrink-0">
                <span className="shrink-0 rounded bg-sky-400/15 px-2.5 py-1 text-fs-18 font-extrabold uppercase tracking-wide text-sky-200">Model</span>
                <span role="button" tabIndex={0} onClick={() => model && setShowModel(true)} onKeyDown={(e) => e.key === 'Enter' && model && setShowModel(true)} aria-label={`Details of model ${model || ''}`} className="min-w-0 flex flex-col leading-tight cursor-pointer" title={[company, model].filter(Boolean).join(' · ')}>
                  {(company || segment) && <span className="text-fs-18 font-extrabold uppercase tracking-wide text-slate-300 truncate">{company}{company && segment ? ' · ' : ''}{segment && <span className="text-sky-200" aria-label={`Segment ${segment}`}>{segment}</span>}</span>}
                  <span className={`font-mono font-extrabold text-white break-words ${(model || '').length > 22 ? 'text-fs-20' : (model || '').length > 13 ? 'text-fs-24' : 'text-fs-30'}`}>{model ? wrapCode(model) : '—'}</span>
                </span>
                {modelQty != null && <span className="ml-auto shrink-0 rounded-lg bg-white/10 px-3 py-1 text-fs-20 font-extrabold uppercase tracking-wide text-sky-100" aria-label={`Running model qty ${modelQty}`}>Qty <span className="font-mono text-fs-30 text-white">{modelQty.toLocaleString('en-IN')}</span></span>}
              </div>
              <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                <Scene uid={uid} compact active={running} hourQty={hourShown} cartons={cartons} flashKey={last.key} deltaN={last.n} onDone={removeCarton} model={model} company={company} loaded={shown} />
              </div>
            </div>
            <TvModels list={modelsToday} running={model} total={total} />
            <div className="grid grid-cols-2 grid-rows-2 gap-2 min-h-0">{tilesTv}</div>
          </div>
          <div className="flex-[0.8] min-h-0 rounded-xl bg-white/[.07] border border-white/10 px-3.5 py-3 lp-tvbars">
            <HourBars hours={hours} nowHour={nowHour} hourModels={hourModels} lunch={lunch} targetPph={null} hourTargets={hourTargets} hourNoTarget={hourNoTarget} std />
          </div>
        </div>
      ) : compact && wall ? (
        // management TV wall: animation | numbers | models today, output by hour below — fills its part of the screen.
        // tall card (1–2 lines): animation + numbers on top, models today across, output by hour below, all bigger (k)
        <div ref={wallRef} className="flex-1 min-h-0 p-2 pt-1 flex flex-col gap-1.5">
          <div className={`min-h-0 grid gap-1.5 ${tall ? 'flex-[1.15] grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'flex-[1.12] grid-cols-[minmax(0,0.85fr)_minmax(0,1.1fr)_minmax(0,1fr)]'}`}>
            <div className="relative min-h-0 rounded-lg bg-gradient-to-b from-blue-800/70 to-blue-950 border border-white/10 overflow-hidden flex flex-col">
              <div role="button" tabIndex={0} onClick={() => model && setShowModel(true)} onKeyDown={(e) => e.key === 'Enter' && model && setShowModel(true)} aria-label={`Details of model ${model || ''}`} className="shrink-0 cursor-pointer px-1.5 pt-1 leading-tight" title={[company, model].filter(Boolean).join(' · ')}>
                {(company || segment) && <div className="font-extrabold uppercase tracking-wide text-sky-200 break-words" style={px(14)}>{company}{company && segment ? ' · ' : ''}{segment && <span className="text-white" aria-label={`Segment ${segment}`}>{segment}</span>}</div>}
                {(() => {
                  // the model on one line when it fits the box (smaller rather than "WT10C4260G / G"); a long code on two lines
                  const len = (model || '—').length, colW = tall ? (wbox.w - 22) / 2 : ((wbox.w - 28) * 0.85) / 2.95;
                  // 24-11-2026: wide letters (W, M) measured at 0.8 em — "MWMSA075GG" stays on one line, never "MWMSA075G / G"
                  const base = Math.round((len > 18 ? 15 : 18) * k), w1 = (colW - 16) / (0.8 * len);
                  if (w1 >= 10.5) return <div className="font-mono font-extrabold text-white whitespace-nowrap overflow-hidden" style={{ fontSize: `min(calc(${Math.floor(Math.min(base, w1))}px * var(--fs-tv, 1)), ${Math.floor(w1)}px)` }}>{model || '—'}</div>;
                  const f = Math.min(base, (colW - 16) / (0.8 * Math.ceil(len / 2)));
                  return <div className="font-mono font-extrabold text-white break-words" style={{ fontSize: `calc(${Math.max(10, Math.floor(f))}px * var(--fs-tv, 1))` }}>{model ? wrapCode(model) : '—'}</div>;
                })()}
                {modelQty != null && <div className="font-extrabold uppercase tracking-wide text-sky-100" style={px(14)} aria-label={`Running model qty ${modelQty}`}>Qty <span className="font-mono text-white" style={px(18)}>{modelQty.toLocaleString('en-IN')}</span></div>}
              </div>
              <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                <Scene uid={uid} compact lite active={running} hourQty={hourShown} cartons={cartons} flashKey={last.key} deltaN={last.n} onDone={removeCarton} model={model} company={company} loaded={shown} />
              </div>
            </div>
            <div ref={tilesRef} className="lp-fit grid grid-cols-2 grid-rows-2 gap-1 min-h-0">
              {(() => { const T = [['Today', dayTarget > 0 ? Math.round(dayTarget) : null], ['This hour', hourTarget], ['Cycle', tcTxt]];
                // one label size for every card on the wall (a target of up to 5 characters assumed), so the cards look the same
                lpAll = (lp, tW) => Math.max(12, Math.min(...T.map(([l]) => { const head = l.length * 0.66 * lp + 6 * 0.62 * lp + 10; return head > tW ? lp * (tW / head) : lp; })));
                return null; })()}
              {[
                // actual against target (13-11-2026): green when the target is met, red when behind; white without a target
                ['Today', shown, dayTarget > 0 ? Math.round(dayTarget) : null, 'text-white', todayHint],
                ['This hour', hourShown ?? '—', hourTarget, 'text-white', H.hour],
                ['Cycle', fmtSeconds(cyc), tcTxt || '—', 'text-white', tcTxt ? H.cycle : 'No target cycle for this model yet — set it in Line target method / Standard cycle time'],
              ].map(([lab, val, tgt, tone, hint], ti) => {
                // sizes from the tile's own room (the card can be small on a page, big on a TV): never cut, never wrapped
                const tW = tall ? (wbox.w - 22) / 4 - 14 : ((wbox.w - 28) * 1.1) / 2.95 / 2 - 14;
                const tH0 = tall ? ((wbox.h - 20) * 1.15) / 3.35 / 2 - 8 : ((wbox.h - 14) * 1.12) / 2.12 / 2 - 8;
                const tH = ti === 0 ? tH0 * 1.6 : tH0;   // Today takes the whole left column (with Achieved under it)
                const lp = Math.max(14, Math.min(tall ? 20 : 18, tH * 0.3));
                const head = String(lab).length * 0.66 * lp + (tgt != null ? (String(tgt).length + 5) * 0.62 * lp + 10 : 0);
                const lpx = lpAll(lp, tW);   // label + target on one line, the same size in all four tiles
                const withFoot = false;   // TV: no line average under the model's cycle (14-11-2026)
                // 23-11-2026: the TV writes "Target 61" too (was "/61"); 19-11-2026 (pages): the target on its own line under the number — "Target 1407"
                const tLine = tgt != null;   // 23-11-2026: TV too — "Target N" on its own line under the number (on the label line it got cut on a narrow tile)
                const vpx = Math.max(16, Math.min(tall ? 50 : 40, (tW - 6) / (0.66 * Math.max(2, String(val).length) + (String(val).includes('%') ? 0.25 : 0)), tH - lpx * (withFoot || tLine ? 2 : 1) - (withFoot || tLine ? 10 : 6)));   // % is wider than a digit
                const fz = (n) => ({ fontSize: `calc(${Math.round(n)}px * var(--fs-tv, 1) * var(--fit, 1))` });
                return (
                  <div key={lab} title={hint} className={`rounded-lg bg-white/[.07] border border-white/10 min-w-0 min-h-0 overflow-hidden px-2 py-1 flex flex-col justify-center gap-1 ${ti === 0 ? 'row-span-2' : ''}`}>
                    <div className="flex items-center justify-between gap-1 min-w-0">
                      <span className="leading-none font-extrabold uppercase tracking-wide text-sky-100 whitespace-nowrap" style={fz(lpx)}>{lab}</span>
                      {tgt != null && !tLine && <span className="shrink-0 whitespace-nowrap rounded bg-white px-1 font-mono font-extrabold leading-tight text-dixon-navy" style={fz(lpx)} title={lab === 'Cycle' ? 'Target cycle' : 'Target so far'}><span className="mr-1 font-sans font-bold uppercase" style={{ fontSize: '0.62em' }}>Target</span>{tgt}</span>}
                    </div>
                    <span className={`font-mono tabular-nums font-extrabold leading-none whitespace-nowrap ${tone}`} style={fz(vpx)}>{val}</span>
                    {tLine && <span className="flex min-w-0 items-center gap-1 whitespace-nowrap leading-none" style={fz(lpx * 0.9)} title={lab === 'Cycle' ? 'Target cycle' : 'Target so far'} data-testid="tile-target">
                      <span className="font-bold text-sky-100">Target</span><span className="rounded bg-white px-1 font-mono font-extrabold text-dixon-navy">{tgt}</span></span>}
                    {withFoot && <span className="leading-none font-bold text-sky-100 whitespace-nowrap" style={fz(lpx * 0.9)} title="Whole line today (every stop counts)">{lineFoot}</span>}
                    {ti === 0 && (() => {
                      // Achieved sits with Today: pieces of models with a target ÷ target so far (no-target pieces left out)
                      const ach = achDay;
                      return (
                        <div className="mt-0.5 flex flex-col gap-0.5 border-t border-white/15 pt-1" title={noTgtDay > 0 ? `${tgtTotal} pcs with a target ÷ target ${Math.round(dayTarget)} · ${noTgtDay} pcs without a target not counted` : 'Produced today ÷ target so far'}>
                          <span className="leading-none font-extrabold uppercase tracking-wide text-sky-100 whitespace-nowrap" style={fz(lpx)}>Achieved</span>
                          <span className={`font-mono tabular-nums font-extrabold leading-none whitespace-nowrap ${'text-white'}`}
                            style={fz(Math.max(14, Math.min(vpx * 0.7, (tW - 6) / (0.66 * String(ach ?? '—').length + 0.9))))}>{ach == null ? '—' : `${ach}%`}</span>
                          {noTgtDay > 0 && (() => {
                            // one line when it fits the tile, else "N pcs" over "no cycle time" (never cut at the tile edge)
                            const f0 = Math.max(11, lpx * 0.8), txt = `${noTgtDay} no cycle time`;
                            const f1 = Math.min(f0, (tW - 2) / (0.6 * txt.length)), one = f1 >= 10;   // one line down to 10 px
                            const f = one ? f1 : Math.max(10, Math.min(f0, (tW - 2) / (0.6 * 13)));
                            return (
                              <span className="leading-tight font-bold text-sky-100 whitespace-nowrap" style={fz(f)} data-testid="no-target-day" title={`${noTgtDay} pcs of models without a cycle time — not counted in Achieved`}>
                                {one ? txt : <>{noTgtDay} pcs<br />no cycle time</>}
                              </span>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {!tall && <TvModels sm list={modelsToday} running={model} total={total} />}
          </div>
          {tall && <div className="flex-[0.95] min-h-0 grid grid-cols-1 grid-rows-1"><TvModels list={modelsToday} running={model} total={total} cols={wbox.w > 760 ? 2 : 1} /></div>}
          <div className={`${tall ? 'flex-[1.25]' : 'flex-1'} min-h-0 rounded-lg bg-white/[.07] border border-white/10 p-1.5 min-w-0`}>
            <HourBars hours={hours} nowHour={nowHour} hourModels={hourModels} lunch={lunch} targetPph={null} hint={H.bars} hourTargets={hourTargets} hourNoTarget={hourNoTarget} small={!tall} std />
          </div>
        </div>
      ) : compact ? (
        <div className="flex-1 min-h-0 p-2 pt-1 flex flex-col gap-2">
          {/* top: animation | 4 tiles; below: output by hour across the full card width (target next to actual, andon colours) */}
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] shrink-0">
            <div className="relative rounded-lg bg-gradient-to-b from-blue-800/70 to-blue-950 border border-white/10 overflow-hidden aspect-[950/274] self-center">
              <Scene uid={uid} compact lite active={running} hourQty={hourShown} cartons={cartons} flashKey={last.key} deltaN={last.n} onDone={removeCarton} model={model} company={company} loaded={shown} />
              {model && (
                <span className={`absolute left-2 top-1 max-w-[94%] break-words rounded bg-black/75 px-1.5 py-0.5 ${`${company || ''}${model}`.length > 28 ? 'text-fs-12' : 'text-fs-13'} leading-tight font-extrabold text-white`} title={[company, model].filter(Boolean).join(' · ')}>
                  {company && <span className="text-slate-300">{company} · </span>}<span className="font-mono">{wrapCode(model)}</span>
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-2 gap-1 content-center">{tiles}</div>
          </div>
          <div className="flex-1 rounded-lg bg-white/[.07] border border-white/10 p-1.5 min-w-0 min-h-[150px]">
            <HourBars hours={hours} nowHour={nowHour} hourModels={hourModels} lunch={lunch} targetPph={null} hint={H.bars} hourTargets={hourTargets} hourNoTarget={hourNoTarget} small std />
          </div>
        </div>
      ) : (
        // Line diagram on the left; numbers and output by hour on the right (keeps the card short).
        <div className="grid gap-3 p-4 pt-2 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="rounded-xl bg-gradient-to-b from-blue-800/70 to-blue-950 border border-white/10 px-2 pt-2 pb-2 flex flex-col justify-center gap-1.5 min-w-0">
            {/* running model in plain readable text */}
            <div className="flex items-center gap-2 px-1 min-w-0">
              <span className="shrink-0 rounded bg-sky-400/15 px-1.5 py-0.5 text-fs-11 font-extrabold uppercase tracking-wide text-sky-300">Model</span>
              <button type="button" onClick={() => model && setShowModel(true)} aria-label={`Details of model ${model || ''}`} className="min-w-0 break-words text-left font-mono text-fs-16 font-extrabold leading-tight text-white underline decoration-white/30 underline-offset-4 hover:decoration-white" title="Click for the model's details">
                {company && <span className="text-slate-300">{company} · </span>}{model ? wrapCode(model) : '—'}
              </button>
              {segment && <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-fs-12 font-bold text-sky-100" aria-label={`Segment ${segment}`}>{segment}</span>}
              {last.n > 0 && <span className="ml-auto shrink-0 text-fs-13 text-slate-300 font-bold">+{last.n} pcs at {last.at}</span>}
            </div>
            <div className="mx-auto w-full max-w-[820px]">
              <Scene uid={uid} active={running} hourQty={hourShown} cartons={cartons} flashKey={last.key} deltaN={last.n} onDone={removeCarton} model={model} company={company} loaded={shown} />
            </div>
            <ol className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-fs-12 font-bold text-slate-200" aria-label="Packing steps">
              {[['Scan', 'bg-sky-300'], ['Poly wrap', 'bg-sky-300'], ['Thermocol', 'bg-slate-100'], ['Carton (MRP printed)', 'bg-slate-400'], ['3 straps', 'bg-blue-400'], ['Truck', 'bg-sky-400']].map(([t, c], i) => (
                <li key={t} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-slate-300">→</span>}
                  <i className={`inline-block h-2.5 w-2.5 rounded-sm ${c}`} />{t}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col gap-2.5 min-w-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4 gap-2">{tiles}</div>
            {modelsToday.length > 0 && (
              <div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-white/[.07] border border-white/10 px-3 py-2" aria-label="Models today">
                <div className="text-fs-12 font-bold uppercase tracking-wide text-sky-100 mb-1.5">Models today · {modelsToday.length}</div>
                {/* one row per model with its share of today's pieces: the panel fills the height next to the scene */}
                <ul className="grid gap-1.5">
                  {modelsToday.map((m) => {
                    const on = model && m.name === model;
                    const share = total > 0 ? Math.min(100, (m.qty / total) * 100) : 0;
                    return (
                      <li key={m.name} className={`rounded-md px-2 py-1 ${on ? 'bg-sky-400/15 ring-1 ring-sky-300/70' : 'bg-white/[.06]'}`}>
                        <div className="flex items-baseline gap-2">
                          <span className={`min-w-0 flex-1 break-words font-mono text-fs-13 font-bold ${on ? 'text-white' : 'text-slate-100'}`}>{m.company && <span className="mr-1 font-sans text-fs-11 font-extrabold uppercase tracking-wide text-sky-300">{m.company}</span>}{on ? '▶ ' : ''}{wrapCode(m.name)}</span>
                          <span className="shrink-0 font-mono tabular-nums text-fs-16 font-extrabold text-white">{m.qty.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-sky-400" style={{ width: `${share}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          {/* output by hour across the full width of the card: the whole shift, target next to actual (andon colours) */}
          <div className="xl:col-span-2 rounded-xl bg-white/[.07] border border-white/10 px-3.5 py-3 h-64">
            <HourBars hours={hours} nowHour={nowHour} hourModels={hourModels} lunch={lunch} targetPph={null} hint={H.bars} hourTargets={hourTargets} hourNoTarget={hourNoTarget} std />
          </div>
        </div>
      )}
    </section>
    </>
  );
}