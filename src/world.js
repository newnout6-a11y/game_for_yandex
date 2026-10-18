import * as T from '../public/vendor/three.js';
import { createCar, animatePlayerCar, animatePlayerHardware, animatePlayerBody, resetPlayerMotion, setPlayerInteriorView } from './car.js';
import { loadAssets, createSkyReflectionSource } from './assets.js';
import { renderDimensions, textureAnisotropy, normalizeRenderQuality, renderShadowSettings } from './render-settings.js';
import { updateChase } from './motion.js';
import { normalizeCameraMode, createCockpitView, shouldUseCockpit, updateCockpitCamera, COCKPIT_GLANCE_YAW } from './camera-view.js';
import { createCockpitDisplay } from './cockpit-display.js';
import { createRearCameraDisplay } from './rear-camera-display.js';
import { createPlayerMirrors } from './player-mirrors.js';
import { createTrafficCar, normalizeTrafficKind, installTrafficTemplates, resetTrafficMotion, animateTrafficCar } from './traffic.js';
import { trafficDefinition } from './traffic-catalog.js';
import { trafficLateral } from './traffic-behavior.js';
import { trafficPose, trailerYaw } from './traffic-physics.js';
import { createThrusterEffects } from './thrusters.js';
import { buildScenicLandscape, updateScenicLandscape, scenicTerrainHeight } from './landscape.js';

let bendDistance = NaN, bendCoefficient = 0;
/**
 * Evaluate the road centerline's lateral offset in the scrolling scene.
 * Only negative Z (ahead of the player) curves; the distance-dependent coefficient is cached
 * across calls so every strip, prop and vehicle uses the same bend during a frame.
 * @param {number} z - Player-relative longitudinal position in metres; forward is negative.
 * @param {number} [distance=0] - Total route travel in metres controlling the gradual curvature.
 * @returns {number} Centerline X offset in metres.
 */
export function roadBend(z, distance = 0) {
  if(distance!==bendDistance){bendDistance=distance;bendCoefficient=Math.sin(distance/1100+.35)*.00055;}
  return bendCoefficient*Math.min(z,0)**2;
}
/**
 * Own the Three.js scene, asset-backed vehicle pools, scenery and camera for one game canvas.
 * Gameplay state remains external; rendering updates visual resources and animation caches.
 */
export class RoadRenderer {
  /**
   * Allocate the renderer and scene and start asynchronous asset initialization.
   * Detects reduced-motion/device budgets once initially and exposes completion through ready;
   * callers must await that promise before relying on player/scenery resources.
   * @param {HTMLCanvasElement} canvas - Canvas owned by this renderer for WebGL output.
   * @param {function(number): void} onProgress - Asset request-completion percentage callback.
   */
  constructor(canvas, onProgress, { quality = 'auto', onRenderSettings = () => {}, cameraMode = 'chase' } = {}) {
    this.quality = normalizeRenderQuality(quality); this.onRenderSettings = onRenderSettings; this.cameraMode = normalizeCameraMode(cameraMode); this.effectiveCameraMode = 'chase'; this.lookDirection = 0; this.lookYaw = 0;
    this.canvas = canvas; this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.compact = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .84;
    this.scene = new T.Scene(); this.scene.background = new T.Color('#c7dce5');
    this.scene.fog = new T.Fog('#c9d6d5', 160, 510);
    this.camera = new T.PerspectiveCamera(54, 1, .15, 1200);
    this.traffic = new Map(); this.pickups = new Map(); this.trafficPool = new Map(); this.pickupPool = []; this.props = []; this.impact = 0; this.particles = [];
    this.sparkGeometry = new T.SphereGeometry(.04,4,3); this.sparkMaterials = new Map();
    this.distance = 0; this.menuDistance = 0; this.route = 'ring'; this.needsRender = true; this.time = 0;
    this.view = {}; this.hazards = new Map(); this.hazardPools = { cone:[], barrier:[] };
    this.ready = this.initialize(onProgress); this.resize();
  }
  /**
   * Load assets, install reusable traffic templates and construct all scene subsystems.
   * Builds sky-derived PMREM once and disposes its temporary source/generator; keeps the target
   * for scene lighting. Marks loaded only after the flight atlas attempt and event setup finish.
   * @param {function(number): void} onProgress - Forwarded asset loading percentage callback.
   * @returns {Promise<void>} Resolves when render can safely access all scene resources.
   */
  async initialize(onProgress) {
    this.assets = await loadAssets(onProgress, { anisotropy: textureAnisotropy(this.renderer.capabilities.getMaxAnisotropy(), this.compact) });
    const a = this.assets, r = this.renderer;
    installTrafficTemplates(a.traffic);
    // Neutral daylight key plus broad sky/road bounce. No camera-mounted fill
    // and no extra shadow pass: the underbody follows the same world lighting.
    this.daylightFill = new T.HemisphereLight('#dcecff', '#a6a393', 1.55);
    this.scene.add(this.daylightFill);
    this.sun = new T.DirectionalLight('#fff8ee', 2.35); this.sun.position.set(-55, 85, 45);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024,1024); this.applyShadowQuality();
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 65, bottom: -65, near: 1, far: 230 });
    this.sun.shadow.bias = -.00025; this.sun.shadow.normalBias = .035; this.sun.shadow.radius = 3;
    this.sun.target.position.set(0,0,-28); this.scene.add(this.sun, this.sun.target);
    this.buildRoad(); this.buildLandscape();
    // Use the actual original clear-sky panorama for both background and IBL.
    // The previous brown overcast HDR disagreed with the visible blue sky.
    // Generate this roughness-prefiltered map once, never per frame.
    this.scene.environmentRotation.y = this.scene.backgroundRotation.y;
    const pmrem = new T.PMREMGenerator(r);
    const reflectionSource = createSkyReflectionSource(this.scene.background);
    this.environmentTarget = pmrem.fromEquirectangular(reflectionSource);
    this.scene.environment = this.environmentTarget.texture;
    reflectionSource.dispose(); pmrem.dispose();
    this.scene.environmentIntensity = 1.15;
    this.player = createCar(a.car); this.scene.add(this.player);
    this.cockpitView = createCockpitView(this.player); this.cockpitDisplay = createCockpitDisplay(this.player);
    this.rearCameraDisplay = createRearCameraDisplay(this.player);
    this.playerMirrors = createPlayerMirrors(r, this.scene, this.player, {compact:this.compact,reducedMotion:this.reducedMotion,onContextChange:()=>this.handleMirrorContextChange()});
    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d'), gradient = ctx.createRadialGradient(64,64,5,64,64,64);
    gradient.addColorStop(0,'rgba(0,0,0,.55)'); gradient.addColorStop(.48,'rgba(0,0,0,.2)'); gradient.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
    this.contactMaterial = new T.MeshBasicMaterial({ map: new T.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, opacity: .62 });
    this.addContact(this.player);
    this.player.userData.contactShadow.material=this.contactMaterial.clone();
    this.player.remove(this.player.userData.contactShadow);this.scene.add(this.player.userData.contactShadow);
    this.buildFlightEffects();
    await this.flightEffects.ready;
    this.buildEventObjects();
    this.loaded = true; this.needsRender = true; this.resize();
  }
  /**
   * Attach a planar soft contact shadow and expose it on the vehicle userData.
   * @param {T.Object3D} car - Mutable vehicle receiving the new local-space shadow at Y=0.025 metres.
   * @returns {void} Uses the shared contact material; callers clone it before changing per-car opacity.
   */
  addContact(car) {
    const shadow = new T.Mesh(new T.PlaneGeometry(2.8, 5.6), this.contactMaterial);
    shadow.rotation.x = -Math.PI/2; shadow.position.y = .025; car.add(shadow);
    car.userData.contactShadow=shadow;
  }
  /**
   * Create the player's pooled world-space vapor effects and reusable roll-pivot vector.
   * @returns {void} Stores both resources on this renderer; requires an initialized player and scene.
   */
  buildFlightEffects() {
    this.flightEffects = createThrusterEffects(this.scene, this.player, { compact: this.compact, reducedMotion: this.reducedMotion });
    this.rollPivot = new T.Vector3();
  }
  /**
   * Add a longitudinal road strip with immutable base vertices for repeated bending.
   * The mesh spans scene Z=-650..80 metres and uses a conservative fixed sphere to avoid
   * per-frame bounds scans. The supplied material remains shared, not cloned.
   * @param {number} width - Strip width in metres along X.
   * @param {T.Material} material - Surface material to reuse.
   * @param {number} [start=0] - Lateral center offset from the unbent road in metres.
   * @returns {T.Mesh} New scene mesh also appended to this.strips.
   */
  strip(width, material, start = 0) {
    const geometry = new T.PlaneGeometry(width, 730, 1, 146);
    geometry.rotateX(-Math.PI/2); geometry.translate(start, .01, -285);
    const mesh = new T.Mesh(geometry, material); mesh.receiveShadow = true;
    mesh.userData.base = geometry.attributes.position.array.slice();
    // Conservative bound includes the maximum road bend; no per-frame vertex scan.
    geometry.boundingSphere = new T.Sphere(new T.Vector3(0, 0, -285), 475);
    this.scene.add(mesh);
    this.strips.push(mesh); return mesh;
  }
  /**
   * Build textured road/shoulder strips and a single instanced lane-dash batch.
   * @returns {void} Initializes mutable strip and dash caches using already loaded asset maps.
   */
  buildRoad() {
    const a = this.assets; this.strips = [];
    const road = new T.MeshStandardMaterial({ map:a.asphalt, normalMap:a.asphaltNormal, roughness:1, normalScale:new T.Vector2(.28,.28), color:'#bababa' });
    const mesh = this.strip(11.1, road);
    const uv = mesh.geometry.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*2.8,uv.getY(i)*109.5);
    const shoulder = new T.MeshStandardMaterial({ map:a.ground, roughness:1, color:'#b1a68b' });
    for(const side of [-1,1]) {
      const ground = this.strip(2.7,shoulder,side*6.85); ground.position.y=-.03;
      const guv=ground.geometry.attributes.uv; for(let i=0;i<guv.count;i++) guv.setXY(i,guv.getX(i)*1.2,guv.getY(i)*146);
    }
    const white = new T.MeshStandardMaterial({ color:'#e6e4d9', roughness:.94 });
    for(const x of [-5.3,5.3]) { const stripe=this.strip(.13,white,x); stripe.position.y=.012; }
    this.dashSeeds=[];
    const dashGeometry = new T.PlaneGeometry(.13,4.5); dashGeometry.rotateX(-Math.PI/2);
    for(const x of [-1.75,1.75]) for(let z=-650;z<82;z+=12) this.dashSeeds.push({x,z});
    this.dashes=new T.InstancedMesh(dashGeometry,white,this.dashSeeds.length);
    this.dashes.name='lane-markings'; this.dashes.frustumCulled=false;
    this.dashes.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.dashTransform=new T.Object3D(); this.scene.add(this.dashes);

  }
  /**
   * Sample the deterministic unbent landscape height for renderer consumers.
   * @param {number} x - Lateral road-local coordinate in metres.
   * @param {number} z - Unrecycled world longitudinal coordinate in metres.
   * @returns {number} Terrain elevation in metres above the road reference plane.
   */
  terrainHeight(x,z) { return scenicTerrainHeight(x,z); }
  /**
   * Construct scenic resources once, sharing the renderer's assets, scene and road bend.
   * @returns {void} Stores the returned subsystem indirectly in this.scenery.
   */
  buildLandscape() { buildScenicLandscape(this,roadBend); }
  /**
   * Select the scenic route palette and invalidate otherwise skippable rendering.
   * @param {string} route - Route identifier; unknown palettes fall back to the ring colors.
   * @returns {void} Does not reset gameplay distance or rebuild geometry.
   */
  setRoute(route) { this.route=route;this.needsRender=true; }
  /**
   * Create reusable cone/barrier templates and the hidden checkpoint gate.
   * @returns {void} Owns new materials/geometries; obstacle clones later share template resources.
   */
  buildEventObjects() {
    const orange=new T.MeshStandardMaterial({color:'#c56c24',roughness:.72});
    const white=new T.MeshStandardMaterial({color:'#e7e3d4',roughness:.8});
    const rubber=new T.MeshStandardMaterial({color:'#242623',roughness:.95});
    this.coneTemplate=new T.Group();
    const base=new T.Mesh(new T.BoxGeometry(.58,.07,.58),rubber);base.position.y=.035;
    const cone=new T.Mesh(new T.ConeGeometry(.27,.8,24),orange);cone.position.y=.46;
    const stripe=new T.Mesh(new T.CylinderGeometry(.09,.155,.19,24),white);stripe.position.y=.56;
    this.coneTemplate.add(base,cone,stripe);
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const c=canvas.getContext('2d');c.fillStyle='#e5dfcc';c.fillRect(0,0,512,128);c.fillStyle='#ba5e22';
    for(let x=-128;x<640;x+=128){c.beginPath();c.moveTo(x,0);c.lineTo(x+65,0);c.lineTo(x-63,128);c.lineTo(x-128,128);c.fill();}
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    this.barrierTemplate=new T.Group();
    const board=new T.Mesh(new T.BoxGeometry(2.7,.6,.14),new T.MeshStandardMaterial({map:texture,roughness:.8}));board.position.y=.95;this.barrierTemplate.add(board);
    for(const x of [-1,1]){const leg=new T.Mesh(new T.CylinderGeometry(.055,.055,1.3,8),white);leg.position.set(x,.65,0);this.barrierTemplate.add(leg);}
    this.gate=new T.Group();
    for(const side of [-1,1]){
      const pole=new T.Mesh(new T.CylinderGeometry(.035,.035,2.6,8),white);pole.position.set(side*2.1,1.3,0);
      const flag=new T.Mesh(new T.PlaneGeometry(.65,.6),new T.MeshStandardMaterial({color:'#c16c28',roughness:1,side:T.DoubleSide}));flag.position.set(side*2.1+side*.32,2.2,0);
      this.gate.add(pole,flag);
    }
    const line=new T.Mesh(new T.PlaneGeometry(4.1,.3),white);line.rotation.x=-Math.PI/2;line.position.y=.03;this.gate.add(line);
    this.gate.visible=false;this.scene.add(this.gate);
  }
  /**
   * Reconcile obstacle IDs with pooled scene objects and position the checkpoint gate.
   * Obstacle/event distances are positive ahead, converted to negative scene Z; lateral lane
   * coordinates use 3.5-metre spacing. Retired meshes are pooled rather than disposed.
   * @param {Object} state - Gameplay snapshot with distance, obstacles and optional roadEvent.
   * @param {boolean} menu - Suppress hazards and checkpoints for the menu scene.
   * @returns {void} Mutates hazard maps, pools and scene transforms, not the gameplay snapshot.
   */
  renderEvents(state, menu) {
    const active=new Set();
    for(const obstacle of menu?[]:(state.obstacles||[])){
      active.add(obstacle.id);let mesh=this.hazards.get(obstacle.id);
      if(!mesh){mesh=this.hazardPools[obstacle.kind].pop()||(obstacle.kind==='cone'?this.coneTemplate:this.barrierTemplate).clone(true);mesh.userData.kind=obstacle.kind;this.hazards.set(obstacle.id,mesh);this.scene.add(mesh);}
      mesh.position.set((obstacle.x-1)*3.5+roadBend(-obstacle.z,state.distance),.02,-obstacle.z);
      mesh.rotation.y=-Math.atan((roadBend(-obstacle.z-1,state.distance)-roadBend(-obstacle.z+1,state.distance))/2);
    }
    for(const[id,mesh]of this.hazards)if(!active.has(id)){this.scene.remove(mesh);this.hazardPools[mesh.userData.kind].push(mesh);this.hazards.delete(id);}
    const event=state.roadEvent;this.gate.visible=!menu&&event?.type==='checkpoint';
    if(this.gate.visible)this.gate.position.set((event.lane-1)*3.5+roadBend(-event.remaining,state.distance),.03,-event.remaining);
  }
  /**
   * Translate a gameplay effect notification into sparks and optional impact shake.
   * @param {string} kind - Supported keys are crash, near, charge and cone; others do nothing.
   * @returns {void} Updates visual effect state without changing gameplay outcomes.
   */
  effect(kind) {
    if(kind==='crash') {this.impact=1; this.spawnParticles(34,'#e8b96a');}
    if(kind==='near') this.spawnParticles(5,'#b7a890');
    if(kind==='charge') this.spawnParticles(12,'#d9d5b0');
    if(kind==='cone') this.spawnParticles(8,'#b7a890');
  }
  /**
   * Emit short-lived spark meshes near the player using shared geometry/materials.
   * @param {number} count - Number of spark particles to create when loading is complete.
   * @param {T.ColorRepresentation} color - Spark color and cache key for a reused basic material.
   * @returns {void} Appends mutable positions, metre-per-second velocities and second-based lifetimes.
   */
  spawnParticles(count,color) {
    if(!this.loaded)return;
    if(!this.sparkMaterials.has(color))this.sparkMaterials.set(color,new T.MeshBasicMaterial({color}));
    const material=this.sparkMaterials.get(color);
    for(let i=0;i<count;i++){
      const mesh=new T.Mesh(this.sparkGeometry,material);mesh.scale.setScalar(.6+Math.random()*.7);
      mesh.position.copy(this.player.position);mesh.position.y=.6;this.scene.add(mesh);
      this.particles.push({mesh,v:new T.Vector3((Math.random()-.5)*7,Math.random()*4,Math.random()*7-2),life:.6+Math.random()*.5});
    }
  }
  /**
   * Synchronize CSS viewport sizing, bounded drawing-buffer resolution and camera aspect.
   * @returns {void} Reads current browser dimensions/DPR, updates compact mode and requests a redraw.
   */
  setQuality(value) { this.quality = normalizeRenderQuality(value); this.resize(); }
  /** Replace the existing shadow target only when its selected resource bucket changes. */
  applyShadowQuality() {
    if (!this.sun) return;
    const size = renderShadowSettings(this.quality, this.compact).mapSize, shadow = this.sun.shadow;
    if (shadow.mapSize.x === size && shadow.mapSize.y === size) return;
    shadow.map?.dispose(); shadow.map = null; shadow.mapSize.set(size, size); shadow.needsUpdate = true;
    this.needsRender = true;
  }
  /** Select a persisted camera mode without advancing paused physics or display clocks. */
  setCameraMode(value) {
    this.cameraMode = normalizeCameraMode(value); this.needsRender = true;
    if (this.cameraMode === 'cockpit') this.cockpitDisplay?.invalidate();
    this.playerMirrors?.invalidate();
    this.lookDirection = 0; this.lookYaw = 0;
  }
  /** Hold a deliberate seated glance; negative means left, positive right. */
  setLookDirection(direction) {
    this.lookDirection = Number.isFinite(direction) ? Math.sign(direction) : 0;
    this.needsRender = true;
  }
  /** Apply viewport and selected render budgets without resizing unchanged buffers. */
  resize() {
    const w=innerWidth,h=innerHeight;
    this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';
    this.compact = matchMedia('(pointer: coarse)').matches || Math.min(w,h)<600;
    const size=renderDimensions(w,h,devicePixelRatio||1,this.compact,this.quality);
    this.applyShadowQuality();
    if(this.canvas.width!==size.width||this.canvas.height!==size.height)this.renderer.setSize(size.width,size.height,false);
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.needsRender=true;
    this.onRenderSettings?.({quality:this.quality,width:size.width,height:size.height,compact:this.compact});
  }
  /**
   * Remove one live traffic vehicle and retain it in its kind-specific reuse pool.
   * @param {string|number} id - Live traffic map key to delete.
   * @param {T.Object3D} car - Vehicle whose userData.kind selects the pool; GPU resources remain alive.
   * @returns {void} Changes scene membership and renderer-owned maps only.
   */
  recycleTraffic(id,car) {
    this.scene.remove(car);
    const kind=car.userData.kind;
    if(!this.trafficPool.has(kind))this.trafficPool.set(kind,[]);
    this.trafficPool.get(kind).push(car);this.traffic.delete(id);
  }
  /**
   * Discard live ID associations when a new gameplay state starts a run.
   * A retry can reuse numeric IDs, so pooled models must be rebound and their motion reset;
   * menu rendering and repeated calls with the same state object do not invalidate the mapping.
   * @param {Object} state - Gameplay state identity, not a freshly cloned per-frame snapshot.
   * @param {boolean} [menu=false] - Whether this is the independent menu presentation.
   * @returns {void} Recycles the previous run's live vehicles when identity changes.
   */
  syncTrafficState(state,menu=false) {
    // A retry creates a new state and restarts numeric IDs. Never carry an old
    // model, paint or suspension history into that new run under the same ID.
    if(menu||this.trafficState===state)return;
    for(const [id,car]of this.traffic)this.recycleTraffic(id,car);
    this.trafficState=state;
  }
  /**
   * Find an existing vehicle only if its model kind still matches the traffic item.
   * @param {string|number} id - Live traffic identifier.
   * @param {string} kind - Normalized catalog model key expected by the caller.
   * @returns {T.Object3D|undefined} Matching car, or undefined after recycling a mismatched car.
   */
  trafficForItem(id,kind) {
    const car=this.traffic.get(id);
    if(car&&car.userData.kind!==kind){this.recycleTraffic(id,car);return undefined;}
    return car;
  }
  /** Detach invalid camera targets and bypass the settled-pause guard after context events. */
  handleMirrorContextChange() {
    this.rearCameraDisplay?.setTexture(null);
    this.needsRender = true;
  }
  /**
   * Render one visual frame from external gameplay state, or a low-cost menu scene.
   * Keeps the player near Z=0 while distance scrolls road, terrain and detached effects; manages
   * vehicle/pickup pools, wheel and trailer motion, camera chase and transient sparks. Skips
   * unneeded settled pause/reduced-motion menu frames and returns while assets are loading.
   * @param {Object} state - Gameplay state; distances/positions are metres and speeds metres per second.
   * @param {Object} [options] - Presentation controls, independent of gameplay simulation.
   * @param {boolean} [options.menu=false] - Use decorative menu traffic and camera behavior.
   * @param {number} [options.dt=0] - Frame elapsed time in seconds.
   * @param {boolean} [options.paused=false] - Freeze simulation-driven visual clocks/motion where supported.
   * @returns {void} Mutates renderer-owned scene, caches and effects, not the gameplay state.
   */
  render(state,{menu=false,dt=0,paused=false}={}) {
    if(!this.loaded)return;
    if(menu&&this.reducedMotion&&!this.needsRender&&this.wasMenu)return;
    if(paused&&!menu&&this.wasPaused&&!this.needsRender&&this.pausedFor>.6&&!this.particles.length&&!this.impact)return;
    this.pausedFor=paused&&!menu?(this.pausedFor||0)+dt:0;this.wasPaused=paused&&!menu;
    if (!menu && this.playerState !== state) {
      this.playerState = state; resetPlayerMotion(this.player);
      this.cockpitView.returnDelay = 0; this.cockpitDisplay.invalidate(); this.playerMirrors?.invalidate(); this.lookDirection = 0; this.lookYaw = 0;
    }
    this.needsRender=false;this.wasMenu=menu;this.time+=paused?0:dt;
    if(menu&&!this.reducedMotion)this.menuDistance+=dt*4;
    const distance=menu?this.menuDistance:state.distance, phone=this.camera.aspect<.8;
    this.distance=distance;
    for(const strip of this.strips){
      const p=strip.geometry.attributes.position,b=strip.userData.base;
      for(let i=0;i<p.count;i++)p.setX(i,b[i*3]+roadBend(b[i*3+2],distance));
      p.needsUpdate=true;
    }
    for(const map of [this.assets.asphalt,this.assets.asphaltNormal])map.offset.y=distance/6.667;
    for(const map of [this.assets.ground])map.offset.y=distance/5;
    for(const map of [this.assets.grass])map.offset.y=-distance/18;
    for(let i=0;i<this.dashSeeds.length;i++){
      const seed=this.dashSeeds[i],dash=this.dashTransform;
      const z=((seed.z+distance)%732+732)%732-650;
      dash.position.set(seed.x+roadBend(z,distance),.045,z);
      dash.rotation.y=-Math.atan((roadBend(z-1,distance)-roadBend(z+1,distance))/2);
      dash.updateMatrix();this.dashes.setMatrixAt(i,dash.matrix);
    }
    this.dashes.instanceMatrix.needsUpdate=true;
    updateScenicLandscape(this,distance,this.route);
    const desiredX=menu?1.8:(state.x-1)*3.5;
    const altitude=menu?0:(state.altitude||0);
    this.player.position.set(desiredX,.012+altitude,0);
    this.player.rotation.y=menu?-.22:-(state.heading||0);
    this.player.rotation.order='YXZ';
    this.player.rotation.z=menu?0:(state.rollAngle||0);
    this.player.rotation.x=menu?0:(state.flying?-.035:0);
    animatePlayerBody(this.player, menu ? {} : state);
    // Keep the cabin centre on the flight path, not the model's ground-level origin.
    if (!menu && state.rollAngle) {
      this.rollPivot.set(0,.58,0).applyEuler(this.player.rotation);
      this.player.position.x-=this.rollPivot.x;
      this.player.position.y+=.58-this.rollPivot.y;
      this.player.position.z-=this.rollPivot.z;
    }
    animatePlayerCar(this.player, menu ? distance : (state.rearDistance ?? distance), menu ? 0 : (state.steerAngle || 0), state.braking, menu ? 0 : (state.curvature ?? null));
    animatePlayerHardware(this.player, menu ? { phase: 'menu', speed: 0 } : state, paused ? 0 : dt);
    const contact=this.player.userData.contactShadow;
    contact.position.set(desiredX,.028,0);contact.scale.setScalar(1+altitude*.15);contact.material.opacity=.62-altitude*.1;
    this.player.updateMatrixWorld(true);
    this.flightEffects.update(menu ? { phase:'menu', altitude:0, thrusterPower:0, distance } : state, paused ? 0 : dt, this.time);
    this.player.visible=this.cameraMode==='cockpit'||state.invincible<=0||Math.floor(this.time*9)%2===0||menu;
    this.syncTrafficState(state,menu);
    const active=new Set();
    const traffic=menu?[{id:'m1',lane:0,z:45,color:2,kind:'suv'},{id:'m2',lane:2,z:76,color:3,kind:'van'},{id:'m3',lane:1,z:120,color:0,kind:'sedan'}]:state.traffic;
    for(const item of traffic){
      active.add(item.id);const kind=normalizeTrafficKind(item.kind);let car=this.trafficForItem(item.id,kind);
      if(!car){
        const pool=this.trafficPool.get(kind)||[];
        car=pool.pop();if(!car){
          car=createTrafficCar(kind);this.addContact(car);const spec=trafficDefinition(kind),contact=car.userData.contactShadow;
          contact.scale.set(spec.width/2.1,spec.length/4.7,1);
          if(car.userData.trailer){
            // The contact patch follows each chassis, not a single rigid 16 m slab.
            contact.scale.y=5.8/4.7;contact.position.z=-5.3;
            const trailerContact=contact.clone();trailerContact.scale.y=(spec.trailerRearZ-spec.trailerFrontZ)/4.7;trailerContact.position.z=(spec.trailerRearZ+spec.trailerFrontZ)/2-spec.hitchZ;
            car.userData.trailer.add(trailerContact);car.userData.trailerContact=trailerContact;
          }
        }
        if(car.userData.paint && car.userData.category!=='special')car.userData.paint.color.set(['#d5d4ce','#294f6a','#697b87','#ae8e58','#3f6050','#8d342c','#dce6e6'][item.color%7||0]);
        resetTrafficMotion(car);this.traffic.set(item.id,car);this.scene.add(car);
      }
      const pose=trafficPose(item,distance);car.visible=true;car.position.set(pose.x,car.userData.groundY,pose.z);
      car.rotation.y=pose.yaw;
      if(car.userData.trailer)car.userData.trailer.rotation.y=trailerYaw(item,distance);
      animateTrafficCar(car,menu?{...item,speed:4,travelDistance:distance}:item,distance,paused?0:dt);
      car.userData.contactShadow.position.y=.025-car.userData.groundY;
      if(car.userData.trailerContact)car.userData.trailerContact.position.y=.025-car.userData.groundY;
      if(car.userData.brakeMaterial)car.userData.brakeMaterial.emissiveIntensity=item.braking?1.2:.05;
    }
    for(const [id,car]of this.traffic)if(!active.has(id))this.recycleTraffic(id,car);
    const pickIds=new Set();
    for(const item of menu?[]:state.pickups){
      pickIds.add(item.id);let mesh=this.pickups.get(item.id);
      if(!mesh){mesh=this.pickupPool.pop();if(!mesh){mesh=new T.Group();const tank=new T.Mesh(new T.CylinderGeometry(.2,.2,.65,12),new T.MeshStandardMaterial({color:'#d9ac43',metalness:.7,roughness:.25}));const band=new T.Mesh(new T.CylinderGeometry(.205,.205,.13,12),new T.MeshStandardMaterial({color:'#eee8d9',roughness:.4}));mesh.add(tank,band);}this.pickups.set(item.id,mesh);this.scene.add(mesh);}
      mesh.position.set((item.lane-1)*3.5+roadBend(-item.z,distance),1+Math.sin(this.time*3)*.08,-item.z);mesh.rotation.z=Math.sin(this.time)*.15;
    }
    for(const[id,mesh]of this.pickups)if(!pickIds.has(id)){this.scene.remove(mesh);this.pickupPool.push(mesh);this.pickups.delete(id);}
    this.renderEvents(state,menu);
    updateChase(this.view,state,{phone,menu,dt,paused,reducedMotion:this.reducedMotion});
    const inside = this.cameraMode === 'cockpit' && shouldUseCockpit(state, menu, this.cockpitView, paused?0:dt);
    this.effectiveCameraMode = inside ? 'cockpit' : 'chase';
    if (!inside || paused) { this.lookDirection = 0; this.lookYaw = 0; }
    else {
      const target = -this.lookDirection * COCKPIT_GLANCE_YAW;
      this.lookYaw = this.reducedMotion ? target : this.lookYaw + (target-this.lookYaw)*(1-Math.exp(-Math.max(0,dt)*12));
    }
    setPlayerInteriorView(this.player, inside);
    if (this.cameraMode === 'cockpit' || menu) this.cockpitDisplay.update(menu ? {phase:'menu',speed:0,nitro:60,distance:0} : state, paused?0:dt);
    if (inside) updateCockpitCamera(this.camera, this.cockpitView, state, {aspect:this.camera.aspect,reducedMotion:this.reducedMotion,lookYaw:this.lookYaw});
    else {
      if(this.camera.fov!==this.view.fov || this.camera.near!==.15){this.camera.fov=this.view.fov;this.camera.near=.15;this.camera.updateProjectionMatrix();}
      this.camera.up.set(0,1,0);this.camera.position.set(this.view.x,this.view.y+altitude*.78,this.view.z);
      this.camera.lookAt(this.view.lookX,this.view.lookY+altitude*.62,this.view.lookZ);
    }
    this.impact=Math.max(0,this.impact-dt*2);
    if(this.impact&&!this.reducedMotion&&!inside){this.camera.position.x+=Math.sin(this.impact*53)*this.impact*.12;this.camera.position.y+=Math.cos(this.impact*61)*this.impact*.08;}
    for(const p of [...this.particles]){
      p.life-=dt;p.v.y-=dt*9;p.mesh.position.addScaledVector(p.v,dt);
      if(p.mesh.position.y<.03){p.mesh.position.y=.03;p.v.y=Math.abs(p.v.y)*.25;}
      if(p.life<=0){this.scene.remove(p.mesh);this.particles.splice(this.particles.indexOf(p),1);}
    }
    // Reflect the same completed scene and real eye, without recursion or a
    // second shadow update. Inactive/offscreen panes keep their authored fallback.
    this.playerMirrors.update(this.camera, {dt:paused?0:dt,mode:this.effectiveCameraMode,paused,quality:this.quality,compact:this.compact});
    this.rearCameraDisplay.setTexture(this.effectiveCameraMode === 'cockpit' ? this.playerMirrors.rightCameraTexture : null);
    this.renderer.render(this.scene,this.camera);
  }
}
