import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AD_CADENCE, normalizeAdCadenceRules, createAdCadenceState, qualifiesForAdCadence, getAdEligibility, reduceAdCadence, createAdCadence } from '../src/ad-cadence.js';

const metrics = (activeSeconds = 60, distanceM = 600) => ({ activeSeconds, distanceM });
const context = (sequence = 3, changes = {}) => ({ sequence, screen: 'results', action: 'continue', sdkAvailable: true, ...changes });
function qualifiedSession(options = {}, count = 3, seconds = 60) {
  const cadence = createAdCadence(options);
  for (let sequence = 1; sequence <= count; sequence++) cadence.completeRun(sequence, metrics(seconds), { reason: 'crash' });
  return cadence;
}

test('defaults describe product-owned three-run active-driving guards', () => {
  assert.deepEqual(DEFAULT_AD_CADENCE, { minimumCompletedRuns: 3, minimumRunSeconds: 45, minimumRunMetres: 500, minimumSessionSeconds: 180, minimumSecondsBetweenRequests: 180, skipAfterRewardedSeconds: 180, failureBackoffSeconds: 30 });
  assert.ok(Object.isFrozen(DEFAULT_AD_CADENCE));
  assert.equal(normalizeAdCadenceRules({ minimumCompletedRuns: -1, minimumSessionSeconds: NaN, minimumRunSeconds: '2' }).minimumCompletedRuns, 3);
  assert.equal(normalizeAdCadenceRules({ skipAfterRewardedSeconds: 0 }).skipAfterRewardedSeconds, 0);
});

test('natural crash and finish qualify exactly at 45 active seconds and 500 metres', () => {
  for (const reason of ['crash', 'finish']) {
    assert.equal(qualifiesForAdCadence(metrics(45, 500), { reason }), true);
    assert.equal(qualifiesForAdCadence(metrics(44.999, 500), { reason }), false);
    assert.equal(qualifiesForAdCadence(metrics(45, 499.999), { reason }), false);
  }
});

test('tutorials, quits, retries and invalid receipt values never qualify', () => {
  for (const reason of ['quit', 'retry', 'restart', 'launch', undefined]) assert.equal(qualifiesForAdCadence(metrics(500, 5000), { reason }), false);
  assert.equal(qualifiesForAdCadence(metrics(), { reason: 'crash', tutorial: true }), false);
  for (const value of [NaN, Infinity, -1, '60', null]) {
    assert.equal(qualifiesForAdCadence(metrics(value), { reason: 'crash' }), false);
    assert.equal(qualifiesForAdCadence(metrics(60, value), { reason: 'crash' }), false);
  }
});

test('first two substantial runs do not show; the third at 180 active seconds may request', () => {
  const cadence = qualifiedSession({}, 2, 90);
  assert.equal(cadence.eligibility(context(2)).reason, 'RUN_QUOTA');
  cadence.completeRun(3, metrics(45), { reason: 'crash' });
  assert.equal(cadence.eligibility(context()).eligible, true);
  assert.equal(qualifiedSession().snapshot().activeSeconds, 180);
});

test('three 45-second runs remain below session guard; exact 180-second boundary is eligible', () => {
  const cadence = qualifiedSession({}, 3, 45);
  assert.equal(cadence.eligibility(context()).reason, 'SESSION_ACTIVE_TIME');
  cadence.completeRun(3, metrics(89.999), { reason: 'crash' });
  assert.equal(cadence.eligibility(context()).reason, 'SESSION_ACTIVE_TIME');
  cadence.completeRun(3, metrics(90), { reason: 'crash' });
  assert.equal(cadence.eligibility(context()).eligible, true);
  assert.equal(cadence.snapshot().qualifiedRuns, 3);
});

test('launch, mid-run, pause, automatic results and unavailable/fake SDK never request', () => {
  const cadence = qualifiedSession();
  for (const screen of ['loading', 'hub', 'garage', 'playing', 'paused']) assert.equal(cadence.beginTransition(context(3, { screen })).eligible, false);
  for (const action of ['crash', 'results', 'revive', 'rewarded', undefined]) assert.equal(cadence.beginTransition(context(3, { action })).eligible, false);
  for (const sdkAvailable of [false, undefined, 'true', 1]) assert.equal(cadence.beginTransition(context(3, { sdkAvailable })).reason, 'SDK_UNAVAILABLE');
  assert.equal(cadence.snapshot().attemptedSequence, 0);
  assert.equal(cadence.beginTransition(context(3, { action: 'menu' })).eligible, true);
});

test('observations use cumulative simulation deltas, not pauses, repeated receipts or wall clock', () => {
  const cadence = createAdCadence();
  cadence.observeRun(1, metrics(60));
  for (let i = 0; i < 100; i++) cadence.observeRun(1, { ...metrics(60), wallClockSeconds: 999999, pausedSeconds: 999999 });
  cadence.observeRun(1, metrics(50));
  assert.equal(cadence.snapshot().activeSeconds, 60);
  cadence.observeRun(1, metrics(65));
  cadence.observeRun(2, metrics(20));
  assert.equal(cadence.snapshot().activeSeconds, 85);
  assert.equal(cadence.snapshot().qualifiedRuns, 0);
});

test('revive retains one run credit and only its newly driven seconds, even after a shown ad', () => {
  const cadence = qualifiedSession();
  cadence.completeRun(3, metrics(60), { reason: 'crash' });
  cadence.observeRun(3, metrics(80, 800));
  assert.equal(cadence.eligibility(context()).reason, 'NOT_NATURAL_END');
  cadence.completeRun(3, metrics(90, 900), { reason: 'crash' });
  assert.equal(cadence.snapshot().qualifiedRuns, 3);
  assert.equal(cadence.snapshot().activeSeconds, 210);
  cadence.beginTransition(context());cadence.settleInterstitial({ shown: true });
  cadence.completeRun(3, metrics(120, 1200), { reason: 'crash' });
  assert.equal(cadence.snapshot().qualifiedRuns, 0);
});

test('a short first crash may qualify after a legitimate cumulative revive, only once', () => {
  const cadence = createAdCadence();
  cadence.completeRun(1, metrics(20, 300), { reason: 'crash' });
  assert.equal(cadence.snapshot().qualifiedRuns, 0);
  cadence.completeRun(1, metrics(45, 500), { reason: 'crash' });
  cadence.completeRun(1, metrics(90, 1000), { reason: 'crash' });
  assert.equal(cadence.snapshot().qualifiedRuns, 1);
  assert.equal(cadence.snapshot().activeSeconds, 90);
});

test('stale, reordered, invalid and duplicate monotonic sequences cannot farm runs or time', () => {
  const cadence = qualifiedSession();const before = cadence.snapshot();
  for (const sequence of [1, 2, 0, -1, 1.5, NaN, Infinity, '4']) cadence.completeRun(sequence, metrics(9000, 90000), { reason: 'crash' });
  assert.deepEqual(cadence.snapshot(), before);
  assert.equal(cadence.eligibility(context(2)).reason, 'INVALID_RUN');
  cadence.completeRun(3, metrics(60), { reason: 'crash' });
  assert.deepEqual(cadence.snapshot(), before);
});

test('manual quitting, retry farming and tutorial results cannot spend an already earned quota', () => {
  for (const options of [{ reason: 'quit' }, { reason: 'retry' }, { reason: 'crash', tutorial: true }]) {
    const cadence = qualifiedSession();
    cadence.completeRun(4, metrics(180, 5000), options);
    assert.equal(cadence.snapshot().qualifiedRuns, 3);
    assert.equal(cadence.beginTransition(context(4)).reason, 'NOT_NATURAL_END');
  }
  const cadence = qualifiedSession();
  cadence.completeRun(4, metrics(44, 1000), { reason: 'crash' });
  assert.equal(cadence.beginTransition(context(4)).reason, 'RUN_NOT_QUALIFIED');
});

test('shown exposure alone resets quota and starts exact 180-active-second cooldown', () => {
  const cadence = qualifiedSession();
  assert.equal(cadence.beginTransition(context()).eligible, true);
  assert.equal(cadence.snapshot().qualifiedRuns, 3);
  cadence.settleInterstitial({ shown: true, ok: false, code: 'ERROR' });
  assert.equal(cadence.snapshot().qualifiedRuns, 0);
  assert.equal(cadence.snapshot().lastInterstitialAt, 180);
  for (let sequence = 4; sequence <= 6; sequence++) cadence.completeRun(sequence, metrics(45), { reason: 'crash' });
  assert.equal(cadence.eligibility(context(6)).reason, 'EXPOSURE_COOLDOWN');
  cadence.completeRun(6, metrics(89.999), { reason: 'crash' });
  assert.equal(cadence.eligibility(context(6)).reason, 'EXPOSURE_COOLDOWN');
  cadence.completeRun(6, metrics(90), { reason: 'crash' });
  assert.equal(cadence.eligibility(context(6)).eligible, true);
});

test('failure/no-fill retains quota, backs off 30 active seconds, and never retries same transition', () => {
  for (const outcome of [{ shown: false, code: 'CLOSED', ok: true }, { shown: false, code: 'ERROR' }, { code: 'OFFLINE' }, { code: 'UNAVAILABLE' }, undefined]) {
    const cadence = qualifiedSession({ minimumRunSeconds: 0 });
    cadence.beginTransition(context());cadence.settleInterstitial(outcome);
    assert.equal(cadence.snapshot().qualifiedRuns, 3);
    assert.equal(cadence.snapshot().lastInterstitialAt, null);
    assert.equal(cadence.beginTransition(context()).reason, 'ALREADY_ATTEMPTED');
    cadence.completeRun(4, metrics(29.999), { reason: 'crash' });
    assert.equal(cadence.beginTransition(context(4)).reason, 'FAILURE_BACKOFF');
    cadence.completeRun(4, metrics(30), { reason: 'crash' });
    assert.equal(cadence.beginTransition(context(4)).eligible, true);
  }
});

test('an active SDK request is single flight and pending timeout does not settle it', () => {
  const cadence = qualifiedSession();cadence.beginTransition(context());
  assert.equal(cadence.beginTransition(context()).reason, 'IN_FLIGHT');
  cadence.settleInterstitial({ shown: true, pending: true, code: 'TIMEOUT_PENDING' });
  assert.equal(cadence.snapshot().inFlightSequence, 3);
  assert.equal(cadence.snapshot().qualifiedRuns, 3);
  cadence.settleInterstitial({ shown: true }, 2);
  assert.equal(cadence.snapshot().inFlightSequence, 3);
  cadence.settleInterstitial({ shown: true }, 3);
  assert.equal(cadence.snapshot().inFlightSequence, null);
  const state = cadence.snapshot();cadence.settleInterstitial({ shown: false });
  assert.deepEqual(cadence.snapshot(), state);
});

test('any real rewarded exposure suppresses until exactly 180 more active seconds, without consuming quota', () => {
  const cadence = qualifiedSession();cadence.recordRewarded({ shown: true, rewarded: false, code: 'ERROR' });
  assert.equal(cadence.eligibility(context()).reason, 'REWARDED_COOLDOWN');
  assert.equal(cadence.snapshot().qualifiedRuns, 3);
  cadence.completeRun(4, metrics(179.999, 3000), { reason: 'crash' });
  assert.equal(cadence.eligibility(context(4)).reason, 'REWARDED_COOLDOWN');
  cadence.completeRun(4, metrics(180, 3000), { reason: 'crash' });
  assert.equal(cadence.eligibility(context(4)).eligible, true);
});

test('rewarded no-fill or a reward flag alone is not an exposure and suppression can be configured off', () => {
  const cadence = qualifiedSession();cadence.recordRewarded({ shown: false, rewarded: true });
  assert.equal(cadence.eligibility(context()).eligible, true);
  const unsuppressed = qualifiedSession({ skipAfterRewardedSeconds: 0 });unsuppressed.recordRewarded({ shown: true });
  assert.equal(unsuppressed.eligibility(context()).eligible, true);
});

test('pure policy does not mutate frozen state, event, metrics or configuration', () => {
  const state = Object.freeze(createAdCadenceState());
  const event = Object.freeze({ type: 'COMPLETE_RUN', sequence: 1, metrics: Object.freeze(metrics()), reason: 'crash' });
  const next = reduceAdCadence(state, event, Object.freeze({}));
  assert.equal(state.qualifiedRuns, 0);assert.equal(next.qualifiedRuns, 1);
  assert.equal(getAdEligibility(next, context(1)).reason, 'RUN_QUOTA');
  assert.equal(reduceAdCadence(state, { type: 'UNKNOWN' }), state);
});

test('snapshots are detached and a new session never inherits an earned quota', () => {
  const cadence = qualifiedSession();const snapshot = cadence.snapshot();snapshot.qualifiedRuns = 900;snapshot.activeSeconds = 900000;
  assert.equal(cadence.snapshot().qualifiedRuns, 3);
  assert.deepEqual(createAdCadence().snapshot(), createAdCadenceState());
});
