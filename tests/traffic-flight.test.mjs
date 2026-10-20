import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { Game } from '../src/game.js';
import { createTrafficCar, installTrafficTemplates, TRAFFIC_KINDS } from '../src/traffic.js';

import { readFile } from 'node:fs/promises';
import { trafficDefinition } from '../src/traffic-catalog.js';
const models={};
for(const kind of TRAFFIC_KINDS){const b=await readFile(`public/assets/traffic/${kind}.glb`);models[kind]=(await new T.GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
installTrafficTemplates(models);

/**
 * Start a clear-road game and disable automatic waves/events.
 * The fixture retains normal starting speed and energy for flight-gate tests.
 * @returns {Game} Mutable game with no initial traffic or pickups.
 */
const make=()=>{const g=new Game();g.start();g.state.traffic=[];g.state.safeCorridor=null;g.state.pickups=[];g.state.nextSpawn=Infinity;g.state.nextEvent=Infinity;return g;};
/**
 * Advance real flight/driving physics with a maximum 1/120-second step.
 * Shortens the last update to the remaining simulated duration.
 * @param {Game} g - Fixture mutated by updates.
 * @param {number} seconds - Simulated seconds to advance.
 * @param {object} [controls={}] - Held inputs reused for every step.
 */
const advance=(g,seconds,controls={})=>{for(let t=0;t<seconds-1e-8;t+=1/120)g.update(Math.min(1/120,seconds-t),controls);};

test('eight Blender traffic models have catalog-sized bodies, shared geometry and isolated paint/brakes',()=>{
  const lengths=new Set(),heights=new Set();
  for(const kind of TRAFFIC_KINDS){
    const car=createTrafficCar(kind),other=createTrafficCar(kind,'#ff0000'),spec=trafficDefinition(kind);
    const bounds=new T.Box3().setFromObject(car),size=bounds.getSize(new T.Vector3());
    lengths.add(size.z.toFixed(2));heights.add(size.y.toFixed(2));
    assert.equal(car.userData.kind,kind);assert.equal(car.userData.category,spec.category);assert.equal(car.userData.wheels.length,spec.axles*2);
    if(car.userData.paint)assert.notEqual(car.userData.paint,other.userData.paint);
    assert.notEqual(car.userData.brakeMaterial,other.userData.brakeMaterial);
    const meshes=[],otherMeshes=[];car.traverse(n=>{if(n.isMesh)meshes.push(n);});other.traverse(n=>{if(n.isMesh)otherMeshes.push(n);});
    assert.equal(meshes[0].geometry,otherMeshes[0].geometry);
    assert.ok(size.x<=spec.width+.03,kind+' width');assert.ok(Math.abs(size.z-spec.length)<.08,kind+' length');assert.ok(bounds.max.y<=spec.height+.04,kind+' height');assert.ok(bounds.min.y>=-.01&&bounds.min.y<.04,kind+' road contact');
    assert.ok(meshes.length<=({semi:38,firetruck:36,boxtruck:26,towtruck:31}[kind]||31),kind+' draw budget');
    for(const mesh of meshes)for(const v of mesh.geometry.attributes.position.array)assert.ok(Number.isFinite(v));
    for(const wheel of car.userData.wheels){assert.ok(!wheel.isMesh);assert.ok(Math.abs(wheel.rotation.x)<1e-7);}
    if(spec.articulated){assert.ok(car.userData.trailer);assert.ok(Math.abs(car.userData.trailer.position.z-spec.hitchZ)<.001);}
  }
  assert.equal(lengths.size,8);assert.equal(heights.size,8);
});
test('hover requires speed and fuel; it rises smoothly, consumes nitro and cannot double-boost',()=>{
  const g=make();advance(g,1,{flight:true});assert.equal(g.state.altitude,0);assert.equal(g.state.nitro,60);
  g.state.speed=24;g.update(.1,{flight:true,boost:true,throttle:1});
  assert.ok(g.state.altitude>0&&g.state.altitude<.3);assert.equal(g.state.flying,true);assert.equal(g.state.boosting,false);
  advance(g,1.5,{flight:true,throttle:1});assert.equal(g.state.altitude,3.3);assert.ok(g.state.nitro<36&&g.state.nitro>33);
});
test('releasing hover lands smoothly and starts a short cooldown',()=>{
  const g=make();g.state.speed=24;advance(g,1.5,{flight:true,throttle:1});
  g.update(.1,{throttle:1});assert.equal(g.state.flying,false);assert.ok(g.state.altitude>3);
  advance(g,2.4,{throttle:1});assert.equal(g.state.altitude,0);assert.ok(g.state.flightCooldown>1.8);
  g.update(.1,{flight:true,throttle:1});assert.equal(g.state.altitude,0);assert.equal(g.state.flightReady,false);
});
test('hover clears traffic only above safety altitude and cannot collect ground pickups',()=>{
  const g=make();g.state.speed=24;g.state.altitude=3.3;g.state.nitro=50;
  g.state.traffic=[{id:1,lane:1,z:2,speed:12}];g.state.pickups=[{id:2,lane:1,z:2}];
  g.update(.1,{flight:true,throttle:1});assert.equal(g.state.phase,'playing');assert.equal(g.state.charges,0);
  const low=make();low.state.speed=24;low.state.altitude=1;low.state.traffic=[{id:1,lane:1,z:2,speed:12}];low.update(.1,{flight:true});assert.equal(low.state.traffic[0].contacted,true,'low hover must physically contact the roof');
});
test('depleted thrusters descend and revive resets all flight state',()=>{
  const g=make();g.state.speed=24;g.state.altitude=3;g.state.nitro=.1;advance(g,.2,{flight:true});assert.equal(g.state.nitro,0);assert.equal(g.state.flying,false);assert.ok(g.state.altitude<3.1);
  g.state.phase='crashed';g.revive();assert.equal(g.state.altitude,0);assert.equal(g.state.flying,false);assert.equal(g.state.flightCooldown,0);
});
test('same-lane traffic slows behind a lead vehicle and spawns avoid overlap',()=>{
  const g=make();g.state.traffic=[{id:1,lane:0,z:50,speed:7,cruiseSpeed:7},{id:2,lane:0,z:40,speed:23,cruiseSpeed:23}];
  advance(g,1);const [leader,follower]=g.state.traffic;assert.ok(follower.speed<17);assert.equal(follower.braking,true);assert.ok(leader.z-follower.z>=5.3);
  for(let i=0;i<10;i++)g.spawnWave(200,true);
  for(const a of g.state.traffic)for(const b of g.state.traffic)if(a!==b&&a.lane===b.lane)assert.ok(Math.abs(a.z-b.z)>=5.3);
});

test('airborne clearance respects taller SUV and delivery-van roofs',()=>{
  for(const [kind,altitude,clear] of [['van',1.9,false],['van',2.8,true],['suv',1.7,false],['suv',2.2,true]]){
    const g=make();g.state.speed=24;g.state.altitude=altitude;g.state.nitro=50;g.state.traffic=[{id:1,lane:1,z:2,speed:12,kind}];g.update(.01,{flight:true});assert.equal(Boolean(g.state.traffic[0].contacted),!clear,kind+' '+altitude);if(clear)assert.equal(g.state.phase,'playing');
  }
});
