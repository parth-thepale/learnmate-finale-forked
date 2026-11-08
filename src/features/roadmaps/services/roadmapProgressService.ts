import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
  RoadmapProgress,
} from '../types/progress.types';
import type { Checkpoint } from '../types/checkpoint.types';
import type { RoadmapId } from '../types/roadmap.types';
import {
  STORAGE_KEYS,
  scopeForUid,
  scopedKey,
  type KeyValueStorage,
} from '../../../services/localScope';
import { getCheckpointById, getCheckpointsForRoadmap } from '../data/checkpointRegistry';
import { getRoadmapById } from '../data/roadmaps';
import { evaluateMastery } from '../engine/masteryEngine';
import {
  computeRoadmapCompletion,
  resolveCheckpointNodeStatus,
} from '../engine/progressionEngine';
import {
  completeRevisionItem as engineCompleteRevision,
  createRevisionItem,
} from '../engine/revisionScheduler';
import { getVerifiedAssessmentQuestions } from '../engine/contentGovernance';

function getStorage(customStorage?: KeyValueStorage): KeyValueStorage | null {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export class RoadmapProgressService {
  /**
   * Loads all roadmap progress records for a user.
   */
  static getAllRoadmapsProgress(
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): Record<string, RoadmapProgress> {
    const storage = getStorage(customStorage);
    if (!storage) return {};

    const scope = scopeForUid(uid ?? null);
    const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_PROGRESS);

    try {
      const raw = storage.getItem(key);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, RoadmapProgress>;
    } catch {
      return {};
    }
  }

  /**
   * Loads progress for a specific roadmap, initializing default progress if none exists.
   */
  static getRoadmapProgress(
    roadmapId: RoadmapId,
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): RoadmapProgress {
    const all = this.getAllRoadmapsProgress(uid, customStorage);
    const existing = all[roadmapId];
    if (existing) {
      return existing;
    }

    const roadmap = getRoadmapById(roadmapId);
    const checkpoints = getCheckpointsForRoadmap(roadmapId);
    const initialCheckpoints: Record<string, CheckpointProgress> = {};

    for (const cp of checkpoints) {
      initialCheckpoints[cp.id] = {
        checkpointId: cp.id,
        roadmapId,
        status: cp.order === 1 ? 'current' : 'locked',
        currentStage: 'diagnostic',
        diagnosticCleared: false,
        revisionCompleted: false,
        masteryStatus: 'unattempted',
        masteryScore: 0,
        lastActivityAt: new Date(0).toISOString(),
        historicalAttemptsCount: 0,
      };
    }

    const initial: RoadmapProgress = {
      roadmapId,
      completionPercentage: 0,
      completedCheckpointsCount: 0,
      currentCheckpointId: checkpoints[0]?.id || '',
      checkpoints: initialCheckpoints,
      lastActivityAt: new Date(0).toISOString(),
    };

    return initial;
  }

  /**
   * Saves or updates a checkpoint progress record.
   */
  static saveCheckpointProgress(
    progress: CheckpointProgress,
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): RoadmapProgress {
    const storage = getStorage(customStorage);
    const all = this.getAllRoadmapsProgress(uid, customStorage);
    const roadmapId = progress.roadmapId;
    const roadmapProg = all[roadmapId] || this.getRoadmapProgress(roadmapId, uid, customStorage);

    const updatedCheckpoints = {
      ...roadmapProg.checkpoints,
      [progress.checkpointId]: {
        ...progress,
        lastActivityAt: new Date().toISOString(),
      },
    };

    const roadmap = getRoadmapById(roadmapId);
    const checkpoints = getCheckpointsForRoadmap(roadmapId);
    const completion = roadmap
      ? computeRoadmapCompletion(roadmap, checkpoints, updatedCheckpoints)
      : {
          completionPercentage: 0,
          completedCount: 0,
          currentCheckpointId: progress.checkpointId,
        };

    const updatedRoadmapProg: RoadmapProgress = {
      ...roadmapProg,
      checkpoints: updatedCheckpoints,
      completionPercentage: completion.completionPercentage,
      completedCheckpointsCount: completion.completedCount,
      currentCheckpointId: completion.currentCheckpointId,
      lastActivityAt: new Date().toISOString(),
    };

    all[roadmapId] = updatedRoadmapProg;

    if (storage) {
      const scope = scopeForUid(uid ?? null);
      const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_PROGRESS);
      try {
        storage.setItem(key, JSON.stringify(all));
      } catch (err) {
        console.warn('[RoadmapProgressService] Could not persist roadmap progress:', err);
      }
    }

    return updatedRoadmapProg;
  }

  /**
   * Saves all roadmap progress records for a user.
   */
  static saveAllRoadmapsProgress(
    roadmaps: Record<string, RoadmapProgress>,
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): void {
    const storage = getStorage(customStorage);
    if (!storage) return;

    const scope = scopeForUid(uid ?? null);
    const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_PROGRESS);

    try {
      storage.setItem(key, JSON.stringify(roadmaps));
    } catch (err) {
      console.warn('[RoadmapProgressService] Could not persist all roadmap progress:', err);
    }
  }

  /**
   * Retrieves the spaced revision queue for the account.
   */
  static getRevisionQueue(
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): RevisionItem[] {
    const storage = getStorage(customStorage);
    if (!storage) return [];

    const scope = scopeForUid(uid ?? null);
    const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_REVISION_QUEUE);

    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      return JSON.parse(raw) as RevisionItem[];
    } catch {
      return [];
    }
  }

  /**
   * Saves the entire spaced revision queue.
   */
  static saveRevisionQueue(
    items: readonly RevisionItem[],
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): void {
    const storage = getStorage(customStorage);
    if (!storage) return;

    const scope = scopeForUid(uid ?? null);
    const key = scopedKey(scope, STORAGE_KEYS.ROADMAP_REVISION_QUEUE);

    try {
      storage.setItem(key, JSON.stringify(items));
    } catch (err) {
      console.warn('[RoadmapProgressService] Could not persist revision queue:', err);
    }
  }

  /**
   * Adds an item to the spaced revision queue (or updates it if topic already scheduled).
   */
  static addRevisionItem(
    item: RevisionItem,
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): void {
    const queue = this.getRevisionQueue(uid, customStorage);
    const existingIndex = queue.findIndex(
      (q) => q.topicId === item.topicId && q.checkpointId === item.checkpointId
    );

    if (existingIndex >= 0) {
      const existing = queue[existingIndex];
      queue[existingIndex] = {
        ...item,
        id: existing.id,
      };
    } else {
      queue.push(item);
    }

    this.saveRevisionQueue(queue, uid, customStorage);
  }

  /**
   * Completes a revision item in the queue.
   */
  static completeRevision(
    itemId: string,
    recallSuccessful: boolean,
    uid?: string | null,
    customStorage?: KeyValueStorage
  ): RevisionItem | null {
    const queue = this.getRevisionQueue(uid, customStorage);
    const index = queue.findIndex((item) => item.id === itemId);
    if (index === -1) return null;

    const updated = engineCompleteRevision(queue[index], recallSuccessful);
    queue[index] = updated;
    this.saveRevisionQueue(queue, uid, customStorage);
    return updated;
  }

  /**
   * Records an official assessment attempt on a checkpoint.
   * Updates mastery, schedules spaced revision for weak topics, and unlocks next checkpoint if earned.
   * Fail-closed:
   * - Internal validation attempts do not update mastery or schedule revisions.
   * - Checkpoints with zero verified assessment questions fail closed (0 mastery, no milestone unlock).
   */
  static recordAssessmentAttempt(
    checkpointId: string,
    roadmapId: RoadmapId,
    assessmentResult: AssessmentAttemptResult,
    uid?: string | null,
    customStorage?: KeyValueStorage,
    customCheckpoint?: Checkpoint
  ): {
    updatedProgress: CheckpointProgress;
    updatedRoadmap: RoadmapProgress;
    scheduledRevisions: RevisionItem[];
  } {
    const roadmapProg = this.getRoadmapProgress(roadmapId, uid, customStorage);
    const currentCpProg = roadmapProg.checkpoints[checkpointId] || {
      checkpointId,
      roadmapId,
      status: 'current',
      currentStage: 'assessment',
      diagnosticCleared: false,
      revisionCompleted: true,
      masteryStatus: 'unattempted',
      masteryScore: 0,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: 0,
    };

    const isInternalValidation =
      assessmentResult.isInternalValidation === true ||
      assessmentResult.mode === 'internal_validation';

    if (isInternalValidation) {
      const updatedCpProg: CheckpointProgress = {
        ...currentCpProg,
        lastInternalValidationAttempt: assessmentResult,
        lastActivityAt: new Date().toISOString(),
      };
      const updatedRoadmap = this.saveCheckpointProgress(updatedCpProg, uid, customStorage);
      return {
        updatedProgress: updatedCpProg,
        updatedRoadmap,
        scheduledRevisions: [],
      };
    }

    const cp = customCheckpoint ?? getCheckpointById(checkpointId);
    const verifiedQuestions = getVerifiedAssessmentQuestions(cp);
    const availableQuestions = verifiedQuestions.length;

    // Fail-closed gate: if no verified questions exist, cannot award mastery or complete checkpoint
    if (availableQuestions === 0) {
      const updatedCpProg: CheckpointProgress = {
        ...currentCpProg,
        assessmentResult,
        masteryStatus: 'insufficient_evidence',
        masteryScore: 0,
        status: 'current',
        lastActivityAt: new Date().toISOString(),
      };
      const updatedRoadmap = this.saveCheckpointProgress(updatedCpProg, uid, customStorage);
      return {
        updatedProgress: updatedCpProg,
        updatedRoadmap,
        scheduledRevisions: [],
      };
    }

    const masteryEval = evaluateMastery(
      assessmentResult,
      currentCpProg.practiceStats,
      currentCpProg.activeRecallScore,
      availableQuestions
    );

    const isMastered = masteryEval.masteryStatus === 'strong' || masteryEval.masteryStatus === 'developing';

    const updatedCpProg: CheckpointProgress = {
      ...currentCpProg,
      assessmentResult,
      masteryStatus: masteryEval.masteryStatus,
      masteryScore: masteryEval.masteryScore,
      status: isMastered
        ? 'completed'
        : masteryEval.masteryStatus === 'insufficient_evidence'
        ? 'current'
        : 'needs_reinforcement',
      currentStage: 'analysis',
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: currentCpProg.historicalAttemptsCount + 1,
    };

    // Save checkpoint progress
    const updatedRoadmap = this.saveCheckpointProgress(updatedCpProg, uid, customStorage);

    // Schedule spaced revision for weak topics identified during assessment
    const scheduledRevisions: RevisionItem[] = [];
    const weakTopics = assessmentResult.weakTopics || [];

    for (const topicId of weakTopics) {
      const revItem = createRevisionItem({
        topicId,
        topicName: topicId.split('.').pop()?.replace(/-/g, ' ') || topicId,
        roadmapId,
        checkpointId,
        reason: `Missed in ${checkpointId} assessment (${assessmentResult.percentage}% accuracy)`,
        initialPriority: 'high',
        initialIntervalStep: 0, // Day 1 for immediate reinforcement
      });
      this.addRevisionItem(revItem, uid, customStorage);
      scheduledRevisions.push(revItem);
    }

    // If strong mastery, schedule retention revision for the checkpoint at Day 7 (Step 2)
    if (masteryEval.masteryStatus === 'strong') {
      const primaryTopic = cp?.topicIds[0] || checkpointId;
      if (!weakTopics.includes(primaryTopic)) {
        const retentionItem = createRevisionItem({
          topicId: primaryTopic,
          topicName: cp?.title || checkpointId,
          roadmapId,
          checkpointId,
          reason: `Retention check following mastery of ${checkpointId}`,
          initialPriority: 'medium',
          initialIntervalStep: 2, // Day 7
        });
        this.addRevisionItem(retentionItem, uid, customStorage);
        scheduledRevisions.push(retentionItem);
      }
    }

    return {
      updatedProgress: updatedCpProg,
      updatedRoadmap,
      scheduledRevisions,
    };
  }
}
