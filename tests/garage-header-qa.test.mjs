import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HEADER_BASELINE, loadHeaderBaseline, assertHeaderParity } from '../scripts/garage-header-baseline.mjs';

/** Synthetic geometry exercises the assertion contract, not browser rendering. */
function frames(height = 900) {
  const before = { header: { x: 0, y: 0, width: 1440, height: 82 }, brand: { x: 20, y: 20, width: 150, height: 40 }, account: { x: 1300, y: 20, width: 120, height: 44 }, controls: [{ name: 'Settings', x: 1370, y: 20, width: 44, height: 44 }], title: { x: 250, y: 130, width: 300, height: 45 }, titleFont: 'italic 40px serif' };
  const after = structuredClone(before); after.title.y -= height <= 500 ? 8 : 20;
  return { before, after };
}
test('default header QA loads the exact pinned baseline without an environment variable', async () => {
  const css = await loadHeaderBaseline();
  assert.equal(HEADER_BASELINE.commit, '28955fa9c838efe8537c88334ca23e09f7cf65aa');
  assert.ok(css.includes('.gs-header'));
  assert.ok(!css.includes('Open the garage roof between the original edge controls'));
});
test('missing, altered and self-comparison baseline files fail closed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'header-baseline-'));
  try {
    const file = path.join(dir, 'baseline.css');
    await assert.rejects(loadHeaderBaseline(file), { code: 'ENOENT' });
    await writeFile(file, await loadHeaderBaseline());
    assert.equal(await loadHeaderBaseline(file), await loadHeaderBaseline());
    await writeFile(file, (await loadHeaderBaseline()) + '\n');
    await assert.rejects(loadHeaderBaseline(file), /pinned pre-PR5 baseline/);
    await assert.rejects(loadHeaderBaseline(new URL('../styles/garage.css', import.meta.url)), /pinned pre-PR5 baseline/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('both approved desktop and short-screen title lifts preserve strict parity', () => {
  for (const height of [900, 500, 390, 375]) {
    const { before, after } = frames(height); assertHeaderParity(before, after, height);
  }
});
for (const [label, mutate] of [
  ['header dimensions', f => { f.header.height++; }],
  ['brand position', f => { f.brand.x++; }],
  ['wallet position', f => { f.account.y++; }],
  ['control position', f => { f.controls[0].x++; }],
  ['control count', f => { f.controls.pop(); }],
  ['title width', f => { f.title.width++; }],
  ['title height', f => { f.title.height++; }],
  ['title horizontal position', f => { f.title.x++; }],
  ['title vertical position', f => { f.title.y++; }],
  ['title typography', f => { f.titleFont = '40px sans-serif'; }],
]) test(`header default parity rejects ${label} regression`, () => {
  const { before, after } = frames(); mutate(after); assert.throws(() => assertHeaderParity(before, after, 900));
});
test('missing measured baseline evidence is not an optional comparison', () => {
  const { before, after } = frames();
  assert.throws(() => assertHeaderParity(null, after, 900));
  assert.throws(() => assertHeaderParity(before, null, 900));
  assert.throws(() => assertHeaderParity(before, after, NaN));
  delete before.titleFont; assert.throws(() => assertHeaderParity(before, after, 900));
});
