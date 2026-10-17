// Match the drawing buffer to the viewport, without unbounded retina fill cost.
// Quantities are physical render pixels; CSS sizing remains viewport-sized.
/**
 * Choose a drawing-buffer size without changing the CSS viewport dimensions.
 * Caps effective DPR at 1.5, either axis at 2048 pixels and area at the device-class budget;
 * large viewports may therefore be rendered below one physical pixel per CSS pixel.
 * @param {number} width - Requested viewport width in CSS pixels; invalid/nonpositive values become 1.
 * @param {number} height - Requested viewport height in CSS pixels; invalid/nonpositive values become 1.
 * @param {number} [dpr=1] - Device pixel ratio, sanitized to at least 1 before budget scaling.
 * @param {boolean} [compact=false] - Select the 800,000 rather than 1,600,000-pixel budget.
 * @returns {{width: number, height: number, scale: number}} Rounded positive buffer dimensions and unrounded scale.
 */
export function renderDimensions(width, height, dpr = 1, compact = false) {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const ratio = Math.max(1, Math.min(Number.isFinite(dpr) ? dpr : 1, 1.5));
  const pixelBudget = compact ? 800000 : 1600000;
  const scale = Math.min(ratio, Math.sqrt(pixelBudget / (w * h)), 2048 / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
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
