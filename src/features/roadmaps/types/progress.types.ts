import type {
  CheckpointNodeStatus,
  LearningStage,
  MasteryStatus,
  PracticeTier,
} from './checkpoint.types';
import type { RoadmapId } from './roadmap.types';

export interface StageScore {
  correct: number;
  total: number;
  percentage: number;
  completedAt: string;
}

export interface AssessmentAttemptResult {
  attemptId: string;
  score: number;
  totalMarks: number;
  rawMarks: number;
  percentage: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  timeTakenSeconds: number;
  completedAt: string;
  weakTopics: string[];
  strongTopics: string[];
  conceptualErrors?: string[];
  calculationErrors?: string[];
  mode?: 'learner' | 'internal_validation';
  isInternalValidation?: boolean;
}

export interface CheckpointProgress {
  checkpointId: string;
  roadmapId: RoadmapId;
  status: CheckpointNodeStatus;
  currentStage: LearningStage;
  diagnosticCleared: boolean;
  diagnosticScore?: StageScore;
  revisionCompleted: boolean;
  activeRecallScore?: StageScore;
  practiceStats?: {
    attempted: number;
    correct: number;
    highestTierUnlocked: PracticeTier;
    lastPracticedAt: string;
  };
  assessmentResult?: AssessmentAttemptResult;
  lastInternalValidationAttempt?: AssessmentAttemptResult;
  masteryStatus: MasteryStatus;
  masteryScore: number; // 0 to 100
  lastActivityAt: string;
  nextRevisionDue?: string;
  historicalAttemptsCount: number;
}

export interface RoadmapProgress {
  roadmapId: RoadmapId;
  completionPercentage: number;
  completedCheckpointsCount: number;
  currentCheckpointId: string;
  checkpoints: Record<string, CheckpointProgress>;
  lastActivityAt: string;
}

export type RevisionItemStatus = 'due' | 'overdue' | 'upcoming' | 'completed';

export interface RevisionItem {
  id: string; // unique item id
  topicId: string;
  topicName: string;
  roadmapId: RoadmapId;
  checkpointId: string;
  scheduledForDate: string; // YYYY-MM-DD
  intervalStep: number; // 0=Day 1, 1=Day 3, 2=Day 7, 3=Day 14, 4=Day 30
  status: RevisionItemStatus;
  reason: string;
  lastRevisedAt?: string;
  consecutiveMasteryCount: number;
  priority: 'high' | 'medium' | 'low';
}

export interface AdaptiveRecommendation {
  id: string;
  type: 'revision' | 'reinforcement' | 'continue_stage' | 'next_checkpoint';
  roadmapId: RoadmapId;
  checkpointId: string;
  title: string;
  message: string;
  rationale: string;
  actionStage: LearningStage;
  targetTopicIds?: string[];
  urgency: 'high' | 'medium' | 'low';
}
