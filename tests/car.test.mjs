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
test('reference-built Rocket includes editable hardware, cabin and bounded original geometry', async () => {
  const bytes=await readFile('public/assets/roadster.glb');
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  for(const name of ['wheel_fl','wheel_fr','wheel_rl','wheel_rr'])assert.ok(gltf.nodes.some(node=>node.name===name),name);
  assert.ok(gltf.nodes.some(node=>/^body/.test(node.name)));
  assert.ok(gltf.materials.some(material=>/ivory|seat/i.test(material.name)),'authored light cabin retained');
  assert.ok(gltf.materials.some(material=>/glass/i.test(material.name)));
  for (const name of ['underbody_matte_composite', 'underbody_satin_cast_metal']) {
    const material = gltf.materials.find(item => item.name === name);
    assert.ok(material, name); assert.ok(material.pbrMetallicRoughness.roughnessFactor >= .5, 'no polished mirror underfloor');
  }
  for (const name of ['detail_underbody', 'detail_shield', 'thruster_fl', 'thruster_fr', 'thruster_rl', 'thruster_rr'])
    assert.ok(gltf.nodes.some(node=>node.name===name), name);
  // The fidelity revision deliberately increases the single near-player budget.
  // These are regression ceilings, not a claim of measured phone performance.
  assert.ok(bytes.length<8_000_000,'documented detailed-player transfer budget');
  assert.ok(gltf.meshes.length<=80,'documented detailed-player mesh budget');
  const triangles=gltf.meshes.reduce((sum,mesh)=>sum+mesh.primitives.reduce((count,primitive)=>count+gltf.accessors[primitive.indices].count/3,0),0);
  assert.ok(triangles<=300_000,'documented detailed-player triangle budget');
  assert.ok((gltf.images?.length||0)<=12,'bounded embedded material maps');
  const metadata=gltf.nodes.find(node=>node.extras?.wheelRadius)?.extras;
  assert.match(metadata.variant,/Rocket.*single-seat/);
  assert.match(metadata.referenceBasis,/not factory CAD/);
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
test('all runtime artwork matches hashes and explicitly records its provenance and license status', async () => {
  const manifest=JSON.parse(await readFile('public/assets/manifest.json'));
  assert.ok(manifest.length>=14);
  const suppliedMedia = new Set(['assets/garage/roadster-screen-poster.jpg','assets/garage/roadster-screen-loop.mp4']);
  const mixedRooms = new Set([1,2,3,4].map(tier=>`assets/garage/tier${tier}.glb`));
  let disclosedThirdParty = 0;
  for(const item of manifest){
    const bytes=await readFile('public/'+item.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.file);
    assert.equal(bytes.length,item.bytes);
    if (item.file === 'assets/roadster.glb') {
      assert.equal(item.provenance, 'art/roadster-wing-preservation.json');
      const revision = JSON.parse(await readFile(item.provenance));
      assert.equal(item.sha256, revision.current.glbSha256);
      assert.equal(item.editableSource, 'art/roadster.blend');
      assert.match(item.changes, /intentional rear-wing seating revision/);
      assert.match(item.changes, /no tablet rerender/i);
    }
    // The supplied film and requested character prop have explicit third-party provenance.
    // This is a provenance check, not a commercial redistribution clearance.
    if (suppliedMedia.has(item.file)) {
      assert.equal(item.license,'Third-party user-supplied footage; redistribution license unverified');
      assert.equal(item.source,'https://www.youtube.com/watch?v=r5vsHHPVhJg');
      assert.equal(item.provenance,'art/garage/screen/supplied-video-provenance.json'); disclosedThirdParty++;
    } else if (mixedRooms.has(item.file)) {
      assert.equal(item.license,'Mixed: original project room artwork; user-provided third-party TV poster, redistribution license unverified');
      assert.match(item.changes,/user-provided Tesla footage/); disclosedThirdParty++;
    } else if(item.file==='assets/garage/toy-racecar.glb'){
      assert.equal(item.license,'Reference-based third-party character depiction; commercial rights unverified');
      assert.equal(item.source,'project:art/garage/toy/toy-racecar.blend');
      assert.equal(item.provenance,'art/garage/toy/provenance.json');
      assert.match(item.changes,/Disney\/Pixar/);assert.match(item.changes,/not embedded or redistributed/);disclosedThirdParty++;
    } else assert.ok(['CC0-1.0','CC-BY-4.0','Original-project-artwork'].includes(item.license),item.file);
    assert.match(item.source,/^(https:|project:)/);
    if(item.file.includes('/fir-')){assert.equal(bytes.readUInt32BE(16),1024);assert.equal(bytes.readUInt32BE(20),1024);assert.equal(bytes[25],6,'PNG includes alpha');}
  }
  assert.equal(disclosedThirdParty,7);
  const credits=await readFile('public/assets/CREDITS.txt','utf8');
  assert.match(credits,/vicent091036/);assert.match(credits,/CC BY 4.0/);assert.match(credits,/Poly Haven/);assert.match(credits,/Third-party|third-party/);assert.match(credits,/does not establish a commercial redistribution license/);assert.match(credits,/Lightning McQueen/);assert.match(credits,/Disney\/Pixar/);
});
test('road curvature remains finite and centered at the player through route changes', () => {
  for(const distance of [0,1000,1000000]){
    assert.ok(Math.abs(roadBend(0,distance))<1e-8);assert.ok(Math.abs(roadBend(20,distance))<1e-8);
    assert.ok(Number.isFinite(roadBend(-650,distance)));
    assert.ok(Math.abs(roadBend(-3,distance))<.005);
  }
});
