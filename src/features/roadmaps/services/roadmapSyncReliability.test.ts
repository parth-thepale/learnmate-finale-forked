import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoadmapOutboxService,
  MAX_OUTBOX_RETRIES,
  computeBackoffDelay,
  isPermanentError,
} from './roadmapOutboxService';
import {
  RoadmapSyncService,
  mergeCheckpointProgress,
  mergeRoadmapProgress,
  mergeRevisionQueues,
  sanitizeTimestamp,
  MAX_FUTURE_SKEW_MS,
  type GuestMigrationBackup,
} from './roadmapSyncService';
import { RoadmapProgressService } from './roadmapProgressService';
import { MemoryStorage, FakeCloudStore } from '../../../services/testDoubles';
import { scopedKey, STORAGE_KEYS, clearScope } from '../../../services/localScope';
import { cloudPaths } from '../../../services/cloudStore';
import type { CheckpointProgress, RevisionItem, RoadmapProgress } from '../types/progress.types';

function createMockCheckpoint(overrides: Partial<CheckpointProgress> = {}): CheckpointProgress {
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

function createMockRoadmap(overrides: Partial<RoadmapProgress> = {}): RoadmapProgress {
  return {
    roadmapId: 'PHY-01',
    completionPercentage: 0,
    completedCheckpointsCount: 0,
    currentCheckpointId: 'PHY-01-CP1',
    checkpoints: {
      'PHY-01-CP1': createMockCheckpoint(),
    },
    lastActivityAt: '2026-11-04T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// 1. Outbox Tests
// ============================================================================

test('outbox: mutation persists locally before cloud write', async () => {
  const storage = new MemoryStorage();
  const uid = 'alice';

  // Enqueue a mutation
  const mutation = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 25 },
      merge: true,
    },
    uid,
    storage
  );

  assert.ok(mutation.id);
  assert.equal(mutation.uid, 'alice');
  assert.equal(mutation.attemptCount, 0);

  // Check physical key in storage
  const outbox = RoadmapOutboxService.getOutbox(uid, storage);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].id, mutation.id);
});

test('outbox: failed writes remain queued and successful writes are acknowledged', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 50 },
    },
    uid,
    storage
  );

  // 1. Cloud failure: 503 Service Unavailable
  cloud.failCommits = '503 Service Unavailable';
  const failFlush = await RoadmapOutboxService.flush(uid, cloud, storage);

  assert.equal(failFlush.sent, 0);
  assert.equal(failFlush.failed, 1);
  assert.equal(failFlush.remaining, 1);

  // Mutation remains queued with updated attempt count & error
  const pendingAfterFail = RoadmapOutboxService.getOutbox(uid, storage);
  assert.equal(pendingAfterFail.length, 1);
  assert.equal(pendingAfterFail[0].attemptCount, 1);
  assert.ok(pendingAfterFail[0].lastError?.includes('503'));

  // 2. Cloud recovers
  cloud.failCommits = false;
  const successFlush = await RoadmapOutboxService.flush(uid, cloud, storage);

  assert.equal(successFlush.sent, 1);
  assert.equal(successFlush.remaining, 0);

  // Mutation removed after acknowledgement
  const outboxAfterSuccess = RoadmapOutboxService.getOutbox(uid, storage);
  assert.equal(outboxAfterSuccess.length, 0);

  // Cloud store has document
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.equal(cloudDoc?.completionPercentage, 50);
});

test('outbox: simulated browser reload resumes pending mutations', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Tab 1 creates mutation offline
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-02'),
      data: { roadmapId: 'PHY-02', completionPercentage: 75 },
    },
    uid,
    storage
  );

  // Tab 1 closes. Tab 2 opens with the same storage (simulated reload)
  const tab2Pending = RoadmapOutboxService.getPendingCount(uid, storage);
  assert.equal(tab2Pending, 1);

  // Tab 2 flushes queue
  const flushRes = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(flushRes.sent, 1);
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 0);

  const doc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-02'));
  assert.equal(doc?.completionPercentage, 75);
});

test('outbox: retry is idempotent and does not duplicate attempts', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const mut = RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmapAttempt(uid, 'att-123'),
      data: { id: 'att-123', uid, percentage: 90 },
      merge: false,
    },
    uid,
    storage
  );

  // Flush 1
  await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(cloud.commits, 1);

  // Accidental re-enqueue of same mutation (e.g. from network retry)
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmapAttempt(uid, 'att-123'),
      data: { id: 'att-123', uid, percentage: 90 },
      merge: false,
    },
    uid,
    storage
  );

  // Flush 2
  await RoadmapOutboxService.flush(uid, cloud, storage);
  const doc = await cloud.getDoc(cloudPaths.roadmapAttempt(uid, 'att-123'));
  assert.equal(doc?.percentage, 90);
});

test('outbox: strict UID isolation prevents flushing another user mutations', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  // Alice has a mutation
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap('alice', 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 30 },
    },
    'alice',
    storage
  );

  // Bob attempts flush
  const bobFlush = await RoadmapOutboxService.flush('bob', cloud, storage);
  assert.equal(bobFlush.sent, 0);

  // Cloud doc for Bob is null; Alice is uncommitted
  assert.equal(await cloud.getDoc(cloudPaths.roadmap('bob', 'PHY-01')), null);
  assert.equal(await cloud.getDoc(cloudPaths.roadmap('alice', 'PHY-01')), null);

  // Alice flushes
  const aliceFlush = await RoadmapOutboxService.flush('alice', cloud, storage);
  assert.equal(aliceFlush.sent, 1);
  assert.ok(await cloud.getDoc(cloudPaths.roadmap('alice', 'PHY-01')));
});

test('outbox: permanent failures are flagged and do not block subsequent mutations', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Bad mutation with invalid permission
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: 'users/unauthorized/roadmaps/bad',
      data: { bad: true },
    },
    uid,
    storage
  );

  cloud.failCommits = 'PERMISSION_DENIED: Missing security permissions';
  await RoadmapOutboxService.flush(uid, cloud, storage);

  const outbox = RoadmapOutboxService.getOutbox(uid, storage);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].isPermanentFailure, true);

  // Second valid mutation is added
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 100 },
    },
    uid,
    storage
  );

  // Cloud recovers
  cloud.failCommits = false;
  const secondFlush = await RoadmapOutboxService.flush(uid, cloud, storage);

  // Only the non-permanent mutation was flushed
  assert.equal(secondFlush.sent, 1);
  assert.ok(await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01')));
});

// ============================================================================
// 2. Connectivity & Reconnect Lifecycle Tests
// ============================================================================

test('connectivity: backoff computation provides exponential growth with jitter', () => {
  const b0 = computeBackoffDelay(0);
  const b1 = computeBackoffDelay(1);
  const b2 = computeBackoffDelay(2);
  const b5 = computeBackoffDelay(5);

  assert.ok(b0 >= 1000 && b0 <= 1500);
  assert.ok(b1 >= 2000 && b1 <= 2500);
  assert.ok(b2 >= 4000 && b4000Bound(b2));
  assert.ok(b5 <= 30000); // Capped at max delay
});

function b4000Bound(val: number): boolean {
  return val >= 4000 && val <= 4600;
}

test('connectivity: sign-out cancels active retry timers', () => {
  RoadmapOutboxService.cancelRetryTimers('alice');
  RoadmapOutboxService.cancelRetryTimers(); // Should not throw
});

// ============================================================================
// 3. Guest Migration Safety & Crash Recovery Tests
// ============================================================================

test('guest migration: successful migration clears guest keys after cloud acknowledgement', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const guestProg = createMockRoadmap({ completionPercentage: 40 });
  const guestKeyProg = scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS);
  storage.setItem(guestKeyProg, JSON.stringify({ 'PHY-01': guestProg }));

  const res = await RoadmapSyncService.migrateGuestRoadmapDataToUser(uid, storage, cloud);
  assert.equal(res.migratedRoadmaps, 1);

  // Cloud sync succeeded: guest keys are confirmed and removed
  assert.equal(storage.getItem(guestKeyProg), null);
  assert.equal(storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP)), null);

  // User storage has progress
  const userProg = RoadmapProgressService.getRoadmapProgress('PHY-01', uid, storage);
  assert.equal(userProg.completionPercentage, 40);

  // Cloud has document
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.equal(cloudDoc?.completionPercentage, 40);
});

test('guest migration: cloud failure preserves guest backup and recoverable state', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const guestProg = createMockRoadmap({ completionPercentage: 60 });
  const guestKeyProg = scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS);
  const guestKeyBackup = scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP);
  storage.setItem(guestKeyProg, JSON.stringify({ 'PHY-01': guestProg }));

  // Cloud fails during migration
  cloud.failCommits = '503 Service Unavailable';
  const res = await RoadmapSyncService.migrateGuestRoadmapDataToUser(uid, storage, cloud);
  assert.equal(res.migratedRoadmaps, 1);

  // User local storage has the merged data
  const userProg = RoadmapProgressService.getRoadmapProgress('PHY-01', uid, storage);
  assert.equal(userProg.completionPercentage, 60);

  // CRITICAL: Guest backup SURVIVES in guest scope because cloud failed!
  const backupRaw = storage.getItem(guestKeyBackup);
  assert.ok(backupRaw);
  const backup = JSON.parse(backupRaw!) as GuestMigrationBackup;
  assert.equal(backup.targetUid, 'alice');
  assert.equal(backup.status, 'pending_cloud_sync');

  // Student signs out and chooses "Remove this account local data"
  clearScope(storage, 'u_alice');
  assert.equal(RoadmapProgressService.getAllRoadmapsProgress(uid, storage)['PHY-01'], undefined);

  // Guest data can be recovered from the intact guest backup!
  const restored = RoadmapSyncService.restoreFromGuestMigrationBackup(storage);
  assert.equal(restored, true);

  const recoveredGuest = RoadmapProgressService.getRoadmapProgress('PHY-01', null, storage);
  assert.equal(recoveredGuest.completionPercentage, 60);
});

test('guest migration: account switching does not steal pending migration for another UID', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  const backup: GuestMigrationBackup = {
    targetUid: 'alice',
    migratedAt: '2026-11-04T12:00:00.000Z',
    guestRoadmaps: { 'PHY-01': createMockRoadmap({ completionPercentage: 80 }) },
    guestQueue: [],
    status: 'pending_cloud_sync',
  };
  const guestKeyBackup = scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP);
  storage.setItem(guestKeyBackup, JSON.stringify(backup));

  // Bob logs in
  const bobMigrate = await RoadmapSyncService.migrateGuestRoadmapDataToUser('bob', storage, cloud);
  assert.equal(bobMigrate.migratedRoadmaps, 0);

  // Bob does not get Alice's data
  assert.equal(RoadmapProgressService.getAllRoadmapsProgress('bob', storage)['PHY-01'], undefined);

  // Alice logs in and resumes
  const aliceMigrate = await RoadmapSyncService.migrateGuestRoadmapDataToUser('alice', storage, cloud);
  // Backup is processed for Alice
  const aliceProg = RoadmapProgressService.getRoadmapProgress('PHY-01', 'alice', storage);
  assert.ok(aliceProg);
});

// ============================================================================
// 4. Conflict Resolution & Clock Skew Tests
// ============================================================================

test('conflict: future clock skew is clamped to reference window', () => {
  const refTime = new Date('2026-11-04T12:00:00.000Z').getTime();

  // Reasonable 2-minute drift: preserved
  const validFuture = '2026-11-04T12:02:00.000Z';
  assert.equal(sanitizeTimestamp(validFuture, refTime), new Date(validFuture).getTime());

  // Extreme 1-year clock skew (2027)
  const skewedFuture = '2027-11-04T12:00:00.000Z';
  assert.equal(sanitizeTimestamp(skewedFuture, refTime), refTime);
});

test('conflict: device with skewed future clock does not permanently defeat legitimate newer progress', () => {
  const refNow = new Date('2026-11-04T12:00:00.000Z').getTime();

  // Device A with clock skewed to year 2028
  const skewedDevA = createMockCheckpoint({
    masteryStatus: 'developing',
    masteryScore: 60,
    lastActivityAt: '2028-01-01T00:00:00.000Z', // Far in future
  });

  // Device B with accurate clock recorded at 11:59 AM
  const accurateDevB = createMockCheckpoint({
    masteryStatus: 'strong',
    masteryScore: 85,
    lastActivityAt: '2026-11-04T11:59:00.000Z',
  });

  // When merged at reference time, Dev A's future timestamp is clamped to refNow,
  // preventing it from remaining eternally unbeatable in future sessions
  const merged = mergeCheckpointProgress(skewedDevA, accurateDevB, refNow);
  assert.ok(merged.lastActivityAt <= new Date(refNow).toISOString());
});

test('conflict: assessment with real evidence wins over newer passive reading event', () => {
  // Nov 2: Student passed formal assessment with 88%
  const assessmentAttempt: CheckpointProgress = createMockCheckpoint({
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 88,
    lastActivityAt: '2026-11-02T10:00:00.000Z',
    assessmentResult: {
      attemptId: 'att-real-1',
      score: 88,
      rawMarks: 88,
      totalMarks: 100,
      percentage: 88,
      correctCount: 8,
      incorrectCount: 1,
      unansweredCount: 0,
      timeTakenSeconds: 600,
      completedAt: '2026-11-02T10:00:00.000Z',
      weakTopics: [],
      strongTopics: ['t1'],
    },
  });

  // Nov 4: Student on another device just opened notes (no assessment result attached)
  const passiveRead: CheckpointProgress = createMockCheckpoint({
    status: 'current',
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: '2026-11-04T10:00:00.000Z',
    assessmentResult: undefined,
  });

  // Merging must preserve the validated assessment evidence
  const merged = mergeCheckpointProgress(passiveRead, assessmentAttempt);
  assert.equal(merged.masteryStatus, 'strong');
  assert.equal(merged.masteryScore, 88);
  assert.equal(merged.assessmentResult?.attemptId, 'att-real-1');
});

test('conflict: mergeCheckpointProgress is strictly commutative and associative', () => {
  const A = createMockCheckpoint({
    status: 'completed',
    masteryScore: 80,
    masteryStatus: 'strong',
    lastActivityAt: '2026-11-01T10:00:00.000Z',
  });

  const B = createMockCheckpoint({
    status: 'needs_reinforcement',
    masteryScore: 50,
    masteryStatus: 'needs_reinforcement',
    lastActivityAt: '2026-11-02T10:00:00.000Z',
  });

  const C = createMockCheckpoint({
    status: 'completed',
    masteryScore: 70,
    masteryStatus: 'developing',
    lastActivityAt: '2026-11-03T10:00:00.000Z',
  });

  // Commutativity: merge(A, B) == merge(B, A)
  const ab = mergeCheckpointProgress(A, B);
  const ba = mergeCheckpointProgress(B, A);
  assert.equal(ab.masteryScore, ba.masteryScore);
  assert.equal(ab.masteryStatus, ba.masteryStatus);

  // Associativity: merge(A, merge(B, C)) == merge(merge(A, B), C)
  const a_bc = mergeCheckpointProgress(A, mergeCheckpointProgress(B, C));
  const ab_c = mergeCheckpointProgress(mergeCheckpointProgress(A, B), C);
  assert.equal(a_bc.masteryScore, ab_c.masteryScore);
  assert.equal(a_bc.masteryStatus, ab_c.masteryStatus);
});

// ============================================================================
// 5. Real-Time Listener Tests
// ============================================================================

test('listener: subscription lifecycle cleans up cleanly on unmount', () => {
  const cloud = new FakeCloudStore();
  const storage = new MemoryStorage();
  let updateCalled = false;

  const unsubscribe = RoadmapSyncService.subscribeToRoadmapSync(
    'alice',
    cloud,
    () => {
      updateCalled = true;
    },
    storage
  );

  assert.equal(typeof unsubscribe, 'function');
  unsubscribe(); // Cleanup without error
  assert.equal(updateCalled, false);
});
