/**
 * Bound a numeric value to the inclusive [min, max] interval; callers supply ordered bounds.
 */
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
/**
 * Linearly interpolate a to b by dimensionless t; t is not clamped, so extrapolation is allowed.
 */
export const lerp = (a, b, t) => a + (b - a) * t;
/**
 * Floor a numeric display value and format it with Russian locale grouping.
 */
export const formatNumber = value => Math.floor(value).toLocaleString('ru-RU');
/**
 * Create an independent deterministic Mulberry32 random stream from an unsigned 32-bit seed.
 * @param {number} seed - Defaults to the current timestamp, converted to uint32.
 * @returns {Function} Zero-argument generator yielding numbers in [0, 1).
 */
export function seededRandom(seed = Date.now()) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/**
 * Invoke an optional platform callback without letting its exception interrupt gameplay.
 * @param {Function|undefined|null} fn - Callable when present.
 * @param {...*} args - Forwarded arguments.
 * @returns {*} Callback result, or undefined when missing or throwing.
 */
export function safeCall(fn, ...args) {
  try { return fn?.(...args); } catch { return undefined; }
}
