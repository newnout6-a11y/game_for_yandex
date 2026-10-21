import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { assertHistoricalAssetChain } from './helpers/stable-orbit-assets.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const surfaces = {
  wall: { material: 'Warm architectural concrete', tileMetres: .75, meanRoughness: .84 },
  floor: { material: 'Original mottled concrete', tileMetres: 1, meanRoughness: .77 },
};

/** Decode authored RGB/RGBA PNGs and glTF's repacked roughness without relying on a browser. */
function pixels(png) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks = [];
  assert.equal(png[24], 8); assert.ok([2, 6].includes(png[25])); assert.equal(png[28], 0);
  const channels = png[25] === 6 ? 4 : 3;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), kind = png.subarray(offset + 4, offset + 8).toString();
    if (kind === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, out = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? out[i - channels] : 0, b = y ? out[i - stride] : 0, c = y && x >= channels ? out[i - stride - channels] : 0;
      out[i] = (raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255;
    }
  }
  return { width, height, channels, data: out };
}

/** Summarize contrast and local coherence so neither clouds nor white-noise substitutes pass. */
function channelStats(image, channel = 0) {
  const { width, height, channels, data } = image, count = width * height;
  let sum = 0, squares = 0, neighborProducts = 0, min = 255, max = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = data[(y * width + x) * channels + channel];
    sum += value; squares += value * value; min = Math.min(min, value); max = Math.max(max, value);
    neighborProducts += value * data[(y * width + (x + 1) % width) * channels + channel];
  }
  const mean = sum / count, variance = squares / count - mean ** 2;
  const blocks = [];
  for (let by = 0; by < height; by += 64) for (let bx = 0; bx < width; bx += 64) {
    let block = 0;
    for (let y = by; y < by + 64; y++) for (let x = bx; x < bx + 64; x++) block += data[(y * width + x) * channels + channel];
    blocks.push(block / 4096);
  }
  return { mean, min, max, std: Math.sqrt(variance), correlation: (neighborProducts / count - mean ** 2) / variance,
    blockStd: Math.sqrt(blocks.reduce((total, value) => total + (value - mean) ** 2, 0) / blocks.length) };
}

for (const [surface, spec] of Object.entries(surfaces)) test(`${surface}: restrained coherent mineral aggregate has physical PBR maps, not cloudy albedo`, async () => {
  const base = pixels(await read(`public/assets/garage/original-workshop-${surface}-basecolor.png`));
  const rough = pixels(await read(`public/assets/garage/original-workshop-${surface}-roughness.png`));
  const normal = pixels(await read(`public/assets/garage/original-workshop-${surface}-normal.png`));
  for (const image of [base, rough, normal]) assert.deepEqual([image.width, image.height], [512, 512]);
  for (const [channel, expected] of [94.47, 98.49, 100.50].entries()) assert.ok(Math.abs(channelStats(base, channel).mean - expected) < .15, 'Retain the accepted average concrete colour');
  const colour = channelStats(base), roughness = channelStats(rough), normalX = channelStats(normal);
  assert.ok(colour.std > 1.8 && colour.std < 4.8, 'Readable mineral contrast remains restrained');
  assert.ok(colour.max - colour.min < 22, 'No dark/bright wet concrete patches');
  assert.ok(colour.correlation > .75, 'Mineral features are spatially coherent, not salt-and-pepper noise');
  assert.ok(colour.blockStd < .65, 'No dominant 10 cm-to-metre cloudy albedo fields');
  assert.ok(Math.abs(roughness.mean / 255 - spec.meanRoughness) < .01);
  assert.ok(roughness.std > 4 && roughness.std < 12, 'Real matte roughness variation, not baked lighting');
  assert.ok(normalX.std > .8 && normalX.std < 8, 'Shallow real tangent normal relief, not flat or gravel-like');
  for (let i = 0; i < normal.data.length; i += normal.channels) {
    const xyz = [0, 1, 2].map(c => normal.data[i + c] / 127.5 - 1);
    assert.ok(Math.abs(Math.hypot(...xyz) - 1) < .012, 'Normal vectors remain normalized after RGB8 quantization');
    assert.ok(xyz[2] > .98);
  }
});

test('saved workshop sources preserve non-surface materials, mural, lighting and portable packed PBR assets', async () => {
  const audit = JSON.parse(await read('art/garage/workshop-surface-source-audit.json'));
  const mapAudit = JSON.parse(await read('art/garage/workshop-surface-map-audit.json'));
  assert.equal(audit.version, 2); assert.deepEqual(audit.sources.map(row => row.tier), [1, 2, 3, 4]);
  assert.equal(mapAudit.version, 2); assert.deepEqual(mapAudit.rooms.map(row => row.tier), [1, 2, 3, 4]);
  assert.equal(sha(await read('public/assets/garage/original-rose-velocity-mural.png')), '996ac11896fe59aa172ad3c8b1b0a60a1743afa5b0a7d5dcbea6a39ffbb472fd');
  for (const row of audit.sources) {
    assert.equal(row.baseline_non_surface_state_unchanged, true); assert.deepEqual(row.before.preserved, row.after.preserved);
    assert.deepEqual(Object.keys(row.approved_new_materials), ['garage_screen_display']);
    for (const [name, graph] of Object.entries(row.before.non_surface_material_graphs)) assert.equal(row.after.non_surface_material_graphs[name], graph, `Baseline material ${name} remains exact`);
    assert.deepEqual(Object.keys(row.after.non_surface_material_graphs).filter(name => !(name in row.before.non_surface_material_graphs)), ['garage_screen_display']);
    assert.deepEqual(Object.keys(row.after.approved_new_packed_images), ['roadster-screen-poster']);
    const poster = row.after.approved_new_packed_images['roadster-screen-poster'];
    assert.equal(poster.bytes, 20303); assert.deepEqual(poster.dimensions, [640, 360]);
    assert.equal(poster.sha256, '9f37f6324365999516ee6a9ab18951d1c9a6feb91f8921f2fe8335d82e0e8424');
    assert.equal(poster.provenance, 'art/garage/screen/supplied-video-provenance.json');
    assert.match(poster.authorship, /third-party Tesla footage supplied by the user/);
    assert.match(poster.redistribution_license, /^Unverified/);
    assert.equal(sha(await read(poster.file)), poster.sha256);
    for (const [name, imageHash] of Object.entries(row.before.non_surface_packed_image_hashes)) assert.equal(row.after.non_surface_packed_image_hashes[name], imageHash);
    assert.equal(row.after.relative_packed_paths_verified, true); assert.deepEqual(row.after.retired_surface_payloads, []);
    assertHistoricalAssetChain(row.tier, row.after.source_sha256, await read(row.source), 'source');
    for (const [surface, spec] of Object.entries(surfaces)) {
      const contract = row.after.surface_contract[surface];
      assert.equal(contract.material, spec.material); assert.equal(contract.tile_metres, spec.tileMetres);
      for (const role of ['basecolor', 'normal', 'roughness']) assert.equal(contract.images[role].sha256, sha(await read(`public/assets/garage/original-workshop-${surface}-${role}.png`)));
    }
  }
  for (const row of mapAudit.rooms) {
    const bytes = await read(row.file);
    const current = assertHistoricalAssetChain(row.tier, row.after.sha256, bytes, 'glb');
    assert.equal(row.after.bytes, current.before_glb_bytes);
    assert.equal(current.glb_bytes, bytes.length);
    assert.equal(row.total_byte_delta, row.after.bytes - row.before.bytes);
    assert.equal(row.surface_image_byte_delta, row.after.surface_image_bytes - row.before.surface_image_bytes);
    assert.equal(row.non_surface_image_byte_delta, 20303, 'Only the approved user-supplied TV poster adds non-surface image payload');
    assert.equal(row.total_byte_delta, row.non_image_byte_delta + row.surface_image_byte_delta + row.non_surface_image_byte_delta);
    assert.ok(row.surface_image_byte_delta < 0, 'The final surface finish reduces actual embedded image bytes');
  }
});

for (const tier of [1, 2, 3, 4]) test(`tier ${tier}: wall and floor export real physically scaled, mip-filtered PBR within a measured texture budget`, async () => {
  const bytes = await read(`public/assets/garage/tier${tier}.glb`), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength)), binary = bytes.subarray(28 + jsonLength);
  const names = new Set(); let payloadBytes = 0;
  for (const [surface, spec] of Object.entries(surfaces)) {
    const material = json.materials.find(m => m.name === spec.material), pbr = material.pbrMetallicRoughness;
    assert.equal(material.extras.workshop_surface_finish_version, 2);
    assert.equal(material.extras.texture_tile_metres, spec.tileMetres); assert.equal(pbr.metallicFactor, 0);
    for (const [role, info] of [['basecolor', pbr.baseColorTexture], ['normal', material.normalTexture], ['roughness', pbr.metallicRoughnessTexture]]) {
      assert.ok(info, `${surface} ${role} is a real glTF texture`);
      const texture = json.textures[info.index], sampler = json.samplers[texture.sampler], image = json.images[texture.source];
      const name = `original-workshop-${surface}-${role}`;
      assert.equal(image.name, name); assert.ok(!names.has(name)); names.add(name);
      for (const scale of info.extensions.KHR_texture_transform.scale) assert.ok(Math.abs(scale - 2 / spec.tileMetres) < 1e-6);
      assert.equal(sampler.magFilter, 9729); assert.equal(sampler.minFilter, 9987);
      const view = json.bufferViews[image.bufferView], png = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      payloadBytes += view.byteLength;
      const decoded = pixels(png); assert.deepEqual([decoded.width, decoded.height], [512, 512]);
      if (role !== 'roughness') assert.equal(sha(png), sha(await read(`public/assets/garage/${name}.png`)), 'Export retains the original authored image bytes');
      else assert.ok(Math.abs(channelStats(decoded, 1).mean / 255 - spec.meanRoughness) < .01, 'glTF roughness is encoded in the green channel');
    }
  }
  assert.equal(names.size, 6);
  assert.ok(payloadBytes < 1_200_000, 'Six PBR images replace, rather than add to, the former 1.55 MB surface payload');
  assert.ok(!json.images.some(image => /^(original-concrete-(grain|roughness)|original-wall-fine-mineral)$/.test(image.name)), 'No superseded surface textures in the runtime room');
  const source = (await read(`art/garage/tier${tier}.blend`)).toString('latin1');
  assert.ok(source.includes('Physical mineral microrelief'));
  assert.doesNotMatch(source, /\/workspace\/(?:scratch|shared)\/|\/home\/agent|\/tmp\//);
});
