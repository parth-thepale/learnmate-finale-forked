import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRevisionItem,
  categorizeRevisionStatus,
  completeRevisionItem,
  partitionRevisionQueue,
  formatIsoDate,
  addDays,
  SPACED_INTERVAL_DAYS,
} from './revisionScheduler';

test('revisionScheduler: verifies fixed interval ladder [1, 3, 7, 14, 30]', () => {
  assert.deepEqual(SPACED_INTERVAL_DAYS, [1, 3, 7, 14, 30]);
});

test('revisionScheduler: schedules initial revision at Day 1 for step 0', () => {
  const baseDate = new Date('2026-11-04T10:00:00Z');
  const item = createRevisionItem({
    topicId: 'physics.kinematics.uniformly-accelerated-motion',
    topicName: 'Uniformly Accelerated Motion',
    roadmapId: 'PHY-01',
    checkpointId: 'PHY-01-CP1',
    reason: 'Incorrect answer on projectile acceleration',
    referenceDate: baseDate,
  });

  assert.equal(item.intervalStep, 0);
  assert.equal(item.scheduledForDate, '2026-11-05'); // Day 1
  assert.equal(item.status, 'upcoming');
  assert.equal(item.priority, 'high');
});

test('revisionScheduler: schedules retention check at Day 7 for initialIntervalStep 2', () => {
  const baseDate = new Date('2026-11-04T10:00:00Z');
  const retentionItem = createRevisionItem({
    topicId: 'physics.kinematics.uniformly-accelerated-motion',
    topicName: 'Uniformly Accelerated Motion',
    roadmapId: 'PHY-01',
    checkpointId: 'PHY-01-CP1',
    reason: 'Retention check following mastery of PHY-01-CP1',
    initialPriority: 'medium',
    initialIntervalStep: 2, // Step 2 corresponds to 7 days
    referenceDate: baseDate,
  });

  assert.equal(retentionItem.intervalStep, 2);
  assert.equal(retentionItem.scheduledForDate, '2026-11-11'); // Nov 4 + 7 days = Nov 11
  assert.equal(retentionItem.status, 'upcoming');
  assert.equal(retentionItem.priority, 'medium');
});

test('revisionScheduler: categorizes status accurately based on reference date', () => {
  const item = createRevisionItem({
    topicId: 'topic-1',
    topicName: 'Topic 1',
    roadmapId: 'PHY-01',
    checkpointId: 'PHY-01-CP1',
    reason: 'Practice',
    referenceDate: new Date('2026-11-01T10:00:00Z'),
  });
  // scheduledForDate is 2026-11-02

  // On 2026-11-01: upcoming
  assert.equal(categorizeRevisionStatus(item, new Date('2026-11-01T12:00:00Z')), 'upcoming');

  // On 2026-11-02: due
  assert.equal(categorizeRevisionStatus(item, new Date('2026-11-02T08:00:00Z')), 'due');

  // On 2026-11-03: overdue
  assert.equal(categorizeRevisionStatus(item, new Date('2026-11-03T09:00:00Z')), 'overdue');
});

test('revisionScheduler: completeRevisionItem increments step through full ladder and caps at Day 30', () => {
  let item = createRevisionItem({
    topicId: 'topic-1',
    topicName: 'Topic 1',
    roadmapId: 'PHY-01',
    checkpointId: 'PHY-01-CP1',
    reason: 'Initial',
    referenceDate: new Date('2026-11-01T10:00:00Z'),
  });
  assert.equal(item.intervalStep, 0); // Day 1

  // Success 1: Step 0 -> Step 1 (Day 3)
  item = completeRevisionItem(item, true, new Date('2026-11-02T10:00:00Z'));
  assert.equal(item.intervalStep, 1);
  assert.equal(item.scheduledForDate, '2026-11-05');

  // Success 2: Step 1 -> Step 2 (Day 7)
  item = completeRevisionItem(item, true, new Date('2026-11-05T10:00:00Z'));
  assert.equal(item.intervalStep, 2);
  assert.equal(item.scheduledForDate, '2026-11-12');

  // Success 3: Step 2 -> Step 3 (Day 14)
  item = completeRevisionItem(item, true, new Date('2026-11-12T10:00:00Z'));
  assert.equal(item.intervalStep, 3);
  assert.equal(item.scheduledForDate, '2026-11-26');
  assert.equal(item.priority, 'low');

  // Success 4: Step 3 -> Step 4 (Day 30)
  item = completeRevisionItem(item, true, new Date('2026-11-26T10:00:00Z'));
  assert.equal(item.intervalStep, 4);
  assert.equal(item.scheduledForDate, '2026-12-26');

  // Success 5: Step 4 stays capped at Step 4 (Day 30)
  item = completeRevisionItem(item, true, new Date('2026-12-26T10:00:00Z'));
  assert.equal(item.intervalStep, 4);
  assert.equal(item.scheduledForDate, '2027-01-25');
});

test('revisionScheduler: completeRevisionItem resets to Step 0 (Day 1) on recall failure', () => {
  const advancedItem = {
    ...createRevisionItem({
      topicId: 'topic-1',
      topicName: 'Topic 1',
      roadmapId: 'PHY-01',
      checkpointId: 'PHY-01-CP1',
      reason: 'Initial',
      initialIntervalStep: 3, // Step 3
    }),
    consecutiveMasteryCount: 3,
  };

  const failed = completeRevisionItem(advancedItem, false, new Date('2026-11-20T10:00:00Z'));
  assert.equal(failed.intervalStep, 0);
  assert.equal(failed.consecutiveMasteryCount, 0);
  assert.equal(failed.priority, 'high');
  assert.equal(failed.scheduledForDate, '2026-11-21'); // 1 day later
  assert.match(failed.reason, /needed reinforcement/i);
});

test('revisionScheduler: partitions queue into dueToday, overdue, upcoming, completed buckets', () => {
  const today = new Date('2026-11-04T12:00:00Z');
  const items = [
    {
      ...createRevisionItem({
        topicId: 't-past',
        topicName: 'Past Topic',
        roadmapId: 'PHY-01',
        checkpointId: 'PHY-01-CP1',
        reason: 'r1',
        referenceDate: new Date('2026-10-30T10:00:00Z'),
      }),
      scheduledForDate: '2026-10-31', // Overdue
    },
    {
      ...createRevisionItem({
        topicId: 't-today',
        topicName: 'Today Topic',
        roadmapId: 'PHY-01',
        checkpointId: 'PHY-01-CP1',
        reason: 'r2',
        referenceDate: new Date('2026-11-03T10:00:00Z'),
      }),
      scheduledForDate: '2026-11-04', // Due today
    },
    {
      ...createRevisionItem({
        topicId: 't-future',
        topicName: 'Future Topic',
        roadmapId: 'PHY-01',
        checkpointId: 'PHY-01-CP1',
        reason: 'r3',
        referenceDate: new Date('2026-11-04T10:00:00Z'),
      }),
      scheduledForDate: '2026-11-07', // Upcoming
    },
    {
      ...createRevisionItem({
        topicId: 't-done',
        topicName: 'Done Topic',
        roadmapId: 'PHY-01',
        checkpointId: 'PHY-01-CP1',
        reason: 'r4',
        referenceDate: new Date('2026-11-01T10:00:00Z'),
      }),
      status: 'completed' as const,
    },
  ];

  const partitioned = partitionRevisionQueue(items, today);
  assert.equal(partitioned.overdue.length, 1);
  assert.equal(partitioned.overdue[0].topicId, 't-past');

  assert.equal(partitioned.dueToday.length, 1);
  assert.equal(partitioned.dueToday[0].topicId, 't-today');

  assert.equal(partitioned.upcoming.length, 1);
  assert.equal(partitioned.upcoming[0].topicId, 't-future');

  assert.equal(partitioned.completed.length, 1);
  assert.equal(partitioned.completed[0].topicId, 't-done');
});
