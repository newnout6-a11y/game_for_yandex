import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = (await readdir(path.join(root, 'src'))).filter(file => file.endsWith('.js'));
let errors = 0;
for (const file of files) {
  const full = path.join(root, 'src', file);
  try { execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' }); }
  catch (error) { console.error(String(error.stderr)); errors++; }
  const source = await readFile(full, 'utf8');
  for (const match of source.matchAll(/import\s+(?:\{([^}]+)\}|[^;'"\n]+)\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(full), match[2]);
    try { await access(target); } catch { console.error('Missing import: ' + file + ' -> ' + match[2]); errors++; continue; }
    const module = await import(pathToFileURL(target).href);
    for (const name of (match[1] || '').split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!(name in module)) { console.error('Missing export: ' + name + ' from ' + match[2]); errors++; }
    }
  }
}
const css = await readFile(path.join(root, 'styles/app.css'), 'utf8');
const theme = await readFile(path.join(root, 'styles/theme.css'), 'utf8');
const defined = new Set([...theme.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
for (const match of css.matchAll(/var\((--[\w-]+)/g)) if (!defined.has(match[1])) { console.error('Undefined token: ' + match[1]); errors++; }
if (/#[\da-f]{3,8}\b|\brgba?\(/i.test(css)) { console.error('Palette literal outside theme'); errors++; }
const html = await readFile(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) {
  if (match[1] === './') continue;
  try { await access(path.resolve(root, match[1])); } catch { console.error('Missing HTML asset: ' + match[1]); errors++; }
}
console.log('Check: ' + files.length + ' JS files, imports/exports, HTML assets, CSS token references; ' + errors + ' errors');
process.exitCode = errors ? 1 : 0;
