import { describe, expect, test } from "bun:test";
import { POSTING } from "../config";
import { advance, type Episode, gate, parseNoId, type PostAction, windowEnded } from "./posting";
import { activeWindow, localTime } from "./schedule";
import type { Answer } from "./verdict";

// 2026-11-24 is a Tuesday. Evening window (eastbound) runs 15:30–18:30 Central = 21:30–00:30 UTC.
const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 24, h, m)).toISOString();

type Tick = { at: string; answer: Answer; transition?: Answer };

/** Run readings through advance, with a fake posts table where the No posts as soon as it is created. */
function run(ticks: Tick[], noStatus = "dry-run", start: Episode | null = null, existing: string[] = []) {
  const posts = new Map<string, string>(existing.map((id) => [id, "published"]));
  let episode = start;
  const all: PostAction[] = [];
  for (const t of ticks) {
    const local = localTime(new Date(t.at));
    const out = advance(
      {
        episode,
        direction: "eastbound",
        answer: t.answer,
        transition: t.transition ?? null,
        at: t.at,
        local,
        window: activeWindow(local),
        noStatus: episode ? (posts.get(episode.noId) ?? null) : null,
        exists: (id) => posts.has(id),
      },
      POSTING,
    );
    for (const a of out.actions) if (a.type === "create") posts.set(a.id, a.answer === "no" ? noStatus : "pending");
    all.push(...out.actions);
    episode = out.episode;
  }
  const created = all.filter((a) => a.type === "create").map((a) => (a as { id: string }).id);
  const logs = all.filter((a) => a.type === "log").map((a) => (a as { kind: string }).kind);
  return { episode, created, logs, all };
}

const NO = "2026-11-24-evening-eastbound-no";
const YES = "2026-11-24-evening-eastbound-yes";

describe("posting episodes", () => {
  test("a quiet rush posts nothing", () => {
    const { created, episode } = run([{ at: at(22, 0), answer: "yes" }, { at: at(22, 5), answer: "yes" }]);
    expect(created).toEqual([]);
    expect(episode).toBeNull();
  });

  test("a No outside its direction's window posts nothing", () => {
    expect(run([{ at: at(14, 0), answer: "no", transition: "no" }]).created).toEqual([]);
  });

  test("one No, then a Yes only after Yes holds for settleMin", () => {
    const r = run([
      { at: at(22, 0), answer: "no", transition: "no" },
      { at: at(22, 30), answer: "yes", transition: "yes" },
      { at: at(22, 40), answer: "yes" },
      { at: at(22, 45), answer: "yes" },
    ]);
    expect(r.created).toEqual([NO]);
    expect(r.episode).toEqual({ noId: NO, yesSince: at(22, 30) });
    const done = run([{ at: at(22, 50), answer: "yes" }], "dry-run", r.episode, [NO]);
    expect(done.created).toEqual([YES]);
    expect(done.episode).toBeNull();
    const yes = done.all.find((a) => a.type === "create") as { since: string; at: string };
    expect(yes.since).toBe(at(22, 30));
    expect(yes.at).toBe(at(22, 50));
  });

  test("flapping inside the window cancels the pending Yes and keeps one No", () => {
    const r = run([
      { at: at(22, 0), answer: "no", transition: "no" },
      { at: at(22, 20), answer: "yes", transition: "yes" },
      { at: at(22, 30), answer: "no", transition: "no" },
      { at: at(22, 50), answer: "yes", transition: "yes" },
      { at: at(23, 0), answer: "no", transition: "no" },
      { at: at(23, 20), answer: "yes", transition: "yes" },
      { at: at(23, 40), answer: "yes" },
    ]);
    expect(r.created).toEqual([NO, YES]);
    expect(r.logs.filter((k) => k === "yes-cancelled").length).toBe(2);
    expect(r.episode).toBeNull();
  });

  test("after the Yes, later flips in the same window create nothing", () => {
    const r = run([
      { at: at(23, 50), answer: "no", transition: "no" },
      { at: at(23, 55), answer: "yes", transition: "yes" },
      { at: at(24, 0), answer: "yes" },
    ], "dry-run", null, [NO, YES]);
    expect(r.created).toEqual([]);
    expect(r.logs).toEqual(["repeat-no-ignored"]);
  });

  test("the window ending releases a held Yes early", () => {
    // 18:25 Central = 00:25 UTC next day; window ends 18:30.
    const r = run([
      { at: at(22, 0), answer: "no", transition: "no" },
      { at: at(24, 25), answer: "yes", transition: "yes" },
      { at: at(24, 30), answer: "yes" },
    ]);
    expect(r.created).toEqual([NO, YES]);
  });

  test("a jam that outlasts the window posts Yes at the first Yes after it", () => {
    const r = run([
      { at: at(22, 0), answer: "no", transition: "no" },
      { at: at(24, 45), answer: "no" },
      { at: at(25, 0), answer: "yes", transition: "yes" },
    ]);
    expect(r.created).toEqual([NO, YES]);
  });

  test("no Yes when the No never went out; a pending No is superseded", () => {
    const r = run([
      { at: at(22, 0), answer: "no", transition: "no" },
      { at: at(22, 30), answer: "yes", transition: "yes" },
      { at: at(22, 50), answer: "yes" },
    ], "pending");
    expect(r.created).toEqual([NO]);
    expect(r.all).toContainEqual({ type: "supersede", id: NO });
    expect(r.logs).toContain("closed-no-unposted");
    expect(r.episode).toBeNull();
  });

  test("a stale or failed No closes the episode without a Yes", () => {
    const r = run([
      { at: at(22, 0), answer: "no", transition: "no" },
      { at: at(22, 30), answer: "yes", transition: "yes" },
      { at: at(22, 50), answer: "yes" },
    ], "stale");
    expect(r.created).toEqual([NO]);
    expect(r.all.some((a) => a.type === "supersede")).toBe(false);
  });

  test("a No still being published holds the Yes", () => {
    const r = run([
      { at: at(22, 0), answer: "no", transition: "no" },
      { at: at(22, 30), answer: "yes", transition: "yes" },
      { at: at(22, 50), answer: "yes" },
    ], "claimed");
    expect(r.created).toEqual([NO]);
    expect(r.episode?.yesSince).toBe(at(22, 30));
  });
});

describe("ids and windows", () => {
  test("parses No ids", () => {
    expect(parseNoId(NO)?.window.id).toBe("evening");
    expect(parseNoId("junk")).toBeNull();
  });
  test("window end", () => {
    expect(windowEnded(NO, localTime(new Date(at(24, 29))))).toBe(false);
    expect(windowEnded(NO, localTime(new Date(at(24, 30))))).toBe(true);
    expect(windowEnded(NO, localTime(new Date(Date.UTC(2026, 10, 25, 22, 0))))).toBe(true);
  });
});

describe("publish gate", () => {
  const now = new Date(at(22, 10));
  const local = localTime(now);
  test("fresh weekday event in hours is ok", () => {
    expect(gate({ at: at(22, 0) }, now, local, 0, POSTING)).toEqual({ ok: true });
  });
  test("more than 30 minutes old is dropped as stale", () => {
    const g = gate({ at: at(21, 39) }, now, local, 0, POSTING);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.drop).toBe(true);
  });
  test("cap of 4 per 24 h waits", () => {
    expect(gate({ at: at(22, 0) }, now, local, 4, POSTING)).toEqual({ ok: false, drop: false, reason: "cap: 4 posts in 24 h" });
  });
  test("outside 6 AM to 8 PM Central waits", () => {
    const late = new Date(Date.UTC(2026, 10, 25, 2, 5)); // 8:05 PM Central
    expect(gate({ at: late.toISOString() }, late, localTime(late), 0, POSTING).ok).toBe(false);
  });
  test("weekends wait", () => {
    const sat = new Date(Date.UTC(2026, 10, 28, 18, 0));
    expect(gate({ at: sat.toISOString() }, sat, localTime(sat), 0, POSTING)).toMatchObject({ ok: false, reason: "weekend" });
  });
});
