import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiagnostic, DIAGNOSTIC_CONFIG } from './diagnosticEngine';

test('diagnosticEngine: score exactly 80% with 4 questions permits skipping intro revision', () => {
  const result = evaluateDiagnostic({
    totalQuestions: 4,
    correctCount: 3, // 3 / 4 is 75%, wait! 4 questions with 4 correct is 100%, 5 questions with 4 correct is 80%
    questionTopicMap: [
      { topicId: 't1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 't2', topicName: 'Topic 2', isCorrect: true },
      { topicId: 't3', topicName: 'Topic 3', isCorrect: true },
      { topicId: 't4', topicName: 'Topic 4', isCorrect: true },
    ],
    timeTakenSeconds: 120,
  });

  // Test exactly 80% using 5 questions (4 correct out of 5 = 80%)
  const exact80 = evaluateDiagnostic({
    totalQuestions: 5,
    correctCount: 4,
    questionTopicMap: [
      { topicId: 't1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 't2', topicName: 'Topic 2', isCorrect: true },
      { topicId: 't3', topicName: 'Topic 3', isCorrect: true },
      { topicId: 't4', topicName: 'Topic 4', isCorrect: true },
      { topicId: 't5', topicName: 'Topic 5', isCorrect: false },
    ],
    timeTakenSeconds: 150,
  });

  assert.equal(exact80.score.percentage, 80);
  assert.equal(exact80.canSkipIntroRevision, true);
  assert.deepEqual(exact80.weakTopics, ['Topic 5']);
  assert.match(exact80.message, /strong diagnostic/i);
});

test('diagnosticEngine: score > 80% permits skipping intro revision', () => {
  const result = evaluateDiagnostic({
    totalQuestions: 5,
    correctCount: 5,
    questionTopicMap: [
      { topicId: 't1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 't2', topicName: 'Topic 2', isCorrect: true },
      { topicId: 't3', topicName: 'Topic 3', isCorrect: true },
      { topicId: 't4', topicName: 'Topic 4', isCorrect: true },
      { topicId: 't5', topicName: 'Topic 5', isCorrect: true },
    ],
    timeTakenSeconds: 140,
  });

  assert.equal(result.score.percentage, 100);
  assert.equal(result.canSkipIntroRevision, true);
  assert.equal(result.weakTopics.length, 0);
  assert.equal(result.strongTopics.length, 5);
});

test('diagnosticEngine: score < 80% disallows skipping intro revision', () => {
  // 3 out of 5 = 60%
  const result = evaluateDiagnostic({
    totalQuestions: 5,
    correctCount: 3,
    questionTopicMap: [
      { topicId: 't1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 't2', topicName: 'Topic 2', isCorrect: true },
      { topicId: 't3', topicName: 'Topic 3', isCorrect: true },
      { topicId: 't4', topicName: 'Topic 4', isCorrect: false },
      { topicId: 't5', topicName: 'Topic 5', isCorrect: false },
    ],
    timeTakenSeconds: 180,
  });

  assert.equal(result.score.percentage, 60);
  assert.equal(result.canSkipIntroRevision, false);
  assert.deepEqual(result.weakTopics, ['Topic 4', 'Topic 5']);
  assert.match(result.message, /moderate diagnostic/i);
});

test('diagnosticEngine: respects minimum evidence threshold of 4 questions', () => {
  // 100% on 3 questions (< 4 questions) -> insufficient evidence to skip
  const smallSample = evaluateDiagnostic({
    totalQuestions: 3,
    correctCount: 3,
    questionTopicMap: [
      { topicId: 't1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 't2', topicName: 'Topic 2', isCorrect: true },
      { topicId: 't3', topicName: 'Topic 3', isCorrect: true },
    ],
    timeTakenSeconds: 60,
  });

  assert.equal(smallSample.score.percentage, 100);
  assert.equal(smallSample.canSkipIntroRevision, false);

  // Exactly 4 questions with 4 correct (100% >= 80% and >= 4 questions) -> can skip
  const exact4 = evaluateDiagnostic({
    totalQuestions: 4,
    correctCount: 4,
    questionTopicMap: [
      { topicId: 't1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 't2', topicName: 'Topic 2', isCorrect: true },
      { topicId: 't3', topicName: 'Topic 3', isCorrect: true },
      { topicId: 't4', topicName: 'Topic 4', isCorrect: true },
    ],
    timeTakenSeconds: 90,
  });

  assert.equal(exact4.canSkipIntroRevision, true);
});

test('diagnosticEngine: handles empty diagnostic cleanly without crashing', () => {
  const empty = evaluateDiagnostic({
    totalQuestions: 0,
    correctCount: 0,
    questionTopicMap: [],
    timeTakenSeconds: 0,
  });

  assert.equal(empty.score.percentage, 0);
  assert.equal(empty.canSkipIntroRevision, false);
  assert.equal(empty.weakTopics.length, 0);
  assert.equal(empty.strongTopics.length, 0);
});

test('diagnosticEngine: deduplicates weak and strong topics when multiple questions cover same topic', () => {
  const multiTopic = evaluateDiagnostic({
    totalQuestions: 4,
    correctCount: 2,
    questionTopicMap: [
      { topicId: 't1', topicName: 'Rotational Dynamics', isCorrect: true },
      { topicId: 't1', topicName: 'Rotational Dynamics', isCorrect: false }, // Missed one question on same topic
      { topicId: 't2', topicName: 'Torque', isCorrect: true },
      { topicId: 't3', topicName: 'Angular Momentum', isCorrect: false },
    ],
    timeTakenSeconds: 150,
  });

  // If a topic has any incorrect answer, it is classified as weak
  assert.ok(multiTopic.weakTopics.includes('Rotational Dynamics'));
  assert.ok(!multiTopic.strongTopics.includes('Rotational Dynamics'));
  assert.ok(multiTopic.strongTopics.includes('Torque'));
});
