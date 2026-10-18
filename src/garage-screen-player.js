import * as T from '../public/vendor/three.js';

import { GARAGE_SCREEN_MEDIA } from './garage-screen-media.js';
const POSTER = GARAGE_SCREEN_MEDIA.poster;

/** One silent, deferred film shared by all cached workshop TVs, never an external stream or ad. */
export class GarageScreenPlayer {
  /** Injectable media/texture factories keep lifecycle and failure behavior testable without a browser decoder. */
  constructor({ document: doc = globalThis.document, loadPoster = url => new T.TextureLoader().loadAsync(url), onChange = () => {}, fps = 12, videoUrl = GARAGE_SCREEN_MEDIA.video } = {}) {
    this.videoUrl=videoUrl;this.doc=doc;this.loadPoster=loadPoster;this.onChange=onChange;this.interval=1/Math.max(1,Math.min(12,Number(fps)||12));
    this.rooms=new Map();this.room=null;this.material=null;this.poster=null;this.borrowedPoster=null;this.videoTexture=null;this.video=null;
    this.ready=Promise.resolve();this.disposed=false;this.onScreen=false;this.active=false;this.pendingPlay=false;this.blocked=false;
    this.clock=0;this.lastMediaTime=-1;this.frameChanges=0;this.failed=false;
    this.frustum=new T.Frustum();this.projection=new T.Matrix4();
  }

  /** Replace only the dedicated authored screen surface; its physical frame and optics stay in the GLB. */
  attach(room) {
    const surfaces=[];
    room.traverse(node=>{if(node.isMesh&&(Array.isArray(node.material)?node.material:[node.material]).some(m=>m?.name==='garage_screen_display'))surfaces.push(node);});
    this.rooms.set(room,surfaces);
    if(!surfaces.length||!this.doc?.createElement||this.disposed)return this.ready;
    if(!this.material){
      const original=(Array.isArray(surfaces[0].material)?surfaces[0].material:[surfaces[0].material]).find(m=>m?.name==='garage_screen_display');
      this.borrowedPoster=original?.map||original?.emissiveMap||null;
      this.material=new T.MeshBasicMaterial({color:'#ffffff',map:this.borrowedPoster,toneMapped:false});this.material.name='garage_screen_display';this.material.userData.garageScreenOwned=true;
      // The GLB already embeds the same credited poster; borrow it rather than
      // upload a second identical image to the GPU. External loading is fallback only.
      this.ready=this.borrowedPoster?Promise.resolve():this.loadPoster(POSTER).then(texture=>{
        if(this.disposed){texture.dispose();return;}
        texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;texture.anisotropy=1;this.poster=texture;this.use(texture);this.onChange();
      }).catch(()=>{if(this.disposed)return;this.failed=true;if(!this.borrowedPoster)this.material?.color.set('#162647');this.onChange();});
    }
    for(const node of surfaces){
      node.castShadow=false;node.receiveShadow=false;
      const replace=m=>{if(m?.name!=='garage_screen_display'||m===this.material)return m;(node.userData.garageScreenOriginalMaterials||=[]).push(m);return this.material;};
      node.material=Array.isArray(node.material)?node.material.map(replace):replace(node.material);
    }
    // Original loaded materials remain with the room owner for precise final disposal.
    return this.ready;
  }

  /** Select the committed room; a stale asynchronous tier cannot activate its own media. */
  setRoom(room){this.room=room;this.onScreen=false;this.stop();}

  /** Test the real plane, its front face and the unobstructed UI rectangle before decoding/animating. */
  updateVisibility(camera,width,height,region={x:0,y:0,width,height}){
    this.onScreen=false;
    this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projection);
    for(const node of this.rooms.get(this.room)||[]){
      node.updateWorldMatrix(true,false);const box=new T.Box3().setFromObject(node,true);
      if(!this.frustum.intersectsBox(box))continue;
      const center=box.getCenter(new T.Vector3()),normals=node.geometry.attributes.normal;
      if(normals){const normal=new T.Vector3().fromBufferAttribute(normals,0).applyNormalMatrix(new T.Matrix3().getNormalMatrix(node.matrixWorld));if(normal.dot(camera.position.clone().sub(center))<=0)continue;}
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
        const p=new T.Vector3(x,y,z).project(camera),px=(p.x+1)*width/2,py=(1-p.y)*height/2;
        left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
      }
      const overlapX=Math.min(right,region.x+region.width)-Math.max(left,region.x),overlapY=Math.min(bottom,region.y+region.height)-Math.max(top,region.y);
      if(overlapX>=4&&overlapY>=4){this.onScreen=true;break;}
    }
    return this.onScreen;
  }

  /** Lazily create a muted inline decoder only when the actual TV can be seen. */
  ensureVideo(){
    if(this.video||!this.videoUrl||!this.doc?.createElement)return;
    const video=this.doc.createElement('video');video.muted=true;video.defaultMuted=true;video.volume=0;video.loop=true;video.playsInline=true;
    video.preload='metadata';video.disablePictureInPicture=true;video.setAttribute?.('muted','');video.setAttribute?.('playsinline','');
    video.src=this.videoUrl;this.video=video;
    this.videoTexture=new T.VideoTexture(video);this.videoTexture.colorSpace=T.SRGBColorSpace;this.videoTexture.flipY=false;this.videoTexture.minFilter=T.LinearFilter;this.videoTexture.magFilter=T.LinearFilter;this.videoTexture.generateMipmaps=false;
    this.onMediaError=()=>{this.failed=true;this.blocked=true;this.stop();this.use(this.poster||this.borrowedPoster);this.onChange();};video.addEventListener('error',this.onMediaError);
  }

  /** Switch maps without accumulating materials, passes or repeated shader recompiles. */
  use(texture){if(!this.material||!texture||this.material.map===texture)return false;const hadMap=Boolean(this.material.map);this.material.map=texture;if(!hadMap)this.material.needsUpdate=true;return true;}

  /** Pause decoding immediately at any hidden, orientation, platform/ad, reduced-motion or rear-facing boundary. */
  stop(){this.active=false;this.clock=0;if(this.video&&!this.video.paused)this.video.pause();}

  /** Schedule at most twelve scene refreshes per second, and only for a newly decoded frame. */
  advance(dt,{visible=true,reducedMotion=false,mediaActive=true}={}){
    if(this.disposed||!this.material)return false;
    const eligible=Boolean(this.videoUrl)&&visible&&mediaActive&&!reducedMotion&&this.onScreen&&!this.failed;
    if(!eligible){this.stop();return reducedMotion?this.use(this.poster||this.borrowedPoster):false;}
    if(!this.active){this.active=true;this.blocked=false;this.clock=this.interval;}
    this.ensureVideo();const video=this.video;if(!video)return false;
    if(video.paused&&!this.pendingPlay&&!this.blocked){
      this.pendingPlay=true;
      Promise.resolve().then(()=>this.active&&!this.disposed?video.play():undefined).then(()=>{this.pendingPlay=false;if(!this.active||this.disposed)video.pause();this.onChange();})
        .catch(()=>{this.pendingPlay=false;this.blocked=true;this.use(this.poster||this.borrowedPoster);this.onChange();});
    }
    if(this.blocked)return false;
    this.clock+=Math.min(.1,Math.max(0,Number(dt)||0));
    if(this.clock<this.interval||video.readyState<2||video.currentTime===this.lastMediaTime)return false;
    this.clock%=this.interval;this.lastMediaTime=video.currentTime;this.use(this.videoTexture);this.frameChanges++;return true;
  }

  /** Stop the local decoder and release the one exclusively owned material/texture pair exactly once. */
  dispose(){
    if(this.disposed)return;this.disposed=true;this.stop();
    if(this.video){this.video.removeEventListener('error',this.onMediaError);this.video.removeAttribute?.('src');this.video.load?.();}
    this.videoTexture?.dispose();this.poster?.dispose();this.material?.dispose();this.rooms.clear();this.room=null;
  }
}
