import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TRAFFIC_CATALOG, TRAFFIC_CATEGORIES, TRAFFIC_KINDS, chooseTrafficKind, trafficDefinition, trafficCenterGap } from '../src/traffic-catalog.js';
import { trafficHitsPlayer, playerBottom, playerTrafficDepth, trafficCollisionParts, trailerYaw } from '../src/traffic-physics.js';

/**
 * Start an isolated fleet-physics game and remove every initial hazard.
 * Disables automatic waves/events so each test owns all collision participants.
 * @returns {Game} Started, mutable fixture with the normal game physics.
 */
const make = () => { const g = new Game(); g.start(); Object.assign(g.state, { traffic: [], pickups: [], obstacles: [], nextEvent: Infinity, nextSpawn: Infinity }); return g; };
/**
 * Advance a fixture with neutral controls in fixed 1/120-second steps.
 * Mutates game state; fractional step counts round up through the loop bound.
 * @param {Game} g - Fixture to advance.
 * @param {number} seconds - Requested simulated duration, not wall-clock time.
 */
const advance = (g, seconds) => { for (let i = 0; i < seconds * 120; i++) g.update(1 / 120); };

test('pure fleet catalog separates eight immutable vehicle identities and four activity-neutral categories', () => {
  assert.equal(TRAFFIC_KINDS.length, 8); assert.equal(Object.keys(TRAFFIC_CATEGORIES).length, 4);
  for (const [id, spec] of Object.entries(TRAFFIC_CATALOG)) {
    assert.equal(spec.id, id); assert.ok(Object.hasOwn(TRAFFIC_CATEGORIES, spec.category));
    assert.ok(Object.isFrozen(spec)); assert.ok(Object.isFrozen(spec.tags));
    assert.ok(spec.length > 4 && spec.length < 17); assert.ok(spec.width <= 2.5 && spec.height < 4.1);
    assert.ok(spec.axles >= 2 && spec.axles <= 5); assert.ok(spec.cruise[0] < spec.cruise[1]);
  }
  assert.equal(trafficDefinition('unknown'), TRAFFIC_CATALOG.sedan);
  const seen = new Set(Array.from({ length: 1000 }, (_, i) => chooseTrafficKind(i / 1000)));
  assert.equal(seen.size, 8);
});

test('maximum hover clears low passenger vehicles but not tall freight and fire apparatus', () => {
  const state = { x: 1, heading: 0, altitude: 3.3, rollAngle: 0, distance: 0 };
  for (const kind of TRAFFIC_KINDS) {
    const collision = trafficHitsPlayer({ lane: 1, z: 0, kind }, state);
    assert.equal(collision, trafficDefinition(kind).height + .08 > 3.3, kind);
  }
  assert.ok(playerBottom(3.3, Math.PI / 4) < 2.75, 'rolled width lowers the swept underbody');
  assert.equal(trafficHitsPlayer({ lane: 1, z: 0, kind: 'towtruck' }, { ...state, rollAngle: Math.PI / 4 }), true);
});

test('physical width, length, heading and articulated trailer determine collision instead of lane constants', () => {
  const state = { x: 1.66, heading: 0, altitude: 0, rollAngle: 0, distance: 0 };
  assert.equal(trafficHitsPlayer({ lane: 1, z: 0, kind: 'hatch' }, state), false);
  assert.equal(trafficHitsPlayer({ lane: 1, z: 0, kind: 'semi' }, state), true, 'wide trailer flank');
  assert.equal(trafficHitsPlayer({ lane: 1, z: 8, kind: 'semi' }, { ...state, x: 1 }), true, 'long trailer rear still overlaps');
  assert.equal(trafficHitsPlayer({ lane: 1, z: 8, kind: 'sedan' }, { ...state, x: 1 }), false);
  for (const distance of [0, 2000, 100000]) {
    const parts = trafficCollisionParts({ kind: 'semi', lane: 2, z: 180 }, distance);
    assert.equal(parts.length, 2); assert.ok(parts.every(p => Number.isFinite(p.x + p.z + p.halfLength)));
    assert.ok(Math.abs(trailerYaw({ kind: 'semi', z: 180 }, distance)) <= .12);
  }
});

test('long following vehicles keep bumper-to-bumper space and stop behind the player', () => {
  const g = make(); g.state.traffic = [
    { id: 1, kind: 'boxtruck', lane: 0, z: 85, speed: 6, cruiseSpeed: 6 },
    { id: 2, kind: 'semi', lane: 0, z: 65, speed: 22, cruiseSpeed: 22 },
    { id: 3, kind: 'firetruck', lane: 1, z: -16, speed: 18, cruiseSpeed: 18 },
  ];
  advance(g, 4); assert.equal(g.state.phase, 'playing');
  const [lead, following, behind] = g.state.traffic;
  assert.ok(lead.z - following.z >= trafficCenterGap(lead, following, 1.39));
  assert.ok(behind.z <= -playerTrafficDepth(behind) - 1.9);
});

test('repeated mixed fleet spawning never inserts overlapping long envelopes and leaves the selected lane clear', () => {
  const g = make();
  for (let i = 0; i < 100; i++) {
    const oldCount=g.state.traffic.length;
    g.spawnWave(180 + i % 8 * 22, true);
    for(const added of g.state.traffic.slice(oldCount))assert.ok(!g.state.traffic.some(car=>car.lane===g.state.safeLane&&Math.abs(car.z-added.z)<trafficDefinition(car.kind).length/2+16),'reserved corridor remains clear');
    for (const a of g.state.traffic) for (const b of g.state.traffic) if (a !== b && a.lane === b.lane)
      assert.ok(Math.abs(a.z - b.z) >= trafficCenterGap(a, b, 11.99), `${a.kind}/${b.kind}`);
    assert.ok(g.state.traffic.every(car => car.category === trafficDefinition(car.kind).category));
  }
});

test('overtake is credited only after the whole long vehicle has passed', () => {
  const g = make(); g.state.speed = 30;
  g.state.traffic = [{ id: 1, lane: 0, kind: 'semi', z: -5, speed: 10, cruiseSpeed: 10, passed: false }];
  g.update(.1, { throttle: 1 }); assert.equal(g.state.overtakes, 0);
  for (let i = 0; i < 60; i++) g.update(1 / 120, { throttle: 1 });
  assert.equal(g.state.overtakes, 1);
});
