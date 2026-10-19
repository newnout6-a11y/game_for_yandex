import * as T from '../public/vendor/three.js';
import { playerHighBeam } from './player-horn.js';

/**
 * Prepare two non-shadowing player-only high beams at the authored front lenses.
 * Shared model materials are cloned once; neither traffic templates nor garage
 * miniatures change. No reflection camera, transparent cone or mesh is added.
 * @param {T.Object3D} car - Loaded grounded player, front -Z and up +Y.
 * @returns {Object} Cached isolated lights/materials with an update(state) method.
 */
export function createPlayerHeadlights(car) {
  if(car.userData.highBeams)return car.userData.highBeams;
  car.updateMatrixWorld(true);
  const inverse=car.matrixWorld.clone().invert(),point=new T.Vector3(),materials=new Map();
  const bounds=[new T.Box3(),new T.Box3()];
  car.traverse(node=>{
    if(!node.isMesh||Array.isArray(node.material)||! /^(LED_white|lights_white)$/.test(node.material?.name||''))return;
    const source=node.material;
    if(!materials.has(source))materials.set(source,{material:source.clone(),intensity:source.emissiveIntensity??1});
    node.material=materials.get(source).material;
    const positions=node.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      point.fromBufferAttribute(positions,i).applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
      if(point.z<-.6)bounds[point.x<0?0:1].expandByPoint(point);
    }
  });
  const group=new T.Group();group.name='player_high_beam_lights';
  const lights=[];
  for(let side=0;side<2;side++){
    if(bounds[side].isEmpty())continue;
    const center=bounds[side].getCenter(new T.Vector3());center.z=bounds[side].min.z-.025;
    const light=new T.SpotLight('#e9f3ff',0,65,.21,.65,2);light.castShadow=false;
    light.position.copy(center);light.target.position.copy(center).add(new T.Vector3(side?1:-1,-.65,-35));
    group.add(light,light.target);lights.push(light);
  }
  car.add(group);
  const entries=[...materials.values()];
  /** Apply the common simulation pulse while retaining authored normal lamp levels. */
  const update=state=>{
    const amount=playerHighBeam(state);
    for(const entry of entries)entry.material.emissiveIntensity=entry.intensity+amount*5;
    for(const light of lights)light.intensity=amount*900;
    return amount;
  };
  const result={group,lights,materials:entries,update};car.userData.highBeams=result;return result;
}
