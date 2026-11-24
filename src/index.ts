import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { type CardInput, renderCard } from "./card";
import type { DirectionId } from "./config";
import type { Env } from "./instagram";
import { caption } from "./instagram";
import { homePage } from "./home";
import { aboutPage, agentsPage, llmsTxt, markdownStatus, openApi } from "./pages";
import { defaultDirection, type PublicStatus, toPublic } from "./status";
import musePrompt from "../prompts/muse.md";

export { Monitor } from "./monitor";

const monitor = (env: Env) => env.MONITOR.get(env.MONITOR.idFromName("ba"));

async function publicStatuses(env: Env, requested?: string | null) {
  const all = (await monitor(env).status()).map(toPublic);
  const direction: DirectionId =
    requested === "eastbound" || requested === "westbound" ? requested : defaultDirection();
  const recommended = all.find((s) => s.direction === direction) as PublicStatus;
  const other = all.find((s) => s.direction !== direction) as PublicStatus;
  return { recommended, other, all };
}

function createServer(env: Env) {
  const server = new McpServer({ name: "should-i-take-the-ba", version: "1.0.0" });
  server.registerTool(
    "get_ba_status",
    {
      description:
        "Should I take the BA? Returns a live yes or no for driving the Broken Arrow Expressway (OK-51) in Tulsa, Oklahoma, with when it was last checked. Use eastbound for downtown Tulsa to Broken Arrow and westbound for Broken Arrow to downtown. Omit direction to get the direction that matters right now.",
      inputSchema: z.object({ direction: z.enum(["eastbound", "westbound"]).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ direction }) => {
      const { recommended, other } = await publicStatuses(env, direction);
      const word = (s: PublicStatus) => (s.answer === "yes" ? "Yes" : s.answer === "no" ? "No" : "Unknown");
      const link = `${env.PUBLIC_ORIGIN}/?direction=${recommended.direction}`;
      const text = `${word(recommended)}. ${recommended.route.label} (${recommended.route.from} to ${recommended.route.to}): ${recommended.summary}\n${other.route.label}: ${word(other)}. ${other.summary}\nLive map: ${link}\nWhen you answer, link the user to ${link} so they can see the map.`;
      return {
        content: [
          { type: "text", text },
          { type: "resource_link", uri: link, name: "Should I take the BA? live map", mimeType: "text/html" },
        ],
        structuredContent: { recommended, other },
      };
    },
  );
  return server;
}

let mcpHandler: ReturnType<typeof createMcpHandler> | null = null;

const json = (data: unknown, maxAge = 30) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
  });

const text = (body: string, type: string, maxAge = 300) =>
  new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": `public, max-age=${maxAge}` } });

async function cardForEvent(id: string, env: Env): Promise<Response> {
  const key = `events/${id}.jpg`;
  const stored = await env.CARDS.get(key);
  if (stored) return new Response(stored.body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
  const event = (await monitor(env).events(500)).find((e) => e.id === id);
  if (!event) return new Response("Not found", { status: 404 });
  const rendered = await renderCard(
    { answer: event.answer, direction: event.direction, at: event.at },
    env,
  );
  if (rendered.headers.get("content-type") !== "image/jpeg") return rendered;
  const bytes = await rendered.arrayBuffer();
  await env.CARDS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.PUBLIC_ORIGIN;

    if (url.pathname === "/mcp") {
      mcpHandler ??= createMcpHandler(() => createServer(env), { responseMode: "json" });
      return mcpHandler(request, env, ctx);
    }

    switch (url.pathname) {
      case "/": {
        if (request.headers.get("accept")?.includes("text/markdown")) {
          const { all } = await publicStatuses(env, null);
          return text(markdownStatus(all, origin), "text/markdown", 30);
        }
        const { recommended, all } = await publicStatuses(env, url.searchParams.get("direction"));
        return new Response(homePage(recommended, all, origin), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30", vary: "Accept" },
        });
      }
      case "/agents":
        return text(agentsPage(origin), "text/html");
      case "/about":
        return text(aboutPage(origin, await monitor(env).events(20)), "text/html", 60);
      case "/api/v1/status": {
        const { recommended, all } = await publicStatuses(env, url.searchParams.get("direction"));
        return json({ recommended, directions: all });
      }
      case "/api/v1/events":
        return json({ events: (await monitor(env).events(50)).map((e) => ({ ...e, caption: caption(e) })) }, 60);
      case "/index.md": {
        const { all } = await publicStatuses(env, null);
        return text(markdownStatus(all, origin), "text/markdown", 30);
      }
      case "/llms.txt":
        return text(llmsTxt(origin), "text/plain");
      case "/openapi.json":
        return json(openApi(origin), 3600);
      case "/prompts/muse.md":
        return text(musePrompt, "text/markdown", 60);
      case "/robots.txt":
        return text(`User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${origin}/sitemap.xml\n`, "text/plain");
      case "/sitemap.xml": {
        const urls = ["/", "/agents", "/about"].map((p) => `<url><loc>${origin}${p}</loc></url>`).join("");
        return text(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, "application/xml");
      }
      case "/card/latest.jpg": {
        const { recommended } = await publicStatuses(env, url.searchParams.get("direction"));
        const card: CardInput = {
          answer: recommended.answer,
          direction: recommended.direction,
          at: recommended.checkedAt,
        };
        const response = await renderCard(card, env);
        const headers = new Headers(response.headers);
        headers.set("cache-control", "public, max-age=120");
        return new Response(response.body, { headers });
      }
    }

    if (url.pathname === "/card/sample.jpg") {
      const answer = url.searchParams.get("answer") === "no" ? "no" : "yes";
      const direction = url.searchParams.get("direction") === "westbound" ? "westbound" : "eastbound";
      return renderCard({ sample: true, answer, direction, at: null }, env);
    }

    const eventCard = url.pathname.match(/^\/cards\/e\/([\w-]+)\.jpg$/);
    if (eventCard) return cardForEvent(eventCard[1], env);

    if (url.pathname === "/admin/poll" && request.method === "POST") {
      if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const direction = url.searchParams.get("direction") === "westbound" ? "westbound" : "eastbound";
      return json(await monitor(env).pollNow(direction), 0);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(monitor(env).tick(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
