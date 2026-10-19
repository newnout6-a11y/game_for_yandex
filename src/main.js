import { recoverPendingRunResult } from './pending-run-result.js';
import { homeVehicleFraming } from './home-framing.js';
import { compactGarageFraming } from './garage-framing.js';
import { createOrientationGate } from './orientation-gate.js';
import { Game } from './game.js';
import { RoadRenderer } from './world.js';
import { loadOwnGames, openOwnGame } from './own-games.js';
import { GarageScene } from './garage-scene.js';
import { bindGarageOrbitInput } from './garage-orbit-input.js';
import { GarageUI } from './garage-ui.js';
import { FleetMiniatures } from './garage-fleet-miniatures.js';
import { RouteVehicleMarker } from './route-vehicle-marker.js';
import { createProgressionStorage } from './progression-storage.js';
import { deriveGarageView, getEngineeringModifiers, getRunDoubleOffer, LIMITS } from './progression.js';
import { CATALOG, ADS, vehicleDefinition } from './progression-catalog.js';
import { RunTelemetry } from './run-telemetry.js';
import { createPlatformServices } from './platform-services.js';
import { createStorage } from './storage.js';
import { createSdk } from './sdk.js';
import { createLifecycle } from './lifecycle.js';
import { createAdCadence } from './ad-cadence.js';
import { createAds } from './ads.js';
import { GameAudio } from './audio.js';
import { UI, cameraShortcutAllowed, glanceShortcutAllowed, CockpitGlanceControls } from './ui.js';
import { DrivingInput } from './input.js';
import { normalizeRenderQuality, observeRenderPixelRatio } from './render-settings.js';

/** Resolve a validated static shell element; the garage presenter creates its own scoped DOM. */
const byId=id=>document.getElementById(id);
const storage=createStorage(), profileStore=createProgressionStorage();
const settings={...storage.get(),...profileStore.get().settings};
const sdk=createSdk(),audio=new GameAudio(settings.sound),input=new DrivingInput();
let otherGames=[],inspection='overview',orientationBlocked=false,mobileControls=false,garageOrbitInput=null;
let screen='loading',tab='fleet',busy=false,assetsReady=false,assetsFailed=false,garageScene=null,platform=null;
let startingRun=false;
let fleetMiniatures=null,fleetTargets=[],fleetVisibilityDirty=true,fleetTouchRemaining=0;
let routeVehicleMarker=null,routeVehicleSelection=null;
let run=null,telemetry=null,runResult=null,runBest=0,continuedBest=0,savedDistance=0,runCounted=false,crashElapsed=0,helpFromGame=false;
let appliedSettingsKey='',appliedSelectedId=profileStore.get().selectedVehicleId;
let appliedProfileId=profileStore.get().profileId,observedNextSequence=profileStore.get().ledger.nextSequence,appliedReplacementEpoch=profileStore.getReplacementEpoch();
let previewId=profileStore.get().selectedVehicleId,loading={progress:0,message:'Подготавливаем мастерскую…'},garageDirty=true;
let adCadence=createAdCadence(ADS.interstitial);
const ui=new UI(action=>void handleAction(action));
const garageUI=new GarageUI({root:byId('garageShell'),onAction:action=>void handleGarageAction(action),onMiniatures:targets=>syncFleetMiniatures(targets),onMiniatureInteraction:(id,kind)=>{if(kind==='focus'&&fleetTouchRemaining>0&&(!id||id===fleetMiniatures?.activeId))return;if(kind==='touch')fleetTouchRemaining=1.8;else fleetTouchRemaining=0;fleetMiniatures?.setInteraction(id);}});
const playButton=byId('playBtn');playButton.disabled=true;
const renderer=new RoadRenderer(byId('scene'),percent=>{loading={progress:Math.round(percent*.85),message:'Модели, материалы и трасса'};refreshGarage();},{quality:settings.renderQuality,cameraMode:settings.cameraMode,onRenderSettings:info=>ui.renderSettings(info)});
const glance=new CockpitGlanceControls(direction=>renderer.setLookDirection(direction));
const game=new Game({onEvent:(event,value,feedback)=>{
  if(event==='boost-empty'){input.releaseEmptyTouchBoost(0);return;}
  // Ordinary passes have no new reward, telemetry observation or audio cue.
  if(event==='pass'){renderer.bonus(event,feedback,game.state);return;}
  telemetry?.event(event,value,game.state);audio.tone(event);renderer.effect(event);
  if(event==='near'||event==='charge'||event==='goal'||(event==='event-clear'&&value.success)){renderer.bonus(event,feedback,game.state);ui.announceBonus(event,value,game.state);}
  if(event==='cone')ui.toast('КОНУС · −50 ОЧКОВ');
  if(event==='event-clear'&&!value.success)ui.toast('СОБЫТИЕ НЕ ПРОЙДЕНО');
}});
const lifecycle=createLifecycle(()=>{
  clearInput();
  if(lifecycle.paused&&garageScene?.advance?.(0,{visible:false}))garageDirty=true;
  if(screen==='playing'&&lifecycle.paused&&lifecycle.reasons().some(reason=>reason!=='orientation')){screen='paused';applyScreen();lifecycle.pause('user');ui.pause();}
  syncGameplay();
});
const ads=createAds({sdk,lifecycle,canShow:()=>!orientationBlocked&&screen==='results'&&!lifecycle.has('payment')&&!lifecycle.has('account-selection')&&!platform?.getState?.().commerce?.busy&&platform?.getState?.().auth!=='pending'});
platform=createPlatformServices({sdk,lifecycle,profileStore,onState:()=>{reconcileProfileLineage();if(assetsReady&&!['playing','paused'].includes(screen)){hydrateStoredSettings();refreshGarage();}}});

const orientationGate=createOrientationGate({window,document,appRoot:byId('app'),onChange:blocked=>{
  orientationBlocked=blocked;clearInput();if(blocked)lifecycle.pause('orientation');else lifecycle.resume('orientation');garageDirty=true;signalReady();
}});
syncMobileControls();
/** Compact arrows are selected by the real touch viewport, never by desktop width alone. */
function syncMobileControls(){const nav=window.navigator||{};const eligible=Number(nav.maxTouchPoints)>0&&matchMedia('(pointer: coarse)').matches&&innerWidth>=innerHeight&&!orientationBlocked;if(mobileControls!==eligible)clearInput();mobileControls=eligible;byId('app').dataset.mobileControls=String(eligible);syncRouteVehicleActivity();}
window.addEventListener('resize',()=>syncMobileControls());
/** Loading completion is sent once only after an interactive landscape entry is available. */
function signalReady(){if(assetsReady&&!orientationBlocked)sdk.ready();}

/** Discard stale physical runs when a chosen cloud save replaces their ledger; never settle old telemetry into a new profile. */
function reconcileProfileLineage(){
  const profile=profileStore.get();
  const replaced=profileStore.getReplacementEpoch()!==appliedReplacementEpoch||profile.profileId!==appliedProfileId||profile.ledger.nextSequence<observedNextSequence||(run&&profile.ledger.activeRun?.id!==run.id);
  appliedProfileId=profile.profileId;observedNextSequence=profile.ledger.nextSequence;appliedReplacementEpoch=profileStore.getReplacementEpoch();
  if(!replaced)return;
  adCadence=createAdCadence(ADS.interstitial);run=null;telemetry=null;runResult=null;routeVehicleSelection=null;routeVehicleMarker?.sync(null);clearInput();
  if(assetsReady){ui.close();game.state.phase='ready';screen='hub';lifecycle.resume('user');restorePendingResult();applyScreen();syncGameplay();}
}
/** Restore only persisted results from the accepted profile, never a fabricated road simulation or fresh award. */
function restorePendingResult(){
  if(!assetsReady||run||['playing','paused'].includes(screen))return false;
  const recovered=recoverPendingRunResult(profileStore.get(),{localSaved:profileStore.status().localSaved});
  if(!recovered)return false;
  run=recovered.run;runResult=recovered.result;telemetry=null;previewId=run.vehicleId;
  game.state.phase='ready';screen='results';clearInput();ui.close();return true;
}
/** Apply accepted local/cloud preferences once without overwriting an intentional unowned-car preview on ordinary save emissions. */
function hydrateStoredSettings(){
  const profile=profileStore.get(),key=JSON.stringify(profile.settings);
  if(appliedSelectedId!==profile.selectedVehicleId){previewId=profile.selectedVehicleId;appliedSelectedId=profile.selectedVehicleId;}
  if(key===appliedSettingsKey)return;
  appliedSettingsKey=key;Object.assign(settings,profile.settings);audio.enabled=settings.sound;
  renderer.setQuality(settings.renderQuality);renderer.setCameraMode(settings.cameraMode);renderer.setRoute(settings.route);ui.sound(settings.sound);garageDirty=true;
}
/** Release input owners at every screen or lifecycle boundary, including mirror glances. */
function clearInput(){garageOrbitInput?.cancel();input.clear();game.releaseControls();glance.clear();}
/** Only genuine active simulation is reported as gameplay or produces engine audio. */
function syncGameplay(){syncMobileControls();const active=screen==='playing'&&!lifecycle.paused&&game.state.phase==='playing';ui.syncBonusAnnouncements(game.state,active);sdk.gameplay(active);audio.update(game.state,active);}
/** Keep legacy driving HUD separate from the new menu; hidden legacy controls cannot receive focus. */
function applyScreen(){
  garageOrbitInput?.cancel();
  const driving=['playing','paused'].includes(screen);ui.setScreen(driving?screen:'menu');
  renderer.setShowcase(!driving);
  byId('menu').hidden=true;byId('hud').hidden=!driving;document.querySelector('.topbar').hidden=!driving;
  byId('app').dataset.screen=screen;garageUI.setVisible(!driving);
  const flight=vehicleDefinition(profileStore.get().selectedVehicleId)?.flight!==false;
  byId('app').dataset.flight=String(flight);byId('cameraBtn').hidden=!driving||!flight;
  document.querySelector('.nitro-hint').textContent=flight?'Нитро + полёт · общий запас':'Нитро · запас энергии';
  byId('runHint').textContent=flight?'W / ↑ — газ · S / ↓ — тормоз · A D / ← → — руль · F — полёт · Q / E — кувырок · C — камера · H — сигнал':'W / ↑ — газ · S / ↓ — тормоз · A D / ← → — руль · SPACE — нитро · H — сигнал';
  if(!driving){glance.clear();renderer.playerMirrors?.suspend?.();}syncRouteVehicleActivity();garageDirty=true;
}
/** Reflect authored capabilities, exact prices and honest platform persistence without computing awards in the UI. */
function refreshGarage(){
  const profile=profileStore.get(),state=platform?.getState?.()||{};
  const displayVehicleId=screen==='results'?(runResult?.vehicleId||run?.vehicleId||previewId):previewId;
  const view=deriveGarageView(profile,{capabilities:profileStore.getCapabilities(),vehicleId:displayVehicleId});
  garageUI.render({...view,catalog:CATALOG,screen,tab,inspection,cloud:state.cloud,selectedVehicle:displayVehicleId,settings:{...settings,runMode:profile.mode},loading,runResult,otherGames,
    platform:{...state,sdk:!!sdk.get(),cloud:state.cloud?.available===true,cloudConnected:['durable','loaded'].includes(state.cloud?.status),cloudStatus:state.cloud?.status,local:profileStore.status(),rewarded:ads?.available===true,payments:false,authenticated:state.auth==='authorized'}});
  garageUI.setBusy(busy);garageDirty=true;
  if(garageScene&&assetsReady&&!['playing','paused'].includes(screen)){
    const id=displayVehicleId||profile.selectedVehicleId,cosmetics=profile.loadouts[id]?.cosmetics||{};
    garageScene.setVehicle(id,cosmetics);garageScene.setParking?.(profile.ownedVehicles.filter(owned=>owned!==id).map(owned=>({id:owned,appearance:profile.loadouts[owned]?.cosmetics||{}})));
    if(garageScene.tier!==profile.garage.level&&garageScene.failedTier!==profile.garage.level&&garageScene.loadingTier!==profile.garage.level)void garageScene.setTier(profile.garage.level).then(()=>{garageDirty=true;});
  }
}
/** Bind real catalog canvases to exact saved appearances; no inventory or selection is changed. */
function syncFleetMiniatures(targets=garageUI.getFleetMiniatureTargets()){
  fleetTargets=targets;fleetVisibilityDirty=true;if(!fleetMiniatures)return;refreshFleetVisibility();
}
/** Lazy snapshots intersect both the workbench and nested Fleet scrollport, not merely the viewport. */
function refreshFleetVisibility(){
  fleetVisibilityDirty=false;if(!fleetMiniatures)return;
  const panel=byId('garageShell').querySelector('.gs-workbench')?.getBoundingClientRect();
  const targets=fleetTargets.map(target=>{const r=target.canvas.getBoundingClientRect(),list=target.canvas.closest('.gs-vehicle-list')?.getBoundingClientRect()||panel;return {...target,visible:!!panel&&!!list&&r.width>0&&r.height>0&&Math.min(r.right,panel.right,list.right,innerWidth)-Math.max(r.left,panel.left,list.left,0)>8&&Math.min(r.bottom,panel.bottom,list.bottom,innerHeight)-Math.max(r.top,panel.top,list.top,0)>8};});
  const profile=profileStore.get();fleetMiniatures.sync(targets,{scopeKey:`${profile.profileId}:${profileStore.getReplacementEpoch()}`});
}
/** The route marker is independent of unowned Fleet previews and follows only the live run. */
function syncRouteVehicleActivity(){
  routeVehicleMarker?.setActivity({visible:mobileControls&&!orientationBlocked&&!document.hidden&&['playing','paused'].includes(screen),paused:screen!=='playing'||lifecycle.paused||busy||!!loading.adPending});
}
/** Queue cloud sync only after the local transactional reducer has accepted a real change. */
function changed(result){
  if(!result.ok){garageUI.notice(({ 'insufficient-credits':'Не хватает кредитов.', 'vehicle-not-owned':'Сначала приобрети автомобиль.', 'level-not-owned':'Сначала открой этот уровень.', 'future-version-read-only':'Это сохранение создано более новой версией игры.' })[result.reason]||'Действие сейчас недоступно.');refreshGarage();return false;}
  if(result.changed)void platform.queueSave(profileStore.get());refreshGarage();return true;
}
/** Commit a preference through the profile reducer before mirroring accepted values to UI, legacy storage and cloud. */
function updateSettings(patch){
  const result=profileStore.dispatch({type:'UPDATE_SETTINGS',settings:patch});
  if(!changed(result)){byId('renderQuality').value=settings.renderQuality;return false;}
  hydrateStoredSettings();storage.settings(profileStore.get().settings);refreshGarage();return true;
}
/** Capture the profile, platform generation and exact result/receipt that owns one asynchronous rewarded request. */
function captureResultContext(){
  const profile=profileStore.get(),state=platform.getState();
  const identity=run?{id:run.id,sequence:run.sequence}:runResult?.runIdentity;
  return {profileId:profile.profileId,replacementEpoch:profileStore.getReplacementEpoch(),generation:state.generation,accountId:state.identity?.id,
    screen,run,result:runResult,identity:identity?{...identity}:null,cadence:adCadence};
}
/** A delayed navigation/start belongs to the exact screen and accepted profile that requested it. */
function transitionContextCurrent(owner){
  const profile=profileStore.get(),state=platform.getState();
  return screen===owner.screen&&run===owner.run&&runResult===owner.result&&profile.profileId===owner.profileId&&
    profileStore.getReplacementEpoch()===owner.replacementEpoch&&state.generation===owner.generation&&state.identity?.id===owner.accountId;
}
/** Reject stale callbacks before settlement; IDs alone cannot distinguish a same-profile cloud rollback or account transition. */
function resultContextCurrent(owner){
  const profile=profileStore.get(),state=platform.getState(),identity=owner.identity;
  if(!identity||screen!=='results'||run!==owner.run||runResult!==owner.result||!runResult)return false;
  const receipt=run?profile.ledger.activeRun:profile.ledger.recent.find(entry=>entry.id===identity.id&&entry.sequence===identity.sequence);
  return profile.profileId===owner.profileId&&profileStore.getReplacementEpoch()===owner.replacementEpoch&&
    state.generation===owner.generation&&state.identity?.id===owner.accountId&&receipt?.id===identity.id&&receipt?.sequence===identity.sequence;
}
/** Explain a confirmed but stale ad result without granting it to a different profile or run. */
function staleRewardNotice(){garageUI.notice('Профиль или заезд изменился. Просмотр не применён к другому результату.');}
/** Close one cumulative receipt only when the player leaves results, never on a revivable crash. */
function finalizeRun(){
  if(!run)return;
  if(telemetry)adCadence.observeRun(run.sequence,telemetry.snapshot());
  if(telemetry)profileStore.settleRun(run,telemetry.finalize(game.state),{finalized:true});
  else profileStore.finalizeRun(run);
  if(runResult){runResult.canRevive=false;runResult.bonusEligible=false;runResult.finalized=true;}
  run=null;telemetry=null;void platform.queueSave(profileStore.get());
}
/** Product-owned cadence at a non-game transition; never an extra launch or mid-race advert. */
/** Await the platform's terminal callback; its request has no cancellation API, so a timeout cannot safely start another race. */
async function requestAd(kind){
  let outcome=await ads[kind]();
  if(outcome.pending){loading={...loading,adPending:true,error:'Платформа не завершила запрос рекламы. Заезд сохранён. Можно дождаться ответа или перезагрузить игру.'};refreshGarage();outcome=await outcome.completion;loading={...loading,adPending:false,error:null};refreshGarage();}
  return outcome;
}
async function transitionAd(action='continue'){
  if(orientationBlocked||screen!=='results'||platform.getState().commerce?.busy)return;
  const sequence=run?.sequence||runResult?.runIdentity?.sequence;
  const cadence=adCadence;
  const decision=cadence.beginTransition({sequence,screen,action,sdkAvailable:ads.interstitialAvailable===true});
  if(!decision.eligible)return;
  busy=true;garageUI.setBusy(true,'Реклама платформы…');
  try{const result=await requestAd('interstitial');cadence.settleInterstitial(result,sequence);}
  finally{busy=false;garageUI.setBusy(false);}
}
/** Begin an owned car with bounded research and a durable monotonic run identity; free stock mode ignores tuning. */
async function startRun(){
  if(orientationBlocked||busy||startingRun||!assetsReady||assetsFailed)return;
  // Reserve before even a no-ad await; the ad's busy owner cannot release this operation.
  startingRun=true;const owner=captureResultContext();
  try{
    await transitionAd();if(orientationBlocked||!transitionContextCurrent(owner))return;finalizeRun();
    const profile=profileStore.get(),id=profile.selectedVehicleId;previewId=id;
    const opened=profileStore.beginRun({vehicleId:id,mode:profile.mode,difficulty:settings.difficulty,route:settings.route});
    if(!opened.ok){garageUI.notice('Не удалось открыть заезд. Проверь сохранение.');return;}
    run=opened.run;telemetry=new RunTelemetry();runResult=null;
    // The previous phase is closed before reconfiguration; no live car can change dimensions mid-run.
    game.state.phase='ready';game.configureVehicle(id,getEngineeringModifiers(profile,id,profile.mode));game.reset(settings.difficulty);
    renderer.selectOwnedVehicle(id,profile.loadouts[id]?.cosmetics);renderer.setRoute(settings.route);renderer.setCameraMode(settings.cameraMode);
    // Freeze precisely the loadout used by the real run; garage browsing must never replace it.
    routeVehicleSelection={id:renderer.playerVehicleId,appearance:{...profile.loadouts[id]?.cosmetics},scopeKey:`${profile.profileId}:${profileStore.getReplacementEpoch()}`};
    routeVehicleMarker?.sync(routeVehicleSelection);
    game.start();runBest=profile.records[profile.mode]?.[`${id}:${settings.difficulty}`]?.score||0;continuedBest=profile.records.continued?.[`${id}:${settings.difficulty}`]?.score||0;savedDistance=0;runCounted=false;crashElapsed=0;
    ui.close();clearInput();lifecycle.resume('user');screen='playing';applyScreen();ui.hud(game.state);void audio.unlock();
    if(lifecycle.paused){screen='paused';applyScreen();lifecycle.pause('user');ui.pause();}
    syncGameplay();renderer.resize();void platform.queueSave(profileStore.get());
  }finally{startingRun=false;}
}
/** Save only the production telemetry delta; revive reuses both its run ID and counters. */
function saveRun({resultPending=false}={}){
  if(!run||!telemetry)return null;
  telemetry.observe(game.state,0);adCadence.observeRun(run.sequence,telemetry.snapshot());const result=profileStore.settleRun(run,telemetry.snapshot(),{resultPending});
  if(game.state.elapsed>0){storage.finish(game.state.score,game.state.distance-savedDistance,game.difficulty,!runCounted);savedDistance=game.state.distance;runCounted=true;}
  void platform.queueSave(profileStore.get());return result;
}
/** Show earned cumulative credits/XP and optional, separately idempotent ad actions after crash. */
function showResults(){
  const result=saveRun({resultPending:true}),metrics=telemetry?.snapshot()||{},receipt=result?.receipt||{};
  const offer=getRunDoubleOffer(profileStore.get(),receipt);
  if(run)adCadence.completeRun(run.sequence,metrics,{reason:'crash'});
  runResult={vehicleId:run?.vehicleId,runIdentity:run?{id:run.id,sequence:run.sequence}:null,score:game.state.score,distance:metrics.distanceM,flightTime:metrics.airSeconds,metrics:{...metrics},newRecord:game.state.score>(game.state.revives>0?continuedBest:runBest),modified:run?.mode==='tuned',continued:game.state.revives>0,
    settled:result?.ok===true,receipt:{credits:(receipt.creditsGranted||0)+(receipt.onboardingGranted||0),baseCredits:receipt.creditsGranted||0,xp:receipt.xpGranted||0},onboarding:receipt.onboardingGranted||0,
    canRevive:result?.ok===true&&game.state.revives<1&&!receipt.finishChoice,reviveLabel:ads.available?'Видео → продолжить заезд':'Тренировочное продолжение',trainingContinue:!ads.available,
    bonusEligible:result?.ok===true&&offer.eligible,bonusCredits:offer.credits,bonusReason:offer.reason,bonusClaimed:false,finalized:false,
    saveMessage:profileStore.status().localSaved?'Сохранено на этом устройстве.':'Учтено в этой сессии. Локальное сохранение недоступно.'};
  screen='results';clearInput();ui.close();applyScreen();syncGameplay();refreshGarage();
}
/** Pause until explicit resume while retaining other independent platform and document blockers. */
function pauseRun(reason='user'){if(screen==='playing')lifecycle.pause('user');if(reason!=='user')lifecycle.pause(reason);}
/** Change the saved view only for the authored Rocket cockpit, without altering simulation. */
function toggleCamera(){
  if(busy||!['playing','paused'].includes(screen)||!vehicleDefinition(game.state.vehicleId)?.cockpit)return;
  if(!ui.overlay.hidden&&ui.modalType!=='pause')return;
  if(!updateSettings({cameraMode:settings.cameraMode==='cockpit'?'chase':'cockpit'}))return;
  ui.camera(settings.cameraMode);ui.notice(settings.cameraMode==='cockpit'?'Выбран вид из кабины':'Выбрана внешняя камера');
}
/** Use the same transactional sound preference from the toolbar and mobile pause menu. */
async function toggleSound(){
  if(!updateSettings({sound:!settings.sound}))return;
  await audio.unlock();syncGameplay();
  ui.notice(settings.sound?'Звук включён':'Звук выключен');
}
/** Enable deliberate held glances only when the actual Rocket eye is active and gameplay has focus. */
function syncGlanceControls(){
  const visible=renderer.playerVehicleId==='rocket'&&renderer.cameraMode==='cockpit'&&['playing','paused'].includes(screen);
  const enabled=visible&&screen==='playing'&&!lifecycle.paused&&!busy&&ui.overlay.hidden&&game.state.phase==='playing'&&!game.state.rolling&&renderer.effectiveCameraMode==='cockpit';
  glance.setEnabled(enabled);ui.glance(visible,enabled,glance.direction);
}
/** Preserve legacy driving modal actions while new menu progression is owned by its reducer. */
async function handleAction(action){
  if(busy||startingRun)return;
  if(action==='retry'){if(screen==='results')await startRun();}
  else if(action==='revive'){
    if(screen!=='results'||!runResult?.canRevive||!run||game.state.phase!=='crashed')return;
    const owner=captureResultContext();busy=true;refreshGarage();
    try{
      if(ads.available){const result=await requestAd('rewarded');owner.cadence.recordRewarded(result);if(!resultContextCurrent(owner)){staleRewardNotice();return;}if(result?.rewarded!==true){garageUI.notice('Просмотр не подтверждён. Можно завершить заезд и оставить заработанное.');return;}}
      if(!resultContextCurrent(owner)){staleRewardNotice();return;}
      const continued=profileStore.dispatch({type:'CONTINUE_RUN',runId:owner.identity.id,runSequence:owner.identity.sequence});
      if(!continued.ok){changed(continued);return;}
      runResult.canRevive=false;runResult.bonusEligible=false;runResult.bonusReason='continue-chosen';
      void platform.queueSave(profileStore.get());
      if(game.revive()){clearInput();ui.close();screen='playing';applyScreen();if(lifecycle.paused){lifecycle.pause('user');screen='paused';applyScreen();ui.pause();}syncGameplay();}
    }finally{busy=false;refreshGarage();}
  }else if(action==='resume'){
    if(screen!=='paused')return;if(lifecycle.reasons().some(reason=>reason!=='user')){ui.notice('Дождись закрытия окна платформы и вернись в игру.');return;}
    clearInput();ui.close();screen='playing';lifecycle.resume('user');applyScreen();syncGameplay();void audio.unlock();
  }else if(action==='menu'){
    if(['playing','paused'].includes(screen))saveRun();finalizeRun();ui.close();screen='hub';clearInput();lifecycle.resume('user');applyScreen();syncGameplay();refreshGarage();
  }else if(action==='camera'){if(ui.modalType==='pause')toggleCamera();}
  else if(action==='pauseSound'){if(screen==='paused'&&ui.modalType==='pause')await toggleSound();}
  else if(action==='pauseHelp'){if(screen==='paused'&&ui.modalType==='pause'){helpFromGame=true;ui.help();}}
  else if(action==='closeHelp'){ui.close();if(helpFromGame)ui.pause();helpFromGame=false;}
}
/** Translate UI intents into validated economy actions; no DOM value directly awards credits or paid entitlements. */
async function handleGarageAction(action){
  if(orientationBlocked||!action)return;if(action.type==='retryLoad'&&loading.adPending){location.reload();return;}if(busy||startingRun)return;
  if(action.type==='retryLoad'){if(assetsReady&&garageScene){garageScene.failedTier=null;void garageScene.setTier(profileStore.get().garage.level).then(ok=>{if(ok)loading={...loading,error:null};refreshGarage();});}else location.reload();return;}
  if(action.type==='startDrive'){await startRun();return;}
  if(action.type==='revive'){await handleAction('revive');return;}
  if(action.type==='finishRun'){
    if(screen!=='results'||!runResult||runResult.finalized)return;
    finalizeRun();runResult.saveMessage=profileStore.status().localSaved?'Награда сохранена на этом устройстве.':'Награда учтена в этой сессии. Локальное сохранение недоступно.';
    refreshGarage();return;
  }
  if(action.type==='navigate'){
    const keepPreview=screen==='garage'&&action.screen==='garage',owner=captureResultContext();startingRun=true;
    try{await transitionAd('menu');if(!transitionContextCurrent(owner))return;finalizeRun();screen=action.screen==='garage'?'garage':'hub';tab=action.tab||tab;if(screen==='hub'||tab!=='style'){inspection='overview';garageScene?.setInspection?.('overview');}if(!keepPreview)previewId=profileStore.get().selectedVehicleId;applyScreen();refreshGarage();}
    finally{startingRun=false;}return;
  }
  if(action.type==='inspectVehicle'){inspection=garageScene?.setInspection?.(action.view)||'overview';refreshGarage();return;}
  if(action.type==='selectVehicle'){inspection='overview';garageScene?.setInspection?.('overview');previewId=action.id;if(profileStore.get().ownedVehicles.includes(action.id))changed(profileStore.dispatch({type:'SELECT_VEHICLE',vehicleId:action.id}));else refreshGarage();return;}
  if(action.type==='settings'){
    if(action.key==='runMode')changed(profileStore.dispatch({type:'SET_MODE',mode:action.value}));
    else updateSettings({[action.key]:action.value});return;
  }
  if(action.type==='retryCloud'){busy=true;refreshGarage();try{await platform.retryCloud();}finally{busy=false;refreshGarage();}return;}
  if(action.type==='cloudConnect'){busy=true;refreshGarage();try{await platform.authorize({userInitiated:true});}finally{busy=false;refreshGarage();}return;}
  if(action.type==='resolveCloudConflict'){await platform.resolveCloudConflict(action.choice);reconcileProfileLineage();hydrateStoredSettings();previewId=profileStore.get().selectedVehicleId;refreshGarage();return;}
  if(action.type==='openOtherGame'){openOwnGame(otherGames,action.id,{screen});return;}
  if(action.type==='purchaseProduct'){garageUI.notice('Покупки за реальные деньги ещё не настроены.');return;}
  if(action.type==='rewardedBonus'){
    if(screen!=='results'||!runResult?.bonusEligible||runResult.bonusClaimed||!ads.available||!run)return;
    const offer=getRunDoubleOffer(profileStore.get());if(!offer.eligible){runResult.bonusEligible=false;runResult.bonusReason=offer.reason;refreshGarage();return;}
    const owner=captureResultContext();if(!owner.identity)return;busy=true;refreshGarage();
    try{
      const result=await requestAd('rewarded');owner.cadence.recordRewarded(result);
      if(!resultContextCurrent(owner)){staleRewardNotice();return;}
      if(result?.rewarded!==true){garageUI.notice('Просмотр не подтверждён. Удвоения нет, заработанное остаётся у тебя.');return;}
      const identity=owner.identity;
      const grant=profileStore.dispatch({type:'CLAIM_AD_BONUS',runId:identity.id,runSequence:identity.sequence});
      if(grant.ok){
        runResult.bonusClaimed=true;runResult.bonusEligible=false;runResult.canRevive=false;runResult.finalized=true;
        runResult.receipt.credits+=grant.rewardDelta?.credits||0;runResult.bonusCredits=grant.rewardDelta?.credits||0;
        run=null;telemetry=null;
        runResult.saveMessage=profileStore.status().localSaved?'Удвоение сохранено на этом устройстве.':'Удвоение учтено в этой сессии. Локальное сохранение недоступно.';
      }
      changed(grant);
    }finally{busy=false;refreshGarage();}return;
  }
  const translated={resetCosmetic:{type:'UNEQUIP_COSMETIC',slot:action.slot,vehicleId:previewId},purchaseVehicle:{type:'BUY_VEHICLE',vehicleId:action.id},buyCosmetic:{type:'BUY_COSMETIC',cosmeticId:action.id,vehicleId:previewId},equipCosmetic:{type:'EQUIP_COSMETIC',cosmeticId:action.id,vehicleId:previewId},upgradeEngineering:{type:'BUY_RESEARCH',branchId:action.branch,expectedLevel:action.expectedLevel},equipEngineering:{type:'EQUIP_RESEARCH',branchId:action.branch,level:action.level,vehicleId:previewId},upgradeGarage:{type:'UPGRADE_GARAGE',expectedLevel:action.expectedLevel},claimContract:{type:'CLAIM_CONTRACT',contractId:action.id},claimSeason:{type:'CLAIM_SEASON',rewardId:action.id},equipBadge:{type:'EQUIP_BADGE',badgeId:action.id},savePreset:{type:'SAVE_PRESET',name:action.name,vehicleId:previewId},applyPreset:{type:'APPLY_PRESET',presetId:action.id}}[action.type];
  if(translated&&changed(profileStore.dispatch(translated))){if(action.type==='purchaseVehicle'){profileStore.dispatch({type:'SELECT_VEHICLE',vehicleId:action.id});previewId=action.id;void platform.queueSave(profileStore.get());refreshGarage();}if(action.type==='applyPreset'){previewId=profileStore.get().selectedVehicleId;refreshGarage();}}
}
/** Keep legacy settings helpers functional in the pause panel without re-exposing the old title menu. */
function refreshMenu(){ui.menu({...settings,best:storage.get().best});renderer.setRoute(settings.route);refreshGarage();}
byId('playBtn').addEventListener('click', startRun);
byId('pauseBtn').addEventListener('click', () => pauseRun());
byId('cameraBtn').addEventListener('click', toggleCamera);
byId('cameraBtn').addEventListener('keydown', event => {
  // Keep native button activation: Space must click the focused camera toggle, not hold nitro.
  if (['Enter', 'Space'].includes(event.code)) event.stopPropagation();
});
byId('helpBtn').addEventListener('click', () => {
  helpFromGame = screen === 'playing' || screen === 'paused';
  if (screen === 'playing') pauseRun();
  ui.help();
});
byId('soundBtn').addEventListener('click', toggleSound);
byId('fullscreenBtn').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else ui.notice('Полный экран недоступен в этом браузере.');
  } catch { ui.notice('Браузер не разрешил полный экран.'); }
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  byId('fullscreenBtn').setAttribute('aria-label', active ? 'Выйти из полного экрана' : 'На весь экран');
  renderer.resize();
});
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); void handleAction('menu'); });
for (const button of document.querySelectorAll('[data-route]')) button.addEventListener('click', () => {
  if(updateSettings({route:button.dataset.route}))refreshMenu();
});
for (const button of document.querySelectorAll('[data-difficulty]')) button.addEventListener('click', () => {
  if(updateSettings({difficulty:button.dataset.difficulty}))refreshMenu();
});
byId('renderQuality').addEventListener('change', event => {
  updateSettings({renderQuality:normalizeRenderQuality(event.target.value)});
});
/**
 * Apply a short swipe-derived steering pulse only while simulation is actively playing.
 * @param {number} direction - Signed horizontal swipe direction.
 */
function steer(direction) { if (screen === 'playing' && !lifecycle.paused) game.steer(direction); }
document.addEventListener('keydown', event => {
  if (cameraShortcutAllowed(event, screen, !ui.overlay.hidden)) { event.preventDefault(); toggleCamera(); return; }
  if (['KeyZ', 'KeyX'].includes(event.code)) {
    syncGlanceControls();
    if (glance.enabled && glanceShortcutAllowed(event, screen, !ui.overlay.hidden)) {
      event.preventDefault();
      glance.set(event.code === 'KeyZ' ? -1 : 1, 'key-' + event.code, true);
      syncGlanceControls();
    }
    return;
  }
  if (!ui.overlay.hidden) return;
  if (screen === 'hub' && event.code === 'Enter' && !event.target.closest('button, a, select, summary, input, textarea')) { event.preventDefault(); startRun(); return; }
  if (screen !== 'playing') return;
  if (input.key(event.code,true)) event.preventDefault();
  if (!event.repeat && ['Escape', 'KeyP'].includes(event.code)) { event.preventDefault(); pauseRun(); }
});
document.addEventListener('keyup', event => { input.key(event.code,false); glance.release('key-' + event.code); });
const controlBindings = [['leftBtn','left'],['rightBtn','right'],['gasBtn','gas'],['brakeBtn','brake'],['boostBtn','boost'],['flightBtn','flight'],['rollLeftBtn','rollLeft'],['rollRightBtn','rollRight'],['hornBtn','horn']];
for (const [id,action] of controlBindings) {
  const button=byId(id);
  button.addEventListener('pointerdown',event=>{
    event.preventDefault();if(screen!=='playing'||lifecycle.paused||event.button>0||button.disabled||button.getAttribute('aria-disabled')==='true')return;
    if(event.pointerType==='touch')input.setTouch(action,'pointer-'+event.pointerId,true);else input.set(action,'pointer-'+event.pointerId,true);
    try { button.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events have no active capture. */ }
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,event=>input.set(action,'pointer-'+event.pointerId,false));
  button.addEventListener('keydown',event=>{
    if(!['Enter','Space'].includes(event.code)||screen!=='playing'||lifecycle.paused)return;
    event.preventDefault();event.stopPropagation();
    if(button.disabled||button.getAttribute('aria-disabled')==='true')return;
    input.set(action,id+'-'+event.code,true);
  });
  button.addEventListener('keyup',event=>{ if(['Enter','Space'].includes(event.code)){event.preventDefault();event.stopPropagation();input.set(action,id+'-'+event.code,false);} });
  button.addEventListener('blur',()=>{input.set(action,id+'-Enter',false);input.set(action,id+'-Space',false);});
}
// Dedicated held glances never enter DrivingInput and never turn scene swipes into drag-look.
for (const [id, direction] of [['lookLeftBtn', -1], ['lookRightBtn', 1]]) {
  const button = byId(id);
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    syncGlanceControls();
    if (!glance.enabled || event.button > 0 || button.disabled) return;
    glance.set(direction, 'pointer-' + event.pointerId, true);
    try { button.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active capture. */ }
    syncGlanceControls();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, event => {
    glance.release('pointer-' + event.pointerId);
    syncGlanceControls();
  });
  button.addEventListener('keydown', event => {
    if (!['Enter', 'Space'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    syncGlanceControls();
    if (event.repeat || !glance.enabled || button.disabled) return;
    glance.set(direction, id + '-' + event.code, true);
    syncGlanceControls();
  });
  button.addEventListener('keyup', event => {
    if (!['Enter', 'Space'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    glance.release(id + '-' + event.code);
    syncGlanceControls();
  });
  button.addEventListener('blur', () => {
    glance.release(id + '-Enter'); glance.release(id + '-Space');
    syncGlanceControls();
  });
}
for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, event => {
  // Each pointer owns one source; releasing it must not cancel other fingers.
  input.release('pointer-' + event.pointerId);
  glance.release('pointer-' + event.pointerId);
});
let gesture = null;
byId('scene').addEventListener('pointerdown', event => {
  if (screen !== 'playing') return;
  gesture = { x: event.clientX, y: event.clientY };
  byId('scene').setPointerCapture(event.pointerId);
});
byId('scene').addEventListener('pointerup', event => {
  if (!gesture) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) steer(Math.sign(dx));
  gesture = null;
});
byId('scene').addEventListener('pointercancel', () => { gesture = null; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInput(); gesture = null; pauseRun('hidden'); }
  else lifecycle.resume('hidden');
});
window.addEventListener('pagehide',event=>{ui.clearBonusAnnouncements(!event.persisted);if(!event.persisted){routeVehicleMarker?.dispose();fleetMiniatures?.dispose();}});
window.addEventListener('pageshow', () => syncGameplay());
window.addEventListener('blur', () => { clearInput(); gesture = null; pauseRun('blur'); });
window.addEventListener('focus', () => lifecycle.resume('blur'));
sdk.on('game_api_pause', () => pauseRun('platform'));
sdk.on('game_api_resume', () => lifecycle.resume('platform'));
window.addEventListener('resize', () => {renderer.resize();garageDirty=true;fleetVisibilityDirty=true;});
observeRenderPixelRatio(() => renderer.resize());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { renderer.reducedMotion = event.matches; renderer.needsRender = true; });

applyScreen();refreshMenu();
/** Complete interactive startup before notifying the platform; workshop failures have a real retry state. */
async function initialize(){
  try{
    await Promise.all([renderer.ready,platform.init()]);
    hydrateStoredSettings();previewId=profileStore.get().selectedVehicleId;
    profileStore.setCapabilities(renderer.cosmeticCapabilities||{});
    garageScene=new GarageScene({renderer:renderer.renderer,compact:renderer.compact,makeVehicle:(id,appearance)=>renderer.createShowcaseVehicle(id,appearance),onStatus:status=>{if(status.error){loading={...loading,error:'Не удалось загрузить мастерскую. Проверь соединение.'};if(assetsReady)garageUI.notice('Новый бокс не загрузился. Сохранение цело, прежний бокс остаётся доступен. Повтори загрузку в разделе бокса.');}garageDirty=true;}});
    fleetMiniatures=new FleetMiniatures({renderer:renderer.renderer,makeVehicle:(id,appearance)=>renderer.createShowcaseVehicle(id,appearance),environment:renderer.scene.environment,onChange:({id,canvas,status})=>{if(!canvas?.isConnected||fleetTargets.find(target=>target.id===id)?.canvas!==canvas)return;canvas.parentElement.dataset.state=status;const label=canvas.parentElement.querySelector('.gs-miniature-status');if(label)label.textContent=status==='error'?'Нет превью':'3D';}});
    routeVehicleMarker=new RouteVehicleMarker({renderer:renderer.renderer,makeVehicle:(id,appearance)=>renderer.createShowcaseVehicle(id,appearance),environment:renderer.scene.environment,canvas:byId('mobileGoalVehicleCanvas'),element:byId('mobileGoalVehicle'),label:byId('mobileGoalVehicleLabel'),status:byId('mobileGoalVehicleStatus')});
    routeVehicleMarker.sync(routeVehicleSelection);syncRouteVehicleActivity();
    loading={progress:90,message:'Открываем бокс…'};refreshGarage();
    garageScene.setVehicle(previewId,profileStore.get().loadouts[previewId]?.cosmetics||{});
    void garageScene.prepareToy();
    if(!await garageScene.setTier(profileStore.get().garage.level))throw new Error('Garage asset unavailable');
    assetsReady=true;void loadOwnGames(sdk).then(games=>{otherGames=games;if(!['playing','paused'].includes(screen))refreshGarage();});playButton.disabled=false;loading={progress:100,message:'Готово'};screen='hub';restorePendingResult();applyScreen();refreshGarage();signalReady();syncGameplay();
  }catch(error){console.error('Interactive startup failed:',error);assetsFailed=true;loading={...loading,error:'Не удалось загрузить игру. Проверь соединение и повтори.'};refreshGarage();}
}
void initialize();
let previous=performance.now();
garageOrbitInput=bindGarageOrbitInput({element:byId('scene'),window,document,enabled:()=>!orientationBlocked&&!document.hidden&&!busy&&!loading.adPending&&!garageUI.settingsOpen&&!garageUI.view?.platform?.conflict&&['hub','garage'].includes(screen),onOrbit:(dx,dy)=>{garageScene?.orbit(dx,dy);garageDirty=true;}});
/** Reserve the real visible inspection rectangle, including the mobile drawer, rather than hiding half the car under UI. */
function garageFraming(){
  if(screen==='hub'){
    const bounds=selector=>document.querySelector(selector)?.getBoundingClientRect();
    const measured=homeVehicleFraming({width:innerWidth,height:innerHeight,header:bounds('.gs-header'),route:bounds('.gs-route-cell'),label:bounds('.gs-hero-vehicle'),actions:bounds('.gs-hub-actions'),footer:bounds('.gs-footer')});
    if(measured)return measured;
  }
  const stage=document.querySelector('.gs-stage');
  if(stage&&screen==='garage'){
    const rect=stage.getBoundingClientRect(),heading=stage.querySelector('.gs-stage-heading')?.getBoundingClientRect(),controls=stage.querySelector('.gs-stage-bottom')?.getBoundingClientRect();
    if(typeof getComputedStyle==='function'&&getComputedStyle(byId('garageShell')).getPropertyValue('--gs-compact-garage').trim()==='1'){
      return compactGarageFraming({stage:rect,controls});
    }
    const top=Math.max(rect.top+12,(heading?.bottom||rect.top+70)+12),bottom=Math.min(rect.bottom-12,(controls?.top||rect.bottom-55)-12);
    return{x:rect.x+20,y:top,width:Math.max(60,rect.width-40),height:Math.max(60,bottom-top)};
  }
  if(innerWidth<700)return{x:18,y:innerHeight*.29,width:innerWidth-36,height:innerHeight*.265};
  return null;
}
byId('garageShell').addEventListener('garage-layout-change',()=>{garageDirty=true;fleetVisibilityDirty=true;});
byId('garageShell').addEventListener('scroll',()=>{fleetVisibilityDirty=true;},true);
/** Advance only live simulation; a settled garage has no recurring render or shadow work. */
function tick(time){
  const dt=Math.min((time-previous)/1000,.1);previous=time;
  const garageVisible=!orientationBlocked&&!document.hidden&&['hub','garage','results'].includes(screen);
  const paintChanged=garageScene?.advance?.(dt,{visible:garageVisible,reducedMotion:renderer.reducedMotion===true,mediaActive:!lifecycle.paused&&!loading.adPending&&!garageUI.settingsOpen});
  if(paintChanged)garageDirty=true;
  if(screen==='playing'&&!lifecycle.paused){game.update(dt,()=>input.read());input.releaseEmptyTouchBoost(game.state.nitro);telemetry?.observe(game.state,dt);if(game.state.phase==='crashed'){clearInput();syncGameplay();crashElapsed+=dt;if(crashElapsed>=.65){crashElapsed=0;showResults();}}}
  if(!orientationBlocked&&['playing','paused'].includes(screen)){
    ui.hud(game.state);
    for(const[id,action]of controlBindings){const held=String(input.active(action)),button=byId(id);if(button.dataset.held!==held)button.dataset.held=held;if(button.getAttribute('aria-pressed')!==held)button.setAttribute('aria-pressed',held);}
    syncGlanceControls();renderer.render(game.state,{dt,paused:screen!=='playing'||lifecycle.paused});
  }else if(!orientationBlocked&&garageScene?.ready&&(garageDirty||renderer.needsRender||garageScene.animating)&&!document.hidden){garageScene.render(innerWidth,innerHeight,garageFraming());garageDirty=false;renderer.needsRender=false;}
  const fleetVisible=garageVisible&&screen==='garage'&&tab==='fleet';
  const fleetPaused=lifecycle.paused||busy||loading.adPending||garageUI.settingsOpen||!!garageUI.view?.platform?.conflict;
  if(fleetVisible&&fleetVisibilityDirty)refreshFleetVisibility();
  if(fleetTouchRemaining>0&&fleetVisible&&!fleetPaused){fleetTouchRemaining=Math.max(0,fleetTouchRemaining-dt);if(!fleetTouchRemaining)fleetMiniatures?.setInteraction(null);}
  fleetMiniatures?.update(dt,{visible:fleetVisible,paused:fleetPaused,reducedMotion:renderer.reducedMotion===true});
  routeVehicleMarker?.update(dt,{visible:mobileControls&&!orientationBlocked&&!document.hidden&&['playing','paused'].includes(screen),paused:screen!=='playing'||lifecycle.paused||busy||!!loading.adPending});
  audio.update(game.state,screen==='playing'&&!lifecycle.paused);requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
