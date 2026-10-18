import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {
  mirrorReflectionMatrix, createPlanarMirrorCamera, updatePlanarMirrorCamera, createPlayerMirrors, playerMirrorBudget,
} from '../src/player-mirrors.js';
import { createCar, animatePlayerBody, setPlayerAeroPose } from '../src/car.js';
import { createCockpitView, updateCockpitCamera } from '../src/camera-view.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const near = (actual,expected,tolerance=1e-8) => assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} ≈ ${expected}`);
const vectorNear = (actual,expected,tolerance=1e-8) => actual.toArray().forEach((value,index)=>near(value,expected.toArray()[index],tolerance));
const corners = [new T.Vector3(-1,-.35,0),new T.Vector3(1,-.35,0),new T.Vector3(1,.35,0),new T.Vector3(-1,.35,0)];

/** Minimal renderer records real reflection cameras without pretending to test GPU pixels. */
function fakeRenderer() {
  const calls = [], listeners = new Map();
  let target = {name:'previous-target'}, viewport = new T.Vector4(11,12,1000,700), scissor = new T.Vector4(21,22,900,600), scissorTest = true;
  return {
    calls, listeners, xr:{enabled:true}, shadowMap:{enabled:true,autoUpdate:true,needsUpdate:true}, autoClear:false,
    state:{buffers:{depth:{setMask(value){ assert.equal(value,true); }}}},
    domElement:{addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name,callback){if(listeners.get(name)===callback)listeners.delete(name);}},
    getRenderTarget(){return target;},setRenderTarget(value,face=2,mip=1){target=value;this.face=face;this.mip=mip;},
    getActiveCubeFace(){return this.face??2;},getActiveMipmapLevel(){return this.mip??1;},
    getViewport(out){return out.copy(viewport);},setViewport(x,y,w,h){viewport=x.isVector4?x.clone():new T.Vector4(x,y,w,h);},
    getScissor(out){return out.copy(scissor);},setScissor(value){scissor=value.clone();},
    getScissorTest(){return scissorTest;},setScissorTest(value){scissorTest=value;},
    clear(){},
    render(scene,camera){
      assert.equal(this.xr.enabled,false);assert.equal(this.shadowMap.autoUpdate,false);assert.equal(this.shadowMap.needsUpdate,false);
      const visible=[];scene.traverseVisible(node=>{if(node.isMesh)visible.push(node.name);});
      const shadows=[];scene.traverseVisible(node=>{if(node.isLight)shadows.push({name:node.name,castShadow:node.castShadow});});
      calls.push({camera:camera.clone(),target,visible,fog:scene.fog,shadows,shadowEnabled:this.shadowMap.enabled});
      if(this.fail)throw new Error('fixture render failure');
    },
  };
}

/** Geometry fixture includes rear markers in the same scene, never mirror-only substitutes. */
function fixture(options={}) {
  const renderer=fakeRenderer(),scene=new T.Scene(),player=new T.Group(),body=new T.Group();
  player.add(body);scene.add(player);
  const panes=['left','right','center'].map((role,index)=>{
    const mesh=new T.Mesh(new T.PlaneGeometry(.6,.24),new T.MeshStandardMaterial({metalness:1,roughness:.18}));
    mesh.name='detail_mirror_'+role;mesh.userData.mirrorRole=role;
    mesh.userData.mirrorPlane={point:[0,0,0],normal:[0,0,1]};
    mesh.position.set((index-1)*.8,0,0);body.add(mesh);return mesh;
  });
  const originals=panes.map(pane=>pane.material),geometries=panes.map(pane=>pane.geometry);
  for(const [name,x,z] of [['rear-left',-2,8],['rear-right',2,10],['front-leak',0,-6]]) {
    const mesh=new T.Mesh(new T.BoxGeometry(.4,.5,.7),new T.MeshStandardMaterial());mesh.name=name;mesh.position.set(x,0,z);scene.add(mesh);
  }
  const helper=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());helper.name='debug-helper';helper.type='BoxHelper';scene.add(helper);
  const ui=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial());ui.name='overlay-ui';ui.userData.excludeFromMirrors=true;scene.add(ui);
  const hidden=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial());hidden.name='already-hidden';hidden.visible=false;scene.add(hidden);
  let screen;
  if(options.screen){screen=new T.Mesh(new T.PlaneGeometry(.8,.4),new T.MeshStandardMaterial());screen.name='detail_right_rear_display';screen.position.set(0,.6,.2);body.add(screen);}
  if(options.fog)scene.fog=new T.Fog('#aabbcc',160,510);
  const camera=new T.PerspectiveCamera(60,1.5,.05,500);camera.position.set(0,.2,3);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const mirrors=createPlayerMirrors(renderer,scene,player,options);
  return {renderer,scene,player,body,panes,originals,geometries,helper,ui,hidden,screen,camera,mirrors};
}

test('plane reflection is an involution, reverses orientation and fixes plane points',()=>{
  for(const plane of [new T.Plane(new T.Vector3(0,0,1),0),new T.Plane(new T.Vector3(.3,.5,.8).normalize(),-1.7)]) {
    const reflection=mirrorReflectionMatrix(plane),twice=reflection.clone().multiply(reflection);
    near(reflection.determinant(),-1);twice.elements.forEach((value,index)=>near(value,new T.Matrix4().elements[index]));
    const point=new T.Vector3(1,2,3),reflected=point.clone().applyMatrix4(reflection);
    near(plane.distanceToPoint(reflected),-plane.distanceToPoint(point));
    vectorNear(reflected.clone().applyMatrix4(reflection),point);
    const onPlane=plane.projectPoint(point,new T.Vector3());vectorNear(onPlane.clone().applyMatrix4(reflection),onPlane);
  }
});

test('real eye reflection and right-handed virtual view produce exact planar ray projection',()=>{
  const camera=new T.PerspectiveCamera(63,1.7,.05,500);camera.position.set(.6,.8,4);camera.lookAt(-.1,.2,0);camera.rotateZ(.19);camera.updateMatrixWorld(true);
  const plane=new T.Plane(new T.Vector3(0,0,1),0),view=createPlanarMirrorCamera();
  assert.equal(updatePlanarMirrorCamera(camera,plane,corners,view),true);
  vectorNear(view.camera.position,new T.Vector3(.6,.8,-4));near(view.camera.matrixWorld.determinant(),1);
  const expectedDirection=camera.getWorldDirection(new T.Vector3()).reflect(plane.normal);
  vectorNear(view.camera.getWorldDirection(new T.Vector3()),expectedDirection);
  for(const rear of [new T.Vector3(-1,.1,8),new T.Vector3(1,.1,8),new T.Vector3(.4,1,14)]) {
    const direction=rear.clone().sub(view.camera.position);
    const intersection=new T.Ray(view.camera.position,direction.normalize()).intersectPlane(plane,new T.Vector3());
    const rearUv=new T.Vector4(...rear.toArray(),1).applyMatrix4(view.textureMatrix);
    const planeUv=new T.Vector4(...intersection.toArray(),1).applyMatrix4(view.textureMatrix);
    near(rearUv.x/rearUv.w,planeUv.x/planeUv.w);near(rearUv.y/rearUv.w,planeUv.y/planeUv.w);
    // The main-camera image of the physically reflected object passes through
    // the exact same pane point, including an oblique/rolled real camera.
    const reflected=rear.clone().applyMatrix4(view.reflectionMatrix).project(camera);
    const visiblePoint=intersection.clone().project(camera);
    near(reflected.x,visiblePoint.x);near(reflected.y,visiblePoint.y);
  }
});

test('oblique near plane clips the wrong half-space and retains actual rear traffic',()=>{
  const camera=new T.PerspectiveCamera(60,1.5,.05,200);camera.position.set(0,0,4);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const view=createPlanarMirrorCamera(),plane=new T.Plane(new T.Vector3(0,0,1),0);
  assert.equal(updatePlanarMirrorCamera(camera,plane,corners,view),true);
  const clip=point=>new T.Vector4(...point,1).applyMatrix4(view.camera.matrixWorldInverse).applyMatrix4(view.camera.projectionMatrix);
  for(const z of [.01,1,10,90]) {const p=clip([0,0,z]);assert.ok(p.z>=-p.w,`rear z=${z} retained`);assert.ok(p.z<=p.w,`rear z=${z} before far plane`);}
  for(const z of [-.01,-1,-3]) {const p=clip([0,0,z]);assert.ok(p.z< -p.w,`front z=${z} clipped`);}
  const inverse=view.camera.projectionMatrix.clone().multiply(view.camera.projectionMatrixInverse);
  inverse.elements.forEach((value,index)=>near(value,new T.Matrix4().elements[index]));
});

test('off-axis pane fit uses most of the bounded target even far off the main camera axis',()=>{
  const camera=new T.PerspectiveCamera(60,2,.05,300);camera.position.set(1,.4,3);camera.lookAt(0,0,-5);camera.updateMatrixWorld(true);
  const offsetCorners=corners.map(point=>point.clone().multiplyScalar(.1).add(new T.Vector3(-1.2,.5,0)));
  const view=createPlanarMirrorCamera();assert.equal(updatePlanarMirrorCamera(camera,new T.Plane(new T.Vector3(0,0,1),0),offsetCorners,view),true);
  const uv=offsetCorners.map(point=>{const p=new T.Vector4(...point.toArray(),1).applyMatrix4(view.textureMatrix);return [p.x/p.w,p.y/p.w];});
  for(const coordinate of [0,1]) {const values=uv.map(p=>p[coordinate]);assert.ok(Math.min(...values)<.025);assert.ok(Math.max(...values)>.975);}
  assert.ok(Math.abs(view.baseProjection.elements[8])>.1,'projection really is off-axis, not an unrelated centred rear feed');
  camera.position.z=-1;camera.updateMatrixWorld(true);assert.equal(updatePlanarMirrorCamera(camera,new T.Plane(new T.Vector3(0,0,1),0),offsetCorners,view),false);
});

test('only the player owns three mirrors; traffic, geometry, shared materials and helper visibility stay intact',()=>{
  const f=fixture();const traffic=f.player.clone(true);traffic.name='traffic-copy';traffic.position.x=10;f.scene.add(traffic);
  const before={target:f.renderer.getRenderTarget(),viewport:f.renderer.getViewport(new T.Vector4()),scissor:f.renderer.getScissor(new T.Vector4())};
  assert.equal(f.mirrors.update(f.camera,{dt:0,mode:'cockpit'}),3);
  assert.equal(f.mirrors.diagnostics.paneCount,3);assert.equal(f.renderer.calls.length,3);
  for(const call of f.renderer.calls) {
    assert.ok(call.visible.includes('rear-left'));assert.ok(call.visible.includes('rear-right'));
    assert.ok(!call.visible.some(name=>name.startsWith('detail_mirror_')),'no nested mirror passes, including other scene panes');
    assert.ok(!call.visible.includes('debug-helper'));assert.ok(!call.visible.includes('overlay-ui'));assert.ok(!call.visible.includes('already-hidden'));
  }
  f.panes.forEach((pane,index)=>{assert.notEqual(pane.material,f.originals[index]);assert.equal(pane.geometry,f.geometries[index]);assert.equal(pane.visible,true);assert.equal(traffic.getObjectByName(pane.name).material,f.originals[index]);});
  assert.equal(f.helper.visible,true);assert.equal(f.ui.visible,true);assert.equal(f.hidden.visible,false);
  assert.equal(f.renderer.xr.enabled,true);assert.equal(f.renderer.shadowMap.autoUpdate,true);assert.equal(f.renderer.shadowMap.needsUpdate,true);
  assert.equal(f.renderer.getRenderTarget(),before.target);assert.equal(f.renderer.face,2);assert.equal(f.renderer.mip,1);
  assert.deepEqual(f.renderer.getViewport(new T.Vector4()).toArray(),before.viewport.toArray());
  assert.deepEqual(f.renderer.getScissor(new T.Vector4()).toArray(),before.scissor.toArray());assert.equal(f.renderer.getScissorTest(),true);
  f.mirrors.dispose();
});

test('normal playback caps each pane to 15/10 Hz, paused frames cache and force refresh is explicit',()=>{
  for(const [options,hz] of [[{},15],[{compact:true},10],[{reducedMotion:true},10]]) {
    const f=fixture(options);f.mirrors.update(f.camera,{dt:0});const start=f.renderer.calls.length;
    for(let frame=0;frame<120;frame++) f.mirrors.update(f.camera,{dt:1/60});
    assert.equal(f.renderer.calls.length-start,hz*2*3);
    const paused=f.renderer.calls.length;
    for(let frame=0;frame<60;frame++) f.mirrors.update(f.camera,{dt:1,paused:true});
    assert.equal(f.renderer.calls.length,paused);
    f.camera.position.x+=.05;f.camera.updateMatrixWorld(true);f.mirrors.update(f.camera,{dt:0,paused:true});assert.equal(f.renderer.calls.length,paused+3);
    f.mirrors.update(f.camera,{dt:0,paused:true});assert.equal(f.renderer.calls.length,paused+3);
    f.mirrors.update(f.camera,{dt:0,force:true});assert.equal(f.renderer.calls.length,paused+6);
    f.mirrors.dispose();
  }
});

test('offscreen, hidden and backfacing panes keep the authored fallback and never erase casings',()=>{
  const f=fixture();f.mirrors.update(f.camera,{dt:0});const passes=f.renderer.calls.length;
  f.panes[0].visible=false;f.panes[1].position.x=100;f.panes[2].rotation.y=Math.PI;
  f.mirrors.update(f.camera,{dt:1});assert.equal(f.renderer.calls.length,passes);
  assert.deepEqual(f.mirrors.diagnostics.panes.map(pane=>pane.reason),['hidden','offscreen','backfacing']);
  f.panes.forEach((pane,index)=>assert.equal(pane.material,f.originals[index]));assert.equal(f.panes[0].visible,false);
  f.mirrors.dispose();
});

test('targets are bounded, reused at steady quality and resize only when the budget bucket changes',()=>{
  assert.deepEqual(playerMirrorBudget({quality:'ultra'}),{width:512,height:256,hz:15,maxPanes:3});
  assert.deepEqual(playerMirrorBudget({compact:true,quality:'ultra'}),{width:256,height:128,hz:10,maxPanes:3});
  const f=fixture();f.mirrors.update(f.camera,{dt:0});const targets=f.renderer.calls.map(call=>call.target);
  for(const target of targets){assert.equal(target.width,384);assert.equal(target.height,192);assert.equal(target.samples,0);assert.equal(target.texture.generateMipmaps,false);}
  f.mirrors.update(f.camera,{dt:.1,quality:'high'});assert.equal(f.renderer.calls.length,6);
  f.renderer.calls.slice(3).forEach((call,index)=>{assert.equal(call.target,targets[index]);assert.equal(call.target.width,512);assert.equal(call.target.height,256);});
  f.mirrors.update(f.camera,{dt:0,quality:'ultra'});assert.equal(f.renderer.calls.length,6,'high and ultra share resources');
  f.mirrors.dispose();
});

test('body roll, pitch, heave and player flight transform the actual pane and reflected eye',()=>{
  const f=fixture();f.mirrors.update(f.camera,{dt:0});
  f.player.position.set(.3,2.4,-1);f.player.rotation.set(.12,.17,.22);f.body.rotation.set(.03,0,.04);f.body.position.y=.02;
  const localEye=new T.Vector3(0,.2,3);f.player.updateMatrixWorld(true);f.camera.position.copy(localEye.applyMatrix4(f.player.matrixWorld));
  f.camera.lookAt(new T.Vector3(0,0,0).applyMatrix4(f.player.matrixWorld));f.camera.updateMatrixWorld(true);
  f.mirrors.update(f.camera,{dt:.1,force:true});
  for(const [index,detail] of f.mirrors.diagnostics.panes.entries()) {
    const plane=new T.Plane(new T.Vector3(0,0,1),0).applyMatrix4(f.panes[index].matrixWorld);
    const expected=f.camera.position.clone().applyMatrix4(mirrorReflectionMatrix(plane));
    vectorNear(new T.Vector3(...detail.camera),expected);assert.equal(detail.active,true);
  }
  f.mirrors.dispose();
});

test('resize can change compact classification and cadence without allocating new targets',()=>{
  const f=fixture();f.mirrors.update(f.camera,{dt:0,quality:'high'});const targets=f.renderer.calls.map(call=>call.target);
  assert.equal(f.mirrors.update(f.camera,{dt:0,quality:'high',compact:true}),3);
  assert.deepEqual(f.mirrors.diagnostics.budget,{width:256,height:128,hz:10,maxPanes:3});
  f.renderer.calls.slice(-3).forEach((call,index)=>assert.equal(call.target,targets[index]));
  const start=f.renderer.calls.length;
  for(let i=0;i<60;i++)f.mirrors.update(f.camera,{dt:1/60,quality:'high',compact:true});
  assert.equal(f.renderer.calls.length-start,30);
  assert.equal(f.mirrors.update(f.camera,{dt:0,quality:'high',compact:false}),3);
  assert.deepEqual(f.mirrors.diagnostics.budget,{width:512,height:256,hz:15,maxPanes:3});f.mirrors.dispose();
});

test('render failure restores scene and renderer state, then retries only a bounded number',()=>{
  const f=fixture();f.renderer.fail=true;const target=f.renderer.getRenderTarget();
  for(let i=0;i<10;i++)f.mirrors.update(f.camera,{dt:.1});
  assert.equal(f.renderer.calls.length,9);assert.equal(f.mirrors.diagnostics.failedPasses,9);
  assert.match(f.mirrors.diagnostics.lastError,/fixture render failure/);
  assert.equal(f.renderer.getRenderTarget(),target);assert.equal(f.renderer.xr.enabled,true);assert.equal(f.renderer.shadowMap.autoUpdate,true);
  f.panes.forEach((pane,index)=>{assert.equal(pane.visible,true);assert.equal(pane.material,f.originals[index]);});
  assert.equal(f.helper.visible,true);assert.equal(f.ui.visible,true);assert.equal(f.hidden.visible,false);
  f.renderer.fail=false;f.mirrors.invalidate();assert.equal(f.mirrors.update(f.camera,{dt:0}),3);f.mirrors.dispose();
});

test('context loss uses fallback, restoration recreates targets, dispose is idempotent and preserves sources',()=>{
  const f=fixture();f.mirrors.update(f.camera,{dt:0});const oldTargets=f.renderer.calls.map(call=>call.target),materials=f.panes.map(pane=>pane.material);
  let targetsDisposed=0,materialsDisposed=0,sourcesDisposed=0;
  oldTargets.forEach(target=>target.addEventListener('dispose',()=>{assert.equal(f.mirrors.diagnostics.contextLost,true,'retire old handles before restoration');targetsDisposed++;}));
  materials.forEach(material=>material.addEventListener('dispose',()=>materialsDisposed++));
  f.originals.forEach(material=>material.addEventListener('dispose',()=>sourcesDisposed++));
  f.renderer.listeners.get('webglcontextlost')();assert.equal(f.mirrors.diagnostics.contextLost,true);
  assert.equal(targetsDisposed,3,'old context resources are released during the loss event, not after restoration');
  materials.forEach(material=>assert.equal(material.uniforms.reflection.value,null));
  f.panes.forEach((pane,index)=>assert.equal(pane.material,f.originals[index]));assert.equal(f.mirrors.update(f.camera,{dt:1,force:true}),0);
  f.renderer.listeners.get('webglcontextrestored')();assert.equal(targetsDisposed,3);assert.equal(f.mirrors.diagnostics.contextLost,false);
  assert.equal(f.mirrors.update(f.camera,{dt:0,paused:true}),3);
  const fresh=f.renderer.calls.slice(3);fresh.forEach((call,index)=>{assert.notEqual(call.target,oldTargets[index]);call.target.addEventListener('dispose',()=>targetsDisposed++);});
  f.mirrors.dispose();f.mirrors.dispose();f.mirrors.invalidate();assert.equal(f.mirrors.update(f.camera,{dt:1,force:true}),0);
  assert.equal(targetsDisposed,6);assert.equal(materialsDisposed,3);assert.equal(sourcesDisposed,0);assert.equal(f.renderer.listeners.size,0);
  f.panes.forEach((pane,index)=>assert.equal(pane.material,f.originals[index]));
});

test('curved housings or contradictory plane metadata cannot be replaced with a fake mirror surface',()=>{
  const scene=new T.Scene(),player=new T.Group();scene.add(player);
  for(const [role,geometry,normal] of [['left',new T.BoxGeometry(.2,.1,.05),[0,0,1]],['right',new T.PlaneGeometry(.2,.1),[0,0,-1]]]) {
    const pane=new T.Mesh(geometry,new T.MeshStandardMaterial());pane.name='detail_mirror_'+role;pane.userData.mirrorPlane={point:[0,0,0],normal};player.add(pane);
  }
  const mirrors=createPlayerMirrors(fakeRenderer(),scene,player);assert.equal(mirrors.diagnostics.paneCount,0);assert.equal(mirrors.diagnostics.rejected.length,2);mirrors.dispose();
  const inert=createPlayerMirrors(null,scene,player);assert.equal(inert.update(null),0);assert.doesNotThrow(()=>inert.dispose());
});

test('rear objects moving left and right project through their physical reflection ray, never a fixed video fixture',()=>{
  const f=fixture();
  for(const x of [-1.8,0,1.8]) {
    const object=f.scene.getObjectByName('rear-left');object.position.set(x,.1,9);f.mirrors.update(f.camera,{dt:.1,force:true});
    for(const call of f.renderer.calls.slice(-3)) {
      const ray=new T.Ray(call.camera.position,object.position.clone().sub(call.camera.position).normalize());
      const intersection=ray.intersectPlane(new T.Plane(new T.Vector3(0,0,1),0),new T.Vector3());
      const objectNdc=object.position.clone().project(call.camera),paneNdc=intersection.clone().project(call.camera);
      near(objectNdc.x,paneNdc.x);near(objectNdc.y,paneNdc.y);
      assert.ok(Math.sign(intersection.x-call.camera.position.x)===Math.sign(x-call.camera.position.x));
    }
  }
  f.mirrors.dispose();
});

test('authored Roadster panes remain flat and correctly reflected through actual sprung-body transforms',async()=>{
  const {scene:template}=await loadRoadsterGeometry(),player=createCar(template),scene=new T.Scene();scene.add(player);
  const renderer=fakeRenderer(),mirrors=createPlayerMirrors(renderer,scene,player);
  assert.equal(mirrors.diagnostics.paneCount,3,'Blender must export three separate flat reflective panes');
  assert.deepEqual(mirrors.diagnostics.rejected,[]);
  const rig=createCockpitView(player),camera=new T.PerspectiveCamera();
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9});
  mirrors.update(camera,{dt:0,mode:'cockpit',force:true});
  for(const role of ['left','right','center']) {
    const pane=player.getObjectByName('detail_mirror_'+role);assert.ok(pane);
    assert.equal(pane.userData.mirrorRole,role);assert.equal(pane.userData.mirrorPlane.normal.length,3);
    assert.ok(mirrors.diagnostics.panes.find(item=>item.role===role).planeError<.00002);
    const center=new T.Vector3(...pane.userData.mirrorPlane.point).applyMatrix4(pane.matrixWorld);
    camera.lookAt(center);camera.updateMatrixWorld(true);mirrors.update(camera,{dt:0,paused:true,force:true});
    // Active means a projective texture was rendered, not that body geometry
    // cannot obscure the pane. Direct optical visibility is tested separately.
    const detail=mirrors.diagnostics.panes.find(item=>item.role===role);assert.equal(detail.active,true,role+' projection is rendered when the real eye looks at it');
    const plane=new T.Plane(new T.Vector3(...detail.worldPlane.slice(0,3)),detail.worldPlane[3]);
    vectorNear(new T.Vector3(...detail.camera),camera.position.clone().applyMatrix4(mirrorReflectionMatrix(plane)));
    const rayDirection=center.clone().sub(camera.position).normalize().reflect(plane.normal);
    assert.ok(rayDirection.z>.8,'authored '+role+' ray really sees behind the car');
    const worldToTexture=pane.material.uniforms.textureMatrix.value.clone().multiply(pane.matrixWorld.clone().invert());
    for(const offset of [-1,0,1]) {
      const rear=center.clone().addScaledVector(rayDirection,12);rear.x+=offset;
      const virtualEye=new T.Vector3(...detail.camera);
      const intersection=new T.Ray(virtualEye,rear.clone().sub(virtualEye).normalize()).intersectPlane(plane,new T.Vector3());
      const a=new T.Vector4(...rear.toArray(),1).applyMatrix4(worldToTexture);
      const b=new T.Vector4(...intersection.toArray(),1).applyMatrix4(worldToTexture);
      near(a.x/a.w,b.x/b.w);near(a.y/a.w,b.y/b.w);
    }
  }
  animatePlayerBody(player,{bodyPitch:.02,bodyRoll:.01,bodyHeave:.002});player.position.y=3;player.rotation.z=.15;player.updateMatrixWorld(true);
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9});mirrors.update(camera,{dt:.1,force:true});
  for(const detail of mirrors.diagnostics.panes.filter(item=>item.active)) {
    const plane=new T.Plane(new T.Vector3(...detail.worldPlane.slice(0,3)),detail.worldPlane[3]);
    vectorNear(new T.Vector3(...detail.camera),camera.position.clone().applyMatrix4(mirrorReflectionMatrix(plane)));
  }
  mirrors.dispose();
});

test('actual stowed mirror rays clear opaque body geometry, while deployed wing occlusion remains real',async()=>{
  const {scene:template}=await loadRoadsterGeometry(),player=createCar(template),scene=new T.Scene();scene.add(player);
  const renderer=fakeRenderer(),mirrors=createPlayerMirrors(renderer,scene,player),rig=createCockpitView(player),camera=new T.PerspectiveCamera();
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9});
  const opaque=[];player.traverse(mesh=>{if(mesh.isMesh&&!mesh.userData.mirrorRole&&(mesh.material.opacity??1)>.95)opaque.push(mesh);});
  function reflectedRay(role) {
    const pane=player.getObjectByName('detail_mirror_'+role);
    const center=new T.Vector3(...pane.userData.mirrorPlane.point).applyMatrix4(pane.matrixWorld);
    const plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(...pane.userData.mirrorPlane.normal),new T.Vector3(...pane.userData.mirrorPlane.point)).applyMatrix4(pane.matrixWorld);
    const direction=center.clone().sub(camera.position).normalize().reflect(plane.normal);
    return new T.Raycaster(center.addScaledVector(direction,.002),direction,0,100);
  }
  setPlayerAeroPose(player,0);player.updateMatrixWorld(true);
  for(const role of ['left','right','center']) {
    const hits=reflectedRay(role).intersectObjects(opaque,false);
    assert.equal(hits.length,0,role+' reflected central ray must clear the stowed opaque car: '+hits.slice(0,3).map(hit=>hit.object.name).join(', '));
  }
  setPlayerAeroPose(player,1);player.updateMatrixWorld(true);
  const hits=reflectedRay('center').intersectObjects(opaque,false);
  assert.ok(hits.some(hit=>hit.object.name.startsWith('wing_')),'the physically deployed wing really intersects the center mirror ray');
  mirrors.update(camera,{dt:0,force:true});
  assert.ok(renderer.calls.some(call=>call.visible.includes(hits[0].object.name)),'reflection passes must not hide the obstructing wing or entire player');
  assert.equal(hits[0].object.visible,true);mirrors.dispose();
});

test('actual left and center apertures are at least 95 percent visible from the authored driver eye',async()=>{
  const {scene:template}=await loadRoadsterGeometry(),player=createCar(template),rig=createCockpitView(player),camera=new T.PerspectiveCamera();
  setPlayerAeroPose(player,0);updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9});player.updateMatrixWorld(true);
  const opaque=[];player.traverse(mesh=>{if(mesh.isMesh&&!mesh.material.transparent)opaque.push(mesh);});
  for(const role of ['left','center']) {
    const pane=player.getObjectByName('detail_mirror_'+role),metadata=pane.userData.mirrorPlane;
    const center=new T.Vector3(...metadata.point),normal=new T.Vector3(...metadata.normal).normalize();
    const tangent=new T.Vector3(1,0,0).addScaledVector(normal,-normal.x).normalize(),up=new T.Vector3().crossVectors(normal,tangent);
    const positions=pane.geometry.attributes.position,points=[];
    for(let i=0;i<positions.count;i++) {
      const point=new T.Vector3().fromBufferAttribute(positions,i);
      if(!points.some(existing=>existing.distanceTo(point)<1e-7))points.push(point);
    }
    assert.equal(points.length,4);
    points.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(up),a.clone().sub(center).dot(tangent))-Math.atan2(b.clone().sub(center).dot(up),b.clone().sub(center).dot(tangent)));
    let visible=0;const blocked={};
    for(let u=.05;u<1;u+=.1)for(let v=.05;v<1;v+=.1) {
      const point=points[0].clone().lerp(points[1],u).lerp(points[3].clone().lerp(points[2],u),v).applyMatrix4(pane.matrixWorld);
      const direction=point.clone().sub(camera.position),distance=direction.length();
      const hit=new T.Raycaster(camera.position,direction.normalize(),.0001,distance+.001).intersectObjects(opaque,false)[0];
      if(hit?.object===pane)visible++;else blocked[hit?.object.name??'no-hit']=(blocked[hit?.object.name??'no-hit']??0)+1;
    }
    assert.ok(visible>=95,role+' direct visibility '+visible+'/100; blockers '+JSON.stringify(blocked));
  }
});

test('actual left pane reaches actual sedan triangles in the adjacent rear lane at 9 through 15 metres',async()=>{
  const [{scene:template},{scene:sedan}]=await Promise.all([loadRoadsterGeometry(),loadRoadsterGeometry(new URL('../public/assets/traffic/sedan.glb',import.meta.url))]);
  const player=createCar(template),rig=createCockpitView(player),camera=new T.PerspectiveCamera();
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9});player.updateMatrixWorld(true);
  const pane=player.getObjectByName('detail_mirror_left'),center=new T.Vector3(...pane.userData.mirrorPlane.point).applyMatrix4(pane.matrixWorld);
  const normal=new T.Vector3(...pane.userData.mirrorPlane.normal).applyNormalMatrix(new T.Matrix3().getNormalMatrix(pane.matrixWorld)).normalize();
  const direction=center.clone().sub(camera.position).normalize().reflect(normal);
  const ray=new T.Raycaster(center.clone().addScaledVector(direction,.002),direction,0,100);
  const ground=.01-new T.Box3().setFromObject(sedan,true).min.y;
  for(const z of [9,12,15]) {
    sedan.position.set(-3.5,ground,z);sedan.updateMatrixWorld(true);
    const hits=ray.intersectObject(sedan,true);
    assert.ok(hits.length>0,'left reflected center ray must hit actual adjacent-lane sedan at z='+z+', not road between lanes');
    assert.ok(hits[0].point.y>.25&&hits[0].point.y<1.5,'hit actual visible car body height');
  }
});

test('lifted center mirror sees opaque central-SUV surfaces and keeps physical rays invariant across head glances',async()=>{
  const [{scene:template},{scene:suv}]=await Promise.all([loadRoadsterGeometry(),loadRoadsterGeometry(new URL('../public/assets/traffic/suv.glb',import.meta.url))]);
  const player=createCar(template),rig=createCockpitView(player),camera=new T.PerspectiveCamera();
  player.position.y=.012;setPlayerAeroPose(player,0);
  updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9});player.updateMatrixWorld(true);
  const pane=player.getObjectByName('detail_mirror_center'),metadata=pane.userData.mirrorPlane;
  const center=new T.Vector3(...metadata.point),normal=new T.Vector3(...metadata.normal).normalize();
  const tangent=new T.Vector3(1,0,0).addScaledVector(normal,-normal.x).normalize(),up=new T.Vector3().crossVectors(normal,tangent);
  const points=[],positions=pane.geometry.attributes.position;
  for(let i=0;i<positions.count;i++) {
    const point=new T.Vector3().fromBufferAttribute(positions,i);
    if(!points.some(existing=>existing.distanceTo(point)<1e-7))points.push(point);
  }
  assert.equal(points.length,4);
  points.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(up),a.clone().sub(center).dot(tangent))-Math.atan2(b.clone().sub(center).dot(up),b.clone().sub(center).dot(tangent)));
  points.forEach(point=>point.applyMatrix4(pane.matrixWorld));
  const plane=new T.Plane().setFromNormalAndCoplanarPoint(normal,center).applyMatrix4(pane.matrixWorld);
  const eye=camera.position.clone(),centerWorld=center.clone().applyMatrix4(pane.matrixWorld);
  const centerDirection=centerWorld.clone().sub(eye).normalize().reflect(plane.normal);
  near(centerDirection.y,0,1e-6);near(centerDirection.x,0,1e-6);near(centerDirection.z,1,1e-6);
  suv.position.set(0,.01-new T.Box3().setFromObject(suv,true).min.y,15);suv.updateMatrixWorld(true);
  const opaque=[];player.traverse(mesh=>{if(mesh.isMesh&&!mesh.material.transparent&&!mesh.userData.mirrorRole)opaque.push(mesh);});
  const samples=[];
  for(const u of [.1,.5,.9])for(const v of [.1,.5,.9]) {
    const point=points[0].clone().lerp(points[1],u).lerp(points[3].clone().lerp(points[2],u),v);
    const direction=point.clone().sub(eye).normalize().reflect(plane.normal);
    const ray=new T.Raycaster(point.clone().addScaledVector(direction,.002),direction,0,100);
    assert.equal(ray.intersectObjects(opaque,false).length,0,'stowed player must not obstruct these actual reflected rays');
    const hit=ray.intersectObject(suv,true)[0];
    if(u===.5) {
      assert.ok(hit,'all three center-column samples must reach the actual SUV at 15 m');
      assert.equal(hit.object.material.transparent,false,'do not count windshield/sky as visible traffic body');
      assert.ok((hit.object.material.opacity??1)>.95);
      if(v===.5)assert.equal(hit.object.material.name,'body','central ray reaches painted body rather than sky above the roof');
    }
    samples.push({u,v,point,direction,hit});
  }
  // A head turn changes only gaze, not the seated eye or the physical reflection.
  // Capture UVs may change with the virtual basis, but reconstructing the sampled
  // world ray and projecting its SUV intersection must remain exact for every yaw.
  let virtualEye;
  for(const lookYaw of [0,.75,-.75]) {
    updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9,lookYaw});vectorNear(camera.position,eye);
    const view=createPlanarMirrorCamera();assert.equal(updatePlanarMirrorCamera(camera,plane,points,view),true);
    if(virtualEye)vectorNear(view.camera.position,virtualEye);else virtualEye=view.camera.position.clone();
    const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(view.camera.projectionMatrix,view.camera.matrixWorldInverse));
    for(const {point,direction,hit} of samples) {
      const uv=new T.Vector4(...point.toArray(),1).applyMatrix4(view.textureMatrix);
      const sampled=new T.Vector3(2*uv.x/uv.w-1,2*uv.y/uv.w-1,0).unproject(view.camera).sub(view.camera.position).normalize();
      vectorNear(sampled,direction,2e-7);
      if(!hit)continue;
      const projected=new T.Vector4(...hit.point.toArray(),1).applyMatrix4(view.textureMatrix);
      near(projected.x/projected.w,uv.x/uv.w,2e-7);near(projected.y/projected.w,uv.y/uv.w,2e-7);
      const ndc=hit.point.clone().project(view.camera);
      assert.ok(Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1&&Math.abs(ndc.z)<1,'SUV hit survives all clip planes at yaw '+lookYaw);
      assert.equal(frustum.intersectsObject(hit.object),true,'actual GPU mesh-frustum culling also retains the SUV');
    }
  }
});

test('right camera is a separate scene-linear texture and refreshes only for a visible dedicated right screen',()=>{
  const f=fixture({screen:true});assert.equal(f.mirrors.rightCameraTexture,null);
  f.mirrors.update(f.camera,{dt:0,mode:'chase'});assert.equal(f.mirrors.diagnostics.rightCamera.passes,0);
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});const cameraCalls=()=>f.renderer.calls.filter(call=>call.camera.name==='player-right-rear-camera');
  assert.equal(cameraCalls().length,1);assert.equal(f.mirrors.diagnostics.paneCount,3);
  const texture=f.mirrors.rightCameraTexture;assert.equal(texture,cameraCalls()[0].target.texture);
  assert.equal(texture.colorSpace,T.NoColorSpace);assert.equal(texture.name,'player-right-rear-camera');
  assert.equal(texture.generateMipmaps,false);assert.equal(f.mirrors.diagnostics.rightCamera.horizontalFlip,true);
  assert.match(f.mirrors.diagnostics.rightCamera.kind,/not planar reflection/);
  assert.ok(!cameraCalls()[0].visible.includes('detail_right_rear_display'));assert.equal(f.screen.visible,true);
  for(let i=0;i<60;i++)f.mirrors.update(f.camera,{dt:1/60,mode:'cockpit'});
  assert.equal(cameraCalls().length,16,'one initial frame plus 15 ordinary updates');
  f.screen.visible=false;f.mirrors.update(f.camera,{dt:1,mode:'cockpit',force:true});assert.equal(cameraCalls().length,16);
  assert.equal(f.mirrors.diagnostics.rightCamera.reason,'screen-hidden');assert.equal(f.mirrors.rightCameraTexture,texture,'inactive display may retain its last captured frame');
  f.screen.visible=true;f.screen.position.x=100;f.mirrors.update(f.camera,{dt:1,mode:'cockpit',force:true});assert.equal(cameraCalls().length,16);
  assert.equal(f.mirrors.diagnostics.rightCamera.reason,'screen-offscreen');
  f.screen.position.x=0;f.mirrors.update(f.camera,{dt:1,mode:'chase',force:true});assert.equal(cameraCalls().length,16);
  f.mirrors.dispose();assert.equal(f.mirrors.rightCameraTexture,null);
});

test('missing dedicated right display never falls back to the central tablet',()=>{
  const f=fixture({screen:true});f.mirrors.dispose();f.screen.name='detail_rc_ui';
  const material=f.screen.material,mirrors=createPlayerMirrors(f.renderer,f.scene,f.player);
  mirrors.update(f.camera,{dt:0,mode:'cockpit',force:true});
  assert.equal(mirrors.rightCameraTexture,null);assert.equal(mirrors.diagnostics.rightCamera.available,false);
  assert.equal(f.screen.material,material);assert.ok(!f.renderer.calls.some(call=>call.camera.name==='player-right-rear-camera'));mirrors.dispose();
});

test('failed right-camera refresh stops exposing the partial texture and a successful retry restores it',()=>{
  const f=fixture({screen:true});f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});
  const texture=f.mirrors.rightCameraTexture;assert.ok(texture);
  f.renderer.fail=true;f.mirrors.update(f.camera,{dt:.1,mode:'cockpit',force:true});
  assert.equal(f.mirrors.rightCameraTexture,null,'display must switch to authored fallback after actual capture failure');
  assert.equal(f.mirrors.diagnostics.rightCamera.reason,'render-failed');
  assert.equal(f.mirrors.diagnostics.rightCamera.active,false);
  // Unlike an offscreen cached frame, a partial target cannot become valid simply
  // because simulation is paused or a refresh interval has not elapsed yet.
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit',paused:true});assert.equal(f.mirrors.rightCameraTexture,null);
  f.renderer.fail=false;f.mirrors.update(f.camera,{dt:0,mode:'cockpit',paused:true});
  assert.equal(f.mirrors.rightCameraTexture,texture);assert.equal(f.mirrors.diagnostics.rightCamera.reason,'live');
  assert.equal(f.mirrors.diagnostics.rightCamera.active,true);f.mirrors.dispose();
});

test('context callback wakes a paused owner only after each real resource transition and never after disposal',()=>{
  const notifications=[];
  const f=fixture({screen:true,onContextChange(){
    notifications.push({lost:f.mirrors.diagnostics.contextLost,texture:f.mirrors.rightCameraTexture,disposedTargets});
  }});
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});
  let disposedTargets=0;f.renderer.calls.forEach(call=>call.target.addEventListener('dispose',()=>disposedTargets++));
  const lost=f.renderer.listeners.get('webglcontextlost'),restored=f.renderer.listeners.get('webglcontextrestored');
  f.mirrors.invalidate();assert.equal(notifications.length,0,'ordinary invalidation must not cause a context callback');
  lost();lost();assert.equal(notifications.length,1);
  assert.deepEqual(notifications[0],{lost:true,texture:null,disposedTargets:3});
  restored();restored();assert.equal(notifications.length,2);
  assert.deepEqual(notifications[1],{lost:false,texture:null,disposedTargets:3},'old active targets are retired before restoration notification');
  assert.equal(f.mirrors.update(f.camera,{dt:0,paused:true,mode:'cockpit'}),3,'a woken paused owner can repopulate new targets');
  assert.ok(f.mirrors.rightCameraTexture);f.mirrors.dispose();
  lost();restored();assert.equal(notifications.length,2,'retained event closures cannot wake a disposed controller');
});

test('disposing during context loss never disposes retired targets twice or restores them later',()=>{
  const f=fixture({screen:true});f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});
  let retired=0;const targets=f.renderer.calls.map(call=>call.target);
  targets.forEach(target=>target.addEventListener('dispose',()=>retired++));
  const lost=f.renderer.listeners.get('webglcontextlost'),restored=f.renderer.listeners.get('webglcontextrestored');
  lost();assert.equal(retired,3);assert.equal(f.mirrors.rightCameraTexture,null);
  assert.doesNotThrow(()=>f.mirrors.diagnostics);f.mirrors.dispose();f.mirrors.dispose();restored();
  assert.equal(retired,3);assert.equal(f.mirrors.diagnostics.disposed,true);assert.equal(f.mirrors.rightCameraTexture,null);
  assert.equal(f.renderer.listeners.size,0);assert.equal(f.mirrors.update(f.camera,{dt:1,force:true}),0);
});

test('cockpit screen replaces only the obscured right pane pass, while external right mirror remains live',()=>{
  const f=fixture({screen:true});assert.equal(f.mirrors.update(f.camera,{dt:0,mode:'cockpit'}),3);
  const right=()=>f.mirrors.diagnostics.panes.find(pane=>pane.role==='right');
  assert.equal(right().reason,'right-camera-screen-used');assert.equal(right().active,false);assert.equal(right().passes,0);
  assert.equal(f.panes[1].material,f.originals[1]);assert.equal(f.mirrors.diagnostics.rightCamera.passes,1);
  assert.equal(f.mirrors.diagnostics.planarPasses,2);assert.equal(f.mirrors.diagnostics.maxCapturePassesPerRefresh,3);
  assert.equal(f.mirrors.update(f.camera,{dt:0,mode:'chase'}),3);
  assert.equal(right().reason,'live');assert.equal(right().active,true);assert.equal(right().passes,1);
  assert.equal(f.mirrors.diagnostics.rightCamera.reason,'not-cockpit');assert.equal(f.mirrors.diagnostics.rightCamera.passes,1);f.mirrors.dispose();
});

test('right sensor is pod-mounted, follows body pose, clips forward geometry and maps right traffic with one display flip',()=>{
  const f=fixture({screen:true});f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});
  const capture=()=>f.renderer.calls.filter(call=>call.camera.name==='player-right-rear-camera').at(-1).camera;
  let camera=capture(),pod=f.panes[1];
  vectorNear(camera.position,new T.Vector3(0,0,.005).applyMatrix4(pod.matrixWorld));
  vectorNear(camera.getWorldDirection(new T.Vector3()),new T.Vector3(.20,-.015,1).normalize());
  const inFrustum=point=>{const p=new T.Vector4(...point.toArray(),1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);return p.w>0&&Math.abs(p.x)<=p.w&&Math.abs(p.y)<=p.w&&Math.abs(p.z)<=p.w;};
  assert.equal(inFrustum(new T.Vector3(2,0,10)),true);
  assert.equal(inFrustum(new T.Vector3(0,0,-10)),false,'ahead of car cannot leak into rear feed');
  const displayX=x=>.5-.5*new T.Vector3(x,0,10).project(camera).x;
  assert.ok(displayX(3)>displayX(1),'after exactly one horizontal flip, world right moves screen right');
  const firstPosition=camera.position.clone();f.camera.position.x+=.1;f.camera.updateMatrixWorld(true);
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit',force:true});vectorNear(capture().position,firstPosition);
  f.body.position.y=.03;f.body.rotation.set(.04,.07,.12);f.player.position.set(.2,3,-.3);f.player.rotation.z=.17;f.player.updateMatrixWorld(true);
  f.camera.position.copy(new T.Vector3(0,.2,3).applyMatrix4(f.player.matrixWorld));f.camera.lookAt(f.screen.getWorldPosition(new T.Vector3()));f.camera.updateMatrixWorld(true);
  f.mirrors.update(f.camera,{dt:.1,mode:'cockpit',force:true});camera=capture();
  vectorNear(camera.position,new T.Vector3(0,0,.005).applyMatrix4(pod.matrixWorld));
  vectorNear(camera.getWorldDirection(new T.Vector3()),new T.Vector3(.20,-.015,1).transformDirection(pod.matrixWorld));
  assert.equal(camera.fov,36);assert.equal(camera.aspect,2);f.mirrors.dispose();
});

test('right camera shares cadence/resize bounds and recreates only its owned texture after context restoration',()=>{
  const f=fixture({screen:true,compact:true});f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});
  const calls=()=>f.renderer.calls.filter(call=>call.camera.name==='player-right-rear-camera');
  const old=calls()[0].target;let disposals=0;old.addEventListener('dispose',()=>disposals++);
  for(let i=0;i<60;i++)f.mirrors.update(f.camera,{dt:1/60,mode:'cockpit'});
  assert.equal(calls().length,11);assert.equal(old.width,256);assert.equal(old.height,128);
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit',quality:'high',compact:false});assert.equal(calls().at(-1).target,old);assert.equal(old.width,512);
  f.renderer.listeners.get('webglcontextlost')();assert.equal(f.mirrors.rightCameraTexture,null);
  f.renderer.listeners.get('webglcontextrestored')();assert.equal(f.mirrors.rightCameraTexture,null);
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit',quality:'high',compact:false});const fresh=calls().at(-1).target;
  assert.notEqual(fresh,old);assert.equal(f.mirrors.rightCameraTexture,fresh.texture);
  fresh.addEventListener('dispose',()=>disposals++);f.mirrors.dispose();f.mirrors.dispose();
  assert.equal(disposals,3,'one resize, one old context target, one fresh target');assert.equal(f.renderer.listeners.size,0);
});

test('bounded rear fog is reused only during target passes and exact main fog survives errors',()=>{
  const f=fixture({screen:true,fog:true}),original=f.scene.fog;
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});const rear=f.renderer.calls[0].fog;
  assert.notEqual(rear,original);assert.equal(rear.near,42);assert.equal(rear.far,78);assert.equal(f.scene.fog,original);
  assert.ok(f.renderer.calls.every(call=>call.fog===rear));
  original.color.set('#112233');f.renderer.fail=true;f.mirrors.update(f.camera,{dt:.1,mode:'cockpit',force:true});
  assert.equal(f.scene.fog,original);assert.equal(rear.color.getHexString(),'112233');assert.equal(original.near,160);assert.equal(original.far,510);
  assert.deepEqual(f.mirrors.diagnostics.rearVisibility,{fogNear:42,fogFar:78,finiteWorld:true});f.mirrors.dispose();
  const noFog=fixture({screen:true});noFog.mirrors.update(noFog.camera,{dt:0,mode:'cockpit'});assert.equal(noFog.scene.fog,null);assert.equal(noFog.mirrors.diagnostics.rearVisibility,null);noFog.mirrors.dispose();
});

test('missing or context-unallocated shadow maps never suppress first-capture traffic, while ready shadows stay enabled',()=>{
  const f=fixture({screen:true}),pending=new T.DirectionalLight(),ready=new T.DirectionalLight();
  pending.name='pending-shadow';ready.name='ready-shadow';pending.castShadow=ready.castShadow=true;
  ready.shadow.map=new T.WebGLRenderTarget(16,16);ready.shadow.map.depthTexture=new T.DepthTexture(16,16);
  const gpu=new WeakMap();gpu.set(ready.shadow.map.depthTexture,{__webglTexture:{}});
  f.renderer.properties={get(texture){return gpu.get(texture)??{};}};
  f.scene.add(pending,ready);
  const before={...f.renderer.shadowMap};
  f.mirrors.update(f.camera,{dt:0,mode:'cockpit'});
  for(const call of f.renderer.calls) {
    assert.deepEqual(call.shadows,[{name:'pending-shadow',castShadow:false},{name:'ready-shadow',castShadow:true}]);
    assert.equal(call.shadowEnabled,true,'ready maps are still sampled; only missing light maps are omitted');
    assert.ok(call.visible.includes('rear-left')&&call.visible.includes('rear-right'));
  }
  assert.equal(f.mirrors.diagnostics.shadowFallbackPasses,3);
  assert.equal(pending.castShadow,true);assert.equal(ready.castShadow,true);assert.deepEqual(f.renderer.shadowMap,before);
  // Simulate the owner's main pass initializing the pending map.
  pending.shadow.map=new T.WebGLRenderTarget(16,16);pending.shadow.map.depthTexture=new T.DepthTexture(16,16);
  gpu.set(pending.shadow.map.depthTexture,{__webglTexture:{}});
  f.mirrors.update(f.camera,{dt:.1,mode:'cockpit'});
  assert.ok(f.renderer.calls.slice(-3).every(call=>call.shadows.every(light=>light.castShadow)));
  assert.equal(f.mirrors.diagnostics.shadowFallbackPasses,3);
  // A quality bucket replacement leaves a null map until the next main pass.
  const replaced=pending.shadow.map;pending.shadow.map=null;pending.shadow.needsUpdate=true;
  f.renderer.fail=true;f.mirrors.update(f.camera,{dt:.1,mode:'cockpit',force:true});
  assert.equal(pending.castShadow,true);assert.equal(ready.castShadow,true);assert.deepEqual(f.renderer.shadowMap,before);
  // Context restoration can leave logical targets alive with no GPU textures.
  pending.shadow.map=replaced;gpu.delete(pending.shadow.map.depthTexture);gpu.delete(ready.shadow.map.depthTexture);
  f.renderer.listeners.get('webglcontextlost')();f.renderer.listeners.get('webglcontextrestored')();
  f.renderer.fail=false;f.mirrors.update(f.camera,{dt:0,paused:true,mode:'cockpit'});
  assert.ok(f.renderer.calls.slice(-3).every(call=>call.shadows.every(light=>!light.castShadow)));
  assert.equal(pending.castShadow,true);assert.equal(ready.castShadow,true);assert.deepEqual(f.renderer.shadowMap,before);
  // Once the main pass recreates the allocations, the very next capture reuses them.
  gpu.set(pending.shadow.map.depthTexture,{__webglTexture:{}});gpu.set(ready.shadow.map.depthTexture,{__webglTexture:{}});
  f.mirrors.update(f.camera,{dt:0,paused:true,mode:'cockpit',force:true});
  assert.ok(f.renderer.calls.slice(-3).every(call=>call.shadows.every(light=>light.castShadow)));
  assert.deepEqual(f.renderer.shadowMap,before);
  f.mirrors.dispose();pending.shadow.map.dispose();ready.shadow.map.dispose();
});

test('actual pod camera sees rear-right traffic without tank/pod obstruction while retaining honest inward body occlusion',async()=>{
  const {scene:template}=await loadRoadsterGeometry(),player=createCar(template),scene=new T.Scene();scene.add(player);
  const renderer=fakeRenderer(),mirrors=createPlayerMirrors(renderer,scene,player),rig=createCockpitView(player),camera=new T.PerspectiveCamera();
  setPlayerAeroPose(player,0);updateCockpitCamera(camera,rig,{phase:'playing'},{aspect:16/9});
  mirrors.update(camera,{dt:0,mode:'cockpit'});assert.equal(mirrors.diagnostics.rightCamera.active,true,'actual dedicated right display is visible');
  assert.ok(mirrors.rightCameraTexture);const capture=renderer.calls.find(call=>call.camera.name==='player-right-rear-camera');
  const sensor=capture.camera,opaque=[];player.traverse(mesh=>{if(mesh.isMesh&&!mesh.material.transparent&&!mesh.userData.mirrorRole&&mesh.name!=='detail_right_rear_display')opaque.push(mesh);});
  for(const z of [9,12,15,30]) {
    const target=new T.Vector3(3.5,.9,z),ndc=target.clone().project(sensor);
    assert.ok(Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1&&Math.abs(ndc.z)<1,'actual right lane stays within fixed camera optics');
    const direction=target.clone().sub(sensor.position);
    assert.equal(new T.Raycaster(sensor.position,direction.clone().normalize(),.04,direction.length()).intersectObjects(opaque,false).length,0,'right lane not blocked by player');
  }
  const central=new T.Raycaster();central.setFromCamera(new T.Vector2(0,0),sensor);
  assert.equal(central.intersectObjects(opaque,false).length,0,'sensor optical center is outside its pod rim');
  const inward=new T.Raycaster();inward.setFromCamera(new T.Vector2(.8,-.5),sensor);
  const hits=inward.intersectObjects(opaque,false);assert.ok(hits.length>0,'car flank legitimately occupies inward edge');
  assert.ok(capture.visible.includes(hits[0].object.name),'do not hide the player or vessel to fake a clear view');
  assert.ok(!capture.visible.includes('detail_right_rear_display'),'right display never samples its own active render target');
  mirrors.dispose();
});
