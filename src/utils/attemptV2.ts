import type { QuizAttempt, QuizAttemptAnswer, QuizQuestion } from '../types/study';
import type { AttemptContext, AttemptKind, AttemptReviewMode, AttemptScore, AttemptV2Fields, MarkingScheme, QuestionSource } from '../types/questionBank';

export type GradedQuizAttempt = QuizAttempt & AttemptV2Fields;

/**
 * Builds a server-scored attempt. Legacy QuizAttempt fields are kept so existing progress views
 * and stored data keep working: `score` is the number correct and `percentage` the share of
 * questions answered correctly. JEE marks are in `rawMarks` / `maxMarks`.
 *
 * `weakTopics` keeps its legacy meaning (topics missed in *this* attempt). Whether a topic is
 * actually weak is decided across attempts by utils/weakTopics.ts.
 *
 * reviewMode 'by_reference' (bank/PYQ content) keeps question ids and outcomes only: no question
 * text, options, explanations or answer keys are copied into the attempt.
 */
export function buildGradedAttempt(params: {
  attemptId: string;
  questionSetId: string;
  kind: AttemptKind;
  mode: QuizAttempt['mode'];
  documentId: string;
  documentTitle: string;
  sessionId?: string;
  targetTopics?: string[];
  sources: QuestionSource[];
  context: AttemptContext;
  marking: MarkingScheme;
  reviewMode: AttemptReviewMode;
  /** Questions with answers revealed after submission (shown in the review). */
  reviewQuestions: QuizQuestion[];
  selectedIndices: Record<string, number>;
  score: AttemptScore;
  completedAt: string;
}): GradedQuizAttempt {
  const outcomeById = new Map(params.score.questions.map((q) => [q.questionId, q]));
  const answers: QuizAttemptAnswer[] = params.reviewQuestions.map((q) => {
    const scored = outcomeById.get(q.id);
    const selectedIndex = params.selectedIndices[q.id] ?? -1;
    return {
      questionId: q.id,
      selectedIndex,
      isCorrect: scored?.outcome === 'correct' || scored?.outcome === 'dropped',
      topic: q.topic,
      sourcePage: q.sourcePage,
    };
  });

  const missed = new Set<string>();
  const solid = new Set<string>();
  const topicTotals = new Map<string, { total: number; correct: number }>();
  for (const a of answers) {
    const t = topicTotals.get(a.topic) ?? { total: 0, correct: 0 };
    t.total++;
    if (a.isCorrect) t.correct++;
    topicTotals.set(a.topic, t);
  }
  for (const [topic, t] of topicTotals) (t.correct < t.total ? missed : solid).add(topic);

  const total = params.reviewQuestions.length;
  const correctCount = params.score.correct + params.score.dropped;
  return {
    id: params.attemptId,
    documentId: params.documentId,
    documentTitle: params.documentTitle,
    mode: params.mode,
    targetTopics: params.targetTopics,
    questions: params.reviewMode === 'by_reference' ? [] : params.reviewQuestions,
    answers,
    score: correctCount,
    totalQuestions: total,
    percentage: total > 0 ? Math.round((correctCount / total) * 100) : 0,
    weakTopics: [...missed],
    strongTopics: [...solid],
    completedAt: params.completedAt,
    negativeMarkingUsed: params.score.scheme.incorrect < 0,
    rawMarks: params.score.rawMarks,
    maxMarks: params.score.maxMarks,

    schemaVersion: 2,
    kind: params.kind,
    questionSetId: params.questionSetId,
    sessionId: params.sessionId,
    sources: params.sources,
    scoredBy: 'server',
    markingSchemeId: params.score.scheme.id,
    marking: { id: params.marking.id, correct: params.marking.correct, incorrect: params.marking.incorrect, unanswered: params.marking.unanswered },
    context: params.context,
    reviewMode: params.reviewMode,
    correctCount: params.score.correct,
    incorrectCount: params.score.incorrect,
    unansweredCount: params.score.unanswered,
    outcomes: params.score.questions.map((q) => ({
      questionId: q.questionId,
      outcome: q.outcome,
      topicIds: q.topicIds,
      topicLabel: q.topicLabel,
      ...(params.context.type === 'syllabus' ? { subjectId: params.context.subjectId } : {}),
      chapterId: q.chapterId,
    })),
  };
}
