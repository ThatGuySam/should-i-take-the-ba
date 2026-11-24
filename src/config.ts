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

export const TIME_ZONE = "America/Chicago";

// Stretches of the BA, eastbound order. Boundaries sit on the mainline between interchanges (not
// on overpasses) so Google can't snap them to a cross street. Heading is eastbound travel; flip
// 180° for westbound. Points come from Census TIGER/Line (data/tulsa-roads.json, scripts notes).
export const STRETCH_BOUNDARIES = [
  { name: "Yale", lat: 36.1157, lng: -95.91248, heading: 115 },
  { name: "Memorial", lat: 36.1054, lng: -95.8797, heading: 113 },
  { name: "129th E Ave", lat: 36.08532, lng: -95.82737, heading: 121 },
  { name: "9th St", lat: 36.0638, lng: -95.77614, heading: 113 },
] as const;

export const STRETCH_NAMES = ["Downtown", ...STRETCH_BOUNDARIES.map((b) => b.name), "Broken Arrow"] as const;

/** A stretch is slow or jammed by its own delay against Google's no-traffic time. */
export const STRETCH_LEVELS = { slowRatio: 0.2, slowMinSec: 30, jamRatio: 0.5, jamMinSec: 60 };

/** Google traffic requests per calendar month (Central). Free tier is 5,000; Sam's cap is 50%. */
export const BUDGET = { monthlyCap: 2500, rushOnlyAbove: 2400 };
