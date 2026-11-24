import { describe, expect, test } from "bun:test";
import { initialState, type Reading, step, type VerdictConfig, type VerdictState } from "./verdict";

const config: VerdictConfig = {
  enterRatio: 0.2,
  exitRatio: 0.1,
  enterDwellMin: 5,
  exitDwellMin: 10,
  enterReadings: 2,
  exitReadings: 3,
  enterMinDelaySec: 120,
  exitMaxDelaySec: 90,
  maxGapMin: 8,
};

const at = (minute: number) => new Date(Date.UTC(2026, 10, 23, 13, minute)).toISOString();
const reading = (minute: number, ratio: number): Reading => ({
  at: at(minute),
  staticDurationSec: 1000,
  durationSec: Math.round(1000 * (1 + ratio)),
  distanceMeters: 25829,
});

function run(ratios: Array<[number, number]>, start: VerdictState = initialState(at(0))) {
  let state = start;
  const flips: string[] = [];
  for (const [minute, ratio] of ratios) {
    const out = step(state, reading(minute, ratio), config);
    state = out.state;
    if (out.transition) flips.push(`${out.transition.to}@${minute}`);
  }
  return { state, flips };
}

describe("verdict state machine", () => {
  test("a single congested reading does not flip to no", () => {
    expect(run([[0, 0.5], [5, 0.0]]).flips).toEqual([]);
  });

  test("sustained congestion flips to no after the enter dwell", () => {
    expect(run([[0, 0.25], [5, 0.3], [10, 0.3]]).flips).toEqual(["no@5"]);
  });

  test("traffic between the thresholds keeps no and resets the exit timer", () => {
    const { state, flips } = run([
      [0, 0.3], [5, 0.3],
      [10, 0.05], [15, 0.15], [20, 0.05], [25, 0.05],
    ]);
    expect(flips).toEqual(["no@5"]);
    expect(state.answer).toBe("no");
  });

  test("clear traffic for the exit dwell flips back to yes", () => {
    const { flips } = run([
      [0, 0.3], [5, 0.3],
      [10, 0.05], [15, 0.05], [20, 0.05],
    ]);
    expect(flips).toEqual(["no@5", "yes@20"]);
  });

  test("a gap in readings restarts the dwell", () => {
    expect(run([[0, 0.3], [40, 0.3]]).flips).toEqual([]);
    expect(run([[0, 0.3], [40, 0.3], [45, 0.3]]).flips).toEqual(["no@45"]);
  });

  test("a big ratio on a short absolute delay does not flip", () => {
    const short = (minute: number): Reading => ({ at: at(minute), staticDurationSec: 300, durationSec: 390, distanceMeters: 1 });
    let state = initialState(at(0));
    for (const m of [0, 5, 10]) state = step(state, short(m), config).state;
    expect(state.answer).toBe("yes");
  });

  test("a day that never congests never flips", () => {
    const quiet = Array.from({ length: 36 }, (_, i) => [i * 5, 0.12] as [number, number]);
    expect(run(quiet).flips).toEqual([]);
  });
});
