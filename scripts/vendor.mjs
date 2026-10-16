import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await build({ entryPoints: ['scripts/vendor-entry.mjs'], bundle: true, minify: true, format: 'esm', outfile: 'public/vendor/three.js', legalComments: 'eof' });
await copyFile('node_modules/three/LICENSE', 'public/vendor/THREE-LICENSE.txt');
await mkdir('public/vendor/draco', { recursive: true });
for (const file of ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js']) await copyFile('node_modules/three/examples/jsm/libs/draco/gltf/' + file, 'public/vendor/draco/' + file);
console.log('Local Three.js renderer bundle ready');
