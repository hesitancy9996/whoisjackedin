// Serves the page itself, with the current numbers already in it. Cached for a minute.
import { readFile } from 'node:fs/promises';
import { buildStats } from '../lib/core.js';
import { renderPage } from '../lib/page.js';

let template = null;

/** The built page. It travels with this function; if it somehow does not, it is fetched from the site. */
async function loadTemplate(req) {
  if (template) return template;
  try {
    template = await readFile(new URL('../public/page.html', import.meta.url), 'utf8');
  } catch {
    const res = await fetch(`https://${req.headers.host}/page.html`);
    if (!res.ok) throw new Error(`the page file answered ${res.status}`);
    template = await res.text();
  }
  return template;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    res.status(405).end();
    return;
  }
  const page = await loadTemplate(req);
  let body = page;
  try {
    body = renderPage(page, await buildStats('24h', 0));
  } catch (err) {
    // Without numbers the page still works: its script fetches them.
    console.error(err);
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(body);
}
