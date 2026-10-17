import { safeCall } from './util.js';
/**
 * Create a bounded, optional Yandex SDK facade for hosted and local play.
 * Ready/gameplay requests and event subscriptions can precede SDK initialization.
 * @param {Object} options - Browser-like host and initialization timeoutMs in milliseconds.
 * @returns {Object} Idempotent initialization and guarded platform notification methods.
 */
export function createSdk({ host = globalThis, timeoutMs = 6000 } = {}) {
  let sdk = null;
  let promise;
  let readyRequested = false;
  let readySent = false;
  let playing = false;
  let sentPlaying = false;
  const subscriptions = [];
  /**
   * Flush requested loading/gameplay state to the initialized SDK without duplicate notifications.
   * Platform exceptions are swallowed because platform integration must not stop the local game.
   */
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
  /**
   * Use an existing SDK or load the platform-relative /sdk.js outside localhost.
   * @returns {Promise<boolean>} Whether an SDK script was already present or loaded successfully.
   */
  async function load() {
    if (host.YaGames) return true;
    const hostname = host.location?.hostname || '';
    if (['localhost', '127.0.0.1', '[::1]', ''].includes(hostname)) return false;
    if (!host.document) return false;
    return new Promise(resolve => {
      const script = host.document.createElement('script');
      script.src = '/sdk.js';
      script.async = true;
      /** Signal successful script fetch; YaGames.init remains a separate guarded step. */
      script.onload = () => resolve(true);
      /** Resolve local fallback after script failure instead of rejecting initialization. */
      script.onerror = () => resolve(false);
      host.document.head.append(script);
    });
  }
  return {
    /**
     * Initialize at most once, bounded by timeoutMs, then register queued events and flush state.
     * @returns {Promise<Object|null>} SDK instance, or null on local play, failure or timeout.
     */
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
    /**
     * Return the initialized SDK handle, or null before initialization/fallback.
     */
    get: () => sdk,
    /**
     * Remember asset readiness and send LoadingAPI.ready once when an SDK is available.
     */
    ready() { readyRequested = true; sync(); },
    /**
     * Remember whether play is active and emit only changes to GameplayAPI.
     * @param {boolean} active - False for menus, results, pauses and blocked gameplay.
     */
    gameplay(active) { playing = Boolean(active); sync(); },
    /**
     * Queue a platform event subscription and also attach it immediately when initialized.
     * @param {string} event - Platform event name.
     * @param {Function} handler - Callback retained for eventual SDK registration.
     */
    on(event, handler) {
      subscriptions.push([event, handler]);
      if (sdk) safeCall(() => sdk.on(event, handler));
    },
  };
}
