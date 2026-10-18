import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from '../public/vendor/three.js';
import { GarageScene } from '../src/garage-scene.js';
import { CATALOG } from '../src/progression-catalog.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const file = path => new URL(`../${path}`, import.meta.url);
const jsonFile = async path => JSON.parse(await readFile(file(path), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = await jsonFile('art/garage/provenance.json');
const parkingAudit = await jsonFile('art/garage/parking-envelope-audit.json');
const exportAudit = await jsonFile('art/garage/export-audit.json');
const capacities = [1, 2, 3, 3];
const rejectedBrand = /aerokrai|аэрокрай|поток/iu;
const assets = await Promise.all([1, 2, 3, 4].map(async tier => ({
  tier,
  report: await jsonFile(`art/garage/tier${tier}-report.json`),
  blend: await readFile(file(`art/garage/tier${tier}.blend`)),
  ...await loadRoadsterGeometry(file(`public/assets/garage/tier${tier}.glb`)),
})));

function near(actual, expected, message, epsilon = 2e-5) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} versus ${expected}`);
}

/** Read real uncompressed Blender blocks, not a renamed file with a magic prefix. */
function blendBlocks(bytes) {
  assert.match(bytes.subarray(0, 12).toString(), /^BLENDER-v\d{3}$/,
    'Editable sources use the little-endian 64-bit Blender file format');
  const blocks = [];
  for (let offset = 12; offset + 24 <= bytes.length;) {
    const code = bytes.subarray(offset, offset + 4).toString().replaceAll('\0', '');
    const size = bytes.readUInt32LE(offset + 4), end = offset + 24 + size;
    assert.ok(end <= bytes.length, `${code}: complete Blender data block`);
    blocks.push({ code, data: bytes.subarray(offset + 24, end) });
    if (code === 'ENDB') { assert.equal(end, bytes.length); return blocks; }
    offset = end;
  }
  assert.fail('Blender source is missing its ENDB block');
}

/** Visit original indexed triangles, optionally transformed into runtime world metres. */
function visitTriangles(scene, callback, world = true) {
  const triangle = new T.Triangle();
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      for (const [j, vertex] of [triangle.a, triangle.b, triangle.c].entries()) {
        vertex.fromBufferAttribute(position, index ? index.getX(i + j) : i + j);
        if (world) vertex.applyMatrix4(mesh.matrixWorld);
      }
      callback(triangle, mesh, i / 3);
    }
  });
}

/** Merged material meshes have huge bounds; test triangles, not their whole-mesh AABBs. */
function assertClear(scene, boxes) {
  const violations = [], triangleBounds = new T.Box3();
  visitTriangles(scene, (triangle, mesh, index) => {
    triangleBounds.setFromPoints([triangle.a, triangle.b, triangle.c]);
    for (const { name, box } of boxes) {
      if (box.intersectsBox(triangleBounds) && box.intersectsTriangle(triangle) && violations.length < 20) {
        violations.push({ bay: name, mesh: mesh.name, triangle: index });
      }
    }
  });
  assert.deepEqual(violations, [], 'Authored geometry must clear the measured display volumes above 3 cm');
}

test('all four editable garage sources and original textures match reproducible provenance', async () => {
  assert.equal(provenance.source, 'scripts/create_garage.py');
  assert.match(provenance.authoring_tool, /^Blender /);
  assert.deepEqual(provenance.external_assets_used_in_exports, []);
  assert.equal(provenance.transport_assets_modified, false);
  assert.deepEqual(provenance.approved_display_capacity, capacities);
  assert.deepEqual(provenance.exports.map(record => record.tier), [1, 2, 3, 4]);
  assert.equal(CATALOG.brand.ru, 'Roadster'); assert.equal(CATALOG.brand.en, 'Roadster');
  // These are new garage assets only, not old save keys or historical folder names.
  assert.doesNotMatch(JSON.stringify(provenance), rejectedBrand);
  const required = ['scripts/create_garage.py', 'scripts/sanitize_blend_sources.py', ...assets.map(({ tier }) => `art/garage/tier${tier}.blend`),
    'public/assets/garage/original-concrete-grain.png', 'public/assets/garage/original-concrete-roughness.png', 'public/assets/garage/original-rose-velocity-mural.png',
    'art/garage/mural/create_mural.py', 'art/garage/mural/rose-velocity.svg', 'art/garage/mural/manifest.json'];
  for (const path of required) {
    const record = provenance.files.find(record => record.path === path);
    assert.ok(record, `Provenance includes ${path}`);
    const bytes = await readFile(file(path));
    assert.equal(bytes.length, record.bytes, `${path}: source byte count`);
    assert.equal(sha256(bytes), record.sha256, `${path}: source hash`);
  }
  const generator = await readFile(file(provenance.source), 'utf8');
  assert.doesNotMatch(generator, rejectedBrand);
  const previewImport = generator.indexOf("bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'public','assets','roadster.glb'))");
  assert.ok(previewImport > generator.indexOf('bpy.ops.export_scene.gltf('), 'Reference car is imported only after room export');
  assert.match(generator, /from sanitize_blend_sources import save_portable/);
  const sourceSave = generator.indexOf('save_portable(source)');
  assert.ok(sourceSave > 0 && sourceSave < generator.indexOf('def export_tier('),
    'Portable source is saved before consolidation and preview-only car import');
  const portableSources = [
    ...assets.map(({ tier }) => `art/garage/tier${tier}.blend`),
    ...['steering-round', 'steering-yoke'].map(name => `art/cosmetics/${name}.blend`),
    ...['body-louver', 'body-splitter', 'rim-copper-left', 'rim-copper-right', 'wheel-turbine-left', 'wheel-turbine-right']
      .map(name => `art/garage-cosmetics/${name}.blend`),
  ];
  for (const path of portableSources) {
    const source = (await readFile(file(path))).toString('latin1');
    assert.doesNotMatch(source, /\/workspace\/(?:scratch|shared)\/|\/home\/agent|\/tmp\//,
      `${path}: editable source contains no machine-specific authoring or default output path`);
  }
  const distinctiveParts = ['Bench vise fixed body', 'Service lift post', 'Acoustic wall fin', 'Hangar gantry column'];
  for (const { tier, blend, report } of assets) {
    const blocks = blendBlocks(blend), objects = blocks.filter(block => block.code === 'OB');
    assert.ok(blocks.some(block => block.code === 'DNA1' && block.data.subarray(0, 4).toString() === 'SDNA'));
    assert.equal(blocks.filter(block => block.code === 'ME').length, report.editable_parts,
      `Tier ${tier}: source preserves individual editable meshes, not only export batches`);
    assert.ok(objects.length > report.editable_parts && report.editable_parts > 400);
    const hasObject = name => objects.some(({ data }) => data.includes(Buffer.from(`OB${name}\0`)));
    assert.ok(hasObject(`GARAGE_TIER_0${tier}`));
    assert.ok(hasObject('Continuous structural slab'));
    assert.ok(hasObject(distinctiveParts[tier - 1]), `Tier ${tier}: distinct authored equipment`);
    for (const name of ['Roadster', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) assert.equal(hasObject(name), false);
    assert.doesNotMatch(blend.toString('utf8'), rejectedBrand);
  }
  assert.equal(new Set(assets.map(({ bytes }) => sha256(bytes))).size, 4, 'Four distinct exports, not one room under four filenames');
});

for (const { tier, scene, json, bytes, report } of assets) {
  test(`garage tier ${tier}: real Blender export, exact counts/bounds, bounded draws and embedded original textures`, () => {
    const root = scene.getObjectByName(`GARAGE_TIER_0${tier}`);
    assert.ok(root); assert.equal(scene.children.length, 1);
    assert.equal(scene.children[0], root);
    assert.equal(root.position.length(), 0); assert.equal(root.quaternion.angleTo(new T.Quaternion()), 0);
    assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
    assert.match(json.asset.generator, /Blender/); assert.equal(json.asset.version, '2.0');
    assert.equal(scene.userData.garage_tier, tier);
    assert.equal(scene.userData.source, 'scripts/create_garage.py');
    assert.equal(report.root, root.name); assert.equal(report.contains_car, false);
    assert.equal(report.runtime_lights, 0);
    assert.equal((json.cameras || []).length, 0);
    assert.equal((json.extensions?.KHR_lights_punctual?.lights || []).length, 0);
    assert.equal((json.animations || []).length, 0); assert.equal((json.skins || []).length, 0);
    for (const node of json.nodes) {
      assert.equal(node.camera, undefined); assert.equal(node.extensions?.KHR_lights_punctual, undefined);
      assert.match(node.name, new RegExp(`^(GARAGE_TIER_0${tier}|Tier${tier}_)`), 'Only authored room batches and their root are exported');
    }
    assert.doesNotMatch(JSON.stringify(json), rejectedBrand);
    assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    let draws = 0, triangles = 0;
    scene.traverse(mesh => {
      assert.equal(Boolean(mesh.isCamera || mesh.isLight || mesh.isSkinnedMesh), false);
      if (!mesh.isMesh) return;
      assert.equal(Array.isArray(mesh.material), false, 'One consolidated batch per material');
      draws++; triangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3;
    });
    assert.equal(draws, report.draw_batches); assert.equal(triangles, report.triangles);
    assert.equal(json.materials.length, draws);
    assert.ok(draws > 10 && draws <= 40); assert.ok(triangles > 20_000 && triangles <= 100_000);
    assert.ok(bytes.length < 5_000_000, 'Single room remains below the checked 5 MB download budget');
    const bounds = new T.Box3().setFromObject(scene, true);
    const measured = { min: bounds.min.toArray(), max: bounds.max.toArray() };
    for (const record of [report, provenance.exports.find(item => item.tier === tier), exportAudit.find(item => item.tier === tier)]) {
      assert.ok(record); assert.equal(record.sha256, sha256(bytes));
      assert.equal(record.bytes ?? record.glb_bytes, bytes.length);
      assert.equal(record.triangles, triangles);
      assert.equal(record.draw_batches ?? record.primitives, draws);
      for (const side of ['min', 'max']) measured[side].forEach((value, axis) => near(value, record.bounds_m[side][axis], `Actual ${side} bound ${axis}`));
    }
    assert.deepEqual(report.clear_car_zone, { x: [-2, 2], z: [-3.6, 3.6], floor_top_y: -.005 });
    assert.equal(json.buffers.length, 1); assert.equal(json.buffers[0].uri, undefined);
    assert.deepEqual(json.images.map(image => image.name).sort(), ['original-concrete-grain', 'original-concrete-roughness', 'original-rose-velocity-mural']);
    const binaryHeader = 20 + bytes.readUInt32LE(12), binaryStart = binaryHeader + 8;
    assert.equal(bytes.readUInt32LE(binaryHeader + 4), 0x004e4942);
    for (const image of json.images) {
      assert.equal(image.uri, undefined); assert.equal(image.mimeType, 'image/png');
      const view = json.bufferViews[image.bufferView], start = binaryStart + (view.byteOffset || 0);
      assert.equal(view.buffer, 0); assert.ok(start + view.byteLength <= bytes.length);
      const png = bytes.subarray(start, start + view.byteLength);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.subarray(12, 16).toString(), 'IHDR');
      for (const offset of [16, 20]) assert.ok(png.readUInt32BE(offset) > 0 && png.readUInt32BE(offset) <= 1024);
    }
    const mural = json.materials.find(material => material.name === 'Original rose velocity mural');
    assert.ok(mural, 'Each tier keeps one original pink wall-paint material');
    assert.equal(mural.alphaMode, 'BLEND', 'Real architectural surface remains visible through spray and chips');
    assert.equal(mural.pbrMetallicRoughness.metallicFactor, 0);
    assert.ok(mural.pbrMetallicRoughness.roughnessFactor > .9, 'Paint pigment, not a glowing screen');
    assert.equal(mural.extras.original_art_source, 'art/garage/mural/rose-velocity.svg');
    assert.equal(mural.extras.collision_role, 'none');
    const muralBatch = scene.getObjectByName(`Tier${tier}_Original_rose_velocity_mural`);
    assert.ok(muralBatch?.isMesh); assert.equal(muralBatch.userData.original_architecture_unchanged, true);
    assert.equal(muralBatch.userData.collision_role, 'none');
    assert.equal(muralBatch.userData.paint_offset_m, .002);
    assert.ok((muralBatch.geometry.index?.count || muralBatch.geometry.attributes.position.count) / 3 < 100,
      'The whole artwork shares a tiny projected decal batch, not decorative mesh clutter');
    for (const name of ['Original mottled concrete', 'Warm architectural concrete']) {
      const material = json.materials.find(material => material.name === name);
      assert.ok(material.pbrMetallicRoughness.baseColorTexture);
      assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture);
    }
  });

  test(`garage tier ${tier}: finite positions, UVs, unit normals, valid indices and noncollapsed triangles`, () => {
    const normal = new T.Vector3(), collapsed = new Map(), ab = new T.Vector3(), ac = new T.Vector3();
    scene.traverse(mesh => {
      assert.ok(mesh.matrixWorld.elements.every(Number.isFinite), `${mesh.name}: finite world transform`);
      if (!mesh.isMesh) return;
      const { position, normal: normals, uv } = mesh.geometry.attributes, index = mesh.geometry.index;
      assert.ok(position.count > 0); assert.equal(position.itemSize, 3);
      assert.equal(normals.count, position.count); assert.equal(normals.itemSize, 3);
      assert.ok(uv); assert.equal(uv.count, position.count);
      for (const attribute of [position, normals, uv]) assert.ok(attribute.array.every(Number.isFinite), `${mesh.name}: finite geometry attributes`);
      for (let i = 0; i < normals.count; i++) near(normal.fromBufferAttribute(normals, i).length(), 1, `${mesh.name}: unit normal`, 2e-4);
      assert.equal((index?.count || position.count) % 3, 0);
      if (index) for (const vertex of index.array) assert.ok(Number.isInteger(vertex) && vertex >= 0 && vertex < position.count);
    });
    visitTriangles(scene, (triangle, mesh) => {
      ab.subVectors(triangle.b, triangle.a); ac.subVectors(triangle.c, triangle.a);
      const longest = Math.max(ab.lengthSq(), ac.lengthSq(), triangle.b.distanceToSquared(triangle.c));
      // Scale-relative numerical collapse, not an absolute cutoff that deletes small modeled details.
      if (ab.cross(ac).lengthSq() <= longest ** 2 * 1e-16) collapsed.set(mesh.name, (collapsed.get(mesh.name) || 0) + 1);
    }, false);
    assert.deepEqual(Object.fromEntries(collapsed), {}, 'Export must not retain repeated-endpoint or numerically collapsed triangles');
  });

  test(`garage tier ${tier}: continuous ground-contact slab and no raised central display platform`, () => {
    const floor = scene.getObjectByName(`Tier${tier}_Original_mottled_concrete`);
    assert.ok(floor?.isMesh);
    const floorBounds = new T.Box3().setFromObject(floor, true);
    near(floorBounds.min.y, -.245, 'Slab bottom'); near(floorBounds.max.y, -.005, 'Slab contact top');
    assert.ok(floorBounds.min.x <= -9.99 && floorBounds.max.x >= 9.99);
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0), 0, 2);
    for (const x of [-7.29, -6.2, -5.11, -1.96, -.96, 0, .96, 1.96, 5.11, 6.2, 7.29]) {
      for (const z of [-3.61, -1.8, 0, 1.8, 2.01, 3.59]) {
        ray.ray.origin.set(x, 1, z);
        const hit = ray.intersectObject(floor, true)[0];
        assert.ok(hit, `Continuous floor under (${x}, ${z})`);
        near(hit.point.y, -.005, 'True slab height');
        assert.ok(hit.face.normal.clone().transformDirection(floor.matrixWorld).y > .999, 'Top face has an upward geometric normal');
        if (Math.abs(x) < 2 && Math.abs(z) < 3.6) {
          const surface = ray.intersectObject(scene, true)[0];
          assert.ok(surface.point.y >= -.00502 && surface.point.y <= .01,
            'Central contacts allow flush millimetre markings/joints, not a raised platform');
        }
      }
    }
    assertClear(scene, [{ name: 'central selected vehicle', box: new T.Box3(new T.Vector3(-2, .03, -3.6), new T.Vector3(2, 2.6, 3.6)) }]);
  });

  test(`garage tier ${tier}: runtime parking positions match the genuinely clear 1/2/3/3 capacity`, () => {
    // Exercise the actual placement method. No WebGL context, fake screenshot, or saved audit verdict is used.
    const owner = { tier, scene: new T.Scene(), makeVehicle: () => new T.Group(), parkedVehicles: [], parkedKey: '' };
    GarageScene.prototype.setParking.call(owner, ['hatch', 'sedan', 'van'].map(id => ({ id })));
    assert.equal(owner.parkedVehicles.length, capacities[tier - 1] - 1);
    const slots = parkingAudit.extra_slots.filter(slot => slot.tier === tier);
    assert.equal(slots.length, owner.parkedVehicles.length);
    const boxes = owner.parkedVehicles.map((car, index) => {
      const slot = slots[index];
      near(car.position.x, slot.x, 'Runtime bay X'); near(car.position.z, slot.z, 'Runtime bay Z');
      near(car.rotation.y, slot.rotationY, 'Runtime bay heading'); near(car.position.y, .006, 'Runtime ground offset');
      assert.equal(slot.maximum_width, 2.18); assert.equal(slot.maximum_length, 5.62); assert.equal(slot.tested_height, 2.6);
      const box = new T.Box3(new T.Vector3(car.position.x - 1.09, .03, car.position.z - 2.81),
        new T.Vector3(car.position.x + 1.09, 2.6, car.position.z + 2.81));
      [box.min.x, box.max.x, box.min.z, box.max.z].forEach((value, axis) => near(value, slot.bounds_xz[axis], 'Documented parking envelope'));
      return { name: slot.id, box };
    });
    assertClear(scene, boxes);
  });
}
