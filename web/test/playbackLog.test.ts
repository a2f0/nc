import { describe, expect, test } from "bun:test";
import { LOG_LIMIT, PlaybackLog, type PlaybackLogEntry, type PlaybackMarker, type PlaybackLogStorage } from "../src/playbackLog";

class MemoryLog implements PlaybackLogStorage {
  events: PlaybackLogEntry[] = [];
  active = new Map<string, PlaybackMarker>();
  async read() { return this.events; }
  async markers() { return [...this.active.values()]; }
  async write(row: PlaybackLogEntry, active: boolean | undefined) {
    this.events = [...this.events, row].slice(-LOG_LIMIT);
    if (active === true && row.soundId) this.active.set(row.owner, { owner: row.owner, soundId: row.soundId, timestamp: row.timestamp });
    if (active === false) this.active.delete(row.owner);
  }
}

class Locks {
  held = new Set<string>();
  async request(name: string, options: unknown, callback?: (lock: object | null) => Promise<void>) {
    const run = typeof options === "function" ? options as (lock: object | null) => Promise<void> : callback!;
    if (this.held.has(name)) return run(null);
    this.held.add(name);
    try { await run({ name }); } finally { this.held.delete(name); }
  }
  get manager() { return this as unknown as LockManager; }
}

describe("playback diagnostics", () => {
  test("bounds memory and persisted events, limits details, and reloads them", async () => {
    const storage = new MemoryLog();
    const log = new PlaybackLog(storage);
    for (let index = 0; index < 350; index++) log.record("log_play_requested", "pink", `${index}:` + "x".repeat(700));
    await log.flushed();
    expect(log.entries).toHaveLength(300);
    expect(log.entries[0]?.detail.startsWith("50:")).toBe(true);
    expect(log.entries.every((row) => row.detail.length === 512)).toBe(true);
    const reopened = new PlaybackLog(storage);
    await reopened.ready;
    expect(reopened.entries).toEqual(log.entries);
  });

  test("recovers a dead owner once and leaves live tabs alone", async () => {
    const storage = new MemoryLog();
    const locks = new Locks();
    const live = new PlaybackLog(storage, locks.manager);
    live.record("log_started", "fan", "", true);
    await live.flushed();
    storage.active.set("dead", { owner: "dead", soundId: "brown", timestamp: 1000 });
    const next = new PlaybackLog(storage, locks.manager);
    await next.ready;
    expect(next.entries.filter((row) => row.event === "log_unclean_exit")).toHaveLength(1);
    expect(next.entries.at(-1)?.soundId).toBe("brown");
    expect(storage.active.has(live.owner)).toBe(true);
    expect(storage.active.has("dead")).toBe(false);
    const again = new PlaybackLog(storage, locks.manager);
    await again.ready;
    expect(again.entries.filter((row) => row.event === "log_unclean_exit")).toHaveLength(1);
  });

  test("normal stop closes the marker, unavailable locks do not guess", async () => {
    const storage = new MemoryLog();
    const log = new PlaybackLog(storage);
    log.record("log_started", "white", "", true);
    log.record("log_stopped", "white", "ui", false);
    await log.flushed();
    expect(storage.active.size).toBe(0);
    storage.active.set("other", { owner: "other", soundId: "brown", timestamp: 1000 });
    const next = new PlaybackLog(storage);
    await next.ready;
    expect(next.entries.some((row) => row.event === "log_unclean_exit")).toBe(false);
  });

  test("blocked storage preserves in-memory diagnostics and reports failure", async () => {
    const log = new PlaybackLog({
      async read() { throw new Error("blocked"); },
      async markers() { return []; },
      async write() { throw new Error("blocked"); },
    });
    log.record("log_engine_failed", "waves", "test");
    await log.flushed();
    expect(log.storageFailed).toBe(true);
    expect(log.entries[0]?.event).toBe("log_engine_failed");
  });
});
