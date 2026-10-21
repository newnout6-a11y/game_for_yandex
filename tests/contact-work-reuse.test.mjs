import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Game} from '../src/game.js';
import {FLEET} from '../src/progression-catalog.js';

// The reference differs ONLY by disabling the rail broadphase. Both execute the
// real resolver, roll slices, earliest-TOI logic, impulses and final bookkeeping.
// Counters are injected only into this test module, never shipped in runtime.
const url=new URL('../src/vehicle-contacts.js',import.meta.url);
const source=await readFile(url,'utf8');
const gate="if(other.kind==='rail'&&(other.body.x>0?playerMaxX<CONTACT_TUNING.railInner:playerMinX>-CONTACT_TUNING.railInner))continue;";
assert.equal(source.split(gate).length,2,'one conservative rail gate');
async function instrument(skip){
 let text=(skip?source:source.replace(gate,'')).replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,url).href}'`);
 text='export const counts={project:0,shape:0,vertical:0,sweep:0};\n'+text;
 for(const [signature,key]of [["function projectPart(p,roll,out={}){",'project'],["function shapeAt(actor,part,seconds,fraction,out,projected){",'shape'],["function verticalInterval(before,after,part,height,from,to,dt,out,projected){",'vertical']]){
  assert.ok(text.includes(signature));text=text.replace(signature,signature+`counts.${key}++;`);
 }
 text=text.replace('const hit=sweepOBB(a0,a1,b0,b1,out);','counts.sweep++;const hit=sweepOBB(a0,a1,b0,b1,out);');
 return import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
}
const optimized=await instrument(true),reference=await instrument(false);
const reset=module=>Object.keys(module.counts).forEach(k=>module.counts[k]=0);
function state(){const g=new Game({random:()=>.5});g.start();Object.assign(g.state,{traffic:[],obstacles:[],pickups:[],distance:3070,speed:30,forwardVelocity:30,sceneTravel:0,nextSpawn:Infinity,nextEvent:Infinity});return g.state;}
function run(module,initial,proposal,dt=1/120,travel=.25){
 const s=structuredClone(initial),old=module.captureContactFrame(s);proposal(s);
 return{state:s,result:module.resolveVehicleContacts(s,old,dt,travel)};
}

test('empty road reuses the two compound projections and performs no distant rail narrow phase',()=>{
 const initial=state(),proposal=()=>{};reset(optimized);reset(reference);
 assert.deepEqual(run(optimized,initial,proposal),run(reference,initial,proposal));
 assert.deepEqual(optimized.counts,{project:18,shape:0,vertical:0,sweep:0});
 assert.equal(reference.counts.sweep,18);assert.equal(reference.counts.vertical,18);
});

test('vertically clear barrel roll skips distant rails without changing any slice travel or wheel clock',()=>{
 const initial=state();Object.assign(initial,{altitude:3,rollAngle:.3,heading:.1});
 const proposal=s=>{s.rollAngle=.5;s.x+=.01;s.heading=.12;};reset(optimized);reset(reference);
 assert.deepEqual(run(optimized,initial,proposal),run(reference,initial,proposal));
 assert.equal(optimized.counts.vertical,0);assert.equal(optimized.counts.shape,0);assert.ok(reference.counts.vertical>18);
});

test('whole-pivot rail bound preserves narrow-phase results across every vehicle, yaw, roll and crossing direction',()=>{
 let seed=78021;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 const models=FLEET.map(v=>({id:v.id,bounds:{width:v.widthM,height:v.heightM,length:v.lengthM}}));
 for(const model of models)for(let i=0;i<80;i++){
  const initial=state();Object.assign(initial,{vehicleId:model.id,playerBounds:model.bounds,x:1+(random()*18-9)/3.5,heading:random()*Math.PI*2-Math.PI,rollAngle:random()*Math.PI*2-Math.PI,altitude:random()*3});
  const dx=random()*1.4-.7,dh=random()*.12-.06,dr=random()*.14-.07,rise=random()*.15-.075,travel=random()*.7;
  const proposal=s=>{s.x+=dx/3.5;s.heading+=dh;s.rollAngle+=dr;s.altitude+=rise;};
  assert.deepEqual(run(optimized,initial,proposal,1/120,travel),run(reference,initial,proposal,1/120,travel),`${model.id}/${i}`);
 }
});

test('scratch records never escape into retained contacts or another simulation state',()=>{
 const a=state();a.x=1+(7.615-1.19)/3.5;
 const result=run(optimized,a,s=>{s.x+=.2/3.5;});assert.ok(result.result.contacts.some(c=>c.kind==='rail'));
 const saved=structuredClone(result);const b=state();b.x=1-(7.615-1.19)/3.5;
 run(optimized,b,s=>{s.x-=.3/3.5;});
 assert.deepEqual(result,saved);
});
