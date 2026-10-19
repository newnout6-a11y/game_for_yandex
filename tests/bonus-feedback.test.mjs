import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Game} from '../src/game.js';
import {UI} from '../src/ui.js';
import {trafficBonusAnchor,eventBonusAnchor} from '../src/bonus-feedback.js';
import {playerTrafficDepth} from '../src/traffic-physics.js';
import {trafficDefinition} from '../src/traffic-catalog.js';

function fixture(){const events=[],g=new Game({random:()=>.5,onEvent:(name,value,anchor)=>events.push({name,value,anchor})});g.start();Object.assign(g.state,{speed:28,traffic:[],pickups:[],obstacles:[],nextSpawn:Infinity,nextEvent:Infinity});return{g,events};}
function pass(kind='sedan',x=1){const f=fixture(),s=f.g.state;s.x=s.lane=x;const car={id:10,kind,lane:0,z:0,speed:0,cruiseSpeed:0,passed:false};car.z=-playerTrafficDepth(car,s.playerBounds)+.05;s.traffic=[car];f.g.update(1/60,{throttle:1});return{...f,car};}
test('a close pass retains its numeric combo/reward and snapshots the actual source exactly once',()=>{
 const {g,events,car}=pass(),e=events.find(e=>e.name==='near');assert.ok(e);assert.equal(e.value,2);assert.equal(g.state.nearMisses,1);assert.equal(g.state.overtakes,1);assert.equal(g.state.combo,2);assert.ok(g.state.score>=60&&g.state.score<61);assert.equal(events.filter(e=>e.name==='pass').length,0);assert.equal(e.anchor.entityId,car.id);assert.equal(e.anchor.entityKind,car.kind);assert.equal(e.anchor.lane,0);assert.ok(Object.isFrozen(e.anchor));const saved=structuredClone(e.anchor);car.z=200;car.lane=2;assert.deepEqual(e.anchor,saved);g.update(1/60,{throttle:1});assert.equal(events.filter(e=>e.name==='near').length,1);
});
test('ordinary overtakes emit only a visual pass, no new near-miss/combo/bonus points',()=>{
 const {g,events}=pass('sedan',2);assert.equal(g.state.overtakes,1);assert.equal(g.state.nearMisses,0);assert.equal(g.state.combo,1);assert.ok(g.state.score<1);assert.equal(events.filter(e=>e.name==='pass').length,1);assert.equal(events.filter(e=>e.name==='near').length,0);
});
test('continuous-lane sources and both player sides use real nose corners including long semis',()=>{
 for(const kind of ['sedan','semi'])for(const x of [.1,1.9]){const s={x,distance:123,elapsed:9},car={id:2,kind,lane:1,lanePosition:.8,z:-12,speed:17,heading:.12};const a=trafficBonusAnchor(s,car),spec=trafficDefinition(kind);assert.equal(a.offsetZ,-spec.length/2);assert.equal(Math.sign(a.offsetX),x>=a.lane?1:-1);assert.equal(a.heading,.12);assert.equal(a.distance,123);assert.equal(a.speed,17);assert.ok(Object.values(a).every(v=>typeof v!=='object'));}
});
test('traffic pulses stay beside the actual fender rather than floating above the roof',()=>{
 for(const kind of ['sedan','semi']){const spec=trafficDefinition(kind),a=trafficBonusAnchor({x:1,distance:0,elapsed:0},{id:1,kind,lane:0,z:-5,speed:0});assert.equal(a.height,Math.min(spec.height*.55+.12,1.65));assert.ok(a.height<spec.height);assert.ok(Math.abs(Math.abs(a.offsetX)-spec.width/2-.15)<1e-9);}
});
test('pickup source survives removal in the emitting substep while score and energy stay unchanged',()=>{
 const {g,events}=fixture();g.state.speed=20;g.state.nitro=30;g.state.pickups=[{id:7,lane:1,z:2.1}];g.update(.1,{throttle:1});const e=events.find(e=>e.name==='charge');assert.ok(e);assert.equal(e.value,undefined);assert.equal(e.anchor.lane,1);assert.ok(e.anchor.z<=2&&e.anchor.z>1);assert.equal(g.state.pickups.length,0);assert.equal(g.state.nitro,52);assert.equal(g.state.charges,1);assert.ok(g.state.score>=50&&g.state.score<53);
});
test('goal feedback uses the actual crossing place and unchanged one-shot 1000-point award',()=>{
 const {g,events}=fixture();g.state.distance=1499.9;g.update(.1,{throttle:1});const e=events.find(e=>e.name==='goal');assert.ok(e);assert.equal(e.anchor.lane,g.state.x);assert.ok(Math.abs(e.anchor.distance+e.anchor.z-1500)<1e-9);assert.ok(g.state.score>=1000);g.update(.1,{throttle:1});assert.equal(events.filter(e=>e.name==='goal').length,1);assert.equal(g.state.phase,'playing');
});
test('checkpoint/roadworks success preserves receipt payload and captures gate/exit before removal; failure has no cue',()=>{
 for(const type of ['checkpoint','roadworks'])for(const success of [false,true]){const {g,events}=fixture();g.state.distance=501;g.state.nitro=50;g.state.roadEvent={id:99,type,lane:0,at:500,end:565,title:'Fixture',points:300};g.finishEvent(success);const e=events.find(e=>e.name==='event-clear');assert.deepEqual(e.value,{title:'Fixture',success,points:success?300:0,until:4});assert.equal(g.state.roadEvent,null);assert.equal(g.state.nitro,success?65:50);if(success){assert.equal(e.anchor.lane,type==='roadworks'?g.state.x:0);assert.equal(e.anchor.distance+e.anchor.z,type==='roadworks'?565:500);}else assert.equal(e.anchor,undefined);}
});
test('convoy cue follows the last actual pass identity, not nearest target or reused prior event',()=>{
 const {g,events}=fixture(),s=g.state;s.x=s.lane=2;const car={id:4,eventId:44,kind:'sedan',lane:0,z:0,speed:0,cruiseSpeed:0,passed:false};car.z=-playerTrafficDepth(car,s.playerBounds)+.05;s.traffic=[car];s.roadEvent={id:44,type:'convoy',targets:[4],deadline:50,at:240,remaining:240,points:400,title:'Convoy'};g.update(1/60,{throttle:1});const p=events.find(e=>e.name==='pass');assert.ok(p);g.update(1/60,{throttle:1});const done=events.find(e=>e.name==='event-clear');assert.ok(done?.value.success);assert.equal(done.anchor,p.anchor);assert.equal(done.anchor.entityId,4);assert.equal(eventBonusAnchor(s,{id:45,type:'convoy'},g.lastConvoyPass),null);g.reset();assert.equal(g.lastConvoyPass,null);
});
test('actual main callback routes bonuses without text; warning, telemetry and sound contracts remain',()=>{
 const text=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),part=text.slice(text.indexOf('const game=new Game('),text.indexOf('const lifecycle='));const calls={bonus:[],toast:[],audio:[],telemetry:[]},sandbox={Game:class{constructor(o){this.onEvent=o.onEvent;this.state={phase:'playing'};}},renderer:{bonus:(...a)=>calls.bonus.push(a),effect(){}},telemetry:{event:(...a)=>calls.telemetry.push(a)},audio:{tone:e=>calls.audio.push(e)},ui:{toast:t=>calls.toast.push(t)},input:{releaseEmptyTouchBoost(){}}};vm.createContext(sandbox);vm.runInContext(part+';globalThis.g=game;',sandbox);const anchor={lane:0,z:-5};for(const e of ['near','charge','goal'])sandbox.g.onEvent(e,e==='near'?3:undefined,anchor);sandbox.g.onEvent('event-clear',{success:true,points:500},anchor);sandbox.g.onEvent('pass',undefined,anchor);assert.equal(calls.bonus.length,5);assert.ok(calls.bonus.every(c=>c[1]===anchor&&c[2]===sandbox.g.state));assert.deepEqual(calls.toast,[]);assert.deepEqual(calls.audio,['near','charge','goal','event-clear']);assert.equal(calls.telemetry.length,4);sandbox.g.onEvent('cone');sandbox.g.onEvent('event-clear',{success:false});assert.equal(calls.toast.length,2);assert.match(calls.toast[0],/КОНУС/);assert.match(calls.toast[1],/НЕ ПРОЙДЕНО/);
});
test('actual HUD removes successful reward prose but keeps current instructions, failures and score',()=>{
 const {g}=fixture(),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},style:{setProperty(){}},setAttribute(){},textContent:''});return nodes.get(id);};const old=globalThis.document;globalThis.document={getElementById:node};try{const ui=Object.create(UI.prototype),s=g.state;s.lastEvent={success:true,title:'Gate',points:500,until:4};s.goalReached=true;ui.hud(s);assert.equal(node('eventBanner').hidden,true);assert.doesNotMatch(node('eventHint').textContent,/Бонус|500|15%/);assert.equal(node('challengeTitle').textContent,'Цель выполнена');s.lastEvent.success=false;ui.hud(s);assert.equal(node('eventBanner').hidden,false);assert.match(node('eventTitle').textContent,/Не пройдено/);s.roadEvent={type:'checkpoint',title:'Контрольная точка',hint:'Пройди между флагами',seconds:8,remaining:20};ui.hud(s);assert.equal(node('eventTitle').textContent,'Контрольная точка');assert.equal(node('eventHint').textContent,s.roadEvent.hint);}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
});
