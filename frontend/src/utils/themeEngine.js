/**
 * Theme engine — the admin sets the look once (Setup → Theme) and every page, chart and TV screen follows.
 *
 * The colours are CSS variables on <html>; tailwind.config.js maps the colour families to them:
 *   blue-*  primary  (buttons, links, chosen tab, headers)    ← theme.primary (shade 800), standard navy #0B3A74
 *   sky-*   data     (bars, rings, actual values)             ← theme.data (shade 500), standard sky #0EA5E9
 *   red-*   accent   ("now", errors, delete)                  ← theme.accent (shade 600), standard red #DC2626
 *   --navy  dark panels and TV cards (= primary shade 900, #0B2545) · --sidebar the sidebar · --page the page background
 * The standard colours use the exact shade tables the app always had (EXACT), so the standard look is unchanged;
 * any other colour gets its shades worked out around it.
 * Text sizes: every text-fs-N class and chart label is N px × --fs (theme.scale %); TV wall numbers also × theme.tvScale %.
 * Fonts: theme.font / theme.mono — standard Archivo (built into the app: src/assets/fonts, the wide bold grotesque of the
 * Dixon logo; headings use its wide cut), or a Google font, or a font already on the PC such as Segoe UI / Consolas.
 * normalizeTheme() mirrors theme_clean() in backend/lib/ui.php.
 */
import { LINE_COLOR, BAND, setFontScale } from '../theme';

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
// lightness of each shade on a plain scale; the chosen colour is put at its anchor shade and the rest stretched around it
const TL = { 50: 97, 100: 93, 200: 86, 300: 76, 400: 64, 500: 53, 600: 45, 700: 37, 800: 28, 900: 20, 950: 13 };

export const FONTS = {
  archivo: { label: 'Archivo — Dixon style (built in, works offline)', css: '"Archivo"', g: null },
  plex: { label: 'IBM Plex Sans', css: '"IBM Plex Sans"', g: 'IBM+Plex+Sans:wght@400;500;600;700' },
  inter: { label: 'Inter', css: '"Inter"', g: 'Inter:wght@400;500;600;700' },
  roboto: { label: 'Roboto', css: '"Roboto"', g: 'Roboto:wght@400;500;700' },
  noto: { label: 'Noto Sans', css: '"Noto Sans"', g: 'Noto+Sans:wght@400;500;600;700' },
  poppins: { label: 'Poppins — Dixon MES style (built in, works offline)', css: '"Poppins"', g: null },
  segoe: { label: 'Segoe UI (on the PC, works offline)', css: '"Segoe UI"', g: null },
};
export const MONOS = {
  archivonum: { label: 'Archivo figures — Dixon style (built in, works offline)', css: '"Archivo"', g: null },
  plexmono: { label: 'IBM Plex Mono', css: '"IBM Plex Mono"', g: 'IBM+Plex+Mono:wght@400;500;600;700' },
  robotomono: { label: 'Roboto Mono', css: '"Roboto Mono"', g: 'Roboto+Mono:wght@400;500;700' },
  jetbrains: { label: 'JetBrains Mono', css: '"JetBrains Mono"', g: 'JetBrains+Mono:wght@400;500;700' },
  consolas: { label: 'Consolas (on the PC, works offline)', css: 'Consolas', g: null },
};

export const THEME_DEFAULT = {
  preset: 'navy',
  primary: '#0B3A74', accent: '#DC2626', data: '#0EA5E9', page: '#EEF1F5', sidebar: '#0B2545',
  lines: { 1: '#2F6FD0', 2: '#12866F', 3: '#C9821A', 4: '#7A4FB8' },
  font: 'archivo', mono: 'archivonum', scale: 100, tvScale: 100,
};
export const THEME_PRESETS = {
  // Dixon OEE Dashboard – UI Design Standard: six text levels H1–H6 and its colour palette on every page
  oee: { label: 'Dixon OEE standard (H1–H6 text + colour palette)', primary: '#1F3864', accent: '#C00000', data: '#2E75B6', page: '#F6F6F6', sidebar: '#1F3864', font: 'poppins', mono: 'archivonum', scale: 100 },
  navy: { label: 'Navy blue (standard)', ...THEME_DEFAULT },
  dixon: { label: 'Dixon logo colours', primary: '#231F5A', accent: '#DA2128', data: '#3B7DDD', page: '#EEF1F5', sidebar: '#231F5A' },
  // the look of the Dixon Production Management System (MES): navy #1F3864, Office blue #2E75B6, Poppins, square corners
  mes: { label: 'Dixon MES (same look as the Production Management System)', primary: '#1F3864', accent: '#C00000', data: '#2E75B6', page: '#E9EFF6', sidebar: '#1F3864', font: 'poppins', mono: 'archivonum' },
  charcoal: { label: 'Charcoal + Dixon red', primary: '#1F2937', accent: '#DA2128', data: '#3B7DDD', page: '#F1F2F4', sidebar: '#111827' },
  // 23-11-2026: four more ready looks
  teal: { label: 'Teal & coral', primary: '#0F5257', accent: '#D9480F', data: '#1497A8', page: '#EEF4F4', sidebar: '#0B3B3F' },
  forest: { label: 'Forest green', primary: '#1E4D2B', accent: '#C92A2A', data: '#2B8A3E', page: '#F0F4F0', sidebar: '#163A20' },
  plum: { label: 'Plum & rose', primary: '#4A2C6F', accent: '#D6336C', data: '#7048E8', page: '#F3F1F7', sidebar: '#33204D' },
  steel: { label: 'Steel blue & orange', primary: '#2F4858', accent: '#E8590C', data: '#33658A', page: '#EFF2F4', sidebar: '#22343F' },
};
const ANCHOR = { primary: 800, data: 500, accent: 600 };
// the shades the app always used for the standard colours (old Tailwind config + Tailwind sky / red)
const EXACT = {
  '800:#0B3A74': ['#EEF4FC', '#D8E6F8', '#B3CDF0', '#80ABE4', '#4682D2', '#1F64BF', '#0E56AE', '#0B468F', '#0B3A74', '#0B2545', '#06101F'],
  '500:#0EA5E9': ['#F0F9FF', '#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0EA5E9', '#0284C7', '#0369A1', '#075985', '#0C4A6E', '#082F49'],
  '600:#DC2626': ['#FEF2F2', '#FEE2E2', '#FECACA', '#FCA5A5', '#F87171', '#EF4444', '#DC2626', '#B91C1C', '#991B1B', '#7F1D1D', '#450A0A'],
};

const isHex = (v) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);
const hex = (v, d) => (isHex(v) ? v.toUpperCase() : d);
const clampN = (v, lo, hi, d) => { const n = Math.round(Number(v)); return v != null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function normalizeTheme(t, legacySidebar) {
  const x = t && typeof t === 'object' ? t : {};
  const d = THEME_DEFAULT;
  const lines = {};
  for (const l of ['1', '2', '3', '4']) lines[l] = hex(x.lines?.[l], d.lines[l]);
  return {
    preset: typeof x.preset === 'string' && (THEME_PRESETS[x.preset] || x.preset === 'custom') ? x.preset : 'navy',
    primary: hex(x.primary, d.primary), accent: hex(x.accent, d.accent), data: hex(x.data, d.data),
    page: hex(x.page, d.page), sidebar: hex(x.sidebar, isHex(legacySidebar) ? legacySidebar.toUpperCase() : d.sidebar),
    lines, font: FONTS[x.font] ? x.font : d.font, mono: MONOS[x.mono] ? x.mono : d.mono,
    scale: clampN(x.scale, 80, 130, 100), tvScale: clampN(x.tvScale, 80, 150, 100),
  };
}

// ── colour maths ──
const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [h * 60, s * 100, l * 100];
}
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
/** 11 shades ("r g b") around a colour that sits exactly at its anchor shade. */
export function shadesOf(color, anchor) {
  const ex = EXACT[`${anchor}:${String(color).toUpperCase()}`];
  if (ex) return Object.fromEntries(SHADES.map((s, i) => [s, toRgb(ex[i]).join(' ')]));
  const base = toRgb(color); const [h, s, l] = rgbToHsl(base); const ta = TL[anchor];
  const out = {};
  for (const sh of SHADES) {
    if (sh === anchor) { out[sh] = base.join(' '); continue; }
    const t = TL[sh];
    const L = t > ta ? l + ((t - ta) / (97 - ta)) * (97 - l) : l - ((ta - t) / (ta - 8)) * (l - 8);
    const S = t > ta ? Math.min(100, s * (1 + 0.15 * (t - ta) / (97 - ta))) : s;
    out[sh] = hslToRgb(h, S, Math.max(4, Math.min(98, L))).join(' ');
  }
  return out;
}
/** Contrast of white text on a colour (WCAG). 4.5 or more reads well. */
export function contrastWithWhite(color) {
  const lum = toRgb(color).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return 1.05 / (L + 0.05);
}

/** All CSS variables of a theme (also used to write the defaults in index.css). */
export function themeVars(t) {
  const v = {};
  for (const [fam, key] of [['blue', 'primary'], ['sky', 'data'], ['red', 'accent']]) {
    const sh = shadesOf(t[key], ANCHOR[key]);
    for (const s of SHADES) v[`--${fam}-${s}`] = sh[s];
  }
  v['--navy'] = v['--blue-900'];
  // dark TV / live-line cards: a lighter top-left and a darker corner around the navy
  const [nh, ns, nl] = rgbToHsl(v['--navy'].split(' ').map(Number));
  const exactNavy = v['--navy'] === '11 37 69';
  v['--tv-a'] = exactNavy ? '18 58 102' : hslToRgb(nh, ns, Math.min(60, nl + 9)).join(' ');
  v['--tv-c'] = exactNavy ? '8 25 47' : hslToRgb(nh, ns, Math.max(3, nl - 5)).join(' ');
  v['--sidebar'] = toRgb(t.sidebar).join(' ');
  v['--page'] = toRgb(t.page).join(' ');
  for (const l of ['1', '2', '3', '4']) v[`--line-${l}`] = t.lines[l];
  v['--fs'] = String(t.scale / 100);
  v['--fs-tv'] = String(t.tvScale / 100);
  v['--font-sans'] = `${FONTS[t.font].css}, "Segoe UI", system-ui, sans-serif`;
  v['--font-mono'] = `${MONOS[t.mono].css}, ui-monospace, Consolas, monospace`;
  return v;
}

let tvScaleNow = 1;
/** TV wall numbers: n px × the TV size chosen in Setup. */
export const tvScale = () => tvScaleNow;

/** Put the theme on the page (CSS variables, the fonts, line colours, chart text size). Safe to call again and again. */
export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  if (typeof document === 'undefined') return t;
  const root = document.documentElement;
  for (const [k, val] of Object.entries(themeVars(t))) root.style.setProperty(k, val);
  root.classList.add('lp-mes');   // Dixon MES look (fonts, sizes, bars, drawers): on for every page, every login, every preset (index.css)
  root.classList.toggle('lp-std', t.preset === 'oee');   // Dixon OEE standard: H1–H6 text sizes + its colours (index.css)
  Object.assign(BAND, t.preset === 'oee'
    ? { ok: '#2E9E5B', mid: '#E0A100', bad: '#C00000', none: '#8E8E8E', okBg: '#C6EFCE', midBg: '#FFEB9C', badBg: '#FFC7CE' }
    : { ok: '#059669', mid: '#D97706', bad: '#DC2626', none: '#94A3B8', okBg: '#D1FAE5', midBg: '#FEF3C7', badBg: '#FEE2E2' });
  for (const l of ['1', '2', '3', '4']) LINE_COLOR[l] = t.lines[l];
  setFontScale(t.scale / 100);
  tvScaleNow = t.tvScale / 100;
  const fams = [FONTS[t.font].g, MONOS[t.mono].g].filter(Boolean);
  const href = fams.length ? `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join('&')}&display=swap` : '';
  let link = document.getElementById('lp-theme-fonts');
  if (href && (!link || link.getAttribute('href') !== href)) {
    if (!link) { link = document.createElement('link'); link.id = 'lp-theme-fonts'; link.rel = 'stylesheet'; document.head.appendChild(link); }
    link.setAttribute('href', href);
  }
  return t;
}

// The saved theme (from the server) vs a preview the admin is trying in Setup → Theme before saving.
let saved = THEME_DEFAULT; let preview = null;
/** Saved theme from the server: used unless the admin is previewing another one. */
export function applySavedTheme(theme) { saved = theme || THEME_DEFAULT; if (!preview) applyTheme(saved); }
/** Setup → Theme: show a theme on this screen only (null = back to the saved one). */
export function previewTheme(theme) { preview = theme || null; applyTheme(preview || saved); }
