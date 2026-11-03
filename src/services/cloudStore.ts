/**
 * Minimal document-store surface used for cloud sync. The production implementation wraps
 * Cloud Firestore (firestoreCloudStore.ts); tests use an in-memory implementation.
 */

import { toFirestoreData } from '../utils/firestoreData';

export type CloudData = Record<string, unknown>;

export type CloudWriteOp =
  | { type: 'set'; path: string; data: CloudData; merge?: boolean }
  | { type: 'delete'; path: string };

export interface CloudDocStore {
  getDoc(path: string): Promise<CloudData | null>;
  listCollection(path: string): Promise<Array<{ id: string; data: CloudData }>>;
  /** Applies all operations atomically. */
  commit(ops: CloudWriteOp[]): Promise<void>;
  subscribeCollection(
    path: string,
    onChange: (docs: Array<{ id: string; data: CloudData }>) => void,
    onError: (err: unknown) => void
  ): () => void;
}

/**
 * Wraps a store so every write is Firestore-safe: optional fields left undefined are omitted
 * (both Firestore SDKs reject undefined), null is kept, and unrepresentable values fail the write
 * with a clear error instead of being altered. Reads and deletes pass through unchanged.
 */
export function withFirestoreSafeWrites(store: CloudDocStore): CloudDocStore {
  return {
    getDoc: (path) => store.getDoc(path),
    listCollection: (path) => store.listCollection(path),
    subscribeCollection: (path, onChange, onError) => store.subscribeCollection(path, onChange, onError),
    // async so preparation errors reject (and are tracked as failed writes) instead of throwing.
    commit: async (ops) =>
      store.commit(ops.map((op) => (op.type === 'set' ? { ...op, data: toFirestoreData(op.data, { label: op.path }) } : op))),
  };
}

export const cloudPaths = {
  user: (uid: string) => `users/${uid}`,
  documents: (uid: string) => `users/${uid}/documents`,
  document: (uid: string, id: string) => `users/${uid}/documents/${id}`,
  attempts: (uid: string) => `users/${uid}/attempts`,
  attempt: (uid: string, id: string) => `users/${uid}/attempts/${id}`,
  studyState: (uid: string, id: string) => `users/${uid}/studyState/${id}`,
  studySessions: (uid: string) => `users/${uid}/studySessions`,
  studySession: (uid: string, id: string) => `users/${uid}/studySessions/${id}`,
  chunks: (parentPath: string) => `${parentPath}/chunks`,
  chunk: (parentPath: string, index: number) => `${parentPath}/chunks/${index}`,
};

/** Firestore document ids may not contain '/', and must not be '.' or '..'. */
export function isSafeCloudId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 160 && !id.includes('/') && id !== '.' && id !== '..';
}
