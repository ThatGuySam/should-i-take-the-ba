# Polling accuracy: how adaptive polling gets tested and tuned

Updated 2026-11-24. Research behind this: notes-search
`docs/research/should-i-take-the-ba-cloudflare-2026-11-23.md`, rounds 7 and 8.

## The question

Adaptive polling checks less often when the BA is quiet and every 5 minutes once it slows. The risk is
seeing a jam late, or showing Yes after a jam has formed. This setup measures that risk before the
adaptive policy goes live, and keeps measuring it afterward.

## Two separate checks

1. **Scheduling loss: adaptive compared with dense Google checks.** Production records a check every
   5 minutes through each rush window (`POLICY.mode = "dense"`). `scripts/replay.ts` replays those
   checks through each candidate setting. A candidate sees a reading only at the ticks where it would
   have called. Both timelines run through the real verdict code, so any difference comes from timing
   alone.
2. **Provider accuracy: Google compared with the road.** This needs an independent reference:
   - ODOT radar stations 811025 and 811104 near E 129th (ask ODOT).
   - FHWA NPMRDS travel times (ask INCOG to run a matched comparison).
   - Camera spot checks during audit windows.
   Until one of those exists, this check is not done. Say so in any accuracy claim.

## What each check records

Table `checks`, kept 400 days, with these columns:
- `at`: time of the check
- `direction`
- `ok`: whether it worked; `error` holds a fixed code when it failed
- `provider`
- `level`: clear, slow or jammed for the whole route
- `stretch_levels`: the same level for each of the five stretches
- `reason`: why the check ran (`rush`, `routine`, `fast`, `release`, `audit` or `manual`)
- `answer`: the public verdict after the check
- `policy`: which policy version ran it

No travel times are stored. See `/admin/history?days=N` (bearer `ADMIN_TOKEN`).

## Audit days

One weekday per ISO week, picked by hashing the week (`auditWeekday`), runs dense checks:
- westbound 6:00–10:00
- eastbound 15:00–19:00

That is 30 minutes of padding on each side of the rush window, so jams at the edges are seen. This
costs about 24 extra calls a week while production is dense. After the adaptive policy launches,
audit days are the only dense reference, so keep them.

## Gates (provisional)

Gates are measured against dense Google on held-out weeks:
- at least 95% of jams caught
- at least 90% of jams caught within 10 minutes
- clearance lag p90 of 10 minutes or less
- stale Yes in no more than 1% of covered minutes
- a rush-hour call count that fits the 2,500 monthly cap with room for bypass checks

A pass counts only with at least 30 jams in the reference. Zero misses out of 30 still allows a true
miss rate of about 10%; 60 jams bring that to about 5%.

## Loop

1. **Weekly:** run `npm run replay -- --days 28 --out reports/$(date +%F).md`. Look at misses, early
   clears and stale Yes. Commit the report.
2. **Tune on earlier weeks, judge once on later ones:** run `--holdout 7` or `--holdout 14`. Pick a
   setting on the training weeks, then read the holdout table once.
3. **Change one setting per release** (`ADAPTIVE` in `src/config.ts`), and only when it passes the
   gates and does one of these:
   - improves onset p90 by 5 minutes or more at the same cost
   - uses 10% fewer calls with the same timing
4. **Go live:** set `POLICY.mode = "adaptive"` and bump `POLICY.version`. Keep the audit days.
5. **Revert** if the weekly replay of audit days fails a gate, or after a sustained miss.
6. **Re-check** after these events:
   - a school-term change
   - major roadwork
   - a provider or route change
   - two weeks of drift
   Tag holidays and severe weather instead of tuning to them.

## Limits

- The three levels fix the thresholds. Replay cannot answer "what if slow meant 25%". That needs
  licensed independent travel times.
- Google's terms do not expressly allow keeping derived levels as a replay archive. This is a gray
  area the owner has accepted for now.
- The week of 2026-11-24 is Thanksgiving week. Expect few jams. Plan on 6–8 weeks before the first
  real decision.
