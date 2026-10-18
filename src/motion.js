import { clamp, lerp } from './util.js';
/**
 * Exponentially approaches a target using a frame-rate-independent response.
 * Negative elapsed time is treated as zero; a nonnegative rate avoids overshoot.
 * @param {number} value - Current scalar value.
 * @param {number} target - Desired value in the same units.
 * @param {number} rate - Response coefficient in inverse seconds.
 * @param {number} dt - Elapsed seconds.
 * @returns {number} Interpolated scalar without mutating its inputs.
 */
export const damp = (value, target, rate, dt) => lerp(value, target, 1-Math.exp(-rate*Math.max(0,dt)));
/**
 * Updates a fixed-road chase camera, deliberately ignoring lateral steering.
 * Menu/phone presets set camera and look-at coordinates in scene metres, with
 * negative z ahead and positive y up; speed/boost widen field of view in degrees.
 * Finite existing fields damp toward targets; missing/non-finite fields snap.
 * @param {Object} view - Mutable camera-position, look-at and fov scalars.
 * @param {Object} state - Run state supplying speed in m/s and boosting.
 * @param {Object} [options={}] - Phone/menu flags and elapsed dt in seconds.
 * @returns {Object} The same mutated view object.
 */
export function updateChase(view, state, { phone = false, menu = false, dt = 0, reducedMotion = false } = {}) {
  const speed = clamp((state.speed || 0)/52,0,1.3);
  const target = menu
    ? { x:phone?-5:-6, y:phone?3.7:3.1, z:phone?11:9.2, lookX:phone?0:-1.1, lookY:1, lookZ:-13, fov:phone?62:53 }
    : { x:reducedMotion?0:clamp(-(state.lateralAcceleration||0)*.009,-.09,.09), y:phone?5.4:3.8, z:(phone?11.7:9.2)+(reducedMotion?0:clamp(-(state.acceleration||0)*.008,-.12,.12)), lookX:0, lookY:1, lookZ:-25, fov:(phone?62:53)+speed*2+(state.boosting?1.5:0) };
  // Steering never rotates or translates the camera. Delta-based damping also
  // keeps start, boost and resize transitions independent of the frame rate.
  for (const key of Object.keys(target)) view[key] = Number.isFinite(view[key]) ? damp(view[key],target[key],key==='fov'?2.4:5,dt) : target[key];
  return view;
}
