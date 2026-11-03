import type { McqOption, QuestionResponse } from '../types/questionBank';
import type { PracticeQuizQuestion } from '../types/study';
import { buildGradedAttempt, type GradedQuizAttempt } from '../utils/attemptV2';
import { JEE_MAIN_MARKING, scoreAttempt } from '../utils/jeeScoring';
import { validateResponse, type ValidatedGeneratedMcq } from '../utils/questionValidation';
import { QUESTION_SET_TTL_MS, type StoredQuestion, type StoredQuestionSet } from './questionSetStore';

export const MCQ_OPTION_IDS: Array<McqOption['id']> = ['A', 'B', 'C', 'D'];

/** Builds the server-held set (with answer keys) from validated AI questions. */
export function createAiPracticeSet(params: {
  setId: string;
  uid: string;
  mode: 'diagnostic' | 'adaptive';
  documentId: string;
  documentTitle: string;
  focusTopics?: string[];
  questions: ValidatedGeneratedMcq[];
  now?: Date;
}): StoredQuestionSet {
  const now = params.now ?? new Date();
  return {
    id: params.setId,
    uid: params.uid,
    kind: 'ai_practice',
    mode: params.mode,
    documentId: String(params.documentId || 'unknown').slice(0, 160),
    documentTitle: String(params.documentTitle || 'Study Material').slice(0, 300),
    targetTopics: params.mode === 'adaptive' ? (params.focusTopics || []).slice(0, 40) : undefined,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + QUESTION_SET_TTL_MS).toISOString(),
    questions: params.questions.map((q, idx) => ({
      id: `${params.setId}-q${idx + 1}`,
      type: 'mcq',
      source: 'ai',
      topicLabel: q.topic,
      topicIds: [],
      stem: q.question,
      options: q.options.map((text, i) => ({ id: MCQ_OPTION_IDS[i], text })),
      correctOptionId: MCQ_OPTION_IDS[q.correctIndex],
      explanation: q.explanation,
      sourcePage: q.sourcePage,
      sourceQuote: q.sourceQuote,
      difficulty: q.difficulty,
    })),
  };
}

/** Client view of a stored question: no answer key, explanation or supporting quote. */
export function toPublicPracticeQuestion(q: StoredQuestion): PracticeQuizQuestion {
  return {
    id: q.id,
    source: q.source,
    topic: q.topicLabel,
    question: q.stem,
    options: q.options.map((o) => o.text) as [string, string, string, string],
    sourcePage: q.sourcePage,
    difficulty: q.difficulty,
  };
}

export type GradeResult =
  | { ok: true; attempt: GradedQuizAttempt }
  | { ok: false; status: 400; error: string };

/** Validates responses against the stored set and scores them with the stored answer keys. */
export function gradeSubmission(
  set: StoredQuestionSet,
  responses: Record<string, unknown>,
  now: Date = new Date()
): GradeResult {
  const questionsById = new Map(set.questions.map((q) => [q.id, q]));
  for (const [questionId, response] of Object.entries(responses)) {
    const question = questionsById.get(questionId);
    if (!question) return { ok: false, status: 400, error: 'Your answers do not match this practice set.' };
    const problem = validateResponse({ id: question.id, type: 'mcq', options: question.options }, response);
    if (problem) return { ok: false, status: 400, error: problem };
  }

  const typed = responses as Record<string, QuestionResponse>;
  const score = scoreAttempt(
    set.questions.map((q) => ({
      id: q.id,
      type: 'mcq' as const,
      correctOptionIds: [q.correctOptionId],
      topicIds: q.topicIds,
      topicLabel: q.topicLabel,
      chapterId: q.chapterId,
    })),
    typed,
    JEE_MAIN_MARKING
  );

  const selectedIndices: Record<string, number> = {};
  for (const q of set.questions) {
    const r = typed[q.id];
    selectedIndices[q.id] = r && r.type === 'mcq' && r.optionId ? MCQ_OPTION_IDS.indexOf(r.optionId) : -1;
  }

  const attempt = buildGradedAttempt({
    attemptId: `att-${set.id}`,
    questionSetId: set.id,
    kind: set.kind,
    mode: set.mode,
    documentId: set.documentId,
    documentTitle: set.documentTitle,
    sessionId: set.sessionId,
    targetTopics: set.targetTopics,
    sources: [...new Set(set.questions.map((q) => q.source))],
    reviewQuestions: set.questions.map((q) => ({
      id: q.id,
      topic: q.topicLabel,
      question: q.stem,
      options: q.options.map((o) => o.text) as [string, string, string, string],
      correctIndex: MCQ_OPTION_IDS.indexOf(q.correctOptionId),
      explanation: q.explanation,
      sourcePage: q.sourcePage,
      sourceQuote: q.sourceQuote,
      difficulty: q.difficulty,
    })),
    selectedIndices,
    score,
    completedAt: now.toISOString(),
  });
  return { ok: true, attempt };
}

export interface MistakeInputs {
  wrongDetails: Array<{
    questionId: string;
    topic: string;
    question: string;
    selectedOption: string;
    correctOption: string;
    explanation: string;
    sourcePage: number;
    sourceQuote: string;
  }>;
  unanswered: Array<{ topic: string; count: number }>;
  allCorrect: boolean;
}

/** Wrong and unanswered questions, taken only from the server-recorded submission. */
export function collectMistakeInputs(set: StoredQuestionSet): MistakeInputs | null {
  const attempt = set.submission?.attempt;
  if (!attempt) return null;
  const questionsById = new Map(set.questions.map((q) => [q.id, q]));
  const answersById = new Map(attempt.answers.map((a) => [a.questionId, a]));

  const wrongDetails = attempt.outcomes
    .filter((o) => o.outcome === 'incorrect')
    .flatMap((o) => {
      const q = questionsById.get(o.questionId);
      if (!q) return [];
      const selectedIndex = answersById.get(o.questionId)?.selectedIndex ?? -1;
      return [
        {
          questionId: q.id,
          topic: q.topicLabel,
          question: q.stem,
          selectedOption: q.options[selectedIndex]?.text ?? '',
          correctOption: q.options.find((opt) => opt.id === q.correctOptionId)?.text ?? '',
          explanation: q.explanation,
          sourcePage: q.sourcePage,
          sourceQuote: q.sourceQuote,
        },
      ];
    });

  const unansweredCounts = new Map<string, number>();
  for (const o of attempt.outcomes) {
    if (o.outcome !== 'unanswered') continue;
    const topic = questionsById.get(o.questionId)?.topicLabel;
    if (topic) unansweredCounts.set(topic, (unansweredCounts.get(topic) ?? 0) + 1);
  }

  return {
    wrongDetails,
    unanswered: [...unansweredCounts].map(([topic, count]) => ({ topic, count })),
    allCorrect: attempt.outcomes.every((o) => o.outcome === 'correct' || o.outcome === 'dropped'),
  };
}
