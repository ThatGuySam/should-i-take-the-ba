import { type DirectionId, POLL, RUSH_WINDOWS, type RushWindow, TIME_ZONE } from "../config";

export type LocalTime = { weekday: number; minuteOfDay: number; date: string };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localTime(at: Date, timeZone = TIME_ZONE): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: WEEKDAYS[parts.weekday],
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function activeWindow(t: LocalTime): RushWindow | null {
  if (t.weekday === 0 || t.weekday === 6) return null;
  return RUSH_WINDOWS.find((w) => t.minuteOfDay >= w.startMin && t.minuteOfDay < w.endMin) ?? null;
}

export function intervalFor(direction: DirectionId, t: LocalTime, episodeOpen: boolean): number {
  const window = activeWindow(t);
  if (episodeOpen || window?.direction === direction) return POLL.rushMin;
  const hour = Math.floor(t.minuteOfDay / 60);
  const overnight = hour >= POLL.overnightStartHour || hour < POLL.overnightEndHour;
  return overnight ? POLL.overnightMin : POLL.shoulderMin;
}

export function isDue(direction: DirectionId, at: Date, episodeOpen: boolean): boolean {
  const t = localTime(at);
  const interval = intervalFor(direction, t, episodeOpen);
  return Math.floor(t.minuteOfDay) % interval < POLL.rushMin;
}
