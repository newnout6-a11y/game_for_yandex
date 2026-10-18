import test from 'node:test';
import assert from 'node:assert/strict';
import { createAds } from '../src/ads.js';
import { createLifecycle } from '../src/lifecycle.js';
import { createAdCadence } from '../src/ad-cadence.js';

/** Manual SDK callback harness with real pause ownership and bounded timeout tests. */
function harness({ timeoutMs = 1000, method, available = true, canShow = true } = {}) {
  const callbacks = [];const lifecycle = createLifecycle();
  const call = method || (options => { callbacks.push(options.callbacks); });
  const sdk = { get: () => available ? { adv: { showFullscreenAdv: call, showRewardedVideo: call } } : null };
  const ads = createAds({ sdk, lifecycle, canShow: () => canShow, timeoutMs });
  return { ads, lifecycle, callbacks };
}

function readyCadence() {
  const cadence = createAdCadence();
  for (let sequence = 1; sequence <= 3; sequence++) cadence.completeRun(sequence, { activeSeconds: 60, distanceM: 600 }, { reason: 'crash' });
  cadence.beginTransition({ sequence: 3, screen: 'results', action: 'continue', sdkAvailable: true });
  return cadence;
}

test('fullscreen close(false) is no-fill, not an exposure despite a clean close', async () => {
  const h = harness();const pending = h.ads.interstitial();h.callbacks[0].onClose(false);
  const outcome = await pending;
  assert.deepEqual(outcome, { ok: true, rewarded: false, shown: false, pending: false, code: 'CLOSED' });
  const cadence = readyCadence();cadence.settleInterstitial(outcome);
  assert.equal(cadence.snapshot().qualifiedRuns, 3);
  assert.equal(cadence.snapshot().lastInterstitialAt, null);
});

test('onOpen then close(true) is one exposure, and duplicate terminals change nothing', async () => {
  const h = harness();const pending = h.ads.interstitial();
  h.callbacks[0].onOpen();h.callbacks[0].onOpen();h.callbacks[0].onClose(true);
  const outcome = await pending;h.callbacks[0].onClose(false);h.callbacks[0].onError();
  assert.equal(outcome.shown, true);assert.equal(h.ads.pending, false);assert.equal(h.lifecycle.has('ad'), false);
  const cadence = readyCadence();cadence.settleInterstitial(outcome);const before = cadence.snapshot();cadence.settleInterstitial(outcome);
  assert.equal(before.qualifiedRuns, 0);assert.deepEqual(cadence.snapshot(), before);
});

test('close(true) confirms exposure without onOpen, but undefined close cannot invent one', async () => {
  for (const wasShown of [true, false, undefined, 'true', 1]) {
    const h = harness();const pending = h.ads.interstitial();h.callbacks[0].onClose(wasShown);
    assert.equal((await pending).shown, wasShown === true);
  }
});

test('a known opening remains exposure even if close(false), error or offline follows', async () => {
  for (const terminal of ['onClose', 'onError', 'onOffline']) {
    const h = harness();const pending = h.ads.interstitial();h.callbacks[0].onOpen();h.callbacks[0][terminal](false);
    const outcome = await pending;assert.equal(outcome.shown, true);assert.equal(h.lifecycle.paused, false);
    const cadence = readyCadence();cadence.settleInterstitial(outcome);assert.equal(cadence.snapshot().qualifiedRuns, 0);
  }
});

test('synchronous SDK throw, offline and errors without opening do not count an exposure', async () => {
  for (const terminal of ['onError', 'onOffline', 'throw']) {
    const h = harness(terminal === 'throw' ? { method: () => { throw Error('SDK failure'); } } : {});
    h.lifecycle.pause('platform');const pending = h.ads.interstitial();
    if (terminal !== 'throw') h.callbacks[0][terminal]();
    const outcome = await pending;assert.equal(outcome.shown, false);assert.equal(outcome.pending, false);
    assert.equal(h.ads.pending, false);assert.equal(h.lifecycle.has('ad'), false);assert.equal(h.lifecycle.has('platform'), true);
  }
});

test('unavailable SDK, malformed capability and eligibility failures resolve without pausing', async () => {
  for (const options of [{ available: false }, { canShow: false }]) {
    const h = harness(options);assert.equal((await h.ads.interstitial()).code, 'UNAVAILABLE');assert.equal(h.lifecycle.paused, false);
  }
  const lifecycle = createLifecycle();
  for (const get of [() => ({ adv: { showFullscreenAdv: true, showRewardedVideo: {} } }), () => { throw Error('access failed'); }]) {
    const ads = createAds({ sdk: { get }, lifecycle, canShow: () => true });
    assert.equal(ads.available, false);assert.equal(ads.interstitialAvailable, false);
    assert.equal((await ads.interstitial()).shown, false);assert.equal(lifecycle.paused, false);
  }
  const ads = createAds({ sdk: { get: () => ({ adv: { showFullscreenAdv() {} } }) }, lifecycle, canShow: () => { throw Error('eligibility failed'); } });
  assert.equal((await ads.interstitial()).code, 'UNAVAILABLE');assert.equal(lifecycle.paused, false);
});

test('rewarded close never grants a reward, and interstitial onRewarded is ignored', async () => {
  const h = harness();const video = h.ads.rewarded();h.callbacks[0].onOpen();h.callbacks[0].onClose(true);
  const videoOutcome = await video;assert.equal(videoOutcome.shown, true);assert.equal(videoOutcome.rewarded, false);
  h.callbacks[0].onRewarded();assert.equal(videoOutcome.rewarded, false);
  const interstitial = h.ads.interstitial();h.callbacks[1].onRewarded();h.callbacks[1].onClose(true);
  assert.equal((await interstitial).rewarded, false);
});

test('rewarded exposure suppresses cadence without requiring a bonus grant', async () => {
  const h = harness();const video = h.ads.rewarded();h.callbacks[0].onOpen();h.callbacks[0].onError();
  const outcome = await video;assert.equal(outcome.rewarded, false);assert.equal(outcome.shown, true);
  const cadence = createAdCadence();cadence.recordRewarded(outcome);
  assert.equal(cadence.snapshot().lastRewardedAt, 0);
});

test('timeout is a pending recovery status, never cancellation or automatic gameplay resume', async () => {
  const h = harness({ timeoutMs: 5 });h.lifecycle.pause('platform');
  const initial = await h.ads.interstitial();
  assert.equal(initial.code, 'TIMEOUT_PENDING');assert.equal(initial.pending, true);assert.equal(initial.shown, false);
  assert.equal(h.ads.pending, true);assert.equal(h.ads.status.timedOut, true);
  assert.equal(h.lifecycle.has('ad'), true);assert.equal(h.lifecycle.has('platform'), true);
  assert.equal((await h.ads.interstitial()).code, 'UNAVAILABLE');assert.equal((await h.ads.rewarded()).code, 'UNAVAILABLE');
  assert.equal(h.callbacks.length, 1);
  const cadence = readyCadence();cadence.settleInterstitial(initial);assert.equal(cadence.snapshot().inFlightSequence, 3);
  h.callbacks[0].onOpen();assert.equal(h.ads.status.shown, true);assert.equal(h.lifecycle.has('ad'), true);
  h.callbacks[0].onClose(true);const final = await initial.completion;cadence.settleInterstitial(final);
  assert.equal(final.pending, false);assert.equal(final.shown, true);assert.equal(h.ads.pending, false);
  assert.equal(h.lifecycle.has('ad'), false);assert.equal(h.lifecycle.has('platform'), true);
  assert.equal(cadence.snapshot().qualifiedRuns, 0);
});

test('timeout after an opening retains pause until a late terminal callback', async () => {
  const h = harness({ timeoutMs: 5 });const pending = h.ads.interstitial();h.callbacks[0].onOpen();
  const initial = await pending;assert.equal(initial.shown, true);assert.equal(h.lifecycle.has('ad'), true);
  h.callbacks[0].onError();const final = await initial.completion;
  assert.equal(final.shown, true);assert.equal(final.code, 'ERROR');assert.equal(h.lifecycle.has('ad'), false);
});

test('late no-fill/offline after timeout permits continuity without consuming the run quota', async () => {
  for (const terminal of ['onClose', 'onOffline']) {
    const h = harness({ timeoutMs: 5 });const initial = await h.ads.interstitial();h.callbacks[0][terminal](false);
    const final = await initial.completion;assert.equal(final.shown, false);assert.equal(h.ads.pending, false);
    const cadence = readyCadence();cadence.settleInterstitial(final);assert.equal(cadence.snapshot().qualifiedRuns, 3);
  }
});

test('late reward is authoritative only before the physical terminal callback, never at timeout', async () => {
  const h = harness({ timeoutMs: 5 });const pending = h.ads.rewarded();h.callbacks[0].onRewarded();
  const initial = await pending;assert.equal(initial.rewarded, false);
  h.callbacks[0].onOpen();h.callbacks[0].onRewarded();h.callbacks[0].onClose(true);
  const final = await initial.completion;assert.equal(final.rewarded, true);assert.equal(final.shown, true);
  h.callbacks[0].onRewarded();assert.equal(final.rewarded, true);
});

test('late callbacks from a settled request cannot unlock or corrupt a newer request', async () => {
  const h = harness();const first = h.ads.interstitial();h.callbacks[0].onClose(false);await first;
  const second = h.ads.rewarded();const before = h.ads.status;
  h.callbacks[0].onOpen();h.callbacks[0].onRewarded();h.callbacks[0].onClose(true);h.callbacks[0].onError();
  assert.deepEqual(h.ads.status, before);assert.equal(h.lifecycle.has('ad'), true);
  h.callbacks[1].onClose(false);const outcome = await second;assert.equal(outcome.shown, false);assert.equal(outcome.rewarded, false);
});

test('status snapshots are detached and capabilities describe the actual SDK functions', () => {
  const h = harness();assert.equal(h.ads.available, true);assert.equal(h.ads.interstitialAvailable, true);
  const status = h.ads.status;status.pending = true;assert.equal(h.ads.pending, false);
});
