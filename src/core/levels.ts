import type { VerdictConfig } from "./verdict";

export type Level = "clear" | "slow" | "jammed";

type Timing = { durationSec: number; staticDurationSec: number };

/** Whole-route level: jammed at the No threshold, slow at the Yes-exit threshold. */
export function routeLevel(r: Timing, v: VerdictConfig): Level {
  const delay = r.durationSec - r.staticDurationSec;
  const ratio = r.staticDurationSec > 0 ? delay / r.staticDurationSec : 0;
  if (ratio >= v.enterRatio && delay >= v.enterMinDelaySec) return "jammed";
  if (ratio > v.exitRatio && delay > v.exitMaxDelaySec) return "slow";
  return "clear";
}

export function stretchLevel(r: Timing, t: { slowRatio: number; slowMinSec: number; jamRatio: number; jamMinSec: number }): Level {
  const delay = r.durationSec - r.staticDurationSec;
  const ratio = r.staticDurationSec > 0 ? delay / r.staticDurationSec : 0;
  if (ratio >= t.jamRatio && delay >= t.jamMinSec) return "jammed";
  if (ratio >= t.slowRatio && delay >= t.slowMinSec) return "slow";
  return "clear";
}

const CODE: Record<Level, string> = { clear: "c", slow: "s", jammed: "j" };
const FROM: Record<string, Level> = { c: "clear", s: "slow", j: "jammed" };
export const encodeLevels = (levels: Level[]) => levels.map((l) => CODE[l]).join("");
export const decodeLevels = (s: string | null | undefined): Level[] | null =>
  s ? [...s].map((c) => FROM[c] ?? "clear") : null;
