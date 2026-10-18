import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as T from '../public/vendor/three.js';
import { createCar, animatePlayerBody, animatePlayerCar, resetPlayerMotion } from '../src/car.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { meshTriangles, triangleTree, trianglePiercing, meshPiercing } from './helpers/player-triangle-clearance.mjs';

const { scene, bytes } = await loadRoadsterGeometry();
const sourceRoot = scene.getObjectByName('Roadster');
const sourceHash = createHash('sha256').update(bytes).digest('hex');
const WHEEL_NAMES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
const DRIVETRAIN_BATCHES = new Set(['detail_alloy', 'detail_dark_alloy', 'detail_shield', 'detail_underbody']);
const STEERING_INPUTS = [-.3, -.15, 0, .15, .3];
const SPIN_PHASES = [0, .173, .777, Math.PI / 2, Math.PI, 4.7];
const BODY_POSES = [
  { label: 'neutral', bodyPitch: 0, bodyRoll: 0, bodyHeave: 0 },
  { label: 'accelerate', bodyPitch: .013, bodyRoll: 0, bodyHeave: 0 },
  { label: 'brake', bodyPitch: -.016, bodyRoll: 0, bodyHeave: 0 },
  { label: 'left roll', bodyPitch: 0, bodyRoll: -.016, bodyHeave: 0 },
  { label: 'right roll', bodyPitch: 0, bodyRoll: .016, bodyHeave: 0 },
  { label: 'touchdown', bodyPitch: 0, bodyRoll: 0, bodyHeave: -.012 },
  { label: 'rebound', bodyPitch: 0, bodyRoll: 0, bodyHeave: .012 },
  ...[-.016, .013].flatMap(bodyPitch => [-.016, .016].flatMap(bodyRoll => [-.012, .012].map(bodyHeave =>
    ({ label: `combined ${bodyPitch}/${bodyRoll}/${bodyHeave}`, bodyPitch, bodyRoll, bodyHeave })))),
  { label: 'braking turn intermediate', bodyPitch: -.008, bodyRoll: .008, bodyHeave: -.006 },
  { label: 'accelerating turn intermediate', bodyPitch: .0065, bodyRoll: -.008, bodyHeave: .006 },
  { label: 'small road response', bodyPitch: .002, bodyRoll: -.003, bodyHeave: -.002 },
];

/** Compare transforms, allowing floating-point composition error only. */
function nearMatrix(actual, expected, label) {
  actual.elements.forEach((value, index) => assert.ok(Math.abs(value - expected.elements[index]) < 2e-10,
    `${label}: matrix component ${index} changed (${value} != ${expected.elements[index]})`));
}
/** Fingerprint source buffers so sharing geometry cannot conceal an in-place mutation. */
function geometryHash(geometry) {
  const hash = createHash('sha256');
  for (const attribute of [geometry.index, ...Object.values(geometry.attributes)]) {
    if (!attribute) continue;
    const array = attribute.array;
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest('hex');
}
function under(node, parent) {
  for (let ancestor = node; ancestor; ancestor = ancestor.parent) if (ancestor === parent) return true;
  return false;
}
/** Only <=100 mm local-radial physical hub contacts may intersect drivetrain. */
function outsideHubAttachment(inverseCarrier, worldScale) {
  const local = new T.Vector3();
  return (point, bodyMesh) => {
    if (!DRIVETRAIN_BATCHES.has(bodyMesh)) return true;
    local.copy(point).applyMatrix4(inverseCarrier);
    return Math.hypot(local.y, local.z) * worldScale > .10;
  };
}

test('exported player has a neutral sprung body rig without changing authored geometry', () => {
  const sourceTransforms = new Map(), sourceGeometry = new Map();
  scene.traverse(node => {
    sourceTransforms.set(node, { parent: node.parent, matrix: node.matrixWorld.clone() });
    if (node.isMesh) sourceGeometry.set(node.geometry, geometryHash(node.geometry));
  });
  const bounds = new T.Box3().setFromObject(scene, true), size = bounds.getSize(new T.Vector3());
  const scale = 4.7 / size.z, center = bounds.getCenter(new T.Vector3());
  center.x = WHEEL_NAMES.reduce((sum, name) => sum + scene.getObjectByName(name).getWorldPosition(new T.Vector3()).x, 0) / 4;
  const normalization = new T.Matrix4().makeTranslation(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    .multiply(new T.Matrix4().makeScale(scale, scale, scale));
  const car = createCar(scene), body = car.userData.bodyRig, root = car.getObjectByName('Roadster');
  assert.ok(body?.isGroup, 'Require an independent body pivot, not whole-car bounce');
  assert.equal(body.parent, root);
  assert.equal(car.userData.bodyTravelLimit, .018);
  assert.deepEqual(body.position.toArray(), [0, 0, 0]);
  assert.deepEqual(body.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(car.userData.wheels.map(wheel => wheel.name), WHEEL_NAMES);
  for (const node of sourceRoot.children) {
    const instance = car.getObjectByName(node.name);
    assert.ok(instance, `Keep exported component ${node.name}`);
    assert.equal(instance.parent, WHEEL_NAMES.includes(node.name) ? root : body, `${node.name}: sprung/unsprung ownership`);
  }
  for (const name of ['body', 'glass', 'detail_rc_liner', 'detail_rc_ui', 'steering_yoke',
    'RC_Rocket_Passenger_Vessel_Approximate', 'wing_carriage', 'fan_0', 'thruster_fl', 'thruster_boost_0']) {
    assert.ok(under(car.getObjectByName(name), body), `${name}: body, cabin, hardware and nozzles move together`);
  }
  let meshes = 0, wheelMeshes = 0;
  scene.traverse(source => {
    if (!source.isMesh) return;
    const instance = car.getObjectByName(source.name);
    assert.equal(instance.geometry, source.geometry, `${source.name}: preserve actual exported geometry`);
    nearMatrix(instance.matrixWorld, normalization.clone().multiply(source.matrixWorld), `${source.name}: exact normalized rest pose`);
    meshes++;
  });
  for (const { carrier, spinner } of car.userData.wheelRest) {
    assert.equal(spinner.parent, carrier);
    assert.equal(under(carrier, body), false);
    assert.ok(spinner.children.some(mesh => mesh.material?.name === 'brake_carbon_ceramic'), `${carrier.name}: rotating brake disc`);
    assert.ok(carrier.children.some(mesh => mesh.isMesh && mesh !== spinner), `${carrier.name}: nonspinning caliper`);
    carrier.traverse(mesh => { if (mesh.isMesh) { wheelMeshes++; assert.equal(under(mesh, body), false, `${mesh.name}: all wheel hardware stays unsprung`); } });
  }
  assert.ok(meshes > 50 && wheelMeshes >= 20, 'Inspect the detailed GLB, not a box fixture');
  for (const [geometry, hash] of sourceGeometry) assert.equal(geometryHash(geometry), hash, 'Every authored position/index/normal/UV buffer remains untouched');
  for (const [source, snapshot] of sourceTransforms) {
    assert.equal(source.parent, snapshot.parent, `${source.name}: source graph untouched`);
    nearMatrix(source.matrixWorld, snapshot.matrix, `${source.name}: source transform untouched`);
  }
});

test('body pose is a pure simulation-state projection and never bounces the root or wheel hardware', () => {
  const car = createCar(scene), other = createCar(scene), data = car.userData;
  car.position.set(2.1, 1.4, -9); car.rotation.set(.07, -.25, .11);
  animatePlayerCar(car, 3.7, .18, false, Math.tan(.18) / data.wheelbase);
  car.updateMatrixWorld(true);
  const rootBefore = car.matrixWorld.clone(), modelBefore = car.children[0].matrixWorld.clone(), wheelMatrices = new Map();
  for (const wheel of data.wheels) wheel.traverse(node => wheelMatrices.set(node, node.matrixWorld.clone()));
  const state = { bodyPitch: -.016, bodyRoll: .016, bodyHeave: -.012, acceleration: 0,
    lateralAcceleration: 0, touchdownPulse: 0, time: 0, phase: 'playing' };
  const untouchedState = structuredClone(state), untouchedMotion = structuredClone(data.bodyMotion);
  animatePlayerBody(car, state); car.updateMatrixWorld(true);
  const expectedPose = { ...data.bodyPose }, expectedBody = data.bodyRig.matrixWorld.clone();
  assert.ok(Math.abs(expectedPose.pitch) > 1e-5 && Math.abs(expectedPose.roll) > 1e-5 && Math.abs(expectedPose.heave) > 1e-5);
  assert.notDeepEqual(data.bodyRig.quaternion.toArray(), [0, 0, 0, 1], 'The sprung body really responds');
  for (let frame = 0; frame < 120; frame++) {
    // Extraneous render clocks cannot integrate a second spring.
    animatePlayerBody(car, { ...state, time: frame * 15, acceleration: 100, lateralAcceleration: -100, touchdownPulse: 1 }, frame % 2 ? 1 / 30 : 0);
  }
  car.updateMatrixWorld(true);
  assert.deepEqual(data.bodyPose, expectedPose);
  nearMatrix(data.bodyRig.matrixWorld, expectedBody, 'Repeated rendering is idempotent');
  nearMatrix(car.matrixWorld, rootBefore, 'Gameplay root does not bob');
  nearMatrix(car.children[0].matrixWorld, modelBefore, 'Normalized model root does not bob');
  for (const [node, before] of wheelMatrices) nearMatrix(node.matrixWorld, before, `${node.name}: tires/rims/discs/calipers stay unsprung`);
  assert.deepEqual(state, untouchedState);
  assert.deepEqual(data.bodyMotion, untouchedMotion, 'No render-clock integration');
  assert.deepEqual(other.userData.bodyPose, { pitch: 0, roll: 0, heave: 0, limit: 1 }, 'Instance-local state');
  animatePlayerBody(car, { bodyPitch: NaN, bodyRoll: Infinity, bodyHeave: undefined });
  assert.deepEqual(data.bodyPose, { pitch: 0, roll: 0, heave: 0, limit: 1 });
  animatePlayerBody(car, state); resetPlayerMotion(car);
  assert.deepEqual(data.bodyRig.position.toArray(), [0, 0, 0]);
  assert.deepEqual(data.bodyRig.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(data.bodyPose, { pitch: 0, roll: 0, heave: 0, limit: 1 });
});

test('combined legal pitch, roll and heave stay inside the measured 18 mm sprung travel stop', () => {
  const car = createCar(scene), data = car.userData, pivot = data.bodyPivot;
  let limited = 0;
  for (const state of BODY_POSES) {
    const pose = animatePlayerBody(car, state);
    assert.ok(Object.values(pose).every(Number.isFinite));
    if (pose.limit < 1) limited++;
    assert.ok(pose.limit > 0 && pose.limit <= 1);
    const travel = Math.abs(pose.heave) + Math.abs(Math.sin(pose.pitch)) * data.bodyEnvelopeHalfLength
      + Math.abs(Math.sin(pose.roll)) * data.bodyEnvelopeHalfWidth
      + (1 - Math.cos(pose.pitch) * Math.cos(pose.roll)) * data.bodyEnvelopeHalfHeight;
    assert.ok(travel <= .018 + 1e-7, `${state.label}: combined travel ${travel} m exceeds 18 mm`);
    for (const { center, radius } of data.bodyWheels) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const rest = center.clone().add(new T.Vector3(0, Math.cos(angle) * radius, Math.sin(angle) * radius));
      const moved = rest.clone().sub(pivot).applyEuler(data.bodyRig.rotation).add(pivot);
      moved.y += pose.heave / data.bodyScale;
      assert.ok(Math.abs(moved.y - rest.y) * data.bodyScale <= .018 + 1e-7, `${state.label}: physical wheel-adjacent travel exceeds 18 mm`);
    }
  }
  assert.equal(BODY_POSES.length, 18);
  assert.ok(limited >= 10, 'Exercise combined bump stops, not just tiny poses');
});

test('triangle clearance requires real piercing and exempts only physical drivetrain hub attachment points', () => {
  const record = (points, mesh) => { const v = points.map(p => new T.Vector3(...p)); return { v, box: new T.Box3().setFromPoints(v), mesh, index: 0 }; };
  const fixed = record([[0, 0, 0], [2, 0, 0], [0, 2, 0]], 'body');
  const separated = record([[1.6, 1.6, -1], [1.6, 1.6, 1], [2, 2, 1]], 'tire');
  const piercing = record([[.2, .2, -1], [.2, .2, 1], [1, 1, 1]], 'tire');
  assert.ok(separated.box.intersectsBox(fixed.box), 'Deliberately overlapping AABBs');
  assert.equal(trianglePiercing(separated, triangleTree([fixed])), null);
  assert.ok(trianglePiercing(piercing, triangleTree([fixed])));
  const accept = outsideHubAttachment(new T.Matrix4(), 1);
  for (const name of DRIVETRAIN_BATCHES) {
    assert.equal(accept(new T.Vector3(0, .05, .05), name), false);
    assert.equal(accept(new T.Vector3(0, .101, 0), name), true, `${name}: never exempt entire batches`);
  }
  assert.equal(accept(new T.Vector3(0, .05, .05), 'detail_rc_liner'), true, 'No cabin-liner exemption');
  assert.ok(trianglePiercing(piercing, triangleTree([{ ...fixed, mesh: 'detail_underbody' }]), accept), 'Non-hub drivetrain piercing still fails');
});

test('an injected liner clipping regression pierces the actual exported tire triangles', () => {
  const tire = scene.getObjectByName('wheel_spin_fl_rubber');
  assert.ok(tire?.isMesh, 'Use a real exported tire, not a primitive substitute');
  const actual = meshTriangles(tire, tire.matrixWorld);
  const normal = new T.Vector3(), edge = new T.Vector3();
  const triangle = actual.find(record => normal.subVectors(record.v[1], record.v[0])
    .cross(edge.subVectors(record.v[2], record.v[0])).lengthSq() > 1e-8);
  assert.ok(triangle, 'A sufficiently large actual tire face is required');
  normal.normalize();
  const center = triangle.v.reduce((sum, vertex) => sum.add(vertex), new T.Vector3()).multiplyScalar(1 / 3);
  edge.subVectors(triangle.v[1], triangle.v[0]).normalize();
  // An intentionally incorrect liner patch crosses the interior of this exact
  // tire face. This positive control never mutates the loaded GLB or real rig.
  const v = [center.clone().addScaledVector(normal, -.01), center.clone().addScaledVector(normal, .01),
    center.clone().addScaledVector(edge, .02).addScaledVector(normal, .01)];
  const liner = { v, box: new T.Box3().setFromPoints(v), mesh: 'detail_rc_liner', index: 0 };
  const carrier = scene.getObjectByName('wheel_fl');
  const accept = outsideHubAttachment(carrier.matrixWorld.clone().invert(), carrier.getWorldScale(new T.Vector3()).x);
  const hit = trianglePiercing(triangle, triangleTree([liner]), accept);
  assert.ok(hit, 'The regression guard must detect liner geometry cutting an actual tire');
  assert.equal(hit.bodyMesh, 'detail_rc_liner');
});

test('actual sprung GLB clears tires/rims/discs/calipers in 2,160 sampled body/steer/spin wheel poses', t => {
  const car = createCar(scene), data = car.userData, body = data.bodyRig;
  car.updateMatrixWorld(true);
  const bodyRestWorld = body.matrixWorld.clone(), fixed = [], fixedNames = new Set();
  body.traverse(mesh => { if (mesh.isMesh) { fixed.push(...meshTriangles(mesh, mesh.matrixWorld)); fixedNames.add(mesh.name); } });
  assert.ok(fixed.length > 150000, 'Include all detailed sprung body/cabin/hardware triangles');
  for (const name of ['body', 'detail_carbon', 'detail_rc_liner', 'detail_underbody', 'detail_shield', 'glass']) assert.ok(fixedNames.has(name), `${name}: included in clearance`);
  const tree = triangleTree(fixed), wheelGeometry = new Map(), categories = new Set();
  for (const { carrier } of data.wheelRest) carrier.traverse(mesh => {
    if (!mesh.isMesh) return;
    wheelGeometry.set(mesh, meshTriangles(mesh));
    categories.add(mesh.parent === carrier ? 'caliper' : mesh.material.name === 'tire_rubber' ? 'tire'
      : mesh.material.name === 'brake_carbon_ceramic' ? 'disc' : 'rim');
  });
  assert.deepEqual([...categories].sort(), ['caliper', 'disc', 'rim', 'tire']);
  const intoBodyRest = new T.Matrix4(), transform = new T.Matrix4(), inverseCarrier = new T.Matrix4();
  const stats = { wheelTriangles: 0, narrowPhasePairs: 0 }, failures = [];
  let wheelPoses = 0, carPoses = 0, largestSteer = 0;
  // 540 full-car / 2,160 wheel configurations: finite samples, not continuous
  // collision certification, coplanar-overlap or solid-containment proof.
  for (const state of BODY_POSES) for (const steer of STEERING_INPUTS) for (const spin of SPIN_PHASES) {
    animatePlayerBody(car, state);
    animatePlayerCar(car, 0, steer, false, Math.tan(steer) / data.wheelbase);
    for (const { spinner } of data.wheelRest) spinner.rotation.x = spin;
    car.updateMatrixWorld(true);
    intoBodyRest.copy(bodyRestWorld).multiply(body.matrixWorld.clone().invert());
    for (const { carrier } of data.wheelRest) {
      largestSteer = Math.max(largestSteer, Math.abs(carrier.rotation.y));
      inverseCarrier.multiplyMatrices(intoBodyRest, carrier.matrixWorld).invert();
      const scale = carrier.getWorldScale(new T.Vector3()).x, accept = outsideHubAttachment(inverseCarrier, scale);
      let failure = null;
      carrier.traverse(mesh => {
        if (!mesh.isMesh || failure) return;
        transform.multiplyMatrices(intoBodyRest, mesh.matrixWorld);
        failure = meshPiercing(wheelGeometry.get(mesh), transform, tree, accept, stats);
      });
      if (failure && failures.length < 12) {
        const local = new T.Vector3(...failure.point).applyMatrix4(inverseCarrier);
        failures.push({ pose: state.label, appliedBody: { ...data.bodyPose }, steerInput: steer,
          actualWheelSteer: carrier.rotation.y, spin, carrier: carrier.name,
          radialMeters: Math.hypot(local.y, local.z) * scale, ...failure });
      }
      wheelPoses++;
    }
    carPoses++;
  }
  t.diagnostic(`Asset SHA-256 ${sourceHash}; ${fixed.length} sprung triangles, ${stats.wheelTriangles} transformed wheel triangles, ${stats.narrowPhasePairs} exact candidate pairs.`);
  assert.equal(carPoses, 540); assert.equal(wheelPoses, 2160);
  assert.ok(largestSteer > .32, 'Cover legal Ackermann inner-wheel angles beyond nominal .3 centre steer');
  assert.deepEqual(failures, [], `Actual non-hub triangle piercings: ${JSON.stringify(failures)}`);
  assert.ok(stats.wheelTriangles > 20000000 && stats.narrowPhasePairs > 10000, 'Test actual detailed triangles');
});
