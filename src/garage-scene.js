import * as T from '../public/vendor/three.js';
import { applyVehicleAppearance } from './owned-vehicles.js';
import { VehiclePaintTransition } from './paint-transition.js';
import { GarageCameraMotion, frameCockpitCustomization, garageCameraLimits, garageBoxCorners, constrainGarageCamera } from './garage-camera-motion.js';
import { garageOrbitEnvelope, garageOrbitPoints, garageOrbitDistance, createGarageOrbitRig, applyGarageOrbitRig, GARAGE_ORBIT_DISTANCE_FACTOR } from './garage-stable-orbit.js';
import { setPlayerInteriorView } from './car.js';
import { textureAnisotropy } from './render-settings.js';
import { GarageScreenPlayer } from './garage-screen-player.js';
import { GarageToyProp } from './garage-toy-prop.js';

/** Fixed clear side bays, measured against all five real vehicle envelopes and the complete orbit band. */
export const GARAGE_PARKING_BAYS = Object.freeze([Object.freeze({x:-7.8,z:-1.6}),Object.freeze({x:7.8,z:-1.6})]);

/**
 * Display an authored workshop and the selected real vehicle on the existing
 * game renderer. It owns no second WebGL context and never advances gameplay.
 * Tier changes are asynchronous and generation-guarded; stale loads cannot
 * replace a newer selection. Room reflections are baked once per tier, not on
 * every frame, and the vehicle itself is excluded from that bake.
 */
export class GarageScene {
  /** @param {{renderer:T.WebGLRenderer,makeVehicle:Function,onStatus?:Function,compact?:boolean}} options Shared renderer, owned showcase-car factory and bounded mobile texture budget. */
  constructor({ renderer, makeVehicle, onStatus = () => {}, compact = false }) {
    this.renderer = renderer; this.makeVehicle = makeVehicle; this.onStatus = onStatus;
    this.textureSampling = textureAnisotropy(renderer.capabilities?.getMaxAnisotropy?.(), compact);
    this.screenDisplay = new GarageScreenPlayer({onChange:()=>this.onStatus({screenFrame:true})});
    this.scene = new T.Scene(); this.scene.background = new T.Color('#20282b');
    this.camera = new T.PerspectiveCamera(38, 1, .1, 80);
    this.scene.add(new T.HemisphereLight('#e6eff0', '#575047', 1.6));
    // A local ceiling fixture cannot be shadowed by the roof above it. The old
    // infinite directional light clipped that roof across its finite ortho map,
    // projecting a hard triangular coverage boundary onto the room shell.
    this.key = new T.SpotLight('#fff0d6', 50, 16, 66*Math.PI/180, .3, 2);
    this.key.position.set(0,4.5,-.8);this.key.target.position.set(0,0,-.8);
    this.key.castShadow = true; this.key.shadow.mapSize.set(1024, 1024);
    // The TV changes pixels, not occluders. Rebuild this static light map only
    // when authored geometry, visibility, parking or GPU context actually changes.
    this.key.shadow.autoUpdate=false;this.key.shadow.needsUpdate=true;
    // Keep the shadow projection tied to the spotlight cone, not a smaller
    // manually clipped rectangle. The penumbra fades at that same edge.
    // The emitter sits below every authored suspended lamp, not behind its casing.
    // This 66-degree half-cone spends the same 1024 map on a 20.2m floor
    // footprint (19.7mm/texel), rather than 62m at 8m depth.
    this.key.shadow.camera.near=.1;this.key.shadow.camera.far=16;this.key.shadow.focus=1;
    this.key.shadow.normalBias = .025; this.key.shadow.bias = -.0002;
    this.scene.add(this.key, this.key.target);
    this.fill = new T.DirectionalLight('#a7d6df', 1.1); this.fill.position.set(5, 3, 4); this.scene.add(this.fill);
    this.loader = new T.GLTFLoader();
    this.toyProp=new GarageToyProp(this.loader,{onError:error=>this.onStatus({toyError:String(error.message||error)})});
    this.cache = new Map(); this.generation = 0;
    this.tier = 0; this.ready = false; this.disposed = false; this.yaw = -.63; this.pitch = .24; this.zoom = 1;
    this.vehicle = null; this.vehicleKey = ''; this.environmentTarget = null; this.inspection='overview'; this.orbitOffset=0;
    this.loadingTier=null;this.failedTier=null;this.environmentDirty=false;this.parkedVehicles=[];this.parkedKey='';
    this.vehicleId=null;this.paintTransition=null;this.rimTransitions=[];this.cameraMotion=new GarageCameraMotion();this.reducedMotion=false;this.orbitRecovery=null;
    this.onContextRestored=()=>{this.environmentDirty=true;this.key.shadow.needsUpdate=true;this.onStatus({contextRestored:true});};
    renderer.domElement?.addEventListener('webglcontextrestored',this.onContextRestored);
    this.target = new T.Vector3(0, .83, 0); this.lastWidth = 0; this.lastHeight = 0;
  }

  /** Install the authored decorative toy once and wake a settled room for its cached bake; missing decoration never blocks entry. */
  async prepareToy(){
    if(this.disposed)return false;
    const toy=await this.toyProp.load();
    if(this.disposed||!toy)return false;
    if(toy.parent!==this.scene){this.scene.add(toy);this.cameraLimits=null;this.environmentDirty=true;this.key.shadow.needsUpdate=true;this.onStatus({toyReady:true});}
    return true;
  }

  /** Load one authored tier transactionally; failure retains the previous usable room until an explicit retry. */
  async setTier(raw) {
    if(this.disposed)return false;
    const tier = Math.max(1, Math.min(4, Math.floor(Number(raw) || 1)));
    if (tier === this.tier && this.ready) return true;
    if (tier === this.loadingTier) return false;
    const generation = ++this.generation; this.loadingTier=tier; this.failedTier=null;
    this.onStatus({ loading: true, tier });
    try {
      if (!this.cache.has(tier)) {
        const url = new URL(`../public/assets/garage/tier${tier}.glb`, import.meta.url).href;
        this.cache.set(tier,this.loader.loadAsync(url).then(gltf => {
          const textures=new Set();
          gltf.scene.traverse(node => { if (node.isMesh) {
            node.castShadow = !/Original_mottled_concrete/.test(node.name); node.receiveShadow = true;
            for(const material of Array.isArray(node.material)?node.material:[node.material])
              for(const value of Object.values(material||{})) if(value?.isTexture&&!value.isRenderTargetTexture)textures.add(value);
          } });
          // Preserve authored colour spaces and trilinear mipmaps. Extra sampling
          // is bounded (4 compact / 8 desktop) and only improves grazing surfaces.
          for(const texture of textures){texture.anisotropy=this.textureSampling;texture.needsUpdate=true;}
          return gltf.scene;
        }).catch(error => { this.cache.delete(tier); throw error; }));
      }
      const room = await this.cache.get(tier);
      // A completed old load still belongs to the cache, not to a disposed or newer TV selection.
      if (this.disposed || generation !== this.generation) return false;
      await this.screenDisplay.attach(room);
      if (this.disposed || generation !== this.generation) return false;
      const previous=this.room;
      if(previous)this.scene.remove(previous);
      this.scene.add(room);this.room=room;this.cameraLimits=null;
      try { this.rebuildEnvironment(); }
      catch(error){this.scene.remove(room);this.room=previous;if(previous)this.scene.add(previous);throw error;}
      this.screenDisplay.setRoom(room);this.tier=tier;this.ready=true;this.loadingTier=null;this.failedTier=null;this.setParking(this.parkingRecords||[]);
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
    this.scene.environment=null;this.key.shadow.needsUpdate=true;
    try{
      const next=generator.fromScene(this.scene,.04,.1,80);
      this.environmentTarget?.dispose();this.environmentTarget=next;this.scene.environment=next.texture;this.scene.environmentIntensity=.72;
      this.environmentDirty=false;
    }catch(error){this.scene.environment=previous;throw error;}
    finally{generator.dispose();cars.forEach((car,index)=>{car.visible=visibility[index];});this.key.shadow.needsUpdate=true;}
  }

  /** Keep the owned car/materials during cosmetics edits; replace only for a different model. */
  setVehicle(id, appearance = {}) {
    const key = JSON.stringify([id, appearance]);
    const geometryKey=JSON.stringify([appearance['body.addon'],appearance['wheels.geometry'],appearance['wheels.finish']==='rim_copper',appearance['cockpit.steering']]);
    if (key === this.vehicleKey) return;
    this.key.shadow.needsUpdate=true;
    if(this.vehicle&&id===this.vehicleId&&this.vehicle.userData.appearance){
      if(geometryKey!==this.orbitGeometryKey){this.orbitEnvelope=null;this.orbitRig=null;this.orbitBounds=null;this.orbitGeometryKey=geometryKey;}
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
    this.cameraMotion.active=false;this.orbitRecovery=null;this.orbitGeometryKey=geometryKey;this.orbitEnvelope=null;this.orbitRig=null;this.orbitBounds=null;
    const size = new T.Box3().setFromObject(next, true).getSize(new T.Vector3());
    this.vehicleLength = Math.max(4.7, size.z); this.target.y = Math.max(.75, Math.min(1.2, size.y * .52));
  }

  /** Request frames only for an active finite wipe; hidden/offscreen/reduced-motion views settle. */
  advance(dt,{visible=true,reducedMotion=false,mediaActive=true}={}){
    this.reducedMotion=reducedMotion;
    let changed=this.paintTransition?.advance(dt,{visible,reducedMotion})||false;
    for(const wipe of this.rimTransitions)changed=wipe.advance(dt,{visible,reducedMotion})||changed;
    const mediaChanged=this.screenDisplay.advance(dt,{visible,reducedMotion,mediaActive});
    const recovering=Boolean(this.orbitRecovery);
    if(recovering){
      const step=Number.isFinite(dt)&&dt>0?dt/.35:0;
      this.orbitRecovery.progress=visible&&!reducedMotion?Math.min(1,this.orbitRecovery.progress+step):1;
      if(this.orbitRecovery.progress===1)this.orbitRecovery=null;
    }
    return this.cameraMotion.advance(dt,{visible,reducedMotion})||recovering||mediaChanged||changed;
  }

  get animating(){return this.paintTransition?.animating||this.rimTransitions.some(wipe=>wipe.animating)||this.cameraMotion.active||Boolean(this.orbitRecovery);}

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
    this.cameraLimits=null;this.parkingRecords=Array.isArray(owned)?owned:[];
    const records=this.parkingRecords.slice(0,this.tier<2?0:this.tier===2?1:2);
    const key=JSON.stringify(records);if(key===this.parkedKey)return;this.key.shadow.needsUpdate=true;
    for(const car of this.parkedVehicles){this.scene.remove(car);for(const material of car.userData.ownedAppearanceMaterials||[])material.dispose();}
    this.parkedVehicles=[];this.parkedKey=key;
    records.forEach((record,index)=>{const car=this.makeVehicle(record.id,record.appearance||{});car.position.set(GARAGE_PARKING_BAYS[index].x,record.id==='rocket'?.006:(car.userData.groundY||.006),GARAGE_PARKING_BAYS[index].z);this.scene.add(car);this.parkedVehicles.push(car);});
  }

  /** Select an actual geometry inspection view without hiding car parts or changing driving cameras. */
  setInspection(raw){
    const allowed=['overview','rear','wheels','cockpit'];
    let next=allowed.includes(raw)?raw:'overview';
    if(next==='cockpit'&&this.vehicle?.userData.ownedVehicleId!=='rocket')next='overview';
    if(next===this.inspection)return next;
    this.key.shadow.needsUpdate=true;
    if(this.lastWidth>0)this.cameraMotion.begin(this.camera,{reducedMotion:this.reducedMotion});
    this.inspection=next;this.orbitOffset=0;this.orbitRecovery=null;
    this.yaw=next==='rear'?2.5:-.63;this.pitch=.24;
    return this.inspection;
  }

  /** Direct manipulation: a foreground exterior surface follows the pointer; the car itself never rotates. */
  orbit(dx, dy) {
    const horizontal=Number(dx)||0,vertical=Number(dy)||0;
    if(this.cameraMotion.active&&this.inspection!=='cockpit'){
      const target=this.inspection==='wheels'?new T.Box3().setFromObject(this.vehicle.getObjectByName('wheel_fl')||this.vehicle,true).getCenter(new T.Vector3()):this.target;
      const delta=this.camera.position.clone().sub(target),radius=Math.hypot(delta.x,delta.z);
      const shownYaw=Math.atan2(delta.x,-delta.z);
      this.yaw=this.inspection==='wheels'?Math.max(-1.28,Math.min(.02,shownYaw)):shownYaw;
      const shownPitch=Math.asin(Math.max(-1,Math.min(1,delta.y/Math.max(.01,radius))));
      this.pitch=Math.max(.13,Math.min(.48,shownPitch));
      // Keep the full displayed pose at takeover, then restore mode limits and
      // framing in 350 ms. Pointer deltas still act immediately on the requested orbit.
      this.orbitRecovery={radius:this.inspection==='wheels'?radius:delta.length(),progress:0,pitchOffset:shownPitch-this.pitch,yawOffset:shownYaw-this.yaw,
        target:this.camera.userData.garageLookTarget?.clone(),points:this.camera.userData.garageFocusPoints?.map(point=>point.clone()),fov:this.camera.fov,near:this.camera.near,offsetX:this.camera.view?.offsetX||0,offsetY:this.camera.view?.offsetY||0};
      this.cameraMotion.active=false;
    }
    this.yaw+=horizontal*.004;
    if(this.inspection==='wheels')this.yaw=Math.max(-1.28,Math.min(.02,this.yaw));
    else this.yaw=Math.atan2(Math.sin(this.yaw),Math.cos(this.yaw));
    // Inside, moving the look target left moves the actual wheel/tablet surface right.
    this.orbitOffset=Math.max(-.4,Math.min(.4,this.orbitOffset-horizontal*.003));
    this.pitch=Math.max(.13,Math.min(.48,this.pitch+vertical*.003));
  }

  /** Render one parked showcase frame, restoring the road exposure after the shared renderer call. */
  render(width, height, region=null, { stableOrbit = true } = {}) {
    if (this.disposed || !this.ready || !this.vehicle) return false;
    if(this.environmentDirty){try{this.rebuildEnvironment();}catch(error){this.environmentDirty=false;this.onStatus({error:String(error.message||error)});}}
    const aspect = Math.max(.25, width / Math.max(1, height));
    if (width !== this.lastWidth || height !== this.lastHeight) {
      this.camera.aspect = aspect; this.camera.fov = aspect < 1 ? 49 : 38; this.camera.updateProjectionMatrix();
      this.lastWidth = width; this.lastHeight = height;
    }
    // The car-fit region excludes the transparent title strip. The TV is still
    // genuinely visible there, particularly on short landscape phones. Only
    // the opaque side panels restrict its horizontal world viewport.
    this.screenRegion=region?{x:region.x,y:0,width:region.width,height}:{x:0,y:0,width,height};
    setPlayerInteriorView(this.vehicle,this.inspection==='cockpit');
    this.camera.near=this.inspection==='cockpit'?.025:.08;this.camera.updateProjectionMatrix();this.cameraContext=null;
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
        this.camera.userData.garageExterior=false;this.camera.userData.garageLookTarget=null;this.camera.userData.garageStableOrbit=null;
        this.camera.updateMatrixWorld();return this.drawScene();
      }
    }
    const minimumFov=aspect<1?49:38;
    const limits=this.cameraLimits||(this.cameraLimits=garageCameraLimits(this.room,[...this.parkedVehicles,this.toyProp.root].filter(Boolean)));
    let radius=Math.min((this.vehicleLength||4.7)*(aspect<1?1.95:1.75)*this.zoom,limits.orbitRadius);
    if(this.inspection==='wheels')radius=1.9;
    const vehicleBounds=stableOrbit&&this.inspection!=='wheels'?(this.orbitBounds||(this.orbitBounds=new T.Box3().setFromObject(this.vehicle,true))):new T.Box3().setFromObject(this.vehicle,true);
    if(stableOrbit&&this.inspection!=='wheels'){
      this.orbitEnvelope ||= garageOrbitEnvelope(this.vehicle,this.target);
      const desiredDistance=Math.min((this.vehicleLength||4.7)*(aspect<1?1.95:1.75),limits.orbitRadius)*GARAGE_ORBIT_DISTANCE_FACTOR*Math.max(.1,Number(this.zoom)||1);
      if(this.orbitDistanceLimits!==limits||this.orbitDistanceBounds!==vehicleBounds||this.orbitDistanceRequested!==desiredDistance){
        this.orbitDistance=this.zoom===1?desiredDistance:garageOrbitDistance(desiredDistance,limits,this.target,vehicleBounds);
        this.orbitDistanceLimits=limits;this.orbitDistanceBounds=vehicleBounds;this.orbitDistanceRequested=desiredDistance;
      }
      const distance=this.orbitDistance;
      const key=JSON.stringify([this.vehicleId,width,height,region,distance,minimumFov]);
      if(!this.orbitRig||this.orbitRigKey!==key){
        this.orbitRig=createGarageOrbitRig({envelope:this.orbitEnvelope,distance,width,height,region,minimumFov,referencePoints:garageBoxCorners(vehicleBounds),pivot:this.target});this.orbitRigKey=key;
        this.orbitFocusPoints=garageOrbitPoints(this.orbitEnvelope,this.target);
      }
      let rig=this.orbitRig,yaw=this.yaw,pitch=this.pitch,lookTarget=target;
      if(this.orbitRecovery){
        const recovery=this.orbitRecovery,p=recovery.progress,t=p*p*(3-2*p);
        yaw+=recovery.yawOffset*(1-t);pitch+=recovery.pitchOffset*(1-t);
        lookTarget=recovery.target?recovery.target.clone().lerp(target,t):target;
        rig={...rig,distance:T.MathUtils.lerp(recovery.radius,rig.distance,t),fov:T.MathUtils.lerp(recovery.fov,rig.fov,t),near:T.MathUtils.lerp(recovery.near,rig.near,t),offsetX:T.MathUtils.lerp(recovery.offsetX,rig.offsetX,t),offsetY:T.MathUtils.lerp(recovery.offsetY,rig.offsetY,t)};
      }
      applyGarageOrbitRig(this.camera,rig,target,yaw,Math.atan(Math.sin(pitch)),width,height);
      this.camera.lookAt(lookTarget);this.camera.updateMatrixWorld();this.camera.userData.garageLookTarget=lookTarget.clone();
      this.camera.userData.garageFocusPoints=this.orbitFocusPoints;
      this.cameraContext={limits,pivot:this.target.clone(),target:lookTarget,vehicleBounds,points:this.orbitFocusPoints,width,height,region,minimumFov:rig.fov,fixedProjection:rig};
      if(this.orbitRecovery)constrainGarageCamera(this.camera,this.cameraContext);
      return this.drawScene();
    }
    this.camera.userData.garageStableOrbit=null;
    let pitch=this.pitch,yaw=this.yaw,lookTarget=target,fitFov=minimumFov;
    let points=garageBoxCorners(focus===this.vehicle?vehicleBounds:new T.Box3().setFromObject(focus,true)),recoveryProjection=null;
    if(this.orbitRecovery){
      const destination=new T.PerspectiveCamera(minimumFov,aspect,.08,80);
      destination.position.copy(target).add(new T.Vector3(Math.sin(yaw)*radius,Math.sin(pitch)*radius,-Math.cos(yaw)*radius));
      constrainGarageCamera(destination,{limits,pivot:this.target.clone(),target,vehicleBounds,points,width,height,region,minimumFov});
      const recovery=this.orbitRecovery,p=recovery.progress,t=p*p*(3-2*p);
      recoveryProjection={fov:T.MathUtils.lerp(recovery.fov,destination.fov,t),near:T.MathUtils.lerp(recovery.near,destination.near,t),offsetX:T.MathUtils.lerp(recovery.offsetX,destination.view?.offsetX||0,t),offsetY:T.MathUtils.lerp(recovery.offsetY,destination.view?.offsetY||0,t)};
    }
    if(this.orbitRecovery){
      const recovery=this.orbitRecovery,p=recovery.progress,t=p*p*(3-2*p);
      radius=T.MathUtils.lerp(recovery.radius,radius,t);pitch+=recovery.pitchOffset*(1-t);yaw+=recovery.yawOffset*(1-t);
      if(recovery.target)lookTarget=recovery.target.clone().lerp(target,t);
      if(recovery.points?.length===points.length)points=recovery.points.map((point,index)=>point.clone().lerp(points[index],t));
      fitFov=T.MathUtils.lerp(recovery.fov,minimumFov,t);
      this.camera.near=T.MathUtils.lerp(recovery.near,this.camera.near,t);this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(target).add(new T.Vector3(Math.sin(yaw)*radius,Math.sin(pitch)*radius,-Math.cos(yaw)*radius));
    this.cameraContext={limits,pivot:this.target.clone(),target:lookTarget,vehicleBounds,points,width,height,region,minimumFov:fitFov,fixedProjection:recoveryProjection};
    constrainGarageCamera(this.camera,this.cameraContext);


    return this.drawScene();
  }

  /** Restore shared renderer exposure even when an inspection draw fails. */
  drawScene(){
    const exposure = this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = .84;
    try{this.paintTransition?.updateCoordinates();for(const wipe of this.rimTransitions)wipe.updateCoordinates();this.cameraMotion.apply(this.camera,this.lastWidth,this.lastHeight,this.cameraContext);this.screenDisplay.updateVisibility(this.camera,this.lastWidth,this.lastHeight,this.screenRegion);this.renderer.render(this.scene,this.camera);}finally{this.renderer.toneMappingExposure=exposure;}
    return true;
  }

  /** Release exclusively owned room GPU assets once; vehicle source buffers remain with the road asset cache. */
  dispose() {
    if (this.disposed) return; this.disposed = true; ++this.generation;
    this.paintTransition?.dispose();for(const wipe of this.rimTransitions)wipe.dispose();this.screenDisplay.dispose();this.toyProp.dispose();
    this.renderer.domElement?.removeEventListener('webglcontextrestored',this.onContextRestored);
    this.environmentTarget?.dispose(); this.key.shadow.map?.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const promise of this.cache.values()) void promise.then(room => {
      room.traverse(node => {
        if (!node.isMesh) return;
        geometries.add(node.geometry);
        for (const material of [...(Array.isArray(node.material) ? node.material : [node.material]),...(node.userData.garageScreenOriginalMaterials||[])]) {
          if(material.userData?.garageScreenOwned)continue;
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
