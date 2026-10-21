import * as T from '../../public/vendor/three.js';

/** Split a material batch by welded topology, retaining the exported triangles and transforms. */
export function toyComponents(mesh) {
  const position = mesh.geometry.attributes.position;
  const indices = mesh.geometry.index?.array || Array.from({ length: position.count }, (_, i) => i);
  const parent = Array.from({ length: position.count }, (_, i) => i), welded = new Map();
  const points = [];
  const find = value => {
    while (parent[value] !== value) { parent[value] = parent[parent[value]]; value = parent[value]; }
    return value;
  };
  const join = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < position.count; i++) {
    const point = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    points.push(point);
    const key = point.toArray().map(value => Math.round(value * 1e7)).join(',');
    if (welded.has(key)) join(i, welded.get(key)); else welded.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) { join(indices[i], indices[i + 1]); join(indices[i], indices[i + 2]); }
  const groups = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const key = find(indices[i]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(indices[i], indices[i + 1], indices[i + 2]);
  }
  return [...groups.values()].map(group => {
    const box = new T.Box3();
    for (const index of group) box.expandByPoint(points[index]);
    const geometry = mesh.geometry.clone(); geometry.setIndex(group);
    const material = mesh.material.clone(); material.side = T.DoubleSide;
    const part = new T.Mesh(geometry, material);
    part.matrixAutoUpdate = false; part.matrix.copy(mesh.matrixWorld); part.matrixWorld.copy(mesh.matrixWorld);
    return { mesh: part, box, size: box.getSize(new T.Vector3()), center: box.getCenter(new T.Vector3()), triangles: group.length / 3 };
  });
}

/** Recover the actual shell and four physical tyres without relying on generator dimensions or wheel names. */
export function toyPhysicalParts(scene) {
  scene.updateMatrixWorld(true);
  const red = [], rubber = [];
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (mesh.material.name === 'Toy racing red') red.push(...toyComponents(mesh));
    if (mesh.material.name === 'Toy tyre rubber') rubber.push(...toyComponents(mesh));
  });
  const shell = red.filter(part => part.size.z > 1 && part.size.x > .5).sort((a, b) => b.triangles - a.triangles)[0];
  const tyres = rubber.filter(part => part.size.y > .18 && part.size.z > .18 && part.size.x < .12);
  return { shell, tyres, red };
}
