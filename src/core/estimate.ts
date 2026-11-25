import type { POSTING, RushWindow } from "../config";
import { percentile } from "./replay";
import { localTime } from "./schedule";

export type EstimateConfig = (typeof POSTING)["estimate"];
export type CheckRow = { at: string; ok: number; answer: string | null };
export type Estimate = { episodes: number; withinMin: number };

const SKIP = "skip";

/**
 * Past jams in one rush window: runs of answer='no' checks that start inside the window on a
 * weekday, from the first No check to the first Yes check after it. A run with a gap longer than
 * maxGapMin, an unknown answer, or no recorded end is left out rather than guessed.
 */
export function pastEpisodes(rows: CheckRow[], window: RushWindow, cfg: EstimateConfig): number[] {
  const out: number[] = [];
  let start: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    if (!r.ok) continue;
    // A gap inside a run hides when it really started or ended, so the rest of that run is skipped.
    if (start && last && (Date.parse(r.at) - Date.parse(last)) / 60_000 > cfg.maxGapMin) start = SKIP;
    last = r.at;
    if (r.answer === "no") {
      if (start === null) {
        const t = localTime(new Date(r.at));
        const inWindow = t.weekday >= 1 && t.weekday <= 5 && t.minuteOfDay >= window.startMin && t.minuteOfDay < window.endMin;
        // A No that starts outside the window is skipped, along with the rest of its run.
        start = inWindow ? r.at : SKIP;
      }
    } else if (r.answer === "yes") {
      if (start && start !== SKIP) out.push((Date.parse(r.at) - Date.parse(start)) / 60_000);
      start = null;
    } else if (start) start = SKIP;
  }
  return out;
}

/** "Usually clears within" from history: p90 rounded up to the next 15 minutes, or null with too few jams. */
export function clearEstimate(rows: CheckRow[], window: RushWindow, cfg: EstimateConfig): Estimate | null {
  const durations = pastEpisodes(rows, window, cfg);
  if (durations.length < cfg.minEpisodes) return null;
  const p = percentile(durations, cfg.percentile) as number;
  return { episodes: durations.length, withinMin: Math.max(cfg.roundUpMin, Math.ceil(p / cfg.roundUpMin) * cfg.roundUpMin) };
}
