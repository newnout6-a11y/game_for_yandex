import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { roadBend } from '../src/world.js';
import { scenicTerrainHeight } from '../src/landscape.js';
import { createRoadsidePromos, normalizeRoadsidePosters, DEFAULT_ROADSIDE_POSTERS, ROADSIDE_PROMO_COUNT, ROADSIDE_PROMO_PERIOD, ROADSIDE_PROMO_ROAD_EDGE, ROADSIDE_PROMO_SEEDS } from '../src/roadside-promos.js';

/** Record poster drawing without needing a DOM, WebGL renderer or downloaded images. */
function fixture(options = {}) {
  const previous = globalThis.document, calls = [];
  const context = new Proxy({ measureText: text => ({ width: text.length * 44 }) }, {
    get(object, property) { return property in object ? object[property] : (...args) => calls.push([property, ...args]); },
  });
  globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
  const scene = new T.Scene(); let promos;
  try { promos = createRoadsidePromos(scene, { bend: roadBend, ...options }); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  return { scene, promos, calls };
}

/** Collect identities to ensure scrolling never allocates new GPU resources. */
function resources(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry); materials.add(object.material);
    if (object.material.map) textures.add(object.material.map);
  });
  return { geometries, materials, textures };
}

test('exactly three non-clickable Roadster boards reuse bounded scene resources', () => {
  const { scene, promos, calls } = fixture();
  assert.equal(scene.children.length, 1); assert.equal(promos.boards.length, ROADSIDE_PROMO_COUNT);
  assert.equal(promos.group.children.length, 3);
  const owned = resources(promos.group);
  assert.equal(owned.geometries.size, 5); assert.equal(owned.materials.size, 5); assert.equal(owned.textures.size, 3);
  let meshes = 0;
  promos.group.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    const hits = []; object.raycast({}, hits); assert.equal(hits.length, 0);
    assert.equal(object.castShadow, false);
  });
  assert.equal(meshes, 21);
  assert.equal(calls.filter(([method, text]) => method === 'fillText' && text === 'Roadster').length, 3);
  for (const poster of DEFAULT_ROADSIDE_POSTERS) assert.equal(poster.title, 'Roadster');
  promos.dispose();
});

test('boards scroll, wrap at 800 m, and follow the real road rather than straight world coordinates', () => {
  const { promos } = fixture();
  for (const distance of [0, 123.5, 799.99, 800, 2123.4, -700.2, 10000000]) {
    promos.update(distance, 'dawn');
    for (const { group, seed } of promos.boards) {
      const z = ((seed.z + distance + 720) % 800 + 800) % 800 - 720;
      assert.ok(z >= -720 && z < 80);
      assert.ok(Math.abs(group.position.z - z) < 1e-8);
      assert.ok(Math.abs(group.position.x - seed.x - roadBend(z, distance)) < 1e-8);
      assert.ok(Math.abs(group.position.y - scenicTerrainHeight(seed.x, z - distance)) < 1e-8);
      const slope = (roadBend(z + 1, distance) - roadBend(z - 1, distance)) / 2;
      assert.ok(Math.abs(group.rotation.y - Math.atan(slope) + Math.sign(seed.x) * .1) < 1e-10);
      assert.equal(group.visible, z < 48);
    }
  }
  promos.update(137); const zBefore = promos.boards.map(item => item.group.position.z);
  promos.update(137 + ROADSIDE_PROMO_PERIOD);
  assert.deepEqual(promos.boards.map(item => item.group.position.z), zBefore);
  promos.dispose();
});

test('every panel, post and foundation vertex remains outside the full curved road and shoulder', () => {
  const { promos } = fixture(); const vertex = new T.Vector3();
  // Cover an entire bend phase, many recycle boundaries, both sides and the furthest tangent.
  for (let distance = 0; distance <= 7200; distance += 37) {
    promos.update(distance); promos.group.updateMatrixWorld(true);
    for (const item of promos.boards) item.group.traverse(object => {
      if (!object.isMesh) return;
      const position = object.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        const roadOffset = vertex.x - roadBend(vertex.z, distance);
        assert.equal(Math.sign(roadOffset), Math.sign(item.seed.x));
        assert.ok(Math.abs(roadOffset) > ROADSIDE_PROMO_ROAD_EDGE + 1.5, `unsafe edge ${roadOffset} at ${distance}`);
      }
    });
  }
  promos.dispose();
});

test('each metal post and footing meets the actual sloped terrain', () => {
  const { promos } = fixture(); const point = new T.Vector3();
  for (const distance of [0, 248, 714, 1872, 4999]) {
    promos.update(distance); promos.group.updateMatrixWorld(true);
    for (const item of promos.boards) for (const { post, foot } of item.supports) {
      foot.getWorldPosition(point);
      const ground = scenicTerrainHeight(point.x - roadBend(point.z, distance), point.z - distance);
      assert.ok(Math.abs(point.y - ground - .1) < 1e-8);
      assert.ok(post.scale.y > 5 && post.scale.y < 8);
      assert.ok(Math.abs(post.position.y - post.scale.y / 2 - foot.position.y - .1) < 1e-8);
    }
  }
  promos.dispose();
});

test('updates retain resource identity, ignore invalid distance and use a quiet fallback palette', () => {
  const { promos } = fixture(); const before = resources(promos.group);
  const metal = promos.boards[0].group.children[0].material;
  const initial = metal.color.clone();
  promos.update(45, 'dawn'); assert.notDeepEqual(metal.color, initial);
  promos.update(45, 'unknown'); assert.deepEqual(metal.color, initial);
  const position = promos.boards[0].group.position.clone();
  for (const bad of [NaN, Infinity, -Infinity, undefined]) promos.update(bad, 'dawn');
  assert.deepEqual(promos.boards[0].group.position, position);
  for (let distance = 0; distance < 5000; distance += 43) promos.update(distance, 'neon');
  const after = resources(promos.group);
  for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(promos.boards.map(item => item.seed), ROADSIDE_PROMO_SEEDS);
  promos.dispose();
});

test('owned poster configuration is bounded, plain text, and cannot introduce navigation', () => {
  const posters = normalizeRoadsidePosters([
    { id: 'own-game', title: 'Моя игра', subtitle: '  Новая\nдорога ', kicker: '@unverified', motif: 'workshop', background: '#294c45', url: 'https://example.org', onClick: () => assert.fail('No events') },
    { title: 'https://example.org', accent: 'url(external.png)' },
    null, { title: 'Ignored fourth texture' },
  ]);
  assert.equal(posters.length, 3); assert.equal(posters[0].title, 'Моя игра'); assert.equal(posters[0].subtitle, 'Новая дорога');
  assert.equal(posters[0].kicker, DEFAULT_ROADSIDE_POSTERS[0].kicker);
  assert.equal(posters[1].title, 'Roadster'); assert.equal(posters[1].accent, DEFAULT_ROADSIDE_POSTERS[1].accent);
  assert.equal('url' in posters[0], false); assert.equal('onClick' in posters[0], false);
  assert.equal(normalizeRoadsidePosters([]).length, 3); assert.equal(normalizeRoadsidePosters('bad').length, 3);
  const { promos } = fixture({ posters: [posters[0]] });
  assert.equal(resources(promos.group).textures.size, 1);
  assert.ok(promos.boards.every(item => item.poster.title === 'Моя игра'));
  promos.dispose();
});

test('optional caller-decoded artwork is baked once and never disposed by the boards', () => {
  const artwork = { width: 800, height: 600, dispose() { assert.fail('Caller owns the source'); } };
  const { promos, calls } = fixture({ posters: [{ title: 'Моя игра', artwork }] });
  assert.equal(calls.filter(([method, source]) => method === 'drawImage' && source === artwork).length, 1);
  promos.update(900); promos.dispose();
});

test('dispose detaches the group and disposes every shared geometry, material and map once', () => {
  const { scene, promos } = fixture(); const owned = resources(promos.group), counts = new Map();
  for (const collection of Object.values(owned)) for (const resource of collection) {
    counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  const position = promos.boards[0].group.position.clone();
  promos.dispose(); promos.dispose(); promos.update(2000, 'neon');
  assert.equal(scene.children.length, 0); assert.equal(promos.group.children.length, 0);
  assert.deepEqual(promos.boards[0].group.position, position);
  for (const count of counts.values()) assert.equal(count, 1);
});
