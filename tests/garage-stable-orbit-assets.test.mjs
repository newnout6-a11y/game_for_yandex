import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stableOrbitAssetProof, assertHistoricalAssetChain } from './helpers/stable-orbit-assets.mjs';
const read = path => readFile(new URL(`../${path}`, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await read('art/garage/stable-orbit-placement.json'));
const historical = JSON.parse(await read('art/garage/mural-placement-audit.json'));

test('the bounded recipe changes only the full lift and two intact technical islands', () => {
  assert.deepEqual(Object.keys(manifest.tiers).sort(), ['2', '4']);
  const lift = manifest.tiers['2'], islands = manifest.tiers['4'];
  assert.deepEqual(lift.map(item => item.objects.length), [6, 6, 1]);
  assert.deepEqual(lift.map(item => item.translation_game_m), [[-2.9, 0, 0], [2.9, 0, 0], [0, .3, 0]]);
  assert.equal(lift[2].original_width_m, 8.05); assert.equal(lift[2].final_width_m, 13.85);
  assert.equal(lift[2].widen_game_x_m, 5.8);
  assert.ok(lift[0].objects.includes('Lift screw channel')); assert.ok(lift[1].objects.includes('Lift screw channel.001'));
  assert.deepEqual(islands.map(item => item.objects.length), [36, 36]);
  assert.deepEqual(islands.map(item => item.translation_game_m), [[-1.3, 0, 0], [1.3, 0, 0]]);
});

for (const tier of [1, 2, 3, 4]) test(`tier ${tier}: exact bounded source/runtime placement preserves every non-target payload`, async () => {
  const row = stableOrbitAssetProof(tier), old = historical.sources.find(item => item.tier === tier);
  const source = await read(row.source), glb = await read(row.glb);
  assertHistoricalAssetChain(tier, old.source_sha256, source, 'source');
  assertHistoricalAssetChain(tier, old.glb_sha256, glb, 'glb');
  assert.equal(row.before_glb_bytes, old.runtime.bytes);
  assert.equal(row.glb_bytes, glb.length);
  assert.equal(row.source_paths_portable_and_images_packed, true);
  assert.equal(row.all_source_polygon_multiplicities_verified, true);
  assert.equal(row.runtime_shading_normal_constraints_enforced, true);
  assert.equal(row.unrelated_runtime_normals_exact, true);
  assert.equal(row.normal_angle_tolerance_degrees, .1);
  assert.ok(row.normal_component_tolerance < .00175, 'Do not loosen the accepted rounding ceiling');
  assert.equal(row.raw_normal_unit_length_tolerance, 4 * 2 ** -23);
  assert.doesNotMatch(source.toString('latin1'), /\/workspace\/(?:scratch|shared)\/|\/home\/agent|\/tmp\//);
  const intended = (manifest.tiers[String(tier)] || []).flatMap(assembly => assembly.objects);
  assert.deepEqual(row.transformed_objects.map(part => part.name).sort(), [...intended].sort());
  assert.ok(row.unchanged_source_objects > 400, 'Preserve the authored room rather than replacing it');
  for (const key of ['materials', 'images', 'settings', 'armatures', 'statistics']) {
    assert.deepEqual(row.source_fingerprint_before[key], row.source_fingerprint_after[key], `${key}: exact source payload`);
  }
  for (const part of row.transformed_objects) {
    const assembly = manifest.tiers[String(tier)].find(assembly => assembly.objects.includes(part.name));
    assert.deepEqual(part.translation_game_m, assembly.translation_game_m);
    assert.equal(part.widen_game_x_m, assembly.widen_game_x_m || 0);
    for (const axis of [0, 1, 2]) for (const edge of ['min', 'max']) {
      assert.ok(Math.abs(part.after_bounds_m[edge][axis] - part.before_bounds_m[edge][axis] - part.translation_game_m[axis] - (axis === 0 ? (edge === 'min' ? -1 : 1) * part.widen_game_x_m / 2 : 0)) < 2e-6,
        `${part.name}: exact approved translation/bridge width and no other shape alteration`);
    }
  }
  const length = glb.readUInt32LE(12), doc = JSON.parse(glb.subarray(20, 20 + length)), binary = glb.subarray(28 + length);
  const arrayBytes = index => {
    const accessor = doc.accessors[index], view = doc.bufferViews[accessor.bufferView];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const item = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType] * components;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0), stride = view.byteStride || item;
    return Buffer.concat(Array.from({ length: accessor.count }, (_, i) => binary.subarray(start + i * stride, start + i * stride + item)));
  };
  for (const record of row.runtime_accessors) {
    assert.equal(sha(arrayBytes(record.accessor)), record.after_sha256, `${record.mesh}/${record.semantic}: current exported payload`);
    assert.equal(doc.accessors[record.accessor].count, record.count);
    if (record.local_payload_byte_identical) assert.equal(record.before_sha256, record.after_sha256);
    // Blender may reindex equivalent triangle corners after joining a moved part.
    // The independently measured drawn-corner proof below checks actual geometry.
  }
  assert.equal(row.runtime_changed_triangle_corners, row.runtime_triangles.reduce((sum, item) => sum + item.changed_triangle_corners, 0));
  assert.equal(row.runtime_changed_triangle_corners > 0, intended.length > 0);
  for (const mesh of row.runtime_triangles) {
    assert.equal(mesh.source_polygon_containment_verified, true);
    assert.ok(mesh.source_position_max_error_m <= row.world_position_tolerance_m);
    assert.ok(mesh.source_uv_max_error <= 2e-5);
    assert.ok(mesh.baseline_normal_max_component_error <= row.normal_component_tolerance, 'Bounded export-normal rounding only');
    assert.ok(mesh.baseline_normal_max_angle_degrees <= row.normal_angle_tolerance_degrees, 'Enforce actual angle, not only per-component error');
    assert.ok(mesh.raw_normal_max_unit_length_error <= row.raw_normal_unit_length_tolerance, 'Validate before normalization');
    assert.equal(mesh.unrelated_normal_max_component_error, 0, 'Every unrelated exported shading normal remains exact');
    assert.equal(mesh.unrelated_normal_max_angle_degrees, 0);
  }
  for (const image of row.runtime_images) {
    const descriptor = doc.images.find(item => item.name === image.name), view = doc.bufferViews[descriptor.bufferView];
    assert.equal(sha(binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)), image.sha256);
  }
  assert.deepEqual(doc.materials, row.runtime_materials, 'Current material definitions match the exact preserved definitions');
});
