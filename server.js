// Runs the stats page on your own machine: same code as on Vercel, with files for storage and a built-in timer.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5177);
const HOST = process.env.HOST ?? '127.0.0.1';
// The built page. `npm start` builds it first.
const PUBLIC = path.join(ROOT, 'public');
// Without Redis settings in the environment, samples go to files in this folder.
process.env.MXO_DATA_DIR ??= path.join(ROOT, 'data', 'kv');

const { SAMPLE_MS, buildStats, collect } = await import('./lib/core.js');

// The same security headers as on Vercel, so a page that works here works there.
const config = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
const SHARED_HEADERS = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
const PAGE_HEADERS = { ...SHARED_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' };
const ASSET_TYPES = { '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' }).end();
    return;
  }
  if (url.pathname === '/') {
    try {
      res.writeHead(200, PAGE_HEADERS).end(await readFile(path.join(PUBLIC, 'index.html')));
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('public/index.html is missing. Run "npm run build" first.');
    }
    return;
  }
  // Only plain file names inside public/assets are served.
  const asset = /^\/assets\/((?:icons\/)?[\w.-]+)$/.exec(url.pathname)?.[1];
  if (asset && ASSET_TYPES[path.extname(asset)]) {
    try {
      const body = await readFile(path.join(PUBLIC, 'assets', asset));
      res.writeHead(200, { ...SHARED_HEADERS, 'content-type': ASSET_TYPES[path.extname(asset)], 'cache-control': 'no-cache' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  if (url.pathname === '/api/stats') {
    try {
      const tz = Number(url.searchParams.get('tz') ?? 0);
      const body = JSON.stringify(await buildStats(url.searchParams.get('range') ?? '', Number.isInteger(tz) && tz >= -12 && tz <= 14 ? tz : 0));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
    } catch (err) {
      console.warn(err.message);
      res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"stats are not available right now"}');
    }
    return;
  }
  res.writeHead(404).end();
});

async function tick() {
  try {
    await collect();
  } catch (err) {
    console.warn(`could not take a sample: ${err.message}`);
  }
}

if (process.env.MXO_NO_TIMER !== '1') {
  tick();
  setInterval(tick, SAMPLE_MS);
}

server.listen(PORT, HOST, () => {
  console.log(`MxO stats: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Samples are saved in ${process.env.MXO_DATA_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
