import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TRAFFIC_CATALOG } from '../src/traffic-catalog.js';

async function loadHeavy(kind) {
  const bytes = await readFile(new URL(`../public/assets/traffic/${kind}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}
for (const kind of ['boxtruck', 'semi']) {
  test(`${kind}: refined Blender wheels retain dimensions and pivot contracts`, async () => {
    const root = await loadHeavy(kind), spec = TRAFFIC_CATALOG[kind];
    const bounds = new T.Box3().setFromObject(root), wheels = [];
    let meshes = 0, triangles = 0;
    root.traverse(node => {
      if (node.name.startsWith('wheel_')) wheels.push(node);
      if (!node.isMesh) return;
      meshes++;
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
      for (const attr of ['position', 'normal']) {
        for (const value of node.geometry.attributes[attr].array) assert(Number.isFinite(value));
      }
    });
    assert.equal(wheels.length, spec.axles * 2);
    assert.equal(meshes, kind === 'boxtruck' ? 17 : 29);
    assert(triangles < (kind === 'boxtruck' ? 21500 : 39000));
    assert(bounds.min.y >= 0 && bounds.min.y < .013);
    assert(bounds.min.x >= -spec.width / 2 && bounds.max.x <= spec.width / 2);
    assert(bounds.min.z >= -spec.length / 2 && bounds.max.z <= spec.length / 2);
    assert(bounds.max.y <= spec.height + .0001);
    for (const pivot of wheels) {
      assert.equal(pivot.userData.wheel_revision, 2);
      assert.equal(pivot.children.length, 1);
      const wheel = pivot.children[0];
      assert(wheel.isMesh && wheel.geometry.attributes.color);
      assert.equal(wheel.userData.authored_in, 'Blender');
      assert.equal(wheel.material.side, T.FrontSide);
      if (pivot.userData.axle_role !== 'steer') {
        assert(pivot.userData.dual_tire_gap >= .035);
        const position = wheel.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          if (Math.hypot(position.getY(i), position.getZ(i)) > spec.wheelRadius * .81) {
            assert(Math.abs(position.getX(i)) >= .021, 'Paired tire carcasses need a genuine open gap');
          }
        }
      }
    }
    if (kind === 'semi') {
      const trailer = root.getObjectByName('trailer');
      assert(Math.abs(trailer.position.z - spec.hitchZ) < .0001);
      const rear = root.getObjectByName('wheel_trailer2_r');
      const before = rear.getWorldPosition(new T.Vector3());
      trailer.rotation.y = .15; root.updateMatrixWorld(true);
      assert(Math.abs(rear.getWorldPosition(new T.Vector3()).x - before.x) > 1);
    }
  });
  test(`${kind}: ten rim vents are actual openings and exterior normals face out`, async () => {
    const root = await loadHeavy(kind), spec = TRAFFIC_CATALOG[kind];
    const pivot = root.getObjectByName('wheel_fr'), mesh = pivot.children[0];
    const center = pivot.getWorldPosition(new T.Vector3());
    const ray = new T.Raycaster(), axis = new T.Vector3(-1, 0, 0);
    const sample = (angle, radial) => {
      const origin = center.clone().add(new T.Vector3(1, Math.cos(angle) * radial, Math.sin(angle) * radial));
      ray.set(origin, axis);
      return ray.intersectObject(mesh, false)[0];
    };
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5;
      const hole = sample(angle, spec.wheelRadius * .43);
      const web = sample(angle + Math.PI / 10, spec.wheelRadius * .43);
      assert(hole && web, 'Both open vent and steel web must reveal a physical surface');
      assert(web.point.x - hole.point.x > .02, 'Vent must expose a recessed drum, not a painted disk');
      assert(web.face.normal.x > .9, 'Stamped steel front face must not be backface-culled');
    }
    const tire = sample(0, spec.wheelRadius * .93);
    assert(tire && tire.face.normal.x > .1, 'Rounded outer tire shoulder must face outward');
  });
}

for (const kind of ['boxtruck', 'semi']) {
  test(`${kind}: real cabin apertures reveal interior behind clear glazing`, async () => {
    const root = await loadHeavy(kind), spec = TRAFFIC_CATALOG[kind], front = -spec.length / 2 + .09;
    const materials = new Map();
    root.traverse(node => { if (node.isMesh) materials.set(node.material.name, node.material); });
    const glass = materials.get('cabin_glass'), mirror = materials.get('mirror_reflector');
    assert(glass?.transparent && glass.opacity >= .10 && glass.opacity <= .25);
    assert((glass.transmission || 0) === 0, 'Cabin glass must not need a transmission render pass');
    assert(mirror && !mirror.transparent && mirror.metalness > .9 && mirror.roughness < .15);
    assert(materials.has('cabin_interior'));
    const ray = new T.Raycaster();
    for (const x of [-.5, .5]) {
      ray.set(new T.Vector3(x, 2.17, front - .7), new T.Vector3(0, 0, 1));
      const hits = ray.intersectObject(root, true);
      assert(hits.some(h => h.object.material.name === 'cabin_glass'), 'Probe must pass through the real windshield');
      const opaque = hits.find(h => !h.object.material.transparent);
      assert.equal(opaque?.object.material.name, 'cabin_interior', 'Solid cab paint or old black backing must not obscure the seats');
      assert(opaque.object.geometry.attributes.color);
    }
    for (const side of ['left', 'right']) {
      const indicators=[];
      root.traverse(n => { if(n.isMesh && n.material.name === `indicator_${side}`) indicators.push(n); });
      assert.equal(indicators.length, kind === 'boxtruck' ? 1 : 2);
      for(const lens of indicators) {
        const bounds = new T.Box3().setFromObject(lens);
        assert(side === 'left' ? bounds.max.x < 0 : bounds.min.x > 0, 'Each indicator material must stay on its own side');
      }
    }
    assert(materials.has('lights_red'), 'Turn signals must not replace brake lights');
  });
}
