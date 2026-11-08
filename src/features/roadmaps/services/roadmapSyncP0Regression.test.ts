import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadmapOutboxService } from './roadmapOutboxService';
import {
  RoadmapSyncService,
  mergeCheckpointProgress,
  encodeRoadmapProgressDoc,
} from './roadmapSyncService';
import { RoadmapProgressService } from './roadmapProgressService';
import { MemoryStorage, FakeCloudStore, fakeUser } from '../../../services/testDoubles';
import { scopedKey, STORAGE_KEYS } from '../../../services/localScope';
import { cloudPaths } from '../../../services/cloudStore';
import { performSignOut } from '../../../services/signOutFlow';
import { HybridCloudStudyRepository } from '../../../services/storageService';
import type { CheckpointProgress, RoadmapProgress } from '../types/progress.types';

function createCheckpoint(overrides: Partial<CheckpointProgress> = {}): CheckpointProgress {
  return {
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    status: 'locked',
    currentStage: 'diagnostic',
    diagnosticCleared: false,
    revisionCompleted: false,
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: new Date(0).toISOString(),
    historicalAttemptsCount: 0,
    ...overrides,
  };
}

function createRoadmap(overrides: Partial<RoadmapProgress> = {}): RoadmapProgress {
  return {
    roadmapId: 'PHY-01',
    completionPercentage: 25,
    completedCheckpointsCount: 1,
    currentCheckpointId: 'PHY-01-CP1',
    checkpoints: {
      'PHY-01-CP1': createCheckpoint({ status: 'current' }),
    },
    lastActivityAt: '2026-11-04T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Successful sync
// ---------------------------------------------------------------------------
test('P0 Regression 1: Successful sync merges local and cloud state and writes only diffs', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Cloud already has Roadmap PHY-01
  const cloudRoadmap = createRoadmap({
    roadmapId: 'PHY-01',
    completionPercentage: 50,
    lastActivityAt: '2026-11-04T12:00:00.000Z',
  });
  cloud.docs.set(cloudPaths.roadmap(uid, 'PHY-01'), encodeRoadmapProgressDoc(uid, cloudRoadmap));

  // Local storage has Roadmap PHY-02
  const localRoadmap2 = createRoadmap({
    roadmapId: 'PHY-02',
    completionPercentage: 10,
    lastActivityAt: '2026-11-04T13:00:00.000Z',
  });
  storage.setItem(
    scopedKey(`u_${uid}`, STORAGE_KEYS.ROADMAP_PROGRESS),
    JSON.stringify({ 'PHY-02': localRoadmap2 })
  );

  // Perform sync
  const res = await RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, storage);
  assert.ok(res.synchedRoadmaps >= 1);

  // Both roadmaps exist locally
  const allLocal = RoadmapProgressService.getAllRoadmapsProgress(uid, storage);
  assert.ok(allLocal['PHY-01']);
  assert.ok(allLocal['PHY-02']);
  assert.equal(allLocal['PHY-01'].completionPercentage, 50);
  assert.equal(allLocal['PHY-02'].completionPercentage, 10);

  // Cloud now has PHY-02 written
  const cloudDoc2 = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-02'));
  assert.ok(cloudDoc2);
  assert.equal(cloudDoc2.completionPercentage, 10);
});

// ---------------------------------------------------------------------------
// 2. Offline write and reconnect
// ---------------------------------------------------------------------------
test('P0 Regression 2: Offline writes queue mutations and flush on reconnect', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Network is down
  cloud.failCommits = 'Network connection failed (offline)';

  // Offline mutation enqueued
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 75 },
    },
    uid,
    storage
  );

  // Flush fails due to offline state
  const flushRes = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(flushRes.sent, 0);
  assert.equal(flushRes.failed, 1);
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 1);

  // Network reconnects
  cloud.failCommits = false;

  // Flush succeeds on reconnect
  const reconnectFlush = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(reconnectFlush.sent, 1);
  assert.equal(reconnectFlush.failed, 0);
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 0);

  // Document reached cloud store
  const saved = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.equal(saved?.completionPercentage, 75);
});

// ---------------------------------------------------------------------------
// 3. Retry after failure
// ---------------------------------------------------------------------------
test('P0 Regression 3: Transient commit failures backoff safely and retry without data loss', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'CHEM-01'),
      data: { roadmapId: 'CHEM-01', completionPercentage: 40 },
    },
    uid,
    storage
  );

  // First attempt fails with 503
  cloud.failCommits = '503 Service Unavailable';
  const r1 = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(r1.sent, 0);
  assert.equal(r1.failed, 1);

  const outbox = RoadmapOutboxService.getOutbox(uid, storage);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].attemptCount, 1);
  assert.equal(outbox[0].isPermanentFailure, false);
  assert.ok(outbox[0].lastError?.includes('503'));

  // Cloud recovers
  cloud.failCommits = false;

  const r2 = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(r2.sent, 1);
  assert.equal(r2.failed, 0);
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 0);
});

// ---------------------------------------------------------------------------
// 4. Duplicate retry / Batch coalescing
// ---------------------------------------------------------------------------
test('P0 Regression 4: Multiple mutations targeting the same path in a single batch coalesce to avoid Firestore duplicate error', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const path = cloudPaths.roadmap(uid, 'MATH-01');

  // Rapid student activity causes two writes to the exact same path
  RoadmapOutboxService.enqueue(
    { type: 'set', path, data: { roadmapId: 'MATH-01', completionPercentage: 10 } },
    uid,
    storage
  );
  RoadmapOutboxService.enqueue(
    { type: 'set', path, data: { roadmapId: 'MATH-01', completionPercentage: 20 } },
    uid,
    storage
  );

  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 2);

  // Firestore commit batch would throw "A document cannot be written more than once in a single batch"
  // unless RoadmapOutboxService coalesces them.
  let batchOpsCount = 0;
  const originalCommit = cloud.commit.bind(cloud);
  cloud.commit = async (ops) => {
    batchOpsCount = ops.length;
    // Verify paths in this batch are strictly unique
    const seen = new Set<string>();
    for (const op of ops) {
      if (seen.has(op.path)) {
        throw new Error(`Firestore InvalidArgument: Document ${op.path} cannot be written multiple times`);
      }
      seen.add(op.path);
    }
    return originalCommit(ops);
  };

  const res = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(res.sent, 2);
  assert.equal(res.failed, 0);
  assert.equal(batchOpsCount, 1, 'Two duplicate path mutations were coalesced into one batch write');

  // The latest write won
  const saved = await cloud.getDoc(path);
  assert.equal(saved?.completionPercentage, 20);
});

// ---------------------------------------------------------------------------
// 5. Account switching
// ---------------------------------------------------------------------------
test('P0 Regression 5: Account switching completely isolates outboxes and progress', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  // Alice enqueues a pending write
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap('alice', 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 60 },
    },
    'alice',
    storage
  );
  assert.equal(RoadmapOutboxService.getPendingCount('alice', storage), 1);

  // Bob signs in
  assert.equal(RoadmapOutboxService.getPendingCount('bob', storage), 0);
  assert.equal(RoadmapProgressService.getAllRoadmapsProgress('bob', storage)['PHY-01'], undefined);

  // Bob enqueues his own mutation
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap('bob', 'CHEM-01'),
      data: { roadmapId: 'CHEM-01', completionPercentage: 90 },
    },
    'bob',
    storage
  );

  // Flush for Bob only flushes Bob's mutation
  const bobFlush = await RoadmapOutboxService.flush('bob', cloud, storage);
  assert.equal(bobFlush.sent, 1);
  assert.equal(RoadmapOutboxService.getPendingCount('bob', storage), 0);

  // Alice's outbox is completely unaffected and preserved
  assert.equal(RoadmapOutboxService.getPendingCount('alice', storage), 1);
});

// ---------------------------------------------------------------------------
// 6. Guest migration
// ---------------------------------------------------------------------------
test('P0 Regression 6: Guest progress migrates safely without dropping or overwriting data', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Guest accumulated checkpoint progress
  const guestProg: RoadmapProgress = {
    roadmapId: 'PHY-01',
    completionPercentage: 50,
    completedCheckpointsCount: 2,
    currentCheckpointId: 'PHY-01-CP2',
    checkpoints: {
      'PHY-01-CP1': createCheckpoint({
        checkpointId: 'PHY-01-CP1',
        masteryStatus: 'strong',
        masteryScore: 85,
        lastActivityAt: '2026-11-04T10:00:00.000Z',
      }),
    },
    lastActivityAt: '2026-11-04T10:00:00.000Z',
  };
  storage.setItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS), JSON.stringify({ 'PHY-01': guestProg }));

  // Alice signs in and migrates guest data
  const result = await RoadmapSyncService.migrateGuestRoadmapDataToUser(uid, storage, cloud);
  assert.equal(result.migratedRoadmaps, 1);

  // Alice now has the guest progress
  const aliceProg = RoadmapProgressService.getRoadmapProgress('PHY-01', uid, storage);
  assert.equal(aliceProg.completionPercentage, 50);
  assert.equal(aliceProg.checkpoints['PHY-01-CP1'].masteryStatus, 'strong');

  // Cloud document was committed
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.ok(cloudDoc);
  assert.equal(cloudDoc.completionPercentage, 50);
});

// ---------------------------------------------------------------------------
// 7. Conflicting local/cloud updates
// ---------------------------------------------------------------------------
test('P0 Regression 7: Unattempted/empty local checkpoints never overwrite earned cloud mastery', () => {
  // Cloud has genuine earned mastery
  const cloudCheckpoint = createCheckpoint({
    checkpointId: 'PHY-01-CP1',
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 92,
    historicalAttemptsCount: 3,
    lastActivityAt: '2026-11-03T10:00:00.000Z', // Yesterday
  });

  // Local is a freshly initialized default template with a newer timestamp (e.g. today)
  const localEmptyCheckpoint = createCheckpoint({
    checkpointId: 'PHY-01-CP1',
    status: 'current',
    masteryStatus: 'unattempted',
    masteryScore: 0,
    historicalAttemptsCount: 0,
    lastActivityAt: '2026-11-04T10:00:00.000Z', // Today (newer timestamp)
  });

  // Merge local and cloud
  const merged = mergeCheckpointProgress(localEmptyCheckpoint, cloudCheckpoint);

  // Cloud mastery must WIN despite local having a newer timestamp!
  assert.equal(merged.masteryStatus, 'strong');
  assert.equal(merged.masteryScore, 92);
  assert.equal(merged.historicalAttemptsCount, 3);
  assert.equal(merged.status, 'completed');
});

// ---------------------------------------------------------------------------
// 8. Sign-out with pending writes
// ---------------------------------------------------------------------------
test('P0 Regression 8: Sign-out preserves pending writes on keep, blocks unsafe removal on remove', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const repo = new HybridCloudStudyRepository({ storage });
  repo.attachCloudStore(cloud);
  let signOutCalls = 0;
  const signOut = async () => {
    signOutCalls++;
  };

  repo.activateAccount(fakeUser('alice'));

  // Enqueue pending roadmap mutation
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap('alice', 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 70 },
    },
    'alice',
    storage
  );

  // Scenario A: User chooses "Keep on this device"
  const keepRes = await performSignOut({
    choice: 'keep',
    uid: 'alice',
    storage: repo,
    signOut,
    cloud,
    customStorage: storage,
  });

  assert.equal(keepRes.status, 'signed_out');
  assert.equal((keepRes as any).kept, true);
  // Outbox is intact!
  assert.equal(RoadmapOutboxService.getPendingCount('alice', storage), 1);

  // Scenario B: User attempts "Remove" while offline (commits fail)
  repo.activateAccount(fakeUser('alice'));
  cloud.failCommits = '503 Service Unavailable';

  const removeRes = await performSignOut({
    choice: 'remove',
    uid: 'alice',
    storage: repo,
    signOut,
    cloud,
    customStorage: storage,
  });

  // Must fail and block destructive removal!
  assert.equal(removeRes.status, 'failed');
  assert.equal((removeRes as any).blockedByRoadmapOutbox, true);
  assert.equal(RoadmapOutboxService.getPendingCount('alice', storage), 1);
});
