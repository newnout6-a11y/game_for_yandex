import { clamp } from './util.js';
import { dampedSpring } from './traffic-motion.js';

// Measured from the normalized authored Rocket axle centres. SI metres/radians.
export const PLAYER_WHEELBASE = 2.9006259276394206;
export const PLAYER_REAR_OFFSET = 1.4413350520479036;
export const PLAYER_MAX_LATERAL_ACCELERATION = 10;
export const PLAYER_BODY_TRAVEL = .018;

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
export function integratePlayerArc(heading, speed, curvature, dt) {
  const h = Number.isFinite(heading) ? heading : 0;
  const k = Number.isFinite(curvature) ? curvature : 0;
  const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const v = Math.max(0, Number.isFinite(speed) ? speed : 0) / Math.hypot(1, k * PLAYER_REAR_OFFSET);
  const rearDistance = v * step, turn = rearDistance * k, next = h + turn;
  let x, forward;
  if (Math.abs(k) < 1e-8) { x = Math.sin(h) * rearDistance; forward = Math.cos(h) * rearDistance; }
  else { x = (Math.cos(h) - Math.cos(next)) / k; forward = (Math.sin(next) - Math.sin(h)) / k; }
  x += PLAYER_REAR_OFFSET * (Math.sin(next) - Math.sin(h));
  forward += PLAYER_REAR_OFFSET * (Math.cos(next) - Math.cos(h));
  return { heading: next, x, forward, rearDistance, yawRate: v * k };
}

/**
 * Apply bounded road-heading assistance through the real front-wheel steer angle.
 * This remains an arcade heading aid, not a tyre-force simulator. Position follows
 * the no-slip axle arc instead of sliding the centre independently of wheel yaw.
 * @param {object} state - Mutable run state, x in 3.5-metre lane units and speed in m/s.
 * @param {number} steering - Signed requested steering in [-1,1].
 * @param {number} dt - Positive simulation substep seconds.
 * @returns {number} Actual forward centre displacement in metres for all scrolling consumers.
 */
export function updatePlayerPath(state, steering, dt) {
  const speed = Math.max(0, state.speed || 0), input = clamp(Number.isFinite(steering) ? steering : 0, -1, 1);
  const targetHeading = input * .201 / (1 + Math.max(0, speed - 30) * .012);
  const maxCurvature = Math.min(Math.tan(.3) / PLAYER_WHEELBASE, PLAYER_MAX_LATERAL_ACCELERATION / Math.max(1, speed * speed));
  const wantedCurvature = speed > .15 ? (targetHeading - (state.heading || 0)) * 5 / speed : input * maxCurvature;
  const targetAngle = Math.atan(clamp(wantedCurvature, -maxCurvature, maxCurvature) * PLAYER_WHEELBASE);
  state.steerAngle = (state.steerAngle || 0) + clamp(targetAngle - (state.steerAngle || 0), -1.25 * dt/(1+speed/25), 1.25 * dt/(1+speed/25));
  // A speed increase cannot retain an angle that exceeds the lateral budget.
  state.steerAngle = clamp(state.steerAngle, -Math.atan(maxCurvature * PLAYER_WHEELBASE), Math.atan(maxCurvature * PLAYER_WHEELBASE));
  state.curvature = Math.tan(state.steerAngle) / PLAYER_WHEELBASE;
  const arc = integratePlayerArc(state.heading || 0, speed, state.curvature, dt);
  const nextX = state.x + arc.x / 3.5;
  state.x = clamp(nextX, -.24, 2.24);
  state.heading = arc.heading;
  state.yawRate = arc.yawRate;
  state.lateralAcceleration = speed * arc.yawRate;
  state.rearDistance = (state.rearDistance || 0) + arc.rearDistance;
  state.wheelDistance = state.rearDistance;
  if (nextX !== state.x) { state.heading = 0; state.yawRate = 0; state.lateralAcceleration = 0; }
  state.lane = clamp(Math.round(state.x), 0, 2);
  return arc.forward;
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
