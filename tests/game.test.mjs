import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {CONFIG} from '../src/config.js';
import {seededRandom} from '../src/util.js';
import {playerTrafficDepth} from '../src/traffic-physics.js';
const make=(options={})=>{const g=new Game({random:seededRandom(42),...options});g.start();g.state.traffic=[];g.state.pickups=[];g.state.nextSpawn=Infinity;g.state.nextEvent=Infinity;return g;};
function advance(g,seconds,controls={throttle:1}){for(let t=0;t<seconds-1e-8;t+=1/60)g.update(Math.min(1/60,seconds-t),controls);}

test('start leaves the car stationary until gas is held',()=>{
  const g=new Game();g.update(.1,{throttle:1});assert.equal(g.state.distance,0);g.start();advance(g,2,{});assert.equal(g.state.speed,0);assert.equal(g.state.distance,0);assert.equal(g.state.score,0);
});
test('initial traffic has three waves and moves away from a parked player',()=>{
  const g=new Game({random:seededRandom(42)});g.start();assert.equal(g.state.traffic.length,6);
  for(let i=0;i<6;i+=2){assert.equal(new Set(g.state.traffic.slice(i,i+2).map(c=>c.lane)).size,2);assert.ok(g.state.traffic[i].z>=85);}
  const z=g.state.traffic[0].z;g.update(.1);assert.ok(g.state.traffic[0].z>z);g.start();assert.equal(g.state.traffic.length,6);
});
test('gas accelerates, release coasts, brake wins over gas and stops without reverse',()=>{
  const g=make();advance(g,4);assert.ok(g.state.speed>25&&g.state.speed<32);
  const fast=g.state.speed;advance(g,1,{});assert.ok(g.state.speed<fast&&g.state.speed>0);
  advance(g,3,{throttle:1,brake:1,boost:true});assert.equal(g.state.speed,0);assert.equal(g.state.boosting,false);
  const distance=g.state.distance;advance(g,2,{brake:1});assert.equal(g.state.distance,distance);
});
test('continuous steering ramps wheel angle, never selects a lane and holds an intermediate position',()=>{
  const g=make();g.state.speed=25;g.update(1/60,{throttle:1,steer:-1});
  assert.ok(g.state.x>.99);assert.ok(Math.abs(g.state.steerAngle)<.03);
  advance(g,.45,{throttle:1,steer:-1});assert.ok(g.state.x<.9&&g.state.x>.5);
  advance(g,2,{throttle:1});const x=g.state.x;assert.ok(Math.abs(x-Math.round(x))>.03);
  advance(g,.4,{throttle:1});assert.ok(Math.abs(g.state.x-x)<.005);
});
test('steering at rest turns wheels but cannot move or teleport the car',()=>{
  const g=make();advance(g,1,{steer:1});assert.equal(g.state.x,1);assert.equal(g.state.distance,0);assert.ok(g.state.steerAngle>.29);
  assert.equal(g.steer(NaN),false);g.steer(-1);assert.equal(g.state.x,1);g.releaseControls();g.update(.1,{});assert.equal(g.state.x,1);
});
test('road edges bound lateral motion and direction changes have inertia',()=>{
  const g=make();g.state.speed=35;advance(g,3,{throttle:1,steer:1});assert.ok(g.state.x<=2.24);
  const angle=g.state.steerAngle;g.update(.01,{throttle:1,steer:-1});assert.ok(g.state.steerAngle>0&&g.state.steerAngle<angle);
  advance(g,6,{throttle:1,steer:-1});assert.ok(g.state.x>=-.24);assert.ok(Number.isFinite(g.state.heading));
});
test('physics agrees across 60 and 120 Hz and ignores invalid deltas and controls',()=>{
  const a=make(),b=make();for(let i=0;i<120;i++)a.update(1/60,{throttle:1,steer:.2});for(let i=0;i<240;i++)b.update(1/120,{throttle:1,steer:.2});
  assert.ok(Math.abs(a.state.distance-b.state.distance)<.001);assert.ok(Math.abs(a.state.x-b.state.x)<.001);
  const g=make();for(const dt of [0,NaN,Infinity,-1])g.update(dt,{throttle:1});assert.equal(g.state.distance,0);
  g.update(.1,{throttle:Infinity,steer:NaN,brake:NaN});assert.equal(g.state.distance,0);
  g.update(100,{throttle:1});assert.ok(g.state.distance<.1);
});
test('reset clears control, event and run state and validates difficulty',()=>{
  const g=make();g.startEvent();g.steer(1);g.state.revives=1;g.reset('rush');assert.equal(g.state.phase,'ready');assert.equal(g.state.roadEvent,null);assert.deepEqual(g.state.obstacles,[]);assert.equal(g.state.revives,0);assert.equal(g.state.speed,0);
  g.reset('toString');assert.equal(g.difficulty,'flow');
});
test('swept collision catches fast traffic crossing and stops simulation after a crash',()=>{
  const events=[],g=make({onEvent:e=>events.push(e)});g.state.speed=100;g.state.traffic=[{lane:1,z:8,speed:8}];g.update(.1);
  assert.equal(g.state.phase,'crashed');assert.deepEqual(events,['crash']);const d=g.state.distance;g.update(.1,{throttle:1});assert.equal(g.state.distance,d);assert.equal(g.steer(1),false);
});
test('matching traffic speed does not pull cars backwards toward the player',()=>{
  const g=make();g.state.speed=20;g.state.traffic=[{lane:1,z:30,speed:20}];g.update(.01,{throttle:.16});assert.ok(Math.abs(g.state.traffic[0].z-30)<.001);
});
test('following traffic brakes behind a parked player rather than rear-ending them',()=>{
  const g=make();g.state.traffic=[{id:1,lane:1,z:-8,speed:22,cruiseSpeed:22}];advance(g,2,{});
  assert.equal(g.state.phase,'playing');assert.ok(g.state.traffic[0].z<=-(CONFIG.collisionDepth+2));assert.ok(g.state.traffic[0].speed<1);assert.equal(g.state.distance,0);
});
test('close passes reward once, cap the combo, and the series expires',()=>{
  const g=make();g.state.speed=30;g.state.traffic=[{lane:0,z:3.5,speed:8}];advance(g,.5);assert.equal(g.state.nearMisses,1);assert.equal(g.state.combo,2);advance(g,1);assert.equal(g.state.nearMisses,1);
  for(let i=0;i<8;i++){g.state.traffic.push({lane:0,z:-playerTrafficDepth({kind:'sedan'})+.1,speed:8});g.update(.02,{throttle:1});}assert.equal(g.state.combo,5);advance(g,5);assert.equal(g.state.combo,1);
});
test('nitro needs moving gas, boosts acceleration, respects braking and cannot go negative',()=>{
  const g=make(),normal=make();advance(g,1,{boost:true});assert.equal(g.state.nitro,60);
  g.state.speed=normal.state.speed=20;advance(g,2,{throttle:1,boost:true});advance(normal,2);assert.ok(g.state.speed>normal.state.speed);assert.ok(g.state.nitro<11);
  advance(g,2,{throttle:1,boost:true});assert.equal(g.state.nitro,0);g.update(.1,{throttle:1,boost:true});assert.equal(g.state.boosting,false);
  g.state.nitro=60;g.update(.1,{throttle:1,brake:1,boost:true});assert.equal(g.state.nitro,60);assert.equal(g.state.boosting,false);
});
test('pickups give one capped reward only in the player path',()=>{
  const g=make();g.state.speed=20;g.state.nitro=95;g.state.pickups=[{lane:1,z:2.1},{lane:0,z:2.1}];g.update(.1);assert.equal(g.state.charges,1);assert.equal(g.state.nitro,100);g.update(.1);assert.equal(g.state.charges,1);assert.ok(g.state.score>=50);
});
test('revive clears nearby hazards and event without a free completion, and waits for gas',()=>{
  const g=make();assert.equal(g.revive(),false);g.startEvent('roadworks');g.state.phase='crashed';g.state.traffic=[{lane:1,z:0},{lane:2,z:100,speed:18}];g.state.distance=560;g.state.score=800;
  assert.equal(g.revive(),true);assert.equal(g.state.traffic.length,1);assert.equal(g.state.speed,0);assert.equal(g.state.roadEvent,null);assert.equal(g.state.eventsCompleted,0);assert.equal(g.state.score,800);assert.equal(g.state.distance,560);assert.equal(g.state.obstacles.length,0);
  g.state.traffic.push({lane:1,z:0,speed:18});g.update(.05);assert.equal(g.state.phase,'playing');g.state.phase='crashed';assert.equal(g.revive(),false);
});
test('distance goal rewards once and speed respects each difficulty limit',()=>{
  const g=make();g.state.speed=20;g.state.distance=CONFIG.goal-.1;g.update(.05);assert.equal(g.state.goalReached,true);assert.ok(g.state.score>1000);
  const normal=make(),rush=make();rush.reset('rush');rush.start();rush.state.traffic=[];rush.state.pickups=[];rush.state.nextSpawn=rush.state.nextEvent=Infinity;
  advance(normal,20);advance(rush,20);assert.ok(normal.state.speed<=CONFIG.maxSpeed);assert.ok(rush.state.speed>normal.state.speed);assert.ok(rush.state.score>normal.state.score);
});
test('seeded traffic keeps a reachable gap and avoids a closed roadworks lane',()=>{
  const a=make(),b=make();for(let i=0;i<1000;i++){a.state.distance=b.state.distance=500+i*68;a.state.traffic=[];b.state.traffic=[];a.state.pickups=[];b.state.pickups=[];const before=a.state.safeLane;a.spawnWave();b.spawnWave();assert.ok(Math.abs(a.state.safeLane-before)<=1);assert.ok(a.state.traffic.every(c=>c.lane!==a.state.safeLane));assert.deepEqual(a.state.traffic,b.state.traffic);}
  a.startEvent('roadworks');for(let i=0;i<20;i++){a.state.traffic=[];a.spawnWave();assert.ok(a.state.traffic.every(c=>c.lane!==a.state.roadEvent.lane));assert.notEqual(a.state.safeLane,a.state.roadEvent.lane);}
});
test('events begin from travelled distance and roadworks create a warned lane closure',()=>{
  const g=make();assert.equal(g.startEvent('toString'),false);g.state.nextEvent=80;advance(g,60,{});assert.equal(g.state.roadEvent,null);
  g.state.distance=80;g.update(.01);const e=g.state.roadEvent;assert.equal(e.type,'roadworks');assert.ok(e.remaining>=149);assert.equal(g.state.obstacles.filter(o=>o.kind==='barrier').length,2);assert.equal(g.state.obstacles.filter(o=>o.kind==='cone').length,8);assert.ok([0,2].includes(e.lane));assert.equal(g.startEvent('checkpoint'),false);
  const z=g.state.obstacles[0].z;g.update(.1,{});assert.equal(g.state.obstacles[0].z,z);
});
test('roadworks barriers collide and cones slow the car and penalize only once',()=>{
  const g=make();g.startEvent('roadworks');g.state.x=1;g.state.speed=20;g.state.score=200;g.state.obstacles=[{id:1,kind:'cone',x:1,z:3}];g.update(.1);assert.ok(g.state.speed<17);assert.ok(g.state.score<200);assert.equal(g.state.roadEvent.clean,false);assert.equal(g.state.obstacles.length,0);
  const h=make();h.state.speed=25;h.state.obstacles=[{id:2,kind:'barrier',x:1,z:3.1}];h.update(.1);assert.equal(h.state.phase,'crashed');
});
test('clean roadworks give one completion bonus, damaged runs do not',()=>{
  for(const clean of [true,false]){const g=make();g.startEvent('roadworks');g.state.roadEvent.clean=clean;g.state.distance=g.state.roadEvent.end+.1;g.update(.01);assert.equal(g.state.eventsCompleted,Number(clean));assert.equal(g.state.score,clean?300:0);assert.equal(g.state.nitro,clean?75:60);const score=g.state.score;g.update(.1);assert.equal(g.state.score,score);}
});
test('checkpoint needs correct position and time, and awards once',()=>{
  for(const mode of ['hit','miss','late']){const g=make();g.startEvent('checkpoint');const e=g.state.roadEvent;g.state.x=mode==='miss'?(e.lane+1)%3:e.lane;g.state.distance=e.at-.1;g.state.speed=20;if(mode==='late')g.state.elapsed=e.deadline+1;g.update(.1);assert.equal(g.state.roadEvent,null);assert.equal(g.state.eventsCompleted,Number(mode==='hit'));assert.equal(g.state.lastEvent.success,mode==='hit');}
});
test('vehicle flanks hit hazards and checkpoints require fitting between the flag posts',()=>{
  for(const [kind,offset]of [['cone',.3],['barrier',.69]]){
    const g=make();g.state.speed=20;g.state.x=1+offset;g.state.obstacles=[{id:1,kind,x:1,z:3}];g.update(.1);
    if(kind==='barrier')assert.equal(g.state.phase,'crashed');else assert.ok(g.state.speed<17);
  }
  for(const [offset,success]of [[.25,true],[.29,false]]){
    const g=make();g.startEvent('checkpoint');const e=g.state.roadEvent;g.state.x=e.lane+(e.lane===2?-offset:offset);g.state.distance=e.at-.1;g.state.speed=20;g.update(.1);assert.equal(g.state.lastEvent.success,success);
  }
});
test('convoy actually brakes, signals, and rewards only after all cars were passed',()=>{
  const g=make();g.state.traffic=[{id:999,lane:0,z:150,speed:18}];g.startEvent('convoy');const e=g.state.roadEvent;assert.equal(e.targets.length,4);assert.ok(g.state.traffic.some(c=>c.id===999));assert.ok(g.state.traffic.filter(c=>c.eventId===e.id).every(c=>c.z>=240));g.state.distance=e.at-100;g.update(.1);const cars=g.state.traffic.filter(c=>c.eventId===e.id);assert.ok(cars.every(c=>c.braking&&c.speed<19&&c.speed>6));assert.equal(g.state.eventsCompleted,0);
  for(const c of cars){c.passed=true;c.z=-5;}g.update(.01);assert.equal(g.state.eventsCompleted,1);assert.equal(g.state.score,400);
});
test('convoy timeout fails cleanly and event types rotate in order',()=>{
  const g=make();for(const type of ['roadworks','checkpoint','convoy','roadworks']){g.startEvent();assert.equal(g.state.roadEvent.type,type);if(type==='convoy'){g.state.elapsed=g.state.roadEvent.deadline+1;g.update(.01);assert.equal(g.state.lastEvent.success,false);}else g.finishEvent(false);}assert.equal(g.state.eventsCompleted,0);
});
