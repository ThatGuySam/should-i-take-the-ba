import { buildFacts } from "./core/caption";
import type { PostEvent } from "./monitor";

export type Env = {
  ASSETS: Fetcher;
  MONITOR: DurableObjectNamespace<import("./monitor").Monitor>;
  CARDS: R2Bucket;
  IMAGES?: ImagesBinding;
  PUBLIC_ORIGIN: string;
  TRAFFIC_PROVIDER?: string;
  GOOGLE_MAPS_API_KEY?: string;
  INSTAGRAM_MODE?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  ADMIN_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
};

export type PublishUpdate = { status: string; containerId?: string; mediaId?: string; error?: string; caption?: string };

const GRAPH = "https://graph.instagram.com/v27.0";

async function graph(path: string, params: Record<string, string>, token: string, method = "POST") {
  const url = new URL(`${GRAPH}/${path}`);
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } };
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const err = body.error as { message?: string; code?: number } | undefined;
    throw new Error(`Graph ${response.status} code ${err?.code ?? "?"}: ${err?.message ?? "unknown"}`);
  }
  return body;
}

/**
 * Worker-side publisher for INSTAGRAM_MODE "live" (template caption). "dry-run" records what would
 * have posted. "local" never reaches here: the runner on Sam's machine publishes (scripts/ig-runner.ts).
 */
export async function publishEvent(event: PostEvent, env: Env): Promise<PublishUpdate> {
  const facts = buildFacts(event, env.PUBLIC_ORIGIN);
  if (env.INSTAGRAM_MODE !== "live") return { status: "dry-run", caption: facts.templateCaption };
  if (!env.INSTAGRAM_USER_ID || !env.INSTAGRAM_ACCESS_TOKEN) {
    return { status: "held", error: "INSTAGRAM_MODE is live but the account ID or token is missing" };
  }
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  let containerId = event.containerId ?? undefined;
  try {
    if (!containerId) {
      const created = await graph(
        `${env.INSTAGRAM_USER_ID}/media`,
        { image_url: facts.imageUrl, caption: facts.templateCaption, alt_text: facts.altText },
        token,
      );
      containerId = String(created.id);
    }
    for (let i = 0; i < 6; i++) {
      const s = await graph(containerId, { fields: "status_code" }, token, "GET");
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "PUBLISHED") return { status: "held", containerId, error: "container already published; check the account" };
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") return { status: "failed", containerId, error: `container ${s.status_code}` };
      if (i === 5) return { status: "container", containerId };
      await new Promise((r) => setTimeout(r, 10_000));
    }
    const published = await graph(`${env.INSTAGRAM_USER_ID}/media_publish`, { creation_id: containerId }, token);
    return { status: "published", containerId, mediaId: String(published.id), caption: facts.templateCaption };
  } catch (error) {
    return { status: containerId ? "held" : "failed", containerId, error: String(error) };
  }
}
