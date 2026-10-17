import { readFile } from 'node:fs/promises';
import * as T from '../../public/vendor/three.js';

/**
 * Load exact exported Roadster geometry in Node without a DOM image decoder.
 * Only texture references are removed from an in-memory JSON copy; mesh buffers,
 * indices, transforms, material culling and transparency stay unchanged. Browser
 * inspection separately validates the original embedded textures and shaders.
 * @param {string|URL} [file] - GLB source; defaults to the live player asset.
 * @returns {Promise<{scene:T.Group,json:object,bytes:Buffer}>} Parsed geometry and untouched source metadata/bytes.
 */
export async function loadRoadsterGeometry(file = new URL('../../public/assets/roadster.glb', import.meta.url)) {
  const bytes = await readFile(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new TypeError('Expected a binary glTF');
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
  const geometryJson = structuredClone(json);
  /** Remove nested texture slots while retaining all non-texture material behavior. */
  function removeTextureSlots(object) {
    if (!object || typeof object !== 'object') return;
    for (const key of Object.keys(object)) {
      if (/texture$/i.test(key)) delete object[key];
      else removeTextureSlots(object[key]);
    }
  }
  for (const material of geometryJson.materials || []) removeTextureSlots(material);
  delete geometryJson.images; delete geometryJson.textures; delete geometryJson.samplers;
  const text = Buffer.from(JSON.stringify(geometryJson));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const tail = bytes.subarray(20 + length), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binary = Buffer.concat([header, padded, tail]);
  const result = await new T.GLTFLoader().parseAsync(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), '');
  result.scene.updateMatrixWorld(true);
  return { scene: result.scene, json, bytes };
}
