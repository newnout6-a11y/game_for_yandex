import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { createDrivingBonusEffects, DRIVING_BONUS_LIMIT, DRIVING_BONUS_LIFETIME } from '../src/driving-bonus-effects.js';
import { RoadRenderer, roadBend } from '../src/world.js';
import { trafficPose } from '../src/traffic-physics.js';
import { trafficDefinition, TRAFFIC_KINDS } from '../src/traffic-catalog.js';
import { createPlanarMirrorCamera, updatePlanarMirrorCamera } from '../src/player-mirrors.js';

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const vectorNear = (a, b) => a.toArray().forEach((value, index) => near(value, b.toArray()[index]));
const state = (extra = {}) => ({ phase: 'playing', distance: 100, elapsed: 3, revives: 0, traffic: [], ...extra });
const anchor = (s, extra = {}) => ({ lane: .3, z: 12, height: 1.8, distance: s.distance, elapsed: s.elapsed, speed: 0, ...extra });
const fixture = (options = {}) => {
  const scene = new T.Scene(), effects = createDrivingBonusEffects(scene, { bend: roadBend, ...options });
  return { scene, effects, meshes: effects.group.children };
};
const visible = f => f.meshes.filter(mesh => mesh.visible);

/** CPU execution of the production billboard transform on its REAL geometry. */
function billboardClipVertices(mesh, camera) {
  mesh.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
  const center = new T.Vector3().setFromMatrixPosition(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
  const scale = new T.Vector3().setFromMatrixColumn(mesh.matrixWorld, 0).length();
  const vertices = [], position = mesh.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) vertices.push(new T.Vector4(center.x + position.getX(i) * scale,
    center.y + position.getY(i) * scale, center.z, 1).applyMatrix4(camera.projectionMatrix));
  return vertices;
}
function insideClip(v) { return v.w > 0 && Math.abs(v.x) <= v.w && Math.abs(v.y) <= v.w && Math.abs(v.z) <= v.w; }
function cameraAt(position, target) {
  const camera = new T.PerspectiveCamera(60, 1.6, .15, 500);
  camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(true); return camera;
}
function sourceOffsetPosition(item, s, a) {
  const pose = trafficPose(item, s.distance);
  return new T.Vector3(pose.x + Math.cos(pose.yaw) * a.offsetX + Math.sin(pose.yaw) * a.offsetZ,
    a.height, pose.z - Math.sin(pose.yaw) * a.offsetX + Math.cos(pose.yaw) * a.offsetZ);
}

test('all accepted bonuses use small, text-free, depth-tested geometry at immutable source values', () => {
  const f = fixture(), s = state();
  for (const kind of ['pass', 'near', 'charge', 'goal', 'event-clear']) {
    const a = anchor(s); assert.equal(f.effects.emit(kind, Object.freeze(a), s), true);
    const mesh = visible(f).at(-1);
    vectorNear(mesh.position, new T.Vector3((a.lane - 1) * 3.5 + roadBend(-a.z, s.distance), a.height, -a.z));
    assert.equal(mesh.isMesh, true); assert.equal(mesh.material.depthTest, true); assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.map, undefined); assert.equal(mesh.material.side, T.DoubleSide);
    const positions = mesh.geometry.attributes.position;
    assert.equal(positions.count, 4 * 9 * 6); // only four curved segments, no detached ticks
    near(mesh.geometry.boundingSphere.radius, .246);
    for (let i = 0; i < positions.count; i++) {
      const radius = Math.hypot(positions.getX(i), positions.getY(i));
      assert.ok(radius >= .22 - 1e-7 && radius <= .245 + 1e-7);
      assert.equal(positions.getZ(i), 0);
    }
    assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
  }
  assert.equal(f.effects.activeCount, 5);
  for (const kind of ['crash', 'cone', 'event', 'land', 'event-failed', '']) assert.equal(f.effects.emit(kind, anchor(s), s), false);
  f.effects.dispose();
});

test('removed pickups remain at their own captured moving road position, never the player', () => {
  const f = fixture(), s = state(), a = anchor(s, { z: 6, lane: 0, speed: 0 });
  assert.equal(f.effects.emit('charge', a, s), true);
  a.lane = 99; a.z = 99; a.height = 99; // A caller cannot move a queued cue.
  s.elapsed += .2; s.distance += 9; s.x = 2;
  f.effects.update(s, .2);
  const mesh = visible(f)[0]; vectorNear(mesh.position, new T.Vector3(-3.5, 1.8, 3));
  assert.notEqual(mesh.position.x, (s.x - 1) * 3.5);
  f.effects.dispose();
});

test('live traffic nose corners match the actual rear-axle pose for every vehicle and fractional lane', () => {
  for (const kind of TRAFFIC_KINDS) {
    const f = fixture(), s = state({ distance: 870 }), spec = trafficDefinition(kind);
    const car = { id: 12, kind, x: .68, lane: 1, z: 25, heading: .11, speed: 19 }; s.traffic.push(car);
    const a = anchor(s, { lane: car.x, z: car.z, speed: car.speed, heading: car.heading, entityId: car.id, entityKind: car.kind,
      offsetX: spec.width / 2 + .28, offsetZ: -spec.length / 2, height: Math.min(spec.height, 2.4) + .35 });
    f.effects.emit('pass', a, s); vectorNear(visible(f)[0].position, sourceOffsetPosition(car, s, a));
    car.x = .93; car.z = 18; car.heading = -.18; s.distance += 9; s.elapsed += .15;
    f.effects.update(s, .15); vectorNear(visible(f)[0].position, sourceOffsetPosition(car, s, a));
    f.effects.dispose();
  }
});

test('retired traffic uses captured heading and speed, not a recycled mesh or mismatched kind', () => {
  const f = fixture(), s = state(), car = { id: 4, kind: 'semi', x: 1.3, z: 2, heading: .09, speed: 18 };
  s.traffic.push(car);
  const a = anchor(s, { lane: car.x, z: car.z, speed: car.speed, heading: car.heading, entityId: 4, entityKind: 'semi', offsetX: -1.53, offsetZ: -8.2 });
  f.effects.emit('near', a, s);
  s.elapsed += .2; s.distance += 7;
  s.traffic = [{ id: 4, kind: 'sedan', x: 99, z: 99, heading: 0 }];
  f.effects.update(s, .2);
  const fallback = { kind: 'semi', x: a.lane, z: a.z + a.speed * .2 - 7, heading: a.heading };
  vectorNear(visible(f)[0].position, sourceOffsetPosition(fallback, s, a));
  s.traffic = []; f.effects.update(s, 0);
  vectorNear(visible(f)[0].position, sourceOffsetPosition(fallback, s, a));
  f.effects.dispose();
});

test('state replacement, numeric ID reuse, ready, crash, menu and revives clear before another emission', () => {
  const f = fixture(); let s = state();
  f.effects.emit('pass', anchor(s, { entityId: 1, entityKind: 'sedan' }), s);
  const next = state({ traffic: [{ id: 1, kind: 'sedan', lane: 2, z: 90 }] });
  assert.equal(f.effects.sync(next), true); assert.equal(f.effects.activeCount, 0); s = next;
  // Enqueue can be the very first renderer interaction with a new state.
  assert.equal(f.effects.emit('pass', anchor(s), s), true); assert.equal(f.effects.sync(s), false);
  assert.equal(f.effects.activeCount, 1);
  for (const phase of ['ready', 'crashed', 'menu']) {
    s.phase = phase; assert.equal(f.effects.sync(s), true); assert.equal(f.effects.activeCount, 0);
    assert.equal(f.effects.emit('near', anchor(s), s), false);
    s.phase = 'playing'; f.effects.emit('near', anchor(s), s);
  }
  s.revives++; assert.equal(f.effects.sync(s), true); assert.equal(f.effects.activeCount, 0);
  f.effects.emit('goal', anchor(s), s); assert.equal(f.effects.sync(s, true), true); assert.equal(f.effects.activeCount, 0);
  f.effects.sync(s); f.effects.emit('charge', anchor(s), s); assert.equal(f.effects.activeCount, 1);
  f.effects.dispose();
});

test('paused frames freeze source transforms and fade; reduced motion changes opacity only', () => {
  for (const reducedMotion of [false, true]) {
    const f = fixture({ reducedMotion }), s = state(); f.effects.emit('goal', anchor(s), s);
    f.effects.update(s, .1); const mesh = visible(f)[0], before = mesh.position.clone(), scale = mesh.scale.clone(), opacity = mesh.material.uniforms.opacity.value;
    s.distance += 20; s.elapsed += 2;
    for (let i = 0; i < 20; i++) f.effects.update(s, .5, true);
    assert.equal(f.effects.activeCount, 1); vectorNear(mesh.position, before); vectorNear(mesh.scale, scale); near(mesh.material.uniforms.opacity.value, opacity);
    f.effects.update(s, .1);
    assert.notEqual(mesh.position.z, before.z); assert.ok(mesh.material.uniforms.opacity.value < opacity);
    if (reducedMotion) vectorNear(mesh.scale, new T.Vector3(1, 1, 1));
    else assert.ok(mesh.scale.x > scale.x);
    f.effects.update(s, DRIVING_BONUS_LIFETIME); assert.equal(f.effects.activeCount, 0);
    f.effects.dispose();
  }
});

test('fixed eight-cue pool reuses meshes, buffers and materials and disposes resources exactly once', () => {
  const f = fixture(), s = state(), meshes = [...f.meshes], materials = meshes.map(mesh => mesh.material), geometry = meshes[0].geometry;
  let geometriesDisposed = 0, materialsDisposed = 0;
  geometry.addEventListener('dispose', () => geometriesDisposed++);
  for (const material of materials) material.addEventListener('dispose', () => materialsDisposed++);
  for (let i = 0; i < 80; i++) {
    f.effects.emit('pass', anchor(s, { z: i }), s); f.effects.update(s, .001);
    assert.equal(f.effects.activeCount, Math.min(i + 1, DRIVING_BONUS_LIMIT));
    assert.equal(f.meshes.length, DRIVING_BONUS_LIMIT);
  }
  assert.ok(visible(f).every(mesh => -mesh.position.z >= 72)); // only the latest eight
  for (let i = 0; i < meshes.length; i++) {
    assert.equal(f.meshes[i], meshes[i]); assert.equal(f.meshes[i].material, materials[i]); assert.equal(f.meshes[i].geometry, geometry);
  }
  assert.equal(geometriesDisposed, 0); assert.equal(materialsDisposed, 0);
  f.effects.dispose(); f.effects.dispose();
  assert.equal(geometriesDisposed, 1); assert.equal(materialsDisposed, DRIVING_BONUS_LIMIT);
  assert.equal(f.effects.group.parent, null); assert.equal(f.effects.activeCount, 0);
  assert.equal(f.effects.emit('pass', anchor(s), s), false);
});

test('invalid source snapshots never invent a central cue or replace an existing accepted cue', () => {
  const f = fixture(), s = state(); f.effects.emit('pass', anchor(s), s); const mesh = visible(f)[0], position = mesh.position.clone();
  for (const bad of [undefined, {}, { ...anchor(s), z: NaN }, { ...anchor(s), lane: Infinity }, { ...anchor(s), speed: undefined }]) {
    assert.equal(f.effects.emit('charge', bad, s), false); assert.equal(f.effects.activeCount, 1); vectorNear(mesh.position, position);
  }
  f.effects.update(s, NaN); f.effects.update(s, -1); assert.equal(f.effects.activeCount, 1);
  f.effects.dispose();
});

test('real geometry naturally clips behind/near/outside a camera, with perspective size and no edge clamp', () => {
  const f = fixture({ reducedMotion: true }), s = state({ distance: 0 });
  const camera = cameraAt(new T.Vector3(0, 1.8, 0), new T.Vector3(0, 1.8, -1));
  for (const [z, lane, visibleExpected] of [[10, 1, true], [-4, 1, false], [.05, 1, false], [10, 100, false], [600, 1, false]]) {
    f.effects.clear(); f.effects.emit('goal', anchor(s, { z, lane, height: 1.8 }), s);
    const mesh = visible(f)[0], vertices = billboardClipVertices(mesh, camera);
    assert.equal(vertices.some(insideClip), visibleExpected, `z=${z} lane=${lane}`);
    if (z < 0) assert.ok(vertices.every(v => v.w < 0));
    if (lane === 100) assert.ok(vertices.every(v => v.x > v.w));
  }
  f.effects.clear(); f.effects.emit('goal', anchor(s, { z: 10, lane: 1 }), s);
  const mesh = visible(f)[0], nearVertices = billboardClipVertices(mesh, camera);
  mesh.position.z = -20; const farVertices = billboardClipVertices(mesh, camera);
  const width = vertices => Math.max(...vertices.map(v => v.x / v.w)) - Math.min(...vertices.map(v => v.x / v.w));
  near(width(nearVertices), width(farVertices) * 2);
  f.effects.dispose();
});

test('a rear source never appears through the windshield, but uses its real position in a reflected camera', () => {
  const f = fixture({ reducedMotion: true }), s = state({ distance: 0 });
  // A plane behind the real eye reflects a genuinely rearward source.
  const camera = cameraAt(new T.Vector3(0, 1.8, 1), new T.Vector3(0, 1.8, -1));
  f.effects.emit('pass', anchor(s, { z: -8, lane: 1, height: 1.8 }), s);
  const mesh = visible(f)[0]; assert.equal(billboardClipVertices(mesh, camera).some(insideClip), false);
  const mirror = createPlanarMirrorCamera(), plane = new T.Plane(new T.Vector3(0, 0, 1), 0);
  const corners = [new T.Vector3(-.8, 1.3, 0), new T.Vector3(.8, 1.3, 0), new T.Vector3(.8, 2.3, 0), new T.Vector3(-.8, 2.3, 0)];
  assert.equal(updatePlanarMirrorCamera(camera, plane, corners, mirror), true);
  assert.equal(billboardClipVertices(mesh, mirror.camera).some(insideClip), true);
  // The material explicitly billboards per modelViewMatrix, not a main-view quaternion.
  assert.match(mesh.material.vertexShader, /center = modelViewMatrix/);
  assert.doesNotMatch(mesh.material.vertexShader, /clamp\(|cameraQuaternion/);
  f.effects.dispose();
});

test('RoadRenderer clears cues before loading/paused early returns and keeps impact effects only', () => {
  const f = fixture(), s = state(); f.effects.emit('near', anchor(s), s);
  const renderer = { bonusEffects: f.effects, loaded: false, needsRender: false };
  s.phase = 'crashed'; RoadRenderer.prototype.render.call(renderer, s, { paused: true });
  assert.equal(f.effects.activeCount, 0); assert.equal(renderer.needsRender, true);
  s.phase = 'playing'; f.effects.emit('pass', anchor(s), s);
  RoadRenderer.prototype.render.call(renderer, s, { menu: true, paused: true }); assert.equal(f.effects.activeCount, 0);
  // A settled pause does not keep rendering solely to animate a live cue.
  f.effects.emit('pass', anchor(s), s);
  const settled = { bonusEffects: f.effects, loaded: true, needsRender: false, wasPaused: true, pausedFor: 1, particles: [], impact: 0 };
  const pausedMesh = visible(f)[0], pausedPosition = pausedMesh.position.clone(), pausedOpacity = pausedMesh.material.uniforms.opacity.value;
  RoadRenderer.prototype.render.call(settled, s, { paused: true, dt: 30 });
  vectorNear(pausedMesh.position, pausedPosition); near(pausedMesh.material.uniforms.opacity.value, pausedOpacity);
  assert.equal(f.effects.activeCount, 1);
  const emitted = []; const impacts = { spawnParticles: (...args) => emitted.push(args), impact: 0 };
  for (const kind of ['near', 'charge', 'pass']) RoadRenderer.prototype.effect.call(impacts, kind);
  assert.equal(emitted.length, 0);
  RoadRenderer.prototype.effect.call(impacts, 'crash'); RoadRenderer.prototype.effect.call(impacts, 'cone');
  assert.deepEqual(emitted.map(args => args[0]), [34, 8]); assert.equal(impacts.impact, 1);
  f.effects.dispose();
});

test('live reduced-motion changes update active and future cues without advancing paused time', () => {
  const f = fixture(), s = state(); f.effects.emit('near', anchor(s), s);
  f.effects.update(s, .18);
  const mesh = visible(f)[0], position = mesh.position.clone(), opacity = mesh.material.uniforms.opacity.value;
  const movingScale = mesh.scale.x;
  assert.equal(f.effects.setReducedMotion(true), true);
  near(mesh.scale.x, 1); near(mesh.material.uniforms.opacity.value, opacity); vectorNear(mesh.position, position);
  f.effects.update(s, .3, true); near(mesh.scale.x, 1); near(mesh.material.uniforms.opacity.value, opacity);
  assert.equal(f.effects.setReducedMotion(true), false);
  assert.equal(f.effects.setReducedMotion(false), true); near(mesh.scale.x, movingScale);
  f.effects.setReducedMotion(true); f.effects.emit('charge', anchor(s), s);
  assert.ok(visible(f).every(item => item.scale.x === 1));
  f.effects.update(s, .1); assert.ok(visible(f).every(item => item.scale.x === 1));
  f.effects.clear(); assert.equal(f.effects.setReducedMotion(false), false);
  f.effects.emit('goal', anchor(s), s); near(visible(f)[0].scale.x, .88);
  f.effects.dispose(); assert.equal(f.effects.setReducedMotion(true), false);
});

test('production renderer preference assignment propagates before any render/paused guard', () => {
  const f = fixture(), s = state(), renderer = Object.create(RoadRenderer.prototype);
  renderer.reducedMotion = false; renderer.bonusEffects = f.effects; renderer.needsRender = false;
  f.effects.emit('near', anchor(s), s); f.effects.update(s, .1);
  const mesh = visible(f)[0], opacity = mesh.material.uniforms.opacity.value;
  // Same assignment used by the actual matchMedia change callback in main.
  renderer.reducedMotion = true;
  assert.equal(renderer.reducedMotion, true); assert.equal(renderer.needsRender, true); near(mesh.scale.x, 1);
  renderer.loaded = false;
  renderer.render(s, { paused: true, dt: 2 });
  near(mesh.scale.x, 1); near(mesh.material.uniforms.opacity.value, opacity);
  renderer.needsRender = false; renderer.reducedMotion = true; assert.equal(renderer.needsRender, false);
  renderer.reducedMotion = false; assert.equal(renderer.needsRender, true);
  near(mesh.scale.x, .88 + .2 * .1 / DRIVING_BONUS_LIFETIME);
  f.effects.dispose();
});

test('source feedback follows physical impact yaw and signed unearned scene correction',()=>{
 const f=fixture(),s=state({sceneTravel:4}),car={id:14,kind:'sedan',x:.4,z:3,heading:-.4,impactActive:true,impactYaw:.4,speed:18};s.traffic=[car];
 const a=anchor(s,{distance:s.distance+s.sceneTravel,entityId:14,entityKind:'sedan',lane:car.x,z:car.z,heading:car.heading,impactYaw:car.impactYaw,offsetX:1.1,offsetZ:-2.3});
 f.effects.emit('pass',a,s);const p=trafficPose(car,s.distance+s.sceneTravel);vectorNear(visible(f)[0].position,new T.Vector3(p.x+Math.cos(p.yaw)*a.offsetX+Math.sin(p.yaw)*a.offsetZ,a.height,p.z-Math.sin(p.yaw)*a.offsetX+Math.cos(p.yaw)*a.offsetZ));
 f.effects.clear();s.traffic=[];const fixed=anchor(s,{distance:s.distance+s.sceneTravel,z:6});f.effects.emit('charge',fixed,s);s.sceneTravel+=2;f.effects.update(s,0);near(visible(f)[0].position.z,-4);f.effects.dispose();
});

test('checkpoint gate follows crash scene travel from its own creation offset without mutating reward distance',()=>{
 const renderer={hazards:new Map(),hazardPools:{cone:[],barrier:[]},gate:new T.Group(),scene:new T.Scene()};
 const s=state({obstacles:[],sceneTravel:8,roadEvent:{type:'checkpoint',lane:1,remaining:150,sceneTravelStart:8}});RoadRenderer.prototype.renderEvents.call(renderer,s,false);near(renderer.gate.position.z,-150);
 s.sceneTravel=12;RoadRenderer.prototype.renderEvents.call(renderer,s,false);near(renderer.gate.position.z,-146);assert.equal(s.distance,100);assert.equal(s.roadEvent.remaining,150);
});
