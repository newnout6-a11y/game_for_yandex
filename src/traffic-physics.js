import { trafficLateral } from './traffic-behavior.js';
import { trafficDefinition } from './traffic-catalog.js';
import { PLAYER_BOUNDS } from './player-spec.js';

export { PLAYER_BOUNDS };
export const LANE_WIDTH = 3.5;
/**
 * Bounds a scalar inclusively, used here for articulation angle limits.
 * @param {number} x - Requested value.
 * @param {number} a - Lower bound.
 * @param {number} b - Upper bound in matching units.
 * @returns {number} Clamped value without modifying state.
 */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/**
 * Evaluates the scene's slowly varying quadratic road offset.
 * Only negative z (ahead of the player) bends; the road at/behind z=0 stays centred.
 * @param {number} z - Scene longitudinal position in metres, negative ahead.
 * @param {number} [distance=0] - Player's accumulated travel in metres.
 * @returns {number} Horizontal road-centre offset in metres, positive right.
 */
export function roadCurve(z, distance = 0) {
  return Math.sin(distance / 1100 + .35) * .00055 * Math.min(z, 0) ** 2;
}
/**
 * Samples the road tangent using a symmetric two-metre finite difference.
 * @param {number} z - Scene longitudinal position in metres, negative ahead.
 * @param {number} [distance=0] - Player's accumulated travel in metres.
 * @returns {number} Model yaw in radians; a negative yaw points a -Z-facing
 * vehicle toward positive scene x.
 */
export function roadYaw(z, distance = 0) {
  return -Math.atan((roadCurve(z - 1, distance) - roadCurve(z + 1, distance)) / 2);
}
/**
 * Composes road slope and lane-path heading at the non-steering rear axle.
 * Adds slopes rather than angles because lane offsets are horizontal; atan2
 * preserves quadrant information for full-circle poses without mutating the car.
 * @param {Object} car - Kind, relative z (metres ahead), heading (positive-right rad).
 * @param {number} [distance=0] - Player's accumulated travel in metres.
 * @returns {number} Scene/model yaw in radians, opposite lane heading on flat road.
 */
export function trafficYaw(car, distance = 0) {
  const rear=trafficDefinition(car.kind).rearAxleZ,h=Number.isFinite(car.heading)?car.heading:0;
  const slope=Math.tan(roadYaw(-car.z+rear,distance)),c=Math.cos(h);
  // Lane offsets add in horizontal road coordinates, so compose slopes, not
  // angles. atan2 also preserves full-circle inspection/turning trajectories.
  return Math.atan2(slope*c-Math.sin(h),c);
}
/**
 * Computes signed curvature of the combined road and rear-axle lane trajectory.
 * Uses the derivative of the composed tangent and its speed-cubed normalization;
 * absent lane curvature/heading are treated as zero.
 * @param {Object} car - Kind, z in metres ahead, heading in rad and laneCurvature.
 * @param {number} [distance=0] - Player's accumulated travel in metres.
 * @returns {number} Combined signed path curvature in inverse metres.
 */
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
/**
 * Places a model origin so its rear axle stays on the prescribed lane path.
 * Offsets the rotated body from its measured rear-axle datum instead of rotating
 * around the model origin; the simulation entity itself is not changed.
 * @param {Object} car - Traffic kind, continuous lane coordinate and z/heading.
 * @param {number} [distance=0] - Player's accumulated travel in metres.
 * @returns {Object} Scene x/z in metres and yaw in radians; x is positive right,
 * z negative ahead, and lane 1 is the road centre.
 */
export function trafficPose(car,distance=0){
  const rear=trafficDefinition(car.kind).rearAxleZ,axleZ=-car.z+rear,yaw=trafficYaw(car,distance);
  return {x:(trafficLateral(car)-1)*LANE_WIDTH+roadCurve(axleZ,distance)-Math.sin(yaw)*rear,
    z:axleZ-Math.cos(yaw)*rear,yaw};
}
/**
 * Estimates an initial trailer-to-tractor angle from separated road tangents.
 * Rigid vehicles return zero; articulated fallback angles are capped at +/-0.12 rad.
 * @param {Object} car - Traffic kind and z in metres ahead of the player.
 * @param {number} [distance=0] - Player's accumulated travel in metres.
 * @returns {number} Relative model yaw in radians, not an absolute trailer yaw.
 */
export function trailerTargetYaw(car, distance = 0) {
  const spec = trafficDefinition(car.kind);
  if (!spec.articulated) return 0;
  const z = -car.z;
  return clamp(roadYaw(z + 4, distance) - roadYaw(z - 5, distance), -.12, .12);
}
/**
 * Reads simulated relative trailer yaw, or estimates it before kinematics exists.
 * @param {Object} car - Entity with optional finite trailerAngle in radians.
 * @param {number} [distance=0] - Player's accumulated travel in metres.
 * @returns {number} Trailer yaw relative to the tractor in radians.
 */
export function trailerYaw(car, distance = 0) {
  return Number.isFinite(car.trailerAngle) ? car.trailerAngle : trailerTargetYaw(car,distance);
}
// Kinematic trailer: rear bogie follows the moving kingpin with zero lateral
// velocity at its axle centre. The renderer and collision shape read the same
// relative yaw; there is no spring pulling the trailer back to tractor yaw.
/**
 * Transforms the authored tractor hitch into the same scene frame as trafficPose.
 * Intended for articulated specifications with a finite hitchZ offset.
 * @param {Object} car - Articulated traffic pose and kind.
 * @param {number} distance - Player's accumulated travel in metres.
 * @returns {Object} Hitch x/z in metres and tractor yaw in radians.
 */
export function trafficHitch(car, distance) {
  const spec=trafficDefinition(car.kind),pose=trafficPose(car,distance),yaw=pose.yaw;
  return {x:pose.x+Math.sin(yaw)*spec.hitchZ,z:pose.z+Math.cos(yaw)*spec.hitchZ,yaw};
}
/**
 * Integrates a no-lateral-slip trailer axle from the hitch's scene displacement.
 * Uses four implicit-midpoint refinements, with no explicit time dependence;
 * positive/negative yaw follow the scene model's rotation about the y axis.
 * @param {number} yaw - Previous absolute trailer yaw in radians.
 * @param {number} dx - Hitch displacement toward scene right in metres.
 * @param {number} dz - Hitch displacement along scene +z in metres.
 * @param {number} length - Positive hitch-to-trailer-axle distance in metres.
 * @returns {number} Updated unwrapped absolute yaw in radians.
 */
export function integrateTrailerYaw(yaw,dx,dz,length) {
  // Implicit midpoint integration of dYaw = -(dH dot axleRight)/wheelbase.
  // It is stable at the fixed simulation step and independent of frame rate.
  let change=(-dx*Math.cos(yaw)+dz*Math.sin(yaw))/length;
  for(let i=0;i<4;i++){const mid=yaw+change*.5;change=(-dx*Math.cos(mid)+dz*Math.sin(mid))/length;}
  return yaw+change;
}
/**
 * Updates relative trailer yaw, axle travel/curvature and cached hitch/axle pose.
 * Transports the previous pose into the current moving-road frame before applying
 * no-slip kinematics and articulation stops. Missing state or a road-distance jump
 * above 10 m reinitializes the pose; stopped vehicles retain articulation and do
 * not accrue trailer wheel travel. Rigid vehicles or nonpositive dt are ignored.
 * @param {Object} car - Mutable articulated traffic entity with speed in m/s.
 * @param {number} distance - Player's accumulated travel in metres.
 * @param {number} dt - Positive simulation interval in seconds; used as a guard.
 * @returns {void}
 */
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
    /**
     * Re-expresses a cached scene point after player advance and road-shape change.
     * Uses the enclosing old/new travel distances; no cached point is mutated.
     * @param {number} x - Previous scene lateral coordinate in metres.
     * @param {number} z - Previous scene longitudinal coordinate in metres.
     * @returns {Object} Transported x/z in metres in the current road frame.
     */
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
/**
 * Finds the lowest point of the rolled player body above the road.
 * Accounts for its 0.58 m render pivot and full width, clamping below-road values
 * to zero rather than letting roll incorrectly imply collision clearance.
 * @param {number} altitude - Player lift above its grounded pose in metres.
 * @param {number} [rollAngle=0] - Barrel-roll angle in radians.
 * @returns {number} Nonnegative lower-body road clearance in metres.
 */
export function playerBottom(altitude, rollAngle = 0) {
  // The render pivot is 0.58m above the road. Include the whole rolled width,
  // not a constant low passenger-car roof height for every vehicle.
  const c = Math.cos(rollAngle), s = Math.sin(rollAngle), h = PLAYER_BOUNDS.height;
  return Math.max(0, altitude + .58 + (h / 2 - .58) * c - Math.abs(c) * h / 2 - Math.abs(s) * PLAYER_BOUNDS.width / 2);
}
/**
 * Returns combined longitudinal half-extents for player/traffic encounter checks.
 * @param {Object} car - Traffic entity with a catalogue kind.
 * @returns {number} Half the sum of both body lengths in metres.
 */
export function playerTrafficDepth(car) { return (PLAYER_BOUNDS.length + trafficDefinition(car.kind).length) / 2; }
/**
 * Returns combined lateral half-extents for unrotated player/traffic checks.
 * @param {Object} car - Traffic entity with a catalogue kind.
 * @returns {number} Half the sum of both body widths in metres, not lane units.
 */
export function playerTrafficWidth(car) { return (PLAYER_BOUNDS.width + trafficDefinition(car.kind).width) / 2; }

/**
 * Builds an oriented ground-plane rectangle with cached orthonormal axes.
 * The longitudinal axis follows local +z; its sign is irrelevant to overlap tests.
 * @param {number} x - Scene centre x in metres, positive right.
 * @param {number} z - Scene centre z in metres, negative ahead of the player.
 * @param {number} width - Full lateral extent in metres.
 * @param {number} length - Full longitudinal extent in metres.
 * @param {number} yaw - Rotation about the scene y axis in radians.
 * @returns {Object} Fresh centre/half-extents/right/forward collision descriptor.
 */
function rectangle(x, z, width, length, yaw) {
  return { x, z, halfWidth: width / 2, halfLength: length / 2,
    right: [Math.cos(yaw), -Math.sin(yaw)], forward: [Math.sin(yaw), Math.cos(yaw)] };
}
/**
 * Tests strict oriented-rectangle overlap using both rectangles' separating axes.
 * Exact edge contact is not overlap; descriptors and their axes are not mutated.
 * @param {Object} a - Rectangle descriptor from rectangle.
 * @param {Object} b - Rectangle descriptor in the same scene coordinate frame.
 * @returns {boolean} Whether the rectangles have positive overlap on every axis.
 */
export function rectanglesOverlap(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const axis of [a.right, a.forward, b.right, b.forward]) {
    const projected = Math.abs(dx * axis[0] + dz * axis[1]);
    /**
     * Projects a rectangle's half-width/half-length onto the enclosing test axis.
     * @param {Object} r - Oriented rectangle with unit right/forward axes.
     * @returns {number} Nonnegative support extent along the current axis in metres.
     */
    const extent = r => r.halfWidth * Math.abs(r.right[0] * axis[0] + r.right[1] * axis[1])
      + r.halfLength * Math.abs(r.forward[0] * axis[0] + r.forward[1] * axis[1]);
    if (projected >= extent(a) + extent(b)) return false;
  }
  return true;
}
/**
 * Creates collision rectangles from the same tractor/trailer pose used to render.
 * Rigid vehicles have one body rectangle; articulated vehicles use separate cab
 * and hitch-rotated trailer rectangles so their different yaws remain meaningful.
 * @param {Object} car - Traffic entity with kind, lane pose and optional trailer yaw.
 * @param {number} distance - Player's accumulated travel in metres.
 * @returns {Object[]} Fresh oriented rectangles in scene metres.
 */
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
/**
 * Checks vertical clearance and conservative swept ground-plane body overlap.
 * Midpoint rectangles are expanded by player/traffic lateral motion and relative
 * longitudinal travel to catch between-step contacts. Uses rolled player width,
 * player heading and independently articulated traffic parts without mutation.
 * @param {Object} car - Traffic entity with current z, x and optional previousLateral.
 * @param {Object} state - Player lane-coordinate x, heading/roll in radians,
 * altitude in metres and accumulated distance in metres.
 * @param {number} [previousX=state.x] - Player's prior continuous lane coordinate.
 * @param {number} [previousZ=car.z] - Traffic's prior metres-ahead separation.
 * @returns {boolean} Whether any traffic part overlaps the player's swept body.
 */
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
