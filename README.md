# Should I take the BA?

A live yes or no on whether to drive the Broken Arrow Expressway (OK-51) between downtown
Tulsa and Broken Arrow. It runs as one Cloudflare Worker.

Prototype: https://should-i-take-the-ba.samcarlton.workers.dev

## How it works

- A cron runs every 5 minutes. In Central time it decides which direction is due: 5 minutes for
  the rush direction (westbound 6:30–9:30 AM, eastbound 3:30–6:30 PM, weekdays), 30 minutes
  otherwise, hourly overnight. It asks the Google Routes API for the trip time with and without
  traffic. If the key is denied for Routes (HTTP 403), it falls back to Directions (Legacy), which
  still works for projects that had it enabled before October 2026.
- A SQLite Durable Object (`src/monitor.ts`) stores each direction's Yes/No verdict, when each
  check ran, and a posting ledger. It never stores a travel time: Google's terms bar caching route
  durations, so each reading is used once in memory and dropped. Visitors and images read
  the stored Yes/No and never call Google.
- `src/core/verdict.ts` is the state machine. It flips to No at 20% and 2 minutes of delay on two
  readings, and back to Yes at 10% or 90 seconds on three readings.
- During a rush window, a flip creates an event: No when a backup starts, Yes when it clears.
  `src/instagram.ts` publishes events through the Instagram API when `INSTAGRAM_MODE=live`.
  Otherwise it records them as `dry-run`.
- Share cards are 1080×1350 JPEGs. `scripts/build-cards.py` draws the backgrounds from Census
  road data; the Worker adds the live text with the Cloudflare Images binding.

## Surfaces

| Path | What |
| --- | --- |
| `/` | Answer page (`?direction=eastbound|westbound`); Markdown with `Accept: text/markdown` |
| `/about` | Method and recent answer changes |
| `/index.md`, `/llms.txt`, `/sitemap.xml` | Readable copies for search engines and AI that browse |
| `/card/latest.jpg`, `/cards/e/<id>.jpg`, `/card/sample.jpg?answer=no` | Share images |
| `/prompts/muse.md` | Instructions for Muse, from `prompts/muse.md` |

`/api/v1/status` and `/api/v1/events` stay for the page's own refresh and for Muse. They are not
linked or advertised, robots.txt disallows `/api/`, and responses carry `X-Robots-Tag: noindex`.
The MCP server and the agent setup page were removed on 2026-11-23; they are in git history
(commit 704fe90) if they come back.

## Setup

```sh
npm ci
npm test               # bun test
npm run typecheck
npx wrangler secret put GOOGLE_MAPS_API_KEY      # Routes API key
npx wrangler secret put ADMIN_TOKEN              # for POST /admin/poll
npm run deploy
```

Force a poll: `curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" "$ORIGIN/admin/poll?direction=eastbound"`.

To go live on Instagram, set `INSTAGRAM_USER_ID` and `INSTAGRAM_ACCESS_TOKEN` as secrets and change
`INSTAGRAM_MODE` to `live` in `wrangler.jsonc`. The account must be Business or Creator.

Tuning lives in `src/config.ts`: routes, rush windows, poll intervals and thresholds.

## Data and licences

- Traffic: Google Maps Platform Routes API. Google's terms restrict caching Routes results.
  Read the research memo before launch: `notes-search/docs/research/should-i-take-the-ba-cloudflare-2026-11-23.md`.
- Map: US Census Bureau TIGER/Line 2024 Oklahoma primary and secondary roads (CC0), extracted
  to `data/tulsa-roads.json`.
- Font: Noto Sans, SIL Open Font License (`public/fonts/OFL.txt`).

## Exceptions to scale-to-zero

The cron wakes the Worker every 5 minutes, all day, to decide whether anything is due. Most runs
exit without calling Google. Each costs a few milliseconds of CPU and fits the Workers free plan.
