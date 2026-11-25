// Score polling policies against the dense reference recorded in production.
//   bun scripts/replay.ts [--days 28] [--out reports/2026-11-24.md] [--holdout 7]
// Reads /admin/history with ADMIN_TOKEN (env or .dev.vars). Only rush windows with at least 95% of
// their 5-minute slots are used as reference. --holdout N scores the last N days separately, so a
// setting is tuned on earlier weeks and judged once on later ones.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ADAPTIVE, type DirectionId, RUSH_WINDOWS, VERDICT } from "../src/config";
import type { Level } from "../src/core/levels";
import { combine, gates, percentile, type Policy, type RefTick, replay, type Score, score } from "../src/core/replay";
import { localTime } from "../src/core/schedule";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const days = Number(arg("days", "28"));
const holdout = Number(arg("holdout", "0"));
const out = arg("out", "");
const origin = arg("origin", "https://shoulditaketheba.com");
const token =
  process.env.ADMIN_TOKEN ??
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_TOKEN=["']?([^"'\n]+)/m)?.[1];

type Row = { direction: DirectionId; at: string; ok: number; level: Level | null; reason: string | null; answer: string | null };
const res = await fetch(`${origin}/admin/history?days=${days}`, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`history: HTTP ${res.status}`);
const { rows } = (await res.json()) as { rows: Row[] };

// Group good checks into reference windows: one per direction, local date and rush window.
type Win = { key: string; date: string; direction: DirectionId; ticks: RefTick[]; expected: number };
const wins = new Map<string, Win>();
for (const w of RUSH_WINDOWS) {
  for (const r of rows) {
    if (!r.ok || !r.level || r.direction !== w.direction) continue;
    const t = localTime(new Date(r.at));
    if (t.weekday === 0 || t.weekday === 6 || t.minuteOfDay < w.startMin || t.minuteOfDay >= w.endMin) continue;
    const key = `${t.date} ${w.direction}`;
    const win = wins.get(key) ?? { key, date: t.date, direction: w.direction, ticks: [], expected: (w.endMin - w.startMin) / 5 };
    win.ticks.push({ at: r.at, level: r.level });
    wins.set(key, win);
  }
}
const all = [...wins.values()].sort((a, b) => a.key.localeCompare(b.key));
const usable = all.filter((w) => w.ticks.length >= 0.95 * w.expected);
const cutoff = holdout ? new Date(Date.now() - holdout * 86_400_000).toISOString().slice(0, 10) : "9999";
const sets = holdout
  ? { train: usable.filter((w) => w.date < cutoff), holdout: usable.filter((w) => w.date >= cutoff) }
  : { all: usable };

const policies: Policy[] = [{ name: "dense (today)", kind: "dense" }];
for (const quietRushMin of [10, 15])
  for (const watchMin of [10, 15])
    for (const holdMin of [10, 15, 20])
      for (const release of [[10, 20], [10, 15]])
        policies.push({
          name: `q${quietRushMin} w${watchMin} h${holdMin} r${release.join("-")}`,
          kind: "adaptive",
          params: { ...ADAPTIVE, quietRushMin, watchMin, holdMin, release },
        });

const fmt = (x: number | null, d = 0) => (x === null ? "–" : x.toFixed(d));
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

function table(windows: Win[]): string {
  const weekdays = new Set(windows.map((w) => w.date)).size || 1;
  const lines = [
    "| Policy | Jams caught | ≤10 min | Onset p50/p90 | Clear p90 | Stale Yes min | False No min | Slowdowns seen | Rush calls/weekday | Gates |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const results = policies.map((p) => {
    const s: Score = combine(windows.map((w) => score(replay(w.ticks, w.direction, p, VERDICT))));
    const g = gates(s, s.ticks * 5);
    return { p, s, g };
  });
  results.sort((a, b) => Number(b.g.pass) - Number(a.g.pass) || a.s.staleYesMin - b.s.staleYesMin || a.s.calls - b.s.calls);
  for (const { p, s, g } of results) {
    lines.push(
      `| ${p.name} | ${s.matched}/${s.refEvents} | ${pct(g.within10)} | ${fmt(percentile(s.onsetLagMin, 50))}/${fmt(percentile(s.onsetLagMin, 90))} | ${fmt(g.p90Clear)} | ${s.staleYesMin} | ${s.falseNoMin} | ${s.slowdownsSeen}/${s.slowdowns} | ${fmt(s.calls / weekdays, 1)} | ${s.refEvents === 0 ? "no jams yet" : g.pass ? (g.enoughEvents ? "pass" : "pass (too few jams)") : "fail"} |`,
    );
  }
  return lines.join("\n");
}

const events = (ws: Win[]) => combine(ws.map((w) => score(replay(w.ticks, w.direction, policies[0], VERDICT)))).refEvents;
const report = [
  `# Polling replay, ${new Date().toISOString().slice(0, 10)}`,
  "",
  `History: ${days} days, ${rows.length} checks. Reference windows: ${usable.length} usable of ${all.length} (need 95% of 5-minute slots).`,
  `Jams in the reference (No verdicts on the dense timeline): ${events(usable)}. Gates need at least 30 before a result counts.`,
  "Gates: ≥95% of jams caught, ≥90% caught within 10 minutes, clearance p90 ≤10 minutes, stale Yes ≤1% of minutes.",
  "",
  ...Object.entries(sets).flatMap(([name, ws]) => [`## ${name} (${ws.length} windows)`, "", table(ws), ""]),
].join("\n");

console.log(report);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
}
