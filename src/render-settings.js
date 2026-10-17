// Match the drawing buffer to the viewport, without unbounded retina fill cost.
// Quantities are physical render pixels; CSS sizing remains viewport-sized.
export function renderDimensions(width, height, dpr = 1, compact = false) {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const ratio = Math.max(1, Math.min(Number.isFinite(dpr) ? dpr : 1, 1.5));
  const pixelBudget = compact ? 800000 : 1600000;
  const scale = Math.min(ratio, Math.sqrt(pixelBudget / (w * h)), 2048 / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

export function textureAnisotropy(maxSupported, compact = false) {
  return Math.max(1, Math.min(Number.isFinite(maxSupported) ? maxSupported : 1, compact ? 4 : 8));
}
