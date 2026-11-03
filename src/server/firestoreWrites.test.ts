import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from 'firebase-admin/firestore';
import { assertFirestoreValue } from '../utils/firestoreData';
import { StrictFakeFirestore } from './firestoreTestDouble';
import { createAiPracticeSet, gradeSubmission } from './practiceService';
import { FirestoreQuestionSetStore, newQuestionSetId, questionSetToFirestore, QuestionSetUnavailableError, type StoredQuestionSet } from './questionSetStore';
import { FirestoreDailyQuotaStore, type QuotaFirestore, type QuotaTransaction } from './quotaStore';
import type { ValidatedGeneratedMcq } from '../utils/questionValidation';

const generated: ValidatedGeneratedMcq[] = [
  { topic: 'Kinematics', question: 'Slope of an x–t graph?', options: ['Acceleration', 'Velocity', 'Displacement', 'Jerk'], correctIndex: 1, explanation: 'dx/dt is velocity.', sourcePage: 1, sourceQuote: 'v = dx/dt', difficulty: 'easy' },
  { topic: 'Friction', question: 'Static friction with no applied force?', options: ['μN', 'Zero', 'mg', 'N'], correctIndex: 1, explanation: 'None is needed.', sourcePage: 2, sourceQuote: 'f ≤ μN', difficulty: 'medium' },
];

function diagnosticSet(uid = 'alice'): StoredQuestionSet {
  return createAiPracticeSet({ setId: newQuestionSetId(), uid, mode: 'diagnostic', documentId: 'doc-1', documentTitle: 'Mechanics', questions: generated });
}

/** Real Admin SDK serializer (no network): batch.set() validates exactly as production does. */
const admin = new Firestore({ projectId: 'demo-learnmate-validation' });
after(() => admin.terminate());

/** A QuotaFirestore whose writes go through the real Admin SDK validation before being kept in memory. */
class AdminValidatedFirestore implements QuotaFirestore {
  readonly docs = new Map<string, Record<string, unknown>>();
  collection(path: string) {
    return { doc: (id: string) => `${path}/${id}` };
  }
  async runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T> {
    const staged: Array<[string, Record<string, unknown>]> = [];
    const result = await fn({
      get: async (ref) => {
        const data = this.docs.get(ref as string);
        return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
      },
      set: (ref, data) => {
        admin.batch().set(admin.doc(ref as string), data); // throws on invalid data; never committed
        staged.push([ref as string, structuredClone(data)]);
      },
    });
    for (const [path, data] of staged) this.docs.set(path, data);
    return result;
  }
}

test('the unsanitised production payloads are exactly what the Admin SDK rejects (the bug)', () => {
  const set = diagnosticSet();
  assert.equal(set.targetTopics, undefined);
  assert.equal(set.sessionId, undefined);
  assert.throws(() => admin.batch().set(admin.doc(`questionSets/${set.id}`), { ...set } as unknown as Record<string, unknown>), /undefined/);
  const graded = gradeSubmission(set, {});
  assert.ok(graded.ok);
  if (!graded.ok) return;
  assert.equal(graded.attempt.outcomes[0].chapterId, undefined, 'nested outcome objects carry undefined chapterId');
  assert.throws(() => assertFirestoreValue({ attempt: graded.attempt }), /outcomes\[0\]\.chapterId|undefined/);
});

for (const [name, makeDb] of [
  ['strict test double', () => new StrictFakeFirestore()],
  ['real Admin SDK validation', () => new AdminValidatedFirestore()],
] as const) {
  test(`question sets, submissions and nested outcomes are stored (${name})`, async () => {
    const db = makeDb();
    const store = new FirestoreQuestionSetStore(db);
    const set = diagnosticSet();
    await store.create(set);
    const stored = db.docs.get(`questionSets/${set.id}`)!;
    assert.ok(!('targetTopics' in stored) && !('sessionId' in stored), 'unset optional fields are omitted, not written as undefined');
    assert.ok(stored.expiresAtDate instanceof Date);

    const read = await store.get('alice', set.id);
    assert.equal(read?.questions.length, 2);
    assert.ok(read && !('expiresAtDate' in read));

    const graded = gradeSubmission(read!, { [read!.questions[0].id]: { type: 'mcq', optionId: 'B' } });
    assert.ok(graded.ok);
    if (!graded.ok) return;
    const result = await store.recordSubmission('alice', set.id, { submittedAt: '2026-11-03T10:05:00.000Z', attempt: graded.attempt });
    assert.equal(result?.alreadySubmitted, false);
    const after = await store.get('alice', set.id);
    const attempt = after!.submission!.attempt;
    assert.equal(attempt.outcomes.length, 2);
    assert.equal(attempt.outcomes[0].outcome, 'correct');
    assert.equal(attempt.outcomes[1].outcome, 'unanswered');
    assert.ok(!('chapterId' in attempt.outcomes[0]));
    assert.deepEqual(attempt.outcomes[0].topicIds, []);
    assert.equal(attempt.rawMarks, 4);
    assert.equal((await store.recordSubmission('alice', set.id, { submittedAt: 'later', attempt: graded.attempt }))?.alreadySubmitted, true);
  });

  test(`sets with a session, chapter and target topics keep those values (${name})`, async () => {
    const db = makeDb();
    const store = new FirestoreQuestionSetStore(db);
    const base = createAiPracticeSet({ setId: newQuestionSetId(), uid: 'alice', mode: 'adaptive', documentId: 'doc-1', documentTitle: 'Mechanics', focusTopics: ['Friction'], questions: generated });
    const set: StoredQuestionSet = {
      ...base,
      sessionId: 'sess-doc-doc-1',
      questions: base.questions.map((q) => ({ ...q, chapterId: 'physics.laws-of-motion', topicIds: ['physics.laws-of-motion.friction'] })),
    };
    await store.create(set);
    const read = await store.get('alice', set.id);
    assert.equal(read?.sessionId, 'sess-doc-doc-1');
    assert.deepEqual(read?.targetTopics, ['Friction']);
    assert.equal(read?.questions[0].chapterId, 'physics.laws-of-motion');
  });

  test(`quota counters are written without invalid values (${name})`, async () => {
    const db = makeDb();
    const quota = new FirestoreDailyQuotaStore(db);
    const result = await quota.consume('alice', 2, 10, new Date('2026-11-03T10:00:00Z'));
    assert.equal(result.allowed, true);
    const doc = [...db.docs.values()][0];
    assert.equal(doc.units, 2);
    assert.ok(doc.expireAt instanceof Date);
  });
}

test('required question-set data is never silently dropped: incomplete sets are refused and nothing is written', async () => {
  const db = new StrictFakeFirestore();
  const store = new FirestoreQuestionSetStore(db);
  const missingTitle = { ...diagnosticSet(), documentTitle: undefined } as unknown as StoredQuestionSet;
  await assert.rejects(store.create(missingTitle), (err: Error) => err instanceof QuestionSetUnavailableError && /documentTitle/.test(err.message));
  const base = diagnosticSet();
  const missingExplanation = { ...base, questions: [{ ...base.questions[0], explanation: undefined }] } as unknown as StoredQuestionSet;
  await assert.rejects(store.create(missingExplanation), /explanation/);
  await assert.rejects(store.create({ ...base, questions: [] }), /no questions/);
  assert.equal(db.docs.size, 0);

  const graded = gradeSubmission(base, {});
  assert.ok(graded.ok);
  if (!graded.ok) return;
  const brokenAttempt = { ...graded.attempt, outcomes: undefined } as unknown as typeof graded.attempt;
  assert.throws(() => questionSetToFirestore({ ...base, submission: { submittedAt: 't', attempt: brokenAttempt } }), /outcomes/);
});
