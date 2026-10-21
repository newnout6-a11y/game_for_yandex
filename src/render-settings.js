// These are physical drawing-buffer budgets, not CSS viewport sizes. Auto keeps
// a bounded fallback for standalone callers. RoadRenderer supplies the session
// adaptive budget; higher manual profiles remain explicit opt-ins.
const RENDER_PROFILES = Object.freeze({
  auto: Object.freeze({ desktopPixels: 1600000, compactPixels: 800000, dpr: 1.5, desktopEdge: 2048, compactEdge: 2048 }),
  high: Object.freeze({ desktopPixels: 3686400, compactPixels: 1600000, dpr: 2, desktopEdge: 3840, compactEdge: 2560 }),
  ultra: Object.freeze({ desktopPixels: 8294400, compactPixels: 2073600, dpr: 2, desktopEdge: 4096, compactEdge: 2560 }),
});
const COMPACT_SHADOW = Object.freeze({ mapSize: 1024 });
const DETAILED_SHADOW = Object.freeze({ mapSize: 2048 });
// Parked menus redraw on demand, unlike the continuous road simulation. Give
// their compact canvas enough native samples for a retina iframe without
// changing the selected quality or the driving budget.
const SHOWCASE_COMPACT = Object.freeze({
  auto: Object.freeze({compactPixels:1600000,dpr:3,compactEdge:2560}),
  high: Object.freeze({compactPixels:2073600,dpr:3,compactEdge:2560}),
  ultra: Object.freeze({compactPixels:2073600,dpr:3,compactEdge:2560}),
});

/**
 * Normalize a stored or UI-provided profile without accepting arbitrary keys.
 * @param {*} quality - Profile name; unknown values retain the Auto default.
 * @returns {'auto'|'high'|'ultra'} Canonical lower-case profile.
 */
export function normalizeRenderQuality(quality) {
  const value = typeof quality === 'string' ? quality.trim().toLowerCase() : '';
  return value === 'high' || value === 'ultra' ? value : 'auto';
}

/**
 * Choose a drawing-buffer size without changing the CSS viewport dimensions.
 * A single scale preserves viewport aspect; flooring both axes keeps pixel area
 * strictly inside the selected budget. Extreme aspect ratios retain a one-pixel
 * minimum, since a real drawing buffer cannot have a zero-sized axis.
 * @param {number} width - Requested viewport width in CSS pixels; invalid/nonpositive values become 1.
 * @param {number} height - Requested viewport height in CSS pixels; invalid/nonpositive values become 1.
 * @param {number} [dpr=1] - Device pixel ratio, sanitized to at least 1 before budget scaling.
 * @param {boolean} [compact=false] - Select the profile's smaller compact-device budget.
 * @param {string} [quality='auto'] - Auto, High or Ultra profile (case-insensitive).
 * @param {boolean} [showcase=false] - Use the bounded compact parked-menu budget, never the road budget.
 * @param {Object|null} [auto=null] - Session-local Auto pixel/edge/DPR budget; ignored for manual profiles and showcases.
 * @returns {{width: number, height: number, scale: number}} Floored positive buffer dimensions and unrounded scale.
 */
export function renderDimensions(width, height, dpr = 1, compact = false, quality = 'auto', showcase = false, auto = null) {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const normalized=normalizeRenderQuality(quality);
  const profile = compact&&showcase ? {...RENDER_PROFILES[normalized],...SHOWCASE_COMPACT[normalized]} : RENDER_PROFILES[normalized];
  const adaptive=normalized==='auto'&&!showcase&&auto&&Number.isFinite(auto.pixels)&&auto.pixels>0?auto:null;
  const ratio = Math.max(1, Math.min(Number.isFinite(dpr) ? dpr : 1, adaptive?.maxDpr||profile.dpr));
  const pixelBudget = adaptive?Math.min(auto.pixels,compact?3686400:8294400):(compact ? profile.compactPixels : profile.desktopPixels);
  const maxEdge = adaptive?Math.max(1,Math.min(adaptive.maxEdge||4096,4096)):(compact ? profile.compactEdge : profile.desktopEdge);
  // Keep exact native multiples for normal viewports; split roots are a safe
  // fallback when multiplying two otherwise finite inputs would overflow.
  const area = w * h;
  const areaScale = Number.isFinite(area) ? Math.sqrt(pixelBudget / area) : Math.sqrt(pixelBudget) / Math.sqrt(w) / Math.sqrt(h);
  const scale = Math.min(ratio, areaScale, maxEdge / Math.max(w, h));
  return {
    width: Math.max(1, Math.min(maxEdge, Math.floor(w * scale))),
    height: Math.max(1, Math.min(maxEdge, Math.floor(h * scale))),
    scale,
  };
}

/**
 * Select one shared, immutable shadow-resource bucket without allocating.
 * High and Ultra use the same desktop shadow pass; compact devices always keep
 * the original 1024-square map. Callers change GPU resources only across buckets.
 * @param {string} [quality='auto'] - Render quality profile.
 * @param {boolean} [compact=false] - Whether the compact device budget applies.
 * @returns {{mapSize:number}} Immutable map dimensions, in physical pixels per axis.
 */
export function renderShadowSettings(quality = 'auto', compact = false) {
  return compact || normalizeRenderQuality(quality) === 'auto' ? COMPACT_SHADOW : DETAILED_SHADOW;
}

/**
 * Watch display-DPR changes even when the CSS viewport does not resize.
 * The resolution query is re-armed after every event, with one listener at a
 * time. Supports both modern MediaQueryList events and older addListener APIs.
 * It does not call onChange initially; callers perform their own first resize.
 * @param {function(number):void} onChange - Called with sanitized DPR when it changes.
 * @param {Window|object} [target=globalThis] - Window-like source, injectable in tests.
 * @returns {function():void} Idempotent disposer; no-op when matchMedia is unavailable.
 */
export function observeRenderPixelRatio(onChange, target = globalThis) {
  if (!target || typeof target.matchMedia !== 'function' || typeof onChange !== 'function') return () => {};
  let disposed = false, query = null, listener = null;
  const readRatio = () => Math.max(1, Number.isFinite(target.devicePixelRatio) ? target.devicePixelRatio : 1);
  let ratio = readRatio();
  /** Remove the previous resolution listener before arming a new query. */
  function detach() {
    if (typeof query?.removeEventListener === 'function') query.removeEventListener('change', listener);
    else if (typeof query?.removeListener === 'function') query.removeListener(listener);
    query = null; listener = null;
  }
  /** Track the current DPR rather than a permanently stale initial query. */
  function arm() {
    detach();
    if (disposed) return;
    const watched = target.matchMedia(`(resolution: ${ratio}dppx)`);
    query = watched;
    listener = () => {
      if (disposed || query !== watched) return;
      const next = readRatio(), changed = next !== ratio;
      ratio = next;
      arm();
      if (changed) onChange(next);
    };
    if (typeof watched?.addEventListener === 'function') watched.addEventListener('change', listener);
    else if (typeof watched?.addListener === 'function') watched.addListener(listener);
  }
  arm();
  return () => { if (!disposed) { disposed = true; detach(); } };
}

/**
 * Cap anisotropic texture sampling for the active renderer and device budget.
 * @param {number} maxSupported - Renderer capability; nonfinite values fall back to 1.
 * @param {boolean} [compact=false] - Limit sampling to 4 rather than 8.
 * @returns {number} Sampling level bounded below by 1 and above by the applicable capability/budget.
 */
export function textureAnisotropy(maxSupported, compact = false) {
  return Math.max(1, Math.min(Number.isFinite(maxSupported) ? maxSupported : 1, compact ? 4 : 8));
}
