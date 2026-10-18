import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAFFIC_KINDS, trafficDefinition } from '../src/traffic-catalog.js';
import { trafficDriverProfile, trafficSafeSpeed, planTrafficLongitudinal, TRAFFIC_DRIVER_LIMITS } from '../src/traffic-policy.js';
import { occupiedTrafficLanes, updateTrafficManoeuvres, trafficHornRange } from '../src/traffic-behavior.js';
import { trafficHitsPlayer } from '../src/traffic-physics.js';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/config.js';
import { seededRandom } from '../src/util.js';

/** Fresh deterministic traffic descriptor with SI motion. */
const vehicle = (id, lane, z, speed = 20, kind = 'sedan', extra = {}) => ({ id, lane, z, speed, cruiseSpeed: speed, kind, laneDecisionIn: 0, laneChangeCooldown: 0, ...extra });
/** A clear fixture does not globally reserve safeLane. */
const stateFor = traffic => ({ traffic, x: 2, lane: 2, speed: 0, safeLane: 2, safeCorridor: null, obstacles: [], playerAccelerationBound: 8, playerSpeedBound: 65 });
/** Advance lane decisions without integrating z, isolating deterministic planning. */
function think(state, seconds, dt = 1 / 120) { for (let i = 0; i < Math.round(seconds / dt); i++) updateTrafficManoeuvres(state, dt); }

test('driver profiles are stable, varied, immutable and independent of traffic iteration', () => {
  const samples = Array.from({ length: 80 }, (_, i) => vehicle(i, i % 3, i * 20));
  const before = structuredClone(samples);
  const profiles = samples.map(trafficDriverProfile);
  assert.deepEqual(samples, before);
  assert.deepEqual(profiles, samples.toReversed().map(trafficDriverProfile).reverse());
  for (const key of ['headway', 'reaction', 'politeness', 'patience']) assert.equal(new Set(profiles.map(p => p[key])).size, 80, key);
  for (const p of profiles) {
    assert.ok(Object.isFrozen(p)); assert.ok(p.headway >= .95 && p.headway <= 1.45);
    assert.ok(p.reaction >= .32 && p.reaction <= .68); assert.ok(p.politeness >= .35 && p.politeness <= .95);
  }
  assert.ok(trafficDriverProfile(vehicle(1, 0, 0, 20, 'semi')).headway > trafficDriverProfile(vehicle(1, 0, 0)).headway);
});

test('safe speed includes reaction, braking capability and leader stopping distance', () => {
  const baseline = trafficSafeSpeed(30, 12, 6.5, 6.5, .4);
  assert.ok(baseline > 12 && baseline < 24);
  assert.ok(trafficSafeSpeed(30, 12, 6.5, 6.5, .8) < baseline);
  assert.ok(trafficSafeSpeed(30, 12, 4.8, 6.5, .4) < baseline);
  assert.ok(trafficSafeSpeed(30, 12, 6.5, 19, .4) < baseline);
  assert.equal(trafficSafeSpeed(-100, 0, 6.5, 6.5, .4), 0);
  assert.ok(Number.isFinite(trafficSafeSpeed(NaN, Infinity, NaN, NaN, NaN)));
});

test('policy is pure, rejects invalid dt, honors category limits and changed cruise requests', () => {
  for (const kind of TRAFFIC_KINDS) {
    const car = vehicle(1, 1, 100, 0, kind, { cruiseSpeed: 100 }), state = stateFor([car]);
    const before = structuredClone({ car, state }), spec = trafficDefinition(kind), limits = TRAFFIC_DRIVER_LIMITS[spec.category];
    for (const dt of [0, -1, NaN, Infinity]) assert.equal(planTrafficLongitudinal(state, car, {}, dt).speed, 0);
    const plan = planTrafficLongitudinal(state, car, {}, 1 / 30);
    assert.equal(plan.targetSpeed, spec.cruise[1]);
    assert.ok(plan.acceleration <= limits.acceleration + 1e-10);
    assert.deepEqual({ car, state }, before);
    car.speed = 25; car.driver = trafficDriverProfile(car); car.cruiseSpeed = 0;
    const stop = planTrafficLongitudinal(state, car, {}, 1 / 30);
    assert.equal(stop.targetSpeed, 0); assert.ok(stop.speed < 25);
    assert.ok(stop.acceleration >= -limits.braking - 1e-10);
  }
});

/** Integrate two drivers without any teleport/nonpenetration correction. */
function followAt(dt, stopLeader = false, kind = 'sedan') {
  const lead = vehicle(11, 0, 70, stopLeader ? 0 : 10), car = vehicle(12, 0, 0, 22, kind, { cruiseSpeed: 23 });
  const state = stateFor([car, lead]);
  let minimum = Infinity, mostBraking = 0;
  for (let i = 0; i < Math.round(18 / dt); i++) {
    const plan = planTrafficLongitudinal(state, car, { leader: lead, occupiedLanes: [0] }, dt);
    car.speed = plan.speed; car.z += car.speed * dt; lead.z += lead.speed * dt;
    minimum = Math.min(minimum, lead.z - car.z - (trafficDefinition(kind).length + trafficDefinition(lead.kind).length) / 2);
    mostBraking = Math.min(mostBraking, plan.acceleration);
  }
  return { car, minimum, mostBraking };
}

test('longitudinal planning preserves real braking gaps without position corrections at 30/60/120 Hz', () => {
  for (const kind of ['sedan', 'van', 'semi']) for (const stopped of [false, true]) {
    const runs = [30, 60, 120].map(hz => followAt(1 / hz, stopped, kind));
    for (const run of runs) {
      assert.ok(run.minimum > 2.3, `${kind} stopped=${stopped}: ${run.minimum}`);
      assert.ok(run.mostBraking >= -TRAFFIC_DRIVER_LIMITS[trafficDefinition(kind).category].braking - 1e-9);
      assert.ok(stopped ? run.car.speed < .08 : Math.abs(run.car.speed - 10) < .2);
    }
    assert.ok(Math.abs(runs[0].car.z - runs[2].car.z) < .22, kind);
  }
});

test('barriers, cones and source-lane reservations are seen before contact and passed hazards are ignored', () => {
  const car = vehicle(1, 1, 0, 20), state = stateFor([car]);
  state.obstacles = [{ id: 9, kind: 'barrier', x: 0, z: 65 }];
  assert.equal(planTrafficLongitudinal(state, car, { occupiedLanes: [1] }, .01).intent, 'cruise');
  assert.equal(planTrafficLongitudinal(state, car, { occupiedLanes: [0, 1] }, .01).intent, 'hazard');
  state.obstacles[0].x = 1;
  let minimum = Infinity;
  for (let i = 0; i < 2400; i++) {
    const plan = planTrafficLongitudinal(state, car, { occupiedLanes: [1] }, 1 / 120);
    car.speed = plan.speed; car.z += car.speed / 120;
    minimum = Math.min(minimum, 65 - car.z - trafficDefinition(car.kind).length / 2 - 2);
  }
  assert.ok(minimum > 2.3); assert.ok(car.speed < .01);
  car.z = 80; car.speed = 10;
  assert.equal(planTrafficLongitudinal(state, car, { occupiedLanes: [1] }, .01).intent, 'cruise');
});

test('rear traffic treats a grounded player as a braking-capable leader, not a magic wall', () => {
  const car = vehicle(2, 1, -70, 22), state = { ...stateFor([car]), x: 1, speed: 0 };
  for (let i = 0; i < 2400; i++) {
    const plan = planTrafficLongitudinal(state, car, { followingPlayer: true, playerDepth: 4.7, occupiedLanes: [1] }, 1 / 120);
    assert.equal(plan.intent, 'following-player');
    car.speed = plan.speed; car.z += car.speed / 120;
    assert.ok(car.z < -7);
  }
  assert.ok(car.speed < .01);
});

test('drivers observe front and rear neighbours, and pass only into a genuinely better lane', () => {
  const car = vehicle(1, 1, 180, 22, 'sedan', { cruiseSpeed: 23 });
  const state = stateFor([car, vehicle(2, 1, 210, 14), vehicle(3, 1, 130, 22), vehicle(4, 0, 225, 15)]);
  think(state, 1 / 120);
  assert.equal(car.awareness.leaderId, 2); assert.equal(car.awareness.followerId, 3);
  assert.equal(car.awareness.closingSpeed, 8);
  assert.equal(car.laneChange?.to, 2);
  assert.equal(car.laneChange.reason, 'overtake');
});

test('a local reserved wave expires spatially without permanently banning a whole lane', () => {
  for (const [z, allowed] of [[210, false], [350, true]]) {
    const car = vehicle(1, 1, 210, 22, 'sedan', { cruiseSpeed: 23 });
    const state = { ...stateFor([car, vehicle(2, 1, 240, 14)]), safeLane: 0, safeCorridor: { lane: 0, z, speed: 22, halfLength: 25 }, roadEvent: { type: 'roadworks', lane: 2 } };
    think(state, 1 / 120); assert.equal(Boolean(car.laneChange), allowed);
  }
});

test('a driver anticipates road obstacles and signals a safe escape before stopping', () => {
  const car = vehicle(1, 1, 170, 20), state = stateFor([car]);
  state.obstacles = [{ kind: 'barrier', x: 1, z: 245 }];
  think(state, 1 / 120);
  assert.equal(car.laneChange?.reason, 'avoid-hazard'); assert.equal(car.signal, -1);
  assert.deepEqual(occupiedTrafficLanes(car), [0, 1]);
  const stopped = vehicle(2, 1, 170, 20), closed = stateFor([stopped, vehicle(3, 0, 170), vehicle(4, 2, 170)]);
  closed.obstacles = state.obstacles; think(closed, 1 / 120);
  assert.equal(stopped.laneChange, undefined);
  closed.obstacles = [{ kind: 'barrier', x: 1, z: 215 }];
  assert.equal(planTrafficLongitudinal(closed, stopped, { occupiedLanes: [1] }, 1 / 120).intent, 'hazard');
});

test('horn requests have individual delayed single responses and do not manipulate speed or position', () => {
  const car = vehicle(20, 1, 95, 20), state = { ...stateFor([car]), x: 1, lane: 1, speed: 23, hornTime: .5, hornSerial: 1 };
  think(state, .2); assert.equal(car.laneChange, undefined); assert.equal(car.heardHornSerial, 1);
  const delay = car.hornReactionIn;
  think(state, .2); assert.ok(car.hornReactionIn < delay, 'held pulse must not reset reaction delay');
  think(state, 1); assert.equal(car.laneChange?.reason, 'yield-horn');
  assert.equal(car.laneChange.phase, 'signal'); assert.equal(car.speed, 20); assert.equal(car.z, 95);
  assert.ok(car.signal !== 0); assert.equal(car.yieldRequestTime, 0);
  assert.deepEqual(occupiedTrafficLanes(car), [0, 1]);
});

test('horn never forces near-player cut-ins, blind-side moves, closed-lane entry or a brake tap', () => {
  for (const modify of [
    (s, c) => { c.z = 22; },
    (s, c) => { s.speed = 55; c.z = 90; },
    (s, c) => { s.traffic.push(vehicle(3, 0, c.z), vehicle(4, 2, c.z)); },
    (s, c) => { s.roadEvent = { type: 'roadworks', lane: 0 }; s.traffic.push(vehicle(4, 2, c.z)); },
    (s, c) => { c.z = -30; c.passed = true; },
  ]) {
    const car = vehicle(20, 1, 95, 20), state = { ...stateFor([car]), x: 1, speed: 23, hornTime: .5, hornSerial: 7 };
    modify(state, car); const before = { speed: car.speed, z: car.z };
    think(state, 2); assert.equal(car.laneChange, undefined);
    assert.deepEqual({ speed: car.speed, z: car.z }, before);
  }
});

test('new target occupancy cancels only the signal, never snaps a committed maneuver', () => {
  const car = vehicle(1, 1, 200, 22, 'sedan', { cruiseSpeed: 23 }), state = stateFor([car, vehicle(2, 1, 230, 14)]);
  think(state, .1); assert.equal(car.laneChange?.phase, 'signal');
  state.traffic.push(vehicle(3, 0, 201)); think(state, 1 / 120);
  assert.equal(car.laneChange, null); assert.equal(car.x, 1);
  state.traffic.pop(); car.laneChangeCooldown = 0; car.laneDecisionIn = 0;
  think(state, 1.2); assert.equal(car.laneChange?.phase, 'moving');
  const x = car.x; state.traffic.push(vehicle(3, 0, 201)); think(state, 1 / 120);
  assert.equal(car.laneChange.phase, 'moving'); assert.ok(car.x < x); assert.ok(Math.abs(car.x - x) < .01);
});

test('seeded planning is array-order deterministic and bounded for dense 60-car scenes', () => {
  const make = () => stateFor(Array.from({ length: 60 }, (_, i) => vehicle(i, i % 3, -50 + Math.floor(i / 3) * 24, 14 + (i * 7 % 10), TRAFFIC_KINDS[i % TRAFFIC_KINDS.length])));
  const a = make(), b = make(); b.traffic.reverse();
  const start = performance.now();
  think(a, 3); think(b, 3);
  assert.deepEqual(a.traffic.toSorted((x, y) => x.id - y.id), b.traffic.toSorted((x, y) => x.id - y.id));
  assert.ok(performance.now() - start < 5000, '720 dense decision frames fit a broad CI CPU budget');
});

test('source-lane braking is included before accepting a merge ahead of a faster follower', () => {
  const car = vehicle(1, 1, 220, 22, 'sedan', { cruiseSpeed: 24 });
  const state = { ...stateFor([car, vehicle(2, 1, 250, 16), vehicle(3, 0, 188, 22)]), roadEvent: { type: 'roadworks', lane: 2 } };
  think(state, 1 / 120);
  assert.equal(car.awareness.leaderSpeed, 16);
  assert.equal(car.laneChange, undefined, '32 m looks open only if source-lane slowing is ignored');
});

test('minimal imported traffic keeps its current cruise and brake lamps do not flicker during easing', () => {
  const car = { id: 8, lane: 0, z: 60, speed: 7 }, state = stateFor([car]);
  const hold = planTrafficLongitudinal(state, car, {}, .01);
  assert.equal(hold.speed, 7); assert.equal(hold.targetSpeed, 7);
  Object.assign(car, { cruiseSpeed: 6.99, braking: true });
  const easing = planTrafficLongitudinal(state, car, {}, 1 / 120);
  assert.ok(easing.acceleration < 0 && easing.acceleration > -.18);
  assert.equal(easing.braking, true);
  car.cruiseSpeed = 8;
  assert.equal(planTrafficLongitudinal(state, car, {}, 1 / 120).braking, false);
});


test('horn perception scales with reachable closure and full maneuver time but remains bounded', () => {
  const car = vehicle(20, 1, 180, 20), before = structuredClone(car);
  const slow = { ...stateFor([car]), speed: 23, playerSpeedBound: 23 };
  const highway = { ...slow, speed: 60, playerSpeedBound: 66, playerAccelerationBound: 15 };
  assert.ok(trafficHornRange(highway, car) > trafficHornRange(slow, car));
  assert.equal(trafficHornRange(highway, car), 230);
  for (const speed of [0, 10, 23, 40, 60, 100]) for (const kind of ['sedan', 'semi']) {
    const range = trafficHornRange({ ...highway, speed }, { ...car, kind });
    assert.ok(range >= 90 && range <= 230);
  }
  assert.deepEqual(car, before, 'perception query is pure');
  const far = vehicle(20, 1, 231, 20), state = { ...highway, traffic: [far], x: 1, hornTime: .5, hornSerial: 9 };
  think(state, 2); assert.equal(far.yieldRequestTime, 0); assert.equal(far.laneChange, undefined);
});

test('early highway horn requests complete real relative-motion yields without swept player contact', () => {
  for (const playerSpeed of [40, 50, 60]) for (const trafficSpeed of [16, 20, 23]) {
    const car = vehicle(20, 1, 225, trafficSpeed);
    const state = { ...stateFor([car]), speed: playerSpeed, x: 1, lane: 1, distance: 0,
      playerAccelerationBound: 15, playerSpeedBound: 66, hornTime: .5, hornSerial: 11 };
    let firstSignal = null, moving = false;
    for (let i = 0; i < 120 * 7; i++) {
      const previousZ = car.z; car.previousLateral = car.x ?? car.lane;
      updateTrafficManoeuvres(state, 1 / 120);
      if (car.laneChange?.phase === 'signal' && firstSignal === null) firstSignal = i / 120;
      if (car.laneChange?.phase === 'moving') moving = true;
      car.z += (car.speed - state.speed) / 120; state.distance += state.speed / 120;
      state.hornTime = Math.max(0, state.hornTime - 1 / 120);
      assert.equal(trafficHitsPlayer(car, state, 1, previousZ), false,
        `unsafe highway yield at player ${playerSpeed}, traffic ${trafficSpeed}`);
    }
    assert.ok(firstSignal >= car.driver.reaction, 'the earlier request does not skip individual reaction');
    assert.ok(moving); assert.equal(car.lane, 0); assert.equal(car.x, 0);
    assert.equal(car.speed, trafficSpeed, 'yielding never forces braking or a speed reset');
  }
});

test('earlier hearing does not turn late highway horns into forced priority', () => {
  for (const playerSpeed of [40, 50, 60]) for (const z of [40, 60, 80, 100, 119]) {
    const car = vehicle(20, 1, z, 20);
    const state = { ...stateFor([car]), speed: playerSpeed, x: 1, lane: 1,
      playerAccelerationBound: 15, playerSpeedBound: 66, hornTime: .5, hornSerial: 12 };
    let moved = false;
    for (let i = 0; i < 120 * 4; i++) {
      updateTrafficManoeuvres(state, 1 / 120);
      moved ||= car.laneChange?.phase === 'moving';
      car.z += (car.speed - state.speed) / 120;
      if (car.z < -4.7) car.passed = true; // Match production pass bookkeeping.
      state.hornTime = Math.max(0, state.hornTime - 1 / 120);
    }
    assert.equal(moved, false, `late ${z}m request at ${playerSpeed}m/s must not force a merge`);
    assert.equal(car.x, 1); assert.equal(car.speed, 20);
  }
});


test('production horn integration produces the same safe early highway yield at 30/60/120 Hz', () => {
  const results = [];
  for (const hz of [30, 60, 120]) {
    const game = new Game({ random: seededRandom(31) }); game.start();
    const car = vehicle(20, 1, 225, 20), speed = 45;
    Object.assign(game.state, { traffic: [car], obstacles: [], pickups: [], safeCorridor: null,
      x: 1, lane: 1, speed, nextSpawn: Infinity, nextEvent: Infinity });
    const throttle = (CONFIG.coastDeceleration + speed ** 2 * .0012) / game.playerConfig.acceleration;
    let signalled = false, moving = false;
    for (let i = 0; i < hz * 7; i++) {
      game.update(1 / hz, { horn: i === 0, throttle });
      signalled ||= car.laneChange?.phase === 'signal';
      moving ||= car.laneChange?.phase === 'moving';
      assert.equal(game.state.phase, 'playing', 'ordinary horn response must not require player invincibility');
    }
    assert.ok(signalled && moving); assert.equal(car.lane, 0); assert.equal(car.x, 0);
    assert.equal(game.state.hornSerial, 1); assert.equal(car.heardHornSerial, 1);
    assert.equal(game.state.trafficDiagnostics.interventions, 0);
    results.push({ speed: car.speed, z: car.z, x: car.x });
  }
  for (const result of results) {
    assert.equal(result.speed, 20); assert.equal(result.x, 0);
    assert.ok(Math.abs(result.z - results[0].z) < 1e-8);
  }
});
