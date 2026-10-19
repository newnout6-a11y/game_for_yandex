import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPendingRunResult } from '../src/pending-run-result.js';
import { createProfile, getRunDoubleOffer, LIMITS, reduceProgression } from '../src/progression.js';
import { createProgressionStorage, PROGRESSION_STORAGE_KEY as KEY } from '../src/progression-storage.js';
import { SEASON } from '../src/progression-catalog.js';

const apply = (profile, action) => reduceProgression(profile, action, { now: 500 });
const metrics = (distanceM = 714, extra = {}) => ({ distanceM, groundDistanceM: distanceM - 100, airDistanceM: 100, activeSeconds: 40, airSeconds: 5, roadEventsCompleted: 2, precisionLandings: 1, landings: 1, rawScore: 2515, peakSpeedMps: 30, ...extra });
function settled({ profile = createProfile(), telemetry = metrics(), resultPending = true, mode = 'standard' } = {}) {
  const begun = apply(profile, { type: 'BEGIN_RUN', runId: 'saved_result', mode });
  const outcome = apply(begun.profile, { type: 'SETTLE_RUN', run: begun.run, telemetry, resultPending });
  assert.equal(outcome.ok, true);
  return { ...outcome, identity: { runId: begun.run.id, runSequence: begun.run.sequence } };
}
function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  return { values, getItem: key => values.get(key) ?? null, setItem(key, value) { writes++; values.set(key, value); }, get writes() { return writes; } };
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}

test('a serialized pending result restores exact earned totals, identity and the existing double quote', () => {
  const first = settled();
  const provider = memory({ [KEY]: JSON.stringify(first.profile) });
  const reopened = createProgressionStorage({ provider });
  const profile = reopened.get(), before = structuredClone(profile), persisted = provider.getItem(KEY), writes = provider.writes;
  const recovered = recoverPendingRunResult(profile, reopened.status());
  assert.ok(recovered);
  assert.deepEqual(recovered.run, profile.ledger.activeRun);
  assert.notEqual(recovered.run, profile.ledger.activeRun);
  assert.deepEqual(recovered.result.runIdentity, { id: first.identity.runId, sequence: first.identity.runSequence });
  assert.equal(recovered.result.recovered, true);
  assert.equal(recovered.result.recoveryKind, 'result');
  assert.equal(recovered.result.vehicleId, 'rocket');
  assert.equal(recovered.result.mode, 'standard');
  assert.equal(recovered.result.score, 2515);
  assert.equal(recovered.result.distance, 714);
  assert.equal(recovered.result.flightTime, 5);
  assert.deepEqual(recovered.result.metrics, profile.ledger.activeRun.telemetry);
  assert.deepEqual(recovered.result.receipt, { credits: 321, baseCredits: 121, xp: first.receipt.xpGranted });
  assert.equal(recovered.result.onboarding, 200);
  const offer = getRunDoubleOffer(profile);
  assert.equal(recovered.result.bonusEligible, offer.eligible);
  assert.equal(recovered.result.bonusCredits, offer.credits);
  assert.equal(recovered.result.bonusReason, offer.reason);
  for (const key of ['canRevive', 'bonusClaimed', 'finalized', 'newRecord', 'modified', 'continued']) assert.equal(recovered.result[key], false, key);
  assert.equal(recovered.result.settled, true);
  assert.match(recovered.result.saveMessage, /на этом устройстве/);
  assert.deepEqual(profile, before);
  assert.deepEqual(reopened.get(), before);
  assert.equal(provider.getItem(KEY), persisted);
  assert.equal(provider.writes, writes, 'recovery does not write, resettle or finalize');
});

test('ordinary autosave recovers only a free interrupted-run finish, not a fabricated crash or ad offer', () => {
  const first = settled({ resultPending: false, mode: 'tuned' });
  assert.equal(getRunDoubleOffer(first.profile).eligible, true, 'distance alone would otherwise qualify');
  const profile = JSON.parse(JSON.stringify(first.profile));
  const { run, result } = recoverPendingRunResult(profile);
  assert.deepEqual(run, profile.ledger.activeRun);
  assert.equal(result.recoveryKind, 'interrupted');
  assert.equal(result.mode, 'tuned');
  assert.equal(result.modified, true);
  assert.equal(result.canRevive, false);
  assert.equal(result.newRecord, false);
  assert.equal(result.bonusEligible, false);
  assert.equal(result.bonusCredits, 0);
  assert.equal(result.bonusReason, 'interrupted-run');
  assert.equal(result.receipt.credits, 321);
});

test('legacy receipts without a pending-result marker stay interrupted even with eligible distance', () => {
  const first = settled();
  delete first.profile.ledger.activeRun.resultPending;
  const provider = memory({ [KEY]: JSON.stringify(first.profile) });
  const reopened = createProgressionStorage({ provider });
  const { result } = recoverPendingRunResult(reopened.get());
  assert.equal(result.recoveryKind, 'interrupted');
  assert.equal(result.bonusEligible, false);
  assert.equal(result.bonusCredits, 0);
  assert.equal(result.bonusReason, 'interrupted-run');
});

test('only a boolean true pending-result marker can restore the crash-result choices', () => {
  for (const marker of [false, null, 1, 'true', {}]) {
    const first = settled();
    first.profile.ledger.activeRun.resultPending = marker;
    const { result } = recoverPendingRunResult(first.profile);
    assert.equal(result.recoveryKind, 'interrupted');
    assert.equal(result.bonusEligible, false);
    assert.equal(result.bonusReason, 'interrupted-run');
  }
});

test('continuation interrupted before another observation preserves the exclusive choice without revival', () => {
  const first = settled();
  const continued = apply(first.profile, { type: 'CONTINUE_RUN', ...first.identity });
  assert.equal(continued.ok, true);
  const { result } = recoverPendingRunResult(JSON.parse(JSON.stringify(continued.profile)));
  assert.equal(result.recoveryKind, 'interrupted');
  assert.equal(result.continued, true);
  assert.equal(result.metrics.revives, 0, 'the saved choice is enough; no physical revive is invented');
  assert.equal(result.canRevive, false);
  assert.equal(result.bonusEligible, false);
  assert.equal(result.bonusReason, 'interrupted-run');
  assert.equal(result.receipt.credits, 321);
});

test('a subsequent continued crash restores actual cumulative grants but cannot restore double', () => {
  const first = settled();
  const continued = apply(first.profile, { type: 'CONTINUE_RUN', ...first.identity });
  const again = apply(continued.profile, { type: 'SETTLE_RUN', run: continued.profile.ledger.activeRun, telemetry: metrics(914, { revives: 1 }), resultPending: true });
  const { result } = recoverPendingRunResult(JSON.parse(JSON.stringify(again.profile)));
  assert.equal(result.recoveryKind, 'result');
  assert.equal(result.continued, true);
  assert.equal(result.canRevive, false);
  assert.equal(result.bonusEligible, false);
  assert.equal(result.bonusCredits, 0);
  assert.equal(result.bonusReason, 'continue-chosen');
  assert.equal(result.receipt.credits, 341);
  assert.equal(result.receipt.baseCredits, 141);
});

test('completed and doubled receipts are never reopened, including already-consumed active payloads', () => {
  const first = settled();
  for (const type of ['FINALIZE_RUN', 'CLAIM_AD_BONUS']) {
    const completed = apply(first.profile, { type, ...first.identity });
    assert.equal(completed.ok, true);
    assert.equal(recoverPendingRunResult(JSON.parse(JSON.stringify(completed.profile))), null);
  }
  for (const patch of [{ finalized: true }, { adClaimed: true }, { finishChoice: 'finish' }, { finishChoice: 'double' }]) {
    const profile = structuredClone(first.profile);
    Object.assign(profile.ledger.activeRun, patch);
    assert.equal(recoverPendingRunResult(profile), null);
  }
});

test('fresh, empty and zero-progress receipts do not create a result panel', () => {
  assert.equal(recoverPendingRunResult(createProfile()), null);
  const begun = apply(createProfile(), { type: 'BEGIN_RUN', runId: 'empty_run' });
  assert.equal(recoverPendingRunResult(begun.profile), null);
  begun.profile.ledger.activeRun.counted = true;
  begun.profile.ledger.activeRun.resultPending = true;
  assert.equal(recoverPendingRunResult(begun.profile), null, 'a flag alone is not real progress');
  assert.equal(recoverPendingRunResult(null), null);
  assert.equal(recoverPendingRunResult({}), null);
});

test('zero-distance real driving time remains recoverable without an earned or double reward', () => {
  const first = settled({ telemetry: metrics(0, { groundDistanceM: 0, airDistanceM: 0, airSeconds: 0, roadEventsCompleted: 0, precisionLandings: 0, landings: 0, rawScore: 0 }) });
  const { result } = recoverPendingRunResult(first.profile);
  assert.equal(result.distance, 0);
  assert.equal(result.metrics.activeSeconds, 40);
  assert.equal(result.receipt.credits, 0);
  assert.equal(result.bonusReason, 'run-too-short');
});

test('invalid identities, foreign vehicles and repaired sequence counters cannot be projected', () => {
  const first = settled();
  const mutations = [
    p => { p.ledger.activeRun.id = '__proto__'; },
    p => { p.ledger.activeRun.id = ''; },
    p => { p.ledger.activeRun.sequence = '1'; },
    p => { p.ledger.activeRun.sequence = 0; },
    p => { p.ledger.activeRun.sequence = 2; },
    p => { p.ledger.nextSequence = 1; },
    p => { p.ledger.nextSequence = 3; },
    p => { p.ledger.nextSequence = Number.MAX_SAFE_INTEGER + 1; },
    p => { p.ledger.finalizedThrough = 1; },
    p => { p.ledger.finalizedThrough = -1; },
    p => { p.ledger.finalizedThrough = '0'; },
    p => { p.ledger.activeRun.vehicleId = 'hatch'; },
    p => { p.ledger.activeRun.vehicleId = 'missing'; },
    p => { p.ownedVehicles = []; },
    p => { p.ledger.activeRun.mode = 'continued'; },
    p => { p.schemaVersion = 999; },
    p => { p.wallet.credits = NaN; },
    p => { p.wallet.credits = -1; },
    p => { p.wallet.credits = LIMITS.credits + 1; },
    p => { p.ledger.activeRun = Object.create(p.ledger.activeRun); },
  ];
  for (const mutate of mutations) {
    const profile = structuredClone(first.profile);
    mutate(profile);
    assert.equal(recoverPendingRunResult(profile), null, mutate.toString());
  }
});

test('repeated recovery is pure and all exposed objects are independent of the saved profile', () => {
  const profile = deepFreeze(settled().profile), before = JSON.stringify(profile);
  const first = recoverPendingRunResult(profile), second = recoverPendingRunResult(profile);
  assert.deepEqual(first, second);
  assert.notEqual(first.run, second.run);
  first.result.metrics.distanceM = 999;
  first.run.telemetry.rawScore = 999;
  first.run.creditsGranted = 999;
  first.result.receipt.credits = 999;
  first.result.runIdentity.id = 'other';
  assert.equal(first.run.telemetry.distanceM, 714);
  assert.equal(first.result.metrics.rawScore, 2515);
  assert.equal(second.result.receipt.credits, 321);
  assert.equal(JSON.stringify(profile), before);
  assert.deepEqual(recoverPendingRunResult(profile), second);
});

test('an explicitly chosen free finish after recovery closes only the existing receipt without another award', () => {
  const first = settled();
  const provider = memory({ [KEY]: JSON.stringify(first.profile) });
  const reopened = createProgressionStorage({ provider });
  const recovered = recoverPendingRunResult(reopened.get()), before = reopened.get();
  assert.equal(reopened.finalizeRun(recovered.run).ok, true);
  const finished = reopened.get();
  assert.deepEqual(finished.wallet, before.wallet);
  assert.deepEqual(finished.season, before.season);
  assert.deepEqual(finished.stats, before.stats);
  assert.deepEqual(finished.records, before.records);
  assert.equal(finished.ledger.finalizedThrough, recovered.run.sequence);
  assert.equal(recoverPendingRunResult(createProgressionStorage({ provider }).get()), null);
});

test('recovery does not claim double, and a subsequent explicit claim still grants exactly once', () => {
  const first = settled();
  const provider = memory({ [KEY]: JSON.stringify(first.profile) });
  const reopened = createProgressionStorage({ provider });
  const recovered = recoverPendingRunResult(reopened.get()), before = reopened.get();
  const action = { type: 'CLAIM_AD_BONUS', runId: recovered.run.id, runSequence: recovered.run.sequence };
  const doubled = reopened.dispatch(action);
  assert.equal(doubled.ok, true);
  assert.equal(doubled.rewardDelta.credits, recovered.result.bonusCredits);
  assert.equal(doubled.profile.wallet.credits, before.wallet.credits + 121);
  assert.deepEqual(doubled.profile.season, before.season);
  assert.deepEqual(doubled.profile.records, before.records);
  assert.equal(recoverPendingRunResult(doubled.profile), null);
  const again = createProgressionStorage({ provider });
  assert.equal(again.dispatch(action).reason, 'already-claimed');
  assert.deepEqual(again.get(), doubled.profile);
});

test('local save failure never claims durable restoration or changes any earned totals', () => {
  const first = settled(), before = structuredClone(first.profile);
  const { result } = recoverPendingRunResult(first.profile, { localSaved: false });
  assert.match(result.saveMessage, /в этой сессии/);
  assert.match(result.saveMessage, /Локальное сохранение недоступно/);
  assert.doesNotMatch(result.saveMessage, /Восстановлено из сохранения/);
  assert.equal(result.receipt.credits, 321);
  assert.deepEqual(first.profile, before);
});

test('cap-truncated credits and XP use actual grants, not theoretical telemetry earnings', () => {
  const profile = createProfile();
  profile.wallet.credits = LIMITS.credits - 3;
  profile.season.xp = SEASON.totalXp - 1;
  const first = settled({ profile });
  const spent = apply(first.profile, { type: 'BUY_COSMETIC', cosmeticId: 'paint_copper' });
  assert.equal(spent.ok, true);
  const { result } = recoverPendingRunResult(spent.profile);
  assert.deepEqual(result.receipt, { credits: 3, baseCredits: 3, xp: 1 });
  assert.equal(result.onboarding, 0);
  assert.equal(result.bonusEligible, true);
  assert.equal(result.bonusCredits, 3);
});

test('full wallet and insufficient capacity keep the exact existing double denial', () => {
  const full = createProfile(); full.wallet.credits = LIMITS.credits;
  const noBase = recoverPendingRunResult(settled({ profile: full }).profile).result;
  assert.deepEqual(noBase.receipt, { credits: 0, baseCredits: 0, xp: settled().receipt.xpGranted });
  assert.equal(noBase.bonusReason, 'no-base-reward');
  assert.equal(noBase.bonusEligible, false);
  const first = settled(); first.profile.wallet.credits = LIMITS.credits - 120;
  const capped = recoverPendingRunResult(first.profile).result;
  assert.equal(capped.receipt.baseCredits, 121);
  assert.equal(capped.bonusReason, 'wallet-cap');
  assert.equal(capped.bonusEligible, false);
  assert.equal(capped.bonusCredits, 0);
});

test('the minimum-distance gate survives recovery with no new rewards at either side', () => {
  for (const distanceM of [499.99, 500]) {
    const first = settled({ telemetry: metrics(distanceM) }), before = structuredClone(first.profile);
    const { result } = recoverPendingRunResult(first.profile);
    const offer = getRunDoubleOffer(first.profile);
    assert.equal(result.bonusEligible, distanceM === 500);
    assert.equal(result.bonusReason, offer.reason);
    assert.equal(result.bonusCredits, offer.credits);
    assert.deepEqual(first.profile, before);
  }
});

for(const [label,mutate]of [
 ['repaired sequence',p=>{p.ledger.nextSequence=1;}],
 ['invalid barrier',p=>{p.ledger.finalizedThrough=-1;}],
 ['finished without flag',p=>{p.ledger.activeRun.finishChoice='finish';}],
 ['double without flag',p=>{p.ledger.activeRun.finishChoice='double';}],
 ['invalid wallet',p=>{p.wallet.credits=-1;}],
 ['missing ownership',p=>{p.ownedVehicles=[];}],
])test(`storage sanitation never promotes ${label} into a pending-result ad offer`,()=>{
 const p=settled().profile;mutate(p);const provider=memory({[KEY]:JSON.stringify(p)});
 const store=createProgressionStorage({provider}),recovered=recoverPendingRunResult(store.get());
 assert.ok(recovered);assert.equal(recovered.result.recoveryKind,'interrupted');assert.equal(recovered.result.bonusEligible,false);
 assert.equal(recovered.result.canRevive,false);assert.equal(store.get().ledger.activeRun.resultPending,false);
 store.flush();const second=createProgressionStorage({provider});assert.equal(recoverPendingRunResult(second.get()).result.bonusEligible,false);
});

test('marking unchanged autosaved telemetry as a displayed result still writes the durable marker',()=>{
 const provider=memory(),store=createProgressionStorage({provider,idFactory:()=> 'unchanged_result'});
 const opened=store.beginRun(),telemetry=metrics();store.settleRun(opened.run,telemetry);
 const before=store.get(),writes=provider.writes,marked=store.settleRun(opened.run,telemetry,{resultPending:true});
 assert.equal(marked.ok,true);assert.equal(marked.changed,true);assert.ok(provider.writes>writes);
 assert.deepEqual(marked.profile.wallet,before.wallet);assert.deepEqual(marked.profile.stats,before.stats);assert.deepEqual(marked.rewardDelta,{credits:0,xp:0,onboarding:0});
 const reloaded=createProgressionStorage({provider});assert.equal(recoverPendingRunResult(reloaded.get()).result.recoveryKind,'result');
});
