import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {captureContactFrame,resolveVehicleContacts,playerContactHeight,playerContactParts,CONTACT_TUNING} from '../src/vehicle-contacts.js';
import {trafficHitsPlayer} from '../src/traffic-physics.js';
const fixture=()=>{const events=[],game=new Game({onEvent:(e,v)=>events.push([e,v])});game.start();Object.assign(game.state,{traffic:[],pickups:[],obstacles:[],nextSpawn:Infinity,nextEvent:Infinity});return{game,s:game.state,events};};
const advance=(game,time,controls={})=>{for(let t=0;t<time-1e-9;t+=1/120)game.update(Math.min(1/120,time-t),controls);};

test('severe rear contact resolves speed then emits one terminal crash; skid cannot earn progress',()=>{
 const {game,s,events}=fixture();s.speed=45;s.traffic=[{id:1,kind:'sedan',lane:1,z:7,speed:12}];
 for(let i=0;i<120&&s.phase==='playing';i++)game.update(1/120,{throttle:1});
 assert.equal(s.phase,'crashed');assert.ok(s.speed<40);assert.equal(events.filter(e=>e[0]==='crash').length,1);assert.ok(events.some(e=>e[0]==='impact'&&e[1].severe));
 const frozen={distance:s.distance,score:s.score,elapsed:s.elapsed,nitro:s.nitro,overtakes:s.overtakes};const speed=s.speed;advance(game,.8,{throttle:1,boost:true,flight:true,steer:1});
 assert.deepEqual(Object.fromEntries(Object.keys(frozen).map(k=>[k,s[k]])),frozen);assert.ok(s.speed<speed);assert.ok(s.sceneTravel>0);assert.equal(s.impactRemaining,0);assert.equal(events.filter(e=>e[0]==='crash').length,1);
 const pose=[s.x,s.heading,s.sceneTravel];advance(game,.2);assert.deepEqual([s.x,s.heading,s.sceneTravel],pose);
 assert.equal(game.revive(),true);assert.equal(s.lateralVelocity,0);assert.equal(s.forwardVelocity,0);assert.equal(s.yawRate,0);assert.equal(s.impactRemaining,0);assert.ok(s.sceneTravel>0);
});

test('side scrape responds without ending run and momentum survives subsequent control',()=>{
 const {game,s,events}=fixture();Object.assign(s,{speed:30,forwardVelocity:30,lateralVelocity:3,heading:.07});s.traffic=[{id:4,kind:'sedan',lane:2,x:1.63,z:0,speed:30,cruiseSpeed:30}];
 advance(game,.25,{throttle:.25,steer:1});assert.equal(s.phase,'playing');assert.ok(events.some(e=>e[0]==='impact'));assert.ok(!events.some(e=>e[0]==='crash'));assert.ok(s.traffic[0].impactActive);assert.ok(s.traffic[0].lateralVelocity>0);assert.ok(Number.isFinite(s.yawRate));
 const npc=s.traffic[0],x=npc.x;game.update(1/120,{});assert.ok(npc.x>x,'NPC impulse must not be erased by a lane planner');
});

test('damage feedback cooldown never disables physical rail contact',()=>{
 const {s}=fixture();Object.assign(s,{x:1+(CONTACT_TUNING.railInner-1.18-.02)/3.5,speed:25,lateralVelocity:8,heading:0,impactCooldown:99});
 const previous=captureContactFrame(s);s.x+=8/120/3.5;const result=resolveVehicleContacts(s,previous,1/120,25/120);
 assert.ok(result.contacts.some(c=>c.kind==='rail'));assert.ok(s.lateralVelocity<8);assert.ok(playerContactParts(s).every(p=>(s.x-1)*3.5+Math.cos(s.heading)*p.x-Math.sin(s.heading)*p.z+Math.abs(Math.cos(s.heading))*p.halfWidth+Math.abs(Math.sin(s.heading))*p.halfLength<=CONTACT_TUNING.railInner+.002));assert.ok(s.impactCooldown>98);
});

test('initial parked overlap is separated without inventing fatal closing energy',()=>{
 const {game,s,events}=fixture();s.obstacles=[{id:3,kind:'barrier',x:1,z:0}];game.update(1/120,{});assert.equal(s.phase,'playing');assert.ok(!events.some(e=>e[0]==='crash'));assert.ok(Number.isFinite(s.x));assert.equal(s.speed,0);assert.equal(s.distance,0);assert.equal(s.score,0);assert.notEqual(s.sceneTravel,0);
});

test('actual barrier depth .14m and cone base .58m are not lane-wide rectangles',()=>{
 const {game,s,events}=fixture();s.speed=25;s.obstacles=[{id:1,kind:'barrier',x:1,z:4}];advance(game,.1);assert.equal(s.phase,'crashed');assert.equal(events.filter(e=>e[0]==='crash').length,1);
 const clear=fixture();clear.s.speed=25;clear.s.x=1+(1.18+1.35+.03)/3.5;clear.s.obstacles=[{id:1,kind:'barrier',x:1,z:3}];advance(clear.game,.15);assert.equal(clear.s.phase,'playing');assert.ok(!clear.events.some(e=>e[0]==='impact'));
});

test('new collision query rejects the historical asynchronous-overlap false positive',()=>{
 const state={x:.9928925654193589,heading:-.06630136563211411,distance:3070.751689804385,altitude:0,rollAngle:0};
 const car={kind:'sedan',lane:2,x:1.5668571428571427,previousLateral:1.5668571428571427,z:4.7282164796,speed:18};
 assert.equal(trafficHitsPlayer(car,state,1,5.12),false);
});

test('capture preserves configured height and rolled pivot at both endpoints',()=>{
 const {s}=fixture();s.vehicleId='van';s.playerBounds={width:2.18,length:5.62,height:2.58};s.altitude=2;s.rollAngle=Math.PI/2;
 const old=captureContactFrame(s);assert.deepEqual(playerContactHeight(old),playerContactHeight(s));assert.deepEqual(playerContactParts(old),playerContactParts(s));assert.ok(playerContactParts(s)[0].x<-.7);
});

test('no-contact straight driving and rewards stay partition-independent with 30/60/120Hz',()=>{
 const results=[];for(const hz of [30,60,120]){const {game,s}=fixture();s.speed=35;for(let i=0;i<hz*3;i++)game.update(1/hz,{throttle:1,steer:i<hz*.3?.4:0});results.push(s);}
 for(const s of results.slice(1))for(const k of ['x','distance','score','speed','heading','lateralVelocity'])assert.ok(Math.abs(s[k]-results[0][k])<1e-7,k);
});

test('a contacted traffic vehicle cannot later award a near miss',()=>{
 const {game,s,events}=fixture();Object.assign(s,{distance:1100*(Math.PI-.35),x:1.55,speed:25,lateralVelocity:-1});s.traffic=[{id:1,kind:'sedan',lane:1,x:1,z:0,speed:18,cruiseSpeed:18}];
 advance(game,1,{throttle:1});assert.ok(events.some(e=>e[0]==='contact'));assert.ok(s.traffic[0].contacted);assert.equal(s.nearMisses,0);assert.ok(!events.some(e=>e[0]==='near'));assert.equal(s.combo,1);
});

test('low-energy contact and cooldown contact dirty roadworks without an audiovisual threshold',()=>{
 for(const cooldown of [0,99]){const {game,s,events}=fixture();game.startEvent('roadworks');s.x=1;s.speed=.2;s.impactCooldown=cooldown;s.obstacles=[{id:99,kind:'barrier',x:1,z:2.37+.071}];advance(game,.2,{});
 assert.ok(events.some(e=>e[0]==='contact'));assert.equal(s.roadEvent.clean,false);const count=s.eventsCompleted;s.distance=s.roadEvent.end+.1;game.update(1/120);assert.equal(s.eventsCompleted,count);assert.equal(s.lastEvent.success,false);}
});

test('completing either roll direction unwraps to upright instead of sweeping a reverse revolution',()=>{
 for(const direction of [-1,1]){const {game,s,events}=fixture(),u=.999;
 Object.assign(s,{speed:25,forwardVelocity:25,x:1,heading:0,altitude:2.65,verticalSpeed:0,nitro:50,rolling:true,rollProgress:u,rollAngle:direction*2*Math.PI*u*u*u*(10+u*(-15+6*u)),rollDirection:direction,distance:(Math.PI-.35)*1100,goalReached:true,safeCorridor:null,traffic:[{id:1,kind:'van',lane:1,x:1,heading:0,z:5,speed:12,cruiseSpeed:12}]});
 game.update(1/120,{flight:true,throttle:1});assert.equal(s.rollAngle,0);assert.equal(s.rolling,false);assert.equal(s.phase,'playing');assert.ok(!events.some(e=>['contact','impact','crash'].includes(e[0])));assert.ok(s.speed>25);assert.equal(s.contactBudgetStops,undefined);
 }
});

test('flight contact uses the actual beginning altitude before it clears a roof',()=>{
 function probe(wrongStart){const {s}=fixture();Object.assign(s,{speed:65,forwardVelocity:65,x:1,heading:0,altitude:1.34,distance:(Math.PI-.35)*1100,traffic:[{id:1,kind:'sedan',lane:1,x:1,heading:0,z:4.68,speed:18,cruiseSpeed:18}]});
 const before=captureContactFrame(s);s.altitude+=2.6/120;s.traffic[0].z+=(18-65)/120;if(wrongStart)before.altitude=s.altitude;
 return resolveVehicleContacts(s,before,1/120,65/120);}
 assert.ok(probe(false).contacts.some(c=>c.kind==='traffic'));assert.equal(probe(true).contacts.length,0);
});

test('mirror-only trim touch is nonblocking and nonfatal, but a following body impact still resolves',()=>{
 const {game,s,events}=fixture();Object.assign(s,{speed:65,forwardVelocity:65,heading:0,x:1,distance:(Math.PI-.35)*1100,goalReached:true,safeCorridor:null,traffic:[{id:1,kind:'sedan',lane:0,x:1+(-1.165-.97)/3.5,z:3.125,speed:18,cruiseSpeed:18}]});
 const before=s.distance;game.update(1/120,{throttle:1});assert.equal(s.phase,'playing');assert.ok(s.speed>64);assert.ok(s.distance-before>.53);assert.ok(events.some(e=>e[0]==='contact'));assert.ok(s.traffic[0].mirrorContacted);assert.ok(!s.traffic[0].impactActive);assert.equal(s.contactBudgetStops,undefined);
 // Same entity subsequently enters the solid nose path. A remembered mirror
 // contact must not suppress body geometry or make the chassis invulnerable.
 const car=s.traffic[0];Object.assign(car,{x:1,lane:1,z:4.9,heading:0});game.update(1/120,{throttle:1});assert.equal(s.phase,'crashed');assert.equal(events.filter(e=>e[0]==='crash').length,1);assert.ok(s.speed<60);assert.ok(car.impactActive);
});

test('bounded solver clips untouched traffic to the same clock without inventing impact or cancelling intent',()=>{
 const {game,s}=fixture();Object.assign(s,{speed:65,forwardVelocity:65,distance:(Math.PI-.35)*1100,goalReached:true,safeCorridor:null,obstacles:Array.from({length:6},(_,i)=>({id:i+1,kind:'cone',x:1,z:0})),traffic:[{id:9,kind:'sedan',lane:0,x:0,z:0,speed:18,cruiseSpeed:18,laneChange:{from:0,to:1,phase:'moving',elapsed:.1,duration:3,signalDuration:1},signal:1,laneChangeCooldown:1}]});
 const car=s.traffic[0],old=captureContactFrame(s);game.update(1/120,{throttle:1});assert.equal(s.contactBudgetStops,1);assert.ok(!car.impactActive);assert.equal(car.contacted,undefined);assert.ok(car.laneChange);assert.equal(car.laneChange.phase,'moving');assert.equal(car.laneChange.elapsed,old.traffic.get(car).laneChange.elapsed);assert.equal(car.signal,1);assert.ok(car.laneChangeCooldown<=1);assert.equal(s.distance,(Math.PI-.35)*1100);assert.equal(s.score,0);
});

test('safe-clock clipping reconstructs signal and completed lane-change epochs coherently',()=>{
 for(const phase of ['signal','moving']){const {s}=fixture();Object.assign(s,{distance:(Math.PI-.35)*1100,obstacles:Array.from({length:6},(_,i)=>({id:i+1,kind:'cone',x:1,z:0}))});
 const change={phase,elapsed:phase==='signal'?.995:2.995,duration:3,from:0,to:1,signalDuration:1};const car={id:99,kind:'sedan',lane:0,x:0,z:-5,speed:18,heading:0,laneChange:change,signal:1,laneChangeCooldown:0,travelDistance:10};s.traffic=[car];
 const before=captureContactFrame(s);car.z+=.15;car.travelDistance+=.15;
 if(phase==='signal')Object.assign(car.laneChange,{phase:'moving',elapsed:.003333});else Object.assign(car,{laneChange:null,signal:0,lane:1,laneChangeCooldown:5});
 const result=resolveVehicleContacts(s,before,1/120,0);assert.equal(result.fatal,false);assert.equal(result.travelled,0);assert.equal(s.contactBudgetStops,1);assert.equal(car.lane,0);assert.equal(car.signal,1);assert.equal(car.laneChange.phase,phase);assert.equal(car.laneChange.elapsed,phase==='signal'?.995:2.995);assert.equal(car.travelDistance,10);assert.ok(!car.impactActive);assert.equal(car.z,-5);
 }
});

test('a lane completion genuinely reached before safe clipping retains its completion cooldown',()=>{
 const {s}=fixture();Object.assign(s,{speed:65,forwardVelocity:65,distance:(Math.PI-.35)*1100,obstacles:Array.from({length:6},(_,i)=>({id:i+1,kind:'cone',x:1,z:2.8}))});
 const car={id:99,kind:'sedan',lane:0,x:0,z:-5,speed:18,heading:0,laneChange:{phase:'moving',elapsed:2.999,duration:3,from:0,to:1,signalDuration:1},signal:1,laneChangeCooldown:0};s.traffic=[car];const before=captureContactFrame(s);
 car.z+=(18-65)/120;Object.assign(car,{laneChange:null,signal:0,lane:1,laneChangeCooldown:23});for(const o of s.obstacles)o.z-=65/120;
 const result=resolveVehicleContacts(s,before,1/120,65/120);assert.equal(s.contactBudgetStops,1);assert.ok(result.travelled>65*.001);assert.equal(car.laneChange,null);assert.equal(car.lane,1);assert.equal(car.laneChangeCooldown,23);assert.ok(!car.impactActive);
});
