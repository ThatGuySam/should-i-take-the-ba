import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushEnv = { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; PUBLIC_ORIGIN: string };

export function parseSubscription(body: unknown): PushTarget | null {
  const sub = (body as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } } | null)?.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 1000 || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

/** Sends one notification. Returns "gone" when the browser says the subscription no longer exists. */
export async function sendPush(env: PushEnv, target: PushTarget, message: { title: string; body: string; url: string; tag: string }) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return "error" as const;
  const subscription: PushSubscription = { endpoint: target.endpoint, expirationTime: null, keys: { p256dh: target.p256dh, auth: target.auth } };
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.PUBLIC_ORIGIN };
  try {
    const payload = await buildPushPayload({ data: JSON.stringify(message), options: { ttl: 1800, urgency: "high", topic: message.tag } }, subscription, vapid);
    const res = await fetch(target.endpoint, { ...payload, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (res.ok) return "sent" as const;
    return res.status === 404 || res.status === 410 ? ("gone" as const) : ("error" as const);
  } catch {
    return "error" as const;
  }
}
