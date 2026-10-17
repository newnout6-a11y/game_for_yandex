import { ROUTES, DIFFICULTIES } from './config.js';
export const STORAGE_KEY = 'potok.v1';
/**
 * Create a fresh save record so nested best-score objects are never shared between stores.
 */
const defaults = () => ({ best: { flow: 0, rush: 0 }, runs: 0, totalDistance: 0, route: 'ring', difficulty: 'flow', sound: false });
/**
 * Copy only supported settings and finite non-negative integer progress from untrusted storage.
 * @param {*} raw - Parsed localStorage value, including malformed or obsolete shapes.
 * @returns {Object} Complete independent save record with valid route/difficulty identifiers.
 */
export function sanitizeSave(raw) {
  const result = defaults();
  if (!raw || typeof raw !== 'object') return result;
  /**
   * Normalize a saved count/distance/score to a finite non-negative integer, otherwise zero.
   */
  const positive = v => Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  result.best.flow = positive(raw.best?.flow);
  result.best.rush = positive(raw.best?.rush);
  result.runs = positive(raw.runs);
  result.totalDistance = positive(raw.totalDistance);
  if (Object.hasOwn(ROUTES, raw.route)) result.route = raw.route;
  if (Object.hasOwn(DIFFICULTIES, raw.difficulty)) result.difficulty = raw.difficulty;
  result.sound = raw.sound === true;
  return result;
}
/**
 * Load a sanitized local save while preserving in-memory play when storage is blocked or corrupt.
 * @param {Function} provider - Lazily returns a Storage-compatible object; may throw in private mode.
 * @returns {Object} Snapshot, settings and run-result operations; writes never escape as exceptions.
 */
export function createStorage(provider = () => globalThis.localStorage) {
  let data = defaults();
  try { data = sanitizeSave(JSON.parse(provider().getItem(STORAGE_KEY))); } catch { /* Corrupt saves and private browsing remain playable. */ }
  /**
   * Best-effort serialize the current in-memory record; storage failure does not discard progress.
   */
  function persist() {
    try { provider().setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* In-memory progress still works. */ }
  }
  return {
    /**
     * Return a deep detached save snapshot so UI changes cannot mutate persisted state implicitly.
     */
    get: () => structuredClone(data),
    /**
     * Sanitize and persist a settings patch while protecting the existing best-score map.
     * @param {Object} patch - Route, difficulty, sound or other supported save fields.
     */
    settings(patch) { data = sanitizeSave({ ...data, ...patch, best: data.best }); persist(); },
    /**
     * Persist best score and newly travelled distance without double-counting a resumed run.
     * @param {number} score - Current cumulative run score, floored and clamped non-negative.
     * @param {number} distance - Unsaved distance delta in metres, not the full run distance.
     * @param {string} difficulty - Supported best-score bucket.
     * @param {boolean} countRun - False when this run was already counted before a revive.
     * @returns {boolean} Whether the submitted score strictly improves this difficulty's record.
     */
    finish(score, distance, difficulty, countRun = true) {
      if (!Object.hasOwn(DIFFICULTIES, difficulty)) return false;
      const value = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
      const record = value > data.best[difficulty];
      data.best[difficulty] = Math.max(data.best[difficulty], value);
      if (countRun) data.runs++;
      data.totalDistance += Number.isFinite(distance) ? Math.max(0, Math.floor(distance)) : 0;
      persist();
      return record;
    },
  };
}
