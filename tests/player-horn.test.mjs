import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { Game } from '../src/game.js';
import { DrivingInput } from '../src/input.js';
import { HORN, updatePlayerHorn, playerHighBeam } from '../src/player-horn.js';
import { createPlayerHeadlights } from '../src/player-headlights.js';
import { GameAudio } from '../src/audio.js';

test('horn and beam share one pulse; holding and cooldown presses cannot queue repeated requests',()=>{
 const state={phase:'playing'},events=[];
 assert.equal(updatePlayerHorn(state,true,1/120,(...e)=>events.push(e)),true);
 assert.equal(playerHighBeam(state),1);assert.equal(state.hornSerial,1);
 for(let i=0;i<360;i++)updatePlayerHorn(state,true,1/120,(...e)=>events.push(e));
 assert.equal(state.hornTime,0);assert.equal(events.length,1);
 updatePlayerHorn(state,false,0);updatePlayerHorn(state,true,0,(...e)=>events.push(e));assert.equal(events.length,2);
 updatePlayerHorn(state,false,.1);updatePlayerHorn(state,true,.1,(...e)=>events.push(e));
 updatePlayerHorn(state,true,2,(...e)=>events.push(e));assert.equal(events.length,2,'rejected held press is not deferred');
});

test('horn state is deterministic across update frame rates and freezes outside active simulation',()=>{
 const snapshots=[];
 for(const fps of [30,60,120]){
  const events=[],game=new Game({onEvent:e=>events.push(e)});game.start();game.state.nextSpawn=Infinity;game.state.nextEvent=Infinity;game.state.traffic=[];
  for(let i=0;i<fps/4;i++)game.update(1/fps,{horn:true});
  const frozen=game.state.hornTime;game.state.phase='paused';game.update(2,{horn:true});assert.equal(game.state.hornTime,frozen);
  game.state.phase='playing';game.releaseControls();game.update(1/120,{horn:false});
  snapshots.push({time:game.state.hornTime,serial:game.state.hornSerial,events:events.filter(e=>e==='horn').length});
 }
 // Use exact common simulation duration for the equivalence assertion.
 for(const fps of [30,60,120]){const s={phase:'playing'};updatePlayerHorn(s,true,0);for(let i=0;i<fps;i++)updatePlayerHorn(s,true,1/fps);assert.equal(s.hornTime,0);assert.equal(s.hornSerial,1);}
 assert.ok(snapshots.every(s=>s.serial===1&&s.events===1));
 assert.equal(playerHighBeam({phase:'menu',hornTime:HORN.duration}),0);
 assert.equal(updatePlayerHorn({phase:'ready'},true,1/60),false);
});

for(const [label,stepsBeforeCrash] of [['active horn',12],['cooldown tail',84]]){
 test(`revive following ${label} resets cooldown without bypassing normal press and phase rules`,()=>{
  const horns=[],game=new Game({onEvent:(event,serial)=>{if(event==='horn')horns.push(serial);}});
  game.start();const s=game.state,dt=1/120;
  s.traffic=[];s.nextSpawn=Infinity;s.nextEvent=Infinity;
  for(let i=0;i<stepsBeforeCrash;i++)game.update(dt,{horn:true});
  assert.deepEqual(horns,[1]);assert.ok(s.hornCooldown>0);
  assert.equal(s.hornTime>0,label==='active horn');
  const cooldown=s.hornCooldown;
  assert.equal(game.revive(),false,'an ineligible revive must not clear cooldown');
  assert.equal(s.hornCooldown,cooldown);

  game.update(dt,{horn:true});game.crash(); // Lifecycle fixture, not a zero-speed lethal-overlap rule.
  assert.equal(s.phase,'crashed');assert.equal(s.hornHeld,true);
  const frozen={time:s.hornTime,cooldown:s.hornCooldown};
  game.update(2,{horn:false});
  assert.deepEqual({time:s.hornTime,cooldown:s.hornCooldown},frozen);
  assert.equal(game.revive(),true);
  assert.equal(s.hornTime,0);assert.equal(s.hornCooldown,0);assert.equal(s.hornHeld,false);
  assert.equal(s.hornSerial,1,'revive preserves monotonically increasing request IDs');

  s.phase='paused';game.update(2,{horn:true});
  assert.equal(s.hornCooldown,0);assert.equal(s.hornHeld,false);assert.deepEqual(horns,[1]);
  s.phase='playing';game.update(dt,{horn:true});
  assert.deepEqual(horns,[1,2],'the first valid post-revive press emits exactly once');
  assert.equal(s.hornTime,HORN.duration);assert.equal(s.hornCooldown,HORN.cooldown);
  assert.equal(playerHighBeam(s),1);
  s.phase='paused';game.update(2,{horn:false});
  assert.equal(s.hornTime,HORN.duration);assert.equal(s.hornCooldown,HORN.cooldown);
  s.phase='playing';game.update(dt,{horn:false});game.update(dt,{horn:true});
  assert.deepEqual(horns,[1,2],'a second press during the new cooldown is rejected');
  for(let i=0;i<240;i++)game.update(dt,{horn:true});
  assert.equal(s.hornTime,0);assert.equal(s.hornCooldown,0);
  assert.deepEqual(horns,[1,2],'a rejected held press is not queued after cooldown');
  game.update(dt,{horn:false});game.update(dt,{horn:true});
  assert.deepEqual(horns,[1,2,3],'a fresh press after cooldown still works');
 });
}

test('horn input retains independent keyboard/touch ownership and clears at lifecycle boundaries',()=>{
 const input=new DrivingInput();assert.equal(input.key('KeyH',true),true);assert.equal(input.read().horn,true);
 input.set('horn','finger',true);input.key('KeyH',false);assert.equal(input.read().horn,true);
 input.release('finger');assert.equal(input.read().horn,false);input.key('KeyH',true);input.clear();assert.equal(input.read().horn,false);
});

test('headlamp instances preserve authored materials and add only two shadow-free lights with no geometry',()=>{
 const source=new T.MeshStandardMaterial({name:'LED_white',emissive:'#bfdfff',emissiveIntensity:.7});
 const car=new T.Group(),other=new T.Group();
 for(const x of [-.7,.7]){const lens=new T.Mesh(new T.BoxGeometry(.2,.04,.04),source);lens.position.set(x,.65,-2.1);car.add(lens);other.add(lens.clone());}
 let meshes=0;car.traverse(n=>{if(n.isMesh)meshes++;});
 const signals=createPlayerHeadlights(car);assert.equal(signals.lights.length,2);assert.equal(signals.materials.length,1);
 assert.equal(createPlayerHeadlights(car),signals);signals.update({phase:'playing',hornTime:.4});
 assert.equal(source.emissiveIntensity,.7);assert.equal(other.children[0].material,source);
 for(const lamp of signals.lights){assert.equal(lamp.castShadow,false);assert.ok(lamp.intensity>0);assert.ok(lamp.target.position.z<lamp.position.z-30);}
 signals.update({phase:'ready'});assert.equal(signals.materials[0].material.emissiveIntensity,.7);assert.ok(signals.lights.every(l=>l.intensity===0));
 let after=0;car.traverse(n=>{if(n.isMesh)after++;});assert.equal(after,meshes);
});

test('horn sound uses the lifecycle-muted master rather than an independent audible destination',()=>{
 const connections=[],stops=[],value={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};
 const make=()=>({gain:value,frequency:{value:0},connect(target){connections.push(target);return target;},disconnect(){},start(){},stop(t){stops.push(t);}});
 const audio=new GameAudio(true);audio.master=make();audio.context={currentTime:7,createGain:make,createBiquadFilter:make,createOscillator:make,destination:{name:'destination'}};
 audio.tone('horn');assert.equal(stops.length,2);assert.ok(stops.every(t=>t>7&&t<7.6));assert.ok(connections.includes(audio.master));assert.ok(!connections.includes(audio.context.destination));
 audio.enabled=false;audio.tone('horn');assert.equal(stops.length,2);
});
