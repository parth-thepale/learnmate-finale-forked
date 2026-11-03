import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from 'firebase-admin/firestore';
import { decodeQuizAttempt } from '../services/cloudEntities';
import { cloudPaths } from '../services/cloudStore';
import { FakeCloudStore } from '../services/testDoubles';
import type { SyllabusAttemptContext } from '../types/questionBank';
import { findContentKeys, isVerifiedAttempt, validateTrustedAttempt } from '../utils/attemptContext';
import type { GradedQuizAttempt } from '../utils/attemptV2';
import type { ValidatedGeneratedMcq } from '../utils/questionValidation';
import { StrictFakeFirestore } from './firestoreTestDouble';
import { contextOfSet, createAiPracticeSet, gradeSubmission, PracticeSetContextError } from './practiceService';
import {
  FirestoreQuestionSetStore,
  MemoryQuestionSetStore,
  newQuestionSetId,
  QuestionSetUnavailableError,
  TrustedAttemptRejectedError,
  type StoredQuestionSet,
} from './questionSetStore';
import type { QuotaFirestore, QuotaTransaction } from './quotaStore';

const KIN = 'physics.kinematics';
const KIN_T1 = 'physics.kinematics.straight-line-motion';
const KIN_T2 = 'physics.kinematics.uniformly-accelerated-motion';
const NLM_T1 = 'physics.laws-of-motion.newtons-laws';
const ctx = (o: Partial<SyllabusAttemptContext> = {}): SyllabusAttemptContext => ({
  type: 'syllabus', examType: 'jee_main', syllabusId: 'jee_main_2026', syllabusRevision: 1, subjectId: 'physics', chapterId: KIN, topicIds: [KIN_T1], ...o,
});

const questions: ValidatedGeneratedMcq[] = [1, 2, 3].map((i) => ({
  topic: 'Straight-line motion',
  question: `What is the displacement in scenario number ${i} described above?`,
  options: [`Option one for question ${i}`, `Option two for question ${i}`, `Option three for question ${i}`, `Option four for question ${i}`],
  correctIndex: 1,
  explanation: `Detailed explanation of the reasoning for question ${i}.`,
  sourcePage: 0,
  sourceQuote: '',
  difficulty: 'medium',
}));

const docSet = (uid = 'alice') =>
  createAiPracticeSet({ setId: newQuestionSetId(), uid, mode: 'diagnostic', documentId: 'doc-17300', documentTitle: 'Mechanics notes', questions });
const chapterSet = (uid = 'alice') =>
  createAiPracticeSet({ setId: newQuestionSetId(), uid, mode: 'adaptive', context: ctx(), sessionId: 'sess-abc', questions: questions.map((q) => ({ ...q, topicIds: [KIN_T1] })) });
/** A set whose questions come from the (licensed) bank. */
const bankSet = (uid = 'alice'): StoredQuestionSet => {
  const s = chapterSet(uid);
  return { ...s, questions: s.questions.map((q, i) => ({ ...q, source: i === 0 ? 'pyq' : 'curated' })) };
};

function grade(set: StoredQuestionSet, answer: 'A' | 'B' = 'B'): GradedQuizAttempt {
  const result = gradeSubmission(set, { [set.questions[0].id]: { type: 'mcq', optionId: answer }, [set.questions[1].id]: { type: 'mcq', optionId: 'C' } });
  assert.ok(result.ok, result.ok ? '' : result.error);
  return (result as { ok: true; attempt: GradedQuizAttempt }).attempt;
}
const submission = (attempt: GradedQuizAttempt) => ({ submittedAt: attempt.completedAt, attempt });
const attemptPath = (uid: string, a: GradedQuizAttempt) => cloudPaths.attempt(uid, a.id);

// ---------------------------------------------------------------------------
// Question sets: explicit context and registry marking
// ---------------------------------------------------------------------------

test('sets record an explicit context and a registry marking scheme; no placeholder documents', () => {
  const d = docSet();
  assert.deepEqual(d.context, { type: 'document', documentId: 'doc-17300', documentTitle: 'Mechanics notes' });
  assert.equal(d.markingSchemeId, 'jee_main_2026');
  const c = chapterSet();
  assert.equal(c.documentId, '');
  assert.equal(c.documentTitle, 'Physics · Kinematics');
  assert.equal(c.markingSchemeId, 'jee_main_2026', 'from markingSchemeForExam(jee_main)');
  assert.equal(c.sessionId, 'sess-abc');
  assert.deepEqual(c.questions.map((q) => [q.chapterId, q.topicIds]), [[KIN, [KIN_T1]], [KIN, [KIN_T1]], [KIN, [KIN_T1]]]);

  const make = (extra: Record<string, unknown>) => () => createAiPracticeSet({ setId: newQuestionSetId(), uid: 'alice', mode: 'diagnostic', questions, ...extra });
  assert.throws(make({}), PracticeSetContextError, 'no documentId');
  assert.throws(make({ documentId: '' }), PracticeSetContextError);
  assert.throws(make({ documentId: 'unknown' }), /not a document id/);
  assert.throws(make({ documentId: 'doc-1', markingSchemeId: 'custom' }), /marking scheme/);
  assert.throws(make({ context: ctx({ examType: 'neet_ug' }) }), PracticeSetContextError);
  assert.throws(make({ context: ctx() }), /no syllabus topic/, 'every syllabus question needs a topic');
  assert.throws(make({ context: ctx(), questions: questions.map((q) => ({ ...q, topicIds: [KIN_T2] })) }), /not part of this practice/, 'not a selected topic');
  assert.throws(make({ context: ctx({ topicIds: [] }), questions: questions.map((q) => ({ ...q, topicIds: [NLM_T1] })) }), /not part of this practice/, 'outside the chapter');
  assert.throws(make({ documentId: 'doc-1', sessionId: 'a/b' }), /session/);
  assert.doesNotThrow(make({ context: ctx({ topicIds: [] }), questions: questions.map((q) => ({ ...q, topicIds: [KIN_T2] })) }), 'whole-chapter practice');
});

test('grading uses the set’s registered scheme and fills context, marking and review mode', () => {
  const d = grade(docSet());
  assert.deepEqual(d.context, { type: 'document', documentId: 'doc-17300', documentTitle: 'Mechanics notes' });
  assert.deepEqual(d.marking, { id: 'jee_main_2026', correct: 4, incorrect: -1, unanswered: 0 });
  assert.equal(d.reviewMode, 'embedded');
  assert.equal(d.rawMarks, 4 - 1);
  assert.deepEqual(validateTrustedAttempt(d), []);

  const plain = grade({ ...docSet(), markingSchemeId: 'practice_plain' });
  assert.equal(plain.rawMarks, 1);
  assert.equal(plain.maxMarks, 3);
  assert.equal(plain.negativeMarkingUsed, false);

  const c = grade(chapterSet());
  assert.equal(c.documentId, '');
  assert.equal(c.context?.type, 'syllabus');
  assert.equal(c.sessionId, 'sess-abc');
  assert.deepEqual(c.outcomes.map((o) => [o.subjectId, o.chapterId, o.topicIds]), Array(3).fill(['physics', KIN, [KIN_T1]]));
});

test('legacy sets: document-linked only with a real documentId; placeholders and unknown schemes are refused', () => {
  const legacy = { ...docSet() } as StoredQuestionSet;
  delete legacy.context;
  delete legacy.markingSchemeId;
  assert.deepEqual(contextOfSet(legacy), { type: 'document', documentId: 'doc-17300', documentTitle: 'Mechanics notes' });
  assert.equal(grade(legacy).markingSchemeId, 'jee_main_2026', 'older sets were graded with jee_main_2026');
  for (const documentId of ['unknown', '', 'a/b']) {
    const r = gradeSubmission({ ...legacy, documentId }, {});
    assert.deepEqual(r.ok ? null : [r.status], [409], documentId);
  }
  const r = gradeSubmission({ ...docSet(), markingSchemeId: 'retired_scheme' }, {});
  assert.deepEqual(r.ok ? null : [r.status], [409]);
  const badContext = gradeSubmission({ ...docSet(), context: ctx({ chapterId: 'physics.nope' }) }, {});
  assert.deepEqual(badContext.ok ? null : [badContext.status], [409]);
});

test('bank and PYQ attempts are by reference: no question text, options, explanations or keys anywhere', () => {
  const set = bankSet();
  const attempt = grade(set);
  assert.equal(attempt.reviewMode, 'by_reference');
  assert.deepEqual(attempt.questions, []);
  assert.deepEqual(findContentKeys({ ...attempt, questions: [] }), []);
  const json = JSON.stringify(attempt);
  for (const q of set.questions) {
    for (const text of [q.stem, q.explanation, ...q.options.map((o) => o.text)]) assert.ok(!json.includes(text), `leaked: ${text}`);
  }
  assert.deepEqual(validateTrustedAttempt(attempt), []);
});

// ---------------------------------------------------------------------------
// Atomic submission + trusted attempt persistence
// ---------------------------------------------------------------------------

/** Real Admin SDK serializer (no network): validates every transaction write like production. */
const admin = new Firestore({ projectId: 'demo-learnmate-validation' });
after(() => admin.terminate());

class AdminValidatedFirestore extends StrictFakeFirestore {
  override runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T> {
    return super.runTransaction((tx) =>
      fn({
        get: (ref) => tx.get(ref),
        set: (ref, data) => {
          admin.batch().set(admin.doc(ref as string), data); // throws on invalid data; never committed
          return tx.set(ref, data);
        },
        delete: (ref) => {
          admin.batch().delete(admin.doc(ref as string));
          return tx.delete!(ref);
        },
      })
    );
  }
}

for (const [name, makeDb] of [
  ['strict fake', () => new StrictFakeFirestore()],
  ['real Admin SDK validation', () => new AdminValidatedFirestore()],
] as const) {
  test(`submission and trusted attempt are written in one transaction, readable by existing clients (${name})`, async () => {
    const db = makeDb();
    const store = new FirestoreQuestionSetStore(db as unknown as QuotaFirestore);
    for (const set of [docSet(), chapterSet(), bankSet()]) {
      await store.create(set);
      const attempt = grade(set);
      const commitsBefore = db.commits;
      const result = await store.recordSubmission('alice', set.id, submission(attempt));
      assert.equal(result?.alreadySubmitted, false);
      assert.equal(db.commits, commitsBefore + 1, 'one transaction');

      const parent = db.docs.get(attemptPath('alice', attempt))!;
      assert.equal(parent.scoredBy, 'server');
      assert.equal(parent.schemaVersion, 2);
      assert.equal(parent.contextType, attempt.context!.type);
      assert.equal(parent.questionSetId, set.id);
      assert.equal(parent.rawMarks, attempt.rawMarks);
      assert.equal(parent.documentId, set.documentId);
      if (attempt.context!.type === 'syllabus') {
        assert.deepEqual([parent.syllabusId, parent.syllabusRevision, parent.subjectId, parent.chapterId], ['jee_main_2026', 1, 'physics', KIN]);
      }
      // Existing clients decode the same record through the existing attempt format.
      const cloud = new FakeCloudStore();
      for (const [path, data] of db.docs) cloud.docs.set(path, data);
      assert.deepEqual(await decodeQuizAttempt(cloud, 'alice', parent), JSON.parse(JSON.stringify(attempt)));
      const stored = await store.get('alice', set.id);
      assert.ok(isVerifiedAttempt(attempt, { source: 'question_set_submission', set: stored! }));
    }
  });

  test(`resubmission and concurrent duplicates keep the first stored result (${name})`, async () => {
    const db = makeDb();
    const store = new FirestoreQuestionSetStore(db as unknown as QuotaFirestore);
    const set = docSet();
    await store.create(set);
    const first = grade(set, 'B');
    const other = grade(set, 'A');
    const [r1, r2] = await Promise.all([
      store.recordSubmission('alice', set.id, submission(first)),
      store.recordSubmission('alice', set.id, submission(other)),
    ]);
    assert.deepEqual([r1?.alreadySubmitted, r2?.alreadySubmitted].sort(), [false, true]);
    assert.deepEqual(r1?.submission.attempt, r2?.submission.attempt, 'both callers get the same stored result');
    const winner = r1!.submission.attempt;
    const commits = db.commits;
    const again = await store.recordSubmission('alice', set.id, submission(winner.rawMarks === first.rawMarks ? other : first));
    assert.equal(again?.alreadySubmitted, true);
    assert.deepEqual(again?.submission.attempt, winner);
    assert.equal(db.commits, commits, 'resubmission writes nothing');
    assert.equal(db.docs.get(attemptPath('alice', winner))?.rawMarks, winner.rawMarks, 'the attempt record is not overwritten');
  });
}

test('ownership, expiry and validation failures write nothing', async () => {
  const db = new StrictFakeFirestore();
  const store = new FirestoreQuestionSetStore(db);
  const set = docSet();
  await store.create(set);
  const attempt = grade(set);
  const snapshot = () => JSON.stringify([...db.docs.entries()]);
  const before = snapshot();

  assert.equal(await store.recordSubmission('bob', set.id, submission(attempt)), null, 'another user');
  const expired = { ...docSet(), expiresAt: '2020-01-01T00:00:00.000Z' };
  await store.create(expired);
  const afterExpiredCreate = snapshot();
  assert.equal(await store.recordSubmission('alice', expired.id, submission(grade({ ...expired, expiresAt: set.expiresAt }))), null, 'expired');
  assert.equal(snapshot(), afterExpiredCreate);

  const rejected: Array<[string, GradedQuizAttempt, RegExp]> = [
    ['inflated score', { ...attempt, score: 3, percentage: 100 }, /score/],
    ['inflated marks', { ...attempt, rawMarks: 12 }, /rawMarks/],
    ['other set', grade(docSet()), /does not belong/],
    ['client scored', { ...attempt, scoredBy: 'client' as never }, /scoredBy/],
    ['context swapped', { ...attempt, context: { type: 'document', documentId: 'doc-other', documentTitle: 'x' }, documentId: 'doc-other' }, /context differs|documentId differs/],
    ['marking swapped', { ...attempt, markingSchemeId: 'practice_plain', marking: { id: 'practice_plain', correct: 1, incorrect: 0, unanswered: 0 }, rawMarks: 1, maxMarks: 3, negativeMarkingUsed: false }, /marking differs/],
    ['questions removed', { ...attempt, outcomes: attempt.outcomes.slice(0, 2), answers: attempt.answers.slice(0, 2), questions: attempt.questions.slice(0, 2), totalQuestions: 2, score: 1, percentage: 50, unansweredCount: 0, maxMarks: 8 }, /differ from the stored set/],
  ];
  for (const [label, bad, pattern] of rejected) {
    await assert.rejects(store.recordSubmission('alice', set.id, submission(bad)), (err: unknown) => err instanceof TrustedAttemptRejectedError && pattern.test(err.message), label);
  }
  await assert.rejects(store.recordSubmission('alice', set.id, { submittedAt: 'later', attempt }), TrustedAttemptRejectedError);
  assert.equal(snapshot(), afterExpiredCreate, 'nothing was written by any rejected submission');
  assert.equal((await store.get('alice', set.id))?.submission, undefined);
  assert.notEqual(before, afterExpiredCreate);

  // A by-reference attempt carrying the set's question text is refused even if well-formed otherwise.
  const bank = bankSet();
  await store.create(bank);
  const leaky = { ...grade(bank), weakTopics: [bank.questions[0].stem] };
  await assert.rejects(store.recordSubmission('alice', bank.id, submission(leaky)), /question content/);
});

test('stale chunks of an existing record are removed; a failed transaction commits nothing and can be retried', async () => {
  const db = new StrictFakeFirestore();
  const store = new FirestoreQuestionSetStore(db);
  const set = docSet();
  await store.create(set);
  const attempt = grade(set);
  const path = attemptPath('alice', attempt);
  // e.g. a copy an older client uploaded for this id, split into chunks.
  db.docs.set(path, { id: attempt.id, uid: 'alice', chunkCount: 2, payloadEncoding: 'chunked', storageVersion: 2 });
  db.docs.set(`${path}/chunks/0`, { index: 0, uid: 'alice', data: 'x' });
  db.docs.set(`${path}/chunks/1`, { index: 1, uid: 'alice', data: 'y' });

  db.failNext = 'ABORTED: contention';
  await assert.rejects(store.recordSubmission('alice', set.id, submission(attempt)), QuestionSetUnavailableError);
  assert.equal((await store.get('alice', set.id))?.submission, undefined);
  assert.equal(db.docs.get(path)?.scoredBy, undefined, 'nothing written by the failed transaction');

  const ok = await store.recordSubmission('alice', set.id, submission(attempt));
  assert.equal(ok?.alreadySubmitted, false);
  assert.equal(db.docs.get(path)?.scoredBy, 'server');
  assert.equal(db.docs.get(path)?.payloadEncoding, 'inline');
  assert.ok(!db.docs.has(`${path}/chunks/0`) && !db.docs.has(`${path}/chunks/1`), 'stale chunks removed in the same transaction');
});

test('the in-memory store applies the same checks and records the same trusted record', async () => {
  const store = new MemoryQuestionSetStore();
  const set = chapterSet();
  await store.create(set);
  const attempt = grade(set);
  await assert.rejects(store.recordSubmission('alice', set.id, submission({ ...attempt, rawMarks: 12 })), TrustedAttemptRejectedError);
  assert.equal(store.attemptRecords.size, 0);
  assert.equal((await store.recordSubmission('alice', set.id, submission(attempt)))?.alreadySubmitted, false);
  assert.equal(store.attemptRecords.get(attemptPath('alice', attempt))?.scoredBy, 'server');
  assert.equal((await store.recordSubmission('alice', set.id, submission(grade(set, 'A'))))?.submission.attempt.rawMarks, attempt.rawMarks);
});
