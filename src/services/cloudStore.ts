/**
 * Minimal document-store surface used for cloud sync. The production implementation wraps
 * Cloud Firestore (firestoreCloudStore.ts); tests use an in-memory implementation.
 */

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

export const cloudPaths = {
  user: (uid: string) => `users/${uid}`,
  documents: (uid: string) => `users/${uid}/documents`,
  document: (uid: string, id: string) => `users/${uid}/documents/${id}`,
  attempts: (uid: string) => `users/${uid}/attempts`,
  attempt: (uid: string, id: string) => `users/${uid}/attempts/${id}`,
  studyState: (uid: string, id: string) => `users/${uid}/studyState/${id}`,
  chunks: (parentPath: string) => `${parentPath}/chunks`,
  chunk: (parentPath: string, index: number) => `${parentPath}/chunks/${index}`,
};

/** Firestore document ids may not contain '/', and must not be '.' or '..'. */
export function isSafeCloudId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 160 && !id.includes('/') && id !== '.' && id !== '..';
}
