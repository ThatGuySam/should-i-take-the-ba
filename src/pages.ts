import { DIRECTIONS, type DirectionId } from "./config";
import type { PostEvent } from "./monitor";
import { formatTime, type PublicStatus } from "./status";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const STYLE = `
:root{color-scheme:light dark;--fg:#111;--bg:#fff;--muted:#555;--line:#e5e7eb;--yes:#15803d;--no:#b91c1c}
@media (prefers-color-scheme:dark){:root{--fg:#f3f4f6;--bg:#111214;--muted:#a1a1aa;--line:#2a2b2f}}
*{box-sizing:border-box}body{margin:0;font:18px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
a{color:inherit}h1{font-size:1.4rem;font-weight:400;text-align:center;margin:0 0 .5rem}
.answer{font-size:clamp(5rem,22vw,9rem);font-weight:900;line-height:1;text-align:center;margin:.25rem 0 1rem;letter-spacing:-.03em}
.answer.no{color:var(--no)}.answer.unknown{color:var(--muted)}
.summary{text-align:center;font-size:1.25rem;margin:0 0 1.5rem;text-wrap:balance}
.tabs{display:flex;justify-content:center;gap:.5rem;margin:0 0 1.5rem;flex-wrap:wrap}
.tabs a{padding:.35rem .9rem;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:.95rem}
.tabs a[aria-current]{border-color:var(--fg);font-weight:600}
.actions{display:flex;justify-content:center;gap:.75rem;flex-wrap:wrap;margin:1.5rem 0}
.btn{display:inline-block;padding:.6rem 1.1rem;border:1px solid var(--fg);border-radius:.6rem;text-decoration:none;font-weight:600;font-size:1rem;background:none;color:inherit;cursor:pointer}
.btn.primary{background:var(--fg);color:var(--bg)}
figure{margin:1.5rem 0}figure img{width:100%;height:auto;display:block}
dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1rem;border-top:1px solid var(--line);padding-top:1.25rem;text-align:center}
dt{color:var(--muted);font-size:.9rem}dd{margin:0;font-size:1.4rem;font-weight:700}
footer,.muted{color:var(--muted);font-size:.9rem}footer{border-top:1px solid var(--line);margin-top:2.5rem;padding-top:1rem}
h2{font-size:1.15rem;margin:2rem 0 .5rem}code,pre{font:14px/1.5 ui-monospace,monospace}
pre{background:color-mix(in srgb,var(--fg) 6%,transparent);padding:.75rem 1rem;border-radius:.5rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.clients{display:grid;gap:1rem}.client{border:1px solid var(--line);border-radius:.75rem;padding:1rem 1.1rem}.client h3{margin:0 0 .5rem;font-size:1rem}
table{border-collapse:collapse;width:100%;font-size:.95rem}td,th{border-bottom:1px solid var(--line);padding:.4rem;text-align:left}
`;

function layout(opts: { title: string; description: string; canonical: string; body: string; head?: string; origin: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${opts.canonical}"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/json" href="${opts.origin}/api/v1/status" title="Status API">
<link rel="alternate" type="text/markdown" href="${opts.origin}/index.md" title="Markdown">
<meta property="og:site_name" content="Should I take the BA?"><meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}"><meta property="og:url" content="${opts.canonical}">
<meta name="twitter:card" content="summary_large_image">${opts.head ?? ""}
<style>${STYLE}</style></head><body><main>${opts.body}
<footer><a href="/">Answer</a> · <a href="/agents">Ask your agent</a> · <a href="/about">How it works</a> · <a href="/api/v1/status">API</a> · <a href="/llms.txt">llms.txt</a></footer>
</main></body></html>`;
}

export function homePage(status: PublicStatus, other: PublicStatus, origin: string) {
  const d = DIRECTIONS[status.direction];
  const word = status.answer === "yes" ? "Yes" : status.answer === "no" ? "No" : "Not sure";
  const title = "Should I take the BA? Live Broken Arrow Expressway traffic in Tulsa";
  const description = "A live yes or no on whether to drive the Broken Arrow Expressway (OK-51) between downtown Tulsa and Broken Arrow, checked every 5 minutes at rush hour.";
  const card = `${origin}/card/latest.jpg?direction=${status.direction}&v=${encodeURIComponent(status.checkedAt ?? "none")}`;
  const tab = (id: DirectionId) =>
    `<a href="/?direction=${id}"${id === status.direction ? ' aria-current="page"' : ""}>${DIRECTIONS[id].label}: ${esc(DIRECTIONS[id].from)} → ${esc(DIRECTIONS[id].to)}</a>`;
  const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${d.origin.lat},${d.origin.lng}&destination=${d.destination.lat},${d.destination.lng}&travelmode=driving`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Should I take the BA?",
    description: "Live yes or no answer for the Broken Arrow Expressway (OK-51) in Tulsa, Oklahoma, based on current traffic delay.",
    url: `${origin}/`,
    ...(status.checkedAt ? { dateModified: status.checkedAt } : {}),
    about: { "@type": "Place", name: "Broken Arrow Expressway (OK-51), Tulsa, Oklahoma" },
  };
  const body = `
<h1>Should I take the BA?</h1>
<nav class="tabs" aria-label="Direction">${tab("westbound")}${tab("eastbound")}</nav>
<p class="answer ${status.answer}">${word}</p>
<p class="summary">${esc(status.summary)}</p>
<div class="actions"><a class="btn" href="${mapUrl}">View route in Google Maps</a><a class="btn primary" href="/agents">Ask your agent</a></div>
<figure><img src="/map.svg" width="960" height="620" alt="Map of the Broken Arrow Expressway from downtown Tulsa to Broken Arrow"></figure>
<dl>
<div><dt>Checked</dt><dd>${status.checkedAt ? `<time datetime="${status.checkedAt}">${formatTime(status.checkedAt)}</time>` : "–"}</dd></div>
</dl>
<p class="muted">${DIRECTIONS[other.direction].label}: <strong>${other.answer === "yes" ? "Yes" : other.answer === "no" ? "No" : "Not sure"}</strong>. ${esc(other.summary)}</p>
<p class="muted">The answer is No when the trip takes at least 20% and 2 minutes longer than it would without traffic, and switches back to Yes once the delay has stayed under 10% for about 10 minutes. ${esc(status.source)}. Travel times are not stored; only the Yes or No is kept.</p>`;
  return layout({
    title,
    description,
    canonical: `${origin}/`,
    origin,
    body,
    head: `<meta property="og:image" content="${card}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350"><meta http-equiv="refresh" content="300"><script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  });
}

export function agentsPage(origin: string) {
  const mcp = `${origin}/mcp`;
  const name = "should-i-take-the-ba";
  const claudeUrl = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("Should I take the BA")}&connectorUrl=${encodeURIComponent(mcp)}`;
  const vscodeUrl = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: "http", url: mcp }))}`;
  const cursorUrl = `cursor://anysphere.cursor-deeplink/mcp/install?name=${name}&config=${btoa(JSON.stringify({ url: mcp }))}`;
  const prompt = `Before I drive, fetch ${origin}/api/v1/status and tell me whether I should take the BA (Broken Arrow Expressway in Tulsa) right now, and when it was checked.`;
  const body = `
<h1>Ask your agent</h1>
<p class="summary">Set this up once. Then ask your AI agent “Should I take the BA?” and it checks live traffic for you.</p>
<p class="muted">MCP server URL (no sign-in needed): <code>${mcp}</code></p>
<div class="clients">
<section class="client"><h3>Claude (web and desktop)</h3><p>Opens Claude’s add-connector form with the name and URL filled in. You review and confirm.</p><a class="btn primary" href="${claudeUrl}">Add to Claude</a></section>
<section class="client"><h3>Claude Code</h3><pre>claude mcp add --transport http ${name} ${mcp}</pre></section>
<section class="client"><h3>VS Code</h3><a class="btn" href="${vscodeUrl}">Install in VS Code</a></section>
<section class="client"><h3>Cursor</h3><a class="btn" href="${cursorUrl}">Install in Cursor</a></section>
<section class="client"><h3>ChatGPT</h3><p>ChatGPT has no install link. On the web, open Settings → Apps (or Plugins) → Add custom MCP server, paste the URL above and choose “No authentication”. Availability depends on your plan.</p></section>
<section class="client"><h3>Any agent that can browse</h3><p>Paste this into your agent, or save it as a custom instruction:</p><pre id="prompt">${esc(prompt)}</pre><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('prompt').textContent);this.textContent='Copied'">Copy prompt</button></section>
</div>
<h2>For developers</h2>
<p>JSON: <a href="/api/v1/status">/api/v1/status</a> (add <code>?direction=eastbound</code> or <code>westbound</code>) · OpenAPI: <a href="/openapi.json">/openapi.json</a> · Markdown: <a href="/index.md">/index.md</a> · <a href="/llms.txt">/llms.txt</a></p>`;
  return layout({
    title: "Ask your agent if you should take the BA",
    description: "Connect Claude, ChatGPT, Cursor, VS Code or any agent to live Broken Arrow Expressway traffic answers.",
    canonical: `${origin}/agents`,
    origin,
    body,
  });
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
<li><strong>Instagram:</strong> during a rush window the account posts No when a backup starts and Yes when it clears. A quiet rush posts nothing.</li>
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
  return `# Should I take the BA?\n\nLive answer for the Broken Arrow Expressway (OK-51) in Tulsa, Oklahoma.\n\n${lines.join("\n\n")}\n\nJSON: ${origin}/api/v1/status · MCP: ${origin}/mcp\n`;
}

export function llmsTxt(origin: string) {
  return `# Should I take the BA?

> Live yes or no answer for whether to drive the Broken Arrow Expressway (OK-51) between downtown Tulsa and Broken Arrow, Oklahoma, based on the current traffic delay.

The answer is No when the trip takes at least 20% and 2 minutes longer than without traffic. Readings refresh every 5 minutes during weekday rush hours.

## Live data

- [Status JSON](${origin}/api/v1/status): both directions; add ?direction=eastbound or ?direction=westbound
- [Status in Markdown](${origin}/index.md)
- [OpenAPI description](${origin}/openapi.json)
- [MCP server](${origin}/mcp): Streamable HTTP, no auth, one read-only tool \`get_ba_status\`

## Pages

- [Answer](${origin}/)
- [Ask your agent](${origin}/agents): setup for Claude, ChatGPT, Cursor and VS Code
- [How it works](${origin}/about)
`;
}

export function openApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: { title: "Should I take the BA?", version: "1.0.0", description: "Live yes or no answer for the Broken Arrow Expressway in Tulsa." },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/status": {
        get: {
          operationId: "getBaStatus",
          summary: "Should I take the BA right now?",
          parameters: [{ name: "direction", in: "query", required: false, schema: { type: "string", enum: ["eastbound", "westbound"] } }],
          responses: { "200": { description: "Current answer", content: { "application/json": { schema: { $ref: "#/components/schemas/StatusResponse" } } } } },
        },
      },
    },
    components: {
      schemas: {
        Status: {
          type: "object",
          properties: {
            direction: { type: "string", enum: ["eastbound", "westbound"] },
            answer: { type: "string", enum: ["yes", "no", "unknown"] },
            summary: { type: "string" },
            checkedAt: { type: ["string", "null"], format: "date-time" },
            fresh: { type: "boolean" },
          },
        },
        StatusResponse: {
          type: "object",
          properties: { recommended: { $ref: "#/components/schemas/Status" }, directions: { type: "array", items: { $ref: "#/components/schemas/Status" } } },
        },
      },
    },
  };
}
