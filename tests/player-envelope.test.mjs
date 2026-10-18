import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { PLAYER_BOUNDS } from '../src/player-spec.js';
import { PLAYER_BOUNDS as COLLISION_BOUNDS } from '../src/traffic-physics.js';
import { createCar, animatePlayerCar, setPlayerAeroPose } from '../src/car.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

/**
 * Measure actual transformed vertices, avoiding inflated rotated local boxes.
 * The input car must already have its current world matrices updated.
 * @param {T.Object3D} car - Runtime model with applied wheel and wing pose.
 * @returns {T.Box3} Exact axis-aligned enclosure of the sampled mesh vertices.
 */
function vertexBounds(car) {
  const bounds = new T.Box3(), point = new T.Vector3();
  car.traverse(node => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

test('collision and lane reservations share one conservative Rocket envelope', () => {
  assert.equal(COLLISION_BOUNDS, PLAYER_BOUNDS);
  assert.ok(Object.isFrozen(PLAYER_BOUNDS));
  assert.deepEqual(PLAYER_BOUNDS, { length: 4.7, width: 2.36, height: 1.35 });
});

test('actual Rocket vertices fit the player collision envelope through steering and wing travel', async () => {
  const { scene } = await loadRoadsterGeometry(), car = createCar(scene);
  const all = new T.Box3(), epsilon = 2e-5;
  // Pose samples include the stowing tips, maximum steering and four tire phases.
  // This is a measured regression with rounded-up margin, not a continuous proof.
  for (const deployment of [0, .1, .4, .7, 1]) {
    setPlayerAeroPose(car, deployment);
    for (const steer of [-.3, 0, .3]) for (const phase of [0, .4, 1.1, 2.2]) {
      animatePlayerCar(car, phase * car.userData.wheelRadius, steer);
      car.updateMatrixWorld(true);
      all.union(vertexBounds(car));
    }
  }
  assert.ok(all.min.x >= -PLAYER_BOUNDS.width / 2 - epsilon && all.max.x <= PLAYER_BOUNDS.width / 2 + epsilon,
    `steered width [${all.min.x}, ${all.max.x}] exceeds reserved half-width`);
  assert.ok(all.min.z >= -PLAYER_BOUNDS.length / 2 - epsilon && all.max.z <= PLAYER_BOUNDS.length / 2 + epsilon,
    `longitudinal extent [${all.min.z}, ${all.max.z}] exceeds collision length`);
  assert.ok(all.max.y <= PLAYER_BOUNDS.height + epsilon, `deployed height ${all.max.y} exceeds collision height`);
  assert.ok(all.min.y >= -.002, `rotating tires fall below the authored road plane: ${all.min.y}`);
});
