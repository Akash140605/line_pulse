/*
 * Minimal stand-in for `vitest` so the *.calc.test.js files can run with plain Node where vitest
 * is not installed. tests/run-calc.mjs bundles each test file with esbuild and aliases `vitest` to this file.
 * With vitest installed, `npm test` runs the same files with the real vitest instead.
 *
 * Supported: describe / it / test (+ .skip), beforeEach, and expect(x)
 *   .toBe .toEqual .toMatchObject .toStrictEqual .toBeCloseTo .toBeNull .toBeUndefined .toBeDefined .toBeTruthy .toBeFalsy .toBeNaN
 *   .toBeGreaterThan(OrEqual) .toBeLessThan(OrEqual) .toHaveLength .toContain .toMatch .toThrow  and  .not.<any>
 */
const tests = [];
const stack = [];
const hooks = [[]];

export function describe(name, fn) {
  stack.push(name);
  hooks.push([...hooks[hooks.length - 1]]);
  try { fn(); } finally { stack.pop(); hooks.pop(); }
}
describe.skip = () => {};

export function it(name, fn) {
  tests.push({ name: [...stack, name].join(' › '), fn, before: [...hooks[hooks.length - 1]] });
}
it.skip = (name) => tests.push({ name: [...stack, name].join(' › '), skip: true });
export const test = it;
export function beforeEach(fn) { hooks[hooks.length - 1].push(fn); }

/* ── deep equality (vitest toEqual semantics: undefined properties are ignored) ── */
function eq(a, b, strict) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i], strict)) return false;
    return true;
  }
  const keys = (o) => Object.keys(o).filter((k) => strict || o[k] !== undefined);
  const ka = keys(a), kb = keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !eq(a[k], b[k], strict)) return false;
  return true;
}

const show = (v) => {
  try {
    if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
    if (typeof v === 'number' || v === undefined) return String(v);
    const s = JSON.stringify(v);
    return s && s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch { return String(v); }
};

export function expect(actual) {
  const make = (negate) => {
    const check = (pass, msg) => {
      if (pass === negate) throw new Error(`expected ${show(actual)} ${negate ? 'not ' : ''}${msg}`);
    };
    const m = {
      toBe: (e) => check(Object.is(actual, e), `to be ${show(e)}`),
      toEqual: (e) => check(eq(actual, e, false), `to equal ${show(e)}`),
      toMatchObject: (e) => check(actual != null && typeof actual === 'object' && Object.keys(e).every((k) => eq(actual[k], e[k], false)), `to match object ${show(e)}`),
      toStrictEqual: (e) => check(eq(actual, e, true), `to strictly equal ${show(e)}`),
      toBeCloseTo: (e, digits = 2) => check(typeof actual === 'number' && Math.abs(actual - e) < 10 ** -digits / 2, `to be close to ${e} (${digits} digits)`),
      toBeNull: () => check(actual === null, 'to be null'),
      toBeUndefined: () => check(actual === undefined, 'to be undefined'),
      toBeDefined: () => check(actual !== undefined, 'to be defined'),
      toBeTruthy: () => check(!!actual, 'to be truthy'),
      toBeFalsy: () => check(!actual, 'to be falsy'),
      toBeNaN: () => check(Number.isNaN(actual), 'to be NaN'),
      toBeGreaterThan: (e) => check(actual > e, `to be > ${e}`),
      toBeGreaterThanOrEqual: (e) => check(actual >= e, `to be >= ${e}`),
      toBeLessThan: (e) => check(actual < e, `to be < ${e}`),
      toBeLessThanOrEqual: (e) => check(actual <= e, `to be <= ${e}`),
      toHaveLength: (n) => check(actual != null && actual.length === n, `to have length ${n} (has ${actual?.length})`),
      toContain: (e) => check(actual != null && (typeof actual === 'string' ? actual.includes(e) : [...actual].some((x) => Object.is(x, e))), `to contain ${show(e)}`),
      toMatch: (re) => check(typeof actual === 'string' && (re instanceof RegExp ? re.test(actual) : actual.includes(re)), `to match ${re}`),
      toThrow: (e) => {
        let threw = false, err;
        try { actual(); } catch (x) { threw = true; err = x; }
        const okMsg = e == null || (e instanceof RegExp ? e.test(String(err?.message)) : String(err?.message).includes(e));
        check(threw && okMsg, `to throw${e ? ` ${e}` : ''}`);
      },
    };
    return m;
  };
  const pos = make(false);
  pos.not = make(true);
  return pos;
}

/* ── runner: starts after the test module has registered everything ── */
setTimeout(async () => {
  let pass = 0, fail = 0, skip = 0;
  for (const t of tests) {
    if (t.skip) { skip++; console.log(`  - ${t.name} (skipped)`); continue; }
    try {
      for (const b of t.before) await b();
      await t.fn();
      pass++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      fail++;
      console.log(`  ✗ ${t.name}\n      ${String(e?.message || e).split('\n').join('\n      ')}`);
    }
  }
  console.log(`__CALC_SUMMARY__ ${JSON.stringify({ pass, fail, skip })}`);
  if (fail) process.exitCode = 1;
}, 0);
