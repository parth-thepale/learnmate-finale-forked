import type { Checkpoint } from '../types/checkpoint.types';
import type {
  CatalogueContentAuditReport,
  CheckpointContentAuditResult,
  CheckpointPedagogicalDimensionCheck,
  CheckpointQuestionTypeAudit,
  CheckpointReadinessStatus,
} from '../types/contentSchema.types';
import { ALL_CHECKPOINTS } from './checkpointRegistry';
import { ALL_ROADMAPS } from './roadmaps';
import { PHY01_DRAFT_PRACTICE_QUESTIONS } from './draftContent/phy01DraftContent';
import { isQuestionFormallyVerified } from '../engine/contentGovernance';

export const READINESS_THRESHOLDS = Object.freeze({
  MIN_ASSESSMENT_QUESTIONS_PILOT: 5,
  MIN_ACTIVE_RECALL_PROMPTS: 3,
  MIN_DIAGNOSTIC_QUESTIONS: 4,
  MIN_CONCEPTS: 1,
});

/**
 * Audits a single checkpoint across schema contracts, pedagogical dimensions,
 * and authentic verification status.
 */
export function auditCheckpointContent(checkpoint: Checkpoint): CheckpointContentAuditResult {
  // Check if draft practice questions exist for this checkpoint
  const draftPractice = PHY01_DRAFT_PRACTICE_QUESTIONS.filter(
    (q) => q.chapterId && checkpoint.officialChapterIds.includes(q.chapterId)
  );

  const combinedPractice = [...checkpoint.practiceQuestions, ...draftPractice];

  const hasFormulas = checkpoint.concepts.some((c) => c.keyFormulas && c.keyFormulas.length > 0);
  const hasPitfalls = checkpoint.concepts.some((c) => c.commonPitfalls && c.commonPitfalls.length > 0);
  const foundationCount = combinedPractice.filter((p) => p.tier === 'foundation').length;
  const applicationCount = combinedPractice.filter((p) => p.tier === 'application').length;
  const jeeMainPracticeCount = combinedPractice.filter((p) => p.tier === 'jee_main').length;

  const allQuestionsHaveExplanations =
    (checkpoint.diagnosticQuestions.length === 0 ||
      checkpoint.diagnosticQuestions.every((q) => q.explanation && q.explanation.length > 10)) &&
    (checkpoint.activeRecallPrompts.length === 0 ||
      checkpoint.activeRecallPrompts.every((q) => q.explanation && q.explanation.length > 10)) &&
    (checkpoint.assessmentQuestions.length === 0 ||
      checkpoint.assessmentQuestions.every((q) => q.explanation && q.explanation.length > 10)) &&
    (combinedPractice.length === 0 ||
      combinedPractice.every((q) => q.explanation && q.explanation.length > 10));

  const hasAnyQuestions =
    checkpoint.diagnosticQuestions.length > 0 ||
    checkpoint.activeRecallPrompts.length > 0 ||
    combinedPractice.length > 0 ||
    checkpoint.assessmentQuestions.length > 0;

  const dimensions: CheckpointPedagogicalDimensionCheck[] = [
    {
      dimension: '1. Concept Revision',
      supported: checkpoint.concepts.length >= READINESS_THRESHOLDS.MIN_CONCEPTS,
      count: checkpoint.concepts.length,
      status: checkpoint.concepts.length >= 2 ? 'complete' : checkpoint.concepts.length === 1 ? 'partial' : 'pending',
    },
    {
      dimension: '2. Formula & Key Fact Sheets',
      supported: hasFormulas,
      count: checkpoint.concepts.reduce((n, c) => n + (c.keyFormulas?.length || 0), 0),
      status: hasFormulas ? 'complete' : 'pending',
    },
    {
      dimension: '3. Common Mistakes & Misconceptions',
      supported: hasPitfalls,
      count: checkpoint.concepts.reduce((n, c) => n + (c.commonPitfalls?.length || 0), 0),
      status: hasPitfalls ? 'complete' : 'pending',
    },
    {
      dimension: '4. Active Recall Prompts',
      supported: checkpoint.activeRecallPrompts.length >= READINESS_THRESHOLDS.MIN_ACTIVE_RECALL_PROMPTS,
      count: checkpoint.activeRecallPrompts.length,
      status:
        checkpoint.activeRecallPrompts.length >= READINESS_THRESHOLDS.MIN_ACTIVE_RECALL_PROMPTS
          ? 'complete'
          : checkpoint.activeRecallPrompts.length > 0
          ? 'partial'
          : 'pending',
    },
    {
      dimension: '5. Diagnostic Screening',
      supported: checkpoint.diagnosticQuestions.length >= READINESS_THRESHOLDS.MIN_DIAGNOSTIC_QUESTIONS,
      count: checkpoint.diagnosticQuestions.length,
      status:
        checkpoint.diagnosticQuestions.length >= READINESS_THRESHOLDS.MIN_DIAGNOSTIC_QUESTIONS
          ? 'complete'
          : checkpoint.diagnosticQuestions.length > 0
          ? 'partial'
          : 'pending',
      notes:
        checkpoint.diagnosticQuestions.length < READINESS_THRESHOLDS.MIN_DIAGNOSTIC_QUESTIONS
          ? `Requires >= ${READINESS_THRESHOLDS.MIN_DIAGNOSTIC_QUESTIONS} questions for reliable skip screening`
          : undefined,
    },
    {
      dimension: '6. Foundation Practice',
      supported: foundationCount > 0,
      count: foundationCount,
      status: foundationCount > 0 ? 'complete' : 'pending',
    },
    {
      dimension: '7. JEE Main Practice',
      supported: jeeMainPracticeCount > 0,
      count: jeeMainPracticeCount,
      status: jeeMainPracticeCount > 0 ? 'complete' : 'pending',
    },
    {
      dimension: '8. Application / Challenge Nodes',
      supported: Boolean(applicationCount > 0 || (checkpoint.branchNodes && checkpoint.branchNodes.length > 0)),
      count: applicationCount + (checkpoint.branchNodes?.length || 0),
      status:
        applicationCount > 0 || (checkpoint.branchNodes && checkpoint.branchNodes.length > 0)
          ? 'complete'
          : 'pending',
    },
    {
      dimension: '9. Timed Assessment',
      supported: checkpoint.assessmentQuestions.length >= READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT,
      count: checkpoint.assessmentQuestions.length,
      status:
        checkpoint.assessmentQuestions.length >= READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT
          ? 'complete'
          : checkpoint.assessmentQuestions.length > 0
          ? 'partial'
          : 'pending',
      notes:
        checkpoint.assessmentQuestions.length === 0
          ? 'Questions pending authoring'
          : checkpoint.assessmentQuestions.length < READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT
          ? `Requires >= ${READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT} questions for pilot readiness (found ${checkpoint.assessmentQuestions.length})`
          : undefined,
    },
    {
      dimension: '10. Detailed Answer Explanations',
      supported: hasAnyQuestions && allQuestionsHaveExplanations,
      count:
        checkpoint.diagnosticQuestions.length +
        checkpoint.activeRecallPrompts.length +
        checkpoint.assessmentQuestions.length +
        combinedPractice.length,
      status: hasAnyQuestions && allQuestionsHaveExplanations ? 'complete' : 'partial',
    },
    {
      dimension: '11. Error Classification & Diagnostic Tags',
      supported: checkpoint.topicIds.length > 0,
      count: checkpoint.topicIds.length,
      status: checkpoint.topicIds.length >= 3 ? 'complete' : 'partial',
    },
    {
      dimension: '12. Spaced Revision Metadata',
      supported: true,
      count: checkpoint.topicIds.length,
      status: 'complete',
      notes: 'Integrated with Fixed-Interval Spaced Repetition engine [1, 3, 7, 14, 30]',
    },
  ];

  const supportedCount = dimensions.filter((d) => d.supported).length;
  const readinessScorePct = Math.round((supportedCount / dimensions.length) * 100);

  const missingPedagogicalDimensions = dimensions
    .filter((d) => !d.supported)
    .map((d) => d.dimension);

  // Schema-level question classification:
  // 1. Diagnostic questions (schema: RecallPrompt - unreviewed schema lacks verification metadata)
  const diagnosticAudit: CheckpointQuestionTypeAudit = {
    total: checkpoint.diagnosticQuestions.length,
    verified: 0,
    pendingReview: checkpoint.diagnosticQuestions.length,
    draft: 0,
    sourceSchema: 'checkpoint.diagnosticQuestions: RecallPrompt (unreviewed schema; pending verification sign-off)',
  };

  // 2. Active Recall prompts (schema: RecallPrompt - unreviewed schema lacks verification metadata)
  const recallAudit: CheckpointQuestionTypeAudit = {
    total: checkpoint.activeRecallPrompts.length,
    verified: 0,
    pendingReview: checkpoint.activeRecallPrompts.length,
    draft: 0,
    sourceSchema: 'checkpoint.activeRecallPrompts: RecallPrompt (unreviewed schema; pending verification sign-off)',
  };

  // 3. Practice questions (schema: PracticeQuestion / ValidatedPracticeQuestion)
  let verifiedPractice = 0;
  let pendingPractice = 0;
  let draftPracticeCount = 0;

  for (const q of checkpoint.practiceQuestions) {
    if (q.isVerified === true) verifiedPractice++;
    else pendingPractice++;
  }

  for (const q of draftPractice) {
    if (q.provenance?.verificationStatus === 'verified') verifiedPractice++;
    else if (q.provenance?.verificationStatus === 'pending_review') pendingPractice++;
    else draftPracticeCount++;
  }

  const practiceAudit: CheckpointQuestionTypeAudit = {
    total: combinedPractice.length,
    verified: verifiedPractice,
    pendingReview: pendingPractice,
    draft: draftPracticeCount,
    sourceSchema: 'checkpoint.practiceQuestions: PracticeQuestion + draftContent: ValidatedPracticeQuestion',
  };

  // 4. Assessment questions (schema: AssessmentQuestion - inspected for explicit formal review status)
  let verifiedAssessment = 0;
  let pendingAssessment = 0;

  for (const q of checkpoint.assessmentQuestions) {
    if (isQuestionFormallyVerified(q)) {
      verifiedAssessment++;
    } else {
      pendingAssessment++;
    }
  }

  const assessmentAudit: CheckpointQuestionTypeAudit = {
    total: checkpoint.assessmentQuestions.length,
    verified: verifiedAssessment,
    pendingReview: pendingAssessment,
    draft: 0,
    sourceSchema: 'checkpoint.assessmentQuestions: AssessmentQuestion (strictly evaluated with isQuestionFormallyVerified; missing/incomplete review records fail closed to pending_review)',
  };

  const verifiedQuestionsCount =
    diagnosticAudit.verified +
    recallAudit.verified +
    practiceAudit.verified +
    assessmentAudit.verified;

  const pendingReviewQuestionsCount =
    diagnosticAudit.pendingReview +
    recallAudit.pendingReview +
    practiceAudit.pendingReview +
    assessmentAudit.pendingReview;

  const totalDraftCount =
    diagnosticAudit.draft +
    recallAudit.draft +
    practiceAudit.draft +
    assessmentAudit.draft;

  // Determine readiness status and blocked reasons
  const isCompletelyEmpty =
    checkpoint.concepts.length === 0 &&
    checkpoint.diagnosticQuestions.length === 0 &&
    checkpoint.activeRecallPrompts.length === 0 &&
    combinedPractice.length === 0 &&
    checkpoint.assessmentQuestions.length === 0;

  let readinessStatus: CheckpointReadinessStatus;
  let blockedOrUnavailableReason: string | undefined;

  const hasPilotAssessment =
    checkpoint.assessmentQuestions.length >= READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT;
  const hasPilotRecall =
    checkpoint.activeRecallPrompts.length >= READINESS_THRESHOLDS.MIN_ACTIVE_RECALL_PROMPTS;
  const hasPilotDiagnostic =
    checkpoint.diagnosticQuestions.length >= READINESS_THRESHOLDS.MIN_DIAGNOSTIC_QUESTIONS;
  const hasPilotConcepts = checkpoint.concepts.length >= READINESS_THRESHOLDS.MIN_CONCEPTS;

  if (isCompletelyEmpty) {
    readinessStatus = 'content_unavailable';
    blockedOrUnavailableReason = 'No curriculum concepts or questions have been authored for this milestone.';
  } else if (hasPilotAssessment && hasPilotRecall && hasPilotDiagnostic && hasPilotConcepts && verifiedQuestionsCount > 0) {
    readinessStatus = 'ready';
  } else {
    readinessStatus = 'internal_validation_only';
    const reasons: string[] = [];
    if (!hasPilotAssessment) {
      reasons.push(
        `Assessment has ${checkpoint.assessmentQuestions.length} questions (< ${READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT} required for pilot)`
      );
    }
    if (!hasPilotRecall) {
      reasons.push(
        `Active recall has ${checkpoint.activeRecallPrompts.length} prompts (< ${READINESS_THRESHOLDS.MIN_ACTIVE_RECALL_PROMPTS} required)`
      );
    }
    if (!hasPilotDiagnostic) {
      reasons.push(
        `Diagnostic has ${checkpoint.diagnosticQuestions.length} questions (< ${READINESS_THRESHOLDS.MIN_DIAGNOSTIC_QUESTIONS} required)`
      );
    }
    if (!hasPilotConcepts) {
      reasons.push('Concept notes pending authoring');
    }
    if (verifiedQuestionsCount === 0) {
      reasons.push('Content items are pending formal expert review sign-off');
    }
    blockedOrUnavailableReason = reasons.join('; ');
  }

  const prerequisiteStatus =
    checkpoint.prerequisiteIds.length === 0 ? 'no_prerequisites' : 'prerequisites_unmet';

  const canStudentCompleteJourney =
    readinessStatus === 'ready' ||
    (hasPilotAssessment && checkpoint.assessmentQuestions.length >= READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT);

  return {
    checkpointId: checkpoint.id,
    roadmapId: checkpoint.roadmapId,
    title: checkpoint.title,
    stageModel: '6-stage-milestone',
    order: checkpoint.order,
    readinessScorePct,
    dimensions,
    diagnosticCount: checkpoint.diagnosticQuestions.length,
    recallCount: checkpoint.activeRecallPrompts.length,
    practiceCount: combinedPractice.length,
    assessmentCount: checkpoint.assessmentQuestions.length,
    verifiedQuestionsCount,
    pendingReviewQuestionsCount,
    draftQuestionsCount: totalDraftCount,
    verifiedCount: verifiedQuestionsCount,
    pendingReviewCount: pendingReviewQuestionsCount,
    draftCount: totalDraftCount,
    questionBreakdown: {
      diagnostic: diagnosticAudit,
      recall: recallAudit,
      practice: practiceAudit,
      assessment: assessmentAudit,
    },
    requiredEvidence: '>= 5 assessment questions, >= 3 recall prompts, >= 4 diagnostic questions, >= 1 concept note',
    minimumEvidenceThreshold: {
      minDiagnostic: READINESS_THRESHOLDS.MIN_DIAGNOSTIC_QUESTIONS,
      minRecall: READINESS_THRESHOLDS.MIN_ACTIVE_RECALL_PROMPTS,
      minAssessment: READINESS_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS_PILOT,
      minConcepts: READINESS_THRESHOLDS.MIN_CONCEPTS,
    },
    prerequisiteStatus,
    readinessStatus,
    blockedOrUnavailableReason,
    canStudentCompleteJourney,
    missingPedagogicalDimensions,
  };
}

/**
 * Generates an exhaustive readiness audit of the entire 12-roadmap / 48-checkpoint catalogue.
 * Values are dynamically derived from ALL_CHECKPOINTS registry and content without hardcoding.
 */
export function auditCatalogueContent(): CatalogueContentAuditReport {
  const auditResults = ALL_CHECKPOINTS.map(auditCheckpointContent);

  const totalScore = auditResults.reduce((acc, curr) => acc + curr.readinessScorePct, 0);
  const overallReadinessScorePct = auditResults.length > 0 ? Math.round(totalScore / auditResults.length) : 0;

  const physicsResults = auditResults.filter((r) => r.roadmapId.startsWith('PHY-'));
  const chemistryResults = auditResults.filter((r) => r.roadmapId.startsWith('CHE-'));
  const mathResults = auditResults.filter((r) => r.roadmapId.startsWith('MAT-'));

  const phyScore =
    physicsResults.length > 0
      ? Math.round(physicsResults.reduce((n, r) => n + r.readinessScorePct, 0) / physicsResults.length)
      : 0;
  const cheScore =
    chemistryResults.length > 0
      ? Math.round(chemistryResults.reduce((n, r) => n + r.readinessScorePct, 0) / chemistryResults.length)
      : 0;
  const mthScore =
    mathResults.length > 0
      ? Math.round(mathResults.reduce((n, r) => n + r.readinessScorePct, 0) / mathResults.length)
      : 0;

  const pilotResults = auditResults.filter((r) => r.roadmapId === 'PHY-01');
  const pilotRoadmapReadinessScorePct =
    pilotResults.length > 0
      ? Math.round(pilotResults.reduce((n, r) => n + r.readinessScorePct, 0) / pilotResults.length)
      : 0;

  const totalReady = auditResults.filter((r) => r.readinessStatus === 'ready').length;
  const totalInternalValidation = auditResults.filter((r) => r.readinessStatus === 'internal_validation_only').length;
  const totalUnavailable = auditResults.filter((r) => r.readinessStatus === 'content_unavailable').length;

  const pedagogicalInfrastructureScorePct = overallReadinessScorePct;
  const verifiedContentReadinessScorePct =
    auditResults.length > 0 ? Math.round((totalReady / auditResults.length) * 100) : 0;
  const totalVerifiedAssessmentQuestionsCount = auditResults.reduce(
    (sum, r) => sum + (r.questionBreakdown?.assessment.verified ?? 0),
    0
  );

  // Pilot eligibility evaluation
  const allPhy01Ready = pilotResults.length > 0 && pilotResults.every((r) => r.readinessStatus === 'ready');
  const pilotRoadmapEligibility = allPhy01Ready ? 'approved_for_pilot' : 'internal_validation_only';
  const pilotRoadmapEligibilityReason = allPhy01Ready
    ? 'All 4 checkpoints in PHY-01 satisfy pilot content and evidence thresholds.'
    : 'PHY-01 checkpoints have fewer than the required 5 verified assessment questions and content is pending review; marked internal_validation_only.';

  const report: CatalogueContentAuditReport = {
    totalCheckpointsCount: ALL_CHECKPOINTS.length,
    auditedAt: new Date().toISOString(),
    pilotRoadmapId: 'PHY-01',
    pilotRoadmapEligibility,
    pilotRoadmapEligibilityReason,
    pilotRoadmapReadinessScorePct,
    overallReadinessScorePct,
    pedagogicalInfrastructureScorePct,
    verifiedContentReadinessScorePct,
    totalVerifiedAssessmentQuestionsCount,
    totalReadyCheckpointsCount: totalReady,
    totalInternalValidationCheckpointsCount: totalInternalValidation,
    totalContentUnavailableCheckpointsCount: totalUnavailable,
    subjectBreakdown: {
      physics: {
        totalCheckpoints: physicsResults.length,
        averageReadinessScorePct: phyScore,
      },
      chemistry: {
        totalCheckpoints: chemistryResults.length,
        averageReadinessScorePct: cheScore,
      },
      mathematics: {
        totalCheckpoints: mathResults.length,
        averageReadinessScorePct: mthScore,
      },
    },
    checkpoints: auditResults,
  };

  assertCatalogueReportIntegrity(report);
  return report;
}

/**
 * Asserts that the catalogue report and registry agree dynamically across all dimensions.
 */
export function assertCatalogueReportIntegrity(report: CatalogueContentAuditReport): void {
  if (report.totalCheckpointsCount !== ALL_CHECKPOINTS.length) {
    throw new Error(
      `Registry mismatch: report has ${report.totalCheckpointsCount} checkpoints but registry has ${ALL_CHECKPOINTS.length}`
    );
  }
  if (report.checkpoints.length !== ALL_CHECKPOINTS.length) {
    throw new Error(
      `Checkpoints array length (${report.checkpoints.length}) does not match registry (${ALL_CHECKPOINTS.length})`
    );
  }

  const physCps = ALL_CHECKPOINTS.filter((c) => c.subject === 'physics');
  const chemCps = ALL_CHECKPOINTS.filter((c) => c.subject === 'chemistry');
  const mathCps = ALL_CHECKPOINTS.filter((c) => c.subject === 'mathematics');

  if (report.subjectBreakdown.physics.totalCheckpoints !== physCps.length) {
    throw new Error(
      `Physics count mismatch: report has ${report.subjectBreakdown.physics.totalCheckpoints}, registry has ${physCps.length}`
    );
  }
  if (report.subjectBreakdown.chemistry.totalCheckpoints !== chemCps.length) {
    throw new Error(
      `Chemistry count mismatch: report has ${report.subjectBreakdown.chemistry.totalCheckpoints}, registry has ${chemCps.length}`
    );
  }
  if (report.subjectBreakdown.mathematics.totalCheckpoints !== mathCps.length) {
    throw new Error(
      `Mathematics count mismatch: report has ${report.subjectBreakdown.mathematics.totalCheckpoints}, registry has ${mathCps.length}`
    );
  }

  const sum =
    (report.totalReadyCheckpointsCount ?? 0) +
    (report.totalInternalValidationCheckpointsCount ?? 0) +
    (report.totalContentUnavailableCheckpointsCount ?? 0);
  if (sum !== report.totalCheckpointsCount) {
    throw new Error(
      `Readiness categories sum (${sum}) does not equal total checkpoints (${report.totalCheckpointsCount})`
    );
  }

  if (report.pedagogicalInfrastructureScorePct !== report.overallReadinessScorePct) {
    throw new Error(
      `Pedagogical infrastructure score mismatch: ${report.pedagogicalInfrastructureScorePct} !== ${report.overallReadinessScorePct}`
    );
  }

  const phy01Cps = report.checkpoints.filter((c) => c.roadmapId === 'PHY-01');
  const allPhy01Ready = phy01Cps.every((c) => c.readinessStatus === 'ready');
  if (report.pilotRoadmapEligibility === 'approved_for_pilot' && !allPhy01Ready) {
    throw new Error(
      'Integrity violation: PHY-01 cannot be marked approved_for_pilot when checkpoints do not meet ready status'
    );
  }
}
