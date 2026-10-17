import * as T from '../public/vendor/three.js';
import { buildScenicLandscape } from '../src/landscape.js';
import { roadBend } from '../src/world.js';

export function landscapeFixture(){
 const old=globalThis.document;
 const gradient={addColorStop(){}};
 const context=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,measureText:text=>({width:text.length*12})},{get:(o,k)=>k in o?o[k]:()=>{}});
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>context})};
 const host={scene:new T.Scene(),time:0,route:'ring',assets:{grass:new T.Texture(),trees:[new T.Texture(),new T.Texture(),new T.Texture()]},renderer:{getContext:()=>({getContextAttributes:()=>({antialias:true})})}};
 try{buildScenicLandscape(host,roadBend);}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
 return host;
}

