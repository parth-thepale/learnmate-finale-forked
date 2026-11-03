/**
 * Firestore security rules tests. Run against the local emulator only:
 *   npm run test:rules
 * (uses a demo- project id, so nothing can reach a real Firebase project).
 */
import test, { after, before, beforeEach } from 'node:test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { encodeQuizAttempt, encodeStudyDocument, encodeStudyState } from '../src/services/cloudEntities';
import { cloudPaths, type CloudWriteOp } from '../src/services/cloudStore';
import { encodeStudySessionDoc, encodeStudySessionTombstone } from '../src/services/studySessionSync';
import type { StudySession } from '../src/types/questionBank';
import type { QuizAttempt, StudyDocument } from '../src/types/study';
import { toFirestoreData } from '../src/utils/firestoreData';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [host, portText] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let env: RulesTestEnvironment;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-learnmate-rules',
    firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8'), host, port: Number(portText) },
  });
});
beforeEach(async () => env.clearFirestore());
after(async () => env.cleanup());

/** assertFails / assertSucceeds with the case name in the error message. */
async function denied(operation: Promise<unknown>, label = 'operation'): Promise<void> {
  try {
    await assertFails(operation);
  } catch (err) {
    throw new Error(`${label} should have been denied: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function allowed(operation: Promise<unknown>, label = 'operation'): Promise<void> {
  try {
    await assertSucceeds(operation);
  } catch (err) {
    throw new Error(`${label} should have been allowed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const as = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anonymous = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

async function commit(db: Firestore, ops: CloudWriteOp[]): Promise<void> {
  const batch = writeBatch(db);
  for (const op of ops) {
    const ref = doc(db, op.path);
    if (op.type === 'delete') batch.delete(ref);
    else batch.set(ref, toFirestoreData(op.data), op.merge ? { merge: true } : {});
  }
  await batch.commit();
}

/** Seeds data bypassing the rules. */
async function seed(pathName: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, pathName), data);
  });
}

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: 'sess-abc',
    name: 'Kinematics',
    subjectId: 'physics',
    chapterId: 'physics.kinematics',
    topicIds: ['physics.kinematics.motion-in-a-straight-line'],
    resourceIds: ['doc-1'],
    createdAt: '2026-11-01T10:00:00.000Z',
    lastActiveAt: '2026-11-03T10:00:00.000Z',
    updatedAt: '2026-11-03T10:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

const sessionPath = (uid: string, id = 'sess-abc') => cloudPaths.studySession(uid, id);
const live = (uid: string, overrides: Partial<StudySession> = {}) => encodeStudySessionDoc(uid, session(overrides));

// ---------------------------------------------------------------------------
// Study sessions
// ---------------------------------------------------------------------------

test('owners can create, read and list their own sessions; others and anonymous users cannot', async () => {
  await allowed(setDoc(doc(as('alice'), sessionPath('alice')), live('alice')));
  await allowed(getDoc(doc(as('alice'), sessionPath('alice'))));
  await allowed(getDocs(collection(as('alice'), cloudPaths.studySessions('alice'))));
  await denied(getDoc(doc(as('bob'), sessionPath('alice'))));
  await denied(getDocs(collection(as('bob'), cloudPaths.studySessions('alice'))));
  await denied(setDoc(doc(as('bob'), sessionPath('alice', 'sess-bob')), live('alice', { id: 'sess-bob' })));
  await denied(setDoc(doc(as('bob'), sessionPath('alice', 'sess-bob')), live('bob', { id: 'sess-bob' })), 'uid must match the path owner');
  await denied(getDoc(doc(anonymous(), sessionPath('alice'))));
  await denied(setDoc(doc(anonymous(), sessionPath('alice', 'sess-x')), live('alice', { id: 'sess-x' })));
});

test('invalid session payloads are rejected', async () => {
  const db = as('alice');
  const base = live('alice');
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['extra field', { ...base, role: 'admin' }],
    ['missing name', (({ name: _n, ...rest }) => rest)(base)],
    ['empty name', { ...base, name: '' }],
    ['name too long', { ...base, name: 'x'.repeat(121) }],
    ['id mismatch', { ...base, id: 'sess-other' }],
    ['uid mismatch', { ...base, uid: 'bob' }],
    ['unknown subject', { ...base, subjectId: 'biology' }],
    ['chapter id too long', { ...base, chapterId: 'c'.repeat(161) }],
    ['too many topics', { ...base, topicIds: Array.from({ length: 51 }, (_, i) => `t${i}`) }],
    ['too many resources', { ...base, resourceIds: Array.from({ length: 101 }, (_, i) => `d${i}`) }],
    ['topicIds not a list', { ...base, topicIds: 'physics.kinematics' }],
    ['non-ISO timestamp', { ...base, updatedAt: '2026-11-03 10:00' }],
    ['timestamp as number', { ...base, createdAt: 1730000000000 }],
    ['schema version', { ...base, schemaVersion: 2 }],
    ['deleted flag missing', (({ deleted: _d, ...rest }) => rest)(base)],
  ];
  for (const [label, data] of invalid) {
    await denied(setDoc(doc(db, sessionPath('alice')), data), label);
  }
  await denied(setDoc(doc(db, sessionPath('alice', 'x'.repeat(161))), live('alice', { id: 'x'.repeat(161) })), 'id too long');
  await allowed(setDoc(doc(db, sessionPath('alice')), base));
});

test('updates must not move updatedAt backwards or change createdAt', async () => {
  const db = as('alice');
  await seed(sessionPath('alice'), live('alice'));
  await denied(setDoc(doc(db, sessionPath('alice')), live('alice', { name: 'Older', updatedAt: '2026-11-02T10:00:00.000Z' })));
  await denied(setDoc(doc(db, sessionPath('alice')), live('alice', { createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z' })));
  await allowed(setDoc(doc(db, sessionPath('alice')), live('alice', { name: 'Newer', updatedAt: '2026-11-04T10:00:00.000Z' })));
  await allowed(setDoc(doc(db, sessionPath('alice')), live('alice', { name: 'Same instant', updatedAt: '2026-11-04T10:00:00.000Z' })), 'ties are allowed (deterministic client tie-break)');
});

test('deletion is final: tombstones can be written but never updated, overwritten or removed', async () => {
  const db = as('alice');
  await seed(sessionPath('alice'), live('alice'));
  const tombstone = encodeStudySessionTombstone('alice', { id: 'sess-abc', deletedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
  await allowed(setDoc(doc(db, sessionPath('alice')), tombstone), 'a tombstone replaces a live copy whatever its timestamp');
  await denied(setDoc(doc(db, sessionPath('alice')), live('alice', { updatedAt: '2099-01-01T00:00:00.000Z' })), 'no resurrection');
  await denied(setDoc(doc(db, sessionPath('alice')), { ...tombstone, deletedAt: '2026-11-05T00:00:00.000Z' }));
  await denied(deleteDoc(doc(db, sessionPath('alice'))));
  await denied(setDoc(doc(db, sessionPath('alice', 'sess-t')), { ...tombstone, id: 'sess-t', name: 'smuggled' }), 'tombstones carry no content');
  await allowed(setDoc(doc(db, sessionPath('alice', 'sess-t')), { ...tombstone, id: 'sess-t' }), 'tombstones may be created directly');
  await denied(deleteDoc(doc(as('bob'), sessionPath('alice'))));
});

// ---------------------------------------------------------------------------
// Legacy (existing) client payloads keep working; existing protections unchanged
// ---------------------------------------------------------------------------

const legacyDoc: StudyDocument = {
  id: 'doc-1',
  title: 'Mechanics notes',
  sourceType: 'pdf',
  pageCount: 1,
  pages: [{ pageNumber: 1, title: 'Page 1', content: 'v = u + at' }],
  topics: [],
  overview: 'Overview',
  createdAt: '2026-11-01T00:00:00.000Z',
  lastStudiedAt: '2026-11-02T00:00:00.000Z',
};

const legacyAttempt: QuizAttempt = {
  id: 'att-1',
  documentId: 'doc-1',
  documentTitle: 'Mechanics notes',
  mode: 'diagnostic',
  questions: [],
  answers: [],
  score: 3,
  totalQuestions: 5,
  percentage: 60,
  weakTopics: [],
  strongTopics: [],
  completedAt: '2026-11-02T10:00:00.000Z',
};

test('existing client payloads (profile, documents incl. chunked, attempts, study state) are still accepted', async () => {
  const db = as('alice');
  await allowed(
    commit(db, [{ type: 'set', path: cloudPaths.user('alice'), merge: true, data: { uid: 'alice', email: 'a@example.com', displayName: 'A', photoURL: '', updatedAt: '2026-11-03T00:00:00.000Z' } }])
  );
  await allowed(commit(db, [{ type: 'set', path: cloudPaths.user('alice'), merge: true, data: { uid: 'alice', activeDocumentId: 'doc-1', updatedAt: 't' } }]));
  await allowed(commit(db, encodeStudyDocument('alice', legacyDoc)));
  const bigDoc = { ...legacyDoc, id: 'doc-big', pages: Array.from({ length: 3 }, (_, i) => ({ pageNumber: i + 1, title: `P${i}`, content: 'x'.repeat(400_000) })) };
  const chunked = encodeStudyDocument('alice', bigDoc);
  if (!chunked.some((op) => op.path.includes('/chunks/'))) throw new Error('expected a chunked encoding');
  await allowed(commit(db, chunked));
  await allowed(commit(db, encodeQuizAttempt('alice', legacyAttempt)));
  await allowed(commit(db, encodeStudyState('alice', 'doc-1', { tutorMessages: [], mistakes: [], revisionPlan: [], cachedQuiz: null, quickRevise: null }, '2026-11-03T00:00:00.000Z')));
  await allowed(deleteDoc(doc(db, cloudPaths.document('alice', 'doc-1'))));
});

test('existing ownership protections are unchanged', async () => {
  await denied(commit(as('bob'), encodeStudyDocument('alice', legacyDoc)));
  await denied(commit(as('bob'), encodeStudyDocument('bob', legacyDoc).map((op) => ({ ...op, path: op.path.replace('users/bob', 'users/alice') }))));
  await denied(commit(as('alice'), encodeQuizAttempt('alice', { ...legacyAttempt, documentId: '' })));
  await denied(getDoc(doc(as('bob'), cloudPaths.user('alice'))));
  await denied(getDoc(doc(as('alice'), 'questionSets/qs_1')));
  await denied(setDoc(doc(as('alice'), 'questionSets/qs_1'), { uid: 'alice' }));
  await denied(getDoc(doc(as('alice'), 'aiUsageDaily/alice_2026-11-03')));
  await denied(setDoc(doc(as('alice'), 'aiUsageDaily/alice_2026-11-03'), { units: 0 }));
  await denied(setDoc(doc(as('alice'), 'somethingElse/x'), { a: 1 }), 'unknown collections stay denied');
});
