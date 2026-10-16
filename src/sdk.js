import { safeCall } from './util.js';
export function createSdk({ host = globalThis, timeoutMs = 6000 } = {}) {
  let sdk = null;
  let promise;
  let readyRequested = false;
  let readySent = false;
  let playing = false;
  let sentPlaying = false;
  const subscriptions = [];
  function sync() {
    if (!sdk) return;
    if (readyRequested && !readySent) {
      safeCall(() => sdk.features?.LoadingAPI?.ready());
      readySent = true;
    }
    if (sentPlaying !== playing) {
      safeCall(() => sdk.features?.GameplayAPI?.[playing ? 'start' : 'stop']());
      sentPlaying = playing;
    }
  }
  async function load() {
    if (host.YaGames) return true;
    const hostname = host.location?.hostname || '';
    if (['localhost', '127.0.0.1', '[::1]', ''].includes(hostname)) return false;
    if (!host.document) return false;
    return new Promise(resolve => {
      const script = host.document.createElement('script');
      script.src = '/sdk.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      host.document.head.append(script);
    });
  }
  return {
    init() {
      if (promise) return promise;
      promise = (async () => {
        let timer;
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
        const initialize = (async () => {
          if (!await load()) return null;
          return await host.YaGames?.init();
        })();
        try {
          sdk = await Promise.race([initialize, timeout]);
          if (sdk) {
            for (const [event, handler] of subscriptions) safeCall(() => sdk.on(event, handler));
            sync();
          }
          return sdk;
        } catch { return null; }
        finally { clearTimeout(timer); }
      })();
      return promise;
    },
    get: () => sdk,
    ready() { readyRequested = true; sync(); },
    gameplay(active) { playing = Boolean(active); sync(); },
    on(event, handler) {
      subscriptions.push([event, handler]);
      if (sdk) safeCall(() => sdk.on(event, handler));
    },
  };
}
