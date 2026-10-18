import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePlayerPath, integratePlayerArc, playerTargetHeading, PLAYER_HANDLING, PLAYER_WHEELBASE } from '../src/player-motion.js';
import { playerConfiguration } from '../src/player-configuration.js';
import { acceptedPlayerPath, measurePlayerHandling, measureBraking } from '../scripts/measure-player-handling.mjs';

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
    close(speed * Math.sin(target), input * PLAYER_HANDLING.lateralSpeed);
    for (let frame = 0; frame < 480; frame++) centredStep(state, input, 1 / 120);
    const sample = centredStep(state, input, 1 / 120);
    close(sample.lateral * 120, input * PLAYER_HANDLING.lateralSpeed, .000001);
    assert.ok(Math.abs(state.heading) <= PLAYER_HANDLING.maxHeading + 1e-10);
  }
});

test('release removes substantially less unwanted travel than accepted controller without snapping yaw', () => {
  for (const speed of [28, 40, 52, 65]) {
    const old = measurePlayerHandling(acceptedPlayerPath, speed), current = measurePlayerHandling(updatePlayerPath, speed);
    assert.ok(current.releaseDriftMetres < old.releaseDriftMetres * .76, `${speed}: release improvement`);
    assert.ok(current.releaseDriftMetres < .76, `${speed}: bounded correction tail`);
    assert.ok(current.settledAfterSeconds < old.settledAfterSeconds * .7, `${speed}: settle improvement`);
    assert.ok(current.reverseAfterSeconds < old.reverseAfterSeconds, `${speed}: reverse response`);
    assert.ok(current.laneSeconds >= 1 && current.laneSeconds <= 1.1, `${speed}: consistent lane traversal`);
    assert.ok(current.initialMovementSeconds <= .15, `${speed}: movement latency`);
    assert.ok(current.releaseHeadingRadians > .05, 'release starts from a real turning pose');
    assert.ok(current.maximumLateralAcceleration <= 10 + 1e-9);
  }
});

test('slow road manoeuvring responds sooner without moving or yawing at standstill', () => {
  const old = measurePlayerHandling(acceptedPlayerPath, 8), current = measurePlayerHandling(updatePlayerPath, 8);
  assert.ok(current.laneSeconds < old.laneSeconds * .8);
  assert.ok(current.initialMovementSeconds < old.initialMovementSeconds * .8);
  assert.ok(current.reverseAfterSeconds < old.reverseAfterSeconds * .8);
  const state = { x: 1, speed: 0 };
  for (let frame = 0; frame < 120; frame++) close(updatePlayerPath(state, -1, 1 / 120), 0);
  close(state.x, 1); close(state.heading, 0); close(state.steerAngle, -.3);
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

test('every integrated controller step uses its steered rear-axle arc, including countersteer', () => {
  for (const speed of [4, 18, 52]) {
    const state = { x: 1, speed };
    for (let frame = 0; frame < 240; frame++) {
      const before = { x: state.x, heading: state.heading || 0 };
      const forward = updatePlayerPath(state, frame < 48 ? .6 : frame < 96 ? -.6 : 0, 1 / 120);
      const arc = integratePlayerArc(before.heading, speed, state.curvature, 1 / 120);
      close(state.heading, arc.heading);
      close((state.x - before.x) * 3.5, arc.x);
      close(forward, arc.forward);
      close(state.curvature, Math.tan(state.steerAngle) / PLAYER_WHEELBASE);
    }
  }
});

test('neutral steering has no centre-lane magnet or discrete lane snap', () => {
  for (const x of [.17, .49, .72, 1.16, 1.73]) {
    const state = { x, speed: 40, heading: 0, steerAngle: 0 };
    for (let frame = 0; frame < 360; frame++) updatePlayerPath(state, 0, 1 / 120);
    close(state.x, x); close(state.heading, 0);
  }
});

test('road edges align the car continuously before the hard clamp across all owned vehicles', () => {
  for (const id of ['rocket', 'hatch', 'sedan', 'suv', 'van']) for (const speed of [8, 18, 28, 52, 65]) for (const sign of [-1, 1]) {
    const state = configured(id, speed);
    for (let frame = 0; frame < 720; frame++) {
      const heading = state.heading;
      updatePlayerPath(state, sign, 1 / 120);
      assert.ok(state.x > PLAYER_HANDLING.minX && state.x < PLAYER_HANDLING.maxX, `${id}/${speed}: no hard clipping`);
      assert.ok(Math.abs(state.heading - heading) <= Math.min(speed * Math.tan(.3) / state.playerWheelbase, state.maxLateralAcceleration / speed) / 120 + 1e-8);
    }
    assert.ok(Math.abs(state.heading) < .002);
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
      assert.ok(Math.abs(state.lateralAcceleration) <= state.maxLateralAcceleration + 1e-9);
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
