export function createAds({ sdk, lifecycle, canShow, timeoutMs = 90000 }) {
  let locked = false;
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
          onOpen: () => {},
          onRewarded: () => { if (!settled && kind === 'rewarded') rewarded = true; },
          onClose: () => finish('CLOSED'),
          onError: () => finish('ERROR'),
          onOffline: () => finish('OFFLINE'),
        } });
      } catch { finish('ERROR'); }
    });
  }
  return {
    rewarded: () => show('rewarded'),
    interstitial: () => show('interstitial'),
    get available() { return Boolean(sdk.get()?.adv?.showRewardedVideo); },
  };
}
