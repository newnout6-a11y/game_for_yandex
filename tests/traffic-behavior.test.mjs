import test from 'node:test';
import assert from 'node:assert/strict';
import { trafficLateral, occupiedTrafficLanes, updateTrafficManoeuvres } from '../src/traffic-behavior.js';

const STEP = 1 / 120;
/**
 * Create a planner fixture eligible to make an immediate lane decision.
 * Extra fields override every default, including speed, cooldown and identity.
 * @param {number} id - Stable tie-break identity.
 * @param {number} lane - Lane index (0, 1 or 2).
 * @param {number} z - Longitudinal distance relative to the player, in metres.
 * @param {number} [speed=22] - Current and default cruise speed in m/s.
 * @param {string} [kind='sedan'] - Traffic catalog kind.
 * @param {object} [extra={}] - State overrides.
 * @returns {object} Fresh mutable traffic state.
 */
const car = (id, lane, z, speed = 22, kind = 'sedan', extra = {}) => ({
  id, lane, z, speed, cruiseSpeed: speed, kind, laneChangeCooldown: 0, laneDecisionIn: 0, ...extra,
});
/**
 * Create a faster follower behind a slow leader with a clear left lane.
 * A roadworks fixture closes lane 2, constraining the expected passing choice.
 * @param {string} [kind='sedan'] - Follower catalog kind.
 * @returns {object} Shared mutable state plus follower and leader references.
 */
function opportunity(kind = 'sedan') {
  const follower = car(1, 1, 220, 22, kind, { cruiseSpeed: 24 });
  const leader = car(2, 1, 250, 16);
  const state = { traffic: [follower, leader], x: 2, lane: 2, safeLane: 2, speed: 0,
    obstacles: [], roadEvent: { type: 'roadworks', lane: 2 } };
  return { state, follower, leader };
}
/**
 * Run only the lane planner at 120 Hz, without integrating forward travel.
 * @param {object} state - Traffic state mutated in place by manoeuvre updates.
 * @param {number} [count=1] - Number of 1/120-second planner steps.
 */
function step(state, count = 1) { for (let i = 0; i < count; i++) updateTrafficManoeuvres(state, STEP); }

test('lateral coordinate uses finite x, and occupancy includes both reserved lanes and full rotated body', () => {
  assert.equal(trafficLateral({ lane: 2 }), 2);
  assert.equal(trafficLateral({ lane: 2, x: 0 }), 0);
  assert.equal(trafficLateral({ lane: 2, x: Infinity }), 2);
  assert.equal(trafficLateral({ lane: 2, x: NaN }), 2);
  assert.deepEqual(occupiedTrafficLanes(car(1, 1, 0)), [1]);
  assert.deepEqual(occupiedTrafficLanes(car(1, 1, 0, 20, 'sedan', { laneChange: { from: 1, to: 0 } })), [0, 1]);
  assert.deepEqual(occupiedTrafficLanes(car(1, 0, 0, 20, 'sedan', { x: .4 })), [0, 1]);
  assert.deepEqual(occupiedTrafficLanes(car(1, 1, 0, 20, 'semi', { heading: .15 })), [0, 1, 2]);
});

test('free traffic never wanders, changes lanes without a slower leader, or moves longitudinally here', () => {
  const follower = car(1, 1, 220);
  const state = { traffic: [follower], x: 2, safeLane: 2, speed: 0 };
  step(state, 120 * 35);
  assert.equal(follower.laneChange, undefined);
  assert.equal(follower.x, 1);
  assert.equal(follower.signal, 0);
  assert.equal(follower.lateralSpeed, 0);
  assert.equal(follower.z, 220);
  assert.equal(follower.speed, 22);
  state.traffic.push(car(2, 1, 250, 22));
  step(state, 120 * 5);
  assert.equal(follower.laneChange, undefined);
});

test('intentional overtake signals for at least 0.7s, reserves both lanes and leaves lane at source', () => {
  const { state, follower } = opportunity();
  step(state);
  assert.equal(follower.signal, -1);
  assert.equal(follower.signalTime, 0);
  assert.equal(follower.laneChange.phase, 'signal');
  assert.equal(follower.laneChange.duration, 3.4);
  assert.deepEqual(occupiedTrafficLanes(follower), [0, 1]);
  step(state, 84);
  assert.equal(follower.laneChange.phase, 'signal');
  assert.equal(follower.x, 1);
  assert.equal(follower.lane, 1);
  assert.equal(follower.lateralSpeed, 0);
  assert.ok(Math.abs(follower.signalTime - .7) < 1e-12);
  step(state, 18);
  assert.equal(follower.laneChange.phase, 'moving');
  assert.equal(follower.lane, 1);
  assert.ok(Math.abs(follower.x - 1) < 1e-12);
  step(state, 120);
  assert.ok(follower.x > 0 && follower.x < 1);
  assert.equal(follower.lane, 1);
  assert.ok(follower.heading < 0);
  assert.equal(follower.z, 220);
  assert.equal(follower.speed, 22);
});

test('quintic path and derivatives are continuous, finite, dimensioned and exactly settle', () => {
  const { state, follower } = opportunity();
  follower.acceleration = -.8;
  step(state);
  let previousX = follower.x, previousV = 0, previousA = 0, movingSamples = 0;
  while (follower.laneChange) {
    step(state);
    assert.ok(follower.x <= previousX + 1e-12);
    assert.ok(Math.abs(follower.x - previousX) < .005);
    assert.ok(Math.abs(follower.lateralSpeed - previousV) < .016);
    assert.ok(Math.abs(follower.lateralAcceleration - previousA) < .05);
    for (const field of ['x', 'lateralSpeed', 'lateralAcceleration', 'heading', 'laneCurvature']) assert.ok(Number.isFinite(follower[field]), field);
    if (follower.laneChange?.phase === 'moving') {
      movingSamples++;
      const u = follower.laneChange.elapsed / 3.4;
      assert.ok(Math.abs(follower.x - (1 - (10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5))) < 1e-12);
      assert.ok(Math.abs(follower.heading - Math.atan2(follower.lateralSpeed, 22)) < 1e-12);
      const expected = (22 * follower.lateralAcceleration + .8 * follower.lateralSpeed) / (22 ** 2 + follower.lateralSpeed ** 2) ** 1.5;
      assert.ok(Math.abs(follower.laneCurvature - expected) < 1e-12);
    }
    previousX = follower.x; previousV = follower.lateralSpeed; previousA = follower.lateralAcceleration;
  }
  assert.ok(movingSamples >= 407);
  assert.equal(follower.x, 0);
  assert.equal(follower.lane, 0);
  assert.equal(follower.signal, 0);
  assert.equal(follower.signalTime, 0);
  assert.equal(follower.lateralSpeed, 0);
  assert.equal(follower.lateralAcceleration, 0);
  assert.equal(follower.heading, 0);
  assert.equal(follower.laneCurvature, 0);
  assert.deepEqual(occupiedTrafficLanes(follower), [0]);
  assert.ok(follower.laneChangeCooldown >= 18);
  // Even an immediate new obstruction cannot cause a bounce back.
  state.traffic.push(car(3, 0, 245, 14));
  step(state, 120 * 10);
  assert.equal(follower.laneChange, null);
  assert.equal(follower.x, 0);
});

test('van/special and heavy vehicles get slower trajectories; rightward motion has positive heading', () => {
  for (const [kind, duration] of [['sedan', 3.4], ['van', 4.2], ['towtruck', 4.2], ['firetruck', 4.2], ['boxtruck', 5], ['semi', 5]]) {
    const { state, follower, leader } = opportunity(kind);
    follower.lane = 0; leader.lane = 0;
    step(state);
    assert.equal(follower.laneChange?.duration, duration, kind);
    assert.equal(follower.laneChange.to, 1, kind);
    step(state, 140);
    assert.ok(follower.lateralSpeed > 0, kind);
    assert.ok(follower.heading > 0, kind);
  }
});

test('nearby player, player approach during manoeuvre, and reserved interaction corridors forbid changes', () => {
  for (const setup of [
    ({ state, follower, leader }) => { follower.z = 80; leader.z = 110; state.speed = 20; state.x = 0; },
    ({ state }) => { state.speed = 50; state.x = 0; },
    ({ state, follower, leader }) => { follower.z = 180; leader.z = 210; state.speed = 22; state.safeLane = 0; },
    ({ state, follower, leader }) => { follower.z = 180; leader.z = 210; state.speed = 22; state.x = 0; },
  ]) {
    const fixture = opportunity(); setup(fixture); step(fixture.state);
    assert.equal(fixture.follower.laneChange, undefined);
  }
});

test('visible overtakes away from the player keep their corridor clear; projected blind-side cuts do not', () => {
  {
    const { state, follower, leader } = opportunity();
    follower.z = 35; leader.z = 65; state.speed = 24;
    step(state);
    assert.equal(follower.laneChange?.to, 0);
    assert.equal(state.safeLane, 2);
  }
  for (const setup of [
    ({ state }) => { state.heading = -.08; },
    ({ follower }) => { follower.kind = 'semi'; },
    ({ state }) => { state.x = 1.6; },
  ]) {
    const fixture = opportunity();
    fixture.follower.z = 35; fixture.leader.z = 65; fixture.state.speed = 24;
    setup(fixture); step(fixture.state);
    assert.equal(fixture.follower.laneChange, undefined);
  }
});

test('the safe lane is reserved even far beyond the immediate player interaction zone', () => {
  const { state, follower } = opportunity();
  state.safeLane = 0;
  step(state);
  assert.equal(follower.laneChange, undefined);
});

test('closed roadworks lanes, road objects and event cars cannot be used for overtaking', () => {
  {
    const { state, follower } = opportunity();
    state.roadEvent.lane = 0;
    state.traffic.push(car(3, 2, 220));
    step(state); assert.equal(follower.laneChange, undefined);
  }
  {
    const { state, follower } = opportunity();
    state.obstacles.push({ kind: 'barrier', x: 0, z: 300 });
    step(state); assert.equal(follower.laneChange, undefined);
  }
  for (const flag of ['eventId', 'eventBraking']) {
    const { state, follower } = opportunity();
    follower[flag] = 1;
    step(state); assert.equal(follower.laneChange, undefined);
  }
});

test('future front/rear closing gaps are rejected even when their current gap looks ample', () => {
  for (const other of [car(3, 0, 285, 10), car(3, 0, 150, 34)]) {
    const { state, follower } = opportunity();
    state.traffic.push(other);
    step(state);
    assert.equal(follower.laneChange, undefined);
  }
  // A distant non-closing car is not a blanket prohibition.
  const { state, follower } = opportunity();
  state.traffic.push(car(3, 0, 360, 24));
  step(state);
  assert.equal(follower.laneChange?.to, 0);
});

test('a long trailer consumes a target gap that fits a passenger car', () => {
  for (const [kind, allowed] of [['sedan', true], ['semi', false]]) {
    const { state, follower } = opportunity();
    state.traffic.push(car(3, 0, 188, 22, kind));
    step(state);
    assert.equal(Boolean(follower.laneChange), allowed, kind);
  }
});

test('another changing truck reserves its source corridor even when almost in its new lane', () => {
  const { state, follower } = opportunity();
  const truck = car(3, 0, 188, 22, 'semi', {
    x: .99, laneChange: { from: 0, to: 1, phase: 'moving', elapsed: 4.5, signalDuration: .85, duration: 5 },
  });
  state.traffic.push(truck);
  step(state);
  assert.ok(truck.x > .99);
  assert.deepEqual(occupiedTrafficLanes(truck), [0, 1]);
  assert.equal(follower.laneChange, undefined);
});

test('converging traffic claims one corridor deterministically regardless of array ordering', () => {
  /**
   * Assert one of two converging vehicles wins the center-lane reservation.
   * Runs one simulated second with either traffic-array order and returns the
   * winner for the outer equality check, isolating deterministic tie-breaking.
   * @param {boolean} reverse - Reverse the newly created array before stepping.
   * @returns {number} ID of the sole vehicle changing to lane 1.
   */
  const run = reverse => {
    const left = car(10, 0, 220, 22, 'sedan', { cruiseSpeed: 24 });
    const right = car(11, 2, 222, 22, 'sedan', { cruiseSpeed: 24 });
    const traffic = [left, right, car(12, 0, 250, 16), car(13, 2, 252, 16)];
    const state = { traffic: reverse ? traffic.reverse() : traffic, x: 0, safeLane: 0, speed: 0 };
    step(state, 120);
    const changing = traffic.filter(c => c.laneChange);
    assert.equal(changing.length, 1);
    assert.equal(changing[0].laneChange.to, 1);
    return changing[0].id;
  };
  assert.equal(run(false), run(true));
});

test('a newly blocked signal is cancelled without any lateral position or velocity discontinuity', () => {
  for (const block of [
    state => { state.roadEvent.lane = 0; },
    state => { state.traffic.push(car(3, 0, 220)); },
    state => { state.speed = 60; state.x = 0; },
  ]) {
    const { state, follower } = opportunity();
    step(state, 50);
    assert.equal(follower.laneChange.phase, 'signal');
    block(state); step(state);
    assert.equal(follower.laneChange, null);
    assert.equal(follower.x, 1);
    assert.equal(follower.lane, 1);
    assert.equal(follower.lateralSpeed, 0);
    assert.equal(follower.signal, 0);
    assert.ok(follower.laneChangeCooldown >= 4);
  }
});

test('invalid/zero dt is a no-op and seeded ordinary eligibility is repeatable', () => {
  const a = opportunity(), b = opportunity();
  delete a.follower.laneChangeCooldown; delete b.follower.laneChangeCooldown;
  delete a.follower.laneDecisionIn; delete b.follower.laneDecisionIn;
  const before = structuredClone(a.state);
  for (const dt of [0, -1, NaN, Infinity]) updateTrafficManoeuvres(a.state, dt);
  assert.deepEqual(a.state, before);
  step(a.state, 120 * 4); step(b.state, 120 * 4);
  assert.deepEqual(a.state, b.state);
});
