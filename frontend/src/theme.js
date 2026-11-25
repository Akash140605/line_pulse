/**
 * The look of Line Pulse in one place — every screen follows these rules. The admin sets colours, fonts and text size
 * once in Setup → Theme (utils/themeEngine.js); the default is the standard navy blue (#0B3A74, sidebar #0B2545).
 *
 * Colour code
 *   primary  blue-700        buttons, links, the chosen tab / chip (blue-* = the theme's primary, navy)
 *   data     sky-500 / 600   bars, rings, actual values; lighter sky = less (sky-* = the theme's data colour)
 *   neutral  slate-*         text (900 / 700 / 500), borders (200 / 300), backgrounds (50 / 100), "no target", future hours
 *   accent   red-600 / 700   errors, delete, values out of control limits, the "now" mark (red-* = theme accent)
 *   lines    LINE_COLOR      one fixed colour per line (dot / legend), never a status
 *   Two screens keep their own meaning on purpose: Plant overview (green / amber / red = plan reached / close / behind, the
 *   limit set in Setup → Plant overview) and Control charts (SPC limits).
 *
 * Type scale (px, classes text-fs-N = N px × the theme's text size; charts use fs(N)): 10 · 11 · 12 · 13 · 14 · 16 · 18 · 20 · 24 · 28 — body text 13–14, small labels 11–12,
 *   card titles 16–18, page titles 20–24; TV screens scale with the screen and may use bigger sizes.
 *   Numbers in tables and cards use the mono font with tabular figures.
 *
 * Formats: dates DD-MM-YYYY (fmtDate), numbers with Indian grouping (fmtNum), minutes as "1 h 05 m".
 * Space: pages use the full width of the screen (no fixed max width); cards sit in grids that fill the row.
 */
/** One colour per line (Setup → Theme can change them; utils/themeEngine.js updates this object in place). */
export const LINE_COLOR = { 1: '#2F6FD0', 2: '#12866F', 3: '#C9821A', 4: '#7A4FB8' };
/** good / medium / low colours of gauges and bars (the Dixon OEE standard sets its own) */
export const BAND = { ok: '#059669', mid: '#D97706', bad: '#DC2626', none: '#94A3B8', okBg: '#D1FAE5', midBg: '#FEF3C7', badBg: '#FEE2E2' };
let fontScale = 1;
/** Chart / SVG text size: n px × the text size chosen in Setup → Theme. */
export const fs = (n) => Math.round(n * fontScale * 10) / 10;
export const setFontScale = (k) => { fontScale = k > 0 ? k : 1; };
export const fmtDate = (s) => { const [y, m, d] = String(s || '').slice(0, 10).split('-'); return d ? `${d}-${m}-${y}` : '—'; };
export const fmtDateTime = (s) => (s ? `${fmtDate(s)} ${String(s).slice(11, 16)}`.trim() : '—');
export const fmtNum = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString('en-IN'));
