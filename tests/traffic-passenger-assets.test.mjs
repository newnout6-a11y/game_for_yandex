import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { trafficDefinition } from '../src/traffic-catalog.js';

const kinds = ['sedan', 'hatch', 'suv', 'van'];
const cabinDatums={sedan:{floor:.43,belt:.92,front:-1.13,seat:-.02},hatch:{floor:.45,belt:.95,front:-.98,seat:.06},suv:{floor:.55,belt:1.105,front:-1.14,seat:.04},van:{floor:.62,belt:1.19,front:-2.10,seat:-1.05}};

for (const kind of kinds) {
  test(`${kind} is an editable Blender asset with a valid optimized game GLB`, async () => {
    const blend = await readFile(new URL(`../art/traffic/${kind}.blend`, import.meta.url));
    assert.equal(blend.subarray(0, 7).toString(), 'BLENDER');
    const data = await readFile(new URL(`../public/assets/traffic/${kind}.glb`, import.meta.url));
    const asset = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    const scene = asset.scene;
    scene.updateMatrixWorld(true);
    const spec = trafficDefinition(kind);
    const bounds = new THREE.Box3().setFromObject(scene);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.x <= spec.width + .02, `${kind} exceeds width envelope`);
    assert.ok(size.z <= spec.length + .02, `${kind} exceeds length envelope`);
    assert.ok(bounds.max.y <= spec.height + .025, `${kind} exceeds height envelope`);
    assert.ok(bounds.min.y >= -.005 && bounds.min.y < .04, `${kind} does not meet road level`);
    assert.ok(Math.abs((bounds.min.z + bounds.max.z) * .5) < .02, `${kind} is not centered`);
    const body = scene.getObjectByName('body');
    assert.ok(body?.isMesh, 'Paint needs its stable tintable mesh name');
    assert.ok(scene.getObjectByName('lights_red')?.isMesh, 'Brakes need their stable emissive mesh name');
    const cabin=scene.getObjectByName('cabin_interior');
    assert.ok(cabin?.isMesh && cabin.geometry.attributes.color, 'A real vertex-colored cabin must be exported');
    const colors=cabin.geometry.attributes.color.array;
    assert.ok(Math.max(...colors)-Math.min(...colors)>.2,'Upholstery and dashboard need readable contrast');
    const roofRay=new THREE.Raycaster(new THREE.Vector3(0,spec.height-.30,0),new THREE.Vector3(0,1,0));
    const linerHit=roofRay.intersectObject(cabin)[0];
    assert.ok(linerHit && linerHit.face.normal.y<-.9,'A visible inward-facing headliner must close the cabin roof');
    const datum=cabinDatums[kind];
    for(const x of [-.38,.38]){
      const floorRay=new THREE.Raycaster(new THREE.Vector3(x,datum.floor+.18,datum.front+.37),new THREE.Vector3(0,-1,0));
      const floorHit=floorRay.intersectObject(cabin)[0];
      assert.ok(floorHit && Math.abs(floorHit.point.y-datum.floor)<.05,'Footwells need a true floor, not a view down to the road');
      const firewallRay=new THREE.Raycaster(new THREE.Vector3(x,datum.floor+.18,datum.front+.37),new THREE.Vector3(0,0,-1));
      const firewallHit=firewallRay.intersectObject(cabin)[0];
      assert.ok(firewallHit && firewallHit.distance<.40,'Forward footwell must close before the front tires/engine bay');
    }
    const steering=scene.getObjectByName('steering_wheel'),stalk=scene.getObjectByName('indicator_stalk');
    assert.ok(steering && !steering.isMesh && stalk && !stalk.isMesh,'Runtime needs real steering and signal control pivots');
    const wheelAxis=new THREE.Vector3(0,0,1).applyQuaternion(steering.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(wheelAxis.z>.8 && wheelAxis.y>.1,'Steering local XY is its wheel plane; +Z must point toward the driver');
    const head=scene.getObjectByName('driver_head');
    assert.ok(head && !head.isMesh && head.parent===steering.parent,'Head glance pivot must remain a separate sprung-body root');
    assert.ok(head.scale.distanceTo(new THREE.Vector3(1,1,1))<.00001 && head.quaternion.angleTo(new THREE.Quaternion())<.00001,'Head starts upright with unit scale and local +Y yaw');
    assert.equal(head.children.length,1,'All sculpted head parts must be one vertex-colored draw group');
    const headMesh=head.children[0];
    assert.ok(headMesh.isMesh && headMesh.material===cabin.material && headMesh.geometry.attributes.color,'Head reuses the cabin material without textures');
    const headOrigin=head.getWorldPosition(new THREE.Vector3());
    const faceRay=new THREE.Raycaster(headOrigin.clone().add(new THREE.Vector3(0,.105,-1)),new THREE.Vector3(0,0,1));
    const faceHit=faceRay.intersectObject(headMesh)[0];
    assert.ok(faceHit && faceHit.point.z<headOrigin.z-.115 && faceHit.face.normal.z<-.5,'Sculpted nose must face outward instead of disappearing into the cheek mesh');
    for(const yaw of [-.35,0,.35]){
      head.rotation.y=yaw;scene.updateMatrixWorld(true);
      const headBounds=new THREE.Box3().setFromObject(head);
      assert.ok(headBounds.max.y<spec.height-.04 && headBounds.min.x>-spec.width*.35,'Restrained mirror glance must keep the head inside the roof and side aperture');
    }
    head.rotation.y=0;scene.updateMatrixWorld(true);
    for(const side of ['l','r']){
      const shoulder=scene.getObjectByName('driver_shoulder_'+side),elbow=scene.getObjectByName('driver_elbow_'+side),hand=scene.getObjectByName('driver_hand_'+side),grip=scene.getObjectByName('grip_'+side);
      assert.ok(shoulder && elbow?.parent===shoulder && hand?.parent===elbow && grip?.parent===steering,'Two-bone driver hierarchy must survive GLB export');
      for(const node of [shoulder,elbow,hand,grip,steering,stalk])assert.ok(node.scale.distanceTo(new THREE.Vector3(1,1,1))<.00001,'IK control empties cannot have baked scale');
      assert.ok(Math.abs(elbow.position.x)+Math.abs(elbow.position.z)<.00001 && elbow.position.y>.2,'Upper arm local +Y ends at its elbow');
      assert.ok(Math.abs(hand.position.x)+Math.abs(hand.position.z)<.00001 && hand.position.y>.2,'Forearm local +Y ends at its palm pivot');
      assert.ok(hand.getWorldPosition(new THREE.Vector3()).distanceTo(grip.getWorldPosition(new THREE.Vector3()))<.00001,'Palm and grip markers must coincide at rest');
      assert.equal(hand.children.length,1,'Palm, thumb and four fingers must batch into one moving group');
      const handMesh=hand.children[0],handPosition=handMesh.geometry.attributes.position;
      assert.ok((handMesh.geometry.index?.count??handPosition.count)/3>550,'Hand must retain its shaped palm and distinct curled fingers');
      for(let i=0;i<handPosition.count;i++){
        const point=new THREE.Vector3().fromBufferAttribute(handPosition,i).applyMatrix4(handMesh.matrixWorld);
        steering.worldToLocal(point);
        const rimDistance=Math.hypot(Math.hypot(point.x,point.y)-.145,point.z);
        assert.ok(rimDistance>.019,'Finger/palm surfaces must wrap outside the steering rim, not intersect it');
      }
      for(const angle of [-1.2,-.6,0,.6,1.2]){
        const target=grip.position.clone().applyAxisAngle(new THREE.Vector3(0,0,1),angle).applyMatrix4(steering.matrixWorld);
        assert.ok(shoulder.getWorldPosition(new THREE.Vector3()).distanceTo(target)<elbow.position.y+hand.position.y-.004,'Driver arms must retain grip across the full visual steering range');
      }
      if(side==='l')assert.ok(shoulder.getWorldPosition(new THREE.Vector3()).distanceTo(stalk.getWorldPosition(new THREE.Vector3()))<elbow.position.y+hand.position.y-.004,'Left hand must be able to reach its indicator stalk');
    }
    const glazing=scene.getObjectByName('glass');
    assert.ok(glazing?.material.transparent && glazing.material.opacity>=.1 && glazing.material.opacity<=.3,'Windows must reveal the interior without a transmission pass');
    assert.ok(!glazing.material.transmission,'Mobile cabin glass must not require scene transmission');
    const mirrors=scene.getObjectByName('mirror_reflective');
    assert.ok(mirrors?.isMesh && mirrors.material.metalness>.95 && mirrors.material.roughness<.15,'Mirror panes need their separate reflective material');
    const mirrorNormals=mirrors.geometry.attributes.normal;
    const mirrorPositions=mirrors.geometry.attributes.position;
    for(let i=0;i<mirrorNormals.count;i++)assert.ok(mirrorNormals.getZ(i)>.98 && (Math.abs(mirrorPositions.getX(i))<.1 || Math.abs(mirrorNormals.getX(i))>.1),'Exterior mirrors must face rearward/outward and the interior mirror must face the cabin');
    for(const side of ['left','right']){
      const signal=scene.getObjectByName('indicator_'+side);
      assert.ok(signal?.isMesh && signal.material.name==='indicator_'+side,'Each side needs its own runtime-blinkable amber material');
      const signalBounds=new THREE.Box3().setFromObject(signal);
      assert.ok(signalBounds.min.z<0 && signalBounds.max.z>0,'Each side must have both front and rear indicators');
      for(const end of [-1,1]){
        const positions=signal.geometry.attributes.position,cluster=new THREE.Box3();
        for(let i=0;i<positions.count;i++)if(positions.getZ(i)*end>0)cluster.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions,i));
        const center=cluster.getCenter(new THREE.Vector3());
        const ray=new THREE.Raycaster(new THREE.Vector3(center.x,center.y,end*10),new THREE.Vector3(0,0,-end));
        assert.equal(ray.intersectObject(scene,true)[0]?.object,signal,'Amber indicators must be visible, not buried behind a white/red lens');
      }
    }
    for (const [origin, direction] of [
      [[0,.7,10],[0,0,-1]], [[0,.6,-10],[0,0,1]],
      [[0,10,0],[0,-1,0]], [[0,-2,0],[0,1,0]],
    ]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
      const hit = ray.intersectObject(body)[0];
      assert.ok(hit, 'Front-sided body shell should be visible from every outside direction');
      assert.ok(hit.face.normal.dot(ray.ray.direction) < -.9, 'Body normals must point out, including the underbody');
    }
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const wheel = scene.getObjectByName(name);
      assert.ok(wheel && !wheel.isMesh && wheel.children.length === 3, `Missing rotating pivot ${name}`);
      assert.ok(Math.abs(wheel.position.y - spec.wheelRadius - .015) < .001);
      assert.ok(name.includes('_f') ? wheel.position.z < 0 : wheel.position.z > 0);
      for(const dy of [spec.wheelRadius*.75,spec.wheelRadius*.90]){
        const ray=new THREE.Raycaster(new THREE.Vector3(0,wheel.position.y+dy,wheel.position.z),new THREE.Vector3(Math.sign(wheel.position.x),0,0));
        const wallHit=ray.intersectObject(cabin)[0],tireHit=ray.intersectObject(wheel,true)[0];
        assert.ok(wallHit && tireHit && wallHit.distance<tireHit.distance,'A closed inward wheel tub must hide the tire from the passenger cell');
      }
      const cavityRay=new THREE.Raycaster(new THREE.Vector3(wheel.position.x,wheel.position.y+spec.wheelRadius*.80,wheel.position.z),new THREE.Vector3(-Math.sign(wheel.position.x),0,0));
      const cavityWall=cavityRay.intersectObject(cabin)[0];
      assert.ok(cavityWall && cavityWall.distance<.5 && cavityWall.face.normal.x*Math.sign(wheel.position.x)>.9,'Wheel-side liner surface must exist too; a backface-culled cap exposes sky through the arch');
      const eye=new THREE.Vector3(0,datum.belt-.08,datum.seat),tread=new THREE.Vector3(wheel.position.x,wheel.position.y+spec.wheelRadius*.90,wheel.position.z);
      const insideRay=new THREE.Raycaster(eye,tread.clone().sub(eye).normalize());
      const insideHit=insideRay.intersectObject(cabin)[0];
      assert.ok(insideHit && insideHit.distance<eye.distanceTo(tread),'Occupants must see a cabin surface before any wheel tread');
      const metal = wheel.children.find(child => child.material?.name === 'wheel_metal');
      const tire = wheel.children.find(child => child.material?.name === 'rubber');
      assert.ok(metal?.geometry.attributes.color, 'Rim and brake steel need their baked vertex-metal shades');
      assert.ok(tire, 'Wheel must have a separate rounded tire shell');
      const tirePosition = tire.geometry.attributes.position;
      let actualRadius = 0;
      for (let i=0; i<tirePosition.count; i++) actualRadius = Math.max(actualRadius, Math.hypot(tirePosition.getY(i),tirePosition.getZ(i)));
      assert.ok(Math.abs(actualRadius-spec.wheelRadius)<.00001, 'Authored tire radius must preserve the motion contract');
      const positions=metal.geometry.attributes.position;
      let lipDepth=0,centerDepth=0;
      for(let i=0;i<positions.count;i++){
        const radial=Math.hypot(positions.getY(i),positions.getZ(i))/spec.wheelRadius;
        if(radial>.60&&radial<.69)lipDepth=Math.max(lipDepth,Math.abs(positions.getX(i)));
        if(radial<.14)centerDepth=Math.max(centerDepth,Math.abs(positions.getX(i)));
      }
      assert.ok(lipDepth-centerDepth>.015, 'Rim face must be truly concave, not a flat disc');
      const side=wheel.position.x>0?1:-1,angle=Math.PI/10;
      const rotorRay=new THREE.Raycaster(new THREE.Vector3(side*3,wheel.position.y+Math.cos(angle)*spec.wheelRadius*.40,wheel.position.z+Math.sin(angle)*spec.wheelRadius*.40),new THREE.Vector3(-side,0,0));
      const rotorHit=rotorRay.intersectObject(metal)[0];
      assert.ok(rotorHit&&rotorHit.face.normal.x*side>.1,'Wheel metal must face out through its spokes or steel vent openings');
    }
    let triangles = 0, draws = 0;
    scene.traverse(node => {
      if (!node.isMesh) return;
      draws++;
      const geometry = node.geometry;
      triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      for (const attribute of [geometry.attributes.position, geometry.attributes.normal]) {
        assert.ok(attribute);
        assert.ok(attribute.array.every(Number.isFinite), `${kind} has non-finite vertex data`);
      }
    });
    assert.equal(draws, 31, `${kind} adds only one independently rotating head to the accepted driver rig`);
    assert.ok(triangles >= 26000 && triangles <= 30000, `${kind}: unexpected ${triangles} triangles`);
  });
}
