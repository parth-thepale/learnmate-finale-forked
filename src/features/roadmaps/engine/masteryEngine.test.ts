import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMastery,
  canCheckpointBeCompleted,
  DEFAULT_MASTERY_THRESHOLDS,
} from './masteryEngine';
import type { Checkpoint } from '../types/checkpoint.types';
import type { AssessmentAttemptResult, CheckpointProgress } from '../types/progress.types';

function createMockResult(overrides: Partial<AssessmentAttemptResult> = {}): AssessmentAttemptResult {
  const correct = overrides.correctCount ?? 3;
  const incorrect = overrides.incorrectCount ?? 0;
  const unanswered = overrides.unansweredCount ?? 0;
  const totalQuestions = correct + incorrect + unanswered;
  const totalMarks = overrides.totalMarks ?? totalQuestions * 4;
  const rawMarks = overrides.rawMarks ?? correct * 4 - incorrect * 1;
  const percentage =
    overrides.percentage ??
    (totalMarks > 0 ? Math.round((rawMarks / totalMarks) * 100) : 0);

  return {
    attemptId: 'att-mock-1',
    score: percentage,
    totalMarks,
    rawMarks,
    percentage,
    correctCount: correct,
    incorrectCount: incorrect,
    unansweredCount: unanswered,
    timeTakenSeconds: 120,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: ['test-topic'],
    ...overrides,
  };
}

function createMockCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    subject: 'physics',
    order: 1,
    title: 'Test Checkpoint',
    description: 'Test description',
    learningObjectives: ['Objective 1'],
    officialUnitNumbers: [1],
    officialChapterIds: ['physics-1'],
    topicIds: ['physics.kinematics.test'],
    prerequisiteIds: [],
    estimatedWorkloadMinutes: 45,
    concepts: [],
    diagnosticQuestions: [],
    activeRecallPrompts: [],
    practiceQuestions: [],
    assessmentQuestions: [
      {
        id: 'q1',
        type: 'mcq',
        topicId: 'physics.kinematics.test',
        difficulty: 'medium',
        stem: 'Test question 1',
        options: ['A', 'B', 'C', 'D'],
        correctOptionIndex: 0,
        explanation: 'Test',
      },
      {
        id: 'q2',
        type: 'mcq',
        topicId: 'physics.kinematics.test',
        difficulty: 'medium',
        stem: 'Test question 2',
        options: ['A', 'B', 'C', 'D'],
        correctOptionIndex: 1,
        explanation: 'Test',
      },
      {
        id: 'q3',
        type: 'mcq',
        topicId: 'physics.kinematics.test',
        difficulty: 'medium',
        stem: 'Test question 3',
        options: ['A', 'B', 'C', 'D'],
        correctOptionIndex: 2,
        explanation: 'Test',
      },
    ],
    ...overrides,
  };
}

test('masteryEngine: 0 available questions never awards mastery or evidence', () => {
  const result = createMockResult({ correctCount: 3, rawMarks: 12, totalMarks: 12, percentage: 100 });
  const evalResult = evaluateMastery(result, undefined, undefined, 0);

  assert.equal(evalResult.masteryStatus, 'insufficient_evidence');
  assert.equal(evalResult.hasSufficientEvidence, false);
  assert.equal(evalResult.masteryScore, 0);
  assert.match(evalResult.recommendedAction, /pending/i);
});

test('masteryEngine: 1 available question respects single question threshold', () => {
  // Correct answer (+4 / 4 = 100%)
  const correctResult = createMockResult({
    correctCount: 1,
    incorrectCount: 0,
    unansweredCount: 0,
    rawMarks: 4,
    totalMarks: 4,
    percentage: 100,
  });
  const strong = evaluateMastery(correctResult, undefined, undefined, 1);
  assert.equal(strong.masteryStatus, 'strong');
  assert.equal(strong.hasSufficientEvidence, true);
  assert.equal(strong.masteryScore, 100);

  // Incorrect answer (-1 / 4 = -25%)
  const wrongResult = createMockResult({
    correctCount: 0,
    incorrectCount: 1,
    unansweredCount: 0,
    rawMarks: -1,
    totalMarks: 4,
    percentage: -25,
  });
  const weak = evaluateMastery(wrongResult, undefined, undefined, 1);
  assert.equal(weak.masteryStatus, 'needs_reinforcement');
  assert.equal(weak.hasSufficientEvidence, true);
  assert.equal(weak.masteryScore, 0); // clamped to 0
});

test('masteryEngine: 3 available questions deadlocks are eliminated', () => {
  // 3 of 3 correct (12 / 12 = 100%) -> Strong
  const fullResult = createMockResult({
    correctCount: 3,
    incorrectCount: 0,
    unansweredCount: 0,
    rawMarks: 12,
    totalMarks: 12,
    percentage: 100,
  });
  const fullEval = evaluateMastery(fullResult, undefined, undefined, 3);
  assert.equal(fullEval.masteryStatus, 'strong');
  assert.equal(fullEval.hasSufficientEvidence, true);
  assert.equal(fullEval.masteryScore, 100);

  // 2 correct, 1 incorrect (7 / 12 = 58%) -> Needs reinforcement
  const partialResult = createMockResult({
    correctCount: 2,
    incorrectCount: 1,
    unansweredCount: 0,
    rawMarks: 7,
    totalMarks: 12,
    percentage: 58,
  });
  const partialEval = evaluateMastery(partialResult, undefined, undefined, 3);
  assert.equal(partialEval.masteryStatus, 'needs_reinforcement');
  assert.equal(partialEval.hasSufficientEvidence, true);
  assert.equal(partialEval.masteryScore, 58);
});

test('masteryEngine: 5 available questions behavior', () => {
  // 4 correct, 1 incorrect (15 / 20 = 75%) -> Developing
  const devResult = createMockResult({
    correctCount: 4,
    incorrectCount: 1,
    unansweredCount: 0,
    rawMarks: 15,
    totalMarks: 20,
    percentage: 75,
  });
  const devEval = evaluateMastery(devResult, undefined, undefined, 5);
  assert.equal(devEval.masteryStatus, 'developing');
  assert.equal(devEval.hasSufficientEvidence, true);
  assert.equal(devEval.masteryScore, 75);
});

test('masteryEngine: insufficient evidence when fewer questions submitted than required', () => {
  // Checkpoint has 3 questions, but attempt only includes 1 question
  const partialAttempt = createMockResult({
    correctCount: 1,
    incorrectCount: 0,
    unansweredCount: 0,
    rawMarks: 4,
    totalMarks: 4,
    percentage: 100,
  });
  const incompleteEval = evaluateMastery(partialAttempt, undefined, undefined, 3);
  assert.equal(incompleteEval.masteryStatus, 'insufficient_evidence');
  assert.equal(incompleteEval.hasSufficientEvidence, false);
});

test('masteryEngine: boundary conditions for exactly 60% and exactly 80%', () => {
  // Exactly 60% with 5 questions
  const exact60 = createMockResult({
    correctCount: 3,
    incorrectCount: 0,
    unansweredCount: 2,
    rawMarks: 12,
    totalMarks: 20,
    percentage: 60,
  });
  const eval60 = evaluateMastery(exact60, undefined, undefined, 5);
  assert.equal(eval60.masteryStatus, 'developing');
  assert.equal(eval60.hasSufficientEvidence, true);
  assert.equal(eval60.masteryScore, 60);

  // Exactly 80% with 5 questions
  const exact80 = createMockResult({
    correctCount: 4,
    incorrectCount: 0,
    unansweredCount: 1,
    rawMarks: 16,
    totalMarks: 20,
    percentage: 80,
  });
  const eval80 = evaluateMastery(exact80, undefined, undefined, 5);
  assert.equal(eval80.masteryStatus, 'strong');
  assert.equal(eval80.hasSufficientEvidence, true);
  assert.equal(eval80.masteryScore, 80);

  // Below 60% (59%)
  const below60 = createMockResult({
    correctCount: 3,
    incorrectCount: 1,
    unansweredCount: 1,
    rawMarks: 11,
    totalMarks: 20,
    percentage: 55,
  });
  const evalBelow = evaluateMastery(below60, undefined, undefined, 5);
  assert.equal(evalBelow.masteryStatus, 'needs_reinforcement');
  assert.equal(evalBelow.hasSufficientEvidence, true);
  assert.equal(evalBelow.masteryScore, 55);
});

test('masteryEngine: handles JEE unattempted answers without penalty and all unattempted as insufficient evidence', () => {
  // All 3 unattempted: zero answers given
  const allUnattempted = createMockResult({
    correctCount: 0,
    incorrectCount: 0,
    unansweredCount: 3,
    rawMarks: 0,
    totalMarks: 12,
    percentage: 0,
  });
  const evalAllUnatt = evaluateMastery(allUnattempted, undefined, undefined, 3);
  assert.equal(evalAllUnatt.masteryStatus, 'insufficient_evidence');
  assert.equal(evalAllUnatt.hasSufficientEvidence, false);

  // 2 correct, 1 unattempted in 3-question test: (8 / 12) = 67%
  const strategicPass = createMockResult({
    correctCount: 2,
    incorrectCount: 0,
    unansweredCount: 1,
    rawMarks: 8,
    totalMarks: 12,
    percentage: 67,
  });
  const evalPass = evaluateMastery(strategicPass, undefined, undefined, 3);
  assert.equal(evalPass.masteryStatus, 'developing');
  assert.equal(evalPass.hasSufficientEvidence, true);
  assert.equal(evalPass.masteryScore, 67);
});

test('masteryEngine: negative marking clamps masteryScore safely to 0..100 range', () => {
  const negativeMarkingResult = createMockResult({
    correctCount: 0,
    incorrectCount: 3,
    unansweredCount: 0,
    rawMarks: -3,
    totalMarks: 12,
    percentage: -25,
  });
  const evalNeg = evaluateMastery(negativeMarkingResult, undefined, undefined, 3);
  assert.equal(evalNeg.masteryStatus, 'needs_reinforcement');
  assert.equal(evalNeg.hasSufficientEvidence, true);
  assert.equal(evalNeg.masteryScore, 0);
});

test('masteryEngine: rejects invalid or corrupted attempt payloads defensively', () => {
  const invalidResult = createMockResult({
    correctCount: -1,
    incorrectCount: 2,
    percentage: NaN,
  });
  const evalInvalid = evaluateMastery(invalidResult, undefined, undefined, 3);
  assert.equal(evalInvalid.masteryStatus, 'insufficient_evidence');
  assert.equal(evalInvalid.hasSufficientEvidence, false);
  assert.equal(evalInvalid.masteryScore, 0);
});

test('masteryEngine: canCheckpointBeCompleted validates checkpoint authoring and progress', () => {
  const completeCheckpoint = createMockCheckpoint();
  const emptyCheckpoint = createMockCheckpoint({ assessmentQuestions: [] });

  // Empty checkpoint can NEVER be completed, even without progress
  assert.equal(canCheckpointBeCompleted(emptyCheckpoint), false);

  // Complete checkpoint can be completed in principle
  assert.equal(canCheckpointBeCompleted(completeCheckpoint), true);

  // Complete checkpoint with strong progress is completed
  const strongProgress: CheckpointProgress = {
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    status: 'completed',
    currentStage: 'analysis',
    diagnosticCleared: true,
    revisionCompleted: true,
    masteryStatus: 'strong',
    masteryScore: 90,
    lastActivityAt: new Date().toISOString(),
    historicalAttemptsCount: 1,
  };
  assert.equal(canCheckpointBeCompleted(completeCheckpoint, strongProgress), true);

  // Complete checkpoint with needs_reinforcement progress is NOT completed
  const weakProgress: CheckpointProgress = {
    ...strongProgress,
    masteryStatus: 'needs_reinforcement',
    status: 'needs_reinforcement',
    masteryScore: 40,
  };
  assert.equal(canCheckpointBeCompleted(completeCheckpoint, weakProgress), false);

  // Complete checkpoint with insufficient evidence progress is NOT completed
  const pendingProgress: CheckpointProgress = {
    ...strongProgress,
    masteryStatus: 'insufficient_evidence',
    status: 'current',
    masteryScore: 0,
  };
  assert.equal(canCheckpointBeCompleted(completeCheckpoint, pendingProgress), false);

  // Empty checkpoint with fabricated 'completed' progress can NEVER be completed
  assert.equal(canCheckpointBeCompleted(emptyCheckpoint, strongProgress), false);
});
