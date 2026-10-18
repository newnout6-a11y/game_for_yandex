import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Game } from '../src/game.js';
import { RunTelemetry } from '../src/run-telemetry.js';
import { createProgressionStorage } from '../src/progression-storage.js';
import { createProfile, deriveGarageView, getEngineeringModifiers, LIMITS } from '../src/progression.js';
import { CATALOG, ADS, vehicleDefinition } from '../src/progression-catalog.js';
import { createStorage } from '../src/storage.js';
import { createLifecycle } from '../src/lifecycle.js';
import { createAdCadence } from '../src/ad-cadence.js';
import { loadOwnGames, openOwnGame } from '../src/own-games.js';
import { createAds } from '../src/ads.js';

/** Run the actual browser controller against deterministic UI/GPU/platform boundaries. */
async function controller({ cloudProfile = null, initialProfile = null, failUpgrade = false, portrait=false, sdkApi=null } = {}) {
  let orientationHandler=()=>{},readyCalls=0;
  const saved = new Map(), listeners = new Map(), nodes = new Map(), requests = [];
  const localStorage = { getItem:key=>saved.get(key)||null, setItem:(key,value)=>saved.set(key,value) };
  const profileStore = createProgressionStorage({provider:localStorage,idFactory:(()=>{let n=0;return ()=>`run_${++n}`;})()});
  if (initialProfile) profileStore.replaceFromCloud(initialProfile);
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {hidden:false, disabled:false, dataset:{}, style:{}, attributes:{},
      addEventListener(name, callback) { listeners.set(`${id}:${name}`,callback); },
      setAttribute(key,value) { this.attributes[key]=value; }, getAttribute(key) { return this.attributes[key]??null; },
      setPointerCapture() {}, closest() { return null; }});
    return nodes.get(id);
  };
  class UI {
    constructor() { this.overlay={hidden:true}; this.modalType=null; }
    setScreen() {} menu() {} renderSettings() {} toast() {} camera() {} sound() {} glance() {} hud() {}
    notice(message) { this.lastNotice=message; }
    close() { this.overlay.hidden=true;this.modalType=null; }
    pause() { this.overlay.hidden=false;this.modalType='pause'; }
    help() { this.overlay.hidden=false;this.modalType='help'; }
  }
  class GarageUI {
    render(view) { this.view=view; } setVisible(value) { this.visible=value; } setBusy(value) { this.busy=value; }
    notice(message) { this.lastNotice=message; }
  }
  class RoadRenderer {
    constructor(_canvas,_progress,options) { this.ready=Promise.resolve();this.renderer={};this.cosmeticCapabilities={};this.cameraMode=options.cameraMode;this.quality=options.quality;this.playerMirrors={suspend(){}}; }
    setRoute(value) { this.route=value; } setQuality(value) { this.quality=value; }
    setCameraMode(value) { this.cameraMode=value; } setLookDirection() {} resize() {} effect() {} render() {}
    selectOwnedVehicle(id) { this.playerVehicleId=id; } createShowcaseVehicle(id) { return {id}; }
  }
  class GarageScene {
    constructor(options) { this.options=options;this.tier=0;this.ready=false; }
    setVehicle(id) { this.vehicleId=id; }
    async setTier(tier) {
      requests.push(tier);
      if (failUpgrade && tier>1) {this.failedTier=tier;
        // Bound the test double, not production: the fourth failure demonstrates uncontrolled retry.
        if (requests.filter(value=>value>1).length<=4) this.options.onStatus({loading:false,tier,error:'asset unavailable'});
        return false;
      }
      this.tier=tier;this.ready=true;return true;
    }
    render() { return true; } orbit() {}
  }
  class DrivingInput { clear() {} key() {} read() { return {}; } active() {return false;} set() {} release() {} }
  class CockpitGlanceControls { constructor(){this.direction=0;} clear() {} setEnabled(value) {this.enabled=value;} release() {} }
  class GameAudio { constructor(enabled){this.enabled=enabled;} update() {} tone() {} async unlock() {} }
  const sdk={get:()=>sdkApi,on(){},ready(){readyCalls++;},gameplay(){}};
  const context=vm.createContext({console,structuredClone,TextEncoder,Promise,Map,Set,Math,Number,Object,JSON,
    document:{getElementById:node,querySelector:node,querySelectorAll:()=>[],addEventListener(name,callback){listeners.set(`document:${name}`,callback);},hidden:false,documentElement:{}},
    window:{addEventListener(name,callback){listeners.set(`window:${name}`,callback);}},
    performance:{now:()=>0},innerWidth:1200,innerHeight:800,requestAnimationFrame(){},
    matchMedia:()=>({matches:false,addEventListener(){}}),location:{reload(){}},
    Game,RunTelemetry,deriveGarageView,getEngineeringModifiers,LIMITS,CATALOG,ADS,vehicleDefinition,
    createStorage:()=>createStorage(()=>localStorage),createProgressionStorage:()=>({...profileStore,dispatch:action=>profileStore.dispatch(structuredClone(action))}),
    createThumbDrive:()=>({setEnabled(){},clear(){}}),createOrientationGate:({onChange})=>{orientationHandler=onChange;onChange(portrait);return {blocked:portrait};},createSdk:()=>sdk,createLifecycle,createAds,createAdCadence,loadOwnGames,openOwnGame,
    createPlatformServices:({onState})=>({getState:()=>({}),async init(){if(cloudProfile){profileStore.replaceFromCloud(cloudProfile);onState();}},queueSave(){},async authorize(){},async resolveCloudConflict(){}}),
    UI,GarageUI,RoadRenderer,GarageScene,DrivingInput,CockpitGlanceControls,GameAudio,
    cameraShortcutAllowed:()=>false,glanceShortcutAllowed:()=>false,normalizeRenderQuality:value=>value,observeRenderPixelRatio() {},
  });
  const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(source+'\n globalThis.controller={startRun,showResults,handleAction,handleGarageAction,tick,refreshGarage,get state(){return {busy,loading,adCadence,screen,settings,previewId,run,runResult,game,telemetry,renderer,garageScene,garageUI,audio,lifecycle,garageDirty}}};',context,{filename:'src/main.js'});
  for(let i=0;i<5;i++)await Promise.resolve();
  return {api:context.controller,profileStore,requests,listeners,nodes,setOrientation:value=>orientationHandler(value),get readyCalls(){return readyCalls;}};
}

/** Import ownership through the same sanitizer as a legitimate saved/cloud profile. */
function restoredProfile() {
  const profile=createProfile({id:'cloud_profile',now:10});
  profile.ownedVehicles.push('hatch');profile.selectedVehicleId='hatch';profile.revision=50;
  Object.assign(profile.settings,{route:'neon',difficulty:'rush',sound:true,renderQuality:'high',cameraMode:'cockpit'});
  return profile;
}

test('controller initializes an immediately playable local starter with one workshop load',async()=>{
  const h=await controller();assert.equal(h.api.state.screen,'hub');assert.deepEqual(h.requests,[1]);
  await h.api.startRun();assert.equal(h.api.state.screen,'playing');assert.equal(h.api.state.game.state.vehicleId,'rocket');
  assert.equal(h.api.state.run.sequence,1);
});

test('same-turn no-ad start intents create one identity without an empty finalized run',async()=>{
  const h=await controller();
  // Both intents arrive before the no-ad transition's promise continuation runs.
  await Promise.all([h.api.handleGarageAction({type:'startDrive'}),h.api.handleGarageAction({type:'startDrive'})]);
  const profile=h.profileStore.get();
  assert.equal(h.api.state.screen,'playing');assert.equal(h.api.state.run.sequence,1);
  assert.equal(profile.ledger.nextSequence,2);assert.equal(profile.ledger.finalizedThrough,0);
  assert.equal(profile.ledger.recent.length,0);assert.equal(profile.stats.runs,0);
});

test('same-turn no-ad retries finalize only the previous run',async()=>{
  const h=await controller();await h.api.startRun();h.api.state.game.crash();h.api.showResults();
  await Promise.all([h.api.handleGarageAction({type:'startDrive'}),h.api.handleGarageAction({type:'startDrive'})]);
  const profile=h.profileStore.get();
  assert.equal(h.api.state.run.sequence,2);assert.equal(profile.ledger.nextSequence,3);
  assert.equal(profile.ledger.finalizedThrough,1);assert.equal(profile.ledger.recent.length,1);
  assert.equal(profile.ledger.recent[0].sequence,1);
});

test('an orientation abort releases the start-operation lock for the next attempt',async()=>{
  const h=await controller();const start=h.api.startRun();h.setOrientation(true);await start;
  assert.equal(h.api.state.run,null);h.setOrientation(false);await h.api.startRun();
  assert.equal(h.api.state.run.sequence,1);assert.equal(h.api.state.screen,'playing');
});

test('a configuration exception releases the start-operation lock for the next attempt',async()=>{
  const h=await controller();const select=h.api.state.renderer.selectOwnedVehicle;
  h.api.state.renderer.selectOwnedVehicle=()=>{throw new Error('test-only renderer fault');};
  await assert.rejects(h.api.startRun(),/test-only renderer fault/);
  h.api.state.renderer.selectOwnedVehicle=select;await h.api.startRun();
  assert.equal(h.api.state.screen,'playing');assert.equal(h.api.state.run.sequence,2);
});

test('an eligible ad keeps duplicate starts blocked through timeout-pending recovery',async t=>{
  let callbacks,adRequests=0;
  const h=await controller({sdkApi:{adv:{showFullscreenAdv(options){adRequests++;callbacks=options.callbacks;}}}});
  for(let sequence=1;sequence<=3;sequence++){
    await h.api.startRun();assert.equal(h.api.state.run.sequence,sequence);
    // Seed qualified session receipts; the controller and SDK adapter remain real.
    h.api.state.adCadence.completeRun(sequence,{activeSeconds:60,distanceM:600},{reason:'crash'});
    h.api.state.game.crash();h.api.showResults();
  }
  t.mock.timers.enable({apis:['setTimeout']});t.after(()=>callbacks?.onError());
  const start=h.api.startRun();assert.equal(adRequests,1);assert.equal(h.api.state.busy,true);
  await h.api.startRun();assert.equal(h.api.state.run.sequence,3);
  t.mock.timers.tick(90000);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.api.state.loading.adPending,true);assert.equal(h.api.state.busy,true);
  assert.equal(h.api.state.lifecycle.has('ad'),true);
  await h.api.handleGarageAction({type:'startDrive'});
  assert.equal(h.api.state.run.sequence,3);assert.equal(h.api.state.screen,'results');
  callbacks.onClose(false);await start;
  assert.equal(h.api.state.run.sequence,4);assert.equal(h.api.state.screen,'playing');
  assert.equal(h.profileStore.get().ledger.finalizedThrough,3);assert.equal(adRequests,1);
  assert.equal(h.api.state.busy,false);assert.equal(h.api.state.loading.adPending,false);
  assert.equal(h.api.state.lifecycle.has('ad'),false);
});

test('startup cloud restore drives and previews the same selected vehicle and settings',async()=>{
  const h=await controller({cloudProfile:restoredProfile()});
  assert.equal(h.api.state.screen,'hub');
  assert.equal(h.api.state.previewId,'hatch','restored selection must replace the pre-init local preview');
  assert.equal(h.api.state.garageScene.vehicleId,'hatch');
  assert.equal(h.api.state.settings.route,'neon');assert.equal(h.api.state.settings.difficulty,'rush');
  assert.equal(h.api.state.audio.enabled,true);assert.equal(h.api.state.renderer.quality,'high');
  await h.api.startRun();assert.equal(h.api.state.game.state.vehicleId,'hatch');
  assert.equal(h.api.state.game.difficulty,'rush');assert.equal(h.api.state.renderer.route,'neon');
});

test('failed workshop upgrade does not recursively re-request the same missing asset',async()=>{
  const profile=createProfile();profile.wallet.credits=5000;
  const h=await controller({initialProfile:profile,failUpgrade:true});
  await h.api.handleGarageAction({type:'upgradeGarage'});
  assert.equal(h.profileStore.get().garage.level,2);
  assert.equal(h.requests.filter(tier=>tier===2).length,1,'a failed asset waits for explicit retry instead of refresh-triggered fetch loops');
});

test('results revive retains run identity and counts distance/rewards only once',async()=>{
  const h=await controller();await h.api.startRun();
  const identity=h.api.state.run.id,sequence=h.api.state.run.sequence;
  const drive=frames=>{const {game}=h.api.state;game.state.traffic=[];game.state.nextSpawn=Infinity;game.state.nextEvent=Infinity;for(let i=0;i<frames;i++){game.update(.05,{throttle:1});h.api.state.telemetry.observe(game.state,.05);}};
  drive(300);h.api.state.game.crash();h.api.showResults();
  const firstDistance=h.profileStore.get().stats.distanceM,firstCredits=h.profileStore.get().wallet.credits;
  await h.api.handleAction('revive');assert.equal(h.api.state.screen,'playing');
  assert.equal(h.api.state.run.id,identity);assert.equal(h.api.state.run.sequence,sequence);
  drive(50);h.api.state.game.crash();h.api.showResults();
  assert.equal(h.profileStore.get().stats.runs,1);assert.equal(h.profileStore.get().stats.revives,1);
  assert.ok(h.profileStore.get().stats.distanceM>firstDistance);
  assert.ok(h.profileStore.get().wallet.credits>=firstCredits);
  const balance=h.profileStore.get().wallet.credits;await h.api.handleAction('menu');
  assert.equal(h.api.state.screen,'hub');assert.equal(h.profileStore.get().wallet.credits,balance);
  assert.equal(h.profileStore.get().ledger.activeRun,null);assert.equal(h.profileStore.get().ledger.finalizedThrough,sequence);
});

test('production touchdown callbacks cannot discard distance at a renderer frame boundary',()=>{
  let game;const telemetry=new RunTelemetry();
  game=new Game({random:()=>.5,onEvent:(name,payload)=>telemetry.event(name,payload,game.state)});
  game.start();Object.assign(game.state,{nextSpawn:Infinity,nextEvent:Infinity,traffic:[]});
  const dt=1/120;
  for(let i=0;i<1800;i++){game.update(dt,{throttle:1,flight:i*dt>6&&i*dt<8});telemetry.observe(game.state,dt);}
  assert.ok(telemetry.snapshot().landings>0,'exercise a real touchdown rather than synthetic counters');
  assert.ok(Math.abs(game.state.distance-telemetry.snapshot().distanceM)<1e-7,`distance lost at touchdown: ${game.state.distance-telemetry.snapshot().distanceM} m`);
});

test('same-timestamp production completion uses only the original bounded travel allowance',()=>{
  const telemetry=new RunTelemetry();
  const state={phase:'playing',elapsed:.05,distance:0,speed:20,altitude:0,verticalSpeed:0,rollAngle:0,x:1,score:0,eventsCompleted:0,overtakes:0,revives:0,goalReached:false,rolling:false,touchdownPulse:0};
  telemetry.observe(state);
  state.distance=1;telemetry.observe(state);
  assert.equal(telemetry.snapshot().distanceM,1);assert.equal(telemetry.snapshot().activeSeconds,.05);
  for(let i=0;i<50;i++)telemetry.observe(state);
  assert.equal(telemetry.snapshot().distanceM,1);
  // Malicious same-timestamp increments cannot renew either the rate allowance or its tolerance.
  for(let i=0;i<1000;i++){state.distance+=.1;telemetry.observe(state);}
  assert.ok(telemetry.snapshot().distanceM<=160*.05+.25+1e-9);
  const earned=telemetry.snapshot().distanceM;
  state.phase='paused';telemetry.observe(state);state.phase='playing';state.distance+=1;telemetry.observe(state);
  assert.equal(telemetry.snapshot().distanceM,earned);
});

test('later counters in an already-observed production substep retain airborne attribution',()=>{
  const telemetry=new RunTelemetry();
  const state={phase:'playing',elapsed:.05,distance:1,speed:20,altitude:1.2,verticalSpeed:0,rollAngle:0,x:1,score:0,eventsCompleted:1,overtakes:0,revives:0,goalReached:false,rolling:false,touchdownPulse:0};
  // Game resolves a road event after path integration, before traffic overtakes in the same step.
  telemetry.event('event-clear',{success:true},state);
  state.overtakes=1;telemetry.observe(state);
  assert.equal(telemetry.snapshot().roadEventsCompleted,1);
  assert.equal(telemetry.snapshot().airborneOvertakes,1);
  telemetry.observe(state);assert.equal(telemetry.snapshot().airborneOvertakes,1);
});

test('revived results compare against the continued record class rather than the stock class',async()=>{
  const profile=createProfile();profile.records.continued['rocket:flow']={score:1000000,distanceM:100000,runSequence:1};
  const h=await controller({initialProfile:profile});await h.api.startRun();
  const drive=()=>{const {game,telemetry}=h.api.state;Object.assign(game.state,{traffic:[],nextSpawn:Infinity,nextEvent:Infinity});for(let i=0;i<40;i++){game.update(.05,{throttle:1});telemetry.observe(game.state,.05);}game.crash();h.api.showResults();};
  drive();await h.api.handleAction('revive');drive();
  assert.equal(h.api.state.runResult.continued,true);
  assert.ok(h.api.state.runResult.score<1000000);
  assert.equal(h.api.state.runResult.newRecord,false,'a smaller continued result must not be advertised as a new record');
});

test('external blur pauses retain explicit user resume and cannot accrue telemetry',async()=>{
  const h=await controller();await h.api.startRun();
  h.listeners.get('window:blur')();assert.equal(h.api.state.screen,'paused');
  assert.ok(h.api.state.lifecycle.has('blur'));assert.ok(h.api.state.lifecycle.has('user'));
  const before=h.api.state.telemetry.snapshot();h.api.tick(100);h.api.tick(200);
  assert.deepEqual(h.api.state.telemetry.snapshot(),before);
  await h.api.handleAction('resume');assert.equal(h.api.state.screen,'paused');
  h.listeners.get('window:focus')();assert.equal(h.api.state.screen,'paused');
  await h.api.handleAction('resume');assert.equal(h.api.state.screen,'playing');
  assert.equal(h.api.state.lifecycle.paused,false);
});

test('accepted cloud ledger replacement invalidates the old physical run and ad sequence',async()=>{
 const {api,profileStore}=await controller();await api.startRun();api.state.game.update(.1,{throttle:1});api.showResults();assert.ok(api.state.run);
 api.state.adCadence.observeRun(100,{activeSeconds:100,distanceM:1000});
 profileStore.replaceFromCloud(createProfile({id:'other_cloud_lineage'}));await api.handleGarageAction({type:'resolveCloudConflict',choice:'cloud'});
 assert.equal(api.state.screen,'hub');assert.equal(api.state.run,null);assert.equal(api.state.runResult,null);assert.equal(api.state.adCadence.snapshot().latestSequence,0);
 await api.startRun();assert.equal(api.state.run.sequence,1);assert.equal(api.state.screen,'playing');
});

test('portrait entry defers readiness and driving until landscape, without granting an ad opportunity',async()=>{
 const env=await controller({portrait:true});assert.equal(env.readyCalls,0);await env.api.startRun();assert.equal(env.api.state.run,null);env.setOrientation(false);assert.equal(env.readyCalls,1);await env.api.startRun();assert.equal(env.api.state.screen,'playing');
 const elapsed=env.api.state.game.state.elapsed;env.setOrientation(true);env.api.tick(100);assert.equal(env.api.state.game.state.elapsed,elapsed);assert.equal(env.api.state.screen,'playing');assert.equal(env.api.state.lifecycle.has('orientation'),true);
 env.setOrientation(false);assert.equal(env.api.state.screen,'playing');assert.equal(env.api.state.lifecycle.paused,false);env.api.state.lifecycle.pause('ad');env.setOrientation(true);env.setOrientation(false);assert.equal(env.api.state.lifecycle.has('ad'),true);assert.equal(env.api.state.lifecycle.has('user'),true);assert.equal(env.api.state.screen,'paused');
});

test('unowned vehicle preview persists across garage sections without granting ownership or changing the active car',async()=>{
 const h=await controller();await h.api.handleGarageAction({type:'navigate',screen:'garage',tab:'fleet'});await h.api.handleGarageAction({type:'selectVehicle',id:'hatch'});
 assert.equal(h.api.state.previewId,'hatch');assert.equal(h.profileStore.get().selectedVehicleId,'rocket');
 for(const tab of ['engineering','style','fleet']){await h.api.handleGarageAction({type:'navigate',screen:'garage',tab});assert.equal(h.api.state.previewId,'hatch');assert.equal(h.api.state.garageUI.view.vehicle.id,'hatch');assert.equal(h.api.state.garageUI.view.engineeringComparison.some(row=>row.id==='flight'),false);}
 assert.deepEqual(h.profileStore.get().ownedVehicles,['rocket']);await h.api.handleGarageAction({type:'navigate',screen:'hub'});assert.equal(h.api.state.previewId,'rocket');
});


test('a capped wallet never offers an ad for a zero-credit result bonus',async()=>{
 const profile=createProfile({id:'capped_ui'});profile.wallet.credits=LIMITS.credits;profile.season.xp=9000;
 const h=await controller({initialProfile:profile});await h.api.startRun();
 Object.assign(h.api.state.game.state,{distance:600,elapsed:45,phase:'crashed'});h.api.showResults();
 assert.equal(h.api.state.runResult.bonusCredits,0);assert.equal(h.api.state.runResult.bonusEligible,false);
 assert.equal(h.api.state.runResult.receipt.credits,0);assert.equal(h.api.state.runResult.receipt.xp,0);
});
