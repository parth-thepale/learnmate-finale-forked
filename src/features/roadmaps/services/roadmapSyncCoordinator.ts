import type { User } from 'firebase/auth';
import type { CloudDocStore } from '../../../services/cloudStore';
import type { KeyValueStorage } from '../../../services/localScope';
import { RoadmapOutboxService } from './roadmapOutboxService';
import { RoadmapSyncService } from './roadmapSyncService';
import type { RoadmapProgress } from '../types/progress.types';

export type UnifiedSyncState =
  | 'synced'
  | 'syncing'
  | 'offline_pending'
  | 'sync_failed'
  | 'has_failed_mutations'
  | 'persistence_failed';

export interface UnifiedSyncStatus {
  state: UnifiedSyncState;
  pendingCount: number;
  failedCount: number;
  unpersistedCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export class RoadmapSyncCoordinator {
  private static instance: RoadmapSyncCoordinator | null = null;

  private currentUid: string | null = null;
  private cloud: CloudDocStore | null = null;
  private storage?: KeyValueStorage;

  private cleanupReconnect: (() => void) | null = null;
  private cleanupSubscription: (() => void) | null = null;

  private isSyncing = false;
  private activeSyncPromise: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastSyncedAt: string | null = null;

  private readonly listeners = new Set<(status: UnifiedSyncStatus) => void>();
  private readonly roadmapUpdateListeners = new Set<(roadmaps: Record<string, RoadmapProgress>) => void>();

  static getInstance(): RoadmapSyncCoordinator {
    if (!this.instance) {
      this.instance = new RoadmapSyncCoordinator();
    }
    return this.instance;
  }

  /**
   * Sets the active user context at the root level.
   * Cleans up previous listeners, subscriptions, and timers on UID change.
   * If user is null (guest), does NOT subscribe to authenticated Firestore collections.
   */
  setUser(user: User | null, cloud: CloudDocStore, storage?: KeyValueStorage): void {
    const nextUid = user?.uid ?? null;

    if (this.currentUid === nextUid && this.cloud === cloud) {
      return;
    }

    // Teardown previous user's subscriptions and timers
    this.teardownCurrent();

    this.currentUid = nextUid;
    this.cloud = cloud;
    this.storage = storage;

    if (!nextUid) {
      this.emitStatus();
      return;
    }

    // Start root-level sync lifecycle for authenticated user
    this.initAuthenticatedLifecycle(nextUid, cloud, storage);
  }

  private teardownCurrent(): void {
    if (this.cleanupReconnect) {
      this.cleanupReconnect();
      this.cleanupReconnect = null;
    }
    if (this.cleanupSubscription) {
      this.cleanupSubscription();
      this.cleanupSubscription = null;
    }
    if (this.currentUid) {
      RoadmapOutboxService.cancelRetryTimers(this.currentUid);
    }
    this.isSyncing = false;
    // Account switch / teardown: clean up all user-specific sync state
    this.lastError = null;
    this.lastSyncedAt = null;
  }

  private initAuthenticatedLifecycle(uid: string, cloud: CloudDocStore, storage?: KeyValueStorage): void {
    // 1. Setup online reconnect listener (persists across navigation)
    this.cleanupReconnect = RoadmapSyncService.setupOnlineReconnectListener(
      uid,
      cloud,
      storage,
      () => {
        // Drop notification if context transitioned to another account
        if (this.currentUid !== uid) return;
        this.lastSyncedAt = new Date().toISOString();
        this.lastError = null;
        this.emitStatus();
      }
    );

    // 2. Setup real-time Firestore subscriber (persists across navigation)
    this.cleanupSubscription = RoadmapSyncService.subscribeToRoadmapSync(
      uid,
      cloud,
      (merged) => {
        // Drop notification if context transitioned to another account
        if (this.currentUid !== uid) return;
        for (const listener of this.roadmapUpdateListeners) {
          try {
            listener(merged);
          } catch {}
        }
        this.emitStatus();
      },
      storage
    );

    // 3. Initial outbox flush & sync
    this.triggerSync();
  }

  async triggerSync(): Promise<void> {
    if (!this.currentUid || !this.cloud) return;
    if (this.activeSyncPromise) return this.activeSyncPromise;
    const uid = this.currentUid;
    const cloud = this.cloud;

    this.isSyncing = true;
    this.emitStatus();

    this.activeSyncPromise = (async () => {
      try {
        await RoadmapOutboxService.flush(uid, cloud, this.storage);
        await RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, this.storage);
        if (this.currentUid !== uid) return;
        this.lastSyncedAt = new Date().toISOString();
        this.lastError = null;
      } catch (err) {
        if (this.currentUid !== uid) return;
        this.lastError = err instanceof Error ? err.message : String(err);
      } finally {
        this.activeSyncPromise = null;
        if (this.currentUid === uid) {
          this.isSyncing = false;
          this.emitStatus();
        }
      }
    })();

    return this.activeSyncPromise;
  }

  async retry(): Promise<void> {
    this.lastError = null;
    await this.retryFailedMutations();
    await this.triggerSync();
  }

  async retryFailedMutations(): Promise<{ retried: number; succeeded: number }> {
    if (!this.currentUid || !this.cloud) return { retried: 0, succeeded: 0 };
    const uid = this.currentUid;
    this.isSyncing = true;
    this.emitStatus();

    try {
      const res = await RoadmapOutboxService.retryAllFailedMutations(this.currentUid, this.cloud, this.storage);
      if (this.currentUid !== uid) return res;
      if (res.succeeded > 0) {
        this.lastSyncedAt = new Date().toISOString();
        this.lastError = null;
      }
      return res;
    } finally {
      if (this.currentUid === uid) {
        this.isSyncing = false;
        this.emitStatus();
      }
    }
  }

  notifyPersistenceChange(): void {
    this.emitStatus();
  }

  getStatus(): UnifiedSyncStatus {
    const uid = this.currentUid;
    if (!uid) {
      return {
        state: 'synced',
        pendingCount: 0,
        failedCount: 0,
        unpersistedCount: 0,
        lastError: null,
        lastSyncedAt: null,
      };
    }

    const pendingCount = RoadmapOutboxService.getPendingCount(uid, this.storage);
    const failedMutations = RoadmapOutboxService.getPermanentFailures(uid, this.storage);
    const failedCount = failedMutations.length;
    const unpersistedCount = RoadmapOutboxService.getUnpersistedCount(uid);

    let state: UnifiedSyncState = 'synced';
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (this.isSyncing) {
      state = 'syncing';
    } else if (unpersistedCount > 0) {
      state = 'persistence_failed';
    } else if (isOffline && (pendingCount > 0 || unpersistedCount > 0)) {
      state = 'offline_pending';
    } else if (failedCount > 0) {
      state = 'has_failed_mutations';
    } else if (this.lastError && !isOffline) {
      state = 'sync_failed';
    } else if (pendingCount > 0) {
      state = isOffline ? 'offline_pending' : 'syncing';
    }

    return {
      state,
      pendingCount,
      failedCount,
      unpersistedCount,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  subscribeStatus(listener: (status: UnifiedSyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  subscribeRoadmaps(listener: (roadmaps: Record<string, RoadmapProgress>) => void): () => void {
    this.roadmapUpdateListeners.add(listener);
    return () => this.roadmapUpdateListeners.delete(listener);
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {}
    }
  }
}

export const roadmapSyncCoordinator = RoadmapSyncCoordinator.getInstance();
