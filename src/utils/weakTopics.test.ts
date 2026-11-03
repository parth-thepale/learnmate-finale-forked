import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTopics, identifyWeakTopics, TOPIC_EVIDENCE_RULES } from './weakTopics';
import type { QuizAttempt } from '../types/study';
import type { AttemptV2Fields, ResponseOutcome } from '../types/questionBank';

let counter = 0;
function legacyAttempt(topic: string, results: boolean[], completedAt: string): QuizAttempt {
  counter++;
  return {
    id: `att-${counter}`,
    documentId: 'doc',
    documentTitle: 'doc',
    mode: 'diagnostic',
    questions: [],
    answers: results.map((ok, i) => ({ questionId: `q${counter}-${i}`, selectedIndex: ok ? 0 : 1, isCorrect: ok, topic, sourcePage: 1 })),
    score: results.filter(Boolean).length,
    totalQuestions: results.length,
    percentage: 0,
    weakTopics: [],
    strongTopics: [],
    completedAt,
  };
}

function v2Attempt(topicId: string, outcomes: ResponseOutcome[], completedAt: string): QuizAttempt & AttemptV2Fields {
  counter++;
  return {
    ...legacyAttempt('ignored', [], completedAt),
    id: `att-v2-${counter}`,
    schemaVersion: 2,
    kind: 'topic_practice',
    questionSetId: `qs-${counter}`,
    sources: ['curated'],
    scoredBy: 'server',
    markingSchemeId: 'jee_main_2026',
    rawMarks: 0,
    maxMarks: 0,
    correctCount: 0,
    incorrectCount: 0,
    unansweredCount: 0,
    outcomes: outcomes.map((outcome, i) => ({ questionId: `v${counter}-${i}`, outcome, topicIds: [topicId], topicLabel: 'x' })),
  };
}

test('a single quiz never makes a topic weak, however badly it went', () => {
  const attempts = [legacyAttempt('Bayes theorem', [false, false, false, false, false, false, false, false], '2026-11-01T10:00:00Z')];
  assert.deepEqual(identifyWeakTopics(attempts), []);
  const [evidence] = assessTopics(attempts);
  assert.equal(evidence.status, 'insufficient_evidence');
  assert.ok(evidence.reason.includes('1 more practice attempt'));
});

test('too few questions across attempts is still insufficient evidence', () => {
  const attempts = [
    legacyAttempt('Friction', [false, false], '2026-11-01T10:00:00Z'),
    legacyAttempt('Friction', [false, false], '2026-11-02T10:00:00Z'),
  ];
  const [evidence] = assessTopics(attempts);
  assert.equal(evidence.status, 'insufficient_evidence');
  assert.ok(evidence.attemptedQuestions < TOPIC_EVIDENCE_RULES.minAttemptedQuestions);
});

test('with enough evidence, low accuracy is weak, high accuracy is strong, middle is developing', () => {
  const weak = [
    legacyAttempt('Torque', [true, false, false, false], '2026-11-01T10:00:00Z'),
    legacyAttempt('Torque', [false, true, false, false], '2026-11-02T10:00:00Z'),
  ];
  const strong = [
    legacyAttempt('Mole concept', [true, true, true, true], '2026-11-01T10:00:00Z'),
    legacyAttempt('Mole concept', [true, true, true, true], '2026-11-02T10:00:00Z'),
  ];
  const developing = [
    legacyAttempt('Circles', [true, true, true, false], '2026-11-01T10:00:00Z'),
    legacyAttempt('Circles', [true, false, true, true], '2026-11-02T10:00:00Z'),
  ];
  const byLabel = Object.fromEntries(assessTopics([...weak, ...strong, ...developing]).map((e) => [e.label, e]));
  assert.equal(byLabel['Torque'].status, 'weak');
  assert.equal(byLabel['Torque'].accuracy, 0.25);
  assert.equal(byLabel['Mole concept'].status, 'strong');
  assert.equal(byLabel['Circles'].status, 'developing');
  assert.deepEqual(identifyWeakTopics([...weak, ...strong, ...developing]).map((e) => e.label), ['Torque']);
});

test('recent improvement is reflected because only the latest questions count', () => {
  const old = Array.from({ length: 5 }, (_, i) => legacyAttempt('Limits', [false, false, false, false], `2026-10-0${i + 1}T10:00:00Z`));
  const recent = Array.from({ length: 5 }, (_, i) => legacyAttempt('Limits', [true, true, true, true], `2026-11-0${i + 1}T10:00:00Z`));
  const [evidence] = assessTopics([...old, ...recent]);
  assert.equal(evidence.attemptedQuestions, TOPIC_EVIDENCE_RULES.recentWindow);
  assert.equal(evidence.status, 'strong');
});

test('unanswered questions are not counted as attempts; v2 attempts use stable syllabus topic ids', () => {
  const attempts = [
    v2Attempt('physics.optics.prism', ['incorrect', 'incorrect', 'unanswered', 'correct'], '2026-11-01T10:00:00Z'),
    v2Attempt('physics.optics.prism', ['incorrect', 'incorrect', 'unanswered', 'unanswered'], '2026-11-02T10:00:00Z'),
  ];
  const [evidence] = assessTopics(attempts);
  assert.equal(evidence.topicId, 'physics.optics.prism');
  assert.equal(evidence.label, 'Refraction through a prism');
  assert.equal(evidence.attemptedQuestions, 5);
  assert.equal(evidence.unanswered, 3);
  assert.equal(evidence.status, 'insufficient_evidence');
  attempts.push(v2Attempt('physics.optics.prism', ['incorrect'], '2026-11-03T10:00:00Z'));
  assert.equal(assessTopics(attempts)[0].status, 'weak');
});
