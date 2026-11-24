import { DurableObject } from "cloudflare:workers";
import { BUDGET, DIRECTIONS, type DirectionId, POLL, STRETCH_LEVELS, STRETCH_NAMES, VERDICT } from "./config";
import { decodeLevels, encodeLevels, type Level, routeLevel, stretchLevel } from "./core/levels";
import { activeWindow, intervalFor, isDue, localTime } from "./core/schedule";
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
};

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
    `);
    for (const column of ["level TEXT", "stretch_levels TEXT"]) {
      try {
        this.sql.exec(`ALTER TABLE checks ADD COLUMN ${column}`);
      } catch {
        // already added
      }
    }
  }

  private loadState(direction: DirectionId): { verdict: VerdictState; openEvent: string | null } {
    const row = this.sql
      .exec<{ verdict: string; open_event: string | null }>("SELECT verdict, open_event FROM state WHERE direction = ?", direction)
      .toArray()[0];
    if (!row) return { verdict: initialState(new Date(0).toISOString()), openEvent: null };
    return { verdict: JSON.parse(row.verdict), openEvent: row.open_event };
  }

  private saveState(direction: DirectionId, verdict: VerdictState, openEvent: string | null) {
    this.sql.exec(
      "INSERT INTO state (direction, verdict, open_event) VALUES (?, ?, ?) ON CONFLICT(direction) DO UPDATE SET verdict = excluded.verdict, open_event = excluded.open_event",
      direction,
      JSON.stringify(verdict),
      openEvent,
    );
  }

  async tick(scheduledTime: number): Promise<{ polled: DirectionId[]; events: string[] }> {
    const now = new Date(scheduledTime);
    const slotMinute = Math.floor(scheduledTime / (POLL.rushMin * 60_000));
    const polled: DirectionId[] = [];
    const events: string[] = [];
    for (const direction of DIRECTION_IDS) {
      const { openEvent } = this.loadState(direction);
      if (!isDue(direction, now, openEvent !== null || this.watching(direction, now))) continue;
      if (!this.withinBudget(direction, now)) continue;
      const slot = `${slotMinute}:${direction}`;
      const claimed = this.sql
        .exec("INSERT OR IGNORE INTO polls (slot, claimed_at) VALUES (?, ?) RETURNING slot", slot, new Date().toISOString())
        .toArray();
      if (claimed.length === 0) continue;
      polled.push(direction);
      const event = await this.poll(direction, now);
      if (event) {
        events.push(event);
        await this.dispatch(event);
      }
    }
    for (const e of this.events(20)) if (e.status === "container") await this.dispatch(e.id);
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

  async poll(direction: DirectionId, now: Date): Promise<string | null> {
    const withStretches = this.setting("stretches") !== "off";
    let result = await fetchTraffic(DIRECTIONS[direction], this.env, now, withStretches);
    this.countCall(now);
    if (!result.ok && withStretches && result.error.startsWith("stretch waypoints")) {
      // A waypoint snapped off the BA. Turn stretches off until someone fixes the boundaries.
      this.setSetting("stretches", "off");
      result = await fetchTraffic(DIRECTIONS[direction], this.env, now, false);
      this.countCall(now);
    }
    const level = result.ok ? routeLevel(result.reading, VERDICT) : null;
    const stretchLevels = result.ok && result.stretches ? encodeLevels(result.stretches.map((r) => stretchLevel(r, STRETCH_LEVELS))) : null;
    this.sql.exec(
      "INSERT INTO checks (direction, at, ok, error, provider, level, stretch_levels) VALUES (?, ?, ?, ?, ?, ?, ?)",
      direction,
      result.ok ? result.reading.at : now.toISOString(),
      result.ok ? 1 : 0,
      result.ok ? null : result.error,
      result.provider,
      level,
      stretchLevels,
    );
    if (!result.ok) return null;
    const before = this.loadState(direction).verdict.answer;
    const event = this.applyReading(direction, result.reading, now);
    if (before === "no" && this.loadState(direction).verdict.answer === "yes") await this.notifyCleared(direction, now);
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

  private applyReading(direction: DirectionId, reading: Reading, now: Date): string | null {
    const { verdict, openEvent } = this.loadState(direction);
    const out = step(verdict, reading, VERDICT);
    let nextOpen = openEvent;
    let created: string | null = null;

    if (out.transition) {
      const local = localTime(now);
      const window = activeWindow(local);
      if (out.transition.to === "no" && window?.direction === direction) {
        const id = `${local.date}-${window.id}-${direction}-no`;
        if (this.insertEvent(id, direction, "no", reading.at, window.id)) {
          created = id;
          nextOpen = id;
        }
      } else if (out.transition.to === "yes" && openEvent) {
        const opener = this.getEvent(openEvent);
        const id = openEvent.replace(/-no$/, "-yes");
        if (opener && (opener.status === "published" || opener.status === "dry-run") && this.insertEvent(id, direction, "yes", reading.at, opener.window)) {
          created = id;
        }
        nextOpen = null;
      }
    }
    this.saveState(direction, out.state, nextOpen);
    return created;
  }

  private insertEvent(id: string, direction: DirectionId, answer: "yes" | "no", at: string, window: string) {
    const rows = this.sql
      .exec(
        "INSERT OR IGNORE INTO posts (id, direction, answer, at, window, status, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?) RETURNING id",
        id,
        direction,
        answer,
        at,
        window,
        new Date().toISOString(),
      )
      .toArray();
    return rows.length > 0;
  }

  private async dispatch(id: string) {
    const event = this.getEvent(id);
    if (!event || (event.status !== "pending" && event.status !== "container")) return;
    const update = await publishEvent(event, this.env);
    this.sql.exec(
      "UPDATE posts SET status = ?, container_id = ?, media_id = ?, error = ?, updated_at = ? WHERE id = ?",
      update.status,
      update.containerId ?? null,
      update.mediaId ?? null,
      update.error ?? null,
      new Date().toISOString(),
      id,
    );
  }

  private prune(now: Date) {
    const pollCutoff = new Date(now.getTime() - POLL_RETENTION_HOURS * 3_600_000).toISOString();
    const checkCutoff = new Date(now.getTime() - CHECK_RETENTION_DAYS * 86_400_000).toISOString();
    this.sql.exec("DELETE FROM checks WHERE at < ?", checkCutoff);
    this.sql.exec("DELETE FROM polls WHERE claimed_at < ?", pollCutoff);
  }

  getEvent(id: string): PostEvent | null {
    return this.events(500).find((e) => e.id === id) ?? null;
  }

  events(limit = 50): PostEvent[] {
    return this.sql
      .exec<Record<string, string | number | null>>("SELECT * FROM posts ORDER BY at DESC LIMIT ?", limit)
      .toArray()
      .map((row) => ({
        id: String(row.id),
        direction: row.direction as DirectionId,
        answer: row.answer as "yes" | "no",
        at: String(row.at),
        window: String(row.window),
        status: String(row.status),
        containerId: (row.container_id as string) ?? null,
        mediaId: (row.media_id as string) ?? null,
        error: (row.error as string) ?? null,
        updatedAt: String(row.updated_at),
      }));
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
