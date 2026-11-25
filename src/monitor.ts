import { DurableObject } from "cloudflare:workers";
import { ADAPTIVE, BUDGET, DIRECTIONS, type DirectionId, POLL, POSTING, RUSH_WINDOWS, STRETCH_LEVELS, STRETCH_NAMES, VERDICT } from "./config";
import { decodeLevels, encodeLevels, type Level, routeLevel, stretchLevel } from "./core/levels";
import { type AdaptiveState, adaptiveAfter, idleAdaptive, planCheck, policyLabel, type Reason } from "./core/adaptive";
import type { PostExtra } from "./core/caption";
import { clearEstimate } from "./core/estimate";
import { advance, type Episode, expired, gate, type PostAction } from "./core/posting";
import { activeWindow, intervalFor, localTime } from "./core/schedule";
import { initialState, type Reading, step, type VerdictState } from "./core/verdict";
import { type Env, publishEvent } from "./instagram";
import { type PushTarget, sendPush } from "./push";
import { fetchTraffic } from "./traffic";

export type DirectionStatus = {
  direction: DirectionId;
  answer: "yes" | "no" | "unknown";
  verdictAnswer: "yes" | "no";
  answerSince: string;
  checkedAt: string | null;
  fresh: boolean;
  level: Level | null;
  /** Eastbound order: Downtown first. */
  stretches: { from: string; to: string; level: Level }[] | null;
  lastError: string | null;
  lastAttemptAt: string | null;
};

export type PostEvent = {
  id: string;
  direction: DirectionId;
  answer: "yes" | "no";
  at: string;
  window: string;
  status: string;
  containerId: string | null;
  mediaId: string | null;
  error: string | null;
  updatedAt: string;
  /** Yes events: when Yes was first seen (the event's `at` is when the Yes settled). */
  since: string | null;
  /** The caption actually posted, once the local runner reports it. */
  caption: string | null;
  claimedAt: string | null;
  extra: PostExtra | null;
};

export type PostResult = { status: string; containerId?: string; mediaId?: string; error?: string; caption?: string };
export const RESULT_STATUSES = ["published", "dry-run", "container", "failed", "held", "pending", "stale"];

const DIRECTION_IDS = Object.keys(DIRECTIONS) as DirectionId[];
const POLL_RETENTION_HOURS = 24;
const CHECK_RETENTION_DAYS = 400;

// Google's terms bar storing route durations, so nothing here persists a travel time. A check
// records when it ran, whether it worked, and the site's own derived level (clear/slow/jammed)
// for the whole route and each stretch. Those levels are the history used for trends.

export class Monitor extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS polls (slot TEXT PRIMARY KEY, claimed_at TEXT NOT NULL);
      DROP TABLE IF EXISTS readings;
      DROP TABLE IF EXISTS events;
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, direction TEXT NOT NULL, at TEXT NOT NULL,
        ok INTEGER NOT NULL, error TEXT, provider TEXT
      );
      CREATE INDEX IF NOT EXISTS checks_dir_at ON checks(direction, at);
      CREATE TABLE IF NOT EXISTS usage (month TEXT PRIMARY KEY, calls INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS watches (
        endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
        direction TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state (
        direction TEXT PRIMARY KEY, verdict TEXT NOT NULL, open_event TEXT
      );
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, direction TEXT NOT NULL, answer TEXT NOT NULL, at TEXT NOT NULL,
        window TEXT NOT NULL, status TEXT NOT NULL, container_id TEXT, media_id TEXT, error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS post_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, direction TEXT NOT NULL,
        episode TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT
      );
    `);
    const columns = [
      ...["level TEXT", "stretch_levels TEXT", "reason TEXT", "answer TEXT", "policy TEXT"].map((c) => `checks ADD COLUMN ${c}`),
      "state ADD COLUMN yes_since TEXT",
      ...["since TEXT", "caption TEXT", "claimed_at TEXT", "extra TEXT"].map((c) => `posts ADD COLUMN ${c}`),
    ];
    for (const column of columns) {
      try {
        this.sql.exec(`ALTER TABLE ${column}`);
      } catch {
        // already added
      }
    }
  }

  private loadState(direction: DirectionId): { verdict: VerdictState; openEvent: string | null; episode: Episode | null } {
    const row = this.sql
      .exec<{ verdict: string; open_event: string | null; yes_since: string | null }>("SELECT verdict, open_event, yes_since FROM state WHERE direction = ?", direction)
      .toArray()[0];
    if (!row) return { verdict: initialState(new Date(0).toISOString()), openEvent: null, episode: null };
    const episode = row.open_event ? { noId: row.open_event, yesSince: row.yes_since } : null;
    return { verdict: JSON.parse(row.verdict), openEvent: row.open_event, episode };
  }

  private saveState(direction: DirectionId, verdict: VerdictState, episode: Episode | null) {
    this.sql.exec(
      "INSERT INTO state (direction, verdict, open_event, yes_since) VALUES (?, ?, ?, ?) ON CONFLICT(direction) DO UPDATE SET verdict = excluded.verdict, open_event = excluded.open_event, yes_since = excluded.yes_since",
      direction,
      JSON.stringify(verdict),
      episode?.noId ?? null,
      episode?.yesSince ?? null,
    );
  }

  async tick(scheduledTime: number): Promise<{ polled: DirectionId[]; events: string[] }> {
    const now = new Date(scheduledTime);
    const slotMinute = Math.floor(scheduledTime / (POLL.rushMin * 60_000));
    const polled: DirectionId[] = [];
    const events: string[] = [];
    for (const direction of DIRECTION_IDS) {
      const { openEvent } = this.loadState(direction);
      const plan = planCheck(direction, now, { open: openEvent !== null || this.watching(direction, now), state: this.loadAdaptive(direction) });
      if (!plan.due) continue;
      if (!this.withinBudget(direction, now)) continue;
      const slot = `${slotMinute}:${direction}`;
      const claimed = this.sql
        .exec("INSERT OR IGNORE INTO polls (slot, claimed_at) VALUES (?, ?) RETURNING slot", slot, new Date().toISOString())
        .toArray();
      if (claimed.length === 0) continue;
      polled.push(direction);
      const event = await this.poll(direction, now, plan.reason);
      if (event) {
        events.push(event);
        await this.dispatch(event);
      }
    }
    for (const e of this.events(20)) if (e.status === "container" || e.status === "pending") await this.dispatch(e.id, now);
    await this.expireWatches(now);
    this.prune(now);
    return { polled, events };
  }

  private monthKey(now: Date) {
    return localTime(now).date.slice(0, 7);
  }

  monthCalls(now = new Date()): number {
    const row = this.sql.exec<{ calls: number }>("SELECT calls FROM usage WHERE month = ?", this.monthKey(now)).toArray()[0];
    return row ? Number(row.calls) : 0;
  }

  private countCall(now: Date) {
    this.sql.exec(
      "INSERT INTO usage (month, calls) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET calls = calls + 1",
      this.monthKey(now),
    );
  }

  /** Stay under Sam's cap: past the soft line only the rush direction in its window is polled. */
  private withinBudget(direction: DirectionId, now: Date): boolean {
    const used = this.monthCalls(now);
    if (used >= BUDGET.monthlyCap) return false;
    if (used >= BUDGET.rushOnlyAbove) return activeWindow(localTime(now))?.direction === direction;
    return true;
  }

  private setting(key: string): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0];
    return row ? row.value : null;
  }

  private setSetting(key: string, value: string) {
    this.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  private loadAdaptive(direction: DirectionId): AdaptiveState {
    const raw = this.setting(`adaptive:${direction}`);
    try {
      return raw ? (JSON.parse(raw) as AdaptiveState) : idleAdaptive();
    } catch {
      return idleAdaptive();
    }
  }

  async poll(direction: DirectionId, now: Date, reason: Reason | "manual" = "manual"): Promise<string | null> {
    // A failed stretch request turns stretches off for a day, then they are tried again.
    const offAt = this.setting("stretches_off_at");
    const withStretches = !offAt || now.getTime() - Date.parse(offAt) > 86_400_000;
    let result = await fetchTraffic(DIRECTIONS[direction], this.env, now, withStretches);
    this.countCall(now);
    if (!result.ok && withStretches && result.error.startsWith("stretch waypoints")) {
      // A waypoint snapped off the BA. Turn stretches off until someone fixes the boundaries.
      this.setSetting("stretches_off_at", now.toISOString());
      result = await fetchTraffic(DIRECTIONS[direction], this.env, now, false);
      this.countCall(now);
    }
    const level = result.ok ? routeLevel(result.reading, VERDICT) : null;
    const stretchLevels = result.ok && result.stretches ? encodeLevels(result.stretches.map((r) => stretchLevel(r, STRETCH_LEVELS))) : null;
    this.sql.exec(
      "INSERT INTO checks (direction, at, ok, error, provider, level, stretch_levels, reason, policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      direction,
      result.ok ? result.reading.at : now.toISOString(),
      result.ok ? 1 : 0,
      result.ok ? null : result.error,
      result.provider,
      level,
      stretchLevels,
      reason,
      policyLabel(),
    );
    if (!result.ok) return null;
    const checkId = this.sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").one().id;
    const before = this.loadState(direction).verdict.answer;
    const stretches = result.stretches ? result.stretches.map((r, i) => ({ from: STRETCH_NAMES[i], to: STRETCH_NAMES[i + 1], level: stretchLevel(r, STRETCH_LEVELS) })) : null;
    const event = this.applyReading(direction, result.reading, now, stretches);
    const after = this.loadState(direction).verdict.answer;
    this.sql.exec("UPDATE checks SET answer = ? WHERE id = ?", after, checkId);
    if (level) {
      const next = adaptiveAfter(this.loadAdaptive(direction), now, level, after, before === "no" && after === "yes", ADAPTIVE);
      this.setSetting(`adaptive:${direction}`, JSON.stringify(next));
    }
    if (before === "no" && after === "yes") await this.notifyCleared(direction, now);
    return event;
  }

  // "Tell me when it clears": one notification on the next confirmed No→Yes flip, then the watch
  // is deleted. While anyone watches a direction, it is checked every 5 minutes (within budget).
  private watching(direction: DirectionId, now: Date): boolean {
    return this.sql.exec("SELECT 1 FROM watches WHERE direction = ? AND expires_at > ? LIMIT 1", direction, now.toISOString()).toArray().length > 0;
  }

  addWatch(target: PushTarget, direction: DirectionId, minutes: number): { expiresAt: string } {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.min(Math.max(minutes, 15), 180) * 60_000).toISOString();
    this.sql.exec(
      "INSERT INTO watches (endpoint, p256dh, auth, direction, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, direction = excluded.direction, created_at = excluded.created_at, expires_at = excluded.expires_at",
      target.endpoint, target.p256dh, target.auth, direction, now.toISOString(), expiresAt,
    );
    return { expiresAt };
  }

  removeWatch(endpoint: string) {
    this.sql.exec("DELETE FROM watches WHERE endpoint = ?", endpoint);
  }

  private takeWatches(where: string, ...args: string[]): (PushTarget & { direction: DirectionId })[] {
    const rows = this.sql
      .exec<{ endpoint: string; p256dh: string; auth: string; direction: string }>(`SELECT endpoint, p256dh, auth, direction FROM watches WHERE ${where}`, ...args)
      .toArray();
    this.sql.exec(`DELETE FROM watches WHERE ${where}`, ...args);
    return rows.map((r) => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, direction: r.direction as DirectionId }));
  }

  private async notifyCleared(direction: DirectionId, now: Date) {
    const d = DIRECTIONS[direction];
    const when = now.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
    const url = `${this.env.PUBLIC_ORIGIN}/?direction=${direction}`;
    for (const w of this.takeWatches("direction = ?", direction)) {
      await sendPush(this.env, w, { title: "The BA is moving", body: `${d.from} to ${d.to} cleared up as of ${when}.`, url, tag: `ba-${direction}` });
    }
  }

  private async expireWatches(now: Date) {
    for (const w of this.takeWatches("expires_at <= ?", now.toISOString())) {
      const d = DIRECTIONS[w.direction];
      await sendPush(this.env, w, {
        title: "Still backed up",
        body: `${d.from} to ${d.to} hadn't cleared when your watch ended. Check before you go.`,
        url: `${this.env.PUBLIC_ORIGIN}/?direction=${w.direction}`,
        tag: `ba-${w.direction}`,
      });
    }
  }

  /** Admin view: every check (ok or not) plus counts, for auditing what has been recorded. */
  historyReport(days = 14) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.sql
      .exec<{ direction: string; at: string; ok: number; error: string | null; provider: string | null; level: string | null; stretch_levels: string | null; reason: string | null; answer: string | null; policy: string | null }>(
        "SELECT direction, at, ok, error, provider, level, stretch_levels, reason, answer, policy FROM checks WHERE at >= ? ORDER BY at",
        since,
      )
      .toArray();
    const first = this.sql.exec<{ at: string | null }>("SELECT MIN(at) AS at FROM checks").one().at;
    const usage = this.sql.exec<{ month: string; calls: number }>("SELECT month, calls FROM usage ORDER BY month").toArray();
    return { firstCheckEver: first, total: rows.length, ok: rows.filter((r) => r.ok).length, usage, rows };
  }

  /** Derived levels for trend charts: one row per successful check. */
  history(days = 14): { direction: DirectionId; at: string; level: Level | null; stretches: string | null }[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.sql
      .exec<{ direction: string; at: string; level: string | null; stretch_levels: string | null }>(
        "SELECT direction, at, level, stretch_levels FROM checks WHERE ok = 1 AND at >= ? ORDER BY at",
        since,
      )
      .toArray()
      .map((r) => ({ direction: r.direction as DirectionId, at: r.at, level: (r.level as Level) ?? null, stretches: r.stretch_levels }));
  }

  private applyReading(direction: DirectionId, reading: Reading, now: Date, stretches: PostExtra["stretches"]): string | null {
    const { verdict, episode } = this.loadState(direction);
    const out = step(verdict, reading, VERDICT);
    const local = localTime(now);
    const actions: PostAction[] = [];
    let open = episode;
    const opener = open ? this.getEvent(open.noId) : null;
    if (open && opener && expired(opener.at, now, POSTING)) {
      if (opener.status === "pending") actions.push({ type: "supersede", id: open.noId });
      actions.push({ type: "log", kind: "closed-expired", episode: open.noId });
      open = null;
    }
    const next = advance(
      {
        episode: open,
        direction,
        answer: out.state.answer,
        transition: out.transition?.to ?? null,
        at: reading.at,
        local,
        window: activeWindow(local),
        noStatus: open ? (opener?.status ?? null) : null,
        exists: (id) => this.getEvent(id) !== null,
      },
      POSTING,
    );
    let created: string | null = null;
    for (const a of [...actions, ...next.actions]) {
      if (a.type === "create") {
        const extra: PostExtra =
          a.answer === "no"
            ? { estimate: this.estimateFor(direction, local, a.at), stretches }
            : { noAt: opener?.at, since: a.since };
        if (this.insertEvent(a.id, direction, a.answer, a.at, a.id.split("-")[3], extra, a.answer === "yes" ? a.since : null)) created = a.id;
      } else if (a.type === "supersede") {
        this.sql.exec(
          "UPDATE posts SET status = 'superseded', error = 'cleared before it was posted', updated_at = ? WHERE id = ? AND status = 'pending'",
          now.toISOString(),
          a.id,
        );
      } else {
        this.sql.exec("INSERT INTO post_log (at, direction, episode, kind, detail) VALUES (?, ?, ?, ?, ?)", now.toISOString(), direction, a.episode, a.kind, a.detail ?? null);
      }
    }
    this.saveState(direction, out.state, next.episode);
    return created;
  }

  /** Cautious "usually clears within" for a new No, from this window's past jams (null with too few). */
  private estimateFor(direction: DirectionId, local: ReturnType<typeof localTime>, before: string) {
    const window = activeWindow(local) ?? RUSH_WINDOWS.find((w) => w.direction === direction);
    if (!window) return null;
    const since = new Date(Date.parse(before) - POSTING.estimate.days * 86_400_000).toISOString();
    const rows = this.sql
      .exec<{ at: string; ok: number; answer: string | null }>(
        "SELECT at, ok, answer FROM checks WHERE direction = ? AND at >= ? AND at < ? ORDER BY at",
        direction,
        since,
        before,
      )
      .toArray();
    return clearEstimate(rows, window, POSTING.estimate);
  }

  private insertEvent(id: string, direction: DirectionId, answer: "yes" | "no", at: string, window: string, extra: PostExtra, since: string | null) {
    const rows = this.sql
      .exec(
        "INSERT OR IGNORE INTO posts (id, direction, answer, at, window, status, updated_at, since, extra) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING id",
        id,
        direction,
        answer,
        at,
        window,
        new Date().toISOString(),
        since,
        JSON.stringify(extra),
      )
      .toArray();
    return rows.length > 0;
  }

  private postedSince(now: Date): number {
    const since = new Date(now.getTime() - 86_400_000).toISOString();
    return Number(
      this.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE status IN ('published', 'dry-run', 'claimed', 'container') AND updated_at >= ?", since)
        .one().n,
    );
  }

  /** Apply the posting caps to a pending event. A stale event is marked and never posted. */
  private admit(event: PostEvent, now: Date): boolean {
    const g = gate(event, now, localTime(now), this.postedSince(now), POSTING);
    if (!g.ok && g.drop) this.setResult(event.id, { status: "stale", error: g.reason });
    return g.ok;
  }

  private setResult(id: string, r: PostResult) {
    this.sql.exec(
      "UPDATE posts SET status = ?, container_id = COALESCE(?, container_id), media_id = COALESCE(?, media_id), error = ?, caption = COALESCE(?, caption), claimed_at = CASE WHEN ? = 'pending' THEN NULL ELSE claimed_at END, updated_at = ? WHERE id = ?",
      r.status,
      r.containerId ?? null,
      r.mediaId ?? null,
      r.error ?? null,
      r.caption ?? null,
      r.status,
      new Date().toISOString(),
      id,
    );
  }

  private async dispatch(id: string, now = new Date()) {
    // In local mode the runner on Sam's machine publishes; the Worker only records events.
    if (this.env.INSTAGRAM_MODE === "local") return;
    const event = this.getEvent(id);
    if (!event || (event.status !== "pending" && event.status !== "container")) return;
    if (event.status === "pending" && !this.admit(event, now)) return;
    this.setResult(id, await publishEvent(event, this.env));
  }

  // Local runner API (scripts/ig-runner.ts). The runner asks for the next publishable event, claims
  // it, posts it and reports back. A claim expires after POSTING.claimMin so a crashed run is retried,
  // and an event that already has a container comes back so the runner reconciles before posting.

  nextPost(now = new Date()): { event: PostEvent; publishable: boolean } | null {
    const claimCutoff = new Date(now.getTime() - POSTING.claimMin * 60_000).toISOString();
    const rows = this.sql
      .exec<Record<string, string | number | null>>(
        "SELECT * FROM posts WHERE status = 'pending' OR (status IN ('claimed', 'container') AND (claimed_at IS NULL OR claimed_at < ?)) ORDER BY at",
        claimCutoff,
      )
      .toArray()
      .map(toEvent);
    for (const e of rows) {
      if (e.containerId) return { event: e, publishable: gate(e, now, localTime(now), this.postedSince(now), POSTING).ok };
      if (this.admit(e, now)) return { event: e, publishable: true };
    }
    return null;
  }

  claimPost(id: string, now = new Date()): PostEvent | null {
    const claimCutoff = new Date(now.getTime() - POSTING.claimMin * 60_000).toISOString();
    const rows = this.sql
      .exec(
        "UPDATE posts SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ? AND (status = 'pending' OR (status IN ('claimed', 'container') AND (claimed_at IS NULL OR claimed_at < ?))) RETURNING id",
        now.toISOString(),
        now.toISOString(),
        id,
        claimCutoff,
      )
      .toArray();
    return rows.length ? this.getEvent(id) : null;
  }

  reportPost(id: string, r: PostResult): PostEvent | null {
    if (!this.getEvent(id)) return null;
    this.setResult(id, r);
    return this.getEvent(id);
  }

  postLog(limit = 100) {
    return this.sql.exec("SELECT * FROM post_log ORDER BY id DESC LIMIT ?", limit).toArray();
  }

  private prune(now: Date) {
    const pollCutoff = new Date(now.getTime() - POLL_RETENTION_HOURS * 3_600_000).toISOString();
    const checkCutoff = new Date(now.getTime() - CHECK_RETENTION_DAYS * 86_400_000).toISOString();
    this.sql.exec("DELETE FROM checks WHERE at < ?", checkCutoff);
    this.sql.exec("DELETE FROM polls WHERE claimed_at < ?", pollCutoff);
  }

  getEvent(id: string): PostEvent | null {
    const row = this.sql.exec<Record<string, string | number | null>>("SELECT * FROM posts WHERE id = ?", id).toArray()[0];
    return row ? toEvent(row) : null;
  }

  events(limit = 50): PostEvent[] {
    return this.sql.exec<Record<string, string | number | null>>("SELECT * FROM posts ORDER BY at DESC LIMIT ?", limit).toArray().map(toEvent);
  }

  status(): DirectionStatus[] {
    const now = Date.now();
    return DIRECTION_IDS.map((direction) => {
      const { verdict } = this.loadState(direction);
      const last = this.sql
        .exec<Record<string, string | number | null>>("SELECT * FROM checks WHERE direction = ? ORDER BY at DESC LIMIT 1", direction)
        .toArray()[0];
      const good = this.sql
        .exec<{ at: string; level: string | null; stretch_levels: string | null }>(
          "SELECT at, level, stretch_levels FROM checks WHERE direction = ? AND ok = 1 ORDER BY at DESC LIMIT 1",
          direction,
        )
        .toArray()[0];
      const checkedAt = good ? String(good.at) : null;
      const local = localTime(new Date(now));
      const maxAgeMin =
        activeWindow(local)?.direction === direction ? POLL.maxReadingAgeMin : intervalFor(direction, local, false) + 30;
      const fresh = checkedAt !== null && now - Date.parse(checkedAt) <= maxAgeMin * 60_000;
      return {
        direction,
        answer: fresh ? verdict.answer : "unknown",
        verdictAnswer: verdict.answer,
        answerSince: verdict.answerSince,
        checkedAt,
        fresh,
        level: fresh && good?.level ? (good.level as Level) : null,
        stretches: fresh ? (decodeLevels(good?.stretch_levels)?.map((level, i) => ({ from: STRETCH_NAMES[i], to: STRETCH_NAMES[i + 1], level })) ?? null) : null,
        lastError: last && Number(last.ok) === 0 ? String(last.error) : null,
        lastAttemptAt: last ? String(last.at) : null,
      };
    });
  }

  async pollNow(direction: DirectionId): Promise<DirectionStatus> {
    const event = await this.poll(direction, new Date());
    if (event) await this.dispatch(event);
    return this.status().find((s) => s.direction === direction) as DirectionStatus;
  }

}

function toEvent(row: Record<string, string | number | null>): PostEvent {
  const str = (v: string | number | null) => (v === null || v === undefined ? null : String(v));
  let extra: PostExtra | null = null;
  try {
    extra = row.extra ? (JSON.parse(String(row.extra)) as PostExtra) : null;
  } catch {
    // leave null
  }
  return {
    id: String(row.id),
    direction: row.direction as DirectionId,
    answer: row.answer as "yes" | "no",
    at: String(row.at),
    window: String(row.window),
    status: String(row.status),
    containerId: str(row.container_id),
    mediaId: str(row.media_id),
    error: str(row.error),
    updatedAt: String(row.updated_at),
    since: str(row.since),
    caption: str(row.caption),
    claimedAt: str(row.claimed_at),
    extra,
  };
}
