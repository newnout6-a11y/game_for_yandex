import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingInput } from '../src/input.js';
import { flightPresentation, rollPresentation } from '../src/ui.js';

test('F is a held flight control and release stops only that key', () => {
  const input = new DrivingInput();
  assert.equal(input.key('KeyF', true), true);
  input.key('KeyW', true);
  input.key('KeyD', true);
  assert.deepEqual(input.read(), { steer: 1, throttle: 1, brake: 0, boost: false, flight: true, roll: 0 });
  input.key('KeyF', false);
  assert.deepEqual(input.read(), { steer: 1, throttle: 1, brake: 0, boost: false, flight: false, roll: 0 });
});

test('independent touch flight sources survive one release and clear on pause', () => {
  const input = new DrivingInput();
  input.set('flight', 'pointer-1', true);
  input.set('gas', 'pointer-2', true);
  input.set('left', 'pointer-3', true);
  input.key('KeyF', true);
  input.release('pointer-1');
  assert.equal(input.read().flight, true);
  input.key('KeyF', false);
  assert.deepEqual(input.read(), { steer: -1, throttle: 1, brake: 0, boost: false, flight: false, roll: 0 });
  input.set('flight', 'pointer-4', true);
  input.clear();
  assert.deepEqual(input.read(), { steer: 0, throttle: 0, brake: 0, boost: false, flight: false, roll: 0 });
});

test('flight HUD explains readiness, energy, altitude, landing and cooldown', () => {
  const s = { flying: false, altitude: 0, flightReady: false, flightCooldown: 0, nitro: 60 };
  assert.equal(flightPresentation(s).mode, 'ground');
  assert.equal(flightPresentation({ ...s, flightReady: true }).mode, 'ready');
  assert.equal(flightPresentation({ ...s, nitro: 0 }).mode, 'empty');
  assert.equal(flightPresentation({ ...s, nitro: 2, speed: 30 }).value, 'МАЛО ЗАРЯДА');
  assert.equal(flightPresentation({ ...s, nitro: 2.5, flightReady: true }).mode, 'ready');
  const flying = flightPresentation({ ...s, flying: true, altitude: 3.25 });
  assert.equal(flying.mode, 'flying');
  assert.equal(flying.value, '3,3 М');
  assert.equal(flightPresentation({ ...s, altitude: 1.5 }).mode, 'landing');
  assert.equal(flightPresentation({ ...s, flightCooldown: 1.2 }).value, '2 С');
});


test('Q and E roll independently from steering, flight and other held keys', () => {
  const input = new DrivingInput();
  input.key('KeyF', true); input.key('KeyW', true); input.key('KeyA', true);
  assert.equal(input.key('KeyQ', true), true);
  assert.equal(input.read().roll, -1);
  assert.equal(input.read().steer, -1);
  input.key('KeyE', true);
  assert.equal(input.read().roll, 0);
  input.key('KeyQ', false);
  assert.equal(input.read().roll, 1);
  assert.equal(input.read().flight, true);
  assert.equal(input.read().throttle, 1);
  input.key('KeyE', false);
  assert.equal(input.read().roll, 0);
});

test('touch roll release and cancellation preserve other fingers and clear on pause', () => {
  const input = new DrivingInput();
  input.set('flight', 'pointer-1', true); input.set('gas', 'pointer-2', true);
  input.set('rollRight', 'pointer-3', true); input.key('KeyE', true);
  input.release('pointer-3');
  assert.equal(input.read().roll, 1);
  input.key('KeyE', false);
  assert.equal(input.read().roll, 0);
  assert.equal(input.read().flight, true);
  assert.equal(input.read().throttle, 1);
  input.set('rollLeft', 'pointer-4', true);
  input.clear();
  assert.deepEqual(input.read(), { steer: 0, throttle: 0, brake: 0, boost: false, flight: false, roll: 0 });
});

test('roll HUD separates airborne readiness, progress and cooldown', () => {
  const s = { flying: false, altitude: 0, rolling: false, rollProgress: 0, rollReady: false, rollCooldown: 0, nitro: 60 };
  assert.equal(rollPresentation(s).mode, 'ground');
  assert.equal(rollPresentation({ ...s, flying: true }).mode, 'unavailable');
  assert.equal(rollPresentation({ ...s, flying: true, nitro: 0 }).mode, 'energy');
  assert.equal(rollPresentation({ ...s, flying: true, rollReady: true }).mode, 'ready');
  assert.equal(rollPresentation({ ...s, rolling: true, rollProgress: .5 }).value, '180° / 360°');
  assert.equal(rollPresentation({ ...s, rolling: true, rollProgress: 2 }).value, '360° / 360°');
  assert.equal(rollPresentation({ ...s, rolling: true, rollProgress: .25, rollAngle: -Math.PI / 4 }).value, '45° / 360°');
  assert.equal(rollPresentation({ ...s, rolling: true, rollProgress: .5, rollAngle: NaN }).value, '180° / 360°');
  assert.equal(rollPresentation({ ...s, rollCooldown: 1.1 }).value, '2 С');
});

test('airborne HUD tells coasting driver to maintain gas and distinguishes powered landing', () => {
  assert.match(flightPresentation({ flying: true, throttle: 0, altitude: 3 }).hint, /ГАЗ/);
  assert.equal(flightPresentation({ flying: true, landing: true, altitude: 1 }).mode, 'landing');
  assert.equal(flightPresentation({ rolling: true, flying: false, altitude: 3 }).mode, 'rolling');
});
