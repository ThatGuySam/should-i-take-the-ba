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
  shoulderMin: 30,
  overnightMin: 60,
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
