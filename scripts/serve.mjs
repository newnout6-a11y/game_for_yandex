import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
/**
 * Start the local QA server with a strict public-file allowlist and no caching.
 * Requests outside index.html, src/, styles/ and public/ receive 403; unreadable
 * or non-file targets receive 404. The caller owns closing the returned server.
 * @param {object} [options] - Root and listen-address overrides.
 * @param {string} [options.root=workspace] - Absolute directory served as the app root.
 * @param {number} [options.port=4173] - TCP port; zero requests an ephemeral port.
 * @param {string} [options.host='127.0.0.1'] - Interface to bind.
 * @returns {http.Server} Listening server; await its listening event before use.
 */
export function startServer({ root = workspace, port = 4173, host = '127.0.0.1' } = {}) {
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
  /**
   * Resolve an HTTP path within the allowed app tree and return local bytes.
   * Decodes the URL once, rejects dot segments/backslashes escaping the root,
   * and writes one response without exposing filesystem errors to the client.
   * @param {http.IncomingMessage} req - Incoming local HTTP request.
   * @param {http.ServerResponse} res - Response mutated with status, headers and body.
   */
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const target = path.resolve(root, relative);
      const scope = path.relative(root, target);
      if (relative.split(/[\\/]/).some(part => part.startsWith('.')) || scope.startsWith('..') || path.isAbsolute(scope) || scope.split(path.sep).some(part => part.startsWith('.')) || !/^(index\.html|src[\\/]|styles[\\/]|public[\\/])/.test(relative)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (!(await stat(target)).isFile()) throw new Error('Not a file');
      const data = await readFile(target);
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(port, host);
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const server = startServer({ port });
  server.on('listening', () => console.log('Roadster: http://127.0.0.1:' + port));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
