import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { observeRenderPixelRatio, renderShadowSettings } from '../src/render-settings.js';
import { RoadRenderer } from '../src/world.js';

test('shadow profiles are immutable shared resource buckets, never per-frame allocations', () => {
  const low = renderShadowSettings(), high = renderShadowSettings('high');
  assert.deepEqual(low, { mapSize: 1024 });
  assert.deepEqual(high, { mapSize: 2048 });
  assert.equal(renderShadowSettings('ultra'), high);
  assert.equal(renderShadowSettings('unknown'), low);
  for (const quality of ['auto', 'high', 'ultra']) assert.equal(renderShadowSettings(quality, true), low);
  assert.equal(Object.isFrozen(low), true); assert.equal(Object.isFrozen(high), true);
  for (let index = 0; index < 1000; index++) assert.equal(renderShadowSettings('ultra'), high);
});

/** Minimal real sunlight and projection objects with no WebGL allocation. */
function worldFixture() {
  const world = Object.create(RoadRenderer.prototype);
  world.quality = 'auto'; world.compact = false; world.sun = new T.DirectionalLight();
  world.sun.shadow.mapSize.set(1024, 1024);
  world.camera = new T.PerspectiveCamera(54, 1, .15, 1200);
  world.renderer = { shadowMap: { enabled: true, needsUpdate: false } };
  world.needsRender = false;
  return world;
}

test('only a shadow bucket change disposes its previous GPU map, once', () => {
  const world = worldFixture(), shadow = world.sun.shadow;
  const projection = shadow.camera.projectionMatrix.clone();
  let disposals = 0;
  const originalMap = { dispose() { disposals++; } };
  shadow.map = originalMap;
  world.applyShadowQuality(); world.applyShadowQuality();
  assert.equal(shadow.map, originalMap); assert.equal(disposals, 0);
  world.quality = 'high'; world.applyShadowQuality();
  assert.deepEqual(shadow.mapSize.toArray(), [2048, 2048]);
  assert.equal(shadow.map, null); assert.equal(disposals, 1);
  assert.equal(world.needsRender, true);
  assert.ok(shadow.camera.projectionMatrix.equals(projection), 'quality does not alter shadow coverage');
  const highMap = { dispose() { disposals++; } }; shadow.map = highMap;
  world.quality = 'ultra'; world.applyShadowQuality(); world.applyShadowQuality();
  assert.equal(shadow.map, highMap); assert.equal(disposals, 1, 'High to Ultra reuses the same shadow map');
  world.compact = true; world.applyShadowQuality();
  assert.deepEqual(shadow.mapSize.toArray(), [1024, 1024]);
  assert.equal(shadow.map, null); assert.equal(disposals, 2);
  world.applyShadowQuality(); assert.equal(disposals, 2);
});

test('shadow quality can be selected before sunlight initialization and without a prior GPU map', () => {
  const world = worldFixture(); world.sun = undefined;
  assert.doesNotThrow(() => world.applyShadowQuality());
  world.sun = new T.DirectionalLight(); world.quality = 'ultra';
  assert.doesNotThrow(() => world.applyShadowQuality());
  assert.deepEqual(world.sun.shadow.mapSize.toArray(), [2048, 2048]);
});

test('quality changes resize only changed physical buffers and expose real UI dimensions', () => {
  const keys = ['innerWidth', 'innerHeight', 'devicePixelRatio', 'matchMedia'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { innerWidth: 3840, innerHeight: 2160, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
  try {
    const world = worldFixture(); world.canvas = { width: 0, height: 0, style: {} };
    let allocations = 0;
    const notifications = [];
    world.onRenderSettings = settings => notifications.push(settings);
    world.renderer.setSize = (width, height, updateStyle) => {
      assert.equal(updateStyle, false); allocations++;
      Object.assign(world.canvas, { width, height });
    };
    world.resize(); world.resize();
    assert.equal(allocations, 1); assert.deepEqual([world.canvas.width, world.canvas.height], [2217, 1247]);
    world.setQuality('high'); assert.equal(allocations, 2);
    assert.deepEqual([world.canvas.width, world.canvas.height], [2560, 1440]);
    world.setQuality('high'); assert.equal(allocations, 2);
    world.setQuality('ultra'); assert.equal(allocations, 3);
    assert.deepEqual([world.canvas.width, world.canvas.height], [3840, 2160]);
    assert.equal(world.camera.aspect, 3840 / 2160);
    assert.equal(notifications.at(-1).quality, 'ultra');
    assert.equal(notifications.at(-1).width, world.canvas.width);
    assert.equal(notifications.at(-1).height, world.canvas.height);
    assert.equal(notifications.at(-1).compact, false);
    world.setQuality('bogus'); assert.equal(world.quality, 'auto'); assert.equal(allocations, 4);
    assert.equal(world.canvas.style.width, '3840px');
    assert.equal(world.canvas.style.height, '2160px');
  } finally {
    for (const key of keys) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key]; }
  }
});

test('a DPR-only event resizes the live buffer without changing CSS viewport or quality', () => {
  const keys = ['innerWidth', 'innerHeight', 'devicePixelRatio', 'matchMedia'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let listener, removals = 0, dispose;
  Object.assign(globalThis, {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    matchMedia(query) {
      if (query === '(pointer: coarse)') return { matches: false };
      return {
        addEventListener(type, callback) { listener = callback; },
        removeEventListener() { removals++; },
      };
    },
  });
  try {
    const world = worldFixture(); world.quality = 'high'; world.canvas = { width: 0, height: 0, style: {} };
    let allocations = 0;
    world.renderer.setSize = (width, height) => { allocations++; Object.assign(world.canvas, { width, height }); };
    world.resize(); assert.deepEqual([world.canvas.width, world.canvas.height], [1280, 720]);
    dispose = observeRenderPixelRatio(() => world.resize());
    globalThis.devicePixelRatio = 2; listener();
    assert.deepEqual([world.canvas.width, world.canvas.height], [2560, 1440]);
    assert.equal(world.quality, 'high'); assert.equal(world.canvas.style.width, '1280px');
    assert.equal(world.camera.aspect, 1280 / 720); assert.equal(allocations, 2);
    globalThis.devicePixelRatio = 3; listener();
    assert.equal(allocations, 2, 'capped DPR change does not reallocate the same physical buffer');
    assert.equal(removals, 2, 'resolution query is re-armed for both ratio changes');
  } finally {
    dispose?.();
    for (const key of keys) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete globalThis[key]; }
  }
});
