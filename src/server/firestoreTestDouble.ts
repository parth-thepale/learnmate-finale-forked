import { assertFirestoreValue } from '../utils/firestoreData';
import type { QuotaFirestore, QuotaTransaction } from './quotaStore';

/**
 * Test double for the Firebase Admin Firestore API used by the server stores. Like the real
 * service it serialises transactions and rejects documents Firestore cannot store (undefined
 * anywhere, nested arrays, functions...), so tests catch writes that would fail in production.
 * Test-only: nothing in the server imports it.
 */
export class StrictFakeFirestore implements QuotaFirestore {
  readonly docs = new Map<string, Record<string, unknown>>();
  /** Every successful write, in order (deep copies). */
  readonly writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  failNext: false | string = false;
  private queue: Promise<unknown> = Promise.resolve();

  collection(path: string) {
    return { doc: (id: string) => `${path}/${id}` };
  }

  runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T> {
    const run = async () => {
      if (this.failNext) {
        const message = this.failNext;
        this.failNext = false;
        throw new Error(message);
      }
      const staged: Array<[string, Record<string, unknown>]> = [];
      const tx: QuotaTransaction = {
        get: async (ref) => {
          const data = this.docs.get(ref as string);
          return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
        },
        set: (ref, data) => {
          // The Admin SDK validates synchronously inside set(); a failure aborts the transaction.
          assertFirestoreValue(data);
          staged.push([ref as string, structuredClone(data)]);
        },
      };
      const result = await fn(tx);
      for (const [path, data] of staged) {
        this.docs.set(path, data);
        this.writes.push({ path, data: structuredClone(data) });
      }
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
