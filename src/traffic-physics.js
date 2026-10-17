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
  return roadYaw(-car.z - (trafficDefinition(car.kind).articulated ? 5 : 0), distance)-(car.heading||0);
}
export function trailerTargetYaw(car, distance = 0) {
  const spec = trafficDefinition(car.kind);
  if (!spec.articulated) return 0;
  const z = -car.z;
  return clamp(roadYaw(z + 4, distance) - roadYaw(z - 5, distance), -.12, .12);
}
export function trailerYaw(car, distance = 0) {
  return Number.isFinite(car.trailerAngle) ? clamp(car.trailerAngle,-.12,.12) : trailerTargetYaw(car,distance);
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
  const spec = trafficDefinition(car.kind), z = -car.z, x = (trafficLateral(car) - 1) * LANE_WIDTH + roadCurve(z, distance), yaw = trafficYaw(car, distance);
  if (!spec.articulated) return [rectangle(x, z, spec.width, spec.length, yaw)];
  // Cab/tractor occupy the nose; the trailer swivels at the real model hitch.
  const tractorLength = 6.2, tractorCenter = -spec.length / 2 + tractorLength / 2;
  const trailerLength = spec.length / 2 - spec.hitchZ, local = trailerLength / 2;
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
