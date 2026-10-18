import * as T from '../public/vendor/three.js';
import { applyVehicleAppearance } from './owned-vehicles.js';
import { VehiclePaintTransition } from './paint-transition.js';
import { GarageCameraMotion, frameCockpitCustomization } from './garage-camera-motion.js';
import { setPlayerInteriorView } from './car.js';

/**
 * Display an authored workshop and the selected real vehicle on the existing
 * game renderer. It owns no second WebGL context and never advances gameplay.
 * Tier changes are asynchronous and generation-guarded; stale loads cannot
 * replace a newer selection. Room reflections are baked once per tier, not on
 * every frame, and the vehicle itself is excluded from that bake.
 */
export class GarageScene {
  /** @param {{renderer:T.WebGLRenderer,makeVehicle:Function,onStatus?:Function}} options Shared renderer and owned showcase-car factory. */
  constructor({ renderer, makeVehicle, onStatus = () => {} }) {
    this.renderer = renderer; this.makeVehicle = makeVehicle; this.onStatus = onStatus;
    this.scene = new T.Scene(); this.scene.background = new T.Color('#20282b');
    this.camera = new T.PerspectiveCamera(38, 1, .1, 80);
    this.scene.add(new T.HemisphereLight('#e6eff0', '#575047', 1.3));
    this.key = new T.DirectionalLight('#fff0d6', 3.0); this.key.position.set(-4, 7, -3);
    this.key.castShadow = true; this.key.shadow.mapSize.set(1024, 1024);
    Object.assign(this.key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: .1, far: 24 });
    this.key.shadow.normalBias = .025; this.key.shadow.bias = -.0002;
    this.scene.add(this.key, this.key.target);
    this.fill = new T.DirectionalLight('#a7d6df', 1.1); this.fill.position.set(5, 3, 4); this.scene.add(this.fill);
    this.loader = new T.GLTFLoader(); this.cache = new Map(); this.generation = 0;
    this.tier = 0; this.ready = false; this.disposed = false; this.yaw = -.63; this.pitch = .24; this.zoom = 1;
    this.vehicle = null; this.vehicleKey = ''; this.environmentTarget = null; this.inspection='overview'; this.orbitOffset=0;
    this.loadingTier=null;this.failedTier=null;this.environmentDirty=false;this.parkedVehicles=[];this.parkedKey='';
    this.vehicleId=null;this.paintTransition=null;this.rimTransitions=[];this.cameraMotion=new GarageCameraMotion();this.reducedMotion=false;
    this.onContextRestored=()=>{this.environmentDirty=true;this.onStatus({contextRestored:true});};
    renderer.domElement?.addEventListener('webglcontextrestored',this.onContextRestored);
    this.target = new T.Vector3(0, .83, 0); this.lastWidth = 0; this.lastHeight = 0;
  }

  /** Load one authored tier transactionally; failure retains the previous usable room until an explicit retry. */
  async setTier(raw) {
    const tier = Math.max(1, Math.min(4, Math.floor(Number(raw) || 1)));
    if (tier === this.tier && this.ready) return true;
    if (tier === this.loadingTier) return false;
    const generation = ++this.generation; this.loadingTier=tier; this.failedTier=null;
    this.onStatus({ loading: true, tier });
    try {
      if (!this.cache.has(tier)) {
        const url = new URL(`../public/assets/garage/tier${tier}.glb`, import.meta.url).href;
        this.cache.set(tier,this.loader.loadAsync(url).then(gltf => {
          gltf.scene.traverse(node => { if (node.isMesh) { node.castShadow = !/Original_mottled_concrete/.test(node.name); node.receiveShadow = true; } });
          return gltf.scene;
        }).catch(error => { this.cache.delete(tier); throw error; }));
      }
      const room = await this.cache.get(tier);
      if (this.disposed || generation !== this.generation) return false;
      const previous=this.room;
      if(previous)this.scene.remove(previous);
      this.scene.add(room);this.room=room;
      try { this.rebuildEnvironment(); }
      catch(error){this.scene.remove(room);this.room=previous;if(previous)this.scene.add(previous);throw error;}
      this.tier=tier;this.ready=true;this.loadingTier=null;this.failedTier=null;this.setParking(this.parkingRecords||[]);
      this.onStatus({loading:false,tier});return true;
    } catch(error) {
      if(!this.disposed&&generation===this.generation){this.loadingTier=null;this.failedTier=tier;this.onStatus({loading:false,tier,error:String(error.message||error)});}
      return false;
    }
  }

  /** Bake only room lighting, with guaranteed restoration of vehicle visibility and the old environment on failure. */
  rebuildEnvironment(){
    const cars=[this.vehicle,...(this.parkedVehicles||[])].filter(Boolean),visibility=cars.map(car=>car.visible);
    const previous=this.scene.environment,generator=new T.PMREMGenerator(this.renderer);
    for(const car of cars)car.visible=false;
    this.scene.environment=null;
    try{
      const next=generator.fromScene(this.scene,.04,.1,80);
      this.environmentTarget?.dispose();this.environmentTarget=next;this.scene.environment=next.texture;this.scene.environmentIntensity=.72;
      this.environmentDirty=false;
    }catch(error){this.scene.environment=previous;throw error;}
    finally{generator.dispose();cars.forEach((car,index)=>{car.visible=visibility[index];});}
  }

  /** Keep the owned car/materials during cosmetics edits; replace only for a different model. */
  setVehicle(id, appearance = {}) {
    const key = JSON.stringify([id, appearance]);
    if (key === this.vehicleKey) return;
    if(this.vehicle&&id===this.vehicleId&&this.vehicle.userData.appearance){
      applyVehicleAppearance(this.vehicle,appearance);
      this.paintTransition?.retarget({reducedMotion:this.reducedMotion});
      for(const wipe of this.rimTransitions)wipe.retarget({reducedMotion:this.reducedMotion});
      this.vehicleKey=key;return;
    }
    const next = this.makeVehicle(id, appearance);
    if (!next?.isObject3D) throw new TypeError('The garage needs an actual prepared vehicle');
    if (this.vehicle) {
      this.paintTransition?.dispose();for(const wipe of this.rimTransitions)wipe.dispose();this.rimTransitions=[];
      this.scene.remove(this.vehicle);
      for (const material of new Set(this.vehicle.userData.ownedAppearanceMaterials || [])) material.dispose();
    }
    this.vehicle = next; this.vehicleId=id; this.vehicleKey = key; if(id!=='rocket'&&this.inspection==='cockpit')this.setInspection('overview'); next.position.set(0, id==='rocket'?.006:(next.userData.groundY||.006), 0); this.scene.add(next);
    this.paintTransition=new VehiclePaintTransition(next);
    this.rimTransitions=[...new Set((next.userData.appearance?.rims||[]).map(entry=>entry.root).filter(Boolean))].map(root=>new VehiclePaintTransition(next,{slot:"rims",root}));
    this.cameraMotion.active=false;
    const size = new T.Box3().setFromObject(next, true).getSize(new T.Vector3());
    this.vehicleLength = Math.max(4.7, size.z); this.target.y = Math.max(.75, Math.min(1.2, size.y * .52));
  }

  /** Request frames only for an active finite wipe; hidden/offscreen/reduced-motion views settle. */
  advance(dt,{visible=true,reducedMotion=false}={}){
    this.reducedMotion=reducedMotion;
    let changed=this.paintTransition?.advance(dt,{visible,reducedMotion})||false;
    for(const wipe of this.rimTransitions)changed=wipe.advance(dt,{visible,reducedMotion})||changed;
    return this.cameraMotion.advance(dt,{visible,reducedMotion})||changed;
  }

  get animating(){return this.paintTransition?.animating||this.rimTransitions.some(wipe=>wipe.animating)||this.cameraMotion.active||false;}

  /** Deterministic inspection of the production paint clock; null resumes normal animation. */
  setPaintProgress(progress){
    const changed=this.paintTransition?.setProgress(progress)||false;
    if(changed)this.onStatus({paintProgress:progress});
    return changed;
  }

  /** Seek each real rim shader consistently for inspectable midpoint regression images. */
  setRimProgress(progress){let changed=false;for(const wipe of this.rimTransitions)changed=wipe.setProgress(progress)||changed;return changed;}

  /** Populate only measured clear side bays with actually owned cars; level four adds equipment, not fictitious extra floor space. */
  setParking(owned){
    this.parkingRecords=Array.isArray(owned)?owned:[];
    const records=this.parkingRecords.slice(0,this.tier<2?0:this.tier===2?1:2);
    const key=JSON.stringify(records);if(key===this.parkedKey)return;
    for(const car of this.parkedVehicles){this.scene.remove(car);for(const material of car.userData.ownedAppearanceMaterials||[])material.dispose();}
    this.parkedVehicles=[];this.parkedKey=key;
    records.forEach((record,index)=>{const car=this.makeVehicle(record.id,record.appearance||{});car.position.set(index?6.2:-6.2,record.id==='rocket'?.006:(car.userData.groundY||.006),-.8);this.scene.add(car);this.parkedVehicles.push(car);});
  }

  /** Select an actual geometry inspection view without hiding car parts or changing driving cameras. */
  setInspection(raw){
    const allowed=['overview','rear','wheels','cockpit'];
    let next=allowed.includes(raw)?raw:'overview';
    if(next==='cockpit'&&this.vehicle?.userData.ownedVehicleId!=='rocket')next='overview';
    if(next===this.inspection)return next;
    if(this.lastWidth>0)this.cameraMotion.begin(this.camera,{reducedMotion:this.reducedMotion});
    this.inspection=next;this.orbitOffset=0;
    this.yaw=next==='rear'?2.5:-.63;this.pitch=.24;
    return this.inspection;
  }

  /** Apply deliberate bounded orbit input in pixels; no continuous decorative vehicle rotation. */
  orbit(dx, dy) {
    const center=this.inspection==='rear'?2.5:-.63;this.yaw = Math.max(center-.65, Math.min(center+.65, this.yaw - (Number(dx) || 0) * .004));this.orbitOffset=Math.max(-.4,Math.min(.4,this.orbitOffset-(Number(dx)||0)*.003));
    this.pitch = Math.max(.13, Math.min(.48, this.pitch + (Number(dy) || 0) * .003));
  }

  /** Render one parked showcase frame, restoring the road exposure after the shared renderer call. */
  render(width, height, region=null) {
    if (this.disposed || !this.ready || !this.vehicle) return false;
    if(this.environmentDirty){try{this.rebuildEnvironment();}catch(error){this.environmentDirty=false;this.onStatus({error:String(error.message||error)});}}
    const aspect = Math.max(.25, width / Math.max(1, height));
    if (width !== this.lastWidth || height !== this.lastHeight) {
      this.camera.aspect = aspect; this.camera.fov = aspect < 1 ? 49 : 38; this.camera.updateProjectionMatrix();
      this.lastWidth = width; this.lastHeight = height;
    }
    setPlayerInteriorView(this.vehicle,this.inspection==='cockpit');
    this.camera.near=this.inspection==='cockpit'?.025:.08;this.camera.updateProjectionMatrix();
    const target=this.target.clone();
    let focus=this.vehicle;
    if(this.inspection==='wheels'){
      focus=this.vehicle.getObjectByName('wheel_fl')||this.vehicle;
      new T.Box3().setFromObject(focus,true).getCenter(target);
    }
    if(this.inspection==='cockpit'){
      let authored;this.vehicle.traverse(node=>{if(node.userData?.driverDisplay&&!authored)authored=node;});
      if(authored){
        const data=authored.userData.driverDisplay,frame=this.vehicle.userData.bodyRig||authored;frame.updateWorldMatrix(true,false);
        this.camera.clearViewOffset();
        this.camera.position.fromArray(data.reference_eye_game_m||data.inspection_eye_game_m).applyMatrix4(frame.matrixWorld);
        frameCockpitCustomization(this.camera,this.vehicle,data,frame,width,height,region,this.orbitOffset);
        this.camera.updateMatrixWorld();return this.drawScene();
      }
    }
    this.camera.fov=aspect<1?49:38;this.camera.updateProjectionMatrix();
    let radius = (this.vehicleLength || 4.7) * (aspect < 1 ? 1.95 : 1.75) * this.zoom;
    if(this.inspection==='wheels')radius=1.9;
    this.camera.position.copy(target).add(new T.Vector3(Math.sin(this.yaw)*radius,Math.sin(this.pitch)*radius,-Math.cos(this.yaw)*radius));
    this.camera.lookAt(target); this.camera.updateMatrixWorld();
    this.camera.clearViewOffset();
    if(region&&region.width>40&&region.height>40){
      const box=new T.Box3().setFromObject(focus,true),points=[];
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new T.Vector3(x,y,z));
      let projected;
      for(let i=0;i<3;i++){
        projected=points.map(point=>point.clone().project(this.camera));
        const px=projected.map(p=>(p.x+1)*width/2),py=projected.map(p=>(1-p.y)*height/2);
        const left=Math.min(...px),right=Math.max(...px),top=Math.min(...py),bottom=Math.max(...py);
        const scale=Math.max((right-left)/region.width,(bottom-top)/region.height);
        if(scale<=1.025||i===2){this.camera.setViewOffset(width,height,(left+right)/2-(region.x+region.width/2),(top+bottom)/2-(region.y+region.height/2),width,height);break;}
        radius*=scale*1.035;this.camera.position.copy(target).add(new T.Vector3(Math.sin(this.yaw)*radius,Math.sin(this.pitch)*radius,-Math.cos(this.yaw)*radius));this.camera.lookAt(target);this.camera.updateMatrixWorld();
      }
    }
    return this.drawScene();
  }

  /** Restore shared renderer exposure even when an inspection draw fails. */
  drawScene(){
    const exposure = this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = .84;
    try{this.paintTransition?.updateCoordinates();for(const wipe of this.rimTransitions)wipe.updateCoordinates();this.cameraMotion.apply(this.camera,this.lastWidth,this.lastHeight);this.renderer.render(this.scene,this.camera);}finally{this.renderer.toneMappingExposure=exposure;}
    return true;
  }

  /** Release exclusively owned room GPU assets once; vehicle source buffers remain with the road asset cache. */
  dispose() {
    if (this.disposed) return; this.disposed = true; ++this.generation;
    this.paintTransition?.dispose();for(const wipe of this.rimTransitions)wipe.dispose();
    this.renderer.domElement?.removeEventListener('webglcontextrestored',this.onContextRestored);
    this.environmentTarget?.dispose(); this.key.shadow.map?.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const promise of this.cache.values()) void promise.then(room => {
      room.traverse(node => {
        if (!node.isMesh) return;
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      geometries.clear(); materials.clear(); textures.clear();
    }).catch(() => {});
    for(const car of [this.vehicle,...this.parkedVehicles].filter(Boolean))for(const material of new Set(car.userData.ownedAppearanceMaterials||[]))material.dispose();
    this.scene.clear(); this.cache.clear();
  }
}
