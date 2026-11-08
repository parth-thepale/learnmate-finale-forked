import type { Checkpoint } from '../types/checkpoint.types';
import type {
  AdaptiveRecommendation,
  CheckpointProgress,
  RevisionItem,
  RoadmapProgress,
} from '../types/progress.types';
import type { Roadmap } from '../types/roadmap.types';
import { ALL_CHECKPOINTS, getCheckpointById } from '../data/checkpointRegistry';
import { ALL_ROADMAPS } from '../data/roadmaps';
import { partitionRevisionQueue } from './revisionScheduler';

export interface RecommendationContext {
  roadmapsProgress: Record<string, RoadmapProgress>;
  revisionQueue: readonly RevisionItem[];
  referenceDate?: Date;
}

/**
 * Generates clear, grounded recommendations strictly based on actual student activity.
 * Explains WHY the action is recommended citing specific topics and metrics.
 */
export function getTopAdaptiveRecommendation(
  context: RecommendationContext
): AdaptiveRecommendation | null {
  const refDate = context.referenceDate ?? new Date();
  const queue = partitionRevisionQueue(context.revisionQueue, refDate);

  // 1. Priority 1: Overdue or Due Spaced Revision
  if (queue.overdue.length > 0) {
    const item = queue.overdue[0];
    const cp = getCheckpointById(item.checkpointId);
    return {
      id: `rec-rev-overdue-${item.id}`,
      type: 'revision',
      roadmapId: item.roadmapId,
      checkpointId: item.checkpointId,
      title: `Overdue Revision: ${item.topicName}`,
      message: `Your scheduled revision for "${item.topicName}" is overdue. Active retrieval now prevents forgetting.`,
      rationale: `Scheduled due date was ${item.scheduledForDate}. ${item.reason}`,
      actionStage: 'recall',
      targetTopicIds: [item.topicId],
      urgency: 'high',
    };
  }

  if (queue.dueToday.length > 0) {
    const item = queue.dueToday[0];
    return {
      id: `rec-rev-due-${item.id}`,
      type: 'revision',
      roadmapId: item.roadmapId,
      checkpointId: item.checkpointId,
      title: `Spaced Revision Due: ${item.topicName}`,
      message: `Time for spaced retrieval practice on "${item.topicName}".`,
      rationale: `Calculated from your prior performance in ${item.checkpointId}.`,
      actionStage: 'recall',
      targetTopicIds: [item.topicId],
      urgency: 'high',
    };
  }

  // 2. Priority 2: Checkpoint needing reinforcement
  for (const [rmId, rmProg] of Object.entries(context.roadmapsProgress)) {
    for (const [cpId, cpProg] of Object.entries(rmProg.checkpoints)) {
      if (cpProg.masteryStatus === 'needs_reinforcement') {
        const cp = getCheckpointById(cpId);
        const weakList = cpProg.assessmentResult?.weakTopics || [];
        const weakStr = weakList.length > 0 ? ` Focusing on: ${weakList.slice(0, 2).join(', ')}.` : '';
        return {
          id: `rec-reinf-${cpId}`,
          type: 'reinforcement',
          roadmapId: cpProg.roadmapId,
          checkpointId: cpId,
          title: `Reinforce: ${cp?.title || cpId}`,
          message: `Your assessment accuracy was ${cpProg.masteryScore}%. Review the core concepts and retry practice.${weakStr}`,
          rationale: `Accuracy below 60% indicates foundational gaps that will affect downstream topics.`,
          actionStage: 'revision',
          targetTopicIds: weakList,
          urgency: 'high',
        };
      }
    }
  }

  // 3. Priority 3: Current in-progress checkpoint
  for (const [rmId, rmProg] of Object.entries(context.roadmapsProgress)) {
    for (const [cpId, cpProg] of Object.entries(rmProg.checkpoints)) {
      if (cpProg.status === 'current') {
        const cp = getCheckpointById(cpId);
        const nextStage = cpProg.currentStage || (cpProg.diagnosticCleared ? 'recall' : 'diagnostic');
        return {
          id: `rec-current-${cpId}`,
          type: 'continue_stage',
          roadmapId: cpProg.roadmapId,
          checkpointId: cpId,
          title: `Continue: ${cp?.title || cpId}`,
          message: `Resume your learning path at ${nextStage.toUpperCase()} stage.`,
          rationale: `Completing all stages unlocks the assessment and advances your roadmap.`,
          actionStage: nextStage,
          urgency: 'medium',
        };
      }
    }
  }

  // 4. Priority 4: Start first checkpoint of PHY-01 or active subject
  const defaultCp = ALL_CHECKPOINTS[0];
  if (defaultCp) {
    return {
      id: `rec-start-${defaultCp.id}`,
      type: 'next_checkpoint',
      roadmapId: defaultCp.roadmapId,
      checkpointId: defaultCp.id,
      title: `Begin: ${defaultCp.title}`,
      message: 'Take the diagnostic assessment to gauge your baseline mechanics preparation.',
      rationale: 'Diagnosing your initial knowledge allows you to skip familiar revision topics.',
      actionStage: 'diagnostic',
      urgency: 'low',
    };
  }

  return null;
}
