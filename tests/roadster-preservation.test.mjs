import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { snapshotRoadster, sha256 } from './helpers/roadster-preservation.mjs';

const file = path => readFile(new URL('../' + path, import.meta.url));
const proof = JSON.parse(await file('art/roadster-wing-preservation.json'));
const current = await snapshotRoadster();
// These remain the accepted pre-wing output, not a newly substituted golden.
const PRE_WING_GLB = 'd71068fb3da4771f1a5945f03d078cd97a4cac4f0884442cda9c7c732722100e';
const PRE_WING_BLEND = '4c48dfb2c98d76747b20a5daeb951d343112ace1a7f77af984f8e2f8b005e6eb';
const UNCHANGED_UI = '2e256acc022bef6007e2d22c769230254f91d7d68c1c7ae2f5c75120cc9916a2';
const CHANGED_BATCHES = ['body', 'detail_carbon', 'wing_pivot_body', 'wing_pivot_dark_alloy',
  'wing_tip_l_body', 'wing_tip_l_dark_alloy', 'wing_tip_r_body', 'wing_tip_r_dark_alloy'];
const CHANGED_SOURCE = ['left_rear_corner', 'left_rear_fender',
  'rear_deck_forward_formed_band_0', 'rear_deck_forward_formed_band_1', 'rear_deck_forward_formed_band_2',
  'rear_deck_tail_formed_band_0', 'rear_deck_tail_formed_band_1', 'rear_deck_tail_formed_band_2',
  'right_rear_corner', 'right_rear_fender', 'sculpted_rear_aerofoil',
  'wing_fixed_lower_end_cap_l', 'wing_fixed_lower_end_cap_r',
  'wing_hinge_pedestal_l', 'wing_hinge_pedestal_l.001', 'wing_hinge_pedestal_r', 'wing_hinge_pedestal_r.001',
  'wing_pocket_endwall', 'wing_pocket_endwall.001', 'wing_pocket_sidewall', 'wing_pocket_sidewall.001',
  'wing_tapered_fence_l', 'wing_tapered_fence_r', 'wing_tip_hinge_l', 'wing_tip_hinge_r'];

test('intentional wing revision has an explicit immutable tablet-output to revised-model chain', async () => {
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.revision, '2026-10-20-tapered-rear-wing-seating');
  assert.equal(proof.baseline.glbSha256, PRE_WING_GLB);
  assert.equal(proof.baseline.blendSha256, PRE_WING_BLEND);
  assert.notEqual(proof.current.glbSha256, proof.baseline.glbSha256, 'The wing geometry intentionally changed');
  assert.notEqual(proof.current.blendSha256, proof.baseline.blendSha256, 'The editable geometry intentionally changed');
  assert.equal(current.fileSha256, proof.current.glbSha256);
  assert.equal(sha256(await file('art/roadster.blend')), proof.current.blendSha256);
  assert.equal(sha256(await file('scripts/roadster_geometry.py')), proof.current.generatorSha256);
  const metadataBytes = await file('art/textures/roadster-tablet-rocket.json');
  assert.equal(sha256(metadataBytes), proof.provenance.historicalTabletMetadataSha256, 'Do not rewrite history to claim a new tablet render');
  const metadata = JSON.parse(metadataBytes);
  assert.equal(metadata.output.glbSha256, proof.baseline.glbSha256);
  assert.equal(metadata.output.blendSha256, proof.baseline.blendSha256);
  assert.equal(metadata.output.uiSha256, UNCHANGED_UI);
  assert.equal(proof.baseline.uiSha256, UNCHANGED_UI);
  assert.equal(proof.current.uiSha256, UNCHANGED_UI);
});

test('all 61 unrelated runtime batches retain exact geometry attributes, indices, normals, UVs, transforms and materials', () => {
  const preserved = proof.runtime.unchangedMeshes, changed = proof.runtime.changedMeshes;
  assert.equal(Object.keys(preserved).length, 61);
  assert.deepEqual(Object.keys(changed).sort(), CHANGED_BATCHES);
  assert.deepEqual(Object.keys(current.meshes).sort(), [...Object.keys(preserved), ...CHANGED_BATCHES].sort(), 'No added, removed or silently renamed batches');
  for (const [name, record] of Object.entries(preserved))
    assert.deepEqual(current.meshes[name], record, name + ' must retain every exact baseline field');
  for (const [name, { before, after }] of Object.entries(changed)) {
    assert.notDeepEqual(before, after, name + ' is an explicit change, not an unchanged-geometry claim');
    assert.deepEqual(current.meshes[name], after, name + ' must match the audited intentional wing/pocket revision');
    assert.equal(before.material, after.material, name + ' must retain the original material');
  }
});

test('only the two folding-tip nodes and their wing hinge batch change; all other structure and materials stay exact', () => {
  assert.deepEqual(current.counts, { nodes: 99, meshes: 69, materials: 31 });
  assert.deepEqual(current.counts, proof.runtime.counts);
  assert.equal(current.structureSha256, proof.runtime.structureSha256, 'Hierarchy-independent GLB structure, textures, primitive declarations and all material parameters');
  assert.equal(current.materialSha256, proof.runtime.materialSha256);
  assert.equal(Object.keys(proof.runtime.unchangedNodes).length, 96);
  assert.deepEqual(Object.keys(proof.runtime.changedNodes).sort(), ['wing_pivot_dark_alloy', 'wing_tip_l', 'wing_tip_r']);
  for (const [name, expected] of Object.entries(proof.runtime.unchangedNodes)) assert.equal(current.nodes[name], expected, name);
  for (const [name, { before, after }] of Object.entries(proof.runtime.changedNodes)) {
    assert.notEqual(before, after); assert.equal(current.nodes[name], after, name);
  }
});

test('all eight embedded textures, source PNGs and portable packed-image proof retain exact accepted bytes', async () => {
  assert.equal(Object.keys(proof.runtime.images).length, 8);
  assert.deepEqual(current.images, proof.runtime.images);
  assert.deepEqual(Object.keys(proof.source.images).sort(), Object.keys(proof.runtime.images).sort());
  for (const [name, expected] of Object.entries(proof.runtime.images)) {
    const bytes = await file('art/textures/' + name + '.png');
    assert.equal(bytes.length, expected.byteLength, name); assert.equal(sha256(bytes), expected.sha256, name);
    assert.deepEqual(proof.source.images[name], { filepath: '//textures/' + name + '.png', byteLength: expected.byteLength, sha256: expected.sha256 });
  }
  assert.equal(current.images['roadster-cabin-original-ui'].sha256, UNCHANGED_UI);
});

test('editable-source evidence permits only the 25 named wing and immediately adjacent pocket meshes', () => {
  assert.deepEqual(proof.source.counts, { meshes: 775, unchanged: 750, changed: 25 });
  assert.equal(Object.keys(proof.source.unchangedMeshes).length, 750);
  assert.deepEqual(Object.keys(proof.source.changedMeshes).sort(), CHANGED_SOURCE);
  assert.ok(proof.source.unchangedMeshes.hood_formed_band_1, 'Hood corner-normal loop order is not a changed surface');
  for (const [name, record] of Object.entries(proof.source.unchangedMeshes)) {
    assert.match(record.polygonGeometrySha256, /^[a-f0-9]{64}$/, name);
    assert.match(record.cornerPositionNormalUvSha256, /^[a-f0-9]{64}$/, name + ' has authored-normal and UV evidence');
    assert.ok(!(name in proof.source.changedMeshes));
  }
  for (const [name, { before, after }] of Object.entries(proof.source.changedMeshes)) {
    assert.notDeepEqual(before, after, name); assert.deepEqual(before.materials, after.materials, name);
    assert.equal(before.parent, after.parent, name);
  }
});
