import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from '../public/vendor/three.js';
import {createCar,setPlayerAeroPose} from '../src/car.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';
import {ROCKET_CONTACT_SHAPE} from '../src/player-contact-shape.js';
const proof=JSON.parse(await readFile(new URL('../docs/handling-contact-metrics/rocket-compound.json',import.meta.url),'utf8'));
test('measured Rocket proxies retain their original basis through the explicit wing-only revision',async()=>{
 const wing=JSON.parse(await readFile(new URL('../art/roadster-wing-preservation.json',import.meta.url),'utf8'));
 // Preserve the original measurement anchor; do not relabel an old mesh survey.
 assert.equal(proof.sourceAsset.sha256,'d71068fb3da4771f1a5945f03d078cd97a4cac4f0884442cda9c7c732722100e');
 assert.equal(wing.baseline.glbSha256,proof.sourceAsset.sha256);
 const bytes=await readFile(new URL('../'+proof.sourceAsset.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),wing.current.glbSha256);
 assert.equal(ROCKET_CONTACT_SHAPE.length,9);
 for(const p of proof.rectangles){const actual=ROCKET_CONTACT_SHAPE.find(q=>q.id===p.id);assert.ok(actual,p.id);
  for(const key of ['role','centerX','centerY','centerZ','halfWidth','halfHeight','halfLength'])assert.equal(actual[key],p[key],p.id+'.'+key);
  assert.ok(actual.centerY-actual.halfHeight<=p.actualMinY+1e-9);assert.ok(actual.centerY+actual.halfHeight>=p.actualMaxY-1e-9);
 }
});
// Clip actual indexed triangles: a triangle crossing a band boundary must also
// remain inside that band's filled proxy, not only at its original vertices.
function clipZ(polygon,z,keepGreater){
 const result=[];
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length];
  const insideA=keepGreater?a.z>=z:a.z<=z,insideB=keepGreater?b.z>=z:b.z<=z;
  if(insideA)result.push(a);
  if(insideA!==insideB)result.push(a.clone().lerp(b,(z-a.z)/(b.z-a.z)));
 }
 return result;
}
test('revised rear body and wing triangles remain inside the unchanged compound at nine deployment poses',async()=>{
 const {scene}=await loadRoadsterGeometry(),car=createCar(scene);
 const changed=['body','detail_carbon','wing_pivot_body','wing_pivot_dark_alloy','wing_tip_l_body','wing_tip_l_dark_alloy','wing_tip_r_body','wing_tip_r_dark_alloy'];
 for(const amount of [0,.125,.25,.375,.5,.625,.75,.875,1]){
  setPlayerAeroPose(car,amount);car.updateMatrixWorld(true);
  for(const id of ['rear_body_wheels','tail']){
   const measured=proof.rectangles.find(p=>p.id===id),box=ROCKET_CONTACT_SHAPE.find(p=>p.id===id);
   let samples=0;
   for(const name of changed){
    const mesh=car.getObjectByName(name),g=mesh.geometry;
    const matrix=car.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const count=g.index?.count??g.attributes.position.count;
    for(let i=0;i<count;i+=3){
     let polygon=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(g.attributes.position,g.index?g.index.getX(i+k):i+k).applyMatrix4(matrix));
     polygon=clipZ(clipZ(polygon,measured.coreBand[0],true),measured.coreBand[1],false);
     for(const point of polygon){
      samples++;
      assert.ok(Math.abs(point.x-box.centerX)<=box.halfWidth+1e-6,`${id}/${name} X at deployment ${amount}`);
      assert.ok(Math.abs(point.y-box.centerY)<=box.halfHeight+1e-6,`${id}/${name} Y at deployment ${amount}`);
      assert.ok(Math.abs(point.z-box.centerZ)<=box.halfLength+1e-6,`${id}/${name} Z at deployment ${amount}`);
     }
    }
   }
   assert.ok(samples>1000,'Test actual changed-batch triangles, not an empty selection');
  }
 }
 // Sampled deployment containment, not an exact continuous 3-D CCD claim.
});
test('mirrors and wheel shoulders stay local instead of broadening the entire nose',()=>{
 const nose=ROCKET_CONTACT_SHAPE.find(p=>p.id==='nose'),mirror=ROCKET_CONTACT_SHAPE.find(p=>p.id==='mirror_left'),wheel=ROCKET_CONTACT_SHAPE.find(p=>p.id==='front_wheel_left');
 assert.equal(mirror.role,'mirror');assert.equal(wheel.role,'wheel');assert.ok(nose.halfWidth<1);assert.ok(mirror.centerZ-mirror.halfLength>nose.centerZ+nose.halfLength);assert.ok(wheel.centerX-wheel.halfWidth<=-1.14351132);
});
