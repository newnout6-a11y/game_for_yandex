import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageCameraMotion,frameCockpitCustomization} from '../src/garage-camera-motion.js';
import {VehiclePaintTransition} from '../src/paint-transition.js';
import {createOwnedVehicle,applyVehicleAppearance,isRotorScoreVertex} from '../src/owned-vehicles.js';
import {setPlayerInteriorView} from '../src/car.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';
import {createProfile,reduceProgression} from '../src/progression.js';
const template=(await loadRoadsterGeometry()).scene;
const close=(a,b)=>assert.ok(a.distanceTo(b)<1e-8);

test('camera moves finitely from displayed pose to real target, keeps viewport offsets and settles offscreen',()=>{
 const camera=new T.PerspectiveCamera(38,1.6,.08,80);camera.position.set(-5,3,-7);camera.lookAt(0,.8,0);camera.setViewOffset(1440,900,100,-30,1440,900);
 const motion=new GarageCameraMotion(),start=camera.position.clone();motion.begin(camera);
 const target=new T.Vector3(-1.5,.9,-1.8),look=new T.Vector3(-.8,.35,-1.4);
 const desired=()=>{camera.position.copy(target);camera.lookAt(look);camera.fov=42;camera.near=.025;camera.setViewOffset(1440,900,-50,30,1440,900);};
 desired();motion.apply(camera,1440,900);close(camera.position,start);assert.equal(camera.view.offsetX,100);
 motion.advance(.425);desired();motion.apply(camera,1440,900);close(camera.position,start.clone().lerp(target,.5));assert.ok(Math.abs(camera.view.offsetX-25)<1e-7);assert.ok(camera.quaternion.toArray().every(Number.isFinite));
 const interrupted=camera.position.clone();motion.begin(camera);desired();motion.apply(camera,1440,900);close(camera.position,interrupted);
 assert.equal(motion.advance(0,{visible:false}),true);assert.equal(motion.active,false);desired();motion.apply(camera,1440,900);close(camera.position,target);
 motion.begin(camera,{reducedMotion:true});assert.equal(motion.active,false);
});

test('all four real rims wipe within their individual disc extent, never tyre, brake, body or shared source',()=>{
 const car=createOwnedVehicle({car:template}),source=new Set();template.traverse(n=>{if(n.isMesh)source.add(n.material);});
 const slots=car.userData.appearance.rims,roots=[...new Set(slots.map(s=>s.root))];assert.equal(roots.length,4);
 const wipes=roots.map(root=>new VehiclePaintTransition(car,{slot:'rims',root}));
 const untouched=[];car.traverse(node=>{if(node.isMesh&&(/rubber|tire/i.test(node.material?.name)||/^wheel_(?:fl|fr|rl|rr)_dark_alloy$/.test(node.name)))untouched.push({node,material:node.material,color:node.material.color.getHex(),compile:node.material.onBeforeCompile});});assert.ok(untouched.length>=8);const paint=car.userData.appearance.paint.map(s=>s.material.color.getHex());
 const old=wipes.map(w=>w.current[0].clone());applyVehicleAppearance(car,{'wheels.finish':'rim_rose'});
 for(const [i,wipe] of wipes.entries()){
  assert.ok(wipe.materials.length>0);assert.ok(wipe.materials.every(m=>!source.has(m)));wipe.retarget();wipe.setProgress(.5);
  const {x:min,y:max}=wipe.uniforms.garagePaintRange.value;assert.ok(max-min>.3&&max-min<.8);
  const front=wipe.colorAt(min+.1*(max-min)),rear=wipe.colorAt(max-.1*(max-min));assert.ok(Math.abs(front.r-wipe.materials[0].color.r)+Math.abs(front.g-wipe.materials[0].color.g)+Math.abs(front.b-wipe.materials[0].color.b)<1e-8);assert.ok(Math.abs(rear.r-old[i].r)+Math.abs(rear.g-old[i].g)+Math.abs(rear.b-old[i].b)<1e-8);
 }
 assert.deepEqual(car.userData.appearance.paint.map(s=>s.material.color.getHex()),paint);for(const entry of untouched){assert.equal(entry.node.material,entry.material);assert.equal(entry.material.color.getHex(),entry.color);assert.equal(entry.material.onBeforeCompile,entry.compile);assert.ok(!slots.some(slot=>slot.material===entry.material));}
 for(const wipe of wipes){wipe.advance(0,{visible:false});assert.equal(wipe.active,false);wipe.dispose();}
});

test('tint applies to glazing only, preserves readable cockpit and restores exterior selection and exact stock',()=>{
 const car=createOwnedVehicle({car:template}),other=createOwnedVehicle({car:template});assert.ok(car.userData.appearance.glass.length>0);
 const stock=car.userData.appearance.glass.map(s=>[s.material.color.getHex(),s.material.opacity]);
 applyVehicleAppearance(car,{'body.tint':'tint_smoke'});const selected=car.userData.glazing.map(e=>e.opacity);assert.ok(selected.every((v,i)=>v>stock[i][1]&&v<=.92));
 const smoke=selected.slice();applyVehicleAppearance(car,{'body.tint':'tint_light'});assert.ok(car.userData.glazing.every((e,i)=>e.opacity<smoke[i]&&e.opacity>stock[i][1]));applyVehicleAppearance(car,{'body.tint':'tint_smoke'});
 for(const e of car.userData.glazing)assert.ok(car.userData.appearance.glass.some(s=>s.material===e.material));
 setPlayerInteriorView(car,true);assert.ok(car.userData.glazing.every(e=>e.material.opacity<=.1));setPlayerInteriorView(car,false);assert.deepEqual(car.userData.glazing.map(e=>e.material.opacity),selected);
 assert.deepEqual(other.userData.appearance.glass.map(s=>[s.material.color.getHex(),s.material.opacity]),stock);
 applyVehicleAppearance(car,{});assert.deepEqual(car.userData.appearance.glass.map(s=>[s.material.color.getHex(),s.material.opacity]),stock);
});

test('new steering is capability gated; tint/rim purchases debit once and preserve stock physics',()=>{
 let p=createProfile({id:'custom'});p.wallet.credits=3000;
 assert.equal(reduceProgression(p,{type:'BUY_COSMETIC',cosmeticId:'steering_round'}).ok,false);
 for(const id of ['rim_rose','tint_smoke']){const result=reduceProgression(p,{type:'BUY_COSMETIC',cosmeticId:id});assert.equal(result.ok,true);p=result.profile;assert.equal(reduceProgression(p,{type:'BUY_COSMETIC',cosmeticId:id}).ok,false);p=reduceProgression(p,{type:'EQUIP_COSMETIC',cosmeticId:id}).profile;}
 assert.equal(p.wallet.credits,2470);assert.equal(p.mode,'standard');assert.ok(Object.values(p.research).every(v=>v===0));
});

test('actual merged brake scoring rings keep stock albedo underneath the rim wipe without new geometry or draws',()=>{
 const car=createOwnedVehicle({car:template});
 for(const suffix of ['fl','fr','rl','rr']){
  const mesh=car.getObjectByName('wheel_spin_'+suffix+'_dark_alloy'),pos=mesh.geometry.attributes.position,index=mesh.geometry.index;let score=0;
  const mask=Array.from({length:pos.count},(_,i)=>isRotorScoreVertex(pos.getX(i),pos.getY(i),pos.getZ(i)));score=mask.filter(Boolean).length;assert.equal(score,768);
  for(let i=0;i<(index?.count||pos.count);i+=3){const values=[0,1,2].map(j=>mask[index?index.getX(i+j):i+j]);assert.ok(values.every(v=>v===values[0]),'No mixed brake/rim triangle permits interpolation leakage');}
  const root=car.getObjectByName('wheel_'+suffix),wipe=new VehiclePaintTransition(car,{slot:'rims',root}),shader={uniforms:{},vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader};
  mesh.material.onBeforeCompile(shader);assert.ok(shader.uniforms.garageBrakeBaseColor.value.equals(template.getObjectByName(mesh.name).material.color));
  assert.ok(shader.fragmentShader.indexOf('if(vGarageBrakeScore>0.5)')>shader.fragmentShader.indexOf('diffuseColor.rgb = mix'));
  assert.equal(mesh.geometry,template.getObjectByName(mesh.name).geometry);wipe.dispose();
 }
});

test('seated cockpit framing contains actual steering wheel and tablet on desktop and short landscape',()=>{
 const car=createOwnedVehicle({car:template});let data;car.traverse(node=>{if(node.userData.driverDisplay)data=node.userData.driverDisplay;});const frame=car.userData.bodyRig;car.updateMatrixWorld(true);
 for(const [width,height,region]of [[1440,900,{x:248,y:198,width:800,height:560}],[844,390,{x:125,y:128,width:403,height:156}]]){
  const camera=new T.PerspectiveCamera(38,width/height,.025,80),eye=new T.Vector3(...data.reference_eye_game_m).applyMatrix4(frame.matrixWorld);camera.position.copy(eye);
  const points=frameCockpitCustomization(camera,car,data,frame,width,height,region);close(camera.position,eye);assert.ok(points.length>10);
  for(const point of points){const p=point.clone().project(camera),x=(p.x+1)*width/2,y=(1-p.y)*height/2;assert.ok(x>region.x&&x<region.x+region.width,`x ${x}`);assert.ok(y>region.y&&y<region.y+region.height,`y ${y}`);}
 }
});
