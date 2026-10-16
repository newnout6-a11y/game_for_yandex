import * as T from '../public/vendor/three.js';

export async function loadAssets(onProgress = () => {}) {
  const manager = new T.LoadingManager();
  manager.onProgress = (_, loaded, total) => onProgress(Math.round(loaded / total * 100));
  const draco = new T.DRACOLoader(manager).setDecoderPath(new URL('../public/vendor/draco/', import.meta.url).href);
  const gltf = new T.GLTFLoader(manager).setDRACOLoader(draco);
  const textures = new T.TextureLoader(manager), base = new URL('../public/assets/', import.meta.url).href;
  const texture = (file, color = false) => textures.loadAsync(base + file).then(map => {
    map.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    map.anisotropy = 8; return map;
  });
  try {
    const [car, sky, asphalt, asphaltNormal, asphaltRough, ground, groundNormal, groundRough, grass, grassNormal, ...trees] = await Promise.all([
      gltf.loadAsync(base + 'car.glb'), new T.RGBELoader(manager).loadAsync(base + 'daylight.hdr'),
      texture('asphalt_02_diff.jpg', true), texture('asphalt_02_nor_gl.jpg'), texture('asphalt_02_rough.jpg'),
      texture('grass_path_2_diff.jpg', true), texture('grass_path_2_nor_gl.jpg'), texture('grass_path_2_rough.jpg'),
      texture('grass_diff.jpg', true), texture('grass_nor_gl.jpg'),
      ...[0, 1, 2].map(i => texture('fir-' + i + '.png', true)),
    ]);
    for (const map of [asphalt, asphaltNormal, asphaltRough, ground, groundNormal, groundRough, grass, grassNormal]) map.wrapS = map.wrapT = T.RepeatWrapping;
    sky.mapping = T.EquirectangularReflectionMapping;
    return { car: car.scene.children[0], sky, asphalt, asphaltNormal, asphaltRough, ground, groundNormal, groundRough, grass, grassNormal, trees };
  } finally { draco.dispose(); }
}
