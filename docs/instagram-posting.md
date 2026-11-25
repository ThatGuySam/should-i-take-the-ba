# Instagram posting

Updated 2026-11-24. The Worker decides what to post. A small runner on Sam's Linux machine writes
the caption and publishes. Code: `src/core/posting.ts`, `src/core/estimate.ts`,
`src/core/caption.ts`, `scripts/ig-runner.ts`. Numbers live in `POSTING` in `src/config.ts`.

## Rules

An episode is one rush window in its own direction on one weekday: westbound in the morning,
eastbound in the evening.

- **One No, one Yes.** An episode posts at most one No (the first confirmed No) and at most one
  Yes. The ids are fixed (`<date>-<window>-<direction>-no` / `-yes`), so a repeat can't make a
  second post. Once the Yes exists, the episode is closed and later flips in that window post nothing
  (logged as `repeat-no-ignored`).
- **The Yes waits until the rush has really ended.** At the first flip back to Yes the Worker
  starts a hold (`yes-held`). The Yes is created once Yes has held for `settleMin` (20 min) or the
  rush window has ended, whichever comes first. If the answer turns No during the hold, the hold is
  cancelled (`yes-cancelled`) and the episode stays open. A jam that outlasts the window gets its Yes
  at the first Yes reading after the window.
- **No jam, no posts.** A Yes is created only after a No that was posted (or dry-run). If the No
  never went out (stale, failed, or still pending), the episode closes with no Yes
  (`closed-no-unposted`), and a pending No is marked `superseded`.
- **Caps, in every mode:**
  - at most 4 posts in any 24 hours;
  - posts only on weekdays, 6 AM to 8 PM Central;
  - an event more than 30 min old when it would be published is marked `stale` and dropped, never
    posted late.
- **Stuck guard.** An episode still open 6 hours after its No closes without a Yes (`closed-expired`).

Every hold, cancel and close is a row in the `post_log` table: `GET /admin/posts/log`.

### "Usually clears within"

A No event stores an estimate from the `checks` table, computed when the No is created:
- same direction and rush window, last 90 days, weekdays;
- a past jam is a run of `answer = 'no'` checks, from the first No check to the first Yes check
  after it. Runs with a data gap over 20 min, an unknown answer or no end are left out;
- at least 8 past jams, otherwise the estimate is null and the caption makes no time promise;
- the 90th percentile, rounded up to the next 15 min. This leans long on purpose.

## Modes (`INSTAGRAM_MODE` in `wrangler.jsonc`)

- `dry-run` (current): the Worker applies the rules and caps and marks events `dry-run` with the
  template caption. Nothing is posted.
- `local`: the Worker records events and never publishes. The runner below posts them.
- `live`: the Worker posts by itself with the template caption (no Sonnet). Kept as a fallback.

Event statuses: `pending`, `claimed`, `container`, `published`, `dry-run`, `stale`,
`superseded`, `failed`, `held`.

## The runner

`bun scripts/ig-runner.ts [--dry-run] [--once] [--origin URL]` (or `bun run ig`).

Each run:
1. Stops at once if the pause file exists.
2. `GET /admin/posts/next`. With nothing waiting, it exits. That is the only request, and Claude is
   not called.
3. `POST /admin/posts/:id/claim`. A claim lasts 10 min, so a crashed run is picked up again.
4. Reconciles first if the event already has a container: `PUBLISHED` is reported as published
   (the media id is looked up by caption) and never posted again; `FINISHED` is published; `ERROR` or
   `EXPIRED` starts a new container.
5. Drafts a caption: `claude -p --model sonnet` with `prompts/caption.md` and the facts JSON, 60 s
   timeout, no tools.
6. Validates the draft (`validateCaption`): under 600 characters; contains the detected time; every
   `H:MM`, bare "7 PM", "N min" and "N hours" comes from the facts; both fixed lines present; at most 2
   hashtags and 2 emoji; no promises; no "usually"/"typically" without an estimate. If the draft fails,
   or Claude errors or times out, the template caption is used.
7. Checks that the card URL returns a JPEG, then posts with the Graph API (graph.instagram.com:
   container, status, publish) using `image_url` = `/cards/e/<id>.jpg`.
8. Reports with `POST /admin/posts/:id/result` (`{status, containerId?, mediaId?, error?, caption?}`).
   The caption used then shows in `/api/v1/events` (`captionPosted: true`).

Errors: network, 5xx and rate limits release the event for the next run (stale events drop out on
their own). Graph codes 190, 10, 200–299, 368, a 401/403, or messages about spam, policy or
restrictions write the pause file and stop.

Without a token file, the runner runs as `--dry-run`: it drafts, prints and reports `dry-run`. If the
Worker is not in `local` mode, a dry run only previews the caption and claims nothing, so it can't
take an event away from the Worker.

### Files on this machine (never committed)

- `.dev.vars` in the repo: `ADMIN_TOKEN=...` (same as `scripts/replay.ts`).
- `~/.config/should-i-take-the-ba/instagram.json`, mode 600:
  ```json
  { "userId": "1784...", "accessToken": "IGAA...", "issuedAt": "2026-11-24T18:00:00Z" }
  ```
  The runner refreshes the long-lived token once it is 30 days old
  (`GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`) and rewrites
  the file with `issuedAt` and `expiresAt`. If refresh keeps failing it warns at 14 and 7 days left.
- `~/.config/should-i-take-the-ba/PAUSED`: the pause flag. Set `BA_IG_DIR` to use another folder.

## Pause and resume

- Pause by hand: `echo "reason" > ~/.config/should-i-take-the-ba/PAUSED`.
- The runner pauses itself on auth or policy errors and prints why. `systemctl --user status
  should-i-take-the-ba-ig` shows the unit as failed while paused (exit 2).
- Resume: fix the cause (new token, check the account in the Instagram app), then
  `rm ~/.config/should-i-take-the-ba/PAUSED`. Events that waited more than 30 min are dropped as
  stale, so nothing old goes out.
- Stop all posting from the Worker side: set `INSTAGRAM_MODE` back to `dry-run` and deploy.

## Captions

- Sonnet drafts each caption from `prompts/caption.md` (Sam edits that file) plus the facts from
  `/admin/posts/next`: answer, direction, from/to, detected time, the No time and jam length for a
  Yes, the estimate or null, affected stretches, card URL, template caption and alt text.
- The template caption (`templateCaption` in `src/core/caption.ts`) is the fallback and is what
  `dry-run` and `live` modes use.
- Every caption ends with "Live answer: shoulditaketheba.com" and "Automated traffic update."

## Setup checklist

1. The Instagram account is a Professional account (Business or Creator).
2. A Meta app with the **Instagram API with Instagram Login** product, permissions
   `instagram_business_basic` and `instagram_business_content_publish`.
3. Generate a long-lived token for the account (app dashboard, Instagram > API setup) and note the
   Instagram user id. Write `instagram.json` as above, `chmod 600`.
4. Put the app in **Live** mode (needs a privacy policy URL; content publishing for your own account
   works without App Review only while the account has a role on the app, so check which applies).
5. Set `INSTAGRAM_MODE` to `local` and deploy (Sam decides when).
6. Make one test post: wait for a real event, or run `bun scripts/ig-runner.ts --once` when one is
   pending. Check it on the account.
7. Check the post from a viewer with **no role on the app** (logged out, or another account). Posts
   made while the app is in Development mode can be invisible to them.
8. Install the timer (below).

## Install the timer (after review)

```sh
mkdir -p ~/.config/systemd/user
cp ops/systemd/should-i-take-the-ba-ig.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start should-i-take-the-ba-ig.service   # one run now; check the log
journalctl --user -u should-i-take-the-ba-ig -n 50
systemctl --user enable --now should-i-take-the-ba-ig.timer
```

The timer runs every 2 minutes, Monday to Friday, 6:00 to 19:58 Central, with `Nice=10` and idle
I/O. The service expects the repo at `~/Code/should-i-take-the-ba` and bun and claude on the mise
shims path; edit the unit if not. `claude -p` uses this machine's Claude login. To stop:
`systemctl --user disable --now should-i-take-the-ba-ig.timer`.
