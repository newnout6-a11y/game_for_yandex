import { ROUTES, DIFFICULTIES } from './config.js';
export const STORAGE_KEY = 'potok.v1';
const defaults = () => ({ best: { flow: 0, rush: 0 }, runs: 0, totalDistance: 0, route: 'ring', difficulty: 'flow', sound: false });
export function sanitizeSave(raw) {
  const result = defaults();
  if (!raw || typeof raw !== 'object') return result;
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
export function createStorage(provider = () => globalThis.localStorage) {
  let data = defaults();
  try { data = sanitizeSave(JSON.parse(provider().getItem(STORAGE_KEY))); } catch { /* Corrupt saves and private browsing remain playable. */ }
  function persist() {
    try { provider().setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* In-memory progress still works. */ }
  }
  return {
    get: () => structuredClone(data),
    settings(patch) { data = sanitizeSave({ ...data, ...patch, best: data.best }); persist(); },
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
