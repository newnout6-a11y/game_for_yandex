import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAFFIC_KINDS, chooseTrafficKind, trafficDefinition } from '../src/traffic-catalog.js';
import { occupiedTrafficLanes } from '../src/traffic-behavior.js';
import { chooseDiverseTrafficKind, assessTrafficSpawn, assessTrafficWaveCorridor } from '../src/traffic-demand.js';

const car = (lane = 0, z = 200, speed = 20, kind = 'sedan', extra = {}) => ({ lane, z, speed, kind, ...extra });
const state = extra => ({ traffic: [], obstacles: [], speed: 20, x: 1, lane: 1, ...extra });
const samples = Array.from({ length: 1000 }, (_, index) => (index + .5) / 1000);
const kindsFor = context => new Set(samples.map(sample => chooseDiverseTrafficKind(sample, context)));
const freeze = object => {
  if (object && typeof object === 'object') { Object.values(object).forEach(freeze); Object.freeze(object); }
  return object;
};

test('empty demand preserves catalogue weights, all kinds and deterministic input clamping', () => {
  for (const sample of [...samples, -.5, 0, 1, 20, NaN, Infinity, -Infinity, '0.5']) {
    assert.equal(chooseDiverseTrafficKind(sample), chooseTrafficKind(sample));
  }
  assert.deepEqual([...kindsFor({})].sort(), [...TRAFFIC_KINDS].sort());
});

test('nearby identical kinds are excluded across lanes, including both 55 m boundaries', () => {
  for (const kind of TRAFFIC_KINDS) for (const offset of [-55, 0, 55]) {
    const context = { traffic: [car(2, 200 + offset, 20, kind)], lane: 0, z: 200 };
    assert.ok(!kindsFor(context).has(kind), `${kind} at ${offset}`);
  }
  assert.ok(kindsFor({ traffic: [car(0, 256)], lane: 0, z: 200 }).has('sedan'));
});

test('recent history prevents repeat runs even with constant extreme random samples', () => {
  for (const sample of [0, .999999]) {
    const recentKinds = [];
    for (let i = 0; i < 80; i++) {
      const kind = chooseDiverseTrafficKind(sample, { recentKinds });
      assert.notEqual(kind, recentKinds.at(-1));
      recentKinds.push(kind);
    }
  }
});

test('adjacent same-wave heavy vehicles are limited without banning trucks from separated lanes', () => {
  const adjacent = kindsFor({ lane: 0, z: 200, traffic: [car(1, 225, 18, 'boxtruck')] });
  assert.ok([...adjacent].every(kind => !['freight', 'special'].includes(trafficDefinition(kind).category)));
  const opposite = kindsFor({ lane: 0, z: 200, traffic: [car(2, 200, 18, 'boxtruck')] });
  assert.ok(opposite.has('semi'));
  assert.ok(opposite.has('van'), 'commercial plus freight is permitted, not a forced passenger wave');
});

test('nearby freight and special limits survive a saturated mixed-kind neighbourhood', () => {
  const traffic = [car(0, 240, 18, 'boxtruck'), car(1, 245, 18, 'semi'), car(2, 250, 18, 'towtruck')];
  const allowed = kindsFor({ lane: 1, z: 200, traffic });
  assert.ok([...allowed].every(kind => ['passenger', 'commercial'].includes(trafficDefinition(kind).category)));
  const crowded = TRAFFIC_KINDS.map((kind, index) => car(index % 3, 236 + index, 20, kind));
  assert.ok([...kindsFor({ lane: 0, z: 200, traffic: crowded })].every(kind => ['passenger', 'commercial'].includes(trafficDefinition(kind).category)));
});

test('fallback further suppresses adjacent identical clumps and remains bounded under extreme crowds', () => {
  const traffic = TRAFFIC_KINDS.map(kind => car(2, 240, 20, kind));
  const distant = samples.filter(sample => chooseDiverseTrafficKind(sample, { lane: 0, z: 200, traffic }) === 'sedan').length;
  const close = traffic.map(vehicle => vehicle.kind === 'sedan' ? { ...vehicle, lane: 1, z: 200 } : vehicle);
  const adjacent = samples.filter(sample => chooseDiverseTrafficKind(sample, { lane: 0, z: 200, traffic: close }) === 'sedan').length;
  assert.ok(adjacent < distant / 3);
  const extreme = Array.from({ length: 4000 }, (_, i) => car(i % 3, 200, 20, TRAFFIC_KINDS[i % TRAFFIC_KINDS.length]));
  assert.ok(TRAFFIC_KINDS.includes(chooseDiverseTrafficKind(.99, { lane: 1, z: 200, traffic: extreme })));
});

test('demand is independent of traffic ordering and does not mutate frozen inputs or draw randomness', () => {
  const traffic = freeze([car(0, 205), car(1, 220, 20, 'van'), car(2, 250, 18, 'semi')]);
  const context = freeze({ lane: 1, z: 205, traffic, recentKinds: ['hatch', 'van'] });
  const oldRandom = Math.random;
  try {
    Math.random = () => { throw new Error('Demand must use only the supplied sample'); };
    for (const sample of samples) assert.equal(chooseDiverseTrafficKind(sample, context), chooseDiverseTrafficKind(sample, { ...context, traffic: [...traffic].reverse() }));
  } finally { Math.random = oldRandom; }
});

test('spawn validation rejects invalid candidates and tolerates missing optional arrays', () => {
  assert.deepEqual(assessTrafficSpawn({ x: 1 }, car()), { allowed: true, reason: 'clear' });
  for (const override of [{ lane: -1 }, { lane: .5 }, { lane: 3 }, { z: NaN }, { speed: Infinity }, { speed: -1 }, { kind: 'unknown' }]) {
    assert.equal(assessTrafficSpawn(state(), car(0, 200, 20, 'sedan', override)).reason, 'invalid-candidate');
  }
});

test('full truck and trailer lengths consume a gap that accommodates passenger bodies', () => {
  assert.equal(assessTrafficSpawn(state({ traffic: [car(0, 229, 0)] }), car(0, 200, 0)).allowed, true);
  assert.equal(assessTrafficSpawn(state({ traffic: [car(0, 229, 0, 'semi')] }), car(0, 200, 0, 'semi')).reason, 'traffic-ahead');
});

test('both signalling lane reservations and a lingering articulated tail prevent insertions', () => {
  const signalling = car(0, 210, 20, 'sedan', { laneChange: { from: 0, to: 1, phase: 'signal' } });
  for (const lane of [0, 1]) assert.equal(assessTrafficSpawn(state({ traffic: [signalling] }), car(lane)).allowed, false);
  const tail = car(1, 210, 20, 'semi', { x: 1, trailerAngle: .3 });
  assert.ok(occupiedTrafficLanes(tail).includes(2));
  assert.equal(assessTrafficSpawn(state({ traffic: [tail] }), car(2)).reason, 'traffic-ahead');
});

test('closing traffic in front and behind needs reaction plus braking distance, not a static minimum', () => {
  assert.equal(assessTrafficSpawn(state({ traffic: [car(0, 260, 20)] }), car(0, 200, 20)).allowed, true);
  assert.equal(assessTrafficSpawn(state({ traffic: [car(0, 260, 10)] }), car(0, 200, 30)).reason, 'traffic-ahead');
  assert.equal(assessTrafficSpawn(state({ traffic: [car(0, 140, 30)] }), car(0, 200, 10)).reason, 'traffic-behind');
  assert.equal(assessTrafficSpawn(state({ traffic: [car(2, 200, 0)] }), car()).allowed, true);
});

test('player envelope rejects nearby materialization and unsafe closing or rear-approach spawns', () => {
  assert.equal(assessTrafficSpawn(state(), car(0, 15)).reason, 'player-near');
  assert.equal(assessTrafficSpawn(state({ speed: 52 }), car(1, 80, 18)).reason, 'player-stopping-gap');
  assert.equal(assessTrafficSpawn(state({ speed: 52 }), car(1, 220, 18)).allowed, true);
  assert.equal(assessTrafficSpawn(state({ speed: 0 }), car(1, -45, 30)).reason, 'player-stopping-gap');
  assert.equal(assessTrafficSpawn(state({ speed: 0 }), car(0, -45, 30)).allowed, true);
  assert.equal(assessTrafficSpawn(state({ x: .45, speed: 52 }), car(0, 80, 18)).reason, 'player-stopping-gap');
});

test('local safe corridor protects only its complete finite interval, never a permanently empty lane', () => {
  const s = state({ safeLane: 0, safeCorridor: { lane: 0, z: 200, halfLength: 16 } });
  assert.equal(assessTrafficSpawn(s, car()).reason, 'safe-corridor');
  assert.equal(assessTrafficSpawn(s, car(0, 220, 20, 'semi')).reason, 'safe-corridor');
  assert.equal(assessTrafficSpawn(s, car(0, 280)).allowed, true);
  assert.equal(assessTrafficSpawn(state({ safeLane: 0 }), car()).allowed, true);
});

test('roadworks checks closure and stopping approach, but not a clear section beyond the closure', () => {
  assert.equal(assessTrafficSpawn(state({ roadEvent: { type: 'roadworks', lane: 0 } }), car()).reason, 'roadworks');
  const s = state({ distance: 100, roadEvent: { type: 'roadworks', lane: 0, remaining: 150, end: 315 } });
  assert.equal(assessTrafficSpawn(s, car(0, 100)).reason, 'roadworks');
  assert.equal(assessTrafficSpawn(s, car(0, 180)).reason, 'roadworks');
  assert.equal(assessTrafficSpawn(s, car(0, 300)).allowed, true);
  assert.equal(assessTrafficSpawn(s, car(0, 60)).allowed, true);
});

test('static obstacles need stopping distance, ignore hit objects and use actual lateral widths', () => {
  const barrier = { kind: 'barrier', x: 0, z: 250 };
  assert.equal(assessTrafficSpawn(state({ obstacles: [barrier] }), car()).reason, 'obstacle');
  assert.equal(assessTrafficSpawn(state({ obstacles: [{ ...barrier, hit: true }] }), car()).allowed, true);
  assert.equal(assessTrafficSpawn(state({ obstacles: [{ ...barrier, x: 1 }] }), car()).allowed, true);
  const cone = { kind: 'cone', x: .49, z: 220 };
  assert.equal(assessTrafficSpawn(state({ obstacles: [cone] }), car()).allowed, true);
  assert.equal(assessTrafficSpawn(state({ obstacles: [cone] }), car(0, 200, 20, 'semi')).reason, 'obstacle');
});

test('wave corridor includes full bodies, signalling reservations and trailing articulation', () => {
  for (const vehicle of [
    car(0, 220, 20, 'semi'),
    car(1, 205, 20, 'sedan', { laneChange: { from: 1, to: 0, phase: 'signal' } }),
    car(1, 205, 20, 'semi', { x: 1, trailerAngle: -.3 }),
  ]) assert.equal(assessTrafficWaveCorridor(state({ traffic: [vehicle] }), { lane: 0, z: 200 }).reason, 'occupied-corridor');
  assert.equal(assessTrafficWaveCorridor(state({ traffic: [car(0, 400)] }), { lane: 0, z: 200 }).allowed, true);
});

test('wave transition must be adjacent and physically reachable at the current speed', () => {
  const s = state({ speed: 10, safeCorridor: { lane: 0, z: 80, halfLength: 16 } });
  assert.equal(assessTrafficWaveCorridor(s, { lane: 2, z: 200 }).reason, 'nonadjacent-corridor');
  assert.equal(assessTrafficWaveCorridor(s, { lane: 1, z: 160 }).allowed, true);
  assert.equal(assessTrafficWaveCorridor({ ...s, speed: 40 }, { lane: 1, z: 160 }).reason, 'unreachable-corridor');
  assert.equal(assessTrafficWaveCorridor({ ...s, speed: 40 }, { lane: 1, z: 240 }).allowed, true);
  assert.equal(assessTrafficWaveCorridor(s, { lane: 0, z: 160 }).allowed, true);
});

test('whole connecting path rejects a hidden blocker between two otherwise clear waves', () => {
  const base = state({ speed: 10, safeCorridor: { lane: 0, z: 80, halfLength: 16 } });
  assert.equal(assessTrafficWaveCorridor({ ...base, traffic: [car(0, 120)] }, { lane: 1, z: 160 }).reason, 'blocked-transition');
  assert.equal(assessTrafficWaveCorridor({ ...base, traffic: [car(0, 120)] }, { lane: 0, z: 160 }).reason, 'blocked-transition');
  assert.equal(assessTrafficWaveCorridor({ ...base, obstacles: [{ kind: 'barrier', x: .5, z: 120 }] }, { lane: 1, z: 160 }).reason, 'obstacle-transition');
  assert.equal(assessTrafficWaveCorridor({ ...base, distance: 0, roadEvent: { type: 'roadworks', lane: 0, remaining: 110, end: 125 } }, { lane: 1, z: 160 }).reason, 'roadworks-transition');
});

test('passed corridors expire and obsolete safeLane does not constrain a new wave', () => {
  const s = state({ x: 1, safeLane: 0, safeCorridor: { lane: 0, z: -50, halfLength: 16 } });
  assert.equal(assessTrafficWaveCorridor(s, { lane: 2, z: 200 }).allowed, true);
  assert.equal(assessTrafficWaveCorridor(s, { lane: 5, z: 200 }).reason, 'invalid-corridor');
});

test('all assessment paths are read-only on frozen state and candidate objects', () => {
  const s = freeze(state({ traffic: [car(2, 300)], safeCorridor: { lane: 1, z: 90, halfLength: 16 } }));
  const candidate = freeze(car(0, 205));
  assert.equal(assessTrafficSpawn(s, candidate).allowed, true);
  assert.equal(assessTrafficWaveCorridor(s, freeze({ lane: 0, z: 205 })).allowed, true);
});

test('moving wave timing uses relative closure rather than absolute player travel', () => {
  const s = state({ speed: 40, playerAccelerationBound: 0, safeCorridor: { lane: 0, z: 80, halfLength: 16 } });
  const proposal = { lane: 1, z: 160, halfLength: 16 };
  const staticGap = assessTrafficWaveCorridor(s, proposal);
  const movingGap = assessTrafficWaveCorridor({ ...s, safeCorridor: { ...s.safeCorridor, speed: 19 } }, { ...proposal, speed: 19 });
  assert.equal(staticGap.reason, 'unreachable-corridor');
  assert.equal(movingGap.allowed, true);
  assert.equal(movingGap.availableDistance, staticGap.availableDistance);
  assert.ok(Math.abs(staticGap.requiredDistance - movingGap.requiredDistance - 19 * movingGap.transitionTime) < 1e-10);
  assert.ok(movingGap.requiredDistance >= 8);
});

test('both previous and proposed moving-wave speeds bound timing; missing speeds are static', () => {
  const s = state({ speed: 40, playerAccelerationBound: 0, safeCorridor: { lane: 0, z: 80, halfLength: 16, speed: 19 } });
  const proposal = { lane: 1, z: 160, speed: 19 };
  assert.equal(assessTrafficWaveCorridor(s, proposal).allowed, true);
  assert.equal(assessTrafficWaveCorridor({ ...s, safeCorridor: { ...s.safeCorridor, speed: 0 } }, proposal).reason, 'unreachable-corridor');
  assert.equal(assessTrafficWaveCorridor(s, { ...proposal, speed: 0 }).reason, 'unreachable-corridor');
  assert.equal(assessTrafficWaveCorridor(s, { lane: 1, z: 160 }).reason, 'unreachable-corridor');
  assert.equal(assessTrafficWaveCorridor({ ...s, safeCorridor: { lane: 0, z: 80, halfLength: 16 } }, proposal).reason, 'unreachable-corridor');
  for (const speed of [-1, NaN, Infinity]) assert.equal(assessTrafficWaveCorridor(s, { ...proposal, speed }).reason, 'invalid-corridor');
});

test('moving-wave credit does not hide bounded player acceleration, including the configured speed cap', () => {
  const s = state({ speed: 40, playerAccelerationBound: 15, safeCorridor: { lane: 0, z: 80, halfLength: 16, speed: 19 } });
  const proposal = { lane: 1, z: 160, speed: 19 };
  const accelerating = assessTrafficWaveCorridor(s, proposal);
  assert.equal(accelerating.reason, 'unreachable-corridor');
  const capped = assessTrafficWaveCorridor({ ...s, playerSpeedBound: 42 }, proposal);
  assert.equal(capped.allowed, true);
  const capTime = 2 / 15;
  const expectedTravel = 40 * capTime + .5 * 15 * capTime ** 2 + 42 * (capped.transitionTime - capTime);
  assert.ok(Math.abs(capped.requiredDistance - (expectedTravel - 19 * capped.transitionTime)) < 1e-10);
  const belowCurrent = assessTrafficWaveCorridor({ ...s, playerSpeedBound: 30 }, proposal);
  assert.ok(Math.abs(belowCurrent.requiredDistance - 21 * belowCurrent.transitionTime) < 1e-10, 'a stale low cap cannot instantly decelerate the player');
  assert.equal(assessTrafficWaveCorridor({ ...s, playerAccelerationBound: 0, acceleration: 15 }, proposal).reason, 'unreachable-corridor');
});

test('known slower wave members constrain nominal speeds without weakening geometric blockers', () => {
  const s = state({ speed: 40, playerAccelerationBound: 0, safeCorridor: { lane: 0, z: 80, halfLength: 16, speed: 19 } });
  const proposal = { lane: 1, z: 160, speed: 19 };
  for (const z of [80, 160]) {
    assert.equal(assessTrafficWaveCorridor({ ...s, traffic: [car(2, z, 5)] }, proposal).reason, 'unreachable-corridor');
  }
  assert.equal(assessTrafficWaveCorridor({ ...s, traffic: [car(0, 120, 19)] }, proposal).reason, 'blocked-transition');
  assert.equal(assessTrafficWaveCorridor({ ...s, traffic: [car(1, 160, 19)] }, proposal).reason, 'occupied-corridor');
  assert.equal(assessTrafficWaveCorridor({ ...s, obstacles: [{ kind: 'barrier', x: .5, z: 120 }] }, proposal).reason, 'obstacle-transition');
});


test('impossible declared wave speeds cannot manufacture transition clearance', () => {
  const s = state({ speed: 52, playerAccelerationBound: 15, safeCorridor: { lane: 0, z: 80, halfLength: 16, speed: 1e6 } });
  assert.equal(assessTrafficWaveCorridor(s, { lane: 1, z: 160, speed: 1e6 }).reason, 'unreachable-corridor');
});
