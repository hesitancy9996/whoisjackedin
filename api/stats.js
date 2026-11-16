import { RANGES, buildStats } from '../lib/core.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    res.status(405).end();
    return;
  }
  // Only ?range= is known, so made-up parameters cannot be used to dodge the cache.
  if (Object.keys(req.query ?? {}).some((name) => name !== 'range')) {
    res.status(400).json({ error: 'unknown parameter' });
    return;
  }
  // Only the known ranges are answered. A made-up one would get its own cache entry and a database read.
  const range = req.query?.range;
  if (range !== undefined && !Object.hasOwn(RANGES, String(range))) {
    res.status(400).json({ error: 'unknown range' });
    return;
  }
  try {
    const stats = await buildStats(String(range ?? ''));
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=20, stale-while-revalidate=40');
    res.status(200).json(stats);
  } catch (err) {
    console.error(err);
    res.setHeader('cache-control', 'no-store');
    res.status(500).json({ error: 'stats are not available right now' });
  }
}
