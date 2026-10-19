import { NOISE_TYPES, type NoiseType } from "./noiseType";

/** Version 1 wire format: UTC epoch milliseconds, immutable sound IDs, globally unique session IDs. */
export interface ListeningSession {
  id: string;
  soundId: string;
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
}

export interface HistoryStorage {
  read(): Promise<ListeningSession[]>;
  write(session: ListeningSession): Promise<void>;
}

/** One row per session prevents tabs from overwriting one another's history. */
export class IndexedDBHistoryStorage implements HistoryStorage {
  private database?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("listening-history", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("sessions", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("History database blocked"));
    });
  }

  async read(): Promise<ListeningSession[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("sessions").objectStore("sessions").getAll();
      request.onsuccess = () => resolve((request.result as unknown[]).filter(isSession));
      request.onerror = () => reject(request.error);
    });
  }

  async write(session: ListeningSession): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put(session);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

export function isSession(value: unknown): value is ListeningSession {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ListeningSession>;
  return typeof row.id === "string" && typeof row.soundId === "string"
    && typeof row.startedAt === "number" && Number.isFinite(row.startedAt)
    && typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) && row.updatedAt >= row.startedAt
    && (row.endedAt === null || (typeof row.endedAt === "number" && Number.isFinite(row.endedAt)
      && row.endedAt >= row.startedAt && row.endedAt <= row.updatedAt));
}

export class ListeningHistory {
  private readonly sessions = new Map<string, ListeningSession>();
  private active: ListeningSession | null = null;
  private pending: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  storageFailed = false;
  readonly ready: Promise<void>;

  constructor(private readonly storage: HistoryStorage = new IndexedDBHistoryStorage(), private readonly clock = Date.now) {
    this.ready = this.refresh();
  }

  subscribe(listener: () => void): void { this.listeners.add(listener); }
  private publish(): void { for (const listener of this.listeners) listener(); }

  async refresh(): Promise<void> {
    try {
      for (const session of await this.storage.read()) {
        const current = this.sessions.get(session.id);
        if (!current || session.updatedAt > current.updatedAt) this.sessions.set(session.id, session);
      }
    } catch { this.storageFailed = true; }
    this.publish();
  }

  transition(soundId: NoiseType | null): void {
    if ((this.active?.soundId ?? null) === soundId) return;
    const now = this.clock();
    if (this.active) {
      this.active.updatedAt = Math.max(this.active.startedAt, this.active.updatedAt, now);
      this.active.endedAt = this.active.updatedAt;
      this.save(this.active);
      this.active = null;
    }
    if (soundId !== null) {
      this.active = { id: crypto.randomUUID(), soundId, startedAt: now, updatedAt: now, endedAt: null };
      this.save(this.active);
    }
    this.publish();
  }

  checkpoint(): void {
    if (!this.active) return;
    this.active.updatedAt = Math.max(this.active.updatedAt, this.clock());
    this.save(this.active);
    this.publish();
  }

  snapshot(): ListeningSession[] {
    const now = this.clock();
    return [...this.sessions.values()].map((row) => ({
      ...row,
      // Only this process's active session can extend beyond its last durable checkpoint.
      updatedAt: row.id === this.active?.id ? Math.max(row.updatedAt, now) : row.updatedAt,
    }));
  }

  async flushed(): Promise<void> { await this.pending; }

  private save(session: ListeningSession): void {
    const copy = { ...session };
    this.sessions.set(copy.id, copy);
    this.pending = this.pending.then(() => this.storage.write(copy)).catch(() => {
      this.storageFailed = true;
      this.publish();
    });
  }
}

export interface HistoryDay { start: Date; end: Date; minutes: Record<NoiseType, number> }

/** Calendar arithmetic, rather than 24-hour offsets, also handles daylight-saving days. */
export function historyDays(sessions: readonly ListeningSession[], endDay: Date): HistoryDay[] {
  const end = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1);
  return Array.from({ length: 7 }, (_, index) => {
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7 + index);
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const minutes = Object.fromEntries(NOISE_TYPES.map((type) => [type, 0])) as Record<NoiseType, number>;
    for (const row of sessions) {
      if (!NOISE_TYPES.includes(row.soundId as NoiseType)) continue;
      const overlap = Math.min(row.endedAt ?? row.updatedAt, next.getTime()) - Math.max(row.startedAt, start.getTime());
      minutes[row.soundId as NoiseType] += Math.max(0, overlap) / 60_000;
    }
    return { start, end: next, minutes };
  });
}
