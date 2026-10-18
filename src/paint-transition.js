import * as T from '../public/vendor/three.js';

const DURATION = .95;
const EDGE_FRACTION = .028;
const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const equalColors = (a, b) => a.length === b.length && a.every((color, i) => color.equals(b[i]));

/** CPU equivalent of the actual shader mask, useful for deterministic spatial tests. */
export function paintCoverage(z, progress, minZ, maxZ) {
  const span = Math.max(.0001, maxZ - minZ), half = span * EDGE_FRACTION / 2;
  const front = minZ - half + clamp01(progress) * (span + half * 2);
  const t = clamp01((z - front + half) / (half * 2));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A single-pass albedo-only wipe on exclusively owned body materials. Positions
 * are measured in the sprung body's coordinate frame, not mesh/screen/world Z:
 * translated submeshes, showcase motion and suspension cannot detach the seam.
 * Maps, normal maps, PBR properties, glass, trim and source geometry stay intact.
 * Rapid clicks finish the visible wipe, then use only the latest pending color.
 * This bounded commit/latest policy never resets a partially painted panel.
 */
export class VehiclePaintTransition {
  constructor(car, { duration = DURATION, slot = 'paint', root = null } = {}) {
    this.car = car; this.root = root || car.userData.bodyRig || car; this.slot=slot;
    const owned = new Set(car.userData.ownedAppearanceMaterials || []);
    this.materials = (car.userData.appearance?.[slot] || []).filter(entry=>!root||entry.root===root).map(entry => entry.material)
      .filter(material => owned.has(material) && material.isMeshStandardMaterial);
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : DURATION;
    this.current = this.materials.map(material => material.color.clone());
    this.from = this.current.map(color => color.clone()); this.to = this.current.map(color => color.clone());
    this.pending = null; this.active = false; this.held = false; this.progress = 1; this.disposed = false;
    this.uniforms = {
      garagePaintRootInverse: { value: new T.Matrix4() },
      garagePaintRange: { value: new T.Vector2(-1, 1) },
      garagePaintProgress: { value: 1 }, garagePaintActive: { value: 0 },
    };
    this.updateCoordinates(); this.measureBounds();
    this.hooks = this.materials.map((material, index) => {
      const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
      const baseKey = cacheKey.call(material);
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        Object.assign(shader.uniforms, this.uniforms, {
          garagePaintFrom: { value: this.from[index] }, garagePaintTo: { value: this.to[index] },
        });
        shader.vertexShader = `uniform mat4 garagePaintRootInverse;\nvarying float vGaragePaintZ;\n${shader.vertexShader}`
          .replace('#include <project_vertex>', '#include <project_vertex>\n vGaragePaintZ = (garagePaintRootInverse * modelMatrix * vec4(transformed, 1.0)).z;');
        shader.fragmentShader = `uniform vec2 garagePaintRange;\nuniform float garagePaintProgress;\nuniform float garagePaintActive;\nuniform vec3 garagePaintFrom;\nuniform vec3 garagePaintTo;\nvarying float vGaragePaintZ;\n${shader.fragmentShader}`
          .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
            if (garagePaintActive > 0.5) {
              float paintSpan = max(0.0001, garagePaintRange.y - garagePaintRange.x);
              float paintHalfEdge = paintSpan * ${EDGE_FRACTION / 2};
              float paintFront = mix(garagePaintRange.x - paintHalfEdge, garagePaintRange.y + paintHalfEdge, garagePaintProgress);
              float paintMask = 1.0 - smoothstep(paintFront - paintHalfEdge, paintFront + paintHalfEdge, vGaragePaintZ);
              diffuseColor.rgb = mix(garagePaintFrom, garagePaintTo, paintMask);
            }`);
      };
      material.customProgramCacheKey = () => `${baseKey}:garage-paint-wipe-v1`;
      material.needsUpdate = true;
      return { material, compile, cacheKey };
    });
  }

  /** Measure actual body vertices once; no geometry clones, buffers or passes are created. */
  measureBounds() {
    const paint = new Set(this.materials), point = new T.Vector3(), matrix = new T.Matrix4();
    let min = Infinity, max = -Infinity;
    this.car.updateWorldMatrix(true, true);
    this.car.traverse(node => {
      if (!node.isMesh || !paint.has(node.material)) return;
      const positions = node.geometry?.attributes.position; if (!positions) return;
      matrix.multiplyMatrices(this.uniforms.garagePaintRootInverse.value, node.matrixWorld);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        if (Number.isFinite(point.z)) { min = Math.min(min, point.z); max = Math.max(max, point.z); }
      }
    });
    if (!Number.isFinite(min) || max - min < .0001) { min = -1; max = 1; }
    this.uniforms.garagePaintRange.value.set(min, max);
  }

  /** Call before a draw, after any showcase transform; all body shaders share this uniform. */
  updateCoordinates() {
    this.root.updateWorldMatrix(true, false);
    this.uniforms.garagePaintRootInverse.value.copy(this.root.matrixWorld).invert();
  }

  /** Called after applying the saved appearance. Material colors already hold the latest selection. */
  retarget({ reducedMotion = false } = {}) {
    if (this.disposed || !this.materials.length) return false;
    const target = this.materials.map(material => material.color.clone());
    if (this.active) this.pending = equalColors(target, this.to) ? null : target;
    else if (!equalColors(target, this.current)) this.begin(target);
    if (reducedMotion) this.settle();
    return this.active;
  }

  begin(target) {
    this.from.forEach((color, i) => color.copy(this.current[i]));
    this.to.forEach((color, i) => color.copy(target[i]));
    this.progress = 0; this.active = true; this.held = false;
    this.uniforms.garagePaintProgress.value = 0; this.uniforms.garagePaintActive.value = 1;
  }

  /** Advance finite elapsed seconds only while visible; an offscreen/reduced-motion car settles immediately. */
  advance(dt, { visible = true, reducedMotion = false } = {}) {
    if (!this.active || this.disposed) return false;
    if (!visible || reducedMotion) return this.settle();
    if (this.held || !Number.isFinite(dt) || dt <= 0) return false;
    let remaining = dt;
    // At most the active wipe and one latest pending wipe, including long background gaps.
    for (let step = 0; step < 2 && this.active && remaining > 0; step++) {
      const consumed = Math.min(remaining, (1 - this.progress) * this.duration);
      this.progress = clamp01(this.progress + consumed / this.duration); remaining -= consumed;
      this.uniforms.garagePaintProgress.value = this.progress;
      if (this.progress >= 1) {
        this.current.forEach((color, i) => color.copy(this.to[i]));
        const pending = this.pending; this.pending = null;
        if (pending && !equalColors(pending, this.current)) this.begin(pending);
        else { this.active = false; this.uniforms.garagePaintActive.value = 0; }
      }
    }
    return true;
  }

  /** Resolve to the latest saved selection without leaking an old intermediate paint into the race. */
  settle() {
    if (!this.active) return false;
    const latest = this.pending || this.to;
    this.current.forEach((color, i) => { color.copy(latest[i]); this.materials[i].color.copy(color); });
    this.pending = null; this.active = false; this.held = false; this.progress = 1;
    this.uniforms.garagePaintProgress.value = 1; this.uniforms.garagePaintActive.value = 0;
    return true;
  }

  /** Seek the real shader clock for deterministic QA. null resumes; endpoints use the same production mask. */
  setProgress(value) {
    if (value === null) { this.held = false; return this.active; }
    if (!this.active || !Number.isFinite(value)) return false;
    this.held = true; this.progress = clamp01(value); this.uniforms.garagePaintProgress.value = this.progress;
    return true;
  }

  get animating() { return this.active && !this.held; }

  /** Mirrors the shader for tests/inspection, without changing the rendered appearance. */
  colorAt(z, materialIndex = 0, target = new T.Color()) {
    if (!this.current[materialIndex]) return null;
    if (!this.active) return target.copy(this.current[materialIndex]);
    const range = this.uniforms.garagePaintRange.value;
    return target.copy(this.from[materialIndex]).lerp(this.to[materialIndex], paintCoverage(z, this.progress, range.x, range.y));
  }

  dispose() {
    if (this.disposed) return;
    this.settle(); this.disposed = true;
    for (const { material, compile, cacheKey } of this.hooks) {
      material.onBeforeCompile = compile; material.customProgramCacheKey = cacheKey; material.needsUpdate = true;
    }
    this.hooks.length = 0;
  }
}
