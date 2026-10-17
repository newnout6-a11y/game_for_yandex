import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { trafficDefinition } from '../src/traffic-catalog.js';

const kinds = ['sedan', 'hatch', 'suv', 'van'];

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
    assert.equal(draws, 23, `${kind} should batch cabin, mirrors and two indicator sides while retaining the four wheels`);
    assert.ok(triangles >= 17000 && triangles <= 22500, `${kind}: unexpected ${triangles} triangles`);
  });
}
