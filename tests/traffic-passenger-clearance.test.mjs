import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import {TRAFFIC_KINDS,installTrafficTemplates,createTrafficCar} from '../src/traffic.js';
import {trafficDefinition} from '../src/traffic-catalog.js';
import {limitTrafficSuspension} from '../src/traffic-motion.js';

// Exact triangle/triangle intersections, not tire-centre or bounding-box tests.
// The BVH only rejects disjoint pairs; the final predicate tests all six edges.
function triangles(mesh,matrix=new T.Matrix4()){
 const g=mesh.geometry,p=g.attributes.position,ix=g.index,out=[];
 for(let i=0;i<ix.count;i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix.getX(i+j)).applyMatrix4(matrix));out.push({v,box:new T.Box3().setFromPoints(v),mesh:mesh.name,index:i/3});}
 return out;
}
function tree(tris){
 const box=new T.Box3();for(const t of tris)box.union(t.box);
 if(tris.length<10)return{box,tris};
 const s=box.getSize(new T.Vector3()),axis=s.x>s.y&&s.x>s.z?'x':s.y>s.z?'y':'z';
 tris.sort((a,b)=>a.box.min[axis]+a.box.max[axis]-b.box.min[axis]-b.box.max[axis]);
 const n=tris.length>>1;return{box,left:tree(tris.slice(0,n)),right:tree(tris.slice(n))};
}
const ray=new T.Ray(),delta=new T.Vector3(),point=new T.Vector3();
function edgeHits(a,b){
 for(let i=0;i<3;i++){
  const start=a[i];delta.copy(a[(i+1)%3]).sub(start);const length=delta.length();if(length<1e-8)continue;
  ray.set(start,delta.multiplyScalar(1/length));
  if(ray.intersectTriangle(b[0],b[1],b[2],false,point)){
   const distance=point.distanceTo(start);
   if(distance>1e-6&&distance<length-1e-6)return point.toArray();
  }
 }
 return null;
}
function intersection(triangle,node){
 if(!triangle.box.intersectsBox(node.box))return null;
 if(node.tris){for(const other of node.tris){if(!triangle.box.intersectsBox(other.box))continue;const hit=edgeHits(triangle.v,other.v)||edgeHits(other.v,triangle.v);if(hit)return{point:hit,cabinTriangle:other.index,wheelTriangle:triangle.index,mesh:triangle.mesh};}return null;}
 return intersection(triangle,node.left)||intersection(triangle,node.right);
}
const models={};for(const kind of TRAFFIC_KINDS){const bytes=await readFile(new URL(`../public/assets/traffic/${kind}.glb`,import.meta.url));models[kind]=(await new T.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;}installTrafficTemplates(models);
for(const kind of ['sedan','hatch','suv','van'])test(`${kind}: front tires and rims clear the closed cabin through steering, spin and full suspension envelope`,()=>{
 const car=createTrafficCar(kind),cabin=car.getObjectByName('cabin_interior'),body=car.userData.bodyRig;
 const enclosure=car.getObjectByName('traffic_'+kind).userData.front_tub_clearance;
 assert.ok(enclosure&&enclosure.inner>.3&&enclosure.radius>car.userData.wheelRadius+.12,'A real swept-clearance cavity must be exported, not a missing liner');
 const bvh=tree(triangles(cabin)),inverse=new T.Matrix4(),matrix=new T.Matrix4();let poses=0;
 for(const pitch of [-.05,0,.05])for(const roll of [-.06,0,.06])for(const steer of [-.6,-.45,-.3,-.15,0,.15,.3,.45,.6])for(const spin of [0,.049,.11,.173]){
  body.rotation.set(pitch,0,roll);
  for(const name of ['wheel_fl','wheel_fr']){
   const wheel=car.getObjectByName(name);wheel.rotation.x=spin;wheel.rotation.y=steer;car.updateMatrixWorld(true);inverse.copy(cabin.matrixWorld).invert();
   for(const mesh of wheel.children){matrix.multiplyMatrices(inverse,mesh.matrixWorld);for(const triangle of triangles(mesh,matrix)){
    const hit=intersection(triangle,bvh);
    assert.equal(hit,null,JSON.stringify({kind,name,pitch,roll,steer,spin,hit}));
   }}
   poses++;
  }
 }
 assert.equal(poses,648);
});

for(const kind of ['sedan','hatch','suv','van'])test(`${kind}: actual bump-stopped body and closed cabin clear all four tires and rims`,()=>{
 const car=createTrafficCar(kind),body=car.userData.bodyRig;
 car.updateMatrixWorld(true);
 const fixed=[];
 for(const name of ['body','trim','cabin_interior']){
  const mesh=car.getObjectByName(name);
  assert.equal(mesh.parent,body,'Collision geometry must use the actual sprung hierarchy');
  fixed.push(...triangles(mesh,mesh.matrix));
 }
 const bvh=tree(fixed),inverse=new T.Matrix4(),matrix=new T.Matrix4();let poses=0;
 for(const pitch of [-.05,0,.05])for(const roll of [-.06,0,.06])for(const steer of [-.6,-.45,-.3,-.15,0,.15,.3,.45,.6])for(const spin of [0,.049,.11,.173]){
  const motion={pitch,roll,pitchVelocity:0,rollVelocity:0};
  limitTrafficSuspension(motion,car.userData.suspensionWheels,body.position,trafficDefinition(kind).bodyCompression);
  body.rotation.set(motion.pitch,0,motion.roll);
  for(const name of ['wheel_fl','wheel_fr','wheel_rl','wheel_rr']){
   const wheel=car.getObjectByName(name);wheel.rotation.x=spin;wheel.rotation.y=name.includes('_f')?steer:0;
   car.updateMatrixWorld(true);inverse.copy(body.matrixWorld).invert();
   for(const mesh of wheel.children){matrix.multiplyMatrices(inverse,mesh.matrixWorld);for(const triangle of triangles(mesh,matrix)){
    const hit=intersection(triangle,bvh);
    assert.equal(hit,null,JSON.stringify({kind,name,requestedPitch:pitch,requestedRoll:roll,pitch:motion.pitch,roll:motion.roll,steer,spin,hit}));
   }}
   poses++;
  }
 }
 assert.equal(poses,1296);
});
