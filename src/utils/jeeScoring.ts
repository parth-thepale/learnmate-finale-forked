import type {
  AttemptScore,
  KeyStatus,
  MarkingScheme,
  McqOption,
  QuestionResponse,
  ResponseOutcome,
  ScoreBreakdown,
  ScoredQuestion,
} from '../types/questionBank';
import type { JeeSubjectId } from '../data/jeeMainSyllabus';

/**
 * JEE (Main) 2026 Paper 1 marking (NTA Information Bulletin 2026 and Subject Specific Instructions):
 * +4 correct, −1 incorrect, 0 unanswered — for both Section A (MCQ) and Section B (numerical).
 * Questions dropped in the official final key award full marks to every candidate.
 */
export const JEE_MAIN_MARKING: MarkingScheme = Object.freeze({
  id: 'jee_main_2026',
  correct: 4,
  incorrect: -1,
  unanswered: 0,
});

/** Unpenalised marking for low-stakes AI practice (one mark per correct answer). */
export const PRACTICE_MARKING: MarkingScheme = Object.freeze({
  id: 'practice_plain',
  correct: 1,
  incorrect: 0,
  unanswered: 0,
});

interface ScorableBase {
  id: string;
  keyStatus?: KeyStatus;
  topicIds: string[];
  topicLabel: string;
  subjectId?: JeeSubjectId;
  chapterId?: string;
}

export type ScorableQuestion =
  | (ScorableBase & { type: 'mcq'; correctOptionIds: Array<McqOption['id']> })
  | (ScorableBase & { type: 'numerical'; acceptedIntegers: number[] });

const INTEGER_PATTERN = /^[+-]?\d{1,9}$/;

/**
 * Parses a numerical (Section B) answer. Only whole numbers are accepted, matching the NTA
 * on-screen keypad instruction to enter the answer rounded to the nearest integer.
 * Returns null for anything that is not a plain integer.
 */
export function parseIntegerAnswer(raw: string): number | null {
  const trimmed = raw.trim();
  if (!INTEGER_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? (Object.is(value, -0) ? 0 : value) : null;
}

export class ResponseTypeMismatchError extends Error {
  constructor(questionId: string) {
    super(`Response type does not match question ${questionId}.`);
    this.name = 'ResponseTypeMismatchError';
  }
}

export function evaluateResponse(question: ScorableQuestion, response: QuestionResponse | undefined): ResponseOutcome {
  if (question.keyStatus === 'dropped') return 'dropped';
  if (!response) return 'unanswered';
  if (response.type !== question.type) throw new ResponseTypeMismatchError(question.id);

  if (question.type === 'mcq' && response.type === 'mcq') {
    if (response.optionId === null) return 'unanswered';
    return question.correctOptionIds.includes(response.optionId) ? 'correct' : 'incorrect';
  }
  if (question.type === 'numerical' && response.type === 'numerical') {
    if (response.value === null || response.value.trim() === '') return 'unanswered';
    const parsed = parseIntegerAnswer(response.value);
    if (parsed === null) return 'incorrect';
    return question.acceptedIntegers.includes(parsed) ? 'correct' : 'incorrect';
  }
  throw new ResponseTypeMismatchError(question.id);
}

export function marksFor(outcome: ResponseOutcome, scheme: MarkingScheme): number {
  switch (outcome) {
    case 'correct':
    case 'dropped':
      return scheme.correct;
    case 'incorrect':
      return scheme.incorrect;
    default:
      return scheme.unanswered;
  }
}

function emptyBreakdown(): ScoreBreakdown {
  return { rawMarks: 0, maxMarks: 0, correct: 0, incorrect: 0, unanswered: 0, dropped: 0, attempted: 0, accuracy: 0 };
}

function addTo(breakdown: ScoreBreakdown, outcome: ResponseOutcome, marks: number, scheme: MarkingScheme): void {
  breakdown.rawMarks += marks;
  breakdown.maxMarks += scheme.correct;
  if (outcome === 'correct') breakdown.correct++;
  else if (outcome === 'incorrect') breakdown.incorrect++;
  else if (outcome === 'dropped') breakdown.dropped++;
  else breakdown.unanswered++;
  breakdown.attempted = breakdown.correct + breakdown.incorrect;
  breakdown.accuracy = breakdown.attempted > 0 ? breakdown.correct / breakdown.attempted : 0;
}

/** Scores a full attempt. Questions with no entry in `responses` count as unanswered. */
export function scoreAttempt(
  questions: ScorableQuestion[],
  responses: Record<string, QuestionResponse | undefined>,
  scheme: MarkingScheme = JEE_MAIN_MARKING
): AttemptScore {
  const total = emptyBreakdown();
  const bySubject: Record<string, ScoreBreakdown> = {};
  const byChapter: Record<string, ScoreBreakdown> = {};
  const byTopic: Record<string, ScoreBreakdown> = {};
  const scored: ScoredQuestion[] = [];
  const seen = new Set<string>();

  for (const question of questions) {
    if (seen.has(question.id)) throw new Error(`Duplicate question id ${question.id} in attempt.`);
    seen.add(question.id);
    const response = responses[question.id];
    const outcome = evaluateResponse(question, response);
    const marks = marksFor(outcome, scheme);
    addTo(total, outcome, marks, scheme);
    if (question.subjectId) addTo((bySubject[question.subjectId] ??= emptyBreakdown()), outcome, marks, scheme);
    if (question.chapterId) addTo((byChapter[question.chapterId] ??= emptyBreakdown()), outcome, marks, scheme);
    const topicKeys = question.topicIds.length > 0 ? question.topicIds : [question.topicLabel];
    for (const key of topicKeys) addTo((byTopic[key] ??= emptyBreakdown()), outcome, marks, scheme);
    scored.push({
      questionId: question.id,
      outcome,
      marks,
      topicIds: question.topicIds,
      topicLabel: question.topicLabel,
      subjectId: question.subjectId,
      chapterId: question.chapterId,
      response:
        response ?? (question.type === 'mcq' ? { type: 'mcq', optionId: null } : { type: 'numerical', value: null }),
    });
  }

  return { ...total, scheme, questions: scored, bySubject, byChapter, byTopic };
}
