import type { StageScore } from '../types/progress.types';

export interface DiagnosticEvaluationInput {
  totalQuestions: number;
  correctCount: number;
  questionTopicMap: Array<{ topicId: string; topicName: string; isCorrect: boolean }>;
  timeTakenSeconds: number;
}

export interface DiagnosticEvaluationResult {
  score: StageScore;
  canSkipIntroRevision: boolean;
  weakTopics: string[];
  strongTopics: string[];
  message: string;
}

export const DIAGNOSTIC_CONFIG = Object.freeze({
  SKIP_THRESHOLD_PCT: 80,
  MIN_EVIDENCE_QUESTIONS: 4,
});

/**
 * Evaluates Stage A Diagnostic results.
 * If student scores >= 80% with sufficient evidence, allows skipping introductory revision.
 * Skipping introductory revision does NOT grant checkpoint completion or full mastery.
 */
export function evaluateDiagnostic(input: DiagnosticEvaluationInput): DiagnosticEvaluationResult {
  const percentage = input.totalQuestions > 0 ? Math.round((input.correctCount / input.totalQuestions) * 100) : 0;
  const now = new Date().toISOString();

  const score: StageScore = {
    correct: input.correctCount,
    total: input.totalQuestions,
    percentage,
    completedAt: now,
  };

  const weakTopicSet = new Set<string>();
  const strongTopicSet = new Set<string>();

  for (const item of input.questionTopicMap) {
    if (item.isCorrect) {
      strongTopicSet.add(item.topicName || item.topicId);
    } else {
      weakTopicSet.add(item.topicName || item.topicId);
    }
  }

  // Remove topics from strong if they are in weak (in case of multiple questions on same topic)
  for (const weak of weakTopicSet) {
    strongTopicSet.delete(weak);
  }

  const weakTopics = Array.from(weakTopicSet);
  const strongTopics = Array.from(strongTopicSet);

  const hasSufficientEvidence = input.totalQuestions >= DIAGNOSTIC_CONFIG.MIN_EVIDENCE_QUESTIONS;
  const canSkipIntroRevision = hasSufficientEvidence && percentage >= DIAGNOSTIC_CONFIG.SKIP_THRESHOLD_PCT;

  let message = '';
  if (canSkipIntroRevision) {
    message = `Strong diagnostic result (${percentage}%). You demonstrated solid baseline knowledge and can proceed directly to Active Recall or Question Practice.`;
  } else if (percentage >= 60) {
    message = `Moderate diagnostic result (${percentage}%). We recommend quick concept revision for weaker areas: ${weakTopics.slice(0, 2).join(', ')}.`;
  } else {
    message = `Foundational diagnostic result (${percentage}%). Detailed revision of core concepts is strongly recommended before attempting questions.`;
  }

  return {
    score,
    canSkipIntroRevision,
    weakTopics,
    strongTopics,
    message,
  };
}
