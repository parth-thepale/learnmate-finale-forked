import type { MarkingScheme } from '../types/questionBank';
import type { ExamTypeId } from '../types/study';
import { JEE_MAIN_MARKING, PRACTICE_MARKING } from './jeeScoring';

/**
 * Registry of marking schemes. Attempts store the scheme id plus a snapshot of its values; both
 * must match a registered scheme exactly. Exams map to their official scheme here, so supporting
 * another exam (e.g. NEET UG) means registering its verified scheme, not changing scoring code.
 * Only schemes confirmed from official sources are registered.
 */
export const MARKING_SCHEME_REGISTRY: Readonly<Record<string, MarkingScheme>> = Object.freeze({
  [JEE_MAIN_MARKING.id]: JEE_MAIN_MARKING,
  [PRACTICE_MARKING.id]: PRACTICE_MARKING,
});

/** Official scheme per exam. Exams without a verified entry have no exam scheme yet. */
const EXAM_MARKING: Readonly<Partial<Record<ExamTypeId, string>>> = Object.freeze({
  jee_main: JEE_MAIN_MARKING.id,
});

export function getMarkingScheme(id: unknown): MarkingScheme | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MARKING_SCHEME_REGISTRY, id)
    ? MARKING_SCHEME_REGISTRY[id]
    : undefined;
}

export function markingSchemeForExam(examType: ExamTypeId): MarkingScheme | undefined {
  const id = EXAM_MARKING[examType];
  return id ? getMarkingScheme(id) : undefined;
}

/** True when `scheme` is exactly a registered scheme (id and every value). */
export function isRegisteredMarkingScheme(scheme: unknown): scheme is MarkingScheme {
  if (!scheme || typeof scheme !== 'object') return false;
  const s = scheme as Partial<MarkingScheme>;
  const registered = getMarkingScheme(s.id);
  return Boolean(
    registered &&
      s.correct === registered.correct &&
      s.incorrect === registered.incorrect &&
      s.unanswered === registered.unanswered &&
      Object.keys(s).every((k) => ['id', 'correct', 'incorrect', 'unanswered'].includes(k))
  );
}
