import * as T from '../public/vendor/three.js';

const INERT = Object.freeze({ setTexture() {}, dispose() {}, texture: null });
const VERTEX = /* glsl */`
varying vec2 rearCameraUv;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  rearCameraUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FRAGMENT = /* glsl */`
uniform sampler2D rearCamera;
varying vec2 rearCameraUv;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  // The authored glTF screen has top-left UV(0,0); a render target has
  // bottom-left UV(0,0). Reverse X once for the mirror-like view and Y once
  // for an upright image. This does not alter the borrowed texture itself.
  vec3 cameraColor = texture2D(rearCamera, vec2(1.0 - rearCameraUv.x, 1.0 - rearCameraUv.y)).rgb;
  gl_FragColor = vec4(cameraColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Bind the game's rear-camera aid to its separate, authored right-hand screen.
 * Only the player material is replaced; the bezel, mount, UVs, geometry and
 * central instrument tablet remain untouched. The authored dark screen stays
 * visible until a successful camera frame, and returns on failure/context loss.
 * Three r183 writes ordinary render targets in scene-linear RGB without tone
 * mapping. The display applies the main renderer's tone and output conversion
 * exactly once, without lighting/emissive multiplication or a CPU readback.
 * @param {T.Object3D} player - Player instance, never the shared glTF template.
 * @returns {{setTexture:function(T.Texture|null):void,dispose:function():void,texture:T.Texture|null}} Lifecycle for a borrowed camera texture; only the replacement material is owned.
 */
export function createRearCameraDisplay(player) {
  let screen;
  player?.traverse?.(node => {
    if (!screen && node.isMesh && !Array.isArray(node.material)
      && (node.name === 'detail_right_rear_display' || node.material?.name === 'RC_Right_Rear_Camera')) screen = node;
  });
  if (!screen?.material || !screen.geometry?.attributes.uv) return INERT;

  const original = screen.material;
  const camera = { value: null };
  const material = new T.ShaderMaterial({
    name: 'player-live-right-rear-display',
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    uniforms: { rearCamera: camera },
    side: original.side, depthTest: original.depthTest, depthWrite: original.depthWrite,
    polygonOffset: original.polygonOffset, polygonOffsetFactor: original.polygonOffsetFactor,
    polygonOffsetUnits: original.polygonOffsetUnits,
    toneMapped: true,
  });
  let disposed = false;

  return {
    get texture() { return camera.value; },
    /**
     * Show a successfully rendered 2:1, scene-linear texture, or the source art.
     * The caller owns its render target and passes null on loss or failure.
     * New frames and replacement targets update only a sampler, with no uploads
     * or shader recompilation. The texture's transform/color space never changes.
     * @param {T.Texture|null} texture - Borrowed bottom-left-origin render target.
     * @returns {void} Does not allocate geometry or dispose a camera texture.
     */
    setTexture(texture) {
      if (disposed) return;
      const next = texture?.isTexture ? texture : null;
      if (next === camera.value) return;
      camera.value = next;
      if (next) screen.material = material;
      else if (screen.material === material) screen.material = original;
    },
    /** Restore the authored screen once and release only the owned material. */
    dispose() {
      if (disposed) return;
      disposed = true; camera.value = null;
      if (screen.material === material) screen.material = original;
      material.dispose();
    },
  };
}
