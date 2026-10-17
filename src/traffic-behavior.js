import { trafficDefinition } from './traffic-catalog.js';

// Simulation-only lane planning. Coordinates are lane units (right is positive),
// z is metres ahead of the player, and all speeds/accelerations are SI units.
// Keep this module independent of rendering and traffic-physics to avoid cycles.
const LANE_WIDTH = 3.5, PLAYER_WIDTH = 2.256, PLAYER_LENGTH = 4.7;
/**
 * Clamps a scalar to inclusive bounds without changing simulation state.
 * @param {number} x - Value to constrain.
 * @param {number} a - Lower bound.
 * @param {number} b - Upper bound, at least a.
 * @returns {number} Bounded scalar in the same units as its inputs.
 */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/**
 * Replaces non-finite values with a fallback without coercing strings.
 * @param {*} x - Optional simulation scalar.
 * @param {number} [fallback=0] - Value used when x is not a finite number.
 * @returns {number} Finite x or the supplied fallback.
 */
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
/**
 * Checks whether a value names one of the three discrete road lanes.
 * @param {*} lane - Candidate lane index, increasing from left to right.
 * @returns {boolean} True only for integer indices 0, 1 or 2.
 */
const validLane = lane => Number.isInteger(lane) && lane >= 0 && lane <= 2;
/**
 * Reads a nonnegative traffic speed, treating absent/non-finite values as stopped.
 * @param {Object} car - Traffic entity with an optional speed in m/s.
 * @returns {number} Sanitized forward speed in m/s.
 */
const speed = car => Math.max(0, finite(car.speed));

/**
 * Reads the continuous rear-axle lane coordinate, falling back to the lane index.
 * @param {Object} car - Traffic entity with optional finite x and discrete lane.
 * @returns {number} Lateral lane units, positive right; the fallback is not coerced.
 */
export function trafficLateral(car) { return Number.isFinite(car.x) ? car.x : car.lane; }

/** Reserve BOTH lanes from the first signal until the manoeuvre is complete.
 * Longitudinal following, wave spawning and corridor selection must use this
 * function rather than car.lane. Render/collision geometry uses trafficLateral.
 * Includes conservative projected tractor/trailer widths so a lagging tail
 * remains reserved even after the nominal lane-change state has cleared.
 * @param {Object} car - Traffic entity with lane, pose and optional laneChange.
 * @returns {number[]} Sorted unique lane indices touched or reserved by the car.
 */
export function occupiedTrafficLanes(car) {
  const lanes = new Set();
  if (validLane(car.lane)) lanes.add(car.lane);
  if (car.laneChange) {
    if (validLane(car.laneChange.from)) lanes.add(car.laneChange.from);
    if (validLane(car.laneChange.to)) lanes.add(car.laneChange.to);
  }
  // The lane coordinate is the rear-axle datum, not the model origin. Keep the
  // yawed tractor AND independently lagging trailer reserved after the tractor
  // reaches its target lane; clearing laneChange alone does not clear its tail.
  // Work in local road coordinates to avoid a physics/behaviour import cycle.
  const spec = trafficDefinition(car.kind), yaw = -finite(car.heading);
  const anchor = trafficLateral(car) * LANE_WIDTH;
  const root = anchor - Math.sin(yaw) * finite(spec.rearAxleZ);
  let left = Infinity, right = -Infinity;
  /**
   * Expands the enclosing projected lateral footprint used for lane reservations.
   * @param {number} center - Component centre in road-local lateral metres.
   * @param {number} half - Nonnegative projected half-width in metres.
   * @returns {void} Mutates the enclosing left/right bounds only.
   */
  const include = (center, half) => { left = Math.min(left, center - half); right = Math.max(right, center + half); };
  if (spec.articulated) {
    const tractorLength = 6.2, tractorCenter = -spec.length / 2 + tractorLength / 2;
    include(root + Math.sin(yaw) * tractorCenter,
      (spec.width * Math.abs(Math.cos(yaw)) + tractorLength * Math.abs(Math.sin(yaw))) / 2);
    const trailerAngle = yaw + finite(car.trailerAngle), hitch = root + Math.sin(yaw) * spec.hitchZ;
    const halfWidth = spec.width * Math.abs(Math.cos(trailerAngle)) / 2;
    include(hitch + Math.sin(trailerAngle) * (spec.trailerFrontZ - spec.hitchZ), halfWidth);
    include(hitch + Math.sin(trailerAngle) * (spec.trailerRearZ - spec.hitchZ), halfWidth);
    // Conservative road-bend/chord and horizontal-lane projection allowance at
    // the game's maximum visible road slope. Does not reserve adjacent lanes
    // for an ordinary straight semi, but retains a tail that has not cleared.
    left -= .35; right += .35;
  } else {
    include(root, (spec.width * Math.abs(Math.cos(yaw)) + spec.length * Math.abs(Math.sin(yaw))) / 2);
  }
  for (let lane = 0; lane < 3; lane++) {
    if (right > (lane - .5) * LANE_WIDTH && left < (lane + .5) * LANE_WIDTH) lanes.add(lane);
  }
  return [...lanes].sort((a, b) => a - b);
}

/**
 * Returns a repeatable per-car timing seed, caching a hash on the entity if needed.
 * An existing finite seed is preserved; otherwise ID, or kind/lane/z, is hashed.
 * @param {Object} car - Traffic entity whose laneBehaviourSeed may be initialized.
 * @returns {number} Cached seed, normally in [0, 1).
 */
function seedFor(car) {
  if (Number.isFinite(car.laneBehaviourSeed)) return car.laneBehaviourSeed;
  let hash = 2166136261;
  for (const c of String(car.id ?? `${car.kind}:${car.lane}:${car.z}`)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return car.laneBehaviourSeed = (hash >>> 0) / 4294967296;
}
/**
 * Selects a complete lane-change duration from the vehicle's size category.
 * @param {Object} car - Traffic entity with a catalogue kind.
 * @returns {number} Movement duration in seconds, excluding the turn signal.
 */
function durationFor(car) {
  const category = trafficDefinition(car.kind).category;
  return category === 'passenger' ? 3.4 : category === 'freight' ? 5 : 4.2;
}
/**
 * Bounds possible forward speeds during planning using current/cruise speeds.
 * Event braking adds a possible lower speed of 6 m/s without raising a slower car.
 * @param {Object} car - Entity with speed, optional cruiseSpeed and eventBraking.
 * @returns {number[]} [minimum, maximum] nonnegative speeds in m/s.
 */
function speedBounds(car) {
  const current = speed(car), cruise = Math.max(0, finite(car.cruiseSpeed, current));
  return [Math.min(current, cruise, car.eventBraking ? 6 : Infinity), Math.max(current, cruise)];
}
/**
 * Bounds a rotated vehicle's longitudinal half-extent by its body diagonal.
 * Articulated kinds gain extra hitch allowance for conservative gap checks.
 * @param {Object} car - Traffic descriptor with a catalogue kind.
 * @returns {number} Conservative half-extent in metres.
 */
function halfLength(car) {
  const spec = trafficDefinition(car.kind);
  // The diagonal bounds a rotated body's longitudinal extent; the extra hitch
  // allowance keeps articulated trailers out of an apparently sedan-sized gap.
  return Math.hypot(spec.length, spec.width) / 2 + (spec.articulated ? .8 : 0);
}
/**
 * Bounds the entire relative-z encounter against accelerating/braking player paths.
 * Uses traffic speed bounds, a 19 m/s² player stopping model and conservative body
 * extents, so the interval covers present separation as well as future extremes.
 * @param {Object} state - Player speed, heading and acceleration in SI units.
 * @param {Object} car - Traffic entity with z in metres ahead of the player.
 * @param {number} horizon - Nonnegative planning duration in seconds.
 * @returns {number[]} [minimum, maximum] body-expanded relative distance in metres.
 */
function playerEnvelope(state, car, horizon) {
  const [vMin, vMax] = speedBounds(car);
  const pv = Math.max(0, finite(state.speed) * Math.cos(finite(state.heading)));
  // A driver may accelerate or brake during our signal. Include both responses,
  // not just their present speed, and test the entire swept relative-z interval.
  const acceleration = Math.max(8, finite(state.acceleration));
  const farthestPlayer = pv * horizon + .5 * acceleration * horizon * horizon;
  const stopTime = Math.min(horizon, pv / 19);
  const shortestPlayer = pv * stopTime - .5 * 19 * stopTime * stopTime;
  const extent = halfLength(car) + PLAYER_LENGTH / 2;
  return [Math.min(car.z, car.z + vMin * horizon - farthestPlayer) - extent,
    Math.max(car.z, car.z + vMax * horizon - shortestPlayer) + extent];
}
/**
 * Tests closed interval overlap, counting touching endpoints as an intersection.
 * @param {number} lo - First interval's lower endpoint.
 * @param {number} hi - First interval's upper endpoint.
 * @param {number} a - Second interval's lower endpoint in matching units.
 * @param {number} b - Second interval's upper endpoint.
 * @returns {boolean} Whether the two ordered intervals meet.
 */
const intersects = (lo, hi, a, b) => lo <= b && hi >= a;

/**
 * Checks a whole adjacent-lane manoeuvre against reserved corridors and hazards.
 * Rejects the player's guaranteed safe lane, roadworks, swept player encounters,
 * traffic closing gaps and static obstacles over the full signal/movement horizon.
 * Reads entities only and includes yaw-dependent body width and trailer extent.
 * @param {Object} state - Run with player motion, traffic, safeLane and obstacles.
 * @param {Object} car - Candidate traffic entity, still in its source lane.
 * @param {number} target - Adjacent integer lane index (0..2, positive right).
 * @param {number} horizon - Remaining signal plus movement time in seconds.
 * @returns {boolean} Whether all conservative lane-entry checks pass.
 */
function safeTarget(state, car, target, horizon) {
  if (!validLane(target) || Math.abs(target - car.lane) !== 1) return false;
  // This is the player's guaranteed corridor, not simply a preferred lane.
  if (target === state.safeLane) return false;
  if (state.roadEvent?.type === 'roadworks' && state.roadEvent.lane === target) return false;
  const [lo, hi] = playerEnvelope(state, car, horizon);
  const playerX = finite(state.x, finite(state.lane, 1));
  const projectedPlayerX = clamp(playerX + Math.sin(finite(state.heading)) * Math.max(0, finite(state.speed)) * horizon / LANE_WIDTH, -.24, 2.24);
  const playerHalfWidth = (PLAYER_WIDTH + .9) / (2 * LANE_WIDTH);
  const playerLeft = Math.min(playerX, projectedPlayerX) - playerHalfWidth;
  const playerRight = Math.max(playerX, projectedPlayerX) + playerHalfWidth;
  const spec = trafficDefinition(car.kind), [ownMin, ownMax] = speedBounds(car);
  // Bound the entire swept/rotated body, not just the centre line. Trucks need
  // extra lateral room when their long body yaws; an ordinary car moving away
  // from the player may nevertheless pass visibly in the two other lanes.
  const maxLateralSpeed = 1.875 * LANE_WIDTH / durationFor(car);
  const maxHeading = Math.atan2(maxLateralSpeed, Math.max(6, Math.min(ownMin, 12)));
  const bodyHalfWidth = (spec.width + spec.length * Math.sin(maxHeading)) / (2 * LANE_WIDTH);
  const corridorLeft = Math.min(car.lane, target) - bodyHalfWidth;
  const corridorRight = Math.max(car.lane, target) + bodyHalfWidth;
  const sweepsPlayer = intersects(corridorLeft, corridorRight, playerLeft, playerRight);
  const targetsPlayer = intersects(target - bodyHalfWidth, target + bodyHalfWidth, playerLeft, playerRight);
  if (sweepsPlayer && intersects(lo, hi, -28, 58)) return false;
  if (targetsPlayer && intersects(lo, hi, -45, 125)) return false;

  for (const other of state.traffic) {
    if (other === car || !occupiedTrafficLanes(other).includes(target)) continue;
    const [otherMin, otherMax] = speedBounds(other);
    const delta = other.z - car.z, extent = halfLength(car) + halfLength(other);
    const front = delta >= 0;
    const closing = front ? ownMax - otherMin : otherMax - ownMin;
    const follower = front ? ownMax : otherMax;
    // Linear speed envelopes attain their minimum separation at an endpoint.
    // This is an analytic whole-manoeuvre check, not a current-gap/sparse sample
    // test. Include the signal, body lengths, reaction time and closing margin.
    const smallestGap = Math.abs(delta) - Math.max(0, closing) * horizon;
    if (smallestGap <= extent + 8 + .7 * follower + .8 * Math.max(0, closing)) return false;
  }
  for (const obstacle of state.obstacles || []) {
    if (obstacle.hit || !Number.isFinite(obstacle.z)) continue;
    const obstacleX = finite(obstacle.x, obstacle.lane);
    if (Math.abs(obstacleX - target) > .85) continue;
    // Static road objects advance backwards relative to a traffic car at that
    // car's absolute speed; the player's movement cancels from this difference.
    const delta = obstacle.z - car.z, extent = halfLength(car) + 6;
    if (intersects(delta - ownMax * horizon, delta, -extent, extent)) return false;
  }
  return true;
}

/**
 * Zeros lane-change derivatives and heading, leaving lane/x and speed unchanged.
 * @param {Object} car - Mutable traffic entity; headings are radians, lateral
 * speed/acceleration are m/s and m/s², and lane curvature is inverse metres.
 * @returns {void}
 */
function clearMotion(car) {
  car.lateralSpeed = 0;
  car.lateralAcceleration = 0;
  car.heading = 0;
  car.laneCurvature = 0;
}
/**
 * Cancels an uncommitted signal and restores the source-lane position.
 * Clears indicator/motion state and imposes at least four seconds before retrying;
 * call only while a laneChange exists and has not started moving.
 * @param {Object} car - Mutable signalling traffic entity.
 * @returns {void}
 */
function cancelSignal(car) {
  car.x = car.laneChange.from;
  car.lane = car.laneChange.from;
  car.laneChange = null;
  car.signal = 0;
  car.signalTime = 0;
  car.laneChangeCooldown = Math.max(car.laneChangeCooldown, 4);
  clearMotion(car);
}
/**
 * Samples the committed quintic lane path and its analytic motion derivatives.
 * Mutates x in lane units, lateral speed/acceleration in SI units, heading in
 * radians and lane curvature in 1/m. Positive values point/turn right; progress
 * is clamped to the movement duration, giving zero lateral derivatives at ends.
 * @param {Object} car - Traffic entity with a positive-duration moving laneChange.
 * @returns {void}
 */
function sampleMotion(car) {
  const change = car.laneChange, u = clamp(change.elapsed / change.duration, 0, 1);
  const u2 = u * u, u3 = u2 * u, delta = change.to - change.from;
  // Quintic smoothstep: position, velocity AND acceleration agree at both
  // endpoints. Do not lerp toward a lane or introduce time-based wandering.
  car.x = change.from + delta * (10 * u3 - 15 * u3 * u + 6 * u3 * u2);
  car.lateralSpeed = delta * LANE_WIDTH * 30 * u2 * (1 - u) ** 2 / change.duration;
  car.lateralAcceleration = delta * LANE_WIDTH * 60 * u * (1 - u) * (1 - 2 * u) / change.duration ** 2;
  const v = speed(car), lateral = car.lateralSpeed, squaredSpeed = v * v + lateral * lateral;
  car.heading = Math.atan2(lateral, v);
  car.laneCurvature = squaredSpeed > 1e-8
    ? (v * car.lateralAcceleration - lateral * finite(car.acceleration)) / squaredSpeed ** 1.5 : 0;
}

/** Call once BEFORE longitudinal following on every fixed simulation step.
 * Mutates only per-car behaviour/motion fields; does not change z or speed.
 * laneChange = {from,to,phase,elapsed,signalDuration,duration}; elapsed is local
 * to its phase. car.lane stays from until completion; x is continuous lane units.
 * signal is -1/+1 while signalling/moving and 0 otherwise; signalTime is the
 * continuous indicator clock (seconds), reset when idle. Trajectory derivatives
 * are metres/sec and metres/sec²; heading/curvature use positive-right geometry.
 * The committed path is never snapped/cancelled midway. Following/spawning must
 * respect both reserved lanes. A changing safety condition cancels only a signal.
 * Invalid/nonpositive dt or absent traffic arrays are ignored. Decisions are
 * ordered front-to-back with deterministic tie-breaks, preferring a left pass
 * only when a slower leader creates an actual overtaking opportunity.
 * @param {Object} state - Mutable run with traffic and player/hazard context.
 * @param {number} dt - Fixed simulation interval in seconds.
 * @returns {void}
 */
export function updateTrafficManoeuvres(state, dt) {
  if (!(dt > 0) || !Number.isFinite(dt) || !Array.isArray(state.traffic)) return;
  // Sorting makes competing claims deterministic, independent of array ordering.
  const cars = [...state.traffic].sort((a, b) => b.z - a.z || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : a.lane - b.lane));
  for (const car of cars) {
    const seed = seedFor(car);
    car.x = trafficLateral(car);
    car.laneChangeCooldown = Math.max(0, finite(car.laneChangeCooldown, 2.2 + seed * 3.8) - dt);
    car.laneDecisionIn = Math.max(0, finite(car.laneDecisionIn, .5 + seed) - dt);
    const change = car.laneChange;
    if (!change) { car.signal = 0; car.signalTime = 0; clearMotion(car); continue; }
    car.signal = Math.sign(change.to - change.from);
    car.signalTime = Math.max(0, finite(car.signalTime)) + dt;
    if (change.phase === 'signal') {
      const horizon = Math.max(0, change.signalDuration - change.elapsed) + change.duration;
      if (car.eventId || car.eventBraking || !safeTarget(state, car, change.to, horizon)) { cancelSignal(car); continue; }
      clearMotion(car);
      change.elapsed += dt;
      if (change.elapsed + 1e-10 < change.signalDuration) continue;
      change.elapsed = Math.max(0, change.elapsed - change.signalDuration);
      change.phase = 'moving';
    } else change.elapsed += dt;
    sampleMotion(car);
    if (change.elapsed + 1e-10 >= change.duration) {
      car.lane = change.to; car.x = change.to;
      car.laneChange = null; car.signal = 0; car.signalTime = 0;
      car.laneChangeCooldown = 18 + seed * 8;
      clearMotion(car);
    }
  }
  for (const car of cars) {
    if (car.laneChange || car.laneChangeCooldown > 0 || car.laneDecisionIn > 0) continue;
    car.laneDecisionIn = .65 + seedFor(car) * .55;
    if (car.eventId || car.eventBraking || car.passed || !validLane(car.lane) || speed(car) < 11 || Math.abs(trafficLateral(car) - car.lane) > .01) continue;
    let leader = null;
    for (const other of cars) {
      if (other !== car && other.z > car.z && occupiedTrafficLanes(other).includes(car.lane)
        && (!leader || other.z < leader.z)) leader = other;
    }
    if (!leader) continue;
    const freeGap = leader.z - car.z - (trafficDefinition(car.kind).length + trafficDefinition(leader.kind).length) / 2;
    const cruise = finite(car.cruiseSpeed, speed(car));
    if (cruise < speed(leader) + 2.25 || freeGap < 1.35 || freeGap > Math.min(55, 14 + speed(car) * 1.5)) continue;
    const duration = durationFor(car), signalDuration = .85, horizon = duration + signalDuration;
    // Prefer passing on the left. Never move simply because a lane is empty.
    const target = [car.lane - 1, car.lane + 1].find(lane => safeTarget(state, car, lane, horizon));
    if (target === undefined) continue;
    car.laneChange = { from: car.lane, to: target, phase: 'signal', elapsed: 0, signalDuration, duration };
    car.signal = Math.sign(target - car.lane);
    car.signalTime = 0;
  }
}
