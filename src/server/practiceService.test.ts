import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectMistakeInputs,
  createAiPracticeSet,
  gradeSubmission,
  toPublicPracticeQuestion,
} from './practiceService';
import {
  FirestoreQuestionSetStore,
  MemoryQuestionSetStore,
  newQuestionSetId,
  QuestionSetUnavailableError,
  UnavailableQuestionSetStore,
} from './questionSetStore';
import type { QuotaFirestore, QuotaTransaction } from './quotaStore';
import type { ValidatedGeneratedMcq } from '../utils/questionValidation';

const generated: ValidatedGeneratedMcq[] = [
  {
    topic: 'Kinematics',
    question: 'Which graph is a straight line for uniform acceleration from rest?',
    options: ['v–t', 'x–t', 'a–x', 'x–v'],
    correctIndex: 0,
    explanation: 'Velocity grows linearly with time: v = at.',
    sourcePage: 2,
    sourceQuote: 'v = u + at',
    difficulty: 'easy',
  },
  {
    topic: 'Kinematics',
    question: 'What is the slope of a position–time graph?',
    options: ['Acceleration', 'Velocity', 'Displacement', 'Jerk'],
    correctIndex: 1,
    explanation: 'The slope dx/dt is velocity.',
    sourcePage: 1,
    sourceQuote: 'v = dx/dt',
    difficulty: 'easy',
  },
  {
    topic: 'Friction',
    question: 'Static friction on a block at rest on a level floor with no applied force is:',
    options: ['μN', 'Zero', 'mg', 'N'],
    correctIndex: 1,
    explanation: 'With no applied force, no friction is needed.',
    sourcePage: 3,
    sourceQuote: 'f ≤ μN',
    difficulty: 'medium',
  },
];

function makeSet(uid = 'alice', now = new Date('2026-11-03T10:00:00Z')) {
  return createAiPracticeSet({
    setId: newQuestionSetId(),
    uid,
    mode: 'diagnostic',
    documentId: 'doc-1',
    documentTitle: 'Mechanics notes',
    questions: generated,
    now,
  });
}

test('public practice questions never contain answer keys, explanations or quotes', () => {
  const set = makeSet();
  const publicJson = JSON.stringify(set.questions.map(toPublicPracticeQuestion));
  for (const secret of ['correctOptionId', 'correctIndex', 'explanation', 'sourceQuote', 'v = u + at', 'Velocity grows']) {
    assert.ok(!publicJson.includes(secret), `leaked ${secret}`);
  }
  assert.equal(JSON.parse(publicJson)[0].options.length, 4);
  assert.equal(JSON.parse(publicJson)[0].source, 'ai');
});

test('grading uses the server-held keys and JEE marking; client-claimed correctness is impossible', () => {
  const set = makeSet();
  const [q1, q2, q3] = set.questions;
  const result = gradeSubmission(set, {
    [q1.id]: { type: 'mcq', optionId: 'A' }, // correct
    [q2.id]: { type: 'mcq', optionId: 'A' }, // wrong (key is B)
    // q3 unanswered
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const a = result.attempt;
  assert.equal(a.score, 1);
  assert.equal(a.rawMarks, 3);
  assert.equal(a.maxMarks, 12);
  assert.equal(a.unansweredCount, 1);
  assert.equal(a.questions[1].correctIndex, 1, 'answers revealed only in the graded attempt');
  assert.equal(a.answers.find((x) => x.questionId === q3.id)?.selectedIndex, -1);
  assert.equal(a.id, `att-${set.id}`);
});

test('malformed or foreign answers are rejected before grading', () => {
  const set = makeSet();
  assert.equal(gradeSubmission(set, { 'someone-elses-q': { type: 'mcq', optionId: 'A' } }).ok, false);
  assert.equal(gradeSubmission(set, { [set.questions[0].id]: { type: 'mcq', optionId: 'E' } }).ok, false);
  assert.equal(gradeSubmission(set, { [set.questions[0].id]: { type: 'mcq', optionId: 'A', isCorrect: true } }).ok, true);
});

test('mistake inputs come only from the stored submission', async () => {
  const store = new MemoryQuestionSetStore();
  const set = makeSet();
  await store.create(set);
  assert.equal(collectMistakeInputs(set), null, 'nothing to analyse before submission');

  const graded = gradeSubmission(set, {
    [set.questions[0].id]: { type: 'mcq', optionId: 'B' },
    [set.questions[1].id]: { type: 'mcq', optionId: 'B' },
  });
  assert.ok(graded.ok);
  if (!graded.ok) return;
  await store.recordSubmission('alice', set.id, { submittedAt: graded.attempt.completedAt, attempt: graded.attempt });
  const stored = await store.get('alice', set.id);
  const inputs = collectMistakeInputs(stored!);
  assert.ok(inputs);
  assert.deepEqual(inputs!.wrongDetails.map((w) => w.questionId), [set.questions[0].id]);
  assert.equal(inputs!.wrongDetails[0].selectedOption, 'x–t');
  assert.equal(inputs!.wrongDetails[0].correctOption, 'v–t');
  assert.deepEqual(inputs!.unanswered, [{ topic: 'Friction', count: 1 }]);
  assert.equal(inputs!.allCorrect, false);
});

test('question sets are private to their owner, expire, and accept one submission only', async () => {
  const store = new MemoryQuestionSetStore();
  const set = makeSet('alice', new Date());
  await store.create(set);
  assert.ok(await store.get('alice', set.id));
  assert.equal(await store.get('bob', set.id), null, 'other users cannot read the set');
  assert.equal(await store.get('alice', set.id, new Date(Date.now() + 8 * 24 * 3600 * 1000)), null, 'expired');

  const first = gradeSubmission(set, { [set.questions[0].id]: { type: 'mcq', optionId: 'A' } });
  const second = gradeSubmission(set, { [set.questions[0].id]: { type: 'mcq', optionId: 'D' } });
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  const r1 = await store.recordSubmission('alice', set.id, { submittedAt: 't1', attempt: first.attempt });
  const r2 = await store.recordSubmission('alice', set.id, { submittedAt: 't2', attempt: second.attempt });
  assert.equal(r1?.alreadySubmitted, false);
  assert.equal(r2?.alreadySubmitted, true);
  assert.equal(r2?.submission.attempt.score, first.attempt.score, 'resubmission cannot change the result');
  assert.equal(await store.recordSubmission('bob', set.id, { submittedAt: 't3', attempt: second.attempt }), null);
});

test('production without credentials fails closed for practice sets', async () => {
  const store = new UnavailableQuestionSetStore('no credentials');
  await assert.rejects(store.create(makeSet()), QuestionSetUnavailableError);
  await assert.rejects(store.get('alice', 'qs_x'), QuestionSetUnavailableError);
});

class FakeFirestore implements QuotaFirestore {
  docs = new Map<string, Record<string, unknown>>();
  collection(path: string) {
    return { doc: (id: string) => `${path}/${id}` };
  }
  async runTransaction<T>(fn: (tx: QuotaTransaction) => Promise<T>): Promise<T> {
    const writes: Array<[string, Record<string, unknown>]> = [];
    const result = await fn({
      get: async (ref) => {
        const data = this.docs.get(ref as string);
        return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
      },
      set: (ref, data) => {
        writes.push([ref as string, structuredClone(data)]);
      },
    });
    for (const [ref, data] of writes) this.docs.set(ref, data);
    return result;
  }
}

test('Firestore question-set store enforces ownership and single submission', async () => {
  const db = new FakeFirestore();
  const store = new FirestoreQuestionSetStore(db);
  const set = makeSet('alice', new Date());
  await store.create(set);
  await assert.rejects(store.create(set), QuestionSetUnavailableError, 'id collisions are refused');
  assert.ok(db.docs.has(`questionSets/${set.id}`));
  assert.equal((await store.get('alice', set.id))?.questions.length, 3);
  assert.equal(await store.get('bob', set.id), null);
  const graded = gradeSubmission(set, {});
  assert.ok(graded.ok);
  if (!graded.ok) return;
  assert.equal((await store.recordSubmission('alice', set.id, { submittedAt: 't', attempt: graded.attempt }))?.alreadySubmitted, false);
  assert.equal((await store.recordSubmission('alice', set.id, { submittedAt: 't', attempt: graded.attempt }))?.alreadySubmitted, true);
});
