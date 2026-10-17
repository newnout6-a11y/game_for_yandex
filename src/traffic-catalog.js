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
const vehicle = (id, category, label, dimensions, axles, cruise, weight, tags, extra = {}) => Object.freeze({
  id, category, label, ...dimensions, rearAxleZ:REAR_AXLE_Z[id], axles, cruise: Object.freeze(cruise), weight,
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
export function normalizeTrafficKind(kind) { return Object.hasOwn(TRAFFIC_CATALOG, kind) ? kind : 'sedan'; }
export function trafficDefinition(kind) { return TRAFFIC_CATALOG[normalizeTrafficKind(kind)]; }
export function chooseTrafficKind(value) {
  let target = Math.max(0, Math.min(.999999999, Number(value) || 0)) * TRAFFIC_KINDS.reduce((sum, key) => sum + TRAFFIC_CATALOG[key].weight, 0);
  for (const kind of TRAFFIC_KINDS) { target -= TRAFFIC_CATALOG[kind].weight; if (target < 0) return kind; }
  return 'sedan';
}
export function trafficCenterGap(a, b, freeSpace = 2) {
  return (trafficDefinition(a.kind).length + trafficDefinition(b.kind).length) / 2 + freeSpace;
}
