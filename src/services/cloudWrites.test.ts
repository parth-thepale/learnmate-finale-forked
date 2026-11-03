import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, initializeApp } from 'firebase/app';
import { doc, getFirestore, terminate, writeBatch } from 'firebase/firestore';
import { buildGradedAttempt } from '../utils/attemptV2';
import { encodeQuizAttempt, encodeStudyDocument } from './cloudEntities';
import { withFirestoreSafeWrites, type CloudDocStore, type CloudWriteOp } from './cloudStore';
import { HybridCloudStudyRepository } from './storageService';
import { FakeCloudStore, fakeUser, MemoryStorage } from './testDoubles';
import type { StudyDocument } from '../types/study';

/** Real client SDK serializer (no network): writeBatch().set() validates like production. */
const app = initializeApp({ projectId: 'demo-learnmate-validation', apiKey: 'demo-key' }, 'cloud-writes-test');
const db = getFirestore(app);
after(async () => {
  await terminate(db);
  await deleteApp(app);
});

class ClientSdkValidatedStore extends FakeCloudStore {
  override async commit(ops: CloudWriteOp[]): Promise<void> {
    const batch = writeBatch(db);
    for (const op of ops) if (op.type === 'set') batch.set(doc(db, op.path), op.data); // throws on invalid data; never committed
    return super.commit(ops);
  }
}

function makeDoc(overrides: Partial<StudyDocument> = {}): StudyDocument {
  return {
    id: 'doc-1',
    title: 'Mechanics notes',
    sourceType: 'text',
    pageCount: 1,
    pages: [{ pageNumber: 1, title: 'Page 1', content: 'v = u + at' }],
    topics: [],
    overview: 'Overview',
    createdAt: '2026-11-01T00:00:00.000Z',
    lastStudiedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function gradedAttempt() {
  return buildGradedAttempt({
    attemptId: 'att-1',
    questionSetId: 'qs_1',
    kind: 'ai_practice',
    mode: 'diagnostic',
    documentId: 'doc-1',
    documentTitle: 'Mechanics notes',
    sources: ['ai'],
    context: { type: 'document', documentId: 'doc-1', documentTitle: 'Mechanics notes' },
    marking: { id: 'jee_main_2026', correct: 4, incorrect: -1, unanswered: 0 },
    reviewMode: 'embedded',
    reviewQuestions: [
      { id: 'q1', question: 'Q', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e', topic: 'Kinematics', sourcePage: 1, sourceQuote: 'x', difficulty: 'easy' },
    ] as never,
    selectedIndices: { q1: 1 },
    score: {
      scheme: { id: 'jee-main-2026', correct: 4, incorrect: -1, unanswered: 0 },
      rawMarks: 4,
      maxMarks: 4,
      correct: 1,
      incorrect: 0,
      unanswered: 0,
      dropped: 0,
      questions: [{ questionId: 'q1', outcome: 'correct', marks: 4, topicIds: [], topicLabel: 'Kinematics' }],
    } as never,
    completedAt: '2026-11-03T10:00:00.000Z',
  });
}

test('a graded v2 attempt with unset sessionId/targetTopics/chapterId syncs through the real client SDK checks', async () => {
  const attempt = gradedAttempt();
  assert.equal(attempt.sessionId, undefined);
  const cloud = new ClientSdkValidatedStore();
  const repo = new HybridCloudStudyRepository({ storage: new MemoryStorage() });
  repo.attachCloudStore(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveQuizAttempt(attempt);
  await repo.flushPendingWrites();
  const stored = cloud.docs.get('users/alice/attempts/att-1');
  assert.ok(stored, 'attempt reached the cloud');
  const restored = JSON.parse(String(stored.attemptJson));
  assert.equal(restored.outcomes[0].outcome, 'correct');
  assert.equal(restored.schemaVersion, 2);
});

test('legacy documents without timestamps still satisfy the rules-required fields; null stays null', async () => {
  const ops = encodeStudyDocument('alice', makeDoc({ createdAt: undefined as unknown as string, lastStudiedAt: undefined as unknown as string }));
  const parent = ops.find((o) => o.type === 'set' && o.path === 'users/alice/documents/doc-1');
  assert.ok(parent && parent.type === 'set');
  assert.equal(parent.data.createdAt, '1970-01-01T00:00:00.000Z');
  assert.equal(parent.data.lastStudiedAt, '1970-01-01T00:00:00.000Z');
  const onlyCreated = encodeStudyDocument('alice', makeDoc({ lastStudiedAt: undefined as unknown as string }));
  assert.equal((onlyCreated.find((o) => o.path === 'users/alice/documents/doc-1') as { data: Record<string, unknown> }).data.lastStudiedAt, '2026-11-01T00:00:00.000Z');

  const cloud = new ClientSdkValidatedStore();
  const repo = new HybridCloudStudyRepository({ storage: new MemoryStorage() });
  repo.attachCloudStore(cloud);
  await repo.syncWithCloudUser(fakeUser('alice'));
  repo.saveDocument(makeDoc());
  await repo.flushPendingWrites();
  assert.ok(cloud.docs.has('users/alice/documents/doc-1'));

  await withFirestoreSafeWrites(cloud).commit([
    { type: 'set', path: 'users/alice', merge: true, data: { uid: 'alice', updatedAt: 't', activeSessionId: null, unset: undefined } },
  ]);
  assert.equal(cloud.docs.get('users/alice')?.activeSessionId, null, 'intentional null is preserved');
  assert.ok(!('unset' in (cloud.docs.get('users/alice') ?? {})));
});

test('attempts missing rules-required fields are refused instead of written partially', () => {
  const attempt = { ...gradedAttempt(), completedAt: undefined } as unknown as ReturnType<typeof gradedAttempt>;
  assert.throws(() => encodeQuizAttempt('alice', attempt), /completedAt/);
});

test('the safe-write wrapper omits undefined fields and passes deletes through unchanged', async () => {
  const seen: CloudWriteOp[][] = [];
  const inner: CloudDocStore = {
    getDoc: async () => null,
    listCollection: async () => [],
    subscribeCollection: () => () => undefined,
    commit: async (ops) => {
      seen.push(ops);
    },
  };
  await withFirestoreSafeWrites(inner).commit([
    { type: 'set', path: 'users/alice/sessions/s1', data: { id: 's1', chapterId: undefined, topicIds: [], note: null } },
    { type: 'delete', path: 'users/alice/sessions/s0' },
  ]);
  assert.deepEqual(seen[0], [
    { type: 'set', path: 'users/alice/sessions/s1', data: { id: 's1', topicIds: [], note: null } },
    { type: 'delete', path: 'users/alice/sessions/s0' },
  ]);
  await assert.rejects(withFirestoreSafeWrites(inner).commit([{ type: 'set', path: 'p/x', data: { list: [undefined] } }]), /p\/x/);
});
