/**
 * Tracks cloud-sync health so the UI only says "synced" when every write actually succeeded.
 */

export type SyncState = 'local-only' | 'syncing' | 'synced' | 'unsynced';

export interface SyncSnapshot {
  state: SyncState;
  pendingWrites: number;
  /** Local changes not yet confirmed in the cloud (persisted across reloads). */
  unsyncedChanges: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export class SyncStatusTracker {
  private signedIn = false;
  private pending = 0;
  private lastError: string | null = null;
  private lastSyncedAt: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly countUnsynced: () => number,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
    this.pending = 0;
    this.lastError = null;
    this.lastSyncedAt = null;
    this.emit();
  }

  /** Wraps a cloud write: counts it as pending and records success or failure. */
  async track<T>(operation: () => Promise<T>): Promise<T> {
    this.pending++;
    this.emit();
    try {
      const result = await operation();
      this.lastSyncedAt = this.now();
      return result;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message.slice(0, 200) : 'Cloud write failed';
      throw err;
    } finally {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0 && this.countUnsynced() === 0) this.lastError = null;
      this.emit();
    }
  }

  recordError(message: string): void {
    this.lastError = message.slice(0, 200);
    this.emit();
  }

  snapshot(): SyncSnapshot {
    const unsyncedChanges = this.countUnsynced();
    let state: SyncState;
    if (!this.signedIn) state = 'local-only';
    else if (this.pending > 0) state = 'syncing';
    else if (unsyncedChanges > 0 || this.lastError) state = 'unsynced';
    else state = 'synced';
    return {
      state,
      pendingWrites: this.pending,
      unsyncedChanges,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }
}
