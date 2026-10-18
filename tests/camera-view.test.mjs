import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { createCar, animatePlayerBody, animatePlayerCar } from '../src/car.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import {
  createCockpitView, updateCockpitCamera, shouldUseCockpit, normalizeCameraMode,
  cockpitVerticalFov, COCKPIT_HORIZONTAL_FOV, COCKPIT_MAX_VERTICAL_FOV,
  COCKPIT_NEAR, COCKPIT_LOOK_DOWN, COCKPIT_RETURN_DELAY, COCKPIT_UPRIGHT_LIMIT,
} from '../src/camera-view.js';

const { scene } = await loadRoadsterGeometry();
const close = (a, b, message, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${message}: ${a} versus ${b}`);
/** Make an isolated instance of the actual runtime GLB, not a box/cabin mock. */
function fixture(aspect = 16 / 9) {
  const player = createCar(scene), rig = createCockpitView(player), camera = new T.PerspectiveCamera(54, aspect, .15, 1200);
  updateCockpitCamera(camera, rig, { phase: 'playing' }, { aspect });
  return { player, rig, camera, root: player.getObjectByName('Roadster') };
}
/** Visit exact indexed triangles, transformed into the requested coordinate frame. */
function eachTriangle(player, transform, visit) {
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), matrix = new T.Matrix4();
  player.traverse(mesh => {
    if (!mesh.isMesh) return;
    matrix.copy(transform).multiply(mesh.matrixWorld);
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      a.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(matrix);
      b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
      visit(a, b, c, mesh, i / 3);
    }
  });
}
/** Bounds of actual projected vertices, not the looser transformed mesh AABB. */
function projectedBounds(mesh, camera) {
  const box = new T.Box3(), p = mesh.geometry.attributes.position, vertex = new T.Vector3();
  for (let i = 0; i < p.count; i++) box.expandByPoint(vertex.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).project(camera));
  return box;
}

test('camera mode normalization is conservative and shared by storage/UI', () => {
  assert.equal(normalizeCameraMode('cockpit'), 'cockpit');
  for (const raw of ['chase', 'first-person', 'COCKPIT', '', null, undefined, 1, {}, []]) assert.equal(normalizeCameraMode(raw), 'chase');
});

test('driver eye uses exported metadata in the sprung cabin frame without modifying geometry', () => {
  const player = createCar(scene), root = player.getObjectByName('Roadster');
  const transforms = new Map(), materials = new Map(), visibility = new Map();
  player.traverse(node => {
    transforms.set(node, node.matrixWorld.clone()); visibility.set(node, node.visible);
    if (node.isMesh) materials.set(node, node.material);
  });
  const rig = createCockpitView(player), camera = new T.PerspectiveCamera();
  assert.equal(rig.frame, player.userData.bodyRig);
  assert.deepEqual(rig.eyeLocal.toArray(), root.userData.driverDisplay.reference_eye_game_m);
  assert.deepEqual(rig.eyeLocal.toArray(), [-.43, 1.04, .33]);
  assert.equal(updateCockpitCamera(camera, rig, {}, { aspect: 16 / 9 }), true);
  const expected = rig.eyeLocal.clone().applyMatrix4(root.matrixWorld);
  assert.ok(camera.position.distanceTo(expected) < 1e-10, 'Apply source scale and grounding exactly once');
  assert.ok(camera.position.y > 1 && camera.position.y < 1.05, 'Real seated height, not roof/hood/chase height');
  player.traverse(node => {
    assert.deepEqual(node.matrixWorld.elements, transforms.get(node).elements);
    assert.equal(node.visible, visibility.get(node), `${node.name}: cockpit must not hide any cabin/body mesh`);
    if (node.isMesh) assert.equal(node.material, materials.get(node), `${node.name}: retain actual exported materials/culling`);
  });
  assert.equal(scene.getObjectByName('player_sprung_body'), undefined, 'Never mutate the source asset');
  assert.throws(() => createCockpitView(null), TypeError);
  assert.throws(() => createCockpitView(new T.Group()), /authored driver-eye/);
});

test('actual GLB eye is inside the cabin airspace, not inside roof, seat, trim or vessel solids', () => {
  const { player, camera } = fixture(), eye = camera.position;
  const triangle = new T.Triangle(), point = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), cross = new T.Vector3();
  const winding = new Map(); let minimum = Infinity, nearest = '', count = 0;
  eachTriangle(player, new T.Matrix4(), (va, vb, vc, mesh) => {
    const distance = triangle.set(va, vb, vc).closestPointToPoint(eye, point).distanceTo(eye);
    if (distance < minimum) { minimum = distance; nearest = mesh.name; }
    a.copy(va).sub(eye); b.copy(vb).sub(eye); c.copy(vc).sub(eye);
    const la = a.length(), lb = b.length(), lc = c.length();
    const angle = 2 * Math.atan2(a.dot(cross.crossVectors(b, c)), la * lb * lc + a.dot(b) * lc + b.dot(c) * la + c.dot(a) * lb);
    winding.set(mesh, (winding.get(mesh) || 0) + angle / (4 * Math.PI)); count++;
  });
  assert.ok(count > 100000, 'Inspect detailed live GLB triangles, not its bounding box');
  assert.ok(minimum > .14, `The eye has genuine all-surface clearance: ${minimum} m from ${nearest}`);
  for (const [mesh, value] of winding) {
    // Closed solids have winding ~0 outside and +/-1 inside. Thin/open trim
    // batches need not be exactly zero, but are nowhere near an inside winding.
    assert.ok(Math.abs(value) < .05, `${mesh.name}: eye lies inside a mesh solid, winding=${value}`);
  }
  const ray = direction => new T.Raycaster(eye, new T.Vector3(...direction).normalize(), 1e-6, 5).intersectObject(player, true)[0];
  assert.equal(ray([0, 1, 0]).object.name, 'glass', 'The actual roof glazing is above the driver');
  assert.equal(ray([0, -1, 0]).object.name, 'detail_rc_perforated', 'The driver seat is below the eye');
  assert.equal(ray([0, 0, 1]).object.name, 'detail_rc_ivory', 'The real seat back is behind the eye');
  assert.ok(ray([0, 1, 0]).distance > .17 && ray([0, 1, 0]).distance < .19);
  assert.ok(ray([0, 0, 1]).distance > .22 && ray([0, 0, 1]).distance < .25);
});

test('actual forward road sightline and near driving corridor pass only through glazing', () => {
  const { player, rig, camera } = fixture();
  for (const x of [-.1, 0, .1]) for (const y of [-.025, 0, .04]) {
    const direction = new T.Vector3(x, y, -1).normalize();
    const hits = new T.Raycaster(camera.position, direction, COCKPIT_NEAR, 20).intersectObject(player, true);
    assert.ok(hits.length >= 1, 'A real windshield must be present, not deleted for first person');
    assert.ok(hits.every(hit => hit.object.material.transparent), `Opaque forward obstruction at ${x}/${y}: ${hits.map(h => h.object.name)}`);
    assert.ok(hits[0].distance > .8, 'Do not put the camera at the windshield or in trim');
  }
  const road = new T.Vector3(camera.position.x, 0, -25).project(camera);
  assert.ok(Math.abs(road.x) < 1 && Math.abs(road.y) < 1 && road.z < 1, 'Road ahead lies inside the camera projection');
  const gaze = camera.getWorldDirection(new T.Vector3());
  close(gaze.x, 0, 'Forward has no artificial side aim');
  close(gaze.y, -Math.sin(COCKPIT_LOOK_DOWN), 'Slight physical downward gaze');
  assert.ok(gaze.z < -.99 && rig.forwardLocal.z < -.99, 'The car front is local -Z');
});

test('desktop lens fits the real tablet and yoke while portrait stays bounded and undistorted', () => {
  const { player, rig, camera } = fixture();
  const tablet = player.getObjectByName('detail_rc_ui'), yoke = player.getObjectByName('steering_yoke_rc_carbon');
  for (const aspect of [16 / 9, 4 / 3, 9 / 16, 390 / 844]) {
    assert.equal(updateCockpitCamera(camera, rig, {}, { aspect }), true);
    close(camera.aspect, aspect, 'Physical viewport aspect'); close(camera.near, COCKPIT_NEAR, 'Close cabin near plane');
    assert.ok(camera.fov > 0 && camera.fov <= COCKPIT_MAX_VERTICAL_FOV);
    const horizontal = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * aspect) * 180 / Math.PI;
    if (aspect >= 4 / 3) {
      close(horizontal, COCKPIT_HORIZONTAL_FOV, 'Consistent landscape horizontal field of view');
      for (const mesh of [tablet, yoke]) {
        const box = projectedBounds(mesh, camera);
        assert.ok(box.min.x >= -1 && box.max.x <= 1 && box.min.y >= -1 && box.max.y <= 1,
          `${mesh.name}: real vertices fit desktop view at ${aspect}: ${box.min.toArray()}..${box.max.toArray()}`);
      }
    } else {
      close(camera.fov, COCKPIT_MAX_VERTICAL_FOV, 'Portrait caps vertical lens instead of using a fisheye');
      assert.ok(horizontal > 40 && horizontal < 60, 'Portrait sacrifices tablet sides, not projection geometry');
    }
    const originalEye = camera.position.clone();
    updateCockpitCamera(camera, rig, { speed: 100, boosting: true }, { aspect });
    assert.ok(camera.position.distanceTo(originalEye) < 1e-12, 'Speed/boost never pushes the head through the cabin');
    assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
    close(camera.projectionMatrix.elements[5] / camera.projectionMatrix.elements[0], aspect, 'Projection retains correct physical aspect');
  }
  for (const aspect of [NaN, Infinity, 0, -1]) assert.ok(Number.isFinite(cockpitVerticalFov(aspect)));
});

test('real near plane does not cut any authored triangle in landscape, portrait or sprung extremes', () => {
  const { player, rig, camera } = fixture(), triangle = new T.Triangle();
  for (const pose of [{}, { bodyPitch: .018, bodyRoll: -.024, bodyHeave: -.012 }, { bodyPitch: -.018, bodyRoll: .024, bodyHeave: .003 }]) {
    animatePlayerBody(player, pose); animatePlayerCar(player, 0, .3, false);
    player.position.set(-3.5, 3.012, 0); player.rotation.set(-.035, -.32, 0, 'YXZ'); player.updateMatrixWorld(true);
    for (const aspect of [16 / 9, 9 / 16, 390 / 844]) {
      updateCockpitCamera(camera, rig, { flying: true, altitude: 3 }, { aspect });
      const halfHeight = Math.tan(camera.fov * Math.PI / 360) * camera.near, halfWidth = halfHeight * aspect;
      const plane = new T.Box3(new T.Vector3(-halfWidth, -halfHeight, -camera.near - 1e-7), new T.Vector3(halfWidth, halfHeight, -camera.near + 1e-7));
      let hits = 0, checked = 0;
      eachTriangle(player, camera.matrixWorldInverse, (a, b, c) => {
        checked++;
        if (plane.intersectsTriangle(triangle.set(a, b, c))) hits++;
      });
      assert.ok(checked > 100000);
      assert.equal(hits, 0, `Exact triangle/near-rectangle intersections at aspect ${aspect} and body pose ${JSON.stringify(pose)}`);
      // Every point of the near rectangle is also well above the road plane.
      for (const x of [-halfWidth, halfWidth]) for (const y of [-halfHeight, halfHeight]) {
        assert.ok(new T.Vector3(x, y, -camera.near).applyMatrix4(camera.matrixWorld).y > 3.8);
      }
    }
  }
});

test('eye follows full altitude, real heading and suspension without lag or inverted horizon', () => {
  const { player, rig, camera } = fixture();
  const references = [rig.eyeLocal, rig.forwardLocal, rig.eyeWorld, rig.forwardWorld, rig.target];
  for (const altitude of [0, 1, 3.8, 20]) for (const heading of [-Math.PI, -.4, 0, .4, Math.PI]) {
    player.position.set(3.5, .012 + altitude, -8);
    player.rotation.set(altitude ? -.035 : 0, -heading, .03, 'YXZ');
    animatePlayerBody(player, { bodyPitch: .018, bodyRoll: -.024, bodyHeave: -.012 });
    for (const reducedMotion of [false, true]) {
      updateCockpitCamera(camera, rig, { altitude, heading, rollAngle: .03 }, { aspect: 16 / 9, reducedMotion, dt: 1 / 60 });
      const expected = rig.eyeLocal.clone().applyMatrix4(rig.frame.matrixWorld);
      assert.ok(camera.position.distanceTo(expected) < 1e-10, 'Full physical eye transform, never .62/.78 altitude or a smoothed chase point');
      const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      close(right.y, 0, 'Horizon remains level even when the body rolls');
      const source = reducedMotion ? player : rig.frame;
      const forward = rig.forwardLocal.clone().transformDirection(source.matrixWorld);
      assert.ok(camera.getWorldDirection(new T.Vector3()).distanceTo(forward) < 1e-10);
      assert.ok([...camera.position.toArray(), ...camera.quaternion.toArray(), ...camera.projectionMatrix.elements].every(Number.isFinite));
    }
  }
  [rig.eyeLocal, rig.forwardLocal, rig.eyeWorld, rig.forwardWorld, rig.target].forEach((value, i) => assert.equal(value, references[i], 'Reuse all scratch objects'));
  // A reset/teleport immediately returns the eye to the car, without stale springs.
  player.position.set(0, .012, 0); player.rotation.set(0, 0, 0); animatePlayerBody(player, {});
  updateCockpitCamera(camera, rig, { phase: 'ready' }, { aspect: 9 / 16, dt: 0 });
  assert.ok(camera.position.distanceTo(rig.eyeLocal.clone().applyMatrix4(rig.frame.matrixWorld)) < 1e-10);
  assert.ok(camera.position.y > 1 && camera.position.y < 1.1);
});

test('full rolls always use chase and only return after a paused-safe upright recovery', () => {
  const { rig, camera } = fixture(), original = camera.matrixWorld.clone();
  for (const angle of [0, .08, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
    const state = { phase: 'playing', rolling: true, rollAngle: angle };
    assert.equal(shouldUseCockpit(state, false, rig, 1 / 60), false);
    close(rig.returnDelay, COCKPIT_RETURN_DELAY, 'Refresh recovery throughout the roll');
    assert.equal(updateCockpitCamera(camera, rig, state), false, 'Never pose an inside camera during a roll');
    assert.deepEqual(camera.matrixWorld.elements, original.elements);
  }
  assert.equal(shouldUseCockpit({ rolling: false, rollAngle: Math.PI * 2 }, false, rig, .1), false, 'Raw 2π must not snap into cockpit before reset');
  for (let i = 0; i < 10; i++) assert.equal(shouldUseCockpit({ rollAngle: 0 }, false, rig, 0), false, 'Pause freezes recovery');
  for (let i = 0; i < 11; i++) assert.equal(shouldUseCockpit({ rollAngle: 0 }, false, rig, 1 / 60), false);
  assert.equal(shouldUseCockpit({ rollAngle: 0 }, false, rig, 1 / 60), true);
  assert.equal(shouldUseCockpit({ rollAngle: COCKPIT_UPRIGHT_LIMIT + .001 }), false);
  assert.equal(shouldUseCockpit({ rollAngle: Infinity }), false);
  assert.equal(shouldUseCockpit({ rollAngle: NaN }), false);
  assert.equal(shouldUseCockpit({ rolling: true }, false, rig), false);
  assert.equal(shouldUseCockpit({ phase: 'ready' }, false, rig), true, 'New run resets recovery immediately');
  assert.equal(shouldUseCockpit({ rolling: true }, false, rig), false);
  assert.equal(shouldUseCockpit({}, true, rig), false); assert.equal(rig.returnDelay, 0);
  assert.equal(shouldUseCockpit({ phase: 'menu' }), false);
  assert.equal(shouldUseCockpit({ phase: 'paused' }), true, 'Pause itself does not select another camera mode');
  assert.equal(shouldUseCockpit({ phase: 'crashed' }), true, 'An upright crash does not hide the interior');
});

test('deliberate glances rotate gaze only, preserve the seated eye and cannot exceed limits', () => {
  const {player,rig,camera}=fixture();
  const eye=camera.position.clone(), center=camera.getWorldDirection(new T.Vector3());
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9,lookYaw:.75});
  const left=camera.getWorldDirection(new T.Vector3());
  assert.ok(left.x<center.x-.5); assert.ok(camera.position.distanceTo(eye)<1e-12);
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9,lookYaw:-100});
  const right=camera.getWorldDirection(new T.Vector3()); assert.ok(right.x>center.x+.5);
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9,lookYaw:-.75});
  assert.ok(camera.getWorldDirection(new T.Vector3()).distanceTo(right)<1e-12);
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9,lookYaw:NaN});
  assert.ok(camera.getWorldDirection(new T.Vector3()).distanceTo(center)<1e-12);
  assert.ok(camera.position.distanceTo(eye)<1e-12); assert.equal(player.userData.bodyPose.roll,0);
});
