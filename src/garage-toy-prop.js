import * as T from '../public/vendor/three.js';

/** Blender-authored toy placement in metres, clear of the selected car and parking bays. */
export const GARAGE_TOY_POSITION = Object.freeze([-2.95, -.007, 4.8]);
export const GARAGE_TOY_YAW = .20;

/** Dispose only resources owned by this separately loaded decorative GLB, once each. */
function release(root) {
  if (!root) return;
  root.removeFromParent();
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(node=>{if(!node.isMesh)return;geometries.add(node.geometry);
    for(const material of Array.isArray(node.material)?node.material:[node.material]){
      if(!material)continue;materials.add(material);
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
  const images=new Set();
  for(const texture of textures){
    const data=texture.source?.data??texture.image;
    for(const image of Array.isArray(data)?data:[data])if(typeof image?.close==='function')images.add(image);
    texture.dispose();
  }
  // GLTF image bitmaps belong to this independent asset, not the shared room.
  for(const image of images)image.close();
}

/** One shared-in-room, independently owned toy; never a selectable or gameplay vehicle. */
export class GarageToyProp {
  /** Borrow the room loader, but own the resulting GLB resources and finite load lifecycle. */
  constructor(loader,{onError=()=>{}}={}){this.loader=loader;this.onError=onError;this.root=null;this.promise=null;this.disposed=false;}
  /** Load once; duplicate calls share the request, and disposal rejects late adoption without leaking GPU assets. */
  load(){
    if(this.disposed)return Promise.resolve(null);
    if(this.promise)return this.promise;
    this.promise=Promise.resolve().then(()=>this.disposed?null:this.loader.loadAsync(new URL('../public/assets/garage/toy-racecar.glb',import.meta.url).href)).then(gltf=>{
      if(!gltf)return null;
      const root=gltf.scene;
      if(this.disposed){release(root);return null;}
      root.name='Garage toy racecar';root.position.set(...GARAGE_TOY_POSITION);root.rotation.y=GARAGE_TOY_YAW;
      root.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;
        for(const material of Array.isArray(node.material)?node.material:[node.material]){
          // Flush painted graphics need a bounded depth bias at the far showroom
          // camera. Keep depth testing: the car and room must still occlude them.
          // The opaque UV-painted windshield is part of its receiver, not a layer.
          if(material?.name==='Toy McQueen printed decals'){
            material.polygonOffset=true;material.polygonOffsetFactor=-2;material.polygonOffsetUnits=-2;
          }
        }
      }});
      root.updateMatrixWorld(true);this.root=root;return root;
    }).catch(error=>{if(!this.disposed)this.onError(error);return null;});
    return this.promise;
  }
  /** Exact transformed model envelope used by the existing room-aware camera clearance solver. */
  bounds(){return this.root?new T.Box3().setFromObject(this.root,true):null;}
  /** Idempotently release the independent prop; an in-flight load is released by its own continuation. */
  dispose(){if(this.disposed)return;this.disposed=true;release(this.root);this.root=null;this.promise=null;}
}
