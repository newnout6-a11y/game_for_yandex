import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TRAFFIC_CATALOG, TRAFFIC_CATEGORIES, TRAFFIC_KINDS, chooseTrafficKind, trafficDefinition, trafficCenterGap } from '../src/traffic-catalog.js';
import { playerBottom, playerTrafficDepth, trafficCollisionParts, trailerYaw } from '../src/traffic-physics.js';
import { captureContactFrame, resolveVehicleContacts } from '../src/vehicle-contacts.js';

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
/** Resolve a stationary contact proposal through the same compound solver as Game. */
function contact(car, player = {}) {
  const s = make().state;
  Object.assign(s, player, { traffic: [{ speed: 0, ...car }] });
  return resolveVehicleContacts(s, captureContactFrame(s), 1 / 120, 0);
}

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
    const result = contact({ lane: 1, z: 0, kind }, state);
    assert.equal(result.contacts.some(c => c.kind === 'traffic'), trafficDefinition(kind).height > 3.3, kind);
    assert.equal(result.fatal, false, 'parked overlap has no closing energy');
  }
  assert.ok(playerBottom(3.3, Math.PI / 4) < 2.75, 'rolled width lowers the swept underbody');
  assert.ok(contact({ lane: 1, z: 0, kind: 'towtruck' }, { ...state, rollAngle: Math.PI / 4 }).contacts.some(c => c.kind === 'traffic'));
});

test('physical width, length, heading and articulated trailer determine collision instead of lane constants', () => {
  const state = { x: 1.66, heading: 0, altitude: 0, rollAngle: 0, distance: 0 };
  assert.equal(contact({ lane: 1, z: 0, kind: 'hatch' }, state).contacts.length, 0);
  assert.ok(contact({ lane: 1, z: 0, kind: 'semi' }, state).contacts.some(c => c.kind === 'traffic'), 'wide trailer flank');
  assert.ok(contact({ lane: 1, z: 8, kind: 'semi' }, { ...state, x: 1 }).contacts.some(c => c.kind === 'traffic'), 'long trailer rear still overlaps');
  assert.equal(contact({ lane: 1, z: 8, kind: 'sedan' }, { ...state, x: 1 }).contacts.length, 0);
  assert.ok(contact({ lane: 1, z: 0, kind: 'hatch' }, { ...state, heading: Math.PI / 2 }).contacts.some(c => c.kind === 'traffic'), 'heading turns the long player body across the neighboring flank');
  for (const direction of [-1, 1]) {
    const car = { lane: 1 + direction, z: 0, kind: 'semi', trailerAngle: 0 };
    const player = { ...state, x: 1, distance: -385 };
    assert.equal(contact(car, player).contacts.length, 0, 'straight neighboring trailer clears');
    assert.ok(contact({ ...car, trailerAngle: -direction * .5 }, player).contacts.some(c => c.kind === 'traffic'), 'only the articulated trailer swings into the player');
  }
  for (const distance of [0, 2000, 100000]) {
    const parts = trafficCollisionParts({ kind: 'semi', lane: 2, z: 180 }, distance);
    assert.equal(parts.length, 2); assert.ok(parts.every(p => Number.isFinite(p.x + p.z + p.halfLength)));
    assert.ok(Math.abs(trailerYaw({ kind: 'semi', z: 180 }, distance)) <= .12);
    assert.ok(contact({ kind: 'semi', lane: 1, z: 8 }, { ...state, x: 1, distance }).contacts.some(c => c.kind === 'traffic'), 'curved-road trailer rear remains a live contact');
    assert.equal(contact({ kind: 'sedan', lane: 1, z: 8 }, { ...state, x: 1, distance }).contacts.length, 0, 'the same road frame must not create a short-body contact');
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
