import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { CloudData, CloudDocStore, CloudWriteOp } from './cloudStore';

/** Cloud Firestore implementation of the sync document store. */
export function createFirestoreCloudStore(db: Firestore): CloudDocStore {
  return {
    async getDoc(path) {
      const snap = await getDoc(doc(db, path));
      return snap.exists() ? (snap.data() as CloudData) : null;
    },

    async listCollection(path) {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as CloudData }));
    },

    async commit(ops: CloudWriteOp[]) {
      if (ops.length === 0) return;
      if (ops.length > 450) throw new Error('Too many operations for one atomic cloud write.');
      const batch = writeBatch(db);
      for (const op of ops) {
        const ref = doc(db, op.path);
        if (op.type === 'delete') batch.delete(ref);
        else if (op.merge) batch.set(ref, op.data, { merge: true });
        else batch.set(ref, op.data);
      }
      await batch.commit();
    },

    subscribeCollection(path, onChange, onError) {
      return onSnapshot(
        collection(db, path),
        (snap) => onChange(snap.docs.map((d) => ({ id: d.id, data: d.data() as CloudData }))),
        onError
      );
    },
  };
}
