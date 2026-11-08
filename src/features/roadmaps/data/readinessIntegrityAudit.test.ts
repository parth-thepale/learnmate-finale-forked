import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditCheckpointContent,
  auditCatalogueContent,
  assertCatalogueReportIntegrity,
  READINESS_THRESHOLDS,
} from './contentReadinessReport';
import { evaluateDiagnostic } from '../engine/diagnosticEngine';
import { isAssessmentPilotReady, canCheckpointBeCompleted } from '../engine/masteryEngine';
import {
  arePrerequisitesSatisfied,
  resolveCheckpointNodeStatus,
  hasSufficientCheckpointContent,
  getCheckpointLockReason,
} from '../engine/progressionEngine';
import { PHYSICS_CHECKPOINTS } from './checkpoints/physicsCheckpoints';
import { computeQuestionContentHash } from '../engine/contentGovernance';
import type {
  Checkpoint,
  AssessmentQuestion,
  ConceptCard,
  PracticeQuestion,
} from '../types/checkpoint.types';
import type { CheckpointProgress } from '../types/progress.types';

function createDummyConcept(id: string): ConceptCard {
  return {
    id,
    topicId: 'physics.units-measurements.dimensional-analysis',
    title: 'Core Kinematics & Dimensional Analysis',
    summary: 'Foundations of dimensions, SI units and 1D equations of motion.',
    commonPitfalls: ['Confusing average velocity with instantaneous speed'],
    keyFormulas: [
      { label: 'Velocity', formula: 'v = u + at', description: 'Uniform acceleration' },
    ],
  };
}

function createDummyQuestion(id: string, isVerified = false): AssessmentQuestion {
  const base: AssessmentQuestion = {
    id,
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    difficulty: 'medium',
    stem: `Assessment question ${id} stem for dimensional equations?`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correctOptionIndex: 0,
    explanation: 'Step-by-step rigorous derivation confirms option A.',
    isVerified,
  };

  if (isVerified) {
    return {
      ...base,
      reviewRecord: {
        reviewStatus: 'verified',
        reviewerId: 'sme-reviewer-01',
        reviewedAt: '2026-11-01T10:00:00.000Z',
        mathematicalCheckConfirmed: true,
        pedagogicalReviewConfirmed: true,
        contentVersion: computeQuestionContentHash(base),
        reviewNotes: 'Formally verified and checked by SME panel.',
      },
    };
  }

  return base;
}

function createMockCheckpointForTest(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'TEST-CP1',
    roadmapId: 'PHY-01',
    subject: 'physics',
    order: 1,
    title: 'Test Checkpoint',
    description: 'Test description',
    learningObjectives: ['Objective 1'],
    officialUnitNumbers: [1],
    officialChapterIds: ['ch1'],
    topicIds: ['topic-1', 'topic-2', 'topic-3'],
    prerequisiteIds: [],
    estimatedWorkloadMinutes: 45,
    concepts: [createDummyConcept('c1')],
    diagnosticQuestions: [
      { id: 'd1', topicId: 't1', prompt: 'D1?', options: ['A','B','C','D'], correctIndex: 0, explanation: 'Exp1' },
      { id: 'd2', topicId: 't1', prompt: 'D2?', options: ['A','B','C','D'], correctIndex: 1, explanation: 'Exp2' },
      { id: 'd3', topicId: 't2', prompt: 'D3?', options: ['A','B','C','D'], correctIndex: 2, explanation: 'Exp3' },
      { id: 'd4', topicId: 't2', prompt: 'D4?', options: ['A','B','C','D'], correctIndex: 3, explanation: 'Exp4' },
    ],
    activeRecallPrompts: [
      { id: 'r1', topicId: 't1', prompt: 'R1?', options: ['A','B','C','D'], correctIndex: 0, explanation: 'Exp1' },
      { id: 'r2', topicId: 't1', prompt: 'R2?', options: ['A','B','C','D'], correctIndex: 1, explanation: 'Exp2' },
      { id: 'r3', topicId: 't2', prompt: 'R3?', options: ['A','B','C','D'], correctIndex: 2, explanation: 'Exp3' },
    ],
    practiceQuestions: [],
    assessmentQuestions: [],
    ...overrides,
  };
}

// 1. One-question assessment is not pilot-ready.
test('readinessIntegrity: 1. One-question assessment is not pilot-ready', () => {
  assert.equal(isAssessmentPilotReady(1), false);
  assert.equal(isAssessmentPilotReady(4), false);

  const cpWith1 = createMockCheckpointForTest({
    assessmentQuestions: [createDummyQuestion('a1', true)],
  });

  const audit = auditCheckpointContent(cpWith1);
  assert.equal(audit.canStudentCompleteJourney, false);
  assert.notEqual(audit.readinessStatus, 'ready');
  assert.equal(audit.readinessStatus, 'internal_validation_only');
  assert.ok(audit.blockedOrUnavailableReason?.includes('< 5 required for pilot'));
});

// 2. Five unverified questions are not verified-ready.
test('readinessIntegrity: 2. Five unverified questions are not verified-ready', () => {
  const cpUnverified = createMockCheckpointForTest({
    assessmentQuestions: [
      createDummyQuestion('a1', false),
      createDummyQuestion('a2', false),
      createDummyQuestion('a3', false),
      createDummyQuestion('a4', false),
      createDummyQuestion('a5', false),
    ],
  });

  const audit = auditCheckpointContent(cpUnverified);
  // Five questions exist, but verified count is strictly zero
  assert.equal(audit.assessmentCount, 5);
  assert.equal(audit.verifiedQuestionsCount, 0);
  assert.equal(audit.pendingReviewQuestionsCount >= 5, true);
  // Must NOT be declared ready
  assert.notEqual(audit.readinessStatus, 'ready');
  assert.equal(audit.readinessStatus, 'internal_validation_only');
  assert.ok(audit.blockedOrUnavailableReason?.includes('pending formal expert review sign-off'));
});

// 3. Five reviewed questions can satisfy the configured assessment content threshold.
test('readinessIntegrity: 3. Five reviewed questions can satisfy the configured assessment content threshold', () => {
  assert.equal(isAssessmentPilotReady(5), true);
  assert.equal(isAssessmentPilotReady(8), true);

  const cpReady = createMockCheckpointForTest({
    assessmentQuestions: [
      createDummyQuestion('a1', true),
      createDummyQuestion('a2', true),
      createDummyQuestion('a3', true),
      createDummyQuestion('a4', true),
      createDummyQuestion('a5', true),
    ],
  });

  const audit = auditCheckpointContent(cpReady);
  assert.equal(audit.assessmentCount, 5);
  assert.equal(audit.verifiedQuestionsCount, 5);
  assert.equal(audit.readinessStatus, 'ready');
  assert.equal(audit.canStudentCompleteJourney, true);
});

// 4. Missing verification metadata remains pending review.
test('readinessIntegrity: 4. Missing verification metadata remains pending review', () => {
  // Questions with undefined or omitted isVerified
  const qWithoutMetadata: AssessmentQuestion = {
    id: 'a-no-meta',
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    difficulty: 'medium',
    stem: 'Prompt without isVerified?',
    options: ['A', 'B', 'C', 'D'],
    correctOptionIndex: 0,
    explanation: 'Derivation',
  };

  const cp = createMockCheckpointForTest({
    assessmentQuestions: [qWithoutMetadata],
  });

  const audit = auditCheckpointContent(cp);
  assert.equal(audit.questionBreakdown?.assessment.verified, 0);
  assert.equal(audit.questionBreakdown?.assessment.pendingReview, 1);
  assert.equal(audit.verifiedQuestionsCount, 0);
  assert.equal(audit.pendingReviewQuestionsCount, 4 + 3 + 1); // 4 diag + 3 recall + 1 ass
});

// 5. Verified counts are calculated independently by content type.
test('readinessIntegrity: 5. Verified counts are calculated independently by content type', () => {
  const p1: PracticeQuestion = {
    id: 'p1',
    tier: 'foundation',
    type: 'mcq',
    topicId: 't1',
    stem: 'P1?',
    options: ['A', 'B', 'C', 'D'],
    correctOptionIndex: 0,
    hint: 'Hint',
    explanation: 'Exp',
    provenance: 'learnmate_curated',
    isVerified: true,
  };
  const p2: PracticeQuestion = {
    id: 'p2',
    tier: 'foundation',
    type: 'mcq',
    topicId: 't1',
    stem: 'P2?',
    options: ['A', 'B', 'C', 'D'],
    correctOptionIndex: 0,
    hint: 'Hint',
    explanation: 'Exp',
    provenance: 'learnmate_curated',
    isVerified: false,
  };

  const cp = createMockCheckpointForTest({
    practiceQuestions: [p1, p2],
    assessmentQuestions: [
      createDummyQuestion('a1', true),
      createDummyQuestion('a2', false),
    ],
  });

  const audit = auditCheckpointContent(cp);
  assert.ok(audit.questionBreakdown);

  // Diagnostic (RecallPrompt schema - unreviewed schema without sign-off) -> 0 verified, 4 pending
  assert.equal(audit.questionBreakdown.diagnostic.verified, 0);
  assert.equal(audit.questionBreakdown.diagnostic.pendingReview, 4);

  // Active recall (RecallPrompt schema) -> 0 verified, 3 pending
  assert.equal(audit.questionBreakdown.recall.verified, 0);
  assert.equal(audit.questionBreakdown.recall.pendingReview, 3);

  // Practice -> 1 verified, 1 pending
  assert.equal(audit.questionBreakdown.practice.verified, 1);
  assert.equal(audit.questionBreakdown.practice.pendingReview, 1);

  // Assessment -> 1 verified, 1 pending
  assert.equal(audit.questionBreakdown.assessment.verified, 1);
  assert.equal(audit.questionBreakdown.assessment.pendingReview, 1);

  // Total verified = 0 + 0 + 1 + 1 = 2
  assert.equal(audit.verifiedQuestionsCount, 2);
  // Total pending = 4 + 3 + 1 + 1 = 9
  assert.equal(audit.pendingReviewQuestionsCount, 9);
});

// 6. Empty assessment remains unavailable.
test('readinessIntegrity: 6. Empty assessment remains unavailable', () => {
  const cpWithoutAssessment = createMockCheckpointForTest({
    assessmentQuestions: [],
  });

  assert.equal(hasSufficientCheckpointContent(cpWithoutAssessment), false);
  const status = resolveCheckpointNodeStatus(cpWithoutAssessment, undefined, {});
  assert.equal(status, 'content_unavailable');

  const lockReason = getCheckpointLockReason(cpWithoutAssessment, {});
  assert.ok(lockReason);
  assert.equal(lockReason?.status, 'content_unavailable');
  assert.ok(lockReason?.missingContentReasons.includes('Assessment questions pending authoring'));
});

// 7. Recall with fewer than three prompts remains unavailable.
test('readinessIntegrity: 7. Recall with fewer than three prompts remains unavailable for pilot readiness', () => {
  const cpUnderRecall = createMockCheckpointForTest({
    activeRecallPrompts: [
      { id: 'r1', topicId: 't1', prompt: 'R1?', options: ['A','B','C','D'], correctIndex: 0, explanation: 'Exp1' },
      { id: 'r2', topicId: 't1', prompt: 'R2?', options: ['A','B','C','D'], correctIndex: 1, explanation: 'Exp2' },
    ],
    assessmentQuestions: [
      createDummyQuestion('a1', true),
      createDummyQuestion('a2', true),
      createDummyQuestion('a3', true),
      createDummyQuestion('a4', true),
      createDummyQuestion('a5', true),
    ],
  });

  const audit = auditCheckpointContent(cpUnderRecall);
  assert.equal(audit.recallCount, 2);
  // Must NOT be pilot ready because recall prompts < 3
  assert.notEqual(audit.readinessStatus, 'ready');
  assert.equal(audit.readinessStatus, 'internal_validation_only');
  assert.ok(audit.blockedOrUnavailableReason?.includes('Active recall has 2 prompts (< 3 required)'));
});

// 8. Diagnostic with fewer than four questions remains unavailable.
test('readinessIntegrity: 8. Diagnostic with fewer than four questions cannot permit intro skipping', () => {
  const diagResult = evaluateDiagnostic({
    totalQuestions: 3,
    correctCount: 3,
    timeTakenSeconds: 120,
    questionTopicMap: [
      { topicId: 'topic-1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 'topic-1', topicName: 'Topic 1', isCorrect: true },
      { topicId: 'topic-1', topicName: 'Topic 1', isCorrect: true },
    ],
  });

  // 100% score but with only 3 questions -> canSkipIntroRevision must strictly be false
  assert.equal(diagResult.score.percentage, 100);
  assert.equal(diagResult.canSkipIntroRevision, false);

  const cpUnderDiag = createMockCheckpointForTest({
    diagnosticQuestions: [
      { id: 'd1', topicId: 't1', prompt: 'D1?', options: ['A','B','C','D'], correctIndex: 0, explanation: 'Exp1' },
      { id: 'd2', topicId: 't1', prompt: 'D2?', options: ['A','B','C','D'], correctIndex: 1, explanation: 'Exp2' },
      { id: 'd3', topicId: 't2', prompt: 'D3?', options: ['A','B','C','D'], correctIndex: 2, explanation: 'Exp3' },
    ],
    assessmentQuestions: [
      createDummyQuestion('a1', true),
      createDummyQuestion('a2', true),
      createDummyQuestion('a3', true),
      createDummyQuestion('a4', true),
      createDummyQuestion('a5', true),
    ],
  });

  const audit = auditCheckpointContent(cpUnderDiag);
  assert.notEqual(audit.readinessStatus, 'ready');
  assert.equal(audit.readinessStatus, 'internal_validation_only');
  assert.ok(audit.blockedOrUnavailableReason?.includes('Diagnostic has 3 questions (< 4 required)'));
});

// 9. Revision content cannot award assessment mastery.
test('readinessIntegrity: 9. Revision content cannot award assessment mastery', () => {
  const cp = createMockCheckpointForTest({
    assessmentQuestions: [createDummyQuestion('a1', true)],
  });

  const progressWithRevisionOnly: CheckpointProgress = {
    checkpointId: cp.id,
    roadmapId: 'PHY-01',
    status: 'current',
    currentStage: 'revision',
    diagnosticCleared: false,
    revisionCompleted: true, // User completed revision
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: new Date().toISOString(),
    historicalAttemptsCount: 0,
  };

  // Revision completion must NOT award mastery score
  assert.equal(progressWithRevisionOnly.masteryScore, 0);
  assert.equal(progressWithRevisionOnly.masteryStatus, 'unattempted');

  // Milestone completion evaluation must fail without assessment mastery >= 60
  assert.equal(canCheckpointBeCompleted(cp, progressWithRevisionOnly), false);
});

// 10. Diagnostic clearance cannot unlock downstream mastery.
test('readinessIntegrity: 10. Diagnostic clearance cannot unlock downstream mastery', () => {
  const downstreamCp = createMockCheckpointForTest({
    id: 'DOWNSTREAM-CP2',
    order: 2,
    prerequisiteIds: ['PREREQ-CP1'],
  });

  // Prerequisite with 100% diagnostic score and clearance, but zero assessment mastery
  const diagClearedProgress: CheckpointProgress = {
    checkpointId: 'PREREQ-CP1',
    roadmapId: 'PHY-01',
    status: 'current',
    currentStage: 'practice',
    diagnosticCleared: true,
    diagnosticScore: {
      correct: 4,
      total: 4,
      percentage: 100,
      completedAt: new Date().toISOString(),
    },
    revisionCompleted: false,
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: new Date().toISOString(),
    historicalAttemptsCount: 0,
  };

  const progressMap: Record<string, CheckpointProgress> = {
    'PREREQ-CP1': diagClearedProgress,
  };

  // Diagnostic clearance skips intro revision but strictly does NOT unlock downstream checkpoints
  assert.equal(arePrerequisitesSatisfied(downstreamCp, progressMap), false);
  assert.equal(resolveCheckpointNodeStatus(downstreamCp, undefined, progressMap), 'locked');
});

// 11. Prerequisite checks require genuine mastery.
test('readinessIntegrity: 11. Prerequisite checks require genuine mastery', () => {
  const cp2 = createMockCheckpointForTest({
    id: 'CP-2',
    order: 2,
    prerequisiteIds: ['CP-1'],
  });

  // 1. Arbitrary status: 'completed' with insufficient_evidence rejected
  const fakeCompletedMap: Record<string, CheckpointProgress> = {
    'CP-1': {
      checkpointId: 'CP-1',
      roadmapId: 'PHY-01',
      status: 'completed',
      currentStage: 'assessment',
      diagnosticCleared: false,
      revisionCompleted: false,
      masteryStatus: 'insufficient_evidence',
      masteryScore: 0,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: 1,
    },
  };
  assert.equal(arePrerequisitesSatisfied(cp2, fakeCompletedMap), false);

  // 2. Needs reinforcement (score 45 < 60) rejected
  const weakMap: Record<string, CheckpointProgress> = {
    'CP-1': {
      checkpointId: 'CP-1',
      roadmapId: 'PHY-01',
      status: 'needs_reinforcement',
      currentStage: 'assessment',
      diagnosticCleared: false,
      revisionCompleted: false,
      masteryStatus: 'needs_reinforcement',
      masteryScore: 45,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: 1,
    },
  };
  assert.equal(arePrerequisitesSatisfied(cp2, weakMap), false);

  // 3. Genuine developing mastery (score 65 >= 60) accepted
  const developingMap: Record<string, CheckpointProgress> = {
    'CP-1': {
      checkpointId: 'CP-1',
      roadmapId: 'PHY-01',
      status: 'completed',
      currentStage: 'assessment',
      diagnosticCleared: false,
      revisionCompleted: false,
      masteryStatus: 'developing',
      masteryScore: 65,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: 1,
    },
  };
  assert.equal(arePrerequisitesSatisfied(cp2, developingMap), true);

  // 4. Genuine strong mastery (score 90 >= 60) accepted
  const strongMap: Record<string, CheckpointProgress> = {
    'CP-1': {
      checkpointId: 'CP-1',
      roadmapId: 'PHY-01',
      status: 'completed',
      currentStage: 'assessment',
      diagnosticCleared: false,
      revisionCompleted: false,
      masteryStatus: 'strong',
      masteryScore: 90,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: 1,
    },
  };
  assert.equal(arePrerequisitesSatisfied(cp2, strongMap), true);
});

// 12. PHY-01 answer distribution is calculated from the actual data.
test('readinessIntegrity: 12. PHY-01 answer distribution is calculated from the actual data', () => {
  const phy01 = PHYSICS_CHECKPOINTS.filter((c) => c.roadmapId === 'PHY-01');
  assert.equal(phy01.length, 4);

  const optionCounts = [0, 0, 0, 0];
  let totalItemsCount = 0;

  for (const cp of phy01) {
    for (const q of cp.diagnosticQuestions) {
      assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
      optionCounts[q.correctIndex]++;
      totalItemsCount++;
    }
    for (const q of cp.activeRecallPrompts) {
      if (q.options && q.correctIndex !== undefined) {
        assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
        optionCounts[q.correctIndex]++;
        totalItemsCount++;
      }
    }
    for (const q of cp.assessmentQuestions) {
      if (q.correctOptionIndex !== undefined) {
        assert.ok(q.correctOptionIndex >= 0 && q.correctOptionIndex <= 3);
        optionCounts[q.correctOptionIndex]++;
        totalItemsCount++;
      }
    }
  }

  // Exact 22 items
  assert.equal(totalItemsCount, 22);

  // Exact rebalanced distribution: [6, 5, 6, 5]
  assert.deepEqual(optionCounts, [6, 5, 6, 5]);

  // Max proportion is 6/22 (27.3%), Min proportion is 5/22 (22.7%)
  for (let i = 0; i < 4; i++) {
    const pct = (optionCounts[i] / totalItemsCount) * 100;
    assert.ok(pct >= 20 && pct <= 35, `Option ${i} proportion ${pct}% is within [20%, 35%]`);
  }
});

// 13. PHY-01 dimensional correctness and unique correct answer for Q5.
test('readinessIntegrity: 13. PHY-01 dimensional correctness and unique correct answer for Q5', () => {
  const cp1 = PHYSICS_CHECKPOINTS.find((c) => c.id === 'PHY-01-CP1')!;
  assert.ok(cp1);

  const q5 = cp1.diagnosticQuestions.find((q) => q.id === 'diag-phy-01-cp1-q5');
  assert.ok(q5, 'Q5 must exist in PHY-01-CP1 diagnosticQuestions');

  assert.equal(
    q5.prompt,
    'Which of the following pairs of physical quantities share the exact same dimensional formula?'
  );

  assert.deepEqual(q5.options, [
    'Torque and Work',
    'Stress and Strain',
    'Force and Impulse',
    'Angular momentum and linear momentum',
  ]);

  // Option 0: Torque [M L^2 T^-2] and Work [M L^2 T^-2] -> EXACT SAME
  // Option 1: Stress [M L^-1 T^-2] and Strain [M^0 L^0 T^0] -> DIFFERENT
  // Option 2: Force [M L T^-2] and Impulse [M L T^-1] -> DIFFERENT
  // Option 3: Angular momentum [M L^2 T^-1] and Linear momentum [M L T^-1] -> DIFFERENT
  assert.equal(q5.correctIndex, 0);

  // Verify explanation details all 4 options and proves uniqueness of option 0
  assert.ok(q5.explanation.includes('[M L^2 T^{-2}]'));
  assert.ok(q5.explanation.includes('Stress has [M L^{-1} T^{-2}] while strain is dimensionless'));
  assert.ok(q5.explanation.includes('Force is [M L T^{-2}] while impulse is [M L T^{-1}]'));
  assert.ok(q5.explanation.includes('Angular momentum is [M L^2 T^{-1}] while linear momentum is [M L T^{-1}]'));
});

// Extra: Catalogue report assertions must hold across entire 48 checkpoints
test('readinessIntegrity: assertCatalogueReportIntegrity passes without assertions failing', () => {
  const report = auditCatalogueContent();
  assert.doesNotThrow(() => assertCatalogueReportIntegrity(report));
});
