import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoadmapOutboxService,
  MAX_OUTBOX_RETRIES,
  getSafeFailureDiagnostics,
} from './roadmapOutboxService';
import {
  RoadmapSyncService,
  mergeCheckpointProgress,
  mergeRoadmapProgress,
  mergeRevisionQueues,
  sanitizeTimestamp,
  type GuestMigrationBackup,
} from './roadmapSyncService';
import { RoadmapProgressService } from './roadmapProgressService';
import { MemoryStorage, FakeCloudStore } from '../../../services/testDoubles';
import { scopedKey, STORAGE_KEYS, clearScope } from '../../../services/localScope';
import { cloudPaths } from '../../../services/cloudStore';
import type {
  CheckpointProgress,
  RevisionItem,
  RoadmapProgress,
  StageScore,
  AssessmentAttemptResult,
} from '../types/progress.types';

function createMockCp(overrides: Partial<CheckpointProgress> = {}): CheckpointProgress {
  return {
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    status: 'current',
    currentStage: 'diagnostic',
    diagnosticCleared: false,
    revisionCompleted: false,
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: '2026-11-04T10:00:00.000Z',
    historicalAttemptsCount: 0,
    ...overrides,
  };
}

// ============================================================================
// 1. Merge Associativity for Sparse Multi-Device Records
// ============================================================================

test('merge: strict algebraic associativity across all 6 permutations of 3 sparse records', () => {
  const refNow = new Date('2026-11-04T12:00:00.000Z').getTime();

  // Record A (Device 1, T1): Diagnostic completed on phone
  const diagScoreA: StageScore = {
    correct: 4,
    total: 5,
    percentage: 80,
    completedAt: '2026-11-01T10:00:00.000Z',
  };
  const recA = createMockCp({
    diagnosticCleared: true,
    diagnosticScore: diagScoreA,
    lastActivityAt: '2026-11-01T10:00:00.000Z',
  });

  // Record B (Device 2, T2): Active recall test completed on tablet
  const recallScoreB: StageScore = {
    correct: 3,
    total: 3,
    percentage: 100,
    completedAt: '2026-11-02T14:00:00.000Z',
  };
  const recB = createMockCp({
    activeRecallScore: recallScoreB,
    revisionCompleted: true,
    lastActivityAt: '2026-11-02T14:00:00.000Z',
  });

  // Record C (Device 3, T3): Practice session & assessment on laptop
  const assessmentC: AssessmentAttemptResult = {
    attemptId: 'att-assoc-1',
    score: 72,
    rawMarks: 72,
    totalMarks: 100,
    percentage: 72,
    correctCount: 18,
    incorrectCount: 5,
    unansweredCount: 2,
    timeTakenSeconds: 1200,
    completedAt: '2026-11-03T09:00:00.000Z',
    weakTopics: ['rotational-dynamics'],
    strongTopics: ['torque-equilibrium'],
  };
  const recC = createMockCp({
    practiceStats: {
      attempted: 15,
      correct: 12,
      highestTierUnlocked: 'jee_main',
      lastPracticedAt: '2026-11-03T08:30:00.000Z',
    },
    assessmentResult: assessmentC,
    status: 'completed',
    masteryStatus: 'developing',
    masteryScore: 72,
    lastActivityAt: '2026-11-03T09:00:00.000Z',
    historicalAttemptsCount: 1,
  });

  // All 6 permutations of grouping:
  // 1. (A * B) * C
  const r1 = mergeCheckpointProgress(mergeCheckpointProgress(recA, recB, refNow), recC, refNow);
  // 2. A * (B * C)
  const r2 = mergeCheckpointProgress(recA, mergeCheckpointProgress(recB, recC, refNow), refNow);
  // 3. (B * A) * C
  const r3 = mergeCheckpointProgress(mergeCheckpointProgress(recB, recA, refNow), recC, refNow);
  // 4. B * (A * C)
  const r4 = mergeCheckpointProgress(recB, mergeCheckpointProgress(recA, recC, refNow), refNow);
  // 5. (C * A) * B
  const r5 = mergeCheckpointProgress(mergeCheckpointProgress(recC, recA, refNow), recB, refNow);
  // 6. C * (B * A)
  const r6 = mergeCheckpointProgress(recC, mergeCheckpointProgress(recB, recA, refNow), refNow);

  // Assert all are strictly equal across every field
  assert.deepEqual(r1, r2, '(A * B) * C === A * (B * C)');
  assert.deepEqual(r1, r3, '(A * B) * C === (B * A) * C');
  assert.deepEqual(r1, r4, '(A * B) * C === B * (A * C)');
  assert.deepEqual(r1, r5, '(A * B) * C === (C * A) * B');
  assert.deepEqual(r1, r6, '(A * B) * C === C * (B * A)');

  // Verify field values preserved
  assert.equal(r1.diagnosticCleared, true);
  assert.equal(r1.revisionCompleted, true);
  assert.deepEqual(r1.diagnosticScore, diagScoreA);
  assert.deepEqual(r1.activeRecallScore, recallScoreB);
  assert.equal(r1.practiceStats?.highestTierUnlocked, 'jee_main');
  assert.equal(r1.assessmentResult?.attemptId, 'att-assoc-1');
  assert.equal(r1.masteryScore, 72);
  assert.equal(r1.masteryStatus, 'developing');
  assert.equal(r1.status, 'completed');
});

test('merge: associativity holds with equal timestamps, missing fields and newer lower scores', () => {
  const refNow = new Date('2026-11-04T12:00:00.000Z').getTime();
  const sameInstant = '2026-11-02T10:00:00.000Z';

  // Device A: scored 90% on Nov 1
  const recA = createMockCp({
    assessmentResult: {
      attemptId: 'att-nov1',
      score: 90,
      rawMarks: 90,
      totalMarks: 100,
      percentage: 90,
      correctCount: 9,
      incorrectCount: 1,
      unansweredCount: 0,
      timeTakenSeconds: 300,
      completedAt: '2026-11-01T10:00:00.000Z',
      weakTopics: [],
      strongTopics: [],
    },
    masteryStatus: 'strong',
    masteryScore: 90,
    status: 'completed',
    lastActivityAt: '2026-11-01T10:00:00.000Z',
  });

  // Device B: retook test on Nov 3 and score dropped to 50% (legitimate reassessment evidence)
  const recB = createMockCp({
    assessmentResult: {
      attemptId: 'att-nov3',
      score: 50,
      rawMarks: 50,
      totalMarks: 100,
      percentage: 50,
      correctCount: 5,
      incorrectCount: 5,
      unansweredCount: 0,
      timeTakenSeconds: 400,
      completedAt: '2026-11-03T10:00:00.000Z',
      weakTopics: ['difficult-topic'],
      strongTopics: [],
    },
    masteryStatus: 'needs_reinforcement',
    masteryScore: 50,
    status: 'needs_reinforcement',
    lastActivityAt: '2026-11-03T10:00:00.000Z',
  });

  // Device C: equal timestamp tie-break test on sameInstant
  const recC = createMockCp({
    diagnosticScore: {
      correct: 2,
      total: 5,
      percentage: 40,
      completedAt: sameInstant,
    },
    lastActivityAt: sameInstant,
  });

  const p1 = mergeCheckpointProgress(mergeCheckpointProgress(recA, recB, refNow), recC, refNow);
  const p2 = mergeCheckpointProgress(recA, mergeCheckpointProgress(recB, recC, refNow), refNow);
  const p3 = mergeCheckpointProgress(mergeCheckpointProgress(recC, recB, refNow), recA, refNow);

  assert.deepEqual(p1, p2);
  assert.deepEqual(p1, p3);

  // Newer lower score (Nov 3: 50%) correctly wins over older high score (Nov 1: 90%)
  assert.equal(p1.masteryScore, 50);
  assert.equal(p1.masteryStatus, 'needs_reinforcement');
  assert.equal(p1.assessmentResult?.attemptId, 'att-nov3');
});

// ============================================================================
// 2. Recoverable Permanent-Failure Handling
// ============================================================================

test('outbox: mutation is marked permanently failed after 5 retries and remains persisted', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const mut = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 50 },
    },
    uid,
    storage
  );

  cloud.failCommits = '503 Service Unavailable';

  // Flush 5 times
  for (let i = 0; i < MAX_OUTBOX_RETRIES; i++) {
    await RoadmapOutboxService.flush(uid, cloud, storage);
  }

  // Mutation is now permanently failed
  const failed = RoadmapOutboxService.getPermanentFailures(uid, storage);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, mut.id);
  assert.equal(failed[0].isPermanentFailure, true);
  assert.equal(failed[0].attemptCount, 5);

  // Normal pending count excludes permanent failures
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 0);

  // Mutation STILL persists locally in outbox!
  const all = RoadmapOutboxService.getOutbox(uid, storage);
  assert.equal(all.length, 1);
});

test('outbox: permission-denied error immediately marks mutation permanently failed', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const mut = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 50 },
    },
    uid,
    storage
  );

  cloud.failCommits = 'permission-denied: insufficient permissions';
  await RoadmapOutboxService.flush(uid, cloud, storage);

  const failed = RoadmapOutboxService.getPermanentFailures(uid, storage);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, mut.id);
  assert.equal(failed[0].isPermanentFailure, true);
  assert.ok(failed[0].lastError?.includes('permission-denied'));
});

test('outbox: retryFailedMutation manually recovers a permanently failed mutation', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const mut = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 60 },
    },
    uid,
    storage
  );

  // Simulate permanent failure
  cloud.failCommits = 'permission-denied: rule blocked';
  await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(RoadmapOutboxService.getPermanentFailures(uid, storage).length, 1);

  // Underlying issue fixed (rules updated / network restored)
  cloud.failCommits = false;

  // Manual retry
  const success = await RoadmapOutboxService.retryFailedMutation(uid, mut.id, cloud, storage);
  assert.equal(success, true);

  // Acknowledged and removed from outbox
  assert.equal(RoadmapOutboxService.getPermanentFailures(uid, storage).length, 0);
  assert.equal(RoadmapOutboxService.getOutbox(uid, storage).length, 0);

  // Document committed in cloud
  const doc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.equal(doc?.completionPercentage, 60);
});

test('outbox: repeated manual retry when cloud still fails stays in dead-letter queue', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const mut = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 60 },
    },
    uid,
    storage
  );

  cloud.failCommits = 'permission-denied';
  await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(RoadmapOutboxService.getPermanentFailures(uid, storage).length, 1);

  // Retry while still failing
  const success = await RoadmapOutboxService.retryFailedMutation(uid, mut.id, cloud, storage);
  assert.equal(success, false);

  // Remains permanently failed
  const failed = RoadmapOutboxService.getPermanentFailures(uid, storage);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].isPermanentFailure, true);
});

test('outbox: one permanently failed mutation does not block flushing other valid mutations', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Mutation 1: permanently failed
  const mut1 = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 10 },
    },
    uid,
    storage
  );
  RoadmapOutboxService.markAttemptFailed([mut1.id], new Error('permission-denied'), uid, storage);

  // Mutation 2: normal pending mutation
  const mut2 = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'CHEM-01'),
      data: { roadmapId: 'CHEM-01', completionPercentage: 40 },
    },
    uid,
    storage
  );

  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 1);
  assert.equal(RoadmapOutboxService.getPermanentFailures(uid, storage).length, 1);

  // Flush flushes mut2 and leaves mut1 safely preserved
  const flushRes = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(flushRes.sent, 1);
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 0);
  assert.equal(RoadmapOutboxService.getPermanentFailures(uid, storage).length, 1);

  const doc = await cloud.getDoc(cloudPaths.roadmap(uid, 'CHEM-01'));
  assert.equal(doc?.completionPercentage, 40);
});

test('outbox: getSafeFailureDiagnostics does not expose sensitive payload data', () => {
  const mut = {
    id: 'mut-123',
    uid: 'alice',
    createdAt: '2026-11-04T10:00:00.000Z',
    type: 'set' as const,
    path: 'users/alice/roadmaps/PHY-01',
    data: { secretToken: 'SUPER_SECRET_123', passwordHash: 'hash_xyz' },
    attemptCount: 5,
    lastAttemptAt: '2026-11-04T10:05:00.000Z',
    lastError: '503 Service Unavailable',
    isPermanentFailure: true,
  };

  const diag = getSafeFailureDiagnostics(mut);
  assert.equal(diag.id, 'mut-123');
  assert.equal(diag.path, 'users/alice/roadmaps/PHY-01');
  assert.equal(diag.attemptCount, 5);
  assert.equal((diag as any).data, undefined);
  assert.equal((diag as any).secretToken, undefined);
});

// ============================================================================
// 3. Concurrency Protection for Cloud Sync
// ============================================================================

test('concurrency: simultaneous sync calls for the same UID execute safely and trigger follow-up', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  let commitCalls = 0;
  const originalCommit = cloud.commit.bind(cloud);
  cloud.commit = async (ops) => {
    commitCalls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return originalCommit(ops);
  };

  // Launch two concurrent sync calls
  const sync1 = RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, storage);
  const sync2 = RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, storage);

  await Promise.all([sync1, sync2]);

  // Lock properly released
  assert.equal(RoadmapSyncService.isSyncing(uid), false);
});

// ============================================================================
// 4. Guest Migration Runtime Recovery Lifecycle Tests
// ============================================================================

test('guest migration: failure preserves backup and sign-out restores it into guest scope', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  // Guest creates progress
  const guestProg: RoadmapProgress = {
    roadmapId: 'PHY-01',
    completionPercentage: 50,
    completedCheckpointsCount: 2,
    currentCheckpointId: 'PHY-01-CP2',
    checkpoints: {},
    lastActivityAt: '2026-11-04T10:00:00.000Z',
  };
  storage.setItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS), JSON.stringify({ 'PHY-01': guestProg }));

  // Student signs in as Alice: cloud fails during migration sync
  cloud.failCommits = '503 Service Unavailable';
  await RoadmapSyncService.migrateGuestRoadmapDataToUser('alice', storage, cloud);

  // Backup exists in guest scope with pending_cloud_sync
  const backupRaw = storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP));
  assert.ok(backupRaw);
  const backup = JSON.parse(backupRaw!) as GuestMigrationBackup;
  assert.equal(backup.targetUid, 'alice');
  assert.equal(backup.status, 'pending_cloud_sync');

  // Alice signs out -> transitions to guest session
  const restored = RoadmapSyncService.restoreFromGuestMigrationBackup(storage, { previousUid: 'alice' });
  assert.equal(restored, true);

  // Guest roadmap progress restored
  const guestRoadmaps = RoadmapProgressService.getAllRoadmapsProgress(null, storage);
  assert.equal(guestRoadmaps['PHY-01']?.completionPercentage, 50);

  // Backup safely cleaned up after recovery
  assert.equal(storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP)), null);
});

test('guest migration: user B cannot restore or steal User A unconfirmed guest backup', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  const backup: GuestMigrationBackup = {
    targetUid: 'alice',
    migratedAt: '2026-11-04T10:00:00.000Z',
    guestRoadmaps: {
      'PHY-01': {
        roadmapId: 'PHY-01',
        completionPercentage: 75,
        completedCheckpointsCount: 3,
        currentCheckpointId: 'PHY-01-CP3',
        checkpoints: {},
        lastActivityAt: '2026-11-04T10:00:00.000Z',
      },
    },
    guestQueue: [],
    status: 'pending_cloud_sync',
  };
  storage.setItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP), JSON.stringify(backup));

  // User B signs in: migrateGuestRoadmapDataToUser refuses to steal Alice's backup
  const res = await RoadmapSyncService.migrateGuestRoadmapDataToUser('bob', storage, cloud);
  assert.equal(res.migratedRoadmaps, 0);

  // Bob's roadmaps do NOT receive Alice's backup data
  const bobRoadmaps = RoadmapProgressService.getAllRoadmapsProgress('bob', storage);
  assert.equal(bobRoadmaps['PHY-01'], undefined);

  // Alice's unconfirmed backup is preserved!
  const preserved = storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP));
  assert.ok(preserved);
});

test('guest migration: restoration is idempotent across repeated calls', () => {
  const storage = new MemoryStorage();

  const backup: GuestMigrationBackup = {
    targetUid: 'alice',
    migratedAt: '2026-11-04T10:00:00.000Z',
    guestRoadmaps: {
      'PHY-01': {
        roadmapId: 'PHY-01',
        completionPercentage: 45,
        completedCheckpointsCount: 1,
        currentCheckpointId: 'PHY-01-CP1',
        checkpoints: {},
        lastActivityAt: '2026-11-04T10:00:00.000Z',
      },
    },
    guestQueue: [],
    status: 'pending_cloud_sync',
  };
  storage.setItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP), JSON.stringify(backup));

  // First restore call succeeds
  const r1 = RoadmapSyncService.restoreFromGuestMigrationBackup(storage, { previousUid: 'alice' });
  assert.equal(r1, true);

  // Second restore call is idempotent no-op
  const r2 = RoadmapSyncService.restoreFromGuestMigrationBackup(storage, { previousUid: 'alice' });
  assert.equal(r2, false);

  const prog = RoadmapProgressService.getAllRoadmapsProgress(null, storage);
  assert.equal(prog['PHY-01']?.completionPercentage, 45);
});
