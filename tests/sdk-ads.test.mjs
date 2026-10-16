import test from 'node:test';
import assert from 'node:assert/strict';
import { createSdk } from '../src/sdk.js';
import { createAds } from '../src/ads.js';
import { createLifecycle } from '../src/lifecycle.js';

test('SDK initializes once, registers early subscriptions, emits queued ready/gameplay once', async () => {
  const calls = []; let initCount = 0;
  const real = { on: (name, fn) => calls.push(name), features: { LoadingAPI: { ready: () => calls.push('ready') }, GameplayAPI: { start: () => calls.push('start'), stop: () => calls.push('stop') } } };
  const sdk = createSdk({ host: { YaGames: { init: async () => { initCount++; return real; } } } });
  sdk.on('game_api_pause', () => {}); sdk.ready(); sdk.gameplay(true);
  const first = sdk.init(); assert.equal(sdk.init(), first); assert.equal(await first, real); assert.equal(initCount, 1);
  sdk.ready(); sdk.gameplay(true); sdk.gameplay(false); sdk.gameplay(false);
  assert.deepEqual(calls, ['game_api_pause', 'ready', 'start', 'stop']);
});
test('SDK ready after init is sent once, and menu does not report playing', async () => {
  const calls = [];
  const sdk = createSdk({ host: { YaGames: { init: async () => ({ features: { LoadingAPI: { ready: () => calls.push('ready') }, GameplayAPI: { start: () => calls.push('start') } } }) } } });
  await sdk.init(); assert.deepEqual(calls, []); sdk.ready(); sdk.ready(); assert.deepEqual(calls, ['ready']);
});
test('missing SDK, rejected init, timeout, and unavailable APIs cannot block the game', async () => {
  assert.equal(await createSdk({ host: { location: { hostname: 'localhost' } } }).init(), null);
  assert.equal(await createSdk({ host: { YaGames: { init: async () => { throw Error('offline'); } } } }).init(), null);
  assert.equal(await createSdk({ host: { YaGames: { init: () => new Promise(() => {}) } }, timeoutMs: 10 }).init(), null);
  const sdk = createSdk({ host: { YaGames: { init: async () => ({ features: { LoadingAPI: { ready: () => { throw Error('broken'); } } } }) } } });
  await sdk.init(); assert.doesNotThrow(() => { sdk.ready(); sdk.gameplay(true); sdk.on('event', () => {}); });
});
function adHarness({ canShow = true, timeoutMs = 1000, method } = {}) {
  const lifecycle = createLifecycle(); let callbacks;
  const sdk = { get: () => ({ adv: { showRewardedVideo: method || (options => { callbacks = options.callbacks; }), showFullscreenAdv: method || (options => { callbacks = options.callbacks; }) } }) };
  const ads = createAds({ sdk, lifecycle, canShow: () => canShow, timeoutMs });
  return { ads, lifecycle, callbacks: () => callbacks };
}
test('ads are guarded during gameplay and when SDK is missing', async () => {
  const h = adHarness({ canShow: false }); assert.equal((await h.ads.rewarded()).code, 'UNAVAILABLE'); assert.equal(h.lifecycle.paused, false);
  const ads = createAds({ sdk: { get: () => null }, lifecycle: h.lifecycle, canShow: () => true }); assert.equal(ads.available, false); assert.equal((await ads.rewarded()).rewarded, false);
});
test('reward is granted only from onRewarded before close, and only one ad may run', async () => {
  const h = adHarness(); const pending = h.ads.rewarded(); assert.equal(h.lifecycle.paused, true);
  assert.equal((await h.ads.rewarded()).code, 'UNAVAILABLE'); h.callbacks().onRewarded(); h.callbacks().onRewarded(); h.callbacks().onClose();
  const result = await pending; assert.equal(result.rewarded, true); assert.equal(h.lifecycle.paused, false);
});
test('close without reward does not grant a bonus; late reward is ignored', async () => {
  const h = adHarness(); const pending = h.ads.rewarded(); h.callbacks().onClose(); const result = await pending; h.callbacks().onRewarded(); assert.equal(result.rewarded, false);
});
test('ad errors, exceptions and timeout release the lock without clearing platform pause', async () => {
  for (const mode of ['error', 'timeout', 'throw', 'offline']) {
    const h = adHarness({ timeoutMs: 10, ...(mode === 'throw' ? { method: () => { throw Error('sdk'); } } : {}) });
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
