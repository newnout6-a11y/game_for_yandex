import * as T from '../public/vendor/three.js';
import { createCar } from './car.js';
import { loadAssets, createSkyReflectionSource } from './assets.js';
import { renderDimensions, textureAnisotropy } from './render-settings.js';
import { updateChase } from './motion.js';
import { createTrafficCar, normalizeTrafficKind, installTrafficTemplates, resetTrafficMotion, animateTrafficCar } from './traffic.js';
import { trafficDefinition } from './traffic-catalog.js';
import { trafficLateral } from './traffic-behavior.js';
import { trafficYaw, trailerYaw } from './traffic-physics.js';
import { createThrusterEffects } from './thrusters.js';
import { buildScenicLandscape, updateScenicLandscape, scenicTerrainHeight } from './landscape.js';

let bendDistance = NaN, bendCoefficient = 0;
export function roadBend(z, distance = 0) {
  if(distance!==bendDistance){bendDistance=distance;bendCoefficient=Math.sin(distance/1100+.35)*.00055;}
  return bendCoefficient*Math.min(z,0)**2;
}
export class RoadRenderer {
  constructor(canvas, onProgress) {
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
  async initialize(onProgress) {
    this.assets = await loadAssets(onProgress, { anisotropy: textureAnisotropy(this.renderer.capabilities.getMaxAnisotropy(), this.compact) });
    const a = this.assets, r = this.renderer;
    installTrafficTemplates(a.traffic);
    // Neutral daylight key plus broad sky/road bounce. No camera-mounted fill
    // and no extra shadow pass: the underbody follows the same world lighting.
    this.daylightFill = new T.HemisphereLight('#dcecff', '#a6a393', 1.55);
    this.scene.add(this.daylightFill);
    this.sun = new T.DirectionalLight('#fff8ee', 2.35); this.sun.position.set(-55, 85, 45);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024,1024);
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
    this.player = createCar(a.car, '#b9c4cc'); this.scene.add(this.player);
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
  addContact(car) {
    const shadow = new T.Mesh(new T.PlaneGeometry(2.8, 5.6), this.contactMaterial);
    shadow.rotation.x = -Math.PI/2; shadow.position.y = .025; car.add(shadow);
    car.userData.contactShadow=shadow;
  }
  buildFlightEffects() {
    this.flightEffects = createThrusterEffects(this.scene, this.player, { compact: this.compact, reducedMotion: this.reducedMotion });
    this.rollPivot = new T.Vector3();
  }
  strip(width, material, start = 0) {
    const geometry = new T.PlaneGeometry(width, 700, 1, 140);
    geometry.rotateX(-Math.PI/2); geometry.translate(start, .01, -300);
    const mesh = new T.Mesh(geometry, material); mesh.receiveShadow = true;
    mesh.userData.base = geometry.attributes.position.array.slice();
    // Conservative bound includes the maximum road bend; no per-frame vertex scan.
    geometry.boundingSphere = new T.Sphere(new T.Vector3(0, 0, -300), 460);
    this.scene.add(mesh);
    this.strips.push(mesh); return mesh;
  }
  buildRoad() {
    const a = this.assets; this.strips = [];
    const road = new T.MeshStandardMaterial({ map:a.asphalt, normalMap:a.asphaltNormal, roughness:1, normalScale:new T.Vector2(.28,.28), color:'#bababa' });
    const mesh = this.strip(11.1, road);
    const uv = mesh.geometry.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*2.8,uv.getY(i)*105);
    const shoulder = new T.MeshStandardMaterial({ map:a.ground, roughness:1, color:'#b1a68b' });
    for(const side of [-1,1]) {
      const ground = this.strip(2.7,shoulder,side*6.85); ground.position.y=-.03;
      const guv=ground.geometry.attributes.uv; for(let i=0;i<guv.count;i++) guv.setXY(i,guv.getX(i)*1.2,guv.getY(i)*140);
    }
    const white = new T.MeshStandardMaterial({ color:'#e6e4d9', roughness:.94 });
    for(const x of [-5.3,5.3]) { const stripe=this.strip(.13,white,x); stripe.position.y=.012; }
    this.dashSeeds=[];
    const dashGeometry = new T.PlaneGeometry(.13,4.5); dashGeometry.rotateX(-Math.PI/2);
    for(const x of [-1.75,1.75]) for(let z=-650;z<55;z+=12) this.dashSeeds.push({x,z});
    this.dashes=new T.InstancedMesh(dashGeometry,white,this.dashSeeds.length);
    this.dashes.name='lane-markings'; this.dashes.frustumCulled=false;
    this.dashes.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.dashTransform=new T.Object3D(); this.scene.add(this.dashes);

  }
  terrainHeight(x,z) { return scenicTerrainHeight(x,z); }
  buildLandscape() { buildScenicLandscape(this,roadBend); }
  setRoute(route) { this.route=route;this.needsRender=true; }
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
  effect(kind) {
    if(kind==='crash') {this.impact=1; this.spawnParticles(34,'#e8b96a');}
    if(kind==='near') this.spawnParticles(5,'#b7a890');
    if(kind==='charge') this.spawnParticles(12,'#d9d5b0');
    if(kind==='cone') this.spawnParticles(8,'#b7a890');
  }
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
  resize() {
    const w=innerWidth,h=innerHeight;
    this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';
    this.compact = matchMedia('(pointer: coarse)').matches || Math.min(w,h)<600;
    const size=renderDimensions(w,h,devicePixelRatio||1,this.compact);
    if(this.canvas.width!==size.width||this.canvas.height!==size.height)this.renderer.setSize(size.width,size.height,false);
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.needsRender=true;
  }
  render(state,{menu=false,dt=0,paused=false}={}) {
    if(!this.loaded)return;
    if(menu&&this.reducedMotion&&!this.needsRender&&this.wasMenu)return;
    if(paused&&!menu&&this.wasPaused&&!this.needsRender&&this.pausedFor>.6&&!this.particles.length&&!this.impact)return;
    this.pausedFor=paused&&!menu?(this.pausedFor||0)+dt:0;this.wasPaused=paused&&!menu;
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
      const z=((seed.z+distance)%708+708)%708-650;
      dash.position.set(seed.x+roadBend(z,distance),.045,z);
      dash.rotation.y=-Math.atan((roadBend(z-1,distance)-roadBend(z+1,distance))/2);
      dash.updateMatrix();this.dashes.setMatrixAt(i,dash.matrix);
    }
    this.dashes.instanceMatrix.needsUpdate=true;
    updateScenicLandscape(this,distance,this.route);
    const desiredX=menu?1.8:(state.x-1)*3.5;
    const altitude=menu?0:(state.altitude||0);
    this.player.position.set(desiredX,.035+altitude+(menu?0:Math.sin(distance*2)*.003*Math.min(1,state.speed/30)),0);
    this.player.rotation.y=menu?-.22:-(state.heading||0);
    this.player.rotation.order='YXZ';
    this.player.rotation.z=menu?0:(state.rollAngle||0)+(state.steerAngle||0)*Math.min(1,state.speed/30)*-.09;
    this.player.rotation.x=menu?0:Math.max(-.025,Math.min(.025,-(state.acceleration||0)*.0012))+(state.flying?-.035:0);
    // Keep the cabin centre on the flight path, not the model's ground-level origin.
    if (!menu && state.rollAngle) {
      this.rollPivot.set(0,.58,0).applyEuler(this.player.rotation);
      this.player.position.x-=this.rollPivot.x;
      this.player.position.y+=.58-this.rollPivot.y;
      this.player.position.z-=this.rollPivot.z;
    }
    this.player.userData.brakeMaterial.emissiveIntensity=state.braking?2:.55;
    const contact=this.player.userData.contactShadow;
    contact.position.set(desiredX,.028,0);contact.scale.setScalar(1+altitude*.15);contact.material.opacity=.62-altitude*.1;
    this.player.updateMatrixWorld(true);
    this.flightEffects.update(menu ? { phase:'menu', altitude:0, thrusterPower:0, distance } : state, paused ? 0 : dt, this.time);
    this.player.visible=state.invincible<=0||Math.floor(this.time*9)%2===0||menu;
    const spin=distance/.34;for(const wheel of this.player.userData.wheels){wheel.rotation.x=spin;if(wheel.name==='wheel_fl'||wheel.name==='wheel_fr')wheel.rotation.y=-(state.steerAngle||0);}
    const active=new Set();
    const traffic=menu?[{id:'m1',lane:0,z:45,color:2,kind:'suv'},{id:'m2',lane:2,z:76,color:3,kind:'van'},{id:'m3',lane:1,z:120,color:0,kind:'sedan'}]:state.traffic;
    for(const item of traffic){
      active.add(item.id);let car=this.traffic.get(item.id);
      if(!car){
        const kind=normalizeTrafficKind(item.kind),pool=this.trafficPool.get(kind)||[];
        car=pool.pop();if(!car){car=createTrafficCar(kind);this.addContact(car);const spec=trafficDefinition(kind);car.userData.contactShadow.scale.set(spec.width/2.1,spec.length/4.7,1);}
        if(car.userData.paint && car.userData.category!=='special')car.userData.paint.color.set(['#d5d4ce','#294f6a','#697b87','#ae8e58','#3f6050','#8d342c','#dce6e6'][item.color%7||0]);
        resetTrafficMotion(car);this.traffic.set(item.id,car);this.scene.add(car);
      }
      car.visible=true;car.position.set((trafficLateral(item)-1)*3.5+roadBend(-item.z,distance),car.userData.groundY,-item.z);
      car.rotation.y=trafficYaw(item,distance);
      if(car.userData.trailer)car.userData.trailer.rotation.y=trailerYaw(item,distance);
      animateTrafficCar(car,menu?{...item,speed:4,travelDistance:distance}:item,distance,paused?0:dt);
      car.userData.contactShadow.position.y=.025-car.userData.groundY;
      if(car.userData.brakeMaterial)car.userData.brakeMaterial.emissiveIntensity=item.braking?1.2:.05;
    }
    for(const [id,car]of this.traffic)if(!active.has(id)){this.scene.remove(car);const kind=car.userData.kind;if(!this.trafficPool.has(kind))this.trafficPool.set(kind,[]);this.trafficPool.get(kind).push(car);this.traffic.delete(id);}
    const pickIds=new Set();
    for(const item of menu?[]:state.pickups){
      pickIds.add(item.id);let mesh=this.pickups.get(item.id);
      if(!mesh){mesh=this.pickupPool.pop();if(!mesh){mesh=new T.Group();const tank=new T.Mesh(new T.CylinderGeometry(.2,.2,.65,12),new T.MeshStandardMaterial({color:'#d9ac43',metalness:.7,roughness:.25}));const band=new T.Mesh(new T.CylinderGeometry(.205,.205,.13,12),new T.MeshStandardMaterial({color:'#eee8d9',roughness:.4}));mesh.add(tank,band);}this.pickups.set(item.id,mesh);this.scene.add(mesh);}
      mesh.position.set((item.lane-1)*3.5+roadBend(-item.z,distance),1+Math.sin(this.time*3)*.08,-item.z);mesh.rotation.z=Math.sin(this.time)*.15;
    }
    for(const[id,mesh]of this.pickups)if(!pickIds.has(id)){this.scene.remove(mesh);this.pickupPool.push(mesh);this.pickups.delete(id);}
    this.renderEvents(state,menu);
    updateChase(this.view,state,{phone,menu,dt});
    if(this.camera.fov!==this.view.fov){this.camera.fov=this.view.fov;this.camera.updateProjectionMatrix();}
    this.camera.position.set(this.view.x,this.view.y+altitude*.78,this.view.z);this.camera.lookAt(this.view.lookX,this.view.lookY+altitude*.62,this.view.lookZ);
    this.impact=Math.max(0,this.impact-dt*2);
    if(this.impact&&!this.reducedMotion){this.camera.position.x+=Math.sin(this.impact*53)*this.impact*.12;this.camera.position.y+=Math.cos(this.impact*61)*this.impact*.08;}
    for(const p of [...this.particles]){
      p.life-=dt;p.v.y-=dt*9;p.mesh.position.addScaledVector(p.v,dt);
      if(p.mesh.position.y<.03){p.mesh.position.y=.03;p.v.y=Math.abs(p.v.y)*.25;}
      if(p.life<=0){this.scene.remove(p.mesh);this.particles.splice(this.particles.indexOf(p),1);}
    }
    this.renderer.render(this.scene,this.camera);
  }
}
