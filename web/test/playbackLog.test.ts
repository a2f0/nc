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
    const log = new PlaybackLog(storage, null);
    for (let index = 0; index < 350; index++) log.record("log_play_requested", "pink", `${index}:` + "x".repeat(700));
    await log.flushed();
    expect(log.entries).toHaveLength(300);
    expect(log.entries[0]?.detail.startsWith("50:")).toBe(true);
    expect(log.entries.every((row) => row.detail.length === 512)).toBe(true);
    const reopened = new PlaybackLog(storage, null);
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
    const log = new PlaybackLog(storage, null);
    log.record("log_started", "white", "", true);
    log.record("log_stopped", "white", "ui", false);
    await log.flushed();
    expect(storage.active.size).toBe(0);
    storage.active.set("other", { owner: "other", soundId: "brown", timestamp: 1000 });
    const next = new PlaybackLog(storage, null);
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

// Use the actual storage implementation, including its transaction boundaries.
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBPlaybackLogStorage } from "../src/playbackLog";

function entry(index: number, owner = `owner-${index}`): PlaybackLogEntry {
  return { id: `event-${index}`, owner, timestamp: index, event: "log_started", soundId: "pink", detail: "" };
}
function opened(factory: IDBFactory, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open("playback-log", version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("IndexedDB playback storage", () => {
  test("concurrent writers retain 300 events and markers; stopping clears only its owner", async () => {
    const factory = new IDBFactory();
    const first = new IndexedDBPlaybackLogStorage(() => factory);
    const second = new IndexedDBPlaybackLogStorage(() => factory);
    await Promise.all(Array.from({ length: 350 }, (_, index) => (index % 2 ? first : second).write(entry(index), true)));
    const rows = await first.read();
    expect(rows).toHaveLength(300);
    expect(new Set(rows.map(row => row.id)).size).toBe(300);
    expect(await first.markers()).toHaveLength(300);
    expect((await first.markers()).some(row => row.owner === "owner-0")).toBe(false);
    await second.write({ ...entry(400, "owner-349"), event: "log_stopped" }, false);
    expect((await first.markers()).some(row => row.owner === "owner-349")).toBe(false);
    expect(await first.markers()).toHaveLength(299);
    expect(await new IndexedDBPlaybackLogStorage(() => factory).read()).toHaveLength(300);
  });

  test("unknown events, sounds, and malformed persisted rows never reach the view", async () => {
    const factory = new IDBFactory();
    const storage = new IndexedDBPlaybackLogStorage(() => factory);
    await storage.write(entry(1), true);
    const db = await opened(factory);
    const tx = db.transaction(["events", "active"], "readwrite");
    for (const row of [null, { ...entry(2), event: "log_future_event" }, { ...entry(3), soundId: "future_sound" },
      { ...entry(4), timestamp: Infinity }, { ...entry(5), detail: "x".repeat(513) }]) tx.objectStore("events").add(row);
    tx.objectStore("active").put({ owner: "unknown-sound", timestamp: 1, soundId: "future_sound" });
    tx.objectStore("active").put({ owner: "bad-time", timestamp: Infinity, soundId: "pink" });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    expect(await storage.read()).toEqual([entry(1)]);
    expect(await storage.markers()).toEqual([{ owner: "owner-1", soundId: "pink", timestamp: 1 }]);
    db.close();
  });

  test("a broken view cannot throw through recording or prevent persistence", async () => {
    const factory = new IDBFactory();
    const storage = new IndexedDBPlaybackLogStorage(() => factory);
    const log = new PlaybackLog(storage, null);
    await log.ready;
    log.subscribe(() => { throw new Error("broken view"); });
    expect(() => log.record("log_started", "fan", "", true)).not.toThrow();
    await log.flushed();
    expect((await storage.read())[0]?.soundId).toBe("fan");
  });

  test("version changes close the old connection and report incompatible database versions", async () => {
    const factory = new IDBFactory();
    const storage = new IndexedDBPlaybackLogStorage(() => factory);
    await storage.write(entry(1), true);
    const upgraded = await opened(factory, 2);
    await expect(storage.read()).rejects.toThrow();
    upgraded.close();
  });

  test("blocked opens fail promptly and close their late connections", async () => {
    const factory = new IDBFactory();
    const blocker = await opened(factory); // Version 1, with no stores yet.
    // Request the next schema version to provoke a real blocked event behind blocker.
    const upgrading = { open: (name: string) => factory.open(name, 2) } as IDBFactory;
    const storage = new IndexedDBPlaybackLogStorage(() => upgrading);
    await expect(storage.read()).rejects.toThrow("blocked");
    blocker.close();
    // The late successful open must close itself, or this delete would be blocked.
    await new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase("playback-log");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("late connection leaked"));
    });
  });
});
