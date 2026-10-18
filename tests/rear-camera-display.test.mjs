import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../public/vendor/three.js';
import { createRearCameraDisplay } from '../src/rear-camera-display.js';

/** Build independent player/template instances with the authored glTF UV contract. */
function fixture() {
  const template = new T.Group();
  const geometry = new T.PlaneGeometry(.18, .09);
  geometry.setAttribute('uv', new T.Float32BufferAttribute([0,0, 1,0, 0,1, 1,1], 2));
  const source = new T.Texture({ width: 512, height: 256 });
  source.flipY = false; source.colorSpace = T.SRGBColorSpace;
  const original = new T.MeshStandardMaterial({ color: 0x030609, map: source });
  original.name = 'RC_Right_Rear_Camera';
  const sourceScreen = new T.Mesh(geometry, original);
  sourceScreen.name = 'detail_right_rear_display'; template.add(sourceScreen);
  const centralMaterial = new T.MeshStandardMaterial({ name: 'RC_Original_Landscape_UI' });
  const central = new T.Mesh(new T.PlaneGeometry(.3,.1875), centralMaterial);
  central.name = 'detail_rc_ui'; template.add(central);
  const player = template.clone(true), other = template.clone(true);
  const screen = player.getObjectByName('detail_right_rear_display');
  const display = createRearCameraDisplay(player);
  return { template, player, other, sourceScreen, screen, geometry, original, source, centralMaterial, display };
}

test('separate screen remains authored until a valid frame and never changes central telemetry screen', () => {
  const { display, screen, original, source, player, other, sourceScreen, geometry, centralMaterial } = fixture();
  assert.equal(display.texture, null); assert.equal(screen.material, original);
  display.setTexture(null); assert.equal(screen.material, original);
  const camera = new T.Texture(); display.setTexture(camera);
  assert.equal(display.texture, camera);
  assert.equal(screen.material.isShaderMaterial, true);
  assert.equal(screen.material.uniforms.rearCamera.value, camera);
  assert.equal(screen.material.name, 'player-live-right-rear-display');
  assert.equal(player.getObjectByName('detail_rc_ui').material, centralMaterial);
  assert.equal(sourceScreen.material, original);
  assert.equal(other.getObjectByName('detail_right_rear_display').material, original);
  assert.equal(original.map, source);
  assert.equal(screen.geometry, geometry);
  assert.equal(screen.geometry.attributes.uv, sourceScreen.geometry.attributes.uv);
  assert.equal(player.children.length, 2, 'No additional geometry or draw in the main scene');
});

test('full-screen UV sampling is upright with exactly one horizontal reversal', () => {
  const { display, screen } = fixture();
  display.setTexture(new T.Texture());
  const { vertexShader, fragmentShader } = screen.material;
  assert.match(vertexShader, /rearCameraUv = uv;/);
  assert.match(fragmentShader, /vec2\(1\.0 - rearCameraUv\.x, 1\.0 - rearCameraUv\.y\)/);
  const uv = screen.geometry.attributes.uv;
  const sample = index => [1-uv.getX(index), 1-uv.getY(index)];
  assert.deepEqual(sample(0), [1,1], 'Screen top-left samples render-target top-right');
  assert.deepEqual(sample(1), [0,1], 'Screen top-right samples render-target top-left');
  assert.deepEqual(sample(2), [1,0], 'Screen bottom-left samples render-target bottom-right');
  assert.deepEqual(sample(3), [0,0], 'Screen bottom-right samples render-target bottom-left');
});

test('scene-linear camera receives exactly one tone-map and output-color conversion', () => {
  const { display, screen } = fixture();
  display.setTexture(new T.Texture());
  const { fragmentShader } = screen.material;
  assert.equal(screen.material.toneMapped, true);
  assert.match(fragmentShader, /gl_FragColor = vec4\(cameraColor, 1\.0\);/);
  assert.equal(fragmentShader.match(/#include <tonemapping_fragment>/g).length, 1);
  assert.equal(fragmentShader.match(/#include <colorspace_fragment>/g).length, 1);
  assert.ok(fragmentShader.indexOf('gl_FragColor =') < fragmentShader.indexOf('#include <tonemapping_fragment>'));
  assert.ok(fragmentShader.indexOf('#include <tonemapping_fragment>') < fragmentShader.indexOf('#include <colorspace_fragment>'));
  assert.doesNotMatch(fragmentShader, /emissive|diffuse|sRGBTransferEOTF|pow\(/);
});

test('live frames and restored targets update uniforms without texture mutation or recompilation', () => {
  const { display, screen, source } = fixture();
  const first = new T.WebGLRenderTarget(512,256), second = new T.WebGLRenderTarget(384,192);
  const firstVersion = first.texture.version, secondVersion = second.texture.version, sourceVersion = source.version;
  display.setTexture(first.texture);
  const material = screen.material, materialVersion = material.version;
  for (let frame = 0; frame < 120; frame++) display.setTexture(first.texture);
  display.setTexture(second.texture);
  assert.equal(screen.material, material); assert.equal(material.version, materialVersion);
  assert.equal(material.uniforms.rearCamera.value, second.texture);
  assert.equal(first.texture.version, firstVersion); assert.equal(second.texture.version, secondVersion);
  assert.equal(first.texture.colorSpace, T.NoColorSpace); assert.equal(second.texture.colorSpace, T.NoColorSpace);
  assert.equal(first.texture.flipY, false); assert.equal(second.texture.flipY, false);
  assert.equal(source.version, sourceVersion); assert.equal(source.flipY, false);
  first.dispose(); second.dispose();
});

test('null on context loss or failure restores art and a later valid frame reuses owned material', () => {
  const { display, screen, original } = fixture();
  const first = new T.Texture(), restored = new T.Texture();
  display.setTexture(first); const material = screen.material;
  display.setTexture(null); display.setTexture(null);
  assert.equal(screen.material, original); assert.equal(display.texture, null);
  assert.equal(material.uniforms.rearCamera.value, null);
  display.setTexture(restored);
  assert.equal(screen.material, material); assert.equal(display.texture, restored);
  display.setTexture({});
  assert.equal(screen.material, original); assert.equal(display.texture, null);
});

test('disposal is idempotent and releases only owned material, never shared assets or borrowed camera', () => {
  const { display, screen, original, source, geometry } = fixture();
  const camera = new T.Texture(); display.setTexture(camera);
  const material = screen.material;
  const counts = { material:0, original:0, source:0, camera:0, geometry:0 };
  for (const [name, resource] of Object.entries({material,original,source,camera,geometry}))
    resource.addEventListener('dispose', () => counts[name]++);
  display.dispose(); display.dispose(); display.setTexture(new T.Texture());
  assert.deepEqual(counts, {material:1,original:0,source:0,camera:0,geometry:0});
  assert.equal(screen.material, original); assert.equal(display.texture, null);
  assert.equal(material.uniforms.rearCamera.value, null);
});

test('cleanup does not overwrite another owner that replaces the screen material', () => {
  const { display, screen } = fixture();
  display.setTexture(new T.Texture());
  const replacement = new T.MeshBasicMaterial(); screen.material = replacement;
  display.setTexture(null); display.dispose();
  assert.equal(screen.material, replacement);
});

test('missing right screen, central tablet alone, material arrays and absent UVs are harmless', () => {
  const { player, screen, original } = fixture();
  const check = candidate => {
    const display = createRearCameraDisplay(candidate);
    assert.equal(display.texture, null);
    assert.doesNotThrow(() => { display.setTexture(new T.Texture()); display.setTexture(null); display.dispose(); display.dispose(); });
  };
  check(null); check(new T.Group());
  player.remove(screen); check(player);
  player.add(screen); screen.material = [original]; check(player);
  screen.material = original; screen.geometry.deleteAttribute('uv'); check(player);
});

test('runtime does not create geometry, read back camera pixels, alter central tablet or render extra passes', () => {
  const source = readFileSync(new URL('../src/rear-camera-display.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /readRenderTargetPixels|readPixels|getImageData|createElement|new T\.(?:Mesh|WebGLRenderTarget)|renderer\.render\s*\(|detail_rc_ui/);
  const tablet = readFileSync(new URL('../src/cockpit-display.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tablet, /setRearCameraTexture|cockpitRearCamera|RIGHT REAR \/ CAMERA/);
});
