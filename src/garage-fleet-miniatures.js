import * as T from '../public/vendor/three.js';

const IDLE_YAW = -.58;
const HOVER_TURN = .86;
const TURN_SECONDS = .85;
const FRAME_SECONDS = 1 / 12;
const PITCH = .31;
const MAX_MODELS = 5;

/** Stable saved-loadout identity: property insertion order must not rebuild a car. */
function appearanceKey(value) {
  return JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Measure actual visible authored mesh bounds, in metres. Hidden optional parts
 * must not make a stock car smaller. Never compute/dispose shared geometry.
 */
export function fleetVehicleBounds(vehicle) {
  vehicle.updateMatrixWorld(true);
  const bounds = new T.Box3(), local = new T.Box3(), point = new T.Vector3();
  vehicle.traverseVisible(node => {
    if (!node.isMesh || !node.geometry?.attributes.position) return;
    local.makeEmpty();
    const position = node.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      node.getVertexPosition(i, point);
      local.expandByPoint(point.applyMatrix4(node.matrixWorld));
    }
    bounds.union(local);
  });
  if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) {
    throw new TypeError('A fleet miniature needs visible authored vehicle geometry');
  }
  return bounds;
}

/**
 * Orthographic studio fit contains the complete real bounds at every yaw, not
 * just the initial angle. Aspect is width/height; no source geometry is scaled.
 */
export function fitFleetCamera(camera, bounds, aspect) {
  const half = bounds.getSize(new T.Vector3()).multiplyScalar(.5);
  const radius = Math.max(.01, Math.hypot(half.x, half.z));
  const vertical = radius * Math.sin(PITCH) + half.y * Math.cos(PITCH);
  const top = Math.max(vertical, radius / aspect) * 1.08;
  const distance = Math.max(8, bounds.getSize(new T.Vector3()).length() * 2);
  Object.assign(camera, { left: -top * aspect, right: top * aspect, top, bottom: -top, near: .05, far: distance * 2 });
  camera.position.set(0, Math.sin(PITCH) * distance, -Math.cos(PITCH) * distance);
  camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return camera;
}

/** Release only the factory's explicitly owned materials, never shared GLB meshes/maps. */
function releaseVehicle(record) {
  record.pivot?.removeFromParent();
  for (const material of new Set(record.vehicle?.userData.ownedAppearanceMaterials || [])) material.dispose();
  record.vehicle = record.pivot = null;
}

/** Save every renderer option changed below, including the active cube face/mip. */
function captureRenderer(renderer) {
  return {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace?.() || 0, mip: renderer.getActiveMipmapLevel?.() || 0,
    viewport: renderer.getViewport(new T.Vector4()).clone(), scissor: renderer.getScissor(new T.Vector4()).clone(),
    scissorTest: renderer.getScissorTest(), clearColor: renderer.getClearColor(new T.Color()).clone(), clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear, autoClearColor: renderer.autoClearColor, autoClearDepth: renderer.autoClearDepth, autoClearStencil: renderer.autoClearStencil,
    xrEnabled: renderer.xr?.enabled, shadowAutoUpdate: renderer.shadowMap?.autoUpdate, shadowNeedsUpdate: renderer.shadowMap?.needsUpdate,
  };
}

function restoreRenderer(renderer, saved) {
  // Three getters expose default definitions, while binding a target applies
  // its own pixel viewport/scissor. Restore defaults first, then that binding.
  renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.scissorTest);
  renderer.setRenderTarget(saved.target, saved.face, saved.mip);
  renderer.setClearColor(saved.clearColor, saved.clearAlpha);
  for (const key of ['autoClear', 'autoClearColor', 'autoClearDepth', 'autoClearStencil']) renderer[key] = saved[key];
  if (renderer.xr) renderer.xr.enabled = saved.xrEnabled;
  if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = saved.shadowAutoUpdate; renderer.shadowMap.needsUpdate = saved.shadowNeedsUpdate; }
}

/**
 * Live exact-model fleet cards on the game's existing WebGLRenderer. Two small
 * shared targets (HDR/MSAA scene and byte/sRGB readback) serve at most five cards.
 * The global 12-fps logical budget includes one vehicle pass plus one triangle
 * tone-map pass per frame. Canvas2D only presents GPU pixels; cars really turn in the 3D scene.
 * Stable idle/settled hover has no render work. No RAF or WebGL context is owned.
 */
export class FleetMiniatures {
  /** maxWidth/maxHeight are pixel budgets, independent of DPR. environment is borrowed. */
  constructor({ renderer, makeVehicle, environment = null, onChange = () => {}, maxWidth = 320, maxHeight = 180 }) {
    this.renderer = renderer; this.makeVehicle = makeVehicle; this.onChange = onChange;
    this.width = Math.max(16, Math.min(320, Math.floor(maxWidth) || 320));
    this.height = Math.max(16, Math.min(180, Math.floor(maxHeight) || 180));
    this.scene = new T.Scene(); this.scene.environment = environment; this.scene.environmentIntensity = .65;
    this.scene.add(new T.HemisphereLight('#eff6ff', '#534637', 1.35));
    const key = new T.DirectionalLight('#fff3df', 2.6); key.position.set(-4, 6, -4);
    const rim = new T.DirectionalLight('#b2d8ff', 1.6); rim.position.set(4, 3, 4); this.scene.add(key, rim);
    this.camera = new T.OrthographicCamera(); this.records = new Map(); this.activeId = null; this.returningId = null; this.lastRenderedId = null;
    this.target = null; this.sceneTarget = null; this.toneScene = null; this.toneMaterial = null; this.toneGeometry = null; this.pending = null; this.epoch = 0; this.scopeKey = undefined;
    this.elapsed = FRAME_SECONDS; this.visible = true; this.paused = false; this.reducedMotion = false;
    this.disposed = false; this.contextLost = false; this.asyncReadback = true;
    this.onContextLost = () => { this.contextLost = true; this.epoch++; };
    this.onContextRestored = () => this.restoreContext();
    renderer.domElement?.addEventListener('webglcontextlost', this.onContextLost);
    renderer.domElement?.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  /**
   * Reconcile visible DOM targets and immutable saved cosmetics. Offscreen records
   * stay lazy; a replacement canvas receives cached pixels without a GL render.
   * scopeKey may be profile ID plus replacement epoch to reject account rollbacks.
   */
  sync(targets, { scopeKey = this.scopeKey } = {}) {
    if (this.disposed) return;
    if (scopeKey !== this.scopeKey) {
      this.scopeKey = scopeKey; this.epoch++; this.activeId = null; this.returningId = null;
      for (const record of this.records.values()) releaseVehicle(record);
      this.records.clear();
    }
    const next = new Map();
    for (const item of (targets || []).slice(0, MAX_MODELS)) {
      if (!item?.id || !item.canvas || next.has(item.id)) continue;
      const key = appearanceKey(item.appearance); let record = this.records.get(item.id);
      if (record && record.key !== key) { releaseVehicle(record); record = null; }
      if (!record) record = { id: item.id, key, appearance: { ...item.appearance }, canvas: null, version: 0, revision: 0, vehicle: null,
        pivot: null, bounds: null, pixels: null, dirty: true, failed: false, yaw: IDLE_YAW, turnFrom: IDLE_YAW, turnTarget: IDLE_YAW, turnTime: TURN_SECONDS };
      const changedCanvas = record.canvas !== item.canvas;
      if (changedCanvas) { record.canvas = item.canvas; record.version++; if (!record.pixels) record.dirty = true; }
      const wasVisible = record.visible; record.visible = item.visible !== false;
      next.set(item.id, record);
      if (changedCanvas && record.failed && record.visible) this.onChange({ id: record.id, canvas: record.canvas, status: 'error', error: record.error });
      else if (changedCanvas && record.pixels && record.visible) this.present(record);
      else if (!wasVisible && record.visible && record.pixels) this.present(record);
    }
    for (const [id, record] of this.records) if (!next.has(id)) releaseVehicle(record);
    this.records = next;
    if (!next.has(this.activeId)) this.activeId = null;
    if (!next.has(this.returningId)) this.returningId = null;
  }

  /** One hovered group and, at most, its predecessor ease finitely; no perpetual turntable. */
  setInteraction(id) {
    if (this.disposed || id === this.activeId) return;
    const nextId = this.records.has(id) ? id : null;
    const returning = this.records.get(this.returningId);
    if (returning && this.returningId !== nextId) {
      returning.yaw = IDLE_YAW; returning.turnTime = TURN_SECONDS; returning.revision++; returning.dirty = true;
    }
    this.returningId = null;
    const previous = this.records.get(this.activeId);
    if (previous && previous.yaw !== IDLE_YAW) {
      previous.turnFrom = previous.yaw; previous.turnTarget = IDLE_YAW; previous.turnTime = 0;
      this.returningId = previous.id;
    }
    this.activeId = nextId;
    const next = this.records.get(this.activeId);
    if (next && !this.reducedMotion) {
      next.turnFrom = next.yaw; next.turnTarget = IDLE_YAW + HOVER_TURN; next.turnTime = 0;
    }
  }

  /** Borrow a new studio reflection without ever disposing the game's environment. */
  setEnvironment(environment) {
    if (this.scene.environment === environment) return;
    this.scene.environment = environment;
    for (const record of this.records.values()) { record.dirty = true; record.revision++; }
  }

  /**
   * Advance seconds from the existing frame loop. Paused, hidden and offscreen
   * cards neither build models nor draw. Reduced motion keeps the real idle model.
   * Returns true only if one render/readback was issued, never schedules itself.
   */
  update(dt, { visible = true, paused = false, reducedMotion = false } = {}) {
    if (this.disposed) return false;
    this.visible = visible; this.paused = paused;
    if (reducedMotion !== this.reducedMotion) {
      this.reducedMotion = reducedMotion;
      if (reducedMotion) for (const record of this.records.values()) {
        if (record.yaw !== IDLE_YAW) { record.yaw = IDLE_YAW; record.revision++; record.dirty = true; }
        record.turnTarget = IDLE_YAW; record.turnTime = TURN_SECONDS;
      }
    }
    if (!visible || paused || this.contextLost) return false;
    const seconds = Math.max(0, Math.min(.1, Number(dt) || 0));
    this.elapsed = Math.min(FRAME_SECONDS, this.elapsed + seconds);
    const active = this.records.get(this.activeId), returning = this.records.get(this.returningId);
    for (const record of [active, returning]) if (record?.visible && !reducedMotion && record.turnTime < TURN_SECONDS) {
      record.turnTime = Math.min(TURN_SECONDS, record.turnTime + seconds);
      const t = record.turnTime / TURN_SECONDS, ease = t * t * (3 - 2 * t);
      record.yaw = record.turnFrom + (record.turnTarget - record.turnFrom) * ease;
      record.revision++; record.dirty = true;
    }
    if (this.pending || this.elapsed + 1e-9 < FRAME_SECONDS) return false;
    // A blank newly visible card takes precedence over extra animation frames.
    const eligible = record => record.visible && record.canvas?.isConnected !== false && record.dirty && !record.failed;
    let first = null, blank = null;
    for (const record of this.records.values()) if (eligible(record)) {
      first ||= record;
      if (!record.pixels) { blank = record; break; }
    }
    const activeReady = active && eligible(active), returningReady = returning && eligible(returning);
    const animated = activeReady && returningReady ? (this.lastRenderedId === active.id ? returning : active) :
      activeReady ? active : returningReady ? returning : null;
    const record = blank || animated || first;
    if (!record) return false;
    this.elapsed = 0; this.lastRenderedId = record.id; this.draw(record); return true;
  }

  /** Build only the requested authored clone, keeping source transforms and scale intact. */
  prepare(record) {
    if (record.vehicle) return;
    const vehicle = this.makeVehicle(record.id, { ...record.appearance });
    if (!vehicle?.isObject3D) throw new TypeError('The fleet needs an actual prepared vehicle');
    record.vehicle = vehicle;
    record.bounds = fleetVehicleBounds(vehicle);
    const center = record.bounds.getCenter(new T.Vector3()), centered = new T.Group();
    centered.position.copy(center).multiplyScalar(-1); centered.add(vehicle);
    record.pivot = new T.Group(); record.pivot.add(centered);
  }

  /**
   * Two bounded shared targets preserve HDR paint/reflection detail. The real
   * vehicle is rendered in linear half-float, then explicitly ACES tone-mapped:
   * Three intentionally omits tone mapping on normal render targets. The byte
   * sRGB attachment encodes once in hardware; the shader must not apply an OETF.
   */
  ensureTarget() {
    if (this.renderer.extensions?.has && !this.renderer.extensions.has('EXT_color_buffer_float') &&
        !this.renderer.extensions.has('EXT_color_buffer_half_float')) {
      throw new Error('HDR miniature preview unavailable on this graphics device');
    }
    if (!this.sceneTarget) {
      this.sceneTarget = new T.WebGLRenderTarget(this.width, this.height, {
        type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter,
        depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
        samples: Math.min(4, this.renderer.capabilities?.maxSamples || 0),
      });
      this.sceneTarget.texture.name = 'garage-live-fleet-hdr';
      this.sceneTarget.texture.colorSpace = T.LinearSRGBColorSpace;
    }
    if (!this.target) {
      this.target = new T.WebGLRenderTarget(this.width, this.height, {
        type: T.UnsignedByteType, minFilter: T.LinearFilter, magFilter: T.LinearFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false, samples: 0,
      });
      this.target.texture.name = 'garage-live-fleet-miniature';
      this.target.texture.colorSpace = T.SRGBColorSpace;
    }
    if (!this.toneScene) {
      this.toneGeometry = new T.BufferGeometry();
      this.toneGeometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      this.toneMaterial = new T.ShaderMaterial({
        name: 'garage-fleet-aces-presentation', depthTest: false, depthWrite: false, blending: T.NoBlending, toneMapped: false,
        uniforms: { fleetLinear: { value: this.sceneTarget.texture }, toneMappingExposure: { value: 1 } },
        vertexShader: `varying vec2 vFleetUv;
          void main() { vFleetUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`,
        fragmentShader: `uniform sampler2D fleetLinear;
          varying vec2 vFleetUv;
          ${T.ShaderChunk.tonemapping_pars_fragment}
          void main() {
            vec4 linear = texture2D(fleetLinear, vFleetUv);
            // Blending/MSAA produce premultiplied edge colours. Canvas ImageData
            // needs straight-alpha colour; unpremultiply before the nonlinear map.
            vec3 straight = linear.a > 0.00001 ? linear.rgb / linear.a : vec3(0.);
            gl_FragColor = vec4(ACESFilmicToneMapping(straight), linear.a);
          }`,
      });
      this.toneScene = new T.Scene();
      const triangle = new T.Mesh(this.toneGeometry, this.toneMaterial); triangle.frustumCulled = false;
      this.toneScene.add(triangle);
    }
    this.toneMaterial.uniforms.fleetLinear.value = this.sceneTarget.texture;
  }

  /** Release only this module's two targets and fullscreen triangle resources. */
  releaseTargets() {
    this.target?.dispose(); this.target = null;
    this.sceneTarget?.dispose(); this.sceneTarget = null;
    this.toneGeometry?.dispose(); this.toneGeometry = null;
    this.toneMaterial?.dispose(); this.toneMaterial = null;
    this.toneScene?.clear(); this.toneScene = null;
  }

  /** Renderer mutation is synchronous and protected even when render/readback throws. */
  draw(record) {
    const owner = { record, canvas: record.canvas, version: record.version, revision: record.revision, epoch: this.epoch };
    let saved, result, failure;
    try {
      this.prepare(record); this.ensureTarget();
      record.pivot.rotation.y = record.yaw; this.scene.add(record.pivot);
      fitFleetCamera(this.camera, record.bounds, this.width / this.height);
      const renderer = this.renderer; saved = captureRenderer(renderer);
      renderer.autoClear = true; renderer.autoClearColor = true; renderer.autoClearDepth = true; renderer.autoClearStencil = true;
      if (renderer.xr) renderer.xr.enabled = false;
      if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }
      // Target-owned viewports are pixels; setViewport() would multiply by the
      // main renderer DPR and crop this bounded offscreen frame on retina screens.
      renderer.setRenderTarget(this.sceneTarget);
      renderer.setScissorTest(false); renderer.setClearColor(0, 0); renderer.clear(true, true, true);
      renderer.render(this.scene, this.camera);
      this.toneMaterial.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(this.target);
      renderer.render(this.toneScene, this.camera);
      const bytes = new Uint8Array(this.width * this.height * 4);
      owner.bytes = bytes;
      if (this.asyncReadback && renderer.readRenderTargetPixelsAsync) {
        result = renderer.readRenderTargetPixelsAsync(this.target, 0, 0, this.width, this.height, bytes);
      } else {
        renderer.readRenderTargetPixels(this.target, 0, 0, this.width, this.height, bytes);
      }
      record.dirty = false;
    } catch (error) {
      failure = error;
    } finally {
      record.pivot?.removeFromParent();
      if (saved) restoreRenderer(this.renderer, saved);
    }
    if (failure) { this.fail(owner, failure); return; }
    if (result?.then) {
      this.pending = owner;
      Promise.resolve(result).then(() => this.complete(owner), error => {
        // A supported synchronous read is a bounded fallback, attempted on the
        // next frame rather than blindly repeating the asynchronous operation.
        if (this.current(owner) && this.asyncReadback && this.renderer.readRenderTargetPixels) {
          this.asyncReadback = false; record.dirty = true;
        } else this.fail(owner, error);
      }).finally(() => { if (this.pending === owner) this.pending = null; });
    } else this.complete(owner);
  }

  current(owner) {
    return !this.disposed && !this.contextLost && owner.epoch === this.epoch &&
      this.records.get(owner.record.id) === owner.record && owner.record.version === owner.version && owner.record.canvas === owner.canvas;
  }

  /** Flip the GPU origin once, retain one bounded pixel cache, reject stale DOM/profile work. */
  complete(owner) {
    if (!this.current(owner)) { if (this.records.get(owner.record.id) === owner.record) owner.record.dirty = true; return; }
    const record = owner.record;
    if (!this.visible || this.paused || !record.visible || record.canvas.isConnected === false) { record.dirty = true; return; }
    const pixels = new Uint8ClampedArray(owner.bytes.length), stride = this.width * 4;
    for (let y = 0; y < this.height; y++) pixels.set(owner.bytes.subarray((this.height - 1 - y) * stride, (this.height - y) * stride), y * stride);
    record.pixels = pixels;
    if (record.revision !== owner.revision) record.dirty = true;
    this.present(record);
  }

  present(record, notify = true) {
    try {
      const canvas = record.canvas, context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Canvas2D unavailable for live miniature');
      if (canvas.width !== this.width) canvas.width = this.width;
      if (canvas.height !== this.height) canvas.height = this.height;
      const image = context.createImageData(this.width, this.height); image.data.set(record.pixels);
      context.putImageData(image, 0, 0);
      if (notify) this.onChange({ id: record.id, canvas, status: 'ready' });
    } catch (error) { this.fail({ record, canvas: record.canvas, version: record.version, epoch: this.epoch }, error); }
  }

  /** Errors remain stable until changed data or context restoration, never a busy retry loop. */
  fail(owner, error) {
    if (!this.current(owner)) return;
    owner.record.failed = true; owner.record.dirty = false; owner.record.error = String(error?.message || error);
    this.onChange({ id: owner.record.id, canvas: owner.canvas, status: 'error', error: owner.record.error });
  }

  /** Restored GPU invalidates snapshots but keeps authored clones and borrowed source assets. */
  restoreContext() {
    if (this.disposed) return;
    this.contextLost = false; this.epoch++; this.pending = null; this.releaseTargets();
    this.asyncReadback = true; this.elapsed = FRAME_SECONDS;
    for (const record of this.records.values()) { record.dirty = true; record.failed = false; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.epoch++; this.activeId = null; this.returningId = null;
    this.renderer.domElement?.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement?.removeEventListener('webglcontextrestored', this.onContextRestored);
    for (const record of this.records.values()) releaseVehicle(record);
    this.records.clear(); this.scene.environment = null;
    this.releaseTargets();
  }
}
