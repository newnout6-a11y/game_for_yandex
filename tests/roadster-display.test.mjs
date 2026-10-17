import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { createCar, animatePlayerCar } from '../src/car.js';

const { scene, json } = await loadRoadsterGeometry();
const car = createCar(scene), root = car.getObjectByName('Roadster');
const display = root.userData.driverDisplay;
const screen = car.getObjectByName('detail_rc_ui');

/** Convert an authored root-local game-metre coordinate to the actual loaded world. */
function worldPoint(point) {
  return new T.Vector3(...point).applyMatrix4(root.matrixWorld);
}

/** Index exact world-space triangles by bounds; bounds only prune, never decide occlusion. */
function triangleTree(objects) {
  const list=[];
  for(const mesh of objects){
    const {position}=mesh.geometry.attributes,index=mesh.geometry.index;
    for(let i=0;i<(index?.count??position.count);i+=3){
      const points=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));
      list.push({points,box:new T.Box3().setFromPoints(points),mesh});
    }
  }
  /** Recursively partition triangle records without approximating their surfaces. */
  function partition(triangles){
    const box=new T.Box3();for(const triangle of triangles)box.union(triangle.box);
    if(triangles.length<=12)return{box,triangles};
    const size=box.getSize(new T.Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
    triangles.sort((a,b)=>a.box.min[axis]+a.box.max[axis]-b.box.min[axis]-b.box.max[axis]);
    const half=triangles.length>>1;return{box,left:partition(triangles.slice(0,half)),right:partition(triangles.slice(half))};
  }
  return partition(list);
}

/** Return the nearest genuinely intersected front/double-sided triangle before the display. */
function firstSurface(ray,node,limit){
  const hit=new T.Vector3();let nearest=limit,result=null;
  /** Traverse bounds and resolve exact triangle intersections using exported material culling. */
  function visit(branch){
    if(!ray.intersectsBox(branch.box))return;
    if(!branch.triangles){visit(branch.left);visit(branch.right);return;}
    for(const triangle of branch.triangles){
      const [a,b,c]=triangle.points,side=triangle.mesh.material.side;
      const found=side===T.BackSide?ray.intersectTriangle(c,b,a,true,hit):ray.intersectTriangle(a,b,c,side!==T.DoubleSide,hit);
      if(found){const distance=ray.origin.distanceTo(hit);if(distance>1e-5&&distance<nearest){nearest=distance;result=triangle.mesh;}}
    }
  }
  visit(node);return result;
}

test('actual tablet is a flat orthonormal 16:10 surface with undistorted full-face UVs', () => {
  assert.ok(display && screen?.isMesh, 'Export a real readable display and its inspection contract');
  const right = new T.Vector3(...display.right_game), up = new T.Vector3(...display.up_game);
  const normal = new T.Vector3(...display.normal_game);
  assert.ok(Math.abs(right.length()-1)<1e-6 && Math.abs(up.length()-1)<1e-6);
  assert.ok(Math.abs(right.dot(up))<1e-6 && right.clone().cross(up).distanceTo(normal)<1e-6);
  assert.equal(display.roll_degrees,0);
  const inv = root.matrixWorld.clone().invert(), {position,uv}=screen.geometry.attributes;
  assert.equal(position.count,4); assert.equal(uv.count,4);
  const points=Array.from({length:4},(_,i)=>new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(screen.matrixWorld).applyMatrix4(inv));
  const center=new T.Vector3(...display.center_game_m);
  for(let i=0;i<4;i++){
    // glTF image V is top-down; Blender's export flips the authored upward UV.
    const x=(uv.getX(i)-.5)*display.active_dimensions_m[0], y=(.5-uv.getY(i))*display.active_dimensions_m[1];
    const expected=center.clone().addScaledVector(right,x).addScaledVector(up,y).addScaledVector(normal,.001);
    assert.ok(points[i].distanceTo(expected)<2e-6, `Vertex ${i} must match its physical UV position, not a sheared rectangle`);
    assert.ok([0,1].includes(uv.getX(i)) && [0,1].includes(uv.getY(i)));
  }
  assert.ok(Math.abs(display.active_dimensions_m[0]/display.active_dimensions_m[1]-1.6)<1e-9);
  assert.equal(display.texture_dimensions_px[0]/display.texture_dimensions_px[1],1.6);
  const ui=json.materials.find(m=>m.name==='RC_Original_Landscape_UI');
  assert.ok(ui?.pbrMetallicRoughness?.baseColorTexture,'The original artwork is embedded, not a screenshot overlay');
});

test('whole tablet stays visible through the driver eye box and real yoke steering range',()=>{
  assert.ok(display && screen?.isMesh);
  const center=new T.Vector3(...display.center_game_m), right=new T.Vector3(...display.right_game);
  const up=new T.Vector3(...display.up_game), normal=new T.Vector3(...display.normal_game);
  const lo=display.tested_eye_box_min_game_m, hi=display.tested_eye_box_max_game_m;
  const opaque=[];car.traverse(n=>{if(n.isMesh && !n.material.transparent && n.material.opacity>=.99)opaque.push(n);});
  let probes=0;
  for(const steering of [-.5,0,.5]){
    animatePlayerCar(car,0,steering,false);car.updateMatrixWorld(true);
    const tree=triangleTree(opaque);
    for(const ax of [0,.5,1]) for(const ay of [0,.5,1]) for(const az of [0,.5,1]){
      const eye=worldPoint([lo[0]+ax*(hi[0]-lo[0]),lo[1]+ay*(hi[1]-lo[1]),lo[2]+az*(hi[2]-lo[2])]);
      for(let row=0;row<7;row++)for(let col=0;col<11;col++){
        const point=center.clone().addScaledVector(right,((col+.2)/10.4-.5)*display.active_dimensions_m[0])
          .addScaledVector(up,((row+.2)/6.4-.5)*display.active_dimensions_m[1]).addScaledVector(normal,.001);
        const target=worldPoint(point.toArray()),delta=target.clone().sub(eye);
        const hit=firstSurface(new T.Ray(eye,delta.clone().normalize()),tree,delta.length()+.001);
        assert.equal(hit,screen,`Display blocked at steering=${steering}, eye=${ax}/${ay}/${az}, pixel=${col}/${row} by ${hit?.name}`);
        probes++;
      }
    }
  }
  assert.equal(probes,6237);
});
