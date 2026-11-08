import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadmapSyncCoordinator, type UnifiedSyncStatus } from './roadmapSyncCoordinator';
import { RoadmapOutboxService } from './roadmapOutboxService';
import { MemoryStorage, FakeCloudStore } from '../../../services/testDoubles';
import { cloudPaths } from '../../../services/cloudStore';
import type { User } from 'firebase/auth';

function makeMockUser(uid: string): User {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: `User ${uid}`,
  } as unknown as User;
}

test('roadmapSyncCoordinator: singleton instance persists across calls', () => {
  const c1 = RoadmapSyncCoordinator.getInstance();
  const c2 = RoadmapSyncCoordinator.getInstance();
  assert.equal(c1, c2, 'RoadmapSyncCoordinator should be a singleton');
});

test('roadmapSyncCoordinator: guest sessions do not subscribe to authenticated Firestore paths', () => {
  const coordinator = RoadmapSyncCoordinator.getInstance();
  const cloud = new FakeCloudStore();
  const storage = new MemoryStorage();

  let subscriptionCalled = false;
  cloud.subscribeCollection = () => {
    subscriptionCalled = true;
    return () => {};
  };

  coordinator.setUser(null, cloud, storage);

  assert.equal(subscriptionCalled, false, 'Guest session must not subscribe to Firestore paths');
  const status = coordinator.getStatus();
  assert.equal(status.state, 'synced');
  assert.equal(status.pendingCount, 0);
});

test('roadmapSyncCoordinator: UID change cleans up previous user subscription and sets new context', async () => {
  const coordinator = RoadmapSyncCoordinator.getInstance();
  const cloud = new FakeCloudStore();
  const storage = new MemoryStorage();

  let unsubscribedUserA = false;
  let userBSubscribed = false;

  cloud.subscribeCollection = (path?: string) => {
    if (path && path.includes('user_a')) {
      return () => {
        unsubscribedUserA = true;
      };
    }
    if (path && path.includes('user_b')) {
      userBSubscribed = true;
      return () => {};
    }
    return () => {};
  };

  // Set user A
  coordinator.setUser(makeMockUser('user_a'), cloud, storage);
  assert.equal(unsubscribedUserA, false);

  // Switch to user B
  coordinator.setUser(makeMockUser('user_b'), cloud, storage);
  assert.equal(unsubscribedUserA, true, 'User A subscription must be cleaned up on switch');
  assert.equal(userBSubscribed, true, 'User B subscription must be established');

  // Sign out (switch to null)
  coordinator.setUser(null, cloud, storage);
  assert.equal(coordinator.getStatus().pendingCount, 0);
});

test('roadmapSyncCoordinator: component mount/unmount does not stop coordinator lifecycle or timer', async () => {
  const coordinator = RoadmapSyncCoordinator.getInstance();
  const cloud = new FakeCloudStore();
  const storage = new MemoryStorage();
  const uid = 'nav_tester';

  coordinator.setUser(makeMockUser(uid), cloud, storage);
  // Wait for initial triggerSync to settle
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Simulate multiple component consumers (e.g. tabs or components mounting)
  const statuses: UnifiedSyncStatus[] = [];
  const unsub1 = coordinator.subscribeStatus((st) => statuses.push(st));
  const unsub2 = coordinator.subscribeStatus(() => {});

  // Enqueue a valid mutation while simulated component is mounted
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 80 },
      merge: true,
    },
    uid,
    storage
  );

  assert.equal(coordinator.getStatus().pendingCount, 1);

  // Simulate unmounting Tab 1 and Tab 2 (e.g. navigating from Roadmaps to Chapters)
  unsub1();
  unsub2();

  // Coordinator state and outbox remain intact independent of active tab
  assert.equal(coordinator.getStatus().pendingCount, 1);

  // Triggering sync from root coordinator successfully finishes even with 0 active UI consumers
  await coordinator.triggerSync();
  assert.equal(coordinator.getStatus().pendingCount, 0);
  assert.equal(coordinator.getStatus().state, 'synced');
});

test('roadmapSyncCoordinator: status transitions distinguish all 5 states', async () => {
  const coordinator = RoadmapSyncCoordinator.getInstance();
  const cloud = new FakeCloudStore();
  const storage = new MemoryStorage();
  const uid = 'status_tester';

  coordinator.setUser(makeMockUser(uid), cloud, storage);
  // Wait for initial triggerSync to settle
  await new Promise((resolve) => setTimeout(resolve, 20));

  // 1. Initial synced state
  assert.equal(coordinator.getStatus().state, 'synced');

  // 2. Offline with pending changes
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(uid, 'PHY-01'),
      data: { roadmapId: 'PHY-01', completionPercentage: 90 },
      merge: true,
    },
    uid,
    storage
  );

  // Mock navigator offline
  const originalNavigator = globalThis.navigator;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
      writable: true,
    });

    assert.equal(coordinator.getStatus().state, 'offline_pending');

    // Restore online
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });

    // 3. Syncing state during triggerSync
    let sawSyncing = false;
    const unsub = coordinator.subscribeStatus((st) => {
      if (st.state === 'syncing') sawSyncing = true;
    });

    await coordinator.triggerSync();
    unsub();
    assert.equal(sawSyncing, true, 'Should emit syncing state while operation runs');
    assert.equal(coordinator.getStatus().state, 'synced');

    // 4. Recoverable permanent failure
    // Enqueue a mutation
    RoadmapOutboxService.enqueue(
      {
        type: 'set',
        path: cloudPaths.roadmap(uid, 'PHY-02'),
        data: { roadmapId: 'PHY-02', completionPercentage: 50 },
        merge: true,
      },
      uid,
      storage
    );
    // Force permanent permission-denied error
    cloud.commit = async () => {
      const err = new Error('PERMISSION_DENIED');
      (err as any).code = 'permission-denied';
      throw err;
    };
    await RoadmapOutboxService.flush(uid, cloud, storage);

    const failures = RoadmapOutboxService.getPermanentFailures(uid, storage);
    assert.equal(failures.length, 1);
    assert.equal(coordinator.getStatus().state, 'has_failed_mutations');

    // 5. Retrying failed mutations restores synced state once cloud write succeeds
    cloud.commit = async (ops) => {
      // successful commit
    };
    const retryRes = await coordinator.retryFailedMutations();
    assert.equal(retryRes.succeeded, 1);
    assert.equal(coordinator.getStatus().state, 'synced');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  }
});
