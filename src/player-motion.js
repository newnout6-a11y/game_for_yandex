import { clamp } from './util.js';
import { dampedSpring } from './traffic-motion.js';

// Measured from the normalized authored Rocket axle centres. SI metres/radians.
export const PLAYER_WHEELBASE = 2.9006259276394206;
export const PLAYER_REAR_OFFSET = 1.4413350520479036;
export const PLAYER_MAX_LATERAL_ACCELERATION = 10;
export const PLAYER_BODY_TRAVEL = .018;

// Arcade response targets, not measured factory handling or a tyre-force model.
// Lateral intent stays predictable as forward speed rises; axle geometry below
// remains the only source of translation. No lane-centre attraction is applied.
export const PLAYER_HANDLING = Object.freeze({
  lateralSpeed: 4.2, maxHeading: .26, headingResponse: 9, neutralResponse: 12,
  maxSteerAngle: .3, maxSteerRate: 2.2, steerLockTime: .035,
  edgeResponse: 3, edgeMargin: .04, minX: -.24, maxX: 2.24,
  laneWidth: 3.5, maxStep: 1 / 120, maxFrame: .1,
});
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bounded = (value, low, high, fallback) => Number.isFinite(value) && value >= low && value <= high ? value : fallback;

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
 * Resolve a continuous requested heading from lateral speed, never a target lane.
 * A small road-edge approach zone reduces only outward intent. It does not move
 * the car or correct toward a lane centre, and inward corrections remain free.
 * @param {object} state - Current speed and lateral position in lane units.
 * @param {number} input - Finite normalized steering axis.
 * @returns {number} Requested road-relative heading in radians.
 */
export function playerTargetHeading(state, input) {
  const tuning = PLAYER_HANDLING, speed = Math.max(0, finite(state.speed));
  const x = finite(state.x, 1), direction = Math.sign(input);
  const edgeDistance = (direction > 0 ? tuning.maxX - x : x - tuning.minX) * tuning.laneWidth;
  const lateralSpeed = Math.min(Math.abs(input) * tuning.lateralSpeed,
    Math.max(0, edgeDistance - tuning.edgeMargin) * tuning.edgeResponse);
  return direction * Math.min(Math.abs(input) * tuning.maxHeading,
    Math.asin(Math.min(1, lateralSpeed / Math.max(speed, .001))));
}

/** Integrate one bounded steering step through the congruent front/rear axle arc. */
function playerPathStep(state, input, dt) {
  const tuning = PLAYER_HANDLING, speed = Math.max(0, finite(state.speed));
  const wheelbase = bounded(state.playerWheelbase, .5, 6, PLAYER_WHEELBASE);
  const lateralLimit = bounded(state.maxLateralAcceleration, 1, 20, PLAYER_MAX_LATERAL_ACCELERATION);
  const slew = clamp(finite(state.steeringSlewMultiplier, 1), .5, 1.3);
  const heading = finite(state.heading), targetHeading = playerTargetHeading(state, input);
  const maxCurvature = Math.min(Math.tan(tuning.maxSteerAngle) / wheelbase, lateralLimit / Math.max(1, speed * speed));
  const maxAngle = Math.atan(maxCurvature * wheelbase);
  // Release actively countersteers through the wheels; there is no side-velocity
  // damping, yaw snap or independent translation hidden behind the heading aid.
  const response = Math.abs(input) < .001 ? tuning.neutralResponse : tuning.headingResponse;
  const wantedCurvature = speed > .15 ? (targetHeading - heading) * response / speed : input * maxCurvature;
  const targetAngle = Math.atan(clamp(wantedCurvature, -maxCurvature, maxCurvature) * wheelbase);
  // Limit the time to current speed-dependent lock, rather than applying a slow
  // parking rack that becomes effectively instantaneous at highway-sized angles.
  const rate = Math.min(tuning.maxSteerRate, maxAngle / tuning.steerLockTime) * slew;
  const angle = finite(state.steerAngle);
  state.steerAngle = clamp(angle + clamp(targetAngle - angle, -rate * dt, rate * dt), -maxAngle, maxAngle);
  state.curvature = Math.tan(state.steerAngle) / wheelbase;
  const arc = integratePlayerArc(heading, speed, state.curvature, dt, state.playerRearOffset);
  const nextX = finite(state.x, 1) + arc.x / tuning.laneWidth;
  state.x = clamp(nextX, tuning.minX, tuning.maxX);
  state.heading = arc.heading;
  state.yawRate = arc.yawRate;
  state.lateralAcceleration = speed * arc.yawRate;
  state.rearDistance = finite(state.rearDistance) + arc.rearDistance;
  state.wheelDistance = state.rearDistance;
  // Last-resort road boundary, normally avoided by the continuous edge approach.
  if (nextX !== state.x) { state.heading = 0; state.steerAngle = 0; state.curvature = 0; state.yawRate = 0; state.lateralAcceleration = 0; }
  state.lane = clamp(Math.round(state.x), 0, 2);
  return arc.forward;
}

/**
 * Apply bounded lateral-intent assistance through the real front-wheel angle.
 * This is accessible arcade handling, not a tyre-force simulator. Position
 * follows the exact no-slip axle arc, including while the wheels countersteer.
 * The same <=1/120 s integration is used for direct and game-loop callers.
 * @param {object} state - Mutable run state, x in 3.5-metre lanes, speed in m/s.
 * @param {number} steering - Signed continuous steering request in [-1,1].
 * @param {number} dt - Positive elapsed seconds; at most .1 s is accepted per call.
 * @returns {number} Actual forward centre travel in metres for scrolling consumers.
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
