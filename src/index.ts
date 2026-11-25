import { type CardInput, renderCard } from "./card";
import type { DirectionId } from "./config";
import { buildFacts } from "./core/caption";
import type { Env } from "./instagram";
import { RESULT_STATUSES } from "./monitor";
import { homePage } from "./home";
import { parseSubscription } from "./push";
import { aboutPage, llmsTxt, markdownStatus } from "./pages";
import { defaultDirection, type PublicStatus, toPublic } from "./status";
import musePrompt from "../prompts/muse.md";

export { Monitor } from "./monitor";

const monitor = (env: Env) => env.MONITOR.get(env.MONITOR.idFromName("ba"));

async function publicStatuses(env: Env, requested?: string | null) {
  const all = (await monitor(env).status()).map((s) => toPublic(s, env.PUBLIC_ORIGIN));
  const direction: DirectionId =
    requested === "eastbound" || requested === "westbound" ? requested : defaultDirection();
  const recommended = all.find((s) => s.direction === direction) as PublicStatus;
  const other = all.find((s) => s.direction !== direction) as PublicStatus;
  return { recommended, other, all };
}


// The JSON endpoints serve the page's own refresh and Muse. They are not advertised to agents.
const json = (data: unknown, maxAge = 30, noindex = false) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      ...(noindex ? { "x-robots-tag": "noindex" } : {}),
    },
  });

const text = (body: string, type: string, maxAge = 300) =>
  new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": `public, max-age=${maxAge}` } });

async function cardForEvent(id: string, env: Env): Promise<Response> {
  const key = `events/${id}.jpg`;
  const stored = await env.CARDS.get(key);
  if (stored) return new Response(stored.body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
  const event = await monitor(env).getEvent(id);
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

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = env.PUBLIC_ORIGIN;

  switch (url.pathname) {
    case "/": {
      if (request.headers.get("accept")?.includes("text/markdown")) {
        const { all } = await publicStatuses(env, null);
        return text(markdownStatus(all, origin), "text/markdown", 30);
      }
      const { recommended, all } = await publicStatuses(env, url.searchParams.get("direction"));
      return new Response(homePage(recommended, all, origin, env.VAPID_PUBLIC_KEY), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30", vary: "Accept" },
      });
    }
    case "/agents":
      return Response.redirect(`${origin}/`, 301);
    case "/about":
      return text(aboutPage(origin, await monitor(env).events(20)), "text/html", 60);
    case "/api/v1/status": {
      const { recommended, all } = await publicStatuses(env, url.searchParams.get("direction"));
      return json({ recommended, directions: all }, 30, true);
    }
    case "/api/v1/watch": {
      if (request.method !== "POST" && request.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
      const body = await request.json().catch(() => null);
      if (request.method === "DELETE") {
        const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
        if (typeof endpoint === "string") await monitor(env).removeWatch(endpoint);
        return json({ ok: true }, 0, true);
      }
      const target = parseSubscription(body);
      const b = body as { direction?: unknown; minutes?: unknown } | null;
      const direction = b?.direction === "eastbound" || b?.direction === "westbound" ? b.direction : null;
      if (!target || !direction) return json({ ok: false, error: "subscription and direction required" }, 0, true);
      const minutes = typeof b?.minutes === "number" ? b.minutes : 90;
      return json({ ok: true, ...(await monitor(env).addWatch(target, direction, minutes)) }, 0, true);
    }
    case "/api/v1/events":
      return json(
        {
          events: (await monitor(env).events(50)).map(({ extra, claimedAt, ...e }) => ({
            ...e,
            caption: e.caption ?? buildFacts({ ...e, extra }, origin).templateCaption,
            captionPosted: e.caption !== null,
          })),
        },
        60,
        true,
      );
    case "/index.md": {
      const { all } = await publicStatuses(env, null);
      return text(markdownStatus(all, origin), "text/markdown", 30);
    }
    case "/llms.txt":
      return text(llmsTxt(origin), "text/plain");
    case "/prompts/muse.md":
      return text(musePrompt, "text/markdown", 60);
    case "/robots.txt":
      return text(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /prompts/\n\nSitemap: ${origin}/sitemap.xml\n`, "text/plain");
    case "/sitemap.xml": {
      const urls = ["/", "/about"].map((p) => `<url><loc>${origin}${p}</loc></url>`).join("");
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

  const authorized = !!env.ADMIN_TOKEN && request.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;

  // Local Instagram runner (scripts/ig-runner.ts, docs/instagram-posting.md).
  if (url.pathname.startsWith("/admin/posts")) {
    if (!authorized) return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/admin/posts/next" && request.method === "GET") {
      const next = await monitor(env).nextPost();
      const mode = env.INSTAGRAM_MODE ?? "dry-run";
      if (!next) return json({ mode, event: null }, 0);
      return json({ mode, publishable: next.publishable, event: buildFacts(next.event, origin) }, 0);
    }
    if (url.pathname === "/admin/posts/log" && request.method === "GET") return json({ log: await monitor(env).postLog() }, 0);
    const m = url.pathname.match(/^\/admin\/posts\/([\w-]+)\/(claim|result)$/);
    if (m && request.method === "POST") {
      if (m[2] === "claim") {
        const event = await monitor(env).claimPost(m[1]);
        return event ? json({ ok: true, event: buildFacts(event, origin) }, 0) : new Response("Not claimable", { status: 409 });
      }
      const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      if (!b || typeof b.status !== "string" || !RESULT_STATUSES.includes(b.status)) {
        return new Response(`status must be one of ${RESULT_STATUSES.join(", ")}`, { status: 400 });
      }
      const event = await monitor(env).reportPost(m[1], {
        status: b.status,
        containerId: str(b.containerId),
        mediaId: str(b.mediaId),
        error: str(b.error)?.slice(0, 500),
        caption: str(b.caption)?.slice(0, 2200),
      });
      return event ? json({ ok: true, event }, 0) : new Response("Not found", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  }

  if (url.pathname === "/admin/poll" && request.method === "POST") {
    if (!authorized) return new Response("Unauthorized", { status: 401 });
    const direction = url.searchParams.get("direction") === "westbound" ? "westbound" : "eastbound";
    return json(await monitor(env).pollNow(direction), 0);
  }

  if (url.pathname === "/admin/history" && request.method === "GET") {
    if (!authorized) return new Response("Unauthorized", { status: 401 });
    const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 14));
    return json(await monitor(env).historyReport(days), 0);
  }

  return env.ASSETS.fetch(request);
}

/** Only the production host may be indexed; previews (beta., workers.dev) are noindex everywhere. */
const PRODUCTION_HOST = "shoulditaketheba.com";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const host = new URL(request.url).hostname;
    if (host === PRODUCTION_HOST) return handle(request, env);
    if (new URL(request.url).pathname === "/robots.txt") return text("User-agent: *\nDisallow: /\n", "text/plain");
    const res = await handle(request, env);
    const out = new Response(res.body, res);
    out.headers.set("x-robots-tag", "noindex");
    return out;
  },


  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(monitor(env).tick(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
