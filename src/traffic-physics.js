import { trafficLateral } from './traffic-behavior.js';
import { trafficDefinition } from './traffic-catalog.js';

export const PLAYER_BOUNDS = Object.freeze({ length: 4.7, width: 2.256, height: 1.218 });
export const LANE_WIDTH = 3.5;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function roadCurve(z, distance = 0) {
  return Math.sin(distance / 1100 + .35) * .00055 * Math.min(z, 0) ** 2;
}
export function roadYaw(z, distance = 0) {
  return -Math.atan((roadCurve(z - 1, distance) - roadCurve(z + 1, distance)) / 2);
}
export function trafficYaw(car, distance = 0) {
  const rear=trafficDefinition(car.kind).rearAxleZ,h=Number.isFinite(car.heading)?car.heading:0;
  const slope=Math.tan(roadYaw(-car.z+rear,distance)),c=Math.cos(h);
  // Lane offsets add in horizontal road coordinates, so compose slopes, not
  // angles. atan2 also preserves full-circle inspection/turning trajectories.
  return Math.atan2(slope*c-Math.sin(h),c);
}
export function trafficPathCurvature(car,distance=0){
  const axleZ=-car.z+trafficDefinition(car.kind).rearAxleZ,h=Number.isFinite(car.heading)?car.heading:0;
  const slope=Math.tan(roadYaw(axleZ,distance)),c=Math.cos(h),s=Math.sin(h);
  const roadSecond=axleZ<0?2*Math.sin(distance/1100+.35)*.00055:0;
  const lane=Number.isFinite(car.laneCurvature)?car.laneCurvature:0;
  // Differentiate the composed rear-axle tangent with respect to lane-path
  // arc length, then divide by the composed path-speed cubed.
  return (lane+roadSecond*c*c*c)/Math.hypot(s-slope*c,c)**3;
}
// The trajectory describes the non-steering rear axle (or tandem bogie), not
// the arbitrary model origin. Rotate the body around that contact reference.
export function trafficPose(car,distance=0){
  const rear=trafficDefinition(car.kind).rearAxleZ,axleZ=-car.z+rear,yaw=trafficYaw(car,distance);
  return {x:(trafficLateral(car)-1)*LANE_WIDTH+roadCurve(axleZ,distance)-Math.sin(yaw)*rear,
    z:axleZ-Math.cos(yaw)*rear,yaw};
}
export function trailerTargetYaw(car, distance = 0) {
  const spec = trafficDefinition(car.kind);
  if (!spec.articulated) return 0;
  const z = -car.z;
  return clamp(roadYaw(z + 4, distance) - roadYaw(z - 5, distance), -.12, .12);
}
export function trailerYaw(car, distance = 0) {
  return Number.isFinite(car.trailerAngle) ? car.trailerAngle : trailerTargetYaw(car,distance);
}
// Kinematic trailer: rear bogie follows the moving kingpin with zero lateral
// velocity at its axle centre. The renderer and collision shape read the same
// relative yaw; there is no spring pulling the trailer back to tractor yaw.
export function trafficHitch(car, distance) {
  const spec=trafficDefinition(car.kind),pose=trafficPose(car,distance),yaw=pose.yaw;
  return {x:pose.x+Math.sin(yaw)*spec.hitchZ,z:pose.z+Math.cos(yaw)*spec.hitchZ,yaw};
}
export function integrateTrailerYaw(yaw,dx,dz,length) {
  // Implicit midpoint integration of dYaw = -(dH dot axleRight)/wheelbase.
  // It is stable at the fixed simulation step and independent of frame rate.
  let change=(-dx*Math.cos(yaw)+dz*Math.sin(yaw))/length;
  for(let i=0;i<4;i++){const mid=yaw+change*.5;change=(-dx*Math.cos(mid)+dz*Math.sin(mid))/length;}
  return yaw+change;
}
export function updateTrailerKinematics(car,distance,dt) {
  const spec=trafficDefinition(car.kind);if(!spec.articulated||!(dt>0))return;
  const hitch=trafficHitch(car,distance),length=spec.trailerAxleDistance;
  let state=car.trailerState,yaw;
  const delta=state?distance-state.distance:0;
  if(!state||!Number.isFinite(delta)||Math.abs(delta)>10){
    yaw=hitch.yaw+trailerTargetYaw(car,distance);
    car.trailerTravelDistance=car.travelDistance||0;
  } else if((car.speed||0)<1e-8){
    // A stopped vehicle may be seen from a moving road frame, but must not
    // straighten its hitch or spin its trailer wheels while stationary.
    yaw=hitch.yaw+trailerYaw(car,distance);car.trailerCurvature=0;
  } else {
    const transport=(x,z)=>({x:x+roadCurve(z+delta,distance)-roadCurve(z,state.distance),z:z+delta});
    const oldHitch=transport(state.hitchX,state.hitchZ),oldAxle=transport(state.axleX,state.axleZ);
    const oldYaw=Math.atan2(oldAxle.x-oldHitch.x,oldAxle.z-oldHitch.z);
    yaw=integrateTrailerYaw(oldYaw,hitch.x-oldHitch.x,hitch.z-oldHitch.z,length);
    // Physical travel limit is a guard for impossible external poses, not the
    // cab-clearance fix; the actual Blender sweep clears the whole envelope.
    const angle=Math.atan2(Math.sin(yaw-hitch.yaw),Math.cos(yaw-hitch.yaw));
    yaw=hitch.yaw+clamp(angle,-spec.maxArticulation,spec.maxArticulation);
    const axleX=hitch.x+Math.sin(yaw)*length,axleZ=hitch.z+Math.cos(yaw)*length;
    const travel=Math.hypot(axleX-oldAxle.x,axleZ-oldAxle.z);
    car.trailerCurvature=travel>1e-8?-Math.atan2(Math.sin(yaw-oldYaw),Math.cos(yaw-oldYaw))/travel:0;
    car.trailerTravelDistance=(car.trailerTravelDistance||0)+travel;
  }
  if(!state||(car.speed||0)>=1e-8)car.trailerAngle=Math.atan2(Math.sin(yaw-hitch.yaw),Math.cos(yaw-hitch.yaw));
  car.trailerState={distance,hitchX:hitch.x,hitchZ:hitch.z,axleX:hitch.x+Math.sin(yaw)*length,axleZ:hitch.z+Math.cos(yaw)*length,yaw};
}
export function playerBottom(altitude, rollAngle = 0) {
  // The render pivot is 0.58m above the road. Include the whole rolled width,
  // not a constant low passenger-car roof height for every vehicle.
  const c = Math.cos(rollAngle), s = Math.sin(rollAngle), h = PLAYER_BOUNDS.height;
  return Math.max(0, altitude + .58 + (h / 2 - .58) * c - Math.abs(c) * h / 2 - Math.abs(s) * PLAYER_BOUNDS.width / 2);
}
export function playerTrafficDepth(car) { return (PLAYER_BOUNDS.length + trafficDefinition(car.kind).length) / 2; }
export function playerTrafficWidth(car) { return (PLAYER_BOUNDS.width + trafficDefinition(car.kind).width) / 2; }

function rectangle(x, z, width, length, yaw) {
  return { x, z, halfWidth: width / 2, halfLength: length / 2,
    right: [Math.cos(yaw), -Math.sin(yaw)], forward: [Math.sin(yaw), Math.cos(yaw)] };
}
export function rectanglesOverlap(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const axis of [a.right, a.forward, b.right, b.forward]) {
    const projected = Math.abs(dx * axis[0] + dz * axis[1]);
    const extent = r => r.halfWidth * Math.abs(r.right[0] * axis[0] + r.right[1] * axis[1])
      + r.halfLength * Math.abs(r.forward[0] * axis[0] + r.forward[1] * axis[1]);
    if (projected >= extent(a) + extent(b)) return false;
  }
  return true;
}
export function trafficCollisionParts(car, distance) {
  const spec = trafficDefinition(car.kind), {x,z,yaw}=trafficPose(car,distance);
  if (!spec.articulated) return [rectangle(x, z, spec.width, spec.length, yaw)];
  // Cab/tractor occupy the nose; the trailer swivels at the real model hitch.
  const tractorLength = 6.2, tractorCenter = -spec.length / 2 + tractorLength / 2;
  const trailerLength = spec.trailerRearZ-spec.trailerFrontZ, local = (spec.trailerRearZ+spec.trailerFrontZ)/2-spec.hitchZ;
  const ty = yaw + trailerYaw(car, distance);
  return [
    rectangle(x + Math.sin(yaw) * tractorCenter, z + Math.cos(yaw) * tractorCenter, spec.width, tractorLength, yaw),
    rectangle(x + Math.sin(yaw) * spec.hitchZ + Math.sin(ty) * local,
      z + Math.cos(yaw) * spec.hitchZ + Math.cos(ty) * local, spec.width, trailerLength, ty),
  ];
}
export function trafficHitsPlayer(car, state, previousX = state.x, previousZ = car.z) {
  const spec = trafficDefinition(car.kind);
  if (playerBottom(state.altitude, state.rollAngle) >= spec.height + .08) return false;
  // At 120Hz, sweep translation conservatively between samples. This prevents
  // narrow corner misses without replacing the vehicle by a lane-wide box.
  const x = ((state.x + previousX) / 2 - 1) * LANE_WIDTH;
  const roll = state.rollAngle || 0;
  const sweptWidth = Math.abs(Math.cos(roll)) * PLAYER_BOUNDS.width + Math.abs(Math.sin(roll)) * PLAYER_BOUNDS.height + Math.abs(state.x - previousX) * LANE_WIDTH;
  const sweptLength = PLAYER_BOUNDS.length + Math.abs(car.z - previousZ);
  const player = rectangle(x, 0, sweptWidth, sweptLength, -(state.heading || 0));
  const current=trafficLateral(car),prior=Number.isFinite(car.previousLateral)?car.previousLateral:current;
  return trafficCollisionParts({ ...car, x:(current+prior)/2, z: (car.z + previousZ) / 2 }, state.distance).some(part=>{part.halfWidth+=Math.abs(current-prior)*LANE_WIDTH/2;return rectanglesOverlap(player,part);});
}
