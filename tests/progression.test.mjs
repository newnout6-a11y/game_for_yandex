import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, sanitizeProfile, reduceProgression, getEngineeringModifiers, deriveGarageView, calculateRunRewards, LIMITS } from '../src/progression.js';
import { CATALOG, COSMETICS, vehicleDefinition } from '../src/progression-catalog.js';
const apply=(p,a)=>reduceProgression(p,a,{now:1234});
const rich=()=>{const p=createProfile({now:100,id:'test'});p.wallet.credits=100000;return p;};
const metrics=(distanceM=1500,extra={})=>({distanceM,groundDistanceM:distanceM,airDistanceM:0,activeSeconds:60,roadEventsCompleted:2,precisionLandings:0,airborneOvertakes:0,maxCleanGroundSegmentM:distanceM,rawScore:3000,revives:0,goalReached:distanceM>=1500,landings:0,...extra});
const begin=p=>apply(p,{type:'BEGIN_RUN',runId:'run_1'});

test('catalog and starter wallet match the authored economy and protect prototype keys',()=>{const p=createProfile();assert.equal(CATALOG.brand.ru,'Roadster');assert.equal(p.wallet.credits,300);assert.deepEqual(p.ownedVehicles,['rocket']);assert.equal(vehicleDefinition('__proto__'),null);assert.equal(vehicleDefinition('hatch').price,1400);assert.equal(Object.isFrozen(CATALOG.engineering.branches[0]),true);});
test('purchases spend exact prices atomically, reject forged/free/unsupported purchases',()=>{let p=createProfile();for(const action of [{type:'BUY_VEHICLE',vehicleId:'__proto__'},{type:'BUY_VEHICLE',vehicleId:'rocket'},{type:'BUY_VEHICLE',vehicleId:'hatch'},{type:'BUY_COSMETIC',cosmeticId:'paint_chalk'},{type:'BUY_COSMETIC',cosmeticId:'paint_copper',price:0}]){const r=apply(p,action);assert.equal(r.ok,false);assert.equal(r.profile.wallet.credits,300);}const r=apply(p,{type:'BUY_COSMETIC',cosmeticId:'paint_copper'});assert.equal(r.profile.wallet.credits,150);assert.equal(r.profile.cosmetics.paidPrices.paint_copper,150);assert.equal(apply(r.profile,{type:'BUY_COSMETIC',cosmeticId:'paint_copper'}).ok,false);assert.equal(p.cosmetics.owned.includes('paint_copper'),false);});
test('garage increments unlock exact cosmetic preset slots, not vehicle ownership',()=>{let p=rich();for(const [level,cost,slots] of [[2,900,3],[3,2700,6],[4,6000,10]]){const before=p.wallet.credits;p=apply(p,{type:'UPGRADE_GARAGE'}).profile;assert.equal(p.garage.level,level);assert.equal(before-p.wallet.credits,cost);assert.equal(deriveGarageView(p).presetSlots,slots);}assert.equal(apply(p,{type:'UPGRADE_GARAGE'}).reason,'maximum-level');assert.deepEqual(p.ownedVehicles,['rocket']);});
test('shared research has five paid stages and per-car free equip; standard ignores without erasing',()=>{let p=rich();for(let level=1;level<=5;level++){const before=p.wallet.credits;p=apply(p,{type:'BUY_RESEARCH',branchId:'drive'}).profile;assert.equal(before-p.wallet.credits,[120,240,420,700,1100][level-1]);assert.equal(p.research.drive,level);}assert.equal(apply(p,{type:'BUY_RESEARCH',branchId:'drive'}).reason,'maximum-level');p=apply(p,{type:'EQUIP_RESEARCH',branchId:'drive',vehicleId:'rocket',level:5}).profile;assert.equal(getEngineeringModifiers(p,'rocket','tuned').accelerationMultiplier,1.1);assert.equal(getEngineeringModifiers(p,'rocket','standard').accelerationMultiplier,1);p=apply(p,{type:'BUY_VEHICLE',vehicleId:'hatch'}).profile;assert.equal(getEngineeringModifiers(p,'hatch','tuned').accelerationMultiplier,1);assert.equal(apply(p,{type:'EQUIP_RESEARCH',vehicleId:'hatch',branchId:'flight',level:0}).ok,false);assert.equal(p.research.drive,5);});
test('unsupported authored cosmetics and premium claims cannot become free owned entitlements',()=>{const p=rich();p.garage.level=4;for(const item of COSMETICS.filter(c=>c.requiredCapability)){const r=apply(p,{type:'BUY_COSMETIC',cosmeticId:item.id});assert.equal(r.ok,false);assert.equal(r.profile.wallet.credits,p.wallet.credits);}assert.equal(apply(p,{type:'CLAIM_PREMIUM',rewardId:'anything'}).reason,'premium-unavailable');assert.equal(deriveGarageView(p).premium.enabled,false);});
test('explicit authored capabilities unlock only the specified supported cosmetic',()=>{const p=rich();const r=reduceProgression(p,{type:'BUY_COSMETIC',cosmeticId:'rim_copper'},{capabilities:{'rims.copperAccent':true}});assert.equal(r.ok,true);assert.equal(r.profile.wallet.credits,p.wallet.credits-300);});
test('run rewards match exact design and cap XP with no raw-score multiplier',()=>{assert.deepEqual(calculateRunRewards(metrics()),{credits:230,xp:70,breakdown:{distance:150,events:40,landings:0,goal:40}});const r=calculateRunRewards(metrics(100000,{roadEventsCompleted:1000}));assert.equal(r.xp,450);assert.equal(calculateRunRewards(metrics(500,{rawScore:99999999})).credits,90);});
test('onboarding is one auto-claimed contract, cumulative settlement and revive grant only deltas',()=>{const started=begin(createProfile()),run=started.run;let r=apply(started.profile,{type:'SETTLE_RUN',run,telemetry:metrics(500)});assert.equal(r.rewardDelta.credits,290);assert.equal(r.profile.contracts.claims.first_500m,1);assert.equal(apply(r.profile,{type:'CLAIM_CONTRACT',contractId:'first_500m'}).reason,'already-claimed');let duplicate=apply(r.profile,{type:'SETTLE_RUN',run,telemetry:metrics(500)});assert.equal(duplicate.changed,false);assert.equal(duplicate.profile.wallet.credits,r.profile.wallet.credits);r=apply(r.profile,{type:'SETTLE_RUN',run,telemetry:metrics(800,{revives:1,rawScore:4000})});assert.equal(r.rewardDelta.credits,30);assert.equal(r.profile.stats.runs,1);assert.equal(r.profile.stats.distanceM,800);assert.equal(r.profile.records.standard['rocket:flow'].score,3000);assert.equal(r.profile.records.continued['rocket:flow'].score,4000);assert.equal(r.profile.records.tuned['rocket:flow'],undefined);});
test('finalized sequences never replay even after receipt history eviction',()=>{let p=createProfile(),old;for(let i=0;i<LIMITS.recentRuns+4;i++){let r=apply(p,{type:'BEGIN_RUN',runId:`run_${i}`});if(i===0)old=r.run;r=apply(r.profile,{type:'SETTLE_RUN',run:r.run,telemetry:metrics(100),finalized:true});p=r.profile;}assert.equal(p.ledger.recent.length,LIMITS.recentRuns);const balance=p.wallet.credits;const r=apply(p,{type:'SETTLE_RUN',run:old,telemetry:metrics(10000)});assert.equal(r.ok,false);assert.equal(r.reason,'run-finalized');assert.equal(r.profile.wallet.credits,balance);});
test('rewarded doubling atomically finalizes a >=500m receipt, once only, with no XP or record changes',()=>{const b=begin(createProfile());assert.equal(apply(b.profile,{type:'CLAIM_AD_BONUS',runSequence:b.run.sequence,runId:b.run.id}).ok,false);let r=apply(b.profile,{type:'SETTLE_RUN',run:b.run,telemetry:metrics(6000)});const before=structuredClone(r.profile);r=apply(r.profile,{type:'CLAIM_AD_BONUS',runSequence:b.run.sequence,runId:b.run.id});assert.equal(r.rewardDelta.credits,680);assert.equal(r.profile.ledger.activeRun,null);assert.equal(r.profile.season.xp,before.season.xp);assert.deepEqual(r.profile.records,before.records);assert.equal(apply(r.profile,{type:'CLAIM_AD_BONUS',runSequence:b.run.sequence,runId:b.run.id}).reason,'already-claimed');});
test('repeatable contract carries excess and claims each threshold once',()=>{let p=createProfile();p.stats.distanceM=12500;let r=apply(p,{type:'CLAIM_CONTRACT',contractId:'repeat_distance'});assert.equal(r.rewardDelta.credits,180);r=apply(r.profile,{type:'CLAIM_CONTRACT',contractId:'repeat_distance'});assert.equal(r.ok,true);assert.equal(deriveGarageView(r.profile).contracts.find(c=>c.id==='repeat_distance').progress,500);assert.equal(apply(r.profile,{type:'CLAIM_CONTRACT',contractId:'repeat_distance'}).ok,false);});
test('season grants real badges and exact once-only duplicate cosmetic compensation',()=>{let p=rich();p.season.xp=9000;p=apply(p,{type:'BUY_COSMETIC',cosmeticId:'paint_glacier'}).profile;let r=apply(p,{type:'CLAIM_SEASON',rewardId:'v01_paint_04'});assert.equal(r.rewardDelta.credits,240);assert.equal(apply(r.profile,{type:'CLAIM_SEASON',rewardId:'v01_paint_04'}).ok,false);r=apply(r.profile,{type:'CLAIM_SEASON',rewardId:'v01_badge_02'});assert.ok(r.profile.season.badges.includes('badge_first_altitude'));assert.equal(apply(r.profile,{type:'EQUIP_BADGE',badgeId:'badge_first_altitude'}).ok,true);});
test('NaN, prototype payloads, snapshots and currency limits remain safe',()=>{let p=rich();assert.equal(apply(p,JSON.parse('{"type":"BUY_VEHICLE","vehicleId":"hatch","__proto__":{}}')).ok,false);assert.equal(apply(p,{type:'BUY_RESEARCH',branchId:'constructor'}).ok,false);const b=begin(p);assert.equal(apply(b.profile,{type:'SETTLE_RUN',run:b.run,telemetry:metrics(NaN)}).ok,false);p.wallet.credits=Infinity;assert.equal(sanitizeProfile(p).wallet.credits,0);p=rich();p.wallet.credits=LIMITS.credits;p.stats.distanceM=6000;const r=apply(p,{type:'CLAIM_CONTRACT',contractId:'repeat_distance'});assert.equal(r.profile.wallet.credits,LIMITS.credits);r.profile.research.drive=5;assert.equal(p.research.drive,0);assert.equal(sanitizeProfile({...p,schemaVersion:999}),null);});

test('cosmetic presets enforce box slots, keep per-car ownership and never change research',()=>{let p=rich();p=apply(p,{type:'BUY_COSMETIC',cosmeticId:'paint_copper'}).profile;p=apply(p,{type:'EQUIP_COSMETIC',cosmeticId:'paint_copper'}).profile;p=apply(p,{type:'SAVE_PRESET',presetId:'warm',name:'Тёплый бокс'}).profile;assert.equal(apply(p,{type:'SAVE_PRESET',presetId:'second'}).reason,'preset-slots-full');p=apply(p,{type:'EQUIP_COSMETIC',cosmeticId:'paint_graphite'}).profile;p=apply(p,{type:'BUY_RESEARCH',branchId:'drive'}).profile;p=apply(p,{type:'EQUIP_RESEARCH',branchId:'drive',level:1}).profile;const r=apply(p,{type:'APPLY_PRESET',presetId:'warm'});assert.equal(r.profile.loadouts.rocket.cosmetics['body.paint'],'paint_copper');assert.equal(r.profile.loadouts.rocket.engineering.drive,1);assert.equal(apply(r.profile,{type:'SAVE_PRESET',presetId:'__proto__'}).ok,false);});
test('authored turbine compatibility is restricted to the actually authored Rocket even after capability',()=>{let p=rich();p.garage.level=4;p=apply(p,{type:'BUY_VEHICLE',vehicleId:'hatch'}).profile;const options={capabilities:{'wheels.turbine':true}};assert.equal(reduceProgression(p,{type:'BUY_COSMETIC',cosmeticId:'wheel_turbine',vehicleId:'hatch'},options).ok,false);assert.equal(reduceProgression(p,{type:'BUY_COSMETIC',cosmeticId:'wheel_turbine',vehicleId:'rocket'},options).ok,true);});
test('run XP and currency cap apply cumulatively across revive rather than resetting per result',()=>{const b=begin(createProfile());let r=apply(b.profile,{type:'SETTLE_RUN',run:b.run,telemetry:metrics(30000,{roadEventsCompleted:30})});assert.equal(r.rewardDelta.xp,450);const xp=r.profile.season.xp;r=apply(r.profile,{type:'SETTLE_RUN',run:b.run,telemetry:metrics(40000,{roadEventsCompleted:40,revives:1})});assert.equal(r.rewardDelta.xp,0);assert.equal(r.profile.season.xp,xp);assert.equal(r.rewardDelta.credits,1200);});
test('unchanged actions preserve revision/timestamp and old clock values never move updatedAt backwards',()=>{const p=createProfile({now:2000});const a=reduceProgression(p,{type:'SET_MODE',mode:'standard'},{now:9999});assert.equal(a.changed,false);assert.equal(a.profile.revision,0);assert.equal(a.profile.updatedAt,2000);const b=reduceProgression(p,{type:'BUY_COSMETIC',cosmeticId:'paint_copper'},{now:1000});assert.equal(b.profile.revision,1);assert.equal(b.profile.updatedAt,2000);});
test('starting another run closes an abandoned receipt and does not revive its older sequence',()=>{const a=begin(createProfile());const b=apply(a.profile,{type:'BEGIN_RUN',runId:'run_2'});assert.equal(b.run.sequence,2);assert.equal(b.profile.ledger.finalizedThrough,1);assert.equal(apply(b.profile,{type:'SETTLE_RUN',run:a.run,telemetry:metrics(500)}).reason,'run-finalized');assert.equal(apply(b.profile,{type:'SETTLE_RUN',run:{...b.run,id:'forged'},telemetry:metrics(500)}).reason,'run-mismatch');});

test('engineering comparison uses installed game parameters, keeps speed fixed and excludes unsupported flight',()=>{
  let p=rich();p=apply(p,{type:'BUY_RESEARCH',branchId:'drive'}).profile;p=apply(p,{type:'EQUIP_RESEARCH',branchId:'drive',level:1}).profile;
  const rows=deriveGarageView(p).engineeringComparison,drive=rows.find(row=>row.id==='drive');
  assert.equal(drive.tuned,vehicleDefinition('rocket').accelerationMps2*1.02);assert.equal(drive.stock,vehicleDefinition('rocket').accelerationMps2);
  assert.equal(rows.find(row=>row.id==='speed').stock,rows.find(row=>row.id==='speed').tuned);
  assert.equal(rows.find(row=>row.id==='flight').stock,14);
  const preview=deriveGarageView(p,{vehicleId:'van'});assert.equal(preview.vehicle.id,'van');assert.equal(preview.engineeringComparison.some(row=>row.id==='flight'),false);
  assert.equal(preview.engineeringComparison.find(row=>row.id==='drive').tuned,vehicleDefinition('van').accelerationMps2);
  assert.equal(p.selectedVehicleId,'rocket');assert.equal(p.loadouts.van,undefined,'preview must not grant ownership or a saved loadout');
  assert.deepEqual(CATALOG.sections,['fleet','style','engineering','contracts','season']);
});

test('displayed upgrade targets reject duplicate and stale intents without another debit',()=>{
  for(const [type,branchId,firstTarget] of [['BUY_RESEARCH','drive',1],['UPGRADE_GARAGE',null,2]]){
    const action={type,expectedLevel:firstTarget,...(branchId?{branchId}:{})};
    const first=apply(rich(),action);assert.equal(first.ok,true);
    const before=structuredClone(first.profile),duplicate=apply(first.profile,action);
    assert.equal(duplicate.ok,false);assert.equal(duplicate.changed,false);assert.equal(duplicate.reason,'stale-upgrade');assert.deepEqual(duplicate.profile,before);
    for(const expectedLevel of [firstTarget,firstTarget+2,String(firstTarget+1),null,NaN]){
      const stale=apply(first.profile,{...action,expectedLevel});assert.equal(stale.reason,'stale-upgrade');assert.deepEqual(stale.profile,before);
    }
    const next=apply(first.profile,{...action,expectedLevel:firstTarget+1});assert.equal(next.ok,true);
    for(const compatibility of [{},{expectedLevel:undefined}]){const compatible=apply(first.profile,{type,...(branchId?{branchId}:{}),...compatibility});assert.equal(compatible.ok,true);assert.deepEqual(compatible.profile,next.profile);}
  }
});

test('capped run receipts expose only actual grants and old progress cannot be reclaimed after spending or reload',()=>{
  let p=rich();p.wallet.credits=LIMITS.credits-3;p.season.xp=8999;
  const started=begin(p),run=started.run;
  const telemetry=distanceM=>metrics(distanceM,{roadEventsCompleted:0,goalReached:false});
  const first=apply(started.profile,{type:'SETTLE_RUN',run,telemetry:telemetry(100)});
  assert.deepEqual(first.rewardDelta,{credits:3,xp:1,onboarding:0});assert.equal(first.receipt.creditsGranted,3);assert.equal(first.receipt.xpGranted,1);
  p=sanitizeProfile(JSON.parse(JSON.stringify(first.profile)));
  assert.equal(p.ledger.activeRun.creditsGranted,3);assert.equal(p.ledger.activeRun.xpGranted,1);
  p=apply(p,{type:'BUY_COSMETIC',cosmeticId:'paint_copper'}).profile;const balance=p.wallet.credits;
  const duplicate=apply(p,{type:'SETTLE_RUN',run,telemetry:telemetry(100)});
  assert.equal(duplicate.changed,false);assert.equal(duplicate.profile.wallet.credits,balance);assert.deepEqual(duplicate.rewardDelta,{credits:0,xp:0,onboarding:0});
  const continued=apply(duplicate.profile,{type:'SETTLE_RUN',run,telemetry:telemetry(200),finalized:true});
  assert.deepEqual(continued.rewardDelta,{credits:10,xp:0,onboarding:0});assert.equal(continued.receipt.creditsGranted,13);assert.equal(continued.receipt.xpGranted,1);
  const restored=sanitizeProfile(JSON.parse(JSON.stringify(continued.profile)));
  assert.equal(restored.ledger.recent[0].creditsGranted,13);assert.equal(restored.ledger.recent[0].xpGranted,1);
  assert.equal(apply(restored,{type:'SETTLE_RUN',run,telemetry:telemetry(300)}).reason,'run-finalized');
});

test('fully capped run, contract, season and ad outcomes never report nonexistent credit or XP grants',()=>{
  let p=rich();p.wallet.credits=LIMITS.credits;p.season.xp=9000;
  const started=begin(p),run=started.run;
  const settled=apply(started.profile,{type:'SETTLE_RUN',run,telemetry:metrics(600,{roadEventsCompleted:0,goalReached:false})});
  assert.deepEqual(settled.rewardDelta,{credits:0,xp:0,onboarding:0});assert.equal(settled.receipt.creditsGranted,0);assert.equal(settled.receipt.xpGranted,0);
  assert.equal(sanitizeProfile(settled.profile).ledger.activeRun.creditsGranted,0);
  const ad=apply(settled.profile,{type:'CLAIM_AD_BONUS',runId:run.id,runSequence:run.sequence});assert.equal(ad.ok,false);assert.equal(ad.reason,'no-base-reward');assert.deepEqual(ad.profile,settled.profile);
  p.stats.distanceM=6000;
  const contract=apply(p,{type:'CLAIM_CONTRACT',contractId:'repeat_distance'});assert.equal(contract.ok,true);assert.deepEqual(contract.rewardDelta,{credits:0,xp:0});
  const reward=CATALOG.season.freeRewards.find(item=>item.type==='credits');
  const season=apply(p,{type:'CLAIM_SEASON',rewardId:reward.id});assert.equal(season.ok,true);assert.deepEqual(season.rewardDelta,{credits:0,xp:0});
  assert.equal(apply(season.profile,{type:'CLAIM_SEASON',rewardId:reward.id}).reason,'already-claimed');
});
