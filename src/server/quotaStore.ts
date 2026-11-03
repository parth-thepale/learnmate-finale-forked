/**
 * Per-user daily AI usage quotas.
 *
 * Production uses FirestoreDailyQuotaStore: counters live in Firestore and are updated inside a
 * transaction, so limits survive restarts and stay correct with more than one server instance.
 * MemoryDailyQuotaStore is for local development and tests only.
 */

import { toFirestoreData } from '../utils/firestoreData';

/** Quota days roll over at midnight India Standard Time (UTC+05:30). */
export const QUOTA_DAY_UTC_OFFSET_MINUTES = 330;

export interface QuotaConsumeResult {
  allowed: boolean;
  used: number;
  limit: number;
  day: string;
  resetsAt: string;
}

export interface DailyQuotaStore {
  readonly kind: 'firestore' | 'memory' | 'unavailable';
  consume(uid: string, units: number, limit: number, now?: Date): Promise<QuotaConsumeResult>;
}

export class QuotaUnavailableError extends Error {
  constructor(message = 'Usage quota service is unavailable.') {
    super(message);
    this.name = 'QuotaUnavailableError';
  }
}

export function quotaDayKey(now: Date, offsetMinutes = QUOTA_DAY_UTC_OFFSET_MINUTES): string {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function quotaResetsAt(now: Date, offsetMinutes = QUOTA_DAY_UTC_OFFSET_MINUTES): Date {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const nextLocalMidnightUtcMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1) - offsetMinutes * 60_000;
  return new Date(nextLocalMidnightUtcMs);
}

function assertConsumeArgs(uid: string, units: number, limit: number): void {
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128 || uid.includes('/')) {
    throw new Error('Invalid quota subject.');
  }
  if (!Number.isInteger(units) || units < 1) throw new Error('Quota units must be a positive integer.');
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Quota limit must be a non-negative integer.');
}

export class MemoryDailyQuotaStore implements DailyQuotaStore {
  readonly kind = 'memory' as const;
  private readonly usage = new Map<string, number>();

  async consume(uid: string, units: number, limit: number, now: Date = new Date()): Promise<QuotaConsumeResult> {
    assertConsumeArgs(uid, units, limit);
    const day = quotaDayKey(now);
    const key = `${uid}_${day}`;
    const used = this.usage.get(key) ?? 0;
    const resetsAt = quotaResetsAt(now).toISOString();
    if (used + units > limit) {
      return { allowed: false, used, limit, day, resetsAt };
    }
    this.usage.set(key, used + units);
    return { allowed: true, used: used + units, limit, day, resetsAt };
  }
}

/** Store that always fails closed (production without Firebase Admin credentials). */
export class UnavailableDailyQuotaStore implements DailyQuotaStore {
  readonly kind = 'unavailable' as const;
  constructor(private readonly reason: string) {}

  async consume(): Promise<QuotaConsumeResult> {
    throw new QuotaUnavailableError(this.reason);
  }
}

/** Minimal structural view of the Firebase Admin Firestore API used by the quota store. */
export interface QuotaDocSnapshot {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface QuotaTransaction {
  get(ref: unknown): Promise<QuotaDocSnapshot>;
  set(ref: unknown, data: Record<string, unknown>): unknown;
  /** Admin SDK Transaction#delete (needed when a submission replaces stale attempt chunks). */
  delete?(ref: unknown): unknown;
}
export interface QuotaFirestore {
  collection(path: string): { doc(id: string): unknown };
  runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T>;
}

export const QUOTA_COLLECTION = 'aiUsageDaily';

export class FirestoreDailyQuotaStore implements DailyQuotaStore {
  readonly kind = 'firestore' as const;

  constructor(
    private readonly db: QuotaFirestore,
    private readonly collectionName: string = QUOTA_COLLECTION
  ) {}

  async consume(uid: string, units: number, limit: number, now: Date = new Date()): Promise<QuotaConsumeResult> {
    assertConsumeArgs(uid, units, limit);
    const day = quotaDayKey(now);
    const resets = quotaResetsAt(now);
    const ref = this.db.collection(this.collectionName).doc(`${uid}_${day}`);

    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() || {} : {};
        const used = typeof data.units === 'number' && Number.isFinite(data.units) ? data.units : 0;
        const requests = typeof data.requests === 'number' && Number.isFinite(data.requests) ? data.requests : 0;

        if (used + units > limit) {
          return { allowed: false, used, limit, day, resetsAt: resets.toISOString() };
        }

        tx.set(ref, toFirestoreData({
          uid,
          day,
          units: used + units,
          requests: requests + 1,
          updatedAt: now.toISOString(),
          // Optional Firestore TTL policy target: documents can be purged a week after the day ends.
          expireAt: new Date(resets.getTime() + 7 * 24 * 60 * 60 * 1000),
        }, { required: ['uid', 'day', 'units', 'requests'], label: 'quota counter' }));
        return { allowed: true, used: used + units, limit, day, resetsAt: resets.toISOString() };
      });
    } catch (err) {
      throw new QuotaUnavailableError(
        `Quota transaction failed: ${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}`
      );
    }
  }
}
