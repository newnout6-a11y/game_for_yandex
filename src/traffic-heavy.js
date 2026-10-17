import * as T from '../public/vendor/three.js';
import { TRAFFIC_CATALOG } from './traffic-catalog.js';
import { trim, glass, chrome, rubber, headlights, plate, basePaint, baseBrake, box, ellipsoid, panel, mergeParts, geometry, surface } from './traffic-model-kit.js';

// Original freight vehicles. All dimensions are metres, front is -Z, and the
// contact plane is Y=0. Only the trailer pivot and individual wheels move.
const cargoSkin = new T.MeshStandardMaterial({ color: '#d5dcdb', metalness: .26, roughness: .53 });
const amber = new T.MeshStandardMaterial({ color: '#eea02f', emissive: '#e18a19', emissiveIntensity: .14, roughness: .4 });
const wheelMaterial = new T.MeshStandardMaterial({ vertexColors: true, metalness: .28, roughness: .64 });
const wheelTemplates = new Map();

function cylinder(group, material, radius, length, position, rotation = null, segments = 12) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, length, segments), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}
function beam(group, material, start, end, radius = .022, segments = 6) {
  const a = new T.Vector3(...start), b = new T.Vector3(...end), delta = b.clone().sub(a);
  const mesh = cylinder(group, material, radius, delta.length(), a.clone().add(b).multiplyScalar(.5).toArray(), null, segments);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}
function roundedBox(group, material, size, position, radius = .06) {
  const [w, h, d] = size, r = Math.min(radius, w * .2, h * .2, d * .2);
  const x = w / 2 - r, y = h / 2 - r, shape = new T.Shape();
  shape.moveTo(-x, -y); shape.lineTo(x, -y); shape.lineTo(x, y); shape.lineTo(-x, y); shape.closePath();
  const geom = new T.ExtrudeGeometry(shape, { depth: d - 2 * r, bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 3, steps: 1, curveSegments: 2 });
  geom.translate(0, 0, -d / 2 + r);
  const mesh = new T.Mesh(geom, material); mesh.position.set(...position); group.add(mesh); return mesh;
}
function sidePolygon(group, material, side, x, points) {
  const shape = new T.Shape();
  points.forEach(([z, y], i) => i ? shape.lineTo(-z, y) : shape.moveTo(-z, y));
  shape.closePath();
  const geom = new T.ShapeGeometry(shape, 4);
  geom.rotateY(Math.PI / 2); geom.translate(side * x, 0, 0);
  // The glass material is double-sided. Body-mounted inserts are flipped on
  // the left so their outward-facing normals remain physically meaningful.
  if (side < 0 && material !== glass) {
    const index = geom.index;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b);
    }
    geom.computeVertexNormals();
  }
  group.add(new T.Mesh(geom, material));
}
function arch(group, material, side, x, wheelZ, radius, wheelY, width = .095, depth = .11) {
  const positions = [], indices = [], count = 14;
  // A genuine hollow wheel arch, not a dark disk pasted over solid bodywork.
  for (let i = 0; i <= count; i++) {
    const a = -.07 + i / count * (Math.PI + .14);
    for (const [xx, r] of [[x - depth / 2, radius], [x + depth / 2, radius], [x + depth / 2, radius + width], [x - depth / 2, radius + width]]) {
      positions.push(side * xx, wheelY + Math.sin(a) * r, wheelZ + Math.cos(a) * r);
    }
  }
  for (let i = 0; i < count; i++) for (let j = 0; j < 4; j++) {
    const a = i * 4 + j, b = i * 4 + (j + 1) % 4, c = a + 4, d = b + 4;
    if (side > 0) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
  }
  group.add(new T.Mesh(geometry(positions, indices), material));
}

// One draw call per wheel, including tread shoulders, dual tires, steel dish,
// hub, ventilation apertures and lug nuts. Vertex colors preserve each finish
// without multiplying draw calls for every wheel of a five-axle combination.
function mergeWheelColors(parts) {
  parts.updateMatrixWorld(true);
  const positions = [], normals = [], colors = [];
  for (const mesh of parts.children) {
    const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const geom = transformed.index ? transformed.toNonIndexed() : transformed;
    const p = geom.attributes.position, n = geom.attributes.normal, color = mesh.material.color;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    geom.dispose(); if (geom !== transformed) transformed.dispose(); mesh.geometry.dispose();
  }
  const result = new T.BufferGeometry();
  result.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  result.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  const mesh = new T.Mesh(result, wheelMaterial); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
// Offline blockout only. create_traffic_heavy.py replaces these assemblies with
// Blender-authored rounded tires, true vented steel webs and axle-specific hubs.
function freightWheel(radius, dual) {
  const key = `${radius}:${dual}`;
  if (wheelTemplates.has(key)) return wheelTemplates.get(key).clone();
  const parts = new T.Group(), tireWidth = dual ? .205 : .275;
  const tireOffsets = dual ? [-.116, .116] : [0];
  for (const offset of tireOffsets) {
    const contour = [[.64, -.45], [.85, -.5], [.96, -.37], [1, -.18], [1, .18], [.96, .37], [.85, .5], [.64, .45], [.64, -.45]];
    const mesh = new T.Mesh(new T.LatheGeometry(contour.map(([r, y]) => new T.Vector2(r * radius, y * tireWidth)), 16), rubber);
    mesh.rotation.z = Math.PI / 2; mesh.position.x = offset; parts.add(mesh);
  }
  const outer = dual ? .223 : .137;
  cylinder(parts, trim, radius * .67, outer * 1.25, [0, 0, 0], [0, 0, Math.PI / 2], 12);
  // Only the exposed outer rim needs a detailed face. The mesh is reflected
  // across X on the opposite vehicle side, while the axle conceals its back.
  const dish = new T.Mesh(new T.LatheGeometry([
    new T.Vector2(radius * .18, -.035), new T.Vector2(radius * .51, -.005),
    new T.Vector2(radius * .65, .012), new T.Vector2(radius * .69, .035),
  ].reverse(), 16), chrome);
  dish.rotation.z = -Math.PI / 2; dish.position.x = outer - .025; parts.add(dish);
  cylinder(parts, chrome, radius * .19, .07, [outer + .016, 0, 0], [0, 0, Math.PI / 2], 8);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const vent = new T.Mesh(new T.CircleGeometry(radius * .065, 6), trim);
    vent.rotation.y = Math.PI / 2; vent.position.set(outer - .012, Math.cos(a) * radius * .46, Math.sin(a) * radius * .46); parts.add(vent);
    box(parts, chrome, [.022, .034, .034], [outer + .06, Math.cos(a) * radius * .26, Math.sin(a) * radius * .26]);
  }
  const mesh = mergeWheelColors(parts); wheelTemplates.set(key, mesh); return mesh.clone();
}
function addAxle(model, parts, { z, radius, width, name, dual = true, steer = false, offsetZ = 0 }) {
  const centerY = radius + .012, track = width / 2 - (dual ? .25 : .175);
  cylinder(parts, trim, .10, track * 2, [0, centerY, z], [0, 0, Math.PI / 2], 10);
  if (!steer) ellipsoid(parts, trim, [.24, .21, .21], [0, centerY + .025, z]);
  for (const side of [-1, 1]) {
    const wheel = new T.Group(); wheel.name = `wheel_${name}${side < 0 ? 'l' : 'r'}`;
    wheel.rotation.order = 'YXZ'; wheel.position.set(side * track, centerY, z - offsetZ);
    wheel.userData.steer = steer; wheel.userData.radius = radius;
    const assembly = freightWheel(radius, dual); assembly.scale.x = side; wheel.add(assembly); model.add(wheel);
    box(parts, trim, [.10, .08, .84], [side * .62, centerY + .21, z]);
  }
}

function addCab(parts, { front, rear, width, height, wheelZ, radius, sleeper = false }) {
  const floor = radius + .012, r = radius + .095, half = width / 2, bevel = .055;
  // A beveled, sculpted forward-control cab with an actual open front arch.
  const shape = new T.Shape();
  const p = (z, y) => [-z, y];
  shape.moveTo(...p(front + .05, .58));
  shape.lineTo(...p(front, 1.48));
  shape.lineTo(...p(front + .035, 1.84));
  shape.lineTo(...p(front + .22, height - .16));
  shape.quadraticCurveTo(...p(front + .28, height), ...p(front + .47, height));
  shape.lineTo(...p(rear - .20, height));
  shape.quadraticCurveTo(...p(rear, height), ...p(rear, height - .18));
  shape.lineTo(...p(rear, floor));
  shape.lineTo(...p(wheelZ + r, floor));
  for (let i = 1; i <= 20; i++) {
    const a = Math.PI * i / 20; shape.lineTo(...p(wheelZ + Math.cos(a) * r, floor + Math.sin(a) * r));
  }
  shape.lineTo(...p(front + .05, floor)); shape.closePath();
  const geom = new T.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 5, steps: 1 });
  geom.rotateY(Math.PI / 2); geom.translate(-half + bevel, 0, 0); parts.add(new T.Mesh(geom, basePaint));
  const windLow = 1.91, windHigh = Math.min(height - .30, sleeper ? 2.94 : 2.58);
  const frontZ = y => front + .035 + (y - 1.84) / (height - .16 - 1.84) * .185;
  // Both windscreen and gasket follow the cab's inclined, lightly wrapped face.
  for (const [material, margin] of [[trim, .035], [glass, 0]]) {
    parts.add(new T.Mesh(surface((u, v) => {
      const y = windLow - margin + v * (windHigh - windLow + 2 * margin);
      const x = (u * 2 - 1) * (width * .411 + margin) * (1 - .035 * v);
      return [x, y, frontZ(y) - (material === glass ? .080 : .074) + Math.pow(Math.abs(u * 2 - 1), 5) * .019];
    }, 10, 5), material));
  }
  beam(parts, trim, [-.02, windLow, frontZ(windLow) - .084], [-.02, windHigh, frontZ(windHigh) - .084], .015);
  for (const side of [-1, 1]) {
    const windowRear = sleeper ? front + 1.61 : rear - .15;
    const points = [[front + .20, 1.88], [front + .39, windHigh + .025], [windowRear - .02, windHigh + .025], [windowRear, 1.88]];
    sidePolygon(parts, trim, side, half + .011, points.map(([z, y], i) => [z + (i < 2 ? -.035 : .035), y + (i === 0 || i === 3 ? -.035 : .035)]));
    sidePolygon(parts, glass, side, half + .017, points);
    // Small triangular vent pane and a lower visibility pane in the door.
    beam(parts, trim, [side * (half + .023), 1.89, front + .63], [side * (half + .023), windHigh + .01, front + .65], .012);
    if (sleeper) {
      sidePolygon(parts, glass, side, half + .015, [[rear - .58, 2.14], [rear - .58, 2.61], [rear - .18, 2.61], [rear - .18, 2.14]]);
      box(parts, trim, [.021, .019, .39], [side * (half + .019), 2.10, rear - .38]);
    }
    // Door shuts, recessed handle, two perforated access steps and cab hinge.
    for (const [a, b] of [
      [[windowRear + .045, 1.13], [windowRear + .045, windHigh + .10]],
      [[front + .14, 1.66], [windowRear + .045, 1.66]],
      [[windowRear + .045, 1.14], [wheelZ + .52, 1.14]],
    ]) beam(parts, trim, [side * (half + .008), a[1], a[0]], [side * (half + .008), b[1], b[0]], .008, 4);
    roundedBox(parts, trim, [.022, .082, .23], [side * (half + .025), 1.75, windowRear - .18], .015);
    box(parts, chrome, [.03, .021, .13], [side * (half + .042), 1.77, windowRear - .18]);
    for (const [y, z] of [[.42, rear - .27], [.69, rear - .27]]) {
      box(parts, trim, [.26, .10, .44], [side * (half - .045), y, z]);
      box(parts, chrome, [.255, .016, .39], [side * (half - .045), y + .058, z]);
      for (let i = 0; i < 4; i++) box(parts, trim, [.22, .009, .023], [side * (half - .04), y + .068, z - .14 + i * .09]);
    }
    arch(parts, basePaint, side, half - .015, wheelZ, r + .01, floor, .045, .095);
    // Mirrors stay within catalog width, on a visible articulated support arm.
    const mx = half + .115;
    beam(parts, trim, [side * half, 2.29, front + .16], [side * mx, 2.32, front + .03], .023);
    beam(parts, trim, [side * half, 2.02, front + .11], [side * mx, 2.05, front + .02], .018);
    roundedBox(parts, trim, [.115, .42, .16], [side * mx, 2.25, front + .04], .025);
    box(parts, glass, [.084, .33, .018], [side * mx, 2.25, front + .133]);
    roundedBox(parts, trim, [.105, .15, .15], [side * mx, 1.94, front + .04], .025);
    box(parts, glass, [.075, .10, .018], [side * mx, 1.94, front + .126]);
    // No licensed emblems: a geometric service mark and split lamp clusters.
    roundedBox(parts, trim, [.46, .27, .055], [side * width * .355, .94, front - .018], .035);
    panel(parts, headlights, .28, .105, .027, [side * width * .35, .99, front - .061], .022);
    panel(parts, headlights, .14, .055, .024, [side * width * .39, .87, front - .06], .012);
    panel(parts, amber, .067, .13, .026, [side * width * .45, .98, front - .062], .01);
    box(parts, amber, [.016, .06, .14], [side * (half + .022), 1.38, front + .34]);
    beam(parts, trim, [side * .64, windLow + .04, frontZ(windLow) - .095], [side * .18, windLow + .20, frontZ(windLow + .2) - .10], .012, 5);
  }
  roundedBox(parts, trim, [width * .89, .21, .19], [0, .64, front + .035], .035);
  roundedBox(parts, trim, [width * .57, .55, .075], [0, 1.27, front - .025], .035);
  for (let i = 0; i < 6; i++) box(parts, chrome, [width * .51, .025, .025], [0, 1.04 + i * .083, front - .068]);
  panel(parts, plate, .40, .10, .015, [0, .66, front - .078], .009);
  panel(parts, chrome, .17, .10, .014, [0, 1.73, front + .002], .025);
  for (const side of [-1, 1]) panel(parts, headlights, .09, .035, .02, [side * width * .34, height - .13, front + .205], .008);
  if (sleeper) {
    // Tall aero sleeper, side air guides and roof seams are actual geometry.
    for (const side of [-1, 1]) {
      box(parts, trim, [.016, .023, 1.32], [side * (half + .004), height - .20, rear - .81]);
      roundedBox(parts, basePaint, [.105, 1.42, .20], [side * (half - .04), 2.08, rear + .03], .035);
    }
    for (let i = 0; i < 3; i++) box(parts, trim, [.65, .029, .045], [0, 1.50 + i * .09, rear + .064]);
  } else {
    // Curved roof fairing visually joins the lower cab to the taller cargo box.
    const roof = new T.Shape(); roof.moveTo(-front - .62, height + .015);
    roof.quadraticCurveTo(-front - .98, height + .48, -rear + .12, height + .51);
    roof.lineTo(-rear + .12, height + .015); roof.closePath();
    const fairing = new T.ExtrudeGeometry(roof, { depth: width * .79, bevelEnabled: true, bevelSize: .04, bevelThickness: .04, bevelSegments: 2, curveSegments: 8 });
    fairing.rotateY(Math.PI / 2); fairing.translate(-width * .395, 0, 0); parts.add(new T.Mesh(fairing, basePaint));
  }
}

function chassis(parts, front, rear, width, y = .81) {
  for (const side of [-1, 1]) box(parts, trim, [.14, .25, rear - front], [side * .56, y, (front + rear) / 2]);
  for (let z = front + .25; z < rear; z += .95) box(parts, trim, [1.18, .10, .12], [0, y + .015, z]);
  box(parts, trim, [width * .55, .12, .45], [0, y - .12, front + .6]);
}
function cargoBox(parts, { front, rear, width, top, bottom, ribs = false }) {
  const length = rear - front, middle = (front + rear) / 2, height = top - bottom;
  // The floor is elevated above open chassis, with distinct rear door leaves.
  roundedBox(parts, cargoSkin, [width - .035, height - .045, length - .03], [0, (top + bottom) / 2, middle], .025);
  for (const side of [-1, 1]) {
    const x = side * width / 2;
    for (const y of [bottom + .055, top - .055]) box(parts, chrome, [.045, .08, length], [x, y, middle]);
    for (const z of [front + .035, rear - .035]) box(parts, chrome, [.055, height, .065], [x, (top + bottom) / 2, z]);
    if (ribs) {
      for (let z = front + .48; z < rear - .25; z += .57) box(parts, chrome, [.019, height - .18, .022], [x + side * .005, (top + bottom) / 2, z]);
    } else {
      // Rigid box has broad inset panels and rivet lines, not trailer ribs.
      for (let z = front + .84; z < rear - .2; z += 1.12) {
        box(parts, chrome, [.014, height - .15, .019], [x + side * .003, (top + bottom) / 2, z]);
        for (const y of [bottom + .20, top - .20]) cylinder(parts, chrome, .015, .018, [x + side * .015, y, z], [0, 0, Math.PI / 2], 5);
      }
    }
    for (let z = front + .25; z < rear; z += 1.9) {
      box(parts, trim, [.03, .09, .16], [x + side * .012, bottom - .05, z]);
      box(parts, amber, [.033, .052, .095], [x + side * .03, bottom - .044, z]);
    }
    // Rear reflective edge strip is a physical narrow band, with no textures.
    box(parts, amber, [.022, .035, length - .22], [x + side * .012, bottom + .16, middle]);
  }
  box(parts, trim, [width - .09, height - .11, .027], [0, (top + bottom) / 2, rear + .012]);
  for (const side of [-1, 1]) {
    box(parts, cargoSkin, [width / 2 - .09, height - .18, .035], [side * width * .245, (top + bottom) / 2, rear + .033]);
    for (const y of [bottom + .35, (bottom + top) / 2, top - .35]) {
      box(parts, chrome, [.23, .06, .045], [side * width * .43, y, rear + .075]);
      cylinder(parts, chrome, .028, .11, [side * width * .465, y, rear + .081], null, 8);
    }
    cylinder(parts, chrome, .021, height - .23, [side * width * .25, (top + bottom) / 2, rear + .08], null, 8);
    box(parts, trim, [.065, .09, .04], [side * width * .25, bottom + .72, rear + .10]);
    box(parts, chrome, [.20, .029, .035], [side * width * .25 - .055, bottom + .74, rear + .12]);
    panel(parts, baseBrake, .22, .095, .025, [side * width * .36, bottom - .28, rear + .065], .018);
    panel(parts, amber, .08, .095, .027, [side * width * .435, bottom - .28, rear + .066], .009);
    panel(parts, cargoSkin, .07, .06, .022, [side * width * .29, bottom - .28, rear + .066], .008);
    box(parts, baseBrake, [.045, .27, .025], [side * (width / 2 - .065), top - .19, rear + .064]);
    box(parts, trim, [.13, .42, .12], [side * .77, bottom - .30, rear - .02]);
  }
  box(parts, chrome, [width * .91, .12, .13], [0, bottom - .51, rear + .005]);
  panel(parts, cargoSkin, .39, .10, .017, [0, bottom - .28, rear + .066], .008);
}
function sideGuards(parts, width, start, end, y) {
  for (const side of [-1, 1]) {
    for (const yy of [y, y + .21]) box(parts, chrome, [.065, .055, end - start], [side * (width / 2 - .11), yy, (start + end) / 2]);
    for (const z of [start + .14, end - .14]) box(parts, trim, [.07, .47, .06], [side * (width / 2 - .14), y + .24, z]);
  }
}
function mudflaps(parts, width, radius, axles) {
  for (const z of axles) for (const side of [-1, 1]) box(parts, trim, [.42, .46, .045], [side * (width / 2 - .26), .42, z + radius + .09]);
}

function buildBoxTruck(spec) {
  const model = new T.Group(), parts = new T.Group(), radius = spec.wheelRadius;
  const front = -spec.length / 2 + .09, rear = spec.length / 2 - .14;
  const cabRear = front + 2.23, frontAxle = front + 1.20, rearAxle = rear - 1.55;
  const cabWidth = spec.width - .39;
  chassis(parts, front + .10, rear - .14, spec.width);
  addCab(parts, { front, rear: cabRear, width: cabWidth, height: 2.83, wheelZ: frontAxle, radius });
  cargoBox(parts, { front: cabRear + .11, rear, width: spec.width - .10, top: spec.height, bottom: 1.19 });
  addAxle(model, parts, { z: frontAxle, radius, width: spec.width - .16, name: 'f', dual: false, steer: true });
  addAxle(model, parts, { z: rearAxle, radius, width: spec.width - .14, name: 'r', dual: true });
  for (const side of [-1, 1]) {
    arch(parts, trim, side, spec.width / 2 - .28, rearAxle, radius + .06, radius + .012, .06, .42);
    roundedBox(parts, chrome, [.39, .43, 1.13], [side * .87, .74, cabRear + .79], .08);
    for (const z of [cabRear + .43, cabRear + 1.14]) box(parts, trim, [.41, .045, .06], [side * .87, .95, z]);
  }
  sideGuards(parts, spec.width, cabRear + 1.53, rearAxle - .68, .57);
  mudflaps(parts, spec.width, radius, [rearAxle]);
  const staticParts = mergeParts(parts); staticParts.name = 'rigid_truck_body'; model.add(staticParts);
  return model;
}
function buildSemi(spec) {
  const model = new T.Group(), tractor = new T.Group(), trailerParts = new T.Group(), trailer = new T.Group();
  const radius = spec.wheelRadius, front = -spec.length / 2 + .09, rear = spec.length / 2 - .14;
  const cabRear = front + 2.48, frontAxle = front + 1.22, rearAxles = [spec.hitchZ - 1.40, spec.hitchZ - .13];
  // Short front overhang leaves the complete trailer corner sweep clear of
  // the cab air guides and service coils, not just the straight-line pose.
  const trailerFront = spec.trailerFrontZ ?? cabRear + 1.33, trailerAxles = [rear - 2.91, rear - 1.62];
  const cabWidth = spec.width - .39;
  chassis(tractor, front + .2, spec.hitchZ + .61, spec.width, .82);
  addCab(tractor, { front, rear: cabRear, width: cabWidth, height: 3.68, wheelZ: frontAxle, radius, sleeper: true });
  // The exposed tractor deck, twin tanks, fifth wheel and air-line coils remain
  // visible through the real open space beneath the semitrailer's nose.
  box(tractor, chrome, [1.48, .07, 1.06], [0, 1.04, cabRear + .64]);
  for (let i = 0; i < 9; i++) box(tractor, trim, [1.38, .009, .027], [0, 1.08, cabRear + .18 + i * .105]);
  for (const side of [-1, 1]) {
    roundedBox(tractor, chrome, [.47, .48, 1.14], [side * .82, .75, cabRear + .74], .12);
    for (const z of [cabRear + .40, cabRear + 1.06]) box(tractor, trim, [.48, .035, .06], [side * .82, .99, z]);
    for (const z of rearAxles) arch(tractor, trim, side, spec.width / 2 - .29, z, radius + .075, radius + .012, .055, .43);
    box(tractor, basePaint, [.06, .34, 1.15], [side * (cabWidth / 2 - .04), .61, cabRear + .69]);
    panel(tractor, baseBrake, .21, .10, .025, [side * .83, .77, spec.hitchZ + .63], .015);
  }
  const saddle = cylinder(tractor, trim, .43, .07, [0, 1.15, spec.hitchZ], null, 20);
  saddle.scale.z = 1.16;
  box(tractor, chrome, [.05, .025, .38], [0, 1.20, spec.hitchZ + .25]);
  for (const [x, y, material] of [[-.27, 1.50, amber], [.05, 1.58, baseBrake], [.34, 1.48, trim]]) {
    const curve = new T.CatmullRomCurve3(Array.from({ length: 37 }, (_, i) => {
      const t = i / 36; return new T.Vector3(x + Math.sin(t * Math.PI * 12) * .065, y + Math.cos(t * Math.PI * 12) * .065 - .22 * Math.sin(t * Math.PI), cabRear + .07 + .47 * t);
    }));
    tractor.add(new T.Mesh(new T.TubeGeometry(curve, 24, .013, 3, false), material));
  }
  addAxle(model, tractor, { z: frontAxle, radius, width: spec.width - .15, name: 'f', dual: false, steer: true });
  rearAxles.forEach((z, i) => addAxle(model, tractor, { z, radius, width: spec.width - .14, name: `tractor${i + 1}_`, dual: true }));
  mudflaps(tractor, spec.width, radius, [rearAxles[1]]);
  const tractorStatic = mergeParts(tractor); tractorStatic.name = 'tractor'; model.add(tractorStatic);

  cargoBox(trailerParts, { front: trailerFront, rear, width: spec.width - .10, top: spec.height, bottom: 1.32, ribs: true });
  chassis(trailerParts, trailerFront + .14, rear - .12, spec.width, 1.13);
  // Retracted landing legs, diagonal braces and side-impact rails, not a solid
  // skirt: all the daylight under the trailer remains visible from the road.
  for (const side of [-1, 1]) {
    const legZ = spec.hitchZ + 1.68;
    box(trailerParts, trim, [.12, .64, .15], [side * .74, 1.0, legZ]);
    box(trailerParts, chrome, [.31, .055, .28], [side * .74, .70, legZ]);
    beam(trailerParts, trim, [side * .74, .80, legZ], [side * .55, 1.20, legZ + .70], .029);
    for (const z of trailerAxles) arch(trailerParts, trim, side, spec.width / 2 - .27, z, radius + .055, radius + .012, .055, .40);
  }
  sideGuards(trailerParts, spec.width, spec.hitchZ + 2.18, trailerAxles[0] - .78, .57);
  trailerAxles.forEach((z, i) => addAxle(trailer, trailerParts, { z, radius, width: spec.width - .14, name: `trailer${i + 1}_`, dual: true, offsetZ: spec.hitchZ }));
  mudflaps(trailerParts, spec.width, radius, [trailerAxles[1]]);
  const trailerStatic = mergeParts(trailerParts); trailerStatic.position.z = -spec.hitchZ; trailerStatic.name = 'trailer_body'; trailer.add(trailerStatic);
  trailer.name = 'trailer'; trailer.position.z = spec.hitchZ; trailer.userData.hitchZ = spec.hitchZ; model.add(trailer);
  model.userData.articulated = true; model.userData.hitchZ = spec.hitchZ;
  model.userData.trailerFrontZ = trailerFront; model.userData.trailerRearZ = rear + .14;
  return model;
}

export function buildHeavyVehicle(kind, spec = TRAFFIC_CATALOG[kind]) {
  if (!spec || (kind !== 'boxtruck' && kind !== 'semi')) throw new Error(`Unsupported heavy traffic kind: ${kind}`);
  const model = kind === 'semi' ? buildSemi(spec) : buildBoxTruck(spec);
  model.name = kind;
  model.userData.kind = kind; model.userData.wheelRadius = spec.wheelRadius;
  model.userData.length = spec.length; model.userData.category = 'freight';
  return model;
}
