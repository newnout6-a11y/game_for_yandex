import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from '../public/vendor/three.js';
import { createCar } from '../src/car.js';
import { roadBend } from '../src/world.js';

test('artist car binary includes four animated wheels, body and detailed indexed geometry', async () => {
  const bytes=await readFile('public/assets/car.glb');
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  for(const name of ['body','glass','wheel_fl','wheel_fr','wheel_rl','wheel_rr'])assert.ok(gltf.nodes.some(n=>n.name===name),name);
  assert.ok(gltf.accessors.filter(a=>a.type==='VEC3').reduce((n,a)=>n+a.count,0)>10000);
  assert.ok(gltf.extensionsUsed.includes('KHR_draco_mesh_compression'));
});
test('car instances normalize imported scale, retain wheel animation and isolate paint', () => {
  const original=new T.Group();
  const body=new T.Mesh(new T.BoxGeometry(4,2.5,9.4),new T.MeshStandardMaterial());body.name='body';body.position.set(2,3,1);original.add(body);
  for(const name of ['wheel_fl','wheel_fr','wheel_rl','wheel_rr']){const wheel=new T.Group();wheel.name=name;original.add(wheel);}
  const first=createCar(original,'#bb1711'),second=createCar(original,'#315465');
  const box=new T.Box3().setFromObject(first),size=box.getSize(new T.Vector3());
  assert.ok(Math.abs(size.z-4.7)<1e-8);assert.ok(Math.abs(box.min.y)<1e-8);
  assert.ok(Math.abs(box.getCenter(new T.Vector3()).x)<1e-8);
  assert.equal(first.userData.wheels.length,4);
  first.userData.wheels[0].rotation.x=2;assert.ok(Math.abs(second.userData.wheels[0].rotation.x)<1e-8);
  assert.notEqual(first.userData.paint,second.userData.paint);
  assert.equal(original.getObjectByName('body').position.x,2);
  assert.equal(original.getObjectByName('body').material.color.getHexString(),'ffffff');
  assert.throws(()=>createCar(null),/loaded/);
  assert.throws(()=>createCar(new T.Group()),/finite length/);
});
test('all runtime artwork matches the recorded source hashes and has a distribution license', async () => {
  const manifest=JSON.parse(await readFile('public/assets/manifest.json'));
  assert.equal(manifest.length,13);
  for(const item of manifest){
    const bytes=await readFile('public/'+item.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.file);
    assert.equal(bytes.length,item.bytes);
    assert.ok(['CC0-1.0','CC-BY-4.0'].includes(item.license));
    assert.match(item.source,/^https:/);
    if(item.file.includes('/fir-')){assert.equal(bytes.readUInt32BE(16),1024);assert.equal(bytes.readUInt32BE(20),1024);assert.equal(bytes[25],6,'PNG includes alpha');}
  }
  const credits=await readFile('public/assets/CREDITS.txt','utf8');
  assert.match(credits,/vicent091036/);assert.match(credits,/CC BY 4.0/);assert.match(credits,/Poly Haven/);
});
test('road curvature remains finite and centered at the player through route changes', () => {
  for(const distance of [0,1000,1000000]){
    assert.ok(Math.abs(roadBend(0,distance))<1e-8);assert.ok(Math.abs(roadBend(20,distance))<1e-8);
    assert.ok(Number.isFinite(roadBend(-650,distance)));
    assert.ok(Math.abs(roadBend(-3,distance))<.005);
  }
});
