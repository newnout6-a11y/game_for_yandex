import test from 'node:test';import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';import*as T from '../public/vendor/three.js';
import{TRAFFIC_KINDS,installTrafficTemplates,createTrafficCar,animateTrafficCar}from'../src/traffic.js';
import{trafficDefinition}from'../src/traffic-catalog.js';import{trafficPose,trafficCollisionParts,trafficHitch,trailerYaw,updateTrailerKinematics}from'../src/traffic-physics.js';
const models={};for(const k of TRAFFIC_KINDS){const b=await readFile(`public/assets/traffic/${k}.glb`);models[k]=(await new T.GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}installTrafficTemplates(models);
const sample=(kind,angle,side=1)=>{const s=trafficDefinition(kind),R=12;return{kind,lane:1,x:1+side*R*(1-Math.cos(angle))/3.5,z:s.rearAxleZ+R*Math.sin(angle),heading:side*angle,speed:5,travelDistance:R*angle,laneCurvature:side/R,lateralAcceleration:side*25/R,acceleration:0};};
function place(car,item){const pose=trafficPose(item,-385);car.position.set(pose.x,car.userData.groundY,pose.z);car.rotation.y=pose.yaw;animateTrafficCar(car,item,-385,1/120);car.updateMatrixWorld(true);return pose;}
test('catalog rear-axle datum is measured from each actual Blender wheel hierarchy',()=>{
 for(const k of TRAFFIC_KINDS){const c=createTrafficCar(k),w=c.userData.wheelRest.filter(w=>!w.front&&!w.wheel.name.includes('trailer'));
 assert.ok(Math.abs(w.reduce((s,w)=>s+w.center.z,0)/w.length-trafficDefinition(k).rearAxleZ)<1e-5,k);}
});
test('both turn directions steer visible wheel planes along their actual front-axle paths',()=>{
 for(const k of TRAFFIC_KINDS)for(const side of [-1,1]){const c=createTrafficCar(k),d=1e-4,angle=.4;
  const a=sample(k,angle-d,side),b=sample(k,angle+d,side);place(c,a);const before=c.userData.wheelRest.filter(w=>w.front).map(w=>w.wheel.getWorldPosition(new T.Vector3()));place(c,b);const after=c.userData.wheelRest.filter(w=>w.front).map(w=>w.wheel.getWorldPosition(new T.Vector3()));place(c,sample(k,angle,side));
  c.userData.wheelRest.filter(w=>w.front).forEach((w,i)=>{const velocity=after[i].clone().sub(before[i]).normalize(),axis=new T.Vector3(1,0,0).applyQuaternion(w.wheel.getWorldQuaternion(new T.Quaternion())),forward=new T.Vector3(axis.z,0,-axis.x).normalize();assert.ok(forward.dot(velocity)>.999999,k+' wheel plane must follow path, not just spin');assert.ok(Math.abs(w.wheel.rotation.y)>.15,k+' low-speed turn visibly steers');});
 }
});
test('rear contact reference has no lateral skating; collision and renderer share body pose',()=>{
 for(const k of TRAFFIC_KINDS)for(const side of[-1,1]){const spec=trafficDefinition(k),angle=.4,d=1e-5;
  const point=a=>{const p=trafficPose(sample(k,a,side),-385);return{x:p.x+Math.sin(p.yaw)*spec.rearAxleZ,z:p.z+Math.cos(p.yaw)*spec.rearAxleZ};};
  const a=point(angle-d),b=point(angle+d),pose=trafficPose(sample(k,angle,side),-385);assert.ok(Math.abs((b.x-a.x)*Math.cos(pose.yaw)-(b.z-a.z)*Math.sin(pose.yaw))<1e-10,k);
  if(k!=='semi'){const p=trafficCollisionParts(sample(k,angle,side),-385)[0];assert.equal(p.x,pose.x);assert.equal(p.z,pose.z);}
 }
});
test('inside and outside tyres accumulate different arc distance without spin jumps at changing steer',()=>{
 const c=createTrafficCar('sedan');for(let i=0;i<=120;i++)place(c,sample('sedan',i/240,1));
 const left=c.userData.wheelRest.find(w=>w.wheel.name==='wheel_fl'),right=c.userData.wheelRest.find(w=>w.wheel.name==='wheel_fr');assert.ok(left.spinDistance>right.spinDistance+.5);
 const old=left.spinDistance;const item=sample('sedan',.5,1);item.laneCurvature=-1/12;place(c,item);assert.equal(left.spinDistance,old,'steering in place must not advance or rewind wheel distance');
});
test('semi collider includes the real front overhang and articulation guard covers the tested envelope',()=>{
 const s=trafficDefinition('semi'),car={kind:'semi',lane:1,z:50,speed:1,trailerAngle:.7};const h=trafficHitch(car,-385),p=trafficCollisionParts(car,-385)[1],yaw=trafficPose(car,-385).yaw+trailerYaw(car,-385);
 const front={x:p.x-Math.sin(yaw)*p.halfLength,z:p.z-Math.cos(yaw)*p.halfLength};assert.ok(Math.abs(Math.hypot(front.x-h.x,front.z-h.z)-(s.hitchZ-s.trailerFrontZ))<1e-8,'nose ahead of kingpin must be collidable');
 updateTrailerKinematics(car,-385,1/120);car.heading=2;updateTrailerKinematics(car,-385,1/120);assert.ok(Math.abs(car.trailerAngle)<=s.maxArticulation+1e-10);
});
