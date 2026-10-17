import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { TRAFFIC_CATALOG, TRAFFIC_CATEGORIES } from '../src/traffic-catalog.js';
const stage=process.argv[2]||'after',root=process.env.GALLERY_ROOT?path.resolve(process.env.GALLERY_ROOT):stage==='before'?path.resolve('output/fleet-baseline-source'):process.cwd();
const out=process.env.GALLERY_OUT||`output/fleet-${stage}`; await mkdir(out,{recursive:true});
const server=startServer({port:0,root});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const records=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/.test(m.text()))errors.push(m.text());});
 await page.clock.install();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden,null,{timeout:120000});
 await page.evaluate(async()=>{const {RoadRenderer}=await import('./src/world.js');const original=RoadRenderer.prototype.render;/** Capture the live renderer instance and forward its state/options for gallery setup. */ RoadRenderer.prototype.render=function(s,o){window.__w=this;original.call(this,s,o);};});
 const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+10000));await page.clock.runFor(32);await page.waitForFunction(()=>window.__w);
 if(process.env.GALLERY_RETRY_CHECK){
  const retry=await page.evaluate(async()=>{
   const {Game}=await import('./src/game.js'),g=new Game(),w=window.__w;
   /**
    * Replace the fixture traffic with ID 1, render without time advance and return it.
    * Reusing the ID across kinds/resets exercises pool ownership, paint and motion reset.
    * @param {string} kind - Requested catalog kind.
    * @param {number} [color=0] - Palette index.
    * @returns {object} Runtime model currently stored by the observed renderer.
    */
   const render=(kind,color=0)=>{g.state.traffic=[{id:1,kind,color,lane:1,z:35,speed:0,travelDistance:0}];w.render(g.state,{dt:0});return w.traffic.get(1);};
   const old=render('sedan');old.userData.motion.pitch=.02;
   g.reset();const next=render('semi',1);
   if(next===old||next.userData.kind!=='semi'||!next.userData.trailer||next.userData.wheels.length!==10)throw new Error('Retry reused the previous vehicle kind');
   if(!w.trafficPool.get('sedan')?.includes(old))throw new Error('Previous car not pooled by its own kind');
   next.userData.motion.pitch=.02;g.reset();const sameKind=render('semi',4);
   if(sameKind.userData.motion.pitch!==0||sameKind.userData.paint.color.getHexString()!=='3f6050')throw new Error('Same-kind retry retained motion or paint');
   const changed=render('firetruck');if(changed===sameKind||changed.userData.kind!=='firetruck'||changed.userData.wheels.length!==6)throw new Error('Same-ID kind replacement failed');
   if(render('firetruck')!==changed)throw new Error('Ordinary frame unnecessarily recreated traffic');
   return{immediateRetry:true,sameKindReset:true,kindReplacement:true};
  });console.log('PASS actual renderer retry',JSON.stringify(retry));
 }
 await page.addStyleTag({content:'#menu,.topbar,#hud,.scene-shade,#overlay{display:none!important} #fleet-label{position:fixed;top:30px;left:42px;color:#23313b;font-family:Arial,sans-serif;z-index:999;pointer-events:none;background:rgba(235,243,247,.88);padding:13px 18px;border-radius:12px} #fleet-label h1{font-size:30px;margin:0 0 8px} #fleet-label p{font-size:17px;margin:0;line-height:1.5} #fleet-note{position:fixed;bottom:24px;left:42px;color:#314650;font:14px Arial;z-index:999}'});
 /**
  * Create a separate lit studio scene using the loaded game's environment.
  * Adds gallery labels and caches constructors for inspection views; it is neither
  * a selectable gameplay camera nor a physical-device performance measurement.
  */
 await page.evaluate(async()=>{
  const T=await import('./public/vendor/three.js'),{createTrafficCar,animateTrafficCar}=await import('./src/traffic.js');window.__limitSuspension=(await import('./src/traffic-motion.js')).limitTrafficSuspension;window.__T=T;window.__makeTraffic=createTrafficCar;window.__animateTraffic=animateTrafficCar;
  const w=window.__w,scene=new T.Scene();scene.background=new T.Color('#b8cbd3');scene.environment=w.scene.environment;scene.environmentIntensity=w.scene.environmentIntensity;
  const hemi=new T.HemisphereLight('#dcecff','#a6a393',1.55);scene.add(hemi);
  const sun=new T.DirectionalLight('#fff8ee',2.35);sun.position.set(-12,18,-10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:1,far:80});sun.shadow.normalBias=.025;scene.add(sun,sun.target);
  const floor=new T.Mesh(new T.PlaneGeometry(150,150),new T.MeshStandardMaterial({color:'#9ca9ae',roughness:.92}));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;floor.receiveShadow=true;scene.add(floor);
  window.__galleryScene=scene;window.__galleryCamera=new T.PerspectiveCamera(34,1280/720,.1,180);w.renderer.info.autoReset=false;
  const label=document.createElement('div');label.id='fleet-label';document.body.append(label);const note=document.createElement('div');note.id='fleet-note';note.textContent='Оригинальные игровые модели · обзор для проверки, не новая игровая камера';document.body.append(note);
 });
 const kinds=process.env.GALLERY_KINDS?process.env.GALLERY_KINDS.split(','):stage==='before'?['sedan','hatch','suv','van']:Object.keys(TRAFFIC_CATALOG);
 for(const kind of kinds){
  const spec=TRAFFIC_CATALOG[kind],category=TRAFFIC_CATEGORIES[spec.category].label;
  for(const view of (process.env.GALLERY_VIEWS||'front,rear').split(',')){
   /**
    * Create and pose one gallery vehicle, fit an inspection camera and draw it.
    * Mutates the gallery scene, camera and labels; specialized views deliberately
    * prescribe steering/suspension/articulation. Returned geometry sizes are metres,
    * but fitted cameras mean vehicles are not photographed at a common scale.
    */
   const data=await page.evaluate(({kind,spec,category,view,stage})=>{
    const T=window.__T,scene=window.__galleryScene,w=window.__w,camera=window.__galleryCamera;
    if(window.__galleryCar)scene.remove(window.__galleryCar);const car=window.__makeTraffic(kind,kind==='towtruck'?'#b78338':'#668ba2');window.__galleryCar=car;scene.add(car);car.updateMatrixWorld(true);
    const bounds=new T.Box3().setFromObject(car),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
    const radius=size.length()/2,distance=radius/Math.sin(camera.fov*Math.PI/360)*1.04;
    const direction=new T.Vector3(.9,.53,view==='front'?-1:1).normalize();camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center.x,center.y*.88,center.z);
    if(view==='wheel'){const wheel=car.getObjectByName('wheel_fr'),p=wheel.getWorldPosition(new T.Vector3());camera.position.copy(p).add(new T.Vector3(2.25,1.05,-1.9));camera.lookAt(p.x,p.y+.09,p.z);}
    if(view==='cabin'){const front=-spec.length/2;camera.position.set(2.8,spec.height*.7+.35,front-2.3);camera.lookAt(0,spec.height*.58,front+1.25);}
    if(view==='mirror'){const front=-spec.length/2;camera.position.set(spec.width/2+2.1,spec.height*.59+.16,front+3.5);camera.lookAt(spec.width*.44,spec.height*.58,front+1.4);}
    if(['driver','gesture','glance','footwell'].includes(view)){const wheel=car.getObjectByName('steering_wheel'),p=wheel?wheel.getWorldPosition(new T.Vector3()):new T.Vector3(-.5,spec.height*.58,-spec.length/2+1);
      if(view==='footwell'){camera.position.set(p.x+.95,p.y+.32,p.z+.35);camera.lookAt(p.x,p.y-.62,p.z-.08);}
      else{camera.position.set(p.x+.25,p.y+.45,p.z-1.65);camera.lookAt(p.x,p.y+.18,p.z+.35);}
      if(view==='gesture'||view==='glance')for(let step=0;step<21;step++)window.__animateTraffic(car,{kind,speed:12,z:20,signal:-1,signalTime:step/60,laneCurvature:-.009,acceleration:0,travelDistance:step*.2},-385,1/60);
    }
    if(view.startsWith('steer-')){
      const sign=view.endsWith('left')?-1:1;
      for(let i=0;i<60;i++)window.__animateTraffic(car,{kind,speed:3.5,z:0,signal:sign,signalTime:1+i/60,laneCurvature:sign/12,lateralAcceleration:sign*3.5*3.5/12,travelDistance:i*3.5/60},-385,1/60);
      car.updateMatrixWorld(true);const p=car.getObjectByName('wheel_fr').getWorldPosition(new T.Vector3());camera.up.set(0,1,0);camera.position.copy(p).add(new T.Vector3(3.1,1.45,-2.75));camera.lookAt(p.x-.2,p.y+.15,p.z);camera.fov=34;camera.updateProjectionMatrix();
    }
    if(view.startsWith('clearwheel-')){
      const sign=view.endsWith('left')?1:-1,m={pitch:.05,roll:.06,pitchVelocity:0,rollVelocity:0};window.__limitSuspension(m,car.userData.suspensionWheels,car.userData.bodyRig.position,spec.bodyCompression);car.userData.bodyRig.rotation.set(m.pitch,0,m.roll);for(const w of car.userData.wheelRest)if(w.front)w.wheel.rotation.y=sign*.6;car.updateMatrixWorld(true);const p=car.getObjectByName('wheel_fr').getWorldPosition(new T.Vector3());camera.up.set(0,1,0);camera.position.copy(p).add(new T.Vector3(3.1,1.45,-2.75));camera.lookAt(p.x-.2,p.y+.15,p.z);camera.fov=34;camera.updateProjectionMatrix();
    }
    if(view.startsWith('gap-')){
      const side=view.includes('left')?-1:1,angle=side*52.5*Math.PI/180;
      car.userData.bodyRig.rotation.set(.05,0,.06);car.userData.trailerRig.rotation.set(.015,0,.039);car.userData.trailer.rotation.y=angle;car.updateMatrixWorld(true);
      const joint=new T.Vector3(0,1.8,spec.hitchZ-.65);
      if(view.endsWith('top')){camera.up.set(0,0,-1);camera.position.set(joint.x,17,joint.z);camera.lookAt(joint);}
      else{camera.up.set(0,1,0);camera.position.set(-side*10,6.3,spec.hitchZ-1.6);camera.lookAt(joint);}
      camera.fov=view.endsWith('top')?34:39;camera.updateProjectionMatrix();
    }
    document.getElementById('fleet-label').innerHTML=`<h1>${spec.label} · ${stage==='before'?'до':'новая модель'}</h1><p>${category} · ${size.z.toFixed(2)} × ${size.x.toFixed(2)} × ${size.y.toFixed(2)} м<br>${view.startsWith('clearwheel-')?'Предельный зазор: 34,4° колеса, с ограничителями хода':view.startsWith('steer-')?'Передняя ось: проверка поворота радиусом 12 м':view.startsWith('gap-')?'Проверка зазора: 52,5° сочленения + предельный наклон':view==='glance'?'Взгляд в зеркало перед манёвром':view==='driver'?'Водитель и рулевое управление':view==='gesture'?'Левая рука у переключателя поворотника':view==='footwell'?'Внутренний пол и колёсные кожухи':view==='mirror'?'Салон и отражающая поверхность зеркала':view==='cabin'?'Остекление, салон и зеркало':view==='wheel'?'Колесо и арка':view==='front'?'Передний ракурс':'Задний ракурс'}</p>`;
    w.renderer.info.reset();w.renderer.render(scene,camera);let meshes=0,triangles=0;car.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;}});
    return{kind,category,view,dimensions:{length:size.z,width:size.x,height:size.y},meshes,triangles,drawCalls:w.renderer.info.render.calls,submittedTriangles:w.renderer.info.render.triangles,wheels:car.userData.wheels.length,bodyPitch:car.userData.bodyRig.rotation.x,bodyRoll:car.userData.bodyRig.rotation.z};
   },{kind,spec,category,view,stage});
   await page.screenshot({path:`${out}/${kind}-${view}.png`});records.push(data);console.log(stage,kind,view,JSON.stringify(data));
  }
 }
 if(errors.length)throw new Error(errors.join('\n'));await writeFile(`${out}/metrics.json`,JSON.stringify({stage,method:'Individual fitted inspection views under identical studio key/fill and existing sky environment. Not a selectable game camera or FPS measurement.',records,errors},null,2));
 console.log('PASS gallery',stage);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
