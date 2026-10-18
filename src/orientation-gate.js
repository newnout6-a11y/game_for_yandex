const QUERIES = {
  coarse: '(pointer: coarse)',
  portrait: '(orientation: portrait)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
};
const GAME_KEYS = new Set(['Tab', 'Enter', ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * Keep portrait touch devices behind a landscape-only gate, without treating a
 * narrow desktop window as a phone. The caller owns simulation/audio pauses.
 * onChange runs immediately, then only when the blocked state changes.
 * @param {object} options - Injectable browser objects, application root and callback.
 * @returns {object} Read-only blocked/root, refresh() and idempotent dispose().
 */
export function createOrientationGate({
  window: win = globalThis.window,
  document: doc = globalThis.document,
  appRoot = doc?.getElementById('app'),
  onChange = () => {},
} = {}) {
  if (!win || !doc?.body) throw new Error('Orientation gate requires a mounted document.');
  const removers = [];
  const media = Object.fromEntries(Object.entries(QUERIES).map(([key, query]) => [key, win.matchMedia?.(query)]));
  let blocked = false, initialized = false, disposed = false, previousFocus = null;
  let inertSnapshots = [];

  const root = doc.createElement('section');
  root.id = 'orientationGate';
  root.className = 'orientation-gate';
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'orientationGateTitle');
  root.setAttribute('aria-describedby', 'orientationGateMessage');

  const content = doc.createElement('div');
  content.className = 'orientation-gate__content';
  const cue = doc.createElement('div');
  cue.className = 'orientation-gate__cue';
  cue.setAttribute('aria-hidden', 'true');
  const arrow = doc.createElement('span');
  arrow.className = 'orientation-gate__arrow';
  arrow.textContent = '↶';
  const phone = doc.createElement('span');
  phone.className = 'orientation-gate__phone';
  const screen = doc.createElement('span');
  screen.className = 'orientation-gate__screen';
  phone.appendChild(screen);
  cue.appendChild(arrow);
  cue.appendChild(phone);
  const title = doc.createElement('h2');
  title.id = 'orientationGateTitle';
  title.className = 'orientation-gate__title';
  title.textContent = 'Поверни устройство';
  const message = doc.createElement('p');
  message.id = 'orientationGateMessage';
  message.className = 'orientation-gate__message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = 'Игра работает только в горизонтальном положении.';
  content.appendChild(cue);
  content.appendChild(title);
  content.appendChild(message);
  root.appendChild(content);
  doc.body.appendChild(root);

  /** Register exactly one removable listener, including older Safari media lists. */
  function listen(target, name, handler, options) {
    if (target?.addEventListener) {
      target.addEventListener(name, handler, options);
      removers.push(() => target.removeEventListener(name, handler, options));
    } else if (name === 'change' && target?.addListener) {
      target.addListener(handler);
      removers.push(() => target.removeListener(handler));
    }
  }

  /** Mobile UA covers tablets/mice; coarse + touch covers UA-reduced touch devices. */
  function isTouchDevice() {
    const navigator = win.navigator || {};
    const touchPoints = Number(navigator.maxTouchPoints || navigator.msMaxTouchPoints || 0);
    const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    const desktopIpad = /Mac/i.test(navigator.platform || navigator.userAgent || '') && touchPoints > 1;
    const touch = touchPoints > 0 || 'ontouchstart' in win;
    return mobile || desktopIpad || (touch && media.coarse?.matches === true);
  }

  /** Use the layout viewport, not a keyboard-shrunken or pinch-zoomed visual viewport. */
  function isPortrait() {
    const width = Number(win.innerWidth || doc.documentElement?.clientWidth);
    const height = Number(win.innerHeight || doc.documentElement?.clientHeight);
    return width > 0 && height > 0 ? height > width : media.portrait?.matches === true;
  }

  /** Safe focus never forces scroll or reactivates a detached/hidden application control. */
  function focus(element) {
    try { element?.focus?.({ preventScroll: true }); } catch { /* A detached/browser-owned element may refuse focus. */ }
  }
  function canRestoreFocus(element) {
    if (!element || element === doc.body || element === root || element.isConnected === false || element.disabled) return false;
    if (!doc.documentElement?.contains(element)) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.inert || current.getAttribute?.('aria-hidden') === 'true') return false;
    }
    return !element.getClientRects || element.getClientRects().length > 0;
  }
  function restoreFocus() {
    const target = previousFocus;
    previousFocus = null;
    if (canRestoreFocus(target)) focus(target);
  }

  /** Never inert the gate itself, including a fullscreen application container. */
  function applicationTargets(node) {
    if (!node || node === root) return [];
    if (!node.contains(root)) return [node];
    return Array.from(node.children).flatMap(applicationTargets);
  }
  function releaseApplication() {
    for (const { element, inert, ariaHidden } of inertSnapshots) {
      element.inert = inert;
      if (ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', ariaHidden);
    }
    inertSnapshots = [];
  }
  function blockApplication() {
    inertSnapshots = applicationTargets(appRoot).map(element => ({ element, inert: !!element.inert, ariaHidden: element.getAttribute('aria-hidden') }));
    for (const { element } of inertSnapshots) {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }
  }

  /** Fullscreen on a container keeps the gate inside the rendered subtree. */
  function mountForFullscreen() {
    const fullscreen = doc.fullscreenElement || doc.webkitFullscreenElement;
    const host = fullscreen && fullscreen !== doc.documentElement ? fullscreen : doc.body;
    if (root.parentElement === host) return;
    if (blocked) releaseApplication();
    host.appendChild(root);
    if (blocked) { focus(root); blockApplication(); }
  }

  /** Re-evaluate capabilities and viewport; no orientation lock or fullscreen request. */
  function refresh() {
    if (disposed) return blocked;
    mountForFullscreen();
    root.dataset.reducedMotion = String(media.reducedMotion?.matches === true);
    const next = isTouchDevice() && isPortrait();
    if (initialized && next === blocked) return blocked;
    initialized = true;
    blocked = next;
    root.hidden = !blocked;
    if (blocked) {
      previousFocus = doc.activeElement;
      focus(root);
      blockApplication();
    } else releaseApplication();
    onChange(blocked);
    if (!blocked) restoreFocus();
    return blocked;
  }

  /** Stop game handlers, while leaving Escape, Back, reload and OS/browser shortcuts alone. */
  function interceptKeyboard(event) {
    if (!blocked) return;
    event.stopImmediatePropagation();
    if (!event.altKey && !event.ctrlKey && !event.metaKey && GAME_KEYS.has(event.key)) {
      event.preventDefault();
      if (event.key === 'Tab') focus(root);
    }
  }
  function interceptPointer(event) {
    if (!blocked) return;
    const target = event.target;
    if (target !== doc && target !== win && !root.contains(target) && !appRoot?.contains(target)) return;
    event.stopImmediatePropagation();
    // Consume activation, not browser edge-swipe, pinch zoom, scrolling or back/forward.
    // Capturing and inert already keep touch/pointer events away from game controls.
    if (['click', 'dblclick', 'contextmenu'].includes(event.type) && !(event.button > 1) && event.cancelable) event.preventDefault();
  }
  function keepFocus(event) {
    if (blocked && event.target !== root && !root.contains(event.target)) focus(root);
  }

  listen(win, 'resize', refresh);
  listen(win, 'orientationchange', refresh);
  listen(win.screen?.orientation, 'change', refresh);
  listen(win.visualViewport, 'resize', refresh);
  listen(doc, 'fullscreenchange', refresh);
  listen(doc, 'webkitfullscreenchange', refresh);
  for (const query of Object.values(media)) listen(query, 'change', refresh);
  for (const name of ['keydown', 'keyup', 'keypress']) listen(win, name, interceptKeyboard, true);
  for (const name of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'wheel', 'contextmenu']) {
    listen(win, name, interceptPointer, { capture: true, passive: false });
  }
  listen(doc, 'focusin', keepFocus, true);
  refresh();

  return {
    get blocked() { return blocked; },
    get root() { return root; },
    refresh,
    /** Release only this gate's DOM/focus state and let the caller release its pause reason. */
    dispose() {
      if (disposed) return;
      disposed = true;
      removers.splice(0).forEach(remove => remove());
      releaseApplication();
      root.hidden = true;
      root.remove();
      const wasBlocked = blocked;
      blocked = false;
      if (wasBlocked) onChange(false);
      restoreFocus();
    },
  };
}
