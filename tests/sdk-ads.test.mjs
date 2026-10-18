import test from 'node:test';
import assert from 'node:assert/strict';
import { createSdk } from '../src/sdk.js';
import { createAds } from '../src/ads.js';
import { createLifecycle } from '../src/lifecycle.js';

test('SDK initializes once, registers early subscriptions, emits queued ready/gameplay once', async () => {
  const calls = []; let initCount = 0;
  /** SDK double records subscriptions and ready/start/stop notifications without invoking listeners. */ const real = { /** Record the subscribed event name; this test verifies registration order, not event delivery. */ on: (name, fn) => calls.push(name), features: { LoadingAPI: { /** Append a ready notification so tests can assert it is sent once. */ ready: () => calls.push('ready') }, GameplayAPI: { /** Append a gameplay-start notification for ordering/idempotency assertions. */ start: () => calls.push('start'), /** Append a gameplay-stop notification for ordering/idempotency assertions. */ stop: () => calls.push('stop') } } };
  const sdk = createSdk({ host: { YaGames: { /** Count initialization attempts and resolve to the shared SDK double. */ init: async () => { initCount++; return real; } } } });
  sdk.on('game_api_pause', () => {}); sdk.ready(); sdk.gameplay(true);
  const first = sdk.init(); assert.equal(sdk.init(), first); assert.equal(await first, real); assert.equal(initCount, 1);
  sdk.ready(); sdk.gameplay(true); sdk.gameplay(false); sdk.gameplay(false);
  assert.deepEqual(calls, ['game_api_pause', 'ready', 'start', 'stop']);
});
test('SDK ready after init is sent once, and menu does not report playing', async () => {
  const calls = [];
  const sdk = createSdk({ host: { YaGames: { /** Resolve a minimal SDK whose counters verify that post-init ready is sent once and menu never starts gameplay. */ init: async () => ({ features: { LoadingAPI: { /** Append a ready notification so tests can assert it is sent once. */ ready: () => calls.push('ready') }, GameplayAPI: { /** Append a gameplay-start notification for ordering/idempotency assertions. */ start: () => calls.push('start') } } }) } } });
  await sdk.init(); assert.deepEqual(calls, []); sdk.ready(); sdk.ready(); assert.deepEqual(calls, ['ready']);
});
test('missing SDK, rejected init, timeout, and unavailable APIs cannot block the game', async () => {
  assert.equal(await createSdk({ host: { location: { hostname: 'localhost' } } }).init(), null);
  assert.equal(await createSdk({ host: { YaGames: { /** Reject SDK initialization to verify unavailable/offline platform startup does not block the game. */ init: async () => { throw Error('offline'); } } } }).init(), null);
  assert.equal(await createSdk({ host: { YaGames: { /** Never settle initialization so the 10 ms fallback timeout is exercised. */ init: () => new Promise(() => {}) } }, timeoutMs: 10 }).init(), null);
  const sdk = createSdk({ host: { YaGames: { /** Resolve a faulty SDK feature to verify API exceptions are contained after successful initialization. */ init: async () => ({ features: { LoadingAPI: { /** Throw during a ready notification to exercise the SDK wrapper error guard. */ ready: () => { throw Error('broken'); } } } }) } } });
  await sdk.init(); assert.doesNotThrow(() => { sdk.ready(); sdk.gameplay(true); sdk.on('event', () => {}); });
});
/**
 * Create real ad/lifecycle controllers around a manually driven SDK double.
 * The default ad methods save callbacks without resolving the ad themselves;
 * tests trigger reward, close and error callbacks to verify lock/pause behavior.
 * @param {object} [options] - Availability, timeout and optional SDK override.
 * @param {boolean} [options.canShow=true] - Value returned by the eligibility gate.
 * @param {number} [options.timeoutMs=1000] - Real timer timeout in milliseconds.
 * @param {Function} [options.method] - Replacement rewarded/interstitial method.
 * @returns {object} Controllers plus a getter for the most recently saved callbacks.
 */
function adHarness({ canShow = true, timeoutMs = 1000, method } = {}) {
  const lifecycle = createLifecycle(); let callbacks;
  const sdk = { /** Expose manually controlled advertising methods without loading the platform SDK. */ get: () => ({ adv: { /** Capture reward callbacks for the test unless a throwing/alternative SDK method was supplied. */ showRewardedVideo: method || (options => { callbacks = options.callbacks; }), /** Capture interstitial callbacks for the test unless an SDK method override was supplied. */ showFullscreenAdv: method || (options => { callbacks = options.callbacks; }) } }) };
  const ads = createAds({ sdk, lifecycle, /** Return the fixed eligibility setting for this harness. */ canShow: () => canShow, timeoutMs });
  return { ads, lifecycle, /** Read the most recently captured SDK callbacks so tests can drive their order explicitly. */ callbacks: () => callbacks };
}
test('ads are guarded during gameplay and when SDK is missing', async () => {
  const h = adHarness({ canShow: false }); assert.equal((await h.ads.rewarded()).code, 'UNAVAILABLE'); assert.equal(h.lifecycle.paused, false);
  const ads = createAds({ sdk: { /** Represent an absent SDK even when the independent gameplay eligibility gate permits ads. */ get: () => null }, lifecycle: h.lifecycle, /** Keep gameplay eligibility open so the test isolates the missing-SDK guard. */ canShow: () => true }); assert.equal(ads.available, false); assert.equal((await ads.rewarded()).rewarded, false);
});
test('reward is granted only from onRewarded before close, and only one ad may run', async () => {
  const h = adHarness(); const pending = h.ads.rewarded(); assert.equal(h.lifecycle.paused, true);
  assert.equal((await h.ads.rewarded()).code, 'UNAVAILABLE'); h.callbacks().onRewarded(); h.callbacks().onRewarded(); h.callbacks().onClose();
  const result = await pending; assert.equal(result.rewarded, true); assert.equal(h.lifecycle.paused, false);
});
test('close without reward does not grant a bonus; late reward is ignored', async () => {
  const h = adHarness(); const pending = h.ads.rewarded(); h.callbacks().onClose(); const result = await pending; h.callbacks().onRewarded(); assert.equal(result.rewarded, false);
});
test('terminal ad errors and exceptions release the lock without clearing platform pause', async () => {
  for (const mode of ['error', 'throw', 'offline']) {
    const h = adHarness({ timeoutMs: 10, ...(mode === 'throw' ? { /** Throw synchronously from the ad SDK call to test lock release without clearing platform pause. */ method: () => { throw Error('sdk'); } } : {}) });
    h.lifecycle.pause('platform'); const pending = h.ads.rewarded();
    if (mode === 'error') h.callbacks().onError();
    if (mode === 'offline') h.callbacks().onOffline();
    const result = await pending; assert.equal(result.rewarded, false); assert.equal(h.lifecycle.has('ad'), false); assert.equal(h.lifecycle.has('platform'), true);
    if (mode !== 'throw') { h.callbacks().onClose(); h.callbacks().onRewarded(); }
  }
});
test('interstitial close is successful but never provides a reward', async () => {
  const h = adHarness(); const pending = h.ads.interstitial(); h.callbacks().onRewarded(); h.callbacks().onClose(); const result = await pending; assert.equal(result.ok, true); assert.equal(result.rewarded, false);
});
test('an earned reward is preserved if an error follows the authoritative reward callback', async () => {
  const h = adHarness(); const pending = h.ads.rewarded(); h.callbacks().onRewarded(); h.callbacks().onError();
  const result = await pending; assert.equal(result.rewarded, true); assert.equal(h.lifecycle.paused, false);
});
