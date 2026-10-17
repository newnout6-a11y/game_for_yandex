import * as T from '../public/vendor/three.js';
import { trafficDefinition } from './traffic-catalog.js';
import {
  trim, glass, chrome, rubber, headlights, plate, basePaint, baseBrake,
  mix, profileAt, geometry, surface, cabinSurface, box, ellipsoid, mergeParts,
} from './traffic-model-kit.js';

// Original, logo-free utility bodies. Work equipment is deliberately static:
// categories and tags live in the catalog, not in model-specific gameplay code.
const rescueRed = new T.MeshStandardMaterial({ color: '#b52423', roughness: .34, metalness: .3 });
const workYellow = new T.MeshStandardMaterial({ color: '#d99d28', roughness: .4, metalness: .3 });
const white = new T.MeshStandardMaterial({ color: '#e6e8df', roughness: .4, metalness: .15 });
const steel = new T.MeshStandardMaterial({ color: '#6d7c83', roughness: .48, metalness: .7 });
const amber = new T.MeshStandardMaterial({ color: '#e99d27', emissive: '#e79616', emissiveIntensity: .18, roughness: .24 });
const indicatorLeft = amber.clone(); indicatorLeft.name = 'indicator_left';
const indicatorRight = amber.clone(); indicatorRight.name = 'indicator_right';
const cabinGlass = new T.MeshPhysicalMaterial({ color: '#93b2bc', metalness: .06, roughness: .065, clearcoat: .5, transparent: true, opacity: .20, depthWrite: false, side: T.DoubleSide });
const blue = new T.MeshStandardMaterial({ color: '#2165ae', emissive: '#1b5a9c', emissiveIntensity: .18, roughness: .25 });

function panel(g, material, width, height, depth, position, radius = .025) {
  // Small equipment fascias use clipped radiused corners, not expensive bevels.
  const w = width / 2, h = height / 2, r = Math.min(radius, w * .45, h * .45), shape = new T.Shape();
  shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.lineTo(w, -h + r);
  shape.lineTo(w, h - r); shape.lineTo(w - r, h); shape.lineTo(-w + r, h);
  shape.lineTo(-w, h - r); shape.lineTo(-w, -h + r); shape.closePath();
  const mesh = new T.Mesh(new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 }), material);
  mesh.position.set(...position); g.add(mesh); return mesh;
}
function tube(g, material, start, end, radius, segments = 8) {
  const a = new T.Vector3(...start), b = new T.Vector3(...end), delta = b.clone().sub(a);
  const part = new T.Mesh(new T.CylinderGeometry(radius, radius, delta.length(), segments), material);
  part.position.copy(a.add(b).multiplyScalar(.5));
  part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  g.add(part); return part;
}
function beam(g, material, start, end, width, depth = width) {
  const a = new T.Vector3(...start), b = new T.Vector3(...end), delta = b.clone().sub(a);
  const part = box(g, material, [width, delta.length(), depth], a.add(b).multiplyScalar(.5).toArray());
  part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  return part;
}
function sidePanel(g, material, side, x, z, y, width, height, depth = .022, radius = .035) {
  const part = panel(g, material, width, height, depth, [side * x, y, z], radius);
  part.rotation.y = side * Math.PI / 2;
  return part;
}
function cap(g, material, radius, depth, position, axis = 'z', segments = 16) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, depth, segments), material);
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  mesh.position.set(...position); g.add(mesh); return mesh;
}

// A station loft with rolled shoulders and true wheel openings. The lower edge
// rises around each tire, rather than placing a black disc on a solid box.
function hull(g, material, sections, wheelZs, radius, bottom, openRoofFrom = null) {
  const first = sections[0][0], last = sections.at(-1)[0];
  const stations = new Set(Array.from({ length: 19 }, (_, i) => mix(first, last, i / 18)));
  for (const z of wheelZs) for (let i = 0; i <= 12; i++) {
    const at = z + Math.cos(i * Math.PI / 12) * radius * 1.12;
    if (at > first && at < last) stations.add(at);
  }
  if (openRoofFrom !== null) stations.add(openRoofFrom);
  const positions = [], indices = [], zs = [...stations].sort((a, b) => a - b);
  let count;
  for (const z of zs) {
    const [width, shoulder, top] = profileAt(sections, z), w = width * .5;
    let edge = bottom;
    for (const wheelZ of wheelZs) {
      const dz = z - wheelZ, arch = radius * 1.12;
      if (Math.abs(dz) < arch) edge = Math.max(edge, radius + .004 + Math.sqrt(arch * arch - dz * dz));
    }
    const s = Math.max(shoulder, edge + .055);
    const right = [[0, top], [w * .72, top - .018],
      [w * .95, s + .035], [w, s], [w, edge + .07], [w * .975, edge],
      [w * .68, edge], [w * .61, bottom], [0, bottom]];
    const ring = [...right, ...right.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
    count = ring.length;
    for (const [x, y] of ring) positions.push(x, y, z);
  }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < count; i++) {
    if (openRoofFrom !== null && zs[j] >= openRoofFrom && [0, 1, count - 2, count - 1].includes(i)) continue;
    const a = j * count + i, b = j * count + (i + 1) % count;
    indices.push(a, a + count, b, b, a + count, b + count);
  }
  for (const [row, reverse] of [[0, false], [zs.length - 1, true]]) {
    const start = positions.length / 3;
    for (let i = 0; i < count; i++) positions.push(...positions.slice((row * count + i) * 3, (row * count + i + 1) * 3));
    for (let i = 1; i < count - 1; i++) indices.push(start, start + (reverse ? i + 1 : i), start + (reverse ? i : i + 1));
  }
  g.add(new T.Mesh(geometry(positions, indices), material));
}
function arch(g, material, x, z, radius, y, side, start = -.23) {
  const end = Math.PI - start;
  g.add(new T.Mesh(surface((u, v) => {
    const angle = mix(start, end, side === 1 ? v : 1 - v), r = radius + u * .075;
    return [side * (x + Math.sin(u * Math.PI) * .035), y + Math.sin(angle) * r, z + Math.cos(angle) * r];
  }, 2, 18), material));
  // Dark arch liner is a curved vault, leaving the hub and chassis unobstructed.
  g.add(new T.Mesh(surface((u, v) => {
    const angle = mix(start, end, side === 1 ? v : 1 - v);
    return [side * (x - .26 * u), y + Math.sin(angle) * radius, z + Math.cos(angle) * radius];
  }, 1, 16), trim));
}
function linearCabinSurface(sections, width, base) {
  const curved = cabinSurface(sections, width, base), half = width / 2;
  const roof = (q, z) => {
    let low = 0, high = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (curved(mid, z)[0] < Math.abs(q) * half) low = mid; else high = mid;
    }
    const point = curved(Math.sign(q) * (low + high) / 2, z);
    point[0] = q * half; return point;
  };
  roof.windowU = u => curved(u, sections[0][0])[0] / half;
  return roof;
}
function openedCabShell(roof, front, back, apertures) {
  // Triangulate the true window holes in parameter space, then curve each patch.
  const contour = [[-1, front], [1, front], [1, back], [-1, back]].map(p => new T.Vector2(...p));
  const holes = apertures.map(poly => poly.map(p => new T.Vector2(...p)));
  const flat = [...contour, ...holes.flat()], triangles = T.ShapeUtils.triangulateShape(contour, holes);
  // Earcut may leave a long edge opposite several collinear shorter edges.
  // Split at every UV vertex before curving; otherwise those T-junctions crack.
  const patches = [];
  for (const ids of triangles) {
    const corners = ids.map(i => flat[i]);
    const center = corners.reduce((sum, p) => sum.add(p), new T.Vector2()).multiplyScalar(1 / 3);
    for (let e = 0; e < 3; e++) {
      const a = corners[e], b = corners[(e + 1) % 3], d = b.clone().sub(a), lengthSq = d.lengthSq();
      const points = flat.map(p => ({ p, t: p.clone().sub(a).dot(d) / lengthSq }))
        .filter(({ p, t }) => t >= -1e-8 && t <= 1 + 1e-8 && Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x) < 1e-8)
        .sort((a, b) => a.t - b.t);
      for (let k = 0; k < points.length - 1; k++) {
        if (points[k + 1].t - points[k].t > 1e-8) patches.push([center, points[k].p, points[k + 1].p]);
      }
    }
  }
  const positions = [], indices = [], normals = [], n = 6;
  for (const [a, b, c] of patches) {
    const map = new Map();
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = a.x + (b.x - a.x) * i / n + (c.x - a.x) * j / n;
      const z = a.y + (b.y - a.y) * i / n + (c.y - a.y) * j / n;
      map.set(`${i},${j}`, positions.length / 3); positions.push(...roof(u, z));
      const du = new T.Vector3(...roof(Math.min(1, u + .0001), z)).sub(new T.Vector3(...roof(Math.max(-1, u - .0001), z)));
      const dz = new T.Vector3(...roof(u, Math.min(back, z + .0001))).sub(new T.Vector3(...roof(u, Math.max(front, z - .0001))));
      normals.push(...dz.cross(du).normalize().toArray());
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      const p = (x,y) => map.get(`${x},${y}`);
      indices.push(p(i,j), p(i,j+1), p(i+1,j));
      if (j < n - i - 1) indices.push(p(i+1,j), p(i,j+1), p(i+1,j+1));
    }
  }
  const shell = geometry(positions, indices);
  shell.setAttribute('normal', new T.Float32BufferAttribute(normals, 3)); return shell;
}
function cab(g, options) {
  const { width, front, back, roofFront, roofBack, height, belt, lowerSections, frontWheel, radius, material, crew } = options;
  hull(g, material, lowerSections, [frontWheel], radius, .64, front + .04);
  const roof = linearCabinSurface([[front, belt + .015], [roofFront - .07, height - .10],
    [roofFront + .12, height], [roofBack - .14, height - .01], [roofBack + .015, height - .055],
    [back, height - .18]], width * .96, belt);
  if (!crew) {
    // Close the cowl corners where the narrow cab meets the rolled bonnet.
    // Keep the center open below the dashboard rather than restoring a deck.
    const [lowerWidth, shoulder, top] = profileAt(lowerSections, front), positions = [], indices = [];
    const line = [[0, top], [.72, top - .018], [.95, shoulder + .035], [1, shoulder]];
    for (let i = 0; i <= 24; i++) {
      const p = roof(mix(-1, 1, i / 24), front), x = Math.abs(p[0]) / (lowerWidth / 2);
      let lower = shoulder;
      for (let j = 0; j < line.length - 1; j++) if (x >= line[j][0] && x <= line[j + 1][0]) {
        lower = mix(line[j][1], line[j + 1][1], (x - line[j][0]) / (line[j + 1][0] - line[j][0])); break;
      }
      positions.push(...p, p[0], Math.min(p[1], lower), front);
    }
    for (let i = 0; i < 24; i++) for (const tri of [[2*i,2*i+1,2*i+2],[2*i+1,2*i+3,2*i+2]]) {
      const [a,b,c] = tri.map(j => new T.Vector3(...positions.slice(j*3,j*3+3)));
      const normal = b.sub(a).cross(c.sub(a));
      if (normal.lengthSq() > 1e-14) indices.push(...(normal.z < 0 ? tri : [tri[0],tri[2],tri[1]]));
    }
    g.add(new T.Mesh(geometry(positions, indices), material));
  }
  const wu = roof.windowU, glassLeft = wu(-.74), glassRight = wu(.74), sideTop = wu(.715), sideBottom = wu(.97);
  const apertures = [[[glassLeft, front + .055], [glassRight, front + .055], [glassRight, roofFront - .085], [glassLeft, roofFront - .085]]];
  g.add(new T.Mesh(surface((u, v) => {
    const p = roof(mix(-1, 1, u), back); return [p[0], mix(p[1], belt - .01, v), back];
  }, 20, 2), material));
  g.add(new T.Mesh(surface((u, v) => roof(mix(glassLeft, glassRight, u), mix(front + .055, roofFront - .085, v)), 6, 6, 0), cabinGlass));
  const sideWindow = (side, lowFront, highFront, lowBack, highBack) => {
    g.add(new T.Mesh(surface((u, v) => {
      const t = mix(side === 1 ? sideTop : sideBottom, side === 1 ? sideBottom : sideTop, u), f = (t - sideTop) / (sideBottom - sideTop);
      return roof(side * t, mix(mix(highFront, lowFront, f), mix(highBack, lowBack, f), v));
    }, 6, 6, 0), cabinGlass));
    apertures.push([[side * sideTop, highFront], [side * sideBottom, lowFront], [side * sideBottom, lowBack], [side * sideTop, highBack]]);
  };
  for (const side of [-1, 1]) {
    const divider = crew ? -2.69 : back - .13;
    sideWindow(side, front + .18, roofFront + .035, divider - .055, divider - .055);
    if (crew) sideWindow(side, divider + .08, divider + .08, back - .15, back - .16);
    const handleZ = crew ? -2.90 : back - .26;
    sidePanel(g, chrome, side, width * .501, handleZ, belt - .13, .21, .045, .025, .018);
    if (crew) sidePanel(g, chrome, side, width * .501, back - .27, belt - .13, .20, .045, .025, .018);
    // A real door shut line, recessed step, mirror stalk, and two-sided mirror.
    tube(g, trim, [side * width * .496, .74, back - .13], [side * width * .496, belt - .04, back - .13], .012, 5);
    box(g, trim, [.19, .085, crew ? .63 : .67], [side * (width * .48 + .035), .58, back - .43]);
    box(g, steel, [.20, .035, crew ? .58 : .62], [side * (width * .48 + .035), .63, back - .43]);
    // Close the genuine cab aperture to the lower rolled shoulder, without
    // putting an opaque deck back beneath the glass.
    g.add(new T.Mesh(surface((u, v) => {
      const z = mix(front, back, side === 1 ? v : 1 - v);
      const [w, shoulder] = profileAt(lowerSections, z), p = roof(side, z);
      return [mix(p[0], side * w * .475, u), mix(p[1], shoulder + .035, u), z];
    }, 1, 20), material));
    // Inset reflective mirror assemblies are authored natively in Blender.
    arch(g, material, width * .5 + .012, frontWheel, radius * 1.12, radius + .004, side);
  }
  g.add(new T.Mesh(openedCabShell(roof, front, back, apertures), material));
  // Separate wipers lie on the swept front glazing, not across the roof.
  for (const side of [-1, 1]) {
    const a = roof(side * .12, front + .09), b = roof(side * .54, front + .13);
    a[2] -= .014; b[2] -= .014; tube(g, trim, a, b, .015, 5);
  }
}
function chassis(g, spec, axles) {
  for (const side of [-1, 1]) box(g, trim, [.15, .21, spec.length - .52], [side * .64, .49, .03]);
  for (const z of [-spec.length * .35, -.1, spec.length * .28]) box(g, steel, [1.42, .10, .12], [0, .49, z]);
  for (const z of axles) {
    tube(g, trim, [-spec.width * .43, spec.wheelRadius + .004, z], [spec.width * .43, spec.wheelRadius + .004, z], .10, 8);
    ellipsoid(g, trim, [.23, .19, .19], [0, spec.wheelRadius + .004, z]);
    for (const side of [-1, 1]) {
      beam(g, steel, [side * .69, .56, z - .32], [side * .69, .53, z + .32], .075, .06);
      tube(g, chrome, [side * .73, .43, z - .12], [side * .73, .79, z + .15], .027, 6);
    }
  }
  // Fuel tank and exhaust are tucked between rails instead of a flat black slab.
  cap(g, steel, .21, .87, [.76, .65, .20], 'z', 12);
  tube(g, steel, [-.48, .42, -.5], [-.48, .42, spec.length * .43], .045, 8);
}
function truckWheel(radius, width) {
  const g = new T.Group();
  const points = [[.60, -.46], [.83, -.50], [.94, -.41], [1, -.23], [1, .23], [.94, .41], [.83, .50], [.60, .46], [.60, -.46]];
  const tire = new T.Mesh(new T.LatheGeometry(points.map(([r, x]) => new T.Vector2(r * radius, x * width)), 18), rubber);
  tire.rotation.z = Math.PI / 2; g.add(tire);
  cap(g, steel, radius * .65, width * .85, [0, 0, 0], 'x', 14);
  for (const side of [-1, 1]) {
    const rim = new T.Mesh(new T.TorusGeometry(radius * .59, .018, 3, 14), steel);
    rim.rotation.y = Math.PI / 2; rim.position.x = side * width * .445; g.add(rim);
    cap(g, steel, radius * .25, .065, [side * width * .48, 0, 0], 'x', 8);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, y = Math.cos(a) * radius * .42, z = Math.sin(a) * radius * .42;
      const vent = new T.Mesh(new T.CircleGeometry(radius * .068, 5), rubber);
      vent.rotation.y = side * Math.PI / 2; vent.position.set(side * width * .437, y, z); g.add(vent);
    }
  }
  return mergeParts(g);
}
function wheels(model, spec, axleZs) {
  const tire = truckWheel(spec.wheelRadius, .29), names = ['f', 'm', 'r'];
  axleZs.forEach((z, i) => {
    for (const [side, letter] of [[-1, 'l'], [1, 'r']]) {
      const wheel = tire.clone(true);
      wheel.name = `wheel_${axleZs.length === 2 ? (i ? 'r' : 'f') : names[i]}${letter}`;
      // Cab arches are narrower than the recovery/equipment body.
      const trackHalf = i === 0 ? (spec.id === 'towtruck' ? .92 : 1.00) : spec.width * .5 - .17;
      wheel.position.set(side * trackHalf, spec.wheelRadius + .004, z);
      wheel.userData.steering = i === 0;
      model.add(wheel);
    }
  });
}
function frontDetails(g, width, z, bumperY, grilleY, material) {
  panel(g, trim, width * .94, .21, .12, [0, bumperY, z], .06);
  panel(g, material, width * .84, .12, .03, [0, bumperY + .14, z - .004], .04);
  panel(g, trim, width * .51, .33, .032, [0, grilleY, z + .015], .045);
  for (let i = 0; i < 4; i++) box(g, steel, [width * .47, .018, .035], [0, grilleY - .113 + i * .075, z - .006]);
  for (const side of [-1, 1]) {
    panel(g, chrome, width * .185, .21, .035, [side * width * .355, grilleY + .015, z + .008], .045);
    panel(g, headlights, width * .15, .13, .02, [side * width * .355, grilleY + .025, z - .012], .04);
    panel(g, side < 0 ? indicatorLeft : indicatorRight, .10, .055, .025, [side * width * .405, grilleY + .15, z + .007], .02);
    panel(g, headlights, .15, .065, .015, [side * width * .36, bumperY, z - .012], .025);
  }
  panel(g, plate, .38, .10, .014, [0, bumperY, z - .014], .012);
}
function rearLights(g, width, z, y) {
  for (const side of [-1, 1]) {
    panel(g, trim, .22, .35, .04, [side * width * .40, y, z], .035);
    panel(g, baseBrake, .16, .16, .025, [side * width * .40, y + .065, z + .045], .025);
    panel(g, side < 0 ? indicatorLeft : indicatorRight, .16, .07, .025, [side * width * .40, y - .068, z + .045], .02);
    panel(g, headlights, .16, .045, .025, [side * width * .40, y - .13, z + .045], .012);
  }
}
function warningPanel(g, width, y, z) {
  panel(g, workYellow, width, .24, .02, [0, y, z], .012);
  for (let i = -3; i <= 3; i++) {
    const x = i * .22;
    const patch = geometry([x - .09, y - .11, z + .024, x + .005, y - .11, z + .024,
      x + .15, y + .11, z + .024, x + .055, y + .11, z + .024], [0, 1, 2, 0, 2, 3]);
    g.add(new T.Mesh(patch, trim));
  }
}
function towTruck(spec) {
  const g = new T.Group(), axles = [-2.53, 1.99];
  chassis(g, spec, axles);
  cab(g, { width: 2.06, front: -2.53, back: -.63, roofFront: -1.98, roofBack: -.77,
    height: 2.48, belt: 1.34, frontWheel: axles[0], radius: spec.wheelRadius, material: basePaint,
    lowerSections: [[-3.48, 1.83, 1.06, 1.19], [-3.30, 2.00, 1.18, 1.33], [-2.58, 2.08, 1.24, 1.39],
      [-1.90, 2.06, 1.29, 1.40], [-.76, 2.06, 1.30, 1.40], [-.63, 1.98, 1.27, 1.37]] });
  frontDetails(g, 2.06, -3.6015, .74, 1.02, basePaint);
  // A recovery body, not a freight bed: low open deck, separate tool lockers,
  // telescoping boom, drum winch, cable, and a folded wheel-lift yoke.
  box(g, steel, [2.18, .12, 3.84], [0, 1.10, 1.24]);
  hull(g, workYellow, [[-.65, 2.27, 1.21, 1.31], [-.49, 2.32, 1.27, 1.34], [2.82, 2.32, 1.27, 1.34], [3.11, 2.18, 1.17, 1.27]], axles.slice(1), spec.wheelRadius, .69);
  for (const side of [-1, 1]) {
    // The central open trough is layered above the merged carrier shell.
    sidePanel(g, trim, side, 1.167, .10, .99, 1.12, .39, .018);
    sidePanel(g, steel, side, 1.183, .10, .99, 1.05, .33, .015);
    sidePanel(g, chrome, side, 1.180, .10, 1.06, .19, .034, .018, .012);
    sidePanel(g, trim, side, 1.165, 2.84, 1.06, .40, .31, .018);
    sidePanel(g, steel, side, 1.183, 2.84, 1.06, .34, .25, .015);
    arch(g, workYellow, 1.164, axles[1], spec.wheelRadius * 1.12, spec.wheelRadius + .004, side);
    box(g, rubber, [.34, .36, .055], [side * .99, .46, 2.56]);
    // Protective headboard struts and equipment trays remain visibly separate.
    beam(g, workYellow, [side * .79, 1.25, -.54], [side * .79, 2.50, -.54], .11);
    beam(g, workYellow, [side * .79, 1.27, .12], [side * .79, 2.27, -.54], .09);
    tube(g, steel, [side * 1.03, 1.43, .20], [side * 1.03, 1.43, 2.70], .032);
    for (const z of [.20, 2.70]) tube(g, steel, [side * 1.03, 1.28, z], [side * 1.03, 1.43, z], .025);
    ellipsoid(g, amber, [.105, .13, .105], [side * .79, 2.65, -.54]);
    box(g, trim, [.28, .045, .24], [side * .79, 2.515, -.54]);
    sidePanel(g, amber, side, 1.185, .73, 1.21, .10, .05, .012, .01);
  }
  box(g, trim, [1.38, .07, 3.55], [0, 1.36, 1.25]);
  box(g, workYellow, [1.69, .13, .16], [0, 2.48, -.54]);
  for (const x of [-.50, 0, .50]) box(g, steel, [.025, .67, .03], [x, 2.0, -.55]);
  box(g, workYellow, [1.58, .04, .04], [0, 2.28, -.55]);
  box(g, workYellow, [1.58, .04, .04], [0, 1.68, -.55]);
  // Winch drum and fairlead, fully modeled instead of a painted decal.
  cap(g, steel, .20, .64, [0, 1.67, -.11], 'x');
  for (const side of [-1, 1]) cap(g, workYellow, .255, .065, [side * .34, 1.67, -.11], 'x');
  for (let i = 0; i < 9; i++) {
    const ring = new T.Mesh(new T.TorusGeometry(.205, .011, 4, 12), trim);
    ring.rotation.y = Math.PI / 2; ring.position.set(-.27 + i * .067, 1.67, -.11); g.add(ring);
  }
  box(g, workYellow, [.74, .22, .54], [0, 1.45, .34]);
  beam(g, workYellow, [0, 1.48, .23], [0, 2.34, 2.16], .40, .35);
  beam(g, steel, [0, 2.34, 2.06], [0, 2.48, 2.74], .26, .23);
  cap(g, steel, .13, .47, [0, 1.55, .30], 'x', 12);
  for (const side of [-1, 1]) {
    tube(g, workYellow, [side * .32, 1.39, .58], [side * .32, 1.79, 1.33], .082);
    tube(g, chrome, [side * .32, 1.79, 1.33], [side * .32, 2.17, 1.98], .041);
    cap(g, steel, .075, .07, [side * .36, 2.17, 1.98], 'x', 8);
  }
  cap(g, trim, .13, .12, [0, 2.46, 2.79], 'x', 12);
  tube(g, steel, [0, 1.87, -.07], [0, 2.57, 2.79], .014, 5);
  tube(g, steel, [0, 2.47, 2.85], [0, 1.59, 2.95], .016, 5);
  const hook = new T.Mesh(new T.TorusGeometry(.10, .031, 6, 12, Math.PI * 1.6), steel);
  hook.rotation.y = Math.PI / 2; hook.rotation.z = -.6; hook.position.set(0, 1.50, 2.95); g.add(hook);
  // Stowed hydraulic underlift and tire cradles establish a distinct rear view.
  beam(g, trim, [0, .62, 1.73], [0, .63, 3.28], .23, .18);
  tube(g, chrome, [0, .77, 2.08], [0, .77, 3.03], .055);
  box(g, workYellow, [1.68, .13, .18], [0, .65, 3.30]);
  for (const side of [-1, 1]) {
    box(g, steel, [.12, .13, .45], [side * .72, .65, 3.40]);
    box(g, workYellow, [.39, .10, .12], [side * .58, .64, 3.565]);
  }
  warningPanel(g, 1.74, 1.00, 3.18);
  rearLights(g, 2.30, 3.15, 1.00);
  panel(g, plate, .39, .10, .016, [0, .83, 3.214], .012);
  const model = mergeParts(g); wheels(model, spec, axles);
  return model;
}
function fireTruck(spec) {
  const g = new T.Group(), axles = [-3.09, 1.61, 2.91];
  chassis(g, spec, axles);
  cab(g, { width: 2.23, front: -4.13, back: -1.28, roofFront: -3.77, roofBack: -1.45,
    height: 2.83, belt: 1.56, frontWheel: axles[0], radius: spec.wheelRadius, material: rescueRed, crew: true,
    lowerSections: [[-4.12, 2.14, 1.55, 1.61], [-3.98, 2.20, 1.55, 1.64], [-3.45, 2.23, 1.50, 1.61],
      [-1.44, 2.23, 1.50, 1.61], [-1.28, 2.15, 1.47, 1.59]] });
  frontDetails(g, 2.23, -4.2765, .76, 1.18, white);
  // Crew-cab belt and sill stripe: permanent rescue livery, not random traffic paint.
  for (const side of [-1, 1]) {
    sidePanel(g, white, side, 1.118, -2.12, 1.29, 1.43, .17, .018, .018);
    sidePanel(g, trim, side, 1.119, -2.65, 1.15, .018, .55, .018, .005);
    sidePanel(g, white, side, 1.078, -3.80, 1.28, .46, .17, .016, .018);
  }
  hull(g, rescueRed, [[-1.17, 2.30, 2.62, 2.71], [-1.03, 2.36, 2.67, 2.76],
    [3.91, 2.36, 2.67, 2.76], [4.12, 2.30, 2.60, 2.69]], axles.slice(1), spec.wheelRadius, .64);
  for (const side of [-1, 1]) {
    const x = 1.180;
    // Raised roller-shutter bays are physically inset in a painted metal frame.
    for (const [z, width] of [[-.28, 1.48], [1.36, 1.48], [3.09, 1.54]]) {
      sidePanel(g, trim, side, x, z, 2.04, width, 1.13, .018);
      sidePanel(g, steel, side, x + .024, z, 2.04, width - .085, 1.045, .015, .02);
      for (let i = 0; i < 9; i++) box(g, trim, [.011, .012, width - .10], [side * (x + .044), 1.59 + i * .112, z]);
      sidePanel(g, chrome, side, x + .048, z, 1.60, .36, .039, .018, .01);
    }
    sidePanel(g, white, side, x + .008, 1.42, 1.39, 4.92, .15, .02, .012);
    // Deep forward equipment locker is below the upper bank, between wheel bays.
    sidePanel(g, trim, side, x, -.31, .94, 1.43, .55, .018);
    sidePanel(g, steel, side, x + .022, -.31, .94, 1.35, .47, .016, .02);
    sidePanel(g, chrome, side, x + .042, -.31, 1.07, .26, .035, .018, .01);
    for (const z of axles.slice(1)) arch(g, rescueRed, 1.212, z, spec.wheelRadius * 1.12, spec.wheelRadius + .004, side);
    box(g, rubber, [.38, .35, .055], [side * 1.02, .44, 3.54]);
    for (const z of [-.93, .70, 3.92]) sidePanel(g, amber, side, 1.220, z, 1.30, .10, .05, .012, .01);
    tube(g, steel, [side * 1.10, 2.87, -.98], [side * 1.10, 2.87, 3.96], .028);
    for (const z of [-.98, 1.49, 3.96]) tube(g, steel, [side * 1.10, 2.71, z], [side * 1.10, 2.87, z], .025);
  }
  // Low-profile lightbar: no flashing, strobe effects, or emergency interaction.
  box(g, trim, [1.52, .075, .26], [0, 2.92, -3.32]);
  for (const side of [-1, 1]) {
    ellipsoid(g, blue, [.31, .10, .14], [side * .48, 3.01, -3.32]);
    box(g, white, [.14, .11, .23], [side * .10, 3.00, -3.32]);
    box(g, trim, [.15, .11, .20], [side * .55, 2.855, -3.32]);
    panel(g, blue, .11, .08, .025, [side * .66, 1.42, -4.17], .02);
  }
  // Nested roof ladder on a raised rack, with individual rungs and side rails.
  for (const z of [-.58, 3.28]) {
    box(g, trim, [1.16, .10, .17], [.29, 2.84, z]);
    for (const x of [-.20, .78]) box(g, steel, [.065, .21, .12], [x, 2.88, z]);
  }
  for (const [y, half, first, last] of [[3.02, .47, -.85, 3.86], [3.17, .36, -.56, 3.62]]) {
    for (const side of [-1, 1]) box(g, chrome, [.055, .10, last - first], [.29 + side * half, y, (first + last) / 2]);
    for (let z = first + .14; z < last - .08; z += .34) box(g, chrome, [half * 2, .045, .045], [.29, y, z]);
  }
  // Two ribbed suction hoses beside the ladder, supported by a red carrier tray.
  box(g, rescueRed, [.52, .07, 4.36], [-.75, 2.84, 1.46]);
  for (const x of [-.88, -.62]) {
    tube(g, rubber, [x, 2.98, -.67], [x, 2.98, 3.54], .105, 10);
    for (const z of [-.64, .37, 1.40, 2.42, 3.52]) cap(g, steel, .116, .065, [x, 2.98, z], 'z', 10);
  }
  // Rear pump recess, gauges, hose reel, and access ladder make the rear legible.
  panel(g, trim, 1.87, 1.26, .025, [0, 1.89, 4.13], .055);
  panel(g, steel, 1.77, 1.16, .025, [0, 1.89, 4.16], .035);
  for (let i = 0; i < 8; i++) box(g, trim, [1.72, .014, .014], [0, 1.40 + i * .138, 4.191]);
  panel(g, trim, 1.13, .53, .025, [-.27, 1.04, 4.14], .035);
  panel(g, steel, 1.04, .45, .025, [-.27, 1.04, 4.17], .02);
  for (const x of [-.59, -.29, .01]) {
    cap(g, trim, .075, .025, [x, 1.15, 4.21], 'z', 12);
    cap(g, white, .055, .018, [x, 1.15, 4.228], 'z', 12);
    tube(g, trim, [x, 1.15, 4.24], [x + .027, 1.177, 4.24], .007, 4);
    cap(g, chrome, .07, .055, [x, .91, 4.22], 'z', 10);
  }
  // Compact booster reel sits beside the pump controls; wound hose is real geometry.
  cap(g, rescueRed, .23, .14, [.52, 1.00, 4.16], 'z', 16);
  for (const r of [.10, .15, .20]) {
    const coil = new T.Mesh(new T.TorusGeometry(r, .024, 5, 16), rubber);
    coil.position.set(.52, 1.00, 4.244); g.add(coil);
  }
  for (const x of [.83, 1.06]) tube(g, chrome, [x, .75, 4.23], [x, 2.85, 4.23], .026, 6);
  for (let y = .91; y < 2.80; y += .28) tube(g, chrome, [.83, y, 4.23], [1.06, y, 4.23], .022, 6);
  panel(g, white, 2.31, .14, .035, [0, .67, 4.18], .025);
  box(g, trim, [2.37, .14, .17], [0, .51, 4.215]);
  rearLights(g, 2.36, 4.14, 1.04);
  panel(g, plate, .38, .10, .016, [0, .67, 4.221], .012);
  const model = mergeParts(g); wheels(model, spec, axles);
  model.traverse(node => { if (node.isMesh && node.material === rescueRed) node.name = 'body_fixed'; });
  model.userData.fixedLivery = true;
  return model;
}

export function buildSpecialVehicle(kind, spec = trafficDefinition(kind)) {
  if (kind !== 'towtruck' && kind !== 'firetruck') throw new RangeError(`Unknown special vehicle: ${kind}`);
  const model = kind === 'towtruck' ? towTruck(spec) : fireTruck(spec);
  Object.assign(model.userData, {
    kind, category: 'special', wheelRadius: spec.wheelRadius, length: spec.length,
    width: spec.width, height: spec.height,
    equipment: kind === 'towtruck' ? ['winch', 'hydraulic-boom', 'wheel-lift'] : ['crew-cab', 'equipment-lockers', 'hose-reel', 'roof-ladder'],
  });
  return model;
}
