import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { createCar, animatePlayerCar, animatePlayerBody, setPlayerAeroPose } from '../src/car.js';

const directory = new URL('../public/assets/garage-cosmetics/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory)));
const base = await loadRoadsterGeometry();
const assets = await Promise.all(manifest.assets.map(async record => ({ record, ...await loadRoadsterGeometry(new URL(record.asset, directory)) })));
const byFile = file => assets.find(asset => asset.record.asset === file).scene.children[0];
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);

function points(node, inverse = new T.Matrix4()) {
  const out = [];
  node.updateWorldMatrix(true, true);
  node.traverse(mesh => {
    if (!mesh.isMesh) return;
    const matrix = inverse.clone().multiply(mesh.matrixWorld), position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) out.push(new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix));
  });
  return out;
}

function fit(car) {
  const body = byFile(manifest.body.asset).clone(true);
  car.userData.bodyRig.add(body);
  const louver = byFile(manifest.bodyLouver.asset).clone(true);
  car.userData.bodyRig.add(louver);
  const wheels = [], rims = [];
  for (const suffix of ['fl', 'fr', 'rl', 'rr']) {
    const clone = byFile(suffix.endsWith('l') ? manifest.wheels.left : manifest.wheels.right).clone(true);
    const spinner = car.getObjectByName(`wheel_spin_${suffix}`);
    spinner.add(clone); wheels.push(clone);
    const rim = byFile(suffix.endsWith('l') ? manifest.rims.left : manifest.rims.right).clone(true);
    spinner.add(rim); rims.push(rim);
  }
  car.updateMatrixWorld(true);
  return { body, wheels, louver, rims };
}

function triangles(node) {
  const out = [];
  node.traverse(mesh => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < (index?.count || position.count); i += 3) {
      const vertices = [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld));
      out.push({ vertices, box: new T.Box3().setFromPoints(vertices), name: mesh.name });
    }
  });
  return out;
}

function tree(list) {
  const box = new T.Box3();
  for (const triangle of list) box.union(triangle.box);
  if (list.length <= 12) return { box, list };
  const size = box.getSize(new T.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  list.sort((a, b) => a.box.min[axis] + a.box.max[axis] - b.box.min[axis] - b.box.max[axis]);
  const half = list.length >> 1;
  return { box, left: tree(list.slice(0, half)), right: tree(list.slice(half)) };
}

const ray = new T.Ray(), delta = new T.Vector3(), hit = new T.Vector3();
function edgeHit(a, b) {
  for (let i = 0; i < 3; i++) {
    const start = a[i], length = delta.copy(a[(i + 1) % 3]).sub(start).length();
    if (length < 2e-6) continue;
    ray.set(start, delta.multiplyScalar(1 / length));
    if (ray.intersectTriangle(b[0], b[1], b[2], false, hit)) {
      const distance = hit.distanceTo(start);
      if (distance > 2e-6 && distance < length - 2e-6) return hit.toArray();
    }
  }
  return null;
}
function crossing(triangle, node) {
  if (!triangle.box.intersectsBox(node.box)) return null;
  if (node.list) {
    for (const other of node.list) {
      if (!triangle.box.intersectsBox(other.box)) continue;
      const point = edgeHit(triangle.vertices, other.vertices) || edgeHit(other.vertices, triangle.vertices);
      if (point) return { part: triangle.name, surface: other.name, point };
    }
    return null;
  }
  return crossing(triangle, node.left) || crossing(triangle, node.right);
}

test('cosmetics are original finite Blender assets with exact source provenance and small mobile budgets', async () => {
  const revision = JSON.parse(await readFile(new URL('../art/roadster-wing-preservation.json', import.meta.url)));
  // Keep the accessories' real historical authoring source. Only the later
  // wing/pocket revision is new; current fit/pivot/clearance checks still run.
  assert.equal(manifest.sourceRoadsterSha256, revision.baseline.glbSha256);
  assert.equal(createHash('sha256').update(base.bytes).digest('hex'), revision.current.glbSha256);
  assert.notEqual(revision.baseline.glbSha256, revision.current.glbSha256);
  assert.deepEqual(manifest.cars, ['rocket']);
  assert.equal(manifest.body.id, 'body_splitter');
  assert.equal(manifest.wheels.id, 'wheel_turbine');
  assert.equal(manifest.bodyLouver.id, 'body_louver');
  assert.equal(manifest.bodyLouver.capability, 'body.louver');
  assert.equal(manifest.rims.id, 'rim_copper');
  assert.equal(manifest.rims.capability, 'rims.copperAccent');
  assert.equal(manifest.rims.slot, 'wheels.finish');
  assert.equal(manifest.bodyLouver.slot, 'body.addon');
  assert.deepEqual(manifest.unsupported, []);
  let totalBytes = 0, trianglesPerSet = 0;
  for (const { record, scene, json, bytes } of assets) {
    assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
    const root = scene.getObjectByName(record.root);
    assert.ok(root, 'Authored named root, not a catalog placeholder');
    assert.equal(root.userData.source_roadster_sha256, manifest.sourceRoadsterSha256);
    assert.deepEqual(root.userData.cars, ['rocket']);
    if (record.asset.startsWith('rim-')) assert.equal(root.userData.slot, manifest.rims.slot);
    if (record.asset === 'body-louver.glb') assert.equal(root.userData.slot, manifest.bodyLouver.slot);
    assert.ok(root.position.length() < 1e-8);assert.ok(root.quaternion.angleTo(new T.Quaternion()) < 1e-8);
    root.scale.toArray().forEach(value => near(value, 1));
    assert.equal(json.images, undefined, 'Small shader-only parts need no image downloads');
    assert.equal(json.animations, undefined, 'Use existing rig, not competing animations');
    assert.equal(json.cameras, undefined);assert.equal(json.extensions?.KHR_lights_punctual, undefined);
    let triangleCount = 0, vertexCount = 0, meshes = 0;
    scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      meshes++;
      const { position, normal } = mesh.geometry.attributes, index = mesh.geometry.index;
      assert.equal(position.count, normal.count);
      for (let i = 0; i < position.count; i++) {
        const p = new T.Vector3().fromBufferAttribute(position, i), n = new T.Vector3().fromBufferAttribute(normal, i);
        assert.ok([...p.toArray(), ...n.toArray()].every(Number.isFinite));
        near(n.length(), 1, 2e-4);
      }
      for (let i = 0; i < (index?.count || position.count); i += 3) {
        const [a, b, c] = [0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j));
        const ab = b.clone().sub(a), ac = c.clone().sub(a), longest = Math.max(ab.lengthSq(), ac.lengthSq(), b.distanceToSquared(c));
        assert.ok(ab.cross(ac).lengthSq() > longest ** 2 * 1e-16, `${mesh.name}: nondegenerate triangle ${i / 3}`);
      }
      triangleCount += (index?.count || position.count) / 3; vertexCount += position.count;
    });
    assert.ok(vertexCount > 300, 'Real shaped attachment geometry');
    assert.equal(triangleCount, record.triangles);assert.equal(meshes, record.drawBatches);
    assert.ok(triangleCount < 2200);assert.ok(bytes.length < 150_000);
    const bounds = new T.Box3().setFromObject(scene, true);
    bounds.min.toArray().forEach((value, axis) => near(value, record.boundsSourceM.min[axis]));
    bounds.max.toArray().forEach((value, axis) => near(value, record.boundsSourceM.max[axis]));
    const source = new URL(`../art/garage-cosmetics/${record.asset.replace('.glb', '.blend')}`, import.meta.url);
    assert.ok((await stat(source)).size > 50_000, 'Editable Blender source accompanies runtime GLB');
    totalBytes += bytes.length;trianglesPerSet += triangleCount * (/^(wheel|rim)-/.test(record.asset) ? 2 : 1);
  }
  assert.ok(totalBytes < 250_000);assert.ok(trianglesPerSet < 13_500);
});

test('body lower lip is grounded inside accepted dimensions and clears nozzle apertures and all aero poses', () => {
  const car = createCar(base.scene), originalBounds = new T.Box3().setFromObject(car, true);
  const { body } = fit(car); const bounds = new T.Box3().setFromObject(body, true);
  assert.ok(originalBounds.containsBox(bounds), 'No change to nominal vehicle collision envelope');
  assert.ok(bounds.min.y > .18, 'Never replaces or lowers wheel contact');
  assert.ok(bounds.max.y < .24, 'Kept below grille, lamps, cockpit and mirrors');
  const root = car.getObjectByName('Roadster');
  const localPoints = points(body, root.matrixWorld.clone().invert());
  for (const suffix of ['fl', 'fr', 'rl', 'rr']) {
    const socket = root.getObjectByName(`thruster_${suffix}`);
    assert.ok(socket);
    for (const point of localPoints) {
      const horizontalDistance = Math.hypot(point.x - socket.position.x, point.z - socket.position.z);
      assert.ok(horizontalDistance > .14, `${suffix}: leave full .066m aperture and clearance`);
    }
  }
  for (const deployment of [0, .25, .5, .75, 1]) {
    setPlayerAeroPose(car, deployment);car.updateMatrixWorld(true);
    for (const { node } of car.userData.aero) {
      assert.equal(new T.Box3().setFromObject(body, true).intersectsBox(new T.Box3().setFromObject(node, true)), false);
    }
  }
});

test('rear-deck louver is a real six-slat open applique over existing metal and clears glass, cockpit, nozzles and wing travel', () => {
  const car = createCar(base.scene), originalBounds = new T.Box3().setFromObject(car, true);
  const fixedNodes = car.userData.bodyRig.children.slice(), { louver } = fit(car);
  const root = car.getObjectByName('Roadster'), bodyMesh = car.getObjectByName('body');
  const localPoints = points(louver, root.matrixWorld.clone().invert());
  assert.ok(originalBounds.containsBox(new T.Box3().setFromObject(louver, true)));
  assert.equal(louver.parent, car.userData.bodyRig);
  assert.equal(manifest.bodyLouver.preserveExistingDeck, true);
  for (const point of localPoints) {
    assert.ok(Math.abs(point.x) < .564 && point.z > 1.49 && point.z < 1.732);
    assert.ok(point.y > .84 && point.y < .90, 'A low applique, not a cockpit or wing replacement');
    const origin = new T.Vector3(point.x, 2, point.z).applyMatrix4(root.matrixWorld);
    const hits = new T.Raycaster(origin, new T.Vector3(0, -1, 0), 0, 2).intersectObject(bodyMesh, true);
    assert.ok(hits.length, 'Every applique vertex has existing body deck below, never glass or empty space');
    const deck = root.worldToLocal(hits[0].point.clone());
    assert.ok(point.y - deck.y >= .0035 && point.y - deck.y <= .026, 'Close-fitted raised sheet, never sunk into metal');
    for (const suffix of ['fl', 'fr', 'rl', 'rr']) {
      const nozzle = root.getObjectByName(`thruster_${suffix}`);
      assert.ok(Math.hypot(point.x - nozzle.position.x, point.z - nozzle.position.z) > .20);
    }
  }
  const deckTree = tree(fixedNodes.flatMap(triangles));
  for (const triangle of triangles(louver)) assert.equal(crossing(triangle, deckTree), null, 'No intersection with retained vehicle geometry');
  for (let i = 0; i < 6; i++) {
    const hitAt = z => new T.Raycaster(new T.Vector3(0, 1.2, z).applyMatrix4(root.matrixWorld),
      new T.Vector3(0, -1, 0), 0, .5).intersectObject(louver, true);
    assert.ok(hitAt(1.527 + i * .033).length, 'Each raised slat is actual geometry');
    if (i < 5) assert.equal(hitAt(1.544 + i * .033).length, 0, 'Light/air gap is open, not a painted stripe');
  }
  for (const deployment of [0, .25, .5, .75, 1]) {
    setPlayerAeroPose(car, deployment); car.updateMatrixWorld(true);
    const wingTree = tree(car.userData.aero.flatMap(({node}) => triangles(node)));
    for (const triangle of triangles(louver)) assert.equal(crossing(triangle, wingTree), null);
    for (const {node} of car.userData.aero) {
      assert.equal(new T.Box3().setFromObject(louver, true).intersectsBox(new T.Box3().setFromObject(node, true)), false,
        'Entire louver stays ahead of moving wing and support envelopes');
    }
  }
  animatePlayerBody(car, { bodyPitch: .02, bodyRoll: -.03, bodyHeave: -.012 }); car.updateMatrixWorld(true);
  near(louver.getWorldQuaternion(new T.Quaternion()).angleTo(car.userData.bodyRig.getWorldQuaternion(new T.Quaternion())), 0);
});

test('copper accents are thin annular Blender parts with stock and turbine compatibility, not whole tyre or spoke recolors', () => {
  const car = createCar(base.scene);
  const originalWheels = car.userData.wheelRest.map(rest => rest.spinner.children.slice());
  const { rims, wheels } = fit(car);
  assert.deepEqual(manifest.rims.compatibleWheelGeometry, ['stock', 'wheel_turbine']);
  for (const [i, part] of rims.entries()) {
    const rest = car.userData.wheelRest[i], inverse = rest.spinner.matrixWorld.clone().invert();
    assert.equal(part.parent, rest.spinner);
    for (const point of points(part, inverse)) {
      assert.ok(Math.hypot(point.y, point.z) >= .284599 && Math.hypot(point.y, point.z) <= .292201);
      assert.ok(Math.abs(point.x) >= .15859 && Math.abs(point.x) <= .16501);
    }
    const sameWheel = tree([...originalWheels[i], wheels[i]].flatMap(triangles));
    for (const triangle of triangles(part)) assert.equal(crossing(triangle, sameWheel), null, 'Ring clears original tyre, rim and optional turbine cover');
    originalWheels[i].forEach(mesh => assert.ok(rest.spinner.children.includes(mesh), 'No hidden/replaced original wheel'));
    part.traverse(mesh => { if (mesh.isMesh) assert.match(mesh.material.name, /Copper_Anodized/); });
  }
  for (const steer of [-.5, 0, .5]) for (const distance of [0, .37, 2.4]) {
    animatePlayerCar(car, distance, steer); car.updateMatrixWorld(true);
    rims.forEach((part, i) => near(part.getWorldQuaternion(new T.Quaternion()).angleTo(car.userData.wheelRest[i].spinner.getWorldQuaternion(new T.Quaternion())), 0));
  }
});

test('turbine covers retain all four measured tyres, inherit front steering and local-X wheel spin', () => {
  const car = createCar(base.scene);
  const tyreBefore = car.userData.wheelRest.map(rest => ({ radius: rest.radius, carrier: rest.carrier.position.clone(),
    rubber: rest.spinner.children.find(mesh => mesh.isMesh && mesh.material.name === 'tire_rubber') }));
  const { wheels } = fit(car);
  for (const [i, part] of wheels.entries()) {
    const rest = car.userData.wheelRest[i], inverse = rest.spinner.matrixWorld.clone().invert();
    assert.equal(part.parent, rest.spinner);
    for (const point of points(part, inverse)) {
      assert.ok(Math.hypot(point.y, point.z) <= .282001);
      assert.ok(Math.abs(point.x) <= .187, 'Face does not become an over-wide wheel replacement');
      assert.ok(Math.abs(point.x) >= .1569);
    }
    near(rest.radius, tyreBefore[i].radius);assert.deepEqual(rest.carrier.position, tyreBefore[i].carrier);
    assert.ok(rest.spinner.children.includes(tyreBefore[i].rubber), 'Accepted tire is unchanged, not hidden or replaced');
  }
  for (const steer of [-.5, 0, .5]) for (const distance of [0, .37, 2.4]) {
    animatePlayerCar(car, distance, steer);car.updateMatrixWorld(true);
    wheels.forEach((part, i) => {
      const rest=car.userData.wheelRest[i];
      near(part.getWorldQuaternion(new T.Quaternion()).angleTo(rest.spinner.getWorldQuaternion(new T.Quaternion())), 0);
      near(rest.carrier.rotation.y, rest.front ? -steer : 0);
      near(rest.spinner.rotation.x, -(distance/rest.radius) % (Math.PI*2));
    });
  }
});

test('real turbine and copper ring triangles clear fixed body, fenders and brake calipers throughout steering and body motion samples', () => {
  const car = createCar(base.scene);const { wheels, rims } = fit(car);
  const fixedNodes = car.userData.bodyRig.children.filter(node => !node.userData.cosmetic_id);
  const calipers = car.userData.wheelRest.flatMap(rest => rest.carrier.children.filter(node => node !== rest.spinner));
  for (const bodyPose of [{}, { bodyPitch: .02, bodyRoll: -.03, bodyHeave: -.012 }]) {
    animatePlayerBody(car, bodyPose);car.updateMatrixWorld(true);
    // Covers only approach the wheelhouse; filtering bounds keeps BVH small without skipping any candidate triangle.
    const envelope = new T.Box3(new T.Vector3(-1.7,-.1,-2.1), new T.Vector3(1.7,.9,2.1));
    const fixed = fixedNodes.flatMap(triangles).filter(triangle => triangle.box.intersectsBox(envelope));
    const bvh = tree(fixed);
    for (const steer of [-.5, -.25, 0, .25, .5]) for (const distance of [0, .21, .57]) {
      animatePlayerCar(car, distance, steer);car.updateMatrixWorld(true);
      const caliperBvh=tree(calipers.flatMap(triangles));
      for (const wheel of [...wheels, ...rims]) for (const triangle of triangles(wheel)) {
        assert.equal(crossing(triangle, caliperBvh), null, 'Fixed caliper follows steering, never spin');
        const collision=crossing(triangle, bvh);
        assert.equal(collision, null, `Cover clearance at steer ${steer}, distance ${distance}: ${JSON.stringify(collision)}`);
      }
    }
  }
});

test('cockpit contrast trim targets actual authored upholstery seams only, not a pretend seat recolor', () => {
  const seam = base.scene.getObjectByName(manifest.cockpit.mesh);
  assert.ok(seam?.isMesh);assert.equal(seam.material.name, manifest.cockpit.material);
  assert.ok(seam.geometry.attributes.position.count >= 50, 'Actual existing modeled seam geometry');
  const root=base.scene.getObjectByName('Roadster');const bounds=new T.Box3().setFromPoints(points(seam,root.matrixWorld.clone().invert()));
  assert.ok(bounds.min.x < -.5 && bounds.max.x < -.1, 'Seams belong to single driver seat');
  assert.ok(bounds.min.y > .4 && bounds.max.y < .9);
  assert.equal(manifest.cockpit.requiresNewGeometry, false);
  assert.equal(manifest.cockpit.mode, 'existing_authored_material_tint');
  assert.equal(base.json.materials.filter(mat => mat.name===manifest.cockpit.material).length, 1);
});

test('attachments do not obstruct the established driver tablet or mirror sightlines', () => {
  const car=createCar(base.scene),{body,wheels,louver,rims}=fit(car),root=car.getObjectByName('Roadster');
  car.updateMatrixWorld(true);
  const display=root.userData.driverDisplay;
  const targets=[];
  for(const x of [-.16,0,.16])for(const y of [-.09,0,.09]){
    const center=new T.Vector3(...display.center_game_m);
    center.addScaledVector(new T.Vector3(...display.right_game),x).addScaledVector(new T.Vector3(...display.up_game),y);
    targets.push(center.applyMatrix4(root.matrixWorld));
  }
  for(const materialName of ['mirror_left','mirror_center','mirror_right']){
    let mirror;
    root.traverse(node=>{if(node.isMesh&&node.material.name===materialName)mirror=node;});
    assert.ok(mirror, `Existing ${materialName} is retained`);
    targets.push(new T.Box3().setFromObject(mirror,true).getCenter(new T.Vector3()));
  }
  for(const eye of [[-.48,1,.25],[-.43,1.04,.33],[-.32,1.08,.40]]){
    const origin=new T.Vector3(...eye).applyMatrix4(root.matrixWorld);
    for(const target of targets){
      const direction=target.clone().sub(origin),distance=direction.length();
      const hits=new T.Raycaster(origin,direction.normalize(),.0001,distance-.0001).intersectObjects([body,louver,...wheels,...rims],true);
      assert.equal(hits.length,0,'New geometry must not cross established tablet or mirror views');
    }
  }
});

test('visible cover and lip faces are outward wound, not rescued by double-sided shading', () => {
  for(const [file,side] of [[manifest.wheels.left,-1],[manifest.wheels.right,1]]){
    const asset=byFile(file);asset.updateWorldMatrix(true,true);
    const origin=new T.Vector3(side*.5,.17*Math.cos(.30),.17*Math.sin(.30));
    const hits=new T.Raycaster(origin,new T.Vector3(-side,0,0),0,.5).intersectObject(asset,true);
    assert.ok(hits.length,'A real front turbine vane faces the viewer');
    const normal=hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld);
    assert.ok(normal.x*side>.9,'Cover outer face points outboard');
    assert.equal(hits[0].object.material.side,T.FrontSide);
  }
  const body=byFile(manifest.body.asset);body.updateWorldMatrix(true,true);
  const hits=new T.Raycaster(new T.Vector3(.1,1,-2.30),new T.Vector3(0,-1,0),0,1).intersectObject(body,true);
  assert.ok(hits.length);
  assert.ok(hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).y>.5);
  for (const [file, side] of [[manifest.rims.left, -1], [manifest.rims.right, 1]]) {
    const rim = byFile(file); rim.updateWorldMatrix(true, true);
    const hits = new T.Raycaster(new T.Vector3(side*.5,.288,0), new T.Vector3(-side,0,0), 0, .5).intersectObject(rim,true);
    assert.ok(hits.length, 'Copper annulus faces outboard');
    assert.ok(hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).x*side>.8);
    assert.equal(hits[0].object.material.side,T.FrontSide);
  }
});
