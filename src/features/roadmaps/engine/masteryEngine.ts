import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  StageScore,
} from '../types/progress.types';
import type { Checkpoint, MasteryStatus } from '../types/checkpoint.types';

export interface MasteryThresholds {
  readonly STRONG_MIN_PCT: number; // default: 80%
  readonly DEVELOPING_MIN_PCT: number; // default: 60%
  readonly MIN_ASSESSMENT_QUESTIONS: number; // default: 5
}

export const DEFAULT_MASTERY_THRESHOLDS: MasteryThresholds = Object.freeze({
  STRONG_MIN_PCT: 80,
  DEVELOPING_MIN_PCT: 60,
  MIN_ASSESSMENT_QUESTIONS: 5,
});

export interface MasteryEvaluationResult {
  readonly masteryStatus: MasteryStatus;
  readonly masteryScore: number; // 0..100
  readonly hasSufficientEvidence: boolean;
  readonly recommendedAction: string;
}

/**
 * Determines whether a checkpoint's assessment satisfies the pilot readiness threshold
 * (minimum 5 eligible, verified assessment questions).
 */
export function isAssessmentPilotReady(
  checkpointOrCount: Checkpoint | number,
  minQuestions = DEFAULT_MASTERY_THRESHOLDS.MIN_ASSESSMENT_QUESTIONS
): boolean {
  if (typeof checkpointOrCount === 'number') {
    return checkpointOrCount >= minQuestions;
  }
  if (!checkpointOrCount || !checkpointOrCount.assessmentQuestions) return false;
  return checkpointOrCount.assessmentQuestions.length >= minQuestions;
}

/**
 * Checks whether a checkpoint can be completed, preventing zero-question checkpoints
 * from unlocking downstream content without authentic assessment evidence.
 */
export function canCheckpointBeCompleted(
  checkpoint: Checkpoint,
  progress?: CheckpointProgress
): boolean {
  if (!checkpoint || !checkpoint.assessmentQuestions || checkpoint.assessmentQuestions.length === 0) {
    return false;
  }
  if (!progress) {
    return true;
  }
  return (
    (progress.masteryStatus === 'strong' || progress.masteryStatus === 'developing') &&
    (progress.masteryScore ?? 0) >= 60
  );
}

/**
 * Evaluates mastery based on demonstrated student performance.
 * Adapts to available checkpoint assessment questions while preventing zero-question passes
 * and enforcing sufficient evidence thresholds.
 */
export function evaluateMastery(
  assessmentResult?: AssessmentAttemptResult,
  practiceStats?: CheckpointProgress['practiceStats'],
  activeRecallScore?: StageScore,
  availableAssessmentQuestions?: number,
  thresholds: MasteryThresholds = DEFAULT_MASTERY_THRESHOLDS
): MasteryEvaluationResult {
  // If no assessment questions exist on this checkpoint, mastery cannot be awarded
  if (availableAssessmentQuestions !== undefined && availableAssessmentQuestions <= 0) {
    return {
      masteryStatus: 'insufficient_evidence',
      masteryScore: 0,
      hasSufficientEvidence: false,
      recommendedAction: 'No assessment questions are available for this checkpoint yet. Content is pending.',
    };
  }

  if (!assessmentResult) {
    return {
      masteryStatus: 'unattempted',
      masteryScore: 0,
      hasSufficientEvidence: false,
      recommendedAction: 'Start diagnostic or revision to begin this checkpoint.',
    };
  }

  // Guard against invalid or duplicate assessment payloads
  if (
    assessmentResult.correctCount < 0 ||
    assessmentResult.incorrectCount < 0 ||
    assessmentResult.unansweredCount < 0 ||
    assessmentResult.totalMarks < 0 ||
    isNaN(assessmentResult.percentage)
  ) {
    return {
      masteryStatus: 'insufficient_evidence',
      masteryScore: 0,
      hasSufficientEvidence: false,
      recommendedAction: 'Invalid assessment submission detected. Please retake the assessment.',
    };
  }

  const effectiveRequired =
    availableAssessmentQuestions !== undefined && availableAssessmentQuestions > 0
      ? availableAssessmentQuestions
      : thresholds.MIN_ASSESSMENT_QUESTIONS;

  const totalInAttempt =
    assessmentResult.correctCount +
    assessmentResult.incorrectCount +
    assessmentResult.unansweredCount;

  const attemptedQuestions = assessmentResult.correctCount + assessmentResult.incorrectCount;

  // Insufficient evidence if fewer questions were presented than required,
  // or zero questions attempted
  if (totalInAttempt < effectiveRequired || attemptedQuestions === 0) {
    return {
      masteryStatus: 'insufficient_evidence',
      masteryScore: Math.max(0, Math.min(100, Math.round(assessmentResult.percentage * 0.5))),
      hasSufficientEvidence: false,
      recommendedAction: `Attempt all assessment questions to demonstrate sufficient topic mastery (attempted ${attemptedQuestions} of ${effectiveRequired} required).`,
    };
  }

  const pct = assessmentResult.percentage;
  const clampedScore = Math.max(0, Math.min(100, Math.round(pct)));

  if (pct >= thresholds.STRONG_MIN_PCT) {
    return {
      masteryStatus: 'strong',
      masteryScore: clampedScore,
      hasSufficientEvidence: true,
      recommendedAction: 'Checkpoint mastered. Advance to the next checkpoint and schedule spaced revision.',
    };
  }

  if (pct >= thresholds.DEVELOPING_MIN_PCT) {
    return {
      masteryStatus: 'developing',
      masteryScore: clampedScore,
      hasSufficientEvidence: true,
      recommendedAction: 'Advance to the next checkpoint while scheduling targeted revision for weaker subtopics.',
    };
  }

  return {
    masteryStatus: 'needs_reinforcement',
    masteryScore: clampedScore,
    hasSufficientEvidence: true,
    recommendedAction: 'Review the concept revision and attempt targeted practice questions before retrying the assessment.',
  };
}
