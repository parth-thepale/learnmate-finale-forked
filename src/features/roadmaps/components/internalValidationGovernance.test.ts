import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PerformanceAnalysisView } from './PerformanceAnalysisView';
import { CheckpointDetailPanel } from './CheckpointDetailPanel';
import { AssessmentView } from './AssessmentView';
import {
  computeSha256Hex,
  canonicalizeQuestionForHashing,
  computeQuestionContentDigest,
  computeQuestionContentHash,
  isValidReviewerIdFormat,
  isValidReviewerId,
  isReviewRecordStructurallyValid,
  isQuestionContentIntegrityIntact,
  isProductionEnvironment,
  isInternalPreviewPermitted,
  isQuestionFormallyVerified,
  getVerifiedAssessmentQuestions,
} from '../engine/contentGovernance';
import { mergeCheckpointProgress } from '../services/roadmapSyncService';
import type {
  AssessmentQuestion,
  Checkpoint,
  ContentReviewRecord,
} from '../types/checkpoint.types';
import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
} from '../types/progress.types';

function createDummyCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    subject: 'physics',
    order: 1,
    title: 'Units and Dimensions',
    description: 'Dimensional analysis fundamentals',
    learningObjectives: ['Verify dimensions'],
    officialUnitNumbers: [1],
    officialChapterIds: ['physics.units'],
    topicIds: ['physics.units.dim'],
    prerequisiteIds: [],
    estimatedWorkloadMinutes: 45,
    concepts: [],
    diagnosticQuestions: [],
    activeRecallPrompts: [],
    practiceQuestions: [],
    assessmentQuestions: [],
    ...overrides,
  };
}

function createDummyQuestion(id: string, overrides: Partial<AssessmentQuestion> = {}): AssessmentQuestion {
  return {
    id,
    type: 'mcq',
    topicId: 'physics.units.dim',
    topicLabel: 'Dimensional Formulas',
    difficulty: 'medium',
    stem: `Identify the dimensional formula for physical quantity ${id}`,
    options: ['[M L T^-2]', '[M L^2 T^-2]', '[M L^-1 T^-2]', '[M L^2 T^-3]'],
    correctOptionIndex: 1,
    explanation: 'Work done has dimensions [M L^2 T^-2].',
    ...overrides,
  };
}

// ============================================================================
// 1. PerformanceAnalysisView Component UI Tests
// ============================================================================

test('PerformanceAnalysisView: Internal validation attempt displays explicit warning and zero mastery', () => {
  const cp = createDummyCheckpoint();
  const internalAttempt: AssessmentAttemptResult = {
    attemptId: 'att-iv-100',
    score: 100,
    totalMarks: 20,
    rawMarks: 20,
    percentage: 100,
    correctCount: 5,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 300,
    completedAt: '2026-11-04T12:00:00.000Z',
    weakTopics: [],
    strongTopics: ['Dimensional Formulas'],
    mode: 'internal_validation',
    isInternalValidation: true,
  };

  const dummyRevisions: RevisionItem[] = [
    {
      id: 'rev-1',
      checkpointId: cp.id,
      roadmapId: cp.roadmapId,
      topicId: 'physics.units.dim',
      topicName: 'Dimensional Formulas',
      reason: 'Scheduled review',
      scheduledForDate: '2026-11-05',
      intervalStep: 0,
      status: 'upcoming',
      consecutiveMasteryCount: 0,
      priority: 'medium',
    },
  ];

  const html = renderToStaticMarkup(
    React.createElement(PerformanceAnalysisView, {
      checkpoint: cp,
      assessmentResult: internalAttempt,
      scheduledRevisions: dummyRevisions,
      onRetry: () => {},
      onAdvance: () => {},
      onClose: () => {},
    })
  );

  // 1. Explicit internal test only banner
  assert.ok(
    html.includes('Internal Test Only — No Learner Mastery Awarded'),
    'Must display explicit internal test banner'
  );

  // 2. Badge indicates internal test only
  assert.ok(
    html.includes('Internal Test Only'),
    'Badge must display Internal Test Only'
  );

  // 3. Milestone outcome indicates no mastery awarded
  assert.ok(
    html.includes('No Mastery Awarded'),
    'Outcome card must display No Mastery Awarded'
  );
  assert.ok(
    html.includes('Internal preview attempt; does not affect learner progression'),
    'Outcome subtitle must state progression is unaffected'
  );

  // 4. Prohibited learner-facing mastery text MUST NOT appear
  assert.ok(!html.includes('Strong Mastery'), 'Must NOT display Strong Mastery');
  assert.ok(!html.includes('Developing Mastery'), 'Must NOT display Developing Mastery');
  assert.ok(!html.includes('Unlocked Next'), 'Must NOT display Unlocked Next');
  assert.ok(!html.includes('Prerequisites Met'), 'Must NOT display Prerequisites Met');
  assert.ok(!html.includes('Advance to Next Milestone'), 'Must NOT display Advance to Next Milestone');

  // 5. Safe return action only
  assert.ok(html.includes('Return to Overview'), 'Must display safe Return to Overview button');

  // 6. Automated revision queue must be hidden for internal preview
  assert.ok(
    !html.includes('Automated Spaced Revision Queue'),
    'Must NOT display spaced revision queue for internal validation'
  );
});

test('PerformanceAnalysisView: Normal learner attempt displays genuine mastery and advancement action', () => {
  const cp = createDummyCheckpoint();
  const learnerAttempt: AssessmentAttemptResult = {
    attemptId: 'att-learner-1',
    score: 85,
    totalMarks: 20,
    rawMarks: 17,
    percentage: 85,
    correctCount: 4,
    incorrectCount: 1,
    unansweredCount: 0,
    timeTakenSeconds: 320,
    completedAt: '2026-11-04T12:00:00.000Z',
    weakTopics: ['Error Analysis'],
    strongTopics: ['Dimensional Formulas'],
    mode: 'learner',
    isInternalValidation: false,
  };

  const dummyRevisions: RevisionItem[] = [
    {
      id: 'rev-2',
      checkpointId: cp.id,
      roadmapId: cp.roadmapId,
      topicId: 'physics.units.error',
      topicName: 'Error Analysis',
      reason: 'Missed in milestone test',
      scheduledForDate: '2026-11-05',
      intervalStep: 0,
      status: 'upcoming',
      consecutiveMasteryCount: 0,
      priority: 'high',
    },
  ];

  const html = renderToStaticMarkup(
    React.createElement(PerformanceAnalysisView, {
      checkpoint: cp,
      assessmentResult: learnerAttempt,
      scheduledRevisions: dummyRevisions,
      onRetry: () => {},
      onAdvance: () => {},
      onClose: () => {},
    })
  );

  // Learner view displays mastery badge and milestone advance
  assert.ok(html.includes('Strong Mastery'), 'Learner view must display Strong Mastery for 85%');
  assert.ok(html.includes('Unlocked Next'), 'Learner view must display Unlocked Next');
  assert.ok(html.includes('Prerequisites Met'), 'Learner view must display Prerequisites Met');
  assert.ok(html.includes('Advance to Next Milestone'), 'Learner view must offer advance action');
  assert.ok(html.includes('Automated Spaced Revision Queue'), 'Learner view must display revision queue');
  assert.ok(!html.includes('Internal Test Only'), 'Must NOT display Internal Test Only banner');
});

// ============================================================================
// 2. CheckpointDetailPanel Component Access Control Tests
// ============================================================================

test('CheckpointDetailPanel: Preview button renders in development mode for unreviewed checkpoint', () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    const cp = createDummyCheckpoint({
      assessmentQuestions: [createDummyQuestion('q-draft')],
    });

    const html = renderToStaticMarkup(
      React.createElement(CheckpointDetailPanel, {
        checkpoint: cp,
        onClose: () => {},
        onUpdateProgress: () => {},
        onRecordAssessment: () => ({ scheduledRevisions: [] }),
      })
    );

    assert.ok(
      html.includes('Preview (Internal Only)'),
      'Development panel must offer Preview (Internal Only) button for testing'
    );
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('CheckpointDetailPanel: Preview button is strictly ABSENT in production mode', () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const cp = createDummyCheckpoint({
      assessmentQuestions: [createDummyQuestion('q-draft')],
    });

    const html = renderToStaticMarkup(
      React.createElement(CheckpointDetailPanel, {
        checkpoint: cp,
        onClose: () => {},
        onUpdateProgress: () => {},
        onRecordAssessment: () => ({ scheduledRevisions: [] }),
      })
    );

    // In production, internal preview button MUST NOT exist in DOM
    assert.ok(
      !html.includes('Preview (Internal Only)'),
      'Production panel must NEVER expose Preview (Internal Only) button'
    );

    // Learner must see disabled Verification Pending button
    assert.ok(
      html.includes('Verification Pending'),
      'Production panel must show disabled Verification Pending button'
    );
    assert.ok(
      html.includes('Milestone assessment questions are undergoing formal SME verification'),
      'Must explain that completed review is required'
    );
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

// ============================================================================
// 3. AssessmentView Component Access Control & Tamper Rejection Tests
// ============================================================================

test('AssessmentView: In production, internal validation mode falls back to unreviewed barrier', () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const cp = createDummyCheckpoint({
      assessmentQuestions: [createDummyQuestion('q1')],
    });

    // Even if caller explicitly requests mode='internal_validation', production fails closed
    const html = renderToStaticMarkup(
      React.createElement(AssessmentView, {
        checkpoint: cp,
        mode: 'internal_validation',
        onAssessmentCompleted: () => {},
        onClose: () => {},
      })
    );

    assert.ok(
      html.includes('Official Assessment Pending Verification'),
      'Production AssessmentView must fall back to Official Assessment Pending Verification'
    );
    assert.ok(
      !html.includes('Identify the dimensional formula'),
      'Unverified questions must not be exposed to learner in production'
    );
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

// ============================================================================
// 4. SHA-256 Cryptographic Content Digest & Tamper Detection Tests
// ============================================================================

test('contentGovernance: Identical content produces identical SHA-256 digest', () => {
  const q1 = createDummyQuestion('Q1');
  const q2 = createDummyQuestion('Q1');

  const d1 = computeQuestionContentDigest(q1);
  const d2 = computeQuestionContentDigest(q2);

  assert.ok(d1.startsWith('sha256:'));
  assert.equal(d1.length, 7 + 64);
  assert.equal(d1, d2);
});

test('contentGovernance: Changed stem produces a different digest', () => {
  const q = createDummyQuestion('Q1');
  const baseDigest = computeQuestionContentDigest(q);

  const modified = { ...q, stem: q.stem + ' with altered prompt.' };
  assert.notEqual(computeQuestionContentDigest(modified), baseDigest);
});

test('contentGovernance: Reordered options produce a different digest', () => {
  const q = createDummyQuestion('Q1', {
    options: ['[M L T^-2]', '[M L^2 T^-2]', '[M L^-1 T^-2]', '[M L^2 T^-3]'],
  });
  const baseDigest = computeQuestionContentDigest(q);

  // Reorder options (e.g. swap index 0 and 1)
  const reordered = {
    ...q,
    options: ['[M L^2 T^-2]', '[M L T^-2]', '[M L^-1 T^-2]', '[M L^2 T^-3]'] as [string, string, string, string],
  };
  assert.notEqual(computeQuestionContentDigest(reordered), baseDigest);
});

test('contentGovernance: Changed answer key produces a different digest', () => {
  const qMcq = createDummyQuestion('Q1', { correctOptionIndex: 1 });
  const baseMcqDigest = computeQuestionContentDigest(qMcq);

  const modifiedMcq = { ...qMcq, correctOptionIndex: 2 };
  assert.notEqual(computeQuestionContentDigest(modifiedMcq), baseMcqDigest);

  // Numerical question key
  const qNum: AssessmentQuestion = {
    id: 'NUM1',
    type: 'numerical',
    topicId: 'physics.units.dim',
    difficulty: 'hard',
    stem: 'Calculate dimensional constant',
    acceptedNumerical: 9.81,
    explanation: 'Acceleration due to gravity is 9.81 m/s^2',
  };
  const baseNumDigest = computeQuestionContentDigest(qNum);

  const modifiedNum = { ...qNum, acceptedNumerical: 10.0 };
  assert.notEqual(computeQuestionContentDigest(modifiedNum), baseNumDigest);
});

test('contentGovernance: Changed explanation produces a different digest', () => {
  const q = createDummyQuestion('Q1');
  const baseDigest = computeQuestionContentDigest(q);

  const modified = { ...q, explanation: 'Completely different derivation explanation.' };
  assert.notEqual(computeQuestionContentDigest(modified), baseDigest);
});

test('contentGovernance: Changed syllabus mapping produces a different digest', () => {
  const q = createDummyQuestion('Q1', {
    topicId: 'physics.units.dim',
  });
  const baseDigest = computeQuestionContentDigest(q);

  const modifiedTopic = { ...q, topicId: 'physics.units.error-analysis' };
  assert.notEqual(computeQuestionContentDigest(modifiedTopic), baseDigest);

  const modifiedLabel = { ...q, topicLabel: 'Different Syllabus Topic Title' };
  assert.notEqual(computeQuestionContentDigest(modifiedLabel), baseDigest);
});

test('contentGovernance: Missing or malformed question content fails closed', () => {
  assert.equal(canonicalizeQuestionForHashing(null), '');
  assert.equal(canonicalizeQuestionForHashing(undefined), '');
  assert.equal(canonicalizeQuestionForHashing({}), '');
  assert.equal(canonicalizeQuestionForHashing('invalid string'), '');

  assert.equal(computeQuestionContentDigest(null), '');
  assert.equal(computeQuestionContentDigest({}), '');

  // Fails closed in verification
  assert.equal(isQuestionContentIntegrityIntact(null, null), false);
  assert.equal(isQuestionFormallyVerified(null), false);
  assert.equal(isQuestionFormallyVerified({}), false);
});

test('contentGovernance: Existing FNV-era and semantic version records fail closed', () => {
  const q = createDummyQuestion('Q1');
  const validShaDigest = computeQuestionContentDigest(q);

  // FNV-era 32-hex hash
  const fnvRecord: ContentReviewRecord = {
    reviewStatus: 'verified',
    reviewerId: 'sme-phys-dr-sharma',
    reviewedAt: '2026-11-01T12:00:00.000Z',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    contentVersion: 'c34f1e37d20b0c869d1a8b90f680bc85', // FNV 32-hex
  };
  assert.equal(isQuestionContentIntegrityIntact(q, fnvRecord), false);
  assert.equal(isQuestionFormallyVerified({ ...q, reviewRecord: fnvRecord }), false);

  // Semantic version string '1.0.0'
  const semverRecord: ContentReviewRecord = {
    reviewStatus: 'verified',
    reviewerId: 'sme-phys-dr-sharma',
    reviewedAt: '2026-11-01T12:00:00.000Z',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    contentVersion: '1.0.0',
  };
  assert.equal(isQuestionContentIntegrityIntact(q, semverRecord), false);
  assert.equal(isQuestionFormallyVerified({ ...q, reviewRecord: semverRecord }), false);

  // Modern SHA-256 digest is valid in dev harness
  const shaRecord: ContentReviewRecord = {
    reviewStatus: 'verified',
    reviewerId: 'sme-phys-dr-sharma',
    reviewedAt: '2026-11-01T12:00:00.000Z',
    mathematicalCheckConfirmed: true,
    pedagogicalReviewConfirmed: true,
    contentVersion: validShaDigest,
  };
  assert.equal(isQuestionContentIntegrityIntact(q, shaRecord), true);
});

// ============================================================================
// 5. Reviewer Authorization & Four-Tier Architecture Tests
// ============================================================================

test('contentGovernance: Reviewer ID format check rejects arbitrary non-compliant IDs', () => {
  assert.equal(isValidReviewerIdFormat('sme-phys-dr-sharma'), true);
  assert.equal(isValidReviewerIdFormat('sme-math-h-c-verma'), true);
  assert.equal(isValidReviewerIdFormat('sme-chem-prof-gupta'), true);

  // Non-compliant / arbitrary strings fail closed
  assert.equal(isValidReviewerIdFormat('reviewer-1'), false);
  assert.equal(isValidReviewerIdFormat('admin'), false);
  assert.equal(isValidReviewerIdFormat('alice'), false);
  assert.equal(isValidReviewerIdFormat(''), false);
  assert.equal(isValidReviewerIdFormat('   '), false);
  assert.equal(isValidReviewerIdFormat(null), false);
  assert.equal(isValidReviewerIdFormat(undefined), false);
});

test('contentGovernance: Production environment unconditionally fails closed for all questions', () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const q = createDummyQuestion('Q1');
    const validShaDigest = computeQuestionContentDigest(q);

    const validRecord: ContentReviewRecord = {
      reviewStatus: 'verified',
      reviewerId: 'sme-phys-dr-sharma',
      reviewedAt: '2026-11-01T12:00:00.000Z',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
      contentVersion: validShaDigest,
    };

    // Even with a structurally valid record and matching SHA-256 digest,
    // production verification fails closed because no authoritative reviewer directory exists
    assert.equal(isProductionEnvironment(), true);
    assert.equal(isQuestionFormallyVerified({ ...q, reviewRecord: validRecord }), false);
    assert.equal(getVerifiedAssessmentQuestions(createDummyCheckpoint({ assessmentQuestions: [{ ...q, reviewRecord: validRecord }] })).length, 0);
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

// ============================================================================
// 6. Progress Merge Logic Tests (roadmapSyncService)
// ============================================================================

test('roadmapSyncService: mergeCheckpointProgress preserves lastInternalValidationAttempt without leaking into assessmentResult', () => {
  const localIvAttempt: AssessmentAttemptResult = {
    attemptId: 'att-local-iv',
    score: 100,
    totalMarks: 20,
    rawMarks: 20,
    percentage: 100,
    correctCount: 5,
    incorrectCount: 0,
    unansweredCount: 0,
    timeTakenSeconds: 200,
    completedAt: '2026-11-04T10:00:00.000Z',
    weakTopics: [],
    strongTopics: ['Dimensional Analysis'],
    mode: 'internal_validation',
    isInternalValidation: true,
  };

  const remoteIvAttempt: AssessmentAttemptResult = {
    attemptId: 'att-remote-iv',
    score: 80,
    totalMarks: 20,
    rawMarks: 16,
    percentage: 80,
    correctCount: 4,
    incorrectCount: 1,
    unansweredCount: 0,
    timeTakenSeconds: 250,
    completedAt: '2026-11-04T11:00:00.000Z', // Newer
    weakTopics: ['Error Analysis'],
    strongTopics: ['Dimensional Analysis'],
    mode: 'internal_validation',
    isInternalValidation: true,
  };

  const loc: CheckpointProgress = {
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    status: 'current',
    currentStage: 'practice',
    diagnosticCleared: true,
    revisionCompleted: true,
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: '2026-11-04T10:00:00.000Z',
    historicalAttemptsCount: 0,
    lastInternalValidationAttempt: localIvAttempt,
  };

  const rem: CheckpointProgress = {
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    status: 'current',
    currentStage: 'practice',
    diagnosticCleared: true,
    revisionCompleted: true,
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: '2026-11-04T11:00:00.000Z',
    historicalAttemptsCount: 0,
    lastInternalValidationAttempt: remoteIvAttempt,
  };

  const merged = mergeCheckpointProgress(loc, rem, Date.parse('2026-11-04T12:00:00.000Z'));

  // 1. Preserves newer internal validation attempt
  assert.ok(merged.lastInternalValidationAttempt);
  assert.equal(merged.lastInternalValidationAttempt?.attemptId, 'att-remote-iv');

  // 2. NEVER populates or pollutes normal assessmentResult
  assert.equal(merged.assessmentResult, undefined);

  // 3. NEVER promotes masteryStatus or status
  assert.equal(merged.masteryStatus, 'unattempted');
  assert.equal(merged.masteryScore, 0);
  assert.notEqual(merged.status, 'completed');
});
