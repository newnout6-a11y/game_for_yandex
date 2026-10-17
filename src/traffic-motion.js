import { trafficPathCurvature } from './traffic-physics.js';
import { trafficDefinition } from './traffic-catalog.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Response to actual acceleration/curvature, never a time-driven idle wobble.
export const TRAFFIC_DYNAMICS=Object.freeze({
 passenger:Object.freeze({acceleration:2.8,braking:6.5,pitch:.007,roll:.015,frequency:8,damping:.72}),
 commercial:Object.freeze({acceleration:1.8,braking:5.4,pitch:.008,roll:.020,frequency:6.5,damping:.70}),
 freight:Object.freeze({acceleration:1.15,braking:4.8,pitch:.007,roll:.018,frequency:5,damping:.78}),
 special:Object.freeze({acceleration:1.4,braking:5,pitch:.0075,roll:.019,frequency:5.5,damping:.75}),
});
export const trafficDynamics=kind=>TRAFFIC_DYNAMICS[trafficDefinition(kind).category];
export function curvatureAt(z,distance){const a=Math.sin(distance/1100+.35)*.00055;return 2*a/(1+(2*a*Math.min(0,z))**2)**1.5;}
export function steeringForWheel(curvature,wheelbase,lateral){return clamp(-Math.atan(wheelbase*curvature/(1-lateral*curvature)),-.6,.6);}
export function dampedSpring(value,velocity,target,frequency,dt){
 if(!(dt>0))return[value,velocity];
 const y=value-target,c=velocity+frequency*y,e=Math.exp(-frequency*dt);
 return[target+(y+c*dt)*e,(velocity-frequency*c*dt)*e];
}
export function suspensionSpring(value,velocity,target,frequency,damping,dt){
 if(!(dt>0))return[value,velocity];
 const a=frequency*damping,w=frequency*Math.sqrt(1-damping*damping),y=value-target,b=(velocity+a*y)/w;
 const c=Math.cos(w*dt),sn=Math.sin(w*dt),e=Math.exp(-a*dt),q=y*c+b*sn;
 return[target+e*q,e*(-a*q-y*w*sn+b*w*c)];
}
export function createTrafficMotion(){return{pitch:0,pitchVelocity:0,roll:0,rollVelocity:0,distance:0};}
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
export function suspensionCompression(pitch,roll,wheels,pivot){
 const cx=Math.cos(pitch),sx=Math.sin(pitch),cz=Math.cos(roll),sz=Math.sin(roll);
 const a=sz*cx,b=cz*cx-1,c=-sx,gradient=Math.hypot(a,b,c);let compression=0;
 for(const w of wheels){const q=w.center;
  const drop=-(a*(q.x-pivot.x)+b*(q.y-pivot.y)+c*(q.z-pivot.z))+(w.radius+.08)*gradient;
  compression=Math.max(compression,drop);
 }
 return compression;
}
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
