import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { Game } from '../src/game.js';
import { TRAFFIC_KINDS,installTrafficTemplates,createTrafficCar,animateTrafficCar,resetTrafficMotion } from '../src/traffic.js';
import { createTrafficMotion,updateTrafficMotion,steeringForWheel,trafficDynamics,suspensionCompression,limitTrafficSuspension } from '../src/traffic-motion.js';
import { trailerYaw,trafficCollisionParts } from '../src/traffic-physics.js';
const models={};for(const kind of TRAFFIC_KINDS){const b=await readFile(`public/assets/traffic/${kind}.glb`);models[kind]=(await new T.GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}installTrafficTemplates(models);
/**
 * Start a game with traffic removed and automatic waves/events disabled.
 * Other starting state, including pickups, is left intact for motion regressions.
 * @returns {Game} Mutable fixture using production motion updates.
 */
const make=()=>{const g=new Game();g.start();Object.assign(g.state,{traffic:[],nextSpawn:Infinity,nextEvent:Infinity});return g;};
test('wheel distance integrates actual movement and braking never rewinds accumulated spin',()=>{
 const g=make(),car={id:1,kind:'sedan',lane:0,z:50,speed:20,cruiseSpeed:20};g.state.traffic=[car];let previous=0;
 for(let i=0;i<240;i++){if(i===120)car.eventBraking=true;g.update(1/120);assert.ok(car.travelDistance>=previous);previous=car.travelDistance;}
 assert.ok(car.speed<20);assert.ok(car.acceleration<0);assert.ok(car.travelDistance>32&&car.travelDistance<40);assert.ok(Math.abs(car.travelDistance-(car.z-50))<1e-8);
 const distance=car.travelDistance;g.state.phase='paused';g.update(1);assert.equal(car.travelDistance,distance);
});
test('category response is distinct and steering uses inner/outer wheel geometry',()=>{
 assert.ok(trafficDynamics('semi').acceleration<trafficDynamics('hatch').acceleration);
 assert.ok(trafficDynamics('van').frequency<trafficDynamics('sedan').frequency);
 assert.ok(Math.abs(steeringForWheel(.03,3,1))>Math.abs(steeringForWheel(.03,3,-1)));
 assert.equal(steeringForWheel(0,3,1),-0);
});
test('suspension responds to load, settles without idle oscillation and is time-step stable',()=>{
 const a=createTrafficMotion(),b=createTrafficMotion(),item={kind:'van',speed:0,z:30,acceleration:-4};
 for(let i=0;i<120;i++)updateTrafficMotion(a,item,0,3,1/120);
 for(let i=0;i<30;i++)updateTrafficMotion(b,item,0,3,1/30);
 assert.ok(a.pitch<-.01);assert.ok(Math.abs(a.pitch-b.pitch)<1e-12);assert.equal(a.roll,0);
 item.acceleration=0;for(let i=0;i<600;i++)updateTrafficMotion(a,item,0,3,1/120);
 assert.ok(Math.abs(a.pitch)<1e-9);assert.equal(a.roll,0);
});
test('all eight GLB wheel contacts stay grounded while their body suspension moves',()=>{
 for(const kind of TRAFFIC_KINDS){
  const car=createTrafficCar(kind),data=car.userData;car.position.y=data.groundY;car.updateMatrixWorld(true);
  const before=data.wheels.map(w=>w.getWorldPosition(new T.Vector3()));
  for(let i=0;i<60;i++)animateTrafficCar(car,{kind,speed:26,z:20,acceleration:-4,travelDistance:5},800,1/60);
  car.updateMatrixWorld(true);assert.ok(data.bodyRig.rotation.x<0,kind);
  for(let i=0;i<data.wheelRest.length;i++){
   const w=data.wheelRest[i],p=w.wheel.getWorldPosition(new T.Vector3());assert.ok(p.distanceTo(before[i])<1e-9,kind+' grounded pivot');
   assert.ok(Math.abs(p.y-w.radius-.01)<.012,kind+' tyre datum');
   assert.ok(Number.isFinite(w.wheel.rotation.x));
  }
  resetTrafficMotion(car);assert.equal(data.motion.distance,0);assert.equal(data.bodyRig.rotation.x,0);
 }
});
test('semi articulation used by visual and collision state is continuous and stops with vehicle',()=>{
 const g=make(),car={id:1,kind:'semi',lane:0,z:65,speed:14,cruiseSpeed:14};g.state.traffic=[car];g.update(.01);let angle=car.trailerAngle;
 for(let i=0;i<60;i++){g.update(1/60);assert.ok(Math.abs(car.trailerAngle-angle)<.005);angle=car.trailerAngle;assert.equal(trailerYaw(car,g.state.distance),angle);assert.equal(trafficCollisionParts(car,g.state.distance).length,2);}
 car.speed=0;car.cruiseSpeed=0;g.update(.05);assert.equal(car.trailerAngle,angle);
});

test('cab glazing stays clear without opaque shadows and indicators are isolated per instance',()=>{
 for(const kind of TRAFFIC_KINDS){
  const a=createTrafficCar(kind),b=createTrafficCar(kind);let glass=0,mirrors=0,cabins=0;
  a.traverse(n=>{if(!n.isMesh)return;const m=n.material,name=m.name;
   if(/glass/i.test(name)&&!/mirror/i.test(name)){glass++;assert.equal(m.transparent,true);assert.equal(m.depthWrite,false);assert.equal(m.forceSinglePass,true);assert.equal(n.castShadow,false);assert.ok(m.opacity<=.25);assert.equal(m.transmission||0,0);}
   if(/mirror_(reflective|reflector|surface)/.test(name)){mirrors++;assert.ok(m.metalness>.9);assert.ok(m.roughness<=.12);}
   if(/cabin_interior|special_cabin_finish/.test(name)){cabins++;assert.equal(m.vertexColors,true);}
  });
  assert.ok(glass&&mirrors&&cabins,kind+' cabin material contract');
  animateTrafficCar(a,{kind,speed:15,z:20,signal:-1,signalTime:.3},0,1/60);
  assert.ok(a.userData.indicators.indicator_left.emissiveIntensity>3,kind);
  assert.ok(a.userData.indicators.indicator_right.emissiveIntensity<.1,kind);
  assert.notEqual(a.userData.indicators.indicator_left,b.userData.indicators.indicator_left);
  animateTrafficCar(a,{kind,speed:15,z:20,signal:-1,signalTime:.7},0,1/60);
  assert.ok(a.userData.indicators.indicator_left.emissiveIntensity<.1,kind+' blink');
 }
});

test('planned lane changes drive heading, steering, load transfer and continuous path distance together',()=>{
 const g=make();Object.assign(g.state,{distance:700,speed:18,x:2,lane:2,safeLane:2,traffic:[
 {id:901,kind:'sedan',lane:1,z:34,speed:22,cruiseSpeed:25,laneChangeCooldown:1,laneDecisionIn:0},
 {id:902,kind:'boxtruck',lane:1,z:61,speed:15,cruiseSpeed:15},
 {id:903,kind:'semi',lane:1,z:300,speed:20,cruiseSpeed:23,laneChangeCooldown:4,laneDecisionIn:0},
 {id:904,kind:'firetruck',lane:1,z:340,speed:13,cruiseSpeed:13}]});
 const visual=createTrafficCar('sedan');let moving=0,maxRoll=0,previous=0,trailerMax=0;
 for(let i=0;i<1680;i++){
  g.update(1/120,{throttle:i<180?1:0});assert.equal(g.state.phase,'playing');
  const t=g.state.traffic.find(c=>c.id===901),semi=g.state.traffic.find(c=>c.id===903);
  assert.ok(t.travelDistance>=previous);previous=t.travelDistance;
  animateTrafficCar(visual,t,g.state.distance,1/120);
  maxRoll=Math.max(maxRoll,Math.abs(visual.userData.motion.roll));trailerMax=Math.max(trailerMax,Math.abs(semi.trailerAngle));
  if(t.laneChange?.phase==='moving'){moving++;assert.ok(t.x>=0&&t.x<=1);assert.ok(t.lateralSpeed<=0);assert.ok(t.heading<=0);assert.equal(t.signal,-1);}
 }
 assert.ok(moving>350);assert.ok(maxRoll>.006&&maxRoll<.06);assert.ok(trailerMax>.01&&trailerMax<=.12);
 assert.equal(g.state.traffic.find(c=>c.id===901).x,0);assert.equal(g.state.traffic.find(c=>c.id===903).x,0);
});

test('new waves cannot designate a committed lane-change corridor as the safe lane',()=>{
 const g=make();/** Force the lowest random choice to verify safe-lane reservation overrides the spawn preference. */ g.random=()=>0;Object.assign(g.state,{safeLane:1,distance:400,traffic:[{id:1,kind:'sedan',lane:1,x:.7,z:6.4,speed:20,heading:-.05,laneChange:{from:1,to:0,phase:'moving',elapsed:1,duration:3.4,signalDuration:.85}}]});
 g.spawnWave(205,true);assert.equal(g.state.safeLane,2);
 assert.ok(g.state.traffic.filter(c=>c.id!==1).every(c=>c.lane!==2));
});

test('following gap remains protected when the leader moves backward relative to the player',()=>{
 const g=make();Object.assign(g.state,{speed:30,x:2,lane:2,safeLane:2,traffic:[
 {id:36,kind:'boxtruck',lane:0,z:40,speed:10,cruiseSpeed:10},
 {id:39,kind:'van',lane:0,z:40-8.3167,speed:11,cruiseSpeed:20,eventId:9}]});
 for(let i=0;i<240;i++){
  g.update(1/120,{throttle:.3});const a=g.state.traffic.find(c=>c.id===36),b=g.state.traffic.find(c=>c.id===39);
  assert.ok(a.z-b.z>=8.31-1e-8);
 }
});

test('roadworks never materialize across a committed manoeuvre and defer when both edges are occupied',()=>{
 const g=make();/** Prefer the first roadworks edge so committed-corridor exclusion and deferral are deterministic. */ g.random=()=>0;g.state.traffic=[{id:1,kind:'sedan',lane:1,x:.8,z:150,speed:22,heading:-.05,laneChange:{from:1,to:0,phase:'moving',elapsed:.5,duration:3.4,signalDuration:.85}}];
 assert.equal(g.startEvent('roadworks'),true);assert.equal(g.state.roadEvent.lane,2);
 g.state.roadEvent=null;g.state.traffic.push({id:2,kind:'suv',lane:1,x:1.2,z:180,speed:20,heading:.05,laneChange:{from:1,to:2,phase:'moving',elapsed:.5,duration:3.4,signalDuration:.85}});
 const index=g.state.eventIndex;assert.equal(g.startEvent('roadworks'),false);assert.equal(g.state.eventIndex,index);
});

test('a new convoy preserves the free edge around committed overtaking traffic',()=>{
 const g=make();/** Force the high random choice while checking convoy generation preserves the remaining safe edge. */ g.random=()=>.99;Object.assign(g.state,{x:2,lane:2,safeLane:2,traffic:[{id:1,kind:'sedan',lane:1,x:.8,z:37,speed:22,heading:-.05,laneChange:{from:1,to:0,phase:'moving',elapsed:.5,duration:3.4,signalDuration:.85}}]});
 assert.equal(g.startEvent('convoy'),true);assert.equal(g.state.safeLane,2);
 assert.ok(g.state.traffic.filter(c=>c.eventId).every(c=>c.lane!==2));
});

test('measured passenger bump stops bound combined compression without reducing steering',()=>{
 for(const kind of ['sedan','hatch','suv','van']){const car=createTrafficCar(kind),d=car.userData,limit={sedan:.025,hatch:.024,suv:.031,van:.030}[kind];
  for(const pitch of [-.06,0,.06])for(const roll of [-.07,0,.07]){Object.assign(d.motion,{pitch,roll,pitchVelocity:Math.sign(pitch),rollVelocity:Math.sign(roll)});limitTrafficSuspension(d.motion,d.suspensionWheels,d.bodyRig.position,limit);
   assert.ok(suspensionCompression(d.motion.pitch,d.motion.roll,d.suspensionWheels,d.bodyRig.position)<=limit+1e-10,kind+' combined stop');
  }
  for(let i=0;i<120;i++)animateTrafficCar(car,{kind,speed:15,z:20,laneCurvature:1/12,acceleration:-6,travelDistance:i*.125},-385,1/120);
  assert.ok(suspensionCompression(d.motion.pitch,d.motion.roll,d.suspensionWheels,d.bodyRig.position)<=limit+1e-10);
  assert.ok(Math.abs(car.getObjectByName('wheel_fr').rotation.y)>.2,'steering is not reduced to hide collision');
 }
});
