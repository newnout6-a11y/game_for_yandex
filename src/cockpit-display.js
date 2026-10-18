import * as T from '../public/vendor/three.js';

const WIDTH = 1024, HEIGHT = 640, INTERVAL = .1;
// Exact texture-pixel regions from scripts/roadster_cabin.py::_screen_art.
// The offline-rendered Rocket illustration starts below y=247 and is never painted over.
const REGIONS = {
  speed: [28, 85, 212, 121],
  gear: [28, 234, 212, 40],
  distance: [28, 299, 212, 68],
  status: [344, 202, 640, 39],
  energy: [664, 22, 173, 29],
};
const INERT = Object.freeze({ update() {}, invalidate() {}, dispose() {}, texture: null, telemetry: null });

/**
 * Convert arcade state into bounded, displayable instruments, not factory telemetry.
 * P/D denotes the game's parked/forward mode; there is no simulated gearbox.
 * @param {object} state - Speed in m/s, altitude in metres and nitro in percent.
 * @returns {object} Quantized readouts; the menu/ready presentation always parks.
 */
function readouts(state) {
  const parked = state.phase === 'menu' || state.phase === 'ready';
  const speed = parked ? 0 : Math.max(0, Number.isFinite(state.speed) ? state.speed : 0);
  const altitude = parked ? 0 : Math.max(0, Number.isFinite(state.altitude) ? state.altitude : 0);
  const distance = parked ? 0 : Math.max(0, Number.isFinite(state.distance) ? state.distance : 0);
  let status = parked ? 'PARKED' : speed > .05 ? 'DRIVING' : 'READY';
  if (!parked) {
    if (state.phase === 'crashed') status = 'CRASHED';
    else if (state.rolling) status = 'ROLLING';
    else if (state.landing) status = 'LANDING';
    else if (state.flying) status = 'FLYING';
    else if (altitude > .05) status = 'LANDING';
    if (altitude > .05 || state.flying || state.rolling || state.landing) status += '  /  ' + altitude.toFixed(1) + ' M';
  }
  return {
    speed: String(Math.min(9999, Math.round(speed * 3.6))),
    gear: parked ? 'P' : 'D', status,
    distance: (distance / 1000).toFixed(2) + ' KM',
    energy: Number.isFinite(state.nitro) ? String(Math.round(Math.max(0, Math.min(100, state.nitro)))) + '%' : '--',
  };
}

/**
 * Own a live texture for the already-authored tablet, without changing geometry.
 * The decoded glTF base image is copied once; only its known readout regions are
 * refreshed. Both base and matching emissive maps use the same owned canvas so
 * the old illuminated parked labels cannot show through. Template assets remain
 * shared and untouched. Missing screen/image/canvas support is a harmless no-op.
 * @param {T.Object3D} player - A player instance, never the shared asset template.
 * @returns {{update:function(object,number):void,invalidate:function():void,dispose:function():void,texture:T.CanvasTexture|null,telemetry:object|null}} Owned lifecycle and inspection getters; telemetry is the last rendered, frozen readout.
 */
export function createCockpitDisplay(player) {
  let screen;
  player?.traverse?.(node => {
    if (!screen && node.isMesh && !Array.isArray(node.material)
      && (node.name === 'detail_rc_ui' || ['rc_ui', 'RC_Original_Landscape_UI'].includes(node.material?.name))) screen = node;
  });
  const original = screen?.material, source = original?.map, image = source?.image;
  // Do not guess a layout if a future asset replaces the 16:10 source artwork.
  if (!image || (image.naturalWidth || image.width) !== WIDTH || (image.naturalHeight || image.height) !== HEIGHT
    || typeof document === 'undefined' || !document.createElement) return INERT;
  let canvas, context;
  try {
    canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    context = canvas.getContext('2d');
    if (!context) return INERT;
    context.drawImage(image, 0, 0, WIDTH, HEIGHT);
  } catch { return INERT; }

  const map = new T.CanvasTexture(canvas), material = original.clone();
  // A Texture.clone() shares Source: assigning its image would mutate the asset.
  // Copy sampling/UV semantics onto a fresh CanvasTexture and independent Source.
  for (const property of ['mapping', 'channel', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy',
    'format', 'type', 'generateMipmaps', 'premultiplyAlpha', 'flipY', 'unpackAlignment', 'colorSpace', 'rotation', 'matrixAutoUpdate']) {
    map[property] = source[property];
  }
  for (const property of ['offset', 'repeat', 'center', 'matrix']) map[property].copy(source[property]);
  map.name = 'cockpit-live-game-instruments';
  material.map = map;
  if (original.emissiveMap?.image === image) material.emissiveMap = map;
  screen.material = material;
  let previous = null, elapsed = 0, disposed = false, lastPhase, invalidated = false;

  /** Restore a readout with an empty same-row strip, retaining the authored gradient. */
  function clearRegion(name) {
    const [x, y, w, h] = REGIONS[name];
    context.drawImage(image, 10, y, 1, h, x, y, w, h);
  }

  /** Draw high-contrast canvas text with explicit pixels and no platform font download. */
  function text(value, x, y, size, color, maxWidth) {
    context.font = '600 ' + size + 'px Arial, sans-serif';
    context.textAlign = 'left'; context.textBaseline = 'top'; context.fillStyle = color;
    context.fillText(value, x, y, maxWidth);
  }

  return {
    get texture() { return map; },
    get telemetry() { return previous; },
    /** Refresh the next state even at dt=0 after a camera switch; unchanged pixels still stay cached. */
    invalidate() { if (!disposed) invalidated = true; },
    /**
     * Refresh changed instruments at most every 100 ms during ordinary playback.
     * The first state, phase changes and explicit invalidation display immediately,
     * even at dt=0; subsequent zero-time calls freeze without texture uploads.
     * @param {object} [state={}] - Current simulation snapshot, never mutated.
     * @param {number} [dt=0] - Finite elapsed seconds; zero is a paused frame.
     * @returns {void} Uploads only when a rounded visible readout actually changes.
     */
    update(state = {}, dt = 0) {
      if (disposed) return;
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const reset = state.phase !== lastPhase;
      elapsed = Math.min(INTERVAL, elapsed + step);
      if (previous && !reset && !invalidated && (!step || elapsed + 1e-9 < INTERVAL)) return;
      lastPhase = state.phase; invalidated = false;
      const next = readouts(state);
      let changed = false;
      for (const name of Object.keys(REGIONS)) {
        if (previous?.[name] === next[name]) continue;
        changed = true; clearRegion(name);
        if (name === 'speed') {
          text(next.speed, 34, 90, 88, '#eef0f3', 202);
          text('KM/H', 38, 182, 16, '#9ba2a9', 180);
        } else if (name === 'gear') {
          for (const [index, gear] of ['P', 'R', 'N', 'D'].entries())
            text(gear, 34 + index * 42, 243, gear === next.gear ? 24 : 19, gear === next.gear ? '#e74450' : '#90979f', 32);
        } else if (name === 'distance') {
          text('DISTANCE', 34, 306, 16, '#9ba2a9', 202);
          text(next.distance, 34, 336, 26, '#e5e9ed', 202);
        } else if (name === 'status') text(next.status, 350, 209, 24, '#e5e9ed', 626);
        else text('ENERGY ' + next.energy, 669, 27, 17, '#e5e9ed', 165);
      }
      if (changed) { map.needsUpdate = true; previous = Object.freeze(next); elapsed = 0; }
    },
    /** Restore the original material and release only resources owned by this display. */
    dispose() {
      if (disposed) return;
      disposed = true;
      if (screen.material === material) screen.material = original;
      map.dispose(); material.dispose();
    },
  };
}
