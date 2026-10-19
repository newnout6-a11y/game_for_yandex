import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactGarageFraming} from '../src/garage-framing.js';
import * as T from '../public/vendor/three.js';
import {GarageScene} from '../src/garage-scene.js';
import {createOwnedVehicle} from '../src/owned-vehicles.js';
import {installTrafficTemplates,TRAFFIC_KINDS} from '../src/traffic.js';
import {garageNearPlaneCorners} from '../src/garage-camera-motion.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';

test('compact garage uses only actual clear stage above controls and dynamic title',()=>{
 const stage={x:0,y:88,width:324.8,height:203},controls={x:8,y:210.4,width:308.8,height:73.6};
 const result=compactGarageFraming({stage,controls});assert.equal(result.x,6);assert.equal(result.y,94);assert.ok(Math.abs(result.width-312.8)<1e-8&&Math.abs(result.height-110.4)<1e-8);
 const larger=compactGarageFraming({stage,controls:{...controls,y:190}});assert.equal(larger.height,90);
});
test('unlaid-out or empty regions never fabricate 60px beyond the visible stage',()=>{
 for(const input of[{}, {stage:{x:NaN,y:0,width:200,height:200},controls:{x:0,y:50,width:100,height:50}},{stage:{x:0,y:0,width:200,height:200},controls:{x:0,y:6,width:100,height:50}}])assert.equal(compactGarageFraming(input),null);
});
test('compact framing marker cannot alter HOME, driving or desktop path',async()=>{
 const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const start=source.indexOf("if(stage&&screen==='garage')"),end=source.indexOf('if(innerWidth<700)',start),slice=source.slice(start,end);
 assert.match(slice,/getPropertyValue\('--gs-compact-garage'\)/);assert.match(slice,/compactGarageFraming\(\{stage:rect,controls\}\)/);assert.match(slice,/typeof getComputedStyle==='function'/);
 assert.match(slice,/rect\.x\+20/);assert.equal((source.match(/compactGarageFraming\(/g)||[]).length,1);
});
const assets={car:(await loadRoadsterGeometry()).scene,traffic:{}};
for(const id of TRAFFIC_KINDS)assets.traffic[id]=(await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`,import.meta.url))).scene;
installTrafficTemplates(assets.traffic);const room=(await loadRoadsterGeometry(new URL('../public/assets/garage/tier1.glb',import.meta.url))).scene;
/** Actual authored bounds and room safety, with no GPU or substitute vehicle geometry. */
function showcase(id){const scene=new GarageScene({renderer:{toneMappingExposure:1,render(){}},makeVehicle:kind=>createOwnedVehicle(assets,kind)});scene.room=room;scene.ready=true;scene.tier=1;scene.setVehicle(id);return scene;}
test('all five actual car models fit compact garage clear regions across aspect, title and rear views',()=>{
 let count=0;
 for(const id of['rocket','hatch','sedan','suv','van'])for(const[w,h]of[[560,315],[667,375],[844,390],[480,270],[844,270],[320,240]])for(const fontScale of[1,1.5]){
  const panel=Math.min(320,Math.max(190,w*.42)),top=44,title=18*1.08*fontScale,stage={x:0,y:top,width:w-panel,height:h-top-44},controls={x:8,y:h-44-7-34-4-title,width:w-panel-16,height:34+4+title};
  const region=compactGarageFraming({stage,controls});assert.ok(region,`${w}/${fontScale}`);
  for(const view of['overview','rear']){const scene=showcase(id);scene.setInspection(view);scene.advance(2,{reducedMotion:true});scene.render(w,h,region);const {camera,cameraContext:c}=scene;
   for(const p of c.points){const point=p.clone().project(camera),x=(point.x+1)*w/2,y=(1-point.y)*h/2;assert.ok(x>=region.x-.1&&x<=region.x+region.width+.1&&y>=region.y-.1&&y<=region.y+region.height+.1,`${id}/${w}/${view}: full car fits`);}
   for(const p of[camera.position,...garageNearPlaneCorners(camera)])assert.ok(c.limits.bounds.containsPoint(p),'camera and near-plane stay in room');count++;
  }
 }
 assert.equal(count,120);
});

// Actual 480×270 iframe with 150% text and the 44px guest footer.
test('a small positive measured stage never falls back beneath inspection controls',()=>{
 const stage={x:0,y:88,width:278.40625,height:138},controls={x:8,y:139.84375,width:262.40625,height:79.15625};
 const region=compactGarageFraming({stage,controls});assert.ok(region);assert.equal(region.height,39.84375);assert.ok(region.y+region.height<controls.y);
 for(const id of ['rocket','hatch','sedan','suv','van']){
  const scene=showcase(id);scene.advance(2,{reducedMotion:true});scene.render(480,270,region);
  for(const p of scene.cameraContext.points){const q=p.clone().project(scene.camera),x=(q.x+1)*240,y=(1-q.y)*135;assert.ok(x>=region.x-.1&&x<=region.x+region.width+.1&&y>=region.y-.1&&y<=region.y+region.height+.1,id+' actual projection uses the measured small region');}
 }
});
