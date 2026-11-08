/**
 * Firestore security rules tests. Run against the local emulator only:
 *   npm run test:rules
 * (uses a demo- project id, so nothing can reach a real Firebase project).
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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

// ---------------------------------------------------------------------------
// Stage D: Firestore Trusted Attempt Security Rules
// ---------------------------------------------------------------------------

function v1AttemptDoc(uid: string, id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    uid,
    documentId: 'doc-1',
    documentTitle: 'Mechanics notes',
    mode: 'diagnostic',
    score: 3,
    totalQuestions: 5,
    percentage: 60,
    completedAt: '2026-11-02T10:00:00.000Z',
    attemptJson: JSON.stringify({ id, score: 3 }),
    storageVersion: 2,
    payloadEncoding: 'inline',
    chunkCount: 0,
    ...overrides,
  };
}

function trustedAttemptDoc(uid: string, id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    uid,
    documentId: 'doc-syllabus-jee',
    documentTitle: 'JEE Practice: Mechanics',
    mode: 'diagnostic',
    score: 4,
    totalQuestions: 5,
    percentage: 80,
    completedAt: '2026-11-03T12:00:00.000Z',
    attemptJson: JSON.stringify({ id, score: 4 }),
    storageVersion: 2,
    payloadEncoding: 'inline',
    chunkCount: 0,
    scoredBy: 'server',
    schemaVersion: 2,
    contextType: 'syllabus',
    examType: 'jee_main',
    syllabusId: 'physics.mechanics',
    ...overrides,
  };
}

function validChunkDoc(uid: string, index: number, data = 'chunk-payload'): Record<string, unknown> {
  return {
    index,
    uid,
    data,
  };
}

test('Stage D - client creation with trusted markers (scoredBy, schemaVersion, contextType) is denied', async () => {
  const db = as('alice');
  const base = v1AttemptDoc('alice', 'att-client-1');

  // Negative control: base valid v1 attempt is accepted
  await allowed(setDoc(doc(db, cloudPaths.attempt('alice', 'att-client-1')), base), 'valid v1 payload must succeed');

  // Trusted marker 1: scoredBy: "server"
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', 'att-client-2')), { ...v1AttemptDoc('alice', 'att-client-2'), scoredBy: 'server' }),
    'creation with scoredBy must be denied'
  );

  // Trusted marker 2: schemaVersion
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', 'att-client-3')), { ...v1AttemptDoc('alice', 'att-client-3'), schemaVersion: 2 }),
    'creation with schemaVersion must be denied'
  );

  // Trusted marker 3: contextType
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', 'att-client-4')), { ...v1AttemptDoc('alice', 'att-client-4'), contextType: 'syllabus' }),
    'creation with contextType must be denied'
  );
});

test('Stage D - client creation using reserved attempt IDs (att-qs_*) is denied', async () => {
  const db = as('alice');
  const reservedId = 'att-qs_practice-123';
  const reservedAttempt = v1AttemptDoc('alice', reservedId);

  // Creation of attempt with reserved prefix is denied even with otherwise valid v1 payload
  await denied(setDoc(doc(db, cloudPaths.attempt('alice', reservedId)), reservedAttempt), 'reserved att-qs_ id must be denied');

  // Control: normal unreserved ID succeeds
  await allowed(
    setDoc(doc(db, cloudPaths.attempt('alice', 'att-normal_practice-123')), v1AttemptDoc('alice', 'att-normal_practice-123')),
    'unreserved ID must succeed'
  );
});

test('Stage D - client cannot update server-written trusted attempts or add trusted markers to existing attempts', async () => {
  const db = as('alice');

  // 1. Seed a server-written trusted attempt (with scoredBy: "server")
  const serverAttemptId = 'att-server-1';
  await seed(cloudPaths.attempt('alice', serverAttemptId), trustedAttemptDoc('alice', serverAttemptId));

  // Client attempts to update the server-written attempt (denied)
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', serverAttemptId)), {
      ...v1AttemptDoc('alice', serverAttemptId),
      score: 5,
      percentage: 100,
    }),
    'updating server-written trusted attempt must be denied'
  );

  // 2. Seed a server-written attempt with reserved ID att-qs_
  const reservedServerId = 'att-qs_server-2';
  await seed(cloudPaths.attempt('alice', reservedServerId), trustedAttemptDoc('alice', reservedServerId));

  // Client attempts to update reserved attempt (denied)
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', reservedServerId)), v1AttemptDoc('alice', reservedServerId)),
    'updating reserved attempt ID must be denied'
  );

  // 3. Normal v1 attempt exists
  const normalId = 'att-normal-update';
  await setDoc(doc(db, cloudPaths.attempt('alice', normalId)), v1AttemptDoc('alice', normalId));

  // Control: legitimate v1 update succeeds
  await allowed(
    setDoc(doc(db, cloudPaths.attempt('alice', normalId)), {
      ...v1AttemptDoc('alice', normalId),
      score: 4,
      percentage: 80,
    }),
    'valid v1 attempt update must succeed'
  );

  // Client attempts to tamper with v1 attempt by adding trusted marker during update (denied)
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', normalId)), {
      ...v1AttemptDoc('alice', normalId),
      scoredBy: 'server',
    }),
    'updating v1 attempt to add scoredBy must be denied'
  );
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', normalId)), {
      ...v1AttemptDoc('alice', normalId),
      schemaVersion: 2,
    }),
    'updating v1 attempt to add schemaVersion must be denied'
  );
  await denied(
    setDoc(doc(db, cloudPaths.attempt('alice', normalId)), {
      ...v1AttemptDoc('alice', normalId),
      contextType: 'syllabus',
    }),
    'updating v1 attempt to add contextType must be denied'
  );
});

test('Stage D - chunk subcollection security: chunks cannot be attached to trusted or reserved attempts', async () => {
  const db = as('alice');

  // 1. Seed a server-written trusted attempt
  const trustedId = 'att-trusted-chunks';
  await seed(cloudPaths.attempt('alice', trustedId), trustedAttemptDoc('alice', trustedId, {
    payloadEncoding: 'chunked',
    chunkCount: 1,
    payloadBytes: 500,
    payloadChecksum: 'test1234',
    attemptJson: '',
  }));

  // Client chunk creation under trusted attempt is denied
  await denied(
    setDoc(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', trustedId), 0)), validChunkDoc('alice', 0)),
    'client chunk creation under trusted attempt must be denied'
  );

  // Seed an existing chunk under trusted attempt, client update of chunk is denied
  await seed(cloudPaths.chunk(cloudPaths.attempt('alice', trustedId), 0), validChunkDoc('alice', 0));
  await denied(
    setDoc(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', trustedId), 0)), validChunkDoc('alice', 0, 'tampered-chunk')),
    'client chunk update under trusted attempt must be denied'
  );

  // 2. Client chunk creation under reserved att-qs_ ID is denied
  const reservedId = 'att-qs_chunk-target';
  await denied(
    setDoc(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', reservedId), 0)), validChunkDoc('alice', 0)),
    'chunk creation under reserved ID must be denied'
  );

  // 3. Client chunk creation with nonexistent parent is denied
  await denied(
    setDoc(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', 'att-nonexistent'), 0)), validChunkDoc('alice', 0)),
    'chunk creation without parent must be denied'
  );

  // 4. Control: legitimate v1 chunk batch commit succeeds
  const v1ChunkedId = 'att-v1-chunked';
  const v1Parent = v1AttemptDoc('alice', v1ChunkedId, {
    payloadEncoding: 'chunked',
    chunkCount: 1,
    payloadBytes: 500,
    payloadChecksum: 'v1chk123',
    attemptJson: '',
  });
  const batch = writeBatch(db);
  batch.set(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', v1ChunkedId), 0)), validChunkDoc('alice', 0));
  batch.set(doc(db, cloudPaths.attempt('alice', v1ChunkedId)), v1Parent);
  await allowed(batch.commit(), 'v1 chunked attempt batch commit must succeed');

  // Control: legitimate chunk update on existing v1 attempt succeeds
  await allowed(
    setDoc(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', v1ChunkedId), 0)), validChunkDoc('alice', 0, 'updated-v1-chunk')),
    'v1 chunk update must succeed'
  );

  // Control: owner can delete chunks
  await allowed(
    deleteDoc(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', v1ChunkedId), 0))),
    'owner chunk delete must succeed'
  );
  await allowed(
    deleteDoc(doc(db, cloudPaths.chunk(cloudPaths.attempt('alice', trustedId), 0))),
    'owner can delete chunk under trusted attempt during reset'
  );
});

test('Stage D - owner can read, list, and delete trusted server attempts', async () => {
  const db = as('alice');
  const trustedId = 'att-qs_syllabus-physics-1';
  await seed(cloudPaths.attempt('alice', trustedId), trustedAttemptDoc('alice', trustedId));

  // Owner can read trusted attempt
  const snapshot = await getDoc(doc(db, cloudPaths.attempt('alice', trustedId)));
  assert.equal(snapshot.exists(), true);
  assert.equal(snapshot.data()?.scoredBy, 'server');

  // Owner can list attempts collection containing trusted attempt
  const listSnap = await getDocs(collection(db, cloudPaths.attempts('alice')));
  assert.equal(listSnap.docs.some((d) => d.id === trustedId), true);

  // Owner can delete trusted attempt (for progress reset)
  await allowed(deleteDoc(doc(db, cloudPaths.attempt('alice', trustedId))), 'owner can delete trusted attempt');
  const afterDelete = await getDoc(doc(db, cloudPaths.attempt('alice', trustedId)));
  assert.equal(afterDelete.exists(), false);
});

test('Stage D - cross-user and unauthenticated attempts isolation', async () => {
  const aliceId = 'att-alice-1';
  const trustedAliceId = 'att-qs_alice-trusted';
  await seed(cloudPaths.attempt('alice', aliceId), v1AttemptDoc('alice', aliceId));
  await seed(cloudPaths.attempt('alice', trustedAliceId), trustedAttemptDoc('alice', trustedAliceId));

  const bob = as('bob');
  const anon = anonymous();

  // Bob cannot read, list, create, update, or delete Alice's attempts
  await denied(getDoc(doc(bob, cloudPaths.attempt('alice', aliceId))), 'Bob cannot read Alice v1 attempt');
  await denied(getDoc(doc(bob, cloudPaths.attempt('alice', trustedAliceId))), 'Bob cannot read Alice trusted attempt');
  await denied(getDocs(collection(bob, cloudPaths.attempts('alice'))), 'Bob cannot list Alice attempts');
  await denied(setDoc(doc(bob, cloudPaths.attempt('alice', 'att-bob-forged')), v1AttemptDoc('bob', 'att-bob-forged')), 'Bob cannot write to Alice');
  await denied(deleteDoc(doc(bob, cloudPaths.attempt('alice', aliceId))), 'Bob cannot delete Alice v1 attempt');
  await denied(deleteDoc(doc(bob, cloudPaths.attempt('alice', trustedAliceId))), 'Bob cannot delete Alice trusted attempt');

  // Bob cannot read, create, update, or delete Alice's attempt chunks
  await denied(getDoc(doc(bob, cloudPaths.chunk(cloudPaths.attempt('alice', aliceId), 0))), 'Bob cannot read Alice chunk');
  await denied(setDoc(doc(bob, cloudPaths.chunk(cloudPaths.attempt('alice', aliceId), 0)), validChunkDoc('bob', 0)), 'Bob cannot write Alice chunk');
  await denied(deleteDoc(doc(bob, cloudPaths.chunk(cloudPaths.attempt('alice', aliceId), 0))), 'Bob cannot delete Alice chunk');

  // Anonymous user cannot read, list, create, update, or delete Alice's attempts or chunks
  await denied(getDoc(doc(anon, cloudPaths.attempt('alice', aliceId))), 'anon cannot read attempt');
  await denied(getDocs(collection(anon, cloudPaths.attempts('alice'))), 'anon cannot list attempts');
  await denied(setDoc(doc(anon, cloudPaths.attempt('alice', 'att-anon')), v1AttemptDoc('alice', 'att-anon')), 'anon cannot write attempt');
  await denied(deleteDoc(doc(anon, cloudPaths.attempt('alice', aliceId))), 'anon cannot delete attempt');
  await denied(setDoc(doc(anon, cloudPaths.chunk(cloudPaths.attempt('alice', aliceId), 0)), validChunkDoc('alice', 0)), 'anon cannot write chunk');
});

// ---------------------------------------------------------------------------
// Roadmap collections (roadmaps, roadmapRevisionQueue, roadmapAttempts)
// ---------------------------------------------------------------------------

function validRoadmapDoc(userId: string, roadmapId: string): Record<string, unknown> {
  return {
    roadmapId,
    uid: userId,
    completionPercentage: 50,
    completedCheckpointsCount: 2,
    currentCheckpointId: 'PHY-01-CP2',
    checkpointsJson: JSON.stringify({}),
    updatedAt: new Date().toISOString(),
  };
}

function validRevisionItemDoc(userId: string, itemId: string): Record<string, unknown> {
  return {
    id: itemId,
    uid: userId,
    topicId: 'physics.kinematics.motion',
    topicName: 'Motion in a Straight Line',
    roadmapId: 'PHY-01',
    checkpointId: 'PHY-01-CP1',
    scheduledForDate: '2026-11-05',
    intervalStep: 1,
    status: 'upcoming',
    consecutiveMasteryCount: 1,
    priority: 'medium',
    reason: 'Initial revision interval step 1',
    updatedAt: new Date().toISOString(),
  };
}

function validRoadmapAttemptDoc(
  userId: string,
  attemptId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: attemptId,
    uid: userId,
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    percentage: 75,
    rawMarks: 3,
    totalMarks: 4,
    correctCount: 3,
    incorrectCount: 1,
    unansweredCount: 0,
    timeTakenSeconds: 320,
    completedAt: new Date().toISOString(),
    attemptJson: JSON.stringify({ answers: [] }),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('roadmap: read and write by owner succeeds; non-owner and anonymous rejected', async () => {
  const alice = as('alice');
  const bob = as('bob');
  const anon = anonymous();
  const pathName = cloudPaths.roadmap('alice', 'PHY-01');

  // Owner write succeeds
  await allowed(setDoc(doc(alice, pathName), validRoadmapDoc('alice', 'PHY-01')), 'owner can write valid roadmap');
  // Owner read succeeds
  await allowed(getDoc(doc(alice, pathName)), 'owner can read own roadmap');

  // Non-owner rejected
  await denied(getDoc(doc(bob, pathName)), 'non-owner cannot read roadmap');
  await denied(setDoc(doc(bob, pathName), validRoadmapDoc('bob', 'PHY-01')), 'non-owner cannot write to another user roadmap path');

  // Anonymous rejected
  await denied(getDoc(doc(anon, pathName)), 'anonymous cannot read roadmap');
  await denied(setDoc(doc(anon, pathName), validRoadmapDoc('alice', 'PHY-01')), 'anonymous cannot write roadmap');
});

test('roadmap: invalid schema is rejected', async () => {
  const alice = as('alice');
  const pathName = cloudPaths.roadmap('alice', 'PHY-01');

  // Percentage > 100
  await denied(
    setDoc(doc(alice, pathName), { ...validRoadmapDoc('alice', 'PHY-01'), completionPercentage: 150 }),
    'percentage > 100 rejected'
  );

  // Percentage < 0
  await denied(
    setDoc(doc(alice, pathName), { ...validRoadmapDoc('alice', 'PHY-01'), completionPercentage: -10 }),
    'negative percentage rejected'
  );

  // completedCheckpointsCount > 4
  await denied(
    setDoc(doc(alice, pathName), { ...validRoadmapDoc('alice', 'PHY-01'), completedCheckpointsCount: 5 }),
    'completedCheckpointsCount > 4 rejected'
  );

  // Missing required field (checkpointsJson)
  const incomplete = { ...validRoadmapDoc('alice', 'PHY-01') };
  delete (incomplete as any).checkpointsJson;
  await denied(setDoc(doc(alice, pathName), incomplete), 'missing required field rejected');
});

test('roadmapRevisionQueue: owner read/write succeeds with valid schema; invalid rejected', async () => {
  const alice = as('alice');
  const bob = as('bob');
  const itemId = 'rev_PHY-01-CP1_0';
  const pathName = cloudPaths.roadmapRevisionItem('alice', itemId);

  // Owner write succeeds
  await allowed(setDoc(doc(alice, pathName), validRevisionItemDoc('alice', itemId)), 'owner can write revision item');
  // Owner read succeeds
  await allowed(getDoc(doc(alice, pathName)), 'owner can read revision item');

  // Non-owner denied
  await denied(getDoc(doc(bob, pathName)), 'non-owner cannot read revision item');

  // Invalid status rejected
  await denied(
    setDoc(doc(alice, pathName), { ...validRevisionItemDoc('alice', itemId), status: 'not_a_real_status' }),
    'invalid status rejected'
  );

  // Invalid priority rejected
  await denied(
    setDoc(doc(alice, pathName), { ...validRevisionItemDoc('alice', itemId), priority: 'critical_emergency' }),
    'invalid priority rejected'
  );

  // intervalStep > 10 rejected
  await denied(
    setDoc(doc(alice, pathName), { ...validRevisionItemDoc('alice', itemId), intervalStep: 15 }),
    'intervalStep > 10 rejected'
  );
});

test('roadmapAttempts: create succeeds for owner; update/delete rejected; invalid score range rejected', async () => {
  const alice = as('alice');
  const bob = as('bob');
  const attemptId = 'att_PHY-01-CP1_1';
  const pathName = cloudPaths.roadmapAttempt('alice', attemptId);

  // Owner create succeeds
  await allowed(setDoc(doc(alice, pathName), validRoadmapAttemptDoc('alice', attemptId)), 'owner can create attempt');

  // Update rejected by rule (allow update, delete: if false)
  await denied(
    setDoc(doc(alice, pathName), validRoadmapAttemptDoc('alice', attemptId, { percentage: 95 })),
    'update must be rejected'
  );

  // Delete rejected by rule
  await denied(deleteDoc(doc(alice, pathName)), 'delete must be rejected');

  // Non-owner cannot create or read
  await denied(getDoc(doc(bob, pathName)), 'non-owner cannot read attempt');
  await denied(
    setDoc(doc(bob, cloudPaths.roadmapAttempt('bob', attemptId)), validRoadmapAttemptDoc('alice', attemptId)),
    'cannot spoof another uid in attempt payload'
  );

  // Invalid percentage > 100 rejected
  const invalidOver = 'att_invalid_over';
  await denied(
    setDoc(doc(alice, cloudPaths.roadmapAttempt('alice', invalidOver)), validRoadmapAttemptDoc('alice', invalidOver, { percentage: 110 })),
    'percentage > 100 rejected'
  );

  // Invalid percentage < 0 rejected
  const invalidUnder = 'att_invalid_under';
  await denied(
    setDoc(doc(alice, cloudPaths.roadmapAttempt('alice', invalidUnder)), validRoadmapAttemptDoc('alice', invalidUnder, { percentage: -5 })),
    'percentage < 0 rejected'
  );
});

// ---------------------------------------------------------------------------
// Server-only verified content approval repository and audit subcollections
// ---------------------------------------------------------------------------

test('verifiedQuestionApprovals: client access (authenticated & anonymous) strictly denied for docs and subcollections', async () => {
  const alice = as('alice');
  const anon = anonymous();

  const activeDocPath = 'verifiedQuestionApprovals/active_PHY-01-Q1';
  const versionDocPath = 'verifiedQuestionApprovals/appr_PHY-01-Q1_1111111111111111';
  const auditEventDocPath = 'verifiedQuestionApprovals/PHY-01-Q1/auditEvents/evt_000001_approved';

  // Seed documents via admin/rules-disabled context
  await seed(activeDocPath, { questionId: 'PHY-01-Q1', docType: 'active_pointer' });
  await seed(versionDocPath, { questionId: 'PHY-01-Q1', docType: 'approval_version' });
  await seed(auditEventDocPath, { questionId: 'PHY-01-Q1', docType: 'audit_event' });

  // 1. Authenticated user operations must all fail
  await denied(getDoc(doc(alice, activeDocPath)), 'alice cannot read active pointer');
  await denied(getDoc(doc(alice, versionDocPath)), 'alice cannot read version doc');
  await denied(getDoc(doc(alice, auditEventDocPath)), 'alice cannot read audit event doc');
  await denied(getDocs(collection(alice, 'verifiedQuestionApprovals')), 'alice cannot list approvals');
  await denied(getDocs(collection(alice, 'verifiedQuestionApprovals/PHY-01-Q1/auditEvents')), 'alice cannot list audit events');
  await denied(setDoc(doc(alice, activeDocPath), { hacked: true }), 'alice cannot write active pointer');
  await denied(setDoc(doc(alice, versionDocPath), { hacked: true }), 'alice cannot write version doc');
  await denied(setDoc(doc(alice, auditEventDocPath), { hacked: true }), 'alice cannot write audit event doc');
  await denied(deleteDoc(doc(alice, activeDocPath)), 'alice cannot delete active pointer');

  // 2. Anonymous user operations must all fail
  await denied(getDoc(doc(anon, activeDocPath)), 'anon cannot read active pointer');
  await denied(getDoc(doc(anon, versionDocPath)), 'anon cannot read version doc');
  await denied(getDoc(doc(anon, auditEventDocPath)), 'anon cannot read audit event doc');
  await denied(getDocs(collection(anon, 'verifiedQuestionApprovals')), 'anon cannot list approvals');
  await denied(getDocs(collection(anon, 'verifiedQuestionApprovals/PHY-01-Q1/auditEvents')), 'anon cannot list audit events');
  await denied(setDoc(doc(anon, activeDocPath), { hacked: true }), 'anon cannot write active pointer');
  await denied(setDoc(doc(anon, versionDocPath), { hacked: true }), 'anon cannot write version doc');
  await denied(setDoc(doc(anon, auditEventDocPath), { hacked: true }), 'anon cannot write audit event doc');
  await denied(deleteDoc(doc(anon, activeDocPath)), 'anon cannot delete active pointer');
});

// ---------------------------------------------------------------------------
// Server-only trusted reviewer registry and authorization audit collections
// ---------------------------------------------------------------------------

test('trustedReviewers: client access (authenticated & anonymous) strictly denied for read, write, create, update, delete, and list', async () => {
  const alice = as('alice');
  const anon = anonymous();
  const reviewerDocPath = 'trustedReviewers/uid-sme-phys-01';

  // Seed via admin/rules-disabled context
  await seed(reviewerDocPath, {
    uid: 'uid-sme-phys-01',
    reviewerId: 'sme-phys-dr-sharma',
    status: 'active',
  });

  // 1. Authenticated user operations must all fail
  await denied(getDoc(doc(alice, reviewerDocPath)), 'alice cannot read reviewer doc');
  await denied(getDocs(collection(alice, 'trustedReviewers')), 'alice cannot list reviewer collection');
  await denied(setDoc(doc(alice, 'trustedReviewers/uid-hacker'), { uid: 'uid-hacker' }), 'alice cannot create reviewer doc');
  await denied(setDoc(doc(alice, reviewerDocPath), { status: 'revoked' }, { merge: true }), 'alice cannot update reviewer doc');
  await denied(deleteDoc(doc(alice, reviewerDocPath)), 'alice cannot delete reviewer doc');

  // 2. Anonymous user operations must all fail
  await denied(getDoc(doc(anon, reviewerDocPath)), 'anon cannot read reviewer doc');
  await denied(getDocs(collection(anon, 'trustedReviewers')), 'anon cannot list reviewer collection');
  await denied(setDoc(doc(anon, 'trustedReviewers/uid-hacker'), { uid: 'uid-hacker' }), 'anon cannot create reviewer doc');
  await denied(setDoc(doc(anon, reviewerDocPath), { status: 'revoked' }, { merge: true }), 'anon cannot update reviewer doc');
  await denied(deleteDoc(doc(anon, reviewerDocPath)), 'anon cannot delete reviewer doc');
});

test('reviewerAuthorizationAudit: client access (authenticated & anonymous) strictly denied for read, write, create, update, delete, and list', async () => {
  const alice = as('alice');
  const anon = anonymous();
  const auditDocPath = 'reviewerAuthorizationAudit/rev_audit_000001';

  // Seed via admin/rules-disabled context
  await seed(auditDocPath, {
    auditId: 'rev_audit_000001',
    decision: 'authorized',
    callerUid: 'uid-sme-phys-01',
  });

  // 1. Authenticated user operations must all fail
  await denied(getDoc(doc(alice, auditDocPath)), 'alice cannot read audit doc');
  await denied(getDocs(collection(alice, 'reviewerAuthorizationAudit')), 'alice cannot list audit collection');
  await denied(setDoc(doc(alice, 'reviewerAuthorizationAudit/rev_audit_fake'), { decision: 'authorized' }), 'alice cannot create audit doc');
  await denied(setDoc(doc(alice, auditDocPath), { tampered: true }, { merge: true }), 'alice cannot update audit doc');
  await denied(deleteDoc(doc(alice, auditDocPath)), 'alice cannot delete audit doc');

  // 2. Anonymous user operations must all fail
  await denied(getDoc(doc(anon, auditDocPath)), 'anon cannot read audit doc');
  await denied(getDocs(collection(anon, 'reviewerAuthorizationAudit')), 'anon cannot list audit collection');
  await denied(setDoc(doc(anon, 'reviewerAuthorizationAudit/rev_audit_fake'), { decision: 'authorized' }), 'anon cannot create audit doc');
  await denied(setDoc(doc(anon, auditDocPath), { tampered: true }, { merge: true }), 'anon cannot update audit doc');
  await denied(deleteDoc(doc(anon, auditDocPath)), 'anon cannot delete audit doc');
});


