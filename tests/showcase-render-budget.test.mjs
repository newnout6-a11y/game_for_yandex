import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderDimensions} from '../src/render-settings.js';
import {RoadRenderer} from '../src/world.js';
import {UI} from '../src/ui.js';

/** Restore browser globals after each isolated renderer-policy fixture. */
function browserFixture(fn){const names=['innerWidth','innerHeight','devicePixelRatio','matchMedia','document'],old=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));try{return fn();}finally{for(const name of names)if(old[name])Object.defineProperty(globalThis,name,old[name]);else delete globalThis[name];}}

test('Android-sized showcase uses native retina pixels while the road retains its established Auto budget',()=>{
 const road=renderDimensions(551,360,2.625,true,'auto');const menu=renderDimensions(551,360,2.625,true,'auto',true);
 assert.deepEqual([road.width,road.height],[826,540]);assert.deepEqual([menu.width,menu.height],[1446,945]);
 assert.ok(menu.width*menu.height<=1600000);assert.equal(menu.scale,2.625);
});
test('parked compact budgets remain finite at high DPR, odd sizes, orientation changes and invalid input',()=>{
 for(const quality of ['auto','high','ultra'])for(const [w,h]of [[551,360],[844,390],[390,844],[320,180],[1440,900],[3840,2160],[1,6000],[Infinity,NaN]])for(const dpr of [0,1,1.25,2.625,3,8,NaN,Infinity]){
  const r=renderDimensions(w,h,dpr,true,quality,true);assert.ok(Number.isInteger(r.width)&&Number.isInteger(r.height));assert.ok(r.width>=1&&r.height>=1);assert.ok(Math.max(r.width,r.height)<=2560);assert.ok(r.width*r.height<=(quality==='auto'?1600000:2073600));
 }
});
test('desktop and explicit non-showcase calls keep previous selected-quality dimensions',()=>{
 for(const quality of ['auto','high','ultra'])for(const [w,h]of [[1440,900],[3840,2160],[600,900]])for(const dpr of [1,2,3]){
  assert.deepEqual(renderDimensions(w,h,dpr,false,quality,true),renderDimensions(w,h,dpr,false,quality));
  assert.deepEqual(renderDimensions(w,h,dpr,true,quality,false),renderDimensions(w,h,dpr,true,quality));
 }
});
test('showcase boundary preserves sharp Auto road pixels and repeat screen refreshes allocate nothing',()=>browserFixture(()=>{
 Object.assign(globalThis,{innerWidth:551,innerHeight:360,devicePixelRatio:2.625,matchMedia:()=>({matches:true})});
 const world=Object.create(RoadRenderer.prototype),reports=[];let allocations=0;
 Object.assign(world,{quality:'auto',canvas:{width:826,height:540,style:{}},renderer:{setSize(w,h){allocations++;Object.assign(world.canvas,{width:w,height:h});}},camera:{updateProjectionMatrix(){}},onRenderSettings:info=>reports.push(info)});
 world.setShowcase(true);assert.equal(allocations,1);assert.deepEqual([world.canvas.width,world.canvas.height],[1446,945]);assert.equal(reports.at(-1).showcase,true);
 world.setShowcase(true);world.resize();assert.equal(allocations,1);
 world.setShowcase(false);assert.equal(allocations,1);assert.deepEqual([world.canvas.width,world.canvas.height],[1446,945]);assert.equal(reports.at(-1).showcase,false);
 world.setShowcase(false);assert.equal(allocations,1);assert.equal(world.quality,'auto');
}));
test('graphics UI reports the actual showcase resolution and separate driving cost without promising 4K',()=>browserFixture(()=>{
 const elements=Object.fromEntries(['renderQuality','renderResolution','renderQualityHint'].map(k=>[k,{}]));globalThis.document={getElementById:id=>elements[id]};
 UI.prototype.renderSettings({quality:'auto',width:1446,height:945,compact:true,showcase:true});assert.equal(elements.renderResolution.textContent,'1446 × 945');assert.match(elements.renderQualityHint.textContent,/1,6 млн/);assert.match(elements.renderQualityHint.textContent,/В заезде/);assert.match(elements.renderQualityHint.textContent,/не 4K/);
 UI.prototype.renderSettings({quality:'auto',width:826,height:540,compact:true,showcase:false});assert.match(elements.renderQualityHint.textContent,/0,8 млн/);
}));
test('the production screen boundary selects showcase only outside playing and paused road views',async()=>{
 const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const begin=source.indexOf('function applyScreen(){'),end=source.indexOf('/** Reflect authored capabilities',begin);assert.ok(begin>=0&&end>begin);
 assert.match(source.slice(begin,end),/const driving=\['playing','paused'\]\.includes\(screen\)/);
 assert.match(source.slice(begin,end),/renderer\.setShowcase\(!driving\)/);
 assert.equal((source.match(/\.setShowcase\(/g)||[]).length,1);
});
