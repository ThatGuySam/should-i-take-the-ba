import { ADAPTIVE, AUDIT, type DirectionId, POLICY, POLL, RUSH_WINDOWS } from "../config";
import type { Level } from "./levels";
import { activeWindow, isDue, type LocalTime, localTime } from "./schedule";
import type { Answer } from "./verdict";

export type AdaptiveParams = typeof ADAPTIVE;
export type AdaptiveState = { fastUntil: string | null; release: string[] };
export type Reason = "routine" | "rush" | "fast" | "release" | "audit";
export type Plan = { due: boolean; reason: Reason };

export const idleAdaptive = (): AdaptiveState => ({ fastUntil: null, release: [] });

const TICK = POLL.rushMin;
const onGrid = (t: LocalTime, every: number) => t.minuteOfDay % every < TICK;
const addMin = (at: Date, min: number) => new Date(at.getTime() + min * 60_000).toISOString();

/** Off-peak cadence, shared by every policy. */
function routine(t: LocalTime): number {
  const hour = Math.floor(t.minuteOfDay / 60);
  return hour >= POLL.overnightStartHour || hour < POLL.overnightEndHour ? POLL.overnightMin : POLL.shoulderMin;
}

/** Audit day for an ISO week: a fixed weekday picked by hashing the week, decided before any traffic. */
export function auditWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - day * 86_400_000).toISOString().slice(0, 10);
  let h = 2166136261;
  for (const c of `ba-audit:${monday}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return 1 + (h % 5);
}

export function inAuditWindow(direction: DirectionId, t: LocalTime): boolean {
  if (t.weekday !== auditWeekday(t.date)) return false;
  return RUSH_WINDOWS.some(
    (w) => w.direction === direction && t.minuteOfDay >= w.startMin - AUDIT.padMin && t.minuteOfDay < w.endMin + AUDIT.padMin,
  );
}

/** Adaptive schedule for one direction at one 5-minute tick. */
export function adaptiveDue(direction: DirectionId, at: Date, s: AdaptiveState, forceFast: boolean, p: AdaptiveParams): Plan {
  const t = localTime(at);
  if (forceFast || (s.fastUntil && at.getTime() < Date.parse(s.fastUntil))) return { due: onGrid(t, p.fastMin), reason: "fast" };
  if (s.release.some((r) => Date.parse(r) <= at.getTime())) return { due: true, reason: "release" };
  const window = activeWindow(t);
  if (window?.direction === direction) {
    const closing = t.minuteOfDay >= window.endMin - TICK;
    return { due: closing || onGrid(t, p.quietRushMin), reason: "rush" };
  }
  return { due: onGrid(t, routine(t)), reason: "routine" };
}

/** Update the adaptive state after a successful check. */
export function adaptiveAfter(s: AdaptiveState, at: Date, level: Level, answer: Answer, justCleared: boolean, p: AdaptiveParams): AdaptiveState {
  const now = at.getTime();
  let until = s.fastUntil && Date.parse(s.fastUntil) > now ? Date.parse(s.fastUntil) : 0;
  if (level !== "clear") until = Math.max(until, now + p.watchMin * 60_000);
  if (answer === "no") until = Math.max(until, now + p.fastMin * 60_000);
  if (justCleared) until = Math.max(until, now + p.holdMin * 60_000);
  if (until > now) {
    const end = new Date(until);
    let offset = 0;
    const release = p.release.map((m) => addMin(end, (offset += m)));
    return { fastUntil: end.toISOString(), release };
  }
  return { fastUntil: null, release: s.release.filter((r) => Date.parse(r) > now) };
}

/** What production does at a tick: open events and watches first, then audit, then the policy. */
export function planCheck(
  direction: DirectionId,
  at: Date,
  opts: { open: boolean; state: AdaptiveState; mode?: "dense" | "adaptive"; params?: AdaptiveParams },
): Plan {
  const t = localTime(at);
  if (opts.open) return { due: onGrid(t, TICK), reason: "fast" };
  if (inAuditWindow(direction, t)) return { due: true, reason: "audit" };
  if ((opts.mode ?? POLICY.mode) === "dense") {
    const rush = activeWindow(t)?.direction === direction;
    return { due: isDue(direction, at, false), reason: rush ? "rush" : "routine" };
  }
  return adaptiveDue(direction, at, opts.state, false, opts.params ?? ADAPTIVE);
}

export const policyLabel = (mode = POLICY.mode, p: AdaptiveParams = ADAPTIVE) =>
  mode === "dense" ? `dense@${POLICY.version}` : `adaptive@${POLICY.version}:q${p.quietRushMin}w${p.watchMin}h${p.holdMin}r${p.release.join("-")}`;
