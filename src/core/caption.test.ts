import { describe, expect, test } from "bun:test";
import { buildFacts, cleanDraft, type FactsInput, validateCaption } from "./caption";
import { classifyGraphError, tokenPlan } from "./igrunner";

const ORIGIN = "https://example.test";
// 5:12 PM Central on Tue Nov 24, 2026.
const noEvent: FactsInput = {
  id: "2026-11-24-evening-eastbound-no",
  direction: "eastbound",
  answer: "no",
  at: "2026-11-24T23:12:00.000Z",
  window: "evening",
  status: "pending",
  containerId: null,
  caption: null,
  extra: {
    estimate: { episodes: 12, withinMin: 45 },
    stretches: [
      { from: "Downtown", to: "Yale", level: "clear" },
      { from: "Yale", to: "Memorial", level: "jammed" },
    ],
  },
};
const yesEvent: FactsInput = {
  ...noEvent,
  id: "2026-11-24-evening-eastbound-yes",
  answer: "yes",
  at: "2026-11-25T00:02:00.000Z",
  extra: { noAt: "2026-11-24T23:12:00.000Z", since: "2026-11-24T23:42:00.000Z" },
};

const no = buildFacts(noEvent, ORIGIN);
const yes = buildFacts(yesEvent, ORIGIN);
const tail = "\n\nLive answer: shoulditaketheba.com\nAutomated traffic update.";

describe("facts", () => {
  test("No facts", () => {
    expect(no.detectedAt).toBe("5:12 PM");
    expect(no.estimate).toEqual({ episodes: 12, withinMin: 45 });
    expect(no.stretches).toEqual(["Yale to Memorial (jammed)"]);
    expect(no.imageUrl).toBe(`${ORIGIN}/cards/e/${noEvent.id}.jpg`);
    expect(no.noDetectedAt).toBeNull();
  });
  test("Yes facts", () => {
    expect(yes.detectedAt).toBe("6:02 PM");
    expect(yes.noDetectedAt).toBe("5:12 PM");
    expect(yes.clearedSince).toBe("5:42 PM");
    expect(yes.jamMinutes).toBe(30);
    expect(yes.estimate).toBeNull();
  });
  test("template captions pass validation", () => {
    expect(validateCaption(no.templateCaption, no)).toEqual([]);
    expect(validateCaption(yes.templateCaption, yes)).toEqual([]);
    expect(no.templateCaption).toContain("usually cleared within 45 min");
    const bare = buildFacts({ ...noEvent, extra: null }, ORIGIN);
    expect(bare.templateCaption).not.toMatch(/usually|min\b/);
    expect(validateCaption(bare.templateCaption, bare)).toEqual([]);
  });
});

describe("caption validator", () => {
  test("rejects clock-time clearing, missing hedge, causes and route advice", () => {
    const p1 = validateCaption(`No. Backed up at 5:12 PM. Usually clear by 5:57 PM.${tail}`, no);
    expect(p1).toContain("time 5:57 not in facts");
    expect(p1).toContain("predicts a clock time for clearing");
    expect(p1).toContain('estimate without "Timing varies."');
    const p2 = validateCaption(`No. A crash backed up the BA at 5:12 PM. Take I-44 instead.${tail}`, no);
    expect(p2).toContain("adds a cause or route advice");
  });
  test("accepts a caption built from the facts", () => {
    const text = `No. The BA eastbound started backing up at 5:12 PM. Past jams usually cleared within 45 min of being detected. Timing varies.${tail}`;
    expect(validateCaption(text, no)).toEqual([]);
  });
  test("accepts hours equal to a fact and Yes jam length", () => {
    const text = `Yes. Moving again as of 6:02 PM after a 30 min backup that started at 5:12 PM.${tail}`;
    expect(validateCaption(text, yes)).toEqual([]);
  });
  test("rejects invented times and durations", () => {
    const text = `No. Backed up at 5:12 PM. Should clear by 6:15 PM, maybe 20 minutes or 1 hour.${tail}`;
    const problems = validateCaption(text, no);
    expect(problems).toContain("time 6:15 not in facts");
    expect(problems).toContain("duration 20 minutes not in facts");
    expect(problems).toContain("duration 1 hour not in facts");
  });
  test("rejects a bare hour that is not in the facts", () => {
    expect(validateCaption(`No as of 5:12 PM, clear by 7 PM.${tail}`, no)).toContain("time 7 PM not in facts");
  });
  test("requires the detected time and fixed lines", () => {
    const problems = validateCaption("No. The BA is backed up.", no);
    expect(problems).toContain("missing detected time 5:12 PM");
    expect(problems).toContain('missing line "Live answer: shoulditaketheba.com"');
    expect(problems).toContain('missing line "Automated traffic update."');
  });
  test("rejects long captions, hashtag spam, emoji walls and promises", () => {
    expect(validateCaption(`No at 5:12 PM. ${"x".repeat(600)}${tail}`, no)[0]).toMatch(/too long/);
    expect(validateCaption(`No at 5:12 PM. #a #b #c${tail}`, no)).toContain("more than 2 hashtags");
    expect(validateCaption(`No at 5:12 PM. 🚗🚗🚗${tail}`, no)).toContain("more than 2 emoji");
    expect(validateCaption(`No at 5:12 PM. It will clear soon.${tail}`, no)).toContain("makes a promise");
  });
  test("no estimate in the facts means no 'usually'", () => {
    const bare = buildFacts({ ...noEvent, extra: null }, ORIGIN);
    expect(validateCaption(`No at 5:12 PM. These usually pass.${tail}`, bare)).toContain("gives an estimate without one in the facts");
  });
  test("cleanDraft strips fences and quotes", () => {
    expect(cleanDraft('```\n"Hello"\n```')).toBe("Hello");
  });
});

describe("runner decisions", () => {
  test("auth and policy errors pause", () => {
    expect(classifyGraphError({ status: 400, code: 190 })).toBe("pause");
    expect(classifyGraphError({ status: 400, code: 10 })).toBe("pause");
    expect(classifyGraphError({ status: 400, code: 200 })).toBe("pause");
    expect(classifyGraphError({ status: 400, code: 368 })).toBe("pause");
    expect(classifyGraphError({ status: 400, code: 9004, message: "flagged as spam" })).toBe("pause");
  });
  test("transient errors retry, others fail", () => {
    expect(classifyGraphError({ status: 500 })).toBe("retry");
    expect(classifyGraphError({ status: 400, code: 4 })).toBe("retry");
    expect(classifyGraphError({ status: 0, message: "fetch failed" })).toBe("retry");
    expect(classifyGraphError({ status: 400, code: 100, message: "Invalid parameter" })).toBe("fail");
  });
  test("token refresh after 30 days, warnings at 14 and 7 days left", () => {
    const issued = "2026-11-01T00:00:00Z";
    expect(tokenPlan({ issuedAt: issued }, new Date("2026-11-20T00:00:00Z"))).toEqual({ refresh: false, daysLeft: 41, warning: null });
    expect(tokenPlan({ issuedAt: issued }, new Date("2026-12-02T00:00:00Z")).refresh).toBe(true);
    expect(tokenPlan({ issuedAt: issued }, new Date("2026-12-18T00:00:00Z")).warning).toMatch(/^Instagram token expires in 13 days/);
    expect(tokenPlan({ issuedAt: issued }, new Date("2026-12-25T00:00:00Z")).warning).toMatch(/^URGENT/);
    expect(tokenPlan({ issuedAt: issued }, new Date("2027-01-02T00:00:00Z")).warning).toMatch(/expired/);
  });
});
