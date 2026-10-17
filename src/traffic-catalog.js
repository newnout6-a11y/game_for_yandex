// Pure gameplay data. Visual builders may depend on this catalog; simulation
// must never import Three.js or infer collision dimensions from a painted mesh.
export const TRAFFIC_CATEGORIES = Object.freeze({
  passenger: Object.freeze({ label: 'Легковые', description: 'Седан, хэтчбек и внедорожник' }),
  commercial: Object.freeze({ label: 'Малотоннажные', description: 'Развозные фургоны' }),
  freight: Object.freeze({ label: 'Грузовые', description: 'Грузовики и автопоезда' }),
  special: Object.freeze({ label: 'Спецтехника', description: 'Эвакуаторы и пожарные машины' }),
});
// Measured rear axle/bogie centres in the authored GLBs; the lane path runs here.
const REAR_AXLE_Z = Object.freeze({sedan:1.39,hatch:1.22,suv:1.49,van:1.74,boxtruck:2.41,semi:-3.965,towtruck:1.99,firetruck:2.26});
// Conservative measured arch-compression limits; full steering is unchanged.
const BODY_COMPRESSION = Object.freeze({sedan:.025,hatch:.024,suv:.031,van:.030});
/**
 * Builds a shallow-frozen simulation specification, adding measured axle/arch data.
 * Freezes the supplied cruise and tags arrays in place; extra properties are
 * spread last and can override defaults. Dimensions are independent of meshes.
 * @param {string} id - Canonical vehicle kind.
 * @param {string} category - Dynamics/category lookup key.
 * @param {string} label - Human-readable vehicle label.
 * @param {Object} dimensions - Length, width, height and wheel radius in metres.
 * @param {number} axles - Number of axles, each requiring two wheel pivots.
 * @param {number[]} cruise - Minimum/maximum cruise speed in m/s.
 * @param {number} weight - Relative randomized spawn weight.
 * @param {string[]} tags - Descriptive vehicle tags.
 * @param {Object} [extra={}] - Articulation or other specification overrides.
 * @returns {Readonly<Object>} Frozen vehicle definition.
 */
const vehicle = (id, category, label, dimensions, axles, cruise, weight, tags, extra = {}) => Object.freeze({
  id, category, label, ...dimensions, rearAxleZ:REAR_AXLE_Z[id], bodyCompression:BODY_COMPRESSION[id]??null, axles, cruise: Object.freeze(cruise), weight,
  tags: Object.freeze(tags), ...extra,
});
export const TRAFFIC_CATALOG = Object.freeze({
  sedan: vehicle('sedan', 'passenger', 'Седан', { length: 4.65, width: 1.94, height: 1.46, wheelRadius: .34 }, 2, [18, 23], 24, ['passenger', 'four-door']),
  hatch: vehicle('hatch', 'passenger', 'Хэтчбек', { length: 4.08, width: 1.86, height: 1.52, wheelRadius: .33 }, 2, [18, 23], 20, ['passenger', 'compact']),
  suv: vehicle('suv', 'passenger', 'Внедорожник', { length: 4.82, width: 2.04, height: 1.88, wheelRadius: .39 }, 2, [17, 22], 18, ['passenger', 'utility']),
  van: vehicle('van', 'commercial', 'Развозной фургон', { length: 5.62, width: 2.18, height: 2.58, wheelRadius: .39 }, 2, [16, 21], 15, ['cargo', 'light-commercial']),
  boxtruck: vehicle('boxtruck', 'freight', 'Грузовик-фургон', { length: 8.2, width: 2.48, height: 3.48, wheelRadius: .49 }, 2, [15, 19], 9, ['cargo', 'rigid-truck', 'tall']),
  semi: vehicle('semi', 'freight', 'Седельный автопоезд', { length: 16.4, width: 2.5, height: 3.98, wheelRadius: .51 }, 5, [15, 19], 6, ['cargo', 'articulated', 'long', 'tall'], { articulated: true, hitchZ: -3.2, trailerAxleDistance: 8.995, trailerFrontZ:-4.30, trailerRearZ:8.20, maxArticulation:Math.PI*5/12 }),
  towtruck: vehicle('towtruck', 'special', 'Эвакуатор', { length: 7.25, width: 2.4, height: 2.82, wheelRadius: .45 }, 2, [14, 19], 5, ['recovery', 'utility']),
  firetruck: vehicle('firetruck', 'special', 'Пожарная машина', { length: 8.6, width: 2.5, height: 3.32, wheelRadius: .5 }, 3, [15, 20], 3, ['emergency', 'utility', 'tall']),
});
export const TRAFFIC_KINDS = Object.freeze(Object.keys(TRAFFIC_CATALOG));
/**
 * Accepts only own catalogue keys, falling back to sedan for unknown kinds.
 * @param {*} kind - Requested traffic kind.
 * @returns {string} A valid key in TRAFFIC_CATALOG.
 */
export function normalizeTrafficKind(kind) { return Object.hasOwn(TRAFFIC_CATALOG, kind) ? kind : 'sedan'; }
/**
 * Returns the shared immutable simulation definition, with sedan as fallback.
 * @param {*} kind - Requested traffic kind.
 * @returns {Readonly<Object>} Catalogue dimensions, cruise limits and rig metadata.
 */
export function trafficDefinition(kind) { return TRAFFIC_CATALOG[normalizeTrafficKind(kind)]; }
/**
 * Maps a normalized random sample to a kind using catalogue spawn weights.
 * Coerces input numerically and clamps it below one; invalid values map to zero.
 * Does not draw randomness itself, so callers retain deterministic RNG ownership.
 * @param {*} value - Random sample, normally in [0, 1).
 * @returns {string} Weighted traffic kind, with sedan as the defensive fallback.
 */
export function chooseTrafficKind(value) {
  let target = Math.max(0, Math.min(.999999999, Number(value) || 0)) * TRAFFIC_KINDS.reduce((sum, key) => sum + TRAFFIC_CATALOG[key].weight, 0);
  for (const kind of TRAFFIC_KINDS) { target -= TRAFFIC_CATALOG[kind].weight; if (target < 0) return kind; }
  return 'sedan';
}
/**
 * Computes centre-to-centre spacing from two full body lengths and a free gap.
 * Uses catalogue dimensions, so trailers require more room than passenger cars.
 * @param {Object} a - First vehicle descriptor with a kind field.
 * @param {Object} b - Second vehicle descriptor with a kind field.
 * @param {number} [freeSpace=2] - Extra bumper-to-bumper clearance in metres.
 * @returns {number} Required longitudinal centre separation in metres.
 */
export function trafficCenterGap(a, b, freeSpace = 2) {
  return (trafficDefinition(a.kind).length + trafficDefinition(b.kind).length) / 2 + freeSpace;
}
