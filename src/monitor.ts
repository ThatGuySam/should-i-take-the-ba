import { DurableObject } from "cloudflare:workers";
import { DIRECTIONS, type DirectionId, POLL, VERDICT } from "./config";
import { activeWindow, isDue, localTime } from "./core/schedule";
import { initialState, type Reading, step, type VerdictState } from "./core/verdict";
import { type Env, publishEvent } from "./instagram";
import { fetchTraffic } from "./traffic";

export type DirectionStatus = {
  direction: DirectionId;
  answer: "yes" | "no" | "unknown";
  verdictAnswer: "yes" | "no";
  answerSince: string;
  checkedAt: string | null;
  fresh: boolean;
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
const CHECK_RETENTION_HOURS = 24;

// Google's terms bar storing route durations, so nothing here persists a travel time. A check
// records only when it ran and whether it worked; the verdict state holds Yes/No and timestamps.

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
      CREATE TABLE IF NOT EXISTS state (
        direction TEXT PRIMARY KEY, verdict TEXT NOT NULL, open_event TEXT
      );
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, direction TEXT NOT NULL, answer TEXT NOT NULL, at TEXT NOT NULL,
        window TEXT NOT NULL, status TEXT NOT NULL, container_id TEXT, media_id TEXT, error TEXT,
        updated_at TEXT NOT NULL
      );
    `);
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
      if (!isDue(direction, now, openEvent !== null)) continue;
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
    this.prune(now);
    return { polled, events };
  }

  async poll(direction: DirectionId, now: Date): Promise<string | null> {
    const result = await fetchTraffic(DIRECTIONS[direction], this.env, now);
    this.sql.exec(
      "INSERT INTO checks (direction, at, ok, error, provider) VALUES (?, ?, ?, ?, ?)",
      direction,
      result.ok ? result.reading.at : now.toISOString(),
      result.ok ? 1 : 0,
      result.ok ? null : result.error,
      result.provider,
    );
    return result.ok ? this.applyReading(direction, result.reading, now) : null;
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
    const cutoff = new Date(now.getTime() - CHECK_RETENTION_HOURS * 3_600_000).toISOString();
    this.sql.exec("DELETE FROM checks WHERE at < ?", cutoff);
    this.sql.exec("DELETE FROM polls WHERE claimed_at < ?", cutoff);
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
        .exec<{ at: string }>("SELECT at FROM checks WHERE direction = ? AND ok = 1 ORDER BY at DESC LIMIT 1", direction)
        .toArray()[0];
      const checkedAt = good ? String(good.at) : null;
      const maxAgeMin = activeWindow(localTime(new Date(now)))?.direction === direction ? POLL.maxReadingAgeMin : 75;
      const fresh = checkedAt !== null && now - Date.parse(checkedAt) <= maxAgeMin * 60_000;
      return {
        direction,
        answer: fresh ? verdict.answer : "unknown",
        verdictAnswer: verdict.answer,
        answerSince: verdict.answerSince,
        checkedAt,
        fresh,
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
