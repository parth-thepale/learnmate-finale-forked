import test from 'node:test';
import assert from 'node:assert/strict';
import { findSyllabusChapter, getSyllabus, isRegisteredTopicId, SYLLABUS_REGISTRY } from '../data/syllabusRegistry';
import { JEE_MAIN_SYLLABUS } from '../data/jeeMainSyllabus';
import { createAiPracticeSet, gradeSubmission } from '../server/practiceService';
import { newQuestionSetId } from '../server/questionSetStore';
import type { SyllabusAttemptContext } from '../types/questionBank';
import type { ValidatedGeneratedMcq } from './questionValidation';
import {
  isVerifiedAttempt,
  resolveAttemptContext,
  TRUSTED_ATTEMPT_ID_PREFIX,
  trustedAttemptIdFor,
  validateAttemptContext,
  validateTrustedAttempt,
} from './attemptContext';
import { JEE_MAIN_MARKING, PRACTICE_MARKING } from './jeeScoring';
import { getMarkingScheme, isRegisteredMarkingScheme, markingSchemeForExam, MARKING_SCHEME_REGISTRY } from './markingSchemes';

const KIN = 'physics.kinematics';
const KIN_T1 = 'physics.kinematics.straight-line-motion';
const KIN_T2 = 'physics.kinematics.uniformly-accelerated-motion';
const NLM_T1 = 'physics.laws-of-motion.newtons-laws';

const syllabusContext = (overrides: Partial<SyllabusAttemptContext> = {}): SyllabusAttemptContext => ({
  type: 'syllabus',
  examType: 'jee_main',
  syllabusId: 'jee_main_2026',
  syllabusRevision: 1,
  subjectId: 'physics',
  chapterId: KIN,
  topicIds: [KIN_T1],
  ...overrides,
});

const generated: ValidatedGeneratedMcq[] = [
  { topic: 'Straight-line motion', question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e1', sourcePage: 0, sourceQuote: '', difficulty: 'easy' },
  { topic: 'Straight-line motion', question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'e2', sourcePage: 0, sourceQuote: '', difficulty: 'medium' },
  { topic: 'Straight-line motion', question: 'Q3', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'e3', sourcePage: 0, sourceQuote: '', difficulty: 'hard' },
];

/** A trusted attempt as the current server grader builds it, plus the Stage A fields. */
function trustedAttempt(kind: 'syllabus' | 'document' = 'syllabus') {
  const base = createAiPracticeSet({ setId: newQuestionSetId(), uid: 'alice', mode: 'adaptive', documentId: kind === 'document' ? 'doc-17300' : '', documentTitle: kind === 'document' ? 'Mechanics notes' : 'Physics · Kinematics', questions: generated });
  // createAiPracticeSet still substitutes 'unknown' for a missing documentId (removed in Stage B).
  const set =
    kind === 'syllabus'
      ? { ...base, documentId: '', questions: base.questions.map((q) => ({ ...q, topicIds: [KIN_T1], chapterId: KIN })) }
      : base;
  const graded = gradeSubmission(set, {
    [set.questions[0].id]: { type: 'mcq', optionId: 'B' }, // correct
    [set.questions[1].id]: { type: 'mcq', optionId: 'A' }, // incorrect
  });
  assert.ok(graded.ok);
  if (!graded.ok) throw new Error('unreachable');
  return {
    ...graded.attempt,
    marking: { ...JEE_MAIN_MARKING },
    reviewMode: 'embedded' as const,
    context: kind === 'syllabus' ? syllabusContext() : { type: 'document' as const, documentId: 'doc-17300', documentTitle: 'Mechanics notes' },
  };
}

test('syllabus registry exposes JEE Main 2026 by plain string ids', () => {
  assert.deepEqual(SYLLABUS_REGISTRY.map((s) => [s.id, s.examType, s.revision]), [['jee_main_2026', 'jee_main', 1]]);
  const jee = getSyllabus('jee_main_2026')!;
  assert.equal(jee.subjects, JEE_MAIN_SYLLABUS, 'wraps the existing syllabus data, unchanged');
  assert.equal(findSyllabusChapter(jee, KIN)?.subjectId, 'physics');
  assert.equal(jee.source.groupingReview, 'pending_owner_review');
  assert.equal(getSyllabus('neet_ug_2026'), undefined, 'nothing is registered without a verified source');
  assert.equal(isRegisteredTopicId(KIN_T1), true);
  assert.equal(isRegisteredTopicId('physics.kinematics.made-up'), false);
});

test('marking schemes come from a registry and must match exactly', () => {
  assert.deepEqual(Object.keys(MARKING_SCHEME_REGISTRY).sort(), ['jee_main_2026', 'practice_plain']);
  assert.equal(getMarkingScheme('jee_main_2026'), JEE_MAIN_MARKING);
  assert.equal(getMarkingScheme('toString'), undefined, 'no prototype lookups');
  assert.equal(markingSchemeForExam('jee_main'), JEE_MAIN_MARKING);
  assert.equal(markingSchemeForExam('neet_ug'), undefined, 'no unverified exam scheme is assumed');
  assert.equal(isRegisteredMarkingScheme({ ...JEE_MAIN_MARKING }), true);
  assert.equal(isRegisteredMarkingScheme({ ...PRACTICE_MARKING }), true);
  assert.equal(isRegisteredMarkingScheme({ ...JEE_MAIN_MARKING, incorrect: 0 }), false, 'a tampered copy is rejected');
  assert.equal(isRegisteredMarkingScheme({ ...JEE_MAIN_MARKING, bonus: 1 }), false);
  assert.equal(isRegisteredMarkingScheme({ id: 'custom', correct: 4, incorrect: -1, unanswered: 0 }), false);
});

test('syllabus contexts need a registered exam, syllabus, revision, subject and chapter', () => {
  assert.deepEqual(validateAttemptContext(syllabusContext()), []);
  assert.deepEqual(validateAttemptContext(syllabusContext({ topicIds: [] })), [], 'whole-chapter practice');
  const invalid: Array<[string, unknown, RegExp]> = [
    ['unknown syllabus', syllabusContext({ syllabusId: 'jee_main_2099' }), /unknown syllabusId/],
    ['exam mismatch', syllabusContext({ examType: 'neet_ug' }), /belongs to exam jee_main/],
    ['unknown exam', syllabusContext({ examType: 'olympiad' as never }), /known examType/],
    ['unsupported revision', syllabusContext({ syllabusRevision: 2 }), /supported syllabusRevision/],
    ['non-integer revision', syllabusContext({ syllabusRevision: 1.5 }), /supported syllabusRevision/],
    ['unknown subject', syllabusContext({ subjectId: 'biology' }), /unknown subjectId/],
    ['unknown chapter', syllabusContext({ chapterId: 'physics.nope' }), /unknown chapterId/],
    ['chapter outside subject', syllabusContext({ subjectId: 'chemistry' }), /does not belong to subjectId/],
    ['topic outside chapter', syllabusContext({ topicIds: [NLM_T1] }), /not in chapter/],
    ['unknown topic', syllabusContext({ topicIds: ['physics.kinematics.made-up'] }), /unknown topicId/],
    ['duplicate topic', syllabusContext({ topicIds: [KIN_T1, KIN_T1] }), /twice/],
    ['missing topics list', { ...syllabusContext(), topicIds: undefined }, /topicIds list/],
    ['too many topics', syllabusContext({ topicIds: Array.from({ length: 51 }, () => KIN_T1) }), /too many/],
    ['extra field', { ...syllabusContext(), documentId: 'doc-1' }, /unexpected fields/],
    ['unknown type', { type: 'chapter' }, /must be "document" or "syllabus"/],
  ];
  for (const [label, ctx, pattern] of invalid) {
    assert.ok(validateAttemptContext(ctx).some((e) => pattern.test(e)), `${label}: ${validateAttemptContext(ctx).join(' | ')}`);
  }
  assert.deepEqual(validateAttemptContext({ type: 'document', documentId: 'doc-1', documentTitle: 'Notes' }), []);
  for (const documentId of ['', 'a/b', 'x'.repeat(161), '..', undefined]) {
    assert.ok(validateAttemptContext({ type: 'document', documentId, documentTitle: 'Notes' }).length > 0, String(documentId));
  }
});

test('context resolution: explicit contexts must agree with documentId; legacy records are never guessed', () => {
  const syllabus = resolveAttemptContext({ documentId: '', documentTitle: 'Physics · Kinematics', context: syllabusContext() });
  assert.ok(syllabus.ok && syllabus.source === 'explicit' && syllabus.context.type === 'syllabus');
  assert.equal(resolveAttemptContext({ documentId: 'doc-1', context: syllabusContext() }).ok, false, 'syllabus attempts need documentId ""');
  assert.equal(resolveAttemptContext({ documentId: 'doc-2', context: { type: 'document', documentId: 'doc-1', documentTitle: 'N' } }).ok, false);
  assert.equal(resolveAttemptContext({ documentId: '', context: { type: 'document', documentId: '', documentTitle: 'N' } }).ok, false);

  const legacy = resolveAttemptContext({ id: 'quiz-1', documentId: 'doc-1', documentTitle: 'Mechanics notes', mode: 'diagnostic' });
  assert.deepEqual(legacy, { ok: true, source: 'legacy_document', context: { type: 'document', documentId: 'doc-1', documentTitle: 'Mechanics notes' } });
  const legacyV2 = resolveAttemptContext({ schemaVersion: 2, scoredBy: 'server', documentId: 'doc-1', documentTitle: 'Notes' });
  assert.ok(legacyV2.ok && legacyV2.source === 'legacy_document', 'v2 records from before contexts stay document-linked');
  for (const malformed of [{ documentId: '' }, { documentId: 42 }, {}, { documentId: 'a/b' }, null, 'attempt']) {
    assert.equal(resolveAttemptContext(malformed).ok, false, JSON.stringify(malformed));
  }
});

test('a server-graded attempt with context, marking and review mode passes trusted validation', () => {
  for (const kind of ['syllabus', 'document'] as const) {
    const attempt = trustedAttempt(kind);
    assert.deepEqual(validateTrustedAttempt(attempt), [], kind);
    assert.equal(attempt.id, trustedAttemptIdFor(attempt.questionSetId));
    assert.ok(attempt.id.startsWith(TRUSTED_ATTEMPT_ID_PREFIX));
    assert.equal(attempt.rawMarks, 4 - 1);
    assert.equal(attempt.maxMarks, 12);
  }
});

test('tampered or incomplete trusted attempts are rejected', () => {
  const base = trustedAttempt();
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['inflated score', { score: 3 }, /score/],
    ['inflated marks', { rawMarks: 12 }, /rawMarks/],
    ['inflated max', { maxMarks: 40 }, /maxMarks/],
    ['percentage', { percentage: 100 }, /percentage/],
    ['counts', { correctCount: 3 }, /correctCount/],
    ['total', { totalQuestions: 10 }, /totalQuestions/],
    ['client scored', { scoredBy: 'client' }, /scoredBy/],
    ['schema', { schemaVersion: 3 }, /schemaVersion/],
    ['id not derived from set', { id: 'att-mine' }, /att-<questionSetId>/],
    ['bad set id', { questionSetId: 'qs_short' }, /questionSetId/],
    ['custom marking', { marking: { ...JEE_MAIN_MARKING, incorrect: 0 } }, /registered marking/],
    ['scheme id mismatch', { markingSchemeId: 'practice_plain' }, /markingSchemeId/],
    ['missing context', { context: undefined }, /context is required/],
    ['context mismatch', { documentId: 'doc-1' }, /documentId ""/],
    ['exam mismatch', { examType: 'neet_ug' }, /examType/],
    ['unknown kind', { kind: 'homework' }, /kind/],
    ['no sources', { sources: [] }, /sources/],
    ['bad completedAt', { completedAt: 'yesterday' }, /completedAt/],
    ['bad session', { sessionId: 'a/b' }, /sessionId/],
    ['no review mode', { reviewMode: undefined }, /reviewMode/],
    ['answer flipped', { answers: base.answers.map((a, i) => (i === 1 ? { ...a, isCorrect: true } : a)) }, /isCorrect/],
    ['answers missing', { answers: base.answers.slice(1) }, /answers/],
    ['topic outside chapter', { outcomes: base.outcomes.map((o, i) => (i === 0 ? { ...o, topicIds: [NLM_T1] } : o)) }, /outside chapter/],
    ['topic not selected', { outcomes: base.outcomes.map((o, i) => (i === 0 ? { ...o, topicIds: [KIN_T2] } : o)) }, /not selected/],
    ['topic missing', { outcomes: base.outcomes.map((o, i) => (i === 0 ? { ...o, topicIds: [] } : o)) }, /at least one topicId/],
    ['unknown topic', { outcomes: base.outcomes.map((o, i) => (i === 0 ? { ...o, topicIds: ['x.y.z'] } : o)) }, /registered syllabus/],
    ['duplicate question', { outcomes: [base.outcomes[0], base.outcomes[0], base.outcomes[2]] }, /twice/],
    ['no outcomes', { outcomes: [] }, /outcomes must list/],
    ['outcome changed after grading', { outcomes: base.outcomes.map((o, i) => (i === 2 ? { ...o, outcome: 'correct' } : o)) }, /does not match/],
  ];
  for (const [label, patch, pattern] of cases) {
    const errors = validateTrustedAttempt({ ...base, ...patch });
    assert.ok(errors.some((e) => pattern.test(e)), `${label}: ${errors.join(' | ')}`);
  }
});

test('bank and PYQ attempts keep question ids and outcomes only, never copied content', () => {
  const base = trustedAttempt();
  const embeddedBank = validateTrustedAttempt({ ...base, sources: ['pyq'] });
  assert.ok(embeddedBank.some((e) => /by_reference/.test(e)));
  const byReference = { ...base, sources: ['pyq', 'curated'], reviewMode: 'by_reference', questions: [] };
  assert.deepEqual(validateTrustedAttempt(byReference), []);
  assert.ok(validateTrustedAttempt({ ...byReference, questions: base.questions }).some((e) => /must not embed/.test(e)));
  assert.ok(validateTrustedAttempt({ ...base, questions: base.questions.slice(1) }).some((e) => /every reviewed question/.test(e)));
});

test('the marking snapshot drives marks, so other registered schemes validate the same way', () => {
  const base = trustedAttempt();
  const plain = { ...base, marking: { ...PRACTICE_MARKING }, markingSchemeId: 'practice_plain', rawMarks: 1, maxMarks: 3, negativeMarkingUsed: false };
  assert.deepEqual(validateTrustedAttempt(plain), []);
  assert.ok(validateTrustedAttempt({ ...plain, rawMarks: 3 }).length > 0);
});

test('verification requires both a valid trusted record and proof it was written by the server', () => {
  const attempt = trustedAttempt();
  assert.equal(isVerifiedAttempt(attempt, { writtenByServer: true }), true);
  assert.equal(isVerifiedAttempt(attempt, { writtenByServer: false }), false, 'a marker held only by the client proves nothing');
  assert.equal(isVerifiedAttempt({ ...attempt, score: 3 }, { writtenByServer: true }), false);
  const legacy = { id: 'quiz-1', documentId: 'doc-1', documentTitle: 'N', mode: 'diagnostic', score: 5, totalQuestions: 5, percentage: 100 };
  assert.equal(isVerifiedAttempt(legacy, { writtenByServer: true }), false, 'v1 attempts are never verified');
});
