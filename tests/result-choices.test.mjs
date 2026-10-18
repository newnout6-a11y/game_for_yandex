import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfile,sanitizeProfile,reduceProgression,calculateRunRewards,getRunDoubleOffer,LIMITS} from '../src/progression.js';
import {createProgressionStorage} from '../src/progression-storage.js';
import {CATALOG,ADS} from '../src/progression-catalog.js';

const apply=(profile,action)=>reduceProgression(profile,action,{now:500});
const metrics=(distanceM=714,extra={})=>({distanceM,groundDistanceM:distanceM,activeSeconds:40,roadEventsCompleted:2,precisionLandings:1,landings:1,rawScore:2515,...extra});
function settled(profile=createProfile(),telemetry=metrics()) {
  const begin=apply(profile,{type:'BEGIN_RUN',runId:'choice_run'}),run=begin.run;
  const result=apply(begin.profile,{type:'SETTLE_RUN',run,telemetry});
  return {...result,run,claim:{type:'CLAIM_AD_BONUS',runId:run.id,runSequence:run.sequence},continue:{type:'CONTINUE_RUN',runId:run.id,runSequence:run.sequence}};
}
function memory(){const values=new Map();let fail=false;return {values,getItem:key=>values.get(key)||null,setItem(key,value){if(fail)throw new Error('offline');values.set(key,value);},fail(value){fail=value;}};}

test('exact ×2 policy uses an uncapped equal base copy instead of the old 25 percent / 100-credit bonus',()=>{
  assert.equal(ADS.rewarded.creditFraction,1);assert.equal(ADS.rewarded.maximumCredits,undefined);
  assert.equal(ADS.rewarded.exclusiveWithContinue,true);
  const first=settled(),before=first.profile,base=calculateRunRewards(metrics()).credits;
  assert.equal(base,121);assert.equal(first.receipt.creditsGranted,121);assert.equal(first.receipt.onboardingGranted,200);
  assert.deepEqual(getRunDoubleOffer(before),{eligible:true,reason:null,baseCredits:121,credits:121,totalBaseCredits:242});
  const doubled=apply(before,first.claim);
  assert.equal(doubled.rewardDelta.credits,121);assert.equal(doubled.profile.wallet.credits,300+200+242);
  assert.equal(doubled.profile.revision,before.revision+1,'one revision closes and claims atomically');
  assert.equal(doubled.profile.ledger.activeRun,null);assert.equal(doubled.receipt.adCreditsGranted,121);
  assert.equal(doubled.receipt.creditsGranted,121,'bonus never joins its own basis');assert.equal(doubled.receipt.finishChoice,'double');
  assert.deepEqual(doubled.profile.records,before.records);assert.deepEqual(doubled.profile.stats,before.stats);assert.deepEqual(doubled.profile.season,before.season);
});

test('contracts and season earnings before a claim cannot inflate the driving basis',()=>{
  const first=settled();let profile=first.profile;
  profile.stats.distanceM=6000;profile=apply(profile,{type:'CLAIM_CONTRACT',contractId:'repeat_distance'}).profile;
  profile.season.xp=9000;const reward=CATALOG.season.freeRewards.find(r=>r.type==='credits');
  profile=apply(profile,{type:'CLAIM_SEASON',rewardId:reward.id}).profile;
  const before=profile.wallet.credits,doubled=apply(profile,first.claim);
  assert.equal(doubled.rewardDelta.credits,121);assert.equal(doubled.profile.wallet.credits,before+121);
});

test('large legitimate base rewards are actually doubled rather than silently capped at 100',()=>{
  const first=settled(createProfile(),metrics(10000,{goalReached:true})),base=first.receipt.creditsGranted;
  assert.ok(base>1000);assert.equal(apply(first.profile,first.claim).rewardDelta.credits,base);
});

for(const distance of [0,9,499.99])test(`a ${distance}m result has no advertised or granted double and keeps its free reward`,()=>{
  const first=settled(createProfile(),metrics(distance,{roadEventsCompleted:0,precisionLandings:0,landings:0}));
  assert.equal(getRunDoubleOffer(first.profile).eligible,false);const denied=apply(first.profile,first.claim);
  assert.equal(denied.ok,false);assert.deepEqual(denied.profile,first.profile);
  assert.equal(apply(first.profile,{type:'FINALIZE_RUN',runId:first.run.id,runSequence:first.run.sequence}).ok,true);
});

test('exact minimum 500m is eligible and fully capped actual-zero reward is not',()=>{
  assert.equal(getRunDoubleOffer(settled(createProfile(),metrics(500)).profile).eligible,true);
  const profile=createProfile();profile.wallet.credits=LIMITS.credits;
  const first=settled(profile);assert.equal(first.receipt.creditsGranted,0);
  assert.equal(getRunDoubleOffer(first.profile).reason,'no-base-reward');assert.equal(apply(first.profile,first.claim).reason,'no-base-reward');
});

test('wallet capacity cannot turn the promised ×2 into a hidden partial award',()=>{
  const first=settled();first.profile.wallet.credits=LIMITS.credits-120;
  assert.equal(getRunDoubleOffer(first.profile).reason,'wallet-cap');
  const rejected=apply(first.profile,first.claim);assert.equal(rejected.reason,'wallet-cap');assert.deepEqual(rejected.profile,first.profile);
  first.profile.wallet.credits=LIMITS.credits-121;assert.equal(apply(first.profile,first.claim).rewardDelta.credits,121);
});

test('cap-truncated original driving earnings stay the actual basis after spending, not theoretical telemetry reward',()=>{
  const profile=createProfile();profile.wallet.credits=LIMITS.credits-3;
  const first=settled(profile);assert.equal(first.receipt.creditsGranted,3);assert.equal(first.receipt.onboardingGranted,0);
  const spent=apply(first.profile,{type:'BUY_COSMETIC',cosmeticId:'paint_copper'});
  assert.equal(getRunDoubleOffer(spent.profile).credits,3);assert.equal(apply(spent.profile,first.claim).rewardDelta.credits,3);
});

test('continuation persists before more driving and excludes double even across same-metrics settlement/reload',()=>{
  const first=settled(),continued=apply(first.profile,first.continue);
  assert.equal(continued.ok,true);assert.equal(continued.profile.ledger.activeRun.finishChoice,'continue');
  const restored=sanitizeProfile(JSON.parse(JSON.stringify(continued.profile)));
  assert.equal(getRunDoubleOffer(restored).reason,'continue-chosen');assert.equal(apply(restored,first.claim).reason,'continue-chosen');
  assert.equal(apply(restored,first.continue).reason,'continue-unavailable');
  const next=apply(restored,{type:'SETTLE_RUN',run:first.run,telemetry:metrics(914,{revives:1})});
  assert.equal(next.rewardDelta.credits,20);assert.equal(next.receipt.creditsGranted,141);assert.equal(next.receipt.onboardingGranted,200);
  assert.equal(next.profile.stats.runs,1);assert.equal(apply(next.profile,{type:'SETTLE_RUN',run:first.run,telemetry:metrics(914,{revives:1})}).changed,false);
});

test('old receipts with revives migrate to the continue choice without reopening a double opportunity',()=>{
  const first=settled();delete first.profile.ledger.activeRun.finishChoice;first.profile.ledger.activeRun.telemetry.revives=1;
  const restored=sanitizeProfile(first.profile);assert.equal(restored.ledger.activeRun.finishChoice,'continue');
  assert.equal(apply(restored,first.claim).reason,'continue-chosen');
});

test('double blocks replayed claims, settlements and continuation, including restored and evicted ledgers',()=>{
  const first=settled(),doubled=apply(first.profile,first.claim),restored=sanitizeProfile(JSON.parse(JSON.stringify(doubled.profile)));
  assert.equal(apply(restored,first.claim).reason,'already-claimed');assert.equal(apply(restored,first.continue).ok,false);
  assert.equal(apply(restored,{type:'SETTLE_RUN',run:first.run,telemetry:metrics(5000)}).reason,'run-finalized');
  let profile=restored;for(let i=0;i<LIMITS.recentRuns+1;i++)profile=apply(profile,{type:'BEGIN_RUN',runId:`later_${i}`}).profile;
  const before=profile.wallet.credits;assert.equal(apply(profile,first.claim).ok,false);assert.equal(profile.wallet.credits,before);
});

test('free finish and starting a fresh run both close the prior choice without requiring a video',()=>{
  for(const action of [{type:'FINALIZE_RUN',runId:'choice_run',runSequence:1},{type:'BEGIN_RUN',runId:'next_run'}]){
    const first=settled(),next=apply(first.profile,action);assert.equal(next.ok,true);
    assert.equal(next.profile.wallet.credits,first.profile.wallet.credits);assert.equal(next.profile.ledger.recent[0].finishChoice,'finish');
    assert.equal(apply(next.profile,first.claim).ok,false);assert.equal(apply(next.profile,first.continue).ok,false);
  }
});

test('a reducer action cannot choose another run identity or supply a forged reward amount',()=>{
  const first=settled();for(const action of [{...first.claim,runId:'other'},{...first.claim,runSequence:2},{...first.claim,credits:999999},{...first.continue,runId:'other'}]){
    const result=apply(first.profile,action);assert.equal(result.ok,false);assert.deepEqual(result.profile,first.profile);
  }
});

test('local write failure retains one atomic in-memory award and retry flush never repeats it',()=>{
  const provider=memory();let store=createProgressionStorage({provider,idFactory:()=> 'saved_choice'});
  const run=store.beginRun().run;store.settleRun(run,metrics());const before=store.get(),action={type:'CLAIM_AD_BONUS',runId:run.id,runSequence:run.sequence};
  provider.fail(true);const result=store.dispatch(action);
  assert.equal(result.ok,true);assert.equal(result.persistence.localSaved,false);assert.equal(store.get().wallet.credits,before.wallet.credits+121);
  const granted=store.get();assert.equal(store.dispatch(action).reason,'already-claimed');assert.deepEqual(store.get(),granted);
  assert.equal(store.flush().localSaved,false);provider.fail(false);assert.equal(store.flush().localSaved,true);
  store=createProgressionStorage({provider});assert.deepEqual(store.get(),granted);assert.equal(store.dispatch(action).reason,'already-claimed');
});

test('a legacy already-claimed receipt cannot be upgraded into another full-double grant on restore',()=>{
  const first=settled(),closed=apply(first.profile,{type:'FINALIZE_RUN',runId:first.run.id,runSequence:first.run.sequence});
  closed.profile.ledger.recent[0].adClaimed=true;delete closed.profile.ledger.recent[0].adCreditsGranted;
  const restored=sanitizeProfile(closed.profile);assert.equal(restored.ledger.recent[0].adCreditsGranted,0);
  assert.equal(apply(restored,first.claim).reason,'already-claimed');
});
