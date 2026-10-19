import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { GarageScene } from '../src/garage-scene.js';
import { createOwnedVehicle } from '../src/owned-vehicles.js';
import { installTrafficTemplates, TRAFFIC_KINDS } from '../src/traffic.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

// Reintroduce only the two superseded calculations from bcf557a7 in memory.
// The actual GLBs, shared imports and all other rendering code stay identical.
// This executable witness proves removal changes no displayed camera matrix,
// including a second preset interruption which consumes the focus metadata.
const url = new URL('../src/garage-scene.js', import.meta.url);
const source = await readFile(url, 'utf8');
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `Unique recovery witness anchor: ${from}`);
  return text.replace(from, to);
}
let legacy = replaceOnce(source, 'let pitch=this.pitch,yaw=this.yaw,lookTarget=target;', 'let pitch=this.pitch,yaw=this.yaw,lookTarget=target,fitFov=minimumFov;');
legacy = replaceOnce(legacy, '      if(recovery.points?.length===points.length)points=recovery.points.map((point,index)=>point.clone().lerp(points[index],t));', `      if(recovery.points?.length===points.length)points=recovery.points.map((point,index)=>point.clone().lerp(points[index],t));
      fitFov=T.MathUtils.lerp(recovery.fov,minimumFov,t);
      this.camera.near=T.MathUtils.lerp(recovery.near,this.camera.near,t);this.camera.updateProjectionMatrix();`);
legacy = replaceOnce(legacy, 'region,minimumFov,fixedProjection:recoveryProjection', 'region,minimumFov:fitFov,fixedProjection:recoveryProjection');
legacy = legacy.replace(/from (['"])(\.[^'"]+)\1/g, (_all, quote, path) => `from ${quote}${new URL(path, url).href}${quote}`)
  .replaceAll('import.meta.url', JSON.stringify(url.href));
const { GarageScene: LegacyScene } = await import(`data:text/javascript;base64,${Buffer.from(legacy).toString('base64')}`);
const assets = { car: (await loadRoadsterGeometry()).scene, traffic: {} };
for (const id of TRAFFIC_KINDS) assets.traffic[id] = (await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`, import.meta.url))).scene;
installTrafficTemplates(assets.traffic);
const room = (await loadRoadsterGeometry(new URL('../public/assets/garage/tier2.glb', import.meta.url))).scene;
function fixture(Scene, id) {
  const scene = new Scene({ renderer: { toneMappingExposure: 1, render() {} }, makeVehicle: (kind, appearance) => createOwnedVehicle(assets, kind, appearance) });
  scene.room = room; scene.ready = true; scene.tier = 2; scene.setVehicle(id); scene.setParking([{ id: 'van' }]);
  return scene;
}
function displayed(scene) {
  const c = scene.camera;
  return {
    world: c.matrixWorld.elements, inverse: c.matrixWorldInverse.elements,
    projection: c.projectionMatrix.elements, projectionInverse: c.projectionMatrixInverse.elements,
    position: c.position.toArray(), quaternion: c.quaternion.toArray(), fov: c.fov, near: c.near, view: c.view,
    focus: c.userData.garageFocusPoints?.map(point => point.toArray()), target: c.userData.garageLookTarget?.toArray(),
    capturedFocus: scene.cameraMotion.from?.points?.map(point => point.toArray()),
  };
}
for (const id of ['rocket', 'hatch', 'sedan', 'suv', 'van']) test(`${id}: removed wheel-recovery calculations have exact displayed-matrix and focus parity`, () => {
  let recovering = 0, frames = 0;
  for (const [w, h, region] of [
    [551, 360, { x: 82, y: 108, width: 454, height: 194 }],
    [844, 390, { x: 173, y: 129, width: 361, height: 140 }],
    [1440, 900, { x: 248, y: 198, width: 800, height: 560 }],
  ]) for (const stableOrbit of [true, false]) {
    const pair = [fixture(GarageScene, id), fixture(LegacyScene, id)];
    const render = label => {
      pair.forEach(s => s.render(w, h, region, { stableOrbit }));
      assert.deepEqual(displayed(pair[0]), displayed(pair[1]), `${w}/${stableOrbit}/${label}`);
      if (pair[0].orbitRecovery && pair[0].inspection === 'wheels') recovering++;
      frames++;
    };
    render('entry');
    for (const destination of ['wheels', 'rear', 'wheels', 'overview']) {
      pair.forEach(s => { s.setInspection(destination); s.advance(.17); }); render(`${destination}/preset`);
      pair.forEach(s => s.orbit(8, 2)); render(`${destination}/takeover`);
      for (let frame = 0; frame < 24; frame++) {
        pair.forEach(s => { s.orbit(frame % 2 ? 1 : -1, 0); s.advance(1 / 60); }); render(`${destination}/${frame}`);
      }
    }
    // Interrupt while wheel recovery is still active: its blended focus points
    // are consumed by the next non-stable preset rather than only inspected.
    pair.forEach(s => { s.setInspection('overview'); s.advance(2); }); render('metadata/settled');
    pair.forEach(s => { s.setInspection('wheels'); s.advance(.17); }); render('metadata/wheels');
    pair.forEach(s => { s.orbit(8, 0); s.advance(.1); }); render('metadata/recovering');
    pair.forEach(s => { s.setInspection('rear'); s.advance(.21); }); render('metadata/interrupted');
    pair.forEach(s => s.dispose());
  }
  assert.equal(frames, 654);
  assert.ok(recovering >= 240, 'Exercise genuine non-stable wheel recovery, not only settled frames');
});

test('non-stable recovery has one optics owner while retaining downstream focus metadata', () => {
  assert.doesNotMatch(source, /fitFov|this\.camera\.near=T\.MathUtils\.lerp\(recovery\.near,this\.camera\.near/);
  assert.match(source, /recoveryProjection above exclusively owns its optics/);
  assert.match(source, /if\(recovery\.points\?\.length===points\.length\)points=recovery\.points\.map/);
});
