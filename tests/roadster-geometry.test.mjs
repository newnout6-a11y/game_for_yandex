import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { createCar, setPlayerAeroPose } from '../src/car.js';

const { scene } = await loadRoadsterGeometry();
const root = scene.getObjectByName('Roadster');
const names = ['fl', 'fr', 'rl', 'rr'];

/** Read actual indexed triangles in the supplied coordinate frame. */
function triangles(mesh, matrix) {
  const { position } = mesh.geometry.attributes, index = mesh.geometry.index, out = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const v = [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(matrix));
    out.push({ v, box: new T.Box3().setFromPoints(v), mesh: mesh.name, index: i / 3 });
  }
  return out;
}

/** Bounds prune the search only; they are never a collision verdict. */
function tree(list) {
  const box = new T.Box3();
  for (const t of list) box.union(t.box);
  if (list.length <= 12) return { box, list };
  const size = box.getSize(new T.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  list.sort((a, b) => a.box.min[axis] + a.box.max[axis] - b.box.min[axis] - b.box.max[axis]);
  const middle = list.length >> 1;
  return { box, left: tree(list.slice(0, middle)), right: tree(list.slice(middle)) };
}

const edgeRay = new T.Ray(), delta = new T.Vector3(), hitPoint = new T.Vector3();
/** A genuine finite edge/triangle piercing, with a 2 micrometre contact tolerance. */
function edgeHit(a, b, acceptPoint = () => true) {
  for (let i = 0; i < 3; i++) {
    const start = a[i], length = delta.copy(a[(i + 1) % 3]).sub(start).length();
    if (length < 2e-6) continue;
    edgeRay.set(start, delta.multiplyScalar(1 / length));
    if (edgeRay.intersectTriangle(b[0], b[1], b[2], false, hitPoint)) {
      const distance = hitPoint.distanceTo(start);
      if (distance > 2e-6 && distance < length - 2e-6) {
        const point = hitPoint.toArray();
        if (acceptPoint(point)) return point;
      }
    }
  }
  return null;
}

/** Find an actual two-way edge/triangle crossing in a BVH candidate pair. */
function crossing(triangle, node, accept = () => true) {
  if (!triangle.box.intersectsBox(node.box)) return null;
  if (node.list) {
    for (const other of node.list) {
      if (!triangle.box.intersectsBox(other.box)) continue;
      const acceptPoint = point => accept({ point, fixedMesh: other.mesh });
      const point = edgeHit(triangle.v, other.v, acceptPoint) || edgeHit(other.v, triangle.v, acceptPoint);
      if (point) return { wheelMesh: triangle.mesh, wheelTriangle: triangle.index, fixedMesh: other.mesh, fixedTriangle: other.index, point };
    }
    return null;
  }
  return crossing(triangle, node.left, accept) || crossing(triangle, node.right, accept);
}

/** Cast in authored root coordinates, retaining exported culling/visibility. */
function cast(origin, direction, objects = scene.children, far = 10) {
  const worldOrigin = new T.Vector3(...origin).applyMatrix4(root.matrixWorld);
  const worldDirection = new T.Vector3(...direction).transformDirection(root.matrixWorld);
  return new T.Raycaster(worldOrigin, worldDirection, 1e-5, far).intersectObjects(objects, true);
}

test('clearance predicate rejects overlapping bounds unless real triangles pierce', () => {
  const record = (points, name) => {
    const v = points.map(p => new T.Vector3(...p));
    return { v, box: new T.Box3().setFromPoints(v), mesh: name, index: 0 };
  };
  const a = record([[0, 0, 0], [2, 0, 0], [0, 2, 0]], 'fixed');
  const separated = record([[1.6, 1.6, -1], [1.6, 1.6, 1], [2, 2, 1]], 'separated');
  const piercing = record([[.2, .2, -1], [.2, .2, 1], [1, 1, 1]], 'piercing');
  assert.ok(a.box.intersectsBox(separated.box), 'Deliberately overlapping broad-phase bounds');
  assert.equal(crossing(separated, tree([a])), null);
  assert.ok(crossing(piercing, tree([a])), 'The narrow phase must detect a real piercing');
});

test('exported Roadster normals and positions are finite, with unit shading normals', () => {
  let vertices = 0;
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const { position, normal } = mesh.geometry.attributes;
    assert.equal(normal?.count, position.count, `${mesh.name}: normal per vertex`);
    for (let i = 0; i < position.count; i++) {
      const p = new T.Vector3().fromBufferAttribute(position, i), n = new T.Vector3().fromBufferAttribute(normal, i);
      assert.ok([...p.toArray(), ...n.toArray()].every(Number.isFinite), `${mesh.name} vertex ${i}: finite components`);
      assert.ok(Math.abs(n.length() - 1) < 2e-4, `${mesh.name} vertex ${i}: normal length ${n.length()}`);
    }
    vertices += position.count;
  });
  assert.ok(vertices > 10000, 'Validate the detailed export, not an empty/stub mesh');
});

test('exported triangles are nondegenerate and painted batches contain no duplicate faces', () => {
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const ab = new T.Vector3(), ac = new T.Vector3(), bc = new T.Vector3(), normal = new T.Vector3();
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const { position } = mesh.geometry.attributes, index = mesh.geometry.index, seen = new Map();
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2);
      ab.subVectors(b, a); ac.subVectors(c, a); bc.subVectors(c, b);
      const longestEdgeSquared = Math.max(ab.lengthSq(), ac.lengthSq(), bc.lengthSq());
      const areaSquaredTimesFour = normal.crossVectors(ab, ac).lengthSq();
      // Relative angular tolerance preserves deliberately tiny stitch/letter
      // geometry, but cannot let a collinear or collapsed triangle pass.
      assert.ok(areaSquaredTimesFour > longestEdgeSquared ** 2 * 1e-16, `${mesh.name} triangle ${i / 3}: degenerate relative to its own edge lengths`);
      if (mesh.material.name === 'body') {
        const key = [a, b, c].map(p => p.toArray().map(value => Math.round(value * 1e7)).join(',')).sort().join('|');
        assert.ok(!seen.has(key), `${mesh.name}: duplicate/reversed painted triangles ${seen.get(key)} and ${i / 3} at 0.1-micrometre vertex resolution`);
        seen.set(key, i / 3);
      }
    }
  });
});

test('passenger pressure vessel is a closed measured reconstruction and clears primary cabin surfaces', () => {
  const vessel = root.getObjectByName('RC_Rocket_Passenger_Vessel_Approximate');
  const metadata = root.userData.passengerPressureVessel;
  assert.ok(vessel?.isMesh && metadata, 'Preserve the actual vessel separately from material-batched cabin trim');
  assert.equal(vessel.parent, root, 'The vessel remains static chassis geometry covered by wheel and wing clearance');
  for (const data of [vessel.userData, metadata]) {
    assert.equal(data.approximate_packaging_reconstruction, true);
    assert.equal(data.not_factory_cad_or_certified_engineering, true);
    assert.equal(data.source_nominal_capacity_liters, 400);
    assert.equal(data.evidence_url, 'https://www.youtube.com/watch?v=22rvpUecLts');
  }
  assert.equal(metadata.measured_volume_is_not_usable_capacity, true);

  const authored = triangles(vessel, root.matrixWorld.clone().invert().multiply(vessel.matrixWorld));
  const edges = new Map(), bounds = new T.Box3(), cross = new T.Vector3();
  let volume = 0;
  const vertexKey = p => p.toArray().map(value => Math.round(value * 1e7)).join(',');
  for (const { v } of authored) {
    volume += v[0].dot(cross.crossVectors(v[1], v[2])) / 6;
    for (let i = 0; i < 3; i++) {
      bounds.expandByPoint(v[i]);
      const a = vertexKey(v[i]), b = vertexKey(v[(i + 1) % 3]);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const edge = edges.get(key) || { count: 0, orientation: 0 };
      edge.count++; edge.orientation += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  assert.ok(Number.isFinite(volume) && volume > .25 && volume < .5, `Real outward-oriented vessel volume, not its bounding box: ${volume} m³`);
  for (const [key, edge] of edges) {
    assert.equal(edge.count, 2, `Closed vessel edge ${key}`);
    assert.equal(edge.orientation, 0, `Consistently oriented vessel edge ${key}`);
  }
  for (const data of [vessel.userData, metadata]) {
    assert.ok(Math.abs(volume - data.measured_outer_mesh_volume_m3) < 2e-6, 'Measured authored volume must describe these exact closed triangles');
  }
  const scaledVolume = volume * Math.abs(root.matrixWorld.determinant());
  assert.ok(Math.abs(scaledVolume - metadata.measured_outer_mesh_volume_m3_scaled) < 2e-6, 'Exported cubic metres include uniform asset scale cubed');
  bounds.getSize(new T.Vector3()).toArray().forEach((size, axis) => {
    assert.ok(Math.abs(size - metadata.authored_outer_dimensions_m[axis]) < 2e-6, `Vessel dimension ${axis} matches actual vertices`);
  });

  // Check the barrel against canopy, body, seat shells/upholstery and dashboard
  // surfaces. Polymer/metal assembly fittings deliberately mate with the barrel;
  // this is not a claim of clearance between every mount and its own vessel.
  const surroundings = ['body', 'glass', 'detail_rc_carbon', 'detail_rc_ivory',
    'detail_rc_perforated', 'detail_rc_suede', 'detail_rc_liner', 'detail_rc_console_glass'];
  const fixed = [];
  for (const name of surroundings) {
    const mesh = root.getObjectByName(name);
    assert.ok(mesh?.isMesh, `Actual ${name} cabin/body surface is present`);
    fixed.push(...triangles(mesh, mesh.matrixWorld));
  }
  const bvh = tree(fixed);
  for (const triangle of triangles(vessel, vessel.matrixWorld)) {
    const hit = crossing(triangle, bvh);
    assert.equal(hit, null, `Vessel cuts a primary cabin surface: ${JSON.stringify(hit)}`);
  }
});

test('exported wheel radius is measured in metres and rigid carriers isolate spin from calipers', () => {
  const scale = root.getWorldScale(new T.Vector3());
  assert.ok(Math.abs(scale.x - scale.y) < 1e-7 && Math.abs(scale.x - scale.z) < 1e-7);
  for (const suffix of names) {
    const carrier = scene.getObjectByName(`wheel_${suffix}`), spinner = scene.getObjectByName(`wheel_spin_${suffix}`);
    assert.equal(spinner.parent, carrier);
    assert.ok(spinner.position.length() < 1e-7, `${suffix}: spin must be centered on the axle`);
    const tire = spinner.children.find(mesh => mesh.isMesh && mesh.material.name === 'tire_rubber');
    assert.ok(tire, `${suffix}: a real rubber mesh`);
    const inverse = carrier.matrixWorld.clone().invert(), transform = inverse.multiply(tire.matrixWorld);
    let radius = 0;
    for (let i = 0; i < tire.geometry.attributes.position.count; i++) {
      const p = new T.Vector3().fromBufferAttribute(tire.geometry.attributes.position, i).applyMatrix4(transform);
      radius = Math.max(radius, Math.hypot(p.y, p.z) * scale.x);
    }
    assert.ok(Math.abs(radius - root.userData.wheelRadius) < 2e-6, `${suffix}: measured ${radius}, metadata ${root.userData.wheelRadius}`);
    assert.ok(radius > .33 && radius < .43, 'Physical radius must not use an unscaled mesh or a tiny legacy tire');
    const tireTop = cast(carrier.position.clone().add(new T.Vector3(0, 1, 0)).toArray(), [0, -1, 0], [spinner], 1.5)[0];
    assert.equal(tireTop?.object.material.name, 'tire_rubber', `${suffix}: outward tread is the actual highest wheel surface`);
    assert.ok(tireTop.face.normal.clone().transformDirection(tireTop.object.matrixWorld).y > .95, `${suffix}: tread triangles face out, not merely hidden by double-sided shading`);
    const calipers = carrier.children.filter(mesh => mesh.isMesh);
    assert.ok(calipers.some(mesh => mesh.geometry.attributes.position.count > 20), `${suffix}: fixed caliper geometry`);
    const before = calipers.map(mesh => mesh.matrixWorld.clone());
    spinner.rotation.x = 1.27;
    scene.updateMatrixWorld(true);
    calipers.forEach((mesh, i) => assert.deepEqual(mesh.matrixWorld.elements, before[i].elements));
    const axle = new T.Vector3(1, 0, 0).applyQuaternion(spinner.getWorldQuaternion(new T.Quaternion()));
    assert.ok(Math.abs(axle.y) < 1e-7, `${suffix}: spinning must not tilt the axle`);
    spinner.rotation.x = 0;
    scene.updateMatrixWorld(true);
  }
  const yoke = scene.getObjectByName('steering_yoke');
  assert.equal(yoke.userData.game_local_spin_axis, 'Z');
  const size = new T.Box3().setFromObject(yoke).getSize(new T.Vector3());
  assert.ok(size.x > .3 && size.y > .15 && size.z < .2, 'Yoke geometry must be broad, shallow and centered on its local-Z pivot');
});

test('key outside surfaces face outward and the actual front/rear lenses are not buried', () => {
  const probes = [
    ['hood', [0, 2, -1.75], [0, -1, 0], 'body'],
    ['left door', [-2, .6, 0], [1, 0, 0], 'body'],
    ['right door', [2, .6, 0], [-1, 0, 0], 'body'],
    ['canopy roof', [0, 2, 0], [0, -1, 0], 'glass'],
    ['rear LED', [0, .784, 3], [0, 0, -1], 'lights_red'],
  ];
  // The reference-shaped lamps can change outline; derive their sightline from
  // the actual light geometry rather than a stale hard-coded point on the hood.
  const white = scene.getObjectByName('detail_lights_white');
  assert.ok(white?.isMesh, 'A real white-light mesh must be exported');
  const matrix = root.matrixWorld.clone().invert().multiply(white.matrixWorld);
  const nosePoints = [];
  for (let i = 0; i < white.geometry.attributes.position.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(white.geometry.attributes.position, i).applyMatrix4(matrix);
    if (Math.abs(p.x) < .1 && p.z < -2.1) nosePoints.push(p);
  }
  assert.ok(nosePoints.length > 2, 'A real central nose LED must exist independently of the corner headlamps');
  const noseCenter = nosePoints.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(1 / nosePoints.length);
  probes.push(['nose LED', [noseCenter.x, noseCenter.y, -3], [0, 0, 1], 'LED_white']);
  for (const side of [-1, 1]) {
    const points = [];
    for (let i = 0; i < white.geometry.attributes.position.count; i++) {
      const p = new T.Vector3().fromBufferAttribute(white.geometry.attributes.position, i).applyMatrix4(matrix);
      if (p.x * side > .5 && p.y > .65 && p.z < -1.7) points.push(p);
    }
    assert.ok(points.length > 2, `${side}: a separate raised headlamp, not only the nose LED`);
    const size = new T.Box3().setFromPoints(points).getSize(new T.Vector3());
    assert.ok(size.x > .04 && size.z > .12, `${side}: a physically sized headlamp surface`);
    const center = points.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(1 / points.length);
    probes.push([`${side < 0 ? 'left' : 'right'} headlamp`, [center.x, 2, center.z], [0, -1, 0], 'LED_white']);
    const cover = scene.getObjectByName('detail_optical');
    assert.ok(cover?.isMesh, 'The long dark optical cover must be physical geometry');
    probes.push([`${side < 0 ? 'left' : 'right'} upper optical cover`, [side * .72, 2, -1.45], [0, -1, 0], cover.material.name]);
    const coverHit = cast([side * .72, 2, -1.45], [0, -1, 0], [cover])[0];
    assert.ok(coverHit, 'The intended upper cover area must exist above the front wheel station');
    const target = coverHit.point.clone().applyMatrix4(root.matrixWorld.clone().invert());
    const frontOrigin = [side * .72, 1.8, -3];
    probes.push([`${side < 0 ? 'left' : 'right'} optical cover from front`, frontOrigin,
      target.sub(new T.Vector3(...frontOrigin)).normalize().toArray(), cover.material.name]);
  }
  for (const [label, origin, direction, material] of probes) {
    const hit = cast(origin, direction)[0];
    assert.ok(hit, `${label}: actual triangle hit`);
    assert.equal(hit.object.material.name, material, `${label}: the target surface must be the visible nearest geometry, not covered by another part`);
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const towardViewer = new T.Vector3(...direction).transformDirection(root.matrixWorld).negate();
    assert.ok(normal.dot(towardViewer) > .15, `${label}: exported front-face winding must face outward even for double-sided materials`);
  }
});

test('nose perimeter closes intake-side and lower returns without exposing suspension or cabin', () => {
  const inverse = root.matrixWorld.clone().invert();
  for (const side of [-1, 1]) for (const x of [.64, .66, .68, .70]) for (const y of [.25, .32, .40, .48, .56]) {
    const hit = cast([side * x, y, -3], [0, 0, 1])[0];
    assert.ok(hit, `${side * x},${y}: front perimeter cannot be an open through-hole`);
    const p = hit.point.clone().applyMatrix4(inverse);
    assert.ok(p.z < -2.10, `${side * x},${y}: sightline reaches ${hit.object.name} at z=${p.z}, behind the actual nose shell`);
    assert.ok(['body', 'satin_carbon', 'graphite_alloy', 'LED_white'].includes(hit.object.material.name), 'An exterior skin or intake wall, not distant suspension/cabin, closes the front perimeter');
  }
});

test('rear light-band ends remain visible beyond the side-sheet returns', () => {
  const light = scene.getObjectByName('lights_red'), points = [];
  const matrix = root.matrixWorld.clone().invert().multiply(light.matrixWorld);
  for (let i = 0; i < light.geometry.attributes.position.count; i++) points.push(new T.Vector3().fromBufferAttribute(light.geometry.attributes.position, i).applyMatrix4(matrix));
  for (const side of [-1, 1]) {
    const end = Math.max(...points.map(p => side * p.x));
    // Probe within the physical terminal tube rings, not an assumed screen-space
    // lamp size or an arbitrary point that can fall outside a revised outline.
    const terminal = points.filter(p => side * p.x > end - .014);
    const target = terminal.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(1 / terminal.length);
    for (const origin of [[target.x, target.y, 3], [side * 1.6, target.y + .10, 3]]) {
      const direction = target.clone().sub(new T.Vector3(...origin)).normalize();
      const hit = cast(origin, direction.toArray())[0];
      assert.equal(hit?.object.material.name, 'lights_red', `${side}: rear terminal lens is covered by ${hit?.object.name ?? 'an empty sightline'}`);
    }
  }
});

test('authored thruster sockets coincide with real open apertures, lips and recessed throats', () => {
  const sockets = root.children.filter(node => node.userData.thrusterRole);
  assert.equal(sockets.length, 8, 'Eight authored game sockets, not a claim about an unverified real-car nozzle count');
  const metal = [];
  scene.traverse(mesh => { if (mesh.isMesh && mesh.material.name === 'underbody_satin_cast_metal') metal.push(mesh); });
  for (const socket of sockets) {
    const { thrusterDirection, thrusterRole, apertureRadius } = socket.userData;
    const direction = new T.Vector3(...thrusterDirection);
    assert.ok(Math.abs(direction.length() - 1) < 1e-6, `${socket.name}: unit emission direction`);
    assert.deepEqual(thrusterDirection, thrusterRole === 'lift' ? [0, -1, 0] : [0, 0, 1]);
    assert.ok(apertureRadius > .02 && apertureRadius < .10, `${socket.name}: physical aperture radius`);
    const tangent = new T.Vector3(1, 0, 0), bitangent = new T.Vector3().crossVectors(direction, tangent);
    for (const axis of [tangent, bitangent]) for (const sign of [-1, 1]) {
      const core = socket.position.clone().addScaledVector(axis, sign * apertureRadius * .4);
      assert.equal(cast(core.toArray(), direction.toArray(), scene.children, .35).length, 0, `${socket.name}: nozzle core must vent into free space`);
      const inside = cast(core.toArray(), direction.clone().negate().toArray(), scene.children, .16)[0];
      assert.ok(inside && inside.distance > .025 && inside.distance < .15, `${socket.name}: actual recessed inner throat, not a flush cap or floating empty socket`);
      const lip = socket.position.clone().addScaledVector(direction, .04).addScaledVector(axis, sign * apertureRadius * 1.13);
      const lipHit = cast(lip.toArray(), direction.clone().negate().toArray(), metal, .09)[0];
      assert.ok(lipHit && Math.abs(lipHit.distance - .04 * root.scale.x) < .015, `${socket.name}: machined lip must surround the aperture at its authored location`);
    }
  }
});

test('cabin has actual floor, side trim and bulkheads that occlude wheels from occupants', () => {
  const opaque = [];
  scene.traverse(mesh => { if (mesh.isMesh && !mesh.material.transparent && mesh.material.name !== 'glass') opaque.push(mesh); });
  const interior = opaque.filter(mesh => mesh.material.name.startsWith('RC_'));
  // Probe between the raised mat ribs, below the seats, so a seat or isolated
  // rib cannot masquerade as the continuous carpet/floor enclosure.
  for (const x of [-.457, .457]) {
    const floor = cast([x, .36, -.49], [0, -1, 0], [scene.getObjectByName('detail_rc_liner')], .15)[0];
    assert.ok(floor, `${x}: actual cabin floor beneath the footwell`);
    const height = floor.point.clone().applyMatrix4(root.matrixWorld.clone().invert()).y;
    assert.ok(height > .25 && height < .34, `${x}: floor is below the footwell, not a seat or roof`);
  }
  for (const [label, origin, direction] of [
    ['left inner door', [-.43, .60, 0], [-1, 0, 0]],
    ['right inner door', [.43, .60, 0], [1, 0, 0]],
    ['front firewall', [0, .48, -.4], [0, 0, -1]],
    ['rear bulkhead', [.35, .70, .7], [0, 0, 1]],
  ]) {
    const hit = cast(origin, direction, interior, 1.2)[0];
    assert.ok(hit, `${label}: a ray must hit physical cabin triangles within 1.2 m`);
  }
  let tested = 0;
  for (const origin of [[-.43, 1.02, .30], [.30, 1.02, .30], [0, .55, -.30]]) {
    for (const suffix of names) {
      const carrier = scene.getObjectByName(`wheel_${suffix}`);
      for (const dy of [-.20, 0, .20]) for (const dz of [-.20, 0, .20]) {
        const target = carrier.position.clone().add(new T.Vector3(0, dy, dz));
        const hit = cast(origin, target.sub(new T.Vector3(...origin)).normalize().toArray(), opaque)[0];
        assert.ok(hit && !hit.object.name.startsWith('wheel_'), `${origin} sees ${suffix} at offset ${dy},${dz} through a cabin gap`);
        tested++;
      }
    }
  }
  assert.equal(tested, 108);
});

test('actual tire/rim triangles clear every opaque chassis batch at sampled legal steering and spin poses', () => {
  const fixed = [];
  for (const mesh of root.children) {
    if (!mesh.isMesh || mesh.material.transparent || mesh.material.name === 'glass') continue;
    fixed.push(...triangles(mesh, mesh.matrixWorld));
  }
  const bvh = tree(fixed), failures = [];
  let poses = 0;
  // Finite pose sampling, not a claim of continuous swept-volume certification.
  // Coplanar contact/fully-contained solids are not covered by the edge test.
  for (const suffix of names) {
    for (const steer of suffix[0] === 'f' ? [-.3, -.2, -.1, 0, .1, .2, .3] : [0]) for (const spin of [0, .037, .173, .419, .777, 1.111, Math.PI]) {
      const carrier = scene.getObjectByName(`wheel_${suffix}`), spinner = scene.getObjectByName(`wheel_spin_${suffix}`);
      carrier.rotation.y = suffix[0] === 'f' ? steer : 0;
      spinner.rotation.x = spin;
      scene.updateMatrixWorld(true);
      const inverseCarrier = carrier.matrixWorld.clone().invert();
      // Only the small physical hub-attachment zone permits chassis drivetrain
      // contact. No entire material batch, arm, tire sidewall or rim is exempt.
      const drivetrain = new Set(['detail_alloy', 'detail_dark_alloy', 'detail_shield', 'detail_underbody']);
      const outsideHubAttachment = ({ point, fixedMesh }) => {
        if (!drivetrain.has(fixedMesh)) return true;
        const local = new T.Vector3(...point).applyMatrix4(inverseCarrier);
        return Math.hypot(local.y, local.z) * root.scale.x > .10;
      };
      for (const mesh of spinner.children.filter(mesh => mesh.isMesh && /rubber|alloy/.test(mesh.material.name))) {
        let hit = null;
        for (const triangle of triangles(mesh, mesh.matrixWorld)) {
          hit = crossing(triangle, bvh, outsideHubAttachment);
          if (hit) break;
        }
        if (hit && failures.length < 12) {
          const localHit = new T.Vector3(...hit.point).applyMatrix4(inverseCarrier);
          failures.push({ suffix, steer, spin, ...hit, radialMeters: Math.hypot(localHit.y, localHit.z) * root.scale.x });
        }
      }
      poses++;
    }
  }
  for (const suffix of names) {
    scene.getObjectByName(`wheel_${suffix}`).rotation.y = 0;
    scene.getObjectByName(`wheel_spin_${suffix}`).rotation.x = 0;
  }
  scene.updateMatrixWorld(true);
  assert.deepEqual(failures, [], `Real triangle piercings, not overlapping AABBs: ${JSON.stringify(failures)}`);
  assert.equal(poses, 112);
});

test('authored wing clears its deck pocket and nested sleeves throughout sampled runtime deployment', () => {
  const car = createCar(scene), chassis = car.getObjectByName('Roadster');
  car.updateMatrixWorld(true);
  const fixed = [];
  for (const mesh of chassis.children) {
    if (mesh.isMesh && !mesh.material.transparent) fixed.push(...triangles(mesh, mesh.matrixWorld));
  }
  const bvh = tree(fixed), moving = new Set(), failures = [];
  for (const part of car.userData.aero) {
    for (const mesh of part.node.children) if (mesh.isMesh) moving.add(mesh);
  }
  assert.ok([...moving].some(mesh => mesh.name === 'wing_pivot_body'), 'A moving physical aerofoil is required');
  const carriage = car.getObjectByName('wing_carriage');
  const deployedHeight = carriage.getWorldPosition(new T.Vector3()).y;
  // Test the real staged runtime path: tips fold before lift stages descend.
  // This samples endpoints and intermediates; it is not a continuous sweep proof.
  for (let step = 0; step <= 10; step++) {
    const deployment = step / 10;
    setPlayerAeroPose(car, deployment);
    car.updateMatrixWorld(true);
    if (step === 0) assert.ok(deployedHeight - carriage.getWorldPosition(new T.Vector3()).y > .20, 'Stowing must physically retract, not hide or scale the wing');
    for (const mesh of moving) {
      assert.equal(mesh.visible, true, `${mesh.name}: moving parts remain real visible geometry`);
      assert.deepEqual(mesh.scale.toArray(), [1, 1, 1], `${mesh.name}: motion must not shrink hardware`);
      for (const triangle of triangles(mesh, mesh.matrixWorld)) {
        const hit = crossing(triangle, bvh);
        if (hit) { failures.push({ deployment, ...hit }); break; }
      }
    }
    for (const side of ['l', 'r']) {
      const middle = car.getObjectByName(`wing_lift_mid_${side}_carbon`), top = car.getObjectByName(`wing_lift_top_${side}_dark_alloy`);
      assert.ok(middle?.isMesh && top?.isMesh, `${side}: genuine nested telescopic stages`);
      const sleeveTree = tree(triangles(middle, middle.matrixWorld));
      for (const triangle of triangles(top, top.matrixWorld)) {
        const hit = crossing(triangle, sleeveTree);
        if (hit) { failures.push({ deployment, ...hit }); break; }
      }
    }
    // Painted tip fences must clear the blade and its fixed painted end caps.
    // Intentional metal hinge/shaft contact is not part of this comparison.
    const blade = car.getObjectByName('wing_pivot_body');
    const bladeTree = tree(triangles(blade, blade.matrixWorld));
    for (const side of ['l', 'r']) {
      const tip = car.getObjectByName(`wing_tip_${side}_body`);
      for (const triangle of triangles(tip, tip.matrixWorld)) {
        const hit = crossing(triangle, bladeTree);
        if (hit) { failures.push({ deployment, ...hit }); break; }
      }
    }
  }
  assert.deepEqual(failures, [], `Actual wing/deck or sleeve piercings: ${JSON.stringify(failures)}`);
});
