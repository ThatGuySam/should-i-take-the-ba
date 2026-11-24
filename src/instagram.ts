import { cardLines } from "./card";
import { DIRECTIONS } from "./config";
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

export type PublishUpdate = { status: string; containerId?: string; mediaId?: string; error?: string };

const GRAPH = "https://graph.instagram.com/v27.0";

export function caption(event: Pick<PostEvent, "answer" | "direction" | "at">): string {
  const [route, traffic, when] = cardLines({ ...event, answer: event.answer });
  const lead =
    event.answer === "no"
      ? `No. Traffic is backing up on the BA ${DIRECTIONS[event.direction].label.toLowerCase()}.`
      : "Yes. The BA has cleared up.";
  return [lead, "", route, traffic, when, "", "Live answer: shoulditaketheba.com"].join("\n");
}

export const altText = (event: Pick<PostEvent, "answer" | "direction" | "at">) =>
  `Should I take the BA? ${event.answer === "yes" ? "Yes" : "No"}. ${cardLines({ ...event }).join(". ")}. Map of the Broken Arrow Expressway from downtown Tulsa to Broken Arrow.`;

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

export async function publishEvent(event: PostEvent, env: Env): Promise<PublishUpdate> {
  if (env.INSTAGRAM_MODE !== "live") return { status: "dry-run" };
  if (!env.INSTAGRAM_USER_ID || !env.INSTAGRAM_ACCESS_TOKEN) {
    return { status: "held", error: "INSTAGRAM_MODE is live but the account ID or token is missing" };
  }
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  let containerId = event.containerId ?? undefined;
  try {
    if (!containerId) {
      const created = await graph(
        `${env.INSTAGRAM_USER_ID}/media`,
        { image_url: `${env.PUBLIC_ORIGIN}/cards/e/${event.id}.jpg`, caption: caption(event), alt_text: altText(event) },
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
    return { status: "published", containerId, mediaId: String(published.id) };
  } catch (error) {
    return { status: containerId ? "held" : "failed", containerId, error: String(error) };
  }
}
