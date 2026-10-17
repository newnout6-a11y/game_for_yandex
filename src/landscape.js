import * as T from '../public/vendor/three.js';
import { seededRandom } from './util.js';

// Original, deterministic scenery. The scenery is expressed in road-local space;
// the same bend function as the road is applied only at the final transform.
const PERIOD = 800;
const TAU = Math.PI * 2;
/**
 * Constrain a scenery weight or coordinate to an inclusive interval.
 * @param {number} x - Value to constrain.
 * @param {number} [a=0] - Lower bound.
 * @param {number} [b=1] - Upper bound.
 * @returns {number} Bounded scalar; inputs are expected to be finite.
 */
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
/**
 * Ease a scalar between two thresholds with zero slope at both ends.
 * @param {number} a - Lower threshold, distinct from b.
 * @param {number} b - Upper threshold.
 * @param {number} x - Sample in the same units as the thresholds.
 * @returns {number} Cubic smoothstep weight in [0,1].
 */
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/**
 * Recycle a fixed scenery seed into the 800-metre visible longitudinal interval.
 * @param {number} z - Seed Z in unbent road-local metres.
 * @param {number} distance - Accumulated player travel in metres.
 * @returns {number} Scene Z in [-720,80), including correct wrapping for negative inputs.
 */
const wrap = (z, distance) => ((z + distance + 720) % PERIOD + PERIOD) % PERIOD - 720;
const PALETTES = {
  ring: { land: '#b6ba88', grass: '#7d8f47', leaves: '#668153', water: '#368d9b', fog: '#b8d1d5', density: .77 },
  neon: { land: '#8fa684', grass: '#627c42', leaves: '#496d4d', water: '#477e85', fog: '#b2cdd1', density: 1 },
  dawn: { land: '#c4b78c', grass: '#aa9756', leaves: '#b2944a', water: '#3a9ba4', fog: '#c9d8d8', density: .37 },
};

/**
 * Sample the periodic hillside, near lake bank and far shore before road bending.
 * The height repeats every 800 metres, so recycled scenery keeps its cached elevation.
 * @param {number} x - Lateral road-local offset in metres; negative is the forested slope.
 * @param {number} z - Unrecycled world Z in metres, not the displayed scrolling coordinate.
 * @returns {number} Terrain elevation in metres relative to the road's Y=0 plane.
 */
export function scenicTerrainHeight(x, z) {
  const edge = Math.max(0, Math.abs(x) - 8.2);
  const phase = z / PERIOD * TAU;
  const rolling = Math.sin(phase * 2 + Math.abs(x) * .034) * 2.2
    + Math.sin(phase * 3 - Math.abs(x) * .019) * 1.7;
  if (x < 0) {
    const rise = smooth(2, 74, edge) * (9 + rolling)
      + smooth(68, 360, edge) * (28 + Math.sin(phase + x * .013) * 15);
    return -.12 + rise + smooth(1, 26, edge) * rolling * .34;
  }
  // The road sits above the lake: open views on the right, forested slope left.
  const bank = -8.8 * smooth(5, 38, edge);
  const farShore = smooth(214, 310, edge) * (19 + rolling * 1.5);
  return -.12 + bank + farShore + smooth(0, 20, edge) * rolling * .32;
}

// The height function is a sum of three periodic harmonics. Factor all x-only
// terms once so moving terrain needs six trig evaluations for the entire frame,
// not thousands of height calls. Coefficients are [base, sin1, cos1, ...].
/**
 * Factor the terrain height harmonics at one lateral coordinate for reuse across rows.
 * @param {number} x - Unbent lateral position in metres.
 * @returns {Float64Array} New [base,sin1,cos1,sin2,cos2,sin3,cos3] metre coefficients;
 *  the harmonic phase is z / PERIOD * TAU, avoiding repeated height/trigonometry calls per vertex.
 */
function terrainCoefficients(x) {
  const edge = Math.max(0, Math.abs(x) - 8.2), c = new Float64Array(7);
  let rolling;
  if (x < 0) {
    const rise = smooth(2, 74, edge), far = smooth(68, 360, edge);
    c[0] = -.12 + rise * 9 + far * 28;
    c[1] = far * 15 * Math.cos(x * .013); c[2] = far * 15 * Math.sin(x * .013);
    rolling = rise + smooth(1, 26, edge) * .34;
  } else {
    const far = smooth(214, 310, edge);
    c[0] = -.12 - 8.8 * smooth(5, 38, edge) + far * 19;
    rolling = far * 1.5 + smooth(0, 20, edge) * .32;
  }
  c[3] = rolling * 2.2 * Math.cos(Math.abs(x) * .034);
  c[4] = rolling * 2.2 * Math.sin(Math.abs(x) * .034);
  c[5] = rolling * 1.7 * Math.cos(-Math.abs(x) * .019);
  c[6] = rolling * 1.7 * Math.sin(-Math.abs(x) * .019);
  return c;
}

/**
 * Wrap shared geometry/material references in a named mesh without attaching it.
 * @param {T.BufferGeometry} geometry - Geometry retained by reference.
 * @param {T.Material} material - Material retained by reference.
 * @param {string} name - Diagnostic scene-object name.
 * @returns {T.Mesh} New mesh; caller chooses ownership, transforms and scene membership.
 */
function mesh(geometry, material, name) {
  const result = new T.Mesh(geometry, material);
  result.name = name;
  return result;
}

/**
 * Combine already-transformed primitives into one nonindexed vertex-colored geometry.
 * Consumes and disposes every input geometry and conversion temporary; no materials are
 * created, and only positions/normals plus the supplied per-part colors are preserved.
 * @param {Object[]} parts - Records with geometry in local metres and a Three.js-compatible color.
 * @returns {T.BufferGeometry} New merged geometry with computed bounds and RGB vertex colors.
 */
function coloredGeometry(parts) {
  const positions = [], normals = [], colors = [];
  const color = new T.Color();
  for (const part of parts) {
    const geo = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position, n = geo.attributes.normal;
    color.set(part.color);
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    if (geo !== part.geometry) geo.dispose();
    part.geometry.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Prepare a translated colored box for the consuming geometry merger.
 * @param {number} w - X width in metres.
 * @param {number} h - Y height in metres.
 * @param {number} d - Z depth in metres.
 * @param {number} x - Local center X in metres.
 * @param {number} y - Local center Y in metres.
 * @param {number} z - Local center Z in metres.
 * @param {T.ColorRepresentation} color - Color to bake when merging.
 * @returns {{geometry: T.BoxGeometry, color: *}} Owned geometry plus an unmodified color value.
 */
function box(w, h, d, x, y, z, color) {
  const geometry = new T.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return { geometry, color };
}

/**
 * Create both nonuniform terrain banks and precompute their harmonic update caches.
 * Allocates roughly 2,700 vertices once, with denser sampling near the road; position and
 * normal attributes are dynamic, while coefficients and local coordinates remain reusable.
 * @param {T.Scene} scene - Scene receiving both ground meshes.
 * @param {Object} assets - Shared grass texture used without cloning.
 * @returns {Object} Terrain entries, shared material and typed-array phase/bend/slope caches.
 */
function makeTerrain(scene, assets) {
  const material = new T.MeshStandardMaterial({
    color: PALETTES.ring.land, map: assets.grass, roughness: 1, vertexColors: true,
  });
  const terrain = [];
  // More samples beside the road, fewer in the distance. About 2,700 vertices.
  const offsets = [8.2, 10, 13, 17, 22, 29, 39, 54, 75, 105, 145, 195, 250, 320, 410, 525, 680];
  for (const side of [-1, 1]) {
    const positions = [], uvs = [], colors = [], indices = [], local = [];
    const rows = 80, cols = offsets.length;
    for (let row = 0; row <= rows; row++) {
      const z = 80 - row * 10;
      for (let col = 0; col < cols; col++) {
        const x = side * offsets[col];
        positions.push(x, scenicTerrainHeight(x, z), z);
        local.push(x, z);
        uvs.push(x / 18, z / 18);
        // Pale gravel at the verge, deep grass on the hillside, dark lake bed.
        const shade = 1 - smooth(12, 80, Math.abs(x)) * .16;
        colors.push(shade, shade, shade * .93);
        if (row < rows && col < cols - 1) {
          const a = row * cols + col, b = a + 1, c = a + cols, d = c + 1;
          if (side === 1) indices.push(a, b, c, b, d, c);
          else indices.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const ground = mesh(geo, material, side < 0 ? 'forested-slope' : 'lake-embankment');
    ground.receiveShadow = true; ground.frustumCulled = false;
    const coefficients = new Float64Array(cols * 7), derivatives = new Float64Array(cols * 7);
    for (let col = 0; col < cols; col++) {
      const x = side * offsets[col], c = terrainCoefficients(x);
      const left = terrainCoefficients(x - .1), right = terrainCoefficients(x + .1);
      coefficients.set(c, col * 7);
      for (let j = 0; j < 7; j++) derivatives[col * 7 + j] = (right[j] - left[j]) * 5;
    }
    geo.attributes.position.setUsage(T.DynamicDrawUsage);
    geo.attributes.normal.setUsage(T.DynamicDrawUsage);
    scene.add(ground); terrain.push({ mesh: ground, local, rows: rows + 1, cols, coefficients, derivatives });
  }
  const rowPhases = new Float64Array(81 * 6), framePhases = new Float64Array(81 * 6);
  for (let row = 0; row < 81; row++) for (let k = 1; k <= 3; k++) {
    const phase = (80 - row * 10) / PERIOD * TAU * k;
    rowPhases[row * 6 + (k - 1) * 2] = Math.sin(phase);
    rowPhases[row * 6 + (k - 1) * 2 + 1] = Math.cos(phase);
  }
  return { terrain, material, rowPhases, framePhases, rowBends: new Float64Array(81), rowSlopes: new Float64Array(81) };
}

/**
 * Bake a deterministic seamless mineral/seam field once for mountains and rocks.
 * @returns {T.DataTexture} Owned 256-square linear RGBA detail texture with repeat wrapping
 *  and mip filtering; contrast is deliberately subdued to avoid distance shimmer.
 */
function makeStoneDetailTexture() {
  // Original colour-only stone field. The coarsest scales describe mineral
  // patches and weathered seams; fine grain is deliberately low contrast.
  // Trilinear mip filtering removes detail that cannot occupy a screen pixel.
  const size = 256, data = new Uint8Array(size * size * 4), grids = [];
  const random = seededRandom(82931);
  for (const n of [4, 8, 16, 32, 64]) {
    const values = new Float32Array(n * n);
    for (let i = 0; i < values.length; i++) values[i] = random();
    grids.push({ n, values });
  }
  /**
   * Smoothly sample a periodic seeded scalar grid used to bake stone detail.
   * @param {number} u - Normalized horizontal texture coordinate in [0,1).
   * @param {number} v - Normalized vertical texture coordinate in [0,1).
   * @param {Object} grid - n-by-n grid with row-major values.
   * @returns {number} Interpolated grid intensity without mutating the grid.
   */
  const sample = (u, v, grid) => {
    const { n, values } = grid, x = u * n, y = v * n;
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy);
    const x0 = ix % n, x1 = (x0 + 1) % n, y0 = iy % n, y1 = (y0 + 1) % n;
    return (values[y0 * n + x0] * (1 - fx) + values[y0 * n + x1] * fx) * (1 - fy)
      + (values[y1 * n + x0] * (1 - fx) + values[y1 * n + x1] * fx) * fy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const n0 = sample(u, v, grids[0]), n1 = sample(u, v, grids[1]), n2 = sample(u, v, grids[2]);
    const n3 = sample(u, v, grids[3]), n4 = sample(u, v, grids[4]);
    const seam = 1 - smooth(.025, .075, Math.abs(n1 - .5));
    const shade = Math.round(clamp(.86 + (n0 - .5) * .40 + (n1 - .5) * .28
      + (n2 - .5) * .12 + (n3 - .5) * .07 + (n4 - .5) * .03 - seam * .08, .50, 1) * 255);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = shade; data[i + 3] = 255;
  }
  const map = new T.DataTexture(data, size, size, T.RGBAFormat);
  map.name = 'original-filtered-stone-detail';
  // This is a linear multiplicative detail field, not an sRGB photograph.
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.magFilter = T.LinearFilter; map.minFilter = T.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  return map;
}

/**
 * Install a shader patch blending mapped stone detail by a per-vertex mask.
 * @param {T.Material} material - Material mutated in place; its geometry must supply surfaceDetail.
 * @param {number} strength - Multiplicative detail blend weight, normally in [0,1].
 * @returns {T.Material} The same material with compile hooks and a stable shader cache key.
 */
function stoneDetailMaterial(material, strength) {
  /**
   * Inject the stone mask attribute/varying and blend uniform into Three.js-generated GLSL.
   * @param {Object} shader - Mutable shader sources and uniforms supplied during compilation.
   * @returns {void} Changes shader source only; strength stays in a uniform rather than the cache key.
   */
  material.onBeforeCompile = shader => {
    shader.uniforms.scenicStoneStrength = { value: strength };
    shader.vertexShader = 'attribute float surfaceDetail; varying float vSurfaceDetail;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vSurfaceDetail = surfaceDetail;
    `);
    shader.fragmentShader = 'uniform float scenicStoneStrength; varying float vSurfaceDetail;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 undecoratedStone = diffuseColor.rgb;
      #include <map_fragment>
      diffuseColor.rgb = mix(undecoratedStone, diffuseColor.rgb, scenicStoneStrength * vSurfaceDetail);
    `);
  };
  /**
   * Identify the stone GLSL patch independently of its per-material uniform strength.
   * @returns {string} Stable program variant key for Three.js shader reuse.
   */
  material.customProgramCacheKey = () => 'scenic-filtered-stone-detail-v1';
  return material;
}

/**
 * Bake one complete distant ridge ring with seeded erosion, lighting and aerial perspective.
 * Geometry and color detail are generated only at setup; the runtime update applies modest
 * parallax rather than rebuilding hills or introducing an additional render pass.
 * @param {T.Scene} scene - Scene receiving the ridge mesh.
 * @param {number} index - Layer 0, 1 or 2, selecting radius, silhouette and atmosphere.
 * @param {T.Texture} detailMap - Shared stone texture retained by the new material.
 * @returns {T.Mesh} New unculled, double-sided background ring in scene-space metres.
 */
function makeMountain(scene, index, detailMap) {
  // Three complete curved ranges, not finite cardboard strips. The small
  // angular step preserves serrated silhouettes even in the lakeside view.
  const segments = 480, rows = 14, radius = [1070, 910, 760][index];
  const positions = [], indices = [], metadata = [];
  const random = seededRandom(3791 + index * 611), erosion = new Float32Array(128 * 32);
  for (let i = 0; i < erosion.length; i++) erosion[i] = random();
  /**
   * Sample the seeded erosion lattice smoothly with periodic horizontal wrapping.
   * @param {number} x - Horizontal grid-space coordinate.
   * @param {number} y - Vertical grid-space coordinate, wrapped over 32 rows.
   * @param {number} period - Horizontal wrap width, no greater than the 128-column allocation.
   * @returns {number} Interpolated erosion weight.
   */
  const field = (x, y, period) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy);
    const x0 = ((ix % period) + period) % period, x1 = (x0 + 1) % period;
    const y0 = ((iy % 32) + 32) % 32, y1 = (y0 + 1) % 32;
    return (erosion[y0 * 128 + x0] * (1 - fx) + erosion[y0 * 128 + x1] * fx) * (1 - fy)
      + (erosion[y1 * 128 + x0] * (1 - fx) + erosion[y1 * 128 + x1] * fx) * fy;
  };
  const peaks = [
    [-2.90, 215, .25], [-2.38, 285, .30], [-1.85, 240, .24],
    [-1.30, 310, .32], [-.84, 355, .24], [-.47, 265, .23],
    [.30, 245, .21], [.63, 380, .28], [1.08, 310, .32],
    [1.56, 260, .26], [2.02, 330, .30], [2.53, 265, .25],
  ];
  /**
   * Find the shortest signed angular separation across the circular ridge seam.
   * @param {number} a - Sample angle in radians.
   * @param {number} b - Peak-center angle in radians.
   * @returns {number} Signed a-minus-b angle in [-pi,pi].
   */
  const angleDistance = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  for (let row = 0; row <= rows; row++) {
    const f = row / rows;
    for (let i = 0; i <= segments; i++) {
      const a = -Math.PI + i / segments * TAU;
      const shifted = a + [0, .10, -.16][index]
        + Math.sin(a * 9 + index) * .025 + Math.sin(a * 21 - .4) * .012;
      let top = 72;
      for (const [center, height, width] of peaks) {
        const d = angleDistance(shifted, center);
        const flank = d / (width * (d < 0 ? 1.35 : 1.04));
        // Broad shoulders blend into curved saddles instead of triangular cones.
        top = Math.max(top, 42 + height * Math.exp(-flank * flank * 1.25));
      }
      // Distinct angular scales form rock shoulders and small summit notches.
      const ridgeDetail = Math.sin(a * 19 + index * 2.3) * 16
        + Math.sin(a * 41 + Math.sin(a * 7) * 2) * 13
        + Math.sin(a * 79 - .7) * 7 + Math.sin(a * 137 + .5) * 3.5;
      top += ridgeDetail * smooth(70, 190, top);
      // A low open pass stays behind the road's vanishing point.
      top *= (1 - .38 * Math.exp(-((a / .15) ** 2))) * [ .88, .65, .38 ][index];
      // Broad domain-warped channels branch and turn downslope; unlike sine
      // ribs, their spacing and direction are not repeated across the face.
      const t = i / segments;
      const flow = t + (field(t * 16, f * 3, 16) - .5) * .035
        + Math.sin(a * 7 + f * 4) * .006 * (1 - f);
      const ravine = (field(flow * 32, f * 5, 32) - .5) * 1.3
        + (field(flow * 96 + f * 2.0, f * 11, 96) - .5) * .7;
      const shoulder = Math.sin(f * Math.PI);
      const r = radius - (1 - f) * [125, 160, 150][index]
        + ravine * shoulder * [85, 95, 60][index];
      const y = -38 + top * f ** .86 + ravine * shoulder * [11, 14, 8][index];
      positions.push(Math.sin(a) * r, y, -Math.cos(a) * r);
      metadata.push(a, f, ravine);
      if (row < rows && i < segments) {
        const v = row * (segments + 1) + i, w = v + segments + 1;
        indices.push(v, v + 1, w, v + 1, w + 1, w);
      }
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const normals = geo.attributes.normal, colors = new Float32Array(positions.length);
  const uvs = new Float32Array(normals.count * 2), details = new Float32Array(normals.count);
  const vegetation = new T.Color(['#6f8d87', '#537a70', '#426b5b'][index]);
  const rock = new T.Color(['#889ba9', '#737f88', '#697964'][index]);
  const snow = new T.Color('#eff4f1'), haze = new T.Color('#bbd4dd');
  const color = new T.Color(), normal = new T.Vector3(), light = new T.Vector3(-.58, .70, .42).normalize();
  for (let i = 0; i < normals.count; i++) {
    const a = metadata[i * 3], f = metadata[i * 3 + 1], ravine = metadata[i * 3 + 2], y = positions[i * 3 + 1];
    normal.fromBufferAttribute(normals, i);
    const exposed = smooth(48, 135 - index * 20, y);
    color.copy(vegetation).lerp(rock, exposed);
    // Broad, stable mineral patches add material definition without normal-map
    // noise or geometry detail that would shimmer at driving-camera distance.
    const mineral = field((a / TAU + .5) * 48 + f, f * 7, 48) - .5;
    const strata = Math.sin(y * .12 + Math.sin(a * 31) * 1.5) * .025;
    const contrast = index === 0 ? .5 : .78;
    color.multiplyScalar((index === 0 ? .60 : .44) + Math.max(0, normal.dot(light)) * contrast
      + strata + ravine * .14 + mineral * exposed * .14);
    // Snow collects in broken high gullies, not in an even horizontal cap.
    const snowline = [195, 170, 999][index] + Math.sin(a * 17) * 22 + ravine * 46;
    const snowCover = smooth(snowline, snowline + 9, y) * (.10 + .90 * smooth(.05, .70, normal.y));
    const snowLight = .60 + Math.max(0, normal.dot(light)) * .40;
    color.lerp(snow.clone().multiplyScalar(snowLight), snowCover);
    // Fixed aerial perspective is baked once, keeping runtime materials cheap.
    // Distance still separates all three ranges, but the nearer two are no
    // longer painted over with the same heavy pale veil as the far horizon.
    const aerial = [ .29, .12, .045 ][index]
      + (1 - smooth(-20, 155, y)) * [ .38, .24, .15 ][index]
      + (index > 0 ? (1 - smooth(-25, 35, y)) * .30 : 0);
    color.lerp(haze, aerial);
    colors.set([color.r, color.g, color.b], i * 3);
    uvs[i * 2] = (a / TAU + .5) * [108, 96, 84][index] + index * .23;
    uvs[i * 2 + 1] = y / 40 + index * .17;
    details[i] = (1 - snowCover * .95) * (1 - aerial * .80);
  }
  geo.setAttribute('color', new T.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new T.BufferAttribute(uvs, 2));
  geo.setAttribute('surfaceDetail', new T.BufferAttribute(details, 1));
  geo.computeBoundingSphere();
  const material = stoneDetailMaterial(new T.MeshBasicMaterial({ map: detailMap, vertexColors: true, fog: false, side: T.DoubleSide }), [.12, .42, .48][index]);
  const mountain = mesh(geo, material, `distant-ridge-${index}`);
  mountain.frustumCulled = false;
  mountain.userData.backgroundLayer = index;
  scene.add(mountain);
  return mountain;
}

/**
 * Bake a seamless deterministic wave-slope field from integer periodic wave vectors.
 * @returns {T.DataTexture} Owned 256-square mip-filtered repeat texture; RG encode slopes
 *  around 0.5, B carries low-frequency shelf tint, and A is opaque.
 */
function makeLakeNormalMap() {
  // Original seamless wave field, made once. Integer wave vectors meet exactly
  // at the tile edges; mixed directions avoid regular, parallel sine bands.
  // RG contain signed slopes, B a much slower shelf tint, A is unused.
  const size = 256, data = new Uint8Array(size * size * 4);
  const random = seededRandom(7319);
  const vectors = [[3, 1], [-2, 5], [6, 3], [2, 9], [-8, 7], [11, -4],
    [7, 15], [-15, 11], [20, 7], [12, -23], [26, 17], [-31, 19]];
  const waves = vectors.map(([x, z], i) => ({ x, z, phase: random() * TAU, weight: 1 / (1 + i * .12) }));
  const bound = waves.reduce((sum, w) => sum + w.weight, 0) * .61;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * TAU, v = y / size * TAU;
    let sx = 0, sz = 0;
    for (const w of waves) {
      const c = Math.cos(u * w.x + v * w.z + w.phase) * w.weight;
      const length = Math.hypot(w.x, w.z);
      sx += c * w.x / length; sz += c * w.z / length;
    }
    const i = (y * size + x) * 4;
    data[i] = Math.round(clamp(.5 + sx / bound * .5) * 255);
    data[i + 1] = Math.round(clamp(.5 + sz / bound * .5) * 255);
    data[i + 2] = Math.round((.5 + Math.sin(u + v + .6) * .22 + Math.sin(u * 2 - v * 3 + 1.9) * .16) * 255);
    data[i + 3] = 255;
  }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.name = 'original-lake-wavelets';
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create the single-pass lake and caches for bent positions and analytic water depth.
 * The surface is at Y=-5.05 metres; nonuniform X columns preserve shallow banks without a
 * depth buffer or reflected-scene pass. Animation uses mutable shared uniform records.
 * @param {T.Scene} scene - Scene receiving the water mesh.
 * @returns {Object} Mesh, unbent local positions, uniforms, material, owned wave texture and depth coefficients.
 */
function makeLake(scene) {
  // Non-uniform samples preserve the natural shallow shelves along both banks.
  // Depth is evaluated from the existing terrain harmonics, not a depth render.
  const columns = [31, 34, 38, 43, 52, 70, 100, 140, 185, 225, 247, 263, 277, 295, 323];
  const geo = new T.PlaneGeometry(292, 800, columns.length - 1, 80);
  geo.rotateX(-Math.PI / 2); geo.translate(177, -5.05, -320);
  const position = geo.attributes.position;
  const coordinates = new Float32Array(position.count * 2), depths = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const x = columns[i % columns.length], z = position.getZ(i);
    position.setX(i, x); coordinates[i * 2] = x; coordinates[i * 2 + 1] = z;
    depths[i] = Math.max(0, -5.05 - scenicTerrainHeight(x, z));
  }
  geo.setAttribute('lakeLocal', new T.BufferAttribute(coordinates, 2));
  geo.setAttribute('lakeDepth', new T.BufferAttribute(depths, 1).setUsage(T.DynamicDrawUsage));
  position.setUsage(T.DynamicDrawUsage);
  const depthCoefficients = new Float64Array(columns.length * 7);
  columns.forEach((x, col) => depthCoefficients.set(terrainCoefficients(x), col * 7));
  const local = geo.attributes.position.array.slice();
  const material = new T.MeshBasicMaterial({ color: PALETTES.ring.water });
  // Original single-pass lake shader: depth absorption, filtered normal waves,
  // Fresnel sky and a soft analytical far-bank reflection. No scene reflection
  // pass, screen-space noise, sharp sparkling specular, or external water assets.
  const time = { value: 0 }, distance = { value: 0 }, normalMap = makeLakeNormalMap();
  /**
   * Extend the lake shader with analytic depth, filtered wavelets and sky/far-bank reflection.
   * @param {Object} shader - Mutable Three.js shader sources and uniforms.
   * @returns {void} Binds shared time/distance uniform records, keeping animation single-pass.
   */
  material.onBeforeCompile = shader => {
    shader.uniforms.scenicTime = time;
    shader.uniforms.scenicDistance = distance;
    shader.uniforms.scenicWavelets = { value: normalMap };
    shader.vertexShader = `
      attribute vec2 lakeLocal;
      attribute float lakeDepth;
      varying vec2 vLakeLocal;
      varying vec3 vLakeWorld;
      varying float vLakeDepth;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vLakeLocal = lakeLocal;
      vLakeWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vLakeDepth = lakeDepth;
    `);
    shader.fragmentShader = `
      uniform float scenicTime;
      uniform float scenicDistance;
      uniform sampler2D scenicWavelets;
      varying vec2 vLakeLocal;
      varying vec3 vLakeWorld;
      varying float vLakeDepth;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Position is unbent and world-anchored: driving does not drag the waves
      // along with the near-camera recycled mesh.
      vec2 p = vLakeLocal - vec2(0.0, scenicDistance);
      // Trilinear mip filtering averages unresolved slopes rather than allowing
      // them to sparkle. Two crossed scales break up the tile's repetition.
      vec3 waveA = texture2D(scenicWavelets, p / 28.0 + scenicTime * vec2(.004, .0015)).rgb;
      vec2 crossP = vec2(p.y, -p.x);
      vec3 waveB = texture2D(scenicWavelets, crossP / 19.0 + scenicTime * vec2(-.002, .003)).rgb;
      vec2 normalA = waveA.rg * 2.0 - 1.0;
      vec2 normalB = waveB.rg * 2.0 - 1.0;
      float shoreDamping = smoothstep(.0, 1.4, vLakeDepth);
      vec2 slope = normalA * .095 + vec2(-normalB.y, normalB.x) * .055;
      slope *= .35 + shoreDamping * .65;
      vec3 waterNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
      vec3 eye = normalize(cameraPosition - vLakeWorld);
      vec3 reflected = reflect(-eye, waterNormal);
      float facing = clamp(dot(waterNormal, eye), .0, 1.0);
      float fresnel = .045 + .76 * pow(1.0 - facing, 5.0);

      // Emerald shallows turn to cool blue-green where the bottom drops away.
      vec3 shallow = diffuseColor.rgb * vec3(1.22, 1.38, 1.03) + vec3(.095, .115, .055);
      vec3 deep = diffuseColor.rgb * vec3(.33, .58, .70);
      // Low-frequency bottom colour stays fixed to the terrain, not the wind.
      float shelf = texture2D(scenicWavelets, p / 110.0).b - .5;
      float opticalDepth = max(.0, vLakeDepth + shelf * .65 * smoothstep(.0, .6, vLakeDepth));
      vec3 body = mix(shallow, deep, smoothstep(.12, 3.65, opticalDepth));
      body *= .86 + .14 * smoothstep(.0, .85, vLakeDepth);

      // Sky colours are linear-light counterparts of this scene's clear sky.
      vec3 reflection = mix(vec3(.29, .47, .52), vec3(.09, .24, .36), smoothstep(.0, .72, max(reflected.y, .0)));
      // A broad bright area in the reflected sky, fragmented by the wavelets.
      // Unlike a sharp sun disk, this remains stable at driving-camera scale.
      float skySheen = pow(max(dot(reflected, normalize(vec3(.32, .16, -.93))), .0), 30.0);
      reflection += vec3(.16, .17, .16) * skySheen;
      // A soft far-bank proxy supplies dark tree/rock reflections without
      // rendering the entire scene a second time. It follows the same world z.
      float bankRay = max(reflected.x, .025);
      float bankTravel = max(0.0, (326.0 - vLakeLocal.x) / bankRay);
      float bankZ = p.y + reflected.z * bankTravel;
      float bankY = -5.05 + reflected.y * bankTravel;
      float bankHeight = 13.0 + sin(bankZ * .00785398 + .8) * 5.0 + sin(bankZ * .02356194) * 2.5;
      float bankEdge = max(5.0, fwidth(bankY - bankHeight) * 1.5);
      float bankMask = (1.0 - smoothstep(-bankEdge, bankEdge, bankY - bankHeight)) * smoothstep(.02, .18, reflected.x);
      vec3 bankColor = mix(vec3(.075, .145, .145), vec3(.18, .27, .27), smoothstep(-5.0, 22.0, bankY));
      reflection = mix(reflection, bankColor, bankMask * .65 * smoothstep(45.0, 160.0, vLakeLocal.x));
      vec3 waterColor = mix(body, reflection, fresnel);
      waterColor *= 1.0 + (waveA.b - .5) * .035 + (waveB.b - .5) * .020;

      // Broad, restrained light instead of tiny white highlights that alias.
      vec3 sunDirection = normalize(vec3(-.45, .78, .43));
      float glint = pow(max(dot(reflected, sunDirection), .0), 12.0);
      waterColor += vec3(.36, .34, .27) * glint * .16;
      // A translucent pale-green lapping edge, not an ocean-like white outline.
      float edgeWidth = max(.13, fwidth(vLakeDepth) * 1.5);
      float edge = 1.0 - smoothstep(.04, .04 + edgeWidth, vLakeDepth);
      waterColor = mix(waterColor, vec3(.24, .38, .30), edge * .24);
      diffuseColor.rgb = waterColor;
    `);
  };
  /**
   * Identify the analytic lake shader variant for renderer program caching.
   * @returns {string} Stable key; changing time and distance does not recompile the program.
   */
  material.customProgramCacheKey = () => 'scenic-lake-depth-fresnel-v6';
  const lake = mesh(geo, material, 'mountain-lake');
  lake.frustumCulled = false; scene.add(lake);
  return { mesh: lake, local, time, distance, material, normalMap, columns: columns.length, depthCoefficients };
}

/**
 * Register one instanced draw and cache invariant transforms for repeated scenery.
 * Mutates seed records with periodic terrain heights, angle sine/cosine and lastScale; their
 * coordinates/scales must match the supplied geometry and stay stable after registration.
 * @param {Object} state - Mutable scenic subsystem with scene and batches collection.
 * @param {T.BufferGeometry} geometry - Shared local geometry, retained rather than cloned.
 * @param {T.Material} material - Shared batch material.
 * @param {Object[]} seeds - x/z metre locations, sx/sy/sz scales, optional angle radians and flat/y flags.
 * @param {string} kind - Batch category controlling later density, fading and shadow behavior.
 * @param {boolean} [castShadow=false] - Whether instances cast into the existing shadow map.
 * @returns {Object} Registered mesh/seeds/kind entry; GPU resources live with the scenery subsystem.
 */
function addBatch(state, geometry, material, seeds, kind, castShadow = false) {
  const batch = new T.InstancedMesh(geometry, material, seeds.length);
  batch.name = `scenery-${kind}`; batch.frustumCulled = false;
  batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
  batch.castShadow = castShadow; batch.receiveShadow = !['pine', 'flowers'].includes(kind);
  state.scene.add(batch);
  for (const u of seeds) {
    // wrap(z + distance) - distance differs from the seed by a multiple of
    // PERIOD, so height is exactly constant throughout every recycling cycle.
    u.height = u.flat ? 0 : scenicTerrainHeight(u.x, u.z);
    u.cos = Math.cos(u.angle || 0); u.sin = Math.sin(u.angle || 0); u.lastScale = NaN;
  }
  const entry = { mesh: batch, seeds, kind };
  state.batches.push(entry);
  return entry;
}

/**
 * Draw a deterministic branch/leaf alpha cutout shared by all broadleaf crowns.
 * @returns {T.CanvasTexture} Owned 512-square sRGB mipmapped texture; center texels stay
 *  opaque white so trunk/branch geometry can use the same material and draw call.
 */
function makeLeafClusterTexture() {
  // An original small branch/leaf cutout, shared by every crown. Broad leaves,
  // padded transparent edges and mipmaps avoid a field of subpixel needles.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d'), random = seededRandom(42371);
  c.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 24; i++) {
    const angle = random() * TAU, radius = 70 + random() * 120;
    const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius * .88;
    c.strokeStyle = '#c4bca8'; c.lineWidth = 2.4 - i * .055;
    c.beginPath(); c.moveTo(256, 280); c.quadraticCurveTo((x + 256) * .5, y + 20, x, y); c.stroke();
  }
  for (let i = 0; i < 560; i++) {
    const angle = random() * TAU, radius = Math.pow(random(), .60) * 209
      * (1 + Math.sin(angle * 5 + .7) * .065 + Math.sin(angle * 9) * .04);
    const x = 256 + Math.cos(angle) * radius, y = 250 + Math.sin(angle) * radius * .90;
    const w = 6 + random() * 5.5, h = 10 + random() * 8;
    const shade = Math.round(193 + random() * 60);
    c.save(); c.translate(x, y); c.rotate(angle + random() * 2.4);
    c.fillStyle = `rgb(${shade},${shade},${shade})`;
    c.beginPath(); c.ellipse(0, 0, w, h, 0, 0, TAU); c.fill();
    c.restore();
  }
  // The center is also an opaque neutral texel for the trunk/branch UVs.
  c.fillStyle = '#ffffff'; c.fillRect(252, 252, 8, 8);
  const map = new T.CanvasTexture(canvas); map.name = 'original-broadleaf-cluster';
  map.colorSpace = T.SRGBColorSpace;
  map.magFilter = T.LinearFilter; map.minFilter = T.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  return map;
}

/**
 * Build one vertex-colored tree with solid branches and crossed leaf-cluster quads.
 * Consumes exactly 32 values from the shared generator to preserve later placement seeds;
 * a separate fixed generator chooses plane rotations. Input primitives are disposed on merge.
 * @param {function(): number} random - Shared seeded generator returning values in [0,1).
 * @returns {T.BufferGeometry} New nonindexed tree in local metres, grounded at Y=0.
 */
function makeBroadleafGeometry(random) {
  const positions = [], normals = [], colors = [], uvs = [];
  const tint = new T.Color(), ownRandom = seededRandom(5732);
  /**
   * Consume a tree primitive and append its transformed attributes to the merged arrays.
   * @param {T.BufferGeometry} geometry - Owned geometry disposed after copying, including any conversion.
   * @param {T.ColorRepresentation} color - Uniform per-primitive vertex tint.
   * @param {boolean} [leaves=false] - Preserve leaf UVs; otherwise address the opaque center texel.
   * @returns {void} Mutates enclosing positions, normals, colors and UV arrays.
   */
  const append = (geometry, color, leaves = false) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    tint.set(color);
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(tint.r, tint.g, tint.b);
      uvs.push(leaves ? uv.getX(i) : .5, leaves ? uv.getY(i) : .5);
    }
    if (g !== geometry) g.dispose(); geometry.dispose();
  };
  const trunk = new T.CylinderGeometry(.105, .23, 4.7, 7, 3); trunk.translate(0, 2.35, 0);
  append(trunk, '#95826b');
  const up = new T.Vector3(0, 1, 0), direction = new T.Vector3(), midpoint = new T.Vector3(), rotation = new T.Quaternion();
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.39996 + .4;
    const start = new T.Vector3(0, 2.5 + i * .25, 0);
    const end = new T.Vector3(Math.sin(angle) * 1.35, 3.5 + i * .45, Math.cos(angle) * 1.35);
    direction.subVectors(end, start); midpoint.addVectors(start, end).multiplyScalar(.5);
    const branch = new T.CylinderGeometry(.025, .085 - i * .007, direction.length(), 5);
    rotation.setFromUnitVectors(up, direction.normalize()); branch.applyQuaternion(rotation); branch.translate(midpoint.x, midpoint.y, midpoint.z);
    append(branch, '#93806a');
  }
  for (let i = 0; i < 32; i++) {
    const t = i / 31, angle = i * 2.39996;
    const radius = 1.85 * Math.sqrt(Math.max(0, 1 - ((t - .5) * 2) ** 2));
    // Exactly one shared random call per old clump preserves every scene seed.
    const r = .52 + random() * .3;
    const x = Math.sin(angle) * radius, y = 3.05 + t * 3.15, z = Math.cos(angle) * radius;
    const spin = ownRandom() * Math.PI;
    for (let plane = 0; plane < 2; plane++) {
      const leaf = new T.PlaneGeometry(r * 1.70, r * 1.905, 1, 1);
      const p = leaf.attributes.position, n = leaf.attributes.normal, normal = new T.Vector3();
      for (let j = 0; j < n.count; j++) {
        // Soft curved lighting without adding crown polygons or a normal map.
        normal.set(p.getX(j) / r * .28, p.getY(j) / r * .20 + .24, .88).normalize();
        n.setXYZ(j, normal.x, normal.y, normal.z);
      }
      leaf.rotateY(spin + plane * Math.PI / 2); leaf.scale(1, 1, .9); leaf.translate(x, y, z);
      append(leaf, ['#a7b879', '#a2b57b', '#91a96e', '#b3bf89'][i % 4], true);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Populate bounded instanced pine, broadleaf and grass batches with deterministic seeds.
 * Leaves gaps toward the lake, confines verge vegetation outside the road and shares geometry
 * within each category; alpha-to-coverage follows the actual context's MSAA capability.
 * @param {Object} state - Scenery owner receiving batches, leaf texture/material and grass material.
 * @param {Object} assets - Three preloaded tree cutout maps, retained by pine materials.
 * @param {function(): number} random - Shared deterministic placement generator, advanced in place.
 * @returns {void} Adds scene resources once, not during frame updates.
 */
function makeFoliage(state, assets, random) {
  const pineGeo = new T.PlaneGeometry(1, 1); pineGeo.translate(0, .5, 0);
  const seeds = [[], [], []];
  for (let i = 0; i < 390; i++) {
    // Deliberately leave large open windows across the lake rather than filling
    // both verges with a monotonous wall of billboard trees.
    const left = i % 5 !== 0;
    const x = left ? -(14 + random() ** 1.65 * 175) : (i % 10 ? 13 + random() * 9 : 305 + random() * 130);
    const z = 65 - random() * 780;
    const width = Math.min(8 + random() * 10, (Math.abs(x) - 8.5) * 2);
    seeds[i % 3].push({ x, z, sx: width, sy: 9 + random() * 13, sz: 1, r: random(), y: -.1 });
  }
  assets.trees.forEach((map, index) => {
    const material = new T.MeshBasicMaterial({ map, alphaTest: .42, alphaToCoverage: state.msaa, side: T.DoubleSide, color: '#dce6d4' });
    const batch = addBatch(state, pineGeo, material, seeds[index], 'pine', true);
    const color = new T.Color();
    seeds[index].forEach((_, i) => { color.setHSL(.22 + random() * .035, .11 + random() * .08, .79 + random() * .19); batch.mesh.setColorAt(i, color); });
  });

  const crownGeometry = makeBroadleafGeometry(random);
  state.leafTexture = makeLeafClusterTexture();
  state.leafMaterial = new T.MeshStandardMaterial({
    map: state.leafTexture, vertexColors: true, color: '#b7c4a0', roughness: 1,
    alphaTest: .42, alphaToCoverage: state.msaa, side: T.DoubleSide,
  });
  const broadleaf = [];
  for (let i = 0; i < 36; i++) {
    const x = i % 3 ? -(13 + random() * 48) : 11.7 + random() * 8;
    const s = .85 + random() * .9;
    broadleaf.push({ x, z: 55 - random() * 760, sx: s, sy: s, sz: s, angle: random() * TAU, r: random() * .7 });
  }
  addBatch(state, crownGeometry, state.leafMaterial, broadleaf, 'broadleaf', true);

  const grassPositions = [], grassColors = [];
  for (let i = 0; i < 9; i++) {
    const a = random() * TAU, x = Math.cos(a) * random() * .4, z = Math.sin(a) * random() * .4;
    const h = .2 + random() * .48, w = .035 + random() * .025;
    grassPositions.push(x - w, 0, z, x + w, 0, z, x + Math.sin(a) * .18, h, z + Math.cos(a) * .13);
    for (const shade of [.6, .67, .98]) grassColors.push(shade, shade, shade);
  }
  const grassGeo = new T.BufferGeometry();
  grassGeo.setAttribute('position', new T.Float32BufferAttribute(grassPositions, 3));
  grassGeo.setAttribute('color', new T.Float32BufferAttribute(grassColors, 3)); grassGeo.computeVertexNormals();
  state.grassMaterial = new T.MeshStandardMaterial({ color: PALETTES.ring.grass, vertexColors: true, side: T.DoubleSide, roughness: 1 });
  const grass = [];
  for (let i = 0; i < 680; i++) {
    const side = i % 2 ? -1 : 1;
    const x = side * (8.6 + random() ** 1.6 * (side < 0 ? 20 : 12));
    const s = .65 + random() * 1.15;
    grass.push({ x, z: 65 - random() * 780, sx: s, sy: s, sz: s, angle: random() * TAU });
  }
  addBatch(state, grassGeo, state.grassMaterial, grass, 'grass');
}

/**
 * Create welded, smoothly shaded stone geometry and a single seeded instance batch.
 * @param {Object} state - Scenery owner providing shared stoneTexture and receiving the rock batch.
 * @param {function(): number} random - Placement/scale generator advanced for 82 rock seeds.
 * @returns {void} Keeps stones outside the playable road and disposes the construction icosahedron.
 */
function makeRocks(state, random) {
  const source = new T.IcosahedronGeometry(1, 2), vertices = [], indices = [], colors = [], uvs = [], lookup = new Map();
  const p = source.attributes.position;
  const dark = new T.Color('#535d53'), light = new T.Color('#aaa48f'), moss = new T.Color('#60734f'), color = new T.Color();
  // Weld shared corners before recalculating normals: stones retain their
  // irregular outline, but no longer advertise every individual triangle.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = vertices.length / 3; lookup.set(key, index);
      vertices.push(x * (1 + .08 * Math.sin(y * 12) + .04 * Math.sin(z * 11)),
        y * .75 * (.92 + .08 * Math.sin(x * 7 + z * 5)), z * (1 + .1 * Math.sin(x * 9 + y * 8)));
      const weathering = .36 + .21 * Math.sin(x * 4 + z * 3) + .16 * Math.sin(y * 8 - z * 4) + .15 * (y + 1) / 2;
      color.copy(dark).lerp(light, weathering);
      color.lerp(moss, smooth(.15, .9, y) * (.15 + .13 * Math.sin(x * 3 + z * 5)));
      colors.push(color.r, color.g, color.b);
      uvs.push(x * .9, z * .9 + y * .3);
    }
    indices.push(index);
  }
  source.dispose();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('surfaceDetail', new T.BufferAttribute(new Float32Array(vertices.length / 3).fill(1), 1));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const material = stoneDetailMaterial(new T.MeshStandardMaterial({ map: state.stoneTexture, vertexColors: true, roughness: .96 }), .85);
  const rocks = [];
  for (let i = 0; i < 82; i++) {
    const large = i < 24, side = i % 5 ? -1 : 1;
    const offset = large ? 24 + random() * 75 : 10 + random() * 16;
    const s = large ? 3 + random() * 10 : .3 + random() * 1.35;
    const sx = s * (1.1 + random()), sy = s * (.6 + random() * .55), sz = s * (1 + random());
    const x = side * Math.max(offset, 9 + Math.max(sx, sz) * 1.15);
    rocks.push({ x, z: 60 - random() * 770, sx, sy, sz, y: -.1, angle: random() * TAU });
  }
  addBatch(state, geometry, material, rocks, 'rock', true);
}

/**
 * Add instanced guardrail posts/segments, delineators and reflectors along both verges.
 * @param {Object} state - Scenery subsystem receiving four batches, grounded relative to the road.
 * @returns {void} Rail seeds request bend-aligned rotation; other fittings reuse fixed local rotations.
 */
function makeRoadFurniture(state) {
  const steel = new T.MeshStandardMaterial({ color: '#bec6c4', metalness: .72, roughness: .42 });
  const post = [], rail = [], marker = [], reflectors = [];
  for (const side of [-1, 1]) {
    for (let z = -715; z < 85; z += 5) post.push({ x: side * 7.65, z, y: .43, sx: 1, sy: 1, sz: 1, flat: true });
    for (let z = -715; z < 85; z += 10) rail.push({ x: side * 7.65, z, y: .87, sx: 1, sy: 1, sz: 1, flat: true, aligned: true });
    for (let z = -710; z < 90; z += 40) {
      marker.push({ x: side * 8.45, z, y: .6, sx: 1, sy: 1, sz: 1, flat: true });
      reflectors.push({ x: side * 8.45, z: z + .091, y: .91, sx: 1, sy: 1, sz: 1, flat: true });
    }
  }
  addBatch(state, new T.BoxGeometry(.12, .86, .13), steel, post, 'rail-post');
  // W-section guardrails catch thin highlights without many individual meshes.
  const shape = new T.Shape();
  shape.moveTo(0, -.15); shape.lineTo(.055, -.09); shape.lineTo(.015, 0); shape.lineTo(.055, .09); shape.lineTo(0, .15);
  shape.lineTo(-.035, .15); shape.lineTo(.02, .09); shape.lineTo(-.02, 0); shape.lineTo(.02, -.09); shape.lineTo(-.035, -.15); shape.closePath();
  const railGeometry = new T.ExtrudeGeometry(shape, { depth: 10.06, steps: 1, bevelEnabled: false }); railGeometry.translate(0, 0, -5.03);
  addBatch(state, railGeometry, steel, rail, 'rail');
  addBatch(state, new T.BoxGeometry(.16, 1.2, .16), new T.MeshStandardMaterial({ color: '#eee9d8', roughness: .9 }), marker, 'delineator');
  addBatch(state, new T.BoxGeometry(.17, .18, .025), new T.MeshStandardMaterial({ color: '#dd6e3f', emissive: '#5b1c0c', emissiveIntensity: .16, roughness: .45 }), reflectors, 'reflector');
}

/**
 * Assemble a small original chalet with roof, windows and timber details in local metres.
 * @returns {T.BufferGeometry} New vertex-colored merged geometry; temporary part geometries are consumed.
 */
function chaletGeometry() {
  const parts = [
    box(9, .8, 6, 0, .4, 0, '#969187'), box(8.5, 2.5, 5.6, 0, 1.95, 0, '#dfcba8'),
    box(8.5, 1.75, 5.6, 0, 4.075, 0, '#816448'),
  ];
  const roofPositions = [
    -4.9,4.85,-3.3, 4.9,4.85,-3.3, 0,7.05,-3.3,
    -4.9,4.85,3.3, 0,7.05,3.3, 4.9,4.85,3.3,
    -4.9,4.85,-3.3, 0,7.05,-3.3, -4.9,4.85,3.3,
    -4.9,4.85,3.3, 0,7.05,-3.3, 0,7.05,3.3,
    0,7.05,-3.3, 4.9,4.85,-3.3, 4.9,4.85,3.3,
    0,7.05,-3.3, 4.9,4.85,3.3, 0,7.05,3.3,
  ];
  const roof = new T.BufferGeometry(); roof.setAttribute('position', new T.Float32BufferAttribute(roofPositions, 3)); roof.computeVertexNormals();
  parts.push({ geometry: roof, color: '#575c59' });
  for (const x of [-2.7, 0, 2.7]) for (const y of [1.9, 4.05]) {
    parts.push(box(1.2, 1.3, .14, x, y, 2.86, '#403f38'));
    parts.push(box(.91, 1.02, .17, x, y, 2.91, '#9cb6b7'));
    parts.push(box(.07, 1.08, .2, x, y, 2.94, '#ddcea9'));
    parts.push(box(.98, .07, .2, x, y, 2.94, '#ddcea9'));
  }
  parts.push(box(1.35, 2.2, .16, 0, 1.5, 2.98, '#534c3f'));
  parts.push(box(.65, 2, .75, 2.2, 6.3, -1.4, '#999182'));
  for (let y = 3.4; y < 4.9; y += .27) parts.push(box(8.55, .035, .06, 0, y, 2.84, '#654c38'));
  return coloredGeometry(parts);
}

/**
 * Register three hillside chalets and one flat lakeside lookout as instanced landmarks.
 * @param {Object} state - Scenery owner receiving geometry/material resources and placement seeds.
 * @returns {void} Adds two reusable batches without per-frame construction.
 */
function makeLandmarks(state) {
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: .88 });
  const seeds = [
    { x: -27, z: -185, sx: 1, sy: 1, sz: 1, angle: .14 },
    { x: -49, z: -216, sx: .76, sy: .76, sz: .76, angle: -.1 },
    { x: -36, z: -590, sx: 1.12, sy: 1.12, sz: 1.12, angle: .26 },
  ];
  addBatch(state, chaletGeometry(), material, seeds, 'chalet', true);
  // A small lakeside observation deck, with open rails rather than a solid wall.
  const parts = [box(5.2, .18, 8, 0, .05, 0, '#9d8c68')];
  for (let z = -3.8; z <= 3.8; z += 1.9) parts.push(box(.12, 1.22, .12, 2.5, .64, z, '#58605b'));
  parts.push(box(.12, .12, 8, 2.5, 1.23, 0, '#737e78'));
  parts.push(box(.12, .08, 8, 2.5, .65, 0, '#737e78'));
  for (let z = -3.8; z <= 3.8; z += .38) parts.push(box(5.1, .018, .025, 0, .15, z, '#685d46'));
  addBatch(state, coloredGeometry(parts), material, [{ x: 12.5, z: -347, y: .08, sx: 1, sy: 1, sz: 1, flat: true }], 'lookout', true);
}

/**
 * Draw two Russian directional signs and add their independent scene groups.
 * @param {Object} state - Scenery owner whose objects list stores road-local placement records.
 * @returns {void} Owns new canvas textures, boards and posts; updates later recycle only transforms.
 */
function makeSigns(state) {
  const items = [
    { x: -10.8, z: -105, title: 'СЕВЕРНЫЙ ПЕРЕВАЛ', sub: 'Р-21    12 км', color: '#28615c' },
    { x: 10.8, z: -465, title: 'ГОРНОЕ ОЗЕРО', sub: 'СМОТРОВАЯ ПЛОЩАДКА  ↗', color: '#30596a' },
  ];
  for (const item of items) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 320;
    const c = canvas.getContext('2d');
    c.fillStyle = item.color; c.fillRect(0, 0, 1024, 320);
    c.strokeStyle = '#edeedf'; c.lineWidth = 10; c.strokeRect(16, 16, 992, 288);
    c.fillStyle = '#fffdf1'; c.font = '600 59px Arial'; c.textAlign = 'center'; c.fillText(item.title, 512, 128);
    c.font = '37px Arial'; c.fillText(item.sub, 512, 228);
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace;
    const group = new T.Group(); group.name = 'scenic-direction-sign';
    const poleMaterial = new T.MeshStandardMaterial({ color: '#aeb8b5', metalness: .65, roughness: .45 });
    for (const x of [-1.65, 1.65]) {
      const pole = mesh(new T.CylinderGeometry(.055, .055, 4.5, 6), poleMaterial, 'sign-post');
      pole.position.set(x, 2.25, 0); group.add(pole);
    }
    const board = mesh(new T.BoxGeometry(5.4, 1.7, .08), new T.MeshStandardMaterial({ map, roughness: .8 }), 'direction-board');
    board.position.y = 3.8; group.add(board); state.scene.add(group);
    state.objects.push({ mesh: group, ...item, flat: true });
  }
}

/**
 * Bake the deterministic alpine sky panorama once and install it as the scene background.
 * Cloud lobes/noise are resolved into pixels rather than additional meshes or runtime shaders;
 * the returned panorama is also suitable as a source for separately prepared reflections.
 * @param {T.Scene} scene - Scene whose background, intensity and background rotation are replaced.
 * @returns {T.DataTexture} Owned 2048-by-1024 sRGB equirectangular panorama, with north in row zero.
 */
function makeClearSky(scene) {
  // Original baked sky: a calm blue gradient, irregular cumulus groups and
  // high wisps. One texture replaces the previous sky, with no cloud pass or
  // runtime noise. The separate HDR still supplies the car's environment light.
  const width = 2048, height = 1024, data = new Uint8Array(width * height * 4);
  const random = seededRandom(98761), grids = [];
  for (const size of [16, 32, 64, 128, 256, 512]) {
    const values = new Float32Array(size * size);
    for (let i = 0; i < values.length; i++) values[i] = random();
    grids.push({ size, values });
  }
  /**
   * Interpolate a periodic noise lattice for the baked cloud density, wrapping both axes.
   * @param {number} x - Horizontal lattice-space coordinate.
   * @param {number} y - Vertical lattice-space coordinate.
   * @param {Object} grid - Square grid described by size and row-major values.
   * @returns {number} Smooth deterministic intensity without changing stored values.
   */
  const noise = (x, y, grid) => {
    const n = grid.size, ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % n) + n) % n, x1 = (x0 + 1) % n, y0 = ((iy % n) + n) % n, y1 = (y0 + 1) % n, v = grid.values;
    return (v[y0 * n + x0] * (1 - sx) + v[y0 * n + x1] * sx) * (1 - sy)
      + (v[y1 * n + x0] * (1 - sx) + v[y1 * n + x1] * sx) * sy;
  };
  const groups = [[.08,.366,.043,.048],[.225,.352,.050,.055],[.36,.389,.038,.035],
    [.49,.324,.047,.057],[.64,.375,.050,.040],[.79,.341,.046,.053],[.92,.390,.039,.034]];
  const lobes = groups.flatMap(([x, y, w, h]) => Array.from({ length: 6 }, (_, i) => {
    const cx = x + (i - 2.5) * w * .30, cy = y + (random() - .5) * h * .62;
    const rx = w * (.20 + random() * .18), ry = h * (.24 + random() * .32);
    const across = new Float32Array(width);
    for (let j = 0; j < width; j++) {
      const dx = Math.min(Math.abs(j / width - cx), 1 - Math.abs(j / width - cx)) / rx;
      across[j] = Math.exp(-dx * dx * 1.8);
    }
    return { cy, ry, across };
  }));
  const vertical = new Float32Array(lobes.length), localY = new Float32Array(lobes.length);
  const stops = [[0,[51,127,177]],[.25,[101,165,203]],[.43,[173,206,221]],[.50,[204,224,226]],[1,[168,186,175]]];
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const blend = smooth(stops[k][0], stops[k + 1][0], v);
    const sky = stops[k][1].map((c, j) => c + (stops[k + 1][1][j] - c) * blend);
    for (let i = 0; i < lobes.length; i++) {
      localY[i] = (v - lobes[i].cy) / lobes[i].ry;
      vertical[i] = Math.exp(-localY[i] * localY[i] * 1.8);
    }
    for (let x = 0; x < width; x++) {
      const u = x / width;
      let alpha = 0, shade = 0;
      if (v > .23 && v < .465) {
        const n0 = noise(u * 16, v * 32, grids[0]);
        const n1 = noise(u * 32, v * 64, grids[1]);
        const n2 = noise(u * 64, v * 128, grids[2]);
        const n3 = noise(u * 128, v * 256, grids[3]);
        const n4 = noise(u * 256, v * 512, grids[4]);
        const n5 = noise(u * 512, v * 1024, grids[5]);
        let envelope = 0, underside = 0;
        for (let j = 0; j < lobes.length; j++) {
          const density = lobes[j].across[x] * vertical[j];
          if (density > envelope) { envelope = density; underside = localY[j]; }
        }
        const shape = envelope * .65 + (n0 - .5) * .52 + (n1 - .5) * .36
          + (n2 - .5) * .30 + (n3 - .5) * .25 + (n4 - .5) * .18 + (n5 - .5) * .075;
        alpha = smooth(.15, .46, shape) * smooth(.08, .32, envelope) * .85;
        shade = clamp(smooth(-.55, .6, underside) * .53 + (n2 - .5) * .17 + (n3 - .5) * .15);

      }
      const i = (y * width + x) * 4;
      for (let j = 0; j < 3; j++) {
        const cloud = [255, 253, 245][j] + ([159, 186, 200][j] - [255, 253, 245][j]) * shade;
        data[i + j] = Math.round(sky[j] * (1 - alpha) + cloud * alpha);
      }
      data[i + 3] = 255;
    }
  }
  const sky = new T.DataTexture(data, width, height, T.RGBAFormat);
  sky.name = 'original-alpine-cloud-sky'; sky.colorSpace = T.SRGBColorSpace;
  // DataTexture row zero must address the panorama's northern pole.
  sky.flipY = true;
  sky.magFilter = T.LinearFilter; sky.minFilter = T.LinearMipmapLinearFilter; sky.generateMipmaps = true;
  sky.wrapS = T.RepeatWrapping; sky.needsUpdate = true;
  sky.mapping = T.EquirectangularReflectionMapping;
  scene.background = sky; scene.backgroundIntensity = 1;
  scene.backgroundRotation.y = 0;
  return sky;
}

/**
 * Construct the scenic subsystem once after asset maps and road lighting are available.
 * Stores state on host.scenery, installs sky/fog, creates bounded instanced batches and performs
 * the first transform update. Repeated invocation would add new resources, not replace/dispose old ones.
 * @param {Object} host - Renderer owner with scene, assets, optional renderer, route and time.
 * @param {function(number, number): number} bend - Scene-Z/travel-metre sampler returning lateral bend metres.
 * @returns {Object} Mutable scenic state, also retained on the host.
 */
export function buildScenicLandscape(host, bend) {
  const state = {
    scene: host.scene, bend, batches: [], objects: [],
    msaa: !!host.renderer?.getContext?.()?.getContextAttributes?.()?.antialias,
    lastDistance: NaN, lastRoute: '',
  };
  host.scenery = state;
  state.sky = makeClearSky(host.scene);
  // Compatibility for diagnostics that enumerate the old terrain collection.
  host.terrains = [];
  const random = seededRandom(81732);
  Object.assign(state, makeTerrain(state.scene, host.assets));
  state.stoneTexture = makeStoneDetailTexture();
  state.ridges = [0, 1, 2].map(index => makeMountain(state.scene, index, state.stoneTexture));
  state.lake = makeLake(state.scene);
  makeFoliage(state, host.assets, random);
  makeRocks(state, random);
  makeRoadFurniture(state);
  makeLandmarks(state);
  makeSigns(state);
  // The HDR remains the reflection source. A longer, cooler atmosphere
  // preserves silhouettes while keeping the playable road high contrast.
  host.scene.fog = new T.Fog(PALETTES.ring.fog, 160, 650);
  updateScenicLandscape(host, 0, host.route || 'ring');
  return state;
}

/**
 * Scroll/bend scenery, update terrain normals and lake depths, and apply route palettes.
 * Reuses typed arrays and GPU resources with no per-frame geometry/material allocation;
 * unchanged travel/palette skips transform work but still advances the lake time uniform.
 * @param {Object} host - Owner initialized by buildScenicLandscape; absent scenery is a no-op.
 * @param {number} distance - Total route travel in metres, mapping scene Z to world Z minus distance.
 * @param {string} [route='ring'] - Palette/density key; unknown keys use ring appearance.
 * @returns {void} Mutates scene attributes, seed transform caches, uniforms and last-update markers.
 */
export function updateScenicLandscape(host, distance, route = 'ring') {
  const state = host.scenery;
  if (!state) return;
  const palette = PALETTES[route] || PALETTES.ring;
  if (route !== state.lastRoute) {
    state.material.color.set(palette.land);
    state.grassMaterial.color.set(palette.grass);
    state.leafMaterial.color.set(palette.leaves).lerp(new T.Color('#ffffff'), .20);
    state.lake.material.color.set(palette.water);
    host.scene.fog.color.set(palette.fog);
  }
  state.lake.time.value = host.time || 0;
  state.lake.distance.value = distance;
  if (distance === state.lastDistance && route === state.lastRoute) return;
  const bend = state.bend;
  const moved = distance !== state.lastDistance;
  // Rotate cached row harmonics by distance. Each z row shares its bend and
  // derivatives across both banks and all seventeen x samples.
  if (moved) for (let k = 0; k < 3; k++) {
    const a = distance / PERIOD * TAU * (k + 1), sd = Math.sin(a), cd = Math.cos(a);
    for (let row = 0; row < 81; row++) {
      const i = row * 6 + k * 2, s = state.rowPhases[i], c = state.rowPhases[i + 1];
      state.framePhases[i] = s * cd - c * sd; state.framePhases[i + 1] = c * cd + s * sd;
    }
  }
  if (moved) for (let row = 0; row < 81; row++) {
    const z = 80 - row * 10;
    state.rowBends[row] = bend(z, distance);
    state.rowSlopes[row] = (bend(z + 1, distance) - bend(z - 1, distance)) * .5;
  }
  const omega = TAU / PERIOD;
  if (moved) {
  for (const entry of state.terrain) {
    const geo = entry.mesh.geometry, p = geo.attributes.position.array, n = geo.attributes.normal.array;
    const c = entry.coefficients, dx = entry.derivatives;
    for (let row = 0; row < entry.rows; row++) {
      const phase = row * 6, f = state.framePhases;
      const s1 = f[phase], c1 = f[phase + 1], s2 = f[phase + 2], c2 = f[phase + 3], s3 = f[phase + 4], c3 = f[phase + 5];
      const b = state.rowBends[row], slope = state.rowSlopes[row];
      for (let col = 0; col < entry.cols; col++) {
        const i = row * entry.cols + col, j = col * 7, v = i * 3;
        const h = c[j] + c[j + 1] * s1 + c[j + 2] * c1 + c[j + 3] * s2 + c[j + 4] * c2 + c[j + 5] * s3 + c[j + 6] * c3;
        const hx = dx[j] + dx[j + 1] * s1 + dx[j + 2] * c1 + dx[j + 3] * s2 + dx[j + 4] * c2 + dx[j + 5] * s3 + dx[j + 6] * c3;
        const hz = omega * (c[j + 1] * c1 - c[j + 2] * s1 + 2 * (c[j + 3] * c2 - c[j + 4] * s2) + 3 * (c[j + 5] * c3 - c[j + 6] * s3));
        const nz = hx * slope - hz, inverseLength = 1 / Math.sqrt(hx * hx + 1 + nz * nz);
        p[v] = entry.local[i * 2] + b; p[v + 1] = h;
        n[v] = -hx * inverseLength; n[v + 1] = inverseLength; n[v + 2] = nz * inverseLength;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  }
    const lake = state.lake, lakePosition = lake.mesh.geometry.attributes.position, depths = lake.mesh.geometry.attributes.lakeDepth;
    const c = lake.depthCoefficients, f = state.framePhases;
    // PlaneGeometry runs from far to near, opposite to the two terrain banks.
    for (let row = 0; row < 81; row++) {
      const terrainRow = 80 - row, phase = terrainRow * 6;
      for (let col = 0; col < lake.columns; col++) {
        const i = row * lake.columns + col, j = col * 7;
        lakePosition.array[i * 3] = lake.local[i * 3] + state.rowBends[terrainRow];
        const ground = c[j] + c[j + 1] * f[phase] + c[j + 2] * f[phase + 1] + c[j + 3] * f[phase + 2] + c[j + 4] * f[phase + 3] + c[j + 5] * f[phase + 4] + c[j + 6] * f[phase + 5];
        depths.array[i] = Math.max(0, -5.05 - ground);
      }
    }
    lakePosition.needsUpdate = true; depths.needsUpdate = true;
  }
  for (const batch of state.batches) {
    const matrix = batch.mesh.instanceMatrix.array;
    const density = batch.kind === 'broadleaf' ? Math.max(.57, palette.density) : palette.density;
    const fades = batch.kind === 'pine' || batch.kind === 'broadleaf' || batch.kind === 'rock';
    for (let i = 0; i < batch.seeds.length; i++) {
      const u = batch.seeds[i], z = wrap(u.z, distance);
      const visible = (u.r === undefined || u.r < density) && (u.flat || u.height > -4.7);
      const fade = fades ? smooth(-720, -650, z) : 1;
      const scale = visible ? fade : 0;
      const m = i * 16;
      if (scale !== u.lastScale || u.aligned) {
        let cos = u.cos, sin = u.sin;
        if (u.aligned) {
          const slope = (bend(z + 1, distance) - bend(z - 1, distance)) * .5;
          cos = 1 / Math.sqrt(1 + slope * slope); sin = slope * cos;
        }
        matrix[m] = cos * u.sx * scale; matrix[m + 2] = -sin * u.sx * scale;
        matrix[m + 5] = u.sy * scale; matrix[m + 8] = sin * u.sz * scale; matrix[m + 10] = cos * u.sz * scale;
        u.lastScale = scale;
      }
      if (scale) {
        matrix[m + 12] = u.x + bend(z, distance);
        matrix[m + 13] = u.height + (u.y || 0); matrix[m + 14] = z;
      }
    }
    batch.mesh.instanceMatrix.needsUpdate = true;
  }
  for (const item of state.objects) {
    const z = wrap(item.z, distance);
    item.mesh.position.set(item.x + bend(z, distance), item.flat ? 0 : scenicTerrainHeight(item.x, z - distance), z);
  }
  // Small parallax, not an endlessly spinning backdrop or a moving horizon.
  for (let i = 0; i < state.ridges.length; i++) state.ridges[i].position.x = Math.sin(distance / 1800) * (9 + i * 6);
  state.lastDistance = distance; state.lastRoute = route;
}
