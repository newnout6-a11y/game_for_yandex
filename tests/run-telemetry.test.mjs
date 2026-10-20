import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTelemetry } from '../src/run-telemetry.js';
import { Game } from '../src/game.js';
import { calculateRunRewards } from '../src/progression.js';
/** Build mutable simulation-shaped input for deterministic telemetry threshold tests. */
const state=()=>({phase:'playing',elapsed:0,distance:0,speed:20,altitude:0,verticalSpeed:0,rollAngle:0,x:1,score:0,eventsCompleted:0,overtakes:0,revives:0,goalReached:false,rolling:false,touchdownPulse:0});
/** Advance real simulation time and path distance in bounded observed frames. */
function advance(t,s,seconds,{air=false,speed=20}={}){for(let i=0;i<Math.ceil(seconds/.05);i++){s.elapsed+=.05;s.distance+=speed*.05;s.score=s.distance;s.speed=speed;s.altitude=air?1.5:0;s.verticalSpeed=0;t.observe(s,.05);}}
/** Complete a nontrivial airborne cycle and assisted safe touchdown without bypassing distance gates. */
function flight(t,s,{safe=true}={}){advance(t,s,.5,{air:true});s.elapsed+=.05;s.distance+=1;s.altitude=0;s.verticalSpeed=0;s.touchdownPulse=safe?1:0;t.event('land',undefined,s);s.touchdownPulse=0;}

test('observing immutable production input derives SI distance and elapsed time without mutation',()=>{const t=new RunTelemetry(),s=state();advance(t,s,2);const before=structuredClone(s),snapshot=t.observe(Object.freeze(s),.05);assert.deepEqual(s,before);assert.ok(Math.abs(snapshot.distanceM-40)<1e-8);assert.ok(Math.abs(snapshot.activeSeconds-2)<1e-8);assert.equal(snapshot.groundDistanceM,40);assert.equal(snapshot.rawScore,40);snapshot.distanceM=999;assert.equal(t.snapshot().distanceM,40);});
test('pause, duplicate frames, backwards jitter and impossible teleports cannot farm distance',()=>{const t=new RunTelemetry(),s=state();advance(t,s,1);const before=t.snapshot();for(let i=0;i<100;i++)t.observe(s,1);assert.deepEqual(t.snapshot(),before);s.phase='paused';s.elapsed+=10;s.distance+=1000;t.observe(s,10);assert.deepEqual(t.snapshot(),before);s.phase='playing';s.elapsed+=.05;s.distance+=5000;t.observe(s,.05);assert.equal(t.snapshot().distanceM,before.distanceM);s.elapsed-=.02;s.distance-=1;t.observe(s,.02);assert.equal(t.snapshot().distanceM,before.distanceM);});
test('precision landing needs genuine altitude/time, safe touch, 120m ground and at most three per rolling km',()=>{const t=new RunTelemetry(),s=state();advance(t,s,6);flight(t,s);assert.equal(t.snapshot().precisionLandings,1);flight(t,s);assert.equal(t.snapshot().precisionLandings,1);for(let i=0;i<4;i++){advance(t,s,6.1);flight(t,s);}assert.equal(t.snapshot().precisionLandings,3);assert.ok(t.snapshot().landings>=6);advance(t,s,55);flight(t,s);assert.equal(t.snapshot().precisionLandings,4);});
test('jitter, repeated land events and hover at one place never produce precision rewards',()=>{const t=new RunTelemetry(),s=state();advance(t,s,7);for(let i=0;i<30;i++){s.elapsed+=.05;s.altitude=i%2?.01:0;t.observe(s,.05);t.event('land',undefined,s);}assert.equal(t.snapshot().precisionLandings,0);for(let n=0;n<4;n++){advance(t,s,.5,{air:true,speed:0});s.elapsed+=.05;s.altitude=0;s.touchdownPulse=1;t.event('land',undefined,s);}assert.equal(t.snapshot().precisionLandings,1);assert.equal(t.snapshot().landings,4);for(let i=0;i<10;i++)t.event('land',undefined,s);assert.equal(t.snapshot().landings,4);});
test('unsafe landing and airborne collision fail precision, crash/revive cannot turn altitude reset into landing',()=>{let t=new RunTelemetry(),s=state();advance(t,s,7);flight(t,s,{safe:false});assert.equal(t.snapshot().precisionLandings,0);advance(t,s,.5,{air:true});t.event('cone',undefined,s);s.elapsed+=.05;s.altitude=0;s.touchdownPulse=1;t.event('land',undefined,s);assert.equal(t.snapshot().precisionLandings,0);advance(t,s,.5,{air:true});s.phase='crashed';t.event('crash',undefined,s);s.revives=1;s.phase='playing';s.altitude=0;s.elapsed+=.05;t.observe(s,.05);assert.equal(t.snapshot().revives,1);assert.equal(t.snapshot().precisionLandings,0);});
test('actual state counters count road events once; air overtakes require airborne clearance',()=>{const t=new RunTelemetry(),s=state();advance(t,s,.1);s.eventsCompleted=1;s.elapsed+=.05;s.distance+=1;t.event('event-clear',{success:true},s);t.event('event-clear',{success:true},s);assert.equal(t.snapshot().roadEventsCompleted,1);s.overtakes=2;s.elapsed+=.05;s.distance+=1;t.observe(s,.05);assert.equal(t.snapshot().airborneOvertakes,0);s.altitude=1.2;s.overtakes=3;s.elapsed+=.05;s.distance+=1;t.observe(s,.05);assert.equal(t.snapshot().airborneOvertakes,1);});
test('NaN input stays bounded, raw score follows actual penalties, finalize becomes immutable',()=>{const t=new RunTelemetry(),s=state();advance(t,s,1);s.score=5;t.observe(s,0);assert.equal(t.snapshot().rawScore,5);t.observe({...s,distance:NaN,elapsed:NaN,speed:Infinity},NaN);assert.ok(Object.values(t.snapshot()).every(v=>typeof v==='boolean'||Number.isFinite(v)));const result=t.finalize(s);advance(t,s,5);assert.deepEqual(t.snapshot(),result);});
test('production Game events and actual flight cycles accrue real telemetry',()=>{let t=new RunTelemetry(),game;game=new Game({random:()=>.5,onEvent:(name,payload)=>t.event(name,payload,game.state)});game.start();game.state.nextSpawn=Infinity;game.state.traffic=[];game.state.nextEvent=Infinity;for(let i=0;i<800;i++){game.state.traffic=[];game.update(1/60,{throttle:1,flight:i>550&&i<600});t.observe(game.state,1/60);}const snap=t.snapshot();assert.ok(snap.distanceM>150);assert.ok(snap.airSeconds>0);assert.ok(snap.landings>=1);assert.equal(snap.precisionLandings,1);assert.ok(calculateRunRewards(snap).credits>0);});

test('a hazard that first observes flight invalidates the newly created cycle',()=>{
  for(const hazard of ['contact','cone','crash'])for(const altitude of [.003,1]){
    const t=new RunTelemetry(),s=state();advance(t,s,7);
    Object.assign(s,{elapsed:s.elapsed+.05,distance:s.distance+1,altitude,verticalSpeed:1});
    t.event(hazard,undefined,s);
    if(altitude>.08)assert.ok(t.cycle,`${hazard} observes a real flight cycle`);
    else assert.equal(t.cycle,null,'low takeoff retains the hazard without changing flight thresholds');
    advance(t,s,.5,{air:true});
    assert.equal(t.cycle.clean,false,`${hazard} cannot leave its new cycle clean`);
    Object.assign(s,{elapsed:s.elapsed+.05,distance:s.distance+1,altitude:0,touchdownPulse:1});
    t.event('land',{verticalSpeed:-.2,rollAngle:0,assisted:true},s);
    const result=t.snapshot();
    assert.equal(result.landings,1);assert.equal(result.precisionLandings,0);
    for(let i=0;i<5;i++){t.event(hazard,undefined,s);t.event('land',undefined,s);t.observe(s);}
    assert.deepEqual(t.snapshot(),result,'duplicate callbacks add neither time, distance nor rewards');
    flight(t,s);assert.equal(t.snapshot().precisionLandings,1,'the hazard does not contaminate the next flight');
  }
});

test('a low takeoff hazard does not survive an aborted takeoff or revive',()=>{
  for(const revive of [false,true]){
    const t=new RunTelemetry(),s=state();advance(t,s,7);
    Object.assign(s,{elapsed:s.elapsed+.05,distance:s.distance+1,altitude:.003});
    t.event('contact',undefined,s);
    assert.equal(t.cycle,null);assert.equal(t.flightHazard,true);
    Object.assign(s,{elapsed:s.elapsed+.05,distance:s.distance+1,altitude:0,revives:revive?1:0});
    t.observe(s);assert.equal(t.flightHazard,false);
    flight(t,s);assert.equal(t.snapshot().landings,1);assert.equal(t.snapshot().precisionLandings,1);
    assert.equal(t.snapshot().revives,revive?1:0);
  }
});

test('impact presentation does not observe state, mark hazards or manufacture rewards',()=>{
  const t=new RunTelemetry(),s=state();advance(t,s,7);advance(t,s,.5,{air:true});
  const before=t.snapshot(),cycle={...t.cycle};
  Object.assign(s,{elapsed:s.elapsed+.05,distance:s.distance+1,altitude:0,touchdownPulse:1});
  for(let i=0;i<10;i++)t.event('impact',{severe:true},s);
  assert.deepEqual(t.snapshot(),before);assert.deepEqual(t.cycle,cycle);
  t.event('land',{verticalSpeed:-.2,rollAngle:0,assisted:true},s);
  assert.equal(t.snapshot().landings,1);assert.equal(t.snapshot().precisionLandings,1);
});

test('the original touchdown payload, not reset state or previous samples, determines safety',()=>{
  for(const {payload,previousVertical,previousRoll,precision} of [
    {payload:{verticalSpeed:-6,rollAngle:0,assisted:true},previousVertical:0,previousRoll:0,precision:0},
    {payload:{verticalSpeed:-.2,rollAngle:.4,assisted:true},previousVertical:0,previousRoll:0,precision:0},
    {payload:{verticalSpeed:-.2,rollAngle:0,assisted:true},previousVertical:-6,previousRoll:.4,precision:1},
  ]){
    const t=new RunTelemetry(),s=state();advance(t,s,7);advance(t,s,.5,{air:true});
    Object.assign(s,{verticalSpeed:previousVertical,rollAngle:previousRoll});t.observe(s);
    Object.assign(s,{elapsed:s.elapsed+.05,distance:s.distance+1,altitude:0,verticalSpeed:0,rollAngle:0,touchdownPulse:0});
    t.event('land',Object.freeze(payload),Object.freeze(s));
    assert.equal(t.snapshot().landings,1);assert.equal(t.snapshot().precisionLandings,precision);
    const result=t.snapshot();t.event('land',{verticalSpeed:0,rollAngle:0,assisted:true},s);
    assert.deepEqual(t.snapshot(),result,'a duplicate safe payload cannot replace the actual touchdown');
  }
});

test('midair or stale landing callbacks cannot consume a current flight cycle',()=>{
  const t=new RunTelemetry(),s=state();advance(t,s,7);advance(t,s,.5,{air:true});
  t.event('land',{verticalSpeed:0,rollAngle:0,assisted:true},s);
  assert.ok(t.cycle);assert.equal(t.snapshot().landings,0);assert.equal(t.snapshot().precisionLandings,0);
  t.event('land',{verticalSpeed:0,rollAngle:0,assisted:true},{...s,elapsed:s.elapsed-.1,altitude:0});
  assert.ok(t.cycle);assert.equal(t.snapshot().landings,0);
  Object.assign(s,{elapsed:s.elapsed+.05,distance:s.distance+1,altitude:0,touchdownPulse:1});
  t.event('land',{verticalSpeed:-.2,rollAngle:0,assisted:true},s);
  assert.equal(t.snapshot().landings,1);assert.equal(t.snapshot().precisionLandings,1);
});

test('production touchdown and barrier contact in the same substep cannot earn precision',()=>{
  let game;const t=new RunTelemetry(),events=[];
  game=new Game({random:()=>.5,onEvent:(name,payload)=>{
    events.push(name);if(!['impact','pass','boost-empty'].includes(name))t.event(name,payload,game.state);
  }});
  game.start();Object.assign(game.state,{traffic:[],pickups:[],obstacles:[],nextSpawn:Infinity,nextEvent:Infinity});
  const step=(controls={throttle:1})=>{game.update(1/120,controls);t.observe(game.state);};
  for(let i=0;i<1200;i++)step();
  for(let i=0;i<90;i++)step({throttle:1,flight:true});
  let injected=false;
  for(let i=0;i<600&&game.state.altitude>0;i++){
    const s=game.state;
    if(!injected&&s.altitude>.015&&s.altitude+s.verticalSpeed/120<.015){
      injected=true;Object.assign(s,{x:1,heading:0,speed:5,lateralVelocity:0,yawRate:0});
      s.obstacles=[{id:2,kind:'barrier',x:1,z:s.playerBounds.length/2+.071}];
    }
    step();
  }
  assert.equal(injected,true,'the barrier is introduced on the actual touchdown substep');
  assert.ok(events.includes('land'));assert.ok(events.includes('contact'));
  assert.equal(game.state.phase,'playing');assert.equal(t.snapshot().landings,1);
  assert.equal(t.snapshot().precisionLandings,0);
  assert.ok(Math.abs(t.snapshot().distanceM-game.state.distance)<1e-7,'contact and land callbacks retain travelled distance exactly once');
});

test('production traffic contact during low takeoff disqualifies the entire flight',()=>{
  let game;const t=new RunTelemetry(),contacts=[];
  game=new Game({random:()=>.5,onEvent:(name,payload)=>{
    if(name==='contact')contacts.push(game.state.altitude);
    if(!['impact','pass','boost-empty'].includes(name))t.event(name,payload,game.state);
  }});
  game.start();Object.assign(game.state,{traffic:[],pickups:[],obstacles:[],nextSpawn:Infinity,nextEvent:Infinity});
  const step=(controls={throttle:1})=>{game.update(1/120,controls);t.observe(game.state);};
  for(let i=0;i<1200;i++)step();
  let injected=false;
  for(let i=0;i<90;i++){
    const s=game.state;
    if(!injected&&s.altitude>0&&s.altitude<.02){
      injected=true;s.x=1.55;s.lateralVelocity=-1;
      s.traffic=[{id:1,kind:'sedan',lane:1,x:1,z:0,speed:s.speed-1,cruiseSpeed:s.speed-1}];
    }
    step({throttle:1,flight:true});if(injected)s.traffic=[];
  }
  for(let i=0;i<600&&game.state.altitude>0;i++)step();
  assert.equal(injected,true);assert.ok(contacts.some(altitude=>altitude>0&&altitude<.08));
  assert.equal(game.state.phase,'playing');assert.equal(t.snapshot().landings,1);
  assert.equal(t.snapshot().precisionLandings,0);
});
