/**
 * Ground-plane rigid-body contacts, in SI units.
 *
 * An OBB is {x,z,yaw,halfWidth,halfLength}. Coordinates match scene geometry:
 * +x is right, +z is behind, and yaw is model rotation about +Y. Its axes are
 * right=(cos(yaw),-sin(yaw)), longitudinal=(sin(yaw),cos(yaw)).
 * Thus a player heading/yawRate measured positive-right has the opposite sign.
 * Body velocity is {vx,vz,yawRate}; positive angular velocity at offset (x,z)
 * produces (yawRate*z,-yawRate*x). Every normal points from A toward B.
 *
 * SAT/clipped contact features and bounded continuous queries follow the
 * principles described at https://box2d.org/documentation/md_collision.html .
 * Impulse effective mass and Coulomb friction:
 * https://gafferongames.com/post/collision_response_and_coulomb_friction/ .
 * This is a small box solver, not an implementation or port of Box2D.
 */

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const workspaces = new WeakMap();
const DEFAULT_OPTIONS = Object.freeze({});
// Only for constructing an already-confirmed contact patch, never for deciding
// overlap/TOI. A 3 mm car-scale compliant bumper patch avoids selecting an
// extreme vertex merely because nominally aligned bumpers follow slightly
// different road tangents. The centered Game regression spans 2.43 mm.
const CONTACT_PATCH_SLOP = .003;

/** Reused output objects also reuse their sweep workspace; no per-axis arrays. */
function workspace(out) {
  let value = workspaces.get(out);
  if (!value) {
    value = { a: {}, b: {}, sat: {}, stack: new Float64Array(3 * 52) };
    workspaces.set(out, value);
  }
  return value;
}

/** Greatest signed SAT gap; <=0 means actual touching/overlap, not a skin. */
function separation(a, b, out) {
  const ac = Math.cos(a.yaw), as = Math.sin(a.yaw);
  const bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
  const dx = b.x - a.x, dz = b.z - a.z;
  let greatest = -Infinity, winner = 0, normalX = 1, normalZ = 0;
  for (let axis = 0; axis < 4; axis++) {
    const nx = axis === 0 ? ac : axis === 1 ? as : axis === 2 ? bc : bs;
    const nz = axis === 0 ? -as : axis === 1 ? ac : axis === 2 ? -bs : bc;
    const projection = dx * nx + dz * nz;
    const extent = a.halfWidth * Math.abs(ac * nx - as * nz)
      + a.halfLength * Math.abs(as * nx + ac * nz)
      + b.halfWidth * Math.abs(bc * nx - bs * nz)
      + b.halfLength * Math.abs(bs * nx + bc * nz);
    const gap = Math.abs(projection) - extent;
    if (gap > greatest) {
      greatest = gap;
      winner = axis;
      const sign = projection < 0 ? -1 : 1;
      normalX = nx * sign;
      normalZ = nz * sign;
    }
  }
  out.separation = greatest;
  out.axis = winner;
  out.normalX = normalX;
  out.normalZ = normalZ;
  return greatest;
}

/**
 * Clip the incident face to the reference face's side planes. The mean of the
 * surviving surface pairs is a stable single point: aligned bumper contact
 * uses the bumper midpoint, not an arbitrarily selected supporting corner.
 * Near-plane features within CONTACT_PATCH_SLOP join that patch only AFTER a
 * strict SAT hit. This is a local geometric distance, not an angle threshold;
 * clipping to the reference side planes still preserves offset corner hits.
 */
function contactPoint(a, b, sat, out) {
  const reference = sat.axis < 2 ? a : b, incident = sat.axis < 2 ? b : a;
  const sign = sat.axis < 2 ? 1 : -1;
  const nx = sat.normalX * sign, nz = sat.normalZ * sign;
  const rc = Math.cos(reference.yaw), rs = Math.sin(reference.yaw);
  const lateralFace = (sat.axis & 1) === 0;
  const tx = lateralFace ? rs : rc, tz = lateralFace ? rc : -rs;
  const faceExtent = lateralFace ? reference.halfWidth : reference.halfLength;
  const sideExtent = lateralFace ? reference.halfLength : reference.halfWidth;
  const faceX = reference.x + nx * faceExtent;
  const faceZ = reference.z + nz * faceExtent;
  const ic = Math.cos(incident.yaw), is = Math.sin(incident.yaw);
  const rightDot = ic * nx - is * nz, forwardDot = is * nx + ic * nz;
  const incidentLateral = Math.abs(rightDot) > Math.abs(forwardDot);
  const incidentSign = (incidentLateral ? rightDot : forwardDot) > 0 ? -1 : 1;
  const inx = (incidentLateral ? ic : is) * incidentSign;
  const inz = (incidentLateral ? -is : ic) * incidentSign;
  const incidentExtent = incidentLateral ? incident.halfWidth : incident.halfLength;
  const edgeExtent = incidentLateral ? incident.halfLength : incident.halfWidth;
  const ex = (incidentLateral ? is : ic) * edgeExtent;
  const ez = (incidentLateral ? ic : -is) * edgeExtent;
  const centerX = incident.x + inx * incidentExtent;
  const centerZ = incident.z + inz * incidentExtent;
  const startX = centerX - ex, startZ = centerZ - ez;
  const deltaX = 2 * ex, deltaZ = 2 * ez;
  const sideStart = (startX - faceX) * tx + (startZ - faceZ) * tz;
  const sideDelta = deltaX * tx + deltaZ * tz;
  let low = 0, high = 1;
  if (Math.abs(sideDelta) > 1e-15) {
    const first = (-sideExtent - sideStart) / sideDelta;
    const second = (sideExtent - sideStart) / sideDelta;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
  }
  // Keep penetration and the bounded near-plane contact patch. Detection stays
  // strict: this tolerance cannot turn a separated pair into a manifold/hit.
  const planeStart = (startX - faceX) * nx + (startZ - faceZ) * nz;
  const planeDelta = deltaX * nx + deltaZ * nz;
  if (Math.abs(planeDelta) > 1e-15) {
    const crossing = (CONTACT_PATCH_SLOP - planeStart) / planeDelta;
    if (planeDelta > 0) high = Math.min(high, crossing);
    else low = Math.max(low, crossing);
  }
  const t = clamp((low + high) * .5, 0, 1);
  const px = startX + deltaX * t, pz = startZ + deltaZ * t;
  const planeDistance = (px - faceX) * nx + (pz - faceZ) * nz;
  out.pointX = px - nx * planeDistance * .5;
  out.pointZ = pz - nz * planeDistance * .5;
  out.normalX = sat.normalX;
  out.normalZ = sat.normalZ;
  out.penetration = Math.max(0, -sat.separation);
  return out;
}

/**
 * Actual OBB contact, including exact edge touching. Any strictly positive gap
 * returns null. Does not mutate shapes; passing out avoids a result allocation.
 */
export function obbManifold(a, b, out = {}) {
  separation(a, b, out);
  if (out.separation > 0) return null;
  return contactPoint(a, b, out, out);
}

function interpolate(start, end, time, out) {
  out.x = start.x + (end.x - start.x) * time;
  out.z = start.z + (end.z - start.z) * time;
  out.yaw = start.yaw + (end.yaw - start.yaw) * time;
  out.halfWidth = start.halfWidth + (end.halfWidth - start.halfWidth) * time;
  out.halfLength = start.halfLength + (end.halfLength - start.halfLength) * time;
}

function sample(a0, a1, b0, b1, time, work) {
  interpolate(a0, a1, time, work.a);
  interpolate(b0, b1, time, work.b);
  return separation(work.a, work.b, work.sat);
}

function hit(a, b, sat, time, out) {
  contactPoint(a, b, sat, out);
  out.time = time;
  out.initialOverlap = time === 0;
  out.status = 'hit';
  out.timeError = Math.max(0, time - out.earliestPossibleTime);
  return out;
}

/** Exact interval intersection for translating, fixed-orientation rectangles. */
function translationSweep(a0, a1, b0, b1, out, work) {
  const ac = Math.cos(a0.yaw), as = Math.sin(a0.yaw);
  const bc = Math.cos(b0.yaw), bs = Math.sin(b0.yaw);
  const dx = b0.x - a0.x, dz = b0.z - a0.z;
  const vx = b1.x - b0.x - (a1.x - a0.x);
  const vz = b1.z - b0.z - (a1.z - a0.z);
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 4; axis++) {
    const nx = axis === 0 ? ac : axis === 1 ? as : axis === 2 ? bc : bs;
    const nz = axis === 0 ? -as : axis === 1 ? ac : axis === 2 ? -bs : bc;
    const position = dx * nx + dz * nz, velocity = vx * nx + vz * nz;
    const extent = a0.halfWidth * Math.abs(ac * nx - as * nz)
      + a0.halfLength * Math.abs(as * nx + ac * nz)
      + b0.halfWidth * Math.abs(bc * nx - bs * nz)
      + b0.halfLength * Math.abs(bs * nx + bc * nz);
    if (velocity === 0) {
      if (Math.abs(position) > extent) return null;
      continue;
    }
    const first = (-extent - position) / velocity;
    const second = (extent - position) / velocity;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter > leave) return null;
  }
  sample(a0, a1, b0, b1, enter, work);
  out.iterations++;
  out.earliestPossibleTime = enter;
  // The interval proof is authoritative even if evaluating its boundary has
  // last-bit positive roundoff. No shape inflation or contact skin is involved.
  return hit(work.a, work.b, work.sat, enter, out);
}

/**
 * First contact along linearly interpolated centers, positive half-extents, and
 * UNWRAPPED yaw angles. Changing extents are a linear geometry approximation;
 * callers approximating nonlinear roll projection must bound their own roll
 * angular substeps, rather than treating endpoint interpolation as exact roll.
 *
 * Fixed-extents translation uses exact swept SAT. Rotation or extent changes
 * use bounded adaptive intervals, NOT an exact rotating-OBB TOI claim. At each
 * interval midpoint, its separating
 * axis is held fixed. Every vertex's projection changes by at most
 * (abs(relativeTranslation dot axis) + maxRadiusA*abs(turnA)
 *  + maxRadiusB*abs(turnB) + hypot(widthChangeA,lengthChangeA)
 *  + hypot(widthChangeB,lengthChangeB))*halfInterval. Here width/length changes
 * are half-extent changes, and each maxRadius is the greater endpoint corner
 * radius. Linear extents have no larger intermediate radius. A larger positive
 * gap proves the WHOLE
 * interval clear. Otherwise split it, earliest first; only actual SAT contact
 * can return an adaptive hit. No expanded broad-phase box is treated as contact.
 *
 * Returns out for a confirmed contact, or null. Inspect out.status:
 * 'miss' proves the sweep clear; 'unresolved' means the bounded work limit or a
 * microscopic grazing interval prevented proof. In that case advance at most
 * out.earliestPossibleTime, then retry a shorter interval, never invent impact.
 * uncertainStart/uncertainEnd delimit the first unresolved interval (remaining
 * interval to 1 on a work limit). A tolerance-sized interval with no contact
 * sample is refined further, never skipped for a later hit. Hits expose
 * earliestPossibleTime/timeError too, to distinguish confirmed contact time
 * from its lower bound.
 *
 * options: maxIterations (default 2048, hard cap 65536 SAT evaluations),
 * maxDepth (default 32, hard cap 48), timeTolerance (default 1e-8 fraction).
 * Reuse out for allocation-conscious repeated calls. Inputs are never mutated.
 */
export function sweepOBB(a0, a1, b0, b1, out = {}, options = DEFAULT_OPTIONS) {
  const work = workspace(out);
  out.status = 'miss';
  out.time = 1;
  out.initialOverlap = false;
  out.iterations = 1;
  out.earliestPossibleTime = 1;
  out.timeError = 0;
  out.uncertainStart = 1;
  out.uncertainEnd = 1;
  if (separation(a0, b0, work.sat) <= 0) {
    out.earliestPossibleTime = 0;
    return hit(a0, b0, work.sat, 0, out);
  }
  const turnA = a1.yaw - a0.yaw, turnB = b1.yaw - b0.yaw;
  const widthChangeA = a1.halfWidth - a0.halfWidth, lengthChangeA = a1.halfLength - a0.halfLength;
  const widthChangeB = b1.halfWidth - b0.halfWidth, lengthChangeB = b1.halfLength - b0.halfLength;
  if (turnA === 0 && turnB === 0 && widthChangeA === 0 && lengthChangeA === 0
    && widthChangeB === 0 && lengthChangeB === 0) return translationSweep(a0, a1, b0, b1, out, work);
  const maxIterations = clamp(Math.floor(options.maxIterations || 2048), 8, 65536);
  const maxDepth = clamp(Math.floor(options.maxDepth || 32), 1, 48);
  const tolerance = clamp(options.timeTolerance || 1e-8, 1e-14, .01);
  const vx = b1.x - b0.x - (a1.x - a0.x);
  const vz = b1.z - b0.z - (a1.z - a0.z);
  const rotationBound = Math.max(Math.hypot(a0.halfWidth, a0.halfLength),
    Math.hypot(a1.halfWidth, a1.halfLength)) * Math.abs(turnA)
    + Math.max(Math.hypot(b0.halfWidth, b0.halfLength),
      Math.hypot(b1.halfWidth, b1.halfLength)) * Math.abs(turnB);
  const extentChangeBound = Math.hypot(widthChangeA, lengthChangeA) + Math.hypot(widthChangeB, lengthChangeB);
  const stack = work.stack;
  let count = 1;
  stack[0] = 0; stack[1] = 1; stack[2] = 0;
  while (count > 0) {
    const index = --count * 3;
    const low = stack[index], high = stack[index + 1], depth = stack[index + 2];
    if (out.iterations + 3 > maxIterations) {
      out.status = 'unresolved';
      out.earliestPossibleTime = Math.min(out.earliestPossibleTime, low);
      out.uncertainStart = Math.min(out.uncertainStart, low);
      out.uncertainEnd = 1;
      return null;
    }
    const middle = (low + high) * .5, halfInterval = (high - low) * .5;
    const gap = sample(a0, a1, b0, b1, middle, work);
    out.iterations++;
    const speedBound = Math.abs(vx * work.sat.normalX + vz * work.sat.normalZ)
      + rotationBound + extentChangeBound;
    // Tiny numerical safety margin affects only pruning, never hit acceptance.
    const roundoff = 32 * Number.EPSILON * (1 + Math.abs(work.a.x) + Math.abs(work.a.z)
      + Math.abs(work.b.x) + Math.abs(work.b.z) + a0.halfLength + b0.halfLength);
    if (gap > speedBound * halfInterval + roundoff) continue;
    if (high - low <= tolerance || depth >= maxDepth) {
      // The midpoint was just evaluated; test all three in chronological order.
      let firstHit = Infinity;
      if (sample(a0, a1, b0, b1, low, work) <= 0) firstHit = low;
      out.iterations++;
      if (firstHit === Infinity && gap <= 0) firstHit = middle;
      if (firstHit === Infinity) {
        if (sample(a0, a1, b0, b1, high, work) <= 0) firstHit = high;
        out.iterations++;
      }
      if (firstHit !== Infinity) {
        // Re-evaluate only when the stored sample is not the selected sample.
        if (firstHit === middle) {
          sample(a0, a1, b0, b1, middle, work);
          out.iterations++;
        }
        out.earliestPossibleTime = Math.min(out.earliestPossibleTime, low);
        return hit(work.a, work.b, work.sat, firstHit, out);
      }
      // Tolerance bounds a confirmed hit, not permission to skip an unproven
      // earlier interval. Refine this interval first; fail closed only when a
      // hard limit prevents proof. Later intervals remain on the DFS stack.
      if (depth >= maxDepth) {
        out.status = 'unresolved';
        out.earliestPossibleTime = low;
        out.uncertainStart = low;
        out.uncertainEnd = high;
        return null;
      }
    }
    // Push right, then left; DFS therefore proves/visits earlier times first.
    let next = count++ * 3;
    stack[next] = middle; stack[next + 1] = high; stack[next + 2] = depth + 1;
    next = count++ * 3;
    stack[next] = low; stack[next + 1] = middle; stack[next + 2] = depth + 1;
  }
  return null;
}

/** Rectangle polar inertia about its center, in kg m². */
export function rectangleInertia(mass, width, length) {
  return mass * (width * width + length * length) / 12;
}

/**
 * Apply one normal impulse followed by a clamped Coulomb-friction impulse.
 * a/b: {x,z,vx,vz,yawRate,invMass,invInertia}; zero inverse mass/inertia makes
 * a kinematic body. Contact point is in the same frame as body centers.
 * options: restitution [0,1] (default .12), friction >=0 (default .45),
 * bounceThreshold m/s (default .5). Only approaching contacts receive impulse.
 * No position correction or invented side kick is hidden in this velocity step.
 */
export function resolveContactImpulse(a, b, contact, options = DEFAULT_OPTIONS, out = {}) {
  const nx = contact.normalX, nz = contact.normalZ;
  const arx = contact.pointX - a.x, arz = contact.pointZ - a.z;
  const brx = contact.pointX - b.x, brz = contact.pointZ - b.z;
  const ma = Math.max(0, a.invMass || 0), mb = Math.max(0, b.invMass || 0);
  const ia = Math.max(0, a.invInertia || 0), ib = Math.max(0, b.invInertia || 0);
  const wa = a.yawRate || 0, wb = b.yawRate || 0;
  let rvx = (b.vx || 0) + wb * brz - (a.vx || 0) - wa * arz;
  let rvz = (b.vz || 0) - wb * brx - (a.vz || 0) + wa * arx;
  const normalSpeed = rvx * nx + rvz * nz;
  out.closingSpeed = Math.max(0, -normalSpeed);
  out.normalImpulse = 0;
  out.tangentImpulse = 0;
  if (normalSpeed >= 0) return out;
  const an = arz * nx - arx * nz, bn = brz * nx - brx * nz;
  const effectiveMass = ma + mb + an * an * ia + bn * bn * ib;
  if (!(effectiveMass > 0)) return out;
  const threshold = Math.max(0, options.bounceThreshold ?? .5);
  const restitution = -normalSpeed > threshold ? clamp(options.restitution ?? .12, 0, 1) : 0;
  const impulse = -(1 + restitution) * normalSpeed / effectiveMass;
  a.vx = (a.vx || 0) - impulse * nx * ma;
  a.vz = (a.vz || 0) - impulse * nz * ma;
  a.yawRate = wa - impulse * an * ia;
  b.vx = (b.vx || 0) + impulse * nx * mb;
  b.vz = (b.vz || 0) + impulse * nz * mb;
  b.yawRate = wb + impulse * bn * ib;
  out.normalImpulse = impulse;
  const tx = -nz, tz = nx, at = arz * tx - arx * tz, bt = brz * tx - brx * tz;
  const tangentMass = ma + mb + at * at * ia + bt * bt * ib;
  if (!(tangentMass > 0)) return out;
  rvx = b.vx + b.yawRate * brz - a.vx - a.yawRate * arz;
  rvz = b.vz - b.yawRate * brx - a.vz + a.yawRate * arx;
  const frictionLimit = Math.max(0, options.friction ?? .45) * impulse;
  const tangentImpulse = clamp(-(rvx * tx + rvz * tz) / tangentMass, -frictionLimit, frictionLimit);
  a.vx -= tangentImpulse * tx * ma;
  a.vz -= tangentImpulse * tz * ma;
  a.yawRate -= tangentImpulse * at * ia;
  b.vx += tangentImpulse * tx * mb;
  b.vz += tangentImpulse * tz * mb;
  b.yawRate += tangentImpulse * bt * ib;
  out.tangentImpulse = tangentImpulse;
  return out;
}
