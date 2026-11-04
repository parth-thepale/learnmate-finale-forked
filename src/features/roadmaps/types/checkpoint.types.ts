import type { RoadmapId, RoadmapSubjectId } from './roadmap.types';

export type CheckpointNodeStatus =
  | 'locked'
  | 'available'
  | 'current'
  | 'completed'
  | 'revision_due'
  | 'needs_reinforcement'
  | 'content_unavailable';

export interface CheckpointLockReason {
  readonly isLocked: boolean;
  readonly status: CheckpointNodeStatus;
  readonly description: string;
  readonly unmetPrerequisiteIds: readonly string[];
  readonly missingContentReasons: readonly string[];
}

export type CheckpointContractType =
  | 'assessment'
  | 'revision'
  | 'active_recall'
  | 'diagnostic';

export interface StageContractSpecification {
  readonly stage: CheckpointContractType;
  readonly requiredContentDescription: string;
  readonly minimumEvidenceDescription: string;
  readonly evidenceCreationFunction: string;
  readonly evidencePersistenceField: string;
  readonly completionEvaluatorFunction: string;
  readonly masteryImpact: string;
  readonly prerequisiteUnlockImpact: string;
}

export type MasteryStatus =
  | 'unattempted'
  | 'insufficient_evidence'
  | 'needs_reinforcement'
  | 'developing'
  | 'strong';

export type LearningStage =
  | 'diagnostic'
  | 'revision'
  | 'recall'
  | 'practice'
  | 'assessment'
  | 'analysis';

export interface ConceptFormula {
  label: string;
  formula: string;
  description?: string;
}

export interface ConceptCard {
  id: string;
  topicId: string;
  title: string;
  summary: string;
  keyFormulas: ConceptFormula[];
  commonPitfalls?: string[];
  importantExceptions?: string[];
  pyqTrends?: string;
  mnemonicOrTip?: string;
}

export interface RecallPrompt {
  id: string;
  topicId: string;
  topicLabel?: string;
  prompt: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}

export type PracticeTier = 'foundation' | 'application' | 'jee_main';

export type ReviewStatus = 'draft' | 'pending_review' | 'verified' | 'rejected';

export interface ContentReviewRecord {
  readonly reviewStatus: ReviewStatus;
  readonly reviewerId: string;
  readonly reviewedAt: string; // ISO 8601
  readonly reviewNotes?: string;
  readonly mathematicalCheckConfirmed: boolean;
  readonly pedagogicalReviewConfirmed: boolean;
  readonly contentVersion: string;
  readonly questionId?: string;
  readonly checkpointId?: string;
  readonly topicId?: string;
  readonly subject?: string;
  readonly signature?: string;
  readonly signingKeyId?: string;
  readonly signatureAlgorithm?: string;
  readonly lifecycleStatus?: 'staged' | 'approved' | 'revoked' | 'superseded';
}

export interface PracticeQuestion {
  id: string;
  tier: PracticeTier;
  type: 'mcq' | 'numerical';
  topicId: string;
  topicLabel?: string;
  stem: string;
  options?: [string, string, string, string];
  correctOptionIndex?: number;
  acceptedNumerical?: number;
  hint: string;
  explanation: string;
  provenance: string;
  isVerified: boolean;
  readonly reviewRecord?: ContentReviewRecord;
}

export interface AssessmentQuestion {
  id: string;
  type: 'mcq' | 'numerical';
  topicId: string;
  topicLabel?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  stem: string;
  options?: [string, string, string, string];
  correctOptionIndex?: number;
  acceptedNumerical?: number;
  explanation: string;
  readonly isVerified?: boolean;
  readonly reviewRecord?: ContentReviewRecord;
}

export interface BranchNode {
  id: string;
  title: string;
  type: 'challenge' | 'deep_practice' | 'revision';
  description: string;
  recommendedWhen: string;
}

export interface Checkpoint {
  readonly id: string; // e.g., 'PHY-01-CP1'
  readonly roadmapId: RoadmapId;
  readonly subject: RoadmapSubjectId;
  readonly order: number; // 1, 2, 3, 4
  readonly title: string;
  readonly description: string;
  readonly learningObjectives: readonly string[];
  readonly officialUnitNumbers: readonly number[];
  readonly officialChapterIds: readonly string[];
  readonly topicIds: readonly string[];
  readonly prerequisiteIds: readonly string[];
  readonly estimatedWorkloadMinutes: number;
  readonly branchNodes?: readonly BranchNode[];
  readonly concepts: readonly ConceptCard[];
  readonly diagnosticQuestions: readonly RecallPrompt[];
  readonly activeRecallPrompts: readonly RecallPrompt[];
  readonly practiceQuestions: readonly PracticeQuestion[];
  readonly assessmentQuestions: readonly AssessmentQuestion[];
}
