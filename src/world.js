import * as T from '../public/vendor/three.js';
import { createCar } from './car.js';
import { loadAssets } from './assets.js';
import { ROUTES } from './config.js';
import { updateChase } from './motion.js';
import { seededRandom } from './util.js';

export const roadBend = (z, distance = 0) => Math.sin(distance / 1100 + .35) * .00055 * Math.min(z, 0) ** 2;
export class RoadRenderer {
  constructor(canvas, onProgress) {
    this.canvas = canvas; this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    // A fixed render surface avoids reallocating WebKit's canvas during layout/rotation.
    // The camera aspect and CSS dimensions adapt independently to the viewport.
    const renderEdge = Math.min(1536, Math.ceil(Math.max(innerWidth, innerHeight) * 1.1));
    this.renderer.setPixelRatio(1); this.renderer.setSize(renderEdge, renderEdge, false);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .72;
    this.scene = new T.Scene(); this.scene.background = new T.Color('#c7dce5');
    this.scene.fog = new T.Fog('#c9d6d5', 160, 510);
    this.camera = new T.PerspectiveCamera(54, 1, .15, 1200);
    this.traffic = new Map(); this.pickups = new Map(); this.trafficPool = []; this.pickupPool = []; this.props = []; this.impact = 0; this.particles = [];
    this.sparkGeometry = new T.SphereGeometry(.04,4,3); this.sparkMaterials = new Map();
    this.distance = 0; this.menuDistance = 0; this.route = 'ring'; this.needsRender = true; this.time = 0;
    this.view = {}; this.hazards = new Map(); this.hazardPools = { cone:[], barrier:[] };
    this.ready = this.initialize(onProgress); this.resize();
  }
  async initialize(onProgress) {
    this.assets = await loadAssets(onProgress);
    const a = this.assets, r = this.renderer;
    this.scene.background = a.sky;
    this.scene.backgroundIntensity = .72;
    this.scene.backgroundRotation.y = 1.3; this.scene.environmentRotation.y = 1.3;
    const pmrem = new T.PMREMGenerator(r);
    this.scene.environment = pmrem.fromEquirectangular(a.sky).texture; pmrem.dispose();
    this.scene.environmentIntensity = .5;
    this.scene.add(new T.HemisphereLight('#dbeaff', '#787358', .95));
    this.sun = new T.DirectionalLight('#fff2dc', 2.1); this.sun.position.set(-55, 85, 45);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 65, bottom: -65, near: 1, far: 230 });
    this.sun.shadow.bias = -.00025; this.sun.shadow.normalBias = .035; this.sun.shadow.radius = 3;
    this.sun.target.position.set(0,0,-28); this.scene.add(this.sun, this.sun.target);
    this.buildRoad(); this.buildLandscape();
    this.player = createCar(a.car, '#bb1711'); this.scene.add(this.player);
    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d'), gradient = ctx.createRadialGradient(64,64,5,64,64,64);
    gradient.addColorStop(0,'rgba(0,0,0,.75)'); gradient.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
    this.contactMaterial = new T.MeshBasicMaterial({ map: new T.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, opacity: .75 });
    this.addContact(this.player);
    this.buildEventObjects();
    this.loaded = true; this.needsRender = true; this.resize();
  }
  addContact(car) {
    const shadow = new T.Mesh(new T.PlaneGeometry(2.8, 5.6), this.contactMaterial);
    shadow.rotation.x = -Math.PI/2; shadow.position.y = .025; car.add(shadow);
  }
  strip(width, material, start = 0) {
    const geometry = new T.PlaneGeometry(width, 700, 1, 140);
    geometry.rotateX(-Math.PI/2); geometry.translate(start, .01, -300);
    const mesh = new T.Mesh(geometry, material); mesh.receiveShadow = true;
    mesh.userData.base = geometry.attributes.position.array.slice(); this.scene.add(mesh);
    this.strips.push(mesh); return mesh;
  }
  buildRoad() {
    const a = this.assets; this.strips = [];
    const road = new T.MeshStandardMaterial({ map:a.asphalt, normalMap:a.asphaltNormal, roughnessMap:a.asphaltRough, roughness:1, normalScale:new T.Vector2(.65,.65), color:'#bababa' });
    const mesh = this.strip(11.1, road);
    const uv = mesh.geometry.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*2.8,uv.getY(i)*105);
    const shoulder = new T.MeshStandardMaterial({ map:a.ground, normalMap:a.groundNormal, roughnessMap:a.groundRough, color:'#b1a68b' });
    for(const side of [-1,1]) {
      const ground = this.strip(2.7,shoulder,side*6.85); ground.position.y=-.03;
      const guv=ground.geometry.attributes.uv; for(let i=0;i<guv.count;i++) guv.setXY(i,guv.getX(i)*1.2,guv.getY(i)*140);
    }
    const white = new T.MeshStandardMaterial({ color:'#e6e4d9', roughness:.94 });
    for(const x of [-5.3,5.3]) { const stripe=this.strip(.13,white,x); stripe.position.y=.012; }
    this.dashes=[];
    const dashGeometry = new T.PlaneGeometry(.13,4.5); dashGeometry.rotateX(-Math.PI/2);
    for(const x of [-1.75,1.75]) for(let z=-650;z<55;z+=12) {
      const dash=new T.Mesh(dashGeometry,white); dash.position.set(x,.04,z); dash.userData={x,z}; this.scene.add(dash); this.dashes.push(dash);
    }
  }
  terrainHeight(x,z) {
    const edge=Math.max(0,Math.abs(x)-8);
    return -.08 + Math.min(1,edge/35)*(Math.sin(x*.028+z*.009)*6 + Math.sin(x*.011-z*.016)*4 + Math.max(0,edge-60)*.025);
  }
  buildLandscape() {
    const a=this.assets, random=seededRandom(81732);
    this.terrains=[];
    const material = new T.MeshStandardMaterial({ map:a.grass, normalMap:a.grassNormal, roughness:1, color:'#b0b58b', side:T.DoubleSide, normalScale:new T.Vector2(.4,.4) });
    for(const side of [-1,1]){
      const geo=new T.PlaneGeometry(650,1000,60,100); geo.rotateX(-Math.PI/2);
      const p=geo.attributes.position, uv=geo.attributes.uv;
      for(let i=0;i<p.count;i++){
        const x=(p.getX(i)+325+8)*side,z=p.getZ(i)-420;
        p.setXYZ(i,x,this.terrainHeight(x,z),z); uv.setXY(i,x/12,z/12);
      }
      geo.computeVertexNormals(); const mesh=new T.Mesh(geo,material); mesh.receiveShadow=true;
      mesh.userData.base=p.array.slice(); this.scene.add(mesh); this.terrains.push(mesh);
    }
    // Baked artist foliage retains irregular branches at a fraction of its source cost.
    this.treeMaterials=a.trees.map(map=>new T.MeshBasicMaterial({map,transparent:false,alphaTest:.36,side:T.DoubleSide,color:'#e0e4cf',fog:true}));
    const treeGeometry=new T.PlaneGeometry(1,1); treeGeometry.translate(0,.5,0);
    for(let i=0;i<340;i++) {
      const side=i%2?-1:1, x=side*(12+Math.pow(random(),1.7)*175), z=-random()*680+45;
      const tree=new T.Mesh(treeGeometry,this.treeMaterials[i%3]); const h=8+random()*11;
      tree.scale.set(h,h,1); tree.castShadow=Math.abs(x)<30; tree.receiveShadow=false;
      this.addProp(tree,x,z); tree.userData.type='tree'; tree.userData.r=random();
    }
    // Galvanized crash barriers, separate posts and small roadside delineators.
    const steel=new T.MeshStandardMaterial({color:'#a0a7a5',metalness:.75,roughness:.42});
    const postMat=new T.MeshStandardMaterial({color:'#e5dfcf',roughness:.8});
    const reflector=new T.MeshStandardMaterial({color:'#a72413',roughness:.5});
    for(const side of [-1,1]) {
      for(let z=-500;z<60;z+=5) {
        const post=new T.Mesh(new T.BoxGeometry(.11,.85,.1),steel); post.castShadow=true; this.addProp(post,side*7.55,z,.38);
      }
      for(let z=-500;z<60;z+=10){
        const rail=new T.Mesh(new T.BoxGeometry(.09,.24,10.05),steel); rail.castShadow=true;
        this.addProp(rail,side*7.55,z,.79); rail.userData.rail=true;
      }
      for(let z=-450;z<60;z+=35) {
        const marker=new T.Group(); const body=new T.Mesh(new T.BoxGeometry(.16,1.05,.12),postMat); body.position.y=.52;
        const cap=new T.Mesh(new T.BoxGeometry(.17,.18,.13),reflector); cap.position.y=.85; marker.add(body,cap);
        this.addProp(marker,side*8.2,z);
      }
    }
    // Road signs are physical plates with conventional typography.
    this.sign(90,'МОСКВА  124',-180,1);
    this.sign(70,'СОСНОВЫЙ БОР',-385,-1);
    this.buildGrass(random);
  }
  sign(speed,text,z,side) {
    const group=new T.Group(), pole=new T.Mesh(new T.CylinderGeometry(.055,.055,4.3,8),new T.MeshStandardMaterial({color:'#a4aaa8',metalness:.7,roughness:.6}));
    pole.position.y=2.1;group.add(pole);
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=256;
    const c=canvas.getContext('2d');c.fillStyle='#315b3d';c.fillRect(0,0,768,256);c.strokeStyle='#f8f5e9';c.lineWidth=9;c.strokeRect(10,10,748,236);
    c.fillStyle='#f8f5e9';c.font='bold 54px Arial';c.textAlign='center';c.fillText(text,384,112);c.font='42px Arial';c.fillText('↑   М-8',384,189);
    const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
    const plate=new T.Mesh(new T.PlaneGeometry(4,1.34),new T.MeshStandardMaterial({map,side:T.DoubleSide,roughness:.9}));plate.position.y=3.7;group.add(plate);
    this.addProp(group,side*11,z);group.userData.type='sign';group.userData.speed=speed;
  }
  buildGrass(random) {
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',new T.Float32BufferAttribute([-.035,0,0,.035,0,0,.018,.24,.014],3));geo.computeVertexNormals();
    const mat=new T.MeshStandardMaterial({color:'#777d3e',side:T.DoubleSide,roughness:1});
    this.grass=new T.InstancedMesh(geo,mat,8000);this.grass.receiveShadow=true;this.grass.frustumCulled=false;
    this.grassSeeds=[];for(let i=0;i<8000;i++)this.grassSeeds.push({x:(i%2?-1:1)*(8.4+random()*14),z:random()*380-340,s:.5+random(),angle:random()*Math.PI});
    this.scene.add(this.grass);this.dummy=new T.Object3D();
  }
  addProp(object,x,z,y=0) {
    object.userData={x,z,y,...object.userData};this.props.push(object);this.scene.add(object);
  }
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
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.needsRender=true;
  }
  render(state,{menu=false,dt=0,paused=false}={}) {
    if(!this.loaded)return;
    if(menu&&this.reducedMotion&&!this.needsRender&&this.wasMenu)return;
    this.needsRender=false;this.wasMenu=menu;this.time+=paused?0:dt;
    if(menu&&!this.reducedMotion)this.menuDistance+=dt*4;
    const distance=menu?this.menuDistance:state.distance, phone=this.camera.aspect<.8;
    this.distance=distance;
    const routeDensity=(ROUTES[this.route]||ROUTES.ring).density;
    for(const strip of [...this.strips,...this.terrains]){
      const p=strip.geometry.attributes.position,b=strip.userData.base;
      for(let i=0;i<p.count;i++)p.setX(i,b[i*3]+roadBend(b[i*3+2],distance));
      p.needsUpdate=true;strip.geometry.computeBoundingSphere();
    }
    for(const map of [this.assets.asphalt,this.assets.asphaltNormal,this.assets.asphaltRough])map.offset.y=distance/6.667;
    for(const map of [this.assets.ground,this.assets.groundNormal,this.assets.groundRough])map.offset.y=distance/5;
    for(const map of [this.assets.grass,this.assets.grassNormal])map.offset.y=-distance/12;
    for(const dash of this.dashes){
      const z=((dash.userData.z+distance)%708+708)%708-650;
      dash.position.set(dash.userData.x+roadBend(z,distance),.045,z);
      dash.rotation.y=-Math.atan((roadBend(z-1,distance)-roadBend(z+1,distance))/2);
    }
    for(const prop of this.props){
      const u=prop.userData,z=((u.z+distance)%700+700)%700-645;
      prop.position.set(u.x+roadBend(z,distance),u.y+(u.type==='tree'?this.terrainHeight(u.x,z):0),z);
      if(u.type==='tree'){prop.visible=u.r<routeDensity;prop.rotation.y=0;}
      if(u.rail)prop.rotation.y=-Math.atan((roadBend(z-1,distance)-roadBend(z+1,distance))/2);
    }
    this.grassSeeds.forEach((u,i)=>{
      const z=((u.z+distance)%400+400)%400-345;
      this.dummy.position.set(u.x+roadBend(z,distance),this.terrainHeight(u.x,z),z);
      this.dummy.scale.setScalar(u.s);this.dummy.rotation.set(0,u.angle,0);this.dummy.updateMatrix();this.grass.setMatrixAt(i,this.dummy.matrix);
    });this.grass.instanceMatrix.needsUpdate=true;
    const desiredX=menu?1.8:(state.x-1)*3.5;
    this.player.position.set(desiredX,.035+(menu?0:Math.sin(distance*2)*.003*Math.min(1,state.speed/30)),0);
    this.player.rotation.y=menu?-.22:-(state.heading||0);
    this.player.rotation.z=menu?0:(state.steerAngle||0)*Math.min(1,state.speed/30)*-.09;
    this.player.rotation.x=menu?0:Math.max(-.025,Math.min(.025,-(state.acceleration||0)*.0012));
    this.player.userData.brakeMaterial.emissiveIntensity=state.braking?1.2:.05;
    this.player.visible=state.invincible<=0||Math.floor(this.time*9)%2===0||menu;
    const spin=distance/.34;for(const wheel of this.player.userData.wheels){wheel.rotation.x=spin;if(wheel.name==='wheel_fl'||wheel.name==='wheel_fr')wheel.rotation.y=-(state.steerAngle||0);}
    const active=new Set();
    const traffic=menu?[{id:'m1',lane:0,z:45,color:2},{id:'m2',lane:2,z:76,color:3},{id:'m3',lane:1,z:120,color:0}]:state.traffic;
    for(const item of traffic){
      active.add(item.id);let car=this.traffic.get(item.id);
      if(!car){car=this.trafficPool.pop();if(!car){car=createCar(this.assets.car);this.addContact(car);}car.userData.paint.color.set(['#d5d4ce','#1c3447','#777e87','#a29375','#29362f'][item.color%5]);this.traffic.set(item.id,car);this.scene.add(car);}
      car.visible=true;car.position.set((item.lane-1)*3.5+roadBend(-item.z,distance),.035,-item.z);
      car.rotation.y=-Math.atan((roadBend(-item.z-1,distance)-roadBend(-item.z+1,distance))/2);
      for(const wheel of car.userData.wheels)wheel.rotation.x=(menu?distance:(state.elapsed||0)*(item.speed||0))/.34;
      car.userData.brakeMaterial.emissiveIntensity=item.braking?1.2:.05;
    }
    for(const [id,car]of this.traffic)if(!active.has(id)){this.scene.remove(car);this.trafficPool.push(car);this.traffic.delete(id);}
    const pickIds=new Set();
    for(const item of menu?[]:state.pickups){
      pickIds.add(item.id);let mesh=this.pickups.get(item.id);
      if(!mesh){mesh=this.pickupPool.pop();if(!mesh){mesh=new T.Group();const tank=new T.Mesh(new T.CylinderGeometry(.2,.2,.65,12),new T.MeshStandardMaterial({color:'#d9ac43',metalness:.7,roughness:.25}));const band=new T.Mesh(new T.CylinderGeometry(.205,.205,.13,12),new T.MeshStandardMaterial({color:'#eee8d9',roughness:.4}));mesh.add(tank,band);}this.pickups.set(item.id,mesh);this.scene.add(mesh);}
      mesh.position.set((item.lane-1)*3.5+roadBend(-item.z,distance),1+Math.sin(this.time*3)*.08,-item.z);mesh.rotation.z=Math.sin(this.time)*.15;
    }
    for(const[id,mesh]of this.pickups)if(!pickIds.has(id)){this.scene.remove(mesh);this.pickupPool.push(mesh);this.pickups.delete(id);}
    this.renderEvents(state,menu);
    updateChase(this.view,state,{phone,menu,dt});
    this.camera.fov=this.view.fov;this.camera.updateProjectionMatrix();
    this.camera.position.set(this.view.x,this.view.y,this.view.z);this.camera.lookAt(this.view.lookX,this.view.lookY,this.view.lookZ);
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
