import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRenderQuality, renderDimensions, observeRenderPixelRatio } from '../src/render-settings.js';
import { UI } from '../src/ui.js';
import { createStorage, sanitizeSave, STORAGE_KEY } from '../src/storage.js';

const budgets = {
  auto: { pixels: [1600000, 800000], edges: [2048, 2048], dpr: 1.5 },
  high: { pixels: [3686400, 1600000], edges: [3840, 2560], dpr: 2 },
  ultra: { pixels: [8294400, 2073600], edges: [4096, 2560], dpr: 2 },
};

test('quality names normalize to bounded profiles, with Auto for corrupt or old settings', () => {
  for (const invalid of [undefined, null, false, 2, {}, [], 'maximum', '__proto__', 'constructor', 'toString']) {
    assert.equal(normalizeRenderQuality(invalid), 'auto');
    assert.equal(sanitizeSave({ renderQuality: invalid }).renderQuality, 'auto');
  }
  for (const quality of ['auto', 'high', 'ultra']) {
    assert.equal(normalizeRenderQuality(quality), quality);
    assert.equal(normalizeRenderQuality(' ' + quality.toUpperCase() + ' '), quality);
  }
  assert.equal(sanitizeSave(null).renderQuality, 'auto');
});

test('4K viewport has the exact accepted Auto, High and native Ultra surfaces', () => {
  for (const [quality, expected] of [['auto', [1686, 948]], ['high', [2560, 1440]], ['ultra', [3840, 2160]]]) {
    const size = renderDimensions(3840, 2160, 1, false, quality);
    assert.deepEqual([size.width, size.height], expected, quality);
  }
  assert.deepEqual(renderDimensions(3840, 2160, 1, false), renderDimensions(3840, 2160, 1, false, 'auto'));
  assert.deepEqual(renderDimensions(3840, 2160, 1, false, 'unknown'), renderDimensions(3840, 2160, 1, false, 'auto'));
});

test('DPR is capped independently from desktop and compact pixel budgets', () => {
  for (const quality of Object.keys(budgets)) {
    const maxRatio = budgets[quality].dpr;
    const small = renderDimensions(400, 300, 9, false, quality);
    assert.deepEqual([small.width, small.height], [400 * maxRatio, 300 * maxRatio]);
    assert.deepEqual(renderDimensions(400, 300, .25, false, quality), renderDimensions(400, 300, 1, false, quality));
  }
  assert.deepEqual(renderDimensions(390, 844, 3, true, 'ultra'), renderDimensions(390, 844, 2, true, 'ultra'));
  assert.deepEqual([renderDimensions(1080, 1920, 3, true, 'ultra').width, renderDimensions(1080, 1920, 3, true, 'ultra').height], [1080, 1920]);
});

test('floor sizing stays strictly below every budget and within one pixel of the shared aspect scale', () => {
  const dimensions = [[1, 1], [1440, 900], [390, 844], [844, 390], [1920, 1080], [2160, 3840], [3440, 1440], [100000, 100000], [100000, 1]];
  // Repeatable varied aspect ratios catch round-up errors close to area limits.
  let seed = 7321;
  for (let index = 0; index < 200; index++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const width = 600 + seed % 9000;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    dimensions.push([width, 600 + seed % 9000]);
  }
  for (const [quality, budget] of Object.entries(budgets)) for (const compact of [false, true]) {
    for (const [width, height] of dimensions) for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const size = renderDimensions(width, height, dpr, compact, quality);
      assert.ok(Number.isInteger(size.width) && Number.isInteger(size.height));
      assert.ok(size.width >= 1 && size.height >= 1);
      assert.ok(size.width * size.height <= budget.pixels[Number(compact)], `${quality}: ${size.width} × ${size.height}`);
      assert.ok(Math.max(size.width, size.height) <= budget.edges[Number(compact)]);
      assert.ok(size.scale > 0 && size.scale <= Math.min(dpr, budget.dpr));
      for (const [actual, requested] of [[size.width, width], [size.height, height]]) {
        assert.ok(Math.abs(actual - Math.max(1, requested * size.scale)) < 1, 'each axis uses the same scale then floors');
      }
    }
  }
});

test('malformed and extreme finite dimensions never produce nonfinite or oversized buffers', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, -100, 0, '1920', {}, [], Number.MAX_VALUE, Number.MIN_VALUE]) {
    for (const quality of Object.keys(budgets)) for (const [width, height] of [[value, value], [value, 1080], [1920, value]]) {
      const size = renderDimensions(width, height, value, false, quality);
      assert.ok(Number.isFinite(size.scale) && size.scale > 0);
      assert.ok(Number.isInteger(size.width) && size.width > 0);
      assert.ok(Number.isInteger(size.height) && size.height > 0);
      assert.ok(size.width * size.height <= budgets[quality].pixels[0]);
      assert.ok(Math.max(size.width, size.height) <= budgets[quality].edges[0]);
    }
  }
});

/** Resolution-query fixture exposes exact active listener counts and stale callbacks. */
function ratioSource(legacy = false) {
  const queries = [];
  const source = {
    devicePixelRatio: 1,
    matchMedia(media) {
      const callbacks = new Set();
      const query = { media, callbacks, fire() { for (const callback of [...callbacks]) callback({ matches: false }); } };
      const add = callback => callbacks.add(callback), remove = callback => callbacks.delete(callback);
      if (legacy) Object.assign(query, { addListener: add, removeListener: remove });
      else Object.assign(query, {
        addEventListener(type, callback) { assert.equal(type, 'change'); add(callback); },
        removeEventListener(type, callback) { assert.equal(type, 'change'); remove(callback); },
      });
      queries.push(query); return query;
    },
  };
  return { source, queries, active: () => queries.reduce((sum, query) => sum + query.callbacks.size, 0) };
}

for (const legacy of [false, true]) test(`DPR observer re-arms and cleans up ${legacy ? 'legacy' : 'modern'} resolution listeners`, () => {
  const fixture = ratioSource(legacy), changes = [];
  const dispose = observeRenderPixelRatio(ratio => changes.push(ratio), fixture.source);
  assert.deepEqual(changes, [], 'initial resize is owned by the renderer');
  assert.equal(fixture.queries[0].media, '(resolution: 1dppx)');
  assert.equal(fixture.active(), 1);
  const stale = [...fixture.queries[0].callbacks][0];
  fixture.source.devicePixelRatio = 2; fixture.queries.at(-1).fire();
  assert.deepEqual(changes, [2]);
  assert.equal(fixture.queries.at(-1).media, '(resolution: 2dppx)');
  assert.equal(fixture.active(), 1);
  stale(); assert.deepEqual(changes, [2], 'removed query cannot cause a duplicate callback');
  fixture.queries.at(-1).fire(); assert.deepEqual(changes, [2], 'unchanged DPR does not resize');
  assert.equal(fixture.active(), 1, 'unchanged event also replaces rather than leaks its query');
  fixture.source.devicePixelRatio = 1.25; fixture.queries.at(-1).fire();
  assert.deepEqual(changes, [2, 1.25]);
  fixture.source.devicePixelRatio = NaN; fixture.queries.at(-1).fire();
  assert.deepEqual(changes, [2, 1.25, 1]);
  const latest = [...fixture.queries.at(-1).callbacks][0];
  dispose(); dispose(); latest();
  assert.equal(fixture.active(), 0);
  assert.deepEqual(changes, [2, 1.25, 1]);
});

test('DPR observer tolerates missing browser APIs and callback disposal during a change', () => {
  for (const target of [null, {}, { matchMedia: null }]) assert.doesNotThrow(() => observeRenderPixelRatio(() => {}, target)());
  assert.doesNotThrow(() => observeRenderPixelRatio(null, ratioSource().source)());
  const fixture = ratioSource();
  const dispose = observeRenderPixelRatio(() => dispose(), fixture.source);
  fixture.source.devicePixelRatio = 2; fixture.queries[0].fire();
  assert.equal(fixture.active(), 0);
});

test('render profile persists without changing progress and survives blocked localStorage', () => {
  let raw = JSON.stringify({ best: { flow: 1000, rush: 300 }, runs: 4, totalDistance: 2400, cameraMode: 'cockpit', sound: true });
  const provider = { getItem: () => raw, setItem(key, value) { assert.equal(key, STORAGE_KEY); raw = value; } };
  const storage = createStorage(() => provider), previous = storage.get();
  for (const quality of ['high', 'ultra', 'auto']) {
    storage.settings({ renderQuality: quality });
    assert.deepEqual(createStorage(() => provider).get(), { ...previous, renderQuality: quality });
  }
  const blocked = createStorage(() => { throw new Error('not available'); });
  blocked.settings({ renderQuality: 'high' }); assert.equal(blocked.get().renderQuality, 'high');
});

test('graphics UI reports actual buffer pixels and explains the compact Ultra limit', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const elements = Object.fromEntries(['renderQuality', 'renderResolution', 'renderQualityHint'].map(id => [id, {}]));
  globalThis.document = { getElementById: id => elements[id] };
  try {
    UI.prototype.renderSettings({ quality: 'ultra', width: 780, height: 1688, compact: true });
    assert.equal(elements.renderQuality.value, 'ultra');
    assert.equal(elements.renderResolution.textContent, '780 × 1688');
    assert.match(elements.renderQualityHint.textContent, /не 4K/);
    assert.match(elements.renderQualityHint.textContent, /батареи/);
    UI.prototype.renderSettings({ quality: 'auto', width: 1686, height: 948, compact: false });
    assert.match(elements.renderQualityHint.textContent, /1,6 млн/);
  } finally { if (old) Object.defineProperty(globalThis, 'document', old); else delete globalThis.document; }
});

test('graphics selector remains a labelled native control with clear cost information', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<details[^>]*id="renderSettings"/);
  assert.match(html, /<label for="renderQuality">/);
  assert.match(html, /id="renderQuality" aria-describedby="renderQualityHint renderQualityCost"/);
  assert.match(html, /id="renderQualityCost"/);
  for (const quality of ['auto', 'high', 'ultra']) assert.match(html, new RegExp(`<option value="${quality}"`));
});
