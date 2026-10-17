// Reproducible source download. Runtime assets are local; no CDN requests in game.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const assets = 'public/assets';
await mkdir(assets, { recursive: true });
const manifest = [];
/**
 * Reuse a readable local asset or fetch and write it when the read fails.
 * Appends actual byte size and SHA-256 provenance to the shared manifest;
 * an existing file is hashed as-is rather than revalidated against the URL.
 * @param {string} url - Source download URL used only on a local read failure.
 * @param {string} target - Repository-relative destination file path.
 * @param {string} license - License identifier recorded with the bytes.
 * @param {string} source - Attribution/source page recorded in the manifest.
 * @returns {Promise<Buffer>} Local or downloaded bytes; rejects on HTTP/write failure.
 */
async function download(url, target, license, source) {
  await mkdir(path.dirname(target), { recursive: true });
  let data;
  try { data = await readFile(target); }
  catch { const response = await fetch(url); if (!response.ok) throw Error(response.status + ' ' + url); data = Buffer.from(await response.arrayBuffer()); await writeFile(target, data); }
  manifest.push({ file: target.replace('public/', ''), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), license, source, download: url });
  console.log(target, data.length);
  return data;
}
await download('https://raw.githubusercontent.com/mrdoob/three.js/r183/examples/models/gltf/ferrari.glb', assets + '/car.glb', 'CC-BY-4.0', 'https://threejs.org/examples/webgl_materials_car.html');
for (const id of ['asphalt_02', 'grass_path_2']) for (const map of ['diff', 'nor_gl', 'rough']) await download(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${map}_1k.jpg`, `${assets}/${id}_${map}.jpg`, 'CC0-1.0', 'https://polyhaven.com/a/' + id);
await download('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_06_puresky_1k.hdr', assets + '/daylight.hdr', 'CC0-1.0', 'https://polyhaven.com/a/kloppenheim_06_puresky');
for (const map of ['diff', 'nor_gl']) await download(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_grass_rock/aerial_grass_rock_${map}_1k.jpg`, `${assets}/grass_${map}.jpg`, 'CC0-1.0', 'https://polyhaven.com/a/aerial_grass_rock');
// Download the source to an ignored preparation directory, never to the release.
const id = 'fir_sapling';
const folder = 'output/assets-source/public/fir';
const gltf = JSON.parse((await download(`https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/${id}/${id}_1k.gltf`, folder + '/tree.gltf', 'CC0-1.0', 'https://polyhaven.com/a/fir_sapling')).toString());
await download(`https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/${id}/${id}.bin`, folder + '/' + gltf.buffers[0].uri, 'CC0-1.0', 'https://polyhaven.com/a/fir_sapling');
for (const image of gltf.images) await download('https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/fir_sapling/' + image.uri.split('/').at(-1), folder + '/' + image.uri, 'CC0-1.0', 'https://polyhaven.com/a/fir_sapling');
await writeFile(assets + '/manifest.json', JSON.stringify(manifest.filter(m => !m.file.startsWith('output/')), null, 2));
