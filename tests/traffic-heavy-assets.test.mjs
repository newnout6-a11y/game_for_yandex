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
    assert.equal(meshes, kind === 'boxtruck' ? 25 : 37);
    assert(triangles < (kind === 'boxtruck' ? 32000 : 49000));
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


for (const kind of ['boxtruck', 'semi']) {
  test(`${kind}: adult driver has reachable unit-scale two-bone arms and steering grips`, async () => {
    const root = await loadHeavy(kind), spec = TRAFFIC_CATALOG[kind];
    const wheel = root.getObjectByName('steering_wheel'), stalk = root.getObjectByName('indicator_stalk');
    assert(wheel && !wheel.isMesh && stalk && !stalk.isMesh);
    const head=root.getObjectByName('driver_head');
    assert(head && !head.isMesh && head.scale.distanceTo(new T.Vector3(1,1,1))<1e-6);
    assert.equal(head.children.filter(n=>n.isMesh).length,1);
    assert.equal(head.children[0].material.name,'cabin_interior');
    assert(head.children[0].geometry.attributes.color);
    assert(new T.Vector3(0,0,-1).applyQuaternion(head.quaternion).distanceTo(new T.Vector3(0,0,-1))<1e-6);
    assert(new T.Vector3(0,1,0).applyQuaternion(head.quaternion).distanceTo(new T.Vector3(0,1,0))<1e-6);

    assert.equal(wheel.children.filter(n => n.isMesh).length, 1);
    const facing = new T.Vector3(0,0,1).applyQuaternion(wheel.getWorldQuaternion(new T.Quaternion()));
    assert(facing.y > .4 && facing.z > .8, 'Steering wheel local +Z must face back toward driver');
    for (const side of ['l','r']) {
      const shoulder = root.getObjectByName(`driver_shoulder_${side}`);
      const elbow = root.getObjectByName(`driver_elbow_${side}`);
      const hand = root.getObjectByName(`driver_hand_${side}`);
      const grip = root.getObjectByName(`grip_${side}`);
      assert.equal(elbow.parent,shoulder); assert.equal(hand.parent,elbow); assert.equal(grip.parent,wheel);
      for (const pivot of [wheel,stalk,shoulder,elbow,hand,grip]) {
        assert(pivot.scale.distanceTo(new T.Vector3(1,1,1)) < 1e-6, 'IK anchors must not inherit baked scale');
      }
      assert(elbow.position.distanceTo(new T.Vector3(0,.30,0)) < 1e-6);
      assert(hand.position.distanceTo(new T.Vector3(0,.28,0)) < 1e-6);
      assert.equal(shoulder.userData.upperLength,.30);assert.equal(shoulder.userData.forearmLength,.28);
      assert(hand.getWorldPosition(new T.Vector3()).distanceTo(grip.getWorldPosition(new T.Vector3())) < .00001);
      for (const part of [shoulder,elbow,hand]) {
        const meshes=part.children.filter(n=>n.isMesh);assert.equal(meshes.length,1);
        assert.equal(meshes[0].material.name,'cabin_interior');assert(meshes[0].geometry.attributes.color);
      }
      const base=wheel.quaternion.clone();
      for(const angle of [-.58,-.29,0,.29,.58]) {
        wheel.quaternion.copy(base).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),angle));
        root.updateMatrixWorld(true);
        const reach=shoulder.getWorldPosition(new T.Vector3()).distanceTo(grip.getWorldPosition(new T.Vector3()));
        assert(reach < .575 && reach > .04, 'Steering grip must remain within the physical arm lengths');
      }
      wheel.quaternion.copy(base);root.updateMatrixWorld(true);
      if(side==='l') assert(shoulder.getWorldPosition(new T.Vector3()).distanceTo(stalk.getWorldPosition(new T.Vector3())) < .575);
    }
  });
  test(`${kind}: floor, firewall and inner liners close wheel exposure without window backing`, async () => {
    const root = await loadHeavy(kind), spec=TRAFFIC_CATALOG[kind], front=-spec.length/2+.09;
    const ray=new T.Raycaster();
    const probe=(origin,direction,label)=>{
      ray.set(new T.Vector3(...origin),new T.Vector3(...direction).normalize());
      const hit=ray.intersectObject(root,true).find(h=>!h.object.material.transparent);
      assert(hit,`${label} must hit a real interior surface`);
      assert.equal(hit.object.material.name,'cabin_interior',`${label} must meet a liner before an outside wheel or road`);
    };
    for(const x of [-.82,-.25,.25,.82]) for(const z of [.30,.70,1.20,1.72,2.08]) {
      probe([x,1.30,front+z],[0,-1,0],'Sealed floor');
    }
    for(const side of [-1,1]) {
      probe([side*.80,1.65,front+1.2],[side*.2,-1,0],'Wheel-well interior');
      probe([side*.80,1.42,front+.90],[side,0,0],'Inner door liner');
    }
    probe([0,1.44,front+.70],[0,0,-1],'Front firewall');
  });
}
