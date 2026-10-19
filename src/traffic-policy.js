import { trafficDefinition } from './traffic-catalog.js';

// All distances are metres and all speeds/accelerations use SI units. These
// longitudinal limits match the category suspension/dynamics calibration.
export const TRAFFIC_DRIVER_LIMITS = Object.freeze({
  passenger: Object.freeze({ acceleration: 2.8, braking: 6.5 }),
  commercial: Object.freeze({ acceleration: 1.8, braking: 5.4 }),
  freight: Object.freeze({ acceleration: 1.15, braking: 4.8 }),
  special: Object.freeze({ acceleration: 1.4, braking: 5 }),
});
/** Bound a scalar without modifying it. */
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** Read a finite SI scalar or its fallback without coercion. */
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;

/**
 * Hash a stable vehicle identity and independent trait salt into [0, 1).
 * This is not the gameplay RNG: thinking cannot consume spawn/random rewards.
 * @param {Object} car - Traffic identity; id is preferred over stable fallback.
 * @param {string} salt - Independent driver trait name.
 * @returns {number} Deterministic normalized sample.
 */
function trait(car, salt) {
  let h = 2166136261;
  for (const c of `${car.id ?? `${car.kind}:${car.lane}:${car.z}`}:${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  // Avalanche sequential numeric IDs so neighbours do not share personalities.
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Construct an immutable deterministic driver personality without mutating car.
 * A previously initialized driver is reused. Desired speed is a preference,
 * not permission to exceed category cruise limits or ignore leaders/hazards.
 * @param {Object} car - Identity, kind and optional assigned cruiseSpeed.
 * @returns {Readonly<Object>} Desired m/s, time headway/reaction in seconds,
 * minimum bumper gap in metres, politeness and patience in [0, 1].
 */
export function trafficDriverProfile(car) {
  if (car.driver) return car.driver;
  const spec = trafficDefinition(car.kind), heavy = spec.category === 'freight';
  const preference = trait(car, 'pace'), headway = trait(car, 'headway');
  return Object.freeze({
    desiredSpeed: clamp(finite(car.cruiseSpeed, spec.cruise[0] + preference * (spec.cruise[1] - spec.cruise[0])), 0, spec.cruise[1]),
    headway: (heavy ? 1.25 : .95) + headway * .5,
    reaction: .32 + trait(car, 'reaction') * .36,
    minimumGap: (heavy ? 3.4 : 2.4) + trait(car, 'standstill') * .8,
    politeness: .35 + trait(car, 'politeness') * .6,
    patience: trait(car, 'patience'),
  });
}

/**
 * Maximum speed whose reaction distance and braking distance fit the free gap,
 * allowing the leader to brake at its own maximum. Always finite/nonnegative.
 * Does not promise recovery from an already physically impossible overlap.
 * @param {number} gap - Bumper gap minus desired standstill reserve, metres.
 * @param {number} leaderSpeed - Nonnegative forward leader speed, m/s.
 * @param {number} braking - Follower's positive maximum deceleration, m/s².
 * @param {number} leaderBraking - Leader's positive maximum deceleration, m/s².
 * @param {number} reaction - Perception/actuation allowance, seconds.
 * @returns {number} Safe velocity ceiling in m/s.
 */
export function trafficSafeSpeed(gap, leaderSpeed, braking, leaderBraking, reaction) {
  const b = Math.max(.1, finite(braking, 4.8)), bl = Math.max(.1, finite(leaderBraking, b));
  const reserve = b * Math.max(0, finite(reaction));
  return Math.max(0, Math.sqrt(Math.max(0, reserve * reserve + b / bl * Math.max(0, finite(leaderSpeed)) ** 2 + 2 * b * finite(gap))) - reserve);
}

/**
 * Plan one longitudinal step. Reads an already selected leader and all static
 * hazards in the caller's swept occupied lanes; no sorting, z changes or snaps.
 * Personality changes comfort/headway, never the braking envelope. Perception is
 * refreshed every tick while reaction is included analytically in safe gaps.
 * @param {Object} state - Player speed/heading and road obstacles.
 * @param {Object} car - Traffic speed, z, kind, profile, event/lane-change state.
 * @param {Object} context - leader, followingPlayer, playerDepth (centre gap),
 * occupiedLanes (both reserved lanes), optional category response limits.
 * @param {number} dt - Positive fixed step in seconds; invalid values are no-op.
 * @returns {Object} speed, acceleration, braking, targetSpeed, intent, gap,
 * leaderId and emergency diagnostics. No argument is mutated.
 */
export function planTrafficLongitudinal(state, car, context = {}, dt = 0) {
  const current = Math.max(0, finite(car.speed)), driver = trafficDriverProfile(car);
  const spec = trafficDefinition(car.kind), limits = context.limits || TRAFFIC_DRIVER_LIMITS[spec.category];
  const braking = Math.max(.1, finite(limits.braking, 4.8)), acceleration = Math.max(.1, finite(limits.acceleration, 1.15));
  // Explicit cruise changes (events, debug fixture, stopped vehicles) remain
  // authoritative below the catalogue cap; an initialized profile cannot undo it.
  const desired = clamp(finite(car.cruiseSpeed, current), 0, spec.cruise[1]);
  let target = car.eventBraking ? Math.min(6, desired) : desired;
  let gap = Infinity, leaderId = null, intent = car.eventBraking ? 'event-braking' : context.followingPlayer ? 'following-player' : 'cruise', emergency = false;
  /** Apply one sensed leader/hazard and retain the most restrictive speed. */
  const constrain = (freeGap, leadSpeed, leadBraking, cause, id = null) => {
    const clearance = Math.max(0, finite(freeGap)) - driver.minimumGap;
    const safe = trafficSafeSpeed(clearance, leadSpeed, braking, leadBraking, driver.reaction + Math.max(0, finite(dt)));
    const desiredGap = driver.minimumGap + current * driver.headway;
    const comfortable = Math.max(0, leadSpeed + (freeGap - desiredGap) / Math.max(1.1, driver.headway * 1.6));
    const ceiling = leadSpeed < .05 && freeGap < driver.minimumGap + .35 && current < .25 ? 0 : Math.min(safe, comfortable);
    if (ceiling < target) { target = ceiling; gap = freeGap; leaderId = id; intent = cause; }
    // Diagnostic only. The game retains its last-resort nonpenetration guard
    // for deliberately impossible cut-ins, but normal planning brakes earlier.
    if (current > safe + braking * Math.max(0, finite(dt)) + .05) emergency = true;
  };
  const leader = context.leader;
  if (leader && leader !== car && Number.isFinite(leader.z)) {
    const leadSpec = trafficDefinition(leader.kind), leadLimits = TRAFFIC_DRIVER_LIMITS[leadSpec.category];
    constrain(leader.z - finite(car.z) - (spec.length + leadSpec.length) / 2,
      Math.max(0, finite(leader.speed)), leadLimits.braking, 'following', leader.id ?? null);
  }
  if (context.followingPlayer) {
    constrain(-finite(car.z) - Math.max(0, finite(context.playerDepth, spec.length / 2 + 2.35)),
      Math.max(0, finite(state.speed) * Math.cos(finite(state.heading))),
      Math.max(19, finite(state.playerBrakingBound, 19)), 'following-player', 'player');
  }
  const occupied = context.occupiedLanes || [car.lane];
  for (const obstacle of state.obstacles || []) {
    if (obstacle.hit || !Number.isFinite(obstacle.z)) continue;
    const x = finite(obstacle.x, obstacle.lane);
    if (!occupied.some(lane => Math.abs(x - lane) <= (obstacle.kind === 'barrier' ? .82 : .65))) continue;
    const freeGap = obstacle.z - finite(car.z) - spec.length / 2 - (obstacle.kind === 'barrier' ? 2 : .6);
    // An object already behind the front bumper is not a new leader. A small
    // intersecting allowance still brakes if an object appeared on this tick.
    if (freeGap < -spec.length) continue;
    constrain(freeGap, 0, braking, 'hazard', obstacle.id ?? null);
  }
  if (!(dt > 0) || !Number.isFinite(dt)) return { speed: current, acceleration: 0, braking: false, targetSpeed: target, intent, gap, leaderId, emergency };
  // Exact first-order response, then category limits. No speed reset when a
  // preference changes; heavy trucks accelerate and brake more deliberately.
  const wanted = (target - current) * (1 - Math.exp(-dt / Math.max(.22, driver.reaction)));
  const nextSpeed = target === 0 && current < .02 && current <= braking * dt
    ? 0 : Math.max(0, current + clamp(wanted, -braking * dt, acceleration * dt));
  const actual = (nextSpeed - current) / dt;
  return { speed: nextSpeed, acceleration: actual, braking: actual < -.18 || (Boolean(car.braking) && actual < .05 && target < current)
    || Boolean(car.eventBraking) || (target === 0 && current < .25 && intent !== 'cruise'),
    targetSpeed: target, intent: car.laneChange ? car.laneChange.reason || 'changing-lane' : intent, gap, leaderId, emergency };
}
