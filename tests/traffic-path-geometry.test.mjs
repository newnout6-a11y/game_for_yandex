import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TRAFFIC_KINDS, trafficDefinition } from '../src/traffic-catalog.js';
import { occupiedTrafficLanes } from '../src/traffic-behavior.js';
import { roadCurve, trafficPose, trafficYaw, trafficPathCurvature, trafficCollisionParts } from '../src/traffic-physics.js';

/**
 * Evaluate a quintic lane change and its analytic lateral derivatives.
 * Uses a 20 m/s forward speed and a 3.5 m lane width; the semi takes 5 seconds
 * while other fixtures take 3.4 seconds. No game state is mutated.
 * @param {string} kind - Catalog kind whose rear-axle geometry will be tested.
 * @param {number} t - Elapsed manoeuvre time in seconds.
 * @param {number} direction - Signed lane change, normally -1 or 1.
 * @returns {object} Traffic state with lane coordinates, metres, m/s and radians.
 */
function manoeuvre(kind, t, direction) {
  const duration = kind === 'semi' ? 5 : 3.4, u = t / duration, speed = 20;
  const lateralSpeed = direction * 3.5 * 30 * u ** 2 * (1 - u) ** 2 / duration;
  const lateralAcceleration = direction * 3.5 * 60 * u * (1 - u) * (1 - 2 * u) / duration ** 2;
  return { kind, lane: 1, x: 1 + direction * (10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5),
    z: 200 + speed * t, speed, lateralSpeed, lateralAcceleration,
    heading: Math.atan2(lateralSpeed, speed),
    laneCurvature: speed * lateralAcceleration / (speed ** 2 + lateralSpeed ** 2) ** 1.5 };
}
/**
 * Recover the rear-axle world point from the production body pose.
 * @param {object} car - Traffic state accepted by trafficPose().
 * @param {number} distance - Travelled road distance in metres.
 * @returns {{x:number,z:number}} Rear-axle coordinates in metres, without mutation.
 */
function axle(car, distance) {
  const pose = trafficPose(car, distance), rear = trafficDefinition(car.kind).rearAxleZ;
  return { x: pose.x + Math.sin(pose.yaw) * rear, z: pose.z + Math.cos(pose.yaw) * rear };
}

test('composed curved-road heading follows the actual rear-axle path without lateral skating', () => {
  for (const kind of TRAFFIC_KINDS) for (const distance of [0, 1350, 4300]) for (const direction of [-1, 1]) for (const u of [.15, .4, .5, .85]) {
    const duration = kind === 'semi' ? 5 : 3.4, t = u * duration, dt = 1e-4;
    const a = axle(manoeuvre(kind, t - dt, direction), distance), b = axle(manoeuvre(kind, t + dt, direction), distance);
    const car = manoeuvre(kind, t, direction), yaw = trafficYaw(car, distance);
    const vx = (b.x - a.x) / (2 * dt), vz = (b.z - a.z) / (2 * dt);
    const lateralSlip = vx * Math.cos(yaw) - vz * Math.sin(yaw);
    assert.ok(Math.abs(lateralSlip) < 2e-7, JSON.stringify({ kind, distance, direction, u, lateralSlip }));
  }
});

test('shared composed curvature matches differentiated road-plus-lane geometry in both directions', () => {
  for (const kind of ['sedan', 'semi']) for (const distance of [0, 1350, 4300]) for (const direction of [-1, 1]) for (const u of [.15, .4, .5, .85]) {
    const duration = kind === 'semi' ? 5 : 3.4, t = u * duration, dt = 1e-3;
    const car = manoeuvre(kind, t, direction), a = axle(manoeuvre(kind, t - dt, direction), distance);
    const m = axle(car, distance), b = axle(manoeuvre(kind, t + dt, direction), distance);
    const vx = (b.x - a.x) / (2 * dt), vz = (b.z - a.z) / (2 * dt);
    const ax = (b.x - 2 * m.x + a.x) / dt ** 2, az = (b.z - 2 * m.z + a.z) / dt ** 2;
    const numerical = (vx * az - vz * ax) / Math.hypot(vx, vz) ** 3;
    const actual = trafficPathCurvature(car, distance);
    assert.ok(Math.abs(numerical - actual) < 2e-7, JSON.stringify({ kind, distance, direction, u, numerical, actual }));
  }
});

test('full-angle tangent composition preserves backward and sideways inspection-circle headings', () => {
  for (const heading of [-3, -1.8, -Math.PI / 2, -.3, 0, .3, Math.PI / 2, 1.8, 3]) {
    const car = { kind: 'semi', lane: 1, z: 100, heading, laneCurvature: .08 };
    const yaw = trafficYaw(car, -385);
    assert.ok(Math.abs(Math.sin(yaw) + Math.sin(heading)) < 1e-12);
    assert.ok(Math.abs(Math.cos(yaw) - Math.cos(heading)) < 1e-12);
    assert.ok(Math.abs(trafficPathCurvature(car, -385) - .08) < 1e-12);
  }
});

/**
 * Project every collision-part corner back into continuous lane coordinates.
 * Includes the articulated trailer, allowing tests to detect its lagging tail.
 * @param {object} car - Traffic state, including articulation when present.
 * @param {number} distance - Travelled road distance in metres.
 * @returns {number[]} Minimum and maximum lane coordinates; 1.5 borders lanes 1/2.
 */
function occupiedBodyRange(car, distance) {
  let min = Infinity, max = -Infinity;
  for (const p of trafficCollisionParts(car, distance)) for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const x = p.x + side * p.halfWidth * p.right[0] + end * p.halfLength * p.forward[0];
    const z = p.z + side * p.halfWidth * p.right[1] + end * p.halfLength * p.forward[1];
    const lane = 1 + (x - roadCurve(z, distance)) / 3.5;
    min = Math.min(min, lane); max = Math.max(max, lane);
  }
  return [min, max];
}

test('completed slow semi keeps its source reservation until the articulated tail actually clears', () => {
  const game = new Game(); game.start(); const state = game.state;
  const truck = { id: 901, kind: 'semi', lane: 1, z: 273.8797462382354,
    speed: 12.450110145611688, cruiseSpeed: 15.450110145611688, laneChangeCooldown: 0, laneDecisionIn: 0 };
  const leader = { id: 902, kind: 'van', lane: 1, z: 307.32838930143046,
    speed: 7.450110145611688, cruiseSpeed: 7.450110145611688 };
  Object.assign(state, { traffic: [truck, leader], distance: 2606.4080935902894,
    speed: 10.935729655437171, x: 0, lane: 0, safeLane: 0, invincible: 1e9,
    nextSpawn: Infinity, nextEvent: Infinity });
  let completed = false, tailSeen = false;
  for (let i = 0; i < 1200; i++) {
    game.update(1 / 120, { throttle: (.8 + state.speed ** 2 * .0012) / 8 });
    if (truck.lane === 2 && !truck.laneChange) {
      completed = true;
      if (occupiedBodyRange(truck, state.distance)[0] < 1.5) {
        tailSeen = true;
        assert.ok(occupiedTrafficLanes(truck).includes(1), 'trailer still protrudes into its source lane');
      }
    }
  }
  assert.ok(completed && tailSeen, 'fixture must exercise the post-manoeuvre trailer lag');
  assert.deepEqual(occupiedTrafficLanes(truck), [2], 'source is released once the trailer settles');
  assert.ok(occupiedBodyRange(truck, state.distance)[0] > 1.5);
});

test('articulated reservations include tail overhang on either side but do not blanket-reserve straight trucks', () => {
  assert.deepEqual(occupiedTrafficLanes({ kind: 'semi', lane: 1, x: 1, heading: 0, trailerAngle: 0 }), [1]);
  assert.deepEqual(occupiedTrafficLanes({ kind: 'semi', lane: 2, x: 2, heading: 0, trailerAngle: -.06 }), [1, 2]);
  assert.deepEqual(occupiedTrafficLanes({ kind: 'semi', lane: 0, x: 0, heading: 0, trailerAngle: .06 }), [0, 1]);
});
