import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadRoadsterGeometry } from './roadster-geometry.mjs';

/** Hash actual bytes. Canonical JSON is used only for structured records. */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const hashRecord = value => sha256(JSON.stringify(canonical(value)));

/** Inspect the actual GLB, without relying on a sibling baseline at test time. */
export async function snapshotRoadster(file) {
  const { scene, json, bytes } = await loadRoadsterGeometry(file);
  assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942);
  const binary = bytes.subarray(binHeader + 8);
  assert.equal(bytes.readUInt32LE(binHeader), binary.length);
  assert.equal(json.buffers.length, 1);
  const viewBytes = index => {
    const view = json.bufferViews[index], start = view.byteOffset || 0;
    assert.equal(view.buffer, 0); assert.ok(start + view.byteLength <= json.buffers[0].byteLength);
    return binary.subarray(start, start + view.byteLength);
  };
  const meshes = {};
  scene.traverse(object => {
    if (!object.isMesh) return;
    assert.ok(!meshes[object.name], 'Unique mesh names are needed for preservation checks');
    const geometry = object.geometry, names = Object.keys(geometry.attributes).sort(), attributes = {};
    const describe = a => ({ count: a.count, itemSize: a.itemSize, normalized: a.normalized,
      type: a.array.constructor.name,
      sha256: sha256(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)) });
    for (const name of names) attributes[name] = describe(geometry.attributes[name]);
    // No numeric rounding: all floating-point positions, normals, UVs and other
    // attributes participate. Cyclic triangle starts may change, winding may not.
    const vertices = Array.from({ length: geometry.attributes.position.count }, (_, index) =>
      names.map(name => { const a = geometry.attributes[name];
        return Array.from({ length: a.itemSize }, (_, k) => a.array[index * a.itemSize + k]).join(',');
      }).join('/'));
    const triangles = [], count = geometry.index?.count ?? vertices.length;
    assert.equal(count % 3, 0);
    for (let i = 0; i < count; i += 3) {
      const v = [0, 1, 2].map(k => vertices[geometry.index ? geometry.index.getX(i + k) : i + k]);
      triangles.push([v, v.slice(1).concat(v[0]), v.slice(2).concat(v.slice(0, 2))].map(row => row.join('|')).sort()[0]);
    }
    meshes[object.name] = { triangles: count / 3, attributes,
      indices: geometry.index ? describe(geometry.index) : null,
      triangleAttributeSha256: sha256(triangles.sort().join('\n')),
      worldTransformSha256: hashRecord(object.matrixWorld.elements), material: object.material.name };
  });
  const structure = structuredClone(json);
  // Only these geometry-storage sections can legitimately vary in a geometry
  // revision. Full node/hierarchy, material, image/texture bindings and mesh
  // primitive declarations are verified below, not discarded.
  delete structure.accessors; delete structure.bufferViews; delete structure.buffers;
  delete structure.nodes;
  return { fileSha256: sha256(bytes), counts: { nodes: json.nodes.length, meshes: json.meshes.length, materials: json.materials.length },
    structureSha256: hashRecord(structure), materialSha256: hashRecord(json.materials),
    nodes: Object.fromEntries(json.nodes.map(node => [node.name, hashRecord(node)])), meshes,
    images: Object.fromEntries(json.images.map(image => [image.name, { mimeType: image.mimeType,
      byteLength: viewBytes(image.bufferView).length, sha256: sha256(viewBytes(image.bufferView)) }])) };
}
