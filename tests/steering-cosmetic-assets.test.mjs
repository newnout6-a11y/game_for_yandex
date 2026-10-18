import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { meshTriangles, triangleTree, meshPiercing } from './helpers/player-triangle-clearance.mjs';
import { createCar, animatePlayerCar } from '../src/car.js';

const directory = new URL('../public/assets/cosmetics/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('steering-manifest.json', directory)));
const base = await loadRoadsterGeometry();
const options = await Promise.all(manifest.assets.map(async record => ({record, ...await loadRoadsterGeometry(new URL(record.asset,directory))})));
const near = (a,b,tolerance=1e-6) => assert.ok(Math.abs(a-b)<tolerance, `${a} differs from ${b}`);

function mount(option) {
  const car = createCar(base.scene), pivot = car.userData.yoke;
  const original = pivot.children.filter(node => manifest.mount.hideOnlyOriginalMeshes.includes(node.name));
  for (const mesh of original) mesh.visible = false;
  const asset = option.scene.getObjectByName(option.record.root).clone(true);
  pivot.add(asset);
  car.updateMatrixWorld(true);
  return {car,pivot,asset,original};
}

function exactBounds(root) {
  root.updateWorldMatrix(true,true);
  const inverse = root.matrixWorld.clone().invert(), box = new T.Box3();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const matrix = inverse.clone().multiply(mesh.matrixWorld), position = mesh.geometry.attributes.position;
    for(let i=0;i<position.count;i++) box.expandByPoint(new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(matrix));
  });
  return box;
}

test('steering variants preserve the accepted source and exact existing pivot contract', async () => {
  assert.equal(createHash('sha256').update(base.bytes).digest('hex'),manifest.sourceRoadsterSha256);
  const pivot = base.scene.getObjectByName('steering_yoke');
  assert.deepEqual(pivot.position.toArray(),manifest.mount.originalPivotTranslation);
  assert.deepEqual(pivot.quaternion.toArray(),manifest.mount.originalPivotQuaternion);
  assert.deepEqual(pivot.children.map(n=>n.name).sort(),manifest.mount.hideOnlyOriginalMeshes.slice().sort());
  assert.deepEqual(manifest.mount.position,[0,0,0]);
  assert.deepEqual(manifest.mount.quaternion,[0,0,0,1]);
  assert.deepEqual(manifest.mount.scale,[1,1,1]);
  assert.equal(manifest.mount.parent,'steering_yoke');
  for(const {record,json,bytes,scene} of options) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
    assert.ok((await stat(new URL('../'+record.editableSource,import.meta.url))).size>100_000);
    const root=scene.getObjectByName(record.root);
    assert.deepEqual(root.position.toArray(),[0,0,0]);
    assert.deepEqual(root.quaternion.toArray(),[0,0,0,1]);
    assert.deepEqual(root.scale.toArray(),[1,1,1]);
    assert.equal(root.userData.attachment_parent,'steering_yoke');
    assert.ok(json.meshes.length <= 4 && record.drawBatches === 4);
    assert.ok(record.editableParts >= 30,'grips, hub, spokes and physical small details are individually editable');
    assert.ok(bytes.length < 600_000);
    assert.ok(record.triangles > 2500 && record.triangles < 14000);
  }
});

test('measured steering bounds and all finite, nondegenerate outward geometry match the manifest', () => {
  for(const {record,scene} of options) {
    const root=scene.getObjectByName(record.root), box=exactBounds(root);
    for(let i=0;i<3;i++) {near(box.min.getComponent(i),record.boundsPivotLocalM.min[i]);near(box.max.getComponent(i),record.boundsPivotLocalM.max[i]);}
    assert.ok(box.min.x > -.236 && box.max.x < .236,'both options stay inside accepted steering width');
    assert.ok(box.min.y > -.2 && box.max.y < .2);
    assert.ok(box.min.z >= -.0441 && box.max.z < .036);
    let count=0;
    root.traverse(mesh=> {
      if(!mesh.isMesh) return;
      assert.equal(mesh.material.side,T.FrontSide);
      assert.equal(mesh.material.transparent,false);
      for(const {v} of meshTriangles(mesh)) {
        const [a,b,c]=v;
        assert.ok([...a,...b,...c].every(Number.isFinite));
        assert.ok(b.sub(a).cross(c.sub(a)).lengthSq()>1e-19,'no zero-area exported faces');count++;
      }
    });
    assert.equal(count,record.triangles);
  }
});

test('the options are real distinct steering silhouettes, not whole-cabin overlays', () => {
  const round=options.find(o=>o.record.id==='steering_round').scene;
  const yoke=options.find(o=>o.record.id==='steering_yoke').scene;
  for(const angle of Array.from({length:32},(_,i)=>i*Math.PI*2/32)) {
    const origin=new T.Vector3(.169*Math.cos(angle),.169*Math.sin(angle),.1);
    assert.ok(new T.Raycaster(origin,new T.Vector3(0,0,-1),0,.2).intersectObject(round,true).length,'round rim is continuous at every sampled angle');
  }
  assert.equal(new T.Raycaster(new T.Vector3(0,.12,.1),new T.Vector3(0,0,-1),0,.2).intersectObject(yoke,true).length,0,'compact yoke has a genuinely open upper centre');
  for(const sign of [-1,1]) assert.ok(new T.Raycaster(new T.Vector3(sign*.20,.04,.1),new T.Vector3(0,0,-1),0,.2).intersectObject(yoke,true).length,'yoke has real left and right palm grips');
});

test('identity mounted options inherit steering animation and only hide original wheel meshes', () => {
  for(const option of options) {
    const {car,pivot,asset,original}=mount(option), tablet=car.getObjectByName('detail_rc_ui');
    assert.equal(original.length,5);
    assert.ok(original.every(n=>n.visible===false));
    assert.ok(tablet.visible);
    const rest=asset.matrixWorld.clone();
    animatePlayerCar(car,.7,.06);
    car.updateMatrixWorld(true);
    assert.equal(car.userData.yoke,pivot);
    assert.notDeepEqual(asset.matrixWorld.elements,rest.elements);
    assert.deepEqual(asset.position.toArray(),[0,0,0]);
    assert.deepEqual(asset.quaternion.toArray(),[0,0,0,1]);
    assert.ok(tablet.visible);
    // Static tablet never becomes a descendant of a rotating wheel.
    assert.ok(!pivot.getObjectByName('detail_rc_ui'));
  }
  assert.ok(base.scene.getObjectByName('steering_yoke').children.every(n=>n.visible),'source template remains unmodified');
});

test('new steering geometry leaves tablet and right-camera display visible at steering extremes', () => {
  for(const option of options) {
    const {car,pivot,asset}=mount(option), root=car.getObjectByName('Roadster'), meta=root.userData.driverDisplay;
    const eyes=[];
    for(let x=0;x<5;x++)for(let y=0;y<5;y++)for(let z=0;z<5;z++) eyes.push([x,y,z].map((value,axis)=>meta.tested_eye_box_min_game_m[axis]+(meta.tested_eye_box_max_game_m[axis]-meta.tested_eye_box_min_game_m[axis])*value/4));
    const targets=[];
    for(let x=0;x<9;x++)for(let y=0;y<7;y++) targets.push(new T.Vector3(...meta.center_game_m)
      .addScaledVector(new T.Vector3(...meta.right_game),(x/8-.5)*meta.active_dimensions_m[0])
      .addScaledVector(new T.Vector3(...meta.up_game),(y/6-.5)*meta.active_dimensions_m[1]));
    const rear=car.getObjectByName('detail_right_rear_display').userData.rightRearDisplay;
    for(let x=0;x<5;x++)for(let y=0;y<3;y++) targets.push(new T.Vector3(...rear.point)
      .addScaledVector(new T.Vector3(...rear.right),(x/4-.5)*rear.active_dimensions_m[0])
      .addScaledVector(new T.Vector3(...rear.up),(y/2-.5)*rear.active_dimensions_m[1]));
    for(const angle of [-1.2,-.6,0,.6,1.2]) {
      pivot.quaternion.setFromAxisAngle(new T.Vector3(0,0,1),angle);car.updateMatrixWorld(true);
      for(const originLocal of eyes)for(const targetLocal of targets) {
        const origin=new T.Vector3(...originLocal).applyMatrix4(root.matrixWorld), target=targetLocal.clone().applyMatrix4(root.matrixWorld);
        const direction=target.sub(origin), distance=direction.length();
        const hits=new T.Raycaster(origin,direction.normalize(),.00001,distance-.0001).intersectObject(asset,true);
        assert.equal(hits.length,0,`${option.record.id} ${angle} must not cover existing screens`);
      }
    }
  }
});

test('steering options do not pierce stationary cabin triangles through their whole steering range', () => {
  for(const option of options) {
    const {car,pivot,asset,original}=mount(option), stationary=[];
    car.updateMatrixWorld(true);
    // Real finite triangles, not overlapping AABBs, decide all candidate contacts.
    const envelope=new T.Box3().setFromCenterAndSize(pivot.getWorldPosition(new T.Vector3()),new T.Vector3(.52,.52,.12));
    car.traverse(mesh=> {
      if(!mesh.isMesh||original.includes(mesh)||mesh.parent===asset) return;
      for(const triangle of meshTriangles(mesh,mesh.matrixWorld)) if(triangle.box.intersectsBox(envelope)) stationary.push(triangle);
    });
    const tree=triangleTree(stationary), parts=[];
    asset.traverse(mesh=>{if(mesh.isMesh)parts.push({mesh,records:meshTriangles(mesh)});});
    for(let i=0;i<=24;i++) {
      const angle=-1.2+i*.1;pivot.quaternion.setFromAxisAngle(new T.Vector3(0,0,1),angle);car.updateMatrixWorld(true);
      for(const {mesh,records} of parts) assert.equal(meshPiercing(records,mesh.matrixWorld,tree),null,`${option.record.id} at ${angle}: no wheel/column/dash/body triangle penetration`);
    }
  }
});
