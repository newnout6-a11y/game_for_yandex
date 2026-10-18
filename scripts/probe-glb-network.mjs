/** Standalone transport diagnosis: real bundled FileLoader, no app or WebGL. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output/recovery/probe-glb-network.json');
await mkdir(path.dirname(output), {recursive:true});
const rounds = Number(process.env.PROBE_ROUNDS || 4);
const assets = [
  '/public/assets/traffic/firetruck.glb',
  '/public/assets/garage/tier1.glb',
  '/public/assets/garage-cosmetics/body-splitter.glb',
  '/public/assets/garage-cosmetics/rim-copper-left.glb',
  '/public/assets/cosmetics/steering-round.glb',
  '/public/assets/cosmetics/steering-yoke.glb',
];
const expected = Object.fromEntries(await Promise.all(assets.map(async url => {
  const bytes = await readFile(path.join(root, url));
  return [url, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
})));
const report = { startedAt: new Date().toISOString(), rounds, expected, runs: [], note: 'Read-only diagnostic. No app/renderer or production changes. Per-request cache busters. Original fetch-reader EOF and full SHA-256 are independently recorded.' };
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), headless: true });
  report.browser = browser.version();
  for (const mode of ['chunked', 'content-length']) {
    const server = startServer({ root, port: 0 });
    // Only alter HTTP framing. Preserve startServer's exact file resolution,
    // status, MIME, no-store and nosniff behavior, and its actual response bytes.
    server.prependListener('request', (req, res) => {
      const negative = new URL(req.url, 'http://localhost').searchParams.has('probe-truncate');
      if (mode !== 'content-length' && !negative) return;
      const writeHead = res.writeHead.bind(res), end = res.end.bind(res);
      let pending;
      res.writeHead = (...args) => { pending = args; return res; };
      res.end = (data, ...args) => {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
        if (pending) {
          const [status, headers] = pending;
          writeHead(status, { ...headers, 'Content-Length': bytes.length + (negative ? 1 : 0), ...(negative ? { Connection: 'close' } : {}) });
        }
        return end(data, ...args);
      };
    });
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext();
    const run = { mode, origin, loads: [], requests: [], failures: [], consoleErrors: [], negative: null };
    report.runs.push(run);
    let teardown = false;
    const tracked = new Map();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>FileLoader transport probe</title>' }));
      page.on('request', request => {
        if (!request.url().includes('.glb')) return;
        const item = { url: request.url(), startedAt: Date.now(), state: 'pending' };
        tracked.set(request, item); run.requests.push(item);
      });
      page.on('response', response => { const item = tracked.get(response.request()); if (item) { item.status = response.status(); item.headers = response.headers(); } });
      page.on('requestfinished', request => { const item = tracked.get(request); if (item) Object.assign(item, { state: 'finished', finishedAt: Date.now(), timing: request.timing() }); });
      page.on('requestfailed', request => {
        const item = tracked.get(request) || { url: request.url() };
        Object.assign(item, { state: 'failed', failedAt: Date.now(), error: request.failure()?.errorText, timing: request.timing(), duringTeardown: teardown });
        run.failures.push(item);
      });
      page.on('console', message => { if (message.type() === 'error') run.consoleErrors.push(message.text()); });
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => {
        const streams = new WeakMap(), readers = new WeakMap();
        window.__probeFetch = [];
        const fetchOriginal = window.fetch;
        window.fetch = (...args) => {
          const entry = { url: typeof args[0] === 'string' ? args[0] : args[0].url, startedAt: performance.now(), bytes: 0, eof: false };
          window.__probeFetch.push(entry);
          return Reflect.apply(fetchOriginal, window, args).then(response => {
            entry.status = response.status;
            if (response.body) streams.set(response.body, entry);
            return response;
          }, error => { entry.error = String(error); throw error; });
        };
        const getReader = ReadableStream.prototype.getReader;
        ReadableStream.prototype.getReader = function (...args) {
          const reader = Reflect.apply(getReader, this, args), entry = streams.get(this);
          if (entry) readers.set(reader, entry);
          return reader;
        };
        const read = ReadableStreamDefaultReader.prototype.read;
        ReadableStreamDefaultReader.prototype.read = function (...args) {
          const entry = readers.get(this);
          return Reflect.apply(read, this, args).then(result => {
            if (entry) {
              if (result.done) { entry.eof = true; entry.eofAt = performance.now(); }
              else entry.bytes += result.value.byteLength;
            }
            return result;
          }, error => { if (entry) entry.error = String(error); throw error; });
        };
        window.__probeThree = await import('/public/vendor/three.js');
      });
      async function load(urls) {
        return page.evaluate(async urls => Promise.all(urls.map(async url => {
          const startedAt = performance.now();
          try {
            const bytes = await new window.__probeThree.FileLoader().setResponseType('arraybuffer').loadAsync(url);
            const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
            return { url, ok: true, bytes: bytes.byteLength, sha256, startedAt, completedAt: performance.now() };
          } catch (error) { return { url, ok: false, error: String(error), startedAt, completedAt: performance.now() }; }
        })), urls);
      }
      for (let round = 0; round < rounds; round++) {
        run.loads.push(...await load(assets.map((asset, index) => `${origin}${asset}?probe=${mode}-${round}-${index}`)));
        console.log(`${mode}: round ${round + 1}/${rounds}, ${run.loads.filter(item => item.ok).length} successful loads, ${run.failures.length} requestfailed events`);
      }
      [run.negative] = await load([origin + assets[2] + '?probe-truncate=1']);
      await new Promise(resolve => setTimeout(resolve, 750));
      run.fetch = await page.evaluate(() => window.__probeFetch);
    } finally {
      teardown = true;
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    for (const result of run.loads) {
      const wanted = expected[new URL(result.url).pathname];
      result.exactBytesAndHash = result.ok && result.bytes === wanted.bytes && result.sha256 === wanted.sha256;
    }
    for (const failed of run.failures) {
      const completed = run.loads.find(item => item.url === failed.url);
      const fetch = run.fetch?.find(item => item.url === failed.url);
      failed.exactBytesAndHash = completed?.exactBytesAndHash === true;
      failed.fetchEof = fetch?.eof === true;
      failed.fetchBytes = fetch?.bytes;
    }
    run.summary = {
      success: run.loads.filter(item => item.exactBytesAndHash).length,
      total: run.loads.length,
      regularFailures: run.failures.filter(item => !item.url.includes('probe-truncate')).length,
      failedEventsWithExactHashAndEof: run.failures.filter(item => item.exactBytesAndHash && item.fetchEof).length,
      negativeRejected: run.negative?.ok === false,
      negativeNetworkFailureRecorded: run.failures.some(item => item.url.includes('probe-truncate')),
    };
    console.log(JSON.stringify({ mode, ...run.summary }));
    assert.equal(run.summary.success, run.summary.total, 'Every successful fixture must retain its exact bytes and SHA');
    assert.equal(run.summary.negativeRejected, true, 'Truncated body must reject');
    assert.equal(run.summary.negativeNetworkFailureRecorded, true, 'Truncated transport must remain observable');
  }
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log('Evidence: ' + output);
}
