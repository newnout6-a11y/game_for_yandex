import { readFile, writeFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import './vendor.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const tokens = JSON.parse(await readFile(path.join(root, 'tokens/theme.json'), 'utf8'));
const theme = '/* Generated from tokens/theme.json by npm run build. */\n:root {\n' + Object.entries(tokens).map(([key, token]) => '  --' + key + ': ' + token.$value + ';').join('\n') + '\n  color-scheme: dark;\n}\n';
await writeFile(path.join(root, 'styles/theme.css'), theme);
const dist = path.join(root, 'dist');
// Only the build-owned directory is replaced.
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html', 'src', 'styles', 'public']) await cp(path.join(root, name), path.join(dist, name), { recursive: true });
const archive = {};
async function collect(dir, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const key = prefix + item.name;
    if (item.isDirectory()) await collect(path.join(dir, item.name), key + '/');
    else archive[key] = new Uint8Array(await readFile(path.join(dir, item.name)));
  }
}
await collect(dist);
await mkdir(path.join(root, 'output'), { recursive: true });
const zipped = zipSync(archive, { level: 9 });
await writeFile(path.join(root, 'output/potok-yandex.zip'), zipped);
console.log('Built ' + Object.keys(archive).length + ' files; output/potok-yandex.zip (' + (zipped.length / 1024).toFixed(1) + ' KiB)');
