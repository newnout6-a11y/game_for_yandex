import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const audit = JSON.parse(await readFile(new URL('../../art/garage/stable-orbit-placement-audit.json', import.meta.url), 'utf8'));
export const stableOrbitAssetProof = tier => {
  const row = audit.sources.find(row => row.tier === tier);
  assert.ok(row, `Tier ${tier}: current bounded placement proof`);
  return row;
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Preserve old-stage hashes and require a measured, exact chain to current bytes. */
export function assertHistoricalAssetChain(tier, historicalHash, bytes, kind) {
  const row = stableOrbitAssetProof(tier), prefix = kind === 'source' ? 'source' : 'glb';
  assert.equal(historicalHash, row[`before_${prefix}_sha256`], 'Prior operation remains tied to its actual checkpoint, not relabeled current');
  assert.equal(sha(bytes), row[`${prefix}_sha256`], 'Current artifact matches the independently audited bounded translation');
  for (const key of ['all_unrelated_source_meshes_uvs_materials_images_settings_unchanged',
    'all_unrelated_source_transforms_and_extras_unchanged',
    'all_runtime_materials_images_unchanged', 'all_runtime_triangles_match_current_source_polygons_and_uvs',
    'all_unrelated_runtime_world_positions_preserved', 'camera_boxes_match_actual_translated_objects']) {
    assert.equal(row[key], true, `Bounded placement must preserve ${key}`);
  }
  return row;
}
