import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, planDocumentSessionMigration, sessionIdForDocument, validateSession } from './sessionModel';
import { buildGradedAttempt } from './attemptV2';
import { scoreAttempt, JEE_MAIN_MARKING } from './jeeScoring';
import type { StudyDocument } from '../types/study';

function doc(id: string, title = `${id}.pdf`): StudyDocument {
  return {
    id,
    title,
    sourceType: 'pdf',
    pageCount: 1,
    pages: [{ pageNumber: 1, title: 'p', content: 'c' }],
    topics: [],
    overview: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastStudiedAt: '2026-10-05T00:00:00.000Z',
  };
}

test('document migration creates one session reference per document and never modifies documents', () => {
  const documents = [doc('doc-a', 'Rotational Dynamics.pdf'), doc('doc-b')];
  const snapshot = structuredClone(documents);
  const plan = planDocumentSessionMigration(documents, []);
  assert.deepEqual(documents, snapshot, 'documents must be untouched');
  assert.equal(plan.toCreate.length, 2);
  const [first] = plan.toCreate;
  assert.equal(first.id, sessionIdForDocument('doc-a'));
  assert.equal(first.name, 'Rotational Dynamics');
  assert.deepEqual(first.resourceIds, ['doc-a']);
  assert.equal(first.migratedFromDocumentId, 'doc-a');
  assert.equal(first.lastActiveAt, '2026-10-05T00:00:00.000Z');
  assert.deepEqual(validateSession(first), []);
});

test('migration is idempotent and skips documents already referenced by a session', () => {
  const documents = [doc('doc-a'), doc('doc-b'), doc('doc-c')];
  const first = planDocumentSessionMigration(documents, []);
  const second = planDocumentSessionMigration(documents, first.toCreate);
  assert.equal(second.toCreate.length, 0);
  assert.deepEqual(second.alreadyMigrated.sort(), ['doc-a', 'doc-b', 'doc-c']);

  const manual = createSession({ id: 'sess-manual', name: 'My session', resourceIds: ['doc-c'] });
  const third = planDocumentSessionMigration(documents, [manual]);
  assert.deepEqual(third.toCreate.map((s) => s.resourceIds[0]).sort(), ['doc-a', 'doc-b']);
});

test('migration skips invalid and duplicate documents instead of failing', () => {
  const plan = planDocumentSessionMigration([doc('ok'), doc('ok'), { ...doc('x'), id: 'bad/id' }], []);
  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.skipped.length, 2);
});

test('sessions validate their subject, chapter and topic references', () => {
  const session = createSession({
    id: 'sess-1',
    name: '  Kinematics revision  ',
    chapterId: 'physics.kinematics',
    topicIds: ['physics.kinematics.relative-velocity'],
  });
  assert.equal(session.subjectId, 'physics');
  assert.equal(session.name, 'Kinematics revision');
  assert.throws(() => createSession({ id: 's', name: 'x', chapterId: 'physics.kinematics', topicIds: ['chemistry.solutions.raoults-law'] }));
  assert.throws(() => createSession({ id: 's', name: 'x', subjectId: 'chemistry', chapterId: 'physics.kinematics' }));
  assert.throws(() => createSession({ id: 's', name: '   ' }));
});

test('graded attempts keep legacy fields and add server-scored v2 fields', () => {
  const score = scoreAttempt(
    [
      { id: 'q1', type: 'mcq', correctOptionIds: ['A'], topicIds: [], topicLabel: 'Torque' },
      { id: 'q2', type: 'mcq', correctOptionIds: ['B'], topicIds: [], topicLabel: 'Torque' },
      { id: 'q3', type: 'mcq', correctOptionIds: ['C'], topicIds: [], topicLabel: 'Friction' },
    ],
    { q1: { type: 'mcq', optionId: 'A' }, q2: { type: 'mcq', optionId: 'D' } },
    JEE_MAIN_MARKING
  );
  const review = ['q1', 'q2', 'q3'].map((id, i) => ({
    id,
    topic: i < 2 ? 'Torque' : 'Friction',
    question: `Question ${id}`,
    options: ['a', 'b', 'c', 'd'] as [string, string, string, string],
    correctIndex: i,
    explanation: 'because',
    sourcePage: 1,
    sourceQuote: '',
    difficulty: 'medium' as const,
  }));
  const attempt = buildGradedAttempt({
    attemptId: 'att-1',
    questionSetId: 'qs_1',
    kind: 'ai_practice',
    mode: 'diagnostic',
    documentId: 'doc-1',
    documentTitle: 'Doc',
    sources: ['ai'],
    context: { type: 'document', documentId: 'doc-1', documentTitle: 'Mechanics notes' },
    marking: { id: 'jee_main_2026', correct: 4, incorrect: -1, unanswered: 0 },
    reviewMode: 'embedded',
    reviewQuestions: review,
    selectedIndices: { q1: 0, q2: 3 },
    score,
    completedAt: '2026-11-03T10:00:00.000Z',
  });
  assert.equal(attempt.score, 1);
  assert.equal(attempt.totalQuestions, 3);
  assert.equal(attempt.percentage, 33);
  assert.equal(attempt.rawMarks, 3);
  assert.equal(attempt.maxMarks, 12);
  assert.equal(attempt.unansweredCount, 1);
  assert.deepEqual(attempt.weakTopics.sort(), ['Friction', 'Torque']);
  assert.equal(attempt.answers.find((a) => a.questionId === 'q3')?.selectedIndex, -1);
  assert.equal(attempt.scoredBy, 'server');
  assert.equal(attempt.schemaVersion, 2);
});
