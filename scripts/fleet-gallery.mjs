import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { TRAFFIC_CATALOG, TRAFFIC_CATEGORIES } from '../src/traffic-catalog.js';
const stage=process.argv[2]||'after',root=process.env.GALLERY_ROOT?path.resolve(process.env.GALLERY_ROOT):stage==='before'?path.resolve('output/fleet-baseline-source'):process.cwd();
const out=process.env.GALLERY_OUT||`output/fleet-${stage}`; await mkdir(out,{recursive:true});
const server=startServer({port:0,root});await once(server,'listening');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const records=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/.test(m.text()))errors.push(m.text());});
 await page.clock.install();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden,null,{timeout:120000});
 await page.evaluate(async()=>{const {RoadRenderer}=await import('./src/world.js');const original=RoadRenderer.prototype.render;RoadRenderer.prototype.render=function(s,o){window.__w=this;original.call(this,s,o);};});
 const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+10000));await page.clock.runFor(32);await page.waitForFunction(()=>window.__w);
 await page.addStyleTag({content:'#menu,.topbar,#hud,.scene-shade,#overlay{display:none!important} #fleet-label{position:fixed;top:30px;left:42px;color:#23313b;font-family:Arial,sans-serif;z-index:999;pointer-events:none;background:rgba(235,243,247,.88);padding:13px 18px;border-radius:12px} #fleet-label h1{font-size:30px;margin:0 0 8px} #fleet-label p{font-size:17px;margin:0;line-height:1.5} #fleet-note{position:fixed;bottom:24px;left:42px;color:#314650;font:14px Arial;z-index:999}'});
 await page.evaluate(async()=>{
  const T=await import('./public/vendor/three.js'),{createTrafficCar,animateTrafficCar}=await import('./src/traffic.js');window.__T=T;window.__makeTraffic=createTrafficCar;window.__animateTraffic=animateTrafficCar;
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
   const data=await page.evaluate(({kind,spec,category,view,stage})=>{
    const T=window.__T,scene=window.__galleryScene,w=window.__w,camera=window.__galleryCamera;
    if(window.__galleryCar)scene.remove(window.__galleryCar);const car=window.__makeTraffic(kind,kind==='towtruck'?'#b78338':'#668ba2');window.__galleryCar=car;scene.add(car);car.updateMatrixWorld(true);
    const bounds=new T.Box3().setFromObject(car),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
    const radius=size.length()/2,distance=radius/Math.sin(camera.fov*Math.PI/360)*1.04;
    const direction=new T.Vector3(.9,.53,view==='front'?-1:1).normalize();camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center.x,center.y*.88,center.z);
    if(view==='wheel'){const wheel=car.getObjectByName('wheel_fr'),p=wheel.getWorldPosition(new T.Vector3());camera.position.copy(p).add(new T.Vector3(2.25,1.05,-1.9));camera.lookAt(p.x,p.y+.09,p.z);}
    if(view==='cabin'){const front=-spec.length/2;camera.position.set(2.8,spec.height*.7+.35,front-2.3);camera.lookAt(0,spec.height*.58,front+1.25);}
    if(view==='mirror'){const front=-spec.length/2;camera.position.set(spec.width/2+2.1,spec.height*.59+.16,front+3.5);camera.lookAt(spec.width*.44,spec.height*.58,front+1.4);}
    if(['driver','gesture','footwell'].includes(view)){const wheel=car.getObjectByName('steering_wheel'),p=wheel?wheel.getWorldPosition(new T.Vector3()):new T.Vector3(-.5,spec.height*.58,-spec.length/2+1);
      if(view==='footwell'){camera.position.set(p.x+.95,p.y+.32,p.z+.35);camera.lookAt(p.x,p.y-.62,p.z-.08);}
      else{camera.position.set(p.x+.25,p.y+.45,p.z-1.65);camera.lookAt(p.x,p.y+.18,p.z+.35);}
      if(view==='gesture')window.__animateTraffic(car,{kind,speed:12,z:20,signal:-1,signalTime:.25,laneCurvature:-.009,acceleration:0,travelDistance:0},0,1/60);
    }
    document.getElementById('fleet-label').innerHTML=`<h1>${spec.label} · ${stage==='before'?'до':'новая модель'}</h1><p>${category} · ${size.z.toFixed(2)} × ${size.x.toFixed(2)} × ${size.y.toFixed(2)} м<br>${view==='driver'?'Водитель и рулевое управление':view==='gesture'?'Левая рука у переключателя поворотника':view==='footwell'?'Внутренний пол и колёсные кожухи':view==='mirror'?'Салон и отражающая поверхность зеркала':view==='cabin'?'Остекление, салон и зеркало':view==='wheel'?'Колесо и арка':view==='front'?'Передний ракурс':'Задний ракурс'}</p>`;
    w.renderer.info.reset();w.renderer.render(scene,camera);let meshes=0,triangles=0;car.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;}});
    return{kind,category,view,dimensions:{length:size.z,width:size.x,height:size.y},meshes,triangles,drawCalls:w.renderer.info.render.calls,submittedTriangles:w.renderer.info.render.triangles,wheels:car.userData.wheels.length};
   },{kind,spec,category,view,stage});
   await page.screenshot({path:`${out}/${kind}-${view}.png`});records.push(data);console.log(stage,kind,view,JSON.stringify(data));
  }
 }
 if(errors.length)throw new Error(errors.join('\n'));await writeFile(`${out}/metrics.json`,JSON.stringify({stage,method:'Individual fitted inspection views under identical studio key/fill and existing sky environment. Not a selectable game camera or FPS measurement.',records,errors},null,2));
 console.log('PASS gallery',stage);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
