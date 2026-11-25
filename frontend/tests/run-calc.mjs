#!/usr/bin/env node
/*
 * Runs the calculation tests (tests/*.calc.test.js) without vitest:
 * each file is bundled with esbuild (`vitest` aliased to tests/_vitest_shim.mjs) and executed with Node.
 *
 *   node tests/run-calc.mjs            # all calc test files
 *   node tests/run-calc.mjs spc        # only files whose name contains "spc"
 *
 * esbuild: the project's own package (installed with vite) is used through its JS API, which works on Windows too;
 * otherwise a binary from $ESBUILD or /opt/npm-tools is used.
 * With vitest installed, `npm test` (vitest run) runs the same files directly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
let esbuildApi = null;
try { esbuildApi = await import('esbuild'); } catch { /* not installed: fall back to a binary */ }
const esbuild = esbuildApi ? null : [process.env.ESBUILD, '/opt/npm-tools/node_modules/esbuild/bin/esbuild'].find((p) => p && existsSync(p));
if (!esbuildApi && !esbuild) { console.error('esbuild not found: run npm install (it comes with vite) or set ESBUILD=/path/to/esbuild'); process.exit(2); }

async function bundle(entry, outfile) {
  if (esbuildApi) {
    try {
      await esbuildApi.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', loader: { '.js': 'jsx' }, logLevel: 'error',
        external: ['xlsx'], alias: { vitest: join(here, '_vitest_shim.mjs') }, define: { 'import.meta.env': '{}' }, outfile, absWorkingDir: root });
      return { ok: true };
    } catch (e) { return { ok: false, err: String(e.message || e) }; }
  }
  const b = spawnSync(esbuild, [
    entry, '--bundle', '--format=esm', '--platform=node', '--loader:.js=jsx', '--log-level=error', '--external:xlsx',
    `--alias:vitest=${join(here, '_vitest_shim.mjs')}`, '--define:import.meta.env={}', `--outfile=${outfile}`,
  ], { cwd: root, encoding: 'utf8' });
  return { ok: b.status === 0, err: b.stderr || String(b.error || '') };
}

const filter = process.argv[2] || '';
const files = readdirSync(here).filter((f) => /\.calc\.test\.js$/.test(f) && f.includes(filter)).sort();
if (!files.length) { console.error('no calc test files found'); process.exit(2); }

const out = mkdtempSync(join(process.env.CALC_OUT || tmpdir(), 'calc-tests-'));
let pass = 0, fail = 0, skip = 0, broken = 0;
for (const f of files) {
  const outfile = join(out, f.replace(/\.js$/, '.mjs'));
  const b = await bundle(join(here, f), outfile);
  if (!b.ok) { broken++; console.log(`\n${f}: BUILD FAILED\n${b.err}`); continue; }
  const r = spawnSync(process.execPath, [outfile], { cwd: root, encoding: 'utf8', env: { ...process.env, TZ: process.env.TZ || 'Asia/Kolkata' } });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const m = /__CALC_SUMMARY__ (\{.*\})/.exec(text);
  console.log(`\n${f}`);
  console.log(text.replace(/__CALC_SUMMARY__ .*\n?/, '').trimEnd());
  if (!m) { broken++; console.log('  (no summary: the file crashed)'); continue; }
  const s = JSON.parse(m[1]);
  pass += s.pass; fail += s.fail; skip += s.skip;
}
rmSync(out, { recursive: true, force: true });
console.log(`\n${files.length} files · ${pass} passed · ${fail} failed${skip ? ` · ${skip} skipped` : ''}${broken ? ` · ${broken} file(s) crashed` : ''}`);
process.exit(fail || broken ? 1 : 0);
