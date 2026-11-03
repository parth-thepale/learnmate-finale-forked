import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FirestoreDailyQuotaStore,
  MemoryDailyQuotaStore,
  QuotaUnavailableError,
  UnavailableDailyQuotaStore,
  quotaDayKey,
  quotaResetsAt,
  type QuotaFirestore,
  type QuotaTransaction,
} from './quotaStore.ts';

test('quota days roll over at midnight IST, not UTC', () => {
  // 18:29 UTC = 23:59 IST on 3 Nov
  assert.equal(quotaDayKey(new Date('2026-11-03T18:29:00Z')), '2026-11-03');
  // 18:30 UTC = 00:00 IST on 4 Nov
  assert.equal(quotaDayKey(new Date('2026-11-03T18:30:00Z')), '2026-11-04');
  assert.equal(quotaResetsAt(new Date('2026-11-03T10:00:00Z')).toISOString(), '2026-11-03T18:30:00.000Z');
  assert.equal(quotaResetsAt(new Date('2026-11-03T18:30:00Z')).toISOString(), '2026-11-04T18:30:00.000Z');
});

test('memory store enforces limits per user per day', async () => {
  const store = new MemoryDailyQuotaStore();
  const day1 = new Date('2026-11-03T05:00:00Z');
  assert.equal((await store.consume('alice', 3, 5, day1)).allowed, true);
  const blocked = await store.consume('alice', 3, 5, day1);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.used, 3);
  assert.equal((await store.consume('alice', 2, 5, day1)).allowed, true);
  assert.equal((await store.consume('bob', 5, 5, day1)).allowed, true);
  const nextDay = new Date('2026-11-04T05:00:00Z');
  assert.equal((await store.consume('alice', 5, 5, nextDay)).allowed, true);
});

test('quota store rejects invalid subjects and units', async () => {
  const store = new MemoryDailyQuotaStore();
  await assert.rejects(store.consume('', 1, 5));
  await assert.rejects(store.consume('a/b', 1, 5));
  await assert.rejects(store.consume('alice', 0, 5));
  await assert.rejects(store.consume('alice', 1.5, 5));
});

test('unavailable store always fails closed', async () => {
  await assert.rejects(new UnavailableDailyQuotaStore('missing').consume(), QuotaUnavailableError);
});

/** Fake Firestore that serialises transactions, like the real service does per document. */
class FakeFirestore implements QuotaFirestore {
  docs = new Map<string, Record<string, unknown>>();
  failNext = false;
  private queue: Promise<unknown> = Promise.resolve();

  collection(path: string) {
    return { doc: (id: string) => `${path}/${id}` };
  }

  runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T> {
    const run = async () => {
      if (this.failNext) {
        this.failNext = false;
        throw new Error('PERMISSION_DENIED: Missing or insufficient permissions.');
      }
      const writes: Array<[string, Record<string, unknown>]> = [];
      const tx: QuotaTransaction = {
        get: async (ref) => {
          const data = this.docs.get(ref as string);
          return { exists: data !== undefined, data: () => data };
        },
        set: (ref, data) => {
          writes.push([ref as string, data]);
        },
      };
      const result = await fn(tx);
      for (const [ref, data] of writes) this.docs.set(ref, data);
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

test('Firestore store persists usage per user/day and never exceeds the limit under concurrency', async () => {
  const db = new FakeFirestore();
  const store = new FirestoreDailyQuotaStore(db);
  const now = new Date('2026-11-03T05:00:00Z');

  const results = await Promise.all(Array.from({ length: 10 }, () => store.consume('alice', 2, 9, now)));
  assert.equal(results.filter((r) => r.allowed).length, 4);

  const doc = db.docs.get('aiUsageDaily/alice_2026-11-03');
  assert.ok(doc);
  assert.equal(doc.units, 8);
  assert.equal(doc.requests, 4);
  assert.equal(doc.uid, 'alice');
  assert.ok(doc.expireAt instanceof Date);

  // A new store instance (e.g. after a server restart) sees the same durable usage.
  const afterRestart = new FirestoreDailyQuotaStore(db);
  assert.equal((await afterRestart.consume('alice', 2, 9, now)).allowed, false);
  assert.equal((await afterRestart.consume('alice', 1, 9, now)).allowed, true);
});

test('Firestore errors surface as QuotaUnavailableError (fail closed)', async () => {
  const db = new FakeFirestore();
  db.failNext = true;
  const store = new FirestoreDailyQuotaStore(db);
  await assert.rejects(store.consume('alice', 1, 5), QuotaUnavailableError);
});
