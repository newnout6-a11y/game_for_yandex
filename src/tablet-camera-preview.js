import * as T from '../public/vendor/three.js';

const WIDTH = 1024, HEIGHT = 640;
const CAMERA = [344, 260, 640, 320], FRAME = [320, 244, 670, 370];
const BORDER = [340, 256, 648, 328], LABEL = [344, 586, 640, 28];
const TITLE = 'RIGHT REAR / CAMERA';
// Original 5×7 lettering, generated locally without reading the telemetry canvas.
const GLYPHS = {
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  '/': ['00001','00001','00010','00100','01000','10000','10000'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
};
const DECLARATIONS = /* glsl */`
uniform sampler2D tabletPreviewCamera;
uniform sampler2D tabletPreviewLabel;
uniform vec4 tabletPreviewCameraRect;
uniform vec4 tabletPreviewFrameRect;
uniform vec4 tabletPreviewBorderRect;
uniform vec4 tabletPreviewLabelRect;
uniform vec3 tabletPreviewBackground;
uniform vec3 tabletPreviewBorderColor;
bool tabletPreviewInside(vec2 p) {
  return all(greaterThanEqual(p, vec2(0.0))) && all(lessThanEqual(p, vec2(1.0)));
}`;
const COMPOSITE = /* glsl */`
#ifdef USE_MAP
  vec2 previewFrameUv = (vMapUv - tabletPreviewFrameRect.xy) / tabletPreviewFrameRect.zw;
  if (tabletPreviewInside(previewFrameUv)) outgoingLight = tabletPreviewBackground;
  vec2 previewBorderUv = (vMapUv - tabletPreviewBorderRect.xy) / tabletPreviewBorderRect.zw;
  if (tabletPreviewInside(previewBorderUv)) outgoingLight = tabletPreviewBorderColor;
  vec2 previewCameraUv = (vMapUv - tabletPreviewCameraRect.xy) / tabletPreviewCameraRect.zw;
  if (tabletPreviewInside(previewCameraUv)) {
    // Match the separate right display: one horizontal reversal, plus the
    // glTF top-left to render-target bottom-left vertical conversion.
    outgoingLight = texture2D(tabletPreviewCamera, vec2(1.0 - previewCameraUv.x, 1.0 - previewCameraUv.y)).rgb;
  }
  vec2 previewLabelUv = (vMapUv - tabletPreviewLabelRect.xy) / tabletPreviewLabelRect.zw;
  if (tabletPreviewInside(previewLabelUv)) outgoingLight = texture2D(tabletPreviewLabel, previewLabelUv).rgb;
#endif
`;

/** Produce a small owned label texture; never access or copy source-screen pixels. */
function makeLabel() {
  const width = LABEL[2], height = LABEL[3], pixels = new Uint8Array(width * height * 4);
  for (let p = 0; p < pixels.length; p += 4) pixels.set([10, 16, 22, 255], p);
  for (const [index, letter] of [...TITLE].entries()) {
    const glyph = GLYPHS[letter];
    if (!glyph) continue;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
      if (glyph[y][x] !== '1') continue;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        const p = ((3 + y * 3 + dy) * width + 6 + index * 18 + x * 3 + dx) * 4;
        pixels.set([238, 245, 250, 255], p);
      }
    }
  }
  const label = new T.DataTexture(pixels, width, height, T.RGBAFormat);
  label.name = 'tablet-comparison-right-rear-label';
  label.flipY = false; label.colorSpace = T.SRGBColorSpace;
  label.minFilter = T.LinearFilter; label.magFilter = T.LinearFilter;
  label.generateMipmaps = false; label.needsUpdate = true;
  return label;
}

/** Convert source-artwork pixels to the live map's transformed glTF UV space. */
function rect(pixels) {
  return { value: new T.Vector4(pixels[0] / WIDTH, pixels[1] / HEIGHT, pixels[2] / WIDTH, pixels[3] / HEIGHT) };
}

/** A reversible no-op for models that do not contain the expected mapped tablet. */
function unavailable(reason) {
  return Object.freeze({ setTexture() {}, dispose() {}, diagnostics: Object.freeze({ supported: false, active: false, reason }) });
}

/**
 * Create an opt-in comparison only; never enable it from production defaults.
 * The existing 16:10 tablet geometry and live map/emissive-map references are
 * preserved. A cloned material overlays one labeled rear-camera inset, leaving
 * speed, energy, gear, distance and driving status outside the preview region.
 * Camera input is scene-linear; compositing before the standard opaque/tone/color
 * chunks processes it once. No target render, video, readback or new mesh is used.
 * @param {T.Object3D} player - Instance with its live cockpit display already bound.
 * @returns {{setTexture:function(T.Texture|null):void,dispose:function():void,diagnostics:object}} Reversible comparison lifecycle; camera and artwork are borrowed, never disposed.
 */
export function createTabletCameraPreview(player) {
  let screen;
  player?.traverse?.(node => {
    if (!screen && node.isMesh && node.name === 'detail_rc_ui' && !Array.isArray(node.material)) screen = node;
  });
  if (!screen?.material?.isMeshStandardMaterial || !screen.material.map?.isTexture) return unavailable('missing-mapped-tablet');
  if (!screen.geometry?.attributes.uv) return unavailable('missing-tablet-uvs');
  const image = screen.material.map.image;
  if ((image?.naturalWidth || image?.width) !== WIDTH || (image?.naturalHeight || image?.height) !== HEIGHT)
    return unavailable('unexpected-tablet-layout');

  const original = screen.material, material = original.clone(), label = makeLabel();
  const camera = { value: null }, originalCompile = original.onBeforeCompile;
  const originalProgramKey = original.customProgramCacheKey();
  const uniforms = {
    tabletPreviewCamera: camera, tabletPreviewLabel: { value: label },
    tabletPreviewCameraRect: rect(CAMERA), tabletPreviewFrameRect: rect(FRAME),
    tabletPreviewBorderRect: rect(BORDER), tabletPreviewLabelRect: rect(LABEL),
    tabletPreviewBackground: { value: new T.Color('#0a1016') },
    tabletPreviewBorderColor: { value: new T.Color('#8ca7b6') },
  };
  material.name = 'tablet-camera-comparison-only';
  material.customProgramCacheKey = () => originalProgramKey + '|tablet-camera-comparison-v1';
  material.onBeforeCompile = function (shader, renderer) {
    originalCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DECLARATIONS)
      .replace('#include <opaque_fragment>', COMPOSITE + '#include <opaque_fragment>');
  };
  let disposed = false;

  return {
    /** Show a valid borrowed frame, or restore the exact live-tablet material. */
    setTexture(texture) {
      if (disposed) return;
      const next = texture?.isTexture ? texture : null;
      if (next === camera.value) return;
      camera.value = next;
      if (next) screen.material = material;
      else if (screen.material === material) screen.material = original;
    },
    /** Return detached diagnostics suitable for an A/B preview verification. */
    get diagnostics() {
      return {
        supported: true, active: !disposed && camera.value !== null && screen.material === material,
        reason: disposed ? 'disposed' : camera.value ? 'comparison-preview' : 'inactive',
        label: TITLE, cameraPixels: [...CAMERA], framePixels: [...FRAME],
        artworkTexture: original.map.uuid, usesLiveArtwork: material.map === original.map,
      };
    },
    /** Restore only our own override and release the owned material and label. */
    dispose() {
      if (disposed) return;
      disposed = true; camera.value = null;
      if (screen.material === material) screen.material = original;
      material.dispose(); label.dispose();
    },
  };
}
