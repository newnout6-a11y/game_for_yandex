import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { GarageScene, GARAGE_PARKING_BAYS } from '../src/garage-scene.js';
import { createOwnedVehicle } from '../src/owned-vehicles.js';
import { installTrafficTemplates, TRAFFIC_KINDS } from '../src/traffic.js';
import { garageCameraLimits, garageBoxCorners, garageNearPlaneCorners, constrainGarageCamera } from '../src/garage-camera-motion.js';
import { GARAGE_TOY_POSITION, GARAGE_TOY_YAW } from '../src/garage-toy-prop.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const assets = { car: (await loadRoadsterGeometry()).scene, traffic: {} };
for (const id of TRAFFIC_KINDS) assets.traffic[id] = (await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`, import.meta.url))).scene;
installTrafficTemplates(assets.traffic);
const rooms = await Promise.all([1, 2, 3, 4].map(async tier => (await loadRoadsterGeometry(new URL(`../public/assets/garage/tier${tier}.glb`, import.meta.url))).scene));
const toyTemplate=(await loadRoadsterGeometry(new URL('../public/assets/garage/toy-racecar.glb',import.meta.url))).scene;
/** Place the exact authored prop into every existing full-orbit and inspection sweep. */
function toyInstance(){const toy=toyTemplate.clone(true);toy.position.set(...GARAGE_TOY_POSITION);toy.rotation.y=GARAGE_TOY_YAW;toy.updateMatrixWorld(true);return toy;}
const ids = ['rocket', 'hatch', 'sedan', 'suv', 'van'];
const viewports = [
  [1440, 900, { x: 248, y: 198, width: 800, height: 560 }],
  [844, 390, { x: 173, y: 129.3125, width: 361, height: 139.59375 }],
  [844, 390, { x: 125, y: 128, width: 403, height: 156 }],
  [667, 375, { x: 99, y: 112, width: 298, height: 149 }],
  [390, 844, { x: 18, y: 205, width: 354, height: 190 }],
];

/** Use genuine prepared production vehicles, retaining authored transforms and all parked-car bodies. */
function makeCar(id) {
  const car = createOwnedVehicle(assets, id);
  car.position.set(0, id === 'rocket' ? .006 : car.userData.groundY, 0);
  car.updateMatrixWorld(true);
  return car;
}

function sceneFixture(tier = 1, id = 'rocket') {
  const scene = new GarageScene({ renderer: { toneMappingExposure: 1, render() {} }, makeVehicle: (kind, appearance) => createOwnedVehicle(assets, kind, appearance) });
  scene.room = rooms[tier - 1]; scene.toyProp.root=toyInstance();scene.scene.add(scene.toyProp.root); scene.ready = true; scene.tier = tier;
  scene.setVehicle(id); scene.setParking([{ id: 'van' }, { id: 'suv' }]);
  return scene;
}

function assertSafe(camera, limits, vehicleBounds, label) {
  assert.ok(camera.position.toArray().every(Number.isFinite), `${label}: finite eye`);
  assert.ok(camera.quaternion.toArray().every(Number.isFinite), `${label}: finite orientation`);
  assert.ok(camera.fov > 0 && camera.fov < 171, `${label}: finite lens`);
  const near = garageNearPlaneCorners(camera);
  for (const point of [camera.position, ...near]) {
    assert.ok(limits.bounds.containsPoint(point), `${label}: point escaped room ${point.toArray()}`);
    assert.ok(!vehicleBounds.containsPoint(point), `${label}: point entered selected vehicle`);
    for (const obstacle of limits.obstacles) assert.ok(!obstacle.containsPoint(point), `${label}: point entered room equipment/parked vehicle`);
  }
  // The bounding sphere contains every near-plane edge and both triangles, not just its four corners.
  const radius = Math.max(...near.map(point => point.distanceTo(camera.position)));
  assert.ok(vehicleBounds.distanceToPoint(camera.position) >= radius - 1e-4, `${label}: near-plane edge intersects selected body`);
  for (const obstacle of limits.obstacles) assert.ok(obstacle.distanceToPoint(camera.position) >= radius - 1e-4, `${label}: near-plane edge intersects equipment`);
}

function assertFits(camera, points, width, height, region, label) {
  for (const point of points) {
    const local = point.clone().applyMatrix4(camera.matrixWorldInverse);
    assert.ok(-local.z > camera.near, `${label}: focus behind near plane`);
    const projected = point.clone().project(camera), x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
    assert.ok(x >= region.x - .01 && x <= region.x + region.width + .01, `${label}: x=${x}`);
    assert.ok(y >= region.y - .01 && y <= region.y + region.height + .01, `${label}: y=${y}`);
  }
}

test('all real models fit asymmetric desktop/phone regions through full 360-degree orbit in all occupied tiers', () => {
  let frames = 0;
  for (const [tier, room] of rooms.entries()) {
    assert.equal(room.userData.garageCamera?.version, 1, `tier${tier + 1}: authored camera contract`);
    assert.ok(room.userData.garageCamera.obstacles.length > 0, `tier${tier + 1}: real equipment obstacles`);
    const parked = tier === 0 ? [] : [makeCar('van'), ...(tier > 1 ? [makeCar('suv')] : [])];
    parked.forEach((car, index) => { car.position.x = GARAGE_PARKING_BAYS[index].x; car.position.z = GARAGE_PARKING_BAYS[index].z; car.updateMatrixWorld(true); });
    const limits = garageCameraLimits(room, [...parked,toyInstance()]);
    for (const id of ids) {
      const car = makeCar(id), box = new T.Box3().setFromObject(car, true), points = garageBoxCorners(box);
      const pivot = new T.Vector3(0, Math.max(.75, Math.min(1.2, box.getSize(new T.Vector3()).y * .52)), 0);
      for (const [width, height, region] of viewports) for (const pitch of [.13, .48]) for (let step = 0; step < 48; step++) {
        const yaw = step * Math.PI / 24, radius = limits.orbitRadius, camera = new T.PerspectiveCamera(38, width / height, .08, 80);
        camera.position.copy(pivot).add(new T.Vector3(Math.sin(yaw) * radius, Math.sin(pitch) * radius, -Math.cos(yaw) * radius));
        const context = { limits, pivot, target: pivot, vehicleBounds: box, points, width, height, region, minimumFov: width < height ? 49 : 38 };
        constrainGarageCamera(camera, context);
        const label = `tier${tier + 1}/${id}/${width}x${height}/${pitch}/${step}`;
        assertSafe(camera, limits, box, label); assertFits(camera, points, width, height, region, label); frames++;
      }
    }
  }
  assert.equal(frames, 9600);
});

test('real wheel inspections stay outside body/equipment and fit their actual visible region at drag limits', () => {
  for (let tier = 1; tier <= 4; tier++) for (const id of ids) {
    const scene = sceneFixture(tier, id); scene.setInspection('wheels'); scene.advance(2);
    for (const [width, height, region] of viewports.filter(([width, height]) => width > height)) for (const yaw of [-1.28, -.63, .02]) for (const pitch of [.13, .48]) {
      scene.yaw = yaw; scene.pitch = pitch; scene.render(width, height, region);
      const context = scene.cameraContext;
      assertSafe(scene.camera, context.limits, context.vehicleBounds, `wheel/${tier}/${id}/${yaw}/${pitch}`);
      assertFits(scene.camera, context.points, width, height, region, `wheel/${tier}/${id}`);
    }
  }
});

test('right drag moves an actual foreground surface right, without rotating the car', () => {
  for (const mode of ['overview', 'rear', 'wheels']) for (const id of ids) {
    const scene = sceneFixture(2, id), [width, height, region] = viewports[1];
    scene.setInspection(mode); scene.advance(2); scene.render(width, height, region);
    const rotation = scene.vehicle.quaternion.clone(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2(2 * (region.x + region.width / 2) / width - 1, 1 - 2 * (region.y + region.height / 2) / height), scene.camera);
    const hit = ray.intersectObject(scene.vehicle, true)[0]; assert.ok(hit, `${id}/${mode}: actual foreground triangle`);
    const before = hit.point.clone().project(scene.camera).x;
    scene.orbit(8, 0); scene.render(width, height, region);
    const after = hit.point.clone().project(scene.camera).x;
    assert.ok(after > before + .0001, `${id}/${mode}: foreground moved left (${before} to ${after})`);
    assert.ok(rotation.equals(scene.vehicle.quaternion), `${id}/${mode}: actual car never spins`);
  }
  const scene = sceneFixture(2), [width, height, region] = viewports[1];
  scene.setInspection('cockpit'); scene.advance(2); scene.render(width, height, region);
  const point = new T.Box3().setFromObject(scene.vehicle.userData.yoke, true).getCenter(new T.Vector3()), before = point.clone().project(scene.camera).x;
  scene.orbit(8, 0); scene.render(width, height, region);
  assert.ok(point.clone().project(scene.camera).x > before, 'seated wheel surface also follows right drag');
});

test('interrupted exterior transitions route around the real body and settle finitely, never cross a wall', () => {
  for (let tier = 1; tier <= 4; tier++) for (const id of ids) {
    const scene = sceneFixture(tier, id), [width, height, region] = viewports[1];
    scene.render(width, height, region);
    for (const mode of ['rear', 'wheels', 'rear', 'overview']) {
      const start = scene.camera.position.clone(); scene.setInspection(mode); scene.render(width, height, region);
      assert.ok(scene.camera.position.distanceTo(start) < 1e-5, `${tier}/${id}/${mode}: interruption begins at displayed eye (${scene.camera.position.distanceTo(start)})`);
      for (let frame = 0; frame < 16; frame++) {
        scene.advance(.025); scene.render(width, height, region);
        assertSafe(scene.camera, scene.cameraContext.limits, scene.cameraContext.vehicleBounds, `transition/${tier}/${id}/${mode}/${frame}`);
      }
    }
    scene.advance(1); scene.render(width, height, region); assert.equal(scene.cameraMotion.active, false);
    const settled = scene.camera.position.clone(); scene.advance(1); scene.render(width, height, region);
    assert.ok(scene.camera.position.equals(settled), 'no idle drift or infinite damping tail');
  }
});

test('cockpit boundary uses the real seated eye immediately rather than interpolating through solid body', () => {
  const scene = sceneFixture(4), [width, height, region] = viewports[1]; scene.render(width, height, region);
  let data; scene.vehicle.traverse(node => { if (node.userData.driverDisplay) data = node.userData.driverDisplay; });
  const eye = new T.Vector3(...data.reference_eye_game_m).applyMatrix4(scene.vehicle.userData.bodyRig.matrixWorld);
  scene.setInspection('cockpit'); scene.render(width, height, region);
  for (let frame = 0; frame < 35; frame++) {
    assert.ok(scene.camera.position.distanceTo(eye) < 1e-8); scene.advance(.025); scene.render(width, height, region);
  }
  assert.equal(scene.cameraMotion.active, false);
  scene.setInspection('rear'); scene.render(width, height, region);
  assertSafe(scene.camera, scene.cameraContext.limits, scene.cameraContext.vehicleBounds, 'exit cockpit');
  scene.advance(.1); scene.render(width, height, region); scene.setInspection('cockpit'); scene.render(width, height, region);
  assert.ok(scene.camera.position.distanceTo(eye) < 1e-8, 'interrupted boundary still cuts directly to authored seat');
});

test('grazing lift-post directions approach continuously rather than jumping across a ray-box tangent', () => {
  const car = makeCar('van'), box = new T.Box3().setFromObject(car, true), points = garageBoxCorners(box);
  const limits = garageCameraLimits(rooms[1]), pivot = new T.Vector3(0, 1.2, 0);
  for (const [width, height, region] of viewports) {
    let previous = null;
    for (let step = 0; step <= 720; step++) {
      const yaw = step * Math.PI / 360, camera = new T.PerspectiveCamera(38, width / height, .08, 80);
      camera.position.copy(pivot).add(new T.Vector3(Math.sin(yaw) * 6, Math.sin(.13) * 6, -Math.cos(yaw) * 6));
      constrainGarageCamera(camera, { limits, pivot, target: pivot, vehicleBounds: box, points, width, height, region, minimumFov: width < height ? 49 : 38 });
      if (previous) assert.ok(camera.position.distanceTo(previous) < .12, `${width}x${height}/${step}: discontinuous orbit at lift post`);
      previous = camera.position.clone();
    }
  }
});

test('a manual drag takes over the displayed exterior orbit without inheriting the unfinished destination', () => {
  const scene = sceneFixture(2), [width, height, region] = viewports[1]; scene.render(width, height, region);
  scene.setInspection('rear'); scene.advance(.1); scene.render(width, height, region);
  const shown = scene.camera.position.clone(); scene.orbit(0, 0); scene.render(width, height, region);
  assert.equal(scene.cameraMotion.active, false);
  assert.ok(scene.camera.position.distanceTo(shown) < 1e-5, 'zero-delta takeover preserves the displayed eye');
  scene.orbit(8, 0); scene.render(width, height, region);
  assertSafe(scene.camera, scene.cameraContext.limits, scene.cameraContext.vehicleBounds, 'manual interrupted orbit');
});

/** The interruption distance is temporary even when a wheel close-up used a different look target. */
test('manual takeover recovers adaptive distance safely for all actual cars and occupied room tiers', () => {
  for(let tier=1;tier<=4;tier++)for(const id of ids)for(const destination of ['overview','wheels']){
    const scene=sceneFixture(tier,id),[width,height,region]=viewports[1];
    scene.setInspection(destination==='wheels'?'overview':'wheels');scene.advance(2);scene.render(width,height,region);
    scene.setInspection(destination);scene.advance(.17);scene.render(width,height,region);
    scene.orbit(8,0);scene.render(width,height,region);
    for(let frame=0;frame<24;frame++){
      scene.advance(1/60);scene.render(width,height,region);
      const context=scene.cameraContext,label=`recovery/${tier}/${id}/${destination}/${frame}`;
      assertSafe(scene.camera,context.limits,context.vehicleBounds,label);
      // An interrupted wheel close-up deliberately travels to the overview lens;
      // demanding the full-car envelope during that close-up recreates auto-zoom.
      if(!scene.orbitRecovery)assertFits(scene.camera,context.points,width,height,region,label);
    }
    assert.equal(scene.orbitRecovery,null);assert.equal(scene.animating,false);
    const final=scene.camera.position.clone();scene.advance(1);scene.render(width,height,region);assert.ok(final.equals(scene.camera.position));
  }
});

/** Test complete displayed optics, not merely an unchanged eye, at every exterior mode boundary. */
test('zero-delta takeover preserves eye, orientation and projection across exterior inspection pairs', () => {
 for(const from of ['overview','rear','wheels'])for(const to of ['overview','rear','wheels']){
  if(from===to)continue;
  const scene=sceneFixture(2),[width,height,region]=viewports[1];scene.setInspection(from);scene.advance(2);scene.render(width,height,region);
  scene.setInspection(to);scene.advance(.17);scene.render(width,height,region);
  const shown=scene.camera.clone(),label=`${from}->${to}`;scene.orbit(0,0);scene.render(width,height,region);
  assert.ok(scene.camera.position.distanceTo(shown.position)<1e-5,label+' eye');
  assert.ok(scene.camera.quaternion.angleTo(shown.quaternion)<1e-6,label+' orientation');
  assert.ok(Math.abs(scene.camera.fov-shown.fov)<1e-5,label+' lens');
  scene.camera.projectionMatrix.elements.forEach((n,i)=>assert.ok(Math.abs(n-shown.projectionMatrix.elements[i])<1e-5,label+' projection'));
  for(let frame=0;frame<24;frame++){scene.advance(1/60);scene.render(width,height,region);assertSafe(scene.camera,scene.cameraContext.limits,scene.cameraContext.vehicleBounds,label+'/'+frame);}
  assert.equal(scene.orbitRecovery,null);assert.equal(scene.animating,false);
 }
});
