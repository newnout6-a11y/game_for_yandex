/**
 * Create a single-flight Yandex ad adapter that owns only the lifecycle's ad pause.
 * SDK errors, unavailable APIs and timeouts resolve to a result instead of throwing.
 * @param {Object} options - SDK facade, pause lifecycle, eligibility callback and timeoutMs in milliseconds.
 * @returns {Object} Rewarded/interstitial promise methods and live rewarded availability.
 */
export function createAds({ sdk, lifecycle, canShow, timeoutMs = 90000 }) {
  let locked = false;
  /**
   * Request an eligible ad and settle exactly once, releasing the ad lock and pause.
   * A reward is granted only by onRewarded, never by successful close alone.
   * @param {'rewarded'|'interstitial'} kind - SDK ad family to invoke.
   * @returns {Promise<{ok:boolean,rewarded:boolean,code:string}>} Terminal callback/timeout outcome.
   */
  function show(kind) {
    const adv = sdk.get()?.adv;
    const method = kind === 'rewarded' ? 'showRewardedVideo' : 'showFullscreenAdv';
    if (locked || !canShow() || !adv?.[method]) return Promise.resolve({ ok: false, rewarded: false, code: 'UNAVAILABLE' });
    locked = true;
    lifecycle.pause('ad');
    return new Promise(resolve => {
      let settled = false;
      let rewarded = false;
      let timer;
      /**
       * Finalize the first terminal callback; late SDK callbacks cannot unlock or resolve twice.
       * @param {string} code - CLOSED, TIMEOUT, ERROR or OFFLINE terminal reason.
       */
      const finish = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        locked = false;
        lifecycle.resume('ad');
        resolve({ ok: code === 'CLOSED', rewarded, code });
      };
      timer = setTimeout(() => finish('TIMEOUT'), timeoutMs);
      try {
        adv[method]({ callbacks: {
          /** The lifecycle was paused before requesting the SDK; opening requires no second pause. */
          onOpen: () => {},
          /** Accept only an unsettled rewarded-video grant; late callbacks and interstitials cannot award energy. */
          onRewarded: () => { if (!settled && kind === 'rewarded') rewarded = true; },
          /** Complete with CLOSED while preserving whether a separate reward callback actually arrived. */
          onClose: () => finish('CLOSED'),
          /** Release the ad pause/lock after the SDK reports a playback error. */
          onError: () => finish('ERROR'),
          /** Release the ad pause/lock when the platform cannot play an ad offline. */
          onOffline: () => finish('OFFLINE'),
        } });
      } catch { finish('ERROR'); }
    });
  }
  return {
    /**
     * Request a reward-bearing video through the shared eligibility and lock checks.
     * @returns {Promise<Object>} Result whose rewarded flag is authoritative.
     */
    rewarded: () => show('rewarded'),
    /**
     * Request a fullscreen ad without granting a reward.
     * @returns {Promise<Object>} Close, unavailable, error or timeout result.
     */
    interstitial: () => show('interstitial'),
    /**
     * Report whether the initialized SDK exposes rewarded video, independent of the current screen.
     * @returns {boolean} Platform capability; canShow is checked when an ad is requested.
     */
    get available() { return Boolean(sdk.get()?.adv?.showRewardedVideo); },
  };
}
