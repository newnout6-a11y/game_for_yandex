import * as T from '../public/vendor/three.js';

const trim = new T.MeshStandardMaterial({ color: '#171d22', roughness: .68 });
const glass = new T.MeshPhysicalMaterial({ color: '#293f4d', metalness: .45, roughness: .18, clearcoat: 1, side: T.DoubleSide });
const chrome = new T.MeshStandardMaterial({ color: '#a0a9ae', metalness: .9, roughness: .3 });
const rubber = new T.MeshStandardMaterial({ color: '#121416', roughness: .92 });
const headlights = new T.MeshStandardMaterial({ color: '#e8f5f1', emissive: '#c5e3de', emissiveIntensity: .45, roughness: .18 });
const plate = new T.MeshStandardMaterial({ color: '#d8dad5', roughness: .7 });
const basePaint = new T.MeshPhysicalMaterial({ color: '#8696a3', metalness: .55, roughness: .28, clearcoat: .8 });
const baseBrake = new T.MeshStandardMaterial({ color: '#922a22', emissive: '#f53126', emissiveIntensity: .25, roughness: .25 });
const mix = T.MathUtils.lerp;

// Interpolate the silhouette itself, not just the lighting normals of a box.
// Clamping the cubic to each pair of stations prevents overshooting bumpers.
/**
 * Interpolate ordered vehicle cross-sections with a clamped cubic Hermite profile.
 * Each component is bounded by its adjacent station values so curved silhouettes cannot
 * overshoot bumper widths/heights. The input must have at least two distinct ascending Zs.
 * @param {number[][]} sections - Rows [z, ...profileValues], with positions and dimensions in metres.
 * @param {number} z - Longitudinal sample coordinate in metres; negative Z is the vehicle front.
 * @returns {number[]} Fresh interpolated profile values, excluding the station Z.
 */
function profileAt(sections, z) {
  let i = 0;
  while (i < sections.length - 2 && z > sections[i + 1][0]) i++;
  const a = sections[i], b = sections[i + 1], before = sections[Math.max(0, i - 1)], after = sections[Math.min(sections.length - 1, i + 2)];
  const d = b[0] - a[0], t = T.MathUtils.clamp((z - a[0]) / d, 0, 1), t2 = t * t, t3 = t2 * t;
  return a.slice(1).map((value, k) => {
    const n = k + 1;
    const m0 = (b[n] - before[n]) / (b[0] - before[0]) * d;
    const m1 = (after[n] - a[n]) / (after[0] - a[0]) * d;
    return T.MathUtils.clamp((2*t3-3*t2+1)*value + (t3-2*t2+t)*m0 + (-2*t3+3*t2)*b[n] + (t3-t2)*m1, Math.min(value,b[n]), Math.max(value,b[n]));
  });
}
/**
 * Build indexed model geometry and derive smooth normals from the supplied topology.
 * @param {number[]} positions - Flat local-space XYZ coordinates in metres.
 * @param {number[]} indices - Triangle vertex indices with the intended outward winding.
 * @returns {T.BufferGeometry} New owned geometry; inputs are copied into buffer attributes.
 */
function geometry(positions, indices) {
  const result = new T.BufferGeometry();
  result.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  result.setIndex(indices); result.computeVertexNormals();
  return result;
}
/**
 * Tessellate a normalized parameter patch into a regular indexed surface.
 * The winding is fixed to the sample's parameter orientation; optional offset follows computed
 * normals without retessellating or recalculating them. Construction-only, not a frame helper.
 * @param {function(number, number): number[]} sample - Maps u,v in [0,1] to local XYZ metres.
 * @param {number} columns - Positive horizontal subdivision count.
 * @param {number} rows - Positive vertical subdivision count.
 * @param {number} [offset=0] - Signed normal displacement in metres, useful to separate overlays.
 * @returns {T.BufferGeometry} Newly allocated patch geometry.
 */
function surface(sample, columns, rows, offset = 0) {
  const positions = [], indices = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) positions.push(...sample(i / columns, j / rows));
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * (columns + 1) + i, b = a + 1, c = a + columns + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const result = geometry(positions, indices);
  if (offset) {
    const p = result.attributes.position, n = result.attributes.normal;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * offset, p.getY(i) + n.getY(i) * offset, p.getZ(i) + n.getZ(i) * offset);
  }
  return result;
}
/**
 * Loft a symmetric vehicle body with crowned surfaces and real raised wheel cutouts.
 * Adds exact arch sample stations and separate end-cap vertices to preserve bumper normals.
 * @param {number[][]} sections - Ordered [z,width,bottom,shoulder,top] metre profiles.
 * @param {Object} spec - length, width, wheel radius (wheel), frontWheel and rearWheel Z coordinates.
 * @param {number} sill - Minimum underside height in metres above Y=0.
 * @returns {T.BufferGeometry} Owned closed body shell, oriented front toward negative Z.
 */
function bodyShell(sections, spec, sill) {
  const positions = [], indices = [], l = spec.length / 2;
  // Extra stations at the exact arch tangencies preserve genuine wheel cutouts.
  const radius = spec.wheel * 1.10, wheelY = spec.wheel + .015;
  const stations = new Set(Array.from({length: 31}, (_, i) => -l + spec.length * i / 30));
  for (const z of [spec.frontWheel, spec.rearWheel]) for (let i = 0; i <= 10; i++) stations.add(z + Math.cos(Math.PI * i / 10) * radius);
  let ringSize = 0;
  const rings = [...stations].sort((a,b) => a-b);
  for (const z of rings) {
    const [width, bottom, shoulder, top] = profileAt(sections, z), w = width / 2;
    let lower = bottom;
    for (const wheelZ of [spec.frontWheel, spec.rearWheel]) {
      const dz = z - wheelZ;
      if (Math.abs(dz) < radius) lower = Math.max(lower, wheelY + Math.sqrt(radius * radius - dz * dz));
    }
    const sideTop = Math.max(shoulder, lower + .055), right = [];
    // A crowned bonnet/deck, rolled shoulder, gently convex door, and rounded sill.
    for (let i = 0; i <= 5; i++) {
      const angle = Math.PI * i / 10;
      right.push([w * Math.sin(angle) ** .7, sideTop + (top - sideTop) * Math.cos(angle) ** .8]);
    }
    for (let i = 1; i <= 2; i++) {
      const t = i / 2;
      right.push([w * (1 + .008 * Math.sin(t * Math.PI)), mix(sideTop, lower + .035, t)]);
    }
    right.push([w*.975, lower], [w*.72, Math.max(sill,lower-.10)], [w*.57,sill], [0,sill]);
    const ring = [...right, ...right.slice(1,-1).reverse().map(([x,y]) => [-x,y])];
    ringSize = ring.length;
    for (const [x,y] of ring) positions.push(x,y,z);
  }
  for (let j = 0; j < rings.length-1; j++) for (let i = 0; i < ringSize; i++) {
    const a = j*ringSize+i, b = j*ringSize+(i+1)%ringSize, c = b+ringSize, d = a+ringSize;
    indices.push(a,d,b,b,d,c);
  }
  // Separate planar cap normals keep a clean bumper face, not pinched highlights.
  for (const [row, reverse] of [[0,false],[rings.length-1,true]]) {
    const start = positions.length / 3;
    for (let i=0;i<ringSize;i++) positions.push(...positions.slice((row*ringSize+i)*3,(row*ringSize+i+1)*3));
    for (let i=1;i<ringSize-1;i++) indices.push(start, start+(reverse?i+1:i), start+(reverse?i:i+1));
  }
  return geometry(positions, indices);
}
/**
 * Evaluate a planar cubic Bezier segment for the cabin cross-section.
 * @param {number[]} a - Start [x,y] in metres.
 * @param {number[]} b - First control [x,y] in metres.
 * @param {number[]} c - Second control [x,y] in metres.
 * @param {number[]} d - End [x,y] in metres.
 * @param {number} t - Segment parameter, normally in [0,1].
 * @returns {number[]} New [x,y] point; control points are not changed.
 */
function bezier(a,b,c,d,t) {
  const s=1-t;
  return [s*s*s*a[0]+3*s*s*t*b[0]+3*s*t*t*c[0]+t*t*t*d[0], s*s*s*a[1]+3*s*s*t*b[1]+3*s*t*t*c[1]+t*t*t*d[1]];
}
/**
 * Create a sampler for a crowned roof and curved cabin sides.
 * @param {number[][]} sections - Ordered [z,topHeight] profiles in metres.
 * @param {number} width - Full cabin width at the lower side edge in metres.
 * @param {number} base - Lower cabin edge height in metres.
 * @returns {function(number, number): number[]} Pure sampler (signed u in [-1,1], z in metres) returning XYZ metres.
 */
function cabinSurface(sections, width, base) {
  return (u,z) => {
    const [top] = profileAt(sections,z), h = top-base, w=width/2, t=Math.abs(u);
    // Roof crown and curved tumblehome are geometric, including the glass patches.
    const roofEdge=[w*.73,top-h*.075];
    const point=t<=.65
      ? bezier([0,top],[w*.28,top],[w*.61,top-h*.015],roofEdge,t/.65)
      : bezier(roofEdge,[w*.88,top-h*.17],[w*.98,base+h*.19],[w,base],(t-.65)/.35);
    return [Math.sign(u)*point[0],point[1],z];
  };
}
/**
 * Add a centered box primitive to a model assembly without cloning its material.
 * @param {T.Group} group - Assembly mutated by adding the new mesh.
 * @param {T.Material} material - Shared surface material.
 * @param {number[]} size - [width,height,depth] in metres.
 * @param {number[]} position - Local [x,y,z] center in metres.
 * @param {?number[]} [rotation=null] - Optional XYZ Euler angles in radians.
 * @returns {T.Mesh} New mesh with its own geometry.
 */
function box(group, material, size, position, rotation = null) {
  const mesh = new T.Mesh(new T.BoxGeometry(...size),material);
  mesh.position.set(...position); if(rotation) mesh.rotation.set(...rotation); group.add(mesh); return mesh;
}
/**
 * Add a low-resolution scaled sphere as a small model detail.
 * @param {T.Group} group - Assembly receiving the mesh.
 * @param {T.Material} material - Shared surface material.
 * @param {number[]} size - Ellipsoid radii along X/Y/Z in metres, not full diameters.
 * @param {number[]} position - Local center [x,y,z] in metres.
 * @returns {T.Mesh} New 12-by-6-segment sphere mesh.
 */
function ellipsoid(group, material, size, position) {
  const mesh=new T.Mesh(new T.SphereGeometry(1,12,6),material);
  mesh.scale.set(...size); mesh.position.set(...position); group.add(mesh); return mesh;
}
/**
 * Extrude a rounded rectangular detail from its XY face toward positive local Z.
 * @param {T.Group} group - Assembly receiving the panel.
 * @param {T.Material} material - Shared surface material.
 * @param {number} width - Face width in metres.
 * @param {number} height - Face height in metres.
 * @param {number} depth - Positive-Z extrusion depth in metres.
 * @param {number[]} position - Face-center origin [x,y,z] in metres.
 * @param {number} [radius=.025] - Corner radius, capped relative to face dimensions.
 * @returns {T.Mesh} New panel whose geometry can be consumed by mergeParts.
 */
function panel(group, material, width, height, depth, position, radius=.025) {
  const w=width/2,h=height/2,r=Math.min(radius,w*.45,h*.45),shape=new T.Shape();
  shape.moveTo(-w+r,-h); shape.lineTo(w-r,-h); shape.quadraticCurveTo(w,-h,w,-h+r);
  shape.lineTo(w,h-r); shape.quadraticCurveTo(w,h,w-r,h); shape.lineTo(-w+r,h);
  shape.quadraticCurveTo(-w,h,-w,h-r); shape.lineTo(-w,-h+r); shape.quadraticCurveTo(-w,-h,-w+r,-h);
  const mesh=new T.Mesh(new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:3}),material);
  mesh.position.set(...position); group.add(mesh); return mesh;
}
/**
 * Bake direct child mesh transforms and merge by material identity to reduce draw calls.
 * Consumes/disposes each child geometry and temporary copies, but retains shared materials;
 * the input assembly must not be rendered again. Only position and normal attributes survive.
 * @param {T.Group} group - Flat, unmerged construction assembly; the group's own transform is not baked.
 * @returns {T.Group} New shadow-enabled meshes named body, lights_red or detail for later material replacement.
 */
function mergeParts(group) {
  group.updateMatrixWorld(true);
  const materials = new Map();
  for (const mesh of group.children) {
    if (!mesh.isMesh) continue;
    const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const unindexed=transformed.index?transformed.toNonIndexed():transformed;
    if(unindexed!==transformed) transformed.dispose();
    if (!materials.has(mesh.material)) materials.set(mesh.material, []);
    materials.get(mesh.material).push(unindexed);
    mesh.geometry.dispose();
  }
  const merged = new T.Group();
  for (const [material,list] of materials) {
    const positions = [], normals = [];
    for (const geometry of list) { positions.push(...geometry.attributes.position.array); normals.push(...geometry.attributes.normal.array); geometry.dispose(); }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    const mesh = new T.Mesh(geometry,material); mesh.name=material===basePaint?'body':material===baseBrake?'lights_red':'detail'; mesh.castShadow=true; mesh.receiveShadow=true; merged.add(mesh);
  }
  return merged;
}
/**
 * Build and material-merge a tire, brake disc and five-spoke wheel at the origin.
 * @param {number} radius - Outer tire radius in metres.
 * @param {number} width - Full tire width in metres along its X-axis axle.
 * @returns {T.Group} New wheel with both outer faces detailed; rotate about X to roll.
 */
function wheel(radius, width) {
  const parts=new T.Group();
  // A full-width tire with a rounded shoulder and sidewalls, rather than a thin torus.
  const contour=[[.69,-.49],[.87,-.50],[.96,-.39],[1,-.23],[1,.23],[.96,.39],[.87,.50],[.69,.49],[.69,-.49]];
  const tire=new T.Mesh(new T.LatheGeometry(contour.map(([r,x])=>new T.Vector2(r*radius,x*width)),20),rubber);
  tire.rotation.z=Math.PI/2; parts.add(tire);
  const disc=new T.Mesh(new T.CylinderGeometry(radius*.68,radius*.68,width*.86,16),trim); disc.rotation.z=Math.PI/2; parts.add(disc);
  for(const side of [-1,1]) {
    const rim=new T.Mesh(new T.RingGeometry(radius*.56,radius*.70,20),chrome); rim.rotation.y=side*Math.PI/2; rim.position.x=side*width*.505; parts.add(rim);
    const hub=new T.Mesh(new T.CylinderGeometry(radius*.19,radius*.19,.024,8),chrome); hub.rotation.z=Math.PI/2; hub.position.x=side*width*.51; parts.add(hub);
    for(let i=0;i<5;i++) {
      const a=i*Math.PI*2/5;
      const spoke=box(parts,chrome,[.028,radius*.48,.045],[side*width*.50,Math.cos(a)*radius*.38,Math.sin(a)*radius*.38]);
      spoke.rotation.x=a+.13;
    }
  }
  return mergeParts(parts);
}
/**
 * Add a painted arch lip and dark stationary wheel-well disk around one axle end.
 * @param {T.Group} group - Static body assembly receiving the meshes, not the rotating wheel.
 * @param {number[][]} sections - Body profiles whose width determines lip X placement.
 * @param {Object} spec - wheel radius and full width in metres.
 * @param {number} side - -1 for left or +1 for right.
 * @param {number} z - Axle longitudinal center in metres.
 * @param {number} sill - Lowest arch height in metres; must intersect the arch circle.
 * @returns {void} Adds new geometry while reusing paint and trim materials.
 */
function fender(group, sections, spec, side, z, sill) {
  const r=spec.wheel*1.10,y=spec.wheel+.015, start=Math.asin((sill-y)/r);
  const arch=surface((u,v)=>{
    const a=mix(start,Math.PI-start,side===1?v:1-v), radius=r+u*.032, zz=z+Math.cos(a)*radius;
    return [side*(profileAt(sections,zz)[0]/2+.005+Math.sin(u*Math.PI)*.012),y+Math.sin(a)*radius,zz];
  },2,14);
  group.add(new T.Mesh(arch,basePaint));
  const well=new T.Mesh(new T.CircleGeometry(r,24,start,Math.PI-2*start),trim); well.rotation.y=side*Math.PI/2; well.position.set(side*spec.width*.461,y,z); group.add(well);
}

export { trim, glass, chrome, rubber, headlights, plate, basePaint, baseBrake, mix, profileAt, geometry, surface, bodyShell, cabinSurface, box, ellipsoid, panel, mergeParts, wheel, fender };
