import { clamp } from './util.js';
import { dampedSpring } from './traffic-motion.js';

// Measured from the normalized authored Rocket axle centres. SI metres/radians.
export const PLAYER_WHEELBASE = 2.9006259276394206;
export const PLAYER_REAR_OFFSET = 1.4413350520479036;
export const PLAYER_MAX_LATERAL_ACCELERATION = 10;
// Deliberate accessible-arcade authority, not a factory lateral-g claim. Catalog
// grip values still preserve each vehicle’s relative handling differences.
export const PLAYER_ARCADE_GRIP_MULTIPLIER = 1.4;
export const PLAYER_BODY_TRAVEL = .018;

// Simplified arcade tire/response tuning, not measured factory handling.
// Steering asks for a bounded road-relative attitude, never a lane or position.
// The rack drives two axle tire forces; those forces integrate persistent linear
// and angular momentum. Collision impulses survive into the next physics step.
export const PLAYER_HANDLING = Object.freeze({
  lateralSpeed: 5, maxHeading: .42, headingResponse: 9, neutralResponse: 28,
  maxSteerAngle: .3, maxSteerRate: 2.2,
  tireGrip: 27, yawInertia: .14, yawResponse: .05, yawDamping: .6, airYawResponse: 7,
  edgeResponse: 3, edgeMargin: .08, edgeLookAhead: .1, minX: 1 - 6.2 / 3.5, maxX: 1 + 6.2 / 3.5,
  laneWidth: 3.5, maxStep: 1 / 120, maxFrame: .1,
});
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bounded = (value, low, high, fallback) => Number.isFinite(value) && value >= low && value <= high ? value : fallback;

/** Actual tire/shoulder braking budget, shared by simulation and diagnostics. */
export function playerEffectiveGrip(state = {}) {
  return bounded(state.maxLateralAcceleration, 1, 20, PLAYER_MAX_LATERAL_ACCELERATION) * PLAYER_ARCADE_GRIP_MULTIPLIER;
}

/**
 * Integrate a constant-curvature rear-axle arc, then recover the body-centre path.
 * Speed belongs to the centre, so rear speed accounts for its forward offset.
 * Heading is positive right; forward travel is positive, unlike scene -Z.
 * @param {number} heading - Initial heading in radians.
 * @param {number} speed - Nonnegative centre speed in metres/second.
 * @param {number} curvature - Rear-axle path curvature in inverse metres.
 * @param {number} dt - Nonnegative elapsed seconds.
 * @returns {{heading:number,x:number,forward:number,rearDistance:number,yawRate:number}}
 * Exact arc endpoint displacement and wheel-path clock increment; no input mutation.
 */
export function integratePlayerArc(heading, speed, curvature, dt, rearOffset = PLAYER_REAR_OFFSET) {
  const offset = Number.isFinite(rearOffset) && rearOffset > 0 && rearOffset < 4 ? rearOffset : PLAYER_REAR_OFFSET;
  const h = Number.isFinite(heading) ? heading : 0;
  const k = Number.isFinite(curvature) ? curvature : 0;
  const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const v = Math.max(0, Number.isFinite(speed) ? speed : 0) / Math.hypot(1, k * offset);
  const rearDistance = v * step, turn = rearDistance * k, next = h + turn;
  let x, forward;
  if (Math.abs(k) < 1e-8) { x = Math.sin(h) * rearDistance; forward = Math.cos(h) * rearDistance; }
  else { x = (Math.cos(h) - Math.cos(next)) / k; forward = (Math.sin(next) - Math.sin(h)) / k; }
  x += offset * (Math.sin(next) - Math.sin(h));
  forward += offset * (Math.cos(next) - Math.cos(h));
  return { heading: next, x, forward, rearDistance, yawRate: v * k };
}

/**
 * Resolve road-relative steering assistance, never a destination or target lane.
 * Heading remains a force-driven state, not a pose written by this controller.
 * The shoulder aid limits outward intent using available stopping distance; it
 * cannot teleport the car or erase an impact. Rail contact is resolved by Game.
 * @param {object} state - Road-frame velocity in m/s and x in lane units.
 * @param {number} input - Normalized signed steering axis.
 * @returns {number} Requested road-relative heading in radians.
 */
export function playerTargetHeading(state, input) {
  const tuning = PLAYER_HANDLING, request = clamp(finite(input), -1, 1);
  const speed = Math.max(0, finite(state.speed)), direction = Math.sign(request);
  const x = finite(state.x, 1);
  const outwardSpeed = Math.max(0, finite(state.lateralVelocity) * direction);
  const edgeDistance = (direction > 0 ? tuning.maxX - x : x - tuning.minX) * tuning.laneWidth;
  const available = Math.max(0, edgeDistance - tuning.edgeMargin - outwardSpeed * tuning.edgeLookAhead);
  const grip = playerEffectiveGrip(state);
  const lateralSpeed = Math.min(Math.abs(request) * tuning.lateralSpeed,
    available * tuning.edgeResponse, Math.sqrt(2 * grip * available) * .8);
  return direction * Math.min(Math.abs(request) * tuning.maxHeading,
    Math.atan2(lateralSpeed, Math.max(speed, .001)));
}

/**
 * Advance road-frame momentum from a regularized two-axle arcade tire model.
 * The front/rear contact velocities include yaw at their actual lever arms.
 * Each axle has a finite lateral-friction budget, so neither the attitude aid nor
 * a released control can erase collision side velocity or spin in one frame.
 */
function playerPathStep(state, input, dt) {
  const tuning = PLAYER_HANDLING;
  const wheelbase = bounded(state.playerWheelbase, .5, 6, PLAYER_WHEELBASE);
  const rear = bounded(state.playerRearOffset, .2, wheelbase - .2, Math.min(PLAYER_REAR_OFFSET, wheelbase / 2));
  const front = wheelbase - rear;
  const grip = playerEffectiveGrip(state);
  const slew = clamp(finite(state.steeringSlewMultiplier, 1), .5, 1.3);
  const heading = finite(state.heading), yaw = finite(state.yawRate);
  // speed is the propulsion/HUD alias for actual road-forward velocity. The game
  // and collision solver write both aliases; never derive either from heading.
  const vz = Math.max(0, finite(state.speed, finite(state.forwardVelocity)));
  const vx = finite(state.lateralVelocity);
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const bodyForward = vx * sin + vz * cos, bodySide = vx * cos - vz * sin;
  const longitudinal = Math.max(0, bodyForward);
  const response = Math.abs(input) < .001
    ? tuning.neutralResponse * clamp(longitudinal / 28, .5, 1) : tuning.headingResponse;
  const requestedYaw = (playerTargetHeading(state, input) - heading) * response - yaw * tuning.yawDamping;
  const maxYaw = Math.min(longitudinal * Math.tan(tuning.maxSteerAngle) / wheelbase,
    grip / Math.max(longitudinal, 1));
  const targetYaw = clamp(requestedYaw, -maxYaw, maxYaw);
  // Feed-forward Ackermann angle plus finite yaw-rate feedback overcomes rack /
  // tire lag at speed. Full parking lock is still available when stationary.
  const targetAngle = longitudinal > .15
    ? clamp(Math.atan(wheelbase * targetYaw / longitudinal) + (targetYaw - yaw) * tuning.yawResponse * Math.min(1, 25 / longitudinal),
      -tuning.maxSteerAngle, tuning.maxSteerAngle)
    : input * tuning.maxSteerAngle;
  const angle = finite(state.steerAngle);
  state.steerAngle = clamp(angle + clamp(targetAngle - angle,
    -tuning.maxSteerRate * slew * dt, tuning.maxSteerRate * slew * dt), -tuning.maxSteerAngle, tuning.maxSteerAngle);
  state.curvature = Math.tan(state.steerAngle) / wheelbase;

  const grounded = finite(state.altitude) < .02 && !state.rolling;
  let lateralForce, longitudinalForce = 0, yawAcceleration;
  if (grounded) {
    // Lateral contact velocity, not atan(v/u), avoids the singularity at rest.
    // Static load split follows the centre-to-axle distances. Units are forces
    // divided by vehicle mass (m/s²), with inertia likewise mass-normalized.
    const steerSin = Math.sin(state.steerAngle), steerCos = Math.cos(state.steerAngle);
    const frontSlip = (bodySide + front * yaw) * steerCos - bodyForward * steerSin;
    const rearSlip = bodySide - rear * yaw;
    const frontForce = clamp(-frontSlip * tuning.tireGrip, -grip * rear / wheelbase, grip * rear / wheelbase);
    const rearForce = clamp(-rearSlip * tuning.tireGrip, -grip * front / wheelbase, grip * front / wheelbase);
    lateralForce = frontForce * steerCos + rearForce;
    longitudinalForce = -frontForce * steerSin;
    yawAcceleration = (front * frontForce * steerCos - rear * rearForce) / (wheelbase * wheelbase * tuning.yawInertia);
  } else {
    // Existing hover/flight has its own bounded thruster authority, not grounded
    // tire grip. Barrel-roll/altitude state remains owned by the flight module.
    lateralForce = clamp(longitudinal * yaw - bodySide * 4, -grip * .65, grip * .65);
    yawAcceleration = clamp((targetYaw - yaw) * tuning.airYawResponse, -2.5, 2.5);
  }
  const nextYaw = yaw + yawAcceleration * dt;
  const nextHeading = heading + (yaw + nextYaw) * .5 * dt;
  const ax = lateralForce * cos + longitudinalForce * sin;
  const az = -lateralForce * sin + longitudinalForce * cos;
  const nextVx = vx + ax * dt, nextVz = Math.max(0, vz + az * dt);
  const dx = (vx + nextVx) * .5 * dt, forward = (vz + nextVz) * .5 * dt;
  state.x = finite(state.x, 1) + dx / tuning.laneWidth;
  state.heading = nextHeading;
  state.yawRate = nextYaw;
  state.lateralVelocity = nextVx;
  state.forwardVelocity = state.speed = nextVz;
  state.lateralAcceleration = ax;
  state.slipAngle = Math.atan2(nextVx, Math.max(nextVz, .001)) - nextHeading;
  // Wheel rotation follows actual rear-contact rolling travel, not road scrolling
  // or the diagonal centre displacement caused by a collision's side impulse.
  const rearRolling = Math.max(0, (bodyForward + nextVx * Math.sin(nextHeading) + nextVz * Math.cos(nextHeading)) * .5);
  state.rearDistance = finite(state.rearDistance) + rearRolling * dt;
  state.wheelDistance = state.rearDistance;
  state.lane = clamp(Math.round(state.x), 0, 2);
  return forward;
}

/**
 * Advance the rack, tire forces and independent linear/angular momentum.
 * x is in 3.5-metre lane units; speed and forwardVelocity are road-forward m/s,
 * lateralVelocity is road-right m/s, heading/yawRate are radians and rad/s.
 * Collision code must update both forward-speed aliases together. No lane snap
 * or hard boundary pose reset is applied here; the contact solver owns rails.
 * @param {object} state - Mutable run state.
 * @param {number} steering - Signed continuous steering request in [-1,1].
 * @param {number} dt - Positive elapsed seconds; at most .1 s per call.
 * @returns {number} Actual road-forward centre travel in metres.
 */
export function updatePlayerPath(state, steering, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const input = clamp(finite(steering), -1, 1);
  let remaining = Math.min(dt, PLAYER_HANDLING.maxFrame), travelled = 0;
  while (remaining > 1e-9) {
    const step = Math.min(remaining, PLAYER_HANDLING.maxStep);
    travelled += playerPathStep(state, input, step);
    remaining -= step;
  }
  return travelled;
}

/**
 * Advance the simulation-owned body pose from actual acceleration and touchdown.
 * Renderers only apply these fields, so pause, retries and different refresh rates
 * cannot create extra suspension motion. No periodic road-bob term is present.
 * @param {object} state - Run state, mutated with bodyPitch/bodyRoll/bodyHeave and velocities.
 * @param {number} dt - Positive simulation seconds.
 * @returns {void} Values are bounded again by the actual player rig's combined-travel stop.
 */
export function updatePlayerDynamics(state, dt) {
  const grounded = (state.altitude || 0) < .02 && !state.rolling;
  const pitch = grounded ? clamp((state.acceleration || 0) * .0011, -.016, .013) : 0;
  const roll = grounded ? clamp((state.lateralAcceleration || 0) * .002, -.016, .016) : 0;
  const heave = grounded ? -clamp(state.touchdownPulse || 0, 0, 1) * .012 : 0;
  [state.bodyPitch, state.bodyPitchVelocity] = dampedSpring(state.bodyPitch||0,state.bodyPitchVelocity||0,pitch,12,dt);
  [state.bodyRoll, state.bodyRollVelocity] = dampedSpring(state.bodyRoll||0,state.bodyRollVelocity||0,roll,11,dt);
  [state.bodyHeave, state.bodyHeaveVelocity] = dampedSpring(state.bodyHeave||0,state.bodyHeaveVelocity||0,heave,16,dt);
}
