import * as T from '../public/vendor/three.js';
import { scenicTerrainHeight } from './landscape.js';

// Original scenery, not an advertising SDK placement. Deliberately no links,
// raycast interaction, event listeners, network requests or animation timers.
export const ROADSIDE_PROMO_PERIOD = 800;
export const ROADSIDE_PROMO_COUNT = 3;
export const ROADSIDE_PROMO_ROAD_EDGE = 8.2;
export const ROADSIDE_PROMO_WIDTH = 8.4;
export const ROADSIDE_PROMO_HEIGHT = 3.8;
export const ROADSIDE_PROMO_SEEDS = Object.freeze([
  Object.freeze({ x: 15.8, z: -145 }),
  Object.freeze({ x: -16.6, z: -413 }),
  Object.freeze({ x: 15.8, z: -680 }),
]);

export const DEFAULT_ROADSIDE_POSTERS = Object.freeze([
  Object.freeze({ id: 'roadster-road', title: 'Roadster', subtitle: 'ДОРОГА ЗОВЁТ', kicker: 'ТВОЙ МАРШРУТ', motif: 'road', background: '#173b40', accent: '#d8b768', ink: '#f4efdf' }),
  Object.freeze({ id: 'roadster-workshop', title: 'Roadster', subtitle: 'СОБЕРИ СВОЙ СТИЛЬ', kicker: 'ГАРАЖ', motif: 'workshop', background: '#e6dfc6', accent: '#a96840', ink: '#244247' }),
  Object.freeze({ id: 'roadster-flight', title: 'Roadster', subtitle: 'ВЫШЕ ПРИВЫЧНОГО', kicker: 'ДВИЖЕНИЕ БЕЗ ГРАНИЦ', motif: 'flight', background: '#355a5e', accent: '#d6c78f', ink: '#f7f1dc' }),
]);

const METAL_COLORS = { ring: '#8b9994', neon: '#81958d', dawn: '#9e9b86' };
const BOARD_CENTER_Y = 5.3;
const FACE_Z = .162;
const NO_RAYCAST = () => {};

/** Normalize short, plain poster copy; outbound identifiers are not poster fields. */
function posterText(value, fallback, limit) {
  if (typeof value !== 'string') return fallback;
  const result = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!result || /(?:https?:|www\.|@)/i.test(result)) return fallback;
  return result.slice(0, limit);
}

/** Accept a compact, bounded collection; empty/malformed input keeps the safe defaults. */
export function normalizeRoadsidePosters(posters = DEFAULT_ROADSIDE_POSTERS) {
  const records = Array.isArray(posters) && posters.length ? posters.slice(0, ROADSIDE_PROMO_COUNT) : DEFAULT_ROADSIDE_POSTERS;
  return records.map((record, index) => {
    const fallback = DEFAULT_ROADSIDE_POSTERS[index % DEFAULT_ROADSIDE_POSTERS.length];
    const item = record && typeof record === 'object' ? record : {};
    const color = (key) => /^#[\da-f]{6}$/i.test(item[key] || '') ? item[key] : fallback[key];
    return Object.freeze({
      id: posterText(item.id, fallback.id, 48),
      title: posterText(item.title, fallback.title, 30),
      subtitle: posterText(item.subtitle, fallback.subtitle, 34),
      kicker: posterText(item.kicker, fallback.kicker, 30),
      motif: ['road', 'workshop', 'flight'].includes(item.motif) ? item.motif : fallback.motif,
      background: color('background'), accent: color('accent'), ink: color('ink'),
      // Optional already-decoded, caller-owned CanvasImageSource. Never a URL.
      // The caller must verify ownership and the source before supplying it.
      artwork: item.artwork && typeof item.artwork === 'object' ? item.artwork : null,
    });
  });
}

/** Draw one filled polygon using only the browser's ordinary canvas path primitives. */
function polygon(context, points, color) {
  context.fillStyle = color; context.beginPath();
  points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath(); context.fill();
}

/** Fit display copy without relying on a downloaded font or changing the approved text. */
function fittedText(context, text, x, y, size, maxWidth, weight = '700') {
  context.font = `${weight} ${size}px Arial, sans-serif`;
  const width = context.measureText(text).width;
  if (width > maxWidth) context.font = `${weight} ${Math.floor(size * maxWidth / width)}px Arial, sans-serif`;
  context.fillText(text, x, y);
}

/** Draw an original low, open-cockpit roadster silhouette, not a manufacturer's vehicle. */
function drawRoadster(context, poster) {
  const { accent, background, ink, motif } = poster;
  context.save(); context.translate(592, 270);
  if (motif === 'flight') {
    polygon(context, [[55, 58], [165, -40], [239, -35], [202, 65]], accent);
    polygon(context, [[214, 64], [375, 3], [395, 16], [310, 88]], ink);
  }
  context.fillStyle = ink;
  for (const x of [90, 310]) { context.beginPath(); context.arc(x, 96, 38, 0, Math.PI * 2); context.fill(); }
  polygon(context, [[18, 72], [55, 39], [125, 29], [160, -3], [219, -3], [249, 36], [331, 49], [373, 76], [366, 98], [24, 98]], accent);
  polygon(context, [[137, 30], [166, 8], [193, 8], [190, 32]], background);
  polygon(context, [[204, 8], [216, 8], [235, 34], [201, 32]], background);
  context.fillStyle = background;
  for (const x of [90, 310]) { context.beginPath(); context.arc(x, 96, 24, 0, Math.PI * 2); context.fill(); }
  context.fillStyle = ink; context.fillRect(27, 66, 35, 7); context.fillRect(337, 69, 26, 7);
  context.strokeStyle = ink; context.lineWidth = 4; context.beginPath(); context.moveTo(127, 65); context.lineTo(272, 68); context.stroke();
  context.restore();
}

/** Bake one original, static 1024×448 poster once; optional artwork is decoded by the caller. */
function createPosterTexture(poster) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 448;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Roadside posters need a 2D canvas context.');
  c.fillStyle = poster.background; c.fillRect(0, 0, 1024, 448);
  c.globalAlpha = .09; c.strokeStyle = poster.ink; c.lineWidth = 2;
  // Subdued topographic/engineering lines sit behind the large wordmark.
  for (let i = 0; i < 7; i++) {
    c.beginPath(); c.moveTo(470 + i * 31, 0); c.bezierCurveTo(930 - i * 20, 120, 410 + i * 24, 300, 810 + i * 29, 448); c.stroke();
  }
  c.globalAlpha = 1;
  c.fillStyle = poster.accent; c.fillRect(48, 48, 65, 8);
  c.fillStyle = poster.ink;
  fittedText(c, poster.kicker, 48, 104, 26, 720, '600');
  fittedText(c, poster.title, 42, 229, 113, 900, 'italic 800');
  fittedText(c, poster.subtitle, 48, 298, 35, 550, '700');
  c.fillStyle = poster.accent; c.fillRect(48, 374, 120, 6);
  c.globalAlpha = .6; c.fillStyle = poster.ink; c.fillRect(182, 374, 50, 6); c.globalAlpha = 1;
  if (poster.motif === 'workshop') {
    c.globalAlpha = .17; c.strokeStyle = poster.ink; c.lineWidth = 3;
    c.strokeRect(612, 258, 368, 137); c.beginPath(); c.moveTo(626, 244); c.lineTo(626, 410); c.moveTo(964, 244); c.lineTo(964, 410); c.stroke(); c.globalAlpha = 1;
  }
  let artworkDrawn = false;
  if (poster.artwork) {
    const source = poster.artwork;
    const width = source.naturalWidth || source.videoWidth || source.width;
    const height = source.naturalHeight || source.videoHeight || source.height;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      // Conservative card-sized window, never a fullscreen or animated texture.
      const scale = Math.max(368 / width, 154 / height), sw = 368 / scale, sh = 154 / scale;
      try { c.drawImage(source, (width - sw) / 2, (height - sh) / 2, sw, sh, 608, 253, 368, 154); artworkDrawn = true; }
      catch { /* Invalid/undecoded artwork keeps the original Roadster illustration. */ }
    }
  }
  if (!artworkDrawn) drawRoadster(c, poster);
  c.strokeStyle = poster.ink; c.globalAlpha = .24; c.lineWidth = 2; c.strokeRect(16, 16, 992, 416); c.globalAlpha = 1;
  const texture = new T.CanvasTexture(canvas);
  texture.name = `roadside-poster-${poster.id}`; texture.colorSpace = T.SRGBColorSpace;
  texture.minFilter = T.LinearMipmapLinearFilter; texture.magFilter = T.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

/** Add a named non-interactive mesh using resources owned by the billboard subsystem. */
function addMesh(group, geometry, material, name, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(geometry, material); mesh.name = name;
  mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.raycast = NO_RAYCAST;
  group.add(mesh); return mesh;
}

/**
 * Construct three quiet recycled roadside boards, without interacting with gameplay.
 * @param {T.Scene|T.Group} scene - Owner receiving a single named group.
 * @param {Object} options - Road centerline sampler and up to three owned poster records.
 * @param {function(number,number):number} [options.bend] - The same roadBend used by scenery.
 * @param {Object[]} [options.posters] - Plain copy, palette, motif, optional decoded artwork.
 * @returns {{group:T.Group,boards:Object[],posters:Object[],update:Function,dispose:Function}}
 * The caller updates with the same distance/route as the landscape. All GPU resources
 * are allocated once; dispose is idempotent and never disposes caller-owned artwork.
 */
export function createRoadsidePromos(scene, { bend = () => 0, posters = DEFAULT_ROADSIDE_POSTERS } = {}) {
  const records = normalizeRoadsidePosters(posters);
  const group = new T.Group(); group.name = 'roadside-promotions'; group.userData.interactive = false;
  const metal = new T.MeshStandardMaterial({ color: METAL_COLORS.ring, metalness: .63, roughness: .63 });
  const concrete = new T.MeshStandardMaterial({ color: '#aaa898', roughness: .98 });
  const panelGeometry = new T.BoxGeometry(ROADSIDE_PROMO_WIDTH, ROADSIDE_PROMO_HEIGHT, .3);
  const faceGeometry = new T.PlaneGeometry(8.12, 3.52);
  const poleGeometry = new T.BoxGeometry(.19, 1, .19);
  const footGeometry = new T.BoxGeometry(.8, .24, .8);
  const braceGeometry = new T.BoxGeometry(7, .14, .16);
  const geometries = [panelGeometry, faceGeometry, poleGeometry, footGeometry, braceGeometry];
  const textures = records.map(createPosterTexture);
  const faces = textures.map(map => new T.MeshStandardMaterial({
    map, roughness: .91, metalness: 0,
    // Keep the printed face stable against its metal backing at long distances.
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  const boards = ROADSIDE_PROMO_SEEDS.map((seed, index) => {
    const board = new T.Group(); board.name = `roadside-promo-${index + 1}`;
    board.userData.posterId = records[index % records.length].id; board.userData.interactive = false;
    addMesh(board, panelGeometry, metal, 'promo-metal-panel', 0, BOARD_CENTER_Y);
    addMesh(board, faceGeometry, faces[index % faces.length], 'promo-poster-face', 0, BOARD_CENTER_Y, FACE_Z);
    addMesh(board, braceGeometry, metal, 'promo-rear-brace', 0, 4.05, -.25);
    const supports = [-2.5, 2.5].map(x => ({
      x, z: -.23,
      post: addMesh(board, poleGeometry, metal, 'promo-steel-post', x, 0, -.23),
      foot: addMesh(board, footGeometry, concrete, 'promo-concrete-foot', x, 0, -.23),
    }));
    group.add(board); return { group: board, seed, poster: records[index % records.length], supports };
  });
  scene.add(group);
  let disposed = false, lastDistance = NaN, lastRoute = '';

  /** Recycle fixed objects and follow the actual road tangent; do not allocate GPU resources. */
  function update(distance, route = 'ring') {
    if (disposed || !Number.isFinite(distance)) return;
    const palette = Object.hasOwn(METAL_COLORS, route) ? route : 'ring';
    if (palette !== lastRoute) metal.color.set(METAL_COLORS[palette]);
    if (distance !== lastDistance) for (const item of boards) {
      const { seed, group: board } = item;
      const z = ((seed.z + distance + 720) % ROADSIDE_PROMO_PERIOD + ROADSIDE_PROMO_PERIOD) % ROADSIDE_PROMO_PERIOD - 720;
      const centerX = seed.x + bend(z, distance);
      const ground = scenicTerrainHeight(seed.x, z - distance);
      const slope = (bend(z + 1, distance) - bend(z - 1, distance)) * .5;
      const yaw = Math.atan(slope) - Math.sign(seed.x) * .1;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      board.position.set(centerX, ground, z); board.rotation.y = yaw;
      // Fog fully masks the far end. Hide recycling behind the player's chase camera.
      board.visible = z < 48;
      for (const support of item.supports) {
        const worldZ = z - sin * support.x + cos * support.z;
        const roadX = centerX + cos * support.x + sin * support.z - bend(worldZ, distance);
        const base = scenicTerrainHeight(roadX, worldZ - distance) - ground;
        const bottom = base + .2, top = 6.6;
        support.foot.position.y = base + .1;
        support.post.scale.y = Math.max(.1, top - bottom);
        support.post.position.y = (top + bottom) / 2;
      }
    }
    lastDistance = distance; lastRoute = palette;
  }

  /** Remove the complete subsystem and free each shared owned resource exactly once. */
  function dispose() {
    if (disposed) return;
    disposed = true; group.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of [metal, concrete, ...faces]) material.dispose();
    for (const texture of textures) texture.dispose();
    group.clear();
  }

  update(0);
  return { group, boards, posters: records, update, dispose };
}
