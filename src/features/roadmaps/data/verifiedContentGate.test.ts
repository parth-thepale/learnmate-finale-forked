import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuestionFormallyVerified,
  getVerifiedAssessmentQuestions,
  getVerifiedPracticeQuestions,
  isCheckpointLearnerReady,
  computeQuestionContentHash,
} from '../engine/contentGovernance';
import {
  evaluateMastery,
  canCheckpointBeCompleted,
  isAssessmentPilotReady,
} from '../engine/masteryEngine';
import {
  arePrerequisitesSatisfied,
  resolveCheckpointNodeStatus,
  hasSufficientCheckpointContent,
  getCheckpointLockReason,
} from '../engine/progressionEngine';
import { RoadmapProgressService } from '../services/roadmapProgressService';
import { MemoryStorage } from '../../../services/testDoubles';
import {
  STORAGE_KEYS,
  scopeForUid,
  scopedKey,
} from '../../../services/localScope';
import type {
  AssessmentQuestion,
  Checkpoint,
  ContentReviewRecord,
  PracticeQuestion,
} from '../types/checkpoint.types';
import type {
  AssessmentAttemptResult,
  CheckpointProgress,
} from '../types/progress.types';

function createValidReviewRecord(overrides: Partial<ContentReviewRecord> = {}): ContentReviewRecord {
  return {
    reviewStatus: 'verified',
    reviewerId: 'sme-phys-dr-sharma',
    reviewedAt: '2026-11-01T12:00:00.000Z',
    reviewNotes: 'Formally verified: Dimensional homogeneity and numerical keys verified against JEE standards.',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    contentVersion: '1.0.0',
    ...overrides,
  };
}

function createTestQuestion(id: string, reviewRecord?: ContentReviewRecord, isVerified?: boolean): AssessmentQuestion {
  const base: AssessmentQuestion = {
    id,
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    topicLabel: 'Dimensional Analysis',
    difficulty: 'medium',
    stem: `Test stem for question ${id}`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correctOptionIndex: 0,
    explanation: 'Step-by-step verified derivation confirms option A.',
    isVerified: isVerified ?? (reviewRecord?.reviewStatus === 'verified'),
  };

  if (reviewRecord) {
    const finalRecord: ContentReviewRecord = {
      ...reviewRecord,
      contentVersion:
        reviewRecord.contentVersion === '1.0.0'
          ? computeQuestionContentHash(base)
          : reviewRecord.contentVersion,
    };
    return {
      ...base,
      reviewRecord: finalRecord,
    };
  }

  return base;
}

function createTestCheckpoint(
  id: string,
  assessmentQuestions: AssessmentQuestion[],
  overrides: Partial<Checkpoint> = {}
): Checkpoint {
  return {
    id,
    roadmapId: 'PHY-01',
    subject: 'physics',
    order: 1,
    title: `Checkpoint ${id}`,
    description: `Description for ${id}`,
    learningObjectives: ['Master dimensional formulas'],
    officialUnitNumbers: [1],
    officialChapterIds: ['physics.units-and-measurements'],
    topicIds: ['physics.units-measurements.dimensional-analysis'],
    prerequisiteIds: [],
    estimatedWorkloadMinutes: 45,
    concepts: [
      {
        id: `concept-${id}`,
        topicId: 'physics.units-measurements.dimensional-analysis',
        title: 'Dimensional Analysis',
        summary: 'Dimensions and SI units',
        keyFormulas: [{ label: 'Dimensional Formula of Force', formula: '[M L T^-2]' }],
      },
    ],
    diagnosticQuestions: [
      { id: `d1-${id}`, topicId: 't1', prompt: 'P1', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Exp1' },
      { id: `d2-${id}`, topicId: 't1', prompt: 'P2', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'Exp2' },
      { id: `d3-${id}`, topicId: 't1', prompt: 'P3', options: ['A', 'B', 'C', 'D'], correctIndex: 2, explanation: 'Exp3' },
      { id: `d4-${id}`, topicId: 't1', prompt: 'P4', options: ['A', 'B', 'C', 'D'], correctIndex: 3, explanation: 'Exp4' },
    ],
    activeRecallPrompts: [
      { id: `r1-${id}`, topicId: 't1', prompt: 'R1', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Exp1' },
      { id: `r2-${id}`, topicId: 't1', prompt: 'R2', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'Exp2' },
      { id: `r3-${id}`, topicId: 't1', prompt: 'R3', options: ['A', 'B', 'C', 'D'], correctIndex: 2, explanation: 'Exp3' },
    ],
    practiceQuestions: [],
    assessmentQuestions,
    ...overrides,
  };
}

// 1. Unverified question cannot award mastery
test('verifiedContentGate: 1. Unverified question cannot award mastery', () => {
  const storage = new MemoryStorage();
  const unverifiedQuestions = [
    createTestQuestion('uv1', undefined, false),
    createTestQuestion('uv2', undefined, false),
    createTestQuestion('uv3', undefined, false),
  ];
  const cp = createTestCheckpoint('CP-UNVERIFIED', unverifiedQuestions);

  const attemptResult: AssessmentAttemptResult = {
    attemptId: 'att-uv-1',
    score: 100,
    totalMarks: 12,
    rawMarks: 12,
    percentage: 100,
    correctCount: 3,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 180,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: ['physics.units-measurements.dimensional-analysis'],
    mode: 'learner',
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    cp.id,
    cp.roadmapId,
    attemptResult,
    'learner1',
    storage,
    cp
  );

  // Fails closed: unverified content cannot award mastery or milestone completion
  assert.equal(outcome.updatedProgress.masteryStatus, 'insufficient_evidence');
  assert.equal(outcome.updatedProgress.masteryScore, 0);
  assert.notEqual(outcome.updatedProgress.status, 'completed');
  assert.equal(outcome.scheduledRevisions.length, 0);
});

// 2. Missing verification metadata cannot award mastery
test('verifiedContentGate: 2. Missing verification metadata cannot award mastery', () => {
  const storage = new MemoryStorage();
  const questionWithoutMeta: AssessmentQuestion = {
    id: 'no-meta-1',
    type: 'mcq',
    topicId: 'physics.units-measurements.dimensional-analysis',
    difficulty: 'medium',
    stem: 'Question with no metadata whatsoever',
    options: ['A', 'B', 'C', 'D'],
    correctOptionIndex: 0,
    explanation: 'Explanation',
  };
  const cp = createTestCheckpoint('CP-NO-META', [questionWithoutMeta]);

  assert.equal(isQuestionFormallyVerified(questionWithoutMeta), false);

  const attemptResult: AssessmentAttemptResult = {
    attemptId: 'att-no-meta',
    score: 100,
    totalMarks: 4,
    rawMarks: 4,
    percentage: 100,
    correctCount: 1,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 60,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: [],
    mode: 'learner',
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    cp.id,
    cp.roadmapId,
    attemptResult,
    'learner2',
    storage,
    cp
  );

  assert.equal(outcome.updatedProgress.masteryStatus, 'insufficient_evidence');
  assert.equal(outcome.updatedProgress.masteryScore, 0);
  assert.notEqual(outcome.updatedProgress.status, 'completed');
});

// 3. Formally verified question with valid review record can be scored
test('verifiedContentGate: 3. Formally verified question with valid review record can be scored', () => {
  const storage = new MemoryStorage();
  const verifiedQuestions = [
    createTestQuestion('v1', createValidReviewRecord()),
    createTestQuestion('v2', createValidReviewRecord()),
    createTestQuestion('v3', createValidReviewRecord()),
  ];
  const cp = createTestCheckpoint('CP-VERIFIED', verifiedQuestions);

  assert.equal(getVerifiedAssessmentQuestions(cp).length, 3);
  assert.equal(isCheckpointLearnerReady(cp), true);

  const attemptResult: AssessmentAttemptResult = {
    attemptId: 'att-verified-1',
    score: 100,
    totalMarks: 12,
    rawMarks: 12,
    percentage: 100,
    correctCount: 3,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 200,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: ['physics.units-measurements.dimensional-analysis'],
    mode: 'learner',
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    cp.id,
    cp.roadmapId,
    attemptResult,
    'learner3',
    storage,
    cp
  );

  assert.equal(outcome.updatedProgress.masteryStatus, 'strong');
  assert.equal(outcome.updatedProgress.masteryScore, 100);
  assert.equal(outcome.updatedProgress.status, 'completed');
  assert.equal(outcome.scheduledRevisions.length, 1); // Retention check
});

// 4. Internal validation attempt cannot update learner mastery
test('verifiedContentGate: 4. Internal validation attempt cannot update learner mastery', () => {
  const storage = new MemoryStorage();
  const draftQuestions = [
    createTestQuestion('d1', undefined, false),
    createTestQuestion('d2', undefined, false),
  ];
  const cp = createTestCheckpoint('CP-INTERNAL', draftQuestions);

  const internalAttempt: AssessmentAttemptResult = {
    attemptId: 'att-internal-1',
    score: 100,
    totalMarks: 8,
    rawMarks: 8,
    percentage: 100,
    correctCount: 2,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 100,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: ['physics.units-measurements.dimensional-analysis'],
    mode: 'internal_validation',
    isInternalValidation: true,
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    cp.id,
    cp.roadmapId,
    internalAttempt,
    'tester1',
    storage,
    cp
  );

  // Internal attempts do not touch mastery score, mastery status, or completed status
  assert.equal(outcome.updatedProgress.masteryStatus, 'unattempted');
  assert.equal(outcome.updatedProgress.masteryScore, 0);
  assert.notEqual(outcome.updatedProgress.status, 'completed');
  assert.equal(outcome.scheduledRevisions.length, 0);
  assert.ok(outcome.updatedProgress.lastInternalValidationAttempt);
  assert.equal(outcome.updatedProgress.lastInternalValidationAttempt.attemptId, 'att-internal-1');
});

// 5. Internal validation attempt cannot unlock downstream checkpoint
test('verifiedContentGate: 5. Internal validation attempt cannot unlock downstream checkpoint', () => {
  const storage = new MemoryStorage();
  const cp1 = createTestCheckpoint('CP-GATE-1', [createTestQuestion('d1', undefined, false)]);
  const cp2 = createTestCheckpoint('CP-GATE-2', [createTestQuestion('d2', undefined, false)], {
    order: 2,
    prerequisiteIds: ['CP-GATE-1'],
  });

  const internalAttempt: AssessmentAttemptResult = {
    attemptId: 'att-gate-internal',
    score: 100,
    totalMarks: 4,
    rawMarks: 4,
    percentage: 100,
    correctCount: 1,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 60,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: [],
    mode: 'internal_validation',
    isInternalValidation: true,
  };

  const outcome1 = RoadmapProgressService.recordAssessmentAttempt(
    cp1.id,
    cp1.roadmapId,
    internalAttempt,
    'tester2',
    storage,
    cp1
  );

  const progressMap = {
    [cp1.id]: outcome1.updatedProgress,
  };

  // Downstream prerequisite check MUST fail
  assert.equal(arePrerequisitesSatisfied(cp2, progressMap), false);
  const lockReason = getCheckpointLockReason(cp2, progressMap);
  assert.ok(lockReason);
  assert.equal(lockReason?.isLocked, true);
  assert.ok(lockReason?.description.includes('requires demonstrated mastery'));
  assert.equal(resolveCheckpointNodeStatus(cp2, undefined, progressMap), 'locked');
});

// 6. Empty verified pool produces content_unavailable
test('verifiedContentGate: 6. Empty verified pool produces content_unavailable in learner mode', () => {
  const cpUnverified = createTestCheckpoint('CP-UNVERIFIED-POOL', [
    createTestQuestion('u1', undefined, false),
  ]);

  // In learner mode, content is unavailable for scored progression
  assert.equal(hasSufficientCheckpointContent(cpUnverified, 'learner'), false);
  const lockReason = getCheckpointLockReason(cpUnverified, {}, 'learner');
  assert.ok(lockReason);
  assert.equal(lockReason?.status, 'content_unavailable');
  assert.ok(lockReason?.description.includes('undergoing formal SME verification'));
  assert.equal(getVerifiedAssessmentQuestions(cpUnverified).length, 0);
  assert.equal(isCheckpointLearnerReady(cpUnverified), false);
});

// 7. Mixed pool selects only verified questions in learner mode
test('verifiedContentGate: 7. Mixed pool selects only verified questions in learner mode', () => {
  const mixedQuestions: AssessmentQuestion[] = [
    createTestQuestion('mixed-v1', createValidReviewRecord()),
    createTestQuestion('mixed-uv1', undefined, false),
    createTestQuestion('mixed-v2', createValidReviewRecord()),
    createTestQuestion('mixed-uv2', undefined, false),
  ];
  const cp = createTestCheckpoint('CP-MIXED', mixedQuestions);

  const verified = getVerifiedAssessmentQuestions(cp);
  assert.equal(verified.length, 2);
  assert.deepEqual(
    verified.map((q) => q.id),
    ['mixed-v1', 'mixed-v2']
  );
});

// 8. Incomplete review record fails closed
test('verifiedContentGate: 8. Incomplete review record fails closed', () => {
  // Case A: Bare boolean without reviewRecord
  const qBareBoolean = createTestQuestion('q-bare', undefined, true);
  assert.equal(isQuestionFormallyVerified(qBareBoolean), false);

  // Case B: Mathematical check unconfirmed
  const qMathFalse = createTestQuestion(
    'q-math-false',
    createValidReviewRecord({ mathematicalCheckConfirmed: false })
  );
  assert.equal(isQuestionFormallyVerified(qMathFalse), false);

  // Case C: Pedagogical review unconfirmed
  const qPedFalse = createTestQuestion(
    'q-ped-false',
    createValidReviewRecord({ pedagogicalReviewConfirmed: false })
  );
  assert.equal(isQuestionFormallyVerified(qPedFalse), false);

  // Case D: Empty reviewerId
  const qNoReviewer = createTestQuestion(
    'q-no-rev',
    createValidReviewRecord({ reviewerId: '   ' })
  );
  assert.equal(isQuestionFormallyVerified(qNoReviewer), false);

  // Case E: Invalid date
  const qInvalidDate = createTestQuestion(
    'q-bad-date',
    createValidReviewRecord({ reviewedAt: 'not-a-valid-date' })
  );
  assert.equal(isQuestionFormallyVerified(qInvalidDate), false);

  // Case F: Empty contentVersion
  const qNoVersion = createTestQuestion(
    'q-no-version',
    createValidReviewRecord({ contentVersion: '' })
  );
  assert.equal(isQuestionFormallyVerified(qNoVersion), false);

  // Case G: Status pending_review or draft
  const qPending = createTestQuestion(
    'q-pending',
    createValidReviewRecord({ reviewStatus: 'pending_review' })
  );
  assert.equal(isQuestionFormallyVerified(qPending), false);
});

// 9. Normal progression with < 5 verified questions works if contract permits
test('verifiedContentGate: 9. Normal progression with < 5 verified questions works if contract permits', () => {
  const storage = new MemoryStorage();
  const threeVerifiedQuestions = [
    createTestQuestion('t1', createValidReviewRecord()),
    createTestQuestion('t2', createValidReviewRecord()),
    createTestQuestion('t3', createValidReviewRecord()),
  ];
  const cp = createTestCheckpoint('CP-3Q', threeVerifiedQuestions);

  // 3 questions is < 5 (not pilot ready overall), but legitimate for this checkpoint's authoring
  assert.equal(isAssessmentPilotReady(cp), false);

  const attemptResult: AssessmentAttemptResult = {
    attemptId: 'att-3q',
    score: 100,
    totalMarks: 12,
    rawMarks: 12,
    percentage: 100,
    correctCount: 3,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 150,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: ['physics.units-measurements.dimensional-analysis'],
    mode: 'learner',
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    cp.id,
    cp.roadmapId,
    attemptResult,
    'learner4',
    storage,
    cp
  );

  assert.equal(outcome.updatedProgress.masteryStatus, 'strong');
  assert.equal(outcome.updatedProgress.masteryScore, 100);
  assert.equal(outcome.updatedProgress.status, 'completed');
});

// 10. Diagnostic/revision/recall cannot award assessment mastery
test('verifiedContentGate: 10. Diagnostic/revision/recall cannot award assessment mastery', () => {
  const cp = createTestCheckpoint('CP-STAGES', [createTestQuestion('v1', createValidReviewRecord())]);

  const progressWithOnlyDiagnostic: CheckpointProgress = {
    checkpointId: cp.id,
    roadmapId: cp.roadmapId,
    status: 'current',
    currentStage: 'revision',
    diagnosticCleared: true,
    diagnosticScore: { correct: 4, total: 4, percentage: 100, completedAt: new Date().toISOString() },
    revisionCompleted: true,
    activeRecallScore: { correct: 3, total: 3, percentage: 100, completedAt: new Date().toISOString() },
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: new Date().toISOString(),
    historicalAttemptsCount: 0,
  };

  // 1. Mastery evaluator returns unattempted when assessment result is undefined
  const masteryOutcome = evaluateMastery(undefined, undefined, progressWithOnlyDiagnostic.activeRecallScore, 1);
  assert.equal(masteryOutcome.masteryStatus, 'unattempted');
  assert.equal(masteryOutcome.masteryScore, 0);

  // 2. canCheckpointBeCompleted returns false without assessment mastery
  assert.equal(canCheckpointBeCompleted(cp, progressWithOnlyDiagnostic), false);

  // 3. arePrerequisitesSatisfied returns false
  const downstreamCp = createTestCheckpoint('CP-DOWNSTREAM', [], {
    order: 2,
    prerequisiteIds: [cp.id],
  });
  assert.equal(arePrerequisitesSatisfied(downstreamCp, { [cp.id]: progressWithOnlyDiagnostic }), false);
});

// 11. Revision queue/analytics ignores internal validation attempts
test('verifiedContentGate: 11. Revision queue/analytics ignores internal validation attempts', () => {
  const storage = new MemoryStorage();
  const cp = createTestCheckpoint('CP-QUEUE-TEST', [createTestQuestion('d1', undefined, false)]);

  const failedInternalAttempt: AssessmentAttemptResult = {
    attemptId: 'att-internal-fail',
    score: 0,
    totalMarks: 4,
    rawMarks: -1,
    percentage: 0,
    correctCount: 0,
    incorrectCount: 1,
    unansweredCount: 0,
    timeTakenSeconds: 30,
    completedAt: new Date().toISOString(),
    weakTopics: ['physics.units-measurements.dimensional-analysis'],
    strongTopics: [],
    mode: 'internal_validation',
    isInternalValidation: true,
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    cp.id,
    cp.roadmapId,
    failedInternalAttempt,
    'tester_analytics',
    storage,
    cp
  );

  // 1. Returned scheduledRevisions must be strictly empty
  assert.equal(outcome.scheduledRevisions.length, 0);

  // 2. Storage queue must remain empty
  const queue = RoadmapProgressService.getRevisionQueue('tester_analytics', storage);
  assert.equal(queue.length, 0);
});

// 12. Guest/local/cloud persistence intact
test('verifiedContentGate: 12. Guest/local/cloud persistence intact', () => {
  const storage = new MemoryStorage();
  const cp = createTestCheckpoint('CP-PERSIST', [createTestQuestion('v1', createValidReviewRecord())]);

  // Guest attempt
  const guestAttempt: AssessmentAttemptResult = {
    attemptId: 'att-guest',
    score: 100,
    totalMarks: 4,
    rawMarks: 4,
    percentage: 100,
    correctCount: 1,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 50,
    completedAt: new Date().toISOString(),
    weakTopics: [],
    strongTopics: ['physics.units-measurements.dimensional-analysis'],
    mode: 'learner',
  };

  RoadmapProgressService.recordAssessmentAttempt(
    cp.id,
    cp.roadmapId,
    guestAttempt,
    null, // guest
    storage,
    cp
  );

  // Guest progress stored in guest scope
  const guestKey = scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS);
  const guestData = storage.getItem(guestKey);
  assert.ok(guestData);
  const parsedGuest = JSON.parse(guestData);
  assert.equal(parsedGuest['PHY-01'].checkpoints[cp.id].masteryStatus, 'strong');

  // Authenticated user scope remains completely separate and untouched
  const aliceKey = scopedKey('u_alice', STORAGE_KEYS.ROADMAP_PROGRESS);
  assert.equal(storage.getItem(aliceKey), null);
});
