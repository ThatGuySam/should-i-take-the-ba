import { describe, expect, test } from "bun:test";
import { VERDICT, STRETCH_LEVELS } from "../config";
import { decodeLevels, encodeLevels, routeLevel, stretchLevel } from "./levels";

describe("levels", () => {
  test("route level follows the No threshold", () => {
    expect(routeLevel({ durationSec: 1500, staticDurationSec: 1200 }, VERDICT)).toBe("jammed");
    expect(routeLevel({ durationSec: 1380, staticDurationSec: 1200 }, VERDICT)).toBe("slow");
    expect(routeLevel({ durationSec: 1230, staticDurationSec: 1200 }, VERDICT)).toBe("clear");
  });
  test("a short stretch needs real seconds of delay", () => {
    expect(stretchLevel({ durationSec: 150, staticDurationSec: 100 }, STRETCH_LEVELS)).toBe("slow");
    expect(stretchLevel({ durationSec: 200, staticDurationSec: 120 }, STRETCH_LEVELS)).toBe("jammed");
    expect(stretchLevel({ durationSec: 40, staticDurationSec: 20 }, STRETCH_LEVELS)).toBe("clear");
  });
  test("levels round-trip", () => {
    expect(decodeLevels(encodeLevels(["clear", "slow", "jammed"]))).toEqual(["clear", "slow", "jammed"]);
  });
});
