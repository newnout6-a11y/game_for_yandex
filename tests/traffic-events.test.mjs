import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlaceRoadworks } from '../src/traffic-events.js';
import { assessTrafficWaveCorridor } from '../src/traffic-demand.js';
import { Game } from '../src/game.js';

/** Build a ready production game with an explicit deterministic traffic fixture. */
function fixture(traffic=[]){const g=new Game({random:()=>0});g.start();Object.assign(g.state,{traffic,safeCorridor:null,nextSpawn:Infinity,nextEvent:Infinity});return g;}
test('roadworks choose another edge when a straight approaching car cannot stop',()=>{
 const g=fixture([{id:1,kind:'sedan',lane:0,z:115,speed:22,cruiseSpeed:22}]);
 assert.equal(canPlaceRoadworks(g.state,0),false);assert.equal(g.startEvent('roadworks'),true);assert.equal(g.state.roadEvent.lane,2);
});
test('roadworks defer without RNG identity or event mutation when both edges are unsafe',()=>{
 const g=fixture([0,2].map((lane,i)=>({id:i+1,kind:'semi',lane,z:130,speed:20,cruiseSpeed:20})));
 const serial=g.serial,index=g.state.eventIndex;assert.equal(g.startEvent('roadworks'),false);
 assert.equal(g.serial,serial);assert.equal(g.state.eventIndex,index);assert.equal(g.state.roadEvent,null);assert.deepEqual(g.state.obstacles,[]);
});
test('new hazards never intersect stopped bodies, while cars already beyond the layout are allowed',()=>{
 for(const kind of ['hatch','sedan','suv','van','boxtruck','semi','towtruck','firetruck']){
  assert.equal(canPlaceRoadworks({traffic:[{id:1,kind,lane:0,z:174,speed:0}]},0),false,kind);
  assert.equal(canPlaceRoadworks({traffic:[{id:1,kind,lane:0,z:235,speed:22}]},0),true,kind);
  assert.equal(canPlaceRoadworks({traffic:[{id:1,kind,lane:0,z:20,speed:22}]},0),true,kind);
 }
});
test('a feasible real driver brakes before the new work zone without positional rescue',()=>{
 const car={id:1,kind:'semi',lane:0,z:35,speed:20,cruiseSpeed:20};const g=fixture([car]);
 Object.assign(g.state,{x:2,lane:2,speed:0});assert.equal(g.startEvent('roadworks'),true);assert.equal(g.state.roadEvent.lane,0);
 for(let i=0;i<2400;i++){g.update(1/120);assert.ok(car.z+8.2<149.4);}
 assert.equal(g.state.trafficDiagnostics.interventions,0);assert.ok(car.speed<.25);
});

test('convoy insertion applies braking-aware spawn gaps behind an already stopped leader',()=>{
 const g=fixture([{id:900,kind:'sedan',lane:0,z:260,speed:0,cruiseSpeed:0}]);
 Object.assign(g.state,{x:2,lane:2,speed:0});assert.equal(g.startEvent('convoy'),true);
 for(let i=0;i<720;i++){
  g.update(1/120);
  for(const car of g.state.traffic)assert.ok(car.acceleration>=-6.5-1e-8,'bounded braking, not a spawn-position rescue');
 }
 assert.equal(g.state.trafficDiagnostics.interventions,0);
});

test('fully blocked convoy defers atomically rather than installing an empty timed event',()=>{
 const traffic=[];for(const lane of [0,1])for(let z=220;z<430;z+=10)traffic.push({id:900+traffic.length,kind:'semi',lane,z,speed:0,cruiseSpeed:0});
 const g=fixture(traffic),serial=g.serial,index=g.state.eventIndex;
 assert.equal(g.startEvent('convoy'),false);assert.equal(g.state.roadEvent,null);assert.equal(g.serial,serial);assert.equal(g.state.eventIndex,index);assert.equal(g.state.traffic.length,traffic.length);
});

/** Stable LCG supplies genuine generated waves rather than a hand-picked gap. */
function seededRandom(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
test('roadworks cannot close the finite corridor already promised to the player',()=>{
 const g=fixture();g.state.safeCorridor={lane:0,z:163.12,halfLength:20,speed:19.95};
 assert.equal(canPlaceRoadworks(g.state,0),false);assert.equal(g.startEvent('roadworks'),true);assert.equal(g.state.roadEvent.lane,2);
 assert.equal(canPlaceRoadworks({...g.state,safeCorridor:{lane:0,z:300,halfLength:20,speed:20}},0),true,'reservation is finite, not a permanent lane ban');
});
test('roadworks preserve an approaching reserved passage throughout later simulation',()=>{
 for(const dt of [1/120,1/60,1/30,.1]){
  const g=fixture();g.state.safeCorridor={lane:0,z:100,halfLength:20,speed:14};
  const initial={...g.state.safeCorridor};
  assert.equal(canPlaceRoadworks(g.state,0),false,'the current gap is not the future sweep');
  assert.equal(g.startEvent('roadworks'),true);assert.equal(g.state.roadEvent.lane,2);
  assert.deepEqual(g.state.safeCorridor,initial,'do not move or revoke the existing reservation');
  let crossedFormerWorkZone=false;
  for(let i=0;i<Math.ceil(40/dt);i++){
   g.update(dt);
   const c=g.state.safeCorridor,half=g.state.playerBounds.length/2;
   if(c.z-c.halfLength-half>213.6)crossedFormerWorkZone=true;
   for(const obstacle of g.state.obstacles){
    const obstacleLane=Math.round(obstacle.x),depth=obstacle.kind==='barrier'?2:.6;
    assert.ok(obstacleLane!==c.lane||Math.abs(obstacle.z-c.z)>c.halfLength+half+depth,'no later obstacle enters the promised passage');
   }
  }
  assert.ok(crossedFormerWorkZone,'test advances past the entire original closure');
  assert.ok(g.state.roadEvent,'a waiting player keeps works active even after the display deadline');
  assert.equal(g.state.phase,'playing');assert.equal(g.state.trafficDiagnostics.interventions,0);
 }
});
test('temporal reservation is directional and finite, with exact padded boundaries',()=>{
 const g=fixture(),half=g.state.playerBounds.length/2;
 const check=(z,speed)=>canPlaceRoadworks({...g.state,safeCorridor:{lane:0,z,halfLength:20,speed}},0);
 assert.equal(check(100,14),false);
 assert.equal(check(-20,14),false,'active rear reservation may move forward again while the player waits');
 assert.equal(check(100,0),true,'a stationary disjoint reservation never approaches');
 assert.equal(check(100,undefined),true,'legacy omitted speed is stationary');
 assert.equal(check(149.4-20-half,0),false,'inclusive front contact');
 assert.equal(check(213.6+20+half,14),false,'inclusive rear contact');
 assert.equal(check(213.6+20+half+.001,14),true,'a reservation beyond the works moves away');
 assert.equal(canPlaceRoadworks({...g.state,safeCorridor:{lane:1,z:100,halfLength:20,speed:14}},0),true,'other lanes remain available');
});
test('approaching reservation and blocked opposite edge defer installation atomically',()=>{
 const g=fixture([{id:1,kind:'semi',lane:2,z:130,speed:20,cruiseSpeed:20}]);
 g.state.safeCorridor={lane:0,z:100,halfLength:20,speed:14};
 const before=structuredClone(g.state),serial=g.serial;let samples=0;g.random=()=>{samples++;return 0;};
 assert.equal(g.startEvent('roadworks'),false);
 assert.deepEqual(g.state,before);assert.equal(g.serial,serial);assert.equal(samples,0);
});
test('naturally scheduled first roadworks preserves the currently promised corridor',()=>{
 const g=new Game({random:seededRandom(1)});g.start();
 for(let i=0;i<2400&&!g.state.roadEvent&&g.state.phase==='playing';i++)g.update(1/120,{throttle:1});
 const s=g.state;assert.ok(s.roadEvent,'normal run reaches a feasible event');
 if(s.roadEvent.type==='roadworks'&&s.safeCorridor?.lane===s.roadEvent.lane){
  const c=s.safeCorridor;assert.ok(c.z+c.halfLength+3<149.4||c.z-c.halfLength-3>213.6);
 }
 assert.equal(s.trafficDiagnostics.interventions,0);
});
test('convoy preserves a connected finite passage across its whole staged span',()=>{
 const g=new Game({random:seededRandom(1)});g.start();const previous={...g.state.safeCorridor};
 assert.equal(g.startEvent('convoy'),true);const s=g.state,c=s.safeCorridor;
 assert.equal(c.speed,6);assert.equal(assessTrafficWaveCorridor(s,{...c,previousCorridor:previous}).allowed,true);
 const members=s.traffic.filter(car=>s.roadEvent.targets.includes(car.id));
 assert.ok(members.every(car=>Math.abs(car.z-c.z)<c.halfLength));
});
test('rejected scheduled events use a bounded simulation-time retry, never frame timers',()=>{
 const g=fixture([0,2].map((lane,i)=>({id:i+1,kind:'semi',lane,z:130,speed:20,cruiseSpeed:20})));
 g.state.nextEvent=0;let attempts=0;const original=g.startEvent.bind(g);g.startEvent=(...args)=>{attempts++;return original(...args);};
 for(let i=0;i<30;i++)g.update(1/120);
 assert.equal(attempts,1);assert.equal(g.state.roadEvent,null);assert.equal(g.state.eventIndex,0);
});
