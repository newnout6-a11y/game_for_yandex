import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePlayerPath, playerEffectiveGrip, PLAYER_HANDLING, PLAYER_WHEELBASE } from '../src/player-motion.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const energy = s => .5 * (s.speed ** 2 + s.lateralVelocity ** 2 + PLAYER_WHEELBASE ** 2 * PLAYER_HANDLING.yawInertia * s.yawRate ** 2);

/** Advance exact input segment lengths, including a fractional last frame. */
function run(state, seconds, input, hz = 120) {
  let travelled = 0;
  for (let t = 0; t < seconds - 1e-10;) {
    const dt = Math.min(1 / hz, seconds - t);
    travelled += updatePlayerPath(state, input, dt); t += dt;
  }
  return travelled;
}

test('a side impact keeps translational and angular momentum on the next steering step', () => {
  for (const sign of [-1, 1]) {
    const s = { x: 1, speed: 40, forwardVelocity: 40, lateralVelocity: sign * 6, yawRate: sign * .8, heading: 0 };
    updatePlayerPath(s, 0, 1 / 120);
    assert.ok(s.lateralVelocity * sign > 5.88, 'finite tire force cannot erase a 6 m/s impact');
    assert.ok(s.yawRate * sign > .7, 'angular impact is not replaced by a kinematic yaw rate');
    assert.ok((s.x - 1) * sign > .014);
    assert.ok(s.heading * sign > 0);
    assert.ok(s.forwardVelocity > 39.9);
    close(s.speed, s.forwardVelocity);
    run(s, 2, 0);
    assert.ok(Math.abs(s.lateralVelocity) < .001);
    assert.ok(Math.abs(s.yawRate) < .001);
    assert.ok(Math.abs(s.heading) < .001);
  }
});

test('tire grip cannot supply free energy during turn, release, reversal or impact recovery', () => {
  for (const impulse of [false, true]) {
    const s = { x: 1, speed: 40, lateralVelocity: impulse ? 6 : 0, yawRate: impulse ? .8 : 0, heading: 0 };
    let previous = energy(s);
    for (let frame = 0; frame < 720; frame++) {
      updatePlayerPath(s, frame < 100 ? 1 : frame < 200 ? -1 : 0, 1 / 120);
      s.x = 1; // Infinite clear test road; do not alter velocity or orientation.
      const current = energy(s);
      assert.ok(current <= previous + 1e-8, `ground tires added ${current - previous} J/kg`);
      previous = current;
    }
  }
});

test('turning builds velocity through grip and reduces forward travel rather than adding full-speed diagonals', () => {
  const s = { x: 1, speed: 52, lateralVelocity: 0, yawRate: 0, heading: 0 };
  let previousVelocity = 0, maximumSlip = 0;
  for (let i = 0; i < 84; i++) {
    updatePlayerPath(s, 1, 1 / 120);
    assert.ok(Math.abs(s.lateralVelocity - previousVelocity) <= playerEffectiveGrip(s) / 120 + 1e-9);
    previousVelocity = s.lateralVelocity; maximumSlip = Math.max(maximumSlip, Math.abs(s.slipAngle));
  }
  assert.ok(s.lateralVelocity > 4.7 && s.heading > .09);
  assert.ok(s.forwardVelocity < 51.8, 'turning rotates momentum instead of adding sideways velocity for free');
  assert.ok(Math.hypot(s.forwardVelocity, s.lateralVelocity) <= 52);
  assert.ok(maximumSlip > .0001 && maximumSlip < .02);
});

test('body position outside the old road clamp and collision spin are never reset by the path controller', () => {
  const s = { x: 2.7, speed: 35, lateralVelocity: 4, yawRate: .4, heading: .12 };
  updatePlayerPath(s, 1, 1 / 120);
  assert.ok(s.x > 2.7);
  assert.ok(s.heading > .12);
  const maximumYawChange = playerEffectiveGrip(s) / (2 * PLAYER_WHEELBASE * PLAYER_HANDLING.yawInertia * 120);
  assert.ok(s.yawRate >= .4 - maximumYawChange - 1e-9);
  assert.ok(s.lateralVelocity > 3.88);
  const beyondRail = { x: 3.2, speed: 20, lateralVelocity: 0, yawRate: 0, heading: 0 };
  updatePlayerPath(beyondRail, 0, 1 / 120);
  close(beyondRail.x, 3.2); // The actual oriented rail contact, not this controller, owns correction.
});

test('hover and barrel-roll steering use bounded air authority without changing flight state', () => {
  const ground = { x: 1, speed: 35, lateralVelocity: 6, yawRate: .3, heading: 0 };
  const air = { ...ground, altitude: 3.3, rolling: true, rollAngle: Math.PI, verticalSpeed: 1.2 };
  updatePlayerPath(ground, -1, 1 / 120); updatePlayerPath(air, -1, 1 / 120);
  assert.ok(Math.abs(air.lateralAcceleration) <= playerEffectiveGrip(air) * .65);
  assert.ok(Math.abs(air.lateralVelocity - 6) < Math.abs(ground.lateralVelocity - 6));
  close(air.altitude, 3.3); close(air.rollAngle, Math.PI); close(air.verticalSpeed, 1.2);
  assert.equal(air.rolling, true);
});

test('momentum response agrees across whole, remainder and high-refresh frame partitions', () => {
  const outcomes = [30, 60, 90, 120, 144, 240].map(hz => {
    const s = { x: 1, speed: 52, lateralVelocity: 0, yawRate: 0, heading: 0 };
    let distance = 0;
    for (const [seconds, input] of [[.4, 1], [.3, -1], [.7, 0]]) distance += run(s, seconds, input, hz);
    return { ...s, distance };
  });
  const reference = outcomes[3];
  for (const actual of outcomes) {
    for (const key of ['x', 'heading', 'yawRate', 'lateralVelocity', 'speed', 'distance', 'rearDistance']) close(actual[key], reference[key], .003);
  }
});
