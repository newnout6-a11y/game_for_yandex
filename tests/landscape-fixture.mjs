import * as T from '../public/vendor/three.js';
import { buildScenicLandscape } from '../src/landscape.js';
import { roadBend } from '../src/world.js';

/**
 * Build the real landscape against minimal canvas and WebGL-context stubs.
 * Temporarily replaces global document and restores it even if building throws.
 * The returned Three.js scene supports geometry assertions, not pixel/render QA.
 * @returns {object} Mutable host with built scenery, textures and scene.
 */
export function landscapeFixture(){
 const old=globalThis.document;
 const gradient={/** Accept gradient stops without rasterizing them; this fixture checks geometry, not pixels. */ addColorStop(){}};
 const context=new Proxy({/** Return the shared no-op linear-gradient stub. */ createLinearGradient:()=>gradient,/** Return the shared no-op radial-gradient stub. */ createRadialGradient:()=>gradient,/** Approximate text width as 12 pixels per character without font measurement. */ measureText:text=>({width:text.length*12})},{/** Return an implemented context member or a no-op drawing function for other properties. */ get:(o,k)=>k in o?o[k]:()=>{}});
 globalThis.document={/** Create a fresh 1×1 canvas-like object; the element tag is intentionally ignored. */ createElement:()=>({width:1,height:1,/** Return the shared fake 2D context without allocating a raster surface. */ getContext:()=>context})};
 const host={scene:new T.Scene(),time:0,route:'ring',assets:{grass:new T.Texture(),trees:[new T.Texture(),new T.Texture(),new T.Texture()]},renderer:{/** Expose the minimal WebGL-context shape queried by landscape setup. */ getContext:()=>({/** Report an antialiased context without constructing a renderer. */ getContextAttributes:()=>({antialias:true})})}};
 try{buildScenicLandscape(host,roadBend);}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
 return host;
}

