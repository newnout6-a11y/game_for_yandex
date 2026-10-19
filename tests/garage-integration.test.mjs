import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { bindGarageOrbitInput } from '../src/garage-orbit-input.js';
import { recoverPendingRunResult } from '../src/pending-run-result.js';
import { homeVehicleFraming } from '../src/home-framing.js';
import { Game } from '../src/game.js';
import { DrivingInput } from '../src/input.js';
import { RunTelemetry } from '../src/run-telemetry.js';
import { createProgressionStorage, PROGRESSION_STORAGE_KEY } from '../src/progression-storage.js';
import { createProfile, deriveGarageView, getEngineeringModifiers, getRunDoubleOffer, LIMITS } from '../src/progression.js';
import { CATALOG, ADS, vehicleDefinition } from '../src/progression-catalog.js';
import { createStorage } from '../src/storage.js';
import { createLifecycle } from '../src/lifecycle.js';
import { createAdCadence } from '../src/ad-cadence.js';
import { loadOwnGames, openOwnGame } from '../src/own-games.js';
import { createAds } from '../src/ads.js';
import { createPlatformServices as createRealPlatformServices, CLOUD_PROFILE_KEY } from '../src/platform-services.js';

/** Run the actual browser controller against deterministic UI/GPU/platform boundaries. */
async function controller({ cloudProfile = null, initialProfile = null, initialStorage = {}, failUpgrade = false, portrait=false, sdkApi=null, useRealPlatform=false } = {}) {
  let orientationHandler=()=>{},readyCalls=0,platformChanged=()=>{};
  let rejectSettings=false,failStorageWrites=false,failCloudWrites=false,platformServices=null;
  let platformState={generation:0,identity:null};
  const cloudSaves=[],cloudWrites=[];
  const saved = new Map(Object.entries(initialStorage)), listeners = new Map(), nodes = new Map(), requests = [];
  const listen=(key,callback)=>{const prior=listeners.get(key);listeners.set(key,prior?event=>{prior(event);callback(event);}:callback);};
  const localStorage = { getItem:key=>saved.get(key)||null, setItem(key,value){if(failStorageWrites){const error=new Error('quota');error.name='QuotaExceededError';throw error;}saved.set(key,value);} };
  const profileStore = createProgressionStorage({provider:localStorage,idFactory:(()=>{let n=0;return ()=>`run_${++n}`;})()});
  if (initialProfile) profileStore.replaceFromCloud(initialProfile);
  let remoteProfile=profileStore.get();
  // Only the SDK transport is synthetic; these optional tests use the real cloud adapter.
  const platformSdk=useRealPlatform?{...sdkApi,getPlayer:()=>({
    getUniqueID:()=> 'fixture_guest',isAuthorized:()=>false,
    getData:async()=>({[CLOUD_PROFILE_KEY]:{formatVersion:1,accountId:'fixture_guest',profile:structuredClone(remoteProfile)}}),
    async setData(payload,durable){
      cloudWrites.push({payload:structuredClone(payload),durable});
      if(failCloudWrites)throw new Error('test-only cloud write failure');
      remoteProfile=structuredClone(payload[CLOUD_PROFILE_KEY].profile);
    },
  })}:sdkApi;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {hidden:false, disabled:false, dataset:{}, style:{}, attributes:{},
      addEventListener(name, callback) { listen(`${id}:${name}`,callback); },
      setAttribute(key,value) { this.attributes[key]=value; }, getAttribute(key) { return this.attributes[key]??null; },
      querySelector(){return null;},getBoundingClientRect(){return {x:0,y:0,left:0,top:0,right:1200,bottom:800,width:1200,height:800};},setPointerCapture() {}, closest() { return null; }});
    return nodes.get(id);
  };
  class UI {
    constructor() { this.overlay={hidden:true}; this.modalType=null; }
    setScreen() {} menu() {} renderSettings() {} toast() {} camera(value) {this.cameraMode=value;} sound(value) {this.soundEnabled=value;} glance() {} hud() {}
    notice(message) { this.lastNotice=message; }
    close() { this.overlay.hidden=true;this.modalType=null; }
    pause() { this.overlay.hidden=false;this.modalType='pause'; }
    help() { this.overlay.hidden=false;this.modalType='help'; }
  }
  class GarageUI {
    constructor(options){this.options=options;}
    getFleetMiniatureTargets(){return this.targets||[];}
    render(view) { this.view=view; } setVisible(value) { this.visible=value; } setBusy(value) { this.busy=value; }
    notice(message) { this.lastNotice=message; }
  }
  class RoadRenderer {
    constructor(_canvas,_progress,options) { this.ready=Promise.resolve();this.renderer={};this.scene={environment:null};this.cosmeticCapabilities={};this.cameraMode=options.cameraMode;this.quality=options.quality;this.playerMirrors={suspend(){}}; }
    setRoute(value) { this.route=value; } setQuality(value) { this.quality=value; }
    setShowcase(value) { this.showcase=value; }
    setCameraMode(value) { this.cameraMode=value; } setLookDirection() {} resize() {} effect() {} render() {}
    selectOwnedVehicle(id) { this.playerVehicleId=id; } createShowcaseVehicle(id) { return {id}; }
  }
  class GarageScene {
    constructor(options) { this.options=options;this.tier=0;this.ready=false; }
    setVehicle(id) { this.vehicleId=id; }
    async prepareToy() { this.toyPrepared=true;return true; }
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
    advance(dt,options){this.lastAdvance={dt,...options};return false;}
  }
  class FleetMiniatures {
    constructor(options){this.options=options;this.activeId=null;}
    sync(targets,options){this.targets=targets;this.scope=options.scopeKey;}
    setInteraction(id){this.activeId=id;}
    update(dt,options){this.lastUpdate={dt,...options};return false;}
  }
  class CockpitGlanceControls { constructor(){this.direction=0;} clear() {} setEnabled(value) {this.enabled=value;} release() {} }
  class GameAudio { constructor(enabled){this.enabled=enabled;} update() {} tone() {} async unlock() {} }
  const sdk={init:async()=>platformSdk,get:()=>platformSdk,on(){},ready(){readyCalls++;},gameplay(){}};
  const context=vm.createContext({console,structuredClone,TextEncoder,Promise,Map,Set,Math,Number,Object,JSON,
    document:{getElementById:node,querySelector:node,querySelectorAll:selector=>selector==='[data-route]'?[Object.assign(node('route-neon'),{dataset:{route:'neon'}})]:selector==='[data-difficulty]'?[Object.assign(node('difficulty-rush'),{dataset:{difficulty:'rush'}})]:[],addEventListener(name,callback){listen(`document:${name}`,callback);},hidden:false,documentElement:{}},
    window:{addEventListener(name,callback){listen(`window:${name}`,callback);}},
    performance:{now:()=>0},innerWidth:1200,innerHeight:800,requestAnimationFrame(){},
    matchMedia:()=>({matches:false,addEventListener(){}}),location:{reload(){}},
    Game,recoverPendingRunResult,homeVehicleFraming,bindGarageOrbitInput,RunTelemetry,deriveGarageView,getEngineeringModifiers,getRunDoubleOffer,LIMITS,CATALOG,ADS,vehicleDefinition,
    createStorage:()=>createStorage(()=>localStorage),createProgressionStorage:()=>({...profileStore,dispatch:action=>rejectSettings&&action.type==='UPDATE_SETTINGS'?{ok:false,changed:false,reason:'future-version-read-only',profile:profileStore.get(),persistence:profileStore.status()}:profileStore.dispatch(structuredClone(action))}),
    createOrientationGate:({onChange})=>{orientationHandler=onChange;onChange(portrait);return {blocked:portrait};},createSdk:()=>sdk,createLifecycle,createAds,createAdCadence,loadOwnGames,openOwnGame,
    createPlatformServices:options=>{
      const {onState}=options;platformChanged=onState;
      if(useRealPlatform)return platformServices=createRealPlatformServices({...options,minSaveIntervalMs:0});
      return {getState:()=>structuredClone(platformState),async init(){if(cloudProfile){profileStore.replaceFromCloud(cloudProfile);onState();}},queueSave(snapshot){cloudSaves.push(structuredClone(snapshot));},async authorize(){},async resolveCloudConflict(){}};
    },
    UI,GarageUI,RoadRenderer,GarageScene,FleetMiniatures,DrivingInput,CockpitGlanceControls,GameAudio,
    cameraShortcutAllowed:()=>false,glanceShortcutAllowed:()=>false,normalizeRenderQuality:value=>value,observeRenderPixelRatio() {},
  });
  const source=(await readFile(new URL('../src/main.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(source+'\n globalThis.controller={startRun,showResults,handleAction,handleGarageAction,tick,refreshGarage,syncFleetMiniatures,get state(){return {busy,loading,adCadence,screen,settings,previewId,run,runResult,game,telemetry,renderer,garageScene,garageUI,audio,ui,storage,lifecycle,garageDirty,fleetMiniatures,fleetTouchRemaining}}};',context,{filename:'src/main.js'});
  if(useRealPlatform)await platformServices.init();
  for(let i=0;i<5;i++)await Promise.resolve();
  return {api:context.controller,profileStore,requests,listeners,nodes,cloudSaves,cloudWrites,platformServices,storageValues:saved,rejectSettings(){rejectSettings=true;},failStorageWrites(){failStorageWrites=true;},failCloudWrites(){failCloudWrites=true;},replaceCloud(profile){const result=profileStore.replaceFromCloud(profile);platformChanged();return result;},setPlatformState(patch){platformState={...platformState,...patch};platformChanged();},setOrientation:value=>orientationHandler(value),get readyCalls(){return readyCalls;}};
}

/** Import ownership through the same sanitizer as a legitimate saved/cloud profile. */
function restoredProfile() {
  const profile=createProfile({id:'cloud_profile',now:10});
  profile.ownedVehicles.push('hatch');profile.selectedVehicleId='hatch';profile.revision=50;
  Object.assign(profile.settings,{route:'neon',difficulty:'rush',sound:true,renderQuality:'high',cameraMode:'cockpit'});
  return profile;
}

test('controller initializes an immediately playable local starter with one workshop load',async()=>{
  const h=await controller();assert.equal(h.api.state.screen,'hub');assert.deepEqual(h.requests,[1]);assert.equal(h.api.state.renderer.showcase,true);
  await h.api.startRun();assert.equal(h.api.state.screen,'playing');assert.equal(h.api.state.game.state.vehicleId,'rocket');assert.equal(h.api.state.renderer.showcase,false);
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
  assert.equal(h.api.state.screen,'hub');assert.equal(h.profileStore.get().wallet.credits,balance);assert.equal(h.api.state.renderer.showcase,true);
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
  h.listeners.get('window:blur')();assert.equal(h.api.state.screen,'paused');assert.equal(h.api.state.renderer.showcase,false);
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

/** Produce genuine qualifying telemetry without random traffic, using the real game integrator. */
async function rewardedResults(h){
 await h.api.startRun();const {game,telemetry}=h.api.state;
 Object.assign(game.state,{traffic:[],nextSpawn:Infinity,nextEvent:Infinity});
 for(let i=0;i<1000;i++){game.update(.05,{throttle:1});telemetry.observe(game.state,.05);}
 game.crash();h.api.showResults();assert.equal(h.api.state.runResult.bonusEligible,true);
}

test('a rewarded bonus cannot dereference or settle a result replaced by another cloud profile',async()=>{
 let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
 const pending=h.api.handleGarageAction({type:'rewardedBonus'});callbacks.onOpen();
 h.replaceCloud(createProfile({id:'different_account_profile'}));const replacement=h.profileStore.get();
 callbacks.onRewarded();callbacks.onClose(true);await pending;
 assert.deepEqual(h.profileStore.get(),replacement);assert.equal(h.api.state.runResult,null);assert.equal(h.api.state.screen,'hub');
 assert.equal(h.api.state.busy,false);assert.equal(h.api.state.lifecycle.has('ad'),false);
});

test('an identical-ID cloud replacement invalidates the old result transaction too',async()=>{
 let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
 const oldResult=h.api.state.runResult,pending=h.api.handleGarageAction({type:'rewardedBonus'}),replacement=h.profileStore.get();h.replaceCloud(replacement);
 callbacks.onRewarded();callbacks.onClose(true);await pending;
 assert.deepEqual(h.profileStore.get(),replacement);assert.notEqual(h.api.state.runResult,oldResult);assert.equal(h.api.state.runResult.recovered,true);assert.equal(h.api.state.runResult.bonusClaimed,false);assert.equal(h.api.state.screen,'results');
});

test('a rewarded bonus rejects a changed platform identity generation even before cloud replacement',async()=>{
 let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
 const before=h.profileStore.get(),pending=h.api.handleGarageAction({type:'rewardedBonus'});
 h.setPlatformState({generation:1,identity:{id:'next_account'}});callbacks.onRewarded();callbacks.onClose(true);await pending;
 assert.deepEqual(h.profileStore.get(),before);assert.equal(h.api.state.runResult.bonusClaimed,false);assert.equal(h.api.state.busy,false);
});

test('a current rewarded result grants once and keeps the originating run receipt',async()=>{
 let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
 const before=h.profileStore.get().wallet.credits,identity={...h.api.state.runResult.runIdentity},bonus=h.api.state.runResult.bonusCredits;
 const pending=h.api.handleGarageAction({type:'rewardedBonus'}),revision=h.profileStore.get().revision;
 // An ordinary accepted preference/save emission is not an account or profile replacement.
 await h.listeners.get('soundBtn:click')();h.setPlatformState({});
 assert.equal(h.profileStore.get().settings.sound,true);assert.equal(h.profileStore.get().revision,revision+1);
 callbacks.onRewarded();callbacks.onClose(true);await pending;
 assert.equal(h.profileStore.get().wallet.credits,before+bonus);assert.equal(h.api.state.runResult.bonusClaimed,true);
 assert.deepEqual(structuredClone(h.api.state.runResult.runIdentity),identity);await h.api.handleGarageAction({type:'rewardedBonus'});
 assert.equal(h.profileStore.get().wallet.credits,before+bonus);assert.equal(h.api.state.busy,false);
});

test('rewarded SDK error releases only ad ownership and never grants or resumes another pause',async()=>{
 let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
 const before=h.profileStore.get(),pending=h.api.handleGarageAction({type:'rewardedBonus'});h.setOrientation(true);callbacks.onError();await pending;
 assert.deepEqual(h.profileStore.get(),before);assert.equal(h.api.state.busy,false);assert.equal(h.api.state.lifecycle.has('ad'),false);
 assert.equal(h.api.state.lifecycle.has('orientation'),true);assert.equal(h.api.state.screen,'results');
});

test('rewarded revive cannot revive a replaced cloud run or clear the new profile',async()=>{
 let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
 const pending=h.api.handleAction('revive');h.replaceCloud(createProfile({id:'replacement_before_revive'}));const before=h.profileStore.get();
 callbacks.onRewarded();callbacks.onClose(true);await pending;
 assert.deepEqual(h.profileStore.get(),before);assert.equal(h.api.state.run,null);assert.equal(h.api.state.screen,'hub');assert.equal(h.api.state.busy,false);
});

test('a timed-out rewarded request stays paused until its late terminal callback and cannot grant into a replacement profile',async t=>{
  let callbacks,finished=false;
  const h=await controller({sdkApi:{adv:{showRewardedVideo(options){callbacks=options.callbacks;}}}});
  await rewardedResults(h);t.mock.timers.enable({apis:['setTimeout']});t.after(()=>callbacks?.onError());
  const pending=h.api.handleGarageAction({type:'rewardedBonus'}).then(()=>{finished=true;});callbacks.onOpen();
  t.mock.timers.tick(90000);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.api.state.loading.adPending,true);assert.equal(h.api.state.busy,true);
  assert.equal(h.api.state.lifecycle.has('ad'),true);assert.equal(finished,false);
  h.replaceCloud(createProfile({id:'replacement_after_reward_timeout'}));
  const replacement=h.profileStore.get(),queues=h.cloudSaves.length;
  callbacks.onRewarded();await Promise.resolve();
  assert.equal(h.api.state.busy,true);assert.equal(h.api.state.lifecycle.has('ad'),true);
  assert.equal(finished,false);assert.deepEqual(h.profileStore.get(),replacement);
  callbacks.onClose(true);await pending;
  assert.equal(finished,true);assert.equal(h.api.state.loading.adPending,false);
  assert.equal(h.api.state.busy,false);assert.equal(h.api.state.lifecycle.has('ad'),false);
  assert.deepEqual(h.profileStore.get(),replacement);assert.equal(h.cloudSaves.length,queues);
  assert.equal(h.api.state.run,null);assert.equal(h.api.state.runResult,null);assert.equal(h.api.state.screen,'hub');
});

/** Exercise every settings entry point, including the hidden legacy menu controls. */
const settingsControls=[
  {name:'camera button',event:'cameraBtn:click',key:'cameraMode',value:'cockpit'},
  {name:'sound button',event:'soundBtn:click',key:'sound',value:true},
  {name:'route button',event:'route-neon:click',key:'route',value:'neon'},
  {name:'difficulty button',event:'difficulty-rush:click',key:'difficulty',value:'rush'},
  {name:'quality selector',event:'renderQuality:change',key:'renderQuality',value:'high'},
  {name:'garage settings',key:'cameraMode',value:'cockpit'},
];
/** Deliver an ordinary control event without bypassing the production controller handler. */
async function changeSetting(h,control){
  if(control.event)await h.listeners.get(control.event)({target:{value:control.value}});
  else await h.api.handleGarageAction({type:'settings',key:control.key,value:control.value});
}
/** Observe all runtime settings mirrors separately from the accepted profile. */
function settingsMirrors(h){
  const {settings,storage,renderer,audio,ui}=h.api.state;
  return {settings:structuredClone(settings),legacy:storage.get(),camera:renderer.cameraMode,
    route:renderer.route,quality:renderer.quality,audio:audio.enabled,
    cameraButton:ui.cameraMode,soundButton:ui.soundEnabled,notice:ui.lastNotice};
}

for(const control of settingsControls)test(`${control.name} queues its accepted profile and updates settings mirrors immediately`,async()=>{
  const h=await controller();await h.api.startRun();
  const queuesBefore=h.cloudSaves.length,revisionBefore=h.profileStore.get().revision;
  await changeSetting(h,control);
  const profile=h.profileStore.get(),{settings,storage,renderer,audio}=h.api.state;
  assert.equal(profile.settings[control.key],control.value);
  assert.equal(profile.revision,revisionBefore+1);
  assert.equal(h.cloudSaves.length,queuesBefore+1,'the control must queue without another gameplay action');
  assert.deepEqual(h.cloudSaves.at(-1),profile,'only the current accepted snapshot may be queued');
  assert.equal(settings[control.key],control.value);assert.equal(storage.get()[control.key],control.value);
  assert.equal(renderer.cameraMode,profile.settings.cameraMode);assert.equal(renderer.route,profile.settings.route);
  assert.equal(renderer.quality,profile.settings.renderQuality);assert.equal(audio.enabled,profile.settings.sound);
  // Leaving gameplay enables ordinary platform emissions to hydrate the profile again.
  await h.api.handleAction('menu');h.setPlatformState({});await Promise.resolve();h.setPlatformState({});
  assert.equal(h.api.state.settings[control.key],control.value);
  assert.equal(h.api.state.garageUI.view.settings[control.key],control.value);
});

for(const control of settingsControls)test(`${control.name} leaves profile and settings mirrors unchanged when its reducer rejects`,async()=>{
  const h=await controller();await h.api.startRun();
  // A real future-schema profile cannot start; inject that same rejection after a valid run starts.
  h.rejectSettings();
  const profile=h.profileStore.get(),mirrors=settingsMirrors(h),saved=[...h.storageValues],queues=h.cloudSaves.length;
  await changeSetting(h,control);
  assert.deepEqual(h.profileStore.get(),profile);assert.deepEqual(settingsMirrors(h),mirrors);
  assert.deepEqual([...h.storageValues],saved,'rejection must not write a conflicting legacy preference');
  assert.equal(h.cloudSaves.length,queues);assert.match(h.api.state.garageUI.lastNotice,/более новой версией/);
});

test('a genuine future-schema profile rejects the sound handler without changing live or legacy preferences',async()=>{
  const future=JSON.stringify({schemaVersion:999,unknown:'preserve this future save'});
  const h=await controller({initialStorage:{[PROGRESSION_STORAGE_KEY]:future}});
  assert.equal(h.profileStore.status().readOnly,true);
  const profile=h.profileStore.get(),mirrors=settingsMirrors(h),saved=[...h.storageValues];
  await h.listeners.get('soundBtn:click')();
  assert.deepEqual(h.profileStore.get(),profile);assert.deepEqual(settingsMirrors(h),mirrors);
  assert.deepEqual([...h.storageValues],saved);assert.equal(h.storageValues.get(PROGRESSION_STORAGE_KEY),future);
  assert.equal(h.cloudSaves.length,0);assert.match(h.api.state.garageUI.lastNotice,/более новой версией/);
});

test('accepted settings still update runtime and queue cloud sync when local storage is full',async()=>{
  const h=await controller();await h.api.startRun();h.failStorageWrites();
  const queues=h.cloudSaves.length;
  await h.listeners.get('soundBtn:click')();
  assert.equal(h.profileStore.status().localSaved,false);assert.equal(h.profileStore.status().error,'storage-quota');
  assert.equal(h.profileStore.get().settings.sound,true);assert.equal(h.api.state.settings.sound,true);
  assert.equal(h.api.state.audio.enabled,true);assert.equal(h.api.state.ui.soundEnabled,true);
  assert.equal(h.api.state.storage.get().sound,true,'legacy in-memory state remains consistent despite the failed disk write');
  assert.equal(h.cloudSaves.length,queues+1);assert.deepEqual(h.cloudSaves.at(-1),h.profileStore.get());
});

test('unchanged settings do not create a profile revision or an extra cloud save',async()=>{
  const h=await controller(),revision=h.profileStore.get().revision,queues=h.cloudSaves.length;
  await h.api.handleGarageAction({type:'settings',key:'cameraMode',value:'chase'});
  await h.listeners.get('renderQuality:change')({target:{value:'auto'}});
  assert.equal(h.profileStore.get().revision,revision);assert.equal(h.cloudSaves.length,queues);
});

for(const control of settingsControls.slice(0,2))test(`${control.name} alone reaches a durable SDK write through the real cloud adapter`,async t=>{
  const h=await controller({useRealPlatform:true});t.after(()=>h.platformServices.dispose());
  await h.api.startRun();await h.platformServices.flush();
  const writes=h.cloudWrites.length;
  await changeSetting(h,control);
  // Drain only scheduled work. Calling flush here could hide a missing controller queueSave.
  await new Promise(resolve=>setImmediate(resolve));
  const profile=h.profileStore.get(),state=h.platformServices.getState();
  assert.equal(h.cloudWrites.length,writes+1);assert.equal(h.cloudWrites.at(-1).durable,true);
  assert.deepEqual(h.cloudWrites.at(-1).payload[CLOUD_PROFILE_KEY].profile,profile);
  assert.equal(profile.settings[control.key],control.value);assert.equal(state.cloud.status,'durable');
  assert.equal(state.cloud.durableRevision,profile.revision);assert.equal(state.cloud.queuedRevision,null);
});

test('a settings cloud-write failure reports an error without reverting accepted local preferences',async t=>{
  const h=await controller({useRealPlatform:true});t.after(()=>h.platformServices.dispose());
  await h.api.startRun();await h.platformServices.flush();
  const durableRevision=h.platformServices.getState().cloud.durableRevision,writes=h.cloudWrites.length;
  h.failCloudWrites();await h.listeners.get('soundBtn:click')();
  await new Promise(resolve=>setImmediate(resolve));
  const profile=h.profileStore.get(),state=h.platformServices.getState();
  assert.equal(h.cloudWrites.length,writes+1);assert.equal(h.cloudWrites.at(-1).durable,true);
  assert.deepEqual(h.cloudWrites.at(-1).payload[CLOUD_PROFILE_KEY].profile,profile);
  assert.equal(state.cloud.status,'error');assert.equal(state.cloud.error,'cloud-write-failed');
  assert.equal(state.cloud.durableRevision,durableRevision);assert.equal(state.cloud.queuedRevision,profile.revision);
  assert.equal(state.local.localSaved,true);assert.equal(profile.settings.sound,true);
  assert.equal(h.api.state.settings.sound,true);assert.equal(h.api.state.audio.enabled,true);
  assert.equal(h.api.state.storage.get().sound,true);
});


test('actual menu loop pauses workshop media for each lifecycle owner, orientation and settings without overriding another pause',async()=>{
  const {api,setOrientation}=await controller();
  api.tick(16);assert.equal(api.state.garageScene.lastAdvance.visible,true);assert.equal(api.state.garageScene.lastAdvance.mediaActive,true);
  for(const reason of ['ad','platform','hidden','blur','account-selection','payment']){
    api.state.lifecycle.pause(reason);api.tick(32);assert.equal(api.state.garageScene.lastAdvance.mediaActive,false,reason);
    api.state.lifecycle.pause('another-owner');api.state.lifecycle.resume(reason);api.tick(48);assert.equal(api.state.garageScene.lastAdvance.mediaActive,false);
    api.state.lifecycle.resume('another-owner');api.tick(64);assert.equal(api.state.garageScene.lastAdvance.mediaActive,true);
  }
  setOrientation(true);api.tick(80);assert.equal(api.state.garageScene.lastAdvance.visible,false);assert.equal(api.state.garageScene.lastAdvance.mediaActive,false);
  setOrientation(false);api.state.garageUI.settingsOpen=true;api.tick(96);assert.equal(api.state.garageScene.lastAdvance.mediaActive,false);
  api.state.garageUI.settingsOpen=false;api.state.renderer.reducedMotion=true;api.tick(112);assert.equal(api.state.garageScene.lastAdvance.reducedMotion,true);
  await api.startRun();api.tick(128);assert.equal(api.state.garageScene.lastAdvance.visible,false,'Driving never advances a hidden garage film');
});

test('controller miniature pass runs only in visible fleet and honors independent pauses and overlays',async()=>{
  const h=await controller();await h.api.handleGarageAction({type:'navigate',screen:'garage',tab:'fleet'});h.api.tick(100);
  const fleet=h.api.state.fleetMiniatures;assert.equal(fleet.lastUpdate.visible,true);assert.equal(fleet.lastUpdate.paused,false);
  for(const reason of ['ad','hidden','payment','account-selection']){h.api.state.lifecycle.pause(reason);h.api.tick(200);assert.equal(fleet.lastUpdate.paused,true,reason);h.api.state.lifecycle.resume(reason);}
  h.api.state.garageUI.settingsOpen=true;h.api.tick(300);assert.equal(fleet.lastUpdate.paused,true);h.api.state.garageUI.settingsOpen=false;
  h.setOrientation(true);h.api.tick(400);assert.equal(fleet.lastUpdate.visible,false);h.setOrientation(false);
  await h.api.handleGarageAction({type:'navigate',screen:'garage',tab:'style'});h.api.tick(500);assert.equal(fleet.lastUpdate.visible,false);
});
test('controller miniature cache scope changes on profile replacement, not a local selection',async()=>{
  const h=await controller();h.api.syncFleetMiniatures([]);const first=h.api.state.fleetMiniatures.scope;
  h.api.syncFleetMiniatures([]);assert.equal(h.api.state.fleetMiniatures.scope,first);
  const profile=createProfile({id:'other_profile',now:100});h.replaceCloud(profile);h.api.syncFleetMiniatures([]);assert.notEqual(h.api.state.fleetMiniatures.scope,first);assert.match(h.api.state.fleetMiniatures.scope,/^other_profile:/);
});

test('successive touch selections survive old-row blur and return after the bounded visual turn',async()=>{
  const h=await controller();await h.api.handleGarageAction({type:'navigate',screen:'garage',tab:'fleet'});const send=h.api.state.garageUI.options.onMiniatureInteraction;
  send('rocket','touch');send('rocket','focus');assert.equal(h.api.state.fleetMiniatures.activeId,'rocket');
  send('hatch','touch');send(null,'focus');send('hatch','focus');assert.equal(h.api.state.fleetMiniatures.activeId,'hatch');assert.equal(h.api.state.fleetTouchRemaining,1.8);
  for(let i=1;i<=30;i++)h.api.tick(i*100);assert.equal(h.api.state.fleetMiniatures.activeId,null);assert.equal(h.api.state.fleetTouchRemaining,0);
  send('sedan','touch');send('van','focus');assert.equal(h.api.state.fleetMiniatures.activeId,'van');assert.equal(h.api.state.fleetTouchRemaining,0,'Deliberate keyboard focus takes over');
});

test('free finish settles once without requesting ads and later transition retains qualified interstitial cadence',async()=>{
  let interstitials=0,rewarded=0;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){rewarded++;o.callbacks.onClose(false);},showFullscreenAdv(o){interstitials++;o.callbacks.onClose(true);}}}});
  for(let attempt=0;attempt<3;attempt++){
    await rewardedResults(h);const {game,telemetry}=h.api.state;
    // Build genuine additional active seconds to meet the established cadence, not wall-clock waiting.
    for(let i=0;i<250;i++){game.state.phase='playing';game.state.traffic=[];game.state.nextSpawn=Infinity;game.state.nextEvent=Infinity;game.update(.05,{throttle:1});telemetry.observe(game.state,.05);}game.crash();h.api.showResults();
    const before=h.profileStore.get(),identity=h.api.state.runResult.runIdentity;
    await h.api.handleGarageAction({type:'finishRun'});await h.api.handleGarageAction({type:'finishRun'});
    assert.equal(rewarded,0);assert.equal(interstitials,0);assert.equal(h.api.state.screen,'results');assert.equal(h.api.state.run,null);
    assert.equal(h.profileStore.get().wallet.credits,before.wallet.credits);assert.equal(h.profileStore.get().ledger.finalizedThrough,identity.sequence);
    assert.equal(h.api.state.runResult.finalized,true);assert.equal(h.api.state.runResult.bonusEligible,false);assert.equal(h.api.state.runResult.canRevive,false);
  }
  await h.api.handleGarageAction({type:'navigate',screen:'garage',tab:'fleet'});assert.equal(interstitials,1);assert.equal(h.api.state.screen,'garage');
});

test('doubletap and competing finish/continue/retry intents cannot create a second ad or cross-run grant',async()=>{
  let callbacks,requests=0;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){requests++;callbacks=o.callbacks;}}}});await rewardedResults(h);
  const before=h.profileStore.get(),amount=h.api.state.runResult.bonusCredits,sequence=h.api.state.run.sequence;
  const pending=h.api.handleGarageAction({type:'rewardedBonus'});
  await Promise.all([h.api.handleGarageAction({type:'rewardedBonus'}),h.api.handleGarageAction({type:'finishRun'}),h.api.handleAction('revive'),h.api.startRun()]);
  assert.equal(requests,1);assert.equal(h.api.state.run.sequence,sequence);assert.deepEqual(h.profileStore.get(),before);
  callbacks.onRewarded();callbacks.onRewarded();callbacks.onClose(true);callbacks.onRewarded();await pending;
  assert.equal(h.profileStore.get().wallet.credits,before.wallet.credits+amount);assert.equal(h.api.state.run,null);assert.equal(h.api.state.runResult.finalized,true);
  await h.api.handleGarageAction({type:'rewardedBonus'});await h.api.handleAction('revive');assert.equal(requests,1);
  await h.api.startRun();assert.equal(h.api.state.run.sequence,sequence+1);assert.equal(h.api.state.runResult,null);assert.equal(h.profileStore.get().wallet.credits,before.wallet.credits+amount);
});

for(const terminal of ['onClose','onError','onOffline'])for(const choice of ['rewardedBonus','revive'])test(`${choice} ${terminal} without onRewarded preserves ordinary reward and free finish`,async()=>{
  let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
  const before=h.profileStore.get(),pending=h.api.handleGarageAction({type:choice});callbacks[terminal](false);await pending;
  assert.deepEqual(h.profileStore.get(),before);assert.equal(h.api.state.screen,'results');assert.equal(h.api.state.runResult.canRevive,true);assert.equal(h.api.state.runResult.bonusClaimed,false);assert.equal(h.api.state.busy,false);
  await h.api.handleGarageAction({type:'finishRun'});assert.equal(h.profileStore.get().wallet.credits,before.wallet.credits);assert.equal(h.api.state.runResult.finalized,true);
});

test('SDK absence is explicitly training continuation and never simulated paid-double success',async()=>{
  const h=await controller();await rewardedResults(h);const before=h.profileStore.get();
  assert.equal(h.api.state.runResult.trainingContinue,true);assert.match(h.api.state.runResult.reviveLabel,/Тренировочное/);
  await h.api.handleGarageAction({type:'rewardedBonus'});assert.deepEqual(h.profileStore.get(),before);
  await h.api.handleAction('revive');assert.equal(h.api.state.screen,'playing');assert.equal(h.profileStore.get().ledger.activeRun.finishChoice,'continue');
  h.api.state.game.crash();h.api.showResults();assert.equal(h.api.state.runResult.canRevive,false);assert.equal(h.api.state.runResult.bonusEligible,false);assert.equal(h.api.state.runResult.bonusReason,'continue-chosen');
});

test('a rewarded continuation persists one choice and no second crash can request either reward again',async()=>{
  let callbacks,requests=0;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){requests++;callbacks=o.callbacks;}}}});await rewardedResults(h);
  const before=h.profileStore.get(),identity=h.api.state.run.id,pending=h.api.handleAction('revive');
  callbacks.onRewarded();callbacks.onClose(true);await pending;
  assert.equal(h.api.state.screen,'playing');assert.equal(h.api.state.run.id,identity);assert.equal(h.profileStore.get().wallet.credits,before.wallet.credits);
  assert.equal(h.profileStore.get().ledger.activeRun.finishChoice,'continue');
  const {game,telemetry}=h.api.state;for(let i=0;i<100;i++){game.state.traffic=[];game.update(.05,{throttle:1});telemetry.observe(game.state,.05);}game.crash();h.api.showResults();
  assert.equal(h.api.state.runResult.bonusEligible,false);assert.equal(h.api.state.runResult.canRevive,false);
  const after=h.profileStore.get();await h.api.handleAction('revive');await h.api.handleGarageAction({type:'rewardedBonus'});
  assert.equal(requests,1);assert.deepEqual(h.profileStore.get(),after);assert.equal(after.stats.runs,1);
});

test('result doubling reports local-save failure honestly and remains claimed after safe persistence retry',async()=>{
  let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
  const amount=h.api.state.runResult.bonusCredits,before=h.profileStore.get().wallet.credits;
  h.failStorageWrites();const pending=h.api.handleGarageAction({type:'rewardedBonus'});callbacks.onRewarded();callbacks.onClose(true);await pending;
  assert.equal(h.profileStore.get().wallet.credits,before+amount);assert.equal(h.profileStore.status().localSaved,false);
  assert.equal(h.api.state.runResult.bonusClaimed,true);assert.match(h.api.state.runResult.saveMessage,/этой сессии.*недоступно/);
  await h.api.handleGarageAction({type:'rewardedBonus'});assert.equal(h.profileStore.get().wallet.credits,before+amount);
});

test('navigation reserves its no-ad await before a competing result reward can start',async()=>{
  let requests=0;const h=await controller({sdkApi:{adv:{showRewardedVideo(){requests++;}}}});await rewardedResults(h);
  const before=h.profileStore.get().wallet.credits,pending=h.api.handleGarageAction({type:'navigate',screen:'garage'});
  await h.api.handleGarageAction({type:'rewardedBonus'});await h.api.handleAction('revive');await pending;
  assert.equal(requests,0);assert.equal(h.api.state.screen,'garage');assert.equal(h.profileStore.get().wallet.credits,before);
});

/** Recreate the real controller from the last successful local write, as a document reload would. */
function reloadController(h,options={}){return controller({initialStorage:Object.fromEntries(h.storageValues),...options});}

test('reload restores the pending earned result without settlement, a new sequence or fake physics',async()=>{
 const h=await controller();await rewardedResults(h);const saved=h.profileStore.get(),id=h.api.state.run.id;
 assert.equal(saved.ledger.activeRun.resultPending,true);
 const reloaded=await reloadController(h);
 assert.equal(reloaded.api.state.screen,'results');assert.equal(reloaded.api.state.run.id,id);
 assert.equal(reloaded.api.state.runResult.recoveryKind,'result');assert.equal(reloaded.api.state.runResult.canRevive,false);
 assert.equal(reloaded.api.state.runResult.bonusEligible,true);assert.equal(reloaded.api.state.telemetry,null);
 assert.equal(reloaded.api.state.game.state.phase,'ready');assert.deepEqual(reloaded.profileStore.get(),saved);
 await reloaded.api.handleAction('revive');assert.equal(reloaded.api.state.game.state.phase,'ready');assert.deepEqual(reloaded.profileStore.get(),saved);
});

test('recovered free finish survives another reload and never recounts earned progress',async()=>{
 const h=await controller();await rewardedResults(h);const r=await reloadController(h),before=r.profileStore.get();
 await r.api.handleGarageAction({type:'finishRun'});const after=r.profileStore.get();
 assert.equal(after.wallet.credits,before.wallet.credits);assert.deepEqual(after.stats,before.stats);assert.equal(after.ledger.activeRun,null);
 const again=await reloadController(r);assert.equal(again.api.state.screen,'hub');assert.equal(again.api.state.runResult,null);assert.deepEqual(again.profileStore.get(),after);
});

test('recovered double uses the original receipt exactly once and stays finalized after reload',async()=>{
 const h=await controller();await rewardedResults(h);let callbacks,requests=0;
 const r=await reloadController(h,{sdkApi:{adv:{showRewardedVideo(o){requests++;callbacks=o.callbacks;}}}});
 const before=r.profileStore.get(),amount=r.api.state.runResult.bonusCredits;
 const pending=r.api.handleGarageAction({type:'rewardedBonus'});callbacks.onRewarded();callbacks.onClose(true);await pending;
 assert.equal(requests,1);assert.equal(r.profileStore.get().wallet.credits,before.wallet.credits+amount);assert.deepEqual(r.profileStore.get().stats,before.stats);
 const again=await reloadController(r);assert.equal(again.api.state.screen,'hub');assert.equal(again.profileStore.get().ledger.activeRun,null);
 await again.api.handleGarageAction({type:'rewardedBonus'});assert.equal(again.profileStore.get().wallet.credits,before.wallet.credits+amount);
});

test('reload after choosing continuation exposes only saved earnings, not another continue or double',async()=>{
 const h=await controller();await rewardedResults(h);await h.api.handleAction('revive');
 assert.equal(h.profileStore.get().ledger.activeRun.resultPending,false);
 const r=await reloadController(h),before=r.profileStore.get();
 assert.equal(r.api.state.screen,'results');assert.equal(r.api.state.runResult.recoveryKind,'interrupted');
 assert.equal(r.api.state.runResult.bonusEligible,false);assert.equal(r.api.state.runResult.canRevive,false);
 await r.api.handleGarageAction({type:'rewardedBonus'});await r.api.handleAction('revive');assert.deepEqual(r.profileStore.get(),before);
});

test('ordinary or legacy settled receipts are labelled interrupted and do not fabricate a crash bonus',async()=>{
 const h=await controller();await rewardedResults(h);const raw=h.profileStore.get();delete raw.ledger.activeRun.resultPending;
 const r=await controller({initialProfile:raw});
 assert.equal(r.api.state.screen,'results');assert.equal(r.api.state.runResult.recoveryKind,'interrupted');
 assert.equal(r.api.state.runResult.bonusEligible,false);assert.equal(r.api.state.runResult.newRecord,false);
 assert.equal(r.api.state.runResult.receipt.credits,raw.ledger.activeRun.creditsGranted+raw.ledger.activeRun.onboardingGranted);
});

test('a reload during unconfirmed advertising restores choices but never invents confirmation',async()=>{
 let callbacks;const h=await controller({sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});await rewardedResults(h);
 const before=h.profileStore.get(),pending=h.api.handleGarageAction({type:'rewardedBonus'});callbacks.onOpen();
 let requests=0;const r=await reloadController(h,{sdkApi:{adv:{showRewardedVideo(){requests++;}}}});
 assert.deepEqual(r.profileStore.get(),before);assert.equal(r.api.state.runResult.bonusEligible,true);assert.equal(requests,0);
 callbacks.onError(new Error('old document transport closed'));await pending;
 assert.equal(h.api.state.busy,false);assert.equal(h.api.state.lifecycle.has('ad'),false);assert.deepEqual(r.profileStore.get(),before);
});

test('cloud choice restores only the accepted profile receipt and rejects an old recovered ad callback',async()=>{
 const original=await controller();await rewardedResults(original);let callbacks;
 const r=await reloadController(original,{sdkApi:{adv:{showRewardedVideo(o){callbacks=o.callbacks;}}}});
 const pending=r.api.handleGarageAction({type:'rewardedBonus'});callbacks.onOpen();
 const other=await controller({initialProfile:createProfile({id:'other_saved_profile'})});await rewardedResults(other);
 const accepted=other.profileStore.get();r.replaceCloud(accepted);
 assert.equal(r.api.state.runResult.recovered,true);assert.equal(r.api.state.run.id,accepted.ledger.activeRun.id);
 callbacks.onRewarded();callbacks.onClose(true);await pending;
 assert.deepEqual(r.profileStore.get(),accepted);assert.equal(r.api.state.busy,false);assert.equal(r.api.state.lifecycle.has('ad'),false);
 assert.equal(r.api.state.runResult.bonusClaimed,false);assert.equal(r.api.state.runResult.canRevive,false);
});

test('failed pending-result write is not reported as a durable crash after reload',async()=>{
 const h=await controller();await h.api.startRun();const {game,telemetry}=h.api.state;
 for(let i=0;i<1000;i++){game.update(.05,{throttle:1});telemetry.observe(game.state,.05);}
 h.failStorageWrites();game.crash();h.api.showResults();assert.equal(h.profileStore.status().localSaved,false);
 const r=await reloadController(h);assert.equal(r.api.state.screen,'hub');assert.equal(r.api.state.runResult,null);
 assert.equal(r.profileStore.get().wallet.credits,300);assert.equal(r.profileStore.get().stats.runs,0);
});

test('starting from recovered results is an explicit choice and closes only that prior sequence',async()=>{
 const h=await controller();await rewardedResults(h);const r=await reloadController(h),before=r.profileStore.get();
 assert.equal(r.api.state.screen,'results');await r.api.handleGarageAction({type:'startDrive'});
 assert.equal(r.api.state.screen,'playing');assert.equal(r.api.state.run.sequence,before.ledger.nextSequence);
 assert.equal(r.profileStore.get().ledger.recent.at(-1).sequence,before.ledger.activeRun.sequence);
 assert.equal(r.profileStore.get().wallet.credits,before.wallet.credits);
});

test('recovered result keeps its receipt vehicle when the accepted profile selects another car',async()=>{
 const original=await controller();await rewardedResults(original);
 const accepted=original.profileStore.get();accepted.ownedVehicles.push('hatch');accepted.selectedVehicleId='hatch';
 const r=await controller();r.replaceCloud(accepted);r.api.refreshGarage();
 assert.equal(r.api.state.runResult.vehicleId,'rocket');assert.equal(r.api.state.garageUI.view.vehicle.id,'rocket');
 assert.equal(r.api.state.garageScene.vehicleId,'rocket');assert.equal(r.profileStore.get().selectedVehicleId,'hatch');
 await r.api.handleGarageAction({type:'finishRun'});r.api.refreshGarage();assert.equal(r.api.state.garageUI.view.vehicle.id,'rocket');
 await r.api.handleGarageAction({type:'navigate',screen:'garage'});assert.equal(r.api.state.garageUI.view.vehicle.id,'hatch');
});

for(const action of ['startDrive','navigate'])for(const replacementKind of ['different-profile','identical-identity']){
 test(`${action} stale interstitial preserves the ${replacementKind} recovered receipt`,async()=>{
  let callbacks,requests=0;
  const h=await controller({sdkApi:{adv:{showFullscreenAdv(options){requests++;callbacks=options.callbacks;}}}});
  for(let sequence=1;sequence<=3;sequence++){
   await rewardedResults(h);
   h.api.state.adCadence.completeRun(sequence,{activeSeconds:60,distanceM:600},{reason:'crash'});
  }
  const accepted=h.profileStore.get();
  if(replacementKind==='different-profile')accepted.profileId='replacement_transition_profile';
  const oldCadence=h.api.state.adCadence,pending=h.api.handleGarageAction({type:action,screen:'garage',tab:'fleet'});
  assert.equal(requests,1);assert.equal(h.api.state.busy,true);callbacks.onOpen();
  assert.equal(h.replaceCloud(accepted).ok,true);
  const recovered=h.api.state.runResult,newCadence=h.api.state.adCadence,beforeCadence=newCadence.snapshot();
  assert.equal(h.api.state.screen,'results');assert.equal(recovered.recovered,true);assert.equal(recovered.bonusEligible,true);
  assert.notEqual(newCadence,oldCadence);
  callbacks.onClose(true);await pending;
  assert.deepEqual(h.profileStore.get(),accepted,'the prior transition cannot finalize the accepted receipt or begin another run');
  assert.equal(h.api.state.screen,'results');assert.equal(h.api.state.runResult,recovered);
  assert.equal(recovered.finalized,false);assert.equal(recovered.bonusEligible,true);
  assert.equal(h.api.state.run.id,accepted.ledger.activeRun.id);assert.equal(h.api.state.run.sequence,accepted.ledger.activeRun.sequence);
  assert.equal(h.api.state.game.state.phase,'ready');assert.equal(h.api.state.telemetry,null);
  assert.equal(h.api.state.busy,false);assert.equal(h.api.state.lifecycle.has('ad'),false);
  assert.deepEqual(newCadence.snapshot(),beforeCadence,'an old callback must not write to the replacement cadence');
  assert.equal(oldCadence.snapshot().inFlightSequence,null,'the old cadence owns its terminal callback');
  await h.api.handleGarageAction({type:action,screen:'garage',tab:'fleet'});
  assert.equal(h.api.state.screen,action==='startDrive'?'playing':'garage','an explicit new intent is not blocked by the cancelled transition');
 });

 test(`${action} no-ad await preserves the ${replacementKind} recovered receipt`,async()=>{
  const h=await controller();await rewardedResults(h);
  const accepted=h.profileStore.get();
  if(replacementKind==='different-profile')accepted.profileId='replacement_no_ad_profile';
  const pending=h.api.handleGarageAction({type:action,screen:'garage',tab:'fleet'});
  assert.equal(h.replaceCloud(accepted).ok,true);
  const recovered=h.api.state.runResult;
  assert.equal(recovered.recovered,true);assert.equal(recovered.bonusEligible,true);
  await pending;
  assert.deepEqual(h.profileStore.get(),accepted,'even a resolved no-ad promise is a lineage boundary');
  assert.equal(h.api.state.screen,'results');assert.equal(h.api.state.runResult,recovered);
  assert.equal(recovered.finalized,false);assert.equal(recovered.bonusEligible,true);
  assert.equal(h.api.state.run.id,accepted.ledger.activeRun.id);assert.equal(h.api.state.run.sequence,accepted.ledger.activeRun.sequence);
  assert.equal(h.api.state.game.state.phase,'ready');assert.equal(h.api.state.telemetry,null);assert.equal(h.api.state.busy,false);
  await h.api.handleGarageAction({type:action,screen:'garage',tab:'fleet'});
  assert.equal(h.api.state.screen,action==='startDrive'?'playing':'garage','the aborted no-ad transition releases its operation lock');
 });
}

test('mobile pause sound uses accepted settings and cloud queue while help returns to the same paused run',async()=>{
  const h=await controller();await h.api.startRun();
  h.listeners.get('pauseBtn:click')();
  assert.equal(h.api.state.screen,'paused');assert.equal(h.api.state.ui.modalType,'pause');
  const identity=structuredClone(h.api.state.run),queues=h.cloudSaves.length;
  await h.api.handleAction('pauseSound');
  assert.equal(h.profileStore.get().settings.sound,true);assert.equal(h.api.state.audio.enabled,true);
  assert.equal(h.cloudSaves.length,queues+1);assert.deepEqual(h.cloudSaves.at(-1),h.profileStore.get());
  assert.equal(h.api.state.screen,'paused');assert.equal(h.api.state.lifecycle.paused,true);
  await h.api.handleAction('pauseHelp');assert.equal(h.api.state.ui.modalType,'help');
  assert.equal(h.api.state.lifecycle.paused,true);assert.deepEqual(h.api.state.run,identity);
  await h.api.handleAction('closeHelp');assert.equal(h.api.state.ui.modalType,'pause');
  assert.equal(h.api.state.screen,'paused');assert.equal(h.api.state.lifecycle.paused,true);
  assert.deepEqual(h.api.state.run,identity);assert.equal(h.cloudSaves.length,queues+1);
});

test('pause-only utility actions ignore playing or other modals and never bypass rejected settings',async()=>{
  const h=await controller();await h.api.startRun();
  const before=h.profileStore.get(),queues=h.cloudSaves.length;
  await h.api.handleAction('pauseSound');await h.api.handleAction('pauseHelp');
  assert.deepEqual(h.profileStore.get(),before);assert.equal(h.api.state.screen,'playing');
  h.listeners.get('pauseBtn:click')();h.rejectSettings();
  await h.api.handleAction('pauseSound');assert.deepEqual(h.profileStore.get(),before);
  assert.equal(h.api.state.settings.sound,before.settings.sound);assert.equal(h.cloudSaves.length,queues);
  await h.api.handleAction('pauseHelp');await h.api.handleAction('pauseSound');
  assert.deepEqual(h.profileStore.get(),before);assert.equal(h.api.state.ui.modalType,'help');
});
