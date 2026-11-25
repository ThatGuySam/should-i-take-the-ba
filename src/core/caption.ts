import { cardLines } from "../card";
import { DIRECTIONS, type DirectionId, TIME_ZONE } from "../config";
import type { Level } from "./levels";

/** Stored with each event when it is created, so the facts never change afterwards. */
export type PostExtra = {
  estimate?: { episodes: number; withinMin: number } | null;
  stretches?: { from: string; to: string; level: Level }[] | null;
  /** Yes events: when the No was detected and when Yes was first seen. */
  noAt?: string;
  since?: string;
};

export type FactsInput = {
  id: string;
  direction: DirectionId;
  answer: "yes" | "no";
  at: string;
  window: string;
  status: string;
  containerId: string | null;
  caption: string | null;
  extra: PostExtra | null;
};

/** Everything the caption writer may use. Times are Central, formatted like "5:12 PM". */
export type PostFacts = {
  id: string;
  answer: "yes" | "no";
  direction: DirectionId;
  directionLabel: string;
  from: string;
  to: string;
  window: string;
  date: string;
  /** The time on the card: when this answer was confirmed. */
  detectedAt: string;
  /** Yes only: when the No was detected, when Yes was first seen, and the jam length between. */
  noDetectedAt: string | null;
  clearedSince: string | null;
  jamMinutes: number | null;
  /** No only, null without enough history: past jams in this window usually cleared within this. */
  estimate: { episodes: number; withinMin: number; clearByLocal: string } | null;
  /** Stretches that were slow or jammed at the time, e.g. "Yale to Memorial (jammed)". */
  stretches: string[] | null;
  imageUrl: string;
  templateCaption: string;
  altText: string;
  status: string;
  containerId: string | null;
  /** The caption already sent with containerId, if any. */
  caption: string | null;
};

export const REQUIRED_LINES = ["Live answer: shoulditaketheba.com", "Automated traffic update."];
export const MAX_CAPTION = 600;

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString("en-US", { timeZone: TIME_ZONE, ...opts }).replace(/[\u202f\u00a0]/g, " ");
export const clock = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit" });
const addMin = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

export function buildFacts(e: FactsInput, origin: string): PostFacts {
  const d = DIRECTIONS[e.direction];
  const x = e.extra ?? {};
  const yes = e.answer === "yes";
  const facts: Omit<PostFacts, "templateCaption" | "altText"> = {
    id: e.id,
    answer: e.answer,
    direction: e.direction,
    directionLabel: d.label,
    from: d.from,
    to: d.to,
    window: e.window,
    date: fmt(e.at, { weekday: "short", month: "short", day: "numeric" }),
    detectedAt: clock(e.at),
    noDetectedAt: yes && x.noAt ? clock(x.noAt) : null,
    clearedSince: yes && x.since ? clock(x.since) : null,
    jamMinutes: yes && x.noAt && x.since ? Math.round((Date.parse(x.since) - Date.parse(x.noAt)) / 60_000) : null,
    estimate: !yes && x.estimate ? { ...x.estimate, clearByLocal: clock(addMin(e.at, x.estimate.withinMin)) } : null,
    stretches: x.stretches?.filter((s) => s.level !== "clear").map((s) => `${s.from} to ${s.to} (${s.level})`) ?? null,
    imageUrl: `${origin}/cards/e/${e.id}.jpg`,
    status: e.status,
    containerId: e.containerId,
    caption: e.caption,
  };
  return { ...facts, templateCaption: templateCaption(facts), altText: altText(e) };
}

export function templateCaption(f: Omit<PostFacts, "templateCaption" | "altText">): string {
  const route = `the BA ${f.directionLabel.toLowerCase()} (${f.from} to ${f.to})`;
  const lines =
    f.answer === "no"
      ? [
          `No. Traffic is backing up on ${route} as of ${f.detectedAt} Central.`,
          f.estimate ? `On past weekdays, backups like this usually cleared within ${f.estimate.withinMin} min (around ${f.estimate.clearByLocal}).` : "",
        ]
      : [
          `Yes. ${route[0].toUpperCase()}${route.slice(1)} is moving again as of ${f.detectedAt} Central.`,
          f.noDetectedAt ? `The backup was first reported at ${f.noDetectedAt}.` : "",
        ];
  return [...lines.filter(Boolean), "", ...REQUIRED_LINES].join("\n");
}

export const altText = (e: Pick<FactsInput, "answer" | "direction" | "at">) =>
  `Should I take the BA? ${e.answer === "yes" ? "Yes" : "No"}. ${cardLines({ ...e }).join(". ")}. Map of the Broken Arrow Expressway from downtown Tulsa to Broken Arrow.`;

/** Strip code fences and wrapping quotes a model sometimes adds. */
export const cleanDraft = (raw: string) =>
  raw.trim().replace(/^```\w*\n?|\n?```$/g, "").trim().replace(/^"([\s\S]*)"$/, "$1").trim();

const TIME = /\b(\d{1,2}):(\d{2})\b/g;
const BARE_HOUR = /(?<![:\d])\b(\d{1,2})\s?(?:a\.?m\.?|p\.?m\.?)(?![a-z])/gi;
const MINUTES = /\b(\d+)\s*-?\s*(?:min|mins|minutes?)\b/gi;
const HOURS = /\b(\d+(?:\.\d+)?)\s*-?\s*(?:hr|hrs|hours?)\b/gi;

/** Problems with a drafted caption; empty means it may be posted. */
export function validateCaption(text: string, f: PostFacts): string[] {
  const problems: string[] = [];
  const source = JSON.stringify({ ...f, templateCaption: undefined, caption: undefined });
  const times = new Set([...source.matchAll(TIME)].map((m) => `${Number(m[1])}:${m[2]}`));
  const mins = new Set([...source.matchAll(MINUTES)].map((m) => Number(m[1])));
  for (const n of [f.jamMinutes, f.estimate?.withinMin]) if (n !== null && n !== undefined) mins.add(n);

  if (text.length >= MAX_CAPTION) problems.push(`too long (${text.length} chars)`);
  if (!text.includes(f.detectedAt.replace(/\s?[AP]M$/i, ""))) problems.push(`missing detected time ${f.detectedAt}`);
  const lines = text.split("\n").map((l) => l.trim());
  for (const req of REQUIRED_LINES) if (!lines.includes(req)) problems.push(`missing line "${req}"`);
  for (const m of text.matchAll(TIME)) if (!times.has(`${Number(m[1])}:${m[2]}`)) problems.push(`time ${m[0]} not in facts`);
  for (const m of text.matchAll(BARE_HOUR)) if (!times.has(`${Number(m[1])}:00`)) problems.push(`time ${m[0].replace(/\.$/, "").trim()} not in facts`);
  for (const m of text.matchAll(MINUTES)) if (!mins.has(Number(m[1]))) problems.push(`duration ${m[0]} not in facts`);
  for (const m of text.matchAll(HOURS)) if (!mins.has(Number(m[1]) * 60)) problems.push(`duration ${m[0]} not in facts`);
  if ((text.match(/#\w+/g) ?? []).length > 2) problems.push("more than 2 hashtags");
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 2) problems.push("more than 2 emoji");
  if (/\b(guarantee|promise)|\bwill (?:be )?(?:clear|moving|gone)/i.test(text)) problems.push("makes a promise");
  if (!f.estimate && /\b(usually|typically)\b/i.test(text)) problems.push("gives an estimate without one in the facts");
  return problems;
}
