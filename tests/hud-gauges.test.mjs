import test from 'node:test';
import assert from 'node:assert/strict';
import {hudGaugePresentation} from '../src/hud-gauges.js';
import {UI} from '../src/ui.js';
import {Game} from '../src/game.js';
import {CONFIG} from '../src/config.js';
function render(state){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},style:{setProperty(k,v){this[k]=v;}},attrs:{},setAttribute(k,v){this.attrs[k]=v;},textContent:''});return nodes.get(id);};
 const before=globalThis.document;globalThis.document={getElementById:node};
 try{const ui=Object.create(UI.prototype),copy=structuredClone(state);ui.hud(state);assert.deepEqual(state,copy);return{id:node,ui,update(s){const prior=globalThis.document;globalThis.document={getElementById:node};try{ui.hud(s);}finally{globalThis.document=prior;}}};}
 finally{if(before===undefined)delete globalThis.document;else globalThis.document=before;}
}
function game(){const g=new Game({random:()=>.5});g.start();Object.assign(g.state,{traffic:[],pickups:[],obstacles:[],nextSpawn:Infinity,nextEvent:Infinity,speed:80/3.6,nitro:82});return g;}
test('shared reserve levels are finite, bounded and identical in both actual HUD buttons',()=>{
 const g=game();for(const value of [-10,0,12.5,82,100,120,NaN,Infinity,undefined]){
  g.state.nitro=value;const view=render(g.state),expected=Number.isFinite(value)?Math.max(0,Math.min(100,value))/100:0;
  assert.equal(view.id('boostBtn').style['--reserve-level'],String(expected));assert.equal(view.id('flightBtn').style['--reserve-level'],String(expected));assert.match(view.id('sharedEnergyStatus').textContent,/Общий запас нитро и полёта/);
 }
});
test('real boost and flight consume the same depicted reserve; pickups refill it without a separate pool',()=>{
 const g=game(),v=render(g.state);g.update(.1,{throttle:1,boost:true});assert.ok(g.state.nitro<82);v.update(g.state);assert.equal(v.id('boostBtn').style['--reserve-level'],String(g.state.nitro/100));assert.equal(v.id('flightBtn').style['--reserve-level'],v.id('boostBtn').style['--reserve-level']);
 Object.assign(g.state,{altitude:1,flying:true,verticalSpeed:0});const before=g.state.nitro;g.update(.1,{throttle:1,flight:true});assert.ok(g.state.nitro<before);v.update(g.state);assert.equal(v.id('flightBtn').style['--reserve-level'],String(g.state.nitro/100));
 Object.assign(g.state,{altitude:0,flying:false,speed:20,nitro:30,pickups:[{lane:g.state.lane,z:2.1}]});g.update(.1,{throttle:1});assert.equal(g.state.nitro,52);v.update(g.state);assert.equal(v.id('boostBtn').style['--reserve-level'],'0.52');assert.equal(v.id('flightBtn').style['--reserve-level'],'0.52');
});
test('distance car advances monotonically to the actual 1500m milestone, clamps, and never invents a new finish',()=>{
 for(const [distance,progress] of [[0,0],[375,.25],[750,.5],[1125,.75],[1500,1],[3500,1]]){
  const g=game();g.state.distance=distance;const view=render(g.state),rail=view.id('mobileGoalRail');assert.equal(rail.style['--goal-progress'],String(progress));assert.equal(rail.attrs['aria-valuenow'],String(Math.min(distance,CONFIG.goal)));assert.equal(rail.attrs['aria-valuemax'],String(CONFIG.goal));assert.equal(rail.dataset.complete,String(distance>=CONFIG.goal));
  if(distance>=CONFIG.goal)assert.match(rail.attrs['aria-valuetext'],/Заезд продолжается/);else assert.match(rail.attrs['aria-valuetext'],/до цели дистанции/);
  assert.equal(g.state.phase,'playing');
 }
});
test('actual milestone event remains one-shot and later endless distance stays at the flag',()=>{
 const events=[],g=game();g.onEvent=name=>events.push(name);Object.assign(g.state,{distance:1499.9,speed:30});g.update(.1,{throttle:1});assert.ok(g.state.distance>1500);assert.equal(g.state.goalReached,true);assert.equal(events.filter(x=>x==='goal').length,1);const state=structuredClone(g.state),v=render(g.state);assert.equal(v.id('mobileGoalRail').dataset.complete,'true');assert.deepEqual(g.state,state);g.update(.1,{throttle:1});assert.equal(events.filter(x=>x==='goal').length,1);v.update(g.state);assert.equal(v.id('mobileGoalRail').style['--goal-progress'],'1');
});
test('invalid and negative distance cannot move the car outside the rail or leak NaN into ARIA',()=>{
 for(const distance of [-10,NaN,Infinity,undefined]){const p=hudGaugePresentation({nitro:50,distance});assert.equal(p.progress,0);assert.equal(p.value,0);assert.equal(p.complete,false);assert.doesNotMatch(p.goalText,/NaN|Infinity/);}
});
test('new run resets both the same reserve and goal marker through the existing state reset',()=>{
 const g=game();Object.assign(g.state,{distance:3000,nitro:0});const v=render(g.state);g.reset();v.update(g.state);assert.equal(v.id('mobileGoalRail').style['--goal-progress'],'0');assert.equal(v.id('mobileGoalRail').dataset.complete,'false');assert.equal(v.id('boostBtn').style['--reserve-level'],'0.6');assert.equal(v.id('flightBtn').style['--reserve-level'],'0.6');
});

test('non-flight cars describe only nitro while all five cars read the same authoritative reserve',()=>{
 for(const id of ['rocket','hatch','sedan','suv','van']){const g=new Game();g.configureVehicle(id);g.reset();g.start();Object.assign(g.state,{nitro:45,distance:750});const view=render(g.state),text=view.id('sharedEnergyStatus').textContent;assert.equal(view.id('boostBtn').style['--reserve-level'],'0.45');assert.equal(view.id('flightBtn').style['--reserve-level'],'0.45');if(g.state.flightAllowed)assert.match(text,/нитро и полёта/);else{assert.equal(text,'Запас нитро: 45%.');assert.doesNotMatch(text,/полёт/);}}
});
