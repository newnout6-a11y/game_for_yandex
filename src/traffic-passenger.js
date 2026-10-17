import * as T from '../public/vendor/three.js';
import { trafficDefinition } from './traffic-catalog.js';
import {
  trim, glass, chrome, rubber, headlights, plate, basePaint, baseBrake,
  mix, profileAt, geometry, surface, box, mergeParts,
} from './traffic-model-kit.js';

// Original, separately proportioned production-car archetypes. The sill/deck
// and the greenhouse are continuous curved skins, not intersecting cuboids.
const PROPORTIONS = Object.freeze({
  sedan: {
    bodyWidth: 1.78, sill: .255, belt: .925, frontWheel: -1.43, rearWheel: 1.39,
    cabinFront: -1.13, roofFront: -.53, roofRear: .70, cabinRear: 1.43,
    cabinBase: .92, cabinWidth: 1.64, roofWidth: 1.26, wheelWidth: .225,
    wheelStyle: 'split-five', spoiler: false,
  },
  hatch: {
    bodyWidth: 1.70, sill: .27, belt: .965, frontWheel: -1.28, rearWheel: 1.22,
    cabinFront: -.98, roofFront: -.46, roofRear: 1.03, cabinRear: 1.86,
    cabinBase: .95, cabinWidth: 1.60, roofWidth: 1.27, wheelWidth: .215,
    wheelStyle: 'four-spoke', spoiler: true,
  },
  suv: {
    bodyWidth: 1.88, sill: .37, belt: 1.115, frontWheel: -1.51, rearWheel: 1.49,
    cabinFront: -1.14, roofFront: -.60, roofRear: 1.49, cabinRear: 2.22,
    cabinBase: 1.105, cabinWidth: 1.79, roofWidth: 1.47, wheelWidth: .26,
    wheelStyle: 'six-spoke', spoiler: true,
  },
  van: {
    bodyWidth: 2.01, sill: .35, belt: 1.245, frontWheel: -1.83, rearWheel: 1.74,
    cabinFront: -2.10, roofFront: -1.34, roofRear: 2.61, cabinRear: 2.775,
    cabinBase: 1.19, cabinWidth: 1.98, roofWidth: 1.79, wheelWidth: .245,
    wheelStyle: 'steel', spoiler: false,
  },
});

function addMesh(group, material, shape) {
  const mesh = new T.Mesh(shape, material);
  group.add(mesh);
  return mesh;
}

function ellipsoid(group,material,size,position) {
  const mesh=addMesh(group,material,new T.SphereGeometry(1,8,4));
  mesh.scale.set(...size);mesh.position.set(...position);return mesh;
}

// Twelve perimeter vertices preserve rounded lamp corners without paying for
// a general-purpose extruder (dozens of panels are visible on every vehicle).
function panel(group,material,width,height,depth,position,radius=.025) {
  const w=width*.5,h=height*.5,r=Math.min(radius,w*.45,h*.45),outline=[];
  for(const [cx,cy,start] of [[w-r,h-r,0],[-w+r,h-r,Math.PI*.5],[-w+r,-h+r,Math.PI],[w-r,-h+r,Math.PI*1.5]]) {
    for(let i=0;i<3;i++){const a=start+i*Math.PI/4;outline.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}
  }
  const positions=[],indices=[],n=outline.length;
  for(const z of [0,depth])for(const [x,y]of outline)positions.push(x,y,z);
  for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,i+n,j,j+n,i+n);}
  for(const [z,reverse]of [[0,true],[depth,false]]){
    const offset=positions.length/3;for(const[x,y]of outline)positions.push(x,y,z);
    for(let i=1;i<n-1;i++)indices.push(offset,offset+(reverse?i+1:i),offset+(reverse?i:i+1));
  }
  const mesh=addMesh(group,material,geometry(positions,indices));mesh.position.set(...position);return mesh;
}

function cubic(a, b, c, d, t) {
  const s = 1 - t;
  return [s*s*s*a[0] + 3*s*s*t*b[0] + 3*s*t*t*c[0] + t*t*t*d[0],
    s*s*s*a[1] + 3*s*s*t*b[1] + 3*s*t*t*c[1] + t*t*t*d[1]];
}

function bodyShell(sections,spec,sill) {
  const positions=[],indices=[],l=spec.length*.5,radius=spec.wheel*1.10,wheelY=spec.wheel+.015;
  const stations=new Set(Array.from({length:31},(_,i)=>-l+spec.length*i/30));
  // Exact arch tangencies and denser circular samples avoid a polygonal hole
  // behind the smoother Blender-authored tire, without subdividing the car.
  for(const z of [spec.frontWheel,spec.rearWheel])for(let i=0;i<=16;i++)stations.add(z+Math.cos(Math.PI*i/16)*radius);
  stations.add(spec.cabinFront+.045);stations.add(spec.cabinRear-.075);
  const rings=[...stations].sort((a,b)=>a-b);let count=0;
  for(const z of rings){
    const [width,bottom,shoulder,top]=profileAt(sections,z),w=width*.5;let lower=bottom;
    for(const axle of [spec.frontWheel,spec.rearWheel]){const dz=z-axle;if(Math.abs(dz)<radius)lower=Math.max(lower,wheelY+Math.sqrt(radius*radius-dz*dz));}
    const sideTop=Math.max(shoulder,lower+.055),right=[];
    for(let i=0;i<=5;i++){const a=Math.PI*i/10;right.push([w*Math.sin(a)**.7,sideTop+(top-sideTop)*Math.cos(a)**.8]);}
    for(let i=1;i<=2;i++){const t=i/2;right.push([w*(1+.008*Math.sin(t*Math.PI)),mix(sideTop,lower+.035,t)]);}
    right.push([w*.975,lower],[w*.72,Math.max(sill,lower-.10)],[w*.57,sill],[0,sill]);
    const ring=[...right,...right.slice(1,-1).reverse().map(([x,y])=>[-x,y])];count=ring.length;
    for(const [x,y]of ring)positions.push(x,y,z);
  }
  for(let row=0;row<rings.length-1;row++)for(let i=0;i<count;i++){
    // The passenger compartment is a real opening, not a painted shelf below
    // transparent windows. Keep the shoulder/doors and the structural floor.
    const inCabin=rings[row]>=spec.cabinFront+.044 && rings[row+1]<=spec.cabinRear-.074;
    if(inCabin && (i<3 || i>=count-3))continue;
    const a=row*count+i,b=row*count+(i+1)%count,c=b+count,d=a+count;indices.push(a,d,b,b,d,c);
  }
  for(const [row,reverse]of [[0,false],[rings.length-1,true]]){
    const start=positions.length/3;
    for(let i=0;i<count;i++)positions.push(...positions.slice((row*count+i)*3,(row*count+i+1)*3));
    for(let i=1;i<count-1;i++)indices.push(start,start+(reverse?i+1:i),start+(reverse?i:i+1));
  }
  return geometry(positions,indices);
}

// A crowned roof, rounded cantrail, and near-planar convex door glass. Unlike
// a sphere stretched into a cabin, the roof and side have distinct radii.
function greenhouse(rows, p) {
  return (u, z) => {
    const [height, widthScale = 1] = profileAt(rows, z);
    const t = Math.abs(u), w = p.cabinWidth * .5 * widthScale;
    const edge = p.roofWidth * .5 * widthScale;
    const crown = Math.min(.048, (height - p.cabinBase) * .12);
    const y = height - crown;
    const q = t <= .64
      ? cubic([0, height], [edge*.36, height], [edge*.80, height-.006], [edge, y], t/.64)
      : cubic([edge, y], [mix(edge, w, .56), y-(height-p.cabinBase)*.14],
        [w*.998, p.cabinBase+(height-p.cabinBase)*.18], [w, p.cabinBase], (t-.64)/.36);
    return [Math.sign(u)*q[0], q[1], z];
  };
}

function bodyProfiles(kind, l, p) {
  const w = p.bodyWidth, s = p.sill, b = p.belt;
  if (kind === 'sedan') return [
    [-l, w*.84, s+.075, .65, .79], [-l+.14, w*.96, s+.025, .77, .86],
    [-1.68, w*.995, s, .84, .91], [-1.08, w, s, .90, .965],
    [-.10, w, s, b, b+.045], [.95, w, s, b, b+.045],
    [1.47, w*.995, s, .91, .98], [1.95, w*.97, s+.025, .87, .945],
    [l, w*.86, s+.07, .72, .875],
  ];
  if (kind === 'hatch') return [
    [-l, w*.80, s+.075, .69, .80], [-l+.15, w*.95, s+.025, .80, .875],
    [-1.42, w, s, .87, .93], [-.93, w, s, .94, 1.005],
    [.45, w, s, b, b+.055], [1.25, w*.997, s, b, b+.05],
    [1.78, w*.97, s+.025, .97, 1.055], [l, w*.85, s+.07, .99, 1.06],
  ];
  if (kind === 'suv') return [
    [-l, w*.86, s+.055, .84, 1.00], [-l+.18, w*.965, s+.02, .98, 1.08],
    [-1.65, w, s, 1.055, 1.16], [-1.05, w, s, b, b+.065],
    [.85, w, s, b, b+.065], [1.82, w*.995, s, 1.09, 1.18],
    [l-.13, w*.955, s+.015, 1.00, 1.135], [l, w*.88, s+.055, .91, 1.08],
  ];
  return [
    [-l, w*.85, s+.07, .89, 1.07], [-l+.12, w*.95, s+.03, 1.02, 1.16],
    [-2.40, w*.98, s, 1.13, 1.27], [-2.08, w*.99, s, 1.20, 1.34],
    [-1.35, w, s, b, b+.025], [1.93, w, s, b, b+.025],
    [l-.12, w*.99, s+.01, 1.20, 1.27], [l, w*.96, s+.05, 1.15, 1.23],
  ];
}

function roofProfiles(kind, p, h) {
  if (kind === 'van') return [
    [p.cabinFront, p.cabinBase+.035, .92], [-1.86, 1.63, .97],
    [-1.46, h-.12, 1], [-1.19, h-.035, 1],
    [2.48, h-.035, 1], [2.67, h-.065, .995], [p.cabinRear, h-.17, .965],
  ];
  return [
    [p.cabinFront, p.cabinBase+.025, .99],
    [p.roofFront-.13, h-.10, 1], [p.roofFront+.13, h-(kind === 'suv' ? .085 : 0), 1],
    [p.roofRear-.12, h-(kind === 'suv' ? .085 : .008), 1],
    [p.roofRear+.10, h-(kind === 'suv' ? .135 : .065), .99],
    [p.cabinRear, p.cabinBase+.045, kind === 'sedan' ? .90 : .98],
  ];
}

function windowLayout(kind) {
  if(kind==='sedan')return [[-.94,-.45,.08,.08],[.18,.18,1.16,.64]];
  if(kind==='hatch')return [[-.80,-.36,-.02,-.02],[.08,.08,1.32,.91]];
  if(kind==='suv')return [[-.95,-.49,.09,.09],[.20,.20,1.18,1.18],[1.29,1.29,1.90,1.33]];
  return [[-1.93,-1.29,-.61,-.61]];
}

// Subtract the exact pane outlines from the roof parameter domain. Merely
// floating a window over a differently tessellated curved roof creates white
// triangles through the glass. Real apertures remove the conflicting surface.
function glazedCabinGeometry(skin,p,kind) {
  const holes=[];
  const rectangle=(u0,u1,z0,z1)=>[[u0,z0],[u1,z0],[u1,z1],[u0,z1]];
  const frontWidth=kind==='van'?.78:.79;
  holes.push(rectangle(-frontWidth+.012,frontWidth-.012,p.cabinFront+.085,p.roofFront-.025));
  if(kind!=='van'){
    const rearWidth=kind==='sedan'?.76:.81;
    holes.push(rectangle(-rearWidth+.012,rearWidth-.012,p.roofRear+.10,p.cabinRear-.08));
  }
  for(const side of [-1,1])for(const [bottomStart,topStart,bottomEnd,topEnd]of windowLayout(kind)){
    const low=.689,high=.981;
    const start=s=>mix(topStart,bottomStart,(s-.685)/.30)+.007;
    const end=s=>mix(topEnd,bottomEnd,(s-.685)/.30)-.007;
    const polygon=[[side*low,start(low)],[side*high,start(high)],[side*high,end(high)],[side*low,end(low)]];
    if(side<0)polygon.reverse();holes.push(polygon);
  }
  const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  function halfPlane(polygon,a,b,inside){
    const result=[];
    for(let i=0;i<polygon.length;i++){
      const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=cross(a,b,p),dq=cross(a,b,q);
      const keepP=inside?dp>=-1e-9:dp<=1e-9,keepQ=inside?dq>=-1e-9:dq<=1e-9;
      if(keepP)result.push(p);
      if(keepP!==keepQ){const t=dp/(dp-dq);result.push([mix(p[0],q[0],t),mix(p[1],q[1],t)]);}
    }
    return result;
  }
  function subtract(polygon,hole){
    const outside=[];let rest=polygon;
    for(let i=0;i<hole.length&&rest.length>=3;i++){
      const a=hole[i],b=hole[(i+1)%hole.length],piece=halfPlane(rest,a,b,false);
      if(piece.length>=3)outside.push(piece);
      rest=halfPlane(rest,a,b,true);
    }
    return outside;
  }
  const positions=[],normals=[],indices=[],vertices=new Map();
  function vertex(uv){
    const key=uv.map(n=>n.toFixed(7)).join(',');
    if(vertices.has(key))return vertices.get(key);
    const [u,z]=uv,index=positions.length/3;positions.push(...skin(u,z));
    const a=new T.Vector3(...skin(Math.min(1,u+.0001),z)).sub(new T.Vector3(...skin(Math.max(-1,u-.0001),z)));
    const b=new T.Vector3(...skin(u,z+.0001)).sub(new T.Vector3(...skin(u,z-.0001)));
    normals.push(...b.cross(a).normalize().toArray());vertices.set(key,index);return index;
  }
  for(let j=0;j<24;j++)for(let i=0;i<20;i++){
    const u0=-1+i/10,u1=-1+(i+1)/10,z0=mix(p.cabinFront,p.cabinRear,j/24),z1=mix(p.cabinFront,p.cabinRear,(j+1)/24);
    let polygons=[[[u0,z0],[u1,z0],[u1,z1],[u0,z1]]];
    for(const hole of holes)polygons=polygons.flatMap(poly=>subtract(poly,hole));
    for(const poly of polygons)for(let k=1;k<poly.length-1;k++){
      if(Math.abs(cross(poly[0],poly[k],poly[k+1]))<1e-10)continue;
      indices.push(vertex(poly[0]),vertex(poly[k+1]),vertex(poly[k]));
    }
  }
  const shape=new T.BufferGeometry();
  shape.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  shape.setAttribute('normal',new T.Float32BufferAttribute(normals,3));shape.setIndex(indices);return shape;
}

function roofPatch(group, material, skin, u0, u1, z0, z1, depth=.007, columns=8, rows=4) {
  return addMesh(group, material, surface((u,v) => skin(mix(u0,u1,u), mix(z0,z1,v)), columns, rows, depth));
}

function sideWindow(group, skin, side, bottomStart, topStart, bottomEnd, topEnd) {
  const point = (border,u,v) => {
    const s = mix(side > 0 ? .685+border : .985-border, side > 0 ? .985-border : .685+border, u);
    const t = (s-.685)/.30;
    const z0 = mix(topStart, bottomStart, t) + border*.50;
    const z1 = mix(topEnd, bottomEnd, t) - border*.50;
    return skin(side*s, mix(z0,z1,v));
  };
  // A seal is a border, not an opaque sheet underneath differently tessellated
  // glass. The latter can cut through a steep window between sampled vertices.
  for(const [u0,u1,v0,v1,columns,rows]of [[0,.075,0,1,1,6],[.925,1,0,1,1,6],[.075,.925,0,.025,4,1],[.075,.925,.975,1,4,1]])
    addMesh(group,trim,surface((u,v)=>point(0,mix(u0,u1,u),mix(v0,v1,v)),columns,rows,.012));
  addMesh(group,glass,surface((u,v)=>point(.018,u,v),3,4,.023));
}

function screen(group, skin, front, from, to, width=.78) {
  roofPatch(group,trim,skin,-width,-width+.045,from,to,.012,1,6);
  roofPatch(group,trim,skin,width-.045,width,from,to,.012,1,6);
  roofPatch(group,trim,skin,-width+.045,width-.045,from,from+.035,.012,8,1);
  roofPatch(group,trim,skin,-width+.045,width-.045,to-.035,to,.012,8,1);
  roofPatch(group, glass, skin, -width+.035, width-.035, from+.025, to-.025, .024);
  // A single dark wiper is legible without translucent interior geometry.
  const z = front ? from+.08 : to-.09;
  addMesh(group, trim, surface((u,v) => skin(mix(-.40,.30,u), z+v*.018), 7, 1, .017));
}

function seam(group, side, points, xAt, thickness=.009, material=trim, offset=.006) {
  const vertices = [], indices = [];
  for (let i=0; i<points.length; i++) {
    const [z,y] = points[i], before=points[Math.max(0,i-1)], after=points[Math.min(points.length-1,i+1)];
    const dz=after[0]-before[0], dy=after[1]-before[1], d=Math.hypot(dz,dy)||1;
    for (const sign of [-1,1]) {
      const zz=z-sign*dy/d*thickness*.5, yy=y+sign*dz/d*thickness*.5;
      vertices.push(side*(xAt(zz,yy)+offset), yy, zz);
    }
    if(i) { const a=(i-1)*2,b=i*2; indices.push(a,a+1,b,b,a+1,b+1); }
  }
  const shape=geometry(vertices,indices);
  // Both left and right are regular surfaces, not double-sided materials.
  if(side<0) { const a=shape.index.array; for(let i=0;i<a.length;i+=3) [a[i+1],a[i+2]]=[a[i+2],a[i+1]]; shape.computeVertexNormals(); }
  return addMesh(group,material,shape);
}

function roundedOutline(z0, z1, y0, y1, r=.06) {
  return [[z0+r,y0],[z1-r,y0],[z1,y0+r],[z1,y1-r],[z1-r,y1],
    [z0+r,y1],[z0,y1-r],[z0,y0+r],[z0+r,y0]];
}

function sideHandle(group, side, x, y, z, length=.19, dark=false) {
  const recess=ellipsoid(group,trim,[.012,.027,length*.61],[side*x,y,z]);
  recess.name='door_handle_recess';
  ellipsoid(group,dark?trim:chrome,[.019,.014,length*.45],[side*(x+.01),y+.006,z]);
}

function arch(group, sections, p, radius, side, wheelZ, wide) {
  const r=radius*1.10,y=radius+.015,start=Math.asin((p.sill-y)/r);
  const band=wide?.067:.028;
  addMesh(group,wide?trim:basePaint,surface((u,v)=>{
    const a=mix(start,Math.PI-start,side>0?v:1-v),rr=r+u*band,z=wheelZ+Math.cos(a)*rr;
    return [side*(profileAt(sections,z)[0]/2+.006+Math.sin(u*Math.PI)*.019),y+Math.sin(a)*rr,z];
  },3,24));
  // A short inward return gives the cut sheet metal believable thickness and
  // a shadowed wheel well; it never rotates with the tire.
  addMesh(group,trim,surface((u,v)=>{
    const a=mix(start,Math.PI-start,side>0?1-v:v),z=wheelZ+Math.cos(a)*r;
    return [side*(profileAt(sections,z)[0]/2+.005-u*.065),y+Math.sin(a)*r,z];
  },1,24));
  // Inner liner sits behind the wheel. The outside sheet metal has a true
  // semicircular opening; no black decal is painted over a solid body side.
  const well=new T.Mesh(new T.CircleGeometry(r,20,start,Math.PI-2*start),trim);
  well.rotation.y=side*Math.PI/2;
  well.position.set(side*(p.bodyWidth/2-p.wheelWidth*.72),y,wheelZ);
  group.add(well);
}

function buildWheel(radius,width,style) {
  const parts=new T.Group();
  const profile=[[.64,-.49],[.83,-.51],[.95,-.43],[1,-.25],[1,.25],[.95,.43],[.83,.51],[.64,.49],[.64,-.49]];
  const tire=new T.Mesh(new T.LatheGeometry(profile.map(([r,x])=>new T.Vector2(r*radius,x*width)),18),rubber);
  tire.rotation.z=Math.PI/2;parts.add(tire);
  const disc=new T.Mesh(new T.CylinderGeometry(radius*.68,radius*.68,width*.91,16),trim);
  disc.rotation.z=Math.PI/2;parts.add(disc);
  // Only the outward hub needs decorative metal. The opposite side faces the
  // chassis and keeps its brake disc; left wheels mirror this completed pivot.
  for(const side of [1]) {
    const ring=new T.Mesh(new T.RingGeometry(radius*.57,radius*.70,20),chrome);
    ring.rotation.y=side*Math.PI/2;ring.position.x=side*width*.512;parts.add(ring);
    const hub=new T.Mesh(new T.CylinderGeometry(radius*(style==='steel'?.28:.18),radius*(style==='steel'?.28:.18),.026,10),chrome);
    hub.rotation.z=Math.PI/2;hub.position.x=side*width*.51;parts.add(hub);
    const count=style==='four-spoke'?4:style==='six-spoke'?6:style==='steel'?8:5;
    for(let i=0;i<count;i++) {
      const a=i*Math.PI*2/count;
      if(style==='steel') {
        // Broad stamped steel webs and eight dark ventilation openings.
        const spoke=box(parts,chrome,[.021,radius*.42,radius*.19],[side*width*.50,Math.cos(a)*radius*.41,Math.sin(a)*radius*.41]);
        spoke.rotation.x=a;
      } else for(const delta of style==='split-five'?[-.095,.095]:[0]) {
        const angle=a+delta;
        const spoke=box(parts,chrome,[.023,radius*.49,radius*(style==='four-spoke'?.15:.085)],[side*width*.51,Math.cos(angle)*radius*.38,Math.sin(angle)*radius*.38]);
        spoke.rotation.x=angle+.12;
      }
    }
  }
  const result=mergeParts(parts);
  result.userData.style=style;
  return result;
}

function mirrors(group,p,side,isVan) {
  const x=p.bodyWidth/2, z=isVan?-1.73:p.cabinFront+.30, y=p.cabinBase+(isVan?.32:.14);
  box(group,trim,[.065,.028,.060],[side*(x-.014),y-.035,z-.035]);
  // Editable shaped housings, rubber bezels and inset reflective panes are
  // authored in Blender, separate from the transparent cabin glazing.
}

function bumper(group,p,l,isVan,isSUV) {
  const w=p.bodyWidth, y=p.sill+.10;
  // Rolled bumper skins follow the front and back width, rather than bars.
  for(const end of [-1,1]) {
    const shape=surface((u,v)=>{
      const x=mix(-w*.42,w*.42,end>0?1-u:u),t=Math.abs(x)/(w*.42);
      return [x,y+v*(isVan?.20:.115),end*(l-.004-.010*t**4)];
    },14,3);
    addMesh(group,trim,shape);
  }
  if(isSUV) {
    panel(group,chrome,w*.50,.07,.015,[0,y+.045,l-.018],.025);
    panel(group,chrome,w*.50,.07,.015,[0,y+.045,-l+.008],.025);
  }
}

function lamps(group,kind,p,l) {
  const w=p.bodyWidth;
  if(kind==='van') {
    for(const side of [-1,1]) {
      const head=panel(group,headlights,.35,.11,.018,[side*w*.29,.925,-l+.012],.035);
      head.rotation.z=side*-.11;
      panel(group,trim,.145,.64,.022,[side*w*.43,1.21,l-.034],.035);
      panel(group,baseBrake,.115,.46,.026,[side*w*.43,1.30,l-.026],.025);
      panel(group,headlights,.10,.11,.028,[side*w*.43,1.015,l-.027],.015);
    }
    panel(group,baseBrake,.36,.035,.018,[0,2.38,l-.042],.015);
    return;
  }
  for(const side of [-1,1]) {
    const headY=kind==='suv'?.86:kind==='hatch'?.685:.675;
    const head=panel(group,trim,w*.245,.105,.014,[side*w*.27,headY,-l+.019],.025);
    head.rotation.z=side*-.05;
    const lens=panel(group,headlights,w*.22,.068,.016,[side*w*.27,headY+.008,-l+.014],.021);
    lens.rotation.z=side*-.05;
    const y=kind==='suv'?.925:kind==='hatch'?.81:.72;
    if(kind==='hatch') {
      // Upright C-shaped clusters beside the hatch, not sedan-style strips.
      panel(group,baseBrake,.14,.34,.024,[side*w*.385,y+.015,l-.026],.035);
      panel(group,baseBrake,.31,.085,.022,[side*w*.32,y-.10,l-.026],.025);
      panel(group,headlights,.11,.065,.026,[side*w*.385,y-.015,l-.025],.012);
    } else {
      panel(group,trim,w*.265,.12,.023,[side*w*.278,y,l-.034],.025);
      panel(group,baseBrake,w*.245,.085,.025,[side*w*.278,y+.01,l-.025],.022);
      panel(group,headlights,w*.11,.025,.027,[side*w*.265,y-.009,l-.022],.008);
      // A short wraparound red facet is visible in side/rear three-quarter view.
      const profiles=bodyProfiles(kind,l-.018,p);
      addMesh(group,baseBrake,surface((u,v)=>{
        const z=mix(l-.45,l-.17,side>0?u:1-u);
        return [side*(profileAt(profiles,z)[0]*.5+.008),y-.022+v*.078,z];
      },5,1));
    }
  }
}

function frontDetail(group,kind,p,l) {
  const van=kind==='van', suv=kind==='suv', w=p.bodyWidth;
  const grillY=van?.91:suv?.87:.61;
  panel(group,trim,w*(van?.48:.45),van?.22:suv?.20:.14,.024,[0,grillY,-l+.010],.035);
  for(let i=0;i<(van?3:2);i++) panel(group,chrome,w*.39,.012,.012,[0,grillY-.045+i*.048,-l+.008],.003);
  panel(group,plate,.36,.085,.013,[0,p.sill+.14,-l+.002],.008);
  if(kind==='sedan') {
    // Hood shut line follows the long bonnet shoulders.
    for(const side of [-1,1]) addMesh(group,trim,surface((u,v)=>{
      const z=mix(-1.98,-1.12,v),x=side*mix(.59,.65,v);
      return [x+u*.007,.902+(z+1.98)*.065,z];
    },1,6));
  }
}

function rearDetail(group,kind,p,l,skin) {
  const isVan=kind==='van', w=p.bodyWidth;
  panel(group,trim,.51,.155,.020,[0,isVan?.83:kind==='sedan'?.59:.68,l-.025],.025);
  panel(group,plate,.43,.108,.022,[0,isVan?.83:kind==='sedan'?.59:.68,l-.023],.012);
  if(isVan) {
    // Double cargo doors have a recessed center seam, hinges, stamped panels,
    // a low step and solid sheet metal, unmistakably not a passenger wagon.
    const rearZ=p.cabinRear+.005;
    panel(group,trim,.012,1.88,.010,[0,1.44,rearZ],.003);
    for(const side of [-1,1]) {
      for(const yy of [.68,1.91]) panel(group,chrome,.075,.065,.025,[side*w*.42,yy,rearZ-.012],.008);
      const shape=roundedOutline(side<0?-w*.38:.12,side<0?-.12:w*.38,1.25,2.25,.07);
      const pos=[],ind=[];
      for(let i=0;i<shape.length;i++) {
        const [x,y]=shape[i],a=shape[Math.max(0,i-1)],b=shape[Math.min(shape.length-1,i+1)];
        const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
        for(const edge of [-1,1]) pos.push(x-edge*dy/len*.004,y+edge*dx/len*.004,rearZ+.007);
        if(i){const j=i*2;ind.push(j-2,j,j-1,j-1,j,j+1);}
      }
      addMesh(group,trim,geometry(pos,ind));
      panel(group,trim,.07,.16,.023,[side*.10,1.04,rearZ+.006],.018);
    }
    return;
  }
  if(kind==='sedan') {
    // Trunk cut line and understated lip preserve the three-box silhouette.
    addMesh(group,trim,surface((u,v)=>{
      const x=mix(-.64,.64,u);
      return [x,.925+v*.008,l-.28-.035*(x/.64)**2];
    },12,1));
    panel(group,chrome,.40,.018,.018,[0,.82,l-.023],.006);
  } else {
    // Rear window and liftgate remain separate masses under a painted spoiler.
    const z=p.roofRear+.11, q=skin(0,z);
    const lip=panel(group,basePaint,p.roofWidth*.98,.055,.15,[0,q[1]+.008,z-.035],.025);
    lip.rotation.x=-.05;
    roofPatch(group,baseBrake,skin,-.25,.25,z+.01,z+.045,.024,6,1);
    panel(group,chrome,.36,.018,.018,[0,kind==='suv'?1.025:.88,l-.023],.006);
  }
  // Lower bumper reflectors and a dark exhaust tip stay small at road scale.
  for(const side of [-1,1]) panel(group,baseBrake,.17,.035,.016,[side*w*.35,p.sill+.075,l-.036],.012);
}

function doors(group,kind,p,skin,sections) {
  const bodyX=(z)=>profileAt(sections,z)[0]*.5;
  const xAt=(z,y)=>{
    if(y<=p.cabinBase || z<p.cabinFront || z>p.cabinRear) return bodyX(z);
    let lo=.64,hi=1;
    for(let i=0;i<9;i++){const mid=(lo+hi)*.5;if(skin(mid,z)[1]>y)lo=mid;else hi=mid;}
    return skin((lo+hi)*.5,z)[0];
  };
  for(const side of [-1,1]) {
    if(kind==='van') {
      seam(group,side,[[-2.04,1.19],[-2.04,.86],[-1.83,.88],[-1.52,.77],[-1.34,.50],[-.64,.48],[-.57,1.20],[-.58,2.28]],xAt,.009);
      seam(group,side,roundedOutline(-.47,1.25,.45,2.26,.075),xAt,.011);
      seam(group,side,roundedOutline(-.32,1.08,1.34,2.12,.08),xAt,.006,basePaint,.016);
      seam(group,side,roundedOutline(1.42,2.52,1.32,2.12,.08),xAt,.006,basePaint,.014);
      // Sliding track, sill step, and black recessed handles identify a cargo van.
      seam(group,side,[[.05,1.30],[2.51,1.30]],xAt,.034,trim,.013);
      sideHandle(group,side,xAt(-.76,1.16),1.16,-.76,.17,true);
      sideHandle(group,side,xAt(-.27,1.13),1.13,-.27,.19,true);
      box(group,trim,[.055,.065,.96],[side*(p.bodyWidth*.495),.39,-.89]);
      // Horizontal swage creases are raised paint, not random black stripes.
      seam(group,side,[[-.38,.88],[1.01,.88],[1.36,.91],[2.58,.91]],xAt,.018,basePaint,.011);
    } else {
      const post=kind==='sedan'?.12:kind==='hatch'?.02:.14;
      seam(group,side,[[p.cabinFront+.19,p.belt],[-.81,.55],[-.62,p.sill+.14],[post-.025,p.sill+.14],[post,p.belt+.012]],xAt,.008);
      const rear=kind==='sedan'?1.04:kind==='hatch'?1.03:1.22;
      seam(group,side,[[post,p.sill+.14],[rear-.24,p.sill+.14],[rear,.71],[rear+.05,p.belt+.02]],xAt,.008);
      // Shoulder pressing, bright window sill, and lower rocker catch sunlight.
      seam(group,side,[[p.cabinFront+.08,p.belt-.04],[.35,p.belt-.025],[1.58,p.belt-.05]],xAt,.013,basePaint,.012);
      seam(group,side,[[p.cabinFront+.12,p.cabinBase+.004],[kind==='sedan'?1.10:kind==='hatch'?1.51:1.79,p.cabinBase+.004]],xAt,.013,chrome,.008);
      sideHandle(group,side,bodyX(post-.18),p.belt-.09,post-.18,.18);
      sideHandle(group,side,bodyX(rear-.06),p.belt-.09,rear-.06,kind==='hatch'?.12:.17,kind==='hatch');
      box(group,trim,[.028,kind==='suv'?.12:.046,kind==='suv'?2.03:1.63],[side*p.bodyWidth*.494,p.sill+.038,.01]);
    }
    mirrors(group,p,side,kind==='van');
  }
}

function roofRails(group,p,height) {
  for(const side of [-1,1]) {
    const points=[new T.Vector3(side*.64,height-.095,-.48),new T.Vector3(side*.64,height-.043,-.20),
      new T.Vector3(side*.64,height-.043,1.10),new T.Vector3(side*.64,height-.095,1.42)];
    addMesh(group,chrome,new T.TubeGeometry(new T.CatmullRomCurve3(points),12,.021,5,false));
    for(const z of [-.40,1.33])box(group,trim,[.078,.048,.15],[side*.64,height-.088,z]);
  }
}

export function buildPassengerVehicle(kind, definition=trafficDefinition(kind)) {
  if(!Object.hasOwn(PROPORTIONS,kind)) throw new Error(`Unsupported passenger vehicle: ${kind}`);
  const p=PROPORTIONS[kind], g=new T.Group(), l=definition.length/2;
  const sections=bodyProfiles(kind,l-.018,p);
  const shellSpec={length:definition.length-.036,width:p.bodyWidth,wheel:definition.wheelRadius,frontWheel:p.frontWheel,rearWheel:p.rearWheel,cabinFront:p.cabinFront,cabinRear:p.cabinRear};
  addMesh(g,basePaint,bodyShell(sections,shellSpec,p.sill));
  const roofRows=roofProfiles(kind,p,definition.height),skin=greenhouse(roofRows,p);
  addMesh(g,basePaint,glazedCabinGeometry(skin,p,kind));
  {
    addMesh(g,basePaint,surface((u,v)=>{
      const q=skin(mix(-1,1,u),p.cabinRear);
      return [q[0],mix(q[1],p.cabinBase-.10,v),p.cabinRear];
    },18,4));
  }
  screen(g,skin,true,p.cabinFront+.075,p.roofFront-.015,kind==='van'?.78:.79);
  if(kind!=='van')screen(g,skin,false,p.roofRear+.09,p.cabinRear-.07,kind==='sedan'?.76:.81);
  for(const side of [-1,1]) {
    for(const layout of windowLayout(kind))sideWindow(g,skin,side,...layout);
    for(const z of [p.frontWheel,p.rearWheel])arch(g,sections,p,definition.wheelRadius,side,z,kind==='suv');
  }
  bumper(g,p,l,kind==='van',kind==='suv');
  lamps(g,kind,p,l);frontDetail(g,kind,p,l);rearDetail(g,kind,p,l,skin);doors(g,kind,p,skin,sections);
  if(kind==='suv')roofRails(g,p,definition.height);
  const result=mergeParts(g),wheel=buildWheel(definition.wheelRadius,p.wheelWidth,p.wheelStyle);
  for(const [name,side,z] of [['wheel_fl',-1,p.frontWheel],['wheel_fr',1,p.frontWheel],['wheel_rl',-1,p.rearWheel],['wheel_rr',1,p.rearWheel]]) {
    const pivot=wheel.clone(true);pivot.name=name;
    pivot.scale.x=side;
    pivot.position.set(side*(p.bodyWidth/2-p.wheelWidth*.43),definition.wheelRadius+.015,z);
    result.add(pivot);
  }
  result.userData.kind=kind;
  result.userData.length=definition.length;
  result.userData.wheelRadius=definition.wheelRadius;
  result.userData.design={archetype:kind,body:'curved-wheelarch-shell',wheels:p.wheelStyle};
  return result;
}
