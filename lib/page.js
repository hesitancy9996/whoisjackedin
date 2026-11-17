// Fills the built page with the current numbers before it is sent. People see numbers at once,
// and search engines and link previews, which may not run scripts, get them too.

const text = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** True when a server's count can be trusted and added up. The page's script uses the same rule. */
const counted = (now) => Boolean(now && now.players !== undefined && (now.unsure ? now.online : now.ok && now.online));

/** `template` is the built page. `stats` is what the stats endpoint returns. */
export function renderPage(template, stats) {
  const live = stats.servers.filter((server) => counted(server.now));
  const total = live.reduce((sum, server) => sum + server.now.players, 0);
  const peaks = stats.total ?? {};
  const each = stats.servers.map((server) => `${server.name} ${counted(server.now) ? server.now.players : 'offline'}`).join(', ');
  const summary = live.length
    ? `${total} ${total === 1 ? 'operative' : 'operatives'} jacked in right now (${each}). Live player counts, peaks, uptime and history for the Matrix Online community servers.`
    : null;
  // Each swap is a function, so a "$" in the data is never read as a pattern.
  const put = (page, marker, value) => page.replace(marker, () => value);
  let page = template;
  if (live.length) {
    page = put(page, 'id="total-now">–<', `id="total-now">${total}<`);
    page = put(page, 'id="total-peak24">–<', `id="total-peak24">${Math.max(peaks.peak24 ?? 0, total)}<`);
    page = put(page, 'id="total-record">–<', `id="total-record">${Math.max(peaks.recordPeak ?? 0, total)}<`);
  }
  page = put(page, 'id="total-note">&nbsp;<', `id="total-note">${live.length} of ${stats.servers.length} servers online<`);
  if (summary) {
    page = page.replace(/(<meta name="description" content=")[^"]*(")/, (_, a, b) => a + text(summary) + b);
    page = page.replace(/(<meta property="og:description" content=")[^"]*(")/, (_, a, b) => a + text(summary) + b);
  }
  // The same numbers, handed to the page's script so it can draw everything without waiting.
  return put(page, '<script type="application/json" id="boot">null</script>', `<script type="application/json" id="boot">${JSON.stringify(stats).replace(/</g, '\\u003c')}</script>`);
}
