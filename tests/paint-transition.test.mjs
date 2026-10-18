import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { prepareVehicleAppearance, applyVehicleAppearance, createOwnedVehicle } from '../src/owned-vehicles.js';
import { VehiclePaintTransition, paintCoverage } from '../src/paint-transition.js';
import { GarageScene } from '../src/garage-scene.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

function fixture() {
  const car = new T.Group(), body = new T.Group(); body.position.set(.2, .4, .1); car.add(body); car.userData.bodyRig = body;
  const source = new T.MeshPhysicalMaterial({ color: '#b5261b', roughness: .24, metalness: .73, clearcoat: .9 }); source.name = 'body_paint';
  source.map = new T.Texture(); source.normalMap = new T.Texture(); source.roughnessMap = new T.Texture();
  const front = new T.Mesh(new T.BoxGeometry(1, 1, 2), source), rear = new T.Mesh(new T.BoxGeometry(1, 1, 2), source);
  front.position.z = -1; rear.position.z = 1; body.add(front, rear);
  const glass = new T.Mesh(new T.BoxGeometry(), new T.MeshPhysicalMaterial({ transparent: true, opacity: .7 })); glass.material.name = 'glass';
  const chrome = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ metalness: 1 })); chrome.material.name = 'chrome';
  body.add(glass, chrome); prepareVehicleAppearance(car); applyVehicleAppearance(car, {});
  const wipe = new VehiclePaintTransition(car);
  return { car, body, front, rear, glass, chrome, source, wipe, material: front.material };
}
const sameColor = (actual, expected) => assert.ok(actual.distanceTo ? actual.distanceTo(expected) < 1e-8 : Math.abs(actual.r-expected.r)+Math.abs(actual.g-expected.g)+Math.abs(actual.b-expected.b)<1e-8);
const recolor = (f, id) => { applyVehicleAppearance(f.car, { 'body.paint': id }); f.wipe.retarget(); };

test('real paint mask progresses front(-Z) to rear(+Z), with distinct colors at midpoint and narrow edge', () => {
  const f = fixture(), old = f.material.color.clone(); recolor(f, 'paint_glacier'); const next = f.material.color.clone();
  assert.equal(f.wipe.active, true); sameColor(f.wipe.colorAt(-2), old); sameColor(f.wipe.colorAt(2), old);
  f.wipe.setProgress(.5);
  sameColor(f.wipe.colorAt(-1), next); sameColor(f.wipe.colorAt(1), old);
  sameColor(f.wipe.colorAt(0), old.clone().lerp(next, .5));
  assert.equal(paintCoverage(-.06, .5, -2, 2), 1); assert.equal(paintCoverage(.06, .5, -2, 2), 0);
  for (const z of [-2, -1, 0, 1, 2]) { assert.equal(paintCoverage(z, 0, -2, 2), 0); assert.equal(paintCoverage(z, 1, -2, 2), 1); }
  f.wipe.setProgress(1); sameColor(f.wipe.colorAt(-2), next); sameColor(f.wipe.colorAt(2), next);
  f.wipe.setProgress(null); f.wipe.advance(.01); assert.equal(f.wipe.animating, false);
});

test('shader overrides albedo before map multiplication, preserving physical material properties and ownership', () => {
  const f = fixture(), glass = f.glass.material, chrome = f.chrome.material, geometry = f.front.geometry;
  assert.notEqual(f.material, f.source); assert.equal(f.front.material, f.rear.material);
  const stockCompile = f.source.onBeforeCompile;
  const shader = { uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader };
  f.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /garagePaintRootInverse \* modelMatrix \* vec4\(transformed/);
  assert.match(shader.fragmentShader, /1\.0 - smoothstep/); assert.match(shader.fragmentShader, /mix\(garagePaintFrom, garagePaintTo, paintMask\)/);
  assert.ok(shader.fragmentShader.indexOf('diffuseColor.rgb = mix') < shader.fragmentShader.indexOf('#include <map_fragment>'));
  assert.match(shader.fragmentShader, /#include <normal_fragment_maps>/);
  recolor(f, 'paint_copper'); f.wipe.advance(.5);
  assert.equal(shader.uniforms.garagePaintProgress, f.wipe.uniforms.garagePaintProgress);
  assert.equal(shader.uniforms.garagePaintFrom.value, f.wipe.from[0]);
  for (const property of ['map', 'normalMap', 'roughnessMap', 'roughness', 'metalness', 'clearcoat']) assert.equal(f.material[property], f.source[property]);
  assert.equal(f.glass.material, glass); assert.equal(f.chrome.material, chrome); assert.equal(f.source.onBeforeCompile, stockCompile); assert.equal(f.front.geometry, geometry);
  assert.ok(f.car.userData.ownedAppearanceMaterials.includes(f.material));
  const version = f.material.version;
  for (let i = 0; i < 120; i++) f.wipe.advance(1/60);
  assert.equal(f.material.version, version); assert.equal(f.front.geometry, geometry); assert.equal(f.front.material, f.material);
  f.wipe.dispose(); assert.equal(f.material.onBeforeCompile, stockCompile); assert.equal(f.wipe.animating, false);
});

test('root-coordinate seam survives separate mesh transforms, car movement and sprung-body rotation', () => {
  const f = fixture(); recolor(f, 'paint_glacier'); f.wipe.setProgress(.5);
  const local = new T.Vector3(.2, .1, -.8), inverse = f.wipe.uniforms.garagePaintRootInverse.value;
  f.car.updateWorldMatrix(true, true);
  const expected = local.clone().applyMatrix4(f.front.matrixWorld).applyMatrix4(inverse).z;
  f.car.position.set(17, 4, -31); f.car.rotation.set(.2, 1.3, .1); f.car.scale.set(1.2, .9, 1.4);
  f.body.rotation.set(.12, -.08, .17); f.body.position.y += .04;
  f.car.updateWorldMatrix(true, true); f.wipe.updateCoordinates();
  const actual = local.clone().applyMatrix4(f.front.matrixWorld).applyMatrix4(inverse).z;
  assert.ok(Math.abs(actual - expected) < 1e-10);
  sameColor(f.wipe.colorAt(actual), f.wipe.to[0]); assert.deepEqual(f.wipe.uniforms.garagePaintRange.value.toArray(), [-2, 2]);
});

test('rapid choices preserve the current visible split and keep only the latest pending target', () => {
  const f = fixture(); recolor(f, 'paint_glacier'); f.wipe.advance(.38);
  const before = [-2, -.5, 0, 1, 2].map(z => f.wipe.colorAt(z)); const progress = f.wipe.progress;
  for (let i = 0; i < 250; i++) recolor(f, i % 2 ? 'paint_copper' : 'paint_glacier');
  assert.equal(f.wipe.progress, progress); before.forEach((color, i) => sameColor(f.wipe.colorAt([-2, -.5, 0, 1, 2][i]), color));
  assert.equal(f.wipe.pending.length, f.wipe.materials.length);
  const firstTarget = f.wipe.to[0].clone(), finalTarget = f.material.color.clone();
  f.wipe.advance(.95 - .38); assert.equal(f.wipe.active, true); assert.ok(f.wipe.progress < 1e-10);
  sameColor(f.wipe.colorAt(-2), firstTarget); sameColor(f.wipe.colorAt(2), firstTarget);
  f.wipe.advance(.95); assert.equal(f.wipe.active, false); assert.equal(f.wipe.pending, null);
  sameColor(f.wipe.colorAt(-2), finalTarget); sameColor(f.wipe.colorAt(2), finalTarget);
});

test('choosing the active target cancels only the pending request without restarting the visible wipe', () => {
  const f = fixture(); recolor(f, 'paint_glacier'); f.wipe.advance(.2); recolor(f, 'paint_copper');
  assert.ok(f.wipe.pending); recolor(f, 'paint_glacier'); assert.equal(f.wipe.pending, null);
  assert.ok(f.wipe.progress > 0); f.wipe.advance(5); assert.equal(f.wipe.animating, false); sameColor(f.wipe.current[0], f.material.color);
});

test('invalid inputs remain finite; large gaps, offscreen and reduced motion settle the latest saved selection', () => {
  for (const options of [{ visible: false }, { reducedMotion: true }, {}]) {
    const f = fixture(); recolor(f, 'paint_glacier'); f.wipe.advance(.3); recolor(f, 'paint_copper'); const latest = f.material.color.clone(), p = f.wipe.progress;
    for (const dt of [NaN, Infinity, -1, 0]) assert.equal(f.wipe.advance(dt), false);
    assert.equal(f.wipe.progress, p); assert.equal(f.wipe.setProgress(NaN), false);
    assert.equal(f.wipe.advance(100, options), true); assert.equal(f.wipe.animating, false); assert.equal(f.wipe.active, false);
    assert.equal(f.wipe.pending, null); sameColor(f.wipe.colorAt(-2), latest); sameColor(f.wipe.colorAt(2), latest);
    assert.equal(f.wipe.advance(1), false);
  }
  const f = fixture(); applyVehicleAppearance(f.car, { 'body.paint': 'paint_copper' }); f.wipe.retarget({ reducedMotion: true });
  assert.equal(f.wipe.active, false); sameColor(f.wipe.current[0], f.material.color);
});

test('QA seeks are the actual production clock, pause rendering, and resume without new material instances', () => {
  const f = fixture(); recolor(f, 'paint_glacier'); const material = f.material;
  for (const p of [0, .5, 1]) {
    f.wipe.setProgress(p); assert.equal(f.wipe.uniforms.garagePaintProgress.value, p); assert.equal(f.wipe.animating, false);
    assert.equal(f.wipe.advance(.2), false); assert.equal(f.wipe.progress, p);
  }
  f.wipe.setProgress(.5); f.wipe.setProgress(null); assert.equal(f.wipe.animating, true); f.wipe.advance(.1);
  assert.ok(f.wipe.progress > .5); assert.equal(f.front.material, material);
});

test('garage keeps one car for cosmetics, no wipe for other slots, and disposes each owned material exactly once', () => {
  let made = 0; const cars = [], counts = new Map(), statuses = [];
  const scene = new GarageScene({ renderer: {}, makeVehicle(id, appearance) {
    made++; const f = fixture(); f.wipe.dispose(); applyVehicleAppearance(f.car, appearance); cars.push(f.car);
    for (const m of new Set(f.car.userData.ownedAppearanceMaterials)) { counts.set(m, 0); m.addEventListener('dispose', () => counts.set(m, counts.get(m)+1)); }
    return f.car;
  }, onStatus: s => statuses.push(s) });
  scene.setVehicle('rocket', {}); const car = scene.vehicle;
  scene.setVehicle('rocket', { 'body.finish': 'finish_satin' }); assert.equal(scene.animating, false);
  scene.setVehicle('rocket', { 'body.paint': 'paint_glacier' }); assert.equal(scene.vehicle, car); assert.equal(made, 1); assert.equal(scene.animating, true);
  scene.setPaintProgress(.5); assert.equal(statuses.at(-1).paintProgress, .5); assert.equal(scene.animating, false);
  scene.setPaintProgress(null); assert.equal(scene.advance(.2), true); assert.equal(scene.advance(.2, { visible: false }), true); assert.equal(scene.animating, false);
  assert.equal(scene.advance(.2), false); scene.setVehicle('hatch'); assert.equal(made, 2);
  for (const material of car.userData.ownedAppearanceMaterials) assert.equal(counts.get(material), 1);
  scene.dispose(); scene.dispose(); for (const count of counts.values()) assert.equal(count, 1);
});

test('unowned/shared paint is not modified or shader-patched', () => {
  const source = new T.MeshStandardMaterial({ color: '#112233' }), car = new T.Group(); car.add(new T.Mesh(new T.BoxGeometry(), source));
  car.userData.appearance = { paint: [{ material: source }] }; const compile = source.onBeforeCompile, wipe = new VehiclePaintTransition(car);
  assert.equal(wipe.materials.length, 0); assert.equal(source.onBeforeCompile, compile); assert.equal(wipe.retarget(), false); assert.equal(wipe.animating, false);
});

test('actual Roadster body slots use one shared sprung frame without changing the source or race car', async () => {
  const template = (await loadRoadsterGeometry()).scene, assets = { car: template }, showroom = createOwnedVehicle(assets), race = createOwnedVehicle(assets);
  const sourceMaterials = new Set(), sourceGeometry = new Set(); template.traverse(node => { if (node.isMesh) { sourceMaterials.add(node.material); sourceGeometry.add(node.geometry); } });
  const sourceHooks = [...sourceMaterials].map(material => material.onBeforeCompile), raceHooks = race.userData.appearance.paint.map(({ material }) => material.onBeforeCompile);
  const wipe = new VehiclePaintTransition(showroom), old = wipe.current[0].clone();
  applyVehicleAppearance(showroom, { 'body.paint': 'paint_glacier' }); wipe.retarget(); wipe.setProgress(.5);
  const { x: min, y: max } = wipe.uniforms.garagePaintRange.value, span = max - min;
  assert.ok(span > 3.5 && span < 6); assert.ok(min < 0 && max > 0);
  sameColor(wipe.colorAt(min + span * .2), showroom.userData.appearance.paint[0].material.color);
  sameColor(wipe.colorAt(min + span * .8), old);
  showroom.traverse(node => {
    if (!node.isMesh) return; assert.ok(sourceGeometry.has(node.geometry));
    if (!wipe.materials.includes(node.material)) return;
    let parent = node; while (parent && parent !== showroom.userData.bodyRig) parent = parent.parent;
    assert.equal(parent, showroom.userData.bodyRig);
  });
  assert.deepEqual([...sourceMaterials].map(material => material.onBeforeCompile), sourceHooks);
  assert.deepEqual(race.userData.appearance.paint.map(({ material }) => material.onBeforeCompile), raceHooks);
  assert.ok(race.userData.appearance.paint.every(({ material }) => !wipe.materials.includes(material)));
});
