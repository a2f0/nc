import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { setUpPlaybackLifecycle } from "../src/playbackLifecycle";
import { IndexedDBPlaybackLogStorage, PlaybackLog } from "../src/playbackLog";
import type { NoisePlayer } from "../src/noisePlayer";

test("visibility preserves playback; pagehide closes its marker before stopping", async () => {
  const replacements = { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: "hidden" }) };
  const previous = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const factory = new IDBFactory();
    const storage = new IndexedDBPlaybackLogStorage(() => factory);
    const log = new PlaybackLog(storage, null);
    await log.ready;
    let checkpoints = 0, refreshes = 0, stops = 0;
    const player = {
      nowPlaying: "pink" as "pink" | null, playbackLog: log,
      history: { checkpoint() { checkpoints++; }, async refresh() { refreshes++; } },
      stop(source: string, requested: boolean) {
        expect(source).toBe("pagehide");
        expect(requested).toBe(false);
        expect(log.entries.at(-1)?.event).toBe("log_page_hidden");
        // Deliberately omit a subsequent stopped write. Pagehide alone must close it.
        this.nowPlaying = null;
        stops++;
      },
    };
    setUpPlaybackLifecycle(player as unknown as NoisePlayer);
    log.record("log_started", "pink", "", true);
    await log.flushed();
    replacements.document.dispatchEvent(new Event("visibilitychange"));
    await log.flushed();
    expect(await storage.markers()).toHaveLength(1);
    expect(log.entries.at(-1)?.detail).toBe("hidden");
    replacements.document.visibilityState = "visible";
    replacements.document.dispatchEvent(new Event("visibilitychange"));
    replacements.window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
    await log.flushed();
    expect(await storage.markers()).toHaveLength(0);
    expect(log.entries.at(-1)?.detail).toBe("persisted=true");
    expect(stops).toBe(1);
    expect(checkpoints).toBe(2);
    expect(refreshes).toBe(1);
    const count = log.entries.length;
    replacements.document.dispatchEvent(new Event("visibilitychange"));
    replacements.window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: false }));
    expect(log.entries).toHaveLength(count);
    expect(stops).toBe(1);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
