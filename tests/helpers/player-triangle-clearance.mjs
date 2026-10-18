import * as T from '../../public/vendor/three.js';

/** Expand exact indexed geometry without modifying its buffers. */
export function meshTriangles(mesh, matrix = new T.Matrix4()) {
  const position = mesh.geometry.attributes.position, index = mesh.geometry.index, records = [];
  for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
    const v = [0, 1, 2].map(corner => new T.Vector3().fromBufferAttribute(position,
      index ? index.getX(offset + corner) : offset + corner).applyMatrix4(matrix));
    records.push({ v, box: new T.Box3().setFromPoints(v), mesh: mesh.name, index: offset / 3 });
  }
  return records;
}

/** AABBs only prune candidates. No overlapping box is a collision verdict. */
export function triangleTree(records) {
  const box = new T.Box3();
  for (const record of records) box.union(record.box);
  if (records.length <= 12) return { box, records };
  const size = box.getSize(new T.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  records.sort((a, b) => a.box.min[axis] + a.box.max[axis] - b.box.min[axis] - b.box.max[axis]);
  const middle = records.length >> 1;
  return { box, left: triangleTree(records.slice(0, middle)), right: triangleTree(records.slice(middle)) };
}

const ray = new T.Ray(), direction = new T.Vector3(), point = new T.Vector3();
const CONTACT_TOLERANCE = 2e-6;
/** Test finite edges against real triangles, ignoring endpoint-only contact. */
function edgePiercing(a, b, acceptPoint) {
  for (let edge = 0; edge < 3; edge++) {
    const start = a[edge], length = direction.copy(a[(edge + 1) % 3]).sub(start).length();
    if (length < CONTACT_TOLERANCE) continue;
    ray.set(start, direction.multiplyScalar(1 / length));
    if (!ray.intersectTriangle(b[0], b[1], b[2], false, point)) continue;
    const distance = point.distanceTo(start);
    if (distance > CONTACT_TOLERANCE && distance < length - CONTACT_TOLERANCE && acceptPoint(point)) return point.toArray();
  }
  return null;
}

/**
 * Find a two-way edge/triangle piercing, preserving source triangle IDs.
 * Not a continuous sweep proof, coplanar-overlap test or solid-containment test.
 */
export function trianglePiercing(triangle, node, accept = () => true, stats = null) {
  if (!triangle.box.intersectsBox(node.box)) return null;
  if (node.records) {
    for (const other of node.records) {
      if (!triangle.box.intersectsBox(other.box)) continue;
      if (stats) stats.narrowPhasePairs++;
      const acceptPoint = hit => accept(hit, other.mesh);
      const hit = edgePiercing(triangle.v, other.v, acceptPoint) || edgePiercing(other.v, triangle.v, acceptPoint);
      if (hit) return { wheelMesh: triangle.mesh, wheelTriangle: triangle.index,
        bodyMesh: other.mesh, bodyTriangle: other.index, point: hit };
    }
    return null;
  }
  return trianglePiercing(triangle, node.left, accept, stats) || trianglePiercing(triangle, node.right, accept, stats);
}

/** Reuse a transformed record while traversing untouched mesh-local triangles. */
export function meshPiercing(records, matrix, tree, accept, stats = null) {
  const transformed = { v: [new T.Vector3(), new T.Vector3(), new T.Vector3()], box: new T.Box3(), mesh: '', index: 0 };
  for (const source of records) {
    transformed.mesh = source.mesh; transformed.index = source.index;
    for (let corner = 0; corner < 3; corner++) transformed.v[corner].copy(source.v[corner]).applyMatrix4(matrix);
    transformed.box.setFromPoints(transformed.v);
    if (stats) stats.wheelTriangles++;
    const hit = trianglePiercing(transformed, tree, accept, stats);
    if (hit) return hit;
  }
  return null;
}
