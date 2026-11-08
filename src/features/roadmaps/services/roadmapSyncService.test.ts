import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoadmapSyncService,
  mergeCheckpointProgress,
  mergeRoadmapProgress,
  mergeRevisionQueues,
  encodeRoadmapProgressDoc,
  decodeRoadmapProgressDoc,
  encodeRevisionItemDoc,
  decodeRevisionItemDoc,
} from './roadmapSyncService';
import { RoadmapProgressService } from './roadmapProgressService';
import { MemoryStorage, FakeCloudStore } from '../../../services/testDoubles';
import { scopedKey, STORAGE_KEYS } from '../../../services/localScope';
import { cloudPaths } from '../../../services/cloudStore';
import type { CheckpointProgress, RevisionItem, RoadmapProgress } from '../types/progress.types';

function createMockCheckpointProgress(overrides: Partial<CheckpointProgress> = {}): CheckpointProgress {
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

function createMockRoadmapProgress(overrides: Partial<RoadmapProgress> = {}): RoadmapProgress {
  return {
    roadmapId: 'PHY-01',
    completionPercentage: 0,
    completedCheckpointsCount: 0,
    currentCheckpointId: 'PHY-01-CP1',
    checkpoints: {
      'PHY-01-CP1': createMockCheckpointProgress(),
    },
    lastActivityAt: '2026-11-04T10:00:00.000Z',
    ...overrides,
  };
}

test('roadmapSyncService: local-only guest progress stays strictly in guest scope', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  // Guest operates on roadmap without signing in
  const guestProg = RoadmapProgressService.getRoadmapProgress('PHY-01', null, storage);
  assert.equal(guestProg.completionPercentage, 0);

  const updatedCp = createMockCheckpointProgress({
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 95,
  });
  RoadmapProgressService.saveCheckpointProgress(updatedCp, null, storage);

  // Physical key check: data is under lm:guest:...
  assert.ok(storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS)));
  assert.equal(storage.getItem(scopedKey('u_alice', STORAGE_KEYS.ROADMAP_PROGRESS)), null);

  // Cloud store must have zero writes for guests
  assert.equal(cloud.docs.size, 0);
  assert.equal(cloud.commits, 0);
});

test('roadmapSyncService: authenticated user syncs progress to and from cloud', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Alice completes CP1 locally
  const cp1 = createMockCheckpointProgress({
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 85,
    lastActivityAt: '2026-11-04T12:00:00.000Z',
  });
  RoadmapProgressService.saveCheckpointProgress(cp1, uid, storage);

  // Sync to cloud
  const syncResult = await RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, storage);
  assert.ok(syncResult.synchedRoadmaps >= 1);

  // Cloud now has the roadmap document
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.ok(cloudDoc);
  assert.equal(cloudDoc.roadmapId, 'PHY-01');
  assert.equal(cloudDoc.uid, uid);

  // Bob on another device does not see Alice's cloud doc
  const bobDoc = await cloud.getDoc(cloudPaths.roadmap('bob', 'PHY-01'));
  assert.equal(bobDoc, null);

  // Alice on a second clean device syncs down
  const device2Storage = new MemoryStorage();
  await RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, device2Storage);

  const downloadedProg = RoadmapProgressService.getRoadmapProgress('PHY-01', uid, device2Storage);
  assert.equal(downloadedProg.checkpoints['PHY-01-CP1'].masteryStatus, 'strong');
  assert.equal(downloadedProg.checkpoints['PHY-01-CP1'].masteryScore, 85);
});

test('roadmapSyncService: strict User A / User B isolation in cloud and local storage', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();

  // Alice completes PHY-01
  const aliceCp = createMockCheckpointProgress({
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 90,
  });
  RoadmapProgressService.saveCheckpointProgress(aliceCp, 'alice', storage);
  await RoadmapSyncService.syncRoadmapsWithCloud('alice', cloud, storage);

  // Bob starts PHY-01
  const bobProg = RoadmapProgressService.getRoadmapProgress('PHY-01', 'bob', storage);
  assert.equal(bobProg.checkpoints['PHY-01-CP1'].masteryStatus, 'unattempted');
  RoadmapProgressService.saveCheckpointProgress(bobProg.checkpoints['PHY-01-CP1'], 'bob', storage);
  await RoadmapSyncService.syncRoadmapsWithCloud('bob', cloud, storage);

  // Alice and Bob have separate distinct cloud documents
  const aliceCloud = await cloud.getDoc(cloudPaths.roadmap('alice', 'PHY-01'));
  const bobCloud = await cloud.getDoc(cloudPaths.roadmap('bob', 'PHY-01'));

  assert.equal(aliceCloud?.uid, 'alice');
  assert.equal(bobCloud?.uid, 'bob');
  assert.notEqual(aliceCloud?.checkpointsJson, bobCloud?.checkpointsJson);
});

test('roadmapSyncService: guest migration to a newly authenticated account', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'new_student_123';

  // Student makes progress as a guest
  const guestCp = createMockCheckpointProgress({
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 88,
    lastActivityAt: '2026-11-04T14:00:00.000Z',
  });
  RoadmapProgressService.saveCheckpointProgress(guestCp, null, storage);

  RoadmapProgressService.addRevisionItem(
    {
      id: 'rev-guest-1',
      topicId: 'physics.kinematics.uniformly-accelerated-motion',
      topicName: 'Uniformly Accelerated Motion',
      roadmapId: 'PHY-01',
      checkpointId: 'PHY-01-CP1',
      scheduledForDate: '2026-11-05',
      intervalStep: 0,
      status: 'upcoming',
      reason: 'Guest test',
      consecutiveMasteryCount: 0,
      priority: 'high',
    },
    null,
    storage
  );

  assert.ok(storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS)));

  // Student logs in: migrate guest data
  const migrationResult = await RoadmapSyncService.migrateGuestRoadmapDataToUser(uid, storage, cloud);
  assert.ok(migrationResult.migratedRoadmaps >= 1);
  assert.equal(migrationResult.migratedRevisionItems, 1);

  // Guest keys must be wiped
  assert.equal(storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS)), null);
  assert.equal(storage.getItem(scopedKey('guest', STORAGE_KEYS.ROADMAP_REVISION_QUEUE)), null);

  // User storage must contain the migrated progress
  const userProg = RoadmapProgressService.getRoadmapProgress('PHY-01', uid, storage);
  assert.equal(userProg.checkpoints['PHY-01-CP1'].masteryStatus, 'strong');
  assert.equal(userProg.checkpoints['PHY-01-CP1'].masteryScore, 88);

  // Cloud should now reflect the migrated data
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.ok(cloudDoc);
});

test('roadmapSyncService: merging existing cloud data versus guest data deterministically', () => {
  // Remote cloud had CP1 completed with 70% developing on Monday
  const remote = createMockRoadmapProgress({
    lastActivityAt: '2026-11-02T10:00:00.000Z',
    checkpoints: {
      'PHY-01-CP1': createMockCheckpointProgress({
        status: 'completed',
        masteryStatus: 'developing',
        masteryScore: 70,
        lastActivityAt: '2026-11-02T10:00:00.000Z',
        historicalAttemptsCount: 1,
      }),
    },
  });

  // Local guest improved to 85% strong on Tuesday
  const local = createMockRoadmapProgress({
    lastActivityAt: '2026-11-03T10:00:00.000Z',
    checkpoints: {
      'PHY-01-CP1': createMockCheckpointProgress({
        status: 'completed',
        masteryStatus: 'strong',
        masteryScore: 85,
        lastActivityAt: '2026-11-03T10:00:00.000Z',
        historicalAttemptsCount: 2,
      }),
    },
  });

  const merged = mergeRoadmapProgress(local, remote);
  assert.equal(merged.checkpoints['PHY-01-CP1'].masteryStatus, 'strong');
  assert.equal(merged.checkpoints['PHY-01-CP1'].masteryScore, 85);
  assert.equal(merged.checkpoints['PHY-01-CP1'].historicalAttemptsCount, 2);
});

test('roadmapSyncService: stale timestamps - newer weak evidence beats older completed state', () => {
  // Student completed CP1 with strong score 2 days ago
  const olderCompleted = createMockCheckpointProgress({
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 90,
    lastActivityAt: '2026-11-02T10:00:00.000Z',
    historicalAttemptsCount: 1,
    assessmentResult: {
      attemptId: 'att-old',
      score: 90,
      totalMarks: 100,
      rawMarks: 90,
      percentage: 90,
      correctCount: 9,
      incorrectCount: 1,
      unansweredCount: 0,
      timeTakenSeconds: 300,
      completedAt: '2026-11-02T10:00:00.000Z',
      weakTopics: [],
      strongTopics: ['t1'],
    },
  });

  // Student retook the test yesterday and failed with 40% (needs reinforcement)
  const newerFailed = createMockCheckpointProgress({
    status: 'needs_reinforcement',
    masteryStatus: 'needs_reinforcement',
    masteryScore: 40,
    lastActivityAt: '2026-11-03T10:00:00.000Z',
    historicalAttemptsCount: 2,
    assessmentResult: {
      attemptId: 'att-new',
      score: 40,
      totalMarks: 100,
      rawMarks: 40,
      percentage: 40,
      correctCount: 4,
      incorrectCount: 6,
      unansweredCount: 0,
      timeTakenSeconds: 350,
      completedAt: '2026-11-03T10:00:00.000Z',
      weakTopics: ['t1'],
      strongTopics: [],
    },
  });

  // Old completed state MUST NOT overwrite newer weak evidence
  const merged = mergeCheckpointProgress(newerFailed, olderCompleted);
  assert.equal(merged.masteryStatus, 'needs_reinforcement');
  assert.equal(merged.status, 'needs_reinforcement');
  assert.equal(merged.masteryScore, 40);
  assert.equal(merged.historicalAttemptsCount, 2);
  assert.equal(merged.assessmentResult?.attemptId, 'att-new');
});

test('roadmapSyncService: offline writes remain available and sync when cloud recovers', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  // Cloud is offline/failing
  cloud.failCommits = 'Network offline: 503 Service Unavailable';

  const cp = createMockCheckpointProgress({
    status: 'completed',
    masteryStatus: 'strong',
    masteryScore: 80,
  });
  RoadmapProgressService.saveCheckpointProgress(cp, uid, storage);

  // Sync attempt fails with offline error, but local storage stays intact
  await assert.rejects(
    async () => RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, storage),
    /Network offline/i
  );

  const localSaved = RoadmapProgressService.getRoadmapProgress('PHY-01', uid, storage);
  assert.equal(localSaved.checkpoints['PHY-01-CP1'].masteryStatus, 'strong');

  // Network recovers
  cloud.failCommits = false;
  const recoveredResult = await RoadmapSyncService.syncRoadmapsWithCloud(uid, cloud, storage);
  assert.ok(recoveredResult.synchedRoadmaps >= 1);

  // Cloud is updated
  const cloudDoc = await cloud.getDoc(cloudPaths.roadmap(uid, 'PHY-01'));
  assert.ok(cloudDoc);
});

test('roadmapSyncService: duplicate revision queue entries are deduplicated deterministically', () => {
  const item1: RevisionItem = {
    id: 'rev-item-1',
    topicId: 'physics.optics.prism',
    topicName: 'Prism Deviation',
    roadmapId: 'PHY-04',
    checkpointId: 'PHY-04-CP1',
    scheduledForDate: '2026-11-04',
    intervalStep: 0,
    status: 'due',
    reason: 'Initial',
    consecutiveMasteryCount: 0,
    priority: 'high',
  };

  const item1Updated: RevisionItem = {
    id: 'rev-item-2',
    topicId: 'physics.optics.prism',
    topicName: 'Prism Deviation',
    roadmapId: 'PHY-04',
    checkpointId: 'PHY-04-CP1',
    scheduledForDate: '2026-11-07',
    intervalStep: 1,
    status: 'upcoming',
    reason: 'Advanced',
    consecutiveMasteryCount: 1,
    priority: 'medium',
    lastRevisedAt: '2026-11-04',
  };

  const merged = mergeRevisionQueues([item1], [item1Updated]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].intervalStep, 1);
  assert.equal(merged[0].scheduledForDate, '2026-11-07');
});

test('roadmapSyncService: malformed remote payloads are ignored defensively without crashing', () => {
  const malformedData = {
    roadmapId: 'PHY-01',
    checkpointsJson: 'corrupted json {{{',
  };

  const decoded = decodeRoadmapProgressDoc(malformedData);
  assert.equal(decoded, null);

  const malformedItem = {
    id: 'rev-1',
    // Missing topicId, roadmapId, etc.
  };
  const decodedItem = decodeRevisionItemDoc(malformedItem);
  assert.equal(decodedItem, null);
});

test('roadmapSyncService: assessment audit log records are encoded and pushed immutably', async () => {
  const cloud = new FakeCloudStore();
  const uid = 'alice';

  const result = {
    attemptId: 'att-audit-001',
    score: 85,
    totalMarks: 12,
    rawMarks: 10,
    percentage: 83,
    correctCount: 2,
    incorrectCount: 1,
    unansweredCount: 0,
    timeTakenSeconds: 180,
    completedAt: '2026-11-04T12:00:00.000Z',
    weakTopics: [],
    strongTopics: ['t1'],
  };

  await RoadmapSyncService.pushAssessmentAttempt(uid, result, 'PHY-01-CP1', 'PHY-01', cloud);

  const attemptDoc = await cloud.getDoc(cloudPaths.roadmapAttempt(uid, 'att-audit-001'));
  assert.ok(attemptDoc);
  assert.equal(attemptDoc.id, 'att-audit-001');
  assert.equal(attemptDoc.percentage, 83);
  assert.equal(attemptDoc.checkpointId, 'PHY-01-CP1');
  assert.equal(attemptDoc.uid, uid);
});
