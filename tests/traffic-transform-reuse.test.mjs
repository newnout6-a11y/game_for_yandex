import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { TRAFFIC_KINDS, installTrafficTemplates, createTrafficCar, animateTrafficCar, resetTrafficMotion } from '../src/traffic.js';

const models = {};
for (const kind of TRAFFIC_KINDS) {
  const bytes = await readFile(new URL(`../public/assets/traffic/${kind}.glb`, import.meta.url));
  models[kind] = (await new T.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
}
installTrafficTemplates(models);

/** Collect nodes in stable hierarchy order without updating their matrices. */
function nodes(root) { const result = []; root.traverse(node => result.push(node)); return result; }

/** Return every runtime transform pivot that must remain automatically updated. */
function animatedNodes(car) {
  const data = car.userData, driver = data.driver;
  return [car, data.bodyRig, data.trailer, data.trailerRig, ...data.wheels, driver.wheel, driver.head,
    ...driver.arms.flatMap(arm => [arm.shoulder, arm.elbow, arm.hand])].filter(Boolean);
}

/** Apply deterministic dynamic inputs, including trailer travel and signal gestures. */
function frame(car, frameIndex) {
  const time = frameIndex / 60;
  car.position.set(Math.sin(time) * 2, .03, -25); car.rotation.set(.01, Math.sin(time * .7) * .3, -.02);
  if (car.userData.trailer) car.userData.trailer.rotation.y = Math.sin(time * .8) * .15;
  animateTrafficCar(car, { kind: car.userData.kind, z: 25, speed: 24, acceleration: Math.sin(time) * 3,
    laneCurvature: .003 * Math.sin(time), travelDistance: time * 24, signal: frameIndex % 120 < 70 ? -1 : 0,
    signalTime: frameIndex % 120 / 60, trailerTravelDistance: time * 23, trailerCurvature: .002 }, time * 24, 1 / 60);
}

/** Assert local and world matrices match explicit composition, without self-healing getters. */
function assertMatrixConsistency(root, label) {
  for (const node of nodes(root)) {
    const local = new T.Matrix4().compose(node.position, node.quaternion, node.scale);
    assert.deepEqual(node.matrix.elements, local.elements, `${label}: local ${node.name}`);
    const world = node.parent ? new T.Matrix4().multiplyMatrices(node.parent.matrixWorld, local) : local;
    assert.deepEqual(node.matrixWorld.elements, world.elements, `${label}: world ${node.name}`);
  }
}

test('authored mesh locals are cached while all eight vehicle animation pivots stay live', () => {
  for (const kind of TRAFFIC_KINDS) {
    const car = createTrafficCar(kind), animated = new Set(animatedNodes(car));
    for (const node of animated) assert.equal(node.matrixAutoUpdate, true, `${kind}: animated ${node.name}`);
    const immutable = nodes(car).filter(node => node.isMesh && !animated.has(node));
    assert.ok(immutable.length >= 20, `${kind}: meaningful static mesh coverage`);
    for (const node of immutable) assert.equal(node.matrixAutoUpdate, false, `${kind}: immutable ${node.name}`);
    const saved = immutable.map(node => ({ node, geometry: node.geometry, local: node.matrix.elements.slice() }));
    for (const index of [0, 9, 11, 18, 24, 33, 45, 54, 72, 119]) {
      frame(car, index); car.updateMatrixWorld(true);
      assertMatrixConsistency(car, `${kind}/${index}`);
      for (const record of saved) {
        assert.equal(record.node.geometry, record.geometry, `${kind}: shared geometry unchanged`);
        assert.deepEqual(record.node.matrix.elements, record.local, `${kind}: static local unchanged`);
      }
    }
  }
});

test('fresh matrix reads match eager refresh with stale transformed parents, reset and pool reuse', () => {
  for (const kind of TRAFFIC_KINDS) {
    const cached = createTrafficCar(kind), eager = createTrafficCar(kind);
    for (const node of nodes(eager)) node.matrixAutoUpdate = true;
    const cachedParent = new T.Group(), eagerParent = new T.Group();
    cachedParent.add(cached); eagerParent.add(eager);
    const cachedNodes = nodes(cached), eagerNodes = nodes(eager);
    for (let index = 0; index < 240; index++) {
      if (index % 60 === 0) for (const car of [cached, eager]) {
        resetTrafficMotion(car); const parent = car.parent; parent.remove(car); parent.add(car);
      }
      for (const parent of [cachedParent, eagerParent]) {
        parent.position.set(Math.sin(index) * 7, 2, -15);
        parent.rotation.set(.03, Math.cos(index) * .4, -.02); parent.scale.setScalar(1.1);
      }
      // Only the eager reference gets an explicit pre-refresh. The candidate must
      // refresh the intentionally stale parent before reading any rig matrices.
      eagerParent.updateMatrixWorld(true);
      frame(cached, index); frame(eager, index);
      // Inspect the solver's immediate result before any world getter can repair it.
      assert.deepEqual(cachedParent.matrixWorld.elements, eagerParent.matrixWorld.elements, `${kind}: parent ${index}`);
      for (let n = 0; n < cachedNodes.length; n++) {
        assert.deepEqual(cachedNodes[n].matrixWorld.elements, eagerNodes[n].matrixWorld.elements, `${kind}: solver ${index}/${n}`);
        assert.deepEqual(cachedNodes[n].quaternion.toArray(), eagerNodes[n].quaternion.toArray(), `${kind}: joint ${index}/${n}`);
      }
      cached.updateMatrixWorld(true); eager.updateMatrixWorld(true);
      assertMatrixConsistency(cached, `${kind}/pooled/${index}`);
      assert.equal(cached.userData.driver.maxGripError, eager.userData.driver.maxGripError);
    }
  }
});

/** Count local compositions on these instances only; never patch the global prototype. */
function compositionCount(cars) {
  let count = 0;
  const restores = [];
  try {
    for (const car of cars) for (const node of nodes(car)) {
      const own = Object.prototype.hasOwnProperty.call(node, 'updateMatrix'), original = node.updateMatrix;
      node.updateMatrix = function () { count++; return original.call(this); };
      restores.push(() => { if (own) node.updateMatrix = original; else delete node.updateMatrix; });
    }
    for (const car of cars) { frame(car, 18); car.updateMatrixWorld(true); }
  } finally { for (const restore of restores) restore(); }
  return count;
}

test('matrix composition budget stays bounded without caching animated transforms', () => {
  const cached = TRAFFIC_KINDS.map(kind => createTrafficCar(kind));
  const eager = TRAFFIC_KINDS.map(kind => createTrafficCar(kind));
  for (const car of eager) for (const node of nodes(car)) node.matrixAutoUpdate = true;
  const cachedCount = compositionCount(cached), eagerCount = compositionCount(eager);
  assert.ok(cachedCount > 0 && cachedCount <= 600, `cached composition budget: ${cachedCount}`);
  assert.ok(cachedCount < eagerCount * .7, `immutable locals should save work: ${cachedCount}/${eagerCount}`);
  for (const car of cached) for (const node of animatedNodes(car)) assert.equal(node.matrixAutoUpdate, true);
});
