import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { landscapeFixture } from './landscape-fixture.mjs';

test('broadleaf clusters use original mip-filtered masked foliage rather than faceted solid crowns', () => {
  const { scenery: s } = landscapeFixture();
  const leaf = s.batches.find(b => b.kind === 'broadleaf');
  assert.equal(s.leafTexture.image.width, 512); assert.equal(s.leafTexture.image.height, 512);
  assert.equal(s.leafTexture.minFilter, T.LinearMipmapLinearFilter); assert.equal(s.leafTexture.generateMipmaps, true);
  assert.equal(s.leafMaterial.map, s.leafTexture); assert.equal(s.leafMaterial.alphaToCoverage, true);
  assert.equal(s.leafMaterial.alphaTest, .42);
  assert.equal(leaf.seeds.length, 36);
  const g = leaf.mesh.geometry, triangles = (g.index?.count || g.attributes.position.count) / 3;
  assert.ok(triangles <= 300, 'bounded crossed-leaf geometry');
  for (const name of ['position', 'normal', 'uv']) for (const value of g.attributes[name].array) assert.ok(Number.isFinite(value));
});

test('weathered rocks retain smooth finite normals and bounded geometry', () => {
  const { scenery: s } = landscapeFixture(), rock = s.batches.find(b => b.kind === 'rock');
  assert.equal(rock.mesh.material.flatShading, false);
  assert.ok(rock.mesh.geometry.index.count / 3 <= 180);
  for (const value of rock.mesh.geometry.attributes.normal.array) assert.ok(Number.isFinite(value));
  assert.equal(s.batches.length, 12, 'no extra scenery draw batches');
});
