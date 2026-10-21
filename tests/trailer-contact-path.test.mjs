import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {captureContactFrame,resolveVehicleContacts} from '../src/vehicle-contacts.js';
import {updateTrailerKinematics,trafficHitch,roadCurve} from '../src/traffic-physics.js';
import {trafficDefinition} from '../src/traffic-catalog.js';
const dt=1/120;
const close=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-10,`${label}: ${a} != ${b}`);
function expectedPath(before,after){
 const old=before.trailerState,next=after.trailerState,delta=next.distance-old.distance;
 const transport=(x,z)=>[x+roadCurve(z+delta,next.distance)-roadCurve(z,old.distance),z+delta];
 const [hx,hz]=transport(old.hitchX,old.hitchZ),[ax,az]=transport(old.axleX,old.axleZ);
 const travel=Math.hypot(next.axleX-ax,next.axleZ-az),priorYaw=Math.atan2(ax-hx,az-hz);
 return {travel,curvature:travel>1e-8?-Math.atan2(Math.sin(next.yaw-priorYaw),Math.cos(next.yaw-priorYaw))/travel:0};
}
function clipped(coneZ,{missingState=false,turning=true}={}){
 const game=new Game();game.start();const s=game.state;
 Object.assign(s,{traffic:[],pickups:[],obstacles:Array.from({length:6},(_,i)=>({id:i,kind:'cone',x:1,z:coneZ})),speed:65,forwardVelocity:65,distance:700,sceneTravel:0});
 const car={id:7,kind:'semi',lane:0,x:0,z:8,speed:18,heading:.05,travelDistance:100};s.traffic=[car];
 updateTrailerKinematics(car,s.distance,dt);car.trailerTravelDistance=75;
 const initial=structuredClone(car);if(missingState)delete car.trailerState;
 const before=captureContactFrame(s),travel=65*dt;
 car.x+=turning?.015:0;car.heading+=turning?.02:0;car.z+=(18-65)*dt;car.travelDistance+=18*dt;
 for(const obstacle of s.obstacles)obstacle.z-=travel;
 updateTrailerKinematics(car,s.distance+travel,dt);const proposal=structuredClone(car);
 const result=resolveVehicleContacts(s,before,dt,travel);
 return {game,s,car,initial,result,proposal};
}
test('clipped turning semi derives wheel distance and curvature from its transported axle, not tractor travel',()=>{
 const {car,initial,result,s,proposal}=clipped(2.8),expected=expectedPath(initial,car);
 assert.equal(s.contactBudgetStops,1);assert.ok(result.physicalTravel>0&&result.physicalTravel<65*dt);assert.ok(!car.impactActive);
 close(car.trailerTravelDistance-initial.trailerTravelDistance,expected.travel,'axle path');close(car.trailerCurvature,expected.curvature,'axle curvature');
 assert.ok(Math.abs(expected.travel-(car.travelDistance-initial.travelDistance))>1e-4,'fixture distinguishes tractor and axle paths');
 assert.ok(Math.abs(expected.curvature-proposal.trailerCurvature)>1e-6,'discarded full-step curvature must not survive clipping');
 const hitch=trafficHitch(car,car.trailerState.distance),length=trafficDefinition('semi').trailerAxleDistance;
 close(car.trailerState.axleX,hitch.x+Math.sin(car.trailerState.yaw)*length,'retained axle x');
 close(car.trailerState.axleZ,hitch.z+Math.cos(car.trailerState.yaw)*length,'retained axle z');
});
test('zero-clock clipping does not spin trailer wheels and clears discarded proposed curvature',()=>{
 const {car,initial,result}=clipped(0);close(result.physicalTravel,0,'zero physical travel');
 close(car.trailerTravelDistance,initial.trailerTravelDistance,'stationary wheel distance');assert.equal(car.trailerCurvature,0);
});
test('unchanged accepted clipped pose does not add wheel travel on subsequent kinematics update',()=>{
 const {car}=clipped(3.05),travel=car.trailerTravelDistance,state={...car.trailerState};
 updateTrailerKinematics(car,state.distance,dt);close(car.trailerTravelDistance,travel,'no double counting');
 close(car.trailerState.axleX,state.axleX,'axle x continuity');close(car.trailerState.axleZ,state.axleZ,'axle z continuity');assert.equal(car.trailerCurvature,0);
});
test('first-step clipped trailer without a cached pose uses its actual initial hitch and axle',()=>{
 const {car,initial}=clipped(2.8,{missingState:true}),expected=expectedPath(initial,car);
 close(car.trailerTravelDistance-initial.trailerTravelDistance,expected.travel,'fallback initial axle path');close(car.trailerCurvature,expected.curvature,'fallback initial curvature');assert.ok(expected.travel>0);
});
test('actual severe Game contact reconciles trailer wheel path after impulse without changing fatal semantics',()=>{
 const events=[],game=new Game({onEvent:(event,value)=>events.push([event,value])});game.start();const s=game.state;
 Object.assign(s,{traffic:[],obstacles:[],pickups:[],nextSpawn:Infinity,nextEvent:Infinity,speed:45,forwardVelocity:45,distance:700,x:1});
 const car={id:7,kind:'semi',lane:1,x:1,z:13,speed:12,cruiseSpeed:12,heading:.03,travelDistance:100};s.traffic=[car];updateTrailerKinematics(car,s.distance,dt);car.trailerTravelDistance=75;
 let before;for(let i=0;i<120&&!car.impactActive;i++){before=structuredClone(car);game.update(dt,{throttle:1});}
 assert.ok(car.impactActive);assert.equal(s.phase,'crashed');assert.equal(events.filter(e=>e[0]==='crash').length,1);
 const expected=expectedPath(before,car);close(car.trailerTravelDistance-before.trailerTravelDistance,expected.travel,'impact axle travel');close(car.trailerCurvature,expected.curvature,'impact axle curvature');
 assert.ok(Math.abs(expected.travel-(car.travelDistance-before.travelDistance))>1e-5,'actual impact is not a tractor-distance alias');
});

test('terminal coast advances moving tractor/trailer wheel clocks while rewards and input remain frozen',()=>{
 const events=[],game=new Game({onEvent:event=>events.push(event)});game.start();const s=game.state;
 Object.assign(s,{traffic:[],obstacles:[],pickups:[],nextSpawn:Infinity,nextEvent:Infinity,speed:45,forwardVelocity:45,distance:700,x:1});
 const car={id:7,kind:'semi',lane:1,x:1,z:13,speed:12,cruiseSpeed:12,heading:.03,travelDistance:100};s.traffic=[car];updateTrailerKinematics(car,s.distance,dt);
 for(let i=0;i<120&&s.phase==='playing';i++)game.update(dt,{throttle:1});assert.equal(s.phase,'crashed');
 const frozen=Object.fromEntries(['distance','score','elapsed','nitro','overtakes','nearMisses'].map(k=>[k,s[k]])),eventCount=events.length,initial=structuredClone(car);
 for(let i=0;i<25;i++){
   const before=structuredClone(car);game.update(dt,()=>{throw new Error('terminal coast sampled input');});
   const expected=expectedPath(before,car);close(car.trailerTravelDistance-before.trailerTravelDistance,expected.travel,'coast axle travel');close(car.trailerCurvature,expected.curvature,'coast axle curvature');
   assert.ok(car.travelDistance>before.travelDistance,'moving tractor wheels advance');assert.ok(car.trailerTravelDistance>before.trailerTravelDistance,'moving trailer wheels advance');
   close(car.trailerState.distance,s.distance+s.sceneTravel,'cache uses final moving frame');
 }
 assert.ok(car.trailerTravelDistance-initial.trailerTravelDistance>2);assert.deepEqual(Object.fromEntries(Object.keys(frozen).map(k=>[k,s[k]])),frozen);assert.equal(events.length,eventCount);
 while(s.impactRemaining>1e-9)game.update(dt);const stopped=structuredClone(car);game.update(.1);assert.deepEqual(car,stopped,'coast completion freezes all traffic again');
});

test('moving player crash frame does not spin a stationary unrelated trailer',()=>{
 const game=new Game();game.start();const s=game.state;
 const car={id:8,kind:'semi',lane:0,x:0,z:-5,speed:0,heading:.04,travelDistance:20};Object.assign(s,{traffic:[car],obstacles:[],pickups:[],distance:700,sceneTravel:0,speed:20,forwardVelocity:20,impactRemaining:.65});updateTrailerKinematics(car,s.distance,dt);game.crash();const travel=car.trailerTravelDistance;
 for(let i=0;i<20;i++)game.update(dt);
 assert.ok(s.sceneTravel>0);assert.equal(car.travelDistance,20);assert.equal(car.trailerTravelDistance,travel);assert.equal(car.trailerCurvature,0);close(car.trailerState.distance,s.distance+s.sceneTravel,'stationary cache frame');
});
