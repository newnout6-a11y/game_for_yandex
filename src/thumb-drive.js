const NEUTRAL = Object.freeze({ steer: 0, throttle: 0, brake: 0 });
const HINT = 'Держи: газ · в стороны: руль · вниз: тормоз';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/**
 * Convert one held thumb's displacement from its starting point to driving axes.
 * A stationary thumb accelerates; downward travel first lifts the gas, then brakes.
 * Steering remains independent, including while braking. No pedal is latched.
 * @param {object} sample - Pixel displacement and the pad's dimensions at pointer down.
 * @returns {{steer:number, throttle:number, brake:number}} Bounded, finite axes.
 */
export function thumbControlsFromOffset({ dx = 0, dy = 0, width = 144, height = 78 } = {}) {
  const horizontal = clamp(finite(dx) / Math.max(24, finite(width, 144) * .32), -1, 1);
  const downward = clamp(finite(dy) / Math.max(20, finite(height, 78) * .42), 0, 1);
  const steer = Math.abs(horizontal) <= .06 ? 0 : Math.sign(horizontal) * (Math.abs(horizontal) - .06) / .94;
  return {
    steer,
    throttle: clamp((.46 - downward) / .30, 0, 1),
    brake: clamp((downward - .46) / .54, 0, 1),
  };
}

/**
 * Mount a landscape touch pad inside a dedicated, otherwise empty container.
 * The caller enables it only during active play and owns the analog input source.
 * Existing global keyboard controls are intentionally not registered a second time.
 * @param {object} options - Mounted root, injectable window and controls callback.
 * @returns {object} Root/pad references, setEnabled(boolean), clear() and dispose().
 */
export function createThumbDrive({ root, window: win = globalThis.window, onControls = () => {} } = {}) {
  const doc = root?.ownerDocument;
  if (!root || !doc?.createElement || !win) throw new Error('Thumb drive requires a mounted root and window.');
  if (typeof onControls !== 'function') throw new TypeError('Thumb drive requires an onControls callback.');
  let enabled = false, disposed = false, gesture = null, previous = { ...NEUTRAL };
  const removers = [];
  root.classList.add('thumb-drive');
  root.dataset.enabled = 'false';

  const pad = doc.createElement('button');
  pad.type = 'button';
  pad.className = 'thumb-drive__pad';
  pad.disabled = true;
  pad.setAttribute('aria-label', 'Управление одной рукой: держи для газа, веди в стороны для руля, вниз для тормоза. Отпусти для движения накатом. Клавиатура: W/S и стрелки.');
  pad.setAttribute('aria-pressed', 'false');
  const hint = doc.createElement('span');
  hint.className = 'thumb-drive__hint';
  hint.textContent = HINT;
  const visual = doc.createElement('span');
  visual.className = 'thumb-drive__visual';
  visual.setAttribute('aria-hidden', 'true');
  for (const [name, text] of [['gas', 'ГАЗ + РУЛЬ'], ['left', '‹'], ['right', '›'], ['brake', '↓ ТОРМОЗ'], ['knob', '']]) {
    const part = doc.createElement('span');
    part.className = 'thumb-drive__' + name;
    part.textContent = text;
    visual.appendChild(part);
  }
  pad.appendChild(visual);
  root.appendChild(pad);
  root.appendChild(hint);

  /** Keep every listener removable and let pointer capture's fallback use the window. */
  function listen(target, name, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler, options);
    removers.push(() => target.removeEventListener(name, handler, options));
  }

  /** Send a fresh value so the consumer cannot mutate this control's cached sample. */
  function publish(controls, force = false) {
    if (!force && Object.keys(NEUTRAL).every(key => controls[key] === previous[key])) return;
    previous = { ...controls };
    onControls({ ...controls });
  }

  /** Forget ownership before releasing capture, which may synchronously fire a loss event. */
  function clear() {
    if (disposed) return;
    const pointer = gesture?.id;
    gesture = null;
    pad.dataset.held = 'false';
    pad.dataset.mode = 'idle';
    pad.setAttribute('aria-pressed', 'false');
    pad.style.removeProperty('--thumb-x');
    pad.style.removeProperty('--thumb-y');
    if (pointer !== undefined) {
      try { if (pad.hasPointerCapture?.(pointer)) pad.releasePointerCapture(pointer); } catch { /* Already cancelled by the browser. */ }
    }
    publish(NEUTRAL, true);
  }

  /** Visual feedback follows the finger but stays inside the pad's visible boundary. */
  function sample(event) {
    if (!gesture || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const { x, y, left, top, width, height } = gesture;
    const controls = thumbControlsFromOffset({ dx: event.clientX - x, dy: event.clientY - y, width, height });
    pad.style.setProperty('--thumb-x', clamp(event.clientX - left, 18, Math.max(18, width - 18)) + 'px');
    pad.style.setProperty('--thumb-y', clamp(event.clientY - top, 18, Math.max(18, height - 18)) + 'px');
    pad.dataset.mode = controls.brake > 0 ? 'brake' : controls.throttle > 0 ? 'gas' : 'coast';
    publish(controls);
  }

  function down(event) {
    if (disposed || !enabled || gesture || (event.button !== undefined && event.button !== 0)) return;
    if (!Number.isFinite(event.pointerId) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const bounds = pad.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0)) return;
    event.preventDefault();
    // A second finger on the flight control is allowed; only pad ownership is exclusive.
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    pad.dataset.held = 'true';
    pad.setAttribute('aria-pressed', 'true');
    try { pad.setPointerCapture?.(event.pointerId); } catch { /* Window listeners still own release/cancel. */ }
    sample(event);
  }

  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) { clear(); return; }
    if (event.cancelable) event.preventDefault();
    sample(event);
  }

  function release(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    clear();
  }

  /** Pauses, menus and orientation changes must disable, not merely hide, live input. */
  function setEnabled(value) {
    if (disposed) return;
    const next = value === true;
    if (enabled === next) return;
    enabled = next;
    root.dataset.enabled = String(enabled);
    pad.disabled = !enabled;
    if (!enabled) clear();
  }

  listen(pad, 'pointerdown', down);
  // Pad listeners also work in isolated hosts; repeated bubbling samples are deduplicated.
  for (const target of [pad, win]) {
    listen(target, 'pointermove', move, { passive: false });
    listen(target, 'pointerup', release);
    listen(target, 'pointercancel', release);
  }
  listen(pad, 'lostpointercapture', release);
  listen(pad, 'contextmenu', event => { if (enabled) event.preventDefault(); });
  listen(pad, 'blur', clear);
  listen(win, 'blur', clear);
  listen(win, 'resize', clear);
  listen(win, 'orientationchange', clear);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) clear(); });
  clear();

  return {
    root, pad, setEnabled, clear,
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      enabled = false;
      root.dataset.enabled = 'false';
      pad.disabled = true;
      for (const remove of removers) remove();
      pad.remove();
      hint.remove();
      root.classList.remove('thumb-drive');
    },
  };
}
