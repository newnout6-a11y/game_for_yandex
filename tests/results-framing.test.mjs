import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resultsVehicleFraming} from '../src/results-framing.js';
import {homeVehicleFraming} from '../src/home-framing.js';
import {compactGarageFraming} from '../src/garage-framing.js';
const fixture={width:551,height:360,stage:{x:10,y:140,width:277,height:158}};
test('Results camera uses the actual clear stage with a small safe inset',()=>{
 assert.deepEqual(resultsVehicleFraming(fixture),{x:12,y:142,width:273,height:154});
 for(const [w,h] of [[551,360],[560,315],[667,375],[844,390],[1100,620]]){
  const stage={x:10,y:140,width:w*.48,height:h-202},r=resultsVehicleFraming({width:w,height:h,stage});
  assert.ok(r);assert.equal(r.x,12);assert.equal(r.y,142);assert.equal(r.y+r.height,stage.y+stage.height-2);
 }
});
test('Results frames fail closed for unavailable, tiny and malformed regions; desktop/portrait unchanged',()=>{
 for(const stage of [null,undefined,{},false,{...fixture.stage,width:0},{...fixture.stage,height:40},{...fixture.stage,x:NaN},{...fixture.stage,y:Infinity},{...fixture.stage,width:'277'}])assert.equal(resultsVehicleFraming({...fixture,stage}),null);
 for(const [width,height]of [[1440,900],[1101,500],[900,621],[360,551],[500,500],[0,315],[Infinity,315],[551,NaN]])assert.equal(resultsVehicleFraming({...fixture,width,height}),null);
 assert.deepEqual(resultsVehicleFraming({...fixture,stage:{x:-10,y:-10,width:300,height:300}}),{x:2,y:2,width:286,height:286});
});
const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8'),start=source.indexOf('function garageFraming(){'),end=source.indexOf("byId('garageShell').addEventListener('garage-layout-change'",start);
const controller=new Function('screen','innerWidth','innerHeight','document','homeVehicleFraming','compactGarageFraming','resultsVehicleFraming','byId','getComputedStyle',source.slice(start,end)+';return garageFraming();');
function frame(screen,width=551,height=360,stage=fixture.stage){return controller(screen,width,height,{querySelector:s=>s==='.gs-results-stage'&&stage?{getBoundingClientRect:()=>stage}:null},homeVehicleFraming,compactGarageFraming,resultsVehicleFraming,()=>({}),()=>({getPropertyValue:()=>''}));}
test('production controller uses Results-only stage and preserves the fallback for absent measurements',()=>{
 assert.deepEqual(frame('results'),resultsVehicleFraming(fixture));
 const fallback={x:18,y:360*.29,width:515,height:360*.265};
 for(const screen of ['hub','garage','playing','paused'])assert.deepEqual(frame(screen),fallback);
 assert.deepEqual(frame('results',551,360,null),fallback);
 assert.equal(frame('results',1440,900),null);
});

import {GarageScene} from '../src/garage-scene.js';
import {createOwnedVehicle} from '../src/owned-vehicles.js';
import {installTrafficTemplates,TRAFFIC_KINDS} from '../src/traffic.js';
import {garageNearPlaneCorners} from '../src/garage-camera-motion.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';
const assets={car:(await loadRoadsterGeometry()).scene,traffic:{}};
for(const id of TRAFFIC_KINDS)assets.traffic[id]=(await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`,import.meta.url))).scene;
installTrafficTemplates(assets.traffic);
const room=(await loadRoadsterGeometry(new URL('../public/assets/garage/tier1.glb',import.meta.url))).scene;
test('all five actual cars stay wholly inside the Results stage and outside room obstacles',()=>{
 for(const id of ['rocket','hatch','sedan','suv','van'])for(const [width,height,stageHeight]of [[551,360,155],[560,315,110],[560,315,64],[844,390,185]]){
  const scene=new GarageScene({renderer:{toneMappingExposure:1,render(){}},makeVehicle:kind=>createOwnedVehicle(assets,kind)});scene.room=room;scene.ready=true;scene.tier=1;scene.setVehicle(id);
  const region=resultsVehicleFraming({width,height,stage:{x:10,y:height-60-stageHeight,width:width*.5,height:stageHeight}}),scale=scene.vehicle.scale.clone(),position=scene.vehicle.position.clone();assert.ok(region);scene.render(width,height,region,{stableOrbit:false});
  const {camera,cameraContext:c}=scene;for(const point of c.points){const p=point.clone().project(camera),x=(p.x+1)*width/2,y=(1-p.y)*height/2;assert.ok(x>=region.x-.01&&x<=region.x+region.width+.01&&y>=region.y-.01&&y<=region.y+region.height+.01,`${id}/${width}/${stageHeight} framed`);}
  for(const p of [camera.position,...garageNearPlaneCorners(camera)]){assert.ok(c.limits.bounds.containsPoint(p));assert.ok(!c.vehicleBounds.containsPoint(p));for(const box of c.limits.obstacles)assert.ok(!box.containsPoint(p));}
  assert.ok(scene.vehicle.position.equals(position));assert.ok(scene.vehicle.scale.equals(scale));scene.dispose();
 }
});
