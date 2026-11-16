// Takes samples of the three servers, saves them, and turns the saved samples into the page's numbers.
import { SERVERS, readAll, readCommunities } from './sources.js';
import { lock, mget, storeKind, write } from './store.js';

export const SAMPLE_MS = 60_000;
const MIN_GAP_MS = 45_000; // the feeds are never read more often than this, whoever asks
const STALE_MS = 90_000; // a page view takes a sample itself when the last one is older
const SILENCE_MS = 3 * SAMPLE_MS; // longer than this without samples means "not recording", not an outage
const CONFIRM_CHECKS = 3; // bad answers in a row before a server counts as down
const CARRY_MS = 5 * 60_000; // how long the last real reading may stand in for a missing one
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RAW_KEEP_DAYS = 9;
const ALL_TIME_DAYS = 90;
const COMMUNITY_MS = HOUR_MS; // how often the Discord sizes are refreshed

export const STATE_KEY = 'mxo:state';
const LOCK_KEY = 'mxo:lock';
const LOCK_SECONDS = 40; // shorter than MIN_GAP_MS, so it never blocks the next sample
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
export const rawKey = (day) => `mxo:raw:${day}`;
export const hoursKey = (day) => `mxo:hours:${day}`;

export const RANGES = {
  '1h': { spanMs: HOUR_MS, bucketMs: 120_000 },
  '24h': { spanMs: DAY_MS, bucketMs: 300_000 },
  '7d': { spanMs: 7 * DAY_MS, bucketMs: 1_800_000 },
  '30d': { spanMs: 30 * DAY_MS, bucketMs: HOUR_MS },
  all: { spanMs: 365 * DAY_MS, bucketMs: HOUR_MS },
};

/**
 * Saved under STATE_KEY. `hours` holds the hourly totals of `today` (UTC) as
 * { code: { hour: [playerSum, answered, online, peak] } }; finished days move to their own key.
 */
export function newState() {
  return { v: 1, since: null, checks: 0, lastT: null, today: null, hours: {}, latest: {}, all: {} };
}

/** A run is a streak of bad answers. Older saved runs have a single `kind` and no `offline` count. */
const offlineCount = (run) => run.offline ?? (run.kind === 'offline' ? run.checks : 0);
const kindOf = (run) => (offlineCount(run) * 2 >= run.checks ? 'offline' : 'unknown');

function closeRun(all, to) {
  const run = all.run;
  all.run = null;
  // A short streak of bad answers is a blip, not an outage.
  if (run.checks < CONFIRM_CHECKS) return;
  all.outages.unshift({ kind: kindOf(run), from: run.from, to, checks: run.checks, detail: run.detail ?? null });
  all.outages.length = Math.min(all.outages.length, 20);
}

/** Folds one round of answers into the state. Returns the line to save and any day that just ended. */
export function applySample(state, now, results) {
  const today = dayOf(now);
  const finished = state.today && state.today !== today ? { day: state.today, hours: state.hours } : null;
  if (state.today !== today) {
    state.today = today;
    state.hours = {};
  }
  const silence = state.lastT !== null && now - state.lastT > SILENCE_MS;
  const hour = new Date(now).getUTCHours();
  const parts = [Math.round(now / 1000)];

  SERVERS.forEach((server, i) => {
    const r = results[i];
    const all = (state.all[server.id] ??= { recordPeak: null, recordAt: null, lastPlayersAt: null, run: null, outages: [] });
    const last = state.latest[server.id];
    /** Adds one counted reading to this hour's totals and to the saved line. */
    const save = (online, players) => {
      const slot = ((state.hours[server.code] ??= {})[hour] ??= [0, 0, 0, 0]);
      slot[0] += players;
      slot[1] += 1;
      slot[2] += online ? 1 : 0;
      slot[3] = Math.max(slot[3], players);
      parts.push(`${server.code}${online ? 1 : 0}:${players}`);
    };
    /** With no usable answer, the last real reading stands in while it is still recent. */
    const carry = () => {
      if (last?.ok && last.players !== undefined && now - last.at <= CARRY_MS) save(last.online, last.players);
      else parts.push(`${server.code}-`);
    };
    // "Asked too often" says nothing about the server: keep everything as it is.
    if (r.limited) {
      carry();
      return;
    }
    const kind = !r.ok ? 'unknown' : r.online ? null : 'offline';
    if (all.run && (silence || !kind)) closeRun(all, silence ? all.run.last + SAMPLE_MS : now);
    if (kind) {
      const run = (all.run ??= { from: now, last: now, checks: 0, offline: 0, detail: null });
      run.last = now;
      run.checks += 1;
      run.offline = offlineCount({ ...run, checks: run.checks - 1 }) + (kind === 'offline' ? 1 : 0);
      run.detail ??= String(r.ok ? (r.details?.[0]?.value ?? 'not live') : r.error).slice(0, 60);
      if (run.checks < CONFIRM_CHECKS) {
        // Not confirmed yet: keep showing the last known numbers, and count them for this sample too.
        state.latest[server.id] = { ...last, unsure: true, unsureSince: run.from };
        carry();
        return;
      }
    }

    if (!r.ok) {
      // Confirmed: keep the last known numbers and say the feed is not answering.
      state.latest[server.id] = { ...state.latest[server.id], ok: false, unsure: false, error: r.error, failedAt: now };
      parts.push(`${server.code}-`);
      return;
    }
    state.latest[server.id] = { ok: true, online: r.online, players: r.players, checkedAt: r.checkedAt, details: r.details, at: now };
    if (all.recordPeak === null || r.players > all.recordPeak) {
      all.recordPeak = r.players;
      all.recordAt = now;
    }
    if (r.players > 0) all.lastPlayersAt = now;
    save(r.online, r.players);
  });

  state.since ??= now;
  state.checks += 1;
  state.lastT = now;
  return { rawLine: `${parts.join(';')}\n`, finished };
}

async function loadState() {
  const [saved] = await mget([STATE_KEY]);
  return saved ? JSON.parse(saved) : null;
}

let sampling = false;

/** Reads the three feeds and saves one sample, unless one was taken moments ago or is being taken right now. */
export async function collect({ force = false } = {}) {
  const state = (await loadState()) ?? newState();
  if (!force && state.lastT && Date.now() - state.lastT < MIN_GAP_MS) return { skipped: true, state };
  // Two requests can arrive together. Only one of them takes the sample.
  if (sampling || !(await lock(LOCK_KEY, LOCK_SECONDS))) return { skipped: true, state };
  sampling = true;
  try {
    return await takeSample(state);
  } finally {
    sampling = false;
  }
}

async function takeSample(state) {
  const communityDue = !state.community || Date.now() - state.community.triedAt > COMMUNITY_MS;
  const [results, communities] = await Promise.all([readAll(), communityDue ? readCommunities() : null]);
  const now = Date.now();
  if (communities) {
    state.community = { triedAt: now, byId: state.community?.byId ?? {} };
    SERVERS.forEach((server, i) => {
      if (communities[i]) state.community.byId[server.id] = { ...communities[i], at: now };
    });
  }
  const firstOfDay = state.today !== dayOf(now);
  const { rawLine, finished } = applySample(state, now, results);
  const ops = [
    { append: [rawKey(dayOf(now)), rawLine, firstOfDay ? RAW_KEEP_DAYS * 86_400 : null] },
    { set: [STATE_KEY, JSON.stringify(state)] },
  ];
  // A finished day's hourly totals are small and are kept for good.
  if (finished) ops.push({ set: [hoursKey(finished.day), JSON.stringify(finished.hours)] });
  await write(ops);
  return { skipped: false, state };
}

function daysBetween(from, to) {
  const days = [];
  for (let t = Date.parse(dayOf(from)); t <= to; t += DAY_MS) days.push(dayOf(t));
  return days;
}

/** Saved lines look like "1794306217;r1:2;v1:4;e-": seconds, then code + online flag + players, or "-" for no answer. */
function parseRaw(texts, from) {
  const index = new Map(SERVERS.map((server, i) => [server.code, i]));
  const samples = [];
  for (const text of texts) {
    for (const line of (text ?? '').split('\n')) {
      const parts = line.split(';');
      const t = Number(parts[0]) * 1000;
      if (!t || t < from) continue;
      const values = new Array(SERVERS.length); // undefined = no sample, null = no answer
      for (const part of parts.slice(1)) {
        const i = index.get(part[0]);
        if (i === undefined) continue;
        if (part[1] === '-') values[i] = null;
        else values[i] = { online: part[1] === '1', players: Number(part.slice(3)) || 0 };
      }
      samples.push({ t, values });
    }
  }
  return samples.sort((a, b) => a.t - b.t);
}

const emptySummary = () => ({ peak: null, peakAt: null, sum: 0, answered: 0, onlineChecks: 0 });

function finishSummary(s) {
  return {
    peak: s.peak,
    peakAt: s.peakAt,
    average: s.answered ? s.sum / s.answered : null,
    availability: s.answered ? s.onlineChecks / s.answered : null,
    answered: s.answered,
    onlineChecks: s.onlineChecks,
  };
}

function fromRaw(samples, bucketMs) {
  const summaries = SERVERS.map(emptySummary);
  const points = [];
  if (!samples.length) return { summaries, points };
  const first = Math.floor(samples[0].t / bucketMs);
  const last = Math.floor(samples.at(-1).t / bucketMs);
  for (let b = first; b <= last; b++) points.push([b * bucketMs, ...SERVERS.map(() => null)]);
  for (const { t, values } of samples) {
    const row = points[Math.floor(t / bucketMs) - first];
    values.forEach((value, i) => {
      if (!value) return;
      const s = summaries[i];
      s.answered += 1;
      s.onlineChecks += value.online ? 1 : 0;
      s.sum += value.players;
      if (s.peak === null || value.players > s.peak) {
        s.peak = value.players;
        s.peakAt = t;
      }
      if (row[i + 1] === null || value.players > row[i + 1]) row[i + 1] = value.players;
    });
  }
  // A short hole shows the last known value. Longer ones stay open, because nothing is known there.
  SERVERS.forEach((server, i) => {
    let last = null;
    for (const row of points) {
      if (row[i + 1] !== null) last = { t: row[0], value: row[i + 1] };
      else if (last && row[0] - last.t <= CARRY_MS) row[i + 1] = last.value;
    }
  });
  return { summaries, points };
}

function fromHours(hourly, from, to) {
  const summaries = SERVERS.map(emptySummary);
  const points = [];
  for (let t = Math.floor(from / HOUR_MS) * HOUR_MS; t <= to; t += HOUR_MS) {
    const hours = hourly.get(dayOf(t));
    const hour = new Date(t).getUTCHours();
    const row = [t];
    SERVERS.forEach((server, i) => {
      const slot = hours?.[server.code]?.[hour];
      row.push(slot ? slot[3] : null);
      if (!slot) return;
      const s = summaries[i];
      s.sum += slot[0];
      s.answered += slot[1];
      s.onlineChecks += slot[2];
      if (s.peak === null || slot[3] > s.peak) {
        s.peak = slot[3];
        s.peakAt = t;
      }
    });
    points.push(row);
  }
  const hasData = (row) => row.slice(1).some((v) => v !== null);
  while (points.length && !hasData(points[0])) points.shift();
  while (points.length && !hasData(points.at(-1))) points.pop();
  return { summaries, points };
}

function outagesOf(all, now) {
  // Entries saved before the three-in-a-row rule have no `checks`. Those are judged by how long they lasted.
  const list = (all?.outages ?? [])
    .filter((o) => (o.checks ? o.checks >= CONFIRM_CHECKS : o.to - o.from >= (CONFIRM_CHECKS - 0.5) * SAMPLE_MS))
    .map((o) => ({ ...o, ongoing: false }));
  const run = all?.run;
  if (run && run.checks >= CONFIRM_CHECKS) {
    const ongoing = now - run.last < SILENCE_MS;
    list.unshift({ kind: kindOf(run), from: run.from, to: ongoing ? now : run.last + SAMPLE_MS, detail: run.detail ?? null, ongoing });
  }
  return list;
}

const describe = (server) => ({ id: server.id, name: server.name, site: server.site, about: server.about ?? null });

/** The server's Discord: static facts plus the last counts read, when there are any. */
function communityOf(server, state) {
  if (!server.discord) return null;
  const { invite, opened, shared } = server.discord;
  return { url: `https://discord.gg/${invite}`, opened, shared, ...(state?.community?.byId?.[server.id] ?? {}) };
}

/** One entry per UTC day with data: [dayStart, answeredChecks, onlineChecks, mostAtOnce, playerSum]. */
function daysOf(hourly, code) {
  const days = [];
  for (const [day, hours] of [...hourly].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let answered = 0;
    let online = 0;
    let peak = 0;
    let sum = 0;
    for (const slot of Object.values(hours[code] ?? {})) {
      sum += slot[0];
      answered += slot[1];
      online += slot[2];
      peak = Math.max(peak, slot[3]);
    }
    if (answered) days.push([Date.parse(day), answered, online, peak, sum]);
  }
  return days;
}

/** Totals for each hour of the week in UTC: 168 entries of [playerSum, readings], Sunday 00:00 first. */
function weekOf(hourly, code) {
  const week = Array.from({ length: 168 }, () => [0, 0]);
  for (const [day, hours] of hourly) {
    const weekday = new Date(day).getUTCDay();
    for (const [hour, slot] of Object.entries(hours[code] ?? {})) {
      week[weekday * 24 + Number(hour)][0] += slot[0];
      week[weekday * 24 + Number(hour)][1] += slot[1];
    }
  }
  return week;
}

/** The most seen at once in the last 24 hours, from the hourly totals. */
function peak24Of(hourly, code, now) {
  let peak = null;
  for (let t = Math.floor((now - DAY_MS) / HOUR_MS) * HOUR_MS; t <= now; t += HOUR_MS) {
    const slot = hourly.get(dayOf(t))?.[code]?.[new Date(t).getUTCHours()];
    if (slot && (peak === null || slot[3] > peak)) peak = slot[3];
  }
  return peak;
}

/** With no storage connected the page still shows live numbers, just no history. */
async function liveOnly(range) {
  const results = await readAll();
  const now = Date.now();
  return {
    now,
    sampleSeconds: SAMPLE_MS / 1000,
    storage: false,
    since: null,
    checks: 0,
    servers: SERVERS.map((server, i) => ({
      ...describe(server),
      community: communityOf(server, null),
      now: results[i].ok ? { ...results[i], at: now } : { ok: false, error: results[i].error, failedAt: now },
      summary: finishSummary(emptySummary()),
      allTime: { recordPeak: null, recordAt: null, lastPlayersAt: null, hoursUtc: [], weekUtc: [], peak24: null, days: [], outages: [] },
    })),
    history: { range, from: now - RANGES[range].spanMs, to: now, bucketMs: RANGES[range].bucketMs, points: [] },
  };
}

export async function buildStats(rangeKey) {
  const range = Object.hasOwn(RANGES, rangeKey) ? rangeKey : '24h';
  if (!storeKind()) return liveOnly(range);

  let state = await loadState();
  if (!state || Date.now() - state.lastT > STALE_MS) {
    try {
      state = (await collect()).state;
    } catch (err) {
      console.warn(`could not take a sample: ${err.message}`);
      state ??= newState();
    }
  }

  const now = Date.now();
  const { spanMs, bucketMs } = RANGES[range];
  const byHour = range === '30d' || range === 'all';
  // "All" starts where the data starts, not a year back.
  const from = range === 'all' ? Math.max(now - spanMs, Math.floor((state.since ?? now) / HOUR_MS) * HOUR_MS) : now - spanMs;
  const rawDays = byHour ? [] : daysBetween(from, now);
  const loadDays = range === 'all' ? 365 : ALL_TIME_DAYS;
  const hourDays = daysBetween(now - loadDays * DAY_MS, now).filter((day) => day !== state.today);
  const values = await mget([...rawDays.map(rawKey), ...hourDays.map(hoursKey)]);

  const hourly = new Map();
  hourDays.forEach((day, i) => {
    const saved = values[rawDays.length + i];
    if (saved) hourly.set(day, JSON.parse(saved));
  });
  if (state.today) hourly.set(state.today, state.hours);

  const { summaries, points } =
    byHour ? fromHours(hourly, from, now) : fromRaw(parseRaw(values.slice(0, rawDays.length), from), bucketMs);

  return {
    now,
    sampleSeconds: SAMPLE_MS / 1000,
    storage: true,
    since: state.since,
    checks: state.checks,
    servers: SERVERS.map((server, i) => {
      const all = state.all[server.id];
      const hoursUtc = Array.from({ length: 24 }, () => [0, 0]);
      for (const hours of hourly.values()) {
        for (const [hour, slot] of Object.entries(hours[server.code] ?? {})) {
          hoursUtc[hour][0] += slot[0];
          hoursUtc[hour][1] += slot[1];
        }
      }
      return {
        ...describe(server),
        community: communityOf(server, state),
        now: state.latest[server.id] ?? null,
        summary: finishSummary(summaries[i]),
        allTime: {
          recordPeak: all?.recordPeak ?? null,
          recordAt: all?.recordAt ?? null,
          lastPlayersAt: all?.lastPlayersAt ?? null,
          hoursUtc,
          weekUtc: weekOf(hourly, server.code),
          peak24: peak24Of(hourly, server.code, now),
          days: daysOf(hourly, server.code),
          outages: outagesOf(all, now),
        },
      };
    }),
    history: { range, from, to: now, bucketMs, points },
  };
}
