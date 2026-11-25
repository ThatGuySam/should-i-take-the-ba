import type { VerdictConfig } from "./core/verdict";

export type DirectionId = "eastbound" | "westbound";

export type Direction = {
  id: DirectionId;
  label: string;
  from: string;
  to: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
};

const DOWNTOWN = { lat: 36.1441, lng: -95.983615 };
const BROKEN_ARROW = { lat: 36.03832, lng: -95.742998 };

export const DIRECTIONS: Record<DirectionId, Direction> = {
  eastbound: {
    id: "eastbound",
    label: "Eastbound",
    from: "Downtown Tulsa",
    to: "Broken Arrow",
    origin: DOWNTOWN,
    destination: BROKEN_ARROW,
  },
  westbound: {
    id: "westbound",
    label: "Westbound",
    from: "Broken Arrow",
    to: "Downtown Tulsa",
    origin: BROKEN_ARROW,
    destination: DOWNTOWN,
  },
};

export type RushWindow = {
  id: "morning" | "evening";
  direction: DirectionId;
  startMin: number;
  endMin: number;
};

export const RUSH_WINDOWS: RushWindow[] = [
  { id: "morning", direction: "westbound", startMin: 6 * 60 + 30, endMin: 9 * 60 + 30 },
  { id: "evening", direction: "eastbound", startMin: 15 * 60 + 30, endMin: 18 * 60 + 30 },
];

export const POLL = {
  rushMin: 5,
  shoulderMin: 120,
  overnightMin: 180,
  overnightStartHour: 21,
  overnightEndHour: 6,
  maxReadingAgeMin: 15,
};

export const VERDICT: VerdictConfig = {
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

// Polling policy. "dense" checks every 5 minutes through each rush window and is the reference the
// adaptive policy is scored against (scripts/replay.ts). Switch to "adaptive" only after replay on
// held-out weeks passes the gates in docs/polling-accuracy.md.
export const POLICY = { mode: "dense" as "dense" | "adaptive", version: "2026-11-24" };

// Adaptive: quiet checks in the rush window, 5-minute checks from the first slow reading, hold after
// clearance, then step back down. Values are starting points to be tuned by replay.
export const ADAPTIVE = { quietRushMin: 10, fastMin: 5, watchMin: 15, holdMin: 15, release: [10, 20] };

// Audit days: one pre-assigned weekday per ISO week runs dense checks with padded rush windows, so the
// adaptive policy keeps getting scored against a full reference after launch.
export const AUDIT = { padMin: 30 };

export const TIME_ZONE = "America/Chicago";

// Stretches of the BA, eastbound order. Boundaries sit on the mainline between interchanges (not
// on overpasses) so Google can't snap them to a cross street. lat/lng (from Census TIGER/Line) is
// the map position; east/west are the request waypoints.
// Each boundary sits on that direction's own carriageway (the BA is divided), snapped to Google's
// route line. A point on the wrong carriageway makes Google exit and turn around to reach it.
export const STRETCH_BOUNDARIES = [
  { name: "Yale", lat: 36.1157, lng: -95.91248, east: { lat: 36.11533, lng: -95.91296, heading: 136 }, west: { lat: 36.11571, lng: -95.91247, heading: 295 } },
  { name: "Memorial", lat: 36.1054, lng: -95.8797, east: { lat: 36.10521, lng: -95.87981, heading: 115 }, west: { lat: 36.10538, lng: -95.87971, heading: 295 } },
  { name: "129th E Ave", lat: 36.08532, lng: -95.82737, east: { lat: 36.08511, lng: -95.82753, heading: 121 }, west: { lat: 36.08528, lng: -95.8274, heading: 301 } },
  { name: "9th St", lat: 36.0638, lng: -95.77614, east: { lat: 36.06365, lng: -95.77622, heading: 113 }, west: { lat: 36.06378, lng: -95.77615, heading: 293 } },
] as const;

export const STRETCH_NAMES = ["Downtown", ...STRETCH_BOUNDARIES.map((b) => b.name), "Broken Arrow"] as const;

/** A stretch is slow or jammed by its own delay against Google's no-traffic time. */
export const STRETCH_LEVELS = { slowRatio: 0.2, slowMinSec: 30, jamRatio: 0.5, jamMinSec: 60 };

/** Google traffic requests per calendar month (Central). Free tier is 5,000; Sam's cap is 50%. */
export const BUDGET = { monthlyCap: 2500, rushOnlyAbove: 2400 };

// Instagram posting rules (src/core/posting.ts). One No and at most one Yes per rush window and
// direction. The Yes waits until Yes has held for settleMin or the window has ended. Caps apply in
// every mode, so dry-run shows what live would have posted.
export const POSTING = {
  settleMin: 20,
  maxPer24h: 4,
  startHour: 6,
  endHour: 20,
  staleMin: 30,
  /** A claim by the local runner expires after this, so a crashed run can be reconciled. */
  claimMin: 10,
  /** An episode still open this long after its No is closed without a Yes (stuck state guard). */
  closeAfterMin: 360,
  estimate: { days: 90, minEpisodes: 8, percentile: 90, roundUpMin: 15, maxGapMin: 20 },
};
