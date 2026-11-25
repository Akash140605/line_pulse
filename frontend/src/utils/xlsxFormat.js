/**
 * 20-11-2026: a cell value shown the way Excel shows it, from the cell's number format (styles.xml): 46296 with "d-mmm"
 * → 1-Oct, 0.9828 with "0.0%" → 98.3%, 1234.5 with "#,##0.00" → 1,234.50, the ₹ and accounting formats, times …
 * Used by the Report compare preview. Not all of Excel's format language: fractions, scientific numbers and
 * conditions ([>100]) fall back to the plain value. Digit grouping is Indian (12,34,567), as Excel shows it on an
 * Indian Windows.
 */

/** Excel's built-in formats by id (14 and 22 as an Indian Windows shows them) */
export const BUILTIN = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'dd-mm-yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'dd-mm-yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)', 42: '_("₹"* #,##0_);_("₹"* (#,##0);_("₹"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)', 44: '_("₹"* #,##0.00_);_("₹"* (#,##0.00);_("₹"* "-"??_);_(@_)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** a value with no format (General): long decimals cut to 4 places */
export function generalText(v) {
  const s = String(v ?? '');
  if (/^-?\d+\.\d{5,}$/.test(s)) return String(Math.round(Number(s) * 10000) / 10000);
  if (/^-?\d+(\.\d+)?E[-+]?\d+$/i.test(s)) { const n = Number(s); if (Number.isFinite(n) && Math.abs(n) < 1e15 && Math.abs(n) >= 1e-4) return String(Math.round(n * 10000) / 10000); }
  return s;
}

/** "a;b;c" → sections (not split inside quotes or after a backslash) */
function sections(code) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (q) { cur += c; if (c === '"') q = false; continue; }
    if (c === '"') { q = true; cur += c; continue; }
    if (c === '\\' && i + 1 < code.length) { cur += c + code[i + 1]; i++; continue; }
    if (c === ';') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

// one token of a format section
const TOK = /^(\[[^\]]*\]|"[^"]*"|\\.|_.|\*.|General|AM\/PM|A\/P|yyyy|yyy|yy|y|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|\.0+|E[-+]0+|[0#?,.%]|[\s\S])/i;
function tokens(sec) {
  const out = []; let s = sec;
  while (s.length) { const m = TOK.exec(s); out.push(m[1]); s = s.slice(m[1].length); }
  return out;
}
/** a literal token → its text ('' for padding / fill / colours / locale) */
function literal(t) {
  if (t[0] === '"') return t.slice(1, -1);
  if (t[0] === '\\') return t.slice(1);
  if ((t[0] === '_' || t[0] === '*') && t.length > 1) return '';                     // _x: the width of x · *x: fill
  if (t[0] === '[') { const m = /^\[\$([^-\]]*)/.exec(t); return m ? m[1] : ''; }   // [$₹-4009] → ₹ · [Red] [$-409] → ''
  return t;
}
const isDateTok = (t) => /^(y+|m+|d+|h+|s+|AM\/PM|A\/P|\[h+\]|\[m+\]|\[s+\])$/i.test(t);

/** an Excel day number (with the time as its fraction) in a date / time format */
function dateText(serial, toks, d1904) {
  // to the second, as Excel shows it (to the millisecond only with a ".0" in the format)
  const ms = toks.some((t) => /^\.0+$/.test(t)) ? Math.round(serial * 86400000) : Math.round(serial * 86400) * 1000;
  const base = d1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + ms);
  if (Number.isNaN(d.getTime())) return null;
  const ampm = toks.some((t) => /^(AM\/PM|A\/P)$/i.test(t));
  const dt = toks.map((t, i) => ({ t, i })).filter((x) => isDateTok(x.t));
  let out = '';
  toks.forEach((t, i) => {
    const lt = t.toLowerCase();
    if (!isDateTok(t)) { if (/^\.0+$/.test(t)) { out += `.${pad(Math.floor((ms % 1000) / 10 ** (3 - Math.min(3, t.length - 1))), t.length - 1)}`; return; } out += literal(t); return; }
    const k = dt.findIndex((x) => x.i === i);
    if (lt[0] === 'y') { out += lt.length <= 2 ? pad(d.getUTCFullYear() % 100) : String(d.getUTCFullYear()); return; }
    if (lt[0] === 'd') { out += lt === 'd' ? d.getUTCDate() : lt === 'dd' ? pad(d.getUTCDate()) : lt === 'ddd' ? DAY[d.getUTCDay()].slice(0, 3) : DAY[d.getUTCDay()]; return; }
    if (lt === '[h]' || lt === '[hh]') { out += Math.floor(serial * 24); return; }
    if (lt === '[m]' || lt === '[mm]') { out += Math.floor(serial * 1440); return; }
    if (lt === '[s]' || lt === '[ss]') { out += Math.floor(serial * 86400); return; }
    if (lt[0] === 'h') { let h = d.getUTCHours(); if (ampm) h = h % 12 || 12; out += lt.length > 1 ? pad(h) : h; return; }
    if (lt[0] === 's') { out += lt.length > 1 ? pad(d.getUTCSeconds()) : d.getUTCSeconds(); return; }
    if (lt === 'am/pm') { out += d.getUTCHours() < 12 ? 'AM' : 'PM'; return; }
    if (lt === 'a/p') { out += d.getUTCHours() < 12 ? 'A' : 'P'; return; }
    // m: minutes right after an hour or right before seconds, else the month
    const prev = dt[k - 1]?.t.toLowerCase() || ''; const next = dt[k + 1]?.t.toLowerCase() || '';
    if (lt.length <= 2 && (/^\[?h/.test(prev) || /^\[?s/.test(next))) { out += lt.length > 1 ? pad(d.getUTCMinutes()) : d.getUTCMinutes(); return; }
    const mo = d.getUTCMonth();
    out += lt === 'm' ? mo + 1 : lt === 'mm' ? pad(mo + 1) : lt === 'mmm' ? MON[mo] : lt === 'mmmm' ? MONTH[mo] : MONTH[mo][0];
  });
  return out;
}

/** a number in a number section (0 # ? , . % and the literals around) */
function numberText(v, toks0) {
  const toks = toks0.flatMap((t) => (/^\.0+$/.test(t) ? t.split('') : [t]));   // ".00" is one token for the seconds of a time
  const digit = (t) => /^[0#?]$/.test(t);
  const first = toks.findIndex((t) => digit(t) || t === '.');
  if (first < 0) return toks.map(literal).join('');   // no number in it ("-" for a zero)
  let last = first; while (last + 1 < toks.length && /^[0#?,.]$/.test(toks[last + 1])) last++;
  const pat = toks.slice(first, last + 1).join('');
  const [ip, dp = ''] = pat.split('.');
  let x = Math.abs(v) * (toks.includes('%') ? 100 : 1);
  const tail = /,+$/.exec(ip); if (tail) x /= 1000 ** tail[0].length;            // "#,##0," → thousands
  const minD = (dp.match(/0/g) || []).length; const maxD = (dp.match(/[0#?]/g) || []).length;
  const minI = (ip.match(/0/g) || []).length;
  const group = /[0#?],[0#?]/.test(ip);
  const f = 10 ** maxD; x = Math.round((x + Number.EPSILON) * f) / f;
  let num = x.toLocaleString('en-IN', { minimumFractionDigits: minD, maximumFractionDigits: maxD, useGrouping: group });
  if (minI === 0 && num.startsWith('0')) num = num.slice(1);                     // "#.00" → .50
  if (minI > 1) { const [a, b] = num.split('.'); num = (a.length < minI ? a.padStart(minI, '0') : a) + (b != null ? `.${b}` : ''); }
  return toks.slice(0, first).map(literal).join('') + num + toks.slice(last + 1).map(literal).join('');
}

/**
 * value (text as the sheet reader gives it) + format code → the text Excel shows; text values and the General format:
 * as they are (long decimals cut to 4 places).
 */
export function formatCell(value, code, d1904 = false) {
  const s = String(value ?? '');
  const n = s.trim() === '' ? NaN : Number(s);
  if (!code || /^general$/i.test(code) || code === '@' || !Number.isFinite(n)) return generalText(s);
  const secs = sections(code);
  if (secs.some((x) => /\[[<>=]/.test(x)) || secs.some((x) => /E[-+]0/i.test(x.replace(/"[^"]*"/g, '')))) return generalText(s);   // conditions, scientific
  let sec = secs[0]; let neg = false;
  if (n < 0 && secs.length > 1 && secs[1] !== '') sec = secs[1];
  else if (n < 0) neg = true;
  if (n === 0 && secs.length > 2 && secs[2] !== '') sec = secs[2];
  const toks = tokens(sec);
  if (toks.some((t) => /^general$/i.test(t))) return (neg ? '-' : '') + toks.map((t) => (/^general$/i.test(t) ? generalText(String(Math.abs(n))) : literal(t))).join('');
  if (toks.some(isDateTok)) {
    if (n < 0) return generalText(s);
    return dateText(n, toks, d1904) ?? generalText(s);
  }
  const out = numberText(n, toks);
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}
