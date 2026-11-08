import type {
  Checkpoint,
  CheckpointLockReason,
  CheckpointNodeStatus,
  StageContractSpecification,
} from '../types/checkpoint.types';
import type {
  CheckpointProgress,
  RevisionItem,
  RoadmapProgress,
} from '../types/progress.types';
import type { Roadmap, RoadmapId } from '../types/roadmap.types';
import { getVerifiedAssessmentQuestions } from './contentGovernance';

/**
 * Checks whether a checkpoint has zero curriculum content authored.
 */
export function isCheckpointEmpty(checkpoint: Checkpoint): boolean {
  return (
    (!checkpoint.concepts || checkpoint.concepts.length === 0) &&
    (!checkpoint.diagnosticQuestions || checkpoint.diagnosticQuestions.length === 0) &&
    (!checkpoint.activeRecallPrompts || checkpoint.activeRecallPrompts.length === 0) &&
    (!checkpoint.practiceQuestions || checkpoint.practiceQuestions.length === 0) &&
    (!checkpoint.assessmentQuestions || checkpoint.assessmentQuestions.length === 0)
  );
}

/**
 * Checks whether a checkpoint has sufficient authored content to be playable.
 * In learner mode, requires at least one formally verified assessment question.
 * In internal validation mode, allows authored draft assessment questions.
 */
export function hasSufficientCheckpointContent(
  checkpoint: Checkpoint,
  mode: 'learner' | 'internal_validation' = 'internal_validation'
): boolean {
  if (isCheckpointEmpty(checkpoint)) {
    return false;
  }
  const totalItems =
    (checkpoint.concepts?.length || 0) +
    (checkpoint.diagnosticQuestions?.length || 0) +
    (checkpoint.activeRecallPrompts?.length || 0) +
    (checkpoint.practiceQuestions?.length || 0) +
    (checkpoint.assessmentQuestions?.length || 0);

  // Checkpoint with only 1 isolated item cannot satisfy milestone progression
  if (totalItems <= 1) {
    return false;
  }

  // Checkpoint must have assessment questions to allow milestone evaluation
  if (!checkpoint.assessmentQuestions || checkpoint.assessmentQuestions.length === 0) {
    return false;
  }

  // In learner mode, only formally verified assessment questions count
  if (mode === 'learner' && getVerifiedAssessmentQuestions(checkpoint).length === 0) {
    return false;
  }

  // Checkpoint must have foundational concept or diagnostic content
  const hasFoundationalContent =
    (checkpoint.concepts && checkpoint.concepts.length > 0) ||
    (checkpoint.diagnosticQuestions && checkpoint.diagnosticQuestions.length > 0);

  if (!hasFoundationalContent) {
    return false;
  }

  return true;
}

/**
 * Resolves detailed prerequisite and content lock reasons for a checkpoint.
 */
export function getCheckpointLockReason(
  checkpoint: Checkpoint,
  checkpointProgressMap: Record<string, CheckpointProgress>,
  mode: 'learner' | 'internal_validation' = 'internal_validation'
): CheckpointLockReason | null {
  // Check prerequisite locks first
  if (checkpoint.prerequisiteIds && checkpoint.prerequisiteIds.length > 0) {
    const unmet: string[] = [];
    const reasons: string[] = [];

    for (const prereqId of checkpoint.prerequisiteIds) {
      const prog = checkpointProgressMap[prereqId];
      if (!prog) {
        unmet.push(prereqId);
        reasons.push(`Prerequisite ${prereqId} has not been attempted.`);
        continue;
      }

      const hasGenuineMastery =
        (prog.masteryStatus === 'strong' || prog.masteryStatus === 'developing') &&
        (prog.masteryScore ?? 0) >= 60;

      if (!hasGenuineMastery) {
        unmet.push(prereqId);
        if (prog.masteryStatus === 'needs_reinforcement') {
          reasons.push(
            `Prerequisite ${prereqId} scored ${prog.masteryScore}%; needs reinforcement (minimum 60% developing score required).`
          );
        } else if (prog.masteryStatus === 'insufficient_evidence') {
          reasons.push(`Prerequisite ${prereqId} has insufficient assessment evidence.`);
        } else {
          reasons.push(`Prerequisite ${prereqId} requires demonstrated mastery (minimum 60% developing score).`);
        }
      }
    }

    if (unmet.length > 0) {
      return {
        isLocked: true,
        status: 'locked',
        description: reasons.join(' '),
        unmetPrerequisiteIds: unmet,
        missingContentReasons: [],
      };
    }
  }

  // Check content availability
  if (!hasSufficientCheckpointContent(checkpoint, mode)) {
    const missing: string[] = [];
    if (!checkpoint.concepts || checkpoint.concepts.length === 0) {
      missing.push('Concept revision notes pending authoring');
    }
    if (!checkpoint.diagnosticQuestions || checkpoint.diagnosticQuestions.length === 0) {
      missing.push('Diagnostic questions pending authoring');
    }
    if (!checkpoint.activeRecallPrompts || checkpoint.activeRecallPrompts.length === 0) {
      missing.push('Active recall prompts pending authoring');
    }
    if (!checkpoint.assessmentQuestions || checkpoint.assessmentQuestions.length === 0) {
      missing.push('Assessment questions pending authoring');
    } else if (mode === 'learner' && getVerifiedAssessmentQuestions(checkpoint).length === 0) {
      missing.push('Assessment questions pending formal verification review');
    }

    const description = isCheckpointEmpty(checkpoint)
      ? `Content unavailable: Milestone ${checkpoint.id} has no curriculum content or questions authored.`
      : mode === 'learner' && getVerifiedAssessmentQuestions(checkpoint).length === 0
      ? `Content unavailable: Milestone ${checkpoint.id} assessment questions are undergoing formal SME verification; not yet available for learner assessment.`
      : `Content unavailable: Milestone ${checkpoint.id} lacks assessment questions required for milestone progression.`;

    return {
      isLocked: true,
      status: 'content_unavailable',
      description,
      unmetPrerequisiteIds: [],
      missingContentReasons: missing,
    };
  }

  return null;
}

/**
 * Determines whether all prerequisites for a checkpoint are satisfied.
 * Arbitrary status === 'completed' is strictly rejected without genuine mastery evidence.
 */
export function arePrerequisitesSatisfied(
  checkpoint: Checkpoint,
  checkpointProgressMap: Record<string, CheckpointProgress>
): boolean {
  if (checkpoint.prerequisiteIds.length === 0) {
    return true;
  }

  for (const prereqId of checkpoint.prerequisiteIds) {
    const prereqProgress = checkpointProgressMap[prereqId];
    if (!prereqProgress) {
      return false;
    }

    // Prerequisite is satisfied ONLY if genuine developing or strong mastery was earned
    // Arbitrary status === 'completed' without genuine mastery is rejected
    const isMastered =
      (prereqProgress.masteryStatus === 'strong' || prereqProgress.masteryStatus === 'developing') &&
      (prereqProgress.masteryScore ?? 0) >= 60;

    if (!isMastered) {
      return false;
    }
  }

  return true;
}

/**
 * Resolves the display status for a checkpoint node.
 * Correctly assigns content_unavailable for empty or incomplete checkpoints.
 */
export function resolveCheckpointNodeStatus(
  checkpoint: Checkpoint,
  progress: CheckpointProgress | undefined,
  allProgressMap: Record<string, CheckpointProgress>,
  dueRevisionItems: readonly RevisionItem[] = [],
  mode: 'learner' | 'internal_validation' = 'internal_validation'
): CheckpointNodeStatus {
  // Check if there are active due/overdue revisions for this checkpoint
  const hasDueRevision = dueRevisionItems.some(
    (item) => item.checkpointId === checkpoint.id && (item.status === 'due' || item.status === 'overdue')
  );

  const hasGenuineMastery =
    progress &&
    (progress.masteryStatus === 'strong' || progress.masteryStatus === 'developing') &&
    (progress.masteryScore ?? 0) >= 60;

  if (hasDueRevision && hasGenuineMastery) {
    return 'revision_due';
  }

  // Preserve previously earned genuine mastery
  if (hasGenuineMastery) {
    return 'completed';
  }

  if (progress?.masteryStatus === 'needs_reinforcement') {
    return 'needs_reinforcement';
  }

  const prereqsMet = arePrerequisitesSatisfied(checkpoint, allProgressMap);
  if (!prereqsMet) {
    return 'locked';
  }

  // When prerequisites are satisfied (or checkpoint has no prerequisites),
  // verify whether content is actually available to learn and complete
  if (!hasSufficientCheckpointContent(checkpoint, mode)) {
    return 'content_unavailable';
  }

  if (!progress) {
    return checkpoint.order === 1 ? 'current' : 'available';
  }

  return progress.status || 'available';
}

/**
 * Enforceable specifications for each learning stage contract.
 */
export const STAGE_CONTRACT_SPECIFICATIONS: readonly StageContractSpecification[] = Object.freeze([
  {
    stage: 'diagnostic',
    requiredContentDescription: '>= 4 valid diagnostic multiple-choice questions with educational explanations',
    minimumEvidenceDescription: 'Attempt of >= 4 questions recorded with question-topic outcomes',
    evidenceCreationFunction: 'evaluateDiagnostic(DiagnosticEvaluationInput)',
    evidencePersistenceField: 'CheckpointProgress.diagnosticScore & CheckpointProgress.diagnosticCleared',
    completionEvaluatorFunction: 'canSkipIntroRevision: input.totalQuestions >= 4 && score >= 80%',
    masteryImpact: 'Zero mastery score impact. Diagnostic clearance does NOT grant checkpoint mastery.',
    prerequisiteUnlockImpact: 'Zero unlock impact. Diagnostic clearance never unlocks downstream checkpoints.',
  },
  {
    stage: 'revision',
    requiredContentDescription: '>= 1 curated concept card with summary, essential formulas, and pitfall analysis',
    minimumEvidenceDescription: 'Active review interaction across all configured concept cards',
    evidenceCreationFunction: 'CheckpointDetailPanel.handleRevisionComplete()',
    evidencePersistenceField: 'CheckpointProgress.revisionCompleted',
    completionEvaluatorFunction: 'revisionCompleted === true',
    masteryImpact: 'Zero mastery score impact. Revision completion does NOT award assessment mastery.',
    prerequisiteUnlockImpact: 'Zero unlock impact. Revision completion cannot unlock downstream checkpoints.',
  },
  {
    stage: 'active_recall',
    requiredContentDescription: '>= 3 valid recall prompts with 4 distinct options and explanations',
    minimumEvidenceDescription: 'Attempt of >= 3 recall prompts with retrieval accuracy recorded',
    evidenceCreationFunction: 'CheckpointDetailPanel.handleRecallComplete(correct, total, weakTopics)',
    evidencePersistenceField: 'CheckpointProgress.activeRecallScore',
    completionEvaluatorFunction: 'activeRecallScore !== undefined && activeRecallScore.total >= 3',
    masteryImpact: 'Zero direct assessment mastery impact. Distinguishes attempt from demonstrated retrieval.',
    prerequisiteUnlockImpact: 'Zero unlock impact. Active recall completion cannot unlock downstream checkpoints.',
  },
  {
    stage: 'assessment',
    requiredContentDescription: '>= 5 verified assessment questions with JEE marking scheme (+4, -1, 0)',
    minimumEvidenceDescription: 'Timed attempt of >= 5 assessment questions with positive/negative raw score',
    evidenceCreationFunction: 'evaluateMastery(AssessmentAttemptResult, ...)',
    evidencePersistenceField: 'CheckpointProgress.assessmentResult & CheckpointProgress.masteryStatus',
    completionEvaluatorFunction: 'score >= 80% (strong), score >= 60% (developing), score < 60% (needs_reinforcement)',
    masteryImpact: 'Directly determines milestone masteryStatus and masteryScore (0..100).',
    prerequisiteUnlockImpact: 'Prerequisites unlock downstream checkpoints ONLY upon developing or strong mastery.',
  },
]);

/**
 * Computes overall completion percentage and completed checkpoint count for a roadmap.
 */
export function computeRoadmapCompletion(
  roadmap: Roadmap,
  checkpoints: readonly Checkpoint[],
  progressMap: Record<string, CheckpointProgress>
): {
  completionPercentage: number;
  completedCount: number;
  currentCheckpointId: string;
} {
  let completedCount = 0;
  let totalMasteryPoints = 0;
  let currentCheckpointId = checkpoints[0]?.id || '';

  for (const cp of checkpoints) {
    const cpProgress = progressMap[cp.id];
    if (cpProgress) {
      if (cpProgress.masteryStatus === 'strong' || cpProgress.masteryStatus === 'developing') {
        completedCount += 1;
      }
      totalMasteryPoints += cpProgress.masteryScore || 0;

      if (cpProgress.status === 'current' || cpProgress.status === 'needs_reinforcement') {
        currentCheckpointId = cp.id;
      }
    }
  }

  // If all completed, current is the last
  if (completedCount === checkpoints.length && checkpoints.length > 0) {
    currentCheckpointId = checkpoints[checkpoints.length - 1].id;
  }

  const completionPercentage =
    checkpoints.length > 0
      ? Math.min(100, Math.round((totalMasteryPoints / (checkpoints.length * 100)) * 100))
      : 0;

  return {
    completionPercentage,
    completedCount,
    currentCheckpointId,
  };
}
