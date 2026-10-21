import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { RouteVehicleMarker, ROUTE_VEHICLE_YAW, fitRouteVehicleCamera } from '../src/route-vehicle-marker.js';
import { fleetVehicleBounds } from '../src/garage-fleet-miniatures.js';
import { createOwnedVehicle } from '../src/owned-vehicles.js';
import { installTrafficTemplates, TRAFFIC_KINDS } from '../src/traffic.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { cosmeticDefinition } from '../src/progression-catalog.js';

const ids = ['rocket', 'hatch', 'sedan', 'suv', 'van'];
const assets = { car: (await loadRoadsterGeometry()).scene, traffic: {} };
for (const id of TRAFFIC_KINDS) assets.traffic[id] = (await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`, import.meta.url))).scene;
installTrafficTemplates(assets.traffic);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const selection = (id = 'rocket', paint = 'paint_copper', scopeKey = 'profile:0') => ({ id, appearance: { 'body.paint': paint }, scopeKey });

function fixture({ async = false } = {}) {
  let target = null, color = new T.Color(), alpha = 1;
  const listeners = new Map(), images = [], clones = [], draws = [], reads = [], deferred = [];
  const context = { createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: image => images.push(image) };
  const canvas = { width: 160, height: 80, isConnected: true, hidden: true, getContext: kind => kind === '2d' ? context : null };
  const element = { dataset: {}, title: '' }, label = { textContent: '' }, status = { textContent: '', hidden: false };
  const renderer = {
    autoClear: true, toneMappingExposure: .84, capabilities: { maxSamples: 4 },
    domElement: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    getViewport: out => out.set(0, 0, 800, 600), getScissor: out => out.set(0, 0, 800, 600),
    getScissorTest: () => false, setViewport() {}, setScissor() {}, setScissorTest() {},
    getClearColor: out => out.copy(color), getClearAlpha: () => alpha,
    setClearColor: (value, opacity) => { color.set(value); alpha = opacity; }, clear() {},
    render(scene, camera) { if (renderer.fail) throw new Error('No GPU preview'); draws.push({ scene, camera: camera.clone(), target }); },
    readRenderTargetPixels(rt, x, y, width, height, bytes) { reads.push(rt); bytes.fill(180); },
  };
  if (async) renderer.readRenderTargetPixelsAsync = (rt, x, y, width, height, bytes) => {
    reads.push(rt); return new Promise((resolve, reject) => deferred.push({ resolve: () => { bytes.fill(200); resolve(); }, reject }));
  };
  const marker = new RouteVehicleMarker({ renderer, canvas, element, label, status, makeVehicle(id, appearance) {
    const vehicle = createOwnedVehicle(assets, id, appearance); clones.push({ id, appearance, vehicle }); return vehicle;
  } });
  const update = (options = {}) => marker.update(.1, { visible: true, paused: false, ...options });
  return { marker, renderer, canvas, element, label, status, images, clones, draws, reads, deferred, listeners, update };
}

test('real GLB selected models use exactly the run paint, face right, and fit the compact camera', () => {
  for (const id of ids) {
    const f = fixture(); f.marker.sync(selection(id)); f.update();
    assert.equal(f.clones.length, 1); assert.equal(f.clones[0].id, id);
    const actual = f.clones[0].vehicle; actual.removeFromParent();
    const bounds = fleetVehicleBounds(actual), center = bounds.getCenter(new T.Vector3());
    assert.equal(actual.userData.ownedVehicleId, id); assert.equal(f.canvas.hidden, false);
    assert.equal(f.element.dataset.vehicleId, id); assert.equal(f.element.dataset.paint, 'paint_copper');
    const paint = new T.Color(cosmeticDefinition('paint_copper').color);
    assert.ok(actual.userData.appearance.paint.length > 0);
    for (const slot of actual.userData.appearance.paint) assert.ok(slot.material.color.equals(paint));
    const record = f.marker.miniature.records.get(id), rotation = new T.Matrix4().makeRotationY(record.yaw);
    assert.equal(record.yaw, ROUTE_VEHICLE_YAW);
    const camera = fitRouteVehicleCamera(new T.OrthographicCamera(), bounds, 2);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const projected = new T.Vector3(x, y, z).sub(center).applyMatrix4(rotation).project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1, id);
    }
    actual.updateMatrixWorld(true);
    const front = actual.getObjectByName('wheel_fl').getWorldPosition(new T.Vector3()).sub(center).applyMatrix4(rotation).project(camera);
    const rear = actual.getObjectByName('wheel_rl').getWorldPosition(new T.Vector3()).sub(center).applyMatrix4(rotation).project(camera);
    assert.ok(front.x > rear.x + .5, `${id} actual front wheel is right of rear wheel`);
    assert.match(f.label.textContent, /Автомобиль заезда:.*Краска: Горячая медь.*вправо/);
    assert.equal(f.marker.miniature.target.width, 160); assert.equal(f.marker.miniature.target.height, 80);
    assert.equal(f.draws.length, 2, 'one real-car draw and one tone-map pass');
    for (let i = 0; i < 240; i++) f.update();
    assert.equal(f.draws.length, 2); assert.equal(f.reads.length, 1, 'zero settled readbacks');
    f.marker.dispose();
  }
});

test('stable loadout order and repeat runs reuse one clone and accepted pixel cache', () => {
  const f = fixture(), picked = selection(); picked.appearance['body.finish'] = 'finish_satin';
  f.marker.sync(picked); f.update();
  f.marker.sync({ ...picked, appearance: { 'body.finish': 'finish_satin', 'body.paint': 'paint_copper' } }); f.update();
  f.update({ visible: false }); f.update();
  assert.equal(f.clones.length, 1); assert.equal(f.reads.length, 1); assert.equal(f.canvas.hidden, false);
  f.marker.dispose();
});

test('selection is copied and an accepted new paint/model never leaves the old image visible', () => {
  const f = fixture(), picked = selection(); f.marker.sync(picked); picked.appearance['body.paint'] = 'paint_chalk'; f.update();
  assert.equal(f.clones[0].appearance['body.paint'], 'paint_copper', 'run selection is immutable');
  f.marker.sync(selection('sedan', 'paint_glacier'));
  assert.equal(f.canvas.hidden, true); assert.equal(f.element.dataset.state, 'loading');
  f.update(); assert.equal(f.canvas.hidden, false); assert.equal(f.element.dataset.vehicleId, 'sedan');
  assert.equal(f.clones.length, 2); assert.equal(f.marker.miniature.records.size, 1);
  f.marker.sync(selection('sedan', 'paint_chalk')); assert.equal(f.canvas.hidden, true); f.update();
  assert.equal(f.clones.length, 3); assert.equal(f.element.dataset.paint, 'paint_chalk');
  f.marker.dispose();
});

for (const change of ['vehicle', 'paint', 'profile', 'removed', 'hidden', 'paused', 'disposed']) test(`late async model pixels are rejected after ${change}`, async () => {
  const f = fixture({ async: true }); f.marker.sync(selection()); f.update();
  if (change === 'vehicle') f.marker.sync(selection('sedan'));
  if (change === 'paint') f.marker.sync(selection('rocket', 'paint_glacier'));
  if (change === 'profile') f.marker.sync(selection('rocket', 'paint_copper', 'profile:1'));
  if (change === 'removed') f.marker.sync(null);
  if (change === 'hidden') f.marker.setActivity({ visible: false });
  if (change === 'paused') f.marker.setActivity({ visible: true, paused: true });
  if (change === 'disposed') f.marker.dispose();
  f.deferred.shift().resolve(); await flush();
  assert.equal(f.images.length, 0); assert.equal(f.canvas.hidden, true);
  if (['vehicle', 'paint', 'profile'].includes(change)) {
    f.update(); f.deferred.shift().resolve(); await flush(); assert.equal(f.images.length, 1); assert.equal(f.canvas.hidden, false);
  }
  f.marker.dispose();
});

test('hidden/paused views stay lazy, preserve a ready image, and have no recurring render work', () => {
  const f = fixture(); f.marker.sync(selection());
  f.update({ visible: false }); f.update({ paused: true });
  assert.equal(f.clones.length, 0); assert.equal(f.reads.length, 0);
  f.update(); const ready = f.images.length;
  for (let i = 0; i < 60; i++) { f.update({ paused: true }); f.update({ visible: false }); }
  assert.equal(f.images.length, ready); assert.equal(f.canvas.hidden, false); assert.equal(f.reads.length, 1);
  f.marker.dispose();
});

test('unavailable real-model preview is an honest stable error, never stale paint or a fake car', () => {
  const f = fixture(); f.marker.sync(selection()); f.update();
  f.renderer.fail = true; f.marker.sync(selection('sedan')); f.update();
  assert.equal(f.canvas.hidden, true); assert.equal(f.element.dataset.state, 'error');
  assert.equal(f.status.textContent, '!'); assert.match(f.label.textContent, /Превью модели недоступно/);
  const reads = f.reads.length; for (let i = 0; i < 120; i++) f.update(); assert.equal(f.reads.length, reads);
  f.marker.dispose();
});

test('context restoration rejects stale GPU pixels and reuses real clone; dispose releases only owned resources', async () => {
  const f = fixture({ async: true }); f.marker.sync(selection()); f.update();
  const old = f.deferred.shift(), record = f.marker.miniature.records.get('rocket');
  const materials = new Set(record.vehicle.userData.ownedAppearanceMaterials);
  let owned = 0, geometry = 0, targets = 0;
  for (const material of materials) material.addEventListener('dispose', () => owned++);
  record.vehicle.traverse(node => node.geometry?.addEventListener('dispose', () => geometry++));
  for (const target of [f.marker.miniature.target, f.marker.miniature.sceneTarget]) target.addEventListener('dispose', () => targets++);
  f.listeners.get('webglcontextlost')(); assert.equal(f.update(), false);
  f.listeners.get('webglcontextrestored')(); f.update(); old.resolve(); await flush(); assert.equal(f.images.length, 0);
  f.deferred.shift().resolve(); await flush(); assert.equal(f.images.length, 1); assert.equal(f.clones.length, 1); assert.equal(targets, 2);
  for (const target of [f.marker.miniature.target, f.marker.miniature.sceneTarget]) target.addEventListener('dispose', () => targets++);
  f.marker.dispose(); f.marker.dispose();
  assert.equal(owned, materials.size); assert.equal(geometry, 0); assert.equal(targets, 4); assert.equal(f.listeners.size, 0);
});

test('production binds the actual started player and equipped loadout, not a shop preview or extra animation loop', async () => {
  const [main, source, html, css] = await Promise.all(['src/main.js', 'src/route-vehicle-marker.js', 'index.html', 'styles/mobile-drive.css'].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  assert.match(main, /routeVehicleSelection=\{id:renderer\.playerVehicleId,appearance:\{\.\.\.profile\.loadouts\[id\]\?\.cosmetics\}/);
  assert.match(main, /routeVehicleMarker=new RouteVehicleMarker\(\{renderer:renderer\.renderer,makeVehicle:\(id,appearance\)=>renderer\.createShowcaseVehicle\(id,appearance\)/);
  assert.match(main, /runResult=null;routeVehicleSelection=null;routeVehicleMarker\?\.sync\(null\)/);
  assert.match(main, /routeVehicleMarker\?\.update\(dt,\{visible:mobileControls&&!orientationBlocked&&!document\.hidden/);
  assert.doesNotMatch(source, /previewId|requestAnimationFrame|new T\.WebGLRenderer|toDataURL|drawImage|setInterval|setTimeout/);
  assert.equal((main.match(/requestAnimationFrame\(tick\)/g) || []).length, 2, 'only existing main frame loop remains');
  assert.match(html, /aria-describedby="mobileGoalVehicleLabel"/); assert.match(html, /<canvas id="mobileGoalVehicleCanvas" width="160" height="80" hidden>/);
  assert.doesNotMatch(html, /<svg class="mobile-goal-car"|mobile-goal-car-body/);
  assert.match(css, /\.mobile-goal-track \{ position: relative; height: 100%; margin: 0 38px 0 20px;/);
  assert.match(css, /\.mobile-goal-flag \{ position: absolute; top: 0; right: -38px; width: 17px/);
  assert.match(css, /\.mobile-goal-car canvas\[hidden\] \{ display: none; \}/);
  assert.ok(38 - 17 > 40 / 2, 'flag starts after the right-facing nose at full progress');
});
