import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
const read = path => readFile(new URL(`../${path}`, import.meta.url));
const sourceAudit = JSON.parse(await read('art/garage/reverse-workshop-source-audit.json'));

for (const tier of [1, 2, 3, 4]) {
  test(`tier ${tier}: reverse workshop is editable functional perimeter equipment, not signs or a background image`, async () => {
    const source = (await read(`art/garage/tier${tier}.blend`)).toString('latin1');
    const report = JSON.parse(await read(`art/garage/tier${tier}-report.json`));
    const row = sourceAudit.sources.find(item => item.tier === tier);
    const { scene, json } = await loadRoadsterGeometry(new URL(`../public/assets/garage/tier${tier}.glb`, import.meta.url));
    for (const name of ['Arrival ventilation plenum', 'Arrival intake louver blade',
      'Arrival charging pedestal spine', 'Arrival charging service cable', 'Arrival tethered connector grip',
      'Arrival gate geared motor', 'Arrival gate manual chain',
      'Arrival entrance drainage recess', 'Arrival floor saw-cut expansion seam',
      'Arrival upper wall cast joint', 'Arrival wall television display',
      'Arrival television chassis', 'Arrival television rigid mounting arm',
      'Arrival television power cable', 'Arrival television surround diffuser']) {
      assert.ok(source.includes(`OB${name}\0`), `Real independently editable ${name}`);
    }
    for (const rejected of ['Reverse workshop toolboard back', 'Reverse forged spanner shank',
      'Reverse front storage upper cabinet', 'Reverse consumables wall cupboard']) {
      assert.ok(!source.includes(`OB${rejected}\0`), 'Arrival zone must not duplicate the retained repair room');
    }
    assert.equal(report.reverse_workshop_version, 2);
    assert.ok(report.reverse_workshop_new_parts >= 150 && report.reverse_workshop_new_parts < 650);
    assert.equal(row.new_editable_parts, report.reverse_workshop_new_parts);
    assert.equal(row.original_geometry_unchanged, true);
    assert.equal(row.relative_packed_paths_verified, true);
    assert.equal(row.perimeter_clearance_verified, true);
    assert.ok(row.preserved_original_parts > 400);
    assert.match(row.all_original_geometry_sha256, /^[a-f0-9]{64}$/);
    for (const part of row.new_parts) {
      assert.match(part.name, /^Arrival /, 'New parts serve the arrival zone, not duplicated repair furniture');
      assert.doesNotMatch(part.name, /workbench|toolboard|cupboard|cabinet|spanner|socket set/i);
      assert.ok([...part.min, ...part.max].every(Number.isFinite));
      if (part.floor_seam) { assert.ok(part.max[1] < .03); continue; }
      assert.ok(part.max[0] < -8.65 || part.min[0] > 8.65 || part.max[2] < -7.95,
        `${part.name}: shallow perimeter, no equipment hidden inside the orbit or parking bays`);
    }
    assert.equal(row.poster_swap.saved_and_reopened_all_geometry_shaders_settings_unchanged, true);
    assert.equal(row.poster_swap.garage_camera_unchanged, true);
    assert.equal(report.screen_poster_swap.all_other_glb_buffer_views_byte_identical, true);
    assert.equal(report.screen_poster_swap.all_geometry_transforms_uvs_shaders_settings_unchanged, true);
    assert.deepEqual(report.user_provided_textures, ['roadster-screen-poster.jpg']);
    assert.ok(!report.original_textures.includes('roadster-screen-poster.jpg'));
    assert.equal(row.screen.independent_uv_plane, true);
    assert.deepEqual(row.screen.room_facing_normal, [1, 0, 0]);
    assert.equal(row.screen.width_m, 4.2); assert.equal(row.screen.height_m, 2.3625);
    assert.equal(row.screen.triangles, 2);
    const displays = [];
    scene.traverse(mesh => { if (mesh.isMesh && mesh.material.name === 'garage_screen_display') displays.push(mesh); });
    assert.equal(displays.length, 1, 'One dedicated display material draw, not a screen painted into the wall');
    const display = displays[0], geometry = display.geometry;
    assert.equal(geometry.index.count, 6);
    const corners = new Set(), uv = geometry.attributes.uv, positions = geometry.attributes.position;
    const normalMatrix = new T.Matrix3().getNormalMatrix(display.matrixWorld);
    for (let index = 0; index < positions.count; index++) {
      const point = new T.Vector3().fromBufferAttribute(positions, index).applyMatrix4(display.matrixWorld);
      assert.ok(Math.abs(point.x + 9.02) < 1e-5);
      assert.ok(Math.abs(point.y - 1.46875) < 1e-5 || Math.abs(point.y - 3.83125) < 1e-5);
      assert.ok(Math.abs(point.z + 2.20) < 1e-5 || Math.abs(point.z + 6.40) < 1e-5);
      const normal = new T.Vector3().fromBufferAttribute(geometry.attributes.normal, index).applyNormalMatrix(normalMatrix);
      assert.ok(normal.distanceTo(new T.Vector3(1, 0, 0)) < 1e-5, 'Screen faces the room');
      corners.add(`${uv.getX(index)},${uv.getY(index)}`);
    }
    assert.deepEqual([...corners].sort(), ['0,0', '0,1', '1,0', '1,1']);
    const material = json.materials.find(item => item.name === 'garage_screen_display');
    assert.ok(material.pbrMetallicRoughness.baseColorTexture);
    assert.ok(material.emissiveTexture, 'Packed supplied-video poster stays bright before runtime video replacement');
    assert.deepEqual(material.emissiveFactor, [1, 1, 1]);
    assert.equal(report.garage_screen.material, 'garage_screen_display');
    assert.ok(report.camera_interior.obstacles.some(item => item.name.startsWith('Arrival television chassis')));
    assert.ok(!report.camera_interior.obstacles.some(item => item.name.startsWith('Arrival wall television display')), 'Visual zero-thickness plane is not an invalid camera AABB');
    const actual = scene.userData.garageCamera;
    assert.equal(JSON.stringify(actual), JSON.stringify(report.camera_interior), 'Actual exported contract matches the report, treating signed zero equivalently');
    assert.ok(actual.obstacles.some(item => item.name.startsWith('Arrival ventilation plenum')));
    assert.ok(actual.obstacles.some(item => item.name.startsWith('Arrival charging pedestal spine')));
    assert.ok(actual.obstacles.some(item => item.name.startsWith('Arrival gate geared motor')));
    assert.equal(actual.orbitRadius, 6, 'Keep the complete intended orbit instead of hiding missing artwork');
    if (tier >= 2) assert.ok(source.includes('OBArrival replaceable ventilation filter\0'));
    if (tier >= 3) assert.ok(source.includes('OBArrival clean air distribution trunk\0'));
    if (tier === 4) assert.ok(source.includes('OBArrival regulated service manifold\0'));
  });
}
