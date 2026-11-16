// The scheduler calls this once a minute. It needs "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from 'node:crypto';
import { collect } from '../lib/core.js';
import { storeKind } from '../lib/store.js';

function allowed(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.authorization ?? ''));
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    res.status(405).end();
    return;
  }
  if (!allowed(req)) {
    res.status(401).json({ ok: false, error: 'not allowed' });
    return;
  }
  if (!storeKind()) {
    res.status(503).json({ ok: false, error: 'no storage is connected' });
    return;
  }
  try {
    const { skipped, state } = await collect();
    const servers = Object.fromEntries(
      Object.entries(state.latest).map(([id, s]) => [id, { answered: s.ok, online: s.online ?? null, players: s.players ?? null }]),
    );
    res.status(200).json({ ok: true, skipped, servers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message).slice(0, 200) });
  }
}
