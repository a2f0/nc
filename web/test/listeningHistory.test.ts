import { describe, expect, test } from "bun:test";
import { ListeningHistory, historyDays, isSession, type HistoryStorage, type ListeningSession } from "../src/listeningHistory";

class MemoryStorage implements HistoryStorage {
  rows = new Map<string, ListeningSession>();
  async read() { return [...this.rows.values()].map((row) => ({ ...row })); }
  async write(row: ListeningSession) { this.rows.set(row.id, { ...row }); }
}

describe("listening history", () => {
  test("switches close the previous session; duplicate starts and stops are idempotent", async () => {
    let now = 1_000;
    const storage = new MemoryStorage();
    const history = new ListeningHistory(storage, () => now);
    await history.ready;
    history.transition("white");
    now += 60_000;
    history.transition("white");
    now += 60_000;
    history.transition("fan");
    now += 30_000;
    history.transition(null);
    history.transition(null);
    await history.flushed();
    const sessions = await storage.read();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.endedAt! - sessions[0]!.startedAt).toBe(120_000);
    expect(sessions[1]!.endedAt! - sessions[1]!.startedAt).toBe(30_000);
    expect(sessions[0]!.id).not.toBe(sessions[1]!.id);
    expect(sessions.map((row) => row.soundId)).toEqual(["white", "fan"]);
  });

  test("relaunch only counts up to the last checkpoint; new plays preserve old sessions", async () => {
    let now = 1_000;
    const storage = new MemoryStorage();
    const first = new ListeningHistory(storage, () => now);
    await first.ready;
    first.transition("waves");
    now += 45_000;
    first.checkpoint();
    await first.flushed();
    now += 86_400_000;
    const second = new ListeningHistory(storage, () => now);
    second.transition("pink"); // Playback can start before the initial read resolves.
    await second.ready;
    expect(second.snapshot()).toHaveLength(2);
    expect(second.snapshot().find((row) => row.soundId === "waves")!.updatedAt).toBe(46_000);
    expect(first.snapshot()[0]!.updatedAt).toBe(now);
    second.transition(null);
    await second.flushed();
    expect(storage.rows.size).toBe(2);
  });

  test("independent tabs preserve their sessions", async () => {
    const storage = new MemoryStorage();
    const first = new ListeningHistory(storage, () => 100);
    const second = new ListeningHistory(storage, () => 200);
    await Promise.all([first.ready, second.ready]);
    first.transition("brown");
    second.transition("fan");
    await Promise.all([first.flushed(), second.flushed()]);
    await first.refresh();
    expect(first.snapshot().map((row) => row.soundId).sort()).toEqual(["brown", "fan"]);
  });

  test("storage failure is visible and leaves in-memory tracking usable", async () => {
    let now = 10;
    const history = new ListeningHistory({ async read() { throw Error(); }, async write() { throw Error(); } }, () => now);
    await history.ready;
    history.transition("white");
    now += 60_000;
    history.transition(null);
    await history.flushed();
    expect(history.storageFailed).toBe(true);
    expect(history.snapshot()[0]!.endedAt).toBe(now);
  });

  test("clock rollback cannot produce negative intervals", async () => {
    let now = 1000;
    const history = new ListeningHistory(new MemoryStorage(), () => now);
    await history.ready;
    history.transition("white");
    now = 900;
    history.transition(null);
    expect(history.snapshot()[0]!.endedAt).toBe(1000);
  });

  test("sessions are split across local midnight and clipped to the selected window", () => {
    const start = new Date(2026, 9, 18, 23, 30).getTime();
    const end = new Date(2026, 9, 19, 1, 15).getTime();
    const rows = [{ id: "test", soundId: "waves", startedAt: start, endedAt: end, updatedAt: end }];
    const days = historyDays(rows, new Date(2026, 9, 19));
    expect(days[5]!.minutes.waves).toBe(30);
    expect(days[6]!.minutes.waves).toBe(75);
    expect(historyDays(rows, new Date(2026, 9, 18))[6]!.minutes.waves).toBe(30);
    expect(historyDays(rows, new Date(2026, 9, 17)).every((day) => day.minutes.waves === 0)).toBe(true);
  });

  test("unknown sound IDs survive storage but do not corrupt current chart totals", () => {
    const start = new Date(2026, 9, 19).getTime();
    const row = { id: "future", soundId: "future-sound", startedAt: start, endedAt: start + 60_000, updatedAt: start + 60_000 };
    expect(isSession(row)).toBe(true);
    expect(historyDays([row], new Date(start))[6]!.minutes.white).toBe(0);
    expect(isSession({ ...row, endedAt: start - 1 })).toBe(false);
    expect(isSession({ ...row, updatedAt: NaN })).toBe(false);
  });
});
