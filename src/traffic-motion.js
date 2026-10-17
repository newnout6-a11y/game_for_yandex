import { trafficPathCurvature } from './traffic-physics.js';
import { trafficDefinition } from './traffic-catalog.js';
/**
 * Limits a dynamics scalar to inclusive bounds without mutation.
 * @param {number} x - Value to constrain.
 * @param {number} a - Lower bound.
 * @param {number} b - Upper bound in the same units.
 * @returns {number} The bounded value.
 */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Response to actual acceleration/curvature, never a time-driven idle wobble.
export const TRAFFIC_DYNAMICS=Object.freeze({
 passenger:Object.freeze({acceleration:2.8,braking:6.5,pitch:.007,roll:.015,frequency:8,damping:.72}),
 commercial:Object.freeze({acceleration:1.8,braking:5.4,pitch:.008,roll:.020,frequency:6.5,damping:.70}),
 freight:Object.freeze({acceleration:1.15,braking:4.8,pitch:.007,roll:.018,frequency:5,damping:.78}),
 special:Object.freeze({acceleration:1.4,braking:5,pitch:.0075,roll:.019,frequency:5.5,damping:.75}),
});
/**
 * Looks up category-specific acceleration, braking and suspension response.
 * Unknown kinds use the catalogue's sedan fallback.
 * @param {string} kind - Vehicle kind.
 * @returns {Readonly<Object>} Shared frozen dynamics profile with SI acceleration
 * limits, angular response gains, natural frequency and damping ratio.
 */
export const trafficDynamics=kind=>TRAFFIC_DYNAMICS[trafficDefinition(kind).category];
/**
 * Evaluates the road parabola's signed curvature at a rendered longitudinal point.
 * The slope sample is clamped to the ahead-of-player half-road; the numerator
 * retains the current road's quadratic coefficient even for nonnegative z.
 * @param {number} z - Scene metres, negative ahead of the player.
 * @param {number} distance - Player's accumulated travel in metres.
 * @returns {number} Signed road curvature in inverse metres.
 */
export function curvatureAt(z,distance){const a=Math.sin(distance/1100+.35)*.00055;return 2*a/(1+(2*a*Math.min(0,z))**2)**1.5;}
/**
 * Computes an individual front-wheel Ackermann angle, capped at +/-0.6 radians.
 * The negative sign converts path curvature into the model's wheel-yaw convention.
 * @param {number} curvature - Signed rear-axle path curvature in inverse metres.
 * @param {number} wheelbase - Front-to-rear axle spacing in metres.
 * @param {number} lateral - Wheel's lateral offset in metres, positive right.
 * @returns {number} Local wheel yaw in radians.
 */
export function steeringForWheel(curvature,wheelbase,lateral){return clamp(-Math.atan(wheelbase*curvature/(1-lateral*curvature)),-.6,.6);}
/**
 * Analytically advances a critically damped scalar spring toward a constant target.
 * Nonpositive or invalid dt returns the original pair; inputs are never mutated.
 * @param {number} value - Current displacement, commonly radians.
 * @param {number} velocity - Displacement units per second.
 * @param {number} target - Desired displacement in matching units.
 * @param {number} frequency - Natural angular frequency in inverse seconds.
 * @param {number} dt - Elapsed seconds.
 * @returns {number[]} Updated [displacement, velocity].
 */
export function dampedSpring(value,velocity,target,frequency,dt){
 if(!(dt>0))return[value,velocity];
 const y=value-target,c=velocity+frequency*y,e=Math.exp(-frequency*dt);
 return[target+(y+c*dt)*e,(velocity-frequency*c*dt)*e];
}
/**
 * Analytically advances an underdamped spring with a constant target over dt.
 * Requires positive frequency and a damping ratio below one so the oscillatory
 * solution is defined; nonpositive/invalid dt leaves the returned pair unchanged.
 * @param {number} value - Current suspension angle in radians.
 * @param {number} velocity - Angular velocity in rad/s.
 * @param {number} target - Equilibrium angle in radians.
 * @param {number} frequency - Natural angular frequency in inverse seconds.
 * @param {number} damping - Damping ratio, normally in [0, 1).
 * @param {number} dt - Elapsed seconds.
 * @returns {number[]} New [angle, angular velocity], without input mutation.
 */
export function suspensionSpring(value,velocity,target,frequency,damping,dt){
 if(!(dt>0))return[value,velocity];
 const a=frequency*damping,w=frequency*Math.sqrt(1-damping*damping),y=value-target,b=(velocity+a*y)/w;
 const c=Math.cos(w*dt),sn=Math.sin(w*dt),e=Math.exp(-a*dt),q=y*c+b*sn;
 return[target+e*q,e*(-a*q-y*w*sn+b*w*c)];
}
/**
 * Creates independent level-body suspension state and a zero wheel-distance clock.
 * @returns {Object} Mutable pitch/roll in radians, angular velocities in rad/s
 * and accumulated travelled distance in metres.
 */
export function createTrafficMotion(){return{pitch:0,pitchVelocity:0,roll:0,rollVelocity:0,distance:0};}
/**
 * Drives body pitch/roll from actual longitudinal and lateral acceleration.
 * Positive acceleration targets positive pitch; signed path curvature controls
 * roll. Targets are travel-limited, then category springs update motion in place.
 * Uses authoritative travelDistance when finite, otherwise integrates speed.
 * @param {Object} motion - Mutable suspension state from createTrafficMotion.
 * @param {Object} item - Traffic kind, pose, speed and acceleration in SI units.
 * @param {number} distance - Player's accumulated travel in metres.
 * @param {number} wheelbase - Positive axle separation in metres for pitch limits.
 * @param {number} dt - Elapsed simulation/render interval in seconds.
 * @returns {Object} The same updated motion object.
 */
export function updateTrafficMotion(motion,item,distance,wheelbase,dt){
 const profile=trafficDynamics(item.kind),k=curvatureAt(-item.z,distance),speed=Math.max(0,item.speed||0);
 // Bound suspension travel rather than allowing long trucks to pitch through asphalt.
 const targetPitch=clamp((item.acceleration||0)*profile.pitch,-.13/wheelbase,.13/wheelbase);
 const lateral=Number.isFinite(item.laneCurvature)?speed*speed*trafficPathCurvature(item,distance):speed*speed*k+(item.lateralAcceleration||0);
 const targetRoll=clamp(lateral*profile.roll,-.052,.052);
 [motion.pitch,motion.pitchVelocity]=suspensionSpring(motion.pitch,motion.pitchVelocity,targetPitch,profile.frequency,profile.damping,dt);
 [motion.roll,motion.rollVelocity]=suspensionSpring(motion.roll,motion.rollVelocity,targetRoll,profile.frequency,profile.damping,dt);
 if(Number.isFinite(item.travelDistance))motion.distance=item.travelDistance;
 else motion.distance+=speed*Math.max(0,dt);
 return motion;
}

// A suspension bump stop limits combined corner compression, not wheel steer.
// Use the complete wheel-adjacent spherical envelope, so pitch and roll cannot
// independently consume the same small arch clearance twice.
/**
 * Bounds downward body motion across wheel-adjacent spherical clearance envelopes.
 * Combines pitch and roll, including 0.08 m padding around each measured wheel,
 * so both rotations cannot independently consume the same arch clearance.
 * @param {number} pitch - Body rotation about local x in radians.
 * @param {number} roll - Body rotation about local z in radians.
 * @param {Object[]} wheels - Rest centres and radii in the pivot's parent frame.
 * @param {Object} pivot - Body rotation centre with x/y/z coordinates in metres.
 * @returns {number} Maximum nonnegative compression in metres; inputs are read-only.
 */
export function suspensionCompression(pitch,roll,wheels,pivot){
 const cx=Math.cos(pitch),sx=Math.sin(pitch),cz=Math.cos(roll),sz=Math.sin(roll);
 const a=sz*cx,b=cz*cx-1,c=-sx,gradient=Math.hypot(a,b,c);let compression=0;
 for(const w of wheels){const q=w.center;
  const drop=-(a*(q.x-pivot.x)+b*(q.y-pivot.y)+c*(q.z-pivot.z))+(w.radius+.08)*gradient;
  compression=Math.max(compression,drop);
 }
 return compression;
}
/**
 * Scales combined pitch/roll to keep the measured arch-compression budget intact.
 * Binary-searches a common scale, mutates angles, and stops angular velocities
 * that would push further into the limit. Nonpositive/missing allowance disables
 * the stop; steering angles and wheel positions are never changed.
 * @param {Object} motion - Mutable pitch/roll angles and their angular velocities.
 * @param {Object[]} wheels - Rest wheel centres/radii in metres.
 * @param {Object} pivot - Suspension pivot in the wheel-centre coordinate frame.
 * @param {?number} allowance - Maximum permitted compression in metres.
 * @returns {number} Applied common angle scale in [0, 1]; one means unchanged.
 */
export function limitTrafficSuspension(motion,wheels,pivot,allowance){
 if(!(allowance>0))return 1;
 if(suspensionCompression(motion.pitch,motion.roll,wheels,pivot)<=allowance)return 1;
 let low=0,high=1;for(let i=0;i<24;i++){const scale=(low+high)/2;
  if(suspensionCompression(motion.pitch*scale,motion.roll*scale,wheels,pivot)<=allowance)low=scale;else high=scale;
 }
 motion.pitch*=low;motion.roll*=low;
 if(motion.pitchVelocity*motion.pitch>0)motion.pitchVelocity=0;
 if(motion.rollVelocity*motion.roll>0)motion.rollVelocity=0;
 return low;
}
