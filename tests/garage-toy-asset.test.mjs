import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { GARAGE_TOY_POSITION, GARAGE_TOY_YAW } from '../src/garage-toy-prop.js';
import { GARAGE_PARKING_BAYS } from '../src/garage-scene.js';
import { assertHistoricalAssetChain } from './helpers/stable-orbit-assets.mjs';

const rootURL = new URL('../', import.meta.url);
const candidateURL = process.env.TOY_ASSET_DIR ? pathToFileURL(resolve(process.env.TOY_ASSET_DIR) + '/') : null;
const { scene, json, bytes } = await loadRoadsterGeometry(candidateURL ? new URL('toy-racecar.glb', candidateURL) : new URL('public/assets/garage/toy-racecar.glb', rootURL));
const report = JSON.parse(await readFile(candidateURL ? new URL('asset-report.json', candidateURL) : new URL('art/garage/toy/asset-report.json', rootURL))); 
const roomProof = JSON.parse(await readFile(new URL('../art/garage/toy/placement-audit.json', import.meta.url)));
const box = new T.Box3().setFromObject(scene, true), size = box.getSize(new T.Vector3());
const close = (actual, expected, tolerance = 2e-5) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function eachTriangle(root, visit) {
  root.updateWorldMatrix(true, true);
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < (index?.count || position.count); i += 3) {
      const points = [0, 1, 2].map(n => new T.Vector3().fromBufferAttribute(position, index ? index.getX(i + n) : i + n).applyMatrix4(mesh.matrixWorld));
      visit(points, mesh);
    }
  });
}

function actualTyreContacts() {
  const groups = new Map();
  scene.traverse(mesh => {
    if (!mesh.isMesh || mesh.material.name !== 'Toy tyre rubber') return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      if (v.y > .005) continue;
      const key = `${Math.sign(v.x)}:${Math.sign(v.z)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
  });
  assert.equal(groups.size, 4, 'Four actual tyre contact groups');
  return Array.from(groups.values(), points => {
    const contactBox = new T.Box3().setFromPoints(points), center = contactBox.getCenter(new T.Vector3());
    center.y = contactBox.min.y;
    return center;
  });
}

test('reference-based McQueen toy is a portable Blender mesh with two embedded authored textures, not a photograph plane', async () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256);
  assert.equal(scene.getObjectByName('GARAGE_TOY_MCQUEEN_95')?.userData.asset_kind, 'physical_lightning_mcqueen_toy');
  assert.equal(report.name, 'Lightning McQueen toy (95)');
  assert.equal(json.images?.length, 2); assert.equal(json.textures?.length, 2);
  assert.equal(json.images[0].mimeType, 'image/png');
  assert.equal(json.images[0].uri, undefined, 'Texture is packed inside the GLB');
  assert.match(report.provenance, /Disney\/Pixar/);
  assert.match(report.provenance, /no commercial license/);
  assert.equal(report.source_external_resources, 0);
  assert.equal(json.cameras, undefined); assert.equal(json.animations, undefined);
  assert.equal(json.extensions?.KHR_lights_punctual, undefined);
  const source = await readFile(new URL(report.source, rootURL));
  assert.equal(source.subarray(0, 7).toString(), 'BLENDER');
  assert.equal(createHash('sha256').update(source).digest('hex'), report.source_sha256);
  const script = await readFile(new URL(report.generator, rootURL));
  assert.equal(createHash('sha256').update(script).digest('hex'), report.generator_sha256);
  assert.ok(report.editable_parts > 40, 'Integrated shell, genuine perforated wheels, opaque receiver eyes and conforming prints remain editable');
  for (const name of ['McQueen sculpted U nose and crowned fenders', 'Rounded compact LIGHTYEAR tyre LF', 'Concave red steel rim with ten real oval openings LR', 'Dark sloping rear window']) assert.ok(source.includes(Buffer.from(name)), `Named editable part: ${name}`);
  assert.ok(bytes.length <= 2000000, 'Explicit 2MB independent prop budget; not the former 1.5MB limit');
});

test('both runtime textures are embedded, bounded and independent of the private photo', async () => {
  const data = Buffer.from(bytes); let bin;
  for (let offset = 12; offset < data.length;) {
    const length = data.readUInt32LE(offset), kind = data.readUInt32LE(offset + 4);
    if (kind === 0x004e4942) bin = data.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length;
  }
  assert.ok(bin);
  const pngForImage = image => {
    assert.equal(image.uri, undefined, 'Both runtime images are embedded');
    assert.equal(image.mimeType, 'image/png');
    const view = json.bufferViews[image.bufferView];
    const png = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    return png;
  };
  const dimensions = json.images.map(image => { const png = pngForImage(image); return [png.readUInt32BE(16), png.readUInt32BE(20)]; });
  assert.deepEqual(dimensions.sort((a, b) => a[0] - b[0]), [[512, 256], [1024, 1024]]);
  let allocation = 0;
  for (const [width, height] of dimensions) {
    for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
      allocation += w * h * 4;
      if (w === 1 && h === 1) break;
    }
  }
  assert.equal(allocation, 6291456);
  assert.equal(report.runtime_texture_rgba8_mip_bytes, allocation);
  assert.deepEqual(report.runtime_texture_dimensions, [1024, 1024]);
  const painted = json.materials.find(m => m.name === 'Toy opaque painted windshield');
  assert.ok(painted);
  assert.equal(painted.alphaMode || 'OPAQUE', 'OPAQUE');
  const faceTexture = json.textures[painted.pbrMetallicRoughness.baseColorTexture.index];
  const face = pngForImage(json.images[faceTexture.source]);
  assert.deepEqual([face.readUInt32BE(16), face.readUInt32BE(20)], [512, 256]);
  assert.equal(face[25], 2, 'Windshield runtime texture is opaque RGB, not an alpha plane');
  const atlas = await readFile(new URL('art/garage/toy/mcqueen-decals.png', rootURL));
  assert.equal(atlas.readUInt32BE(16), 2048); assert.equal(atlas.readUInt32BE(20), 2048);
  assert.equal(createHash('sha256').update(atlas).digest('hex'), report.decal_source_sha256);
  const svg = await readFile(new URL('art/garage/toy/mcqueen-decals.svg', rootURL), 'utf8');
  assert.ok(svg.includes('<svg')); assert.equal(/<image\b/i.test(svg), false, 'Editable vectors contain no photograph');
  assert.equal(json.materials.filter(m => m.alphaMode === 'BLEND').length, 1);
});

test('toy scale, material batches, actual triangles and normals obey the mobile prop budget', () => {
  assert.ok(size.z >= 1.1 && size.z <= 1.4);
  assert.ok(size.x >= .62 && size.x <= .74);
  assert.ok(size.y >= .35 && size.y <= .45);
  box.min.toArray().forEach((v, i) => close(v, report.bounds_m.min[i]));
  box.max.toArray().forEach((v, i) => close(v, report.bounds_m.max[i]));
  let triangles = 0, batches = 0;
  eachTriangle(scene, points => {
    triangles++;
    const ab = points[1].clone().sub(points[0]), ac = points[2].clone().sub(points[0]);
    assert.ok(ab.cross(ac).lengthSq() > 1e-20, 'No collapsed triangle');
  });
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    batches++;
    assert.equal(mesh.material.transparent, mesh.material.name === 'Toy McQueen printed decals');
    assert.equal(mesh.material.metalness, 0, 'Opaque painted enamel is not bare metallic substrate');
    const range = { 'Toy racing red': [.15, .20], 'Toy opaque painted windshield': [.15, .20], 'Toy McQueen printed decals': [.18, .23], 'Toy tyre rubber': [.45, .55], 'Toy lamp amber': [.39, .45] }[mesh.material.name] || [.18, .30];
    assert.ok(mesh.material.roughness >= range[0] && mesh.material.roughness <= range[1], `${mesh.material.name} roughness ${mesh.material.roughness}`);
    const positions = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const used = new Set(index ? Array.from(index.array) : Array.from({ length: positions.count }, (_, i) => i));
    assert.equal(used.size, positions.count, 'No unreferenced vertices inflate collision bounds');
    for (let i = 0; i < positions.count; i++) assert.ok(new T.Vector3().fromBufferAttribute(positions, i).toArray().every(Number.isFinite));
    const n = mesh.geometry.attributes.normal;
    assert.ok(n && n.count === mesh.geometry.attributes.position.count);
    for (let i = 0; i < n.count; i++) {
      const vector = new T.Vector3().fromBufferAttribute(n, i);
      assert.ok(vector.toArray().every(Number.isFinite)); close(vector.length(), 1, .001);
    }
  });
  assert.equal(triangles, report.triangles); assert.ok(triangles >= 8000 && triangles <= 42000);
  assert.equal(batches, report.draw_batches); assert.ok(batches <= 8 && json.materials.length <= 8);
  const names = json.materials.map(m => m.name);
  for (const name of ['Toy racing red', 'Toy opaque painted windshield', 'Toy eye white', 'Toy tyre rubber', 'Toy McQueen printed decals']) assert.ok(names.includes(name));
  const red = json.materials.find(m => m.name === 'Toy racing red');
  close(red.extensions.KHR_materials_clearcoat.clearcoatFactor, .65);
  close(red.extensions.KHR_materials_clearcoat.clearcoatRoughnessFactor, .13);
  assert.equal(red.normalTexture, undefined, 'No grain or bump texture on the painted shell');
});

test('four substantial wheel contact patches are present at floor level', () => {
  let tire; scene.traverse(o => { if (o.isMesh && o.material.name === 'Toy tyre rubber') tire = o; });
  assert.ok(tire);
  const patchCounts = new Map();
  const p = tire.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(tire.matrixWorld);
    if (v.y < .005) {
      const key = `${v.x < 0 ? 'left' : 'right'}-${v.z < 0 ? 'front' : 'rear'}`;
      patchCounts.set(key, (patchCounts.get(key) || 0) + 1);
    }
  }
  assert.equal(patchCounts.size, 4);
  for (const count of patchCounts.values()) assert.ok(count >= 2);
});

test('grounded placement clears all four audited rooms, current parked bays and main-car envelope', async () => {
  assert.deepEqual(report.recommended_placement.position, [...GARAGE_TOY_POSITION], 'Asset recommendation matches actual runtime placement');
  assert.equal(report.recommended_placement.rotation_y, GARAGE_TOY_YAW);
  const toy = scene.clone(true);
  toy.position.fromArray(report.recommended_placement.position); toy.rotation.y = report.recommended_placement.rotation_y; toy.updateMatrixWorld(true);
  const world = new T.Box3().setFromObject(toy, true), aboveFloor = world.clone(); aboveFloor.min.y = .03;
  const priorAcceptedEnvelope = new T.Box3(new T.Vector3(-3.50065, -.0048, 4.11935), new T.Vector3(-2.50134, .5748, 5.49151));
  assert.ok(priorAcceptedEnvelope.containsBox(world), 'Revised toy stays within the parent-tested camera/light envelope');
  const car = new T.Box3(new T.Vector3(-2, 0, -3.6), new T.Vector3(2, 2.6, 3.6));
  assert.equal(world.intersectsBox(car), false);
  for (const {x,z} of GARAGE_PARKING_BAYS) {
    const park = new T.Box3(new T.Vector3(x - 1.3, 0, z - 3), new T.Vector3(x + 1.3, 2.6, z + 3));
    assert.equal(world.intersectsBox(park), false);
  }
  for (let tier = 1; tier <= 4; tier++) {
    const room = await loadRoadsterGeometry(new URL(`../public/assets/garage/tier${tier}.glb`, import.meta.url));
    assertHistoricalAssetChain(tier, roomProof.tiers.find(r => r.tier === tier).room_sha256, room.bytes, 'glb');
    room.scene.traverse(o => {
      for (const obstacle of o.userData?.garageCamera?.obstacles || []) {
        assert.equal(world.intersectsBox(new T.Box3(new T.Vector3(...obstacle.min), new T.Vector3(...obstacle.max))), false);
      }
    });
    let conflicts = 0;
    eachTriangle(room.scene, triangle => { if (aboveFloor.intersectsBox(new T.Box3().setFromPoints(triangle))) conflicts++; });
    assert.equal(conflicts, 0, `No tier ${tier} room triangle intrudes into the toy`);
    // Check finite tyre geometry against the actual raised floor gaskets, not just four centers.
    const gasketTriangles = [];
    eachTriangle(room.scene, (triangle, mesh) => {
      // The shared gasket material also appears on 6m-high wall joints. Above-floor
      // geometry is checked separately; only the authored floor-zone triangles belong here.
      if (mesh.material.name === 'Concrete expansion gasket' && triangle.every(v => v.y <= .03)) gasketTriangles.push(triangle);
    });
    assert.ok(gasketTriangles.length > 0, 'Authored expansion gaskets found in this exact room');
    const gasketTop = Math.max(...gasketTriangles.flat().map(v => v.y));
    const lowerTyrePoints = [];
    eachTriangle(toy, (triangle, mesh) => {
      if (mesh.material.name !== 'Toy tyre rubber') return;
      for (let i = 0; i < 3; i++) {
        const a = triangle[i], b = triangle[(i + 1) % 3];
        if (a.y <= gasketTop) lowerTyrePoints.push(a.clone());
        if ((a.y - gasketTop) * (b.y - gasketTop) < 0) lowerTyrePoints.push(a.clone().lerp(b, (gasketTop - a.y) / (b.y - a.y)));
      }
    });
    assert.ok(lowerTyrePoints.length > 100, 'Actual vertices and edge/plane intersections form a finite lower tyre envelope');
    const lowerTyreEnvelope = new T.Box3().setFromPoints(lowerTyrePoints);
    for (const triangle of gasketTriangles) assert.equal(lowerTyreEnvelope.intersectsBox(new T.Box3().setFromPoints(triangle)), false, `Finite tyre footprint clears tier ${tier} floor gasket`);
    for (const localContact of actualTyreContacts()) {
      const point = localContact.clone().applyMatrix4(toy.matrixWorld);
      const hit = new T.Raycaster(new T.Vector3(point.x, .8, point.z), new T.Vector3(0, -1, 0)).intersectObject(room.scene, true)[0];
      assert.ok(hit); close(hit.point.y, -.005);
      assert.ok(point.y - hit.point.y >= -.0001 && point.y - hit.point.y < .003, 'Tyres touch the slab without floating');
    }
  }
});


test('opaque windshield preserves authored expression without the ten intersecting face layers', async () => {
  const art = candidateURL || new URL('art/garage/toy/', rootURL);
  const vectors = JSON.parse(await readFile(new URL('windshield-paint.json', art)));
  const svg = await readFile(new URL('windshield-paint.svg', art), 'utf8');
  assert.equal(/<image\b|<text\b/.test(svg), false, 'Windshield is editable authored vectors, no photograph or font');
  assert.equal(vectors.shapes.length, 10);
  assert.equal(vectors.red_background, '#d60918');
  for (const side of [-1, 1]) {
    const iris = vectors.shapes.find(shape => shape.name === `blue iris ${side}`);
    assert.deepEqual(iris.center, [side * .062, .069]);
    assert.deepEqual(iris.radii, [.0295, .0315]);
  }
  const paint = await readFile(new URL('windshield-paint.png', art));
  assert.deepEqual([paint.readUInt32BE(16), paint.readUInt32BE(20)], [1024, 512]);
  assert.equal(json.materials.some(m => m.name === 'Toy eye blue'), false, 'Separate iris mesh material removed');
  const face = json.materials.find(m => m.name === 'Toy opaque painted windshield');
  assert.equal(face.alphaMode || 'OPAQUE', 'OPAQUE');
  close(face.pbrMetallicRoughness.roughnessFactor, .17);
  close(face.extensions.KHR_materials_clearcoat.clearcoatFactor, .65);
  close(face.extensions.KHR_materials_clearcoat.clearcoatRoughnessFactor, .13);
  assert.equal(face.normalTexture, undefined);
  if (!candidateURL) {
    const parity = JSON.parse(await readFile(new URL('receiver-parity-proof.json', art)));
    assert.equal(parity.runtime_sha256, report.sha256);
    assert.equal(parity.source_sha256, report.source_sha256);
    assert.equal(parity.retained_parts, 49);
    assert.equal(parity.source_geometry_unchanged_for_all_retained_parts, true);
    assert.equal(parity.removed_only_face_overlay_parts.length, 10);
    assert.deepEqual(parity.changed_geometry_parts, []);
    assert.deepEqual(parity.added_geometry_parts, []);
    const proof = JSON.parse(await readFile(new URL('path-string-tail-proof.json', art)));
    assert.equal(proof.source_sha256, report.source_sha256);
    assert.equal(proof.read_only, true);
    assert.equal(proof.checked_fields.filter(f => f.struct === 'Image' && f.active).length, 2);
    assert.equal(proof.checked_fields.filter(f => f.struct === 'ImagePackedFile').length, 2);
    for (const field of proof.checked_fields) assert.equal(field.nonzero_tail_bytes, 0);
  }
});
