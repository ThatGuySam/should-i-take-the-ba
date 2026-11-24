import { describe, expect, test } from "bun:test";
import { activeWindow, isDue, localTime } from "./schedule";

const central = (iso: string) => new Date(iso);

describe("schedule", () => {
  test("converts to Central time across daylight saving", () => {
    expect(localTime(central("2026-11-23T13:00:00Z")).minuteOfDay).toBe(7 * 60);
    expect(localTime(central("2026-07-13T12:00:00Z")).minuteOfDay).toBe(7 * 60);
  });

  test("weekday morning window is westbound", () => {
    expect(activeWindow(localTime(central("2026-11-23T13:00:00Z")))?.direction).toBe("westbound");
  });

  test("weekends have no rush window", () => {
    expect(activeWindow(localTime(central("2026-11-22T13:00:00Z")))).toBeNull();
  });

  test("rush direction polls every five minutes, the other every two hours", () => {
    const ticks = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, 10, 23, 13, i * 5)));
    expect(ticks.filter((t) => isDue("westbound", t, false)).length).toBe(24);
    expect(ticks.filter((t) => isDue("eastbound", t, false)).length).toBe(1);
  });

  test("an open episode keeps five-minute polling after the window ends", () => {
    const afterWindow = new Date(Date.UTC(2026, 10, 23, 15, 40));
    expect(isDue("westbound", afterWindow, false)).toBe(false);
    expect(isDue("westbound", afterWindow, true)).toBe(true);
  });

  test("overnight polls every three hours", () => {
    const ticks = Array.from({ length: 36 }, (_, i) => new Date(Date.UTC(2026, 10, 24, 7, i * 5)));
    expect(ticks.filter((t) => isDue("eastbound", t, false)).length).toBe(1);
  });
});
