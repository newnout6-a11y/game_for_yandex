import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { renderDimensions,textureAnisotropy } from '../src/render-settings.js';
import { RoadRenderer,roadBend } from '../src/world.js';

test('render surface follows desktop aspect while reducing old square pixel count',()=>{
 const s=renderDimensions(1440,900,1,false);assert.deepEqual([s.width,s.height],[1440,900]);assert.ok(s.width*s.height<1280**2);
});
test('portrait retina gets more vertical detail without wasted square width',()=>{
 const s=renderDimensions(390,844,3,true);assert.deepEqual([s.width,s.height],[585,1266]);assert.ok(s.width*s.height<929**2);assert.ok(Math.abs(s.width/s.height-390/844)<.001);
});
test('large displays respect pixel and edge budgets; orientation stays correct',()=>{
 for(const[w,h,compact]of[[3840,2160,false],[2160,3840,true],[844,390,true]]){
  const s=renderDimensions(w,h,4,compact);assert.ok(s.width*s.height<(compact?802000:1602000));assert.ok(Math.max(s.width,s.height)<=2048);assert.ok(Math.abs(s.width/s.height-w/h)<.005);
 }
 for(const d of [0,NaN,Infinity]){const s=renderDimensions(d,d,d);assert.ok(s.width>=1&&s.height>=1);}
});
test('anisotropy is bounded by hardware and mobile texture cost tier',()=>{
 assert.equal(textureAnisotropy(16),8);assert.equal(textureAnisotropy(16,true),4);assert.equal(textureAnisotropy(2),2);assert.equal(textureAnisotropy(NaN),1);
});
test('road markings share one instanced draw without losing dashes or strip bounds',()=>{
 const w=Object.create(RoadRenderer.prototype);w.scene=new T.Scene();w.assets={asphalt:new T.Texture(),asphaltNormal:new T.Texture(),ground:new T.Texture()};w.buildRoad();
 assert.equal(w.dashes.isInstancedMesh,true);assert.equal(w.dashes.count,118);assert.equal(w.dashSeeds.length,118);assert.equal(w.scene.children.length,6);
 assert.equal(w.dashes.instanceMatrix.usage,T.DynamicDrawUsage);
 for(const strip of w.strips)assert.ok(strip.geometry.boundingSphere.radius>=440);
});
test('cached road bend preserves exact shape for changing and repeated distances',()=>{
 for(const d of [0,100,100,1e7,100,-300])for(const z of [-650,-200,-1,0,5])assert.equal(roadBend(z,d),Math.sin(d/1100+.35)*.00055*Math.min(z,0)**2);
});
test('resize reallocates only when the viewport render dimensions actually change',()=>{
 const names=['innerWidth','innerHeight','devicePixelRatio','matchMedia'];const old=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 try{
 Object.assign(globalThis,{innerWidth:1440,innerHeight:900,devicePixelRatio:1,/** Force the desktop media-query result for the resize regression fixture. */ matchMedia:()=>({matches:false})});
 const w=Object.create(RoadRenderer.prototype);w.canvas={style:{},width:1280,height:1280};let changes=0;w.renderer={/** Count backing-surface resizes and copy requested pixel dimensions onto the fake canvas. */ setSize:(width,height)=>{changes++;Object.assign(w.canvas,{width,height});}};w.camera={/** Accept projection refreshes without WebGL; this test inspects camera aspect and resize count. */ updateProjectionMatrix(){}};
 w.resize();w.resize();assert.equal(changes,1);assert.equal(w.camera.aspect,1.6);assert.equal(w.canvas.width,1440);assert.equal(w.canvas.height,900);
 globalThis.innerWidth=900;globalThis.innerHeight=1440;w.resize();assert.equal(changes,2);assert.equal(w.camera.aspect,.625);assert.equal(w.canvas.width,900);assert.equal(w.canvas.height,1440);
 }finally{for(const k of names){if(old[k])Object.defineProperty(globalThis,k,old[k]);else delete globalThis[k];}}
});
test('settled paused scene does not submit a duplicate frame',()=>{
 const w=Object.create(RoadRenderer.prototype);Object.assign(w,{loaded:true,wasPaused:true,pausedFor:1,needsRender:false,particles:[],impact:0});
 assert.doesNotThrow(()=>w.render({}, {paused:true,dt:1/60}));
});

test('immediate retry recycles traffic even when a new run reuses the same numeric IDs',()=>{
 const w=Object.create(RoadRenderer.prototype),oldState={traffic:[]},nextState={traffic:[]};
 Object.assign(w,{scene:new T.Scene(),traffic:new Map(),trafficPool:new Map(),trafficState:oldState});
 const sedan=new T.Group();sedan.userData.kind='sedan';w.scene.add(sedan);w.traffic.set(1,sedan);
 w.syncTrafficState(oldState);assert.equal(w.traffic.get(1),sedan,'ordinary frames retain their mesh');
 w.syncTrafficState(nextState);assert.equal(w.traffic.size,0);assert.equal(sedan.parent,null);assert.deepEqual(w.trafficPool.get('sedan'),[sedan]);
 assert.equal(w.trafficForItem(1,'semi'),undefined,'new semi cannot inherit the old sedan');
 w.syncTrafficState(nextState);assert.equal(w.trafficPool.get('sedan').length,1,'recycling happens once');
});
test('same-ID kind replacement returns the old model to its own pool before creating its successor',()=>{
 const w=Object.create(RoadRenderer.prototype);Object.assign(w,{scene:new T.Scene(),traffic:new Map(),trafficPool:new Map()});
 const truck=new T.Group();truck.userData.kind='boxtruck';w.scene.add(truck);w.traffic.set(2,truck);
 assert.equal(w.trafficForItem(2,'boxtruck'),truck);
 assert.equal(w.trafficForItem(2,'firetruck'),undefined);assert.equal(w.traffic.has(2),false);
 assert.deepEqual(w.trafficPool.get('boxtruck'),[truck]);assert.equal(w.trafficPool.has('firetruck'),false);
});
