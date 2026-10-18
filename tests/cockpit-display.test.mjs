import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { createCar } from '../src/car.js';
import { createCockpitDisplay } from '../src/cockpit-display.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const { scene, json } = await loadRoadsterGeometry();

/**
 * Attach a decoded-image/canvas fixture to the actual GLB screen, preserving its
 * geometry, UVs and material. Node has no browser decoder: calls are recorded to
 * inspect original-artwork reuse and changed-region drawing; browser QA owns pixels.
 */
function fixture(t, options = {}) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls = [], canvases = [];
  const context = {
    drawImage(...args) { calls.push({ kind: 'image', args }); },
    fillText(...args) { calls.push({ kind: 'text', args, font: this.font, color: this.fillStyle }); },
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      if (options.throwCanvas) throw new Error('Canvas unavailable');
      const canvas = { width: 0, height: 0, getContext(kind) { assert.equal(kind, '2d'); return options.noContext ? null : context; } };
      canvases.push(canvas); return canvas;
    },
  };
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  const template = scene.clone(true), sourceScreen = template.getObjectByName('detail_rc_ui');
  const image = options.image === undefined ? { width: 1024, height: 640 } : options.image;
  const source = new T.Texture(image);
  source.flipY = false; source.colorSpace = T.SRGBColorSpace;
  source.wrapS = T.ClampToEdgeWrapping; source.wrapT = T.ClampToEdgeWrapping;
  source.anisotropy = 4; source.offset.set(.03, .02); source.repeat.set(.9, .95); source.center.set(.5, .5); source.rotation = .04;
  source.updateMatrix();
  const original = sourceScreen.material.clone();
  original.map = source; original.emissiveMap = source.clone();
  sourceScreen.material = original;
  const player = createCar(template), other = createCar(template), screen = player.getObjectByName('detail_rc_ui');
  const display = createCockpitDisplay(player);
  return { template, sourceScreen, player, other, screen, original, source, image, context, calls, canvases, display };
}

/** Default actual driving state, allowing one field to change without accidental UI resets. */
const driving = patch => ({ phase: 'playing', speed: 20, distance: 1234, nitro: 82, altitude: 0, ...patch });

/** Return only region restores, excluding the original full-image copy. */
const regionCalls = calls => calls.filter(call => call.kind === 'image' && call.args.length === 9);

test('live tablet owns one canvas map and cloned material without changing template, geometry or UVs', t => {
  const { display, screen, sourceScreen, other, original, source, image, canvases, calls } = fixture(t);
  assert.equal(canvases.length, 1);
  assert.equal(canvases[0].width, 1024); assert.equal(canvases[0].height, 640);
  assert.equal(display.texture.isCanvasTexture, true);
  assert.equal(display.texture.image, canvases[0]);
  assert.notEqual(display.texture.source, source.source, 'Never share the source image holder');
  assert.equal(source.image, image);
  assert.notEqual(screen.material, original);
  assert.equal(screen.material.map, display.texture);
  assert.equal(screen.material.emissiveMap, display.texture, 'No stale emissive PARKED text under live labels');
  assert.equal(sourceScreen.material, original); assert.equal(other.getObjectByName('detail_rc_ui').material, original);
  assert.equal(original.map, source); assert.equal(original.emissiveMap.image, image);
  assert.equal(screen.geometry, sourceScreen.geometry); assert.equal(screen.geometry.attributes.uv, sourceScreen.geometry.attributes.uv);
  for (const property of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'anisotropy', 'rotation', 'generateMipmaps', 'minFilter', 'magFilter'])
    assert.equal(display.texture[property], source[property], property);
  for (const property of ['offset', 'repeat', 'center']) assert.deepEqual(display.texture[property].toArray(), source[property].toArray());
  assert.deepEqual(display.texture.matrix.elements, source.matrix.elements);
  assert.deepEqual(calls, [{ kind: 'image', args: [image, 0, 0, 1024, 640] }], 'Copy the full original artwork exactly once');
  assert.equal(display.telemetry, null);
});

test('first paused frame displays actual km/h, forward mode and game energy, then stays stable', t => {
  const { display, calls } = fixture(t);
  display.update(driving({ speed: 27.5, nitro: 64.4 }), 0);
  assert.deepEqual(display.telemetry, { speed: '99', gear: 'D', status: 'DRIVING', distance: '1.23 KM', energy: '64%' });
  assert.ok(calls.some(c => c.kind === 'text' && c.args[0] === '99'));
  assert.ok(calls.some(c => c.kind === 'text' && c.args[0] === 'ENERGY 64%'));
  const version = display.texture.version, length = calls.length, previous = display.telemetry;
  for (let i = 0; i < 20; i++) display.update(driving({ speed: 90, nitro: 10 }), 0);
  assert.equal(display.texture.version, version); assert.equal(calls.length, length); assert.equal(display.telemetry, previous);
});

test('changed readings are capped to 10 Hz and unchanged rounded values do not upload', t => {
  const { display } = fixture(t);
  display.update(driving(), 0); const initial = display.texture.version;
  for (let i = 0; i < 5; i++) {
    display.update(driving({ speed: 30 }), 1 / 60);
    assert.equal(display.texture.version, initial);
  }
  display.update(driving({ speed: 30 }), 1 / 60);
  assert.equal(display.texture.version, initial + 1); assert.equal(display.telemetry.speed, '108');
  for (let i = 0; i < 60; i++) display.update(driving({ speed: 30.01, nitro: 82.01, distance: 1234.01 }), 1 / 60);
  assert.equal(display.texture.version, initial + 1, 'Sub-readout precision cannot create GPU uploads');
  let changes = 0, previous = display.texture.version;
  for (let frame = 1; frame <= 120; frame++) {
    display.update(driving({ speed: 40 + frame }), 1 / 60);
    if (display.texture.version !== previous) { changes++; previous = display.texture.version; }
  }
  assert.ok(changes <= 20, `At most twenty changed uploads across two seconds, got ${changes}`);
  assert.ok(changes >= 19);
});

test('camera invalidation refreshes current state at zero time, without repeated paused uploads', t => {
  const { display } = fixture(t);
  display.update(driving(), 0); const initial = display.texture.version;
  display.update(driving({ speed: 35 }), 0); assert.equal(display.texture.version, initial);
  display.invalidate(); display.update(driving({ speed: 35 }), 0);
  assert.equal(display.texture.version, initial + 1); assert.equal(display.telemetry.speed, '126');
  display.update(driving({ speed: 40 }), 0); assert.equal(display.texture.version, initial + 1);
  display.invalidate(); display.update(driving({ speed: 35 }), 0);
  assert.equal(display.texture.version, initial + 1, 'Invalidation does not force an unchanged texture upload');
  display.invalidate(); display.update(driving({ speed: 0, distance: 0, nitro: 100 }), 0);
  assert.equal(display.telemetry.speed, '0'); assert.equal(display.telemetry.distance, '0.00 KM');
});

test('a changed speed clears only its original region, preserving illustration and layout', t => {
  const { display, calls, image } = fixture(t);
  display.update(driving(), 0); calls.length = 0;
  display.update(driving({ speed: 21 }), .1);
  assert.deepEqual(regionCalls(calls).map(c => c.args), [[image, 10, 85, 1, 121, 28, 85, 212, 121]]);
  assert.deepEqual(calls.filter(c => c.kind === 'text').map(c => c.args[0]), ['76', 'KM/H']);
  calls.length = 0;
  display.update(driving({ phase: 'ready', speed: 0, distance: 0, nitro: 100 }), 0);
  for (const { args } of regionCalls(calls)) {
    const [, , , , , x, y, w, h] = args;
    assert.ok(x + w <= 251 || y + h <= 247, `Do not paint over the car illustration: ${x},${y},${w},${h}`);
  }
});

test('authored fictional range becomes actual route distance with immutable inspection readouts', t => {
  const { display, calls } = fixture(t);
  display.update(driving({ distance: 5678 }), 0);
  assert.equal(display.telemetry.distance, '5.68 KM');
  assert.ok(calls.some(c => c.kind === 'text' && c.args[0] === 'DISTANCE'));
  assert.ok(Object.isFrozen(display.telemetry));
  assert.throws(() => { display.telemetry.speed = '9999'; }, TypeError);
  assert.equal(display.telemetry.speed, '72');
  assert.ok(!calls.some(c => c.kind === 'text' && /620|RANGE/.test(c.args[0])));
});

test('flying, rolling, landing and residual altitude use real quantized game state', t => {
  const { display } = fixture(t);
  for (const [state, expected] of [
    [driving({ flying: true, altitude: 3.26 }), 'FLYING  /  3.3 M'],
    [driving({ flying: true, rolling: true, altitude: 3.2 }), 'ROLLING  /  3.2 M'],
    [driving({ landing: true, altitude: .42 }), 'LANDING  /  0.4 M'],
    [driving({ altitude: .8 }), 'LANDING  /  0.8 M'],
    [driving({ altitude: 0, speed: 0 }), 'READY'],
    [driving({ phase: 'crashed', altitude: 0 }), 'CRASHED'],
  ]) {
    display.update(state, .1); assert.equal(display.telemetry.status, expected);
  }
});

test('menu and new ready state immediately reset parked zero even with stale flight data', t => {
  const { display } = fixture(t);
  display.update(driving({ flying: true, altitude: 3.2 }), 0);
  for (const phase of ['menu', 'ready']) {
    display.update(driving({ phase, rolling: true, flying: true, landing: true, altitude: 3.2 }), 0);
    assert.deepEqual(display.telemetry, { speed: '0', gear: 'P', status: 'PARKED', distance: '0.00 KM', energy: '82%' });
  }
});

test('invalid state values cannot produce NaN, negative speed or fictional energy', t => {
  const { display } = fixture(t);
  for (const invalid of [NaN, Infinity, -Infinity, -10, undefined]) {
    display.invalidate(); display.update(driving({ speed: invalid, distance: invalid, altitude: invalid, nitro: invalid }), 0);
    assert.equal(display.telemetry.speed, '0'); assert.equal(display.telemetry.distance, '0.00 KM');
    assert.equal(display.telemetry.status, 'READY');
    assert.equal(display.telemetry.energy, Number.isFinite(invalid) ? '0%' : '--');
    assert.ok(!JSON.stringify(display.telemetry).includes('NaN'));
  }
  display.invalidate(); display.update(driving({ speed: 100000, nitro: 200 }), 0);
  assert.equal(display.telemetry.speed, '9999'); assert.equal(display.telemetry.energy, '100%');
});

test('dispose restores source material once and never disposes shared assets', t => {
  const { display, screen, original, source } = fixture(t);
  let textureDisposals = 0, materialDisposals = 0, sourceDisposals = 0, originalDisposals = 0;
  const material = screen.material, texture = display.texture;
  texture.addEventListener('dispose', () => textureDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  source.addEventListener('dispose', () => sourceDisposals++);
  original.addEventListener('dispose', () => originalDisposals++);
  display.update(driving(), 0); const version = texture.version;
  display.dispose(); display.dispose(); display.invalidate(); display.update(driving({ speed: 90 }), 1);
  assert.equal(screen.material, original);
  assert.equal(textureDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(sourceDisposals, 0); assert.equal(originalDisposals, 0); assert.equal(texture.version, version);
});

test('missing, mismatched or undecoded images and unavailable canvas keep authored screen intact', t => {
  const { player, screen, original, source } = fixture(t);
  // A fresh screen still using the source material is required for each fallback.
  screen.material = original;
  const image = source.image;
  for (const bad of [null, { width: 0, height: 0 }, { width: 640, height: 1024 }, { width: 1024, height: 600 }]) {
    source.image = bad;
    const inert = createCockpitDisplay(player);
    assert.equal(inert.texture, null); assert.equal(inert.telemetry, null); assert.equal(screen.material, original);
    assert.doesNotThrow(() => { inert.invalidate(); inert.update(driving(), 1); inert.dispose(); });
  }
  source.image = image;
  globalThis.document = { createElement() { return { getContext() { return null; } }; } };
  assert.equal(createCockpitDisplay(player).texture, null); assert.equal(screen.material, original);
  globalThis.document = { createElement() { throw new Error('blocked'); } };
  assert.equal(createCockpitDisplay(player).texture, null); assert.equal(screen.material, original);
  delete globalThis.document;
  assert.equal(createCockpitDisplay(player).texture, null);
  assert.equal(createCockpitDisplay(new T.Group()).texture, null);
});

test('the source asset still uses the mapped authored display layout and shared image channels', () => {
  const material = json.materials.find(value => value.name === 'RC_Original_Landscape_UI');
  assert.ok(material?.pbrMetallicRoughness?.baseColorTexture);
  assert.ok(material.emissiveTexture);
  const imageSource = info => json.textures[info.index].source;
  assert.equal(imageSource(material.pbrMetallicRoughness.baseColorTexture), imageSource(material.emissiveTexture));
  const screen = scene.getObjectByName('detail_rc_ui');
  assert.equal(screen.geometry.attributes.position.count, 4); assert.equal(screen.geometry.attributes.uv.count, 4);
  const root = scene.getObjectByName('Roadster');
  assert.deepEqual(root.userData.driverDisplay.texture_dimensions_px, [1024, 640]);
  const dimensions = root.userData.driverDisplay.active_dimensions_m;
  assert.ok(Math.abs(dimensions[0] / dimensions[1] - 1.6) < 1e-9);
});
