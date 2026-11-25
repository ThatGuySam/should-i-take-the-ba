import { describe, expect, test } from "bun:test";
import { POSTING, RUSH_WINDOWS } from "../config";
import { type CheckRow, clearEstimate, pastEpisodes } from "./estimate";

const evening = RUSH_WINDOWS.find((w) => w.id === "evening")!;
const cfg = POSTING.estimate;

/** One weekday evening: checks every 5 min from 15:30 Central, No from `startMin` for `durMin`. */
function day(date: number, startMin: number, durMin: number, gapAt?: number): CheckRow[] {
  const rows: CheckRow[] = [];
  for (let m = 0; m <= 180; m += 5) {
    if (gapAt !== undefined && m > gapAt && m < gapAt + 30) continue;
    const at = new Date(Date.UTC(2026, 10, date, 21, 30 + m)).toISOString();
    rows.push({ at, ok: 1, answer: m >= startMin && m < startMin + durMin ? "no" : "yes" });
  }
  return rows;
}

// Weekdays in Nov 2026: 2-6, 9-13, 16-20.
const WEEKDAYS = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13];

describe("clear estimate", () => {
  test("measures each run from first No to first Yes", () => {
    expect(pastEpisodes(day(2, 30, 40), evening, cfg)).toEqual([40]);
  });

  test("needs at least 8 past episodes", () => {
    const rows = WEEKDAYS.slice(0, 7).flatMap((d) => day(d, 30, 40));
    expect(clearEstimate(rows, evening, cfg)).toBeNull();
  });

  test("p90 rounded up to the next 15 minutes", () => {
    const durations = [20, 25, 30, 30, 35, 40, 45, 50, 55, 70];
    const rows = WEEKDAYS.flatMap((d, i) => day(d, 30, durations[i]));
    // p90 of 10 values is the 9th (55) → 60.
    expect(clearEstimate(rows, evening, cfg)).toEqual({ episodes: 10, withinMin: 60 });
  });

  test("an exact multiple of 15 is kept", () => {
    const rows = WEEKDAYS.flatMap((d) => day(d, 30, 45));
    expect(clearEstimate(rows, evening, cfg)?.withinMin).toBe(45);
  });

  test("runs with a data gap, unknown answers or no end are left out", () => {
    expect(pastEpisodes(day(2, 30, 60, 40), evening, cfg)).toEqual([]);
    const unknown = day(3, 30, 40).map((r, i) => (i === 8 ? { ...r, answer: null } : r));
    expect(pastEpisodes(unknown, evening, cfg)).toEqual([]);
    expect(pastEpisodes(day(4, 150, 60), evening, cfg)).toEqual([]);
  });

  test("weekends and runs starting outside the window are ignored", () => {
    expect(pastEpisodes(day(7, 30, 40), evening, cfg)).toEqual([]);
    const early = day(2, 0, 40).map((r) => ({ ...r, at: new Date(Date.parse(r.at) - 3 * 3_600_000).toISOString() }));
    expect(pastEpisodes(early, evening, cfg)).toEqual([]);
  });

  test("failed checks are skipped, not counted as Yes", () => {
    const rows = day(2, 30, 40).map((r, i) => (i === 9 ? { ...r, ok: 0, answer: null } : r));
    expect(pastEpisodes(rows, evening, cfg)).toEqual([40]);
  });
});
