import { type DirectionId, type POSTING, RUSH_WINDOWS, type RushWindow } from "../config";
import type { LocalTime } from "./schedule";
import type { Answer } from "./verdict";

export type PostingConfig = typeof POSTING;

/** An open rush episode for one direction: its No event and, once Yes is seen, when Yes began. */
export type Episode = { noId: string; yesSince: string | null };

export type PostAction =
  | { type: "create"; answer: "no"; id: string; at: string }
  | { type: "create"; answer: "yes"; id: string; at: string; since: string }
  | { type: "supersede"; id: string }
  | { type: "log"; kind: LogKind; episode: string; detail?: string };

export type LogKind = "yes-held" | "yes-cancelled" | "yes-created" | "repeat-no-ignored" | "closed-no-unposted" | "closed-expired";

export type StepInput = {
  episode: Episode | null;
  direction: DirectionId;
  /** Verdict after this reading, and the transition it made (if any). */
  answer: Answer;
  transition: Answer | null;
  /** Reading time (ISO). */
  at: string;
  local: LocalTime;
  window: RushWindow | null;
  /** Status of the open episode's No event. */
  noStatus: string | null;
  exists: (id: string) => boolean;
};

const POSTED = new Set(["published", "dry-run"]);
const IN_FLIGHT = new Set(["claimed", "container"]);
const minutes = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

export const noId = (date: string, window: RushWindow["id"], direction: DirectionId) => `${date}-${window}-${direction}-no`;

export function parseNoId(id: string): { date: string; window: RushWindow } | null {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})-(morning|evening)-(eastbound|westbound)-no$/);
  const window = m && RUSH_WINDOWS.find((w) => w.id === m[2] && w.direction === m[3]);
  return m && window ? { date: m[1], window } : null;
}

/** True once local time is past the episode's own rush window (a later date counts as past). */
export function windowEnded(id: string, local: LocalTime): boolean {
  const p = parseNoId(id);
  if (!p) return true;
  return local.date > p.date || (local.date === p.date && local.minuteOfDay >= p.window.endMin);
}

/**
 * Advance one direction's posting episode after a reading. Pure: the caller stores the episode and
 * carries out the actions (insert events, log rows). Ids are deterministic, so replays are idempotent.
 */
export function advance(input: StepInput, cfg: PostingConfig): { episode: Episode | null; actions: PostAction[] } {
  const { episode, direction, answer, transition, at, local, window } = input;
  const actions: PostAction[] = [];

  if (!episode) {
    if (transition !== "no" || window?.direction !== direction) return { episode: null, actions };
    const id = noId(local.date, window.id, direction);
    if (input.exists(id)) return { episode: null, actions: [{ type: "log", kind: "repeat-no-ignored", episode: id, detail: at }] };
    return { episode: { noId: id, yesSince: null }, actions: [{ type: "create", answer: "no", id, at }] };
  }

  const id = episode.noId;
  if (answer === "no") {
    if (episode.yesSince) {
      actions.push({ type: "log", kind: "yes-cancelled", episode: id, detail: `${episode.yesSince} → ${at}` });
      return { episode: { ...episode, yesSince: null }, actions };
    }
    return { episode, actions };
  }

  // Answer is Yes: start (or continue) the hold.
  const yesSince = episode.yesSince ?? at;
  if (!episode.yesSince) actions.push({ type: "log", kind: "yes-held", episode: id, detail: at });
  const settled = minutes(yesSince, at) >= cfg.settleMin || windowEnded(id, local);
  if (!settled) return { episode: { ...episode, yesSince }, actions };

  if (input.noStatus && POSTED.has(input.noStatus)) {
    const yesId = id.replace(/-no$/, "-yes");
    actions.push({ type: "create", answer: "yes", id: yesId, at, since: yesSince }, { type: "log", kind: "yes-created", episode: id, detail: yesId });
    return { episode: null, actions };
  }
  // The No is mid-publish: keep holding and decide on the next reading.
  if (input.noStatus && IN_FLIGHT.has(input.noStatus)) return { episode: { ...episode, yesSince }, actions };
  // The No never went out (stale, failed, still pending): no Yes, and an unposted No is now moot.
  if (input.noStatus === "pending") actions.push({ type: "supersede", id });
  actions.push({ type: "log", kind: "closed-no-unposted", episode: id, detail: input.noStatus ?? "missing" });
  return { episode: null, actions };
}

/** Close an episode left open far too long (e.g. a stuck verdict), so polling can step back down. */
export const expired = (noAt: string, now: Date, cfg: PostingConfig): boolean =>
  minutes(noAt, now.toISOString()) >= cfg.closeAfterMin;

export type Gate = { ok: true } | { ok: false; drop: boolean; reason: string };

/**
 * May this event be published now? Stale events are dropped, never posted late. Outside posting
 * hours or over the 24-hour cap the event waits (and turns stale if the wait is long).
 */
export function gate(event: { at: string }, now: Date, local: LocalTime, postedLast24h: number, cfg: PostingConfig): Gate {
  const age = minutes(event.at, now.toISOString());
  if (age > cfg.staleMin) return { ok: false, drop: true, reason: `stale: ${Math.round(age)} min old` };
  if (local.weekday === 0 || local.weekday === 6) return { ok: false, drop: false, reason: "weekend" };
  if (local.minuteOfDay < cfg.startHour * 60 || local.minuteOfDay >= cfg.endHour * 60) return { ok: false, drop: false, reason: "outside posting hours" };
  if (postedLast24h >= cfg.maxPer24h) return { ok: false, drop: false, reason: `cap: ${postedLast24h} posts in 24 h` };
  return { ok: true };
}
