# MxO stats

A fan-made page that shows how many people are playing on the fan-run Matrix Online servers: Rejacked, MxO Revived and MxOEmu.

Live at https://whoisjackedin.com

## What it shows

- Who is online right now, per server and in total, next to the 24-hour peak and the all-time peak
- A ranking by players and by uptime
- A chart of players over time, as lines or stacked. It shows averages, so the lines stay calm. Point at it to read the numbers next to the names, drag across it to zoom in for more detail
- The most players seen each day
- A table per server, by day or by month, with the peak, the average and how much each changed. Click a heading to sort
- A weekly pattern: which weekdays and hours are busy
- A 90-day strip that shows how much each server was online
- The busiest hours of the day
- Past outages
- A short description of each server

The page calls players "operatives", as the game did.

## Where the numbers come from

Each server has a small public status page that its own website or launcher reads. This page reads the same thing once a minute.

| Server | Address | What it tells us |
|---|---|---|
| Rejacked | `https://mxo-rejacked.com/api/launcher/v1` | online or not, player count, launcher version |
| MxO Revived | `https://mxorevived.com/api/server-status` | status, player count |
| MxOEmu | `https://mxoemu.info/api/servers` | status, player count, players by district |

The Discord member counts come from each Discord's public invite link, once an hour.

## How it decides a server is down

- One odd answer is not enough. The page shows the last known number and checks again.
- Three failed checks in a row count as an outage.
- An "asked too often" reply is ignored.
- If a reading is missing, the last real one is used for up to five minutes.
- If the page cannot refresh, it keeps showing the last data and says from when it is.

## How it runs

The site is on Vercel's free plan.

- The page is `src/index.html` and `src/app.js`. The charts are drawn with Apache ECharts. `npm run build` packs both into `public/`, small and with no source maps.
- Days are counted in the visitor's own time zone, to the nearest hour.
- `api/stats` gives the page its numbers.
- `api/collect` takes one reading of all three servers.
- Readings are saved in an Upstash Redis database on its free plan.
- A free cron service calls `api/collect` every minute. Vercel's free plan can only do that once a day by itself.

## Set it up yourself

1. Deploy it: `vercel deploy --prod`
2. Add storage: in the Vercel dashboard, add an Upstash Redis database to the project, then deploy again.
3. Set a secret: add `CRON_SECRET` to the project, with a long random text as its value.
4. Add the cron job: at a service such as cron-job.org, call `https://<your-site>/api/collect` every minute with the header `Authorization: Bearer <CRON_SECRET>`.

Without storage the page still works. It shows live numbers and no history.

## Run it on your own computer

```sh
npm start
```

Run `npm install` once before the first start. Then open http://127.0.0.1:5177. It needs Node 26. Readings are saved in files under `data/kv`.

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `5177` | Port of the page |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to open it to your network |
| `MXO_DATA_DIR` | `./data/kv` | Where the readings are saved |

## What is saved

- Every reading, kept for 9 days. This feeds the 1 hour, 24 hour and 7 day views. After that only the hourly totals remain.
- Hourly totals, kept for good. They are tiny, about half a megabyte a year. This feeds the 30 day and "All" views, the day-by-day numbers, the weekly pattern, the busiest hours and the uptime strip.
- The latest answers, the records and the outage list.

## Files

- `lib/sources.js`: the three servers, how to read each one, and their descriptions
- `lib/store.js`: saving and loading, in Redis on Vercel and in files on your computer
- `lib/core.js`: taking readings and working out the numbers
- `api/`: the two addresses the site answers on
- `src/`: the page and its script
- `build.mjs`: packs the page into `public/`
- `src/icons/`: ten small icons from the game client, used on the headings. They belong to the game's owners
- `server.js`: runs the site on your own computer

## Server descriptions

The texts in "The servers" section are in `lib/sources.js`. They were written from each team's own posts in November 2026. Change them by hand when something changes.
