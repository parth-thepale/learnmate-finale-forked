import { findSyllabusChapter, findSyllabusSubject, findSyllabusTopic, getSyllabus, isRegisteredTopicId } from '../data/syllabusRegistry';
import type { AttemptContext, AttemptKind, QuestionSource, ResponseOutcome } from '../types/questionBank';
import type { ExamTypeId } from '../types/study';
import { marksFor } from './jeeScoring';
import { isRegisteredMarkingScheme } from './markingSchemes';
import { isIsoUtcTimestamp } from './sessionModel';

/**
 * Attempt context and trusted-attempt validation (pure; shared by server and client).
 *
 * Trust model: an attempt is *verified* only when it carries the trusted marker (schemaVersion 2,
 * scoredBy "server"), passes validateTrustedAttempt, AND the caller knows the record was written
 * by the server (e.g. the marker was present on the Firestore parent document, which clients can
 * never write). A marker found anywhere else (local storage, inside attemptJson) proves nothing.
 */

export const ATTEMPT_LIMITS = Object.freeze({
  refLength: 160,
  titleLength: 300,
  contextTopicIds: 50,
  questions: 300,
});

export const QUESTION_SET_ID_PATTERN = /^qs_[a-f0-9]{32}$/;
/** Ids reserved for server-written trusted attempts (clients may never create these). */
export const TRUSTED_ATTEMPT_ID_PREFIX = 'att-qs_';

export function trustedAttemptIdFor(questionSetId: string): string {
  return `att-${questionSetId}`;
}

const EXAM_TYPES: readonly ExamTypeId[] = ['jee_main', 'jee_advanced', 'neet_ug', 'cuet', 'board_exams', 'university_exams', 'general_practice'];
const ATTEMPT_KINDS: readonly AttemptKind[] = ['ai_practice', 'topic_practice', 'sectional_test', 'full_mock'];
const SOURCES: readonly QuestionSource[] = ['pyq', 'curated', 'ai'];
const OUTCOMES: readonly ResponseOutcome[] = ['correct', 'incorrect', 'unanswered', 'dropped'];
const MODES = ['diagnostic', 'adaptive', 'jee_simulator'];
/** Sources whose content lives in the question bank (possibly licensed): never embedded in attempts. */
const BANK_SOURCES: readonly QuestionSource[] = ['pyq', 'curated'];

function isSafeRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= ATTEMPT_LIMITS.refLength &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..'
  );
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function hasOnlyKeys(value: object, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((k) => !allowed.includes(k));
}

/** Validates an explicit attempt context against the syllabus registry. Returns problems. */
export function validateAttemptContext(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['context must be an object.'];
  const ctx = raw as Record<string, unknown>;
  if (ctx.type === 'document') {
    const errors: string[] = [];
    const extra = hasOnlyKeys(ctx, ['type', 'documentId', 'documentTitle']);
    if (extra.length) errors.push(`document context has unexpected fields: ${extra.join(', ')}.`);
    if (!isSafeRef(ctx.documentId)) errors.push('document context needs a valid, non-empty documentId.');
    if (!isNonEmptyString(ctx.documentTitle, ATTEMPT_LIMITS.titleLength)) errors.push('document context needs a documentTitle.');
    return errors;
  }
  if (ctx.type === 'syllabus') {
    const errors: string[] = [];
    const extra = hasOnlyKeys(ctx, ['type', 'examType', 'syllabusId', 'syllabusRevision', 'subjectId', 'chapterId', 'topicIds']);
    if (extra.length) errors.push(`syllabus context has unexpected fields: ${extra.join(', ')}.`);
    if (!EXAM_TYPES.includes(ctx.examType as ExamTypeId)) errors.push('syllabus context needs a known examType.');
    const syllabus = getSyllabus(ctx.syllabusId);
    if (!syllabus) {
      errors.push('syllabus context references an unknown syllabusId.');
      return errors;
    }
    if (syllabus.examType !== ctx.examType) errors.push(`syllabus ${syllabus.id} belongs to exam ${syllabus.examType}, not ${String(ctx.examType)}.`);
    if (!Number.isInteger(ctx.syllabusRevision) || !syllabus.supportedRevisions.includes(ctx.syllabusRevision as number)) {
      errors.push(`syllabus context needs a supported syllabusRevision for ${syllabus.id}.`);
    }
    const subject = findSyllabusSubject(syllabus, ctx.subjectId);
    if (!subject) errors.push('syllabus context references an unknown subjectId.');
    const chapter = findSyllabusChapter(syllabus, ctx.chapterId);
    if (!chapter) errors.push('syllabus context references an unknown chapterId.');
    else if (subject && chapter.subjectId !== subject.id) errors.push('chapterId does not belong to subjectId.');
    if (!Array.isArray(ctx.topicIds)) {
      errors.push('syllabus context needs a topicIds list (empty for whole-chapter practice).');
    } else {
      if (ctx.topicIds.length > ATTEMPT_LIMITS.contextTopicIds) errors.push('syllabus context lists too many topics.');
      if (new Set(ctx.topicIds).size !== ctx.topicIds.length) errors.push('syllabus context lists a topic twice.');
      for (const topicId of ctx.topicIds) {
        const found = findSyllabusTopic(syllabus, topicId);
        if (!found) errors.push(`unknown topicId "${String(topicId)}".`);
        else if (chapter && found.chapter.id !== chapter.id) errors.push(`topicId "${String(topicId)}" is not in chapter ${chapter.id}.`);
      }
    }
    return errors;
  }
  return ['context.type must be "document" or "syllabus".'];
}

export type ContextResolution =
  | { ok: true; context: AttemptContext; source: 'explicit' | 'legacy_document' }
  | { ok: false; reason: string };

/**
 * Determines what an attempt practised.
 *  - Explicit context: validated, and the top-level documentId must agree with it ("" for syllabus).
 *  - No context (records written before contexts existed): document-linked if, and only if, the
 *    record has a valid non-empty documentId. Anything else is reported, never reinterpreted.
 */
export function resolveAttemptContext(raw: unknown): ContextResolution {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'attempt is not an object.' };
  const attempt = raw as Record<string, unknown>;
  if (attempt.context !== undefined) {
    const errors = validateAttemptContext(attempt.context);
    if (errors.length) return { ok: false, reason: errors.join(' ') };
    const context = attempt.context as AttemptContext;
    if (context.type === 'document' && attempt.documentId !== context.documentId) {
      return { ok: false, reason: 'documentId does not match the document context.' };
    }
    if (context.type === 'syllabus' && attempt.documentId !== '') {
      return { ok: false, reason: 'syllabus-context attempts must have documentId "".' };
    }
    return { ok: true, context, source: 'explicit' };
  }
  if (isSafeRef(attempt.documentId)) {
    const title = typeof attempt.documentTitle === 'string' ? attempt.documentTitle.slice(0, ATTEMPT_LIMITS.titleLength) : '';
    return { ok: true, context: { type: 'document', documentId: attempt.documentId, documentTitle: title }, source: 'legacy_document' };
  }
  return { ok: false, reason: 'attempt has no context and no valid documentId; it is not reinterpreted.' };
}

function countOutcomes(outcomes: Array<{ outcome: ResponseOutcome }>) {
  const counts = { correct: 0, incorrect: 0, unanswered: 0, dropped: 0 };
  for (const o of outcomes) counts[o.outcome]++;
  return counts;
}

/**
 * Full validation of a trusted (server-scored) attempt, run by the server before every Admin SDK
 * write. Checks identity, provenance, context, the registered marking scheme, and that every
 * derived number (counts, marks, score, percentage) agrees with the per-question outcomes.
 */
export function validateTrustedAttempt(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['attempt must be an object.'];
  const a = raw as Record<string, any>;
  const errors: string[] = [];
  const err = (message: string) => errors.push(message);

  if (a.schemaVersion !== 2) err('schemaVersion must be 2.');
  if (a.scoredBy !== 'server') err('scoredBy must be "server".');
  if (typeof a.questionSetId !== 'string' || !QUESTION_SET_ID_PATTERN.test(a.questionSetId)) err('questionSetId is invalid.');
  else if (a.id !== trustedAttemptIdFor(a.questionSetId)) err('id must be att-<questionSetId>.');
  if (!ATTEMPT_KINDS.includes(a.kind)) err('kind is invalid.');
  if (!MODES.includes(a.mode)) err('mode is invalid.');
  if (!Array.isArray(a.sources) || a.sources.length === 0 || a.sources.some((s: unknown) => !SOURCES.includes(s as QuestionSource)) || new Set(a.sources).size !== a.sources.length) {
    err('sources must be a non-empty list of distinct pyq/curated/ai labels.');
  }
  if (a.sessionId !== undefined && !isSafeRef(a.sessionId)) err('sessionId is invalid.');
  if (!isIsoUtcTimestamp(a.completedAt)) err('completedAt must be an ISO UTC timestamp.');
  if (!isNonEmptyString(a.documentTitle, ATTEMPT_LIMITS.titleLength)) err('documentTitle (display label) is required.');

  // Context.
  if (a.context === undefined) err('context is required on trusted attempts.');
  const resolution = resolveAttemptContext(a);
  if (a.context !== undefined && !resolution.ok) err(resolution.reason);
  const context = resolution.ok && resolution.source === 'explicit' ? resolution.context : null;
  if (context?.type === 'syllabus' && a.examType !== undefined && a.examType !== context.examType) err('examType does not match the syllabus context.');

  // Marking.
  if (!isRegisteredMarkingScheme(a.marking)) err('marking must be a registered marking scheme.');
  else if (a.markingSchemeId !== a.marking.id) err('markingSchemeId does not match marking.');

  // Outcomes.
  const outcomes = Array.isArray(a.outcomes) ? a.outcomes : null;
  if (!outcomes || outcomes.length === 0 || outcomes.length > ATTEMPT_LIMITS.questions) {
    err(`outcomes must list between 1 and ${ATTEMPT_LIMITS.questions} questions.`);
    return errors;
  }
  const ids = new Set<string>();
  let outcomesValid = true;
  for (const o of outcomes) {
    if (!o || typeof o !== 'object' || !isSafeRef(o.questionId) || !OUTCOMES.includes(o.outcome) || !Array.isArray(o.topicIds) || typeof o.topicLabel !== 'string') {
      outcomesValid = false;
      continue;
    }
    if (ids.has(o.questionId)) err(`question ${o.questionId} appears twice.`);
    ids.add(o.questionId);
    for (const t of o.topicIds) if (!isRegisteredTopicId(t)) err(`outcome topicId "${String(t)}" is not in a registered syllabus.`);
    if (context?.type === 'syllabus') {
      const syllabus = getSyllabus(context.syllabusId)!;
      if (o.topicIds.length === 0) err(`question ${o.questionId} needs at least one topicId.`);
      const allowed = context.topicIds.length > 0 ? new Set(context.topicIds) : null;
      for (const t of o.topicIds) {
        const found = findSyllabusTopic(syllabus, t);
        if (!found || found.chapter.id !== context.chapterId) err(`question ${o.questionId} topic "${String(t)}" is outside chapter ${context.chapterId}.`);
        else if (allowed && !allowed.has(t)) err(`question ${o.questionId} topic "${String(t)}" was not selected for this practice.`);
      }
      if (o.chapterId !== undefined && o.chapterId !== context.chapterId) err(`question ${o.questionId} chapterId differs from the context.`);
      if (o.subjectId !== undefined && o.subjectId !== context.subjectId) err(`question ${o.questionId} subjectId differs from the context.`);
    }
  }
  if (!outcomesValid) {
    err('every outcome needs a questionId, a valid outcome, topicIds and topicLabel.');
    return errors;
  }

  const counts = countOutcomes(outcomes);
  if (a.correctCount !== counts.correct) err('correctCount does not match the outcomes.');
  if (a.incorrectCount !== counts.incorrect) err('incorrectCount does not match the outcomes.');
  if (a.unansweredCount !== counts.unanswered) err('unansweredCount does not match the outcomes.');
  if (a.totalQuestions !== outcomes.length) err('totalQuestions does not match the outcomes.');
  const legacyScore = counts.correct + counts.dropped;
  if (a.score !== legacyScore) err('score (questions credited) does not match the outcomes.');
  if (a.percentage !== Math.round((legacyScore / outcomes.length) * 100)) err('percentage does not match the outcomes.');
  if (isRegisteredMarkingScheme(a.marking)) {
    const raw = outcomes.reduce((sum: number, o: { outcome: ResponseOutcome }) => sum + marksFor(o.outcome, a.marking), 0);
    if (a.rawMarks !== raw) err('rawMarks does not match the outcomes and marking scheme.');
    if (a.maxMarks !== outcomes.length * a.marking.correct) err('maxMarks does not match the marking scheme.');
    if (a.negativeMarkingUsed !== undefined && a.negativeMarkingUsed !== a.marking.incorrect < 0) err('negativeMarkingUsed does not match the marking scheme.');
  }

  // Answers mirror the outcomes one-to-one.
  if (!Array.isArray(a.answers) || a.answers.length !== outcomes.length) err('answers must list every question once.');
  else {
    a.answers.forEach((ans: any, i: number) => {
      const o = outcomes[i];
      if (!ans || ans.questionId !== o.questionId) err(`answer ${i + 1} does not match outcome order.`);
      else if (ans.isCorrect !== (o.outcome === 'correct' || o.outcome === 'dropped')) err(`answer ${o.questionId} isCorrect disagrees with its outcome.`);
    });
  }

  // Review content: bank/PYQ material is referenced, never copied.
  const usesBank = Array.isArray(a.sources) && a.sources.some((s: QuestionSource) => BANK_SOURCES.includes(s));
  if (a.reviewMode !== 'embedded' && a.reviewMode !== 'by_reference') err('reviewMode must be "embedded" or "by_reference".');
  else if (usesBank && a.reviewMode !== 'by_reference') err('bank/PYQ attempts must use reviewMode "by_reference".');
  if (a.reviewMode === 'by_reference' && (!Array.isArray(a.questions) || a.questions.length > 0)) {
    err('by_reference attempts must not embed question content.');
  }
  if (a.reviewMode === 'embedded') {
    if (!Array.isArray(a.questions) || a.questions.length !== outcomes.length) err('embedded attempts must include every reviewed question.');
    else if (a.questions.some((q: any, i: number) => !q || q.id !== outcomes[i].questionId)) err('embedded questions do not match outcome order.');
  }

  for (const field of ['weakTopics', 'strongTopics'] as const) {
    if (!Array.isArray(a[field]) || a[field].some((t: unknown) => typeof t !== 'string')) err(`${field} must be a list of strings.`);
  }
  if (a.targetTopics !== undefined && (!Array.isArray(a.targetTopics) || a.targetTopics.some((t: unknown) => typeof t !== 'string'))) {
    err('targetTopics must be a list of strings.');
  }
  return errors;
}

/** Verified only when the record is valid AND it is known to have been written by the server. */
export function isVerifiedAttempt(attempt: unknown, options: { writtenByServer: boolean }): boolean {
  return options.writtenByServer && validateTrustedAttempt(attempt).length === 0;
}
