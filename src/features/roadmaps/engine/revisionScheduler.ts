import type { RevisionItem, RevisionItemStatus } from '../types/progress.types';
import type { RoadmapId } from '../types/roadmap.types';

/**
 * Fixed-Interval Spaced Repetition ladder.
 * Intervals: Day 1, Day 3, Day 7, Day 14, Day 30.
 * Deterministic schedule for active recall and retention verification.
 */
export const SPACED_INTERVAL_DAYS = Object.freeze([1, 3, 7, 14, 30] as const);

export interface ScheduleRevisionParams {
  topicId: string;
  topicName: string;
  roadmapId: RoadmapId;
  checkpointId: string;
  reason: string;
  initialPriority?: 'high' | 'medium' | 'low';
  initialIntervalStep?: number; // e.g. 0 (Day 1 for reinforcement) or 2 (Day 7 for retention check)
  referenceDate?: Date;
}

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Creates a new spaced revision item using fixed-interval spaced repetition.
 * Defaults to step 0 (Day 1) for weak topics, or specified step (e.g. step 2 = Day 7 for retention checks).
 */
export function createRevisionItem(params: ScheduleRevisionParams): RevisionItem {
  const refDate = params.referenceDate ?? new Date();
  const step = Math.min(
    SPACED_INTERVAL_DAYS.length - 1,
    Math.max(0, params.initialIntervalStep ?? 0)
  );
  const intervalDays = SPACED_INTERVAL_DAYS[step];
  const scheduledDate = addDays(refDate, intervalDays);

  return {
    id: `rev-${params.checkpointId}-${params.topicId}-${Date.now().toString(36)}`,
    topicId: params.topicId,
    topicName: params.topicName,
    roadmapId: params.roadmapId,
    checkpointId: params.checkpointId,
    scheduledForDate: formatIsoDate(scheduledDate),
    intervalStep: step,
    status: 'upcoming',
    reason: params.reason,
    consecutiveMasteryCount: 0,
    priority: params.initialPriority ?? (step >= 2 ? 'medium' : 'high'),
  };
}

/**
 * Categorizes a revision item's status relative to a target date.
 */
export function categorizeRevisionStatus(
  item: RevisionItem,
  referenceDate: Date = new Date()
): RevisionItemStatus {
  if (item.status === 'completed') {
    return 'completed';
  }

  const todayStr = formatIsoDate(referenceDate);
  if (item.scheduledForDate < todayStr) {
    return 'overdue';
  }
  if (item.scheduledForDate === todayStr) {
    return 'due';
  }
  return 'upcoming';
}

/**
 * Marks a revision item as completed and advances to the next fixed-interval step.
 * If recall was strong, step advances (up to Day 30).
 * If recall failed, step resets to step 0 (Day 1) for immediate reinforcement.
 */
export function completeRevisionItem(
  item: RevisionItem,
  recallSuccessful: boolean,
  referenceDate: Date = new Date()
): RevisionItem {
  const todayStr = formatIsoDate(referenceDate);

  if (recallSuccessful) {
    const nextStep = Math.min(SPACED_INTERVAL_DAYS.length - 1, item.intervalStep + 1);
    const intervalDays = SPACED_INTERVAL_DAYS[nextStep];
    const nextDate = addDays(referenceDate, intervalDays);

    return {
      ...item,
      intervalStep: nextStep,
      scheduledForDate: formatIsoDate(nextDate),
      status: 'upcoming',
      lastRevisedAt: todayStr,
      consecutiveMasteryCount: item.consecutiveMasteryCount + 1,
      priority: nextStep >= 3 ? 'low' : 'medium',
    };
  }

  // If recall failed, drop back to Step 0 (Day 1) and raise priority
  const nextDate = addDays(referenceDate, SPACED_INTERVAL_DAYS[0]);
  return {
    ...item,
    intervalStep: 0,
    scheduledForDate: formatIsoDate(nextDate),
    status: 'upcoming',
    lastRevisedAt: todayStr,
    consecutiveMasteryCount: 0,
    priority: 'high',
    reason: `Recall needed reinforcement on ${todayStr}`,
  };
}

export interface PartitionedRevisionQueue {
  dueToday: RevisionItem[];
  overdue: RevisionItem[];
  upcoming: RevisionItem[];
  completed: RevisionItem[];
}

/**
 * Partitions the revision queue into actionable buckets using fixed-interval status categorization.
 */
export function partitionRevisionQueue(
  items: readonly RevisionItem[],
  referenceDate: Date = new Date()
): PartitionedRevisionQueue {
  const dueToday: RevisionItem[] = [];
  const overdue: RevisionItem[] = [];
  const upcoming: RevisionItem[] = [];
  const completed: RevisionItem[] = [];

  for (const item of items) {
    const currentStatus = categorizeRevisionStatus(item, referenceDate);
    const updated = { ...item, status: currentStatus };

    switch (currentStatus) {
      case 'overdue':
        overdue.push(updated);
        break;
      case 'due':
        dueToday.push(updated);
        break;
      case 'upcoming':
        upcoming.push(updated);
        break;
      case 'completed':
        completed.push(updated);
        break;
    }
  }

  // Sort overdue by date ascending (oldest first)
  overdue.sort((a, b) => a.scheduledForDate.localeCompare(b.scheduledForDate));
  // Sort upcoming by date ascending (closest first)
  upcoming.sort((a, b) => a.scheduledForDate.localeCompare(b.scheduledForDate));

  return {
    dueToday,
    overdue,
    upcoming,
    completed,
  };
}
