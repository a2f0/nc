import { STRINGS, type PlatformKey } from "../../l10n/strings";
import { NOISE_TYPES, type NoiseType } from "./noiseType";

export type PlaybackEvent = Extract<PlatformKey<"web">, `log_${string}`>;
export interface PlaybackLogEntry {
  id: string;
  timestamp: number;
  event: PlaybackEvent;
  soundId: NoiseType | null;
  detail: string;
  owner: string;
}
export interface PlaybackMarker { owner: string; soundId: NoiseType; timestamp: number }
export interface PlaybackLogStorage {
  read(): Promise<PlaybackLogEntry[]>;
  write(row: PlaybackLogEntry, active: boolean | undefined): Promise<void>;
  markers(): Promise<PlaybackMarker[]>;
}
export const LOG_LIMIT = 300;

function isMarker(value: unknown): value is PlaybackMarker {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PlaybackMarker>;
  return typeof row.owner === "string" && row.owner.length > 0 && row.owner.length <= 100
    && NOISE_TYPES.includes(row.soundId as NoiseType)
    && typeof row.timestamp === "number" && Number.isFinite(row.timestamp) && Math.abs(row.timestamp) <= 8.64e15;
}

function isEntry(value: unknown): value is PlaybackLogEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PlaybackLogEntry>;
  return isMarker({ ...row, soundId: row.soundId ?? "white" })
    && (row.soundId === null || NOISE_TYPES.includes(row.soundId as NoiseType))
    && typeof row.id === "string" && row.id.length > 0 && row.id.length <= 100
    && typeof row.event === "string" && row.event.startsWith("log_") && Object.hasOwn(STRINGS, row.event)
    && typeof row.detail === "string" && row.detail.length <= 512;
}

/** Transactions serialize pruning and writes across tabs; no tab can overwrite another's log. */
export class IndexedDBPlaybackLogStorage implements PlaybackLogStorage {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory: () => IDBFactory = () => indexedDB) {}

  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory().open("playback-log", 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("events", { autoIncrement: true });
        request.result.createObjectStore("active", { keyPath: "owner" });
      };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); this.database = undefined; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error("Playback log database blocked")); };
    }).catch((error: unknown) => { this.database = undefined; throw error; });
  }

  async read(): Promise<PlaybackLogEntry[]> { return (await this.rows("events")).filter(isEntry); }
  async markers(): Promise<PlaybackMarker[]> { return (await this.rows("active")).filter(isMarker); }

  private async rows(name: string): Promise<unknown[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
  }

  async write(row: PlaybackLogEntry, active: boolean | undefined): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["events", "active"], "readwrite");
      const events = tx.objectStore("events");
      events.add(row);
      const keys = events.getAllKeys();
      keys.onsuccess = () => { for (const key of keys.result.slice(0, -LOG_LIMIT)) events.delete(key); };
      const markers = tx.objectStore("active");
      if (active === true && row.soundId) markers.put({ owner: row.owner, soundId: row.soundId, timestamp: row.timestamp });
      else if (active === false) markers.delete(row.owner);
      // Markers are also bounded, even on browsers without Web Locks recovery.
      const allMarkers = markers.getAll();
      const markerKeys = markers.getAllKeys();
      markerKeys.onsuccess = () => {
        // Prune unknown rows too: an older open tab can encounter a newer schema's data.
        const rows = (allMarkers.result as unknown[]).map((row, index) => ({
          key: markerKeys.result[index]!, timestamp: isMarker(row) ? row.timestamp : -Infinity,
        })).sort((a, b) => a.timestamp - b.timestamp);
        for (const marker of rows.slice(0, -LOG_LIMIT)) markers.delete(marker.key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

export class PlaybackLog {
  entries: PlaybackLogEntry[] = [];
  storageFailed = false;
  readonly owner = crypto.randomUUID();
  private readonly listeners = new Set<() => void>();
  private pending: Promise<void>;
  readonly ready: Promise<void>;

  constructor(private readonly storage: PlaybackLogStorage = new IndexedDBPlaybackLogStorage(),
    private readonly locks: LockManager | null = globalThis.navigator?.locks ?? null) {
    // Holding a document-specific lock distinguishes a dead page from another live tab.
    // Without Web Locks, keep the original events and do not guess which tabs died.
    if (locks) void locks.request(this.owner, () => new Promise<void>(() => {})).catch(() => {});
    this.pending = this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      if (this.locks) {
        for (const marker of await this.storage.markers()) {
          if (marker.owner === this.owner) continue;
          await this.locks.request(marker.owner, { ifAvailable: true }, async (lock) => {
            if (!lock) return;
            // Another new tab may have recovered it while this page was opening.
            if (!(await this.storage.markers()).some((row) => row.owner === marker.owner)) return;
            const row = this.row("log_unclean_exit", marker.soundId,
              `startedAt=${new Date(marker.timestamp).toISOString()}`, marker.owner);
            await this.storage.write(row, false);
            console.info("NoisePlayback", row);
          });
        }
      }
    } catch { this.storageFailed = true; }
    await this.refresh();
  }

  subscribe(listener: () => void): void { this.listeners.add(listener); }
  private publish(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { console.error("NoisePlayback view failed", error); }
    }
  }

  async refresh(): Promise<void> {
    try {
      const merged = new Map((await this.storage.read()).filter(isEntry).map((row) => [row.id, row]));
      for (const row of this.entries) merged.set(row.id, row);
      this.entries = [...merged.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-LOG_LIMIT);
    } catch { this.storageFailed = true; }
    this.publish();
  }

  record(event: PlaybackEvent, soundId: NoiseType | null = null, detail = "", active?: boolean): void {
    const row = this.row(event, soundId, detail);
    console.info("NoisePlayback", row);
    this.entries = [...this.entries, row].slice(-LOG_LIMIT);
    this.publish();
    this.pending = this.pending.then(() => this.storage.write(row, active)).catch(() => {
      this.storageFailed = true;
      this.publish();
    });
  }

  private row(event: PlaybackEvent, soundId: NoiseType | null, detail: string, owner: string = this.owner): PlaybackLogEntry {
    return { id: crypto.randomUUID(), timestamp: Date.now(), event, soundId, detail: detail.slice(0, 512), owner };
  }

  async flushed(): Promise<void> { await this.pending; }
}
