import * as T from '../public/vendor/three.js';

// Preserve the accepted HOME eye, converting the old cylindrical offset to a
// genuine spherical orbit. Dragging vertically must not change eye distance.
export const GARAGE_ORBIT_PITCH = Object.freeze({ min: Math.atan(Math.sin(.13)), max: Math.atan(Math.sin(.48)), initial: Math.atan(Math.sin(.24)) });
export const GARAGE_ORBIT_DISTANCE_FACTOR = Math.sqrt(1 + Math.sin(.24) ** 2);

/** Exact convex meridian of the visible mesh's full revolution, measured once, not its fictitious AABB corners. */
export function garageOrbitEnvelope(root, pivot) {
  root.updateWorldMatrix(true, true);
  const levels = new Map(), point = new T.Vector3();
  root.traverseVisible(node => {
    const position = node.isMesh && node.geometry?.attributes.position;
    if (!position) return;
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld).sub(pivot);
      const radius = Math.hypot(point.x, point.z);
      if(radius > (levels.get(point.y) ?? -1)) levels.set(point.y, radius);
    }
  });
  const points = [...levels].map(([y,r]) => ({r,y}));
  if (!points.length) return [{ r: 0, y: 0 }];
  points.sort((a, b) => a.r - b.r || a.y - b.y);
  const cross = (a, b, c) => (b.r - a.r) * (c.y - a.y) - (b.y - a.y) * (c.r - a.r);
  const lower = [], upper = [];
  for (const point of points) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  for (let index = points.length - 1; index >= 0; index--) { const point = points[index]; while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Analytic continuous yaw/pitch bounds: no angular sampling gaps and no current-yaw lens adjustment. */
export function garageOrbitSlopes(envelope, distance, minPitch = GARAGE_ORBIT_PITCH.min, maxPitch = GARAGE_ORBIT_PITCH.max) {
  let horizontal = 0, bottom = Infinity, top = -Infinity;
  for (const { r, y } of envelope) {
    // Across all yaw, horizontal tangent = r / sqrt((D - sin(p)y)^2 - cos(p)^2 r^2).
    // Its squared denominator is a convex quadratic in sin(p), with this exact minimum.
    const squared = r * r + y * y;
    const sine = T.MathUtils.clamp(squared ? distance * y / squared : 0, Math.sin(minPitch), Math.sin(maxPitch));
    horizontal = Math.max(horizontal, r / Math.sqrt(Math.max(1e-8, (distance - sine * y) ** 2 - (1 - sine * sine) * r * r)));
    for (const q of [-r, r]) {
      const angle = Math.atan2(y, q), arc = Math.acos(T.MathUtils.clamp(Math.sqrt(squared) / distance, -1, 1));
      const pitches = [minPitch, maxPitch];
      // A vertical extremum satisfies D(q cos(p) + y sin(p)) = q^2 + y^2.
      for (const candidate of [angle - arc, angle + arc, angle - arc + 2 * Math.PI, angle + arc - 2 * Math.PI])
        if (candidate >= minPitch && candidate <= maxPitch) pitches.push(candidate);
      for (const pitch of pitches) {
        const c = Math.cos(pitch), s = Math.sin(pitch), slope = (c * y - s * q) / Math.max(.001, distance - c * q - s * y);
        bottom = Math.min(bottom, slope); top = Math.max(top, slope);
      }
    }
  }
  return { horizontal, bottom, top };
}

/** Distance interval occupied by a finite box within the complete yaw/elevation band. */
export function garageOrbitBlockedInterval(solid, pivot, margin = .43) {
  const obstacle=solid.clone().expandByScalar(margin),yMin=obstacle.min.y-pivot.y,yMax=obstacle.max.y-pivot.y;
  if(yMax<=0)return null;
  const low=Math.tan(GARAGE_ORBIT_PITCH.min),high=Math.tan(GARAGE_ORBIT_PITCH.max);
  const xMin=obstacle.min.x-pivot.x,xMax=obstacle.max.x-pivot.x,zMin=obstacle.min.z-pivot.z,zMax=obstacle.max.z-pivot.z;
  const radialMin=Math.hypot(Math.max(xMin,0,-xMax),Math.max(zMin,0,-zMax));
  const radialMax=Math.hypot(Math.max(Math.abs(xMin),Math.abs(xMax)),Math.max(Math.abs(zMin),Math.abs(zMax)));
  const nearR=Math.max(radialMin,yMin/high,0),nearY=Math.max(yMin,nearR*low,0);
  if(nearR>radialMax||nearY>yMax||nearY>nearR*high+1e-9)return null;
  const farR=Math.min(radialMax,yMax/low),farY=Math.min(yMax,farR*high);
  return [Math.hypot(nearR,nearY)-.002,Math.hypot(farR,farY)+.002];
}

/** Clamp explicit zoom once to a clear full orbit, not a ray-prefix or current-angle collision correction. */
export function garageOrbitDistance(desired, limits, pivot, vehicleBounds) {
  const margin=.43,box=limits.bounds,c=Math.cos(GARAGE_ORBIT_PITCH.min),s=Math.sin(GARAGE_ORBIT_PITCH.max);
  const maximum=Math.min((Math.min(pivot.x-box.min.x,box.max.x-pivot.x,pivot.z-box.min.z,box.max.z-pivot.z)-margin)/c,(box.max.y-margin-pivot.y)/s)-.002;
  const intervals=limits.obstacles.map(box=>garageOrbitBlockedInterval(box,pivot,margin));
  intervals.push(garageOrbitBlockedInterval(vehicleBounds,pivot,.30));
  const blocked=intervals.filter(Boolean).sort((a,b)=>a[0]-b[0]);let lower=.1,best=null,error=Infinity;
  for(const [start,end] of [...blocked,[maximum,Infinity]]){
    if(start>lower){const candidate=T.MathUtils.clamp(desired,lower,Math.min(start,maximum));if(Math.abs(candidate-desired)<error){best=candidate;error=Math.abs(candidate-desired);}}
    lower=Math.max(lower,end);if(lower>=maximum)break;
  }
  if(best===null)throw new RangeError('No clear full garage orbit; the authored layout needs correction');
  return best;
}

/** Build one immutable optical rig for a model/viewport/explicit zoom, never for a pointer angle. */
export function createGarageOrbitRig({ envelope, distance, width, height, region, minimumFov = 38, referencePoints = null, pivot = null }) {
  const valid = region && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key])) && region.width > 0 && region.height > 0;
  const view = valid ? region : { x: 0, y: 0, width, height };
  const slopes = garageOrbitSlopes(envelope, distance);
  const tangent = Math.max(Math.tan(minimumFov * Math.PI / 360), slopes.horizontal * height / view.width * 1.08, (slopes.top - slopes.bottom) * height / (2 * view.height) * 1.08);
  const fov = Math.min(170, 2 * Math.atan(tangent) * 180 / Math.PI), effective = Math.tan(fov * Math.PI / 360);
  let centerX=0,centerY=(slopes.bottom+slopes.top)/2;
  if(referencePoints?.length&&pivot){
    const reference=new T.PerspectiveCamera(),yaw=-.63,pitch=GARAGE_ORBIT_PITCH.initial;
    reference.position.copy(pivot).add(new T.Vector3(Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,-Math.cos(yaw)*Math.cos(pitch)*distance));reference.lookAt(pivot);reference.updateMatrixWorld();
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    for(const point of referencePoints){const local=point.clone().applyMatrix4(reference.matrixWorldInverse),depth=Math.max(.001,-local.z);left=Math.min(left,local.x/depth);right=Math.max(right,local.x/depth);bottom=Math.min(bottom,local.y/depth);top=Math.max(top,local.y/depth);}
    // Keep the accepted opening composition where the invariant envelope has
    // spare room. The principal point is chosen once, never follows the drag.
    const slackX=Math.max(0,view.width*effective/height-slopes.horizontal*1.025),halfY=view.height*effective/height;
    centerX=T.MathUtils.clamp((left+right)/2,-slackX,slackX);
    centerY=T.MathUtils.clamp((bottom+top)/2,slopes.top-halfY,slopes.bottom+halfY);
  }
  const offsetX=width/2+centerX*height/(2*effective)-(view.x+view.width/2),offsetY=height/2-centerY*height/(2*effective)-(view.y+view.height/2);
  // Bound the full asymmetric near plane to 0.18m in the supported UI stages.
  const camera = new T.PerspectiveCamera(fov, width / height, .08, 80);
  camera.setViewOffset(width, height, offsetX, offsetY, width, height); camera.updateMatrixWorld();
  let radius = 0;
  for (const x of [-1, 1]) for (const y of [-1, 1]) radius = Math.max(radius, new T.Vector3(x, y, -1).unproject(camera).length());
  return Object.freeze({ distance, fov, offsetX, offsetY, near: Math.max(.012, .08 * Math.min(1, .18 / radius)), slopes });
}

/** Apply the fixed rig: only yaw and elevation change during direct manipulation. */
export function applyGarageOrbitRig(camera, rig, pivot, yaw, pitch, width, height) {
  const horizontal = Math.cos(pitch) * rig.distance;
  camera.position.copy(pivot).add(new T.Vector3(Math.sin(yaw) * horizontal, Math.sin(pitch) * rig.distance, -Math.cos(yaw) * horizontal));
  camera.lookAt(pivot); camera.fov = rig.fov; camera.near = rig.near;
  camera.setViewOffset(width, height, rig.offsetX, rig.offsetY, width, height); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  camera.userData.garageLookTarget = pivot.clone(); camera.userData.garageExterior = true; camera.userData.garageStableOrbit = rig;
}

/** Finite support points for transition diagnostics; the analytic envelope also covers the arcs between them. */
export function garageOrbitPoints(envelope, pivot) {
  return envelope.flatMap(({ r, y }) => Array.from({ length: 12 }, (_, index) => {
    const angle = index * Math.PI / 6;
    return new T.Vector3(Math.sin(angle) * r, y, Math.cos(angle) * r).add(pivot);
  }));
}

/** Retain the rig's off-axis lens while a user-requested inspection transition changes its eye. */
export function applyGarageOrbitProjection(camera, rig, width, height) {
  camera.fov = rig.fov; camera.near = rig.near;
  camera.setViewOffset(width, height, rig.offsetX, rig.offsetY, width, height);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
