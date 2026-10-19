import { TRAFFIC_CATALOG, TRAFFIC_KINDS, trafficDefinition } from './traffic-catalog.js';
import { occupiedTrafficLanes } from './traffic-behavior.js';
import { TRAFFIC_DRIVER_LIMITS } from './traffic-policy.js';
import { playerBoundsFor } from './player-spec.js';

// Demand only proposes/validates entities. The caller owns RNG, history, IDs and
// insertion, so rejected proposals never teleport traffic or mutate its motion.
const LANE_WIDTH = 3.5;
const MAX_WAVE_SPEED = Math.max(...TRAFFIC_KINDS.map(kind => TRAFFIC_CATALOG[kind].cruise[1]));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const validLane = lane => Number.isInteger(lane) && lane >= 0 && lane < 3;
const speedOf = car => Math.max(0, finite(car.speed));
const isHeavy = category => category === 'freight' || category === 'special';
const intersects = (a, b, c, d) => a <= d && b >= c;
const result = reason => ({ allowed: reason === 'clear', reason });

/** Full yaw-independent body bound, including the articulated hitch allowance. */
function halfLength(car) {
  const spec = trafficDefinition(car.kind);
  return Math.hypot(spec.length, spec.width) / 2 + (spec.articulated ? .8 : 0);
}

/**
 * Use catalogue weights without independent random draws. The ordinary empty
 * context is exactly the catalogue distribution. Locally seen kinds and the
 * most recent kind are excluded while alternatives exist; an overloaded scene
 * falls back to strongly suppressed repeats, never to an unbounded retry loop.
 * At most two freight vehicles and one special vehicle are favoured per 110 m
 * neighbourhood, with no adjacent heavy/special pair in the same 50 m wave.
 * Passenger cars are not mandatory: commercial + freight remains possible.
 * @param {number} sample - Caller-owned sample, clamped to [0, 1).
 * @param {object} context - Read-only traffic, candidate lane/z and kind history.
 * @returns {string} Canonical catalogue kind.
 */
export function chooseDiverseTrafficKind(sample, { traffic = [], lane, z, recentKinds = [] } = {}) {
  const nearby = Object.fromEntries(TRAFFIC_KINDS.map(kind => [kind, 0]));
  const adjacent = { ...nearby };
  let freight = 0, special = 0, adjacentHeavy = 0;
  for (const car of traffic) {
    if (!car || !Number.isFinite(car.z) || !Number.isFinite(z) || Math.abs(car.z - z) > 55) continue;
    const spec = trafficDefinition(car.kind);
    nearby[spec.id]++;
    if (spec.category === 'freight') freight++;
    if (spec.category === 'special') special++;
    const sameWave = Math.abs(car.z - z) <= 25 && validLane(lane)
      && occupiedTrafficLanes(car).some(otherLane => Math.abs(otherLane - lane) <= 1);
    if (sameWave) {
      adjacent[spec.id]++;
      if (isHeavy(spec.category)) adjacentHeavy++;
    }
  }
  const recent = Array.isArray(recentKinds) ? recentKinds.slice(-8) : [];
  const last = recent.at(-1);
  const choices = TRAFFIC_KINDS.map(kind => {
    const spec = TRAFFIC_CATALOG[kind];
    const categoryAllowed = !isHeavy(spec.category) || (adjacentHeavy === 0 && freight + special < 3
      && (spec.category === 'freight' ? freight < 2 : special < 1));
    const repeats = recent.filter(previous => previous === kind).length;
    const weight = spec.weight / (1 + repeats * .9)
      * .08 ** nearby[kind] * .1 ** adjacent[kind] * (last === kind ? .04 : 1);
    return { kind, weight, categoryAllowed, fresh: nearby[kind] === 0 && last !== kind };
  });
  // There are always non-heavy catalogue choices; category limits are retained
  // even if all kinds already occur nearby. Relax uniqueness only in that case.
  let pool = choices.filter(choice => choice.categoryAllowed && choice.fresh);
  if (!pool.length) pool = choices.filter(choice => choice.categoryAllowed);
  const total = pool.reduce((sum, choice) => sum + choice.weight, 0);
  // Extreme caller-created crowds can underflow suppression. A fixed, least-
  // repeated fallback remains deterministic and preserves the category limit.
  if (!(total > 0)) return pool.reduce((best, choice) => nearby[choice.kind] < nearby[best.kind] ? choice : best).kind;
  let target = Math.max(0, Math.min(1 - Number.EPSILON, Number(sample) || 0)) * total;
  for (const choice of pool) { target -= choice.weight; if (target < 0) return choice.kind; }
  return pool.at(-1).kind;
}

/** Reaction, relative closure and difference in full stopping distances. */
function followingGap(followerSpeed, leaderSpeed, followerBraking, leaderBraking, reaction = .75) {
  const closing = Math.max(0, followerSpeed - leaderSpeed);
  const stopping = Math.max(0, followerSpeed * followerSpeed / (2 * followerBraking)
    - leaderSpeed * leaderSpeed / (2 * leaderBraking));
  return 12 + reaction * followerSpeed + .35 * closing + stopping;
}

/** Active roadworks are local if their world/relative interval is available. */
function roadworksBounds(state) {
  const event = state.roadEvent;
  if (event?.type !== 'roadworks' || !validLane(event.lane)) return null;
  const start = Number.isFinite(event.remaining) ? event.remaining
    : Number.isFinite(event.at) && Number.isFinite(state.distance) ? event.at - state.distance : null;
  if (start === null) return { lane: event.lane, start: -Infinity, end: Infinity };
  const end = Number.isFinite(event.end) && Number.isFinite(state.distance)
    ? event.end - state.distance : start + 65;
  return { lane: event.lane, start: Math.min(start, end), end: Math.max(start, end) };
}

/** Obstacles use authored width, not a whole-lane ban for a small boundary cone. */
function obstacleTouches(obstacle, lane, width) {
  const x = finite(obstacle.x, obstacle.lane);
  if (!Number.isFinite(x)) return false;
  const obstacleWidth = Math.max(.1, finite(obstacle.width, obstacle.kind === 'barrier' ? 2.7 : .6));
  return Math.abs(x - lane) * LANE_WIDTH <= (width + obstacleWidth) / 2 + .3;
}

/**
 * Check an individual proposed insertion against both lane reservations, full
 * truck/trailer lengths, front/rear stopping headway, the player and hazards.
 * safeCorridor is a finite local reservation, never the old permanent safeLane.
 * Missing traffic/obstacle arrays are empty; invalid candidate scalars fail closed.
 * @param {object} state - Read-only simulation state in metres and m/s.
 * @param {object} candidate - Proposed lane, z, kind and nonnegative speed.
 * @returns {{allowed:boolean,reason:string}} Stable explanatory decision.
 */
export function assessTrafficSpawn(state, candidate) {
  if (!state || !candidate || !validLane(candidate.lane) || !Number.isFinite(candidate.z)
    || !Number.isFinite(candidate.speed) || candidate.speed < 0 || !Object.hasOwn(TRAFFIC_CATALOG, candidate.kind)) return result('invalid-candidate');
  const { lane, z, kind } = candidate;
  const spec = trafficDefinition(kind), extent = halfLength(candidate), velocity = speedOf(candidate);
  const braking = TRAFFIC_DRIVER_LIMITS[spec.category].braking;
  const corridor = state.safeCorridor;
  if (validLane(corridor?.lane) && Number.isFinite(corridor.z) && Number.isFinite(corridor.halfLength)
    && corridor.halfLength >= 0 && lane === corridor.lane
    && Math.abs(z - corridor.z) <= extent + corridor.halfLength) return result('safe-corridor');
  const roadworks = roadworksBounds(state);
  if (roadworks?.lane === lane) {
    const stopping = followingGap(velocity, 0, braking, braking);
    if (intersects(z - extent, z + extent + stopping, roadworks.start, roadworks.end)) return result('roadworks');
  }
  for (const car of state.traffic || []) {
    if (!car || !Number.isFinite(car.z) || !occupiedTrafficLanes(car).includes(lane)) continue;
    const ahead = car.z >= z, otherSpeed = speedOf(car);
    const clearance = ahead
      ? followingGap(velocity, otherSpeed, braking, TRAFFIC_DRIVER_LIMITS[trafficDefinition(car.kind).category].braking)
      : followingGap(otherSpeed, velocity, TRAFFIC_DRIVER_LIMITS[trafficDefinition(car.kind).category].braking, braking);
    if (Math.abs(car.z - z) <= extent + halfLength(car) + clearance) return result(ahead ? 'traffic-ahead' : 'traffic-behind');
  }
  const bounds = playerBoundsFor(state);
  // Do not materialize a new body beside the player even in an unrelated lane.
  if (Math.abs(z) <= extent + bounds.length / 2 + 14) return result('player-near');
  const playerX = finite(state.x, finite(state.lane, 1));
  const playerWidth = bounds.width * Math.abs(Math.cos(finite(state.heading)))
    + bounds.length * Math.abs(Math.sin(finite(state.heading)));
  if (Math.abs(lane - playerX) * LANE_WIDTH <= (spec.width + playerWidth) / 2 + .35) {
    const playerSpeed = Math.max(0, finite(state.speed) * Math.cos(finite(state.heading)));
    const playerBraking = Math.max(.5, finite(state.playerBrakingBound, 19));
    const clearance = z >= 0
      ? followingGap(playerSpeed, velocity, playerBraking, braking, .9)
      : followingGap(velocity, playerSpeed, braking, playerBraking);
    if (Math.abs(z) <= extent + bounds.length / 2 + clearance) return result('player-stopping-gap');
  }
  for (const obstacle of state.obstacles || []) {
    if (!obstacle || obstacle.hit || !Number.isFinite(obstacle.z) || !obstacleTouches(obstacle, lane, spec.width)) continue;
    const obstacleExtent = Math.max(.3, finite(obstacle.length, obstacle.kind === 'barrier' ? 1 : .6) / 2);
    const separation = obstacle.z - z;
    if (separation >= 0 ? separation <= extent + obstacleExtent + followingGap(velocity, 0, braking, braking)
      : -separation <= extent + obstacleExtent + 2) return result('obstacle');
  }
  return result('clear');
}

/** Maximum player travel under bounded acceleration, integrating a speed cap exactly. */
function maximumPlayerTravel(state, horizon) {
  const current = speedOf(state);
  const acceleration = Math.max(0, finite(state.playerAccelerationBound, 8), finite(state.acceleration));
  // A cap below the current speed cannot retroactively slow the player down.
  const limit = Math.max(current, finite(state.playerSpeedBound, Infinity));
  const acceleratingFor = acceleration > 0 ? Math.min(horizon, (limit - current) / acceleration) : 0;
  return current * horizon + acceleration * acceleratingFor * (horizon - acceleratingFor / 2);
}

/** Constant lower wave-speed bound, never faster than a known member of that wave. */
function boundedWaveSpeed(state, corridor, declaredSpeed) {
  let velocity = Math.min(MAX_WAVE_SPEED, Math.max(0, finite(declaredSpeed)));
  for (const car of state.traffic || []) {
    if (!car || !Number.isFinite(car.z)) continue;
    if (Math.abs(car.z - corridor.z) <= corridor.halfLength + halfLength(car)) velocity = Math.min(velocity, speedOf(car));
  }
  return velocity;
}

/**
 * Validate the open lane through a whole proposed wave before any insertions.
 * The finite corridor includes full bodies, both reservations and lagging tails.
 * Consecutive corridors must have at most one lane of lateral displacement and
 * enough free longitudinal distance for reaction plus a bounded-acceleration
 * lane change. Timing uses relative closure against BOTH wave-speed bounds,
 * with capped player acceleration but no speculative wave acceleration. Speeds
 * default to zero (static); supply a lower bound, not a fleet average. Known
 * nearby wave members further limit that bound. The straight connecting corridor is checked analytically against
 * every occupied lane/hazard, rather than sampling only the two wave centres.
 * This is a conservative generation invariant, not a promise about future user
 * steering. Recheck while building the wave; do not commit a failed proposal.
 * @param {object} state - Read-only traffic, player and road-event state.
 * @param {object} proposal - lane/z, optional speed (m/s, default 0), halfLength and previousCorridor.
 * @returns {{allowed:boolean,reason:string,availableDistance?:number,requiredDistance?:number,transitionTime?:number}} Decision with timing diagnostics once evaluated.
 */
export function assessTrafficWaveCorridor(state, { lane, z, speed: corridorSpeed = 0, halfLength: corridorHalf = 16, previousCorridor = state?.safeCorridor } = {}) {
  if (!state || !validLane(lane) || !Number.isFinite(z) || !Number.isFinite(corridorSpeed) || corridorSpeed < 0
    || !Number.isFinite(corridorHalf) || corridorHalf < 0) return result('invalid-corridor');
  const bounds = playerBoundsFor(state), playerHalf = bounds.length / 2;
  const roadworks = roadworksBounds(state);
  // Match event installation's full forward sweep: a moving reservation before
  // static works eventually reaches them even when the player stays stopped.
  if (roadworks?.lane === lane && z - corridorHalf - playerHalf <= roadworks.end
    && (corridorSpeed > 0 || z + corridorHalf + playerHalf >= roadworks.start)) return result('roadworks');
  for (const car of state.traffic || []) {
    if (car && Number.isFinite(car.z) && occupiedTrafficLanes(car).includes(lane)
      && Math.abs(car.z - z) <= corridorHalf + playerHalf + halfLength(car)) return result('occupied-corridor');
  }
  for (const obstacle of state.obstacles || []) {
    if (obstacle && !obstacle.hit && Number.isFinite(obstacle.z) && obstacleTouches(obstacle, lane, bounds.width)
      && Math.abs(obstacle.z - z) <= corridorHalf + playerHalf + 1) return result('obstacle');
  }
  const previous = validLane(previousCorridor?.lane) && Number.isFinite(previousCorridor.z)
    && Number.isFinite(previousCorridor.halfLength) && previousCorridor.halfLength >= 0
    && previousCorridor.z + previousCorridor.halfLength > 0 ? previousCorridor : null;
  const fromLane = previous ? previous.lane : Math.max(0, Math.min(2, Math.round(finite(state.x, finite(state.lane, 1)))));
  const laneDelta = Math.abs(lane - fromLane);
  if (laneDelta > 1) return result('nonadjacent-corridor');
  const start = previous ? previous.z + previous.halfLength + playerHalf : playerHalf;
  const end = z - corridorHalf - playerHalf;
  const distance = end - start;
  const lateralAcceleration = Math.max(1, finite(state.maxLateralAcceleration, 10));
  const transitionTime = .45 + 2 * Math.sqrt(LANE_WIDTH / lateralAcceleration);
  const proposedSpeed = boundedWaveSpeed(state, { z, halfLength: corridorHalf }, corridorSpeed);
  const previousSpeed = previous ? boundedWaveSpeed(state, previous, previous.speed) : proposedSpeed;
  // Both ends must remain reachable. Credit only the slower lower-bound speed,
  // so a fast new wave cannot hide a slow previous wave (or vice versa). This
  // never credits speculative traffic acceleration. Parent supplies/rechecks
  // the proposed lower bound once actual spawned vehicle speeds are known.
  const required = Math.max(8, maximumPlayerTravel(state, transitionTime)
    - Math.min(previousSpeed, proposedSpeed) * transitionTime);
  const timingResult = reason => ({ ...result(reason), availableDistance: distance, requiredDistance: required, transitionTime });
  if (laneDelta && distance < required) return timingResult('unreachable-corridor');
  if (distance <= 0) return timingResult('clear');
  const pathX = value => fromLane + (lane - fromLane) * Math.max(0, Math.min(1, (value - start) / distance));
  // Expanded lane rectangles deliberately retain the entire reserved lane of a
  // signalling/moving vehicle. This protects a tail without inferring its pose.
  const pathTouches = (low, high, left, right) => {
    if (!intersects(start, end, low, high)) return false;
    const a = pathX(Math.max(start, low)), b = pathX(Math.min(end, high));
    const halfWidth = bounds.width / (2 * LANE_WIDTH) + .06;
    return intersects(Math.min(a, b) - halfWidth, Math.max(a, b) + halfWidth, left, right);
  };
  for (const car of state.traffic || []) {
    if (!car || !Number.isFinite(car.z)) continue;
    const extent = halfLength(car) + playerHalf + 2;
    if (occupiedTrafficLanes(car).some(occupied => pathTouches(car.z - extent, car.z + extent, occupied - .5, occupied + .5))) return result('blocked-transition');
  }
  if (roadworks && pathTouches(roadworks.start - playerHalf, roadworks.end + playerHalf, roadworks.lane - .5, roadworks.lane + .5)) return result('roadworks-transition');
  for (const obstacle of state.obstacles || []) {
    if (!obstacle || obstacle.hit || !Number.isFinite(obstacle.z)) continue;
    const x = finite(obstacle.x, obstacle.lane);
    const width = Math.max(.1, finite(obstacle.width, obstacle.kind === 'barrier' ? 2.7 : .6)) / (2 * LANE_WIDTH);
    if (Number.isFinite(x) && pathTouches(obstacle.z - playerHalf - 1, obstacle.z + playerHalf + 1, x - width, x + width)) return result('obstacle-transition');
  }
  return timingResult('clear');
}
