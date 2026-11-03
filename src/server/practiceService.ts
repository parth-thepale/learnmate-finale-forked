import { findSyllabusChapter, findSyllabusSubject, findSyllabusTopic, getSyllabusRevision } from '../data/syllabusRegistry';
import type { AttemptContext, AttemptReviewMode, McqOption, QuestionResponse, QuestionSource } from '../types/questionBank';
import type { PracticeQuizQuestion } from '../types/study';
import { ATTEMPT_LIMITS, validateAttemptContext, validateTrustedAttempt } from '../utils/attemptContext';
import { buildGradedAttempt, type GradedQuizAttempt } from '../utils/attemptV2';
import { JEE_MAIN_MARKING, scoreAttempt } from '../utils/jeeScoring';
import { getMarkingScheme, markingSchemeForExam } from '../utils/markingSchemes';
import { validateResponse, type ValidatedGeneratedMcq } from '../utils/questionValidation';
import { QUESTION_SET_TTL_MS, type StoredQuestion, type StoredQuestionSet } from './questionSetStore';

export const MCQ_OPTION_IDS: Array<McqOption['id']> = ['A', 'B', 'C', 'D'];

/**
 * Marking for AI practice built from a student's document. This has always been JEE-style
 * (+4/−1/0); it is now looked up from the marking registry instead of being fixed in grading.
 */
export const DOCUMENT_PRACTICE_MARKING_ID = JEE_MAIN_MARKING.id;
/** Sets stored before context/marking were recorded were all graded with this scheme. */
const LEGACY_SET_MARKING_ID = JEE_MAIN_MARKING.id;

export class PracticeSetContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PracticeSetContextError';
  }
}

/** Display label for a syllabus context, from its exact registered revision. */
export function syllabusContextLabel(context: Extract<AttemptContext, { type: 'syllabus' }>): string {
  const syllabus = getSyllabusRevision(context.syllabusId, context.syllabusRevision);
  const subject = syllabus ? findSyllabusSubject(syllabus, context.subjectId) : undefined;
  const chapter = syllabus ? findSyllabusChapter(syllabus, context.chapterId) : undefined;
  return `${subject?.name ?? context.subjectId} · ${chapter?.name ?? context.chapterId}`.slice(0, ATTEMPT_LIMITS.titleLength);
}

/**
 * Builds the server-held set (with answer keys) from validated AI questions. The context is
 * explicit and validated: document practice needs a real documentId (no placeholder), syllabus
 * practice needs registered ids and a registered topic for every question.
 */
export function createAiPracticeSet(params: {
  setId: string;
  uid: string;
  mode: 'diagnostic' | 'adaptive';
  /** Syllabus (or explicit document) context; when omitted, documentId/documentTitle are used. */
  context?: AttemptContext;
  documentId?: string;
  documentTitle?: string;
  markingSchemeId?: string;
  sessionId?: string;
  focusTopics?: string[];
  questions: Array<ValidatedGeneratedMcq & { topicIds?: string[] }>;
  now?: Date;
}): StoredQuestionSet {
  const now = params.now ?? new Date();
  const context: AttemptContext = params.context ?? {
    type: 'document',
    documentId: typeof params.documentId === 'string' ? params.documentId : '',
    documentTitle: String(params.documentTitle || 'Study Material').slice(0, ATTEMPT_LIMITS.titleLength),
  };
  const contextErrors = validateAttemptContext(context);
  if (context.type === 'document' && context.documentId === 'unknown') contextErrors.push('"unknown" is not a document id.');
  if (contextErrors.length > 0) throw new PracticeSetContextError(contextErrors.join(' '));

  const markingSchemeId =
    params.markingSchemeId ?? (context.type === 'syllabus' ? markingSchemeForExam(context.examType)?.id : DOCUMENT_PRACTICE_MARKING_ID);
  if (!getMarkingScheme(markingSchemeId)) throw new PracticeSetContextError('No registered marking scheme for this practice.');

  if (context.type === 'syllabus') {
    const syllabus = getSyllabusRevision(context.syllabusId, context.syllabusRevision)!;
    const allowed = context.topicIds.length > 0 ? new Set(context.topicIds) : null;
    params.questions.forEach((q, i) => {
      const ids = q.topicIds ?? [];
      if (ids.length === 0) throw new PracticeSetContextError(`Question ${i + 1} has no syllabus topic.`);
      for (const id of ids) {
        const found = findSyllabusTopic(syllabus, id);
        if (!found || found.chapter.id !== context.chapterId || (allowed && !allowed.has(id))) {
          throw new PracticeSetContextError(`Question ${i + 1} topic "${id}" is not part of this practice.`);
        }
      }
    });
  }
  if (params.sessionId !== undefined && (!params.sessionId || params.sessionId.length > 160 || params.sessionId.includes('/'))) {
    throw new PracticeSetContextError('Invalid session id.');
  }

  return {
    id: params.setId,
    uid: params.uid,
    kind: 'ai_practice',
    mode: params.mode,
    documentId: context.type === 'document' ? context.documentId : '',
    documentTitle: context.type === 'document' ? context.documentTitle : syllabusContextLabel(context),
    context,
    markingSchemeId: markingSchemeId!,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    targetTopics: params.mode === 'adaptive' ? (params.focusTopics || []).slice(0, 40) : undefined,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + QUESTION_SET_TTL_MS).toISOString(),
    questions: params.questions.map((q, idx) => ({
      id: `${params.setId}-q${idx + 1}`,
      type: 'mcq',
      source: 'ai',
      topicLabel: q.topic,
      topicIds: context.type === 'syllabus' ? [...(q.topicIds ?? [])] : [],
      ...(context.type === 'syllabus' ? { chapterId: context.chapterId } : {}),
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
  | { ok: false; status: 400 | 409 | 500; error: string };

const BANK_SOURCES: readonly QuestionSource[] = ['pyq', 'curated'];

/** The set's context; sets stored before contexts existed are document-linked only with a real documentId. */
export function contextOfSet(set: StoredQuestionSet): AttemptContext | null {
  if (set.context) return validateAttemptContext(set.context).length === 0 ? set.context : null;
  if (!set.documentId || set.documentId === 'unknown' || set.documentId.length > 160 || set.documentId.includes('/')) return null;
  return { type: 'document', documentId: set.documentId, documentTitle: set.documentTitle || 'Study Material' };
}

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

  const context = contextOfSet(set);
  if (!context) return { ok: false, status: 409, error: 'This practice set was created by an older version. Please start a new one.' };
  const marking = getMarkingScheme(set.markingSchemeId ?? LEGACY_SET_MARKING_ID);
  if (!marking) return { ok: false, status: 409, error: 'This practice set uses an unknown marking scheme. Please start a new one.' };
  const sources = [...new Set(set.questions.map((q) => q.source))];
  const reviewMode: AttemptReviewMode = sources.some((s) => BANK_SOURCES.includes(s)) ? 'by_reference' : 'embedded';

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
    marking
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
    sources,
    context,
    marking,
    reviewMode,
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
  const problems = validateTrustedAttempt(attempt);
  if (problems.length > 0) {
    console.warn(`[practice] graded attempt for ${set.id} failed validation: ${problems.slice(0, 3).join(' | ')}`);
    return { ok: false, status: 500, error: 'Your answers could not be graded. Please try again.' };
  }
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
