import { type AdaptiveParams, type AdaptiveState, adaptiveAfter, adaptiveDue, idleAdaptive } from "./adaptive";
import type { DirectionId } from "../config";
import type { Level } from "./levels";
import { type Answer, initialState, step, type VerdictConfig, type VerdictState } from "./verdict";

// Replays a dense reference (one level every 5 minutes) through a candidate polling policy. The
// candidate only "sees" the reference at ticks where it would have called. Levels map one-to-one to
// the verdict's own thresholds, so the same hysteresis code runs on both timelines.

export type RefTick = { at: string; level: Level };
export type Policy = { name: string } & ({ kind: "dense" } | { kind: "adaptive"; params: AdaptiveParams });
export type TimelineTick = { at: string; ref: Answer; cand: Answer; called: boolean; refLevel: Level };

const SYNTHETIC: Record<Level, { durationSec: number; staticDurationSec: number }> = {
  clear: { durationSec: 1000, staticDurationSec: 1000 },
  slow: { durationSec: 1150, staticDurationSec: 1000 },
  jammed: { durationSec: 1600, staticDurationSec: 1000 },
};

const reading = (t: RefTick) => ({ at: t.at, distanceMeters: 25_800, ...SYNTHETIC[t.level] });

export function replay(ref: RefTick[], direction: DirectionId, policy: Policy, verdict: VerdictConfig): TimelineTick[] {
  if (ref.length === 0) return [];
  let refState: VerdictState = initialState(ref[0].at);
  let cand: VerdictState = initialState(ref[0].at);
  let adaptive: AdaptiveState = idleAdaptive();
  const out: TimelineTick[] = [];
  for (const tick of ref) {
    refState = step(refState, reading(tick), verdict).state;
    const due =
      policy.kind === "dense" || adaptiveDue(direction, new Date(tick.at), adaptive, cand.answer === "no", policy.params).due;
    if (due) {
      const before = cand.answer;
      cand = step(cand, reading(tick), verdict).state;
      if (policy.kind === "adaptive") {
        adaptive = adaptiveAfter(adaptive, new Date(tick.at), tick.level, cand.answer, before === "no" && cand.answer === "yes", policy.params);
      }
    }
    out.push({ at: tick.at, ref: refState.answer, cand: cand.answer, called: due, refLevel: tick.level });
  }
  return out;
}

type Run = { start: number; end: number };

function runs(ticks: TimelineTick[], pick: (t: TimelineTick) => boolean, minLen = 1): Run[] {
  const out: Run[] = [];
  let start = -1;
  ticks.forEach((t, i) => {
    if (pick(t) && start < 0) start = i;
    if ((!pick(t) || i === ticks.length - 1) && start >= 0) {
      const end = pick(t) ? i : i - 1;
      if (end - start + 1 >= minLen) out.push({ start, end });
      start = -1;
    }
  });
  return out;
}

const minutes = (ticks: TimelineTick[], a: number, b: number) => (Date.parse(ticks[b].at) - Date.parse(ticks[a].at)) / 60_000;

export type Score = {
  calls: number;
  ticks: number;
  refEvents: number;
  matched: number;
  onsetLagMin: number[];
  clearLagMin: number[];
  staleYesMin: number;
  falseNoMin: number;
  slowdowns: number;
  slowdownsSeen: number;
};

/** Event and minute metrics for one replayed window (candidate vs the dense reference). */
export function score(ticks: TimelineTick[], tickMin = 5): Score {
  const refRuns = runs(ticks, (t) => t.ref === "no");
  const candRuns = runs(ticks, (t) => t.cand === "no");
  const onset: number[] = [];
  const clear: number[] = [];
  let matched = 0;
  for (const r of refRuns) {
    const c = candRuns.find((c) => c.start <= r.end && c.end >= r.start);
    if (!c) continue;
    matched++;
    onset.push(minutes(ticks, r.start, c.start));
    // Clearance lag only when both ends are inside the window.
    if (r.end < ticks.length - 1 && c.end < ticks.length - 1) clear.push(minutes(ticks, r.end, c.end));
  }
  const slow = runs(ticks, (t) => t.refLevel !== "clear", 2);
  return {
    calls: ticks.filter((t) => t.called).length,
    ticks: ticks.length,
    refEvents: refRuns.length,
    matched,
    onsetLagMin: onset,
    clearLagMin: clear,
    staleYesMin: ticks.filter((t) => t.ref === "no" && t.cand === "yes").length * tickMin,
    falseNoMin: ticks.filter((t) => t.ref === "yes" && t.cand === "no").length * tickMin,
    slowdowns: slow.length,
    slowdownsSeen: slow.filter((r) => ticks.slice(r.start, r.end + 1).some((t) => t.called)).length,
  };
}

export function combine(scores: Score[]): Score {
  return scores.reduce(
    (a, s) => ({
      calls: a.calls + s.calls,
      ticks: a.ticks + s.ticks,
      refEvents: a.refEvents + s.refEvents,
      matched: a.matched + s.matched,
      onsetLagMin: [...a.onsetLagMin, ...s.onsetLagMin],
      clearLagMin: [...a.clearLagMin, ...s.clearLagMin],
      staleYesMin: a.staleYesMin + s.staleYesMin,
      falseNoMin: a.falseNoMin + s.falseNoMin,
      slowdowns: a.slowdowns + s.slowdowns,
      slowdownsSeen: a.slowdownsSeen + s.slowdownsSeen,
    }),
    { calls: 0, ticks: 0, refEvents: 0, matched: 0, onsetLagMin: [], clearLagMin: [], staleYesMin: 0, falseNoMin: 0, slowdowns: 0, slowdownsSeen: 0 },
  );
}

export const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

/** Gates from docs/polling-accuracy.md. Provisional until there are enough held-out jams. */
export function gates(s: Score, totalMin: number) {
  const recall = s.refEvents ? s.matched / s.refEvents : null;
  const within10 = s.refEvents ? s.onsetLagMin.filter((m) => m <= 10).length / s.refEvents : null;
  const p90Clear = percentile(s.clearLagMin.map((m) => Math.max(0, m)), 90);
  const stale = totalMin ? s.staleYesMin / totalMin : 0;
  return {
    recall,
    within10,
    p90Clear,
    staleShare: stale,
    pass: recall !== null && recall >= 0.95 && (within10 ?? 0) >= 0.9 && (p90Clear ?? 0) <= 10 && stale <= 0.01,
    enoughEvents: s.refEvents >= 30,
  };
}
