/**
 * 24-11-2026: one standard for every target-vs-actual chart (not the TV screens):
 *   target = standard grey; actual = green when the target is met, orange when close, red when behind;
 *   pieces of a model without a cycle time sit on top of the actual bar in light blue (not counted against the target).
 */
export const TARGET_GREY = '#A6A6A6';
export const ACH_GREEN = '#16A34A', ACH_ORANGE = '#F59E0B', ACH_RED = '#F87171';   // 24-11-2026: red in a light shade
/** the % written as text: the light red is too faint on white, so the text keeps a deeper red */
export const achText = (c) => (c === ACH_RED ? '#DC2626' : c);
export const NO_CYCLE = '#7DD3FC';
export const ACH_ORANGE_FROM = 85;   // % of target: 85–99 orange, below red
/** colour of an actual against its target (null when there is no target) */
export function achColor(actual, target, none = '#2563EB') {
  const t = Number(target), a = Number(actual) || 0;
  if (!(t > 0)) return none;
  const p = (a / t) * 100;
  return p >= 100 ? ACH_GREEN : p >= ACH_ORANGE_FROM ? ACH_ORANGE : ACH_RED;
}
/** legend rows for a recharts <Legend payload> */
export const achLegend = (target = 'Target') => [
  { value: target, type: 'square', color: TARGET_GREY, id: 't' },
  { value: 'Achieved ≥ 100 %', type: 'square', color: ACH_GREEN, id: 'g' },
  { value: `${ACH_ORANGE_FROM}–99 %`, type: 'square', color: ACH_ORANGE, id: 'o' },
  { value: `Below ${ACH_ORANGE_FROM} %`, type: 'square', color: ACH_RED, id: 'r' },
];
