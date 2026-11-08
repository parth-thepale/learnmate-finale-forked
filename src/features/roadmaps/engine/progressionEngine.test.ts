import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arePrerequisitesSatisfied,
  resolveCheckpointNodeStatus,
  computeRoadmapCompletion,
  getCheckpointLockReason,
  isCheckpointEmpty,
  hasSufficientCheckpointContent,
} from './progressionEngine';
import { getCheckpointById } from '../data/checkpointRegistry';
import { getRoadmapById } from '../data/roadmaps';
import type { Checkpoint } from '../types/checkpoint.types';
import type { CheckpointProgress, RevisionItem } from '../types/progress.types';

function createMockCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'MOCK-CP1',
    roadmapId: 'PHY-01',
    subject: 'physics',
    order: 1,
    title: 'Mock Checkpoint 1',
    description: 'Description',
    learningObjectives: ['Objective'],
    officialUnitNumbers: [1],
    officialChapterIds: ['ch1'],
    topicIds: ['topic-1'],
    prerequisiteIds: [],
    estimatedWorkloadMinutes: 40,
    concepts: [
      {
        id: 'c1',
        topicId: 'topic-1',
        title: 'Mock Concept',
        summary: 'Summary',
        keyFormulas: [{ label: 'Force', formula: 'F=ma' }],
      },
    ],
    diagnosticQuestions: [
      {
        id: 'd1',
        topicId: 'topic-1',
        prompt: 'Diag Q1',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Exp',
      },
      {
        id: 'd2',
        topicId: 'topic-1',
        prompt: 'Diag Q2',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Exp',
      },
      {
        id: 'd3',
        topicId: 'topic-1',
        prompt: 'Diag Q3',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Exp',
      },
      {
        id: 'd4',
        topicId: 'topic-1',
        prompt: 'Diag Q4',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Exp',
      },
    ],
    activeRecallPrompts: [
      { id: 'r1', topicId: 'topic-1', prompt: 'Recall P1', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Exp' },
      { id: 'r2', topicId: 'topic-1', prompt: 'Recall P2', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Exp' },
      { id: 'r3', topicId: 'topic-1', prompt: 'Recall P3', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Exp' },
    ],
    practiceQuestions: [],
    assessmentQuestions: [
      {
        id: 'a1',
        type: 'mcq',
        topicId: 'topic-1',
        difficulty: 'medium',
        stem: 'Ass Q1',
        options: ['A', 'B', 'C', 'D'],
        correctOptionIndex: 0,
        explanation: 'Exp',
      },
    ],
    ...overrides,
  };
}

function createMockProgress(overrides: Partial<CheckpointProgress> = {}): CheckpointProgress {
  const masteryScore =
    overrides.masteryScore !== undefined
      ? overrides.masteryScore
      : overrides.masteryStatus === 'strong'
      ? 85
      : overrides.masteryStatus === 'developing'
      ? 65
      : 0;

  return {
    checkpointId: 'MOCK-CP1',
    roadmapId: 'PHY-01',
    status: 'current',
    currentStage: 'diagnostic',
    diagnosticCleared: false,
    revisionCompleted: false,
    masteryStatus: 'unattempted',
    lastActivityAt: new Date().toISOString(),
    historicalAttemptsCount: 0,
    ...overrides,
    masteryScore,
  };
}

test('progressionEngine: initial availability correctly assigns current vs locked', () => {
  const cp1 = createMockCheckpoint({ id: 'CP-1', order: 1, prerequisiteIds: [] });
  const cp2 = createMockCheckpoint({ id: 'CP-2', order: 2, prerequisiteIds: ['CP-1'] });

  const progressMap: Record<string, CheckpointProgress> = {};

  // With no progress, CP1 is current, CP2 is locked
  assert.equal(resolveCheckpointNodeStatus(cp1, undefined, progressMap), 'current');
  assert.equal(resolveCheckpointNodeStatus(cp2, undefined, progressMap), 'locked');
});

test('progressionEngine: unlocks downstream checkpoints when prerequisite achieves developing or strong mastery', () => {
  const cp2 = createMockCheckpoint({ id: 'CP-2', order: 2, prerequisiteIds: ['CP-1'] });

  // Prerequisite with developing mastery unlocks CP2
  const devProgressMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({
      checkpointId: 'CP-1',
      status: 'completed',
      masteryStatus: 'developing',
      masteryScore: 65,
    }),
  };
  assert.equal(arePrerequisitesSatisfied(cp2, devProgressMap), true);
  assert.equal(resolveCheckpointNodeStatus(cp2, undefined, devProgressMap), 'available');

  // Prerequisite with strong mastery unlocks CP2
  const strongProgressMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({
      checkpointId: 'CP-1',
      status: 'completed',
      masteryStatus: 'strong',
      masteryScore: 90,
    }),
  };
  assert.equal(arePrerequisitesSatisfied(cp2, strongProgressMap), true);
  assert.equal(resolveCheckpointNodeStatus(cp2, undefined, strongProgressMap), 'available');
});

test('progressionEngine: does not unlock downstream when prerequisite has insufficient evidence or needs reinforcement', () => {
  const cp2 = createMockCheckpoint({ id: 'CP-2', order: 2, prerequisiteIds: ['CP-1'] });

  // Prerequisite has insufficient evidence
  const pendingMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({
      checkpointId: 'CP-1',
      status: 'current',
      masteryStatus: 'insufficient_evidence',
      masteryScore: 0,
    }),
  };
  assert.equal(arePrerequisitesSatisfied(cp2, pendingMap), false);
  assert.equal(resolveCheckpointNodeStatus(cp2, undefined, pendingMap), 'locked');

  // Prerequisite needs reinforcement
  const weakMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({
      checkpointId: 'CP-1',
      status: 'needs_reinforcement',
      masteryStatus: 'needs_reinforcement',
      masteryScore: 40,
    }),
  };
  assert.equal(arePrerequisitesSatisfied(cp2, weakMap), false);
  assert.equal(resolveCheckpointNodeStatus(cp2, undefined, weakMap), 'locked');

  // Prerequisite is completed status but has insufficient_evidence (fabricated pass guard)
  const fabricatedMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({
      checkpointId: 'CP-1',
      status: 'completed',
      masteryStatus: 'insufficient_evidence',
      masteryScore: 0,
    }),
  };
  assert.equal(arePrerequisitesSatisfied(cp2, fabricatedMap), false);
});

test('progressionEngine: handles multiple prerequisites correctly', () => {
  const multiPrereqCp = createMockCheckpoint({
    id: 'CP-3',
    order: 3,
    prerequisiteIds: ['CP-1', 'CP-2'],
  });

  // Only one prerequisite mastered -> still locked
  const partialMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({ checkpointId: 'CP-1', masteryStatus: 'strong' }),
    'CP-2': createMockProgress({ checkpointId: 'CP-2', masteryStatus: 'needs_reinforcement' }),
  };
  assert.equal(arePrerequisitesSatisfied(multiPrereqCp, partialMap), false);

  // Both prerequisites mastered -> unlocked
  const completeMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({ checkpointId: 'CP-1', masteryStatus: 'strong' }),
    'CP-2': createMockProgress({ checkpointId: 'CP-2', masteryStatus: 'developing' }),
  };
  assert.equal(arePrerequisitesSatisfied(multiPrereqCp, completeMap), true);
});

test('progressionEngine: displays revision_due when spaced revisions are due for a completed checkpoint', () => {
  const cp1 = createMockCheckpoint({ id: 'CP-1', order: 1 });
  const completedProg = createMockProgress({
    checkpointId: 'CP-1',
    status: 'completed',
    masteryStatus: 'strong',
  });

  const dueItem: RevisionItem = {
    id: 'rev-1',
    topicId: 'topic-1',
    topicName: 'Topic 1',
    roadmapId: 'PHY-01',
    checkpointId: 'CP-1',
    scheduledForDate: '2026-11-01',
    intervalStep: 0,
    status: 'due',
    reason: 'Test',
    consecutiveMasteryCount: 1,
    priority: 'high',
  };

  const statusWithDue = resolveCheckpointNodeStatus(cp1, completedProg, {}, [dueItem]);
  assert.equal(statusWithDue, 'revision_due');

  // If revision item is upcoming, remains completed
  const upcomingItem: RevisionItem = { ...dueItem, status: 'upcoming' };
  const statusUpcoming = resolveCheckpointNodeStatus(cp1, completedProg, {}, [upcomingItem]);
  assert.equal(statusUpcoming, 'completed');
});

test('progressionEngine: handles missing prerequisite IDs and circular references gracefully', () => {
  // Prerequisite points to non-existent ID
  const brokenCp = createMockCheckpoint({
    id: 'CP-BROKEN',
    prerequisiteIds: ['NON-EXISTENT-ID'],
  });
  assert.equal(arePrerequisitesSatisfied(brokenCp, {}), false);

  // Circular reference: CP-A requires CP-B, CP-B requires CP-A
  const cpA = createMockCheckpoint({ id: 'CP-A', prerequisiteIds: ['CP-B'] });
  const cpB = createMockCheckpoint({ id: 'CP-B', prerequisiteIds: ['CP-A'] });

  const unattemptedMap: Record<string, CheckpointProgress> = {
    'CP-A': createMockProgress({ checkpointId: 'CP-A', masteryStatus: 'unattempted' }),
    'CP-B': createMockProgress({ checkpointId: 'CP-B', masteryStatus: 'unattempted' }),
  };

  // Neither can be unlocked without genuine completion
  assert.equal(arePrerequisitesSatisfied(cpA, unattemptedMap), false);
  assert.equal(arePrerequisitesSatisfied(cpB, unattemptedMap), false);
});

test('progressionEngine: computes roadmap completion percentage and completed count accurately', () => {
  const roadmap = getRoadmapById('PHY-01')!;
  assert.ok(roadmap);

  const cp1 = createMockCheckpoint({ id: 'CP-1', order: 1 });
  const cp2 = createMockCheckpoint({ id: 'CP-2', order: 2 });
  const cp3 = createMockCheckpoint({ id: 'CP-3', order: 3 });
  const cp4 = createMockCheckpoint({ id: 'CP-4', order: 4 });
  const checkpoints = [cp1, cp2, cp3, cp4];

  // 2 out of 4 completed: CP1 with 80% (strong), CP2 with 70% (developing)
  const progressMap: Record<string, CheckpointProgress> = {
    'CP-1': createMockProgress({ checkpointId: 'CP-1', masteryStatus: 'strong', masteryScore: 80 }),
    'CP-2': createMockProgress({ checkpointId: 'CP-2', masteryStatus: 'developing', masteryScore: 70 }),
    'CP-3': createMockProgress({ checkpointId: 'CP-3', status: 'current', masteryStatus: 'unattempted', masteryScore: 0 }),
    'CP-4': createMockProgress({ checkpointId: 'CP-4', status: 'locked', masteryStatus: 'unattempted', masteryScore: 0 }),
  };

  const completion = computeRoadmapCompletion(roadmap, checkpoints, progressMap);
  assert.equal(completion.completedCount, 2);
  // (80 + 70 + 0 + 0) / 400 = 37.5% -> rounded to 38%
  assert.equal(completion.completionPercentage, 38);
  assert.equal(completion.currentCheckpointId, 'CP-3');
});

test('progressionEngine: empty first checkpoints show content_unavailable and downstream shows locked with prerequisite reasons', () => {
  const emptyFirstCp = createMockCheckpoint({
    id: 'EMPTY-CP1',
    order: 1,
    prerequisiteIds: [],
    concepts: [],
    diagnosticQuestions: [],
    activeRecallPrompts: [],
    assessmentQuestions: [],
  });

  const emptySecondCp = createMockCheckpoint({
    id: 'EMPTY-CP2',
    order: 2,
    prerequisiteIds: ['EMPTY-CP1'],
    concepts: [],
    diagnosticQuestions: [],
    activeRecallPrompts: [],
    assessmentQuestions: [],
  });

  const emptyMap: Record<string, CheckpointProgress> = {};

  // 1. Empty first checkpoint must show content_unavailable (NOT current)
  assert.equal(resolveCheckpointNodeStatus(emptyFirstCp, undefined, emptyMap), 'content_unavailable');
  assert.equal(isCheckpointEmpty(emptyFirstCp), true);
  assert.equal(hasSufficientCheckpointContent(emptyFirstCp), false);

  const lockReason1 = getCheckpointLockReason(emptyFirstCp, emptyMap);
  assert.ok(lockReason1);
  assert.equal(lockReason1?.status, 'content_unavailable');

  // 2. Downstream checkpoint with unmet prerequisites must show locked (with precise prerequisite lock reason)
  assert.equal(resolveCheckpointNodeStatus(emptySecondCp, undefined, emptyMap), 'locked');
  const lockReason2 = getCheckpointLockReason(emptySecondCp, emptyMap);
  assert.ok(lockReason2);
  assert.equal(lockReason2?.status, 'locked');
  assert.deepEqual(lockReason2?.unmetPrerequisiteIds, ['EMPTY-CP1']);
});

test('progressionEngine: checkpoints with insufficient content do not become available merely because 1 item exists', () => {
  // Checkpoint with only 1 assessment question and 0 diagnostic/recall/concepts
  const singleItemCp = createMockCheckpoint({
    id: 'INSUFFICIENT-CP1',
    order: 1,
    prerequisiteIds: [],
    concepts: [],
    diagnosticQuestions: [],
    activeRecallPrompts: [],
    assessmentQuestions: [
      {
        id: 'a1',
        type: 'mcq',
        topicId: 'topic-1',
        difficulty: 'medium',
        stem: 'Ass Q1',
        options: ['A', 'B', 'C', 'D'],
        correctOptionIndex: 0,
        explanation: 'Exp',
      },
    ],
  });

  assert.equal(hasSufficientCheckpointContent(singleItemCp), false);
  assert.equal(resolveCheckpointNodeStatus(singleItemCp, undefined, {}), 'content_unavailable');
});

test('progressionEngine: previously earned genuine mastery remains preserved', () => {
  const cp = createMockCheckpoint({ id: 'CP-1', order: 1 });
  const masteredProgress = createMockProgress({
    checkpointId: 'CP-1',
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 92,
  });

  // Genuine mastery must remain completed even with zero new activity
  assert.equal(resolveCheckpointNodeStatus(cp, masteredProgress, {}), 'completed');
});
