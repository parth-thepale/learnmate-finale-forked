import { useState, useEffect, useCallback, useMemo } from 'react';
import type { User } from 'firebase/auth';
import type { RoadmapId } from '../types/roadmap.types';
import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
  RoadmapProgress,
} from '../types/progress.types';
import { RoadmapProgressService } from '../services/roadmapProgressService';
import {
  RoadmapSyncService,
  encodeRoadmapProgressDoc,
  encodeRevisionItemDoc,
} from '../services/roadmapSyncService';
import { RoadmapOutboxService } from '../services/roadmapOutboxService';
import { roadmapSyncCoordinator } from '../services/roadmapSyncCoordinator';
import { cloudPaths } from '../../../services/cloudStore';
import { createFirestoreCloudStore } from '../../../services/firestoreCloudStore';
import { db } from '../../../firebase';
import { getTopAdaptiveRecommendation } from '../engine/recommendationEngine';
import { ALL_ROADMAPS } from '../data/roadmaps';

export function useRoadmapProgress(user?: User | null) {
  const uid = user?.uid ?? null;

  const [roadmapsProgress, setRoadmapsProgress] = useState<Record<string, RoadmapProgress>>({});
  const [revisionQueue, setRevisionQueue] = useState<RevisionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load progress and revision queue
  const reloadData = useCallback(() => {
    try {
      const allProg = RoadmapProgressService.getAllRoadmapsProgress(uid);

      // Ensure every one of the 12 roadmaps has an initial progress entry
      const completeProg: Record<string, RoadmapProgress> = { ...allProg };
      for (const r of ALL_ROADMAPS) {
        if (!completeProg[r.id]) {
          completeProg[r.id] = RoadmapProgressService.getRoadmapProgress(r.id, uid);
        }
      }

      setRoadmapsProgress(completeProg);
      setRevisionQueue(RoadmapProgressService.getRevisionQueue(uid));
    } catch (err) {
      console.warn('[useRoadmapProgress] Error loading progress:', err);
    } finally {
      setIsLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  // Listen to background updates from the root coordinator without owning the sync lifecycle
  useEffect(() => {
    const unsubscribe = roadmapSyncCoordinator.subscribeRoadmaps((merged) => {
      setRoadmapsProgress((prev) => ({ ...prev, ...merged }));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Update a single checkpoint's progress
  const updateCheckpointProgress = useCallback(
    (updated: CheckpointProgress) => {
      const updatedRoadmap = RoadmapProgressService.saveCheckpointProgress(updated, uid);
      setRoadmapsProgress((prev) => ({
        ...prev,
        [updated.roadmapId]: updatedRoadmap,
      }));

      if (uid && typeof window !== 'undefined') {
        try {
          RoadmapOutboxService.enqueue(
            {
              type: 'set',
              path: cloudPaths.roadmap(uid, updated.roadmapId),
              data: encodeRoadmapProgressDoc(uid, updatedRoadmap),
              merge: true,
            },
            uid
          );
        } catch (err) {
          console.warn('[useRoadmapProgress] Local outbox persistence error:', err);
          roadmapSyncCoordinator.notifyPersistenceChange();
        }

        const cloud = createFirestoreCloudStore(db);
        RoadmapOutboxService.flush(uid, cloud).catch((err) =>
          console.warn('[useRoadmapProgress] Background roadmap sync:', err)
        );
      }
    },
    [uid]
  );

  // Record an official assessment attempt
  const recordAssessment = useCallback(
    (checkpointId: string, roadmapId: RoadmapId, result: AssessmentAttemptResult) => {
      const outcome = RoadmapProgressService.recordAssessmentAttempt(
        checkpointId,
        roadmapId,
        result,
        uid
      );
      setRoadmapsProgress((prev) => ({
        ...prev,
        [roadmapId]: outcome.updatedRoadmap,
      }));
      setRevisionQueue(RoadmapProgressService.getRevisionQueue(uid));

      const isInternalValidation =
        result.isInternalValidation === true || result.mode === 'internal_validation';

      // Internal validation attempts are preview-only and must NEVER sync to Firestore
      if (!isInternalValidation && uid && typeof window !== 'undefined') {
        const cloud = createFirestoreCloudStore(db);

        // 1. Audit log push (enqueues & flushes outbox)
        RoadmapSyncService.pushAssessmentAttempt(uid, result, checkpointId, roadmapId, cloud).catch(
          (err) => console.warn('[useRoadmapProgress] Assessment attempt audit push:', err)
        );

        // 2. Enqueue roadmap progress & scheduled revisions in outbox
        const ops = [
          {
            type: 'set' as const,
            path: cloudPaths.roadmap(uid, roadmapId),
            data: encodeRoadmapProgressDoc(uid, outcome.updatedRoadmap),
            merge: true,
          },
          ...outcome.scheduledRevisions.map((rev) => ({
            type: 'set' as const,
            path: cloudPaths.roadmapRevisionItem(uid, rev.id),
            data: encodeRevisionItemDoc(uid, rev),
            merge: true,
          })),
        ];

        try {
          RoadmapOutboxService.enqueueBatch(ops, uid);
        } catch (err) {
          console.warn('[useRoadmapProgress] Local assessment outbox persistence error:', err);
          roadmapSyncCoordinator.notifyPersistenceChange();
        }
        RoadmapOutboxService.flush(uid, cloud).catch((err) =>
          console.warn('[useRoadmapProgress] Background assessment sync:', err)
        );
      }

      return outcome;
    },
    [uid]
  );

  // Complete a spaced revision item
  const completeRevision = useCallback(
    (itemId: string, recallSuccessful: boolean) => {
      const updated = RoadmapProgressService.completeRevision(itemId, recallSuccessful, uid);
      setRevisionQueue(RoadmapProgressService.getRevisionQueue(uid));

      if (uid && updated && typeof window !== 'undefined') {
        try {
          RoadmapOutboxService.enqueue(
            {
              type: 'set',
              path: cloudPaths.roadmapRevisionItem(uid, updated.id),
              data: encodeRevisionItemDoc(uid, updated),
              merge: true,
            },
            uid
          );
        } catch (err) {
          console.warn('[useRoadmapProgress] Local revision outbox persistence error:', err);
          roadmapSyncCoordinator.notifyPersistenceChange();
        }

        const cloud = createFirestoreCloudStore(db);
        RoadmapOutboxService.flush(uid, cloud).catch((err) =>
          console.warn('[useRoadmapProgress] Background revision sync:', err)
        );
      }

      return updated;
    },
    [uid]
  );

  // Grounded top recommendation
  const topRecommendation = useMemo(() => {
    return getTopAdaptiveRecommendation({
      roadmapsProgress,
      revisionQueue,
    });
  }, [roadmapsProgress, revisionQueue]);

  return {
    isLoading,
    roadmapsProgress,
    revisionQueue,
    topRecommendation,
    updateCheckpointProgress,
    recordAssessment,
    completeRevision,
    reloadData,
  };
}
