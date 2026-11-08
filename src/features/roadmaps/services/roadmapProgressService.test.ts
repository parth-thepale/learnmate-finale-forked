import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadmapProgressService } from './roadmapProgressService';
import { MemoryStorage } from '../../../services/testDoubles';
import { scopedKey, STORAGE_KEYS } from '../../../services/localScope';

test('roadmapProgressService: isolates progress between users (Alice vs Bob vs Guest)', () => {
  const storage = new MemoryStorage();

  // Initialize and save progress for Alice
  const aliceProg = RoadmapProgressService.getRoadmapProgress('PHY-01', 'alice', storage);
  assert.equal(aliceProg.completionPercentage, 0);

  const updatedAliceCp = {
    ...aliceProg.checkpoints['PHY-01-CP1'],
    status: 'completed' as const,
    masteryStatus: 'strong' as const,
    masteryScore: 90,
  };
  RoadmapProgressService.saveCheckpointProgress(updatedAliceCp, 'alice', storage);

  // Bob's progress must be independent and unattempted
  const bobProg = RoadmapProgressService.getRoadmapProgress('PHY-01', 'bob', storage);
  assert.equal(bobProg.completionPercentage, 0);
  assert.equal(bobProg.checkpoints['PHY-01-CP1'].masteryStatus, 'unattempted');

  // Verify Alice's updated progress persisted in her scope
  const reloadedAlice = RoadmapProgressService.getRoadmapProgress('PHY-01', 'alice', storage);
  assert.equal(reloadedAlice.checkpoints['PHY-01-CP1'].masteryStatus, 'strong');
  assert.equal(reloadedAlice.checkpoints['PHY-01-CP1'].masteryScore, 90);
  assert.equal(reloadedAlice.completedCheckpointsCount, 1);

  // Physical key check: Alice's data is only under lm:u_alice:...
  assert.ok(storage.getItem(scopedKey('u_alice', STORAGE_KEYS.ROADMAP_PROGRESS)));
  assert.equal(storage.getItem(scopedKey('u_bob', STORAGE_KEYS.ROADMAP_PROGRESS)), null);
  assert.equal(storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS)), null);
});

import { getCheckpointById } from '../data/checkpointRegistry';
import { computeQuestionContentHash } from '../engine/contentGovernance';
import type { Checkpoint, AssessmentQuestion } from '../types/checkpoint.types';

function createVerifiedQuestion(
  id: string,
  stem: string,
  topicId: string,
  correctOptionIndex: number,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): AssessmentQuestion {
  const base: AssessmentQuestion = {
    id,
    type: 'mcq',
    topicId,
    difficulty,
    stem,
    options: ['A', 'B', 'C', 'D'],
    correctOptionIndex,
    explanation: 'Verified derivation',
    isVerified: true,
  };
  return {
    ...base,
    reviewRecord: {
      reviewStatus: 'verified',
      reviewerId: 'sme-reviewer-01',
      reviewedAt: '2026-11-01T10:00:00.000Z',
      mathematicalCheckConfirmed: true,
      pedagogicalReviewConfirmed: true,
      contentVersion: computeQuestionContentHash(base),
    },
  };
}

const testVerifiedCheckpoint: Checkpoint = {
  ...getCheckpointById('PHY-01-CP1')!,
  assessmentQuestions: [
    createVerifiedQuestion('test-q1', 'Verified Q1 stem', 'physics.units-measurements.dimensional-analysis', 0),
    createVerifiedQuestion('test-q2', 'Verified Q2 stem', 'physics.kinematics.uniformly-accelerated-motion', 1),
    createVerifiedQuestion('test-q3', 'Verified Q3 stem', 'physics.units-measurements.dimensional-analysis', 2, 'easy'),
  ],
};

test('roadmapProgressService: recordAssessmentAttempt updates mastery and queues spaced revisions', () => {
  const storage = new MemoryStorage();

  const assessmentResult = {
    attemptId: 'att-phy-01-cp1-test',
    score: 75,
    totalMarks: 100,
    rawMarks: 75,
    percentage: 75,
    correctCount: 8,
    incorrectCount: 2,
    unansweredCount: 0,
    timeTakenSeconds: 450,
    completedAt: new Date().toISOString(),
    weakTopics: ['physics.kinematics.uniformly-accelerated-motion'],
    strongTopics: ['physics.units-measurements.dimensional-analysis'],
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    'PHY-01-CP1',
    'PHY-01',
    assessmentResult,
    'alice',
    storage,
    testVerifiedCheckpoint
  );

  assert.equal(outcome.updatedProgress.masteryStatus, 'developing');
  assert.equal(outcome.updatedProgress.status, 'completed');
  assert.equal(outcome.updatedProgress.historicalAttemptsCount, 1);

  // Spaced revision queue must contain the weak topic
  const queue = RoadmapProgressService.getRevisionQueue('alice', storage);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].topicId, 'physics.kinematics.uniformly-accelerated-motion');
  assert.equal(queue[0].priority, 'high');
  assert.equal(queue[0].intervalStep, 0); // Day 1
});

test('roadmapProgressService: strong mastery queues Day 7 retention check', () => {
  const storage = new MemoryStorage();

  const strongResult = {
    attemptId: 'att-phy-01-cp1-strong',
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
  };

  const outcome = RoadmapProgressService.recordAssessmentAttempt(
    'PHY-01-CP1',
    'PHY-01',
    strongResult,
    'alice',
    storage,
    testVerifiedCheckpoint
  );

  assert.equal(outcome.updatedProgress.masteryStatus, 'strong');
  assert.equal(outcome.updatedProgress.status, 'completed');

  const queue = RoadmapProgressService.getRevisionQueue('alice', storage);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].checkpointId, 'PHY-01-CP1');
  assert.equal(queue[0].intervalStep, 2); // Step 2 corresponds to Day 7
  assert.equal(queue[0].priority, 'medium');
  assert.match(queue[0].reason, /retention check/i);
});

test('roadmapProgressService: prevents duplicate revision items in queue and updates in place', () => {
  const storage = new MemoryStorage();

  RoadmapProgressService.addRevisionItem(
    {
      id: 'rev-item-orig',
      topicId: 'physics.optics.prism',
      topicName: 'Prism Deviation',
      roadmapId: 'PHY-04',
      checkpointId: 'PHY-04-CP1',
      scheduledForDate: '2026-11-04',
      intervalStep: 0,
      status: 'due',
      reason: 'First queue',
      consecutiveMasteryCount: 0,
      priority: 'high',
    },
    'alice',
    storage
  );

  assert.equal(RoadmapProgressService.getRevisionQueue('alice', storage).length, 1);

  // Add updated item for same topic and checkpoint
  RoadmapProgressService.addRevisionItem(
    {
      id: 'rev-item-new-generated-id',
      topicId: 'physics.optics.prism',
      topicName: 'Prism Deviation',
      roadmapId: 'PHY-04',
      checkpointId: 'PHY-04-CP1',
      scheduledForDate: '2026-11-07',
      intervalStep: 1,
      status: 'upcoming',
      reason: 'Updated schedule',
      consecutiveMasteryCount: 1,
      priority: 'medium',
    },
    'alice',
    storage
  );

  const updatedQueue = RoadmapProgressService.getRevisionQueue('alice', storage);
  assert.equal(updatedQueue.length, 1); // No duplicates
  assert.equal(updatedQueue[0].id, 'rev-item-orig'); // Preserves original id
  assert.equal(updatedQueue[0].intervalStep, 1);
  assert.equal(updatedQueue[0].scheduledForDate, '2026-11-07');
});

test('roadmapProgressService: revision completion updates revision queue in storage', () => {
  const storage = new MemoryStorage();

  // Add revision item
  RoadmapProgressService.addRevisionItem(
    {
      id: 'rev-item-1',
      topicId: 'physics.optics.prism',
      topicName: 'Prism Deviation',
      roadmapId: 'PHY-04',
      checkpointId: 'PHY-04-CP1',
      scheduledForDate: '2026-11-04',
      intervalStep: 0,
      status: 'due',
      reason: 'Practice',
      consecutiveMasteryCount: 0,
      priority: 'high',
    },
    'alice',
    storage
  );

  const initialQueue = RoadmapProgressService.getRevisionQueue('alice', storage);
  assert.equal(initialQueue.length, 1);

  // Complete revision successfully
  const updatedItem = RoadmapProgressService.completeRevision('rev-item-1', true, 'alice', storage);
  assert.ok(updatedItem);
  assert.equal(updatedItem.intervalStep, 1);
  assert.equal(updatedItem.consecutiveMasteryCount, 1);

  const updatedQueue = RoadmapProgressService.getRevisionQueue('alice', storage);
  assert.equal(updatedQueue[0].intervalStep, 1);
});
