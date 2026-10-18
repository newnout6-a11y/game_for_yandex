import * as T from '../public/vendor/three.js';

/** Capture an actual camera pose and normalized viewport offset, without retaining mutable camera objects. */
function pose(camera){return {position:camera.position.clone(),rotation:camera.quaternion.clone(),fov:camera.fov,near:camera.near,offset:new T.Vector2(camera.view?.enabled?camera.view.offsetX/camera.view.fullWidth:0,camera.view?.enabled?camera.view.offsetY/camera.view.fullHeight:0)};}

/** Finite user-triggered camera travel. No idle orbit, simulation movement or infinite damping tail. */
export class GarageCameraMotion {
  constructor(){this.active=false;this.progress=1;this.from=null;this.duration=.85;}
  /** Start from the last displayed pose, including an interrupted previous transition. */
  begin(camera,{reducedMotion=false}={}){this.from=pose(camera);this.progress=reducedMotion?1:0;this.active=!reducedMotion;}
  /** Advance visible elapsed seconds; hidden or reduced-motion views settle immediately. */
  advance(dt,{visible=true,reducedMotion=false}={}){if(!this.active)return false;if(!visible||reducedMotion){this.progress=1;this.active=false;return true;}if(!Number.isFinite(dt)||dt<=0)return false;this.progress=Math.min(1,this.progress+dt/this.duration);this.active=this.progress<1;return true;}
  /** Blend toward the freshly fitted target pose, then restore a coherent matching projection. */
  apply(camera,width,height){if(!this.active||!this.from)return;const next=pose(camera),p=this.progress,t=p*p*(3-2*p);camera.position.lerpVectors(this.from.position,next.position,t);camera.quaternion.slerpQuaternions(this.from.rotation,next.rotation,t);camera.fov=T.MathUtils.lerp(this.from.fov,next.fov,t);camera.near=T.MathUtils.lerp(this.from.near,next.near,t);const offset=this.from.offset.clone().lerp(next.offset,t);camera.setViewOffset(width,height,offset.x*width,offset.y*height,width,height);camera.updateProjectionMatrix();camera.updateMatrixWorld();}
}

/** Fit the real wheel and tablet from the authored seated eye, not a floating exterior or tablet-only close-up. */
export function frameCockpitCustomization(camera,car,data,frame,width,height,region,orbitOffset=0){
  const points=[],wheel=car.userData.yoke;
  car.updateWorldMatrix(true,true);
  wheel?.traverseVisible(node=>{if(!node.isMesh)return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();const box=node.geometry.boundingBox;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new T.Vector3(x,y,z).applyMatrix4(node.matrixWorld));});
  const center=new T.Vector3(...data.center_game_m),right=new T.Vector3(...(data.right_game||[1,0,0])),up=new T.Vector3(...(data.up_game||[0,1,0])),dimensions=data.active_dimensions_m||[.352,.22];
  for(const x of [-.5,.5])for(const y of [-.5,.5])points.push(center.clone().addScaledVector(right,x*dimensions[0]).addScaledVector(up,y*dimensions[1]).applyMatrix4(frame.matrixWorld));
  const eye=camera.position,angles=points.map(point=>{const d=point.clone().sub(eye);return {yaw:Math.atan2(d.x,-d.z),pitch:Math.atan2(d.y,Math.hypot(d.x,d.z))};});
  const yaw=(Math.min(...angles.map(p=>p.yaw))+Math.max(...angles.map(p=>p.yaw)))/2+orbitOffset*.35;
  const pitch=(Math.min(...angles.map(p=>p.pitch))+Math.max(...angles.map(p=>p.pitch)))/2;
  camera.lookAt(eye.clone().add(new T.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch))));camera.updateMatrixWorld();
  const view=region||{x:0,y:0,width,height},aspect=view.width/view.height;
  let tangent=Math.tan(40*Math.PI/360);
  for(const point of points){const local=point.clone().applyMatrix4(camera.matrixWorldInverse),depth=Math.max(.05,-local.z);tangent=Math.max(tangent,Math.abs(local.y)/depth*1.12,Math.abs(local.x)/depth/aspect*1.12);}
  const effective=Math.min(Math.tan(76*Math.PI/360),tangent);
  camera.fov=Math.min(145,2*Math.atan(effective*height/view.height)*180/Math.PI);camera.updateProjectionMatrix();
  camera.setViewOffset(width,height,width/2-(view.x+view.width/2),height/2-(view.y+view.height/2),width,height);camera.updateMatrixWorld();
  return points;
}
