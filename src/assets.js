import * as T from '../public/vendor/three.js';
import { TRAFFIC_KINDS } from './traffic-catalog.js';

// PMREM's normal 256px cube budget needs only a 1024×512 panorama. Reuse the
// original visible sky, but don't accidentally quadruple the reflection target
// just because its background texture is 2048px wide.
/**
 * Copy a raw RGBA sky panorama into a bounded reflection input without changing the visible sky.
 * The fresh pixel buffer limits PMREM input width to at most 1024 pixels; dispose the returned
 * texture after PMREM conversion, independently of the original background.
 * @param {T.DataTexture} sky - Equirectangular source with readable RGBA bytes and image dimensions.
 * @returns {T.DataTexture} New linear-filtered panorama preserving source color space and vertical orientation.
 */
export function createSkyReflectionSource(sky) {
  const { data, width, height } = sky.image;
  const step = Math.max(1, Math.ceil(width / 1024));
  const w = Math.ceil(width / step), h = Math.ceil(height / step);
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const src = (Math.min(height - 1, y * step) * width + Math.min(width - 1, x * step)) * 4;
    pixels.set(data.subarray(src, src + 4), (y * w + x) * 4);
  }
  const source = new T.DataTexture(pixels, w, h, T.RGBAFormat);
  source.name = 'daylight-reflection-source'; source.colorSpace = sky.colorSpace;
  source.flipY = sky.flipY; source.mapping = T.EquirectangularReflectionMapping;
  source.magFilter = source.minFilter = T.LinearFilter; source.needsUpdate = true;
  return source;
}

/**
 * Load the player, catalog traffic templates and shared scenery maps concurrently.
 * Loaded model geometry/materials and textures are returned for reuse; repeat wrapping applies
 * only to ground maps. The temporary Draco decoder is disposed on success or failure.
 * @param {function(number): void} [onProgress] - Receives rounded completed-request percentages, not byte progress.
 * @param {Object} [options] - Texture sampling settings.
 * @param {number} [options.anisotropy=4] - Anisotropy already capped to renderer support by the caller.
 * @returns {Promise<Object>} Player scene, traffic scenes keyed by kind, ground maps and three tree maps.
 * @throws {Error} Rejects if any required model or texture cannot be loaded.
 */
export async function loadAssets(onProgress = () => {}, { anisotropy = 4 } = {}) {
  const manager = new T.LoadingManager();
  /**
   * Translate Three.js completed-item counts into a rounded UI progress percentage.
   * @param {string} _ - Completed resource URL, deliberately unused for aggregate progress.
   * @param {number} loaded - Number of resource requests completed so far.
   * @param {number} total - Positive number of requests currently tracked by the manager.
   * @returns {void} Calls the supplied progress observer without retaining resource details.
   */
  manager.onProgress = (_, loaded, total) => onProgress(Math.round(loaded / total * 100));
  const draco = new T.DRACOLoader(manager).setDecoderPath(new URL('../public/vendor/draco/', import.meta.url).href);
  const gltf = new T.GLTFLoader(manager).setDRACOLoader(draco);
  const textures = new T.TextureLoader(manager), base = new URL('../public/assets/', import.meta.url).href;
  /**
   * Load one asset texture and establish its color interpretation and mip sampling.
   * @param {string} file - Filename relative to the public asset directory.
   * @param {boolean} [color=false] - Whether texels represent sRGB color rather than linear data.
   * @returns {Promise<T.Texture>} Newly loaded texture using the enclosing anisotropy setting.
   */
  const texture = (file, color = false) => textures.loadAsync(base + file).then(map => {
    map.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    map.anisotropy = anisotropy;
    map.generateMipmaps = true; map.minFilter = T.LinearMipmapLinearFilter; map.magFilter = T.LinearFilter;
    return map;
  });
  try {
    const [car, trafficEntries, asphalt, asphaltNormal, ground, grass, ...trees] = await Promise.all([
      gltf.loadAsync(base + 'roadster.glb'),
      Promise.all(TRAFFIC_KINDS.map(async kind => [kind, (await gltf.loadAsync(base + 'traffic/' + kind + '.glb')).scene])),
      texture('asphalt_02_diff.jpg', true), texture('asphalt_02_nor_gl.jpg'),
      texture('grass_path_2_diff.jpg', true),
      texture('grass_diff.jpg', true),
      ...[0, 1, 2].map(i => texture('fir-' + i + '.png', true)),
    ]);
    for (const map of [asphalt, asphaltNormal, ground, grass]) map.wrapS = map.wrapT = T.RepeatWrapping;
    return { car: car.scene, traffic: Object.fromEntries(trafficEntries), asphalt, asphaltNormal, ground, grass, trees };
  } finally { draco.dispose(); }
}
