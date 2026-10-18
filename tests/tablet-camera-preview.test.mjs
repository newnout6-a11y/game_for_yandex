import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../public/vendor/three.js';
import { createTabletCameraPreview } from '../src/tablet-camera-preview.js';

/** Model the existing live-canvas material without using document or WebGL. */
function fixture() {
  const artwork = new T.CanvasTexture({ width: 1024, height: 640 });
  artwork.flipY = false; artwork.colorSpace = T.SRGBColorSpace;
  const original = new T.MeshStandardMaterial({ map: artwork, emissiveMap: artwork });
  original.name = 'RC_Original_Landscape_UI';
  const template = new T.Group(), sourceScreen = new T.Mesh(new T.PlaneGeometry(.3,.1875), original);
  sourceScreen.name = 'detail_rc_ui'; template.add(sourceScreen);
  const right = new T.Mesh(new T.PlaneGeometry(.18,.09), new T.MeshBasicMaterial());
  right.name = 'detail_right_rear_display'; template.add(right);
  const player = template.clone(true), screen = player.getObjectByName('detail_rc_ui');
  const preview = createTabletCameraPreview(player);
  return { template, sourceScreen, player, screen, original, artwork, preview, rightMaterial: right.material };
}

/** Exercise the compositor against the exact standard shader bundled in game. */
function compile(screen) {
  const shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
  screen.material.onBeforeCompile(shader, {});
  return shader;
}

test('comparison is opt-in and restores the exact live material, geometry and map references', () => {
  const { preview, screen, original, artwork, sourceScreen, player, rightMaterial } = fixture();
  const geometry = screen.geometry, uv = geometry.attributes.uv;
  assert.equal(preview.diagnostics.active, false); assert.equal(screen.material, original);
  preview.setTexture(new T.Texture());
  assert.equal(preview.diagnostics.active, true);
  assert.equal(screen.material.map, artwork); assert.equal(screen.material.emissiveMap, artwork);
  assert.equal(screen.geometry, geometry); assert.equal(screen.geometry.attributes.uv, uv);
  assert.equal(sourceScreen.material, original);
  assert.equal(player.getObjectByName('detail_right_rear_display').material, rightMaterial);
  assert.ok(Math.abs(geometry.parameters.width / geometry.parameters.height - 1.6) < 1e-12);
  assert.equal(player.children.length, 2);
  preview.setTexture(null);
  assert.equal(screen.material, original); assert.equal(preview.diagnostics.active, false);
  assert.equal(original.map, artwork); assert.equal(original.emissiveMap, artwork);
});

test('live telemetry canvas continues to update without copies, mutation or replacement', () => {
  const { preview, screen, original, artwork } = fixture();
  const image = artwork.image, source = artwork.source, version = artwork.version;
  const camera = new T.Texture(), cameraVersion = camera.version;
  preview.setTexture(camera);
  const material = screen.material, materialVersion = material.version;
  for (let frame = 0; frame < 120; frame++) preview.setTexture(camera);
  assert.equal(artwork.version, version); assert.equal(camera.version, cameraVersion);
  assert.equal(artwork.image, image); assert.equal(artwork.source, source);
  artwork.needsUpdate = true;
  assert.equal(material.map.version, version + 1, 'Use the live texture, not a captured still');
  assert.equal(original.map.version, version + 1);
  assert.equal(material.version, materialVersion, 'No per-frame shader recompilation');
  const replacement = new T.Texture(); preview.setTexture(replacement);
  assert.equal(compile(screen).uniforms.tabletPreviewCamera.value, replacement);
  assert.equal(material.version, materialVersion);
});

test('bounded 2:1 inset and label do not cover speed, gear, distance, energy or status', () => {
  const { preview, screen } = fixture();
  preview.setTexture(new T.Texture());
  const shader = compile(screen), diagnostic = preview.diagnostics;
  assert.deepEqual(diagnostic.cameraPixels, [344,260,640,320]);
  assert.equal(diagnostic.cameraPixels[2] / diagnostic.cameraPixels[3], 2);
  assert.equal(diagnostic.label, 'RIGHT REAR / CAMERA');
  const [x,y,w,h] = diagnostic.framePixels;
  for (const [tx,ty,tw,th] of [[28,85,212,121], [28,234,212,40], [28,299,212,68], [344,202,640,39], [664,22,173,29]])
    assert.ok(x+w <= tx || x >= tx+tw || y+h <= ty || y >= ty+th);
  assert.match(shader.fragmentShader, /tabletPreviewInside\(previewCameraUv\)/);
  assert.match(shader.fragmentShader, /tabletPreviewInside\(previewLabelUv\)/);
  const label = shader.uniforms.tabletPreviewLabel.value;
  assert.equal(label.isDataTexture, true); assert.equal(label.colorSpace, T.SRGBColorSpace);
  assert.equal(label.flipY, false); assert.equal(label.generateMipmaps, false);
  assert.ok(label.image.data.some((value, index) => index % 4 === 0 && value === 238), 'The label contains high-contrast lettering');
  diagnostic.cameraPixels[0] = -1000;
  assert.equal(preview.diagnostics.cameraPixels[0], 344, 'Inspection cannot alter the actual inset');
});

test('camera orientation matches separate screen and tone/color conversion occurs only once', () => {
  const { preview, screen } = fixture();
  preview.setTexture(new T.Texture());
  const shader = compile(screen), fragment = shader.fragmentShader;
  assert.equal(shader.vertexShader, T.ShaderLib.standard.vertexShader);
  assert.match(fragment, /vMapUv - tabletPreviewCameraRect\.xy/);
  assert.match(fragment, /vec2\(1\.0 - previewCameraUv\.x, 1\.0 - previewCameraUv\.y\)/);
  assert.ok(fragment.indexOf('outgoingLight = texture2D(tabletPreviewCamera,') < fragment.indexOf('#include <opaque_fragment>'));
  assert.ok(fragment.indexOf('#include <opaque_fragment>') < fragment.indexOf('#include <tonemapping_fragment>'));
  assert.ok(fragment.indexOf('#include <tonemapping_fragment>') < fragment.indexOf('#include <colorspace_fragment>'));
  assert.equal(fragment.match(/#include <tonemapping_fragment>/g).length, 1);
  assert.equal(fragment.match(/#include <colorspace_fragment>/g).length, 1);
  const rect = shader.uniforms.tabletPreviewCameraRect.value;
  const sample = (x,y) => [1-(x/1024-rect.x)/rect.z, 1-(y/640-rect.y)/rect.w];
  assert.deepEqual(sample(344,260), [1,1]); assert.deepEqual(sample(984,260), [0,1]);
  assert.deepEqual(sample(344,580), [1,0]); assert.deepEqual(sample(984,580), [0,0]);
});

test('source shader hooks survive and preview has its own program cache key', () => {
  const { player, screen, original } = fixture();
  let calls = 0, receiver;
  original.onBeforeCompile = function (shader) { calls++; receiver = this; shader.uniforms.originalUniform = {value:42}; };
  const preview = createTabletCameraPreview(player); preview.setTexture(new T.Texture());
  const shader = compile(screen);
  assert.equal(calls, 1); assert.equal(receiver, screen.material);
  assert.equal(shader.uniforms.originalUniform.value, 42);
  assert.notEqual(screen.material.customProgramCacheKey(), original.customProgramCacheKey());
});

test('null and disposal restore exactly and only owned material/label are disposed once', () => {
  const { preview, screen, original, artwork } = fixture();
  const camera = new T.Texture(); preview.setTexture(camera);
  const material = screen.material, shader = compile(screen), label = shader.uniforms.tabletPreviewLabel.value;
  const counts = {material:0,label:0,original:0,artwork:0,camera:0,geometry:0};
  for (const [name, resource] of Object.entries({material,label,original,artwork,camera,geometry:screen.geometry}))
    resource.addEventListener('dispose', () => counts[name]++);
  preview.setTexture(null); assert.equal(screen.material, original);
  preview.setTexture(camera); assert.equal(screen.material, material);
  preview.dispose(); preview.dispose(); preview.setTexture(camera);
  assert.equal(screen.material, original); assert.equal(shader.uniforms.tabletPreviewCamera.value, null);
  assert.deepEqual(counts, {material:1,label:1,original:0,artwork:0,camera:0,geometry:0});
  assert.equal(preview.diagnostics.active, false); assert.equal(preview.diagnostics.reason, 'disposed');
});

test('cleanup respects other material owners and unsupported layouts are inert', () => {
  const { preview, screen, player, artwork } = fixture();
  preview.setTexture(new T.Texture()); const external = new T.MeshBasicMaterial(); screen.material = external;
  preview.dispose(); assert.equal(screen.material, external);
  const check = candidate => {
    const value = createTabletCameraPreview(candidate);
    assert.equal(value.diagnostics.supported, false);
    assert.doesNotThrow(() => { value.setTexture(new T.Texture()); value.setTexture(null); value.dispose(); });
  };
  check(null); check(new T.Group()); check(player);
  screen.material = new T.MeshStandardMaterial({map:artwork});
  artwork.image = {width:640,height:1024}; check(player);
  artwork.image = {width:1024,height:640}; screen.geometry.deleteAttribute('uv'); check(player);
});

test('preview has no CPU source readback, target render, new mesh, video or production dependency', () => {
  const source = readFileSync(new URL('../src/tablet-camera-preview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /readRenderTargetPixels|readPixels|getImageData|drawImage|createElement|VideoTexture|new T\.(?:Mesh\(|WebGLRenderTarget)|renderer\.render\s*\(/);
  const world = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
  assert.doesNotMatch(world, /createTabletCameraPreview|tablet-camera-preview/);
});
