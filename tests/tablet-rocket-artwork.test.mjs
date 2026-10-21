import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import * as T from '../public/vendor/three.js';
import { createCockpitDisplay } from '../src/cockpit-display.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

// Independently measured from the accepted full-size-mirror publication before
// the tablet edit, not copied from the new renderer's self-verification report.
// Keep these portable: the published project must not need a sibling backup.
const BASELINE = {
  glb: '615d379ccb873755881b9701e7117b4b27f8269253e12e10c691b66555643616',
  blend: 'ea4f57c7212f115022135d6ee99f7fca7cca04e3065aca104ba6092e2926efe9',
  normalizedJson: '72f5c8878e7a13d3831def9cdb105ef5151c88715a4facceb22975a23e9a6b7b',
  immutableFingerprint: 'db66bbe0f2405184c4f56ad5b7ccd402f643057149fbbc192fe43bc43b10fc84',
  geometryBytes: 'ca3548bf2b9323a355b1239d22b5e5178d4531b8cec8556b2e1723d057afee3c',
  nonUiBytes: 'f5100a16203c1619f3022e76c4c99c88d482cd8d3d48f8a317e9399ee9d253f0',
  oldUi: '8ceebc33e6861a27f28b338b9d4352c708ed401e7aa5961a37528b332d6f29a1',
  outsideArtwork: '33e58b2e314c2bfeaf985d0f03483558c81c8ab13778949fab9165263a6a8701',
};
const ARTWORK = [300, 247, 680, 201];
const DESCRIPTION = 'Offline Blender render of this authored Rocket in parked/stowed pose; live game instruments remain separate; no factory UI claim.';
// The old diagram's 3px roof stroke overshot its y=247 vertices by two
// rows (46 pixels at y=245..246). Remove those obsolete car pixels too.
const OLD_ARTWORK_BOUNDS = [300, 245, 680, 203];
const READOUTS = {
  speed: { rect: [28, 85, 212, 121], hash: '2bd873d3047a10f5a9a7a79e7b5400e902402ecf8867f415b6f79aaeff037f0d' },
  gear: { rect: [28, 234, 212, 40], hash: 'b5a80efd02c9184cf43d36310c932c9ca2b5801422e652067638e80b56e62aea' },
  distance: { rect: [28, 299, 212, 68], hash: '8dae9fc5f354027f3e5c3fe953c9d4a415cfe2869f212e929441b15bc63b4bb8' },
  status: { rect: [344, 202, 640, 39], hash: 'a8f666d987086ff9d3091fd9258c71d3b135a507eccbe967e7f5b174d28017fe' },
  energy: { rect: [664, 22, 173, 29], hash: '9432c23df384832395825a53830b8ee24b62be42c8cab1898e182adb775fdf24' },
};
const OTHER_IMAGES = {
  'roadster-cabin-carbon-normal': 'c2b9f823609fbcde38bac7927c29c3ef0f5de2a6c0fcedbbada949a66d7a80fa',
  'roadster-cabin-carbon-twill': '94950ba18fe95126925d3cb0eb01b1bc4dac8ece01cc32bb64d3ef4bd731bd9a',
  'roadster-cabin-door-ambient-glow': '34148f5a0de84c757dd8ad29df324f0516a314e8cc9a0e8ec4c3fbe40898f6f2',
  'roadster-cabin-door-ambient-diffuse': '57641273b9e4bab4499a53fe78a44713640d1466143cc98a42920347405a073a',
  'roadster-cabin-ivory-grain': '34ffba06726209d1c6a5be17ba2705641710d5cca20762a6612129f22fd1fb08',
  'roadster-cabin-ivory-perforated': '9979ea4301493c31c4b8772be098c3674a8de490af5705523cfcf0bdb38972af',
  'roadster-cabin-suede-nap': '287502644a45c14c2d980a700e782de16da8c6431eed4674c9f6dffcfe4226ef',
};
/** SHA256 of the exact supplied bytes, never a filename or a self-reported hash. */
const hash = value => createHash('sha256').update(value).digest('hex');
/** Read a project file independently of the process working directory. */
const file = relative => readFile(new URL('../' + relative, import.meta.url));

/** Read exact GLB chunks and enforce every embedded view's declared bounds. */
function glb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
  const json = JSON.parse(bytes.subarray(20, binHeader));
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942);
  const binary = bytes.subarray(binHeader + 8);
  assert.equal(bytes.readUInt32LE(binHeader), binary.length);
  assert.equal(json.buffers.length, 1);
  assert.ok(binary.length >= json.buffers[0].byteLength && binary.length - json.buffers[0].byteLength < 4);
  for (const view of json.bufferViews) {
    assert.equal(view.buffer, 0);
    assert.ok((view.byteOffset || 0) + view.byteLength <= json.buffers[0].byteLength);
  }
  const viewBytes = index => {
    const view = json.bufferViews[index], offset = view.byteOffset || 0;
    return binary.subarray(offset, offset + view.byteLength);
  };
  return { json, binary, viewBytes };
}

/** Decode ordinary 8-bit noninterlaced PNGs using only Node's built-in zlib. */
function png(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [], compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    assert.ok(end <= bytes.length, 'PNG chunk cannot extend beyond the file');
    const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
    chunks.push({ type, data });
    if (type === 'IDAT') compressed.push(data);
    offset = end;
    if (type === 'IEND') { assert.equal(offset, bytes.length); break; }
  }
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks.at(-1).type, 'IEND');
  const header = chunks[0].data, width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  assert.equal(header[8], 8, 'inspect the actual published 8-bit pixels');
  assert.ok([2, 6].includes(header[9]), 'expected RGB or RGBA PNG');
  assert.deepEqual([...header.subarray(10, 13)], [0, 0, 0], 'standard compression, filtering and no interlacing');
  const channels = header[9] === 6 ? 4 : 3, stride = width * channels;
  const filtered = inflateSync(Buffer.concat(compressed)), raw = Buffer.alloc(width * height * channels);
  assert.equal(filtered.length, (stride + 1) * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x, a = x >= channels ? raw[offset - channels] : 0;
      const b = y ? raw[offset - stride] : 0, c = y && x >= channels ? raw[offset - stride - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      raw[offset] = (filtered[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) raw.copy(rgba, i * 4, i * channels, i * channels + channels);
  return { width, height, channels, rgba };
}

/** Stable top-down RGBA crop; golden values were independently decoded in Pillow. */
function crop(image, [x, y, width, height]) {
  assert.ok(x >= 0 && y >= 0 && x + width <= image.width && y + height <= image.height);
  return Buffer.concat(Array.from({ length: height }, (_, row) => {
    const start = ((y + row) * image.width + x) * 4;
    return image.rgba.subarray(start, start + width * 4);
  }));
}

test('historical tablet-only geometry anchors remain intact through the separately audited wing revision', async () => {
  const { json, viewBytes } = glb(await file('public/assets/roadster.glb'));
  const revision = JSON.parse(await file('art/roadster-wing-preservation.json'));
  const metadataBytes = await file('art/textures/roadster-tablet-rocket.json');
  const metadata = JSON.parse(metadataBytes);
  assert.equal(json.nodes.length, 99); assert.equal(json.meshes.length, 69); assert.equal(json.materials.length, 31);
  const ui = json.images.find(image => image.name === 'roadster-cabin-original-ui');
  assert.equal(ui.bufferView, 82);
  const root = json.nodes.find(node => node.name === 'Roadster');
  assert.equal(root.extras.driverDisplay.ui_artwork, DESCRIPTION);
  // The tablet-only edit preserved the original model. A later intentional wing
  // revision must not pretend to satisfy that historical whole-geometry hash.
  // Keep the old anchors, chain its exact output into a separate preservation
  // proof, and verify the current bytes against that revision. The companion
  // roadster-preservation suite independently checks all 69 runtime batches,
  // every attribute/index, all nodes/materials, and the exact editable source.
  assert.equal(hash(metadataBytes), revision.provenance.historicalTabletMetadataSha256);
  assert.equal(revision.historicalTabletAnchors.normalizedJsonSha256, BASELINE.normalizedJson);
  assert.equal(revision.historicalTabletAnchors.geometryBytesSha256, BASELINE.geometryBytes);
  assert.equal(revision.historicalTabletAnchors.nonUiBytesSha256, BASELINE.nonUiBytes);
  assert.equal(revision.historicalTabletAnchors.immutableFingerprintSha256, BASELINE.immutableFingerprint);
  assert.equal(revision.historicalTabletAnchors.sourceBlendSha256, BASELINE.blend);
  assert.equal(revision.historicalTabletAnchors.sourceGlbSha256, BASELINE.glb);
  assert.equal(metadata.output.glbSha256, revision.baseline.glbSha256);
  assert.equal(metadata.output.blendSha256, revision.baseline.blendSha256);
  assert.equal(hash(await file('public/assets/roadster.glb')), revision.current.glbSha256);
  assert.equal(hash(await file('art/roadster.blend')), revision.current.blendSha256);
  assert.notEqual(revision.current.glbSha256, revision.baseline.glbSha256);
  assert.equal(revision.current.uiSha256, metadata.output.uiSha256, 'Wing correction must not repaint the accepted tablet');
  for (const [name, expected] of Object.entries(OTHER_IMAGES)) {
    const image = json.images.find(image => image.name === name);
    assert.ok(image, name); assert.equal(hash(viewBytes(image.bufferView)), expected, name + ' must remain byte-for-byte unchanged');
  }
});

test('actual tablet base and emissive material use the exact newly composed source PNG', async () => {
  const { json, viewBytes } = glb(await file('public/assets/roadster.glb'));
  const source = await file('art/textures/roadster-cabin-original-ui.png');
  const material = json.materials.find(item => item.name === 'RC_Original_Landscape_UI');
  const base = json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source;
  const emissive = json.textures[material.emissiveTexture.index].source;
  assert.equal(base, emissive, 'No stale generic drawing may remain in the emissive map');
  assert.equal(json.images[base].name, 'roadster-cabin-original-ui');
  assert.deepEqual(viewBytes(json.images[base].bufferView), source, 'The shipped GLB must contain this source PNG, not an unused new illustration');
  assert.notEqual(hash(source), BASELINE.oldUi, 'The old handmade car illustration is not a valid result');
  const decoded = png(source); assert.deepEqual([decoded.width, decoded.height], [1024, 640]);
});

test('new artwork leaves every other authored UI pixel and live instrument region unchanged', async () => {
  const image = png(await file('art/textures/roadster-cabin-original-ui.png'));
  const [x, y, width, height] = OLD_ARTWORK_BOUNDS;
  const outside = Buffer.concat([
    crop(image, [0, 0, image.width, y]), crop(image, [0, y, x, height]),
    crop(image, [x + width, y, image.width - x - width, height]),
    crop(image, [0, y + height, image.width, image.height - y - height]),
  ]);
  assert.equal(hash(outside), BASELINE.outsideArtwork, 'Headers, dividers, tabs and climate controls must not change');
  for (const [name, { rect, hash: expected }] of Object.entries(READOUTS))
    assert.equal(hash(crop(image, rect)), expected, name + ' retains its accepted pixels');
  for (let y = OLD_ARTWORK_BOUNDS[1]; y < ARTWORK[1]; y++) for (let x = ARTWORK[0]; x < ARTWORK[0] + ARTWORK[2]; x++)
    assert.deepEqual(crop(image, [x, y, 1, 1]), crop(image, [10, y, 1, 1]), 'No old roof-stroke fragment may remain above the new render');
});

test('the rendered Rocket source has transparent margins, useful detail and recorded original-model provenance', async () => {
  const bytes = await file('art/textures/roadster-tablet-rocket.png'), image = png(bytes);
  const metadata = JSON.parse(await file('art/textures/roadster-tablet-rocket.json'));
  assert.equal(metadata.schemaVersion, 1);
  // This metadata describes the accepted historical render, not a rerender of
  // the later corrected wing. Its source anchors and outputs remain immutable.
  assert.equal(metadata.geometryFingerprintSha256, BASELINE.immutableFingerprint);
  assert.equal(metadata.sourceBlendSha256, BASELINE.blend);
  assert.equal(metadata.sourceGlbSha256, BASELINE.glb);
  for (const field of ['inputBlendSha256', 'inputGlbSha256', 'renderInputBlendSha256', 'renderInputGlbSha256'])
    assert.match(metadata[field], /^[a-f0-9]{64}$/, field + ' records real input bytes separately from source anchors');
  assert.equal(metadata.image.sha256, hash(bytes));
  assert.deepEqual([metadata.image.width, metadata.image.height], [image.width, image.height]);
  assert.deepEqual(metadata.composition.region, ARTWORK);
  assert.deepEqual(metadata.composition.clearRegion, OLD_ARTWORK_BOUNDS);
  assert.equal(metadata.render.filmTransparent, true);
  assert.equal(metadata.render.camera.projection, 'orthographic');
  assert.match(metadata.render.pose, /stow|deployment=0/i);
  assert.match(metadata.purpose, /static/i, 'This is a static parked/stowed illustration, not a claim of live 3D state');
  assert.deepEqual([image.width, image.height, image.channels], [680, 201, 4]);
  let transparent = 0, solid = 0, antialiased = 0;
  const colors = new Set(), bounds = [image.width, image.height, -1, -1];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4, alpha = image.rgba[offset + 3];
    if (alpha === 0) transparent++;
    else {
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
      if (alpha === 255) solid++; else antialiased++;
      if (alpha > 200) colors.add(image.rgba.readUIntBE(offset, 3));
    }
    if (!x || !y || x === image.width - 1 || y === image.height - 1)
      assert.equal(alpha, 0, 'Clear alpha at all outer edges prevents a cropped car or opaque background rectangle');
  }
  const pixels = image.width * image.height;
  assert.ok(transparent > pixels * .12 && transparent < pixels * .8, 'Real cutout with visible breathing room, not an empty PNG');
  assert.ok(solid > pixels * .15 && antialiased > 100, 'Opaque body and antialiased silhouette must both exist');
  assert.ok(bounds[2] - bounds[0] > image.width * .65 && bounds[3] - bounds[1] > image.height * .65, 'Use the available illustration area');
  assert.ok(colors.size > 1000, 'Preserve shaded model detail rather than a flat replacement pictogram');
  assert.equal(metadata.output.uiSha256, hash(await file('art/textures/roadster-cabin-original-ui.png')));
  const revision = JSON.parse(await file('art/roadster-wing-preservation.json'));
  assert.equal(metadata.output.glbSha256, revision.baseline.glbSha256);
  assert.equal(metadata.output.blendSha256, revision.baseline.blendSha256);
  assert.equal(revision.current.glbSha256, hash(await file('public/assets/roadster.glb')));
  assert.equal(revision.current.blendSha256, hash(await file('art/roadster.blend')));
});

test('every car-panel pixel comes from the actual RGBA model render, not a handmade fallback', async () => {
  const render = png(await file('art/textures/roadster-tablet-rocket.png'));
  const ui = png(await file('art/textures/roadster-cabin-original-ui.png'));
  const [left, top, width, height] = ARTWORK;
  assert.deepEqual([render.width, render.height], [width, height]);
  const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const srgb = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
  let largestError = 0, incorrect = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (y * width + x) * 4, destination = ((top + y) * ui.width + left + x) * 4;
    const background = ((top + y) * ui.width + 10) * 4, alpha = render.rgba[source + 3] / 255;
    assert.equal(ui.rgba[destination + 3], 255);
    for (let channel = 0; channel < 3; channel++) {
      const foreground = linear(render.rgba[source + channel] / 255), behind = linear(ui.rgba[background + channel] / 255);
      const expected = Math.round(srgb(foreground * alpha + behind * (1 - alpha)) * 255);
      const error = Math.abs(ui.rgba[destination + channel] - expected);
      largestError = Math.max(largestError, error); if (error > 1) incorrect++;
    }
  }
  assert.equal(incorrect, 0, 'The shipped car panel must be the rendered PNG alpha-over its untouched row gradient; maximum sRGB error: ' + largestError);
});

test('live speed, energy and distance still update on the new base artwork without repainting its car', async t => {
  const { scene } = await loadRoadsterGeometry(), screen = scene.getObjectByName('detail_rc_ui');
  const decoded = png(await file('art/textures/roadster-cabin-original-ui.png'));
  const image = { width: decoded.width, height: decoded.height, data: decoded.rgba };
  const original = screen.material.clone(), map = new T.Texture(image);
  original.map = map; original.emissiveMap = map; screen.material = original;
  const calls = [], descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = {
    drawImage(...args) { calls.push({ kind: 'image', args }); },
    fillText(...args) { calls.push({ kind: 'text', args }); },
  };
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas'); return { width: 0, height: 0, getContext(kind) { assert.equal(kind, '2d'); return context; } };
  } };
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
    map.dispose(); original.dispose();
  });
  const display = createCockpitDisplay(scene); t.after(() => display.dispose());
  assert.deepEqual(calls, [{ kind: 'image', args: [image, 0, 0, 1024, 640] }]);
  display.update({ phase: 'playing', speed: 25, distance: 1234, nitro: 67, altitude: 0 }, 0);
  assert.deepEqual(display.telemetry, { speed: '90', gear: 'D', status: 'DRIVING', distance: '1.23 KM', energy: '67%' });
  const restored = calls.filter(call => call.kind === 'image' && call.args.length === 9).map(call => call.args.slice(5));
  assert.deepEqual(restored, Object.values(READOUTS).map(item => item.rect));
  for (const [x, y, width, height] of restored)
    assert.ok(x + width <= ARTWORK[0] || x >= ARTWORK[0] + ARTWORK[2] || y + height <= ARTWORK[1] || y >= ARTWORK[1] + ARTWORK[3],
      'No live readout clear may overlap the static parked-wing model illustration');
  display.update({ phase: 'playing', speed: 30, distance: 2345, nitro: 42, altitude: 0 }, .1);
  assert.deepEqual(display.telemetry, { speed: '108', gear: 'D', status: 'DRIVING', distance: '2.35 KM', energy: '42%' });
  assert.equal(screen.material.map, display.texture); assert.equal(screen.material.emissiveMap, display.texture);
});
