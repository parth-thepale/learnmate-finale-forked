import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQuizAttempt, decodeQuizAttempt } from './cloudEntities';
import type { QuizAttempt } from '../types/study';
import { FakeCloudStore } from './testDoubles';

test('encodeQuizAttempt and decodeQuizAttempt behavior on negative scores', async () => {
  const store = new FakeCloudStore();
  const uid = 'student-test';

  const negativeAttempt: QuizAttempt = {
    id: 'att-jee-neg-1',
    documentId: 'doc-jee-1',
    documentTitle: 'JEE Mock Exam 1',
    mode: 'jee_simulator',
    score: -2, // Legitimate negative JEE score from incorrect questions
    totalQuestions: 10,
    percentage: -20,
    completedAt: '2026-11-04T12:00:00Z',
    answers: [
      { questionId: 'q1', selectedIndex: 1, isCorrect: false, topic: 'Thermodynamics', sourcePage: 1 },
      { questionId: 'q2', selectedIndex: 2, isCorrect: false, topic: 'Rotational Motion', sourcePage: 2 },
    ],
    questions: [],
    weakTopics: ['Thermodynamics'],
    strongTopics: [],
  };

  // 1. Encode into CloudWriteOps
  const ops = encodeQuizAttempt(uid, negativeAttempt);
  const parentOp = ops.find((op) => op.path === `users/${uid}/attempts/${negativeAttempt.id}`);
  assert.ok(parentOp && parentOp.type === 'set', 'Parent write op must be generated as a set operation');

  // Verify that parentOp.data satisfies firestore.rules constraint (data.score >= 0 && data.score <= 100)
  assert.equal(parentOp.data.score, 0, 'Firestore top-level index field is clamped to 0 to prevent PERMISSION_DENIED');
  assert.equal(parentOp.data.percentage, 0, 'Firestore top-level percentage field is clamped to 0');

  // Verify that attemptJson contains the original raw un-clamped score
  const parsedJson = JSON.parse(parentOp.data.attemptJson as string);
  assert.equal(parsedJson.score, -2, 'Raw attemptJson preserves the exact negative JEE score (-2)');
  assert.equal(parsedJson.percentage, -20, 'Raw attemptJson preserves the exact negative percentage (-20)');

  // 2. Commit to cloud store
  await store.commit(ops);

  // 3. Decode back on a second device or after sync
  const cloudDoc = await store.getDoc(parentOp.path);
  assert.ok(cloudDoc, 'Cloud document must exist in store');

  const decodedAttempt = await decodeQuizAttempt(store, uid, cloudDoc);

  // 4. Verify decoded attempt fidelity
  assert.equal(decodedAttempt.id, 'att-jee-neg-1');
  assert.equal(decodedAttempt.score, -2, 'Decoded attempt restores the legitimate negative score (-2) from attemptJson');
  assert.equal(decodedAttempt.percentage, -20, 'Decoded attempt restores the negative percentage (-20)');
  assert.equal(decodedAttempt.answers?.length, 2, 'Decoded attempt restores all student answers');
});
