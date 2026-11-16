// Runs the stats page on your own machine: same code as on Vercel, with files for storage and a built-in timer.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5177);
const HOST = process.env.HOST ?? '127.0.0.1';
// The readable page by default. Point MXO_PAGE at public/index.html to try the built one.
const PAGE = process.env.MXO_PAGE ?? path.join(ROOT, 'src', 'index.html');
// Without Redis settings in the environment, samples go to files in this folder.
process.env.MXO_DATA_DIR ??= path.join(ROOT, 'data', 'kv');

const { SAMPLE_MS, buildStats, collect } = await import('./lib/core.js');

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-cache',
  'x-content-type-options': 'nosniff',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' }).end();
    return;
  }
  if (url.pathname === '/') {
    try {
      res.writeHead(200, PAGE_HEADERS).end(await readFile(PAGE));
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(`${PAGE} is missing`);
    }
    return;
  }
  if (url.pathname === '/api/stats') {
    try {
      const body = JSON.stringify(await buildStats(url.searchParams.get('range') ?? ''));
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
