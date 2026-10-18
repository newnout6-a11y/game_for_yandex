/**
 * Single-flight Yandex adapter. Terminal callbacks release only the ad's pause owner.
 * An application timeout cannot cancel an SDK request: it reports pending recovery,
 * retains its lock/pause and exposes a completion promise for the eventual terminal result.
 */
export function createAds({ sdk, lifecycle, canShow, timeoutMs = 90000 }) {
  let active = null;
  /** Request a real eligible SDK ad; missing capabilities and synchronous failures are contained. */
  function show(kind) {
    let adv;
    const method = kind === 'rewarded' ? 'showRewardedVideo' : 'showFullscreenAdv';
    try {
      adv = sdk.get()?.adv;
      if (active || !canShow() || typeof adv?.[method] !== 'function') return Promise.resolve({ ok: false, rewarded: false, shown: false, pending: false, code: 'UNAVAILABLE' });
    } catch {
      return Promise.resolve({ ok: false, rewarded: false, shown: false, pending: false, code: 'UNAVAILABLE' });
    }
    const request = { kind, shown: false, rewarded: false, timedOut: false };
    active = request;
    lifecycle.pause('ad');
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    return new Promise(resolve => {
      let settled = false;
      let timer;
      /** Settle the physical SDK operation exactly once, including after a reported timeout. */
      const finish = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (active === request) active = null;
        lifecycle.resume('ad');
        const outcome = { ok: code === 'CLOSED', rewarded: request.rewarded, shown: request.shown, pending: false, code };
        resolveCompletion(outcome);
        resolve(outcome);
      };
      timer = setTimeout(() => {
        if (settled) return;
        request.timedOut = true;
        // This is a status, not a cancellation or grant: the SDK may still open an ad.
        resolve({ ok: false, rewarded: false, shown: request.shown, pending: true, code: 'TIMEOUT_PENDING', completion });
      }, timeoutMs);
      try {
        adv[method]({ callbacks: {
          /** An opened ad is a real exposure, even if its eventual close reports an error. */
          onOpen: () => { if (!settled) request.shown = true; },
          /** Reward authority is independent of close status and forbidden for interstitials. */
          onRewarded: () => { if (!settled && kind === 'rewarded') request.rewarded = true; },
          /** Explicit wasShown is a fallback exposure signal; false cannot undo an observed open. */
          onClose: wasShown => { if (settled) return; request.shown ||= wasShown === true; finish('CLOSED'); },
          /** An SDK terminal error means the pending operation has ended, unlike our timer. */
          onError: () => finish('ERROR'),
          /** An SDK offline callback permits normal game continuity without an impression. */
          onOffline: () => finish('OFFLINE'),
        } });
      } catch { finish('ERROR'); }
    });
  }
  return {
    /** Request optional video; only the terminal result's rewarded flag authorizes a grant. */
    rewarded: () => show('rewarded'),
    /** Request a fullscreen ad; only shown:true is an exposure, not CLOSED/ok by itself. */
    interstitial: () => show('interstitial'),
    /** True while an SDK operation still owns the ad pause, including after a local timeout. */
    get pending() { return active !== null; },
    /** Detached recovery status with no SDK callbacks or mutable internal state. */
    get status() { return active ? { kind: active.kind, pending: true, timedOut: active.timedOut, shown: active.shown } : { pending: false, timedOut: false, shown: false }; },
    /** Report a real initialized rewarded capability, without assuming the current screen is eligible. */
    get available() { try { return typeof sdk.get()?.adv?.showRewardedVideo === 'function'; } catch { return false; } },
    /** Report a real initialized fullscreen capability, not merely presence of the SDK object. */
    get interstitialAvailable() { try { return typeof sdk.get()?.adv?.showFullscreenAdv === 'function'; } catch { return false; } },
  };
}
