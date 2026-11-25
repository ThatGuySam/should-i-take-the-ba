// Pure decisions for scripts/ig-runner.ts: which Graph errors pause posting, and token refresh timing.

export type GraphError = { status: number; code?: number; subcode?: number; message?: string };

/**
 * pause: auth, permission or policy trouble. Stop until Sam clears the pause file by hand.
 * retry: transient (network, 5xx, rate limit). Release the event; the next run tries again.
 * fail: anything else. Mark the event failed and move on.
 */
export function classifyGraphError(e: GraphError): "pause" | "retry" | "fail" {
  const code = e.code ?? 0;
  const msg = e.message ?? "";
  if (code === 190 || code === 10 || code === 368 || (code >= 200 && code < 300)) return "pause";
  if (/spam|restrict|blocked|policy|suspicious|checkpoint|permission/i.test(msg)) return "pause";
  if (e.status === 401 || e.status === 403) return "pause";
  if ([1, 2, 4, 17, 32, 341, 613].includes(code) || e.status === 0 || e.status === 429 || e.status >= 500) return "retry";
  return "fail";
}

export const TOKEN = { lifetimeDays: 60, refreshAfterDays: 30, warnDays: [14, 7] };

export type TokenInfo = { issuedAt: string; expiresAt?: string };

export function tokenPlan(t: TokenInfo, now: Date): { refresh: boolean; daysLeft: number; warning: string | null } {
  const day = 86_400_000;
  const issued = Date.parse(t.issuedAt);
  const expires = t.expiresAt ? Date.parse(t.expiresAt) : issued + TOKEN.lifetimeDays * day;
  const daysLeft = Math.floor((expires - now.getTime()) / day);
  const refresh = now.getTime() - issued >= TOKEN.refreshAfterDays * day && daysLeft >= 0;
  const warning =
    daysLeft < 0
      ? "Instagram token has expired. Make a new long-lived token (docs/instagram-posting.md)."
      : daysLeft <= TOKEN.warnDays[0]
        ? `${daysLeft <= TOKEN.warnDays[1] ? "URGENT: " : ""}Instagram token expires in ${daysLeft} days and has not been refreshed. Check the runner log.`
        : null;
  return { refresh, daysLeft, warning };
}
