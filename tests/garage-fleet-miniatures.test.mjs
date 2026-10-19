import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { FleetMiniatures, fleetVehicleBounds, fitFleetCamera } from '../src/garage-fleet-miniatures.js';
import { createOwnedVehicle } from '../src/owned-vehicles.js';
import { installTrafficTemplates, TRAFFIC_KINDS } from '../src/traffic.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const ids = ['rocket', 'hatch', 'sedan', 'suv', 'van'];
const assets = { car: (await loadRoadsterGeometry()).scene, traffic: {} };
for (const id of TRAFFIC_KINDS) assets.traffic[id] = (await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`, import.meta.url))).scene;
installTrafficTemplates(assets.traffic);

function canvas() {
  const context = { images: [], createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData(image) { this.images.push(image); } };
  return { width: 320, height: 180, isConnected: true, context, getContext: kind => kind === '2d' ? context : null };
}

/** Synchronous controllable renderer with the actual public Three.js state surface. */
function fixture({ async = false, production = false } = {}) {
  const listeners = new Map(), events = [], clones = [], reads = [], draws = [], postDraws = [], targets = new Set();
  let target = { name: 'game-target' }, face = 3, mip = 2, viewport = new T.Vector4(2, 3, 801, 603), scissor = new T.Vector4(5, 6, 701, 503), scissorTest = true;
  let clearColor = new T.Color('#765432'), clearAlpha = .7;
  const renderer = {
    autoClear: false, autoClearColor: false, autoClearDepth: false, autoClearStencil: false,
    toneMapping: T.ACESFilmicToneMapping, toneMappingExposure: .84, outputColorSpace: T.SRGBColorSpace,
    xr: { enabled: true }, shadowMap: { autoUpdate: true, needsUpdate: true }, capabilities: { maxSamples: 4 },
    domElement: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(value, nextFace = 0, nextMip = 0) { target = value; face = nextFace; mip = nextMip; if (value?.isWebGLRenderTarget) targets.add(value); },
    getViewport: out => out.copy(viewport), getScissor: out => out.copy(scissor), getScissorTest: () => scissorTest,
    setViewport(...args) { viewport = args[0]?.isVector4 ? args[0].clone() : new T.Vector4(...args); },
    setScissor(value) { scissor = value.clone(); }, setScissorTest(value) { scissorTest = value; },
    getClearColor: out => out.copy(clearColor), getClearAlpha: () => clearAlpha,
    setClearColor(value, alpha) { clearColor.set(value); clearAlpha = alpha; }, clear() {},
    render(scene, camera) {
      const roots = scene.children.filter(node => node.isGroup);
      (roots.length ? draws : postDraws).push({ roots: [...roots], yaw: roots[0]?.rotation.y, camera: camera.clone(), target, scene });
      if (!roots.length && renderer.throwPostRender) throw new Error('GPU tone-map failed');
      if (renderer.throwRender) throw new Error('GPU render failed');
    },
    readRenderTargetPixels(rt, x, y, width, height, bytes) {
      if (renderer.throwRead) throw new Error('GPU read failed');
      reads.push(rt); for (let i = 0; i < bytes.length; i += 4) { bytes[i] = i / (width * 4) < height / 2 ? 1 : 2; bytes[i + 3] = 255; }
    },
  };
  const deferred = [];
  if (async) renderer.readRenderTargetPixelsAsync = (rt, x, y, width, height, bytes) => {
    reads.push(rt);
    return new Promise((resolve, reject) => deferred.push({ resolve: () => { bytes.fill(200); resolve(bytes); }, reject }));
  };
  const fleet = new FleetMiniatures({ renderer, makeVehicle(id, appearance) {
    let vehicle;
    if (production) vehicle = createOwnedVehicle(assets, id, appearance);
    else {
      vehicle = new T.Group(); const material = new T.MeshStandardMaterial(), mesh = new T.Mesh(new T.BoxGeometry(2, 1.4, 4.7), material);
      vehicle.add(mesh); vehicle.userData.ownedAppearanceMaterials = [material, material];
    }
    clones.push({ id, appearance, vehicle }); return vehicle;
  }, onChange: event => events.push(event) });
  const state = () => ({ target, face, mip, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest,
    clearColor: clearColor.getHex(), clearAlpha, autoClear: renderer.autoClear, autoClearColor: renderer.autoClearColor,
    autoClearDepth: renderer.autoClearDepth, autoClearStencil: renderer.autoClearStencil, xr: renderer.xr.enabled,
    shadow: { ...renderer.shadowMap }, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, output: renderer.outputColorSpace });
  return { fleet, renderer, state, clones, events, reads, draws, postDraws, targets, deferred, listeners };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const settle = fleet => { for (let i = 0; i < 20; i++) fleet.update(1 / 12); };

function corners(box) {
  const result = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) result.push(new T.Vector3(x, y, z));
  return result;
}

test('real production geometry fits every full-yaw projection and preserves authored car transforms', () => {
  for (const id of ids) {
    const vehicle = createOwnedVehicle(assets, id), matrix = vehicle.matrix.clone();
    const bounds = fleetVehicleBounds(vehicle), center = bounds.getCenter(new T.Vector3());
    assert.ok(bounds.getSize(new T.Vector3()).length() > 3, `${id}: uses real metre-scale GLB geometry`);
    for (const aspect of [320 / 180, 96 / 60, 76 / 50, 1]) {
      const camera = fitFleetCamera(new T.OrthographicCamera(), bounds, aspect);
      for (let step = 0; step < 72; step++) {
        const yaw = new T.Matrix4().makeRotationY(step * Math.PI / 36);
        for (const corner of corners(bounds)) {
          const p = corner.sub(center).applyMatrix4(yaw).project(camera);
          assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1, `${id}/${aspect}/${step}: ${p.toArray()}`);
        }
      }
    }
    assert.ok(vehicle.matrix.equals(matrix));
  }
});

test('two shared targets, genuine prepared clones, saved cosmetics and zero stable idle redraws', () => {
  const f = fixture({ production: true }), records = ids.map(id => ({ id, canvas: canvas(), appearance: id === 'rocket' ? { 'body.paint': 'paint_copper' } : {} }));
  f.fleet.sync(records, { scopeKey: 'profile:0' }); assert.equal(f.clones.length, 0, 'all models lazy until visible rendering');
  settle(f.fleet); assert.equal(f.clones.length, 5); assert.equal(f.draws.length, 5); assert.equal(f.targets.size, 2);
  assert.equal(f.fleet.target.width, 320); assert.equal(f.fleet.target.height, 180); assert.equal(f.fleet.target.samples, 0);
  assert.equal(f.fleet.sceneTarget.samples, 4); assert.equal(f.fleet.sceneTarget.texture.type, T.HalfFloatType);
  assert.equal(f.postDraws.length, 5);
  assert.equal(f.fleet.target.texture.colorSpace, T.SRGBColorSpace);
  assert.deepEqual(f.clones[0].appearance, records[0].appearance);
  for (const draw of f.draws) assert.equal(draw.roots.length, 1, 'one real car in studio render');
  for (const record of records) { assert.equal(record.canvas.context.images.length, 1); assert.equal(record.canvas.context.images[0].data[0], 2, 'readback vertically flipped'); }
  settle(f.fleet); assert.equal(f.draws.length, 5);
  f.fleet.dispose();
});

test('same loadout object order and replaced DOM reuse clones and current pixel caches', () => {
  const f = fixture(), oldCanvas = canvas();
  f.fleet.sync([{ id: 'rocket', canvas: oldCanvas, appearance: { a: 'one', b: 'two' } }]); f.fleet.update(0);
  const replacement = canvas();
  f.fleet.sync([{ id: 'rocket', canvas: replacement, appearance: { b: 'two', a: 'one' } }]);
  assert.equal(f.clones.length, 1); assert.equal(replacement.context.images.length, 1);
  assert.equal(f.events.at(-1).canvas, replacement); assert.equal(f.events.at(-1).status, 'ready');
  settle(f.fleet); assert.equal(f.draws.length, 1); f.fleet.dispose();
});

test('finite real rotation is globally rate capped and only one card animates', () => {
  const f = fixture(); f.fleet.sync(ids.map(id => ({ id, canvas: canvas() }))); settle(f.fleet);
  const before = f.draws.length, idle = f.fleet.records.get('rocket').yaw;
  f.fleet.setInteraction('rocket');
  for (let i = 0; i < 120; i++) f.fleet.update(1 / 120);
  assert.ok(f.draws.length - before <= 13); assert.ok(f.draws.length - before >= 8);
  assert.notEqual(f.draws.at(-1).yaw, idle); assert.equal(f.fleet.records.get('rocket').turnTime, .85);
  const settled = f.draws.length; settle(f.fleet); assert.equal(f.draws.length, settled, 'hover settles with no infinite animation');
  f.fleet.setInteraction('sedan'); assert.equal(f.fleet.returningId, 'rocket');
  assert.notEqual(f.fleet.records.get('rocket').yaw, idle, 'return starts at displayed orientation');
  assert.equal(f.fleet.activeId, 'sedan'); settle(f.fleet);
  f.fleet.setInteraction(null); settle(f.fleet); const exit = f.draws.length; settle(f.fleet); assert.equal(f.draws.length, exit);
  f.fleet.dispose();
});

test('hidden, clipped, paused and reduced-motion views avoid wasted model/render work', () => {
  const f = fixture();
  f.fleet.sync([{ id: 'rocket', canvas: canvas(), visible: false }, { id: 'hatch', canvas: canvas(), visible: true }]);
  for (const flags of [{ visible: false }, { paused: true }]) for (let i = 0; i < 10; i++) f.fleet.update(.1, flags);
  assert.equal(f.clones.length, 0);
  f.fleet.update(.1, { reducedMotion: true }); assert.equal(f.clones.length, 1); assert.equal(f.clones[0].id, 'hatch');
  f.fleet.setInteraction('hatch'); for (let i = 0; i < 30; i++) f.fleet.update(.1, { reducedMotion: true });
  assert.equal(f.draws.length, 1);
  f.fleet.dispose();
});

for (const reason of ['throwRender', 'throwRead', 'throwPostRender']) test(`all shared renderer state restores after ${reason}, with stable error fallback`, () => {
  const f = fixture(), before = f.state(); f.renderer[reason] = true;
  f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0);
  assert.deepEqual(f.state(), before); assert.equal(f.events[0].status, 'error');
  assert.equal(f.fleet.scene.children.filter(node => node.isGroup).length, 0);
  settle(f.fleet); assert.equal(f.draws.length, 1, 'does not busy-retry a failed card'); f.fleet.dispose();
});

test('async readbacks serialize the target and restore main render state before awaiting', async () => {
  const f = fixture({ async: true }), before = f.state();
  f.fleet.sync(ids.map(id => ({ id, canvas: canvas() }))); f.fleet.update(0);
  assert.deepEqual(f.state(), before); settle(f.fleet); assert.equal(f.draws.length, 1);
  f.deferred.shift().resolve(); await flush(); f.fleet.update(.1); assert.equal(f.draws.length, 2);
  assert.equal(f.targets.size, 2); f.fleet.dispose(); f.deferred.shift().resolve(); await flush();
});

for (const change of ['canvas', 'loadout', 'scope', 'removed', 'hidden', 'paused', 'disposed']) test(`late async pixels and callbacks cannot cross ${change} changes`, async () => {
  const f = fixture({ async: true }), original = canvas(), entry = { id: 'rocket', canvas: original, appearance: { paint: 'red' } };
  f.fleet.sync([entry], { scopeKey: 'profile:0' }); f.fleet.update(0);
  const replacement = canvas();
  if (change === 'canvas') f.fleet.sync([{ ...entry, canvas: replacement }]);
  if (change === 'loadout') f.fleet.sync([{ ...entry, appearance: { paint: 'blue' } }]);
  if (change === 'scope') f.fleet.sync([entry], { scopeKey: 'profile:1' });
  if (change === 'removed') f.fleet.sync([]);
  if (change === 'hidden') f.fleet.update(0, { visible: false });
  if (change === 'paused') f.fleet.update(0, { paused: true });
  if (change === 'disposed') f.fleet.dispose();
  f.deferred.shift().resolve(); await flush();
  assert.equal(f.events.length, 0); assert.equal(original.context.images.length, 0); assert.equal(replacement.context.images.length, 0);
  f.fleet.dispose();
});

test('one asynchronous failure falls back to guarded synchronous reads without renderer leakage', async () => {
  const f = fixture({ async: true }), before = f.state();
  f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0);
  f.deferred.shift().reject(new Error('async unsupported')); await flush();
  assert.equal(f.events.length, 0); assert.equal(f.fleet.asyncReadback, false);
  f.fleet.update(.1); assert.equal(f.events.at(-1).status, 'ready'); assert.deepEqual(f.state(), before); f.fleet.dispose();
});

test('disposal touches only owned appearance materials and two targets, never shared GLB assets/environment', () => {
  const f = fixture({ production: true }), environment = new T.Texture(); f.fleet.setEnvironment(environment);
  f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0);
  let owned = 0, geometry = 0, texture = 0, sharedMaterial = 0, target = 0;
  const record = f.fleet.records.get('rocket'), materials = new Set(record.vehicle.userData.ownedAppearanceMaterials);
  for (const material of materials) material.addEventListener('dispose', () => owned++);
  record.vehicle.traverse(node => {
    if (!node.isMesh) return;
    node.geometry.addEventListener('dispose', () => geometry++);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (!materials.has(material)) material.addEventListener('dispose', () => sharedMaterial++);
  });
  environment.addEventListener('dispose', () => texture++); f.fleet.target.addEventListener('dispose', () => target++); f.fleet.sceneTarget.addEventListener('dispose', () => target++);
  f.fleet.dispose(); f.fleet.dispose();
  assert.equal(owned, materials.size); assert.equal(target, 2); assert.equal(geometry, 0); assert.equal(texture, 0); assert.equal(sharedMaterial, 0);
  assert.equal(f.listeners.size, 0);
});

test('context restoration cancels old ownership and redraws without replacing real vehicle clones', async () => {
  const f = fixture({ async: true }); f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0);
  const original = f.fleet.target, oldRead = f.deferred.shift();
  f.listeners.get('webglcontextlost')(); assert.equal(f.fleet.update(.1), false);
  f.listeners.get('webglcontextrestored')(); assert.equal(f.fleet.update(.1), true);
  assert.notEqual(f.fleet.target, original); assert.equal(f.clones.length, 1);
  oldRead.resolve(); await flush(); assert.equal(f.events.length, 0);
  f.deferred.shift().resolve(); await flush(); assert.equal(f.events.length, 1); f.fleet.dispose();
});

test('error callbacks observe restored state and remounted failed cards retain explicit fallback', () => {
  const f = fixture(), before = f.state(), observed = []; f.renderer.throwRender = true;
  f.fleet.onChange = event => observed.push({ event, state: f.state() });
  f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0);
  assert.deepEqual(observed[0].state, before, 'callback cannot see temporary render target');
  const replacement = canvas(); f.fleet.sync([{ id: 'rocket', canvas: replacement }]);
  assert.equal(observed.at(-1).event.canvas, replacement); assert.equal(observed.at(-1).event.status, 'error');
  settle(f.fleet); assert.equal(f.draws.length, 1); f.fleet.dispose();
});

test('pointer exit eases the actual model back and rapid changes bound returning work', () => {
  const f = fixture(); f.fleet.sync(ids.map(id => ({ id, canvas: canvas() }))); settle(f.fleet);
  const idle = f.fleet.records.get('rocket').yaw;
  f.fleet.setInteraction('rocket'); settle(f.fleet);
  const turned = f.fleet.records.get('rocket').yaw, count = f.draws.length;
  f.fleet.setInteraction(null); assert.equal(f.fleet.records.get('rocket').yaw, turned);
  f.fleet.update(.1);
  assert.ok(f.fleet.records.get('rocket').yaw < turned && f.fleet.records.get('rocket').yaw > idle);
  settle(f.fleet); assert.equal(f.fleet.records.get('rocket').yaw, idle);
  assert.ok(f.draws.length - count >= 6, 'return has actual intermediate renders');
  f.fleet.setInteraction('rocket'); f.fleet.update(.1);
  f.fleet.setInteraction('hatch'); f.fleet.update(.1);
  f.fleet.setInteraction('sedan');
  assert.equal(f.fleet.returningId, 'hatch'); assert.equal(f.fleet.activeId, 'sedan');
  assert.equal(f.fleet.records.get('rocket').yaw, idle, 'older return settles rather than accumulating loops');
  const before = f.draws.length; for (let i = 0; i < 120; i++) f.fleet.update(1 / 120);
  assert.ok(f.draws.length - before <= 13, 'combined active/returning work shares the frame cap');
  f.fleet.dispose();
});

for (const change of ['scope', 'loadout', 'canvas']) test(`late failed async readback cannot poison ${change} replacement`, async () => {
  const f = fixture({ async: true }), entry = { id: 'rocket', canvas: canvas(), appearance: { a: 'red' } };
  f.fleet.sync([entry], { scopeKey: 'profile:0' }); f.fleet.update(0);
  f.fleet.sync([{ ...entry, ...(change === 'canvas' ? { canvas: canvas() } : {}), ...(change === 'loadout' ? { appearance: { a: 'blue' } } : {}) }],
    { scopeKey: change === 'scope' ? 'profile:1' : 'profile:0' });
  f.deferred.shift().reject(new Error('stale read failed')); await flush();
  assert.equal(f.events.length, 0); assert.equal(f.fleet.records.get('rocket').failed, false);
  assert.equal(f.fleet.asyncReadback, true, 'stale failure does not disable modern readback');
  f.fleet.dispose();
});

test('explicit fullscreen ACES preserves HDR highlights, alpha and exactly one sRGB conversion', () => {
  const f = fixture(), before = f.state(); f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0);
  assert.equal(f.draws[0].target, f.fleet.sceneTarget); assert.equal(f.postDraws[0].target, f.fleet.target);
  assert.equal(f.fleet.sceneTarget.texture.type, T.HalfFloatType);
  assert.equal(f.fleet.sceneTarget.texture.colorSpace, T.LinearSRGBColorSpace);
  assert.equal(f.fleet.target.texture.type, T.UnsignedByteType); assert.equal(f.fleet.target.texture.colorSpace, T.SRGBColorSpace);
  assert.equal(f.fleet.toneMaterial.uniforms.fleetLinear.value, f.fleet.sceneTarget.texture);
  assert.equal(f.fleet.toneMaterial.uniforms.toneMappingExposure.value, .84);
  assert.equal(f.fleet.toneMaterial.toneMapped, false); assert.equal(f.fleet.toneMaterial.blending, T.NoBlending);
  assert.equal(f.fleet.toneGeometry.attributes.position.count, 3, 'one fullscreen triangle, no extra car draw');
  assert.ok(f.fleet.toneMaterial.fragmentShader.includes(T.ShaderChunk.tonemapping_pars_fragment));
  assert.match(f.fleet.toneMaterial.fragmentShader, /vec4\(ACESFilmicToneMapping\(straight\), linear\.a\)/);
  assert.doesNotMatch(f.fleet.toneMaterial.fragmentShader, /colorspace_fragment|sRGBTransferOETF|LinearTosRGB/);
  assert.deepEqual(f.state(), before);
  let triangle = 0, material = 0, hdr = 0, readback = 0;
  f.fleet.toneGeometry.addEventListener('dispose', () => triangle++); f.fleet.toneMaterial.addEventListener('dispose', () => material++);
  f.fleet.sceneTarget.addEventListener('dispose', () => hdr++); f.fleet.target.addEventListener('dispose', () => readback++);
  f.fleet.restoreContext(); assert.deepEqual([triangle, material, hdr, readback], [1, 1, 1, 1]);
  f.fleet.update(0); assert.equal(f.postDraws.length, 2); assert.equal(f.clones.length, 1);
  f.fleet.dispose();
});

test('unsupported half-float rendering gives honest stable fallback, never clipped byte-only preview', () => {
  const f = fixture(); f.renderer.extensions = { has: () => false };
  f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0); settle(f.fleet);
  assert.equal(f.draws.length, 0); assert.equal(f.postDraws.length, 0); assert.equal(f.targets.size, 0);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].status, 'error'); assert.match(f.events[0].error, /HDR miniature preview unavailable/);
  f.fleet.dispose();
});

for (const failure of [null, 'throwRender', 'throwPostRender']) test(`Three-like DPR=2 target binding restores default and applied viewports after ${failure || 'success'}`, () => {
  const f = fixture(), r = f.renderer, ratio = 2, original = {};
  for (const method of ['setViewport', 'setScissor', 'setScissorTest', 'setRenderTarget', 'render']) original[method] = r[method].bind(r);
  let appliedViewport = r.getViewport(new T.Vector4()).multiplyScalar(ratio), appliedScissor = r.getScissor(new T.Vector4()).multiplyScalar(ratio), appliedTest = r.getScissorTest();
  r.getCurrentViewport = out => out.copy(appliedViewport);
  r.setViewport = (...args) => { original.setViewport(...args); appliedViewport = r.getViewport(new T.Vector4()).multiplyScalar(ratio).round(); };
  r.setScissor = (...args) => { original.setScissor(...args); appliedScissor = r.getScissor(new T.Vector4()).multiplyScalar(ratio).round(); };
  r.setScissorTest = value => { original.setScissorTest(value); appliedTest = value; };
  r.setRenderTarget = (target, face, mip) => {
    original.setRenderTarget(target, face, mip);
    appliedViewport = target ? target.viewport.clone() : r.getViewport(new T.Vector4()).multiplyScalar(ratio).floor();
    appliedScissor = target ? target.scissor.clone() : r.getScissor(new T.Vector4()).multiplyScalar(ratio).floor();
    appliedTest = target ? target.scissorTest : r.getScissorTest();
  };
  r.render = (scene, camera) => {
    assert.deepEqual(appliedViewport.toArray(), [0, 0, 320, 180], 'both offscreen passes use target pixels, not multiplied DPR');
    original.render(scene, camera);
  };
  const savedTarget = new T.WebGLRenderTarget(128, 128);
  savedTarget.viewport.set(11, 13, 91, 87); savedTarget.scissor.set(17, 19, 51, 49); savedTarget.scissorTest = false;
  r.setRenderTarget(savedTarget, 4, 2);
  const defaultsBefore = f.state(), appliedBefore = { viewport: appliedViewport.toArray(), scissor: appliedScissor.toArray(), test: appliedTest };
  if (failure) r[failure] = true;
  f.fleet.sync([{ id: 'rocket', canvas: canvas() }]); f.fleet.update(0);
  assert.deepEqual(f.state(), defaultsBefore, 'logical defaults, target, face and mip restored');
  assert.deepEqual({ viewport: appliedViewport.toArray(), scissor: appliedScissor.toArray(), test: appliedTest }, appliedBefore, 'target-owned GL state restored separately');
  assert.equal(f.events.at(-1).status, failure ? 'error' : 'ready');
  f.fleet.dispose(); savedTarget.dispose();
});
