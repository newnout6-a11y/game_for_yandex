import * as T from '../public/vendor/three.js';
import { applyGarageOrbitProjection } from './garage-stable-orbit.js';

const DEFAULT_ROOM = Object.freeze({
  interiorMin: [-9.88, .02, -8.97], interiorMax: [9.88, 6.45, 7.57],
  clearance: .25, orbitRadius: 6, obstacles: [],
});

/** Read the Blender-exported collision contract without retaining mutable metadata arrays. */
export function garageCameraLimits(room, parkedVehicles = []) {
  let data = room?.userData?.garageCamera;
  if (!data) room?.traverse(node => { data ||= node.userData?.garageCamera; });
  const source = data || DEFAULT_ROOM;
  const bounds = new T.Box3(new T.Vector3(...source.interiorMin), new T.Vector3(...source.interiorMax));
  const obstacles = (source.obstacles || []).map(item => new T.Box3(new T.Vector3(...item.min), new T.Vector3(...item.max)));
  for (const car of parkedVehicles) obstacles.push(new T.Box3().setFromObject(car, true));
  return { bounds, obstacles, clearance: Math.max(.1, Number(source.clearance) || .25), orbitRadius: Math.max(3, Number(source.orbitRadius) || 6) };
}

/** Eight world-space corners of a measured focus envelope, reused by projection and regression checks. */
export function garageBoxCorners(box) {
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new T.Vector3(x, y, z));
  return points;
}

/** World-space near-plane corners, including an asymmetric UI viewport offset. */
export function garageNearPlaneCorners(camera) {
  camera.updateMatrixWorld();
  return [-1, 1].flatMap(x => [-1, 1].map(y => new T.Vector3(x, y, -1).unproject(camera)));
}

/** Fit at a fixed eye position: a smaller UI region changes the lens, never backs through a wall. */
export function fitGarageProjection(camera, points, width, height, region, minimumFov = 38) {
  const validRegion = region && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) && region.width > 0 && region.height > 0;
  const view = validRegion ? region : { x: 0, y: 0, width, height };
  camera.clearViewOffset();
  camera.updateMatrixWorld();
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const point of points) {
    const local = point.clone().applyMatrix4(camera.matrixWorldInverse), depth = Math.max(.02, -local.z);
    left = Math.min(left, local.x / depth); right = Math.max(right, local.x / depth);
    bottom = Math.min(bottom, local.y / depth); top = Math.max(top, local.y / depth);
  }
  const tangent = Math.max(Math.tan(minimumFov * Math.PI / 360),
    (right - left) * height / (2 * view.width) * 1.08,
    (top - bottom) * height / (2 * view.height) * 1.08);
  camera.fov = Math.min(170, 2 * Math.atan(tangent) * 180 / Math.PI);
  camera.updateProjectionMatrix();
  const effective = Math.tan(camera.fov * Math.PI / 360);
  const cx = width / 2 + (left + right) * height / (4 * effective);
  const cy = height / 2 - (top + bottom) * height / (4 * effective);
  camera.setViewOffset(width, height, cx - (view.x + view.width / 2), cy - (view.y + view.height / 2), width, height);
  camera.updateMatrixWorld();
}

/** Build a continuous convex camera corridor from room planes and expanded equipment support planes. */
function radialLimit(pivot, direction, limits, margin) {
  const safe = limits.bounds.clone().expandByScalar(-margin);
  let distance = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (direction[axis] > 1e-9) distance = Math.min(distance, (safe.max[axis] - pivot[axis]) / direction[axis]);
    else if (direction[axis] < -1e-9) distance = Math.min(distance, (safe.min[axis] - pivot[axis]) / direction[axis]);
  }
  const closest = new T.Vector3();
  for (const obstacle of limits.obstacles) {
    const expanded = obstacle.clone().expandByScalar(margin);
    if (expanded.containsPoint(pivot)) continue; // Flush floor details cannot imprison the focus itself.
    expanded.clampPoint(pivot, closest).sub(pivot);
    const projection = closest.dot(direction);
    // The closest-point support plane separates the focus from this entire box.
    // Unlike a ray/box hit, its radial limit is continuous at a grazing angle,
    // so a drag or interrupted arc cannot suddenly jump across a lift post.
    if (projection > 1e-9) distance = Math.min(distance, closest.lengthSq() / projection);
  }
  return Math.max(.1, distance);
}

/** Exact finite solids for deliberate preset travel: an obstacle behind the eye is not an infinite wall. */
function finiteRadialDistance(pivot, direction, desired, limits, vehicleBounds, nearRadius) {
  const safe=limits.bounds.clone().expandByScalar(-limits.clearance-nearRadius);
  let maximum=Infinity;
  for(const axis of ['x','y','z'])if(Math.abs(direction[axis])>1e-9)maximum=Math.min(maximum,((direction[axis]>0?safe.max[axis]:safe.min[axis])-pivot[axis])/direction[axis]);
  const blocked=[];
  for(const [box,margin] of [[vehicleBounds,.12+nearRadius],...limits.obstacles.map(box=>[box,limits.clearance+nearRadius])]){
    const expanded=box.clone().expandByScalar(margin);let enter=-Infinity,exit=Infinity;
    for(const axis of ['x','y','z']){
      if(Math.abs(direction[axis])<1e-9){if(pivot[axis]<expanded.min[axis]||pivot[axis]>expanded.max[axis]){enter=Infinity;break;}continue;}
      const a=(expanded.min[axis]-pivot[axis])/direction[axis],b=(expanded.max[axis]-pivot[axis])/direction[axis];enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
    }
    if(exit>=enter&&exit>0)blocked.push([Math.max(.1,enter-.002),exit+.002]);
  }
  blocked.sort((a,b)=>a[0]-b[0]);let lower=.1,best=null,error=Infinity;
  for(const [start,end] of [...blocked,[maximum,Infinity]]){
    if(start>lower){const candidate=T.MathUtils.clamp(desired,lower,Math.min(start,maximum));if(Math.abs(candidate-desired)<error){best=candidate;error=Math.abs(candidate-desired);}}
    lower=Math.max(lower,end);if(lower>=maximum)break;
  }
  return best??Math.min(desired,maximum);
}

/**
 * Keep an exterior eye and its full asymmetric near plane inside the authored room,
 * before equipment/parked cars, and outside the selected vehicle. The fit converges
 * toward a collision-free route; viewport changes never enlarge the room envelope.
 */
export function constrainGarageCamera(camera, { limits, pivot, target, vehicleBounds, points, width, height, region, minimumFov = 38, fixedProjection = null }) {
  const delta = camera.position.clone().sub(pivot), direction = delta.clone().normalize();
  let distance = delta.length();
  const ray = new T.Ray(pivot, direction), exit = new T.Vector3();
  for (let iteration = 0; iteration < 12; iteration++) {
    camera.position.copy(pivot).addScaledVector(direction, distance);
    camera.lookAt(target); camera.updateMatrixWorld();
    if(fixedProjection)applyGarageOrbitProjection(camera,fixedProjection,width,height);
    else fitGarageProjection(camera, points, width, height, region, minimumFov);
    let nearRadius = Math.max(...garageNearPlaneCorners(camera).map(point => point.distanceTo(camera.position)));
    // A narrow mobile inspection region needs a wide full-canvas lens. Shorten
    // the near distance rather than giving its off-screen corners a metre-wide
    // collision sphere that would push the eye into the vehicle.
    if (nearRadius > .18) {
      camera.near = Math.max(.012, camera.near * .18 / nearRadius);
      camera.updateProjectionMatrix();
      nearRadius = Math.max(...garageNearPlaneCorners(camera).map(point => point.distanceTo(camera.position)));
    }
    if(fixedProjection){
      distance=finiteRadialDistance(pivot,direction,distance,limits,vehicleBounds,nearRadius);
      fixedProjection={...fixedProjection,near:camera.near};break;
    }
    const safeDistance = radialLimit(pivot, direction, limits, limits.clearance + nearRadius);
    const car = vehicleBounds.clone().expandByScalar(.12 + nearRadius);
    const minDistance = car.containsPoint(pivot) && ray.intersectBox(car, exit) ? exit.distanceTo(pivot) + .002 : .1;
    const next = Math.max(minDistance, Math.min(distance, safeDistance - .002));
    if (Math.abs(next - distance) < 1e-6) break;
    distance = next;
  }
  camera.position.copy(pivot).addScaledVector(direction, distance);
  camera.lookAt(target); camera.updateMatrixWorld();
  if(fixedProjection)applyGarageOrbitProjection(camera,fixedProjection,width,height);
  else fitGarageProjection(camera, points, width, height, region, minimumFov);
  camera.userData.garageLookTarget = target.clone();
  camera.userData.garageExterior = true;
  camera.userData.garageFocusPoints = points.map(point => point.clone());
}

/** Capture an actual displayed pose, never a mutable camera or a previous requested destination. */
function pose(camera) {
  return { position: camera.position.clone(), rotation: camera.quaternion.clone(), fov: camera.fov, near: camera.near,
    stableOrbit: camera.userData.garageStableOrbit, target: camera.userData.garageLookTarget?.clone(), exterior: camera.userData.garageExterior,
    points: camera.userData.garageFocusPoints?.map(point => point.clone()),
    offset: new T.Vector2(camera.view?.enabled ? camera.view.offsetX / camera.view.fullWidth : 0, camera.view?.enabled ? camera.view.offsetY / camera.view.fullHeight : 0) };
}

/** Finite user-triggered travel, with a polar exterior route instead of a chord through the vehicle. */
export class GarageCameraMotion {
  /** Initialize a settled camera route with a bounded 0.85-second transition duration. */
  constructor() { this.active = false; this.progress = 1; this.from = null; this.duration = .85; }
  /** Start from the last displayed pose, including an interrupted previous transition. */
  begin(camera, { reducedMotion = false } = {}) { this.from = pose(camera); this.progress = reducedMotion ? 1 : 0; this.active = !reducedMotion; }
  /** Advance visible elapsed seconds; hidden or reduced-motion views settle immediately. */
  advance(dt, { visible = true, reducedMotion = false } = {}) {
    if (!this.active) return false;
    if (!visible || reducedMotion) { this.progress = 1; this.active = false; return true; }
    if (!Number.isFinite(dt) || dt <= 0) return false;
    this.progress = Math.min(1, this.progress + dt / this.duration); this.active = this.progress < 1; return true;
  }
  /**
   * Exterior paths orbit the measured vehicle, then re-fit and re-check every frame.
   * A cockpit boundary is an explicit cut, followed by a seated lens settle: no
   * invented flight through glass, roof or seats, including when interrupted.
   */
  apply(camera, width, height, context = null) {
    if (!this.active || !this.from) return;
    const next = pose(camera), p = this.progress, t = p * p * (3 - 2 * p);
    if (context && this.from.exterior && next.exterior) {
      camera.near = T.MathUtils.lerp(this.from.near, next.near, t); camera.updateProjectionMatrix();
      const a = this.from.position.clone().sub(context.pivot), b = next.position.clone().sub(context.pivot);
      const angleA = Math.atan2(a.x, -a.z), angleB = Math.atan2(b.x, -b.z);
      const sweep = Math.atan2(Math.sin(angleB - angleA), Math.cos(angleB - angleA)), yaw = angleA + sweep * t;
      if(this.from.stableOrbit||next.stableOrbit){
        const both=Boolean(this.from.stableOrbit&&next.stableOrbit),smooth=value=>value*value*(3-2*value);
        const radialTime=both?t:this.from.stableOrbit?smooth(Math.max(0,2*p-1)):smooth(Math.min(1,2*p));
        const angularTime=both?t:this.from.stableOrbit?smooth(Math.min(1,2*p)):smooth(Math.max(0,2*p-1));
        const radius=T.MathUtils.lerp(a.length(),b.length(),radialTime),pitch=T.MathUtils.lerp(Math.atan2(a.y,Math.hypot(a.x,a.z)),Math.atan2(b.y,Math.hypot(b.x,b.z)),t),travelYaw=angleA+sweep*angularTime;
        camera.position.copy(context.pivot).add(new T.Vector3(Math.sin(travelYaw)*Math.cos(pitch)*radius,Math.sin(pitch)*radius,-Math.cos(travelYaw)*Math.cos(pitch)*radius));
        const target=(this.from.target||context.target).clone().lerp(context.target,t),offset=this.from.offset.clone().lerp(next.offset,t);
        const projection={fov:T.MathUtils.lerp(this.from.fov,next.fov,t),near:T.MathUtils.lerp(this.from.near,next.near,t),offsetX:offset.x*width,offsetY:offset.y*height};
        camera.lookAt(target);applyGarageOrbitProjection(camera,projection,width,height);
        if(!(this.from.stableOrbit&&next.stableOrbit))constrainGarageCamera(camera,{...context,target,fixedProjection:projection});
        return;
      }
      const radius = T.MathUtils.lerp(Math.hypot(a.x, a.z), Math.hypot(b.x, b.z), t);
      camera.position.copy(context.pivot).add(new T.Vector3(Math.sin(yaw) * radius, T.MathUtils.lerp(a.y, b.y, t), -Math.cos(yaw) * radius));
      const target = (this.from.target || context.target).clone().lerp(context.target, t);
      const points = this.from.points?.length === context.points.length
        ? this.from.points.map((point, index) => point.clone().lerp(context.points[index], t)) : context.points;
      constrainGarageCamera(camera, { ...context, target, points, minimumFov: T.MathUtils.lerp(this.from.fov, next.fov, t) });
      return;
    }
    if (this.from.exterior !== undefined && next.exterior !== undefined && this.from.exterior !== next.exterior) {
      // Optical breathing from a slightly wider lens is finite and stays in the destination compartment.
      camera.fov = Math.min(170, next.fov + 4 * (1 - t)); camera.updateProjectionMatrix();
      if (context && next.exterior && !next.stableOrbit) constrainGarageCamera(camera, { ...context, minimumFov: camera.fov });
      return;
    }
    camera.position.lerpVectors(this.from.position, next.position, t);
    camera.quaternion.slerpQuaternions(this.from.rotation, next.rotation, t);
    camera.fov = T.MathUtils.lerp(this.from.fov, next.fov, t); camera.near = T.MathUtils.lerp(this.from.near, next.near, t);
    const offset = this.from.offset.clone().lerp(next.offset, t);
    camera.setViewOffset(width, height, offset.x * width, offset.y * height, width, height);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
}

/** Fit the real wheel and tablet from the authored seated eye, not a floating exterior or tablet-only close-up. */
export function frameCockpitCustomization(camera,car,data,frame,width,height,region,orbitOffset=0){
  const points=[],wheel=car.userData.yoke;
  car.updateWorldMatrix(true,true);
  wheel?.traverseVisible(node=>{if(!node.isMesh)return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();const box=node.geometry.boundingBox;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new T.Vector3(x,y,z).applyMatrix4(node.matrixWorld));});
  const center=new T.Vector3(...data.center_game_m),right=new T.Vector3(...(data.right_game||[1,0,0])),up=new T.Vector3(...(data.up_game||[0,1,0])),dimensions=data.active_dimensions_m||[.352,.22];
  for(const x of [-.5,.5])for(const y of [-.5,.5])points.push(center.clone().addScaledVector(right,x*dimensions[0]).addScaledVector(up,y*dimensions[1]).applyMatrix4(frame.matrixWorld));
  const eye=camera.position,angles=points.map(point=>{const d=point.clone().sub(eye);return {yaw:Math.atan2(d.x,-d.z),pitch:Math.atan2(d.y,Math.hypot(d.x,d.z))};});
  const yaw=(Math.min(...angles.map(p=>p.yaw))+Math.max(...angles.map(p=>p.yaw)))/2+orbitOffset*.35;
  const pitch=(Math.min(...angles.map(p=>p.pitch))+Math.max(...angles.map(p=>p.pitch)))/2;
  camera.lookAt(eye.clone().add(new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch))));camera.updateMatrixWorld();
  const view=region||{x:0,y:0,width,height},aspect=view.width/view.height;
  let tangent=Math.tan(40*Math.PI/360);
  for(const point of points){const local=point.clone().applyMatrix4(camera.matrixWorldInverse),depth=Math.max(.05,-local.z);tangent=Math.max(tangent,Math.abs(local.y)/depth*1.12,Math.abs(local.x)/depth/aspect*1.12);}
  const effective=Math.min(Math.tan(76*Math.PI/360),tangent);
  camera.fov=Math.min(145,2*Math.atan(effective*height/view.height)*180/Math.PI);camera.updateProjectionMatrix();
  camera.setViewOffset(width,height,width/2-(view.x+view.width/2),height/2-(view.y+view.height/2),width,height);camera.updateMatrixWorld();
  return points;
}
