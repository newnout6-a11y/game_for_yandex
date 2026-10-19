import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { assessTrafficSpawn, assessTrafficWaveCorridor } from '../src/traffic-demand.js';
import { trafficDefinition } from '../src/traffic-catalog.js';

/** Stopped, fully sized production traffic; no planner or update mocks. */
function queue(lanes, first=220, last=430, step=18) {
  const traffic=[];
  for(const lane of lanes)for(let z=first;z<=last;z+=step)
    traffic.push({id:900+traffic.length,kind:'semi',lane,z,speed:0,cruiseSpeed:0,passed:false});
  return traffic;
}

/** Keep all random draws observable, including a rejected attempt's hidden draws. */
function fixture(traffic=[], {sample=0, seed=17, x=2}={}) {
  let draws=0,randomState=seed;
  const events=[];
  const game=new Game({random:()=>{
    draws++;randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;
    return sample===null?randomState/4294967296:sample;
  },onEvent:(name,payload)=>events.push({name,payload:structuredClone(payload)})});
  Object.assign(game.state,{phase:'playing',x,lane:x,traffic:structuredClone(traffic),nextSpawn:Infinity,nextEvent:Infinity});
  game.serial=1000;
  return {game,events,rng:()=>({draws,randomState})};
}

/** Rejection must retain values AND existing entity/reservation references. */
function assertRejectedUnchanged(f) {
  const {game,events}=f,before=structuredClone(game.state),serial=game.serial,rng=f.rng();
  const state=game.state,traffic=state.traffic,cars=[...traffic],obstacles=state.obstacles,corridor=state.safeCorridor;
  const notifications=structuredClone(events);
  assert.equal(game.startEvent('convoy'),false);
  assert.deepEqual(game.state,before);
  assert.equal(game.state,state);assert.equal(state.traffic,traffic);assert.equal(state.obstacles,obstacles);assert.equal(state.safeCorridor,corridor);
  cars.forEach((car,i)=>assert.equal(state.traffic[i],car));
  assert.equal(game.serial,serial);assert.deepEqual(f.rng(),rng);assert.deepEqual(events,notifications);
}

for(const [name,traffic] of [
  ['one remaining target',queue([0,1],320,420,50)],
  ['two remaining targets',queue([1])],
  ['three remaining targets',queue([1],330,330)],
  ['zero remaining targets',queue([0,1])],
])test(`convoy rejects ${name} without RNG, identity, corridor, event or schedule mutation`,()=>{
  const f=fixture(traffic);
  Object.assign(f.game.state,{nextEvent:73,eventIndex:2,eventRetryAt:4,pendingCorridorLane:1,corridorWaves:3});
  for(let attempt=0;attempt<3;attempt++)assertRejectedUnchanged(f);
});

test('convoy rejection preserves an existing safe corridor and its connected passage',()=>{
  const f=fixture(queue([1]));
  f.game.state.safeCorridor={lane:2,z:170,halfLength:20,speed:14};
  assertRejectedUnchanged(f);
});

test('both committed edge reservations reject before drawing randomness',()=>{
  const f=fixture([
    {...queue([0],250,250)[0],laneChange:{from:0,to:1,phase:'moving'}},
    {...queue([2],300,300)[0],id:901,laneChange:{from:2,to:1,phase:'moving'}},
  ]);
  assertRejectedUnchanged(f);
});

test('a complete convoy retains authored kinds, positions, one RNG draw and contiguous IDs',()=>{
  for(const sample of [0,.34,.99]) {
    const f=fixture([],{sample,x:1}),{game}=f,serial=game.serial;
    assert.equal(game.startEvent('convoy'),true);
    const s=game.state,e=s.roadEvent,cars=s.traffic;
    assert.equal(f.rng().draws,1);assert.equal(game.serial,serial+5);assert.equal(s.eventIndex,1);
    assert.equal(e.id,serial+1);assert.equal(e.lane,Math.floor(sample*3));
    assert.deepEqual(e.targets,[serial+2,serial+3,serial+4,serial+5]);
    assert.deepEqual(cars.map(car=>car.kind),['van','sedan','suv','hatch']);
    assert.deepEqual(cars.map(car=>car.z),[240,258,294,294]);
    const safe=sample<1/3?2:0;
    assert.deepEqual(cars.map(car=>car.lane),[2-safe,1,2-safe,1]);
    assert.equal(s.safeLane,safe);assert.equal(s.safeCorridor.lane,safe);assert.equal(s.safeCorridor.speed,6);
    assert.equal(assessTrafficWaveCorridor({...s,safeCorridor:null},s.safeCorridor).allowed,true);
    for(const car of cars) {
      assert.equal(car.eventId,e.id);assert.equal(car.speed,19);assert.ok(car.z<=400);
      assert.equal(assessTrafficSpawn({...s,traffic:cars.filter(other=>other!==car)},car).allowed,true);
      assert.ok(Math.abs(car.z-s.safeCorridor.z)+trafficDefinition(car.kind).length/2<=s.safeCorridor.halfLength);
    }
    assert.deepEqual(f.events.map(event=>event.name),['event-start']);
    // Passing fewer than all four is not enough to earn the event reward.
    for(const car of cars.slice(0,3))car.passed=true;
    game.updateEvent();assert.equal(s.eventsCompleted,0);assert.equal(s.roadEvent,e);assert.equal(e.carsLeft,1);
    cars[3].passed=true;game.updateEvent();
    assert.equal(s.eventsCompleted,1);assert.equal(s.lastEvent.points,400);assert.equal(s.lastEvent.success,true);
    assert.deepEqual(f.events.map(event=>event.name),['event-start','event-clear']);
  }
});

test('a stopped leader still permits a complete shifted convoy with original headway',()=>{
  const f=fixture([{id:900,kind:'sedan',lane:0,z:260,speed:0,cruiseSpeed:0}]);
  assert.equal(f.game.startEvent('convoy'),true);
  const s=f.game.state,members=s.traffic.filter(car=>car.eventId===s.roadEvent.id);
  assert.equal(members.length,4);assert.deepEqual(members.map(car=>car.z),[294,258,348,294]);
  for(const car of members)assert.equal(assessTrafficSpawn({...s,traffic:s.traffic.filter(other=>other!==car)},car).allowed,true);
  for(let i=0;i<720;i++)f.game.update(1/120);
  assert.equal(s.phase,'playing');assert.equal(s.trafficDiagnostics.interventions,0);
});

test('the formerly two-car reward exploit cannot complete during real driving',()=>{
  const f=fixture(queue([1])),{game}=f,s=game.state;
  s.speed=28;
  // The old implementation accepted van + SUV and paid 400 after 8.858 seconds.
  assertRejectedUnchanged(f);
  for(let i=0;i<1200;i++)game.update(1/120,{throttle:1});
  assert.equal(s.phase,'playing');assert.ok(s.distance>300);
  assert.equal(s.eventsCompleted,0);assert.equal(s.lastEvent,null);assert.equal(s.roadEvent,null);
  assert.equal(f.events.some(event=>event.name==='event-start'||event.name==='event-clear'),false);
});

test('a deferred scheduled convoy retries in simulation time and later installs all four',()=>{
  const f=fixture(queue([1])),{game}=f,s=game.state;
  Object.assign(s,{speed:28,nextEvent:0,eventIndex:2});
  game.update(1/120,{throttle:1});
  assert.equal(s.roadEvent,null);assert.equal(s.eventIndex,2);assert.equal(game.serial,1000);assert.equal(f.rng().draws,0);
  const retry=s.eventRetryAt;
  assert.ok(retry>s.elapsed);
  for(let i=0;i<30;i++)game.update(1/120,{throttle:1});
  assert.equal(s.eventRetryAt,retry);assert.equal(f.rng().draws,0);
  for(let i=0;i<2400&&!s.roadEvent&&s.phase==='playing';i++)game.update(1/120,{throttle:1});
  assert.equal(s.phase,'playing');assert.ok(s.roadEvent,'moving past the blockage eventually creates a feasible layout');
  const event=s.roadEvent;
  assert.equal(event.type,'convoy');assert.equal(event.targets.length,4);assert.equal(s.eventIndex,3);
  assert.equal(s.traffic.filter(car=>car.eventId===event.id).length,4);assert.equal(s.eventRetryAt,0);
  assert.equal(game.serial,1005);assert.equal(f.rng().draws,1);
  assert.equal(f.events.filter(event=>event.name==='event-start').length,1);
});

test('rejected attempts do not perturb the next successful seeded convoy',()=>{
  const a=fixture(queue([1]),{sample:null}),b=fixture([],{sample:null});
  for(let i=0;i<7;i++)assertRejectedUnchanged(a);
  a.game.state.traffic=[];
  assert.equal(a.game.startEvent('convoy'),true);assert.equal(b.game.startEvent('convoy'),true);
  assert.deepEqual(a.game.state,b.game.state);assert.deepEqual(a.rng(),b.rng());assert.equal(a.game.serial,b.game.serial);
  assert.deepEqual(a.events,b.events);
});

test('blocker position and preferred edge cannot produce a partial committed layout',()=>{
  for(const lane of [0,1,2])for(const z of [220,260,294,310,330,350,380,400,420])for(const sample of [0,.5,.99]) {
    const f=fixture(queue([lane],z,z),{sample,x:1}),{game}=f;
    const before=structuredClone(game.state),rng=f.rng(),serial=game.serial;
    const accepted=game.startEvent('convoy'),s=game.state;
    const context=`blocker lane ${lane}, z ${z}, sample ${sample}`;
    if(!accepted) {
      assert.deepEqual(s,before,context);assert.deepEqual(f.rng(),rng,context);assert.equal(game.serial,serial,context);
      assert.deepEqual(f.events,[],context);continue;
    }
    const members=s.traffic.filter(car=>car.eventId===s.roadEvent.id);
    assert.equal(members.length,4,context);assert.equal(s.roadEvent.targets.length,4,context);
    assert.deepEqual(s.roadEvent.targets,members.map(car=>car.id),context);
    assert.equal(assessTrafficWaveCorridor({...s,safeCorridor:before.safeCorridor},s.safeCorridor).allowed,true,context);
    for(const car of members)assert.equal(assessTrafficSpawn({...s,traffic:s.traffic.filter(other=>other!==car)},car).allowed,true,context);
  }
});

for(const dt of [1/120,1/60,1/30,.1])test(`a successful four-target convoy completes through real physics at dt=${dt}`,()=>{
  const f=fixture(),{game}=f,s=game.state;
  s.speed=28;
  assert.equal(game.startEvent('convoy'),true);
  const event=s.roadEvent,members=[...s.traffic];
  assert.equal(members.length,4);
  let sawPartialPass=false;
  for(let i=0;i<Math.ceil(30/dt)&&s.roadEvent&&s.phase==='playing';i++) {
    game.update(dt,{throttle:1});
    const passed=members.filter(car=>car.passed).length;
    if(passed>0&&passed<4)sawPartialPass=true;
    if(passed<4) {
      assert.equal(s.roadEvent,event);assert.equal(s.eventsCompleted,0);assert.equal(s.lastEvent,null);
    }
  }
  assert.equal(s.phase,'playing');assert.equal(s.trafficDiagnostics.interventions,0);
  assert.equal(sawPartialPass,true);assert.equal(members.every(car=>car.passed),true);
  assert.equal(s.eventsCompleted,1);assert.equal(s.roadEvent,null);
  assert.equal(s.lastEvent.success,true);assert.equal(s.lastEvent.points,400);
  assert.deepEqual(f.events.filter(event=>event.name.startsWith('event-')).map(event=>event.name),['event-start','event-clear']);
});

test('seeded production opening waves either install four safe targets or leave the run untouched',()=>{
  let installed=0;
  for(let seed=1;seed<=48;seed++) {
    const f=fixture([],{sample:null,seed,x:1}),{game}=f;
    game.state.phase='ready';game.start();
    const before=structuredClone(game.state),serial=game.serial,rng=f.rng(),notifications=structuredClone(f.events);
    if(!game.startEvent('convoy')) {
      assert.deepEqual(game.state,before,`seed ${seed}`);assert.equal(game.serial,serial);assert.deepEqual(f.rng(),rng);
      assert.deepEqual(f.events,notifications);continue;
    }
    installed++;
    const s=game.state,e=s.roadEvent,members=s.traffic.filter(car=>car.eventId===e.id);
    assert.equal(members.length,4,`seed ${seed}`);assert.equal(e.targets.length,4);
    assert.equal(game.serial,serial+5);assert.equal(f.rng().draws,rng.draws+1);
    const originalReservation={...s,safeCorridor:before.safeCorridor};
    assert.equal(assessTrafficWaveCorridor(originalReservation,s.safeCorridor).allowed,true);
    for(const car of members)assert.equal(assessTrafficSpawn({...originalReservation,traffic:s.traffic.filter(other=>other!==car)},car).allowed,true);
  }
  assert.ok(installed>0,'the safety gate still permits generated complete convoys');
});
