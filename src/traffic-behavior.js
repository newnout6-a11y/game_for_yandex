import { trafficDefinition } from './traffic-catalog.js';

// Simulation-only lane planning. Coordinates are lane units (right is positive),
// z is metres ahead of the player, and all speeds/accelerations are SI units.
// Keep this module independent of rendering and traffic-physics to avoid cycles.
const LANE_WIDTH = 3.5, PLAYER_WIDTH = 2.256, PLAYER_LENGTH = 4.7;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
const validLane = lane => Number.isInteger(lane) && lane >= 0 && lane <= 2;
const speed = car => Math.max(0, finite(car.speed));

export function trafficLateral(car) { return Number.isFinite(car.x) ? car.x : car.lane; }

/** Reserve BOTH lanes from the first signal until the manoeuvre is complete.
 * Longitudinal following, wave spawning and corridor selection must use this
 * function rather than car.lane. Render/collision geometry uses trafficLateral.
 */
export function occupiedTrafficLanes(car) {
  const lanes = new Set();
  if (validLane(car.lane)) lanes.add(car.lane);
  if (car.laneChange) {
    if (validLane(car.laneChange.from)) lanes.add(car.laneChange.from);
    if (validLane(car.laneChange.to)) lanes.add(car.laneChange.to);
  }
  // Account for an already displaced/rotated body, including a long trailer.
  const spec = trafficDefinition(car.kind), yaw = finite(car.heading);
  const halfWidth = (spec.width * Math.abs(Math.cos(yaw)) + spec.length * Math.abs(Math.sin(yaw))) / (2 * LANE_WIDTH);
  const x = trafficLateral(car);
  for (let lane = 0; lane < 3; lane++) {
    if (x + halfWidth > lane - .5 && x - halfWidth < lane + .5) lanes.add(lane);
  }
  return [...lanes].sort((a, b) => a - b);
}

function seedFor(car) {
  if (Number.isFinite(car.laneBehaviourSeed)) return car.laneBehaviourSeed;
  let hash = 2166136261;
  for (const c of String(car.id ?? `${car.kind}:${car.lane}:${car.z}`)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return car.laneBehaviourSeed = (hash >>> 0) / 4294967296;
}
function durationFor(car) {
  const category = trafficDefinition(car.kind).category;
  return category === 'passenger' ? 3.4 : category === 'freight' ? 5 : 4.2;
}
function speedBounds(car) {
  const current = speed(car), cruise = Math.max(0, finite(car.cruiseSpeed, current));
  return [Math.min(current, cruise, car.eventBraking ? 6 : Infinity), Math.max(current, cruise)];
}
function halfLength(car) {
  const spec = trafficDefinition(car.kind);
  // The diagonal bounds a rotated body's longitudinal extent; the extra hitch
  // allowance keeps articulated trailers out of an apparently sedan-sized gap.
  return Math.hypot(spec.length, spec.width) / 2 + (spec.articulated ? .8 : 0);
}
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
const intersects = (lo, hi, a, b) => lo <= b && hi >= a;

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

function clearMotion(car) {
  car.lateralSpeed = 0;
  car.lateralAcceleration = 0;
  car.heading = 0;
  car.laneCurvature = 0;
}
function cancelSignal(car) {
  car.x = car.laneChange.from;
  car.lane = car.laneChange.from;
  car.laneChange = null;
  car.signal = 0;
  car.signalTime = 0;
  car.laneChangeCooldown = Math.max(car.laneChangeCooldown, 4);
  clearMotion(car);
}
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
