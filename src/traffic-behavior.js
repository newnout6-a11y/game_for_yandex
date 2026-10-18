import { trafficDefinition } from './traffic-catalog.js';
import { playerBoundsFor } from './player-spec.js';
import { trafficDriverProfile, trafficSafeSpeed, TRAFFIC_DRIVER_LIMITS } from './traffic-policy.js';

// Simulation-only lane planning. Coordinates are lane units (right is positive),
// z is metres ahead of the player, and all speeds/accelerations are SI units.
// Keep this module independent of rendering and traffic-physics to avoid cycles.
const LANE_WIDTH = 3.5;
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
 * Bounds planned speeds using current/cruise, the longitudinal target and a
 * sensed slower source-lane leader. Event braking also includes its 6 m/s goal.
 * @param {Object} car - Entity with speed, optional cruiseSpeed and eventBraking.
 * @returns {number[]} [minimum, maximum] nonnegative speeds in m/s.
 */
function speedBounds(car) {
  const current = speed(car), cruise = Math.max(0, finite(car.cruiseSpeed, current));
  const planned = Math.max(0, finite(car.desiredSpeed, current));
  const leader = car.awareness?.gap < 14 + current * 1.5
    ? Math.max(0, finite(car.awareness.leaderSpeed, current)) : current;
  return [Math.min(current, cruise, planned, leader, car.eventBraking ? 6 : Infinity), Math.max(current, cruise)];
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
 * Integrate an accelerating player with an explicit reachable speed cap.
 * @param {number} v - Initial forward speed, m/s.
 * @param {number} a - Positive acceleration bound, m/s².
 * @param {number} cap - Reachable maximum speed, m/s, at least v.
 * @param {number} t - Nonnegative elapsed seconds.
 * @returns {number} Furthest forward displacement in metres.
 */
function acceleratedDistance(v, a, cap, t) {
  const accelerating = Math.min(t, Math.max(0, cap - v) / a);
  return v * accelerating + .5 * a * accelerating ** 2 + cap * (t - accelerating);
}
/**
 * Bound how far ahead a combined horn/flash request can usefully be perceived.
 * Highway drivers need enough notice for their own reaction, the next planning
 * tick, the signal and the complete category-specific maneuver. Reachable player
 * acceleration is counted, but hearing/visibility never extends beyond 230 m.
 * This only delivers a request: it does not approve a lane change or priority.
 * @param {Object} state - Player forward speed, heading and physical bounds.
 * @param {Object} car - Traffic speed, kind and optional initialized personality.
 * @returns {number} Bounded positive-ahead perception distance in metres.
 */
export function trafficHornRange(state, car) {
  const driver = trafficDriverProfile(car);
  const playerSpeed = Math.max(0, finite(state.speed) * Math.cos(finite(state.heading)));
  const acceleration = Math.max(8, finite(state.playerAccelerationBound, 15), finite(state.acceleration));
  const cap = Math.max(playerSpeed, finite(state.playerSpeedBound, 80));
  // An initial observation can take 1.5 s; established decisions take <= .95 s.
  const decisionWait = Math.min(1.5, Math.max(.95, finite(car.laneDecisionIn, 1.5)));
  const horizon = driver.reaction + decisionWait + .85 + durationFor(car);
  const trafficTravel = speedBounds(car)[0] * horizon;
  const closure = Math.max(0, acceleratedDistance(playerSpeed, acceleration, cap, horizon) - trafficTravel);
  const bodyAllowance = halfLength(car) + playerBoundsFor(state).length / 2 + 18;
  return clamp(bodyAllowance + closure, 90, 230);
}
/**
 * Bound relative longitudinal position on a closed time interval. Includes the
 * interior extrema when a braking/accelerating player matches traffic speed;
 * checking endpoints alone misses a player stopping beside a moving vehicle.
 * @param {Object} state - Player motion and physical acceleration/speed bounds.
 * @param {Object} car - Traffic body with positive-ahead relative z.
 * @param {number} from - Interval start, seconds from now.
 * @param {number} to - Interval end, seconds from now.
 * @returns {number[]} Conservative body-expanded relative-z interval in metres.
 */
function playerEnvelope(state, car, from, to) {
  const [vMin, vMax] = speedBounds(car);
  const pv = Math.max(0, finite(state.speed) * Math.cos(finite(state.heading)));
  const acceleration = Math.max(8, finite(state.playerAccelerationBound, 15), finite(state.acceleration));
  const cap = Math.max(pv, finite(state.playerSpeedBound, 80));
  const braking = Math.max(19, finite(state.playerBrakingBound, 19));
  const points = [from, to, clamp((vMin - pv) / acceleration, from, to),
    clamp((pv - vMax) / braking, from, to), clamp(pv / braking, from, to),
    clamp((cap - pv) / acceleration, from, to)];
  let lo = Infinity, hi = -Infinity;
  for (const t of points) {
    const stopTime = Math.min(t, pv / braking);
    const shortest = pv * stopTime - .5 * braking * stopTime ** 2;
    lo = Math.min(lo, car.z + vMin * t - acceleratedDistance(pv, acceleration, cap, t));
    hi = Math.max(hi, car.z + vMax * t - shortest);
  }
  const extent = halfLength(car) + playerBoundsFor(state).length / 2;
  return [lo - extent, hi + extent];
}
/** Quintic lane-position fraction with stationary smooth endpoints. */
function laneFraction(u) { u = clamp(u, 0, 1); return u ** 3 * (10 - 15 * u + 6 * u * u); }
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
 * Rejects the local reserved wave, roadworks, swept player encounters,
 * traffic closing gaps and static obstacles over the full signal/movement horizon.
 * Reads entities only and includes yaw-dependent body width and trailer extent.
 * @param {Object} state - Run with player motion, traffic, safeCorridor and obstacles.
 * @param {Object} car - Candidate traffic entity, still in its source lane.
 * @param {number} target - Adjacent integer lane index (0..2, positive right).
 * @param {number} horizon - Remaining signal plus movement time in seconds.
 * @returns {boolean} Whether all conservative lane-entry checks pass.
 */
function safeTarget(state, car, target, horizon) {
  if (!validLane(target) || Math.abs(target - car.lane) !== 1) return false;
  // New games reserve a local moving wave, not a permanently empty lane.
  // Standalone/legacy callers without this field retain their old contract.
  if (!Object.hasOwn(state, 'safeCorridor') && target === state.safeLane) return false;
  const corridor = state.safeCorridor;
  if (corridor && corridor.lane === target) {
    const delta = car.z - corridor.z, relative = speed(car) - Math.max(0, finite(corridor.speed));
    const margin = Math.max(12, finite(corridor.halfLength, 32)) + halfLength(car);
    if (intersects(Math.min(delta, delta + relative * horizon), Math.max(delta, delta + relative * horizon), -margin, margin)) return false;
  }
  if (state.roadEvent?.type === 'roadworks' && state.roadEvent.lane === target) return false;
  const spec = trafficDefinition(car.kind), [ownMin, ownMax] = speedBounds(car);
  const duration = durationFor(car), change = car.laneChange;
  const movementStart = change?.phase === 'moving' ? -change.elapsed
    : change?.phase === 'signal' ? Math.max(0, change.signalDuration - change.elapsed) : horizon - duration;
  const playerX = finite(state.x, finite(state.lane, 1));
  const playerLateralSpeed = Math.sin(finite(state.heading)) * Math.max(0, finite(state.speed)) / LANE_WIDTH;
  const playerHalfWidth = (playerBoundsFor(state).width + .6) / (2 * LANE_WIDTH);
  const maxLateralSpeed = 1.875 * LANE_WIDTH / duration;
  const maxHeading = Math.atan2(maxLateralSpeed, Math.max(6, Math.min(ownMin, 12)));
  const bodyHalfWidth = (spec.width + spec.length * Math.sin(maxHeading)) / (2 * LANE_WIDTH);
  // Each slice encloses the COMPLETE continuous quintic sweep, not just sampled
  // positions. Source-lane overlap ends before the maneuver finishes, allowing
  // a distant car to yield away from the player without pretending to teleport.
  // Predict current player drift and body clearance. Arbitrarily steering into
  // a previously clear traffic car is intentionally not a promised safe path.
  const slices = 12;
  for (let i = 0; i < slices; i++) {
    const t0 = horizon * i / slices, t1 = horizon * (i + 1) / slices;
    const x0 = car.lane + (target - car.lane) * laneFraction((t0 - movementStart) / duration);
    const x1 = car.lane + (target - car.lane) * laneFraction((t1 - movementStart) / duration);
    const p0 = clamp(playerX + playerLateralSpeed * t0, -.24, 2.24);
    const p1 = clamp(playerX + playerLateralSpeed * t1, -.24, 2.24);
    const left = Math.min(x0, x1) - bodyHalfWidth, right = Math.max(x0, x1) + bodyHalfWidth;
    if (!intersects(left, right, Math.min(p0, p1) - playerHalfWidth, Math.max(p0, p1) + playerHalfWidth)) continue;
    const [lo, hi] = playerEnvelope(state, car, t0, t1);
    // Extra front/rear allowance covers reaction and body-envelope uncertainty.
    if (intersects(lo, hi, -10, 18)) return false;
  }
  // Entering the player's actual lane also needs comfortable post-merge headway,
  // not merely a no-contact trajectory at the last instant of the maneuver.
  const finalPlayerX = clamp(playerX + playerLateralSpeed * horizon, -.24, 2.24);
  if (intersects(target - bodyHalfWidth, target + bodyHalfWidth, finalPlayerX - playerHalfWidth, finalPlayerX + playerHalfWidth)) {
    const [lo, hi] = playerEnvelope(state, car, horizon, horizon);
    if (intersects(lo, hi, -24, 35 + Math.max(0, finite(state.speed)) * .65)) return false;
  }

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

/**
 * Read local leaders/followers and static hazards for one lane. Reservations are
 * supplied by the current decision pass so every new claim is visible immediately.
 * @param {Object} state - Road hazards.
 * @param {Object[]} cars - Stable front-to-back traffic snapshot.
 * @param {Map<Object, number[]>} occupancy - Full swept lane reservations.
 * @param {Object} car - Observing driver.
 * @param {number} lane - Lane to inspect.
 * @returns {Object} Nearest front/rear entities, bumper gap and obstacle gap.
 */
function inspectLane(state, cars, occupancy, car, lane) {
  let leader = null, follower = null, obstacleGap = Infinity;
  for (const other of cars) {
    if (other === car || !occupancy.get(other).includes(lane)) continue;
    if (other.z > car.z && (!leader || other.z < leader.z)) leader = other;
    else if (other.z <= car.z && (!follower || other.z > follower.z)) follower = other;
  }
  for (const obstacle of state.obstacles || []) {
    if (obstacle.hit || !Number.isFinite(obstacle.z) || Math.abs(finite(obstacle.x, obstacle.lane) - lane) > .85) continue;
    const gap = obstacle.z - car.z - halfLength(car) - (obstacle.kind === 'barrier' ? 2 : .6);
    if (gap >= -1) obstacleGap = Math.min(obstacleGap, gap);
  }
  return { leader, follower, gap: leader ? leader.z - car.z - halfLength(car) - halfLength(leader) : Infinity, obstacleGap };
}
/**
 * Score a safe candidate by actual usable speed, available room and cost imposed
 * on its follower. A tie slightly favours a conventional left overtake, while a
 * horn yield favours the road edge away from the player's current path.
 * @param {Object} lane - Local lane observation from inspectLane.
 * @param {Object} car - Driver requesting a move.
 * @param {number} target - Adjacent lane index.
 * @param {string} reason - overtake, avoid-hazard or yield-horn.
 * @returns {number} Comparable deterministic utility, higher is better.
 */
function laneUtility(lane, car, target, reason) {
  const driver = car.driver, own = speed(car), limits = TRAFFIC_DRIVER_LIMITS[trafficDefinition(car.kind).category];
  const room = Math.min(lane.gap, lane.obstacleGap);
  const usefulSpeed = lane.leader ? Math.min(driver.desiredSpeed, speed(lane.leader) + Math.max(0, lane.gap - 20) * .14) : driver.desiredSpeed;
  let courtesyCost = 0;
  if (lane.follower) {
    const rear = lane.follower, rearDriver = trafficDriverProfile(rear), rearLimits = TRAFFIC_DRIVER_LIMITS[trafficDefinition(rear.kind).category];
    const gap = car.z - rear.z - halfLength(car) - halfLength(rear) - rearDriver.minimumGap;
    const safe = trafficSafeSpeed(gap, own, rearLimits.braking, limits.braking, rearDriver.reaction);
    courtesyCost = Math.max(0, speed(rear) - safe) * driver.politeness;
  }
  return usefulSpeed + Math.min(80, room) * .015 - courtesyCost * 2
    + (reason === 'yield-horn' ? Math.abs(target - 1) * .5 : target < car.lane ? .25 : 0);
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
 * ordered front-to-back with deterministic tie-breaks. Drivers only move for a
 * slower leader, a road hazard or a safely actionable, individually delayed horn
 * request; target utility accounts for available speed and follower burden.
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
    car.driver = trafficDriverProfile(car);
    car.driverIntent ??= 'cruise';
    car.yieldRequestTime = Math.max(0, finite(car.yieldRequestTime) - dt);
    car.hornReactionIn = Math.max(0, finite(car.hornReactionIn) - dt);
    if (state.hornTime > 0 && Number.isFinite(state.hornSerial) && car.heardHornSerial !== state.hornSerial) {
      car.heardHornSerial = state.hornSerial;
      const playerX = finite(state.x, finite(state.lane, 1));
      if (!car.passed && car.z > 16 && car.z <= trafficHornRange(state, car) && Math.abs(trafficLateral(car) - playerX) < .72
        && finite(state.speed) > speed(car) + 1 && finite(state.altitude) < 2) {
        car.hornReactionIn = car.driver.reaction;
        car.yieldRequestTime = 4.5;
      }
    }
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
      car.driverIntent = 'cruise';
      clearMotion(car);
    }
  }
  const occupancy = new Map(cars.map(car => [car, occupiedTrafficLanes(car)]));
  for (const car of cars) {
    if (car.laneChange || !validLane(car.lane)) continue;
    const seen = inspectLane(state, cars, occupancy, car, car.lane), driver = car.driver;
    const leader = seen.leader;
    const closing = leader ? speed(car) - speed(leader) : 0;
    // Compact factual diagnostics aid tuning and tests; they are not an opaque
    // claim that an NPC understands the whole map or every possible player turn.
    car.awareness = { leaderId: leader?.id ?? null, followerId: seen.follower?.id ?? null,
      gap: seen.gap, leaderSpeed: leader ? speed(leader) : null, closingSpeed: closing, obstacleGap: seen.obstacleGap };
    const hazard = seen.obstacleGap < Math.max(45, speed(car) * 4.5);
    const yieldReady = car.yieldRequestTime > 0 && car.hornReactionIn <= 0;
    const blocked = leader && driver.desiredSpeed >= speed(leader) + 2.25
      && seen.gap > 1.35 && seen.gap < Math.min(65, 14 + speed(car) * (1.5 + driver.patience * .25));
    car.driverIntent = hazard ? 'approaching-hazard' : yieldReady ? 'considering-yield' : blocked ? 'following' : 'cruise';
    const urgent = hazard || yieldReady;
    if (car.laneDecisionIn > 0 || (car.laneChangeCooldown > 0 && !(urgent && car.laneChangeCooldown < 12))) continue;
    car.laneDecisionIn = .55 + seedFor(car) * .4;
    if (car.eventId || car.eventBraking || car.passed || speed(car) < (hazard ? 5 : 11)
      || Math.abs(trafficLateral(car) - car.lane) > .01 || !(hazard || yieldReady || blocked)) continue;
    const reason = hazard ? 'avoid-hazard' : yieldReady ? 'yield-horn' : 'overtake';
    const duration = durationFor(car), signalDuration = .85, horizon = duration + signalDuration;
    let best = null;
    for (const target of [car.lane - 1, car.lane + 1]) {
      if (!safeTarget(state, car, target, horizon)) continue;
      const targetLane = inspectLane(state, cars, occupancy, car, target);
      if (reason === 'overtake' && targetLane.leader && speed(targetLane.leader) < speed(leader) + 1
        && targetLane.gap < seen.gap + 15) continue;
      const utility = laneUtility(targetLane, car, target, reason);
      if (!best || utility > best.utility + 1e-9) best = { target, utility };
    }
    if (!best) continue; // A horn never cancels safety or causes a panic brake.
    const target = best.target;
    car.laneChange = { from: car.lane, to: target, phase: 'signal', elapsed: 0, signalDuration, duration, reason };
    car.driverIntent = reason;
    car.signal = Math.sign(target - car.lane);
    car.signalTime = 0;
    if (reason === 'yield-horn') car.yieldRequestTime = 0;
    occupancy.set(car, occupiedTrafficLanes(car));
  }
}
