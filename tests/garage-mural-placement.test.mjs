import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { assertHistoricalAssetChain, stableOrbitAssetProof } from './helpers/stable-orbit-assets.mjs';

const file = path => new URL(`../${path}`, import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const audit = JSON.parse(await readFile(file('art/garage/mural-placement-audit.json'), 'utf8'));
const expected = {
  version: 2, support: 'Right rear return wall', wall_interior_x: 9.88,
  paint_x: 9.878, paint_offset_m: .002, z_min: 1, z_max: 7,
  y_min: 1.5, y_max: 4.5, normal: [-1, 0, 0], texture_aspect: 2,
};
const textureSha = '996ac11896fe59aa172ad3c8b1b0a60a1743afa5b0a7d5dcbea6a39ffbb472fd';
const near = (value, expected, label, epsilon = 2e-6) => assert.ok(Math.abs(value - expected) < epsilon, `${label}: ${value} vs ${expected}`);

for (const tier of [1, 2, 3, 4]) {
  const { scene, json, bytes } = await loadRoadsterGeometry(file(`public/assets/garage/tier${tier}.glb`));
  const row = audit.sources.find(row => row.tier === tier);
  const mural = scene.getObjectByName(`Tier${tier}_Original_rose_velocity_mural`);
  const root = scene.getObjectByName(`GARAGE_TIER_0${tier}`);

  test(`tier ${tier}: exactly one complete original mural fits one uninterrupted solid wall`, () => {
    assert.ok(mural?.isMesh);
    assert.deepEqual(root.userData.garageMural, expected);
    assert.deepEqual(scene.userData.garageMural, expected);
    assert.deepEqual(mural.userData.solid_wall_placement, expected);
    assert.equal(json.materials.filter(mat => mat.name === 'Original rose velocity mural').length, 1);
    const matches = []; scene.traverse(node => { if (node.userData.original_garage_mural) matches.push(node); });
    assert.deepEqual(matches, [mural], 'Do not leave the old gate projection or duplicate motif');
    const geometry = mural.geometry, position = geometry.attributes.position, uv = geometry.attributes.uv;
    assert.equal(position.count, 4, 'One unfragmented, editable wall quad');
    assert.equal(geometry.index.count, 6, 'Only two triangles, never gate/fins/frames projected separately');
    const bounds = new T.Box3().setFromObject(mural);
    for (const [axis, low, high] of [['x', 9.878, 9.878], ['y', 1.5, 4.5], ['z', 1, 7]]) {
      near(bounds.min[axis], low, `${axis} minimum`); near(bounds.max[axis], high, `${axis} maximum`);
    }
    for (let i = 0; i < position.count; i++) {
      const point = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mural.matrixWorld);
      near(uv.getX(i), (point.z - 1) / 6, 'Full-width original UV without crop or duplication');
      // glTF images use top-left V=0; Blender's exporter flips the vertical UV.
      near(uv.getY(i), 1 - (point.y - 1.5) / 3, 'Full-height original UV without crop');
      assert.ok(point.x > 9.8 && point.z < 7.1, 'Disjoint from every rear service gate and frame');
    }
    near((bounds.max.z - bounds.min.z) / (bounds.max.y - bounds.min.y), 2, 'Original texture aspect');
    const triangle = new T.Triangle(...[0, 1, 2].map(i => new T.Vector3().fromBufferAttribute(position, geometry.index.getX(i)).applyMatrix4(mural.matrixWorld)));
    assert.ok(triangle.getNormal(new T.Vector3()).dot(new T.Vector3(-1, 0, 0)) > .9999, 'Paint faces inward, not through the wall');
  });

  test(`tier ${tier}: real GLB wall backs every mural sample and normal overview stays visible`, () => {
    const meshes = []; scene.traverse(node => { if (node.isMesh) meshes.push(node); });
    const ray = new T.Raycaster();
    for (const u of [0, .25, .5, .75, 1]) for (const v of [0, .25, .5, .75, 1]) {
      ray.set(new T.Vector3(9.8785, 1.5 + v * 3, 1 + u * 6), new T.Vector3(1, 0, 0));
      ray.near = 0; ray.far = .01;
      const hit = ray.intersectObjects(meshes, false)[0];
      assert.ok(hit, `Solid backing at ${u},${v}`);
      assert.equal(hit.object.material.name, 'Warm architectural concrete');
      near(hit.point.x, 9.88, 'The actual supporting wall, not a distant gate');
      near(hit.distance, .0015, 'The decal sits only 2 mm from the solid wall');
    }
    for (const view of row.visibility) {
      let clear = 0;
      assert.ok(view.rays.length >= 50, 'Dense probes sample actual paint, not transparent quad corners');
      for (const sample of view.rays) {
        const [u, v] = sample.uv;
        assert.ok(sample.artwork_alpha >= .5);
        const origin = new T.Vector3(...view.eye), target = new T.Vector3(9.878, 1.5 + v * 3, 1 + u * 6);
        ray.set(origin, target.clone().sub(origin).normalize()); ray.near = 0; ray.far = origin.distanceTo(target) + .005;
        if (ray.intersectObjects(meshes, false)[0]?.object === mural) clear++;
      }
      const currentView = stableOrbitAssetProof(tier).mural_visibility.find(item => item.name === view.name);
      assert.equal(clear, currentView.clear_rays, `${view.name}: runtime geometry agrees with current Blender visibility audit`);
      if (view.name === 'normal-overview') assert.ok(clear >= view.total_rays * (tier === 2 ? .8 : tier < 4 ? .95 : .75), 'Actual paint remains visible; relocated tier2 lift has measured physical occlusion without altering the mural');
    }
  });

  test(`tier ${tier}: preserved source audit matches final assets, materials, TV and camera contracts`, async () => {
    const current = assertHistoricalAssetChain(tier, row.glb_sha256, bytes, 'glb');
    const source = await readFile(file(row.source));
    assertHistoricalAssetChain(tier, row.source_sha256, source, 'source');
    assert.equal(row.non_mural_geometry_materials_images_settings_camera_tv_unchanged, true);
    assert.equal(row.runtime_preservation.non_mural_accessors_byte_identical, true);
    assert.equal(row.runtime_preservation.all_materials_identical, true);
    assert.equal(row.runtime_preservation.all_images_byte_identical, true);
    assert.ok(row.unchanged_non_mural_objects > 400);
    assert.equal(row.source_paths_portable_and_images_packed, true);
    assert.doesNotMatch(source.toString('latin1'), /\/workspace\/(?:scratch|shared)\/|\/home\/agent|\/tmp\//);
    assert.deepEqual(row.placement, expected);
    assert.deepEqual(row.framing_adjustment.translation_game_m, [0, -.75, 0]);
    assert.equal(row.framing_adjustment.quad_size_topology_and_uvs_unchanged, true);
    assert.equal(row.framing_adjustment.all_four_vertices_exact_translation_verified, true);
    assert.equal(row.support_rays.length, 25);
    assert.equal(row.door_and_frame_bounds_disjoint, true);
    assert.equal(row.original_texture_sha256, textureSha);
    assert.equal(sha(await readFile(file('public/assets/garage/original-rose-velocity-mural.png'))), textureSha);
    assert.equal(current.glb_bytes, bytes.length);
    assert.equal(row.runtime.bytes, current.before_glb_bytes, 'Original operation byte count remains historical');
    assert.equal(row.runtime.draw_batches, json.materials.length);
    const material = json.materials.find(mat => mat.name === 'Original rose velocity mural');
    assert.equal(material.alphaMode, 'BLEND');
    assert.equal(material.pbrMetallicRoughness.metallicFactor, 0);
    assert.ok(material.pbrMetallicRoughness.roughnessFactor > .9);
    const report = JSON.parse(await readFile(file(`art/garage/tier${tier}-report.json`), 'utf8'));
    assert.deepEqual(root.userData.garageScreen, report.garage_screen);
    assert.equal(JSON.stringify(root.userData.garageCamera), JSON.stringify(report.camera_interior));
    assert.equal(report.screen_poster_swap.historical_operation, true, 'Preserve the earlier exact poster-replacement provenance');
    assert.match(report.screen_poster_swap.scope_note, /earlier poster replacement only/);
    const history = report.mural_relocation_history;
    assert.equal(history[0].glb_before_sha256, report.screen_poster_swap.glb_after_sha256);
    assert.equal(report.mural_relocation.glb_before_sha256, history.at(-1).glb_after_sha256);
    assert.deepEqual(report.mural_relocation.translation_game_m, [0, -.75, 0]);
    assert.equal(report.mural_relocation.size_and_uvs_unchanged, true);
    assert.equal(report.mural_relocation.source_after_sha256, row.source_sha256);
    assert.equal(report.mural_relocation.glb_after_sha256, row.glb_sha256);
    assert.equal(report.mural_relocation.full_glb_byte_identical, false, 'Never reuse historic full-buffer preservation claims for the changed mural');
    assert.deepEqual(report.user_provided_textures, ['roadster-screen-poster.jpg']);
  });
}
