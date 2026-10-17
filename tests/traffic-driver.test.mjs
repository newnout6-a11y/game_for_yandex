import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { TRAFFIC_KINDS, installTrafficTemplates, createTrafficCar, animateTrafficCar } from '../src/traffic.js';
import { animateTrafficDriver, stalkGesture, INDICATOR_TOUCH_TIME } from '../src/traffic-driver.js';
const models={};
for(const kind of TRAFFIC_KINDS){const b=await readFile(`public/assets/traffic/${kind}.glb`);models[kind]=(await new T.GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
installTrafficTemplates(models);
const p=()=>new T.Vector3();
test('all eight Blender driver rigs retain nested arms and moving steering under the sprung body',()=>{
 for(const kind of TRAFFIC_KINDS){const car=createTrafficCar(kind),r=car.userData.driver;assert.ok(r,kind);assert.equal(r.wheel.parent,r.body);
  for(const a of r.arms){assert.equal(a.shoulder.parent,r.body);assert.equal(a.elbow.parent,a.shoulder);assert.equal(a.hand.parent,a.elbow);assert.equal(a.grip.parent,r.wheel);a.shoulder.traverse(n=>{if(n.isMesh)assert.equal(n.castShadow,false);});}
 }
});
test('hands stay on wheel grips throughout steering, body roll and world transforms',()=>{
 for(const kind of TRAFFIC_KINDS){const car=createTrafficCar(kind),r=car.userData.driver;car.position.set(3,.03,-25);car.rotation.y=.4;r.body.rotation.set(-.025,0,.035);
  const ratio=car.userData.category==='passenger'?14:18;
  for(const angle of [-1.2,-.6,0,.6,1.2]){animateTrafficDriver(car,{signal:0},angle/ratio);assert.ok(r.maxGripError<1e-4,kind+' reachable '+angle);
   for(const a of r.arms)assert.ok(a.hand.getWorldPosition(p()).distanceTo(a.grip.getWorldPosition(p()))<1e-4,kind+' '+a.side+' grip '+angle);
  }
 }
});
test('left hand taps the stalk before the lamps blink, then returns without moving the right grip',()=>{
 assert.equal(stalkGesture(-1,0),0);assert.equal(stalkGesture(-1,INDICATOR_TOUCH_TIME),1);assert.equal(stalkGesture(-1,.75),0);
 for(const kind of TRAFFIC_KINDS){const car=createTrafficCar(kind),r=car.userData.driver;
  for(const time of [0,.09,.18,.3,.55,.75,2]){const item={kind,speed:12,z:20,signal:-1,signalTime:time,laneCurvature:0,travelDistance:0};animateTrafficCar(car,item,-385,1/120);
   const left=r.arms[0],right=r.arms[1],expected=left.grip.getWorldPosition(p()).lerp(r.stalk.getWorldPosition(p()),stalkGesture(-1,time));
   assert.ok(left.hand.getWorldPosition(p()).distanceTo(expected)<1e-4,kind+' left hand '+time);
   assert.ok(right.hand.getWorldPosition(p()).distanceTo(right.grip.getWorldPosition(p()))<1e-4,kind+' right hand');
   if(time<.18)assert.equal(car.userData.indicators.indicator_left.emissiveIntensity,.02);
   if(time===.3)assert.equal(car.userData.indicators.indicator_left.emissiveIntensity,3.2);
  }
 }
});
test('driver rigs and their transforms are independent between pooled vehicle clones',()=>{
 const a=createTrafficCar('sedan'),b=createTrafficCar('sedan');animateTrafficDriver(a,{signal:-1,signalTime:.25},.04);animateTrafficDriver(b,{signal:0},0);
 assert.notEqual(a.userData.driver.wheel,b.userData.driver.wheel);assert.notEqual(a.userData.driver.wheel.userData.angle,b.userData.driver.wheel.userData.angle);
 assert.ok(b.userData.driver.arms[0].hand.getWorldPosition(p()).distanceTo(b.userData.driver.arms[0].grip.getWorldPosition(p()))<1e-4);
});
