import { DIRECTIONS, type DirectionId, TIME_ZONE } from "./config";
import { activeWindow, localTime } from "./core/schedule";
import type { DirectionStatus } from "./monitor";

export type PublicStatus = {
  question: string;
  title: string;
  url: string;
  direction: DirectionId;
  route: { from: string; to: string; label: string };
  answer: "yes" | "no" | "unknown";
  headline: string;
  summary: string;
  checkedAt: string | null;
  fresh: boolean;
  /** The site's own derived level for the latest check, and per stretch (eastbound order). */
  level: DirectionStatus["level"];
  stretches: DirectionStatus["stretches"];
  answerSince: string | null;
  source: string;
  monitoring: { lastAttemptAt: string | null; lastError: string | null };
};

export function defaultDirection(now = new Date()): DirectionId {
  const t = localTime(now);
  const window = activeWindow(t);
  if (window) return window.direction;
  return t.minuteOfDay < 12 * 60 ? "westbound" : "eastbound";
}

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });

export function headline(direction: DirectionId, answer: "yes" | "no" | "unknown"): string {
  const d = DIRECTIONS[direction];
  const route = `${d.from} to ${d.to}`;
  if (answer === "yes") return `Traffic is moving, ${route}.`;
  if (answer === "no") return `Backed up from ${route}. Try another way.`;
  return `No current traffic check for ${route}.`;
}

export function toPublic(s: DirectionStatus, origin: string): PublicStatus {
  const d = DIRECTIONS[s.direction];
  const label = d.label.toLowerCase();
  let summary = "No current traffic check. Check back soon.";
  if (s.checkedAt && s.fresh) {
    const when = formatTime(s.checkedAt);
    summary = s.answer === "no" ? `Traffic is backed up ${label} as of ${when}.` : `Traffic is moving ${label} as of ${when}.`;
  } else if (s.checkedAt) {
    summary = `The last check was at ${formatTime(s.checkedAt)} and is out of date.`;
  }
  return {
    question: "Should I take the BA?",
    title: `Should I take the BA? ${d.label}, ${d.from} to ${d.to}`,
    url: `${origin}/?direction=${s.direction}`,
    direction: s.direction,
    route: { from: d.from, to: d.to, label: d.label },
    answer: s.answer,
    headline: headline(s.direction, s.answer),
    summary,
    checkedAt: s.checkedAt,
    fresh: s.fresh,
    level: s.level,
    stretches: s.stretches,
    answerSince: Date.parse(s.answerSince) > 0 ? s.answerSince : null,
    source: "Based on traffic from Google Maps Platform",
    monitoring: { lastAttemptAt: s.lastAttemptAt, lastError: s.lastError },
  };
}
