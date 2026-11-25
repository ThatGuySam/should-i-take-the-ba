import { DIRECTIONS } from "./config";
import type { PostEvent } from "./monitor";
import type { PublicStatus } from "./status";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const STYLE = `
:root{color-scheme:light dark;--fg:#111;--bg:#fff;--muted:#555;--line:#e5e7eb;--yes:#15803d;--no:#b91c1c}
@media (prefers-color-scheme:dark){:root{--fg:#f3f4f6;--bg:#111214;--muted:#a1a1aa;--line:#2a2b2f}}
*{box-sizing:border-box}body{margin:0;font:500 18px/1.55 "Montserrat","Avenir Next","Segoe UI",sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
a{color:inherit;text-underline-offset:.2em}h1{font-size:clamp(2rem,6vw,3rem);font-weight:800;letter-spacing:-.02em;line-height:1.1;text-align:center;margin:0 0 .75rem}
.answer{font-size:clamp(5rem,22vw,9rem);font-weight:900;line-height:1;text-align:center;margin:.25rem 0 1rem;letter-spacing:-.03em}
.answer.no{color:var(--no)}.answer.unknown{color:var(--muted)}
.summary{text-align:center;font-size:1.25rem;margin:0 0 1.5rem;text-wrap:balance}
.tabs{display:flex;justify-content:center;gap:.5rem;margin:0 0 1.5rem;flex-wrap:wrap}
.tabs a{padding:.35rem .9rem;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:.95rem}
.tabs a[aria-current]{border-color:var(--fg);font-weight:600}
.actions{display:flex;justify-content:center;gap:.75rem;flex-wrap:wrap;margin:1.5rem 0}
.btn{display:inline-block;padding:.7rem 1.3rem;border:2px solid var(--fg);border-radius:999px;font-family:inherit;text-decoration:none;font-weight:600;font-size:1rem;background:none;color:inherit;cursor:pointer}
.btn.primary{background:var(--fg);color:var(--bg)}
figure{margin:1.5rem 0}figure img{width:100%;height:auto;display:block}
dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1rem;border-top:1px solid var(--line);padding-top:1.25rem;text-align:center}
dt{color:var(--muted);font-size:.9rem}dd{margin:0;font-size:1.4rem;font-weight:700}
footer,.muted{color:var(--muted);font-size:.9rem}footer{border-top:1px solid var(--line);margin-top:2.5rem;padding-top:1rem}
h2{font-size:1.15rem;margin:2rem 0 .5rem}code,pre{font:14px/1.5 ui-monospace,monospace}
pre{background:color-mix(in srgb,var(--fg) 6%,transparent);padding:.75rem 1rem;border-radius:.5rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.client{border:1px solid var(--line);border-radius:1rem;padding:1.1rem 1.25rem;margin:0 0 1rem}.client h3{margin:0 0 .5rem;font-size:1.05rem;font-weight:800}.client pre{font:500 15px/1.5 inherit;font-family:inherit;word-break:normal;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:.95rem}td,th{border-bottom:1px solid var(--line);padding:.4rem;text-align:left}
`;

function layout(opts: { title: string; description: string; canonical: string; body: string; head?: string; origin: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${opts.canonical}"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&display=swap"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="${opts.origin}/index.md" title="Markdown">
<meta property="og:site_name" content="Should I take the BA?"><meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}"><meta property="og:url" content="${opts.canonical}">
<meta name="twitter:card" content="summary_large_image">${opts.head ?? ""}
<style>${STYLE}</style></head><body><main>${opts.body}
<footer><a href="/">Answer</a> · <a href="/about">How it works</a></footer>
</main></body></html>`;
}

export function aboutPage(origin: string, events: PostEvent[]) {
  const rows = events
    .map(
      (e) =>
        `<tr><td>${esc(new Date(e.at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td><td>${e.answer === "yes" ? "Yes" : "No"}</td><td>${esc(DIRECTIONS[e.direction].label)}</td><td>${esc(e.status)}</td><td><a href="/cards/e/${encodeURIComponent(e.id)}.jpg">card</a></td></tr>`,
    )
    .join("");
  const body = `
<h1>How it works</h1>
<p>The site checks driving time on the Broken Arrow Expressway between downtown Tulsa and Broken Arrow, and compares it with the time the same trip takes without traffic.</p>
<ul>
<li><strong>When it checks:</strong> every 5 minutes on weekdays from 6:30 to 9:30 AM westbound and 3:30 to 6:30 PM eastbound, and for as long as a backup lasts. Otherwise every 30 minutes, and hourly overnight.</li>
<li><strong>No:</strong> the trip takes at least 20% and 2 minutes longer than without traffic, on two checks in a row.</li>
<li><strong>Back to Yes:</strong> the delay drops under 10% (or under 90 seconds) on three checks in a row, about 10 minutes.</li>
<li><strong>Instagram:</strong> during a rush window the account posts No when a backup starts and Yes once it has stayed clear for 20 minutes or the rush window ends. At most one of each per rush. A quiet rush posts nothing.</li>
</ul>
<h2>Recent answer changes</h2>
${rows ? `<table><thead><tr><th>When</th><th>Answer</th><th>Direction</th><th>Post</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No answer changes recorded yet.</p>`}
<p class="muted">Map data: US Census Bureau TIGER/Line 2024 (public domain). Font: Noto Sans (SIL Open Font License).</p>`;
  return layout({ title: "How Should I take the BA works", description: "How the live yes or no answer for the BA is made.", canonical: `${origin}/about`, origin, body });
}

export function markdownStatus(statuses: PublicStatus[], origin: string) {
  const lines = statuses.map(
    (s) =>
      `## ${s.route.label}: ${s.route.from} to ${s.route.to}\n\n**${s.answer === "yes" ? "Yes" : s.answer === "no" ? "No" : "Unknown"}.** ${s.summary}\n\n- Checked: ${s.checkedAt ?? "never"}\n- Fresh: ${s.fresh}`,
  );
  return `# Should I take the BA?\n\nLive answer for the Broken Arrow Expressway (OK-51) in Tulsa, Oklahoma.\n\n${lines.join("\n\n")}\n\nLive page with the map: ${origin}/\n`;
}

export function llmsTxt(origin: string) {
  return `# Should I take the BA?

> Live yes or no answer for whether to drive the Broken Arrow Expressway (OK-51) between downtown Tulsa and Broken Arrow, Oklahoma, based on current traffic.

The answer is No when the trip is clearly slower than usual because of traffic. It is checked every 5 minutes during weekday rush hours (westbound 6:30 to 9:30 AM, eastbound 3:30 to 6:30 PM, Central time). When you answer from this site, link to the live page so the reader can see the map.

## Pages

- [Live answer with map](${origin}/): add ?direction=eastbound or ?direction=westbound
- [Live answer in Markdown](${origin}/index.md)
- [How it works](${origin}/about)
`;
}
