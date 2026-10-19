import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { handlingReport, measureArrowPedalControls } from '../scripts/measure-player-handling.mjs';

test('retired thumbpad files, production selectors and test stub are removed', async () => {
  for (const path of ['src/thumb-drive.js', 'styles/thumb-drive.css', 'tests/thumb-drive.test.mjs']) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), { code: 'ENOENT' });
  }
  const css = await readFile(new URL('../styles/app.css', import.meta.url), 'utf8');
  const garage = await readFile(new URL('./garage-integration.test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /data-thumb-drive/);
  assert.doesNotMatch(garage, /createThumbDrive/);
});

test('active source, script and test imports cannot depend on the retired controller', async () => {
  for (const directory of ['src', 'scripts', 'tests']) {
    const base = new URL(`../${directory}/`, import.meta.url);
    for (const name of await readdir(base, { recursive: true })) {
      if (!/\.(?:m?js)$/.test(name)) continue;
      const source = await readFile(new URL(name, base), 'utf8');
      assert.doesNotMatch(source, /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'][^"']*thumb-drive(?:\.[cm]?js)?["']/, `${directory}/${name}`);
    }
  }
});

test('measurement samples use current independent held arrows and pedals', () => {
  const axes = measureArrowPedalControls().map(({ scenario, steer, throttle, brake, ...controls }) => {
    assert.deepEqual(controls, { boost: false, flight: false, horn: false, roll: 0 });
    return [scenario, steer, throttle, brake];
  });
  assert.deepEqual(axes, [
    ['neutral', 0, 0, 0],
    ['right', 1, 0, 0],
    ['right-and-gas', 1, 1, 0],
    ['opposite-arrows-and-gas', 0, 1, 0],
    ['left-and-gas', -1, 1, 0],
    ['left-and-both-pedals', -1, 1, 1],
    ['left-and-brake', -1, 0, 1],
    ['brake', 0, 0, 1],
    ['released', 0, 0, 0],
  ]);
});

test('handling report retains response and braking but replaces retired pad samples', () => {
  const report = handlingReport();
  assert.equal(report.response.length, 18);
  assert.equal(report.braking.length, 9);
  assert.deepEqual(report.touchControls, measureArrowPedalControls());
  assert.equal(Object.hasOwn(report, 'thumb'), false);
  assert.equal(Object.hasOwn(report, 'pedals'), false);
  for (const { accepted, current } of report.response) {
    assert.ok(Number.isFinite(accepted.laneSeconds));
    assert.ok(Number.isFinite(current.laneSeconds));
  }
});
