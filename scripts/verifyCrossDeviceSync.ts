import assert from 'node:assert/strict';
import { MemoryStorage, FakeCloudStore } from '../src/services/testDoubles.ts';
import { RoadmapOutboxService } from '../src/features/roadmaps/services/roadmapOutboxService.ts';
import { RoadmapSyncService, decodeRoadmapProgressDoc, encodeRoadmapProgressDoc } from '../src/features/roadmaps/services/roadmapSyncService.ts';
import { RoadmapProgressService } from '../src/features/roadmaps/services/roadmapProgressService.ts';
import { cloudPaths } from '../src/services/cloudStore.ts';
import type { CheckpointProgress, RoadmapProgress, StageScore } from '../src/features/roadmaps/types/progress.types.ts';

async function runCrossDeviceSyncVerification() {
  console.log('=== CROSS-DEVICE SYNC & OUTBOX VERIFICATION ===\n');

  const cloud = new FakeCloudStore();
  const testUid = 'non-prod-student-042';

  // Device A setup
  const storageA = new MemoryStorage();

  // Device B setup
  const storageB = new MemoryStorage();

  // -------------------------------------------------------------------------
  // STEP 1: Sign in on Device A
  // -------------------------------------------------------------------------
  console.log('Step 1: Signing in on Device A with test UID:', testUid);
  await RoadmapSyncService.syncRoadmapsWithCloud(testUid, cloud, storageA);
  console.log('   ✓ Device A signed in. Initial cloud state loaded.');

  // -------------------------------------------------------------------------
  // STEP 2: Create a study progress mutation on Device A
  // -------------------------------------------------------------------------
  console.log('Step 2: Device A completes diagnostic on PHY-01-CP1...');
  const initRoadmapA = RoadmapProgressService.getRoadmapProgress('PHY-01', testUid, storageA);
  const cpA = initRoadmapA.checkpoints['PHY-01-CP1'];
  assert.ok(cpA);

  const diagScore: StageScore = {
    correct: 5,
    total: 5,
    percentage: 100,
    completedAt: '2026-11-08T16:00:00.000Z',
  };

  const updatedCpA: CheckpointProgress = {
    ...cpA,
    diagnosticCleared: true,
    diagnosticScore: diagScore,
    currentStage: 'revision',
    status: 'current',
    lastActivityAt: '2026-11-08T16:00:00.000Z',
  };

  RoadmapProgressService.saveCheckpointProgress(updatedCpA, testUid, storageA);
  await RoadmapSyncService.syncRoadmapsWithCloud(testUid, cloud, storageA);
  console.log('   ✓ Mutation persisted locally on Device A and synchronized to cloud.');

  // -------------------------------------------------------------------------
  // STEP 3: Verify it reaches Firestore (CloudStore)
  // -------------------------------------------------------------------------
  console.log('Step 3: Verifying mutation in CloudStore...');
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(testUid, 'PHY-01'));
  assert.ok(cloudDoc, 'Cloud document must exist');
  const decodedCloudRoadmap = decodeRoadmapProgressDoc(cloudDoc);
  assert.ok(decodedCloudRoadmap, 'Decoded cloud roadmap must be valid');
  assert.equal(decodedCloudRoadmap.checkpoints['PHY-01-CP1']?.diagnosticCleared, true);
  assert.equal(decodedCloudRoadmap.checkpoints['PHY-01-CP1']?.diagnosticScore?.percentage, 100);
  console.log('   ✓ Verified in CloudStore: PHY-01-CP1 diagnosticCleared = true (100%)');

  // -------------------------------------------------------------------------
  // STEP 4: Sign in on Device B
  // -------------------------------------------------------------------------
  console.log('Step 4: Signing in on Device B with test UID:', testUid);
  await RoadmapSyncService.syncRoadmapsWithCloud(testUid, cloud, storageB);
  console.log('   ✓ Device B signed in and synchronized from CloudStore.');

  // -------------------------------------------------------------------------
  // STEP 5: Verify the same progress appears on Device B
  // -------------------------------------------------------------------------
  console.log('Step 5: Verifying Device B received progress...');
  const roadmapB = RoadmapProgressService.getRoadmapProgress('PHY-01', testUid, storageB);
  assert.ok(roadmapB, 'Device B must have PHY-01 roadmap progress');
  assert.equal(roadmapB.checkpoints['PHY-01-CP1']?.diagnosticCleared, true);
  assert.equal(roadmapB.checkpoints['PHY-01-CP1']?.diagnosticScore?.percentage, 100);
  console.log('   ✓ Device B displays identical diagnostic status from Device A (100% matched)!');

  // -------------------------------------------------------------------------
  // STEP 6: Make a second mutation on Device B
  // -------------------------------------------------------------------------
  console.log('Step 6: Device B records active recall on PHY-01-CP1...');
  const cpB = roadmapB.checkpoints['PHY-01-CP1'];
  assert.ok(cpB);
  const recallScoreB: StageScore = {
    correct: 3,
    total: 3,
    percentage: 100,
    completedAt: '2026-11-08T16:05:00.000Z',
  };
  const updatedCpB: CheckpointProgress = {
    ...cpB,
    activeRecallScore: recallScoreB,
    revisionCompleted: true,
    currentStage: 'practice',
    lastActivityAt: '2026-11-08T16:05:00.000Z',
  };
  RoadmapProgressService.saveCheckpointProgress(updatedCpB, testUid, storageB);
  await RoadmapSyncService.syncRoadmapsWithCloud(testUid, cloud, storageB);
  console.log('   ✓ Device B committed active recall completion to cloud.');

  // -------------------------------------------------------------------------
  // STEP 7: Verify Device A receives Device B mutation
  // -------------------------------------------------------------------------
  console.log('Step 7: Synchronizing Device A...');
  await RoadmapSyncService.syncRoadmapsWithCloud(testUid, cloud, storageA);
  const refreshedA = RoadmapProgressService.getRoadmapProgress('PHY-01', testUid, storageA);
  assert.equal(refreshedA.checkpoints['PHY-01-CP1']?.activeRecallScore?.percentage, 100);
  assert.equal(refreshedA.checkpoints['PHY-01-CP1']?.revisionCompleted, true);
  assert.equal(refreshedA.checkpoints['PHY-01-CP1']?.diagnosticCleared, true); // preserved from A
  console.log('   ✓ Device A successfully reconciled mutation from Device B (both diagnostic and active recall present)!');

  // -------------------------------------------------------------------------
  // STEP 8: Test offline queueing and reconnect
  // -------------------------------------------------------------------------
  console.log('Step 8: Testing offline queueing and reconnect on Device A...');
  
  const offlineCpA: CheckpointProgress = {
    ...refreshedA.checkpoints['PHY-01-CP1'],
    practiceStats: {
      attempted: 10,
      correct: 9,
      highestTierUnlocked: 'jee_main',
      lastPracticedAt: '2026-11-08T16:10:00.000Z',
    },
    lastActivityAt: '2026-11-08T16:10:00.000Z',
  };
  const offlineRoadmapA = RoadmapProgressService.saveCheckpointProgress(offlineCpA, testUid, storageA);
  
  // Enqueue to outbox while simulating network offline
  cloud.failCommits = '503 Network Offline';
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path: cloudPaths.roadmap(testUid, 'PHY-01'),
      data: encodeRoadmapProgressDoc(testUid, offlineRoadmapA),
      merge: true,
    },
    testUid,
    storageA
  );

  // Flush fails due to network outage, item remains in outbox
  const offlineFlush = await RoadmapOutboxService.flush(testUid, cloud, storageA);
  assert.equal(offlineFlush.sent, 0);
  assert.equal(offlineFlush.failed, 1);
  assert.equal(RoadmapOutboxService.getPendingCount(testUid, storageA), 1);
  console.log('   ✓ Offline mutation safely preserved in local outbox (1 item queued)');

  // Reconnect
  console.log('   Network restored. Flushing outbox...');
  cloud.failCommits = false;
  const reconnectFlush = await RoadmapOutboxService.flush(testUid, cloud, storageA);
  assert.equal(reconnectFlush.sent, 1);
  assert.equal(reconnectFlush.remaining, 0);
  assert.equal(RoadmapOutboxService.getPendingCount(testUid, storageA), 0);
  console.log('   ✓ Outbox flushed cleanly upon reconnect (0 items remaining).');

  // Device B syncs and confirms offline mutation reached it
  await RoadmapSyncService.syncRoadmapsWithCloud(testUid, cloud, storageB);
  const finalB = RoadmapProgressService.getRoadmapProgress('PHY-01', testUid, storageB);
  assert.equal(finalB.checkpoints['PHY-01-CP1']?.practiceStats?.attempted, 10);
  assert.equal(finalB.checkpoints['PHY-01-CP1']?.practiceStats?.correct, 9);
  assert.equal(finalB.checkpoints['PHY-01-CP1']?.activeRecallScore?.percentage, 100);
  assert.equal(finalB.checkpoints['PHY-01-CP1']?.diagnosticCleared, true);
  console.log('   ✓ Device B verified receiving the reconnected mutation with all stages intact.');

  console.log('\n=== ALL 8 CROSS-DEVICE SYNC STEPS VERIFIED (PASS) ===\n');
}

runCrossDeviceSyncVerification().catch((err) => {
  console.error('Cross-device verification failed:', err);
  process.exit(1);
});
