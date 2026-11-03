import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiAccessControl, jsonBodyErrorHandler, MEDIA_BODY_PATHS } from './apiAccessControl.ts';
import type { IdTokenVerifier } from './authMiddleware.ts';
import { StrictFakeFirestore } from './firestoreTestDouble.ts';
import { registerPracticeRoutes, type QuizGenerator } from './practiceRoutes.ts';
import { createAiPracticeSet } from './practiceService.ts';
import {
  FirestoreQuestionSetStore,
  newQuestionSetId,
  type QuestionSetStore,
  type StoredQuestionSet,
  type StoredSubmission,
} from './questionSetStore.ts';
import { MemoryDailyQuotaStore } from './quotaStore.ts';
import { FixedWindowRateLimiter } from './rateLimiter.ts';
import { REQUEST_LIMITS } from './requestValidation.ts';
import { withTestServer } from './testHttp.ts';
import { cloudPaths } from '../services/cloudStore.ts';
import { validateTrustedAttempt } from '../utils/attemptContext.ts';
import type { ValidatedGeneratedMcq } from '../utils/questionValidation.ts';

/**
 * HTTP integration tests: real Express routes from practiceRoutes.ts behind the real access-control
 * middleware (auth, payload validation, rate limits, AI quota), with a strict Firestore fake for
 * the question-set store. Only the AI generator is replaced.
 */

const verifier: IdTokenVerifier = async (token) => {
  if (token.startsWith('uid:')) return { uid: token.slice(4), signInProvider: 'google.com' };
  throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
};

const generatedQuestions: ValidatedGeneratedMcq[] = Array.from({ length: 6 }, (_, i) => ({
  topic: 'Kinematics',
  question: `Which statement about uniformly accelerated motion number ${i + 1} is correct?`,
  options: [`First option ${i}`, `Second option ${i}`, `Third option ${i}`, `Fourth option ${i}`],
  correctIndex: 1,
  explanation: `Because velocity changes linearly with time in case ${i + 1}.`,
  sourcePage: 1,
  sourceQuote: 'v = u + at',
  difficulty: 'easy',
}));

/** Lets a test interfere with one recordSubmission call while using the real store underneath. */
class InterceptingStore implements QuestionSetStore {
  readonly kind = 'firestore' as const;
  beforeRecord: ((submission: StoredSubmission) => StoredSubmission) | null = null;
  constructor(readonly inner: FirestoreQuestionSetStore) {}
  create(set: StoredQuestionSet) {
    return this.inner.create(set);
  }
  get(uid: string, setId: string, now?: Date) {
    return this.inner.get(uid, setId, now);
  }
  recordSubmission(uid: string, setId: string, submission: StoredSubmission) {
    const hook = this.beforeRecord;
    this.beforeRecord = null;
    return this.inner.recordSubmission(uid, setId, hook ? hook(submission) : submission);
  }
}

function buildApp(options: { dailyUnitLimit?: number } = {}) {
  const db = new StrictFakeFirestore();
  const store = new InterceptingStore(new FirestoreQuestionSetStore(db));
  const quotaStore = new MemoryDailyQuotaStore();
  let generatorCalls = 0;
  const generateQuiz: QuizGenerator = async (input) => {
    generatorCalls++;
    return { valid: generatedQuestions.slice(0, input.questionCount), rejectedCount: 0 };
  };
  const control = createApiAccessControl({
    verifyIdToken: verifier,
    quotaStore,
    ipLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: 1000 }),
    userLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, max: 1000 }),
    dailyUnitLimit: options.dailyUnitLimit ?? 100,
    isFeatureEnabled: () => false,
    diagnosticsEnabled: false,
    adminUids: new Set(),
    logger: { warn: () => {} },
  });
  const app = express();
  app.use(control.beforeBody);
  app.use(MEDIA_BODY_PATHS, express.json({ limit: REQUEST_LIMITS.mediaJsonBody }));
  app.use(express.json({ limit: REQUEST_LIMITS.defaultJsonBody }));
  app.use(control.afterBody);
  registerPracticeRoutes(app, { questionSetStore: store, generateQuiz, describeGenerationFailure: () => ({ aiStatus: 'test' }) });
  app.use(jsonBodyErrorHandler);
  return { app, db, store, quotaStore, generatorCalls: () => generatorCalls };
}

async function post(base: string, path: string, body: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const pages = [{ pageNumber: 1, title: 'Kinematics', content: 'Velocity changes uniformly: v = u + at.' }];
const quizBody = { documentId: 'doc-17300', title: 'Mechanics notes', pages, mode: 'diagnostic', questionCount: 5 };

/** Creates a set through the real quiz route and returns its id and public questions. */
async function createSet(base: string, uid = 'alice') {
  const res = await post(base, '/api/study/quiz', quizBody, `uid:${uid}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { setId: string; questions: Array<{ id: string; options: string[] }> };
}

const responsesFor = (questions: Array<{ id: string }>, optionId: 'A' | 'B') =>
  Object.fromEntries(questions.map((q, i) => [q.id, { type: 'mcq', optionId: i === 0 ? optionId : 'B' }]));

const submissionCommits = (db: StrictFakeFirestore) => db.writes.filter((w) => w.path.startsWith('questionSets/') && w.data?.submission).length;

test('document practice: creates a server-held set without exposing answers', async () => {
  const { app, db, generatorCalls } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base);
    assert.equal(generatorCalls(), 1);
    assert.equal(set.questions.length, 5);
    assert.ok(!JSON.stringify(set).includes('correctIndex') && !JSON.stringify(set).includes('explanation'));
    const stored = db.docs.get(`questionSets/${set.setId}`)!;
    assert.deepEqual(stored.context, { type: 'document', documentId: 'doc-17300', documentTitle: 'Mechanics notes' });
    assert.equal(stored.markingSchemeId, 'jee_main_2026');
  });
});

test('document practice rejects a missing or invalid documentId before generation and without charging quota', async () => {
  const { app, generatorCalls } = buildApp({ dailyUnitLimit: 2 });
  await withTestServer(app, async (base) => {
    for (const documentId of [undefined, '', 'unknown', 'a/b', '../x', 'x'.repeat(161), 42]) {
      const res = await post(base, '/api/study/quiz', { ...quizBody, documentId }, 'uid:alice');
      assert.equal(res.status, 400, `documentId ${JSON.stringify(documentId)}`);
      assert.match(String(res.body.error), /documentId/);
    }
    assert.equal(generatorCalls(), 0, 'no AI generation for rejected requests');
    // The daily budget (2 units = one quiz) is untouched by the seven rejected requests.
    assert.equal((await post(base, '/api/study/quiz', quizBody, 'uid:alice')).status, 200);
    const over = await post(base, '/api/study/quiz', quizBody, 'uid:alice');
    assert.equal(over.status, 429);
    assert.equal(over.body.code, 'daily_quota_exceeded');
    assert.equal(generatorCalls(), 1);
  });
});

test('unauthenticated submissions are refused by the middleware and touch nothing', async () => {
  const { app, db } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base);
    const before = db.writes.length;
    const anonymous = await post(base, '/api/practice/submit', { setId: set.setId, responses: {} });
    assert.equal(anonymous.status, 401);
    const badToken = await post(base, '/api/practice/submit', { setId: set.setId, responses: {} }, 'not-a-token');
    assert.equal(badToken.status, 401);
    assert.equal(db.writes.length, before);
  });
});

test('another user’s question set and expired sets are not found; nothing is written', async () => {
  const { app, db, store } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base, 'alice');
    const before = db.writes.length;
    const bob = await post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'B') }, 'uid:bob');
    assert.equal(bob.status, 404);
    assert.equal(bob.body.code, 'set_not_found');

    const expired = createAiPracticeSet({ setId: newQuestionSetId(), uid: 'alice', mode: 'diagnostic', documentId: 'doc-1', documentTitle: 'Notes', questions: generatedQuestions.slice(0, 5), now: new Date('2020-01-01T00:00:00Z') });
    await store.create(expired);
    const afterCreate = db.writes.length;
    const old = await post(base, '/api/practice/submit', { setId: expired.id, responses: {} }, 'uid:alice');
    assert.equal(old.status, 404);
    assert.equal(old.body.code, 'set_not_found');
    assert.equal(db.writes.length, afterCreate);
    assert.equal(submissionCommits(db), 0);
    assert.ok(before < afterCreate);
  });
});

test('first submission is graded on the server and persisted with the trusted attempt atomically', async () => {
  const { app, db } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base);
    const commitsBefore = db.commits;
    // Client-claimed results in the body are ignored: only responses are graded.
    const res = await post(
      base,
      '/api/practice/submit',
      { setId: set.setId, responses: responsesFor(set.questions, 'A'), score: 5, rawMarks: 20, scoredBy: 'client', attempt: { score: 5 } },
      'uid:alice'
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.alreadySubmitted, false);
    assert.equal(res.body.persisted, true);
    const attempt = res.body.attempt;
    assert.deepEqual(validateTrustedAttempt(attempt), []);
    assert.equal(attempt.correctCount, 4);
    assert.equal(attempt.incorrectCount, 1);
    assert.equal(attempt.rawMarks, 4 * 4 - 1);
    assert.equal(attempt.scoredBy, 'server');
    assert.equal(db.commits, commitsBefore + 1, 'submission and attempt in one transaction');
    const record = db.docs.get(cloudPaths.attempt('alice', attempt.id))!;
    assert.equal(record.scoredBy, 'server');
    assert.equal(record.rawMarks, attempt.rawMarks);
    assert.deepEqual(db.docs.get(`questionSets/${set.setId}`)!.submission, { submittedAt: attempt.completedAt, attempt });
  });
});

test('invalid answers and tampered graded attempts are rejected without writing anything', async () => {
  const { app, db, store } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base);
    const before = db.writes.length;
    const unknownQuestion = await post(base, '/api/practice/submit', { setId: set.setId, responses: { 'not-in-set': { type: 'mcq', optionId: 'A' } } }, 'uid:alice');
    assert.equal(unknownQuestion.status, 400);
    const badOption = await post(base, '/api/practice/submit', { setId: set.setId, responses: { [set.questions[0].id]: { type: 'mcq', optionId: 'E' } } }, 'uid:alice');
    assert.equal(badOption.status, 400);
    const badSetId = await post(base, '/api/practice/submit', { setId: 'qs_bad', responses: {} }, 'uid:alice');
    assert.equal(badSetId.status, 400);

    // The graded attempt is altered between grading and persistence: the store refuses it.
    store.beforeRecord = (s) => ({ ...s, attempt: { ...s.attempt, rawMarks: s.attempt.rawMarks + 8 } });
    const tampered = await post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'B') }, 'uid:alice');
    assert.equal(tampered.status, 500);
    assert.equal(tampered.body.code, 'grading_failed');
    assert.match(String(tampered.body.error), /Nothing was saved/);
    assert.equal(db.writes.length, before, 'no write at all');
    assert.equal(db.docs.get(`questionSets/${set.setId}`)!.submission, undefined);

    // The student can still submit normally afterwards.
    const ok = await post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'B') }, 'uid:alice');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.attempt.correctCount, 5);
  });
});

test('concurrent duplicate submissions store exactly one result and both callers receive it', async () => {
  const { app, db } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base);
    const [a, b] = await Promise.all([
      post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'B') }, 'uid:alice'),
      post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'A') }, 'uid:alice'),
    ]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.deepEqual([a.body.alreadySubmitted, b.body.alreadySubmitted].sort(), [false, true]);
    assert.deepEqual(a.body.attempt, b.body.attempt, 'identical authoritative result');
    assert.equal(submissionCommits(db), 1, 'only one submission was ever written');
    assert.equal(db.writes.filter((w) => w.path === cloudPaths.attempt('alice', a.body.attempt.id)).length, 1);
  });
});

test('resubmission returns the original persisted result and writes nothing', async () => {
  const { app, db } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base);
    const first = await post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'A') }, 'uid:alice');
    assert.equal(first.status, 200);
    const writes = db.writes.length;
    const again = await post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'B') }, 'uid:alice');
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadySubmitted, true);
    assert.deepEqual(again.body.attempt, first.body.attempt, 'better answers later do not change the stored result');
    assert.equal(db.writes.length, writes);
  });
});

test('a failed transaction returns a retryable error, stores nothing, and a retry succeeds', async () => {
  const { app, db, store } = buildApp();
  await withTestServer(app, async (base) => {
    const set = await createSet(base);
    store.beforeRecord = (s) => {
      db.failNext = 'ABORTED: Too much contention on these documents.';
      return s;
    };
    const failed = await post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'B') }, 'uid:alice');
    assert.equal(failed.status, 503);
    assert.equal(failed.body.code, 'practice_unavailable');
    assert.match(String(failed.body.error), /try submitting again/);
    assert.equal(submissionCommits(db), 0);
    assert.ok(![...db.docs.keys()].some((p) => p.startsWith('users/alice/attempts/')));

    const retry = await post(base, '/api/practice/submit', { setId: set.setId, responses: responsesFor(set.questions, 'B') }, 'uid:alice');
    assert.equal(retry.status, 200);
    assert.equal(retry.body.alreadySubmitted, false);
    assert.equal(submissionCommits(db), 1);
  });
});
