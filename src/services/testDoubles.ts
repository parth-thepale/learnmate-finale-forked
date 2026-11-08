import type { User } from 'firebase/auth';
import type { CloudData, CloudDocStore, CloudWriteOp } from './cloudStore';
import type { KeyValueStorage } from './localScope';
import { FIRESTORE_DOCUMENT_LIMIT_BYTES, utf8ByteLength } from './cloudPayload';
import { assertFirestoreValue } from '../utils/firestoreData';

/** In-memory Storage (localStorage-compatible) with an optional byte quota. */
export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  constructor(private readonly quotaBytes = Number.POSITIVE_INFINITY) {}

  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    const used = [...this.map.entries()].reduce((n, [k, v]) => (k === key ? n : n + k.length + v.length), 0);
    if (used + key.length + value.length > this.quotaBytes) {
      throw new Error('QuotaExceededError');
    }
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** Fake Firestore: atomic batches, strict value checks, 1 MiB document limit, injectable failures and delays. */
export class FakeCloudStore implements CloudDocStore {
  readonly docs = new Map<string, CloudData>();
  failCommits: false | string = false;
  commits = 0;
  /** When set, every operation waits for this promise before running. */
  gate: Promise<void> | null = null;

  private async waitGate() {
    if (this.gate) await this.gate;
  }

  async getDoc(path: string): Promise<CloudData | null> {
    await this.waitGate();
    const doc = this.docs.get(path);
    return doc ? structuredClone(doc) : null;
  }

  async listCollection(path: string): Promise<Array<{ id: string; data: CloudData }>> {
    await this.waitGate();
    const prefix = `${path}/`;
    const out: Array<{ id: string; data: CloudData }> = [];
    for (const [docPath, data] of this.docs) {
      if (!docPath.startsWith(prefix)) continue;
      const rest = docPath.slice(prefix.length);
      if (rest.includes('/')) continue;
      out.push({ id: rest, data: structuredClone(data) });
    }
    return out;
  }

  async commit(ops: CloudWriteOp[]): Promise<void> {
    await this.waitGate();
    if (this.failCommits) throw new Error(this.failCommits);
    const staged = new Map(this.docs);
    for (const op of ops) {
      if (op.type === 'delete') {
        staged.delete(op.path);
        continue;
      }
      // Mirror the Firestore SDK: undefined, nested arrays and unsupported values are rejected.
      assertFirestoreValue(op.data);
      const next = op.merge ? { ...(staged.get(op.path) || {}), ...op.data } : { ...op.data };
      const size = utf8ByteLength(JSON.stringify(next));
      if (size > FIRESTORE_DOCUMENT_LIMIT_BYTES) {
        throw new Error(`INVALID_ARGUMENT: document ${op.path} is ${size} bytes (limit 1 MiB)`);
      }
      staged.set(op.path, structuredClone(next));
    }
    this.docs.clear();
    for (const [k, v] of staged) this.docs.set(k, v);
    this.commits++;
  }

  subscribeCollection(
    path?: string,
    onChange?: (docs: Array<{ id: string; data: CloudData }>) => void,
    onError?: (err: unknown) => void
  ): () => void {
    return () => undefined;
  }

  largestDocumentBytes(): number {
    let max = 0;
    for (const data of this.docs.values()) max = Math.max(max, utf8ByteLength(JSON.stringify(data)));
    return max;
  }
}

export function fakeUser(uid: string): User {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: uid.charAt(0).toUpperCase() + uid.slice(1),
    photoURL: null,
  } as unknown as User;
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
