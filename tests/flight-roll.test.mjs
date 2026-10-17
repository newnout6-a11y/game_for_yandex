import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { FLIGHT } from '../src/flight.js';
/**
 * Create a moving, fully charged game with no hazards or automatic spawns.
 * The 26 m/s initial speed and 100 energy isolate flight/roll transitions.
 * @returns {Game} Started game whose state the test may mutate.
 */
const make = () => {
  const g = new Game(); g.start();
  Object.assign(g.state, { traffic: [], pickups: [], obstacles: [], nextSpawn: Infinity, nextEvent: Infinity, speed: 26, nitro: 100 });
  return g;
};
/**
 * Mutate the fixture through at most 1/120-second simulation steps.
 * The final step is shortened to avoid exceeding the requested duration.
 * @param {Game} g - Started fixture.
 * @param {number} seconds - Simulated duration in seconds.
 * @param {object} [controls={}] - Held controls reused for every update.
 */
const advance = (g, seconds, controls = {}) => {
  for (let t = 0; t < seconds - 1e-8; t += 1 / 120) g.update(Math.min(1 / 120, seconds - t), controls);
};
/**
 * Hold throttle and flight for 1.6 simulated seconds to reach cruise altitude.
 * @param {Game} g - Fixture mutated through the real flight state machine.
 */
const takeoff = g => advance(g, 1.6, { flight: true, throttle: 1 });

test('flight preserves honest horizontal speed: held throttle accelerates, coasting slows', () => {
  const ground = make(), air = make();
  advance(ground, 2, { throttle: 1 }); advance(air, 2, { throttle: 1, flight: true });
  assert.ok(air.state.speed > 26); assert.equal(air.state.speed, ground.state.speed);
  const before = air.state.speed;
  air.state.traffic = [{ id: 2, lane: 0, z: 20, speed: 12, kind: 'sedan' }];
  advance(air, 1, { flight: true });
  assert.ok(air.state.speed < before); assert.ok(air.state.traffic[0].z < 20, 'still passes a slower car while coasting');
});

test('roll requires active high flight, enough energy and a fresh deliberate press', () => {
  const g = make(); advance(g, .2, { roll: 1 }); assert.equal(g.state.rolling, false);
  advance(g, .3, { flight: true, throttle: 1, roll: 1 }); assert.equal(g.state.rolling, false);
  advance(g, 1.4, { flight: true, throttle: 1, roll: 1 }); assert.equal(g.state.rolling, false, 'holding before readiness must not trigger');
  g.update(1 / 120, { flight: true, throttle: 1 });
  g.state.nitro = FLIGHT.rollCost - .01;
  g.update(1 / 120, { flight: true, throttle: 1, roll: -1 }); assert.equal(g.state.rolling, false);
});

test('both roll directions make one full smooth turn and recover upright with cooldown', () => {
  for (const direction of [-1, 1]) {
    const g = make(); takeoff(g);
    advance(g, FLIGHT.rollDuration / 2, { flight: true, throttle: 1, roll: direction });
    assert.equal(g.state.rolling, true); assert.ok(Math.abs(g.state.rollAngle - direction * Math.PI) < .08);
    assert.ok(Math.abs(g.state.rollAngularSpeed) > 5); assert.ok(g.state.altitude >= FLIGHT.rollMinAltitude);
    advance(g, FLIGHT.rollDuration / 2 + .02, { flight: true, throttle: 1, roll: direction });
    assert.equal(g.state.rolling, false); assert.equal(g.state.rollAngle, 0); assert.equal(g.state.rollAngularSpeed, 0);
    assert.ok(g.state.rollCooldown > 1.9);
    advance(g, 2.2, { flight: true, throttle: 1, roll: direction });
    assert.equal(g.state.rolling, false, 'holding does not repeat after cooldown');
  }
});

test('releasing flight during roll completes upright before a softly powered landing', () => {
  const g = make(); takeoff(g);
  advance(g, .3, { flight: true, throttle: 1, roll: 1 });
  advance(g, .3, { throttle: 1 });
  assert.equal(g.state.flying, false); assert.equal(g.state.rolling, true); assert.equal(g.state.landing, false);
  assert.ok(g.state.altitude >= 2.6);
  advance(g, .65, { throttle: 1 });
  assert.equal(g.state.rolling, false); assert.equal(g.state.rollAngle, 0); assert.equal(g.state.landing, true);
  assert.ok(g.state.thrusterPower > .3);
  advance(g, 2.6, { throttle: 1 }); assert.equal(g.state.altitude, 0); assert.equal(g.state.verticalSpeed, 0);
});

test('landing brakes near the ground, retains exhaust through contact and then fades', () => {
  const g = make(); takeoff(g);
  advance(g, .6, { throttle: 1 }); const upperSpeed = g.state.verticalSpeed;
  assert.ok(upperSpeed < -1.8); assert.ok(g.state.thrusterPower > .3);
  advance(g, 1.4, { throttle: 1 });
  assert.ok(g.state.altitude > 0 && g.state.altitude < .2);
  assert.ok(g.state.verticalSpeed > -1); assert.ok(g.state.thrusterPower > .65);
  advance(g, .5, { throttle: 1 });
  assert.equal(g.state.altitude, 0); assert.ok(g.state.thrusterPower > .2); assert.ok(g.state.flightCooldown > 1.8);
  advance(g, 1, { throttle: 1 }); assert.ok(g.state.thrusterPower < .01);
});

test('takeoff reserves finite landing assistance; empty fuel never becomes free hover', () => {
  const g = make(); takeoff(g);
  assert.equal(g.state.landingReserve, FLIGHT.landingReserveTime);
  g.state.nitro = 0; advance(g, .6, { flight: true, throttle: 1 });
  assert.equal(g.state.flying, false); assert.ok(g.state.altitude < 3.3); assert.ok(g.state.landingReserve < FLIGHT.landingReserveTime);
  advance(g, 4, { flight: true, throttle: 1, roll: 1 });
  assert.equal(g.state.altitude, 0); assert.equal(g.state.landingReserve, 0); assert.equal(g.state.rolling, false);
  assert.equal(g.state.nitro, 0); assert.ok(g.state.thrusterPower < .01);
});

test('fuel exhaustion during a paid roll recovers upright and lands without a second roll', () => {
  const g = make(); takeoff(g); advance(g, .2, { flight: true, throttle: 1, roll: -1 });
  g.state.nitro = 0; advance(g, 1, { flight: true, throttle: 1, roll: -1 });
  assert.equal(g.state.rolling, false); assert.equal(g.state.rollAngle, 0); assert.equal(g.state.flying, false);
  advance(g, 3, { flight: true, throttle: 1, roll: -1 }); assert.equal(g.state.altitude, 0);
});

test('revive resets roll, vertical velocity, landing reserve and nozzle output', () => {
  const g = make(); takeoff(g); advance(g, .2, { flight: true, roll: 1 });
  g.crash(); assert.equal(g.revive(), true);
  for (const key of ['altitude', 'verticalSpeed', 'rollAngle', 'rollProgress', 'rollCooldown', 'thrusterPower', 'landingReserve']) assert.equal(g.state[key], 0, key);
  assert.equal(g.state.rolling, false); assert.equal(g.state.landing, false);
});
