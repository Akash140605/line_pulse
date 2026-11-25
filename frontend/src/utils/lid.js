/**
 * Lid type of a washing machine model: full glass / half glass / glass (type not written) / no glass.
 * Order: value chosen on the page → words in the master-list item name → hint in the model name → master list
 * without any glass word (= no glass) → unknown.
 */
import { masterItems } from '../config/modelWeights';

export const LID = {
  full: { sym: '●', label: 'Full glass', short: 'Full', cls: 'text-sky-700', xl: 'Full glass' },
  half: { sym: '◐', label: 'Half glass', short: 'Half', cls: 'text-indigo-700', xl: 'Half glass' },
  glass: { sym: '◎', label: 'Glass (type not written)', short: 'Glass', cls: 'text-teal-700', xl: 'Glass' },
  none: { sym: '○', label: 'No glass', short: 'No', cls: 'text-slate-500', xl: 'No glass' },
  unknown: { sym: '?', label: 'Not known — set it on the page', short: '?', cls: 'text-red-600', xl: 'Not known' },
};
export const LID_SOURCE = { manual: 'set on page', list: 'master list', name: 'model name' };

/** Lid words used in the master list ("HALF GLASS", "H.GL", "FGL", "(GL)" …). */
export function lidFromText(text) {
  const t = ` ${String(text || '').toUpperCase()} `;
  if (/HALF\s*-?\s*GLASS|HGLASS|\bH\.\s?GL(A|ASS)?\b|\bHGL\b/.test(t)) return 'half';
  if (/FULL\s*-?\s*GLAS|\bF\.\s?GL\b|\bFGL\b/.test(t)) return 'full';
  if (/GLASS|\bGLAS\b|\(GL\)|\bGL\b|-GL\b|\bGL[-/]/.test(t)) return 'glass';
  return null;
}

/** Hint in a model name: FG / FGL / FTG = full glass, HG / HGL = half glass, GL / TG = glass. */
export function lidFromModelName(name) {
  const n = String(name || '').toUpperCase().replace(/\s+/g, '');
  if (/FTG|FGL|FG(?![A-Z]{4})/.test(n)) return 'full';
  if (/HGL|HG(?![A-Z]{4})/.test(n)) return 'half';
  if (/GL|TG/.test(n)) return 'glass';
  return null;
}

export function lidType(m, manual) {
  if (manual && LID[manual] && manual !== 'unknown') return { type: manual, source: 'manual', item: null };
  const items = masterItems(m);
  for (const [item] of items) {
    const t = lidFromText(item);
    if (t) return { type: t, source: 'list', item };
  }
  const hint = lidFromModelName(m?.model);
  if (hint) return { type: hint, source: 'name', item: items[0]?.[0] || null };
  if (items.length) return { type: 'none', source: 'list', item: items[0][0] };
  return { type: null, source: null, item: null };
}
