import type { PracticeTier } from './checkpoint.types';

export type QuestionVerificationStatus = 'verified' | 'pending_review' | 'draft';

export type QuestionSourceType = 'official_pyq' | 'curated_standard' | 'original_author';

export interface AuthorReviewerMetadata {
  readonly authorId: string;
  readonly reviewerId?: string;
  readonly reviewedAt?: string;
  readonly reviewNotes?: string;
}

export interface QuestionProvenance {
  readonly sourceType: QuestionSourceType;
  readonly examSession?: string; // e.g., 'JEE Main 2024 Session 1 (27 Jan Shift 1)'
  readonly examYear?: number;
  readonly originalQuestionNumber?: number;
  readonly licenseOrRights: 'official_nta_public_exam' | 'learnmate_original' | 'fair_use_educational';
  readonly verificationStatus: QuestionVerificationStatus;
  readonly reviewerMetadata?: AuthorReviewerMetadata;
}

export interface ValidatedPracticeQuestion {
  readonly id: string;
  readonly tier: PracticeTier;
  readonly type: 'mcq' | 'numerical';
  readonly subject: 'physics' | 'chemistry' | 'mathematics';
  readonly unitNumber: number;
  readonly chapterId: string;
  readonly topicId: string;
  readonly topicLabel?: string;
  readonly stem: string;
  readonly options?: readonly [string, string, string, string];
  readonly correctOptionIndex?: number;
  readonly acceptedNumerical?: number;
  readonly hint: string;
  readonly explanation: string;
  readonly errorClassification?: 'conceptual' | 'calculation' | 'formula_recall' | 'reading_misinterpretation';
  readonly provenance: QuestionProvenance;
}

export interface ValidatedAssessmentQuestion {
  readonly id: string;
  readonly type: 'mcq' | 'numerical';
  readonly subject: 'physics' | 'chemistry' | 'mathematics';
  readonly unitNumber: number;
  readonly chapterId: string;
  readonly topicId: string;
  readonly topicLabel?: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly stem: string;
  readonly options?: readonly [string, string, string, string];
  readonly correctOptionIndex?: number;
  readonly acceptedNumerical?: number;
  readonly explanation: string;
  readonly errorClassification?: 'conceptual' | 'calculation' | 'formula_recall' | 'reading_misinterpretation';
  readonly provenance: QuestionProvenance;
}

export interface CheckpointPedagogicalDimensionCheck {
  readonly dimension: string;
  readonly supported: boolean;
  readonly count: number;
  readonly status: 'complete' | 'partial' | 'pending';
  readonly notes?: string;
}

export type CheckpointReadinessStatus = 'ready' | 'internal_validation_only' | 'content_unavailable';

export interface CheckpointQuestionTypeAudit {
  readonly total: number;
  readonly verified: number;
  readonly pendingReview: number;
  readonly draft: number;
  readonly sourceSchema: string;
}

export interface CheckpointContentAuditResult {
  readonly checkpointId: string;
  readonly roadmapId: string;
  readonly title: string;
  readonly stageModel?: '6-stage-milestone';
  readonly order?: number;
  readonly readinessScorePct: number; // 0..100
  readonly dimensions: readonly CheckpointPedagogicalDimensionCheck[];
  readonly diagnosticCount?: number;
  readonly recallCount?: number;
  readonly practiceCount?: number;
  readonly assessmentCount?: number;
  readonly verifiedQuestionsCount: number;
  readonly pendingReviewQuestionsCount: number;
  readonly draftQuestionsCount: number;
  readonly verifiedCount?: number;
  readonly pendingReviewCount?: number;
  readonly draftCount?: number;
  readonly questionBreakdown?: {
    readonly diagnostic: CheckpointQuestionTypeAudit;
    readonly recall: CheckpointQuestionTypeAudit;
    readonly practice: CheckpointQuestionTypeAudit;
    readonly assessment: CheckpointQuestionTypeAudit;
  };
  readonly requiredEvidence?: string;
  readonly minimumEvidenceThreshold?: {
    readonly minDiagnostic: number;
    readonly minRecall: number;
    readonly minAssessment: number;
    readonly minConcepts: number;
  };
  readonly prerequisiteStatus?: 'no_prerequisites' | 'prerequisites_met' | 'prerequisites_unmet';
  readonly readinessStatus?: CheckpointReadinessStatus;
  readonly blockedOrUnavailableReason?: string;
  readonly canStudentCompleteJourney: boolean;
  readonly missingPedagogicalDimensions: readonly string[];
}

export interface CatalogueContentAuditReport {
  readonly totalCheckpointsCount: number;
  readonly auditedAt: string;
  readonly pilotRoadmapId: 'PHY-01';
  readonly pilotRoadmapEligibility?: 'approved_for_pilot' | 'internal_validation_only' | 'blocked';
  readonly pilotRoadmapEligibilityReason?: string;
  readonly pilotRoadmapReadinessScorePct: number;
  readonly overallReadinessScorePct: number;
  readonly pedagogicalInfrastructureScorePct: number;
  readonly verifiedContentReadinessScorePct: number;
  readonly totalVerifiedAssessmentQuestionsCount: number;
  readonly totalReadyCheckpointsCount?: number;
  readonly totalInternalValidationCheckpointsCount?: number;
  readonly totalContentUnavailableCheckpointsCount?: number;
  readonly subjectBreakdown: {
    readonly physics: { totalCheckpoints: number; averageReadinessScorePct: number };
    readonly chemistry: { totalCheckpoints: number; averageReadinessScorePct: number };
    readonly mathematics: { totalCheckpoints: number; averageReadinessScorePct: number };
  };
  readonly checkpoints: readonly CheckpointContentAuditResult[];
}
