import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import {homeVehicleFraming} from '../src/home-framing.js';
import {GarageScene} from '../src/garage-scene.js';
import {createOwnedVehicle} from '../src/owned-vehicles.js';
import {installTrafficTemplates,TRAFFIC_KINDS} from '../src/traffic.js';
import {garageNearPlaneCorners} from '../src/garage-camera-motion.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';

/** Measured-layout-shaped CSS-pixel fixture; larger type changes actual rects, not device resolution. */
function layout(width=560,height=315,scale=1){return {width,height,header:{x:0,y:0,width,height:52},route:{x:14,y:62,width:172*scale,height:44},label:{x:width-14-240,y:66,width:240,height:19.2*scale},actions:{x:14,y:height-84,width:238*scale,height:44},footer:{x:0,y:height-28,width,height:28}};}

test('HOME framing uses the clear measured side area, not a fixed percentage strip',()=>{
 const input=layout(),r=homeVehicleFraming(input);assert.deepEqual(r,{x:260,y:93.2,width:286,height:185.8});
 assert.ok(r.height>input.height*.265*1.5);assert.ok(r.x>=input.route.x+input.route.width);assert.ok(r.y>=input.label.y+input.label.height);assert.ok(r.x>=input.actions.x+input.actions.width);assert.ok(r.y+r.height<input.footer.y);
});
test('HOME fit follows iframe size, enlarged labels and a taller guest footer',()=>{
 for(const [w,h]of [[560,315],[667,375],[844,390],[667,300]])for(const scale of [1,1.25,1.5]){
  const input=layout(w,h,scale),r=homeVehicleFraming(input);assert.ok(r);assert.ok(r.x+r.width<=w&&r.y+r.height<input.footer.y);assert.ok(r.y>=input.label.y+input.label.height);
  const guest=homeVehicleFraming({...input,actions:{...input.actions,y:input.actions.y-16},footer:{...input.footer,y:input.footer.y-16}});assert.ok(guest.height<r.height);assert.ok(guest.y+guest.height<input.footer.y-16);
 }
});
test('text-heavy narrow HOME falls below the route rather than overlapping it',()=>{
 const input=layout();input.route.width=340;const r=homeVehicleFraming(input);assert.equal(r.x,14);assert.ok(r.y>=input.route.y+input.route.height+8);
});
test('320px iframe keeps a real clear vehicle rectangle beside full route text and 44px controls',()=>{
 for(const height of [180,240])for(const scale of [1,1.5]){
  const input={width:320,height,header:{x:0,y:0,width:320,height:height===180?46:53},label:{x:0,y:0,width:0,height:0},route:{x:8,y:height===180?46:63,width:169*scale,height:44},actions:{x:8,y:height-72,width:176*scale,height:44},footer:{x:0,y:height-28,width:320,height:28}};
  const r=homeVehicleFraming(input);assert.ok(r);assert.ok(r.width>=32&&r.height>=32);
  assert.ok(r.x>=input.route.x+input.route.width||r.y>=input.route.y+input.route.height);
  assert.ok(r.x>=input.actions.x+input.actions.width||r.y+r.height<=input.actions.y);
  assert.ok(r.y>=input.header.height&&r.y+r.height<=input.footer.y);
 }
});
test('normal desktop, portrait and unavailable geometry retain the established camera',()=>{
 for(const [w,h]of [[1440,900],[1024,768],[390,844],[315,560],[0,0],[Infinity,315],[560,NaN]])assert.equal(homeVehicleFraming(layout(w,h)),null);
 assert.equal(homeVehicleFraming({...layout(),label:null}),null);assert.equal(homeVehicleFraming({...layout(),route:{x:NaN,y:62,width:100,height:44}}),null);
 assert.equal(homeVehicleFraming({...layout(),actions:{x:0,y:90,width:550,height:44},footer:{x:0,y:110,width:560,height:28}}),null);
});
test('controller calls mobile framing only for HOME; results and garage keep their existing paths',async()=>{
 const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(source,/if\(screen==='hub'\)\{[\s\S]*?return homeVehicleFraming\(/);
 assert.match(source,/if\(stage&&screen==='garage'\)/);assert.match(source,/if\(innerWidth<700\)return\{x:18,y:innerHeight\*\.29,width:innerWidth-36,height:innerHeight\*\.265\}/);
 assert.equal((source.match(/homeVehicleFraming\(/g)||[]).length,1);
});

const assets={car:(await loadRoadsterGeometry()).scene,traffic:{}};
for(const id of TRAFFIC_KINDS)assets.traffic[id]=(await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`,import.meta.url))).scene;
installTrafficTemplates(assets.traffic);
const room=(await loadRoadsterGeometry(new URL('../public/assets/garage/tier1.glb',import.meta.url))).scene;
/** Create the real showcase pipeline without a GPU; room geometry and all five car bodies are unchanged. */
function showcase(id){const scene=new GarageScene({renderer:{toneMappingExposure:1,render(){}},makeVehicle:kind=>createOwnedVehicle(assets,kind)});scene.room=room;scene.ready=true;scene.tier=1;scene.setVehicle(id);return scene;}

test('all five actual models remain fully framed and camera-safe in compact HOME and enlarged type',()=>{
 let poses=0;
 for(const id of ['rocket','hatch','sedan','suv','van'])for(const [w,h]of [[560,315],[667,375],[844,390],[667,300]])for(const scale of [1,1.5]){
  const scene=showcase(id),r=homeVehicleFraming(layout(w,h,scale));
  for(const yaw of [-.63,0,Math.PI/2,Math.PI]){
   scene.yaw=yaw;scene.render(w,h,r);const {camera, cameraContext:c}=scene;
   for(const point of c.points){const p=point.clone().project(camera),x=(p.x+1)*w/2,y=(1-p.y)*h/2;assert.ok(x>=r.x-.01&&x<=r.x+r.width+.01&&y>=r.y-.01&&y<=r.y+r.height+.01,`${id}/${w}/${scale}: complete body`);}
   for(const p of [camera.position,...garageNearPlaneCorners(camera)]){assert.ok(c.limits.bounds.containsPoint(p));assert.ok(!c.vehicleBounds.containsPoint(p));for(const box of c.limits.obstacles)assert.ok(!box.containsPoint(p));}poses++;
  }
 }
 assert.equal(poses,160);
});
test('all five models stay clear with returning-player actions and the tall guest footer at320px',()=>{
 for(const id of ['rocket','hatch','sedan','suv','van'])for(const height of [180,240])for(const scale of [1,1.5]){
  const header=height===180?46:53,footerY=height-44,actionY=footerY-44-(height===180?0:12);
  const input={width:320,height,header:{x:0,y:0,width:320,height:header},label:{x:0,y:0,width:0,height:0},route:{x:8,y:header+(height===180?0:10),width:scale===1?169:223,height:44},actions:{x:8,y:actionY,width:scale===1?211:302,height:44},footer:{x:0,y:footerY,width:320,height:44}};
  const region=homeVehicleFraming(input);assert.ok(region,`${id}/${height}/${scale}: bounded guest fit`);
  const scene=showcase(id);scene.yaw=-.63;scene.render(320,height,region);
  for(const point of scene.cameraContext.points){const p=point.clone().project(scene.camera),x=(p.x+1)*160,y=(1-p.y)*height/2;assert.ok(x>=region.x-.01&&x<=region.x+region.width+.01&&y>=region.y-.01&&y<=region.y+region.height+.01);assert.ok(x>=input.route.x+input.route.width||y>=input.route.y+44);assert.ok(x>=input.actions.x+input.actions.width||y<=actionY);assert.ok(y>=header&&y<=footerY);}
 }
});
test('narrow HOME Rocket framing is genuinely larger without moving or rescaling the authored car',()=>{
 for(const [w,h]of [[560,315],[667,375]]){
  const scene=showcase('rocket'),position=scene.vehicle.position.clone(),scale=scene.vehicle.scale.clone();
  const size=()=>{const xs=scene.cameraContext.points.map(p=>p.clone().project(scene.camera).x);return Math.max(...xs)-Math.min(...xs);};
  scene.render(w,h,{x:18,y:h*.29,width:w-36,height:h*.265});const before=size();scene.render(w,h,homeVehicleFraming(layout(w,h)));
  assert.ok(size()/before>=1.5);assert.ok(scene.vehicle.position.equals(position));assert.ok(scene.vehicle.scale.equals(scale));
 }
});
