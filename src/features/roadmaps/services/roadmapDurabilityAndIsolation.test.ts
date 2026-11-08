import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoadmapOutboxService,
  OutboxPersistenceError,
} from './roadmapOutboxService';
import {
  RoadmapSyncCoordinator,
} from './roadmapSyncCoordinator';
import {
  RoadmapSyncService,
  mergeRoadmapProgress,
  normalizeTimestamp,
} from './roadmapSyncService';
import { MemoryStorage, FakeCloudStore } from '../../../services/testDoubles';
import { performSignOut, prepareSignOutSummary } from '../../../services/signOutFlow';
import { HybridCloudStudyRepository } from '../../../services/storageService';
import { cloudPaths } from '../../../services/cloudStore';
import type { RoadmapProgress } from '../types/progress.types';
import type { User } from 'firebase/auth';

function makeMockUser(uid: string): User {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: `User ${uid}`,
  } as unknown as User;
}

function createMockRoadmap(id: string, overrides: Partial<RoadmapProgress> = {}): RoadmapProgress {
  return {
    roadmapId: id as any,
    completionPercentage: 50,
    completedCheckpointsCount: 2,
    currentCheckpointId: `${id}-CP2`,
    checkpoints: {},
    lastActivityAt: '2026-11-04T12:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// 1. HIGH — Outbox Persistence Failures & Durability Guarantees
// ============================================================================

test('durability: QuotaExceededError throws OutboxPersistenceError and preserves unpersisted mutation in memory', () => {
  const uid = 'quota_user';
  // MemoryStorage with tiny 10-byte quota to force QuotaExceededError
  const tinyStorage = new MemoryStorage(10);

  RoadmapOutboxService.clearOutbox(uid, tinyStorage);
  assert.equal(RoadmapOutboxService.getUnpersistedCount(uid), 0);

  let caughtError: OutboxPersistenceError | null = null;
  try {
    RoadmapOutboxService.enqueue(
      {
        type: 'set',
        path: cloudPaths.roadmap(uid, 'PHY-01'),
        data: { roadmapId: 'PHY-01', completionPercentage: 75 },
        merge: true,
      },
      uid,
      tinyStorage
    );
  } catch (err) {
    if (err instanceof OutboxPersistenceError) {
      caughtError = err;
    }
  }

  assert.ok(caughtError, 'Must throw OutboxPersistenceError on quota failure');
  assert.equal(caughtError.uid, uid);
  assert.equal(caughtError.code, 'PERSISTENCE_FAILED');
  assert.equal(caughtError.mutations.length, 1);

  // Unpersisted mutation is held in bounded volatile memory rather than silently dropped
  assert.equal(RoadmapOutboxService.getUnpersistedCount(uid), 1);
  const unpersisted = RoadmapOutboxService.getUnpersistedMutations(uid);
  assert.equal(unpersisted.length, 1);
  assert.equal(unpersisted[0].path, cloudPaths.roadmap(uid, 'PHY-01'));

  // Clean up
  RoadmapOutboxService.clearUnpersisted(uid);
});

test('durability: generic storage failure throws OutboxPersistenceError with cause attached', () => {
  const uid = 'failing_storage_user';
  const failingStorage = {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: () => {
      throw new Error('Disk IO failure: EIO');
    },
    removeItem: () => {},
  };

  RoadmapOutboxService.clearUnpersisted(uid);

  assert.throws(
    () => {
      RoadmapOutboxService.enqueueBatch(
        [
          {
            type: 'set',
            path: cloudPaths.roadmap(uid, 'CHEM-01'),
            data: { roadmapId: 'CHEM-01' },
            merge: true,
          },
        ],
        uid,
        failingStorage
      );
    },
    (err: unknown) => {
      return (
        err instanceof OutboxPersistenceError &&
        err.message.includes('Disk IO failure: EIO') &&
        err.mutations.length === 1
      );
    }
  );

  assert.equal(RoadmapOutboxService.getUnpersistedCount(uid), 1);
  RoadmapOutboxService.clearUnpersisted(uid);
});

test('durability: coordinator reports persistence_failed state when unpersisted mutations exist', async () => {
  const coordinator = RoadmapSyncCoordinator.getInstance();
  const uid = 'coordinator_durability_user';
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  coordinator.setUser(makeMockUser(uid), cloud, storage);
  await new Promise((r) => setTimeout(r, 20));

  // Force persistence failure
  const tinyStorage = new MemoryStorage(10);
  try {
    RoadmapOutboxService.enqueue(
      {
        type: 'set',
        path: cloudPaths.roadmap(uid, 'MATH-01'),
        data: { roadmapId: 'MATH-01' },
        merge: true,
      },
      uid,
      tinyStorage
    );
  } catch {}

  coordinator.notifyPersistenceChange();
  const status = coordinator.getStatus();
  assert.equal(status.state, 'persistence_failed');
  assert.equal(status.unpersistedCount, 1);

  // Clean up
  RoadmapOutboxService.clearUnpersisted(uid);
});

test('durability: sign-out and account data removal block when unpersisted mutations exist', async () => {
  const uid = 'signout_durability_user';
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  // Cloud commits fail so pre-sign-out flush cannot commit to cloud
  cloud.failCommits = 'Offline during signout';

  const repo = new HybridCloudStudyRepository({ storage });
  repo.activateAccount(makeMockUser(uid));

  // Force an unpersisted mutation into memory
  const tinyStorage = new MemoryStorage(10);
  try {
    RoadmapOutboxService.enqueue(
      {
        type: 'set',
        path: cloudPaths.roadmap(uid, 'PHY-02'),
        data: { roadmapId: 'PHY-02' },
        merge: true,
      },
      uid,
      tinyStorage
    );
  } catch {}

  assert.equal(RoadmapOutboxService.getUnpersistedCount(uid), 1);

  // 1. Sign-out summary reports unpersisted mutation
  const summary = await prepareSignOutSummary(repo, { uid }, { cloud, customStorage: storage });
  assert.equal(summary.roadmapUnpersisted, 1);

  // 2. performSignOut refuses destructive removal
  let signedOutCalled = false;
  const result = await performSignOut({
    choice: 'remove',
    uid,
    storage: repo,
    signOut: async () => {
      signedOutCalled = true;
    },
    cloud,
    customStorage: storage,
  });

  assert.equal(result.status, 'failed');
  assert.equal((result as any).blockedByRoadmapOutbox, true);
  assert.equal((result as any).roadmapUnpersisted, 1);
  assert.equal(signedOutCalled, false, 'signOut must not be called when unpersisted mutations exist');

  // 3. removeAccountDataFromDevice refuses removal
  assert.throws(() => {
    repo.removeAccountDataFromDevice(uid);
  }, /unpersisted roadmap mutations remain/);

  // 4. If forced, removal succeeds and clears unpersisted mutations
  const forcedResult = await performSignOut({
    choice: 'remove',
    uid,
    storage: repo,
    signOut: async () => {},
    cloud,
    customStorage: storage,
    forceRemoveWithUnsyncedRoadmap: true,
  });
  assert.equal(forcedResult.status, 'signed_out');
  assert.equal(RoadmapOutboxService.getUnpersistedCount(uid), 0);
});

test('durability: online cloud flush flushes unpersisted mutations and clears in-memory stash upon acknowledgement', async () => {
  const uid = 'flush_unpersisted_user';
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  // Create an unpersisted mutation
  const tinyStorage = new MemoryStorage(10);
  try {
    RoadmapOutboxService.enqueue(
      {
        type: 'set',
        path: cloudPaths.roadmap(uid, 'PHY-03'),
        data: { roadmapId: 'PHY-03', completionPercentage: 100 },
        merge: true,
      },
      uid,
      tinyStorage
    );
  } catch {}

  assert.equal(RoadmapOutboxService.getUnpersistedCount(uid), 1);

  // Cloud flush commits both persisted and unpersisted mutations
  const flushRes = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(flushRes.sent, 1);
  assert.equal(flushRes.failed, 0);

  // After durable cloud confirmation, unpersisted in-memory entries are cleared
  assert.equal(RoadmapOutboxService.getUnpersistedCount(uid), 0);

  // Cloud store received the document
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-03'));
  assert.ok(cloudDoc);
  assert.equal(cloudDoc.completionPercentage, 100);
});

// ============================================================================
// 2. MEDIUM — Account-Switch Isolation & Teardown Verification
// ============================================================================

test('isolation: teardownCurrent resets lastError and lastSyncedAt completely', async () => {
  const coordinator = RoadmapSyncCoordinator.getInstance();
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  const userA = makeMockUser('user_alpha');
  const userB = makeMockUser('user_beta');

  coordinator.setUser(userA, cloud, storage);
  await new Promise((r) => setTimeout(r, 20));

  // User A encounters a sync failure during outbox commit
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(userA.uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01' },
      merge: true,
    },
    userA.uid,
    storage
  );
  cloud.listCollection = async () => {
    throw new Error('User A simulated Firestore quota exceeded');
  };
  await coordinator.triggerSync();

  const statusA = coordinator.getStatus();
  assert.equal(statusA.state, 'sync_failed');
  assert.ok(statusA.lastError?.includes('User A simulated Firestore quota exceeded'));

  // Switch to User B (offline)
  const originalNav = globalThis.navigator;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
      writable: true,
    });

    coordinator.setUser(userB, cloud, storage);

    // User B MUST NOT see User A's error!
    const statusB = coordinator.getStatus();
    assert.equal(statusB.lastError, null, 'User B must not see User A stale error');
    assert.equal(statusB.lastSyncedAt, null, 'User B must not see User A stale syncedAt');
    assert.notEqual(statusB.state, 'sync_failed');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNav,
      configurable: true,
      writable: true,
    });
  }

  // Restore normal cloud operations
  cloud.listCollection = async () => [];
  cloud.commit = async () => {};
  await coordinator.triggerSync();
  const finalStatusB = coordinator.getStatus();
  assert.equal(finalStatusB.state, 'synced');
  assert.ok(finalStatusB.lastSyncedAt !== null);
  assert.equal(finalStatusB.lastError, null);
});

test('isolation: stale async promise from previous user cannot mutate next user state', async () => {
  const coordinator = RoadmapSyncCoordinator.getInstance();
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  const userA = makeMockUser('slow_user_a');
  const userB = makeMockUser('fast_user_b');

  coordinator.setUser(userA, cloud, storage);
  await new Promise((r) => setTimeout(r, 20));

  // Enqueue a mutation for User A so triggerSync invokes cloud.commit
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(userA.uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01' },
      merge: true,
    },
    userA.uid,
    storage
  );

  // Make User A's commit delayed
  let resolveUserACommit!: () => void;
  cloud.commit = async () => {
    return new Promise((resolve) => {
      resolveUserACommit = resolve;
    });
  };

  // Start User A sync (async, currently pending in cloud)
  const syncPromiseA = coordinator.triggerSync();
  assert.equal(coordinator.getStatus().state, 'syncing');

  // Before User A's sync finishes, switch to User B!
  cloud.commit = async () => {}; // User B commits instantly
  coordinator.setUser(userB, cloud, storage);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(coordinator.getStatus().lastError, null);

  // Now User A's delayed promise finally resolves!
  resolveUserACommit();
  await syncPromiseA;

  // Verify User B's state was not corrupted by User A's delayed resolution
  const statusB = coordinator.getStatus();
  assert.equal(statusB.lastError, null);
  assert.equal(coordinator.getStatus().pendingCount, 0);
});

// ============================================================================
// 3. LOW — Timestamp Normalization & Merge Symmetry
// ============================================================================

test('timestamp: normalizeTimestamp canonicalizes different valid ISO formats to identical string', () => {
  const refNow = new Date('2026-11-04T12:00:00.000Z').getTime();

  const withMillis = '2026-11-04T10:30:00.000Z';
  const withoutMillis = '2026-11-04T10:30:00Z';
  const withOffset = '2026-11-04T16:00:00+05:30'; // Same UTC instant (10:30Z)

  const n1 = normalizeTimestamp(withMillis, refNow);
  const n2 = normalizeTimestamp(withoutMillis, refNow);
  const n3 = normalizeTimestamp(withOffset, refNow);

  assert.equal(n1, '2026-11-04T10:30:00.000Z');
  assert.equal(n2, '2026-11-04T10:30:00.000Z');
  assert.equal(n3, '2026-11-04T10:30:00.000Z');
  assert.equal(n1, n2);
  assert.equal(n2, n3);
});

test('timestamp: normalizeTimestamp handles missing, malformed and future timestamps safely', () => {
  const refNow = new Date('2026-11-04T12:00:00.000Z').getTime();

  // Missing
  assert.equal(normalizeTimestamp(undefined, refNow), '1970-01-01T00:00:00.000Z');
  assert.equal(normalizeTimestamp('', refNow), '1970-01-01T00:00:00.000Z');

  // Malformed
  assert.equal(normalizeTimestamp('not_a_valid_date', refNow), '1970-01-01T00:00:00.000Z');

  // Excessive future skew (> 5 mins) clamped to referenceNow
  const future = new Date(refNow + 30 * 60 * 1000).toISOString();
  assert.equal(normalizeTimestamp(future, refNow), new Date(refNow).toISOString());
});

test('symmetry: mergeRoadmapProgress is strictly symmetric under local/remote argument reversal', () => {
  const refNow = new Date('2026-11-04T12:00:00.000Z').getTime();

  // Record A has timestamp with milliseconds
  const rA = createMockRoadmap('PHY-01', {
    completionPercentage: 50,
    completedCheckpointsCount: 2,
    currentCheckpointId: 'PHY-01-CP2',
    lastActivityAt: '2026-11-04T10:30:00.000Z',
  });

  // Record B represents the exact same instant without milliseconds
  const rB = createMockRoadmap('PHY-01', {
    completionPercentage: 50,
    completedCheckpointsCount: 2,
    currentCheckpointId: 'PHY-01-CP2',
    lastActivityAt: '2026-11-04T10:30:00Z',
  });

  const res1 = mergeRoadmapProgress(rA, rB, refNow);
  const res2 = mergeRoadmapProgress(rB, rA, refNow);

  // Strict deep equality regardless of argument order!
  assert.deepEqual(res1, res2, 'mergeRoadmapProgress(A, B) must equal mergeRoadmapProgress(B, A)');
  assert.equal(res1.lastActivityAt, '2026-11-04T10:30:00.000Z');
  assert.equal(res2.lastActivityAt, '2026-11-04T10:30:00.000Z');
});

test('symmetry: mergeRoadmapProgress handles missing and malformed timestamps deterministically', () => {
  const refNow = new Date('2026-11-04T12:00:00.000Z').getTime();

  // Valid vs missing
  const rValid = createMockRoadmap('PHY-01', {
    lastActivityAt: '2026-11-04T09:00:00.000Z',
  });
  const rMissing = createMockRoadmap('PHY-01', {
    lastActivityAt: undefined,
  });

  const resA = mergeRoadmapProgress(rValid, rMissing, refNow);
  const resB = mergeRoadmapProgress(rMissing, rValid, refNow);

  assert.deepEqual(resA, resB);
  assert.equal(resA.lastActivityAt, '2026-11-04T09:00:00.000Z');

  // Repeated merge stability: merge(merge(A, B), B) === merge(A, B)
  const resRepeated = mergeRoadmapProgress(resA, rValid, refNow);
  assert.deepEqual(resA, resRepeated);
});
