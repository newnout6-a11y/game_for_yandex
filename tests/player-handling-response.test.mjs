import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePlayerPath, playerTargetHeading, playerEffectiveGrip, PLAYER_HANDLING, PLAYER_WHEELBASE } from '../src/player-motion.js';
import { playerConfiguration } from '../src/player-configuration.js';
import { measurePlayerHandling, measureBraking } from '../scripts/measure-player-handling.mjs';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function configured(id, speed) {
  const config = playerConfiguration(id);
  return { x: 1, speed, heading: 0, steerAngle: 0, playerWheelbase: config.wheelbase, playerRearOffset: config.rearOffset,
    maxLateralAcceleration: config.maxLateralAcceleration, steeringSlewMultiplier: config.steeringSlewMultiplier };
}
function centredStep(state, input, dt) {
  const distance = updatePlayerPath(state, input, dt), lateral = (state.x - 1) * 3.5;
  state.x = 1; return { distance, lateral };
}

test('highway lateral intent is speed-independent and continuously proportional, not a lane selector', () => {
  for (const speed of [18, 28, 40, 52, 65]) for (const input of [-1, -.5, -.15, 0, .15, .5, 1]) {
    const state = { x: 1, speed };
    const target = playerTargetHeading(state, input);
    close(speed * Math.tan(target), input * PLAYER_HANDLING.lateralSpeed);
    for (let frame = 0; frame < 480; frame++) centredStep(state, input, 1 / 120);
    const sample = centredStep(state, input, 1 / 120);
    close(sample.lateral * 120, input * PLAYER_HANDLING.lateralSpeed, .000001);
    assert.ok(Math.abs(state.heading) <= PLAYER_HANDLING.maxHeading + 1e-10);
  }
});

test('held steering is prompt at highway speed and release/countersteer retain finite inertia', () => {
  for (const speed of [28, 40, 52, 65]) {
    const current = measurePlayerHandling(updatePlayerPath, speed);
    assert.ok(current.laneSeconds >= .85 && current.laneSeconds <= .97, `${speed}: 3.5 m traversal stays responsive`);
    assert.ok(current.initialMovementSeconds <= (speed >= 52 ? .14 : .15), `${speed}: first 10 cm of real motion`);
    assert.ok(current.releaseDriftMetres > .3 && current.releaseDriftMetres < .82, `${speed}: finite, controllable release tail`);
    assert.ok(current.settledAfterSeconds < .43, `${speed}: road-heading recovery`);
    assert.ok(current.reverseAfterSeconds > .25 && current.reverseAfterSeconds <= .35, `${speed}: no instant velocity reversal`);
    assert.ok(current.releaseHeadingRadians > .05, 'release starts from a real turning pose');
    assert.ok(current.maximumLateralAcceleration <= playerEffectiveGrip() + 1e-9);
    close(current.steadyLateralMps, PLAYER_HANDLING.lateralSpeed, 1e-6);
  }
});

test('slow road manoeuvring remains continuous and steering cannot propel a stationary car', () => {
  const current = measurePlayerHandling(updatePlayerPath, 8);
  assert.ok(current.laneSeconds < 1.4);
  assert.ok(current.initialMovementSeconds < .2);
  assert.ok(current.reverseAfterSeconds < .5);
  const state = { x: 1, speed: 0 };
  for (let frame = 0; frame < 120; frame++) close(updatePlayerPath(state, -1, 1 / 120), 0);
  close(state.x, 1); close(state.heading, 0); close(state.steerAngle, -.3);
  close(state.lateralVelocity, 0); close(state.forwardVelocity, 0);
});

test('actual direct-controller trajectory agrees at 30, 60 and 120 Hz through reversal and release', () => {
  for (const speed of [4, 18, 28, 52, 65]) {
    const runs = [30, 60, 120].map(hz => {
      const state = { x: 1, speed }; let forward = 0;
      for (const [seconds, input] of [[.3, .45], [.2, -.8], [.5, 0], [.4, -.35], [.6, 0]]) {
        for (let frame = 0; frame < Math.round(seconds * hz); frame++) forward += updatePlayerPath(state, input, 1 / hz);
      }
      return { ...state, forward };
    });
    for (const run of runs.slice(0, 2)) for (const key of ['x', 'heading', 'steerAngle', 'curvature', 'rearDistance', 'forward']) {
      close(run[key], runs[2][key], 1e-9);
    }
  }
});

test('trajectory integrates persistent velocity and yaw while visible rack follows axle geometry', () => {
  for (const speed of [4, 18, 52]) {
    const state = { x: 1, speed, heading: 0, yawRate: 0, lateralVelocity: 0 };
    let observedSlip = false;
    for (let frame = 0; frame < 240; frame++) {
      const before = { ...state }, dt = 1 / 120;
      const forward = updatePlayerPath(state, frame < 48 ? .6 : frame < 96 ? -.6 : 0, dt);
      close(state.heading - before.heading, (before.yawRate + state.yawRate) * .5 * dt);
      close((state.x - before.x) * 3.5, (before.lateralVelocity + state.lateralVelocity) * .5 * dt);
      close(forward, (before.speed + state.forwardVelocity) * .5 * dt);
      close(state.curvature, Math.tan(state.steerAngle) / PLAYER_WHEELBASE);
      close(state.speed, state.forwardVelocity);
      assert.ok(Math.abs(state.slipAngle) < .17, 'bounded tire slip, not arbitrary diagonal sliding');
      if (Math.abs(state.slipAngle) > 1e-5) observedSlip = true;
    }
    assert.ok(observedSlip, 'finite tire response is not an imposed no-slip trajectory');
  }
});

test('neutral steering has no centre-lane magnet or discrete lane snap', () => {
  for (const x of [.17, .49, .72, 1.16, 1.73]) {
    const state = { x, speed: 40, heading: 0, steerAngle: 0 };
    for (let frame = 0; frame < 360; frame++) updatePlayerPath(state, 0, 1 / 120);
    close(state.x, x); close(state.heading, 0);
  }
});

test('shoulder assist aligns the car continuously without a hidden lane-edge wall', () => {
  for (const id of ['rocket', 'hatch', 'sedan', 'suv', 'van']) for (const speed of [8, 18, 28, 52, 65]) for (const sign of [-1, 1]) {
    const state = configured(id, speed);
    for (let frame = 0; frame < 720; frame++) {
      const heading = state.heading, yaw = state.yawRate || 0;
      updatePlayerPath(state, sign, 1 / 120);
      assert.ok(state.x > PLAYER_HANDLING.minX && state.x < PLAYER_HANDLING.maxX, `${id}/${speed}: no hard clipping`);
      close(state.heading - heading, (yaw + state.yawRate) / 240);
      assert.ok(Math.abs(state.heading) <= PLAYER_HANDLING.maxHeading + .01);
      assert.ok(Math.abs(state.lateralAcceleration) <= playerEffectiveGrip(state) + 1e-9);
    }
    assert.ok(Math.abs(state.heading) < .002);
    assert.ok((state.x - 1) * sign > 1.6, 'the physical shoulder beyond the old x±1.24 limit is drivable');
    const edgeX = state.x;
    for (let frame = 0; frame < 36; frame++) updatePlayerPath(state, -sign, 1 / 120);
    assert.ok((state.x - edgeX) * sign < -.02, 'inward input is not held by the shoulder aid');
  }
});

test('quick steering release and reversal never produce yaw ringing across speed and car envelopes', () => {
  for (const id of ['rocket', 'suv', 'van']) for (const speed of [2, 4, 8, 12, 18, 28, 40, 52, 65]) {
    const state = configured(id, speed);
    for (let frame = 0; frame < 48; frame++) centredStep(state, 1, 1 / 120);
    for (let frame = 0; frame < 360; frame++) {
      centredStep(state, 0, 1 / 120);
      assert.ok(state.heading > -.008, `${id}/${speed}: no material opposite yaw`);
      assert.ok(Math.abs(state.lateralAcceleration) <= playerEffectiveGrip(state) + 1e-9);
    }
    assert.ok(Math.abs(state.heading) < .0001);
  }
});

test('invalid elapsed time cannot mutate the path and malformed optional geometry stays finite', () => {
  for (const dt of [0, -1, NaN, Infinity]) {
    const state = { x: 1, speed: 28 }, before = { ...state };
    assert.equal(updatePlayerPath(state, 1, dt), 0); assert.deepEqual(state, before);
  }
  const state = { x: NaN, speed: Infinity, heading: NaN, steerAngle: Infinity, playerWheelbase: -2,
    playerRearOffset: NaN, maxLateralAcceleration: Infinity, steeringSlewMultiplier: NaN };
  assert.ok(Number.isFinite(updatePlayerPath(state, Infinity, 1 / 30)));
  for (const key of ['x', 'heading', 'steerAngle', 'curvature', 'yawRate', 'rearDistance']) assert.ok(Number.isFinite(state[key]), key);
});

test('unchanged braking stops predictably and agrees across 30, 60 and 120 Hz', () => {
  for (const speed of [18, 28, 52]) {
    const runs = [30, 60, 120].map(hz => measureBraking(speed, hz));
    for (const run of runs) {
      assert.ok(run.finalSpeedMps < .011);
      assert.ok(run.seconds < speed / 19 + 1 / 30);
      assert.ok(run.distanceMetres < speed * speed / 38);
      close(run.distanceMetres, runs[2].distanceMetres, .001);
      assert.ok(Math.abs(run.seconds - runs[2].seconds) <= 1 / 30 + 1e-9);
    }
  }
});
