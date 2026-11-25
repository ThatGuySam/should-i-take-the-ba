// Local Instagram runner. Asks the Worker for the next publishable event, drafts a caption with
// Sonnet (prompts/caption.md), checks it, posts through the Instagram Graph API and reports back.
//   bun scripts/ig-runner.ts [--dry-run] [--once] [--origin URL]
// With no event waiting it makes one small HTTP request and exits. See docs/instagram-posting.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanDraft, type PostFacts, validateCaption } from "../src/core/caption";
import { classifyGraphError, type GraphError, tokenPlan } from "../src/core/igrunner";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = process.env.BA_IG_DIR ?? join(homedir(), ".config", "should-i-take-the-ba");
const IG_FILE = join(DIR, "instagram.json");
const PAUSE_FILE = join(DIR, "PAUSED");
const GRAPH = "https://graph.instagram.com/v27.0";
const CLAUDE_TIMEOUT_MS = 60_000;
const origin = arg("origin", process.env.BA_ORIGIN ?? "https://shoulditaketheba.com");
const adminToken =
  process.env.ADMIN_TOKEN ??
  (existsSync(join(ROOT, ".dev.vars")) ? readFileSync(join(ROOT, ".dev.vars"), "utf8").match(/^ADMIN_TOKEN=["']?([^"'\n]+)/m)?.[1] : undefined);

type IgConfig = { userId: string; accessToken: string; issuedAt: string; expiresAt?: string };
type Next = { mode: string; publishable?: boolean; event: PostFacts | null };

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

class GraphFail extends Error {
  constructor(public info: GraphError) {
    super(`Graph ${info.status} code ${info.code ?? "?"}${info.subcode ? `/${info.subcode}` : ""}: ${info.message ?? "unknown"}`);
  }
}
class Paused extends Error {}

// ---- Worker admin API ----

async function admin<T>(path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${adminToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("Worker refused ADMIN_TOKEN (401)");
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

const report = (id: string, r: { status: string; containerId?: string; mediaId?: string; error?: string; caption?: string }) =>
  admin(`/admin/posts/${encodeURIComponent(id)}/result`, r).then((x) => {
    if (x.status !== 200) log(`report ${id} → HTTP ${x.status}`);
  });

// ---- Instagram Graph API ----

async function graph(path: string, params: Record<string, string>, token: string, method: "GET" | "POST" = "POST") {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH}/${path}`);
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } };
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new GraphFail({ status: 0, message: String(e) });
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.error) {
    const err = (body.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
    throw new GraphFail({ status: res.status, code: err.code, subcode: err.error_subcode, message: err.message });
  }
  return body;
}

function loadIg(): IgConfig | null {
  if (!existsSync(IG_FILE)) return null;
  const c = JSON.parse(readFileSync(IG_FILE, "utf8")) as IgConfig;
  return c.userId && c.accessToken ? { ...c, issuedAt: c.issuedAt ?? new Date().toISOString() } : null;
}

/** Refresh the long-lived token once it is 30 days old; warn 14 and 7 days before it expires. */
async function freshToken(ig: IgConfig): Promise<IgConfig> {
  const plan = tokenPlan(ig, new Date());
  if (plan.refresh) {
    try {
      const r = await graph("https://graph.instagram.com/refresh_access_token", { grant_type: "ig_refresh_token", access_token: ig.accessToken }, ig.accessToken, "GET");
      const now = new Date();
      const next: IgConfig = {
        ...ig,
        accessToken: String(r.access_token),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + Number(r.expires_in ?? 60 * 86_400) * 1000).toISOString(),
      };
      writeFileSync(IG_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      log(`refreshed Instagram token; expires ${next.expiresAt}`);
      return next;
    } catch (e) {
      log(`WARNING: token refresh failed: ${e}`);
    }
  }
  if (plan.warning) console.error(`WARNING: ${plan.warning}`);
  return ig;
}

function pause(reason: string): never {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(PAUSE_FILE, `${new Date().toISOString()} ${reason}\n`);
  throw new Paused(reason);
}

// ---- Caption ----

async function draft(f: PostFacts): Promise<{ caption: string; source: string }> {
  const { templateCaption, caption, status, containerId, ...facts } = f;
  const prompt = `${readFileSync(join(ROOT, "prompts", "caption.md"), "utf8")}\n\n## Facts\n\n\`\`\`json\n${JSON.stringify({ ...facts, templateCaption }, null, 2)}\n\`\`\`\n`;
  try {
    const proc = Bun.spawn(["claude", "-p", "--model", "sonnet", "--tools", "", "--safe-mode", "--no-session-persistence"], {
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      cwd: ROOT,
    });
    const timer = setTimeout(() => proc.kill(), CLAUDE_TIMEOUT_MS);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) throw new Error(`claude exited ${code}${proc.signalCode ? ` (${proc.signalCode}, timeout?)` : ""}: ${err.trim().slice(0, 300)}`);
    const text = cleanDraft(out);
    const problems = validateCaption(text, f);
    if (problems.length === 0) return { caption: text, source: "sonnet" };
    log(`draft rejected (${problems.join("; ")}):\n${text}`);
  } catch (e) {
    log(`caption draft failed: ${e}`);
  }
  return { caption: templateCaption, source: "template" };
}

// ---- Publishing ----

async function waitForContainer(id: string, token: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const s = await graph(id, { fields: "status_code" }, token, "GET");
    const code = String(s.status_code);
    if (code !== "IN_PROGRESS") return code;
    await Bun.sleep(5_000);
  }
  return "IN_PROGRESS";
}

/** Find the media a published container became, by its caption among the latest posts. */
async function findMedia(ig: IgConfig, caption: string | null): Promise<string | undefined> {
  const r = await graph(`${ig.userId}/media`, { fields: "id,caption,timestamp", limit: "10" }, ig.accessToken, "GET");
  const items = (r.data ?? []) as { id: string; caption?: string }[];
  return items.find((m) => caption && m.caption?.trim() === caption.trim())?.id;
}

async function publish(f: PostFacts, publishable: boolean, ig: IgConfig | null, dryRun: boolean) {
  const claimed = await admin<{ ok: boolean }>(`/admin/posts/${encodeURIComponent(f.id)}/claim`, {});
  if (claimed.status !== 200) return log(`${f.id}: not claimable (HTTP ${claimed.status}); another run has it`);
  let containerId = f.containerId ?? undefined;
  let caption = f.caption ?? undefined;
  try {
    // Reconcile before any retry: a container that already went out must never be posted again.
    if (containerId && ig && !dryRun) {
      const code = await waitForContainer(containerId, ig.accessToken);
      if (code === "PUBLISHED") {
        const mediaId = await findMedia(ig, caption ?? null);
        log(`${f.id}: container ${containerId} was already published${mediaId ? ` as ${mediaId}` : ""}`);
        return report(f.id, { status: "published", containerId, mediaId, error: mediaId ? undefined : "published before; media id not found", caption });
      }
      if (!publishable) return report(f.id, { status: "stale", containerId, error: "unpublished container went stale" });
      if (code === "FINISHED" && caption) {
        const out = await graph(`${ig.userId}/media_publish`, { creation_id: containerId }, ig.accessToken);
        log(`${f.id}: published ${out.id} from existing container`);
        return report(f.id, { status: "published", containerId, mediaId: String(out.id), caption });
      }
      if (code === "IN_PROGRESS") return report(f.id, { status: "container", containerId, caption });
      containerId = undefined; // ERROR or EXPIRED: start over with a new container
    }
    if (!publishable) return report(f.id, { status: "stale", error: "not publishable" });

    const drafted = await draft(f);
    caption = drafted.caption;
    log(`${f.id}: caption from ${drafted.source}:\n${caption}\n`);
    if (dryRun || !ig) return report(f.id, { status: "dry-run", caption });

    const img = await fetch(f.imageUrl);
    await img.arrayBuffer();
    if (!img.ok || !img.headers.get("content-type")?.includes("image/jpeg")) {
      return report(f.id, { status: "failed", error: `card is not a JPEG (HTTP ${img.status}, ${img.headers.get("content-type")})` });
    }
    const created = await graph(`${ig.userId}/media`, { image_url: f.imageUrl, caption, alt_text: f.altText }, ig.accessToken);
    containerId = String(created.id);
    await report(f.id, { status: "container", containerId, caption });
    const code = await waitForContainer(containerId, ig.accessToken);
    if (code === "IN_PROGRESS") return log(`${f.id}: container ${containerId} still processing; the next run reconciles it`);
    if (code !== "FINISHED") return report(f.id, { status: "failed", containerId, error: `container ${code}`, caption });
    const out = await graph(`${ig.userId}/media_publish`, { creation_id: containerId }, ig.accessToken);
    log(`${f.id}: published ${out.id}`);
    return report(f.id, { status: "published", containerId, mediaId: String(out.id), caption });
  } catch (e) {
    const kind = e instanceof GraphFail ? classifyGraphError(e.info) : "retry";
    // Release the claim, keeping the container id, so the next run reconciles before trying again.
    await report(f.id, { status: kind === "fail" ? "failed" : "pending", containerId, error: String(e), caption });
    if (kind === "pause") pause(String(e));
    log(`${f.id}: ${kind === "fail" ? "failed" : "will retry"}: ${e}`);
  }
}

async function main() {
  if (existsSync(PAUSE_FILE)) {
    console.error(`PAUSED: Instagram posting is paused (${readFileSync(PAUSE_FILE, "utf8").trim()}).\nFix the cause, then delete ${PAUSE_FILE} to resume.`);
    process.exit(2);
  }
  if (!adminToken) throw new Error("ADMIN_TOKEN missing (env or .dev.vars)");
  let ig = loadIg();
  const dryRun = flag("dry-run") || !ig;
  const max = flag("once") ? 1 : 3;
  for (let i = 0; i < max; i++) {
    const { data } = await admin<Next>("/admin/posts/next");
    if (!data?.event) return;
    if (data.mode !== "local") {
      if (!dryRun) throw new Error(`Worker INSTAGRAM_MODE is "${data.mode}". The runner posts live only when it is "local"; use --dry-run.`);
      // Preview only: claiming here would take the event away from the Worker's own dry-run/live path.
      const drafted = await draft(data.event);
      return log(`${data.event.id}: preview (Worker mode ${data.mode}, nothing claimed or reported), caption from ${drafted.source}:\n${drafted.caption}`);
    }
    if (ig && !dryRun && i === 0) ig = await freshToken(ig);
    log(`${data.event.id}: ${dryRun ? "dry run" : "publishing"}`);
    await publish(data.event, data.publishable ?? true, ig, dryRun);
  }
}

main().catch((e) => {
  if (e instanceof Paused) {
    console.error(`\nPAUSED: Instagram reported an auth or policy problem:\n  ${e.message}\nNothing more will post until you fix it and delete ${PAUSE_FILE}.`);
    process.exit(2);
  }
  console.error(String(e));
  process.exit(1);
});
