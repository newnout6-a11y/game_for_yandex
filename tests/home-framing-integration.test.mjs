import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resultsVehicleFraming} from '../src/results-framing.js';
import {homeVehicleFraming} from '../src/home-framing.js';
import {compactGarageFraming} from '../src/garage-framing.js';

const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function garageFraming(){');
const end=source.indexOf("byId('garageShell').addEventListener('garage-layout-change'",start);
assert.ok(start>=0&&end>start);
const controller=new Function('screen','innerWidth','innerHeight','document','homeVehicleFraming','compactGarageFraming','resultsVehicleFraming','byId','getComputedStyle',source.slice(start,end)+';return garageFraming();');
/** Execute the production controller with measured DOM-shaped rectangles, not a duplicated fallback. */
function frame(width,height,{screen='hub',missing,invalid,stage}={}){
 const rects={'.gs-header':{x:0,y:0,width,height:52},'.gs-route-cell':{x:14,y:62,width:172,height:44},'.gs-hero-vehicle':{x:width-254,y:66,width:240,height:19.2},'.gs-hub-actions':{x:14,y:height-84,width:238,height:44},'.gs-footer':{x:0,y:height-28,width,height:28}};
 for(const selector of [].concat(missing||[]))delete rects[selector];if(invalid)rects[invalid]={...rects[invalid],x:NaN};
 const document={querySelector(selector){if(selector==='.gs-stage')return stage||null;return rects[selector]?{getBoundingClientRect:()=>rects[selector]}:null;}};
 return controller(screen,width,height,document,homeVehicleFraming,compactGarageFraming,resultsVehicleFraming,()=>({}),()=>({getPropertyValue:()=>''}));
}
const fallback=(width,height)=>({x:18,y:height*.29,width:width-36,height:height*.265});

test('actual HOME controller retains the narrow desktop portrait band when compact measured framing is inapplicable',()=>{
 for(const [width,height]of [[390,844],[560,800],[600,600],[699,900]])assert.deepEqual(frame(width,height),fallback(width,height));
 for(const [width,height]of [[700,900],[1440,900],[1024,768]])assert.equal(frame(width,height),null);
});
test('actual HOME controller falls through on missing required or invalid measured rectangles',()=>{
 for(const selector of ['.gs-header','.gs-route-cell','.gs-hub-actions'])for(const absentLabel of [false,true]){
  const missing=absentLabel?[selector,'.gs-hero-vehicle']:selector;
  assert.deepEqual(frame(560,315,{missing}),fallback(560,315));
  assert.equal(frame(844,390,{missing}),null);
 }
 for(const selector of ['.gs-header','.gs-route-cell','.gs-hero-vehicle','.gs-hub-actions']){
  assert.deepEqual(frame(667,375,{invalid:selector}),fallback(667,375));
  assert.equal(frame(844,390,{invalid:selector}),null);
 }
});
test('actual HOME controller retains bounded measured framing when the vehicle label is removed',()=>{
 for(const [width,height]of [[551,360],[560,315],[667,375],[844,390]]){
  const old=frame(width,height),now=frame(width,height,{missing:'.gs-hero-vehicle'});
  assert.deepEqual(now,{x:width*.15,y:108,width:width-14-width*.15,height:height-194});
  assert.notDeepEqual(now,fallback(width,height));assert.ok(now.x<old.x);
  assert.ok((now.x+now.width/2)/width>=.55&&(now.x+now.width/2)/width<=.60);
  assert.equal(now.y+now.height,height-86);
  const withoutFooter=frame(width,height,{missing:['.gs-hero-vehicle','.gs-footer']});
  assert.deepEqual(withoutFooter,now);
 }
 for(const [width,height]of [[390,844],[560,800],[600,600]])assert.deepEqual(frame(width,height,{missing:'.gs-hero-vehicle'}),fallback(width,height));
 for(const [width,height]of [[700,900],[1440,900],[1024,768]])assert.equal(frame(width,height,{missing:'.gs-hero-vehicle'}),null);
});
test('available compact HOME measurements still take precedence over the legacy band',()=>{
 for(const [width,height]of [[560,315],[667,375],[844,390]]){
  const result=frame(width,height);assert.ok(result);assert.notDeepEqual(result,fallback(width,height));
  assert.ok(result.x>=260&&result.y>=93.2);assert.ok(result.x+result.width<=width&&result.y+result.height<height-28);
 }
});
test('other screens retain their own established framing without adopting the HOME branch',()=>{
 for(const screen of ['results','playing','paused'])assert.deepEqual(frame(560,315,{screen}),fallback(560,315));
 const stage={getBoundingClientRect:()=>({x:100,y:80,width:500,height:400,top:80,bottom:480}),querySelector:()=>null};
 assert.deepEqual(frame(560,800,{screen:'garage',stage}),{x:120,y:162,width:460,height:251});
});


test('actual HOME controller uses the reclaimed bottom when the footer is intentionally absent',()=>{
 for(const [width,height]of [[551,360],[560,315],[667,375],[844,390]]){
  const old=frame(width,height),now=frame(width,height,{missing:'.gs-footer'});
  assert.ok(now);assert.notDeepEqual(now,fallback(width,height));assert.equal(now.x,old.x);assert.equal(now.y,old.y);
  assert.ok(now.height>old.height);assert.ok(now.y+now.height<=height-8);
  assert.deepEqual(frame(width,height,{invalid:'.gs-footer'}),width<700?fallback(width,height):null);
 }
});
