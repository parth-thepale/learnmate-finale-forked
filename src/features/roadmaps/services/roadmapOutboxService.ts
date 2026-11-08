import type { CloudData, CloudDocStore, CloudWriteOp } from '../../../services/cloudStore';
import {
  STORAGE_KEYS,
  scopeForUid,
  scopedKey,
  type KeyValueStorage,
} from '../../../services/localScope';

export interface RoadmapOutboxMutation {
  id: string;
  uid: string;
  createdAt: string;
  type: 'set';
  path: string;
  data: CloudData;
  merge?: boolean;
  attemptCount: number;
  lastAttemptAt?: string;
  lastError?: string;
  isPermanentFailure?: boolean;
}

export interface SafeFailureDiagnostic {
  id: string;
  path: string;
  attemptCount: number;
  lastAttemptAt?: string;
  lastError?: string;
  isPermanentFailure: boolean;
  createdAt: string;
}

export class OutboxPersistenceError extends Error {
  readonly code = 'PERSISTENCE_FAILED';
  constructor(
    message: string,
    public readonly uid: string,
    public readonly mutations: RoadmapOutboxMutation[],
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'OutboxPersistenceError';
  }
}

/** Returns safe diagnostic information about a failed mutation without leaking sensitive payload data. */
export function getSafeFailureDiagnostics(mutation: RoadmapOutboxMutation): SafeFailureDiagnostic {
  return {
    id: mutation.id,
    path: mutation.path,
    attemptCount: mutation.attemptCount,
    lastAttemptAt: mutation.lastAttemptAt,
    lastError: mutation.lastError ? mutation.lastError.slice(0, 200) : undefined,
    isPermanentFailure: Boolean(mutation.isPermanentFailure),
    createdAt: mutation.createdAt,
  };
}

export type OutboxMutationInput = Omit<
  RoadmapOutboxMutation,
  'id' | 'createdAt' | 'attemptCount' | 'uid'
>;

export const MAX_OUTBOX_RETRIES = 5;
export const BASE_RETRY_DELAY_MS = 1000;
export const MAX_RETRY_DELAY_MS = 30000;

const inMemoryFallback = new Map<string, string>();

function getStorage(customStorage?: KeyValueStorage): KeyValueStorage {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return {
    get length() {
      return inMemoryFallback.size;
    },
    key(index: number) {
      return Array.from(inMemoryFallback.keys())[index] ?? null;
    },
    getItem(key: string) {
      return inMemoryFallback.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      inMemoryFallback.set(key, value);
    },
    removeItem(key: string) {
      inMemoryFallback.delete(key);
    },
  };
}

/** Computes bounded exponential backoff with 15-30% jitter. */
export function computeBackoffDelay(attempt: number): number {
  const exp = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * (BASE_RETRY_DELAY_MS * 0.3));
  return Math.min(MAX_RETRY_DELAY_MS, exp + jitter);
}

/** Categorizes error as permanent (schema/permission) or transient (network/offline). */
export function isPermanentError(error: unknown): boolean {
  if (!error) return false;
  const msg = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    msg.includes('permission-denied') ||
    msg.includes('permission denied') ||
    msg.includes('permission_denied') ||
    msg.includes('invalid_argument') ||
    msg.includes('invalid argument') ||
    msg.includes('not-found') ||
    msg.includes('not_found')
  );
}

export class RoadmapOutboxService {
  private static flushingUids = new Set<string>();
  private static activeFlushPromises = new Map<string, Promise<{ sent: number; remaining: number; failed: number }>>();
  private static pendingFollowUpFlushes = new Set<string>();
  private static retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly MAX_UNPERSISTED_COUNT = 20;
  private static unpersistedMutations = new Map<string, RoadmapOutboxMutation[]>();

  /** Returns count of mutations currently held only in volatile memory due to storage failure. */
  static getUnpersistedCount(uid: string): number {
    return this.unpersistedMutations.get(uid)?.length ?? 0;
  }

  /** Returns mutations held only in volatile memory. */
  static getUnpersistedMutations(uid: string): RoadmapOutboxMutation[] {
    return this.unpersistedMutations.get(uid) ? [...this.unpersistedMutations.get(uid)!] : [];
  }

  /** Clears in-memory unpersisted mutations for a user. */
  static clearUnpersisted(uid: string): void {
    this.unpersistedMutations.delete(uid);
  }

  /** Loads all pending mutations for a specific authenticated user. */
  static getOutbox(uid: string, customStorage?: KeyValueStorage): RoadmapOutboxMutation[] {
    if (!uid) return [];
    const storage = getStorage(customStorage);
    if (!storage) return [];

    const scope = scopeForUid(uid);
    const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_OUTBOX);

    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as RoadmapOutboxMutation[];
      // Strict UID boundary: discard any record belonging to a different UID
      return Array.isArray(parsed) ? parsed.filter((m) => m && m.uid === uid) : [];
    } catch {
      return [];
    }
  }

  /** Persists a mutation locally before attempting cloud write. */
  static enqueue(
    mutation: OutboxMutationInput,
    uid: string,
    customStorage?: KeyValueStorage
  ): RoadmapOutboxMutation {
    const list = this.enqueueBatch([mutation], uid, customStorage);
    return list[0];
  }

  /** Atomically enqueues multiple mutations for a user. */
  static enqueueBatch(
    mutations: OutboxMutationInput[],
    uid: string,
    customStorage?: KeyValueStorage
  ): RoadmapOutboxMutation[] {
    if (!uid || mutations.length === 0) return [];
    const storage = getStorage(customStorage);
    const existing = this.getOutbox(uid, customStorage);

    const now = new Date().toISOString();
    const created: RoadmapOutboxMutation[] = mutations.map((m, idx) => ({
      ...m,
      id: `mut_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      uid,
      createdAt: now,
      attemptCount: 0,
      merge: m.merge !== false,
    }));

    const combined = [...existing, ...created];

    if (storage) {
      const scope = scopeForUid(uid);
      const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_OUTBOX);
      try {
        storage.setItem(key, JSON.stringify(combined));
      } catch (err) {
        // Retain in bounded in-memory list so mutations are not completely lost,
        // but throw OutboxPersistenceError so callers never mistake this for durable persistence.
        const prev = this.unpersistedMutations.get(uid) || [];
        const next = [...prev, ...created].slice(-this.MAX_UNPERSISTED_COUNT);
        this.unpersistedMutations.set(uid, next);

        console.warn('[RoadmapOutboxService] Failed to persist outbox mutations to disk:', err);
        throw new OutboxPersistenceError(
          `Failed to persist ${created.length} roadmap mutation(s) to durable storage: ${err instanceof Error ? err.message : String(err)}`,
          uid,
          created,
          err
        );
      }
    }

    return created;
  }

  /** Removes acknowledged mutations from durable storage. */
  static remove(mutationIds: string[], uid: string, customStorage?: KeyValueStorage): void {
    if (!uid || mutationIds.length === 0) return;
    const storage = getStorage(customStorage);
    if (!storage) return;

    const existing = this.getOutbox(uid, customStorage);
    const idSet = new Set(mutationIds);
    const remaining = existing.filter((m) => !idSet.has(m.id));

    const scope = scopeForUid(uid);
    const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_OUTBOX);
    try {
      storage.setItem(key, JSON.stringify(remaining));
    } catch (err) {
      console.warn('[RoadmapOutboxService] Failed to update outbox after removal:', err);
    }
  }

  /** Updates failure metadata for an unacknowledged mutation. */
  static markAttemptFailed(
    mutationIds: string[],
    error: unknown,
    uid: string,
    customStorage?: KeyValueStorage
  ): void {
    if (!uid || mutationIds.length === 0) return;
    const storage = getStorage(customStorage);
    if (!storage) return;

    const existing = this.getOutbox(uid, customStorage);
    const idSet = new Set(mutationIds);
    const errString = error instanceof Error ? error.message : String(error);
    const isPerm = isPermanentError(error);

    const updated = existing.map((m) => {
      if (!idSet.has(m.id)) return m;
      const count = (m.attemptCount || 0) + 1;
      return {
        ...m,
        attemptCount: count,
        lastAttemptAt: new Date().toISOString(),
        lastError: errString.slice(0, 200), // sanitize / truncate error text
        isPermanentFailure: isPerm || count >= MAX_OUTBOX_RETRIES,
      };
    });

    const scope = scopeForUid(uid);
    const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_OUTBOX);
    try {
      storage.setItem(key, JSON.stringify(updated));
    } catch (err) {
      console.warn('[RoadmapOutboxService] Failed to persist failure updates:', err);
    }
  }

  /**
   * Flushes pending mutations for a user in an atomic batch.
   * Uses concurrency locking, path coalescing (preventing duplicate batch operations),
   * and exponential backoff on retry.
   */
  static async flush(
    uid: string,
    cloud: CloudDocStore,
    customStorage?: KeyValueStorage
  ): Promise<{ sent: number; remaining: number; failed: number }> {
    if (!uid) return { sent: 0, remaining: 0, failed: 0 };

    // Concurrency guard: if already flushing for this UID, register follow-up and return active promise
    if (this.flushingUids.has(uid)) {
      this.pendingFollowUpFlushes.add(uid);
      const active = this.activeFlushPromises.get(uid);
      if (active) return active;
      return { sent: 0, remaining: this.getPendingCount(uid, customStorage), failed: 0 };
    }

    const flushExecution = (async () => {
      this.flushingUids.add(uid);
      let totalSent = 0;
      let totalFailed = 0;

      try {
        let shouldContinue = true;
        while (shouldContinue) {
          this.pendingFollowUpFlushes.delete(uid);

          const all = this.getOutbox(uid, customStorage);
          const pending = all.filter((m) => !m.isPermanentFailure);
          const unpersisted = this.unpersistedMutations.get(uid) || [];

          if (pending.length === 0 && unpersisted.length === 0) {
            break;
          }

          // Coalesce mutations per path to prevent duplicate writeBatch document operations
          const allToFlush = [...pending, ...unpersisted];
          const pathMap = new Map<string, { op: CloudWriteOp; mutationIds: string[] }>();

          for (const m of allToFlush) {
            const existing = pathMap.get(m.path);
            if (!existing) {
              pathMap.set(m.path, {
                op: {
                  type: m.type,
                  path: m.path,
                  data: { ...m.data },
                  merge: m.merge !== false,
                },
                mutationIds: m.id ? [m.id] : [],
              });
            } else {
              // Merge successive operations to the same document path
              if (existing.op.type === 'set') {
                if (m.merge !== false) {
                  existing.op.data = { ...existing.op.data, ...m.data };
                } else {
                  existing.op.data = { ...m.data };
                  existing.op.merge = false;
                }
              }
              if (m.id) existing.mutationIds.push(m.id);
            }
          }

          const ops: CloudWriteOp[] = [];
          for (const entry of pathMap.values()) {
            ops.push(entry.op);
          }
          const pendingMutationIds = pending.map((m) => m.id);

          try {
            await cloud.commit(ops);
            // Acknowledged! Remove only successfully committed persisted mutations
            if (pendingMutationIds.length > 0) {
              this.remove(pendingMutationIds, uid, customStorage);
            }
            // Cloud has durably acknowledged: clear in-memory unpersisted entries
            this.unpersistedMutations.delete(uid);

            // Cancel any pending retry timer for this uid
            const activeTimer = this.retryTimers.get(uid);
            if (activeTimer) {
              clearTimeout(activeTimer);
              this.retryTimers.delete(uid);
            }

            totalSent += allToFlush.length;
          } catch (err) {
            // Check if attempt document was already committed in a prior attempt
            let salvagedAny = false;
            if (isPermanentError(err) && pending.some((p) => p.path.includes('/roadmapAttempts/'))) {
              const attemptMutations = pending.filter((p) => p.path.includes('/roadmapAttempts/'));
              const acknowledgedIds: string[] = [];
              for (const att of attemptMutations) {
                const docSnap = await cloud.getDoc(att.path).catch(() => null);
                if (docSnap) acknowledgedIds.push(att.id);
              }
              if (acknowledgedIds.length > 0) {
                this.remove(acknowledgedIds, uid, customStorage);
                salvagedAny = true;
              }
            }

            // Record failure for remaining persisted mutations
            const remainingToFail = pendingMutationIds.filter(
              (id) => !salvagedAny || this.getOutbox(uid, customStorage).some((m) => m.id === id)
            );
            if (remainingToFail.length > 0) {
              this.markAttemptFailed(remainingToFail, err, uid, customStorage);
            }

            // If not permanent, schedule bounded backoff retry if in browser environment
            const maxAttemptsSoFar = Math.max(...pending.map((p) => p.attemptCount || 0), 0) + 1;
            if (!isPermanentError(err) && maxAttemptsSoFar < MAX_OUTBOX_RETRIES) {
              this.scheduleRetry(uid, cloud, maxAttemptsSoFar, customStorage);
            }

            totalFailed += allToFlush.length;
            break;
          }

          // Continue if a follow-up flush was enqueued while in flight
          shouldContinue = this.pendingFollowUpFlushes.has(uid) || this.getPendingCount(uid, customStorage) > 0;
        }

        return {
          sent: totalSent,
          remaining: this.getPendingCount(uid, customStorage) + this.getUnpersistedCount(uid),
          failed: totalFailed,
        };
      } finally {
        this.flushingUids.delete(uid);
        this.activeFlushPromises.delete(uid);
      }
    })();

    this.activeFlushPromises.set(uid, flushExecution);
    return flushExecution;
  }

  /** Schedules a retry with bounded exponential backoff + jitter. */
  private static scheduleRetry(
    uid: string,
    cloud: CloudDocStore,
    attemptCount: number,
    customStorage?: KeyValueStorage
  ): void {
    if (typeof window === 'undefined') return;

    const existingTimer = this.retryTimers.get(uid);
    if (existingTimer) clearTimeout(existingTimer);

    const delayMs = computeBackoffDelay(attemptCount);
    const timer = setTimeout(() => {
      this.retryTimers.delete(uid);
      this.flush(uid, cloud, customStorage).catch((e) =>
        console.warn('[RoadmapOutboxService] Retry flush error:', e)
      );
    }, delayMs);

    this.retryTimers.set(uid, timer);
  }

  /** Cancels any active retry timers (e.g. on sign-out). */
  static cancelRetryTimers(uid?: string): void {
    if (uid) {
      const timer = this.retryTimers.get(uid);
      if (timer) {
        clearTimeout(timer);
        this.retryTimers.delete(uid);
      }
      this.pendingFollowUpFlushes.delete(uid);
      this.activeFlushPromises.delete(uid);
    } else {
      for (const [, timer] of this.retryTimers) {
        clearTimeout(timer);
      }
      this.retryTimers.clear();
      this.pendingFollowUpFlushes.clear();
      this.activeFlushPromises.clear();
    }
  }

  /** Returns count of pending active mutations (excluding permanently failed). */
  static getPendingCount(uid: string, customStorage?: KeyValueStorage): number {
    return this.getOutbox(uid, customStorage).filter((m) => !m.isPermanentFailure).length;
  }

  /** Returns all permanently failed mutations for an authenticated user. */
  static getPermanentFailures(uid: string, customStorage?: KeyValueStorage): RoadmapOutboxMutation[] {
    if (!uid) return [];
    return this.getOutbox(uid, customStorage).filter((m) => Boolean(m.isPermanentFailure));
  }

  /**
   * Manually retries a specific permanently failed mutation.
   * Resets the failure state and attempts an immediate cloud commit.
   * If successful, removes the mutation from outbox.
   */
  static async retryFailedMutation(
    uid: string,
    mutationId: string,
    cloud: CloudDocStore,
    customStorage?: KeyValueStorage
  ): Promise<boolean> {
    if (!uid || !mutationId) return false;
    const storage = getStorage(customStorage);
    const all = this.getOutbox(uid, customStorage);
    const target = all.find((m) => m.id === mutationId);
    if (!target) return false;

    // Reset permanent failure flag and reset attempt count so it can be retried
    const updated = all.map((m) =>
      m.id === mutationId
        ? { ...m, isPermanentFailure: false, attemptCount: 0, lastError: undefined }
        : m
    );

    if (storage) {
      const scope = scopeForUid(uid);
      const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_OUTBOX);
      try {
        storage.setItem(key, JSON.stringify(updated));
      } catch (err) {
        console.warn('[RoadmapOutboxService] Failed to reset mutation for retry:', err);
      }
    }

    const op: CloudWriteOp = {
      type: target.type,
      path: target.path,
      data: target.data,
      merge: target.merge !== false,
    };

    try {
      if (target.path.includes('/roadmapAttempts/')) {
        const existingDoc = await cloud.getDoc(target.path).catch(() => null);
        if (existingDoc) {
          this.remove([mutationId], uid, customStorage);
          return true;
        }
      }
      await cloud.commit([op]);
      this.remove([mutationId], uid, customStorage);
      return true;
    } catch (err) {
      if (target.path.includes('/roadmapAttempts/')) {
        const existingDoc = await cloud.getDoc(target.path).catch(() => null);
        if (existingDoc) {
          this.remove([mutationId], uid, customStorage);
          return true;
        }
      }
      this.markAttemptFailed([mutationId], err, uid, customStorage);
      return false;
    }
  }

  /**
   * Manually retries all permanently failed mutations for a user.
   * Retrying one mutation does not block others.
   */
  static async retryAllFailedMutations(
    uid: string,
    cloud: CloudDocStore,
    customStorage?: KeyValueStorage
  ): Promise<{ retried: number; succeeded: number; failed: number }> {
    if (!uid) return { retried: 0, succeeded: 0, failed: 0 };
    const all = this.getOutbox(uid, customStorage);
    const failedMutations = all.filter((m) => m.isPermanentFailure);
    if (failedMutations.length === 0) return { retried: 0, succeeded: 0, failed: 0 };

    let succeeded = 0;
    let failed = 0;

    for (const m of failedMutations) {
      const ok = await this.retryFailedMutation(uid, m.id, cloud, customStorage);
      if (ok) succeeded++;
      else failed++;
    }

    return { retried: failedMutations.length, succeeded, failed };
  }

  /** Clears outbox (used in tests or account wipe). */
  static clearOutbox(uid: string, customStorage?: KeyValueStorage): void {
    const storage = getStorage(customStorage);
    if (!storage || !uid) return;
    const scope = scopeForUid(uid);
    storage.removeItem(scopedKey(scope, STORAGE_KEYS.ROADMAP_OUTBOX));
    this.clearUnpersisted(uid);
  }
}
