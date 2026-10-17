import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { createSkyReflectionSource } from '../src/assets.js';

test('daylight reflection reuses visible sky orientation and caps PMREM input budget', () => {
  const pixels = new Uint8Array(2048 * 1024 * 4);
  pixels.set([31, 122, 207, 255], 0);
  pixels.set([63, 144, 222, 255], (2 * 2048 + 2) * 4);
  const sky = new T.DataTexture(pixels, 2048, 1024, T.RGBAFormat);
  sky.flipY = true; sky.colorSpace = T.SRGBColorSpace;
  const source = createSkyReflectionSource(sky);
  assert.equal(source.image.width, 1024); assert.equal(source.image.height, 512);
  assert.equal(source.image.data.byteLength, 1024 * 512 * 4);
  assert.equal(source.flipY, sky.flipY); assert.equal(source.colorSpace, sky.colorSpace);
  assert.equal(source.mapping, T.EquirectangularReflectionMapping);
  assert.deepEqual([...source.image.data.subarray(0, 4)], [31, 122, 207, 255]);
  assert.deepEqual([...source.image.data.subarray((1024 + 1) * 4, (1024 + 1) * 4 + 4)], [63, 144, 222, 255]);
  assert.notEqual(source.image.data, sky.image.data);
  assert.equal(sky.image.width, 2048); source.dispose(); sky.dispose();
});

test('gameplay has no full-screen HUD darkening and no mismatched HDR fetch', async () => {
  const css = await readFile('styles/app.css', 'utf8');
  assert.ok(!css.includes('.game-hud::before'));
  assert.match(css, /#app:not\(\[data-screen="menu"\]\) \.topbar \{ background: var\(--color-transparent\)/);
  const assets = await readFile('src/assets.js', 'utf8');
  assert.ok(!assets.includes("loadAsync(base + 'daylight.hdr')"));
  const world = await readFile('src/world.js', 'utf8');
  assert.equal((world.match(/new T\.DirectionalLight/g) || []).length, 1, 'one shadow-casting sunlight pass');
  assert.match(world, /reflectionSource\.dispose\(\)/, 'temporary environment source released');
});
