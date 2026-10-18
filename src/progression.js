import { playerConfiguration } from './player-configuration.js';
import { FLIGHT } from './flight.js';
import { CATALOG, FLEET, GARAGE_LEVELS, ENGINEERING, COSMETICS, CONTRACTS, SEASON, BADGES, RUN_REWARDS, ADS, vehicleDefinition, cosmeticDefinition, cosmeticAvailability } from './progression-catalog.js';

export const PROFILE_VERSION = 2;
export const LIMITS = Object.freeze({credits:9999999, metric:1000000000, runDistance:10000000, count:1000000, recentRuns:24, presets:10, profileBytes:190000});
const BRANCHES = ENGINEERING.branches.map(item => item.id);
const MODES = ['standard','tuned'];
const METRICS = ['distanceM','groundDistanceM','airDistanceM','activeSeconds','roadEventsCompleted','precisionLandings','airborneOvertakes','maxCleanGroundSegmentM','rawScore','revives','peakSpeedMps','airSeconds','landings'];
const ADDITIVE = ['distanceM','groundDistanceM','airDistanceM','activeSeconds','roadEventsCompleted','precisionLandings','airborneOvertakes','revives','airSeconds','landings'];
/** Accept only ordinary records; inherited/prototype-key payloads never become profile maps. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
/** Clamp finite numeric state without coercing strings, infinities or negative amounts into currency. */
const number = (value, max=LIMITS.metric) => Number.isFinite(value) && value >= 0 ? Math.min(max,value) : 0;
/** Clamp integer counters used in currency, purchases and monotonic receipts. */
const integer = (value,max=LIMITS.count) => Math.floor(number(value,max));
/** Return an independent JSON-safe snapshot containing no shared mutable references. */
const copy = value => structuredClone(value);
/** Copy a short safe identifier without permitting object prototype keys. */
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !['__proto__','constructor','prototype'].includes(value) ? value : null;
/** Build a fresh per-car setup with no performance upgrades equipped. */
const loadout = () => ({engineering:Object.fromEntries(BRANCHES.map(id=>[id,0])),cosmetics:{'body.paint':'paint_chalk'}});
/** Build empty metric totals shared by run receipts, telemetry sanitation and fresh profiles. */
const emptyMetrics = () => ({...Object.fromEntries(METRICS.map(id=>[id,0])),goalReached:false});
/** Read only supported settings migrated from the original save format. */
function settings(raw) {
  return {route:['ring','neon','dawn'].includes(raw?.route)?raw.route:'ring',difficulty:['flow','rush'].includes(raw?.difficulty)?raw.difficulty:'flow',sound:raw?.sound===true,renderQuality:['auto','high','ultra'].includes(raw?.renderQuality)?raw.renderQuality:'auto',cameraMode:raw?.cameraMode==='cockpit'?'cockpit':'chase'};
}
/** Create a starter profile; the 300-credit wallet is a starting grant, never inferred from legacy scores. */
export function createProfile({now=Date.now(),id='local'}={}) {
  const stamp=integer(now,Number.MAX_SAFE_INTEGER);
  return {schemaVersion:PROFILE_VERSION,profileId:identifier(id)||'local',revision:0,createdAt:stamp,updatedAt:stamp,wallet:{credits:CATALOG.currency.startingBalance,totalEarned:0,totalSpent:0},ownedVehicles:['rocket'],selectedVehicleId:'rocket',mode:'standard',garage:{level:1},research:Object.fromEntries(BRANCHES.map(id=>[id,0])),loadouts:{rocket:loadout()},cosmetics:{owned:['paint_chalk','paint_graphite'],paidPrices:{},presets:[]},contracts:{claims:{}},season:{id:SEASON.id,xp:0,claims:[],badges:[],equippedBadge:null},stats:{...emptyMetrics(),maxRunDistanceM:0,engineeringPurchases:0,runs:0},records:{standard:{},tuned:{},continued:{}},ledger:{nextSequence:1,finalizedThrough:0,activeRun:null,recent:[]},settings:settings(null),legacy:{best:{flow:0,rush:0},migrated:false}};
}
/** Normalize cumulative SI telemetry while bounding values before reward calculations. */
export function sanitizeTelemetry(raw) {
  const out=emptyMetrics(); if(!record(raw))return out;
  for(const key of METRICS)out[key]=number(raw[key],['distanceM','groundDistanceM','airDistanceM','maxCleanGroundSegmentM'].includes(key)?LIMITS.runDistance:LIMITS.metric);
  for(const key of ['roadEventsCompleted','precisionLandings','airborneOvertakes','revives','landings','rawScore'])out[key]=integer(out[key],key==='rawScore'?LIMITS.metric:LIMITS.count);
  out.groundDistanceM=Math.min(out.groundDistanceM,out.distanceM);out.airDistanceM=Math.min(out.airDistanceM,out.distanceM-out.groundDistanceM);
  out.airSeconds=Math.min(out.airSeconds,out.activeSeconds);out.maxCleanGroundSegmentM=Math.min(out.maxCleanGroundSegmentM,out.groundDistanceM);
  out.precisionLandings=Math.min(out.precisionLandings,Math.floor(out.groundDistanceM/RUN_REWARDS.landingRewardMinimumGroundMetres),RUN_REWARDS.maxRewardedLandingsPerKilometre*Math.ceil(out.distanceM/1000),out.landings);
  out.goalReached=raw.goalReached===true&&out.distanceM>=RUN_REWARDS.goalMetres;
  return out;
}
/** Compute base earnings from cumulative telemetry, excluding onboarding, contracts and advertisements. */
export function calculateRunRewards(raw) {
  const t=sanitizeTelemetry(raw);
  const distance=Math.floor(t.distanceM/RUN_REWARDS.metresPerCredit),events=t.roadEventsCompleted*RUN_REWARDS.creditsPerRoadEvent,landings=t.precisionLandings*RUN_REWARDS.creditsPerPrecisionLanding,goal=t.goalReached?RUN_REWARDS.goalCredits:0;
  return {credits:Math.min(LIMITS.credits,distance+events+landings+goal),xp:Math.min(SEASON.xp.maximumPerRun,Math.floor(t.distanceM/SEASON.xp.metresPerXp)+t.roadEventsCompleted*SEASON.xp.perRoadEvent+(t.goalReached?SEASON.xp.goalBonus:0)),breakdown:{distance,events,landings,goal}};
}
/** Preserve actual cumulative grants; prior telemetry independently accounts for rewards lost to caps. */
function receipt(raw) {
  if(!record(raw)||!identifier(raw.id)||!Number.isSafeInteger(raw.sequence)||raw.sequence<1||!vehicleDefinition(raw.vehicleId)||!MODES.includes(raw.mode))return null;
  const telemetry=sanitizeTelemetry(raw.telemetry),reward=calculateRunRewards(telemetry);
  return {id:raw.id,sequence:raw.sequence,vehicleId:raw.vehicleId,mode:raw.mode,difficulty:['flow','rush'].includes(raw.difficulty)?raw.difficulty:'flow',route:settings(raw).route,telemetry,creditsGranted:integer(raw.creditsGranted,reward.credits),xpGranted:integer(raw.xpGranted,reward.xp),counted:raw.counted===true,finalized:raw.finalized===true,adClaimed:raw.adClaimed===true};
}
/** Sanitize a v2 snapshot into a detached bounded profile; unknown versions return null, never downgrade. */
export function sanitizeProfile(raw) {
  if(!record(raw)||raw.schemaVersion!==PROFILE_VERSION||!record(raw.wallet))return null;
  const p=createProfile({now:raw.createdAt,id:raw.profileId});p.revision=integer(raw.revision,Number.MAX_SAFE_INTEGER);p.updatedAt=Math.max(p.createdAt,integer(raw.updatedAt,Number.MAX_SAFE_INTEGER));
  for(const key of ['credits','totalEarned','totalSpent'])p.wallet[key]=integer(raw.wallet[key],key==='credits'?LIMITS.credits:LIMITS.metric);
  p.ownedVehicles=FLEET.filter(car=>car.ownedAtStart||Array.isArray(raw.ownedVehicles)&&raw.ownedVehicles.includes(car.id)).map(car=>car.id);
  p.selectedVehicleId=p.ownedVehicles.includes(raw.selectedVehicleId)?raw.selectedVehicleId:'rocket';p.mode=MODES.includes(raw.mode)?raw.mode:'standard';p.garage.level=Math.max(1,integer(raw.garage?.level,4));
  for(const branch of BRANCHES)p.research[branch]=integer(raw.research?.[branch],5);
  p.cosmetics.owned=COSMETICS.filter(c=>c.price===0||Array.isArray(raw.cosmetics?.owned)&&raw.cosmetics.owned.includes(c.id)).map(c=>c.id);
  for(const item of COSMETICS)if(p.cosmetics.owned.includes(item.id)&&raw.cosmetics?.paidPrices?.[item.id]===item.price&&item.price>0)p.cosmetics.paidPrices[item.id]=item.price;
  for(const vehicleId of p.ownedVehicles){const target=loadout(),source=raw.loadouts?.[vehicleId];for(const branch of ENGINEERING.branches)target.engineering[branch.id]=branch.supports.includes(vehicleId)?integer(source?.engineering?.[branch.id],p.research[branch.id]):0;for(const item of COSMETICS)if(p.cosmetics.owned.includes(item.id)&&source?.cosmetics?.[item.slot]===item.id&&(item.cars==='all'||item.cars.includes(vehicleId)))target.cosmetics[item.slot]=item.id;p.loadouts[vehicleId]=target;}
  for(const contract of CONTRACTS)p.contracts.claims[contract.id]=integer(raw.contracts?.claims?.[contract.id],contract.kind==='repeatable'?LIMITS.count:1);
  p.season.xp=integer(raw.season?.xp,SEASON.totalXp);p.season.claims=SEASON.freeRewards.filter(r=>Array.isArray(raw.season?.claims)&&raw.season.claims.includes(r.id)).map(r=>r.id);
  p.season.badges=BADGES.filter(b=>Array.isArray(raw.season?.badges)&&raw.season.badges.includes(b.id)).map(b=>b.id);p.season.equippedBadge=p.season.badges.includes(raw.season?.equippedBadge)?raw.season.equippedBadge:null;
  for(const key of Object.keys(p.stats))p.stats[key]=key==='goalReached'?raw.stats?.[key]===true:number(raw.stats?.[key]);
  for(const mode of ['standard','tuned','continued'])for(const car of FLEET)for(const difficulty of ['flow','rush']){const key=`${car.id}:${difficulty}`,value=raw.records?.[mode]?.[key];if(record(value))p.records[mode][key]={score:integer(value.score,LIMITS.metric),distanceM:number(value.distanceM,LIMITS.runDistance),runSequence:integer(value.runSequence,Number.MAX_SAFE_INTEGER)};}
  p.ledger.finalizedThrough=integer(raw.ledger?.finalizedThrough,Number.MAX_SAFE_INTEGER-1);p.ledger.activeRun=receipt(raw.ledger?.activeRun);
  if(p.ledger.activeRun&&(p.ledger.activeRun.finalized||p.ledger.activeRun.sequence<=p.ledger.finalizedThrough||!p.ownedVehicles.includes(p.ledger.activeRun.vehicleId)))p.ledger.activeRun=null;
  const seen=new Set();p.ledger.recent=(Array.isArray(raw.ledger?.recent)?raw.ledger.recent:[]).slice(-LIMITS.recentRuns).map(receipt).filter(r=>{if(!r||!r.finalized||r.sequence>p.ledger.finalizedThrough||seen.has(r.sequence))return false;seen.add(r.sequence);return true;});
  p.ledger.nextSequence=Math.max(integer(raw.ledger?.nextSequence,Number.MAX_SAFE_INTEGER-1),p.ledger.finalizedThrough+1,(p.ledger.activeRun?.sequence||0)+1,1);
  const presetIds=new Set();for(const entry of (Array.isArray(raw.cosmetics?.presets)?raw.cosmetics.presets:[]).slice(0,GARAGE_LEVELS[p.garage.level-1].cosmeticPresetSlots)){if(!identifier(entry?.id)||presetIds.has(entry.id)||!p.ownedVehicles.includes(entry.vehicleId))continue;const selected={};for(const item of COSMETICS)if(entry.cosmetics?.[item.slot]===item.id&&p.cosmetics.owned.includes(item.id)&&(item.cars==='all'||item.cars.includes(entry.vehicleId)))selected[item.slot]=item.id;presetIds.add(entry.id);p.cosmetics.presets.push({id:entry.id,vehicleId:entry.vehicleId,name:typeof entry.name==='string'?entry.name.slice(0,48):'Настройка',cosmetics:selected});}
  p.settings=settings(raw.settings);p.legacy={best:{flow:integer(raw.legacy?.best?.flow,LIMITS.metric),rush:integer(raw.legacy?.best?.rush,LIMITS.metric)},migrated:raw.legacy?.migrated===true};
  return p;
}
/** Import old progress and settings without deriving new wallet earnings from historical distance or scores. */
export function migrateLegacyProfile(raw,options={}) {
  const p=createProfile(options);if(!record(raw))return p;p.settings=settings(raw);p.stats.runs=integer(raw.runs);p.stats.distanceM=number(raw.totalDistance);p.legacy={best:{flow:integer(raw.best?.flow,LIMITS.metric),rush:integer(raw.best?.rush,LIMITS.metric)},migrated:true};return p;
}
/** Resolve real purchased levels for tuned play; standard play always retains unmodified physics. */
export function getEngineeringModifiers(profile,vehicleId=profile?.selectedVehicleId,mode='standard') {
  const output={accelerationMultiplier:1,brakeDecelerationMultiplier:1,steeringSlewMultiplier:1,flightDrainMultiplier:1};
  if(mode!=='tuned'||!vehicleDefinition(vehicleId))return output;
  for(const branch of ENGINEERING.branches)if(branch.supports.includes(vehicleId)){const level=integer(profile?.loadouts?.[vehicleId]?.engineering?.[branch.id],integer(profile?.research?.[branch.id],5));output[branch.parameter]=branch.values[level];}return output;
}
/** Compare actual configured game parameters, not measured 0–100 times or manufacturer specifications. */
export function engineeringComparison(profile, vehicleId = profile?.selectedVehicleId) {
  const stock = playerConfiguration(vehicleId), tuned = playerConfiguration(vehicleId, getEngineeringModifiers(profile, vehicleId, 'tuned'));
  const rows = [
    { id: 'drive', label: 'Предел тяги', stock: stock.acceleration, tuned: tuned.acceleration, unit: 'м/с²' },
    { id: 'brakes', label: 'Тормозное замедление', stock: stock.brakeDeceleration, tuned: tuned.brakeDeceleration, unit: 'м/с²' },
    { id: 'chassis', label: 'Скорость перекладки руля', stock: 100, tuned: tuned.steeringSlewMultiplier / stock.steeringSlewMultiplier * 100, unit: '% базы' },
    { id: 'speed', label: 'Базовый предел скорости', stock: stock.maxSpeed * 3.6, tuned: tuned.maxSpeed * 3.6, unit: 'км/ч' },
  ];
  if (stock.flight) rows.push({ id: 'flight', label: 'Расход в полёте', stock: FLIGHT.drain, tuned: FLIGHT.drain * tuned.flightDrainMultiplier, unit: '% заряда/с' });
  return rows;
}
/** Read a contract's actual lifetime metric, including fleet and shared engineering milestones. */
function contractMetric(p,contract){return contract.metric==='ownedCarCount'?p.ownedVehicles.length:number(p.stats[contract.metric]);}
/** Return claimable repeat cycles while preserving excess progress for the next cycle. */
function contractStatus(p,contract){const claims=p.contracts.claims[contract.id]||0,total=contractMetric(p,contract),repeat=contract.kind==='repeatable';const progress=repeat?Math.max(0,total-claims*contract.target):Math.min(total,contract.target);return {claims,progress,target:contract.target,canClaim:progress>=contract.target&&(repeat||!claims),claimed:!repeat&&claims>0};}
/** Mutate only a cloned profile when granting earned credits, respecting the wallet cap. */
function credit(p,amount){const awarded=Math.min(integer(amount,LIMITS.credits),LIMITS.credits-p.wallet.credits);p.wallet.credits+=awarded;p.wallet.totalEarned=Math.min(LIMITS.metric,p.wallet.totalEarned+awarded);return awarded;}
/** Atomically debit a known catalog price; callers grant ownership only after this succeeds. */
function spend(p,price){if(!Number.isSafeInteger(price)||price<0||price>p.wallet.credits)return false;p.wallet.credits-=price;p.wallet.totalSpent=Math.min(LIMITS.metric,p.wallet.totalSpent+price);return true;}
/** Finalize the active sequence and advance a permanent replay barrier independent of bounded recent history. */
function closeRun(p){const r=p.ledger.activeRun;if(!r)return;r.finalized=true;p.ledger.finalizedThrough=Math.max(p.ledger.finalizedThrough,r.sequence);p.ledger.recent.push(r);p.ledger.recent=p.ledger.recent.slice(-LIMITS.recentRuns);p.ledger.activeRun=null;}
/** Check a cosmetic's supported vehicle, authored capability and box-level prerequisites. */
function cosmeticGate(p,item,vehicleId,capabilities){if(!item)return 'Неизвестный предмет.';const availability=cosmeticAvailability(item,capabilities);if(!availability.available)return availability.reason;if(!p.ownedVehicles.includes(vehicleId))return 'Сначала откройте автомобиль.';if(item.cars!=='all'&&!item.cars.includes(vehicleId))return 'Деталь несовместима с автомобилем.';if(p.garage.level<item.boxLevel)return `Нужен бокс уровня ${item.boxLevel}.`;return null;}
/** Apply validated actions to an independent profile; purchases never accept client-authored prices or grants. */
export function reduceProgression(input,action,{now=Date.now(),capabilities={}}={}) {
  const p=sanitizeProfile(input);if(!p)return {ok:false,changed:false,reason:'invalid-profile',profile:input?copy(input):null};
  const fail=reason=>({ok:false,changed:false,reason,profile:p});const unchanged=()=>({ok:true,changed:false,profile:p});
  if(!record(action)||typeof action.type!=='string'||Object.keys(action).some(k=>['__proto__','constructor','prototype','price','cost','credits','amount','xp','grant'].includes(k)))return fail('invalid-action');
  let extras={};
  switch(action.type){
    case 'BUY_VEHICLE': {const car=vehicleDefinition(action.vehicleId);if(!car||car.price<=0)return fail('unsupported-purchase');if(p.ownedVehicles.includes(car.id))return fail('already-owned');if(!spend(p,car.price))return fail('insufficient-credits');p.ownedVehicles.push(car.id);p.loadouts[car.id]=loadout();break;}
    case 'SELECT_VEHICLE': if(!p.ownedVehicles.includes(action.vehicleId))return fail('vehicle-not-owned');if(p.selectedVehicleId===action.vehicleId)return unchanged();p.selectedVehicleId=action.vehicleId;break;
    case 'SET_MODE': if(!MODES.includes(action.mode))return fail('invalid-mode');if(p.mode===action.mode)return unchanged();p.mode=action.mode;break;
    case 'UPGRADE_GARAGE': {if(action.expectedLevel!==undefined&&(!Number.isInteger(action.expectedLevel)||action.expectedLevel!==p.garage.level+1))return fail('stale-upgrade');const level=GARAGE_LEVELS[p.garage.level];if(!level)return fail('maximum-level');if(!spend(p,level.incrementalPrice))return fail('insufficient-credits');p.garage.level=level.level;break;}
    case 'BUY_RESEARCH': {const branch=ENGINEERING.branches.find(b=>b.id===action.branchId);if(!branch)return fail('unknown-branch');const level=p.research[branch.id];if(action.expectedLevel!==undefined&&(!Number.isInteger(action.expectedLevel)||action.expectedLevel!==level+1))return fail('stale-upgrade');if(level>=5)return fail('maximum-level');if(!spend(p,ENGINEERING.incrementalCosts[level]))return fail('insufficient-credits');p.research[branch.id]++;p.stats.engineeringPurchases=Math.min(LIMITS.count,p.stats.engineeringPurchases+1);break;}
    case 'EQUIP_RESEARCH': {const branch=ENGINEERING.branches.find(b=>b.id===action.branchId),vehicleId=action.vehicleId||p.selectedVehicleId;if(!branch||!p.ownedVehicles.includes(vehicleId)||!branch.supports.includes(vehicleId))return fail('incompatible-research');if(!Number.isInteger(action.level)||action.level<0||action.level>p.research[branch.id])return fail('level-not-owned');if(p.loadouts[vehicleId].engineering[branch.id]===action.level)return unchanged();p.loadouts[vehicleId].engineering[branch.id]=action.level;break;}
    case 'BUY_COSMETIC': {const item=cosmeticDefinition(action.cosmeticId),error=cosmeticGate(p,item,action.vehicleId||p.selectedVehicleId,capabilities);if(error)return fail(error);if(item.price<=0)return fail('unsupported-purchase');if(p.cosmetics.owned.includes(item.id))return fail('already-owned');if(!spend(p,item.price))return fail('insufficient-credits');p.cosmetics.owned.push(item.id);p.cosmetics.paidPrices[item.id]=item.price;break;}
    case 'EQUIP_COSMETIC': {const item=cosmeticDefinition(action.cosmeticId),vehicleId=action.vehicleId||p.selectedVehicleId,error=cosmeticGate(p,item,vehicleId,capabilities);if(error)return fail(error);if(!p.cosmetics.owned.includes(item.id))return fail('cosmetic-not-owned');if(p.loadouts[vehicleId].cosmetics[item.slot]===item.id)return unchanged();p.loadouts[vehicleId].cosmetics[item.slot]=item.id;break;}
    case 'UNEQUIP_COSMETIC': {const vehicleId=action.vehicleId||p.selectedVehicleId;if(!p.ownedVehicles.includes(vehicleId))return fail('vehicle-not-owned');if(!COSMETICS.some(item=>item.slot===action.slot))return fail('unknown-slot');const current=p.loadouts[vehicleId].cosmetics;if(action.slot==='body.paint'){if(current[action.slot]==='paint_chalk')return unchanged();current[action.slot]='paint_chalk';}else{if(!current[action.slot])return unchanged();delete current[action.slot];}break;}
    case 'SAVE_PRESET': {const vehicleId=action.vehicleId||p.selectedVehicleId;if(!p.ownedVehicles.includes(vehicleId))return fail('vehicle-not-owned');const id=action.presetId||`preset_${p.revision+1}`;if(!identifier(id))return fail('invalid-preset');const at=p.cosmetics.presets.findIndex(r=>r.id===id);if(at<0&&p.cosmetics.presets.length>=GARAGE_LEVELS[p.garage.level-1].cosmeticPresetSlots)return fail('preset-slots-full');const entry={id,vehicleId,name:typeof action.name==='string'?action.name.slice(0,48):'Настройка',cosmetics:copy(p.loadouts[vehicleId].cosmetics)};if(at<0)p.cosmetics.presets.push(entry);else p.cosmetics.presets[at]=entry;break;}
    case 'APPLY_PRESET': {const preset=p.cosmetics.presets.find(r=>r.id===action.presetId);if(!preset)return fail('unknown-preset');for(const cosmeticId of Object.values(preset.cosmetics)){const error=cosmeticGate(p,cosmeticDefinition(cosmeticId),preset.vehicleId,capabilities);if(error)return fail(error);}p.loadouts[preset.vehicleId].cosmetics=copy(preset.cosmetics);p.selectedVehicleId=preset.vehicleId;break;}
    case 'CLAIM_CONTRACT': {const contract=CONTRACTS.find(c=>c.id===action.contractId);if(!contract)return fail('unknown-contract');const status=contractStatus(p,contract);if(!status.canClaim)return fail(status.claimed?'already-claimed':'contract-incomplete');p.contracts.claims[contract.id]=status.claims+1;extras.rewardDelta={credits:credit(p,contract.credits),xp:Math.min(contract.xp,SEASON.totalXp-p.season.xp)};p.season.xp+=extras.rewardDelta.xp;break;}
    case 'CLAIM_SEASON': {const reward=SEASON.freeRewards.find(r=>r.id===action.rewardId);if(!reward)return fail('unknown-reward');if(p.season.claims.includes(reward.id))return fail('already-claimed');if(p.season.xp<reward.level*SEASON.xpPerLevel)return fail('level-locked');let awarded=0;if(reward.type==='credits')awarded=credit(p,reward.amount);else if(reward.type==='cosmetic'){const item=cosmeticDefinition(reward.cosmeticId),availability=cosmeticAvailability(item,capabilities);if(!availability.available)return fail(availability.reason);if(p.cosmetics.owned.includes(item.id))awarded=credit(p,p.cosmetics.paidPrices[item.id]||0);else p.cosmetics.owned.push(item.id);}else if(BADGES.some(b=>b.id===reward.cosmeticId)){if(!p.season.badges.includes(reward.cosmeticId))p.season.badges.push(reward.cosmeticId);}else return fail('unsupported-reward');p.season.claims.push(reward.id);extras.rewardDelta={credits:awarded,xp:0};break;}
    case 'EQUIP_BADGE': if(action.badgeId!==null&&!p.season.badges.includes(action.badgeId))return fail('badge-not-owned');if(p.season.equippedBadge===action.badgeId)return unchanged();p.season.equippedBadge=action.badgeId;break;
    case 'UPDATE_SETTINGS': {if(!record(action.settings))return fail('invalid-settings');const next=settings({...p.settings,...action.settings});if(JSON.stringify(next)===JSON.stringify(p.settings))return unchanged();p.settings=next;break;}
    case 'BEGIN_RUN': {const vehicleId=action.vehicleId||p.selectedVehicleId,mode=action.mode||p.mode;if(!p.ownedVehicles.includes(vehicleId)||!MODES.includes(mode)||!identifier(action.runId))return fail('invalid-run');if(p.ledger.nextSequence>=Number.MAX_SAFE_INTEGER-1)return fail('sequence-exhausted');closeRun(p);const sequence=p.ledger.nextSequence++;p.ledger.activeRun={id:action.runId,sequence,vehicleId,mode,difficulty:['flow','rush'].includes(action.difficulty)?action.difficulty:p.settings.difficulty,route:settings({route:action.route||p.settings.route}).route,telemetry:emptyMetrics(),creditsGranted:0,xpGranted:0,counted:false,finalized:false,adClaimed:false};extras.run=copy(p.ledger.activeRun);break;}
    // Stored telemetry accounts for all previously processed progress, including cap-truncated awards.
    // Receipt grant totals report only credits/XP actually received, never that replay baseline.
    case 'SETTLE_RUN': {const run=p.ledger.activeRun,ref=action.run;if(!record(ref)||!Number.isSafeInteger(ref.sequence)||ref.sequence<=p.ledger.finalizedThrough)return fail('run-finalized');if(!run||ref.sequence!==run.sequence||ref.id!==run.id||ref.vehicleId!==run.vehicleId||ref.mode!==run.mode)return fail('run-mismatch');if(!record(action.telemetry)||METRICS.some(k=>Object.hasOwn(action.telemetry,k)&&(!Number.isFinite(action.telemetry[k])||action.telemetry[k]<0)))return fail('invalid-telemetry');const incoming=sanitizeTelemetry(action.telemetry),old=copy(run.telemetry),merged=emptyMetrics();for(const key of METRICS)merged[key]=Math.max(old[key],incoming[key]);merged.goalReached=old.goalReached||incoming.goalReached;run.telemetry=sanitizeTelemetry(merged);const t=run.telemetry,reward=calculateRunRewards(t),accounted=calculateRunRewards(old),wasCounted=run.counted;extras.rewardDelta={credits:credit(p,Math.max(0,reward.credits-accounted.credits)),xp:Math.min(Math.max(0,reward.xp-accounted.xp),SEASON.totalXp-p.season.xp),onboarding:0};p.season.xp+=extras.rewardDelta.xp;run.creditsGranted+=extras.rewardDelta.credits;run.xpGranted+=extras.rewardDelta.xp;for(const key of ADDITIVE)p.stats[key]=Math.min(LIMITS.metric,p.stats[key]+Math.max(0,t[key]-old[key]));p.stats.maxRunDistanceM=Math.max(p.stats.maxRunDistanceM,t.distanceM);p.stats.maxCleanGroundSegmentM=Math.max(p.stats.maxCleanGroundSegmentM,t.maxCleanGroundSegmentM);p.stats.peakSpeedMps=Math.max(p.stats.peakSpeedMps,t.peakSpeedMps);p.stats.rawScore=Math.max(p.stats.rawScore,t.rawScore);p.stats.goalReached=p.stats.goalReached||t.goalReached;if(!run.counted&&(t.distanceM>0||t.activeSeconds>0)){run.counted=true;p.stats.runs=Math.min(LIMITS.count,p.stats.runs+1);}if(t.distanceM>=CATALOG.onboardingGrant.minimumRunMetres&&!p.contracts.claims.first_500m){p.contracts.claims.first_500m=1;extras.rewardDelta.onboarding=credit(p,CATALOG.onboardingGrant.credits);extras.rewardDelta.credits+=extras.rewardDelta.onboarding;}const mode=t.revives>0?'continued':run.mode,key=`${run.vehicleId}:${run.difficulty}`,best=p.records[mode][key];if(!best||incoming.rawScore>best.score)p.records[mode][key]={score:incoming.rawScore,distanceM:incoming.distanceM,runSequence:run.sequence};extras.receipt=copy(run);extras.baseReward=reward;if(action.finalized===true){closeRun(p);extras.receipt.finalized=true;}else if(JSON.stringify(old)===JSON.stringify(t)&&wasCounted===run.counted&&!extras.rewardDelta.credits&&!extras.rewardDelta.xp)return {...unchanged(),...extras};break;}
    case 'FINALIZE_RUN': {const run=p.ledger.activeRun;if(!run||action.runId!==run.id||action.runSequence!==run.sequence)return fail('run-mismatch');closeRun(p);break;}
    case 'CLAIM_AD_BONUS': {const run=p.ledger.recent.find(r=>r.sequence===action.runSequence&&r.id===action.runId);if(!run||!run.finalized)return fail('run-not-finalized');if(run.adClaimed)return fail('already-claimed');if(run.telemetry.distanceM<ADS.rewarded.minimumRunMetres)return fail('run-too-short');run.adClaimed=true;extras.rewardDelta={credits:credit(p,Math.min(ADS.rewarded.maximumCredits,Math.floor(run.creditsGranted*ADS.rewarded.creditFraction))),xp:0};break;}
    default:return fail(action.type?.includes('PREMIUM')?'premium-unavailable':'unknown-action');
  }
  p.revision=Math.min(Number.MAX_SAFE_INTEGER,p.revision+1);p.updatedAt=Math.max(p.updatedAt,integer(now,Number.MAX_SAFE_INTEGER));return {ok:true,changed:true,profile:p,...extras};
}
/** Project stable catalog data and claim/purchase availability for the garage sections. */
export function deriveGarageView(input,{capabilities={},trustedEntitlement=null,vehicleId=null}={}) {
  const p=sanitizeProfile(input)||createProfile(),vehicle=vehicleDefinition(vehicleId)||vehicleDefinition(p.selectedVehicleId),selectedLoadout=p.loadouts[vehicle.id]||loadout(),balance=p.wallet.credits;
  return {profile:p,balance,vehicle,loadout:selectedLoadout,engineeringComparison:engineeringComparison(p,vehicle.id),seasonLevel:Math.min(SEASON.levels,Math.floor(p.season.xp/SEASON.xpPerLevel)),premium:{enabled:false,entitled:trustedEntitlement?.verified===true&&trustedEntitlement?.seasonId===SEASON.id,reason:SEASON.premium.reasonRu},fleet:FLEET.map(car=>({...car,owned:p.ownedVehicles.includes(car.id),selected:car.id===vehicle.id,available:true,canBuy:car.price>0&&!p.ownedVehicles.includes(car.id)&&balance>=car.price})),garageLevels:GARAGE_LEVELS.map(level=>({...level,owned:level.level<=p.garage.level,selected:level.level===p.garage.level,canBuy:level.level===p.garage.level+1&&balance>=level.incrementalPrice})),cosmetics:COSMETICS.map(item=>{const reason=cosmeticGate(p,item,vehicle.id,capabilities),owned=p.cosmetics.owned.includes(item.id);return {...item,owned,selected:selectedLoadout.cosmetics[item.slot]===item.id,available:!reason,canBuy:!reason&&!owned&&item.price>0&&balance>=item.price,canEquip:!reason&&owned,reason};}),engineering:ENGINEERING.branches.map(branch=>{const level=p.research[branch.id],equipped=selectedLoadout.engineering[branch.id],available=branch.supports.includes(vehicle.id);return {...branch,level,equipped,available,nextCost:ENGINEERING.incrementalCosts[level]??null,canBuy:level<5&&balance>=ENGINEERING.incrementalCosts[level],levels:branch.values.map((value,index)=>({level:index,value,owned:index<=level,selected:index===equipped,canEquip:available&&index<=level}))};}),contracts:CONTRACTS.map(c=>({...c,...contractStatus(p,c)})),seasonRewards:SEASON.freeRewards.map(reward=>{const claimed=p.season.claims.includes(reward.id),unlocked=p.season.xp>=reward.level*SEASON.xpPerLevel,availability=reward.type==='cosmetic'?cosmeticAvailability(reward.cosmeticId,capabilities):{available:true,reason:null};return {...reward,claimed,unlocked,available:availability.available,canClaim:unlocked&&!claimed&&availability.available,reason:availability.reason};}),badges:BADGES.map(b=>({...b,owned:p.season.badges.includes(b.id),selected:p.season.equippedBadge===b.id})),presetSlots:GARAGE_LEVELS[p.garage.level-1].cosmeticPresetSlots};
}
