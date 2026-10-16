import { clamp, lerp } from './util.js';
export const damp = (value, target, rate, dt) => lerp(value, target, 1-Math.exp(-rate*Math.max(0,dt)));
export function updateChase(view, state, { phone = false, menu = false, dt = 0 } = {}) {
  const speed = clamp((state.speed || 0)/52,0,1.3);
  const target = menu
    ? { x:phone?-5:-6, y:phone?3.7:3.1, z:phone?11:9.2, lookX:phone?0:-1.1, lookY:1, lookZ:-13, fov:phone?62:53 }
    : { x:0, y:phone?5.4:3.8, z:phone?11.7:9.2, lookX:0, lookY:1, lookZ:-25, fov:(phone?62:53)+speed*2+(state.boosting?1.5:0) };
  // Steering never rotates or translates the camera. Delta-based damping also
  // keeps start, boost and resize transitions independent of the frame rate.
  for (const key of Object.keys(target)) view[key] = Number.isFinite(view[key]) ? damp(view[key],target[key],key==='fov'?2.4:5,dt) : target[key];
  return view;
}
