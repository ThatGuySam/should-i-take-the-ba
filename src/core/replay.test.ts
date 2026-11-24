import { describe, expect, test } from "bun:test";
import { ADAPTIVE, VERDICT } from "../config";
import { adaptiveAfter, adaptiveDue, auditWeekday, idleAdaptive, planCheck } from "./adaptive";
import type { Level } from "./levels";
import { type RefTick, replay, score } from "./replay";

// Monday 2026-11-23, westbound morning window 6:30-9:30 Central = 12:30-15:30 UTC.
const START = Date.UTC(2026, 10, 23, 12, 30);
const window = (levels: Level[]): RefTick[] =>
  levels.map((level, i) => ({ at: new Date(START + i * 300_000).toISOString(), level }));
const pattern = (spec: [Level, number][]) => spec.flatMap(([l, n]) => Array<Level>(n).fill(l));
const adaptive = { name: "adaptive", kind: "adaptive" as const, params: ADAPTIVE };
const dense = { name: "dense", kind: "dense" as const };

describe("replay", () => {
  test("dense replay reproduces the reference exactly", () => {
    const ref = window(pattern([["clear", 6], ["jammed", 8], ["slow", 2], ["clear", 20]]));
    const s = score(replay(ref, "westbound", dense, VERDICT));
    expect(s.refEvents).toBe(1);
    expect(s.matched).toBe(1);
    expect(s.staleYesMin).toBe(0);
    expect(s.falseNoMin).toBe(0);
    expect(s.calls).toBe(36);
  });

  test("adaptive catches a 40-minute jam within 10 minutes and spends fewer calls", () => {
    const ref = window(pattern([["clear", 7], ["jammed", 8], ["clear", 21]]));
    const s = score(replay(ref, "westbound", adaptive, VERDICT));
    expect(s.matched).toBe(1);
    expect(s.onsetLagMin[0]).toBeLessThanOrEqual(10);
    expect(s.calls).toBeLessThan(36);
  });

  test("a single slow reading starts fast checks without flipping the answer", () => {
    const ref = window(pattern([["clear", 4], ["slow", 1], ["clear", 31]]));
    const t = replay(ref, "westbound", adaptive, VERDICT);
    expect(t.every((x) => x.cand === "yes")).toBe(true);
    expect(t.slice(4, 8).filter((x) => x.called).length).toBeGreaterThanOrEqual(3);
  });

  test("a relapse right after clearing is caught during the hold", () => {
    const ref = window(pattern([["clear", 2], ["jammed", 6], ["clear", 4], ["jammed", 6], ["clear", 18]]));
    const s = score(replay(ref, "westbound", adaptive, VERDICT));
    expect(s.matched).toBe(s.refEvents);
  });
});

describe("adaptive policy", () => {
  test("quiet rush checks every 10 minutes and always checks the last slot", () => {
    const ticks = Array.from({ length: 36 }, (_, i) => new Date(START + i * 300_000));
    const due = ticks.filter((t) => adaptiveDue("westbound", t, idleAdaptive(), false, ADAPTIVE).due);
    expect(due.length).toBe(19);
    expect(adaptiveDue("westbound", ticks[35], idleAdaptive(), false, ADAPTIVE).due).toBe(true);
  });

  test("release steps follow the end of the fast window", () => {
    const at = new Date(START);
    const s = adaptiveAfter(idleAdaptive(), at, "clear", "yes", true, ADAPTIVE);
    expect(s.fastUntil).toBe(new Date(START + 15 * 60_000).toISOString());
    expect(s.release).toEqual([new Date(START + 25 * 60_000).toISOString(), new Date(START + 45 * 60_000).toISOString()]);
  });

  test("audit weekday is a stable weekday for the whole ISO week", () => {
    const days = ["2026-11-23", "2026-11-24", "2026-11-27", "2026-11-29"].map(auditWeekday);
    expect(new Set(days).size).toBe(1);
    expect(days[0]).toBeGreaterThanOrEqual(1);
    expect(days[0]).toBeLessThanOrEqual(5);
  });

  test("dense mode keeps today's schedule outside audit windows", () => {
    const sunday = new Date(Date.UTC(2026, 10, 22, 13, 5));
    expect(planCheck("westbound", sunday, { open: false, state: idleAdaptive(), mode: "dense" }).due).toBe(false);
    expect(planCheck("westbound", sunday, { open: true, state: idleAdaptive(), mode: "dense" }).reason).toBe("fast");
  });
});
