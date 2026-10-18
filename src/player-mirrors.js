import * as T from '../public/vendor/three.js';

const ROLES = ['left', 'right', 'center'];
const EPSILON = 1e-6;
const BIAS = new T.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
const VERTEX = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 mirrorUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    mirrorUv = textureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const FRAGMENT = /* glsl */`
  uniform sampler2D reflection;
  varying vec4 mirrorUv;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 reflected = texture2DProj(reflection, mirrorUv).rgb;
    gl_FragColor = vec4(reflected * vec3(.88, .91, .94), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Return the exact Euclidean reflection across a normalized world-space plane. */
export function mirrorReflectionMatrix(plane, target = new T.Matrix4()) {
  const { x, y, z } = plane.normal, d = plane.constant;
  return target.set(
    1 - 2*x*x, -2*x*y, -2*x*z, -2*d*x,
    -2*y*x, 1 - 2*y*y, -2*y*z, -2*d*y,
    -2*z*x, -2*z*y, 1 - 2*z*z, -2*d*z,
    0, 0, 0, 1,
  );
}

/** Allocate reusable math for one pane; no render targets or scene changes. */
export function createPlanarMirrorCamera() {
  return {
    camera: new T.PerspectiveCamera(), textureMatrix: new T.Matrix4(), reflectionMatrix: new T.Matrix4(),
    baseProjection: new T.Matrix4(), plane: new T.Plane(), eye: new T.Vector3(), direction: new T.Vector3(),
    up: new T.Vector3(), target: new T.Vector3(), corner: new T.Vector3(), clip: new T.Vector4(), q: new T.Vector4(),
  };
}

/**
 * Reflect the real eye, forward and up across the actual pane, then fit an
 * off-axis frustum to its corners. The right-handed lookAt camera and projective
 * sampling together produce mirror handedness, with no arbitrary texture flip.
 * The oblique near plane keeps only geometry on the viewer's side of the pane.
 * This is the same planar technique as Three.js Reflector, with a tight frustum
 * so a small car mirror does not waste its texture on the whole main viewport.
 * @param {T.PerspectiveCamera} real - Current main camera, in or outside the cabin.
 * @param {T.Plane} plane - Normalized world plane, normal towards reflective face.
 * @param {T.Vector3[]} corners - Bounds on the actual pane, in world coordinates.
 * @param {object} out - Reusable state from createPlanarMirrorCamera.
 * @returns {boolean} False for a back-facing, degenerate or invalid projection.
 */
export function updatePlanarMirrorCamera(real, plane, corners, out) {
  if (!real?.isPerspectiveCamera || corners.length < 3) return false;
  real.updateWorldMatrix(true, false);
  const { camera, eye, direction, up, target, corner, clip, q } = out;
  eye.setFromMatrixPosition(real.matrixWorld);
  if (plane.distanceToPoint(eye) <= .001) return false;
  mirrorReflectionMatrix(plane, out.reflectionMatrix);
  camera.position.copy(eye).applyMatrix4(out.reflectionMatrix);
  real.getWorldDirection(direction).reflect(plane.normal);
  up.setFromMatrixColumn(real.matrixWorld, 1).normalize().reflect(plane.normal);
  camera.up.copy(up); camera.lookAt(target.copy(camera.position).add(direction));
  camera.near = Math.max(.005, Math.min(.1, real.near));
  camera.far = Math.max(camera.near + 1, Math.min(real.far, 400));
  camera.layers.mask = real.layers.mask;
  camera.updateMatrixWorld(true);
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const point of corners) {
    corner.copy(point).applyMatrix4(camera.matrixWorldInverse);
    if (corner.z >= -EPSILON || !Number.isFinite(corner.lengthSq())) return false;
    const scale = camera.near / -corner.z;
    left = Math.min(left, corner.x*scale); right = Math.max(right, corner.x*scale);
    bottom = Math.min(bottom, corner.y*scale); top = Math.max(top, corner.y*scale);
  }
  if (right - left <= EPSILON || top - bottom <= EPSILON) return false;
  // A two-percent guard avoids edge sampling seams without diluting the image.
  const padX = (right-left)*.02, padY = (top-bottom)*.02;
  camera.projectionMatrix.makePerspective(left-padX, right+padX, top+padY, bottom-padY, camera.near, camera.far);
  out.baseProjection.copy(camera.projectionMatrix);
  out.textureMatrix.copy(BIAS).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);

  out.plane.copy(plane);
  // Only a millimetre of bias; do not erase the real car, mirror casing or road.
  out.plane.constant -= .001;
  out.plane.applyMatrix4(camera.matrixWorldInverse);
  clip.set(out.plane.normal.x, out.plane.normal.y, out.plane.normal.z, out.plane.constant);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  q.set(Math.sign(clip.x), Math.sign(clip.y), 1, 1).applyMatrix4(camera.projectionMatrixInverse);
  const denominator = clip.dot(q);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) return false;
  clip.multiplyScalar(2 / denominator);
  const e = camera.projectionMatrix.elements;
  e[2] = clip.x-e[3]; e[6] = clip.y-e[7]; e[10] = clip.z-e[11]; e[14] = clip.w-e[15];
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return true;
}

/**
 * Read a genuinely flat mesh, never replace a housing or guess a rear camera.
 * Optional glTF extras mirrorPlane={point:[x,y,z],normal:[x,y,z]} are mesh-local.
 * With no extras, winding supplies the normal and actual vertices supply bounds.
 */
function paneGeometry(mesh) {
  const positions = mesh.geometry?.attributes.position;
  if (!positions || positions.count < 3 || Array.isArray(mesh.material)) return null;
  const indices = mesh.geometry.index, a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const normal = new T.Vector3(), tangent = new T.Vector3();
  for (let index = 0; index + 2 < (indices?.count ?? positions.count); index += 3) {
    a.fromBufferAttribute(positions, indices ? indices.getX(index) : index);
    b.fromBufferAttribute(positions, indices ? indices.getX(index+1) : index+1);
    c.fromBufferAttribute(positions, indices ? indices.getX(index+2) : index+2);
    tangent.subVectors(b, a); normal.crossVectors(tangent, c.sub(a));
    if (normal.lengthSq() > 1e-14) break;
  }
  if (normal.lengthSq() <= 1e-14) return null;
  normal.normalize(); tangent.normalize();
  const metadata = mesh.userData.mirrorPlane;
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (metadata) {
    if (!vector(metadata.point) || !vector(metadata.normal)) return null;
    const authoredNormal = new T.Vector3(...metadata.normal);
    if (authoredNormal.lengthSq() < EPSILON || authoredNormal.normalize().dot(normal) < .999) return null;
    a.set(...metadata.point); normal.copy(authoredNormal);
  }
  const plane = new T.Plane().setFromNormalAndCoplanarPoint(normal, a);
  const bitangent = new T.Vector3().crossVectors(normal, tangent).normalize();
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, error = 0;
  for (let index = 0; index < positions.count; index++) {
    b.fromBufferAttribute(positions, index);
    if (!Number.isFinite(b.lengthSq())) return null;
    error = Math.max(error, Math.abs(plane.distanceToPoint(b)));
    c.copy(b).sub(a);
    const u = c.dot(tangent), v = c.dot(bitangent);
    minU = Math.min(minU,u); maxU = Math.max(maxU,u); minV = Math.min(minV,v); maxV = Math.max(maxV,v);
  }
  const size = Math.hypot(maxU-minU,maxV-minV);
  if (!Number.isFinite(size) || size < .001 || error > Math.max(.00001,size*.0001)) return null;
  const corners = [[minU,minV],[maxU,minV],[maxU,maxV],[minU,maxV]].map(([u,v]) => a.clone().addScaledVector(tangent,u).addScaledVector(bitangent,v));
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  return { plane, corners, sphere: mesh.geometry.boundingSphere.clone(), maxPlaneError: error };
}

/** Return bounded physical texture size and cadence, independent of display DPR. */
export function playerMirrorBudget({ compact = false, reducedMotion = false, quality = 'auto' } = {}) {
  const width = compact ? 256 : quality === 'high' || quality === 'ultra' ? 512 : 384;
  return { width, height: width/2, hz: compact || reducedMotion ? 10 : 15, maxPanes: 3 };
}

/** Keep parent visibility, helpers and actual reflection surfaces out of recursive passes. */
function visibleInHierarchy(node) {
  for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return false;
  return true;
}
function mirrorRole(node) {
  const role = node.userData?.mirrorRole;
  if (ROLES.includes(role)) return role;
  return /^(?:detail_mirror_|player_mirror_)(left|right|center|cabin)(?:_pane)?$/.exec(node.name)?.[1]?.replace('cabin','center');
}

/**
 * The explicitly requested right camera is not a planar mirror. Its sensor is
 * mounted 5 mm outside the existing pod face and has a fixed rear-right lens,
 * following the complete sprung-body pose. No target traffic position is used.
 */
function updateRightCamera(entry, layers) {
  const { camera, eye, direction, up, target, plane, clip, q } = entry.view;
  const matrix = entry.anchor.matrixWorld;
  eye.copy(entry.anchorPoint).applyMatrix4(matrix);
  up.copy(entry.anchorNormal).applyNormalMatrix(entry.normalMatrix.getNormalMatrix(matrix)).normalize();
  camera.position.copy(eye).addScaledVector(up,.005);
  direction.set(.20,-.015,1).transformDirection(matrix);
  camera.up.set(0,1,0).transformDirection(matrix);
  camera.lookAt(target.copy(camera.position).add(direction));
  camera.layers.mask = layers;
  camera.fov = 36; camera.aspect = 2; camera.near = .04; camera.far = 160;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  // Clip all geometry ahead of the physical sensor in body-local Z, as well
  // as the ordinary perspective frustum. Do not hide the tank or car body.
  up.set(0,0,1).transformDirection(matrix);
  target.copy(camera.position).addScaledVector(up,.04);
  plane.setFromNormalAndCoplanarPoint(up,target).applyMatrix4(camera.matrixWorldInverse);
  clip.set(plane.normal.x,plane.normal.y,plane.normal.z,plane.constant);
  q.set(Math.sign(clip.x),Math.sign(clip.y),1,1).applyMatrix4(camera.projectionMatrixInverse);
  const denominator=clip.dot(q);
  if (!Number.isFinite(denominator)||Math.abs(denominator)<EPSILON) return false;
  clip.multiplyScalar(2/denominator);
  const e=camera.projectionMatrix.elements;
  e[2]=clip.x-e[3];e[6]=clip.y-e[7];e[10]=clip.z-e[11];e[14]=clip.w-e[15];
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return true;
}

/**
 * Own the player's three planar mirrors only. No geometry or shared materials
 * are changed. Offscreen/backfacing/lost-context panes retain their authored
 * environment material, which is explicitly a non-live fallback. Visible panes
 * cost up to three additional scene renders at 15 Hz desktop or 10 Hz compact;
 * they reuse main shadows, exclude helpers/UI and never render other mirrors.
 * In cockpit, the requested right-pod camera replaces the vessel-obscured right
 * pane pass, and only updates while the dedicated right display is in view.
 * It is not a planar mirror. At most three captures run per refresh in either
 * cockpit or external mode; the external right pane remains a real reflection.
 * The physical apertures are intentionally not magnified: the 53×14 mm side
 * panes show only a narrow slice of traffic, unlike the wider digital screen.
 * @returns {{update:function,invalidate:function,dispose:function,diagnostics:object,rightCameraTexture:T.Texture|null}}
 */
export function createPlayerMirrors(renderer, scene, player, { compact = false, reducedMotion = false, onContextChange = null } = {}) {
  const entries = [], roles = new Set(), rejected = [];
  let budget = playerMirrorBudget({compact,reducedMotion}), disposed = false, contextLost = false;
  let totalPasses = 0, failedPasses = 0, shadowFallbackPasses = 0, lastError = null, previousMode;
  const frustum = new T.Frustum(), viewProjection = new T.Matrix4(), eye = new T.Vector3(), sphere = new T.Sphere();
  const lastCamera = new T.Matrix4(), lastProjection = new T.Matrix4();
  let hasCamera = false;
  const canvas = renderer?.domElement;
  // The game's rear road ends at 80 m. Fade only the extra rear passes before
  // that boundary; this is intentionally bounded visibility, not infinite road.
  const rearFog = scene?.fog?.color ? new T.Fog(scene.fog.color,42,78) : null;
  let rightCamera = null;

  /** Render targets have no mip generation, MSAA or DPR amplification. */
  function makeTarget(name = 'player-planar-mirror') {
    const target = new T.WebGLRenderTarget(budget.width,budget.height, {
      type: T.UnsignedByteType, minFilter: T.LinearFilter, magFilter: T.LinearFilter,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false, samples: 0,
    });
    target.texture.name = name;
    return target;
  }
  if (renderer?.render && scene?.isScene && player?.isObject3D) player.traverse(mesh => {
    const role = mirrorRole(mesh);
    if (!mesh.isMesh || !role || roles.has(role)) return;
    const geometry = paneGeometry(mesh);
    if (!geometry) { rejected.push(mesh.name); return; }
    roles.add(role);
    const view = createPlanarMirrorCamera(), target = makeTarget();
    view.camera.name = 'player-mirror-'+role;
    const material = new T.ShaderMaterial({
      name: 'player-live-mirror-'+role, side: T.FrontSide, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: { reflection: {value:target.texture}, textureMatrix:{value:view.textureMatrix} },
    });
    entries.push({ mesh, role, geometry, original:mesh.material, material, target, view,
      worldPlane:new T.Plane(), worldCorners:geometry.corners.map(point=>point.clone()),
      elapsed:1, dirty:true, hasFrame:false, active:false, passes:0, errors:0, reason:'not-yet-rendered' });
  });

  const rightPane = entries.find(entry=>entry.role==='right');
  const screen = player?.getObjectByName?.('detail_right_rear_display');
  const screenGeometry = screen?.isMesh ? paneGeometry(screen) : null;
  if (rightPane && screenGeometry) {
    const anchorPoint = rightPane.geometry.corners.reduce((sum,point)=>sum.add(point),new T.Vector3()).multiplyScalar(1/rightPane.geometry.corners.length);
    rightCamera = {
      anchor:rightPane.mesh, anchorPoint, anchorNormal:rightPane.geometry.plane.normal.clone(), normalMatrix:new T.Matrix3(),
      screen, screenGeometry, screenPlane:new T.Plane(), view:createPlanarMirrorCamera(), target:makeTarget('player-right-rear-camera'),
      elapsed:1,dirty:true,hasFrame:false,active:false,passes:0,errors:0,reason:'not-yet-rendered',
    };
    rightCamera.view.camera.name='player-right-rear-camera';
  }
  const resources = rightCamera ? [...entries,rightCamera] : entries;

  function fallback(entry, reason) {
    if (entry.mesh && entry.mesh.material === entry.material) entry.mesh.material = entry.original;
    entry.active = false; entry.reason = reason;
  }
  function invalidate() {
    if (!disposed) for (const entry of resources) { entry.dirty = true; entry.errors = 0; }
  }
  function onLost() {
    if (disposed || contextLost) return;
    contextLost = true;
    for (const entry of resources) {
      fallback(entry,'context-lost');
      // Retire old-context listeners/handles while that context is still lost.
      // Disposing after Three reinitializes would delete foreign native handles.
      entry.target.dispose(); entry.target = null; entry.hasFrame = false;
      if (entry.material) entry.material.uniforms.reflection.value = null;
    }
    // Wake even a settled/paused owner after the resource state is safe to read.
    if (typeof onContextChange === 'function') onContextChange();
  }
  function onRestored() {
    if (disposed || !contextLost) return;
    contextLost = false;
    for (const entry of resources) {
      entry.target = makeTarget(entry===rightCamera?'player-right-rear-camera':'player-planar-mirror');
      if (entry.material) { entry.material.uniforms.reflection.value = entry.target.texture; entry.material.needsUpdate = true; }
      entry.hasFrame = false;
    }
    invalidate();
    if (typeof onContextChange === 'function') onContextChange();
  }
  canvas?.addEventListener?.('webglcontextlost',onLost);
  canvas?.addEventListener?.('webglcontextrestored',onRestored);

  /** Render one pass with a finally block restoring renderer and scene state. */
  function renderEntry(entry) {
    const hidden = [], unavailableShadows = [], previousTarget = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace?.() ?? 0, mip = renderer.getActiveMipmapLevel?.() ?? 0;
    const viewport = renderer.getViewport?.(new T.Vector4()), scissor = renderer.getScissor?.(new T.Vector4());
    const scissorTest = renderer.getScissorTest?.();
    const xr = renderer.xr?.enabled, shadowEnabled = renderer.shadowMap?.enabled;
    const shadowAuto = renderer.shadowMap?.autoUpdate, shadowNeeds = renderer.shadowMap?.needsUpdate;
    const previousFog = scene.fog;
    try {
      scene.traverse(node => {
        if (node.visible && (node===rightCamera?.screen || mirrorRole(node) || node.isReflector || /Helper$/.test(node.type)
          || node.userData?.excludeFromMirrors === true || node.userData?.isUI === true)) {
          hidden.push(node); node.visible = false;
        }
        if (shadowEnabled && node.isLight && node.castShadow && visibleInHierarchy(node) && node.layers.test(entry.view.camera.layers)) {
          const map = node.shadow?.map, texture = map?.depthTexture || map?.texture;
          // A target object may survive context loss while its GPU allocation
          // does not. The pinned Three renderer exposes that resource registry.
          const gpuReady = !renderer.properties?.get || Boolean(texture && renderer.properties.get(texture).__webglTexture);
          if (!texture || !gpuReady) {
            unavailableShadows.push(node); node.castShadow = false;
          }
        }
      });
      // Three r183's null shadow-array fallback is not a usable depth-comparison
      // texture. Suppress only unavailable lights' shadow sampling until the
      // ordinary main pass initializes their maps. Changing the light count also
      // selects the correct shader variant; toggling enabled alone would not.
      // Existing ready maps stay in use, with no additional shadow render.
      if (renderer.xr) renderer.xr.enabled = false;
      if (renderer.shadowMap) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; }
      if (rearFog && previousFog?.color) { rearFog.color.copy(previousFog.color); scene.fog=rearFog; }
      renderer.setRenderTarget(entry.target);
      renderer.setViewport?.(0,0,budget.width,budget.height); renderer.setScissorTest?.(false);
      renderer.state?.buffers?.depth?.setMask(true);
      // Explicit clear also handles autoClear=false in the main renderer.
      renderer.clear(true,true,true);
      renderer.render(scene,entry.view.camera);
      entry.passes++; totalPasses++;
      if (unavailableShadows.length) shadowFallbackPasses++;
      entry.hasFrame = true; entry.dirty = false; entry.elapsed = 0; entry.errors = 0;
      if (entry.mesh) entry.mesh.material = entry.material;
      entry.active = true; entry.reason = 'live';
    } catch (error) {
      entry.errors++; failedPasses++; lastError = String(error?.message || error);
      // The target was cleared before rendering and may now contain only a
      // partial frame. Never expose it as a valid cached capture after failure.
      entry.hasFrame = false;
      fallback(entry,'render-failed');
    } finally {
      for (const node of hidden) node.visible = true;
      for (const light of unavailableShadows) light.castShadow = true;
      scene.fog=previousFog;
      if (renderer.xr) renderer.xr.enabled = xr;
      if (renderer.shadowMap) { renderer.shadowMap.enabled = shadowEnabled; renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowNeeds; }
      renderer.setRenderTarget(previousTarget,cubeFace,mip);
      if (viewport) renderer.setViewport(viewport);
      if (scissor) renderer.setScissor(scissor);
      if (scissorTest !== undefined) renderer.setScissorTest(scissorTest);
    }
  }

  return {
    invalidate,
    // Scene-linear ordinary render target, not display-encoded or tone-mapped.
    // For screen panel coordinates u rightward/v downward, sample (1-u,1-v):
    // the X flip is the requested mirror-like camera presentation, exactly once.
    get rightCameraTexture() { return !disposed&&!contextLost&&rightCamera?.hasFrame?rightCamera.target.texture:null; },
    update(camera, { dt = 0, mode, paused = false, quality = 'auto', force = false, compact: currentCompact = compact } = {}) {
      if (disposed || contextLost || !camera?.isPerspectiveCamera || !entries.length) return 0;
      const nextBudget = playerMirrorBudget({compact:currentCompact,reducedMotion,quality});
      if (nextBudget.width !== budget.width) {
        budget = nextBudget;
        for (const entry of resources) { entry.target.setSize(budget.width,budget.height); entry.hasFrame = false; }
        invalidate();
      }
      if (mode !== previousMode) { previousMode = mode; invalidate(); }
      camera.updateWorldMatrix(true,false); player.updateWorldMatrix(true,true);
      const cameraChanged = !hasCamera || !lastCamera.equals(camera.matrixWorld) || !lastProjection.equals(camera.projectionMatrix);
      lastCamera.copy(camera.matrixWorld); lastProjection.copy(camera.projectionMatrix); hasCamera = true;
      eye.setFromMatrixPosition(camera.matrixWorld);
      viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      const step = paused ? 0 : Number.isFinite(dt) ? Math.max(0,Math.min(.25,dt)) : 0;
      const before = totalPasses;
      for (const entry of entries) {
        entry.elapsed = Math.min(1/budget.hz,entry.elapsed+step);
        entry.worldPlane.copy(entry.geometry.plane).applyMatrix4(entry.mesh.matrixWorld);
        sphere.copy(entry.geometry.sphere).applyMatrix4(entry.mesh.matrixWorld);
        let reason = null;
        if (rightCamera && mode==='cockpit' && entry.role==='right') reason='right-camera-screen-used';
        else if (!visibleInHierarchy(entry.mesh) || !entry.mesh.layers.test(camera.layers)) reason = 'hidden';
        else if (entry.worldPlane.distanceToPoint(eye) <= .001) reason = 'backfacing';
        else if (!frustum.intersectsSphere(sphere)) reason = 'offscreen';
        else if (entry.errors >= 3 && !force) reason = 'render-failed';
        if (reason) { fallback(entry,reason); continue; }
        const immediate = force || entry.dirty || !entry.hasFrame || (paused && cameraChanged);
        if (!immediate && (!step || entry.elapsed+1e-9 < 1/budget.hz)) {
          if (entry.hasFrame) { entry.mesh.material = entry.material; entry.active = true; entry.reason = 'cached'; }
          continue;
        }
        for (let i=0;i<entry.worldCorners.length;i++) entry.worldCorners[i].copy(entry.geometry.corners[i]).applyMatrix4(entry.mesh.matrixWorld);
        if (!updatePlanarMirrorCamera(camera,entry.worldPlane,entry.worldCorners,entry.view)) { fallback(entry,'invalid-projection'); continue; }
        // Snapshot local-to-capture coordinates so skipped refreshes do not swim
        // over the pane as the sprung body moves between texture updates.
        entry.view.textureMatrix.multiply(entry.mesh.matrixWorld);
        renderEntry(entry);
      }
      if (rightCamera) {
        const entry=rightCamera;
        entry.elapsed=Math.min(1/budget.hz,entry.elapsed+step);
        entry.screenPlane.copy(entry.screenGeometry.plane).applyMatrix4(entry.screen.matrixWorld);
        sphere.copy(entry.screenGeometry.sphere).applyMatrix4(entry.screen.matrixWorld);
        let reason=null;
        if (mode!=='cockpit') reason='not-cockpit';
        else if (!visibleInHierarchy(entry.screen)||!entry.screen.layers.test(camera.layers)) reason='screen-hidden';
        else if (entry.screen.material.side!==T.DoubleSide && entry.screenPlane.distanceToPoint(eye)*(entry.screen.material.side===T.BackSide?-1:1)<=.001) reason='screen-backfacing';
        else if (!frustum.intersectsSphere(sphere)) reason='screen-offscreen';
        else if (entry.errors>=3&&!force) reason='render-failed';
        if (reason) fallback(entry,reason);
        else {
          const immediate=force||entry.dirty||!entry.hasFrame||(paused&&cameraChanged);
          if (!immediate&&(!step||entry.elapsed+1e-9<1/budget.hz)) {
            if (entry.hasFrame) { entry.active=true;entry.reason='cached'; }
          } else if (updateRightCamera(entry,camera.layers.mask)) renderEntry(entry);
          else fallback(entry,'invalid-projection');
        }
      }
      return totalPasses-before;
    },
    get diagnostics() {
      return {
        paneCount:entries.length, rejected:[...rejected], disposed, contextLost, totalPasses, failedPasses, shadowFallbackPasses, lastError,
        planarPasses:entries.reduce((sum,entry)=>sum+entry.passes,0),maxCapturePassesPerRefresh:entries.length,
        budget:{...budget}, fallback:'Authored environment material, not a live rear view',
        rearVisibility:rearFog?{fogNear:42,fogFar:78,finiteWorld:true}:null,
        rightCamera:rightCamera?{available:true,kind:'rear-right camera, not planar reflection',active:rightCamera.active,
          reason:rightCamera.reason,passes:rightCamera.passes,width:rightCamera.target?.width??budget.width,height:rightCamera.target?.height??budget.height,
          camera:rightCamera.view.camera.position.toArray(),verticalFov:36,horizontalFlip:true,colorSpace:'scene-linear',
          direction:rightCamera.view.camera.getWorldDirection(new T.Vector3()).toArray()}: {available:false,active:false,reason:'missing-pod-or-screen',passes:0},
        panes:entries.map(entry=>({role:entry.role,name:entry.mesh.name,active:entry.active,reason:entry.reason,
          passes:entry.passes,width:entry.target?.width??budget.width,height:entry.target?.height??budget.height,planeError:entry.geometry.maxPlaneError,
          worldPlane:[...entry.worldPlane.normal.toArray(),entry.worldPlane.constant],camera:entry.view.camera.position.toArray()})),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas?.removeEventListener?.('webglcontextlost',onLost);
      canvas?.removeEventListener?.('webglcontextrestored',onRestored);
      for (const entry of resources) { fallback(entry,'disposed'); entry.target?.dispose(); entry.material?.dispose(); }
    },
  };
}
